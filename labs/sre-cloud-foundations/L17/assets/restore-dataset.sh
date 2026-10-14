#!/usr/bin/env bash
# Restore the known dataset into beacon-db-0 and verify it by checksum.
#   bash labs/sre-cloud-foundations/L17/assets/restore-dataset.sh            # restore + verify
#   bash labs/sre-cloud-foundations/L17/assets/restore-dataset.sh --verify   # verify only
# The dataset is assets/dataset.sql (480 synthetic rows); the expected checksum is
# assets/dataset.checksum ("<rows>:<md5 over every column of every row in id order>").
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
k_basic wait --for=condition=Ready pod/beacon-db-0 --timeout=180s >/dev/null || die "beacon-db-0 is not Ready; fix the database first (kubectl -n beacon describe pod beacon-db-0)"
if [ "${1:-}" != "--verify" ]; then
  info "restoring assets/dataset.sql into beacon-db-0"
  l17_db_exec -q < "$HERE/assets/dataset.sql" >/dev/null
fi
want="$(tr -d '[:space:]' < "$HERE/assets/dataset.checksum")"
got="$(l17_db_exec -At < "$HERE/assets/checksum.sql" 2>/dev/null | tr -d '[:space:]' || true)"
say "checksum: $got (expected $want)"
[ "$got" = "$want" ] || die "dataset does NOT match the known checksum"
say "PASS dataset verified"
