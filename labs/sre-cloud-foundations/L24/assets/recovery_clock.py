#!/usr/bin/env python3
"""recovery_clock.py — measure your actual recovery interval in L24.

    python3 recovery_clock.py start                 # when you begin recovering (before choosing a backup)
    ... choose/take a backup, create a fresh restore target, restore, run verify_restore.py --report ...
    python3 recovery_clock.py stop --report ../work/verify-report.json --backup ../work/backups/<file>.dump
    python3 recovery_clock.py show

The interval ends when verification passed (the report's finished_at), not when
pg_restore returned: an unverified restore is not a recovery. Writes
work/recovery.json. `start` refuses to overwrite a running clock unless
--force. The numbers are yours; the validator cross-checks them against the
restore container's creation time and the verification report.
"""
import argparse
import hashlib
import json
import os
import sys
import time

WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "work")
CLOCK = os.path.join(WORK, "recovery.json")


def iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def load():
    try:
        with open(CLOCK, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save(doc):
    os.makedirs(WORK, exist_ok=True)
    with open(CLOCK, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("start")
    s.add_argument("--force", action="store_true")
    p = sub.add_parser("stop")
    p.add_argument("--report", required=True, help="verify_restore.py --report output")
    p.add_argument("--backup", required=True, help="the backup file you restored from")
    sub.add_parser("show")
    a = ap.parse_args()
    doc = load()
    if a.cmd == "start":
        if doc.get("started_at") and not doc.get("verified_at") and not a.force:
            print(f"a clock is already running since {iso(doc['started_at'])}; use --force to restart it", file=sys.stderr)
            return 1
        doc = {"started_at": time.time()}
        save(doc)
        print(f"recovery clock started at {iso(doc['started_at'])}")
        return 0
    if a.cmd == "stop":
        if not doc.get("started_at"):
            print("no clock running; run `start` first", file=sys.stderr)
            return 1
        try:
            with open(a.report, "r", encoding="utf-8") as fh:
                rep = json.load(fh)
        except (OSError, ValueError) as e:
            print(f"cannot read report {a.report}: {e}", file=sys.stderr)
            return 1
        if not rep.get("ok"):
            print("the report says the restore is NOT verified; the clock keeps running", file=sys.stderr)
            return 1
        if rep.get("finished_at", 0) < doc["started_at"]:
            print("that report is older than the clock start; verify again", file=sys.stderr)
            return 1
        with open(a.backup, "rb") as fh:
            digest = hashlib.sha256(fh.read()).hexdigest()
        doc.update(verified_at=rep["finished_at"], interval_s=round(rep["finished_at"] - doc["started_at"], 1),
                   backup_file=os.path.abspath(a.backup), backup_sha256=digest, report=os.path.abspath(a.report), target=rep.get("target"))
        save(doc)
        print(f"recovery verified at {iso(doc['verified_at'])}: interval {doc['interval_s']} s ({doc['interval_s'] / 60:.1f} min)")
        return 0
    if not doc:
        print("no clock")
        return 1
    print(json.dumps(doc, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
