# L23 — Query plans, a held lock and an exhausted pool on PostgreSQL 16

Module M12 · ~130 min practical · profile `compose` (Docker engine) · **local only: no cloud, no cost**

## Ticket

> **BEACON-DATA-2311.** The sensor history page times out for some sensors; the slow query from
> the API log is in `work/ticket-query.sql`. Make it fast without changing what it returns, and
> keep the plan before and after.
> *Later the same day (checkpoint c2):* status updates from the sensors stop landing and the API
> logs say `pool exhausted`. Someone suggests restarting the database. Find what the writes are
> waiting for, fix it with the smallest action, and make sure the twelve queued updates land
> exactly once — without restarting the database or the API.

## Objectives

- `obj-m12-01` read a query plan, add an appropriate index and explain the change (and when an
  index would not help)
- `obj-m12-02` identify the blocking transaction and the saturated pool from evidence and mitigate
  without terminating unrelated sessions

## What you run

Compose project `looped-l23`: `looped-l23-db` (`postgres:16.4`, pinned by tag and digest,
127.0.0.1:15423, named volume `looped-l23-data`, `log_lock_waits=on`). `assets/seed.sql` loads a
**deterministic** synthetic dataset with `generate_series`: 400 sensors on 20 sites and 200 000
readings (one every 40 s for about 92 days); the same rows and checksum every time. At c2,
`inject.sh` starts two more containers on a pinned Python image: `looped-l23-fixtures` (two
long-lived database sessions) and `looped-l23-pool` (Beacon's write path: 8 threads sharing a
pool of 5 connections, acquire timeout 2 s, no lock timeout — like many real pools). Both use
`assets/pgmini.py`, a small standard-library PostgreSQL client, so nothing is pip-installed.

```sh
docker exec -it looped-l23-db psql -U beacon -d beacon        # no host psql needed
```

The password in the compose file (`lab-l23-db-not-a-real-secret`) is a placeholder.

## What is fixture-controlled

The missing index is the seeded state. `LOOPED_VARIANT=variant-a|variant-b` (at setup) chooses
the ticket query and which lock the fixture session takes at c2. The fixture sessions are named
by `application_name` like ordinary jobs would be; which one is in the way is for you to prove.
`pool exhausted` is real client behaviour, not a printed message: the pool really is full.

## Steps and checkpoints

**Checkpoint c1 — plans and an index (week 35, session 1).** Do c1 *before* running inject.sh.

1. `bash labs/sre-cloud-foundations/L23/setup.sh`; read `work/TICKET.md`.
2. `EXPLAIN (ANALYZE, BUFFERS)` the ticket query; paste it under **Plan before** in
   `evidence/L23-notes.md`. Name the scan node, rows read versus returned, buffers, time.
3. Predict which index serves this query (columns and order) and why; create it (with or
   without `CONCURRENTLY` — know the difference); EXPLAIN again under **Plan after**.
4. Write one query on this table where an index would not help.

**Checkpoint c2 — locks and the pool (week 35, session 2).**

5. `bash labs/sre-cloud-foundations/L23/inject.sh` (waits until the pool reports saturation).
6. Evidence first: `docker logs looped-l23-pool`, `pg_stat_activity` (state, `wait_event_type`,
   `xact_start`, `query`), `pg_blocking_pids(pid)`, `pg_locks` (mode, granted), and the server
   log (`docker logs looped-l23-db`, lines "still waiting for … Process holding the lock").
7. Write `blocker_pid: <n>` and your reasoning in **Blocker**, including why the other
   long-running session is *not* the problem.
8. End only that session (`SELECT pg_terminate_backend(<pid>)` — and say why
   `pg_cancel_backend` would not have helped). Watch the pool drain.
9. `python3 labs/sre-cloud-foundations/L23/validate.py --explanation-file labs/sre-cloud-foundations/L23/evidence/L23-notes.md`
   and import `evidence/latest.json`.

## What the validator checks

The seeded rows still have their checksum (deleting data to make a query fast fails); the ticket
query's plan uses an index whose leading column fits the query and costs at most 10 % of the
baseline recorded at setup; at most two new indexes, all valid; after inject: no session waits on
a lock, the lock holder is gone and is the pid you named, **the long report session and the
pool's original five connections are still there** (terminating everything long-running fails),
and all twelve updates committed exactly once with the sensors showing the last status.

## Rubric for the notes (self or mentor)

- The before/after plans are read, not pasted: node types, rows removed by filter, buffers.
- The index column order is justified (equality first, range/sort second) and its write cost named.
- The blocker is identified from lock evidence, with the decoy explicitly ruled out.
- The note explains why a database lock looks like "pool exhausted" in the application.

## Pause / resume

The database keeps its volume; `docker start looped-l23-db` after a reboot (fixture sessions do
not survive a restart — run inject.sh again). `reset.sh` stops the fixtures, ends their sessions
and reloads the dataset (dropping your indexes). `teardown.sh` removes the project and its volume.

## Lab versus production

- Production pools set `lock_timeout`/`statement_timeout` and alert on pool wait time; a lock
  holder is often a migration or a forgotten `BEGIN` in a console, and the fix includes
  `idle_in_transaction_session_timeout` so it cannot happen silently again.
- On a busy table, `CREATE INDEX CONCURRENTLY` avoids blocking writes but waits for every older
  transaction — including an idle one holding a lock — and leaves an INVALID index if cancelled.

## Limits — what this lab does not prove

It proves plan reading, index choice and lock/pool diagnosis on a 200 000-row synthetic table in
one container. It does not prove behaviour at production size or concurrency, replication,
vacuum and bloat, connection poolers such as PgBouncer, or managed-database tooling.

## References

- T09 PostgreSQL documentation (backup chapter; see also EXPLAIN, explicit locking, pg_locks) · T16 Docker Compose documentation
