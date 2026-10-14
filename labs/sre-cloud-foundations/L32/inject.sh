#!/usr/bin/env bash
# L32: start the drawn two-fault incident on your L31 rebuild (namespace and cluster from
# L31/release/rebuild.env). Takes a pre-incident backup first. Everything it creates is labelled
# looped.lab/id=L32. The single faults are started with the drawn labs' own scripts (see setup).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3 kubectl helm
CL="$(python3 "$SRE_ROOT/L31/assets/capstone.py" env | sed -n 's/^CLUSTER=//p')"
[ -n "$CL" ] || die "L31/release/rebuild.env is missing or invalid; finish L31 first"
require_kind_context "kind-$CL" "$CL"
python3 "$HERE/assets/incident.py" inject
