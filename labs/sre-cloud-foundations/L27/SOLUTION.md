# L27 worked solution (instructor copy — open only after an honest attempt)

## Diagnosis

- Step test (`run-load.sh step --steps 10,20,30,40,50,60,70 8`): goodput equals the offered rate
  up to ~40/s and stays at ~40/s above it. Measured in development: 10, 20, 30, 40, 41, 40, 41.
- `pg_stat_activity` during load: almost every session is `Lock / transactionid`, one is
  `Timeout / PgSleep`. Every write updates the single `ledger` row and holds its row lock for the
  25 ms fixture cost, so writes serialise: 1000 / 25 = **40 writes/s** for the whole service.
- **variant-a (client side):** client timeout 400 ms, 4 immediate retries, a **new
  Idempotency-Key per attempt**. Requests queue for longer than 400 ms, clients retry at once,
  the server still completes the abandoned writes, and each retry is a new record. Baseline:
  goodput ~6/s, success ~10%, amplification ×4.7, hundreds of duplicate rows; the replica is
  OOM-killed by thousands of waiting threads (unbounded queue).
- **variant-b (server side):** 64 workers, unbounded queue, pool 24. Work waits seconds in the
  queue; clients give up at 2 s and retry (same key, so no duplicates); goodput ~16/s.
- Replicas: three replicas with pool 16 (variant-a) open 48 connections against 27 usable →
  `53300 too many clients` → 503s. With sane pools, three replicas still give ~36–40/s: the row
  lock does not care how many processes wait on it.

## Fix (both variants)

`work/limits.env`:
```
WORKERS=4
QUEUE_MAX=16
QUEUE_TIMEOUT_MS=300
POOL_SIZE=4
```
`docker compose -p looped-l27 -f work/compose.yaml up -d --scale api=1`

`work/client.env`:
```
TIMEOUT_MS=1000
RETRIES=2
BACKOFF_MS=200
JITTER=1
HONOR_RETRY_AFTER=1
REUSE_KEY=1
RETRY_BUDGET_PCT=20
```

Result in development (60/s for 20 s): goodput ~38/s, success ~64%, p50 ~380 ms, amplification
×1.2, 0 duplicates. The remaining ~35% are refused quickly with 503 + Retry-After; that is the
honest answer at 150% of capacity. Variant-b note: with the server fixed but no retry budget,
amplification stays ~×1.9 and the validator's run fails — the budget matters.

## What would raise capacity

Remove the shared row: `WRITE_PATH=append-only` writes one `ledger_events` row per record and
the total is summed on read (or by a periodic job). Re-run the step test: goodput now follows the
offered rate past 40/s and the lock waits disappear. Cost: a slower or slightly stale total.

## Unsafe shortcuts

- Lowering `WRITE_COST_MS` or editing `ingest.py` → `fixtures-intact`.
- Raising the client deadline to "improve" success → `client-policy-bounded`.
- More replicas with big pools → `limits-bounded` (connections) and no goodput gain.
- Unlimited immediate retries with new keys → duplicates (`no-duplicate-writes`) and amplification.
