#!/usr/bin/env bash
# L07 variation: generate the variant's incident log into the workspace's data/
# directory (deterministic per variant). Your code and tests are not touched.
#   LOOPED_VARIANT=variant-a   (default)
#   LOOPED_VARIANT=variant-b
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
WORK="${L07_WORK:-$HERE/work}"
[ -d "$WORK" ] || die "workspace $WORK missing; run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V (variant-a | variant-b)" ;; esac
mkdir -p "$WORK/data"
rm -f "$WORK"/data/incident-*.jsonl
python3 "$HERE/assets/gen_logs.py" incident --variant "$V" --out "$WORK/data/incident-$V.jsonl"
printf '%s\n' "$V" > "$WORK/.variant"
info "generated $WORK/data/incident-$V.jsonl ($(wc -l < "$WORK/data/incident-$V.jsonl") lines)"
