#!/usr/bin/env bash
# Build the Beacon image used by the kind-basic labs and load it into the
# kind cluster's nodes. Image: registry.lab/beacon:1.4.0 (registry.lab is an
# invented name: nothing is pushed or pulled; manifests use
# imagePullPolicy: IfNotPresent and find the loaded copy on each node).
#   bash build-image.sh            build natively, then kind load into looped-foundations
#   bash build-image.sh --no-load  build only
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../lib/looped.sh"
command -v docker >/dev/null 2>&1 || die "docker CLI not found"
docker info >/dev/null 2>&1 || die "Docker is not reachable; start Docker Desktop / colima"
IMAGE="registry.lab/beacon:1.4.0"
B="$HERE/.build"
rm -rf "${B:?}"
mkdir -p "$B/wheels"
cp -R "$HERE/image/." "$B/"
cp -R "$SRE_BEACON/beacon" "$B/beacon"
command -v python3 >/dev/null 2>&1 || die "python3 not found (needed to fetch the wheelhouse)"
info "Fetching the pinned wheels into $B/wheels"
for plat in manylinux2014_aarch64 manylinux2014_x86_64; do
  python3 -m pip download --quiet --disable-pip-version-check --no-deps --only-binary=:all: \
    --python-version 3.12 --implementation cp --platform "$plat" \
    -d "$B/wheels" -r "$B/requirements.lock" || die "pip download failed for $plat"
done
info "docker build -t $IMAGE"
docker build --label "$SRE_LABEL=kind-basic" -t "$IMAGE" "$B"
say "built $IMAGE ($(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$IMAGE"))"
if [ "${1:-}" != "--no-load" ]; then
  kind get clusters 2>/dev/null | grep -qx "$SRE_KIND_BASIC" || die "cluster $SRE_KIND_BASIC not found; run setup.sh"
  info "kind load docker-image $IMAGE --name $SRE_KIND_BASIC"
  kind load docker-image "$IMAGE" --name "$SRE_KIND_BASIC"
fi
