#!/usr/bin/env bash
# L32 teardown (after your report is saved): undo the incident on the L31 rebuild if its cluster
# is running (L32-labelled objects only), then remove work/. report/ (draw, evidence, report,
# defence, rubric) and evidence/ are kept. Single-fault labs are torn down with their own
# teardown.sh, listed in report/draw.json.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
CL="$(python3 "$SRE_ROOT/L31/assets/capstone.py" env 2>/dev/null | sed -n 's/^CLUSTER=//p' || true)"
if [ -n "$CL" ] && [ -f "$HERE/work/incident-state.json" ] && command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -qx "$CL"; then
  require_kind_context "kind-$CL" "$CL"
  python3 "$HERE/assets/incident.py" restore
fi
W="$HERE/work"
[ -d "$W" ] && rm -rf "${W:?}"
python3 - "$HERE/report/draw.json" <<'PY' || true
import json, sys
for s in json.load(open(sys.argv[1])).get("single_details", []):
    print("single fault cleanup: " + s["teardown"])
PY
info "L32 work/ removed; report/ and evidence/ kept"
