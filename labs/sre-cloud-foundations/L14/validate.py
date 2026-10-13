#!/usr/bin/env python3
"""L14 validator: queries the REAL Compose project looped-l14.

It is not read-only: to prove persistence and shutdown it writes a record,
REPLACES the db container (rm -fsv + up), recreates the api, and stops and
restarts api and worker. Everything stays inside project looped-l14.

Checks (all critical):
  compose-config        `docker compose config` parses; services api, worker, db
  images-pinned         postgres is 16.x by exact tag (digest welcome); nothing :latest or untagged
  readiness-gated       db has a healthcheck and api depends_on db with condition service_healthy
  services-running      api, worker and db containers are running and labelled L14
  db-healthy            Docker reports the db container healthy
  store-host-resolves   the database host in api's store URL resolves on the project network
  api-ready             GET /ready -> 200 with store postgres
  worker-consumes       a job POSTed to /jobs is processed by the worker (effects file)
  data-on-named-volume  db's data directory is a NAMED volume (looped-l14_pgdata), not anonymous or container layer
  record-survives       a record written before the db container is replaced is read back after
  graceful-stop         api and worker stop on SIGTERM well inside the grace period with exit code 0
  no-secret-in-logs     the fixture database password never appears in api/worker logs
  fixture-kept          (variant-b only) the late-start fixture is still in place: you fixed the dependency, not the environment
Exit 1 if any check fails. Writes the evidence JSON for the app.
"""
import json
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
COMPOSE = os.path.join(WORK, "compose.yaml")
PROJECT = "looped-l14"
API = "http://127.0.0.1:18014"
LABEL = "looped.lab/id"
FIXTURE_PASSWORD = "lab-l14-db-password-not-a-real-secret"


def dc(args, timeout=180.0):
    return L.compose(PROJECT, ["-f", COMPOSE] + list(args), cwd=WORK, timeout=timeout)


def container(service):
    code, out, _ = dc(["ps", "-a", "-q", service], timeout=30)
    cid = out.strip().splitlines()[0] if code == 0 and out.strip() else ""
    if not cid:
        return None
    code, out, _ = L.docker(["inspect", cid])
    try:
        return json.loads(out)[0] if code == 0 else None
    except (ValueError, IndexError):
        return None


def api_ready(timeout_s=120.0):
    last = {"code": 0, "body": ""}

    def probe():
        c, b, _ = L.http(API + "/ready", timeout=3)
        last["code"], last["body"] = c, b.strip()[:160]
        return c == 200
    ok = L.wait_until(probe, timeout_s=timeout_s, every_s=2)
    return ok, last


def stop_timed(service):
    ctr = container(service)
    if not ctr or not ctr["State"].get("Running"):
        return False, f"{service} not running"
    pid1 = ""
    c, o, _ = L.docker(["exec", ctr["Id"], "cat", "/proc/1/cmdline"], timeout=15)
    if c == 0:
        pid1 = " ".join(a for a in o.split("\0") if a)
    t0 = time.time()
    c, o, e = L.docker(["stop", "--time", "10", ctr["Id"]], timeout=40)
    took = time.time() - t0
    after = container(service) or {}
    code = (after.get("State") or {}).get("ExitCode")
    ok = c == 0 and code == 0 and took < 8.0
    return ok, f"{service}: PID 1 '{pid1[:60]}', stop took {took:.1f}s, exit code {code}"


def main() -> int:
    args = L.standard_args("L14")
    r = L.Report("L14", "compose")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(WORK, ".variant")) or "").strip() or "variant-a"
    if not args.variant:
        r.seed = variant
    env_extra = {"project": PROJECT, "variant_file": variant}
    c, v, _ = L.sh(["docker", "compose", "version", "--short"], timeout=15)
    env_extra["compose"] = v.strip()

    code, out, err = dc(["config", "--format", "json"], timeout=30)
    cfg = {}
    try:
        cfg = json.loads(out) if code == 0 else {}
    except ValueError:
        cfg = {}
    services = cfg.get("services") or {}
    if not r.check("compose-config", {"api", "worker", "db"} <= set(services),
                   ("services: " + ", ".join(sorted(services))) if services else ("compose config failed: " + err.strip()[:200])):
        return r.finish(args.out, args.explanation, env_extra)

    images = {name: str(s.get("image") or "") for name, s in services.items()}
    dbimg = images.get("db", "")
    pinned = re.match(r"^postgres:16\.\d+[\w.-]*(@sha256:[0-9a-f]{64})?$", dbimg) is not None
    floating = [f"{n}={i}" for n, i in images.items() if not i or i.endswith(":latest") or ":" not in i.split("/")[-1].split("@")[0]]
    r.check("images-pinned", pinned and not floating, f"db={dbimg[:90]}" + (f"; floating: {', '.join(floating)}" if floating else ""))

    db_hc = (services["db"].get("healthcheck") or {})
    hc_test = db_hc.get("test") or []
    hc_on = bool(hc_test) and not db_hc.get("disable") and hc_test[0] != "NONE"
    cond = ((services["api"].get("depends_on") or {}).get("db") or {}).get("condition", "")
    r.check("readiness-gated", hc_on and cond == "service_healthy",
            f"db healthcheck={'yes: ' + ' '.join(hc_test[1:])[:80] if hc_on else 'none'}; api depends_on db condition={cond or 'none'}")

    ctrs = {s: container(s) for s in ("api", "worker", "db")}
    states = {s: ((c or {}).get("State") or {}) for s, c in ctrs.items()}
    labels_ok = all((((c or {}).get("Config") or {}).get("Labels") or {}).get(LABEL) == "L14" for c in ctrs.values() if c)
    running = all(st.get("Running") for st in states.values())
    r.check("services-running", running and labels_ok,
            "; ".join(f"{s}={st.get('Status', 'missing')}" + (f"(exit {st.get('ExitCode')})" if st and not st.get("Running") else "") for s, st in states.items()))

    health = ""

    def db_health():
        nonlocal health
        d = container("db") or {}
        health = ((d.get("State") or {}).get("Health") or {}).get("Status", "no healthcheck")
        return health in ("healthy", "no healthcheck")
    L.wait_until(db_health, timeout_s=120, every_s=3)
    r.check("db-healthy", health == "healthy", f"db health={health}")

    probe = ("import os, socket, urllib.parse\n"
             "h = urllib.parse.urlparse(os.environ.get('BEACON_STORE_URL', '')).hostname or ''\n"
             "try:\n"
             "    a = socket.getaddrinfo(h, 5432)[0][4][0]\n"
             "    print(h, '->', a)\n"
             "except Exception as e:\n"
             "    print(h, '->', type(e).__name__, e)\n"
             "    raise SystemExit(1)\n")
    code, out, err = dc(["run", "--rm", "--no-deps", "-T", "--label", f"{LABEL}=L14", "--entrypoint", "python3", "api", "-c", probe], timeout=90)
    r.check("store-host-resolves", code == 0, (out.strip() or err.strip())[-200:])

    ok, last = api_ready(150 if variant == "variant-b" else 90)
    store_pg = '"store": "postgres"' in last["body"]
    r.check("api-ready", ok and store_pg, f"GET /ready -> {last['code'] or 'no answer'} {last['body'][:120]}")

    # worker: enqueue one job, wait for its effect row
    key = "l14-job-" + str(int(time.time()))
    jok, jobs = False, ""
    if ok:
        c, b, _ = L.http(API + "/jobs", method="POST", body=json.dumps({"kind": "noop", "payload": {"work_ms": 20}}).encode(), headers={"Content-Type": "application/json", "Idempotency-Key": key}, timeout=5)
        jobs = f"POST /jobs -> {c}"
        if c == 202:
            def effect():
                c2, o2, _ = dc(["exec", "-T", "worker", "python3", "-c", f"import sys; print(sum(1 for l in open('/var/lib/beacon/queue/effects.jsonl') if '{key}' in l))"], timeout=20)
                return c2 == 0 and o2.strip() not in ("", "0")
            jok = L.wait_until(effect, timeout_s=30, every_s=2)
            jobs += "; worker recorded the effect" if jok else "; no effect row from the worker within 30s"
    else:
        jobs = "api not ready; job not sent"
    r.check("worker-consumes", jok, jobs)

    db = ctrs.get("db") or {}
    pgdata = "/var/lib/postgresql/data"
    for e in ((db.get("Config") or {}).get("Env") or []):
        if e.startswith("PGDATA="):
            pgdata = e.split("=", 1)[1]
    mounts = db.get("Mounts") or []
    m = [x for x in mounts if pgdata == x.get("Destination") or pgdata.startswith(x.get("Destination", "//").rstrip("/") + "/")]
    named = bool(m) and m[0].get("Type") == "volume" and m[0].get("Name") == f"{PROJECT}_pgdata"
    desc = ", ".join(f"{x.get('Type')}:{(x.get('Name') or x.get('Source') or '')[:24]}->{x.get('Destination')}" for x in mounts) or "no mounts"
    r.check("data-on-named-volume", named, f"PGDATA={pgdata}; mounts: {desc}")

    # persistence across container replacement
    sensor = "l14-validate-" + str(int(time.time()))
    survived, sobs = False, ""
    if ok:
        c, b, _ = L.http(API + "/status", method="POST", body=json.dumps({"sensor_id": sensor, "status": "ok"}).encode(), headers={"Content-Type": "application/json", "Idempotency-Key": sensor}, timeout=5)
        if c in (200, 201):
            old_id = db.get("Id", "")[:12]
            dc(["rm", "--force", "--stop", "--volumes", "db"], timeout=60)
            c1, _, e1 = dc(["up", "-d", "--wait", "--wait-timeout", "150", "db"], timeout=200)
            c2, _, e2 = dc(["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "60", "api"], timeout=120)
            new_id = ((container("db") or {}).get("Id") or "")[:12]
            ready2, _ = api_ready(60)
            c3, b3, _ = L.http(API + "/status/" + sensor, timeout=5)
            n = 0
            try:
                n = len(json.loads(b3).get("records", [])) if c3 == 200 else 0
            except ValueError:
                pass
            survived = ready2 and n >= 1 and old_id != new_id
            sobs = f"wrote {sensor}; db container {old_id} -> {new_id or 'none'}; after replacement GET /status/{sensor} -> {c3} with {n} record(s)"
            if c1 != 0 or c2 != 0:
                sobs += " (up: " + (e1 + e2).strip()[-120:] + ")"
        else:
            sobs = f"POST /status -> {c} {b[:100]}"
    else:
        sobs = "api not ready; persistence not testable"
    r.check("record-survives", survived, sobs)

    obs, all_ok = [], True
    for svc in ("api", "worker"):
        good, o = stop_timed(svc)
        all_ok = all_ok and good
        obs.append(o)
    dc(["up", "-d", "--no-deps", "api", "worker"], timeout=120)
    r.check("graceful-stop", all_ok, " | ".join(obs))

    code, logs, lerr = dc(["logs", "--no-color", "api", "worker"], timeout=60)
    text = logs + lerr
    leaked = FIXTURE_PASSWORD in text or L.contains_secret(text)
    r.check("no-secret-in-logs", not leaked and code == 0, f"{len(text.splitlines())} log lines scanned; " + ("password found in logs" if leaked else "no password or secret-shaped value"))

    if variant == "variant-b":
        kept = "sleep 45" in json.dumps(services["db"].get("entrypoint") or "")
        r.check("fixture-kept", kept, "late-start fixture still in db entrypoint" if kept else "the db start-delay fixture was removed: that changes the environment, not the dependency handling")

    env_extra["db_image"] = dbimg[:120]
    return r.finish(args.out, args.explanation, env_extra)


if __name__ == "__main__":
    sys.exit(main())
