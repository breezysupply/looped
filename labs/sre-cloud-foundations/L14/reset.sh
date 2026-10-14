#!/usr/bin/env bash
# L14 reset: stop and remove the project's containers and network
# (docker compose down), keep the named volumes, rebuild work/ and re-inject
# the same variant (or LOOPED_VARIANT). Data is removed ONLY when you ask:
#   LOOPED_RESET_DATA=1 bash reset.sh     # also removes looped-l14_* volumes
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
PROJECT=looped-l14
require_compose_project "$PROJECT"
V="$(cat "$HERE/work/.variant" 2>/dev/null || echo variant-a)"
if [ "${LOOPED_RESET_DATA:-0}" = 1 ]; then
  info "LOOPED_RESET_DATA=1: removing project $PROJECT including its volumes"
  dc "$PROJECT" down --volumes --remove-orphans
else
  dc "$PROJECT" down --remove-orphans
  info "volumes kept: $(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | tr '\n' ' ')"
fi
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L14 reset to ${LOOPED_VARIANT:-$V}; evidence/ untouched"
