#!/usr/bin/env bash
# L30 reset: restore the fixture's token, quota and stream state for the same
# variant (or LOOPED_VARIANT): both lab keys are re-issued (the old ones stop
# working), the fixture restarts with empty counters in the ticket's mode, and
# the customer's request body is put back. Your repro.py, your reply and the
# log of issued request ids (work/.run/issued.jsonl) are kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
WORK="${L30_WORK:-$HERE/work}"
[ -d "$WORK" ] || die "workspace $WORK missing; run setup.sh"
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
rm -f "$WORK/.secrets/customer-key" "$WORK/.secrets/new-key"
(
  umask 077
  mkdir -p "$WORK/.secrets"
  for k in customer-key new-key; do
    printf 'lab-l30-%s-not-a-real-secret\n' "$(python3 -c 'import secrets; print(secrets.token_hex(10))')" > "$WORK/.secrets/$k"
  done
)
cp "$HERE/assets/customer-request.json" "$WORK/customer-request.json"
L30_WORK="$WORK" LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L30 reset to ${LOOPED_VARIANT:-$V}: keys re-issued, fixture counters cleared"
