#!/usr/bin/env python3
"""verify_restore.py — prove a restored PostgreSQL database matches its source.

    python3 verify_restore.py --source "$SRC_DSN" --target "$RESTORED_DSN" [--report out.json]

For every table in the compared schemas (default: public) it checks, on both
sides:
  rows       row count
  checksum   md5 over every row's text form, ordered by the primary key
  samples    up to --sample rows chosen by key on the source, looked up by key
             on the target and compared value by value ("selected values")
  sequences  last_value of every sequence (a restore that resets sequences
             breaks the next INSERT)
A restore passes only if every table exists on both sides and all four agree.
Exit 0 on a match, 1 on any difference, 2 if a database cannot be reached.

Read-only on both sides (SELECTs only). Standard library + pgmini.py (next to
this file); no psql or psycopg needed. DSNs may be URLs or key=value strings;
passwords never appear in the report. For a cloud database add
?sslmode=require (encrypted) or sslmode=verify-full&sslrootcert=ca.pem.

Used by lab L24 (local) and cloud extension C04 (sandbox). The data is
synthetic; never point this at production data you are not allowed to read.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pgmini  # noqa: E402

Q = pgmini.literal


def tables(db: pgmini.Connection, schemas: List[str], exclude: List[str]) -> List[str]:
    rows = db.query(
        "SELECT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE c.relkind IN ('r', 'p') AND n.nspname IN (" + ",".join(Q(s) for s in schemas) + ") ORDER BY 1"
    )
    return [r[0] for r in rows if r[0] not in exclude and r[0].split(".", 1)[1] not in exclude]


def pk_columns(db: pgmini.Connection, table: str) -> List[str]:
    rows = db.query(
        "SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
        "WHERE i.indrelid = " + Q(table) + "::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)"
    )
    return [r[0] for r in rows]


def qualified(table: str) -> str:
    schema, name = table.split(".", 1)
    return pgmini.ident(schema) + "." + pgmini.ident(name)


def table_digest(db: pgmini.Connection, table: str, pk: List[str]) -> Tuple[int, Optional[str]]:
    order = ", ".join("t." + pgmini.ident(c) for c in pk) if pk else "t::text"
    rows = db.query(f"SELECT count(*), md5(coalesce(string_agg(t::text, E'\\n' ORDER BY {order}), '')) FROM {qualified(table)} t")
    return int(rows[0][0]), rows[0][1]


def sample(src: pgmini.Connection, dst: pgmini.Connection, table: str, pk: List[str], n: int) -> List[str]:
    """Pick n rows on the source by a stable hash of the key, fetch the same keys on the target, compare."""
    if n <= 0 or len(pk) != 1:
        return [] if n <= 0 else [f"{table}: no single-column primary key; samples skipped (checksum still compared)"]
    col = pgmini.ident(pk[0])
    srows = src.query(f"SELECT t.{col}::text, t::text FROM {qualified(table)} t ORDER BY md5(t.{col}::text) LIMIT {int(n)}")
    if not srows:
        return []
    keys = ",".join(Q(k) for k, _ in srows)
    drows = dict(dst.query(f"SELECT t.{col}::text, t::text FROM {qualified(table)} t WHERE t.{col}::text IN ({keys})"))
    diffs = []
    for k, v in srows:
        if k not in drows:
            diffs.append(f"{table} key {k}: missing on target")
        elif drows[k] != v:
            diffs.append(f"{table} key {k}: source {v[:80]!r} target {drows[k][:80]!r}")
    return diffs


def sequences(db: pgmini.Connection, schemas: List[str]) -> Dict[str, Optional[str]]:
    rows = db.query("SELECT schemaname || '.' || sequencename, last_value::text FROM pg_sequences WHERE schemaname IN (" + ",".join(Q(s) for s in schemas) + ") ORDER BY 1")
    return {k: v for k, v in rows}


def compare(source_dsn: str, target_dsn: str, schemas: Optional[List[str]] = None, exclude: Optional[List[str]] = None, n_sample: int = 25) -> Dict[str, Any]:
    schemas = schemas or ["public"]
    exclude = exclude or []
    report: Dict[str, Any] = {"tool": "verify_restore.py", "started_at": time.time(), "source": pgmini.redact_dsn(source_dsn), "target": pgmini.redact_dsn(target_dsn),
                              "schemas": schemas, "tables": [], "sequences": [], "differences": [], "ok": False}
    try:
        src = pgmini.connect(source_dsn, application_name="verify-restore")
        dst = pgmini.connect(target_dsn, application_name="verify-restore")
    except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
        report["error"] = f"cannot connect: {e}"
        report["finished_at"] = time.time()
        return report
    try:
        for db in (src, dst):  # one consistent snapshot per side
            db.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        report["source_version"] = src.server.get("server_version")
        report["target_version"] = dst.server.get("server_version")
        st, dt = tables(src, schemas, exclude), tables(dst, schemas, exclude)
        for t in sorted(set(st) | set(dt)):
            row: Dict[str, Any] = {"table": t}
            if t not in dt or t not in st:
                row["status"] = "missing on " + ("target" if t not in dt else "source")
                report["differences"].append(f"{t}: {row['status']}")
                report["tables"].append(row)
                continue
            pk = pk_columns(src, t)
            (sn, sh), (dn, dh) = table_digest(src, t, pk), table_digest(dst, t, pk)
            row.update(source_rows=sn, target_rows=dn, source_md5=sh, target_md5=dh, key=pk)
            if sn != dn:
                report["differences"].append(f"{t}: rows source {sn} target {dn}")
            if sh != dh:
                report["differences"].append(f"{t}: checksum differs")
            diffs = sample(src, dst, t, pk, n_sample)
            row["samples_checked"] = 0 if not pk or len(pk) != 1 else min(n_sample, sn)
            row["sample_differences"] = len([d for d in diffs if "skipped" not in d])
            report["differences"] += diffs
            row["status"] = "match" if sn == dn and sh == dh and not row["sample_differences"] else "DIFFERENT"
            report["tables"].append(row)
        ss, ds = sequences(src, schemas), sequences(dst, schemas)
        for s in sorted(set(ss) | set(ds)):
            report["sequences"].append({"sequence": s, "source": ss.get(s), "target": ds.get(s)})
            if ss.get(s) != ds.get(s):
                report["differences"].append(f"sequence {s}: source {ss.get(s)} target {ds.get(s)}")
        report["ok"] = bool(report["tables"]) and not [d for d in report["differences"] if "skipped" not in d]
        if not report["tables"]:
            report["differences"].append("no tables found in the compared schemas")
    except (pgmini.PgError, pgmini.PgConnectionError, OSError) as e:
        report["error"] = str(e)
        report["ok"] = False
    finally:
        for db in (src, dst):
            try:
                db.execute("ROLLBACK")
            except Exception:  # noqa: BLE001
                pass
            db.close()
    report["finished_at"] = time.time()
    return report


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Compare a restored PostgreSQL database with its source: counts, checksums, selected values, sequences.")
    ap.add_argument("--source", required=True, help="source DSN (postgresql://user:pass@host:port/db or key=value)")
    ap.add_argument("--target", required=True, help="restored database DSN")
    ap.add_argument("--schema", action="append", help="schema to compare (repeatable; default public)")
    ap.add_argument("--exclude-table", action="append", default=[], help="schema.table or table to skip (repeatable)")
    ap.add_argument("--sample", type=int, default=25, help="rows per table compared value by value (default 25)")
    ap.add_argument("--report", default="", help="write the JSON report here")
    args = ap.parse_args(argv)
    rep = compare(args.source, args.target, args.schema, args.exclude_table, args.sample)
    for t in rep["tables"]:
        if "source_rows" in t:
            print(f"{t['status']:9} {t['table']:28} rows {t['source_rows']:>8} -> {t['target_rows']:<8} md5 {str(t['source_md5'])[:10]} -> {str(t['target_md5'])[:10]}  samples {t['samples_checked']} ({t['sample_differences']} differ)")
        else:
            print(f"{t['status']:9} {t['table']}")
    for s in rep["sequences"]:
        print(f"{'match' if s['source'] == s['target'] else 'DIFFERENT':9} sequence {s['sequence']:21} {s['source']} -> {s['target']}")
    shown: Dict[str, int] = {}
    for d in rep["differences"]:
        t = d.split(" ", 1)[0].rstrip(":")
        shown[t] = shown.get(t, 0) + 1
        if shown[t] <= 3:
            print("  - " + d)
        elif shown[t] == 4:
            n = sum(1 for x in rep["differences"] if x.split(" ", 1)[0].rstrip(":") == t) - 3
            print(f"  - {t}: ... {n} more difference(s) in the report")
    if rep.get("error"):
        print("ERROR: " + rep["error"], file=sys.stderr)
    print(("RESTORE VERIFIED" if rep["ok"] else "RESTORE NOT VERIFIED") + f" ({len(rep['tables'])} tables, {rep['target']}, {rep['finished_at'] - rep['started_at']:.1f}s)")
    if args.report:
        with open(args.report, "w", encoding="utf-8") as fh:
            json.dump(rep, fh, indent=2)
        print(f"report written to {args.report}")
    if rep.get("error", "").startswith("cannot connect"):
        return 2
    return 0 if rep["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
