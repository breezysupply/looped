#!/usr/bin/env bash
# Delete lab objects from the looped-lab namespace. Idempotent.
#
#   labs/kind/reset.sh 03          one lab (03, 3 or 03-service-selector)
#   labs/kind/reset.sh all         every lab
#   labs/kind/reset.sh namespace   delete and recreate the whole looped-lab namespace
#                                  (also removes anything you created there by hand)
#
# Only objects labelled looped.lab/id=<NN> (plus the few names listed in
# <lab>/owned.txt) are deleted, and only in namespace looped-lab.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

[ $# -eq 1 ] || die "usage: $0 <NN|all|namespace>"
preflight >/dev/null

case "$1" in
  all)
    for d in "$KIND_DIR"/[0-9][0-9]-*/; do
      id=$(lab_id_of "${d%/}")
      reset_lab "$id"
      say "reset lab $id"
    done
    k delete pods -l "$LABEL_KEY=setup" --ignore-not-found >/dev/null
    ;;
  namespace)
    info "Deleting namespace $NS (lab namespace only) and recreating it"
    kc delete namespace "$NS" --ignore-not-found --wait=true --timeout=180s
    "$KIND_DIR/setup.sh" --no-warm >/dev/null
    say "namespace $NS recreated"
    ;;
  *)
    dir=$(lab_dir_for "$1") || die "no lab matches '$1' (expected 01..10)"
    id=$(lab_id_of "$dir")
    reset_lab "$id"
    left=$(lab_leftovers "$id")
    [ "$left" = 0 ] || warn "$left labelled object(s) for lab $id still terminating"
    say "reset lab $id ($(basename "$dir"))"
    ;;
esac
