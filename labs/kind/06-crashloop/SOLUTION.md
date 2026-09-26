# Lab 06 — solution

## Mechanism

`CrashLoopBackOff` means: the container keeps exiting and the kubelet is
waiting (with growing back-off) before starting it again. The cause is
whatever made it exit. Here `lastState.terminated.exitCode` is 1 and the
previous instance's log says `NOTIFY_ENDPOINT is not set`. The pod spec takes
that variable from ConfigMap `notify-config`, which does not exist; because
the reference is `optional: true`, the kubelet starts the container anyway with
the variable unset, and the app exits.

The rollout is stalled like labs 02 and 05: the new ReplicaSet never gets a
Ready pod, so 2.9.0 keeps serving.

## Valid fixes

1. **Create the missing ConfigMap** (what the pipeline should have done), then
   get the pods to start again:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab apply -f labs/kind/06-crashloop/solution/notify-config.yaml
   kubectl --context kind-looped-onsite -n looped-lab rollout restart deployment/notify-api
   kubectl --context kind-looped-onsite -n looped-lab rollout status deployment/notify-api
   ```

   Environment variables are resolved when a container starts. Without the
   restart, the crash-looping container still picks the value up on its next
   start, but only after the current back-off delay, which can be minutes.
   Deleting the crashing pod has the same effect as the restart for that pod.

2. **Roll back** to 2.9.0 (`kubectl … rollout undo deployment/notify-api`) if
   the correct configuration is not known yet; fix the release, then roll
   forward.

Not fixes: `rollout restart` alone (it crashes the same way), raising limits,
or removing `optional: true` (that changes the failure to
`CreateContainerConfigError`; it does not supply the value).

## Why this matters in an interview

Say "CrashLoopBackOff is the kubelet backing off; the cause is in the exit
code, `logs --previous` and events". Then separate exit 1 (the app exited),
137 (SIGKILL: OOM or a kill after the grace period, see lab 07) and
`CreateContainerConfigError` (the kubelet could not build the container
config).
