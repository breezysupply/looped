#!/usr/bin/env bash
# L04 setup: a small, explicitly capped lab filesystem (a 24 MiB ext4 image
# with 1024 inodes, loop-mounted at /opt/beacon-l04/mnt), Beacon writing its
# database and job queue onto it, an unrelated "reporter" process, seeded
# live data, then the chosen fault. Run as root inside the course VM.
# Nothing here can fill the host disk: the only large writes go into the image.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo (loop-mounts a lab image under /opt/beacon-l04)"
for t in mkfs.ext4 mount umount losetup python3 curl; do command -v "$t" >/dev/null 2>&1 || die "$t not found"; done

LAB=/opt/beacon-l04
MNT="$LAB/mnt"
IMG="$LAB/labfs.img"
IMG_MIB=24
INODES=1024
PORT=8084

if mountpoint -q "$MNT" 2>/dev/null; then die "$MNT is already mounted; run reset.sh or teardown.sh first"; fi
rm -rf "${LAB:?}"
mkdir -p "$LAB/bin" "$LAB/run" "$LAB/.lab" "$MNT"
cp "$HERE/assets/report-builder.py" "$HERE/assets/reporter.py" "$LAB/bin/"

info "Creating the capped lab filesystem ($IMG_MIB MiB, $INODES inodes) at $IMG"
dd if=/dev/zero of="$IMG" bs=1M count="$IMG_MIB" status=none
mkfs.ext4 -q -F -m 0 -N "$INODES" -L looped-l04 "$IMG"
mount -o loop,nodev,nosuid,noexec "$IMG" "$MNT"
mkdir -p "$MNT/data" "$MNT/queue" "$MNT/logs" "$MNT/tmp/sessions"

cat > "$LAB/beacon.yaml" <<YAML
server:
  listen: 127.0.0.1
  port: $PORT
app:
  version: "1.4.0"
  environment: lab
  admin_enabled: false
store:
  kind: sqlite
  path: $MNT/data/beacon.db
queue:
  kind: dir
  dir: $MNT/queue
YAML

info "Starting Beacon on 127.0.0.1:$PORT (log: $LAB/beacon.log) and the reporter"
setsid env PYTHONPATH="$SRE_BEACON" python3 -m beacon api --config "$LAB/beacon.yaml" >>"$LAB/beacon.log" 2>&1 < /dev/null &
echo $! > "$LAB/run/beacon.pid"
setsid python3 "$LAB/bin/reporter.py" "$LAB/run/reporter.heartbeat" >/dev/null 2>&1 < /dev/null &
echo $! > "$LAB/run/reporter.pid"
for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null 2>&1 && break; sleep 0.25; done
curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null || die "Beacon did not become ready; see $LAB/beacon.log"

info "Seeding live data: 30 status records and 12 pending jobs"
python3 - "$PORT" "$MNT" "$LAB/.lab/manifest.json" <<'PY'
import hashlib, json, os, sys, urllib.request
port, mnt, out = sys.argv[1], sys.argv[2], sys.argv[3]
def post(path, body, key):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Idempotency-Key": key})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())
sensors = {}
for i in range(30):
    s = f"sensor-l04-{i % 10:02d}"
    post("/status", {"sensor_id": s, "status": "ok", "ts": f"2026-09-10T08:{i:02d}:00Z"}, f"seed-{i}")
    sensors[s] = sensors.get(s, 0) + 1
jobs = {}
for i in range(12):
    jid = post("/jobs", {"kind": "rollup", "payload": {"day": f"2026-09-{i + 1:02d}"}}, f"seed-job-{i}")["job_id"]
    p = os.path.join(mnt, "queue", "pending", jid + ".json")
    jobs[jid] = hashlib.sha256(open(p, "rb").read()).hexdigest()
json.dump({"sensors": sensors, "jobs": jobs}, open(out, "w"), indent=1, sort_keys=True)
PY
python3 -c "import os,sys; s=os.statvfs(sys.argv[1]); print(s.f_blocks, s.f_files, s.f_frsize)" "$MNT" > "$LAB/.lab/fs-geometry"

EV="$(evidence_dir "$HERE")"
[ -f "$EV/L04-triage.md" ] || cp "$HERE/assets/triage-template.md" "$EV/L04-triage.md"
LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L04 ready. Beacon: http://127.0.0.1:$PORT  ·  lab filesystem: $MNT  ·  Beacon log: $LAB/beacon.log"
say "Try:  curl -s -X POST -H 'Content-Type: application/json' -d '{\"sensor_id\":\"s-1\",\"status\":\"ok\"}' http://127.0.0.1:$PORT/status"
say "Notes: $EV/L04-triage.md"
