#!/usr/bin/env bash
# Create (or reuse) the disposable Linux VM for the host labs, then run the
# baseline bootstrap inside it. Idempotent.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../lib/looped.sh"

command -v limactl >/dev/null 2>&1 || die "limactl not found. Install Lima: brew install lima (see README.md)"
case "$(uname -s)" in Darwin) ;; Linux) warn "running on Linux: vmType vz is macOS-only; edit looped-foundations.yaml to vmType: qemu first" ;; esac

if limactl list --format '{{.Name}}' 2>/dev/null | grep -qx "$SRE_VM"; then
  info "VM $SRE_VM already exists; starting it if stopped"
  limactl start "$SRE_VM" >/dev/null 2>&1 || true
else
  info "Creating VM $SRE_VM (first boot downloads the Ubuntu 24.04 cloud image, ~600 MB)"
  limactl create --name "$SRE_VM" --tty=false "$HERE/looped-foundations.yaml"
  limactl start "$SRE_VM"
fi

info "Running the baseline bootstrap inside the VM"
limactl shell "$SRE_VM" -- sudo bash "$(pwd)/labs/sre-cloud-foundations/profiles/linux-arm64/bootstrap.sh"

cat <<TXT

Ready. Open a shell with:   limactl shell $SRE_VM
Run host labs from the repository root inside that shell, e.g.
  sudo bash labs/sre-cloud-foundations/L01/setup.sh
TXT
