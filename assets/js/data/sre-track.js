/* SRE & Cloud Deployment Foundations — track record, source register, role
   coverage map, pass rules.

   Every record here has a stable id and a version. Content is separate from
   learner attempts (lx.sre). Role mapping is a coverage aid: it says which
   objectives a posting's requirements touch, never a probability of being
   hired, and blank cells stay blank rather than being invented. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };

LX.sreTrack = {
  id: 'sre-cloud-foundations', trackId: 'sre', version: '1.0', specVersion: '1.0',
  title: 'SRE & Cloud Deployment Foundations',
  prepared: '2026-10-13',
  hours: 168, weeks: 48, weeklyMinutes: 210, sessionMinutes: 70, maxSessionMinutes: 90,
  /* a normal learning week, in minutes */
  weekShape: { retrieval: 15, concepts: 35, lab: 80, scenario: 30, assess: 30, buffer: 20 },
  pass: { knowledgePct: 80, explanationMin: 3, rubricMax: 4, requireIndependentVariant: true, requireCriticalChecks: true },
  reviewDays: [1, 7, 21, 45],
  rubric: [
    { id: 'concept', label: 'Conceptual accuracy' },
    { id: 'evidence', label: 'Evidence gathering' },
    { id: 'impl', label: 'Implementation correctness' },
    { id: 'recovery', label: 'Recovery and verification' },
    { id: 'explain', label: 'Explanation and tradeoffs' }
  ],
  rubricLevels: ['0 — no evidence', '1 — major gaps', '2 — works with substantial assistance',
    '3 — independent and correct on bounded tasks', '4 — handles variants and explains limitations'],
  debrief: [
    { id: 'symptom', label: 'Symptom and impact', prompt: 'What did users or the system show, and who was affected?' },
    { id: 'hypotheses', label: 'Competing hypotheses', prompt: 'Name at least two causes that could explain the symptom.' },
    { id: 'evidence', label: 'Discriminating evidence', prompt: 'Which observation ruled the others out, and how did you get it?' },
    { id: 'action', label: 'Chosen action and tradeoff', prompt: 'What did you change, what did you deliberately not change, and why?' },
    { id: 'verify', label: 'Verification and prevention', prompt: 'How did you prove it is fixed from the user side, and what prevents the recurrence?' }
  ],
  teachBack: { seconds: [60, 90], prompt: 'Explain what broke, how you proved it, and why the fix is the right one — out loud, as if to a teammate who was not there.' },
  honesty: [
    'A simulation shows you can reason through a mechanism in a bounded model. It is not production experience.',
    'A local lab result is imported as learner evidence. The app cannot see your machine, so nothing here is independently attested.',
    'Self-reviewed rubrics are labelled self-reviewed. No AI feedback is required to complete the course, and none can grant a pass on its own.',
    'Completing this course is lab experience. Describe it that way on a resume.'
  ]
};

/* ── Source register (reviewed 2026-10-13) ─────────────────────────────
   status: verified (full page read), index-only (listing or index only),
   historical (recovered from earlier discussion; page inaccessible now). */
LX.sreSources = [
  { id: 'J1', kind: 'employer', title: 'Anduril Cloud Deployment Engineer, Space', url: 'https://job-boards.greenhouse.io/andurilindustries/jobs/5016027007', retrieved: '2026-10-13', status: 'verified', scope: 'Full description supplied and listing indexed.' },
  { id: 'J2', kind: 'employer', title: 'Anduril Senior Cloud Deployment Engineer, Space', url: 'https://job-boards.greenhouse.io/andurilindustries/jobs/5032429007', retrieved: '2026-10-13', status: 'verified', scope: 'Same family at a higher level; independent design ownership is a later progression.' },
  { id: 'J3', kind: 'employer', title: 'Gallatin Cleared Senior SRE', url: 'https://jobs.ashbyhq.com/gallatin/396e2660-8a4b-4ed3-8866-d7f31212847c', retrieved: '2026-10-13', status: 'index-only', scope: 'Employer-indexed requirements; page needs JavaScript.' },
  { id: 'J4', kind: 'employer', title: 'Gallatin Infrastructure Engineer', url: 'https://jobs.ashbyhq.com/gallatin/ac503640-8392-408c-a821-89f80eb7a167', retrieved: '2026-10-13', status: 'index-only', scope: 'Employer-indexed requirements; page needs JavaScript.' },
  { id: 'J5', kind: 'employer', title: 'Google Systems Development Engineer, Sovereign Cloud Operations', url: 'https://www.google.com/about/careers/applications/jobs/results/95060205737255622-systems-development-engineer-sovereign-cloud-operations-google-public-sector', retrieved: '2026-10-13', status: 'verified', scope: 'Full page retrieved.' },
  { id: 'J6', kind: 'employer', title: 'Microsoft SRE II (recovered link)', url: 'https://apply.careers.microsoft.com/careers/job/1970393557008569', retrieved: '2026-10-13', status: 'historical', scope: 'Inaccessible during review; historical evidence only.' },
  { id: 'J7', kind: 'employer', title: 'Ford SRE – Observability Platform', url: 'https://www.careers.ford.com/job/united-states/site-reliability-engineer-observability-platform/48560/101627850880', retrieved: '2026-10-13', status: 'verified', scope: 'Representative current version (job 71162).' },
  { id: 'J8', kind: 'employer', title: 'Workday JR-0093733 (index now says Cloud Engineer, US Federal)', url: 'https://workday.wd5.myworkdayjobs.com/Workday/job/Site-Reliability-Engineer–SRE––Database-Engineering–US-Federal-_JR-0093733', retrieved: '2026-10-13', status: 'index-only', scope: 'Title discrepancy preserved; no database engine inferred from the title.' },
  { id: 'J9', kind: 'employer', title: 'Netflix Support Solutions Engineer', url: 'https://explore.jobs.netflix.net/careers/job/790317701711', retrieved: '2026-10-13', status: 'index-only', scope: 'Title confirmed; full requirements not recovered.' },
  { id: 'J10', kind: 'employer', title: 'OpenAI AI Support Engineer (San Francisco)', url: 'https://openai.com/careers/ai-support-engineer-san-francisco-san-francisco/', retrieved: '2026-10-13', status: 'verified', scope: 'Used for skill pattern only, not location eligibility.' },
  { id: 'J11', kind: 'employer', title: 'Pinterest Security GRC Analyst (historical)', url: 'https://www.pinterestcareers.com/jobs/7684583/security-grc-analyst/', retrieved: '2026-10-13', status: 'historical', scope: 'Inaccessible; optional governance literacy only.' },
  { id: 'T01', kind: 'technical', title: 'Google SRE Workbook', url: 'https://sre.google/workbook/table-of-contents/', retrieved: '2026-10-13', status: 'verified', scope: 'SLOs, monitoring, toil, incidents, overload; assignments here are original.' },
  { id: 'T02', kind: 'technical', title: 'Kubernetes: Debug Services', url: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/', retrieved: '2026-10-13', status: 'verified', scope: 'Investigation concepts, not one prescribed sequence.' },
  { id: 'T03', kind: 'technical', title: 'Terraform S3 backend', url: 'https://developer.hashicorp.com/terraform/language/backend/s3', retrieved: '2026-10-13', status: 'verified', scope: 'use_lockfile is supported; DynamoDB locking is deprecated.' },
  { id: 'T04', kind: 'technical', title: 'kind quick start', url: 'https://kind.sigs.k8s.io/docs/user/quick-start/', retrieved: '2026-10-13', status: 'verified', scope: 'Local cluster workflow and version checks.' },
  { id: 'T05', kind: 'technical', title: 'Kubernetes NetworkPolicy', url: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/', retrieved: '2026-10-13', status: 'verified', scope: 'Enforcement requires a supporting network plugin.' },
  { id: 'T06', kind: 'technical', title: 'Docker multi-platform builds', url: 'https://docs.docker.com/build/building/multi-platform/', retrieved: '2026-10-13', status: 'verified', scope: 'ARM64/AMD64 considerations.' },
  { id: 'T07', kind: 'technical', title: 'OpenTelemetry signals', url: 'https://opentelemetry.io/docs/concepts/signals/', retrieved: '2026-10-13', status: 'verified', scope: 'Signal vocabulary.' },
  { id: 'T08', kind: 'technical', title: 'AWS Well-Architected Reliability Pillar', url: 'https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html', retrieved: '2026-10-13', status: 'verified', scope: 'Reliability design reading roadmap.' },
  { id: 'T09', kind: 'technical', title: 'PostgreSQL backup and restore', url: 'https://www.postgresql.org/docs/current/backup.html', retrieved: '2026-10-13', status: 'verified', scope: 'Recovery reading roadmap; validate chosen version.' },
  { id: 'T10', kind: 'technical', title: 'NIST Risk Management Framework', url: 'https://csrc.nist.gov/projects/risk-management/about-rmf', retrieved: '2026-10-13', status: 'verified', scope: 'Governance vocabulary; practice artifacts confer no authorization.' },
  { id: 'T11', kind: 'technical', title: 'Python tutorial and standard library', url: 'https://docs.python.org/3/', retrieved: '2026-10-13', status: 'verified', scope: 'Language reference for M04.' },
  { id: 'T12', kind: 'technical', title: 'Git documentation', url: 'https://git-scm.com/doc', retrieved: '2026-10-13', status: 'verified', scope: 'Branches, diffs, reverts, conflicts.' },
  { id: 'T13', kind: 'technical', title: 'Helm documentation', url: 'https://helm.sh/docs/', retrieved: '2026-10-13', status: 'verified', scope: 'Charts, values, upgrade, rollback.' },
  { id: 'T14', kind: 'technical', title: 'Prometheus: querying and unit testing rules', url: 'https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/', retrieved: '2026-10-13', status: 'verified', scope: 'PromQL and rule tests.' },
  { id: 'T15', kind: 'technical', title: 'systemd documentation', url: 'https://www.freedesktop.org/software/systemd/man/', retrieved: '2026-10-13', status: 'verified', scope: 'Units, journald.' },
  { id: 'T16', kind: 'technical', title: 'Docker Compose documentation', url: 'https://docs.docker.com/compose/', retrieved: '2026-10-13', status: 'verified', scope: 'Services, networks, volumes, healthchecks.' },
  { id: 'T17', kind: 'technical', title: 'Terraform language documentation', url: 'https://developer.hashicorp.com/terraform/language', retrieved: '2026-10-13', status: 'verified', scope: 'Resources, state, modules, import, replace.' },
  { id: 'T18', kind: 'technical', title: 'AWS IAM policy evaluation logic', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html', retrieved: '2026-10-13', status: 'verified', scope: 'Explicit deny, allow, boundaries.' },
  { id: 'T19', kind: 'technical', title: 'Azure Architecture Center', url: 'https://learn.microsoft.com/azure/architecture/', retrieved: '2026-10-13', status: 'verified', scope: 'Azure translation references.' },
  { id: 'T20', kind: 'technical', title: 'Google Cloud Architecture Framework', url: 'https://cloud.google.com/architecture/framework', retrieved: '2026-10-13', status: 'verified', scope: 'GCP translation references.' },
  { id: 'T21', kind: 'technical', title: 'Sigstore cosign documentation', url: 'https://docs.sigstore.dev/', retrieved: '2026-10-13', status: 'verified', scope: 'Signing and verification; keys used in labs are lab-only.' },
  { id: 'T22', kind: 'technical', title: 'Kubernetes: Liveness, Readiness and Startup Probes', url: 'https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/', retrieved: '2026-10-13', status: 'verified', scope: 'Probe semantics for M08.' },
  { id: 'T23', kind: 'technical', title: 'RFC 1035 / DNS concepts (IETF)', url: 'https://www.rfc-editor.org/rfc/rfc1035', retrieved: '2026-10-13', status: 'verified', scope: 'Delegation, caching, negative answers.' },
  { id: 'T24', kind: 'technical', title: 'Redis documentation', url: 'https://redis.io/docs/', retrieved: '2026-10-13', status: 'verified', scope: 'Queue and cache fixtures in M12.' }
];

/* ── Role coverage map ───────────────────────────────────────────────
   objectiveIds are the course objectives whose evidence covers requirements
   recovered for that role. `gaps` names what the course does not supply. */
LX.sreRoles = [
  { id: 'J1', title: 'Anduril Cloud Deployment Engineer, Space', evidence: 'Full description', emphasis: ['net', 'k8s', 'delivery', 'iac', 'python', 'obs', 'security'],
    objectiveIds: ['obj-m03-01', 'obj-m03-02', 'obj-m03-04', 'obj-m08-01', 'obj-m08-04', 'obj-m09-03', 'obj-m10-01', 'obj-m10-03', 'obj-m06-01', 'obj-m06-03', 'obj-m04-02', 'obj-m11-01', 'obj-m13-02', 'obj-m13-04', 'obj-m13-05'],
    gaps: ['Classified-cloud deployment itself', 'Accreditation artifact ownership beyond synthetic evidence'] },
  { id: 'J2', title: 'Anduril Senior Cloud Deployment Engineer, Space', evidence: 'Full page', emphasis: ['k8s', 'delivery', 'iac', 'security', 'reliability'],
    objectiveIds: ['obj-m08-01', 'obj-m09-03', 'obj-m10-03', 'obj-m06-03', 'obj-m13-05', 'obj-m14-01', 'obj-m16-02'],
    gaps: ['Independent design ownership at senior level is a later progression, not conferred by this course'] },
  { id: 'J3', title: 'Gallatin Cleared Senior SRE', evidence: 'Index only', emphasis: ['linux', 'net', 'python', 'cloud', 'iac', 'containers', 'reliability'],
    objectiveIds: ['obj-m02-01', 'obj-m02-03', 'obj-m03-01', 'obj-m04-01', 'obj-m05-01', 'obj-m06-01', 'obj-m07-01', 'obj-m14-02'],
    gaps: ['Full requirement text unavailable'] },
  { id: 'J4', title: 'Gallatin Infrastructure Engineer', evidence: 'Index only', emphasis: ['k8s', 'delivery', 'security'],
    objectiveIds: ['obj-m08-01', 'obj-m09-04', 'obj-m10-02', 'obj-m13-01', 'obj-m13-03', 'obj-m13-05'],
    gaps: ['Full requirement text unavailable'] },
  { id: 'J5', title: 'Google Systems Development Engineer, Sovereign Cloud Operations', evidence: 'Full page', emphasis: ['python', 'linux', 'k8s', 'reliability', 'obs'],
    objectiveIds: ['obj-m04-01', 'obj-m04-04', 'obj-m02-02', 'obj-m09-01', 'obj-m14-01', 'obj-m11-03', 'obj-m15-01'],
    gaps: ['Capacity and launch reviews at fleet scale'] },
  { id: 'J6', title: 'Microsoft SRE II (CTJ–Secret / Defender US Government)', evidence: 'Historical', emphasis: ['reliability', 'multicloud'],
    objectiveIds: ['obj-m14-01', 'obj-m15-01', 'obj-m11-02'],
    gaps: ['Current page inaccessible; product stack unverified'] },
  { id: 'J7', title: 'Ford SRE – Observability Platform', evidence: 'Full page', emphasis: ['python', 'iac', 'obs', 'data', 'net', 'delivery'],
    objectiveIds: ['obj-m04-03', 'obj-m06-02', 'obj-m11-01', 'obj-m11-02', 'obj-m11-04', 'obj-m12-04', 'obj-m10-02'],
    gaps: ['Years of production programming (B02 extends but does not replace this)', 'GCP depth (optional C05)'] },
  { id: 'J8', title: 'Workday Cloud Engineer (US Federal), formerly SRE – Database Engineering', evidence: 'Index only', emphasis: ['data', 'python'],
    objectiveIds: ['obj-m12-01', 'obj-m12-02', 'obj-m12-03', 'obj-m04-01'],
    gaps: ['Database engine unknown from the title; B01 uses PostgreSQL as a transferable teaching choice'] },
  { id: 'J9', title: 'Netflix Support Solutions Engineer – Security, Privacy and Assurance', evidence: 'Index only', emphasis: ['multicloud', 'security'],
    objectiveIds: ['obj-m15-03', 'obj-m13-01', 'obj-m14-04'],
    gaps: ['Identity product specifics (B05 optional)'] },
  { id: 'J10', title: 'OpenAI AI Support Engineer', evidence: 'Full page (SF role)', emphasis: ['multicloud', 'python'],
    objectiveIds: ['obj-m15-03', 'obj-m04-03', 'obj-m14-04'],
    gaps: ['Not a verified DC vacancy; B07 optional'] },
  { id: 'J11', title: 'Pinterest Security GRC Analyst (historical)', evidence: 'Historical', emphasis: ['security'],
    objectiveIds: ['obj-m13-03'],
    gaps: ['A full GRC track is outside the core (B08 optional)'] },
  { id: 'JX', title: 'Unmapped cleared opportunity (historical mention)', evidence: 'Insufficient', emphasis: [], objectiveIds: [], gaps: ['Unmapped until a description is available'] }
];
