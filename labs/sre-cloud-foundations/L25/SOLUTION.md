# L25 worked solution (instructor copy — open only after an honest attempt)

Run from `labs/sre-cloud-foundations/L25`. `P` below is the superuser psql on the local socket:

```sh
P="docker exec -i looped-l25-db psql -X -q -U postgres -d beacon -v ON_ERROR_STOP=1"
```

## Diagnosis (both variants)

`docker compose -p looped-l25 -f work/compose.yaml config` shows that `ingest` reads
`/run/secrets/db` (from `work/secrets/db.txt`), but `exporter` does not:

- **variant-a:** `exporter` mounts its own secret `exporter_db` from `work/secrets/exporter-db.txt`,
  a copy of the credential made when the service was added. Rotate only `db.txt` and the exporter
  fails with `28P01` while still presenting the old fingerprint.
- **variant-b:** `exporter` gets the password from `BEACON_DB_PASSWORD`, interpolated from
  `work/.env`. The value is visible in `docker inspect`, in `.env`, and will be in any `compose
  config` paste — and rotating the file does nothing for it.

A second trap catches nearly everyone once: `mv new.txt db.txt` replaces the file's inode, and a
single-file bind mount keeps showing the **old** inode to the running container (Linux engines).
Both consumers then fail after the ALTER although the file on disk is new. Write in place
(`cat new > db.txt`) or recreate the containers.

## Fix A — single role, short blip (what most people do)

```sh
# 1. one source of truth: exporter reads the shared secret (edit work/compose.yaml)
#    variant-a: BEACON_DB_PASSWORD_FILE: /run/secrets/db, secrets: [db], drop exporter_db
#    variant-b: replace BEACON_DB_PASSWORD with BEACON_DB_PASSWORD_FILE: /run/secrets/db, add secrets: [db]
docker compose -p looped-l25 -f work/compose.yaml up -d --remove-orphans
rm -f work/secrets/exporter-db.txt work/.env           # the stale copies hold the exposed value
# 2. rotate: new value, written in place, then the server
python3 assets/newsecret.py work/secrets/db-next.txt
cat work/secrets/db-next.txt > work/secrets/db.txt && rm work/secrets/db-next.txt
python3 assets/scram.py --role beacon_app work/secrets/db.txt | $P
docker logs --tail 2 looped-l25-exporter                # result ok, new fingerprint
```

## Fix B — two roles, no blip

```sh
python3 assets/newsecret.py work/secrets/db-v2.txt
python3 assets/scram.py --create --role beacon_app_v2 work/secrets/db-v2.txt | $P
echo "GRANT beacon_app TO beacon_app_v2;" | $P          # inherits exactly the app's grants
# compose: both consumers BEACON_DB_USER: beacon_app_v2; secret db -> file ./secrets/db-v2.txt
docker compose -p looped-l25 -f work/compose.yaml up -d
echo "ALTER ROLE beacon_app NOLOGIN;" | $P              # revoke: 28000 for the old credential
```

Proof of revocation: `validate.py` logs in over TCP with the exposed value and expects `28P01`
(password changed) or `28000` (role cannot log in). Never "prove" it by printing the password.

## Triage, patch, SBOM

| Finding | variant-a | variant-b |
|---|---|---|
| CVE-2024-3651 (idna, fix 3.7) | **fix**: `normalize_host()` calls `idna.encode()` on the sensor-reported endpoint — untrusted input | **already-fixed**: the scan saw 3.6; the lock pins 3.7 |
| CVE-2024-34064 (jinja2 xmlattr, fix 3.1.4) | **already-fixed**: scan saw 3.1.3; lock pins 3.1.4 | not reported |
| CVE-2024-56201 / -56326 / CVE-2025-27516 (jinja2, fix 3.1.5/3.1.6) | **not-applicable** while `custom_templates` is false (only the image's own template is rendered; no sandbox in use) — `fix` is also accepted | **fix**: `custom_templates: true` renders operator templates in `SandboxedEnvironment`; operators control content and filenames |
| LAB-2026-0042 (first-party) | **unknown**, owner + next step (a traversal test for page names) | same; more plausible here because page names come from operator filenames |

Patch (variant-a: idna; variant-b: jinja2). Hashes come from the wheels themselves:

```sh
python3 -m pip download --no-deps --only-binary=:all: --python-version 3.12 --platform manylinux2014_x86_64 -d /tmp/w idna==3.10
sha256sum /tmp/w/idna-3.10-py3-none-any.whl      # 946d195a0d259cbba61165e88e65941f16e9b36ea6ddb97f00452bae8b1287d3
# jinja2==3.1.6 -> 85ece4451f492d0c13c5dd7c13a64681a86afae63a5f347908daf103ce6d2f67
bash assets/build-report.sh patched
python3 assets/sbom.py work/patch/report/requirements.txt --version 0.9.1 -o work/patch/sbom.cdx.json
```

Verify the SBOM against the image, not the lock: `docker run --rm --entrypoint python3
looped-l25-report:patched -c 'import importlib.metadata as m; print(sorted((d.metadata["Name"],
d.version) for d in m.distributions()))'` and the `looped.lab/requirements-sha256` label.

## Unsafe shortcuts (each fails a named check)

- Setting the old password back, or leaving `beacon_app` able to log in with it "until the
  exporter is fixed" → `old-revoked`.
- Copying the new value into `.env`/an environment variable → `no-credential-exposure`, `secret-files`.
- Giving a consumer the superuser to "make it work" → `least-privilege`.
- Generating the SBOM before rebuilding, or rebuilding without editing the lock → `sbom-matches-image`/`patched-image`.
- Marking an applicable finding `not-applicable` to avoid the patch → `triage-correct`.
