# shellcheck shell=bash
# Sourced by harness/run-lab.sh. Lab 07 symptom: both containers have a last
# termination with exit code 137; thumbnailer's reason is OOMKilled, the
# transcoder's is Error (SIGKILL after liveness failure + grace period).
SYMPTOM_TIMEOUT=300
VERIFY_TIMEOUT=360
last_term() { k get pods -l "app=$1" -o jsonpath='{.items[0].status.containerStatuses[0].lastState.terminated.reason}/{.items[0].status.containerStatuses[0].lastState.terminated.exitCode}'; }
symptom_check() {
  [ "$(last_term thumbnailer)" = OOMKilled/137 ] || return 1
  [ "$(last_term transcoder)" = Error/137 ]
}
symptom_evidence() {
  k get pods -l 'app in (thumbnailer,transcoder)'
  for a in thumbnailer transcoder; do
    k get pods -l "app=$a" -o jsonpath='{.items[0].metadata.name}: lastState.terminated reason={.items[0].status.containerStatuses[0].lastState.terminated.reason} exitCode={.items[0].status.containerStatuses[0].lastState.terminated.exitCode} restarts={.items[0].status.containerStatuses[0].restartCount}{"\n"}'
    k logs "deployment/$a" --previous --tail=3 2>&1
  done
  k get events --field-selector reason=Unhealthy --sort-by=.lastTimestamp | grep transcoder | tail -2
  k get events --field-selector reason=Killing --sort-by=.lastTimestamp | grep transcoder | tail -1
}
