# shellcheck shell=bash
# Sourced by harness/run-lab.sh. Lab 09 symptom: stock-sync Running and Ready,
# its log shows HTTP 403 forbidden for listing configmaps.
SYMPTOM_TIMEOUT=90
VERIFY_TIMEOUT=90
symptom_check() {
  [ "$(k get deployment stock-sync -o jsonpath='{.status.readyReplicas}')" = 1 ] || return 1
  k logs deployment/stock-sync --tail=1 | grep -q 'HTTP 403'
}
symptom_evidence() {
  k get pods -l app=stock-sync
  k logs deployment/stock-sync --tail=2
  kc auth can-i list configmaps -n looped-lab --as=system:serviceaccount:looped-lab:stock-sync
  k get rolebinding stock-sync-configmap-reader -o wide
}
