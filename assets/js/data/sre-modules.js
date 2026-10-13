/* SRE & Cloud Deployment Foundations — modules, skill objectives and the
   48-week schedule.

   A module references content by id (lessons, labs, scenarios, designs,
   question pools) rather than holding bodies. Hours sum to 168 and the
   validator (tests/data/test-sre-content.js) fails the build if they drift,
   if any referenced id is missing, or if the prerequisite graph has a cycle.

   Lesson, lab and scenario ids: les-mNN-KK, L01..L32, S01..S32, D01..D06. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreModules = LX.sreModules || [];
LX.sreObjectives = LX.sreObjectives || [];
LX.sreWeeks = LX.sreWeeks || [];

(function () {
  function obj(id, moduleId, title, outcome, prereqs, roles, evidence) {
    LX.sreObjectives.push({ id: id, moduleId: moduleId, title: title, observableOutcome: outcome,
      prerequisites: prereqs || [], roleTags: roles || [], evidenceRequired: evidence || [] });
  }
  function les(m, n) { var out = []; for (var i = 1; i <= n; i++) out.push('les-m' + m + '-' + (i < 10 ? '0' + i : i)); return out; }

  /* ═══ M01 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M01', n: 1, cat: 'linux', title: 'Baseline, Git and investigation', weeks: [1, 2], hours: 7,
    why: 'Every later module asks you to look at a broken system and say what you *know*, what you *suspect*, and what would tell them apart. This module sets that habit, puts your work under version control so changes are reviewable and reversible, and establishes the disposable Linux VM the host labs run in. It also measures where you are starting from so the course can skip what you already have.',
    outcomes: ['Diagnose your starting level per domain with the baseline', 'Use branches, focused diffs and reverts for every change you make in the course', 'Separate an observation from a hypothesis and reproduce an error before fixing it', 'Read and validate JSON and YAML by hand and with tools', 'Have a working ARM64 Linux VM and Git workspace'],
    concepts: ['observation vs hypothesis', 'reproduce before fix', 'branch, diff, revert, conflict', 'JSON/YAML structure and validation', 'disposable environments'],
    objectives: ['obj-m01-01', 'obj-m01-02', 'obj-m01-03', 'obj-m01-04'],
    lessons: les('01', 3), labs: ['L01', 'L02'], scenarios: ['S01', 'S02'], designs: [],
    prereqs: [], gate: { questions: 6, passPct: 80 }, sources: ['T12', 'T15'],
    debriefPrompt: 'Describe the failing Beacon process from L01: what you observed, what you first guessed, and which single piece of evidence settled it.'
  });
  obj('obj-m01-01', 'M01', 'Separate observation from hypothesis', 'Given a failing process, writes an evidence log that lists observations, hypotheses and the discriminating check for each, and reproduces the error before changing anything.', [], ['sre', 'support'], ['lab:L01', 'scenario:S01', 'gate:M01']);
  obj('obj-m01-02', 'M01', 'Use Git safely for operational change', 'Makes a change on a branch, produces a focused diff, resolves a small conflict without losing either intended change, and reverts a bad change so behaviour is restored.', [], ['sre', 'deploy'], ['lab:L02', 'scenario:S02']);
  obj('obj-m01-03', 'M01', 'Read and validate structured configuration', 'Reads JSON and YAML, spots type and indentation errors, and validates a file with a tool before applying it.', [], ['sre', 'deploy'], ['lab:L02', 'gate:M01']);
  obj('obj-m01-04', 'M01', 'Operate a disposable Linux lab', 'Creates and resets an ARM64 Linux VM and a Git workspace, and records tool versions as part of evidence.', [], ['sre'], ['lab:L01']);

  /* ═══ M02 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M02', n: 2, cat: 'linux', title: 'Linux service operations', weeks: [3, 4, 5], hours: 10.5,
    why: 'Most things you will deploy end up as a process on a Linux host, inside a container or not. Knowing how a process is started, what it may read, where it logs, which socket it owns and what the kernel does when memory or disk run short is what lets you say "the host is fine, the app is broken" or the reverse — quickly and with evidence.',
    outcomes: ['Explain processes, signals, exit codes and parent/child relationships', 'Run a service under systemd as a dedicated user and read its journal', 'Diagnose permission and path failures without widening permissions', 'Identify CPU, memory and filesystem bottlenecks with the right metric', 'Map a listening socket to its process and configuration'],
    concepts: ['PID, PPID, signals, exit codes', 'users, groups, mode bits, ownership', 'systemd unit lifecycle, journald', 'load average, memory pressure, OOM', 'filesystems, inodes, mounts', 'sockets and ss'],
    objectives: ['obj-m02-01', 'obj-m02-02', 'obj-m02-03', 'obj-m02-04', 'obj-m02-05'],
    lessons: les('02', 5), labs: ['L03', 'L04'], scenarios: ['S03', 'S04'], designs: [],
    prereqs: ['M01'], gate: { questions: 8, passPct: 80 }, sources: ['T15'],
    debriefPrompt: 'Pick either host fault from L04. State the symptom, the two hypotheses you held, the metric that discriminated them, and how you restored service without touching unrelated processes.'
  });
  obj('obj-m02-01', 'M02', 'Run and diagnose a systemd service', 'Writes a unit that runs Beacon as a dedicated user, explains each directive, and uses journalctl/systemctl to find why a unit fails.', ['obj-m01-01'], ['sre', 'deploy'], ['lab:L03', 'scenario:S03']);
  obj('obj-m02-02', 'M02', 'Isolate host versus application failure', 'Given a failing service, decides from process, socket, journal and resource evidence whether the host or the application is at fault.', ['obj-m02-01'], ['sre', 'support'], ['lab:L03', 'lab:L04', 'gate:M02']);
  obj('obj-m02-03', 'M02', 'Fix permission and path faults narrowly', 'Corrects ownership or mode on exactly the files a service user needs and rejects world-writable shortcuts.', ['obj-m02-01'], ['sre', 'security'], ['scenario:S03', 'lab:L03']);
  obj('obj-m02-04', 'M02', 'Identify the resource bottleneck', 'Distinguishes CPU saturation, memory pressure, full blocks and exhausted inodes using load, memory, df -h and df -i evidence, and restores service safely.', ['obj-m02-02'], ['sre'], ['lab:L04', 'scenario:S04']);
  obj('obj-m02-05', 'M02', 'Map sockets to processes', 'Uses ss, lsof and configuration to prove which process owns a port and what interface it listens on.', ['obj-m02-01'], ['sre', 'net'], ['lab:L03', 'gate:M02']);

  /* ═══ M03 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M03', n: 3, cat: 'net', title: 'Networking from packet to request', weeks: [6, 7, 8], hours: 10.5,
    why: 'Deployment work is mostly making one thing reach another thing on purpose and nothing else. That means addresses, routes, name resolution, firewalls in both directions and TLS identity. When a request fails, the fastest engineers narrow by layer: can it resolve, can it connect, does the handshake succeed, does the application answer. This module builds that ladder.',
    outcomes: ['Calculate CIDR ranges and explain routing decisions', 'Explain TCP vs UDP and what each connection error means', 'Trace DNS delegation, recursion and caching, and explain stale answers', 'Reason about NAT and firewall direction', 'Validate a TLS certificate chain and hostname and trace a request through a proxy'],
    concepts: ['IP, CIDR, subnet, route table', 'TCP handshake, UDP, refused vs timeout', 'authoritative vs recursive, TTL, negative caching', 'NAT, stateful firewalls, ingress/egress', 'HTTP semantics, TLS handshake, SAN, chain, load balancer'],
    objectives: ['obj-m03-01', 'obj-m03-02', 'obj-m03-03', 'obj-m03-04', 'obj-m03-05'],
    lessons: les('03', 5), labs: ['L05', 'L06'], scenarios: ['S05', 'S06'], designs: [],
    prereqs: ['M02'], gate: { questions: 8, passPct: 80 }, sources: ['T23'],
    debriefPrompt: 'Explain the blind network fault you diagnosed in week 8: how you narrowed by layer, what you ruled out, and why disabling the firewall or verification would not have been acceptable.'
  });
  obj('obj-m03-01', 'M03', 'Trace a full request path', 'Draws and explains the path of one request from client through DNS, routing, firewall, load balancer and TLS to the application, naming the failure mode at each hop.', ['obj-m02-05'], ['net', 'deploy'], ['lab:L05', 'gate:M03']);
  obj('obj-m03-02', 'M03', 'Reason about addresses and routes', 'Computes CIDR ranges, identifies the route a packet takes, and fixes a bad route or subnet assumption.', [], ['net', 'cloud'], ['lab:L05', 'gate:M03']);
  obj('obj-m03-03', 'M03', 'Diagnose DNS from delegation to cache', 'Proves what the authoritative server says versus what a resolver returns, explains negative caching, and repairs delegation.', ['obj-m03-01'], ['net', 'sre'], ['lab:L05', 'scenario:S05']);
  obj('obj-m03-04', 'M03', 'Isolate routing, DNS, TLS and application failures', 'Given a failed request, uses resolve/connect/handshake/answer evidence to name the failing layer and rejects fixes that bypass verification or firewalls.', ['obj-m03-03'], ['net', 'sre', 'security'], ['scenario:S06', 'lab:L06', 'gate:M03']);
  obj('obj-m03-05', 'M03', 'Validate TLS identity and a reverse proxy', 'Configures a proxy in front of Beacon with a valid certificate for the hostname, inspects the handshake and headers, and fixes a mismatch properly.', ['obj-m03-04'], ['net', 'security'], ['lab:L06', 'scenario:S06']);

  /* ═══ M04 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M04', n: 4, cat: 'python', title: 'Python for operational work', weeks: [9, 10, 11, 12], hours: 14,
    why: 'This is the module built on your stated gap. The goal is not to make you a software engineer in four weeks; it is to make you someone who writes small, tested, honest tools: they parse messy input, fail loudly with a useful exit code, retry only what is safe to retry, and never hang or log a secret. Every later lab reuses what you write here.',
    outcomes: ['Write functions over dicts, lists and sets with clear types', 'Read JSON/CSV/log files and expose a CLI with arguments', 'Handle errors deliberately: exceptions, stderr, exit codes, logging', 'Write unit tests that catch real bugs, including edge cases', 'Call an HTTP API with timeouts, pagination, bounded retries and idempotency awareness', 'Explain O(n) versus O(n²) and bounded-memory processing'],
    concepts: ['types, functions, collections', 'files, json, csv, argparse', 'exceptions, exit codes, logging', 'unittest, fixtures, edge cases', 'timeouts, pagination tokens, retries, backoff, idempotency', 'complexity and streaming'],
    objectives: ['obj-m04-01', 'obj-m04-02', 'obj-m04-03', 'obj-m04-04', 'obj-m04-05', 'obj-m04-06'],
    lessons: les('04', 6), labs: ['L07', 'L08'], scenarios: ['S07', 'S08'], designs: [],
    prereqs: ['M01'], gate: { questions: 8, passPct: 80 }, sources: ['T11'],
    debriefPrompt: 'Explain your L08 client to a teammate: how it bounds time, why it retries only some failures, how it detects a repeated page token, and what it would take to make a POST safe to retry.'
  });
  obj('obj-m04-01', 'M04', 'Write small correct Python functions', 'Implements functions over collections that pass tests for normal, empty and malformed input.', ['obj-m01-03'], ['python', 'sre'], ['lab:L07', 'gate:M04']);
  obj('obj-m04-02', 'M04', 'Build a CLI tool with honest errors', 'Ships a CLI with arguments, errors on stderr, meaningful exit codes and logging, documented in a README.', ['obj-m04-01'], ['python', 'deploy'], ['lab:L07', 'scenario:S07']);
  obj('obj-m04-03', 'M04', 'Write tests that catch real bugs', 'Writes unit tests with fixtures and injected clocks/clients that fail on broken variants and pass on the solution.', ['obj-m04-01'], ['python'], ['lab:L07', 'lab:L08']);
  obj('obj-m04-04', 'M04', 'Handle failure deliberately', 'Chooses between raising, reporting and skipping for each failure class and never swallows an exception silently.', ['obj-m04-02'], ['python', 'sre'], ['scenario:S07', 'gate:M04']);
  obj('obj-m04-05', 'M04', 'Call APIs safely', 'Implements timeouts, pagination with loop detection, bounded retries with backoff for idempotent requests only, and no secret logging.', ['obj-m04-03'], ['python', 'support'], ['lab:L08', 'scenario:S08']);
  obj('obj-m04-06', 'M04', 'Reason about complexity and memory', 'Explains why a tool is O(n) and how to process a file larger than memory.', ['obj-m04-01'], ['python'], ['lab:L07', 'gate:M04']);

  /* ═══ M05 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M05', n: 5, cat: 'cloud', title: 'Cloud architecture and access', weeks: [13, 14, 15], hours: 10.5,
    why: 'You already operate AWS. This module turns that operational familiarity into design ownership: given customer needs, lay out identity, network, compute and data so the request path is explicit, every dependency is named, failure domains are known and recovery is a decision you made rather than a surprise. It uses local fixtures, not a paid account.',
    outcomes: ['Explain an AWS request path including IAM, STS and KMS', 'Evaluate IAM policies the way the service does, including explicit deny and session expiry', 'Lay out subnets, routes and endpoints across two AZs with private data access', 'Choose compute and storage with stated tradeoffs', 'Inventory dependencies and single points of failure and write a recovery plan'],
    concepts: ['request path, control plane vs data plane', 'IAM evaluation, roles, STS, KMS grants', 'region, AZ, subnet, route table, endpoints, NAT', 'managed vs self-managed, stateless vs stateful', 'failure domains, RPO/RTO, cost'],
    objectives: ['obj-m05-01', 'obj-m05-02', 'obj-m05-03', 'obj-m05-04', 'obj-m05-05'],
    lessons: les('05', 5), labs: ['L09', 'L10'], scenarios: ['S09', 'S10'], designs: ['D01'],
    prereqs: ['M03'], gate: { questions: 8, passPct: 80 }, sources: ['T08', 'T18'],
    debriefPrompt: 'Defend one choice from D01 (identity, network or data) and name what two availability zones do not solve.'
  });
  obj('obj-m05-01', 'M05', 'Explain the AWS request and identity path', 'Traces a request through the network and IAM/STS/KMS, naming where each failure would show.', ['obj-m03-01'], ['cloud', 'deploy'], ['lab:L09', 'gate:M05']);
  obj('obj-m05-02', 'M05', 'Evaluate and narrow IAM policies', 'Predicts allow/deny for policy and request fixtures, and proposes a least-privilege change that preserves other boundaries.', ['obj-m05-01'], ['cloud', 'security'], ['lab:L10', 'scenario:S10']);
  obj('obj-m05-03', 'M05', 'Design network paths and endpoints', 'Lays out subnets, routes, endpoints and egress so private workloads reach required services without public exposure.', ['obj-m03-02'], ['cloud', 'net'], ['lab:L09', 'scenario:S09']);
  obj('obj-m05-04', 'M05', 'Choose compute and storage with tradeoffs', 'Justifies managed versus self-managed and stateless versus stateful choices against requirements and cost.', ['obj-m05-01'], ['cloud'], ['design:D01']);
  obj('obj-m05-05', 'M05', 'Inventory dependencies and plan recovery', 'Produces a machine-readable inventory, names single points of failure, and writes a recovery plan with a stated target.', ['obj-m05-03'], ['cloud', 'reliability'], ['lab:L09', 'design:D01']);

  /* ═══ M06 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M06', n: 6, cat: 'iac', title: 'Terraform and desired state', weeks: [16, 17, 18], hours: 10.5,
    why: 'Terraform turns "what should exist" into a plan you can read before anything changes. The skill is not running apply; it is reading a plan and knowing what it will destroy, telling configuration, state and real objects apart, and recovering when they disagree. Labs use local and Docker providers so nothing costs money.',
    outcomes: ['Write HCL with providers, resources, data sources, variables, outputs and validation', 'Read a plan and predict creates, updates and replacements', 'Explain state, locking, drift, import and when each is used', 'Extract a module and separate environment states', 'Contrast desired-state tools with configuration management'],
    concepts: ['providers, resources, data, variables, outputs, locals', 'plan symbols, dependency graph, lockfile', 'state, backend, locking (use_lockfile), drift, import, moved', 'ForceNew and replacement', 'modules, workspaces vs directories'],
    objectives: ['obj-m06-01', 'obj-m06-02', 'obj-m06-03', 'obj-m06-04', 'obj-m06-05'],
    lessons: les('06', 5), labs: ['L11', 'L12'], scenarios: ['S11', 'S12'], designs: [],
    prereqs: ['M01'], gate: { questions: 8, passPct: 80 }, sources: ['T03', 'T17'],
    debriefPrompt: 'Explain a replacement plan from L12: which attribute forced it, what data was at risk, and the approach you chose instead of applying.'
  });
  obj('obj-m06-01', 'M06', 'Author Terraform configuration', 'Writes a configuration with validated inputs, outputs and a dependency graph that passes fmt and validate.', ['obj-m01-03'], ['iac', 'deploy'], ['lab:L11', 'gate:M06']);
  obj('obj-m06-02', 'M06', 'Read a plan and predict its effect', 'Annotates a plan with what will be created, updated in place or replaced, and the data consequence of each.', ['obj-m06-01'], ['iac'], ['lab:L12', 'scenario:S11', 'gate:M06']);
  obj('obj-m06-03', 'M06', 'Manage state, drift and import', 'Detects out-of-band drift, imports a supported resource and reaches a no-change plan without losing intended data.', ['obj-m06-02'], ['iac', 'sre'], ['lab:L12', 'scenario:S12']);
  obj('obj-m06-04', 'M06', 'Make safe lock and backend decisions', 'Decides when a state lock is stale versus active and uses the supported backend locking mechanism rather than deprecated advice.', ['obj-m06-03'], ['iac'], ['scenario:S12', 'gate:M06']);
  obj('obj-m06-05', 'M06', 'Structure modules and environments', 'Extracts a reusable module and separates environment states with a documented promotion path.', ['obj-m06-01'], ['iac', 'deploy'], ['lab:L12']);

  /* ═══ M07 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M07', n: 7, cat: 'containers', title: 'Containers and image delivery', weeks: [19, 20, 21], hours: 10.5,
    why: 'A container is a process with a filesystem image and some kernel isolation, not a tiny VM. Once you hold that model, most container problems become ordinary Linux problems: wrong listen address, wrong user, wrong file, wrong architecture. This module builds Beacon as an image, composes it with its worker and database, and makes you prove persistence and shutdown behaviour.',
    outcomes: ['Explain images, layers and the process model', 'Write a Dockerfile with pinned dependencies, a build context and an unprivileged user', 'Reason about container networks, published ports, DNS and volumes', 'Handle signals and health checks correctly', 'Identify image architecture and digests and build multi-platform images'],
    concepts: ['image, layer, container, entrypoint', 'Dockerfile, .dockerignore, build context, cache', 'bridge networks, service DNS, published ports, volumes', 'PID 1, SIGTERM, healthcheck', 'manifest lists, platform, digest vs tag, Compose'],
    objectives: ['obj-m07-01', 'obj-m07-02', 'obj-m07-03', 'obj-m07-04', 'obj-m07-05'],
    lessons: les('07', 5), labs: ['L13', 'L14'], scenarios: ['S13', 'S14'], designs: [],
    prereqs: ['M02', 'M04'], gate: { questions: 8, passPct: 80 }, sources: ['T06', 'T16'],
    debriefPrompt: 'Explain the architecture mismatch from week 21: how the manifest showed it, why Kubernetes scheduling was the wrong hypothesis, and how you proved the rebuilt image runs.'
  });
  obj('obj-m07-01', 'M07', 'Build and run Beacon as an unprivileged container', 'Builds an image with pinned dependencies, a non-root user and a documented entry point, and proves HTTP works from the intended network.', ['obj-m02-01', 'obj-m04-02'], ['containers', 'deploy'], ['lab:L13', 'gate:M07']);
  obj('obj-m07-02', 'M07', 'Debug container networking', 'Traces a listening socket inside a container to a published port and repairs a loopback binding.', ['obj-m07-01', 'obj-m02-05'], ['containers', 'net'], ['scenario:S13', 'lab:L13']);
  obj('obj-m07-03', 'M07', 'Compose services with persistence and readiness', 'Runs API, worker and PostgreSQL with a named volume, proves data survives recreation and that dependency readiness is checked rather than assumed.', ['obj-m07-01'], ['containers', 'data'], ['lab:L14']);
  obj('obj-m07-04', 'M07', 'Handle signals and health checks', 'Proves graceful SIGTERM handling and a meaningful healthcheck, and explains PID 1 behaviour.', ['obj-m07-01'], ['containers'], ['lab:L14', 'gate:M07']);
  obj('obj-m07-05', 'M07', 'Identify architecture and digests', 'Inspects an image manifest for platform and digest, diagnoses an architecture mismatch, and rebuilds for the right platform.', ['obj-m07-01'], ['containers', 'deploy'], ['scenario:S14', 'lab:L13']);

  /* ═══ M08 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M08', n: 8, cat: 'k8s', title: 'Kubernetes fundamentals', weeks: [22, 23, 24], hours: 10.5,
    why: 'Kubernetes is central to several of your targets. The model to hold is desired state plus controllers: you write objects, controllers make reality match, and every symptom is a gap between the two that some object\'s status or events describe. This module deploys Beacon on a local kind cluster and makes you trace a request from Service to ready Pod.',
    outcomes: ['Explain control plane, nodes, controllers and desired state', 'Relate Pods, ReplicaSets and Deployments and explain self-healing and rollouts', 'Explain Services and EndpointSlices and trace a request to a ready backend', 'Configure workloads with ConfigMaps and Secrets', 'Configure startup, readiness and liveness probes and explain what each does when it fails'],
    concepts: ['API server, etcd, scheduler, kubelet, controllers', 'Pod, ReplicaSet, Deployment, rollout, undo', 'Service, selector, EndpointSlice, targetPort', 'ConfigMap, Secret, env, volume', 'probes and readiness gating'],
    objectives: ['obj-m08-01', 'obj-m08-02', 'obj-m08-03', 'obj-m08-04', 'obj-m08-05'],
    lessons: les('08', 5), labs: ['L15', 'L16'], scenarios: ['S15', 'S16'], designs: [],
    prereqs: ['M07'], gate: { questions: 8, passPct: 80 }, sources: ['T02', 'T04', 'T22'],
    debriefPrompt: 'Explain the readiness failure from S16: the symptom, why deleting probes would have hidden it, and how you verified the user path after the fix.'
  });
  obj('obj-m08-01', 'M08', 'Explain Kubernetes desired state', 'Describes the control-plane components and the reconciliation loop, and explains an object\'s spec/status gap from events.', ['obj-m07-01'], ['k8s', 'deploy'], ['lab:L15', 'gate:M08']);
  obj('obj-m08-02', 'M08', 'Operate Deployments and rollouts', 'Deploys Beacon replicas, explains Deployment→ReplicaSet→Pod, demonstrates self-healing and performs a rollout and undo.', ['obj-m08-01'], ['k8s'], ['lab:L15', 'scenario:S15']);
  obj('obj-m08-03', 'M08', 'Trace traffic through a Service', 'Proves EndpointSlice membership and an actual HTTP response, and repairs selector or targetPort mismatches.', ['obj-m08-02', 'obj-m03-01'], ['k8s', 'net'], ['lab:L16', 'gate:M08']);
  obj('obj-m08-04', 'M08', 'Configure workloads safely', 'Injects configuration through ConfigMaps and Secrets and diagnoses missing keys and image pull failures from events.', ['obj-m08-02'], ['k8s', 'deploy'], ['lab:L16', 'scenario:S15', 'scenario:S16']);
  obj('obj-m08-05', 'M08', 'Use probes correctly', 'Configures startup, readiness and liveness probes, explains what each failure does, and never removes probes to hide a failure.', ['obj-m08-03'], ['k8s', 'reliability'], ['lab:L16', 'scenario:S16']);

  /* ═══ M09 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M09', n: 9, cat: 'k8s', title: 'Kubernetes operations', weeks: [25, 26, 27, 28], hours: 14,
    why: 'Running Kubernetes means scheduling, resource limits, storage, access control, network policy and planned disruption. The infrastructure roles you target expect you to read events and metrics and repair Pending, CrashLoop, OOM, unbound storage and forbidden API calls without guessing, and to enforce segmentation you can prove.',
    outcomes: ['Explain scheduling, requests and limits and read Pending/OOM evidence', 'Diagnose CrashLoopBackOff and OOMKilled from logs, events and metrics', 'Use PVCs and StorageClasses and explain what local storage does not prove', 'Scope access with RBAC and service accounts and verify with auth can-i', 'Write NetworkPolicies on an enforcing CNI and prove deny and allow', 'Explain disruption budgets, drains and scaling'],
    concepts: ['requests, limits, QoS, scheduler predicates, taints', 'CrashLoopBackOff, OOMKilled, exit codes', 'PVC, PV, StorageClass, binding modes', 'Role, RoleBinding, ServiceAccount, can-i', 'NetworkPolicy, default deny, DNS egress', 'PDB, drain, HPA, metrics-server'],
    objectives: ['obj-m09-01', 'obj-m09-02', 'obj-m09-03', 'obj-m09-04', 'obj-m09-05', 'obj-m09-06'],
    lessons: les('09', 6), labs: ['L17', 'L18'], scenarios: ['S17', 'S18'], designs: [],
    prereqs: ['M08'], gate: { questions: 8, passPct: 80 }, sources: ['T05', 'T02'],
    debriefPrompt: 'Write the Kubernetes troubleshooting report for your week-28 independent failure: evidence, cause, fix, verification, and what the local cluster does not prove about production.'
  });
  obj('obj-m09-01', 'M09', 'Diagnose scheduling and resource failures', 'Reads FailedScheduling, OOMKilled and CrashLoopBackOff evidence and restores scheduling without over-provisioning.', ['obj-m08-02'], ['k8s', 'sre'], ['lab:L17', 'scenario:S17', 'gate:M09']);
  obj('obj-m09-02', 'M09', 'Operate persistent storage', 'Binds a PVC through a StorageClass, restores data after a Pod replacement, and states what local volumes do not prove.', ['obj-m09-01'], ['k8s', 'data'], ['lab:L17']);
  obj('obj-m09-03', 'M09', 'Enforce segmentation with NetworkPolicy', 'Writes default-deny plus allow rules on a policy-enabled cluster and proves allowed and denied traffic, including DNS egress.', ['obj-m08-03', 'obj-m03-04'], ['k8s', 'security', 'net'], ['lab:L18', 'scenario:S18']);
  obj('obj-m09-04', 'M09', 'Scope access with RBAC', 'Creates least-privilege Roles and bindings for a service account and verifies with auth can-i and real API calls.', ['obj-m08-04'], ['k8s', 'security'], ['lab:L18', 'gate:M09']);
  obj('obj-m09-05', 'M09', 'Handle disruption and drains', 'Explains PodDisruptionBudgets, performs a controlled drain, and explains why a budget blocked it rather than bypassing it.', ['obj-m09-01'], ['k8s', 'reliability'], ['lab:L17']);
  obj('obj-m09-06', 'M09', 'Reason about scaling', 'Explains HPA prerequisites and the difference between adding replicas and removing a bottleneck.', ['obj-m09-01'], ['k8s', 'reliability'], ['gate:M09']);

  /* ═══ M10 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M10', n: 10, cat: 'delivery', title: 'Helm, CI/CD and GitOps', weeks: [29, 30, 31], hours: 10.5,
    why: 'Deployment engineering is owning how a tested artifact gets from a commit to a restricted environment and back out again if it is wrong. This module packages Beacon as a chart, builds a local pipeline with real gates, promotes one immutable digest through environments, and shows what a reconciler does to an emergency manual fix.',
    outcomes: ['Package Beacon with values, templates and versions and render/lint/upgrade/rollback', 'Author a tests → build → scan → publish → promote workflow with gates', 'Promote an immutable digest and roll back compatibly', 'Explain GitOps reconciliation and how to make a safe emergency change', 'Handle secrets in delivery and reason about schema compatibility'],
    concepts: ['chart, values, templates, release history', 'pipeline stages, artifacts, approvals', 'digest promotion, rollback, compatibility', 'reconciliation, drift, pause', 'secret handling, expand/contract migrations'],
    objectives: ['obj-m10-01', 'obj-m10-02', 'obj-m10-03', 'obj-m10-04', 'obj-m10-05'],
    lessons: les('10', 5), labs: ['L19', 'L20'], scenarios: ['S19', 'S20'], designs: ['D02'],
    prereqs: ['M08', 'M06'], gate: { questions: 8, passPct: 80 }, sources: ['T13'],
    debriefPrompt: 'Explain your D02 delivery design: what identifies the artifact, which gate blocks what, how rollback stays compatible with the database, and what evidence an auditor gets.'
  });
  obj('obj-m10-01', 'M10', 'Package and operate a Helm chart', 'Renders, lints, installs, upgrades and rolls back the Beacon chart and reads release history.', ['obj-m08-04'], ['delivery', 'k8s'], ['lab:L19', 'scenario:S19', 'gate:M10']);
  obj('obj-m10-02', 'M10', 'Build a gated delivery workflow', 'Authors a pipeline whose failing test or scan blocks publication, with a local executable equivalent.', ['obj-m04-03', 'obj-m07-05'], ['delivery', 'python'], ['lab:L20', 'gate:M10']);
  obj('obj-m10-03', 'M10', 'Promote immutable artifacts', 'Promotes one digest through environments and rolls back without changing the artifact identity.', ['obj-m10-02'], ['delivery', 'security'], ['lab:L20', 'design:D02']);
  obj('obj-m10-04', 'M10', 'Work with a reconciler', 'Explains why a manual fix disappears under GitOps and makes a safe source-of-truth or documented pause change.', ['obj-m10-01'], ['delivery', 'k8s'], ['scenario:S20', 'lab:L20']);
  obj('obj-m10-05', 'M10', 'Reason about secrets and schema compatibility', 'Keeps secrets out of charts and logs and recognises an unsafe schema rollback.', ['obj-m10-03'], ['delivery', 'data', 'security'], ['design:D02', 'gate:M10']);

  /* ═══ M11 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M11', n: 11, cat: 'obs', title: 'Observability and SLOs', weeks: [32, 33, 34], hours: 10.5,
    why: 'A dashboard that is green while users fail is worse than no dashboard. This module instruments Beacon with metrics, structured logs and trace context, teaches you to query them, and then makes you define what "working" means as an SLI with a numerator and denominator you can defend, and alert on burn rather than on noise.',
    outcomes: ['Explain logs, metrics and traces and when each answers a question', 'Use RED/USE signals and basic PromQL', 'Read histogram latency and keep label cardinality bounded', 'Define SLIs and SLOs and compute an error budget', 'Alert on sustained user impact and test alert rules with fixtures'],
    concepts: ['signals, correlation, request id, trace context', 'rate, errors, duration; utilisation, saturation, errors', 'histogram_quantile, cardinality', 'SLI numerator/denominator, SLO, budget, burn rate', 'alert rules, no-data vs healthy'],
    objectives: ['obj-m11-01', 'obj-m11-02', 'obj-m11-03', 'obj-m11-04', 'obj-m11-05'],
    lessons: les('11', 5), labs: ['L21', 'L22'], scenarios: ['S21', 'S22'], designs: [],
    prereqs: ['M08', 'M04'], gate: { questions: 8, passPct: 80 }, sources: ['T01', 'T07', 'T14'],
    debriefPrompt: 'State your Beacon availability SLI with its numerator, denominator and exclusions, and explain how the monitor blind spot from S21 would have shown in it.'
  });
  obj('obj-m11-01', 'M11', 'Instrument a service across signals', 'Adds Prometheus metrics, structured logs and trace context to Beacon and correlates one request across all three.', ['obj-m04-02', 'obj-m08-03'], ['obs', 'python'], ['lab:L21', 'gate:M11']);
  obj('obj-m11-02', 'M11', 'Query telemetry to find a latency source', 'Uses RED/USE signals and PromQL to distinguish a slow dependency from local CPU saturation.', ['obj-m11-01'], ['obs', 'sre'], ['lab:L21', 'scenario:S21']);
  obj('obj-m11-03', 'M11', 'Define SLIs and SLOs', 'Writes availability and latency SLIs with explicit exclusions and computes an error budget on fixtures.', ['obj-m11-02'], ['obs', 'reliability'], ['lab:L22', 'gate:M11']);
  obj('obj-m11-04', 'M11', 'Alert on user impact', 'Writes alert rules that fire on sustained burn and clear correctly, distinguish no-data from healthy, and tests them without waiting.', ['obj-m11-03'], ['obs', 'sre'], ['lab:L22', 'scenario:S22']);
  obj('obj-m11-05', 'M11', 'Keep telemetry bounded', 'Identifies a high-cardinality label and keeps label values bounded without losing the needed signal.', ['obj-m11-01'], ['obs'], ['lab:L21']);

  /* ═══ M12 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M12', n: 12, cat: 'data', title: 'Data and distributed design', weeks: [35, 36, 37], hours: 10.5,
    why: 'Stateful components are where outages get expensive. This module gives you working literacy: how a query uses an index, what a long transaction does to a pool, how to prove a restore worked, and how queues, retries, idempotency and caches interact when traffic bursts. Two design workshops turn it into decisions with units.',
    outcomes: ['Read EXPLAIN and add an appropriate index', 'Diagnose lock waits and pool exhaustion without indiscriminate termination', 'Back up and restore and prove the restored data', 'Explain at-least-once delivery, retries and idempotency keys', 'Reason about caches, consistency and bottlenecks'],
    concepts: ['SQL, index, EXPLAIN, plan cost', 'transactions, locks, connection pools', 'backup, restore, RPO/RTO, replication', 'queues, at-least-once, idempotency', 'cache, consistency, backpressure'],
    objectives: ['obj-m12-01', 'obj-m12-02', 'obj-m12-03', 'obj-m12-04', 'obj-m12-05'],
    lessons: les('12', 5), labs: ['L23', 'L24'], scenarios: ['S23', 'S24'], designs: ['D03', 'D04'],
    prereqs: ['M07'], gate: { questions: 8, passPct: 80 }, sources: ['T09', 'T24'],
    debriefPrompt: 'State the RPO/RTO you measured in L24 against the D04 target and say honestly whether the lab met it.'
  });
  obj('obj-m12-01', 'M12', 'Read query plans and index deliberately', 'Explains a plan change after adding an index and when an index would not help.', ['obj-m07-03'], ['data'], ['lab:L23', 'gate:M12']);
  obj('obj-m12-02', 'M12', 'Diagnose locks and pool exhaustion', 'Identifies the blocking transaction and saturated pool from evidence and mitigates without killing unrelated sessions.', ['obj-m12-01'], ['data', 'sre'], ['lab:L23', 'scenario:S23']);
  obj('obj-m12-03', 'M12', 'Back up, restore and prove it', 'Restores into a fresh database, compares counts and checksums, and measures the recovery interval.', ['obj-m12-01'], ['data', 'reliability'], ['lab:L24', 'design:D04']);
  obj('obj-m12-04', 'M12', 'Make retries safe with idempotency', 'Processes duplicate deliveries with an idempotency key so no side effect repeats, and explains the retry boundary.', ['obj-m04-05'], ['data', 'python', 'reliability'], ['lab:L24', 'scenario:S24']);
  obj('obj-m12-05', 'M12', 'Design for bursts and consistency', 'Estimates capacity with units, chooses queue depth, backpressure and ordering scope, and states consistency tradeoffs.', ['obj-m12-04'], ['data', 'design'], ['design:D03', 'gate:M12']);

  /* ═══ M13 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M13', n: 13, cat: 'security', title: 'Secure and disconnected delivery', weeks: [38, 39, 40], hours: 10.5,
    why: 'The cleared and sovereign roles you target deliver software into places with no outbound access and strict evidence requirements. This module practises rotating a credential without leaking it, triaging a vulnerability report honestly, signing and verifying a bundle, installing with egress blocked, and assembling a small evidence package — all with synthetic data and no claim of accreditation.',
    outcomes: ['Apply least privilege and rotate secrets without disclosure', 'Patch a pinned image and triage CVE findings by applicability', 'Produce and verify an SBOM and signature', 'Deliver a complete bundle into an environment with blocked egress', 'Read RMF vocabulary and assemble a minimal synthetic evidence package'],
    concepts: ['least privilege, rotation, revocation', 'patching, CVE applicability, reachable code', 'SBOM, signature, provenance, trusted keys', 'bundle inventory, mirror, bootstrap, revocation', 'controls, inherited vs implemented, POA&M'],
    objectives: ['obj-m13-01', 'obj-m13-02', 'obj-m13-03', 'obj-m13-04', 'obj-m13-05'],
    lessons: les('13', 5), labs: ['L25', 'L26'], scenarios: ['S25', 'S26'], designs: ['D05'],
    prereqs: ['M10'], gate: { questions: 8, passPct: 80 }, sources: ['T10', 'T21'],
    debriefPrompt: 'Walk through your L26 bundle: what was inventoried, how trust was bootstrapped, what you rejected and why, and the residual risks you wrote down.'
  });
  obj('obj-m13-01', 'M13', 'Rotate credentials safely', 'Rotates a synthetic credential so the new one works, the old is revoked, and no secret appears in evidence or logs.', ['obj-m10-05'], ['security', 'sre'], ['lab:L25', 'gate:M13']);
  obj('obj-m13-02', 'M13', 'Patch and triage vulnerabilities', 'Rebuilds a patched pinned image and triages findings into fix, not applicable, already fixed and unknown with reasons.', ['obj-m07-05'], ['security', 'delivery'], ['lab:L25', 'scenario:S25']);
  obj('obj-m13-03', 'M13', 'Produce evidence with RMF literacy', 'Assembles a minimal synthetic control-evidence package naming inherited versus implemented controls and residual risks, without claiming authorization.', ['obj-m13-01'], ['security', 'governance'], ['design:D05', 'gate:M13']);
  obj('obj-m13-04', 'M13', 'Sign, attest and verify artifacts', 'Generates an inventory, SBOM and signature and rejects tampered or untrusted inputs during verification.', ['obj-m10-03'], ['security', 'delivery'], ['lab:L26', 'scenario:S26']);
  obj('obj-m13-05', 'M13', 'Deliver without outbound access', 'Loads a complete bundle into a second environment with external retrieval blocked and documents trusted-key bootstrap and fallback.', ['obj-m13-04'], ['security', 'deploy'], ['lab:L26', 'scenario:S26', 'design:D05']);

  /* ═══ M14 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M14', n: 14, cat: 'reliability', title: 'Reliability engineering and incidents', weeks: [41, 42, 43], hours: 10.5,
    why: 'Incident judgement is your existing strength; this module formalises it and adds the engineering around it: measuring where a service saturates, bounding retries so clients cannot amplify an outage, degrading on purpose, rehearsing recovery with a clock running, and writing a postmortem whose follow-ups someone can actually own.',
    outcomes: ['Measure throughput, latency and saturation under bounded load', 'Bound retries and concurrency and degrade gracefully', 'Assess release risk', 'Run incident roles, communicate concisely and write a blameless postmortem', 'Rehearse DR and reduce toil'],
    concepts: ['load generation, saturation point, headroom', 'retry budgets, timeouts, load shedding, circuit breaking', 'release risk, canary, rollback decision', 'incident commander, comms cadence, postmortem', 'DR rehearsal, toil'],
    objectives: ['obj-m14-01', 'obj-m14-02', 'obj-m14-03', 'obj-m14-04', 'obj-m14-05'],
    lessons: les('14', 5), labs: ['L27', 'L28'], scenarios: ['S27', 'S28'], designs: ['D06'],
    prereqs: ['M11', 'M12'], gate: { questions: 8, passPct: 80 }, sources: ['T01', 'T08'],
    debriefPrompt: 'Give the three-minute incident update for L28, then name the single follow-up you would prioritise and who owns it.'
  });
  obj('obj-m14-01', 'M14', 'Measure capacity and find the bottleneck', 'Runs bounded load, identifies the saturation point, and distinguishes added replicas from removing the real bottleneck.', ['obj-m11-02'], ['reliability', 'obs'], ['lab:L27', 'gate:M14']);
  obj('obj-m14-02', 'M14', 'Bound retries and degrade gracefully', 'Tunes retry, timeout and concurrency limits so user impact falls while data stays correct.', ['obj-m14-01', 'obj-m12-04'], ['reliability', 'sre'], ['lab:L27', 'scenario:S27']);
  obj('obj-m14-03', 'M14', 'Assess release risk', 'Explains how a release can be staged and when to roll back versus fix forward.', ['obj-m10-03'], ['reliability', 'delivery'], ['design:D06', 'gate:M14']);
  obj('obj-m14-04', 'M14', 'Run and communicate an incident', 'Produces a time-stamped update, explicit scope, a defensible recovery-point choice and a blameless postmortem with owned follow-ups.', ['obj-m01-01'], ['reliability', 'support'], ['lab:L28', 'scenario:S28']);
  obj('obj-m14-05', 'M14', 'Rehearse recovery and reduce toil', 'Rehearses a backup-based recovery against a clock and proposes one toil reduction with a measurable effect.', ['obj-m12-03'], ['reliability'], ['lab:L28', 'design:D06']);

  /* ═══ M15 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M15', n: 15, cat: 'multicloud', title: 'Azure/GCP translation and API support', weeks: [44, 45], hours: 7,
    why: 'Several targets are on Azure or GCP, and two are support roles whose daily work is API, authentication and integration diagnosis. This short module maps what you know from AWS onto the other providers without pretending they are equivalent, and practises reproducing a customer-reported API failure in a minimal, sanitised way.',
    outcomes: ['Map AWS concepts to Azure and GCP with differences stated', 'Explain subscription/project identity scopes and private networking', 'Explain managed-Kubernetes responsibility splits', 'Diagnose API auth, quota, timeout and streaming failures with a minimal reproduction'],
    concepts: ['account vs subscription vs project', 'IAM models, roles, scopes', 'VNet/VPC, private endpoints', 'EKS/AKS/GKE responsibilities', '401/403/429, timeouts, streaming, request ids'],
    objectives: ['obj-m15-01', 'obj-m15-02', 'obj-m15-03', 'obj-m15-04'],
    lessons: les('15', 4), labs: ['L29', 'L30'], scenarios: ['S29', 'S30'], designs: [],
    prereqs: ['M05', 'M09'], gate: { questions: 8, passPct: 80 }, sources: ['T19', 'T20'],
    debriefPrompt: 'Explain one identity-scope difference between AWS and either Azure or GCP that would break a naive migration, and how you would check it.'
  });
  obj('obj-m15-01', 'M15', 'Translate between providers honestly', 'Produces an AWS/Azure/GCP decision matrix that names non-equivalences in identity, networking and managed Kubernetes.', ['obj-m05-01', 'obj-m09-04'], ['multicloud', 'cloud'], ['lab:L29', 'scenario:S29', 'gate:M15']);
  obj('obj-m15-02', 'M15', 'Reason about identity scopes', 'Explains account, subscription and project boundaries and how a wrong assumption shows up as a failure.', ['obj-m15-01'], ['multicloud', 'security'], ['scenario:S29', 'gate:M15']);
  obj('obj-m15-03', 'M15', 'Diagnose API failures with a minimal reproduction', 'Isolates caller, auth and service failures, writes a sanitised Python reproduction with request ids, and gives a clear customer update.', ['obj-m04-05'], ['support', 'python'], ['lab:L30', 'scenario:S30']);
  obj('obj-m15-04', 'M15', 'Explain managed-cluster responsibilities', 'States what the provider and the operator each own for a managed Kubernetes service and what changes versus local kind.', ['obj-m09-05'], ['multicloud', 'k8s'], ['lab:L29']);

  /* ═══ M16 ═══════════════════════════════════════════════════════ */
  LX.sreModules.push({
    id: 'M16', n: 16, cat: 'capstone', title: 'Integrated capstone and assessment', weeks: [46, 47, 48], hours: 10.5,
    why: 'Everything so far was bounded. The capstone asks you to rebuild Beacon from your own checked-in artifacts in a clean environment, hit a stated SLO, then diagnose faults you have not seen, make a recovery decision with data at stake, and defend your design. The output is a skills and evidence report and an honest list of what comes next.',
    outcomes: ['Rebuild, deploy, observe and operate Beacon from clean state using course artifacts', 'Diagnose two unseen single faults and one bounded two-fault incident with evidence', 'Demonstrate a verified restore and a compatible rollback', 'Defend five architecture decisions and name remaining gaps'],
    concepts: ['reproducibility', 'evidence-driven diagnosis', 'recovery decisions', 'design defence', 'gap analysis'],
    objectives: ['obj-m16-01', 'obj-m16-02', 'obj-m16-03'],
    lessons: les('16', 3), labs: ['L31', 'L32'], scenarios: ['S31', 'S32'], designs: [],
    prereqs: ['M13', 'M14', 'M15'], gate: { questions: 10, passPct: 80 }, sources: ['T01'],
    debriefPrompt: 'Your ten-minute design defence: five decisions, the alternative you rejected for each, and the gaps you are carrying into the next programme.'
  });
  obj('obj-m16-01', 'M16', 'Rebuild a service from documentation', 'Rebuilds the full Beacon deployment from checked-in assets with least privilege, health, telemetry, seeded data and documented rollback, with no hidden prerequisite.', ['obj-m10-03', 'obj-m13-05'], ['deploy', 'capstone'], ['lab:L31']);
  obj('obj-m16-02', 'M16', 'Diagnose and recover under assessment conditions', 'Diagnoses unseen single and combined faults with evidence, verifies service and data, and retains least privilege.', ['obj-m16-01', 'obj-m14-04'], ['sre', 'capstone'], ['lab:L32', 'scenario:S31', 'scenario:S32']);
  obj('obj-m16-03', 'M16', 'Defend a design and name gaps', 'Justifies five architecture decisions with rejected alternatives and produces a skills/evidence report with a prioritised advanced-course backlog.', ['obj-m16-02'], ['design', 'capstone'], ['gate:M16']);

  /* ═══ Weeks ═════════════════════════════════════════════════════
     Three ~70-minute sessions per learning week. Item kinds: lesson, lab
     (with a checkpoint when the lab spans sessions), scenario (mode), gate,
     design, review (the due queue), recall, debrief, teachback, diagnostic,
     setup. Weekly rows are a schedule, not extra assignments. */
  function wk(n, moduleId, title, main, evidence, sessions) {
    LX.sreWeeks.push({ n: n, moduleId: moduleId, title: title, main: main, evidence: evidence, sessions: sessions });
  }
  function S(title, items, mins) { return { title: title, mins: mins || 70, items: items }; }
  var R = { kind: 'review' };

  wk(1, 'M01', 'Baseline and the Linux lab', 'Baseline, tool inventory, Linux VM preflight, read a request/log trace; begin L01', 'Domain baseline and first hypothesis log', [
    S('Baseline', [{ kind: 'diagnostic', id: 'diag' }]),
    S('Investigation habit and the lab VM', [{ kind: 'lesson', id: 'les-m01-01' }, { kind: 'setup', id: 'linux-arm64' }, { kind: 'lab', id: 'L01', checkpoint: 'c1' }]),
    S('Reproduce the failing process', [{ kind: 'lab', id: 'L01', checkpoint: 'c2' }, { kind: 'scenario', id: 'S01', mode: 'guided' }])
  ]);
  wk(2, 'M01', 'Git, configuration and the first gate', 'Finish L01; L02 Git/config change; S01–02 and M01 gate', 'Reviewed diff, revert and reproducible notes', [
    S('Git for operations', [{ kind: 'lesson', id: 'les-m01-02' }, { kind: 'lesson', id: 'les-m01-03' }, { kind: 'lab', id: 'L02', checkpoint: 'c1' }]),
    S('Conflict, revert, merge failure', [{ kind: 'lab', id: 'L02', checkpoint: 'c2' }, { kind: 'scenario', id: 'S02', mode: 'guided' }, { kind: 'scenario', id: 'S01', mode: 'independent' }]),
    S('Gate and debrief', [R, { kind: 'gate', id: 'M01' }, { kind: 'debrief', id: 'M01' }, { kind: 'teachback', id: 'M01' }])
  ]);
  wk(3, 'M02', 'Service lifecycle', 'L03 service lifecycle, permissions, process/socket mapping', 'Working systemd unit and diagnostic commands explained', [
    S('Processes and permissions', [R, { kind: 'lesson', id: 'les-m02-01' }, { kind: 'lesson', id: 'les-m02-02' }]),
    S('systemd and the journal', [{ kind: 'lesson', id: 'les-m02-03' }, { kind: 'lab', id: 'L03', checkpoint: 'c1' }]),
    S('Sockets and the service user', [{ kind: 'lesson', id: 'les-m02-05' }, { kind: 'lab', id: 'L03', checkpoint: 'c2' }])
  ]);
  wk(4, 'M02', 'Host resource faults', 'L04 bounded host-resource faults', 'CPU/memory/disk evidence table', [
    S('CPU, load and memory', [R, { kind: 'lesson', id: 'les-m02-04' }, { kind: 'lab', id: 'L04', checkpoint: 'c1' }]),
    S('Disk and inodes', [{ kind: 'lab', id: 'L04', checkpoint: 'c2' }]),
    S('Guided incidents', [{ kind: 'scenario', id: 'S03', mode: 'guided' }, { kind: 'scenario', id: 'S04', mode: 'guided' }])
  ]);
  wk(5, 'M02', 'Independent host repair', 'S03–04; independent host repair and M02 gate', 'Cause, mitigation and recovery check', [
    S('Independent variants', [R, { kind: 'scenario', id: 'S03', mode: 'independent' }, { kind: 'scenario', id: 'S04', mode: 'independent' }]),
    S('Independent lab variant', [{ kind: 'lab', id: 'L04', variant: true }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M02' }, { kind: 'debrief', id: 'M02' }, { kind: 'teachback', id: 'M02' }])
  ]);
  wk(6, 'M03', 'Addresses, routes and DNS', 'L05 addressing/routes/DNS; draw packet path', 'CIDR calculations and request-path diagram', [
    S('Addresses and routes', [R, { kind: 'lesson', id: 'les-m03-01' }, { kind: 'lesson', id: 'les-m03-02' }]),
    S('DNS from delegation to cache', [{ kind: 'lesson', id: 'les-m03-03' }, { kind: 'lab', id: 'L05', checkpoint: 'c1' }]),
    S('Routes and resolution in namespaces', [{ kind: 'lab', id: 'L05', checkpoint: 'c2' }])
  ]);
  wk(7, 'M03', 'HTTP, TLS and the proxy', 'L06 HTTP/TLS/proxy; DNS caching replay', 'Successful certificate validation and failure trace', [
    S('NAT, firewalls, HTTP and TLS', [R, { kind: 'lesson', id: 'les-m03-04' }, { kind: 'lesson', id: 'les-m03-05' }]),
    S('TLS reverse proxy before Beacon', [{ kind: 'lab', id: 'L06', checkpoint: 'c1' }]),
    S('Certificate failure trace', [{ kind: 'lab', id: 'L06', checkpoint: 'c2' }, { kind: 'scenario', id: 'S05', mode: 'guided' }])
  ]);
  wk(8, 'M03', 'Blind network fault', 'S05–06; blind network fault and M03 gate', 'Reasoned diagnosis without broad firewall disabling', [
    S('Guided then independent', [R, { kind: 'scenario', id: 'S06', mode: 'guided' }, { kind: 'scenario', id: 'S05', mode: 'independent' }]),
    S('Blind fault', [{ kind: 'scenario', id: 'S06', mode: 'independent' }, { kind: 'lab', id: 'L05', variant: true }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M03' }, { kind: 'debrief', id: 'M03' }, { kind: 'teachback', id: 'M03' }])
  ]);
  wk(9, 'M04', 'Python fundamentals', 'Python fundamentals and L07 parser starter', 'Functions with normal/empty/malformed input tests', [
    S('Types, functions, collections', [R, { kind: 'lesson', id: 'les-m04-01' }, { kind: 'lab', id: 'L07', checkpoint: 'c1' }]),
    S('Files, JSON and the CLI', [{ kind: 'lesson', id: 'les-m04-02' }, { kind: 'lab', id: 'L07', checkpoint: 'c2' }]),
    S('Tests you can trust', [{ kind: 'lesson', id: 'les-m04-04' }, { kind: 'lab', id: 'L07', checkpoint: 'c3' }])
  ]);
  wk(10, 'M04', 'Errors, logs and complexity', 'Finish L07; CLI, errors, logs and complexity', 'Install/run instructions and meaningful exit codes', [
    S('Exceptions and exit codes', [R, { kind: 'lesson', id: 'les-m04-03' }, { kind: 'lab', id: 'L07', checkpoint: 'c4' }]),
    S('Complexity and bounded memory', [{ kind: 'lesson', id: 'les-m04-06' }, { kind: 'lab', id: 'L07', checkpoint: 'c5' }]),
    S('Automation that lies', [{ kind: 'scenario', id: 'S07', mode: 'guided' }])
  ]);
  wk(11, 'M04', 'The API client', 'L08 paginated API client against local fixture', 'Timeout/retry/pagination unit tests', [
    S('HTTP clients', [R, { kind: 'lesson', id: 'les-m04-05' }, { kind: 'lab', id: 'L08', checkpoint: 'c1' }]),
    S('Retries and pagination', [{ kind: 'lab', id: 'L08', checkpoint: 'c2' }]),
    S('Integration fixture', [{ kind: 'lab', id: 'L08', checkpoint: 'c3' }, { kind: 'scenario', id: 'S08', mode: 'guided' }])
  ]);
  wk(12, 'M04', 'Fresh coding variant', 'S07–08; fresh coding variant and M04 gate', 'Independent small script and explanation', [
    S('Independent scenarios', [R, { kind: 'scenario', id: 'S07', mode: 'independent' }, { kind: 'scenario', id: 'S08', mode: 'independent' }]),
    S('Independent script', [{ kind: 'lab', id: 'L07', variant: true }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M04' }, { kind: 'debrief', id: 'M04' }, { kind: 'teachback', id: 'M04' }])
  ]);
  wk(13, 'M05', 'Architecture and failure domains', 'L09 AWS architecture, traffic path and failure domains', 'First architecture draft and assumptions', [
    S('Request path and identity', [R, { kind: 'lesson', id: 'les-m05-01' }, { kind: 'lesson', id: 'les-m05-02' }]),
    S('Regions, subnets, endpoints', [{ kind: 'lesson', id: 'les-m05-03' }, { kind: 'lab', id: 'L09', checkpoint: 'c1' }]),
    S('Inventory and failure domains', [{ kind: 'lesson', id: 'les-m05-05' }, { kind: 'lab', id: 'L09', checkpoint: 'c2' }])
  ]);
  wk(14, 'M05', 'IAM evaluation', 'L10 IAM evaluation fixtures, STS/role boundaries, KMS model', 'Minimal policy change justified', [
    S('Compute and storage choices', [R, { kind: 'lesson', id: 'les-m05-04' }, { kind: 'lab', id: 'L10', checkpoint: 'c1' }]),
    S('Least-privilege patch', [{ kind: 'lab', id: 'L10', checkpoint: 'c2' }]),
    S('Private app cannot reach', [{ kind: 'scenario', id: 'S09', mode: 'guided' }, { kind: 'scenario', id: 'S10', mode: 'guided' }])
  ]);
  wk(15, 'M05', 'Design D01 and the gate', 'D01, S09–10, M05 gate', 'Architecture decision record and recovery plan', [
    S('Design workshop D01', [R, { kind: 'design', id: 'D01' }]),
    S('Independent scenarios', [{ kind: 'scenario', id: 'S09', mode: 'independent' }, { kind: 'scenario', id: 'S10', mode: 'independent' }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M05' }, { kind: 'debrief', id: 'M05' }, { kind: 'teachback', id: 'M05' }])
  ]);
  wk(16, 'M06', 'Terraform lifecycle', 'L11 Terraform lifecycle with local resources', 'Plan/apply/no-change plan evidence', [
    S('HCL and the plan', [R, { kind: 'lesson', id: 'les-m06-01' }, { kind: 'lesson', id: 'les-m06-02' }]),
    S('Local resources', [{ kind: 'lab', id: 'L11', checkpoint: 'c1' }]),
    S('Validation, outputs, lockfile', [{ kind: 'lab', id: 'L11', checkpoint: 'c2' }])
  ]);
  wk(17, 'M06', 'Drift, import and replacement', 'L12 modules, drift, import and replacement on disposable resources', 'Annotated plan and state explanation', [
    S('State, drift, import', [R, { kind: 'lesson', id: 'les-m06-03' }, { kind: 'lesson', id: 'les-m06-04' }]),
    S('Docker provider project', [{ kind: 'lab', id: 'L12', checkpoint: 'c1' }]),
    S('Module extraction and replacement', [{ kind: 'lesson', id: 'les-m06-05' }, { kind: 'lab', id: 'L12', checkpoint: 'c2' }])
  ]);
  wk(18, 'M06', 'Backends, locking and the gate', 'S11–12, backend/locking lesson, M06 gate', 'Safe lock decision and environment separation', [
    S('Plan wants to replace', [R, { kind: 'scenario', id: 'S11', mode: 'guided' }, { kind: 'scenario', id: 'S12', mode: 'guided' }]),
    S('Independent variants', [{ kind: 'scenario', id: 'S11', mode: 'independent' }, { kind: 'scenario', id: 'S12', mode: 'independent' }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M06' }, { kind: 'debrief', id: 'M06' }, { kind: 'teachback', id: 'M06' }])
  ]);
  wk(19, 'M07', 'Beacon as a container', 'L13 build/run Beacon as an unprivileged container', 'Dockerfile and health check', [
    S('Images and the process model', [R, { kind: 'lesson', id: 'les-m07-01' }, { kind: 'lesson', id: 'les-m07-02' }]),
    S('Build it', [{ kind: 'lab', id: 'L13', checkpoint: 'c1' }]),
    S('Networks, users, health', [{ kind: 'lesson', id: 'les-m07-03' }, { kind: 'lesson', id: 'les-m07-04' }, { kind: 'lab', id: 'L13', checkpoint: 'c2' }])
  ]);
  wk(20, 'M07', 'Compose', 'L14 Compose API/worker/database; volume and network tests', 'Persistence and graceful-shutdown evidence', [
    S('Architectures and Compose', [R, { kind: 'lesson', id: 'les-m07-05' }, { kind: 'lab', id: 'L14', checkpoint: 'c1' }]),
    S('Persistence and readiness', [{ kind: 'lab', id: 'L14', checkpoint: 'c2' }]),
    S('Running but unreachable', [{ kind: 'scenario', id: 'S13', mode: 'guided' }, { kind: 'scenario', id: 'S14', mode: 'guided' }])
  ]);
  wk(21, 'M07', 'Architecture mismatch', 'S13–14, architecture mismatch walkthrough, M07 gate', 'Image digest/architecture record and independent repair', [
    S('Independent scenarios', [R, { kind: 'scenario', id: 'S13', mode: 'independent' }, { kind: 'scenario', id: 'S14', mode: 'independent' }]),
    S('Independent lab variant', [{ kind: 'lab', id: 'L13', variant: true }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M07' }, { kind: 'debrief', id: 'M07' }, { kind: 'teachback', id: 'M07' }])
  ]);
  wk(22, 'M08', 'kind cluster and controllers', 'L15 kind cluster, controllers, deployment and self-healing', 'Object relationship explanation and tested manifests', [
    S('Desired state', [R, { kind: 'lesson', id: 'les-m08-01' }, { kind: 'lesson', id: 'les-m08-02' }]),
    S('Deploy Beacon replicas', [{ kind: 'setup', id: 'kind-basic' }, { kind: 'lab', id: 'L15', checkpoint: 'c1' }]),
    S('Self-healing and invalid objects', [{ kind: 'lab', id: 'L15', checkpoint: 'c2' }])
  ]);
  wk(23, 'M08', 'Services, config and probes', 'L16 Service/config/probes/rollout', 'Request trace through Service and ready endpoints', [
    S('Services and configuration', [R, { kind: 'lesson', id: 'les-m08-03' }, { kind: 'lesson', id: 'les-m08-04' }]),
    S('Expose and configure', [{ kind: 'lab', id: 'L16', checkpoint: 'c1' }]),
    S('Probes', [{ kind: 'lesson', id: 'les-m08-05' }, { kind: 'lab', id: 'L16', checkpoint: 'c2' }])
  ]);
  wk(24, 'M08', 'Image and config incidents', 'S15–16 and M08 gate', 'Recovery from image/config error with verification', [
    S('Guided incidents', [R, { kind: 'scenario', id: 'S15', mode: 'guided' }, { kind: 'scenario', id: 'S16', mode: 'guided' }]),
    S('Independent incidents', [{ kind: 'scenario', id: 'S15', mode: 'independent' }, { kind: 'scenario', id: 'S16', mode: 'independent' }, { kind: 'lab', id: 'L16', variant: true }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M08' }, { kind: 'debrief', id: 'M08' }, { kind: 'teachback', id: 'M08' }])
  ]);
  wk(25, 'M09', 'Scheduling and resources', 'L17 scheduling/resources and bounded load', 'Pending/OOM diagnosis from events and metrics', [
    S('Scheduling, requests, limits', [R, { kind: 'lesson', id: 'les-m09-01' }, { kind: 'lesson', id: 'les-m09-02' }]),
    S('Pending versus OOM', [{ kind: 'lab', id: 'L17', checkpoint: 'c1' }]),
    S('Scaling', [{ kind: 'lesson', id: 'les-m09-06' }, { kind: 'lab', id: 'L17', checkpoint: 'c2' }])
  ]);
  wk(26, 'M09', 'Storage and disruption', 'L17 continuation: storage and disruption drill', 'Persistence and eviction/drain explanation', [
    S('Storage', [R, { kind: 'lesson', id: 'les-m09-03' }, { kind: 'lab', id: 'L17', checkpoint: 'c3' }]),
    S('Disruption drill', [{ kind: 'lab', id: 'L17', checkpoint: 'c4' }]),
    S('Pod remains Pending', [{ kind: 'scenario', id: 'S17', mode: 'guided' }])
  ]);
  wk(27, 'M09', 'RBAC and policy', 'L18 namespace RBAC and policy-enabled cluster', 'Allowed and denied traffic/access tests', [
    S('RBAC and NetworkPolicy', [R, { kind: 'lesson', id: 'les-m09-04' }, { kind: 'lesson', id: 'les-m09-05' }]),
    S('Least privilege', [{ kind: 'setup', id: 'kind-policy' }, { kind: 'lab', id: 'L18', checkpoint: 'c1' }]),
    S('Deny and allow', [{ kind: 'lab', id: 'L18', checkpoint: 'c2' }, { kind: 'scenario', id: 'S18', mode: 'guided' }])
  ]);
  wk(28, 'M09', 'Changed independent failure', 'S17–18, changed independent failure, M09 gate', 'Full Kubernetes troubleshooting report', [
    S('Independent incidents', [R, { kind: 'scenario', id: 'S17', mode: 'independent' }, { kind: 'scenario', id: 'S18', mode: 'independent' }]),
    S('Independent lab variant', [{ kind: 'lab', id: 'L17', variant: true }]),
    S('Gate and report', [{ kind: 'gate', id: 'M09' }, { kind: 'debrief', id: 'M09' }, { kind: 'teachback', id: 'M09' }])
  ]);
  wk(29, 'M10', 'Helm', 'L19 package Helm values and test render/upgrade', 'Chart, validation output and rollback evidence', [
    S('Charts and values', [R, { kind: 'lesson', id: 'les-m10-01' }, { kind: 'lab', id: 'L19', checkpoint: 'c1' }]),
    S('Upgrade and rollback', [{ kind: 'lab', id: 'L19', checkpoint: 'c2' }]),
    S('Pipelines', [{ kind: 'lesson', id: 'les-m10-02' }, { kind: 'lesson', id: 'les-m10-03' }])
  ]);
  wk(30, 'M10', 'CI and reconciliation', 'L20 CI workflow and reconciled release', 'One artifact digest promoted through environments', [
    S('Gated workflow', [R, { kind: 'lab', id: 'L20', checkpoint: 'c1' }]),
    S('Promotion and the reconciler', [{ kind: 'lesson', id: 'les-m10-04' }, { kind: 'lab', id: 'L20', checkpoint: 'c2' }]),
    S('Secrets and schema', [{ kind: 'lesson', id: 'les-m10-05' }, { kind: 'lab', id: 'L20', checkpoint: 'c3' }])
  ]);
  wk(31, 'M10', 'Design D02 and the gate', 'D02, S19–20, M10 gate', 'Delivery diagram and schema-compatibility decision', [
    S('Design workshop D02', [R, { kind: 'design', id: 'D02' }]),
    S('Incidents', [{ kind: 'scenario', id: 'S19', mode: 'guided' }, { kind: 'scenario', id: 'S20', mode: 'guided' }, { kind: 'scenario', id: 'S19', mode: 'independent' }, { kind: 'scenario', id: 'S20', mode: 'independent' }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M10' }, { kind: 'debrief', id: 'M10' }, { kind: 'teachback', id: 'M10' }])
  ]);
  wk(32, 'M11', 'Instrumentation', 'L21 instrument logs/metrics/traces; bounded load', 'Dashboard and linked request/trace evidence', [
    S('Signals and RED/USE', [R, { kind: 'lesson', id: 'les-m11-01' }, { kind: 'lesson', id: 'les-m11-02' }]),
    S('Instrument Beacon', [{ kind: 'setup', id: 'observability' }, { kind: 'lab', id: 'L21', checkpoint: 'c1' }]),
    S('Histograms and cardinality', [{ kind: 'lesson', id: 'les-m11-03' }, { kind: 'lab', id: 'L21', checkpoint: 'c2' }])
  ]);
  wk(33, 'M11', 'SLIs, SLOs, alerts', 'L22 SLI/SLO/error budget; evaluate alert fixtures', 'Written SLO, denominator exclusions and alert tests', [
    S('SLIs and SLOs', [R, { kind: 'lesson', id: 'les-m11-04' }, { kind: 'lab', id: 'L22', checkpoint: 'c1' }]),
    S('Alerting', [{ kind: 'lesson', id: 'les-m11-05' }, { kind: 'lab', id: 'L22', checkpoint: 'c2' }]),
    S('Dashboard green, users failing', [{ kind: 'scenario', id: 'S21', mode: 'guided' }, { kind: 'scenario', id: 'S22', mode: 'guided' }])
  ]);
  wk(34, 'M11', 'Monitor blind spots', 'S21–22, monitor blind spots, M11 gate', 'User-impact detection and verification', [
    S('Independent incidents', [R, { kind: 'scenario', id: 'S21', mode: 'independent' }, { kind: 'scenario', id: 'S22', mode: 'independent' }]),
    S('Independent lab variant', [{ kind: 'lab', id: 'L22', variant: true }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M11' }, { kind: 'debrief', id: 'M11' }, { kind: 'teachback', id: 'M11' }])
  ]);
  wk(35, 'M12', 'Queries, locks and pools', 'L23 queries/index/pool/transaction exercise; D03', 'Before/after plans and safe troubleshooting notes', [
    S('SQL and indexes', [R, { kind: 'lesson', id: 'les-m12-01' }, { kind: 'lab', id: 'L23', checkpoint: 'c1' }]),
    S('Transactions and pools', [{ kind: 'lesson', id: 'les-m12-02' }, { kind: 'lab', id: 'L23', checkpoint: 'c2' }]),
    S('Design workshop D03', [{ kind: 'lesson', id: 'les-m12-05' }, { kind: 'design', id: 'D03' }])
  ]);
  wk(36, 'M12', 'Backups and duplicates', 'L24 backup/restore/queue duplicates; D04', 'Restored-record verification and idempotency test', [
    S('Backups and restores', [R, { kind: 'lesson', id: 'les-m12-03' }, { kind: 'lab', id: 'L24', checkpoint: 'c1' }]),
    S('Queues and idempotency', [{ kind: 'lesson', id: 'les-m12-04' }, { kind: 'lab', id: 'L24', checkpoint: 'c2' }]),
    S('Design workshop D04', [{ kind: 'design', id: 'D04' }])
  ]);
  wk(37, 'M12', 'Design tradeoffs and the gate', 'S23–24, design tradeoffs, M12 gate', 'RPO/RTO statement with measured lab recovery', [
    S('Incidents', [R, { kind: 'scenario', id: 'S23', mode: 'guided' }, { kind: 'scenario', id: 'S24', mode: 'guided' }]),
    S('Independent incidents', [{ kind: 'scenario', id: 'S23', mode: 'independent' }, { kind: 'scenario', id: 'S24', mode: 'independent' }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M12' }, { kind: 'debrief', id: 'M12' }, { kind: 'teachback', id: 'M12' }])
  ]);
  wk(38, 'M13', 'Access, rotation, patching', 'L25 access/secret rotation/patch drill and CVE fixture', 'Rotation without secret disclosure and patched artifact', [
    S('Least privilege and rotation', [R, { kind: 'lesson', id: 'les-m13-01' }, { kind: 'lab', id: 'L25', checkpoint: 'c1' }]),
    S('Patching and CVE triage', [{ kind: 'lesson', id: 'les-m13-02' }, { kind: 'lab', id: 'L25', checkpoint: 'c2' }]),
    S('Scan flags many findings', [{ kind: 'scenario', id: 'S25', mode: 'guided' }])
  ]);
  wk(39, 'M13', 'Bundle, sign, verify, deliver', 'L26 bundle, sign, verify and deploy with restricted egress', 'Manifest, trusted-key verification and inventory', [
    S('Provenance', [R, { kind: 'lesson', id: 'les-m13-03' }, { kind: 'lab', id: 'L26', checkpoint: 'c1' }]),
    S('Isolated delivery', [{ kind: 'lesson', id: 'les-m13-04' }, { kind: 'lab', id: 'L26', checkpoint: 'c2' }]),
    S('Disconnected install fails', [{ kind: 'scenario', id: 'S26', mode: 'guided' }])
  ]);
  wk(40, 'M13', 'Evidence package and the gate', 'D05, S25–26, synthetic control evidence, M13 gate', 'Minimal evidence package and residual risks', [
    S('RMF literacy and D05', [R, { kind: 'lesson', id: 'les-m13-05' }, { kind: 'design', id: 'D05' }]),
    S('Independent incidents', [{ kind: 'scenario', id: 'S25', mode: 'independent' }, { kind: 'scenario', id: 'S26', mode: 'independent' }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M13' }, { kind: 'debrief', id: 'M13' }, { kind: 'teachback', id: 'M13' }])
  ]);
  wk(41, 'M14', 'Capacity and overload', 'L27 capacity test and overload mitigation', 'Bounded load graph, saturation point and assumptions', [
    S('Load and capacity', [R, { kind: 'lesson', id: 'les-m14-01' }, { kind: 'lab', id: 'L27', checkpoint: 'c1' }]),
    S('Bounded retries and degradation', [{ kind: 'lesson', id: 'les-m14-02' }, { kind: 'lab', id: 'L27', checkpoint: 'c2' }]),
    S('Scaling makes it worse', [{ kind: 'lesson', id: 'les-m14-03' }, { kind: 'scenario', id: 'S27', mode: 'guided' }])
  ]);
  wk(42, 'M14', 'Incident rehearsal', 'L28 incident tabletop and recovery rehearsal', 'Timeline, stakeholder update and restoration evidence', [
    S('Incident roles and comms', [R, { kind: 'lesson', id: 'les-m14-04' }, { kind: 'lab', id: 'L28', checkpoint: 'c1' }]),
    S('Recovery rehearsal', [{ kind: 'lesson', id: 'les-m14-05' }, { kind: 'lab', id: 'L28', checkpoint: 'c2' }]),
    S('It came back', [{ kind: 'scenario', id: 'S28', mode: 'guided' }])
  ]);
  wk(43, 'M14', 'Design D06 and the gate', 'D06, S27–28, M14 gate', 'Postmortem, prioritized follow-ups and design defense', [
    S('Design workshop D06', [R, { kind: 'design', id: 'D06' }]),
    S('Independent incidents', [{ kind: 'scenario', id: 'S27', mode: 'independent' }, { kind: 'scenario', id: 'S28', mode: 'independent' }]),
    S('Gate and postmortem', [{ kind: 'gate', id: 'M14' }, { kind: 'debrief', id: 'M14' }, { kind: 'teachback', id: 'M14' }])
  ]);
  wk(44, 'M15', 'Provider translation', 'L29 provider translation; S29', 'AWS/Azure/GCP decision matrix with differences', [
    S('Translation and identity scopes', [R, { kind: 'lesson', id: 'les-m15-01' }, { kind: 'lesson', id: 'les-m15-02' }]),
    S('Networking and managed clusters', [{ kind: 'lesson', id: 'les-m15-03' }, { kind: 'lab', id: 'L29', checkpoint: 'c1' }]),
    S('Migration access works differently', [{ kind: 'scenario', id: 'S29', mode: 'guided' }, { kind: 'scenario', id: 'S29', mode: 'independent' }])
  ]);
  wk(45, 'M15', 'API support case and the gate', 'L30 local API support case; S30; M15 gate', 'Minimal reproduction and customer-facing explanation', [
    S('API support', [R, { kind: 'lesson', id: 'les-m15-04' }, { kind: 'lab', id: 'L30', checkpoint: 'c1' }]),
    S('Random API failures', [{ kind: 'scenario', id: 'S30', mode: 'guided' }, { kind: 'scenario', id: 'S30', mode: 'independent' }]),
    S('Gate and debrief', [{ kind: 'gate', id: 'M15' }, { kind: 'debrief', id: 'M15' }, { kind: 'teachback', id: 'M15' }])
  ]);
  wk(46, 'M16', 'Fresh build', 'L31 fresh build from checked-in assets, target SLO', 'Release bundle, smoke tests and architecture', [
    S('Rebuild from documentation', [R, { kind: 'lesson', id: 'les-m16-01' }, { kind: 'lab', id: 'L31', checkpoint: 'c1' }]),
    S('Deploy and observe', [{ kind: 'lab', id: 'L31', checkpoint: 'c2' }]),
    S('Seed, verify, document', [{ kind: 'lab', id: 'L31', checkpoint: 'c3' }])
  ]);
  wk(47, 'M16', 'Incident campaign', 'L32 independent incident campaign; S31–32', 'Evidence-driven fixes, restore and rollback decisions', [
    S('Unseen faults', [R, { kind: 'lesson', id: 'les-m16-02' }, { kind: 'lab', id: 'L32', checkpoint: 'c1' }]),
    S('Combined incident', [{ kind: 'lab', id: 'L32', checkpoint: 'c2' }]),
    S('Restricted release and missing data', [{ kind: 'scenario', id: 'S31', mode: 'independent' }, { kind: 'scenario', id: 'S32', mode: 'independent' }])
  ]);
  wk(48, 'M16', 'Defence, recall and the final gate', 'Capstone design defense, delayed recall and final gate', 'Skills/evidence report and advanced-course backlog', [
    S('Design defence', [R, { kind: 'lesson', id: 'les-m16-03' }, { kind: 'lab', id: 'L32', checkpoint: 'c3' }]),
    S('Delayed recall', [{ kind: 'review', id: 'final' }, { kind: 'gate', id: 'M16' }]),
    S('Report and backlog', [{ kind: 'debrief', id: 'M16' }, { kind: 'teachback', id: 'M16' }])
  ]);
})();
