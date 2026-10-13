#!/usr/bin/env bash
# L07 setup: create your workspace (default labs/sre-cloud-foundations/L07/work,
# override with L07_WORK=DIR) from the starter, copy the sample fixtures, and
# generate the variant's incident log. Never overwrites files you already have.
# No root needed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
command -v python3 >/dev/null 2>&1 || die "python3 not found"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || die "python3 3.9+ required"
WORK="${L07_WORK:-$HERE/work}"
mkdir -p "$WORK/fixtures" "$WORK/data"
for f in logsummary.py test_logsummary.py; do
  if [ -e "$WORK/$f" ]; then say "keeping your $WORK/$f"; else cp "$HERE/starter/$f" "$WORK/$f"; fi
done
for f in "$HERE"/fixtures/*.jsonl; do [ -e "$WORK/fixtures/$(basename "$f")" ] || cp "$f" "$WORK/fixtures/"; done
EV="$(evidence_dir "$HERE")"
[ -f "$EV/L07-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L07-notes.md"
L07_WORK="$WORK" LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L07 ready. Workspace: $WORK"
say "  cd $WORK && python3 -m unittest discover -s . -p 'test_*.py'"
say "  python3 logsummary.py data/incident-$(cat "$WORK/.variant").jsonl"
