# L28 — Incident rehearsal: lost primary, a backup shelf to choose from, and the update log

Module M14 · ~150 min practical · profile `compose` (Docker engine + Compose v2, `python3`) · **local only: synthetic data, no cloud**

## Ticket

> **INC-0311.** `beacon-status /ready` returns 503. Field sensors cannot submit and the status
> page is empty. On-call found the `db` container exited and it does not stay up. No change was
> deployed today. You are incident commander and operator: keep a time-stamped update log, decide
> the scope, restore service from the backups on the shelf with the least data loss you can
> defend, prove the restored data is right, and record follow-ups with owners.

`work/TICKET.md` is written when the incident starts and carries the start time.

## Objectives

- `obj-m14-04` produce time-stamped updates, an explicit scope, a defensible recovery-point
  choice and owned follow-ups
- `obj-m14-05` rehearse a backup-based recovery against a clock

## What runs

Compose project `looped-l28` (`work/compose.yaml`):

| Service | What it is |
|---|---|
| `db` (`looped-l28-db`) | the primary: `postgres:16.4` pinned by digest, volume `looped-l28-primary`, one synthetic day (2025-03-11) of records from 20 sensors |
| `api` (`looped-l28-api`) | the status API (`assets/statusapi.py`): `/ready`, `/summary`, `POST /status`, on `127.0.0.1:18028`. Which database it uses is `DB_HOST` in `work/api.env` |
| `restore` (profile `restore`) | an empty server with its own volume `looped-l28-restored`: a candidate new primary |
| `scratch` (profile `scratch`) | an empty throw-away server on tmpfs, for trying a backup before you commit to it |

`work/backups/` holds the day's backups and `CATALOG.json` (what the backup jobs recorded: time,
job, source, sha256, size). Both `restore` and `scratch` mount it read-only at `/backups`.

**Fixture-controlled:** the incident is caused by a script that damages the primary's data
directory inside its own lab volume; what is on the backup shelf is arranged by the variant.
How you discover both is real PostgreSQL and real files.

## Steps and checkpoints

**Checkpoint c1 — roles, scope, first update (week 42, session 1).**

1. `bash labs/sre-cloud-foundations/L28/setup.sh`. The incident starts at the end of setup; the
   clock is real. Read `work/TICKET.md`.
2. Within a few minutes write **Update 1** in `work/incident/updates.md` (template in the file):
   roles, impact, scope (what is and is not affected), what you are doing, and when the next
   update will come (≤ 30 min). Keep every promise you make about the next update.
3. Investigate the primary (`docker logs looped-l28-db`). Decide whether it can be repaired in
   place or must be replaced, and do not destroy it: it is evidence for the postmortem.

**Checkpoint c2 — recovery point, restore, validate, close (week 42, session 2).**

4. Choose a recovery point. For each candidate backup check what the catalog claims against what
   the file actually is (checksum, `pg_restore --list`, a trial restore into `scratch`, the
   newest record it contains). The newest file is not automatically the best one.
5. Restore into `restore`, point the API at it (`DB_HOST=restore`, then
   `docker compose -p looped-l28 -f work/compose.yaml up -d api`), and validate: counts, sensors,
   newest record, a test write.
6. Write the remaining updates: the recovery point and why, the data-loss window, how you
   validated, and a final `Status: resolved`. Add at least two follow-ups with owner and due date
   to `work/incident/followups.md`.
7. `python3 labs/sre-cloud-foundations/L28/validate.py` and import `evidence/latest.json`.

## What you should observe

- A server that cannot find its control file will not start, however many times it is restarted.
- A catalog says what a job *meant* to produce. The file, its checksum and its contents say what
  you actually have; `pg_restore --list` reads only the table of contents and can succeed on a
  file that will not restore.
- Every choice of recovery point is a choice of data-loss window. Say it in numbers.

## What the validator checks

The API answers `/ready` and accepts a write on the database it is configured for; the synthetic
day's records on that database are exactly the content of the valid backup with the least data
loss (count + checksum against an oracle recorded at setup — a partial or mixed restore matches
nothing); the damaged primary's volume still exists; the update log has 3+ updates with UTC
timestamps after the incident started, increasing and ≤ 30 min apart, each with Status, Impact,
Scope and a Next update ≤ 30 min ahead (except the final, resolved one) and roles in the first;
an update names the recovery point actually restored, the data-loss window and the validation;
2+ follow-ups with owners and due dates. The interval from incident start to the resolved update
is reported (advisory).

## Safety and scope

Only Compose project `looped-l28`, its two volumes and network, and `work/` are created or
removed; the damage is done inside the lab's own volume by a container named
`looped-l28-inject`. Ports bind to 127.0.0.1. `reset.sh` copies your incident files to
`.work-previous/`, removes everything and starts a new incident (same variant).
`teardown.sh` removes everything; `evidence/` stays.

## Pause / resume

The clock does not stop: an incident paused overnight shows as a long gap in your log, and the
validator will say so. For a timed rehearsal, run it in one sitting; to practise again, `reset.sh`.

## Lab versus production

- Production recovery usually prefers point-in-time recovery (base backup + WAL archive) or
  promoting a replica; both narrow the data-loss window that dumps leave. The decision process
  — what do we have, what does each option lose, how do we prove it — is the same.
- A real incident has more people; the roles are named here so you practise handing them out.

## Limits — what this lab does not prove

It proves a structured incident record, an evidence-based recovery-point choice among logical
dumps, a restore into a fresh server, validation by count and checksum, and owned follow-ups. It
does not exercise PITR/WAL archiving, replica promotion, cross-region restore, real paging or
stakeholder tooling, and the data-loss oracle exists only because the data is synthetic.
