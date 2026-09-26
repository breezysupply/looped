# Lab 01 — solution

## Mechanism

A Deployment manages a ReplicaSet; the ReplicaSet controller continuously
compares the number of pods matching its selector (and owned by it) with
`spec.replicas`. When pods are deleted, the controller sees fewer than 3 and
creates replacements from its pod template. That is reconciliation: desired
state stored in the API server, a controller driving actual state towards it.
The replacements are new pods (new names, new UIDs, new IPs), not restarted
ones. Capacity was reduced only for the seconds between the deletion and the
replacements passing readiness.

`catalog-debug` was a bare Pod. Its `metadata.ownerReferences` was empty:
no controller wanted it to exist, so once deleted there was nothing to
recreate it. A bare pod also will not be rescheduled if its node fails.

Evidence to quote: ReplicaSet events `SuccessfulCreate … Created pod: catalog-…`,
the new pods' `creationTimestamp` after `deleted-at` in the incident notes,
`ownerReferences` pointing at `ReplicaSet/catalog-…`, and `NotFound` for
`catalog-debug`.

## Valid fixes

- Run the toolbox under a controller: a Deployment (reference:
  `solution/catalog-debug-deployment.yaml`, 1 replica, label
  `app=catalog-debug`):

  ```sh
  kubectl --context kind-looped-onsite -n looped-lab apply -f labs/kind/01-reconcile/solution/catalog-debug-deployment.yaml
  ```

- A StatefulSet or a ReplicaSet with 1 replica would also pass; a Deployment
  is the usual choice for a stateless tool.

Not a fix: re-creating the bare pod (`kubectl run` or re-applying the Pod
manifest). It comes back now and is lost again the next time. verify.sh
reports exactly that.

Nothing is needed for catalog. Recreating its pods by hand would be wrong:
the ReplicaSet already did, and extra pods matching the selector would be
adopted or deleted by the controller.

## Why this matters in an interview

"Did we lose capacity?" is answered with the controller's evidence, not with
"Kubernetes self-heals". Say what reconciled (the ReplicaSet controller), what
it compared (selector matches vs `spec.replicas`), and what it cannot fix
(objects with no owner, or a bad template it will faithfully reproduce).
