#!/usr/bin/env bash
# L28 teardown: compose down project looped-l28 with every profile, removing
# its containers, network and its two lab volumes (looped-l28-primary,
# looped-l28-restored: synthetic data only), then work/. Nothing without the
# looped-l28 prefix is touched; evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L28_PROJECT"
l28_guard
PREV="$HERE/.work-previous"
if [ -f "$WORK/compose.yaml" ]; then
  l28_dc --profile restore --profile scratch down --volumes --remove-orphans >/dev/null 2>&1 || warn "compose down reported an error; removing by name"
fi
for c in $(l28_list container); do l28_rm container "$c"; done
for v in $(l28_list volume); do l28_rm volume "$v"; done
for n in $(l28_list network); do l28_rm network "$n"; done
[ -d "$WORK" ] && rm -rf "${WORK:?}"
[ "${LOOPED_KEEP_PREVIOUS:-0}" = 1 ] || rm -rf "${PREV:?}"
left="$(l28_list container; l28_list volume; l28_list network)"
[ -z "$left" ] || die "still present: $left"
info "L28 removed: no looped-l28 objects remain; evidence/ kept"
