# Lab 08 — solution

## Mechanism

A PersistentVolumeClaim names a StorageClass. For dynamic provisioning, the
class tells the control plane which provisioner creates the volume and when to
bind. The copied claim asks for `fast-ssd`, which does not exist here, so no
provisioner acts: `ProvisioningFailed … "fast-ssd" not found`, and the claim
stays Pending. A pod that mounts an unbound claim cannot be scheduled.

`ledger-scratch` is Pending for a healthy reason: `standard` uses
`WaitForFirstConsumer`, so it binds only when a pod using it is scheduled (so
the volume can be created where the pod runs). No consumer yet, so no volume.

## Valid fix

`spec.storageClassName` cannot be changed on an existing claim (most of a
claim's spec is immutable after creation). The claim never bound and holds no
data, so replace it:

```sh
kubectl --context kind-looped-onsite -n looped-lab scale deployment/ledger-db --replicas=0
kubectl --context kind-looped-onsite -n looped-lab delete pvc ledger-data
kubectl --context kind-looped-onsite -n looped-lab apply -f labs/kind/08-pvc/solution/ledger-data-pvc.yaml
kubectl --context kind-looped-onsite -n looped-lab scale deployment/ledger-db --replicas=1
```

Scaling down first matters: the `kubernetes.io/pvc-protection` finalizer keeps
a claim that a pod still references from being removed, so the delete would
otherwise wait. Omitting `storageClassName` entirely also works here (the
default class is used). Fix the copied manifest too, so the next environment
does not repeat this.

Once ledger-db's pod is scheduled, the local-path provisioner creates a volume
on that node, the claim binds, the container writes its marker file and
becomes Ready.

Not fixes: creating a StorageClass named `fast-ssd` that points at the same
provisioner (it works mechanically, but hides the mismatch and invents a
performance tier that does not exist); touching `ledger-scratch`.

## Why this matters in an interview

Two Pending claims, two different reasons: read the claim's events, not just
its phase. Then explain binding modes (Immediate vs WaitForFirstConsumer) and
why storage can block scheduling.
