# L27 — Capacity, saturation and overload limits for Beacon's write path

Module M14 · ~120 min practical · profile `compose` (Docker engine + Compose v2, `python3`) · **local only: bounded load, no cloud**

## Ticket

> **BEACON-OPS-1402.** Every weekday 07:55–08:20 the field fleet submits about 60 status records
> per second. During that window most sensors report submission failures and retry, and the
> status page's record total looks too high afterwards. Someone scaled the API to three replicas
> during the peak; on-call says it "made no difference, maybe worse". Find the capacity of the
> write path and what limits it, make the peak as painless as possible for sensors without
> breaking the data, and write down what would actually raise capacity.

## Objectives

- `obj-m14-01` run bounded load, identify the saturation point, and distinguish added replicas
  from removing the real bottleneck
- `obj-m14-02` tune retry, timeout and concurrency limits so user impact falls while data stays correct

## What runs

Compose project `looped-l27` (`work/compose.yaml`):

| Service | What it is |
|---|---|
| `db` (`looped-l27-db`) | `postgres:16.4` pinned by digest, `max_connections=30`, 1 CPU |
| `api` | Beacon's `POST /status` write path, L27 build (`assets/ingest.py`, stdlib + `pgmini`): a worker limit, a wait queue, a connection pool and an idempotency key, all set from `work/limits.env`. No `container_name`, so `--scale api=N` works. 1 CPU, 256 MiB each |
| `loadgen` (profile `tools`) | `assets/loadgen.py`: an open-loop generator with hard caps (≤120 requests/s, ≤60 s per step, ≤10 steps, ≤200 in flight, ≤5 retries). Client policy from `work/client.env`. Each run writes `work/runs/<label>.json` |

**Fixture-controlled cost.** Each new record's transaction spends `WRITE_COST_MS` (25 ms) in
`pg_sleep`, a stand-in for a heavier write. That number is a fixture; the validator refuses a
run where it or the fixture code changed. Everything else — where time is spent waiting, what
fails first, how retries multiply — is real behaviour of PostgreSQL, the pool and the clients.

Run load only with `bash labs/sre-cloud-foundations/L27/assets/run-load.sh <label> [rps] [seconds]`
or `… run-load.sh step --steps 10,20,30,40,50,60,70 8`. It runs inside the project network and
cannot be pointed anywhere else by accident.

**User-impact metric:** *goodput* — logical requests (one per sensor submission, retries
included) that got a 2xx within 2 s, per second — plus success rate. **Data correctness:**
exactly one row per logical request, every acknowledged request present, and the running total
equal to the number of records.

## Steps and checkpoints

**Checkpoint c1 — measure (week 41, session 1).**

1. `bash labs/sre-cloud-foundations/L27/setup.sh` (about a minute; it ends with a 20 s baseline
   run at 60/s saved as `work/runs/baseline.json`). Read `work/TICKET.md`.
2. Read the baseline: goodput, success, p99, amplification (attempts per logical request),
   codes. Count rows per `request_key` in the database:
   `docker exec -i looped-l27-db psql -U beacon -d beacon -c "SELECT count(*), count(DISTINCT request_key) FROM records"`.
3. Run a step test and find the saturation point. While a step is running, look at `/stats`
   on the api (`busy`, `waiting`) and at `pg_stat_activity` (`wait_event_type`, `wait_event`).
4. Scale to three replicas (`docker compose -p looped-l27 -f work/compose.yaml up -d --scale api=3`),
   run the same load, and explain the result. Scale back to one.

**Checkpoint c2 — limit and verify (week 41, session 2).**

5. Change `work/limits.env` (then `up -d` to recreate the replicas) and `work/client.env` (read at
   every run). Bound the wait, size the pool for what the database can use, bound retries with
   backoff and jitter, keep the same idempotency key across attempts, respect `Retry-After` and
   cap retries as a share of traffic.
6. Re-run the 60/s load and compare. Fill in `evidence/L27-notes.md`, including what would raise
   capacity for real.
7. `python3 labs/sre-cloud-foundations/L27/validate.py` (it runs its own 20 s load) and import
   `evidence/latest.json`.

## What you should observe

- Goodput rises with offered load up to a ceiling and then stays flat; latency and errors take
  over above it. Where the ceiling sits is a property of one shared resource, not of the API.
- Under the starting limits, the API keeps accepting work it cannot finish: threads pile up,
  clients give up, the server still performs their writes, and retries arrive as new work. Under
  some settings the replica is even OOM-killed and restarted (`docker inspect … RestartCount`).
- More replicas multiply connections and waiters, not capacity.

## What the validator checks

The fixture is unchanged; the stack is up; every replica bounds waiting and all pools fit in
the database's usable connections; the client policy is bounded (≤3 retries, backoff, jitter,
the same key, Retry-After or a budget ≤25%, deadline unchanged); a step run spans the ceiling
and your notes name a saturation point within 35% of the measured one; a run served by 2+
replicas exists and is explained; **its own 20 s run at 60/s** beats the setup baseline
(goodput ≥ max(1.5×, +10/s), success +15 points, amplification ≤1.5); no duplicate rows for that
run, every acknowledged request present, ledger consistent; notes (advisory).

## Safety and scope

- Only Compose project `looped-l27`, volume `looped-l27-pgdata`, network `looped-l27-net` and
  `work/` are created or removed. Nothing is published except the database on 127.0.0.1:15027.
- Every container has a CPU and memory limit; the generator's caps are in code, not config.
- `reset.sh` copies your limits, policy and runs to `.work-previous/`, removes everything and
  sets up the same variant (baseline included). `teardown.sh` removes everything; `evidence/` stays.

## Pause / resume

`setup.sh` reuses `work/` and runs `up -d`. Runs are files in `work/runs/`; nothing else needs
to be remembered between sessions.

## Lab versus production

- One host, one engine, CPU-capped containers: absolute numbers say nothing about production
  capacity; the *shape* (ceiling, queueing, retry amplification) is what transfers.
- Real services shed load at a gateway or load balancer as well as in the process, and use
  adaptive concurrency limits; the reasoning about bounded queues and retry budgets is the same.

## Limits — what this lab does not prove

It proves that you can measure a ceiling with bounded load, find the shared resource behind it,
show that replicas do not move it, and set server and client limits that raise goodput without
duplicate writes. The write cost is a fixture (`pg_sleep`), the database runs on the same host
as the load, and there is no network latency, autoscaling, load balancer or multi-host
contention. It does not size a production system.
