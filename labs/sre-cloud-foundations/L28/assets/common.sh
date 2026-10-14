# shellcheck shell=bash
# L28 helpers, sourced by the lab scripts after HERE is set.
# Scope: Compose project looped-l28 (containers looped-l28-*, volumes
# looped-l28-primary / looped-l28-restored, network looped-l28-net) and work/.
. "$HERE/../lib/looped.sh"

readonly L28_PROJECT="looped-l28"
readonly L28_PG_IMAGE="postgres:16.4@sha256:e62fbf9d3e2b49816a32c400ed2dba83e3b361e6833e624024309c35d334b412"
readonly L28_DAY="2025-03-11"   # synthetic date of the seeded records
WORK="$HERE/work"

l28_guard() {
  require_compose_project "$L28_PROJECT"
  require_workstation python3
}
l28_dc() { dc "$L28_PROJECT" -f "$WORK/compose.yaml" --project-directory "$WORK" "$@"; }
l28_psql() { docker exec -i looped-l28-db psql -X -q -At -U beacon -d beacon -v ON_ERROR_STOP=1 "$@"; }
l28_variant() { cat "$WORK/.variant" 2>/dev/null || echo "${LOOPED_VARIANT:-variant-a}"; }
l28_wait_db() {
  local i
  for i in $(seq 1 90); do
    if docker exec "$1" pg_isready -q -h 127.0.0.1 -U beacon -d beacon 2>/dev/null; then return 0; fi
    sleep 1
  done
  die "$1 did not become ready within 90s (docker logs $1)"
}
# seed one record per sensor every 5 minutes in [from, to) of the synthetic day
l28_seed() {  # l28_seed HH:MM HH:MM
  l28_psql -c "INSERT INTO records (sensor_id, status, created_at)
    SELECT 'sensor-' || lpad(s::text, 2, '0'),
           CASE WHEN (s * 7 + extract(minute FROM t)::int) % 13 = 0 THEN 'warn' ELSE 'ok' END, t
    FROM generate_series(timestamptz '$L28_DAY $1:00+00', timestamptz '$L28_DAY $2:00+00' - interval '5 minutes', interval '5 minutes') t,
         generate_series(1, 20) s"
}
l28_list() {
  case "$1" in
    container) docker ps -a --format '{{.Names}}' ;;
    volume) docker volume ls --format '{{.Name}}' ;;
    network) docker network ls --format '{{.Name}}' ;;
  esac | grep -E '^looped-l28[-_][a-z0-9_.-]+$' || true
}
l28_rm() {
  local kind="$1" name="$2"
  case "$name" in looped-l28-*|looped-l28_*) ;; *) die "refusing to remove $kind '$name' (not looped-l28-*)" ;; esac
  case "$kind" in
    container) docker rm -f "$name" >/dev/null 2>&1 || true ;;
    volume) docker volume rm "$name" >/dev/null 2>&1 || warn "volume $name in use or already gone" ;;
    network) docker network rm "$name" >/dev/null 2>&1 || true ;;
  esac
}
