#!/usr/bin/env bash
# The L18 connectivity matrix, from inside the real pods. Each line: source → target, what the
# segmentation SHOULD allow, and what actually happened. Run before and after every policy
# change; paste the output into your notes (section Proof).
#   bash labs/sre-cloud-foundations/L18/assets/netcheck.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_POLICY" "$SRE_KIND_POLICY"
DB_IP="$(k_policy get svc beacon-db -o jsonpath='{.spec.clusterIP}')"
REPORT_IP="$(k_policy get svc beacon-report -o jsonpath='{.spec.clusterIP}')"
KAPI_IP="$(kc_policy -n default get svc kubernetes -o jsonpath='{.spec.clusterIP}')"
FQDN="beacon-db.$SRE_NS.svc.cluster.local."
row() { printf '%-34s want %-6s got %s\n' "$1" "$2" "$3"; }
row "api → DNS + db:5432 (by name)"  allow "$(l18_probe beacon-api pg "$FQDN" 5432)"
row "report → DNS (kubernetes.default)" allow "$(l18_probe beacon-report tcp kubernetes.default.svc.cluster.local. 443 | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps({"dns": d.get("dns")}))')"
row "report → db:5432 (by IP)"       deny  "$(l18_probe beacon-report tcp "$DB_IP" 5432)"
row "api → report:9090 (by IP)"      deny  "$(l18_probe beacon-api tcp "$REPORT_IP" 9090)"
row "api → kube API:443 (by IP)"     deny  "$(l18_probe beacon-api tcp "$KAPI_IP" 443)"
say "CNI: $(kc_policy -n kube-system get ds calico-node -o jsonpath='{.metadata.name} {.status.numberReady}/{.status.desiredNumberScheduled} ready' 2>/dev/null || echo 'calico-node not found')"
