#!/usr/bin/env bash
# L12 setup: copy starter/ to work/, init + apply the flat dev root against
# your local Docker engine, wait for Beacon, write one seed record into the
# data volume, record the baseline (volume creation time, seed id), inject the
# chosen variant. Every object is named looped-l12-*; state is local under
# work/envs/<env>/. Idempotent: an existing work/ is reused.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/assets/common.sh"
l12_guard

if [ -d "$WORK" ]; then
  info "work/ exists; reusing it (reset.sh starts over, teardown.sh removes everything)"
  exit 0
fi
left="$(l12_list container; l12_list volume; l12_list network)"
[ -z "$left" ] || die "looped-l12-* Docker objects exist without a workspace (an old attempt?): $(echo "$left" | tr '\n' ' '); run teardown.sh first"

cp -R "$HERE/starter" "$WORK"
DEV="$WORK/envs/dev"
EV="$(evidence_dir "$HERE")"
info "terraform init (kreuzwerker/docker pinned by the committed lockfile)"
l12_tf "$DEV" init -input=false -lockfile=readonly -no-color >/dev/null
info "apply the flat dev configuration (network, data volume, image, API container)"
l12_tf "$DEV" apply -input=false -auto-approve -no-color >/dev/null
l12_wait_health 18412

python3 - "$WORK" <<'PY'
import json, subprocess, sys, urllib.request
work = sys.argv[1]
req = urllib.request.Request("http://127.0.0.1:18412/status", method="POST",
                             data=json.dumps({"sensor_id": "l12-seed", "status": "ok"}).encode(),
                             headers={"Content-Type": "application/json", "Idempotency-Key": "l12-seed-1"})
rec = json.loads(urllib.request.urlopen(req, timeout=5).read())
vol = json.loads(subprocess.run(["docker", "volume", "inspect", "looped-l12-dev-data"], capture_output=True, text=True, check=True).stdout)[0]
base = {"seed_id": rec["id"], "data_volume_created": vol["CreatedAt"]}
with open(work + "/.l12-baseline.json", "w", encoding="utf-8") as fh:
    json.dump(base, fh, indent=2)
print("seed record " + rec["id"] + " stored in looped-l12-dev-data (created " + vol["CreatedAt"] + ")")
PY
{
  echo "# L12 tool inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "DOCKER_HOST=${DOCKER_HOST:-default}"
} > "$EV/L12-tools.txt"
[ -f "$EV/L12-plan-notes.md" ] || cp "$HERE/assets/plan-notes-template.md" "$EV/L12-plan-notes.md"
bash "$HERE/inject.sh"
say ""
say "L12 ready. Read work/TICKET.md, then: terraform -chdir=$DEV plan"
