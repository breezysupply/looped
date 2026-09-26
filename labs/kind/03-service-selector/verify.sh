#!/usr/bin/env bash
# Lab 03 verify:
#  - Service orders selects pods that the orders-api Deployment's TEMPLATE
#    produces (so the next rollout keeps working), not only today's pods
#  - its EndpointSlices list as many ready endpoints as orders-api has ready replicas
#  - a real request from the storefront pod to http://orders:8080/ succeeds
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
preflight >/dev/null

k get service orders >/dev/null 2>&1 || { problem "service/orders does not exist"; report ""; }
k get deployment orders-api >/dev/null 2>&1 || { problem "deployment/orders-api does not exist"; report ""; }

sel=$(k get service orders -o go-template='{{range $k, $v := .spec.selector}}{{$k}}={{$v}}{{"\n"}}{{end}}')
tmpl=$(k get deployment orders-api -o go-template='{{range $k, $v := .spec.template.metadata.labels}}{{$k}}={{$v}}{{"\n"}}{{end}}')
if [ -z "$sel" ]; then
  problem "service/orders has no selector (endpoints would have to be managed by hand)"
else
  while IFS= read -r kv; do
    [ -n "$kv" ] || continue
    printf '%s\n' "$tmpl" | grep -qxF "$kv" || problem "Service selector $kv is not in the orders-api pod template labels, so pods from the next rollout would not match"
  done <<<"$sel"
fi

want=$(k get deployment orders-api -o jsonpath='{.status.readyReplicas}')
eps=$(ready_endpoints orders)
[ "${want:-0}" -ge 1 ] || problem "orders-api has no ready replicas"
[ "$eps" = "${want:-x}" ] || problem "Service orders has $eps ready endpoint(s); orders-api has ${want:-0} ready replicas"

if out=$(k exec deployment/storefront -- wget -q -T 3 -O - http://orders:8080/ 2>&1); then
  case "$out" in *"orders-api ok"*) ;; *) problem "request to http://orders:8080/ returned unexpected content: $out" ;; esac
else
  problem "request from storefront to http://orders:8080/ failed: $(printf '%s' "$out" | tail -1)"
fi

report "Service orders matches the orders-api pod template, has $eps ready endpoints, and storefront gets a response"
