#!/usr/bin/env bash
# Lab 06 verify:
#  - notify-api rollout complete (updated = ready = available = desired)
#  - no notify-api container is waiting in CrashLoopBackOff / Error
#  - every notify-api container has been running for at least 20s
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
preflight >/dev/null
MIN_UP=20

k get deployment notify-api >/dev/null 2>&1 || { problem "deployment/notify-api does not exist (run inject.sh first)"; report ""; }
IFS='|' read -r gen obs want upd ready avail <<<"$(k get deployment notify-api -o jsonpath='{.metadata.generation}|{.status.observedGeneration}|{.spec.replicas}|{.status.updatedReplicas}|{.status.readyReplicas}|{.status.availableReplicas}')"
[ "${obs:-0}" -ge "${gen:-1}" ] || problem "controller has not observed the latest spec yet"
[ "${want:-0}" -ge 1 ] || problem "notify-api is scaled to ${want:-0}"
[ "${upd:-0}" = "$want" ] && [ "${ready:-0}" = "$want" ] && [ "${avail:-0}" = "$want" ] \
  || problem "rollout not finished: ${upd:-0} updated, ${ready:-0} ready, ${avail:-0} available of ${want:-?}"

prog=$(k get deployment notify-api -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}')
[ "$prog" = NewReplicaSetAvailable ] || problem "Progressing condition reason is '${prog:-none}', expected NewReplicaSetAvailable (rollout not complete)"

while IFS='|' read -r pod waiting started deleting; do
  [ -n "$pod" ] && [ -z "$deleting" ] || continue
  [ -z "$waiting" ] || { problem "$pod is waiting: $waiting"; continue; }
  [ -n "$started" ] || { problem "$pod container is not running"; continue; }
  up=$(age_seconds "$started") || up=0
  [ "$up" -ge "$MIN_UP" ] || problem "$pod has only been running ${up}s; re-run verify.sh in a few seconds"
done <<<"$(k get pods -l app=notify-api -o jsonpath='{range .items[*]}{.metadata.name}|{.status.containerStatuses[0].state.waiting.reason}|{.status.containerStatuses[0].state.running.startedAt}|{.metadata.deletionTimestamp}{"\n"}{end}')"

report "notify-api is fully rolled out and every container has stayed up for ${MIN_UP}s+"
