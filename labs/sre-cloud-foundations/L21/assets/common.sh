# shellcheck shell=bash
# L21 helpers, sourced by setup/inject/reset/teardown after HERE is set.
# Scope: compose project looped-l21 (containers looped-l21-*) on the profile's
# network looped-obs-net, and this lab's work/ directory. The observability
# profile itself is started and stopped by profiles/observability/*.sh.
. "$HERE/../lib/looped.sh"

readonly L21_PROJECT="looped-l21"
readonly L21_COMPOSE="$HERE/assets/compose.yaml"
WORK="$HERE/work"
export LOOPED_UID="${LOOPED_UID:-$(id -u)}" LOOPED_GID="${LOOPED_GID:-$(id -g)}"

l21_guard() {
  require_compose_project "$L21_PROJECT"
  require_workstation python3
}
l21_require_profile() {
  docker network inspect looped-obs-net >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Running}}' looped-obs-prometheus 2>/dev/null)" = true ] \
    || die "the observability profile is not running: bash $SRE_ROOT/profiles/observability/setup.sh"
}
l21_dc() { dc "$L21_PROJECT" -f "$L21_COMPOSE" "$@"; }
l21_variant() { cat "$WORK/.variant" 2>/dev/null || echo "${LOOPED_VARIANT:-variant-a}"; }
l21_wait_api() {
  python3 - <<'PY'
import sys, time, urllib.request
o = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for _ in range(60):
    try:
        if o.open("http://127.0.0.1:18521/healthz", timeout=2).status == 200:
            sys.exit(0)
    except Exception:
        time.sleep(1)
sys.exit("API did not answer on 127.0.0.1:18521 within 60s (docker logs looped-l21-api)")
PY
}
