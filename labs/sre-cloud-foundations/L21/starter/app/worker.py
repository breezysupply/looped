"""Beacon worker — L21 lab copy. This file is yours to change.

Takes jobs from the directory queue (/queue/pending -> inflight -> done),
"refreshes" the sensor (a little work), logs one line per job and exposes
/metrics on :9101. Restart after editing: `docker restart looped-l21-worker`.
"""
from __future__ import annotations

import json
import os
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional

from .telemetry import METRICS, Tracer, log, metrics_response

QUEUE = os.environ.get("L21_QUEUE_DIR", "/queue")
TRACER = Tracer()
STOP = threading.Event()


class MetricsHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/metrics"):
            body, ctype = metrics_response(self.headers.get("Accept", ""))
        else:
            body, ctype = b"ok\n", "text/plain"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def take() -> Optional[Dict[str, Any]]:
    pending, inflight = os.path.join(QUEUE, "pending"), os.path.join(QUEUE, "inflight")
    os.makedirs(pending, exist_ok=True)
    os.makedirs(inflight, exist_ok=True)
    for name in sorted(n for n in os.listdir(pending) if n.endswith(".json")):
        src, dst = os.path.join(pending, name), os.path.join(inflight, name)
        try:
            os.replace(src, dst)
        except FileNotFoundError:
            continue
        with open(dst, "r", encoding="utf-8") as fh:
            job = json.load(fh)
        job["_path"] = dst
        return job
    return None


def done(job: Dict[str, Any]) -> None:
    d = os.path.join(QUEUE, "done")
    os.makedirs(d, exist_ok=True)
    os.replace(job["_path"], os.path.join(d, os.path.basename(job["_path"])))


def process(job: Dict[str, Any]) -> None:
    t0 = time.monotonic()
    with TRACER.start("process job", kind="consumer", **{"job.id": job.get("id"), "sensor.id": job.get("sensor_id")}) as span:
        time.sleep(0.02)  # the refresh itself
        wait = time.time() - float(job.get("enqueued_at") or time.time())
        span.set("queue.wait_ms", round(wait * 1000, 1))
    METRICS.inc("beacon_l21_jobs_processed_total", {"outcome": "ok"}, help_text="Jobs processed by outcome")
    METRICS.observe("beacon_l21_job_duration_seconds", time.monotonic() - t0, help_text="Job processing time", trace_id=span.trace_id)
    log("info", "job processed", trace_id=span.trace_id, span_id=span.span_id, job_id=job.get("id"), sensor_id=job.get("sensor_id"),
        queue_wait_ms=round(wait * 1000, 1))


def main() -> int:
    srv = ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("METRICS_PORT", "9101"))), MetricsHandler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    signal.signal(signal.SIGTERM, lambda s, f: STOP.set())
    log("info", "beacon-l21 worker started", queue=QUEUE)
    while not STOP.is_set():
        job = take()
        if job is None:
            time.sleep(0.2)
            continue
        try:
            process(job)
        finally:
            done(job)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
