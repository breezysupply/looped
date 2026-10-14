#!/usr/bin/env python3
"""L20 validator: reads the two git repositories under work/, the CI records, the lab
registry (127.0.0.1:5020), local Docker images and — for the reconciled-state checks — the kind
cluster looped-foundations (namespace beacon). Read-only; re-runs the unit tests in work/app.

Local checks (run even without the cluster):
  workflow-file        pipeline/workflows/beacon-ci.yml: test → build → scan → publish → promote
                       staging → promote prod (protected environment), promotion by digest output,
                       no moving tags or branch-pinned actions
  tests-intact         the test files in work/app are the shipped ones (the gate was not weakened)
  tests-pass           the unit tests pass on work/app now
  faults-exercised     gate, drift, retag and rollback-request were all injected
  gate-blocked         a pipeline run was blocked at "test" for the injected commit, and the registry
                       has no image for that commit
  artifact-published   staging's artifact: Beacon 1.5.0 from a passed run on a commit after the
                       regression, served by the registry under its digest
  one-digest           prod runs the digest staging verified, with an explicit human approval
  tag-integrity        that digest is still what the sha tag and the local image hold
  schema-gate          the requested prod rollback to 1.4.0 was refused by the schema gate; prod
                       stays on schema 3; no commit ever lowered a schema version
  no-secrets           no Secret object or credential-like value in git history, CI logs or the image
  reconciler-corrected the reconciler log shows staging drift corrected after the drift injection
Cluster checks:
  cluster              context kind-looped-foundations is a local kind cluster
  reconciled           reconciler status is for git HEAD, not paused, and live objects match HEAD
  running-identity     staging and prod pods ready; /version from inside each reports 1.5.0, the
                       promoted commit and the right environment
  image-id (advisory)  the pods' imageID names the promoted digest or local image id
  notes                evidence/L20-notes.md: Gate, Promotion, Reconciler, Schema with substance
Exit 1 if a critical check fails. Writes the evidence JSON. Evidence is labelled local-only
unless LOOPED_HOSTED_RUN_URL names a hosted workflow run you executed yourself.
"""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
sys.path.insert(0, os.path.join(HERE, "pipeline"))
sys.path.insert(0, os.path.join(HERE, "reconciler"))
import labcheck as L  # noqa: E402
import ci_local as CI  # noqa: E402
import reconcile as RC  # noqa: E402

WORK = os.path.join(HERE, "work")
APP = os.path.join(WORK, "app")
GITOPS = os.path.join(WORK, "gitops")
CTX = "kind-looped-foundations"
WANT_VERSION = "1.5.0"
SECRET_TEXT = re.compile(r'("kind":\s*"Secret"|not-a-real-secret|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*[=:]\s*\S{6,})', re.I)


def sha(path):
    try:
        with open(path, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except OSError:
        return None


def injected():
    out = {}
    for ln in (L.read_text(os.path.join(WORK, ".injected")) or "").splitlines():
        parts = ln.split()
        if parts:
            out.setdefault(parts[0], []).append(parts[1:])
    return out


def job_blocks(text):
    blocks, cur = {}, None
    for ln in text.splitlines():
        m = re.match(r"^  ([a-z][a-z0-9-]*):\s*$", ln)
        if m:
            cur = m.group(1)
            blocks[cur] = ""
        elif cur and (ln.startswith("    ") or not ln.strip()):
            blocks[cur] += ln + "\n"
        elif not ln.startswith(" "):
            cur = None
    return blocks


def needs(block):
    m = re.search(r"^    needs:\s*(\[[^\]]*\]|\S+)", block, re.M)
    return [x.strip() for x in m.group(1).strip("[]").split(",")] if m else []


def main():
    args = L.standard_args("L20")
    r = L.Report("L20", "kind-basic")
    L.apply_args(r, args)
    inj = injected()

    # ── workflow definition ──────────────────────────────────────────────
    wf = L.read_text(os.path.join(HERE, "pipeline", "workflows", "beacon-ci.yml")) or ""
    jobs = job_blocks(wf.split("\njobs:", 1)[1] if "\njobs:" in wf else "")
    order = [("build", "test"), ("scan", "build"), ("publish", "scan"), ("promote-staging", "publish"), ("promote-prod", "promote-staging")]
    chain = all(j in jobs for j in ("test", "build", "scan", "publish", "promote-staging", "promote-prod")) and all(dep in needs(jobs.get(j, "")) for j, dep in order)
    by_digest = all("outputs.digest" in jobs.get(j, "") for j in ("promote-staging", "promote-prod"))
    protected = re.search(r"^    environment:\s*prod\b", jobs.get("promote-prod", ""), re.M) is not None
    moving = re.findall(r"uses:\s*\S+@(main|master|latest)\b|:latest\b", wf)
    r.check("workflow-file", chain and by_digest and protected and not moving,
            "jobs=%s chain=%s promote-by-digest=%s prod-protected=%s moving-refs=%s" % (list(jobs), chain, by_digest, protected, moving or "none"))

    # ── the gate ─────────────────────────────────────────────────────────
    shipped = {"tests/test_beacon.py": os.path.join(HERE, "..", "beacon", "tests", "test_beacon.py"),
               "tests/test_release.py": os.path.join(HERE, "assets", "app", "tests", "test_release.py")}
    diffs = [f for f, src in shipped.items() if sha(os.path.join(APP, f)) != sha(src)]
    extra = sorted(f for f in os.listdir(os.path.join(APP, "tests")) if f.endswith(".py") and "tests/" + f not in shipped and f != "__init__.py") if os.path.isdir(os.path.join(APP, "tests")) else ["tests/ missing"]
    r.check("tests-intact", not diffs and os.path.exists(os.path.join(APP, "tests", "__init__.py")),
            "changed or missing: %s; additional test files (allowed): %s" % (diffs or "none", extra or "none"))
    code, out, err = CI.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-t", "."], cwd=APP, timeout=300,
                            env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1")) if os.path.isdir(APP) else (1, "", "work/app missing")
    ran = re.search(r"Ran (\d+) tests?", out + err)
    r.check("tests-pass", code == 0 and ran is not None and int(ran.group(1)) >= 16, "exit %d, %s" % (code, ran.group(0) if ran else (err.strip()[-120:] or "no tests ran")))

    need = ["gate", "drift", "retag", "rollback-request"]
    r.check("faults-exercised", all(k in inj for k in need), "injected=%s required=%s variant=%s" % (sorted(inj), need, (L.read_text(os.path.join(WORK, ".variant")) or "").strip()))

    gate_commit = (inj.get("gate", [[None, None]])[0] + [None, None])[1]
    runs = []
    rdir = os.path.join(WORK, "ci", "runs")
    for rid in sorted(os.listdir(rdir)) if os.path.isdir(rdir) else []:
        s = CI.load(os.path.join(rdir, rid, "summary.json"))
        if s:
            runs.append(s)
    blocked = [s for s in runs if s.get("commit") == gate_commit and s.get("status") == "blocked" and s.get("blocked_at") == "test"]
    try:
        leaked = CI.registry_digest("sha-%s" % gate_commit) if gate_commit else None
        reg_err = ""
    except SystemExit as e:
        leaked, reg_err = "unknown", str(e)
    r.check("gate-blocked", bool(blocked) and leaked is None, "runs blocked at test for %s: %d; registry image for that commit: %s%s" % (gate_commit, len(blocked), leaked or "none", (" (" + reg_err + ")") if reg_err else ""))

    # ── artifact, promotion, identity ────────────────────────────────────
    stg = CI.load(os.path.join(GITOPS, "promotions", "staging.json"), {}) or {}
    prod = CI.load(os.path.join(GITOPS, "promotions", "prod.json"), {}) or {}
    rec = CI.load(CI.artifact_path(stg["digest"])) if stg.get("digest") else None
    try:
        served = CI.registry_digest(stg["digest"]) if stg.get("digest") else None
    except SystemExit as e:
        served = "error: %s" % e
    run_ok = any(s.get("run_id") == (rec or {}).get("run_id") and s.get("status") == "passed" for s in runs)
    after = bool(rec) and bool(gate_commit) and rec["commit"] != gate_commit and L.sh(["git", "-C", APP, "merge-base", "--is-ancestor", gate_commit, rec["commit"]])[0] == 0
    r.check("artifact-published", bool(rec) and rec.get("version") == WANT_VERSION and served == stg.get("digest") and run_ok and after,
            "staging %s Beacon %s commit %s from %s (passed run: %s; after the regression: %s); registry serves it: %s" % (
                stg.get("digest"), (rec or {}).get("version"), (rec or {}).get("commit"), (rec or {}).get("run_id"), run_ok, after, served == stg.get("digest")))
    approver = str(prod.get("approved_by", ""))
    r.check("one-digest", bool(prod) and prod.get("digest") == stg.get("digest") and approver not in ("", "pipeline", "setup-baseline") and not approver.startswith("pipeline"),
            "prod %s (source %s, approved by %s); staging %s" % (prod.get("digest"), prod.get("source"), approver or "nobody", stg.get("digest")))
    try:
        problems = CI.verify_artifact(rec) if rec else ["no artifact record for staging"]
    except SystemExit as e:
        problems = [str(e)]
    r.check("tag-integrity", not problems, "; ".join(problems) if problems else "sha-%s and the local image hold %s" % (rec["commit"], rec["digest"]))

    # ── schema gate ──────────────────────────────────────────────────────
    ddir = os.path.join(WORK, "ci", "decisions")
    decisions = [CI.load(os.path.join(ddir, f)) or {} for f in sorted(os.listdir(ddir))] if os.path.isdir(ddir) else []
    req_at = (inj.get("rollback-request", [["9999"]])[0] + ["9999"])[0]
    refused = [d for d in decisions if d.get("kind") == "rollback" and d.get("env") == "prod" and d.get("result") == "refused" and "schema" in d.get("reason", "") and d.get("at", "") >= req_at]
    applied_rb = [d for d in decisions if d.get("kind") == "rollback" and d.get("env") == "prod" and d.get("result") == "applied"]
    cur_prod = CI.load(os.path.join(GITOPS, "envs", "prod", "schema.json"), {}).get("data", {}).get("current")
    lowered = []
    code, out, _ = L.sh(["git", "-C", GITOPS, "log", "--format=%H", "--reverse", "--", "envs/staging/schema.json", "envs/prod/schema.json"])
    prev = {}
    for h in out.split():
        for env in ("staging", "prod"):
            c, txt, _ = L.sh(["git", "-C", GITOPS, "show", "%s:envs/%s/schema.json" % (h, env)])
            try:
                v = int(json.loads(txt)["data"]["current"]) if c == 0 else None
            except (ValueError, KeyError):
                v = None
            if v is not None and prev.get(env) is not None and v < prev[env]:
                lowered.append("%s %s: %d→%d" % (h[:8], env, prev[env], v))
            if v is not None:
                prev[env] = v
    r.check("schema-gate", bool(refused) and not applied_rb and cur_prod == "3" and prod.get("version") == WANT_VERSION and not lowered,
            "refused prod rollbacks after the request: %d (%s); applied rollbacks: %d; prod schema %s; prod Beacon %s; schema lowered by commit: %s" % (
                len(refused), (refused[-1]["reason"][:90] + "…") if refused else "-", len(applied_rb), cur_prod, prod.get("version"), lowered or "never"))

    hits = []
    code, hist, _ = L.sh(["git", "-C", GITOPS, "log", "-p", "--all"], timeout=60)
    hits += ["gitops history: " + m for m in sorted(set(SECRET_TEXT.findall(hist)))]
    for root, _, files in os.walk(os.path.join(WORK, "ci")):
        for f in files:
            if f.endswith((".log", ".json")):
                hits += ["%s: %s" % (f, m) for m in sorted(set(SECRET_TEXT.findall(L.read_text(os.path.join(root, f), 200000) or "")))]
    if rec:
        code, envs_out, _ = L.sh(["docker", "image", "inspect", "-f", "{{json .Config.Env}}", rec["local_image"]])
        for e in (json.loads(envs_out) if code == 0 and envs_out.strip() else []):
            name, _, value = e.partition("=")
            if re.search(r"PASSWORD|SECRET|TOKEN|PRIVATE_KEY|API_KEY", name, re.I) and value:
                hits.append("image env " + name)
    r.check("no-secrets", not hits, "; ".join(hits[:5]) if hits else "no Secret objects or credential-like values in git history, CI records or the image")

    events = [json.loads(ln) for ln in (L.read_text(os.path.join(WORK, "reconciler", "log.jsonl"), 2000000) or "").splitlines() if ln.strip().startswith("{")]
    drift_at = (inj.get("drift", [["9999"]])[0] + ["9999"])[0]
    corrected = [e for e in events if e.get("event") in ("corrected", "replaced") and e.get("env") == "staging" and e.get("at", "") >= drift_at]
    r.check("reconciler-corrected", bool(corrected), "%d correction event(s) for staging after the drift at %s%s" % (len(corrected), drift_at, (": " + corrected[0]["detail"][:100]) if corrected else ""))

    # ── cluster ──────────────────────────────────────────────────────────
    ok, why = L.require_kube_context(CTX)
    r.check("cluster", ok, why)
    if ok:
        status = CI.load(os.path.join(WORK, "reconciler", "status.json"), {}) or {}
        head = L.sh(["git", "-C", GITOPS, "rev-parse", "HEAD"])[1].strip()
        paused = os.path.exists(os.path.join(WORK, "reconciler", "PAUSED"))
        try:
            _, envs = RC.committed_tree()
            drift = ["%s/%s:%s" % (o["kind"], o["metadata"]["name"], f) for env in envs for _, o, f in RC.drift_of(envs[env])]
        except (SystemExit, ValueError) as e:
            drift = ["could not compare: %s" % e]
        r.check("reconciled", status.get("head") == head and not paused and not drift,
                "status head %s (git HEAD %s) paused=%s live-vs-git differences=%s" % ((status.get("head") or "none")[:12], head[:12], paused, drift or "none"))
        obs, good, ids = [], True, []
        for env, prom in (("staging", stg), ("prod", prod)):
            dep = L.kget(CTX, ["get", "deployment", "beacon-" + env]) or {}
            st = dep.get("status", {})
            code, out, err = L.kubectl(CTX, ["exec", "deploy/beacon-" + env, "-c", "api", "--", "python3", "-c",
                                             "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8080/version',timeout=5).read().decode())"], timeout=40)
            try:
                v = json.loads(out.strip().splitlines()[-1])
            except (ValueError, IndexError):
                v = {}
            ready = st.get("readyReplicas") == dep.get("spec", {}).get("replicas") and (st.get("readyReplicas") or 0) >= 1 and st.get("updatedReplicas") == st.get("readyReplicas")
            this = ready and v.get("version") == WANT_VERSION and v.get("commit") == prom.get("commit") and v.get("environment") == env
            good = good and this
            obs.append("%s ready %s/%s version %s commit %s env %s" % (env, st.get("readyReplicas"), dep.get("spec", {}).get("replicas"), v.get("version"), v.get("commit"), v.get("environment")))
            pods = (L.kget(CTX, ["get", "pods", "-l", "app=beacon,env=" + env]) or {}).get("items", [])
            ids += [cs.get("imageID", "") for p in pods for cs in p.get("status", {}).get("containerStatuses", []) or []]
        r.check("running-identity", good, "; ".join(obs))
        want = {(stg.get("digest") or "x").replace("sha256:", "")}
        lid = CI.local_id(rec["local_image"]) if rec else None
        if lid:
            want.add(lid.replace("sha256:", ""))
        r.check("image-id", bool(ids) and all(any(w in i for w in want) for i in ids), "pod imageIDs %s; expected one of %s" % (sorted(set(i[-71:] for i in ids)), sorted(w[:12] for w in want)), critical=False)
    else:
        for cid in ("reconciled", "running-identity"):
            r.check(cid, False, "not checked: cluster unavailable (%s)" % why)

    notes = L.read_text(os.path.join(HERE, "evidence", "L20-notes.md")) or ""
    secs = {s: bool(re.search(r"^#+\s*%s\b" % s, notes, re.M | re.I)) for s in ("Gate", "Promotion", "Reconciler", "Schema")}
    body = re.sub(r"<!--.*?-->|^#[^\n]*$", "", notes, flags=re.S | re.M)
    words = len(re.findall(r"[A-Za-z]{3,}", body))
    r.check("notes", all(secs.values()) and words >= 160, "sections=%s words=%d" % (secs, words))

    hosted = os.environ.get("LOOPED_HOSTED_RUN_URL", "")
    r.note("CI evidence: " + ("hosted run reported by the learner: " + hosted if hosted else "local-only (ci-local.sh); no hosted workflow run"))
    return r.finish(args.out, args.explanation, extra_env={"ci": "hosted+local" if hosted else "local-only", "scanner": os.environ.get("LOOPED_SCAN", "stub"),
                                                          "variant_file": (L.read_text(os.path.join(WORK, ".variant")) or "").strip()})


if __name__ == "__main__":
    sys.exit(main())
