#!/usr/bin/env bash
# L23 reset: stop the fixture sessions and the API write path, reload the
# seeded dataset (drops any index you created), keep the variant (or use
# LOOPED_VARIANT). The database container and its volume are kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
l23_guard
V="$(l23_variant)"
l23_dc --profile fault rm -sf fixtures pool >/dev/null 2>&1 || true
# a server backend keeps running its query after its client container is gone;
# end the lab's own fixture sessions (by application_name, in this lab's database only)
if docker exec looped-l23-db true 2>/dev/null; then
  l23_psql -At -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = 'beacon' AND application_name IN ('beacon-backfill', 'beacon-report', 'beacon-api-pool')" >/dev/null || true
fi
rm -f "$WORK/.l23-state.json" "$WORK/pool/pool-status.json"
[ -n "${LOOPED_VARIANT:-}" ] && V="$LOOPED_VARIANT"
mkdir -p "$WORK"
printf '%s\n' "$V" > "$WORK/.variant"
LOOPED_VARIANT="$V" bash "$HERE/setup.sh"
info "L23 reset to $V: dataset reloaded, fixtures stopped (run inject.sh again for c2)"
