#!/usr/bin/env bash
# Lab 04 verify:
#  - both Deployments still have readiness AND liveness probes (health checking kept)
#  - search-api: every replica Ready, and the Service has that many ready endpoints
#  - search-indexer: every replica Ready, and each container has stayed up for
#    at least 60s (far longer than the ~10s the old liveness settings allowed)
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
preflight >/dev/null
MIN_UP=60

for d in search-api search-indexer; do
  if ! k get deployment "$d" >/dev/null 2>&1; then problem "deployment/$d does not exist (run inject.sh first)"; continue; fi
  probes=$(k get deployment "$d" -o jsonpath='{range .spec.template.spec.containers[*]}{.name}:{.readinessProbe.periodSeconds}:{.livenessProbe.periodSeconds}{"\n"}{end}')
  while IFS=: read -r c r l; do
    [ -n "$c" ] || continue
    [ -n "$r" ] || problem "$d container $c has no readinessProbe (the ticket says keep health checking)"
    [ -n "$l" ] || problem "$d container $c has no livenessProbe (the ticket says keep health checking)"
  done <<<"$probes"
  IFS='|' read -r want ready upd <<<"$(k get deployment "$d" -o jsonpath='{.spec.replicas}|{.status.readyReplicas}|{.status.updatedReplicas}')"
  [ "${ready:-0}" = "${want:-x}" ] && [ "${upd:-0}" = "$want" ] || problem "$d has ${ready:-0}/${want:-?} ready replicas (${upd:-0} updated)"
done

eps=$(ready_endpoints search-api)
want=$(k get deployment search-api -o jsonpath='{.spec.replicas}' 2>/dev/null)
[ "$eps" = "${want:-x}" ] || problem "Service search-api has $eps ready endpoint(s), expected ${want:-?}"

while IFS='|' read -r pod started ready deleting; do
  [ -n "$pod" ] || continue
  [ -z "$deleting" ] || continue
  if [ -z "$started" ]; then problem "$pod: container is not running"; continue; fi
  up=$(age_seconds "$started") || up=0
  [ "$up" -ge "$MIN_UP" ] || problem "$pod: container has only been running ${up}s (need ${MIN_UP}s to show it survives its liveness probe); re-run verify.sh shortly"
  [ "$ready" = true ] || problem "$pod: container not Ready"
done <<<"$(k get pods -l app=search-indexer -o jsonpath='{range .items[*]}{.metadata.name}|{.status.containerStatuses[0].state.running.startedAt}|{.status.containerStatuses[0].ready}|{.metadata.deletionTimestamp}{"\n"}{end}')"

report "search-api is Ready behind its Service and search-indexer has stayed up for ${MIN_UP}s+, with readiness and liveness probes still in place"
