#!/usr/bin/env bash
# Run ONE bounded load test from inside the project network.
#   bash labs/sre-cloud-foundations/L27/assets/run-load.sh <label> [rps] [seconds]
#   bash labs/sre-cloud-foundations/L27/assets/run-load.sh step --steps 10,20,30,40,50,60,70 [seconds-per-step]
# Caps (enforced in loadgen.py whatever you pass): <=120 rps, <=60 s per step,
# <=10 steps, <=200 requests in flight, <=5 retries. The policy is work/client.env.
# Writes work/runs/<label>.json. Touches nothing else.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L27_PROJECT"
l27_guard
[ -f "$WORK/compose.yaml" ] || die "no work/; run setup.sh first"
label="${1:?usage: run-load.sh <label> [rps] [seconds] | step --steps 10,20,... [seconds]}"
shift
mkdir -p "$WORK/runs"
if [ "${1:-}" = "--steps" ]; then
  steps="${2:?--steps needs a list such as 10,20,30,40,50,60,70}"
  l27_dc run --rm --no-deps loadgen --label "$label" --steps "$steps" --duration "${3:-10}"
else
  l27_dc run --rm --no-deps loadgen --label "$label" --rps "${1:-60}" --duration "${2:-20}"
fi
