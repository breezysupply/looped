# Beacon — the course's one small service

Beacon is deliberately tiny and deliberately fictional. A Python HTTP API accepts synthetic
sensor status records; a worker processes queued jobs; PostgreSQL persists records in the
container labs; Redis supplies a queue/cache from M12 on. A bounded synthetic client generates
load. No real data, no real architecture.

**Standard library only** for everything the host labs run (`api`, `worker`, `client`, the
config reader). The container image adds `psycopg` and `redis` (pinned in `requirements.txt`).
Python 3.9 or newer.

```
beacon/
  beacon/
    api.py         the HTTP API (health, readiness, version, status records, jobs, metrics, admin injection)
    worker.py      queue consumer with an idempotency key (the switch L24/S24 exercise)
    client.py      bounded load generator (rps × duration, never open-ended)
    config.py      YAML-subset/JSON config, BEACON_* env overrides, validation with useful errors
    store.py       memory | sqlite | postgres
    queue.py       none | dir | redis (at-least-once by design)
    telemetry.py   JSON logs with request/trace ids, Prometheus text metrics with bounded labels
  tests/           unittest suite (starts a real server on a loopback port)
  beacon.yaml      sample config (the course edits this in L01–L03)
  beacon.service   systemd unit template for the Linux VM (L03)
  Dockerfile       unprivileged image (L13)
  requirements.txt pinned extras for the image only
```

## Run it

```sh
cd labs/sre-cloud-foundations/beacon
python3 -m unittest discover -s tests -t .      # proves it runs on your Python
python3 -m beacon api --config beacon.yaml      # http://127.0.0.1:8080
curl -s localhost:8080/healthz; curl -s localhost:8080/version
curl -s -X POST localhost:8080/status -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' \
     -d '{"sensor_id":"s-1","status":"ok"}'
python3 -m beacon client --target http://127.0.0.1:8080/healthz --rps 5 --duration 5
```

## What Beacon exposes (and why)

| Path | Purpose | Teaching point |
|---|---|---|
| `GET /healthz` | liveness; never checks dependencies | a liveness probe that checks the database restarts the wrong thing (M08) |
| `GET /ready` | readiness; 503 if store/queue unreachable or injected | readiness removes traffic without a restart |
| `GET /version` | version, environment, commit, uptime | prove which artifact is running after a rollout |
| `POST /status` | accept a record; `Idempotency-Key` makes retries safe | idempotent submission (M04, M12) |
| `POST /jobs` | enqueue a job | at-least-once + worker idempotency (M12) |
| `GET /metrics` | Prometheus text; route label is the *template* | bounded cardinality (M11) |
| `POST /admin/inject` | delay / fail rate / readiness failure (admin only) | fixture-controlled faults, clearly not infrastructure faults |
| `GET /debug/config` | effective config, secrets redacted (admin only) | "what is it actually running with" |

Every response has `X-Request-Id` and a W3C `traceparent`; every request is one JSON log
line with the same ids. Headers are allow-listed before logging so secrets never land in logs.

## Configuration

`--config beacon.yaml` (a documented YAML **subset**: nested maps, scalars, comments; no lists)
or a `.json` file; then `BEACON_<SECTION>_<KEY>` environment variables; then flags
(`--listen`, `--port`). `python3 -m beacon validate-config --config beacon.yaml` prints the
effective, redacted configuration or a precise error (`beacon.yaml:7: duplicate key 'port'`).

Validation is semantic, not just syntactic: `port: "8080"` (a string) is rejected, a key at the
wrong indentation shows up as an unknown top-level section. That is the point of L02.

## Fault injection is fixture-controlled

`inject.delay_ms`, `inject.fail_rate` and `inject.ready_fail` (config or `/admin/inject`)
make Beacon slow, flaky or unready on purpose. Labs say when a symptom comes from these
knobs rather than from real infrastructure, so you never mistake a fixture for a finding.

## Graceful shutdown

SIGTERM stops accepting connections, finishes in-flight requests and exits 0. In a container
Beacon must be PID 1 or run under an init that forwards signals (L13/L14 check this).
