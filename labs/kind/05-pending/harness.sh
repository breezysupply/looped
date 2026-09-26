# shellcheck shell=bash
# Sourced by harness/run-lab.sh. Lab 05 symptom: the new pod is Pending with
# FailedScheduling "Insufficient memory"; the 1.4.0 pod keeps running.
SYMPTOM_TIMEOUT=120
VERIFY_TIMEOUT=180
symptom_check() {
  [ -n "$(k get pods -l app=report-builder --field-selector=status.phase=Pending -o name)" ] || return 1
  [ "$(k get deployment report-builder -o jsonpath='{.status.availableReplicas}')" = 1 ] || return 1
  k get events --field-selector reason=FailedScheduling | grep -q 'Insufficient memory'
}
symptom_evidence() {
  k get deployment report-builder
  k get pods -l app=report-builder -o wide
  k get events --field-selector reason=FailedScheduling --sort-by=.lastTimestamp | tail -2 | cut -c1-400
  kc get nodes -o custom-columns=NAME:.metadata.name,POOL:.metadata.labels.pool,ALLOCATABLE_MEM:.status.allocatable.memory,TAINTS:.spec.taints[*].key
}
