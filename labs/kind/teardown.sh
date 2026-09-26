#!/usr/bin/env bash
# Delete the dedicated kind cluster 'looped-onsite' and nothing else.
#
#   labs/kind/teardown.sh          asks for confirmation
#   labs/kind/teardown.sh --yes    no prompt
#   labs/kind/teardown.sh --dry-run  show what would be deleted, delete nothing
#
# The cluster name is a constant in lib/common.sh. Any other argument is
# refused, so this script cannot be pointed at a different cluster.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

YES=0; DRY=0
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    --dry-run) DRY=1 ;;
    *) printf 'REFUSED: unexpected argument %s. teardown.sh only deletes the cluster %s and takes no name; options: --yes, --dry-run\n' "'$a'" "'$CLUSTER'" >&2
       exit 2 ;;
  esac
done
[ "$CLUSTER" = "looped-onsite" ] || { printf 'REFUSED: cluster constant is %s, expected looped-onsite\n' "$CLUSTER" >&2; exit 2; }

if [ "$DRY" = 1 ]; then
  say "dry run: would run: kind delete cluster --name $CLUSTER"
  exit 0
fi

command -v kind >/dev/null 2>&1 || die "kind not found on PATH"
if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  say "No kind cluster named '$CLUSTER'; nothing to delete."
  exit 0
fi

if [ "$YES" != 1 ]; then
  printf "Delete the kind cluster '%s' (all lab state is lost)? Type the cluster name to confirm: " "$CLUSTER"
  read -r answer || answer=""
  [ "$answer" = "$CLUSTER" ] || { say "Not confirmed; nothing deleted."; exit 1; }
fi

kind delete cluster --name "$CLUSTER"
say "Deleted cluster '$CLUSTER' (kind also removed context '$CTX' from your kubeconfig)."
