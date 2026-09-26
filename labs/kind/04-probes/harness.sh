# shellcheck shell=bash
# Sourced by harness/run-lab.sh. Lab 04 symptom: search-api Running, not Ready,
# 0 restarts, readiness 404s; search-indexer restarted by its liveness probe.
SYMPTOM_TIMEOUT=240
VERIFY_TIMEOUT=300
symptom_check() {
  local api idx
  api=$(k get pods -l app=search-api -o jsonpath='{range .items[*]}{.status.phase}/{.status.containerStatuses[0].ready}/{.status.containerStatuses[0].restartCount}{" "}{end}')
  [ "$(printf '%s' "$api" | tr ' ' '\n' | grep -c '^Running/false/0$')" = 2 ] || return 1
  k get events --field-selector reason=Unhealthy | grep -q 'Readiness probe failed: HTTP probe failed with statuscode: 404' || return 1
  idx=$(k get pods -l app=search-indexer -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}')
  [ "${idx:-0}" -ge 2 ]
}
symptom_evidence() {
  k get pods -l 'app in (search-api,search-indexer)'
  k get endpointslices -l kubernetes.io/service-name=search-api
  k get events --field-selector reason=Unhealthy --sort-by=.lastTimestamp | tail -4
  k get events --field-selector reason=Killing --sort-by=.lastTimestamp | tail -2
  k logs deployment/search-indexer --previous --tail=3 2>&1
  k get pods -l app=search-indexer -o jsonpath='{range .items[*]}{.metadata.name} lastState={.status.containerStatuses[0].lastState.terminated.reason} exit={.status.containerStatuses[0].lastState.terminated.exitCode}{"\n"}{end}'
}
