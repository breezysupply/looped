/* Onsite track — behavioural story bank. Five sanitized stories from Brett's background, each mapped to the
   Kubernetes concepts it touches, what transfers, what is new, likely follow-ups, and the details only Brett can supply.
   The `facts` strings are the ONLY facts. Everything else in [brackets] is a placeholder the learner must fill in. */
window.LX = window.LX || {};
LX.onsiteStories = LX.onsiteStories || [];

LX.onsiteStories.push({
  id: 'ons-story-scope', track: 'onsite', title: 'A rollout that reached further than intended',
  facts: 'Component rollout exceeded intended scope because empty scoping criteria were treated as unrestricted. A missing identity prerequisite caused failures. Response involved disabling the component, correcting scope, and adding prerequisite verification through the consuming API.',
  concepts: [
    { c: 'Label selectors and empty-selector semantics',
      why: 'This is the closest Kubernetes parallel to "empty criteria treated as unrestricted". The Kubernetes docs say the meaning of an empty or unspecified selector depends on the API type, so you have to check each one. Examples: an empty `podSelector: {}` in a NetworkPolicy selects every pod in the namespace. In the `policy/v1` PodDisruptionBudget API an empty selector matches every pod in the namespace (the older `v1beta1` matched none). A Service with **no** selector does not match everything. It just gets no automatically managed EndpointSlices. So "empty" can mean everything, nothing or "manage it yourself". Never assume which.' },
    { c: 'Admission control (validating admission policies and webhooks)',
      why: 'An admission rule can reject an object whose scope field is empty, or whose prerequisites are not declared, before it is stored. That is the Kubernetes place for "the consuming API verifies prerequisites".' },
    { c: 'ServiceAccounts and RBAC',
      why: 'Workload identity in Kubernetes is a ServiceAccount plus RBAC bindings, and often a mapping to a cloud identity. If the ServiceAccount is missing, pod creation typically fails. If the RoleBinding is missing, API calls return Forbidden at runtime. These two failures look different, and telling them apart is the diagnostic skill being tested.' },
    { c: 'Progressive rollout and blast radius',
      why: 'Rolling updates (maxSurge/maxUnavailable), canary namespaces or clusters, and staged promotion in a GitOps controller all limit how far a bad change can spread before a signal stops it.' },
    { c: 'Preflight checks: server-side dry-run, diff and `kubectl auth can-i`',
      why: 'A server-side dry-run sends the change through admission without saving it. `kubectl diff` shows what would change. `kubectl auth can-i --as=system:serviceaccount:NS:NAME` checks whether an identity prerequisite is actually satisfied before you roll out.' }
  ],
  transfers: [
    'Treating "what does an empty filter mean?" as a question you have to answer explicitly for every targeting mechanism.',
    'The response order: contain first (disable the component), then correct scope, then add a guard so the same class of mistake is caught automatically.',
    'Treating identity as a deployment prerequisite you verify, not something you assume is already there.',
    'Moving validation to the point where the configuration is consumed, not relying on the author to get it right.'
  ],
  newKnowledge: [
    'The per-API meaning of empty versus missing selectors in Kubernetes. It is inconsistent across resource types and API versions.',
    'How ServiceAccount, Role/ClusterRole and RoleBinding fit together, and how missing identity shows up (pod creation events versus Forbidden errors in logs).',
    'How admission control works (validating admission policies, admission webhooks) and its failure modes, such as a webhook that is unavailable.',
    'How a GitOps controller or Deployment rollout is paused, reverted or scaled down in practice.'
  ],
  followups: [
    { q: 'How did you find out the scope was wrong?',
      guidance: 'Say what signal you actually saw: [the signal that revealed the wider scope]. If someone else noticed first, say so. How it was detected is part of the lesson.' },
    { q: 'What exactly was your role?',
      guidance: 'Be specific and truthful: [your role: what you personally owned, e.g. diagnosis, the disable, the scope fix, the verification change]. Separate what you did from what the team did.' },
    { q: 'Why was "disable" the right first move instead of fixing forward?',
      guidance: 'Explain the trade-off in general terms: containing the spread came before a proper fix. Do not invent timings. If you were not the one who decided, say who did and what you contributed.' },
    { q: 'How would you prevent this in Kubernetes?',
      guidance: 'Admission rule that rejects empty scope fields. Staged rollout to a canary cluster or namespace. A preflight that checks the ServiceAccount and RBAC exist (`kubectl auth can-i`). An alert on the number of targets actually selected. Present these as what you would do, not what you have done in Kubernetes.' },
    { q: 'What did the prerequisite verification actually check?',
      guidance: 'Only describe what you know: [what "prerequisite verification through the consuming API" meant concretely]. If you did not build it, say who did and how you validated it.' }
  ],
  structure: [
    'Situation: a component rollout reached more targets than intended. [your role: what you personally owned].',
    'Signal/evidence: failures appeared on targets that lacked an identity prerequisite. [how the problem was detected]. Root cause: empty scoping criteria were treated as "everything".',
    'Action: contain by disabling the component, then correct the scope. [which parts you did versus the team].',
    'Verification: [how you confirmed the scope was correct and the failures stopped]. Prerequisite verification was added through the consuming API.',
    'What changed / what I would do in Kubernetes: never assume empty means none. The meaning of an empty selector depends on the API. Guard with admission rules, staged rollout and an identity preflight.'
  ],
  supply: [
    '[your role: what you personally owned in the response]',
    '[how the wider scope was detected, and by whom]',
    '[the impact, stated only as far as you actually know it]',
    '[what "prerequisite verification through the consuming API" meant concretely]',
    '[the outcome: was the guard proven to catch a later mistake, if you know it]'
  ],
  pitfalls: [
    'Inventing the number of affected targets or how long it lasted. Say "[impact]" in practice and use the real figure only if you have it.',
    'Blaming whoever wrote the empty criteria. The better lesson is that the system let empty mean everything.',
    'Presenting it as Kubernetes experience. It is a transferable pattern that you map onto Kubernetes.',
    'A vague "we fixed it" with no indication of what you personally did.'
  ],
  questions: ['ons-q-behavior-01', 'ons-q-behavior-06'],
  lessons: ['les-services', 'les-netpol', 'les-identity', 'les-rollouts', 'les-operators'],
  verify: 'Whether a Pod naming a non-existent ServiceAccount is rejected at creation depends on the ServiceAccount admission controller being enabled (recommended and normally on). Confirm on your cluster version.'
});

LX.onsiteStories.push({
  id: 'ons-story-dns', track: 'onsite', title: 'Region bring-up blocked by DNS delegation',
  facts: 'Region bring-up failed on DNS resolution. Direct authoritative queries distinguished a functioning child zone from missing parent delegation. Post-write verification caught mistakes; negative caching complicated validation.',
  concepts: [
    { c: 'Delegation versus authority (the DNS mechanism)',
      why: 'A child zone can be fully correct on its own name servers and still be unreachable. Resolvers find it by walking down from the root, and each parent zone must hold NS records (plus glue if needed) pointing at the child. If the parent has no delegation, a recursive resolver never learns where the child lives. Asking the child\'s server directly (`dig @child-ns name`) works, while normal resolution fails. That split is the diagnosis.' },
    { c: 'Querying authoritatively: `dig @server` and `dig +trace`',
      why: '`dig @ns name` asks one specific server and skips your resolver and its cache. `dig +trace name` does the walk from the root itself and shows which level stops giving a referral. The level where the chain breaks is where the fix belongs. In a disconnected environment "root" means your internal root or forwarder, so the tool shows your own hierarchy.' },
    { c: 'Negative caching',
      why: 'When a resolver gets NXDOMAIN or NODATA it can cache that "no" answer. The cache time typically comes from the zone\'s SOA record (the lower of the SOA TTL and its minimum field), and resolvers may cap it. So after you fix the delegation, a resolver can keep returning the old negative answer until that expires. Check against the authoritative server (which has no cache) before concluding the fix failed.' },
    { c: 'Cluster DNS (CoreDNS or equivalent) and the pod resolv.conf',
      why: 'Pods usually send queries to the cluster DNS Service. Their `/etc/resolv.conf` has search domains such as `<ns>.svc.cluster.local` and an `ndots` option, so short names are tried with several suffixes. Names outside the cluster are forwarded upstream according to the DNS server\'s configuration. The same layered reasoning applies: pod resolv.conf, then the cluster DNS Service and its endpoints, then the cluster DNS logs and forward config, then the upstream authoritative chain.' },
    { c: 'Caching layers in cluster DNS',
      why: 'The cluster DNS server usually caches answers, including negative ones, and some clusters add a node-local cache. After an upstream DNS fix, a pod can still see the old answer until each layer\'s cache expires. That is the same trap as in the story.' }
  ],
  transfers: [
    'The diagnostic habit: split "is the data correct at the source?" from "can clients find the source?" by querying the authoritative server directly.',
    'Verifying after every write instead of trusting the change went in as intended.',
    'Knowing that caches (including negative caches) can make a correct fix look broken, and accounting for that before re-testing.',
    'Working through a dependency chain layer by layer during bring-up instead of guessing.'
  ],
  newKnowledge: [
    'Cluster DNS specifics: the kube-dns/CoreDNS Service, its configuration, the pod `dnsPolicy`, search domains and `ndots`.',
    'Service DNS record formats (`svc.ns.svc.cluster.local`, headless Services returning pod IPs) and how EndpointSlices feed them.',
    'Debugging from inside the cluster with a throwaway debug pod (`kubectl exec ... nslookup`, reading resolv.conf, cluster DNS logs).',
    'How NetworkPolicy can block DNS egress to the cluster DNS Service (UDP/TCP port 53), which looks like a "DNS is down" symptom.'
  ],
  followups: [
    { q: 'Walk me through exactly what the direct queries showed.',
      guidance: 'Explain the mechanism: the child zone\'s own server answered correctly, but the parent zone had no NS delegation, so normal resolution never reached the child. Use only what you actually saw: [the specific queries you ran and what they returned].' },
    { q: 'How did negative caching complicate validation, and how did you handle it?',
      guidance: 'Explain that a resolver cached a "does not exist" answer from before the fix, so re-tests through it could still fail. Say how you checked around it: [how you validated, e.g. querying authoritative servers directly or waiting for expiry]. Do not invent TTL values.' },
    { q: 'What mistakes did post-write verification catch?',
      guidance: 'Only describe what you remember: [the kind of mistake caught, stated generally]. Otherwise say it caught errors before they caused further failures and explain why you verify after each write.' },
    { q: 'A pod cannot resolve a Service name. How do you debug it?',
      guidance: 'Check the pod resolv.conf (nameserver, search, ndots). Run nslookup on a known name like `kubernetes.default`. Check that the cluster DNS pods are Ready and its Service has endpoints. Read the cluster DNS logs. Check for a NetworkPolicy blocking port 53. Check the target Service exists in the namespace you think it does. Explain that this is the same layered reasoning as the story.' },
    { q: 'Who owned the parent zone, and how did you get it fixed?',
      guidance: '[who owned the parent delegation and how the fix was made]. If it needed another team, describe how you handed over the evidence. Do not claim you made the change if you did not.' }
  ],
  structure: [
    'Situation: region bring-up failed at DNS resolution. [your role in the bring-up].',
    'Signal/evidence: normal resolution failed. Direct authoritative queries showed the child zone was answering correctly but the parent delegation was missing.',
    'Action: [how the delegation was added, and by whom]. Every write was checked by querying the authoritative servers directly, which caught mistakes.',
    'Verification: negative caching meant resolvers could keep returning the old "does not exist" answer. [how you confirmed the fix despite that].',
    'What changed / what I would do in Kubernetes: the same layered approach (pod resolv.conf, cluster DNS Service and endpoints, cluster DNS forwarding, upstream authority), with the same care about caches.'
  ],
  supply: [
    '[your role in the bring-up and in this DNS fix]',
    '[the specific queries you ran and what they showed, in general terms]',
    '[who owned the parent zone and how the delegation was added]',
    '[how you validated around negative caching]',
    '[the outcome: whether bring-up proceeded afterwards, if you know it]'
  ],
  pitfalls: [
    'Muddling the mechanism. Explain delegation versus authority slowly and precisely, because this is the part that shows you understand DNS.',
    'Inventing TTLs, durations or counts of records.',
    'Claiming you ran Kubernetes cluster DNS in production. Say it is the same reasoning applied to a different resolver chain.'
  ],
  questions: ['ons-q-behavior-02', 'ons-q-behavior-06', 'ons-q-behavior-05'],
  lessons: ['les-request-path', 'les-services', 'les-netpol'],
  verify: 'How long a negative answer is cached depends on the zone SOA (TTL and minimum field) and any cap set by the resolver or cluster DNS cache configuration. Confirm against your resolver and cluster DNS configuration.'
});

LX.onsiteStories.push({
  id: 'ons-story-transfer', track: 'onsite', title: 'Receiving-side checks on a controlled transfer',
  facts: 'Controlled artifact transfer and receiving-side verification exposed registration, identity, and architecture-related issues.',
  concepts: [
    { c: 'Image references: tags versus digests',
      why: 'A tag can be moved to point at a different image. A digest (`@sha256:...`) is a hash of the content and cannot change. After a controlled transfer, compare digests on both sides to prove you have the same bytes. A matching hash proves integrity against a value you already trust. It does not prove who published it. That needs a signature checked against a trust root that was distributed separately.' },
    { c: 'Multi-architecture images (image indexes)',
      why: 'A registry can serve an image index that points to a separate manifest for each architecture (for example amd64 and arm64). The container runtime pulls the one that matches the node. If a mirroring step copies only one architecture, or copies a single-architecture manifest under a tag that nodes of another architecture use, pulls can fail or the container fails at start with an exec format error.' },
    { c: 'Registry authentication and pull identity',
      why: 'The kubelet and container runtime pull images, using `imagePullSecrets` on the pod or ServiceAccount, or a node-level credential provider. Missing or wrong pull credentials usually show up as ErrImagePull / ImagePullBackOff with an authorization error in the pod events.' },
    { c: 'Registration of artifacts in the receiving system',
      why: 'An artifact that has arrived is not usable until it is registered. In Kubernetes terms: pushed to the internal registry under the name the manifests reference, and any matching custom resources or charts made available. Checking on the receiving side catches "the bytes arrived but nothing points at them".' },
    { c: 'Node architecture and scheduling',
      why: 'Nodes carry the `kubernetes.io/arch` label. A nodeSelector or node affinity on it can keep a single-architecture image off nodes that cannot run it, as a stopgap until a multi-architecture image is published.' }
  ],
  transfers: [
    'Verifying on the receiving side instead of trusting the sender\'s checks.',
    'Treating a transfer as several separate checks: integrity, identity/authorization and compatibility (architecture). Each one fails on its own.',
    'Working in controlled or disconnected delivery, where anything missing is expensive to fetch again.',
    'Grouping issues by type (registration, identity, architecture) to make the fix systematic.'
  ],
  newKnowledge: [
    'OCI image indexes and manifests, and how to inspect them with a registry client (for example `crane` or `skopeo`), used only as examples.',
    'How kubelet pull credentials work (`imagePullSecrets`, ServiceAccount-attached pull secrets, credential providers).',
    'Signature verification in admission (an admission controller that verifies signatures against a configured trust root).',
    'Mirror configuration for a disconnected cluster: container runtime registry mirrors and rewriting image references.'
  ],
  followups: [
    { q: 'What exactly were the registration, identity and architecture issues?',
      guidance: 'Describe each one only as far as you know it and can share it: [the registration issue, in general terms], [the identity issue], [the architecture issue]. If you are unsure of a detail, say so.' },
    { q: 'How would you verify an image after moving it into a disconnected registry?',
      guidance: 'Compare digests with the source. Check the index contains every architecture you need. Verify signatures against a trust root that came through a separate channel. Pull it on a node of each architecture. A hash alone proves integrity, not who published it.' },
    { q: 'What did you personally do on the receiving side?',
      guidance: '[your role: which checks you ran or built]. Keep it separate from what the transfer process or other teams did.' },
    { q: 'How would these issues appear in a Kubernetes cluster?',
      guidance: 'Registration: ErrImagePull "not found". Identity: an authorization error on pull, or Forbidden errors for the workload\'s ServiceAccount. Architecture: no matching manifest, or an exec format error at container start and then back-off. Check events with `kubectl describe pod` and logs with `--previous`.' }
  ],
  structure: [
    'Situation: artifacts moved through a controlled transfer into a receiving environment. [your role].',
    'Signal/evidence: verification on the receiving side exposed registration, identity and architecture-related issues. [how each was detected, in general terms].',
    'Action: [what was done about each class of issue, and by whom].',
    'Verification: [how you confirmed the artifacts were usable after the fixes].',
    'What changed / what I would do in Kubernetes: pin by digest, mirror full multi-architecture indexes, verify signatures against a separate trust root, and pre-pull on each node type as a readiness check.'
  ],
  supply: [
    '[your role: which verification steps you personally ran or built]',
    '[each issue, described generally and without internal names]',
    '[what was changed as a result]',
    '[the outcome, if you know it]'
  ],
  pitfalls: [
    'Saying a checksum proves authenticity. It proves integrity against a value you already trust.',
    'Giving internal system names or mission details while explaining the transfer. Keep it generic.',
    'Implying you ran Kubernetes image supply chains. Map the concepts across instead.'
  ],
  questions: ['ons-q-behavior-06', 'ons-q-behavior-02'],
  lessons: ['les-disconnected', 'les-identity', 'les-scheduling', 'les-pod-lifecycle']
});

LX.onsiteStories.push({
  id: 'ons-story-capacity', track: 'onsite', title: 'Repeated remediation exhausting shared capacity',
  facts: 'Repeated remediation requests from a small set of clusters consumed shared regional capacity. Investigation ruled out other bottlenecks and produced an evidence-backed escalation. A separate detector confused missing telemetry with a failure condition.',
  concepts: [
    { c: 'Remediation amplification and controller back-off',
      why: 'Automated remediation that keeps retrying without success can use up a shared resource for everyone else. Kubernetes controllers generally requeue with rate-limited, exponential back-off, and CrashLoopBackOff is the kubelet doing the same for restarts. Any custom remediation controller should have back-off, a per-target retry cap and a global concurrency limit.' },
    { c: 'API Priority and Fairness',
      why: 'The API server groups requests into priority levels and queues them fairly, so one noisy client cannot starve the rest. This is the in-cluster version of "a few clusters should not be able to consume shared regional capacity".' },
    { c: 'PodDisruptionBudgets and drain limits',
      why: 'If remediation evicts or drains, PDBs limit how many pods of an application can be disrupted voluntarily at once. They put a ceiling on what automation can do to a workload.' },
    { c: 'Missing telemetry versus failure (Unknown is not False)',
      why: 'Kubernetes separates the two. A node\'s Ready condition becomes Unknown when the control plane stops hearing from the kubelet within a grace period, which is different from False (unhealthy). Detectors should do the same. "No data" should raise its own alert about telemetry, not trigger failure remediation.' },
    { c: 'ResourceQuota and shared capacity',
      why: 'Namespace ResourceQuotas and limit ranges bound how much of a shared cluster one tenant can use. It is the same idea of not letting a small number of consumers exhaust a pool.' }
  ],
  transfers: [
    'Ruling out other bottlenecks before naming a cause, so the escalation holds up.',
    'Writing an escalation that another team can act on: what you saw, what you ruled out, what you are asking for.',
    'Recognising amplification: the fix mechanism itself becoming the load.',
    'Distinguishing "no signal" from "bad signal" in alerting and automation.'
  ],
  newKnowledge: [
    'Controller patterns: workqueues, requeue with back-off, idempotent reconcile, status conditions.',
    'API Priority and Fairness objects (FlowSchema, PriorityLevelConfiguration) and the API server metrics used to see throttling.',
    'How the Kubernetes metrics pipeline works (metrics-server for resource metrics; a separate monitoring stack for everything else) and where gaps in telemetry come from.',
    'Node condition semantics and the taints the node lifecycle controller adds for unreachable versus not-ready nodes.'
  ],
  followups: [
    { q: 'Which other bottlenecks did you rule out, and how?',
      guidance: 'Name the categories only if you remember them: [the other bottlenecks you ruled out, and the evidence for each]. The point to make is the method: each hypothesis was tested with data before you escalated.' },
    { q: 'What did the escalation contain, and who received it?',
      guidance: '[what the escalation contained and who it went to, in general terms]. A strong answer covers the problem statement, the evidence, what was ruled out, the impact on shared capacity and a specific request. Do not invent the outcome.' },
    { q: 'What happened with the detector that confused missing telemetry with failure?',
      guidance: 'This was a separate problem. Explain the lesson: absence of data needs its own state. [what you did about it, if anything, and your role]. Do not merge it into the capacity story as if one caused the other unless you know that.' },
    { q: 'How would you design remediation in Kubernetes so this cannot happen?',
      guidance: 'Per-target back-off and retry caps. A global concurrency or rate limit. A circuit breaker that stops and pages a human after repeated failures. PDBs on disruptive actions. Treat "Unknown" as its own state. Metrics on remediation attempts per target so amplification is visible.' },
    { q: 'What was the result of the escalation?',
      guidance: '[the outcome of the escalation, if you know it]. If you do not know, say so. That is better than guessing.' }
  ],
  structure: [
    'Situation: shared regional capacity was being consumed. [your role in noticing or investigating it].',
    'Signal/evidence: repeated remediation requests traced back to a small set of clusters. [how you established that, in general terms].',
    'Action: ruled out other bottlenecks, then escalated with the evidence to [the owning team, in general terms].',
    'Verification: [how you would know, or knew, that the escalation addressed it]. Separately, a detector was treating missing telemetry as a failure. [what was done].',
    'What changed / what I would do in Kubernetes: remediation needs back-off, caps and a circuit breaker. APF and quotas protect shared capacity. "Unknown" must stay distinct from "failed".'
  ],
  supply: [
    '[your role in the investigation and escalation]',
    '[the other bottlenecks you ruled out, and the evidence]',
    '[what the escalation contained and who received it]',
    '[the outcome of the escalation, if you know it]',
    '[what, if anything, you did about the missing-telemetry detector]'
  ],
  pitfalls: [
    'Inventing numbers for the clusters, request volumes or capacity consumed.',
    'Framing the escalation as blaming the other team. Frame it as a shared problem with evidence.',
    'Linking the detector issue to the capacity issue as cause and effect when the facts only say it was separate.'
  ],
  questions: ['ons-q-behavior-03', 'ons-q-behavior-06'],
  lessons: ['les-operators', 'les-reconcile', 'les-failure', 'les-resources']
});

LX.onsiteStories.push({
  id: 'ons-story-runbook', track: 'onsite', title: 'Turning scattered instructions into a runbook',
  facts: 'Consolidated incomplete operational instructions into a reusable runbook with prerequisites and validation.',
  concepts: [
    { c: 'Declarative state versus procedural steps',
      why: 'In Kubernetes much of what a runbook used to describe step by step becomes declared state that a controller reconciles. Runbooks still matter for diagnosis, break-glass actions and anything outside the cluster.' },
    { c: 'Preflight checks',
      why: 'The runbook\'s "prerequisites" section maps to checks such as `kubectl auth can-i`, server-side dry-run, confirming CRDs exist before custom resources are applied, and confirming images are present in the mirror.' },
    { c: 'Validation using real readiness signals',
      why: 'The runbook\'s "validation" maps to `kubectl rollout status`, pod Ready conditions, Service endpoints and application-level checks. A successful rollout only proves pods passed their probes, not that the application is correct, so validation should include a functional check.' },
    { c: 'Operators as runbooks in code',
      why: 'An operator encodes operational knowledge for one application in a controller that acts on custom resources. It is the automated end of the same line that a good runbook starts.' }
  ],
  transfers: [
    'Writing for a reader who has less context than you: explicit prerequisites, exact commands, expected output, and what to do if it differs.',
    'Putting validation into every procedure instead of ending at "run the command".',
    'Turning knowledge held by a few people into something the team can reuse.',
    'Deciding which steps should become automation and which should stay human judgment.'
  ],
  newKnowledge: [
    'Idiomatic kubectl diagnostics to put in Kubernetes runbooks (`describe`, events, `logs --previous`, `get -o yaml`, `rollout status/undo`).',
    'Which steps a GitOps workflow or an operator replaces, and which still need a human.',
    'Kubernetes-specific prerequisites: RBAC, CRDs, namespaces, quotas, pull secrets, StorageClasses.'
  ],
  followups: [
    { q: 'What was incomplete about the original instructions?',
      guidance: 'In general terms: [what was missing, e.g. prerequisites, validation or ordering]. Do not invent specifics or name internal systems.' },
    { q: 'How did you know the runbook worked?',
      guidance: '[how the runbook was tested or used by someone else]. The strongest evidence is someone other than you completing it successfully. Only claim that if it happened.' },
    { q: 'How do you keep a runbook from going stale?',
      guidance: 'Give an owner and a review trigger (for example, whenever the procedure changes). Keep it next to the code or configuration it describes. Validation steps that fail loudly when reality has changed. Encourage people using it to fix it as they go.' },
    { q: 'What would you automate from it?',
      guidance: 'Prerequisite checks and validation are the easiest to automate first. Steps that need judgment stay as documented decision points.' }
  ],
  structure: [
    'Situation: operational instructions were incomplete. [where they were scattered and what made that a problem, in general terms].',
    'Signal/evidence: [what showed the instructions were not good enough, e.g. a failed attempt or repeated questions].',
    'Action: consolidated them into a reusable runbook with explicit prerequisites and validation. [your role: what you personally wrote or tested].',
    'Verification: [how the runbook was validated, ideally by someone else using it].',
    'What changed / what I would do in Kubernetes: prerequisites become preflight checks, validation uses Ready conditions, endpoints and functional checks, and the repeatable parts can become automation or an operator.'
  ],
  supply: [
    '[your role: what you personally wrote, tested or reviewed]',
    '[what was missing from the original instructions]',
    '[how the runbook was validated and who used it]',
    '[the outcome, if you know it]'
  ],
  pitfalls: [
    'Treating documentation as a minor accomplishment. Frame it as reducing operational risk and making the team independent of one person.',
    'Claiming measurable improvements (time saved, fewer incidents) that you do not have data for.',
    'Talking only about formatting rather than the prerequisites and validation that made it usable.'
  ],
  questions: ['ons-q-behavior-04', 'ons-q-behavior-05'],
  lessons: ['les-rollouts', 'les-operators', 'les-disconnected']
});
