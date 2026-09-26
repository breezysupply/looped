"""Retry a flaky call with capped exponential backoff and full jitter.

Reference solution for labs/python/02-retry. Read EXPLANATION.md next to
this file for the walkthrough.

    result = retry(lambda: client.get("/healthz"),
                   attempts=5, base_delay=0.2, max_delay=5.0, deadline=20.0)

Everything that touches the outside world (sleeping, randomness, the clock)
is a parameter with a sensible default. Production code uses the defaults;
tests pass fakes, so they run instantly and give the same answer every time.
"""
from __future__ import annotations

import math
import random
import time
from typing import Any, Callable, Optional

# HTTP statuses that mean "not now" rather than "never":
#   429 Too Many Requests, 500 Internal Server Error, 502 Bad Gateway,
#   503 Service Unavailable, 504 Gateway Timeout.
# Every other 4xx means the request itself is wrong (400 bad input, 401/403
# auth, 404 not found, 409 conflict, 422 validation...). Sending the same
# request again will fail the same way, so retrying only adds load.
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class RetryableError(Exception):
    """Raise from `fn` to say "this failed, but trying again may work".

    `retry_after` is an optional server hint in seconds (the HTTP
    Retry-After header, or a cloud API's "try again in N seconds").
    """

    def __init__(self, message: str = "", *, retry_after: Optional[float] = None):
        super().__init__(message)
        self.retry_after = retry_after


class PermanentError(Exception):
    """Raise from `fn` to say "do not retry this, it will never work"."""


def default_is_retryable(exc: BaseException) -> bool:
    """Decide whether an exception is worth retrying.

    Checks run from most explicit to least:
      1. Our own markers: PermanentError never retries, RetryableError always does.
      2. Anything with an integer `.status` (HTTP-client errors usually have
         one): retry only the statuses in RETRYABLE_STATUS.
      3. Network-level trouble: ConnectionError (refused, reset, broken pipe)
         and TimeoutError.
      4. Everything else is permanent. A KeyError or ValueError is almost
         always a bug in our code, and retrying a bug only repeats it more
         slowly.
    """
    if isinstance(exc, PermanentError):
        return False
    if isinstance(exc, RetryableError):
        return True
    status = getattr(exc, "status", None)
    # bool is a subclass of int; `status=True` is nonsense, so don't treat it as 1.
    if isinstance(status, int) and not isinstance(status, bool):
        return status in RETRYABLE_STATUS
    return isinstance(exc, (ConnectionError, TimeoutError))


def _hint(exc: BaseException) -> Optional[float]:
    """Return a usable retry_after hint from the exception, or None.

    Hints come from the far end, so treat them as untrusted input: a
    negative, NaN or non-numeric value is ignored rather than trusted.
    """
    value = getattr(exc, "retry_after", None)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if math.isnan(value) or value < 0:
        return None
    return float(value)


def backoff_delay(retry_number: int, base_delay: float, max_delay: float, rand: Callable[[], float]) -> float:
    """Full-jitter delay before retry number `retry_number` (0 for the first retry).

        ceiling = min(max_delay, base_delay * 2 ** retry_number)
        delay   = rand() * ceiling           # uniformly in [0, ceiling)

    The exponent is clamped before it is used. 2 ** 1100 is a valid Python
    int, but multiplying it by a float raises OverflowError, and the cap
    would have kicked in long before that anyway.
    """
    exponent = min(retry_number, 64)
    ceiling = min(max_delay, base_delay * (2 ** exponent))
    return rand() * ceiling


def retry(
    fn: Callable[[], Any],
    *,
    attempts: int,
    base_delay: float,
    max_delay: float,
    deadline: Optional[float] = None,
    is_retryable: Callable[[BaseException], bool] = default_is_retryable,
    sleep: Callable[[float], None] = time.sleep,
    rand: Callable[[], float] = random.random,
    clock: Callable[[], float] = time.monotonic,
    on_retry: Optional[Callable[[int, float, BaseException], None]] = None,
) -> Any:
    """Call `fn()` until it succeeds, a permanent error happens, or we run out.

    Args (all keyword-only, so a call site reads as documentation):
        attempts:     total number of calls to fn, including the first (>= 1).
        base_delay:   ceiling for the first backoff, in seconds.
        max_delay:    no single sleep is ever longer than this.
        deadline:     optional budget in seconds for the whole operation,
                      measured with `clock` from when retry() is called. We
                      give up early rather than sleep up to or past it.
        is_retryable: classifier, exc -> bool.
        sleep, rand, clock: injectable for tests.
        on_retry:     called as on_retry(attempt, delay, exc) just before each
                      sleep. `attempt` is the 1-based number of the attempt
                      that just failed. Use it to log or count retries.

    Returns whatever fn returns.
    Raises the ORIGINAL exception from the last attempt, unchanged, when
    retries are exhausted, the deadline would be exceeded, or the error is
    not retryable.
    """
    # Validate arguments up front. A typo like attempts=0 should fail loudly
    # at the call site, not silently never call fn.
    if attempts < 1:
        raise ValueError("attempts must be >= 1")
    if base_delay < 0 or max_delay < 0:
        raise ValueError("base_delay and max_delay must be >= 0")
    if deadline is not None and deadline <= 0:
        raise ValueError("deadline must be > 0 seconds")

    start = clock()
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        # `except Exception`, never a bare `except:`. KeyboardInterrupt and
        # SystemExit derive from BaseException, not Exception, so Ctrl-C
        # still stops the program instead of being "retried".
        except Exception as exc:
            if not is_retryable(exc):
                # A bare `raise` re-raises the exception being handled, with
                # its original type and traceback.
                raise

            if attempt == attempts:
                # Out of attempts. Do NOT sleep first: a sleep after the final
                # attempt delays the failure and buys nothing.
                raise

            # How long to wait. A server hint wins over our own backoff (the
            # server knows its own state best), but it is still capped by
            # max_delay so a buggy or hostile "Retry-After: 86400" cannot park
            # us for a day.
            hint = _hint(exc)
            if hint is not None:
                delay = min(hint, max_delay)
            else:
                delay = backoff_delay(attempt - 1, base_delay, max_delay, rand)

            if deadline is not None:
                remaining = deadline - (clock() - start)
                # If sleeping would take us to or past the deadline, the next
                # attempt could not start in time anyway. Fail now with the
                # real error instead of sleeping and then failing.
                if delay >= remaining:
                    raise

            if on_retry is not None:
                on_retry(attempt, delay, exc)
            sleep(delay)

    # Unreachable: every loop iteration either returns or raises. It is here
    # so a future edit that breaks that fails loudly instead of returning None.
    raise AssertionError("unreachable")
