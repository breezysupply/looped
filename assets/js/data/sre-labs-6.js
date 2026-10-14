/* SRE & Cloud Deployment Foundations — local lab specifications L25–L28.
   Same record shape as sre-labs.js (see L01/L03 there). M13: credential
   rotation and a release-scan triage/patch with an SBOM (L25); a signed,
   checksummed artifact bundle delivered into a receiver with no external
   pulls (L26). M14: bounded load, saturation and overload limits (L27); an
   incident rehearsal with a backup-based recovery (L28). */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreLabs = LX.sreLabs || [];

(function () {
  var DIR = 'labs/sre-cloud-foundations/';
  function lab(x) { x.version = x.version || '1.0'; LX.sreLabs.push(x); }

  lab({
    id: 'L25', moduleId: 'M13', title: 'Rotate an exposed database credential, then triage and patch a release scan',
    objectiveIds: ['obj-m13-01', 'obj-m13-02'], executionMode: 'local', estimatedMinutes: 120, environmentProfile: 'compose', prerequisites: ['L14'],
    learnerBrief: 'The password of Beacon\'s `beacon_app` database role showed up in a CI log everyone can read. Rotate it so every consumer of the database uses a new credential, the exposed one is rejected by the server, and no credential value lands in your notes, your evidence or any container\'s configuration or logs. Then work the release scan for the beacon-report tool: triage every finding with a reason you can defend, patch the hash-pinned lock, rebuild and test the image, and attach an SBOM of what you actually shipped.\n\nLocal only: PostgreSQL 16 and two small consumers in Compose project looped-l25, synthetic `lab-…-not-a-real-secret` credentials generated at setup, and a scan report supplied as a fixture (no scanner, no network beyond downloading pinned wheels).',
    checkpoints: [
      { id: 'c1', title: 'Rotation without disclosure', resumeInstructions: '`bash ' + DIR + 'L25/setup.sh` reuses work/ and starts the project again. `docker logs --tail 3 looped-l25-exporter` shows which credential fingerprint each consumer presents; your plan is in evidence/L25-notes.md.' },
      { id: 'c2', title: 'Triage, patch and SBOM', resumeInstructions: 'Triage lives in work/patch/triage.json and the lock in work/patch/report/requirements.txt. `bash ' + DIR + 'L25/assets/build-report.sh patched` rebuilds and tests at any time; regenerate the SBOM after every rebuild.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'starter/compose.yaml', 'starter/report/', 'assets/common.sh', 'assets/consumer.py', 'assets/pgmini.py', 'assets/newsecret.py', 'assets/scram.py', 'assets/sbom.py', 'assets/build-report.sh', 'assets/init/01-schema.sql', 'assets/variants/', 'assets/triage-template.json', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# Docker with Compose v2, python3 with pip, openssl', 'bash ' + DIR + 'L25/setup.sh', 'cat ' + DIR + 'L25/work/TICKET.md'],
    faultInjection: ['# setup.sh configured variant-a; to start over with the other variant (new secrets):', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L25/reset.sh'],
    tasks: ['Inventory every consumer of the credential and where each reads it from (`docker compose ... config`, `docker inspect`); write the Rotation plan before changing anything.', 'Rotate with `assets/newsecret.py` and `assets/scram.py` (a SCRAM verifier, never the plaintext, goes to the server); keep both consumers writing heartbeats and watch the fingerprints they log.', 'Prove the exposed credential is rejected (SQLSTATE) and that no value appears in env, compose files, logs or evidence.', 'Triage every finding in work/patch/vuln-report.json as fix, not-applicable, already-fixed or unknown, citing the code path, configuration or version that decides it.', 'Patch the lock (pins and wheel hashes), build `looped-l25-report:patched`, run the tests inside it, and generate a CycloneDX SBOM from the same lock; confirm it matches the image.', 'Run validate.py and import the evidence.'],
    validation: [
      { id: 'stack-up', description: 'database ready and every consumer service running', critical: true },
      { id: 'old-revoked', description: 'the exposed credential is rejected by the server over TCP (28P01 or 28000)', critical: true },
      { id: 'new-credential-works', description: 'each consumer\'s current credential logs in and differs from the exposed one', critical: true },
      { id: 'consumers-writing', description: 'each consumer wrote a heartbeat in the last 15 s with its current credential fingerprint', critical: true },
      { id: 'no-credential-exposure', description: 'no credential value in container env/cmd/labels/logs, compose/.env, ticket, triage or evidence files', critical: true },
      { id: 'secret-files', description: 'consumers read credentials from 0600/0400 files under work/secrets/', critical: true },
      { id: 'least-privilege', description: 'consumer roles have no superuser/createrole/createdb/bypassrls and no access to records', critical: true },
      { id: 'triage-complete', description: 'every finding triaged with a valid decision, a reason and evidence; unknown has owner and next step', critical: true },
      { id: 'triage-correct', description: 'reachable findings are fixed; already-fixed is true for the shipped versions', critical: true },
      { id: 'lock-pinned', description: 'every dependency pinned with == and at least one sha256 hash', critical: true },
      { id: 'patched-image', description: 'looped-l25-report:patched built from the current lock with the fixed versions installed', critical: true },
      { id: 'image-tests', description: 'unit tests pass inside the patched image with networking disabled', critical: true },
      { id: 'sbom-matches-image', description: 'CycloneDX 1.5 SBOM lists exactly the image\'s Python packages and the current lock hash', critical: true },
      { id: 'notes', description: 'evidence/L25-notes.md has the five sections with substance (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L25/reset.sh   # same variant, NEW secrets; your triage, lock and SBOM saved in .work-previous/'],
    teardown: ['bash ' + DIR + 'L25/teardown.sh   # project looped-l25 (with its synthetic data volume), looped-l25-report:* images and work/; evidence/ kept'],
    evidenceInstructions: ['`python3 ' + DIR + 'L25/validate.py --explanation-file ' + DIR + 'L25/evidence/L25-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Never paste a credential value anywhere; the report contains fingerprints only, and the validator fails if a value appears in your notes or evidence.'],
    hints: [
      { level: 1, text: 'A rotation has three parts: every consumer gets the new credential, the server stops accepting the old one, and nothing records either value. The first part depends on an inventory you have not made yet. For the scan, applicability belongs to this code and configuration, not to the CVE.' },
      { level: 2, text: '`docker compose -p looped-l25 -f work/compose.yaml config` shows how each service gets its credential; `docker logs` shows the fingerprint each consumer presents and the SQLSTATE on failure. For the scan, compare the versions in vuln-report.json with requirements.txt, then read app/report.py and report.json.' },
      { level: 3, text: 'Do both consumers read the credential from the same file? After you change it, does the fingerprint change without a restart? If not, check how you wrote the file (`ls -i` before and after). For each finding: is the vulnerable function called with input someone outside the team controls?' },
      { level: 4, text: 'The exporter does not use the shared secret (variant-a: a stale copy; variant-b: an env var from .env). Point it at the shared file, delete the copy, write the new value in place, ALTER ROLE with scram.py (or add beacon_app_v2 and set the old role NOLOGIN). Variant-a patches idna; variant-b patches jinja2 to 3.1.6. Rebuild :patched, then generate the SBOM from the same lock.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T16', 'T10'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L25/reset.sh` (or variant-a): the second consumer gets its credential differently and the report tool\'s configuration changes which findings are reachable. Rotate and triage again without hints and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L25/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L25/reset.sh' },
    limits: ['One PostgreSQL server with file-mounted secrets: proves an inventory-driven rotation, verifier-based password setting, revocation by login test and a hash-pinned rebuild whose lock-derived SBOM is checked against the image. No secret manager, dynamic credentials, audit trail, real scanner or full image SBOM (Python packages only, not the base image\'s Debian packages).', 'Executed during development on Linux amd64 (Docker Engine 29.8, Compose v5, postgres:16.4, python:3.12.7-slim-bookworm): both variants ran setup → validate FAIL → rotation + triage + patch → validate PASS (14/14), with reset and teardown; restoring the exposed password failed old-revoked/new-credential-works/consumers-writing. Not run on macOS or Docker Desktop, where single-file bind mounts may pick up a replaced file differently.']
  });
  lab({
    id: 'L26', moduleId: 'M13', title: 'Deliver a signed, checksummed bundle into a site with no way out',
    objectiveIds: ['obj-m13-04', 'obj-m13-05'], executionMode: 'local', estimatedMinutes: 150, environmentProfile: 'compose', prerequisites: ['L25'],
    learnerBrief: 'Beacon 1.4.0 has to reach a site that cannot pull anything from outside. A connected sender side exports the images (`docker save`), deployment files and configuration with a manifest of sha256 checksums and an openssl signature; the receiving site verifies the bundle against its own trust store, loads the images into an internal registry, and deploys by digest on a network with no route out. The bundle that just arrived does not verify. Find out why, fix it where the problem was introduced without weakening the receiver, deploy, prove nothing came from outside, and write down how the site came to trust the release key.\n\nTwo "environments" on one local Docker engine; lab keys generated at setup; no cloud and no external registry at the receiver.',
    checkpoints: [
      { id: 'c1', title: 'Inventory, checksums and signature', resumeInstructions: '`bash ' + DIR + 'L26/setup.sh` reuses work/ and restarts the registry. `python3 ' + DIR + 'L26/assets/bundle.py verify --bundle ' + DIR + 'L26/work/inbox/beacon-1.4.0 --trust ' + DIR + 'L26/work/receiver/trusted-keys` shows where you are; every result is in work/receiver/verify-log.jsonl.' },
      { id: 'c2', title: 'Isolated delivery and trust bootstrap', resumeInstructions: 'The receiver deployment is Compose project looped-l26-recv (env file work/receiver/deployed-refs.env); your trust document is work/receiver/TRUST-BOOTSTRAP.md. `bundle.py load` and `docker compose ... up -d` are safe to repeat.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/bundle.py', 'assets/transfer.sh', 'assets/common.sh', 'assets/app/Dockerfile', 'assets/app/statusapi.py', 'assets/app/pgmini.py', 'assets/trust-bootstrap-template.md', 'starter/sender/inventory.json', 'starter/sender/deploy/compose.yaml', 'starter/sender/config/api.env', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# Docker with Compose v2, python3, openssl', 'bash ' + DIR + 'L26/setup.sh', 'cat ' + DIR + 'L26/work/TICKET.md'],
    faultInjection: ['# setup.sh delivered variant-a; to start over with another variant (new release key):', 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L26/reset.sh'],
    tasks: ['Inspect the inbox bundle without trusting it (manifest.json, SHA256SUMS, the deployment\'s image references), then run `bundle.py verify` against the receiver trust store and read every rejection.', 'Decide whether the problem came from the sender inventory, the transfer media or the signer, and fix it there; never edit the trust store or the checksums to make it pass.', 'Export, transfer and verify again; check by hand once with `sha256sum -c SHA256SUMS` and `openssl dgst -sha256 -verify`.', 'Load into the internal registry with `bundle.py load` and deploy `looped-l26-recv` with the digest-pinned IMG_* references; prove /ready, the image references and the absence of a default route.', 'Write TRUST-BOOTSTRAP.md: fingerprint, second channel, rotation and fallback, residual risks.', 'Run validate.py and import the evidence.'],
    validation: [
      { id: 'trust-store', description: 'the receiver trusts exactly one key: the release key bootstrapped at setup', critical: true },
      { id: 'fault-rejected', description: 'the verify log shows the delivered fault rejected for the right reason', critical: true },
      { id: 'bundle-verifies', description: 'the inbox bundle verifies independently: trusted signature, checksums, no extra files, complete', critical: true },
      { id: 'negative-tests', description: 'copies with an altered file, a missing image or an unknown signer are each rejected', critical: true },
      { id: 'registry-has-artifacts', description: 'the internal registry serves every image in the bundle', critical: true },
      { id: 'deployed-from-internal', description: 'every receiver container runs a 127.0.0.1:15026/...@sha256 reference', critical: true },
      { id: 'deployed-matches-bundle', description: 'each running image has the layer digests recorded in the signed manifest', critical: true },
      { id: 'egress-blocked', description: 'receiver network internal; containers only on internal networks; no default route', critical: true },
      { id: 'user-path', description: '/ready and a test write succeed inside the receiver api container', critical: true },
      { id: 'trust-bootstrap-doc', description: 'trust document states the release fingerprint, second channel, rotation/fallback and residual risks', critical: true },
      { id: 'no-private-key-shipped', description: 'no private key in the outbox, the inbox or evidence', critical: true }
    ],
    reset: ['bash ' + DIR + 'L26/reset.sh   # both environments rebuilt with a NEW release key; previous trust document and verify log in .work-previous/'],
    teardown: ['bash ' + DIR + 'L26/teardown.sh   # receiver project, registry, networks, looped-l26 image tags and work/ (keys included); base images stay'],
    evidenceInstructions: ['`python3 ' + DIR + 'L26/validate.py`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'The report contains key fingerprints, never key material; the private keys stay in work/sender/keys and are deleted at teardown.'],
    hints: [
      { level: 1, text: 'Three things can be wrong with a delivery: what was put in it, what happened to it on the way, and who vouches for it. The receiver\'s job is to refuse; the fix belongs wherever the problem was introduced, never in the receiver\'s trust.' },
      { level: 2, text: '`bundle.py verify` names the reason (checksum-mismatch, missing-file, incomplete, untrusted-signer). Compare the inbox with the outbox, the inventory with the deployment\'s ${IMG_*} references, and the signer fingerprint with work/sender/FINGERPRINT.txt.' },
      { level: 3, text: 'Does the OUTBOX copy verify? Yes: the media changed it. No, with incomplete: the inventory is short. No, with untrusted-signer: does any key in the trust store verify the signature, or only the key inside the bundle?' },
      { level: 4, text: 'variant-a: config/api.env was altered in transit, re-transfer. variant-b: postgres is missing from the sender inventory, add it, export, transfer. variant-c: signed with the build-laptop key, set signing_key to keys/release.key and include_public_key false, export, transfer. Then load, deploy with the IMG_* env file, and write the trust document.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T21', 'T16', 'T10'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-c bash ' + DIR + 'L26/reset.sh` (or variant-a/variant-b): a different fault, a new release key and a new fingerprint. Diagnose without hints, rewrite the trust document and validate with `--variant variant-c --assistance independent --out ' + DIR + 'L26/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L26/reset.sh' },
    limits: ['Both environments share one Docker engine: containers on the receiver network have no route out, but the daemon itself is not firewalled (labs never change host firewall rules), so isolation is proven by digest-pinned internal references, layer comparison and the internal network. One openssl signature over a manifest; no per-image signatures, attestations, key expiry, revocation or replay protection.', 'Executed during development on Linux amd64 (Docker Engine 29.8 with the containerd image store, Compose v5, OpenSSL 3.0.13, registry:2.8.3): all three variants ran setup → verify REJECT → validate FAIL → sender-side fix → verify ACCEPT → load → deploy → validate PASS (11/11), with reset and teardown; trusting the bundle\'s own key failed trust-store/bundle-verifies and deploying postgres from the engine cache failed deployed-from-internal. Not run on macOS (LibreSSL\'s openssl dgst -sign/-verify is expected to behave the same, but was not tested) or with the classic image store.']
  });

  lab({
    id: 'L27', moduleId: 'M14', title: 'Bounded load on Beacon\'s write path: capacity, saturation and overload limits',
    objectiveIds: ['obj-m14-01', 'obj-m14-02'], executionMode: 'local', estimatedMinutes: 120, environmentProfile: 'compose', prerequisites: ['L14'],
    learnerBrief: 'At the morning peak the field fleet submits about 60 status records per second, most sensors report failures and retry, and the status page total looks too high afterwards. Someone scaled the API to three replicas and it made no difference. With a bounded load generator, measure the capacity of Beacon\'s write path, find what limits it, show what replicas do and do not change, and set server and client limits (queue, pool, retries, backoff, idempotency) so more sensors succeed while every write happens exactly once.\n\nCompose project looped-l27: PostgreSQL 16, a scalable ingest API with explicit limits, and a load generator with hard caps on rate, duration and concurrency. The per-write cost is a documented fixture; everything else is real.',
    checkpoints: [
      { id: 'c1', title: 'Measure: ceiling, bottleneck, replicas', resumeInstructions: '`bash ' + DIR + 'L27/setup.sh` reuses work/ and runs `up -d`. Every load run is a file in work/runs/ (baseline.json was taken at setup); `bash ' + DIR + 'L27/assets/run-load.sh step --steps 10,20,30,40,50,60,70 8` repeats the step test.' },
      { id: 'c2', title: 'Limit, retry safely, verify', resumeInstructions: 'Your limits are in work/limits.env (recreate the api after editing) and work/client.env (read at every run); notes in evidence/L27-notes.md. `reset.sh` saves both files and your runs to .work-previous/.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'starter/compose.yaml', 'assets/ingest.py', 'assets/loadgen.py', 'assets/pgmini.py', 'assets/run-load.sh', 'assets/common.sh', 'assets/init/01-schema.sql', 'assets/variants/', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# Docker with Compose v2, python3; about 1 minute including a 20 s baseline run', 'bash ' + DIR + 'L27/setup.sh', 'cat ' + DIR + 'L27/work/TICKET.md'],
    faultInjection: ['# setup.sh configured variant-a; to start over with the other variant:', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L27/reset.sh'],
    tasks: ['Read the baseline run (goodput, success, p99, amplification, codes) and count rows per request_key in the database.', 'Run a step test, find the saturation point, and while a step runs look at /stats (busy, waiting) and pg_stat_activity (what sessions wait on).', 'Scale the api to three replicas, repeat the same load, and explain the result in numbers.', 'Bound the server (worker limit, bounded queue with timeout, pool sized for the database) and the client (few retries, backoff with jitter, the same Idempotency-Key, Retry-After or a retry budget).', 'Re-run the 60/s load, write the five note sections including what would really raise capacity, then run validate.py (it runs its own bounded load) and import the evidence.'],
    validation: [
      { id: 'fixtures-intact', description: 'fixture code unchanged since setup and WRITE_COST_MS 25 on every replica', critical: true },
      { id: 'stack-up', description: 'database ready and every api replica answering', critical: true },
      { id: 'limits-bounded', description: 'every replica bounds waiting; all pools together fit in the usable connections', critical: true },
      { id: 'client-policy-bounded', description: '<=3 retries with backoff, jitter, the same key, Retry-After or a budget <=25%; deadline unchanged', critical: true },
      { id: 'saturation-measured', description: 'a step run spans the ceiling and the notes name a saturation point within 35% of it', critical: true },
      { id: 'replica-experiment', description: 'a run served by 2+ replicas exists and is explained', critical: true },
      { id: 'user-impact-improved', description: 'validator\'s own 60/s run: goodput >= max(1.5x, +10/s) of baseline, success +15 points, amplification <=1.5', critical: true },
      { id: 'no-duplicate-writes', description: 'exactly one row per logical request in the validator\'s run', critical: true },
      { id: 'acked-writes-present', description: 'every acknowledged request is in the database', critical: true },
      { id: 'ledger-consistent', description: 'the running total equals the number of records', critical: true },
      { id: 'notes', description: 'five note sections with substance (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L27/reset.sh   # same variant; limits, client policy and runs saved to .work-previous/; new baseline'],
    teardown: ['bash ' + DIR + 'L27/teardown.sh   # project looped-l27 with its synthetic data volume, and work/; evidence/ kept'],
    evidenceInstructions: ['`python3 ' + DIR + 'L27/validate.py --explanation-file ' + DIR + 'L27/evidence/L27-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Numbers depend on your machine; the validator compares your run with the baseline taken on the same machine at setup.'],
    hints: [
      { level: 1, text: 'Separate three questions: how much the system can do, what happens to work beyond that (queueing, shedding, retries), and whether the data stays right. A fix for the second must not trade away the third.' },
      { level: 2, text: 'A step test shows the ceiling. During a step, /stats on the api shows busy and waiting requests and pg_stat_activity shows what each database session waits on. `SELECT count(*), count(DISTINCT request_key) FROM records` shows whether retries became data.' },
      { level: 3, text: 'Scale to three replicas and repeat the same load: if goodput does not move, the limit is shared by all replicas. Look at what the waiting sessions wait on (wait_event_type Lock) and at the one statement every write runs.' },
      { level: 4, text: 'Every write updates one ledger row and holds its lock for 25 ms, so about 40 writes/s total. Bound the server (WORKERS=4, POOL_SIZE=4, QUEUE_MAX=16, QUEUE_TIMEOUT_MS=300) and the client (RETRIES=2, BACKOFF_MS=200, JITTER=1, REUSE_KEY=1, HONOR_RETRY_AFTER=1, RETRY_BUDGET_PCT=20). Real capacity comes from removing the shared row (WRITE_PATH=append-only), not from replicas.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T01', 'T08', 'T16'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L27/reset.sh` (or variant-a): the overload starts from the other side (client retry policy versus server queueing), so the first symptom differs. Repeat the step test and replica experiment without hints and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L27/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L27/reset.sh' },
    limits: ['One host with CPU- and memory-capped containers and a fixture write cost (pg_sleep under a hot-row lock): proves measuring a ceiling with bounded load, finding the shared bottleneck, showing that replicas do not move it, and limits that raise goodput without duplicate writes. No network latency, load balancer, autoscaling or production sizing.', 'Executed during development on Linux amd64 (Docker Engine 29.8, Compose v5, postgres:16.4): both variants ran setup (baseline ~6/s and ~16/s goodput at 60/s offered) → validate FAIL → step test, 3-replica runs (starting limits gave 53300 too-many-clients errors) → tuned limits → validate PASS (11/11, ~38/s goodput, 0 duplicates), with reset and teardown. Variant-b without a retry budget still failed on amplification x1.9. Not run on macOS.']
  });

  lab({
    id: 'L28', moduleId: 'M14', title: 'Incident rehearsal: lost primary database, a backup shelf, and the update log',
    objectiveIds: ['obj-m14-04', 'obj-m14-05'], executionMode: 'local', estimatedMinutes: 150, environmentProfile: 'compose', prerequisites: ['L27'],
    learnerBrief: 'Beacon\'s status API starts returning 503 and its primary PostgreSQL will not stay up. You are incident commander and operator: keep a time-stamped update log with scope, impact and a promised next-update time, decide whether to repair or replace the primary, choose a recovery point from the backups on the shelf with the least data loss you can defend, restore into a fresh server, prove the restored records are right, and close with owned follow-ups. The clock is real.\n\nCompose project looped-l28 with synthetic data from one invented day; a fixture damages the primary inside its own lab volume and arranges the backup shelf. The newest backup is not automatically the right one.',
    checkpoints: [
      { id: 'c1', title: 'Roles, scope and the first update', resumeInstructions: 'The incident starts at the end of setup and its start time is in work/TICKET.md. Your log is work/incident/updates.md; the validator checks gaps between updates, so a rehearsal paused overnight shows. `reset.sh` starts a fresh incident.' },
      { id: 'c2', title: 'Recovery point, restore, validation and follow-ups', resumeInstructions: 'Candidate backups and CATALOG.json are in work/backups/ (mounted at /backups in the restore and scratch servers). Point the API with DB_HOST in work/api.env, then `docker compose -p looped-l28 -f ' + DIR + 'L28/work/compose.yaml up -d api`.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'starter/compose.yaml', 'starter/api.env', 'assets/statusapi.py', 'assets/pgmini.py', 'assets/common.sh', 'assets/init/01-schema.sql', 'assets/updates-template.md', 'assets/followups-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# Docker with Compose v2, python3; plan one uninterrupted sitting', 'bash ' + DIR + 'L28/setup.sh', 'cat ' + DIR + 'L28/work/TICKET.md'],
    faultInjection: ['# setup.sh starts the variant-a incident; to rehearse the other variant:', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L28/reset.sh'],
    tasks: ['Write Update 1 within minutes: roles, impact, scope (affected and explicitly not affected), actions, next-update time; keep every promised update.', 'Diagnose the primary from its logs and decide repair versus replace without destroying it.', 'For each candidate backup compare CATALOG.json with the file (sha256, pg_restore --list, a trial restore into scratch, newest record) and choose the valid one with the least data loss.', 'Restore into the restore server, point the API at it, and validate counts, sensors, newest record and a test write.', 'Record the recovery point, data-loss window and validation in the log, close with Status: resolved, and add owned follow-ups; then run validate.py and import the evidence.'],
    validation: [
      { id: 'service-restored', description: 'the API answers /ready and accepts a write on the database it is configured for', critical: true },
      { id: 'recovery-point', description: 'the synthetic day on that database is exactly the valid backup with the least data loss (count + checksum)', critical: true },
      { id: 'primary-preserved', description: 'the damaged primary volume still exists for the postmortem', critical: true },
      { id: 'update-log', description: '3+ updates, UTC times after the start, <=30 min apart, Status/Impact/Scope/Next update, roles, final resolved', critical: true },
      { id: 'recovery-decision', description: 'an update names the restored recovery point, the data-loss window and the validation', critical: true },
      { id: 'followups', description: '2+ follow-ups with owner and due date', critical: true },
      { id: 'recovery-interval', description: 'time from incident start to the resolved update (advisory, reported)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L28/reset.sh   # new incident, same variant; your previous updates and follow-ups saved to .work-previous/'],
    teardown: ['bash ' + DIR + 'L28/teardown.sh   # project looped-l28 with both lab volumes, and work/; evidence/ kept'],
    evidenceInstructions: ['`python3 ' + DIR + 'L28/validate.py`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Copy the update log and follow-ups into your portfolio next to evidence/latest.json; they are the stakeholder-facing record.'],
    hints: [
      { level: 1, text: 'Two jobs run at once: communicating (roles, scope, impact, next update) and recovering (what do we have, what does each option lose, how do we prove it). Write Update 1 before you are sure of anything and say what you do not know yet.' },
      { level: 2, text: '`docker logs looped-l28-db` for the primary. For backups: CATALOG.json (what the jobs meant to produce) against sha256sum, `pg_restore --list` and a trial restore into scratch (what you actually have). Count records and look at the newest one.' },
      { level: 3, text: 'For each candidate: does the checksum match the catalog, does a trial restore finish, what is max(created_at), and which source took it? The best recovery point is the valid backup with the newest data, not the newest file name.' },
      { level: 4, text: 'The primary lost global/pg_control: do not repair it in place or wipe it. Variant-a: the 13:00 file is truncated, restore 12:00. Variant-b: the 13:30 file came from a lagging standby (newest 10:35), restore 13:00. Restore into restore, set DB_HOST=restore, recreate api, validate, then log the recovery point, data loss, validation and a resolved update.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T01', 'T09'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L28/reset.sh` (or variant-a) and rehearse again in one sitting without hints: the backup shelf misleads you differently and the right recovery point changes. Start a new update log and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L28/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L28/reset.sh' },
    limits: ['Logical dumps of a synthetic day on one engine: proves a structured incident record, an evidence-based recovery-point choice, restore into a fresh server, validation by count and checksum, and owned follow-ups. No PITR/WAL archiving, replica promotion, cross-region restore or real paging; the data-loss oracle exists only because the data is synthetic.', 'Executed during development on Linux amd64 (Docker Engine 29.8, Compose v5, postgres:16.4): both variants ran setup → validate FAIL → diagnosis, trial restores, restore, update log and follow-ups → validate PASS (7/7), with reset and teardown; restoring the truncated 13:00 file left an empty table, and restoring the stale 13:30 standby backup failed recovery-point. Not run on macOS.']
  });
})();
