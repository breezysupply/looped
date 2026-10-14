# Beacon rebuild runbook (L31)

Write this so a colleague with a clean laptop, this repository and nothing else can rebuild the
core Beacon deployment. Replace every bracketed line. Commands must name the context and the
namespace. Keep it true: if a step was not run, say so.

## Scope

[what this runbook rebuilds (API, worker, queue, PostgreSQL, seeded data, RBAC, NetworkPolicy,
telemetry endpoint, SLO rules) and what it does not]

## Prerequisites

[tools and the versions you ran with, the cluster profile, memory/CPU, and how to check each one;
no step may rely on anything an earlier lab left behind]

## Configuration

[every key of release/rebuild.env, the value you chose and why: namespace, cluster, environment,
image, seed size, pinned images]

## Build

[how the image is built from L13's sources, how its ID is recorded and loaded into the nodes]

## Deploy

[the order of objects and why: namespace, secrets, database, queue, worker, RBAC/NetworkPolicy,
chart; how you know each step finished]

## Seed data

[what is seeded, how to check the count and fingerprint]

## Verify

[health, image identity, least privilege (auth can-i matrix), metrics, data; quote real output]

## Backup and restore

[how a backup is taken, restored into a scratch database and proven equal; the measured interval]

## Rollback

[how you decide to roll back, the exact commands, how you prove the previous build is serving,
and what a rollback does NOT undo (data, schema)]

## Teardown

[exactly what is deleted, and what is kept]

## Rebuild proof

[times of: first full build, teardown, second full build from the same checkout; what differed]

## Limits

[what this local rebuild does not prove]
