#!/usr/bin/env python3
"""Deterministic synthetic Beacon logs for L07 (standard library only).

  gen_logs.py incident --variant variant-a --out FILE   the variant's "incident" log (~2,000 rows)
  gen_logs.py cases --out-dir DIR                         edge-case files the validator compares against the reference
  gen_logs.py big --lines N --out FILE                    a large well-formed log for the memory check

Same arguments, same bytes: a seeded random.Random, no clock, no environment.
"""
import argparse
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone

SERVICES = ["beacon-api", "beacon-worker", "beacon-client", "beacon-gateway"]
ERRORS = ["store unavailable", "queue full", "upstream timeout", "job handler crashed", "bad gateway", "idempotency conflict"]
OFFSETS = [0, 2, -5, 5.5, -3]


def stamp(dt, off_h, rnd):
    tz = timezone(timedelta(hours=off_h))
    local = dt.astimezone(tz)
    if off_h == 0 and rnd.random() < 0.5:
        return local.strftime("%Y-%m-%dT%H:%M:%SZ")
    return local.isoformat(timespec="seconds")


def row(rnd, dt, offsets):
    svc = rnd.choice(SERVICES)
    r = rnd.random()
    rec = {"ts": stamp(dt, rnd.choice(offsets), rnd), "service": svc}
    if r < 0.08:
        rec.update(status=rnd.choice([500, 502, 503, 504]), level="error", error=rnd.choice(ERRORS))
    elif r < 0.10:
        rec.update(status=200, level="error", msg=rnd.choice(["retry budget exhausted", "slow consumer"]))
    elif r < 0.15:
        rec.update(status=rnd.choice([400, 404, 409, 429]), level="warn", msg="client error")
    else:
        rec.update(status=rnd.choice([200, 200, 200, 201, 202, 204]), level="info", msg="request")
    if rnd.random() < 0.3:
        rec["request_id"] = "%016x" % rnd.getrandbits(64)
    return rec


def incident(variant, out):
    seed = {"variant-a": 7101, "variant-b": 7102, "variant-c": 7103}.get(variant, 7100)
    rnd = random.Random(seed)
    offsets = OFFSETS if variant != "variant-b" else [0, -7, 9]
    t0 = datetime(2026, 9, 14, 6, 0, tzinfo=timezone.utc)
    with open(out, "w", encoding="utf-8") as fh:
        for i in range(2000):
            dt = t0 + timedelta(seconds=7 * i + rnd.randint(0, 6))
            rec = row(rnd, dt, offsets)
            if variant == "variant-b" and i == 1376:
                del rec["service"]  # one row from a component that logs without a service name
            fh.write(json.dumps(rec) + "\n")
            if rnd.random() < 0.01:
                fh.write("\n")


def cases(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    rnd = random.Random(4242)
    t0 = datetime(2026, 9, 15, 23, 50, tzinfo=timezone.utc)
    good = [json.dumps(row(rnd, t0 + timedelta(minutes=i), OFFSETS)) for i in range(40)]
    files = {
        "normal.jsonl": good,
        "empty.jsonl": [],
        "blank-lines-only.jsonl": ["", "   ", ""],
        "malformed-json.jsonl": good[:5] + ['{"ts": "2026-09-15T23:59:00Z", "service": "beacon-api", "status": 5'] + good[5:9],
        "missing-key.jsonl": good[:7] + ['{"ts": "2026-09-15T23:59:00Z", "status": 500, "error": "no service"}'] + good[7:9],
        "string-status.jsonl": good[:3] + ['{"ts": "2026-09-15T23:59:00Z", "service": "beacon-api", "status": "503"}'],
        "naive-timestamp.jsonl": good[:2] + ['{"ts": "2026-09-15T23:59:00", "service": "beacon-api", "status": 200}'],
        "not-an-object.jsonl": good[:4] + ['["beacon-api", 500]'],
        "midnight-offsets.jsonl": [
            '{"ts": "2026-09-16T01:30:00+02:00", "service": "beacon-api", "status": 200}',
            '{"ts": "2026-09-15T19:10:00-05:00", "service": "beacon-api", "status": 503, "error": "store unavailable"}',
            '{"ts": "2026-09-15T23:50:00Z", "service": "beacon-worker", "status": 200}',
            '{"ts": "2026-09-16T05:20:00+05:30", "service": "beacon-worker", "status": 500, "error": "queue full"}',
        ],
        "ties.jsonl": [json.dumps({"ts": "2026-09-15T10:00:%02dZ" % i, "service": "beacon-api", "status": 500, "error": m})
                       for i, m in enumerate(["omega", "beta", "omega", "beta", "gamma", "alpha", "alpha", "gamma"])],
        "level-only-errors.jsonl": [json.dumps({"ts": "2026-09-15T10:00:0%dZ" % i, "service": "beacon-worker", "status": 200, "level": lvl, "msg": "m%d" % (i % 2)})
                                    for i, lvl in enumerate(["error", "info", "fatal", "warn"])],
        "no-errors.jsonl": [json.dumps({"ts": "2026-09-15T10:00:0%dZ" % i, "service": "beacon-api", "status": 200}) for i in range(5)],
    }
    for name, lines in files.items():
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as fh:
            fh.write("".join(line + "\n" for line in lines))
    return sorted(files)


def big(lines, out):
    rnd = random.Random(99)
    t0 = datetime(2026, 9, 1, tzinfo=timezone.utc)
    with open(out, "w", encoding="utf-8") as fh:
        for i in range(lines):
            rec = row(rnd, t0 + timedelta(seconds=i), [0, 2])
            rec["request_id"] = "%016x" % i  # unique per row: a tool that keeps rows grows with the file
            fh.write(json.dumps(rec) + "\n")


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("incident")
    a.add_argument("--variant", default="variant-a")
    a.add_argument("--out", required=True)
    c = sub.add_parser("cases")
    c.add_argument("--out-dir", required=True)
    b = sub.add_parser("big")
    b.add_argument("--lines", type=int, default=200000)
    b.add_argument("--out", required=True)
    args = p.parse_args()
    if args.cmd == "incident":
        incident(args.variant, args.out)
    elif args.cmd == "cases":
        print("\n".join(cases(args.out_dir)))
    else:
        big(args.lines, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
