"""Beacon API: a deliberately small HTTP service for the course.

Endpoints
  GET  /healthz            liveness: process is up (never checks dependencies)
  GET  /ready              readiness: store (and queue) reachable; 503 otherwise
  GET  /version            {"version", "environment", "commit"}
  POST /status             accept {"sensor_id","status","ts"}; Idempotency-Key honoured
  GET  /status/<sensor>    records for one sensor
  POST /jobs               enqueue {"kind", ...}; Idempotency-Key honoured by the worker
  GET  /metrics            Prometheus text
  GET  /debug/config       effective config (secrets redacted); admin_enabled only
  POST /admin/inject       {"delay_ms", "fail_rate", "ready_fail"}; admin_enabled only

Every response carries X-Request-Id and X-Beacon-Version. Every request is
logged as one JSON line. SIGTERM finishes in-flight requests and exits 0.
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import signal
import socket
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Tuple

from . import config as cfgmod
from .queue import QueueError, open_queue
from .store import StoreError, open_store
from .telemetry import METRICS, log, make_traceparent, new_request_id, parse_traceparent

ROUTES = ("/healthz", "/ready", "/version", "/status", "/status/{sensor}", "/jobs", "/metrics", "/debug/config", "/admin/inject")


class App:
    def __init__(self, cfg: cfgmod.Config) -> None:
        self.cfg = cfg
        self.version = str(cfg.get("app", "version"))
        self.environment = str(cfg.get("app", "environment"))
        self.commit = os.environ.get("BEACON_COMMIT", "local")
        self.admin = bool(cfg.get("app", "admin_enabled"))
        self.inject = {"delay_ms": int(cfg.get("inject", "delay_ms") or 0), "fail_rate": float(cfg.get("inject", "fail_rate") or 0.0), "ready_fail": bool(cfg.get("inject", "ready_fail"))}
        self.store = open_store(cfg.get("store", "kind"), cfg.get("store", "path") or "", cfg.get("store", "url") or "")
        self.queue = open_queue(cfg.get("queue", "kind"), cfg.get("queue", "dir") or "", cfg.get("queue", "url") or "", cfg.get("queue", "name") or "beacon-jobs")
        self.started = time.time()
        self._rng = random.Random(1234)
        self._lock = threading.Lock()

    def route_of(self, path: str) -> str:
        if path.startswith("/status/"):
            return "/status/{sensor}"
        return path if path in ROUTES else "/other"

    def handle(self, method: str, path: str, body: bytes, headers: Dict[str, str]) -> Tuple[int, Dict[str, Any] | str, Dict[str, str]]:
        if self.inject["delay_ms"] and path not in ("/healthz", "/metrics"):
            time.sleep(self.inject["delay_ms"] / 1000.0)
        if self.inject["fail_rate"] and path in ("/status", "/jobs") and self._rng.random() < self.inject["fail_rate"]:
            return 503, {"error": "injected failure"}, {}
        if method == "GET" and path == "/healthz":
            return 200, "ok\n", {"Content-Type": "text/plain"}
        if method == "GET" and path == "/ready":
            ok_store = self.store.ready()
            ok_queue = self.queue.ready()
            if self.inject["ready_fail"] or not ok_store or not ok_queue:
                return 503, {"ready": False, "store": ok_store, "queue": ok_queue, "injected": self.inject["ready_fail"]}, {}
            return 200, {"ready": True, "store": self.store.kind, "queue": self.queue.kind}, {}
        if method == "GET" and path == "/version":
            return 200, {"version": self.version, "environment": self.environment, "commit": self.commit, "uptime_s": round(time.time() - self.started, 1)}, {}
        if method == "GET" and path == "/metrics":
            METRICS.set("beacon_records_total", self.store.count(), help_text="Records stored")
            try:
                METRICS.set("beacon_queue_depth", self.queue.depth(), help_text="Jobs waiting")
            except Exception:  # noqa: BLE001
                pass
            return 200, METRICS.render(), {"Content-Type": "text/plain; version=0.0.4"}
        if method == "POST" and path == "/status":
            try:
                data = json.loads(body.decode("utf-8") or "{}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                return 400, {"error": "body must be JSON"}, {}
            missing = [k for k in ("sensor_id", "status") if not isinstance(data.get(k), str) or not data.get(k)]
            if missing:
                return 400, {"error": "missing or invalid fields", "fields": missing}, {}
            record = {"id": uuid.uuid4().hex, "sensor_id": data["sensor_id"], "status": data["status"], "ts": str(data.get("ts") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())), "request_id": headers.get("x-request-id")}
            try:
                stored = self.store.put(record, headers.get("idempotency-key"))
            except StoreError as e:
                log("error", "store write failed", error=str(e))
                return 503, {"error": "store unavailable"}, {}
            return (200 if stored.get("duplicate") else 201), stored, {}
        if method == "GET" and path.startswith("/status/"):
            sensor = path[len("/status/"):]
            if not sensor:
                return 404, {"error": "sensor id required"}, {}
            return 200, {"sensor_id": sensor, "records": self.store.get(sensor)}, {}
        if method == "POST" and path == "/jobs":
            try:
                data = json.loads(body.decode("utf-8") or "{}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                return 400, {"error": "body must be JSON"}, {}
            job = {"kind": str(data.get("kind") or "noop"), "payload": data.get("payload", {}), "idempotency_key": headers.get("idempotency-key") or data.get("idempotency_key"), "request_id": headers.get("x-request-id")}
            try:
                jid = self.queue.enqueue(job)
            except QueueError as e:
                return 503, {"error": str(e)}, {}
            METRICS.inc("beacon_jobs_enqueued_total", help_text="Jobs enqueued")
            return 202, {"job_id": jid, "queue": self.queue.kind}, {}
        if method == "GET" and path == "/debug/config":
            if not self.admin:
                return 404, {"error": "not found"}, {}
            return 200, {"source": self.cfg.source, "config": self.cfg.redacted()}, {}
        if method == "POST" and path == "/admin/inject":
            if not self.admin:
                return 404, {"error": "not found"}, {}
            try:
                data = json.loads(body.decode("utf-8") or "{}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                return 400, {"error": "body must be JSON"}, {}
            with self._lock:
                for k in ("delay_ms", "fail_rate", "ready_fail"):
                    if k in data:
                        self.inject[k] = type(self.inject[k])(data[k])
            log("warning", "fault injection changed", **self.inject)
            return 200, {"inject": self.inject}, {}
        return 404, {"error": "not found", "path": path}, {}


class Handler(BaseHTTPRequestHandler):
    app: App
    server_version = "Beacon/1"
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - BaseHTTPRequestHandler signature
        return  # structured logs only

    def _serve(self, method: str) -> None:
        t0 = time.monotonic()
        headers = {k.lower(): v for k, v in self.headers.items()}
        request_id = headers.get("x-request-id") or new_request_id()
        trace_id, _ = parse_traceparent(headers.get("traceparent"))
        traceparent, trace_id, span_id = make_traceparent(trace_id)
        length = int(headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else b""
        path = self.path.split("?", 1)[0]
        try:
            code, payload, extra = self.app.handle(method, path, body, dict(headers, **{"x-request-id": request_id}))
        except Exception as e:  # noqa: BLE001 - last-resort handler
            log("error", "unhandled exception", request_id=request_id, error=repr(e))
            code, payload, extra = 500, {"error": "internal error"}, {}
        if isinstance(payload, (dict, list)):
            raw = (json.dumps(payload) + "\n").encode("utf-8")
            ctype = "application/json"
        else:
            raw = str(payload).encode("utf-8")
            ctype = extra.pop("Content-Type", "text/plain")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("X-Request-Id", request_id)
        self.send_header("X-Beacon-Version", self.app.version)
        self.send_header("traceparent", traceparent)
        for k, v in extra.items():
            self.send_header(k, v)
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(raw)
        dur = time.monotonic() - t0
        route = self.app.route_of(path)
        METRICS.inc("beacon_requests_total", {"route": route, "method": method, "code": str(code)}, help_text="Requests by route and status")
        METRICS.observe("beacon_request_duration_seconds", dur, {"route": route}, help_text="Request latency")
        log("info", "request", request_id=request_id, trace_id=trace_id, span_id=span_id, method=method, path=path, route=route, status=code, duration_ms=round(dur * 1000, 2), remote=self.client_address[0])

    def do_GET(self) -> None:  # noqa: N802
        self._serve("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._serve("POST")

    def do_HEAD(self) -> None:  # noqa: N802
        self._serve("HEAD")


def make_server(cfg: cfgmod.Config) -> ThreadingHTTPServer:
    app = App(cfg)
    handler = type("BoundHandler", (Handler,), {"app": app})
    listen, port = str(cfg.get("server", "listen")), int(cfg.get("server", "port"))
    try:
        srv = ThreadingHTTPServer((listen, port), handler)
    except OSError as e:
        raise SystemExit(f"FATAL listen {listen}:{port}: {e.strerror} (errno {e.errno})")
    srv.daemon_threads = True
    srv.app = app  # type: ignore[attr-defined]
    return srv


def main(argv: Optional[list] = None) -> int:
    p = argparse.ArgumentParser(prog="beacon-api", description="Beacon API (course starter service)")
    p.add_argument("--config", help="YAML (subset) or JSON config file; env BEACON_* and flags override")
    p.add_argument("--listen", help="address to bind (default from config: 0.0.0.0)")
    p.add_argument("--port", type=int, help="port to bind (default from config: 8080)")
    p.add_argument("--validate", action="store_true", help="validate the configuration and exit")
    args = p.parse_args(argv)
    overrides: Dict[str, Dict[str, Any]] = {}
    if args.listen:
        overrides.setdefault("server", {})["listen"] = args.listen
    if args.port:
        overrides.setdefault("server", {})["port"] = args.port
    try:
        cfg = cfgmod.load(args.config or os.environ.get("BEACON_CONFIG"), overrides=overrides)
    except cfgmod.ConfigError as e:
        log("fatal", "config", error=str(e))
        sys.stderr.write(f"FATAL config: {e}\n")
        return 1
    if args.validate:
        print(json.dumps({"ok": True, "source": cfg.source, "config": cfg.redacted()}, indent=2))
        return 0
    log("info", "starting beacon-api", version=cfg.get("app", "version"), config_source=cfg.source, cwd=os.getcwd(), user=os.environ.get("USER") or str(os.getuid()), effective=cfg.redacted())
    try:
        srv = make_server(cfg)
    except (StoreError, QueueError) as e:
        log("fatal", "dependency", error=str(e))
        sys.stderr.write(f"FATAL: {e}\n")
        return 1
    except SystemExit as e:
        log("fatal", "listen", error=str(e))
        sys.stderr.write(str(e) + "\n")
        return 1
    stopping = threading.Event()

    def stop(signum: int, frame: Any) -> None:
        log("info", "signal received, shutting down gracefully", signal=signum)
        stopping.set()
        threading.Thread(target=srv.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    host, port = srv.server_address[0], srv.server_address[1]
    log("info", f"listening on {host}:{port}", listen=host, port=port, hostname=socket.gethostname())
    sys.stdout.write(f"beacon-api {cfg.get('app', 'version')} listening on {host}:{port}\n")
    sys.stdout.flush()
    srv.serve_forever(poll_interval=0.5)
    srv.app.store.close()  # type: ignore[attr-defined]
    log("info", "stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
