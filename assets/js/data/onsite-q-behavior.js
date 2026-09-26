/* Onsite track — behavioural questions. Practice prompts (not known interview questions) answered from Brett's
   sanitized story bank (LX.onsiteStories). Spoken answers are skeletons: [bracketed] parts are details only the
   learner can supply. Never replace a placeholder with an invented number, date, team size or outcome. */
window.LX = window.LX || {};
LX.onsiteQ = LX.onsiteQ || [];
LX.onsiteQ.push(
{ id: 'ons-q-behavior-01', track: 'onsite', topic: 'behavior', priority: 'P3', level: 1, mins: 3,
  prereqs: ['les-services', 'les-identity'],
  stories: ['ons-story-scope'],
  q: 'Tell me about a time a change went out wider than intended.',
  context: 'A common behavioural prompt about blast radius and ownership. The interviewer wants one specific incident, your part in it and what changed afterwards.',
  evaluates: [
    'Ownership without blame: what you did, and what the system allowed to happen',
    'Whether you understood the root cause (how empty criteria came to mean "everything")',
    'The order of the response: contain, correct, prevent',
    'Whether the prevention was systemic (a guard), not just "be more careful"'
  ],
  spoken: 'A component rollout reached more targets than intended. The scoping criteria were empty, and the system treated empty as unrestricted, not as "nothing". On some of the targets a required identity prerequisite was missing, so the component failed there. My part was [your role: what you personally owned]. We found it through [how it was detected].\n\nThe response went in order. First we contained it by disabling the component. Then we corrected the scope. Then we added prerequisite verification through the consuming API, so a missing prerequisite would be caught when the configuration was used rather than after rollout. [How you verified the scope and failures were resolved.]\n\nThe lesson I took is that "empty" has to be defined explicitly everywhere you target something. Kubernetes has the same trap: an empty selector means different things in different APIs. For example, an empty podSelector in a NetworkPolicy selects every pod in the namespace. So in a cluster I would reject empty scope fields at admission, roll out to a canary first and preflight identity with `kubectl auth can-i`.',
  deep: 'What is really being probed: can you own a mistake calmly, explain the mechanism that caused it, and show that the fix changed the system rather than relying on people being more careful? Interviewers also listen for **blast-radius thinking**: how you contained it and how you would stop it spreading next time.\n\nStructure: **situation** (a rollout exceeded its intended scope; your role), **evidence** (failures from a missing identity prerequisite, root cause traced to empty scoping criteria), **action** (disable, correct scope, add prerequisite verification), **verification** (how you confirmed it was fixed; supply this), **reflection** (the lesson about empty meaning "everything").\n\nThe Kubernetes bridge is a good place to show real understanding, as long as you present it as mapping, not experience. The Kubernetes docs state that the meaning of an empty or unspecified selector depends on the API type. An empty `podSelector: {}` in a NetworkPolicy selects all pods in its namespace. In `policy/v1` a PodDisruptionBudget with an empty selector matches every pod in the namespace (in the older `v1beta1` it matched none). A Service with no selector does not match everything. The control plane simply does not create EndpointSlices for it. Knowing that these differ is exactly the lesson of the story.\n\nThe identity half maps to ServiceAccounts and RBAC. A missing ServiceAccount typically stops pod creation, which appears as FailedCreate events on the ReplicaSet. A missing RoleBinding lets the pod run but its API calls get Forbidden. Prevention in Kubernetes terms: a validating admission policy that rejects empty scope fields, staged rollout to a canary namespace or cluster, and a preflight that checks the identity exists and has the permissions it needs.',
  followups: [
    { q: 'Why disable instead of fixing forward?', guidance: 'Containment reduces the harm while you work out the right fix. Explain the trade-off in general terms. If someone else made that call, say so and describe your part.' },
    { q: 'What would an empty label selector do in Kubernetes?', guidance: 'It depends on the API, and the docs say so. NetworkPolicy empty podSelector: all pods in the namespace. policy/v1 PDB empty selector: all pods in the namespace. Service with no selector: no automatic EndpointSlices. The safe habit is to check each API\'s documentation and reject empty values where they are dangerous.' },
    { q: 'How would you make this impossible rather than unlikely?', guidance: 'An admission rule that rejects empty scope. Required fields in the schema (for example a CRD field with a minimum length or required property). A dry-run that reports how many targets would be affected, with a limit that needs explicit approval to exceed.' }
  ],
  misconceptions: [
    'An empty selector always means "match nothing". It depends on the API. Several Kubernetes APIs treat an empty selector as "match everything in scope".',
    'Adding a checklist item is enough prevention. A guard enforced where the configuration is consumed is stronger than a reminder to the author.'
  ],
  weak: [
    'A vague "we pushed a bad config and rolled it back" with no mechanism and no personal role.',
    'Blaming the person who left the criteria empty.',
    'Inventing the size of the impact or how long it took to fix.'
  ],
  evidence: '',
  rubric: {
    strong: [
      'States their own role precisely and separates it from the team\'s',
      'Explains the mechanism (empty treated as unrestricted, missing identity prerequisite)',
      'Describes containment, correction and a systemic guard in that order',
      'Is honest about details they do not know, such as the exact impact',
      'Maps the lesson onto Kubernetes selectors and admission without claiming Kubernetes production experience'
    ],
    acceptable: [
      'Focuses on the prevention design rather than the incident timeline, if the role is clear',
      'Uses a different Kubernetes bridge (for example staged GitOps promotion) that addresses blast radius'
    ],
    redFlags: [
      'Invented numbers (targets, duration, users affected)',
      'Taking credit for the whole team\'s response, or a vague "we" throughout',
      'Blaming individuals',
      'Claiming this happened on Kubernetes'
    ]
  },
  aws: null,
  refs: [
    { t: 'Labels and Selectors', u: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/' },
    { t: 'Network Policies', u: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/' },
    { t: 'Validating Admission Policy', u: 'https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/' }
  ],
  verify: 'Whether a Pod naming a non-existent ServiceAccount is rejected at creation depends on the ServiceAccount admission controller being enabled (normally on). Confirm on your cluster.'
},
{ id: 'ons-q-behavior-02', track: 'onsite', topic: 'behavior', priority: 'P3', level: 2, mins: 4,
  prereqs: ['les-request-path'],
  stories: ['ons-story-dns'],
  q: 'Tell me about a hard problem you debugged where the obvious answer was wrong.',
  context: 'A debugging-reasoning prompt. The interviewer wants to hear the hypotheses you tested, the evidence that separated them, and how you avoided being misled.',
  evaluates: [
    'Whether you can explain a technical mechanism clearly (here: DNS delegation versus authority)',
    'Hypothesis-driven debugging: what test ruled out what',
    'Awareness of things that mislead validation, such as caches',
    'Verification discipline (post-write checks)'
  ],
  spoken: 'During a region bring-up, DNS resolution failed. The obvious conclusion was that the zone or its records were wrong. My role was [your role in the bring-up].\n\nTo separate the possibilities, the authoritative servers were queried directly, skipping the normal resolver path. [Who ran those queries: you or a teammate.] The child zone answered correctly, so its data was fine. The problem was one level up: the parent zone had no delegation to it. Resolvers find a zone by following NS records down from the parent, so without the delegation normal clients could never reach a child that was working. [How the delegation was fixed, and by whom.]\n\nTwo things made it harder. Every write was verified afterwards, and that caught mistakes before they caused more confusion. And negative caching meant resolvers could keep returning the old "does not exist" answer for a while after the fix, so a re-test through a resolver could fail even though the fix was correct. [How you validated despite that.]\n\nIn a cluster I would apply the same layering: pod resolv.conf, the cluster DNS Service and its endpoints, how cluster DNS forwards, then the upstream authority, while remembering each layer can cache.',
  deep: 'What is really being probed: hypothesis-driven debugging, and whether you can **explain a mechanism clearly**. This story is strong because the obvious answer (the zone is broken) was disproved by one well-chosen test.\n\nThe mechanism, said plainly: DNS is a delegation tree. A recursive resolver starts at the root (or an internal root or forwarder in a disconnected network) and follows referrals. Each parent zone holds NS records for the child (and glue addresses when the name servers sit inside the child zone). If the parent is missing those NS records, the resolver gets a "does not exist" or no-referral answer at the parent and stops. It never reaches the child\'s servers. `dig @child-ns name` goes straight to the child\'s server and succeeds. `dig +trace name` walks down from the root and shows the exact level where the referral is missing. That split between the two results is the diagnosis.\n\nNegative caching: a resolver that got NXDOMAIN may cache that answer, typically for a period taken from the zone\'s SOA record (the lower of the SOA TTL and its minimum field), possibly capped by the resolver\'s own settings. So validate against the authoritative servers first. Then either wait out the negative cache or query a resolver that did not see the old answer.\n\nKubernetes bridge (presented as mapping, not experience): pods use the cluster DNS Service via `/etc/resolv.conf`, which lists search domains like `<ns>.svc.cluster.local` and an `ndots` option. The debugging path is: exec into a debug pod, read resolv.conf, `nslookup kubernetes.default`, check the cluster DNS pods are Ready and the DNS Service has endpoints, read cluster DNS logs, check nothing (such as a NetworkPolicy) blocks port 53, then check the forwarding for external names. Cluster DNS usually caches too, so the same negative-caching trap applies.',
  followups: [
    { q: 'Explain the difference between a delegation problem and a zone data problem.', guidance: 'Zone data problem: the authoritative server answers, but the answer is wrong. Delegation problem: the authoritative server would answer correctly, but resolvers never reach it because the parent has no (or wrong) NS records. Direct `@server` queries tell them apart.' },
    { q: 'How would you debug a pod that cannot resolve a Service name?', guidance: 'resolv.conf in the pod, nslookup a known name, cluster DNS pods Ready and Service endpoints present, cluster DNS logs, NetworkPolicy on port 53, the target Service existing in the expected namespace, and the fully qualified name versus relying on search domains.' },
    { q: 'How do you validate a DNS fix when caches are involved?', guidance: 'Query the authoritative server directly first, since it has no cache. Then understand the negative-cache lifetime from the SOA and resolver config, and either wait it out or use a resolver that did not see the old answer. Do not keep changing things because a cached negative answer made the fix look broken.' }
  ],
  misconceptions: [
    'If the zone\'s own server answers correctly, DNS is fine. Clients also need a delegation path from the parent.',
    'A failed re-test right after a fix means the fix did not work. A cached negative answer can still be served until it expires.'
  ],
  weak: [
    'Saying "it was DNS" without explaining delegation versus authority.',
    'Inventing TTL values or durations.',
    'Claiming Kubernetes cluster DNS production experience based on this story.'
  ],
  evidence: '# Illustrative commands (generic names)\ndig +trace app.child.example.internal\ndig @ns1.child.example.internal app.child.example.internal\ndig @parent-ns child.example.internal NS\n\n# Inside a cluster\nkubectl exec -it dnsutils -- cat /etc/resolv.conf\nkubectl exec -it dnsutils -- nslookup kubernetes.default\nkubectl get endpointslices -n kube-system -l kubernetes.io/service-name=kube-dns',
  rubric: {
    strong: [
      'Explains delegation versus child-zone authority in plain words',
      'Names the discriminating test (direct authoritative queries) and what it showed',
      'Explains negative caching as a validation complication and how they handled it (or supplies a placeholder honestly)',
      'States personal role clearly',
      'Bridges to cluster DNS debugging as a method, not as claimed experience'
    ],
    acceptable: [
      'Uses a different story (for example transfer) if it shows the obvious answer being disproved by evidence',
      'Spends less time on the Kubernetes bridge and more on the method, if the method is precise'
    ],
    redFlags: [
      'Invented TTLs, durations or record counts',
      'Mechanism described wrongly (for example, saying the child zone controls its own delegation)',
      'Vague "we figured out it was DNS" with no evidence',
      'Taking credit for fixing a parent zone they did not own, if they did not'
    ]
  },
  aws: null,
  refs: [
    { t: 'DNS for Services and Pods', u: 'https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/' },
    { t: 'Debugging DNS Resolution', u: 'https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/' }
  ],
  verify: 'Negative-cache lifetime depends on the SOA values and resolver/cluster DNS cache settings. The kube-dns Service name and label are common defaults and can differ by distribution.'
},
{ id: 'ons-q-behavior-03', track: 'onsite', topic: 'behavior', priority: 'P3', level: 2, mins: 4,
  prereqs: ['les-operators', 'les-failure'],
  stories: ['ons-story-capacity'],
  q: 'Tell me about a time you had to escalate something to another team, and how you made the case.',
  context: 'A collaboration and influence prompt. The interviewer wants to hear how you built evidence, what you ruled out, and how you asked another team to act without blaming them.',
  evaluates: [
    'Evidence gathering before escalating: ruling things out',
    'The quality of the ask: specific, actionable, with impact stated',
    'Collaboration: no blame, a shared problem',
    'Systems thinking about shared capacity and amplification'
  ],
  spoken: 'Shared regional capacity was being consumed, and investigation showed it came from repeated remediation requests from a small set of clusters. My role was [your role in noticing and investigating it].\n\nBefore escalating, the case had to hold up, so other bottlenecks were ruled out. [Your part in ruling them out.] [The other bottlenecks you ruled out, and the evidence for each.] Once those were excluded, the pattern of repeated remediation from those clusters was the explanation that fitted the evidence.\n\nThe escalation went to [the owning team, in general terms]. It set out what we saw, what we had ruled out, the effect on shared capacity and a specific request. [What was asked for.] [The outcome, if you know it.]\n\nThere was a separate problem nearby: a detector was treating missing telemetry as a failure. That is a different lesson: "no data" needs its own state and should not trigger failure handling.\n\nIn Kubernetes terms the lesson is that automated remediation needs back-off, retry caps and a global limit. API Priority and Fairness is the API server\'s own protection against one noisy client starving others.',
  deep: 'What is really being probed: can you move work across a team boundary with evidence rather than opinion, and without making it personal? Strong escalations are **specific** (what, where, since when if known), **evidenced** (data, and what was ruled out), **impact-framed** (why it matters to shared users), and include a **clear ask**.\n\nStructure: situation (shared capacity consumed; your role), evidence (repeated remediation from a small set of clusters; other bottlenecks ruled out), action (the escalation: to whom, containing what), verification (how you would know it worked, or did), reflection (amplification and telemetry semantics).\n\nKeep the detector separate. The facts say it was a separate detector. Do not tell it as the cause of the capacity problem unless you know that. It is still worth mentioning because it shows judgment about signals.\n\nKubernetes bridge (as design knowledge, not experience): controllers normally requeue failed work with rate-limited exponential back-off, and CrashLoopBackOff is the kubelet applying back-off to restarts. A custom remediation operator should keep per-target attempt counters, back off, cap retries, have a global concurrency limit and a circuit breaker that pages a person. API Priority and Fairness (FlowSchemas and priority levels) queues API requests fairly so one client cannot starve the rest. PodDisruptionBudgets limit voluntary disruption from drains and evictions. For telemetry, Kubernetes itself separates a node Ready condition of **Unknown** (the control plane stopped hearing from the kubelet) from **False** (the kubelet reports unhealthy). That is the same distinction the detector got wrong.',
  followups: [
    { q: 'How did you know it was not some other bottleneck?', guidance: '[the bottlenecks ruled out and the evidence]. If you cannot recall specifics, say you tested each hypothesis against data and explain the method, without inventing the checks.' },
    { q: 'What if the other team had pushed back?', guidance: 'Offer to review the evidence together, agree on a measurement both sides trust, and propose a short-term mitigation that protects shared capacity while the root cause is discussed. Stay factual.' },
    { q: 'Design remediation that cannot overwhelm shared capacity.', guidance: 'Per-target back-off and retry limit, global rate or concurrency limit, a circuit breaker to a human, idempotent actions, PDBs for disruptive steps, and metrics on remediation attempts per target. Treat missing telemetry as its own state.' }
  ],
  misconceptions: [
    'Escalating early and loudly is always best. Escalating with evidence and a clear ask gets action faster and keeps trust.',
    'Missing telemetry means something is down. Absence of data is its own state and needs its own alert.'
  ],
  weak: [
    'An escalation story that is really a complaint about another team.',
    'No mention of what was ruled out.',
    'Invented request volumes or cluster counts.'
  ],
  evidence: '',
  rubric: {
    strong: [
      'Explains how other causes were ruled out before escalating',
      'Describes the contents of the escalation and a specific ask',
      'Frames the other team as partners; no blame',
      'Keeps the detector issue separate and draws the correct lesson from it',
      'Honest about outcome and personal role; uses placeholders instead of guesses'
    ],
    acceptable: [
      'Emphasises the design lesson (back-off, caps, APF) over the escalation mechanics, if the evidence step is clear',
      'Uses the transfer story if it involved another team and the case was evidence-backed'
    ],
    redFlags: [
      'Inventing numbers for clusters, requests or capacity',
      'Blaming the other team or individuals',
      'Claiming the escalation fixed everything without knowing the outcome',
      'Merging the detector issue into the capacity cause without evidence'
    ]
  },
  aws: null,
  refs: [
    { t: 'API Priority and Fairness', u: 'https://kubernetes.io/docs/concepts/cluster-administration/flow-control/' },
    { t: 'Node Status', u: 'https://kubernetes.io/docs/reference/node/node-status/' },
    { t: 'Controllers', u: 'https://kubernetes.io/docs/concepts/architecture/controller/' }
  ],
  verify: ''
},
{ id: 'ons-q-behavior-04', track: 'onsite', topic: 'behavior', priority: 'P3', level: 1, mins: 3,
  prereqs: ['les-rollouts'],
  stories: ['ons-story-runbook'],
  q: 'Describe how you\'ve made operational knowledge usable by others.',
  context: 'A written-communication and team-leverage prompt. The interviewer wants to hear what made the knowledge hard to use, what you changed, and how you know it worked.',
  evaluates: [
    'Written communication aimed at a reader with less context',
    'Whether prerequisites and validation were included, not just steps',
    'Evidence the document was actually used or tested',
    'Judgment about what to automate versus document'
  ],
  spoken: 'The operational instructions for [the procedure, in general terms] were incomplete. [What was missing, for example prerequisites, ordering or how to confirm success.] That meant [the problem it caused, in general terms].\n\nI consolidated them into a single reusable runbook. My part was [your role: what you personally wrote, tested or reviewed]. The two things I focused on were prerequisites and validation. Prerequisites so the operator knows before starting what has to be true: access, identity, dependencies in place. Validation so each stage ends with a check and the expected result, not just "run this command". When the output does not match, the runbook says what to look at next.\n\n[How it was validated: ideally someone else ran it successfully.] [The outcome, if you know it.]\n\nIn Kubernetes I would carry the same structure over. Prerequisites become preflight checks such as `kubectl auth can-i`, server-side dry-run and confirming CRDs exist. Validation uses rollout status, Ready conditions, Service endpoints and a functional check, because a successful rollout only proves pods passed their probes. The repeatable parts are candidates for automation.',
  deep: 'What is really being probed: do you make the team stronger, and can you write clearly? Infrastructure teams depend on runbooks during incidents, when readers are stressed and have little context. Interviewers want to hear that you wrote for that reader.\n\nWhat makes a runbook good, and worth saying out loud: **scope** (when to use it, when not to), **prerequisites** (access, identity, dependencies, versions), **exact steps** with **expected output**, **validation** at each stage, **rollback or stop points**, and **where to escalate**. Mention how it stays current: an owner, kept next to the code or configuration, and updated whenever someone finds a gap.\n\nThe honest limit: the story says you consolidated instructions into a runbook with prerequisites and validation. It does not say how many people used it or what it saved. Use placeholders and supply real evidence only if you have it. "Another operator completed it without help" is strong evidence if true.\n\nKubernetes bridge: much of what runbooks used to describe step by step becomes declared state reconciled by controllers, and an operator is essentially a runbook in code for one application. Runbooks still matter for diagnosis (`kubectl describe`, events, `logs --previous`), break-glass actions (`rollout undo`, cordon/drain) and anything outside the cluster. Validation must go beyond "rollout complete", because that only shows pods became Ready by their probes.',
  followups: [
    { q: 'How do you keep it from going stale?', guidance: 'Owner, keep it with the code or configuration it describes, review when the procedure changes, validation steps that fail visibly when reality changes, and invite readers to fix gaps as they find them.' },
    { q: 'What would you automate first?', guidance: 'Prerequisite checks and validation. They are deterministic and catch the most errors. Keep human decision points documented.' },
    { q: 'How would you write a Kubernetes incident runbook for a failing Deployment?', guidance: 'Rollout status, describe the Deployment and its pods, events, logs --previous, compare the current and previous ReplicaSet, decide between undo and fixing forward, then validate with Ready conditions, endpoints and a functional check.' }
  ],
  misconceptions: [
    'A runbook is just a list of commands. Without prerequisites and validation it moves the risk onto the reader.',
    'A successful rollout proves the service works. It proves pods became Ready by their probes, so add a functional check.'
  ],
  weak: [
    'Describing formatting or tooling instead of what made the runbook usable.',
    'Claiming time saved or incidents avoided without data.',
    'No evidence anyone else used it.'
  ],
  evidence: '',
  rubric: {
    strong: [
      'Names what was missing and why it mattered',
      'Highlights prerequisites and validation specifically',
      'Gives honest evidence of use, or says they do not have it',
      'Distinguishes what to automate from what to document',
      'Clear personal role'
    ],
    acceptable: [
      'Uses a different example of written operational communication (for example an escalation write-up) if it shows the same qualities',
      'Focuses on how they would do it in Kubernetes if the original story is clearly stated first'
    ],
    redFlags: [
      'Invented metrics (time saved, adoption numbers)',
      'Dismissing documentation as unimportant',
      'Claiming sole authorship of shared work'
    ]
  },
  aws: null,
  refs: [
    { t: 'Deployments', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' },
    { t: 'kubectl auth can-i', u: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/' }
  ],
  verify: ''
},
{ id: 'ons-q-behavior-05', track: 'onsite', topic: 'behavior', priority: 'P3', level: 2, mins: 4,
  prereqs: ['les-reconcile', 'les-workloads'],
  stories: ['ons-story-dns', 'ons-story-runbook', 'ons-story-scope'],
  q: 'Your background is mostly AWS-managed services rather than Kubernetes. How would you ramp up, and how should we think about that gap?',
  context: 'A direct question about a real gap. The interviewer is testing self-awareness, honesty and a credible learning plan, not whether you can pretend the gap does not exist.',
  evaluates: [
    'Honest framing of the gap without underselling or overstating',
    'Which skills genuinely transfer, with evidence',
    'A concrete ramp-up plan and evidence of progress already made',
    'Understanding that lab experience is not production experience'
  ],
  spoken: 'The gap is real. I have not operated Kubernetes in production. My production experience is running a managed search service on AWS, including region bring-up in isolated environments, controlled deployments, incident response and runbooks.\n\nWhat I think transfers is the operating discipline: working through dependency chains during bring-up, verifying after every change, containing blast radius first, and writing runbooks with prerequisites and validation. Those came from real incidents, such as a region bring-up blocked by a missing DNS delegation, found by querying authoritative servers directly. [Your role in it.]\n\nWhat is new is the Kubernetes model itself: reconciliation, how pods, Services and EndpointSlices fit together, RBAC and ServiceAccounts, and how clusters fail. It is not a one-to-one match with ECS or IAM, and I try to be precise about where the analogies break.\n\nSo far I have [labs you completed in this track and real kind labs you ran]. That is lab experience, not production experience, and I would treat it that way. My plan for the first months would be [your ramp-up plan: e.g. shadowing on-call, reading the team\'s runbooks, taking small changes end to end]. I would expect you to judge me on how quickly my questions get sharper.',
  deep: 'What is really being probed: self-awareness and honesty under a direct challenge, and whether your learning plan is concrete. The two failure modes are **overclaiming** (implying lab work or ECS equals Kubernetes production experience) and **underselling** (apologising without naming what transfers).\n\nA good structure: **name the gap plainly**, **name what transfers with evidence** (a specific story, not adjectives), **name what is genuinely new**, **show progress with concrete evidence**, **propose a ramp plan** tied to the team\'s way of working, and **say how they can measure it**.\n\nWhat transfers, honestly: incident response, controlled rollouts, verification discipline, dependency-chain debugging (the DNS story), treating identity as a prerequisite (the scope story), written operations (the runbook story), and working in disconnected delivery. What is new: the declarative reconcile model, Kubernetes networking objects and how kube-proxy or the CNI implements them, RBAC semantics, scheduler behaviour, and in-cluster failure modes.\n\nWhere AWS analogies help and where they break, so you can show calibration: an ECS service is roughly like a Deployment plus Service, but Kubernetes separates scheduling, networking and identity into distinct objects and controllers. IAM roles for tasks resemble ServiceAccounts, but Kubernetes RBAC governs the Kubernetes API, and access to cloud APIs needs a separate workload-identity mapping. Saying where they break is itself evidence of understanding.\n\nEvidence of improvement: fill in the placeholder with what you actually did, for example which labs in this track you completed, and any real local clusters you ran with kind. Say explicitly that a local cluster is lab experience. It shows how fast you learn, not production judgment.',
  followups: [
    { q: 'What is the biggest difference between ECS and Kubernetes, in your view?', guidance: 'Kubernetes is a general API of declared objects reconciled by independent controllers, extensible with CRDs and operators. ECS is a narrower managed service. Give one concrete break in the analogy, such as RBAC governing the Kubernetes API rather than cloud APIs.' },
    { q: 'Tell me something you got wrong while learning Kubernetes.', guidance: '[a real misconception you corrected while studying, for example assuming readiness failures restart containers]. Explain what corrected it. Only use something that actually happened.' },
    { q: 'What would you need from us in your first months?', guidance: 'Access to runbooks and past incident write-ups, a chance to shadow on-call before carrying it, small, low-risk changes to take end to end, and a named person to review your first changes.' }
  ],
  misconceptions: [
    'Local lab experience equals production experience. A kind cluster shows mechanics, not production scale, failure modes or organisational context.',
    'Kubernetes and ECS map object for object. They do not. Analogies help but break on identity, networking and extensibility.'
  ],
  weak: [
    'Claiming Kubernetes production experience or implying labs are equivalent.',
    'Apologising for the gap without naming what transfers.',
    'A generic plan ("read the docs") with no evidence of progress.'
  ],
  evidence: '',
  rubric: {
    strong: [
      'States the gap plainly and without defensiveness',
      'Backs transferable skills with a specific story',
      'Names what is genuinely new and where AWS analogies break',
      'Gives concrete evidence of progress and labels lab work as lab work',
      'Offers a concrete ramp plan and a way to measure it'
    ],
    acceptable: [
      'Emphasises operational judgment over technology, if the gap is still named honestly',
      'Proposes a different but concrete ramp plan (for example pairing on specific components)'
    ],
    redFlags: [
      'Overstating Kubernetes experience or equating labs with production',
      'Inventing certifications, projects or durations',
      'Dismissing Kubernetes as "just containers" or "the same as ECS"',
      'No concrete evidence of learning'
    ]
  },
  aws: null,
  refs: [
    { t: 'Controllers', u: 'https://kubernetes.io/docs/concepts/architecture/controller/' },
    { t: 'kind Quick Start', u: 'https://kind.sigs.k8s.io/docs/user/quick-start/' }
  ],
  verify: ''
},
{ id: 'ons-q-behavior-06', track: 'onsite', topic: 'behavior', priority: 'P3', level: 3, mins: 4,
  prereqs: ['les-failure'],
  stories: ['ons-story-capacity', 'ons-story-transfer', 'ons-story-scope'],
  q: 'Tell me about a time you had to make a decision with incomplete information during an incident.',
  context: 'A judgment-under-ambiguity prompt. Pick one story (capacity, transfer or scope). The interviewer wants to hear what you knew, what you did not, how you chose a safe action, and how you checked it afterwards.',
  evaluates: [
    'Separating what was known from what was assumed',
    'Choosing reversible or containing actions under uncertainty',
    'How evidence was gathered while acting',
    'Honest reflection on the decision'
  ],
  spoken: '[Choose one story. The skeleton below uses the capacity story. Swap in transfer or scope if it fits your real role better.]\n\nShared regional capacity was being consumed, and at first the cause was not clear. My role was [your role]. What we knew was [what was known at the time]. What we did not know was whether the cause was the remediation traffic or some other bottleneck.\n\nThe decision was [the decision you actually made or contributed to, in general terms]. [Why that option: ideally it was reversible and produced more evidence, but say so only if true.] The other possible bottlenecks were worked through and ruled out, which pointed to repeated remediation requests from a small set of clusters. That was the basis for an evidence-backed escalation. [The outcome, if you know it.]\n\nOne thing I watch for when information is incomplete is misreading the signals themselves. In the same period a separate detector was treating missing telemetry as a failure. Missing data is its own state, not proof something is broken.\n\nLooking back, [what you would do differently].',
  deep: 'What is really being probed: judgment. Do you act when you have to, prefer reversible and containing moves, keep collecting evidence, and review honestly afterwards? The interviewer is not looking for someone who is always right. They are looking for someone whose decisions are **safe when wrong**.\n\nA useful frame to say out loud: **known / unknown / assumed**. Then: **options** (and which are reversible), **the choice and why**, **what would change my mind**, **what happened**, and **reflection**.\n\nChoosing the story: *capacity* shows diagnosis under ambiguity and a signal-quality lesson (missing telemetry is not failure). *Transfer* shows deciding what to trust when the receiving side reveals issues of several kinds (registration, identity, architecture). *Scope* shows a containment decision (disable first). Pick the one where your **personal** decision-making role is clearest, and use placeholders for anything you do not know.\n\nKubernetes bridge (as reasoning, not experience): Kubernetes gives you reversible moves to reach for under uncertainty: `kubectl rollout pause` and `rollout undo`, scaling a Deployment down, cordoning a node rather than deleting it, and a narrow NetworkPolicy instead of broad changes. It also has explicit uncertainty states worth knowing: a node Ready condition of **Unknown** means the control plane has stopped hearing from the kubelet, not that workloads are dead. Treating Unknown as failure can trigger unnecessary evictions or remediation.',
  followups: [
    { q: 'What would have changed your decision?', guidance: 'Name the evidence that would have pointed another way, for example [the signal that would have implicated a different bottleneck]. It shows you held the decision as a hypothesis.' },
    { q: 'Did you get anything wrong?', guidance: '[an honest reflection, if you have one]. A small, real mistake with a clear lesson is better than a claim of perfection.' },
    { q: 'In Kubernetes, what are your reversible moves during an incident?', guidance: 'Pause or undo a rollout, scale down, cordon rather than drain or delete, a narrowly targeted NetworkPolicy, disabling a feature through configuration. Check the effect with events, Ready conditions and endpoints before the next step.' }
  ],
  misconceptions: [
    'Good incident decisions need complete information. They need a safe, reversible action and a way to learn quickly.',
    'No telemetry means the component is down. Missing data is its own state, and Kubernetes itself distinguishes Unknown from False.'
  ],
  weak: [
    'Presenting the decision as obviously right with no uncertainty acknowledged.',
    'Inventing timelines or numbers to make the story sound decisive.',
    'Using "we decided" throughout with no personal role.'
  ],
  evidence: '',
  rubric: {
    strong: [
      'Separates known, unknown and assumed explicitly',
      'Explains why the chosen action was safe or reversible',
      'Describes how evidence was gathered while acting',
      'Clear personal role and honest reflection',
      'Correctly distinguishes missing telemetry from failure'
    ],
    acceptable: [
      'Uses the transfer or scope story instead of capacity, if the decision point is clear',
      'Focuses on how the decision was communicated if that was their real contribution'
    ],
    redFlags: [
      'Invented metrics, timelines or outcomes',
      'Claiming sole credit for a team decision',
      'Blaming others for the missing information',
      'No reflection or lesson'
    ]
  },
  aws: null,
  refs: [
    { t: 'Node Status', u: 'https://kubernetes.io/docs/reference/node/node-status/' },
    { t: 'Deployments', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' }
  ],
  verify: ''
}
);
