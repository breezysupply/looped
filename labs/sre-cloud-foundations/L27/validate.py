#!/usr/bin/env python3
"""L27 validator: inspects the looped-l27 project, runs ONE bounded load
test of its own (60 requests/s for 20 s with your work/client.env, from the
loadgen container) and checks the database afterwards. Writes only
work/runs/validate.json and the evidence JSON.

Checks (critical unless noted):
  fixtures-intact        ingest/loadgen/pgmini/schema unchanged since setup; WRITE_COST_MS is 25 on every replica
  stack-up               database ready; every api replica answers /healthz
  limits-bounded         every replica bounds waiting (QUEUE_MAX or QUEUE_TIMEOUT_MS) and all pools
                         together fit in the database's connection limit
  client-policy-bounded  retries <= 3 with backoff, jitter, the same Idempotency-Key on every attempt,
                         and Retry-After honoured or a retry budget <= 25%; deadline unchanged (2000 ms)
  saturation-measured    a step run spans below and above capacity; your notes name a saturation point
                         within 35% of the measured one
  replica-experiment     a run served by 2+ api replicas exists and your notes explain it
  user-impact-improved   goodput >= max(1.5 x baseline, baseline + 10/s), success rate >= baseline + 15
                         points, amplification <= 1.5 (the validator's own run against the baseline at setup)
  no-duplicate-writes    the validator's run wrote exactly one row per logical request
  acked-writes-present   every request acknowledged to the client is in the database
  ledger-consistent      the running total equals the number of records
  notes                  evidence/L27-notes.md has the five sections with substance (advisory)
"""
import hashlib
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
PROJECT = "looped-l27"
RUNS = os.path.join(WORK, "runs")


def read(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def envfile(path):
    out = {}
    for line in (read(path) or "").splitlines():
        line = line.split("#", 1)[0].strip()
        if "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def psql(sql):
    code, out, err = L.sh(["docker", "exec", "-i", "looped-l27-db", "psql", "-X", "-At", "-U", "beacon", "-d", "beacon", "-v", "ON_ERROR_STOP=1", "-c", sql], timeout=30)
    return code, out.strip(), err.strip()


def replicas():
    code, out, _ = L.docker(["ps", "-q", "--filter", f"label=com.docker.compose.project={PROJECT}", "--filter", "label=com.docker.compose.service=api"])
    return out.split() if code == 0 else []


def stats_of(cid):
    code, out, _ = L.docker(["exec", cid, "python3", "-c", "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/stats', timeout=3).read().decode())"], timeout=15)
    try:
        return json.loads(out) if code == 0 else None
    except ValueError:
        return None


def number_near(text, target, tol):
    for m in re.finditer(r"(?<![\w.])(\d{1,3}(?:\.\d+)?)(?![\w.])", text):
        v = float(m.group(1))
        if target and abs(v - target) <= tol * target:
            return v
    return None


def section(text, head):
    m = re.search(r"(?ms)^## " + re.escape(head) + r"\s*$(.*?)(?=^## |\Z)", text)
    return m.group(1).strip() if m else ""


def main():
    args = L.standard_args("L27")
    r = L.Report("L27", "compose")
    L.apply_args(r, args)
    variant = (read(os.path.join(WORK, ".variant")) or "variant-a").strip()
    if not args.variant:
        r.seed = variant
    if not os.path.isdir(WORK):
        r.check("stack-up", False, "no work/ directory: run setup.sh first")
        return r.finish(args.out, args.explanation)

    ids = replicas()
    stats = {cid: stats_of(cid) for cid in ids}

    rec = load_json(os.path.join(WORK, ".l27", "fixtures.json")) or {}
    changed = [f for f, h in rec.items() if hashlib.sha256(open(os.path.join(HERE, f), "rb").read()).hexdigest() != h] if rec else ["setup record missing"]
    costs = sorted({(s or {}).get("limits", {}).get("WRITE_COST_MS") for s in stats.values()}, key=str)
    r.check("fixtures-intact", not changed and costs == [25], f"fixture files {'unchanged' if not changed else 'CHANGED: ' + ', '.join(changed)}; WRITE_COST_MS on replicas: {costs}")

    code, _, _ = L.sh(["docker", "exec", "looped-l27-db", "pg_isready", "-q", "-h", "127.0.0.1", "-U", "beacon", "-d", "beacon"], timeout=10)
    healthy = [cid[:12] for cid, s in stats.items() if s]
    r.check("stack-up", code == 0 and bool(ids) and len(healthy) == len(ids), f"db {'ready' if code == 0 else 'NOT ready'}; api replicas {len(ids)}, answering {len(healthy)}")

    c1, maxconn, _ = psql("SELECT current_setting('max_connections')::int - current_setting('superuser_reserved_connections')::int")
    try:
        usable = int(maxconn)
    except ValueError:
        usable = 0
    lim = [s.get("limits", {}) for s in stats.values() if s]
    unbounded = [i for i, x in enumerate(lim) if not (x.get("QUEUE_MAX") or x.get("QUEUE_TIMEOUT_MS"))]
    pools = sum(int(x.get("POOL_SIZE", 0)) for x in lim)
    desc = ", ".join(f"W{x.get('WORKERS')}/Q{x.get('QUEUE_MAX')}/T{x.get('QUEUE_TIMEOUT_MS')}ms/P{x.get('POOL_SIZE')}" for x in lim)
    r.check("limits-bounded", bool(lim) and not unbounded and 0 < pools <= usable,
            f"replicas [{desc}]; waiting {'bounded' if not unbounded else 'UNBOUNDED on ' + str(len(unbounded)) + ' replica(s)'}; pools total {pools} of {usable} usable connections")

    pol = envfile(os.path.join(WORK, "client.env"))
    gi = lambda k, d=0: int(pol.get(k, d) or 0)  # noqa: E731
    probs = []
    if gi("RETRIES") > 3:
        probs.append(f"RETRIES={gi('RETRIES')} (> 3)")
    if gi("RETRIES") > 0:
        if gi("BACKOFF_MS") < 50:
            probs.append("no backoff")
        if gi("JITTER") != 1:
            probs.append("no jitter")
        if gi("REUSE_KEY") != 1:
            probs.append("a new Idempotency-Key per attempt")
        if gi("HONOR_RETRY_AFTER") != 1 and not (0 < gi("RETRY_BUDGET_PCT") <= 25):
            probs.append("neither Retry-After nor a retry budget")
    if gi("DEADLINE_MS", 2000) != 2000:
        probs.append("DEADLINE_MS changed (the success definition is fixed at 2000)")
    if gi("TIMEOUT_MS", 1000) > 2000:
        probs.append("per-attempt timeout longer than the deadline")
    r.check("client-policy-bounded", not probs, "client.env: " + ", ".join(f"{k}={v}" for k, v in sorted(pol.items())) + ("; problems: " + "; ".join(probs) if probs else ""))

    notes = read(os.path.join(EV, "L27-notes.md")) or ""
    runs = []
    if os.path.isdir(RUNS):
        for f in sorted(os.listdir(RUNS)):
            if f.endswith(".json") and f != "validate.json":
                d = load_json(os.path.join(RUNS, f))
                if d and d.get("steps"):
                    runs.append(d)
    step_runs = [d for d in runs if len(d["steps"]) >= 4]
    if step_runs:
        sr = max(step_runs, key=lambda d: len(d["steps"]))
        cap = max(s["goodput_rps"] for s in sr["steps"])
        offered = [s["offered_rps"] for s in sr["steps"]]
        spans = min(offered) < 0.8 * cap and max(offered) > 1.1 * cap
        named = number_near(section(notes, "Saturation point"), cap, 0.35)
        r.check("saturation-measured", spans and named is not None,
                f"step run '{sr['label']}': offered {offered}, goodput {[s['goodput_rps'] for s in sr['steps']]}; measured capacity ~{cap}/s; "
                + (f"notes name {named}/s" if named is not None else "notes do not name a saturation point near it") + ("" if spans else "; steps do not span below and above capacity"))
    else:
        r.check("saturation-measured", False, "no step run with 4+ steps in work/runs/ (bash assets/run-load.sh step --steps 10,20,30,40,50,60,70 8)")

    multi = [d for d in runs if len(d.get("servers") or {}) >= 2]
    single = [d for d in runs if len(d.get("servers") or {}) == 1]
    rep_text = section(notes, "Replicas")
    if multi:
        m = max(multi, key=lambda d: len(d["servers"]))
        best1 = max((s["goodput_rps"] for d in single for s in d["steps"]), default=0)
        r.check("replica-experiment", len(rep_text) >= 150,
                f"run '{m['label']}' served by {len(m['servers'])} replicas: goodput {[s['goodput_rps'] for s in m['steps']]}, codes {m['codes']}; best single-replica goodput {best1}/s; notes Replicas section {len(rep_text)} chars")
    else:
        r.check("replica-experiment", False, "no run in work/runs/ was served by 2+ api replicas (docker compose ... up -d --scale api=3, then run-load.sh)")

    base = load_json(os.path.join(WORK, ".l27", "baseline.json"))
    run = None
    if ids and stats and all(stats.values()):
        code, out, err = L.sh(["docker", "compose", "-p", PROJECT, "-f", os.path.join(WORK, "compose.yaml"), "--project-directory", WORK,
                               "run", "--rm", "--no-deps", "loadgen", "--label", "validate", "--rps", "60", "--duration", "20"], timeout=240)
        run = load_json(os.path.join(RUNS, "validate.json")) if code == 0 else None
        if run is None:
            r.note("validator load run failed: " + (err.strip()[-200:] or out.strip()[-200:]))
    if base and run:
        b, v = base["steps"][0], run["steps"][0]
        need = max(1.5 * b["goodput_rps"], b["goodput_rps"] + 10)
        good = v["goodput_rps"] >= need and v["success_rate"] >= b["success_rate"] + 0.15 and v["amplification"] <= 1.5
        r.check("user-impact-improved", good,
                f"baseline goodput {b['goodput_rps']}/s, success {b['success_rate'] * 100:.0f}%, x{b['amplification']} -> now {v['goodput_rps']}/s (need >= {need:.1f}), "
                f"success {v['success_rate'] * 100:.0f}%, p99(ok) {v['p99_ok_ms']} ms, x{v['amplification']}; codes {run['codes']}")
    else:
        r.check("user-impact-improved", False, "no baseline (work/.l27/baseline.json) or the validator's load run did not complete")

    if run:
        # let writes still queued from the run finish before counting
        for _ in range(30):
            ss = [stats_of(cid) for cid in replicas()]
            if all(s and s["counters"]["busy"] == 0 and s["counters"]["waiting"] == 0 for s in ss):
                break
            time.sleep(1)
        rid = run["run_id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", rid):
            rid = "invalid"
        c, out, err = psql(f"SELECT count(*), count(DISTINCT request_key) FROM records WHERE request_key LIKE '{rid}-%'")
        try:
            rows, distinct = (int(x) for x in out.split("|"))
        except ValueError:
            rows, distinct = -1, -2
        r.check("no-duplicate-writes", rows == distinct and rows > 0, f"run {rid}: {rows} rows for {distinct} logical requests ({rows - distinct} duplicates)")
        acked = run.get("acked_request_keys") or []
        missing = -1
        if acked:
            c, out, err = psql(f"SELECT count(DISTINCT request_key) FROM records WHERE request_key LIKE '{rid}-%' AND request_key = ANY(string_to_array('{','.join(k for k in acked if re.fullmatch(r'[A-Za-z0-9_-]+', k))}', ','))")
            try:
                missing = len(set(acked)) - int(out)
            except ValueError:
                missing = -1
        r.check("acked-writes-present", missing == 0, f"{len(set(acked))} acknowledged requests, {missing if missing >= 0 else '?'} missing from records")
    else:
        r.check("no-duplicate-writes", False, "no validator load run to check")
        r.check("acked-writes-present", False, "no validator load run to check")

    c, out, err = psql("SELECT (SELECT n FROM ledger WHERE id = 1) + (SELECT count(*) FROM ledger_events), (SELECT count(*) FROM records)")
    parts = out.split("|") if c == 0 else []
    r.check("ledger-consistent", len(parts) == 2 and parts[0] == parts[1], f"running total {parts[0] if parts else '?'} vs records {parts[1] if len(parts) > 1 else '?'}" + ("" if c == 0 else f" ({err[:100]})"))

    secs = ["Saturation point", "Bottleneck", "Replicas", "Limits and retries", "What would raise capacity"]
    have = [s for s in secs if len(section(notes, s)) >= 120]
    r.check("notes", len(have) == len(secs), f"{len(have)}/{len(secs)} sections with substance", critical=False)

    return r.finish(args.out, args.explanation, {"variant_file": variant, "compose_project": PROJECT, "api_replicas": len(ids)})


if __name__ == "__main__":
    sys.exit(main())
