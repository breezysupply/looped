# Beacon rebuild runbook (L31) — authoring sample

## Scope

Rebuilds the core Beacon deployment in namespace beacon-capstone on the local kind cluster
looped-foundations: API (L19 chart), worker, Redis queue, PostgreSQL with seeded synthetic data,
L18 RBAC and NetworkPolicies, the /metrics endpoint and the SLO rules. No cloud resource, no
ingress controller, no Prometheus server inside the cluster.

## Prerequisites

Docker running, kind v0.29.0, kubectl v1.33.x, helm v3.18.x, python3 3.9+. The cluster comes from
profiles/kind-basic/setup.sh (pinned node image). Nothing from an earlier lab's work/ directory
is used: `bash labs/sre-cloud-foundations/L31/rebuild.sh check` proves that before anything runs.

## Configuration

release/rebuild.env: NAMESPACE=beacon-capstone (new, not the shared beacon), CLUSTER
looped-foundations, ENVIRONMENT staging (2 API replicas), IMAGE looped-l31-beacon:1.4.0 built
here, DB secret generated, SEED_RECORDS=240, PostgreSQL and Redis pinned by digest.

## Build

`bash labs/sre-cloud-foundations/L31/rebuild.sh image` assembles L13's starter context plus the
Beacon package and hash-pinned wheels, builds it, records the image ID in work/release.json and
loads it into every node with kind load.

## Deploy

`rebuild.sh deploy`: namespace (restricted Pod Security), generated secrets, service accounts
without tokens, PostgreSQL, Redis, worker, L18 Role/RoleBinding and NetworkPolicies re-namespaced,
then helm upgrade --install of L19's chart with the post-renderer; each rollout status must finish.

## Seed data

`rebuild.sh seed` runs assets/seed.sql: 240 records; the fingerprint is count plus md5 over ids
and statuses and must equal what capstone.py computes without a database.

## Verify

`rebuild.sh verify`: workloads ready, /ready 200, /version 1.4.0, a record written and read
back, nodes hold the recorded image ID, the deployer may patch deployments and read logs but not
delete, read secrets or exec, no pod mounts a token, /metrics exports what the SLO rules use.

## Backup and restore

`rebuild.sh backup` takes pg_dump -Fc into work/backups; `rebuild.sh restore-drill` restores it
into beacon_restore, compares with L24's verify_restore.py (rows, checksums, samples, sequences),
drops the scratch database and prints the interval.

## Rollback

`rebuild.sh rollback-drill` upgrades with a 250 ms injected delay, then helm rollback to the
previous revision; proof: helm history shows the rollback and /version and latency are back.
A rollback restores the Deployment, not data or schema.

## Teardown

`rebuild.sh down` uninstalls the release and deletes only namespace beacon-capstone after
checking its looped.lab/id=L31 label. The cluster and other namespaces are untouched.

## Rebuild proof

`rebuild.sh proof` = down then all; work/proof/runs.jsonl records all, down, all with times.
In the authoring environment this was NOT run: kind clusters cannot start there.

## Limits

Local kind: no cloud identity, load balancer, zones or managed control plane; NetworkPolicy is not
enforced on kind-basic; one PostgreSQL replica on local-path storage proves nothing about durability.
