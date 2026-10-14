"""Beacon starter tests. Run from labs/sre-cloud-foundations/beacon:
    python3 -m unittest discover -s tests -t .
They start a real server on a free loopback port, so they also prove the
API runs on this Python."""
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from beacon import config as cfgmod
from beacon.api import make_server
from beacon.queue import DirQueue
from beacon.worker import Effects, process


def _get(url, headers=None, data=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return r.status, r.read().decode(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), dict(e.headers)


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="beacon-test-")
        cfg = cfgmod.load(None, environ={}, overrides={
            "server": {"listen": "127.0.0.1", "port": 0},
            "app": {"admin_enabled": True},
            "queue": {"kind": "dir", "dir": os.path.join(cls.tmp, "q")},
            "store": {"kind": "sqlite", "path": os.path.join(cls.tmp, "beacon.db")},
        })
        cls.srv = make_server(cfg)
        cls.port = cls.srv.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.t = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.t.start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.app.store.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_health_version_ready(self):
        code, body, hdr = _get(self.base + "/healthz")
        self.assertEqual((code, body), (200, "ok\n"))
        self.assertIn("X-Request-Id", hdr)
        code, body, _ = _get(self.base + "/version")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["version"], "1.4.0")
        code, body, _ = _get(self.base + "/ready")
        self.assertEqual(code, 200)
        self.assertTrue(json.loads(body)["ready"])

    def test_status_roundtrip_and_idempotency(self):
        rec = json.dumps({"sensor_id": "s-1", "status": "ok"}).encode()
        h = {"Content-Type": "application/json", "Idempotency-Key": "k-1"}
        code, body, _ = _get(self.base + "/status", headers=h, data=rec, method="POST")
        self.assertEqual(code, 201)
        first = json.loads(body)
        code, body, _ = _get(self.base + "/status", headers=h, data=rec, method="POST")
        self.assertEqual(code, 200)
        self.assertTrue(json.loads(body)["duplicate"])
        self.assertEqual(json.loads(body)["id"], first["id"])
        code, body, _ = _get(self.base + "/status/s-1")
        self.assertEqual(len(json.loads(body)["records"]), 1)

    def test_bad_body_is_400_not_500(self):
        code, body, _ = _get(self.base + "/status", headers={"Content-Type": "application/json"}, data=b"{not json", method="POST")
        self.assertEqual(code, 400)
        code, body, _ = _get(self.base + "/status", headers={"Content-Type": "application/json"}, data=b"{}", method="POST")
        self.assertEqual(code, 400)
        self.assertIn("sensor_id", body)

    def test_request_id_is_propagated(self):
        code, _, hdr = _get(self.base + "/healthz", headers={"X-Request-Id": "abc123"})
        self.assertEqual(hdr["X-Request-Id"], "abc123")
        self.assertTrue(hdr["traceparent"].startswith("00-"))

    def test_metrics_are_prometheus_text_with_route_labels(self):
        _get(self.base + "/status/s-xyz")
        code, body, hdr = _get(self.base + "/metrics")
        self.assertEqual(code, 200)
        self.assertIn('beacon_requests_total{code="200",method="GET",route="/status/{sensor}"}', body)
        self.assertIn("beacon_request_duration_seconds_bucket", body)
        self.assertNotIn("s-xyz", body, "raw path must never be a label value")

    def test_inject_ready_fail_changes_readiness_not_liveness(self):
        _get(self.base + "/admin/inject", headers={"Content-Type": "application/json"}, data=b'{"ready_fail": true}', method="POST")
        try:
            self.assertEqual(_get(self.base + "/ready")[0], 503)
            self.assertEqual(_get(self.base + "/healthz")[0], 200)
        finally:
            _get(self.base + "/admin/inject", headers={"Content-Type": "application/json"}, data=b'{"ready_fail": false}', method="POST")
        self.assertEqual(_get(self.base + "/ready")[0], 200)

    def test_jobs_enqueue(self):
        code, body, _ = _get(self.base + "/jobs", headers={"Content-Type": "application/json", "Idempotency-Key": "j-1"}, data=b'{"kind":"noop"}', method="POST")
        self.assertEqual(code, 202)
        self.assertEqual(json.loads(body)["queue"], "dir")


class ConfigTests(unittest.TestCase):
    def test_yaml_subset_and_validation(self):
        data = cfgmod.parse_yaml_subset("server:\n  listen: 127.0.0.1\n  port: 9090\napp:\n  version: \"2.0.0\"\n")
        self.assertEqual(data["server"]["port"], 9090)
        self.assertEqual(data["app"]["version"], "2.0.0")
        self.assertEqual(cfgmod.validate({"server": {"listen": "0.0.0.0", "port": "8080"}, "store": {"kind": "memory"}, "queue": {"kind": "none"}}), ["server.port must be an integer 0–65535, got '8080' (str)"])

    def test_wrong_depth_is_caught_by_validate_not_parse(self):
        data = cfgmod.parse_yaml_subset("server:\n  listen: 0.0.0.0\nport: 8080\n")
        self.assertNotIn("port", data["server"])
        problems = cfgmod.validate(dict(cfgmod.DEFAULTS, server=data["server"], port=8080))
        self.assertTrue(any("unknown top-level section 'port'" in p for p in problems))

    def test_tabs_and_markers_rejected(self):
        with self.assertRaises(cfgmod.ConfigError):
            cfgmod.parse_yaml_subset("server:\n\tport: 1\n")
        with self.assertRaises(cfgmod.ConfigError):
            cfgmod.parse_yaml_subset("<<<<<<< HEAD\nserver:\n  port: 1\n")

    def test_env_override(self):
        cfg = cfgmod.load(None, environ={"BEACON_SERVER_PORT": "9191", "BEACON_STORE_URL": "postgres://x"})
        self.assertEqual(cfg.get("server", "port"), 9191)
        self.assertEqual(cfg.redacted()["store"]["url"], "<redacted>")

    def test_missing_file_error_is_useful(self):
        with self.assertRaises(cfgmod.ConfigError) as cm:
            cfgmod.load("config/does-not-exist.yaml", environ={})
        self.assertIn("no such file", str(cm.exception))


class WorkerTests(unittest.TestCase):
    def test_duplicate_delivery_with_and_without_idempotency(self):
        tmp = tempfile.mkdtemp(prefix="beacon-w-")
        try:
            q = DirQueue(os.path.join(tmp, "q"), stale_s=0.0)
            effects = Effects(os.path.join(tmp, "effects.jsonl"))
            q.enqueue({"kind": "email", "idempotency_key": "order-1", "payload": {"work_ms": 1}})
            job = q.take(0.5)
            process(job, effects, idempotent=True, crash_after_take=False)
            # not acked: redelivered
            job2 = q.take(0.5)
            self.assertEqual(job2["attempt"], 2)
            self.assertEqual(process(job2, effects, idempotent=True, crash_after_take=False), "duplicate-skipped")
            self.assertEqual(effects.count(), 1)
            q.ack(job2)
            q.enqueue({"kind": "email", "idempotency_key": "order-2", "payload": {"work_ms": 1}})
            j = q.take(0.5)
            process(j, effects, idempotent=False, crash_after_take=False)
            j = q.take(0.5)
            process(j, effects, idempotent=False, crash_after_take=False)
            self.assertEqual(effects.count(), 3, "without idempotency the side effect repeats")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
