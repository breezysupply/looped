#!/usr/bin/env bash
# L09 teardown: remove the workspace work/ only. evidence/ stays. There is no
# cloud resource to remove: this lab never creates one.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
WORK="$HERE/work"
[ -d "$WORK" ] || { info "nothing to remove"; exit 0; }
rm -rf "${WORK:?}"
info "removed $WORK (evidence/ kept)"
