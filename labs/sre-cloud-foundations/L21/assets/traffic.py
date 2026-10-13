#!/usr/bin/env python3
"""Bounded synthetic traffic for L21: a fixed number of seconds at a fixed rate,
never open-ended. Mix: GET /sensors/s-NNNN (a few hundred sensors) and
POST /jobs, each request from one of --users synthetic user ids.

    python3 traffic.py --seconds 60 --rps 4
"""
import argparse
import json
import random
import sys
import threading
import time
import urllib.request

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # local endpoint: never via a proxy


def one(base, rng, users, stats):
    user = "u-%05d" % rng.randrange(users)
    if rng.random() < 0.7:
        req = urllib.request.Request(f"{base}/sensors/s-{rng.randrange(400):04d}", headers={"X-User-Id": user})
    else:
        req = urllib.request.Request(f"{base}/jobs", data=json.dumps({"sensor_id": f"s-{rng.randrange(400):04d}"}).encode(),
                                     headers={"X-User-Id": user, "Content-Type": "application/json"}, method="POST")
    t0 = time.monotonic()
    try:
        with OPENER.open(req, timeout=10) as r:
            r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception:  # noqa: BLE001
        code = 0
    with stats["lock"]:
        stats["n"] += 1
        stats["lat"].append(time.monotonic() - t0)
        stats["codes"][code] = stats["codes"].get(code, 0) + 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:18521")
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--rps", type=float, default=4.0)
    ap.add_argument("--users", type=int, default=500)
    ap.add_argument("--seed", type=int, default=21)
    a = ap.parse_args()
    if a.seconds > 600 or a.rps > 50:
        sys.exit("bounded on purpose: at most 600 s and 50 rps")
    rng = random.Random(a.seed)
    stats = {"n": 0, "lat": [], "codes": {}, "lock": threading.Lock()}
    end = time.time() + a.seconds
    threads = []
    while time.time() < end:
        t = threading.Thread(target=one, args=(a.base, random.Random(rng.random()), a.users, stats), daemon=True)
        t.start()
        threads.append(t)
        time.sleep(1.0 / a.rps)
    for t in threads:
        t.join(timeout=15)
    lat = sorted(stats["lat"]) or [0]
    p95 = lat[min(len(lat) - 1, int(0.95 * len(lat)))]
    print(json.dumps({"requests": stats["n"], "codes": stats["codes"], "p50_ms": round(lat[len(lat) // 2] * 1000, 1), "p95_ms": round(p95 * 1000, 1)}))


if __name__ == "__main__":
    main()
