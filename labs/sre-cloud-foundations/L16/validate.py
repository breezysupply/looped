#!/usr/bin/env python3
"""L16 validator: queries the REAL kind cluster through
`kubectl --context kind-looped-foundations -n beacon` (guarded by labcheck).

It creates one short-lived client pod (label looped.lab/id=L16, image
registry.lab/beacon:1.4.0 already loaded on the nodes, restricted security
context) that sends HTTP requests to the Service by its DNS name, reads its
output, and deletes it. Nothing else is changed.

Checks (critical unless noted):
  cluster-context         the lab context answers and its nodes are looped-foundations-*
  manifests-valid         `kubectl apply --dry-run=server -f work/` is accepted
  deployment-available    deploy/beacon has all replicas (>= 2) available
  probes-correct          startupProbe present; readiness GETs /ready; liveness GETs /healthz (never /ready)
  service-selects-pods    the Service selector matches the Deployment's pods
  endpointslice-membership ready EndpointSlice addresses == IPs of the Ready pods (one per replica)
  targetport-matches      the EndpointSlice port equals the container port the pods listen on
  config-from-configmap   env comes from ConfigMap beacon-config (envFrom)
  secret-by-reference     BEACON_STORE_URL comes from Secret beacon-secrets; the value is not in the Deployment or the logs
  user-path               5 requests from a client pod to http://beacon.beacon.svc.cluster.local/version: all 200 with the ConfigMap's environment
  no-restarts             no container restarts in the current pods (advisory)
  notes                   evidence/L16-notes.md filled in (advisory)
Exit 1 if any critical check fails. Writes the evidence JSON for the app.
"""
import base64
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
CTX = "kind-looped-foundations"
NS = "beacon"
URL = "http://beacon.beacon.svc.cluster.local/version"
CLIENT = ("import json, urllib.request\n"
          "out = []\n"
          "for i in range(5):\n"
          "    try:\n"
          "        with urllib.request.urlopen('" + URL + "', timeout=3) as r:\n"
          "            out.append({'code': r.status, 'environment': json.loads(r.read().decode()).get('environment')})\n"
          "    except Exception as e:\n"
          "        out.append({'code': getattr(e, 'code', 0), 'error': type(e).__name__ + ': ' + str(getattr(e, 'reason', e))[:80]})\n"
          "print('L16RESULT ' + json.dumps(out))\n")


def k(args, timeout=60.0, ns=NS):
    return L.kubectl(CTX, args, timeout=timeout, ns=ns)


def ready(p):
    return any(c.get("type") == "Ready" and c.get("status") == "True" for c in (p.get("status") or {}).get("conditions") or [])


def client_pod(name):
    return {
        "apiVersion": "v1", "kind": "Pod",
        "metadata": {"name": name, "namespace": NS, "labels": {"looped.lab/id": "L16", "app.kubernetes.io/name": "l16-client"}},
        "spec": {
            "restartPolicy": "Never", "automountServiceAccountToken": False,
            "securityContext": {"runAsNonRoot": True, "runAsUser": 10001, "runAsGroup": 10001, "seccompProfile": {"type": "RuntimeDefault"}},
            "containers": [{
                "name": "client", "image": "registry.lab/beacon:1.4.0", "imagePullPolicy": "IfNotPresent",
                "command": ["python3", "-c", CLIENT],
                "resources": {"requests": {"cpu": "10m", "memory": "32Mi"}, "limits": {"memory": "64Mi"}},
                "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}},
            }],
        },
    }


def main() -> int:
    args = L.standard_args("L16")
    r = L.Report("L16", "kind-basic")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(WORK, ".variant")) or "").strip() or "variant-a"
    if not args.variant:
        r.seed = variant
    extra = {"cluster": "looped-foundations", "context": CTX, "namespace": NS, "variant_file": variant}

    ok, why = L.require_kube_context(CTX)
    if ok:
        n = L.kget(CTX, ["get", "nodes"], ns=None) or {}
        nodes = [x["metadata"]["name"] for x in n.get("items", [])]
        ok = bool(nodes) and all(x.startswith("looped-foundations-") for x in nodes)
        why = "nodes: " + ", ".join(nodes) if nodes else "cannot list nodes through " + CTX
    if not r.check("cluster-context", ok, why):
        return r.finish(args.out, args.explanation, extra)

    code, out, err = k(["apply", "--dry-run=server", "-f", WORK + os.sep], ns=None)
    r.check("manifests-valid", code == 0, (out.strip() or err.strip()).replace("\n", "; ")[-260:] or "no output")

    dep = L.kget(CTX, ["get", "deployment", "beacon"]) or {}
    dspec, dst = dep.get("spec") or {}, dep.get("status") or {}
    reps = dspec.get("replicas") or 0
    r.check("deployment-available", bool(dep) and reps >= 2 and dst.get("availableReplicas") == reps,
            f"replicas={reps} available={dst.get('availableReplicas')} ready={dst.get('readyReplicas')} updated={dst.get('updatedReplicas')}" if dep else "deploy/beacon not found")

    tpl = (dspec.get("template") or {})
    containers = ((tpl.get("spec") or {}).get("containers") or [{}])
    c0 = containers[0]
    path = lambda pr: ((pr or {}).get("httpGet") or {}).get("path")  # noqa: E731
    rp, lp, sp = c0.get("readinessProbe"), c0.get("livenessProbe"), c0.get("startupProbe")
    r.check("probes-correct", bool(sp) and path(rp) == "/ready" and path(lp) == "/healthz",
            f"startup={path(sp) or ('exec/tcp' if sp else 'none')} readiness={path(rp) or ('none' if not rp else 'non-http')} liveness={path(lp) or ('none' if not lp else 'non-http')}")

    sel = (dspec.get("selector") or {}).get("matchLabels") or {}
    pods = (L.kget(CTX, ["get", "pods", "-l", ",".join(f"{a}={b}" for a, b in sel.items())]) or {}).get("items", []) if sel else []
    pods = [p for p in pods if not p["metadata"].get("deletionTimestamp")]
    svc = L.kget(CTX, ["get", "service", "beacon"]) or {}
    ssel = (svc.get("spec") or {}).get("selector") or {}
    matched = [p for p in pods if ssel and all((p["metadata"].get("labels") or {}).get(a) == b for a, b in ssel.items())]
    r.check("service-selects-pods", bool(svc) and bool(matched) and len(matched) == len(pods),
            f"service selector={ssel}; Deployment pods={len(pods)}, matched by the Service={len(matched)}" if svc else "service/beacon not found")

    ready_ips = sorted(p["status"].get("podIP", "") for p in pods if ready(p) and p["status"].get("podIP"))
    slices = (L.kget(CTX, ["get", "endpointslices", "-l", "kubernetes.io/service-name=beacon"]) or {}).get("items", [])
    ep_ready, ep_unready, ep_ports = [], [], set()
    for s in slices:
        for prt in s.get("ports") or []:
            if prt.get("port") is not None:
                ep_ports.add(prt.get("port"))
        for e in s.get("endpoints") or []:
            (ep_ready if (e.get("conditions") or {}).get("ready") else ep_unready).extend(e.get("addresses") or [])
    ep_ready.sort()
    r.check("endpointslice-membership", bool(slices) and ep_ready == ready_ips and len(ep_ready) == reps and reps > 0,
            f"{len(slices)} slice(s); ready endpoints {len(ep_ready)} {ep_ready}; not-ready endpoints {len(ep_unready)}; Ready pod IPs {ready_ips}")

    cports = {p.get("containerPort") for p in (c0.get("ports") or [])}
    r.check("targetport-matches", bool(ep_ports) and ep_ports <= cports,
            f"EndpointSlice port(s) {sorted(ep_ports) or 'none'}; container port(s) {sorted(x for x in cports if x)}; service targetPort {[(p.get('targetPort')) for p in (svc.get('spec') or {}).get('ports') or []]}")

    env_from = [e.get("configMapRef", {}).get("name") for e in (c0.get("envFrom") or []) if e.get("configMapRef")]
    cm = L.kget(CTX, ["get", "configmap", "beacon-config"]) or {}
    want_env = ((cm.get("data") or {}).get("BEACON_APP_ENVIRONMENT"))
    r.check("config-from-configmap", "beacon-config" in env_from and bool(want_env),
            f"envFrom configMapRef={env_from}; ConfigMap BEACON_APP_ENVIRONMENT={want_env}")

    url_env = [e for e in (c0.get("env") or []) if e.get("name") == "BEACON_STORE_URL"]
    ref = ((url_env[0].get("valueFrom") or {}).get("secretKeyRef") or {}) if url_env else {}
    sec = L.kget(CTX, ["get", "secret", "beacon-secrets"]) or {}
    raw = ((sec.get("data") or {}).get(ref.get("key", ""), "")) if ref else ""
    try:
        secret_val = base64.b64decode(raw).decode() if raw else ""
    except ValueError:
        secret_val = ""
    password = secret_val.split("://", 1)[-1].split("@", 1)[0].split(":", 1)[-1] if "@" in secret_val else secret_val
    dep_text = json.dumps(dep)
    code, logs, lerr = k(["logs", "-l", ",".join(f"{a}={b}" for a, b in sel.items()), "--tail=200", "--prefix"], timeout=60) if sel else (1, "", "")
    leaked = bool(password) and (password in dep_text or password in logs)
    redacted = '"url":"<redacted>"' in logs
    r.check("secret-by-reference", ref.get("name") == "beacon-secrets" and bool(password) and not leaked and "value" not in (url_env[0] if url_env else {}),
            f"BEACON_STORE_URL from secretKeyRef {ref.get('name')}/{ref.get('key')}; value in Deployment or logs: {'YES' if leaked else 'no'}; logs show url redacted: {'yes' if redacted else 'not seen'}")

    name = f"l16-client-{int(time.time())}"
    results, uobs = [], ""
    ok_ctx, _ = L.require_kube_context(CTX)
    if ok_ctx:
        code, out, err = L.sh(["kubectl", "--context", CTX, "-n", NS, "apply", "-f", "-"], timeout=60, input_text=json.dumps(client_pod(name)))
        if code == 0:
            k(["wait", f"pod/{name}", "--for=jsonpath={.status.phase}=Succeeded", "--timeout=90s"], timeout=100)
            code, out, err = k(["logs", f"pod/{name}"], timeout=30)
            m = re.search(r"L16RESULT (\[.*\])", out)
            try:
                results = json.loads(m.group(1)) if m else []
            except ValueError:
                results = []
            phase = ((L.kget(CTX, ["get", f"pod/{name}"]) or {}).get("status") or {}).get("phase", "?")
            uobs = f"client pod {name} phase {phase}; " if not results else ""
            k(["delete", f"pod/{name}", "--ignore-not-found", "--wait=false"], timeout=30)
        else:
            uobs = "could not create the client pod: " + err.strip()[:200]
    good = [x for x in results if x.get("code") == 200 and x.get("environment") == want_env]
    summary = ", ".join(str(x.get("code")) + ("" if x.get("code") == 200 else " " + x.get("error", "")[:40]) for x in results)
    r.check("user-path", len(results) == 5 and len(good) == 5,
            uobs + (f"GET {URL} x5 -> {summary}; environment={results[0].get('environment') if results else None} (ConfigMap says {want_env})" if results else "no result from the client pod"))

    restarts = {p["metadata"]["name"]: sum(c.get("restartCount", 0) for c in (p["status"].get("containerStatuses") or [])) for p in pods}
    r.check("no-restarts", bool(pods) and not any(restarts.values()), f"restarts: {restarts}", critical=False)

    notes = L.read_text(os.path.join(HERE, "evidence", "L16-notes.md")) or ""
    filled = len(re.sub(r"<!--.*?-->", "", notes, flags=re.S)) > 700 and re.search(r"EndpointSlice", notes, re.I) is not None
    r.check("notes", filled, "notes filled in, including the request path" if filled else "evidence/L16-notes.md still mostly the template (advisory)", critical=False)
    return r.finish(args.out, args.explanation, extra)


if __name__ == "__main__":
    sys.exit(main())
