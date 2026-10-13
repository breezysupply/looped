# Authoring guide — SRE & Cloud Deployment Foundations content

This is the contract every content file follows. The validator
`tests/data/test-sre-content.js` enforces it; run `node tests/data/test-sre-content.js`
and read the FAIL lines for your ids.

Conventions shared with the rest of LOOPED: plain ES5 JS, each file starts with
`window.LX = window.LX || { commands: [], scenarios: [], drills: [] };` and pushes records onto a
global array. Markdown-lite is rendered: paragraphs separated by blank lines, `- ` bullets,
`1. ` numbered steps, `` `code` ``, `**bold**`, and fenced ``` blocks (a block on its own
paragraph). No HTML in content strings. Inline SVG diagrams are optional and, when present, must
carry `role="img"`, a descriptive `aria-label`, a `viewBox`, no fixed width/height, no scripts,
links or handlers.

Voice: plain language first, correct technical terms second, concrete and operational. Every
example uses the fictional service **Beacon** (Python HTTP API that accepts synthetic sensor
status records, a worker, PostgreSQL, Redis later) and invented hosts/zones (`corp.lab`,
`registry.lab`, `looped-foundations`). Never real company architecture, real customer data,
real credentials, or claims of accreditation. Where tool behaviour is cited, it must match the
pinned versions (see `version-matrix.md`): Terraform S3 backend uses `use_lockfile`, DynamoDB
locking is deprecated; Kubernetes `apps/v1`; no `:latest` tags; kind with pinned node images.

## Ids

| Entity | Id | File |
|---|---|---|
| Lesson | `les-mNN-KK` | `assets/js/data/sre-lessons-{1..4}.js` (1: M01–M04, 2: M05–M08, 3: M09–M12, 4: M13–M16) |
| Question | `q-mNN-bKK` (bank) / `q-mNN-gKK` (gate variant) | `assets/js/data/sre-questions-{1..4}.js` (same split) |
| Review prompt | `rev-mNN-KK` | pushed onto `LX.sreReviews` from the questions file of that module |
| Lab spec | `L01`–`L32` | `assets/js/data/sre-labs.js` (L01–L08), `sre-labs-{2..7}.js` (four labs each: L09–L12 … L29–L32) + `labs/sre-cloud-foundations/LNN/` |
| Scenario | mission id `sre-sNN`, `sre.scenarioId` `SNN` | `assets/js/data/sre-scenarios-1.js` (S01–S08), `sre-scenarios-{2..7}.js` (four each: S09–S12 … S29–S32) |
| Design | `D01`–`D06` | `assets/js/data/sre-designs.js` |

Objectives (`obj-mNN-KK`), modules and weeks are fixed in `assets/js/data/sre-modules.js`. Read
the module's `objectives`, `outcomes`, `concepts` and `lessons` list before writing; the lesson
ids and their count per module are already decided there.

## Lesson record

```js
LX.sreLessons.push({
  id: 'les-m02-01', moduleId: 'M02', title: 'Processes, signals and exit codes', mins: 12,   // 8–20
  objectiveIds: ['obj-m02-01'],            // 1+; every objective must be taught by ≥1 lesson
  prereqs: ['les-m01-01'],                 // earlier lesson ids only (file order)
  refs: ['T15'],                           // ids from LX.sreSources (sre-track.js); 1+
  objective: 'One sentence: what the learner can do afterwards (30+ chars).',
  model: 'The mental model in plain language, 120+ chars. Bold the key terms.',
  sections: [ { h: 'Heading', body: '250+ chars of explanation…' }, … ],   // 2–6 sections
  example: { h: 'A Beacon-flavoured worked example', body: '200+ chars; show commands/output and the reasoning.' },
  misconceptions: [ { wrong: 'What people believe', right: 'What is true, and why (20+ chars)' }, … ],  // 2+
  recall: [ { q: 'A prediction or retrieval question asked BEFORE commands are supplied', a: 'The answer' }, … ],  // 3+
  diagram: '<svg …>', diagramCaption: '…'   // optional
});
```

Lesson titles per module (use these exactly):

- M02: 01 Processes, signals and exit codes · 02 Users, permissions and the service user · 03 systemd units and journald · 04 CPU, load and memory pressure · 05 Filesystems, inodes and listening sockets
- M03: 01 IP addressing, CIDR, subnets and routes · 02 TCP versus UDP and what a connection error means · 03 DNS: delegation, recursion and caches · 04 NAT, firewalls and direction · 05 HTTP, TLS, certificates and load balancers
- M04: 01 Python the operational way: types, functions, collections · 02 Files, JSON, CSV and the command line · 03 Exceptions, exit codes and logging · 04 Tests you can trust · 05 HTTP clients: timeouts, pagination, retries and idempotency · 06 Complexity and bounded memory
- M05: 01 The AWS request path · 02 IAM, STS and KMS: who is allowed what · 03 Regions, AZs, subnets, routes and endpoints · 04 Compute and storage choices · 05 Dependencies, failure domains and recovery
- M06: 01 HCL: providers, resources, data, variables, outputs · 02 plan and apply: reading what will change · 03 State, locking, drift and import · 04 Replacement and immutable fields · 05 Modules, environments and the configuration-management contrast
- M07: 01 Images, layers and the process model · 02 Dockerfile and the build context · 03 Networks, ports, DNS and volumes · 04 Non-root users, signals and health checks · 05 Architectures, digests and Compose
- M08: 01 Control plane, nodes, controllers and desired state · 02 Pods, Deployments, ReplicaSets and rollouts · 03 Services and EndpointSlices · 04 Configuration: ConfigMaps, Secrets and environment · 05 Probes: startup, readiness and liveness
- M09: 01 Scheduling, requests and limits · 02 Pending, CrashLoopBackOff and OOMKilled evidence · 03 Storage: PVCs and StorageClasses · 04 RBAC and service accounts · 05 NetworkPolicy and enforcement · 06 Disruption budgets, drains and scaling
- M10: 01 Helm values, templates and chart versions · 02 Pipelines: tests, artifacts and gates · 03 Immutable promotion by digest and rollback · 04 GitOps reconciliation · 05 Secrets in delivery and schema compatibility
- M11: 01 Logs, metrics and traces: what each answers · 02 RED, USE and PromQL basics · 03 Histograms, latency and cardinality · 04 SLIs, SLOs and error budgets · 05 Alerting on user impact
- M12: 01 SQL, indexes and EXPLAIN · 02 Transactions, locks and connection pools · 03 Backups, restores, RPO/RTO and replication · 04 Queues, retries and idempotency · 05 Caches, consistency and bottlenecks
- M13: 01 Least privilege and secrets rotation · 02 Patching and CVE triage · 03 Provenance: SBOMs, signatures and verification · 04 Isolated artifact delivery · 05 RMF evidence literacy
- M14: 01 Load, capacity and saturation · 02 Bounded retries and graceful degradation · 03 Release risk · 04 Incident roles, communication and postmortems · 05 DR exercises and toil reduction
- M15: 01 Mapping AWS to Azure and GCP without claiming equivalence · 02 Identity scopes: accounts, subscriptions and projects · 03 Private networking and managed Kubernetes responsibilities · 04 API support: authentication, rate limits and reproduction
- M16: 01 Rebuilding from documentation · 02 Diagnosing unseen faults under time · 03 Defending a design and naming your gaps

## Question record

At least **8 bank** items and **4 gate** items per module (write 10 + 5 to leave margin).
Gate items must be different questions with different choice sets, never a reorder. Mix at
least three types per module; prefer diagnosis and prediction with realistic `context`
(command output, log lines, config) over flag trivia.

```js
Q({ id: 'q-m02-b01', moduleId: 'M02', pool: 'bank', type: 'diagnose', difficulty: 2,   // 1–3
    objectiveIds: ['obj-m02-02'], remediation: 'les-m02-03',                            // lesson id
    context: '$ systemctl status …\n…',          // required for predict/diagnose
    q: 'The question (20+ chars)',
    choices: ['CORRECT FIRST', 'distractor', 'distractor', 'distractor'],   // 3–5 unique; mcq/predict/diagnose
    a: 0,
    rationale: 'Why the answer is right (40+ chars)', misconception: 'What the wrong answers reveal (20+ chars)' });
// order: steps: ['first', 'second', …] (3–7, in correct order), no choices/a
// explain: rubric: ['point', 'point', …] (2+), answer: 'model answer (40+ chars)', no choices/a
```

Review prompts (2–4 per module, kinds `recall` or `changed-symptom`): a changed symptom or a
short recall task, never the same multiple-choice item.

```js
LX.sreReviews.push({ id: 'rev-m02-01', objectiveIds: ['obj-m02-04'], kind: 'changed-symptom',
  prompt: '…', answer: '…' });
```

## Lab spec record (sre-labs.js)

See `L01`–`L08` in `assets/js/data/sre-labs.js` for the shape and the matching directories under
`labs/sre-cloud-foundations/`. Every lab directory ships README.md, validate.py (uses
`labs/sre-cloud-foundations/lib/labcheck.py`, queries real state, exit 1 on failure, writes the
evidence JSON), reset.sh, teardown.sh, SOLUTION.md, VARIANT.md, hints.md, evidence-example.json
(with `"note": "example of the schema, not a result"`), plus setup/inject scripts and assets.
Status is `execution-not-tested` unless the status file records a run.

## Scenario record (missions with an `sre` block)

See `S01`–`S08` in `assets/js/data/sre-scenarios-1.js`. World is a function of the seed using
`LXSim` (sre-sim.js) and/or the cluster model (`k8sModel` seed). Objectives check evidence and
state, never typed strings; `sre.unsafe` lists the documented shortcut(s) with a `test(ctx)`.
`tests/data/test-sre-scenarios.js` plays each scenario: reveal ladder solves it, an alternative
path solves it, the unsafe shortcut fails it, verifying first proves nothing, reset is exact.

Each scenario therefore also declares `sre.alt(variant)` — a different valid investigation and
repair as a list of commands — and every unsafe entry carries `demo` (a command string, a list,
or `function (ctx, variant)`) that performs the shortcut. Evidence checks use the quote-aware
helpers `LXSim.ran/saw/lastIs/lastCode`: a command counts only where it starts a list or pipeline
segment, and output is matched against that command's own output. Scenario-specific verbs live
inside the scenario file (closures over the world state, bound with `LXSim.bind`); to extend a
built-in such as `kubectl`, wrap `LXShell.builtin('kubectl')` in a world verb.
