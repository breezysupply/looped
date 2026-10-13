#!/usr/bin/env python3
"""L23 validator: queries the looped-l23 PostgreSQL database (through
`docker exec looped-l23-db psql`), the fixture container's session record and
the API pool's status file. Read-only: EXPLAIN without ANALYZE, catalog and
pg_stat_activity queries. Touches only looped-l23-* objects.

Checks (critical unless noted):
  db-up             looped-l23-db answers and runs PostgreSQL 16
  dataset-intact    the 200 000 seeded readings have the checksum recorded at setup (nothing deleted to "fix" it)
  plan-uses-index   the ticket query's plan reads readings through an index
  plan-cheaper      the planner's total cost is at most 10% of the baseline recorded at setup
  index-fits        the index used leads with the query's equality column; at most two new indexes; all valid
  before-plan       evidence/L23-notes.md holds a "before" plan with a sequential scan (advisory)
  fault-ran         inject.sh ran (checkpoint c2 started)
  no-lock-waits     no session is waiting on a lock
  blocker-ended     the session that held the lock is gone
  blocker-named     the blocker_pid in your notes is that session's pid
  report-kept       the long-running report session was NOT terminated (same pid, still there)
  pool-kept         the API pool's original connections were NOT terminated
  intended-writes   all twelve queued status updates committed exactly once, sensors show the last status
  notes             notes sections have substance (advisory)
Exit 1 if any critical check fails. Writes the evidence JSON.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
DB = "looped-l23-db"
HOT = ("s-0042", "s-0007", "s-0113")
JOBS = [{"key": "l23-job-%02d" % i, "sensor": HOT[i % 3], "status": ("degraded", "ok", "fault")[i % 3]} for i in range(1, 13)]
LEAD = {"variant-a": "sensor_id", "variant-b": "site"}


def psql(sql, timeout=60):
    """Rows (lists of str) from psql -At in the lab container; (None, error) on failure."""
    code, out, err = L.docker(["exec", "-i", DB, "psql", "-X", "-At", "-F", "\t", "-U", "beacon", "-d", "beacon", "-v", "ON_ERROR_STOP=1", "-c", sql], timeout=timeout)
    if code != 0:
        return None, (err or out).strip()[:300]
    return [line.split("\t") for line in out.splitlines() if line != ""], ""


def load_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def plan_nodes(node, out):
    out.append(node)
    for child in node.get("Plans", []) or []:
        plan_nodes(child, out)
    return out


def main():
    args = L.standard_args("L23", "Validate L23 (indexes, locks, pools) against the looped-l23 database")
    r = L.Report("L23", "compose")
    L.apply_args(r, args)
    state = load_json(os.path.join(WORK, ".l23-state.json"), {}) or {}
    variant = state.get("variant") or (L.read_text(os.path.join(WORK, ".variant")) or "variant-a").strip()
    if not args.variant:
        r.seed = variant
    notes = L.read_text(os.path.join(EV, "L23-notes.md")) or ""

    rows, err = psql("SHOW server_version")
    up = rows is not None and rows and rows[0][0].startswith("16")
    r.check("db-up", bool(up), f"server_version {rows[0][0]}" if rows else f"cannot query {DB}: {err}")
    if not up:
        return r.finish(args.out, args.explanation or notes[:4000], {"variant_file": variant})

    # ── c1: dataset and plan ────────────────────────────────────────
    rows, err = psql("SELECT count(*), md5(string_agg(id || '|' || sensor_id || '|' || site || '|' || ts || '|' || status || '|' || value, ',' ORDER BY id)) FROM readings WHERE id BETWEEN 1 AND 200000")
    if rows:
        n, digest = int(rows[0][0]), rows[0][1]
        r.check("dataset-intact", n == 200000 and digest == state.get("readings_md5"), f"{n} seeded rows, md5 {digest[:12] if digest else None} (setup recorded {str(state.get('readings_md5'))[:12]})")
    else:
        r.check("dataset-intact", False, f"cannot read readings: {err}")

    query = (L.read_text(os.path.join(WORK, "ticket-query.sql")) or "").strip().rstrip(";")
    plan, used_idx = None, []
    if query:
        rows, err = psql("EXPLAIN (FORMAT JSON) " + query)
        if rows:
            try:
                plan = json.loads("\n".join(x[0] for x in rows))[0]["Plan"]
            except (ValueError, KeyError, IndexError):
                plan = None
    nodes = plan_nodes(plan, []) if plan else []
    idx_nodes = [n for n in nodes if n.get("Node Type") in ("Index Scan", "Index Only Scan", "Bitmap Index Scan") and (n.get("Relation Name") in (None, "readings")) and n.get("Index Name") != "readings_pkey"]
    used_idx = sorted({n.get("Index Name") for n in idx_nodes})
    shape = " > ".join(n.get("Node Type", "?") for n in nodes[:5])
    r.check("plan-uses-index", bool(idx_nodes), f"plan: {shape}; index used: {', '.join(used_idx) or 'none'}" if plan else f"cannot EXPLAIN the ticket query: {err if query else 'work/ticket-query.sql missing'}")
    cost, base = (plan or {}).get("Total Cost"), state.get("baseline_cost")
    r.check("plan-cheaper", bool(cost is not None and base and cost <= 0.10 * base), f"total cost {cost} vs baseline {base}" + (f" ({100.0 * cost / base:.1f}%)" if cost is not None and base else ""))

    rows, err = psql("SELECT i.relname, pg_get_indexdef(x.indexrelid), x.indisvalid FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid WHERE t.relname = 'readings' AND NOT x.indisprimary ORDER BY 1")
    rows = rows or []
    lead = LEAD.get(variant, "sensor_id")
    fits = []
    for name, ddl, valid in rows:
        cols = re.search(r"\((.*?)\)", ddl)
        first = cols.group(1).split(",")[0].strip().split()[0].strip('"') if cols else ""
        if name in used_idx and first == lead and valid == "t":
            fits.append(name)
    invalid = [x[0] for x in rows if x[2] != "t"]
    r.check("index-fits", bool(fits) and len(rows) <= 2 and not invalid,
            f"{len(rows)} new index(es) on readings: " + "; ".join(x[1].split(" USING ")[-1] for x in rows)[:300] + (f"; invalid: {invalid}" if invalid else "") + (f"; used index leads with {lead}" if fits else f"; no used index leads with {lead}"))
    r.check("before-plan", bool(re.search(r"Seq Scan on readings", notes)), "notes contain a 'Seq Scan on readings' plan" if re.search(r"Seq Scan on readings", notes) else "no before-plan with 'Seq Scan on readings' pasted in evidence/L23-notes.md", critical=False)

    # ── c2: locks and the pool ───────────────────────────────────────
    injected = bool(state.get("injected_at"))
    r.check("fault-ran", injected, "inject.sh ran" if injected else "inject.sh has not run yet (checkpoint c2)")
    code, out, _ = L.docker(["exec", "looped-l23-fixtures", "cat", "/tmp/fixtures-status.json"])
    fx = {}
    if code == 0:
        try:
            fx = json.loads(out)
        except ValueError:
            fx = {}
    blocker_pid = (fx.get("backfill") or {}).get("pid")
    report_pid = (fx.get("report") or {}).get("pid")
    act, err = psql("SELECT pid, coalesce(application_name,''), state, coalesce(wait_event_type,''), cardinality(pg_blocking_pids(pid)) FROM pg_stat_activity WHERE datname = 'beacon' AND pid <> pg_backend_pid()")
    act = act or []
    pids = {int(a[0]): a for a in act}
    waiting = [a for a in act if a[3] == "Lock"]
    r.check("no-lock-waits", injected and not waiting, f"{len(waiting)} session(s) waiting on a lock: " + ", ".join(f"pid {a[0]} ({a[1]}) blocked by {a[4]}" for a in waiting[:4]) if waiting else ("no session waits on a lock" if injected else "fault not injected"))
    r.check("blocker-ended", bool(blocker_pid) and blocker_pid not in pids, f"the lock holder (pid {blocker_pid}) is gone" if blocker_pid and blocker_pid not in pids else (f"the session holding the lock is still connected ({pids[blocker_pid][2]})" if blocker_pid else "fixture record unavailable (inject.sh not run, or the fixture container was removed)"))
    m = re.search(r"blocker_pid:\s*(\d+)", notes)
    named = int(m.group(1)) if m else None
    r.check("blocker-named", bool(blocker_pid) and named == blocker_pid, f"notes name pid {named}; the lock holder was pid {blocker_pid}" if m else "no 'blocker_pid: <n>' line in evidence/L23-notes.md")
    report_alive = bool(report_pid) and report_pid in pids
    r.check("report-kept", report_alive, f"report session pid {report_pid} still {pids[report_pid][2]}" if report_alive else (f"report session pid {report_pid} was terminated (it held no conflicting lock)" if report_pid else "fixture record unavailable"))

    pool = load_json(os.path.join(WORK, "pool", "pool-status.json"), {}) or {}
    initial = [p for p in pool.get("initial_pids", []) if p]
    gone = [p for p in initial if p not in pids]
    r.check("pool-kept", bool(initial) and not gone, f"pool's {len(initial)} original connections still open; reconnects={pool.get('reconnects')}" if initial and not gone else (f"pool connections terminated: {gone}; reconnects={pool.get('reconnects')}" if initial else "pool status unavailable"))

    rows, err = psql("SELECT idem_key, count(*) FROM status_events WHERE idem_key LIKE 'l23-job-%' GROUP BY idem_key")
    have = {k: int(n) for k, n in (rows or [])}
    missing = [j["key"] for j in JOBS if have.get(j["key"]) != 1]
    last = {}
    for j in JOBS:
        last[j["sensor"]] = j["status"]
    srows, _ = psql("SELECT id, last_status FROM sensors WHERE id IN ('s-0042','s-0007','s-0113')")
    sens = {a: b for a, b in (srows or [])}
    stale = [s for s, st in last.items() if sens.get(s) != st]
    r.check("intended-writes", injected and not missing and not stale, f"{12 - len(missing)}/12 updates committed once; sensors last_status {sens}" + (f"; missing/duplicated: {missing[:4]}" if missing else "") + (f"; stale sensors: {stale}" if stale else ""))

    template = set(l.strip() for l in (L.read_text(os.path.join(HERE, "assets", "notes-template.md")) or "").splitlines())
    body = "\n".join(l for l in notes.splitlines() if l.strip() not in template and not l.startswith(("#", ">")))
    secs = [s for s in ("Plan before", "Plan after", "Why this index", "When an index would not help", "Blocker", "Pool saturation", "Action and why not more") if re.search(r"^## " + s, notes, re.M)]
    r.check("notes", len(secs) == 7 and len(body.strip()) >= 900, f"{len(secs)}/7 sections, {len(body.strip())} chars", critical=False)

    extra = {"variant_file": variant, "server_version": up and "16", "pool_acquire_timeouts": pool.get("acquire_timeouts"), "index_used": ",".join(used_idx)}
    return r.finish(args.out, args.explanation or notes[:4000], extra)


if __name__ == "__main__":
    sys.exit(main())
