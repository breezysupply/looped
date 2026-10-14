#!/usr/bin/env python3
"""L04 validator: measures the lab filesystem, the lab processes and Beacon's
write path directly; reads your triage notes for the discriminating metric.

Checks (critical unless noted):
  lab-fs               the capped image is still what is mounted at /opt/beacon-l04/mnt (same loop image, same size, same inode count)
  headroom             at least 20% of blocks and 20% of inodes free on the lab filesystem
  writes-restored      Beacon accepts POST /status (201) and POST /jobs (202); /ready is 200
  live-data-intact     every seeded status record is still readable and every seeded pending job file is unchanged
  batch-stopped        no process of the CPU fixture is still running (trivially true for the disk variants)
  bystanders-alive     the reporter process still has its original PID; Beacon is running
  bottleneck-evidence  your triage notes quote the measurement that identifies this fault
  notes                triage notes filled in (advisory)
Exit 1 if any check fails.
"""
import hashlib
import json
import os
import re
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

LAB = "/opt/beacon-l04"
MNT = os.path.join(LAB, "mnt")
IMG = os.path.join(LAB, "labfs.img")
PORT = 8084
BASE = f"http://127.0.0.1:{PORT}"
EV = os.path.join(HERE, "evidence")


def pid_alive(pid, needle):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as fh:
            cmd = fh.read().replace(b"\0", b" ").decode("utf-8", "replace")
    except OSError:
        return False, ""
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as fh:
            if fh.read().rsplit(")", 1)[1].split()[0] == "Z":
                return False, cmd
    except OSError:
        return False, cmd
    return needle in cmd, cmd


def read_pid(name):
    try:
        return int((L.read_text(os.path.join(LAB, "run", name)) or "").strip())
    except ValueError:
        return None


def main() -> int:
    args = L.standard_args("L04")
    r = L.Report("L04", "linux-arm64")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(LAB, ".lab", "variant")) or "").strip() or "variant-a"
    if not args.variant:
        r.seed = variant
    if not os.path.isdir(os.path.join(LAB, ".lab")):
        r.check("lab-fs", False, f"{LAB} not set up; run setup.sh")
        return r.finish(args.out, args.explanation)

    # lab-fs: the same capped image is mounted, not a bigger replacement
    code, src, _ = L.sh(["findmnt", "-n", "-o", "SOURCE,FSTYPE", "--target", MNT])
    parts = src.split()
    backing = ""
    if parts and parts[0].startswith("/dev/loop"):
        _, bf, _ = L.sh(["losetup", "-n", "-O", "BACK-FILE", parts[0]])
        backing = bf.strip()
    try:
        geom = [int(x) for x in (L.read_text(os.path.join(LAB, ".lab", "fs-geometry")) or "0 0 0").split()]
    except ValueError:
        geom = [0, 0, 0]
    st = os.statvfs(MNT) if os.path.ismount(MNT) else None
    same = bool(st) and st.f_blocks == geom[0] and st.f_files == geom[1]
    r.check("lab-fs", os.path.ismount(MNT) and backing == IMG and same,
            f"{MNT}: source={parts[0] if parts else 'not mounted'} backing={backing or '?'} type={parts[1] if len(parts) > 1 else '?'} "
            + (f"blocks={st.f_blocks} inodes={st.f_files} (setup: {geom[0]}/{geom[1]})" if st else ""))

    if st:
        st = os.statvfs(MNT)
        free_b = st.f_bavail / st.f_blocks if st.f_blocks else 0
        free_i = st.f_favail / st.f_files if st.f_files else 0
        r.check("headroom", free_b >= 0.20 and free_i >= 0.20,
                f"free blocks {free_b:.0%} ({st.f_bavail * st.f_frsize // 1024} KiB), free inodes {free_i:.0%} ({st.f_favail}) — target ≥20% of each")
    else:
        r.check("headroom", False, "lab filesystem not mounted")

    ready, _, _ = L.http(BASE + "/ready", timeout=3)
    s_code, s_body, _ = L.http(BASE + "/status", "POST", json.dumps({"sensor_id": "sensor-l04-validate", "status": "ok"}).encode(), {"Content-Type": "application/json"}, timeout=5)
    j_code, j_body, _ = L.http(BASE + "/jobs", "POST", json.dumps({"kind": "noop", "payload": {"probe": "validate"}}).encode(), {"Content-Type": "application/json", "Idempotency-Key": "l04-validate-" + uuid.uuid4().hex[:8]}, timeout=5)
    r.check("writes-restored", ready == 200 and s_code == 201 and j_code == 202,
            f"GET /ready -> {ready}; POST /status -> {s_code}; POST /jobs -> {j_code}" + ("" if s_code in (200, 201) else f" ({s_body[:80]})"))
    if j_code == 202:  # remove only the probe job this validator just created
        try:
            jid = json.loads(j_body)["job_id"]
            if re.fullmatch(r"[0-9a-f]{32}", jid):
                os.unlink(os.path.join(MNT, "queue", "pending", jid + ".json"))
        except (ValueError, KeyError, OSError):
            pass

    manifest = {}
    try:
        manifest = json.loads(L.read_text(os.path.join(LAB, ".lab", "manifest.json")) or "{}")
    except ValueError:
        pass
    missing_rec, missing_jobs, changed_jobs = [], [], []
    for sensor, n in sorted(manifest.get("sensors", {}).items()):
        c, b, _ = L.http(BASE + "/status/" + sensor, timeout=3)
        try:
            got = len(json.loads(b).get("records", [])) if c == 200 else -1
        except ValueError:
            got = -1
        if got < n:
            missing_rec.append(f"{sensor} {got}/{n}")
    for jid, digest in sorted(manifest.get("jobs", {}).items()):
        p = os.path.join(MNT, "queue", "pending", jid + ".json")
        if not os.path.exists(p):
            missing_jobs.append(jid[:8])
        elif hashlib.sha256(open(p, "rb").read()).hexdigest() != digest:
            changed_jobs.append(jid[:8])
    n_s, n_j = len(manifest.get("sensors", {})), len(manifest.get("jobs", {}))
    r.check("live-data-intact", bool(manifest) and not (missing_rec or missing_jobs or changed_jobs),
            f"seeded sensors readable: {n_s - len(missing_rec)}/{n_s}; seeded pending jobs intact: {n_j - len(missing_jobs) - len(changed_jobs)}/{n_j}"
            + (f"; missing records {missing_rec[:3]}" if missing_rec else "") + (f"; deleted jobs {missing_jobs[:3]}" if missing_jobs else "") + (f"; modified jobs {changed_jobs[:3]}" if changed_jobs else ""))

    hog_pids = [int(x) for x in (L.read_text(os.path.join(LAB, ".lab", "hog.pids")) or "").split() if x.isdigit()]
    running = [p for p in hog_pids if pid_alive(p, "report-builder.py")[0]]
    r.check("batch-stopped", not running,
            ("no CPU fixture recorded for this variant" if not hog_pids else f"report-builder PIDs {hog_pids}: still running {running}" if running else f"report-builder PIDs {hog_pids}: all stopped"))

    rep = read_pid("reporter.pid")
    rep_ok, _ = pid_alive(rep, "reporter.py") if rep else (False, "")
    bea = read_pid("beacon.pid")
    bea_ok, _ = pid_alive(bea, "beacon") if bea else (False, "")
    if not bea_ok:  # restarted by hand is acceptable: look for the lab's Beacon by its exact config path
        _, out, _ = L.sh(["pgrep", "-f", "beacon api --config " + os.path.join(LAB, "beacon.yaml")])
        bea_ok = bool(out.strip())
    r.check("bystanders-alive", rep_ok and bea_ok,
            f"reporter PID {rep} {'alive' if rep_ok else 'GONE (an unrelated process was killed)'}; Beacon {'running' if bea_ok else 'not running'}")

    notes = L.read_text(os.path.join(EV, "L04-triage.md")) or ""
    body = re.sub(r"<!--.*?-->", "", notes, flags=re.S)
    mnt_lines = [ln for ln in body.splitlines() if "/opt/beacon-l04/mnt" in ln or "/dev/loop" in ln]
    if variant == "variant-a":
        ev_ok = bool(re.search(r"\bUse%", body)) and bool(re.search(r"\bIUse%", body)) and any(re.search(r"\b100%", ln) for ln in mnt_lines)
        what = "df -h and df -i output for the lab mount, with the exhausted one at 100%"
    elif variant == "variant-b":
        ev_ok = bool(re.search(r"\bIUse%", body)) and bool(re.search(r"\bUse%", body)) and any(re.search(r"\b100%", ln) for ln in mnt_lines)
        what = "df -h and df -i output for the lab mount, with the exhausted one at 100%"
    else:
        ev_ok = bool(re.search(r"load average", body)) and any(re.search(r"(^|\D)%d(\D|$)" % p, body) for p in hog_pids) and bool(re.search(r"%CPU|CPU%|\bCPU\b", body))
        what = "a load-average line and a process listing with %CPU that shows the busy PID"
    r.check("bottleneck-evidence", ev_ok, ("triage notes quote " if ev_ok else "triage notes do not yet quote ") + what)
    r.check("notes", len(body) > 500 and re.search(r"H1", body) is not None, f"evidence/L04-triage.md: {len(body)} chars outside comments", critical=False)

    return r.finish(args.out, args.explanation, {"lab_root": LAB, "variant_file": variant, "lab_fs_kib": (st.f_blocks * st.f_frsize // 1024) if st else None})


if __name__ == "__main__":
    sys.exit(main())
