/* SRE & Cloud Deployment Foundations — local lab specifications L21–L24.
   Same record shape as sre-labs.js (see L01/L03 there). M11: instrument Beacon
   across metrics, logs and traces on the observability profile (L21); SLIs,
   error budgets and burn-rate alerts tested with promtool (L22). M12: query
   plans, locks and pool exhaustion on PostgreSQL 16 (L23); verified
   backup/restore and idempotent delivery (L24). */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreLabs = LX.sreLabs || [];

(function () {
  var DIR = 'labs/sre-cloud-foundations/';
  function lab(x) { x.version = x.version || '1.0'; LX.sreLabs.push(x); }

  lab({
    id: 'L21', moduleId: 'M11', title: 'Instrument Beacon: metrics, logs, traces and a dashboard you can trust',
    objectiveIds: ['obj-m11-01', 'obj-m11-02', 'obj-m11-05'], executionMode: 'local', estimatedMinutes: 150, environmentProfile: 'observability', prerequisites: ['L14'],
    learnerBrief: 'A lab-local copy of Beacon (API, worker and a registry service owned by another team) runs on the observability profile: Prometheus, Grafana, an OpenTelemetry Collector and Jaeger, all pinned and bound to 127.0.0.1. Support says the sensor page has been slow since yesterday, Prometheus memory has been creeping up since a recent change, the worker team cannot follow a job back to its request, and the on-call dashboard shows only rate and errors.\n\nFind where the time goes with evidence from all three signals, fix what is yours to fix, keep the labels bounded, make one request traceable from the API log through the worker to a metric exemplar, and finish a dashboard whose queries are checked against supplied data. The telemetry helpers are provided and use the real wire formats (traceparent, OTLP, OpenMetrics); the course\'s beacon/ directory is not changed.',
    checkpoints: [
      { id: 'c1', title: 'Instrument and correlate', resumeInstructions: 'Start the profile (`bash ' + DIR + 'profiles/observability/setup.sh`), then `bash ' + DIR + 'L21/setup.sh` (keeps work/). After a reboot: `docker start` the looped-obs-* and looped-l21-* containers. Your code is work/app, config work/config/config.json, diagnosis work/diagnosis.json.' },
      { id: 'c2', title: 'Dashboard with proven queries', resumeInstructions: 'Edit work/dashboard.json (titles: Request rate, Error ratio, p95 latency /sensors, Dependency p95, API CPU) and load it with `python3 ' + DIR + 'L21/assets/grafana_push.py`; validate.py checks each query against assets/expected/dashboard-fixture.json with promtool.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/compose.yaml', 'assets/common.sh', 'assets/fixtures/registry.py', 'assets/traffic.py', 'assets/grafana_push.py', 'assets/expected/dashboard-fixture.json', 'assets/diagnosis-template.json', 'assets/notes-template.md', 'starter/app/', 'starter/config/config.json', 'starter/dashboard.json', 'solution/', 'profiles/observability/', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['bash ' + DIR + 'profiles/observability/setup.sh   # Prometheus 3.5.0, Grafana 12.1.1, otelcol-contrib 0.131.0, Jaeger 2.9.0', 'bash ' + DIR + 'L21/setup.sh', 'cat ' + DIR + 'L21/work/TICKET.md'],
    faultInjection: ['# setup.sh injected variant-a plus the cardinality change; to start over with the other latency cause:', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L21/reset.sh', 'python3 ' + DIR + 'L21/assets/traffic.py --seconds 60   # bounded traffic whenever you need data'],
    tasks: ['RED per route and USE for the API process in Prometheus; write two hypotheses for the slow sensor page before opening a trace.', 'Read one slow GET /sensors/{id} trace in Jaeger; record the latency source and that trace id in work/diagnosis.json and fix what is yours (config, restart the API).', 'Count the series of beacon_l21_requests_total; keep only route template, method and status class as labels, with per-user detail in the log line.', 'Make the worker continue the request\'s trace through the job, and prove one request across the API log, the worker log, Jaeger and a Prometheus exemplar.', 'Add the p95 latency, dependency p95 and API CPU panels to work/dashboard.json (literal ranges, one series each) and load it into Grafana.', 'Run validate.py, import the evidence, then teardown.sh and the profile\'s teardown.sh.'],
    validation: [
      { id: 'profile-up', description: 'Prometheus ready and Jaeger query API reachable', critical: true },
      { id: 'targets-up', description: 'Prometheus scrapes beacon-l21-api, -worker and -registry', critical: true },
      { id: 'bounded-labels', description: 'after 60 different users, at most 30 series and only route, method, status_class labels', critical: true },
      { id: 'labels-useful', description: 'those labels are present, status_class is Nxx and routes are templates', critical: true },
      { id: 'prometheus-series', description: 'live series count in Prometheus within the bound (advisory)', critical: false },
      { id: 'log-correlation', description: 'the API log line of a traced POST /jobs carries its trace id', critical: true },
      { id: 'trace-propagation', description: 'the worker log line for that job carries the same trace id', critical: true },
      { id: 'trace-stored', description: 'Jaeger holds the trace with API and worker spans, the worker span a child of an API span', critical: true },
      { id: 'metric-exemplar', description: 'Prometheus stored an exemplar with that trace id on the latency histogram', critical: true },
      { id: 'dashboard-expected', description: 'each required panel query gives the expected value on the supplied fixture (promtool)', critical: true },
      { id: 'dashboard-live', description: 'each required panel query returns data from the live Prometheus', critical: true },
      { id: 'dashboard-loads', description: 'the dashboard loads into Grafana (advisory)', critical: false },
      { id: 'latency-diagnosis', description: 'diagnosis names the injected source and a real trace whose span shows it', critical: true },
      { id: 'latency-fixed', description: 'p95 of 30 sensor requests under 300 ms by the change that fits the cause', critical: true },
      { id: 'notes', description: 'notes sections have substance (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L21/reset.sh   # same variant; previous work kept in .work-previous/'],
    teardown: ['bash ' + DIR + 'L21/teardown.sh   # looped-l21 only', 'bash ' + DIR + 'profiles/observability/teardown.sh   # stop the telemetry profile'],
    evidenceInstructions: ['`python3 ' + DIR + 'L21/validate.py --explanation-file ' + DIR + 'L21/evidence/L21-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Paste evidence/latest.json here. Trace ids and synthetic user ids are not sensitive; never paste real tokens or customer data.'],
    hints: [
      { level: 1, text: 'Three questions, three signals: which requests are slow (a metric by route), where inside one slow request the time goes (a trace), who was affected (a log line). And for every label: how many values can it take?' },
      { level: 2, text: 'Compare the route\'s p95 with the dependency histogram\'s p95 and with rate(process_cpu_seconds_total{job="beacon-l21-api"}[1m]); in Jaeger search beacon-l21-api with min duration 300ms. count(beacon_l21_requests_total) shows the label cost.' },
      { level: 3, text: 'In one slow trace, which child span is long: the registry call or checksum? For the worker, send one POST /jobs with your own traceparent and grep both containers\' logs for that trace id; then read a job file in work/queue/done/ — what context did it carry?' },
      { level: 4, text: 'Variant A: the registry is slow — set registry_timeout_ms to 250 and cite the registry span. Variant B: checksum_rounds was raised to 1500000 — set it to 2000 and cite the checksum span. Always: drop user_id from the counter labels, put qspan.traceparent in the job and start the worker span from parse_traceparent(job["traceparent"]); p95 panels use histogram_quantile(0.95, sum by (le) (rate(..._bucket[1m]))).' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T07', 'T14', 'T01'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L21/reset.sh` (or variant-a): the sensor page is slow again for a different reason. Write new hypotheses before opening a trace, re-apply your cardinality and propagation fixes from .work-previous/, and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L21/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L21/reset.sh' },
    limits: ['One machine and fixture-controlled causes: the slow dependency is a delay knob in the registry fixture and the CPU cost is a configuration value, both labelled. Proves bounded labels, W3C context across HTTP and a queue, exemplar correlation and PromQL checked against known data; not sampling, collector scaling, long-term storage, alert routing or real network latency.', 'Executed during development on Linux amd64 (Docker Engine, Compose v2; images prom/prometheus v3.5.0, grafana 12.1.1, otelcol-contrib 0.131.0, jaeger 2.9.0): profile setup/check PASS; both variants ran setup → inject → validate FAIL → fix → validate PASS (15/15), plus reset → validate FAIL and teardown of the lab and the profile. A wrong diagnosis, a timeout-only fix for the CPU variant and a p95 panel without rate() failed. Not run on macOS / Apple Silicon.']
  });

  lab({
    id: 'L22', moduleId: 'M11', title: 'SLIs, error budgets and burn-rate alerts, tested instead of waited for',
    objectiveIds: ['obj-m11-03', 'obj-m11-04'], executionMode: 'local', estimatedMinutes: 100, environmentProfile: 'workstation', prerequisites: ['L21'],
    learnerBrief: 'The observability guild left a draft of Beacon\'s availability and latency SLO rules and a month of traffic counts. Own them before they go on-call: write an SLI with a numerator, denominator and exclusions you can defend, compute last month\'s error budget, and fix the rules so they page on sustained user impact, stay quiet on a short spike, tell "no data" apart from "healthy" and do nothing when there was no eligible traffic.\n\nNothing waits for days: you prove every behaviour with promtool unit tests over deterministic fixtures, using the pinned Prometheus image through Docker. Your own tests must also fail against the original draft — tests that cannot catch the defect prove nothing.',
    checkpoints: [
      { id: 'c1', title: 'SLI and error budget', resumeInstructions: '`bash ' + DIR + 'L22/setup.sh` keeps work/. Your SLI and budget are in work/slo.json; the month of traffic is work/month.json.' },
      { id: 'c2', title: 'Rules and tests', resumeInstructions: 'Rules in work/rules/beacon-slo.rules.yml, tests in work/tests/. Run `docker run --rm --network none -v "$PWD/' + DIR + 'L22/work:/w:ro" --entrypoint promtool prom/prometheus:v3.5.0 test rules /w/tests/beacon-slo.test.yml`. reset.sh restores the draft (your rules kept as .bak).' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/common.sh', 'assets/drafts/', 'assets/acceptance/acceptance.test.yml', 'assets/months.json', 'assets/slo-template.json', 'starter/tests/beacon-slo.test.yml', 'solution/', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# Docker running (promtool comes from the pinned prom/prometheus:v3.5.0 image)', 'bash ' + DIR + 'L22/setup.sh'],
    faultInjection: ['# setup.sh wrote the variant-a draft; to choose explicitly (rules and month fixture only):', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L22/inject.sh'],
    tasks: ['Before reading the draft, write in work/slo.json which requests are eligible, which are bad and what you exclude, with reasons.', 'Compute eligible, bad, allowed bad, budget consumed and remaining from work/month.json, and write the release/on-call decision it implies.', 'Write promtool tests named for the four scenarios (missing, spike, burn, zero) and watch them fail against the draft.', 'Fix the recording rules and alerts: multi-window multi-burn-rate (1h and 5m at 14.4x; 6h and 30m at 6x), no-data separate from zero, zero traffic fires nothing.', 'Run validate.py (acceptance tests, your tests, tests against the draft, budget) and import the evidence.'],
    validation: [
      { id: 'promtool', description: 'the pinned image runs promtool', critical: true },
      { id: 'rules-check', description: 'promtool check rules accepts your rules', critical: true },
      { id: 'rule-names', description: 'the 13 recording rules and 3 alerts of the contract exist', critical: true },
      { id: 'acceptance', description: 'acceptance tests pass: numerator/denominator, no-data, spike, fast and slow burn, zero traffic', critical: true },
      { id: 'own-tests-pass', description: 'your tests pass against your rules', critical: true },
      { id: 'own-tests-cover', description: 'your test groups cover missing, spike, burn and zero, with alert-state checks', critical: true },
      { id: 'own-tests-catch', description: 'your tests fail against the original draft for your variant', critical: true },
      { id: 'budget', description: 'budget numbers match the month fixture', critical: true },
      { id: 'sli-definition', description: 'numerator, denominator and exclusions written; health checks and 4xx excluded', critical: true },
      { id: 'decision', description: 'a budget decision is written (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L22/reset.sh   # restore the draft and month fixture; your rules kept as .bak'],
    teardown: ['bash ' + DIR + 'L22/teardown.sh   # removes work/ only; the Prometheus image is kept'],
    evidenceInstructions: ['`python3 ' + DIR + 'L22/validate.py`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Paste evidence/latest.json here; the worksheet decision is used as the explanation.'],
    hints: [
      { level: 1, text: 'An SLI is a ratio of events: decide which events are eligible and which are bad before reading any PromQL. A health check is not a user; a request the caller got wrong is not your failure. Then ask whether "no data" is the same as "zero errors".' },
      { level: 2, text: 'promtool test rules is your clock: six hours of history run in milliseconds. Evaluate each recording rule on a fixture whose answer you know, and read alert state from ALERTS{alertstate="firing"}.' },
      { level: 3, text: 'Feed the draft four fixtures — counter missing, a 3-minute spike after 6 healthy hours, 10% errors for 70 minutes, health checks and 4xx only — and note which alert is wrong in each. A ratio that exists when the counter does not, or is empty when there are no errors, points at the defect.' },
      { level: 4, text: 'Variant A: eligible excludes /healthz|/metrics and 4xx, bad is 5xx only, errors need `or 0 * beacon:sli_eligible:rateX`. Variant B: fast burn needs 1h and 5m above 14.4*0.005 for 2m, remove `or vector(0)`, and BeaconSLINoData is absent(beacon_http_requests_total{job="beacon"}) for 10m. Budget: allowed = 0.005 x eligible.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T01', 'T14'], status: 'validated',
    variant: { brief: 'In week 34, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L22/reset.sh` (or variant-a): run your existing tests against the new draft before changing anything, add the scenario that would have caught it, recompute the new month\'s budget (one month is overspent), validate with `--variant variant-b --assistance independent --out ' + DIR + 'L22/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L22/reset.sh' },
    limits: ['Deterministic fixtures and the real promtool: proves SLI arithmetic, burn-rate logic, no-data handling and rule tests; not scraping, Alertmanager routing or paging, rule performance on real data, or that 99.5% is the right objective.', 'Executed during development on Linux amd64 with promtool 3.5.0 (prom/prometheus:v3.5.0 via Docker): both variants ran setup → validate FAIL → fix → validate PASS (10/10), plus reset → validate FAIL and teardown; a partial variant-b fix that kept `or vector(0)` failed the acceptance tests. Not run on macOS.']
  });

  lab({
    id: 'L23', moduleId: 'M12', title: 'Query plans, a held lock and an exhausted pool on PostgreSQL 16',
    objectiveIds: ['obj-m12-01', 'obj-m12-02'], executionMode: 'local', estimatedMinutes: 130, environmentProfile: 'compose', prerequisites: ['L14'],
    learnerBrief: 'Beacon\'s readings live in PostgreSQL 16 (compose project looped-l23, a deterministic synthetic dataset of 200 000 readings). The sensor history page times out: read the slow query\'s plan, add the index that fits it, and explain the plan change and when an index would not help.\n\nLater the same day the API\'s writes stop landing and its pool reports exhaustion; someone suggests restarting the database. Find the session the writes are waiting for using pg_stat_activity, pg_locks and pg_blocking_pids(), end only that session, and make sure the twelve queued updates land exactly once — without touching a long-running report that only looks guilty.',
    checkpoints: [
      { id: 'c1', title: 'Plans and an index', resumeInstructions: '`bash ' + DIR + 'L23/setup.sh` keeps the dataset; `docker exec -it looped-l23-db psql -U beacon -d beacon`. The ticket query is work/ticket-query.sql; notes in evidence/L23-notes.md. Do c1 before inject.sh.' },
      { id: 'c2', title: 'Locks and the pool', resumeInstructions: 'Run `bash ' + DIR + 'L23/inject.sh` (fixture sessions do not survive a database restart; run it again after a reboot). `reset.sh` stops the fixtures and reloads the dataset, dropping your indexes.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/compose.yaml', 'assets/common.sh', 'assets/seed.sql', 'assets/pgmini.py', 'assets/poolclient.py', 'assets/fixture_sessions.py', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# Docker running; postgres:16.4 and python:3.12.7-slim pinned by digest', 'bash ' + DIR + 'L23/setup.sh', 'cat ' + DIR + 'L23/work/TICKET.md'],
    faultInjection: ['# c2 (after the index): start the fixture sessions and the pooled write path', 'bash ' + DIR + 'L23/inject.sh', '# another variant (different query and lock): LOOPED_VARIANT=variant-b bash ' + DIR + 'L23/reset.sh'],
    tasks: ['EXPLAIN (ANALYZE, BUFFERS) the ticket query and paste it under Plan before; name the scan, rows read versus returned and buffers.', 'Choose and create an index (columns and order justified), EXPLAIN again, and name a query where an index would not help.', 'After inject.sh, collect evidence from the pool log, pg_stat_activity, pg_blocking_pids(), pg_locks and the server log; write blocker_pid and why the other long session is not it.', 'Terminate only the blocking session; confirm the waiting writes commit and nothing else was killed.', 'Run validate.py and import the evidence.'],
    validation: [
      { id: 'db-up', description: 'looped-l23-db answers and runs PostgreSQL 16', critical: true },
      { id: 'dataset-intact', description: 'the seeded readings keep the checksum recorded at setup', critical: true },
      { id: 'plan-uses-index', description: 'the ticket query reads readings through an index', critical: true },
      { id: 'plan-cheaper', description: 'planner cost at most 10% of the baseline', critical: true },
      { id: 'index-fits', description: 'the used index leads with the equality column; at most two new valid indexes', critical: true },
      { id: 'before-plan', description: 'notes contain the sequential-scan plan (advisory)', critical: false },
      { id: 'fault-ran', description: 'inject.sh ran (checkpoint c2 started)', critical: true },
      { id: 'no-lock-waits', description: 'no session waits on a lock', critical: true },
      { id: 'blocker-ended', description: 'the lock holder is gone', critical: true },
      { id: 'blocker-named', description: 'blocker_pid in the notes is that session', critical: true },
      { id: 'report-kept', description: 'the long report session was not terminated', critical: true },
      { id: 'pool-kept', description: 'the pool\'s original connections were not terminated', critical: true },
      { id: 'intended-writes', description: 'all twelve updates committed exactly once; sensors show the last status', critical: true },
      { id: 'notes', description: 'notes sections have substance (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L23/reset.sh   # stop fixtures, end their sessions, reload the dataset (same variant)'],
    teardown: ['bash ' + DIR + 'L23/teardown.sh   # removes the looped-l23 project, its volume and work/'],
    evidenceInstructions: ['`python3 ' + DIR + 'L23/validate.py --explanation-file ' + DIR + 'L23/evidence/L23-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Paste evidence/latest.json here; the dataset is synthetic and the database password is a lab placeholder.'],
    hints: [
      { level: 1, text: 'Two different slownesses: a query that does too much work (the plan) and work that cannot start because something holds what it needs (a lock). Decide which you are looking at before changing anything; never fix either by deleting data or restarting.' },
      { level: 2, text: 'EXPLAIN (ANALYZE, BUFFERS): node type, rows, Rows Removed by Filter, buffers. For waits: pg_stat_activity (state, wait_event_type, xact_start), pg_blocking_pids(pid), pg_locks (mode, granted), docker logs looped-l23-db (log_lock_waits is on) and docker logs looped-l23-pool.' },
      { level: 3, text: 'Which columns are compared with =, which with a range or ORDER BY — does your index put them in that order? Of the two long-running sessions, which appears in the waiters\' pg_blocking_pids(), and what is its state: active, or idle in transaction?' },
      { level: 4, text: 'c1: variant A (sensor_id, ts); variant B (site, status, ts) or (site, ts) WHERE status = \'fault\'. c2: the beacon-backfill session is idle in transaction holding the lock (row locks in A, SHARE on status_events in B): SELECT pg_terminate_backend(<its pid>) only; leave beacon-report and the pool alone; write blocker_pid in the notes.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T09', 'T16'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L23/reset.sh` (or variant-a): a different ticket query needs a different index and inject.sh takes a different kind of lock. Rewrite every notes section and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L23/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L23/reset.sh' },
    limits: ['A 200 000-row synthetic table in one container: proves plan reading, index choice and lock/pool diagnosis with real PostgreSQL 16 behaviour; not production size or concurrency, vacuum and bloat, replication, PgBouncer or managed-database tooling.', 'Executed during development on Linux amd64 with postgres:16.4 and Docker Compose v2: both variants ran setup → validate FAIL → index → inject → validate FAIL → terminate the blocker → validate PASS (14/14), plus reset → validate FAIL and teardown. Terminating every long-running session failed report-kept and pool-kept. Not run on macOS / Apple Silicon.']
  });

  lab({
    id: 'L24', moduleId: 'M12', title: 'Backups you have restored, and deliveries that cannot happen twice',
    objectiveIds: ['obj-m12-03', 'obj-m12-04'], executionMode: 'local', estimatedMinutes: 150, environmentProfile: 'compose', prerequisites: ['L23'],
    learnerBrief: 'Recovery drill before a schema migration: restore Beacon\'s data from this morning\'s backup into a fresh, disposable PostgreSQL 16 database and prove that what came back is what the source holds — row counts, checksums, selected values and sequences, with assets/verify_restore.py — and measure how long recovery actually took, start to verified.\n\nThen a downstream team reports duplicate notifications after a worker restart. The queue is a table in PostgreSQL with leases (at-least-once by design). Make a second delivery of the same message impossible without losing any message; the validator replays fresh messages with a producer duplicate and two fixture-controlled crashes to check it.',
    checkpoints: [
      { id: 'c1', title: 'Restore and prove it', resumeInstructions: '`bash ' + DIR + 'L24/setup.sh` keeps the source; backups are in work/backups/, the clock in work/recovery.json (`python3 ' + DIR + 'L24/assets/recovery_clock.py show`). The restore target is tmpfs: it is empty after a restart, by design.' },
      { id: 'c2', title: 'Idempotent delivery', resumeInstructions: 'Your worker is work/worker.py (`docker restart looped-l24-worker` after edits). `reset.sh` reloads everything and saves your worker as work/worker.py.bak.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/compose.yaml', 'assets/common.sh', 'assets/schema.sql', 'assets/today.sql', 'assets/pgmini.py', 'assets/verify_restore.py', 'assets/recovery_clock.py', 'assets/notes-template.md', 'starter/worker.py', 'solution/', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# Docker running; Python 3.9+ on the host for verify_restore.py', 'bash ' + DIR + 'L24/setup.sh', 'bash ' + DIR + 'L24/inject.sh', 'cat ' + DIR + 'L24/work/TICKET.md'],
    faultInjection: ['# inject.sh damages this morning\'s backup and enqueues twenty messages with one worker crash (variant-b adds producer duplicates):', 'bash ' + DIR + 'L24/inject.sh', '# another variant: LOOPED_VARIANT=variant-b bash ' + DIR + 'L24/reset.sh && bash ' + DIR + 'L24/inject.sh'],
    tasks: ['Start the recovery clock, inspect the backups (sizes, pg_restore --list, a test restore) and decide what to restore from.', 'Create a fresh restore target, restore with --exit-on-error, verify with verify_restore.py --report and stop the clock with the report and the backup file.', 'State RPO and RTO with numbers against D04 (15 min / 60 min), honestly.', 'Find how messages were delivered twice (ledger rows per key, job attempts, restart count) and move the existing duplicates aside.', 'Add a UNIQUE constraint on ledger.deliveries(idempotency_key), make the worker insert with ON CONFLICT DO NOTHING (keep the lab fault hook), restart it.', 'Run validate.py (it replays fresh messages with crashes) and import the evidence.'],
    validation: [
      { id: 'source-intact', description: 'the source still holds 58 000 records with the setup checksum', critical: true },
      { id: 'damaged-flagged', description: 'the restore came from a readable backup that is not the damaged one', critical: true },
      { id: 'restore-fresh', description: 'the restore target was created after the recovery clock started', critical: true },
      { id: 'restore-matches', description: 'target equals source: counts, checksums, sampled values, sequences', critical: true },
      { id: 'recovery-measured', description: 'the measured interval agrees with the verification report', critical: true },
      { id: 'worker-running', description: 'looped-l24-worker is running', critical: true },
      { id: 'unique-key', description: 'UNIQUE constraint or index on ledger.deliveries(idempotency_key)', critical: true },
      { id: 'no-duplicates', description: 'no key delivered more than once', critical: true },
      { id: 'all-delivered', description: 'every enqueued message delivered exactly once, no job stuck', critical: true },
      { id: 'replay-test', description: 'fresh messages with a duplicate and crashes before/after the effect are each delivered once', critical: true },
      { id: 'notes', description: 'notes sections with RPO/RTO numbers (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L24/reset.sh   # reload source and backups, remove the restore target, starter worker back (yours as .bak)'],
    teardown: ['bash ' + DIR + 'L24/teardown.sh   # removes the looped-l24 project, its volume and work/ (including backups)'],
    evidenceInstructions: ['`python3 ' + DIR + 'L24/validate.py --explanation-file ' + DIR + 'L24/evidence/L24-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Paste evidence/latest.json here; DSNs in it are redacted (no password) and the data is synthetic.'],
    hints: [
      { level: 1, text: 'A backup is a claim until it has been restored somewhere fresh and compared with the source. A delivery is at-least-once until something makes the effect idempotent. For each half, decide what evidence would prove it before running a fix.' },
      { level: 2, text: 'ls -l work/backups/, pg_restore --list (only the table of contents), a test restore into looped-l24-restore and verify_restore.py. For deliveries: ledger.deliveries grouped by idempotency_key, queue.jobs.attempts, the worker log and its restart count.' },
      { level: 3, text: 'Does pg_restore exit 0? Does every table match, or only some? For a duplicated key: one job row with attempts = 2 (redelivery after a crash) or two job rows (the producer sent it twice)? A fix for only one of those is not a fix.' },
      { level: 4, text: 'The morning dump is damaged (A truncated, B altered bytes): take a fresh pg_dump -Fc from the live source, restore with --exit-on-error into a newly created target, verify, stop the clock. Deliveries: move extra rows aside, add UNIQUE (idempotency_key) on ledger.deliveries, insert with ON CONFLICT (idempotency_key) DO NOTHING, keep lab_fault(), restart the worker.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T09', 'T24', 'T16'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L24/reset.sh` then inject.sh (or variant-a): the backup fails differently and the duplicates come from a different mix of causes. Measure the drill again and compare the intervals; validate with `--variant variant-b --assistance independent --out ' + DIR + 'L24/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L24/reset.sh && bash ' + DIR + 'L24/inject.sh' },
    limits: ['A few MB of synthetic data on one machine: proves a verified logical backup/restore with a measured interval and exactly-once effects over at-least-once delivery via a database constraint; not physical backups, PITR/WAL archiving, replication or failover, restore time at real sizes, or cross-system idempotency. The ledger is a table in the same database.', 'Executed during development on Linux amd64 with postgres:16.4 and Docker Compose v2: both variants ran setup → inject → validate FAIL → restore/verify/clock + constraint/worker fix → validate PASS (11/11), plus reset → validate FAIL and teardown; restoring the damaged dump and deleting duplicates without a constraint failed. verify_restore.py exit codes 0/1/2 observed. Not run on macOS / Apple Silicon or against a cloud database (C04).']
  });
})();
