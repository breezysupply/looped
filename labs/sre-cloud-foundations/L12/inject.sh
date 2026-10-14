#!/usr/bin/env bash
# L12 fault injection, after the baseline apply. Variants:
#   variant-a  out-of-band change made by hand to the dev deployment
#   variant-b  an existing, hand-made container + volume that must come under Terraform
#   variant-c  an approved change request whose plan includes a forced replacement
# Writes work/TICKET.md (what the learner is told) and work/.l12-inject.json.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L12_PROJECT"
l12_guard
DEV="$WORK/envs/dev"
[ -f "$DEV/terraform.tfstate" ] || die "no dev state; run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac
LBL=(--label looped.lab/id=L12 --label looped.lab/env=dev)
SRC=(--mount "type=bind,src=$SRE_BEACON,dst=/src,readonly" -w /src -e PYTHONDONTWRITEBYTECODE=1)

case "$V" in
  variant-a)
    l12_rm container looped-l12-dev-api
    docker run -d --name looped-l12-dev-api "${LBL[@]}" --label looped.lab/origin=by-hand \
      --network looped-l12-dev-net -p 127.0.0.1:18499:8080 \
      --mount type=volume,src=looped-l12-dev-data,dst=/data "${SRC[@]}" \
      -e BEACON_APP_ENVIRONMENT=dev -e BEACON_STORE_KIND=sqlite -e BEACON_STORE_PATH=/data/beacon.db -e BEACON_QUEUE_KIND=none \
      "$L12_IMAGE" python3 -m beacon api --config /src/beacon.yaml >/dev/null
    cat > "$WORK/TICKET.md" <<'T'
# BEACON-OPS-1207 (dev)

Since last night's on-call session the dev API no longer answers on 127.0.0.1:18412, although
`docker ps` shows a looped-l12-dev-api container running. On-call says they "just restarted it".
Bring dev back to what Terraform declares, keep the records in the data volume, and end with a
no-change plan. Then continue with checkpoint c2.
T
    printf '{}\n' > "$WORK/.l12-inject.json"
    ;;
  variant-b)
    docker volume create "${LBL[@]}" looped-l12-dev-spool >/dev/null
    token="spool-$(date -u +%s)"
    docker run --rm --name looped-l12-dev-spoolinit --mount type=volume,src=looped-l12-dev-spool,dst=/spool "$L12_IMAGE" \
      python3 -c "import os,sys; os.makedirs('/spool/pending', exist_ok=True); open('/spool/.l12-marker','w').write(sys.argv[1])" "$token"
    docker run -d --name looped-l12-dev-worker "${LBL[@]}" --network looped-l12-dev-net \
      --mount type=volume,src=looped-l12-dev-spool,dst=/spool "${SRC[@]}" \
      -e BEACON_APP_ENVIRONMENT=dev -e BEACON_STORE_KIND=memory -e BEACON_QUEUE_KIND=dir -e BEACON_QUEUE_DIR=/spool \
      -e BEACON_WORKER_EFFECTS_PATH=/spool/effects.jsonl \
      "$L12_IMAGE" python3 -m beacon worker --config /src/beacon.yaml >/dev/null
    python3 - "$WORK" "$token" <<'PY'
import json, subprocess, sys
work, token = sys.argv[1:3]
vol = json.loads(subprocess.run(["docker", "volume", "inspect", "looped-l12-dev-spool"], capture_output=True, text=True, check=True).stdout)[0]
with open(work + "/.l12-inject.json", "w", encoding="utf-8") as fh:
    json.dump({"spool_created": vol["CreatedAt"], "marker": token}, fh, indent=2)
PY
    cat > "$WORK/TICKET.md" <<'T'
# BEACON-OPS-1211 (dev)

A teammate started a Beacon worker by hand in dev (`looped-l12-dev-worker`) with its own volume
`looped-l12-dev-spool`, which holds queued jobs we cannot lose. Bring both under Terraform in the
dev root (or the module) WITHOUT deleting the spool volume or its contents, and end with a
no-change plan. Then continue with checkpoint c2.
T
    ;;
  variant-c)
    cat > "$DEV/terraform.tfvars" <<'TFV'
env      = "dev"
api_port = 18422

# CHG-2207 (approved): move the dev API to 18422 and tag the data volume
# so the nightly backup job selects it.
extra_volume_labels = {
  "looped.lab/backup" = "nightly"
}
TFV
    cat > "$WORK/TICKET.md" <<'T'
# CHG-2207 (dev, approved)

Apply the approved change in envs/dev/terraform.tfvars today. Dev's records must survive.
Before applying anything, write in evidence/L12-plan-notes.md which resources the plan creates,
updates in place or replaces, which attribute forces each replacement, and what data each one
puts at risk. Apply only what is safe; say what you did with the rest and why. End with a
no-change plan. Then continue with checkpoint c2.
T
    printf '{}\n' > "$WORK/.l12-inject.json"
    ;;
esac
printf '%s\n' "$V" > "$WORK/.variant"
info "variant $V injected; read $WORK/TICKET.md"
