/* Onsite track — short-form design and automation questions: safe automation, multi-tenancy, alerting,
   backup and restore, certificate rotation, disconnected monitoring, remediation and fleet upgrades.
   The long workshop scenarios live in the design set; `design` links to the related one. */
window.LX = window.LX || {};
LX.onsiteQ = LX.onsiteQ || [];
LX.onsiteQ.push(

{ id: 'ons-q-design-05', track: 'onsite', topic: 'design', priority: 'P2', level: 2, mins: 6,
  prereqs: ['les-identity', 'ons-q-delivery-07'],
  design: 'ons-design-remediation',
  q: 'You\'re writing automation that will run against production clusters. What makes it safe?',
  context: 'The automation might restart workloads, apply manifests or drain nodes across several clusters. The interviewer wants design properties, not a particular language or tool.',
  evaluates: [
    'Explicit target selection verified against the live cluster, refusing on mismatch',
    'Dry-run or diff before acting, and bounded scope and batch size',
    'Idempotency, preconditions, postcondition checks and timeouts',
    'Least-privilege identity, audit logging and abort on unexpected state'
  ],
  spoken: 'I design it to refuse more readily than it acts.\n\nFirst, targeting is explicit. The tool takes the cluster and namespace as required arguments and checks that the live cluster matches, for example by reading back an identifier. It refuses on a mismatch instead of trusting whatever kubeconfig context happens to be current.\n\nSecond, it shows what it will do: a dry-run or server-side diff, and for anything destructive, a printed target list and count before acting.\n\nThird, scope is bounded. There is a maximum batch size, and it aborts if the selector resolves to zero targets or more than expected, because an empty selector in Kubernetes matches everything.\n\nFourth, it is idempotent, so a rerun after a partial failure is safe.\n\nFifth, it checks preconditions before each step and verifies postconditions after: did the pods become Ready, did the error rate stay flat. On anything unexpected it stops rather than improvising.\n\nEvery wait has a timeout. It runs under a least-privilege ServiceAccount or role that cannot touch what it should not. And it logs who ran it, against what, with which arguments and what happened. That is slower to write, but it is the difference between a bad run affecting one batch and affecting the fleet.',
  deep: 'Target verification: kubeconfig contexts are local files and easy to get wrong. Require the target as an argument, then confirm it against something the cluster reports (a well-known ConfigMap with the cluster name, the API server URL, a node label), and refuse if they disagree. For multi-cluster runs, iterate an explicit list rather than "all contexts".\n\nPreview: `kubectl diff` and server-side dry-run (`kubectl apply --dry-run=server`) run the request through admission without persisting it, which catches policy rejections and schema errors before the real run. For imperative actions (restart, drain, delete), the preview is the resolved target list, its count, and the plan per batch.\n\nScope and pacing: resolve targets once, check the count against an expected range, and process in batches with a pause and health check between them. Treat an empty selector as an error, since Kubernetes label selectors with no requirements match all objects. Cap concurrency per cluster and across the fleet.\n\nIdempotency and state: each step should converge toward a desired state ("ensure X") rather than perform a relative action ("add one"), so reruns are safe. Record progress so a resumed run skips completed batches.\n\nPreconditions and postconditions: check that the system is in the state the step expects (Deployment exists, not mid-rollout, PDB allows disruption) and verify the result (pods Ready, endpoints populated, error rate stable). Readiness is necessary but not sufficient evidence, so include a service-level signal where you can.\n\nIdentity: a dedicated ServiceAccount or role with only the verbs and resources needed; `kubectl auth can-i --as` lets you test that. Human-invoked runs should carry the human\'s identity in the audit trail. Logging: structured records of arguments, targets, each action and result, suitable for an incident timeline. Add a kill switch that the automation checks before each batch.',
  followups: [
    { q: 'The script uses the current kubeconfig context. What could go wrong, and what would you change?',
      guidance: 'Someone runs it after switching context for another task and it acts on the wrong cluster. Make the target a required argument, verify it against a cluster-reported identifier, refuse on mismatch, and print the target before any change.' },
    { q: 'Halfway through, the API server starts returning timeouts. What should the automation do?',
      guidance: 'Stop starting new work, finish or safely abandon the current step within its timeout, record exactly what completed, and exit non-zero with a resumable state. Retrying aggressively adds load to a struggling control plane. A human decides whether to resume.' },
    { q: 'How would you test this automation before it touches production?',
      guidance: 'Unit-test target resolution and scope checks, including empty and oversized selectors; run against a disposable cluster (for example kind) with realistic objects; then run in dry-run mode against production and compare the plan with expectations; then a single small batch. A lab run is useful evidence but not a substitute for a production canary.' }
  ],
  misconceptions: [
    'Dry-run means nothing can go wrong. Client-side dry-run skips admission; server-side dry-run is closer but still does not predict runtime behaviour.',
    'An empty selector selects nothing. In Kubernetes label-selector semantics it selects everything.',
    'Cluster-admin is fine for automation because it is ours. Least privilege limits the blast radius of bugs, not just attackers.'
  ],
  weak: [
    'Lists "add logging" and "test it" with no mechanisms',
    'Relies on the operator remembering to check the context',
    'No batch limits or abort conditions',
    'Retries forever on errors'
  ],
  evidence: 'def run(cluster, namespace, selector, max_batch=5, dry_run=True):\n    if read_cluster_id() != cluster: abort("context mismatch")\n    if not selector: abort("empty selector would match everything")\n    targets = list_targets(namespace, selector)\n    if not targets or len(targets) > EXPECTED_MAX: abort("scope check failed")\n    for batch in chunks(targets, max_batch):\n        if kill_switch_set(): abort("stopped by operator")\n        check_preconditions(batch)                 # abort on unexpected state\n        if dry_run: log("would act on", batch); continue\n        act(batch)\n        wait_healthy(batch, timeout=300)           # postcondition, bounded wait\n        audit(user, cluster, batch, result="ok")\n\n$ kubectl diff -f change.yaml\n$ kubectl auth can-i delete pods -n shop --as=system:serviceaccount:ops:remediator',
  rubric: {
    strong: [
      'Verifies the target against the live cluster and refuses on mismatch',
      'Previews changes and bounds scope, with abort on empty or oversized target sets',
      'Idempotent steps with preconditions, postconditions and timeouts',
      'Least-privilege identity, audit logs and a kill switch'
    ],
    acceptable: [
      'Wraps the actions in a GitOps or change-management flow so humans approve the plan, with the same scope checks',
      'Uses an existing orchestration tool\'s rate controls, as long as target verification is still explicit'
    ],
    redFlags: [
      'Runs against "all contexts" in the kubeconfig',
      'No abort on empty selector',
      'Uses a cluster-admin credential shared by humans'
    ]
  },
  aws: { analogy: 'SSM Automation and Run Command rate controls (concurrency and error thresholds) with IAM-scoped roles.',
    breaks: 'A kubectl context has no account boundary around it: the target is whatever cluster your kubeconfig points at, so the tool has to verify it. RBAC is scoped to namespaces or the cluster and is not the same as IAM, and your own scripts get no built-in rate control.' },
  refs: [
    { t: 'kubectl diff', u: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/' },
    { t: 'RBAC good practices', u: 'https://kubernetes.io/docs/concepts/security/rbac-good-practices/' },
    { t: 'kubectl auth can-i', u: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/' }
  ],
  verify: ''
},

{ id: 'ons-q-design-06', track: 'onsite', topic: 'design', priority: 'P2', level: 2, mins: 6,
  prereqs: ['les-resources', 'les-scheduling'],
  q: 'Several teams share one cluster. How do you stop one workload starving the others?',
  context: 'Multiple teams deploy into one cluster. One team\'s batch job recently consumed most of the capacity and other services degraded.',
  evaluates: [
    'Uses ResourceQuota and LimitRange per namespace',
    'Explains why honest requests matter for scheduling and quota',
    'Knows priority classes and preemption, and PodDisruptionBudgets',
    'Considers node pools with taints for noisy workloads, and API server fairness'
  ],
  spoken: 'I start with a namespace per team, because most of the controls attach to namespaces.\n\nResourceQuota caps the total requests, limits and object counts a namespace can declare. LimitRange gives defaults and maximums, so a pod without requests does not land with none. Both depend on requests being honest. The scheduler places pods by requests, not by actual usage, so a team that under-requests can pack a node and then contend for real CPU and memory with everyone else. I watch usage against requests and push teams to set them realistically.\n\nPriority classes decide who wins when capacity is short. Critical services get a higher priority, so the scheduler can preempt lower-priority pods to place them. Batch work gets a lower one. PodDisruptionBudgets stop voluntary disruptions, like drains, from taking out too many replicas at once.\n\nFor workloads that are noisy in ways quota does not capture, such as heavy disk or network I/O, I put them on a dedicated node pool with taints, so only pods with the matching toleration land there.\n\nThe API server is shared too. API Priority and Fairness limits how much one client\'s requests can crowd out others, but a controller hammering the API is still worth fixing at the source.',
  deep: 'Namespaces are the unit for quota, RBAC and policy, but they are not an isolation boundary on their own: pods in different namespaces share nodes, kernels and the network unless you add scheduling constraints and NetworkPolicy (enforced only if the CNI supports it).\n\nResourceQuota: once a quota covers CPU or memory, pods in that namespace must specify requests or limits for those resources, or creation is rejected; this is why LimitRange defaults are usually paired with quota. Quota counts declared values, not usage, so it limits what a team can reserve rather than what it consumes. Object-count quotas (pods, Services of type LoadBalancer, PVCs) guard shared finite resources.\n\nRequests and limits: requests drive scheduling and, for CPU, relative share under contention; memory limits cause OOM kills when exceeded, CPU limits cause throttling. Under-requesting lets the scheduler overcommit nodes, so real contention and node-pressure evictions follow. BestEffort and Burstable pods are typically evicted before Guaranteed pods under node pressure.\n\nPriority and preemption: a PriorityClass lets the scheduler evict lower-priority pods to place a pending higher-priority pod. It is powerful and easy to misuse: if every team marks itself critical, it means nothing, so control who can use high classes (quota can be scoped by priority class). Preemption respects PDBs on a best-effort basis, not as a guarantee.\n\nNode isolation: taints on a node pool plus tolerations and node affinity on the workloads keep noisy or specialised workloads apart, and protect them from others. This is the practical answer to contention that requests cannot express, such as disk I/O, network bandwidth or noisy caches.\n\nControl-plane fairness: API Priority and Fairness classifies API requests into priority levels and queues them, so one misbehaving client cannot monopolise the API server. It does not fix a controller with a bad watch or list pattern; it limits the damage while you do.',
  followups: [
    { q: 'A team sets tiny requests to fit under quota, and their pods run hot. What happens to their neighbours?',
      guidance: 'The scheduler packs nodes based on the small requests, so actual usage exceeds allocatable capacity. Neighbours see CPU contention and, for memory, node pressure leading to evictions or OOM kills. Fix with LimitRange minimums or ratios, usage-versus-request reporting, and quota based on realistic requests.' },
    { q: 'Everyone asks for the highest priority class. How do you govern it?',
      guidance: 'Define a few classes with clear criteria, restrict high classes through ResourceQuota scoped by priority class or through admission policy, and review usage. Priority is a statement about what gets preempted, so it needs an owner outside the teams asking for it.' },
    { q: 'When would you stop sharing and give a team its own cluster?',
      guidance: 'When the isolation needed exceeds what namespaces, quota and node pools provide: different trust levels, conflicting cluster-scoped dependencies such as CRD versions, compliance boundaries, or a blast radius that must not include other teams. The cost is more clusters to operate and upgrade.' }
  ],
  misconceptions: [
    'Namespaces isolate teams. They scope names, quota and RBAC; network isolation needs NetworkPolicy enforced by the CNI, and nodes are shared unless you constrain scheduling.',
    'ResourceQuota limits actual usage. It limits declared requests and limits.',
    'A higher priority always protects a pod. Preemption helps scheduling; it does not prevent node-pressure eviction ordering or bad requests.'
  ],
  weak: [
    'Only says "use quotas"',
    'Does not connect requests to scheduling',
    'Hands out high priority without governance',
    'Ignores the shared API server'
  ],
  evidence: '$ kubectl describe resourcequota -n team-a\nResource         Used   Hard\n--------         ----   ----\nrequests.cpu     18     20\nrequests.memory  60Gi   64Gi\npods             41     50\n\n$ kubectl get limitrange -n team-a -o yaml   # defaults for pods that omit requests\n$ kubectl get priorityclass\n$ kubectl describe node worker-3 | sed -n \'/Allocated resources/,/Events/p\'   # requests vs allocatable',
  rubric: {
    strong: [
      'Namespace per team with ResourceQuota and LimitRange',
      'Explains that requests drive scheduling and quota, and why honesty matters',
      'Priority classes with governance, and PDBs',
      'Node pools with taints for contention that requests do not capture',
      'Mentions API Priority and Fairness with a hedge'
    ],
    acceptable: [
      'Separate clusters for strong isolation, with cost and operational load acknowledged',
      'Autoscaling capacity as part of the answer, as long as quotas still bound each team'
    ],
    redFlags: [
      'Claims namespaces provide network or resource isolation by themselves',
      'Gives every workload the highest priority',
      'Removes all limits "for performance" without discussion'
    ]
  },
  aws: { analogy: 'Per-account Service Quotas and ECS capacity providers for separating workloads.',
    breaks: 'Teams in one cluster share nodes, the API server and cluster-scoped objects; there is no account boundary. ResourceQuota counts declared requests and limits in a namespace, not what processes actually use, so honest requests matter more than they do with per-account limits.' },
  refs: [
    { t: 'Resource quotas', u: 'https://kubernetes.io/docs/concepts/policy/resource-quotas/' },
    { t: 'Pod priority and preemption', u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/' },
    { t: 'API Priority and Fairness', u: 'https://kubernetes.io/docs/concepts/cluster-administration/flow-control/' }
  ],
  verify: 'API Priority and Fairness is stable since Kubernetes 1.29 per the docs; the default priority levels and flow schemas vary by version, so confirm on your cluster.'
},

{ id: 'ons-q-design-07', track: 'onsite', topic: 'design', priority: 'P2', level: 2, mins: 7,
  prereqs: ['les-probes', 'ons-q-delivery-07'],
  q: 'How do you design health signals and alerts so they catch real failures but don\'t page on noise?',
  context: 'The on-call rotation is getting paged for pod restarts and CPU spikes that turn out harmless, while a real outage last month was reported by users first.',
  evaluates: [
    'Pages on user-visible symptoms against SLOs, and routes causes to tickets or dashboards',
    'Understands multi-window burn-rate alerting at a high level',
    'Treats missing telemetry as its own alert, neither healthy nor failed',
    'Knows readiness does not equal correctness, and uses synthetic checks'
  ],
  spoken: 'I page on symptoms and investigate causes.\n\nA page means users are affected or soon will be: requests failing, latency above the objective, a synthetic transaction failing. A pod restart, a CPU spike or a node going NotReady is a cause-level signal. It goes to a dashboard or a ticket unless it predicts user impact.\n\nFor SLO-based alerts I use burn rates at a high level: how fast the error budget is being consumed. A short window and a long window must both be burning, so a brief blip does not page but a sustained fast burn does. A slower burn can open a ticket instead of waking someone.\n\nMissing data needs its own rule. If a cluster stops reporting, the dashboards go quiet. That is not healthy and it is not proof of failure. So absent telemetry raises its own alert, with its own runbook: check the pipeline, check the site.\n\nI also do not trust readiness as a health signal on its own. Readiness says a pod is willing to receive traffic by its probe, not that its answers are right. Synthetic checks that exercise the real path from outside catch the failures probes miss. That is how you avoid users reporting the outage first.',
  deep: 'Symptoms versus causes: users experience errors, latency and wrong answers. Causes (CPU, restarts, disk, node status) are many and noisy, and most do not produce user impact thanks to redundancy. Paging on causes wakes people for self-healing events and still misses failures with an unexpected cause. Paging on symptoms catches any cause that matters. Cause signals remain valuable for diagnosis and capacity planning.\n\nSLOs and burn rates: an objective (for example, 99.9% of requests succeed over 30 days) implies an error budget. The burn rate is how fast you are using that budget. Multi-window alerts require both a long window (showing the problem is significant) and a short window (showing it is still happening) to exceed a threshold, which reduces both flapping and slow detection. Fast burns page; slow burns ticket.\n\nMissing data: every alert rule has to decide what "no data" means. Treating no data as OK hides outages of the thing that reports. Treating no data as failing pages for every telemetry glitch. The robust design is a separate absence alert per source (heartbeat or "metric absent for N minutes") with its own routing and runbook, while the symptom alerts do not fire on absence.\n\nReadiness and liveness: readiness failures remove a pod from Service endpoints; liveness failures restart the container. Neither probes business correctness. A rollout that completed and pods that are Ready are necessary, not sufficient. Synthetic checks from outside the cluster exercise DNS, load balancing, TLS and the application together, and catch "everything is green but it does not work".\n\nHygiene: every page links to a runbook, has an owner, and is reviewed. An alert that never leads to action is deleted or demoted.',
  followups: [
    { q: 'A symptom alert fires, but all pods are Running and Ready. Where do you look?',
      guidance: 'Readiness does not prove correctness. Check what the probes actually test, dependency health (databases, DNS, downstream services), recent changes, error types in logs, and whether the synthetic check path differs from the probe path. Also confirm the Service has endpoints and traffic is reaching the pods you think.' },
    { q: 'How would you alert on a site that reports telemetry only every few hours?',
      guidance: 'Absence alerts must be tuned to the expected cadence, for example "no report for twice the interval". Local alerting on the site handles fast-moving problems. Central alerts evaluate the reported summaries and flag staleness distinctly from failure.' },
    { q: 'Your team wants to page on every pod restart. How do you respond?',
      guidance: 'Ask what action the page would drive. Restarts often self-heal and are covered by symptom alerts if they cause impact. Track restart rates on dashboards and alert (as a ticket) on sustained crash loops or restart rates above a baseline. Page only if restarts predict imminent user impact that symptoms would catch too late.' }
  ],
  misconceptions: [
    'No alerts firing means healthy. If telemetry stopped, silence means unknown.',
    'Running implies Ready, and Ready implies correct. Neither step holds.',
    'A readiness failure restarts the container. It removes the pod from Service endpoints; liveness failures restart containers.'
  ],
  weak: [
    'Alerts on every resource metric',
    'No mention of missing-data behaviour',
    'Uses readiness as proof of service health',
    'No runbooks or ownership for alerts'
  ],
  evidence: 'page   : error-budget burn, 1h AND 5m windows both above fast threshold\nticket : error-budget burn, 6h AND 30m windows both above slow threshold\npage   : synthetic checkout fails from 2 of 3 probe locations for 5m\nalert  : telemetry absent from cluster X for 15m  (own runbook: pipeline or site?)\ndash   : restarts, CPU, memory, node conditions, probe failures (diagnosis, not paging)',
  rubric: {
    strong: [
      'Symptom-based paging tied to SLOs, causes routed elsewhere',
      'High-level multi-window burn-rate explanation',
      'Absent telemetry as a distinct alert',
      'Readiness is not correctness; synthetics',
      'Runbooks and alert review'
    ],
    acceptable: [
      'Threshold alerts on golden signals (errors, latency, saturation, traffic) with clear ownership, if missing-data handling is covered',
      'Anomaly detection as a supplement, with its false-positive cost acknowledged'
    ],
    redFlags: [
      'Treats missing data as healthy',
      'Pages on CPU usage alone',
      'Says a Ready pod proves the service works'
    ]
  },
  aws: { analogy: 'CloudWatch alarms with the "treat missing data" setting, composite alarms, and CloudWatch Synthetics canaries.',
    breaks: 'Kubernetes ships no alerting of its own: probes feed endpoint membership and restarts, not SLOs, and you choose and operate the metrics and alerting stack. Missing-data behaviour is whatever your rules define, per rule.' },
  refs: [
    { t: 'Configure liveness, readiness and startup probes', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/' },
    { t: 'Metrics for Kubernetes system components', u: 'https://kubernetes.io/docs/concepts/cluster-administration/system-metrics/' },
    { t: 'Tools for monitoring resources', u: 'https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-usage-monitoring/' }
  ],
  verify: ''
},

{ id: 'ons-q-design-04', track: 'onsite', topic: 'design', priority: 'P2', level: 2, mins: 8,
  prereqs: ['les-storage', 'les-operators'],
  design: 'ons-design-stateful',
  q: 'What does a trustworthy backup and restore story look like for a stateful service on Kubernetes?',
  context: 'A team runs a database on Kubernetes with PersistentVolumes. They say "we have snapshots". You are asked whether that is enough.',
  evaluates: [
    'Distinguishes application-consistent from crash-consistent backups',
    'Compares volume snapshots with logical backups and knows where each is stored',
    'Keeps backups off-cluster and separates cluster state from data',
    'Defines RPO and RTO and proves them with restore drills',
    'Verifies backup integrity'
  ],
  spoken: 'A backup is only trustworthy if you have restored from it recently, so I design backwards from the restore.\n\nFirst, what consistency do I get? A volume snapshot is typically crash-consistent: like pulling the power. Many databases recover from that, but not all, and not across multiple volumes. An application-consistent backup either quiesces the database or uses its own tooling: a logical dump, or a physical backup with logs for point-in-time recovery. If an operator manages the database, I use its backup features, because it knows the application.\n\nSecond, where does it live? Snapshots often stay in the same storage system as the volume, so losing that system or the cluster can take them with it. At least one copy goes off-cluster, and ideally out of the same failure domain.\n\nThird, data is not the whole application. I also need cluster state: manifests, Secrets, CRDs and custom resources, ideally reproducible from source, plus etcd backups for the control plane itself.\n\nThen I agree RPO and RTO with the service owner, run restore drills into a separate environment on a schedule, time them, and verify the restored data with checks, not just "it started".',
  deep: 'Consistency: a crash-consistent image captures blocks at an instant, as if the node had lost power. A database with a write-ahead log usually recovers, but data spread across several volumes may be captured at slightly different instants, and some applications do not recover cleanly. Application-consistent backups either coordinate with the application (flush and freeze, or native backup APIs) or produce a logical export. Logical backups are portable across storage and versions but slower to restore at scale; physical backups plus log archiving enable point-in-time recovery.\n\nVolumeSnapshots: the Kubernetes API (VolumeSnapshot, VolumeSnapshotContent, VolumeSnapshotClass) is an interface to what the CSI driver supports. Whether snapshots are incremental, where they are stored, whether they survive loss of the storage backend, and whether they can be restored in another cluster all depend on the driver and backend. Deleting a namespace or PVC may or may not delete the snapshot, depending on deletion policy. Treat snapshots as a fast local restore tier, not the backup of record.\n\nCluster state versus data: manifests and configuration should be reproducible from source control (GitOps helps). Secrets need a separate, protected backup or regeneration path. The control plane\'s own state lives in etcd, which the Kubernetes docs cover backing up with snapshots; restoring etcd is a cluster-level recovery, distinct from restoring an application.\n\nOperators: a database operator often provides scheduled backups, retention and restore as custom resources. Use them, but verify where the output goes and test restores independently of the operator\'s status fields.\n\nProving it: define RPO (how much data you may lose) and RTO (how long recovery may take), then run restore drills into an isolated namespace or cluster, measure the time, and verify integrity with checksums, row counts or application-level checks. Alert on backup job failures and on backup age, since a silently failing schedule is the common failure.',
  followups: [
    { q: 'The storage system hosting the volumes fails. Which of your backups survive?',
      guidance: 'Snapshots stored in the same backend may not. Off-cluster logical or physical backups in separate storage survive. This is why at least one copy must live outside the failure domain of the primary data, and why restore drills should use that copy.' },
    { q: 'How would you restore a single tenant\'s data without rolling back everyone?',
      guidance: 'Restore the backup into a separate instance or namespace, extract the tenant\'s data with application tools, and merge it carefully. Volume snapshots are all-or-nothing, so logical backups or point-in-time recovery into a scratch instance are usually needed.' },
    { q: 'Your RPO is five minutes but backups run nightly. What changes?',
      guidance: 'Nightly full backups cannot meet it. You need continuous log archiving or replication to a separate location, with base backups on a schedule, and monitoring of archive lag. Confirm the RTO too, because replaying a day of logs may be slow.' }
  ],
  misconceptions: [
    'Volume snapshots are off-site backups. Where they are stored depends on the CSI driver and backend, often the same system as the volume.',
    'A backup job that succeeded means the data is recoverable. Only a tested restore shows that.',
    'Backing up PersistentVolumes backs up the application. Manifests, Secrets, custom resources and cluster state are separate.'
  ],
  weak: [
    'Stops at "we take snapshots"',
    'No RPO or RTO',
    'Never mentions restore testing',
    'Confuses etcd backup with application data backup'
  ],
  evidence: '$ kubectl get volumesnapshot -n db\nNAME            READYTOUSE   SOURCEPVC     RESTORESIZE   AGE\ndata-2026-09-25 true         data-db-0     100Gi         1d\n\nchecklist:\n- consistency: crash-consistent snapshot OR app-consistent (native backup / quiesce)\n- copies: local fast tier + off-cluster copy in a separate failure domain\n- scope: data + manifests (from source) + Secrets + CRs; etcd for the control plane\n- targets: RPO __ min, RTO __ min, agreed with service owner\n- proof: scheduled restore drill into isolated env; timed; data checks; alert on backup age',
  rubric: {
    strong: [
      'Distinguishes crash- and application-consistent backups',
      'Knows snapshot storage depends on the CSI driver and keeps an off-cluster copy',
      'Separates cluster state from data, including etcd',
      'Defines RPO and RTO and proves them with timed restore drills',
      'Verifies integrity and monitors backup age'
    ],
    acceptable: [
      'Relies on a database operator\'s backup features, with independent restore testing',
      'Uses replication to another site as the primary recovery path, with backups for logical corruption'
    ],
    redFlags: [
      'Treats replication as a backup (it replicates corruption and deletes)',
      'No restore testing',
      'Assumes snapshots survive loss of the storage system'
    ]
  },
  aws: { analogy: 'AWS Backup plans, EBS snapshots and RDS automated backups with point-in-time restore.',
    breaks: 'A VolumeSnapshot is a Kubernetes API over whatever the CSI driver provides; storage location, durability and cross-cluster restore depend on the driver, unlike EBS snapshots stored by the service. It captures a volume, not the Kubernetes objects that make up the application, and it does not coordinate with the database the way RDS backups do.' },
  refs: [
    { t: 'Volume snapshots', u: 'https://kubernetes.io/docs/concepts/storage/volume-snapshots/' },
    { t: 'Operating etcd clusters (backing up)', u: 'https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/' },
    { t: 'StatefulSets', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/' }
  ],
  verify: 'Snapshot consistency, storage location, deletion behaviour and cross-cluster restore are CSI-driver and backend specific; the Kubernetes docs do not guarantee them.'
},

{ id: 'ons-q-design-08', track: 'onsite', topic: 'design', priority: 'P2', level: 3, mins: 8,
  prereqs: ['les-identity', 'les-disconnected'],
  q: 'How would you rotate certificates and trust bundles across many environments without an outage?',
  context: 'You operate many clusters, some of them disconnected. A private CA that signs service and cluster certificates must be replaced before it expires.',
  evaluates: [
    'Uses overlap: add the new CA to trust bundles first, then reissue leaf certs, then remove the old CA',
    'Monitors expiry for both leaf and CA certificates',
    'Distinguishes cluster component certificates from application certificates',
    'Plans longer overlaps for offline sites and verifies from the client side'
  ],
  spoken: 'The rule is: trust before you use, and stop trusting only after nothing uses it.\n\nStep one, add the new CA to every trust bundle alongside the old one, so clients trust both. Wait until that has reached every client, including the slow ones. Step two, reissue leaf certificates signed by the new CA. Clients already trust it, so nothing breaks. Step three, once every leaf is on the new chain and you have evidence of that, remove the old CA from the bundles. Reverse the order and you get an outage: a server presenting a certificate its clients do not yet trust.\n\nI keep two kinds of certificate separate. The cluster\'s own certificates, for the API server, kubelets and etcd, follow the distribution\'s procedure; with kubeadm, for example, client certificates expire after a year by default. Application certificates are usually handled by the application\'s own tooling or a certificate controller.\n\nOffline sites need longer overlap windows, because the new bundle arrives only with the next transfer. Everything is driven by expiry monitoring with plenty of lead time.\n\nFinally I verify from the client side: connect as a client would and check which chain is presented and that it validates. A certificate being on disk proves nothing about what clients see.',
  deep: 'Why overlap works: TLS validation checks that the presented chain leads to a CA in the client\'s trust bundle. If the bundle contains both old and new CAs, leaf certificates signed by either validate. So the safe sequence is: distribute a bundle with both CAs; confirm distribution (every client, every pod that mounted the old bundle, which may need a restart to reload); reissue leaves from the new CA; confirm every endpoint presents the new chain; remove the old CA; confirm again. Cross-signing the new CA with the old one is another technique for easing transitions, with its own complexity.\n\nCluster certificates: the API server, kubelets, controller-manager, scheduler and etcd authenticate with certificates. Kubelet client certificates can be rotated automatically by the kubelet (the kubelet docs note they are issued with a one-year expiry by default); kubeadm documents that the client certificates it generates expire after one year and describes renewal. Replacing the cluster CA itself is a bigger operation; the Kubernetes docs have a manual procedure that stages a bundle containing both old and new CAs, and warns about components that cannot use a bundle for certain flags. ServiceAccount tokens and anything that embedded the old CA also need attention.\n\nApplication certificates: often issued by a certificate controller or the application\'s own tooling, and mounted from Secrets. Check how the application reloads them: some watch files, some need a restart, which turns a rotation into a rollout.\n\nDisconnected sites: the new bundle rides the next transfer, so the overlap must cover the longest expected gap between transfers plus margin. Clock accuracy matters because validity is checked against local time. Keep a per-site record of which bundle version is installed.\n\nMonitoring: track the expiry of every CA and leaf, including those inside kubeconfigs and webhook configurations (webhook `caBundle` fields are easy to forget). Verify externally: connect with a TLS client and inspect the presented chain and validation result.',
  followups: [
    { q: 'You rotated the CA, and admission webhook calls started failing. Why?',
      guidance: 'Webhook configurations carry their own `caBundle` that the API server uses to verify the webhook\'s serving certificate. If the webhook\'s certificate was reissued from the new CA before the caBundle was updated, the API server rejects it, and with a fail-closed policy that blocks creates. Update caBundle to include both CAs first.' },
    { q: 'A disconnected site misses two transfer windows during the overlap. What is your plan?',
      guidance: 'Design the overlap to cover missed windows with margin, never remove the old CA from central issuance until every site confirms the new bundle, and have a documented manual path to deliver the bundle. Report per-site bundle versions so you know who is behind.' },
    { q: 'How do you confirm that no client still depends on the old CA before removing it?',
      guidance: 'Inventory every endpoint and check the presented chain from the client side; check every trust store has the new CA; watch TLS error metrics or logs during a staged removal in a canary environment. Absence of errors in a canary for a full cycle is stronger evidence than a checklist.' }
  ],
  misconceptions: [
    'Reissuing all certificates at once is fastest and safe. Without the new CA already trusted everywhere, it breaks every client.',
    'Kubernetes rotates all its certificates automatically. Some are rotated automatically depending on configuration and distribution; CA replacement is a manual, staged procedure.',
    'If the certificate file is updated, clients see it. Many processes load certificates at start and need a reload or restart.'
  ],
  weak: [
    'Plans a single cutover date',
    'Ignores trust bundle distribution',
    'No expiry monitoring',
    'Forgets webhook caBundles and kubeconfigs'
  ],
  evidence: 'phase 1  trust bundle = {old CA, new CA}  -> distribute; confirm every client and webhook caBundle\nphase 2  reissue leaf certs from new CA   -> reload or restart; confirm presented chain\nphase 3  trust bundle = {new CA}          -> canary first; watch TLS errors\n\n$ kubeadm certs check-expiration                       # kubeadm clusters only\n$ openssl s_client -connect api.internal:443 -showcerts </dev/null | openssl x509 -noout -issuer -enddate',
  rubric: {
    strong: [
      'Correct three-phase overlap order',
      'Separates cluster certificates from application certificates',
      'Expiry monitoring for CAs and leaves, including webhooks and kubeconfigs',
      'Longer overlaps and per-site tracking for offline sites',
      'Client-side verification'
    ],
    acceptable: [
      'Cross-signing the new CA with the old as a transition mechanism, with trade-offs explained',
      'Short-lived certificates with automated issuance, if CA rotation is still covered'
    ],
    redFlags: [
      'Removes the old CA before leaves are reissued',
      'Assumes all certificates rotate automatically',
      'Verifies only by looking at files on disk'
    ]
  },
  aws: { analogy: 'ACM managed renewal for public certificates, and AWS Private CA for internal ones.',
    breaks: 'ACM renews certificates it manages, and public trust roots are already in client trust stores. With a private cluster CA you own distribution of the trust bundle to every client, cluster component and webhook, and in offline sites distribution waits for the next transfer.' },
  refs: [
    { t: 'Manual rotation of CA certificates', u: 'https://kubernetes.io/docs/tasks/tls/manual-rotation-of-ca-certificates/' },
    { t: 'Certificate management with kubeadm', u: 'https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/' },
    { t: 'Configure certificate rotation for the kubelet', u: 'https://kubernetes.io/docs/tasks/tls/certificate-rotation/' }
  ],
  verify: 'One-year default validity for kubeadm client certificates and kubelet certificates is from the current docs; whether kubelet rotation is enabled by default depends on distribution and configuration.'
},

{ id: 'ons-q-design-03', track: 'onsite', topic: 'design', priority: 'P2', level: 3, mins: 10,
  prereqs: ['les-disconnected', 'ons-q-design-07'],
  design: 'ons-design-multicluster',
  q: 'How do you monitor clusters that can\'t send telemetry home in real time?',
  context: 'Some clusters sit behind links that are intermittent, low-bandwidth or one-way on a schedule. Operators centrally still need to know whether those sites are healthy.',
  evaluates: [
    'Keeps collection and alerting local so the site can act on its own',
    'Uses store-and-forward with bounded buffers and explicit loss handling',
    'Uses heartbeats and treats absence of data as a distinct state',
    'Handles clock sync, summarised health reports and a controlled manual export path'
  ],
  spoken: 'I assume the site has to look after itself, and the centre gets a delayed, summarised view.\n\nSo collection, storage and alerting run locally: metrics, logs and alert rules inside the site, routed to whoever can act there. Central monitoring is a second consumer, not the only one.\n\nFor getting data out I use store-and-forward with bounded buffers. When the link is down, data queues locally. The buffer has a size limit and a documented policy for what gets dropped first, because an unbounded buffer eventually fills a disk and causes the outage it was meant to observe. When the link returns, a summarised health report goes first, then the detail as bandwidth allows.\n\nHeartbeats tell the centre the site is alive and reporting. Absence of data is its own state: a site that has not reported is "unknown", shown distinctly from healthy and from failed, with its own runbook.\n\nClocks matter. If site clocks drift, merged timelines lie, so time sync is part of the design, and each report says when it was generated as well as when it arrived.\n\nFor sites with no network path at all, there is a manual export path under the same controls as any other data leaving the site.',
  deep: 'Local first: the site runs its own metrics collection, log aggregation and alert evaluation, with retention sized for the longest expected disconnection plus investigation time. Alerts route to local responders or a local queue. This keeps detection and first response independent of the link.\n\nStore-and-forward: an agent writes outbound data to a local durable queue and forwards when connected. Design choices: bound by size and age; prioritise (heartbeats and health summaries first, then alerts, then metrics at reduced resolution, then logs); record what was dropped so the centre knows the gap is loss, not silence. Backfill when reconnected should be rate-limited so it does not saturate a thin link or the central ingestion.\n\nHeartbeats and absence: each site sends a small, signed heartbeat on a schedule. The centre tracks "last seen" and expected cadence, and classifies sites as reporting, stale or unknown. Treating a missing heartbeat as healthy hides outages; treating it as failed triggers false escalations every time a link drops. Absence is its own alert, with a runbook that asks whether the link, the pipeline or the site is down.\n\nClock sync: timestamps from unsynchronised clocks produce misleading timelines and break correlation. Each site needs a reliable local time source; reports carry both generation and receipt time so delays are visible.\n\nSummarised health: a compact report (component status, SLO attainment, top alerts, versions running, certificate expiries, backup age, capacity headroom) is more useful over a thin link than raw metrics. Design it so the centre can answer "is this site OK, and what is it running" from the summary alone.\n\nManual export: where only periodic physical or one-way transfer exists, the export is a defined procedure with review of what leaves, integrity protection, and a record of the transfer, following the site\'s data-handling rules.',
  followups: [
    { q: 'The link has been down for three days and the local buffer is 90% full. What do you want the system to do?',
      guidance: 'Follow the pre-defined drop policy: keep heartbeats, alerts and summaries, downsample or drop high-volume metrics and verbose logs first, and record what was dropped. Alert locally that the buffer is near capacity. Never let the buffer fill the disk used by workloads.' },
    { q: 'A site reconnects and sends a report saying everything was healthy. How much do you trust it?',
      guidance: 'Check the report\'s generation time, the gap in heartbeats and any recorded data loss. A summary covers only what it measured, so compare with local alert history and confirm the telemetry pipeline itself was running. Treat gaps as unknown, not healthy.' },
    { q: 'How would you roll out a change to the alert rules across these sites?',
      guidance: 'Version the rules as a signed artifact shipped with normal transfers, test them against recorded data first, canary on one site, and report the active rules version in the health summary so the centre knows which sites run which rules.' }
  ],
  misconceptions: [
    'If a site is not sending alerts it is healthy. It may be disconnected; absence is unknown.',
    'Buffering solves disconnection. Unbounded buffers fill disks; bounded buffers lose data, so you need a drop policy.',
    'Central monitoring is enough. Detection and response must work while the link is down.'
  ],
  weak: [
    'Assumes a real-time pipeline to a central system',
    'No plan for data loss during outages',
    'Ignores clock drift',
    'Treats missing data as healthy or as failed'
  ],
  evidence: 'site:    collectors -> local TSDB/logs (retention >= max outage + investigation) -> local alerting\n         outbound queue (bounded: size + age) priority: heartbeat > health summary > alerts > metrics (downsampled) > logs\n         drop policy recorded in the next summary\ncentre:  last_seen per site; state = reporting | stale (> 2x cadence) | unknown (> N x cadence)\n         absence alert with its own runbook\nsummary: versions, SLO attainment, top alerts, cert expiries, backup age, capacity, dropped-data counts, generated_at',
  rubric: {
    strong: [
      'Local collection and alerting that works while disconnected',
      'Bounded store-and-forward with prioritisation and recorded loss',
      'Heartbeats and a distinct unknown state for absence',
      'Clock sync and generated-versus-received timestamps',
      'Summarised health reports and a controlled manual export path'
    ],
    acceptable: [
      'Pull-based collection by the centre during connectivity windows, if local alerting and loss accounting are covered',
      'Treats each site as fully autonomous with periodic reports only, justified by link constraints'
    ],
    redFlags: [
      'Unbounded buffering',
      'Absence of data treated as healthy',
      'Moves data out of a site without controls'
    ]
  },
  aws: { analogy: 'The CloudWatch agent buffering locally, CloudWatch alarms with a "treat missing data" setting, and region bring-up where a new region must be observable before everything is connected.',
    breaks: 'In AWS, the monitoring service is regional and managed. A disconnected cluster needs its own full monitoring stack that you operate, the central view is delayed by design, and "missing data" is the normal state between transfers rather than an exception.' },
  refs: [
    { t: 'Metrics for Kubernetes system components', u: 'https://kubernetes.io/docs/concepts/cluster-administration/system-metrics/' },
    { t: 'Tools for monitoring resources', u: 'https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-usage-monitoring/' },
    { t: 'Logging architecture', u: 'https://kubernetes.io/docs/concepts/cluster-administration/logging/' }
  ],
  verify: ''
},

{ id: 'ons-q-design-01', track: 'onsite', topic: 'design', priority: 'P2', level: 3, mins: 12,
  prereqs: ['les-failure', 'les-reconcile', 'ons-q-design-05'],
  design: 'ons-design-remediation',
  q: 'How would you prevent automated remediation from amplifying an outage?',
  context: 'You own automation that restarts, reschedules or replaces unhealthy components across many clusters. During a partial outage it made things worse by restarting too much at once on shared capacity.',
  evaluates: [
    'Rate limits, concurrency caps and per-target and global budgets',
    'Circuit breakers and exponential backoff with jitter',
    'Distinguishes "no telemetry" from "unhealthy" and requires corroborating signals',
    'Blast-radius limits and isolation of shared capacity',
    'Human escalation, kill switch and audit'
  ],
  spoken: 'The failure mode is that remediation turns a partial outage into a total one. Everything looks unhealthy at once, the automation acts on everything at once, and the actions themselves load shared capacity that was already struggling.\n\nSo I bound it. Per-target budgets: this pod or node can be remediated at most N times in a window. Global budgets and concurrency caps: at most a few actions in flight per cluster and across the fleet. When a large fraction of targets look unhealthy at the same time, a circuit breaker stops the automation and pages a human, because widespread failure usually means a shared cause that restarts will not fix. Retries use exponential backoff with jitter, so they do not synchronise.\n\nI also check the inputs. "No telemetry" is not "unhealthy": if the monitoring pipeline breaks, the automation must not conclude that everything is down. Before acting I want a corroborating signal from a second source.\n\nActions are idempotent, and they run with quotas that stop remediation work from starving the service. There is a kill switch any operator can set, and every action is audited.\n\nRemediation load on shared capacity is something I have dealt with directly, which is why I start from the budgets.',
  deep: 'How amplification happens: a dependency slows down; health checks time out; remediation restarts instances; restarts cause cold caches, reconnect storms and re-replication; the dependency slows further; more checks fail. Or the telemetry path breaks and every target appears unhealthy. Either way the automation\'s actions are positively correlated with the failure.\n\nBudgets and pacing: per-target limits prevent a restart loop on one component; global limits and concurrency caps bound the total disruption regardless of how many targets look bad. Rate limits should apply at each level (per cluster, per region or site, fleet). Backoff with jitter spreads retries so recovering systems are not hit by a synchronised wave.\n\nCircuit breakers: if the fraction of unhealthy targets crosses a threshold, or actions are not improving health, stop acting and escalate. Kubernetes has a similar idea in places; for example, the node lifecycle controller by default slows node evictions when a large fraction of nodes in a zone look unhealthy, on the reasoning that the cause is probably shared. PodDisruptionBudgets also limit voluntary evictions. Your own automation gets none of this unless you build it.\n\nSignal quality: classify inputs as healthy, unhealthy or unknown. Unknown (no data, stale data, collector errors) never triggers destructive action. Require corroboration, such as a failing probe plus an elevated error rate, or checks from two vantage points, before acting.\n\nShared capacity: remediation consumes resources: new pods need scheduling, images, data replication, API server requests. Isolate it with quotas, priority classes and API Priority and Fairness where relevant, and prefer the least disruptive action first (remove from traffic, then restart, then replace).\n\nHumans and audit: escalation when budgets are exhausted or the breaker opens; a kill switch checked before every action; structured audit logs of inputs, decisions and actions, so post-incident review can see what the automation believed. Test the automation\'s behaviour under partial failure deliberately, including telemetry loss.',
  followups: [
    { q: 'The monitoring pipeline fails and every node reports no metrics. What does your automation do?',
      guidance: 'Classifies them as unknown, not unhealthy, takes no destructive action, and raises an alert about telemetry absence. The circuit breaker should also trip on "too many targets in an abnormal state", which covers this case even if classification fails.' },
    { q: 'How do you pick the global budget and breaker thresholds?',
      guidance: 'From capacity: how many simultaneous replacements the shared resources can absorb without degrading (scheduling headroom, replication bandwidth, API server load), with margin. From history: normal remediation rates. Start conservative, observe, and review after incidents. Make thresholds configurable without redeploying.' },
    { q: 'How would you test that the safeguards actually work?',
      guidance: 'Inject correlated failures and telemetry loss in a non-production environment, and verify the breaker opens, budgets hold, unknown targets are left alone, and humans are paged. Include the kill switch in the test. Lab results are evidence of logic, not of production capacity behaviour.' }
  ],
  misconceptions: [
    'More remediation means more availability. Unbounded remediation correlates with failures and can cause them.',
    'No data means unhealthy. It means unknown, and is often a telemetry problem.',
    'Kubernetes controllers already protect you. Some built-in controllers have safeguards; your own automation has only the ones you build.'
  ],
  weak: [
    'Only "add retries"',
    'No global limit, only per-target limits',
    'Treats missing telemetry as failure',
    'No human escalation or kill switch'
  ],
  evidence: 'inputs    : healthy | unhealthy | unknown   (unknown never triggers destructive action)\ncorroborate: probe failing AND error-rate elevated (or 2 vantage points) before acting\nbudgets   : per-target 3/hour; per-cluster 2 in flight; fleet 10 in flight\nbreaker   : open if >20% of targets unhealthy OR health not improving after N actions -> stop, page\nretries   : exponential backoff with jitter\nescalate  : budget exhausted | breaker open | unexpected state\ncontrols  : kill switch checked before every action; audit log of inputs, decision, action, result',
  rubric: {
    strong: [
      'Per-target and global budgets, concurrency caps and backoff with jitter',
      'Circuit breaker on correlated failure with human escalation',
      'Unknown is distinct from unhealthy; corroborating signals',
      'Isolation of remediation load on shared capacity',
      'Kill switch and audit'
    ],
    acceptable: [
      'Demotes automation to "recommend, human approves" above a threshold, with reasoning',
      'Uses existing platform safeguards (PDBs, controller rate limits) plus custom global budgets'
    ],
    redFlags: [
      'Restarts everything that fails a health check',
      'Treats missing data as unhealthy',
      'No limit on concurrent actions'
    ]
  },
  aws: { analogy: 'EC2 Auto Scaling health-check replacement, and Route 53 health checks that treat all records as healthy when every one of them fails.',
    breaks: 'Route 53\'s behaviour is a built-in fail-open for the all-unhealthy case; custom remediation on Kubernetes has no such guard unless you build it. Some Kubernetes controllers rate-limit themselves, but restarts are cheap to trigger at a scale that shared capacity cannot absorb.' },
  refs: [
    { t: 'Disruptions and PodDisruptionBudgets', u: 'https://kubernetes.io/docs/concepts/workloads/pods/disruptions/' },
    { t: 'Safely drain a node', u: 'https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/' },
    { t: 'API Priority and Fairness', u: 'https://kubernetes.io/docs/concepts/cluster-administration/flow-control/' }
  ],
  verify: 'Node lifecycle controller eviction rate limiting and unhealthy-zone behaviour are configured by kube-controller-manager flags whose names and defaults vary by version; confirm before citing specifics.'
},

{ id: 'ons-q-design-02', track: 'onsite', topic: 'design', priority: 'P2', level: 3, mins: 12,
  prereqs: ['les-rollouts', 'les-failure', 'les-disconnected', 'ons-q-delivery-01'],
  design: 'ons-design-multicluster',
  q: 'How would you upgrade a fleet of isolated clusters that you can reach only intermittently?',
  context: 'You run many clusters in sites that receive periodic transfers and have intermittent connectivity. Each needs a Kubernetes minor version upgrade, and there is no always-on central control.',
  evaluates: [
    'Respects the version skew policy: control plane before nodes, one minor at a time',
    'Pre-stages complete bundles and runs preflight checks locally',
    'Uses canary sites and a local rollback or recovery plan',
    'Drains nodes safely with PodDisruptionBudgets',
    'Reports results back asynchronously'
  ],
  spoken: 'I plan around three constraints: the version skew policy, the fact that each site must complete the upgrade without me, and the fact that I will find out how it went later.\n\nSkew first. The control plane is upgraded before the nodes, one minor version at a time, and kubelets may not be newer than the API server. Current policy lets kubelets lag the API server by a few minor versions, but I confirm that for the versions involved rather than relying on it.\n\nThen staging. Each site gets a complete, verified bundle ahead of time: images, binaries, node packages, manifests and the runbook. The upgrade tooling runs preflight checks locally: versions, certificate expiry, etcd backup taken, disk space, deprecated APIs in use, PodDisruptionBudgets that would block drains. It refuses to start if they fail.\n\nI start with canary sites that are representative and recoverable, then widen in waves. Nodes are drained one at a time, respecting PDBs, and upgraded. Each site keeps a local recovery plan, including the etcd backup and the previous version\'s artifacts, because control-plane downgrade is often not a supported path.\n\nFinally each site reports back asynchronously: a signed summary of versions, checks and health, sent with the next transfer.',
  deep: 'Version skew: per the Kubernetes version skew policy, kube-apiserver instances in an HA cluster must be within one minor of each other, and upgrades should not skip minor versions. Controller-manager and scheduler must not be newer than the API server they talk to. Kubelets must not be newer than the API server and, for recent versions, may be up to three minors older. The documentation also says to drain a node before a minor kubelet upgrade, since in-place minor kubelet upgrades are not supported. So the order is: API servers, then other control-plane components, then nodes, one minor per step. A multi-minor jump is several sequential upgrades, each needing its bundle.\n\nPre-staging: the bundle for each step contains everything the site needs with no outside access: control-plane and node images, packages or node images, CNI and CSI versions compatible with the target, add-on manifests, and the tooling itself. Verify on import (signed manifest, digests) well before the maintenance window.\n\nPreflight: run locally and fail fast: current and target versions and skew; etcd health and a fresh backup; certificate expiry (an upgrade is a bad time to discover expired certs); free disk for images; APIs removed in the target version still in use by stored objects or manifests; PDBs that would block drains (for example, maxUnavailable 0 with a single replica); capacity to reschedule a drained node\'s pods.\n\nExecution: control plane first, verify health (API server responding, controllers running, etcd healthy); then nodes one at a time or in small batches: cordon, drain respecting PDBs, upgrade, verify Ready and workload health, uncordon. Stop on anything unexpected; the site\'s operators need clear stop points and decision criteria, since you may not be reachable.\n\nRollback: downgrading a control plane is often unsupported or risky, so recovery usually means restoring from the etcd backup onto the previous version, or rebuilding. Document it, rehearse it on the canary tier, and keep previous-version artifacts on site until the upgrade is confirmed.\n\nReporting: a summary per site (versions, preflight results, timings, issues, health after) returned with the next outbound transfer. Centrally, track each site as not started, in progress, done, failed or unknown.',
  followups: [
    { q: 'Preflight finds a PodDisruptionBudget with maxUnavailable 0 on a single-replica workload. What do you do?',
      guidance: 'The drain will block forever. Options: coordinate with the owner to scale up first, accept a brief outage with the owner\'s approval and a documented override, or skip that node until resolved. Do not delete the PDB silently. Make the preflight catch this before the window.' },
    { q: 'A site is two minor versions behind the target. How does that change the plan?',
      guidance: 'Two sequential upgrades, each with its own bundle, preflight and verification, because the API server must not skip minor versions. Check deprecated API removals across both steps and the kubelet skew during the transition.' },
    { q: 'The upgrade fails midway on a site you cannot reach for a week. What must already be true?',
      guidance: 'Local operators have a runbook with stop points, the etcd backup and previous artifacts are on site, the cluster was left in a supported skew state at each step (control plane done before nodes), and the tooling reports clear state. Upgrading in small, verifiable steps makes "stopped halfway" a stable state.' }
  ],
  misconceptions: [
    'You can skip minor versions if you are careful. The skew policy says kube-apiserver must not skip minor versions when upgrading.',
    'Nodes can be upgraded before the control plane. Kubelets must not be newer than the API server.',
    'Rollback is just installing the old version. Control-plane downgrade is often unsupported; recovery usually means restoring etcd or rebuilding.',
    'A lab upgrade on kind proves the fleet plan. It tests the procedure, not each site\'s hardware, data and constraints.'
  ],
  weak: [
    'No mention of version skew or order',
    'Assumes internet access during the upgrade',
    'No preflight checks',
    'No plan for learning the result'
  ],
  evidence: 'preflight (local, refuse to start on failure):\n  [ ] current/target versions; one minor step; skew OK\n  [ ] etcd healthy; fresh backup stored off-node\n  [ ] certificates not expiring within the window + margin\n  [ ] removed APIs not in use; disk space for new images\n  [ ] PDBs allow draining; capacity to reschedule one node\norder: kube-apiserver -> controller-manager/scheduler -> nodes (cordon, drain, upgrade, verify, uncordon)\n\n$ kubectl drain worker-3 --ignore-daemonsets --delete-emptydir-data --timeout=10m\n$ kubectl get nodes -o wide     # confirm VERSION column per node',
  rubric: {
    strong: [
      'Correct upgrade order and skew constraints, hedged to the versions involved',
      'Complete pre-staged, verified bundles and local preflight checks',
      'Canary sites, waves and a rehearsed local recovery plan',
      'Safe drains with PDB awareness',
      'Asynchronous reporting with an unknown state'
    ],
    acceptable: [
      'Rebuild-and-replace (new cluster at the target version, migrate workloads) where state allows, with trade-offs explained',
      'Relies on the distribution\'s upgrade tooling, while still covering skew, preflight and reporting'
    ],
    redFlags: [
      'Upgrades nodes before the control plane',
      'Skips minor versions',
      'No backup before touching the control plane'
    ]
  },
  aws: { analogy: 'EKS control-plane and managed node group upgrades, and region bring-up where artifacts must be staged before anything can deploy.',
    breaks: 'EKS upgrades and backs up the control plane for you and the region is always reachable. Here you own the control plane, etcd backups and recovery, and each site must complete the upgrade on its own and tell you afterwards.' },
  refs: [
    { t: 'Version skew policy', u: 'https://kubernetes.io/releases/version-skew-policy/' },
    { t: 'Upgrading kubeadm clusters', u: 'https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/' },
    { t: 'Safely drain a node', u: 'https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/' }
  ],
  verify: 'Skew figures (kubelet up to three minors older than kube-apiserver for kubelet 1.25 and later; drain before a minor kubelet upgrade) are from the current version skew policy; confirm for your versions and your distribution\'s upgrade path.'
}

);
