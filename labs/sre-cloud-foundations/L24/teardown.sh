#!/usr/bin/env bash
# L24 teardown: remove the compose project looped-l24 — db, restore target,
# worker, network and the named volume looped-l24-data (explicit teardown is
# the only place a volume is removed) — and work/ (including your backups).
# evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
l24_guard
l24_dc --profile restore down -v --remove-orphans >/dev/null 2>&1 || warn "compose down reported an error"
left="$(docker ps -a --format '{{.Names}}' | grep -E '^looped-l24-' || true; docker volume ls --format '{{.Name}}' | grep -E '^looped-l24-' || true)"
[ -z "$left" ] || die "still present: $left"
[ -d "$WORK" ] && rm -rf "${WORK:?}"
info "L24 removed: no looped-l24-* containers or volumes remain; evidence/ kept"
