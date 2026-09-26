#!/usr/bin/env bash
# Reference fix for lab 06 (used by the harness). Try the lab before reading this.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/lib/common.sh"
SOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
preflight >/dev/null
k apply -f "$SOL_DIR/notify-config.yaml"
# Env vars are read when a container starts. The crash-looping container would
# pick the value up at its next restart, after the current back-off delay;
# a rollout restart starts fresh pods now instead of waiting.
k rollout restart deployment/notify-api
wait_rollout notify-api 240
