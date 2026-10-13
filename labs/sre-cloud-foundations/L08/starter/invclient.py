"""invclient — a careful client for the lab inventory API.  (L08 starter: contract fixed, bodies yours.)

CONTRACT — the validator's unit-test and integration runs rely on exactly this:

  http_transport(method, url, headers, body, timeout) -> (status, headers_lowercase, body_bytes)
      One HTTP exchange. Returns HTTP error statuses (it does not raise for them). Raises
      TimeoutError on a timeout and ConnectionError when no answer arrived.

  class ApiError(Exception)              the call failed for good (message never contains the token)
  class PaginationLoop(ApiError)         a page token repeated (or too many pages)

  InventoryClient(base_url, token, *, timeout=2.0, max_retries=3, backoff_s=0.5, max_pages=1000,
                  transport=None, sleep=time.sleep, log=None)
      .request(method, path, *, body=None, idempotency_key=None) -> parsed JSON (dict)
      .list_inventory(page_size=10) -> list of items, following next_page_token until it is empty/None
      .refresh(idempotency_key=None) -> dict          POST /v1/inventory/refresh with body {"scope": "all"}
      `transport` and `sleep` are injected so tests need no network and no waiting;
      `log` is a callable taking one string (your progress/retry messages).

  Policy you must implement (and test):
    - every call passes a finite `timeout` to the transport
    - GET: retry timeouts, connection errors, 429, 502, 503, 504 and a 2xx whose body is not JSON;
      at most `max_retries` retries; wait Retry-After seconds when the header is present
      (cap 30 s), otherwise backoff_s * 2**attempt; never retry other 4xx
    - POST: retry only when an idempotency_key was given, sending the same Idempotency-Key header
      every time; without a key the first failure raises ApiError saying the outcome is unknown
    - pagination: a repeated next_page_token raises PaginationLoop
    - the token is sent as "Authorization: Bearer <token>" and appears in no log line,
      exception message or repr

  CLI: python3 invclient.py [--base-url URL] [--token-file F] [--timeout S] [--max-retries N]
                            list [--page-size N] [--out FILE] | refresh [--idempotency-key K | --auto-key]
       token from --token-file or the LOOPED_L08_TOKEN environment variable
       exit 0 success · 2 usage/configuration (e.g. no token) · 3 API failure after the allowed attempts
       `list --out FILE` writes {"count": N, "items": [...]} as JSON; messages go to stderr.
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
from typing import Any, Callable, Dict, List, Optional, Tuple

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_API = 3


class ApiError(Exception):
    """The call failed for good."""


class PaginationLoop(ApiError):
    """A page token repeated."""


def http_transport(method: str, url: str, headers: Dict[str, str], body: Optional[bytes], timeout: float) -> Tuple[int, Dict[str, str], bytes]:
    raise NotImplementedError("L08: implement http_transport with urllib.request")


class InventoryClient:
    def __init__(self, base_url: str, token: str, *, timeout: float = 2.0, max_retries: int = 3, backoff_s: float = 0.5,
                 max_pages: int = 1000, transport=None, sleep: Callable[[float], None] = time.sleep,
                 log: Optional[Callable[[str], None]] = None) -> None:
        self.base_url = base_url.rstrip("/")
        self._token = token
        self.timeout = timeout
        self.max_retries = max_retries
        self.backoff_s = backoff_s
        self.max_pages = max_pages
        self.transport = transport or http_transport
        self.sleep = sleep
        self.log = log or (lambda msg: None)

    def request(self, method: str, path: str, *, body: Optional[Dict[str, Any]] = None, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        raise NotImplementedError("L08: implement request (timeouts, bounded retries, POST policy)")

    def list_inventory(self, page_size: int = 10) -> List[Dict[str, Any]]:
        raise NotImplementedError("L08: implement list_inventory (pagination with loop detection)")

    def refresh(self, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        return self.request("POST", "/v1/inventory/refresh", body={"scope": "all"}, idempotency_key=idempotency_key)


def main(argv: Optional[List[str]] = None, stdout=None, stderr=None) -> int:
    raise NotImplementedError("L08: implement the CLI described in the module docstring")


if __name__ == "__main__":
    sys.exit(main())
