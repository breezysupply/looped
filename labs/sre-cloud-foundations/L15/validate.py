#!/usr/bin/env python3
"""L15 validator: queries the REAL kind cluster through
`kubectl --context kind-looped-foundations -n beacon` (guarded by labcheck:
the context must be a lab context pointing at a local API server).

It is not read-only: the self-healing check deletes ONE Beacon pod in
namespace beacon and waits for the ReplicaSet to replace it.

Checks (critical unless noted):
  cluster-context   the lab context answers and its nodes are looped-foundations-*
  manifest-valid    `kubectl apply --dry-run=server -f work/deployment.yaml` is accepted by the API server
  change-request    CR-1042 is in work/ and live: pods carry tier=api and BEACON_APP_ENVIRONMENT=kind-lab-l15; the selector is unchanged
  in-sync           `kubectl diff -f work/deployment.yaml` reports no difference (live == desired)
  replicas          spec.replicas equals the manifest (3) and 3 pods are ready
  rollout-complete  not paused; observedGeneration current; updated == available == replicas
  ownership-chain   Deployment -> one active ReplicaSet -> exactly `replicas` pods; no other pod matches the selector
  self-healing      a deleted pod is replaced by the ReplicaSet and readiness returns to 3
  notes             evidence/L15-notes.md filled in (advisory)
Exit 1 if any critical check fails. Writes the evidence JSON for the app.
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
MANIFEST = os.path.join(WORK, "deployment.yaml")
CTX = "kind-looped-foundations"
NS = "beacon"
SELECTOR = {"app.kubernetes.io/name": "beacon"}
WANT_ENV = ("BEACON_APP_ENVIRONMENT", "kind-lab-l15")


def k(args, timeout=60.0, ns=NS):
    return L.kubectl(CTX, args, timeout=timeout, ns=ns)


def env_of(container):
    return {e.get("name"): e.get("value") for e in (container.get("env") or []) if "name" in e}


def deployment_pods():
    sel = ",".join(f"{a}={b}" for a, b in SELECTOR.items())
    pods = L.kget(CTX, ["get", "pods", "-l", sel]) or {}
    return [p for p in pods.get("items", []) if not p["metadata"].get("deletionTimestamp")]


def ready(p):
    return any(c.get("type") == "Ready" and c.get("status") == "True" for c in (p.get("status") or {}).get("conditions") or [])


def main() -> int:
    args = L.standard_args("L15")
    r = L.Report("L15", "kind-basic")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(WORK, ".variant")) or "").strip() or "variant-a"
    if not args.variant:
        r.seed = variant
    extra = {"cluster": "looped-foundations", "context": CTX, "namespace": NS, "variant_file": variant}

    ok, why = L.require_kube_context(CTX)
    nodes = []
    if ok:
        n = L.kget(CTX, ["get", "nodes"], ns=None) or {}
        nodes = [x["metadata"]["name"] for x in n.get("items", [])]
        ok = bool(nodes) and all(x.startswith("looped-foundations-") for x in nodes)
        why = "nodes: " + ", ".join(nodes) if nodes else "cannot list nodes through " + CTX
        kv = [x["status"]["nodeInfo"]["kubeletVersion"] for x in n.get("items", [])]
        extra["kubelet"] = ",".join(sorted(set(kv)))
    if not r.check("cluster-context", ok, why):
        return r.finish(args.out, args.explanation, extra)

    code, out, err = k(["apply", "--dry-run=server", "-f", MANIFEST], ns=None)
    r.check("manifest-valid", code == 0, (out.strip() or err.strip())[-240:] or "no output")

    code, out, err = k(["create", "--dry-run=client", "-o", "json", "-f", MANIFEST], ns=None)
    want = {}
    try:
        want = json.loads(out) if code == 0 else {}
    except ValueError:
        want = {}
    tpl = ((want.get("spec") or {}).get("template") or {})
    tpl_labels = (tpl.get("metadata") or {}).get("labels") or {}
    tpl_env = env_of(((tpl.get("spec") or {}).get("containers") or [{}])[0])
    want_sel = ((want.get("spec") or {}).get("selector") or {}).get("matchLabels") or {}
    want_replicas = (want.get("spec") or {}).get("replicas", 1)

    dep = L.kget(CTX, ["get", "deployment", "beacon"]) or {}
    spec, st = dep.get("spec") or {}, dep.get("status") or {}
    live_sel = (spec.get("selector") or {}).get("matchLabels") or {}
    pods = deployment_pods()
    pod_ok = [p for p in pods if (p["metadata"].get("labels") or {}).get("tier") == "api"
              and env_of((p["spec"].get("containers") or [{}])[0]).get(WANT_ENV[0]) == WANT_ENV[1]]
    in_file = tpl_labels.get("tier") == "api" and tpl_env.get(WANT_ENV[0]) == WANT_ENV[1] and want_sel == SELECTOR
    r.check("change-request", in_file and live_sel == SELECTOR and bool(pods) and len(pod_ok) == len(pods),
            f"work/: tier={tpl_labels.get('tier')} env={tpl_env.get(WANT_ENV[0])} selector={want_sel}; live selector={live_sel}; pods with CR-1042 {len(pod_ok)}/{len(pods)}")

    code, out, err = k(["diff", "-f", MANIFEST], ns=None, timeout=90)
    changed = [ln for ln in out.splitlines() if ln[:1] in "+-" and not ln.startswith(("+++", "---")) and "generation" not in ln]
    r.check("in-sync", code == 0, "kubectl diff: no difference" if code == 0 else (f"{len(changed)} changed line(s), e.g. " + "; ".join(x.strip()[:60] for x in changed[:3]) if code == 1 else "kubectl diff error: " + err.strip()[:200]))

    n_ready = sum(1 for p in pods if ready(p))
    r.check("replicas", bool(dep) and spec.get("replicas") == want_replicas == 3 and n_ready == 3,
            f"manifest replicas={want_replicas}; live spec.replicas={spec.get('replicas')}; ready pods={n_ready}")

    paused = bool(spec.get("paused"))
    gen_ok = (st.get("observedGeneration") or 0) >= ((dep.get("metadata") or {}).get("generation") or 0)
    reps = spec.get("replicas")
    prog = [c for c in st.get("conditions") or [] if c.get("type") == "Progressing"]
    reason = prog[0].get("reason") if prog else ""
    r.check("rollout-complete", bool(dep) and not paused and gen_ok and st.get("updatedReplicas") == reps == st.get("availableReplicas") and reason == "NewReplicaSetAvailable",
            f"paused={paused} observedGeneration={st.get('observedGeneration')}/{(dep.get('metadata') or {}).get('generation')} updated={st.get('updatedReplicas')} available={st.get('availableReplicas')} replicas={reps} Progressing={reason or 'n/a'}")

    uid = (dep.get("metadata") or {}).get("uid", "")
    rss = (L.kget(CTX, ["get", "replicasets", "-l", ",".join(f"{a}={b}" for a, b in SELECTOR.items())]) or {}).get("items", [])
    owned = [x for x in rss if any(o.get("uid") == uid for o in x["metadata"].get("ownerReferences") or [])]
    active = [x for x in owned if (x.get("spec") or {}).get("replicas", 0) > 0]
    chain_ok, obs = False, "no Deployment"
    if dep:
        if len(active) == 1:
            rs = active[0]
            rs_uid = rs["metadata"]["uid"]
            mine = [p for p in pods if any(o.get("uid") == rs_uid and o.get("kind") == "ReplicaSet" for o in p["metadata"].get("ownerReferences") or [])]
            strays = [p["metadata"]["name"] for p in pods if p not in mine]
            chain_ok = len(mine) == reps and not strays
            obs = (f"deploy/beacon -> rs/{rs['metadata']['name']} (hash {rs['metadata'].get('labels', {}).get('pod-template-hash')}, {len(owned)} ReplicaSet(s) in history) -> "
                   f"{len(mine)} pod(s)" + (f"; pods not owned by it: {', '.join(strays)}" if strays else ""))
        else:
            obs = f"{len(active)} active ReplicaSets owned by deploy/beacon (want exactly 1 once the rollout is complete)"
    r.check("ownership-chain", chain_ok, obs)

    heal, hobs = False, "skipped: not 3 ready pods to start from"
    if n_ready == 3 and not paused:
        victim = sorted(p["metadata"]["name"] for p in pods)[0]
        code, out, err = k(["delete", "pod", victim, "--wait=false"])
        t0 = time.time()
        state = {"names": [], "ready": 0}

        def back():
            ps = deployment_pods()
            state["names"] = [p["metadata"]["name"] for p in ps]
            state["ready"] = sum(1 for p in ps if ready(p))
            return victim not in state["names"] and state["ready"] == 3
        heal = code == 0 and L.wait_until(back, timeout_s=120, every_s=3)
        new = sorted(set(state["names"]) - {p["metadata"]["name"] for p in pods})
        hobs = (f"deleted {victim}; " + (f"replaced by {', '.join(new)} in {time.time() - t0:.0f}s, 3 ready" if heal else f"after {time.time() - t0:.0f}s: ready={state['ready']} pods={', '.join(state['names'])}")) if code == 0 else "delete failed: " + err.strip()[:160]
    r.check("self-healing", heal, hobs)

    notes = L.read_text(os.path.join(HERE, "evidence", "L15-notes.md")) or ""
    filled = len(re.sub(r"<!--.*?-->", "", notes, flags=re.S)) > 700 and "rs/" in notes
    r.check("notes", filled, "notes filled in, including the ReplicaSet chain" if filled else "evidence/L15-notes.md still mostly the template (advisory)", critical=False)
    return r.finish(args.out, args.explanation, extra)


if __name__ == "__main__":
    sys.exit(main())
