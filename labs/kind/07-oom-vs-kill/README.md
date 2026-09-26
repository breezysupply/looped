# Lab 07 — Two media workers restarting with exit code 137

Real-cluster version of simulated lab **ons-lab-07**.
Lessons: `les-resources`, `les-pod-lifecycle`, `les-probes`.

## Ticket

> `thumbnailer` and `transcoder` both restart repeatedly and both show exit
> code 137. A teammate proposes doubling the memory limit on both.
> Yesterday thumbnailer's batch size was raised; transcoder moved to a new
> base image that takes longer to boot.
>
> **Impact:** media processing backlog growing. **Recent changes:** as above.

## Objective

Establish what is actually killing each one, fix each **at its cause**, and
verify. Decide whether the teammate's proposal is right for either.

## What is simulated or simplified

- thumbnailer is a busybox loop. Each "batch" makes the main process (PID 1)
  hold about 100 MiB at peak; its memory limit is 48Mi.
- transcoder is a busybox script that takes ~45 s to boot and whose entrypoint
  **ignores SIGTERM** (a stand-in for a shell entrypoint that does not forward
  signals). Its memory limit is 64Mi and it uses a few MiB.
- `terminationGracePeriodSeconds`: 5 s (thumbnailer) and 10 s (transcoder);
  the default is 30 s.

## Steps

1. Once: `labs/kind/setup.sh`
2. Inject: `labs/kind/07-oom-vs-kill/inject.sh`
3. Investigate. Start with read-only commands:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab get pods -l 'app in (thumbnailer,transcoder)' -w
   kubectl --context kind-looped-onsite -n looped-lab get pods -l 'app in (thumbnailer,transcoder)' -o jsonpath='{range .items[*]}{.metadata.name}{"  "}{.status.containerStatuses[0].lastState.terminated.reason}{" exit="}{.status.containerStatuses[0].lastState.terminated.exitCode}{" restarts="}{.status.containerStatuses[0].restartCount}{"\n"}{end}'
   kubectl --context kind-looped-onsite -n looped-lab logs deployment/thumbnailer --previous
   kubectl --context kind-looped-onsite -n looped-lab logs deployment/transcoder --previous
   kubectl --context kind-looped-onsite -n looped-lab get events --sort-by=.lastTimestamp | grep -E 'transcoder|thumbnailer'
   kubectl --context kind-looped-onsite -n looped-lab describe pod --show-events=true -l app=transcoder | grep -E -A3 'Liveness|Last State'
   kubectl --context kind-looped-onsite -n looped-lab get deployment thumbnailer transcoder -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.template.spec.containers[0].resources}{"\n"}{end}'
   ```

4. What you should observe:
   - Both containers restart; both last terminations have **exit code 137**
     (128 + 9, SIGKILL).
   - thumbnailer: `lastState.terminated.reason: OOMKilled`. Its previous log
     ends at `batch 1: loading 500 images into memory` — it never logs
     `complete`. No probe events are involved.
   - transcoder: `lastState.terminated.reason: Error`, not OOMKilled. Events:
     `Liveness probe failed: … connection refused`, then
     `Container transcoder failed liveness probe, will be restarted`. Its
     previous log shows `booting … takes about 45s` and never `ready`.
   - Same exit code, different killers: the kernel's OOM killer (memory
     limit) versus the kubelet (liveness failure → SIGTERM, ignored → SIGKILL
     after the grace period).
   - Timing: thumbnailer is killed within seconds of each start. transcoder
     is killed ~20 s after each start (initial delay 10 s, 3 failures 5 s apart)
     plus the 10 s grace period. Restart back-off then lengthens the gaps
     (10 s, 20 s, 40 s … capped at 5 minutes by default), so the first
     `OOMKilled`/`Error` pair can take 30–90 s to appear.
5. Fix: your call. Fix each workload at its cause.
6. Verify: `labs/kind/07-oom-vs-kill/verify.sh`
   Checks: both Deployments fully Ready; every container up for at least
   60 s; the *current* thumbnailer container has logged a completed batch;
   transcoder still has a livenessProbe. It prints a NOTE (not a failure) if
   transcoder's memory limit was changed. Right after a fix, expect
   `FAIL: … only been running Ns` for about a minute: re-run.
7. Then read `SOLUTION.md`.
8. Reset: `labs/kind/reset.sh 07`

## Lab vs production

- Memory is rarely this clean. Real workloads grow gradually, have caches the
  kernel can reclaim, and may be killed by node-pressure eviction rather than
  their own limit (that shows up as an eviction, not OOMKilled). Container
  metrics over time (not available in this lab) are the usual evidence.
- Some runtimes and cgroup configurations report OOM kills differently (for
  example which process in the container the kernel picks); the reason field
  on `lastState` is the thing to read, not the exit code.
- A shell entrypoint that swallows SIGTERM is a common real bug: every
  rollout or node drain then waits the full grace period and ends in SIGKILL.

## References

- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Assign Memory Resources to Containers and Pods](https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/)
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) (termination and grace period)
- [Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)
