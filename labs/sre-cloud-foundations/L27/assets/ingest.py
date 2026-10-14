#!/usr/bin/env python3
"""Beacon ingest API, L27 build: Beacon's `POST /status` write path with the
limits a production service needs made explicit, writing to PostgreSQL
through a fixed-size connection pool. Standard library + pgmini.

Endpoints
  POST /status   {"sensor_id","status","request_key"}; Idempotency-Key honoured
                 201 written · 200 duplicate (same key already written) ·
                 503 + Retry-After when shed, queued too long, or the database refuses
  GET  /stats    this replica's counters and limits (JSON)
  GET  /healthz  liveness

Limits (environment, from work/limits.env — the knobs you tune):
  WORKERS            requests processed at the same time by this replica
  QUEUE_MAX          requests allowed to WAIT for a worker (0 = unbounded)
  QUEUE_TIMEOUT_MS   longest wait for a worker before answering 503 (0 = wait forever)
  POOL_SIZE          database connections this replica opens (lazily, at most this many)
  RETRY_AFTER_S      value of Retry-After on 503
  WRITE_PATH         hot-row (default) | append-only — see below

The write, per new record (FIXTURE-CONTROLLED COST, documented): the
transaction inserts the record (ON CONFLICT on the idempotency key does
nothing), then, on the hot-row path, updates the single `ledger` row that
holds the running total and spends WRITE_COST_MS (default 25 ms) inside the
transaction with `pg_sleep` — a stand-in for the rest of a heavier write.
The row lock on `ledger` is held until COMMIT, so every write in every
replica queues behind it: the database, not the API, sets the ceiling.
`append-only` writes one `ledger_events` row instead (the total is computed
on read) and has no shared row.
Work is NOT cancelled when a client gives up: a write that is still queued
when its client times out is performed anyway, as in most real services.
"""
import json
import os
import socket
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pgmini


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return int(default)


CFG = {
    "WORKERS": max(1, env_int("WORKERS", 8)),
    "QUEUE_MAX": max(0, env_int("QUEUE_MAX", 0)),
    "QUEUE_TIMEOUT_MS": max(0, env_int("QUEUE_TIMEOUT_MS", 0)),
    "POOL_SIZE": max(1, env_int("POOL_SIZE", 8)),
    "RETRY_AFTER_S": max(0, env_int("RETRY_AFTER_S", 1)),
    "WRITE_PATH": os.environ.get("WRITE_PATH", "hot-row") if os.environ.get("WRITE_PATH", "hot-row") in ("hot-row", "append-only") else "hot-row",
    "WRITE_COST_MS": max(0, min(200, env_int("WRITE_COST_MS", 25))),
}
DSN = os.environ.get("DB_DSN", "host=db port=5432 user=beacon dbname=beacon sslmode=disable")
SERVER = socket.gethostname()


class Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.c = {"ok": 0, "duplicate": 0, "shed_queue_full": 0, "shed_queue_timeout": 0, "db_error": 0, "bad_request": 0}
        self.busy = 0
        self.waiting = 0
        self.max_waiting = 0
        self.max_busy = 0

    def inc(self, k):
        with self.lock:
            self.c[k] += 1


STATS = Stats()
WORKER_SLOTS = threading.Semaphore(CFG["WORKERS"])


class Pool:
    """At most POOL_SIZE connections; a request waits for a free one."""

    def __init__(self, size):
        self.size = size
        self.free = []
        self.opened = 0
        self.cv = threading.Condition()

    def get(self, timeout_s=10.0):
        deadline = time.monotonic() + timeout_s
        with self.cv:
            while not self.free and self.opened >= self.size:
                left = deadline - time.monotonic()
                if left <= 0:
                    raise pgmini.PgConnectionError("timed out waiting for a pool connection")
                self.cv.wait(left)
            if self.free:
                return self.free.pop()
            self.opened += 1
        try:
            conn = pgmini.connect(DSN, connect_timeout=3, application_name="beacon-ingest-" + SERVER)
            conn.sock.settimeout(30)
            return conn
        except Exception:
            with self.cv:
                self.opened -= 1
                self.cv.notify()
            raise

    def put(self, conn, broken=False):
        with self.cv:
            if broken or conn.closed:
                self.opened -= 1
                try:
                    conn.close()
                except Exception:  # noqa: BLE001
                    pass
            else:
                self.free.append(conn)
            self.cv.notify()


POOL = Pool(CFG["POOL_SIZE"])


def write(record, idem_key):
    conn = POOL.get()
    broken = False
    try:
        lit = pgmini.literal
        rows, tags = conn.execute(
            "BEGIN; INSERT INTO records (request_key, idem_key, sensor_id, status, server) VALUES ("
            + ", ".join([lit(record["request_key"]), lit(idem_key), lit(record["sensor_id"]), lit(record["status"]), lit(SERVER)])
            + ") ON CONFLICT (idem_key) DO NOTHING RETURNING id")
        if not rows:
            conn.execute("ROLLBACK")
            return "duplicate", None
        if CFG["WRITE_PATH"] == "hot-row":
            sql = "UPDATE ledger SET n = n + 1, updated_at = now() WHERE id = 1; "
        else:
            sql = "INSERT INTO ledger_events (record_id) VALUES (" + rows[0][0] + "); "
        sql += "SELECT pg_sleep(%s); COMMIT" % (CFG["WRITE_COST_MS"] / 1000.0)
        conn.execute(sql)
        return "ok", rows[0][0]
    except pgmini.PgError:
        try:
            conn.execute("ROLLBACK")
        except Exception:  # noqa: BLE001
            broken = True
        raise
    except Exception:
        broken = True
        raise
    finally:
        POOL.put(conn, broken)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "BeaconIngest/1"

    def log_message(self, format, *args):  # noqa: A002
        return

    def reply(self, code, payload, extra=None):
        raw = (json.dumps(payload) + "\n").encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("X-Served-By", SERVER)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802
        if self.path == "/healthz":
            return self.reply(200, {"ok": True, "server": SERVER})
        if self.path == "/stats":
            with STATS.lock:
                snap = dict(STATS.c, busy=STATS.busy, waiting=STATS.waiting, max_busy=STATS.max_busy, max_waiting=STATS.max_waiting)
            return self.reply(200, {"server": SERVER, "limits": CFG, "pool_open": POOL.opened, "counters": snap})
        return self.reply(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/status":
            return self.reply(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(length).decode() or "{}")
            record = {"request_key": str(data["request_key"])[:64], "sensor_id": str(data["sensor_id"])[:64], "status": str(data["status"])[:32]}
        except (ValueError, KeyError, UnicodeDecodeError):
            STATS.inc("bad_request")
            return self.reply(400, {"error": "need JSON with request_key, sensor_id, status"})
        idem = (self.headers.get("Idempotency-Key") or "")[:80] or None
        retry_after = {"Retry-After": str(CFG["RETRY_AFTER_S"])}
        # admission: bounded wait for a worker slot
        with STATS.lock:
            if CFG["QUEUE_MAX"] and STATS.waiting >= CFG["QUEUE_MAX"]:
                STATS.c["shed_queue_full"] += 1
                full = True
            else:
                full = False
                STATS.waiting += 1
                STATS.max_waiting = max(STATS.max_waiting, STATS.waiting)
        if full:
            return self.reply(503, {"error": "overloaded: queue full", "server": SERVER}, retry_after)
        timeout = CFG["QUEUE_TIMEOUT_MS"] / 1000.0 if CFG["QUEUE_TIMEOUT_MS"] else None
        got = WORKER_SLOTS.acquire(timeout=timeout) if timeout else WORKER_SLOTS.acquire()
        with STATS.lock:
            STATS.waiting -= 1
            if got:
                STATS.busy += 1
                STATS.max_busy = max(STATS.max_busy, STATS.busy)
        if not got:
            STATS.inc("shed_queue_timeout")
            return self.reply(503, {"error": "overloaded: waited too long for a worker", "server": SERVER}, retry_after)
        try:
            outcome, rid = write(record, idem or ("auto-" + uuid.uuid4().hex))
            if outcome == "duplicate":
                STATS.inc("duplicate")
                return self.reply(200, {"duplicate": True, "server": SERVER})
            STATS.inc("ok")
            return self.reply(201, {"id": rid, "server": SERVER})
        except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
            STATS.inc("db_error")
            code = getattr(e, "code", "")
            return self.reply(503, {"error": "database unavailable", "sqlstate": code, "detail": str(e)[:160], "server": SERVER}, retry_after)
        finally:
            with STATS.lock:
                STATS.busy -= 1
            WORKER_SLOTS.release()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 256


def main():
    threading.stack_size(512 * 1024)  # one thread per open connection; keep each small
    srv = Server(("0.0.0.0", 8080), Handler)
    sys.stdout.write(json.dumps({"msg": "beacon-ingest listening", "server": SERVER, "limits": CFG}) + "\n")
    sys.stdout.flush()
    srv.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
