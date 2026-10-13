# L30 — An API support case: reproduce it minimally, classify it, explain it

Module M15 · ~90 min practical · profile `workstation` (Python 3.9+, no root, no Docker) ·
**local fixture only: no real API, no real customer, no paid call**

## Ticket

> A fictional customer, Halyard Freight, reports that their nightly integration with our
> summaries API is failing. Their ticket, their log excerpt and the reproduction script their
> engineer attached are in `work/TICKET.md`. Find out whether the failure is on the caller's
> side, in authentication or entitlement, or in the service; write a minimal, sanitised Python
> reproduction you could attach to an escalation; and write the reply the customer will read.

## Objectives

- `obj-m15-03` isolate caller, auth and service failures with a minimal reproduction that
  prints a sanitised request id and a category, applies a bounded retry policy and leads to a
  clear customer update

## What is fixture-controlled

`assets/support_api.py` is a small standard-library HTTP server on `127.0.0.1:8130` that plays
the provider's API (`POST /v1/summaries`, streaming by server-sent events). Its behaviour is set
by a **mode** the lab chooses; nothing about your machine, network or Python is faulty. The modes
are documented in the fixture's docstring: normal answers, a rotated key, a missing
entitlement, rate limiting with `Retry-After` and quota headers, a stall before the first byte,
and a stream that stops without its terminal event. The ticket you get is chosen by
`LOOPED_VARIANT=variant-a … variant-e`; which mode is behind it is for you to find.

The fixture writes every request id it issues to `work/.run/issued.jsonl`, and
`GET /_fixture/stats` shows what it received since the last mode switch (status, auth result,
idempotency-key fingerprint, timing — never the key or the document text). Treat that as the
provider-side log a support engineer would have. `POST /_fixture/scenario` is a fixture control
that the validator uses; you do not need it.

The customer's key is in `work/.secrets/customer-key` (a lab placeholder shaped
`lab-l30-…-not-a-real-secret`, mode 600). A second key, `new-key`, is the organisation's current
key in the rotated-key mode. Never paste either into a file you share.

## Steps and checkpoint

**Checkpoint c1 — reproduce, isolate, explain (week 45, session 1).**

1. `bash labs/sre-cloud-foundations/L30/setup.sh`, then read `work/TICKET.md` and
   `work/repro.py` (the customer's script). Write down what their script would print and why
   that output must not go into a ticket.
2. Reproduce with curl first (`curl -sS --noproxy '*' -D - -X POST 127.0.0.1:8130/v1/summaries
   -H "Authorization: Bearer $(cat work/.secrets/customer-key)" -H 'Content-Type: application/json'
   --data @work/customer-request.json`). Read the status, `X-Request-Id`, any `Retry-After` or
   quota headers, and the stream events. Compare `GET /v1/health`.
3. In `evidence/L30-notes.md`: the reproduction, then **isolation** — which of caller, auth or
   entitlement, or service it is, with the evidence that rules out the other two.
4. Rewrite `work/repro.py` to the contract in its docstring: one JSON result line
   (`category`, `http_status`, `request_id`, `attempts`, `next_action`), exit 0/3/2, and the
   retry policy below. Run it in your ticket's mode and keep the request id it prints.
5. Write `work/customer-reply.md` from the template: Summary, What we saw (quote a request id
   from step 4), What it means, Next steps, Retry guidance.
6. `python3 labs/sre-cloud-foundations/L30/validate.py --explanation-file labs/sre-cloud-foundations/L30/evidence/L30-notes.md`
   and import `evidence/latest.json`.

## Retry policy (what the validator measures on the wire)

- At most **3 attempts** per run; finite connect/read timeout of at most 5 s.
- **Never retry 400, 401 or 403**: the caller must change something first.
- **429**: wait `Retry-After` seconds (when it is 10 s or less), then retry.
- Timeouts, 5xx, connection errors and **streams that end without their terminal event**:
  retry after a short backoff.
- **One Idempotency-Key per run, sent on every attempt**: the call creates a summary, so a
  retry must never create a second one.

## How validation works

`validate.py` switches the fixture through all six modes and runs your `repro.py` in each. It
judges by what the fixture recorded: the category you print for each mode, that your request id
was really issued in that run, that your attempt count matches the fixture's, that 401/403 got
exactly one request, that 429 retries waited at least `Retry-After`, that the stalled mode ends
in under 20 s with each stalled attempt abandoned well before the 8 s stall, and that every
retried run reused one Idempotency-Key. It then searches every output, `repro.py`, the reply and
your notes for the key, an Authorization header and the customer's document text. Finally it
checks the reply's five sections, a request id issued in **your ticket's** mode, and that the
reply states the decisive evidence for it. It leaves the fixture in your ticket's mode.

A good reply is still judged by people. Rubric (self or mentor): it says whose side the fix is
on without blame; every claim is backed by something in "What we saw"; the next action is one the
customer can take today; it says when they will hear from you; it does not promise what support
cannot deliver.

## What you should observe

- The customer's script turns several different failures into the same "server error", retries
  things that can never succeed, and prints the very secret it is failing with.
- A 200 status on a stream is not success; the terminal event is.
- Without a read timeout, a stalled call costs the full stall on every attempt.

## Reset, teardown, pause and resume

- `bash labs/sre-cloud-foundations/L30/reset.sh` restores the fixture's token, quota and stream
  state: both lab keys are re-issued, counters cleared, the request body restored, same variant
  (or `LOOPED_VARIANT=…`). Your `repro.py`, reply and the issued-id log stay.
- `bash labs/sre-cloud-foundations/L30/teardown.sh` stops the fixture and removes the keys, run
  files and ticket; your code and reply stay. Re-run `setup.sh` to resume.

## Lab versus production

- A real provider's support console shows key status, organisation entitlements and quota usage
  directly; here `/_fixture/stats` and the response headers stand in for it. The discipline is
  the same: evidence first, then the category, then the reply.
- Real rate limits are usually several (requests, tokens, concurrency) with different reset
  windows; the fixture has one.
- Real streaming failures include proxies buffering events and idle timeouts on load balancers;
  the fixture only closes the connection early.

## Limits — what this lab does not prove

It proves you can classify six fixture behaviours from wire evidence, implement a bounded,
idempotent retry policy that the fixture can measure, keep secrets and customer content out of
your output, and write a reply backed by evidence. It does **not** prove experience with any real
provider's API, its error codes, quotas or support tooling, and the fixture's modes are scripted:
a real incident can mix them or present them intermittently.

## References

- T11 Python standard library (urllib, json) · T01 Google SRE Workbook (handling overload,
  retries) · lessons `les-m15-04`, `les-m04-05`
