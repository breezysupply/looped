#!/usr/bin/env bash
# Lab 10 verify:
#  - edge-gateway still names the site image from the transfer manifest
#    (not a public registry) with a pull policy that uses the node's copy
#  - rollout complete (updated = ready = available = desired), release 4.2 running
#  - the image each running container uses has a digest listed in the transfer
#    manifest (index, per-platform manifest, or per-platform config digest)
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
preflight >/dev/null
MANIFEST="$LAB_DIR/transfer/edge-gateway-4.2.manifest"

want_name=$(awk '$1=="image-name:"{print $2}' "$MANIFEST")
allowed=$(awk '$1 ~ /^(index-digest|manifest-|config-)/ {print $2}' "$MANIFEST")

k get deployment edge-gateway >/dev/null 2>&1 || { problem "deployment/edge-gateway does not exist (run inject.sh first)"; report ""; }
IFS='|' read -r img policy ver <<<"$(k get deployment edge-gateway -o jsonpath='{.spec.template.spec.containers[0].image}|{.spec.template.spec.containers[0].imagePullPolicy}|{.spec.template.spec.containers[0].env[?(@.name=="APP_VERSION")].value}')"
[ "$img" = "$want_name" ] || problem "deployment image is '$img'; release 4.2 must run '$want_name' (the site cannot pull from public registries)"
case "$policy" in IfNotPresent|Never) ;; *) problem "imagePullPolicy is '$policy'; with no registry reachable it must use the node's copy (IfNotPresent or Never)" ;; esac
[ "$ver" = 4.2 ] || problem "the Deployment runs APP_VERSION=${ver:-?}, not release 4.2"

IFS='|' read -r gen obs want upd ready avail <<<"$(k get deployment edge-gateway -o jsonpath='{.metadata.generation}|{.status.observedGeneration}|{.spec.replicas}|{.status.updatedReplicas}|{.status.readyReplicas}|{.status.availableReplicas}')"
[ "${obs:-0}" -ge "${gen:-1}" ] || problem "controller has not observed the latest spec yet"
[ "${upd:-0}" = "${want:-x}" ] && [ "${ready:-0}" = "$want" ] && [ "${avail:-0}" = "$want" ] \
  || problem "rollout not finished: ${upd:-0} updated, ${ready:-0} ready, ${avail:-0} available of ${want:-?}"

prog=$(k get deployment edge-gateway -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}')
[ "$prog" = NewReplicaSetAvailable ] || problem "Progressing condition reason is '${prog:-none}', expected NewReplicaSetAvailable (rollout not complete)"

while IFS='|' read -r pod waiting imageid deleting; do
  [ -n "$pod" ] && [ -z "$deleting" ] || continue
  [ -z "$waiting" ] || { problem "$pod is waiting: $waiting"; continue; }
  [ -n "$imageid" ] || { problem "$pod has no running image yet"; continue; }
  d="sha256:${imageid##*sha256:}"
  printf '%s\n' "$allowed" | grep -qxF "$d" \
    || problem "$pod runs image content $d, which is not listed in the transfer manifest"
done <<<"$(k get pods -l app=edge-gateway -o jsonpath='{range .items[*]}{.metadata.name}|{.status.containerStatuses[0].state.waiting.reason}|{.status.containerStatuses[0].imageID}|{.metadata.deletionTimestamp}{"\n"}{end}')"

report "edge-gateway 4.2 runs $want_name from the node's image store, with content matching the transfer manifest"
