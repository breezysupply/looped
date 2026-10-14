# shellcheck shell=bash
# observability profile helpers (sourced after HERE is set). Scope: the compose
# project looped-obs (containers looped-obs-*, network looped-obs-net).
. "$HERE/../../lib/looped.sh"
readonly OBS_PROJECT="looped-obs"
readonly OBS_COMPOSE="$HERE/compose.yaml"
obs_dc() { dc "$OBS_PROJECT" -f "$OBS_COMPOSE" "$@"; }
