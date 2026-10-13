#!/usr/bin/env bash
# Start the observability profile: Prometheus, Grafana, OpenTelemetry
# Collector (contrib) and Jaeger, pinned, as compose project looped-obs, then
# run check.sh. Idempotent. Stop it when you are not using it (teardown.sh):
# the course never runs this stack, a cluster and the VM at the same time.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/common.sh"
require_compose_project "$OBS_PROJECT"
require_workstation python3
info "starting looped-obs (pulls the pinned images on first run only)"
obs_dc up -d --pull missing --quiet-pull >/dev/null
bash "$HERE/check.sh"
say ""
say "Prometheus http://127.0.0.1:19090  Grafana http://127.0.0.1:13000 (anonymous viewer; admin / lab-grafana-not-a-real-secret)"
say "Jaeger     http://127.0.0.1:16686  OTLP/HTTP from the host: http://127.0.0.1:14318 (inside looped-obs-net: http://looped-obs-otelcol:4318)"
