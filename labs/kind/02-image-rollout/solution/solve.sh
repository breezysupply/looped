#!/usr/bin/env bash
# Reference fix for lab 02 (used by the harness). Try the lab before reading this.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/lib/common.sh"
preflight >/dev/null
k rollout undo deployment/payments-api
wait_rollout payments-api 240
