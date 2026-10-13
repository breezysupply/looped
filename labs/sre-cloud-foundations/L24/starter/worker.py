"""Beacon delivery worker (L24 lab copy — this file is yours to change).

Takes jobs from queue.jobs (a Redis-free queue in PostgreSQL), performs the
side effect (one row in ledger.deliveries = one notification delivered
downstream), then acknowledges the job.

Delivery is at-least-once: a job is leased for LEASE_S seconds; if the worker
dies before acknowledging, the lease expires and the job is taken again.

Runs in the looped-l24-worker container: edit this file, then
`docker restart looped-l24-worker`.
"""
import json
import os
import time

import pgmini

DSN = os.environ["L24_DSN"]
LEASE_S = 5


def log(msg, **kw):
    print(json.dumps(dict(ts=time.strftime("%H:%M:%S"), service="beacon-worker", msg=msg, **kw)), flush=True)


def connect():
    for attempt in range(60):
        try:
            return pgmini.connect(DSN, application_name="beacon-worker")
        except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
            log("database not reachable yet", attempt=attempt + 1, error=str(e)[:100])
            time.sleep(1)
    raise SystemExit("database unreachable")


def claim(db):
    """Lease the oldest ready (or lease-expired) job. Returns (id, key, sensor, attempts) or None."""
    rows = db.query(
        "UPDATE queue.jobs SET state = 'leased', attempts = attempts + 1, leased_until = now() + interval '%d seconds' "
        "WHERE id = (SELECT id FROM queue.jobs WHERE state = 'ready' OR (state = 'leased' AND leased_until < now()) "
        "ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) "
        "RETURNING id, idempotency_key, sensor_id, attempts" % LEASE_S
    )
    if not rows:
        return None
    jid, key, sensor, attempts = rows[0]
    return int(jid), key, sensor, int(attempts)


def lab_fault(db, key, when):
    """Lab fault hook — keep it. inject.sh and validate.py use queue.faults to
    crash this worker once, before or after the side effect, for a given key."""
    rows = db.query(
        "UPDATE queue.faults SET used = true WHERE idempotency_key = %s AND mode = %s AND NOT used RETURNING mode"
        % (pgmini.literal(key), pgmini.literal(when))
    )
    if rows:
        log("lab fault: worker crashing", idempotency_key=key, when=when)
        os._exit(137)


def deliver(db, job_id, key, sensor):
    """The side effect: notify downstream (here: a row in ledger.deliveries)."""
    db.query(
        "INSERT INTO ledger.deliveries (idempotency_key, job_id, sensor_id) VALUES (%s, %d, %s)"
        % (pgmini.literal(key), job_id, pgmini.literal(sensor))
    )
    return "delivered"


def ack(db, job_id):
    db.query("UPDATE queue.jobs SET state = 'done', done_at = now() WHERE id = %d" % job_id)


def main():
    db = connect()
    log("worker started", pid=os.getpid(), lease_s=LEASE_S)
    while True:
        job = claim(db)
        if job is None:
            time.sleep(0.5)
            continue
        job_id, key, sensor, attempts = job
        lab_fault(db, key, "before-effect")
        outcome = deliver(db, job_id, key, sensor)
        lab_fault(db, key, "after-effect")
        ack(db, job_id)
        log("job done", job_id=job_id, idempotency_key=key, attempt=attempts, outcome=outcome)


if __name__ == "__main__":
    main()
