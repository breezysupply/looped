# Lab 04 — Search launch: one workload never Ready, another keeps restarting

Real-cluster version of simulated lab **ons-lab-04**.
Lessons: `les-probes`, `les-pod-lifecycle`, `les-services`.

## Ticket

> The new search service launched an hour ago. `search-api` pods are Running
> but the gateway gets 503s; `search-indexer` restarts every minute or so. Both
> manifests were copied from a template and "the probes were adjusted".
>
> **Impact:** search unavailable. **Recent change:** first launch.

## Objective

Fix both workloads **without removing health checking**, and verify.

## What is simulated or simplified

- search-api is a busybox web server that serves `/` and `/healthz` only.
- search-indexer "warms its index" for about 40 s (a `sleep`) before it serves
  `/healthz`. It exits promptly on SIGTERM.
- There is no gateway; "503s" correspond to the Service having no ready
  endpoints.
- `terminationGracePeriodSeconds: 5` (default 30).

## Steps

1. Once: `labs/kind/setup.sh`
2. Inject: `labs/kind/04-probes/inject.sh`
3. Investigate. Start with read-only commands:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab get pods -l 'app in (search-api,search-indexer)' -w
   kubectl --context kind-looped-onsite -n looped-lab describe pod --show-events=true -l app=search-api
   kubectl --context kind-looped-onsite -n looped-lab get endpointslices -l kubernetes.io/service-name=search-api -o yaml
   kubectl --context kind-looped-onsite -n looped-lab get events --field-selector reason=Unhealthy --sort-by=.lastTimestamp
   kubectl --context kind-looped-onsite -n looped-lab logs deployment/search-indexer --previous
   kubectl --context kind-looped-onsite -n looped-lab get pod -l app=search-indexer -o jsonpath='{.items[0].status.containerStatuses[0].lastState}{"\n"}'
   kubectl --context kind-looped-onsite -n looped-lab get deployment search-api search-indexer -o yaml | grep -B2 -A8 'Probe:'
   ```

   (Stop `-w` with Ctrl-C.) For each workload: which probe is failing, what
   does the kubelet do about it, and what does the app actually serve / when?

4. What you should observe:
   - **search-api**: `Running`, `READY 0/1`, `RESTARTS 0`, indefinitely.
     Events: `Readiness probe failed: HTTP probe failed with statuscode: 404`.
     The EndpointSlice lists both pod addresses with `ready: false`, so the
     Service routes to nobody. Running does not imply Ready, and a failing
     readiness probe never restarts a container.
   - **search-indexer**: restarts roughly every 10–20 s at first, then more
     slowly as restart back-off grows (it may show `CrashLoopBackOff` between
     attempts). Events: `Liveness probe failed: … connection refused` then
     `Container indexer failed liveness probe, will be restarted`.
     `logs --previous` shows `warming index (takes about 40s)` followed by
     `received SIGTERM, exiting`; `lastState.terminated` shows reason `Error`,
     exit code 143 (it exited on SIGTERM). It never reaches 40 s.
   - Timing: the 404s start within ~10 s. The first liveness kill happens about
     10 s after the container starts (initial delay 5 s, period 5 s, 2
     failures). Restart back-off is exponential by default (10 s, 20 s, 40 s …,
     capped at 5 minutes), so the gaps between restarts lengthen.
5. Fix: your call. Keep a readiness and a liveness probe on both.
6. Verify: `labs/kind/04-probes/verify.sh`
   Checks: both Deployments still define readiness and liveness probes; all
   replicas Ready; the search-api Service has that many ready endpoints; every
   search-indexer container has been running for **at least 60 s**. Right
   after a fix the indexer needs ~40 s to warm up plus the rest of the minute,
   so expect a `FAIL: … only been running Ns` at first: re-run.
7. Then read `SOLUTION.md`.
8. Reset: `labs/kind/reset.sh 04`

## Lab vs production

- Real slow starters vary: JVM warm-up, cache loading, migrations. Probe
  budgets are set from measured start times with margin, not guessed.
- A gateway in front of a Service with no ready endpoints typically answers
  503 itself; which component answers depends on the gateway.
- Removing a failing probe "fixes" the symptom and loses the protection; in a
  review that is a red flag, which is why verify.sh rejects it.

## References

- [Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)
- [Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) (container restarts and back-off)
