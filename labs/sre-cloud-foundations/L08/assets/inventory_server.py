#!/usr/bin/env python3
"""L08 fixture: a local paginated inventory API that misbehaves on purpose.

  GET  /v1/inventory?page_size=N&page_token=T   items + next_page_token (opaque); bearer token required
  POST /v1/inventory/refresh                     NOT idempotent: every accepted call is one more "refresh";
                                                 an Idempotency-Key makes a repeat return the first result
  GET  /_fixture/stats                           what happened (no credentials are ever recorded)
  POST /_fixture/scenario  {"mode": "clean|faults|loop"}   switch mode and reset counters

Faults are scripted per variant and keyed on the page and the attempt number,
so a run is reproducible: e.g. "the first request for page 2 gets 429 with
Retry-After: 2". In `faults` mode one page stalls for STALL_S seconds before
answering (a client without a timeout hangs that long), one answers 200 with a
truncated JSON body, and the first refresh performs its side effect and then
answers 503 — the case where a blind retry does the work twice.
Listens on 127.0.0.1 only. Standard library only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STALL_S = 8.0
TOTAL = {"variant-a": 57, "variant-b": 43}
# page index -> list of behaviours for attempts 1, 2, ... (missing = normal answer)
FAULTS = {
    "variant-a": {1: [("429", 2)], 2: [("503", None)], 3: [("truncated", None)], 4: [("stall", None)]},
    "variant-b": {1: [("stall", None)], 2: [("503", None), ("503", None)], 3: [("429", 1), ("503", None)], 4: [("truncated", None)]},
}
LOOP_AT = {"variant-a": 3, "variant-b": 2}   # in loop mode, this page points back to page 1


class State:
    def __init__(self, variant: str, token: str) -> None:
        self.variant = variant
        self.token = token
        self.lock = threading.Lock()
        self.reset("faults")

    def reset(self, mode: str) -> None:
        self.mode = mode
        self.t0 = time.monotonic()
        self.events = []
        self.attempts = {}
        self.refreshes = 0
        self.refresh_attempts = 0
        self.idem = {}

    def page_token(self, offset: int) -> str:
        return "pt_" + hashlib.sha256(f"{self.variant}:{offset}".encode()).hexdigest()[:20]

    def offset_of(self, token: str):
        for off in range(0, 1000, 1):
            if self.page_token(off) == token:
                return off
        return None


def make_handler(st: State, page_size_default: int):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "looped-inventory-fixture/1.0"

        def _send(self, code: int, body: bytes, headers=None, ctype="application/json") -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def _json(self, code, obj, headers=None):
            self._send(code, (json.dumps(obj) + "\n").encode(), headers)

        def _auth(self) -> str:
            h = self.headers.get("Authorization", "")
            if not h:
                return "missing"
            return "ok" if h == "Bearer " + st.token else "bad"

        def _event(self, **kw) -> None:
            with st.lock:
                kw["t"] = round(time.monotonic() - st.t0, 3)
                st.events.append(kw)

        def do_GET(self):  # noqa: N802
            u = urllib.parse.urlsplit(self.path)
            if u.path == "/_fixture/stats":
                with st.lock:
                    return self._json(200, {"variant": st.variant, "mode": st.mode, "events": st.events, "refreshes": st.refreshes,
                                            "refresh_attempts": st.refresh_attempts, "total_items": TOTAL[st.variant]})
            if u.path != "/v1/inventory":
                return self._json(404, {"error": "not found"})
            auth = self._auth()
            q = urllib.parse.parse_qs(u.query)
            try:
                size = max(1, min(int(q.get("page_size", [page_size_default])[0]), 25))
            except ValueError:
                return self._json(400, {"error": "page_size must be an integer"})
            tok = q.get("page_token", [None])[0]
            offset = 0 if tok is None else st.offset_of(tok)
            if auth != "ok":
                self._event(method="GET", path="/v1/inventory", page=None, attempt=None, status=401, auth=auth)
                return self._json(401, {"error": "missing or invalid bearer token"}, {"WWW-Authenticate": "Bearer"})
            if offset is None:
                self._event(method="GET", path="/v1/inventory", page=None, attempt=None, status=400, auth=auth)
                return self._json(400, {"error": "unknown page_token"})
            page = offset // size
            with st.lock:
                st.attempts[page] = st.attempts.get(page, 0) + 1
                attempt = st.attempts[page]
            behaviour = None
            if st.mode == "faults":
                plan = FAULTS[st.variant].get(page, [])
                if attempt <= len(plan):
                    behaviour = plan[attempt - 1]
            if behaviour and behaviour[0] == "429":
                self._event(method="GET", path="/v1/inventory", page=page, attempt=attempt, status=429, auth=auth, retry_after=behaviour[1])
                return self._json(429, {"error": "rate limited"}, {"Retry-After": str(behaviour[1])})
            if behaviour and behaviour[0] == "503":
                self._event(method="GET", path="/v1/inventory", page=page, attempt=attempt, status=503, auth=auth)
                return self._json(503, {"error": "temporarily unavailable"})
            items = [{"id": f"sensor-{i + 1:04d}", "site": ["north", "south", "east"][i % 3], "status": "ok" if i % 7 else "degraded"}
                     for i in range(offset, min(offset + size, TOTAL[st.variant]))]
            nxt = st.page_token(offset + size) if offset + size < TOTAL[st.variant] else None
            if st.mode == "loop" and page == LOOP_AT[st.variant]:
                nxt = st.page_token(size)  # back to page 1: a server-side bug the client must survive
            body = (json.dumps({"items": items, "next_page_token": nxt}) + "\n").encode()
            if behaviour and behaviour[0] == "stall":
                self._event(method="GET", path="/v1/inventory", page=page, attempt=attempt, status=200, auth=auth, stalled_s=STALL_S)
                time.sleep(STALL_S)
                return self._send(200, body)
            if behaviour and behaviour[0] == "truncated":
                self._event(method="GET", path="/v1/inventory", page=page, attempt=attempt, status=200, auth=auth, truncated=True)
                return self._send(200, body[: len(body) // 2])
            self._event(method="GET", path="/v1/inventory", page=page, attempt=attempt, status=200, auth=auth, items=len(items), next=bool(nxt))
            return self._send(200, body)

        def do_POST(self):  # noqa: N802
            u = urllib.parse.urlsplit(self.path)
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b""
            if u.path == "/_fixture/scenario":
                try:
                    mode = json.loads(raw or b"{}").get("mode", "faults")
                except ValueError:
                    mode = ""
                if mode not in ("clean", "faults", "loop"):
                    return self._json(400, {"error": "mode must be clean, faults or loop"})
                with st.lock:
                    st.reset(mode)
                return self._json(200, {"mode": mode, "variant": st.variant})
            if u.path != "/v1/inventory/refresh":
                return self._json(404, {"error": "not found"})
            auth = self._auth()
            key = self.headers.get("Idempotency-Key")
            if auth != "ok":
                self._event(method="POST", path=u.path, status=401, auth=auth, idempotency_key=bool(key))
                return self._json(401, {"error": "missing or invalid bearer token"})
            with st.lock:
                st.refresh_attempts += 1
                if key and key in st.idem:
                    res = st.idem[key]
                    replay = True
                else:
                    st.refreshes += 1
                    res = {"refresh_id": f"rf-{st.refreshes:03d}", "items_refreshed": TOTAL[st.variant]}
                    if key:
                        st.idem[key] = res
                    replay = False
                first = st.refresh_attempts == 1
            if st.mode == "faults" and first:
                self._event(method="POST", path=u.path, status=503, auth=auth, idempotency_key=bool(key), side_effect=True)
                return self._json(503, {"error": "temporarily unavailable"})
            self._event(method="POST", path=u.path, status=200, auth=auth, idempotency_key=bool(key), replay=replay)
            return self._json(200, res)

        def log_message(self, *_a) -> None:
            pass

    return H


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8098)
    p.add_argument("--variant", default="variant-a", choices=sorted(TOTAL))
    p.add_argument("--token-file", required=True)
    p.add_argument("--mode", default="faults", choices=["clean", "faults", "loop"])
    a = p.parse_args()
    token = open(a.token_file, encoding="utf-8").read().strip()
    st = State(a.variant, token)
    st.reset(a.mode)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(st, 10))
    srv.daemon_threads = True
    sys.stdout.write(f"inventory fixture on http://127.0.0.1:{a.port} variant={a.variant} mode={a.mode}\n")
    sys.stdout.flush()
    srv.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
