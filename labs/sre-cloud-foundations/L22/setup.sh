#!/usr/bin/env bash
# L22 setup: pull the pinned Prometheus image (for promtool), create work/
# with the draft SLO rules for the variant (inject.sh), your test file, the
# month of traffic for the error-budget worksheet and the worksheet itself.
# Fixture-only: nothing runs in the background and nothing waits for days.
# Idempotent: existing work files are kept (reset.sh restores the draft).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
l22_guard
mkdir -p "$WORK/rules" "$WORK/tests"
EV="$(evidence_dir "$HERE")"
docker image inspect "$L22_PROM_IMAGE" >/dev/null 2>&1 || docker pull -q "$L22_PROM_IMAGE" >/dev/null
info "promtool: $(l22_promtool --version 2>&1 | head -1)"
if [ -f "$WORK/rules/beacon-slo.rules.yml" ]; then
  info "work/rules exists; keeping your edits (reset.sh restores the draft)"
else
  bash "$HERE/inject.sh"
fi
[ -f "$WORK/tests/beacon-slo.test.yml" ] || cp "$HERE/starter/tests/beacon-slo.test.yml" "$WORK/tests/beacon-slo.test.yml"
[ -f "$WORK/slo.json" ] || cp "$HERE/assets/slo-template.json" "$WORK/slo.json"
chmod -R a+rX "$WORK"
{
  echo "# L22 tool inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "promtool image: $L22_PROM_IMAGE"
} > "$EV/L22-tools.txt"
say ""
say "L22 ready ($(l22_variant)). Rules: work/rules/beacon-slo.rules.yml · tests: work/tests/ · worksheet: work/slo.json (data: work/month.json)"
say "Run the tests: docker run --rm --network none -v \"$WORK:/w:ro\" --entrypoint promtool $L22_PROM_IMAGE test rules /w/tests/beacon-slo.test.yml"
