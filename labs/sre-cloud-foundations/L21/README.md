# L21 — Instrument Beacon: metrics, logs, traces and a dashboard you can trust

Module M11 · ~150 min practical · profile `observability` (Prometheus, Grafana, OpenTelemetry
Collector, Jaeger on Docker) · **local only: no cloud, no cost**

## Ticket

> **BEACON-OBS-2104.** Support says the sensor page (`GET /sensors/{id}`) has been slow since
> yesterday; the API hosts "look fine". Prometheus' memory on the shared stack has been creeping
> up since BEACON-1987 shipped. The worker team cannot follow a job back to the request that
> created it. And the on-call dashboard has request rate and errors only.
> Find where the time goes with evidence from all three signals, fix what is ours to fix, keep
> the telemetry bounded, and hand over a dashboard whose queries are proven.

`work/TICKET.md` holds the same text after setup.

## Objectives

- `obj-m11-01` instrument a service across signals and correlate one request across all three
- `obj-m11-02` use RED/USE signals and PromQL to tell a slow dependency from local CPU saturation
- `obj-m11-05` find a high-cardinality label and keep label values bounded without losing the signal

## What you run

- **The profile** (`profiles/observability/`): Prometheus 3.5.0 (exemplar storage on), Grafana
  12.1.1, OpenTelemetry Collector contrib 0.131.0 and Jaeger 2.9.0, compose project `looped-obs`,
  every port on 127.0.0.1 (Prometheus :19090, Grafana :13000, Jaeger :16686).
- **The lab** (compose project `looped-l21`, on the profile's network `looped-obs-net`): a
  **lab-local copy of Beacon** in `work/app/` (trimmed from `beacon/beacon/api.py`; the course's
  `beacon/` directory is never changed) — `api` on 127.0.0.1:18521, `worker` (metrics on :18523)
  and a **registry fixture** (another team's service the API calls, :18522). The Python image is
  pinned by tag and digest; your code is bind-mounted read-only, nothing is built.
- `work/app/telemetry.py` is provided and works: JSON logs, Prometheus text **and** OpenMetrics
  with exemplars, W3C `traceparent` helpers, and spans exported over OTLP/HTTP to the collector,
  all with the standard library. The lab is about how `api.py` and `worker.py` use it. An
  OpenTelemetry SDK would add features; the wire formats here are the real ones.

## What is fixture-controlled

`inject.sh` (run by setup) applies a teammate's change to `work/app/api.py` (BEACON-1987), and one
of two latency causes chosen by `LOOPED_VARIANT=variant-a|variant-b`: either the registry
fixture's response delay (`work/fixture/registry.json`, a fixture knob, not a real network
fault) or a value in `work/config/config.json`. It then restarts the API and sends 20 s of
bounded traffic (`assets/traffic.py`). The starter also has a gap of its own: the worker does
not join the request's trace. Nothing printed says which variant you have; finding out is the
exercise.

## Steps and checkpoints

**Checkpoint c1 — instrument and correlate (week 32, session 2).**

1. `bash labs/sre-cloud-foundations/profiles/observability/setup.sh` (pulls pinned images once;
   its `check.sh` sends one test span end to end).
2. `bash labs/sre-cloud-foundations/L21/setup.sh`, then read `work/TICKET.md`.
3. More traffic when you need it: `python3 labs/sre-cloud-foundations/L21/assets/traffic.py --seconds 60`.
4. RED first: rate, errors and duration per route in Prometheus; then USE for the API process
   (`process_cpu_seconds_total`) and the dependency histogram. Write two hypotheses in
   `evidence/L21-notes.md` before opening a trace.
5. Open one slow `GET /sensors/{id}` trace in Jaeger (search by service `beacon-l21-api`,
   min duration 300ms) and read where the time is. Record the source and that trace id in
   `work/diagnosis.json`; fix what is ours (edit `work/config/config.json`,
   `docker restart looped-l21-api`).
6. Count the series of `beacon_l21_requests_total` (`count(...)` in Prometheus, or
   `curl -s 127.0.0.1:18521/metrics`). Keep only bounded labels — route template, method,
   status class — and keep the per-user detail where it belongs.
7. Make the worker continue the request's trace: carry the context in the job, continue it in
   the worker, restart both. Prove it with one `POST /jobs` whose `traceparent` you set: the
   same trace id in the API log, the worker log, Jaeger and a Prometheus exemplar.

**Checkpoint c2 — dashboard (week 32, session 3).**

8. Add three panels to `work/dashboard.json` with these exact titles: `p95 latency /sensors`,
   `Dependency p95`, `API CPU` (keep `Request rate` and `Error ratio`). Each must return one
   series (Request rate may be per route), use literal ranges of at least `[1m]` (no Grafana
   variables), and filter by `job` where the metric exists on more than one target.
   `python3 labs/sre-cloud-foundations/L21/assets/grafana_push.py` loads it into Grafana.
9. `python3 labs/sre-cloud-foundations/L21/validate.py --explanation-file labs/sre-cloud-foundations/L21/evidence/L21-notes.md`
   and import `evidence/latest.json`.

## What the validator checks

It sends real requests and reads every signal back: targets up; series count and label names of
the request counter after 60 different users; one traced `POST /jobs` found in the API log, the
worker log, Jaeger (worker span a child of an API span) and as a Prometheus exemplar; each
required panel's query evaluated **with promtool against supplied data**
(`assets/expected/dashboard-fixture.json`, expected values included) and against the live
Prometheus; your diagnosis against the injected cause **and** the trace you cite; and the p95 of
30 sensor requests after your change, together with whether the change fits the cause.
Deleting every label, pointing at the wrong cause, or computing a quantile without `rate()`
fails a check.

## Rubric for the notes (self or mentor)

- Each signal is used for the question it answers best, with the query, trace id or log field named.
- Two hypotheses were written before the trace was opened, and the discriminating evidence is quoted.
- The cardinality cost is stated with a number, and the per-user detail still exists somewhere bounded.
- The correlation path is explained as data flow (headers, job payload, exemplar), not as tool clicks.

## Pause / resume

Containers keep running; `docker start` them after a reboot (profile first). `setup.sh` reuses
`work/`. `reset.sh` moves `work/` to `.work-previous/` and starts over for the same variant.
`teardown.sh` removes `looped-l21` only; stop the profile with
`profiles/observability/teardown.sh` before starting a cluster or the VM.

## Lab versus production

- Production services use an OpenTelemetry SDK or auto-instrumentation, a collector per node or
  cluster, sampling, and a trace backend with retention; the headers, OTLP and exemplars are the
  same as here.
- One Prometheus, five-second scrapes and a one-day retention keep the feedback loop short; a
  real cardinality budget is set per team and enforced with limits (`sample_limit`, relabelling).

## Limits — what this lab does not prove

It proves bounded instrumentation, W3C context propagation across an HTTP call and a queue,
exemplar-based metric-to-trace correlation and PromQL that is checked against known data, on one
machine. It does not prove sampling strategy, collector scaling, long-term storage, alert routing
(L22), or anything about real network latency: the slow dependency is a fixture delay and the CPU
cost is a configuration value, both labelled as such.

## References

- T07 OpenTelemetry signals · T14 Prometheus querying and unit testing rules · T01 Google SRE Workbook (monitoring)
