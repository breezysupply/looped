# shellcheck shell=bash
# Sourced by harness/run-lab.sh. Lab 03 symptom: orders-api 3/3 Ready, the
# orders Service has no endpoints, storefront logs failures.
SYMPTOM_TIMEOUT=120
VERIFY_TIMEOUT=120
symptom_check() {
  [ "$(k get deployment orders-api -o jsonpath='{.status.readyReplicas}')" = 3 ] || return 1
  [ -z "$(k get endpointslices -l kubernetes.io/service-name=orders -o jsonpath='{.items[*].endpoints[*].addresses[*]}')" ] || return 1
  k logs deployment/storefront --tail=1 | grep -q FAILED
}
symptom_evidence() {
  k get deployment orders-api
  k get pods -l app=orders-api --show-labels
  k get service orders -o wide
  k get endpointslices -l kubernetes.io/service-name=orders
  k logs deployment/storefront --tail=6
}
