"""L23 fault fixture: two long-lived database sessions started by inject.sh.

  beacon-backfill  opens a transaction, takes a lock (which one depends on the
                   variant) and then waits client-side: "idle in transaction".
  beacon-report    runs a long read-only report, over and over, on one
                   connection: the oldest *active* query in pg_stat_activity.

One of them is in the API's way and one is not. Which is which is what the
learner proves from pg_locks / pg_stat_activity / pg_blocking_pids(), not from
these names. Status (pids, what happened to each session) is kept in
/tmp/fixtures-status.json inside this container for the validator.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pgmini  # noqa: E402

DSN = os.environ["L23_DSN"]
VARIANT = os.environ.get("L23_VARIANT", "variant-a")
STATUS = "/tmp/fixtures-status.json"
HOT = ("s-0042", "s-0007", "s-0113")

state = {"variant": VARIANT, "backfill": {}, "report": {}, "started": time.time()}
lock = threading.Lock()


def save() -> None:
    with lock:
        tmp = STATUS + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
        os.replace(tmp, STATUS)


def log(msg: str, **kw: object) -> None:
    print(json.dumps(dict(ts=time.strftime("%H:%M:%S"), msg=msg, **kw)), flush=True)


def backfill() -> None:
    c = pgmini.connect(DSN, application_name="beacon-backfill")
    state["backfill"] = {"pid": c.pid, "alive": True}
    save()
    if VARIANT == "variant-b":
        # a "consistency check" someone started by hand and never finished
        c.execute("BEGIN; LOCK TABLE status_events IN SHARE MODE; SELECT count(*) FROM status_events;")
    else:
        # a backfill that touched the busiest sensors and was left open
        c.execute("BEGIN; UPDATE sensors SET model = model WHERE id IN (" + ",".join(pgmini.literal(s) for s in HOT) + ");")
    log("backfill session holding its transaction open", pid=c.pid)
    c.sock.settimeout(5)
    while True:  # never commits; waits until the server ends the session
        try:
            # the server sends FATAL 57P01 and closes when the backend is terminated
            c.sock.recv(1, socket.MSG_PEEK)
        except (TimeoutError, socket.timeout):
            continue
        except OSError:
            pass
        how = "server ended the session"
        try:
            c.sock.settimeout(1)
            c.query("SELECT 1")
        except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
            how = str(e)[:100]
        state["backfill"].update(alive=False, ended=time.time(), how=how)
        save()
        log("backfill session ended", pid=state["backfill"]["pid"], how=how)
        return


def report() -> None:
    c = pgmini.connect(DSN, application_name="beacon-report")
    state["report"] = {"pid": c.pid, "alive": True, "runs": 0}
    save()
    c.execute("SET max_parallel_workers_per_gather = 0")
    log("report session started", pid=c.pid)
    while True:
        try:
            # a slow, read-only aggregate: about 15 minutes per run
            c.query("SELECT site, count(*), avg(value) FROM readings WHERE pg_sleep(0.0045) IS NOT NULL GROUP BY site")
            state["report"]["runs"] += 1
            save()
        except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
            state["report"].update(alive=False, ended=time.time(), how=str(e)[:80])
            save()
            log("report session ended", pid=state["report"].get("pid"), how=str(e)[:80])
            return


def main() -> int:
    t1 = threading.Thread(target=backfill, daemon=True)
    t1.start()
    time.sleep(0.5)
    t2 = threading.Thread(target=report, daemon=True)
    t2.start()
    while True:
        time.sleep(10)
        save()


if __name__ == "__main__":
    raise SystemExit(main())
