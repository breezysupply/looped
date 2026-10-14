# L24 — Backups you have restored, and deliveries that cannot happen twice

Module M12 · ~150 min practical · profile `compose` (Docker engine, Python 3 on the host) ·
**local only: no cloud, no cost**

## Ticket

> **BEACON-DATA-2412.**
> 1. *Recovery drill (c1).* Before Thursday's schema migration, prove we can restore Beacon's data
>    from this morning's backup (`work/backups/`) into a **fresh** database and that what comes
>    back is what we have now. Measure how long recovery actually takes, from start to verified.
> 2. *Delivery complaint (c2).* A downstream team says some sensors were notified twice today. The
>    worker restarted once overnight. Make a repeat delivery of the same message impossible,
>    without losing any message.

## Objectives

- `obj-m12-03` restore into a fresh database, compare counts and checksums, measure the recovery interval
- `obj-m12-04` process duplicate deliveries with an idempotency key so no side effect repeats, and
  explain the retry boundary

## What you run

Compose project `looped-l24`, `postgres:16.4` pinned by tag and digest:

| Container | Role | Address |
|---|---|---|
| `looped-l24-db` | the source: Beacon's records (`public`), the job queue (`queue`) and the downstream ledger (`ledger`); named volume `looped-l24-data` | 127.0.0.1:15424 |
| `looped-l24-restore` | a **fresh, disposable** restore target (profile `restore`, data on tmpfs) — you create it | 127.0.0.1:15425 |
| `looped-l24-worker` | the delivery worker, `work/worker.py` (your copy) on a pinned Python image, `restart: on-failure` | — |

The dataset is deterministic (`assets/schema.sql`, `assets/today.sql`): 400 sensors, 58 000
records, 440 audit rows. The queue is a Redis-free design: a `queue.jobs` table leased with
`FOR UPDATE SKIP LOCKED`; delivery is at-least-once by design. Tools you use from the host:

- `assets/verify_restore.py --source DSN --target DSN [--report file]` — compares every table in
  `public`: row counts, an md5 over every row ordered by primary key, 25 rows per table looked up
  by key and compared value by value, and sequence positions. Standard library only (with
  `assets/pgmini.py`); the same script verifies the sandbox restore in cloud extension C04.
- `assets/recovery_clock.py start | stop --report … --backup … | show` — your measured interval.

DSNs (placeholder password, not a secret):
`postgresql://beacon:lab-l24-db-not-a-real-secret@127.0.0.1:15424/beacon` (source) and `…:15425/beacon` (restore).

## What is fixture-controlled

`inject.sh` writes this morning's backup `work/backups/beacon-nightly-2026-10-13.dump` and damages
it (variant-a and variant-b damage it differently), enqueues twenty delivery messages, and tells
the worker — through `queue.faults`, a lab hook you must keep — to crash once at a chosen moment.
In variant-b the producer also enqueues some messages twice. The crash is `os._exit` on purpose,
not a real fault; at-least-once redelivery after it is real.

## Steps and checkpoints

**Checkpoint c1 — restore and prove it (week 36, session 1).**

1. `bash labs/sre-cloud-foundations/L24/setup.sh`, then `bash labs/sre-cloud-foundations/L24/inject.sh`.
2. `python3 labs/sre-cloud-foundations/L24/assets/recovery_clock.py start`.
3. Inspect the backups before trusting one (`docker exec -i looped-l24-db pg_restore --list < file`,
   sizes, a test restore). Decide what you restore from.
4. Create an empty target: `docker compose -p looped-l24 -f labs/sre-cloud-foundations/L24/assets/compose.yaml --profile restore up -d --wait restore`
   (`… rm -sf restore` first if one exists — it must be fresh).
5. Restore: `docker exec -i looped-l24-restore pg_restore --no-owner --exit-on-error -U beacon -d beacon < work/backups/<file>.dump`
   (a custom-format dump is `docker exec looped-l24-db pg_dump -Fc -U beacon -d beacon > file`).
6. Verify with `verify_restore.py … --report labs/sre-cloud-foundations/L24/work/verify-report.json`;
   when it says RESTORE VERIFIED, `recovery_clock.py stop --report … --backup …`.

**Checkpoint c2 — idempotent delivery (week 36, session 2).**

7. Evidence: `SELECT idempotency_key, count(*) FROM ledger.deliveries GROUP BY 1 HAVING count(*) > 1`,
   the jobs' `attempts`, `docker logs looped-l24-worker`, `docker inspect -f '{{.RestartCount}}' looped-l24-worker`.
8. Make the guarantee live where a crash cannot skip it; deal with the duplicates that already
   happened (they block the guarantee); change `work/worker.py` and `docker restart looped-l24-worker`.
9. `python3 labs/sre-cloud-foundations/L24/validate.py --explanation-file labs/sre-cloud-foundations/L24/evidence/L24-notes.md`.
   It **replays** fresh messages with a producer duplicate and two crashes (before and after the
   side effect) and counts deliveries.

## What the validator checks

Source data unchanged; the backup you restored from is not the damaged one and is readable;
the restore target was created after your clock started; target equals source (counts,
checksums, sampled values, sequences, re-run by the validator); your interval agrees with the
verification report; a UNIQUE constraint on `ledger.deliveries(idempotency_key)`; no duplicates;
every message delivered exactly once; and the replay test. Restoring the damaged file and
ignoring pg_restore's exit status, deleting duplicates without a constraint, or skipping
redelivered jobs (losing the message whose crash came *before* the side effect) each fail.

## Rubric for the notes (self or mentor)

- Backups were tested by restoring, and "exited 0" was not taken as proof.
- RPO and RTO are stated with numbers, against D04's 15 min / 60 min, honestly ("not met" is a valid answer).
- Both duplicate mechanisms (crash between effect and ack; producer retry) are explained.
- Existing duplicates were handled deliberately (kept, moved, reported), not silently deleted.

## Pause / resume

The source keeps its volume; `docker start looped-l24-db looped-l24-worker` after a reboot (the
restore target is tmpfs and starts empty, by design). `reset.sh` reloads everything for the same
variant and saves your worker as `work/worker.py.bak`. `teardown.sh` removes the project, its
volume and `work/` (including your backups).

## Lab versus production

- Real recovery points come from continuous WAL archiving or managed snapshots with
  point-in-time recovery; a nightly logical dump gives an RPO of up to a day.
- The ledger here is a table in the same database for observability; a real side effect (an
  email, a webhook, a payment) needs the downstream system to honour the idempotency key too.

## Limits — what this lab does not prove

It proves a verified logical backup/restore of a small synthetic database with a measured
interval, and exactly-once *effects* over at-least-once delivery with a database constraint.
It does not prove physical backups, PITR, replication or failover, restore time at real data
sizes, or cross-system idempotency. The measured interval is for a few MB on one machine.

## References

- T09 PostgreSQL backup and restore · T24 Redis documentation (queue concepts; this lab is deliberately Redis-free) · T16 Docker Compose
