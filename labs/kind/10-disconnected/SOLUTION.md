# Lab 10 — solution

## Mechanism

The kubelet asks the container runtime for `registry.invalid/looped/edge-gateway:4.2`.
With `imagePullPolicy: IfNotPresent`, the runtime first looks in the node's
image store; the image is not there, so it tries to pull, and the registry
host does not resolve. The 4.2 pod stays in `ImagePullBackOff`; the rollout
cannot progress; 4.1 keeps serving. Nothing is wrong with the manifest: a
dependency of the release is missing from the site.

## The controlled transfer (one valid fix)

Run from the repo root on your Mac. `solution/solve.sh` does the same thing.

```sh
M=labs/kind/10-disconnected/transfer/edge-gateway-4.2.manifest
INDEX=$(awk '$1=="index-digest:"{print $2}' $M)          # the trusted value
ARCH=$(kubectl --context kind-looped-onsite get nodes -l pool=general -o jsonpath='{.items[0].status.nodeInfo.architecture}')

# 1. Transfer (connected side): pull BY DIGEST. The client checks the content
#    it receives hashes to that digest.
docker pull --platform linux/$ARCH docker.io/library/busybox@$INDEX

# 2. Receiving-side check against the manifest: the image you hold carries the
#    index digest the manifest lists (and, depending on Docker's image store,
#    its ID is that index digest or the per-platform config digest).
docker image inspect --format '{{.Id}} {{json .RepoDigests}}' docker.io/library/busybox@$INDEX
grep -E "$(docker image inspect --format '{{.Id}}' docker.io/library/busybox@$INDEX)" $M   # must print a line

# 3. Name it as the release expects.
docker tag docker.io/library/busybox@$INDEX registry.invalid/looped/edge-gateway:4.2

# 4. Import into the nodes' image store.
kind load docker-image registry.invalid/looped/edge-gateway:4.2 --name looped-onsite
#    If that fails with "ctr: content digest sha256:...: not found" (Docker's
#    containerd image store + a multi-arch image, a documented kind issue),
#    export only the node's platform and load the archive instead:
docker image save --platform linux/$ARCH -o /tmp/edge-gateway-4.2.tar registry.invalid/looped/edge-gateway:4.2
kind load image-archive /tmp/edge-gateway-4.2.tar --name looped-onsite

# 5. Do not wait for the pull back-off: give the ReplicaSet a fresh pod.
kubectl --context kind-looped-onsite -n looped-lab delete pod -l app=edge-gateway --field-selector=status.phase=Pending
kubectl --context kind-looped-onsite -n looped-lab rollout status deployment/edge-gateway
```

The new pod finds the image locally (`Container image … already present on
machine`), becomes Ready, and the rollout completes. `verify.sh` then compares
the running container's `imageID` with the manifest's digests.

## Why this is enough here, and what it does not prove

- Pulling by digest plus the receiving-side comparison proves **integrity**:
  the content is exactly what the manifest names, and nothing changed in
  transit or on the import host.
- It does not prove **authenticity**: anyone can compute a SHA-256. If the
  manifest itself came from an untrusted source, the check is worthless. In a
  real site the release is **signed**, and the signature is verified against a
  public key (or identity) the site already trusts, distributed separately
  from the release; an admission controller then refuses unsigned or
  wrongly-signed images.
- Pulling `busybox:latest` (or any tag) and retagging it would also make the pod
  start, and fail verify: a tag is a mutable pointer, so you cannot know what
  you imported.

Not fixes: changing the Deployment's image to `docker.io/...` (the site cannot
reach it; and it bypasses the import controls), `imagePullPolicy: Always`
(forces a pull that cannot succeed), deleting the pod without importing.

## Why this matters in an interview

Explain the mechanism (pull policy + node image store + unreachable registry),
then the delivery process: dependency inventory by digest, transfer, integrity
check against a trusted manifest, signature check against a separately
distributed trust root, import to the mirror, admission policy. Be explicit
that a hash match is integrity, not provenance.
