#!/usr/bin/env bash
# Reference fix for lab 04 (used by the harness). Try the lab before reading this.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/lib/common.sh"
preflight >/dev/null
# search-api: point readiness at a page the app actually serves.
k patch deployment search-api --type=json \
  -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/healthz"}]'
# search-indexer: give the slow start its own budget with a startupProbe
# (liveness only begins after the startup probe has succeeded).
k patch deployment search-indexer --type=strategic \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"indexer","startupProbe":{"httpGet":{"path":"/healthz","port":"http"},"periodSeconds":5,"failureThreshold":24}}]}}}}'
wait_rollout search-api 180
wait_rollout search-indexer 240
