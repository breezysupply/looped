# Repository audit and integration map — SRE & Cloud Deployment Foundations

Date: 2026-10-13. Branch base: `claude/linux-commands-study-guide-wo3tpu` (the LOOPED
application). `main` holds only the initial README; the app has never been merged to it.

## What LOOPED is

| Aspect | Finding |
|---|---|
| Framework | None. Static offline PWA: `index.html`, plain ES5 JS IIFEs registering `window.LX*` singletons, no bundler. `tools/build.js` regenerates the `<script>` tags, `sw.js` asset list and per-track counts. |
| Backend / auth | None. No accounts. |
| Persistence | `localStorage` under `lx.*` keys, owned by `assets/js/store.js` (schema version in `lx.schema`, migrations keyed by target version, export/import as JSON text). Schema was v2 before this track. |
| Routing | Four bottom tabs (Learn, Practice, Quiz, Review) with per-group sub-pages; a track can add a track-scoped page (the onsite track adds `Prep`). View ids are `#view-<name>` sections. |
| Design system | `assets/css/style.css`: tokens (`--bg`, `--accent`, …), `.card`, `.badge`, `.chip`, `.btn`, `.term`, `.prep-*`, `.path-*`, `.scorecard`, `.tiers` tables; dark default, light theme; 390 px phone layout asserted by UI tests. |
| Quiz engine | `assets/js/quiz.js`: mcq (`LX.quiz`), read-the-output (`LX.outputQs`), safe-or-not (`LX.dangerQs`), order (generated from scenarios/labs), build (generated from commands). Scoped to the active track. |
| Drills / review | `LX.drills` cards with stars and spaced review (SM-2 lite, `lx.cards`). |
| Terminal simulator | `assets/js/shell.js`: Linux shell with VFS, ~70 commands, pipes, redirects, loops; world seed carries files, procs, units (with `validate`/`onStart` hooks), sockets, journal, disks, and **`extra`** (mission-specific binaries that take precedence over built-ins). `assets/js/sandbox.js` is the typed terminal UI with objectives checked by evidence (`did(cmdRe, outRe)`), hint ladders, reveals, reset, debrief. |
| Cluster simulator | `assets/js/k8s-model.js`: deterministic reconciling model (Deployments/ReplicaSets/Pods, scheduler, kubelet with probes/OOM/crash loops, PVC binding, RBAC, registries, image signature admission, `reachable` hosts, `dnsBroken`). `assets/js/k8s-kubectl.js`: bounded kubectl (`get/describe/logs/events/rollout/set/scale/label/patch/apply/create/delete/auth/top/exec/cordon/drain`) with honest "not supported" answers. |
| Incident scenarios | Onsite track: 10 missions with `onsite` block (guided/independent modes, neutral tickets, spoilers, hint ladder conceptual → diagnostic → explicit, qualitative scorecard). |
| Real labs | `labs/kind/` (10 kind labs; dedicated cluster `looped-onsite`, context-pinned `k()` wrapper, preflight, label-scoped reset, teardown refusing other clusters; execution record in `EXECUTION.md`). `labs/python/` (3 exercises: starter + tests + solution + broken variants). |
| Tests | `tests/run.js` runs `tests/data/*.js` (node validators, ~2 s) and `tests/ui/*.js` (Playwright). CI runs both. Baseline on this branch: 9/9 data suites pass, build check current. |

## Runtime constraints

- Static only. No command runner, no server. Local labs are **downloadable assets plus an
  evidence import form**, never a web terminal pretending to run Docker/Terraform/kind.
- Offline-first: every content file must be claimed by a track in `data/tracks.js` and is
  precached by `sw.js`.
- Browser sandbox: no `eval` of learner code; Python exercises run locally with unittest.
- This development container: node 22, python 3.13 (stdlib only), Docker CLI **without a
  daemon**, no kind/kubectl/terraform/helm installed (downloads are reachable). What was and was
  not executed is recorded in `implementation-status.md` and `docs/sre-cloud-foundations/version-matrix.md`.

## Reusable content → new objective IDs

Existing descriptions of "planned" tracks are not proof of content; this table lists only what
exists in the repository today.

| Existing asset | Reuse in this track | Mapped objectives |
|---|---|---|
| `k8s-model.js` + `k8s-kubectl.js` | Engine for S15–S18 (and the Kubernetes parts of S19, S26, S31). Extended with a NetworkPolicy model for S18. | `obj-m08-*`, `obj-m09-*` |
| Onsite labs `ons-lab-02` (ImagePull), `ons-lab-04` (probes), `ons-lab-05` (Pending), `ons-lab-06` (CrashLoop/config), `ons-lab-09` (RBAC), `ons-lab-10` (disconnected) | Patterns and model seeds adapted into S15, S16, S17, S18, S26 with Beacon as the service. Not copied verbatim: Beacon replaces storefront/payments. | `obj-m08-04`, `obj-m08-05`, `obj-m09-01`, `obj-m09-04`, `obj-m13-05` |
| `labs/kind/lib/common.sh`, `preflight.sh`, label-scoped reset, teardown | Harness conventions copied into `labs/sre-cloud-foundations/lib/` with the new cluster names (`looped-foundations`, `looped-policy`). | `obj-m08-01` |
| `labs/python/02-retry` | Referenced as optional extra practice from M04 (retry/backoff); L08 authors its own client. | `obj-m04-05` |
| `labs/python/01-pod-health` | Optional practice after M08. | `obj-m08-03` |
| `labs/python/03-artifact-manifest` | Optional practice before L26 (manifest/checksum verification). | `obj-m13-04` |
| Linux track missions (`m-disk`, `m-nginx`, `m-bind`, `m-ssh`, `m-slow`) | Linked as optional sandbox reps from M02 (disk/inodes, services, listening sockets). | `obj-m02-*` |
| Containers track missions (`cn-m-svc`, `cn-m-crashloop`, `cn-m-pending`, `cn-m-imagepull`, `cn-m-dns`) | Linked as optional reps from M07/M08. | `obj-m07-*`, `obj-m08-*` |
| IaC track (`iac-*`): playbooks, drills, labs | Linked as optional reading; its DynamoDB-locking wording is marked historical in the M06 backend lesson (Terraform now documents `use_lockfile`, DynamoDB deprecated; source T03). | `obj-m06-04` |
| AWS track (`aws-*`) | Linked as optional reference from M05; no content copied. | `obj-m05-*` |
| Onsite lessons `les-reconcile`, `les-probes`, `les-services`, `les-rbac` | Linked as "read more" from the M08/M09 lessons; this track authors its own shorter lessons so the weekly budget holds. | `obj-m08-*`, `obj-m09-*` |
| Onsite design scenario `ons-design-artifacts` | Linked from D05 as a deeper companion. | `obj-m13-05` |
| Sandbox engine, hint ladder, debrief UI, store export/import, review deck | Reused as-is; extended (see plan). | all |

## Progress preservation

- All existing keys (`lx.cards`, `lx.saved`, `lx.stats`, `lx.streak`, `lx.labs`, `lx.sandbox`,
  `lx.onsite`, …) are untouched by this track.
- New key `lx.sre` holds learner attempts and is separate from content.
- Schema v3 migration: takes a snapshot of every known key into `lx.backup` before changing
  anything, is idempotent, and `LXStore.rollback()` restores the snapshot (tested in
  `tests/ui/test-store.js` and `tests/data/test-sre-store.js`).
