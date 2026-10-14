#!/usr/bin/env bash
# L19 teardown: uninstall the Helm release "beacon" in namespace beacon ONLY if it is this lab's,
# remove the lab images from the kind nodes and from Docker (looped-l19-beacon:* only), and
# delete work/, .work-previous/ and .venv/. The namespace and the cluster are kept (profile
# teardown removes the cluster). evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
require_workstation helm docker kind
case "$(l19_release_state)" in
  ours) info "uninstalling release $L19_RELEASE"; h_basic uninstall "$L19_RELEASE" --wait >/dev/null ;;
  foreign) warn "release $L19_RELEASE in $SRE_NS is not this lab's; leaving it alone" ;;
  *) say "no release $L19_RELEASE installed" ;;
esac
k_basic delete pod -l "$SRE_LABEL=L19" --ignore-not-found >/dev/null
for node in $(kind get nodes --name "$SRE_KIND_BASIC" 2>/dev/null); do
  for v in $L19_VERSIONS; do
    docker exec "$node" crictl rmi "docker.io/library/$L19_IMAGE:$v" >/dev/null 2>&1 || true
  done
done
for v in $L19_VERSIONS; do docker image rm "$L19_IMAGE:$v" >/dev/null 2>&1 || true; done
for d in "$WORK" "$HERE/.work-previous" "$HERE/.venv"; do
  if [ -d "$d" ]; then rm -rf "${d:?}"; fi
done
left="$(k_basic get all -l "$SRE_LABEL=L19" -o name 2>/dev/null || true)"
[ -z "$left" ] || die "still present in $SRE_NS: $left"
info "L19 removed: no L19 objects in $SRE_NS, no looped-l19-* images; evidence/ kept"
