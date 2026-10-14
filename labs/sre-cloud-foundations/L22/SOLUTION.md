# L22 worked solution

Open this only after a real attempt; using it makes the attempt **assisted**. Finished files:
`solution/rules/beacon-slo.rules.yml`, `solution/tests/beacon-slo.test.yml`,
`solution/slo-variant-a.json`, `solution/slo-variant-b.json`.

## SLI (c1)

- **Eligible (denominator):** `beacon_http_requests_total{job="beacon"}` on every route except
  `/healthz` and `/metrics`, excluding 4xx. Probes and scrapes are not users; a 400/401/404/429
  is the caller's request being refused by design (track it, but not against our budget).
- **Bad (numerator):** the eligible requests with a 5xx code.
- **Latency:** eligible requests faster than 300 ms (`le="0.3"` bucket over `_count`).

## Budget (c1)

| | variant-a (2026-09) | variant-b (2026-08) |
|---|---|---|
| eligible | 16 784 820 | 13 903 015 |
| bad | 47 110 | 79 745 |
| allowed bad (0.5 %) | 83 924.1 | 69 515.1 |
| consumed | 56.13 % | 114.72 % |
| remaining | 36 814.1 | −10 229.9 |

Counting `/healthz` 503s or 4xx as bad, or health checks as eligible, moves every number.

## What the drafts got wrong (c2)

- **variant-a — the SLI arithmetic.** Eligible was every request (health checks, scrapes, 4xx);
  bad was `code!~"2.."` (4xx counted as our failure); the latency SLI included `/healthz`; and
  with no 5xx series at all, `sum(rate(...5xx...))` returns *nothing*, so the ratio was "no
  data" during perfect health. Fix the selectors (`route!~"/healthz|/metrics"`, `code!~"4.."`,
  `code=~"5.."`) and give the error rate a zero when there is eligible traffic:
  `sum(rate(...{code=~"5.."}[5m])) or 0 * beacon:sli_eligible:rate5m`.
- **variant-b — the alerting.** Fast burn used one 5-minute window with `for: 0m`: three bad
  minutes after six healthy hours paged someone. The 5m ratio was wrapped in `or vector(0)`, so a
  missing counter read as a perfect 0, and the no-data alert watched that ratio (never absent).
  Fix: `beacon:sli_error_ratio:rate1h > 14.4*0.005 and beacon:sli_error_ratio:rate5m > 14.4*0.005`
  `for: 2m`; slow = 6h and 30m above 6× for 15m; drop `or vector(0)`; no-data =
  `absent(beacon_http_requests_total{job="beacon"})` for 10m.

## Zero eligible traffic

With only health checks and 4xx, eligible = 0 and the ratio is 0/0 = NaN. NaN compared with a
threshold is false, so no burn alert fires; the counter exists, so no-data does not fire either.
That is the intended "no evidence either way" state — not an outage, not missing telemetry.

## Tests that catch the drafts

Each group in `solution/tests/beacon-slo.test.yml` asserts outcomes: alert state with
`alert_rule_test` (`exp_alerts: []` or labels and annotations) or
`count(ALERTS{alertname="…",alertstate="firing"}) or vector(0)`. The `missing` group fails
against variant-b (the ratio is 0, no alert); the `zero` and example groups fail against
variant-a (4xx counted, empty ratio). Run them against the draft to see that before fixing.
