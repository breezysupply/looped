#!/usr/bin/env bash
# L07 teardown: remove generated data only (data/, out/, .variant). Your code and
# tests stay — they are your work; delete the workspace yourself if you want to.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
WORK="${L07_WORK:-$HERE/work}"
[ -d "$WORK" ] || { info "nothing to remove ($WORK missing)"; exit 0; }
rm -rf "${WORK:?}/data" "${WORK:?}/out" "${WORK:?}/__pycache__"
rm -f "$WORK/.variant"
info "removed generated data under $WORK; logsummary.py and your tests kept"
