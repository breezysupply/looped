# shellcheck shell=bash
# Shared constants and guards for the SRE & Cloud Deployment Foundations labs.
# Source it; do not run it.
#
# Safety model (curriculum §5): every lab is scoped to looped-* names, an
# exact kind context and a named namespace; scripts validate the target
# before mutating anything; no script deletes host containers, arbitrary
# volumes, default kubeconfig resources or anything outside its lab.

[ -n "${LOOPED_SRE_LOADED:-}" ] && return 0
LOOPED_SRE_LOADED=1

readonly SRE_VM="looped-foundations"               # Lima instance name
readonly SRE_KIND_BASIC="looped-foundations"       # kind cluster (core labs)
readonly SRE_KIND_POLICY="looped-policy"           # kind cluster with an enforcing CNI (L18)
readonly SRE_CTX_BASIC="kind-looped-foundations"
readonly SRE_CTX_POLICY="kind-looped-policy"
readonly SRE_NS="beacon"
readonly SRE_COMPOSE_PREFIX="looped-"
readonly SRE_LABEL="looped.lab/id"

SRE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SRE_ROOT
readonly SRE_LIB="$SRE_ROOT/lib"
readonly SRE_BEACON="$SRE_ROOT/beacon"

say()  { printf '%s\n' "$*"; }
info() { printf '==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Lab id ("L03") from a lab directory path.
lab_id_of() { basename "$1"; }

# ── Linux VM guard (host labs L01–L06) ─────────────────────────────────
# Host labs must run INSIDE the disposable Linux VM, never on macOS.
require_linux_vm() {
  [ "$(uname -s)" = "Linux" ] || die "this lab runs inside the $SRE_VM Linux VM, not on $(uname -s). See profiles/linux-arm64/README.md (limactl shell $SRE_VM)."
  if [ -f /etc/looped-vm ]; then return 0; fi
  if [ -n "${LOOPED_ALLOW_ANY_LINUX:-}" ]; then warn "LOOPED_ALLOW_ANY_LINUX set: running on a Linux host that is not the course VM"; return 0; fi
  die "this does not look like the course VM (/etc/looped-vm missing). Create it with profiles/linux-arm64/vm-create.sh, or set LOOPED_ALLOW_ANY_LINUX=1 on a disposable Linux box you own."
}

# ── kind context guard ─────────────────────────────────────────────────
# k_basic / k_policy ALWAYS pass --context; nothing reads the current context.
k_basic()  { kubectl --context "$SRE_CTX_BASIC" -n "$SRE_NS" "$@"; }
kc_basic() { kubectl --context "$SRE_CTX_BASIC" "$@"; }
k_policy()  { kubectl --context "$SRE_CTX_POLICY" -n "$SRE_NS" "$@"; }
kc_policy() { kubectl --context "$SRE_CTX_POLICY" "$@"; }

require_kind_context() {  # require_kind_context <context> <cluster>
  local ctx="$1" cluster="$2" server host names n
  command -v kubectl >/dev/null 2>&1 || die "kubectl not found"
  command -v kind >/dev/null 2>&1 || die "kind not found"
  server=$(kubectl --context "$ctx" config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null) || server=""
  [ -n "$server" ] || die "context $ctx not found; run profiles/$( [ "$cluster" = "$SRE_KIND_POLICY" ] && echo kind-policy || echo kind-basic )/setup.sh first"
  host="${server#*://}"; host="${host%%/*}"; host="${host%%:*}"
  case "$host" in 127.0.0.1|localhost|::1|0.0.0.0) ;; *) die "context $ctx points at $server, not a local API server; refusing" ;; esac
  names=$(kubectl --context "$ctx" get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' --request-timeout=20s 2>/dev/null) || die "cannot list nodes through $ctx (is the $cluster cluster running?)"
  while IFS= read -r n; do
    [ -z "$n" ] && continue
    case "$n" in "$cluster"-*) ;; *) die "context $ctx has node $n not named $cluster-*; refusing" ;; esac
  done <<<"$names"
}

# ── compose project guard ──────────────────────────────────────────────
require_compose_project() {  # require_compose_project <name>
  case "$1" in "$SRE_COMPOSE_PREFIX"*) ;; *) die "compose project '$1' is not a lab project (${SRE_COMPOSE_PREFIX}*)" ;; esac
  command -v docker >/dev/null 2>&1 || die "docker CLI not found"
  docker info >/dev/null 2>&1 || die "Docker is not reachable; start Docker Desktop / colima"
}
dc() {  # dc <project> <compose args...>   (always -p, always this lab's file dir)
  local project="$1"; shift
  require_compose_project "$project"
  docker compose -p "$project" "$@"
}

# ── evidence helpers ───────────────────────────────────────────────────
evidence_dir() { mkdir -p "$1/evidence"; printf '%s\n' "$1/evidence"; }

# Record what ran, once per lab, without secrets.
record_versions() {
  say "arch: $(uname -m)  os: $(uname -s) $(uname -r)"
  command -v python3 >/dev/null && say "python3: $(python3 --version 2>&1)"
  command -v docker >/dev/null && say "docker: $(docker --version 2>/dev/null)"
  command -v kind >/dev/null && say "kind: $(kind version 2>/dev/null)"
  command -v kubectl >/dev/null && say "kubectl: $(kubectl version --client 2>/dev/null | head -1)"
  command -v helm >/dev/null && say "helm: $(helm version --short 2>/dev/null)"
  command -v terraform >/dev/null && say "terraform: $(terraform version 2>/dev/null | head -1)"
}

# Confirm a destructive-but-scoped action unless LOOPED_YES=1.
confirm() {
  [ "${LOOPED_YES:-0}" = 1 ] && return 0
  printf '%s [y/N] ' "$1"
  read -r ans
  case "$ans" in y|Y|yes) return 0 ;; *) die "cancelled" ;; esac
}
