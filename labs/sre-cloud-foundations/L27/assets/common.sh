# shellcheck shell=bash
# L27 helpers, sourced by the lab scripts after HERE is set.
# Scope: Compose project looped-l27 (containers looped-l27-*, network
# looped-l27-net, volume looped-l27-pgdata) and this lab's work/ directory.
. "$HERE/../lib/looped.sh"

readonly L27_PROJECT="looped-l27"
WORK="$HERE/work"
export LOOPED_UID="${LOOPED_UID:-$(id -u)}" LOOPED_GID="${LOOPED_GID:-$(id -g)}"

l27_guard() {
  require_compose_project "$L27_PROJECT"
  require_workstation python3
}
l27_dc() { dc "$L27_PROJECT" -f "$WORK/compose.yaml" --project-directory "$WORK" "$@"; }
l27_psql() { docker exec -i looped-l27-db psql -X -q -At -U beacon -d beacon -v ON_ERROR_STOP=1 "$@"; }
l27_variant() { cat "$WORK/.variant" 2>/dev/null || echo "${LOOPED_VARIANT:-variant-a}"; }
l27_wait() {
  local i c
  for i in $(seq 1 90); do
    c="$(docker ps -q --filter label=com.docker.compose.project=looped-l27 --filter label=com.docker.compose.service=api | head -1)"
    if [ -n "$c" ] && docker exec "$c" python3 -c 'import urllib.request,sys; sys.exit(0 if urllib.request.urlopen("http://127.0.0.1:8080/healthz", timeout=2).status == 200 else 1)' 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  die "the api did not answer /healthz within 90s (docker compose -p looped-l27 -f work/compose.yaml logs api)"
}
l27_list() {
  case "$1" in
    container) docker ps -a --format '{{.Names}}' ;;
    volume) docker volume ls --format '{{.Name}}' ;;
    network) docker network ls --format '{{.Name}}' ;;
  esac | grep -E '^looped-l27[-_][a-z0-9_.-]+$' || true
}
l27_rm() {
  local kind="$1" name="$2"
  case "$name" in looped-l27-*|looped-l27_*) ;; *) die "refusing to remove $kind '$name' (not looped-l27-*)" ;; esac
  case "$kind" in
    container) docker rm -f "$name" >/dev/null 2>&1 || true ;;
    volume) docker volume rm "$name" >/dev/null 2>&1 || warn "volume $name in use or already gone" ;;
    network) docker network rm "$name" >/dev/null 2>&1 || true ;;
  esac
}
