# shellcheck shell=bash
# L26 helpers, sourced by the lab scripts after HERE is set.
# Scope: containers looped-l26-* (the receiver registry and the receiver's
# Compose project looped-l26-recv), networks looped-l26-ingest/looped-l26-recv,
# image tags looped-l26/*, registry.lab/looped-l26/* and 127.0.0.1:15026/looped-l26/*,
# and this lab's work/ directory. Nothing else.
. "$HERE/../lib/looped.sh"

readonly L26_PROJECT="looped-l26-recv"
readonly L26_REGISTRY="127.0.0.1:15026"
readonly L26_REGISTRY_IMAGE="registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373"
readonly L26_BUNDLE="beacon-1.4.0"
WORK="$HERE/work"

l26_guard() {
  require_compose_project "$L26_PROJECT"
  require_workstation python3 openssl
}
l26_bundle() { python3 "$HERE/assets/bundle.py" "$@"; }
l26_variant() { cat "$WORK/.variant" 2>/dev/null || echo "${LOOPED_VARIANT:-variant-a}"; }
l26_genkey() {  # l26_genkey <path>: RSA-3072 private key, mode 0600
  ( umask 077; openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$1" 2>/dev/null )
}
l26_list() {
  case "$1" in
    container) docker ps -a --format '{{.Names}}' | grep -E '^looped-l26-[a-z0-9-]+$' ;;
    network) docker network ls --format '{{.Name}}' | grep -E '^looped-l26-[a-z0-9-]+$' ;;
    image) docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^(looped-l26/|registry\.lab/looped-l26/|127\.0\.0\.1:15026/looped-l26/)[a-z0-9-]+:[A-Za-z0-9._-]+$'
           # digest-only references created when compose pulled IMG_*@sha256:... from the internal registry
           docker image ls --digests --format '{{.Repository}}@{{.Digest}}' | grep -E '^127\.0\.0\.1:15026/looped-l26/[a-z0-9-]+@sha256:[0-9a-f]{64}$' ;;
  esac || true
}
l26_rm() {
  local kind="$1" name="$2"
  case "$name" in looped-l26-*|looped-l26/*|registry.lab/looped-l26/*|127.0.0.1:15026/looped-l26/*) ;; *) die "refusing to remove $kind '$name' (not an L26 object)" ;; esac
  case "$kind" in
    container) docker rm -f -v "$name" >/dev/null 2>&1 || true ;;
    network) docker network rm "$name" >/dev/null 2>&1 || true ;;
    image) docker image rm "$name" >/dev/null 2>&1 || true ;;
  esac
}
