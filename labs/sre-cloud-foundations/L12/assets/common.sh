# shellcheck shell=bash
# L12 helpers, sourced by setup/inject/reset/teardown after HERE is set.
# Scope: Docker objects named looped-l12-* and Terraform state under work/.
. "$HERE/../lib/looped.sh"

readonly L12_PROJECT="looped-l12"
readonly L12_IMAGE="python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d"
WORK="$HERE/work"
export TF_IN_AUTOMATION=1

l12_guard() {
  require_compose_project "$L12_PROJECT"   # docker reachable; the project name is a looped-* name
  require_workstation terraform python3
  if [ -z "${DOCKER_HOST:-}" ]; then
    local h
    h="$(docker context inspect -f '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
    if [ -n "$h" ]; then export DOCKER_HOST="$h"; fi
  fi
}

# terraform in one of this lab's roots, after the workspace guard
l12_tf() {
  local dir="$1"; shift
  require_terraform_dir "$dir"
  terraform -chdir="$dir" "$@"
}

# names of this lab's Docker objects (exact prefix match, nothing else)
l12_list() {
  case "$1" in
    container) docker ps -a --format '{{.Names}}' ;;
    volume) docker volume ls --format '{{.Name}}' ;;
    network) docker network ls --format '{{.Name}}' ;;
  esac | grep -E '^looped-l12-[a-z0-9-]+$' || true
}

# remove ONE object, refusing anything not named looped-l12-*
l12_rm() {
  local kind="$1" name="$2"
  case "$name" in looped-l12-*) ;; *) die "refusing to remove $kind '$name' (not looped-l12-*)" ;; esac
  case "$kind" in
    container) docker rm -f "$name" >/dev/null 2>&1 || true ;;
    volume) docker volume rm "$name" >/dev/null 2>&1 || warn "volume $name still in use or already gone" ;;
    network) docker network rm "$name" >/dev/null 2>&1 || true ;;
  esac
}

l12_wait_health() {  # l12_wait_health <port>
  python3 - "$1" <<'PY'
import sys, time, urllib.request
url = "http://127.0.0.1:%s/healthz" % sys.argv[1]
for _ in range(60):
    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            if r.status == 200:
                print("healthy: " + url)
                sys.exit(0)
    except Exception:
        pass
    time.sleep(1)
print("no 200 from " + url + " within 60s", file=sys.stderr)
sys.exit(1)
PY
}
