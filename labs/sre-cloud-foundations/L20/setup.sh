#!/usr/bin/env bash
# L20 setup: prepare the workspace (lab registry looped-l20-registry on 127.0.0.1:5020, source
# repo work/app, GitOps repo work/gitops), create the per-environment database Secrets in the
# cluster (placeholder values, never in git), run the local pipeline once for the 1.4.0 baseline
# (test → build → scan stub → publish → promote staging), promote that same digest to prod with
# an explicit approval, reconcile once, then inject the first fault (teammate commits for 1.5.0).
# Idempotent: existing repositories, promotions and injections are kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
require_workstation python3 git docker kind curl
bash "$HERE/assets/prepare.sh"

kc_basic get namespace "$SRE_NS" >/dev/null 2>&1 || die "namespace $SRE_NS missing in $SRE_KIND_BASIC; run profiles/kind-basic/setup.sh (it creates it with Pod Security 'restricted')"
others="$(k_basic get deploy,statefulset -o jsonpath='{range .items[*]}{.kind}/{.metadata.name}={.metadata.labels.looped\.lab/id}{"\n"}{end}' 2>/dev/null | grep -v '=L20$' || true)"
[ -z "$others" ] || warn "namespace $SRE_NS also holds objects from other labs: $(echo "$others" | tr '\n' ' ')— run their teardown.sh to free memory."
for env in staging prod; do
  # the value is a placeholder and lives only in the cluster; the Deployment references it by name
  k_basic apply -f - >/dev/null <<SECRET
apiVersion: v1
kind: Secret
metadata:
  name: beacon-$env-db
  namespace: $SRE_NS
  labels: {looped.lab/id: L20, env: $env}
type: Opaque
stringData:
  password: lab-l20-$env-db-not-a-real-secret
SECRET
done

if [ ! -f "$WORK/gitops/promotions/staging.json" ]; then
  info "baseline pipeline run for Beacon 1.4.0"
  bash "$HERE/ci-local.sh" run
fi
if [ ! -f "$WORK/gitops/promotions/prod.json" ]; then
  bash "$HERE/ci-local.sh" promote prod --from staging --approve "setup-baseline"
fi
info "first reconcile (applies staging and prod from git HEAD)"
bash "$HERE/reconciler/run.sh" --once
k_basic rollout status deploy/beacon-staging --timeout=240s
k_basic rollout status deploy/beacon-prod --timeout=240s

EV="$(evidence_dir "$HERE")"
{
  echo "# L20 inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "git: $(git --version)"
  echo "registry: $L20_REGISTRY_NAME $L20_REGISTRY_IMAGE on $L20_REGISTRY"
  echo "scanner: ${LOOPED_SCAN:-stub} (stub = policy checks only, NOT a vulnerability scan)"
  echo "ci: local-only (ci-local.sh); hosted workflow not run unless you say so in your notes"
} > "$EV/L20-inventory.txt"
cat "$EV/L20-inventory.txt"
[ -f "$EV/L20-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L20-notes.md"
if grep -q '^gate ' "$WORK/.injected" 2>/dev/null; then
  info "the 1.5.0 commits are already in work/app ($(cat "$WORK/.variant" 2>/dev/null))"
else
  LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh" gate
fi
say ""
say "L20 ready. Read $WORK/TICKETS.md; start the reconciler in a second terminal:"
say "  bash $HERE/reconciler/run.sh"
