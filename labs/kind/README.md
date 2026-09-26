# Real Kubernetes labs on kind

Ten incident labs you run against a real (small, local) Kubernetes cluster. Each
one mirrors a simulated onsite lab in the app (`ons-lab-01` … `ons-lab-10`):
same kind of ticket, same mechanism, but here the scheduler, kubelet, probes,
OOM killer, API server and RBAC are the real thing, so timings and messages are
real too.

The cluster is [kind](https://kind.sigs.k8s.io/) ("Kubernetes in Docker"): each
node is a Docker container on your machine. It is disposable. It is also not
production: see [Lab vs production](#lab-vs-production) before you draw
conclusions from it.

| Lab | You practise | Mirrors | Time |
|---|---|---|---|
| [01-reconcile](01-reconcile/) | Pods deleted: what comes back, what does not, and why | ons-lab-01 | ~20 min |
| [02-image-rollout](02-image-rollout/) | A release whose image cannot be pulled; a stalled rollout | ons-lab-02 | ~25 min |
| [03-service-selector](03-service-selector/) | Healthy pods, a Service with no endpoints | ons-lab-03 | ~20 min |
| [04-probes](04-probes/) | Readiness vs liveness; a slow starter killed by its own probe | ons-lab-04 | ~30 min |
| [05-pending](05-pending/) | A pod that never schedules | ons-lab-05 | ~20 min |
| [06-crashloop](06-crashloop/) | CrashLoopBackOff: finding the actual cause | ons-lab-06 | ~25 min |
| [07-oom-vs-kill](07-oom-vs-kill/) | Two exit-137s with different causes | ons-lab-07 | ~30 min |
| [08-pvc](08-pvc/) | A claim that never binds | ons-lab-08 | ~25 min |
| [09-rbac](09-rbac/) | Running and Ready, but the API says 403 | ons-lab-09 | ~25 min |
| [10-disconnected](10-disconnected/) | A release whose image is missing from a disconnected site | ons-lab-10 | ~35 min |

What actually ran when these labs were tested, and where, is recorded in
[EXECUTION.md](EXECUTION.md). Short version: every lab was executed end to end
on a Linux amd64 sandbox; **nothing was executed on Apple Silicon**.

---

## Safety model

These scripts are written so they cannot touch a cluster you care about.

- **Dedicated names.** Cluster `looped-onsite`, kubectl context
  `kind-looped-onsite`, namespace `looped-lab`. They are constants in
  `lib/common.sh`, not environment variables.
- **Every kubectl call passes `--context kind-looped-onsite`.** Scripts go
  through two wrappers, `k` (context + namespace `looped-lab`) and `kc`
  (context only). Nothing reads or changes your *current* context. (kind itself
  switches your current context to `kind-looped-onsite` when it creates the
  cluster; switch back with `kubectl config use-context <yours>` if you like.
  The labs do not care.)
- **Preflight refuses** (`lib/preflight.sh`, exit 1 with the reason) if Docker
  is not reachable, `kind` (v0.33.0+) or `kubectl` is missing, the context
  `kind-looped-onsite` does not exist, its API server is not a local address
  (127.0.0.1, localhost, ::1, 0.0.0.0), or any node is not named
  `looped-onsite-*`. It prints your architecture and tool versions first.
  `lib/preflight.sh --context-only` runs just the context check.
- **Faults are namespace-scoped.** Labs create and break objects in
  `looped-lab` only. No node is cordoned, tainted or modified.
- **Clean-up deletes only lab objects.** `reset.sh` deletes objects labelled
  `looped.lab/id=<NN>` (plus a few names a fix creates, listed in each lab's
  `owned.txt`) in `looped-lab`, and for lab 10 the one image it imports into
  the lab nodes. `teardown.sh` deletes the cluster `looped-onsite` and refuses
  any argument other than `--yes` / `--dry-run`, so it cannot be pointed at
  another cluster.
- **Workloads are unprivileged.** No hostPath, no privileged containers, no
  hostNetwork/hostPID, no added capabilities; every pod runs as a non-root
  user with `allowPrivilegeEscalation: false`, all capabilities dropped and the
  RuntimeDefault seccomp profile. `setup.sh` labels the namespace for Pod
  Security admission: `enforce=baseline` (which rejects privileged pods, host
  namespaces and hostPath volumes) and `warn`/`audit=restricted`.
- **No new cluster-wide permissions.** The labs create one namespaced Role and
  RoleBinding (lab 09) and never grant cluster-admin. Note: the kubeconfig
  entry kind writes for you is itself a cluster-admin credential. That is a
  convenience for a throwaway local cluster, **not** how people or automation
  should get access to a real cluster.
- **No cloud credentials, no paid resources, no real databases.** Lab 08's
  "database" writes one marker file.

---

## Prerequisites (Apple Silicon Mac)

You need a Docker engine, `kind` and `kubectl`. Everything used here is
multi-arch (linux/arm64 and linux/amd64), so nothing runs under emulation and
Rosetta is not needed for the cluster.

1. **A Docker engine**, one of:
   - Docker Desktop: Settings → Resources. Give the VM at least **4 GB of
     memory** (6 GB is comfortable) and 2+ CPUs.
   - colima: `colima start --cpu 4 --memory 6` (the default docker runtime is
     what kind needs). Check `docker context ls` points at colima.
   - Others that provide the `docker` CLI may work but were not tried.
2. **kind v0.33.0 or newer.** The node image below is the one kind v0.33.0
   uses for Kubernetes v1.37.0; older kind releases may not start it.
   `brew install kind`, or the release binary for `darwin-arm64` from the kind
   [Quick Start](https://kind.sigs.k8s.io/docs/user/quick-start/#installation).
   Check with `kind version`.
3. **kubectl** within one minor version of v1.37 (1.36–1.38).
   `brew install kubectl`, or see
   [Install kubectl on macOS](https://kubernetes.io/docs/tasks/tools/install-kubectl-macos/).
   Docker Desktop may ship its own older kubectl earlier on your PATH; check
   with `kubectl version --client`. Preflight warns about version skew.
4. **bash** (the macOS system bash 3.2 is fine), `awk`, `sed`, `grep`, `date`.

## What gets downloaded

| What | From | Size (approx.) | When |
|---|---|---|---|
| `kind` binary | kind releases (Homebrew or kind.sigs.k8s.io/dl) | ~10 MB | once, by you |
| `kubectl` binary | Homebrew or dl.k8s.io | ~60 MB | once, by you |
| Node image `kindest/node:v1.37.0@sha256:a1ed56cf…` | Docker Hub | ~355 MB compressed for arm64 (~388 MB amd64); about 1.3 GB unpacked | first `setup.sh` |
| `busybox:1.37.0@sha256:bdf57e52…` | Docker Hub | ~2 MB | pulled by the worker node during `setup.sh` |
| `curlimages/curl:8.16.0@sha256:463eaf60…` | Docker Hub | ~14 MB | pulled by the worker node during `setup.sh` (lab 09) |
| busybox again, into your local Docker | Docker Hub | ~2 MB | lab 10, the "transfer" step |

The cluster also runs images that are **already inside** the node image
(CoreDNS, kindnetd, the local-path storage provisioner, the control plane), so
they are not downloaded separately.

**Offline:** once `setup.sh` has run, the images live in the worker node's
container store, and every lab except the transfer step of lab 10 works with no
network. If you delete and recreate the cluster, the node image stays in your
local Docker but the busybox/curl images must be pulled again.

## Images and how the architecture check was done

Every image is pinned by its multi-arch **index** digest. The kubelet resolves
the index to the right per-platform image for the node (arm64 on your Mac), so
the same manifests work on arm64 and amd64.

| Image | Index digest | Platforms confirmed in the index |
|---|---|---|
| `kindest/node:v1.37.0` | `sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5` | linux/amd64, linux/arm64 |
| `docker.io/library/busybox:1.37.0` | `sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e` | linux/amd64, linux/arm64/v8 (and 7 others) |
| `docker.io/curlimages/curl:8.16.0` | `sha256:463eaf6072688fe96ac64fa623fe73e1dbe25d8ad6c34404a669ad3ce1f104b6` | linux/amd64, linux/arm64/v8 (and 3 others) |

The check (run on 2026-09-26; you can repeat it):

```sh
docker buildx imagetools inspect kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5
docker buildx imagetools inspect docker.io/library/busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e
docker buildx imagetools inspect docker.io/curlimages/curl:8.16.0@sha256:463eaf6072688fe96ac64fa623fe73e1dbe25d8ad6c34404a669ad3ce1f104b6
```

Each prints a `Manifests:` list; the linux/amd64 and linux/arm64 entries were
present for all three. A digest pins *content*; it says nothing about who
published it (see lab 10).

Two manifests deliberately reference images that do not exist (lab 02's
release tag and lab 10's `registry.invalid/...` name). They carry a
`# lab-fault:` comment.

---

## Setup

From the repo root:

```sh
labs/kind/setup.sh
```

It runs preflight, creates the cluster from `kind-config.yaml` if it does not
exist (one control-plane node, one worker labelled `pool=general`, API server on
127.0.0.1), waits for the nodes, creates namespace `looped-lab`, and pre-pulls
busybox and curl on the worker with two short-lived pods. It is idempotent: run
it again any time. `--no-warm` skips the pre-pull.

Optional shortcut (it still pins the lab context and namespace):

```sh
alias kl='kubectl --context kind-looped-onsite -n looped-lab'
```

The lab READMEs spell commands out in full so you can paste them without the
alias.

## How a lab flows

```
setup (once) → inject → investigate → fix → verify → reset
```

1. **Read the lab's README.md** — the ticket, the objective, what is simulated.
   Do not open `SOLUTION.md` or `solution/` yet.
2. **Inject:** `labs/kind/NN-name/inject.sh` — runs preflight, resets that lab,
   applies the broken state. Re-running it always starts the lab over.
3. **Investigate.** Each README lists read-only commands to start with and
   what you should see, including how long it takes to appear (probe periods,
   back-off and image pull retries are real timers here). Note: kubectl 1.37
   `describe` prints events by default only when it describes a single
   object, so the READMEs add `--show-events=true` to `describe … -l …`.
4. **Fix it** your way. There is usually more than one valid fix.
5. **Verify:** `labs/kind/NN-name/verify.sh` — checks the cluster's *state*
   (not the commands you typed). It prints `PASS …` and exits 0, or prints
   `FAIL: <what is still wrong>` lines and exits 1. It fails on the injected
   state by design. Some checks need a container to have stayed up for a while
   (for example 60 s in labs 04 and 07); the message says so — wait and re-run.
6. **Read SOLUTION.md** — the mechanism, valid fixes and why.
7. **Reset:** `labs/kind/reset.sh NN` (or `all`). `labs/kind/reset.sh namespace`
   deletes and recreates the whole `looped-lab` namespace, which also removes
   anything you created there by hand.

When you are finished for good: `labs/kind/teardown.sh` (asks you to type the
cluster name; `--yes` skips the prompt).

---

## Troubleshooting setup

**`PREFLIGHT REFUSED: Docker is not reachable`** — start Docker Desktop or
`colima start`, then `docker info`. With colima or several engines, check
`docker context ls` and `docker context use <name>`.

**`kind create cluster` fails or nodes never become Ready / pods get
OOMKilled at random** — usually not enough memory for the Docker VM. Raise it
(4 GB minimum, 6 GB comfortable), restart the engine, then
`labs/kind/teardown.sh --yes && labs/kind/setup.sh`. `docker info` shows the
engine's total memory; preflight warns below about 4 GB.

**Port conflicts** — the API server binds a random free port on 127.0.0.1, and
this config maps no other host ports, so conflicts are unlikely. If creation
says a port is in use, find the other process (`lsof -iTCP -sTCP:LISTEN`) or an
old cluster (`kind get clusters`).

**Image pulls fail during setup (`ErrImagePull`, `toomanyrequests`, TLS or
proxy errors)** — Docker Hub rate-limits anonymous pulls; `docker login` on the
host does **not** apply inside the kind nodes. Wait and re-run `setup.sh`, or
pull the images on the host and load them (see the kind
[Quick Start](https://kind.sigs.k8s.io/docs/user/quick-start/#loading-an-image-into-your-cluster)).
Behind a corporate proxy, kind passes `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`
from your environment to the nodes at creation time; a proxy that intercepts
TLS also needs its CA trusted inside the nodes, which is outside the scope of
these labs.

**`kind load docker-image` fails with `ctr: content digest sha256:…: not
found`** — a documented kind issue when Docker uses the containerd image store
and the image is multi-arch. Lab 10's SOLUTION.md covers the workaround the
kind docs give (export only your node's platform and use
`kind load image-archive`). See
[Known Issues](https://kind.sigs.k8s.io/docs/user/known-issues/).

**`kind … too old` / `PREFLIGHT REFUSED: kind vX is older than v0.33.0`** —
upgrade kind (`brew upgrade kind`). Node images are built for specific kind
releases.

**cgroup problems on a Linux host** (not a Mac concern: Docker Desktop and
colima VMs use cgroup v2) — Kubernetes deprecated cgroup v1 in v1.35, and by
default the kubelet no longer starts on a cgroup v1 node (the kubelet setting
`failCgroupV1` controls this); kind prints a deprecation warning on such hosts.
Use a host with cgroup v2 (`stat -fc %T /sys/fs/cgroup/` prints `cgroup2fs`). Very
old kernels without cgroup namespaces are not supported by kind at all. See
[About cgroup v2](https://kubernetes.io/docs/concepts/architecture/cgroups/) and
kind's [Known Issues](https://kind.sigs.k8s.io/docs/user/known-issues/).

**`PREFLIGHT REFUSED: kubectl context 'kind-looped-onsite' not found`** but
`kind get clusters` lists `looped-onsite` — your kubeconfig lost the entry;
`setup.sh` re-exports it (`kind export kubeconfig --name looped-onsite`).

**`PREFLIGHT REFUSED: … not a local address` or `… nodes not named
looped-onsite-*`** — something else is using that context name. Do not work
around it; find out what that context points at (`kubectl config get-contexts`).

---

## Lab vs production

What transfers: the mechanisms (controllers reconciling, scheduler filters,
kubelet probes and restarts, OOM kills, Service → EndpointSlice selection,
PVC binding, RBAC evaluation, image resolution) and the diagnostic habits
(events, `describe`, `logs --previous`, `lastState`, `auth can-i`).

What does not:

- **Scale and noise.** Two nodes, a handful of pods, no competing tenants, no
  autoscalers, no admission webhooks, no service mesh, no GitOps controller
  reverting your changes.
- **Access.** You are cluster-admin via kind's generated kubeconfig. In
  production you would have a scoped identity, and many of these fixes would go
  through a change in Git and a pipeline rather than `kubectl` against the live
  cluster.
- **Timing knobs.** Some values are shortened so symptoms appear in minutes
  (for example lab 02's `progressDeadlineSeconds: 120`, default 600;
  `terminationGracePeriodSeconds` of 5–10 s, default 30). Each README says so.
- **Storage** is kind's `standard` class, backed by node-local directories
  through the local-path provisioner. Real clusters use network or cloud
  volumes with attach/detach, zones and quotas.
- **Disconnected delivery** (lab 10) is simulated with an unresolvable registry
  name and `kind load`; it is not network isolation, and a digest check is not
  a signature check.

Being able to do these labs is useful evidence of understanding. It is not the
same as operating production clusters, and it is worth saying that plainly if
it comes up.

## NetworkPolicy (conceptual only)

There is deliberately no NetworkPolicy lab. Namespaces do not isolate traffic;
NetworkPolicy objects do, but **only if the cluster's CNI plugin enforces
them**. These labs do not assume kind's default CNI enforces NetworkPolicy, and
a lab that "passes" because nothing was enforced would teach the wrong thing.
Read [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
and kind's [Configuration](https://kind.sigs.k8s.io/docs/user/configuration/)
page (networking section) if you want to set up a CNI that enforces it.

---

## Files

```
kind-config.yaml       the cluster definition (pinned node image)
setup.sh               create/reuse cluster, namespace, pre-pull images
reset.sh <NN|all|namespace>
teardown.sh [--yes|--dry-run]
lib/common.sh          constants, k()/kc() wrappers, wait helpers, reset logic
lib/preflight.sh       safety checks [--setup|--context-only]
NN-name/README.md      the ticket and the steps (no solution)
NN-name/inject.sh      reset this lab, then apply the broken state
NN-name/verify.sh      PASS/FAIL on the repaired state
NN-name/manifests/     what inject applies
NN-name/SOLUTION.md    mechanism, valid fixes, why
NN-name/solution/      the scripted reference fix (solve.sh) used by the harness
NN-name/harness.sh     symptom assertions for the harness
harness/run-lab.sh     automated end-to-end runner (maintainers)
EXECUTION.md           what actually ran, where, with what result
```

`harness/run-lab.sh <NN|all>` runs inject → waits for the expected symptom →
`verify.sh` must fail → `solution/solve.sh` → `verify.sh` must pass → reset.
You do not need it to do the labs, and running it spoils them. Its
`LOOPED_HARNESS=1` mode exists only for the sandbox the labs were tested in
(see EXECUTION.md); do not use it on your Mac.

## References

- kind: [Quick Start](https://kind.sigs.k8s.io/docs/user/quick-start/), [Configuration](https://kind.sigs.k8s.io/docs/user/configuration/), [Known Issues](https://kind.sigs.k8s.io/docs/user/known-issues/)
- [Install and set up kubectl on macOS](https://kubernetes.io/docs/tasks/tools/install-kubectl-macos/)
- [Version skew policy](https://kubernetes.io/releases/version-skew-policy/)
- [Organizing cluster access using kubeconfig files](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/)
- [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) and [Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/)
- [Images](https://kubernetes.io/docs/concepts/containers/images/)
- [About cgroup v2](https://kubernetes.io/docs/concepts/architecture/cgroups/)
- [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
