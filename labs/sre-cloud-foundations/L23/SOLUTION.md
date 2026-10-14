# L23 worked solution

Open this only after a real attempt; using it makes the attempt **assisted**.

## c1 — the index

**variant-a** — `WHERE sensor_id = 's-0042' AND ts >= … AND ts < … ORDER BY ts`. Before: a
(parallel) sequential scan reads all 200 000 rows (about 1 900 buffers) to return 38, cost ≈ 4 932.

```sql
CREATE INDEX CONCURRENTLY readings_sensor_ts ON readings (sensor_id, ts);
```

After: bitmap index scan on `readings_sensor_ts`, cost ≈ 142 (2.9 %). Equality column first,
range/sort column second: the week's rows for one sensor are adjacent in the index.
`(sensor_id)` alone costs ≈ 23 % (reads every row of that sensor); `(ts)` alone ≈ 13 %.

**variant-b** — `WHERE site = 'site-07' AND status = 'fault' ORDER BY ts DESC LIMIT 20`.
Before: seq scan + top-N sort, cost ≈ 4 640.

```sql
CREATE INDEX CONCURRENTLY readings_site_status_ts ON readings (site, status, ts);
-- or a partial index: ON readings (site, ts) WHERE status = 'fault'
```

After: `Index Scan Backward`, stops after 20 rows, cost ≈ 77 (1.7 %). `(site, ts)` alone is
17.6 %: it walks site-07's newest rows and discards ~98 % of them (`Rows Removed by Filter`).

**Where an index would not help:** `WHERE status = 'ok'` matches about 93 % of rows; the planner
keeps the sequential scan, and the index only slows writes.

## c2 — the blocker

```sql
SELECT pid, application_name, state, wait_event_type, wait_event,
       pg_blocking_pids(pid) AS blocked_by, now() - xact_start AS xact_age, left(query, 60)
FROM pg_stat_activity WHERE datname = 'beacon' ORDER BY xact_start;

SELECT l.pid, l.locktype, l.mode, l.granted, c.relname
FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation
WHERE l.pid IN (SELECT unnest(pg_blocking_pids(pid)) FROM pg_stat_activity);
```

All five `beacon-api-pool` sessions are `active` with `wait_event_type = Lock` and
`blocked_by = {N}`. Session N (`beacon-backfill`) is **idle in transaction**:
variant-a holds row locks on sensors s-0042/s-0007/s-0113 (the writers wait for `ShareLock` on
its transaction id); variant-b holds `ShareLock` on `status_events`, which conflicts with the
`RowExclusiveLock` every INSERT needs. The postgres log says the same: "Process holding the lock: N".

`beacon-report` is the oldest *active* query and looks guilty, but it holds only
`AccessShareLock` on `readings` and blocks nobody. Terminating it would lose a long report for
nothing; restarting the database would kill everything.

```sql
SELECT pg_terminate_backend(N);   -- pg_cancel_backend does nothing to an idle session: no query to cancel
```

Its uncommitted change rolls back, the five waiting writes commit immediately and the other
seven follow; the idempotency key (`ON CONFLICT (idem_key) DO NOTHING`) makes any retry harmless.
Prevent it next time with `idle_in_transaction_session_timeout` for ad-hoc roles and a
`lock_timeout` in the application.

## Notes

Write `blocker_pid: N` in the Blocker section; `assets/notes-template.md` lists the sections.
