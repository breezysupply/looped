#!/usr/bin/env bash
# L14 teardown: docker compose down for project looped-l14, remove the image
# labelled looped.lab/id=L14 and work/. Named volumes (your PostgreSQL data)
# are kept unless LOOPED_RESET_DATA=1. The postgres:16.4 base image stays.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
PROJECT=looped-l14
require_compose_project "$PROJECT"
if [ "${LOOPED_RESET_DATA:-0}" = 1 ]; then
  dc "$PROJECT" down --volumes --remove-orphans
else
  dc "$PROJECT" down --remove-orphans
  left="$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | tr '\n' ' ')"
  [ -z "${left// /}" ] || info "kept volumes: $left (remove with LOOPED_RESET_DATA=1 bash $HERE/teardown.sh)"
fi
imgs="$(docker images -q --filter "label=$SRE_LABEL=L14" | sort -u)"
[ -z "$imgs" ] || docker rmi -f $imgs >/dev/null
WORK="$HERE/work"
rm -rf "${WORK:?}"
info "L14 project $PROJECT stopped and removed; image and $WORK removed; evidence/ kept"
