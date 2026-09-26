# Lab 10 — Edge site: release 4.2 cannot start, an image is missing from the site

Real-cluster version of simulated lab **ons-lab-10**.
Lessons: `les-disconnected`, `les-rollouts`, `les-pod-lifecycle`.

> **This lab SIMULATES a missing dependency. It is not network isolation.**
> Your kind nodes can still reach the internet. The "site mirror" is the
> nodes' own image store, the "disconnected" part is an image name on the
> reserved, never-resolvable host `registry.invalid`, and the "transfer" is a
> `docker pull` on your Mac followed by `kind load`.

## Ticket

> An edge site runs disconnected; its cluster can only use images already
> present locally, and nothing is pulled from public registries. Release 4.2 of
> `edge-gateway` was applied a few minutes ago and its new pod cannot start.
> 4.1 is still running. The change ticket carries a transfer manifest for 4.2:
> `labs/kind/10-disconnected/transfer/edge-gateway-4.2.manifest`.
>
> **Impact:** release blocked; 4.1 serving. **Recent change:** edge-gateway 4.1 → 4.2.

## Objective

Get release 4.2 running **as released** (same image name, no public registry
in the Deployment) using only content whose digest matches the transfer
manifest, and verify.

Site import rules (the "policy" for this lab):

1. Fetch the release content by **digest**, never by tag.
2. Before importing, check on the receiving side that what you hold has the
   digest the transfer manifest lists. If not, stop.
3. Import it under the name the release expects,
   `registry.invalid/looped/edge-gateway:4.2`, into the cluster nodes.
4. Do not change the Deployment's image to a public registry.

Tools you will need on your Mac: `docker pull`, `docker image inspect`,
`docker tag`, and `kind load` (see `kind load --help`). Kubernetes tools as
usual.

## What is simulated or simplified

- `registry.invalid` is a reserved name that never resolves, standing in for
  "the site cannot reach any registry". The node still has internet access
  for everything else.
- The "release 4.2" image is the public, pinned busybox image, renamed. Its
  digests are in the transfer manifest.
- The integrity check is a **digest comparison against a value you already
  trust** (the manifest in the ticket). It proves the bytes are the ones named
  there; it does **not** prove who built or published them. That needs a
  signature verified against a trusted key that is distributed separately
  (and an admission policy that enforces it). Neither is part of this lab.
- 4.1 runs from the same busybox content, already on the node since setup.

## Steps

1. Once: `labs/kind/setup.sh`
2. Inject: `labs/kind/10-disconnected/inject.sh` (it also removes any 4.2
   image a previous attempt imported into the nodes, so the lab starts broken
   every time).
3. Investigate. Start with read-only commands:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab get deployment,replicaset,pods -l app=edge-gateway
   kubectl --context kind-looped-onsite -n looped-lab describe pod --show-events=true -l app=edge-gateway | grep -A10 Events
   kubectl --context kind-looped-onsite -n looped-lab get deployment edge-gateway -o jsonpath='{.spec.template.spec.containers[0].image}  pullPolicy={.spec.template.spec.containers[0].imagePullPolicy}{"\n"}'
   cat labs/kind/10-disconnected/transfer/edge-gateway-4.2.manifest
   docker exec looped-onsite-worker crictl images      # what the node's image store holds
   ```

4. What you should observe:
   - Old 4.1 pod Running; new 4.2 pod `ErrImagePull` / `ImagePullBackOff`.
   - Event: `Failed to pull image "registry.invalid/looped/edge-gateway:4.2": … lookup registry.invalid … no such host`.
     With `imagePullPolicy: IfNotPresent`, the kubelet only tries the registry
     because the image is **not in the node's store**; if it were, it would use
     it without any network.
   - `crictl images` on the worker shows busybox but no `registry.invalid/…`.
   - Timing: the first failure is immediate; the kubelet then retries with
     back-off up to 5 minutes by default. After you import the image, the pod
     starts at its next retry — or immediately if you give the ReplicaSet a
     fresh pod.
5. Fix: your call, following the site import rules. If `kind load
   docker-image` fails with `ctr: content digest sha256:…: not found`, read the
   troubleshooting section of `labs/kind/README.md`.
6. Verify: `labs/kind/10-disconnected/verify.sh`
   Checks: the Deployment still names `registry.invalid/looped/edge-gateway:4.2`
   with pull policy `IfNotPresent` or `Never`, and `APP_VERSION=4.2`; rollout
   complete; each running container's `imageID` digest is one listed in the
   transfer manifest (index, per-platform manifest or per-platform config).
7. Then read `SOLUTION.md`.
8. Reset: `labs/kind/reset.sh 10` (removes the lab objects and the imported
   image **name** from the lab nodes). The `registry.invalid/…` tag in your
   local Docker stays; remove it with `docker rmi` if you like.

## Lab vs production

- A real disconnected site has a registry mirror, a controlled import host,
  signed bundles, a dependency inventory (every image, chart and binary a
  release needs, by digest) and an admission policy that only admits images
  signed by trusted keys. This lab covers only "fetch by digest, compare with
  a trusted manifest, import, run".
- The digest in the manifest is only as trustworthy as the channel that
  delivered the manifest.
- A missing dependency is best caught **before** the release reaches the site:
  compare the release's image list with the mirror's contents as part of the
  transfer, not after the rollout stalls.

## References

- [Images](https://kubernetes.io/docs/concepts/containers/images/) (pull policy, image indexes)
- kind [Quick Start: loading an image into your cluster](https://kind.sigs.k8s.io/docs/user/quick-start/#loading-an-image-into-your-cluster)
- kind [Known Issues](https://kind.sigs.k8s.io/docs/user/known-issues/) (`kind load` with the containerd image store)
- [Verify Signed Kubernetes Artifacts](https://kubernetes.io/docs/tasks/administer-cluster/verify-signed-artifacts/) (how signature verification differs from a digest check)
