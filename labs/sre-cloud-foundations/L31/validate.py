#!/usr/bin/env python3
"""L31 validator: is the core Beacon deployment rebuildable from checked-in artifacts, and is the
rebuild in front of us healthy, least-privileged, seeded, observable and reversible?

Checks (critical unless noted):
  dry-check          rebuild.sh check passes here: config valid, no hidden prerequisite, pins,
                     every prerequisite artifact present and not git-ignored
  fresh-checkout     the same check passes in a temporary copy of only the non-ignored files of
                     labs/sre-cloud-foundations, with an empty environment (env -i)
  refuses-unknown    with an unknown L31_* variable set, rebuild.sh refuses to run
  runbook            release/REBUILD.md: every section with substance, names the namespace
  slo-tests          promtool check rules + test rules on the release's SLO files (Docker)
  cluster ...        live checks through capstone.py (namespace, health, image-identity,
                     least-privilege, network-policies, seeded-data, metrics, rollback)
  restore-proof      work/proof/restore.json from L24's verify_restore.py says ok
  rebuild-proof      work/proof/runs.jsonl shows all -> down -> all, each successful
Without a reachable cluster the live checks FAIL with the reason: a rebuild that did not run
cannot pass. Exit 1 if any critical check fails.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

sys.path.insert(0, os.path.join(HERE, "assets"))
import capstone as C  # noqa: E402

SECTIONS = ["Scope", "Prerequisites", "Configuration", "Build", "Deploy", "Seed data", "Verify",
            "Backup and restore", "Rollback", "Teardown", "Rebuild proof", "Limits"]
SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/homebrew/bin"


def fresh_copy(tmp):
    """Copy the non-ignored files of labs/sre-cloud-foundations (what a fresh clone would have)."""
    sub = "labs/sre-cloud-foundations"
    code, out, err = L.sh(["git", "-C", C.REPO, "ls-files", "-co", "--exclude-standard", "-z", "--", sub], timeout=60)
    if code != 0:
        return None, f"git ls-files failed: {err.strip()[:100]}"
    n = 0
    for rel in out.split("\0"):
        if not rel or not os.path.isfile(os.path.join(C.REPO, rel)):
            continue
        dst = os.path.join(tmp, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(C.REPO, rel), dst)
        n += 1
    return n, ""


def run_check(root, extra_env=None):
    env = {"PATH": os.environ.get("PATH", SAFE_PATH), "HOME": root, "LANG": "C.UTF-8"}
    env.update(extra_env or {})
    try:
        r = subprocess.run(["bash", os.path.join(root, "labs", "sre-cloud-foundations", "L31", "rebuild.sh"), "check"],
                           capture_output=True, text=True, timeout=120, env=env, cwd=root)
        return r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired:
        return 124, "timed out"


def main():
    args = L.standard_args("L31")
    r = L.Report("L31", "kind-basic")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(C.WORK, ".variant")) or "").strip() or "unknown"
    if not args.variant:
        r.seed = variant
    rel = C.release_dir(None)

    rows = C.static_check(rel)
    bad = [f"{i}: {o}" for i, ok, o in rows if not ok]
    r.check("dry-check", not bad, "; ".join(o for _, _, o in rows[:3]) if not bad else "; ".join(bad)[:500])
    try:
        cfg = C.load_env(rel)
    except C.ConfigError:
        cfg = None

    tmp = tempfile.mkdtemp(prefix="looped-l31-fresh-")
    try:
        n, why = fresh_copy(tmp)
        if n is None:
            r.check("fresh-checkout", False, why)
        else:
            code, out = run_check(tmp)
            fails = [ln for ln in out.splitlines() if ln.startswith("FAIL")]
            r.check("fresh-checkout", code == 0, f"{n} non-ignored files copied; rebuild.sh check with an empty environment exited {code}" + (f": {'; '.join(fails)[:300]}" if fails else ""))
            code2, out2 = run_check(tmp, {"L31_SKIP_BUILD": "1"})
            r.check("refuses-unknown", code2 != 0 and "unknown" in out2.lower(), f"with L31_SKIP_BUILD=1 set: exit {code2}, {'refused' if 'unknown' in out2.lower() else 'not refused'}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    doc = L.read_text(os.path.join(rel, "REBUILD.md"), 200000) or ""
    tmpl = L.read_text(os.path.join(HERE, "assets", "release-template", "REBUILD.md"), 200000) or ""
    tl = {ln.strip() for ln in tmpl.splitlines() if ln.strip()}
    thin = []
    for s in SECTIONS:
        m = re.search(r"^##\s+" + re.escape(s) + r"\s*$(.*?)(?=^##\s|\Z)", doc, re.M | re.S | re.I)
        body = "\n".join(ln for ln in (m.group(1).splitlines() if m else []) if ln.strip() and ln.strip() not in tl)
        if len(body) < 80 or "[" in body.strip()[:1]:
            thin.append(s)
    names_ns = bool(cfg) and cfg["NAMESPACE"] in doc and "rebuild.sh" in doc
    r.check("runbook", not thin and names_ns and not L.contains_secret(doc) and "not-a-real-secret" not in doc,
            f"sections missing/thin: {thin or 'none'}; names namespace and rebuild.sh: {names_ns}")

    if cfg and shutil.which("docker") and L.sh(["docker", "info"], timeout=20)[0] == 0:
        d = os.path.join(C.REPO, cfg["SLO_DIR"])
        c1, o1, e1 = L.sh(["docker", "run", "--rm", "--network", "none", "-v", f"{d}:/w:ro", "--entrypoint", "promtool", cfg["PROMTOOL_IMAGE"], "check", "rules", "/w/rules/beacon-slo.rules.yml"], timeout=180)
        c2, o2, e2 = L.sh(["docker", "run", "--rm", "--network", "none", "-v", f"{d}:/w:ro", "--entrypoint", "promtool", cfg["PROMTOOL_IMAGE"], "test", "rules", "/w/tests/beacon-slo.test.yml"], timeout=180)
        last = ((o2 + e2).strip().splitlines() or [""])[-1]
        r.check("slo-tests", c1 == 0 and c2 == 0, f"promtool check rules exit {c1}; test rules exit {c2}: {last[:120]}")
    else:
        r.check("slo-tests", False, "Docker not reachable (or rebuild.env invalid): promtool could not run")

    if cfg:
        for cid, ok, obs in C.live_checks(cfg, rel):
            r.check(cid, ok, obs)
    for cid, ok, obs in C.proof_checks():
        r.check(cid, ok, obs)
    extra = {"variant_file": variant}
    if cfg:
        extra.update({"namespace": cfg["NAMESPACE"], "cluster": cfg["CLUSTER"], "environment_values": cfg["ENVIRONMENT"]})
    return r.finish(args.out, args.explanation, extra)


if __name__ == "__main__":
    sys.exit(main())
