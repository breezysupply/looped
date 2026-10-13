"""logsummary — summarise Beacon JSON-lines logs by service and status and report
the most frequent errors.  (L07 starter: the contract is fixed, the bodies are yours.)

CONTRACT — the validator and the tests rely on exactly this:

Input: a file with one JSON object per line. Blank lines are ignored. Every row
must have "ts" (ISO-8601 with a UTC offset or a trailing Z), "service" (non-empty
string) and "status" (integer). Optional: "level", "error", "msg", "message".

A row is an error when status >= 500 or level is "error"/"fatal". Its message is
the first non-empty string of "error", "msg", "message", else "status <code>".

summarize(records, top=5) returns (and `--json` prints, json.dumps(..., indent=2, sort_keys=True)):
  {"total": int, "errors": int,
   "window": {"start": "YYYY-MM-DDTHH:MM:SSZ", "end": "..."} | None,   # in UTC
   "services": {name: {"requests": int, "errors": int, "by_status": {status: count}}},
   "top_errors": [{"message": str, "count": int}, ...]}   # count desc, then message asc; at most `top`

CLI:  python3 logsummary.py PATH [--top N] [--json]
Exit codes: 0 no errors in the log · 1 errors found (summary still printed) ·
            2 input unreadable or malformed (one message on stderr naming file and line; nothing on stdout)
Output must be byte-for-byte identical across runs.
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
    """ISO-8601 with an offset or Z -> aware datetime in UTC. Anything else -> MalformedInput."""
    raise NotImplementedError("L07: implement parse_ts")


def read_records(path: str) -> Iterator[Dict[str, Any]]:
    """Yield one validated record per non-blank line, streaming (never read the whole file).

    Raise MalformedInput naming path:line for unreadable files, invalid JSON, non-object
    rows, missing required keys and non-integer status values.
    """
    raise NotImplementedError("L07: implement read_records")


def summarize(records: Iterable[Dict[str, Any]], top: int = 5) -> Dict[str, Any]:
    """One pass over the records; returns the dict described in the module docstring."""
    raise NotImplementedError("L07: implement summarize")


def render(summary: Dict[str, Any]) -> str:
    """Human-readable, deterministic text for the default (non --json) output."""
    raise NotImplementedError("L07: implement render")


def main(argv: Optional[List[str]] = None, stdout=None, stderr=None) -> int:
    """Parse arguments, run, print, and RETURN the exit code (do not call sys.exit here)."""
    out = stdout or sys.stdout
    err = stderr or sys.stderr
    p = argparse.ArgumentParser(prog="logsummary", description="Summarise Beacon JSON-lines logs by service and status.")
    p.add_argument("path")
    p.add_argument("--top", type=int, default=5)
    p.add_argument("--json", action="store_true")
    args = p.parse_args(argv)
    raise NotImplementedError("L07: implement main (exit codes, stdout versus stderr)")


if __name__ == "__main__":
    sys.exit(main())
