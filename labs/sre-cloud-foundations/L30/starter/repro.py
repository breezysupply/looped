#!/usr/bin/env python3
"""repro.py — minimal reproduction of the customer's summaries call.  (L30 starter)

This is the script the customer's integration engineer attached to the ticket,
trimmed to one request. It "works on their laptop". Read it before you run it:
it is the evidence of how the customer calls the API, and it is not safe to
paste its output into a ticket as it is.

CONTRACT — the validator runs your version of this file exactly like this:

  python3 repro.py --base-url URL --key-file FILE [--request-file FILE]

  - sends the customer's request once (POST /v1/summaries, body from
    --request-file, default customer-request.json next to this file, which
    asks for stream=true), retrying only as your policy allows
  - the LAST line on stdout is one JSON object:
      {"category": "...", "http_status": 200|401|...|null, "request_id": "req_..."|null,
       "attempts": N, "next_action": "one sentence for the support engineer"}
    category is one of: ok, auth_invalid, not_entitled, rate_limited, timeout,
    stream_interrupted, server_error, bad_request, network_error
  - exit 0 when category is ok, 3 for any other category, 2 for usage errors
  - nothing it prints (stdout or stderr) may contain the API key, an
    Authorization header or the customer's document text

  Retry policy to implement (README "Retry policy"):
    - at most 3 attempts in total; finite connect/read timeout (<= 5 s)
    - never retry 400, 401 or 403 (the caller must change something first)
    - 429: wait Retry-After seconds (if it is <= 10), then retry
    - timeout, 5xx, connection error, stream ended without its terminal event:
      retry after a short backoff
    - every attempt carries the SAME Idempotency-Key (one per run): the call
      creates a summary, so a retry must not create two
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", required=True)
    p.add_argument("--key-file", required=True)
    p.add_argument("--request-file", default=os.path.join(HERE, "customer-request.json"))
    a = p.parse_args()
    key = open(a.key_file).read().strip()
    body = open(a.request_file, "rb").read()
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    print("DEBUG request headers:", headers)          # handy while debugging
    print("DEBUG request body:", body.decode())
    status, rid, attempts = None, None, 0
    for attempt in range(6):                          # keep trying until it works
        attempts += 1
        req = urllib.request.Request(a.base_url + "/v1/summaries", data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req) as r:
                status = r.status
                rid = r.headers.get("X-Request-Id")
                text = r.read().decode()
                if "event: delta" in text:            # we got some output, so it worked
                    print(json.dumps({"category": "ok", "http_status": status, "request_id": rid, "attempts": attempts, "next_action": "none"}))
                    return 0
        except urllib.error.HTTPError as e:
            status = e.code
            rid = e.headers.get("X-Request-Id")
        except Exception as e:  # noqa: BLE001
            print("error:", e)
        time.sleep(0.2)
    print(json.dumps({"category": "server_error", "http_status": status, "request_id": rid, "attempts": attempts, "next_action": "ask the provider"}))
    return 3


if __name__ == "__main__":
    sys.exit(main())
