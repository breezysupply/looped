# Lab 05 — report-builder release stuck with a Pending pod

Real-cluster version of simulated lab **ons-lab-05**.
Lessons: `les-scheduling`, `les-resources`, `les-rollouts`.

## Ticket

> The report-builder 1.5.0 release went out a few minutes ago; its new pod has
> been Pending since. The release "raised memory for larger reports". Get the
> release running on the general pool without touching other pools.
>
> **Impact:** none yet (1.4.0 still serving). **Recent change:** report-builder 1.4.0 → 1.5.0.

## Objective

Get report-builder fully rolled out, on nodes labelled `pool=general`, and
verify. Explain exactly why the scheduler refused.

## What is simulated or simplified

- Two nodes: a control-plane node (tainted, as kind does for multi-node
  clusters) and one worker labelled `pool=general`. The sim's cordoned node
  and GPU pool are not reproduced; no node is modified.
- Node capacity is whatever your Docker VM has; kind nodes report the VM's
  memory. The 1.5.0 request (64Gi) is chosen to be larger than any laptop VM.

## Steps

1. Once: `labs/kind/setup.sh`
2. Inject: `labs/kind/05-pending/inject.sh`
3. Investigate. Start with read-only commands:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab get deployment,pods -l app=report-builder -o wide
   kubectl --context kind-looped-onsite -n looped-lab describe pod --show-events=true -l app=report-builder | grep -A6 Events
   kubectl --context kind-looped-onsite -n looped-lab get events --field-selector reason=FailedScheduling
   kubectl --context kind-looped-onsite get nodes -L pool
   kubectl --context kind-looped-onsite describe node -l pool=general | grep -A8 -E 'Allocatable|Allocated resources'
   kubectl --context kind-looped-onsite -n looped-lab get deployment report-builder -o jsonpath='{.spec.template.spec.containers[0].resources}{"\n"}'
   kubectl --context kind-looped-onsite -n looped-lab rollout history deployment/report-builder
   ```

4. What you should observe:
   - One Running 1.4.0 pod and one `Pending` 1.5.0 pod with no node assigned.
   - `FailedScheduling` from `default-scheduler`, for example:
     `0/2 nodes are available: 1 Insufficient memory, 1 node(s) had untolerated taint(s). preemption: …`
     — one reason per node that was filtered out. The exact wording varies by
     version.
   - Compare the pod's memory **request** with the worker's **allocatable**
     memory. The scheduler uses requests, not actual usage.
   - Timing: Pending appears immediately; the scheduler retries, but nothing
     will change until the request or the nodes do. Old pods keep serving
     because the rollout adds the new pod before removing the old one.
5. Fix: your call.
6. Verify: `labs/kind/05-pending/verify.sh`
   Checks: rollout complete (updated = ready = available = desired, reason
   `NewReplicaSetAvailable`); no Pending report-builder pod; every memory
   request fits a `pool=general` node's allocatable memory; the template still
   selects `pool=general`.
7. Then read `SOLUTION.md`.
8. Reset: `labs/kind/reset.sh 05`

## Lab vs production

- In production the question is usually "which node group could fit this, and
  should it?": node sizes, autoscaler limits, quotas (a ResourceQuota or
  LimitRange can reject or default requests), taints for special pools, and
  what the application measurably needs.
- A cluster autoscaler may add a node for a request that fits a larger
  instance type; here nothing ever will.
- Removing the nodeSelector or tolerating a taint to "make it fit" moves the
  problem onto someone else's pool.

## References

- [Kubernetes Scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)
- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)
