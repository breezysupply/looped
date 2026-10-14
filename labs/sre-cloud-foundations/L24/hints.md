# L24 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** A backup is a claim until it has been restored somewhere fresh and compared with
   the source. A delivery is at-least-once until something makes the *effect* idempotent. For
   each half, ask what evidence would prove it, before running any fix.
2. **Evidence source.** `ls -l work/backups/`, `pg_restore --list` (reads only the table of
   contents), a test restore into `looped-l24-restore` and `verify_restore.py` (counts, checksums,
   samples, sequences). For deliveries: `ledger.deliveries` grouped by `idempotency_key`,
   `queue.jobs.attempts`, `docker logs looped-l24-worker`, the container's restart count.
3. **Discriminating check.** Does `pg_restore` exit 0? Does every table match, or only some? For a
   duplicated key: does it have one job row with `attempts = 2` (redelivery after a crash) or two
   job rows (the producer sent it twice)? A fix that only handles one of those is not a fix.
4. **Root cause and fix.** The morning dump is damaged (A: truncated, B: altered bytes) — take a
   fresh `pg_dump -Fc` from the live source, restore with `--exit-on-error` into a freshly created
   target, verify, stop the clock. Deliveries: move the extra rows aside, add
   `UNIQUE (idempotency_key)` on `ledger.deliveries`, insert with
   `ON CONFLICT (idempotency_key) DO NOTHING`, keep `lab_fault()`, restart the worker.
