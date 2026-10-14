#!/usr/bin/env python3
"""L30 fixture: a local "summaries" API that a fictional customer integrates with.

  POST /v1/summaries      body {"document_id": str, "text": str, "stream": bool}
                          Authorization: Bearer <key> required; optional Idempotency-Key
                          stream=true  -> text/event-stream: event start, event delta x3, event done
                          stream=false -> application/json {"id", "summary", "finish_reason"}
  GET  /v1/health         {"ok": true}  (no auth; says nothing about your key or quota)
  GET  /_fixture/stats    what the fixture saw since the last mode switch (never the key or the text)
  POST /_fixture/scenario {"mode": "<mode>"}   switch mode and clear the event list

Every API response carries X-Request-Id (req_ + 16 hex). Every issued id is also
appended to <run-dir>/issued.jsonl with an opaque mode tag and the status, so a support
engineer (and the validator) can tell which request ids really came from here.

Modes (fixture-controlled, documented so nobody mistakes them for real faults):
  ok            normal answers
  auth-rotated  the customer's key was rotated: it is revoked; the new key works
  not-entitled  the key is valid but the organisation has no streaming entitlement
  rate-limited  every request answers 429 with Retry-After and request-quota headers
  timeout       the server stalls STALL_S seconds before the first byte, then answers normally
  stream-cut    the stream starts, sends two deltas and the connection closes with no done event

Listens on 127.0.0.1 only. Standard library only. Keys are lab placeholders
(lab-l30-...-not-a-real-secret) read from files; they are never logged.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODES = ("ok", "auth-rotated", "not-entitled", "rate-limited", "timeout", "stream-cut")
STALL_S = 8.0
RETRY_AFTER_S = 2
QUOTA_LIMIT = 20
DELTAS = ["Shipment 4471 left the north depot on time.", " Two pallets were re-weighed.", " No exceptions were raised."]


def mode_tag(mode: str) -> str:
    """Opaque tag for a mode, so the issued-id log does not name the cause."""
    return hashlib.sha256(("looped-l30:" + mode).encode()).hexdigest()[:8]


class State:
    def __init__(self, keys_dir: str, run_dir: str, mode: str) -> None:
        self.keys_dir = keys_dir
        self.run_dir = run_dir
        self.lock = threading.Lock()
        self.reset(mode)

    def reset(self, mode: str) -> None:
        self.mode = mode
        self.t0 = time.monotonic()
        self.events = []

    def key(self, name: str) -> str:
        try:
            with open(os.path.join(self.keys_dir, name), encoding="utf-8") as fh:
                return fh.read().strip()
        except OSError:
            return ""

    def auth(self, header: str) -> str:
        if not header:
            return "missing"
        if not header.startswith("Bearer "):
            return "malformed"
        presented = header[len("Bearer "):].strip()
        customer, new = self.key("customer-key"), self.key("new-key")
        if self.mode == "auth-rotated":
            if new and secrets.compare_digest(presented, new):
                return "ok"
            if customer and secrets.compare_digest(presented, customer):
                return "revoked"
            return "unknown"
        for k in (customer, new):
            if k and secrets.compare_digest(presented, k):
                return "ok"
        return "unknown"

    def issue(self, status: int) -> str:
        rid = "req_" + secrets.token_hex(8)
        rec = {"t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "mode_tag": mode_tag(self.mode), "request_id": rid, "status": status}
        try:
            os.makedirs(self.run_dir, exist_ok=True)
            with open(os.path.join(self.run_dir, "issued.jsonl"), "a", encoding="utf-8") as fh:
                fh.write(json.dumps(rec) + "\n")
        except OSError:
            pass
        return rid


def make_handler(st: State):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "looped-summaries-fixture/1.0"

        def _send_json(self, code: int, obj, headers=None) -> None:
            body = (json.dumps(obj) + "\n").encode()
            try:
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def _event(self, ev: dict) -> dict:
            """Record the request on arrival; later fields are added to the same dict."""
            with st.lock:
                ev["t"] = round(time.monotonic() - st.t0, 3)
                st.events.append(ev)
            return ev

        def _update(self, ev: dict, **kw) -> None:
            with st.lock:
                ev.update(kw)

        def _error(self, code: int, etype: str, message: str, ev: dict, headers=None) -> None:
            rid = st.issue(code)
            ev.update(status=code, request_id=rid)
            self._event(ev)
            h = {"X-Request-Id": rid}
            h.update(headers or {})
            self._send_json(code, {"error": {"type": etype, "message": message}, "request_id": rid}, h)

        def do_GET(self):  # noqa: N802
            if self.path == "/_fixture/stats":
                with st.lock:
                    return self._send_json(200, {"mode_tag": mode_tag(st.mode), "events": list(st.events), "retry_after_s": RETRY_AFTER_S, "stall_s": STALL_S})
            if self.path == "/v1/health":
                return self._send_json(200, {"ok": True})
            return self._send_json(404, {"error": {"type": "not_found", "message": "no such route"}})

        def do_POST(self):  # noqa: N802
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b""
            if self.path == "/_fixture/scenario":
                try:
                    mode = json.loads(raw or b"{}").get("mode", "")
                except ValueError:
                    mode = ""
                if mode not in MODES:
                    return self._send_json(400, {"error": "mode must be one of " + ", ".join(MODES)})
                with st.lock:
                    st.reset(mode)
                return self._send_json(200, {"mode_tag": mode_tag(mode)})
            if self.path != "/v1/summaries":
                return self._send_json(404, {"error": {"type": "not_found", "message": "no such route"}})
            started = time.monotonic()
            idem = self.headers.get("Idempotency-Key", "")
            ev = {"path": self.path, "idempotency_key": hashlib.sha256(idem.encode()).hexdigest()[:12] if idem else "",
                  "auth": st.auth(self.headers.get("Authorization", ""))}
            try:
                req = json.loads(raw or b"{}")
                if not isinstance(req, dict) or not isinstance(req.get("document_id"), str):
                    raise ValueError
            except ValueError:
                return self._error(400, "invalid_request_error", "body must be JSON with a document_id string", ev)
            stream = bool(req.get("stream"))
            ev["stream"] = stream
            if ev["auth"] != "ok":
                return self._error(401, "authentication_error", "the API key presented is not valid for this organisation", ev,
                                   {"WWW-Authenticate": 'Bearer error="invalid_token"'})
            if st.mode == "not-entitled" and stream:
                return self._error(403, "permission_error", "this organisation is not entitled to streaming summaries", ev)
            if st.mode == "rate-limited":
                return self._error(429, "rate_limit_error", "request rate limit reached for this organisation", ev,
                                   {"Retry-After": str(RETRY_AFTER_S), "X-RateLimit-Limit-Requests": str(QUOTA_LIMIT),
                                    "X-RateLimit-Remaining-Requests": "0", "X-RateLimit-Reset-Requests": f"{RETRY_AFTER_S}s"})
            rid = st.issue(200)
            ev.update(status=200, request_id=rid, outcome="in-progress")
            self._event(ev)
            if st.mode == "timeout":
                self._update(ev, stalled_s=STALL_S)
                time.sleep(STALL_S)
            summary_id = "sum_" + hashlib.sha256(rid.encode()).hexdigest()[:10]
            if not stream:
                self._update(ev, outcome="complete")
                return self._send_json(200, {"id": summary_id, "summary": "".join(DELTAS), "finish_reason": "complete"}, {"X-Request-Id": rid})
            self.close_connection = True
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.send_header("X-Request-Id", rid)
                self.end_headers()
                self._sse("start", {"id": summary_id})
                cut = st.mode == "stream-cut"
                for i, d in enumerate(DELTAS):
                    if cut and i == 2:
                        break
                    time.sleep(0.15)
                    self._sse("delta", {"index": i, "text": d})
                if not cut:
                    self._sse("done", {"finish_reason": "complete"})
                self._update(ev, outcome="cut" if cut else "complete")
            except (BrokenPipeError, ConnectionResetError):
                self._update(ev, outcome="client-gone")
            self._update(ev, duration_s=round(time.monotonic() - started, 3))

        def _sse(self, event: str, data) -> None:
            self.wfile.write(f"event: {event}\ndata: {json.dumps(data)}\n\n".encode())
            self.wfile.flush()

        def log_message(self, *_a) -> None:
            pass

    return H


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8130)
    p.add_argument("--mode", default="ok", choices=MODES)
    p.add_argument("--keys-dir", required=True, help="directory holding customer-key and new-key")
    p.add_argument("--run-dir", required=True, help="where issued.jsonl is appended")
    a = p.parse_args()
    st = State(a.keys_dir, a.run_dir, a.mode)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(st))
    srv.daemon_threads = True
    sys.stdout.write(f"summaries fixture on http://127.0.0.1:{a.port} (mode tag {mode_tag(a.mode)})\n")
    sys.stdout.flush()
    srv.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
