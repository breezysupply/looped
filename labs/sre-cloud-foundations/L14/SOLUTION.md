# L14 worked solution

`C="docker compose -f labs/sre-cloud-foundations/L14/work/compose.yaml"`

## Variant A — the API looks for a host that is not on the network

Observation (after ~40 s): `$C ps -a` → `api … Exited (1)`; `$C logs api` →
`FATAL: postgres connect failed after 10 attempts: [Errno -2] Name or service not known`.
`db` is healthy the whole time, so "the database is slow" is ruled out by evidence, not taste.

Discriminate: `$C config --services` → `api db worker`. The store URL (read it with
`$C config | grep STORE_URL`; do not paste the password into notes) names host `postgres`.
`$C run --rm --no-deps --entrypoint python3 api -c "import socket; socket.getaddrinfo('postgres', 5432)"`
→ `gaierror`, while the same probe for `db` returns an address. Compose's embedded DNS answers
**service names** (and aliases), not image names.

Fix: `@postgres:5432` → `@db:5432` in `x-beacon-env`, then `$C up -d --wait`.

## Variant B — started is not ready

Observation: the api exits after ~37 s with `connection … port 5432 failed: Connection refused`;
`$C logs db` begins with the fixture line, and PostgreSQL reports `ready to accept connections`
about 45 s after start. `$C config` shows `db` has **no** healthcheck and api's
`depends_on.db.condition` is `service_started`: Compose started the api as soon as the db
*container* started, and the api's bounded retry ran out first.

Fix (keep the fixture): give `db` its health check back and wait for it:

```yaml
    healthcheck:
      test: ["CMD", "pg_isready", "-h", "127.0.0.1", "-U", "beacon", "-d", "beacon"]
      interval: 2s
      timeout: 3s
      retries: 15
      start_period: 90s
  ...
  api:
    depends_on:
      db:
        condition: service_healthy
        restart: true
```

`$C up -d --wait` now takes ~50 s and ends with all three healthy. Why `-h 127.0.0.1`: on first
initialisation the postgres image runs a temporary server on the Unix socket only; a socket
check can say "ready" before the real server listens on TCP.

Rejected: `$C start api` once the db is up (works until the next restart; `readiness-gated`
fails); a `sleep 60` before the api starts (order by guesswork, and a shell becomes PID 1, so
SIGTERM stops working — `graceful-stop` fails); removing the fixture (`fixture-kept` fails).

## Variant C — the data is not where the volume is

Observation: everything is green, but the persistence test loses the record: write `me-1`,
`$C rm -fsv db && $C up -d --wait`, read `me-1` → `"records": []`.
`docker inspect looped-l14-db-1 --format '{{json .Mounts}}'` shows two mounts: the named volume
`looped-l14_pgdata` at `/var/lib/postgres/data` (a path PostgreSQL never uses) and an
**anonymous** volume at `/var/lib/postgresql/data` (created from the image's `VOLUME`), which is
where `PGDATA` points. Replacing the container gives it a new anonymous volume.

Fix: `- pgdata:/var/lib/postgresql/data`, then `$C rm -fsv db && $C up -d --wait` (`-v` removes
the old anonymous volume with its container, so nothing dangles). Records written before the fix
lived in that anonymous volume and are gone; say so in your notes rather than claiming recovery.

## Proving the promises

```
$C ps                                           # api, worker, db: Up (healthy)
curl -sS http://127.0.0.1:18014/ready           # {"ready": true, "store": "postgres", "queue": "dir"}
time $C stop api                                # well under 1 s; exit code 0
docker inspect looped-l14-api-1 --format '{{.State.ExitCode}}'   # 0
python3 labs/sre-cloud-foundations/L14/validate.py              # PASS L14: 12/12 (13/13 in variant-b)
```

Exec-form `ENTRYPOINT` makes Python PID 1; Beacon's SIGTERM handler finishes in-flight requests
and exits 0. With a shell-form entrypoint the shell is PID 1, ignores SIGTERM, and Docker kills
the process with SIGKILL after the grace period: 10 s and exit code 137.
