#!/usr/bin/env bash
# L05 setup: three network namespaces inside the course VM, joined through a
# router namespace, with a parent and a child authoritative DNS server, a
# caching resolver and Beacon — then the chosen fault. Everything is named
# looped-l05-* / l05-*; nothing touches the VM's own interfaces, routes or
# resolver. Run as root inside the course VM.
#
#   looped-l05-client  10.55.1.10/24  default via 10.55.1.1, resolv.conf -> 10.55.2.10
#   looped-l05-rtr     10.55.1.1/24 + 10.55.2.1/24, forwarding on
#   looped-l05-srv     10.55.2.2/24 + .10 (resolver) .53 (corp.lab) .54 (beacon.corp.lab) .80 (Beacon :8080)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo (creates network namespaces)"
command -v ip >/dev/null 2>&1 || die "ip not found: apt-get install -y iproute2"
command -v python3 >/dev/null 2>&1 || die "python3 not found"

LAB=/opt/beacon-l05
CLI=looped-l05-client RTR=looped-l05-rtr SRV=looped-l05-srv
for ns in "$CLI" "$RTR" "$SRV"; do
  ip netns list | grep -qw "$ns" && die "namespace $ns already exists; run teardown.sh (or reset.sh) first"
done
rm -rf "${LAB:?}"
mkdir -p "$LAB/run" "$LAB/zones" "$LAB/.lab"
cp "$HERE/assets/labdns.py" "$LAB/labdns.py"
cp "$HERE/assets/zones/"*.zone "$LAB/zones/"

info "Creating namespaces and links"
for ns in "$CLI" "$RTR" "$SRV"; do ip netns add "$ns"; ip -n "$ns" link set lo up; done
ip link add l05-c0 netns "$CLI" type veth peer name l05-r1 netns "$RTR"
ip link add l05-s0 netns "$SRV" type veth peer name l05-r2 netns "$RTR"
ip -n "$CLI" addr add 10.55.1.10/24 dev l05-c0
ip -n "$RTR" addr add 10.55.1.1/24 dev l05-r1
ip -n "$RTR" addr add 10.55.2.1/24 dev l05-r2
ip -n "$SRV" addr add 10.55.2.2/24 dev l05-s0
for a in 10 53 54 80; do ip -n "$SRV" addr add "10.55.2.$a/24" dev l05-s0; done
ip -n "$CLI" link set l05-c0 up; ip -n "$RTR" link set l05-r1 up; ip -n "$RTR" link set l05-r2 up; ip -n "$SRV" link set l05-s0 up
ip -n "$CLI" route add default via 10.55.1.1
ip -n "$SRV" route add default via 10.55.2.1
ip netns exec "$RTR" sysctl -qw net.ipv4.ip_forward=1
mkdir -p "/etc/netns/$CLI"
printf 'nameserver 10.55.2.10\nsearch corp.lab\noptions timeout:2 attempts:1\n' > "/etc/netns/$CLI/resolv.conf"
printf '127.0.0.1 localhost\n' > "/etc/netns/$CLI/hosts"

EV="$(evidence_dir "$HERE")"
[ -f "$EV/L05-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L05-notes.md"
LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L05 ready. Work from the client namespace, e.g.:"
say "  sudo ip netns exec $CLI curl -sS --noproxy '*' --max-time 5 http://api.beacon.corp.lab:8080/healthz"
say "  sudo ip netns exec $CLI dig api.beacon.corp.lab        # or: python3 $LAB/labdns.py query @10.55.2.10 api.beacon.corp.lab"
say "Zones: $LAB/zones (reload a server with: sudo kill -HUP \$(cat $LAB/run/auth-parent.pid) or auth-child.pid)"
