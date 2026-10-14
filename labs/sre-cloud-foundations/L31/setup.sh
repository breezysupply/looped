#!/usr/bin/env bash
# L31 setup: create your release bundle release/ (checked in, NOT ignored) from the template,
# copy the SLO rules/tests (L22) and dashboard (L21) into it — your own lab work when it exists,
# otherwise the course reference, recorded in release/PROVENANCE.md — and write the variant's
# rebuild.env (inject.sh). Touches only files under L31/; no cluster, no Docker.
# Idempotent: existing files in release/ are kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
REL="$HERE/release"
mkdir -p "$REL/slo/rules" "$REL/slo/tests" "$HERE/work"
[ -f "$REL/REBUILD.md" ] || cp "$HERE/assets/release-template/REBUILD.md" "$REL/REBUILD.md"
[ -f "$REL/slo/README.md" ] || cp "$HERE/assets/release-template/slo/README.md" "$REL/slo/README.md"
prov="$REL/PROVENANCE.md"
[ -f "$prov" ] || printf '# Where the reused artifacts in this bundle came from\n\n' > "$prov"
copy_once() {  # copy_once <dest> <learner-src> <reference-src> <label>
  local dst="$1" own="$2" ref="$3" label="$4"
  [ -f "$dst" ] && { say "keeping $dst"; return 0; }
  if [ -f "$own" ]; then cp "$own" "$dst"; printf -- '- %s: your own work (%s), copied %s\n' "$label" "${own#"$SRE_ROOT"/}" "$(date -u +%F)" >> "$prov"
  elif [ -f "$ref" ]; then cp "$ref" "$dst"; printf -- '- %s: COURSE REFERENCE (%s), copied %s — replace with your own when you have it\n' "$label" "${ref#"$SRE_ROOT"/}" "$(date -u +%F)" >> "$prov"
  else warn "neither $own nor $ref exists; add $dst yourself"; fi
}
copy_once "$REL/slo/rules/beacon-slo.rules.yml" "$SRE_ROOT/L22/work/rules/beacon-slo.rules.yml" "$SRE_ROOT/L22/solution/rules/beacon-slo.rules.yml" "SLO rules"
copy_once "$REL/slo/tests/beacon-slo.test.yml" "$SRE_ROOT/L22/work/tests/beacon-slo.test.yml" "$SRE_ROOT/L22/solution/tests/beacon-slo.test.yml" "SLO rule tests"
copy_once "$REL/dashboard.json" "$SRE_ROOT/L21/work/dashboard.json" "$SRE_ROOT/L21/solution/dashboard.json" "dashboard"
[ -f "$REL/rebuild.env" ] || bash "$HERE/inject.sh"
EV="$(evidence_dir "$HERE")"
{ echo "# L31 tool inventory — $(date -u +%FT%TZ)"; record_versions; } > "$EV/L31-tools.txt"
say ""
say "L31 ready. Your bundle: $REL (rebuild.env, REBUILD.md, slo/, dashboard.json, PROVENANCE.md)."
say "  bash $HERE/rebuild.sh check      # the fresh-checkout dry check: start here"
