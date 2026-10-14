# L17 worked solution

`alias kb='kubectl --context kind-looped-foundations -n beacon'`

## c1 — Pending (variant-a)

```
$ kb get pods -o wide
beacon-api-6d9c…-x2k9q   0/1  Pending  0  4m   <none>  <none>
beacon-api-7f4b…-a1b2c   1/1  Running  0  40m  10.244.1.5  looped-foundations-worker
$ kb describe pod beacon-api-6d9c…-x2k9q | tail -3
  Warning  FailedScheduling  … 0/3 nodes are available: 1 node(s) had untolerated taint
  {node-role.kubernetes.io/control-plane: }, 2 Insufficient cpu. preemption: …
$ kubectl --context kind-looped-foundations get nodes -o custom-columns=N:.metadata.name,CPU:.status.allocatable.cpu
```

The new ReplicaSet's pod asks for `cpu: "64"`; no node has 64 allocatable CPUs, so the scheduler
never binds it. The old pods keep serving because `maxUnavailable: 0`. Fix: restore
`requests: {cpu: 100m, memory: 64Mi}` in `work/manifests/10-api.yaml`, `kb apply -f` it,
`kb rollout status deploy/beacon-api`. Not a fix: adding nodes, removing requests (BestEffort
pods are evicted first and make scheduling meaningless), or a 4-CPU request "to be safe".

## c2 — OOMKilled (variant-b)

```
$ kb get pods -l app=beacon-report
beacon-report-…   0/1  CrashLoopBackOff  4  3m
$ kb get pod beacon-report-… -o jsonpath='{.status.containerStatuses[0].lastState.terminated}'
{"exitCode":137,"reason":"OOMKilled",…}
$ kb logs beacon-report-… --previous
beacon-report: warming 96 MiB report cache
```

It is scheduled (so not a request problem) and killed at run time by the kernel when the cgroup
exceeds `limits.memory: 64Mi`. Measure with room: temporarily set the limit to 256Mi, then
`kb exec deploy/beacon-report -- cat /sys/fs/cgroup/memory.current` → about 115,000,000 bytes
(~110 MiB: the 96 MiB cache plus the interpreter). Set `requests.memory: 128Mi` (what the
scheduler should reserve) and `limits.memory: 160Mi` (~45% headroom), apply, watch the restart
count stay put. Not a fix: removing the limit (one leak can then starve the node), lowering
`REPORT_WORKING_SET_MB` (changes the product), or adding replicas (each would be OOM-killed).

## c3 — storage and the dataset (variant-c)

```
$ kb get pvc
data-beacon-db-0  Pending  …  fast-ssd
$ kb describe pvc data-beacon-db-0 | tail -2
  Warning  ProvisioningFailed  … storageclass.storage.k8s.io "fast-ssd" not found
$ kubectl --context kind-looped-foundations get storageclass
standard (default)  rancher.io/local-path  Delete  WaitForFirstConsumer
```

Changing `storageClassName` and re-applying is refused (`spec: Forbidden: updates to statefulset
spec for fields other than …`): volumeClaimTemplates are immutable. So: edit the file back to
`standard`, `kb delete statefulset beacon-db`, `kb delete pvc data-beacon-db-0` (it is Pending
and holds nothing; the old volume was already deleted by the rebuild), `kb apply -f
work/manifests/30-db.yaml`, `kb rollout status statefulset/beacon-db`, then
`bash labs/sre-cloud-foundations/L17/assets/restore-dataset.sh` → `checksum:
480:2ef6f6aa0300b7c08c7026ffb8ace7e8 (expected …)`, `PASS dataset verified`. A row count alone
is not proof: the checksum covers every column of every row.

## c4 — drain with a budget

`kb get pdb beacon-api` → `MIN AVAILABLE 2, ALLOWED DISRUPTIONS 0` with two replicas. First drill:

```
evicting pod beacon/beacon-api-…
error when evicting pods/"beacon-api-…" -n "beacon" (will retry after 5s): Cannot evict pod as it
would violate the pod's disruption budget.
error: unable to drain node "looped-foundations-worker2" due to error: … timed out
uncordoned looped-foundations-worker2
```

The budget is doing its job: evicting either pod would leave one. Safe options: set
`replicas: 3` in `10-api.yaml` (ALLOWED DISRUPTIONS becomes 1; the evicted pod is replaced on the
other worker before the next eviction is allowed), or keep 3 replicas and express the budget as
`maxUnavailable: 1`. Re-run the drill → `node/looped-foundations-worker2 drained`, then uncordon
(the script does). Not safe: deleting the PDB, `minAvailable: 0`, `kubectl drain
--disable-eviction` or deleting pods by hand — each "works" by removing the protection the
budget expresses.

## Independent variant (variant-d)

The database pod is Pending after the change (`Insufficient memory`): 64Gi requests fit no node.
The StatefulSet deleted the running pod before the new one could schedule — an outage caused by a
scheduling fault. Right-size (128Mi/512Mi), apply; the PVC survived, so `restore-dataset.sh
--verify` passes without a restore.
