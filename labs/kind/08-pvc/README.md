# Lab 08 — ledger-db will not start in the new environment: storage claim Pending

Real-cluster version of simulated lab **ons-lab-08**.
Lessons: `les-storage`, `les-scheduling`.

## Ticket

> The ledger service is being brought up in a new environment using manifests
> copied from the existing one. `ledger-db` has been Pending ever since.
> Nothing has been written yet: the claim never bound. Get ledger-db running
> on storage that exists here, and verify. Do not touch `ledger-scratch`,
> which belongs to a batch job that has not been scheduled yet.
>
> **Impact:** new environment blocked. **Recent change:** manifests copied from another environment.

## Objective

ledger-db Ready on a bound `ledger-data` claim, using a StorageClass that
exists in this cluster; `ledger-scratch` left exactly as it is.

## What is simulated or simplified

- ledger-db is **not a database**: a busybox process writes one marker file
  (`/data/ledger.init`) and its readiness probe checks the file exists. No
  data is at risk in this lab.
- Storage is kind's default `standard` StorageClass: the local-path
  provisioner creating a directory on the node. `WaitForFirstConsumer` binding.

## Steps

1. Once: `labs/kind/setup.sh`
2. Inject: `labs/kind/08-pvc/inject.sh`
3. Investigate. Start with read-only commands:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab get pvc
   kubectl --context kind-looped-onsite -n looped-lab describe pvc --show-events=true ledger-data ledger-scratch
   kubectl --context kind-looped-onsite get storageclass
   kubectl --context kind-looped-onsite -n looped-lab get pods -l app=ledger-db
   kubectl --context kind-looped-onsite -n looped-lab describe pod --show-events=true -l app=ledger-db | grep -A6 Events
   kubectl --context kind-looped-onsite -n looped-lab get pvc ledger-data -o yaml
   ```

4. What you should observe:
   - **Two** Pending claims, for different reasons:
     - `ledger-data`: event `ProvisioningFailed … storageclass.storage.k8s.io "fast-ssd" not found`.
     - `ledger-scratch`: event `WaitForFirstConsumer … waiting for first consumer to be created before binding`.
       That one is normal: its class binds only when a pod that uses it is scheduled.
   - The ledger-db pod is `Pending` with `FailedScheduling`, for example
     `0/2 nodes are available: pod has unbound immediate PersistentVolumeClaims.`
   - `get storageclass` lists only `standard (default)`, provisioner
     `rancher.io/local-path`, binding mode `WaitForFirstConsumer`.
   - Timing: everything is Pending immediately and stays that way. After a
     correct fix, binding waits for the ledger-db pod to be scheduled, then the
     provisioner creates the volume; that usually takes a few seconds here.
5. Fix: your call. Note which PVC fields you can and cannot change on an
   existing claim.
6. Verify: `labs/kind/08-pvc/verify.sh`
   Checks: `ledger-data` Bound through a StorageClass that exists; ledger-db
   Ready and mounting `ledger-data`; `ledger-scratch` still the original object
   (same UID, recorded at inject) and still Pending.
7. Then read `SOLUTION.md`.
8. Reset: `labs/kind/reset.sh 08` (deleting the claim also deletes its
   dynamically provisioned volume: reclaim policy `Delete`).

## Lab vs production

- Real StorageClasses map to network or cloud volumes with zones, attach
  limits, encryption and quotas; "which class should this use?" is a design
  question (performance, durability, backup), not just "which one exists".
- Deleting and recreating a claim is only harmless here because it never bound
  and holds no data. With a bound claim the reclaim policy decides whether the
  data survives, so you check it first.
- For a real database you would typically use a StatefulSet with
  `volumeClaimTemplates`, not a Deployment and a hand-made claim.

## References

- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/) (volume binding mode)
- [Dynamic Volume Provisioning](https://kubernetes.io/docs/concepts/storage/dynamic-provisioning/)
