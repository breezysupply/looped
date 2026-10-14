/* SRE & Cloud Deployment Foundations — design workshops D01–D06 (curriculum §9).

   One-page worksheet per design, a 30–45 minute first draft, revisited after
   the paired lab. The rubric tests reasoning (requirements → estimates →
   flows → boundaries → choices with rejected alternatives → operations), not
   whether the drawing matches ours. The reference discussion is shown only
   after a draft is saved and is "one strong answer, not the only one". */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreDesigns = LX.sreDesigns || [];

(function () {
  /* the ten worksheet sections from §9; each design sharpens the prompts */
  function sheet(p) {
    return [
      { id: 'requirements', label: 'Requirements and unknowns', prompt: p.requirements || 'What must be true for users and operators? List the numbers you were given and the ones you had to assume, and mark each assumption.' },
      { id: 'estimates', label: 'Rough load and data estimates (with units)', prompt: p.estimates || 'Requests per second, record size, bytes per day, growth; show the arithmetic with units so a reviewer can check it.' },
      { id: 'flow', label: 'Request and data flow', prompt: p.flow || 'Trace one request and one record end to end: every hop, every protocol, where state lives.' },
      { id: 'boundaries', label: 'Trust and failure boundaries', prompt: p.boundaries || 'Where does identity change, where is data encrypted, and which components fail together?' },
      { id: 'choices', label: 'Choices and rejected alternatives', prompt: p.choices || 'Three decisions, each with the alternative you rejected and why. "Because it is best practice" is not a reason.' },
      { id: 'observability', label: 'Observability', prompt: p.observability || 'Which user-impact signal tells you this design is failing, and which signals tell you why?' },
      { id: 'deploy', label: 'Deployment and rollback', prompt: p.deploy || 'How does a change reach production, and how do you undo it — including data and schema?' },
      { id: 'recovery', label: 'Recovery', prompt: p.recovery || 'What is lost and for how long in each failure you listed? Who decides to fail over or restore?' },
      { id: 'cost', label: 'Cost', prompt: p.cost || 'The two or three line items that dominate, with an order-of-magnitude estimate and what you would trade for them.' },
      { id: 'risks', label: 'Open risks', prompt: p.risks || 'What you did not solve, what you would test first, and what a reviewer should push on.' }
    ];
  }
  var RUBRIC = function (extra) {
    return [
      { id: 'requirements', label: 'Requirements, assumptions and estimates with units' },
      { id: 'flow', label: 'Correct request/data flow and failure boundaries' },
      { id: 'tradeoffs', label: 'Decisions with real rejected alternatives' },
      { id: 'operations', label: 'Observability, rollout/rollback and recovery are concrete' },
      { id: 'honesty', label: 'Names what the design does not solve and what is unverified' }
    ].concat(extra || []);
  };

  LX.sreDesigns.push({
    id: 'D01', moduleId: 'M05', timeboxMins: 40, paired: ['L09', 'L10'],
    title: 'Beacon across two availability zones with private data access',
    brief: 'Beacon (API, worker, PostgreSQL, object storage for exports) is moving from one VM to AWS. The customer wants it to survive the loss of one availability zone, keep sensor data off the public internet, and recover to within **15 minutes of data (RPO)** in **one hour (RTO)** after a regional database failure is declared. Traffic: 40 requests/s average, 400/s peak, 2 KB per status record; exports of about 1 GB/day to object storage.\n\nDraw the request path and the data path, list every dependency, and say what two AZs do and do not protect against. Use the L09 inventory format if it helps; this is a whiteboard exercise, not a deployment.',
    mustAddress: [
      'A dependency inventory: every service Beacon calls (database, object storage, registry, secrets/KMS, DNS, time, logging) and the path it takes',
      'Which tiers are stateless (spread across AZs freely) and which are stateful (need replication or backup) — and the failover behaviour of each',
      'Identity: which role each component runs as, what it may do, and how the database and bucket are reached without public addresses',
      'Ingress and egress: public entry point, private subnets, gateway/interface endpoints versus NAT, and what that costs',
      'What two AZs do NOT solve: regional outage, bad deploy, data corruption, credential loss, a dependency outside your control'
    ],
    worksheet: sheet({
      estimates: '400 req/s × 2 KB = ? per second; × 86 400 = ? per day; what fraction is writes; how big is the database after a year; how many API tasks at your assumed per-task capacity, with headroom for losing an AZ (N+1 across AZs)?',
      flow: 'User → public load balancer → API tasks in private subnets (two AZs) → database writer endpoint; worker → queue/database; exports → object storage through a gateway endpoint. Where does each hop cross an AZ boundary?',
      boundaries: 'Mark the public/private boundary, the IAM roles, KMS keys and the AZ failure domains. Which components share fate with the database writer?',
      recovery: 'One AZ lost; database writer lost; region lost; bad deploy corrupts records. For each: what is lost, how long, who acts. Does your design actually meet RPO 15 min / RTO 60 min, and how would you prove it?'
    }),
    rubric: RUBRIC([{ id: 'az', label: 'Correctly separates AZ resilience from backup/DR' }]),
    reference: 'A strong answer starts from numbers. 400 req/s × 2 KB ≈ 0.8 MB/s at peak; at 40 req/s average with, say, 60% writes, that is about 24 writes/s × 2 KB × 86 400 s ≈ 4 GB/day of raw records before indexes — a year is over 1 TB, so retention and partitioning are a real decision, not a footnote. If one API task handles about 100 req/s, peak needs 4 tasks; to lose an AZ at peak without degradation you need 4 in each of two AZs (or 3 per AZ across three), which is the cost of "survive an AZ".\n\nThe stateless tier (API, worker) is spread across two AZs behind a load balancer whose health checks use `/ready`, so a dead AZ simply stops receiving traffic. The stateful tier is the decision: a managed PostgreSQL with a synchronous standby in the second AZ gives automatic writer failover in a minute or two with no committed-data loss, but it does **not** protect against a bad migration or a deleted table — the standby faithfully replicates the damage. Point-in-time recovery (continuous WAL backup) is what meets RPO 15 minutes for corruption and for a regional event; cross-region snapshot copies or a cross-region replica are what make RTO 60 minutes plausible, and only a timed restore drill proves it.\n\nPrivate access: API and worker run in private subnets with a role each (API: read/write its own tables via database credentials from a secrets store, put objects under one bucket prefix; worker: only what it needs). The bucket is reached through an S3 gateway endpoint with an endpoint policy limiting it to the Beacon bucket, and the bucket policy requires that endpoint (`aws:SourceVpce`). The registry, secrets manager, KMS and logs are reached through interface endpoints or a single NAT path; interface endpoints cost per AZ-hour, NAT costs per GB, so with low egress the honest comparison is a few endpoints versus one NAT per AZ (one NAT per AZ, or the AZ that loses its NAT loses egress).\n\nWhat two AZs do not solve: a regional outage, a bad deploy that passes health checks, data corruption, an expired certificate, a revoked credential, a quota, or a dependency (DNS, registry) that is itself down. Observability must therefore measure the user path (successful writes per second and p99 latency from the load balancer), not just task health. Open risks a reviewer should push on: has the restore actually been timed, does failover change the database endpoint the application caches, and is the second AZ sized for full peak or only for "degraded".',
    diagram: '<svg viewBox="0 0 640 300" role="img" aria-label="Beacon across two availability zones: a public load balancer forwards to API tasks in private subnets in AZ a and AZ b; both reach a database writer in AZ a with a synchronous standby in AZ b, and reach object storage through a gateway endpoint; backups are copied to another region."><rect x="10" y="10" width="620" height="280" rx="10" fill="none" stroke="currentColor" stroke-opacity=".35"/><text x="20" y="30" font-size="13" fill="currentColor">Region</text><rect x="240" y="40" width="160" height="34" rx="6" fill="none" stroke="currentColor"/><text x="320" y="62" font-size="12" text-anchor="middle" fill="currentColor">Load balancer (public)</text><rect x="30" y="90" width="280" height="170" rx="8" fill="none" stroke="currentColor" stroke-dasharray="5 4"/><text x="40" y="108" font-size="12" fill="currentColor">AZ a · private subnets</text><rect x="330" y="90" width="280" height="170" rx="8" fill="none" stroke="currentColor" stroke-dasharray="5 4"/><text x="340" y="108" font-size="12" fill="currentColor">AZ b · private subnets</text><rect x="60" y="125" width="110" height="30" rx="5" fill="none" stroke="currentColor"/><text x="115" y="145" font-size="11" text-anchor="middle" fill="currentColor">API + worker</text><rect x="360" y="125" width="110" height="30" rx="5" fill="none" stroke="currentColor"/><text x="415" y="145" font-size="11" text-anchor="middle" fill="currentColor">API + worker</text><rect x="60" y="205" width="110" height="30" rx="5" fill="none" stroke="currentColor"/><text x="115" y="225" font-size="11" text-anchor="middle" fill="currentColor">DB writer</text><rect x="360" y="205" width="110" height="30" rx="5" fill="none" stroke="currentColor"/><text x="415" y="225" font-size="11" text-anchor="middle" fill="currentColor">DB standby (sync)</text><line x1="170" y1="220" x2="360" y2="220" stroke="currentColor" stroke-dasharray="3 3"/><rect x="200" y="160" width="120" height="28" rx="5" fill="none" stroke="currentColor"/><text x="260" y="179" font-size="10" text-anchor="middle" fill="currentColor">S3 gateway endpoint</text><line x1="320" y1="74" x2="115" y2="125" stroke="currentColor"/><line x1="320" y1="74" x2="415" y2="125" stroke="currentColor"/><line x1="115" y1="155" x2="115" y2="205" stroke="currentColor"/><line x1="415" y1="155" x2="125" y2="205" stroke="currentColor" stroke-opacity=".6"/><text x="500" y="282" font-size="11" fill="currentColor">backups → other region</text></svg>',
    diagramCaption: 'Two AZs protect the stateless tier and the database writer; backups and point-in-time recovery protect against everything two AZs replicate faithfully.',
    sourceIds: ['T08', 'T18']
  });

  LX.sreDesigns.push({
    id: 'D02', moduleId: 'M10', timeboxMins: 40, paired: ['L19', 'L20'],
    title: 'Promote one Beacon release from development to restricted production',
    brief: 'Beacon ships as a container image and a Helm chart. Development deploys on every merge; staging is a shared cluster; production is a restricted environment where only an approved pipeline identity may deploy, secrets come from the platform, and auditors ask "what exactly is running and who approved it?". Last quarter a re-pushed `1.4.2` tag put an untested build into production, and a rollback failed because the new release had already migrated the schema.\n\nDesign the promotion path for one release so that the artifact tested is the artifact running, approvals are recorded, configuration differences are explicit, and rollback is known to be safe before you need it.',
    mustAddress: [
      'Immutable artifact identity: build once, promote the same image digest and chart version; tags are labels, not identity',
      'Test gates and who/what can approve a promotion, with the evidence each gate leaves',
      'Secrets and configuration: what differs per environment, where it lives, and how it is kept out of the artifact and the logs',
      'Rollback compatibility: expand/contract schema changes, what "roll back" means for data, and how you know before the incident',
      'Audit evidence: from a running Pod back to commit, build, scan, test results and approval'
    ],
    worksheet: sheet({
      estimates: 'How many releases per week, how long each gate takes, how long a rollback takes end to end — and which of those times matter to the business.',
      flow: 'Commit → CI build → image digest + chart version → registry → staging deploy (by digest) → tests → approval → production deploy (by the same digest). Who holds which credential at each step?',
      boundaries: 'Where does the trust boundary between "anyone with merge rights" and "can change production" sit? Which identities exist only in the pipeline?',
      deploy: 'Write the promotion as values: what changes between staging and production values files, and what must never change (image digest, chart version).'
    }),
    rubric: RUBRIC([{ id: 'compat', label: 'Rollback compatibility and schema changes handled explicitly' }]),
    reference: 'Build once. CI builds the image from a commit, records its **digest** (`registry.lab/beacon/api@sha256:…`), produces an SBOM and scan result for that digest, and packages a chart whose version is immutable once published. Every later step refers to the digest; the human-readable tag `1.4.2` is a label for people and may point anywhere, which is exactly how last quarter\'s incident happened. Production values pin `image.digest`, and an admission policy (or a pipeline check) rejects images by tag in the restricted environment.\n\nGates: unit tests and lint on the commit; image scan with a documented policy (block on fixable criticals that are reachable, record accepted risks with an owner and expiry — not "ignore all"); deploy to staging by digest; smoke and contract tests against staging; a recorded approval in the pipeline (who, when, which digest, which change ticket) by someone other than the author; production deploy performed by the pipeline identity, never by a person\'s kubeconfig. Each gate writes evidence keyed by the digest, so the audit question becomes a lookup: Pod → image digest → build run → commit → scan → tests → approval.\n\nConfiguration differences live in per-environment values files reviewed like code; secrets are references (an external secret name or a platform-injected file), never values, and never appear in rendered manifests in CI logs. Rollback is a Helm rollback or a GitOps revert to the previous digest — which only works if the previous release can run against the current schema. So schema changes follow expand → migrate → contract across at least two releases: add columns/tables in release N (old code ignores them), switch reads/writes in N+1, drop the old shape only in N+2 after N is no longer a rollback target. The pipeline can enforce this with a migration check that refuses destructive DDL in the same release that starts using the new shape. What this design does not solve: a bad release that passes every gate (that is what progressive rollout and user-impact alerting are for) and a compromised pipeline identity (that is what short-lived credentials, signed artifacts and separate approval are for).',
    sourceIds: ['T13', 'T01']
  });

  LX.sreDesigns.push({
    id: 'D03', moduleId: 'M12', timeboxMins: 45, paired: ['L23', 'L24'],
    title: 'Ingest bursty sensor updates at ten times normal arrival',
    brief: 'Beacon normally receives 200 status updates per second from sensors. During a regional event, arrivals jump to 2 000/s for up to 20 minutes, mostly duplicates and retries from sensors that did not see an acknowledgement. The database can sustain about 600 writes/s. Today the API writes synchronously, latency climbs, sensors time out and retry, and the database falls over.\n\nDesign ingestion that stays correct and available through the burst: accept what you can, apply backpressure honestly, handle duplicates, and say what "eventually" means for readers.',
    mustAddress: [
      'Capacity estimate with units: arrival rate, service rate, queue growth per minute during the burst, and drain time afterwards',
      'Queue depth AND age as the signals, with the thresholds that trigger backpressure or shedding',
      'Ordering scope: per sensor, per region or none — and what breaks if you promise more than you need',
      'Duplicate handling with an idempotency key and where the deduplication state lives (and for how long)',
      'Durability and consistency: when is an update acknowledged, what can be lost, and how stale can a reader be'
    ],
    worksheet: sheet({
      estimates: 'Arrival 2 000/s versus service 600/s ⇒ queue grows by ? per second and ? per minute; after 20 minutes the backlog is ?; draining at (600 − 200)/s takes ? minutes. How much of the 2 000/s is duplicates?',
      flow: 'Sensor → API (validate, assign idempotency key, enqueue, acknowledge) → durable queue → workers (batch, upsert by key) → database. Where does the acknowledgement happen and what does it promise?',
      choices: 'Synchronous write vs queue; acknowledge-on-enqueue vs on-commit; partition by sensor id vs single queue; drop vs 429-with-Retry-After vs degrade (latest-value-wins).',
      observability: 'Queue depth, oldest message age, enqueue/dequeue rate, duplicate ratio, 429 rate, end-to-end freshness (now − last applied update per sensor).'
    }),
    rubric: RUBRIC([{ id: 'units', label: 'Arithmetic with units drives the thresholds' }]),
    reference: 'Arithmetic first: at 2 000/s arriving and 600/s applied, the backlog grows by 1 400/s = 84 000 per minute; after 20 minutes that is 1.68 million messages. If each is ~1 KB, the queue holds ~1.7 GB — fine for a durable log or queue, fatal for an in-memory buffer. After the burst, arrivals return to 200/s, so the drain rate is 600 − 200 = 400/s and 1.68 M takes 4 200 s ≈ 70 minutes. That number is the real freshness promise during an event, and it is too long unless you shrink the work.\n\nShrink it with **idempotency** and **coalescing**. Sensors include a client-generated `(sensor_id, sequence)` key; the API rejects malformed input, enqueues, and acknowledges once the queue has durably accepted the message (acknowledge-on-enqueue: low latency, the write is safe but not yet visible). Workers upsert by key, so a retried message is a no-op, and because the business only needs the latest status per sensor, a worker batch can keep only the newest sequence per sensor before writing — most of a retry storm collapses to one row per sensor. With 50 000 sensors, the true unique work in 20 minutes is far smaller than 2.4 M messages.\n\nOrdering: promise order **per sensor** only (partition the queue by sensor id); global order is expensive and unnecessary. Backpressure is driven by **oldest-message age**, not just depth: when age exceeds, say, 120 s, the API returns 429 with `Retry-After` and jitter to new sensors (sensors honour it), and the dashboard shows "data may be up to N minutes old" instead of pretending. Durability: the queue is replicated; deduplication state (last applied sequence per sensor) lives in the database row itself, so it survives worker restarts. Readers get eventual consistency with a stated bound: freshness = now − last applied timestamp per sensor, alerted at the p95 across sensors. Open risk: if sensors do not honour Retry-After, admission control at the edge (rate limits per sensor) is the next defence; test it with a replayed burst, not a hope.',
    sourceIds: ['T01', 'T09']
  });

  LX.sreDesigns.push({
    id: 'D04', moduleId: 'M12', timeboxMins: 40, paired: ['L24'],
    title: 'Recovery strategy for a stateful API: RPO 15 minutes, RTO 60 minutes',
    brief: 'Beacon\'s PostgreSQL holds 300 GB and grows 4 GB/day. The business has signed off on losing at most **15 minutes** of committed updates (RPO) and being back within **60 minutes** (RTO) after the decision to recover. Today there is a nightly `pg_dump` to object storage that nobody has restored, and a streaming replica in another AZ.\n\nChoose the backup and replication strategy, define who may declare failover or restore, and show how you would prove — not assume — that the targets are met. Label clearly what the local lab (L24) can and cannot demonstrate.',
    mustAddress: [
      'Backup cadence and type (base backups + WAL archiving / PITR versus logical dumps) and how each maps to RPO',
      'Restore proof: a scheduled, timed restore into a fresh environment with count AND content checks',
      'Replication versus backup: what a replica protects against and what it faithfully copies (corruption, bad migrations, deletes)',
      'Failover authority and procedure: who decides, with what evidence, and how split-brain is avoided',
      'Loss accounting: how you measure what was lost and tell users, and whether the lab actually meets the target'
    ],
    worksheet: sheet({
      estimates: '300 GB at your measured restore throughput (MB/s) = ? minutes; plus WAL replay for up to 24 h of changes at 4 GB/day; plus DNS/connection-string switch and verification. Does it fit in 60 minutes?',
      recovery: 'Scenarios: replica promotion after primary loss; PITR to 10:41 after a bad DELETE at 10:42; full restore after region loss. For each: steps, owner, time, data lost.',
      observability: 'Backup age, WAL archive lag, last successful restore test and its duration, replica lag in seconds and bytes.'
    }),
    rubric: RUBRIC([{ id: 'proof', label: 'A measured restore, not an assumed one' }]),
    reference: 'A nightly dump gives an RPO of up to 24 hours and an untested RTO, so it does not meet the target at all. Continuous WAL archiving to object storage (archive_timeout of a few minutes) plus a weekly base backup gives point-in-time recovery with an RPO of minutes — the real RPO is the WAL archive lag, which must be monitored and alerted well under 15 minutes. The streaming replica gives a fast RTO for **primary loss** (promotion in minutes, loss bounded by replication lag) but it replicates a bad `DELETE` or migration in milliseconds, so it is not a backup. Keep both, and keep the dump only as an extra logical copy for single-table restores.\n\nRTO is arithmetic plus rehearsal: if a restore from the base backup proceeds at 150 MB/s, 300 GB is ~34 minutes before WAL replay; replaying up to a week of WAL at 4 GB/day could take longer than the remaining budget, which argues for daily base backups or for restoring from a snapshot-capable volume. The only proof is a **timed restore** into a fresh instance on a schedule, with verification that compares row counts per table AND checksums or sampled values against the source at the recovery point, recorded with its duration.\n\nAuthority: failover/restore is declared by the incident commander with the database owner, using written criteria (primary unreachable for N minutes from two vantage points; replica lag known), and the old primary is fenced (stopped, or its endpoint removed) before promotion to avoid two writers. After recovery, loss accounting compares the last applied transaction time with the incident start and lists affected records from application logs or the queue for replay. The local lab demonstrates the mechanism (dump/restore, PITR on a small dataset, count-and-checksum verification, measured interval) but **not** the 300 GB timing or cross-AZ behaviour; the design must say that the target is unproven until a production-sized drill is timed.',
    sourceIds: ['T09', 'T08']
  });

  LX.sreDesigns.push({
    id: 'D05', moduleId: 'M13', timeboxMins: 45, paired: ['L25', 'L26'],
    title: 'Monthly patches to an environment without outbound artifact access',
    brief: 'A customer runs Beacon in an environment with no outbound access to registries or package mirrors. Each month you must deliver patched images, the Helm chart, configuration and evidence that the delivery is complete, untampered and from you. Transfers happen through a controlled handoff (signed media or a one-way transfer service) operated by the customer. This is a **training abstraction** of disconnected delivery, not a description of any real program or an accreditation claim.\n\nDesign the bundle, the trust bootstrap, the verification on the receiving side, and how a bad patch is revoked or rolled back.',
    mustAddress: [
      'A complete dependency inventory: every image (including init/sidecar/transitive ones), chart and its dependencies, config, CRDs, and their digests',
      'Trusted signing keys: how the receiver gets your public key the first time, how keys rotate, and what happens if one is compromised',
      'Scan and provenance evidence (SBOM, vulnerability report, build provenance) bound to the exact digests delivered',
      'The transfer handoff and verification steps on both sides, including what is rejected and who is told',
      'Revocation and rollback: how a recalled patch is identified and the previous bundle restored without outbound access'
    ],
    worksheet: sheet({
      estimates: 'Bundle size per month (images × compressed size), transfer window, verification time; how many previous bundles the receiver keeps for rollback.',
      flow: 'Build → sign → bundle (images as OCI archives, chart, manifest with digests and checksums, SBOMs, scan results, signature) → handoff → receiver verifies signature with a pre-trusted key → verifies every checksum → loads into the internal registry → deploys by digest.',
      boundaries: 'Mark where custody changes hands and what each party can tamper with. What does the receiver trust, and why?',
      risks: 'Missing transitive image discovered mid-install; expired or rotated key; scanner database itself out of date on the receiving side.'
    }),
    rubric: RUBRIC([{ id: 'trust', label: 'Trust bootstrap and key rotation are explicit' }]),
    reference: 'Start from a manifest, not a folder. The bundle\'s `manifest.json` lists every artifact by digest: application images, init and sidecar images, chart dependencies\' images, CRDs, the chart tarball and the values schema, generated by rendering the chart with production values and extracting every `image:` — that render-and-extract step is how the transitive image that broke last month\'s install gets caught before transfer. Each entry carries a SHA-256 checksum; the manifest itself is signed with a release key.\n\nTrust bootstrap: the receiver must obtain the public key out of band once (delivered in person or on separately controlled media, its fingerprint confirmed by phone or in a signed contract annex) and pins it. Rotation is announced in a bundle signed by the **current** key that introduces the next key, with an overlap period; compromise uses a pre-agreed revocation list or out-of-band notice, because a disconnected receiver cannot query a transparency log. Verification on receipt is mechanical and fails closed: signature against the pinned key, every checksum, every image present, SBOM and scan report digests matching the image digests; any mismatch rejects the entire bundle and is reported back through the handoff channel.\n\nThe receiving side loads images into its internal registry and deploys by digest, so nothing ever attempts an external pull (an admission rule rejecting non-internal registries proves it). Scan evidence is generated at build time and travels with the bundle; the receiver may rescan with its own (possibly older) vulnerability database and should record both. Rollback keeps the previous N bundles in the internal registry; a recall is a signed notice naming the bad bundle digest, and rolling back is a Helm rollback to the previous chart and digests — which again depends on schema compatibility. Evidence ownership: who produced each artifact, who verified, who approved the install, kept as a signed record per bundle. This is a training model; real programmes add their own controls and paperwork, and nothing here implies a compliance outcome.',
    sourceIds: ['T21', 'T13', 'T10']
  });

  LX.sreDesigns.push({
    id: 'D06', moduleId: 'M14', timeboxMins: 40, paired: ['L27', 'L28'],
    title: 'Keep Beacon usable through dependency overload and an AZ failure',
    brief: 'Beacon\'s API calls PostgreSQL and an enrichment service owned by another team. Twice this quarter the enrichment service slowed to 5-second responses; Beacon\'s request threads filled, retries tripled the load on enrichment, and the whole API went down — including the status writes that do not need enrichment. Separately, an AZ failure removed a third of capacity at peak.\n\nDesign Beacon so that it degrades gracefully: core writes keep working, optional features fail fast, retries cannot amplify an outage, and losing an AZ at peak is survivable. Say how users and stakeholders are told.',
    mustAddress: [
      'Timeouts and retry budgets per dependency (with jitter), and why retries must be bounded at one layer only',
      'Load shedding and prioritisation: which requests are protected and which are rejected first, and the signal that triggers it',
      'Graceful degradation: what Beacon returns when enrichment is down (and how the client knows)',
      'Capacity headroom: how much spare capacity survives losing an AZ at peak, and the cost of it',
      'User-impact monitoring and the communication plan during the degradation'
    ],
    worksheet: sheet({
      estimates: 'Peak 600 req/s; each API instance handles 50 concurrent requests; at 5 s enrichment latency, Little\'s law says concurrency = rate × latency = ? — compare with your pool. With three AZs and one lost, what fraction of capacity remains?',
      flow: 'Status write path (database only) versus enriched read path (database + enrichment). Where do they share threads, pools or queues today?',
      choices: 'Separate pools (bulkheads) vs one pool; client retries vs server retries; circuit breaker vs plain timeout; static headroom vs autoscaling.',
      observability: 'Per-dependency latency and error rate, pool saturation, shed-request rate, user success rate per endpoint, AZ capacity.'
    }),
    rubric: RUBRIC([{ id: 'amplification', label: 'Shows why the original design amplified the outage' }]),
    reference: 'Little\'s law explains the outage: 600 req/s × 5 s = 3 000 requests in flight, against perhaps 6 instances × 50 = 300 slots. Every slot filled with requests waiting on enrichment, so status writes — which never call enrichment — queued behind them. Then each layer retried (client, API, HTTP library), so enrichment saw up to three times the traffic exactly when it was slowest.\n\nFixes, in order of leverage. **Bulkheads**: separate concurrency limits for the enrichment path (e.g. 20 per instance) so it can never consume the write path\'s capacity. **Timeouts below the user\'s patience**: enrichment gets a 300 ms timeout derived from its normal p99, not a library default of 30 s. **One retry layer with a budget**: only the API retries enrichment, at most once, with jittered backoff, and only while retries are under ~10% of calls (a retry budget); clients get 503/429 with `Retry-After` instead of silent retries. **Circuit breaker**: after a burst of failures, stop calling enrichment for a short window and serve **degraded** responses — the record without enrichment fields plus a header or field saying `enrichment: unavailable` — so callers can tell. **Load shedding** keyed on queue time or in-flight count: reject the lowest-priority requests (bulk exports, enriched reads) first with 503, protect status writes.\n\nAZ loss: with three AZs sized so that two carry peak (each AZ ≈ 50% of peak, 150% total), losing one AZ leaves 100%; with two AZs each must carry 100% (200% total). That headroom is the price of the requirement; autoscaling helps for slow growth but is too slow for an instant AZ loss. Monitoring: user success rate and latency per endpoint class (writes, enriched reads), shed rate, breaker state, per-dependency latency — alert on user impact, not on enrichment\'s CPU. Communication: a status-page line ("enrichment delayed; status updates unaffected") within minutes, updated on a fixed cadence. Open risk: degraded mode must be exercised regularly, or it will fail the first time it is needed.',
    sourceIds: ['T01', 'T08']
  });
})();
