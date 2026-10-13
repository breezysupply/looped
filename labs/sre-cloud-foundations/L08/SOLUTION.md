# L08 worked solution

The reference client is `solution/invclient.py`; the reference tests are
`solution/test_invclient.py` (13 tests; all seven broken clients caught). Read after your attempt.

**Transport.** `urllib.request` through an opener with `ProxyHandler({})` (the fixture is local),
`timeout=self.timeout` on every call. `HTTPError` is returned as `(status, headers, body)` — a 503 is
data for the retry policy, not an exception. `URLError` wrapping a timeout becomes `TimeoutError`,
anything else that prevented an answer becomes `ConnectionError`.

**One retry loop, one policy.** `retry_allowed = method in ("GET", "HEAD") or idempotency_key is not None`.
For each attempt: a 2xx with valid JSON returns; a 2xx with invalid JSON, a timeout, a connection
error, 429 or 502/503/504 are transient — wait and try again; any other status raises `ApiError`
at once. The wait is `Retry-After` when the server sent it (capped at 30 s) and
`backoff_s * 2**attempt` otherwise. At most `1 + max_retries` attempts. The final `ApiError` names
method, path and reason — never headers.

**POST.** Without a key, the first failure raises `ApiError("… not retried (no Idempotency-Key), so the
outcome is unknown")` and the CLI exits 3: the fixture's counter shows the refresh *did* happen,
which is exactly why a blind retry is wrong. `refresh --auto-key` generates one UUID key and reuses it
on every attempt, so the server can return the first result instead of doing the work twice.

**Pagination.** Keep a `set` of followed tokens; a repeat raises `PaginationLoop`; also stop after
`max_pages`. The CLI exits 3 and writes no partial inventory as if it were complete.

**Secrets.** The token comes from a 0600 file or `LOOPED_L08_TOKEN`, is stored in a private attribute,
sent only in `Authorization`, absent from `__repr__`, logs and exceptions. Tests assert that.

**Tests that matter** (each kills one broken client): the recorded sleep after a 429 equals
Retry-After; 503 waits 0.5 then 1.0; every transport call received the configured timeout; a
truncated body is retried; three 503s with `max_retries=2` give exactly three calls; a 404 is called
once; a repeated token raises after three calls; a POST without a key is called once and its error
says "unknown", with a key twice with the same header; the token is in the request but not in logs,
the exception or `repr`.

Integration: `faults` mode completes in about 6 s with 10–11 GETs; `loop` mode exits 3 after 3–4 GETs.
