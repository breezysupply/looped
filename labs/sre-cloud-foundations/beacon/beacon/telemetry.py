"""Structured JSON logs, Prometheus-text metrics and W3C trace context, all
with the standard library.

Logs: one JSON object per line on stdout, always carrying request_id and
(when present) trace_id so a request can be followed across API, worker and
the proxy in front. Secrets are never logged: headers are allow-listed.

Metrics: counters and a histogram rendered in the Prometheus text format at
/metrics. Labels are bounded on purpose — the path label is the route
template, never the raw path — because unbounded labels are the cardinality
fault M11 teaches you to find (and L21 injects one deliberately).
"""
from __future__ import annotations

import json
import os
import secrets
import sys
import threading
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

SERVICE = os.environ.get("BEACON_SERVICE_NAME", "beacon-api")


def log(level: str, msg: str, **fields: Any) -> None:
    rec: Dict[str, Any] = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z", "level": level, "service": SERVICE, "msg": msg}
    for k, v in fields.items():
        if v is None:
            continue
        if any(s in k.lower() for s in ("password", "token", "secret", "authorization")):
            rec[k] = "<redacted>"
        else:
            rec[k] = v
    sys.stdout.write(json.dumps(rec, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def new_request_id() -> str:
    return secrets.token_hex(8)


def parse_traceparent(value: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """Return (trace_id, parent_span_id) from a W3C traceparent header, or (None, None)."""
    if not value:
        return None, None
    parts = value.strip().split("-")
    if len(parts) != 4 or len(parts[1]) != 32 or len(parts[2]) != 16:
        return None, None
    return parts[1], parts[2]


def make_traceparent(trace_id: Optional[str]) -> Tuple[str, str, str]:
    trace_id = trace_id or secrets.token_hex(16)
    span_id = secrets.token_hex(8)
    return f"00-{trace_id}-{span_id}-01", trace_id, span_id


class Metrics:
    """Minimal counter/gauge/histogram registry with Prometheus text output."""

    BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)

    def __init__(self, cardinality_limit: int = 200) -> None:
        self._lock = threading.Lock()
        self._counters: Dict[str, Dict[Tuple[Tuple[str, str], ...], float]] = {}
        self._gauges: Dict[str, Dict[Tuple[Tuple[str, str], ...], float]] = {}
        self._hist: Dict[str, Dict[Tuple[Tuple[str, str], ...], List[float]]] = {}
        self._help: Dict[str, str] = {}
        self.cardinality_limit = cardinality_limit
        self.dropped_series = 0

    def _key(self, labels: Dict[str, str]) -> Tuple[Tuple[str, str], ...]:
        return tuple(sorted((k, str(v)) for k, v in labels.items()))

    def _guard(self, table: Dict[str, Dict[Any, Any]], name: str, key: Tuple[Tuple[str, str], ...]) -> bool:
        series = table.setdefault(name, {})
        if key not in series and len(series) >= self.cardinality_limit:
            self.dropped_series += 1
            return False
        return True

    def inc(self, name: str, labels: Optional[Dict[str, str]] = None, value: float = 1.0, help_text: str = "") -> None:
        labels = labels or {}
        with self._lock:
            self._help.setdefault(name, help_text)
            key = self._key(labels)
            if not self._guard(self._counters, name, key):
                return
            self._counters[name][key] = self._counters[name].get(key, 0.0) + value

    def set(self, name: str, value: float, labels: Optional[Dict[str, str]] = None, help_text: str = "") -> None:
        labels = labels or {}
        with self._lock:
            self._help.setdefault(name, help_text)
            key = self._key(labels)
            if not self._guard(self._gauges, name, key):
                return
            self._gauges[name][key] = float(value)

    def observe(self, name: str, value: float, labels: Optional[Dict[str, str]] = None, help_text: str = "") -> None:
        labels = labels or {}
        with self._lock:
            self._help.setdefault(name, help_text)
            key = self._key(labels)
            if not self._guard(self._hist, name, key):
                return
            series = self._hist[name].setdefault(key, [0.0] * (len(self.BUCKETS) + 1) + [0.0, 0.0])
            for i, b in enumerate(self.BUCKETS):
                if value <= b:
                    series[i] += 1
            series[len(self.BUCKETS)] += 1  # +Inf
            series[-2] += value  # sum
            series[-1] += 1  # count

    @staticmethod
    def _fmt_labels(key: Iterable[Tuple[str, str]], extra: Optional[Tuple[str, str]] = None) -> str:
        parts = [f'{k}="{v}"' for k, v in key]
        if extra:
            parts.append(f'{extra[0]}="{extra[1]}"')
        return "{" + ",".join(parts) + "}" if parts else ""

    def render(self) -> str:
        with self._lock:
            out: List[str] = []
            for name, series in self._counters.items():
                out.append(f"# HELP {name} {self._help.get(name, '')}\n# TYPE {name} counter")
                for key, v in series.items():
                    out.append(f"{name}{self._fmt_labels(key)} {v:g}")
            for name, series in self._gauges.items():
                out.append(f"# HELP {name} {self._help.get(name, '')}\n# TYPE {name} gauge")
                for key, v in series.items():
                    out.append(f"{name}{self._fmt_labels(key)} {v:g}")
            for name, series in self._hist.items():
                out.append(f"# HELP {name} {self._help.get(name, '')}\n# TYPE {name} histogram")
                for key, vals in series.items():
                    for i, b in enumerate(self.BUCKETS):
                        out.append(f"{name}_bucket{self._fmt_labels(key, ('le', f'{b:g}'))} {vals[i]:g}")
                    out.append(f"{name}_bucket{self._fmt_labels(key, ('le', '+Inf'))} {vals[len(self.BUCKETS)]:g}")
                    out.append(f"{name}_sum{self._fmt_labels(key)} {vals[-2]:g}")
                    out.append(f"{name}_count{self._fmt_labels(key)} {vals[-1]:g}")
            out.append(f"# HELP beacon_metrics_dropped_series_total Series refused by the cardinality guard\n# TYPE beacon_metrics_dropped_series_total counter\nbeacon_metrics_dropped_series_total {self.dropped_series}")
            return "\n".join(out) + "\n"


METRICS = Metrics()
