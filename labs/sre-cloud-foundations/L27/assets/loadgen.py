#!/usr/bin/env python3
"""Bounded load generator for L27 (runs in the `loadgen` container).

Open loop: logical requests start at a fixed rate whether or not earlier
ones finished — the way independent users arrive. Hard caps, whatever the
environment says: rate <= 120/s, duration <= 60 s per run, at most 200
logical requests in flight (arrivals beyond that are counted as failed
`client-overload`, never queued), at most 5 retries per request.

Client policy (environment, from work/client.env — the knobs you tune):
  TIMEOUT_MS          per-attempt timeout
  DEADLINE_MS         a logical request counts as a success only if it got a
                      2xx within this time from its start (default 2000)
  RETRIES             extra attempts on timeout / 5xx / connection error
  BACKOFF_MS          base backoff before retry n: BACKOFF_MS * 2**(n-1)
  JITTER              1 = multiply each backoff by a random 0.5–1.5
  HONOR_RETRY_AFTER   1 = wait at least the server's Retry-After on 503
  REUSE_KEY           1 = every attempt of a request sends the SAME Idempotency-Key
  RETRY_BUDGET_PCT    retries allowed as % of logical requests so far (0 = unlimited)

  python3 loadgen.py --label baseline --rps 60 --duration 20 [--target http://api:8080]
  python3 loadgen.py --label step --steps 10,20,30,40,50,60,70 --duration 10

Writes /runs/<label>.json: the summary per step, the policy used, the
servers that answered, /stats samples, and the request keys that were
acknowledged (so data correctness can be checked in the database).
"""
import argparse
import json
import os
import random
import threading
import time
import urllib.error
import urllib.request
import uuid

MAX_RPS, MAX_DURATION, MAX_INFLIGHT, MAX_RETRIES = 120.0, 60.0, 200, 5
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return int(default)


def policy():
    return {
        "TIMEOUT_MS": max(50, env_int("TIMEOUT_MS", 1000)),
        "DEADLINE_MS": max(100, env_int("DEADLINE_MS", 2000)),
        "RETRIES": max(0, min(MAX_RETRIES, env_int("RETRIES", 0))),
        "BACKOFF_MS": max(0, env_int("BACKOFF_MS", 0)),
        "JITTER": 1 if env_int("JITTER", 0) else 0,
        "HONOR_RETRY_AFTER": 1 if env_int("HONOR_RETRY_AFTER", 0) else 0,
        "REUSE_KEY": 1 if env_int("REUSE_KEY", 0) else 0,
        "RETRY_BUDGET_PCT": max(0, min(100, env_int("RETRY_BUDGET_PCT", 0))),
    }


def pct(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    return s[max(0, min(len(s) - 1, int(round(p / 100.0 * (len(s) - 1)))))]


class Run:
    def __init__(self, target, pol, run_id):
        self.target, self.pol, self.run_id = target, pol, run_id
        self.lock = threading.Lock()
        self.inflight = 0
        self.logical = 0
        self.retries_used = 0
        self.results = []      # (ok, latency_s, attempts, final_code)
        self.codes = {}
        self.servers = {}
        self.acked = []

    def budget_ok(self):
        b = self.pol["RETRY_BUDGET_PCT"]
        return b == 0 or self.retries_used < max(1, self.logical * b / 100.0)

    def one(self, n):
        pol = self.pol
        rkey = f"{self.run_id}-{n}"
        body = json.dumps({"request_key": rkey, "sensor_id": f"sensor-{n % 50}", "status": random.choice(["ok", "ok", "warn"])}).encode()
        key = uuid.uuid4().hex
        t0 = time.monotonic()
        attempt, code, ok = 0, 0, False
        while True:
            attempt += 1
            if not pol["REUSE_KEY"] and attempt > 1:
                key = uuid.uuid4().hex
            req = urllib.request.Request(self.target + "/status", data=body, method="POST",
                                         headers={"Content-Type": "application/json", "Idempotency-Key": key})
            retry_after = 0.0
            try:
                with OPENER.open(req, timeout=pol["TIMEOUT_MS"] / 1000.0) as r:
                    code = r.status
                    server = r.headers.get("X-Served-By", "?")
                    r.read()
            except urllib.error.HTTPError as e:
                code = e.code
                server = e.headers.get("X-Served-By", "?")
                try:
                    retry_after = float(e.headers.get("Retry-After") or 0)
                except ValueError:
                    retry_after = 0.0
                e.read()
            except Exception:  # noqa: BLE001 - timeout, refused, reset
                code, server = 0, None
            with self.lock:
                self.codes[str(code)] = self.codes.get(str(code), 0) + 1
                if server:
                    self.servers[server] = self.servers.get(server, 0) + 1
            elapsed = time.monotonic() - t0
            if 200 <= code < 300:
                ok = elapsed * 1000 <= pol["DEADLINE_MS"]
                with self.lock:
                    self.acked.append(rkey)
                break
            if code and code < 500:
                break
            with self.lock:
                can = attempt <= pol["RETRIES"] and self.budget_ok()
                if can:
                    self.retries_used += 1
            if not can:
                break
            wait = pol["BACKOFF_MS"] / 1000.0 * (2 ** (attempt - 1))
            if pol["JITTER"]:
                wait *= 0.5 + random.random()
            if pol["HONOR_RETRY_AFTER"]:
                wait = max(wait, retry_after)
            time.sleep(min(wait, 5.0))
        with self.lock:
            self.results.append((ok, time.monotonic() - t0, attempt, code))
            self.inflight -= 1

    def step(self, rps, duration):
        rps = max(0.5, min(MAX_RPS, rps))
        duration = max(2.0, min(MAX_DURATION, duration))
        start = time.monotonic()
        threads, n, dropped = [], 0, 0
        first = len(self.results)
        while time.monotonic() - start < duration:
            n += 1
            with self.lock:
                if self.inflight >= MAX_INFLIGHT:
                    dropped += 1
                    self.results.append((False, 0.0, 0, -1))
                    self.codes["client-overload"] = self.codes.get("client-overload", 0) + 1
                    go = False
                else:
                    self.inflight += 1
                    self.logical += 1
                    idx = self.logical
                    go = True
            if go:
                t = threading.Thread(target=self.one, args=(idx,), daemon=True)
                t.start()
                threads.append(t)
            time.sleep(max(0.0, start + n / rps - time.monotonic()))
        sent_window = time.monotonic() - start
        for t in threads:
            t.join(timeout=(self.pol["TIMEOUT_MS"] / 1000.0 + 5.5) * (self.pol["RETRIES"] + 1))
        res = self.results[first:]
        oks = [lat for ok, lat, a, c in res if ok]
        attempts = sum(a for ok, lat, a, c in res)
        return {"offered_rps": rps, "duration_s": round(sent_window, 1), "logical": len(res), "ok": len(oks),
                "goodput_rps": round(len(oks) / sent_window, 2), "success_rate": round(len(oks) / len(res), 4) if res else 0.0,
                "p50_ok_ms": round(pct(oks, 50) * 1000, 1), "p99_ok_ms": round(pct(oks, 99) * 1000, 1),
                "p99_all_ms": round(pct([lat for ok, lat, a, c in res], 99) * 1000, 1),
                "amplification": round(attempts / max(1, len(res) - dropped), 2), "client_overload": dropped}


def sample_stats(target):
    try:
        with OPENER.open(target + "/stats", timeout=2) as r:
            return json.loads(r.read())
    except Exception:  # noqa: BLE001
        return None


def main():
    p = argparse.ArgumentParser(description="bounded open-loop load for Beacon ingest")
    p.add_argument("--label", required=True)
    p.add_argument("--target", default=os.environ.get("TARGET", "http://api:8080"))
    p.add_argument("--rps", type=float, default=float(os.environ.get("OFFERED_RPS", "60")))
    p.add_argument("--duration", type=float, default=20.0)
    p.add_argument("--steps", default="", help="comma-separated rates; one step of --duration each")
    p.add_argument("--out-dir", default="/runs")
    a = p.parse_args()
    label = "".join(ch for ch in a.label if ch.isalnum() or ch in "-_")[:40] or "run"
    pol = policy()
    run_id = f"{label}-{uuid.uuid4().hex[:8]}"
    run = Run(a.target.rstrip("/"), pol, run_id)
    rates = [float(x) for x in a.steps.split(",") if x.strip()] if a.steps else [a.rps]
    steps, samples = [], []
    stop = threading.Event()

    def sampler():
        while not stop.is_set():
            s = sample_stats(run.target)
            if s:
                samples.append({"t": round(time.time(), 1), "server": s.get("server"), "busy": s["counters"].get("busy"), "waiting": s["counters"].get("waiting")})
            stop.wait(1.0)

    th = threading.Thread(target=sampler, daemon=True)
    th.start()
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for rate in rates[:10]:
        s = run.step(rate, a.duration)
        steps.append(s)
        print(f"{label}: offered {s['offered_rps']}/s for {s['duration_s']}s -> goodput {s['goodput_rps']}/s, success {s['success_rate'] * 100:.1f}%, "
              f"p50 {s['p50_ok_ms']} ms, p99 {s['p99_ok_ms']} ms (ok) / {s['p99_all_ms']} ms (all), amplification x{s['amplification']}", flush=True)
    stop.set()
    limits = (sample_stats(run.target) or {}).get("limits")
    doc = {"label": label, "run_id": run_id, "started": started, "finished": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "target": run.target, "client_policy": pol, "server_limits_seen": limits, "steps": steps, "codes": run.codes,
           "servers": run.servers, "retries_used": run.retries_used, "stats_samples": samples[-120:], "acked_request_keys": run.acked}
    os.makedirs(a.out_dir, exist_ok=True)
    path = os.path.join(a.out_dir, label + ".json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1)
    print(f"{label}: codes {run.codes}; servers {sorted(run.servers)}; wrote {path} (run id {run_id})", flush=True)


if __name__ == "__main__":
    main()
