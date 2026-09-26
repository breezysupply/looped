# shellcheck shell=bash
# Sourced by harness/run-lab.sh. Lab 02 symptom: one new pod cannot pull its
# image, the 3 old pods keep serving, and the progress deadline is exceeded.
SYMPTOM_TIMEOUT=300
VERIFY_TIMEOUT=240
symptom_check() {
  k get pods -l app=payments-api -o jsonpath='{.items[*].status.containerStatuses[*].state.waiting.reason}' | grep -Eq 'ImagePullBackOff|ErrImagePull' || return 1
  [ "$(k get deployment payments-api -o jsonpath='{.status.availableReplicas}')" = 3 ] || return 1
  [ "$(k get deployment payments-api -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}')" = ProgressDeadlineExceeded ]
}
symptom_evidence() {
  k get deployment payments-api
  k get replicaset -l app=payments-api
  k get pods -l app=payments-api
  k rollout status deployment/payments-api --timeout=5s 2>&1 | tail -1
  k get deployment payments-api -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}: {.message}{"\n"}{end}'
  k get events --field-selector reason=Failed --sort-by=.lastTimestamp -o custom-columns=MESSAGE:.message | grep 'Failed to pull' | tail -1 | cut -c1-600
  k rollout history deployment/payments-api
}
