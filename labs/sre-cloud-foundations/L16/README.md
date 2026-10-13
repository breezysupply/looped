# L16 — A request through a Service: EndpointSlices, configuration, probes

Module M08 · ~120 min practical · profile `kind-basic` · cluster `looped-foundations`, namespace `beacon`

## Ticket

> Beacon now runs behind a ClusterIP Service so other workloads can call
> `http://beacon.beacon.svc.cluster.local`. Configuration comes from the ConfigMap
> `beacon-config`, the (fake) database URL from the Secret `beacon-secrets`, and the pods have
> startup, readiness and liveness probes. After the latest change, in-cluster callers cannot
> get an answer from `/version`. Trace a request from a client pod to a ready backend, find
> where it stops, fix the manifest in `L16/work/`, and prove the user path — without
> weakening the probes.

## Objectives

- `obj-m08-03` trace traffic through a Service: EndpointSlice membership and an actual HTTP response; repair selector or targetPort mismatches
- `obj-m08-04` configure workloads safely with ConfigMaps and Secrets
- `obj-m08-05` use probes correctly: startup, readiness and liveness each do a different job; never remove probes to hide a failure

## Before you start

`profiles/kind-basic/setup.sh` must have run (cluster, namespace `beacon` with Pod Security
`restricted`, image `registry.lab/beacon:1.4.0` loaded). L16 **replaces** L15's Deployment
(same name, same namespace); finish or tear down L15 first.
`K="kubectl --context kind-looped-foundations -n beacon"`.

## What is in `work/`

| File | Object |
|---|---|
| `configmap.yaml` | `beacon-config`: `BEACON_APP_ENVIRONMENT=kind-lab-l16`, port, store kind — delivered with `envFrom` |
| `secret.yaml` | `beacon-secrets`: a fake PostgreSQL URL (`lab-…-not-a-real-secret`), delivered with `secretKeyRef`; Beacon redacts it in logs |
| `deployment.yaml` | 3 replicas, UID 10001, read-only root filesystem; `startupProbe` and `livenessProbe` on `/healthz`, `readinessProbe` on `/ready` |
| `service.yaml` | ClusterIP `beacon`, port 80 → named port `http` |

## What is fixture-controlled

`inject.sh` changes one thing in `work/` before applying it, chosen by
`LOOPED_VARIANT=variant-a|variant-b|variant-c`. The validator records the variant but does not
say what changed. Beacon's own `/ready` is healthy in every variant; nothing in the application
is broken.

## Steps and checkpoints

**Checkpoint c1 — map the path (week 23, session 1).**

1. `bash labs/sre-cloud-foundations/L16/setup.sh` (inventory and notes template in `evidence/`).
2. Reproduce from inside the cluster with a throwaway client that meets the namespace's
   restricted policy:
   ```
   $K run l16-try --rm -i --restart=Never --image=registry.lab/beacon:1.4.0 --image-pull-policy=IfNotPresent \
     --labels=looped.lab/id=L16 --overrides='{"spec":{"securityContext":{"runAsNonRoot":true,"runAsUser":10001,"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"l16-try","image":"registry.lab/beacon:1.4.0","command":["python3","-c","import urllib.request;print(urllib.request.urlopen(\"http://beacon/version\",timeout=3).read().decode())"],"securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}}]}}'
   ```
   Quote the error.
3. Draw the path in your notes: DNS name → ClusterIP:80 → EndpointSlice endpoints (IP:port,
   ready?) → pod → container port. Use `$K get svc beacon -o wide`,
   `$K get endpointslices -l kubernetes.io/service-name=beacon -o yaml`,
   `$K get pods -o wide --show-labels`, `$K describe pod <one>` (probe lines and Events).

**Checkpoint c2 — diagnose and fix (session 2).**

4. Two hypotheses, one discriminating check (compare one hop with the next: selector against
   pod labels, endpoint port against container port, endpoint `ready` against pod readiness
   and the probe's Events).
5. Fix the one wrong field in `work/` and apply:
   `kubectl --context kind-looped-foundations apply -f labs/sre-cloud-foundations/L16/work/`.
   Re-run the client from step 2.
6. Explain in your notes what each probe failure does: startup (holds the others off, then
   restarts), readiness (removed from EndpointSlices, no restart), liveness (restart) — and why
   liveness must not call `/ready`.
7. `python3 labs/sre-cloud-foundations/L16/validate.py --explanation-file labs/sre-cloud-foundations/L16/evidence/L16-notes.md`
   and paste `evidence/latest.json` into the app.

## Validation (what `validate.py` measures)

Through `kubectl --context kind-looped-foundations` only: work/ accepted by a server-side dry
run; Deployment fully available; probes present with readiness on `/ready` and liveness on
`/healthz`; the Service selector matches the Deployment's pods; ready EndpointSlice addresses are
exactly the Ready pods' IPs; the EndpointSlice port is the container port; env from the
ConfigMap; the URL from the Secret by reference and absent from the Deployment and logs; and
an **actual HTTP request**: a short-lived client pod (label `looped.lab/id=L16`, same image,
restricted security context) calls `http://beacon.beacon.svc.cluster.local/version` five times
and must get 200 with the ConfigMap's environment each time. The pod is deleted afterwards.

## Pause / resume

State is the cluster plus `work/`. `reset.sh` re-applies the baseline with the same variant (or
`LOOPED_VARIANT=…`); `evidence/` is kept. `teardown.sh` removes only `looped.lab/id=L16` objects
in `beacon` and `work/`. `profiles/kind-basic/teardown.sh` deletes the cluster.

## Lab versus production

- A ClusterIP is reachable only inside the cluster. kind has no cloud load balancer; exposing
  Beacon to your Mac would need `kubectl port-forward` (which talks to one pod and skips the
  Service's load balancing) or an ingress/LoadBalancer implementation you install.
- kube-proxy here runs in iptables mode inside kind's nodes; managed clusters may use IPVS or
  eBPF data planes with different failure signatures for the same mistakes.
- A Secret is base64, not encryption; who can `get secrets` in the namespace can read it (L18
  covers RBAC, L25 rotation).

## Limits

This lab proves you can trace a Service request to ready backends, read EndpointSlices and
probe events, and fix selector, port and probe mistakes without weakening health checking. It
does **not** prove ingress, TLS, NetworkPolicy (L18), autoscaling, or behaviour under load.
The authoring environment could not start a kind cluster, so this lab's scripts were checked
statically (see the lab record's limits).

## References

- T02 Kubernetes: Debug Services · T22 Liveness, Readiness and Startup Probes · T04 kind quick start
