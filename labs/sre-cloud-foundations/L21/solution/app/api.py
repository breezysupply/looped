"""Beacon API — L21 lab copy (a trimmed copy of beacon/beacon/api.py; the
course's beacon/ directory is not changed). This file is yours to change.

Endpoints
  GET  /healthz            liveness
  GET  /metrics            Prometheus text or OpenMetrics (negotiated)
  GET  /sensors/{id}       sensor view: registry lookup (dependency) + payload checksum (local CPU)
  POST /jobs               enqueue {"sensor_id": ...} for the worker (directory queue)

Config: /lab/config/config.json (work/config/config.json on your machine),
read at start-up: `docker restart looped-l21-api` after editing it.
"""
from __future__ import annotations

import hashlib
import json
import os
import signal
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Tuple

from .telemetry import METRICS, Tracer, log, metrics_response, parse_traceparent

CONFIG_PATH = os.environ.get("L21_CONFIG", "/lab/config/config.json")
ROUTES = {"/healthz", "/metrics", "/jobs"}
TRACER = Tracer()
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def load_config() -> Dict[str, Any]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    cfg.setdefault("registry_url", "http://looped-l21-registry:8081")
    cfg.setdefault("registry_timeout_ms", 5000)
    cfg.setdefault("checksum_rounds", 2000)
    cfg.setdefault("queue_dir", "/queue")
    return cfg


CFG = load_config()


def route_of(path: str) -> str:
    """The route TEMPLATE: bounded, whatever the path holds."""
    if path.startswith("/sensors/"):
        return "/sensors/{id}"
    return path if path in ROUTES else "/other"


def status_class(code: int) -> str:
    return f"{code // 100}xx"


def registry_lookup(sensor: str, parent) -> Tuple[Dict[str, Any], str]:
    """Call the sensor registry (another team's service). Returns (data, outcome)."""
    with TRACER.start("registry GET /registry/{id}", trace_id=parent.trace_id, parent_id=parent.span_id, kind="client",
                      **{"peer.service": "beacon-l21-registry", "sensor.id": sensor}) as span:
        t0 = time.monotonic()
        req = urllib.request.Request(f"{CFG['registry_url']}/registry/{sensor}", headers={"traceparent": span.traceparent})
        try:
            with OPENER.open(req, timeout=CFG["registry_timeout_ms"] / 1000.0) as r:
                data, outcome = json.loads(r.read() or b"{}"), "ok"
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            data, outcome = {"registry": "unavailable"}, "error"
            span.error = True
            span.set("error.message", str(e)[:120])
        dur = time.monotonic() - t0
        span.set("outcome", outcome)
        METRICS.observe("beacon_l21_dependency_duration_seconds", dur, {"dependency": "registry", "outcome": outcome},
                        help_text="Time spent calling a dependency", trace_id=span.trace_id)
        return data, outcome


def checksum(payload: bytes, parent) -> str:
    """Payload integrity check (local CPU work; cost grows with checksum_rounds)."""
    with TRACER.start("checksum", trace_id=parent.trace_id, parent_id=parent.span_id, rounds=CFG["checksum_rounds"]):
        return hashlib.pbkdf2_hmac("sha256", payload, b"beacon-l21", int(CFG["checksum_rounds"])).hex()[:16]


def enqueue(job: Dict[str, Any]) -> str:
    job.setdefault("id", uuid.uuid4().hex)
    pending = os.path.join(CFG["queue_dir"], "pending")
    os.makedirs(pending, exist_ok=True)
    tmp = os.path.join(pending, "." + job["id"] + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(job, fh)
    os.replace(tmp, os.path.join(pending, job["id"] + ".json"))
    return job["id"]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Beacon-L21/1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def _send(self, code: int, body: bytes, ctype: str, extra: Optional[Dict[str, str]] = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _serve(self, method: str) -> None:
        t0 = time.monotonic()
        path = self.path.split("?", 1)[0]
        route = route_of(path)
        user_id = self.headers.get("X-User-Id", "")
        if path == "/metrics":
            body, ctype = metrics_response(self.headers.get("Accept", ""))
            self._send(200, body, ctype)
            return
        trace_id, parent = parse_traceparent(self.headers.get("traceparent"))
        span = TRACER.start(f"{method} {route}", trace_id=trace_id, parent_id=parent, kind="server",
                            **{"http.request.method": method, "http.route": route})
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            code, payload = self.handle_route(method, path, raw, span)
        except Exception as e:  # noqa: BLE001
            log("error", "unhandled exception", trace_id=span.trace_id, error=repr(e))
            code, payload = 500, {"error": "internal error"}
        body = (json.dumps(payload) + "\n").encode()
        self._send(code, body, "application/json", {"traceparent": span.traceparent, "X-Trace-Id": span.trace_id})
        span.set("http.response.status_code", code)
        span.error = code >= 500
        span.end()
        dur = time.monotonic() - t0
        METRICS.inc("beacon_l21_requests_total", {"route": route, "method": method, "status_class": status_class(code)},
                    help_text="Requests by route template, method and status class")
        METRICS.observe("beacon_l21_request_duration_seconds", dur, {"route": route}, help_text="Request latency", trace_id=span.trace_id)
        log("info", "request", trace_id=span.trace_id, span_id=span.span_id, method=method, path=path, route=route,
            status=code, duration_ms=round(dur * 1000, 1), user_id=user_id or None)

    def handle_route(self, method: str, path: str, raw: bytes, span) -> Tuple[int, Dict[str, Any]]:
        if method == "GET" and path == "/healthz":
            return 200, {"ok": True}
        if method == "GET" and path.startswith("/sensors/"):
            sensor = path[len("/sensors/"):]
            if not sensor or "/" in sensor:
                return 404, {"error": "sensor id required"}
            meta, outcome = registry_lookup(sensor, span)
            digest = checksum(json.dumps(meta, sort_keys=True).encode(), span)
            return 200, {"sensor_id": sensor, "registry": meta, "registry_outcome": outcome, "checksum": digest}
        if method == "POST" and path == "/jobs":
            try:
                data = json.loads(raw or b"{}")
            except ValueError:
                return 400, {"error": "body must be JSON"}
            with TRACER.start("enqueue job", trace_id=span.trace_id, parent_id=span.span_id, kind="producer") as qspan:
                job = {"kind": "refresh", "sensor_id": str(data.get("sensor_id") or "unknown"), "enqueued_at": time.time(),
                       "traceparent": qspan.traceparent}  # the worker continues this trace
                jid = enqueue(job)
                qspan.set("job.id", jid)
            log("info", "job enqueued", trace_id=span.trace_id, job_id=jid, sensor_id=job["sensor_id"])
            return 202, {"job_id": jid}
        return 404, {"error": "not found"}

    def do_GET(self) -> None:  # noqa: N802
        self._serve("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._serve("POST")


def main() -> int:
    srv = ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler)
    srv.daemon_threads = True
    signal.signal(signal.SIGTERM, lambda s, f: threading.Thread(target=srv.shutdown, daemon=True).start())
    log("info", "beacon-l21 api listening", port=srv.server_address[1], config={k: v for k, v in CFG.items()})
    srv.serve_forever(poll_interval=0.5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
