# L25 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** A rotation has three parts: every consumer gets the new credential, the server
   stops accepting the old one, and nothing records either value. The first part depends on an
   inventory you have not made yet. For the scan, applicability is a property of this code and
   this configuration, not of the CVE.
2. **Evidence source.** `docker compose -p looped-l25 -f work/compose.yaml config` shows how each
   service gets its credential; `docker logs` shows the fingerprint each consumer presents and
   the SQLSTATE when it fails. For the scan: compare the versions in `vuln-report.json` with
   `work/patch/report/requirements.txt`, then read `app/report.py` and `report.json`.
3. **Discriminating check.** Do both consumers read the credential from the same place, and is
   that place a file? After you change the file, does the fingerprint in the logs change without
   a restart? If not, check how you wrote the file (`ls -i` before and after). For each finding:
   is the vulnerable function called, with input someone outside the team controls?
4. **Root cause and fix.** The exporter does not use the shared secret (variant-a: its own stale
   copy; variant-b: an environment variable from `.env`). Point it at the shared file, delete the
   copy, write the new value in place (or recreate), ALTER ROLE with `assets/scram.py`, or create
   `beacon_app_v2` and set the old role NOLOGIN. Triage: variant-a patches idna (sensor hostnames
   are untrusted); variant-b patches jinja2 to 3.1.6 (operator templates in the sandbox). Rebuild
   `:patched`, then generate the SBOM from the same lock.
