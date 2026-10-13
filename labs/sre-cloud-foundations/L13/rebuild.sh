#!/usr/bin/env bash
# L13 build-and-run helper: builds work/ as looped-l13-beacon:1.4.0 and
# replaces the container looped-l13-api (published on 127.0.0.1:18013).
#   bash rebuild.sh              build for the engine's native platform, then run
#   bash rebuild.sh --run-only   only replace the container from the existing image
#   LOOPED_PLATFORM=linux/arm64 bash rebuild.sh   build for an explicit platform
# It only ever removes a container that is named looped-l13-api AND labelled L13.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_compose_project looped-l13
WORK="$HERE/work"
IMAGE=looped-l13-beacon:1.4.0
CTR=looped-l13-api
[ -f "$WORK/Dockerfile" ] || die "no $WORK/Dockerfile; run setup.sh first"
ls "$WORK"/wheels/*.whl >/dev/null 2>&1 || die "no wheelhouse in $WORK/wheels; run setup.sh first"

if [ "${1:-}" != "--run-only" ]; then
  info "docker build -t $IMAGE $WORK ${LOOPED_PLATFORM:+(platform $LOOPED_PLATFORM)}"
  extra=()
  [ -n "${LOOPED_PLATFORM:-}" ] && extra+=(--platform "$LOOPED_PLATFORM")
  docker build ${extra[@]+"${extra[@]}"} --label "$SRE_LABEL=L13" -t "$IMAGE" "$WORK"
fi

if docker container inspect "$CTR" >/dev/null 2>&1; then
  owner="$(docker container inspect --format "{{ index .Config.Labels \"$SRE_LABEL\" }}" "$CTR")"
  [ "$owner" = "L13" ] || die "a container named $CTR exists but is not labelled $SRE_LABEL=L13; refusing to remove it"
  docker rm -f "$CTR" >/dev/null
fi
docker run -d --name "$CTR" --label "$SRE_LABEL=L13" -p 127.0.0.1:18013:8080 "$IMAGE" >/dev/null
info "started $CTR from $IMAGE ($(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$IMAGE"))"
