# L12 — Terraform against real (local) containers: drift, import, replacement, modules

Module M06 · ~120 min practical · profile `compose` (Docker engine + Terraform) · **local only: no cloud, no cost**

## Ticket

> Beacon's dev deployment on the shared lab engine is managed by a flat Terraform root
> (`envs/dev`) using the `kreuzwerker/docker` provider: a network, a data volume holding the
> sqlite records, the pinned base image and the API container. Two things are due this week:
> a ticket in `work/TICKET.md` (one of three kinds, chosen at setup), and the refactor the team
> agreed on — extract a reusable `modules/beacon` and stand up `staging` from it with **its own
> state**. Dev's records must survive all of it.

## Objectives

- `obj-m06-02` read a plan and predict creates, in-place updates and replacements, with the
  data consequence of each
- `obj-m06-03` detect out-of-band drift, import a supported resource and reach a no-change plan
  without losing intended data
- `obj-m06-05` extract a reusable module and separate environment states

## Safety and scope

- Every Docker object is named `looped-l12-<env>-*` and labelled `looped.lab/id=L12`. Scripts
  refuse to remove anything else, never prune, and keep the shared base image
  (`keep_locally = true`). Published ports are bound to **127.0.0.1** only (18412 dev,
  18413 staging, 18400–18499 reserved).
- State is local: `work/envs/dev/terraform.tfstate` and `work/envs/staging/terraform.tfstate`.
  There is no backend block and `require_terraform_dir` refuses one. A team would keep each
  environment's state in its own remote key; for S3 that is `use_lockfile = true` for locking
  (DynamoDB-based locking is deprecated).
- Image: `python:3.12.7-slim-bookworm` pinned by tag **and** digest; Beacon's code is
  bind-mounted read-only, so nothing is built. On Apple Silicon the digest is a multi-arch index
  and resolves to arm64.
- Pinned: Terraform ≥ 1.9 (tested 1.13.3), `kreuzwerker/docker` 4.6.0 via the committed
  `.terraform.lock.hcl` (hashes for darwin/linux, arm64/amd64).

## What is fixture-controlled

`setup.sh` applies the flat dev root, writes one seed record (sensor `l12-seed`) into the data
volume and records the volume's creation time. `inject.sh` then does one of three things
(`LOOPED_VARIANT=variant-a|variant-b|variant-c`): an out-of-band change by hand, an existing
hand-made container with its own volume that must come under Terraform, or an approved change
request whose plan contains a forced replacement. `work/TICKET.md` tells you what was reported,
not why.

## Steps and checkpoints

**Checkpoint c1 — the ticket (week 17, session 2).**

1. `bash labs/sre-cloud-foundations/L12/setup.sh` (Docker must be running; DOCKER_HOST is taken
   from `docker context` if unset).
2. Read `work/TICKET.md`. `terraform -chdir=labs/sre-cloud-foundations/L12/work/envs/dev state list`,
   `docker ps --filter label=looped.lab/id=L12`, `docker volume inspect looped-l12-dev-data`.
3. Write your **Prediction** in `evidence/L12-plan-notes.md`, then `terraform plan`. For every
   `must be replaced`, find the `# forces replacement` attribute and write down what data lives
   in that object.
4. Resolve the ticket. Import only what imports cleanly or what you are willing to see replaced;
   never apply a plan that replaces the data volume. End with `terraform plan` = no changes.

**Checkpoint c2 — module and environments (week 17, session 3).**

5. Move network, data volume, image and container into `work/modules/beacon/` (see the README
   there). Add `lifecycle { prevent_destroy = true }` to the data volume.
6. Call the module from `envs/dev` and add `moved` blocks so the plan shows only
   `has moved to` lines (0 to add, 0 to change, 0 to destroy). `terraform init` first: modules
   need it.
7. Create `envs/staging` as a second root with its own `versions.tf`, a copy of the lockfile,
   `env = "staging"`, `api_port = 18413`; init and apply there. Its state never sees dev's
   objects.
8. `python3 labs/sre-cloud-foundations/L12/validate.py --explanation-file labs/sre-cloud-foundations/L12/evidence/L12-plan-notes.md`
   and import `evidence/latest.json`.

## What you should observe

- A plan line such as `# docker_container.api has been deleted` followed by `will be created`
  is drift found by the refresh, not a configuration change.
- Importing a `docker_volume` gives a clean plan; importing a `docker_container` with this
  provider version gives `must be replaced` (the import leaves env, ports, labels and mounts
  unset). That is why state that matters lives in volumes.
- Changing a volume's labels **forces replacement of the volume** — the data inside goes with
  it. Changing a container's port forces replacement of the container, which is harmless here.
- After the module move: `module.beacon.docker_volume.data` with the **same** creation time.

## What the validator checks

Scope (labelled objects are `looped-l12-*`); two local states with different lineage; the docker
provider pinned in both roots; module extraction visible in code and in state; `prevent_destroy`
on the module's volume; no-change plans in dev and staging; every `looped-l12-*` container
running and tracked; `/healthz` on both loopback ports; the seed record still served; the data
volume never replaced; the variant's outcome; your notes. Applying a plan that replaces the data
volume fails `data-preserved` and `volume-kept` — the unsafe shortcut is detected, not trusted.

## Rubric for the notes (self or mentor)

- Each prediction was written before the plan and compared honestly with it.
- Every replacement names its forcing attribute and the data at risk.
- Drift handling says which side (code or reality) was made to match, and why.
- Import notes say which resource types imported cleanly and what was accepted.

## Pause / resume

Containers keep running between sessions; `docker start` them after a reboot (the restart
policy is `no` on purpose, so drift stays visible). `setup.sh` reuses `work/`. `reset.sh` runs
`teardown.sh`, keeps your `.tf` files in `.work-previous/` and sets up the same variant again.
`teardown.sh` destroys both roots (working around `prevent_destroy` by dropping the volume from
state and removing it by exact name) and removes every remaining `looped-l12-*` object.

## Lab versus production

- The provider, plan symbols, `moved`, `import` and `prevent_destroy` behave the same with
  cloud providers; a forced replacement of a database or bucket is the same plan line with a
  much larger blast radius.
- Separate states per environment are directories here; in a team they are separate backend
  keys (or separate accounts) with locking, and promotion is a reviewed change applied first to
  the lower environment.

## Limits — what this lab does not prove

It proves plan reading, drift handling, import of supported resources, `moved`-based refactoring,
data protection and per-environment state on a local Docker engine. It does not prove remote
backends, concurrent locking, provider credentials or cloud resource semantics; a local volume
says nothing about multi-AZ durability.

## References

- T17 Terraform language documentation (import, moved, lifecycle, modules) · T03 Terraform S3 backend (use_lockfile) · T16 Docker Compose documentation (engine objects and volumes)
