# Profile: kind-policy — a kind cluster that actually enforces NetworkPolicy

Used by **L18** (namespace RBAC and NetworkPolicy). It is a second, separately named kind
cluster, `looped-policy` (context `kind-looped-policy`), so the core cluster used by L15–L17 and
L19–L20 (`looped-foundations`, profile `kind-basic`) stays simple. Run one cluster at a time
unless Docker has at least 8 GiB.

## Why a separate profile

The Kubernetes API server stores every NetworkPolicy you give it, whether or not anything will
enforce it. Enforcement is the job of the network plugin (CNI). This profile therefore:

1. creates the cluster with `networking.disableDefaultCNI: true` — kind's own CNI, **kindnet**,
   is not installed. Newer kindnet releases have some NetworkPolicy support, but the course
   does **not** rely on it: what kindnet enforces depends on its version, and a lab that passes
   by accident on one laptop teaches the wrong lesson;
2. installs **Calico** from a pinned, checksum-verified manifest;
3. proves enforcement with a real negative test (`selftest.sh`) before L18 starts.

"The policy applied cleanly" is never evidence. A probe that times out where it used to connect
is.

## Pinned versions (tested combination)

| Component | Pin | Where |
|---|---|---|
| kind | v0.29.0 (`kind version`) | your workstation |
| Node image | `kindest/node:v1.33.1@sha256:050072256b9a903bd914c0b2866828150cb229cea0efe5892e2b644d5dd3b34f` (multi-arch: linux/arm64, linux/amd64) | `kind-config.yaml` |
| Calico | v3.30.3, manifest `https://raw.githubusercontent.com/projectcalico/calico/v3.30.3/manifests/calico.yaml` | `versions.env` |
| Calico manifest SHA-256 | `9382d2b27a76f40c170454b408653e6d71e2205ef0aef069e942bb690e7381d0` | `versions.env`; `setup.sh` refuses any other bytes |
| Calico images | `docker.io/calico/{node,cni,kube-controllers}:v3.30.3` (fixed in that manifest) | pulled by the nodes |
| Pod CIDR | `192.168.0.0/16` (Calico's default IPv4 pool) | `kind-config.yaml` |
| Self-test image | `python:3.12.7-slim-bookworm@sha256:60d9996b…b50d` | `versions.env` |

The manifest digest and the image digests were resolved on 2026-10-13. To move to a newer
Calico, change `CALICO_VERSION`, the URL and the SHA-256 together, check the Calico release
notes for Kubernetes 1.33 support, and re-run `selftest.sh`. Never point the URL at a branch.

## Create

```sh
labs/sre-cloud-foundations/profiles/kind-policy/setup.sh
```

`setup.sh` creates the cluster (nodes stay `NotReady` until a CNI exists — that is expected),
downloads the manifest to `~/.cache/looped/`, verifies the SHA-256, applies it server-side
(the CRDs are too large for client-side apply), sets `FELIX_IGNORELOOSERPF=true` on
`calico-node` (Felix refuses to start when a kind node's `rp_filter` is "loose", which some
Docker hosts set; harmless otherwise), waits for Calico, the nodes and CoreDNS, creates the
`beacon` namespace and runs the self-test. It is idempotent: on an existing `looped-policy`
cluster it checks and completes instead of recreating, and it refuses to continue if kindnet
pods are present (the cluster was created some other way).

## Prove enforcement

```sh
labs/sre-cloud-foundations/profiles/kind-policy/selftest.sh
```

In a throwaway namespace `looped-cni-selftest`: a client connects to a server pod; after a
deny-all-ingress policy it times out; after an allow for pods labelled `role=client` the
labelled client connects again while an unlabelled pod still times out. The namespace is
deleted afterwards. Any disagreement exits 1 with the command to inspect Calico.

## Delete

```sh
labs/sre-cloud-foundations/profiles/kind-policy/teardown.sh      # asks first; LOOPED_YES=1 to skip
```

Deletes only the cluster named `looped-policy` (kind also removes its kubeconfig context). The
cached manifest is kept unless `LOOPED_PURGE_CACHE=1`.

## Troubleshooting

- **Nodes NotReady for minutes:** `kubectl --context kind-looped-policy -n kube-system get pods
  -l k8s-app=calico-node` — `ImagePullBackOff` means the nodes cannot reach Docker Hub (proxy or
  rate limit); `CrashLoopBackOff` with `rp_filter` in the logs means the Felix setting did not
  apply (`kubectl … -n kube-system set env daemonset/calico-node FELIX_IGNORELOOSERPF=true`).
- **Self-test step 2 says open:** nothing enforces policy. Check that `kindnet` is absent and
  `calico-node` is Ready on every node; then re-run the self-test. Do not start L18 until it
  passes.
- **Out of memory / very slow:** delete the core cluster while you work on L18.

## Limits — what this profile does not prove

- Calico in kind enforces Kubernetes NetworkPolicy between pods on Docker's bridge network. It
  says nothing about cloud security groups, VPC routing, node firewalls, egress gateways or a
  managed provider's policy implementation, which can differ in defaults and logging.
- One laptop, two nodes: no multi-zone behaviour, no real load, no control-plane HA.
- Calico-specific features (GlobalNetworkPolicy, tiers, eBPF dataplane) are not used; the labs
  stay with portable `networking.k8s.io/v1` NetworkPolicy so the lesson transfers to Cilium or
  a managed CNI.
