#!/usr/bin/env bash
# Put the course VM back to its baseline without recreating it.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../lib/looped.sh"
command -v limactl >/dev/null 2>&1 || die "limactl not found"
limactl list --format '{{.Name}}' 2>/dev/null | grep -qx "$SRE_VM" || die "VM $SRE_VM does not exist; run vm-create.sh"
limactl start "$SRE_VM" >/dev/null 2>&1 || true
info "Re-running the baseline inside $SRE_VM (removes lab units, /opt/beacon, /etc/beacon, /var/lib/beacon, lab namespaces and loop filesystems)"
limactl shell "$SRE_VM" -- sudo bash "$(pwd)/labs/sre-cloud-foundations/profiles/linux-arm64/bootstrap.sh"
