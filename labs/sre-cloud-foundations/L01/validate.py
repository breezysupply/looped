#!/usr/bin/env python3
"""L01 validator: queries the VM, the lab install and your hypothesis log.

Checks (critical unless noted):
  vm-marker        running inside the course VM, architecture recorded
  tool-inventory   evidence/L01-inventory.txt exists with arch and python lines
  hypothesis-log   evidence/L01-hypotheses.md has Observation, 2+ Hypotheses, Discriminating check, Result
  reproduced       the log quotes the fixture's actual FATAL line (observation, not paraphrase)
  fixed            the launcher now starts Beacon and /healthz answers 200
  minimal-fix      the fix touched the launcher/environment only: config still in place, no broad permission change (non-critical: advisory)
  no-unsafe        nothing under /opt/beacon-l01 became world-writable
Exit 1 if any check fails. Writes the evidence JSON for the app.
"""
import os
import re
import signal
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

LAB = "/opt/beacon-l01"
HERE = os.path.dirname(os.path.abspath(__file__))
EV = os.path.join(HERE, "evidence")
SIGNATURE = {
    "variant-a": r"FATAL config: .*config/beacon\.yaml: no such file or directory",
    "variant-b": r"FATAL config: .*store\.url is required",
}


def main() -> int:
    args = L.standard_args("L01")
    r = L.Report("L01", "linux-arm64")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(LAB, ".variant")) or "").strip() or "variant-a"
    if not args.variant:
        r.seed = variant

    marker = L.read_text("/etc/looped-vm")
    override = bool(os.environ.get("LOOPED_ALLOW_ANY_LINUX"))
    r.check("vm-marker", (bool(marker) or override) and os.uname().sysname == "Linux",
            f"/etc/looped-vm={'present' if marker else 'missing'} arch={os.uname().machine}" + (" (LOOPED_ALLOW_ANY_LINUX: a disposable Linux box, not the course VM)" if override and not marker else ""))

    inv = L.read_text(os.path.join(EV, "L01-inventory.txt")) or ""
    r.check("tool-inventory", "arch:" in inv and "python3:" in inv, f"inventory lines: {len(inv.splitlines())}")

    log = L.read_text(os.path.join(EV, "L01-hypotheses.md")) or ""
    sections = {k: bool(re.search(r"^#+\s*" + k, log, re.I | re.M)) for k in ("Observation", "Hypotheses", "Discriminating check", "Result")}
    n_hyp = len(re.findall(r"^\s*(?:[-*]|\d+\.)\s*H\d", log, re.M)) or len(re.findall(r"^\s*(?:[-*]|\d+\.)\s+\S", log.split("Discriminating", 1)[0].split("Hypotheses", 1)[-1], re.M))
    r.check("hypothesis-log", all(sections.values()) and n_hyp >= 2 and len(log) > 200, f"sections={sections} hypotheses={n_hyp} chars={len(log)}")

    sig = SIGNATURE[variant]
    quoted = bool(re.search(sig, log))
    r.check("reproduced", quoted, "the exact FATAL line is quoted in the log" if quoted else "the log does not quote the FATAL line the launcher printed (copy it verbatim)")

    # fixed: start the launcher, probe, stop. Bounded to 8 seconds.
    ok, obs = False, ""
    if os.path.exists(os.path.join(LAB, "run-beacon.sh")):
        proc = subprocess.Popen(["bash", os.path.join(LAB, "run-beacon.sh")], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        try:
            deadline = time.time() + 8
            while time.time() < deadline and not ok:
                code, body, _ = L.http("http://127.0.0.1:8080/healthz", timeout=1)
                if code == 200:
                    ok = True
                    obs = "launcher started; /healthz 200"
                    break
                if proc.poll() is not None:
                    obs = "launcher exited with " + str(proc.returncode) + ": " + (proc.stdout.read() if proc.stdout else "")[-300:].strip()
                    break
                time.sleep(0.5)
            if not ok and not obs:
                obs = "no 200 from /healthz within 8s"
        finally:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=5)
            except Exception:  # noqa: BLE001
                pass
    else:
        obs = "launcher missing"
    r.check("fixed", ok, obs)

    cfg = os.path.join(LAB, "config", "beacon.yaml")
    cfg_ok = os.path.exists(cfg)
    r.check("minimal-fix", cfg_ok, "config still at its original path" if cfg_ok else "config/beacon.yaml was moved or deleted — fix the launcher, not the file layout", critical=False)

    ww = []
    for root, dirs, files in os.walk(LAB):
        for name in dirs + files:
            p = os.path.join(root, name)
            if L.world_writable(p):
                ww.append(p)
    r.check("no-unsafe", not ww, "no world-writable paths" if not ww else "world-writable: " + ", ".join(ww[:5]))

    return r.finish(args.out, args.explanation, {"lab_root": LAB, "variant_file": variant})


if __name__ == "__main__":
    sys.exit(main())
