# L21 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Three different questions: *which* requests are slow (a metric by route), *where
   inside* one slow request the time goes (a trace), and *who* was affected (a log line). Answer
   them in that order before changing anything, and ask of every label: how many values can it take?
2. **Evidence source.** Prometheus at 127.0.0.1:19090 (`beacon_l21_*`, `process_cpu_seconds_total`,
   `count(beacon_l21_requests_total)`), Jaeger at 127.0.0.1:16686 (service `beacon-l21-api`,
   min duration 300ms), `docker logs looped-l21-api` / `looped-l21-worker` (JSON, with `trace_id`).
   Compare the route's p95 with the dependency histogram's p95 and with the API's CPU rate.
3. **Discriminating check.** In one slow trace, which child span is long: the registry call or
   `checksum`? Does the dependency p95 follow the route p95, or does CPU? For the worker, send one
   `POST /jobs` with your own `traceparent` and grep both logs for that trace id: what is
   different in the worker's line, and what did the job file in `work/queue/done/` carry?
4. **Root cause and fix.** Variant A: the registry is slow — set `registry_timeout_ms` to 250 and
   cite the registry span's trace. Variant B: `checksum_rounds` was raised to 1 500 000 — set it
   back to 2000 and cite the checksum span. Always: remove `user_id` from the counter's labels
   (it stays in the log line); put `"traceparent": qspan.traceparent` in the job and start the
   worker's span from `parse_traceparent(job["traceparent"])`; dashboard p95 panels use
   `histogram_quantile(0.95, sum by (le) (rate(..._bucket[1m])))`, CPU filters `job="beacon-l21-api"`.
