#!/usr/bin/env bash
# L06 fault injection: issue the variant's server certificate(s), write
# proxy.json and (re)start the proxy. The validator reads .lab/variant; it
# never prints the cause.
#   LOOPED_VARIANT=variant-a   (default)
#   LOOPED_VARIANT=variant-b
#   LOOPED_VARIANT=variant-c
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l06
[ -f "$LAB/ca/ca.pem" ] || die "run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac

leaf() {  # leaf <ca dir> <out basename> <SAN dns name> <days>
  local ext
  ext="$(mktemp)"
  sed "s/^subjectAltName = .*/subjectAltName = DNS:$3/" "$HERE/assets/leaf.ext.example" > "$ext"
  openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -sha256 \
    -keyout "$LAB/certs/$2.key" -out "$LAB/certs/$2.csr" -subj "/O=Looped Lab/CN=beacon.corp.lab" 2>/dev/null
  openssl x509 -req -in "$LAB/certs/$2.csr" -CA "$1/ca.pem" -CAkey "$1/ca.key" -CAcreateserial \
    -days "$4" -sha256 -extfile "$ext" -out "$LAB/certs/$2.pem" 2>/dev/null
  chmod 600 "$LAB/certs/$2.key"
  rm -f "$ext"
}
rm -f "$LAB"/certs/*
UPSTREAM_PORT=8086
case "$V" in
  variant-a)
    leaf "$LAB/legacy-ca" beacon-2025 beacon.corp.lab 300
    leaf "$LAB/ca" beacon-2026 beacon.corp.lab 90
    CERT=beacon-2025 ;;
  variant-b)
    leaf "$LAB/ca" beacon-2026 beacon.corp.local 90
    CERT=beacon-2026 ;;
  variant-c)
    leaf "$LAB/ca" beacon-2026 beacon.corp.lab 90
    CERT=beacon-2026; UPSTREAM_PORT=8087 ;;
esac
cat > "$LAB/proxy.json" <<JSON
{
  "listen": "127.0.0.1",
  "port": 8446,
  "server_name": "beacon.corp.lab",
  "cert": "$LAB/certs/$CERT.pem",
  "key": "$LAB/certs/$CERT.key",
  "upstream": "http://127.0.0.1:$UPSTREAM_PORT",
  "upstream_timeout_s": 3,
  "access_log": "$LAB/run/proxy-access.log"
}
JSON
printf '%s\n' "$V" > "$LAB/.lab/variant"
: > "$LAB/run/proxy-access.log"
bash "$HERE/restart-proxy.sh"
info "fault injected ($V)."
