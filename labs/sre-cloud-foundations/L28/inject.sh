#!/usr/bin/env bash
# L28 incident: assembles work/backups/ (files + CATALOG.json) for the variant
# from the private pool setup.sh produced, then makes the primary database
# unable to start (inside its own lab volume only) and records the time.
#   variant-a  one way the backup shelf can mislead you
#   variant-b  another way
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L28_PROJECT"
l28_guard
POOL="$WORK/.l28/pool"
[ -f "$POOL/hourly-1300.dump" ] || die "no backup pool; run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V (variant-a | variant-b)" ;; esac

python3 - "$WORK/backups" "$V" "$POOL" "$WORK/.l28/choice" <<'PY'
import hashlib, json, os, shutil, sys
b, variant, pool, choice = sys.argv[1:5]
day = "20250311"
for f in os.listdir(b):
    if f.endswith(".dump") or f == "CATALOG.json":
        os.remove(os.path.join(b, f))
def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()
entries = [
    {"file": f"beacon-{day}T0200Z.dump", "taken_at": "2025-03-11T02:00:04Z", "job": "nightly-full", "source": "db (primary)", "pool": "nightly-0200.dump"},
    {"file": f"beacon-{day}T1200Z.dump", "taken_at": "2025-03-11T12:00:03Z", "job": "hourly", "source": "db (primary)", "pool": "hourly-1200.dump"},
    {"file": f"beacon-{day}T1300Z.dump", "taken_at": "2025-03-11T13:00:05Z", "job": "hourly", "source": "db (primary)", "pool": "hourly-1300.dump"},
]
if variant == "variant-b":
    entries.append({"file": f"beacon-{day}T1330Z.dump", "taken_at": "2025-03-11T13:30:02Z", "job": "hourly (moved to standby to offload the primary)",
                    "source": "standby-2 (asynchronous replica)", "pool": "standby-1040.dump"})
for e in entries:
    p = os.path.join(b, e["file"])
    shutil.copyfile(os.path.join(pool, e.pop("pool")), p)
    os.chmod(p, 0o644)
    e["sha256"], e["bytes"] = sha(p), os.path.getsize(p)
if variant == "variant-a":
    # the 13:00 upload was cut short after the job had recorded its checksum
    p = os.path.join(b, entries[2]["file"])
    data = open(p, "rb").read()
    open(p, "wb").write(data[: len(data) * 55 // 100])
    good = entries[1]["file"]
else:
    good = entries[2]["file"]
json.dump({"note": "Backup catalog written by the backup jobs. Times are when the job ran.", "backups": entries}, open(os.path.join(b, "CATALOG.json"), "w"), indent=2)
open(choice, "w").write(good + "\n")
PY

info "incident: the primary database can no longer start"
l28_dc stop db >/dev/null 2>&1 || true
docker run --rm --name looped-l28-inject --label looped.lab/id=L28 --entrypoint rm \
  -v looped-l28-primary:/var/lib/postgresql/data "$L28_PG_IMAGE" -f /var/lib/postgresql/data/global/pg_control
l28_dc start db >/dev/null 2>&1 || true
date -u +%Y-%m-%dT%H:%M:%SZ > "$WORK/.l28/fault-at"
printf '%s\n' "$V" > "$WORK/.variant"

cat > "$WORK/TICKET.md" <<T
# INC-0311 — Beacon status API failing (declared $(cat "$WORK/.l28/fault-at"))

Alert: \`beacon-status /ready\` returns 503 (http://127.0.0.1:18028/ready). Field sensors cannot
submit and the status page is empty. On-call found the \`db\` container exited and it does not
stay up. No change was deployed today.

You are incident commander and operator for this rehearsal (name a stand-in for each other role).
Keep a time-stamped update log in work/incident/updates.md (real UTC time, at most 30 minutes
between updates), decide what is in and out of scope, restore service from the backups in
work/backups/ with the least data loss you can defend, prove the restored data is right, and
record follow-ups with owners in work/incident/followups.md.

Note: the records are synthetic and dated $L28_DAY; your updates use today's real time.
T
info "variant $V; incident declared at $(cat "$WORK/.l28/fault-at"); read $WORK/TICKET.md"
