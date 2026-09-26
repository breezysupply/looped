# Lab 06 — notify-api 3.0 pods crash-looping after release

Real-cluster version of simulated lab **ons-lab-06**.
Lessons: `les-pod-lifecycle`, `les-config`, `les-rollouts`.

## Ticket

> notify-api 3.0.0 went out a few minutes ago; its new pod is in
> CrashLoopBackOff. The release moved configuration into a new ConfigMap that
> the release pipeline was supposed to create. Old pods are still serving.
>
> **Impact:** none yet. **Recent change:** notify-api 2.9.0 → 3.0.0.

## Objective

Find the actual cause (CrashLoopBackOff is a state, not a cause), restore a
healthy, complete rollout, and verify.

## What is simulated or simplified

- notify-api is a busybox script. 3.0.0 reads `NOTIFY_ENDPOINT` from key
  `endpoint` of ConfigMap `notify-config`, referenced with `optional: true`,
  and exits 1 with a log line if it is empty.
- The endpoint value is not contacted; any URL-looking string is fine.

## Steps

1. Once: `labs/kind/setup.sh`
2. Inject: `labs/kind/06-crashloop/inject.sh`
3. Investigate. Start with read-only commands:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab get deployment,replicaset,pods -l app=notify-api
   kubectl --context kind-looped-onsite -n looped-lab describe pod --show-events=true -l app=notify-api | grep -E 'State|Reason|Exit Code|Restart Count|Last State'
   kubectl --context kind-looped-onsite -n looped-lab logs <new-pod-name> --previous
   kubectl --context kind-looped-onsite -n looped-lab get pod <new-pod-name> -o jsonpath='{.status.containerStatuses[0].lastState}{"\n"}'
   kubectl --context kind-looped-onsite -n looped-lab get deployment notify-api -o jsonpath='{.spec.template.spec.containers[0].env}{"\n"}'
   kubectl --context kind-looped-onsite -n looped-lab get configmaps
   kubectl --context kind-looped-onsite -n looped-lab rollout history deployment/notify-api
   ```

4. What you should observe:
   - The new pod cycles `Running` → `Error` → `CrashLoopBackOff`, restart count
     climbing; the two 2.9.0 pods stay Running and Ready.
   - `lastState.terminated`: reason `Error`, **exit code 1** — the process chose
     to exit; nothing killed it.
   - `logs --previous` (the last crashed instance) shows
     `FATAL: NOTIFY_ENDPOINT is not set (expected key 'endpoint' in ConfigMap notify-config); exiting 1`.
     Plain `logs` may show nothing useful while the container waits in back-off.
   - There is no event complaining about the missing ConfigMap: the reference
     is `optional: true`, so the kubelet starts the container with the variable
     unset rather than refusing.
   - Timing: the first crash is immediate; `CrashLoopBackOff` shows after the
     first restarts. Restart back-off grows (10 s, 20 s, 40 s … capped at 5
     minutes by default), and it matters for the fix: environment variables
     are read only when a container starts.
5. Fix: your call.
6. Verify: `labs/kind/06-crashloop/verify.sh`
   Checks: rollout complete (reason `NewReplicaSetAvailable`), no container
   waiting in `CrashLoopBackOff`, every notify-api container up for at least
   20 s.
7. Then read `SOLUTION.md`.
8. Reset: `labs/kind/reset.sh 06`

## Lab vs production

- Real apps fail less politely: a stack trace, a timeout connecting to a
  dependency, or an exit with no log at all. The method is the same: exit code
  and reason from `lastState`, then `logs --previous`, then events.
- Whether a missing ConfigMap should be `optional` is a design decision: a
  required reference makes the pod fail visibly at container creation
  (`CreateContainerConfigError`) instead of letting the app start half
  configured.
- In production the ConfigMap would come from the same release source as the
  Deployment, so "the pipeline forgot a file" is a pipeline fix as well.

## References

- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Determine the Reason for Pod Failure](https://kubernetes.io/docs/tasks/debug/debug-application/determine-reason-pod-failure/)
- [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/)
- [Configure a Pod to Use a ConfigMap](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/)
