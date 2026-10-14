#!/usr/bin/env bash
# L31 reset: remove the rebuilt namespace (only if the variant's cluster is up and the namespace
# carries looped.lab/id=L31), put the colleague's rebuild.env back for the same variant (or
# LOOPED_VARIANT), and move work/proof to work/proof.prev. REBUILD.md, slo/ and the dashboard
# in release/ are kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
WORK="$HERE/work"
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
if python3 "$HERE/assets/capstone.py" env >/dev/null 2>&1; then
  cl="$(python3 "$HERE/assets/capstone.py" env | sed -n 's/^CLUSTER=//p')"
  if command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -qx "$cl"; then
    LOOPED_YES=1 bash "$HERE/rebuild.sh" down || warn "rebuild.sh down failed; check the namespace by hand"
  else
    info "cluster $cl not running; nothing to remove there"
  fi
fi
if [ -d "$WORK/proof" ]; then rm -rf "${WORK:?}/proof.prev"; mv "$WORK/proof" "$WORK/proof.prev"; fi
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L31 reset to ${LOOPED_VARIANT:-$V}; previous proof in work/proof.prev"
