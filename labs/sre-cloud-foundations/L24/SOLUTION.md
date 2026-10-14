# L24 worked solution

Open this only after a real attempt; using it makes the attempt **assisted**. Finished files:
`solution/worker.py`, `solution/dedupe.sql`.

## c1 — the backups

| File | What is wrong | How it shows |
|---|---|---|
| `beacon-nightly-2026-10-12.dump` | nothing — but it is from last night | restores cleanly; 50 000 records and 400 audit rows: today's 8 000 records are missing |
| `beacon-nightly-2026-10-13.dump`, variant-a | cut short (70 % of its length; smaller than yesterday's although the data grew) | `pg_restore --list` still works (the table of contents is at the start); the restore fails with `could not read input file: end of file` |
| `beacon-nightly-2026-10-13.dump`, variant-b | 48 bytes altered inside the compressed table data (same size as a good dump) | the restore fails with `could not uncompress data: incorrect data check` |

In both variants `pg_restore` *without* `--exit-on-error` carries on: `audit_log` comes back
complete, `records` and `sensors` come back empty, and the exit status is 1. A quick look at one
table "works". Only per-table counts and checksums show it.

The source is alive, so the right recovery point is now:

```sh
L=labs/sre-cloud-foundations/L24
python3 $L/assets/recovery_clock.py start
docker exec looped-l24-db pg_dump -Fc -U beacon -d beacon > $L/work/backups/beacon-drill.dump
docker compose -p looped-l24 -f $L/assets/compose.yaml --profile restore rm -sf restore
docker compose -p looped-l24 -f $L/assets/compose.yaml --profile restore up -d --wait restore
docker exec -i looped-l24-restore pg_restore --no-owner --exit-on-error -U beacon -d beacon < $L/work/backups/beacon-drill.dump
SRC=postgresql://beacon:lab-l24-db-not-a-real-secret@127.0.0.1:15424/beacon
DST=postgresql://beacon:lab-l24-db-not-a-real-secret@127.0.0.1:15425/beacon
python3 $L/assets/verify_restore.py --source "$SRC" --target "$DST" --report $L/work/verify-report.json
python3 $L/assets/recovery_clock.py stop --report $L/work/verify-report.json --backup $L/work/backups/beacon-drill.dump
```

Expected: `records 58000 -> 58000`, `sensors 400 -> 400`, `audit_log 440 -> 440`, equal md5,
25 samples per table equal, `audit_log_id_seq 440 -> 440`, **RESTORE VERIFIED**. The measured
interval is mostly human time (seconds of machine time for ~2 MB). If the source had been lost,
the only good backup is 2026-10-12: RPO ≈ 24 h (8 000 records and 40 audit rows gone) — D04's
RPO 15 min is **not** met by nightly dumps; RTO is met at this size.

## c2 — duplicates

- **variant-a:** `l24-msg-004` delivered twice, its job `attempts = 2`, worker restart count 1:
  the worker inserted the delivery, crashed before `ack`, the lease expired, the job ran again.
- **variant-b:** the same for `l24-msg-015`, plus `l24-msg-007/012/018` with two job rows each
  (`attempts = 1`): the producer enqueued them twice. A worker-side "have I seen this job id?"
  check would miss these — the job ids differ; only the idempotency key is shared.

Fix where a crash cannot skip it — the database:

```sh
docker exec -i looped-l24-db psql -U beacon -d beacon -v ON_ERROR_STOP=1 < labs/sre-cloud-foundations/L24/solution/dedupe.sql
```

(moves the later duplicates to `ledger.removed_duplicates` for the downstream team, then adds
`UNIQUE (idempotency_key)`), and in `work/worker.py`:

```python
rows = db.query("INSERT INTO ledger.deliveries (idempotency_key, job_id, sensor_id) VALUES (...) "
                "ON CONFLICT (idempotency_key) DO NOTHING RETURNING id")
return "delivered" if rows else "already-delivered"
```

then `docker restart looped-l24-worker`. A redelivered job now inserts nothing and is acked. Do
not "skip jobs with attempts > 1": the crash *before* the side effect would lose that message.
Do not check-then-insert in Python: two workers (or a crash between check and insert) race.
