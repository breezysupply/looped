"""Your unit tests for invclient (L08). Run: python3 -m unittest discover -s . -p 'test_*.py'

No network and no real waiting: FakeTransport plays the server, a list records sleeps.
validate.py runs this file against your client, against a reference client (must pass)
and against several subtly broken clients (must fail on each), so test the CONTRACT in
invclient.py's docstring. One example to start from:
"""
import json
import unittest

import invclient as ic

TOKEN = "lab-l08-unit-test-token-not-a-real-secret"


class FakeTransport:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append({"method": method, "url": url, "headers": dict(headers), "timeout": timeout})
        step = self.script.pop(0)
        if isinstance(step, BaseException):
            raise step
        status, headers_out, body_out = step
        if isinstance(body_out, (dict, list)):
            body_out = json.dumps(body_out).encode()
        return status, headers_out, body_out


class Examples(unittest.TestCase):
    def test_two_pages(self):
        t = FakeTransport([(200, {}, {"items": [{"id": "a"}], "next_page_token": "t1"}),
                           (200, {}, {"items": [{"id": "b"}], "next_page_token": None})])
        c = ic.InventoryClient("http://fixture.invalid", TOKEN, transport=t, sleep=lambda s: None)
        self.assertEqual([i["id"] for i in c.list_inventory()], ["a", "b"])

    # Add tests for: 429 + Retry-After (assert the recorded sleep), 503 backoff, a timeout,
    # malformed JSON, bounded retries, a 404 that is not retried, a repeated page token,
    # POST with and without an idempotency key, the token never in logs/errors/repr,
    # and the CLI's exit codes.


if __name__ == "__main__":
    unittest.main()
