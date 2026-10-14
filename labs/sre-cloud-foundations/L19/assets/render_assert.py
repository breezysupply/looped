#!/usr/bin/env python3
"""Render assertions for the Beacon chart (L19).

Renders the chart with `helm template` for each environment and asserts the
contract a reviewer would otherwise check by eye: pinned image, probes with
the right paths, bounded resources, non-root and read-only security context,
selector/Service/port wiring, config per environment, a config checksum that
rolls pods, a disruption budget in prod, no Secret material. Then it proves
the schema is doing its job: every file under assets/invalid/ must be REFUSED.

    python3 render_assert.py CHART [--env dev|staging|prod|all] [-f EXTRA.yaml ...]
                                   [--invalid-dir DIR] [--json]

Exit 0 when every assertion holds, 1 otherwise. Needs helm and PyYAML
(setup.sh installs PyYAML 6.0.2 into L19/.venv when the system Python lacks it).
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys

try:
    import yaml  # PyYAML
except ImportError:  # pragma: no cover - reported, not hidden
    sys.stderr.write("render_assert.py needs PyYAML: run L19/setup.sh (creates L19/.venv) or `python3 -m pip install PyYAML==6.0.2`\n")
    sys.exit(2)

HERE = os.path.dirname(os.path.abspath(__file__))
RELEASE, NAMESPACE = "beacon", "beacon"
# the environment contract the chart must honour
EXPECT = {
    "dev": {"replicas": 1, "pdb": False, "admin": None},
    "staging": {"replicas": 2, "pdb": False, "admin": False},
    "prod": {"replicas": 3, "pdb": True, "admin": False},
}
PINNED_IMAGE = re.compile(r"^[a-z0-9][a-z0-9._/:-]*(:[0-9]+\.[0-9]+\.[0-9]+|@sha256:[a-f0-9]{64})$")
SECRETISH = re.compile(r"(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*[:=]\s*\S{6,}|Bearer [A-Za-z0-9._-]{20,})", re.I)

results = []


def check(env, cid, ok, observed):
    results.append({"env": env, "id": cid, "passed": bool(ok), "observed": str(observed)[:300]})
    return ok


def helm_template(chart, files):
    cmd = ["helm", "template", RELEASE, chart, "-n", NAMESPACE]
    for f in files:
        cmd += ["-f", f]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout, r.stderr


def env_files(chart, env, extra):
    files = []
    if env != "dev":
        files.append(os.path.join(chart, "values-%s.yaml" % env))
    return files + list(extra)


def by_kind(docs, kind):
    return [d for d in docs if d and d.get("kind") == kind]


def assert_env(chart, env, extra):
    code, out, err = helm_template(chart, env_files(chart, env, extra))
    if not check(env, "renders", code == 0, "helm template exit %d %s" % (code, err.strip().splitlines()[-1] if err.strip() else "")):
        return
    docs = [d for d in yaml.safe_load_all(out) if d]
    exp = EXPECT[env]
    deps, svcs, cms, pdbs = by_kind(docs, "Deployment"), by_kind(docs, "Service"), by_kind(docs, "ConfigMap"), by_kind(docs, "PodDisruptionBudget")
    check(env, "api-versions", all(d["apiVersion"] == "apps/v1" for d in deps) and all(p["apiVersion"] == "policy/v1" for p in pdbs),
          sorted({d["kind"] + "=" + d["apiVersion"] for d in docs}))
    check(env, "objects", len(deps) == 1 and len(svcs) == 1 and len(cms) == 1, "deployments=%d services=%d configmaps=%d" % (len(deps), len(svcs), len(cms)))
    check(env, "namespace", all(d.get("metadata", {}).get("namespace") == NAMESPACE for d in docs), sorted({str(d.get("metadata", {}).get("namespace")) for d in docs}))
    check(env, "no-secret-objects", not by_kind(docs, "Secret") and not SECRETISH.search(out), "Secret objects=%d, secret-like strings=%s" % (len(by_kind(docs, "Secret")), bool(SECRETISH.search(out))))
    if not deps or not svcs or not cms:
        return
    dep, svc, cm = deps[0], svcs[0], cms[0]
    spec = dep["spec"]
    pod = spec["template"]
    c = pod["spec"]["containers"][0]
    check(env, "replicas", spec.get("replicas") == exp["replicas"], "replicas=%s (contract %s)" % (spec.get("replicas"), exp["replicas"]))
    check(env, "image-pinned", bool(PINNED_IMAGE.match(c.get("image", ""))), c.get("image"))
    res = c.get("resources", {})
    req, lim = res.get("requests", {}), res.get("limits", {})
    check(env, "resources-bounded", bool(req.get("cpu")) and bool(req.get("memory")) and bool(lim.get("memory")), "requests=%s limits=%s" % (req, lim))
    rp, lp, sp = c.get("readinessProbe", {}), c.get("livenessProbe", {}), c.get("startupProbe", {})
    rpath, lpath = rp.get("httpGet", {}).get("path"), lp.get("httpGet", {}).get("path")
    check(env, "probes", rpath == "/ready" and lpath == "/healthz" and bool(sp), "readiness=%s liveness=%s startup=%s" % (rpath, lpath, bool(sp)))
    psc, csc = pod["spec"].get("securityContext", {}), c.get("securityContext", {})
    check(env, "non-root", psc.get("runAsNonRoot") is True and csc.get("allowPrivilegeEscalation") is False and csc.get("readOnlyRootFilesystem") is True and "ALL" in csc.get("capabilities", {}).get("drop", []),
          "pod=%s container=%s" % (psc, csc))
    sel = spec["selector"]["matchLabels"]
    plabels = pod["metadata"].get("labels", {})
    check(env, "selector-matches-pods", all(plabels.get(k) == v for k, v in sel.items()), "selector=%s" % sel)
    check(env, "service-selects-pods", all(plabels.get(k) == v for k, v in svc["spec"].get("selector", {}).items()) and bool(svc["spec"].get("selector")), "service selector=%s" % svc["spec"].get("selector"))
    ports = {p.get("name"): p.get("containerPort") for p in c.get("ports", [])}
    tps = [p.get("targetPort") for p in svc["spec"].get("ports", [])]
    check(env, "service-target-port", all(tp in ports or tp in ports.values() for tp in tps), "targetPorts=%s containerPorts=%s" % (tps, ports))
    conf = cm.get("data", {}).get("beacon.yaml", "")
    env_ok = re.search(r"^\s*environment:\s*%s\s*$" % env, conf, re.M) is not None
    admin = re.search(r"^\s*admin_enabled:\s*(\S+)", conf, re.M)
    admin_ok = exp["admin"] is None or (admin is not None and admin.group(1) == str(exp["admin"]).lower())
    check(env, "config-per-env", env_ok and admin_ok, "environment=%s admin_enabled=%s" % (env_ok and env, admin.group(1) if admin else None))
    ann = pod["metadata"].get("annotations", {}).get("checksum/config", "")
    check(env, "config-checksum", bool(re.fullmatch(r"[a-f0-9]{64}", ann)), "checksum/config=%s" % (ann[:16] + "..." if ann else "missing"))
    mounts = [m.get("mountPath") for m in c.get("volumeMounts", [])]
    envs = {e.get("name"): e.get("value") for e in c.get("env", [])}
    check(env, "config-mounted", "/etc/beacon" in mounts and envs.get("BEACON_CONFIG") == "/etc/beacon/beacon.yaml", "mounts=%s BEACON_CONFIG=%s" % (mounts, envs.get("BEACON_CONFIG")))
    ru = spec.get("strategy", {}).get("rollingUpdate", {})
    check(env, "rollout-keeps-capacity", ru.get("maxUnavailable") in (0, "0", "0%"), "maxUnavailable=%s" % ru.get("maxUnavailable"))
    if exp["pdb"]:
        ok = len(pdbs) == 1 and 0 < int(pdbs[0]["spec"].get("minAvailable", 0)) < int(spec.get("replicas", 0))
        check(env, "pdb", ok, "pdbs=%d minAvailable=%s replicas=%s" % (len(pdbs), pdbs[0]["spec"].get("minAvailable") if pdbs else None, spec.get("replicas")))
    else:
        check(env, "pdb", not pdbs, "pdbs=%d (none expected)" % len(pdbs))


def assert_invalid(chart, inv_dir):
    files = sorted(f for f in os.listdir(inv_dir) if f.endswith(".yaml")) if os.path.isdir(inv_dir) else []
    check("schema", "invalid-fixtures-present", len(files) >= 3, "%d fixtures in %s" % (len(files), inv_dir))
    for f in files:
        path = os.path.join(inv_dir, f)
        code, _, err = helm_template(chart, [path])
        refused = code != 0 and "schema" in err
        last = [ln for ln in err.strip().splitlines() if ln.strip()][-1:] if err.strip() else ["(rendered without error)"]
        check("schema", "refuses-" + f[:-5], refused, "exit %d: %s" % (code, last[0]))


def chart_meta(chart):
    try:
        with open(os.path.join(chart, "Chart.yaml"), "r", encoding="utf-8") as fh:
            meta = yaml.safe_load(fh)
    except (OSError, yaml.YAMLError) as e:
        check("chart", "chart-yaml", False, e)
        return
    ver, app = str(meta.get("version", "")), str(meta.get("appVersion", ""))
    check("chart", "chart-yaml", meta.get("apiVersion") == "v2" and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", ver) is not None and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", app) is not None,
          "apiVersion=%s version=%s appVersion=%s" % (meta.get("apiVersion"), ver, app))
    schema = os.path.join(chart, "values.schema.json")
    try:
        with open(schema, "rb") as fh:
            raw = fh.read()
        json.loads(raw)
        check("chart", "schema-present", True, "values.schema.json sha256 %s" % hashlib.sha256(raw).hexdigest()[:16])
    except (OSError, ValueError) as e:
        check("chart", "schema-present", False, e)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("chart")
    ap.add_argument("--env", default="all", choices=["dev", "staging", "prod", "all"])
    ap.add_argument("-f", "--values", action="append", default=[], help="extra values file applied after the environment file")
    ap.add_argument("--invalid-dir", default=os.path.join(HERE, "invalid"))
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    chart = os.path.abspath(a.chart)
    chart_meta(chart)
    for env in (["dev", "staging", "prod"] if a.env == "all" else [a.env]):
        assert_env(chart, env, a.values)
    assert_invalid(chart, a.invalid_dir)
    failed = [r for r in results if not r["passed"]]
    if a.json:
        print(json.dumps({"passed": not failed, "total": len(results), "failed": len(failed), "results": results}, indent=1))
    else:
        for r in results:
            print("%s [%s] %s: %s" % ("PASS" if r["passed"] else "FAIL", r["env"], r["id"], r["observed"]))
        print("%s render assertions: %d/%d passed" % ("PASS" if not failed else "FAIL", len(results) - len(failed), len(results)))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
