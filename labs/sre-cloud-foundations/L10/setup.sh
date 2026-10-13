#!/usr/bin/env bash
# L10 setup: create work/ with the exporter's current policy and session for
# the chosen variant (inject.sh), plus the predictions and tests templates.
# Fixture-only: no AWS call, nothing outside this lab directory. Idempotent:
# existing work files are kept (reset.sh starts over).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3

WORK="$HERE/work"
mkdir -p "$WORK"
EV="$(evidence_dir "$HERE")"
if [ -f "$WORK/exporter-policy.json" ]; then
  info "work/exporter-policy.json exists; keeping your edits (reset.sh restores the starting policy)"
else
  bash "$HERE/inject.sh"
fi
[ -f "$WORK/predictions.json" ] || cp "$HERE/assets/templates/predictions.json" "$WORK/predictions.json"
[ -f "$WORK/tests.json" ] || cp "$HERE/assets/templates/tests.json" "$WORK/tests.json"
[ -f "$EV/L10-notes.md" ] || cp "$HERE/assets/templates/notes.md" "$EV/L10-notes.md"
say ""
say "L10 ready."
say "  c1: predict every case in assets/cases/predict/ in work/predictions.json BEFORE running:"
say "      python3 $HERE/assets/iameval.py run $HERE/assets/cases/predict --explain"
say "  c2: the ticket is in README.md; its cases are in assets/cases/ticket/"
