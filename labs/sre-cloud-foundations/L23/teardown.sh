#!/usr/bin/env bash
# L23 teardown: remove the compose project looped-l23 — its containers, its
# network and its named volume looped-l23-data (explicit teardown is the only
# place a volume is removed) — and work/. evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L23_PROJECT"
l23_guard
l23_dc --profile fault down -v --remove-orphans >/dev/null 2>&1 || warn "compose down reported an error"
left="$(docker ps -a --format '{{.Names}}' | grep -E '^looped-l23-' || true; docker volume ls --format '{{.Name}}' | grep -E '^looped-l23-' || true)"
[ -z "$left" ] || die "still present: $left"
[ -d "$WORK" ] && rm -rf "${WORK:?}"
info "L23 removed: no looped-l23-* containers or volumes remain; evidence/ kept"
