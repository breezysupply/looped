#!/usr/bin/env bash
# Lab 05 verify:
#  - report-builder rollout complete (updated = ready = available = desired)
#  - no report-builder pod is Pending
#  - every container's memory request fits the allocatable memory of a
#    pool=general node, and the pods still run on the general pool
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
preflight >/dev/null

k get deployment report-builder >/dev/null 2>&1 || { problem "deployment/report-builder does not exist (run inject.sh first)"; report ""; }

IFS='|' read -r gen obs want upd ready avail <<<"$(k get deployment report-builder -o jsonpath='{.metadata.generation}|{.status.observedGeneration}|{.spec.replicas}|{.status.updatedReplicas}|{.status.readyReplicas}|{.status.availableReplicas}')"
[ "${obs:-0}" -ge "${gen:-1}" ] || problem "controller has not observed the latest spec yet"
[ "${want:-0}" -ge 1 ] || problem "report-builder is scaled to ${want:-0}"
[ "${upd:-0}" = "$want" ] && [ "${ready:-0}" = "$want" ] && [ "${avail:-0}" = "$want" ] \
  || problem "rollout not finished: ${upd:-0} updated, ${ready:-0} ready, ${avail:-0} available of ${want:-?}"

prog=$(k get deployment report-builder -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}')
[ "$prog" = NewReplicaSetAvailable ] || problem "Progressing condition reason is '${prog:-none}', expected NewReplicaSetAvailable (rollout not complete)"

pending=$(k get pods -l app=report-builder --field-selector=status.phase=Pending -o name)
[ -z "$pending" ] || problem "still Pending: $(printf '%s' "$pending" | tr '\n' ' ')"

# Memory request vs the largest allocatable memory on the general pool, in Ki.
to_ki() {
  local v="$1"
  case "$v" in
    *Ki) echo "${v%Ki}" ;; *Mi) echo $(( ${v%Mi} * 1024 )) ;; *Gi) echo $(( ${v%Gi} * 1048576 )) ;;
    *Ti) echo $(( ${v%Ti} * 1073741824 )) ;; *k) echo $(( ${v%k} * 1000 / 1024 )) ;;
    *M) echo $(( ${v%M} * 1000000 / 1024 )) ;; *G) echo $(( ${v%G} * 1000000000 / 1024 )) ;;
    ''|*[!0-9]*) echo -1 ;; *) echo $(( v / 1024 )) ;;
  esac
}
alloc=0
for a in $(kc get nodes -l pool=general -o jsonpath='{.items[*].status.allocatable.memory}'); do
  ki=$(to_ki "$a"); [ "$ki" -gt "$alloc" ] && alloc=$ki
done
[ "$alloc" -gt 0 ] || problem "no node labelled pool=general found"
for r in $(k get deployment report-builder -o jsonpath='{.spec.template.spec.containers[*].resources.requests.memory}'); do
  ki=$(to_ki "$r")
  [ "$ki" -ge 0 ] && [ "$ki" -le "$alloc" ] || problem "memory request $r does not fit any pool=general node (largest allocatable $((alloc / 1024))Mi)"
done
sel=$(k get deployment report-builder -o jsonpath='{.spec.template.spec.nodeSelector.pool}')
[ "$sel" = general ] || problem "pod template no longer selects pool=general (the ticket asks you to stay on the general pool)"

report "report-builder is rolled out on the general pool with a memory request that fits the node"
