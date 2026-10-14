# L23 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Two different slownesses: a query that does too much work (the plan), and work
   that cannot start because something else holds what it needs (a lock). Decide which one you
   are looking at before changing anything, and never "fix" either by deleting data or restarting.
2. **Evidence source.** `EXPLAIN (ANALYZE, BUFFERS)` for the plan — node type, rows, `Rows Removed
   by Filter`, buffers. For waits: `pg_stat_activity` (`state`, `wait_event_type`, `xact_start`),
   `pg_blocking_pids(pid)`, `pg_locks` (`mode`, `granted`), and `docker logs looped-l23-db`
   (log_lock_waits is on). The pool's side is `docker logs looped-l23-pool`.
3. **Discriminating check.** For the plan: which columns are compared with `=`, which with a range
   or ORDER BY — does your index put them in that order? For the lock: of the two long-running
   sessions, which one appears in the waiters' `pg_blocking_pids()`, and what is its state? An
   *active* long query and an *idle in transaction* session are very different things.
4. **Root cause and fix.** c1: variant A `CREATE INDEX ON readings (sensor_id, ts)`; variant B
   `ON readings (site, status, ts)` (or `(site, ts) WHERE status = 'fault'`). c2: the
   `beacon-backfill` session is idle in transaction holding the lock (row locks on three sensors
   in A, SHARE on status_events in B). `SELECT pg_terminate_backend(<its pid>)` — only that pid;
   leave `beacon-report` and the pool alone; write the pid as `blocker_pid:` in your notes.
