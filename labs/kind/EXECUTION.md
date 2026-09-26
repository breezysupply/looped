# What actually ran

This file records only what was really executed while building these labs.

**Nothing was executed on Apple Silicon.** No lab was run on macOS or on
arm64. Everything below ran on one Linux amd64 sandbox, with harness-only
workarounds described in the next section. The multi-arch claims (arm64 +
amd64) rest on the image index check in `README.md`, not on a run.

## Environment

| | |
|---|---|
| Date | 2026-09-26. Final clean run 01:45:16Z – 01:53:52Z; lab 09 re-run 01:54:45Z; manual checks until about 02:05Z |
| Host | Linux 6.18.44 x86_64 (amd64) sandbox VM, Ubuntu 24.04.4 LTS, 4 CPUs, ~16 GB memory |
| Docker | 29.3.1 (client and server, linux/amd64); **cgroup v1**, cgroupfs driver; containerd image store |
| kind | v0.33.0 go1.26.7 linux/amd64 |
| kubectl | v1.37.1 (client); cluster v1.37.0 |
| Nodes | `looped-onsite-control-plane`, `looped-onsite-worker`: Debian 13 node image, containerd 2.3.4, Kubernetes v1.37.0 |
| Node image used | `looped-harness/kind-node:v1.37.0-oomclamp` (local build on top of `kindest/node:v1.37.0@sha256:a1ed56cf…`, see workaround 2) |
| Lab images | busybox `sha256:bdf57e52…`, curl `sha256:463eaf60…` (the pinned digests in `README.md`) |

## Harness-only workarounds (none of them are in the user-facing files)

The runner was `LOOPED_HARNESS=1 labs/kind/harness/run-lab.sh all`. With
`LOOPED_HARNESS=1`, and only then, `run-lab.sh` creates the cluster itself:

1. **`failCgroupV1: false`** (a KubeletConfiguration patch added to a temporary
   copy of `kind-config.yaml`). This sandbox is a cgroup v1 host; kubelet 1.37
   does not start on cgroup v1 by default. *Not needed on macOS:* Docker
   Desktop and colima run a Linux VM with cgroup v2.
2. **`--image looped-harness/kind-node:v1.37.0-oomclamp`**, a locally built
   node image whose runc wrapper clamps negative `oomScoreAdj` values to 0. The
   sandbox VM lacks CAP_SYS_RESOURCE, so runc cannot set negative
   `oom_score_adj` for system pods. *Not needed on macOS:* the Docker VM does
   not have that restriction. Positive values (used by ordinary Burstable lab
   pods) are unaffected; see lab 07 for what that means for the OOM lab.
3. **Proxy variables unset for `kind create`.** In this sandbox only the host's
   Docker daemon can reach Docker Hub, through a host-local proxy that the node
   containers cannot reach; kind would otherwise copy that unreachable proxy
   address into the nodes. *Not needed on macOS* unless you are behind a proxy
   yourself.
4. **Lab images copied into the nodes** by `harness/preload-image.sh`: the
   host's Docker pulls busybox and curl by digest (or reuses its local copy),
   and the script imports a single-platform archive into each node's
   containerd, keeping the original multi-arch index digest so the lab
   manifests resolve locally. It also caches the raw index documents, because
   Docker Hub returned `429 Too Many Requests` (anonymous pull limit) once
   during development. *Not needed on macOS:* your kind nodes pull the images
   themselves during `setup.sh`. Consequence: the node-side pull path of
   `setup.sh` (the "warm" pods pulling from Docker Hub) was **not** exercised
   here; the warm pods ran against the preloaded images
   (`warm-busybox: image present on the worker`,
   `warm-curl: image present on the worker`).

A different sandbox networking route (exposing the host proxy to the node
containers) was tried during development and abandoned; nothing from it
remains.

## Summary

Every lab went through: `inject.sh` → the expected symptom asserted by the
lab's `harness.sh` → `verify.sh` must FAIL → `solution/solve.sh` → `verify.sh`
polled until PASS → `reset.sh NN` with no labelled objects left.

| Lab | Status | Symptom observed | verify.sh before fix | verify.sh after fix | Total |
|---|---|---|---|---|---|
| 01-reconcile | executed | yes, 7 s after inject | FAIL (exit 1) | PASS (exit 0), 1st attempt | 19 s |
| 02-image-rollout | executed | yes, 121 s after inject (waits for the progress deadline) | FAIL | PASS, 1st attempt | 133 s |
| 03-service-selector | executed | yes, 4 s | FAIL | PASS, 1st attempt | 19 s |
| 04-probes | executed | yes, 22 s | FAIL | PASS, 4th attempt, 19 s after solve.sh | 96 s |
| 05-pending | executed | yes, immediately | FAIL | PASS, 1st attempt | 13 s |
| 06-crashloop | executed | yes, 4 s | FAIL | PASS, 5th attempt, 24 s after solve.sh | 39 s |
| 07-oom-vs-kill | executed | yes, 37 s | FAIL | PASS, 3rd attempt, 13 s after solve.sh | 116 s |
| 08-pvc | executed | yes, immediately | FAIL | PASS, 1st attempt | 12 s |
| 09-rbac | executed | yes, immediately | FAIL | PASS, 1st attempt | 11 s (re-run, see lab 09) |
| 10-disconnected | executed | yes, 3 s | FAIL | PASS, 1st attempt | 17 s |

Harness summary line of the final run: `01-reconcile PASS` … `10-disconnected PASS`, exit 0.
"Attempts" > 1 are verify.sh correctly reporting that a container had not yet
been up long enough (`only been running 46s (need 60s)`), then passing.

## Per lab

### 01-reconcile — executed

- Symptom: `catalog 3/3` with three new pod names seconds after the deletion;
  `Error from server (NotFound): pods "catalog-debug" not found`; ReplicaSet
  events `SuccessfulCreate … Created pod: catalog-78c4887695-jtx2q` (and two
  more).
- verify before: `FAIL: no pod labelled app=catalog-debug exists: the debug toolbox is still gone`.
- verify after (Deployment `catalog-debug` applied): `PASS catalog has 3/3 ready replicas owned by its ReplicaSet, and the catalog-debug toolbox is Ready and controller-managed`.
- Different from the README: for a few seconds the deleted pods were still
  listed with STATUS `Error` (busybox httpd exits non-zero on SIGTERM) next to
  the Running replacements. The README now mentions this.

### 02-image-rollout — executed

- Symptom: old ReplicaSet `3 3 3`, new `1 1 0`; new pod `ImagePullBackOff`;
  `error: deployment "payments-api" exceeded its progress deadline`;
  `Progressing=False ProgressDeadlineExceeded: ReplicaSet "payments-api-769f9cc99c" has timed out progressing.`
- Pull error **in this sandbox**: `… failed to do request: Head "https://registry-1.docker.io/v2/library/busybox/manifests/1.37.0-payments-2.8.0": tls: failed to verify certificate: x509: certificate signed by unknown authority`
  — the nodes have no working route to Docker Hub here. With network access
  the registry would answer `not found`; that message was **not** observed here.
- verify before: `FAIL: updated replicas 1, desired 3 …`, `FAIL: Progressing condition reason is 'ProgressDeadlineExceeded' …`, `FAIL: pods still cannot pull their image: …=ImagePullBackOff`.
- verify after (`rollout undo`): `PASS payments-api rollout is complete: 3 updated, ready and available; no image pull failures; 3 ready endpoints`.
  kubectl printed the documented warning about the stale `last-applied-configuration` annotation.
- Timing: ProgressDeadlineExceeded after ~120 s, as configured.

### 03-service-selector — executed

- Symptom: `orders-api 3/3`; Service selector `app=orders-api,tier=backend`;
  EndpointSlice `ENDPOINTS <unset>`; storefront log
  `01:48:31 GET http://orders:8080/ -> orders-api ok (…)` then
  `01:48:35 GET http://orders:8080/ FAILED: wget: can't connect to remote host (10.96.248.112): Connection refused`.
- verify before: `FAIL: Service selector tier=backend is not in the orders-api pod template labels …`, `FAIL: Service orders has 0 ready endpoint(s) …`, `FAIL: request from storefront to http://orders:8080/ failed …`.
- verify after (selector key removed): `PASS Service orders matches the orders-api pod template, has 3 ready endpoints, and storefront gets a response`.

### 04-probes — executed

- Symptom at 22 s: both search-api pods `0/1 Running 0` restarts;
  `Readiness probe failed: HTTP probe failed with statuscode: 404`;
  search-indexer `2 (2s ago)` restarts, `Container indexer failed liveness probe, will be restarted`;
  previous log `01:48:59 warming index (takes about 40s)` / `01:49:09 received SIGTERM, exiting`; `lastState=Error exit=143`.
- verify before: `FAIL: search-api has 0/2 ready replicas (2 updated)`, `FAIL: Service search-api has 0 ready endpoint(s), expected 2`, and the indexer lines.
- verify after (readiness path fixed; startupProbe added): FAIL twice with `only been running 46s / 52s (need 60s …)`, then `PASS search-api is Ready behind its Service and search-indexer has stayed up for 60s+, with readiness and liveness probes still in place`.
- Note: `kubectl get endpointslices` lists the not-ready addresses
  (`10.244.1.21,10.244.1.20`); the `ready: false` condition is only visible
  with `-o yaml`. The README says so.

### 05-pending — executed

- Symptom: `0/2 nodes are available: 1 Insufficient memory, 1 node(s) had untolerated taint(s). preemption: 0/2 nodes are available: 2 Preemption is not helpful for scheduling.`
  Worker allocatable memory here: `16481980Ki`.
- verify before: `FAIL: Progressing condition reason is 'ReplicaSetUpdated' …`, `FAIL: still Pending: …`, `FAIL: memory request 64Gi does not fit any pool=general node (largest allocatable 16095Mi)`.
- verify after (`set resources` to 256Mi/512Mi): `PASS report-builder is rolled out on the general pool with a memory request that fits the node`.

### 06-crashloop — executed

- Symptom at 4 s: `notify-api-54597f5444-wqh2d 0/1 CrashLoopBackOff 1 (3s ago)`;
  `lastState: reason=Error exitCode=1`; `logs --previous`:
  `FATAL: NOTIFY_ENDPOINT is not set (expected key 'endpoint' in ConfigMap notify-config); exiting 1`;
  2.9.0 pods kept serving (`2/2 available`).
- verify before: `FAIL: rollout not finished …`, `FAIL: … is waiting: CrashLoopBackOff`, …
- verify after (ConfigMap created + `rollout restart`): FAIL on uptime for ~20 s, then `PASS notify-api is fully rolled out and every container has stayed up for 20s+`.

### 07-oom-vs-kill — executed

- Symptom at 37 s:
  `thumbnailer-…: lastState.terminated reason=OOMKilled exitCode=137 restarts=2`, previous log ending at `batch 1: loading 500 images into memory`;
  `transcoder-…: lastState.terminated reason=Error exitCode=137 restarts=1`, events `Liveness probe failed: … connection refused` and `Container transcoder failed liveness probe, will be restarted`.
- verify before: `FAIL: thumbnailer-…: container is not running (last termination: OOMKilled/137)`, `FAIL: transcoder-…: … last termination: Error/137 …`.
- verify after (thumbnailer limit 192Mi; transcoder startupProbe): FAIL on uptime twice, then `PASS thumbnailer completes batches and both workloads have stayed up for 60s+`.
- The oom-score clamp (workaround 2) did **not** change the outcome: the
  kernel OOM-killed the container at its memory limit and the kubelet reported
  `OOMKilled`, as the README describes. The clamp only affects negative
  scores; these pods' scores are positive. Because the sandbox is cgroup v1,
  the lab keeps the memory in PID 1 so that the container (not just a child
  process) is killed on both cgroup v1 and v2; OOM behaviour on a cgroup v2
  macOS VM was **not** observed.

### 08-pvc — executed

- Symptom: both claims Pending; `ProvisioningFailed storageclass.storage.k8s.io "fast-ssd" not found`;
  `WaitForFirstConsumer waiting for first consumer to be created before binding`;
  `0/2 nodes are available: pod has unbound immediate PersistentVolumeClaims. not found`.
- verify before: `FAIL: claim ledger-data is Pending, not Bound`, `FAIL: … StorageClass 'fast-ssd', which does not exist …`, `FAIL: ledger-db has 0/1 ready replicas`.
- verify after (scale 0, delete claim, recreate on `standard`, scale 1): `PASS ledger-data is Bound, ledger-db is Ready on it, and ledger-scratch is untouched`.

### 09-rbac — executed

- In the final all-labs run the lab passed, but the app's log line was cut off
  after `User \"` (a grep in the lab's script stopped at the first escaped
  quote). That was fixed in `manifests/stock-sync.yaml` and lab 09 was re-run
  alone on the same cluster at 01:54:45Z; the results below are from that
  re-run.
- Symptom: pod `1/1 Running 0`; log
  `sync failed: HTTP 403 "message": "configmaps is forbidden: User \"system:serviceaccount:looped-lab:stock-sync\" cannot list resource \"configmaps\" in API group \"\" in the namespace \"looped-lab\""`;
  `auth can-i … --as=…` → `no`; RoleBinding SERVICEACCOUNTS column `inventory-old/stock-sync`.
- verify before: `FAIL: stock-sync cannot get configmaps in looped-lab`, `FAIL: stock-sync cannot list configmaps in looped-lab`, `FAIL: stock-sync's latest log line is not a successful sync: …`.
- verify after (subject namespace patched to `looped-lab`): `PASS stock-sync can get/list ConfigMaps in looped-lab and nothing more that was checked; its last sync succeeded`
  (this includes the still-denied checks: create/update/delete configmaps, secrets, pods, other namespaces, `*` on `*`).

### 10-disconnected — executed

- Symptom: 4.1 pod Running; 4.2 pod `ErrImagePull`;
  `Failed to pull image "registry.invalid/looped/edge-gateway:4.2": … dial tcp: lookup registry.invalid on 172.18.0.1:53: no such host`.
- verify before: `FAIL: Progressing condition reason is 'NewReplicaSetCreated' …`, `FAIL: edge-gateway-… is waiting: ErrImagePull`.
- solve.sh: digest check OK (`image ID sha256:bdf57e52…`, the index digest,
  because Docker here uses the containerd image store); `kind load docker-image`
  **failed** exactly as kind's Known Issues describe:
  `ctr: content digest sha256:88132f86…: not found`; the fallback
  `docker image save --platform linux/amd64` + `kind load image-archive`
  worked; the stuck pod was deleted and the rollout completed.
- verify after: `PASS edge-gateway 4.2 runs registry.invalid/looped/edge-gateway:4.2 from the node's image store, with content matching the transfer manifest`.
- `reset.sh 10` removed only the `registry.invalid/…` name from the nodes;
  busybox stayed (`docker.io/library/busybox 1.37.0 30ecbe1509090` in
  `crictl images` afterwards).

## Other checks that were run

- **README commands.** Each lab was injected again and every command in its
  README code blocks was run (except `-w` watches and `<new-pod-name>`
  placeholders). All succeeded, except the ones that are meant to exit non-zero
  on the broken state (`get pod catalog-debug` → NotFound, `rollout status` →
  timeout, `auth can-i` → `no`), and lab 07's `logs deployment/transcoder
  --previous`, which had nothing yet 25 s after inject (the first liveness kill
  comes later; the README gives 30–90 s). Two README problems found this way
  were fixed and the fixed forms re-checked: kubectl 1.37 `describe` only shows
  events for a single object by default (READMEs now pass
  `--show-events=true`), and busybox `nslookup orders` exits 1 after trying the
  other search domains even though it prints the answer (README now uses the
  full name).
- **Lab 10 SOLUTION.md, run verbatim** as a learner would (not via solve.sh),
  after removing the local `registry.invalid/…` tag: `docker pull` by digest
  (`Image is up to date`), the `grep` of the image ID against the manifest
  printed `index-digest: sha256:bdf57e52…`, `kind load docker-image` failed with
  the known issue, the documented fallback worked, `delete pod
  --field-selector=status.phase=Pending` removed the stuck pod, rollout
  completed, `verify.sh` → PASS.
- **Safety checks:** `preflight.sh` refused with `DOCKER_HOST` pointing at a
  missing socket (`Docker is not reachable`), with kind absent from PATH, with a
  fake `kind v0.29.0` (`older than v0.33.0`), and with a kubeconfig whose
  `kind-looped-onsite` context points at `https://10.20.30.40:6443`
  (`not a local address`, also when invoked through `01-reconcile/verify.sh`).
  `teardown.sh other` → `REFUSED`, exit 2; `teardown.sh` with a wrong typed
  confirmation → `Not confirmed; nothing deleted.`, cluster still listed.
  `reset.sh all` and `reset.sh namespace` (namespace deleted and recreated with
  its Pod Security labels) ran cleanly.
- **Not exercised:** the refusal for nodes not named `looped-onsite-*` (it
  would need a second local cluster); `setup.sh` creating the cluster with the
  user-facing `kind-config.yaml` unmodified (the harness always adds workaround
  1 here); node-side image pulls (workaround 4); any alternative fix in the
  SOLUTION files other than the scripted ones and lab 10's manual sequence.
- `tests/data/test-kind-assets.js` (static checks) passes.

## Issues found by running, and fixed before the final run

- `verify.sh` in labs 01/04/07/08 read several jsonpath fields separated by
  spaces; an absent field (e.g. `readyReplicas` when 0) shifted the others, so
  lab 04 once reported "2/2 ready" for 0 ready. Now `|`-separated.
- EndpointSlice counting used a jsonpath filter that errors on a slice with no
  endpoints; replaced by a go-template helper (`ready_endpoints`).
- Lab 10 reset first used `crictl rmi`, which removes an image **by ID**, and
  so also removed the busybox content every other lab uses (pods then could
  not start). Now `ctr images rm <name>` removes only the lab's name.
- The thumbnailer originally allocated memory in a child process (`dd`). On
  cgroup v1 the OOM killer can kill just that child, so the container would not
  terminate; the batch memory now lives in PID 1.
- Single-replica rollouts (labs 05, 06, 10) could look complete by replica
  counts alone; their `verify.sh` now also requires `Progressing` reason
  `NewReplicaSetAvailable`.

The cluster was deleted afterwards with `labs/kind/teardown.sh --yes` (which runs
`kind delete cluster --name looped-onsite`): `Deleted cluster 'looped-onsite'`,
then `kind get clusters` → `No kind clusters found.`
