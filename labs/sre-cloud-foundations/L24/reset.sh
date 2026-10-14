#!/usr/bin/env bash
# L24 reset: remove the restore target, reload the source dataset (public,
# queue, ledger — drops any constraint you added), recreate last night's
# backup, keep your work/worker.py (saved as work/worker.py.bak and replaced
# by the starter). Same variant unless LOOPED_VARIANT is set. Volumes are kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L24_PROJECT"
l24_guard
V="$(l24_variant)"
[ -n "${LOOPED_VARIANT:-}" ] && V="$LOOPED_VARIANT"
l24_dc --profile restore rm -sf restore worker >/dev/null 2>&1 || true
mkdir -p "$WORK"
[ -f "$WORK/worker.py" ] && mv "$WORK/worker.py" "$WORK/worker.py.bak"
rm -f "$WORK/.l24-state.json" "$WORK/recovery.json" "$WORK/verify-report.json"
[ -d "$WORK/backups" ] && rm -rf "${WORK:?}/backups"
printf '%s\n' "$V" > "$WORK/.variant"
LOOPED_VARIANT="$V" bash "$HERE/setup.sh"
info "L24 reset to $V (your worker saved as work/worker.py.bak); run inject.sh"
