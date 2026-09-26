# Lab 05 — solution

## Mechanism

The scheduler places a pod only on a node that passes every filter. Two
filters matter here:

- **Resources:** the sum of requests of pods already on the node plus this
  pod's requests must fit the node's *allocatable* capacity. 1.5.0 requests
  64Gi of memory; the worker has far less allocatable, so it fails with
  `Insufficient memory`. Limits and real usage are not considered.
- **Taints / node selection:** the control-plane node carries a NoSchedule
  taint (and lacks `pool=general`), so it is filtered out too.

No node passes, so the pod stays Pending and the scheduler reports the per-node
reasons. Preemption cannot help: evicting lower-priority pods would not create
64Gi. The rollout is stuck the same way as lab 02, with the old pod serving.

## Valid fixes

1. **Set a realistic request** (and limit) based on what the app needs:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab set resources deployment/report-builder -c builder \
     --requests=cpu=10m,memory=256Mi --limits=memory=512Mi
   ```

   and fix the manifest. The new ReplicaSet schedules and the rollout
   completes.

2. **Roll back** to 1.4.0 (`kubectl … rollout undo deployment/report-builder`)
   while someone measures what "larger reports" really need.

Not fixes: removing the nodeSelector (still does not fit; and it is the wrong
pool), tolerating the control-plane taint, or deleting the Pending pod (it is
recreated identically).

## Why this matters in an interview

Read the FailedScheduling message as a per-node tally and name the filter
behind each count. Distinguish requests (scheduling) from limits (runtime
enforcement, see lab 07), and Pending (not scheduled) from ContainerCreating
(scheduled, not started).
