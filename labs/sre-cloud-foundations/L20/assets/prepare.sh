#!/usr/bin/env bash
# L20 workspace preparation (no cluster needed): start the lab registry, create the source
# repository work/app (Beacon + Dockerfile + release metadata + tests, one commit for 1.4.0)
# and the GitOps repository work/gitops (desired state for staging and prod). Idempotent:
# existing repositories are kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_workstation python3 git docker curl tar
require_compose_project "$L20_PROJECT"
mkdir -p "$WORK"
l20_registry_up
info "registry $L20_REGISTRY_NAME on http://$L20_REGISTRY (volume $L20_REGISTRY_VOLUME)"

APP="$WORK/app"
if [ -d "$APP/.git" ]; then
  info "work/app exists; keeping it"
else
  mkdir -p "$APP"
  tar -C "$SRE_BEACON" --exclude=__pycache__ -cf - beacon beacon.yaml tests | tar -C "$APP" -xf -
  tar -C "$HERE/assets/app" --exclude=__pycache__ -cf - . | tar -C "$APP" -xf -
  git -C "$APP" init -q -b main
  l20_git "$APP" add -A
  l20_git "$APP" commit -q -m "Beacon 1.4.0 (schema 1-2): baseline for L20"
  info "work/app: $(git -C "$APP" log --oneline | head -1)"
fi

GO="$WORK/gitops"
if [ -d "$GO/.git" ]; then
  info "work/gitops exists; keeping it"
else
  mkdir -p "$GO"
  tar -C "$HERE/assets/gitops" -cf - . | tar -C "$GO" -xf -
  git -C "$GO" init -q -b main
  l20_git "$GO" add -A
  l20_git "$GO" commit -q -m "desired state: staging and prod (nothing promoted yet)"
  info "work/gitops: $(git -C "$GO" log --oneline | head -1)"
fi
mkdir -p "$WORK/ci" "$WORK/reconciler"
touch "$WORK/.injected"
