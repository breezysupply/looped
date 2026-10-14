/* SRE & Cloud Deployment Foundations — optional role branches B01–B08 and
   cloud extensions C01–C05 (curriculum §10).

   Branches follow the core or replace optional review time; they never add
   silently to the 168 core hours. They are specifications with starter
   exercises: status 'authored-spec' means the exercise is written but has no
   shipped, executed lab directory. Role names come from the recovered job
   inventory (J-sources); nothing here claims knowledge of an employer's
   internal stack.

   Cloud extensions are DISABLED by default. Opting in in the hub only shows
   the commands after the learner names a sandbox account, a spending limit
   and an expiry and confirms the checklist. Nothing runs from the app. Cost
   lines are order-of-magnitude notes from authoring time, not quotes: the
   learner checks the provider's calculator for their region first. Budget
   alerts are notifications, not caps. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreBranches = LX.sreBranches || [];
LX.sreCloud = LX.sreCloud || [];

(function () {
  var B = function (x) { x.status = x.status || 'authored-spec'; LX.sreBranches.push(x); };

  B({
    id: 'B01', title: 'Data reliability (Workday-style data platform roles)', hours: [10, 14], prereqs: ['M12', 'M14'],
    audience: 'For roles where the database is the service: replication, failover, query and pool tuning, point-in-time recovery and migration rollback.',
    caveat: 'PostgreSQL is a transferable teaching choice, not a claim about any employer\'s stack. Select the engine from a verified current posting before going deeper.',
    objectives: ['Explain synchronous versus asynchronous replication and measure replica lag in bytes and seconds', 'Perform and verify a point-in-time restore to a named timestamp', 'Diagnose a lock cascade from pg_locks/pg_stat_activity and end it with the narrowest action', 'Plan an expand/contract migration with a tested rollback'],
    sequence: ['Re-read M12 lessons 02 and 03; redo L23 with a 10× dataset', 'Exercise B01-1 (replica lag and failover)', 'Exercise B01-2 (point-in-time restore)', 'Incidents: lock cascade, unsafe schema migration (paper drills using L23/L24 environments)', 'Write a one-page failover runbook and have it reviewed'],
    exercises: [
      { id: 'B01-1', title: 'Replica lag and a controlled failover', mins: 150, brief: 'Run a primary and a streaming replica as two PostgreSQL 16 containers in a `looped-b01` Compose project. Generate write load with pgbench, watch lag in `pg_stat_replication`, then fail over deliberately and reconnect Beacon to the new primary.',
        steps: ['Start `looped-b01` with a primary and a replica using `primary_conninfo` and a replication slot', 'Run `pgbench -c 8 -T 120` against the primary and record `write_lag`, `replay_lag` and byte lag every 10 s', 'Stop the primary, fence it (remove it from the network), promote the replica with `pg_ctl promote` or `SELECT pg_promote()`', 'Point Beacon at the new primary and count records written before and after'],
        pass: ['Lag measured in both seconds and bytes, with the query used', 'Old primary fenced before promotion; no two writers', 'Records committed before the failover are all present; any loss is quantified'] },
      { id: 'B01-2', title: 'Point-in-time restore to just before a bad DELETE', mins: 120, brief: 'With WAL archiving to a local directory, take a base backup, run a bad `DELETE` at a recorded time, and restore a fresh instance to one second before it.',
        steps: ['Enable `archive_mode` and `archive_command` into a lab-owned directory', '`pg_basebackup` into another lab-owned directory', 'Insert marker rows, note the time, run the bad DELETE', 'Restore with `recovery_target_time` into a new container; compare counts and sampled rows with a pre-incident export'],
        pass: ['Restored instance contains the marker rows and none of the deletion', 'Recovery interval measured from start to verified', 'Report states what a production-sized restore would add'] }
    ]
  });

  B({
    id: 'B02', title: 'Observability platform and coding depth (Ford-style roles)', hours: [12, 18], prereqs: ['M11', 'M04'],
    audience: 'For observability-platform SRE roles: telemetry pipelines, cardinality and retention, collector backpressure, and real service code with tests.',
    caveat: 'Years of production programming are an experience requirement this branch cannot replace; it adds deliberate practice, not seniority.',
    objectives: ['Design a telemetry pipeline with explicit backpressure and drop accounting', 'Estimate series cardinality and retention cost from label sets', 'Build and test a small ingestion component with bounded memory', 'Map the pipeline to Google Cloud managed services without claiming equivalence'],
    sequence: ['Re-run L21 with the high-cardinality fixture and calculate series counts', 'Exercise B02-1 (recover dropped telemetry)', 'Exercise B02-2 (ingestion component)', 'Short design note: the same pipeline on GCP, with differences listed'],
    exercises: [
      { id: 'B02-1', title: 'Find and recover dropped telemetry', mins: 150, brief: 'An OpenTelemetry Collector in the observability profile is configured with a memory limiter and a small queue; under a burst, spans disappear. Find where they are dropped from the Collector\'s own metrics and fix the configuration without simply raising every limit.',
        steps: ['Start the observability profile and the burst generator', 'Read `otelcol_processor_refused_spans`, `otelcol_exporter_queue_size` and send-failed metrics', 'Identify which component refuses or drops, and why', 'Change batch/queue/retry settings with a stated memory budget and re-run the burst'],
        pass: ['Drop location named from the Collector\'s own metrics', 'After the change, drops are zero or accounted for at the documented budget', 'Memory stays within the stated limit'] },
      { id: 'B02-2', title: 'A small ingestion component with tests', mins: 180, brief: 'Write a Python (or Go) service that accepts JSON metric points over HTTP, validates them, batches them with a size and time bound, and forwards them; prove its behaviour under slow downstream with tests.',
        steps: ['Define the input schema and rejection responses', 'Implement a bounded queue with explicit drop counting', 'Write unit tests for validation, batching edges and backpressure', 'Run a load test and record p99 latency and memory'],
        pass: ['Tests cover malformed input, empty batch, full queue and slow downstream', 'Memory bounded under a downstream stall', 'Drops are counted and exposed as a metric'] }
    ]
  });

  B({
    id: 'B03', title: 'Deployment at the edge and in disconnected sites (Anduril/Gallatin-style roles)', hours: [10, 14], prereqs: ['M13', 'M09'],
    audience: 'For deployment-engineering roles: multi-cluster inventory, supported upgrades, offline dependency mirrors, certificate and key rotation, hardening evidence and constrained remote recovery.',
    caveat: 'Training abstraction only. Nothing here implies IL5, IL6 or ATO certification, or knowledge of any programme\'s real procedures.',
    objectives: ['Keep an accurate multi-cluster inventory of versions and artifacts', 'Rehearse a supported Kubernetes minor-version upgrade with version-skew checks', 'Refresh a complete offline bundle and prove nothing is pulled externally', 'Rotate a certificate and signing key with an overlap window'],
    sequence: ['Redo L26 with the tampered and missing-dependency variants', 'Exercise B03-1 (version-skew rehearsal)', 'Exercise B03-2 (full offline bundle refresh)', 'Write a remote-site recovery checklist that assumes no outbound access'],
    exercises: [
      { id: 'B03-1', title: 'Version-skew rehearsal on two kind clusters', mins: 150, brief: 'Create two kind clusters with pinned node images one minor version apart, inventory them, and plan an upgrade that respects the documented version-skew policy for kubelet, kube-apiserver and kubectl.',
        steps: ['Create `looped-b03-a` and `looped-b03-b` with pinned node images', 'Inventory server, kubelet and kubectl versions and every image in use', 'Check the skew policy and deprecated APIs in your manifests', 'Upgrade the older cluster by recreating it at the newer pinned image and redeploy Beacon from the bundle'],
        pass: ['Inventory is machine-readable and complete', 'Upgrade order respects the skew policy, with the source cited', 'Beacon redeployed from the bundle with no external pull'] },
      { id: 'B03-2', title: 'Full offline bundle refresh', mins: 150, brief: 'Produce next month\'s bundle: rebuild patched images, re-render the chart, extract every image digest, sign the manifest, and install into a receiver whose registry access is blocked except for the internal mirror.',
        steps: ['Render the chart with production values and extract all images, including init and sidecars', 'Save images as OCI archives, checksum everything, sign the manifest', 'Load into the receiver\'s internal registry', 'Deploy and prove with events and registry logs that no external pull happened'],
        pass: ['No missing transitive image', 'Tampered-bundle test is rejected', 'Install evidence ties each running digest to the signed manifest'] }
    ]
  });

  B({
    id: 'B04', title: 'Systems development (Google SDE/SRE-style roles)', hours: [10, 14], prereqs: ['M02', 'M04'],
    audience: 'For systems-development roles: Linux performance depth, reusable tool design, capacity estimation and coding with maps, sets and queues.',
    objectives: ['Investigate a performance regression with USE-method evidence and a flame graph or profile', 'Design a reusable CLI tool with a stable interface and tests', 'Estimate capacity with units and check the estimate against a measurement', 'Choose data structures by access pattern and state the complexity'],
    sequence: ['Redo L04 with the CPU fixture and add `perf`/`py-spy` profiling', 'Exercise B04-1 (regression investigation)', 'Exercise B04-2 (fleet-inventory tool)', 'Optional: map the tooling to Google Cloud operations'],
    exercises: [
      { id: 'B04-1', title: 'Performance regression investigation', mins: 150, brief: 'Two builds of the Beacon summariser differ by one commit; the newer one is 8× slower on a large file. Find the regression from measurements, not by reading the diff first.',
        steps: ['Measure both builds with the same input and `time`/`perf stat`', 'Profile the slow build and identify the hot function', 'Relate it to an algorithmic change (e.g. list membership in a loop)', 'Fix and show the measurement returning to baseline'],
        pass: ['Regression located from profile evidence', 'Complexity before/after stated', 'Measured speed-up reported with input size'] },
      { id: 'B04-2', title: 'Independently tested fleet-inventory tool', mins: 180, brief: 'Extend the L08 client into a reusable tool: deduplicate by id across paginated sources, diff two inventories, and emit JSON and table output with stable exit codes.',
        steps: ['Define the CLI contract and exit codes', 'Use dict/set for deduplication and diffing; state complexity', 'Write tests including large synthetic inventories', 'Document the tool for a teammate'],
        pass: ['Tests pass and cover duplicates, empty sources and partial failure', 'Runs in O(n) over items with bounded memory per page', 'Exit codes distinguish partial from complete success'] }
    ]
  });

  B({
    id: 'B05', title: 'Enterprise identity (Netflix-style support/identity roles)', hours: [8, 12], prereqs: ['M05', 'M15'],
    audience: 'For identity-heavy support and SRE roles: authentication versus authorization, OAuth/OIDC, SAML, SCIM, certificate and session lifecycle, least privilege and support communication.',
    caveat: 'Live access to a commercial identity provider is optional and not assumed; the exercises use a local identity-provider fixture.',
    objectives: ['Explain the OIDC authorization-code flow and which party validates what', 'Diagnose bad audience, redirect URI mismatch and clock skew from token and log evidence', 'Explain SCIM provisioning and detect provisioning drift', 'Write a precise customer update for an identity incident'],
    sequence: ['Read M15 lesson 04 again', 'Exercise B05-1 (IdP fixture faults)', 'Exercise B05-2 (provisioning drift)', 'Write two support replies using the evidence'],
    exercises: [
      { id: 'B05-1', title: 'Local identity-provider fixture: three broken logins', mins: 120, brief: 'A local OIDC provider fixture issues tokens to a sample app. Three variants fail: wrong audience, redirect URI mismatch, and a clock-skewed token. Decode the evidence and fix the configuration on the right side.',
        steps: ['Capture the failing redirect and token (redact signatures in notes)', 'Decode the JWT header/claims and compare aud, iss, exp/nbf with the app config', 'Fix the client registration or the app config, not the validation', 'Verify a fresh login'],
        pass: ['Each variant attributed to the correct party', 'No validation disabled', 'Customer-facing explanation names the fix and the evidence'] },
      { id: 'B05-2', title: 'User-provisioning drift', mins: 90, brief: 'A SCIM fixture shows users deprovisioned in the IdP who still have access in the app. Find the drift and propose a reconciliation with an audit trail.',
        steps: ['List IdP users and app users from the fixture', 'Diff by external id and status', 'Explain why deactivation did not propagate', 'Propose a reconciliation job and its alert'],
        pass: ['Drift quantified', 'Root cause identified from fixture logs', 'Reconciliation is safe to re-run (idempotent)'] }
    ]
  });

  B({
    id: 'B06', title: 'Windows and hybrid identity (Microsoft PLx-style roles)', hours: [10, 14], prereqs: ['M02', 'M05'],
    audience: 'For roles that require Windows operations: PowerShell, Windows services and event logs, Active Directory and DNS, and hybrid identity concepts.',
    caveat: 'Verify the exact role requirements first. Windows Server parity on Apple Silicon is not assumed: use a supported x86 evaluation VM, a cloud sandbox you own, or the simulations. SQL Server/Exchange/SharePoint depth only if the job requires it.',
    objectives: ['Operate services and read event logs with PowerShell', 'Explain AD domains, DNS integration and group policy at a working level', 'Describe hybrid identity synchronisation and its failure modes', 'Translate Linux service-operations habits into Windows equivalents'],
    sequence: ['Map M02 commands to PowerShell (`Get-Service`, `Get-WinEvent`, `Get-Process`, `Test-NetConnection`)', 'Exercise B06-1 (service and event log triage)', 'Exercise B06-2 (AD/DNS lab or simulation)', 'One-page comparison: systemd/journald versus SCM/Event Log'],
    exercises: [
      { id: 'B06-1', title: 'Windows service failure triage with PowerShell', mins: 120, brief: 'A Windows service that hosts a Beacon-like worker stops after start. Use PowerShell to find the cause in the event log and the service configuration, fix it narrowly and prove the service account.',
        steps: ['`Get-Service` and `Get-CimInstance Win32_Service` for the start name and path', '`Get-WinEvent -FilterHashtable` for the Service Control Manager and application events', 'Fix the path or the account permission narrowly', 'Verify status and the listening port with `Get-NetTCPConnection`'],
        pass: ['Cause identified from event evidence', 'Service runs as its intended account', 'No Administrator shortcut'] },
      { id: 'B06-2', title: 'AD-integrated DNS and a broken lookup', mins: 120, brief: 'In an evaluation domain (or the simulation), a member server cannot resolve a new host. Compare the DNS zone, the client resolver order and the secure-dynamic-update setting.',
        steps: ['`Resolve-DnsName` against each DNS server', 'Inspect the zone and the record owner', 'Fix registration or resolver order', 'Verify from the client with a fresh cache (`Clear-DnsClientCache`)'],
        pass: ['Authoritative versus client view separated', 'Fix applied at the right layer', 'Verification after cache clear'] }
    ]
  });

  B({
    id: 'B07', title: 'AI API support (OpenAI/Anthropic-adjacent support roles)', hours: [8, 12], prereqs: ['M04', 'M15'],
    audience: 'For API support roles at AI platform companies: authentication, quota and rate-limit diagnosis, streaming and tool-call failures, SDK-versus-HTTP reproduction, token and cost literacy, retrieval evaluation and safe logging.',
    caveat: 'Mock APIs by default. Real API calls are optional, must be capped by the learner, and are never made by the course. This is support engineering, not ML research or model training.',
    objectives: ['Classify 401/403/429/5xx/timeout/stream interruptions from evidence', 'Reproduce a customer issue minimally with both the SDK and raw HTTP', 'Explain tokens, context limits and cost for a given request', 'Log safely: request ids yes, keys and user content no'],
    sequence: ['Redo L30 with all variants', 'Exercise B07-1 (streaming and tool-call failures on the mock API)', 'Exercise B07-2 (retrieval evaluation on a small fixture)', 'Write three customer replies with request ids and next actions'],
    exercises: [
      { id: 'B07-1', title: 'Streaming interruption and malformed tool call', mins: 120, brief: 'The local mock API sometimes drops a server-sent-events stream mid-response and sometimes returns a tool call whose arguments are not valid JSON. Reproduce both minimally and write the client handling.',
        steps: ['Reproduce with raw HTTP (curl -N) and with the SDK-style client', 'Detect the incomplete stream (no terminal event) and retry idempotently', 'Validate tool-call arguments before executing anything', 'Log request ids and timings only'],
        pass: ['Both failures reproduced in under 30 lines each', 'No partial response presented as complete', 'Logs contain no key or user content'] },
      { id: 'B07-2', title: 'Retrieval evaluation on a fixture', mins: 90, brief: 'Given 30 questions with known supporting passages and a simple retriever, measure recall@5 and find why five questions fail.',
        steps: ['Run the retriever and compute recall@5', 'Inspect failing cases: chunking, wording, or missing passage', 'Change one thing and re-measure', 'Report the result with its limits'],
        pass: ['Metric computed correctly and reproducibly', 'Failure causes categorised with examples', 'Claims limited to the fixture'] }
    ]
  });

  B({
    id: 'B08', title: 'Governance literacy for deployment engineers', hours: [4, 6], prereqs: ['M13'],
    audience: 'For anyone delivering into regulated environments: risks, controls and evidence, plan-of-action basics, and inherited versus implemented controls — enough to support the work, not a GRC track.',
    caveat: 'Literacy only. Nothing here constitutes an assessment, an authorisation or a compliance claim.',
    objectives: ['Explain risk, control, evidence and the difference between inherited and implemented controls', 'Write a plan-of-action-and-milestones (POA&M) entry for a finding', 'Map course evidence (scan reports, SBOMs, access reviews) to control families at a high level', 'Walk through a synthetic audit request and answer from evidence'],
    sequence: ['Re-read M13 lesson 05', 'Exercise B08-1 (synthetic audit walkthrough)', 'Exercise B08-2 (POA&M entry)'],
    exercises: [
      { id: 'B08-1', title: 'Synthetic audit walkthrough', mins: 90, brief: 'An auditor asks for evidence that only approved images run in the restricted Beacon environment and that access is reviewed. Answer from the artifacts you produced in M10 and M13.',
        steps: ['List the evidence you have and where it lives', 'Identify which controls are inherited from the platform', 'Point to the exact record for one running image', 'Name the gap you cannot evidence'],
        pass: ['Every answer cites an artifact', 'Inherited versus implemented stated correctly', 'Gap acknowledged, not papered over'] },
      { id: 'B08-2', title: 'A POA&M entry for a real finding', mins: 60, brief: 'Take one unresolved finding from your L25 vulnerability triage and write the plan-of-action entry an assessor could track.',
        steps: ['State the weakness and affected component', 'Give the risk rationale and the interim mitigation', 'Set milestones with owners and dates', 'Define the closure evidence'],
        pass: ['Entry is specific and testable', 'Milestones have owners', 'Closure evidence is objective'] }
    ]
  });

  /* ── cloud extensions: disabled by default ─────────────────────────── */
  var C = function (x) { x.defaultEnabled = false; x.status = x.status || 'authored-spec'; LX.sreCloud.push(x); };
  var NOTE = 'Order of magnitude at authoring time (October 2026), not a quote — open the provider\'s pricing calculator for your region and confirm before starting.';

  C({
    id: 'C01', title: 'AWS identity and network: private object access with a scoped role', hours: '3–4 h', prereqs: ['M05', 'M06'], tag: 'looped:lab=c01',
    summary: 'In your own AWS sandbox account, give one small instance private access to one bucket through a gateway endpoint and a narrowly scoped role, observe what is and is not reachable, then destroy everything with Terraform and prove the account is empty of lab resources.',
    estimate: [NOTE, 'One t4g.nano/micro instance for ~3 hours: cents to low tens of cents; gp3 root volume for the same hours: cents.', 'S3: a few KB stored and a handful of requests: effectively nothing. Gateway endpoints for S3 have no hourly charge.', 'No NAT gateway (hourly + per-GB) and no public load balancer in this lab — both are excluded on purpose.'],
    allowedResources: ['1 VPC with 1 private subnet and 1 route table', '1 S3 gateway VPC endpoint with an endpoint policy', '1 S3 bucket (private, versioning off, block-public-access on)', '1 IAM role + instance profile with a least-privilege inline policy', '1 EC2 instance (t4g.nano or t4g.micro) reached only through SSM Session Manager', 'SSM interface endpoints only if you choose them instead of a public IP for Session Manager (they bill hourly; the estimate changes)'],
    cleanup: ['`terraform destroy` completes with 0 resources remaining in state', 'EC2: no instances, EBS volumes, snapshots or Elastic IPs tagged looped:lab=c01', 'VPC: no VPC, subnets, endpoints, route tables or security groups tagged looped:lab=c01', 'S3: bucket deleted (empty it first); no objects left', 'IAM: role, instance profile and policy deleted', 'CloudWatch Logs: delete any log group the lab created', 'Run the tag-based inventory command in the commands below and paste its empty output into your evidence'],
    pass: ['From the instance, `aws s3 cp` to/from the lab bucket succeeds; the same command to any other bucket is denied', 'Removing the endpoint route makes the bucket unreachable (no public path), proving the traffic path', 'Bucket policy denies requests not via the endpoint (`aws:SourceVpce`)', 'Post-cleanup inventory is empty'],
    brief: 'Use the Terraform in `labs/sre-cloud-foundations/cloud/C01/` (local state, your own credentials from a named profile, region you choose). Read every resource before applying. Apply, verify the access matrix from Session Manager, break and restore the endpoint route once, then destroy and inventory.',
    commands: ['export AWS_PROFILE=looped-sandbox   # a sandbox account, never production', 'cd labs/sre-cloud-foundations/cloud/C01 && terraform init && terraform plan -out=c01.plan', 'terraform apply c01.plan', '# verify from the instance via SSM: aws s3 cp /etc/hostname s3://$(terraform output -raw bucket)/probe.txt', 'terraform destroy', 'aws resourcegroupstaggingapi get-resources --tag-filters Key=looped:lab,Values=c01 --query "ResourceTagMappingList[].ResourceARN"']
  });

  C({
    id: 'C02', title: 'Terraform remote state on S3 with use_lockfile', hours: '2–3 h', prereqs: ['M06'], tag: 'looped:lab=c02',
    summary: 'Create a versioned, private S3 bucket for Terraform state using the S3 backend\'s native lockfile (`use_lockfile = true`; DynamoDB locking is deprecated), exercise a concurrent lock and a state recovery from a previous object version, then remove every retained version when cleaning up.',
    estimate: [NOTE, 'S3 storage for a few KB of state and its versions, plus a few hundred requests: effectively nothing.', 'No compute resources are created.'],
    allowedResources: ['1 S3 bucket with versioning, default encryption and block-public-access', 'Objects: the state file, its .tflock lock object during operations, and their versions', 'Optionally 1 IAM policy scoped to the bucket/key prefix for a CI-like principal'],
    cleanup: ['All object versions and delete markers removed (`aws s3api list-object-versions` returns nothing)', 'Bucket deleted', 'Any IAM policy created for the lab deleted', 'Local `.terraform/` and plan files removed from the lab directory'],
    pass: ['Two concurrent `terraform plan` runs: the second fails with a lock error naming the first run\'s lock id', 'A deliberately bad state push is recovered by restoring the previous object version, then `terraform plan` shows no unexpected changes', 'The backend block uses `use_lockfile = true` and no DynamoDB table exists'],
    brief: 'Configuration in `labs/sre-cloud-foundations/cloud/C02/`: a bootstrap stack (local state) creates the bucket; a sample stack uses it as its backend. Exercise the lock from two terminals, then the version restore.',
    commands: ['export AWS_PROFILE=looped-sandbox', 'cd labs/sre-cloud-foundations/cloud/C02/bootstrap && terraform init && terraform apply', 'cd ../stack && terraform init -backend-config="bucket=$(terraform -chdir=../bootstrap output -raw bucket)"', 'terraform plan   # in two terminals at once: the second must report the lock', 'aws s3api list-object-versions --bucket "$(terraform -chdir=../bootstrap output -raw bucket)" --prefix beacon/', '# cleanup: delete all versions and delete markers, then terraform -chdir=../bootstrap destroy']
  });

  C({
    id: 'C03', title: 'One managed Kubernetes service: EKS, AKS or GKE', hours: '4–6 h', prereqs: ['M10', 'M11'], tag: 'looped-lab=c03',
    summary: 'Choose exactly one managed Kubernetes service, deploy Beacon with the course chart, and compare identity, networking, storage and load balancing with kind. Inspect the charges and every dependent resource, then destroy all of them.',
    estimate: [NOTE, 'Managed control plane: EKS and GKE charge a per-cluster hourly fee (around ten cents per hour at authoring time; GKE has a monthly credit for one zonal cluster); AKS has a free control-plane tier.', 'Two small worker nodes for ~5 hours: tens of cents to a few dollars depending on size and region.', 'A cloud load balancer and its public IP bill hourly while they exist; persistent volumes bill while they exist even after the cluster is deleted if not cleaned up.', 'Avoid NAT gateways: use public node subnets with restrictive security rules for this exercise, or accept and record the NAT cost.'],
    allowedResources: ['1 managed cluster (EKS or AKS or GKE) with 2 small nodes', 'The VPC/VNet and subnets the cluster needs', '1 cloud load balancer created by a Service of type LoadBalancer', 'Up to 2 small persistent volumes', 'Workload identity binding (IRSA / Entra workload identity / GKE Workload Identity) for one service account'],
    cleanup: ['Delete the Helm release and every Service of type LoadBalancer first (so the cloud load balancer is removed by its controller)', 'Delete PVCs and confirm the cloud disks are gone', 'Delete the cluster and node groups/pools', 'Delete the network, public IPs and any NAT you accepted', 'Delete identity bindings and roles created for workload identity', 'Run the provider\'s resource inventory by tag/label and paste its empty output'],
    pass: ['Beacon deployed with the course chart and reachable through the cloud load balancer', 'A one-page comparison of identity, networking, storage and load balancing versus kind, with what was observed (not assumed)', 'Charges inspected in the billing console after cleanup', 'Post-cleanup inventory empty'],
    brief: 'Pick one provider and follow its official quick start with the pinned versions in docs/sre-cloud-foundations/version-matrix.md. Install the course chart from `labs/sre-cloud-foundations/` with values for that provider. Record every resource you create as you go; the cleanup inventory is the pass condition.',
    commands: ['# choose ONE: eksctl / az aks / gcloud container clusters — see the provider quick start', 'helm upgrade --install beacon labs/sre-cloud-foundations/L19/chart -n beacon --create-namespace -f values-cloud.yaml', 'kubectl -n beacon get svc,pvc,pods -o wide', 'helm -n beacon uninstall beacon && kubectl -n beacon delete pvc --all', '# then delete the cluster with the same tool that created it and run the inventory by tag/label']
  });

  C({
    id: 'C04', title: 'Cloud recovery: restore disposable data and measure it', hours: '3–4 h', prereqs: ['M12', 'M14'], tag: 'looped:lab=c04',
    summary: 'In a sandbox, put synthetic Beacon data into a small managed database or object store, back it up, restore it into a fresh resource, measure the recovery interval and verify contents with counts and checksums. No production data and no production permissions.',
    estimate: [NOTE, 'A smallest-class managed PostgreSQL instance for ~3 hours: tens of cents to a couple of dollars; its automated backups and a manual snapshot: cents while retained.', 'Restored instance for ~1 hour: similar hourly cost.', 'Delete snapshots afterwards — retained snapshots keep billing.'],
    allowedResources: ['1 smallest-class managed PostgreSQL instance (single-AZ) with synthetic data', '1 manual snapshot', '1 restored instance from that snapshot', 'Or, instead of a database: 1 versioned bucket with synthetic objects and a restore of prior versions'],
    cleanup: ['Delete the restored instance', 'Delete the source instance with final snapshot disabled (it is synthetic)', 'Delete the manual snapshot and confirm no automated snapshots are retained', 'Delete parameter/subnet groups created for the lab', 'Inventory by tag and paste the empty result'],
    pass: ['Recovery interval measured from decision to verified data', 'Row counts per table AND checksums or sampled values match the source at the recovery point', 'Report states what a production-sized restore would add'],
    brief: 'Use the synthetic dataset and verification script from L24. Load it, snapshot, restore to a new instance, run the verification, record the timings, then clean up.',
    commands: ['export AWS_PROFILE=looped-sandbox   # or the equivalent on Azure/GCP', '# create the smallest instance with the provider CLI or console, tag it looped:lab=c04', 'python3 labs/sre-cloud-foundations/L24/assets/verify_restore.py --source "$SRC_DSN" --target "$RESTORED_DSN"', '# delete restored instance, source instance and snapshot; inventory by tag']
  });

  C({
    id: 'C05', title: 'Second provider translation: Azure or GCP', hours: '3–4 h', prereqs: ['M15'], tag: 'looped-lab=c05',
    summary: 'Deploy a minimal Beacon equivalent on Azure or Google Cloud (one small VM or container service plus a private storage bucket/container) and write down where identity and networking behaved differently from AWS. Verify full cleanup.',
    estimate: [NOTE, 'One small VM or a scale-to-zero container service for ~3 hours: cents to tens of cents.', 'Storage for a few KB: effectively nothing. Public IPs and load balancers bill while they exist.'],
    allowedResources: ['1 resource group (Azure) or 1 project (GCP) dedicated to the lab', '1 small VM or 1 container service instance', '1 storage account/container or bucket, private', '1 managed identity / service account with a single role binding scoped to that storage'],
    cleanup: ['Delete the resource group (Azure) or shut down the project (GCP) — confirm it is gone, not just stopped', 'Confirm no public IPs, disks or snapshots remain', 'Remove role assignments/bindings created for the lab', 'Paste the provider\'s resource listing for the group/project showing nothing remains'],
    pass: ['Beacon responds on /healthz from the provider\'s compute', 'Private storage reachable from the workload identity and denied without it', 'Written comparison of identity scope (subscription/resource group vs project), role binding and network defaults versus AWS, with observations'],
    brief: 'Choose Azure or GCP. Follow the provider\'s official quick start for the service you choose; use the L29 translation worksheet as your plan and fill in what you actually observed.',
    commands: ['# Azure: az group create -n looped-c05 -l <region> --tags looped-lab=c05', '# GCP:   gcloud projects create looped-c05-<suffix> --labels=looped-lab=c05', '# ... deploy per the quick start ...', '# Azure cleanup: az group delete -n looped-c05', '# GCP cleanup:   gcloud projects delete looped-c05-<suffix>']
  });
})();
