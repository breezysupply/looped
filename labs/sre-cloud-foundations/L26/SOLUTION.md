# L26 worked solution (instructor copy — open only after an honest attempt)

```sh
cd labs/sre-cloud-foundations/L26
B="python3 assets/bundle.py"
$B verify --bundle work/inbox/beacon-1.4.0 --trust work/receiver/trusted-keys
```

## What the rejection means, per variant

- **variant-a — `checksum-mismatch: config/api.env`.** The file on the media differs from what was
  signed (someone added `BEACON_UPSTREAM=http://collector.example.invalid:8080`). The outbox copy
  still verifies, so the change happened in transit. Report it, discard the inbox copy and carry a
  fresh one: `bash assets/transfer.sh`. If the change were wanted, it would go into
  `work/sender/config/api.env` and a new signed export — never into `SHA256SUMS` or the manifest.
- **variant-b — `incomplete: … needs image 'postgres'`.** The sender inventory left out the database
  image the deployment needs. On a connected site the engine would have pulled it silently; here
  the install would stop halfway. Add the pinned postgres entry back to `work/sender/inventory.json`
  (see `starter/sender/inventory.json`), export, transfer.
- **variant-c — `untrusted-signer`.** The bundle was signed with `keys/build-laptop.key` and carries
  that key's public half (`signer.pub.pem`). It verifies only against itself. Do **not** copy
  `signer.pub.pem` into the trust store. Re-sign at the sender with the release key and drop the
  bundled key: in the inventory set `"signing_key": "keys/release.key"` and
  `"include_public_key": false`, export, transfer.

```sh
$B export --sender work/sender --out work/outbox
bash assets/transfer.sh
$B verify --bundle work/inbox/beacon-1.4.0 --trust work/receiver/trusted-keys      # ACCEPT
$B load --bundle work/inbox/beacon-1.4.0 --trust work/receiver/trusted-keys \
  --registry 127.0.0.1:15026 --env-out work/receiver/deployed-refs.env
docker compose -p looped-l26-recv -f work/inbox/beacon-1.4.0/deploy/compose.yaml \
  --env-file work/receiver/deployed-refs.env up -d
docker exec looped-l26-recv-api python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/ready').read())"
docker exec looped-l26-recv-api cat /proc/net/route      # no 00000000 destination: no default route
```

## Trust bootstrap (the document)

- **Fingerprint:** `python3 assets/bundle.py fingerprint work/receiver/trusted-keys/beacon-release.pub.pem`
  equals `work/sender/FINGERPRINT.txt`.
- **Second channel:** the fingerprint is read over a separate, authenticated channel (a call
  between named people, a signed letter), recorded by both sides; the key never arrives with a bundle.
- **Rotation and fallback:** a new key arrives in a bundle signed by the current key and is
  confirmed by the same second channel; the old key is removed after the first new-key bundle
  verifies. On compromise: stop accepting bundles, re-bootstrap in person. Without a verifiable
  bundle, keep running the last verified release — never disable verification.
- **Residual risks:** a compromised build host signs bad content with the real key; base images are
  trusted by upstream digest only; anyone who can write the trust store can add a key; replay of an
  older signed bundle (no expiry or version floor); no per-image signatures or SBOM attestation.

## Unsafe shortcuts (each fails a named check)

- Adding the bundle's own key (or any extra key) to the trust store → `trust-store`, `bundle-verifies`.
- Editing `SHA256SUMS`/`manifest.json` to match the altered file → signature fails → `bundle-verifies`.
- Deploying `postgres:16.4@sha256:…` straight from the engine cache instead of the internal
  registry → `deployed-from-internal`.
- Attaching a receiver container to a normal bridge network "to make it work" → `egress-blocked`.
