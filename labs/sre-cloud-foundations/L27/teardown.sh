#!/usr/bin/env bash
# L27 teardown: stop any running load (the loadgen container is removed with
# the project), compose down project looped-l27 including its data volume
# looped-l27-pgdata (synthetic rows only), then remove work/. Nothing without
# the looped-l27 prefix is touched; pinned base images stay; evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L27_PROJECT"
l27_guard
PREV="$HERE/.work-previous"
if [ -f "$WORK/compose.yaml" ]; then
  l27_dc --profile tools down --volumes --remove-orphans >/dev/null 2>&1 || warn "compose down reported an error; removing by name"
fi
for c in $(l27_list container); do l27_rm container "$c"; done
for v in $(l27_list volume); do l27_rm volume "$v"; done
for n in $(l27_list network); do l27_rm network "$n"; done
[ -d "$WORK" ] && rm -rf "${WORK:?}"
[ "${LOOPED_KEEP_PREVIOUS:-0}" = 1 ] || rm -rf "${PREV:?}"
left="$(l27_list container; l27_list volume; l27_list network)"
[ -z "$left" ] || die "still present: $left"
info "L27 removed: no looped-l27 objects remain; evidence/ kept"
