# L27 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Separate three questions: how much the system can do (capacity), what happens
   to work beyond that (queueing, shedding, retries), and whether the data stays right. A fix for
   the second must not trade away the third.
2. **Evidence source.** A step test shows the ceiling. During a step, `/stats` on the api shows
   busy and waiting requests, and `pg_stat_activity` shows what each database session waits on.
   `SELECT count(*), count(DISTINCT request_key) FROM records` shows whether retries became data.
3. **Discriminating check.** Scale to three replicas and repeat the same load: if goodput does
   not move, the limit is shared by all replicas. Look at what the waiting sessions wait on
   (`wait_event_type = Lock`) and at the one statement every write runs.
4. **Root cause and fix.** Every write updates one `ledger` row and holds its lock for 25 ms →
   ~40 writes/s total. Bound the server (WORKERS=4, POOL_SIZE=4, QUEUE_MAX=16,
   QUEUE_TIMEOUT_MS=300) and the client (RETRIES=2, BACKOFF_MS=200, JITTER=1, REUSE_KEY=1,
   HONOR_RETRY_AFTER=1, RETRY_BUDGET_PCT=20). Real capacity comes from removing the shared row
   (`WRITE_PATH=append-only`), not from replicas.
