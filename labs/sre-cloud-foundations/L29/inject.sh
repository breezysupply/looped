#!/usr/bin/env bash
# L29 fault: write work/translation.yaml from the colleague's draft
# (assets/draft-base.yaml) with the wrong-equivalence assumptions chosen by the
# variant seed. Nothing prints which assumptions were planted; the validator
# reads work/.variant only to label the evidence.
#   LOOPED_VARIANT=variant-a | variant-b | variant-c   (default variant-a)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac
WORK="$HERE/work"
mkdir -p "$WORK"
python3 - "$HERE/assets" "$WORK/translation.yaml" "$V" <<'PY'
import json, sys
assets, dst, v = sys.argv[1:4]
sys.path.insert(0, assets)
import xlate
with open(f"{assets}/draft-base.yaml", encoding="utf-8") as fh:
    head = [ln for ln in fh.read().splitlines() if ln.startswith("#")]
    fh.seek(0)
    ws = xlate.load_yaml_subset(fh.read())
xlate.apply_patches(ws, json.load(open(f"{assets}/variants.json", encoding="utf-8"))[v])
with open(dst, "w", encoding="utf-8") as fh:
    fh.write("\n".join(head) + "\n" + xlate.dump_yaml_subset(ws) + "\n")
PY
printf '%s\n' "$V" > "$WORK/.variant"
info "work/translation.yaml written from the colleague's draft ($V). Start with: python3 $HERE/assets/xlate.py $WORK/translation.yaml"
