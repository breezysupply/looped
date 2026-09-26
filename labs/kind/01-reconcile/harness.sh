# shellcheck shell=bash
# Sourced by harness/run-lab.sh (not run directly). Lab 01 symptom:
# the catalog pods were replaced by new ones (3/3 again) and catalog-debug is gone.
SYMPTOM_TIMEOUT=180
VERIFY_TIMEOUT=180
symptom_check() {
  local deleted now_names n
  deleted=$(k get configmap lab01-incident-notes -o jsonpath='{.data.deleted-pods}') || return 1
  k get pod catalog-debug >/dev/null 2>&1 && return 1
  [ "$(k get deployment catalog -o jsonpath='{.status.readyReplicas}')" = 3 ] || return 1
  now_names=$(k get pods -l app=catalog --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')
  [ "$(printf '%s\n' "$now_names" | grep -c .)" -ge 3 ] || return 1
  for n in $now_names; do case " $deleted " in *" $n "*) return 1 ;; esac; done
  return 0
}
symptom_evidence() {
  say "deleted (from lab01-incident-notes): $(k get configmap lab01-incident-notes -o jsonpath='{.data.deleted-pods}')"
  k get deployment catalog
  k get replicaset -l app=catalog
  k get pods -l 'app in (catalog,catalog-debug)' -o wide
  k get pod catalog-debug 2>&1 | head -1
  k get events --field-selector reason=SuccessfulCreate --sort-by=.lastTimestamp | tail -4
}
