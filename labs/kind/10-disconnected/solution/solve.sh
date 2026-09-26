#!/usr/bin/env bash
# Reference fix for lab 10 (used by the harness). Try the lab before reading this.
# The controlled transfer: fetch by digest, check against the trusted manifest,
# name it for the site, load it into the nodes' image store.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
preflight >/dev/null
MANIFEST="$LAB_DIR/transfer/edge-gateway-4.2.manifest"

name=$(awk '$1=="image-name:"{print $2}' "$MANIFEST")
src=$(awk '$1=="source:"{print $2}' "$MANIFEST")
index=$(awk '$1=="index-digest:"{print $2}' "$MANIFEST")
repo="${src%:*}"
arch=$(kc get nodes -l pool=general -o jsonpath='{.items[0].status.nodeInfo.architecture}')
platform="linux/$arch"
allowed=$(awk '$1 ~ /^(index-digest|manifest-|config-)/ {print $2}' "$MANIFEST")

# 1. Transfer (connected side): pull BY DIGEST, never by tag.
if ! docker image inspect "$repo@$index" >/dev/null 2>&1; then
  docker pull --platform "$platform" "$repo@$index"
fi

# 2. Receiving-side check against the trusted manifest.
id=$(docker image inspect --format '{{.Id}}' "$repo@$index")
digests=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$repo@$index")
printf '%s\n' "$digests" | grep -q "@$index\$" || die "received image does not carry index digest $index"
printf '%s\n' "$allowed" | grep -qxF "$id" || die "received image ID $id is not listed in the transfer manifest"
say "digest check OK: $repo@$index (image ID $id)"

# 3. Name it as the site expects.
docker tag "$repo@$index" "$name"

# 4. Load into the kind nodes. With Docker's containerd image store,
#    'kind load docker-image' can fail for a multi-arch image ("content digest
#    ... not found", kind known issue); then export only the node's platform.
if ! kind load docker-image "$name" --name "$CLUSTER"; then
  tmp=$(mktemp -d)
  docker image save --platform "$platform" -o "$tmp/edge-gateway-4.2.tar" "$name"
  kind load image-archive "$tmp/edge-gateway-4.2.tar" --name "$CLUSTER"
  rm -rf "$tmp"
fi

# 5. The stuck pod would retry after its current image back-off (up to 5 min);
#    delete it so the ReplicaSet creates a fresh one that finds the image.
for p in $(k get pods -l app=edge-gateway -o jsonpath='{range .items[*]}{.metadata.name}={.status.containerStatuses[0].state.waiting.reason}{"\n"}{end}' | awk -F= '$2=="ImagePullBackOff"||$2=="ErrImagePull"{print $1}'); do
  k delete pod "$p" --wait=false
done
wait_rollout edge-gateway 240
