#!/usr/bin/env bash
# L32 setup: create your report bundle report/ (checked in) from the templates and record the
# seeded fault draw in report/draw.json (once; LOOPED_SEED=... to choose the seed, otherwise a
# random one is generated and recorded). Files only: nothing is started or injected here.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
R="$HERE/report"
mkdir -p "$R/evidence" "$R/python-change" "$HERE/work"
[ -f "$R/incident-report.md" ] || cp "$HERE/assets/report-template.md" "$R/incident-report.md"
[ -f "$R/design-defense.md" ] || cp "$HERE/assets/defense-template.md" "$R/design-defense.md"
[ -f "$R/rubric-scores.json" ] || cp "$HERE/assets/rubric-scores-template.json" "$R/rubric-scores.json"
if [ -f "$R/draw.json" ]; then
  info "keeping the recorded draw in report/draw.json"
else
  seed="${LOOPED_SEED:-l32-$(python3 -c 'import secrets; print(secrets.token_hex(4))')}"
  python3 "$HERE/assets/draw.py" --seed "$seed" --out "$R/draw.json" >/dev/null
fi
EV="$(evidence_dir "$HERE")"
{ echo "# L32 tool inventory — $(date -u +%FT%TZ)"; record_versions; } > "$EV/L32-tools.txt"
python3 - "$R/draw.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(f"Draw (seed {d['seed']}, {d['drawn_at']}): {len(d['excluded'])} variants you have already seen were excluded.")
for s in d["single_details"]:
    print(f"\n{s['id']}  {s['lab']} {s['variant']}  [{s['domain']}, profile {s['profile']}]  area: {s['area']}")
    for c in s["start"]:
        print("  " + c)
    print("  " + s["validate"])
print(f"\nCombined incident {d['incident']}: on your L31 rebuild; start it with bash labs/sre-cloud-foundations/L32/inject.sh")
PY
