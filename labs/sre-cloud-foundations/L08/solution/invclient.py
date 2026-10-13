"""invclient — a careful client for the lab inventory API (L08 reference solution).

Read it after your own attempt. What it guarantees (the contract in the starter):

  * every network call has a finite timeout;
  * retries are bounded (1 + max_retries attempts) and only for failures that are
    safe and likely to be transient: timeouts, connection errors, 429, 502/503/504,
    and a 200 whose body is not valid JSON — for GET;
  * a 429/503 with Retry-After waits exactly that long (capped), otherwise
    exponential backoff;
  * a POST is retried only when the caller supplied an Idempotency-Key, and the
    same key is sent on every attempt; without one, the first failure is final and
    the error says the outcome is unknown;
  * pagination stops on a missing/empty next_page_token, and raises
    PaginationLoop when a token repeats (or after max_pages);
  * the bearer token never appears in a log line, an exception message or output.

Exit codes (main): 0 success · 2 usage/configuration error · 3 the API call failed
after the allowed attempts (including a pagination loop). Errors go to stderr.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_API = 3
RETRYABLE_STATUS = (429, 502, 503, 504)
MAX_RETRY_AFTER_S = 30.0

Transport = Callable[[str, str, Dict[str, str], Optional[bytes], float], Tuple[int, Dict[str, str], bytes]]


class ApiError(Exception):
    """The call failed for good. Messages name the method, path and reason — never credentials."""


class PaginationLoop(ApiError):
    """The server handed back a page token we have already followed."""


def http_transport(method: str, url: str, headers: Dict[str, str], body: Optional[bytes], timeout: float) -> Tuple[int, Dict[str, str], bytes]:
    """One HTTP exchange with urllib. Returns (status, lower-cased headers, body).

    HTTP error statuses are returned, not raised. Raises TimeoutError on a timeout and
    ConnectionError for anything that prevented an answer.
    """
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # the fixture is local: never via a proxy
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()
    except TimeoutError:
        raise
    except urllib.error.URLError as e:
        if isinstance(e.reason, TimeoutError):
            raise TimeoutError(str(e.reason)) from None
        raise ConnectionError(str(e.reason)) from None
    except OSError as e:  # e.g. reset while reading
        if "timed out" in str(e):
            raise TimeoutError(str(e)) from None
        raise ConnectionError(str(e)) from None


class InventoryClient:
    def __init__(self, base_url: str, token: str, *, timeout: float = 2.0, max_retries: int = 3, backoff_s: float = 0.5,
                 max_pages: int = 1000, transport: Optional[Transport] = None, sleep: Callable[[float], None] = time.sleep,
                 log: Optional[Callable[[str], None]] = None) -> None:
        if not (0 < float(timeout) <= 30):
            raise ValueError("timeout must be > 0 and <= 30 seconds")
        if not (0 <= int(max_retries) <= 10):
            raise ValueError("max_retries must be between 0 and 10")
        self.base_url = base_url.rstrip("/")
        self._token = token
        self.timeout = float(timeout)
        self.max_retries = int(max_retries)
        self.backoff_s = float(backoff_s)
        self.max_pages = int(max_pages)
        self.transport = transport or http_transport
        self.sleep = sleep
        self.log = log or (lambda msg: None)

    def __repr__(self) -> str:  # never show the token
        return f"InventoryClient({self.base_url!r}, token=<redacted>)"

    def _delay(self, attempt: int, headers: Dict[str, str]) -> float:
        ra = headers.get("retry-after")
        if ra is not None:
            try:
                return min(max(float(ra), 0.0), MAX_RETRY_AFTER_S)
            except ValueError:
                pass
        return self.backoff_s * (2 ** attempt)

    def request(self, method: str, path: str, *, body: Optional[Dict[str, Any]] = None, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        method = method.upper()
        retry_allowed = method in ("GET", "HEAD") or idempotency_key is not None
        url = self.base_url + path
        headers = {"Authorization": "Bearer " + self._token, "Accept": "application/json", "User-Agent": "looped-invclient/1.0"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        attempts = 1 + (self.max_retries if retry_allowed else 0)
        last = ""
        for attempt in range(attempts):
            delay = None
            try:
                status, rh, raw = self.transport(method, url, headers, data, self.timeout)
            except TimeoutError:
                last = f"timed out after {self.timeout:g}s"
                delay = self._delay(attempt, {})
            except ConnectionError as e:
                last = f"connection failed ({e})"
                delay = self._delay(attempt, {})
            else:
                if 200 <= status < 300:
                    try:
                        return json.loads(raw.decode("utf-8")) if raw else {}
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        last = f"HTTP {status} with a body that is not valid JSON"
                        delay = self._delay(attempt, {})
                elif status in RETRYABLE_STATUS:
                    last = f"HTTP {status}"
                    delay = self._delay(attempt, rh)
                else:
                    raise ApiError(f"{method} {path}: HTTP {status} (not retryable)")
            if not retry_allowed:
                raise ApiError(f"{method} {path}: {last}; not retried (no Idempotency-Key), so the outcome is unknown")
            if attempt + 1 < attempts:
                self.log(f"{method} {path}: {last}; retry {attempt + 1}/{self.max_retries} in {delay:g}s")
                self.sleep(delay)
        raise ApiError(f"{method} {path}: {last}; gave up after {attempts} attempts")

    def list_inventory(self, page_size: int = 10) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        seen = set()
        token: Optional[str] = None
        for _ in range(self.max_pages):
            q = {"page_size": str(page_size)}
            if token:
                q["page_token"] = token
            page = self.request("GET", "/v1/inventory?" + urllib.parse.urlencode(q))
            if not isinstance(page, dict) or not isinstance(page.get("items"), list):
                raise ApiError("GET /v1/inventory: response has no 'items' list")
            items.extend(page["items"])
            nxt = page.get("next_page_token")
            if not nxt:
                return items
            if nxt in seen:
                raise PaginationLoop(f"GET /v1/inventory: page token repeated after {len(seen) + 1} pages; stopping")
            seen.add(nxt)
            token = nxt
            self.log(f"page {len(seen)}: {len(page['items'])} items")
        raise PaginationLoop(f"GET /v1/inventory: more than {self.max_pages} pages; stopping")

    def refresh(self, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        return self.request("POST", "/v1/inventory/refresh", body={"scope": "all"}, idempotency_key=idempotency_key)


def read_token(path: Optional[str]) -> str:
    if path:
        with open(path, "r", encoding="utf-8") as fh:
            tok = fh.read().strip()
    else:
        tok = os.environ.get("LOOPED_L08_TOKEN", "").strip()
    if not tok:
        raise ValueError("no API token (use --token-file or LOOPED_L08_TOKEN)")
    return tok


def main(argv: Optional[List[str]] = None, stdout=None, stderr=None) -> int:
    out = stdout or sys.stdout
    err = stderr or sys.stderr
    p = argparse.ArgumentParser(prog="invclient", description="List or refresh the lab inventory safely.")
    p.add_argument("--base-url", default="http://127.0.0.1:8098")
    p.add_argument("--token-file", help="file holding the bearer token (or set LOOPED_L08_TOKEN)")
    p.add_argument("--timeout", type=float, default=2.0)
    p.add_argument("--max-retries", type=int, default=3)
    p.add_argument("--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)
    pl = sub.add_parser("list")
    pl.add_argument("--page-size", type=int, default=10)
    pl.add_argument("--out", help="write the items as JSON here (default: stdout)")
    pr = sub.add_parser("refresh")
    g = pr.add_mutually_exclusive_group()
    g.add_argument("--idempotency-key")
    g.add_argument("--auto-key", action="store_true", help="generate one key and reuse it on every attempt")
    try:
        args = p.parse_args(argv)
    except SystemExit as e:
        return EXIT_USAGE if e.code else EXIT_OK
    try:
        token = read_token(args.token_file)
        client = InventoryClient(args.base_url, token, timeout=args.timeout, max_retries=args.max_retries,
                                 log=lambda m: err.write("invclient: " + m + "\n"))
    except (OSError, ValueError) as e:
        err.write(f"invclient: error: {e}\n")
        return EXIT_USAGE
    try:
        if args.cmd == "list":
            items = client.list_inventory(page_size=args.page_size)
            doc = json.dumps({"count": len(items), "items": items}, indent=2, sort_keys=True) + "\n"
            if args.out:
                with open(args.out, "w", encoding="utf-8") as fh:
                    fh.write(doc)
                out.write(f"{len(items)} items written to {args.out}\n")
            else:
                out.write(doc)
        else:
            key = args.idempotency_key or (f"invclient-{uuid.uuid4()}" if args.auto_key else None)
            res = client.refresh(idempotency_key=key)
            out.write(json.dumps(res, sort_keys=True) + "\n")
    except ApiError as e:
        err.write(f"invclient: error: {e}\n")
        return EXIT_API
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
