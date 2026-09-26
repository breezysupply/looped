# Lab 02 — solution

## Mechanism

A Deployment rollout creates a new ReplicaSet from the new pod template and
shifts replicas to it within the limits of `maxSurge` / `maxUnavailable`. The
kubelet on the chosen node asks the container runtime to pull
`busybox:1.37.0-payments-2.8.0`; the registry has no such tag, so the pull
fails (`ErrImagePull`) and the kubelet retries with back-off
(`ImagePullBackOff`). The new pod never becomes Ready, so the controller
never scales the old ReplicaSet down: old pods keep serving and the
Service's EndpointSlices still list them. After `progressDeadlineSeconds`
without progress, the controller sets `Progressing=False,
reason=ProgressDeadlineExceeded`. That is a signal for humans and pipelines;
the controller keeps the stalled state and does not undo anything.

## Valid fixes

1. **Roll back** to the previous revision:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab rollout undo deployment/payments-api
   kubectl --context kind-looped-onsite -n looped-lab rollout status deployment/payments-api
   ```

   This copies revision 1's pod template into the Deployment (image and
   `APP_VERSION=2.7.0`). kubectl warns that the `last-applied-configuration`
   annotation is now stale: the source of truth (your manifest / Git) still
   says 2.8.0 and must be fixed too, or the next apply reintroduces the fault.

2. **Fix forward** with an image that exists, keeping 2.8.0's config:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab set image deployment/payments-api \
     api=docker.io/library/busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e
   ```

   (or edit the manifest and apply it). Pinning by digest means the release is
   exactly the bytes you tested.

Either way the rollout completes: the new/restored ReplicaSet reaches 3
available and the other is scaled to 0. A completed rollout proves the pods
became Ready by their probes; it does not prove 2.8.0 is correct.

Not fixes: deleting the stuck pod (the ReplicaSet recreates it with the same
bad image), `kubectl rollout restart` (restarts with the same template), or
scaling the Deployment down.

## Why this matters in an interview

Say which component failed (the kubelet's pull, not the scheduler), why
users were unaffected (surge-first rolling update kept old pods), what the
progress deadline does and does not do, and how rollback interacts with the
declared source of truth.
