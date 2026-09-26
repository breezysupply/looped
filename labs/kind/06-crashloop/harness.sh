# shellcheck shell=bash
# Sourced by harness/run-lab.sh. Lab 06 symptom: a 3.0.0 pod in CrashLoopBackOff
# with exit code 1 and the FATAL log line; the 2.9.0 pods keep serving.
SYMPTOM_TIMEOUT=180
VERIFY_TIMEOUT=240
symptom_check() {
  local pod
  pod=$(k get pods -l app=notify-api -o jsonpath='{range .items[*]}{.metadata.name} {.status.containerStatuses[0].state.waiting.reason}{"\n"}{end}' | awk '$2=="CrashLoopBackOff"{print $1; exit}')
  [ -n "$pod" ] || return 1
  [ "$(k get pod "$pod" -o jsonpath='{.status.containerStatuses[0].lastState.terminated.exitCode}')" = 1 ] || return 1
  k logs "$pod" --previous | grep -q 'FATAL: NOTIFY_ENDPOINT is not set' || return 1
  [ "$(k get deployment notify-api -o jsonpath='{.status.availableReplicas}')" = 2 ]
}
symptom_evidence() {
  local pod
  k get deployment notify-api
  k get pods -l app=notify-api
  pod=$(k get pods -l app=notify-api -o jsonpath='{range .items[*]}{.metadata.name} {.status.containerStatuses[0].state.waiting.reason}{"\n"}{end}' | awk '$2=="CrashLoopBackOff"{print $1; exit}')
  k get pod "$pod" -o jsonpath='lastState: reason={.status.containerStatuses[0].lastState.terminated.reason} exitCode={.status.containerStatuses[0].lastState.terminated.exitCode} restarts={.status.containerStatuses[0].restartCount}{"\n"}'
  k logs "$pod" --previous
  k get events --field-selector reason=BackOff --sort-by=.lastTimestamp | tail -1
}
