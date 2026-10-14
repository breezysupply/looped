# L31 — Rebuild Beacon from checked-in artifacts, then prove you can do it again

Module M16 · ~210 min across week 46 (three checkpoints) · profiles **`kind-basic`** (or
`kind-policy`), **`compose`** (Docker for the image and promtool) and **`observability`**
(optional, for the dashboard) · **local only**

## Ticket

> A colleague wrote a draft release configuration for rebuilding the core Beacon deployment in a
> new namespace (`release/rebuild.env`) and said "it works on my cluster". Before anyone relies
> on it, rebuild the deployment from this repository alone — the L13 image recipe, the L19 chart,
> L18's RBAC and NetworkPolicies, a PostgreSQL with seeded data, a Redis queue and worker,
> L22's SLO rules, L21's dashboard and L24's restore verifier — with no step that only works
> because an earlier lab left something behind. Write the runbook, demonstrate a verified
> restore and a rollback, tear it all down and build it again.

## Objectives

- `obj-m16-01` rebuild the full Beacon deployment from checked-in assets with least privilege,
  health, telemetry, seeded data and documented rollback, with no hidden prerequisite

## What is reused, and what is new

| Reused (by reference, never edited) | Role in the rebuild |
|---|---|
| `L13/starter/` (Dockerfile, hash-pinned lock, `.dockerignore`, config) + `beacon/` | image recipe; built as `looped-l31-beacon:1.4.0`, its image ID recorded |
| `L19/chart/` (chart 0.4.0, schema, env values) | the API release, installed unchanged |
| `L18/manifests/20-rbac.yaml`, `30-netpol.yaml` | deploy-bot Role/RoleBinding and default-deny segmentation, re-namespaced on the fly |
| `L24/assets/verify_restore.py` (+ `pgmini.py`) | restore proof: counts, checksums, samples, sequences |
| `L22` SLO rules and tests, `L21` dashboard | copied into your bundle by `setup.sh` (yours if present, else the course reference — `release/PROVENANCE.md` says which) |

New in this lab: `rebuild.sh` (the orchestrator), `assets/manifests/` (namespace, service
accounts, PostgreSQL StatefulSet, Redis, worker, NetworkPolicies for queue and worker),
`assets/postrender.py` (a Helm post-renderer that wires the chart's API to PostgreSQL and Redis
through four environment variables, because the L19 chart and its strict schema have no
database settings), `assets/seed.sql` and `assets/capstone.py` (configuration, dry check and
live checks shared by `rebuild.sh` and the validator).

**Your bundle is `release/`** — checked in, not ignored: `rebuild.env` (the only input
`rebuild.sh` reads; unknown keys and unknown `L31_*` variables are refused), `REBUILD.md` (your
runbook), `slo/`, `dashboard.json`, `PROVENANCE.md`.

## What is fixture-controlled

`inject.sh` writes the colleague's `release/rebuild.env` for `LOOPED_VARIANT=variant-a|b|c`:
each variant uses a **new namespace, cluster and configuration values** (staging on the core
cluster; prod on the policy cluster; dev with a larger seed) and each carries **one hidden
prerequisite** — something that works only on the colleague's machine. Separately, the reused
telemetry was written against L21's and L22's own fixtures; whether it fits the build you ship
is for you to check.

## Steps and checkpoints

**c1 — rebuild from documentation (session 1).**

1. `bash labs/sre-cloud-foundations/L31/setup.sh` (files only), then
   `bash labs/sre-cloud-foundations/L31/rebuild.sh check` — the fresh-checkout dry check. It
   needs no cluster. Read every FAIL and fix `release/` (not the shipped assets) until it passes.
2. Draft `release/REBUILD.md` from the template before running anything else.

**c2 — deploy and observe (session 2).**

3. Start the cluster the config names (`profiles/kind-basic/setup.sh`, or `kind-policy` for
   `looped-policy`), then `rebuild.sh image`, `deploy`, `seed`, `verify`. Quote real output in
   the runbook. `rebuild.sh slo` runs promtool on your rules and tests.

**c3 — seed, verify, document (session 3).**

4. `rebuild.sh backup` and `restore-drill` (measured), `rollback-drill`.
5. `rebuild.sh proof` (down, then all) at least once after a successful `all`; fill
   **Rebuild proof** with the timings from `work/proof/runs.jsonl`.
6. `python3 labs/sre-cloud-foundations/L31/validate.py --explanation-file labs/sre-cloud-foundations/L31/release/REBUILD.md`
   and import `evidence/latest.json`.

## How validation works

Static (no cluster): the dry check here; the **same check in a temporary copy of only the
non-ignored files with an empty environment** (a fresh clone: anything in a `work/` directory
or set in your shell is gone); a run with an unknown `L31_*` variable must be refused; the
runbook's twelve sections; promtool on your SLO files. Live (cluster required): namespace owned
by L31, every workload ready, `/ready` 200, `/version` = your tag, a record written and read
back, every node holding the recorded image ID, an `auth can-i` matrix for `beacon-deployer`
(may patch deployments and read logs; may not delete, read secrets, exec, bind roles or touch
namespace `beacon`), no pod with an API token, all NetworkPolicies present, the seed fingerprint,
`/metrics` exporting every metric your rules and dashboard use, and a rollback in Helm history.
Proof files: a `verify_restore.py` report that says ok and an `all → down → all` sequence.

## Safety and scope

`rebuild.sh` runs `require_kind_context` before every cluster step, names `--context` and `-n`
on every command, refuses a namespace it did not label `looped.lab/id=L31`, and `down` deletes
only that namespace. The database password is generated into `work/.secrets/` (a
`lab-l31-…-not-a-real-secret` placeholder) and reaches pods only through Secrets.

## Reset and teardown

`reset.sh`: `rebuild.sh down` (if the cluster is up), the colleague's `rebuild.env` back for the
same variant, `work/proof` moved to `work/proof.prev`. `teardown.sh`: down, the L31 image, and
`work/`; `release/` and `evidence/` stay. Clusters belong to their profiles' teardown.

## Lab versus production

A real rebuild would pull by registry digest from a signed release (L20, L26), run behind an
ingress, scrape with a Prometheus server and alert through Alertmanager, and restore from
off-cluster backups. Here the image is built locally and identified by its image ID, metrics
are read through a port-forward, and backups live in `work/`.

## Limits — what this lab does not prove

It proves the core deployment can be rebuilt from checked-in artifacts by a script that refuses
hidden prerequisites, and — on a cluster — that it is healthy, least-privileged, seeded,
observable, restorable and reversible. On `kind-basic` NetworkPolicy objects are accepted but
**not enforced**; enforcement needs `looped-policy`. One PostgreSQL on local-path storage proves
nothing about durability or zones. Nothing here is cloud identity, a managed control plane or a
production SLO.

## References

- T13 Helm · T04 kind · T05 NetworkPolicy · T09 PostgreSQL backup and restore · T14 Prometheus rule tests · T01 SRE Workbook
