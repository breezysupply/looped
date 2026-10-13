/* SRE & Cloud Deployment Foundations — local lab specifications L17–L20.
   Same record shape as sre-labs.js (see L01/L03 there). M09: scheduling, memory, storage and a
   budget-respecting drain on kind-basic (L17); RBAC and enforced NetworkPolicy on the separate
   kind-policy cluster (L18). M10: the Beacon Helm chart (L19, chart path reused by C03); a gated
   local pipeline, digest promotion and a minimal GitOps reconciler (L20). */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreLabs = LX.sreLabs || [];

(function () {
  var DIR = 'labs/sre-cloud-foundations/';
  function lab(x) { x.version = x.version || '1.0'; LX.sreLabs.push(x); }

  lab({
    id: 'L17', moduleId: 'M09', title: 'Pending, OOMKilled, an unbound volume and a drain the budget blocks',
    objectiveIds: ['obj-m09-01', 'obj-m09-02', 'obj-m09-05'], executionMode: 'local', estimatedMinutes: 180, environmentProfile: 'kind-basic', prerequisites: ['L15', 'L16'],
    learnerBrief: 'Beacon in the local kind cluster now runs three workloads: beacon-api (two replicas and a PodDisruptionBudget), beacon-report (a service with a fixed 96 MiB cache) and PostgreSQL on a PersistentVolumeClaim holding a known dataset of 480 readings. Over two weeks four tickets arrive, one per checkpoint: a rollout that never finishes, a service that keeps restarting, a database that does not come back after a rebuild, and node maintenance. Diagnose each from events, object status and measurements rather than raising every number, prove the data with a checksum, and drain a node without bypassing the budget.\n\nEverything runs in namespace beacon of the kind cluster looped-foundations (two workers needed for the drain); faults are bounded and live in the cluster, never on your host.',
    checkpoints: [
      { id: 'c1', title: 'Pending: requests versus allocatable', resumeInstructions: '`bash ' + DIR + 'L17/setup.sh` reuses work/ and injects nothing. Read work/TICKETS.md (BEACON-OPS-1301) and `kubectl --context kind-looped-foundations -n beacon get pods -o wide`; your edits are in work/manifests/.' },
      { id: 'c2', title: 'OOMKilled: limits versus working set', resumeInstructions: 'If you have not yet, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L17/inject.sh` (it refuses to inject twice). Notes are in evidence/L17-notes.md (section OOM).' },
      { id: 'c3', title: 'Storage: PVC, StorageClass and the known dataset', resumeInstructions: '`LOOPED_VARIANT=variant-c bash ' + DIR + 'L17/inject.sh` once; after the fix `bash ' + DIR + 'L17/assets/restore-dataset.sh --verify` shows the checksum at any time.' },
      { id: 'c4', title: 'Disruption: PodDisruptionBudget and a controlled drain', resumeInstructions: '`bash ' + DIR + 'L17/assets/drain-drill.sh` records each attempt in evidence/L17-drain.json and always uncordons; re-run it after your change. `reset.sh` starts all four checkpoints over (keeps your manifests in .work-previous/).' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'manifests/10-api.yaml', 'manifests/20-report.yaml', 'manifests/30-db.yaml', 'manifests/40-pdb.yaml', 'assets/Dockerfile', 'assets/common.sh', 'assets/dataset.sql', 'assets/checksum.sql', 'assets/dataset.checksum', 'assets/restore-dataset.sh', 'assets/drain-drill.sh', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# profile kind-basic running with two workers (profiles/kind-basic/README.md)', 'bash ' + DIR + 'L17/setup.sh', 'cat ' + DIR + 'L17/work/TICKETS.md'],
    faultInjection: ['# setup.sh injected variant-a (c1); then, one per checkpoint:', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L17/inject.sh', 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L17/inject.sh'],
    tasks: ['c1: find the Pending pod, quote its FailedScheduling event, compare the request with node allocatable, restore a finished rollout without over-provisioning.', 'c2: read lastState (reason, exit code), measure the working set from the cgroup, set a request and a bounded limit with stated headroom; explain why more replicas would not help.', 'c3: read the PVC events and the StorageClasses, rebuild the StatefulSet on standard (volumeClaimTemplates are immutable), restore the dataset and match the checksum.', 'c4: predict the drain with the budget, run the drill, quote the eviction refusal, make a change that lets maintenance proceed while still protecting the API, drain again.', 'Write Pending, OOM, Storage and Drain in evidence/L17-notes.md; run validate.py and import the evidence.'],
    validation: [
      { id: 'cluster', description: 'context kind-looped-foundations is a local kind cluster', critical: true },
      { id: 'faults-exercised', description: 'variants a, b and c were injected (or d for the independent variant)', critical: true },
      { id: 'workloads-ready', description: 'beacon-api ≥ 2 ready and updated, beacon-report 1/1, beacon-db 1/1', critical: true },
      { id: 'no-pending', description: 'no L17 pod is Pending', critical: true },
      { id: 'requests-bounded', description: 'every container has requests and a memory limit; cpu ≤ 1, memory ≤ 1Gi, request ≤ limit', critical: true },
      { id: 'report-memory', description: 'beacon-report unchanged, not OOM-killed, stable; limit ≥ 1.15 × measured working set and ≤ 256Mi', critical: true },
      { id: 'storage', description: 'data-beacon-db-0 Bound through StorageClass standard; no L17 PVC pending', critical: true },
      { id: 'dataset', description: 'checksum over every row equals assets/dataset.checksum', critical: true },
      { id: 'pdb', description: 'policy/v1 budget still protects the API and currently allows ≥ 1 disruption', critical: true },
      { id: 'drain-drill', description: 'a budget-blocked attempt then a completed drain without --force/--disable-eviction; no node left cordoned', critical: true },
      { id: 'notes', description: 'Pending, OOM, Storage and Drain sections with substance', critical: true }
    ],
    reset: ['bash ' + DIR + 'L17/reset.sh   # delete every L17 object incl. the PVC, keep your manifests in .work-previous/, set up again'],
    teardown: ['bash ' + DIR + 'L17/teardown.sh   # uncordon, delete L17 objects and PVC, remove looped-l17-beacon from nodes and Docker, remove work/'],
    evidenceInstructions: ['`python3 ' + DIR + 'L17/validate.py --explanation-file ' + DIR + 'L17/evidence/L17-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'The drill record and the report contain node names and object status only; the database password is a placeholder that never appears in evidence.'],
    hints: [
      { level: 1, text: 'Sort each symptom into a phase before touching YAML: never scheduled, scheduled but killed while running, or waiting on something it needs (a volume, a budget). The scheduler, the kubelet and kernel, the provisioner and the eviction API each leave their own evidence.' },
      { level: 2, text: '`kubectl get pods -o wide`, then `kubectl describe` on the pod or PVC and read Events (FailedScheduling, ProvisioningFailed, Back-off restarting); `lastState` for the previous termination; node allocatable; `kubectl get storageclass` and `kubectl get pdb`.' },
      { level: 3, text: 'Compare numbers: the request against allocatable; the memory limit against the working set read from /sys/fs/cgroup/memory.current once the process has room; the PVC storageClassName against the classes that exist; ALLOWED DISRUPTIONS against the pods a drain must evict.' },
      { level: 4, text: 'A: a 64-CPU request fits no node — restore 100m. B: ~110 MiB resident under a 64Mi limit — request ~128Mi, limit ~160Mi. C: fast-ssd does not exist — delete the StatefulSet and the Pending PVC, apply with standard, run restore-dataset.sh. Drain: minAvailable 2 with 2 replicas allows 0 — scale to 3 (or maxUnavailable 1), drain again.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T04', 'T09', 'T02'], status: 'execution-not-tested',
    variant: { brief: 'After c1–c4, `LOOPED_VARIANT=variant-d bash ' + DIR + 'L17/reset.sh`: a capacity-planning change takes the database down. Diagnose from events only, restore it with its data intact, repeat the drain drill with a budget decision of your own, validate with `--variant variant-d --assistance independent --out ' + DIR + 'L17/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-d bash ' + DIR + 'L17/reset.sh' },
    limits: ['Local kind with the local-path StorageClass: proves scheduler/kubelet/provisioner evidence, bounded resources, PVC binding, a checksum-verified restore and a budget-respecting drain. Local volumes do not prove durability; no multi-zone storage, autoscaling, HPA (no metrics-server) or real node failure.', 'Not executed end to end: kind clusters could not start in the authoring container. What ran: kubeconform -strict on all manifests and on every injected fault variant (8/8 valid); the dataset and checksum query on PostgreSQL 16 and in postgres:16.4 (480:2ef6f6aa…, stable across time zones); the beacon-report workload under a 64 MiB Docker memory limit (OOMKilled, exit 137) and under 160 MiB (running, ~110 MiB RSS); bash -n and py_compile on every script.']
  });

  lab({
    id: 'L18', moduleId: 'M09', title: 'A deploy bot with least privilege, and default-deny you can prove',
    objectiveIds: ['obj-m09-04', 'obj-m09-03'], executionMode: 'local', estimatedMinutes: 120, environmentProfile: 'kind-policy', prerequisites: ['L17'],
    learnerBrief: 'Two tickets on a separate, policy-enforcing kind cluster. The deploy bot (ServiceAccount beacon-deployer) stops part-way through every release run: give it exactly what its four steps need in namespace beacon and prove what it still cannot do, with `kubectl auth can-i` and real API calls made as that identity. Then security review asks for default-deny segmentation: apply the policies a teammate prepared and prove from inside the real pods that the API resolves and reaches PostgreSQL, that nothing else reaches the database, and that the API reaches nothing else.\n\nThe kind-policy profile disables kind\'s default CNI and installs Calico from a pinned, checksum-verified manifest; its self-test must pass first. A policy that applied cleanly proves nothing; a timeout does.',
    checkpoints: [
      { id: 'c1', title: 'Least privilege for the deploy bot', resumeInstructions: '`bash ' + DIR + 'L18/setup.sh` reuses work/. Re-run the bot with `bash ' + DIR + 'L18/assets/deploy-bot.sh`; your Role is work/manifests/20-rbac.yaml.' },
      { id: 'c2', title: 'Deny and allow, proven from inside the pods', resumeInstructions: 'Apply work/manifests/30-netpol.yaml and run `bash ' + DIR + 'L18/assets/netcheck.sh` at any time; the matrix shows want/got for every path. `reset.sh` starts the same variant over.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'manifests/10-workloads.yaml', 'manifests/20-rbac.yaml', 'manifests/30-netpol.yaml', 'assets/Dockerfile', 'assets/common.sh', 'assets/probe.py', 'assets/netcheck.sh', 'assets/deploy-bot.sh', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json', '../profiles/kind-policy/README.md', '../profiles/kind-policy/kind-config.yaml', '../profiles/kind-policy/versions.env', '../profiles/kind-policy/setup.sh', '../profiles/kind-policy/selftest.sh', '../profiles/kind-policy/teardown.sh'],
    setup: ['bash ' + DIR + 'profiles/kind-policy/setup.sh   # cluster looped-policy + Calico v3.30.3 + enforcement self-test', 'bash ' + DIR + 'L18/setup.sh', 'cat ' + DIR + 'L18/work/TICKETS.md ' + DIR + 'L18/work/deploy-bot.log'],
    faultInjection: ['# setup.sh prepared variant-a (one RBAC rule and one policy rule changed); to choose another:', 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L18/reset.sh'],
    tasks: ['c1: quote the Forbidden line from the bot log (verb, resource, group), check with `auth can-i`, add only the missing verb, re-run the bot to "release run complete".', 'c1: prove the negatives as the ServiceAccount: delete deployments, get secrets, create pods/exec, create rolebindings, list pods in kube-system, list nodes → no.', 'c2: run netcheck.sh before any policy (flat network), apply the teammate\'s policies, run it again and explain each wrong row from its evidence (failed name lookup versus TCP timeout).', 'c2: fix the policy file without deleting default-deny or allowing all egress; netcheck.sh until every row matches; record the CNI line.', 'Write RBAC, Policy and Proof in evidence/L18-notes.md; run validate.py and import the evidence.'],
    validation: [
      { id: 'cluster', description: 'context kind-looped-policy is a local kind cluster', critical: true },
      { id: 'cni-enforcing', description: 'calico-node ready on every node; no kindnet pods', critical: true },
      { id: 'workloads-ready', description: 'beacon-api, beacon-report and beacon-db ready', critical: true },
      { id: 'rbac-allowed', description: 'the bot can get/list/watch/patch deployments, list pods and read pod logs in beacon', critical: true },
      { id: 'rbac-denied', description: 'eleven out-of-scope requests (delete, secrets, exec, RBAC changes, other namespaces, nodes, wildcard) denied', critical: true },
      { id: 'rbac-shape', description: 'namespaced Role without wildcards bound to beacon-deployer only; no ClusterRoleBinding for beacon ServiceAccounts', critical: true },
      { id: 'deploy-bot', description: 'the bot\'s four real API calls succeed as the ServiceAccount; a real get secrets is Forbidden', critical: true },
      { id: 'default-deny', description: 'a policy selects every pod for Ingress and Egress with no rules', critical: true },
      { id: 'no-allow-all', description: 'no empty (allow-everything) rule, every-namespace peer or 0.0.0.0/0', critical: true },
      { id: 'dns-allowed', description: 'API and report pods resolve cluster names', critical: true },
      { id: 'api-to-db', description: 'API → beacon-db:5432 opens and PostgreSQL answers an SSLRequest', critical: true },
      { id: 'report-to-db-denied', description: 'report → database ClusterIP:5432 times out', critical: true },
      { id: 'api-to-report-denied', description: 'API → report ClusterIP:9090 times out', critical: true },
      { id: 'api-to-kube-api-denied', description: 'API → kubernetes Service :443 times out', critical: true },
      { id: 'notes', description: 'RBAC, Policy and Proof sections with substance', critical: true }
    ],
    reset: ['bash ' + DIR + 'L18/reset.sh   # delete L18 objects in looped-policy, keep your manifests in .work-previous/, set up again'],
    teardown: ['bash ' + DIR + 'L18/teardown.sh   # L18 objects and image only', 'bash ' + DIR + 'profiles/kind-policy/teardown.sh   # deletes the looped-policy cluster (asks first)'],
    evidenceInstructions: ['`python3 ' + DIR + 'L18/validate.py --explanation-file ' + DIR + 'L18/evidence/L18-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'The report records can-i answers, probe results and the CNI line; no token is created or stored (impersonation is used).'],
    hints: [
      { level: 1, text: 'Two gates: the API server decides what the bot may ask (RBAC); the CNI decides which packets a pod may send or receive. Forbidden comes from the first, a timeout or failed lookup from the second. Never fix one by widening the other.' },
      { level: 2, text: 'The Forbidden line in work/deploy-bot.log names verb, resource and group; `kubectl auth can-i --list --as system:serviceaccount:beacon:beacon-deployer -n beacon` shows the grant. For the network, netcheck.sh from the real pods, then `kubectl describe networkpolicy` for the selectors the API stored.' },
      { level: 3, text: 'Ask can-i the one question the failing step needs. In the matrix, "dns": "fail" means the pod cannot reach CoreDNS on port 53 in kube-system; "dns": "ok" with "tcp": "timeout" means one direction of the database path is not allowed. Check selector labels with --show-labels on pods and namespaces.' },
      { level: 4, text: 'A: Role lacks patch on deployments; no DNS egress policy — add one to k8s-app=kube-dns in kubernetes.io/metadata.name=kube-system on UDP/TCP 53. B: lacks watch; the DNS rule uses name: kube-system, a label that does not exist. C: lacks list on pods; the database ingress allows app: api instead of app: beacon-api.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T05', 'T04', 'T02'], status: 'execution-not-tested',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L18/reset.sh` (or variant-a/variant-c): a different missing verb and a different policy defect with look-alike symptoms. Diagnose without hints, rewrite RBAC and Policy, validate with `--variant variant-b --assistance independent --out ' + DIR + 'L18/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L18/reset.sh' },
    limits: ['Namespace RBAC with real authorisation decisions (by impersonation) and Kubernetes NetworkPolicy enforced by Calico on a local two-node kind cluster. Not cloud identity, admission policy, L7 policy, internet egress or encryption; another CNI may differ in defaults and logging. Beacon uses its in-memory store here, so API→DB is proven with a PostgreSQL protocol handshake from the API pod.', 'Not executed end to end: kind clusters could not start in the authoring container, so neither the profile (Calico install, self-test) nor the lab ran. What ran: kubeconform -strict on the manifests and on all three injected variants (16–17 resources valid each); the probe script against a real postgres:16.4 container (open, SSLRequest answered "N"), a refused port and an unroutable address (timeout); the Calico v3.30.3 manifest download and its SHA-256; bash -n and py_compile.']
  });

  lab({
    id: 'L19', moduleId: 'M10', title: 'The Beacon chart: render, lint, install, a change that fails, and a rollback',
    objectiveIds: ['obj-m10-01'], executionMode: 'local', estimatedMinutes: 120, environmentProfile: 'kind-basic', prerequisites: ['L16'],
    learnerBrief: 'Beacon now ships as a Helm chart with per-environment values and a values schema. Render and lint it, prove the environment contracts with render assertions (and prove the schema refuses bad values), install staging, then work change request CHG-3104: move staging to 1.5.0 with the approved change values. The change does not go cleanly; staging must keep serving, the change must be corrected rather than forced, and before closing you must show the release history and prove that a rollback restores a compatible build.\n\nNo registry: setup builds the two Beacon builds and loads them into the kind nodes; /version tells you which one answered. The chart at L19/chart is the one cloud extension C03 installs.',
    checkpoints: [
      { id: 'c1', title: 'Render, lint and assert before you install', resumeInstructions: '`bash ' + DIR + 'L19/setup.sh` is idempotent and keeps work/chart. Re-run `python3 ' + DIR + 'L19/assets/render_assert.py ' + DIR + 'L19/work/chart` (or L19/.venv/bin/python) at any time.' },
      { id: 'c2', title: 'The change, the recovery and the rollback drill', resumeInstructions: 'The ticket is work/TICKET.md and the change values work/change/values-1.5.0.yaml; `helm --kube-context kind-looped-foundations history beacon -n beacon` shows where you are. `reset.sh` uninstalls only this release.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'chart/Chart.yaml', 'chart/values.yaml', 'chart/values-staging.yaml', 'chart/values-prod.yaml', 'chart/values.schema.json', 'chart/templates/', 'chart/templates/tests/test-smoke.yaml', 'assets/render_assert.py', 'assets/invalid/', 'assets/Dockerfile', 'assets/common.sh', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['bash ' + DIR + 'L19/setup.sh', 'cat ' + DIR + 'L19/work/TICKET.md'],
    faultInjection: ['# setup.sh wrote the variant-a change request; for another (rewrites the ticket and change values):', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L19/inject.sh'],
    tasks: ['c1: read the schema and the Deployment template; predict what `memory: 256` would do without a schema; lint staging and prod; run render_assert.py; render one invalid fixture and read the error.', 'c1: `helm upgrade --install beacon` with staging values, `helm test`, `helm history`.', 'c2: write a prediction, apply CHG-3104, quote the first real error (Helm\'s or the first Warning event), keep staging serving, correct the change file (never the schema), apply again.', 'c2: rollback drill — roll back to the 1.4.0 revision, show /version, return to 1.5.0, run helm test.', 'Write Render, Change and Rollback in evidence/L19-notes.md; run validate.py and import the evidence.'],
    validation: [
      { id: 'cluster', description: 'context kind-looped-foundations is a local kind cluster', critical: true },
      { id: 'chart-lint', description: 'helm lint passes for staging and prod values', critical: true },
      { id: 'render-assertions', description: 'every environment contract holds and every invalid fixture is refused by the schema', critical: true },
      { id: 'change-corrected', description: 'the change values render looped-l19-beacon:1.5.0 within the staging contract', critical: true },
      { id: 'release-deployed', description: 'release beacon deployed from chart beacon, owned by L19', critical: true },
      { id: 'rollback-in-history', description: 'helm history contains a "Rollback to N" revision', critical: true },
      { id: 'current-values', description: 'the deployed revision pins 1.5.0 on staging values (2 replicas)', critical: true },
      { id: 'rollout', description: '2/2 pods ready and updated on 1.5.0, none waiting on an image pull', critical: true },
      { id: 'smoke', description: 'GET through the Service from inside a pod: ready, version 1.5.0, environment staging', critical: true },
      { id: 'notes', description: 'Render, Change and Rollback sections with substance', critical: true },
      { id: 'chart-version', description: 'if work/chart differs from chart/, its version was bumped (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L19/reset.sh   # uninstall this release only, keep your chart in .work-previous/chart, write the ticket again'],
    teardown: ['bash ' + DIR + 'L19/teardown.sh   # uninstall the L19 release, remove looped-l19-beacon images from nodes and Docker, remove work/ and .venv/'],
    evidenceInstructions: ['`python3 ' + DIR + 'L19/validate.py --explanation-file ' + DIR + 'L19/evidence/L19-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Release history lives in Secrets in namespace beacon; the evidence records revision numbers, statuses and image references only, never values files.'],
    hints: [
      { level: 1, text: 'Decide where the change fails: on your laptop (render against the schema), in the API server, or on the nodes (accepted, but pods cannot start). Each leaves different evidence, and only the last creates a failed revision.' },
      { level: 2, text: 'Helm names a JSON path when the schema refuses a value. For a rollout that times out: `helm history beacon`, `kubectl get pods -o wide`, the first Warning in `kubectl describe pod <new pod>`; `docker images looped-l19-beacon` lists the builds that exist.' },
      { level: 3, text: 'Render the change locally with `helm template … -f values-staging.yaml -f work/change/values-1.5.0.yaml --show-only templates/deployment.yaml`. If it fails, the value is wrong; if it renders, compare the image with what was built and loaded, character by character.' },
      { level: 4, text: 'A: limits.memory 192 is a number (bytes) — write "192Mi". B: 1.5.1 was never built — roll back, use tag "1.5.0". C: registry.lab/beacon is not where the nodes have the image — roll back, use repository looped-l19-beacon. Then: rollback to revision 1, check /version, forward to 1.5.0, helm test.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T13', 'T22', 'T04'], status: 'execution-not-tested',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-c bash ' + DIR + 'L19/reset.sh` (or variant-a/variant-b): the change fails in a different place, so a failed revision may or may not exist. New prediction first, validate with `--variant variant-c --assistance independent --out ' + DIR + 'L19/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L19/reset.sh' },
    limits: ['Chart structure, schema validation, render assertions, release history, upgrade failure handling and rollback on one local kind cluster. Not registry authentication, chart signing/provenance, multi-cluster promotion, admission policy or real traffic; Beacon uses the in-memory store, so no data migrates.', 'Partly executed: helm lint (v3.18.6) for dev/staging/prod, render_assert.py 62/62 on the chart, all five invalid fixtures refused, the three variant change files rendered (A refused by the schema; B/C render with the wrong image and fail change-corrected; corrected A passes), deleting values.schema.json makes render_assert fail (56/62), kubeconform -strict on every rendered environment (4–5 resources valid). Not executed: helm install/upgrade/rollback/test and the cluster checks — kind could not start in the authoring container.']
  });

  lab({
    id: 'L20', moduleId: 'M10', title: 'One digest from commit to prod: a gated pipeline, a reconciler and a rollback you refuse',
    objectiveIds: ['obj-m10-02', 'obj-m10-03', 'obj-m10-04', 'obj-m10-05'], executionMode: 'local', estimatedMinutes: 150, environmentProfile: 'kind-basic', prerequisites: ['L19', 'L13'],
    learnerBrief: 'Rebuild Beacon\'s delivery around three rules: a failing gate blocks a release; an environment runs a digest a pipeline published, never whatever a tag means today; and the cluster runs what git says, enforced by a reconciler. You own a GitHub Actions-style workflow (stored in the lab, run nowhere by default), its local executable equivalent ci-local.sh (tests, docker build, a clearly labelled scan stub, push to a loopback registry with digest capture, promotion commits), a GitOps repository and a minimal reconciler applying git HEAD to the kind cluster. Four tickets arrive: a teammate\'s 1.5.0 merge, an overnight manual fix, a prod promotion phrased as a tag, and an urgent rollback request.\n\nEverything is local; hosted CI is optional and labelled. Evidence says local-only unless you ran the hosted workflow yourself.',
    checkpoints: [
      { id: 'c1', title: 'The gate: a failing test blocks the release', resumeInstructions: '`bash ' + DIR + 'L20/setup.sh` is idempotent. `bash ' + DIR + 'L20/ci-local.sh status` lists promotions and the last runs; stage logs are in work/ci/runs/<run>/.' },
      { id: 'c2', title: 'One digest through staging and prod, and the reconciler', resumeInstructions: 'Restart the loop with `bash ' + DIR + 'L20/reconciler/run.sh` (cluster running). Inject the step you are on once: `inject.sh drift`, then `inject.sh retag`. `reconciler/run.sh --verify-only` checks artifact identities without the cluster.' },
      { id: 'c3', title: 'Secrets and schema compatibility', resumeInstructions: '`bash ' + DIR + 'L20/inject.sh rollback-request` once; decisions are recorded in work/ci/decisions/. `reset.sh` keeps git bundles of both repositories in .work-previous/.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'ci-local.sh', 'pipeline/ci_local.py', 'pipeline/scan_stub.py', 'pipeline/workflows/beacon-ci.yml', 'reconciler/reconcile.py', 'reconciler/run.sh', 'assets/common.sh', 'assets/prepare.sh', 'assets/app/Dockerfile', 'assets/app/release.json', 'assets/app/migrations/', 'assets/app/tests/test_release.py', 'assets/gitops/envs/staging/', 'assets/gitops/envs/prod/', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# Docker, git, Python 3; profile kind-basic running', 'bash ' + DIR + 'L20/setup.sh', 'bash ' + DIR + 'L20/reconciler/run.sh   # second terminal'],
    faultInjection: ['# setup.sh added the teammate\'s 1.5.0 commits (variant-a); later steps, one per checkpoint:', 'bash ' + DIR + 'L20/inject.sh drift', 'bash ' + DIR + 'L20/inject.sh retag', 'bash ' + DIR + 'L20/inject.sh rollback-request'],
    tasks: ['c1: run the pipeline on the 1.5.0 merge, read the blocked stage and the failing assertion against the teammate\'s diff, fix the code (not the test), run again until staging gets the new digest; map each local stage to its hosted job.', 'c2: inject drift, quote the reconciler\'s DRIFT and CORRECTED/REPLACED events, explain field ownership and the two legitimate ways to make an emergency change stick.', 'c2: inject retag, try the release manager\'s tag-based promotion, find out what the tag holds, restore integrity from the recorded digest, promote prod by record with your approval.', 'c3: inject the rollback request, attempt it, record the schema gate\'s decision and a fix-forward/expand-contract plan; confirm no secret is in git, the image or CI logs.', 'Write Gate, Promotion, Reconciler and Schema in evidence/L20-notes.md; run validate.py and import the evidence.'],
    validation: [
      { id: 'workflow-file', description: 'workflow chain test → build → scan → publish → promote staging → promote prod (protected), promotion by digest, no moving refs', critical: true },
      { id: 'tests-intact', description: 'the shipped test files are unchanged in work/app', critical: true },
      { id: 'tests-pass', description: 'the unit tests pass on work/app now', critical: true },
      { id: 'faults-exercised', description: 'gate, drift, retag and rollback-request were injected', critical: true },
      { id: 'gate-blocked', description: 'a run was blocked at test for the regression and the registry has no image for it', critical: true },
      { id: 'artifact-published', description: 'staging runs Beacon 1.5.0 from a passed run after the regression, served by digest', critical: true },
      { id: 'one-digest', description: 'prod runs the digest staging verified, with a human approval', critical: true },
      { id: 'tag-integrity', description: 'the sha tag and the local image still hold that digest', critical: true },
      { id: 'schema-gate', description: 'the prod rollback to 1.4.0 was refused by the schema gate; no schema ever lowered', critical: true },
      { id: 'no-secrets', description: 'no Secret object or credential-like value in git history, CI records or the image', critical: true },
      { id: 'reconciler-corrected', description: 'the reconciler corrected staging drift after the injection', critical: true },
      { id: 'cluster', description: 'context kind-looped-foundations is a local kind cluster', critical: true },
      { id: 'reconciled', description: 'reconciler status for git HEAD, not paused, live objects match git', critical: true },
      { id: 'running-identity', description: 'staging and prod ready and /version reports 1.5.0 at the promoted commit', critical: true },
      { id: 'image-id', description: 'pod imageIDs name the promoted digest or local image (advisory)', critical: false },
      { id: 'notes', description: 'Gate, Promotion, Reconciler and Schema sections with substance', critical: true }
    ],
    reset: ['bash ' + DIR + 'L20/reset.sh   # bundle both repositories into .work-previous/, tear down, set up again'],
    teardown: ['bash ' + DIR + 'L20/teardown.sh   # L20 objects in beacon, registry container and volume, looped-l20 images, work/'],
    evidenceInstructions: ['`python3 ' + DIR + 'L20/validate.py --explanation-file ' + DIR + 'L20/evidence/L20-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'Evidence is labelled local-only. Only if you ran the hosted workflow yourself, set LOOPED_HOSTED_RUN_URL=<run url>; never paste registry tokens into notes or evidence.'],
    hints: [
      { level: 1, text: 'Four truths: the source repository (what was built), the registry (what a tag or digest holds now), the GitOps repository (what each environment should run) and the cluster. For each ticket decide which disagrees before changing anything.' },
      { level: 2, text: 'Stage logs and summary.json under work/ci/runs/; `git -C work/app log --stat`; `ci-local.sh status` and `verify-tag <tag>`; `reconciler/run.sh --verify-only`; work/reconciler/log.jsonl; managedFields on the live Deployment; schema.json and each artifact\'s release.json.' },
      { level: 3, text: 'Gate: run the failing test alone against `git show HEAD`. Drift: compare the live Deployment with `git -C work/gitops show HEAD:envs/staging/deployment.json`. Tag: compare the digest the tag resolves to with promotions/staging.json. Rollback: compare the target\'s schema range with the environment\'s schema.' },
      { level: 4, text: 'A: idempotency lookup scoped to the request id (500 on retry); B: raw path as a metrics label; C: quoted ports accepted — revert that commit. Drift: commit lasting changes or pause with a written reason. Retag: pull the recorded digest, re-tag, promote --from staging --approve. Rollback: 1.4.0 supports schema ≤ 2, prod is at 3 — refuse and fix forward.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T13', 'T06', 'T12', 'T21'], status: 'execution-not-tested',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L20/reset.sh` (or variant-a/variant-c): a different regression, a manual change that survives a plain server-side apply, and a different integrity break. Diagnose without hints, validate with `--variant variant-b --assistance independent --out ' + DIR + 'L20/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L20/reset.sh' },
    limits: ['A local pipeline, a loopback registry:2.8.3 and a 200-line reconciler: proves gates, digest capture, refusal of mutable-tag promotion, reconciliation and a modelled schema gate (a ConfigMap stands in for the database\'s migration state). The default scan is a labelled stub, not a vulnerability scan; no signing, registry auth, hosted run (unless you do one) or real migration. kind cannot pull from the loopback registry, so verified images are loaded with kind load and the digest travels as an annotation.', 'Partly executed in the authoring container (Docker 29, containerd image store, Python 3.13): prepare → baseline run (16 tests, build, scan stub, push, digest from the registry API) → prod promotion with approval → variant-a regression blocked at test with no image published → revert → 1.5.0 published and promoted (schema 2→3) → retag variants a/b/c detected (tag promotion refused, verify-tag exit 1, verify-only refused) and recovered → prod promoted by record → rollback to 1.4.0 refused by the schema gate; the three regressions each fail exactly one Beacon test; validate.py passed 9 of its 11 local checks (faults-exercised and reconciler-corrected need the drift step, which needs the cluster) and failed the cluster checks; editing a test and lowering the schema were caught; teardown removed every looped-l20 object. Not executed: setup.sh, inject.sh drift and the reconciler against a cluster — kind could not start here.']
  });
})();
