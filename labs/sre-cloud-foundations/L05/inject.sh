#!/usr/bin/env bash
# L05 fault injection. (Re)starts the DNS fixtures and Beacon in looped-l05-srv
# with one variant's data. The validator reads .lab/variant; it never prints the cause.
#   LOOPED_VARIANT=variant-a   (default)
#   LOOPED_VARIANT=variant-b
#   LOOPED_VARIANT=variant-c
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l05
CLI=looped-l05-client SRV=looped-l05-srv
ip netns list | grep -qw "$SRV" || die "namespaces missing; run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac

stop_fixtures() {
  local f
  for f in "$LAB"/run/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" >/dev/null 2>&1 || true; done
  rm -f "$LAB"/run/*.pid
}
start() {  # start <name> <cmd...>   (inside the server namespace, logs to run/<name>.log)
  local name="$1"; shift
  ip netns exec "$SRV" setsid "$@" >>"$LAB/run/$name.log" 2>&1 < /dev/null &
  echo $! > "$LAB/run/$name.pid"
}
q() { ip netns exec "$CLI" python3 "$LAB/labdns.py" query "$@" >/dev/null 2>&1 || true; }

stop_fixtures
for _ in $(seq 1 25); do  # wait (max 5 s) for the old fixtures to release their sockets
  pgrep -f "$LAB/labdns.py|beacon api --listen 10.55.2.80" >/dev/null 2>&1 || break; sleep 0.2
done
cp "$HERE/assets/zones/"*.zone "$LAB/zones/"
ip -n "$CLI" route flush table main
ip -n "$CLI" addr flush dev l05-c0 && ip -n "$CLI" addr add 10.55.1.10/24 dev l05-c0
ip -n "$CLI" route add default via 10.55.1.1

case "$V" in
  variant-a)  # the parent zone was "cleaned up"
    sed -i '/^; beacon.corp.lab is its own zone/d; /^beacon  *IN NS/d; /^ns1.beacon  *IN A/d' "$LAB/zones/corp.lab.zone"
    sed -i 's/ 2026091001 / 2026091102 /' "$LAB/zones/corp.lab.zone"
    ;;
  variant-b)  # the record is published after someone already asked for it
    sed -i '/^api  *IN A/d; s/ 2026091002 / 2026091001 /' "$LAB/zones/beacon.corp.lab.zone"
    ;;
  variant-c)  # a left-over static route on the client
    ip -n "$CLI" route add 10.55.2.64/27 via 10.55.1.254 dev l05-c0
    ;;
esac

start auth-parent python3 "$LAB/labdns.py" auth --zone "$LAB/zones/corp.lab.zone" --listen 10.55.2.53
start auth-child python3 "$LAB/labdns.py" auth --zone "$LAB/zones/beacon.corp.lab.zone" --listen 10.55.2.54
start resolver python3 "$LAB/labdns.py" resolver --root 10.55.2.53 --root-zone corp.lab --listen 10.55.2.10 --control 10.55.2.10:8953
start beacon env PYTHONPATH="$SRE_BEACON" python3 -m beacon api --listen 10.55.2.80 --port 8080
# wait (up to ~20 s) until every fixture answers inside the server namespace
ip netns exec "$SRV" python3 - "$LAB/labdns.py" <<'PY' || die "fixtures did not start; see $LAB/run/*.log"
import subprocess, sys, time, urllib.request
labdns = sys.argv[1]
def up():
    for srv, name in (("10.55.2.53", "ns1.corp.lab"), ("10.55.2.54", "ns1.beacon.corp.lab")):
        if subprocess.run([sys.executable, labdns, "query", "@" + srv, name, "A", "+norec", "--timeout", "0.5"], capture_output=True).returncode:
            return False
    for url in ("http://10.55.2.10:8953/cache", "http://10.55.2.80:8080/healthz"):
        try:
            urllib.request.urlopen(url, timeout=0.5).read()
        except OSError:
            return False
    return True
deadline = time.time() + 20
while time.time() < deadline:
    if up():
        sys.exit(0)
    time.sleep(0.3)
sys.exit(1)
PY

if [ "$V" = variant-b ]; then
  q @10.55.2.10 api.beacon.corp.lab A          # someone asks before the record exists
  cp "$HERE/assets/zones/beacon.corp.lab.zone" "$LAB/zones/beacon.corp.lab.zone"
  kill -HUP "$(cat "$LAB/run/auth-child.pid")"
fi
cat "$LAB/run/resolver.pid" > "$LAB/.lab/resolver.pid.orig"
printf '%s\n' "$V" > "$LAB/.lab/variant"
info "fixtures running ($V). Logs: $LAB/run/*.log"
