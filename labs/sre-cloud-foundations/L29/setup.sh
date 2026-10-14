#!/usr/bin/env bash
# L29 setup: create the worksheet workspace work/ from the colleague's draft
# (inject.sh applies the variant) and the notes file. Fixture-only: reads and
# writes files under this lab directory; never calls Azure, Google Cloud or
# AWS. Idempotent: an existing work/translation.yaml is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
WORK="$HERE/work"
mkdir -p "$WORK"
EV="$(evidence_dir "$HERE")"
if [ -f "$WORK/translation.yaml" ]; then
  info "work/translation.yaml already exists; keeping your edits (reset.sh restores the draft)"
else
  bash "$HERE/inject.sh"
fi
[ -f "$EV/L29-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L29-notes.md"
{ echo "# L29 tool inventory — $(date -u +%FT%TZ)"; record_versions; } > "$EV/L29-tools.txt"
say ""
say "L29 ready. Read the AWS design first: labs/sre-cloud-foundations/L09/assets/draft-inventory.json"
say "  python3 $HERE/assets/xlate.py --claims"
say "  python3 $HERE/assets/xlate.py $WORK/translation.yaml"
say "Your notes go in $EV/L29-notes.md"
