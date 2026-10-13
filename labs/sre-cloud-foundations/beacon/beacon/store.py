"""Record stores for Beacon: memory, SQLite (stdlib) and PostgreSQL (psycopg,
installed only in the container image). Every store exposes the same four
operations so the API does not care which one it runs on.

A record is a synthetic sensor status: {"sensor_id": str, "status": str,
"ts": str, "request_id": str}. Idempotent submission: a record with an
idempotency key that was already stored is returned unchanged, with
`duplicate: true`.
"""
from __future__ import annotations

import sqlite3
import threading
import time
from typing import Any, Dict, List, Optional


class StoreError(Exception):
    pass


class MemoryStore:
    kind = "memory"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: Dict[str, Dict[str, Any]] = {}
        self._keys: Dict[str, str] = {}

    def put(self, record: Dict[str, Any], idem_key: Optional[str]) -> Dict[str, Any]:
        with self._lock:
            if idem_key and idem_key in self._keys:
                r = dict(self._records[self._keys[idem_key]])
                r["duplicate"] = True
                return r
            self._records[record["id"]] = record
            if idem_key:
                self._keys[idem_key] = record["id"]
            return dict(record, duplicate=False)

    def get(self, sensor_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._records.values() if r["sensor_id"] == sensor_id]

    def count(self) -> int:
        with self._lock:
            return len(self._records)

    def ready(self) -> bool:
        return True

    def close(self) -> None:
        pass


class SqliteStore:
    kind = "sqlite"

    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = threading.Lock()
        try:
            self._db = sqlite3.connect(path, check_same_thread=False)
        except sqlite3.OperationalError as e:
            raise StoreError(f"sqlite open {path}: {e}")
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, sensor_id TEXT NOT NULL, status TEXT NOT NULL, ts TEXT NOT NULL, request_id TEXT, idem_key TEXT UNIQUE)"
        )
        self._db.execute("CREATE INDEX IF NOT EXISTS records_sensor ON records(sensor_id)")
        self._db.commit()

    def put(self, record: Dict[str, Any], idem_key: Optional[str]) -> Dict[str, Any]:
        with self._lock:
            if idem_key:
                row = self._db.execute("SELECT id, sensor_id, status, ts, request_id FROM records WHERE idem_key = ?", (idem_key,)).fetchone()
                if row:
                    return {"id": row[0], "sensor_id": row[1], "status": row[2], "ts": row[3], "request_id": row[4], "duplicate": True}
            try:
                self._db.execute(
                    "INSERT INTO records (id, sensor_id, status, ts, request_id, idem_key) VALUES (?, ?, ?, ?, ?, ?)",
                    (record["id"], record["sensor_id"], record["status"], record["ts"], record.get("request_id"), idem_key),
                )
                self._db.commit()
            except sqlite3.OperationalError as e:
                raise StoreError(f"sqlite write: {e}")
            return dict(record, duplicate=False)

    def get(self, sensor_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._db.execute("SELECT id, sensor_id, status, ts, request_id FROM records WHERE sensor_id = ? ORDER BY ts", (sensor_id,)).fetchall()
        return [{"id": r[0], "sensor_id": r[1], "status": r[2], "ts": r[3], "request_id": r[4]} for r in rows]

    def count(self) -> int:
        with self._lock:
            return int(self._db.execute("SELECT COUNT(*) FROM records").fetchone()[0])

    def ready(self) -> bool:
        try:
            with self._lock:
                self._db.execute("SELECT 1").fetchone()
            return True
        except sqlite3.Error:
            return False

    def close(self) -> None:
        self._db.close()


class PostgresStore:
    """PostgreSQL through psycopg 3. Imported lazily: the host labs never need it."""

    kind = "postgres"

    def __init__(self, url: str, pool_size: int = 5, connect_timeout_s: float = 3.0) -> None:
        try:
            import psycopg  # type: ignore
        except ImportError as e:  # pragma: no cover - depends on environment
            raise StoreError("store.kind=postgres needs the psycopg package (installed in the Beacon container image; see beacon/requirements.txt)") from e
        self._psycopg = psycopg
        self.url = url
        self.connect_timeout_s = connect_timeout_s
        self._lock = threading.Lock()
        self._conn = None
        self._connect(retries=10)
        with self._conn.cursor() as cur:  # type: ignore[union-attr]
            cur.execute(
                "CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, sensor_id TEXT NOT NULL, status TEXT NOT NULL, ts TEXT NOT NULL, request_id TEXT, idem_key TEXT UNIQUE)"
            )
            cur.execute("CREATE INDEX IF NOT EXISTS records_sensor ON records(sensor_id)")
        self._conn.commit()  # type: ignore[union-attr]

    def _connect(self, retries: int = 1) -> None:
        last = None
        for attempt in range(retries):
            try:
                self._conn = self._psycopg.connect(self.url, connect_timeout=int(self.connect_timeout_s), autocommit=False)
                return
            except Exception as e:  # noqa: BLE001 - surfaced as StoreError below
                last = e
                time.sleep(min(5.0, 0.5 * (2 ** attempt)))
        raise StoreError(f"postgres connect failed after {retries} attempts: {last}")

    def put(self, record: Dict[str, Any], idem_key: Optional[str]) -> Dict[str, Any]:
        with self._lock:
            with self._conn.cursor() as cur:  # type: ignore[union-attr]
                if idem_key:
                    cur.execute("SELECT id, sensor_id, status, ts, request_id FROM records WHERE idem_key = %s", (idem_key,))
                    row = cur.fetchone()
                    if row:
                        self._conn.rollback()  # type: ignore[union-attr]
                        return {"id": row[0], "sensor_id": row[1], "status": row[2], "ts": row[3], "request_id": row[4], "duplicate": True}
                cur.execute(
                    "INSERT INTO records (id, sensor_id, status, ts, request_id, idem_key) VALUES (%s, %s, %s, %s, %s, %s)",
                    (record["id"], record["sensor_id"], record["status"], record["ts"], record.get("request_id"), idem_key),
                )
            self._conn.commit()  # type: ignore[union-attr]
            return dict(record, duplicate=False)

    def get(self, sensor_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            with self._conn.cursor() as cur:  # type: ignore[union-attr]
                cur.execute("SELECT id, sensor_id, status, ts, request_id FROM records WHERE sensor_id = %s ORDER BY ts", (sensor_id,))
                rows = cur.fetchall()
            self._conn.rollback()  # type: ignore[union-attr]
        return [{"id": r[0], "sensor_id": r[1], "status": r[2], "ts": r[3], "request_id": r[4]} for r in rows]

    def count(self) -> int:
        with self._lock:
            with self._conn.cursor() as cur:  # type: ignore[union-attr]
                cur.execute("SELECT COUNT(*) FROM records")
                n = int(cur.fetchone()[0])
            self._conn.rollback()  # type: ignore[union-attr]
        return n

    def ready(self) -> bool:
        try:
            with self._lock:
                with self._conn.cursor() as cur:  # type: ignore[union-attr]
                    cur.execute("SELECT 1")
                    cur.fetchone()
                self._conn.rollback()  # type: ignore[union-attr]
            return True
        except Exception:  # noqa: BLE001
            return False

    def close(self) -> None:
        try:
            self._conn.close()  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            pass


def open_store(kind: str, path: str = "", url: str = "") -> Any:
    if kind == "memory":
        return MemoryStore()
    if kind == "sqlite":
        return SqliteStore(path)
    if kind == "postgres":
        return PostgresStore(url)
    raise StoreError(f"unknown store kind {kind!r}")
