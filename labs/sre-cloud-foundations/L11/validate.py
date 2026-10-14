#!/usr/bin/env python3
"""L11 validator: runs terraform in this lab's workspace (work/) and checks
the generated file on disk. Local providers only; never touches anything
outside work/ (plans are read-only: no -out, no apply).

Checks (all critical):
  workspace-local    work/ has local state only (no backend/cloud block), state file inside work/
  lockfile-pinned    work/.terraform.lock.hcl is the committed one (local 2.9.1, random 3.9.1)
  fmt                terraform fmt -check -recursive
  tf-validate        terraform validate
  tf-test            terraform test passes; 5+ runs, 3+ expect_failures, one of them for the sqlite path rule
  input-validation   plans with listen_port=80, environment=prod, and store_kind=sqlite without store_path are REFUSED
  no-change-plan     terraform plan -detailed-exitcode exits 0 with the workspace's own tfvars
  generated-config   out/dev/beacon.yaml exists, Beacon accepts it, its sha256 matches the config_sha256 output
  deploy-id-stable   deploy_id output equals the baseline recorded by setup.sh (nothing was needlessly replaced)
  graph-evidence     evidence/L11-graph.dot is a `terraform graph` of this config (manifest depends on config and random id)
  notes              evidence/L11-notes.md: Configuration / State / Real object / Plan prediction sections with substance
Exit 1 if any check fails. Writes the evidence JSON.
"""
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
BEACON = os.path.join(L.ROOT, "beacon")
TF_ENV = dict(os.environ, TF_IN_AUTOMATION="1", TF_INPUT="0", NO_COLOR="1")
REMOTE = re.compile(r'backend\s+"(s3|azurerm|gcs|remote|http|consul|pg|kubernetes|oss|cos)"|^\s*cloud\s*\{', re.M)


def tf(*args, timeout=180):
    return L.sh(["terraform", "-chdir=" + WORK] + list(args), timeout=timeout, env=TF_ENV)


def sha_file(p):
    try:
        with open(p, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except OSError:
        return None


def last_lines(text, n=3):
    lines = [x for x in text.strip().splitlines() if x.strip()]
    return " | ".join(lines[-n:])[:300]


def refused(code, out, err):
    return code != 0 and "Invalid value for variable" in (out + err)


def main():
    args = L.standard_args("L11")
    r = L.Report("L11", "workstation")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(WORK, ".variant")) or "").strip() or "unknown"
    if not args.variant:
        r.seed = variant

    if not os.path.isdir(WORK):
        r.check("workspace-local", False, "work/ missing: run setup.sh")
        return r.finish(args.out, args.explanation)

    tf_src = ""
    for root, _, files in os.walk(WORK):
        if ".terraform" in root:
            continue
        for f in files:
            if f.endswith(".tf"):
                tf_src += L.read_text(os.path.join(root, f)) or ""
    state = os.path.join(WORK, "terraform.tfstate")
    remote = REMOTE.search(tf_src)
    r.check("workspace-local", not remote and os.path.exists(state),
            ("remote backend/cloud block found: " + remote.group(0)) if remote else ("local state at work/terraform.tfstate" if os.path.exists(state) else "no work/terraform.tfstate (did setup.sh apply?)"))

    lock_w = sha_file(os.path.join(WORK, ".terraform.lock.hcl"))
    lock_s = sha_file(os.path.join(HERE, "starter", ".terraform.lock.hcl"))
    lock_txt = L.read_text(os.path.join(WORK, ".terraform.lock.hcl")) or ""
    pinned = 'hashicorp/local" {\n  version     = "2.9.1"' in lock_txt and 'hashicorp/random" {\n  version     = "3.9.1"' in lock_txt
    r.check("lockfile-pinned", lock_w is not None and lock_w == lock_s and pinned,
            "lockfile identical to the committed one (local 2.9.1, random 3.9.1)" if lock_w == lock_s and pinned else "lockfile differs from starter/.terraform.lock.hcl or does not pin local 2.9.1 / random 3.9.1")

    code, out, err = tf("fmt", "-check", "-recursive")
    r.check("fmt", code == 0, "terraform fmt -check clean" if code == 0 else "needs formatting: " + (out + err).strip().replace("\n", ", ")[:200])

    code, out, err = tf("validate", "-no-color")
    r.check("tf-validate", code == 0, last_lines(out + err, 2))

    code, out, err = tf("test", "-no-color", timeout=300)
    tests_src = ""
    tdir = os.path.join(WORK, "tests")
    if os.path.isdir(tdir):
        for f in sorted(os.listdir(tdir)):
            if f.endswith(".tftest.hcl"):
                tests_src += L.read_text(os.path.join(tdir, f)) or ""
    runs = len(re.findall(r'^\s*run\s+"', tests_src, re.M))
    expects = re.findall(r"expect_failures\s*=\s*\[([^\]]*)\]", tests_src)
    path_rule = any(("var.store_path" in e or "var.store_kind" in e) for e in expects)
    summary = re.search(r"(\d+) passed, (\d+) failed", out + err)
    t_ok = code == 0 and summary and summary.group(2) == "0" and runs >= 5 and len(expects) >= 3 and path_rule
    r.check("tf-test", bool(t_ok), f"{summary.group(0) if summary else 'no summary'}; runs={runs} expect_failures={len(expects)} store-path test={'yes' if path_rule else 'no'}" + ("" if code == 0 else "; " + last_lines(out + err, 2)))

    # every variable pinned to a known-good value, then ONE bad input, so a
    # refusal can only come from the rule under test
    good = ["-var", "environment=dev", "-var", "listen_port=8080", "-var", "app_version=1.4.0",
            "-var", "store_kind=sqlite", "-var", "store_path=/var/lib/beacon/beacon.db", "-var", "admin_enabled=false"]
    probes = [
        ("listen_port=80", ["-var", "listen_port=80"], ("var.listen_port",)),
        ("environment=prod", ["-var", "environment=prod"], ("var.environment",)),
        ("store_kind=sqlite without store_path", ["-var", "store_kind=sqlite", "-var", "store_path="], ("var.store_path", "var.store_kind")),
    ]
    c, o, e = tf("plan", "-input=false", "-no-color", "-refresh=false", "-lock=false", *good)
    let_through = [] if c == 0 else ["known-good inputs are refused too: " + last_lines(o + e, 1)[:100]]
    for label, extra, names in probes:
        c, o, e = tf("plan", "-input=false", "-no-color", "-refresh=false", "-lock=false", *(good + extra))
        if not (refused(c, o, e) and any(n in o + e for n in names)):
            let_through.append(label + (" (plan succeeded)" if c == 0 else " (failed for another reason: " + last_lines(o + e, 1)[:80] + ")"))
    r.check("input-validation", not let_through, "all three bad inputs refused at plan time by validation" if not let_through else "not refused by a validation rule: " + "; ".join(let_through))

    code, out, err = tf("plan", "-detailed-exitcode", "-input=false", "-no-color", timeout=240)
    if code == 0:
        obs = "No changes: configuration, state and files agree"
    else:
        acts = re.findall(r"#\s+(\S+)\s+(will be created|will be destroyed|must be replaced|will be updated in-place)", out)
        obs = f"exit {code}: " + ("; ".join(f"{a} {b}" for a, b in acts[:5]) or last_lines(out + err, 2))
    r.check("no-change-plan", code == 0, obs)

    outputs = {}
    c, o, _ = tf("output", "-json")
    if c == 0:
        try:
            outputs = {k: v.get("value") for k, v in json.loads(o).items()}
        except ValueError:
            outputs = {}
    cfg = os.path.join(WORK, "out", "dev", "beacon.yaml")
    g_obs, g_ok = "out/dev/beacon.yaml missing", False
    if os.path.exists(cfg):
        c, o, e = L.sh(["python3", "-m", "beacon", "validate-config", "--config", cfg], env=dict(os.environ, PYTHONPATH=BEACON))
        file_sha = sha_file(cfg)
        same = file_sha == outputs.get("config_sha256")
        g_ok = c == 0 and same
        g_obs = ("Beacon accepts it" if c == 0 else "Beacon rejects it: " + (e or o).strip()[:120]) + ("; sha256 matches output" if same else f"; sha256 {str(file_sha)[:12]} != output {str(outputs.get('config_sha256'))[:12]}")
    r.check("generated-config", g_ok, g_obs)

    base = {}
    try:
        with open(os.path.join(WORK, ".l11-baseline.json"), "r", encoding="utf-8") as fh:
            base = json.load(fh)
    except (OSError, ValueError):
        pass
    r.check("deploy-id-stable", bool(base) and outputs.get("deploy_id") == base.get("deploy_id"),
            f"deploy_id {outputs.get('deploy_id')} (baseline {base.get('deploy_id', 'missing')})")

    dot = L.read_text(os.path.join(EV, "L11-graph.dot")) or ""
    edges = ('"local_file.manifest" -> "local_file.config"' in dot) and ('"local_file.manifest" -> "random_id.deploy"' in dot)
    r.check("graph-evidence", dot.startswith("digraph") and edges, "graph saved with manifest -> config and manifest -> random_id edges" if edges else "evidence/L11-graph.dot missing or not this configuration's graph (terraform graph > evidence/L11-graph.dot)")

    notes = L.read_text(os.path.join(EV, "L11-notes.md")) or ""
    heads = {h: bool(re.search(r"^#+\s*" + h, notes, re.I | re.M)) for h in ("Configuration", "State", "Real object", "Plan prediction")}
    body = re.sub(r"^#.*$|^>.*$", "", notes, flags=re.M).strip()
    r.check("notes", all(heads.values()) and len(body) >= 500, f"sections={heads} chars={len(body)}")

    return r.finish(args.out, args.explanation or notes[:4000], {"variant_file": variant, "workspace": "labs/sre-cloud-foundations/L11/work"})


if __name__ == "__main__":
    sys.exit(main())
