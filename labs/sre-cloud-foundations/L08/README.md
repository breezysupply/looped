# L08 — A health/inventory client that cannot hang, loop, double-post or leak

Module M04 · ~150 min practical (three sessions) · profile `linux-arm64` · runs **inside the course VM**
(any Linux with Python 3.9+ works; no root needed)

## Ticket

> The team needs a small client for the lab inventory API (`GET /v1/inventory`, paginated, and a
> `POST /v1/inventory/refresh`). The last script someone wrote hung for minutes when the API
> stalled, hammered it during rate limiting, ran a refresh twice after a 503, and once printed
> the bearer token into a ticket. Write `invclient.py` so none of that can happen, prove it with
> unit tests that need no network, and prove it again against the local fixture.

## Objectives

- `obj-m04-05` call APIs safely: timeouts, pagination with loop detection, bounded retries with
  backoff for idempotent requests only, no secret logging
- `obj-m04-03` tests with injected clients and clocks that fail on broken variants and pass on
  the solution

## The contract (fixed — the validator relies on it)

The full contract is the docstring of `starter/invclient.py`: `http_transport(...)`,
`InventoryClient(base_url, token, *, timeout, max_retries, backoff_s, max_pages, transport,
sleep, log)` with `request`, `list_inventory`, `refresh`, the exceptions `ApiError` and
`PaginationLoop`, and the CLI (`list [--out FILE]`, `refresh [--idempotency-key K | --auto-key]`;
exit 0 / 2 usage / 3 API failure). `transport` and `sleep` are injected so your tests can play the
server and record waits without a network or a real clock.

## The fixture (`assets/inventory_server.py`, 127.0.0.1:8098, standard library)

- Bearer token required (a lab-only value generated into `work/.secrets/l08-token`, mode 600,
  shaped `lab-l08-…-not-a-real-secret`).
- `faults` mode (default): one page answers **429 with Retry-After**, one **503**, one **200 with
  a truncated JSON body**, one **stalls for 8 s**; the first **refresh performs its side effect and
  then answers 503** — exactly the case where a blind retry does the work twice; an
  `Idempotency-Key` makes a repeat return the first result.
- `loop` mode: one page's `next_page_token` points back to an earlier page.
- `GET /_fixture/stats` shows what the fixture saw (method, page, attempt, status, timing — never
  credentials); `POST /_fixture/scenario {"mode": "faults|loop|clean"}` switches mode and resets
  counters. These two endpoints are fixture controls, not part of the API you are writing for.

`LOOPED_VARIANT=variant-a|variant-b` changes which pages misbehave, the Retry-After values and the
item count.

## Steps and checkpoints

**Checkpoint c1 — transport, timeouts and the first tests (week 11).**

1. `bash labs/sre-cloud-foundations/L08/setup.sh`, then `cd labs/sre-cloud-foundations/L08/work`.
2. Implement `http_transport` with `urllib.request` (finite timeout; map timeouts and connection
   failures to `TimeoutError`/`ConnectionError`; return HTTP error statuses).
3. Implement `request` for GET with bounded retries; test every rule with `FakeTransport`.

**Checkpoint c2 — pagination and the POST policy (week 11).**

4. `list_inventory` with loop detection; `refresh` that retries only with an idempotency key.
5. Write the test for each rule *before* the code that satisfies it, and watch it fail first.

**Checkpoint c3 — the CLI against the fixture (week 11).**

6. `python3 invclient.py --token-file .secrets/l08-token list --out out/inventory.json; echo $?`
   (fixture in faults mode), then loop mode and both `refresh` forms. Read `/_fixture/stats`.
7. Notes in `evidence/L08-notes.md`, then
   `python3 labs/sre-cloud-foundations/L08/validate.py --explanation-file labs/sre-cloud-foundations/L08/evidence/L08-notes.md`

## How validation works

`validate.py` runs your suite on your client (≥8 tests), on the reference client (must pass) and on
seven broken clients described in `broken/mutants.json` (must fail on each). It then runs your
CLI against the fixture and judges by what the fixture recorded: every item exactly once; the wait
after each 429 at least Retry-After; the stalled page abandoned and retried well before 8 s; a
bounded number of requests; exit 3 quickly in loop mode; one side effect per refresh with and
without a key; and the token absent from every output, file and log.

## What you should observe

- Without a timeout, the stalled page holds your client for the full stall — with one, it costs
  `timeout + backoff`.
- A 503 on a POST does not tell you whether the work happened. The fixture's counter shows that it did.

## Pause / resume

Your code lives in `work/` (commit it, but never `.secrets/`). `reset.sh` restarts the fixture with
fresh counters; `teardown.sh` stops it and removes the token and outputs, keeping your code.

## Lab versus production

Real clients add jitter to backoff (so many clients do not retry in lockstep), a total deadline per
operation, circuit breaking, and structured logs; real APIs document which operations accept
idempotency keys and for how long. The fixture is deterministic on purpose so tests are reproducible.

## Limits

This lab does not prove concurrency, connection pooling, OAuth flows, TLS client configuration
(L06 covers verification) or behaviour against a real third-party API. It proves a client whose
timeouts, retries, pagination and POST policy are bounded and tested, and that keeps its credential
out of logs, against a local fixture whose faults are scripted.

## References

- T11 Python standard library (`urllib.request`, `unittest`, `json`, `argparse`)
