"""Telemetry for the L21 lab copy of Beacon — standard library only.

  log()          one JSON object per line on stdout (trace_id/span_id when known)
  traceparent    W3C trace context: parse_traceparent() / format_traceparent()
  Metrics        counters, gauges and histograms; Prometheus text OR OpenMetrics
                 (with exemplars: the trace_id of the latest observation in each
                 histogram bucket, so a latency spike links to a real trace)
  Tracer/Span    spans exported as OTLP/HTTP JSON to $OTEL_EXPORTER_OTLP_ENDPOINT
                 (the observability profile's collector) by a background thread

This module is provided and works; the lab is about how api.py and worker.py
USE it. An OpenTelemetry SDK would do the same with more features; the wire
formats (traceparent header, OTLP, OpenMetrics) are the real ones.
"""
from __future__ import annotations

import json
import os
import queue
import re
import secrets
import sys
import threading
import time
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

SERVICE = os.environ.get("OTEL_SERVICE_NAME", "beacon-l21")
OTLP = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").rstrip("/")
_TP = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$")
_out_lock = threading.Lock()


# ── logs ────────────────────────────────────────────────────────────────
def log(level: str, msg: str, **fields: Any) -> None:
    rec: Dict[str, Any] = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z", "level": level, "service": SERVICE, "msg": msg}
    for k, v in fields.items():
        if v is None:
            continue
        rec[k] = "<redacted>" if any(s in k.lower() for s in ("password", "token", "secret", "authorization")) else v
    with _out_lock:
        sys.stdout.write(json.dumps(rec, separators=(",", ":")) + "\n")
        sys.stdout.flush()


# ── W3C trace context ──────────────────────────────────────────────────
def parse_traceparent(value: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """(trace_id, parent_span_id) from a traceparent header value, or (None, None) if absent/invalid."""
    m = _TP.match((value or "").strip().lower())
    if not m or m.group(1) == "0" * 32 or m.group(2) == "0" * 16:
        return None, None
    return m.group(1), m.group(2)


def format_traceparent(trace_id: str, span_id: str) -> str:
    return f"00-{trace_id}-{span_id}-01"


def new_trace_id() -> str:
    return secrets.token_hex(16)


def new_span_id() -> str:
    return secrets.token_hex(8)


# ── metrics ────────────────────────────────────────────────────────────
LabelKey = Tuple[Tuple[str, str], ...]


class Metrics:
    BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0)

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._kind: Dict[str, str] = {}
        self._help: Dict[str, str] = {}
        self._values: Dict[str, Dict[LabelKey, Any]] = {}
        self._exemplars: Dict[str, Dict[LabelKey, List[Optional[Tuple[str, float, float]]]]] = {}

    @staticmethod
    def _key(labels: Optional[Dict[str, Any]]) -> LabelKey:
        return tuple(sorted((k, str(v)) for k, v in (labels or {}).items()))

    def _family(self, name: str, kind: str, help_text: str) -> Dict[LabelKey, Any]:
        self._kind.setdefault(name, kind)
        self._help.setdefault(name, help_text)
        return self._values.setdefault(name, {})

    def inc(self, name: str, labels: Optional[Dict[str, Any]] = None, value: float = 1.0, help_text: str = "") -> None:
        with self._lock:
            fam = self._family(name, "counter", help_text)
            k = self._key(labels)
            fam[k] = fam.get(k, 0.0) + value

    def set(self, name: str, value: float, labels: Optional[Dict[str, Any]] = None, help_text: str = "") -> None:
        with self._lock:
            self._family(name, "gauge", help_text)[self._key(labels)] = float(value)

    def observe(self, name: str, value: float, labels: Optional[Dict[str, Any]] = None, help_text: str = "", trace_id: Optional[str] = None) -> None:
        with self._lock:
            fam = self._family(name, "histogram", help_text)
            k = self._key(labels)
            s = fam.setdefault(k, [0.0] * (len(self.BUCKETS) + 1) + [0.0, 0.0])
            ex = self._exemplars.setdefault(name, {}).setdefault(k, [None] * (len(self.BUCKETS) + 1))
            placed = False
            for i, b in enumerate(self.BUCKETS):
                if value <= b:
                    s[i] += 1
                    if not placed and trace_id:
                        ex[i] = (trace_id, value, time.time())
                        placed = True
            s[len(self.BUCKETS)] += 1
            if not placed and trace_id:
                ex[len(self.BUCKETS)] = (trace_id, value, time.time())
            s[-2] += value
            s[-1] += 1

    def series_count(self, name: str) -> int:
        with self._lock:
            return len(self._values.get(name, {}))

    @staticmethod
    def _labels(key: LabelKey, extra: Optional[Tuple[str, str]] = None) -> str:
        parts = ['%s="%s"' % (k, v.replace("\\", "\\\\").replace('"', '\\"')) for k, v in key]
        if extra:
            parts.append('%s="%s"' % extra)
        return "{" + ",".join(parts) + "}" if parts else ""

    def render(self, openmetrics: bool = False) -> str:
        """Prometheus text format 0.0.4, or OpenMetrics 1.0 with exemplars."""
        cpu = time.process_time()
        out: List[str] = []
        with self._lock:
            for name in sorted(self._values):
                kind, series = self._kind[name], self._values[name]
                fam = name[:-6] if openmetrics and kind == "counter" and name.endswith("_total") else name
                out.append(f"# HELP {fam} {self._help.get(name) or name}")
                out.append(f"# TYPE {fam} {kind}")
                for k, v in series.items():
                    if kind != "histogram":
                        out.append(f"{name}{self._labels(k)} {v:.17g}")
                        continue
                    ex = self._exemplars.get(name, {}).get(k, [])
                    for i, b in enumerate(list(self.BUCKETS) + [float("inf")]):
                        le = "+Inf" if b == float("inf") else repr(float(b))
                        line = f"{name}_bucket{self._labels(k, ('le', le))} {v[i]:.17g}"  # buckets are cumulative
                        if openmetrics and i < len(ex) and ex[i]:
                            tid, val, ts = ex[i]
                            line += ' # {trace_id="%s"} %.6f %.3f' % (tid, val, ts)
                        out.append(line)
                    out.append(f"{name}_sum{self._labels(k)} {v[-2]:.17g}")
                    out.append(f"{name}_count{self._labels(k)} {v[-1]:.17g}")
        fam = "process_cpu_seconds" if openmetrics else "process_cpu_seconds_total"
        out.append(f"# HELP {fam} CPU time used by this process (user+system), seconds")
        out.append(f"# TYPE {fam} counter")
        out.append(f"process_cpu_seconds_total {cpu:.6f}")
        if openmetrics:
            out.append("# EOF")
        return "\n".join(out) + "\n"


METRICS = Metrics()


def metrics_response(accept: str) -> Tuple[bytes, str]:
    """Body and Content-Type for a /metrics request, negotiated on the Accept header."""
    if "application/openmetrics-text" in (accept or ""):
        return METRICS.render(openmetrics=True).encode(), "application/openmetrics-text; version=1.0.0; charset=utf-8"
    return METRICS.render().encode(), "text/plain; version=0.0.4; charset=utf-8"


# ── traces ─────────────────────────────────────────────────────────────
KIND = {"internal": 1, "server": 2, "client": 3, "producer": 4, "consumer": 5}


class Span:
    """A span; use as a context manager. `traceparent` is what a child process/request should receive."""

    def __init__(self, tracer: "Tracer", name: str, trace_id: str, parent_id: Optional[str], kind: str, attributes: Dict[str, Any]) -> None:
        self.tracer, self.name, self.trace_id, self.parent_id, self.kind = tracer, name, trace_id, parent_id, kind
        self.span_id = new_span_id()
        self.attributes = dict(attributes)
        self.error = False
        self.start_ns = time.time_ns()
        self.end_ns = 0

    @property
    def traceparent(self) -> str:
        return format_traceparent(self.trace_id, self.span_id)

    def set(self, key: str, value: Any) -> None:
        self.attributes[key] = value

    def __enter__(self) -> "Span":
        return self

    def __exit__(self, et: Any, ev: Any, tb: Any) -> None:
        if et is not None:
            self.error = True
            self.attributes.setdefault("exception", repr(ev)[:200])
        self.end()

    def end(self) -> None:
        if not self.end_ns:
            self.end_ns = time.time_ns()
            self.tracer._export(self)

    @property
    def duration_s(self) -> float:
        return ((self.end_ns or time.time_ns()) - self.start_ns) / 1e9


class Tracer:
    def __init__(self, service: str = SERVICE, endpoint: str = OTLP) -> None:
        self.service = service
        self.endpoint = endpoint + "/v1/traces" if endpoint else ""
        self._q: "queue.Queue[Span]" = queue.Queue(maxsize=5000)
        self.dropped = 0
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        if self.endpoint:
            threading.Thread(target=self._loop, daemon=True).start()

    def start(self, name: str, trace_id: Optional[str] = None, parent_id: Optional[str] = None, kind: str = "internal", **attributes: Any) -> Span:
        """A new span. With no trace_id this STARTS A NEW TRACE."""
        return Span(self, name, trace_id or new_trace_id(), parent_id, kind, attributes)

    def _export(self, span: Span) -> None:
        if not self.endpoint:
            return
        try:
            self._q.put_nowait(span)
        except queue.Full:
            self.dropped += 1

    @staticmethod
    def _attr(k: str, v: Any) -> Dict[str, Any]:
        if isinstance(v, bool):
            return {"key": k, "value": {"boolValue": v}}
        if isinstance(v, int):
            return {"key": k, "value": {"intValue": str(v)}}
        if isinstance(v, float):
            return {"key": k, "value": {"doubleValue": v}}
        return {"key": k, "value": {"stringValue": str(v)}}

    def _loop(self) -> None:
        while True:
            batch = [self._q.get()]
            time.sleep(0.5)
            while len(batch) < 200:
                try:
                    batch.append(self._q.get_nowait())
                except queue.Empty:
                    break
            spans = []
            for s in batch:
                d = {"traceId": s.trace_id, "spanId": s.span_id, "name": s.name, "kind": KIND.get(s.kind, 1),
                     "startTimeUnixNano": str(s.start_ns), "endTimeUnixNano": str(s.end_ns),
                     "attributes": [self._attr(k, v) for k, v in s.attributes.items() if v is not None],
                     "status": {"code": 2 if s.error else 1}}
                if s.parent_id:
                    d["parentSpanId"] = s.parent_id
                spans.append(d)
            body = {"resourceSpans": [{"resource": {"attributes": [self._attr("service.name", self.service)]},
                                       "scopeSpans": [{"scope": {"name": "looped-l21"}, "spans": spans}]}]}
            req = urllib.request.Request(self.endpoint, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
            try:
                with self._opener.open(req, timeout=3) as r:
                    r.read()
            except Exception as e:  # noqa: BLE001 - telemetry must never break the service
                self.dropped += len(batch)
                log("warning", "span export failed", error=str(e)[:120], dropped=len(batch))
