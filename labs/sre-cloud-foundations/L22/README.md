# L22 — SLIs, error budgets and burn-rate alerts, tested instead of waited for

Module M11 · ~100 min practical · profile `workstation` (Python 3 + Docker for the pinned
`promtool`) · **fixtures only: no cluster, no cloud, nothing waits for days**

## Ticket

> The observability guild left a draft of Beacon's availability and latency SLO rules
> (`work/rules/beacon-slo.rules.yml`) and asked us to own them before they go on-call. Nobody has
> tested them. Last month's traffic is in `work/month.json`. Before Friday: a written SLI with a
> defensible numerator, denominator and exclusions, last month's error-budget numbers, and alert
> rules that page on sustained user impact, stay quiet on a short spike, tell "no data" apart
> from "healthy", and do nothing when there was no eligible traffic — proven with `promtool`.

## Objectives

- `obj-m11-03` define availability and latency SLIs with explicit exclusions and compute an error budget
- `obj-m11-04` write alert rules that fire on sustained burn and clear correctly, distinguish
  no-data from healthy, and test them without waiting

## The contract

SLO: **99.5 % of eligible requests succeed over 30 days** (error budget 0.005). The metric is
`beacon_http_requests_total{job="beacon", route, code}` and the latency histogram
`beacon_http_request_duration_seconds_*`. The rules file must keep these names (the acceptance
tests and other teams' dashboards use them):

- recording rules `beacon:sli_eligible:rate{5m,30m,1h,6h}`, `beacon:sli_errors:rate{5m,30m,1h,6h}`,
  `beacon:sli_error_ratio:rate{5m,30m,1h,6h}`, `beacon:sli_latency_good_ratio:rate5m` (threshold 300 ms)
- alerts `BeaconErrorBudgetBurnFast` (label `severity: page`), `BeaconErrorBudgetBurnSlow`
  (`severity: ticket`), `BeaconSLINoData` (`severity: ticket`), each with `slo: beacon-availability`

The draft does not say what it excludes; decide that yourself and write it down.

## Tools

`promtool` from the pinned image `prom/prometheus:v3.5.0` (setup pulls it once; if Docker Hub
rate-limits you, `export LOOPED_PROM_IMAGE=quay.io/prometheus/prometheus:v3.5.0` — the same
release). It runs with `--network none` and your `work/` mounted read-only:

```sh
W=labs/sre-cloud-foundations/L22/work
docker run --rm --network none -v "$PWD/$W:/w:ro" --entrypoint promtool prom/prometheus:v3.5.0 check rules /w/rules/beacon-slo.rules.yml
docker run --rm --network none -v "$PWD/$W:/w:ro" --entrypoint promtool prom/prometheus:v3.5.0 test rules /w/tests/beacon-slo.test.yml
```

Prometheus 3 selects range windows left-open: `rate(x[1m])` over a fixture sampled every minute
has one sample and returns nothing. Use `interval: 15s` series or windows of several intervals.

## What is fixture-controlled

`inject.sh` (run by setup; `LOOPED_VARIANT=variant-a|variant-b`) writes the guild's draft for the
variant and that variant's month of traffic. The drafts differ in what they get wrong. Your
tests file and worksheet are never overwritten.

## Steps and checkpoints

**Checkpoint c1 — SLI and budget (week 33, session 1).**

1. `bash labs/sre-cloud-foundations/L22/setup.sh`.
2. Before reading the draft's expressions, write in `work/slo.json` which requests are
   eligible, which are bad, and what you exclude and why (health checks? scrapes? 4xx? 429?).
3. Compute last month's numbers from `work/month.json` by hand or with a few lines of Python:
   eligible, bad, allowed bad (0.5 % of eligible), budget consumed in percent, remaining. Write a
   one-paragraph decision: what this budget state means for releases and for on-call.

**Checkpoint c2 — rules and tests (week 33, session 2).**

4. Read the draft's recording rules against your SLI. Run `check rules`, then the example test.
5. Write tests first, one `name:` per scenario containing the word: **missing** (the counter
   disappears), **spike** (a few minutes of errors after hours of health), **burn** (a sustained
   error rate: pages within the hour, clears after recovery), **zero** (only health checks and
   4xx). Watch them fail against the draft.
6. Fix the rules until your tests pass. Multi-window, multi-burn-rate: fast = 1 h and 5 m above
   14.4× budget for 2 m; slow = 6 h and 30 m above 6× for 15 m. Keep "no data" separate from 0.
7. `python3 labs/sre-cloud-foundations/L22/validate.py` and import `evidence/latest.json`.

## What the validator checks

`promtool check rules`; the required names; the lab's **acceptance tests**
(`assets/acceptance/acceptance.test.yml`: exact numerator/denominator on a mixed fixture,
a 0 ratio when there are no errors, no-data alert on a missing counter, no page on a short spike,
fast burn fires and clears, slow burn opens a ticket only, zero eligible traffic fires nothing);
your own tests pass, cover the four scenarios, and **fail against the original draft** (tests
that cannot catch the defect prove nothing); the budget numbers recomputed from `work/month.json`;
and the written SLI. Deleting an alert, or wrapping a ratio in `or vector(0)` so missing data
looks healthy, fails a check.

## Rubric (self or mentor)

- The exclusions are argued (who is the user; what is the caller's fault; what is ours).
- The decision uses the budget number, not a feeling, and names what changes for on-call.
- Each test asserts an outcome (alert state or value), not an expression's text.

## Pause / resume

Everything is files in `work/`. `setup.sh` keeps them. `reset.sh` restores the draft rules and
the month fixture (your rules saved as `.bak`; tests and worksheet untouched). `teardown.sh`
removes `work/` only; the Prometheus image is kept.

## Lab versus production

- The same rules load into Prometheus or any compatible ruler; real windows come from 30 days of
  scraped data, and the same tests run in CI on every rules change.
- Real SLOs often exclude planned maintenance windows and synthetic traffic by label; that needs
  the label to exist at the source — another reason to keep labels bounded (L21).

## Limits — what this lab does not prove

It proves SLI arithmetic, burn-rate alert logic and rule testing on deterministic fixtures with
the real `promtool`. It does not prove scraping, alert delivery (Alertmanager routing, paging,
silences), recording-rule performance on real data, or that 99.5 % is the right objective for
Beacon's users.

## References

- T01 Google SRE Workbook (SLOs, alerting on SLOs) · T14 Prometheus unit testing for rules · T07 OpenTelemetry signals
