#!/usr/bin/env bash
# L30 setup: workspace work/ (or L30_WORK=DIR) with the customer's reproduction
# script, their request body and a reply template; two lab-only API keys; and
# the local summaries fixture on 127.0.0.1:8130 in the ticket's mode (inject.sh).
# Workstation lab: touches only files under the workspace and one loopback
# process. Never overwrites your repro.py or your reply.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || die "python3 3.9+ required"
WORK="${L30_WORK:-$HERE/work}"
mkdir -p "$WORK/.run" "$WORK/.secrets"
chmod 700 "$WORK/.secrets"
if [ -e "$WORK/repro.py" ]; then say "keeping your $WORK/repro.py"; else cp "$HERE/starter/repro.py" "$WORK/repro.py"; fi
cp "$HERE/assets/customer-request.json" "$WORK/customer-request.json"
[ -e "$WORK/customer-reply.md" ] || cp "$HERE/assets/reply-template.md" "$WORK/customer-reply.md"
(
  umask 077
  for k in customer-key new-key; do
    [ -s "$WORK/.secrets/$k" ] || printf 'lab-l30-%s-not-a-real-secret\n' "$(python3 -c 'import secrets; print(secrets.token_hex(10))')" > "$WORK/.secrets/$k"
  done
)
EV="$(evidence_dir "$HERE")"
[ -f "$EV/L30-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L30-notes.md"
{ echo "# L30 tool inventory — $(date -u +%FT%TZ)"; record_versions; } > "$EV/L30-tools.txt"
L30_WORK="$WORK" LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L30 ready. Read $WORK/TICKET.md first."
say "  fixture: http://127.0.0.1:8130   key the customer's job loads: $WORK/.secrets/customer-key"
say "  cd $WORK && python3 repro.py --base-url http://127.0.0.1:8130 --key-file .secrets/customer-key"
