#!/usr/bin/env bash
# L01 setup: lab copy of Beacon at /opt/beacon-l01, the broken launcher
# (inject.sh), and the tool inventory as first evidence. Run as root inside
# the course VM. Idempotent.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo (installs under /opt/beacon-l01)"

LAB=/opt/beacon-l01
info "Installing the lab copy at $LAB"
rm -rf "${LAB:?}"
mkdir -p "$LAB/config" "$LAB/data"
cp -r "$SRE_BEACON/beacon" "$LAB/beacon"
cat > "$LAB/config/beacon.yaml" <<'YAML'
server:
  listen: 0.0.0.0
  port: 8080
app:
  version: "1.4.0"
  environment: lab
  admin_enabled: true
store:
  kind: sqlite
  path: /opt/beacon-l01/data/beacon.db
queue:
  kind: none
YAML
chmod -R a+rX "$LAB"

EV="$(evidence_dir "$HERE")"
info "Writing the tool inventory to $EV/L01-inventory.txt"
{
  echo "# L01 tool inventory — $(date -u +%FT%TZ)"
  echo "arch: $(uname -m)"
  echo "kernel: $(uname -r)"
  echo "distro: $(. /etc/os-release && echo "$PRETTY_NAME")"
  echo "python3: $(python3 --version 2>&1)"
  echo "git: $(git --version 2>&1 || echo 'git not found')"
  echo "vm-marker: $(cat /etc/looped-vm 2>/dev/null || echo missing)"
} > "$EV/L01-inventory.txt"
cat "$EV/L01-inventory.txt"

bash "$HERE/inject.sh"
say ""
say "L01 ready. Reproduce with:  bash $LAB/run-beacon.sh"
say "Then copy $HERE/assets/hypotheses-template.md to $EV/L01-hypotheses.md and fill it in."
