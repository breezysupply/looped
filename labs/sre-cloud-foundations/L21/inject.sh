#!/usr/bin/env bash
# L21 fault injection (on top of the starter's gaps):
#   always     a teammate's change adds a per-user label to the request counter (cardinality)
#   variant-a  the registry dependency answers slowly (fixture knob: work/fixture/registry.json)
#   variant-b  a configuration change makes the API's own per-request work expensive
# Then restarts the API and runs 20 s of bounded traffic so the symptom is visible.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L21_PROJECT"
l21_guard
l21_require_profile
[ -d "$WORK/app" ] || die "run setup.sh first"
V="$(l21_variant)"
python3 - "$WORK" "$V" <<'PY'
import json, sys
work, v = sys.argv[1:3]
api = work + "/app/api.py"
src = open(api, encoding="utf-8").read()
old = '{"route": route, "method": method, "status_class": status_class(code)},'
new = '{"route": route, "method": method, "status_class": status_class(code), "user_id": user_id or "anonymous"},  # per-customer breakdown (BEACON-1987)'
if "BEACON-1987" not in src:
    if old not in src:
        sys.exit("cannot apply the BEACON-1987 change: work/app/api.py no longer has the original metrics line")
    open(api, "w", encoding="utf-8").write(src.replace(old, new, 1))
cfg_p = work + "/config/config.json"
cfg = json.load(open(cfg_p))
reg = {"delay_ms": 0}
if v == "variant-a":
    reg = {"delay_ms": 450}
else:
    cfg["checksum_rounds"] = 1500000
json.dump(cfg, open(cfg_p, "w"), indent=2)
json.dump(reg, open(work + "/fixture/registry.json", "w"))
json.dump({"variant": v, "registry_delay_ms": reg["delay_ms"], "checksum_rounds": cfg["checksum_rounds"]}, open(work + "/.l21-inject.json", "w"))
PY
chmod -R a+rX "$WORK"
docker restart looped-l21-api >/dev/null
l21_wait_api
info "20 s of bounded traffic (assets/traffic.py)"
python3 "$HERE/assets/traffic.py" --seconds 20 --rps 4 --seed 7
cat > "$WORK/TICKET.md" <<'T'
# BEACON-OBS-2104

1. Support says the sensor page (`GET /sensors/{id}`) has been slow since yesterday; the API
   hosts look fine to them. Find where the time goes, with evidence from all three signals,
   and fix what is ours to fix.
2. Prometheus' memory on the shared stack has been creeping up since BEACON-1987 shipped.
3. The worker team cannot follow a job from the API request that created it.
4. The on-call dashboard has request rate and errors only; it needs latency, the dependency
   and CPU before this goes to on-call.
T
info "faults injected ($V); read work/TICKET.md"
