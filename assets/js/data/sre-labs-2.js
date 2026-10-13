/* SRE & Cloud Deployment Foundations — local lab specifications L09–L12.
   Same record shape as sre-labs.js (see L01/L03 there). M05: fixture-only
   AWS architecture (L09) and IAM evaluation (L10); M06: Terraform with local
   providers (L11) and the Docker provider on a local engine (L12). */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreLabs = LX.sreLabs || [];

(function () {
  var DIR = 'labs/sre-cloud-foundations/';
  function lab(x) { x.version = x.version || '1.0'; LX.sreLabs.push(x); }

  lab({
    id: 'L09', moduleId: 'M05', title: 'Beacon on AWS across two AZs: inventory, request path and failure domains',
    objectiveIds: ['obj-m05-01', 'obj-m05-03', 'obj-m05-05'], executionMode: 'local', estimatedMinutes: 90, environmentProfile: 'workstation', prerequisites: ['L05'],
    learnerBrief: 'A colleague left a draft AWS layout for Beacon across us-west-2a and us-west-2b: load balancer, API and worker tasks, managed PostgreSQL, VPC endpoints and NAT. Using the customer needs supplied, make the machine-readable inventory correct, prove what happens when one zone is unavailable, and write down the single points of failure, the cost and the recovery plan you would defend.\n\nFixtures only: no AWS account and no cost. A small checker (`assets/archcheck.py`) models routes, gateways, endpoints and failure domains; it is a teaching model, not AWS, and says what it ignores. One change was made to the draft at setup; finding it is part of the work.',
    checkpoints: [
      { id: 'c1', title: 'Network paths and the fault', resumeInstructions: '`bash ' + DIR + 'L09/setup.sh` is idempotent and keeps work/inventory.json. Re-run `python3 ' + DIR + 'L09/assets/archcheck.py ' + DIR + 'L09/work/inventory.json` to see where you are.' },
      { id: 'c2', title: 'Failure analysis, cost and recovery', resumeInstructions: 'Your analysis is in work/inventory.json (failure_analysis, cost, recovery) and evidence/L09-explanation.md; `--spof` and `--cost assets/prices.json` recompute the model figures at any time.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/archcheck.py', 'assets/draft-inventory.json', 'assets/customer-needs.md', 'assets/prices.json', 'assets/explanation-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['bash ' + DIR + 'L09/setup.sh', 'python3 ' + DIR + 'L09/assets/archcheck.py ' + DIR + 'L09/work/inventory.json'],
    faultInjection: ['# setup.sh injected variant-a; to choose explicitly (rewrites work/inventory.json from the draft):', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L09/inject.sh'],
    tasks: ['Read assets/customer-needs.md and sketch the path of one sensor POST and the API task start-up calls (image, layers, logs, secret, KMS) before running anything.', 'Run archcheck.py for every scenario; quote the first DOWN line and write two hypotheses in the Fault found section.', 'Use `--explain <component>` and `--scenario az-down:<az>` to discriminate, then make the smallest inventory change that meets C-1 (no internet route for the API tier) and C-2 (no cross-AZ NAT).', 'State every SPOF that `--spof` computes, with a mitigation or an accepted_because, and fill failure_analysis.az_loss.', 'Fill cost (fixed network figure within 15% of the model, whole-service estimate, drivers, assumptions) and recovery (RPO, RTO, backup, restore, region loss).', 'Finish evidence/L09-explanation.md, run validate.py and import the evidence.'],
    validation: [
      { id: 'fixtures-intact', description: 'archcheck.py, prices.json and customer-needs.md are the shipped versions', critical: true },
      { id: 'inventory-parses', description: 'work/inventory.json loads with schema looped.archinv/v1', critical: true },
      { id: 'all-scenarios', description: 'every component serves at baseline and with each AZ unavailable', critical: true },
      { id: 'hygiene', description: 'no exposure or identity findings from the checker', critical: true },
      { id: 'constraints', description: 'API tier has no default route; worker NAT in its own AZ; only the load balancer is public', critical: true },
      { id: 'spof-stated', description: 'every computed single point of failure is stated with a mitigation or accepted_because', critical: true },
      { id: 'cost', description: 'fixed network cost within 15% of the model and within budget; estimate, drivers and assumptions present', critical: true },
      { id: 'recovery', description: 'RPO <= 15 min, RTO <= 60 min, PITR with 7+ days, backup/restore/region-loss written', critical: true },
      { id: 'explanation', description: 'Request path, Identity, Failure domains and Fault found sections with substance', critical: true }
    ],
    reset: ['bash ' + DIR + 'L09/reset.sh   # same variant; your inventory saved as work/inventory.json.bak'],
    teardown: ['bash ' + DIR + 'L09/teardown.sh   # removes work/ only; nothing exists in any cloud'],
    evidenceInstructions: ['`python3 ' + DIR + 'L09/validate.py --explanation-file ' + DIR + 'L09/evidence/L09-explanation.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Paste evidence/latest.json here. The inventory is fictional; it contains no account secrets.'],
    hints: [
      { level: 1, text: 'Run every scenario, not just the baseline: a layout can be right with both zones up and still fail the customer\'s one-zone requirement. Which components go DOWN in which scenario tells you whether it is a zone, a path or a single copy.' },
      { level: 2, text: '`archcheck.py work/inventory.json --explain api` prints every need per subnet and the route table or endpoint it used. Read it hop by hop against customer-needs.md; pulling an image needs more than the two ECR endpoints.' },
      { level: 3, text: 'For each failing subnet, look at what it depends on in the other zone: which NAT its route table targets, which subnets each interface endpoint has ENIs in, which route tables the S3 gateway endpoint is associated with, whether the database is Multi-AZ.' },
      { level: 4, text: 'Variant A: one NAT and single-AZ endpoint ENIs — add nat-b for rt-worker-b and ENIs in api-b (about 155 USD/month). Variant B: the S3 gateway endpoint is not on the API route tables, so ECR layers cannot be fetched — associate rt-api-a/b. Variant C: single-AZ database — multi_az true. Then state region and partner-hooks as SPOFs.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T08', 'T18'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L09/reset.sh` (or variant-a/variant-c), fix it without hints, re-run --spof and --cost (answers differ between variants), rewrite Fault found, validate with `--variant variant-b --assistance independent --out ' + DIR + 'L09/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L09/reset.sh' },
    limits: ['A teaching model of routes, endpoints and failure domains on a written inventory: no security groups, NACLs, DNS details, endpoint policies, quotas, failover timing or partial-AZ impairment, and no AWS API call. It does not prove the design works in AWS.', 'Executed during development on Linux amd64 (Python 3, no AWS): all three variants ran setup → validate FAIL → fix → validate PASS; the unsafe shortcut (adding an internet route to the API tier) failed the constraints check. Not run on macOS.']
  });

  lab({
    id: 'L10', moduleId: 'M05', title: 'IAM by hand: evaluate requests, then write the narrowest fix',
    objectiveIds: ['obj-m05-02', 'obj-m05-01'], executionMode: 'local', estimatedMinutes: 90, environmentProfile: 'workstation', prerequisites: ['L09'],
    learnerBrief: 'Predict allow or deny for seven IAM request cases over fixture policies (identity, bucket, KMS key policies and an organisation guardrail), then work a ticket: the beacon-exporter role cannot read today\'s export at 15:00. Find out whether it is a policy or a session problem, patch the role policy to least privilege, and prove it with your own tests.\n\nThe evaluator in `assets/iameval.py` is a deliberately incomplete model of IAM evaluation, labelled as such: it answers Unsupported rather than guessing and ignores SCPs, boundaries, endpoint policies and KMS grants. No AWS call is made; an optional real-sandbox check is described separately and is off by default.',
    checkpoints: [
      { id: 'c1', title: 'Predict, then evaluate', resumeInstructions: 'Your predictions are in work/predictions.json; `setup.sh` never overwrites them. Re-run `python3 ' + DIR + 'L10/assets/iameval.py run ' + DIR + 'L10/assets/cases/predict --explain` after writing them.' },
      { id: 'c2', title: 'Least-privilege patch and tests', resumeInstructions: 'The patch is work/exporter-policy.json, the session work/session.json and your cases work/tests.json; `reset.sh` restores the starting policy (yours saved as .bak) without touching tests or notes.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/iameval.py', 'assets/world.json', 'assets/policies/', 'assets/cases/predict/', 'assets/cases/ticket/', 'assets/cases/probes/probes.json', 'assets/templates/', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['bash ' + DIR + 'L10/setup.sh'],
    faultInjection: ['# setup.sh injected variant-a; to choose explicitly (rewrites the exporter policy and session):', 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L10/inject.sh'],
    tasks: ['Read world.json and every policy; write a decision and one line of why for P1–P7 in work/predictions.json before running anything.', 'Run the predict cases with --explain; record every wrong prediction and the rule you missed in evidence/L10-notes.md.', 'Reproduce the ticket (`iameval.py run assets/cases/ticket --explain`) and decide: policy, session or both. Quote the trace line.', 'Patch work/exporter-policy.json to the least privilege that allows T1–T3; refresh the session with `iameval.py assume` if needed. Never edit the guardrail or bucket policy.', 'Write five or more cases in work/tests.json (2+ Allow, 3+ deny) and run them.', 'Run validate.py and import the evidence.'],
    validation: [
      { id: 'fixtures-intact', description: 'evaluator, world, guardrail, bucket/key policies and case files are the shipped versions', critical: true },
      { id: 'predictions', description: 'work/predictions.json matches the evaluator for all seven cases', critical: true },
      { id: 'policy-supported', description: 'the patched policy uses only what the evaluator models', critical: true },
      { id: 'ticket-policy', description: 'T1–T3 allowed by the policy with a valid session', critical: true },
      { id: 'ticket-session', description: 'T1–T3 allowed with your work/session.json; duration within MaxSessionDuration', critical: true },
      { id: 'probes-denied', description: 'twelve out-of-scope probes denied; the out-of-endpoint read is still an explicit deny', critical: true },
      { id: 'no-broadening', description: 'no Allow with a wildcard action, Resource "*", whole-bucket object ARN or key/*', critical: true },
      { id: 'own-tests', description: 'your 5+ cases (2+ Allow, 3+ deny) all pass', critical: true },
      { id: 'notes', description: 'evidence/L10-notes.md has substance (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L10/reset.sh   # same variant; your policy saved as work/exporter-policy.json.bak'],
    teardown: ['bash ' + DIR + 'L10/teardown.sh   # removes work/ only'],
    evidenceInstructions: ['`python3 ' + DIR + 'L10/validate.py --explanation-file ' + DIR + 'L10/evidence/L10-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'The session file holds the placeholder `lab-session-not-a-real-secret`; never paste real credentials into any file here.'],
    hints: [
      { level: 1, text: 'Before blaming a policy, ask whether a policy was evaluated at all: authentication (the session) fails before authorisation. Then ask which policy type decided — identity, bucket, key or the guardrail.' },
      { level: 2, text: '`iameval.py run assets/cases/ticket --explain` prints the session check, every Deny that matched or did not and why, and the Allow that decided. Compare each request\'s action and resource character by character with work/exporter-policy.json.' },
      { level: 3, text: 'Copy T1 into work/tests.json with an inline session valid at 15:00 and evaluate it. Passing means the policy was never the problem. Failing: read which statement the trace names — a Deny in the role\'s own policy is yours; one in guardrail.json is not.' },
      { level: 4, text: 'Variant A: remove the leftover FreezeExportsDuringMigration Deny only. Variant B: export/* should be exports/*, and Decrypt names the database key instead of the archive key. Variant C: the session expired at 14:30 and someone allowed s3:*/kms:* on * — assume a new session and replace it with GetObject on exports/*, ListBucket with s3:prefix exports/*, Decrypt on the archive key.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T18', 'T08'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-c bash ' + DIR + 'L10/reset.sh` (or variant-a/variant-b), diagnose without hints, add a test that would have caught the new fault, validate with `--variant variant-c --assistance independent --out ' + DIR + 'L10/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L10/reset.sh' },
    limits: ['The evaluator is an incomplete IAM model: same-account only, a subset of condition operators, no SCPs/RCPs, permission boundaries, session policies, endpoint policies, KMS grants or encryption context. A pass proves reasoning on fixtures, not that the policy works in AWS.', 'Executed during development on Linux amd64 (Python 3, no AWS): all three variants ran setup → validate FAIL → fix → validate PASS; unsafe shortcuts (an extra s3:* Allow; refreshing the session but keeping s3:*/kms:* on *; a hand-edited week-long session) failed. The optional IAM simulator call was not run.']
  });

  lab({
    id: 'L11', moduleId: 'M06', title: 'Terraform generates Beacon\'s config: inputs, plan, state and the file on disk',
    objectiveIds: ['obj-m06-01', 'obj-m06-02', 'obj-m06-03'], executionMode: 'local', estimatedMinutes: 120, environmentProfile: 'workstation', prerequisites: ['L02'],
    learnerBrief: 'A small Terraform configuration generates Beacon\'s per-environment config: hashicorp/local writes the files and hashicorp/random gives each environment a stable deployment id. A teammate touched the dev workspace and nobody has planned since. Read the plan before applying, return to a no-change plan without losing dev\'s deployment id, and close an input-validation gap with a validation rule and a `terraform test` case.\n\nLocal providers only, pinned by a committed lockfile; state is a local file inside the lab workspace. Explain configuration versus state versus the real file.',
    checkpoints: [
      { id: 'c1', title: 'Read before you apply', resumeInstructions: '`bash ' + DIR + 'L11/setup.sh` reuses work/ if it exists. `terraform -chdir=' + DIR + 'L11/work plan` shows where you are; notes are in evidence/L11-notes.md.' },
      { id: 'c2', title: 'Fix, validate, test, graph', resumeInstructions: 'All configuration and state is in work/. `reset.sh` destroys this workspace\'s three resources, saves your .tf files in .work-previous/ and rebuilds for the same variant.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'starter/versions.tf', 'starter/variables.tf', 'starter/main.tf', 'starter/outputs.tf', 'starter/terraform.tfvars', 'starter/templates/beacon.yaml.tftpl', 'starter/tests/beacon.tftest.hcl', 'starter/.terraform.lock.hcl', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['bash ' + DIR + 'L11/setup.sh   # init with the committed lockfile, baseline apply, inject', 'terraform -chdir=' + DIR + 'L11/work state list'],
    faultInjection: ['# setup.sh injected variant-a; to start over with another variant:', 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L11/reset.sh'],
    tasks: ['Describe configuration, state (`state list`, `state show local_file.config`) and the real files (`ls -l`, `shasum -a 256`) separately in evidence/L11-notes.md.', 'Write a plan prediction, then run `terraform plan`; explain every difference, naming any forcing attribute or keeper.', 'Fix the workspace so the plan is No changes and the deploy_id is the baseline one; refuse any plan that replaces it.', 'Add a validation rule refusing store_kind = "sqlite" without an absolute store_path, plus a plan-only test run with expect_failures for it.', 'Run fmt, validate and test; save `terraform graph` to evidence/L11-graph.dot and explain the manifest\'s two dependencies.', 'Run validate.py and import the evidence.'],
    validation: [
      { id: 'workspace-local', description: 'local state inside work/, no backend or cloud block', critical: true },
      { id: 'lockfile-pinned', description: 'the committed lockfile (local 2.9.1, random 3.9.1) is unchanged', critical: true },
      { id: 'fmt', description: 'terraform fmt -check -recursive passes', critical: true },
      { id: 'tf-validate', description: 'terraform validate passes', critical: true },
      { id: 'tf-test', description: 'terraform test passes with 5+ runs and 3+ expect_failures, one for the sqlite path rule', critical: true },
      { id: 'input-validation', description: 'port 80, environment prod and sqlite without a path are each refused by a validation rule', critical: true },
      { id: 'no-change-plan', description: 'terraform plan -detailed-exitcode exits 0', critical: true },
      { id: 'generated-config', description: 'out/dev/beacon.yaml accepted by beacon validate-config; checksum matches the output', critical: true },
      { id: 'deploy-id-stable', description: 'deploy_id equals the baseline recorded at setup', critical: true },
      { id: 'graph-evidence', description: 'evidence/L11-graph.dot is this configuration\'s graph', critical: true },
      { id: 'notes', description: 'Configuration, State, Real object and Plan prediction sections with substance', critical: true }
    ],
    reset: ['bash ' + DIR + 'L11/reset.sh   # destroy this workspace, keep your .tf files in .work-previous/, rebuild'],
    teardown: ['bash ' + DIR + 'L11/teardown.sh   # terraform destroy in work/ only, then remove work/'],
    evidenceInstructions: ['`python3 ' + DIR + 'L11/validate.py --explanation-file ' + DIR + 'L11/evidence/L11-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Paste evidence/latest.json here; it records plan summaries and checksums, never file contents.'],
    hints: [
      { level: 1, text: 'Terraform compares configuration, state and reality. Every surprising plan is one of those pairs disagreeing; decide which pair before changing anything.' },
      { level: 2, text: 'Read the first error or the `# … will be / must be` lines and every `# forces replacement` marker. `git diff --no-index starter/terraform.tfvars work/terraform.tfvars`, `terraform state show local_file.config` and `ls -l work/out/*` give you the three sides.' },
      { level: 3, text: '`terraform plan -refresh=false` compares configuration with state only. Clean there but dirty normally: reality changed out of band. Dirty in both: configuration changed. Neither runs: the inputs are invalid.' },
      { level: 4, text: 'Variant A: tfvars say environment "Dev" and listen_port 80 — fix the inputs, keep the rules. Variant B: environment "staging" makes the keepers replace random_id and moves both files — revert here, never apply it. Variant C: out/dev/beacon.yaml was deleted — apply recreates that one file. Add `var.store_kind != "sqlite" || startswith(var.store_path, "/")` and a test with expect_failures = [var.store_path].' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T17', 'T03'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L11/reset.sh` (or variant-a/variant-c), write a new plan prediction first, copy your validation rule and test from .work-previous/, validate with `--variant variant-b --assistance independent --out ' + DIR + 'L11/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L11/reset.sh' },
    limits: ['Local files and a random id stand in for managed objects. Proves plan reading, validation rules, plan-only `terraform test`, the lockfile and the configuration/state/object distinction; not remote state, locking under concurrency, credentials, import or modules (L12).', 'Executed during development with Terraform 1.13.3 on Linux amd64: all three variants ran setup → plan → validate FAIL → fix → validate PASS, plus reset and teardown; unsafe shortcuts (deleting validation blocks; applying the staging replacement then reverting) failed. Not run on macOS; the lockfile carries darwin hashes from `terraform providers lock`.']
  });

  lab({
    id: 'L12', moduleId: 'M06', title: 'Terraform against real local containers: drift, import, replacement and modules',
    objectiveIds: ['obj-m06-02', 'obj-m06-03', 'obj-m06-05'], executionMode: 'local', estimatedMinutes: 120, environmentProfile: 'compose', prerequisites: ['L11'],
    learnerBrief: 'Beacon\'s dev deployment on your local Docker engine is managed by a flat Terraform root using the kreuzwerker/docker provider: a network, a data volume holding the records, a pinned base image and the API container. Work the ticket written at setup (an out-of-band change, an existing container to bring under management, or an approved change whose plan contains a forced replacement), then extract a reusable module and stand up staging with its own state. Dev\'s records must survive everything.\n\nEvery object is named looped-l12-*; ports bind to 127.0.0.1; state is local per environment; teardown removes only this lab\'s objects.',
    checkpoints: [
      { id: 'c1', title: 'Docker provider project and the ticket', resumeInstructions: 'Containers keep running between sessions (`docker start` them after a reboot). `bash ' + DIR + 'L12/setup.sh` reuses work/; read work/TICKET.md and run `terraform -chdir=' + DIR + 'L12/work/envs/dev plan`.' },
      { id: 'c2', title: 'Module extraction and separate states', resumeInstructions: 'Your module is work/modules/beacon, the roots work/envs/dev and work/envs/staging (each with its own terraform.tfstate). `reset.sh` tears down and keeps your .tf files in .work-previous/.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/common.sh', 'assets/plan-notes-template.md', 'starter/envs/dev/', 'starter/envs/dev/.terraform.lock.hcl', 'starter/modules/beacon/README.md', 'starter/envs/staging/README.md', 'solution/', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# Docker running; Terraform >= 1.9', 'bash ' + DIR + 'L12/setup.sh', 'cat ' + DIR + 'L12/work/TICKET.md'],
    faultInjection: ['# setup.sh injected variant-a; to start over with another variant:', 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L12/reset.sh'],
    tasks: ['Compare state (`terraform state list/show`) with reality (`docker inspect`, `docker volume inspect`) and write your prediction in evidence/L12-plan-notes.md before planning.', 'For every "must be replaced", name the attribute marked "# forces replacement" and the data at risk.', 'Resolve the ticket: import only what imports cleanly or what you accept being replaced; never apply a plan that replaces the data volume; end with a no-change plan.', 'Move network, volume, image and container into modules/beacon with prevent_destroy on the volume; use moved blocks so the dev plan is 0/0/0.', 'Create envs/staging as a second root with its own state and lockfile; apply it on port 18413.', 'Run validate.py and import the evidence; then teardown.sh.'],
    validation: [
      { id: 'scope', description: 'every object labelled for L12 is named looped-l12-*', critical: true },
      { id: 'states-separate', description: 'dev and staging have local states with different lineage', critical: true },
      { id: 'lockfile-pinned', description: 'both roots pin kreuzwerker/docker 4.6.0', critical: true },
      { id: 'module-extracted', description: 'modules/beacon used by both roots and visible as module.* in both states', critical: true },
      { id: 'data-protected', description: 'the module\'s data volume has prevent_destroy = true', critical: true },
      { id: 'no-change-dev', description: 'dev plan -detailed-exitcode exits 0', critical: true },
      { id: 'no-change-staging', description: 'staging plan -detailed-exitcode exits 0', critical: true },
      { id: 'no-orphans', description: 'every looped-l12-* container is running and tracked by a state', critical: true },
      { id: 'user-path', description: 'dev and staging /healthz return 200 on their loopback ports', critical: true },
      { id: 'data-preserved', description: 'the seed record written at setup is still served by dev', critical: true },
      { id: 'volume-kept', description: 'the dev data volume was never replaced (same creation time)', critical: true },
      { id: 'variant-outcome', description: 'drift resolved / spool imported intact / approved port change applied', critical: true },
      { id: 'plan-notes', description: 'Prediction, Drift, Import, Replacement and Module sections with substance', critical: true }
    ],
    reset: ['bash ' + DIR + 'L12/reset.sh   # teardown, keep your .tf files in .work-previous/, set up the same variant'],
    teardown: ['bash ' + DIR + 'L12/teardown.sh   # destroy both roots, remove remaining looped-l12-* objects and work/; keeps the base image'],
    evidenceInstructions: ['`python3 ' + DIR + 'L12/validate.py --explanation-file ' + DIR + 'L12/evidence/L12-plan-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Run teardown.sh after importing the evidence and re-run validate with `--cleanup verified` only if you want the cleanup recorded; the report never includes state contents.'],
    hints: [
      { level: 1, text: 'Three sources of truth: the .tf files, the state, and docker inspect. Decide which two disagree, and which object holds data you must not lose: containers here are disposable, volumes are not.' },
      { level: 2, text: 'Read the plan for "has been deleted", "must be replaced", "# forces replacement", "will be imported" and "has moved to"; compare `terraform state show` ids with `docker inspect` ids, ports and labels, and volume creation times.' },
      { level: 3, text: 'Does the id in state match the id Docker reports for the same name? Is there a looped-l12-* object no state knows? Does the plan replace a docker_volume? Find the forcing attribute before anything else.' },
      { level: 4, text: 'A: the API was re-run by hand on another port — import it and accept the replacement, or remove the unmanaged container, then apply. B: import the spool volume (clean) and the worker (replacement accepted; stateless). C: the port change is safe; the volume-label change replaces the data volume — decline it. c2: four moved blocks make the module move 0/0/0.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T17', 'T03', 'T16'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L12/reset.sh` (or variant-a/variant-c), resolve the new ticket without hints, redo the module and staging from .work-previous/, validate with `--variant variant-b --assistance independent --out ' + DIR + 'L12/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L12/reset.sh' },
    limits: ['A local Docker engine stands in for cloud resources: proves plan reading, drift, import of supported resources, moved-based refactoring, prevent_destroy and per-environment local state; not remote backends, concurrent locking, credentials or cloud semantics. A local volume says nothing about durability across zones.', 'Executed during development with Terraform 1.13.3, kreuzwerker/docker 4.6.0 and Docker Engine 29 on Linux amd64: all three variants ran setup → fault → validate FAIL → fix + module + staging → validate PASS, with reset/teardown between them; applying the full variant-c change (volume replaced, seed record lost) failed. Not run on Apple Silicon or Docker Desktop.']
  });
})();
