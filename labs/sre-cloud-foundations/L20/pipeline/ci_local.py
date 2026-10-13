#!/usr/bin/env python3
"""L20 local pipeline: the same stages as pipeline/workflows/beacon-ci.yml, executable on your
machine. Run it through ../ci-local.sh (which checks scope first).

    ci-local.sh run [--no-promote]          test → build → scan → publish → promote staging
    ci-local.sh promote ENV [--from staging | --tag TAG] [--approve NAME]
    ci-local.sh rollback ENV --to DIGEST|VERSION|RUN_ID [--approve NAME]
    ci-local.sh verify-tag TAG              where does a registry tag point, versus the records?
    ci-local.sh status                      promotions, last runs, registry tags

Gates: a failing stage stops the run ("blocked at <stage>") and nothing after it happens: no
image is published, nothing is promoted. Promotion moves a DIGEST recorded by the publish stage,
never a tag. Prod promotion needs --approve and takes staging's verified record. Every promotion
and rollback passes a schema-compatibility gate: the artifact's declared schema range must
contain the environment's database schema after its migrations; migrations never run backwards.

Standard library only. Writes under work/ci/ and commits to the work/gitops repository.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(HERE)
WORK = os.path.join(LAB, "work")
APP = os.path.join(WORK, "app")
GITOPS = os.path.join(WORK, "gitops")
CI = os.path.join(WORK, "ci")
REGISTRY = os.environ.get("LOOPED_L20_REGISTRY", "127.0.0.1:5020")
REPO = "looped-l20/beacon"
LOCAL = "looped-l20-beacon"
ACCEPT = ", ".join(["application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json",
                    "application/vnd.docker.distribution.manifest.v2+json", "application/vnd.docker.distribution.manifest.list.v2+json"])
NOPROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def say(msg):
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def run(cmd, cwd=None, timeout=600, env=None):
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)
        return r.returncode, r.stdout, r.stderr
    except FileNotFoundError:
        return 127, "", "%s: not found" % cmd[0]
    except subprocess.TimeoutExpired:
        return 124, "", "%s: timed out" % " ".join(cmd)


def git(repo, *args):
    return run(["git", "-C", repo] + list(args), timeout=60)


def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2)
        fh.write("\n")


# ── registry (Docker Registry HTTP API v2, loopback only) ──────────────────

def registry_digest(ref):
    """Digest the registry serves for a tag or digest of looped-l20/beacon; None if absent."""
    req = urllib.request.Request("http://%s/v2/%s/manifests/%s" % (REGISTRY, REPO, ref), method="HEAD", headers={"Accept": ACCEPT})
    try:
        with NOPROXY.open(req, timeout=5) as r:
            return r.headers.get("Docker-Content-Digest")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise SystemExit("registry %s answered HTTP %d for %s" % (REGISTRY, e.code, ref))
    except OSError as e:
        raise SystemExit("registry %s unreachable (%s); run L20/setup.sh (it starts looped-l20-registry)" % (REGISTRY, e))


def local_repo_digests(image):
    code, out, _ = run(["docker", "image", "inspect", "-f", "{{json .RepoDigests}}", image], timeout=30)
    if code != 0:
        return None
    try:
        return json.loads(out) or []
    except ValueError:
        return []


def local_id(image):
    code, out, _ = run(["docker", "image", "inspect", "-f", "{{.Id}}", image], timeout=30)
    return out.strip() if code == 0 else None


def artifact_path(digest):
    return os.path.join(CI, "artifacts", digest.replace("sha256:", "") + ".json")


def verify_artifact(rec):
    """The three facts that make a promotion safe. Returns a list of problems (empty = verified)."""
    problems = []
    d = rec["digest"]
    if registry_digest(d) != d:
        problems.append("registry no longer serves %s" % d)
    tag = "sha-" + rec["commit"]
    at_tag = registry_digest(tag)
    if at_tag != d:
        problems.append("registry tag %s now points to %s, not the recorded %s (a mutable tag was re-pushed)" % (tag, at_tag, d))
    rd = local_repo_digests("%s:%s" % (LOCAL, tag))
    if rd is None:
        problems.append("local image %s:%s missing" % (LOCAL, tag))
    elif "%s/%s@%s" % (REGISTRY, REPO, d) not in rd:
        problems.append("local image %s:%s is not the published artifact (RepoDigests %s)" % (LOCAL, tag, rd))
    return problems


# ── stages ─────────────────────────────────────────────────────────────────

class Run:
    def __init__(self, commit):
        self.id = "run-%s-%s" % (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()), commit)
        self.dir = os.path.join(CI, "runs", self.id)
        os.makedirs(self.dir, exist_ok=True)
        self.summary = {"run_id": self.id, "commit": commit, "started": now(), "stages": [], "status": "running", "ci": "local-only (ci-local.sh)"}

    def stage(self, name, fn):
        say("── stage %s" % name)
        t0 = time.time()
        ok, detail = fn()
        st = {"name": name, "status": "passed" if ok else "failed", "seconds": round(time.time() - t0, 1), "detail": detail, "log": os.path.join(self.dir, name + ".log")}
        self.summary["stages"].append(st)
        say("   %s: %s" % (st["status"].upper(), detail))
        if not ok:
            self.summary.update(status="blocked", blocked_at=name)
            self.finish()
            say("GATE: blocked at %s — nothing was published or promoted from %s" % (name, self.summary["commit"]))
        return ok

    def log(self, name, text):
        with open(os.path.join(self.dir, name + ".log"), "w", encoding="utf-8") as fh:
            fh.write(text)

    def finish(self):
        self.summary["finished"] = now()
        if self.summary["status"] == "running":
            self.summary["status"] = "passed"
        dump(os.path.join(self.dir, "summary.json"), self.summary)


def release():
    rel = load(os.path.join(APP, "release.json"))
    if not rel:
        raise SystemExit("work/app/release.json missing or invalid")
    return rel


def cmd_run(a):
    code, out, err = git(APP, "rev-parse", "--short=12", "HEAD")
    if code != 0:
        raise SystemExit("work/app is not a git repository: %s" % err.strip())
    commit = out.strip()
    code, out, _ = git(APP, "status", "--porcelain")
    if out.strip():
        raise SystemExit("work/app has uncommitted changes; CI builds commits, not working trees. Commit (or stash) first:\n" + out)
    rel = release()
    r = Run(commit)
    image = "%s:sha-%s" % (LOCAL, commit)
    say("pipeline %s for commit %s (Beacon %s, schema %s–%s)" % (r.id, commit, rel["version"], rel["schema"]["min"], rel["schema"]["max"]))

    def test():
        code, out, err = run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-t", "."], cwd=APP, timeout=600,
                             env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
        r.log("test", out + err)
        m = re.search(r"Ran (\d+) tests?", out + err)
        n = int(m.group(1)) if m else 0
        tail = [ln for ln in (out + err).strip().splitlines() if ln.strip()][-1:] or [""]
        return code == 0 and n > 0, "%d tests, exit %d (%s)" % (n, code, tail[0][:120])

    def build():
        cmd = ["docker", "build", "--provenance=false", "--sbom=false", "-t", image,
               "--build-arg", "BEACON_VERSION=" + rel["version"], "--build-arg", "BEACON_COMMIT=" + commit,
               "--build-arg", "SCHEMA_MIN=%d" % rel["schema"]["min"], "--build-arg", "SCHEMA_MAX=%d" % rel["schema"]["max"], APP]
        code, out, err = run(cmd, timeout=900)
        r.log("build", out + err)
        return code == 0, "%s id %s" % (image, (local_id(image) or "?")[:19]) if code == 0 else "docker build exit %d: %s" % (code, err.strip()[-200:])

    def scan():
        tool = os.environ.get("LOOPED_SCAN", "stub")
        if tool == "trivy":
            code, out, err = run(["trivy", "image", "--exit-code", "1", "--severity", "CRITICAL", "--skip-db-update", "--offline-scan", image], timeout=900)
            r.log("scan", out + err)
            dump(os.path.join(r.dir, "scan.json"), {"tool": "trivy", "vulnerability_scan": True, "exit": code})
            return code == 0, "trivy (offline DB) exit %d" % code
        code, out, err = run([sys.executable, os.path.join(HERE, "scan_stub.py"), image, os.path.join(APP, "Dockerfile"), commit], timeout=120)
        r.log("scan", out + err)
        try:
            res = json.loads(out)
        except ValueError:
            res = {"tool": "stub", "vulnerability_scan": False, "error": (err or out).strip()[-200:], "findings": ["scan stub did not produce a report"]}
            code = code or 1
        dump(os.path.join(r.dir, "scan.json"), res)
        return code == 0, "SCAN STUB (policy checks only, NOT a vulnerability scan): %d finding(s)" % len(res.get("findings", []))

    def publish():
        refs = ["sha-" + commit, rel["version"]]
        log = ""
        for ref in refs:
            target = "%s/%s:%s" % (REGISTRY, REPO, ref)
            code, out, err = run(["docker", "tag", image, target], timeout=30)
            code2, out2, err2 = run(["docker", "push", target], timeout=600)
            log += out + err + out2 + err2
            if code or code2:
                r.log("publish", log)
                return False, "push %s failed: %s" % (target, (err2 or err).strip()[-200:])
        r.log("publish", log)
        digest = registry_digest("sha-" + commit)
        pushed = re.findall(r"digest: (sha256:[a-f0-9]{64})", log)
        if not digest or (pushed and pushed[0] != digest):
            return False, "digest capture failed (registry %s, push output %s)" % (digest, pushed[:1])
        rec = {"digest": digest, "repository": "%s/%s" % (REGISTRY, REPO), "local_image": image, "image_id": local_id(image),
               "tags_pushed": refs, "commit": commit, "version": rel["version"], "schema": rel["schema"],
               "migrations": rel.get("migrations", []), "run_id": r.id, "published": now()}
        dump(artifact_path(digest), rec)
        r.summary["artifact"] = rec
        return True, "%s/%s@%s (tags %s)" % (REGISTRY, REPO, digest, ", ".join(refs))

    for name, fn in (("test", test), ("build", build), ("scan", scan), ("publish", publish)):
        if not r.stage(name, fn):
            return 1
    if not a.no_promote:
        if not r.stage("promote-staging", lambda: promote_record("staging", r.summary["artifact"], source="ci:" + r.id, approver="pipeline (staging is automatic)")):
            return 1
    r.finish()
    say("PASS pipeline %s: artifact %s" % (r.id, r.summary["artifact"]["digest"]))
    return 0


# ── promotion, rollback, schema gate ───────────────────────────────────────

def env_dir(env):
    return os.path.join(GITOPS, "envs", env)


def schema_state(env):
    cm = load(os.path.join(env_dir(env), "schema.json"), {})
    data = cm.get("data", {})
    return int(data.get("current", "0") or 0), [m for m in (data.get("applied") or "").split(",") if m], cm


def schema_gate(env, rec):
    """(ok, new_current, applied, reason). Migrations only move forward."""
    current, applied, _ = schema_state(env)
    lo, hi = int(rec["schema"]["min"]), int(rec["schema"]["max"])
    new_current = max(current, hi)
    new_applied = list(applied) + [m for m in rec.get("migrations", []) if m not in applied]
    if not lo <= new_current <= hi:
        reason = ("artifact %s (%s) supports database schema %d–%d, but %s is at schema %d (%s applied); "
                  "migrations never run backwards, so this build would run against a schema it does not understand"
                  % (rec["version"], rec["digest"][:19], lo, hi, env, current, ", ".join(applied[-2:]) or "none"))
        return False, current, applied, reason
    return True, new_current, new_applied, "schema %d → %d within %d–%d" % (current, new_current, lo, hi)


def promote_record(env, rec, source, approver, kind="promotion"):
    problems = verify_artifact(rec)
    if problems:
        return False, "refused: " + "; ".join(problems)
    ok, new_current, new_applied, reason = schema_gate(env, rec)
    if not ok:
        return False, "refused by schema gate: " + reason
    d = env_dir(env)
    dep_path = os.path.join(d, "deployment.json")
    dep = load(dep_path)
    ident = {"looped.lab/digest": rec["digest"], "looped.lab/commit": rec["commit"], "looped.lab/version": rec["version"]}
    dep["metadata"].setdefault("annotations", {}).update(ident)
    dep["spec"]["template"]["metadata"].setdefault("annotations", {})["looped.lab/digest"] = rec["digest"]
    dep["spec"]["template"]["spec"]["containers"][0]["image"] = rec["local_image"]
    dump(dep_path, dep)
    _, _, cm = schema_state(env)
    cm["data"] = {"current": str(new_current), "applied": ",".join(new_applied)}
    dump(os.path.join(d, "schema.json"), cm)
    prom = {"env": env, "digest": rec["digest"], "image": rec["local_image"], "repository": rec["repository"], "commit": rec["commit"],
            "version": rec["version"], "schema": rec["schema"], "db_schema_after": new_current, "source": source,
            "approved_by": approver, "kind": kind, "promoted": now(), "run_id": rec.get("run_id")}
    dump(os.path.join(GITOPS, "promotions", env + ".json"), prom)
    git(GITOPS, "add", "-A")
    code, out, err = git(GITOPS, "-c", "user.name=looped-ci", "-c", "user.email=ci@corp.lab", "commit", "-q", "-m",
                         "%s %s: %s (Beacon %s, commit %s) — %s; approved by %s" % (kind, env, rec["digest"], rec["version"], rec["commit"], reason, approver))
    if code != 0:
        return False, "git commit in work/gitops failed: %s" % (err or out).strip()[:200]
    return True, "%s → %s (%s); gitops commit %s" % (rec["digest"][:19], env, reason, git(GITOPS, "rev-parse", "--short", "HEAD")[1].strip())


def find_artifact(ref):
    recs = []
    adir = os.path.join(CI, "artifacts")
    for f in sorted(os.listdir(adir)) if os.path.isdir(adir) else []:
        rec = load(os.path.join(adir, f))
        if rec and ref in (rec["digest"], rec["digest"].replace("sha256:", ""), rec["version"], rec["run_id"], rec["commit"]):
            recs.append(rec)
    if not recs:
        raise SystemExit("no published artifact matches %r (see work/ci/artifacts/)" % ref)
    return sorted(recs, key=lambda x: x["published"])[-1]


def cmd_promote(a):
    env = a.env
    if env == "prod" and not a.approve:
        raise SystemExit("prod promotion needs an explicit approval: --approve '<your name>' (the hosted workflow uses a protected environment)")
    if a.tag:
        d = registry_digest(a.tag)
        staging = load(os.path.join(GITOPS, "promotions", "staging.json"), {})
        say("tag %s resolves to %s in the registry; staging verified %s" % (a.tag, d, staging.get("digest")))
        if env == "prod" and d != staging.get("digest"):
            refuse("promote", env, "tag %s now resolves to %s, which is not the digest staging verified (%s). "
                   "Promote by record (--from staging), never by a mutable tag." % (a.tag, d, staging.get("digest")))
            return 3
        rec = find_artifact(d) if d else None
        if not rec:
            refuse("promote", env, "tag %s resolves to %s, which no CI run published" % (a.tag, d))
            return 3
        source = "tag:" + a.tag
    else:
        src = a.from_env or ("staging" if env == "prod" else None)
        if not src:
            raise SystemExit("say what to promote: --from staging, or run the pipeline (staging is promoted by `run`)")
        prom = load(os.path.join(GITOPS, "promotions", src + ".json"))
        if not prom:
            raise SystemExit("no promotion record for %s" % src)
        rec = load(artifact_path(prom["digest"]))
        if not rec:
            raise SystemExit("artifact record for %s missing" % prom["digest"])
        source = "record:" + src
    ok, detail = promote_record(env, rec, source=source, approver=a.approve or "pipeline")
    if not ok:
        refuse("promote", env, detail)
        return 3
    say("PASS promote: " + detail)
    return 0


def refuse(kind, env, reason, target=None):
    rec = {"kind": kind, "env": env, "target": target, "result": "refused", "reason": reason, "at": now()}
    dump(os.path.join(CI, "decisions", "%s-%s-%s.json" % (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()), kind, env)), rec)
    say("REFUSED %s %s: %s" % (kind, env, reason))


def cmd_rollback(a):
    rec = find_artifact(a.to)
    cur = load(os.path.join(GITOPS, "promotions", a.env + ".json"), {})
    say("rollback %s: from %s (Beacon %s) to %s (Beacon %s)" % (a.env, cur.get("digest", "?")[:19], cur.get("version"), rec["digest"][:19], rec["version"]))
    if a.env == "prod" and not a.approve:
        raise SystemExit("prod rollback needs --approve '<your name>'")
    ok, detail = promote_record(a.env, rec, source="rollback-from:" + str(cur.get("digest")), approver=a.approve or "pipeline", kind="rollback")
    if not ok:
        refuse("rollback", a.env, detail, target=rec["digest"])
        return 3
    dump(os.path.join(CI, "decisions", "%s-rollback-%s.json" % (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()), a.env)),
         {"kind": "rollback", "env": a.env, "target": rec["digest"], "result": "applied", "reason": detail, "at": now()})
    say("PASS rollback: " + detail)
    return 0


def cmd_verify_tag(a):
    d = registry_digest(a.tag)
    say("registry %s/%s:%s → %s" % (REGISTRY, REPO, a.tag, d))
    bad = 0
    known = load(artifact_path(d)) if d else None
    if not known:
        bad += 1
        say("  NOT a CI-published artifact: no pipeline run recorded %s (a tag was pushed outside the pipeline)" % d)
    else:
        say("  published by %s (Beacon %s, commit %s)" % (known["run_id"], known["version"], known["commit"]))
    for env in ("staging", "prod"):
        prom = load(os.path.join(GITOPS, "promotions", env + ".json"))
        if prom:
            same = prom["digest"] == d
            say("  %s runs %s (Beacon %s): %s" % (env, prom["digest"], prom["version"], "same artifact" if same else "DIFFERENT artifact"))
            rec = load(artifact_path(prom["digest"]))
            for p in verify_artifact(rec) if rec else ["no artifact record"]:
                bad += 1
                say("  MISMATCH %s: %s" % (env, p))
    return 1 if bad else 0


def cmd_status(_a):
    for env in ("staging", "prod"):
        prom = load(os.path.join(GITOPS, "promotions", env + ".json"))
        cur, applied, _ = schema_state(env)
        say("%-8s %s" % (env, "%s Beacon %s commit %s (schema %d; approved by %s)" % (prom["digest"], prom["version"], prom["commit"], cur, prom["approved_by"]) if prom else "nothing promoted"))
    rdir = os.path.join(CI, "runs")
    for rid in sorted(os.listdir(rdir))[-5:] if os.path.isdir(rdir) else []:
        s = load(os.path.join(rdir, rid, "summary.json"), {})
        say("%s %s%s" % (rid, s.get("status"), " at " + s["blocked_at"] if s.get("blocked_at") else ""))
    return 0


def main():
    ap = argparse.ArgumentParser(description="L20 local pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run")
    p.add_argument("--no-promote", action="store_true")
    p = sub.add_parser("promote")
    p.add_argument("env", choices=["staging", "prod"])
    p.add_argument("--from", dest="from_env", choices=["staging"])
    p.add_argument("--tag")
    p.add_argument("--approve")
    p = sub.add_parser("rollback")
    p.add_argument("env", choices=["staging", "prod"])
    p.add_argument("--to", required=True)
    p.add_argument("--approve")
    p = sub.add_parser("verify-tag")
    p.add_argument("tag")
    sub.add_parser("status")
    a = ap.parse_args()
    for d in (APP, GITOPS):
        if not os.path.isdir(os.path.join(d, ".git")):
            raise SystemExit("%s is not prepared; run L20/setup.sh" % d)
    return {"run": cmd_run, "promote": cmd_promote, "rollback": cmd_rollback, "verify-tag": cmd_verify_tag, "status": cmd_status}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
