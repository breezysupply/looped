#!/usr/bin/env bash
# L26 setup: two "environments" on one engine.
#   sender   (connected build side)  work/sender/: inventory, deploy files, the
#            release signing key (RSA-3072, generated here, 0600), the Beacon
#            image looped-l26/beacon-api:1.4.0 built from assets/app/
#   receiver (disconnected side)     work/receiver/: a trust store holding the
#            release PUBLIC key (bootstrapped once, out of band), an internal
#            registry looped-l26-registry on 127.0.0.1:15026, and an INTERNAL
#            Docker network looped-l26-recv with no route out
# Then inject.sh produces the variant's bundle and "transfers" it to work/inbox/.
# Touches only work/, evidence/ and the L26 objects listed in assets/common.sh.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L26_PROJECT"
l26_guard

if [ -d "$WORK" ]; then
  info "work/ exists; reusing it (reset.sh starts over, teardown.sh removes everything)"
  docker start looped-l26-registry >/dev/null 2>&1 || true
  exit 0
fi
left="$(l26_list container; l26_list network)"
[ -z "$left" ] || die "L26 objects exist without a workspace (an old attempt?): $(echo "$left" | tr '\n' ' '); run teardown.sh first"
for img in "$L26_REGISTRY_IMAGE" "postgres:16.4@sha256:e62fbf9d3e2b49816a32c400ed2dba83e3b361e6833e624024309c35d334b412" \
           "python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d"; do
  docker image inspect "$img" >/dev/null 2>&1 || { info "pulling $img (sender side is connected)"; docker pull -q "$img" >/dev/null; }
done

info "sender: workspace, release key, Beacon image"
mkdir -p "$WORK/sender/keys" "$WORK/outbox" "$WORK/inbox" "$WORK/receiver/trusted-keys"
cp -R "$HERE/starter/sender/." "$WORK/sender/"
chmod 700 "$WORK/sender/keys"
l26_genkey "$WORK/sender/keys/release.key"
openssl pkey -in "$WORK/sender/keys/release.key" -pubout -out "$WORK/sender/keys/release.pub.pem" 2>/dev/null
fp="$(l26_bundle fingerprint "$WORK/sender/keys/release.pub.pem")"
printf 'beacon release signing key, SHA-256 of the DER public key:\n%s\n' "$fp" > "$WORK/sender/FINGERPRINT.txt"
docker build -q --label looped.lab/id=L26 -t looped-l26/beacon-api:1.4.0 "$HERE/assets/app" >/dev/null

info "receiver: trust store, internal registry, internal network"
# trust bootstrap: done ONCE, out of band, before any bundle arrives (document how in TRUST-BOOTSTRAP.md)
cp "$WORK/sender/keys/release.pub.pem" "$WORK/receiver/trusted-keys/beacon-release.pub.pem"
cp "$HERE/assets/trust-bootstrap-template.md" "$WORK/receiver/TRUST-BOOTSTRAP.md"
docker network create --label looped.lab/id=L26 looped-l26-ingest >/dev/null
docker network create --internal --label looped.lab/id=L26 looped-l26-recv >/dev/null
docker run -d --name looped-l26-registry --label looped.lab/id=L26 --network looped-l26-ingest \
  -p "$L26_REGISTRY:5000" --restart unless-stopped "$L26_REGISTRY_IMAGE" >/dev/null

EV="$(evidence_dir "$HERE")"
{
  echo "# L26 tool inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "openssl: $(openssl version 2>/dev/null)"
} > "$EV/L26-tools.txt"

LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L26 ready. Read work/TICKET.md. The bundle waiting at the receiver: work/inbox/$L26_BUNDLE"
