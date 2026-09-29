/* Onsite track — "walk me through an architecture you owned".

   A design interview often opens (or closes) with your own system instead of
   a hypothetical one. These walkthroughs are built only from facts you gave:
   your background (bringing a managed service online in new, isolated
   regions: identity, authorization, DNS, certificates, artifact distribution,
   feature enablement, validation and readiness) and your five sanitised
   stories. Everything else — scale, your exact role, decisions, outcomes — is
   a blank you fill in. Blanks are stored only in this browser.

   Nothing here names internal systems, customers or missions, and nothing
   should be added that does. Keep it at the level of mechanisms. */
window.LX = window.LX || {};
LX.onsiteWalks = [
  {
    id: 'ons-walk-bringup', track: 'onsite', mins: 12,
    title: 'Bringing a managed service online in an isolated region',
    prompt: 'Walk me through an infrastructure architecture you owned or worked on closely.',
    aim: 'About ten minutes, whiteboard or shared screen, then invite questions. Lead with the problem and the constraints, not the component list.',
    sections: [
      { h: 'Frame it (1–2 min)',
        guide: 'What the system was for, where it ran, and what made it hard. The isolation is the interesting part — say so early.',
        fields: ['In one sentence: what the service does for its users', 'Your role: what you personally owned versus what the team owned', 'Why the region was hard: isolation, access and transfer constraints (keep it generic)'] },
      { h: 'Requirements and constraints (2 min)',
        guide: 'What "ready" had to mean before customers could use it, and what you could not do in that environment. Requirements first, components second.',
        fields: ['What had to be true for the region to be declared ready', 'Constraints that shaped the design (connectivity, change control, who could touch what)'] },
      { h: 'The architecture (3–4 min)',
        guide: 'Draw the layers you brought up and how they depend on each other. The order matters: each layer assumes the ones before it.',
        layers: [
          { name: 'Identity and authorization', say: 'Who and what can act, and how services prove who they are to each other.' },
          { name: 'DNS', say: 'How names resolve inside the region, including delegation from a parent zone.' },
          { name: 'Certificates and trust', say: 'Which CAs are trusted, how certificates are issued and rotated, and how trust roots arrive in an isolated region.' },
          { name: 'Artifact distribution', say: 'How software and its dependencies reach the region under controlled transfer, and how the receiving side verifies them.' },
          { name: 'Feature enablement', say: 'How capabilities are switched on per region, and how scope is controlled.' },
          { name: 'Validation and readiness', say: 'The checks that prove the region works end to end before anyone depends on it.' }
        ],
        fields: ['Your one-line version of each layer, in the order you would draw it', 'Where the dependencies between layers bit you'] },
      { h: 'Decisions and tradeoffs (2 min)',
        guide: 'Two or three decisions, the alternatives, and why. If you inherited a decision, say so and say what you would have weighed.',
        fields: ['Decision 1, the alternative, and why', 'Decision 2, the alternative, and why'] },
      { h: 'Where it broke, and what changed (2 min)',
        guide: 'Use your stories as evidence, told precisely: the DNS delegation failure and negative caching, the transfer that exposed registration, identity and architecture issues, and the rollout that exceeded its intended scope. Only the facts you know; blanks for the rest.',
        stories: ['ons-story-dns', 'ons-story-transfer', 'ons-story-scope'],
        fields: ['Which story you will tell here, and your part in it', 'What was changed afterwards (only what you know)'] },
      { h: 'The same thing on Kubernetes (1–2 min)',
        guide: 'Show you can map it without claiming production Kubernetes experience you do not have.',
        mapping: [
          'Identity and authorization → ServiceAccounts and RBAC inside the cluster; workload identity federation for cloud APIs.',
          'DNS → cluster DNS for Services, plus whatever manages external records; delegation and negative caching still apply outside the cluster.',
          'Certificates → a certificate controller or platform PKI issuing and rotating certificates; trust bundles distributed to workloads and nodes.',
          'Artifact distribution → images pinned by digest in a local mirror, signed, verified on the receiving side, enforced by admission policy.',
          'Feature enablement → configuration per environment (ConfigMaps, overlays), with scope that fails closed — an empty selector must not mean everything.',
          'Validation and readiness → readiness probes for pods, plus end-to-end smoke tests before a region or cluster is declared ready.'
        ],
        fields: ['The one mapping you will say out loud, in your own words'] }
    ],
    probes: [
      { q: 'What exactly was your part, and what was the team\'s?', guidance: 'Be precise and generous: "I owned X; I worked with Y on Z." Interviewers probe this because walkthroughs blur ownership.' },
      { q: 'How did you know the region was actually ready?', guidance: 'Name the checks and what they exercised end to end. Admit what they did not cover and how you would close that gap.' },
      { q: 'What would you do differently now?', guidance: 'One or two concrete changes — earlier prerequisite verification, a readiness gate, fail-closed scoping — tied to what happened.' },
      { q: 'How did trust roots and certificates reach an isolated region, and how were they rotated?', guidance: 'Separate channel for trust roots, overlap periods for rotation, expiry monitoring. Say what you know and mark what you would need to check.' },
      { q: 'How would this look on Kubernetes, and where would it be harder?', guidance: 'Use the mapping. Harder: cluster bootstrapping order, admission and mirrors in disconnected sites, certificate rotation across many clusters.' }
    ],
    pitfalls: [
      'Listing components for ten minutes without saying what problem they solved.',
      'Saying "we" throughout so your own contribution is invisible — or claiming the whole thing.',
      'Inventing numbers or outcomes to sound concrete. A blank you admit beats a number you cannot defend.',
      'Using internal names. Describe mechanisms, not systems.'
    ],
    lessons: ['les-identity', 'les-disconnected', 'les-request-path'],
    questions: ['ons-q-delivery-01', 'ons-q-delivery-02', 'ons-q-design-08', 'ons-q-behavior-05']
  },
  {
    id: 'ons-walk-transfer', track: 'onsite', mins: 10,
    title: 'Getting software into an isolated environment you can trust',
    prompt: 'Tell me about a system you worked on end to end — how did software get from build to running in production?',
    aim: 'About eight minutes. This is your controlled-transfer experience told as an architecture, and it lines up directly with disconnected Kubernetes delivery.',
    sections: [
      { h: 'Frame it (1 min)',
        guide: 'Where software came from, where it had to go, and what stood between them.',
        fields: ['What was being moved and where to (generic)', 'Your role in the flow'] },
      { h: 'The flow (3–4 min)',
        guide: 'Draw it left to right and say what each step guarantees.',
        layers: [
          { name: 'Build and package', say: 'What went into a transfer and how its contents were described.' },
          { name: 'Controlled transfer', say: 'How it crossed into the isolated environment, and who approved it.' },
          { name: 'Receiving-side verification', say: 'What was checked on arrival before anything was used — integrity, authenticity, completeness.' },
          { name: 'Registration and identity', say: 'How the arrived software was registered and given the identities it needed to run.' },
          { name: 'Platform fit', say: 'Checks that it matched the target environment, including CPU architecture.' }
        ],
        fields: ['Your one-line version of each step', 'Which checks were automated and which were manual'] },
      { h: 'What the verification exposed (2 min)',
        guide: 'Your transfer story: receiving-side verification exposed registration, identity and architecture-related issues. Tell only what you know.',
        stories: ['ons-story-transfer'],
        fields: ['One issue it caught, in your words', 'What changed afterwards, if you know'] },
      { h: 'The Kubernetes version (1–2 min)',
        guide: 'Map it to disconnected Kubernetes delivery.',
        mapping: [
          'Package → images and manifests pinned by digest, with an inventory of every dependency the release needs.',
          'Transfer → a signed bundle; the signature is checked against a key that reached the site separately. A hash alone does not tell you who published it.',
          'Receiving side → verify before importing into the local mirror; compare the release inventory with what the mirror already has.',
          'Identity → ServiceAccounts, RBAC and pull credentials in place before the workload arrives.',
          'Platform fit → multi-arch images, checked against the nodes\' architecture before rollout.'
        ],
        fields: ['The mapping you will say out loud'] }
    ],
    probes: [
      { q: 'How do you know the thing you verified was published by the right party?', guidance: 'Signatures verified against a trusted key distributed through a separate channel; a matching hash only proves the bytes match what the manifest says.' },
      { q: 'What would you automate first?', guidance: 'The completeness check (release inventory against mirror contents) and signature verification — the failures you already saw.' },
      { q: 'What happens when something is missing on the receiving side?', guidance: 'It fails before rollout, not during: an inventory diff and a preflight, then a new transfer rather than a local patch.' }
    ],
    pitfalls: [
      'Treating a checksum as proof of origin.',
      'Describing only the happy path; the interesting part is what verification caught.',
      'Internal names or mission detail — keep it to mechanisms.'
    ],
    lessons: ['les-disconnected', 'les-identity'],
    questions: ['ons-q-delivery-01', 'ons-q-delivery-02', 'ons-q-delivery-03']
  }
];
