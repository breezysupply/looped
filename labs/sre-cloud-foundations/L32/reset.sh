#!/usr/bin/env bash
# L32 reset: put the L31 rebuild back to its pre-incident state (pre-incident backup restored,
# helm rolled back, L32-labelled objects removed, database password matching the Secret), then
# inject the same drawn incident again. The draw, your report and the single-fault evidence stay.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3 kubectl helm
CL="$(python3 "$SRE_ROOT/L31/assets/capstone.py" env | sed -n 's/^CLUSTER=//p')"
[ -n "$CL" ] || die "L31/release/rebuild.env is missing or invalid"
require_kind_context "kind-$CL" "$CL"
python3 "$HERE/assets/incident.py" restore
python3 "$HERE/assets/incident.py" inject
