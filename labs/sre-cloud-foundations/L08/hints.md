# L08 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Separate one HTTP exchange (transport: may time out, may return any status) from
   the policy around it (retry or not, how long to wait, when to stop paging). Tests drive the
   policy through a fake transport and a fake sleep — no network, no waiting.
2. **Evidence source.** The fixture's `/_fixture/stats` shows what your client really did: which
   page, which attempt, which status, at what time. Compare it with what your policy says should
   have happened.
3. **Discriminating check.** Look at the gap after the 429 event (≥ Retry-After?), the gap after
   the stalled request (≈ your timeout, not 8 s?), the number of POSTs and refreshes, and whether
   loop mode ever ends. For tests, `broken/mutants.json` names each bug your suite must catch.
4. **Root cause and fix.** Retry only GET (or POST with an Idempotency-Key, same key each time) on
   timeout, connection error, 429, 502–504 or invalid JSON; wait Retry-After else
   `backoff_s * 2**attempt`; at most `1 + max_retries` attempts; a `set` of seen page tokens; the
   token only in the Authorization header. The reference is `solution/invclient.py`.
