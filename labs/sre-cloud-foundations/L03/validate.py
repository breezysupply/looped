#!/usr/bin/env python3
"""L03 validator: real systemd, process, socket and file state.

Checks:
  unit-active        systemctl is-active beacon == active            (critical)
  runs-as-beacon     MainPID's user is beacon, not root              (critical)
  socket-owned       0.0.0.0:8080 (or [::]:8080) is listened on by MainPID (critical)
  user-path          GET /healthz → 200 and /version → 1.4.0         (critical)
  config-not-open    /etc/beacon/beacon.yaml is not world-readable/writable (critical)
  no-world-writable  nothing under /opt/beacon or /etc/beacon is world-writable (critical)
  journal-clean      no FATAL in the last 20 journal lines           (non-critical)
  diagnosis-notes    evidence/L03-diagnosis.md names the directives and the cause (non-critical)
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> int:
    args = L.standard_args("L03")
    r = L.Report("L03", "linux-arm64")
    L.apply_args(r, args)
    if not args.variant:
        r.seed = (L.read_text("/etc/beacon/.variant") or "variant-a").strip()

    code, out, _ = L.sh(["systemctl", "is-active", "beacon"], timeout=10)
    r.check("unit-active", out.strip() == "active", f"is-active: {out.strip() or code}")

    props = L.systemd_show("beacon", ["MainPID", "User", "ExecStart", "WorkingDirectory", "NRestarts"])
    pid = props.get("MainPID", "0")
    user = ""
    if pid and pid != "0":
        c, o, _ = L.sh(["ps", "-o", "user=", "-p", pid], timeout=10)
        user = o.strip()
    r.check("runs-as-beacon", user == "beacon", f"MainPID={pid} user={user or '?'} User={props.get('User')} restarts={props.get('NRestarts')}")

    socks = L.listening(8080)
    owned = any(("pid=" + pid + ",") in s.get("process", "") or ("pid=" + pid + ")") in s.get("process", "") for s in socks) if pid not in ("", "0") else False
    r.check("socket-owned", owned and any(s["local"].startswith(("0.0.0.0", "*", "[::]")) for s in socks), f"listeners on 8080: {socks}")

    h, _, _ = L.http("http://127.0.0.1:8080/healthz")
    v, body, _ = L.http("http://127.0.0.1:8080/version")
    r.check("user-path", h == 200 and v == 200 and '"1.4.0"' in body, f"/healthz={h} /version={v}")

    fi = L.file_info("/etc/beacon/beacon.yaml")
    mode = int(fi["mode"], 8) if fi else 0
    r.check("config-not-open", bool(fi) and mode & 0o006 == 0, f"config {fi}")

    ww = []
    for base in ("/opt/beacon", "/etc/beacon"):
        for root, dirs, files in os.walk(base):
            for n in dirs + files:
                p = os.path.join(root, n)
                if L.world_writable(p):
                    ww.append(p)
    r.check("no-world-writable", not ww, "clean" if not ww else "world-writable: " + ", ".join(ww[:5]))

    j = L.journal_tail("beacon", 20)
    r.check("journal-clean", "FATAL" not in j.splitlines()[-5:].__str__(), f"last lines: {j.strip().splitlines()[-2:] if j.strip() else 'empty'}", critical=False)

    notes = L.read_text(os.path.join(HERE, "evidence", "L03-diagnosis.md")) or ""
    directives = sum(1 for d in ("User=", "WorkingDirectory=", "ExecStart=", "Restart=", "ProtectSystem=") if d in notes)
    r.check("diagnosis-notes", directives >= 4 and re.search(r"(?i)cause", notes) is not None and len(notes) > 300, f"directives explained: {directives}/5, chars={len(notes)}", critical=False)

    return r.finish(args.out, args.explanation, {"unit": "beacon.service"})


if __name__ == "__main__":
    sys.exit(main())
