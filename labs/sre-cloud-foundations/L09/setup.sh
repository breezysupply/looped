#!/usr/bin/env bash
# L09 setup: create the learner workspace work/ from the colleague's draft
# inventory and inject the chosen variant (inject.sh). Fixture-only: reads and
# writes files under this lab directory; never calls AWS. Idempotent: an
# existing work/inventory.json is kept (use reset.sh to start over).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3

WORK="$HERE/work"
mkdir -p "$WORK"
EV="$(evidence_dir "$HERE")"
if [ -f "$WORK/inventory.json" ]; then
  info "work/inventory.json already exists; keeping your edits (reset.sh restores the draft)"
else
  bash "$HERE/inject.sh"
fi
[ -f "$EV/L09-explanation.md" ] || cp "$HERE/assets/explanation-template.md" "$EV/L09-explanation.md"
{
  echo "# L09 tool inventory — $(date -u +%FT%TZ)"
  record_versions
} > "$EV/L09-tools.txt"
say ""
say "L09 ready. Read assets/customer-needs.md, then:"
say "  python3 $HERE/assets/archcheck.py $WORK/inventory.json"
say "Your explanation goes in $EV/L09-explanation.md"
