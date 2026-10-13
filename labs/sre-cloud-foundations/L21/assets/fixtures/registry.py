"""L21 fixture: the sensor registry, "another team's service" that Beacon's
API calls for /sensors/{id}. Not yours to change during the lab.

GET /registry/{id}  -> {"sensor_id", "site", "model"} after delay_ms
GET /metrics        -> registry_requests_total (Prometheus text)
Continues the caller's trace (W3C traceparent) and exports one server span per
request to the collector. delay_ms is read from /lab/fixture/registry.json on
every request (inject.sh writes it); it is a fixture knob, not a real fault.
"""
import json
import os
import re
import secrets
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE = os.environ.get("REGISTRY_STATE", "/lab/fixture/registry.json")
OTLP = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").rstrip("/")
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
TP = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$")
COUNT = {"n": 0}
LOCK = threading.Lock()


def delay_ms():
    try:
        with open(STATE, "r", encoding="utf-8") as fh:
            return max(0, int(json.load(fh).get("delay_ms", 0)))
    except (OSError, ValueError):
        return 0


def export(trace_id, parent, start_ns, end_ns, sensor):
    if not OTLP:
        return
    span = {"traceId": trace_id, "spanId": secrets.token_hex(8), "name": "GET /registry/{id}", "kind": 2,
            "startTimeUnixNano": str(start_ns), "endTimeUnixNano": str(end_ns),
            "attributes": [{"key": "sensor.id", "value": {"stringValue": sensor}}], "status": {"code": 1}}
    if parent:
        span["parentSpanId"] = parent
    body = {"resourceSpans": [{"resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "beacon-l21-registry"}}]},
                               "scopeSpans": [{"scope": {"name": "registry-fixture"}, "spans": [span]}]}]}
    try:
        req = urllib.request.Request(OTLP + "/v1/traces", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
        OPENER.open(req, timeout=2).read()
    except Exception:  # noqa: BLE001
        pass


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        return

    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/metrics"):
            with LOCK:
                n = COUNT["n"]
            self._send(200, ("# TYPE registry_requests_total counter\nregistry_requests_total %d\n" % n).encode(), "text/plain; version=0.0.4")
            return
        if not self.path.startswith("/registry/"):
            self._send(404, b'{"error":"not found"}')
            return
        start = time.time_ns()
        sensor = self.path[len("/registry/"):]
        m = TP.match(self.headers.get("traceparent", ""))
        time.sleep(0.015 + delay_ms() / 1000.0)
        n = sum(sensor.encode()) if sensor else 0
        body = json.dumps({"sensor_id": sensor, "site": "site-%02d" % (n % 20), "model": ("bx-100", "bx-200", "kx-7")[n % 3]}).encode()
        self._send(200, body)
        with LOCK:
            COUNT["n"] += 1
        if m:
            threading.Thread(target=export, args=(m.group(1), m.group(2), start, time.time_ns(), sensor), daemon=True).start()


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", 8081), H)
    srv.daemon_threads = True
    print(json.dumps({"msg": "registry fixture listening", "port": 8081}), flush=True)
    srv.serve_forever()
