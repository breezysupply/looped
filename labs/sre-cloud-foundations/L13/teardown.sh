#!/usr/bin/env bash
# L13 teardown: remove ONLY containers and images labelled looped.lab/id=L13
# and the work/ directory. Base images (python:3.12.7-slim-bookworm) and your
# evidence/ stay; remove the base yourself if you want the disk back.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_compose_project looped-l13
ids="$(docker ps -aq --filter "label=$SRE_LABEL=L13")"
[ -z "$ids" ] || docker rm -f $ids >/dev/null
imgs="$(docker images -q --filter "label=$SRE_LABEL=L13" | sort -u)"
[ -z "$imgs" ] || docker rmi -f $imgs >/dev/null
WORK="$HERE/work"
rm -rf "${WORK:?}"
info "removed L13 containers/images (label $SRE_LABEL=L13) and $WORK; evidence/ kept"
