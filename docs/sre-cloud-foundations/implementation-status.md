# Implementation status — SRE & Cloud Deployment Foundations

Status words used everywhere in this track:

- **authored-spec** — content written; nothing executable ships for it.
- **implemented** — executable assets exist and their static/fixture/unit checks pass.
- **runtime-validated** (`validated` in lab records) — executed end to end (setup → fault →
  validator FAIL → fix → validator PASS → reset/teardown) in the environment named below.
- **execution-not-tested** (lab records) — implemented, but the full cycle needs an
  environment the authoring container could not provide; what *did* run is in the lab's
  `limits` field and below.

Where it ran: a Linux amd64 cloud container (Docker 29.8.2 + Compose v5.6.0, PostgreSQL 16.4
images, Terraform 1.13.3, Helm v3.18.6, kubeconform v0.7.0, Python 3), with
`LOOPED_ALLOW_ANY_LINUX=1` for the host labs. **Nothing was run on Apple Silicon, inside Lima,
on Docker Desktop, on a kind cluster, or in a cloud account.**

## Increments

| # | Scope | State |
|---|---|---|
| 1 | audit, plan, schema v3 with snapshot/rollback, track registration, validators | complete |
| 2 | hub navigation, diagnostic, evidence model, M01–M04 content, L01–L08, S01–S08 | complete |
| 3 | M05–M08, Beacon/Compose/kind assets, L09–L16, S09–S16, D01 | complete |
| 4 | M09–M12, kind-policy profile, delivery, telemetry, data, L17–L24, S17–S24, D02–D04 | complete |
| 5 | M13–M16, capstone, final assessment, L25–L32, S25–S32, D05–D06 | complete |
| 6 | B01–B08, C01–C05 opt-in, review queue, role coverage, QA, docs | complete |

"Complete" means authored, wired into the app and passing the validators below — not that
every lab was executed (see the lab table).

## Activity inventory

| Kind | Ids | Count | State |
|---|---|---|---|
| Modules / weeks / hours | M01–M16 | 16 / 48 / 168 | implemented |
| Lessons | `les-m01-01` … `les-m16-03` | 77 | implemented (validator-checked structure, sources, recall) |
| Question bank / unseen gate variants | `q-mNN-bKK` / `q-mNN-gKK` | 162 / 80 | implemented |
| Delayed-review prompts (1/7/21/45 days, capped queue) | `rev-mNN-KK` | 49 | implemented |
| Baseline diagnostic | 24 questions, 2 investigations, 1 Python attempt | 1 | implemented |
| Simulated incidents | S01–S32 | 32 (78 seeded variants) | implemented; all played by the harness |
| Design workshops | D01–D06 | 6 | implemented (worksheet, rubric, reference) |
| Local labs | L01–L32 | 32 | 23 runtime-validated, 9 execution-not-tested (table below) |
| Environment profiles | linux-arm64, workstation, compose, kind-basic, kind-policy, observability | 6 | see lab table for what ran |
| Role branches | B01–B08 | 8 | authored-spec (exercises written, no shipped lab directories) |
| Cloud extensions | C01–C05 | 5 | authored-spec, disabled by default; C01/C02 Terraform `validate`-clean, never applied |

### Labs

| Lab | Module | Profile | Status | What ran in the authoring container |
|---|---|---|---|---|
| L01 | M01 | linux-arm64 | validated | both variants; unsafe chmod rejected |
| L02 | M01 | linux-arm64 | validated | both variants (5/11 → 11/11); `--theirs` shortcut rejected |
| L03 | M02 | linux-arm64 | execution-not-tested | scripts and validator statically checked; **needs real systemd** (none in the container) |
| L04 | M02 | linux-arm64 | validated | three variants on a capped loop filesystem; mass delete / pkill rejected |
| L05 | M03 | linux-arm64 | validated | three variants in network namespaces with the shipped stdlib DNS server |
| L06 | M03 | linux-arm64 | validated | three variants with the shipped TLS proxy; trust-anchor and `-k` shortcuts rejected |
| L07 | M04 | linux-arm64 | validated | both variants; learner tests run against 7 mutants |
| L08 | M04 | linux-arm64 | validated | both variants; blind retries and token logging rejected |
| L09 | M05 | workstation | validated | three variants with `archcheck.py` |
| L10 | M05 | workstation | validated | three variants with the (labelled incomplete) IAM evaluator |
| L11 | M06 | workstation | validated | three variants, Terraform local/random providers |
| L12 | M06 | compose | validated | three variants, kreuzwerker/docker 4.6.0; container import forces replacement (documented) |
| L13 | M07 | compose | validated | three variants; image built from hash-checked wheels |
| L14 | M07 | compose | validated | three variants; readiness shortcut rejected |
| L15 | M08 | kind-basic | execution-not-tested | kubeconform on all manifests/variants; validator against canned kubectl output |
| L16 | M08 | kind-basic | execution-not-tested | as L15; in-cluster client tested against a local Beacon container |
| L17 | M09 | kind-basic | execution-not-tested | kubeconform; dataset checksum and OOM workload exercised in Docker |
| L18 | M09 | kind-policy | execution-not-tested | kubeconform; DB probe against a real postgres container; Calico manifest SHA-256 recorded |
| L19 | M10 | kind-basic | execution-not-tested | `helm lint` ×3 environments, 62/62 render assertions, schema rejects 5 invalid fixtures |
| L20 | M10 | kind-basic | execution-not-tested | local CI stages for all variants (tests gate, digest, mutable-tag detection, schema-rollback refusal); drift step needs a cluster |
| L21 | M11 | observability | validated | both variants after a worker restart (7/15 → 15/15) |
| L22 | M11 | workstation | validated | both variants with real `promtool` in the pinned Prometheus image |
| L23 | M12 | compose | validated | both variants on PostgreSQL 16.4 |
| L24 | M12 | compose | validated | both variants; restore ≈ 9 s measured; `verify_restore.py` used by C04 |
| L25 | M13 | compose | validated | both variants (re-run after restart) |
| L26 | M13 | compose | validated | three variants (tampered, missing image, untrusted key) |
| L27 | M14 | compose | validated | both variants; bounded load, ≈ 38 writes/s goodput after tuning, 0 duplicates |
| L28 | M14 | compose | validated | both variants; stale recovery point rejected |
| L29 | M15 | workstation | validated | three variants with `xlate.py` |
| L30 | M15 | workstation | validated | five tickets against the local API fixture |
| L31 | M16 | kind-basic | execution-not-tested | dry check from a clean copy, image build, kubeconform (23 resources), promtool, seed + restore verification |
| L32 | M16 | kind-basic | execution-not-tested | draw determinism, report validator on templates/sample/negative cases, selective restore on PostgreSQL |

## Test commands and latest results

Run from the repository root. Latest full run: **26/26 suites passed** (`npm test`).

| Command | Result |
|---|---|
| `node tools/build.js --check` | index.html and sw.js current (121 assets) |
| `node tests/data/test-sre-content.js` | 6414 checks passed, 0 failed |
| `node tests/data/test-sre-scenarios.js` | 1182 checks passed across 32 scenarios (ladder, alternative path, verify-first, typed text, unsafe demos, reset determinism incl. cluster model, variants, honest unknown command) |
| `node tests/data/test-sre-labs.js` | 2958 checks passed across 32 lab directories (+ `bash -n`, `py_compile`, guards, no broad deletes, no `:latest`, no credentials) |
| `node tests/data/test-sre-store.js` | 24 checks passed (migration, snapshot, rollback) |
| `node tests/ui/test-sre.js` | 201 checks passed (390 and 834 px: sections, overflow, names, ids; diagnostic, persistence, gate, evidence import, scenario, unsafe shortcut, design, cloud opt-in, migration + rollback) |
| other data suites (`content`, `check-marks`, `test-missions`, `test-strict`, `test-k8s-model`, `test-kind-assets`, `test-onsite-*`, `test-python`) | all pass |
| other UI suites (`test-a11y`, `test-flow`, `test-nav`, `test-onsite`, `test-tracks`, …) | all pass |

## Known limitations and open items

- **No cluster runs.** kind cannot create clusters in the authoring container (nested runc
  fails), so L15–L20, L31 and L32 are execution-not-tested. First thing to do on a Mac: run
  `profiles/kind-basic/setup.sh` and each of those labs, then update this table.
- **L03 needs systemd**, which the container lacks; it runs only inside the Lima VM.
- **Apple Silicon is untested.** Images are multi-arch and builds use arm64 wheels, but no
  arm64 host executed anything.
- **Cloud extensions never ran.** C01/C02 pass `terraform validate`; C03–C05 are instructions.
  Cost lines are order-of-magnitude notes from authoring time, not quotes.
- **Branches B01–B08 are specs**: exercises with steps and pass criteria, no lab directories.
- **Metric names differ between labs.** L22's rules (`beacon_http_*`) and L21's dashboard
  (`beacon_l21_*`) use their own fixture names; the shipped Beacon exports
  `beacon_requests_total` / `beacon_request_duration_seconds`. L31 makes the learner adapt
  copies and checks it; unifying the names would be a worthwhile follow-up.
- **L26 residual shortcut.** Deploying PostgreSQL from the engine's local cache passes the layer
  comparison (identical content); only the internal-registry-reference check catches it.
- **Simulations are bounded models.** Each scenario lists its simplifications; the sandbox
  says "not supported in this simulation" for anything outside its grammar.
- **Self-review.** Explanations, teach-backs and design rubrics are self-rated (labelled so in
  evidence); deterministic checks decide practical passes. No AI feedback is used as authority.
- **Docker Hub rate limits** hit during authoring; the observability profile accepts
  `LOOPED_PROM_IMAGE=quay.io/prometheus/prometheus:v3.5.0`.

## Engine changes made while building the track (shared with other tracks)

`assets/js/shell.js`: sed addresses/ranges/BRE/back-references/per-file `-i`, BRE grep,
`printf`, `chgrp`, comment lines, `ls` one-per-line into pipes, bash-like escapes inside double
quotes, a per-command world tick for simulator state, `LXShell.builtin()`.
`assets/js/k8s-kubectl.js`: merge patches that drop a container image are rejected; column-0
YAML comments parse. `assets/js/app.js`: hopping between two track home pages keeps the
displaced view. All pre-existing suites still pass.

## Where to start

1. `docs/sre-cloud-foundations/setup.md` — what to install per profile, first hour.
2. In the app: switch track to **SRE & Cloud Deployment Foundations** → **Baseline** → **Path**.
3. `docs/sre-cloud-foundations/authoring-guide.md` before changing content; run
   `npm run test:data` after every change.
