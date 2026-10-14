#!/usr/bin/env bash
# L06 setup: a lab certificate authority (and an older "legacy" one), Beacon on
# 127.0.0.1:8086, and a TLS reverse proxy on 127.0.0.1:8446 for beacon.corp.lab,
# then the chosen fault. Everything lives under /opt/beacon-l06; the system
# trust store is never touched. Run as root inside the course VM.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo (installs under /opt/beacon-l06)"
command -v openssl >/dev/null 2>&1 || die "openssl not found"
command -v python3 >/dev/null 2>&1 || die "python3 not found"

LAB=/opt/beacon-l06
bash "$HERE/teardown.sh" >/dev/null 2>&1 || true
mkdir -p "$LAB/ca" "$LAB/legacy-ca" "$LAB/certs" "$LAB/run" "$LAB/.lab"
cp "$HERE/assets/tlsproxy.py" "$HERE/assets/leaf.ext.example" "$LAB/"
chmod 700 "$LAB/ca" "$LAB/legacy-ca"

mkca() {  # mkca <dir> <common name>
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -sha256 -days 365 \
    -keyout "$1/ca.key" -out "$1/ca.pem" -subj "/O=Looped Lab/CN=$2" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" 2>/dev/null
  chmod 600 "$1/ca.key"
}
info "Creating the lab CA and a legacy CA (P-256, one year, lab use only)"
mkca "$LAB/ca" "Looped Lab Root CA L06"
mkca "$LAB/legacy-ca" "Looped Legacy Lab CA"
sha256sum "$LAB/ca/ca.pem" | cut -d' ' -f1 > "$LAB/.lab/ca.sha256"

info "Starting Beacon on 127.0.0.1:8086"
setsid env PYTHONPATH="$SRE_BEACON" python3 -m beacon api --listen 127.0.0.1 --port 8086 >>"$LAB/run/beacon.log" 2>&1 < /dev/null &
echo $! > "$LAB/run/beacon.pid"
for _ in $(seq 1 40); do python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8086/healthz', timeout=0.5)" 2>/dev/null && break; python3 -c "import time; time.sleep(0.25)"; done

EV="$(evidence_dir "$HERE")"
[ -f "$EV/L06-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L06-notes.md"
LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L06 ready. The lab trust anchor is $LAB/ca/ca.pem. Try:"
say "  curl -sS --noproxy '*' --cacert $LAB/ca/ca.pem --resolve beacon.corp.lab:8446:127.0.0.1 https://beacon.corp.lab:8446/healthz"
say "  openssl s_client -connect 127.0.0.1:8446 -servername beacon.corp.lab -CAfile $LAB/ca/ca.pem </dev/null"
say "Proxy config: $LAB/proxy.json  ·  restart after edits: sudo bash $HERE/restart-proxy.sh"
