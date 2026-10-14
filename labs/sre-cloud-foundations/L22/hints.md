# L22 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** An SLI is a ratio of *events*: decide which events are eligible and which are
   bad before reading any PromQL. A health check is not a user; a request the caller got wrong
   is not our failure. Then separately ask: is "no data" the same as "zero errors"?
2. **Evidence source.** `promtool test rules` with small fixtures is your clock: 6 hours of
   history take a few milliseconds. Evaluate each recording rule on a fixture where you know the
   answer (e.g. 398 good, 2 bad, 50 4xx, 66 health checks per minute) and compare with your
   arithmetic. For alerts, read alert state from `ALERTS{alertstate="firing"}`.
3. **Discriminating check.** Feed the draft four fixtures — counter missing, a 3-minute spike after
   6 healthy hours, 10 % errors for 70 minutes, health checks and 4xx only — and note which alert
   is wrong in each. A ratio that exists when the counter does not, or one that is empty when
   there are no errors, tells you where the defect is.
4. **Root cause and fix.** Variant A: eligible must exclude `/healthz|/metrics` and 4xx, bad is
   5xx only, errors need `or 0 * beacon:sli_eligible:rateX` — fix every window. Variant B: fast
   burn needs both 1h and 5m above 14.4×0.005 for 2m, remove `or vector(0)`, and make
   `BeaconSLINoData` `absent(beacon_http_requests_total{job="beacon"})` for 10m. Budget:
   allowed = 0.005 × eligible, consumed = bad / allowed × 100.
