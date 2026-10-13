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
})();
