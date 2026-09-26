# shellcheck shell=bash
# Shared constants and helpers for the Looped kind labs. Source it; do not run it.
#
# Safety model: every kubectl call goes through k() or kc(), which ALWAYS pass
# --context kind-looped-onsite. Nothing here reads or changes your current
# kubectl context, and the names below are constants, not environment
# variables, so they cannot be redirected at another cluster by accident.

[ -n "${LOOPED_COMMON_LOADED:-}" ] && return 0
LOOPED_COMMON_LOADED=1

readonly CLUSTER="looped-onsite"
readonly CTX="kind-looped-onsite"
readonly NS="looped-lab"
readonly LABEL_KEY="looped.lab/id"

# Pinned by multi-arch index digest; each index was checked for linux/amd64 and
# linux/arm64 (see README.md "Images and downloads").
readonly KIND_NODE_IMAGE="kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5"
readonly BUSYBOX_IMAGE="docker.io/library/busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e"
readonly CURL_IMAGE="docker.io/curlimages/curl:8.16.0@sha256:463eaf6072688fe96ac64fa623fe73e1dbe25d8ad6c34404a669ad3ce1f104b6"

KIND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly KIND_DIR
readonly LIB_DIR="$KIND_DIR/lib"

# kubectl, namespaced to the lab namespace, always against the lab context.
k() { kubectl --context "$CTX" -n "$NS" "$@"; }
# kubectl against the lab context without a namespace (nodes, StorageClasses,
# `auth can-i` in other namespaces). Still always the lab context.
kc() { kubectl --context "$CTX" "$@"; }

say()  { printf '%s\n' "$*"; }
info() { printf '==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# verify.sh helpers: collect problems, then report once.
LOOPED_PROBLEMS=()
problem() { LOOPED_PROBLEMS+=("$*"); }
report() {  # report "<what passing means>"
  if [ "${#LOOPED_PROBLEMS[@]}" -eq 0 ]; then
    printf 'PASS %s\n' "$1"; exit 0
  fi
  local p
  for p in "${LOOPED_PROBLEMS[@]}"; do printf 'FAIL: %s\n' "$p"; done
  exit 1
}

# wait_until <timeout-seconds> <description> <command...>
# Polls every 2s until the command succeeds or the timeout expires.
wait_until() {
  local timeout="$1" desc="$2"; shift 2
  local start now
  start=$(date +%s)
  while :; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    now=$(date +%s)
    if [ $((now - start)) -ge "$timeout" ]; then
      warn "timed out after ${timeout}s waiting for: $desc"
      return 1
    fi
    sleep 2
  done
}

# ready_endpoints <service>: number of ready endpoints across the Service's
# EndpointSlices (0 when a slice has no endpoints at all).
ready_endpoints() {
  k get endpointslices -l "kubernetes.io/service-name=$1" \
    -o go-template='{{range .items}}{{range .endpoints}}{{if .conditions.ready}}x{{end}}{{end}}{{end}}' 2>/dev/null \
    | tr -cd x | wc -c | tr -d ' '
}

# pod_phase_is <pod> <phase>
pod_phase_is() { [ "$(k get pod "$1" -o jsonpath='{.status.phase}' 2>/dev/null)" = "$2" ]; }

# wait_rollout <deployment> [timeout-seconds]
wait_rollout() {
  k rollout status "deployment/$1" --timeout="${2:-180}s"
}

# Seconds since an RFC3339 timestamp (GNU date or BSD/macOS date).
age_seconds() {
  local ts="$1" then now
  then=$(date -u -d "$ts" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$ts" +%s 2>/dev/null) || return 1
  now=$(date -u +%s)
  printf '%s\n' $((now - then))
}

# Lab id ("01".."10") from a lab directory path such as .../03-service-selector.
lab_id_of() { basename "$1" | cut -c1-2; }

# Resolve "3", "03" or "03-service-selector" to the lab directory.
lab_dir_for() {
  local want="$1" d
  case "$want" in [0-9]) want="0$want" ;; esac
  for d in "$KIND_DIR"/[0-9][0-9]-*/; do
    d="${d%/}"
    case "$(basename "$d")" in "$want"|"$want"-*) printf '%s\n' "$d"; return 0 ;; esac
  done
  return 1
}

# Kinds reset.sh deletes by label. Namespaced only.
readonly LAB_KINDS="deployments,replicasets,statefulsets,jobs,pods,services,configmaps,secrets,serviceaccounts,roles,rolebindings,persistentvolumeclaims"

# reset_lab <NN>: delete everything labelled looped.lab/id=<NN> in looped-lab,
# plus the few objects a lab's fix creates by name (listed in <lab>/owned.txt,
# one kind/name per line). Only ever touches the looped-lab namespace.
reset_lab() {
  local id="$1" dir line
  k delete "$LAB_KINDS" -l "$LABEL_KEY=$id" --ignore-not-found --wait=true --timeout=120s >/dev/null
  dir=$(lab_dir_for "$id") || return 0
  if [ -f "$dir/owned.txt" ]; then
    while IFS= read -r line; do
      case "$line" in ''|'#'*) continue ;; esac
      k delete "$line" --ignore-not-found --wait=true --timeout=120s >/dev/null
    done < "$dir/owned.txt"
  fi
  # Images a lab imported into the nodes (listed in <lab>/node-images.txt) are
  # removed from the nodes of the looped-onsite cluster only, so the lab can be
  # repeated from the broken state.
  if [ -f "$dir/node-images.txt" ]; then
    remove_node_images "$dir/node-images.txt"
  fi
  # PersistentVolumes from lab claims are released by the default reclaim
  # policy (Delete) of kind's local-path provisioner once the claim is gone.
  return 0
}

# remove_node_images <file>: remove each listed image NAME from each node of
# the lab cluster (nodes named looped-onsite-*; anything else is skipped).
# 'ctr images rm' deletes only that name; content still referenced by other
# names (lab 10's image shares its content with the pinned busybox) stays.
# ('crictl rmi' would remove the image by ID, taking busybox with it.)
remove_node_images() {
  local node img
  for node in $(kind get nodes --name "$CLUSTER" 2>/dev/null); do
    case "$node" in "$CLUSTER"-*) ;; *) continue ;; esac
    while IFS= read -r img; do
      case "$img" in ''|'#'*) continue ;; esac
      docker exec "$node" ctr --namespace k8s.io images rm "$img" >/dev/null 2>&1 || true
    done < "$1"
  done
}

# Count labelled objects still present for a lab (used by reset and the harness).
lab_leftovers() {
  k get "$LAB_KINDS" -l "$LABEL_KEY=$1" -o name 2>/dev/null | grep -c . || true
}

# Run the full preflight (or a given mode) and stop if it refuses.
preflight() {
  "$LIB_DIR/preflight.sh" "$@" || exit 1
}
