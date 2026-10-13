#!/usr/bin/env bash
# L21 teardown: remove the compose project looped-l21 (api, worker, registry;
# it has no volumes) and work/. The observability profile is NOT stopped here:
# run profiles/observability/teardown.sh when you are done with telemetry labs.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
l21_guard
l21_dc down --remove-orphans >/dev/null 2>&1 || warn "compose down reported an error"
left="$(docker ps -a --format '{{.Names}}' | grep -E '^looped-l21-' || true)"
[ -z "$left" ] || die "still present: $left"
[ -d "$WORK" ] && rm -rf "${WORK:?}"
rm -rf "${HERE:?}/.work-previous"
info "L21 removed (evidence/ kept). Stop the profile with: bash $SRE_ROOT/profiles/observability/teardown.sh"
