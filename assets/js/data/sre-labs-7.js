/* SRE & Cloud Deployment Foundations — local lab specifications L29–L32.
   Same record shape as sre-labs.js (see L01/L03 there). M15: a paper
   translation of the D01/L09 design onto Azure and Google Cloud (L29) and a
   local API support fixture (L30); M16: rebuilding the core Beacon deployment
   from checked-in artifacts (L31) and the final assessment harness (L32). */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreLabs = LX.sreLabs || [];

(function () {
  var DIR = 'labs/sre-cloud-foundations/';
  function lab(x) { x.version = x.version || '1.0'; LX.sreLabs.push(x); }

  lab({
    id: 'L29', moduleId: 'M15', title: 'Beacon on Azure and Google Cloud: translate the design, not the vocabulary',
    objectiveIds: ['obj-m15-01', 'obj-m15-04'], executionMode: 'local', estimatedMinutes: 90, environmentProfile: 'workstation', prerequisites: ['L09', 'L18'],
    learnerBrief: 'Two prospective customers run on Azure and Google Cloud. Finish a colleague\'s worksheet that translates the two-AZ Beacon design from D01/L09 (its inventory ids are cited row by row): a diagram per provider, a row per design concept with its scope and the difference a migration would get wrong, an access/network responsibility matrix for EKS, AKS and GKE, and a judgement on thirteen curated equivalence claims, each with the deciding fact and a source from the course register.\n\nPaper exercise: no cloud account, no cost. A small standard-library checker (`assets/xlate.py`) reads the worksheet and flags known wrong equivalences; the colleague\'s draft contains some. Nothing you write may claim hands-on experience you do not have.',
    checkpoints: [
      { id: 'c1', title: 'Translate, judge, defend', resumeInstructions: '`bash ' + DIR + 'L29/setup.sh` keeps work/translation.yaml. Re-run `python3 ' + DIR + 'L29/assets/xlate.py ' + DIR + 'L29/work/translation.yaml` to see what is still flagged; notes are in evidence/L29-notes.md.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/xlate.py', 'assets/draft-base.yaml', 'assets/variants.json', 'assets/claims.json', 'assets/facts.json', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['bash ' + DIR + 'L29/setup.sh', 'python3 ' + DIR + 'L29/assets/xlate.py --claims'],
    faultInjection: ['# setup.sh planted variant-a; to choose explicitly (rewrites work/translation.yaml from the draft):', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L29/inject.sh'],
    tasks: ['Read the L09 inventory and the draft; note which of the colleague\'s rows you already doubt before running the checker.', 'Run xlate.py, quote the first findings under Fault found, and fix each row\'s target, scope (global, regional, zonal, tenant, subscription, project …) and difference.', 'Draw an Azure and a Google Cloud diagram as Mermaid text: load balancer, API, worker, database, zone/region boundary, private service path and identities.', 'Complete the responsibility matrix (control plane, node patching, upgrades, workload identity, NetworkPolicy, API endpoint access, zone spread, secrets encryption) for EKS, AKS and GKE with provider and operator ownership.', 'Judge all thirteen claims (holds, partly, does-not-hold) with the deciding difference and LX.sreSources ids such as T19 and T20.', 'Write the limits statement and the notes, run validate.py and import the evidence.'],
    validation: [
      { id: 'fixtures-intact', description: 'checker, claims, facts and variant files are the shipped versions', critical: true },
      { id: 'worksheet-parses', description: 'work/translation.yaml parses as the YAML subset with schema looped.xlate/v1', critical: true },
      { id: 'rows', description: 'eleven concepts for Azure and GCP, each with target, difference and an aws_ref that exists in L09', critical: true },
      { id: 'scopes', description: 'network, subnet, NAT and resource-scope facts stated correctly', critical: true },
      { id: 'diagrams', description: 'both diagrams have 8+ lines, 6+ edges and every required part', critical: true },
      { id: 'matrix', description: 'eight concerns across three providers with provider and operator ownership', critical: true },
      { id: 'claims', description: 'every curated claim judged correctly with the deciding fact and a register source', critical: true },
      { id: 'phrasing', description: 'no known wrong-equivalence phrasing left in rows or matrix', critical: true },
      { id: 'honesty', description: 'a limits statement and no claim of hands-on cloud proficiency', critical: true },
      { id: 'notes', description: 'Fault found, Identity scopes, Network and Managed Kubernetes notes (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L29/reset.sh   # same variant; your worksheet saved as work/translation.yaml.bak'],
    teardown: ['bash ' + DIR + 'L29/teardown.sh   # removes work/ only; nothing exists in any cloud'],
    evidenceInstructions: ['`python3 ' + DIR + 'L29/validate.py --explanation-file ' + DIR + 'L29/evidence/L29-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4, the solution or another variant\'s draft.', 'Paste evidence/latest.json here. The worksheet is fictional and holds no account data.'],
    hints: [
      { level: 1, text: 'For every row and claim ask two questions per provider: how far does this object reach (zone, region, global, subscription, project, tenant), and where are permissions attached (to the identity, to a scope, to the resource)?' },
      { level: 2, text: 'Read each xlate.py finding by area: scopes and phrasing point at rows, claims at judgements, matrix at missing concerns. Then read the provider\'s own architecture guidance (T19, T20) for that object rather than a comparison table.' },
      { level: 3, text: 'Take the L09 layout literally — two zonal subnets per tier, one NAT per AZ, an S3 gateway endpoint on route tables, task roles with identity policies — and ask whether the other provider\'s object even has a zone, a route table or a policy attached to the identity.' },
      { level: 4, text: 'Variant A: identity scope (TR-01 partly; TR-02, TR-13 do not hold; TR-12 holds; GCP resource scope is project). Variant B: network (GCP VPC global, Azure/GCP subnets and Cloud NAT regional, TR-03/04/06/07 do not hold, TR-05 partly). Variant C: managed clusters and availability (node patching depends on mode, zones vary, GCP global load balancer; TR-08/09/10 do not hold, TR-11 holds).' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T19', 'T20', 'T08', 'T18'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L29/reset.sh` (or variant-a/variant-c), keep your diagrams and matrix but re-read every flagged row, rewrite Fault found, add the first sandbox test you would run, and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L29/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L29/reset.sh' },
    limits: ['A paper translation checked by a curated teaching aid: it proves you can name non-equivalences in identity scope, IAM, networking, managed-cluster responsibility and availability with sources. It does not prove live Azure or Google Cloud proficiency, that the design works, or anything about current prices, quotas or regional support; no provider API is called.', 'Executed during development on Linux amd64 (Python 3, no cloud account): all three variants ran setup → validate FAIL → fix → validate PASS → reset; shortcuts (judging every claim does-not-hold; adding a production-experience claim to limits) failed. Not run on macOS.']
  });

  lab({
    id: 'L30', moduleId: 'M15', title: 'An API support case: reproduce it minimally, classify it, explain it',
    objectiveIds: ['obj-m15-03'], executionMode: 'local', estimatedMinutes: 90, environmentProfile: 'workstation', prerequisites: ['L08'],
    learnerBrief: 'A fictional customer reports that their nightly integration with a summaries API is failing. Their ticket, log excerpt and reproduction script are in your workspace; a local standard-library fixture plays the API on 127.0.0.1:8130. Decide whether the failure is the caller\'s, authentication or entitlement, or the service; rewrite their script into a minimal, sanitised reproduction that prints a request id and a category and follows a bounded, idempotent retry policy; and write the reply the customer will read.\n\nThe validator runs your reproduction against every fixture mode and judges it by what the fixture saw on the wire. No real API, customer or key is involved.',
    checkpoints: [
      { id: 'c1', title: 'Reproduce, isolate, explain', resumeInstructions: '`bash ' + DIR + 'L30/setup.sh` restarts the fixture and keeps work/repro.py and work/customer-reply.md. Re-read work/TICKET.md and run `python3 repro.py --base-url http://127.0.0.1:8130 --key-file .secrets/customer-key` from work/.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/support_api.py', 'assets/customer-request.json', 'assets/tickets/', 'assets/reply-template.md', 'assets/notes-template.md', 'starter/repro.py', 'solution/repro.py', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['bash ' + DIR + 'L30/setup.sh', 'cat ' + DIR + 'L30/work/TICKET.md'],
    faultInjection: ['# setup.sh started the fixture for variant-a\'s ticket; another ticket (restarts the fixture):', 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L30/inject.sh'],
    tasks: ['Read the ticket and the customer\'s repro.py; write down what its output would leak and why its retries hurt.', 'Reproduce with curl (`--noproxy \'*\' -D -`): status, X-Request-Id, Retry-After and quota headers, stream events; compare GET /v1/health and /_fixture/stats.', 'Isolate the failure (caller, auth/entitlement, service) in evidence/L30-notes.md with the evidence that rules out the other two.', 'Rewrite work/repro.py to the contract: one JSON result line with category and request id, exit 0/3/2, at most 3 attempts, no retry on 400/401/403, Retry-After honoured, one Idempotency-Key per run, nothing secret printed.', 'Write work/customer-reply.md (Summary, What we saw with your request id, What it means, Next steps, Retry guidance).', 'Run validate.py and import the evidence.'],
    validation: [
      { id: 'fixture', description: 'the fixture answers on 127.0.0.1:8130 and the ticket variant is known', critical: true },
      { id: 'repro-contract', description: 'six runs each end with the JSON result line and the documented exit code', critical: true },
      { id: 'classification', description: 'ok, auth_invalid, not_entitled, rate_limited, timeout and stream_interrupted for the six modes', critical: true },
      { id: 'request-ids', description: 'reported request ids were issued by the fixture in that run', critical: true },
      { id: 'attempts-honest', description: 'reported attempts equal the requests the fixture received', critical: true },
      { id: 'caller-errors', description: '401 and 403 are never retried', critical: true },
      { id: 'retry-after', description: '429 retried at most twice, each after at least Retry-After seconds', critical: true },
      { id: 'bounded', description: 'at most 3 attempts per run; the stalled mode ends in under 20 s with each stall abandoned early', critical: true },
      { id: 'idempotent', description: 'every retried run reuses one Idempotency-Key', critical: true },
      { id: 'sanitised', description: 'no key, Authorization header or customer text in outputs, repro.py, reply or notes', critical: true },
      { id: 'reply', description: 'five sections, a request id issued in the ticket\'s mode and the decisive evidence for it', critical: true },
      { id: 'notes', description: 'Reproduction, Isolation and Retry policy notes (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L30/reset.sh   # re-issues both lab keys, clears quota/stream counters, same ticket; your code and reply kept'],
    teardown: ['bash ' + DIR + 'L30/teardown.sh   # stops the fixture, removes keys, run files and ticket; your repro.py and reply stay'],
    evidenceInstructions: ['`python3 ' + DIR + 'L30/validate.py --explanation-file ' + DIR + 'L30/evidence/L30-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'The evidence records categories, counts and timings only; the keys are lab placeholders and never appear in it.'],
    hints: [
      { level: 1, text: 'Decide which of three places the failure lives in before touching code: the caller (request, client behaviour), authentication or entitlement (who is calling, what they may use), or the service. One curl with -D - and one GET /v1/health usually rule out two of them.' },
      { level: 2, text: 'Read the status line, X-Request-Id, WWW-Authenticate, Retry-After and X-RateLimit-* headers, and every event: line of a stream until the connection closes. /_fixture/stats is the provider-side view of what arrived and when.' },
      { level: 3, text: 'Change one thing at a time: the other lab key (work/.secrets/new-key), "stream": false, curl --max-time 5, two requests 2 s apart. Each change moves exactly one candidate cause.' },
      { level: 4, text: '401 → auth_invalid, 403 → not_entitled, 429 → rate_limited, no first byte within the timeout → timeout, a stream without event: done → stream_interrupted. Retry only 429 (after Retry-After), timeouts, 5xx and interrupted streams, at most 3 attempts, one uuid4 Idempotency-Key per run, never print headers or the body. Reference: solution/repro.py.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T11', 'T01'], status: 'validated',
    variant: { brief: 'After passing one ticket, `LOOPED_VARIANT=variant-d bash ' + DIR + 'L30/reset.sh` (variant-a … variant-e are five different tickets), predict the category from the ticket text alone, write a new reply quoting a fresh request id, and validate with `--variant variant-d --assistance independent --out ' + DIR + 'L30/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-d bash ' + DIR + 'L30/reset.sh' },
    limits: ['A scripted fixture: six modes, one rate limit, one way for a stream to fail. It proves wire-level classification, a measured bounded and idempotent retry policy, sanitised output and an evidence-backed reply; not experience with any real provider\'s API, error codes, quotas or support tooling, and real incidents can mix modes intermittently.', 'Executed during development on Linux amd64 (Python 3): all five tickets (variant-a … variant-e) ran setup/reset → validate FAIL with the customer\'s script → fixed repro and reply → validate PASS; reset re-issued the keys and teardown stopped the fixture; shortcuts (ignoring Retry-After; quoting a request id from another mode) failed. Not run on macOS.']
  });

  lab({
    id: 'L31', moduleId: 'M16', title: 'Rebuild Beacon from checked-in artifacts, then prove you can do it again',
    objectiveIds: ['obj-m16-01'], executionMode: 'local', estimatedMinutes: 210, environmentProfile: 'kind-basic', prerequisites: ['L13', 'L18', 'L19', 'L22', 'L24'],
    learnerBrief: 'A colleague\'s draft release configuration rebuilds the core Beacon deployment in a new namespace and "works on their cluster". Rebuild it from this repository alone: the L13 image recipe, the L19 chart (unchanged, wired to PostgreSQL and Redis by a Helm post-renderer), L18\'s RBAC and NetworkPolicies, PostgreSQL with seeded data, a Redis queue and worker, L22\'s SLO rules, L21\'s dashboard and L24\'s restore verifier. Write the runbook, demonstrate a verified restore and a rollback, tear everything down and build it again.\n\nThe draft hides one prerequisite that only exists on the colleague\'s machine, and the reused telemetry was written for other fixtures; a dry check that runs in a copy of only the non-ignored files with an empty environment finds both before anything touches a cluster.',
    checkpoints: [
      { id: 'c1', title: 'Rebuild from documentation', resumeInstructions: '`bash ' + DIR + 'L31/setup.sh` keeps release/. Run `bash ' + DIR + 'L31/rebuild.sh check` (no cluster needed) and continue fixing release/rebuild.env and REBUILD.md.' },
      { id: 'c2', title: 'Deploy and observe', resumeInstructions: 'Start the cluster named in release/rebuild.env (profiles/kind-basic or kind-policy), then `bash ' + DIR + 'L31/rebuild.sh deploy` is idempotent; `rebuild.sh verify` shows where you are.' },
      { id: 'c3', title: 'Seed, verify, document', resumeInstructions: 'Proof files are in work/proof/ (runs.jsonl, restore.json, rollback-history.json). Run `rebuild.sh proof` (down then all) and finish the Rebuild proof section of release/REBUILD.md.' }
    ],
    assetPaths: ['README.md', 'rebuild.sh', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/capstone.py', 'assets/postrender.py', 'assets/seed.sql', 'assets/values-capstone.yaml', 'assets/manifests/', 'assets/variants/', 'assets/release-template/', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json', '../L13/starter/', '../L18/manifests/20-rbac.yaml', '../L18/manifests/30-netpol.yaml', '../L19/chart/', '../L24/assets/verify_restore.py'],
    setup: ['bash ' + DIR + 'L31/setup.sh   # files only: release/ bundle, reused SLO rules/tests and dashboard, the draft rebuild.env', 'bash ' + DIR + 'L31/rebuild.sh check', 'bash ' + DIR + 'profiles/kind-basic/setup.sh   # or profiles/kind-policy for looped-policy'],
    faultInjection: ['# setup.sh wrote variant-a\'s draft (new namespace/cluster/config values plus one hidden prerequisite); another variant:', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L31/inject.sh'],
    tasks: ['Run the dry check and fix release/rebuild.env until no hidden prerequisite, unpinned version or missing/ignored artifact remains.', 'Make the reused SLO rules, tests and dashboard match the metric names and histogram buckets the Beacon build actually exports; keep promtool tests green (`rebuild.sh slo`).', 'Write release/REBUILD.md (scope, prerequisites, configuration, build, deploy, seed, verify, backup and restore, rollback, teardown, rebuild proof, limits) before running it.', 'On a clean cluster: `rebuild.sh image`, `deploy`, `seed`, `verify`; quote real output in the runbook.', 'Backup, restore drill with L24\'s verifier (measured), rollback drill; then `rebuild.sh proof` for teardown and a second full build.', 'Run validate.py and import the evidence.'],
    validation: [
      { id: 'dry-check', description: 'config valid, no hidden prerequisite, versions pinned, every prerequisite artifact present and not git-ignored, telemetry names match the build', critical: true },
      { id: 'fresh-checkout', description: 'the same check passes in a copy of only the non-ignored files with an empty environment', critical: true },
      { id: 'refuses-unknown', description: 'rebuild.sh refuses to run with an unknown L31_* variable', critical: true },
      { id: 'runbook', description: 'release/REBUILD.md has every section with substance and names the namespace', critical: true },
      { id: 'slo-tests', description: 'promtool check rules and test rules pass on the release\'s SLO files', critical: true },
      { id: 'health', description: 'workloads ready, /ready 200, /version is the release tag, a record written and read back', critical: true },
      { id: 'image-identity', description: 'every node holds the image ID recorded at build time', critical: true },
      { id: 'least-privilege', description: 'deploy-bot auth can-i matrix, no token on any pod, no cluster-wide binding', critical: true },
      { id: 'network-policies', description: 'L18 and capstone NetworkPolicies present (enforced only on looped-policy)', critical: true },
      { id: 'seeded-data', description: 'seed count and fingerprint equal the value computed without a database', critical: true },
      { id: 'metrics', description: '/metrics exports every metric the SLO rules and dashboard use', critical: true },
      { id: 'rollback', description: 'Helm history shows a rollback and the current revision deployed', critical: true },
      { id: 'restore-proof', description: 'verify_restore.py report says ok', critical: true },
      { id: 'rebuild-proof', description: 'runs.jsonl shows all, then down, then all, each successful', critical: true }
    ],
    reset: ['bash ' + DIR + 'L31/reset.sh   # rebuild.sh down (L31-labelled namespace only), the draft rebuild.env back, work/proof -> work/proof.prev'],
    teardown: ['bash ' + DIR + 'L31/teardown.sh   # namespace, L31 image and work/; release/ and evidence/ stay; clusters via their profile teardown'],
    evidenceInstructions: ['`python3 ' + DIR + 'L31/validate.py --explanation-file ' + DIR + 'L31/release/REBUILD.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'The evidence records names, counts, fingerprints and image IDs; the generated database password stays in work/.secrets and never appears in it.'],
    hints: [
      { level: 1, text: 'List everything the rebuild touches that it did not create itself — images already in the nodes, Secrets, files in other labs\' work/ directories, variables in your shell. Each is a hidden prerequisite until the rebuild makes it.' },
      { level: 2, text: '`rebuild.sh check` names every failing row; the validator\'s fresh-checkout row repeats it in a copy of only the non-ignored files with an empty environment — what a colleague\'s clone would see.' },
      { level: 3, text: 'For each key in rebuild.env ask where the value points and whether a fresh clone has it (`git check-ignore -v`). For the reused telemetry, compare metric names and histogram buckets with beacon/beacon/api.py and telemetry.py.' },
      { level: 4, text: 'Variant A: IMAGE_SOURCE=build and IMAGE_REPO=looped-l31-beacon. Variant B: DB_SECRET_SOURCE=generate. Variant C: SLO_DIR=labs/sre-cloud-foundations/L31/release/slo. Every variant: beacon_http_* and beacon_l21_* become beacon_requests_total / beacon_request_duration_seconds, le="0.3" becomes 0.25, drop the dependency panel.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T13', 'T04', 'T05', 'T09', 'T14', 'T01'], status: 'execution-not-tested',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L31/reset.sh` (namespace beacon-rebuild on the policy cluster with prod values; or variant-a/variant-c), fix the new hidden prerequisite, prove one denied path from inside a pod, run `rebuild.sh proof` and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L31/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L31/reset.sh' },
    limits: ['A local rebuild: proves reproducibility from checked-in artifacts, health, least privilege, seeded data, metrics, a verified restore and a rollback on kind. NetworkPolicy is not enforced on kind-basic (only on looped-policy); one PostgreSQL on local-path storage proves nothing about durability; no registry digest, ingress, Prometheus server or cloud identity.', 'Not executed against a cluster: kind clusters cannot start in the authoring environment. What ran (Linux amd64): bash -n and py_compile; `rebuild.sh check` and the validator\'s fresh-checkout copy (676 non-ignored files, env -i) — FAIL on all three variant drafts, PASS after the fix; unknown L31_* variable refused; `rebuild.sh image` built looped-l31-beacon:1.4.0 from L13\'s sources (kind load then refused: no cluster); promtool check/test on the adapted L22 rules (SUCCESS); helm template of the L19 chart with the post-renderer plus all L31/L18 manifests through kubeconform -strict (23 resources valid); seed.sql, the fingerprint, pg_dump/pg_restore and verify_restore.py against PostgreSQL 16.4 in Docker; the built image with PostgreSQL, Redis and the worker in Docker (ready, record round-trip, job processed, metric names). The validator\'s live checks were not run.']
  });

  lab({
    id: 'L32', moduleId: 'M16', title: 'Final assessment: unseen faults, a combined incident and your design defence',
    objectiveIds: ['obj-m16-02', 'obj-m16-03'], executionMode: 'local', estimatedMinutes: 240, environmentProfile: 'kind-basic', prerequisites: ['L28', 'L31'],
    learnerBrief: 'A seeded draw gives you two single faults from passed modules, in variants you have not run (every lab/variant in your evidence is excluded), and one bounded two-fault incident on your L31 rebuild with data at stake. Diagnose each from evidence — the single faults are started and judged by their own labs\' scripts and validators — restore service and data with an explicit recovery-point decision, keep least privilege, and clean up exactly what you created.\n\nThen deliver a sanitised incident report, a three-minute update, a ten-minute defence of five design decisions, a small fresh Python change with tests, a Terraform replacement plan you can read, and a rubric self-assessment with evidence for ten domains. Describe all of it as lab experience.',
    checkpoints: [
      { id: 'c1', title: 'Two unseen single faults', resumeInstructions: 'The draw is fixed in report/draw.json; `bash ' + DIR + 'L32/setup.sh` reprints each fault\'s start, validate and teardown commands. Evidence goes to report/evidence/<fault>.json.' },
      { id: 'c2', title: 'The combined incident', resumeInstructions: 'With your L31 rebuild running, the incident state is in work/incident-state.json; `python3 ' + DIR + 'L32/assets/incident.py status` shows the live checks; `reset.sh` restarts the same incident from the pre-incident backup.' },
      { id: 'c3', title: 'Report and design defence', resumeInstructions: 'Everything you write is in report/ (incident-report.md, design-defense.md, rubric-scores.json, python-change/, terraform-plan.txt); `python3 ' + DIR + 'L32/assets/reportcheck.py` checks structure without a cluster.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/catalogue.json', 'assets/draw.py', 'assets/incident.py', 'assets/reportcheck.py', 'assets/rubric.json', 'assets/report-template.md', 'assets/defense-template.md', 'assets/rubric-scores-template.json', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['LOOPED_SEED=<your-seed> bash ' + DIR + 'L32/setup.sh   # records report/draw.json once and prints the two faults', 'python3 ' + DIR + 'L32/assets/draw.py --check ' + DIR + 'L32/report/draw.json'],
    faultInjection: ['# single faults: the drawn labs\' own reset.sh with the drawn variant (printed by setup.sh)', 'bash ' + DIR + 'L32/inject.sh   # the combined incident on your L31 rebuild, after a pre-incident backup'],
    tasks: ['For each drawn single fault: reproduce, two hypotheses, one discriminating check, minimal fix, then that lab\'s validate.py with --out report/evidence/<fault>.json; write Fault 1/2 with evidence paths and quoted output.', 'Start the combined incident; keep a time-stamped timeline; separate the two faults and justify the order you fix them.', 'Make the data decision explicitly (full restore, selective restore, accept loss), with record counts and proof; drop any scratch database.', 'Verify service and data, re-run the deploy bot auth can-i matrix, remove anything you added; write the three-minute update.', 'Write the design defence (five decisions with rejected alternatives and evidence, ten-minute outline, Terraform replacement plan, gaps), a fresh Python change with 3+ tests, and rubric scores with evidence for ten domains.', 'Tear down the single-fault labs, run validate.py with --cleanup verified and import the evidence.'],
    validation: [
      { id: 'draw', description: 'the draw reproduces from its seed and exclusions; both single faults were unseen at draw time', critical: true },
      { id: 'single-1', description: 'first fault: evidence from its own lab validator, right variant, all checks passed, after the draw, independent', critical: true },
      { id: 'single-2', description: 'second fault: same conditions', critical: true },
      { id: 'service', description: 'the rebuild is healthy and serving writes after recovery', critical: true },
      { id: 'data', description: 'seeded history restored AND the post-backup records kept', critical: true },
      { id: 'least-privilege', description: 'deploy-bot matrix holds and no broad RoleBinding remains', critical: true },
      { id: 'release', description: 'no injected failure value left in the release', critical: true },
      { id: 'scoped-cleanup-cluster', description: 'no L32-labelled object or scratch database left', critical: true },
      { id: 'scoped-cleanup-local', description: 'no container still running for a drawn lab', critical: true },
      { id: 'report-structure', description: 'all report sections with substance and a 6+ entry timeline', critical: true },
      { id: 'diagnosis-evidence', description: 'each fault names its lab/variant with evidence paths and quoted output; data decision explicit', critical: true },
      { id: 'design-defense', description: 'five decisions with rejected alternatives and evidence, a 3-minute update, a 10-minute outline, gaps', critical: true },
      { id: 'rubric', description: 'every domain at 3/4 or better with an existing evidence path', critical: true },
      { id: 'python-change', description: 'a fresh change with 3+ passing unittest tests', critical: true },
      { id: 'terraform-plan', description: 'the forcing attribute in the plan is named in the defence', critical: true },
      { id: 'sanitised-honest', description: 'no secret-shaped string, no claim of production experience', critical: true }
    ],
    reset: ['bash ' + DIR + 'L32/reset.sh   # pre-incident backup restored, helm rolled back, L32 objects removed, same incident injected again'],
    teardown: ['bash ' + DIR + 'L32/teardown.sh   # undo the incident (L32-labelled only), remove work/, print each drawn lab\'s teardown; report/ kept'],
    evidenceInstructions: ['`python3 ' + DIR + 'L32/validate.py --explanation-file ' + DIR + 'L32/report/incident-report.md --cleanup verified`', 'Use `--assistance assisted` if you opened any hint rung 3–4, a solution, assets/incident.py or the catalogue\'s fault list before finishing.', 'The seed is recorded in the evidence; report/ is your sanitised, checked-in record — no keys, passwords or customer data.'],
    hints: [
      { level: 1, text: 'For every symptom decide whose it is (the drawn lab\'s environment or your L31 rebuild) and which layer (host, network, process, release, data, access). In the combined incident assume two causes until evidence says one explains everything.' },
      { level: 2, text: 'Use the drawn lab\'s validator output and README, helm history and values, kubectl events and logs with request ids, /ready, record counts, and kubectl auth can-i as the deploy bot.' },
      { level: 3, text: 'Compare against the baseline you recorded in L31 (verify.json, seed fingerprint, can-i matrix, helm values). Before touching data, count what is missing, what is newer than the latest backup, and what each recovery option would lose.' },
      { level: 4, text: 'Roll back a release whose values inject failures; make the database password and the Secret agree and restart the API; remove a broad RoleBinding; restore the pre-incident backup into a scratch database and copy back only missing rows (pg_dump -t records --data-only --inserts --on-conflict-do-nothing), then drop it. Single faults: that lab\'s rung 4.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T01', 'T09', 'T13', 'T17'], status: 'execution-not-tested',
    variant: { brief: 'For practice or a mentor-approved retake, move report/ aside, run setup.sh with a new LOOPED_SEED (your first attempt\'s faults are now excluded), `reset.sh` for the new incident, and validate with `--assistance independent --out ' + DIR + 'L32/evidence/variant.json`.', command: 'LOOPED_SEED=retake-1 bash ' + DIR + 'L32/setup.sh' },
    limits: ['Faults are fixture-controlled and bounded; a structure check cannot tell a good diagnosis from a lucky one (the rubric and evidence paths are for a human reviewer). It proves lab experience, not production or on-call experience or cloud proficiency; NetworkPolicy is not enforced on kind-basic.', 'Not executed end to end: kind clusters cannot start in the authoring environment, so inject.sh, reset.sh and the live checks never ran against a rebuild. What ran (Linux amd64): bash -n and py_compile; the seeded draw (same seed and exclusions → same draw; --check reproduced it; 15 seen variants excluded); validate.py on fresh templates (FAIL) and on an authoring sample bundle with synthetic, labelled single-fault evidence (all static checks PASS; FAIL for a production-experience claim, a secret-shaped DSN, evidence older than the draw and a wrong variant); the incident\'s data-loss SQL and the selective-restore procedure against PostgreSQL 16.4 in Docker (30 rows deleted, restored to the expected fingerprint, 12 newer rows kept).']
  });
})();
