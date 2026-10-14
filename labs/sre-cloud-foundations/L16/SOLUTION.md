# L16 worked solution

`K="kubectl --context kind-looped-foundations -n beacon"`; apply with
`kubectl --context kind-looped-foundations apply -f labs/sre-cloud-foundations/L16/work/`.

## The path, hop by hop

`beacon.beacon.svc.cluster.local` → CoreDNS answers the Service's ClusterIP → kube-proxy's rules
on the node send ClusterIP:80 to one **ready** endpoint from the Service's EndpointSlices → the
endpoint is `podIP:port`, where `port` is the Service's `targetPort` resolved against the pod
(`http` → 8080) → Beacon listening on 0.0.0.0:8080. The EndpointSlice controller builds the
endpoint list from the Service **selector**, and copies each pod's Ready condition into
`conditions.ready`. Compare each hop with the next.

## Variant A — the selector matches no pod

Client: `URLError … Connection refused`. `$K get endpointslices -l kubernetes.io/service-name=beacon`
→ `ENDPOINTS <unset>`. `$K get svc beacon -o jsonpath='{.spec.selector}'` →
`{"app.kubernetes.io/component":"beacon-api","app.kubernetes.io/name":"beacon"}`, but
`$K get pods --show-labels` shows `app.kubernetes.io/component=api`. A Service with no matching
pods has no endpoints, and the node rejects connections to its ClusterIP.

Fix: `app.kubernetes.io/component: api` in `service.yaml`, apply; the slice lists three ready
addresses within seconds.

## Variant B — endpoints exist, the port is wrong

Client: `Connection refused`, yet the slice lists three ready addresses — with port **8081**.
`$K get svc beacon -o yaml` → `targetPort: 8081`; the pods declare `containerPort: 8080` named
`http`, and Beacon listens on 8080 (`$K logs deploy/beacon | grep listening`). Endpoints only say
"these pods are ready"; they do not check that anything listens on the port.

Fix: `targetPort: http` (the named port follows the container if it ever moves), apply.

## Variant C — nobody is ready

Client: `Connection refused`. `$K get deploy beacon` → `READY 0/3`; pods `Running` but `0/1`;
the slice lists three addresses with `ready: false`. `$K describe pod <one>` → `Readiness probe
failed: HTTP probe failed with statuscode: 404`; `$K logs <pod> | grep readyz` shows the kubelet
requesting `/readyz`, a path Beacon does not serve. Beacon's real readiness endpoint is `/ready`
(`$K exec <pod> -- python3 -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8080/ready').read())"`
→ ready true).

Fix: `readinessProbe.httpGet.path: /ready`, apply; pods become Ready and join the slice.

Rejected (all fail `probes-correct`): deleting the readiness probe (traffic would then reach
pods whose dependencies are down), pointing readiness at `/healthz` (same, more quietly),
pointing liveness at `/ready` (a database outage would restart every pod in a loop instead of
just removing them from traffic).

## Probes in one table

| Probe | Path | Failure does | Why this path |
|---|---|---|---|
| startup | `/healthz` | holds the other probes off; after 15 × 2 s, restarts the container | slow starts are not liveness failures |
| readiness | `/ready` | removes the pod from EndpointSlices (`ready: false`); no restart | `/ready` checks store and queue |
| liveness | `/healthz` | restarts the container | `/healthz` never checks dependencies |

## Proof

```
$K get endpointslices -l kubernetes.io/service-name=beacon -o wide   # 3 addresses, port 8080
$K get pods -o wide                                                  # 3/3 Running, 1/1 ready, 0 restarts
(client pod from README step 2)                                     # {"version": "1.4.0", "environment": "kind-lab-l16", ...}
python3 labs/sre-cloud-foundations/L16/validate.py                  # PASS L16
```
