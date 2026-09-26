# 02 · Retry with backoff, jitter and a deadline

**Time:** about 40 minutes. **You edit:** `retry.py`.

## The task

Automation talks to things that fail for a moment: an API returns 503 during
a deploy, a TCP connection is reset, a rate limiter says 429. You want to
retry those. You do **not** want to retry a 404 or a bug. You do not want
the automation to hammer a struggling service, and you do not want it to
hang forever.

Write `retry()`:

```python
retry(fn, *, attempts, base_delay, max_delay, deadline=None,
      is_retryable=default_is_retryable,
      sleep=time.sleep, rand=random.random, clock=time.monotonic,
      on_retry=None)
```

It calls `fn()` (no arguments) and returns its result, or raises.

You also write `default_is_retryable(exc)`. `RetryableError` and
`PermanentError` are already provided in the starter.

## Expected behaviour

**Attempts and sleeping**

- `attempts` is the **total** number of calls, including the first. If
  `attempts=3` and every call fails, `fn` is called 3 times and `sleep` 2
  times. **Never sleep after the final attempt**: that only delays the
  failure.
- Delay before retry *n* (n = 0 for the first retry) uses **full jitter**:
  `rand() * min(max_delay, base_delay * 2 ** n)`
- If the exception has a numeric `retry_after` attribute (a Retry-After-style
  hint in seconds, `>= 0`), sleep `min(retry_after, max_delay)` instead.
  Ignore bools, NaN, negative numbers and strings, and use normal backoff.
- Use the injected `sleep`, `rand` and `clock`, never `time.sleep` directly.
  That is how the tests run instantly.

**Which errors to retry: `default_is_retryable`**

| Exception | Retry? |
|---|---|
| `PermanentError` | no |
| `RetryableError` | yes |
| anything with an int `.status` in {429, 500, 502, 503, 504} | yes |
| anything with any other int `.status` (400, 401, 403, 404, 409, 422, 501, ...) | no |
| `ConnectionError` and subclasses, `TimeoutError` | yes |
| anything else (`ValueError`, `KeyError`, ...) | no, because it is probably a bug |

Non-retryable errors are raised at once, after one call, with no sleep.
Catch `Exception`, not everything: `KeyboardInterrupt` must never be retried,
even when a custom classifier says yes.

**Deadline**

`deadline` is a total budget in seconds, measured with `clock()` from when
`retry()` starts. Before each sleep, if `delay >= deadline - elapsed`, give up
at once and raise the last error. The next attempt could not start in time,
so sleeping would only waste the time.

**What gets raised**

The **original exception object** from the last attempt, not a wrapper
and not a copy. Callers who wrote `except TimeoutError:` must still catch it.

**Observability**

`on_retry(attempt, delay, exc)` is called just before each sleep. `attempt`
is the 1-based number of the attempt that failed, and `delay` is exactly
what will be passed to `sleep`.

**Arguments**

Raise `ValueError` (without calling `fn`) if `attempts < 1`, if either delay is
negative, or if `deadline <= 0`.

## Example

```python
>>> calls = iter([ConnectionResetError("reset"), TimeoutError("slow"), "ok"])
>>> def flaky():
...     v = next(calls)
...     if isinstance(v, Exception): raise v
...     return v
>>> retry(flaky, attempts=5, base_delay=0.5, max_delay=4,
...       on_retry=lambda a, d, e: print(f"attempt {a} failed ({e!r}); sleeping {d:.2f}s"))
attempt 1 failed (ConnectionResetError('reset')); sleeping 0.31s
attempt 2 failed (TimeoutError('slow')); sleeping 0.87s
'ok'
```

Your sleep times will differ. That is the jitter.

## Why jitter matters

Without jitter, every client that failed at the same moment computes the
**same** delay. They all come back at the same moment too: after 1s, 2s,
4s... Picture a service that fell over under load and restarts. It gets hit
by a synchronised wave of retries every few seconds, falls over again, and
the waves continue. That is a **retry storm** (the "thundering herd").
Full jitter picks each sleep uniformly from `[0, ceiling)`, which spreads
the clients out, so the recovering service sees a steady trickle instead of
spikes.

The **cap** (`max_delay`) stops the delay growing without limit (2^20 s is 12
days). The **deadline** bounds the whole operation, so the caller (a
deploy pipeline, a human on a call, a health check with its own timeout) gets
an answer while it is still useful.

## Why retries can make an outage worse

Retries multiply load, and they do it at the worst moment: when a shared
dependency is already short of capacity. If each of 3 layers retries 3
times, one user request can become 3 × 3 × 3 = **27** requests to the bottom
layer. A database that is struggling at 100% gets 2–3 times the traffic just
as it tries to recover. The retries turn a blip into an outage.

Automated remediation works the same way. A script that "restarts any
pod failing its health check" or "re-runs failed jobs" is a retry loop with
side effects. If the real cause is shared (the database is down, the
registry is rate-limiting), the automation restarts everything at once,
adds cold-start load, and hides the signal a human needed. So remediation
needs the same safeguards as `retry()`: classify first (is this fixable by
trying again?), back off with jitter, cap the total, and stop and escalate
when the budget runs out. Production systems add **retry budgets** (for
example, retries may be at most 10% of traffic) and **circuit breakers**
(stop calling a dependency that is clearly down) for the same reason.

## Running the tests

Run these from this directory (`labs/python/02-retry`):

```sh
PYTHONPATH=. python3 -m unittest discover -s tests -t .          # your code
PYTHONPATH=solution python3 -m unittest discover -s tests -t .   # reference
```

The tests never really sleep. They pass a `FakeTime` whose `sleep()` records
the delay and moves a fake clock forward, a scripted `rand`, and a scripted
`fn`. Read `tests/test_retry.py`: this pattern (inject the clock) is how
you test any time-dependent automation.

## Broken variants

`broken/*/retry.py`: read each one, predict which test fails, then run
`PYTHONPATH=broken/<variant> python3 -m unittest discover -s tests -t .`

- `retries-permanent-errors`
- `no-cap`
- `no-jitter`
- `ignores-deadline`
- `sleeps-after-final`

## Hints

<details><summary>Hint 1: the skeleton</summary>

```python
start = clock()
for attempt in range(1, attempts + 1):
    try:
        return fn()
    except Exception as exc:
        ...  # decide: raise now, or compute a delay and sleep
```
A `return` inside `try` ends the function on success, so the loop only
continues after a failure.
</details>

<details><summary>Hint 2: re-raising the original</summary>

Inside an `except` block, a bare `raise` re-raises the exception being
handled, with its original traceback. Check the non-retryable case first,
then "was that the last attempt?" Both come **before** you compute or sleep
any delay.
</details>

<details><summary>Hint 3: the delay</summary>

`n = attempt - 1`. `ceiling = min(max_delay, base_delay * 2 ** n)`. Watch
out: with 1,000 attempts, `0.5 * 2 ** 1000` raises `OverflowError`, so clamp
the exponent (e.g. `min(n, 64)`) first. Then `delay = rand() * ceiling`,
unless `getattr(exc, "retry_after", None)` is a sane number.
</details>

<details><summary>Hint 4: the deadline</summary>

`remaining = deadline - (clock() - start)`. Compute it *after* the failed
call, because the call itself used time. If `delay >= remaining`, `raise`.
</details>
