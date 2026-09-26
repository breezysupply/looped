#!/usr/bin/env bash
# Lab 08 verify:
#  - claim ledger-data is Bound, through a StorageClass that exists here
#  - ledger-db is 1/1 Ready (its readiness needs the file it wrote under /data)
#    and its pod mounts claim ledger-data
#  - ledger-scratch is the ORIGINAL claim (same UID) and was not bound by anyone
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
preflight >/dev/null

if ! k get pvc ledger-data >/dev/null 2>&1; then
  problem "claim ledger-data does not exist"
else
  IFS='|' read -r phase sc <<<"$(k get pvc ledger-data -o jsonpath='{.status.phase}|{.spec.storageClassName}')"
  [ "$phase" = Bound ] || problem "claim ledger-data is ${phase:-unknown}, not Bound"
  if [ -n "$sc" ]; then
    kc get storageclass "$sc" >/dev/null 2>&1 || problem "claim ledger-data uses StorageClass '$sc', which does not exist in this cluster"
  fi
fi

if ! k get deployment ledger-db >/dev/null 2>&1; then
  problem "deployment/ledger-db does not exist (run inject.sh first)"
else
  IFS='|' read -r want ready <<<"$(k get deployment ledger-db -o jsonpath='{.spec.replicas}|{.status.readyReplicas}')"
  [ "${want:-0}" -ge 1 ] || problem "ledger-db is scaled to ${want:-0}"
  [ "${ready:-0}" = "${want:-x}" ] || problem "ledger-db has ${ready:-0}/${want:-?} ready replicas"
  claims=$(k get pods -l app=ledger-db -o jsonpath='{range .items[*]}{.spec.volumes[*].persistentVolumeClaim.claimName}{"\n"}{end}' | sort -u)
  [ "$claims" = ledger-data ] || problem "ledger-db pods mount claim(s) '$(printf '%s' "$claims" | tr '\n' ' ')', expected ledger-data"
fi

orig=$(k get configmap lab08-state -o jsonpath='{.data.ledger-scratch-uid}' 2>/dev/null)
if ! k get pvc ledger-scratch >/dev/null 2>&1; then
  problem "claim ledger-scratch is gone (it belongs to another team's batch job)"
else
  IFS='|' read -r uid sphase <<<"$(k get pvc ledger-scratch -o jsonpath='{.metadata.uid}|{.status.phase}')"
  [ -z "$orig" ] || [ "$uid" = "$orig" ] || problem "ledger-scratch was deleted and recreated (UID changed); it belongs to another team's batch job"
  [ "$sphase" = Pending ] || problem "ledger-scratch is $sphase; nothing in this lab should have consumed it"
fi

report "ledger-data is Bound, ledger-db is Ready on it, and ledger-scratch is untouched"
