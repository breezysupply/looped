# shellcheck shell=bash
# L20 shared helpers (sourced after lib/looped.sh). Scope: Docker objects named looped-l20-*
# (the registry container looped-l20-registry on 127.0.0.1:5020 and its volume
# looped-l20-registry-data; images looped-l20-beacon:* and 127.0.0.1:5020/looped-l20/beacon:*),
# the kind cluster looped-foundations, namespace beacon, objects labelled looped.lab/id=L20.
L20_PROJECT="looped-l20"
L20_REGISTRY_NAME="looped-l20-registry"
L20_REGISTRY_VOLUME="looped-l20-registry-data"
L20_REGISTRY_IMAGE="registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373"
L20_REGISTRY="127.0.0.1:5020"
L20_LOCAL="looped-l20-beacon"
WORK="$HERE/work"

l20_registry_up() {
  require_compose_project "$L20_PROJECT"
  if [ "$(docker inspect -f '{{.State.Running}}' "$L20_REGISTRY_NAME" 2>/dev/null)" = true ]; then return 0; fi
  if docker inspect "$L20_REGISTRY_NAME" >/dev/null 2>&1; then
    docker start "$L20_REGISTRY_NAME" >/dev/null
  else
    docker volume create --label "$SRE_LABEL=L20" "$L20_REGISTRY_VOLUME" >/dev/null
    docker run -d --name "$L20_REGISTRY_NAME" --label "$SRE_LABEL=L20" --restart no \
      -p "$L20_REGISTRY:5000" -v "$L20_REGISTRY_VOLUME:/var/lib/registry" "$L20_REGISTRY_IMAGE" >/dev/null
  fi
  local i
  for i in $(seq 1 30); do
    if curl -fsS --noproxy '*' "http://$L20_REGISTRY/v2/" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  die "registry $L20_REGISTRY_NAME did not answer on http://$L20_REGISTRY/v2/"
}

l20_git() {  # git with a fixed lab identity (never your global config)
  local repo="$1"; shift
  git -C "$repo" -c user.name="${L20_GIT_NAME:-looped-learner}" -c user.email="${L20_GIT_EMAIL:-learner@corp.lab}" "$@"
}

l20_mark() {  # remember which faults were exercised (validator reads work/.injected)
  printf '%s %s %s\n' "$1" "$(date -u +%FT%TZ)" "${2:-}" >> "$WORK/.injected"
}

l20_replace() {  # l20_replace <file> <old> <new>   exact, single occurrence
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1:4]
src = open(path, encoding="utf-8").read()
if src.count(old) != 1:
    sys.exit("anchor not found exactly once in %s: %r" % (path, old))
open(path, "w", encoding="utf-8").write(src.replace(old, new, 1))
PY
}
