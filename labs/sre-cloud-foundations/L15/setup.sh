#!/usr/bin/env bash
# L15 setup: on the kind-basic cluster (context kind-looped-foundations,
# namespace beacon) deploy the baseline Beacon Deployment from manifests/,
# copy it to work/ for you to edit, record an inventory, then inject the
# variant. Touches only objects labelled looped.lab/id=L15 in namespace beacon.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
kc_basic get namespace "$SRE_NS" >/dev/null 2>&1 || die "namespace $SRE_NS missing; run profiles/kind-basic/setup.sh"

EV="$(evidence_dir "$HERE")"
{
  echo "# L15 inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "context: $SRE_CTX_BASIC"
  kc_basic version 2>/dev/null | sed 's/^/  /'
  echo "nodes:"
  kc_basic get nodes -o wide --no-headers 2>/dev/null | awk '{print "  "$1, $2, $5, $8}'
} > "$EV/L15-inventory.txt"
cat "$EV/L15-inventory.txt"
[ -f "$EV/L15-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L15-notes.md"

LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L15 ready. Your desired state is $HERE/work/deployment.yaml (change request CR-1042 in the README)."
say "  kubectl --context $SRE_CTX_BASIC -n $SRE_NS get deploy,rs,pods -l app.kubernetes.io/name=beacon"
