#!/usr/bin/env bash
# L26 teardown: the receiver deployment (Compose project looped-l26-recv and
# its anonymous volumes), the internal registry container with its storage,
# the two lab networks, the lab's image tags (looped-l26/*,
# registry.lab/looped-l26/*, 127.0.0.1:15026/looped-l26/*), then work/ —
# keys, bundles and all. Pinned base images (postgres, python, registry) stay.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L26_PROJECT"
l26_guard
PREV="$HERE/.work-previous"
docker compose -p "$L26_PROJECT" down --volumes --remove-orphans >/dev/null 2>&1 || true
for c in $(l26_list container); do l26_rm container "$c"; done
for n in $(l26_list network); do l26_rm network "$n"; done
for i in $(l26_list image); do l26_rm image "$i"; done
[ -d "$WORK" ] && rm -rf "${WORK:?}"
[ "${LOOPED_KEEP_PREVIOUS:-0}" = 1 ] || rm -rf "${PREV:?}"
left="$(l26_list container; l26_list network; l26_list image)"
[ -z "$left" ] || die "still present: $left"
info "L26 removed: no L26 containers, networks or image tags remain; evidence/ kept"
