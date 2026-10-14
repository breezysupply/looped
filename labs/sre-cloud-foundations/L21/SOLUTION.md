# L21 worked solution

Open this only after a real attempt; using it makes the attempt **assisted**. The finished files
are in `solution/` (`app/api.py`, `app/worker.py`, `dashboard.json`, `config-variant-a.json`,
`config-variant-b.json`).

## 1. Latency source (c1)

RED on the route: `histogram_quantile(0.95, sum by (le) (rate(beacon_l21_request_duration_seconds_bucket{route="/sensors/{id}"}[1m])))`
is around 0.45–0.5 s while `/jobs` stays under 5 ms. Then separate the hypotheses:

| Evidence | variant-a (dependency) | variant-b (local CPU) |
|---|---|---|
| `histogram_quantile(0.95, sum by (le) (rate(beacon_l21_dependency_duration_seconds_bucket{dependency="registry"}[1m])))` | ≈ route p95 (~0.47 s) | ~0.02 s |
| `rate(process_cpu_seconds_total{job="beacon-l21-api"}[1m])` | ~0.01 cores | close to 1 core under load |
| slow trace in Jaeger | `registry GET /registry/{id}` ≈ 465 ms (and the registry's own server span) | `checksum` ≈ 450–500 ms |

- **variant-a:** the registry is another team's service. Ours to fix is the exposure: set
  `registry_timeout_ms` to 250 (from 5000) so a slow dependency degrades the page (`registry:
  unavailable`) instead of holding API threads, then hand the trace id to the registry team. Do
  not edit `work/fixture/registry.json`: that is pretending the dependency recovered.
- **variant-b:** `checksum_rounds` was raised to 1 500 000; set it back to the reviewed 2000.
  Adding a timeout would change nothing.

`docker restart looped-l21-api`, then write `work/diagnosis.json` with `latency_source`
(`dependency` or `local-cpu`) and the trace id of the slow trace you read (it must still show the
slow span; Jaeger keeps traces while the profile runs).

## 2. Cardinality (c1)

BEACON-1987 added `"user_id": user_id or "anonymous"` to the labels of
`beacon_l21_requests_total`: one series per user × route × method × status class, unbounded
(`count(beacon_l21_requests_total)` grows with every new user). Restore the line to
`{"route": route, "method": method, "status_class": status_class(code)}`. The user id is already
in the request's JSON log line next to `trace_id`, which is where per-user questions are answered.

## 3. Correlation (c1)

The API's server span is created from the incoming `traceparent`, its log line carries
`trace_id`, and the latency histogram records the trace id as an **exemplar** (OpenMetrics; the
profile runs Prometheus with `--enable-feature=exemplar-storage`). The gap is the queue: the job
carried no context, so the worker started a new trace. In `api.py` add
`"traceparent": qspan.traceparent` to the job; in `worker.py` start the span with
`trace_id, parent_id = parse_traceparent(job.get("traceparent"))`. Restart both containers.
Check with a fixed trace id:

```sh
TP=00-$(openssl rand -hex 16)-$(openssl rand -hex 8)-01
curl -s --noproxy '*' -X POST 127.0.0.1:18521/jobs -H "traceparent: $TP" -H 'Content-Type: application/json' -d '{"sensor_id":"s-0042"}'
docker logs looped-l21-worker 2>&1 | grep "$(echo $TP | cut -d- -f2)"
```

## 4. Dashboard (c2)

```
p95 latency /sensors  histogram_quantile(0.95, sum by (le) (rate(beacon_l21_request_duration_seconds_bucket{route="/sensors/{id}"}[1m])))
Dependency p95        histogram_quantile(0.95, sum by (le) (rate(beacon_l21_dependency_duration_seconds_bucket{dependency="registry"}[1m])))
API CPU               rate(process_cpu_seconds_total{job="beacon-l21-api"}[1m])
```

On the supplied fixture these give 875, 85 and 500 (×1000). Without `rate()` the quantile is
taken over all-time counts and returns a different bucket; without `job=` the CPU panel adds
the worker. The starter's Error ratio uses `rate(5xx) or 0 * rate(all)` so it shows 0, not
"no data", when there are no errors.

## Unsafe shortcuts the validator rejects

Dropping every label (no route/status left to alert on), turning the fixture delay to 0,
naming the cause without a trace that shows it, and quantiles over raw bucket counters.
