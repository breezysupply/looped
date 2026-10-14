#!/usr/bin/env python3
"""Beacon status API for L28 (stdlib + pgmini). Connects to the database
named by DB_HOST for every request, so pointing it at another server is a
configuration change plus a container restart, nothing else.

  GET  /healthz          process is up
  GET  /ready            200 when SELECT 1 works on DB_HOST, else 503 with the error
  GET  /summary          record count and newest record time (what the status page shows)
  POST /status           {"sensor_id","status"} -> 201
"""
import json
import os
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pgmini

DB_HOST = os.environ.get("DB_HOST", "db")
DSN = "host=%s port=5432 user=beacon password=%s dbname=beacon sslmode=disable" % (DB_HOST, os.environ.get("DB_PASSWORD", ""))


def q(sql):
    c = pgmini.connect(DSN, connect_timeout=2, application_name="beacon-status")
    try:
        c.sock.settimeout(10)
        return c.query(sql)
    finally:
        c.close()


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):  # noqa: A002
        return

    def reply(self, code, obj):
        raw = (json.dumps(obj) + "\n").encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802
        if self.path == "/healthz":
            return self.reply(200, {"ok": True, "server": socket.gethostname()})
        try:
            if self.path == "/ready":
                q("SELECT 1")
                return self.reply(200, {"ready": True, "db_host": DB_HOST})
            if self.path == "/summary":
                rows = q("SELECT count(*), coalesce(to_char(max(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), '') FROM records")
                return self.reply(200, {"records": int(rows[0][0]), "newest": rows[0][1], "db_host": DB_HOST})
        except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
            return self.reply(503, {"ready": False, "db_host": DB_HOST, "error": str(e)[:200]})
        return self.reply(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/status":
            return self.reply(404, {"error": "not found"})
        try:
            d = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            sensor, status = str(d["sensor_id"])[:64], str(d["status"])[:32]
        except (ValueError, KeyError):
            return self.reply(400, {"error": "need sensor_id and status"})
        try:
            rows = q("INSERT INTO records (sensor_id, status) VALUES (%s, %s) RETURNING id" % (pgmini.literal(sensor), pgmini.literal(status)))
            return self.reply(201, {"id": rows[0][0], "db_host": DB_HOST})
        except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
            return self.reply(503, {"error": str(e)[:200], "db_host": DB_HOST})


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", 8080), H)
    srv.daemon_threads = True
    print(json.dumps({"msg": "beacon-status listening", "db_host": DB_HOST}), flush=True)
    srv.serve_forever()
