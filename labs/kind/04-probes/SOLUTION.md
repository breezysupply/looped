# Lab 04 — solution

## Mechanism

The kubelet runs each probe on its own schedule and acts differently on
failure:

- **readiness** failure → the pod's `Ready` condition is False. The
  EndpointSlice controller marks its endpoints not ready, so Services stop
  sending it traffic. The container keeps running; nothing restarts.
- **liveness** failure (`failureThreshold` consecutive) → the kubelet kills the
  container (SIGTERM, then SIGKILL after the grace period) and restarts it
  according to `restartPolicy`, with exponential back-off.
- **startup** probe, if present → liveness and readiness are not run until it
  succeeds; its budget is `failureThreshold × periodSeconds`.

search-api's readiness probe asks for `/ready`, which the app does not serve
(404), so it is never Ready: Running, 0 restarts, no endpoints.

search-indexer needs ~40 s before `/healthz` exists; its liveness probe starts
at 5 s and gives up after 2 failures 5 s apart, so the kubelet kills it at
~10 s, every time. The app is healthy; the probe budget is shorter than its
start time. Exit code 143 (128 + SIGTERM) because this app exits on SIGTERM;
compare lab 07, where an app that ignores SIGTERM ends with 137.

## Valid fixes

**search-api:** point readiness at a path the app serves.

```sh
kubectl --context kind-looped-onsite -n looped-lab patch deployment search-api --type=json \
  -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/healthz"}]'
```

(Or add a real `/ready` endpoint to the app. Readiness and liveness on the
same endpoint is acceptable for a simple app; a readiness endpoint that also
checks dependencies is a design choice with trade-offs.)

**search-indexer:** give start-up its own budget.

```sh
kubectl --context kind-looped-onsite -n looped-lab patch deployment search-indexer --type=strategic \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"indexer","startupProbe":{"httpGet":{"path":"/healthz","port":"http"},"periodSeconds":5,"failureThreshold":24}}]}}}}'
```

A startupProbe (here up to 120 s) protects start-up while keeping a tight
liveness check afterwards. Raising `livenessProbe.initialDelaySeconds` to
comfortably above the start time (for example 60) also works, but delays
detection of a hang during every start and must be re-tuned if start-up gets
slower.

Not fixes: deleting either probe; raising memory or CPU; `rollout restart`.

## Why this matters in an interview

State the two consequences precisely: readiness gates traffic, liveness
restarts. Then show the evidence that tells them apart: `READY 0/1` with
`RESTARTS 0` and 404 events versus a climbing restart count, `Killing` events
and `lastState.terminated`.
