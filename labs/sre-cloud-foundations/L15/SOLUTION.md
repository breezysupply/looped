# L15 worked solution

`K="kubectl --context kind-looped-foundations -n beacon"`; `F=labs/sre-cloud-foundations/L15/work/deployment.yaml`

## The chain (all variants)

`deploy/beacon` (desired: 3 replicas of a pod template) → the Deployment controller creates
`rs/beacon-<pod-template-hash>` for the current template → the ReplicaSet controller creates
pods `beacon-<hash>-<suffix>` with `ownerReferences` to the ReplicaSet → the scheduler binds
them to nodes → each node's kubelet starts the containers. Delete a pod and the ReplicaSet
controller notices 2 < 3 and creates another (`$K get events` shows `SuccessfulCreate` from
`replicaset-controller`). Change the template and the Deployment controller creates a **new**
ReplicaSet and scales old down / new up within `maxSurge: 1`, `maxUnavailable: 0`.

The CR-1042 edit in `work/deployment.yaml`:

```yaml
  template:
    metadata:
      labels:
        app.kubernetes.io/name: beacon
        looped.lab/id: L15
        tier: api                      # new: template only, never the selector
    ...
          env:
            - name: BEACON_APP_ENVIRONMENT
              value: kind-lab-l15      # was kind-lab
```

## Variant A — replicas drifted out of band

Observation: `$K get deploy beacon` → `READY 1/1`; the file says 3. `kubectl diff -f $F` shows
`-  replicas: 1` / `+  replicas: 3`. `$K describe deploy beacon` events: `Scaled down replica set
beacon-… to 1`. Nothing is broken in the controllers: the live **spec** was changed (someone ran
`kubectl scale`), and the controllers faithfully reconciled to the new spec.

Fix: make the CR-1042 edit and `kubectl --context kind-looped-foundations apply -f $F`. The apply
restores `replicas: 3` from the file at the same time; say so in your notes. Do not "fix" with
another `kubectl scale` — that is a second out-of-band change, and `kubectl diff` would still
disagree with the file whenever the two differ.

## Variant B — the edit in work/ is rejected

Observation: `kubectl apply -f $F` → `The Deployment "beacon" is invalid: spec.selector: Invalid
value: …: field is immutable`. The working copy added `tier: api` to `spec.selector.matchLabels`
as well as the template. In `apps/v1` a Deployment's selector cannot change after creation (it
would orphan the existing ReplicaSets and pods). `--dry-run=server` gives the same answer without
touching anything.

Fix: remove `tier: api` from the selector, keep it in the template labels, set the environment
value, apply. The selector still matches (it is a subset of the template labels), and the rollout
creates a new ReplicaSet. Rejected: deleting and recreating the Deployment with the new selector —
it "works", but it is an outage-shaped change for a label request, and it is not what the change
asked for.

## Variant C — applied but nothing rolls out

Observation: `kubectl apply -f $F` → `deployment.apps/beacon configured`, yet `$K get pods -L tier`
shows no `tier` label, `/version` still says `kind-lab`, and `$K rollout status deploy/beacon`
prints `Waiting for deployment "beacon" rollout to finish: 0 out of 3 new replicas have been
updated...` (or reports the deployment as paused). `$K get deploy beacon -o jsonpath='{.spec.paused}'`
→ `true`; `describe` shows `Progressing … DeploymentPaused`. The spec changed, status did not
follow, because the Deployment controller does not roll out a paused Deployment.

Fix: `$K rollout resume deploy/beacon`, then `$K rollout status deploy/beacon`. Explain who
paused it is unknown and that `paused` is part of the live spec but not of your file
(client-side apply does not remove fields it never set), which is why `kubectl diff` stayed quiet.

## Proof

```
$K get deploy,rs -l app.kubernetes.io/name=beacon     # deploy 3/3; new rs 3, old rs 0
$K get pods -L tier                                    # 3 Running, tier=api
kubectl --context kind-looped-foundations diff -f $F  # (no output, exit 0)
python3 labs/sre-cloud-foundations/L15/validate.py    # PASS L15
```
