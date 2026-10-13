#!/usr/bin/env python3
"""L17 validator: queries the kind cluster looped-foundations (namespace beacon,
objects labelled looped.lab/id=L17). Read-only: kubectl get, and kubectl exec for a
cgroup memory reading in beacon-report and a checksum query in beacon-db-0.

Checks (critical unless marked):
  cluster            context kind-looped-foundations is a local kind cluster
  faults-exercised   work/.injected shows variant-a, -b and -c were injected (or variant-d when
                     validating the independent variant with --variant variant-d)
  workloads-ready    beacon-api >= 2 ready and updated, beacon-report 1/1, beacon-db 1/1
  no-pending         no L17 pod is Pending (FailedScheduling message quoted if one is)
  requests-bounded   every container requests cpu+memory and limits memory; requests <= limits;
                     cpu request <= 1, memory request/limit <= 1Gi (no over-provisioning)
  report-memory      beacon-report: workload unchanged (REPORT_WORKING_SET_MB=96), no OOMKilled,
                     restartCount stable over 15 s, memory limit >= 1.15 x measured working set and
                     <= 256Mi, request >= 0.8 x measured
  storage            data-beacon-db-0 is Bound through StorageClass "standard"; no L17 PVC Pending
  dataset            checksum over every row equals assets/dataset.checksum
  pdb                PodDisruptionBudget beacon-api (policy/v1) still selects the API, protects at
                     least one pod and currently allows >= 1 disruption
  drain-drill        evidence/L17-drain.json (attempts since this setup's first injection): one
                     blocked by the budget, then a completed drain of an existing worker without
                     --force/--disable-eviction; no node is left cordoned
  notes              evidence/L17-notes.md: Pending, OOM, Storage, Drain sections with substance
Exit 1 if a critical check fails. Writes the evidence JSON.
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
CTX = "kind-looped-foundations"
LABEL = "looped.lab/id=L17"
MI = 1024 * 1024
UNITS = {"Ki": 1024, "Mi": MI, "Gi": 1024 * MI, "Ti": 1024 * 1024 * MI, "k": 1000, "M": 1000 ** 2, "G": 1000 ** 3, "T": 1000 ** 4}


def cpu(q):
    if q is None:
        return None
    q = str(q)
    return float(q[:-1]) / 1000.0 if q.endswith("m") else float(q)


def mem(q):
    if q is None:
        return None
    m = re.fullmatch(r"([0-9.]+)([KMGT]i?|k)?", str(q))
    if not m:
        return None
    return float(m.group(1)) * UNITS.get(m.group(2) or "", 1)


def fmt_mi(b):
    return "%.0fMi" % (b / MI) if b is not None else "?"


def get(args):
    return L.kget(CTX, args) or {}


def main():
    args = L.standard_args("L17")
    r = L.Report("L17", "kind-basic")
    L.apply_args(r, args)
    ok, why = L.require_kube_context(CTX)
    if not r.check("cluster", ok, why):
        return r.finish(args.out, args.explanation)

    inj_lines = [ln.split() for ln in (L.read_text(os.path.join(WORK, ".injected")) or "").splitlines() if ln.strip()]
    injected = [x[0] for x in inj_lines]
    since = min([x[1] for x in inj_lines if len(x) > 1] or ["0000"])
    need = ["variant-d"] if args.variant == "variant-d" else ["variant-a", "variant-b", "variant-c"]
    r.check("faults-exercised", all(v in injected for v in need), "injected=%s required=%s" % (injected or "none", need))

    api = get(["get", "deployment", "beacon-api"])
    rep = get(["get", "deployment", "beacon-report"])
    db = get(["get", "statefulset", "beacon-db"])

    def ready(o):
        s = o.get("status", {})
        return o.get("spec", {}).get("replicas"), s.get("readyReplicas", 0), s.get("updatedReplicas", 0)
    a, rp, d = ready(api), ready(rep), ready(db)
    r.check("workloads-ready", bool(api and rep and db) and (a[0] or 0) >= 2 and a[1] == a[0] and a[2] == a[0] and rp[1] == 1 and rp[2] == 1 and d[1] == 1,
            "beacon-api %s/%s ready (%s updated); beacon-report %s/%s; beacon-db %s/%s" % (a[1], a[0], a[2], rp[1], rp[0], d[1], d[0]))

    pods = get(["get", "pods", "-l", LABEL]).get("items", [])
    pending = [p for p in pods if p.get("status", {}).get("phase") == "Pending"]
    msg = ""
    for p in pending[:1]:
        for c in p.get("status", {}).get("conditions", []) or []:
            if c.get("type") == "PodScheduled" and c.get("status") == "False":
                msg = " — %s: %s" % (p["metadata"]["name"], (c.get("message") or "")[:200])
    r.check("no-pending", bool(pods) and not pending, "%d L17 pods, %d Pending%s" % (len(pods), len(pending), msg))

    problems, seen = [], 0
    for kind, obj in (("beacon-api", api), ("beacon-report", rep), ("beacon-db", db)):
        for c in obj.get("spec", {}).get("template", {}).get("spec", {}).get("containers", []) or []:
            seen += 1
            res = c.get("resources", {})
            req, lim = res.get("requests", {}) or {}, res.get("limits", {}) or {}
            rc, rm, lm = cpu(req.get("cpu")), mem(req.get("memory")), mem(lim.get("memory"))
            name = "%s/%s" % (kind, c.get("name"))
            if rc is None or rm is None or lm is None:
                problems.append("%s missing requests/limits" % name)
                continue
            if rc > 1.0:
                problems.append("%s cpu request %s > 1" % (name, req.get("cpu")))
            if rm > 1024 * MI or lm > 1024 * MI:
                problems.append("%s memory %s/%s > 1Gi" % (name, req.get("memory"), lim.get("memory")))
            if rm > lm:
                problems.append("%s request %s > limit %s" % (name, req.get("memory"), lim.get("memory")))
    r.check("requests-bounded", seen >= 3 and not problems, "; ".join(problems) if problems else "%d containers: requests and memory limits set and bounded" % seen)

    # beacon-report: the OOM fault
    rc = (rep.get("spec", {}).get("template", {}).get("spec", {}).get("containers") or [{}])[0]
    envs = {e.get("name"): e.get("value") for e in rc.get("env", []) or []}
    lim = mem((rc.get("resources", {}).get("limits") or {}).get("memory"))
    req = mem((rc.get("resources", {}).get("requests") or {}).get("memory"))
    rpods = [p for p in get(["get", "pods", "-l", "app=beacon-report"]).get("items", []) if p.get("status", {}).get("phase") == "Running"]
    observed, restarts0, oom, detail = None, None, False, "no running beacon-report pod"
    if rpods:
        pname = rpods[0]["metadata"]["name"]
        cs = (rpods[0].get("status", {}).get("containerStatuses") or [{}])[0]
        restarts0 = cs.get("restartCount", 0)
        oom = (cs.get("lastState", {}).get("terminated", {}) or {}).get("reason") == "OOMKilled"
        reader = ("import sys\nfor p in ('/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory/memory.usage_in_bytes'):\n"
                  "    try:\n        print(int(open(p).read().strip())); sys.exit(0)\n    except OSError:\n        pass\nsys.exit(3)")
        code, out, err = L.kubectl(CTX, ["exec", pname, "-c", "report", "--", "python3", "-c", reader], timeout=30)
        if code == 0 and out.strip().isdigit():
            observed = int(out.strip())
        time.sleep(15)
        later = get(["get", "pod", pname])
        restarts1 = ((later.get("status", {}).get("containerStatuses") or [{}])[0]).get("restartCount")
        detail = "pod %s restarts %s→%s lastState OOMKilled=%s working set %s; limit %s request %s; REPORT_WORKING_SET_MB=%s" % (
            pname, restarts0, restarts1, oom, fmt_mi(observed), fmt_mi(lim), fmt_mi(req), envs.get("REPORT_WORKING_SET_MB"))
        stable = restarts1 == restarts0
    else:
        stable = False
    sized = observed is not None and lim is not None and req is not None and lim >= 1.15 * observed and lim <= 256 * MI and req >= 0.8 * observed
    r.check("report-memory", bool(rpods) and envs.get("REPORT_WORKING_SET_MB") == "96" and not oom and stable and sized, detail)

    # storage and data
    pvc = get(["get", "pvc", "data-beacon-db-0"])
    pvcs = get(["get", "pvc", "-l", LABEL]).get("items", [])
    pend = [p["metadata"]["name"] + "(" + str(p.get("spec", {}).get("storageClassName")) + ")" for p in pvcs if p.get("status", {}).get("phase") != "Bound"]
    sc = pvc.get("spec", {}).get("storageClassName")
    scobj = L.kget(CTX, ["get", "storageclass", sc or "none"], ns=None) if sc else None
    r.check("storage", pvc.get("status", {}).get("phase") == "Bound" and sc == "standard" and bool(scobj) and not pend,
            "data-beacon-db-0 phase=%s class=%s volume=%s; not bound: %s" % (pvc.get("status", {}).get("phase"), sc, pvc.get("spec", {}).get("volumeName"), pend or "none"))

    want = (L.read_text(os.path.join(HERE, "assets", "dataset.checksum")) or "").strip()
    query = L.read_text(os.path.join(HERE, "assets", "checksum.sql")) or ""
    code, out, err = L.sh(["kubectl", "--context", CTX, "-n", L.NAMESPACE, "exec", "-i", "beacon-db-0", "-c", "postgres", "--",
                           "psql", "-U", "postgres", "-d", "beacon", "-At", "-v", "ON_ERROR_STOP=1"], timeout=60, input_text=query)
    got = out.strip()
    r.check("dataset", code == 0 and bool(want) and got == want, "checksum %s (expected %s)%s" % (got or "none", want, "" if code == 0 else ": " + err.strip()[:160]))

    # disruption budget
    pdb = get(["get", "pdb", "beacon-api"])
    st, sp = pdb.get("status", {}), pdb.get("spec", {})
    sel = (sp.get("selector") or {}).get("matchLabels") or {}
    r.check("pdb", pdb.get("apiVersion") == "policy/v1" and sel.get("app") == "beacon-api" and (st.get("desiredHealthy") or 0) >= 1 and (st.get("disruptionsAllowed") or 0) >= 1 and st.get("expectedPods") == a[0],
            "spec=%s status desiredHealthy=%s currentHealthy=%s disruptionsAllowed=%s expectedPods=%s" % (
                {k: v for k, v in sp.items() if k != "selector"} or "missing", st.get("desiredHealthy"), st.get("currentHealthy"), st.get("disruptionsAllowed"), st.get("expectedPods")))

    nodes = (L.kget(CTX, ["get", "nodes"], ns=None) or {}).get("items", [])
    cordoned = [n["metadata"]["name"] for n in nodes if n.get("spec", {}).get("unschedulable")]
    names = {n["metadata"]["name"] for n in nodes}
    try:
        drill = json.load(open(os.path.join(EV, "L17-drain.json"), encoding="utf-8"))
        attempts = [x for x in drill.get("attempts", []) if str(x.get("started", "")) >= since]  # this setup's attempts only
    except (OSError, ValueError):
        attempts = []
    first_block = next((i for i, x in enumerate(attempts) if x.get("budget_blocked") and not x.get("completed")), None)
    done = [x for i, x in enumerate(attempts) if x.get("completed") and first_block is not None and i > first_block and x.get("node") in names
            and not any(f in ("--force", "--disable-eviction") for f in x.get("flags", []))]
    r.check("drain-drill", first_block is not None and bool(done) and not cordoned,
            "%d attempt(s); blocked by budget first=%s; completed afterwards=%s; cordoned now=%s" % (
                len(attempts), first_block is not None, [x.get("node") for x in done] or "none", cordoned or "none"))

    notes = L.read_text(os.path.join(EV, "L17-notes.md")) or ""
    secs = {s: bool(re.search(r"^#+\s*%s\b" % s, notes, re.M | re.I)) for s in ("Pending", "OOM", "Storage", "Drain")}
    body = re.sub(r"<!--.*?-->|^#.*$", "", notes, flags=re.S | re.M)
    words = len(re.findall(r"[A-Za-z]{3,}", body))
    r.check("notes", all(secs.values()) and words >= 150, "sections=%s words=%d" % (secs, words))
    return r.finish(args.out, args.explanation, extra_env={"injected": injected})


if __name__ == "__main__":
    sys.exit(main())
