#!/usr/bin/env bash
# L27 variant: writes the starting server limits (work/limits.env) and client
# policy (work/client.env) for the chosen variant, keeping your previous
# copies as *.bak, and writes work/TICKET.md. Run by setup.sh; run again to
# switch (it recreates the api with one replica).
#   variant-a  the client side of the overload story
#   variant-b  the server side of the overload story
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L27_PROJECT"
l27_guard
[ -f "$WORK/compose.yaml" ] || die "no work/; run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V (variant-a | variant-b)" ;; esac
for f in limits.env client.env; do
  [ -f "$WORK/$f" ] && cp "$WORK/$f" "$WORK/$f.bak"
  cp "$HERE/assets/variants/$V/$f" "$WORK/$f"
done
cat > "$WORK/TICKET.md" <<'T'
# BEACON-OPS-1402 — status submissions failing at the morning peak

Every weekday 07:55–08:20 the field fleet submits about 60 status records per second for a few
minutes. During that window most sensors report submission failures and retry. The status
page's record total also looks too high afterwards compared with the number of sensors that
checked in. Last week someone scaled the API to three replicas during the peak; the on-call
channel says it "made no difference, maybe worse".

Find the capacity of the write path and what limits it, make the peak as painless as it can be
for sensors without breaking the data, and write down what would actually raise capacity.
Reproduce with the load generator (bounded: never point it anywhere but this project).
T
printf '%s\n' "$V" > "$WORK/.variant"
if [ -z "${LOOPED_L27_NO_APPLY:-}" ] && docker inspect looped-l27-db >/dev/null 2>&1; then
  l27_dc up -d --scale api=1 >/dev/null
fi
info "variant $V configured; read $WORK/TICKET.md"
