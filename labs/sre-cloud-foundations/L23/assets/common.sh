# shellcheck shell=bash
# L23 helpers, sourced by setup/inject/reset/teardown after HERE is set.
# Scope: the compose project looped-l23 (containers looped-l23-*, volume
# looped-l23-data) and this lab's work/ directory. Nothing else.
. "$HERE/../lib/looped.sh"

readonly L23_PROJECT="looped-l23"
readonly L23_COMPOSE="$HERE/assets/compose.yaml"
WORK="$HERE/work"
export LOOPED_UID="${LOOPED_UID:-$(id -u)}" LOOPED_GID="${LOOPED_GID:-$(id -g)}"

l23_guard() {
  require_compose_project "$L23_PROJECT"
  require_workstation python3
}

# docker compose for this project only (always -p looped-l23 -f assets/compose.yaml)
l23_dc() { dc "$L23_PROJECT" -f "$L23_COMPOSE" "$@"; }

# psql inside the lab's database container (no host psql needed)
l23_psql() { docker exec -i looped-l23-db psql -X -q -U beacon -d beacon -v ON_ERROR_STOP=1 "$@"; }

l23_variant() { cat "$WORK/.variant" 2>/dev/null || echo "${LOOPED_VARIANT:-variant-a}"; }

# the ticket query for a variant (checkpoint c1)
l23_ticket_query() {
  case "$1" in
    variant-b) echo "SELECT sensor_id, ts, value FROM readings WHERE site = 'site-07' AND status = 'fault' ORDER BY ts DESC LIMIT 20;" ;;
    *) echo "SELECT ts, status, value FROM readings WHERE sensor_id = 's-0042' AND ts >= '2026-03-01' AND ts < '2026-03-08' ORDER BY ts;" ;;
  esac
}

l23_wait_db() {
  local i
  for i in $(seq 1 60); do
    if docker exec looped-l23-db pg_isready -q -U beacon -d beacon -h 127.0.0.1 2>/dev/null; then return 0; fi
    sleep 1
  done
  die "looped-l23-db did not become ready within 60s (docker logs looped-l23-db)"
}
