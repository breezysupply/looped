# Profile: kind-basic — the core local Kubernetes cluster

Used by L15 and L16 (and later the kind-basic parts of L17, L19, L20, L31). One ordinary kind
cluster on your Apple Silicon Mac, named `looped-foundations`, reached only through the kubectl
context `kind-looped-foundations`, with the lab namespace `beacon`. NetworkPolicy labs use a
**separate** cluster (`kind-policy`, L18) because kind's default network plugin does not enforce
policy.

| Pinned / tested | Value |
|---|---|
| kind | v0.29.0 (`brew install kind`; `kind version`) |
| Node image | `kindest/node:v1.33.1@sha256:050072256b9a903bd914c0b2866828150cb229cea0efe5892e2b644d5dd3b34f` (kind v0.29.0's built-in default node image for Kubernetes 1.33.1; the digest is a multi-platform index with linux/arm64 and linux/amd64) |
| kubectl | v1.33.x (within one minor version of the cluster) |
| Nodes | 1 control plane + 2 workers (`looped-foundations-control-plane`, `-worker`, `-worker2`) |
| Container engine | the `compose` profile's engine (Docker Desktop or colima), 4 CPUs / 8 GiB recommended |
| Beacon image | `registry.lab/beacon:1.4.0`, built locally from `image/` and loaded with `kind load docker-image` |

`registry.lab` is an invented registry name. Nothing is pushed or pulled: the image is copied
into each node's containerd store by `kind load docker-image`, and the lab manifests use
`imagePullPolicy: IfNotPresent`, so the kubelet finds it locally. A typo in the tag therefore
shows up as `ErrImagePull` — which is a lesson, not a bug (S15).

## Create

```sh
labs/sre-cloud-foundations/profiles/compose/check.sh      # engine up?
labs/sre-cloud-foundations/profiles/kind-basic/setup.sh
```

`setup.sh`:

1. checks `docker`, `kind`, `kubectl`, `python3`, and warns if kind is not v0.29.x;
2. creates **only** the cluster named `looped-foundations` from `kind-config.yaml` (an existing
   cluster of that name is reused, never recreated);
3. restores your previous kubectl current-context — `kind create` switches it, and nothing in
   the course relies on the current context;
4. runs the `require_kind_context` guard from `lib/looped.sh` (context exists, API server is
   local, every node is `looped-foundations-*`) before applying anything;
5. creates the namespace `beacon` with Pod Security admission `restricted` enforced;
6. runs `build-image.sh`: assembles a build context in `.build/` (the L13 Dockerfile, solved,
   plus a hash-checked wheelhouse fetched on the host), builds `registry.lab/beacon:1.4.0`
   natively, and `kind load docker-image`s it into the nodes.

Rebuild and reload the image after changing Beacon: `profiles/kind-basic/build-image.sh`.

## Scope rules every kind lab follows

- Every `kubectl` call passes `--context kind-looped-foundations` and `-n beacon` (the `k_basic`
  helper); deletions are by name or by `looped.lab/id=<lab>` label inside `beacon`, never
  `--all` across namespaces.
- Labs never edit or delete other contexts, clusters or kubeconfig entries.
- Only `teardown.sh` here deletes the cluster, and only with
  `kind delete cluster --name "$SRE_KIND_BASIC"` (`looped-foundations`), after asking.

## Delete

```sh
labs/sre-cloud-foundations/profiles/kind-basic/teardown.sh    # asks first; LOOPED_YES=1 to skip
```

Removes the kind cluster `looped-foundations` (its node containers and its kubeconfig context),
the image `registry.lab/beacon:1.4.0` (label `looped.lab/id=kind-basic`) and `.build/`. The
cached `kindest/node` image stays; `docker rmi kindest/node:v1.33.1` if you want the disk back.

## What this profile does not prove

- kind runs every node as a container on one machine: no zones, no real node failure, no
  cloud load balancer (`type: LoadBalancer` stays `<pending>`), no cloud identity or VPC
  routing, no managed control plane. Use `kubectl port-forward` or an in-cluster client pod to
  reach Services.
- The default kindnet network plugin does **not** enforce NetworkPolicy; a policy object being
  accepted here is not enforcement (see `kind-policy`, L18).
- No metrics-server: `kubectl top` and HPA need the observability profile.
- Storage is the node container's disk via the local-path provisioner; it says nothing about
  durability.

## Verified in the authoring environment

The node image digest above was resolved with `docker buildx imagetools inspect kindest/node:v1.33.1`
and matches the default image compiled into the kind v0.29.0 binary. The authoring container
could not start kind nodes (nested container runtime), so cluster creation itself was not
executed there; manifests were schema-checked with kubeconform v0.7.0 against Kubernetes 1.33.1
and the image build was executed.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `context kind-looped-foundations not found` | cluster not created yet, or created with another name |
| pods `ErrImagePull` / `ImagePullBackOff` for `registry.lab/beacon` | image not loaded (run `build-image.sh`) or the tag in the manifest differs |
| pods rejected with `violates PodSecurity "restricted:v1.33"` | a manifest without `runAsNonRoot`, `seccompProfile`, `allowPrivilegeEscalation: false` or `capabilities.drop: [ALL]` |
| `kind create cluster` hangs at "Starting control-plane" | engine short on memory; give Docker/colima 8 GiB |
