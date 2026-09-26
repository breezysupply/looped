#!/usr/bin/env bash
# Preflight for the Looped kind labs. Refuses (exit 1, with a reason) rather
# than risk running against anything but the dedicated local lab cluster.
#
#   lib/preflight.sh                 full check (used by inject/verify/reset/solve)
#   lib/preflight.sh --setup         tools + Docker; context/node checks only if the cluster exists
#   lib/preflight.sh --context-only  only the kubeconfig context check (no Docker needed)
#
# Checks: docker reachable; kind (>= v0.33.0) and kubectl present; context
# kind-looped-onsite exists; its API server is a local address (127.0.0.1,
# localhost, ::1, 0.0.0.0); every node is named looped-onsite-*.
set -u
# shellcheck source=common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

MODE="full"
case "${1:-}" in
  "") ;;
  --setup) MODE="setup" ;;
  --context-only) MODE="context" ;;
  *) printf 'usage: %s [--setup|--context-only]\n' "$0" >&2; exit 2 ;;
esac

refuse() { printf 'PREFLIGHT REFUSED: %s\n' "$*" >&2; exit 1; }
MIN_KIND="0.33.0"

# version_ge A B  -> true if A >= B (dotted numeric)
version_ge() {
  local IFS=. i a b
  read -r -a a <<<"$1"; read -r -a b <<<"$2"
  for i in 0 1 2; do
    [ "${a[$i]:-0}" -gt "${b[$i]:-0}" ] && return 0
    [ "${a[$i]:-0}" -lt "${b[$i]:-0}" ] && return 1
  done
  return 0
}

check_kubectl() {
  command -v kubectl >/dev/null 2>&1 || refuse "kubectl not found on PATH (see labs/kind/README.md, Prerequisites)"
}

# The context must exist and point at a local API server.
check_context() {
  local server host
  server=$(kc config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null) || server=""
  [ -n "$server" ] || refuse "kubectl context '$CTX' not found. Run labs/kind/setup.sh first (it creates the '$CLUSTER' kind cluster and that context)."
  host="${server#*://}"
  case "$host" in
    \[*) host="${host#\[}"; host="${host%%\]*}" ;;
    *)   host="${host%%/*}"; host="${host%%:*}" ;;
  esac
  case "$host" in
    127.0.0.1|localhost|::1|0.0.0.0) ;;
    *) refuse "context '$CTX' points at API server '$server' (host '$host'), which is not a local address. These labs only run against a local kind cluster; refusing so you do not touch a real cluster." ;;
  esac
  CONTEXT_SERVER="$server"
}

check_nodes() {
  local names n bad=""
  names=$(kc get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' --request-timeout=20s 2>/dev/null) \
    || refuse "cannot list nodes through context '$CTX' (is the '$CLUSTER' cluster running? try: kind get clusters)"
  [ -n "$names" ] || refuse "context '$CTX' returned no nodes"
  while IFS= read -r n; do
    case "$n" in "$CLUSTER"-*) ;; *) bad="$bad $n" ;; esac
  done <<<"$names"
  [ -z "$bad" ] || refuse "context '$CTX' has nodes not named $CLUSTER-*:$bad. This does not look like the lab cluster; refusing."
  NODE_NAMES=$(printf '%s' "$names" | tr '\n' ' ')
}

if [ "$MODE" = "context" ]; then
  check_kubectl
  check_context
  printf 'preflight (context-only): %s -> %s\n' "$CTX" "$CONTEXT_SERVER"
  exit 0
fi

# ── tools and Docker ─────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || refuse "docker CLI not found on PATH (install Docker Desktop, colima or another Docker engine)"
docker info >/dev/null 2>&1 || refuse "Docker is not reachable ('docker info' failed). Start Docker Desktop / 'colima start', or check 'docker context ls'."
command -v kind >/dev/null 2>&1 || refuse "kind not found on PATH (need v$MIN_KIND or newer; see README.md)"
check_kubectl

kind_ver=$(kind version 2>/dev/null | awk '{print $2}')
kind_num="${kind_ver#v}"; kind_num="${kind_num%%-*}"
version_ge "$kind_num" "$MIN_KIND" || refuse "kind $kind_ver is older than v$MIN_KIND; the pinned node image targets kind v$MIN_KIND+. Upgrade kind."

printf 'host:     %s %s\n' "$(uname -s)" "$(uname -m)"
printf 'docker:   %s\n' "$(docker version --format 'client {{.Client.Version}}, server {{.Server.Version}} ({{.Server.Os}}/{{.Server.Arch}})' 2>/dev/null)"
printf 'kind:     %s\n' "$(kind version 2>/dev/null)"
printf 'kubectl:  %s\n' "$(kc version --client 2>/dev/null | head -1)"

mem=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
if [ "${mem:-0}" -gt 0 ] && [ "$mem" -lt 4000000000 ]; then
  warn "Docker has $((mem / 1048576)) MiB of memory; the two-node cluster plus labs wants about 4 GiB or more (see README troubleshooting)."
fi

if [ "$MODE" = "setup" ]; then
  # Before creation the context may legitimately be absent. If it exists, it
  # must still be local, and a running cluster must have the expected nodes.
  if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
    if kc config get-contexts "$CTX" >/dev/null 2>&1; then
      check_context
      check_nodes
      printf 'cluster:  %s (%s), nodes: %s\n' "$CLUSTER" "$CONTEXT_SERVER" "$NODE_NAMES"
    fi
  elif kc config get-contexts "$CTX" >/dev/null 2>&1; then
    check_context
  fi
  printf 'preflight (setup): OK\n'
  exit 0
fi

check_context
check_nodes
printf 'cluster:  %s via %s, nodes: %s\n' "$CTX" "$CONTEXT_SERVER" "$NODE_NAMES"

server_minor=$(kc version -o json --request-timeout=20s 2>/dev/null | tr -d ' \n' | sed -n 's/.*"serverVersion":{[^}]*"minor":"\([0-9]*\).*/\1/p')
client_minor=$(kc version --client -o json 2>/dev/null | tr -d ' \n' | sed -n 's/.*"clientVersion":{[^}]*"minor":"\([0-9]*\).*/\1/p')
if [ -n "$server_minor" ] && [ -n "$client_minor" ]; then
  d=$((client_minor - server_minor)); [ "$d" -lt 0 ] && d=$((-d))
  [ "$d" -le 1 ] || warn "kubectl 1.$client_minor vs cluster 1.$server_minor is outside the supported +/-1 minor skew; some output may differ."
fi
printf 'preflight: OK\n'
