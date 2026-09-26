# Walkthrough: `retry.py`

Read this next to `retry.py` in this directory.

## 1. The shape: a loop that returns or raises

```python
start = clock()
for attempt in range(1, attempts + 1):
    try:
        return fn()                       # success ends everything
    except Exception as exc:
        if not is_retryable(exc): raise   # 1. permanent: stop now
        if attempt == attempts:   raise   # 2. last attempt: stop now, no sleep
        delay = hint or backoff           # 3. how long
        if deadline and delay >= remaining: raise   # 4. would we run out of time?
        on_retry(attempt, delay, exc)     # 5. tell someone
        sleep(delay)                      # 6. only now do we wait
```

The order of the checks is the whole exercise. Every mistake in `broken/`
comes from dropping a check or moving it:

| Variant | What it gets wrong | Effect in production |
|---|---|---|
| `retries-permanent-errors` | drops check 1 | a 404 or a typo'd hostname is retried 5 times with sleeps, and the real error reaches the user 30s late |
| `sleeps-after-final` | does check 2 *after* the sleep | every final failure waits the longest backoff for nothing |
| `ignores-deadline` | drops check 4 | the caller's own timeout fires first, so it sees a generic timeout instead of the real error, and work continues after nobody is waiting |
| `no-cap` | no `min(max_delay, ...)` | attempt 20 sleeps 6 days, and `2 ** 1100` raises OverflowError |
| `no-jitter` | `delay = ceiling` | every client retries in lockstep (see §4) |

## 2. Classification: `default_is_retryable`

The question is "could the same request succeed if I send it again later?"

- **Explicit markers first.** `PermanentError` and `RetryableError` let the
  code that raised the error, which knows the most, decide.
- **HTTP status.** 429 and 5xx gateway/availability errors are about the
  server's *current state*. Other 4xx codes are about *your request*: it
  will fail the same way every time. 501 Not Implemented is a 5xx, but it
  is permanent. Duck typing (`getattr(exc, "status", None)`) means this works
  with any HTTP client's exception type, without importing it.
- **Network errors.** `ConnectionError` covers refused, reset, aborted and
  broken pipe. `TimeoutError` covers slow responses (on Python 3.10+,
  `socket.timeout` is an alias of it).
- **Everything else is permanent.** An unexpected `KeyError` is a bug.
  Retrying a bug wastes time and makes the logs misleading.

One caveat to raise in an interview: **retries are only safe for
idempotent operations.** A POST that timed out may have succeeded. Retrying
"create VM" can give you two VMs. Real APIs use idempotency keys or
client tokens for this reason.

## 3. Backoff: capped exponential with full jitter

```python
ceiling = min(max_delay, base_delay * 2 ** min(n, 64))
delay   = rand() * ceiling
```

- **Exponential**, so a longer outage gets fewer retries per minute: the
  load from clients falls as the outage goes on.
- **Capped**, so no single sleep is absurd. The exponent is also clamped,
  because `float * 2**1100` overflows even though the cap would win.
- **Full jitter**, so the delay is uniform in `[0, ceiling)`. AWS's
  "Exponential Backoff and Jitter" analysis showed that full jitter finishes
  the total work with the fewest calls, compared with "equal jitter" (half
  fixed, half random) or no jitter. The occasional very short sleep is fine:
  across many clients the load evens out, which is the point.

`backoff_delay` is its own function so it can be read and tested alone.

## 4. Why jitter: synchronised clients

With 1,000 clients all failing at 12:00:00.000:

- **No jitter:** all 1,000 retry at 12:00:01, then at 12:00:03, then at
  12:00:07. Each wave is as big as the original spike, and it lands just as
  the service is trying to recover.
- **Full jitter:** the retries spread across [0, 1s), then [0, 2s), and so on.
  The service sees about 1,000 requests per second or less, falling over time.

The broken `no-jitter` variant passes every test except the one that
checks `rand()` is actually used. That is realistic: the bug is invisible
with one client and only shows up across a fleet.

## 5. Retry-After hints

A server that says "retry after 7 seconds" knows its own state better than
our formula does, so the hint wins. It is still **untrusted input**:

- capped at `max_delay`, so `Retry-After: 86400` cannot stall the automation
  for a day;
- ignored if it is negative, NaN, a bool or not a number;
- still subject to the deadline. If the server says 30s and we have 20s
  left, we fail now.

## 6. The deadline

`attempts` limits how many times we try. `deadline` limits **how long**
it takes. You usually want both. A caller with a 30s timeout does not care
that you only made 3 attempts if each one took 15s.

- `clock` is `time.monotonic`, **not** `time.time`. Wall-clock time can jump
  (NTP corrections, someone setting the date), and monotonic time cannot.
  Always measure durations with a monotonic clock.
- `remaining` is computed after the failed call, because the call itself
  used time.
- `delay >= remaining` means give up **without sleeping**. An alternative
  design sleeps `min(delay, remaining)` and makes one last attempt. That can
  work, but the last attempt then starts right at the deadline, when the
  caller has probably gone. Giving up early returns the real error while
  someone still wants it.

## 7. Re-raise vs wrap

The solution uses a bare `raise`, so the caller gets **the same exception
object**, with its original type and traceback. Code written as
`except TimeoutError:` around the call still works whether or not retry is
in the middle.

The alternative is `raise RetryError(attempts=3) from last_exc`. That adds
context, and `from` keeps the original as `__cause__`. But every caller then
has to unwrap it, and a library that suddenly starts raising a new
exception type breaks its callers. The attempt count is still available
without wrapping, through `on_retry`. (On Python 3.11+ you could also call
`exc.add_note("after 3 attempts")`, but this exercise targets 3.9.)

`except Exception` (not a bare `except:`) matters too. `KeyboardInterrupt`
and `SystemExit` derive from `BaseException`, so Ctrl-C always gets out,
even when a custom classifier says "retry everything".

## 8. Dependency injection for time

`sleep`, `rand` and `clock` are parameters whose defaults are the real
functions. Production code never passes them. Tests pass a `FakeTime` that
records each sleep and moves the clock forward, so a test of "1,200 attempts
with backoff" runs in milliseconds and gives the same result every run.
Being able to explain this in an interview ("I'd inject the clock so the
backoff is testable") is worth as much as the retry logic.

## 9. Observability: `on_retry`

Retries hide failures: from outside, a call that succeeded on attempt 4
looks the same as one that succeeded on attempt 1. `on_retry(attempt, delay,
exc)` is the hook where you log or increment a `retries_total` metric. A
rising retry rate is often the first sign that a dependency is degrading,
before anything actually fails.
