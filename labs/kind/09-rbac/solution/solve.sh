#!/usr/bin/env bash
# Reference fix for lab 09 (used by the harness). Try the lab before reading this.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/lib/common.sh"
preflight >/dev/null
# The binding names the ServiceAccount in the old namespace. subjects can be
# edited in place (roleRef cannot).
k patch rolebinding stock-sync-configmap-reader --type=json \
  -p '[{"op":"replace","path":"/subjects/0/namespace","value":"looped-lab"}]'
# stock-sync retries every 5s; wait for a successful sync to be logged.
synced() { k logs deployment/stock-sync --tail=1 | grep -q 'sync ok'; }
wait_until 60 "a successful sync" synced
