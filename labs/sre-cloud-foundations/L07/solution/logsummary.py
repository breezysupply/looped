"""logsummary — summarise Beacon JSON-lines logs by service and status and report
the most frequent errors.

Reference solution for L07. Read it after your own attempt.

Design (the parts the tests pin down):
  * one streaming pass over the file: read_records() is a generator, so memory is
    bounded by the number of distinct services/statuses/messages, not by the
    number of lines — a 10 GB log costs the same RAM as a 10 KB one;
  * pure functions return data (summarize), one function prints (render), and
    main() is the only place that chooses an exit code;
  * every malformed row is a MalformedInput naming the file and line; nothing is
    skipped silently, because a summary that quietly dropped rows is a wrong
    summary that looks right;
  * timestamps are normalised to UTC, so a window that mixes +02:00 and Z
    offsets is still correct;
  * output is deterministic: services sorted by name, statuses by number, top
    errors by count then message, so two runs can be diffed.

Exit codes: 0 no errors in the log, 1 errors found (the summary is still printed),
2 the input could not be read or parsed (message on stderr, nothing on stdout).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Iterator, List, Optional

EXIT_OK = 0
EXIT_ERRORS_FOUND = 1
EXIT_BAD_INPUT = 2
REQUIRED_KEYS = ("ts", "service", "status")


class MalformedInput(ValueError):
    """The input file (or one of its rows) cannot be used; the message says where."""


def parse_ts(value: Any) -> datetime:
    """Parse an ISO-8601 timestamp with a UTC offset (or trailing Z) into an aware UTC datetime.

    Raises MalformedInput for anything else, including naive timestamps: a log line
    without an offset cannot be placed on a timeline with the others.
    """
    if not isinstance(value, str) or not value.strip():
        raise MalformedInput(f"timestamp must be a non-empty string, got {value!r}")
    text = value.strip()
    if text[-1] in ("Z", "z"):
        text = text[:-1] + "+00:00"  # fromisoformat() on 3.9/3.10 does not accept Z
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise MalformedInput(f"bad timestamp {value!r}") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise MalformedInput(f"timestamp {value!r} has no UTC offset")
    return parsed.astimezone(timezone.utc)


def _check_record(rec: Any, where: str) -> Dict[str, Any]:
    if not isinstance(rec, dict):
        raise MalformedInput(f"{where}: expected a JSON object, got {type(rec).__name__}")
    for key in REQUIRED_KEYS:
        if key not in rec:
            raise MalformedInput(f"{where}: missing key {key!r}")
    status = rec["status"]
    if isinstance(status, bool) or not isinstance(status, int):
        raise MalformedInput(f"{where}: status must be an integer, got {status!r}")
    if not isinstance(rec["service"], str) or not rec["service"]:
        raise MalformedInput(f"{where}: service must be a non-empty string")
    return rec


def read_records(path: str) -> Iterator[Dict[str, Any]]:
    """Yield one validated record per non-blank line. Streams; never loads the whole file.

    Raises MalformedInput (with file:line) for unreadable files, invalid JSON,
    non-object rows, missing required keys and non-integer status values.
    """
    try:
        fh = open(path, "r", encoding="utf-8")
    except OSError as e:
        raise MalformedInput(f"{path}: {e.strerror or e}") from None
    with fh:
        for line_no, line in enumerate(fh, start=1):
            if not line.strip():
                continue
            where = f"{path}:{line_no}"
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as e:
                raise MalformedInput(f"{where}: invalid JSON ({e.msg})") from None
            yield _check_record(rec, where)


def is_error(rec: Dict[str, Any]) -> bool:
    """A row counts as an error when its status is 5xx or its level is error/fatal."""
    level = str(rec.get("level", "")).lower()
    return int(rec["status"]) >= 500 or level in ("error", "fatal")


def error_message(rec: Dict[str, Any]) -> str:
    for key in ("error", "msg", "message"):
        value = rec.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return f"status {rec['status']}"


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def summarize(records: Iterable[Dict[str, Any]], top: int = 5) -> Dict[str, Any]:
    """One O(n) pass. Returns a plain dict (JSON-serialisable, deterministic ordering).

    {"total": int, "errors": int,
     "window": {"start": iso, "end": iso} | None,
     "services": {name: {"requests": int, "errors": int, "by_status": {status: int}}},
     "top_errors": [{"message": str, "count": int}, ...]}
    """
    if top < 0:
        raise ValueError("top must be >= 0")
    services: Dict[str, Dict[str, Any]] = {}
    messages: Dict[str, int] = {}
    total = 0
    errors = 0
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    for rec in records:
        ts = parse_ts(rec["ts"])
        total += 1
        if start is None or ts < start:
            start = ts
        if end is None or ts > end:
            end = ts
        svc = services.setdefault(str(rec["service"]), {"requests": 0, "errors": 0, "by_status": {}})
        svc["requests"] += 1
        status = int(rec["status"])
        svc["by_status"][status] = svc["by_status"].get(status, 0) + 1
        if is_error(rec):
            errors += 1
            svc["errors"] += 1
            msg = error_message(rec)
            messages[msg] = messages.get(msg, 0) + 1
    ordered_services = {
        name: {"requests": s["requests"], "errors": s["errors"], "by_status": {k: s["by_status"][k] for k in sorted(s["by_status"])}}
        for name, s in sorted(services.items())
    }
    top_errors: List[Dict[str, Any]] = [
        {"message": m, "count": c} for m, c in sorted(messages.items(), key=lambda kv: (-kv[1], kv[0]))
    ][:top]
    window = {"start": _iso(start), "end": _iso(end)} if start is not None and end is not None else None
    return {"total": total, "errors": errors, "window": window, "services": ordered_services, "top_errors": top_errors}


def render(summary: Dict[str, Any]) -> str:
    """Human-readable, fixed-width, deterministic text."""
    lines: List[str] = []
    window = summary.get("window")
    span = f"{window['start']} .. {window['end']}" if window else "(no records)"
    lines.append(f"records: {summary['total']}  errors: {summary['errors']}  window: {span}")
    if summary["services"]:
        lines.append(f"{'service':<20}{'requests':>10}{'errors':>8}  statuses")
        for name, s in summary["services"].items():
            statuses = " ".join(f"{k}={v}" for k, v in s["by_status"].items())
            lines.append(f"{name:<20}{s['requests']:>10}{s['errors']:>8}  {statuses}")
    if summary["top_errors"]:
        lines.append("top errors:")
        for e in summary["top_errors"]:
            lines.append(f"  {e['count']:>5}  {e['message']}")
    return "\n".join(lines) + "\n"


def main(argv: Optional[List[str]] = None, stdout=None, stderr=None) -> int:
    """Parse arguments, run, print, return the exit code (never calls sys.exit)."""
    out = stdout or sys.stdout
    err = stderr or sys.stderr
    p = argparse.ArgumentParser(prog="logsummary", description="Summarise Beacon JSON-lines logs by service and status; list the top errors.")
    p.add_argument("path", help="JSON-lines log file (one object per line)")
    p.add_argument("--top", type=int, default=5, help="how many error messages to list (default 5)")
    p.add_argument("--json", action="store_true", help="print the summary as JSON instead of text")
    try:
        args = p.parse_args(argv)
    except SystemExit as e:  # argparse already printed usage to stderr
        return EXIT_BAD_INPUT if e.code else EXIT_OK
    if args.top < 0:
        err.write("logsummary: error: --top must be >= 0\n")
        return EXIT_BAD_INPUT
    try:
        summary = summarize(read_records(args.path), top=args.top)
    except MalformedInput as e:
        err.write(f"logsummary: error: {e}\n")
        return EXIT_BAD_INPUT
    if args.json:
        out.write(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    else:
        out.write(render(summary))
    return EXIT_ERRORS_FOUND if summary["errors"] else EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
