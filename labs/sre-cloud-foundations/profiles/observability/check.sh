#!/usr/bin/env bash
# Check the observability profile end to end, read-only except for one
# synthetic test span: Prometheus ready and scraping, Grafana healthy with both
# datasources, the collector healthy, and a span sent to the collector over
# OTLP/HTTP retrievable from Jaeger by its trace id. Exit 1 on any failure.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/common.sh"
require_compose_project "$OBS_PROJECT"
require_workstation python3
python3 - <<'PY'
import json, os, secrets, sys, time, urllib.request
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # local endpoints: never through a proxy

def get(url, timeout=5, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data else "GET")
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return 0, str(e)

def wait(name, pred, timeout=90):
    end = time.time() + timeout
    last = ""
    while time.time() < end:
        ok, last = pred()
        if ok:
            print(f"PASS {name}: {last}")
            return True
        time.sleep(2)
    print(f"FAIL {name}: {last}")
    return False

ok = True
ok &= wait("prometheus-ready", lambda: (lambda s, b: (s == 200, f"{s} {b.strip()[:60]}"))(*get("http://127.0.0.1:19090/-/ready")))
def targets():
    s, b = get("http://127.0.0.1:19090/api/v1/targets?state=active")
    if s != 200:
        return False, f"HTTP {s}"
    t = json.loads(b)["data"]["activeTargets"]
    up = sorted(x["labels"]["job"] for x in t if x["health"] == "up")
    return {"prometheus", "otelcol"} <= set(up), f"up: {', '.join(up) or 'none'}"
ok &= wait("prometheus-scrapes", targets)
def grafana():
    s, b = get("http://127.0.0.1:13000/api/health")
    if s != 200:
        return False, f"HTTP {s}"
    s2, b2 = get("http://127.0.0.1:13000/api/datasources/uid/looped-prom")
    s3, _ = get("http://127.0.0.1:13000/api/datasources/uid/looped-jaeger")
    v = json.loads(b).get("version")
    return s2 == 200 and s3 == 200, f"version {v}; datasources prom={s2} jaeger={s3}"
ok &= wait("grafana", grafana)
ok &= wait("otelcol-health", lambda: (lambda s, b: (s == 200, f"{s} {b.strip()[:60]}"))(*get("http://127.0.0.1:13133/")))
tid, sid = secrets.token_hex(16), secrets.token_hex(8)
now = time.time_ns()
span = {"resourceSpans": [{"resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "looped-obs-check"}}]},
        "scopeSpans": [{"scope": {"name": "check.sh"}, "spans": [{"traceId": tid, "spanId": sid, "name": "profile check", "kind": 1,
        "startTimeUnixNano": str(now - 5_000_000), "endTimeUnixNano": str(now)}]}]}]}
s, b = get("http://127.0.0.1:14318/v1/traces", data=json.dumps(span).encode(), headers={"Content-Type": "application/json"})
print(("PASS" if s == 200 else "FAIL") + f" otlp-accept: HTTP {s}")
ok &= s == 200
def jaeger():
    s, b = get(f"http://127.0.0.1:16686/api/traces/{tid}")
    if s != 200:
        return False, f"HTTP {s} for trace {tid}"
    spans = json.loads(b)["data"][0]["spans"]
    return len(spans) >= 1, f"trace {tid} stored with {len(spans)} span(s)"
ok &= wait("jaeger-trace", jaeger, timeout=60)
print("PASS observability profile" if ok else "FAIL observability profile")
sys.exit(0 if ok else 1)
PY
