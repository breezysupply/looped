# L01 worked solution

Read this after your own attempt. Opening it before importing evidence makes that attempt
"assisted".

## Variant A — relative path from the wrong directory

Observation: `FATAL config: open config/beacon.yaml: no such file or directory`.

Hypotheses: H1 the file is missing; H2 the process starts somewhere else so the relative path
resolves elsewhere; H3 a `BEACON_CONFIG` variable points at a wrong location.

Discriminating check: `ls -l /opt/beacon-l01/config/beacon.yaml` (exists → not H1) and
`sed -n 1,6p /opt/beacon-l01/run-beacon.sh` shows `cd /` before `exec` → H2. `grep BEACON_CONFIG`
finds nothing → not H3.

Smallest fix: change `cd /` to `cd /opt/beacon-l01` (or pass `--config /opt/beacon-l01/config/beacon.yaml`).

Verify: `bash /opt/beacon-l01/run-beacon.sh` prints `beacon-api 1.4.0 listening on 0.0.0.0:8080`;
`curl -s http://127.0.0.1:8080/healthz` → `ok`.

## Variant B — a required setting never reaches the process

Observation: `FATAL config: store.url is required when store.kind is postgres (BEACON_STORE_URL)`.

Hypotheses: H1 the config is wrong (should not be postgres); H2 the URL is meant to arrive via
environment and does not; H3 the env file has a typo.

Discriminating check: `cat /opt/beacon-l01/env` shows `BEACON_STORE_URL=…` spelled correctly
(→ not H3); `grep -n env /opt/beacon-l01/run-beacon.sh` shows only a comment — the file is never
sourced (→ H2). Whether H1 is also true is a product question: the lab's intent was the env
file, so the launcher is the fix.

Smallest fix: add `set -a; . /opt/beacon-l01/env; set +a` before `exec`.

Note that the API will still refuse to start if PostgreSQL is not actually listening on
127.0.0.1:5432 — in this VM it is not. The honest resolution is: the launcher bug is fixed
**and** the lab config is switched back to `store.kind: sqlite` with a path, because no database
exists here yet; say so in the Result section. (Both edits are expected; the validator checks
that Beacon starts and `/healthz` answers.)

## Why the broad fixes fail validation

Copying the config to `/config/beacon.yaml` makes variant A start but moves the file layout
(`minimal-fix` warns) and leaves the launcher wrong for the next deploy. `chmod -R 777` fails
`no-unsafe` and does not address either cause.
