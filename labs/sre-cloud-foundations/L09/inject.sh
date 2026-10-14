#!/usr/bin/env bash
# L09 fault injection: write work/inventory.json from the colleague's draft
# with one change chosen by the variant seed. The validator reads
# work/.variant; nothing prints which change was made.
#   LOOPED_VARIANT=variant-a | variant-b | variant-c   (default variant-a)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac
WORK="$HERE/work"
mkdir -p "$WORK"
python3 - "$HERE/assets/draft-inventory.json" "$WORK/inventory.json" "$V" <<'PY'
import json, sys
src, dst, v = sys.argv[1:4]
inv = json.load(open(src, encoding="utf-8"))
if v == "variant-a":
    inv["gateways"] = [g for g in inv["gateways"] if g["id"] != "nat-b"]
    for rt in inv["route_tables"]:
        if rt["id"] == "rt-worker-b":
            for r in rt["routes"]:
                if r["destination"] == "0.0.0.0/0":
                    r["target"] = "nat-a"
    for e in inv["endpoints"]:
        if e["type"] == "interface":
            e["subnets"] = ["api-a"]
    inv["note"] += " Colleague's comment: trimmed NAT and endpoint ENIs to save cost."
elif v == "variant-b":
    for e in inv["endpoints"]:
        if e["id"] == "vpce-s3":
            e["route_tables"] = ["rt-worker-a", "rt-worker-b"]
    inv["note"] += " Colleague's comment: the API has interface endpoints for everything it calls."
else:
    for c in inv["components"]:
        if c["id"] == "db":
            c["multi_az"] = False
    inv["note"] += " Colleague's comment: database sized for launch; revisit later."
with open(dst, "w", encoding="utf-8") as fh:
    json.dump(inv, fh, indent=2)
    fh.write("\n")
PY
printf '%s\n' "$V" > "$WORK/.variant"
info "work/inventory.json written ($V). Start with: python3 $HERE/assets/archcheck.py $WORK/inventory.json"
