#!/usr/bin/env python3
"""L19 validator: queries Helm and the kind cluster looped-foundations (namespace
beacon) and re-runs the chart checks on work/chart. Read-only: helm lint/template/
status/history/get, kubectl get/exec (a GET inside a Beacon pod).

Checks (critical unless marked):
  cluster            context kind-looped-foundations is a local kind cluster
  chart-lint         helm lint work/chart passes with staging and prod values
  render-assertions  assets/render_assert.py work/chart: every environment contract holds and
                     every assets/invalid/ fixture is refused by the schema
  change-corrected   work/change/values-1.5.0.yaml renders on top of staging values, names
                     looped-l19-beacon:1.5.0, and still passes the staging contract
  release-deployed   helm status beacon: deployed, chart beacon-<version>, this lab's release
  rollback-in-history  helm history has a "Rollback to N" revision (the drill or the recovery)
  current-values     the deployed revision's values pin image tag 1.5.0 on staging values
  rollout            Deployment beacon: 2/2 ready and updated, every pod runs looped-l19-beacon:1.5.0,
                     no pod waiting on an image pull
  smoke              from inside a Beacon pod: GET http://beacon:8080/ready = 200 and /version
                     reports 1.5.0 / staging (through the Service, so selector and port are right)
  notes              evidence/L19-notes.md: Render, Change, Rollback sections with substance
  chart-version (advisory)  if work/chart differs from chart/, Chart.yaml version was bumped
Exit 1 if a critical check fails. Writes the evidence JSON.
"""
import filecmp
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
CHART = os.path.join(WORK, "chart")
REF_CHART = os.path.join(HERE, "chart")
CHANGE = os.path.join(WORK, "change", "values-1.5.0.yaml")
NOTES = os.path.join(HERE, "evidence", "L19-notes.md")
CTX = "kind-looped-foundations"
RELEASE = "beacon"
IMAGE = "looped-l19-beacon"
WANT_TAG = "1.5.0"


def helm(*args, timeout=120):
    return L.sh(["helm", "--kube-context", CTX, "-n", L.NAMESPACE] + list(args), timeout=timeout)


def yaml_python():
    code, _, _ = L.sh([sys.executable, "-c", "import yaml"])
    if code == 0:
        return sys.executable
    venv = os.path.join(HERE, ".venv", "bin", "python")
    return venv if os.path.exists(venv) else None


def chart_differs():
    """True if work/chart differs from the reference chart in any file."""
    def walk(a, b):
        cmp = filecmp.dircmp(a, b)
        if cmp.left_only or cmp.right_only or cmp.diff_files or cmp.funny_files:
            return True
        return any(walk(os.path.join(a, d), os.path.join(b, d)) for d in cmp.common_dirs)
    return walk(CHART, REF_CHART)


def chart_version(path):
    txt = L.read_text(os.path.join(path, "Chart.yaml")) or ""
    m = re.search(r"^version:\s*\"?([^\s\"]+)", txt, re.M)
    return m.group(1) if m else None


def main():
    args = L.standard_args("L19")
    r = L.Report("L19", "kind-basic")
    L.apply_args(r, args)
    ok, why = L.require_kube_context(CTX)
    if not r.check("cluster", ok, why):
        return r.finish(args.out, args.explanation)

    # ── chart quality on your working copy ─────────────────────────────
    if not os.path.isdir(CHART):
        r.check("chart-lint", False, "work/chart missing; run setup.sh")
    else:
        outs = []
        good = True
        for env in ("staging", "prod"):
            code, out, err = L.sh(["helm", "lint", CHART, "-f", os.path.join(CHART, "values-%s.yaml" % env)], timeout=60)
            good = good and code == 0
            last = (out + err).strip().splitlines()[-1:] or [""]
            outs.append("%s: exit %d %s" % (env, code, last[0]))
        r.check("chart-lint", good, "; ".join(outs))

    py = yaml_python()
    render_ok, render_obs = False, "PyYAML not importable (run setup.sh to create .venv)"
    if py and os.path.isdir(CHART):
        code, out, err = L.sh([py, os.path.join(HERE, "assets", "render_assert.py"), CHART, "--json"], timeout=300)
        try:
            res = json.loads(out)
            failed = [x for x in res["results"] if not x["passed"]]
            render_ok = res["passed"] and res["total"] >= 40
            render_obs = "%d/%d assertions passed%s" % (res["total"] - res["failed"], res["total"],
                                                      "; failing: " + ", ".join("%s/%s (%s)" % (x["env"], x["id"], x["observed"][:80]) for x in failed[:4]) if failed else "")
        except (ValueError, KeyError):
            render_obs = "render_assert.py exit %d: %s" % (code, (err or out).strip()[-200:])
    r.check("render-assertions", render_ok, render_obs)

    if os.path.exists(CHANGE) and py and os.path.isdir(CHART):
        code, out, err = L.sh([py, os.path.join(HERE, "assets", "render_assert.py"), CHART, "--env", "staging", "-f", CHANGE, "--json"], timeout=120)
        c2, rendered, err2 = L.sh(["helm", "template", RELEASE, CHART, "-n", L.NAMESPACE, "-f", os.path.join(CHART, "values-staging.yaml"), "-f", CHANGE, "--show-only", "templates/deployment.yaml"], timeout=60)
        img = re.search(r"^\s*image:\s*\"?([^\"\s]+)", rendered, re.M)
        img = img.group(1) if img else (err2.strip().splitlines()[-1] if err2.strip() else "no image")
        try:
            staging_ok = json.loads(out)["passed"]
        except (ValueError, KeyError):
            staging_ok = False
        r.check("change-corrected", c2 == 0 and staging_ok and img == "%s:%s" % (IMAGE, WANT_TAG), "renders=%s staging-contract=%s image=%s" % (c2 == 0, staging_ok, img))
    else:
        r.check("change-corrected", False, "work/change/values-1.5.0.yaml missing or no PyYAML")

    # ── the release ─────────────────────────────────────────────────────
    code, out, err = helm("status", RELEASE, "-o", "json")
    status = {}
    if code == 0:
        try:
            status = json.loads(out)
        except ValueError:
            status = {}
    info = status.get("info", {})
    chart_meta = status.get("chart", {}).get("metadata", {})
    cfg = status.get("config", {}) or {}
    ours = (cfg.get("commonLabels") or {}).get("looped.lab/id", "L19") == "L19"
    r.check("release-deployed", info.get("status") == "deployed" and chart_meta.get("name") == "beacon" and ours,
            "status=%s chart=%s-%s revision=%s%s" % (info.get("status"), chart_meta.get("name"), chart_meta.get("version"), status.get("version"),
                                                    "" if code == 0 else " (" + err.strip()[:120] + ")"))

    code, out, _ = helm("history", RELEASE, "-o", "json", "--max", "50")
    hist = []
    if code == 0:
        try:
            hist = json.loads(out)
        except ValueError:
            hist = []
    rollbacks = [h for h in hist if str(h.get("description", "")).startswith("Rollback to")]
    summary = ", ".join("%s:%s:%s" % (h.get("revision"), h.get("status"), str(h.get("description", ""))[:28]) for h in hist[-6:])
    r.check("rollback-in-history", bool(rollbacks), "%d revisions, %d rollback(s): %s" % (len(hist), len(rollbacks), summary or "no history"))

    code, out, _ = helm("get", "values", RELEASE, "--all", "-o", "json")
    vals = {}
    if code == 0:
        try:
            vals = json.loads(out)
        except ValueError:
            vals = {}
    img = vals.get("image", {}) or {}
    envname = (vals.get("config", {}) or {}).get("environment")
    r.check("current-values", img.get("repository") == IMAGE and img.get("tag") == WANT_TAG and envname == "staging" and vals.get("replicaCount") == 2,
            "image=%s:%s environment=%s replicaCount=%s" % (img.get("repository"), img.get("tag"), envname, vals.get("replicaCount")))

    dep = L.kget(CTX, ["get", "deployment", RELEASE]) or {}
    st = dep.get("status", {})
    pods = (L.kget(CTX, ["get", "pods", "-l", "app.kubernetes.io/instance=%s,app.kubernetes.io/name=beacon" % RELEASE]) or {}).get("items", [])
    pods = [p for p in pods if not p["metadata"].get("labels", {}).get("looped.lab/role") == "helm-test"]
    images = sorted({c.get("image") for p in pods for c in p["spec"].get("containers", [])})
    waiting = sorted({cs.get("state", {}).get("waiting", {}).get("reason") for p in pods for cs in p.get("status", {}).get("containerStatuses", []) or [] if cs.get("state", {}).get("waiting")})
    want = dep.get("spec", {}).get("replicas")
    r.check("rollout", bool(dep) and want == 2 and st.get("readyReplicas") == 2 and st.get("updatedReplicas") == 2 and images == ["%s:%s" % (IMAGE, WANT_TAG)] and not waiting,
            "replicas=%s ready=%s updated=%s pod images=%s waiting=%s" % (want, st.get("readyReplicas"), st.get("updatedReplicas"), images, waiting or "none"))

    smoke = ("import json,urllib.request\n"
             "b='http://%s:8080'\n"
             "r=urllib.request.urlopen(b+'/ready',timeout=5).status\n"
             "v=json.loads(urllib.request.urlopen(b+'/version',timeout=5).read())\n"
             "print(json.dumps({'ready':r,'version':v.get('version'),'environment':v.get('environment')}))" % RELEASE)
    code, out, err = L.kubectl(CTX, ["exec", "deploy/" + RELEASE, "-c", "api", "--", "python3", "-c", smoke], timeout=40)
    try:
        sm = json.loads(out.strip().splitlines()[-1])
    except (ValueError, IndexError):
        sm = {}
    r.check("smoke", sm.get("ready") == 200 and sm.get("version") == WANT_TAG and sm.get("environment") == "staging",
            json.dumps(sm) if sm else "exec failed: %s" % (err.strip()[:160] or out.strip()[:160]))

    notes = L.read_text(NOTES) or ""
    secs = {s: bool(re.search(r"^#+\s*%s\b" % s, notes, re.M | re.I)) for s in ("Render", "Change", "Rollback")}
    body = re.sub(r"<!--.*?-->|^#.*$", "", notes, flags=re.S | re.M)
    words = len(re.findall(r"[A-Za-z]{3,}", body))
    r.check("notes", all(secs.values()) and words >= 120, "sections=%s words=%d" % (secs, words))

    if os.path.isdir(CHART) and os.path.isdir(REF_CHART):
        differs = chart_differs()
        v_work, v_ref = chart_version(CHART), chart_version(REF_CHART)
        r.check("chart-version", (not differs) or v_work != v_ref, "work/chart %s reference; version %s (reference %s)" % ("differs from" if differs else "matches", v_work, v_ref), critical=False)
    return r.finish(args.out, args.explanation, extra_env={"release": RELEASE, "variant_file": (L.read_text(os.path.join(WORK, ".variant")) or "").strip()})


if __name__ == "__main__":
    sys.exit(main())
