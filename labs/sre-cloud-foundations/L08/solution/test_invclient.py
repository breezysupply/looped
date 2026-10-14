"""Reference unit tests for L08 (read after your own attempt).

No network: a scripted fake transport plays the server and a fake sleep records
the waits, so retry timing is tested without waiting and without flakiness.
"""
import io
import json
import unittest

import invclient as ic

TOKEN = "lab-l08-unit-test-token-not-a-real-secret"


class FakeTransport:
    """Replays a script of responses; records every call."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append({"method": method, "url": url, "headers": dict(headers), "timeout": timeout})
        if not self.script:
            raise AssertionError("unexpected extra request: " + method + " " + url)
        step = self.script.pop(0)
        if isinstance(step, BaseException):
            raise step
        status, headers_out, body_out = step
        if isinstance(body_out, (dict, list)):
            body_out = json.dumps(body_out).encode()
        return status, headers_out, body_out


def page(ids, nxt):
    return 200, {}, {"items": [{"id": i} for i in ids], "next_page_token": nxt}


def client(script, **kw):
    t = FakeTransport(script)
    sleeps = []
    logs = []
    c = ic.InventoryClient("http://fixture.invalid", TOKEN, transport=t, sleep=sleeps.append, log=logs.append, **kw)
    return c, t, sleeps, logs


class Pagination(unittest.TestCase):
    def test_follows_tokens_until_none(self):
        c, t, _, _ = client([page(["a", "b"], "t1"), page(["c"], "t2"), page(["d"], None)])
        self.assertEqual([x["id"] for x in c.list_inventory(page_size=2)], ["a", "b", "c", "d"])
        self.assertIn("page_token=t2", t.calls[2]["url"])

    def test_repeated_token_is_a_loop(self):
        c, t, _, _ = client([page(["a"], "t1"), page(["b"], "t2"), page(["c"], "t1")])
        with self.assertRaises(ic.PaginationLoop):
            c.list_inventory()
        self.assertEqual(len(t.calls), 3)

    def test_empty_token_ends(self):
        c, _, _, _ = client([page(["a"], "")])
        self.assertEqual(len(c.list_inventory()), 1)


class Retries(unittest.TestCase):
    def test_429_waits_for_retry_after(self):
        c, t, sleeps, _ = client([(429, {"retry-after": "2"}, {"error": "slow down"}), page(["a"], None)])
        c.list_inventory()
        self.assertEqual(sleeps, [2.0])
        self.assertEqual(len(t.calls), 2)

    def test_503_is_retried_with_backoff(self):
        c, t, sleeps, _ = client([(503, {}, b"{}"), (503, {}, b"{}"), page(["a"], None)], backoff_s=0.5)
        c.list_inventory()
        self.assertEqual(sleeps, [0.5, 1.0])

    def test_timeout_is_retried_and_every_call_has_a_finite_timeout(self):
        c, t, _, _ = client([TimeoutError("timed out"), page(["a"], None)], timeout=1.5)
        c.list_inventory()
        self.assertTrue(all(call["timeout"] == 1.5 for call in t.calls))

    def test_malformed_json_is_retried_for_get(self):
        c, t, _, _ = client([(200, {}, b'{"items": [{"id": "a"'), page(["a"], None)])
        self.assertEqual(len(c.list_inventory()), 1)
        self.assertEqual(len(t.calls), 2)

    def test_retries_are_bounded(self):
        c, t, sleeps, _ = client([(503, {}, b"{}")] * 3, max_retries=2)
        with self.assertRaises(ic.ApiError):
            c.list_inventory()
        self.assertEqual(len(t.calls), 3)
        self.assertEqual(len(sleeps), 2)

    def test_client_errors_are_not_retried(self):
        c, t, _, _ = client([(404, {}, b'{"error": "not found"}')])
        with self.assertRaises(ic.ApiError):
            c.list_inventory()
        self.assertEqual(len(t.calls), 1)


class PostPolicy(unittest.TestCase):
    def test_post_without_key_is_not_retried(self):
        c, t, _, _ = client([(503, {}, b"{}")])
        with self.assertRaises(ic.ApiError) as cm:
            c.refresh()
        self.assertEqual(len(t.calls), 1)
        self.assertIn("unknown", str(cm.exception))

    def test_post_with_key_retries_with_the_same_key(self):
        c, t, _, _ = client([(503, {}, b"{}"), (200, {}, {"refresh_id": "rf-001"})])
        self.assertEqual(c.refresh(idempotency_key="k-1")["refresh_id"], "rf-001")
        self.assertEqual([call["headers"].get("Idempotency-Key") for call in t.calls], ["k-1", "k-1"])


class Secrets(unittest.TestCase):
    def test_token_sent_but_never_logged_or_raised(self):
        c, t, _, logs = client([(503, {}, b"{}")] * 4)
        with self.assertRaises(ic.ApiError) as cm:
            c.list_inventory()
        self.assertEqual(t.calls[0]["headers"]["Authorization"], "Bearer " + TOKEN)
        self.assertTrue(logs)
        self.assertNotIn(TOKEN, " ".join(logs) + str(cm.exception) + repr(c))


class Cli(unittest.TestCase):
    def test_missing_token_is_a_usage_error(self):
        import os
        old = os.environ.pop("LOOPED_L08_TOKEN", None)
        try:
            err = io.StringIO()
            self.assertEqual(ic.main(["list"], stdout=io.StringIO(), stderr=err), 2)
            self.assertIn("token", err.getvalue())
        finally:
            if old is not None:
                os.environ["LOOPED_L08_TOKEN"] = old


if __name__ == "__main__":
    unittest.main()
