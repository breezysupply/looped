#!/usr/bin/env bash
# L10 teardown: remove work/ only; evidence/ stays. Nothing exists in any
# cloud account: this lab never calls one.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
WORK="$HERE/work"
[ -d "$WORK" ] || { info "nothing to remove"; exit 0; }
rm -rf "${WORK:?}"
info "removed $WORK (evidence/ kept)"
