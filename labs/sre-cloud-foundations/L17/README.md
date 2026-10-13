# L17 — Scheduling, memory limits, persistent storage and a controlled drain

Module M09 · ~180 min practical across weeks 25–26 (four checkpoints) · profile `kind-basic`
(cluster `looped-foundations`, namespace `beacon`) · **local only**

## Ticket

> Beacon in the shared lab cluster now has three workloads: `beacon-api` (two replicas, a
> PodDisruptionBudget), `beacon-report` (a batch-report service with a fixed 96 MiB cache) and
> `beacon-db` (PostgreSQL on a PersistentVolumeClaim, holding a known dataset of 480 readings).
> Over two weeks four tickets arrive, one per checkpoint, in `work/TICKETS.md`. Each must be
> diagnosed from events, object status and measurements — not by raising every number — and
> closed with evidence. Node maintenance is due at the end: drain a worker without breaking the
> API's disruption budget.

## Objectives

- `obj-m09-01` read FailedScheduling, OOMKilled and CrashLoopBackOff evidence and restore
  scheduling without over-provisioning
- `obj-m09-02` bind a PVC through a StorageClass, restore data after a replacement, and state
  what local volumes do not prove
- `obj-m09-05` explain a PodDisruptionBudget, perform a controlled drain, and explain why the
  budget blocked it rather than bypassing it

## Safety and scope

- Scripts run `require_kind_context kind-looped-foundations looped-foundations` first and use
  `kubectl --context kind-looped-foundations -n beacon` for everything. Objects are labelled
  `looped.lab/id=L17`; deletes are by that label or by exact name in `beacon`.
- Faults are bounded: an impossible CPU request (nothing is consumed), a memory limit below a
  fixed 96 MiB working set (the kernel kills one container in its own cgroup, never the host),
  a missing StorageClass. No load generator runs unbounded.
- `assets/drain-drill.sh` uses eviction (budgets honoured), a timeout, never `--force` or
  `--disable-eviction`, and always uncordons the node on exit.
- Images: `looped-l17-beacon:1.4.0` (built from `assets/Dockerfile`, loaded with `kind load`),
  `python:3.12.7-slim-bookworm` and `postgres:16.4`, both pinned by digest. The database password
  is the placeholder `lab-l17-db-password-not-a-real-secret`.

## What is fixture-controlled

`setup.sh` applies the baseline from `manifests/` (copied to `work/manifests/`, which you edit),
restores `assets/dataset.sql` and checks it against `assets/dataset.checksum`, then injects
variant-a. `inject.sh` edits one file in `work/manifests/` and applies it; `work/TICKETS.md` says
what was reported, not why. The report service's 96 MiB cache is fixed by design: it is the
workload's real requirement in this lab.

## Steps and checkpoints

Needs the kind-basic cluster with **two worker nodes** (for the drain in c4); see
`profiles/kind-basic/README.md`. Then:

```sh
bash labs/sre-cloud-foundations/L17/setup.sh
alias kb='kubectl --context kind-looped-foundations -n beacon'
```

**Checkpoint c1 — Pending: requests versus allocatable (week 25).** Read BEACON-OPS-1301.
`kb get pods -o wide`, `kb describe pod <pending pod>`, node allocatable. Write the evidence in
**Pending**, fix `work/manifests/10-api.yaml`, `kb apply -f` it, `kb rollout status`.

**Checkpoint c2 — OOMKilled: limits versus working set (week 25).**
`LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L17/inject.sh`, read BEACON-OPS-1302.
Find the termination reason and exit code; measure the working set (temporarily give it room,
then `kb exec deploy/beacon-report -- cat /sys/fs/cgroup/memory.current`); choose a request and
a limit with stated headroom; write **OOM**. Explain why this is not a scaling problem: more
replicas would all be killed the same way (HPA also needs metrics-server, which this profile
does not install).

**Checkpoint c3 — Storage and the known dataset (week 26).**
`LOOPED_VARIANT=variant-c bash labs/sre-cloud-foundations/L17/inject.sh`, read BEACON-OPS-1303.
`kb get pvc`, `kb describe pvc data-beacon-db-0`, `kubectl get storageclass`. The template's
storage class is immutable on an existing StatefulSet: decide what must be deleted (and what is
already lost). Bring the database back on `standard`, then
`bash labs/sre-cloud-foundations/L17/assets/restore-dataset.sh` and record the checksum in
**Storage**.

**Checkpoint c4 — Disruption budget and a controlled drain (week 26).**
`kb get pdb beacon-api` — predict what a drain does with `ALLOWED DISRUPTIONS 0`. Then
`bash labs/sre-cloud-foundations/L17/assets/drain-drill.sh` (the first attempt is expected to
time out on the budget; quote the eviction message). Make the change that lets maintenance
proceed while still protecting the API (and justify it), run the drill again until it completes,
write **Drain**, then:

```sh
python3 labs/sre-cloud-foundations/L17/validate.py --explanation-file labs/sre-cloud-foundations/L17/evidence/L17-notes.md
```

## What you should observe

- Pending: `0/3 nodes are available: 1 node(s) had untolerated taint
  {node-role.kubernetes.io/control-plane: }, 2 Insufficient cpu` — and the old pods still
  serving, because the rollout keeps `maxUnavailable: 0`.
- OOM: `Last State: Terminated, Reason: OOMKilled, Exit Code: 137`, then
  `CrashLoopBackOff` with growing back-off. Logs show the cache warming and then nothing.
- Storage: PVC `Pending` with `storageclass.storage.k8s.io "fast-ssd" not found`; the pod
  `Pending` with `pod has unbound immediate PersistentVolumeClaims` or no events at all;
  `kubectl apply` of a changed `volumeClaimTemplates` refused as forbidden.
- Drain: `error when evicting pods/"beacon-api-…" … Cannot evict pod as it would violate the
  pod's disruption budget`, retried until the timeout; after your change, `node/… drained`.

## What the validator checks

Faults a, b and c were injected; all three workloads ready; no Pending L17 pod; bounded
requests and limits everywhere; beacon-report stable with a limit at least 1.15 × its measured
working set and at most 256Mi, with the workload unchanged; the PVC Bound through `standard`;
the dataset checksum; the PDB still protecting at least one pod and allowing at least one
disruption; a blocked then completed drain since setup with no node left cordoned; your notes.
Unsafe shortcuts fail: deleting the PDB or setting `minAvailable: 0` (`pdb`), removing the
memory limit or setting it to 1Gi (`requests-bounded`, `report-memory`), shrinking the cache
(`report-memory`), skipping the restore (`dataset`), `--disable-eviction` (`drain-drill`).

## Pause / resume

Everything stays in the cluster between sessions; after a restart, start Docker and wait for
`kubectl get nodes`. `setup.sh` reuses `work/` and injects nothing. `reset.sh` deletes every L17
object including the PVC, keeps your manifests in `.work-previous/manifests` and starts again
(`LOOPED_VARIANT` chooses the first fault). `teardown.sh` removes everything L17 created.

## Lab versus production

- Allocatable here is your laptop's Docker VM; in production it is per node type, and cluster
  autoscalers add nodes for Pending pods — which makes an oversized request a cost incident
  rather than a hang.
- kind's `standard` class is the local-path provisioner: a directory on one node with
  `WaitForFirstConsumer` binding and `Delete` reclaim. Real classes add zones, snapshots and
  encryption; the binding mode and immutability lessons transfer, the durability does not.
- PDBs only govern voluntary evictions (drain, upgrades, autoscaler scale-down). A node crash
  ignores them.

## Limits — what this lab does not prove

It proves reading scheduler, kubelet and provisioner evidence, bounded resource settings, PVC
binding and a checksum-verified restore, and a budget-respecting drain on a local two-worker
kind cluster. It does not prove multi-zone durability, backup tooling or point-in-time recovery
(the "backup" is a known SQL file), cluster autoscaling, HPA (no metrics-server here), real node
failure, or behaviour under production load. Local persistent volumes do not prove durability.

## References

- T04 kind quick start (multi-node clusters, default StorageClass) · T09 PostgreSQL backup and
  restore (verify restores, not just backups) · T02 Kubernetes: debug services (evidence-first
  debugging)
