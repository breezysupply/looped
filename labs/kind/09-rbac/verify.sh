#!/usr/bin/env bash
# Lab 09 verify (as the API server sees it, via impersonation):
#  - system:serviceaccount:looped-lab:stock-sync CAN get and list configmaps in looped-lab
#  - it still CANNOT write configmaps, read secrets, list pods, read configmaps
#    in other namespaces, or do everything ('*' on '*')
#  - stock-sync still runs as that ServiceAccount, and its latest log line is "sync ok"
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
preflight >/dev/null
SA_USER="system:serviceaccount:$NS:stock-sync"

can() { kc auth can-i "$@" --as="$SA_USER" 2>/dev/null; }   # prints yes/no

for v in get list; do
  [ "$(can "$v" configmaps -n "$NS")" = yes ] || problem "stock-sync cannot $v configmaps in $NS"
done
set -f   # the '*' specs below must not glob-expand
for spec in "create configmaps -n $NS" "update configmaps -n $NS" "delete configmaps -n $NS" \
            "get secrets -n $NS" "list secrets -n $NS" "list pods -n $NS" \
            "list configmaps -n default" "list configmaps -n kube-system" "list configmaps --all-namespaces" \
            "* * -n $NS"; do
  # shellcheck disable=SC2086
  [ "$(can $spec)" = no ] || problem "stock-sync is allowed to: $spec (more than it needs)"
done
set +f

sa=$(k get deployment stock-sync -o jsonpath='{.spec.template.spec.serviceAccountName}' 2>/dev/null)
[ "$sa" = stock-sync ] || problem "deployment/stock-sync runs as ServiceAccount '${sa:-default}', expected stock-sync"
ready=$(k get deployment stock-sync -o jsonpath='{.status.readyReplicas}' 2>/dev/null)
[ "${ready:-0}" -ge 1 ] || problem "stock-sync has no ready replica"
last=$(k logs deployment/stock-sync --tail=1 2>/dev/null)
case "$last" in
  *"sync ok"*) ;;
  *) problem "stock-sync's latest log line is not a successful sync: ${last:-<no logs>}" ;;
esac

report "stock-sync can get/list ConfigMaps in $NS and nothing more that was checked; its last sync succeeded"
