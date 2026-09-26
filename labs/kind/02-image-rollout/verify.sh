#!/usr/bin/env bash
# Lab 02 verify: the Deployment has a finished, healthy rollout.
#  - latest generation observed; updated = ready = available = desired replicas
#  - Available=True and Progressing reason NewReplicaSetAvailable
#  - no payments-api pod is stuck pulling an image
#  - the Service has as many ready endpoints as desired replicas
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
preflight >/dev/null

if ! k get deployment payments-api >/dev/null 2>&1; then
  problem "deployment/payments-api does not exist (run inject.sh first)"
  report ""
fi
IFS='|' read -r gen obs want upd ready avail prog_reason avail_status <<<"$(k get deployment payments-api -o jsonpath='{.metadata.generation}|{.status.observedGeneration}|{.spec.replicas}|{.status.updatedReplicas}|{.status.readyReplicas}|{.status.availableReplicas}|{.status.conditions[?(@.type=="Progressing")].reason}|{.status.conditions[?(@.type=="Available")].status}')"
[ "${obs:-0}" -ge "${gen:-1}" ] || problem "controller has not observed the latest spec yet (generation $gen, observed ${obs:-none})"
[ "${want:-0}" -ge 1 ] || problem "payments-api is scaled to ${want:-0}; the service needs replicas"
for pair in "updated:${upd:-0}" "ready:${ready:-0}" "available:${avail:-0}"; do
  [ "${pair#*:}" = "${want:-x}" ] || problem "${pair%%:*} replicas ${pair#*:}, desired ${want:-?}: the rollout has not finished"
done
[ "$prog_reason" = NewReplicaSetAvailable ] || problem "Progressing condition reason is '${prog_reason:-none}', expected NewReplicaSetAvailable"
[ "$avail_status" = True ] || problem "Available condition is '${avail_status:-none}'"

stuck=$(k get pods -l app=payments-api -o jsonpath='{range .items[*]}{.metadata.name}={.status.containerStatuses[*].state.waiting.reason}{"\n"}{end}' | grep -E '=(ErrImagePull|ImagePullBackOff|InvalidImageName)' || true)
[ -z "$stuck" ] || problem "pods still cannot pull their image: $(printf '%s' "$stuck" | tr '\n' ' ')"

eps=$(ready_endpoints payments-api)
[ "$eps" = "${want:-x}" ] || problem "Service payments-api has $eps ready endpoint(s), expected ${want:-?}"

report "payments-api rollout is complete: ${want} updated, ready and available; no image pull failures; ${eps} ready endpoints"
