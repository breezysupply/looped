/* Onsite track — system-design workshop. Requirements before tools. */
window.LX = window.LX || {};
LX.onsiteDesign = LX.onsiteDesign || [];

/* ------------------------------------------------------------------ */
/* 1. Trusted artifact delivery                                        */
/* ------------------------------------------------------------------ */
LX.onsiteDesign.push({
  id: 'ons-design-artifacts', track: 'onsite', priority: 'P2', mins: 45,
  title: 'Trusted artifact delivery to cloud, government and disconnected edge sites',
  brief: 'We build container images, deployment manifests or charts, and configuration in one place. They need to run in a commercial cloud environment, in government environments with stricter controls, and on appliances at edge sites that are often or always disconnected. Today releases are copied by hand and nobody can say for certain what is running where. Design how artifacts get to all three kinds of site, and how each site knows they are the ones we built.',
  clarify: [
    { q: 'How disconnected is "disconnected": never connected, connected in windows, or reachable only through a controlled one-way transfer?',
      why: 'Decides whether a site can fetch anything on demand (a missing layer, a revocation list) or whether every bundle must be self-contained, and how key changes reach the site.' },
    { q: 'Who moves data across each boundary, and what does the transfer process inspect, restrict or require?',
      why: 'Controlled transfers often limit file types, sizes and formats and add human review. The bundle format has to fit the process, and the process adds latency you must plan around.' },
    { q: 'What is the release cadence, and how quickly must a security fix reach each environment?',
      why: 'Changes whether you ship full or incremental bundles, and how fast revocation and emergency patches must travel.' },
    { q: 'Which CPU architectures run where?',
      why: 'Mixed amd64 and arm64 means multi-architecture image indexes, and a decision about shipping every platform or only the ones a site needs.' },
    { q: 'What must be provable, and to whom: integrity, publisher identity, how it was built, what it contains?',
      why: 'Each maps to a different artifact (digest, signature, provenance attestation, dependency inventory) and a different verification step.' },
    { q: 'How much storage and bandwidth does an edge appliance have?',
      why: 'Limits bundle size, how many previous releases you can keep for rollback, and whether a local registry mirror fits on the device.' },
    { q: 'Does each site run its own cluster and registry, or do appliances share a site-level mirror?',
      why: 'Changes where import and verification happen and how many copies of the trust roots you must manage.' },
    { q: 'Do commercial and government environments need different signing authorities or policies?',
      why: 'May require separate keys and trust roots per environment class, so an artifact approved for one is not accepted by the other.' },
    { q: 'How do sites roll back today, and how far back must they be able to go?',
      why: 'Sets how many previous bundles stay on site and whether admission policy must keep accepting older signed versions.' }
  ],
  assumptions: [
    'Three environment classes: commercial cloud (connected), government (connected through a controlled boundary with review), and edge appliances (disconnected for weeks, updated by removable media or a one-way transfer).',
    'Each site runs a small Kubernetes cluster and can host a local OCI registry mirror.',
    'Edge hardware is a mix of amd64 and arm64; cloud is amd64 only.',
    'Releases ship about every two weeks. Critical fixes must reach connected sites within a day and disconnected sites at the next transfer window.',
    'Auditors want to know, for any site, exactly which artifacts (by digest) are running, where they came from, and what they contain.',
    'A release contains images, manifests or charts, configuration, signatures, provenance and dependency inventories.'
  ],
  constraints: [
    'Nothing runs at a site unless it verifies against a trust root the site already holds.',
    'Disconnected sites cannot reach any online service during verification or at run time.',
    'Signing private keys never leave the build side; sites hold only public verification material.',
    'A bundle that fails verification or is incomplete must not be partially imported.',
    'Every import, rejection and admission decision is recorded locally and exportable for audit.'
  ],
  architecture: {
    summary: 'Separate three flows. Artifacts are large and go through the transfer process. Trust material (public keys or verification identities, validity windows, revocation lists) is small and goes through a separate, more tightly controlled channel, because a bundle must never be able to vouch for itself. Evidence (audit records, running inventory) flows back. On the build side, a build from pinned inputs produces images referenced by digest, a provenance record and a dependency inventory, and a signing service signs the digests. A bundler resolves the release to a closed set of digests for every required platform and writes a bundle with a signed top-level manifest. At the receiving site, an importer verifies the manifest signature, every digest and completeness against the manifest before anything reaches the local mirror, and admission policy in each cluster verifies signatures again at deploy time so the mirror is not the only gate.',
    components: [
      { name: 'Build pipeline', resp: 'Builds from pinned sources and dependencies, records provenance (source revision, builder identity, inputs), produces multi-architecture images and an index, and outputs everything by digest.' },
      { name: 'Signing service', resp: 'Holds signing keys in hardware-backed storage, signs image digests, bundle manifests and attestations, and logs every signature it makes.' },
      { name: 'Bundler', resp: 'Resolves a release to a closed set of digests (all required platforms, charts, config, signatures, dependency inventories) and writes a self-describing bundle with a signed manifest and per-file digests.' },
      { name: 'Trust-root channel', resp: 'Separate, low-volume, reviewed path that delivers public verification material, validity windows and revocation lists to sites.' },
      { name: 'Controlled transfer', resp: 'Moves bundles across each boundary. It may scan, size-limit or require review, but it does not add trust on its own.' },
      { name: 'Receiving importer', resp: 'Stages the bundle in quarantine, verifies signature, digests, completeness and policy (allowed signer, environment class), then publishes to the mirror all-or-nothing.' },
      { name: 'Local mirror', resp: 'An OCI registry at the site holding only verified content addressed by digest; nodes pull images from here.' },
      { name: 'Admission policy', resp: 'An admission controller that verifies image signatures against the site trust roots at deploy time and rejects unsigned images or references without a digest.' },
      { name: 'Audit and inventory', resp: 'Append-only local record of imports, rejections and admission decisions, plus a per-site running inventory, exported at the next transfer.' }
    ],
    diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 340" role="img" aria-label="Artifact delivery flow. On the connected build side: pinned source, build with provenance, sign digests and produce a dependency inventory, then bundle with a signed manifest. The bundle crosses a controlled transfer while trust roots and revocation lists travel through a separate channel. At the disconnected site the importer verifies before import, loads a local mirror by digest, admission verifies again, and the kubelet pulls from the mirror. Every step writes to an audit log." font-family="inherit" font-size="11">' +
      '<defs><marker id="oda-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--muted)"/></marker></defs>' +
      '<text x="16" y="18" style="fill:var(--muted)">CONNECTED BUILD SIDE</text>' +
      '<rect x="16" y="28" width="100" height="48" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="66" y="48" text-anchor="middle" style="fill:var(--text)">Pinned source</text><text x="66" y="63" text-anchor="middle" style="fill:var(--text)">+ dependencies</text>' +
      '<rect x="132" y="28" width="100" height="48" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="182" y="48" text-anchor="middle" style="fill:var(--text)">Build</text><text x="182" y="63" text-anchor="middle" style="fill:var(--text)">+ provenance</text>' +
      '<rect x="248" y="28" width="100" height="48" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="298" y="48" text-anchor="middle" style="fill:var(--text)">Sign digests</text><text x="298" y="63" text-anchor="middle" style="fill:var(--text)">+ SBOM</text>' +
      '<rect x="364" y="28" width="100" height="48" rx="6" style="fill:var(--bg-elev);stroke:var(--accent)"/>' +
      '<text x="414" y="48" text-anchor="middle" style="fill:var(--text)">Bundle +</text><text x="414" y="63" text-anchor="middle" style="fill:var(--text)">signed manifest</text>' +
      '<line x1="116" y1="52" x2="130" y2="52" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#oda-ah)"/>' +
      '<line x1="232" y1="52" x2="246" y2="52" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#oda-ah)"/>' +
      '<line x1="348" y1="52" x2="362" y2="52" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#oda-ah)"/>' +
      '<rect x="16" y="106" width="150" height="54" rx="6" stroke-dasharray="5 4" style="fill:var(--bg-elev);stroke:var(--amber)"/>' +
      '<text x="91" y="124" text-anchor="middle" style="fill:var(--text)">Trust roots +</text><text x="91" y="138" text-anchor="middle" style="fill:var(--text)">revocation list</text><text x="91" y="152" text-anchor="middle" style="fill:var(--muted)">(separate channel)</text>' +
      '<rect x="182" y="106" width="282" height="54" rx="6" style="fill:var(--bg-elev);stroke:var(--accent)"/>' +
      '<text x="323" y="128" text-anchor="middle" style="fill:var(--text)">Controlled transfer</text><text x="323" y="144" text-anchor="middle" style="fill:var(--muted)">(media or one-way link)</text>' +
      '<polyline points="280,76 280,90 91,90 91,104" stroke-width="1.5" stroke-dasharray="5 4" style="fill:none;stroke:var(--amber)" marker-end="url(#oda-ah)"/>' +
      '<line x1="414" y1="76" x2="414" y2="104" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#oda-ah)"/>' +
      '<text x="464" y="196" text-anchor="end" style="fill:var(--muted)">DISCONNECTED SITE</text>' +
      '<polyline points="323,160 323,178 76,178 76,202" stroke-width="1.5" style="fill:none;stroke:var(--muted)" marker-end="url(#oda-ah)"/>' +
      '<line x1="40" y1="160" x2="40" y2="202" stroke-width="1.5" stroke-dasharray="5 4" style="stroke:var(--amber)" marker-end="url(#oda-ah)"/>' +
      '<rect x="16" y="204" width="100" height="48" rx="6" style="fill:var(--bg-elev);stroke:var(--accent)"/>' +
      '<text x="66" y="224" text-anchor="middle" style="fill:var(--text)">Verify before</text><text x="66" y="239" text-anchor="middle" style="fill:var(--text)">import (atomic)</text>' +
      '<rect x="132" y="204" width="100" height="48" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="182" y="224" text-anchor="middle" style="fill:var(--text)">Local mirror</text><text x="182" y="239" text-anchor="middle" style="fill:var(--text)">(by digest)</text>' +
      '<rect x="248" y="204" width="100" height="48" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="298" y="224" text-anchor="middle" style="fill:var(--text)">Admission</text><text x="298" y="239" text-anchor="middle" style="fill:var(--text)">verifies again</text>' +
      '<rect x="364" y="204" width="100" height="48" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="414" y="224" text-anchor="middle" style="fill:var(--text)">kubelet pulls</text><text x="414" y="239" text-anchor="middle" style="fill:var(--text)">from mirror</text>' +
      '<line x1="116" y1="228" x2="130" y2="228" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#oda-ah)"/>' +
      '<line x1="232" y1="228" x2="246" y2="228" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#oda-ah)"/>' +
      '<line x1="348" y1="228" x2="362" y2="228" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#oda-ah)"/>' +
      '<line x1="66" y1="252" x2="66" y2="278" stroke-dasharray="3 3" style="stroke:var(--line)"/>' +
      '<line x1="182" y1="252" x2="182" y2="278" stroke-dasharray="3 3" style="stroke:var(--line)"/>' +
      '<line x1="298" y1="252" x2="298" y2="278" stroke-dasharray="3 3" style="stroke:var(--line)"/>' +
      '<rect x="16" y="278" width="448" height="30" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="240" y="297" text-anchor="middle" style="fill:var(--text)">Audit: imports, rejections, admissions, running inventory</text>' +
      '<line x1="16" y1="326" x2="40" y2="326" stroke-width="1.5" style="stroke:var(--muted)"/><text x="46" y="330" style="fill:var(--muted)">artifacts</text>' +
      '<line x1="130" y1="326" x2="154" y2="326" stroke-width="1.5" stroke-dasharray="5 4" style="stroke:var(--amber)"/><text x="160" y="330" style="fill:var(--muted)">trust material</text>' +
      '</svg>',
    caption: 'Artifacts and trust roots travel through different channels. The site verifies the whole bundle before import, and admission policy verifies signatures again before anything runs.'
  },
  approaches: [
    { name: 'Signed full bundle per release',
      how: 'Every release is a complete, self-contained bundle: all images for the required platforms, manifests or charts, configuration, signatures, provenance and dependency inventories, with one signed manifest over all of it.',
      pros: ['One bundle equals one release, which is easy to reason about and audit', 'Import does not depend on what the site already has', 'Completeness can be verified in isolation'],
      cons: ['Large, and slow through a constrained transfer', 'Repeats unchanged layers every release'],
      when: 'Sites with enough transfer capacity, or where operational simplicity and audit clarity matter more than size. A sensible default and a required fallback for the other approaches.' },
    { name: 'Incremental bundle against a declared baseline',
      how: 'The bundle holds only blobs the site does not already have. Its signed manifest names the baseline release it requires, and the importer checks that baseline is present before accepting it.',
      pros: ['Much smaller transfers', 'Faster emergency patches'],
      cons: ['Depends on an accurate record of what each site holds; drift makes bundles unusable', 'Completeness is verified against baseline plus delta, which is more logic to get right'],
      when: 'Bandwidth- or size-constrained transfers with reliable inventory reporting from sites. Always keep the full bundle as the fallback.' },
    { name: 'Pull-through mirror for connected sites, bundles only for the disconnected tail',
      how: 'Connected environments pull through a restricted mirror or pull-through cache from the build-side registry; only disconnected sites receive bundles.',
      pros: ['Less bundle machinery for most of the fleet', 'Faster delivery where links exist'],
      cons: ['Two delivery paths to test, secure and audit', 'A pull-through cache can fetch anything upstream unless restricted'],
      when: 'When most of the fleet is connected. Admission policy and trust roots must be identical on both paths so the security model does not depend on which path was used.' }
  ],
  failureModes: [
    { mode: 'Bundle is incomplete: a missing layer, a missing platform in a multi-arch index, or a chart that references an image not in the bundle.',
      detect: 'The importer resolves every reference in the signed manifest, including every platform the site profile requires, and every image referenced by bundled manifests or charts.',
      mitigate: 'Reject the whole bundle, import nothing, keep the current release running, and record exactly which digests are missing. The build side fixes the bundler and adds the same completeness check before a bundle is released.' },
    { mode: 'Signing key compromised or suspected compromised.',
      detect: 'Signing log shows a signature that does not match any release, or the key custodian reports a problem.',
      mitigate: 'Issue a new trust root and a revocation list through the trust channel, re-sign still-valid releases with the new key, and state the risk window for offline sites that cannot receive the revocation until their next transfer.' },
    { mode: 'Trust root expires or is rotated before a disconnected site receives the new one.',
      detect: 'Import fails with an expired or unknown-key error. A site-side check warns well before any trust root expires.',
      mitigate: 'Overlap: distribute and trust the new key before retiring the old one, and sign with both during the overlap. Size the overlap to the longest expected disconnection.' },
    { mode: 'Manifests reference mutable tags, so what runs depends on what the mirror happens to hold.',
      detect: 'Admission policy rejects image references without a digest; the bundler lints manifests.',
      mitigate: 'Resolve tags to digests at bundle time and deploy by digest only.' },
    { mode: 'Media corrupted or truncated in transfer.',
      detect: 'Digest verification fails for one or more files.',
      mitigate: 'Reject and request a re-transfer. The digest detected corruption; it does not say who published the file, which is the signature\'s job.' },
    { mode: 'Local mirror runs out of space mid-import.',
      detect: 'Import preflight compares free space with bundle size; disk alerts on the mirror.',
      mitigate: 'Preflight refuses the import instead of half-writing it. Garbage-collect unreferenced digests while keeping the previous release for rollback.' },
    { mode: 'Clock at the edge is wrong.',
      detect: 'Verification fails on validity windows, or accepts material that should have expired. Import preflight checks clock offset.',
      mitigate: 'Provide a local time source and decide explicitly how validity times are evaluated offline.' }
  ],
  identity: [
    'Signing private keys stay in a hardware-backed signing service on the build side; the pipeline can request signatures but cannot export keys.',
    'Trust roots reach sites through a separate, reviewed channel. A bundle can never introduce or change the trust root it is verified against.',
    'Use separate signing identities per environment class if policy requires it, so an artifact signed for commercial is not accepted at a government site.',
    'Rotation uses overlap (trust new, sign with both, retire old). Revocation lists travel with trust roots and are honoured at import and at admission.',
    'At the site, only the importer can write to the mirror; clusters get read-only pull credentials.',
    'Signing schemes that rely on an online transparency log or identity provider may not verify offline as-is; confirm exactly what offline verification needs before choosing one.'
  ],
  observability: [
    'Per-site inventory: current release, running digests, when each was imported and which key verified it.',
    'Import outcomes as metrics and events: accepted, rejected with reason, duration, bundle size.',
    'Admission denials by reason (unsigned, unknown signer, no digest), with an alert on any spike after a release.',
    'Trust-root expiry countdown at every site, alerting well before the longest disconnection window.',
    'Build side: signing log reconciled against releases; any signature that belongs to no release pages someone.'
  ],
  deploy: [
    'Import and deploy are separate steps. Importing makes a release available; promoting it to running is a separate, reviewed change.',
    'Stage rollouts: a lab appliance, then one canary site per environment class, then the rest.',
    'Keep the previous release in the local mirror so rollback never waits for a new transfer.',
    'Rollback means redeploying the previous signed digests, so admission policy must still accept them unless they were revoked for cause.',
    'A successful rollout proves pods became Ready by their probes, not that the release is correct; run functional checks after deploy.'
  ],
  recovery: [
    'Imports are atomic: stage in quarantine, verify, then publish. A failed import leaves the mirror unchanged.',
    'Digest addressing makes stored content checkable; a periodic scrub re-hashes blobs in the mirror.',
    'Keep the last complete bundle on storage separate from the mirror so a lost mirror can be rebuilt without a new transfer.',
    'Audit records are append-only and queued for export; a long disconnection must not lose them.',
    'Decide in advance what revoking an artifact that is already running means: block only new pods at admission, or actively replace running ones.'
  ],
  ownership: [
    'Release engineering owns the pipeline, bundler, signing service and signing log. Key custodians are named people with a documented ceremony.',
    'Security owns trust-root content; site operators own applying it. Trust-root changes need two people.',
    'Site operators own import and the mirror, with a runbook for rejected bundles that says what to capture and who to contact.',
    'Rejected-bundle handoff: the site sends the importer report; release engineering owns the root cause and a reissued bundle.',
    'Connected environments have normal on-call. Disconnected sites have a documented escalation path that works through the next transfer window.'
  ],
  reveals: [
    { after: 'after the candidate proposes signing images and checking hashes',
      constraint: 'Edge sites can be offline for up to 90 days, and one signing key has just been reported as possibly exposed.',
      guidance: 'Separates integrity (digest) from authenticity (signature checked against a separately distributed trust root). Rotates with overlap, ships a revocation list through the trust channel, re-signs releases that are still valid, and states plainly that offline sites stay exposed until their next transfer.' },
    { after: 'after the candidate designs the bundle format',
      constraint: 'A bundle arrives at an edge site and the importer reports that one chart references an image digest that is not in the bundle.',
      guidance: 'Rejects the whole bundle, keeps the current release running, captures the importer report, and fixes the cause on the build side with a completeness check that resolves every reference, including every required platform. Does not suggest fetching the missing image from anywhere at the site.' },
    { after: 'after the candidate treats the local mirror as the only gate',
      constraint: 'An operator with admin access pushed an image straight into a site mirror to fix an urgent problem.',
      guidance: 'Adds admission-time signature verification, restricts mirror writes to the importer, alerts on unexpected writes, and defines an audited break-glass path instead of pretending no one will ever need one.' },
    { after: 'after the design is broadly complete',
      constraint: 'Auditors now want, for any past date, what was running at a government site and its dependency inventory; and the transfer process caps each transfer below the size of a full release.',
      guidance: 'Keeps per-site inventory and admission logs tied to digests, links running digests to their dependency inventory and provenance, and moves to split or incremental bundles under one signed index that is still verified as a complete set before import.' }
  ],
  rubric: {
    strong: [
      'Asks about connectivity, transfer controls, cadence, architectures and audit needs before naming any tool.',
      'Separates digest (integrity), signature (authenticity against a separately distributed trust root) and provenance (how it was built).',
      'Verifies before import, makes import atomic, and verifies again at admission.',
      'Handles key rotation and revocation for offline sites with overlap and an explicit risk window.',
      'Defines what happens to an incomplete bundle and how the build side prevents a repeat.'
    ],
    acceptable: [
      'Full bundles only, arguing that simplicity and auditability outweigh transfer size.',
      'Pull-through mirrors for connected sites plus bundles for disconnected ones, with identical admission policy and trust roots.',
      'A different signing approach (for example key-based or identity-based), as long as offline verification is addressed.'
    ],
    redFlags: [
      'Names specific products before establishing requirements.',
      'Treats a SHA-256 checksum shipped in the same bundle as proof of who published it.',
      'Ships trust roots inside the bundle they are supposed to verify.',
      'Allows partial import, or fetching missing pieces from outside at a disconnected site.',
      'Deploys by mutable tag.'
    ]
  },
  example: 'This is one strong way to work the problem, not the only correct design. Different answers can score well if the requirements are established first and the tradeoffs are stated honestly.\n\n' +
    'I would start by not drawing anything. "Disconnected" hides several different problems, so I would ask how each environment class is connected: always, in windows, or only through a controlled transfer. Then who runs that transfer and what it restricts, because a process that only accepts certain file types or sizes decides my bundle format. I would ask about release cadence and how fast a security fix must land, which architectures run where, and what auditors need to see. Suppose the answers are: cloud is connected, government is connected through a reviewed boundary, edge appliances are offline for weeks and receive removable media, edge is mixed amd64 and arm64, and auditors want to know exactly what is running at each site and what it contains.\n\n' +
    'Next I would settle the trust model, because it shapes everything else. There are three different claims. A digest proves the bytes are the ones a digest refers to, which is only useful if you already trust that digest value from somewhere. A signature proves a holder of a particular key approved those bytes, which is only meaningful if the site already trusts that key through some other path. Provenance and a dependency inventory say how the artifact was built and what is inside it. So I would make trust roots a separate, low-volume, reviewed channel, and I would say out loud that a bundle cannot carry its own trust root.\n\n' +
    'Then the design. The build runs from pinned inputs and emits images by digest, including a multi-architecture index, plus provenance and a dependency inventory. A signing service with hardware-backed keys signs the digests and attestations and logs every signature. The bundler takes the release definition and resolves it to a closed set of digests: every image for every platform the target site profile requires, every chart, every config file, and the signatures and inventories. It writes a manifest listing all of it and signs that manifest. That bundle goes through the transfer.\n\n' +
    'At the site, the importer stages the bundle in quarantine. It verifies the manifest signature against the trust roots the site already holds, verifies the digest of every file, and checks completeness: every image referenced by any bundled manifest or chart must be present, for every required platform. Only then does it publish to the local mirror, all-or-nothing. Separately, an admission controller in each cluster verifies image signatures again at deploy time and rejects anything referenced by tag rather than digest. That second check matters because the mirror is not the only way something could get onto a node, and because someone with admin access could write to the mirror directly.\n\n' +
    'On tradeoffs, I would default to full bundles because they are easy to verify in isolation, and offer incremental bundles against a declared baseline if transfer size becomes the bottleneck, keeping the full bundle as the fallback. For connected environments a restricted pull-through mirror is reasonable, as long as admission policy and trust roots are the same everywhere.\n\n' +
    'Failure handling: an incomplete bundle is rejected entirely, the running release stays, and the importer report goes back to release engineering, who fix the bundler and add the same completeness check before release. A corrupted file fails its digest. A suspected key compromise means a new trust root and revocation list through the trust channel, re-signing still-valid releases, and being honest that a site offline for 90 days stays exposed until its next transfer. For routine rotation I would overlap keys by longer than the longest disconnection so no site is ever stranded, and I would monitor trust-root expiry at every site. I would also check clocks, because validity windows are evaluated against local time.\n\n' +
    'Verification and operations: every import, rejection and admission decision lands in a local append-only log that is exported at the next transfer, and each site keeps an inventory of running digests tied back to provenance and dependency inventories, which answers the audit question. Import is not deploy; promotion is a separate reviewed change, staged from a lab appliance to one canary per environment class to everyone. The previous release stays in the mirror so rollback does not wait for a transfer. And I would remind the room that a successful rollout only proves pods passed their probes, so I would run functional checks afterward.\n\n' +
    'To close, I would restate my assumptions and say what I would verify first: that the chosen signing scheme really verifies offline with only what the site holds, and that the transfer process accepts the bundle format.',
  stages60: ['Clarify (8 min): connectivity per environment, transfer controls, release cadence and how fast a fix must land, CPU architectures, audit and compliance needs. Establish requirements before listing any tools.', 'Trust model (7 min): integrity vs authenticity vs provenance; how trust roots reach each site through a separate channel; who can sign what.', 'High-level design (12 min): build, sign, bundle, transfer, verify before import, local mirror, admission at run time, audit. Draw the flow end to end.', 'Deep dive (10 min): bundle format and dependency inventory, completeness checks against the release manifest, multi-arch, full vs incremental bundles.', 'Constraints the interviewer adds (10 min): key compromise and rotation while sites are offline, an incomplete bundle discovered on site, a site that has been dark for months.', 'Operations (8 min): staged promotion, rollback, who owns the signing keys and the mirrors, audit export.', 'Wrap-up (5 min): restate assumptions, what you would build first, what you would verify first — then your questions.'],
  stages: [
    'Requirements (6 min): connectivity per environment, transfer controls, cadence and fix urgency, architectures, audit needs. Establish requirements before listing any tools.',
    'Trust model (6 min): integrity vs authenticity vs provenance; how trust roots reach sites separately from bundles.',
    'High-level design (10 min): build, sign, bundle, transfer, verify-before-import, mirror, admission, audit. Draw the flow.',
    'Deep dive (8 min): bundle format, completeness checks, multi-arch, full vs incremental.',
    'Failure modes (8 min): incomplete bundle, key compromise and offline rotation, clock, mirror full.',
    'Operations (5 min): staged promotion, rollback, ownership, audit export.',
    'Wrap-up (2 min): restate assumptions and what you would verify first.'
  ],
  questions: ['ons-q-delivery-01', 'ons-q-delivery-02', 'ons-q-delivery-05', 'ons-q-delivery-08', 'ons-q-delivery-03'],
  lessons: ['les-disconnected', 'les-identity', 'les-rollouts'],
  refs: [
    { t: 'Verify signed Kubernetes artifacts', u: 'https://kubernetes.io/docs/tasks/administer-cluster/verify-signed-artifacts/' },
    { t: 'Images', u: 'https://kubernetes.io/docs/concepts/containers/images/' },
    { t: 'Admission control in Kubernetes', u: 'https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/' }
  ],
  verify: 'Offline verification requirements depend on the signing scheme and tool; identity-based (keyless) schemes may need a transparency log, certificate chain or timestamp material available locally. Confirm with the tool you choose before relying on it at disconnected sites.'
});

/* ------------------------------------------------------------------ */
/* 2. Multi-cluster operations with limited reachback                  */
/* ------------------------------------------------------------------ */
LX.onsiteDesign.push({
  id: 'ons-design-multicluster', track: 'onsite', priority: 'P2', mins: 45,
  title: 'Operating and monitoring isolated Kubernetes clusters with limited reachback',
  brief: 'We run a few dozen Kubernetes clusters at sites that are isolated from each other and from us. Some have a slow link for a few hours a day; some have none for weeks. They need to run the right versions, be upgraded safely, and tell us when something is wrong. Design how you would operate and monitor this fleet.',
  clarify: [
    { q: 'How many clusters, and how do they group: by environment, hardware, purpose?',
      why: 'Grouping sets the unit of desired state and the rings you stage changes through.' },
    { q: 'What connectivity does each site have: window length, bandwidth, direction?',
      why: 'Decides push versus pull, how much telemetry can leave, and how stale the central view is allowed to be.' },
    { q: 'Who is on site, and what can they do?',
      why: 'Trained local staff can run break-glass and media transfers. Unattended sites need everything automated and recoverable locally.' },
    { q: 'What must keep working when a site is cut off?',
      why: 'Defines what cannot depend on central services at run time: desired-state source, alerting, identity, DNS, certificates, time.' },
    { q: 'How much version difference across the fleet is acceptable, and for how long?',
      why: 'Sets upgrade cadence and how wide a version range your manifests and tooling must support.' },
    { q: 'Who gets alerted for a local problem, and how fast?',
      why: 'Separates local alert routing to on-site staff from central on-call, which may only see the problem hours later.' },
    { q: 'What data may leave a site, and does it need review?',
      why: 'Telemetry may need filtering or approval before export, which shapes the store-and-forward design.' },
    { q: 'How are clusters provisioned today, and is the hardware uniform?',
      why: 'Uniform hardware allows one tested build; variation widens the test matrix.' }
  ],
  assumptions: [
    'About 30 clusters in three rings: lab, early sites, everyone else.',
    'Links range from a few hours a day to none for up to 30 days; outbound data may need review.',
    'Some sites have a trained operator; others are unattended.',
    'Images and desired-state snapshots reach each site through a trusted delivery process; this design starts at the site mirror.',
    'The central team wants a fleet view that is at most a day old for connected sites and says honestly when data is older.'
  ],
  constraints: [
    'No site may depend on a central control plane to keep running or to recover from a reboot.',
    'Every change comes from a reviewed desired-state source; hand edits only through audited break-glass.',
    'Missing telemetry is never shown as healthy.',
    'Every upgrade step stays within the Kubernetes version skew policy.'
  ],
  architecture: {
    summary: 'Make the center a publisher and an observer, not a controller. Desired state for every site lives in a central repository as a shared base plus a per-site overlay, reviewed like code, and each release of it is a signed snapshot. Snapshots reach sites through the trusted delivery path and land in a local desired-state source (for example a Git mirror or an OCI artifact in the site registry). A GitOps controller in each cluster pulls from that local source and reconciles the Kubernetes resources it manages; if the link is down, it keeps reconciling the last good state. The kubelet still pulls images from the site mirror; the controller only manages resources. Monitoring evaluates alert rules on site and notifies local staff, while a store-and-forward agent buffers telemetry and sends a small heartbeat first whenever a link opens, so the center can tell "healthy" from "we have not heard".',
    components: [
      { name: 'Fleet inventory', resp: 'Authoritative list of sites with cluster version, hardware profile, ring, owner and last-seen time; consulted before every rollout.' },
      { name: 'Desired-state repository', resp: 'Base configuration plus per-site overlays, changed only by reviewed pull requests; each release is a tagged, signed snapshot.' },
      { name: 'Local desired-state source', resp: 'A site-local copy of the signed snapshot the cluster can always reach, independent of the link.' },
      { name: 'GitOps controller (per cluster)', resp: 'Pulls from the local source, applies and continuously reconciles managed resources, and reports which revision is applied.' },
      { name: 'Local monitoring and alerting', resp: 'Collects metrics, logs and events, evaluates alert rules on site, and notifies local operators without the link.' },
      { name: 'Store-and-forward agent', resp: 'Buffers telemetry and audit logs on bounded disk; sends heartbeat and summaries first, then backfills detail as bandwidth allows; records gaps.' },
      { name: 'Central fleet view', resp: 'Shows each site with the age of its data, heartbeat status, applied revision and versions; stale data is shown as unknown.' },
      { name: 'Break-glass access', resp: 'Pre-provisioned, time-limited, audited credentials that work on site without central identity, for when automation is broken.' }
    ],
    diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 390" role="img" aria-label="Fleet operations. A central desired-state repository publishes signed releases to three sites: site A with a daily link, site B with a weekly link, and site C offline, which receives media. Each site has a local source, a cluster whose controller pulls and reconciles from it, local monitoring and alerts, and a store-and-forward buffer with a heartbeat. Buffers forward to a central fleet view that shows last-seen time and data age, treating stale data as unknown." font-family="inherit" font-size="11">' +
      '<defs><marker id="odm-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--muted)"/></marker></defs>' +
      '<rect x="120" y="12" width="240" height="46" rx="6" style="fill:var(--bg-elev);stroke:var(--accent)"/>' +
      '<text x="240" y="32" text-anchor="middle" style="fill:var(--text)">Desired state + releases</text><text x="240" y="48" text-anchor="middle" style="fill:var(--muted)">(reviewed, signed snapshots)</text>' +
      '<line x1="200" y1="58" x2="100" y2="90" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/>' +
      '<line x1="240" y1="58" x2="240" y2="90" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/>' +
      '<line x1="280" y1="58" x2="380" y2="90" stroke-width="1.5" stroke-dasharray="5 4" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/>' +
      '<rect x="16" y="92" width="144" height="208" rx="8" style="fill:none;stroke:var(--line)"/>' +
      '<rect x="168" y="92" width="144" height="208" rx="8" style="fill:none;stroke:var(--line)"/>' +
      '<rect x="320" y="92" width="144" height="208" rx="8" stroke-dasharray="5 4" style="fill:none;stroke:var(--amber)"/>' +
      '<text x="88" y="108" text-anchor="middle" style="fill:var(--muted)">Site A: daily link</text>' +
      '<text x="240" y="108" text-anchor="middle" style="fill:var(--muted)">Site B: weekly link</text>' +
      '<text x="392" y="108" text-anchor="middle" style="fill:var(--muted)">Site C: offline</text>' +
      '<rect x="24" y="118" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="88" y="132" text-anchor="middle" style="fill:var(--text)">Local source</text><text x="88" y="145" text-anchor="middle" style="fill:var(--muted)">(signed mirror)</text>' +
      '<rect x="176" y="118" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="240" y="132" text-anchor="middle" style="fill:var(--text)">Local source</text><text x="240" y="145" text-anchor="middle" style="fill:var(--muted)">(signed mirror)</text>' +
      '<rect x="328" y="118" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="392" y="132" text-anchor="middle" style="fill:var(--text)">Local source</text><text x="392" y="145" text-anchor="middle" style="fill:var(--muted)">(from media)</text>' +
      '<rect x="24" y="164" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--accent)"/><text x="88" y="178" text-anchor="middle" style="fill:var(--text)">Cluster controller</text><text x="88" y="191" text-anchor="middle" style="fill:var(--muted)">pulls, reconciles</text>' +
      '<rect x="176" y="164" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--accent)"/><text x="240" y="178" text-anchor="middle" style="fill:var(--text)">Cluster controller</text><text x="240" y="191" text-anchor="middle" style="fill:var(--muted)">pulls, reconciles</text>' +
      '<rect x="328" y="164" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--accent)"/><text x="392" y="178" text-anchor="middle" style="fill:var(--text)">Cluster controller</text><text x="392" y="191" text-anchor="middle" style="fill:var(--muted)">pulls, reconciles</text>' +
      '<rect x="24" y="210" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="88" y="224" text-anchor="middle" style="fill:var(--text)">Local monitoring</text><text x="88" y="237" text-anchor="middle" style="fill:var(--muted)">alerts on site</text>' +
      '<rect x="176" y="210" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="240" y="224" text-anchor="middle" style="fill:var(--text)">Local monitoring</text><text x="240" y="237" text-anchor="middle" style="fill:var(--muted)">alerts on site</text>' +
      '<rect x="328" y="210" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="392" y="224" text-anchor="middle" style="fill:var(--text)">Local monitoring</text><text x="392" y="237" text-anchor="middle" style="fill:var(--muted)">alerts on site</text>' +
      '<rect x="24" y="256" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="88" y="270" text-anchor="middle" style="fill:var(--text)">Store-and-forward</text><text x="88" y="283" text-anchor="middle" style="fill:var(--muted)">buffer + heartbeat</text>' +
      '<rect x="176" y="256" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="240" y="270" text-anchor="middle" style="fill:var(--text)">Store-and-forward</text><text x="240" y="283" text-anchor="middle" style="fill:var(--muted)">buffer + heartbeat</text>' +
      '<rect x="328" y="256" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="392" y="270" text-anchor="middle" style="fill:var(--text)">Store-and-forward</text><text x="392" y="283" text-anchor="middle" style="fill:var(--muted)">buffer + heartbeat</text>' +
      '<line x1="88" y1="150" x2="88" y2="162" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/><line x1="88" y1="196" x2="88" y2="208" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/><line x1="88" y1="242" x2="88" y2="254" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/>' +
      '<line x1="240" y1="150" x2="240" y2="162" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/><line x1="240" y1="196" x2="240" y2="208" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/><line x1="240" y1="242" x2="240" y2="254" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/>' +
      '<line x1="392" y1="150" x2="392" y2="162" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/><line x1="392" y1="196" x2="392" y2="208" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/><line x1="392" y1="242" x2="392" y2="254" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/>' +
      '<line x1="88" y1="300" x2="140" y2="328" stroke-width="1.5" stroke-dasharray="3 3" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/>' +
      '<line x1="240" y1="300" x2="240" y2="328" stroke-width="1.5" stroke-dasharray="3 3" style="stroke:var(--muted)" marker-end="url(#odm-ah)"/>' +
      '<line x1="392" y1="300" x2="340" y2="328" stroke-width="1.5" stroke-dasharray="3 3" style="stroke:var(--amber)" marker-end="url(#odm-ah)"/>' +
      '<rect x="90" y="330" width="300" height="46" rx="6" style="fill:var(--bg-elev);stroke:var(--accent)"/>' +
      '<text x="240" y="349" text-anchor="middle" style="fill:var(--text)">Fleet view: last seen, versions, revision</text><text x="240" y="365" text-anchor="middle" style="fill:var(--muted)">data too old = unknown, not healthy</text>' +
      '</svg>',
    caption: 'The center publishes desired state and observes. Each site pulls from a local source, alerts locally, and forwards a heartbeat and telemetry when it can.'
  },
  approaches: [
    { name: 'Pull-based reconciliation from a local source per site',
      how: 'A GitOps controller in each cluster reconciles from a site-local copy of signed desired state.',
      pros: ['Keeps working while disconnected', 'Drift is corrected automatically', 'Every change is a reviewed commit'],
      cons: ['A local source and sync process per site', 'Diagnosing sync failures needs local access or good forwarded status'],
      when: 'The default for isolated sites.' },
    { name: 'Central push from a management plane',
      how: 'A central system holds credentials for each cluster API and applies changes directly.',
      pros: ['One place to see and act', 'Simple for well-connected fleets'],
      cons: ['Stops working when the link is down', 'Central system holds high-privilege credentials to every cluster', 'Needs inbound access to each site'],
      when: 'Well-connected fleets where inbound access is acceptable. A poor fit here, but reasonable for a connected subset if policy stays identical.' },
    { name: 'Immutable site images (replace, do not reconcile)',
      how: 'Ship complete, versioned node or appliance images per release and replace rather than modify.',
      pros: ['Very reproducible', 'Little room for drift'],
      cons: ['Large transfers', 'Slower recovery', 'Stateful workloads need separate handling'],
      when: 'Small appliances with little local state, or where hardware is swapped anyway.' }
  ],
  failureModes: [
    { mode: 'Link down for weeks.',
      detect: 'Center: heartbeat age passes a threshold and the site is shown as unknown, not healthy.',
      mitigate: 'Site keeps reconciling the last good state and alerting locally. Central on-call alerts on heartbeat age, not on each missing metric.' },
    { mode: 'A bad desired-state release.',
      detect: 'Sync errors, admission denials or post-sync health checks failing in the first ring.',
      mitigate: 'Promotion halts automatically. Revert by publishing the previous revision as a new snapshot, not by hand edits.' },
    { mode: 'Certificates expire during a long disconnection.',
      detect: 'Local alert on days remaining for control-plane, kubelet, ingress and trust-root certificates.',
      mitigate: 'Know which certificates your installer rotates automatically and which it does not, and renew well ahead of the longest expected outage.' },
    { mode: 'Clock drift at a site.',
      detect: 'Time offset metric; TLS errors saying not yet valid or expired.',
      mitigate: 'A local time source per site, with an alert on offset.' },
    { mode: 'A site missed several releases and is now outside the supported version skew.',
      detect: 'The inventory compares each site against the skew policy before anything is published to it.',
      mitigate: 'Upgrade one minor version at a time through intermediate releases, tested in the lab at those versions.' },
    { mode: 'Telemetry buffer fills.',
      detect: 'Buffer usage is part of the heartbeat and a local alert.',
      mitigate: 'Keep heartbeats, alerts and summaries; downsample or drop oldest detailed data first; record the gap so it is not read as a quiet period later.' },
    { mode: 'Local source corrupted or controller broken.',
      detect: 'Applied revision stops advancing; local alert on controller health and last successful sync.',
      mitigate: 'Runbook to re-seed the local source from the last bundle; break-glass for an urgent fix, then reconcile the change back into the repository.' }
  ],
  identity: [
    'Each cluster pulls from its local source with its own read-only credential; no central system holds write access to site clusters.',
    'Operator identity must work offline (local accounts or a site replica of the identity provider); break-glass credentials are sealed, time-limited and audited.',
    'Per-site secrets are encrypted for that site only, or managed by a site-local secret store. Base64 in a Secret is encoding, not encryption.',
    'RBAC limits the GitOps controller to the namespaces and kinds it is meant to manage.',
    'Plan certificate and trust-root rotation so validity overlaps the longest disconnection window.'
  ],
  observability: [
    'A small heartbeat per site: timestamp, Kubernetes versions, applied revision, buffer usage. Forwarded first.',
    'Three states in the fleet view: healthy (fresh data says so), unhealthy (fresh data says so), unknown (data older than a threshold). Missing data is unknown.',
    'Alert rules for workloads run on site; central rules cover data age, version skew and rollout progress.',
    'Sync status per cluster: desired revision, applied revision, last successful sync.',
    'Expiry view: certificates, trust roots and credentials with days remaining, per site.'
  ],
  deploy: [
    'Rings: lab, then early sites, then everyone; promotion gated on health checks and a soak period.',
    'Kubernetes upgrades follow the version skew policy: control plane first, one minor version at a time, then nodes; kubelets never drift past the supported skew.',
    'Configuration rollback is publishing the previous revision. A Kubernetes minor-version upgrade is not something you simply undo, so back up etcd and rehearse in the lab first.',
    'Test each release against the oldest Kubernetes version still in the fleet.',
    'Disconnected sites apply releases in their window; the inventory shows which sites are behind and by how much.'
  ],
  recovery: [
    'Scheduled etcd snapshots on site, stored off the control-plane nodes, with a tested restore.',
    'Desired state is reproducible from the repository, so rebuilding a cluster is: install, point at the local source, restore stateful data.',
    'Telemetry gaps are recorded explicitly so later analysis does not mistake them for quiet periods.',
    'Break-glass changes are written back to the repository, or the controller will revert them once it is healthy.'
  ],
  ownership: [
    'The platform team owns the desired-state repository, rings, inventory and fleet view.',
    'Site operators own local response, with runbooks for the top alerts, re-seeding the local source, and break-glass.',
    'Central on-call owns data-age, skew and rollout alerts, not per-pod alerts at sites they cannot reach.',
    'A site issue needing a code or config change goes to the platform team with the forwarded evidence.'
  ],
  reveals: [
    { after: 'after the candidate proposes a central management plane pushing to sites',
      constraint: 'A third of the sites have no link for up to 30 days, and security will not allow inbound connections to site clusters.',
      guidance: 'Moves to pull from a local source, keeps the center as publisher and observer, and explains how drift correction and updates still work offline.' },
    { after: 'after the candidate describes central dashboards',
      constraint: 'Last month the dashboard showed a site green for four days while it was down. Its metrics had simply stopped arriving.',
      guidance: 'Adds heartbeats and a three-state model (healthy, unhealthy, unknown), alerts on data age, and separates "no alerts received" from "no problems".' },
    { after: 'after the upgrade plan',
      constraint: 'Several sites missed three releases and are now two Kubernetes minor versions behind the rest.',
      guidance: 'Checks the skew policy, upgrades one minor version at a time through intermediate releases rehearsed in the lab, backs up etcd first, and keeps manifests and tooling compatible with the oldest version in the fleet.' },
    { after: 'after the design is broadly complete',
      constraint: 'At an offline site the GitOps controller is broken and a critical configuration fix must go in now.',
      guidance: 'Uses audited break-glass with a runbook, applies the smallest fix, records it, and gets the change into the repository so the controller does not undo it when it recovers.' }
  ],
  rubric: {
    strong: [
      'Asks about connectivity, staffing, grouping and what must work offline before choosing any tooling.',
      'Makes each site autonomous at run time: local desired-state source, local alerting, local identity, local time.',
      'Treats missing telemetry as unknown, with heartbeats and alerts on data age.',
      'Stages upgrades by ring within the version skew policy, with etcd backups and an honest view of what can be rolled back.',
      'Covers certificates and clocks over long disconnections, and a controlled break-glass path.'
    ],
    acceptable: [
      'Immutable image replacement for small appliances with little state.',
      'Central push for the connected subset, if the disconnected subset uses pull and policy is identical.'
    ],
    redFlags: [
      'Names a GitOps tool or monitoring product before clarifying connectivity and requirements.',
      'Designs a central control plane that sites depend on at run time.',
      'Shows a site as healthy because no alerts arrived.',
      'Plans to skip several Kubernetes minor versions in one step.',
      'Says the GitOps controller pulls the container images (the kubelet and container runtime do).'
    ]
  },
  example: 'This is one reasonable way to run the session, not the only correct design. Other structures can score just as well if they start from requirements and are honest about tradeoffs.\n\n' +
    'I would open with questions rather than boxes. How many clusters, and how do they group? What connectivity does each site have, in which direction, for how long? Who is on site? What must keep working when a site is cut off? How far apart can versions drift? What data may leave a site? Suppose the answers are about 30 clusters, links from a few hours a day to nothing for a month, some sites with a trained operator and some unattended, and outbound data that sometimes needs review.\n\n' +
    'That gives me my first principle, which I would say out loud: the center publishes and observes, but it does not control anything a site needs at run time. If a site has to reach us to keep working or to recover from a reboot, the design fails the first time the link is down.\n\n' +
    'For desired state I would keep one repository with a shared base and a small overlay per site, changed only by reviewed pull requests. Each release is a signed snapshot that travels to the site through the same trusted delivery path as images, and lands in a local source the cluster can always reach. In each cluster a GitOps controller pulls from that local source and reconciles the resources it manages. I would be careful with wording here: the controller reconciles Kubernetes objects; the kubelet and container runtime still pull images, from the site mirror. The fleet inventory records, for every site, its ring, versions, hardware profile, owner and last-seen time, and I would check it before any rollout.\n\n' +
    'Monitoring is where these designs usually go wrong, so I would spend real time on it. Alert rules for workloads run on site and page local staff, because central on-call cannot act on a pod problem at a site they cannot reach. A store-and-forward agent buffers telemetry on bounded disk. When a link opens it sends a small heartbeat first, with timestamp, versions, applied revision and buffer usage, then summaries, then detail. The central view has three states: healthy when fresh data says so, unhealthy when fresh data says so, and unknown when the newest data is older than the threshold. A site that has gone quiet is unknown, never green. Central alerts are about data age, version skew and rollout progress.\n\n' +
    'For upgrades I would use rings: lab, early sites, everyone. Promotion waits for health checks and a soak period. For Kubernetes itself I would follow the published version skew policy: control plane first, one minor version at a time, then nodes, and never let kubelets drift past what the policy supports. If a site has missed releases, it gets intermediate releases in order, each rehearsed in the lab at those versions. Configuration rollback is easy, because it is publishing the previous revision. A minor-version upgrade is not something to plan on reversing, so I would take an etcd snapshot first and treat restore as the fallback.\n\n' +
    'Tradeoffs: central push is simpler for a connected fleet, but it needs inbound access and a system holding admin credentials to every cluster, and it stops working with the link. Immutable appliance images are very reproducible but heavy to transfer. I would pick pull from a local source as the default and keep the others for specific subsets.\n\n' +
    'Failure handling: long disconnections expose certificate expiry and clock drift, so I would alert locally on days remaining for every certificate and trust root, and give each site a local time source. A bad release is caught in the first ring and halts promotion. A broken controller at an offline site is handled with sealed, time-limited, audited break-glass access and a runbook, and the fix is written back to the repository so the controller does not revert it later. A full buffer drops detailed data oldest-first and records the gap, so later analysis does not treat missing hours as quiet ones.\n\n' +
    'Finally ownership: the platform team owns the repository, rings and fleet view; site operators own local response with runbooks; central on-call owns staleness and skew. To verify the design, I would disconnect a lab site on purpose for longer than the longest expected outage and confirm it keeps reconciling, alerts locally, shows as unknown centrally, and catches up cleanly when reconnected.',
  stages60: ['Clarify (8 min): how many clusters and how they group, connectivity per site, on-site staffing, what must keep working offline, what data may leave a site. Establish requirements before listing any tools.', 'Principles (5 min): the center publishes and observes; each site is autonomous at run time.', 'High-level design (12 min): inventory, desired state with per-site overlays, a local source of truth, per-cluster reconciliation, local alerting, store-and-forward telemetry.', 'Monitoring semantics (8 min): heartbeats, data age, unknown vs unhealthy, and what the central view can honestly claim.', 'Upgrades (10 min): rings, version skew, etcd backups before upgrades, what can and cannot be rolled back.', 'Constraints the interviewer adds (10 min): certificates expiring at a dark site, clock drift, a broken controller, break-glass access.', 'Wrap-up (7 min): ownership and on-call, the disconnection test you would run first — then your questions.'],
  stages: [
    'Requirements (6 min): cluster count and grouping, connectivity per site, staffing, what must work offline, data export rules. Establish requirements before listing any tools.',
    'Principles (4 min): the center publishes and observes; sites are autonomous at run time.',
    'High-level design (10 min): inventory, desired state with overlays, local source, per-cluster reconciliation, local alerting, store-and-forward.',
    'Monitoring semantics (7 min): heartbeats, data age, unknown vs unhealthy, what the central view can honestly claim.',
    'Upgrades (8 min): rings, version skew, etcd backups, what can and cannot be rolled back.',
    'Failure and access (7 min): certificates, clocks, broken controller, break-glass.',
    'Wrap-up (3 min): ownership, and the disconnection test you would run first.'
  ],
  questions: ['ons-q-design-02', 'ons-q-design-03', 'ons-q-delivery-06', 'ons-q-design-08', 'ons-q-design-07'],
  lessons: ['les-reconcile', 'les-disconnected', 'les-identity', 'les-failure'],
  refs: [
    { t: 'Version skew policy', u: 'https://kubernetes.io/releases/version-skew-policy/' },
    { t: 'Certificate management with kubeadm', u: 'https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/' },
    { t: 'Controllers', u: 'https://kubernetes.io/docs/concepts/architecture/controller/' },
    { t: 'Operating etcd clusters for Kubernetes', u: 'https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/' }
  ],
  verify: 'Skew limits change over time. At the time of writing the policy page says kube-apiserver instances must be within one minor version of each other and kubelets may be up to three minor versions older than kube-apiserver (two for kubelets older than 1.25); confirm for your versions. Which certificates rotate automatically depends on the installer; kubeadm, for example, renews control-plane certificates during control-plane upgrades by default.'
});

/* ------------------------------------------------------------------ */
/* 3. Stateful service on Kubernetes                                   */
/* ------------------------------------------------------------------ */
LX.onsiteDesign.push({
  id: 'ons-design-stateful', track: 'onsite', priority: 'P2', mins: 45,
  title: 'Running a replicated stateful service on Kubernetes',
  brief: 'A team wants to move a replicated data store onto our Kubernetes clusters. Think of a database or a search cluster: three or more nodes that replicate data between them. It needs persistent storage, backups, safe upgrades and a recovery plan. Design how you would run it, and tell me what you would need to know first.',
  clarify: [
    { q: 'What are the RPO and RTO: how much data can we lose, and how long can it be down?',
      why: 'Drives backup frequency, whether replication must be synchronous, whether you need a standby elsewhere, and how fast restore has to be.' },
    { q: 'How does the service replicate, and how does it elect a leader or form quorum?',
      why: 'Determines replica count (often odd), behaviour during partitions, and how many replicas can safely be down at once.' },
    { q: 'How big is the data and how fast does it grow?',
      why: 'Sets volume size and expansion needs, backup duration and restore time. Large data can make an RTO impossible to meet by restore alone.' },
    { q: 'What storage does the cluster offer: zonal network volumes, local disks, snapshots, expansion?',
      why: 'Local disks tie a replica to a node; zonal volumes tie a pod to a zone; snapshot support changes the backup approach.' },
    { q: 'How many failure domains (nodes, zones, racks) are available?',
      why: 'Replicas should be spread across them. With fewer domains than replicas you accept correlated-failure risk.' },
    { q: 'Is there an operator for this data store, and who maintains it?',
      why: 'An operator encodes domain logic for failover, scaling and upgrades. A mature one saves work; an unmaintained one adds risk.' },
    { q: 'Are upgrades rolling-compatible, or do some versions change the on-disk format?',
      why: 'Decides whether a rolling update is safe and what "rollback" can mean once data has changed.' },
    { q: 'What are the read and write patterns and latency needs?',
      why: 'Affects storage performance class, resource requests, and whether reads can go to followers.' },
    { q: 'Who owns the data and who is on call: the application team or the platform team?',
      why: 'Defines operational ownership, who runs restore drills and who approves migrations.' }
  ],
  assumptions: [
    'Three replicas, quorum-based: a majority must be available to accept writes.',
    'RPO 15 minutes and RTO 1 hour for loss of the whole service; loss of one replica causes no downtime.',
    'The cluster spans three zones. The storage class provides zonal network volumes with snapshot support and WaitForFirstConsumer binding.',
    'About 500 GB per replica, growing roughly 10% per quarter.',
    'An upstream-maintained operator exists, but the team has not run it in production.',
    'Object storage outside the cluster is available for backups.'
  ],
  constraints: [
    'No more than one replica voluntarily unavailable at a time.',
    'Backups must be restorable without the original cluster.',
    'No destructive testing against production data; recovery tests use restored copies.',
    'Deleting the workload must not delete the data by accident.'
  ],
  architecture: {
    summary: 'Run the data store as a StatefulSet, directly or through an operator that manages one, with a volumeClaimTemplate so each replica gets its own PersistentVolumeClaim and keeps its name and disk across restarts. Spread replicas across zones with topology spread constraints or pod anti-affinity, and protect quorum with a PodDisruptionBudget that allows one voluntary disruption. Take application-consistent backups, using the data store\'s own backup mechanism or a snapshot taken while writes are quiesced or otherwise made consistent, plus continuous log or incremental shipping to meet the RPO, and send them outside the cluster. Prove the backups with scheduled restore drills into an isolated environment. Upgrade one replica at a time behind a health gate that asks the data store whether the replica rejoined and caught up, not just whether the pod is Ready.',
    components: [
      { name: 'StatefulSet', resp: 'Stable pod names and network identity, ordered rollout, and one PVC per replica from volumeClaimTemplates.' },
      { name: 'Operator (custom resources + controller)', resp: 'Encodes domain logic: joining replicas, failover, safe scale-down, coordinated upgrades, backup schedules. It is not another word for a Deployment.' },
      { name: 'Headless Service and client Service', resp: 'The headless Service gives each replica a stable DNS name for peers; the client Service sends traffic only to Ready pods.' },
      { name: 'StorageClass and PVCs', resp: 'Zonal volumes with WaitForFirstConsumer binding, expansion enabled, and a Retain reclaim policy (or equivalent protection) for production data.' },
      { name: 'Placement rules', resp: 'Topology spread or anti-affinity across zones and nodes, and a PriorityClass so data pods are not the first to be preempted.' },
      { name: 'PodDisruptionBudget', resp: 'maxUnavailable 1 (or minAvailable equal to quorum) so drains and other voluntary evictions cannot break quorum.' },
      { name: 'Backup job and off-cluster store', resp: 'Application-consistent backups on a schedule plus log or incremental shipping, stored outside the cluster with separate credentials.' },
      { name: 'Restore drill pipeline', resp: 'Regularly restores the latest backup into an isolated namespace or cluster, checks integrity, and times it against the RTO.' },
      { name: 'Data-store monitoring', resp: 'Quorum and leader state, replication lag, disk usage and growth, backup age, drill results.' }
    ],
    diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" role="img" aria-label="Stateful service layout. An operator or StatefulSet controller manages three replicas with a PodDisruptionBudget allowing one unavailable. Each replica runs in its own zone, A, B and C, with its own PersistentVolumeClaim bound to a zonal volume with a Retain policy. Replicas replicate to each other. A backup job takes application-consistent backups from a follower to an off-cluster store, and restore drills restore into an isolated target, timed against the RTO." font-family="inherit" font-size="11">' +
      '<defs><marker id="ods-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--muted)"/></marker></defs>' +
      '<rect x="16" y="10" width="448" height="36" rx="6" style="fill:var(--bg-elev);stroke:var(--accent)"/>' +
      '<text x="240" y="32" text-anchor="middle" style="fill:var(--text)">Operator / StatefulSet; PDB maxUnavailable 1</text>' +
      '<rect x="16" y="58" width="144" height="186" rx="8" stroke-dasharray="5 4" style="fill:none;stroke:var(--line)"/>' +
      '<rect x="168" y="58" width="144" height="186" rx="8" stroke-dasharray="5 4" style="fill:none;stroke:var(--line)"/>' +
      '<rect x="320" y="58" width="144" height="186" rx="8" stroke-dasharray="5 4" style="fill:none;stroke:var(--line)"/>' +
      '<text x="88" y="76" text-anchor="middle" style="fill:var(--muted)">Zone A</text><text x="240" y="76" text-anchor="middle" style="fill:var(--muted)">Zone B</text><text x="392" y="76" text-anchor="middle" style="fill:var(--muted)">Zone C</text>' +
      '<rect x="24" y="86" width="128" height="38" rx="5" style="fill:var(--bg-elev);stroke:var(--accent)"/><text x="88" y="102" text-anchor="middle" style="fill:var(--text)">pod db-0</text><text x="88" y="116" text-anchor="middle" style="fill:var(--muted)">(leader now)</text>' +
      '<rect x="176" y="86" width="128" height="38" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="240" y="102" text-anchor="middle" style="fill:var(--text)">pod db-1</text><text x="240" y="116" text-anchor="middle" style="fill:var(--muted)">(follower)</text>' +
      '<rect x="328" y="86" width="128" height="38" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="392" y="102" text-anchor="middle" style="fill:var(--text)">pod db-2</text><text x="392" y="116" text-anchor="middle" style="fill:var(--muted)">(follower)</text>' +
      '<line x1="152" y1="105" x2="176" y2="105" stroke-width="1.5" stroke-dasharray="3 3" style="stroke:var(--muted)" marker-start="url(#ods-ah)" marker-end="url(#ods-ah)"/>' +
      '<line x1="304" y1="105" x2="328" y2="105" stroke-width="1.5" stroke-dasharray="3 3" style="stroke:var(--muted)" marker-start="url(#ods-ah)" marker-end="url(#ods-ah)"/>' +
      '<rect x="24" y="142" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="88" y="162" text-anchor="middle" style="fill:var(--text)">PVC data-db-0</text>' +
      '<rect x="176" y="142" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="240" y="162" text-anchor="middle" style="fill:var(--text)">PVC data-db-1</text>' +
      '<rect x="328" y="142" width="128" height="32" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="392" y="162" text-anchor="middle" style="fill:var(--text)">PVC data-db-2</text>' +
      '<rect x="24" y="192" width="128" height="38" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="88" y="208" text-anchor="middle" style="fill:var(--text)">Zonal volume</text><text x="88" y="222" text-anchor="middle" style="fill:var(--muted)">reclaim: Retain</text>' +
      '<rect x="176" y="192" width="128" height="38" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="240" y="208" text-anchor="middle" style="fill:var(--text)">Zonal volume</text><text x="240" y="222" text-anchor="middle" style="fill:var(--muted)">reclaim: Retain</text>' +
      '<rect x="328" y="192" width="128" height="38" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="392" y="208" text-anchor="middle" style="fill:var(--text)">Zonal volume</text><text x="392" y="222" text-anchor="middle" style="fill:var(--muted)">reclaim: Retain</text>' +
      '<line x1="88" y1="124" x2="88" y2="140" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#ods-ah)"/><line x1="88" y1="174" x2="88" y2="190" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#ods-ah)"/>' +
      '<line x1="240" y1="124" x2="240" y2="140" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#ods-ah)"/><line x1="240" y1="174" x2="240" y2="190" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#ods-ah)"/>' +
      '<line x1="392" y1="124" x2="392" y2="140" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#ods-ah)"/><line x1="392" y1="174" x2="392" y2="190" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#ods-ah)"/>' +
      '<polyline points="240,244 240,254 116,254 116,262" stroke-width="1.5" style="fill:none;stroke:var(--muted)" marker-end="url(#ods-ah)"/>' +
      '<rect x="16" y="264" width="200" height="38" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="116" y="280" text-anchor="middle" style="fill:var(--text)">Backup job</text><text x="116" y="294" text-anchor="middle" style="fill:var(--muted)">(app-consistent)</text>' +
      '<rect x="264" y="264" width="200" height="38" rx="6" style="fill:var(--bg-elev);stroke:var(--accent)"/><text x="364" y="280" text-anchor="middle" style="fill:var(--text)">Off-cluster store</text><text x="364" y="294" text-anchor="middle" style="fill:var(--muted)">(separate credentials)</text>' +
      '<line x1="216" y1="283" x2="262" y2="283" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#ods-ah)"/>' +
      '<line x1="364" y1="302" x2="364" y2="316" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#ods-ah)"/>' +
      '<rect x="264" y="318" width="200" height="32" rx="6" style="fill:var(--bg-elev);stroke:var(--amber)"/><text x="364" y="338" text-anchor="middle" style="fill:var(--text)">Restore drill (isolated)</text>' +
      '<text x="16" y="330" style="fill:var(--muted)">RPO = backup age</text><text x="16" y="345" style="fill:var(--muted)">RTO = measured drill time</text>' +
      '</svg>',
    caption: 'One PVC per replica, replicas spread across zones, a PDB guarding quorum, and backups that leave the cluster and are proven by restore drills.'
  },
  approaches: [
    { name: 'Operator-managed StatefulSet',
      how: 'Adopt a maintained operator that manages the StatefulSet, configuration, failover and backups through custom resources.',
      pros: ['Domain logic already encoded', 'Consistent upgrades and failover'],
      cons: ['Another component to upgrade, secure and debug', 'Its behaviour under failure must be learned and tested', 'Maturity varies widely between operators'],
      when: 'A mature, maintained operator exists and the team will invest in understanding how it fails.' },
    { name: 'Plain StatefulSet with runbooks',
      how: 'StatefulSet, PDB and scripted backup jobs; people run failover and upgrades from runbooks.',
      pros: ['Fewer moving parts', 'Everything is visible and explicit'],
      cons: ['Failover and upgrades depend on people being available and careful', 'Easy to drift from the runbook'],
      when: 'Simple data stores, small scale, or no operator you trust.' },
    { name: 'Managed service outside the cluster',
      how: 'Use a provider-managed database or search service; the cluster runs only the clients.',
      pros: ['Backups, patching and failover handled by the provider', 'Frees the team for other work'],
      cons: ['May not exist in disconnected or government environments', 'Less control over versions and tuning', 'Cost'],
      when: 'Where it is available and allowed. Always worth asking before building.' }
  ],
  failureModes: [
    { mode: 'A node or a whole zone is lost.',
      detect: 'Pod not Ready, node condition, and the data store\'s own quorum and replication metrics.',
      mitigate: 'The remaining two replicas keep quorum. With zonal volumes the replacement pod can only use its volume in the same zone, so keep spare capacity per zone, or rebuild the replica from peers onto a new volume.' },
    { mode: 'A node drain during maintenance would take out a second replica.',
      detect: 'The PDB blocks the eviction and the drain waits; events show the blocked eviction.',
      mitigate: 'Size the PDB for quorum. Maintenance drains one node at a time and waits until the replica has rejoined and caught up.' },
    { mode: 'Split-brain or lost quorum.',
      detect: 'Two replicas claim leadership, quorum metric drops, writes are rejected.',
      mitigate: 'Odd replica count and quorum-based writes. Never force a minority to accept writes without an explicit, recorded decision about data loss. Fencing belongs to the data store or operator.' },
    { mode: 'Disk fills up.',
      detect: 'Usage and growth-rate alerts well before full.',
      mitigate: 'Volume expansion if the storage class supports it, retention policies, and capacity planning from the growth rate.' },
    { mode: 'An upgrade breaks compatibility or changes the on-disk format.',
      detect: 'The health gate on the first upgraded replica: rejoined, replication healthy, known queries return expected results.',
      mitigate: 'Stop the rollout (for example with a StatefulSet partition). Rollout undo reverts the pod template, not the data on disk or a schema change, so take and verify a backup before upgrading and plan a forward fix or a restore.' },
    { mode: 'Backups fail silently or cannot be restored.',
      detect: 'Alert on backup age and on restore-drill failure, not just on job exit codes.',
      mitigate: 'Scheduled restore drills with integrity checks.' },
    { mode: 'PVCs or the namespace are deleted by accident.',
      detect: 'Audit logs and an alert on PVC deletion.',
      mitigate: 'Retain reclaim policy, a StatefulSet PVC retention policy that keeps claims, RBAC restricting delete, and off-cluster backups.' }
  ],
  identity: [
    'Data-store credentials live in Secrets with encryption at rest configured on the API server (base64 is only encoding), or in an external secret store.',
    'The backup job can write to the backup location but not delete from it; restore uses a separate identity. A compromised cluster should not be able to erase its backups.',
    'The operator\'s ServiceAccount has RBAC scoped to what it manages; review any ClusterRole it asks for.',
    'TLS between replicas and to clients, with certificate rotation planned.',
    'NetworkPolicy limits who can reach the data port, provided the cluster\'s CNI plugin enforces it.'
  ],
  observability: [
    'Data-store health: leader and quorum state, replication lag, per-replica sync. Pod readiness alone does not show these.',
    'Storage: usage, growth rate, IO latency, volume attach and mount errors.',
    'Backups: age of last good backup against the RPO, size trend, drill outcome and duration against the RTO.',
    'Events for PDB-blocked evictions and pod rescheduling during maintenance.'
  ],
  deploy: [
    'Upgrade one replica at a time (StatefulSet RollingUpdate, optionally with a partition to hold the rest), usually followers before the leader.',
    'Between replicas, a health gate asks the data store whether the replica rejoined and caught up, not just whether the pod is Ready.',
    'Take and verify a backup immediately before any upgrade that can change data format.',
    'Schema or data migrations are separate, versioned steps designed to be backward compatible (expand, then contract). Rollout undo does not reverse them.',
    'Rehearse upgrades on a restored copy of production-sized data first.'
  ],
  recovery: [
    'Define and test three paths: rebuild one replica from peers, restore the whole service from backup, and restore to a point in time within the RPO.',
    'Restore drills go into an isolated namespace or cluster, never over production.',
    'Retain reclaim policy on production volumes so deleting a PVC does not delete the disk; document how to reattach or copy the data.',
    'After any restore, verify integrity (counts, checksums, application checks) before sending traffic.',
    'Record real restore times. If they exceed the RTO, change the design: more replicas, snapshots, or a standby.'
  ],
  ownership: [
    'The application team owns the data model, migrations and data correctness; the platform team owns the cluster, storage classes and the operator\'s lifecycle. Write the split down.',
    'One on-call rotation is paged for quorum loss, with runbooks for replica rebuild, full restore, disk full and a stuck upgrade.',
    'Restore drills have a named owner, a calendar, and reviewed results.',
    'Node maintenance handoff: platform announces, the data owner confirms replica health before the next node is drained.'
  ],
  reveals: [
    { after: 'after the candidate proposes a StatefulSet with PVCs',
      constraint: 'A node running a replica fails permanently, and its volume is zonal.',
      guidance: 'Explains that the replacement pod can only attach that volume in the same zone; if the volume is gone, the replica is rebuilt from peers onto a new PVC. Confirms quorum held throughout and plans spare capacity per zone.' },
    { after: 'after the backup design',
      constraint: 'Backups have reported success every night for six months. Nobody has ever restored one.',
      guidance: 'Adds scheduled restore drills into isolation, integrity checks, measured restore time against the RTO, and alerts on backup age and drill failure.' },
    { after: 'after the upgrade plan',
      constraint: 'The next major version rewrites the on-disk format, and downgrade is not supported.',
      guidance: 'Backs up and verifies first, upgrades one replica behind a health gate, holds the rest with a partition, states that rollout undo will not restore the old format, and treats restore-from-backup as the rollback with its data-loss cost made explicit.' },
    { after: 'after the design is broadly complete',
      constraint: 'A teammate proposes testing failover by deleting a production PVC.',
      guidance: 'Declines destructive tests on production. Tests failover on a restored copy or in staging, and limits production checks to non-destructive ones such as a single controlled pod restart within the PDB.' }
  ],
  rubric: {
    strong: [
      'Establishes RPO, RTO, the replication model, data size and storage capabilities before naming any operator or product.',
      'Uses StatefulSet semantics correctly: stable identity, one PVC per replica, ordered updates.',
      'Spreads replicas across failure domains and protects quorum with a PDB.',
      'Makes backups application-consistent and off-cluster, and proves them with restore drills measured against the RTO.',
      'Knows rollout undo does not undo data or schema changes, and plans migrations separately.'
    ],
    acceptable: [
      'Recommends a managed service outside the cluster where one is available and allowed.',
      'A plain StatefulSet with strong runbooks when no trustworthy operator exists.',
      'Volume snapshots as the primary backup, provided consistency with the data store is handled.'
    ],
    redFlags: [
      'Names a specific operator or database product before clarifying requirements.',
      'Runs replicas as a Deployment sharing one volume.',
      'Treats a successful backup job as proof that backups work.',
      'Proposes destructive tests against production data.',
      'Assumes rolling back an upgrade restores the previous data format.'
    ]
  },
  example: 'What follows is one strong way to approach it, not the only correct design. A different answer, including "use a managed service", can score well if it comes from the requirements.\n\n' +
    'I would ask before I draw. What are the RPO and RTO? How does this data store replicate: leader and followers, quorum, or something else? How big is the data and how fast does it grow? What storage does the cluster give me: zonal network volumes, local disks, snapshots, expansion? How many zones? Is there an operator, and who maintains it? Can upgrades roll, or do some versions change the on-disk format? And who owns the data and the pager? Say the answers are: three replicas with quorum writes, RPO 15 minutes, RTO an hour, 500 GB per replica, three zones, zonal volumes with snapshots, an upstream operator the team has not run yet, and off-cluster object storage for backups.\n\n' +
    'I would also ask whether a managed service is an option, because the cheapest stateful system to operate is often one you do not operate. Suppose it is not, because some target environments are disconnected.\n\n' +
    'Now the design. The replicas run as a StatefulSet, either directly or managed by the operator. I would be precise about what an operator is: custom resources plus a controller that encodes this data store\'s domain logic, such as joining replicas, failover and safe upgrades. It is not just a Deployment with another name. The StatefulSet gives each replica a stable name and, through a volumeClaimTemplate, its own PVC, so db-1 always comes back to db-1\'s data. A headless Service gives peers stable DNS names, and a normal Service serves clients from Ready pods only.\n\n' +
    'Placement: one replica per zone, using topology spread constraints or anti-affinity, and a storage class with WaitForFirstConsumer so the volume is created in the zone where the pod is scheduled. I would add a PodDisruptionBudget of maxUnavailable 1, so a node drain can never take two replicas and break quorum. The PDB only guards voluntary disruptions like drains; a node failure is still a node failure, which is why the replicas are spread.\n\n' +
    'Data protection is where I would spend the most time. Backups must be application-consistent, so I would use the data store\'s own backup mechanism, or snapshots taken in a way the data store supports, plus continuous log or incremental shipping to meet a 15-minute RPO. Backups go outside the cluster with credentials that can write but not delete, so a compromised cluster cannot erase its own history. And a backup nobody has restored is a hope, not a backup. I would schedule restore drills into an isolated namespace or cluster, check integrity, and time them. If a 500 GB restore takes longer than an hour, the RTO is not met, and I need to change the design, for example by keeping more replicas or a standby rather than pretending.\n\n' +
    'Upgrades go one replica at a time, followers before the leader, using the StatefulSet rolling update with a partition so I can hold the rest. The gate between replicas is not "the pod is Ready"; it is "the data store says this replica rejoined and caught up". Before any version that can change the on-disk format, I take and verify a backup, because rollout undo only reverts the pod template. It does not rewrite data. Schema or data migrations are separate, versioned steps designed to be backward compatible, expand first and contract later.\n\n' +
    'Failure modes: if a node dies and its zonal volume survives, the pod comes back in the same zone and reattaches; if the volume is gone, the replica rebuilds from peers onto a new PVC while the other two keep quorum. Split-brain is prevented by quorum writes and an odd replica count, and I would never force a minority to accept writes without an explicit decision about data loss. For accidental deletion, production volumes use the Retain reclaim policy and the StatefulSet is set to keep its PVCs, with RBAC limiting who can delete them.\n\n' +
    'Operationally, the application team owns data correctness and migrations, the platform team owns storage and the operator lifecycle, and one rotation is paged for quorum loss with runbooks for rebuild, restore, disk full and a stuck upgrade. To verify, I would run a failover and a full restore in staging on production-sized data, never by deleting anything in production, and I would confirm the actual reclaim and retention settings on the cluster rather than assuming the defaults.',
  stages60: ['Clarify (8 min): RPO and RTO, replication and quorum model, data size and growth, storage capabilities, failure domains, who owns the data. Establish requirements before listing any tools or products.', 'High-level design (12 min): StatefulSet or operator, a PVC per replica, Services, placement across failure domains, PodDisruptionBudgets.', 'Data protection (10 min): backup method and consistency, off-cluster storage, restore drills, RPO and RTO arithmetic.', 'Upgrades and migrations (10 min): one replica at a time, health gates, partitions, and what rollout undo does not undo.', 'Failure modes (10 min): node and zone loss, quorum loss, disk full, accidental deletion — detection and recovery for each.', 'Constraints the interviewer adds (5 min): a larger dataset, a stricter RTO, or a storage class without snapshots.', 'Wrap-up (5 min): ownership, runbooks, what you would verify in the first week — then your questions.'],
  stages: [
    'Requirements (7 min): RPO and RTO, replication and quorum model, data size, storage capabilities, failure domains, ownership. Establish requirements before listing any tools or products.',
    'High-level design (10 min): StatefulSet or operator, PVC per replica, Services, placement, PDB.',
    'Data protection (8 min): backup method and consistency, off-cluster storage, restore drills, RPO and RTO arithmetic.',
    'Upgrades and migrations (8 min): one replica at a time, health gates, partition, what rollout undo does not undo.',
    'Failure modes (8 min): node and zone loss, quorum loss, disk full, accidental deletion.',
    'Wrap-up (4 min): ownership, runbooks, and what you would verify in the first week.'
  ],
  questions: ['ons-q-design-04', 'ons-q-arch-07', 'ons-q-arch-06', 'ons-q-trouble-05'],
  lessons: ['les-storage', 'les-workloads', 'les-operators', 'les-scheduling', 'les-rollouts'],
  refs: [
    { t: 'StatefulSets', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/' },
    { t: 'Specifying a Disruption Budget for your Application', u: 'https://kubernetes.io/docs/tasks/run-application/configure-pdb/' },
    { t: 'Persistent Volumes', u: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/' },
    { t: 'Volume Snapshots', u: 'https://kubernetes.io/docs/concepts/storage/volume-snapshots/' }
  ],
  verify: 'StatefulSet persistentVolumeClaimRetentionPolicy availability and defaults depend on the Kubernetes version. Dynamically provisioned PVs take the StorageClass reclaimPolicy, which defaults to Delete unless set. Volume snapshots need a CSI driver and snapshot controller that support them. Confirm all three on your cluster.'
});

/* ------------------------------------------------------------------ */
/* 4. Automated remediation with guardrails                            */
/* ------------------------------------------------------------------ */
LX.onsiteDesign.push({
  id: 'ons-design-remediation', track: 'onsite', priority: 'P2', mins: 45,
  title: 'Automated remediation without retry storms or capacity starvation',
  brief: 'Our on-call engineers spend most nights restarting and replacing things by hand. We want automation that detects common failures across our clusters and fixes them. The last attempt made an outage worse. Design an automated remediation system.',
  clarify: [
    { q: 'Which failures cause most of the manual work, and what is the manual fix for each?',
      why: 'Start from a small catalogue of well-understood actions, not general-purpose automation.' },
    { q: 'What exactly went wrong last time?',
      why: 'Tells you which guardrail is non-negotiable: corroboration, rate limits, capacity isolation, or a kill switch.' },
    { q: 'What shared resources do the fixes consume: a capacity pool, API rate limits, quota, people\'s attention?',
      why: 'Restarts and replacements compete with normal workloads, so their consumption has to be budgeted.' },
    { q: 'How reliable is the telemetry, and can it go missing for a whole cluster?',
      why: 'If data can disappear, missing data must be handled as unknown and must never trigger action.' },
    { q: 'What is the blast radius of each action, and is it reversible?',
      why: 'Decides which actions can be automatic, which need approval, and which are never automated.' },
    { q: 'How many targets and clusters, and how often do failures happen together?',
      why: 'Correlated failures are when naive automation causes storms; this sets global limits.' },
    { q: 'Who must be told when automation acts, and who can stop it?',
      why: 'Defines notifications, audit, and ownership of the kill switch.' },
    { q: 'How will we know the automation is helping?',
      why: 'Defines success measures: time to recovery, pages avoided, actions that did not fix anything.' }
  ],
  assumptions: [
    'Several hundred targets (nodes, pods, service instances) across about a dozen clusters in one region, all drawing on a shared regional capacity pool.',
    'The top three manual fixes: restart a stuck process, replace an unhealthy node, clear a full disk.',
    'The telemetry pipeline occasionally delays or drops data for a whole cluster.',
    'Night on-call is one person; automation must reduce pages, not add confusing ones.',
    'Every action must be reviewable after an incident.'
  ],
  constraints: [
    'Remediation must never consume shared capacity in a way that starves normal workloads or other clusters.',
    'Missing telemetry must not trigger an action.',
    'The on-call engineer can stop any action class within seconds.',
    'Every action is recorded with the evidence that triggered it and its result.'
  ],
  architecture: {
    summary: 'Separate detection, decision and execution so each can be reasoned about and limited on its own. The detector produces a finding only when independent signals agree, and treats missing or stale data as unknown, which goes to a human rather than to an action. The decision layer is a policy gate: kill switch, dry-run mode, allow-listed actions, per-target and global rate limits, and a circuit breaker per action type. Approved actions enter a queue with priority, fair share across clusters and a concurrency cap, with capacity headroom that remediation may not touch, so a burst from a few clusters cannot drain the shared pool. Executors run idempotent actions with backoff and jitter, verify the result, and write every step to an audit log. The system measures its own effect and escalates when it is not helping.',
    components: [
      { name: 'Signal collection', resp: 'Metrics, events, health checks and heartbeats, each carrying its age so staleness is visible.' },
      { name: 'Detector with corroboration', resp: 'Requires two or more independent signals to agree before raising a finding; stale or missing data produces "unknown".' },
      { name: 'Policy gate', resp: 'Kill switch, dry-run, allow-list of actions per target type, per-target and global rate limits, circuit breaker per action type.' },
      { name: 'Fair-share work queue', resp: 'Orders approved actions by priority, caps concurrency per cluster and globally, and keeps reserved headroom for normal workloads.' },
      { name: 'Executors', resp: 'Run idempotent actions keyed by target and finding, check current state first, back off with jitter, and stop after a bounded number of attempts.' },
      { name: 'Outcome verifier', resp: 'Confirms the target actually recovered; feeds the circuit breaker and effectiveness metrics.' },
      { name: 'Audit log', resp: 'Append-only record of finding, evidence, decision, action, result and approver, stored where the remediation system cannot alter it.' },
      { name: 'Escalation', resp: 'Pages a human with the evidence when data is unknown, limits are reached, a breaker opens, or actions are not fixing targets.' }
    ],
    diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 396" role="img" aria-label="Remediation pipeline. Signals with their age feed a detector that needs two or more agreeing signals; missing or stale data is unknown and pages a human. Findings pass a policy gate with kill switch, dry-run mode, per-target limit, global limit and circuit breaker. Approved actions enter a queue with priority, fair share per cluster, a concurrency cap and reserved headroom. Executors run idempotent actions with backoff and jitter against budgeted shared capacity. Outcomes are verified and audited, feed back to the detector, and escalate to a human when not fixed." font-family="inherit" font-size="11">' +
      '<defs><marker id="odr-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--muted)"/></marker></defs>' +
      '<rect x="24" y="10" width="440" height="36" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="244" y="32" text-anchor="middle" style="fill:var(--text)">Signals with age: metrics, events, heartbeats</text>' +
      '<line x1="160" y1="46" x2="160" y2="62" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odr-ah)"/>' +
      '<rect x="24" y="64" width="282" height="40" rx="6" style="fill:var(--bg-elev);stroke:var(--accent)"/>' +
      '<text x="165" y="88" text-anchor="middle" style="fill:var(--text)">Detector: 2+ agreeing signals</text>' +
      '<rect x="322" y="64" width="142" height="40" rx="6" style="fill:var(--bg-elev);stroke:var(--amber)"/>' +
      '<text x="393" y="80" text-anchor="middle" style="fill:var(--text)">Missing or stale</text><text x="393" y="95" text-anchor="middle" style="fill:var(--text)">= unknown: page</text>' +
      '<line x1="306" y1="84" x2="320" y2="84" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odr-ah)"/>' +
      '<line x1="160" y1="104" x2="160" y2="122" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odr-ah)"/>' +
      '<rect x="24" y="124" width="440" height="78" rx="6" style="fill:none;stroke:var(--accent)"/>' +
      '<text x="36" y="141" style="fill:var(--muted)">POLICY GATE</text>' +
      '<rect x="32" y="150" width="78" height="42" rx="5" style="fill:var(--bg-elev);stroke:var(--red)"/><text x="71" y="167" text-anchor="middle" style="fill:var(--text)">Kill</text><text x="71" y="182" text-anchor="middle" style="fill:var(--text)">switch</text>' +
      '<rect x="118" y="150" width="78" height="42" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="157" y="167" text-anchor="middle" style="fill:var(--text)">Dry-run</text><text x="157" y="182" text-anchor="middle" style="fill:var(--text)">mode</text>' +
      '<rect x="204" y="150" width="78" height="42" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="243" y="167" text-anchor="middle" style="fill:var(--text)">Per-target</text><text x="243" y="182" text-anchor="middle" style="fill:var(--text)">limit</text>' +
      '<rect x="290" y="150" width="78" height="42" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="329" y="167" text-anchor="middle" style="fill:var(--text)">Global</text><text x="329" y="182" text-anchor="middle" style="fill:var(--text)">limit</text>' +
      '<rect x="376" y="150" width="80" height="42" rx="5" style="fill:var(--bg-elev);stroke:var(--line)"/><text x="416" y="167" text-anchor="middle" style="fill:var(--text)">Circuit</text><text x="416" y="182" text-anchor="middle" style="fill:var(--text)">breaker</text>' +
      '<line x1="160" y1="202" x2="160" y2="220" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odr-ah)"/>' +
      '<rect x="24" y="222" width="440" height="40" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="244" y="239" text-anchor="middle" style="fill:var(--text)">Queue: priority, fair share per cluster,</text><text x="244" y="254" text-anchor="middle" style="fill:var(--text)">concurrency cap, reserved headroom</text>' +
      '<line x1="160" y1="262" x2="160" y2="280" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odr-ah)"/>' +
      '<rect x="24" y="282" width="282" height="40" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="165" y="299" text-anchor="middle" style="fill:var(--text)">Executor: idempotent actions,</text><text x="165" y="314" text-anchor="middle" style="fill:var(--text)">backoff + jitter, capped attempts</text>' +
      '<rect x="322" y="282" width="142" height="40" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="393" y="299" text-anchor="middle" style="fill:var(--text)">Shared capacity</text><text x="393" y="314" text-anchor="middle" style="fill:var(--muted)">(budgeted)</text>' +
      '<line x1="306" y1="302" x2="320" y2="302" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odr-ah)"/>' +
      '<line x1="160" y1="322" x2="160" y2="340" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odr-ah)"/>' +
      '<rect x="24" y="342" width="282" height="40" rx="6" style="fill:var(--bg-elev);stroke:var(--line)"/>' +
      '<text x="165" y="366" text-anchor="middle" style="fill:var(--text)">Verify outcome; write audit log</text>' +
      '<rect x="322" y="342" width="142" height="40" rx="6" style="fill:var(--bg-elev);stroke:var(--amber)"/>' +
      '<text x="393" y="359" text-anchor="middle" style="fill:var(--text)">Not fixed or over</text><text x="393" y="374" text-anchor="middle" style="fill:var(--text)">budget: escalate</text>' +
      '<line x1="306" y1="362" x2="320" y2="362" stroke-width="1.5" style="stroke:var(--muted)" marker-end="url(#odr-ah)"/>' +
      '<polyline points="24,362 10,362 10,84 22,84" stroke-width="1.5" stroke-dasharray="4 3" style="fill:none;stroke:var(--muted)" marker-end="url(#odr-ah)"/>' +
      '</svg>',
    caption: 'Detection, a policy gate, a fair-share queue and idempotent executors are separate stages. Unknown data and repeated failures go to a human, not to more retries; outcomes feed back into detection.'
  },
  approaches: [
    { name: 'Central remediation service with a policy gate',
      how: 'One service per region receives findings from every cluster and applies global limits, fair share and the kill switch.',
      pros: ['A global view makes global limits and fair share possible', 'One audit log and one kill switch'],
      cons: ['A central dependency that needs its own high availability', 'If its policy is wrong, it is wrong everywhere at once'],
      when: 'When actions draw on shared regional capacity, so coordination across clusters is required.' },
    { name: 'In-cluster controllers plus a shared budget',
      how: 'A controller in each cluster handles cheap local actions such as restarts, and asks a shared budget service before any action that consumes shared capacity.',
      pros: ['Local actions keep working if the central service is down', 'Fast for restarts'],
      cons: ['Global limits still need coordination', 'Harder to see fleet-wide behaviour'],
      when: 'A mix of cheap local actions and expensive shared-capacity actions.' },
    { name: 'Human-approved runbook automation',
      how: 'Automation detects, gathers evidence and prepares the action; a person approves it with one step.',
      pros: ['Low risk', 'Builds a record of how often the proposed action was right'],
      cons: ['Still pages people', 'Slower recovery'],
      when: 'New action types, high-blast-radius actions, or until measured precision justifies full automation.' }
  ],
  failureModes: [
    { mode: 'Retry storm: many targets fail together and each retries immediately.',
      detect: 'Actions per minute, queue depth, the same action repeated on the same target.',
      mitigate: 'Exponential backoff with jitter, per-target attempt caps, a global rate limit, and a circuit breaker that opens when the failure ratio is high.' },
    { mode: 'Shared capacity starvation: replacements from a few clusters exhaust the regional pool.',
      detect: 'Headroom in the shared pool, pending placements for normal workloads, remediation\'s share of capacity per cluster.',
      mitigate: 'Fair-share quotas per cluster, reserved headroom automation cannot use, priority for normal scaling over remediation, and stop-and-escalate when the budget is spent.' },
    { mode: 'Missing telemetry read as failure.',
      detect: 'Data age per source; many targets "failing" at once behind the same pipeline.',
      mitigate: 'Missing or stale is unknown. Unknown never triggers an action; it pages on the telemetry pipeline instead.' },
    { mode: 'Missing telemetry read as healthy.',
      detect: 'Heartbeat age per target and per cluster.',
      mitigate: 'The same three-state rule; dashboards show unknown distinctly from healthy.' },
    { mode: 'The action does not fix the problem because the diagnosis was wrong.',
      detect: 'Outcome verifier: target not recovered, or the same target flagged again within a window.',
      mitigate: 'Stop after a few attempts and escalate with evidence; track fix rate per action type and open the breaker when it drops.' },
    { mode: 'A non-idempotent action runs twice after a timeout.',
      detect: 'Two action records for one finding.',
      mitigate: 'Idempotency key per finding and target, a lease per target, and a state check before acting and before retrying.' },
    { mode: 'The remediation system itself fails or loops.',
      detect: 'Its own heartbeat, error rate and gaps in the audit log.',
      mitigate: 'Fail closed (take no action) and alert on-call; never fail open into unlimited actions.' }
  ],
  identity: [
    'The remediation system has its own identity with the minimum permissions for its allow-listed actions, not cluster-admin.',
    'Separate credentials per action class, so a compromised restart executor cannot replace nodes.',
    'The kill switch is operated by on-call through an authenticated, audited path that still works when the remediation system is degraded.',
    'The audit log lives in a store the remediation system can append to but cannot modify or delete.'
  ],
  observability: [
    'Actions by type, cluster and result; fix rate and repeat rate per action type.',
    'Capacity consumed by remediation against headroom, per cluster and in total.',
    'Breaker state, rate-limit rejections, unknown findings, escalations.',
    'Effect on outcomes: time to recovery, pages avoided, and incidents where remediation contributed.',
    'Dry-run disagreement: what automation would have done compared with what people did.'
  ],
  deploy: [
    'Each new action type goes dry-run, then human-approved, then automatic for a small scope, then wider.',
    'Policy (limits, allow-lists, thresholds) is versioned configuration with review, rolled out cluster by cluster.',
    'Detector rule changes are replayed against recorded telemetry, including periods with gaps, before release.',
    'Rolling back the remediation system means reverting its version or using the kill switch; actions already taken are not undone automatically.'
  ],
  recovery: [
    'Each action records the pre-action state so a person can reverse it if needed.',
    'Actions are idempotent and the queue survives restarts without re-running completed work.',
    'After an incident, the audit log reconstructs every automated action on a timeline.',
    'An open breaker does not reset itself during an active incident without human acknowledgement.'
  ],
  ownership: [
    'The platform or SRE team owns the remediation system, its policies and its on-call.',
    'Each action type has a named owner who approves its runbook and reviews its fix rate.',
    'On-call owns the kill switch; automation never blocks a human override.',
    'Post-incident reviews include a standard section on what automation did.'
  ],
  reveals: [
    { after: 'after the candidate proposes restarting on health-check failure',
      constraint: 'The telemetry pipeline for one cluster stalls for 20 minutes, and every target in that cluster stops reporting.',
      guidance: 'Treats the missing data as unknown, requires corroboration, takes no action, pages on the pipeline, and shows unknown distinctly on dashboards.' },
    { after: 'after the candidate adds node replacement',
      constraint: 'A kernel problem hits three clusters at once. Each wants to replace dozens of nodes from the same regional pool that other clusters need for normal scaling.',
      guidance: 'Adds a global rate limit, concurrency cap, fair share per cluster, reserved headroom and priority for normal workloads; opens a breaker on correlated failure and escalates, because a correlated failure usually needs a human decision rather than more replacements.' },
    { after: 'after the candidate adds retries',
      constraint: 'The replacement API starts timing out, and the executor cannot tell whether its last call succeeded.',
      guidance: 'Uses idempotency keys, checks current state before retrying, backs off with jitter, bounds attempts, and opens the breaker on a high error rate.' },
    { after: 'after the design is broadly complete',
      constraint: 'Leadership asks whether remediation is reducing incidents or causing some.',
      guidance: 'Measures fix rate, repeat rate, time to recovery against a baseline, pages avoided, capacity used and incidents where automation contributed, using the audit log and dry-run comparisons, and is willing to switch off an action type that does not pay for itself.' }
  ],
  rubric: {
    strong: [
      'Asks which failures, which fixes, and which shared resources they consume before proposing any tooling.',
      'Treats missing telemetry as unknown and requires corroboration before acting.',
      'Includes per-target and global limits, concurrency caps, backoff with jitter, and a circuit breaker.',
      'Protects shared capacity with fair share and reserved headroom, and escalates correlated failures to people.',
      'Makes actions idempotent, audited and stoppable, and measures the automation\'s own impact.'
    ],
    acceptable: [
      'Human-approved automation first, promoted to automatic as measured precision improves.',
      'Per-cluster controllers for cheap local actions with a central budget for capacity-consuming ones.'
    ],
    redFlags: [
      'Names a specific automation or workflow product before clarifying requirements.',
      '"Retry until it works" with no limit, backoff or breaker.',
      'Triggers remediation from missing data.',
      'No kill switch or no path to a human.',
      'Ignores that remediation competes with normal workloads for shared capacity.'
    ]
  },
  example: 'Here is one strong way to work this problem, not the only correct design. Other shapes can score well if they start from requirements and keep the guardrails.\n\n' +
    'The brief says the last attempt made an outage worse, so my first question is what happened. Then: which failures cause most of the manual work, and what exactly does the engineer do for each? What shared resources do those fixes use: a capacity pool, API rate limits, quota? How reliable is the telemetry, and can it disappear for a whole cluster? What is the blast radius of each action, and can it be reversed? How often do failures come in groups? Who is told, and who can stop it? And how will we know it is helping? Suppose the answers are: a dozen clusters in a region sharing one capacity pool; the top fixes are restarting a stuck process, replacing an unhealthy node and clearing a full disk; and the telemetry pipeline sometimes drops a whole cluster\'s data for a while.\n\n' +
    'Both of those answers point at failure patterns that happen in real systems: remediation requests from a small number of clusters consuming shared regional capacity that everyone else needed, and a detector that could not tell missing telemetry from a failed target. So I would design against those two explicitly.\n\n' +
    'I would split the system into detect, decide, execute and verify. Detection turns signals into findings, and every signal carries its age. A finding needs at least two independent signals to agree, for example a failing health check and an elevated error rate from the load balancer side. The important rule is three states: healthy, unhealthy and unknown. If the newest data is older than the threshold, the target is unknown, and unknown never triggers an action. If a whole cluster goes unknown at once, that is almost certainly the telemetry pipeline, so I page about the pipeline instead of restarting hundreds of healthy things.\n\n' +
    'Decision is a policy gate. It has a kill switch that on-call can flip in seconds through a path that works even if the remediation service is degraded; a dry-run mode; an allow-list of actions per target type; a per-target limit so one flapping node cannot be replaced ten times an hour; a global limit so the whole region cannot be replaced at once; and a circuit breaker per action type that opens when the recent fix rate drops or the failure ratio across targets gets too high.\n\n' +
    'Approved actions go into a queue with priority, fair share per cluster and a concurrency cap. For actions that consume shared capacity, such as node replacement, I would reserve headroom remediation is not allowed to use, and give normal scaling priority over remediation. If three clusters hit a kernel problem at once, each gets its fair share and then the breaker opens and a human decides, because a correlated failure usually has a single cause that replacement will not fix.\n\n' +
    'Executors run idempotent actions. Each action has a key made of the finding and the target, takes a lease on the target, and checks current state before acting, so a timeout followed by a retry does not replace the same node twice. Retries use exponential backoff with jitter so recovering targets do not all retry in the same second, and attempts are capped. After acting, the verifier checks that the target actually recovered. If not, it escalates with the evidence rather than trying something bigger.\n\n' +
    'Every step writes to an append-only audit log the remediation service cannot edit: the evidence, the decision, the action, the result. The service has its own narrowly scoped identity, with separate credentials per action class.\n\n' +
    'Rollout matters as much as design. Each new action type starts in dry-run, where I compare what it would have done with what people did. Then it runs with human approval, then automatically in one cluster, then wider. Detector changes get replayed against recorded telemetry, including the periods with gaps.\n\n' +
    'Finally I would measure the automation itself: fix rate and repeat rate per action type, time to recovery against the manual baseline, pages avoided, capacity consumed, and every incident where automation was a contributing factor. If an action type does not pay for itself, I would turn it off. The platform team owns the system, each action type has a named owner, and on-call owns the kill switch.',
  stages60: ['Clarify (8 min): the top failures and their manual fixes, what went wrong last time, shared resources, how reliable the telemetry is, scale. Establish requirements before listing any tools.', 'High-level design (10 min): detect, decide, queue, execute, verify, audit.', 'Detection semantics (8 min): corroboration, healthy / unhealthy / unknown, data age — missing telemetry is not a failure signal.', 'Guardrails (12 min): rate limits, concurrency caps, backoff with jitter, circuit breaker, fair share and headroom on shared capacity, kill switch, dry-run.', 'Failure modes (10 min): correlated failure, capacity pressure, unknown outcomes after timeouts, the automation itself failing.', 'Measurement and ownership (7 min): fix rate, capacity consumed by remediation, who owns the kill switch and the escalation path.', 'Wrap-up (5 min): the rollout plan for the first action type — then your questions.'],
  stages: [
    'Requirements (7 min): top failures and their manual fixes, what went wrong last time, shared resources, telemetry reliability, scale. Establish requirements before listing any tools.',
    'High-level design (8 min): detect, decide, queue, execute, verify, audit.',
    'Detection semantics (6 min): corroboration, healthy / unhealthy / unknown, data age.',
    'Guardrails (10 min): rate limits, concurrency caps, backoff with jitter, circuit breaker, fair share and headroom, kill switch, dry-run.',
    'Failure modes (8 min): correlated failure, capacity pressure, unknown outcomes after timeouts, the automation itself failing.',
    'Measurement and ownership (4 min): fix rate, capacity used, who owns the kill switch.',
    'Wrap-up (2 min): the rollout plan for the first action type.'
  ],
  questions: ['ons-q-design-01', 'ons-q-design-05', 'ons-q-design-06', 'ons-q-design-07'],
  lessons: ['les-failure', 'les-probes', 'les-reconcile', 'les-resources'],
  refs: [
    { t: 'Controllers', u: 'https://kubernetes.io/docs/concepts/architecture/controller/' },
    { t: 'API Priority and Fairness', u: 'https://kubernetes.io/docs/concepts/cluster-administration/flow-control/' },
    { t: 'Disruptions', u: 'https://kubernetes.io/docs/concepts/workloads/pods/disruptions/' }
  ],
  verify: ''
});
