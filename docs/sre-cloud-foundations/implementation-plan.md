# Implementation plan — SRE & Cloud Deployment Foundations track

Scope: the embedded curriculum specification v1.0 (16 modules, 48 learning weeks, 168 hours,
L01–L32, S01–S32, D01–D06, B01–B08, C01–C05, diagnostic, reviews, capstone). This file is the
plan; `implementation-status.md` is the live record of what is done, tested and limited.

## Architecture decisions (adapted to the existing app)

1. **One new track**, id `sre`, registered in `assets/js/data/tracks.js` with its own category
   map. Its content files are `assets/js/data/sre-*.js` and are lazily loaded like every other
   non-default track. No second app, no framework, no build change.
2. **Track-scoped hub page** `#view-sre` rendered by `assets/js/sre.js`, following the onsite
   `Prep` pattern (sections rendered from content records; state in one storage key). Sections:
   Path (current module/week, next session, prerequisites, effort, reviews due, evidence
   remaining), Map (compact curriculum map), Diagnostic, Modules (lessons → recall → lab →
   scenario → gate → debrief), Labs (local lab specs and evidence import), Designs, Reviews,
   Evidence (tiers, role coverage), Branches, Cloud (opt-in, disabled by default), Setup.
3. **Content entities** (stable ids, versioned, separate from attempts):
   `LX.sreTrack`, `LX.sreModules`, `LX.sreWeeks`, `LX.sreObjectives`, `LX.sreLessons`,
   `LX.sreQuestions`, `LX.sreLabs` (LabSpec L01–L32), missions with an `sre` block (S01–S32),
   `LX.sreDesigns`, `LX.sreDiagnostic`, `LX.sreReviews`, `LX.sreBranches`, `LX.sreCloud`,
   `LX.sreSources`, `LX.sreRoles`. Validated by `tests/data/test-sre-content.js` (schema,
   referential integrity, acyclic prerequisites, hours = 168, every id referenced).
4. **Attempts/evidence** in `lx.sre` (`LXStore.KEYS`), shaped after the spec's `Attempt`:
   `{ id, activityId, contentVersion, seed, mode, assistance, startedAt, completedAt,
   hintsUsed, checks, explanation, reviewer, evidenceRefs, cleanupStatus }`. Content version
   changes never delete attempts; they mark `revalidationNeeded`.
5. **Simulator**: scenarios are sandbox missions. Kubernetes scenarios use the existing
   reconciling cluster model (extended with NetworkPolicy evaluation). Other domains use
   `assets/js/sre-sim.js`: deterministic seeded state per scenario, bounded verbs supplied through
   the world's `extra` hook (terraform, helm, dig, openssl, aws, psql, git, docker, promtool,
   cosign, python3 fixtures …), state-derived output, mutation rules, a logical clock, honest
   "not supported" answers, reset to the same seed and `retry-independent` with a new seed.
6. **Local labs** live in `labs/sre-cloud-foundations/` with `beacon/` (starter service),
   `profiles/` (linux-arm64, compose, kind-basic, kind-policy, observability), `lib/` (shared
   shell helpers and the Python evidence/validation library) and `L01/…/L32/`. Every lab:
   README, assets, `setup.sh`, `inject.sh` (when relevant), `validate.py` (queries real state,
   non-zero exit on failure, writes an evidence JSON), `reset.sh`, `teardown.sh`,
   `SOLUTION.md`, `VARIANT.md`, `hints.md`, `evidence-example.json`. Design labs validate a
   worksheet against a rubric.
7. **Grading**: deterministic for state/fixtures/calculations; explicit 0–4 rubrics with
   structured self-review for explanations/designs, labelled "self-reviewed". No AI grading is
   a prerequisite for anything.
8. **Reviews**: `LX.sreReviews` prompts scheduled at 1/7/21/45 days after the first evidence for
   an objective, persisted in `lx.sre.reviews`, capped session queue, history kept on
   reschedule, `lastDemonstratedAt` recorded.

## Increments

| # | Deliverable | Validation |
|---|---|---|
| 1 | Audit, plan, status; `sre` track registered; `lx.sre` + schema v3 with backup/rollback; content validator; hub skeleton | `npm run test:data`, store tests |
| 2 | Full hub navigation, diagnostic, evidence model, simulator engine, M01–M04 (lessons, banks, gates), L01–L08, S01–S08 | validators, scenario tests (solvable, wrong fix rejected, reset), lab fixture/unit tests, Python unit tests |
| 3 | Beacon starter app, compose + kind-basic profiles, M05–M08, L09–L16, S09–S16, D01 | as above; compose/kind execution where a daemon is available |
| 4 | M09–M12, kind-policy + observability profiles, Helm chart, CI/GitOps local equivalents, L17–L24, S17–S24, D02–D04 | as above; helm lint/template, promtool-style rule tests via fixtures |
| 5 | M13–M16, capstone, L25–L32, S25–S32, D05–D06, final assessment | as above |
| 6 | B01–B08 specs with starter exercises, C01–C05 opt-in UX, review queue, role coverage, a11y pass, docs (setup, troubleshooting, version matrix), final status | full `npm test`, UI suites |

## Out of scope (by the specification)

A real command runner in the browser, cloud provisioning by default, AI grading as a pass
authority, any claim of production experience or accreditation.
