#!/usr/bin/env bash
# L04 fault injection (one of three, all bounded to the lab image or a
# time-limited process):
#   LOOPED_VARIANT=variant-a   fills the image's free blocks       (default)
#   LOOPED_VARIANT=variant-b   uses up the image's free inodes
#   LOOPED_VARIANT=variant-c   starts a CPU-bound batch fixture (max 4 workers, exits by itself after 600 s)
# The validator reads .lab/ to know what to expect; it never prints the cause.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l04
MNT="$LAB/mnt"
mountpoint -q "$MNT" || die "$MNT is not mounted; run setup.sh first"
# refuse to write anywhere that is not the lab image
src="$(findmnt -n -o SOURCE --target "$MNT" 2>/dev/null || true)"
case "$src" in /dev/loop*) ;; *) die "$MNT is not backed by a loop device ($src); refusing" ;; esac
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac
printf '%s\n' "$V" > "$LAB/.lab/variant"
: > "$LAB/.lab/hog.pids"

case "$V" in
  variant-a)
    python3 - "$MNT/logs" <<'PY'
import errno, os, sys, time
d = sys.argv[1]
line = ('{"ts":"2026-09-0%dT03:14:15Z","level":"debug","service":"beacon-api","msg":"request trace",'
        '"route":"/status","headers_allowlisted":true,"payload_bytes":214,"trace":"' + "x" * 160 + '"}\n')
chunk = "".join(line % (1 + i % 9) for i in range(4096)).encode()
n = 1
old = time.time() - 9 * 86400
try:
    while True:
        p = os.path.join(d, f"beacon-debug.log.{n}")
        with open(p, "wb") as fh:
            for _ in range(2):
                fh.write(chunk)
        os.utime(p, (old + n * 3600, old + n * 3600))
        n += 1
except OSError as e:
    if e.errno != errno.ENOSPC:
        raise
# top up the last few blocks in small writes so nothing is left over
try:
    with open(os.path.join(d, "beacon-debug.log"), "ab", buffering=0) as fh:
        while True:
            fh.write(chunk[:4096])
except OSError as e:
    if e.errno != errno.ENOSPC:
        raise
PY
    ;;
  variant-b)
    python3 - "$MNT/tmp/sessions" <<'PY'
import errno, os, sys, time
d = sys.argv[1]
old = time.time() - 12 * 86400
n = 0
try:
    while True:
        p = os.path.join(d, f"sess-{n:06d}")
        fd = os.open(p, os.O_CREAT | os.O_WRONLY | os.O_EXCL, 0o600)
        os.write(fd, b"uid=lab-user;exp=2026-09-01T00:00:00Z\n")
        os.close(fd)
        os.utime(p, (old, old))
        n += 1
except OSError as e:
    if e.errno != errno.ENOSPC:
        raise
PY
    ;;
  variant-c)
    W=$(nproc 2>/dev/null || echo 2); [ "$W" -gt 4 ] && W=4
    setsid timeout 900 python3 "$LAB/bin/report-builder.py" --rebuild-all --workers "$W" --max-seconds 600 >/dev/null 2>&1 < /dev/null &
    sleep 1
    pgrep -f "$LAB/bin/report-builder.py" > "$LAB/.lab/hog.pids" || true
    ;;
esac
sync
info "fault injected ($V)."
