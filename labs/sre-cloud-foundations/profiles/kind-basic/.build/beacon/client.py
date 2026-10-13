"""Bounded synthetic client for Beacon: a fixed request rate for a fixed
duration, never open-ended, with a summary of success rate and latency
percentiles. Used by L04/L21/L27 to generate load you can reason about.

Standard library only (urllib). Retries are deliberately configurable so
L27 can show what an unbounded retry policy does to a saturated backend.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from typing import Any, Dict, List, Optional


def percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(pct / 100.0 * (len(s) - 1)))))
    return s[k]


def one(target: str, timeout_s: float, post: bool, retries: int, backoff_s: float, idem: bool, stats: Dict[str, Any], lock: threading.Lock) -> None:
    body = None
    headers = {"X-Request-Id": uuid.uuid4().hex}
    url = target
    if post:
        body = json.dumps({"sensor_id": f"sensor-{random.randint(1, 50)}", "status": random.choice(["ok", "warn", "ok", "ok"]), "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}).encode()
        headers["Content-Type"] = "application/json"
        if idem:
            headers["Idempotency-Key"] = uuid.uuid4().hex
    attempt = 0
    while True:
        attempt += 1
        t0 = time.monotonic()
        code = 0
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST" if post else "GET")
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                code = resp.status
                resp.read()
        except urllib.error.HTTPError as e:
            code = e.code
        except Exception:  # noqa: BLE001 - timeouts, refused, reset
            code = 0
        dur = time.monotonic() - t0
        with lock:
            stats["attempts"] += 1
            stats["latency"].append(dur)
            stats["codes"][str(code)] = stats["codes"].get(str(code), 0) + 1
        if code and code < 500:
            with lock:
                stats["ok"] += 1
            return
        if attempt > retries:
            with lock:
                stats["failed"] += 1
            return
        with lock:
            stats["retries"] += 1
        time.sleep(backoff_s * (2 ** (attempt - 1)) * (0.5 + random.random()))


def main(argv: Optional[list] = None) -> int:
    p = argparse.ArgumentParser(prog="beacon-client", description="Bounded synthetic load for Beacon")
    p.add_argument("--target", default="http://127.0.0.1:8080/healthz")
    p.add_argument("--rps", type=float, default=5.0, help="requests per second (max 500)")
    p.add_argument("--duration", type=float, default=10.0, help="seconds (max 600)")
    p.add_argument("--timeout", type=float, default=2.0)
    p.add_argument("--post", action="store_true", help="POST sensor status records instead of GET")
    p.add_argument("--retries", type=int, default=0, help="retries per request on 5xx/timeout (lab knob; keep small)")
    p.add_argument("--backoff", type=float, default=0.2, help="base backoff seconds")
    p.add_argument("--no-idempotency-key", action="store_true")
    p.add_argument("--json", action="store_true", help="print the summary as JSON")
    args = p.parse_args(argv)
    rps = max(0.1, min(500.0, args.rps))
    duration = max(1.0, min(600.0, args.duration))
    stats: Dict[str, Any] = {"attempts": 0, "ok": 0, "failed": 0, "retries": 0, "latency": [], "codes": {}}
    lock = threading.Lock()
    threads: List[threading.Thread] = []
    start = time.monotonic()
    n = 0
    while time.monotonic() - start < duration:
        n += 1
        t = threading.Thread(target=one, args=(args.target, args.timeout, args.post, max(0, min(10, args.retries)), args.backoff, not args.no_idempotency_key, stats, lock), daemon=True)
        t.start()
        threads.append(t)
        next_at = start + n / rps
        time.sleep(max(0.0, next_at - time.monotonic()))
    for t in threads:
        t.join(timeout=args.timeout + 5)
    elapsed = time.monotonic() - start
    sent = stats["ok"] + stats["failed"]
    summary = {
        "target": args.target, "rps_requested": rps, "duration_s": round(elapsed, 1), "requests": sent, "attempts": stats["attempts"], "retries": stats["retries"],
        "success_rate": round(stats["ok"] / sent, 4) if sent else 0.0, "codes": stats["codes"],
        "p50_ms": round(percentile(stats["latency"], 50) * 1000, 1), "p95_ms": round(percentile(stats["latency"], 95) * 1000, 1), "p99_ms": round(percentile(stats["latency"], 99) * 1000, 1),
        "achieved_rps": round(sent / elapsed, 2) if elapsed else 0.0,
    }
    if args.json:
        print(json.dumps(summary))
    else:
        print(f"target {summary['target']}  {summary['requests']} requests in {summary['duration_s']}s ({summary['achieved_rps']} rps; asked {rps})")
        print(f"success {summary['success_rate'] * 100:.1f}%  codes {summary['codes']}  retries {summary['retries']}")
        print(f"latency p50 {summary['p50_ms']} ms  p95 {summary['p95_ms']} ms  p99 {summary['p99_ms']} ms")
    return 0 if summary["success_rate"] >= 0.5 else 2


if __name__ == "__main__":
    sys.exit(main())
