#!/usr/bin/env bash
# L22 fault injection: write the guild's DRAFT rules for the variant to
# work/rules/beacon-slo.rules.yml and that variant's month of traffic to
# work/month.json. Your tests and worksheet are not touched.
#   LOOPED_VARIANT=variant-a | variant-b   (default variant-a)
# The drafts differ in what they get wrong; nothing here says what.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_workstation docker python3
l22_guard
V="${LOOPED_VARIANT:-${1:-$(l22_variant)}}"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V (variant-a | variant-b)" ;; esac
mkdir -p "$WORK/rules"
cp "$HERE/assets/drafts/$V.rules.yml" "$WORK/rules/beacon-slo.rules.yml"
python3 - "$HERE/assets/months.json" "$V" "$WORK/month.json" <<'PY'
import json, sys
src, v, dst = sys.argv[1:4]
m = json.load(open(src))[v]
json.dump({"service": "beacon", "window_days": 30, "month": m["month"], "counts": m["counts"]}, open(dst, "w"), indent=1)
PY
printf '%s\n' "$V" > "$WORK/.variant"
chmod -R a+rX "$WORK"
info "draft rules and month of traffic written ($V)"
