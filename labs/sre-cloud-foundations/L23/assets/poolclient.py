"""L23 pool client: Beacon's write path with a small, bounded connection pool.

Eight worker threads share a pool of five connections (acquire timeout 2 s).
Twelve status updates must be written; each is one transaction:

    BEGIN;
    INSERT INTO status_events (idem_key, sensor_id, status) VALUES (...) ON CONFLICT (idem_key) DO NOTHING;
    UPDATE sensors SET last_status = ..., updated_at = now() WHERE id = ...;
    COMMIT;

The idempotency key makes a retry after a lost connection harmless. There is
no lock_timeout and no statement_timeout, like many real pools: a write that
waits for a lock holds its connection for as long as the lock is held.

The client prints one JSON log line per event and keeps a status file
(--status) with the pool's state: size, in use, threads waiting, acquire
timeouts, committed keys, and the backend pid of every pool connection.
After the twelve writes it stays up with its connections open, like an idle
API, so you can see them in pg_stat_activity.
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import sys
import threading
import time
from typing import Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pgmini  # noqa: E402

DSN = os.environ.get("L23_DSN", "postgresql://beacon@127.0.0.1:15423/beacon")
APP = "beacon-api-pool"
HOT = ("s-0042", "s-0007", "s-0113")
JOBS = [{"key": "l23-job-%02d" % i, "sensor": HOT[i % 3], "status": ("degraded", "ok", "fault")[i % 3]} for i in range(1, 13)]


_print_lock = threading.Lock()


def log(msg: str, **kw: object) -> None:
    line = json.dumps(dict(ts=time.strftime("%H:%M:%S"), service="beacon-api", msg=msg, **kw))
    with _print_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


class PoolTimeout(Exception):
    pass


class Pool:
    def __init__(self, size: int, acquire_timeout: float) -> None:
        self.size = size
        self.acquire_timeout = acquire_timeout
        self.idle: "queue.Queue[pgmini.Connection]" = queue.Queue()
        self.lock = threading.Lock()
        self.in_use = 0
        self.waiting = 0
        self.timeouts = 0
        self.reconnects = 0
        self.conns: List[pgmini.Connection] = []
        for _ in range(size):
            c = self._new()
            self.conns.append(c)
            self.idle.put(c)
        self.initial_pids = [c.pid for c in self.conns]

    def _new(self) -> pgmini.Connection:
        for attempt in range(30):
            try:
                return pgmini.connect(DSN, application_name=APP)
            except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
                log("connect failed; retrying", error=str(e)[:120], attempt=attempt + 1)
                time.sleep(1)
        raise SystemExit("cannot connect to the database")

    def acquire(self) -> pgmini.Connection:
        with self.lock:
            self.waiting += 1
        try:
            c = self.idle.get(timeout=self.acquire_timeout)
        except queue.Empty:
            with self.lock:
                self.waiting -= 1
                self.timeouts += 1
            raise PoolTimeout(f"no connection within {self.acquire_timeout:.1f}s ({self.in_use}/{self.size} in use)")
        with self.lock:
            self.waiting -= 1
            self.in_use += 1
        return c

    def release(self, c: pgmini.Connection) -> None:
        if c.closed or c.status != "I":
            # broken (e.g. terminated by an operator): replace it
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass
            n = self._new()
            with self.lock:
                self.reconnects += 1
                self.conns = [n if x is c else x for x in self.conns]
            c = n
        with self.lock:
            self.in_use -= 1
        self.idle.put(c)

    def pids(self) -> List[Optional[int]]:
        with self.lock:
            return [c.pid for c in self.conns]


def write(c: pgmini.Connection, job: Dict[str, str]) -> None:
    c.execute(
        "BEGIN;"
        f" INSERT INTO status_events (idem_key, sensor_id, status) VALUES ({pgmini.literal(job['key'])}, {pgmini.literal(job['sensor'])}, {pgmini.literal(job['status'])}) ON CONFLICT (idem_key) DO NOTHING;"
        f" UPDATE sensors SET last_status = {pgmini.literal(job['status'])}, updated_at = now() WHERE id = {pgmini.literal(job['sensor'])};"
        " COMMIT;"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool-size", type=int, default=5)
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--acquire-timeout", type=float, default=2.0)
    ap.add_argument("--status", default="")
    args = ap.parse_args()

    pool = Pool(args.pool_size, args.acquire_timeout)
    log("pool ready", size=pool.size, pids=pool.initial_pids)
    todo: "queue.Queue[Dict[str, str]]" = queue.Queue()
    for j in JOBS:
        todo.put(j)
    committed: List[str] = []
    errors: List[str] = []
    st_lock = threading.Lock()

    def status() -> None:
        doc = {"pool_size": pool.size, "in_use": pool.in_use, "waiting": pool.waiting, "acquire_timeouts": pool.timeouts,
               "reconnects": pool.reconnects, "initial_pids": pool.initial_pids, "pids": pool.pids(),
               "intended": [j["key"] for j in JOBS], "committed": sorted(committed), "pending": todo.qsize(),
               "last_errors": errors[-5:], "updated": time.time()}
        if args.status:
            tmp = args.status + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(doc, fh, indent=1)
            os.replace(tmp, args.status)

    def worker(n: int) -> None:
        while True:
            try:
                job = todo.get(timeout=1)
            except queue.Empty:
                continue
            while True:
                try:
                    c = pool.acquire()
                except PoolTimeout as e:
                    log("pool exhausted", thread=n, job=job["key"], error=str(e))
                    time.sleep(1)
                    continue
                t0 = time.time()
                try:
                    write(c, job)
                    with st_lock:
                        committed.append(job["key"])
                    log("status written", thread=n, job=job["key"], sensor=job["sensor"], waited_s=round(time.time() - t0, 2), pid=c.pid)
                    pool.release(c)
                    break
                except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
                    with st_lock:
                        errors.append(f"{job['key']}: {str(e)[:100]}")
                    log("write failed; will retry with the same idempotency key", thread=n, job=job["key"], error=str(e)[:160], pid=c.pid)
                    try:
                        if not c.closed and c.status != "I":
                            c.execute("ROLLBACK")
                    except Exception:  # noqa: BLE001
                        c.closed = True
                    pool.release(c)
                    time.sleep(0.5)

    for n in range(args.threads):
        threading.Thread(target=worker, args=(n,), daemon=True).start()
    while True:
        status()
        time.sleep(1)


if __name__ == "__main__":
    raise SystemExit(main())
