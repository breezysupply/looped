"""Job queues for Beacon: a directory queue (stdlib, for host and single-node
labs) and a Redis list queue (redis package, container image only).

Delivery is at-least-once on purpose: a worker that crashes after taking a
job but before acknowledging it will see the job again. The worker's
idempotency key is what keeps the side effect from happening twice (M12).
"""
from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Dict, Optional


class QueueError(Exception):
    pass


class NoQueue:
    kind = "none"

    def enqueue(self, job: Dict[str, Any]) -> str:
        raise QueueError("no queue configured (queue.kind is none)")

    def take(self, timeout_s: float = 1.0) -> Optional[Dict[str, Any]]:
        return None

    def ack(self, job: Dict[str, Any]) -> None:
        pass

    def depth(self) -> int:
        return 0

    def ready(self) -> bool:
        return True


class DirQueue:
    """One JSON file per job in <dir>/pending; taken jobs move to <dir>/inflight
    and are deleted on ack. A crash leaves the file in inflight, and
    `requeue_stale` moves it back after `stale_s` — at-least-once, visibly."""

    kind = "dir"

    def __init__(self, directory: str, stale_s: float = 30.0) -> None:
        self.dir = directory
        self.stale_s = stale_s
        for sub in ("pending", "inflight", "done"):
            os.makedirs(os.path.join(directory, sub), exist_ok=True)

    def enqueue(self, job: Dict[str, Any]) -> str:
        job = dict(job)
        job.setdefault("id", uuid.uuid4().hex)
        job.setdefault("enqueued_at", time.time())
        tmp = os.path.join(self.dir, "pending", "." + job["id"] + ".tmp")
        final = os.path.join(self.dir, "pending", job["id"] + ".json")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(job, fh)
        os.replace(tmp, final)
        return job["id"]

    def take(self, timeout_s: float = 1.0) -> Optional[Dict[str, Any]]:
        deadline = time.time() + timeout_s
        while True:
            self.requeue_stale()
            names = sorted(n for n in os.listdir(os.path.join(self.dir, "pending")) if n.endswith(".json"))
            for name in names:
                src = os.path.join(self.dir, "pending", name)
                dst = os.path.join(self.dir, "inflight", name)
                try:
                    os.replace(src, dst)
                except FileNotFoundError:
                    continue
                with open(dst, "r", encoding="utf-8") as fh:
                    job = json.load(fh)
                job["_path"] = dst
                job["attempt"] = int(job.get("attempt", 0)) + 1
                with open(dst, "w", encoding="utf-8") as fh:
                    json.dump({k: v for k, v in job.items() if k != "_path"}, fh)
                return job
            if time.time() >= deadline:
                return None
            time.sleep(0.1)

    def ack(self, job: Dict[str, Any]) -> None:
        path = job.get("_path")
        if path and os.path.exists(path):
            os.replace(path, os.path.join(self.dir, "done", os.path.basename(path)))

    def requeue_stale(self) -> int:
        n = 0
        now = time.time()
        for name in os.listdir(os.path.join(self.dir, "inflight")):
            p = os.path.join(self.dir, "inflight", name)
            try:
                if now - os.path.getmtime(p) > self.stale_s:
                    os.replace(p, os.path.join(self.dir, "pending", name))
                    n += 1
            except FileNotFoundError:
                pass
        return n

    def depth(self) -> int:
        return len([n for n in os.listdir(os.path.join(self.dir, "pending")) if n.endswith(".json")])

    def ready(self) -> bool:
        return os.path.isdir(os.path.join(self.dir, "pending"))


class RedisQueue:
    """BRPOPLPUSH-style reliable queue: jobs move from <name> to <name>:inflight
    and are removed on ack. Requires the redis package (container image)."""

    kind = "redis"

    def __init__(self, url: str, name: str = "beacon-jobs") -> None:
        try:
            import redis  # type: ignore
        except ImportError as e:  # pragma: no cover
            raise QueueError("queue.kind=redis needs the redis package (installed in the Beacon container image)") from e
        self._r = redis.Redis.from_url(url, socket_timeout=3, socket_connect_timeout=3)
        self.name = name

    def enqueue(self, job: Dict[str, Any]) -> str:
        job = dict(job)
        job.setdefault("id", uuid.uuid4().hex)
        job.setdefault("enqueued_at", time.time())
        self._r.lpush(self.name, json.dumps(job))
        return job["id"]

    def take(self, timeout_s: float = 1.0) -> Optional[Dict[str, Any]]:
        raw = self._r.brpoplpush(self.name, self.name + ":inflight", timeout=max(1, int(timeout_s)))
        if raw is None:
            return None
        job = json.loads(raw)
        job["_raw"] = raw
        job["attempt"] = int(job.get("attempt", 0)) + 1
        return job

    def ack(self, job: Dict[str, Any]) -> None:
        raw = job.get("_raw")
        if raw is not None:
            self._r.lrem(self.name + ":inflight", 1, raw)

    def requeue_stale(self) -> int:
        n = 0
        for raw in self._r.lrange(self.name + ":inflight", 0, -1):
            self._r.lrem(self.name + ":inflight", 1, raw)
            self._r.lpush(self.name, raw)
            n += 1
        return n

    def depth(self) -> int:
        return int(self._r.llen(self.name))

    def ready(self) -> bool:
        try:
            return bool(self._r.ping())
        except Exception:  # noqa: BLE001
            return False


def open_queue(kind: str, directory: str = "", url: str = "", name: str = "beacon-jobs") -> Any:
    if kind == "none":
        return NoQueue()
    if kind == "dir":
        if not directory:
            raise QueueError("queue.dir is required when queue.kind is dir")
        return DirQueue(directory)
    if kind == "redis":
        if not url:
            raise QueueError("queue.url is required when queue.kind is redis")
        return RedisQueue(url, name)
    raise QueueError(f"unknown queue kind {kind!r}")
