#!/usr/bin/env python3
"""repro.py — minimal, sanitised reproduction of the customer's summaries call.  (L30 reference)

  python3 repro.py --base-url URL --key-file FILE [--request-file FILE]

One request (POST /v1/summaries, stream=true), bounded retries, one JSON line
on stdout. The key is read from a file and only ever placed in the
Authorization header; the document text is sent but never printed. Progress
lines on stderr carry the attempt, status, request id and wait, nothing else.
Exit 0 for ok, 3 for any failure category, 2 for usage errors.
"""
import argparse
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_ATTEMPTS = 3
TIMEOUT_S = 4.0          # connect and per-read timeout; the API normally starts streaming in < 1 s
BACKOFF_S = 0.5          # 0.5 s, then 1 s
MAX_RETRY_AFTER_S = 10   # a longer wait is a quota decision for the customer, not a retry

NEXT = {
    "ok": "No failure reproduced with this key and request; compare with the customer's own client and timing.",
    "auth_invalid": "The key is rejected (401): ask the customer to confirm which key their integration loads and to switch to the current key; do not retry.",
    "not_entitled": "The key is valid but the organisation lacks this capability (403): check the plan/entitlement or use the non-streaming call; do not retry.",
    "rate_limited": "Requests are rate limited (429): honour Retry-After, lower concurrency, or request a higher quota.",
    "timeout": "No first byte within the client timeout: capture timing, retry with the same Idempotency-Key, and escalate with these request ids.",
    "stream_interrupted": "The stream ended without its terminal event: treat the output as incomplete, retry with the same Idempotency-Key, escalate with the request ids.",
    "server_error": "The service answered 5xx: escalate to the service team with the request ids.",
    "bad_request": "The request body was rejected (400): compare the customer's payload with the API reference.",
    "network_error": "No HTTP answer: check DNS, proxy and network path from the customer's side.",
}
RETRYABLE = {"rate_limited", "timeout", "stream_interrupted", "server_error", "network_error"}


def log(msg):
    sys.stderr.write(msg + "\n")


def classify_http(code):
    if code == 400:
        return "bad_request"
    if code == 401:
        return "auth_invalid"
    if code == 403:
        return "not_entitled"
    if code == 429:
        return "rate_limited"
    if code >= 500:
        return "server_error"
    return "bad_request" if 400 <= code < 500 else "ok"


def read_stream(resp):
    """Return True only if the stream reached its terminal 'done' event."""
    event = None
    for raw in resp:
        line = raw.decode("utf-8", "replace").rstrip("\r\n")
        if line.startswith("event:"):
            event = line[6:].strip()
            if event == "done":
                return True
    return False


def attempt(opener, url, key, body, idem):
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json",
        "Accept": "text/event-stream", "Idempotency-Key": idem})
    try:
        with opener.open(req, timeout=TIMEOUT_S) as r:
            rid = r.headers.get("X-Request-Id")
            ok = read_stream(r) if "event-stream" in (r.headers.get("Content-Type") or "") else bool(json.loads(r.read() or b"{}").get("id"))
            return ("ok" if ok else "stream_interrupted"), r.status, rid, None
    except urllib.error.HTTPError as e:
        return classify_http(e.code), e.code, e.headers.get("X-Request-Id"), e.headers.get("Retry-After")
    except (socket.timeout, TimeoutError):
        return "timeout", None, None, None
    except urllib.error.URLError as e:
        if isinstance(e.reason, (socket.timeout, TimeoutError)):
            return "timeout", None, None, None
        return "network_error", None, None, None
    except (ConnectionError, OSError):
        return "network_error", None, None, None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", required=True)
    p.add_argument("--key-file", required=True)
    p.add_argument("--request-file", default=os.path.join(HERE, "customer-request.json"))
    a = p.parse_args()
    try:
        with open(a.key_file, encoding="utf-8") as fh:
            key = fh.read().strip()
        with open(a.request_file, "rb") as fh:
            body = fh.read()
    except OSError as e:
        log(f"usage: cannot read {e.filename}")
        return 2
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    idem = "repro-" + uuid.uuid4().hex
    url = a.base_url.rstrip("/") + "/v1/summaries"
    cat = status = rid = None
    rids = []
    n = 0
    for n in range(1, MAX_ATTEMPTS + 1):
        cat, status, rid, retry_after = attempt(opener, url, key, body, idem)
        if rid:
            rids.append(rid)
        log(f"attempt {n}: category={cat} status={status} request_id={rid}")
        if cat not in RETRYABLE or n == MAX_ATTEMPTS:
            break
        wait = BACKOFF_S * (2 ** (n - 1))
        if cat == "rate_limited":
            try:
                ra = float(retry_after)
            except (TypeError, ValueError):
                ra = None
            if ra is None or ra > MAX_RETRY_AFTER_S:
                break
            wait = max(wait, ra)
        log(f"waiting {wait:.1f}s before retrying with the same Idempotency-Key")
        time.sleep(wait)
    print(json.dumps({"category": cat, "http_status": status, "request_id": rid or (rids[-1] if rids else None),
                      "request_ids": rids, "attempts": n, "next_action": NEXT[cat]}))
    return 0 if cat == "ok" else 3


if __name__ == "__main__":
    sys.exit(main())
