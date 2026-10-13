#!/usr/bin/env bash
# Delete the course VM. Only ever the instance named looped-foundations.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../lib/looped.sh"
command -v limactl >/dev/null 2>&1 || die "limactl not found"
limactl list --format '{{.Name}}' 2>/dev/null | grep -qx "$SRE_VM" || { say "VM $SRE_VM does not exist; nothing to do"; exit 0; }
confirm "Delete the Lima instance '$SRE_VM' and its disk? Evidence in the repository is kept."
limactl stop "$SRE_VM" >/dev/null 2>&1 || true
limactl delete "$SRE_VM"
say "deleted $SRE_VM"
