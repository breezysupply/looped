#!/usr/bin/env bash
# Reference fix for lab 05 (used by the harness). Try the lab before reading this.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/lib/common.sh"
preflight >/dev/null
k set resources deployment/report-builder -c builder --requests=cpu=10m,memory=256Mi --limits=memory=512Mi
wait_rollout report-builder 240
