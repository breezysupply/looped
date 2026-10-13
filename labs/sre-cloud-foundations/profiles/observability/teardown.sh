#!/usr/bin/env bash
# Stop and remove the observability profile: the looped-obs containers, the
# looped-obs-net network and the project's anonymous volumes (Prometheus' TSDB
# is disposable). Images are kept. Labs that joined looped-obs-net (L21) must be
# torn down first; this refuses while other containers are attached.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/common.sh"
require_compose_project "$OBS_PROJECT"
others="$(docker network inspect looped-obs-net -f '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null | tr ' ' '\n' | grep -v '^looped-obs-' | grep -v '^$' || true)"
[ -z "$others" ] || die "containers outside the profile still use looped-obs-net: $(echo "$others" | tr '\n' ' ')— tear those labs down first (e.g. L21/teardown.sh)"
obs_dc down -v --remove-orphans >/dev/null 2>&1 || warn "compose down reported an error"
left="$(docker ps -a --format '{{.Names}}' | grep -E '^looped-obs-' || true)"
[ -z "$left" ] || die "still present: $left"
info "observability profile removed (images kept)"
