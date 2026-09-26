# Lab 01 — Pods were deleted during an alert: did we lose capacity?

Real-cluster version of simulated lab **ons-lab-01**.
Lessons: `les-reconcile`, `les-workloads`, `les-failure`.

## Ticket

> Overnight, during a noisy alert, someone deleted the `catalog` pods "to
> restart them", and also the `catalog-debug` toolbox pod that another
> engineer started by hand last week. A stakeholder asks: did catalog lose
> capacity, does anyone need to recreate the pods, and why did the toolbox
> never come back?
>
> **Impact:** unclear; possibly none. **Recent changes:** none to catalog in 3 days.

## Objective

1. Answer the stakeholder with evidence: what replaced the deleted catalog
   pods, which object did it, and why the toolbox is gone.
2. Bring the toolbox back (pods labelled `app=catalog-debug`) **so that the
   same mistake would not lose it again**, without disturbing catalog.

## What is simulated or simplified

- The "overnight" deletion is replayed by `inject.sh` seconds before you look,
  so ages are short. The names of the deleted pods are kept in ConfigMap
  `lab01-incident-notes` (your stand-in for the incident channel).
- One namespace, one worker node; catalog is a tiny busybox web server.

## Steps

All commands run from the repo root.

1. Once: `labs/kind/setup.sh`
2. Inject: `labs/kind/01-reconcile/inject.sh`
3. Investigate. Start with read-only commands:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab get configmap lab01-incident-notes -o yaml
   kubectl --context kind-looped-onsite -n looped-lab get deployment,replicaset,pods -o wide
   kubectl --context kind-looped-onsite -n looped-lab get pods -l app=catalog -o jsonpath='{range .items[*]}{.metadata.name}{"  owner="}{.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}{"  created="}{.metadata.creationTimestamp}{"\n"}{end}'
   kubectl --context kind-looped-onsite -n looped-lab get events --sort-by=.lastTimestamp
   kubectl --context kind-looped-onsite -n looped-lab describe replicaset --show-events=true -l app=catalog
   kubectl --context kind-looped-onsite -n looped-lab get pod catalog-debug
   ```

   Questions to answer before you change anything: which controller noticed
   the deletions? Who owns the new pods? What owned `catalog-debug`?

4. What you should observe:
   - `catalog` shows 3/3 ready within a few seconds of the deletion, with
     **new pod names** and young ages. The ReplicaSet's events show
     `SuccessfulCreate` for each replacement.
   - For a few seconds the deleted pods may still be listed (for example with
     STATUS `Error` or `Terminating`, because the web server exits non-zero on
     SIGTERM) next to their replacements.
   - `catalog-debug`: `Error from server (NotFound)`. Nothing recreated it.
   - Timing: replacements are created almost immediately; they become Ready
     after the readiness probe passes (probe period 5 s), usually within 10–20 s
     once the image is on the node.
5. Fix: your call. Keep catalog as it is.
6. Verify: `labs/kind/01-reconcile/verify.sh`
   Checks: catalog wants and has 3 ready/available replicas, all owned by a
   ReplicaSet; at least one `app=catalog-debug` pod is Ready **and** has a
   controller owner (ownerReferences). Exit 0 + `PASS …`, or `FAIL: …` lines.
7. Then read `SOLUTION.md`.
8. Reset: `labs/kind/reset.sh 01`

## Lab vs production

- Here nothing else competes for the node, so replacements schedule and start
  in seconds. In production a replacement can wait on scheduling, image pulls,
  slow readiness or a PodDisruptionBudget-driven drain elsewhere, so "it comes
  back" is not the same as "no capacity was lost".
- In production, deleting pods by hand during an incident is itself a change:
  it should be recorded, and a controller that recreates them may just
  recreate the problem.
- A long-lived debugging tool normally lives in version-controlled manifests
  (or an ephemeral debug container) rather than an unmanaged pod.

## References

- [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/)
- [ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/)
- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Garbage collection (owners and dependents)](https://kubernetes.io/docs/concepts/architecture/garbage-collection/)
