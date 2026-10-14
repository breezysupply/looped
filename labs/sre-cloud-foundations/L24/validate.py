#!/usr/bin/env python3
"""L24 validator: queries the source (looped-l24-db, 127.0.0.1:15424), the
restore target (looped-l24-restore, 127.0.0.1:15425), your recovery clock and
the queue/ledger tables. Compares source and target with the same code as
assets/verify_restore.py (read-only on both).

The replay test is the one place it writes: it enqueues four fresh messages
with keys l24-check-<time>-* (one of them twice), tells the worker to crash
once before and once after a side effect (queue.faults), and waits for the
queue to drain. That is the behaviour a downstream team cares about, so it is
tested, not inferred from your code.

Checks (critical unless noted):
  source-intact      the source still holds the 58 000 records with the checksum recorded at setup
  damaged-flagged    the damaged morning backup is not what you restored from, and that backup is readable (pg_restore --list)
  restore-fresh      looped-l24-restore exists and was created after your recovery clock started
  restore-matches    target equals source: counts, checksums, selected values and sequences in schema public
  recovery-measured  work/recovery.json: started -> verified interval consistent with the verification report
  worker-running     looped-l24-worker is running
  unique-key         ledger.deliveries has a UNIQUE constraint or index on idempotency_key alone
  no-duplicates      no idempotency key has more than one delivery
  all-delivered      every enqueued key was delivered exactly once and no job is stuck
  replay-test        fresh messages with a duplicate and two crashes: each key delivered once, crashes really happened
  notes              notes sections have substance and state RPO/RTO with numbers (advisory)
Exit 1 if any critical check fails. Writes the evidence JSON.
"""
import calendar
import hashlib
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
sys.path.insert(0, os.path.join(HERE, "assets"))
import pgmini  # noqa: E402
import verify_restore  # noqa: E402

PW = "lab-l24-db-not-a-real-secret"
SRC = f"postgresql://beacon:{PW}@127.0.0.1:15424/beacon?sslmode=disable"
DST = f"postgresql://beacon:{PW}@127.0.0.1:15425/beacon?sslmode=disable"


def load_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def q(db, sql):
    try:
        return db.query(sql), ""
    except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
        return None, str(e)[:200]


def docker_created(name):
    code, out, _ = L.docker(["inspect", "-f", "{{.Created}}|{{.State.Status}}|{{.RestartCount}}", name])
    if code != 0:
        return None, None, None
    created, status, restarts = out.strip().split("|")
    # 2026-10-13T22:46:40.123456789Z -> epoch seconds (UTC)
    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?Z", created)
    ts = None
    if m:
        ts = calendar.timegm(time.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S")) + float(m.group(2) or 0)
    return ts, status, int(restarts or 0)


def replay_test(db):
    """Enqueue fresh messages with a producer duplicate and two worker crashes; wait; count effects."""
    tag = "l24-check-%d" % int(time.time())
    keys = [f"{tag}-a", f"{tag}-b", f"{tag}-c", f"{tag}-d"]
    _, err = q(db, "INSERT INTO queue.faults (idempotency_key, mode) VALUES (%s, 'before-effect'), (%s, 'after-effect')" % (pgmini.literal(keys[1]), pgmini.literal(keys[2])))
    if err:
        return False, f"cannot write queue.faults: {err}"
    vals = ",".join("(%s, 's-0001')" % pgmini.literal(k) for k in keys + [keys[0]])  # keys[0] enqueued twice
    _, err = q(db, "INSERT INTO queue.jobs (idempotency_key, sensor_id) VALUES " + vals)
    if err:
        return False, f"cannot enqueue: {err}"
    lit = ",".join(pgmini.literal(k) for k in keys)
    deadline = time.time() + 60
    left = None
    while time.time() < deadline:
        rows, _ = q(db, f"SELECT count(*) FROM queue.jobs WHERE idempotency_key IN ({lit}) AND state <> 'done'")
        left = int(rows[0][0]) if rows else None
        if left == 0:
            break
        time.sleep(1)
    eff, _ = q(db, f"SELECT idempotency_key, count(*) FROM ledger.deliveries WHERE idempotency_key IN ({lit}) GROUP BY 1")
    eff = {k: int(n) for k, n in (eff or [])}
    used, _ = q(db, f"SELECT idempotency_key, used FROM queue.faults WHERE idempotency_key IN ({lit})")
    used = {k: v == "t" for k, v in (used or [])}
    att, _ = q(db, f"SELECT idempotency_key, max(attempts) FROM queue.jobs WHERE idempotency_key IN ({lit}) GROUP BY 1")
    att = {k: int(n) for k, n in (att or [])}
    per_key = ", ".join(f"{k.rsplit('-', 1)[1]}={eff.get(k, 0)}" for k in keys)
    crashed = used.get(keys[1]) and used.get(keys[2]) and att.get(keys[1], 0) >= 2 and att.get(keys[2], 0) >= 2
    ok = left == 0 and all(eff.get(k) == 1 for k in keys) and crashed
    obs = f"deliveries per key ({per_key}); crashes fired before/after effect: {used.get(keys[1])}/{used.get(keys[2])}; jobs left {left}"
    if not crashed:
        obs += " (the lab fault hook did not fire: keep lab_fault() in work/worker.py)"
    return ok, obs


def main():
    args = L.standard_args("L24", "Validate L24 (backup, restore, idempotent delivery) against the looped-l24 project")
    r = L.Report("L24", "compose")
    L.apply_args(r, args)
    state = load_json(os.path.join(WORK, ".l24-state.json"), {}) or {}
    variant = state.get("variant") or (L.read_text(os.path.join(WORK, ".variant")) or "variant-a").strip()
    if not args.variant:
        r.seed = variant
    notes = L.read_text(os.path.join(EV, "L24-notes.md")) or ""
    clock = load_json(os.path.join(WORK, "recovery.json"), {}) or {}

    try:
        src = pgmini.connect(SRC, application_name="l24-validate")
    except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
        r.check("source-intact", False, f"cannot connect to looped-l24-db on 127.0.0.1:15424: {e}")
        return r.finish(args.out, args.explanation or notes[:4000], {"variant_file": variant})

    # ── c1: backup and restore ──────────────────────────────────────
    rows, err = q(src, "SELECT count(*), md5(string_agg(t::text, E'\\n' ORDER BY t.id)) FROM public.records t")
    if rows:
        n, digest = int(rows[0][0]), rows[0][1]
        r.check("source-intact", n == state.get("records") and digest == state.get("records_md5"), f"source {n} records md5 {str(digest)[:12]} (setup: {state.get('records')} / {str(state.get('records_md5'))[:12]})")
    else:
        r.check("source-intact", False, f"cannot read public.records: {err}")

    used_backup = clock.get("backup_file") or ""
    damaged = state.get("damaged_sha256")
    b_ok, b_obs = False, "no backup recorded in work/recovery.json (recovery_clock.py stop --backup ...)"
    if used_backup:
        if not os.path.isfile(used_backup):
            b_obs = f"{os.path.basename(used_backup)} no longer exists"
        else:
            with open(used_backup, "rb") as fh:
                data = fh.read()
            sha = hashlib.sha256(data).hexdigest()
            # pg_restore --list reads the file from stdin inside the source container (no host client needed)
            try:
                pr = subprocess.run(["docker", "exec", "-i", "looped-l24-db", "pg_restore", "--list"], input=data, capture_output=True, timeout=60)
                listed, perr = pr.returncode == 0 and b"TABLE DATA public records" in pr.stdout, pr.stderr.decode("utf-8", "replace").strip()[:120]
            except (OSError, subprocess.TimeoutExpired) as e:
                listed, perr = False, str(e)
            b_ok = bool(damaged) and sha != damaged and sha == clock.get("backup_sha256") and listed
            b_obs = f"restored from {os.path.basename(used_backup)}: " + ("the damaged morning backup" if sha == damaged else "not the damaged backup") + f"; pg_restore --list {'readable' if listed else 'FAILED ' + perr}" + ("" if sha == clock.get("backup_sha256") else "; file changed since the clock stopped")
    r.check("damaged-flagged", b_ok, b_obs)

    created, rstatus, _ = docker_created("looped-l24-restore")
    started = clock.get("started_at")
    fresh = bool(created and started and created >= started - 1 and rstatus == "running")
    r.check("restore-fresh", fresh, f"looped-l24-restore {rstatus}, created {time.strftime('%H:%M:%S', time.gmtime(created))}Z, clock started {time.strftime('%H:%M:%S', time.gmtime(started))}Z" if created and started else ("looped-l24-restore does not exist" if not created else "recovery clock not started (assets/recovery_clock.py start)"))

    rep = verify_restore.compare(SRC, DST) if created else {"ok": False, "error": "no restore target", "tables": [], "differences": []}
    summary = "; ".join(f"{t['table'].split('.')[-1]} {t.get('source_rows', '?')}->{t.get('target_rows', '?')} {t['status']}" for t in rep.get("tables", []))
    r.check("restore-matches", bool(rep.get("ok")), (summary or rep.get("error", "")) + ("" if rep.get("ok") else " | " + "; ".join(rep.get("differences", [])[:3])))

    rep_file = load_json(clock.get("report") or os.path.join(WORK, "verify-report.json"), {}) or {}
    m_ok = bool(started and clock.get("verified_at") and clock.get("interval_s") is not None and rep_file.get("ok")
                and abs((clock["verified_at"] - started) - clock["interval_s"]) <= 2 and clock["verified_at"] >= started
                and "15425" in str(rep_file.get("target", "")) and (not created or clock["verified_at"] >= created))
    r.check("recovery-measured", m_ok, f"measured {clock.get('interval_s')} s from start to verified ({float(clock.get('interval_s') or 0) / 60:.1f} min); report ok={rep_file.get('ok')} target={rep_file.get('target')}" if clock.get("verified_at") else "recovery clock not stopped with a passing verification report")

    # ── c2: idempotent delivery ─────────────────────────────────────
    _, wstatus, wrestarts = docker_created("looped-l24-worker")
    r.check("worker-running", wstatus == "running", f"looped-l24-worker {wstatus}, restarts {wrestarts}")
    rows, err = q(src, "SELECT i.indexrelid::regclass::text FROM pg_index i WHERE i.indrelid = 'ledger.deliveries'::regclass AND i.indisunique AND i.indnatts = 1 AND i.indpred IS NULL "
                       "AND (SELECT attname FROM pg_attribute WHERE attrelid = i.indrelid AND attnum = i.indkey[0]) = 'idempotency_key'")
    r.check("unique-key", bool(rows), f"unique index/constraint on ledger.deliveries(idempotency_key): {rows[0][0]}" if rows else ("no unique constraint on ledger.deliveries(idempotency_key)" + (f" ({err})" if err else "")))
    rows, err = q(src, "SELECT idempotency_key, count(*) FROM ledger.deliveries GROUP BY 1 HAVING count(*) > 1 ORDER BY 1")
    r.check("no-duplicates", rows == [], "no key delivered more than once" if rows == [] else (f"{len(rows)} key(s) delivered more than once" if rows else f"cannot read ledger: {err}"))
    injected = bool(state.get("injected_at"))
    rows, _ = q(src, "SELECT j.k, coalesce(d.n, 0) FROM (SELECT DISTINCT idempotency_key AS k FROM queue.jobs WHERE idempotency_key LIKE 'l24-msg-%') j "
                     "LEFT JOIN (SELECT idempotency_key, count(*) AS n FROM ledger.deliveries GROUP BY 1) d ON d.idempotency_key = j.k")
    stuck, _ = q(src, "SELECT count(*) FROM queue.jobs WHERE state <> 'done' AND enqueued_at < now() - interval '30 seconds'")
    bad = [k for k, n in (rows or []) if n != "1"]
    n_stuck = int(stuck[0][0]) if stuck else -1
    r.check("all-delivered", injected and bool(rows) and len(rows) == 20 and not bad and n_stuck == 0,
            f"{len(rows or [])} distinct messages, {len(rows or []) - len(bad)} delivered exactly once, {n_stuck} job(s) stuck" if injected else "inject.sh has not run")
    if wstatus == "running" and injected:
        ok, obs = replay_test(src)
    else:
        ok, obs = False, "worker not running or faults not injected; replay test skipped"
    r.check("replay-test", ok, obs)
    src.close()

    template = set(x.strip() for x in (L.read_text(os.path.join(HERE, "assets", "notes-template.md")) or "").splitlines())
    body = "\n".join(x for x in notes.splitlines() if x.strip() not in template and not x.startswith(("#", ">")))
    secs = [s for s in ("Backup inspection", "Restore and verification", "Recovery interval, RPO and RTO", "Duplicate deliveries", "Idempotency fix") if re.search(r"^## " + re.escape(s), notes, re.M)]
    nums = bool(re.search(r"RPO[^\n]{0,80}\d", body)) and bool(re.search(r"RTO[^\n]{0,80}\d", body))
    r.check("notes", len(secs) == 5 and len(body.strip()) >= 700 and nums, f"{len(secs)}/5 sections, {len(body.strip())} chars, RPO/RTO with numbers: {nums}", critical=False)

    extra = {"variant_file": variant, "recovery_interval_s": clock.get("interval_s"), "worker_restarts": wrestarts}
    return r.finish(args.out, args.explanation or notes[:4000], extra)


if __name__ == "__main__":
    sys.exit(main())
