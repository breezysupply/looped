# shellcheck shell=bash
# L25 helpers, sourced by setup/inject/reset/teardown after HERE is set.
# Scope: the Compose project looped-l25 (containers looped-l25-*, network
# looped-l25-net, volume looped-l25-pgdata), images looped-l25-report:* and
# this lab's work/ directory. Nothing else is created or removed.
. "$HERE/../lib/looped.sh"

readonly L25_PROJECT="looped-l25"
readonly L25_PY_IMAGE="python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d"
WORK="$HERE/work"
export LOOPED_UID="${LOOPED_UID:-$(id -u)}" LOOPED_GID="${LOOPED_GID:-$(id -g)}"

l25_guard() {
  require_compose_project "$L25_PROJECT"
  require_workstation python3 openssl
}
# compose always with -p looped-l25 and the learner's work/compose.yaml
l25_dc() { dc "$L25_PROJECT" -f "$WORK/compose.yaml" --project-directory "$WORK" "$@"; }
# psql as the database superuser over the container's local socket (no password on the wire)
l25_psql() { docker exec -i looped-l25-db psql -X -q -U postgres -d beacon -v ON_ERROR_STOP=1 "$@"; }
l25_variant() { cat "$WORK/.variant" 2>/dev/null || echo "${LOOPED_VARIANT:-variant-a}"; }
l25_wait_db() {
  local i
  for i in $(seq 1 90); do
    if docker exec looped-l25-db pg_isready -q -h 127.0.0.1 -U postgres -d beacon 2>/dev/null; then return 0; fi
    sleep 1
  done
  die "looped-l25-db did not become ready within 90s (docker logs looped-l25-db)"
}
# a new synthetic credential into a file (0600); prints only a fingerprint
l25_newsecret() { python3 "$HERE/assets/newsecret.py" "$1"; }
# set a role's password from a file, sending only a SCRAM verifier to the server
l25_set_password() {  # l25_set_password <role> <file>
  python3 "$HERE/assets/scram.py" --role "$1" "$2" | l25_psql >/dev/null
}
# names of this lab's Docker objects (exact prefix match)
l25_list() {
  case "$1" in
    container) docker ps -a --format '{{.Names}}' ;;
    volume) docker volume ls --format '{{.Name}}' ;;
    network) docker network ls --format '{{.Name}}' ;;
    image) docker image ls --format '{{.Repository}}:{{.Tag}}' ;;
  esac | grep -E '^looped-l25[-_][a-z0-9_.:-]+$' || true
}
l25_rm() {
  local kind="$1" name="$2"
  case "$name" in looped-l25-*|looped-l25_*) ;; *) die "refusing to remove $kind '$name' (not looped-l25-*)" ;; esac
  case "$kind" in
    container) docker rm -f "$name" >/dev/null 2>&1 || true ;;
    volume) docker volume rm "$name" >/dev/null 2>&1 || warn "volume $name in use or already gone" ;;
    network) docker network rm "$name" >/dev/null 2>&1 || true ;;
    image) docker image rm "$name" >/dev/null 2>&1 || true ;;
  esac
}
