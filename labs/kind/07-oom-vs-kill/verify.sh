#!/usr/bin/env bash
# Lab 07 verify:
#  - thumbnailer and transcoder: all replicas Ready, containers up >= 60s
#  - thumbnailer: the CURRENT container has completed at least one batch
#  - transcoder: still has a livenessProbe (health checking kept)
#  Notes (not failures): whether transcoder's memory limit was changed.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
preflight >/dev/null
MIN_UP=60

for d in thumbnailer transcoder; do
  if ! k get deployment "$d" >/dev/null 2>&1; then problem "deployment/$d does not exist (run inject.sh first)"; continue; fi
  IFS='|' read -r want ready upd <<<"$(k get deployment "$d" -o jsonpath='{.spec.replicas}|{.status.readyReplicas}|{.status.updatedReplicas}')"
  [ "${ready:-0}" = "${want:-x}" ] && [ "${upd:-0}" = "$want" ] || problem "$d has ${ready:-0}/${want:-?} ready replicas (${upd:-0} updated)"
  while IFS='|' read -r pod started deleting last; do
    [ -n "$pod" ] && [ -z "$deleting" ] || continue
    if [ -z "$started" ]; then problem "$pod: container is not running${last:+ (last termination: $last)}"; continue; fi
    up=$(age_seconds "$started") || up=0
    [ "$up" -ge "$MIN_UP" ] || problem "$pod: container has only been running ${up}s (need ${MIN_UP}s)${last:+; last termination: $last}; re-run verify.sh shortly"
    if [ "$d" = thumbnailer ]; then
      k logs "$pod" 2>/dev/null | grep -q 'batch [0-9]* complete' || problem "$pod: no batch has completed in the current container yet"
    fi
  done <<<"$(k get pods -l "app=$d" -o jsonpath='{range .items[*]}{.metadata.name}|{.status.containerStatuses[0].state.running.startedAt}|{.metadata.deletionTimestamp}|{.status.containerStatuses[0].lastState.terminated.reason}/{.status.containerStatuses[0].lastState.terminated.exitCode}{"\n"}{end}' | sed 's#|/$#|#')"
done

if k get deployment transcoder >/dev/null 2>&1; then
  [ -n "$(k get deployment transcoder -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}')" ] \
    || problem "transcoder has no livenessProbe any more (fix the probe timing rather than removing it)"
  lim=$(k get deployment transcoder -o jsonpath='{.spec.template.spec.containers[0].resources.limits.memory}')
  [ "$lim" = 64Mi ] || say "NOTE: transcoder memory limit is now ${lim:-unset} (was 64Mi); memory was not what killed it"
fi

report "thumbnailer completes batches and both workloads have stayed up for ${MIN_UP}s+"
