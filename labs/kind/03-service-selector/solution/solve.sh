#!/usr/bin/env bash
# Reference fix for lab 03 (used by the harness). Try the lab before reading this.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/lib/common.sh"
preflight >/dev/null
k patch service orders --type=json -p '[{"op":"remove","path":"/spec/selector/tier"}]'
