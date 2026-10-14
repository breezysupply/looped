#!/usr/bin/env bash
# L25 teardown: compose down for looped-l25 (containers, network and the
# lab's own data volume looped-l25-pgdata, which holds only synthetic rows),
# the images looped-l25-report:*, then work/ (all generated secrets go with
# it). Nothing without the looped-l25 prefix is touched; the pinned base
# images stay. evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L25_PROJECT"
l25_guard
PREV="$HERE/.work-previous"
if [ -f "$WORK/compose.yaml" ]; then
  # an absent .env (variant-b) must not stop the teardown
  EXPORTER_DB_PASSWORD="${EXPORTER_DB_PASSWORD:-teardown}" l25_dc down --volumes --remove-orphans >/dev/null 2>&1 || warn "compose down reported an error; removing by name"
fi
for c in $(l25_list container); do l25_rm container "$c"; done
for v in $(l25_list volume); do l25_rm volume "$v"; done
for n in $(l25_list network); do l25_rm network "$n"; done
for i in $(l25_list image); do l25_rm image "$i"; done
[ -d "$WORK" ] && rm -rf "${WORK:?}"
[ "${LOOPED_KEEP_PREVIOUS:-0}" = 1 ] || rm -rf "${PREV:?}"
left="$(l25_list container; l25_list volume; l25_list network; l25_list image)"
[ -z "$left" ] || die "still present: $left"
info "L25 removed: no looped-l25 objects remain; evidence/ kept"
