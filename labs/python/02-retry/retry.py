"""Retry a flaky call with capped exponential backoff and full jitter.

STARTER FILE: replace every `raise NotImplementedError` with your code.
Read README.md first; it defines the exact behaviour the tests check.

    result = retry(lambda: client.get("/healthz"),
                   attempts=5, base_delay=0.2, max_delay=5.0, deadline=20.0)
"""
from __future__ import annotations

import random
import time
from typing import Any, Callable, Optional

# Statuses that mean "not now" rather than "never".
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class RetryableError(Exception):
    """Raise from `fn` to say "this failed, but trying again may work".

    `retry_after` is an optional server hint in seconds.
    (Provided for you: nothing to implement here.)
    """

    def __init__(self, message: str = "", *, retry_after: Optional[float] = None):
        super().__init__(message)
        self.retry_after = retry_after


class PermanentError(Exception):
    """Raise from `fn` to say "do not retry this, it will never work".
    (Provided for you.)"""


def default_is_retryable(exc: BaseException) -> bool:
    """Return True if `exc` is worth retrying.

    - PermanentError                    -> False
    - RetryableError                    -> True
    - has an int `.status`              -> True only if in RETRYABLE_STATUS
    - ConnectionError / TimeoutError    -> True (includes subclasses such as
                                           ConnectionResetError)
    - anything else                     -> False (probably a bug: do not retry)
    """
    raise NotImplementedError("default_is_retryable")


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

    - attempts:   total calls to fn, including the first. Must be >= 1.
    - Delay before retry n (n = 0 for the first retry), FULL jitter:
          rand() * min(max_delay, base_delay * 2 ** n)
    - If the exception has a numeric `retry_after` >= 0, sleep
      min(retry_after, max_delay) instead. Ignore bools, NaN, negatives and
      non-numbers.
    - deadline: optional total budget in seconds, measured with clock() from
      the start of retry(). If the next sleep would reach or pass it, stop
      and raise the last error without sleeping.
    - Never sleep after the final attempt.
    - Raise the ORIGINAL last exception object (not a wrapper).
    - Only catch Exception (never KeyboardInterrupt/SystemExit).
    - on_retry(attempt, delay, exc) is called just before each sleep.
      `attempt` is the 1-based number of the attempt that failed.
    - ValueError if attempts < 1, a delay is negative, or deadline <= 0.

    `sleep`, `rand` and `clock` are parameters so tests can pass fakes. Only
    ever call them through these parameters, never time.sleep() directly.
    """
    raise NotImplementedError("retry")
