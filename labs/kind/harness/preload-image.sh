#!/usr/bin/env bash
# HARNESS-ONLY helper. Not needed on your Mac.
#
# The sandbox the labs were tested in lets the Docker daemon on the host reach
# Docker Hub (through a host-local proxy) but the kind node containers cannot
# reach any registry. So the harness pulls each pinned image on the host and
# copies it into the nodes' containerd image store, keeping the ORIGINAL
# multi-arch index digest so the lab manifests (image: name:tag@sha256:<index>)
# resolve locally with the default IfNotPresent pull policy.
#
# Why not plain `kind load docker-image`? With Docker's containerd image store
# it fails for a partially pulled multi-arch image ("ctr: content digest ...
# not found", kind known issue #3795), and `docker image save --platform`
# rewrites the index to a new digest, which no longer matches the pinned one.
#
#   labs/kind/harness/preload-image.sh <image@sha256:...> [...]
#
# Needs python3 on the host (harness only).
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"

[ $# -ge 1 ] || die "usage: $0 <image@sha256:...> [...]"
command -v python3 >/dev/null || die "python3 is required by this harness helper"
arch=$(docker version --format '{{.Server.Arch}}')
platform="linux/$arch"
# Raw index documents are cached here (verified against the pinned digest on use).
CACHE_DIR="${LOOPED_HARNESS_CACHE:-${HOME:-/tmp}/.cache/looped-harness}"
mkdir -p "$CACHE_DIR"
nodes=$(kind get nodes --name "$CLUSTER")
[ -n "$nodes" ] || die "cluster $CLUSTER has no nodes"

for ref in "$@"; do
  case "$ref" in *@sha256:*) ;; *) die "not pinned by digest: $ref" ;; esac
  digest="${ref##*@}"
  name_tag="${ref%@*}"               # docker.io/library/busybox:1.37.0
  repo="${name_tag%:*}"               # docker.io/library/busybox
  work=$(mktemp -d)
  info "preload $ref ($platform)"
  # Registry requests are rate-limited: reuse what is already local.
  if ! docker image inspect "$repo@$digest" >/dev/null 2>&1; then
    docker pull --quiet --platform "$platform" "$repo@$digest" >/dev/null
  fi
  docker image save --platform "$platform" -o "$work/save.tar" "$repo@$digest"
  mkdir "$work/oci"
  tar -xf "$work/save.tar" -C "$work/oci"
  cached="$CACHE_DIR/${digest/:/-}.json"
  if [ ! -s "$cached" ]; then
    docker buildx imagetools inspect --raw "$repo@$digest" > "$cached.tmp" && mv "$cached.tmp" "$cached"
  fi
  cp "$cached" "$work/index.raw"
  python3 - "$work/oci" "$work/index.raw" "$digest" "$name_tag" "$repo" <<'PY'
import hashlib, json, os, sys
oci, raw_path, digest, name_tag, repo = sys.argv[1:]
raw = open(raw_path, 'rb').read()
got = 'sha256:' + hashlib.sha256(raw).hexdigest()
if got != digest:
    sys.exit('index digest mismatch: registry returned %s, pinned %s' % (got, digest))
open(os.path.join(oci, 'blobs', 'sha256', digest.split(':')[1]), 'wb').write(raw)
media = json.loads(raw).get('mediaType', 'application/vnd.oci.image.index.v1+json')
names = [name_tag, repo + '@' + digest]
json.dump({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.index.v1+json',
           'manifests': [{'mediaType': media, 'digest': digest, 'size': len(raw),
                          'annotations': {'io.containerd.image.name': n}} for n in names]},
          open(os.path.join(oci, 'index.json'), 'w'))
for f in ('manifest.json', 'repositories'):
    p = os.path.join(oci, f)
    if os.path.exists(p): os.remove(p)
open(os.path.join(oci, 'oci-layout'), 'w').write('{"imageLayoutVersion":"1.0.0"}')
print('   index digest verified:', got)
PY
  tar -cf "$work/oci.tar" -C "$work/oci" .
  for n in $nodes; do
    docker exec -i "$n" ctr -n k8s.io images import --platform "$platform" --snapshotter=overlayfs - \
      < "$work/oci.tar" 2>&1 | grep -v -e DEPRECATION -e '^Importing' -e 'saved' -e 'index.v1' -e 'list.v2' || true
    say "   loaded into $n"
  done
  rm -rf "$work"
done
