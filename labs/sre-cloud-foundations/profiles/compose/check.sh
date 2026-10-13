#!/usr/bin/env bash
# Compose profile preflight: read-only. Verifies the Docker CLI and engine are
# reachable, Compose v2 is installed, and records the engine/host architecture.
# Creates nothing, removes nothing, changes no setting. Exit 1 if not ready.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../lib/looped.sh"

fail=0
ok()  { printf 'OK    %s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; fail=1; }

if command -v docker >/dev/null 2>&1; then ok "docker CLI: $(docker --version 2>/dev/null)"; else bad "docker CLI not found (install Docker Desktop or colima + docker CLI; see README.md)"; fi
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "engine reachable: $(docker info --format 'server {{.ServerVersion}} {{.OSType}}/{{.Architecture}}, {{.NCPU}} CPUs, {{.MemTotal}} bytes' 2>/dev/null)"
  ok "context: $(docker context show 2>/dev/null || echo default)"
else
  bad "Docker engine not reachable (start Docker Desktop, or: colima start --cpu 4 --memory 8)"
fi
if command -v docker >/dev/null 2>&1 && v="$(docker compose version --short 2>/dev/null)"; then
  case "$v" in
    v1.*|1.*) bad "Compose $v is v1; the labs need Compose v2 (docker compose, not docker-compose)" ;;
    *) ok "compose: $v" ;;
  esac
else
  bad "docker compose (v2 plugin) not found"
fi
if command -v docker >/dev/null 2>&1 && docker buildx version >/dev/null 2>&1; then ok "buildx: $(docker buildx version 2>/dev/null | awk '{print $2}')"; else warn "buildx not found: single-platform docker build still works"; fi

host="$(uname -s)/$(uname -m)"
eng="$(docker info --format '{{.Architecture}}' 2>/dev/null || echo unknown)"
ok "host: $host; engine architecture: $eng"
case "$(uname -s)/$(uname -m)/$eng" in
  Darwin/arm64/aarch64|Darwin/arm64/arm64) ok "Apple Silicon with an arm64 engine: images build natively as linux/arm64" ;;
  Darwin/arm64/*) warn "Apple Silicon host but the engine reports $eng: you are running an emulated engine; builds will be slow and L13's architecture check will compare against $eng" ;;
esac
command -v python3 >/dev/null 2>&1 && ok "python3: $(python3 --version 2>&1) (validators and the wheelhouse download)" || bad "python3 not found"

projects="$(docker compose ls --all --format json 2>/dev/null | python3 -c 'import json,sys; print(" ".join(p["Name"] for p in json.load(sys.stdin) if p["Name"].startswith("looped-")))' 2>/dev/null || true)"
ok "lab projects present: ${projects:-none}"
[ "$fail" = 0 ] && say "compose profile: ready" || say "compose profile: NOT ready (see FAIL lines)"
exit "$fail"
