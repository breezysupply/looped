"""Behavioural tests for retry.

No test really sleeps. Each one passes a fake `sleep` that records the
requested delay and advances a fake clock, a scripted `rand`, and a
scripted `fn`. That makes every test instant and deterministic.

Which implementation is tested is chosen by PYTHONPATH (see ../README.md).
"""
import os
import sys
import unittest

# `python -m unittest` (and pytest) put the current directory ahead of
# PYTHONPATH on sys.path, and the exercise directory holds the starter
# retry.py. Re-insert the PYTHONPATH entries first so PYTHONPATH wins.
for _entry in reversed(os.environ.get("PYTHONPATH", "").split(os.pathsep)):
    if _entry:
        sys.path.insert(0, os.path.abspath(_entry))

import retry as mod  # noqa: E402  (must come after the sys.path fix above)


class FakeTime:
    """A clock that only moves when someone sleeps (or a call 'takes time')."""

    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


class Script:
    """A fake fn: raises or returns the scripted outcomes in order."""

    def __init__(self, *outcomes, cost=0.0, clock=None):
        self.outcomes = list(outcomes)
        self.calls = 0
        self.cost = cost      # seconds each call "takes" on the fake clock
        self.clock = clock

    def __call__(self):
        self.calls += 1
        if self.clock is not None:
            self.clock.now += self.cost
        outcome = self.outcomes.pop(0) if len(self.outcomes) > 1 else self.outcomes[0]
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class HTTPError(Exception):
    def __init__(self, status, retry_after=None):
        super().__init__(f"HTTP {status}")
        self.status = status
        if retry_after is not None:
            self.retry_after = retry_after


def run(fn, t, **kw):
    """Call retry() with fakes and generous defaults."""
    kw.setdefault("attempts", 5)
    kw.setdefault("base_delay", 1.0)
    kw.setdefault("max_delay", 100.0)
    kw.setdefault("rand", lambda: 1.0)   # jitter factor 1.0: delay == ceiling
    return mod.retry(fn, sleep=t.sleep, clock=t.clock, **kw)


class Basics(unittest.TestCase):
    def test_success_first_time_does_not_sleep(self):
        t, fn = FakeTime(), Script("ok")
        self.assertEqual(run(fn, t), "ok")
        self.assertEqual((fn.calls, t.sleeps), (1, []))

    def test_recovers_after_transient_failures(self):
        t, fn = FakeTime(), Script(ConnectionResetError("reset"), TimeoutError("slow"), "ok")
        self.assertEqual(run(fn, t), "ok")
        self.assertEqual(fn.calls, 3)
        self.assertEqual(len(t.sleeps), 2)

    def test_never_sleeps_after_the_final_attempt(self):
        t, fn = FakeTime(), Script(ConnectionError("down"))
        with self.assertRaises(ConnectionError):
            run(fn, t, attempts=3)
        self.assertEqual(fn.calls, 3)
        self.assertEqual(len(t.sleeps), 2)   # between 1-2 and 2-3 only
        t, fn = FakeTime(), Script(ConnectionError("down"))
        with self.assertRaises(ConnectionError):
            run(fn, t, attempts=1)
        self.assertEqual((fn.calls, t.sleeps), (1, []))

    def test_raises_the_original_last_exception(self):
        errors = [ConnectionError("first"), ConnectionError("second"), TimeoutError("third")]
        t, fn = FakeTime(), Script(*errors)
        with self.assertRaises(TimeoutError) as ctx:
            run(fn, t, attempts=3)
        self.assertIs(ctx.exception, errors[-1])   # same object, not a wrapper or a copy

    def test_rejects_nonsense_arguments(self):
        for bad in ({"attempts": 0}, {"base_delay": -1}, {"max_delay": -1}, {"deadline": 0}):
            with self.subTest(bad):
                fn = Script("ok")
                with self.assertRaises(ValueError):
                    run(fn, FakeTime(), **bad)
                self.assertEqual(fn.calls, 0)


class Backoff(unittest.TestCase):
    def test_exponential_growth(self):
        t = FakeTime()
        with self.assertRaises(ConnectionError):
            run(Script(ConnectionError()), t, attempts=6, base_delay=0.5)
        self.assertEqual(t.sleeps, [0.5, 1.0, 2.0, 4.0, 8.0])

    def test_capped_at_max_delay(self):
        t = FakeTime()
        with self.assertRaises(ConnectionError):
            run(Script(ConnectionError()), t, attempts=8, base_delay=1, max_delay=5)
        self.assertEqual(t.sleeps, [1, 2, 4, 5, 5, 5, 5])

    def test_many_attempts_stay_capped_and_do_not_overflow(self):
        t = FakeTime()
        with self.assertRaises(ConnectionError):
            run(Script(ConnectionError()), t, attempts=1200, base_delay=0.5, max_delay=10)
        self.assertEqual(len(t.sleeps), 1199)
        self.assertLessEqual(max(t.sleeps), 10)

    def test_full_jitter_scales_the_capped_ceiling(self):
        # delay = rand() * min(max_delay, base * 2**n)
        rolls = iter([0.0, 0.5, 0.25, 0.9, 0.0])
        t = FakeTime()
        with self.assertRaises(ConnectionError):
            run(Script(ConnectionError()), t, attempts=5, base_delay=1, max_delay=6, rand=lambda: next(rolls))
        expected = [0.0 * 1, 0.5 * 2, 0.25 * 4, 0.9 * 6]
        self.assertEqual(len(t.sleeps), 4)
        for got, want in zip(t.sleeps, expected):
            self.assertAlmostEqual(got, want)

    def test_retry_after_hint_is_honoured_but_capped(self):
        # rand() == 0 would make the backoff 0, so any non-zero sleep came from the hint.
        t = FakeTime()
        run(Script(HTTPError(503, retry_after=7), "ok"), t, max_delay=30, rand=lambda: 0.0)
        self.assertEqual(t.sleeps, [7])
        t = FakeTime()
        run(Script(mod.RetryableError("busy", retry_after=120), "ok"), t, max_delay=30, rand=lambda: 0.0)
        self.assertEqual(t.sleeps, [30])

    def test_nonsense_hints_are_ignored(self):
        for bad in (-5, "soon", True, float("nan")):
            with self.subTest(bad):
                t = FakeTime()
                run(Script(HTTPError(429, retry_after=bad), "ok"), t, base_delay=2, rand=lambda: 1.0)
                self.assertEqual(t.sleeps, [2])


class Classification(unittest.TestCase):
    def test_default_classifier(self):
        retryable = [ConnectionError(), ConnectionRefusedError(), TimeoutError(), mod.RetryableError("x")]
        retryable += [HTTPError(s) for s in (429, 500, 502, 503, 504)]
        permanent = [HTTPError(s) for s in (400, 401, 403, 404, 409, 422, 501)]
        permanent += [ValueError(), KeyError("k"), mod.PermanentError("no")]
        for exc in retryable:
            with self.subTest(exc=repr(exc)):
                self.assertTrue(mod.default_is_retryable(exc))
        for exc in permanent:
            with self.subTest(exc=repr(exc)):
                self.assertFalse(mod.default_is_retryable(exc))

    def test_permanent_errors_are_not_retried(self):
        for exc in (HTTPError(404), mod.PermanentError("bad request"), ValueError("bug")):
            with self.subTest(exc=repr(exc)):
                t, fn = FakeTime(), Script(exc)
                with self.assertRaises(type(exc)) as ctx:
                    run(fn, t)
                self.assertIs(ctx.exception, exc)
                self.assertEqual((fn.calls, t.sleeps), (1, []))

    def test_custom_classifier_is_used(self):
        t, fn = FakeTime(), Script(KeyError("cache miss"), "ok")
        self.assertEqual(run(fn, t, is_retryable=lambda e: isinstance(e, KeyError)), "ok")
        t, fn = FakeTime(), Script(ConnectionError())
        with self.assertRaises(ConnectionError):
            run(fn, t, is_retryable=lambda e: False)
        self.assertEqual(fn.calls, 1)

    def test_keyboard_interrupt_is_never_retried(self):
        t, fn = FakeTime(), Script(KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt):
            run(fn, t, is_retryable=lambda e: True)
        self.assertEqual(fn.calls, 1)


class DeadlineAndObservability(unittest.TestCase):
    def test_deadline_stops_early_with_the_last_error(self):
        # Each call takes 1s. Timeline: call@0-1, sleep 1, call@2-3, sleep 2,
        # call@5-6, next sleep would be 4s -> reaches t=10 = deadline -> give up.
        t = FakeTime()
        errors = [TimeoutError(f"try {i}") for i in range(10)]
        fn = Script(*errors, cost=1.0, clock=t)
        with self.assertRaises(TimeoutError) as ctx:
            run(fn, t, attempts=10, base_delay=1, deadline=10)
        self.assertEqual(fn.calls, 3)
        self.assertEqual(t.sleeps, [1, 2])
        self.assertIs(ctx.exception, errors[2])
        self.assertLess(t.now, 10)

    def test_deadline_applies_to_retry_after_too(self):
        t, fn = FakeTime(), Script(HTTPError(503, retry_after=30), "ok")
        with self.assertRaises(HTTPError):
            run(fn, t, max_delay=60, deadline=20)
        self.assertEqual((fn.calls, t.sleeps), (1, []))

    def test_on_retry_reports_each_retry(self):
        errors = [ConnectionError("a"), TimeoutError("b"), ConnectionError("c")]
        seen = []
        t = FakeTime()
        with self.assertRaises(ConnectionError):
            run(Script(*errors), t, attempts=3, base_delay=1,
                on_retry=lambda attempt, delay, exc: seen.append((attempt, delay, exc)))
        self.assertEqual(seen, [(1, 1.0, errors[0]), (2, 2.0, errors[1])])
        self.assertEqual([d for _, d, _ in seen], t.sleeps)   # reported delay is the one slept


if __name__ == "__main__":
    unittest.main()
