#!/usr/bin/env bash
# L01 fault injection: write the broken launcher for the chosen variant.
#   LOOPED_VARIANT=variant-a   relative config path, started from /    (default)
#   LOOPED_VARIANT=variant-b   config needs BEACON_STORE_URL; env file not sourced
# The validator reads .variant to know which error signature to expect; it
# never prints the cause.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l01
[ -d "$LAB/beacon" ] || die "run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V (variant-a | variant-b)" ;; esac

if [ "$V" = variant-a ]; then
  cat > "$LAB/run-beacon.sh" <<'SH'
#!/usr/bin/env bash
# Beacon launcher (lab copy). Starts the API in the foreground.
cd /
export PYTHONPATH=/opt/beacon-l01
exec python3 -m beacon api --config config/beacon.yaml
SH
  printf 'variant-a\n' > "$LAB/.variant"
else
  cat > "$LAB/env" <<'ENV'
# Beacon environment for the lab host
BEACON_STORE_KIND=postgres
BEACON_STORE_URL=postgres://beacon@127.0.0.1:5432/beacon
ENV
  # the config asks for postgres; the URL only arrives through the env file,
  # which the launcher never sources
  sed -i 's/^  kind: sqlite$/  kind: postgres/; /^  path: /d' "$LAB/config/beacon.yaml"
  cat > "$LAB/run-beacon.sh" <<'SH'
#!/usr/bin/env bash
# Beacon launcher (lab copy). Starts the API in the foreground.
cd /opt/beacon-l01
export PYTHONPATH=/opt/beacon-l01
# environment is in ./env
exec python3 -m beacon api --config config/beacon.yaml
SH
  printf 'variant-b\n' > "$LAB/.variant"
fi
chmod 755 "$LAB/run-beacon.sh"
cp "$LAB/run-beacon.sh" "$LAB/.run-beacon.sh.orig"
rm -f "$LAB/data/beacon.db"
info "fault injected ($V). Reproduce with: bash $LAB/run-beacon.sh"
