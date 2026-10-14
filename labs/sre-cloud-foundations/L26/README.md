# L26 — Signed bundle delivery into a site with no way out

Module M13 · ~150 min practical · profile `compose` (Docker engine + Compose v2, `python3`, `openssl`) · **local only: two "environments" on one engine, no cloud**

## Ticket

> **BEACON-DEL-0419.** The release bundle for Beacon 1.4.0 has arrived at the receiving site
> (`work/inbox/beacon-1.4.0`, carried over on transfer media). The site has no route to any
> outside registry: everything the deployment runs must come from the bundle, through the
> site's internal registry (`127.0.0.1:15026`), referenced by digest. Verify the bundle against
> the site's trust store before anything is loaded, deploy it as Compose project
> `looped-l26-recv` on the internal network, and prove the service works. If verification
> fails, find out why and get a bundle that verifies; do not weaken the receiver. Write down how
> the site came to trust the release key, how that trust is renewed or revoked, and what risks remain.

## Objectives

- `obj-m13-04` generate an inventory with checksums and a signature, and reject tampered or
  untrusted inputs during verification
- `obj-m13-05` load a complete bundle into a second environment with external retrieval blocked,
  and document trusted-key bootstrap and fallback

## The two environments

| | Sender (connected build side) | Receiver (disconnected site) |
|---|---|---|
| Where | `work/sender/`, `work/outbox/` | `work/inbox/`, `work/receiver/` |
| Holds | `inventory.json` (what to ship), `deploy/compose.yaml`, `config/api.env`, the release signing key `keys/release.key` (RSA-3072, generated at setup, 0600), the Beacon image `looped-l26/beacon-api:1.4.0` | the trust store `trusted-keys/` (the release **public** key, bootstrapped once, out of band), the internal registry `looped-l26-registry` (`registry:2.8.3` pinned by digest, `127.0.0.1:15026`), the network `looped-l26-recv` created with `--internal` |

`assets/bundle.py` (stdlib + `docker` + `openssl`, read it):

- `export --sender work/sender --out work/outbox` — `docker save` each inventory image, copy the
  files, write `manifest.json` (size, sha256, layer digests per image) and `SHA256SUMS`, sign
  the manifest with `openssl dgst -sha256 -sign`.
- `verify --bundle work/inbox/beacon-1.4.0 --trust work/receiver/trusted-keys` — the signature
  must verify with a key **in the trust store**; every file must match the signed manifest, none
  may be extra; every image the deployment references (`${IMG_<NAME>}` in `deploy/compose.yaml`)
  must be in the bundle. Every result goes to `work/receiver/verify-log.jsonl`.
- `load … --registry 127.0.0.1:15026 --env-out work/receiver/deployed-refs.env` — verifies again,
  `docker load`s, pushes to the internal registry and writes digest-pinned `IMG_*` references.
- `fingerprint <public-key.pem>` — SHA-256 over the DER public key.
- `assets/transfer.sh` — "carry" the outbox bundle to the inbox (a fresh copy).

The manual equivalents are worth running once: `sha256sum -c SHA256SUMS` inside the bundle and
`openssl dgst -sha256 -verify work/receiver/trusted-keys/beacon-release.pub.pem -signature
manifest.json.sig manifest.json`.

## Steps and checkpoints

**Checkpoint c1 — inventory and provenance (week 39, session 1).**

1. `bash labs/sre-cloud-foundations/L26/setup.sh` (about a minute; pulls pinned images only if
   missing). Read `work/TICKET.md`, `work/sender/inventory.json` and `work/sender/FINGERPRINT.txt`.
2. Inspect the bundle in the inbox without trusting it: `manifest.json`, `SHA256SUMS`, the
   deployment's image references. Then run `bundle.py verify`. Read every REJECT line.
3. Decide where the problem was introduced (sender, media, or signer) and fix it **there**.
   Never edit the receiver's trust store to make a bundle pass, and never edit checksums.

**Checkpoint c2 — isolated delivery (week 39, session 2).**

4. With a bundle that verifies: `bundle.py load …`, then
   `docker compose -p looped-l26-recv -f work/inbox/beacon-1.4.0/deploy/compose.yaml --env-file work/receiver/deployed-refs.env up -d`.
5. Prove it works and that nothing came from outside: running image references, `docker exec
   looped-l26-recv-api cat /proc/net/route`, `/ready` from inside the api container.
6. Write `work/receiver/TRUST-BOOTSTRAP.md` (template provided): the fingerprint, the second
   channel it came over, rotation and fallback, residual risks.
7. `python3 labs/sre-cloud-foundations/L26/validate.py` and import `evidence/latest.json`.

## What you should observe

- A signature covers the manifest; the manifest covers every file. Change one byte anywhere and
  verification names the file.
- A bundle can verify perfectly against a key it carries itself. That proves only that it agrees
  with itself.
- "It deployed" on this engine is weak evidence: the engine may already have an image cached from
  the sender side. What counts is which reference each container runs and where that came from.

## What the validator checks

The trust store holds exactly the bootstrapped release key; the verify log shows the delivered
fault rejected for the right reason; it re-verifies the inbox bundle itself; it attacks scratch
copies (altered file, missing image archive, signature by a new key) and expects three
rejections; the internal registry serves every bundle image; every receiver container runs a
`127.0.0.1:15026/…@sha256:…` reference whose layers equal the signed manifest's; the receiver
network is internal and containers have no default route; `/ready` and a write work; the trust
document states the fingerprint and has substance; no private key in outbox, inbox or evidence.

## Safety and scope

Only the objects named `looped-l26-*` (registry container, networks, Compose project
`looped-l26-recv`), image tags `looped-l26/*`, `registry.lab/looped-l26/*` and
`127.0.0.1:15026/looped-l26/*`, and `work/` are created or removed. Pinned base images stay.
Keys are lab keys, generated at setup, removed with `work/`; never use them for anything else.
About 400 MB of disk while the lab runs (two copies of the bundle).

## Pause / resume

The registry restarts with the engine; `setup.sh` reuses `work/`. `reset.sh` rebuilds both sides
with a **new** release key (the trust bootstrap starts over) and keeps your previous trust
document and verify log in `.work-previous/`.

## Lab versus production

- Production pipelines sign images and attestations with Sigstore cosign (keyless or KMS keys) and
  enforce signatures at admission; here `openssl` signs one manifest so every step is visible.
  The trust questions (which keys, bootstrapped how, rotated how) are identical.
- A real enclave has separate hardware, a reviewed media transfer and a registry with its own
  access control; here both sides share one Docker engine.

## Limits — what this lab does not prove

It proves manifest-based integrity, signature verification against a pinned trust store,
completeness against the deployment, loading through an internal registry by digest, and
containers with no route out. It does not prove that the engine itself cannot reach the internet
(the daemon is shared with the sender side and blocking it would mean changing host firewall
rules, which labs never do), it does not sign individual images or attestations, it has no key
expiry, revocation list or replay protection, and an RSA key on disk is not an HSM.
