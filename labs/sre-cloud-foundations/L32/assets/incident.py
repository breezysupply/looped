#!/usr/bin/env python3
"""incident.py — inject, reset or check the bounded two-fault incident of the L32 assessment
on your L31 rebuild (namespace and cluster from L31/release/rebuild.env).

    python3 incident.py inject     take a pre-incident backup, then inject the drawn incident
    python3 incident.py restore    put the rebuild back to its pre-incident state (reset/teardown)
    python3 incident.py status     what the validator will check, without changing anything

Fault building blocks (the combination comes from report/draw.json):
  data-loss     writes some post-backup records, then deletes part of the seeded history: a full
                restore of the latest backup would lose the newer records (the data decision)
  bad-release   a chart upgrade with a fixture-controlled failure rate (config.inject.failRate)
  secret-drift  the database password is rotated on the database side only; API pods restarted
  rbac-broaden  a "temporary" RoleBinding gives the deploy bot the built-in edit ClusterRole
Every object it creates carries looped.lab/id=L32; every command names the kind context and the
L31 namespace (checked by L31's capstone.Cluster before any change). Fixture-controlled faults:
nothing here is a real infrastructure failure.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import secrets
import subprocess
import sys
import time
from typing import Any, Dict, List, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
L32 = os.path.dirname(HERE)
SRE = os.path.dirname(L32)
L31 = os.path.join(SRE, "L31")
sys.path.insert(0, os.path.join(L31, "assets"))
import capstone as C  # noqa: E402

STATE = os.path.join(L32, "work", "incident-state.json")
DRAW = os.path.join(L32, "report", "draw.json")
LIVE_N = 12


def load(path: str) -> Dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def run(cmd: List[str], **kw) -> Tuple[int, str, str]:
    return C.sh(cmd, timeout=kw.get("timeout", 300), input_text=kw.get("input_text"))


def must(res: Tuple[int, str, str], what: str) -> str:
    code, out, err = res
    if code != 0:
        raise SystemExit(f"ERROR: {what} failed: {(err or out).strip()[:300]}")
    return out


def helm_base(cfg: Dict[str, str], c: C.Cluster) -> List[str]:
    cmd = ["helm", "--kube-context", c.ctx, "-n", c.ns, "upgrade", cfg["RELEASE"], os.path.join(C.REPO, cfg["CHART"])]
    if cfg["ENVIRONMENT"] != "dev":
        cmd += ["-f", os.path.join(C.REPO, cfg["CHART"], f"values-{cfg['ENVIRONMENT']}.yaml")]
    return cmd + ["-f", os.path.join(L31, "work", "rendered", "values-capstone.yaml"),
                  "--post-renderer", os.path.join(L31, "assets", "postrender.py"), "--wait", "--timeout", "240s"]


def live_fingerprint_sql() -> str:
    return "SELECT count(*) || ' ' || coalesce(md5(string_agg(id || ':' || sensor_id || ':' || status, ',' ORDER BY id)), '-') FROM records WHERE id LIKE 'live-%';"


def setup() -> Tuple[Dict[str, str], C.Cluster]:
    cfg = C.load_env(C.release_dir(None))
    c = C.Cluster(cfg)
    ok, why = c.reachable()
    if not ok:
        raise SystemExit(f"ERROR: {why}. The incident runs on your L31 rebuild: start the cluster and run L31/rebuild.sh all first.")
    ns = c.kjson(["get", "namespace", c.ns], ns=False) or {}
    if (ns.get("metadata", {}).get("labels", {}) or {}).get("looped.lab/id") != "L31":
        raise SystemExit(f"ERROR: namespace {c.ns} is not an L31 rebuild; refusing")
    return cfg, c


def inject() -> int:
    draw = load(DRAW)
    cat = {x["id"]: x for x in load(os.path.join(HERE, "catalogue.json")).get("combined", [])}
    if draw.get("incident") not in cat:
        raise SystemExit("ERROR: no report/draw.json with an incident; run L32/setup.sh first")
    if os.path.exists(STATE):
        raise SystemExit("ERROR: an incident is already injected (work/incident-state.json); use reset.sh to start it again")
    cfg, c = setup()
    faults = cat[draw["incident"]]["faults"]
    rng = random.Random("looped-l32-incident:" + draw["seed"])
    must(run(["bash", os.path.join(L31, "rebuild.sh"), "backup"]), "pre-incident backup")
    backups = sorted(f for f in os.listdir(os.path.join(L31, "work", "backups")) if f.endswith(".dump"))
    hist = json.loads(must(run(["helm", "--kube-context", c.ctx, "-n", c.ns, "history", cfg["RELEASE"], "-o", "json"]), "helm history") or "[]")
    state: Dict[str, Any] = {"incident": draw["incident"], "seed": draw["seed"], "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                             "namespace": c.ns, "cluster": cfg["CLUSTER"], "pre_revision": hist[-1]["revision"] if hist else None,
                             "pre_backup": backups[-1] if backups else None, "seed_records": int(cfg["SEED_RECORDS"])}
    if "data-loss" in faults:
        sensors = sorted(rng.sample([f"cap-{i:03d}" for i in range(24)], 3))
        values = ",".join(f"('live-{i:05d}', '{sensors[i % 3]}', '{'degraded' if i % 4 == 0 else 'ok'}', "
                          f"to_char(now() at time zone 'utc' + interval '{i} seconds', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), 'live-req-{i}', 'live-idem-{i}')"
                          for i in range(1, LIVE_N + 1))
        sql = (f"INSERT INTO records (id, sensor_id, status, ts, request_id, idem_key) VALUES {values} ON CONFLICT (id) DO NOTHING;\n"
               f"DELETE FROM records WHERE id LIKE 'seed-%' AND sensor_id IN ({','.join(repr(s) for s in sensors)});\n")
        code, out = c.psql(sql)
        if code != 0:
            raise SystemExit(f"ERROR: data fault: {out[:200]}")
        state["live"] = c.psql(live_fingerprint_sql())[1]
    if "bad-release" in faults:
        must(run(helm_base(cfg, c) + ["--set", "config.inject.failRate=0.4"]), "bad release")
    if "secret-drift" in faults:
        newpw = f"lab-l32-{secrets.token_hex(6)}-not-a-real-secret"
        code, out = c.psql(f"ALTER USER beacon PASSWORD '{newpw}';")
        if code != 0:
            raise SystemExit(f"ERROR: secret drift: {out[:200]}")
        must(c.k(["delete", "pod", "-l", "app=beacon-api", "--wait=false"]), "restart API pods")
    if "rbac-broaden" in faults:
        rb = {"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "RoleBinding",
              "metadata": {"name": "beacon-deployer-incident-access", "namespace": c.ns, "labels": {"looped.lab/id": "L32"},
                           "annotations": {"looped.lab/note": "temporary access added during the incident; remove after"}},
              "roleRef": {"apiGroup": "rbac.authorization.k8s.io", "kind": "ClusterRole", "name": "edit"},
              "subjects": [{"kind": "ServiceAccount", "name": "beacon-deployer", "namespace": c.ns}]}
        must(c.k(["apply", "-f", "-"], input_text=json.dumps(rb)), "temporary RoleBinding")
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)
    print(f"incident {draw['incident']} started at {state['started_at']} in {c.ns}: {cat[draw['incident']]['area']}")
    return 0


def restore() -> int:
    st = load(STATE)
    cfg, c = setup()
    must(c.k(["delete", "rolebinding,role,configmap,secret,pod,job", "-l", "looped.lab/id=L32", "--ignore-not-found"]), "remove L32 objects")
    pw = open(os.path.join(L31, "work", ".secrets", "db-password"), encoding="utf-8").read().strip()
    c.psql(f"ALTER USER beacon PASSWORD '{pw}';")
    vals = json.loads(run(["helm", "--kube-context", c.ctx, "-n", c.ns, "get", "values", cfg["RELEASE"], "-o", "json"])[1] or "{}")
    if (vals.get("config") or {}).get("inject") and st.get("pre_revision"):
        must(run(["helm", "--kube-context", c.ctx, "-n", c.ns, "rollback", cfg["RELEASE"], str(st["pre_revision"]), "--wait"]), "helm rollback")
    if st.get("pre_backup"):
        path = os.path.join(L31, "work", "backups", st["pre_backup"])
        with open(path, "rb") as fh:
            data = fh.read()
        p = subprocess.run(["kubectl", "--context", c.ctx, "-n", c.ns, "exec", "-i", "beacon-db-0", "--", "pg_restore", "-U", "beacon", "-d", "beacon", "--clean", "--if-exists", "--no-owner"],
                           input=data, capture_output=True, timeout=300)
        if p.returncode != 0:
            raise SystemExit(f"ERROR: restoring {path}: {p.stderr.decode()[:200]}")
    c.k(["delete", "pod", "-l", "app=beacon-api", "--wait=false"])
    c.k(["rollout", "status", f"deployment/{C.fullname(cfg['RELEASE'])}", "--timeout=180s"])
    if os.path.exists(STATE):
        os.replace(STATE, STATE + ".prev")
    print(f"rebuild in {c.ns} back to its pre-incident state")
    return 0


def checks() -> List[Tuple[str, bool, str]]:
    """Live checks after your recovery (used by validate.py)."""
    st = load(STATE) or load(STATE + ".prev")
    cfg = C.load_env(C.release_dir(None))
    c = C.Cluster(cfg)
    ok, why = c.reachable()
    if not ok:
        return [("cluster", False, why)]
    rows = {cid: (o, obs) for cid, o, obs in C.live_checks(cfg, C.release_dir(None))}
    out = [("service", rows.get("health", (False, "no health result"))[0], rows.get("health", (False, "no health result"))[1])]
    seeded = rows.get("seeded-data", (False, "no data result"))
    live_now = c.psql(live_fingerprint_sql())[1]
    want_live = st.get("live")
    data_ok = seeded[0] and (want_live is None or live_now == want_live)
    out.append(("data", data_ok, f"{seeded[1]}; post-backup records {live_now} (expected {want_live or 'none injected'})"))
    lp = rows.get("least-privilege", (False, "no result"))
    rbs = (c.kjson(["get", "rolebindings"]) or {}).get("items", [])
    broad = [r["metadata"]["name"] for r in rbs if (r.get("roleRef") or {}).get("kind") == "ClusterRole" and r["roleRef"].get("name") in ("edit", "admin", "cluster-admin")]
    out.append(("least-privilege", lp[0] and not broad, f"{lp[1]}; broad RoleBindings: {broad or 'none'}"))
    vals = json.loads(C.sh(["helm", "--kube-context", c.ctx, "-n", c.ns, "get", "values", cfg["RELEASE"], "-o", "json"], 30)[1] or "{}")
    inj = (vals.get("config") or {}).get("inject") or {}
    out.append(("release", not any(inj.values()) and rows.get("health", (False,))[0], f"user-supplied inject values now {inj or 'none'}"))
    leftovers = [i["metadata"]["name"] for kind in ("rolebindings", "configmaps", "pods", "jobs") for i in (c.kjson(["get", kind, "-l", "looped.lab/id=L32"]) or {}).get("items", [])]
    code, dbs = c.psql("SELECT string_agg(datname, ',') FROM pg_database WHERE datname NOT IN ('beacon', 'postgres', 'template0', 'template1');")
    out.append(("scoped-cleanup-cluster", not leftovers and code == 0 and not dbs.strip(), f"L32-labelled objects left: {leftovers or 'none'}; scratch databases left: {dbs.strip() or 'none'}"))
    return out


def main(argv: List[str]) -> int:
    cmd = argv[0] if argv else ""
    if cmd == "inject":
        return inject()
    if cmd == "restore":
        return restore()
    if cmd == "status":
        rows = checks()
        for cid, ok, obs in rows:
            print(f"{'PASS' if ok else 'FAIL'} {cid}: {obs}")
        return 0 if all(ok for _, ok, _ in rows) else 1
    print(__doc__.split("\n\n")[1])
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
