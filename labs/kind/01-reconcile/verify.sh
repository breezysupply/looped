#!/usr/bin/env bash
# Lab 01 verify: checks the cluster state, not what you typed.
#  - catalog: Deployment wants 3, has 3 ready and available, every catalog pod owned by a ReplicaSet
#  - catalog-debug toolbox (label app=catalog-debug) is Ready AND owned by a controller,
#    so deleting it again would not lose it
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
preflight >/dev/null

if ! k get deployment catalog >/dev/null 2>&1; then
  problem "deployment/catalog does not exist (run inject.sh first)"
else
  IFS='|' read -r want ready avail <<<"$(k get deployment catalog -o jsonpath='{.spec.replicas}|{.status.readyReplicas}|{.status.availableReplicas}')"
  [ "${want:-0}" = 3 ] || problem "deployment/catalog spec.replicas is ${want:-?}, expected 3 (capacity was never meant to change)"
  [ "${ready:-0}" = 3 ] && [ "${avail:-0}" = 3 ] || problem "catalog has ${ready:-0} ready / ${avail:-0} available replicas, expected 3"
  unowned=$(k get pods -l app=catalog -o jsonpath='{range .items[*]}{.metadata.name}={.metadata.ownerReferences[0].kind}{"\n"}{end}' | grep -v '=ReplicaSet$' | grep -c . || true)
  [ "$unowned" = 0 ] || problem "$unowned pod(s) labelled app=catalog are not owned by a ReplicaSet"
fi

dbg=$(k get pods -l app=catalog-debug -o jsonpath='{range .items[*]}{.metadata.name}|{.metadata.ownerReferences[0].kind}|{.status.conditions[?(@.type=="Ready")].status}|{.metadata.deletionTimestamp}{"\n"}{end}' 2>/dev/null)
if [ -z "$dbg" ]; then
  problem "no pod labelled app=catalog-debug exists: the debug toolbox is still gone"
else
  ok_pods=0; notes=""
  while IFS='|' read -r name owner ready deleting; do
    [ -n "$name" ] || continue
    if [ -n "$deleting" ]; then notes="$notes $name(terminating)"; continue; fi
    if [ -z "$owner" ]; then notes="$notes $name(Ready=$ready, no owner: a bare pod is not recreated if deleted)"; continue; fi
    if [ "$ready" != True ]; then notes="$notes $name(owned by $owner, not Ready yet)"; continue; fi
    ok_pods=$((ok_pods + 1))
  done <<<"$dbg"
  [ "$ok_pods" -ge 1 ] || problem "catalog-debug toolbox is not both Ready and controller-owned:$notes"
fi

report "catalog has 3/3 ready replicas owned by its ReplicaSet, and the catalog-debug toolbox is Ready and controller-managed"
