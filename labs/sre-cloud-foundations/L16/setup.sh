#!/usr/bin/env bash
# L16 setup: on the kind-basic cluster (context kind-looped-foundations,
# namespace beacon) copy manifests/ to work/, record an inventory, then
# inject.sh applies the variant. L16 replaces L15's Deployment (same name,
# same namespace); only objects labelled looped.lab/id=L15 or L16 are removed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
kc_basic get namespace "$SRE_NS" >/dev/null 2>&1 || die "namespace $SRE_NS missing; run profiles/kind-basic/setup.sh"

EV="$(evidence_dir "$HERE")"
{
  echo "# L16 inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "context: $SRE_CTX_BASIC"
  kc_basic version 2>/dev/null | sed 's/^/  /'
  echo "nodes:"
  kc_basic get nodes -o wide --no-headers 2>/dev/null | awk '{print "  "$1, $2, $5, $8}'
} > "$EV/L16-inventory.txt"
cat "$EV/L16-inventory.txt"
[ -f "$EV/L16-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L16-notes.md"

LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L16 ready. Desired state: $HERE/work/*.yaml"
say "  kubectl --context $SRE_CTX_BASIC -n $SRE_NS get deploy,svc,endpointslices,pods -l looped.lab/id=L16"
