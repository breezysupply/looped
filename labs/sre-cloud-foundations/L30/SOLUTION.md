# L30 worked solution

## Reading the customer's script first

The attached `repro.py` has four problems, each of which would hurt a real support case:
it prints the request headers (the bearer key) and the document text; it has no timeout, so a
stalled call costs the full stall on every attempt; it retries everything six times 200 ms apart,
including 401/403 that can never succeed and 429s that it makes worse by ignoring `Retry-After`;
and it calls every HTTP error "server_error" and any stream with one delta "ok". The last point is
why the cut-off summaries looked successful in the customer's own log.

## Isolation, per ticket

| Variant | Evidence (curl + stats) | Category | Whose side |
|---|---|---|---|
| a | 401, `WWW-Authenticate: Bearer error="invalid_token"`; the same body with `new-key` streams to `done` | auth_invalid | caller's credentials (rotated key still loaded) |
| b | 429 on every call, `Retry-After: 2`, `X-RateLimit-Remaining-Requests: 0`; spaced calls still 429 inside the window | rate_limited | caller's request rate vs. quota |
| c | 200, `start` + 2 `delta`, connection closes, no `done` | stream_interrupted | service (escalate) — and the client must not treat it as success |
| d | no status line within 5 s (`curl --max-time 5` exits 28); stats show the request arrived | timeout | service latency (escalate) — client needs a timeout |
| e | 403 permission_error only with `"stream": true`; `"stream": false` returns 200 | not_entitled | account entitlement (plan), not the key |

`GET /v1/health` answering 200 in every mode rules out "the API is down"; a 400 never appears,
which rules out the request shape.

## The reproduction

`solution/repro.py` is the reference. The essential parts:

```python
MAX_ATTEMPTS, TIMEOUT_S, BACKOFF_S, MAX_RETRY_AFTER_S = 3, 4.0, 0.5, 10
RETRYABLE = {"rate_limited", "timeout", "stream_interrupted", "server_error", "network_error"}
idem = "repro-" + uuid.uuid4().hex                 # one key per run, sent on every attempt
for n in range(1, MAX_ATTEMPTS + 1):
    cat, status, rid, retry_after = attempt(opener, url, key, body, idem)
    if cat not in RETRYABLE or n == MAX_ATTEMPTS:
        break
    wait = BACKOFF_S * 2 ** (n - 1)
    if cat == "rate_limited":
        if retry_after is None or float(retry_after) > MAX_RETRY_AFTER_S:
            break
        wait = max(wait, float(retry_after))
    time.sleep(wait)
print(json.dumps({"category": cat, "http_status": status, "request_id": rid, "attempts": n, "next_action": NEXT[cat]}))
```

`read_stream` returns success only when it reads `event: done`. Progress goes to stderr and
contains only the attempt number, category, status and request id. The opener bypasses
proxies so a corporate proxy cannot intercept a loopback call.

## The reply (variant a, abbreviated)

Summary: the job's calls are refused because the key it loads is no longer valid; the service
is up; the fix is to load the current key. What we saw: HTTP 401 with request id `req_…` on the
first attempt; the same body with the organisation's current key streamed to completion. What it
means: 401 is authentication, before any work. Next steps: update the secret from the admin
console, re-run one depot, we check after tonight's run. Retry guidance: never retry 401; retry
429 after Retry-After, timeouts and 5xx at most three times with one Idempotency-Key.

For variant c the reply says a 200 is not completion, the job must wait for the `done` event
and retry interrupted streams, and that the request ids have been escalated. For variant b it
quotes the quota headers and recommends lower concurrency or a quota request, not more retries.

## Unsafe shortcuts the validator rejects

- Ignoring `Retry-After` (the 429 gaps are measured), retrying 401/403, or a new key per attempt.
- Printing headers "only in debug mode": the outputs are searched.
- Reporting a made-up or old request id: ids are matched against what the fixture issued in
  that run and, for the reply, in the ticket's mode.
