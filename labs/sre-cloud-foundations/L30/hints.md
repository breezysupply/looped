# L30 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Before touching code, decide which of three places the failure lives in: the
   caller (request shape, client behaviour), authentication/entitlement (who is calling and what
   they may use), or the service (it accepted the call and then failed). One curl with `-D -`
   and one `GET /v1/health` usually rule out two of the three.
2. **Evidence source.** Read the status line, `X-Request-Id`, `WWW-Authenticate`,
   `Retry-After` and the `X-RateLimit-*` headers, and for a stream every `event:` line until the
   connection closes. `curl -s --noproxy '*' 127.0.0.1:8130/_fixture/stats` is the provider-side
   view: what arrived, how it authenticated, when.
3. **Discriminating check.** Change one thing at a time: the same request with the other lab key
   (`work/.secrets/new-key`), the same request with `"stream": false`, a curl with
   `--max-time 5`, two requests 2 s apart. Each change moves exactly one of the possible causes.
4. **Root cause and fix.** Map 401 → auth_invalid, 403 → not_entitled, 429 → rate_limited,
   no first byte within your timeout → timeout, a stream without `event: done` → stream_interrupted.
   Retry only 429 (after Retry-After), timeouts, 5xx and interrupted streams, at most 3 attempts,
   one `uuid4` Idempotency-Key per run; never print headers or the body. Reference:
   `solution/repro.py`. The reply quotes your request id and names the next action for that cause.
