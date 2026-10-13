#!/usr/bin/env python3
"""tlsproxy — a small standard-library TLS-terminating reverse proxy for L06.

Reads one JSON config:
  {"listen": "127.0.0.1", "port": 8446, "server_name": "beacon.corp.lab",
   "cert": ".../fullchain.pem", "key": ".../server.key",
   "upstream": "http://127.0.0.1:8086", "upstream_timeout_s": 3,
   "access_log": ".../proxy-access.log"}

Terminates TLS (1.2+) with the configured certificate, forwards the request to
the plain-HTTP upstream with the client's Host header preserved and
X-Forwarded-For / X-Forwarded-Proto / X-Forwarded-Host added, and returns the
upstream's answer. Upstream failures become 502 (connect error) or 504
(timeout) with a JSON body that names the upstream and the reason. Every
request writes one JSON access-log line: client, method, path, host, status,
upstream, upstream_status, duration_ms.

A teaching fixture, not a production proxy: no keep-alive pooling, no HTTP/2,
no streaming of large bodies, one certificate.
"""
from __future__ import annotations

import http.client
import json
import socket
import ssl
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"}


def load(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    for k in ("listen", "port", "cert", "key", "upstream"):
        if k not in cfg:
            raise SystemExit(f"tlsproxy: config {path} is missing {k!r}")
    u = urllib.parse.urlsplit(cfg["upstream"])
    if u.scheme != "http" or not u.hostname or not u.port:
        raise SystemExit(f"tlsproxy: upstream must look like http://HOST:PORT, got {cfg['upstream']!r}")
    cfg["_up_host"], cfg["_up_port"] = u.hostname, u.port
    return cfg


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] != "--config":
        print("usage: tlsproxy.py --config proxy.json", file=sys.stderr)
        return 2
    cfg = load(sys.argv[2])
    lock = threading.Lock()

    def access(entry: dict) -> None:
        line = json.dumps(entry, sort_keys=True) + "\n"
        with lock:
            if cfg.get("access_log"):
                with open(cfg["access_log"], "a", encoding="utf-8") as fh:
                    fh.write(line)
            sys.stdout.write(line)
            sys.stdout.flush()

    class Proxy(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "looped-tlsproxy/1.0"

        def _forward(self) -> None:
            t0 = time.monotonic()
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None
            headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
            client = self.client_address[0]
            headers["X-Forwarded-For"] = (self.headers.get("X-Forwarded-For", "") + ", " if self.headers.get("X-Forwarded-For") else "") + client
            headers["X-Forwarded-Proto"] = "https"
            headers["X-Forwarded-Host"] = self.headers.get("Host", "")
            upstream = f"{cfg['_up_host']}:{cfg['_up_port']}"
            status, up_status, reason = 502, None, ""
            try:
                conn = http.client.HTTPConnection(cfg["_up_host"], cfg["_up_port"], timeout=float(cfg.get("upstream_timeout_s", 3)))
                conn.request(self.command, self.path, body=body, headers=headers)
                resp = conn.getresponse()
                data = resp.read()
                up_status = status = resp.status
                self.send_response(resp.status, resp.reason)
                for k, v in resp.getheaders():
                    if k.lower() not in HOP and k.lower() not in ("content-length", "server", "date"):
                        self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(data)
                conn.close()
            except (socket.timeout, TimeoutError):
                status, reason = 504, "upstream timed out"
            except OSError as e:
                status, reason = 502, (e.strerror or str(e)).lower()
            if up_status is None:
                payload = json.dumps({"error": "bad gateway" if status == 502 else "gateway timeout", "upstream": upstream, "reason": reason}).encode() + b"\n"
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            access({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "client": client, "method": self.command, "path": self.path,
                    "host": self.headers.get("Host", ""), "status": status, "upstream": upstream, "upstream_status": up_status,
                    "reason": reason or None, "duration_ms": round((time.monotonic() - t0) * 1000, 1)})

        do_GET = do_POST = do_HEAD = do_PUT = do_DELETE = _forward

        def log_message(self, *_a) -> None:
            pass

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(cfg["cert"], cfg["key"])
    srv = ThreadingHTTPServer((cfg["listen"], int(cfg["port"])), Proxy)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    sys.stdout.write(f"tlsproxy: https://{cfg['listen']}:{cfg['port']} -> {cfg['upstream']} cert={cfg['cert']}\n")
    sys.stdout.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
