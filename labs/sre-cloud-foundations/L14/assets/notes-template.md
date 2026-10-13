# L14 notes — Beacon on Compose: dependencies, persistence, shutdown

## The project as you found it
<!-- docker compose ps output, and the first log line that looked wrong (quoted) -->

## Observation
<!-- exact symptom, command and output -->

## Hypotheses
- H1:
- H2:

## Discriminating check
<!-- the one command that separates them, and what it printed -->

## Result
<!-- the smallest change to work/compose.yaml, and how you proved it (ps, /ready, a record that survived replacement) -->

## Startup order versus readiness
<!-- why "started" is not "ready", and what depends_on: condition: service_healthy actually waits for -->

## Shutdown
<!-- how long `docker compose stop api` took, the exit code, and why PID 1 matters -->
