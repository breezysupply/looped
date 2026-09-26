# Lab 02 — Rollout stuck: new payments pods cannot pull their image

Real-cluster version of simulated lab **ons-lab-02**.
Lessons: `les-rollouts`, `les-workloads`, `les-pod-lifecycle`.

## Ticket

> The payments-api 2.8.0 release started a few minutes ago and the pipeline
> is still "waiting for rollout". Release notes: images moved to the secured
> repository path. Checkout success rate looks normal so far.
>
> **Impact:** none visible yet. **Recent change:** payments-api 2.7.0 → 2.8.0.

## Objective

Get payments-api to a **finished, healthy rollout** — by rolling back or by
fixing forward — and prove it. Explain why checkout still looks normal.

## What is simulated or simplified

- "The secured repository path" is a tag that does not exist on Docker Hub
  (`busybox:1.37.0-payments-2.8.0`, marked `# lab-fault` in the manifest). In
  this lab the real 2.8.0 build is the same pinned busybox image with
  `APP_VERSION=2.8.0`.
- `progressDeadlineSeconds` is **120** (the default is 600) so the
  ProgressDeadlineExceeded condition appears within a few minutes.
- `terminationGracePeriodSeconds: 5` (default 30) to keep rollouts quick.

## Steps

1. Once: `labs/kind/setup.sh`
2. Inject: `labs/kind/02-image-rollout/inject.sh`
3. Investigate. Start with read-only commands:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab get deployment payments-api
   kubectl --context kind-looped-onsite -n looped-lab get replicaset -l app=payments-api
   kubectl --context kind-looped-onsite -n looped-lab get pods -l app=payments-api
   kubectl --context kind-looped-onsite -n looped-lab describe pod -l app=payments-api | grep -A12 Events
   kubectl --context kind-looped-onsite -n looped-lab rollout status deployment/payments-api --timeout=10s
   kubectl --context kind-looped-onsite -n looped-lab rollout history deployment/payments-api
   kubectl --context kind-looped-onsite -n looped-lab get deployment payments-api -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}: {.message}{"\n"}{end}'
   kubectl --context kind-looped-onsite -n looped-lab get endpointslices -l kubernetes.io/service-name=payments-api
   ```

4. What you should observe:
   - Two ReplicaSets: the old one still 3/3 ready, the new one with **one** pod
     in `ErrImagePull` / `ImagePullBackOff`. With 3 replicas and the default
     strategy (maxSurge 25% → 1, maxUnavailable 25% → 0), the controller adds
     one new pod and removes no old pod until the new one is available — so
     the old pods keep serving, which is why checkout looks normal.
   - The pod's events include `Failed to pull image "docker.io/library/busybox:1.37.0-payments-2.8.0"`
     followed by the registry's answer. With network access that is
     typically `… not found`; if your nodes cannot reach Docker Hub you will
     see a DNS, connection or TLS error instead. Either way it is the kubelet
     (through the container runtime) that failed to pull.
   - Timing: the first `ErrImagePull` appears within seconds. After that the
     kubelet retries with an increasing back-off (capped at 5 minutes by
     default), so the status flips between `ErrImagePull` and
     `ImagePullBackOff`. After ~120 s the Deployment's `Progressing` condition
     becomes `False` with reason `ProgressDeadlineExceeded`, and
     `rollout status` exits with `exceeded its progress deadline`.
     The Deployment controller does **not** roll back by itself.
5. Fix: your call (roll back, or fix forward to an image that exists).
6. Verify: `labs/kind/02-image-rollout/verify.sh`
   Checks: latest generation observed; updated = ready = available = desired;
   `Progressing` reason `NewReplicaSetAvailable`; `Available=True`; no pod stuck
   pulling; the Service has as many ready endpoints as desired replicas.
7. Then read `SOLUTION.md`.
8. Reset: `labs/kind/reset.sh 02`

## Lab vs production

- A pipeline "waiting for rollout" is usually polling the same conditions you
  just read. Whether it rolls back automatically depends on the pipeline, not
  on Kubernetes.
- A rollback done with kubectl against a cluster managed from Git is drift:
  the next sync reapplies the broken version unless Git is fixed too.
- In production you would also check whether the image exists and is
  pullable **before** the rollout (registry query, admission policy,
  pinned digests), and whether image pull credentials changed with the new
  repository path.

## References

- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) (rolling update, progress deadline, rollback)
- [Images](https://kubernetes.io/docs/concepts/containers/images/) (pull policy, ImagePullBackOff)
- [kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/)
