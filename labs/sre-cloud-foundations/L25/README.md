# L25 — Rotate an exposed credential, then triage and patch a release scan

Module M13 · ~120 min practical · profile `compose` (Docker engine + Compose v2, `python3`, `openssl`) · **local only: no cloud, no cost**

## Ticket

> **BEACON-SEC-311.** The password of the `beacon_app` database role appeared in a CI job log
> that every engineer can read. Rotate it today: the new credential in use by every consumer of
> the database, the exposed one rejected by the server, and no credential value in the ticket,
> your notes, your evidence, or any container's configuration or logs.
>
> **BEACON-SEC-312.** The release scan of `beacon-report` 0.9.0 is attached. Before Friday:
> triage every finding, patch what needs patching in the pinned lock, rebuild and test the
> image, and attach an SBOM of what you actually shipped.

`work/TICKET.md` has the full text. It says what was reported, not why anything is the way it is.

## Objectives

- `obj-m13-01` rotate a synthetic credential so the new one works, the old one is revoked, and
  no secret appears in evidence or logs
- `obj-m13-02` rebuild a patched pinned artifact and triage findings into fix, not applicable,
  already fixed and unknown, each with a reason

## What runs

Compose project `looped-l25` (`work/compose.yaml`, which you may edit):

| Service | What it is |
|---|---|
| `db` (`looped-l25-db`) | `postgres:16.4` pinned by digest; database `beacon`; port `127.0.0.1:15025` for the validator only |
| `ingest`, `exporter` | two Beacon consumers (`assets/consumer.py`, stdlib + `pgmini`) on `python:3.12.7-slim-bookworm` pinned by digest. Every 2 s each reads its credential, opens a new connection and writes a heartbeat. Each log line shows the result and the credential's **fingerprint** (first 12 hex of SHA-256), never the value |

The `beacon-report` tool (`work/patch/report/`) renders Beacon's status page from a JSON export
with Jinja2 and normalises sensor hostnames with `idna`. Its dependencies are pinned with `==`
and wheel hashes in `requirements.txt`; `assets/build-report.sh <tag>` downloads exactly those
wheels (hash-checked), builds `looped-l25-report:<tag>` and runs the unit tests inside the image
with networking disabled. Setup builds `:baseline`; you ship `:patched`.

Helpers (read them before using them):

- `assets/newsecret.py FILE` — a new synthetic credential (`lab-…-not-a-real-secret`) into a
  0600 file; prints only the fingerprint.
- `assets/scram.py --role ROLE FILE [--create]` — prints an `ALTER ROLE`/`CREATE ROLE` with a
  SCRAM-SHA-256 **verifier**, so the plaintext never reaches the server, its logs or your shell
  history. Pipe it into `docker exec -i looped-l25-db psql -X -q -U postgres -d beacon -v ON_ERROR_STOP=1`.
- `assets/sbom.py LOCK --version V -o FILE` — CycloneDX 1.5 JSON from the lock (stdlib only).
- `work/patch/vuln-report.json` — the scan, shaped like `pip-audit --format json`. It is a
  **fixture**: no scanner runs and nothing needs the network except `pip download` of wheels. The
  CVE ids, packages and fix versions are real public advisories; `LAB-2026-0042` is invented.

## Steps and checkpoints

**Checkpoint c1 — rotation without disclosure (week 38, session 1).**

1. `bash labs/sre-cloud-foundations/L25/setup.sh` (Docker running). Read `work/TICKET.md`.
2. Inventory before changing anything: which services use the credential, *where each one reads
   it from* (`docker compose -p looped-l25 -f work/compose.yaml config`, `docker inspect`), what
   role they log in as. Write the **Rotation plan** in `evidence/L25-notes.md`: the order of
   steps and how you will know each one worked.
3. Rotate. Watch `docker logs -f looped-l25-ingest` and `looped-l25-exporter` while you do it.
   A short blip is acceptable; a consumer left broken, or the old credential left working "for
   compatibility", is not.
4. Prove revocation (the old value is rejected with a specific SQLSTATE), and that both consumers
   write heartbeats with the new fingerprint.

**Checkpoint c2 — triage, patch, SBOM (week 38, session 2).**

5. For each finding in `work/patch/vuln-report.json` decide `fix`, `not-applicable`,
   `already-fixed` or `unknown` in `work/patch/triage.json` (template provided). The reason
   must name the code path, the configuration or the version that decides it. Compare the scan's
   lock with the lock you ship. `unknown` needs an owner and a next step.
6. Patch the lock (pins and hashes), `bash assets/build-report.sh patched`, and generate
   `work/patch/sbom.cdx.json` with `assets/sbom.py`. Check that the SBOM describes the image you
   built, not the lock you meant to build.
7. `python3 labs/sre-cloud-foundations/L25/validate.py --explanation-file labs/sre-cloud-foundations/L25/evidence/L25-notes.md`
   and import `evidence/latest.json`.

## What you should observe

- A rotation is only as complete as the inventory of consumers. Every consumer has to change,
  and where each one reads the credential decides how it changes.
- With a single-file bind mount, how you replace the file matters: some ways of writing it are
  seen by the running container, others are not until the container is recreated. Watch the
  fingerprints, not your intentions.
- A scan run against an older lock reports some things you already fixed and misses nothing you
  added only if you rescan. Applicability is decided by code and configuration, not by the CVSS
  score.

## What the validator checks

Stack up; the exposed credential rejected over TCP; each consumer's current credential logs in
and is not the exposed one; fresh heartbeats with the current fingerprint; no credential value
in container env/cmd/labels/logs, `compose.yaml`, `.env`, the ticket, triage or evidence files;
consumers read credentials from 0600 files under `work/secrets/`; consumer roles have no
elevated attributes and no access to the `records` table; every finding triaged with reason and
evidence, applicable findings fixed and "already fixed" true; the lock pinned with hashes; the
`:patched` image built from the current lock with the fixes installed; tests pass inside it with
no network; the SBOM lists exactly the image's Python packages and the current lock's hash; your
notes (advisory). Restoring the old password, keeping it valid on a second role, or putting a
credential in an environment variable fails specific checks.

## Safety and scope

- Only Compose project `looped-l25`, its volume `looped-l25-pgdata`, network `looped-l25-net`,
  images `looped-l25-report:*` and `work/` are created or removed. Ports bind to 127.0.0.1.
- All credentials are generated at setup, look like `lab-<hex>-not-a-real-secret` and are
  removed with `work/` at teardown. The superuser is used only on the container's local socket.
- `reset.sh` tears down and sets up the same variant with **new** secrets (your triage, lock and
  SBOM are copied to `.work-previous/`). `teardown.sh` removes everything above; `evidence/` stays.

## Pause / resume

Containers restart with the engine (`restart: unless-stopped`). `setup.sh` reuses `work/` and runs
`docker compose up -d`. The heartbeat table is the history: `SELECT consumer, credential_fp,
max(at) FROM heartbeats GROUP BY 1, 2`.

## Troubleshooting

- `pip download failed` in build-report.sh: a pin and its `--hash` disagree, the wheel does not
  exist for CPython 3.12 on your architecture, or there is no network. Behind a TLS-inspecting
  proxy configure pip's CA; do not disable verification.
- `Permission denied` reading `/run/secrets/...` in a consumer: the consumers run as your UID
  (setup writes it into `compose.yaml`); a secret file created by another user is unreadable.

## Lab versus production

- A real secret store (Vault, AWS Secrets Manager, Kubernetes Secrets with an external
  operator) adds versioned secrets, leases, audit logs and push-based reload; the inventory,
  ordering and proof steps are the same.
- Two-role ("A/B") rotation avoids the blip at the cost of a role lifecycle to manage. Some
  managed databases offer it built in.
- A real release gate would rescan the patched image; here the scan is a fixture so the lab
  works offline.

## Limits — what this lab does not prove

It proves an inventory-driven credential rotation on one PostgreSQL server with file-mounted
secrets, verifier-based password setting, revocation by login test, and a hash-pinned rebuild
with a lock-derived SBOM checked against the image. It does not exercise a secret manager,
dynamic credentials, TLS client certificates, audit trails, a real vulnerability scanner or a
full image SBOM (the SBOM covers Python packages only, not Debian packages in the base image).
The triage rules in the validator encode this lab's code and configuration; they do not grade
triage in general.
