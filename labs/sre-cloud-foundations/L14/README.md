# L14 — Beacon on Compose: dependencies, persistence, shutdown

Module M07 · ~120 min practical · profile `compose` · project `looped-l14` · runs **on your Mac**

## Ticket

> The Beacon stack (API, worker, PostgreSQL) now runs from one Compose file. On the shared
> lab host it "comes up fine most of the time", but this morning `docker compose ps` showed
> the API gone and nobody could say why. Ops also want two promises in writing before this
> becomes the team's dev environment: records survive the database container being replaced,
> and `docker compose stop` is quick and clean. Find what is wrong with the project as you
> received it, fix it in the Compose file, and prove both promises against the running stack.

## Objectives

- `obj-m07-03` compose services with persistence and readiness: data survives recreation; readiness is checked, not assumed
- `obj-m07-04` handle signals and health checks: graceful SIGTERM, meaningful health checks, PID 1

## The project

`setup.sh` builds `L14/work/` from `starter/`: `compose.yaml`, and `app/` (the L13 image,
solved, plus a copy of Beacon and a hash-checked wheelhouse). One project, fixed name:

| Service | What it is |
|---|---|
| `db` | `postgres:16.4` pinned by digest; data in the named volume `looped-l14_pgdata`; `pg_isready` health check over TCP |
| `api` | `looped-l14-beacon:1.4.0`; stores records in PostgreSQL, enqueues jobs on the shared `queue` volume; published on `127.0.0.1:18014` |
| `worker` | same image, `CMD ["worker"]`; consumes jobs, writes an effects file; `/healthz` on 9101 |

Everything carries `looped.lab/id=L14`; the network is `looped-l14_default`, volumes are
`looped-l14_pgdata` and `looped-l14_queue`. The database password in the file is a lab fixture
and says so. Beacon retries its first database connection ten times with backoff (about 37 s)
and then exits; it does **not** re-open a connection that drops later — its `/ready` turns
503 instead. Both behaviours are deliberate and part of the exercise.

Commands below use `C="docker compose -f labs/sre-cloud-foundations/L14/work/compose.yaml"`.

## What is fixture-controlled

`inject.sh` changes `work/compose.yaml` in one of three ways (`LOOPED_VARIANT=variant-a|variant-b|variant-c`).
One variant also adds a fixture that makes a component slow on purpose; it prints a line
saying so in that component's log. Changing the fixture is not the fix: the validator checks
it is still there.

## Steps and checkpoints

**Checkpoint c1 — bring it up, read the evidence (week 20, session 1).**

1. `profiles/compose/check.sh` → OK. Then `bash labs/sre-cloud-foundations/L14/setup.sh`.
2. Wait a minute (some failures take that long to show), then `$C ps -a`, `$C logs --tail 20 api`,
   `$C logs --tail 20 db`, `curl -sS http://127.0.0.1:18014/ready`. Quote the first thing that
   looks wrong into `evidence/L14-notes.md`.
3. `$C config` shows the file as Compose resolved it. Read `depends_on`, `healthcheck`,
   `volumes` and the environment of each service.

**Checkpoint c2 — diagnose and fix (session 2).**

4. Two hypotheses, one discriminating check. Useful: `$C config --services`,
   `$C run --rm --no-deps --entrypoint python3 api -c "import socket; print(socket.getaddrinfo('db', 5432)[0][4])"`,
   `docker inspect looped-l14-db-1 --format '{{json .Mounts}}'`, `docker inspect looped-l14-db-1 --format '{{json .State.Health}}'`.
5. Make the smallest change to `work/compose.yaml` and apply it with `$C up -d --wait`. If the
   database container has to be replaced, `$C rm -fsv db && $C up -d --wait` (the `-v` removes
   that container's anonymous volume with it, so nothing is left dangling).

**Checkpoint c3 — prove the promises (session 3).**

6. Persistence by hand: `curl -sS -X POST http://127.0.0.1:18014/status -H 'Content-Type: application/json' -H 'Idempotency-Key: me-1' -d '{"sensor_id":"me-1","status":"ok"}'`;
   `$C rm -fsv db && $C up -d --wait`; `curl -sS http://127.0.0.1:18014/status/me-1`.
7. Shutdown by hand: `time $C stop api`; `docker inspect looped-l14-api-1 --format '{{.State.ExitCode}}'`;
   `$C start api`. Explain the number in your notes (what would 10 s and exit 137 mean?).
8. `python3 labs/sre-cloud-foundations/L14/validate.py --explanation-file labs/sre-cloud-foundations/L14/evidence/L14-notes.md`
   and paste `evidence/latest.json` into the app.

## Validation (what `validate.py` measures, and what it changes)

Configuration: services api/worker/db; postgres pinned to 16.x; db has a health check and api
waits for `service_healthy`. Runtime: all three running and labelled; db healthy; the store
host in api's URL resolves on the project network; `/ready` is 200 on PostgreSQL; a job is
processed by the worker; db's data directory is the **named** volume. Then it **mutates the
project**: writes a record, replaces the db container (`rm -fsv db`, `up --wait db`),
recreates api, reads the record back; stops api and worker with `docker stop --time 10`
(must finish in under 8 s with exit code 0) and starts them again; scans logs for the fixture
password. It never touches anything outside `looped-l14`. Expect 20 s on a healthy stack and
up to 3 minutes when something is wrong.

## Reset and data

`reset.sh` = `docker compose down` (containers and network) + fresh `work/` + same variant.
**Volumes are kept** unless you ask: `LOOPED_RESET_DATA=1 bash reset.sh`. `teardown.sh` stops
and removes the project and the L14 image; volumes again only with `LOOPED_RESET_DATA=1`.

## Lab versus production

- Compose runs on one host. `depends_on` ordering does not exist across hosts or in Kubernetes
  (L15/L16 use readiness probes and retries instead); the habit — check readiness, never assume
  order — carries over.
- A named volume on one disk is not a backup and not durability across machines (L24).
- The database password sits in the Compose file because it is a fake; real deployments
  inject secrets at run time and rotate them (L25).

## Limits

This lab proves dependency readiness, persistence across container replacement and graceful
shutdown for one Compose project on one engine. It does **not** prove backup/restore, data
durability beyond one local volume, connection-pool behaviour under load, or high
availability. The late-start fixture is a `sleep`, not a real slow disk.

## References

- T16 Docker Compose documentation (depends_on conditions, healthcheck, volumes, stop_grace_period) · T09 PostgreSQL backup and restore (read ahead to L24)
