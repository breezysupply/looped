# shellcheck shell=bash
# L24 helpers, sourced by setup/inject/reset/teardown after HERE is set.
# Scope: the compose project looped-l24 (containers looped-l24-*, volume
# looped-l24-data) and this lab's work/ directory. Nothing else.
. "$HERE/../lib/looped.sh"

readonly L24_PROJECT="looped-l24"
readonly L24_COMPOSE="$HERE/assets/compose.yaml"
WORK="$HERE/work"
export LOOPED_UID="${LOOPED_UID:-$(id -u)}" LOOPED_GID="${LOOPED_GID:-$(id -g)}"

l24_guard() {
  require_compose_project "$L24_PROJECT"
  require_workstation python3
}
l24_dc() { dc "$L24_PROJECT" -f "$L24_COMPOSE" "$@"; }
# psql in the SOURCE database container
l24_psql() { docker exec -i looped-l24-db psql -X -q -U beacon -d beacon -v ON_ERROR_STOP=1 "$@"; }
l24_variant() { cat "$WORK/.variant" 2>/dev/null || echo "${LOOPED_VARIANT:-variant-a}"; }
l24_wait() {  # l24_wait <container>
  local i
  for i in $(seq 1 60); do
    if docker exec "$1" pg_isready -q -U beacon -d beacon -h 127.0.0.1 2>/dev/null; then return 0; fi
    sleep 1
  done
  die "$1 did not become ready within 60s (docker logs $1)"
}
l24_records_md5() {
  l24_psql -At -c "SELECT count(*) || ' ' || md5(string_agg(t::text, E'\n' ORDER BY t.id)) FROM public.records t"
}
