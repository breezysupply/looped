# shellcheck shell=bash
# Sourced by harness/run-lab.sh. Lab 10 symptom: the 4.2 pod cannot pull
# registry.invalid/looped/edge-gateway:4.2; the 4.1 pod keeps serving.
SYMPTOM_TIMEOUT=120
VERIFY_TIMEOUT=240
symptom_check() {
  k get pods -l app=edge-gateway -o jsonpath='{.items[*].status.containerStatuses[*].state.waiting.reason}' | grep -Eq 'ImagePullBackOff|ErrImagePull' || return 1
  [ "$(k get deployment edge-gateway -o jsonpath='{.status.availableReplicas}')" = 1 ]
}
symptom_evidence() {
  k get deployment edge-gateway
  k get pods -l app=edge-gateway
  k get events --field-selector reason=Failed --sort-by=.lastTimestamp -o custom-columns=MESSAGE:.message | grep 'Failed to pull' | tail -1 | cut -c1-500
}
