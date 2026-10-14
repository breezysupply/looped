#!/usr/bin/env bash
# "Carry" the sender's bundle to the receiver: replace work/inbox/<bundle>
# with a fresh copy of work/outbox/<bundle>. In a real enclave this is
# removable media or a one-way transfer; nothing is verified here — that is
# the receiver's job (bundle.py verify).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L26_PROJECT"
l26_guard
SRC="$WORK/outbox/$L26_BUNDLE"
DST="$WORK/inbox/$L26_BUNDLE"
[ -f "$SRC/manifest.json" ] || die "no exported bundle at $SRC; run bundle.py export first"
rm -rf "${DST:?}"
mkdir -p "$WORK/inbox"
cp -R "$SRC" "$DST"
info "transferred $L26_BUNDLE to the receiver inbox ($(du -sh "$DST" | cut -f1))"
