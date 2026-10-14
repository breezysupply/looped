#!/usr/bin/env bash
# Run the L20 GitOps reconciler against the kind cluster looped-foundations, namespace beacon.
#   bash labs/sre-cloud-foundations/L20/reconciler/run.sh            # loop every 20 s (Ctrl-C to stop)
#   bash labs/sre-cloud-foundations/L20/reconciler/run.sh --once     # one pass
#   bash labs/sre-cloud-foundations/L20/reconciler/run.sh --verify-only   # artifact identities only, no cluster
# Pause (documented emergency change): echo "<who, why, until when>" > labs/sre-cloud-foundations/L20/work/reconciler/PAUSED
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_workstation python3 git docker kind kubectl
[ -d "$WORK/gitops/.git" ] || die "work/gitops is not prepared; run setup.sh"
case " $* " in
  *" --verify-only "*) require_compose_project "$L20_PROJECT" ;;
  *) require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC" ;;
esac
l20_registry_up
exec python3 "$HERE/reconciler/reconcile.py" "$@"
