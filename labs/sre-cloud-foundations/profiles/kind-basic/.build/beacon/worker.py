"""Beacon worker: takes jobs from the queue, performs a side effect, records
an "effect" row. With idempotency on, a redelivered job (same idempotency
key) is acknowledged without a second effect — the behaviour L24 and S24
test. With it off, every delivery produces an effect, which is the bug.

Effects are appended to a JSON-lines file (worker.effects_path) so a lab
can count them from outside without a database. Metrics are exposed on
/metrics on the worker's own port (default 9101).
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Set

from . import config as cfgmod
from .queue import QueueError, open_queue
from .telemetry import METRICS, log


class Effects:
    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._seen: Set[str] = set()
        if path and os.path.exists(path):
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    try:
                        key = json.loads(line).get("idempotency_key")
                    except json.JSONDecodeError:
                        continue
                    if key:
                        self._seen.add(key)

    def seen(self, key: Optional[str]) -> bool:
        return bool(key) and key in self._seen

    def record(self, job: Dict[str, Any]) -> None:
        row = {"ts": time.time(), "job_id": job.get("id"), "kind": job.get("kind"), "idempotency_key": job.get("idempotency_key"), "attempt": job.get("attempt"), "request_id": job.get("request_id")}
        with self._lock:
            if row["idempotency_key"]:
                self._seen.add(row["idempotency_key"])
            if self.path:
                with open(self.path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(row) + "\n")

    def count(self) -> int:
        if not self.path or not os.path.exists(self.path):
            return 0
        with open(self.path, "r", encoding="utf-8") as fh:
            return sum(1 for _ in fh)


class MetricsHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] in ("/metrics", "/healthz"):
            body = METRICS.render().encode() if self.path.startswith("/metrics") else b"ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()


def process(job: Dict[str, Any], effects: Effects, idempotent: bool, crash_after_take: bool) -> str:
    key = job.get("idempotency_key")
    if idempotent and effects.seen(key):
        METRICS.inc("beacon_worker_jobs_total", {"outcome": "duplicate-skipped"}, help_text="Jobs by outcome")
        log("info", "duplicate delivery skipped", job_id=job.get("id"), idempotency_key=key, attempt=job.get("attempt"))
        return "duplicate-skipped"
    work_ms = int((job.get("payload") or {}).get("work_ms", 50))
    time.sleep(min(work_ms, 2000) / 1000.0)
    effects.record(job)
    if crash_after_take and int(job.get("attempt", 1)) == 1:
        log("error", "simulated crash after side effect, before ack", job_id=job.get("id"))
        os._exit(137)
    METRICS.inc("beacon_worker_jobs_total", {"outcome": "processed"}, help_text="Jobs by outcome")
    log("info", "job processed", job_id=job.get("id"), kind=job.get("kind"), idempotency_key=key, attempt=job.get("attempt"), request_id=job.get("request_id"))
    return "processed"


def main(argv: Optional[list] = None) -> int:
    p = argparse.ArgumentParser(prog="beacon-worker")
    p.add_argument("--config")
    p.add_argument("--metrics-port", type=int, default=int(os.environ.get("BEACON_WORKER_METRICS_PORT", "9101")))
    p.add_argument("--once", action="store_true", help="process the queue until empty, then exit")
    p.add_argument("--crash-after-take", action="store_true", help="lab fault: exit after the side effect but before ack (first attempt only)")
    args = p.parse_args(argv)
    os.environ.setdefault("BEACON_SERVICE_NAME", "beacon-worker")
    try:
        cfg = cfgmod.load(args.config or os.environ.get("BEACON_CONFIG"))
    except cfgmod.ConfigError as e:
        sys.stderr.write(f"FATAL config: {e}\n")
        return 1
    try:
        queue = open_queue(cfg.get("queue", "kind"), cfg.get("queue", "dir") or "", cfg.get("queue", "url") or "", cfg.get("queue", "name") or "beacon-jobs")
    except QueueError as e:
        sys.stderr.write(f"FATAL: {e}\n")
        return 1
    effects = Effects(cfg.get("worker", "effects_path") or "")
    idempotent = bool(cfg.get("worker", "idempotency"))
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda s, f: (log("info", "SIGTERM: finishing current job then exiting"), stopping.set()))
    signal.signal(signal.SIGINT, lambda s, f: stopping.set())
    srv = None
    if args.metrics_port:
        try:
            srv = ThreadingHTTPServer(("0.0.0.0", args.metrics_port), MetricsHandler)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
        except OSError as e:
            log("warning", "metrics port unavailable", port=args.metrics_port, error=e.strerror)
    log("info", "worker started", queue=queue.kind, idempotency=idempotent, effects_path=effects.path or None)
    while not stopping.is_set():
        job = queue.take(timeout_s=float(cfg.get("worker", "poll_s") or 1.0))
        if job is None:
            if args.once:
                break
            continue
        try:
            process(job, effects, idempotent, args.crash_after_take)
            queue.ack(job)
        except Exception as e:  # noqa: BLE001
            METRICS.inc("beacon_worker_jobs_total", {"outcome": "error"}, help_text="Jobs by outcome")
            log("error", "job failed; left in flight for redelivery", job_id=job.get("id"), error=repr(e))
    if srv:
        srv.shutdown()
    log("info", "worker stopped", effects=effects.count())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
