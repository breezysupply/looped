#!/usr/bin/env python3
"""A minimal GitOps reconciler for L20 (run it through reconciler/run.sh).

Every pass:
  1. If work/reconciler/PAUSED exists: log "paused" with its contents and do nothing else.
     (A documented pause is how an emergency manual change survives; delete the file to resume.)
  2. Read the COMMITTED state: `git archive HEAD envs/` of work/gitops — never the working tree.
  3. Verify each Deployment's promoted artifact: the registry still serves the recorded digest,
     the sha-<commit> tag still points to it, and the local image is that artifact
     (RepoDigests). On any mismatch the environment is REFUSED: nothing is applied for it.
  4. Load verified images into the kind nodes (`kind load docker-image`, once per image).
  5. Detect drift: compare the fields it owns (replicas, image, env, resources, probes, template
     annotations; Service ports/selector; ConfigMap data) between git and the live objects.
  6. Apply with `kubectl apply --server-side --field-manager=looped-l20-reconciler
     --force-conflicts`. If drift remains (fields another field manager added, e.g. `kubectl set
     env`), replace the object from git (`kubectl replace`), then check again.
  7. Write work/reconciler/status.json and append events to work/reconciler/log.jsonl.

    reconcile.py [--once] [--interval 20] [--verify-only]

--verify-only checks artifact identities (step 3) and exits; it needs Docker and the registry,
not the cluster. The cluster guard (exact context, local API server, nodes named
looped-foundations-*) runs before anything is applied.
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(LAB, "pipeline"))
import ci_local as CI  # noqa: E402  (registry and artifact helpers)

WORK = os.path.join(LAB, "work")
GITOPS = os.path.join(WORK, "gitops")
STATE = os.path.join(WORK, "reconciler")
CTX = "kind-looped-foundations"
CLUSTER = "looped-foundations"
NS = "beacon"
MANAGER = "looped-l20-reconciler"


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def event(kind, env, detail):
    os.makedirs(STATE, exist_ok=True)
    line = {"at": now(), "event": kind, "env": env, "detail": detail}
    with open(os.path.join(STATE, "log.jsonl"), "a", encoding="utf-8") as fh:
        fh.write(json.dumps(line) + "\n")
    sys.stdout.write("%s %-9s %-8s %s\n" % (line["at"], kind.upper(), env, detail))
    sys.stdout.flush()


def kubectl(*args, stdin=None, timeout=120):
    try:
        r = subprocess.run(["kubectl", "--context", CTX, "-n", NS] + list(args), capture_output=True, text=True, input=stdin, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "kubectl timed out"


def guard():
    code, out, err = CI.run(["kubectl", "--context", CTX, "config", "view", "--minify", "-o", "jsonpath={.clusters[0].cluster.server}"], timeout=20)
    host = out.replace("https://", "").split(":")[0].strip("[]")
    if code != 0 or host not in ("127.0.0.1", "localhost", "::1", "0.0.0.0"):
        raise SystemExit("refusing: context %s missing or not a local API server (%s)" % (CTX, (out or err).strip()))
    code, out, err = CI.run(["kubectl", "--context", CTX, "get", "nodes", "-o", "jsonpath={.items[*].metadata.name}", "--request-timeout=20s"], timeout=30)
    names = out.split()
    if code != 0 or not names or any(not n.startswith(CLUSTER + "-") for n in names):
        raise SystemExit("refusing: nodes %s are not all %s-* (%s)" % (names, CLUSTER, err.strip()))


def committed_tree():
    """(head, {env: [(path, obj), ...]}) from git HEAD of work/gitops."""
    code, head, err = CI.git(GITOPS, "rev-parse", "HEAD")
    if code != 0:
        raise SystemExit("work/gitops has no commits: " + err.strip())
    r = subprocess.run(["git", "-C", GITOPS, "archive", "--format=tar", "HEAD", "envs"], capture_output=True, timeout=60)
    envs = {}
    with tarfile.open(fileobj=io.BytesIO(r.stdout)) as tar:
        for m in sorted(tar.getmembers(), key=lambda m: m.name):
            parts = m.name.split("/")
            if m.isfile() and len(parts) == 3 and parts[2].endswith(".json"):
                obj = json.loads(tar.extractfile(m).read().decode("utf-8"))
                envs.setdefault(parts[1], []).append((m.name, obj))
    return head.strip(), envs


def owned(obj):
    """The fields this reconciler owns, normalised for comparison."""
    k = obj.get("kind")
    if k == "Deployment":
        spec = obj.get("spec", {})
        tpl = spec.get("template", {})
        cs = []
        for c in tpl.get("spec", {}).get("containers", []) or []:
            cs.append({"name": c.get("name"), "image": c.get("image"), "args": c.get("args"),
                       "env": sorted(json.dumps(e, sort_keys=True) for e in c.get("env", []) or []),
                       "resources": c.get("resources", {}),
                       "probes": [[(c.get(p) or {}).get("httpGet", {}).get("path"), str((c.get(p) or {}).get("httpGet", {}).get("port"))] for p in ("readinessProbe", "livenessProbe")]})
        ann = {a: v for a, v in (tpl.get("metadata", {}).get("annotations") or {}).items() if a.startswith("looped.lab/")}
        return {"replicas": spec.get("replicas"), "containers": cs, "template_annotations": ann}
    if k == "Service":
        sp = obj.get("spec", {})
        return {"selector": sp.get("selector"), "ports": [{"port": p.get("port"), "targetPort": p.get("targetPort")} for p in sp.get("ports", [])]}
    if k == "ConfigMap":
        return {"data": obj.get("data", {})}
    return {}


def live(obj):
    code, out, _ = kubectl("get", obj["kind"].lower(), obj["metadata"]["name"], "-o", "json")
    return json.loads(out) if code == 0 else None


def drift_of(objs):
    res = []
    for path, obj in objs:
        cur = live(obj)
        if cur is None:
            res.append((path, obj, "missing"))
            continue
        want, have = owned(obj), owned(cur)
        diff = [f for f in want if want[f] != have.get(f)]
        if diff:
            res.append((path, obj, ",".join(diff)))
    return res


def verify_env(objs):
    problems, images = [], []
    for _, obj in objs:
        if obj.get("kind") != "Deployment":
            continue
        ann = obj["metadata"].get("annotations", {})
        digest = ann.get("looped.lab/digest")
        if not digest:
            problems.append("%s has no promoted digest" % obj["metadata"]["name"])
            continue
        rec = CI.load(CI.artifact_path(digest))
        if not rec:
            problems.append("no CI artifact record for %s" % digest)
            continue
        image = obj["spec"]["template"]["spec"]["containers"][0]["image"]
        if image != rec["local_image"]:
            problems.append("manifest image %s is not the artifact's %s" % (image, rec["local_image"]))
        problems += CI.verify_artifact(rec)
        images.append((image, CI.local_id(image)))
    return problems, images


def load_into_kind(image, image_id, cache):
    if cache.get(image) == image_id:
        return True
    code, out, err = CI.run(["kind", "load", "docker-image", image, "--name", CLUSTER], timeout=600)
    if code == 0:
        cache[image] = image_id
    return code == 0


def apply_env(env, objs):
    with tempfile.TemporaryDirectory(prefix="looped-l20-") as tmp:
        for path, obj in objs:
            with open(os.path.join(tmp, os.path.basename(path)), "w", encoding="utf-8") as fh:
                json.dump(obj, fh)
        code, out, err = kubectl("apply", "--server-side", "--field-manager=" + MANAGER, "--force-conflicts", "-f", tmp)
        if code != 0:
            return False, err.strip()[:300]
        remaining = drift_of(objs)
        for path, obj, fields in remaining:
            if fields == "missing":
                continue
            # fields owned by another manager survive a server-side apply: replace from git
            c2, o2, e2 = kubectl("replace", "-f", os.path.join(tmp, os.path.basename(path)))
            event("replaced", env, "%s %s (%s held by another field manager): %s" % (obj["kind"], obj["metadata"]["name"], fields, "ok" if c2 == 0 else e2.strip()[:160]))
            if c2 == 0:
                kubectl("apply", "--server-side", "--field-manager=" + MANAGER, "--force-conflicts", "-f", os.path.join(tmp, os.path.basename(path)))
    return True, "applied"


def one_pass(cache, verify_only=False):
    status = {"at": now(), "envs": {}}
    paused = os.path.join(STATE, "PAUSED")
    if os.path.exists(paused) and not verify_only:
        with open(paused, encoding="utf-8") as fh:
            why = fh.read().strip()[:200]
        event("paused", "-", "reconciliation paused: %s (delete %s to resume)" % (why or "no reason given", paused))
        status.update(paused=True, reason=why)
        CI.dump(os.path.join(STATE, "status.json"), status)
        return True
    head, envs = committed_tree()
    status["head"] = head
    ok_all = True
    for env in sorted(envs):
        objs = envs[env]
        problems, images = verify_env(objs)
        if problems:
            ok_all = False
            event("refused", env, "; ".join(problems))
            status["envs"][env] = {"result": "refused", "problems": problems}
            continue
        if verify_only:
            event("verified", env, ", ".join(i for i, _ in images))
            status["envs"][env] = {"result": "verified"}
            continue
        for image, image_id in images:
            if not load_into_kind(image, image_id, cache):
                ok_all = False
                event("error", env, "kind load docker-image %s failed" % image)
        found = drift_of(objs)
        before = [x for x in found if x[2] != "missing"]
        for path, obj, fields in found:
            if fields == "missing":
                event("create", env, "%s %s is not in the cluster yet" % (obj["kind"], obj["metadata"]["name"]))
            else:
                event("drift", env, "%s %s: %s differs from git %s" % (obj["kind"], obj["metadata"]["name"], fields, head[:12]))
        ok, detail = apply_env(env, objs)
        after = drift_of(objs)
        if ok and not after:
            if before:
                event("corrected", env, "%d object(s) restored to git %s" % (len(before), head[:12]))
            status["envs"][env] = {"result": "in-sync", "drift_before": [f"{o['kind']}/{o['metadata']['name']}:{f}" for _, o, f in before]}
        else:
            ok_all = False
            event("error", env, detail if not ok else "still drifting: %s" % [f for _, _, f in after])
            status["envs"][env] = {"result": "error", "detail": detail}
    if not verify_only:
        CI.dump(os.path.join(STATE, "status.json"), status)
    return ok_all


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=20)
    ap.add_argument("--verify-only", action="store_true")
    a = ap.parse_args()
    if not a.verify_only:
        guard()
    cache_path = os.path.join(STATE, "loaded-images.json")
    cache = CI.load(cache_path, {}) or {}
    while True:
        ok = one_pass(cache, verify_only=a.verify_only)
        if not a.verify_only:
            CI.dump(cache_path, cache)
        if a.once or a.verify_only:
            return 0 if ok else 1
        time.sleep(max(5, a.interval))


if __name__ == "__main__":
    sys.exit(main())
