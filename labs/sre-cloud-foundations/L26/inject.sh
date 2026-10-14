#!/usr/bin/env bash
# L26 variant: produce the sender's bundle the way it happened this time and
# carry it to the receiver (work/inbox/). Writes work/TICKET.md.
#   variant-a  something happened on the way
#   variant-b  something was left behind
#   variant-c  someone else signed it
# Running it again resets the sender inventory and the inbox for that variant.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L26_PROJECT"
l26_guard
[ -f "$WORK/sender/keys/release.key" ] || die "no sender workspace; run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac

cp "$HERE/starter/sender/inventory.json" "$WORK/sender/inventory.json"
python3 - "$WORK/sender/inventory.json" "$V" <<'PY'
import json, sys
path, v = sys.argv[1:3]
inv = json.load(open(path))
if v == "variant-b":
    inv["images"] = [i for i in inv["images"] if i["name"] != "postgres"]
if v == "variant-c":
    inv["signing_key"] = "keys/build-laptop.key"
    inv["include_public_key"] = True
json.dump(inv, open(path, "w"), indent=2)
PY
if [ "$V" = variant-c ] && [ ! -f "$WORK/sender/keys/build-laptop.key" ]; then
  l26_genkey "$WORK/sender/keys/build-laptop.key"
fi
info "sender: exporting the bundle"
l26_bundle export --sender "$WORK/sender" --out "$WORK/outbox"
bash "$HERE/assets/transfer.sh" >/dev/null
if [ "$V" = variant-a ]; then
  # a change made on the transfer media after signing
  printf 'DB_HOST=db\nDB_PASSWORD=lab-l26-db-not-a-real-secret\nBEACON_UPSTREAM=http://collector.example.invalid:8080\n' > "$WORK/inbox/$L26_BUNDLE/config/api.env"
fi
printf '%s\n' "$V" > "$WORK/.variant"
cat > "$WORK/TICKET.md" <<'T'
# BEACON-DEL-0419 — deliver Beacon 1.4.0 to the disconnected site

The release bundle for Beacon 1.4.0 has arrived at the receiving site (work/inbox/beacon-1.4.0,
carried over on transfer media). The site has no route to any outside registry: everything the
deployment runs must come from the bundle, through the site's internal registry
(127.0.0.1:15026), referenced by digest.

Verify the bundle against the site's trust store before anything is loaded, deploy it as the
Compose project looped-l26-recv on the internal network, and prove the service works. If
verification fails, find out why and get a bundle that verifies; do not weaken the receiver.
Write down how the site came to trust the release key, how that trust is renewed or revoked,
and what risks remain (work/receiver/TRUST-BOOTSTRAP.md).
T
info "variant $V: bundle exported, transferred to work/inbox/$L26_BUNDLE"
