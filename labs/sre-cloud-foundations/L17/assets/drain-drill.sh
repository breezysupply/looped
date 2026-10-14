#!/usr/bin/env bash
# Controlled drain drill (checkpoint c4). Drains ONE worker node of looped-foundations with
# eviction (so PodDisruptionBudgets are honoured), a bounded timeout and no --force /
# --disable-eviction, records what happened in evidence/L17-drain.json, and ALWAYS uncordons
# the node afterwards (trap), so the drill never leaves the cluster degraded.
#   bash labs/sre-cloud-foundations/L17/assets/drain-drill.sh [NODE]
# Default NODE: a worker running a beacon-api pod and, if possible, not running beacon-db-0.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
EV="$(evidence_dir "$HERE")"
TIMEOUT="${LOOPED_DRAIN_TIMEOUT:-90s}"

workers="$(kc_basic get nodes -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.taints[*].key}{"\n"}{end}' | awk '$2 !~ /control-plane/ {print $1}')"
api_nodes="$(k_basic get pods -l app=beacon-api -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' | sort -u)"
db_node="$(k_basic get pod beacon-db-0 -o jsonpath='{.spec.nodeName}' 2>/dev/null || true)"
NODE="${1:-}"
if [ -z "$NODE" ]; then
  for n in $api_nodes; do
    echo "$workers" | grep -qx "$n" || continue
    if [ "$n" != "$db_node" ]; then NODE="$n"; break; fi
  done
  if [ -z "$NODE" ]; then NODE="$(echo "$api_nodes" | head -1)"; fi
fi
[ -n "$NODE" ] || die "no node runs a beacon-api pod; is the lab set up?"
case "$NODE" in "$SRE_KIND_BASIC"-*) ;; *) die "node $NODE is not a $SRE_KIND_BASIC node" ;; esac
others="$(echo "$workers" | grep -vx "$NODE" | grep -c . || true)"
[ "$others" -ge 1 ] || die "draining $NODE would leave no other worker for the evicted pods. The drill needs a kind-basic cluster with at least two workers (see profiles/kind-basic/README.md)."

pdb_json="$(k_basic get pdb beacon-api -o json 2>/dev/null || echo '{}')"
replicas="$(k_basic get deploy beacon-api -o jsonpath='{.spec.replicas}' 2>/dev/null || echo '?')"
info "drill: draining $NODE (timeout $TIMEOUT); beacon-api replicas=$replicas; db on ${db_node:-?}"
trap 'kc_basic uncordon "$NODE" >/dev/null 2>&1 && say "uncordoned $NODE"' EXIT
started="$(date -u +%FT%TZ)"
set +e
out="$(kc_basic drain "$NODE" --ignore-daemonsets --delete-emptydir-data --timeout="$TIMEOUT" 2>&1)"
rc=$?
set -e
printf '%s\n' "$out" | tail -n 12
python3 - "$EV/L17-drain.json" "$NODE" "$rc" "$started" "$replicas" "$db_node" "$pdb_json" "$out" <<'PY'
import json, os, re, sys, time
path, node, rc, started, replicas, db_node, pdb_raw, out = sys.argv[1:9]
try:
    pdb = json.loads(pdb_raw)
except ValueError:
    pdb = {}
lines = [l for l in out.splitlines() if l.strip()]
blocked = any(re.search(r"violate the pod's disruption budget|Cannot evict pod", l) for l in lines)
attempt = {
    "started": started, "finished": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "node": node, "exit_code": int(rc), "completed": int(rc) == 0, "budget_blocked": blocked,
    "flags": ["--ignore-daemonsets", "--delete-emptydir-data", "--timeout"],
    "api_replicas": replicas, "db_node": db_node,
    "pdb": {"spec": pdb.get("spec", {}), "status": {k: pdb.get("status", {}).get(k) for k in ("currentHealthy", "desiredHealthy", "disruptionsAllowed", "expectedPods")}},
    "excerpt": [l[:200] for l in lines if re.search(r"evict|budget|drained|cordoned|error|timed out", l)][-8:],
}
doc = {"activity": "L17", "attempts": []}
if os.path.exists(path):
    try:
        doc = json.load(open(path, encoding="utf-8"))
    except ValueError:
        pass
doc.setdefault("attempts", []).append(attempt)
json.dump(doc, open(path, "w", encoding="utf-8"), indent=2)
print("recorded attempt %d in %s: completed=%s budget_blocked=%s" % (len(doc["attempts"]), path, attempt["completed"], blocked))
PY
k_basic rollout status deploy/beacon-api --timeout=120s >/dev/null 2>&1 || warn "beacon-api not fully rolled out yet; check kubectl -n beacon get pods -o wide"
