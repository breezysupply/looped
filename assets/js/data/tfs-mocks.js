/* Terraform + AWS tech screen — mock screens (Module 7), the 60-minute
   rehearsal wrapper and Module 8 readiness material.

   Mocks are representative practice, not known Anduril questions, and this
   app does not reproduce HackerRank. Each mock: a candidate brief, stated
   assumptions and allowed resources, a core checklist (practice checks), an
   optional minute-25 extension graded separately, interviewer-only
   clarification answers (revealed on request), timeline cues, six follow-up
   questions with scoring guidance, a reference implementation with an
   annotated review, at least two seeded variants that change requirements,
   and the 100-point rubric split into automatically checked and
   self-assessed points. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };

(function () {
  function K() { return LX.tfsKit.C; }
  function c(id, label, test, extra) { var o = { id: id, label: label, test: test, sev: 'required', cat: 'references', dim: 'hcl' }; for (var k in extra || {}) o[k] = extra[k]; return o; }
  function urlOut(port) { return c('url', 'URL output from the public IP' + (port ? ' with the port' : ''), function (M) { return M.outputs.some(function (o) { var a = M.ast(o, 'value'); return a && a.t === 'tpl' && M.refsOf(a).some(function (r) { return r.type === 'aws_instance' && /public_(ip|dns)/.test(r.attr || ''); }) && (!port || /port|8080/.test(o.attrs.value.raw)); }) ? true : 'no URL output built from the instance\'s public address' + (port ? ' and port' : ''); }); }
  function subOut() { return c('subout', 'Outputs for both subnet IDs', function (M) { var n = {}; M.outputs.forEach(function (o) { var a = M.ast(o, 'value'); if (a) M.refsOf(a).forEach(function (r) { if (r.type === 'aws_subnet' && r.attr === 'id') n[r.name] = 1; }); }); return Object.keys(n).length >= 2 ? true : 'expected outputs for both subnet IDs'; }); }
  var REFS = c('refs', 'Every reference points at something declared', function (M) { var d = M.dangling(); return d.length ? 'undeclared: ' + d.join('; ') : true; });

  var TIMELINE = [
    { at: 0, label: 'Clarify', text: 'Restate the goal; ask about Region, inputs, outputs, access, and whether you apply. Write the answers down.' },
    { at: 5, label: 'Outline', text: 'List the resources and the reference each one needs, in a comment block, before typing HCL.' },
    { at: 8, label: 'Implement', text: 'Network first, then security, then compute, then outputs. Say what you are doing.' },
    { at: 25, label: 'Change request', text: 'The interviewer adds an optional change. Finish the core first unless the core is done.' },
    { at: 33, label: 'Verify', text: 'Read every reference aloud; check routes, associations, rules and outputs against the brief; say which commands you would run.' },
    { at: 40, label: 'Explain', text: 'Walk the traffic path and name two tradeoffs and what you would change for production.' }
  ];
  var MANUAL_COMMON = [
    { id: 'm-hcl', dim: 'hcl', pts: 4, label: 'Readable code: clear names, no copy-paste duplication, one rule style' },
    { id: 'm-ver1', dim: 'verify', pts: 5, label: 'Described how to verify after apply (curl / console output / route and rule evidence)' },
    { id: 'm-ver2', dim: 'verify', pts: 5, label: 'Recovered from a mistake methodically (read the error\'s file and line, checked the docs)' },
    { id: 'm-ver3', dim: 'verify', pts: 5, label: 'Stated what fmt, validate and plan do and do not prove' },
    { id: 'm-com1', dim: 'comm', pts: 4, label: 'Clarified requirements before writing code' },
    { id: 'm-com2', dim: 'comm', pts: 3, label: 'Narrated decisions and tradeoffs while working' },
    { id: 'm-com3', dim: 'comm', pts: 3, label: 'Handled the change request or a question collaboratively' }
  ];

  LX.tfsMockTimeline = TIMELINE;

  LX.tfsMocks = [
    {
      id: 'A', title: 'Mock A: public service from zero', mins: 45, review: 10,
      brief: 'Write Terraform, from empty files, for a small public web service:\n\n- A VPC and one public subnet; Region and CIDRs configurable through variables.\n- An internet gateway, a route table with a default IPv4 route to it, and an explicit association.\n- A security group allowing HTTP to the service, and the outbound access the bootstrap needs.\n- One EC2 instance running a web server, reachable on the service port, with a public IPv4 address.\n- Useful outputs.\n\nExplain your design as you go. You do not need to apply anything.',
      assumptions: ['No AWS account is available during the exercise; reason about apply rather than running it.', 'Amazon Linux 2023 on x86_64 is acceptable.', 'Plain HTTP is acceptable for the exercise.'],
      allowed: 'Terraform AWS provider resources and data sources. Documentation allowed for practice; confirm actual interview rules. No AI assistance.',
      clarify: [
        { q: 'Which Region?', a: 'Your choice — make it a variable. us-east-1 is fine as the default.' },
        { q: 'Which CIDRs?', a: 'Use the variant\'s values as defaults, but keep them as variables.' },
        { q: 'Do you need HTTPS?', a: 'HTTP is fine for this exercise. Mention what you would do for TLS in production.' },
        { q: 'Should there be SSH access?', a: 'No administrative access is required.' },
        { q: 'Should I run terraform apply?', a: 'No. Talk through how you would validate and verify.' },
        { q: 'Which image?', a: 'Any current Amazon Linux 2023 x86_64 image; do not paste an AMI ID from memory.' },
        { q: 'What outputs do you want?', a: 'The instance ID and a URL I can open.' }
      ],
      extension: { at: 25, prompt: 'Change request: the security team wants HTTP limited to a source range they will provide (for example 198.51.100.0/24). Make it configurable without editing resources.',
        checks: function () { return [c('ext', 'HTTP source comes from a variable', function (M) { var ok = false; M.all('aws_security_group').forEach(function (g) { M.sgRules(g).forEach(function (r) { if (r.dir === 'ingress' && (window.LXHcl.covers(r, 80) || window.LXHcl.covers(r, 8080))) { var a = M.ast(r.block, r.style === 'inline' ? 'cidr_blocks' : 'cidr_ipv4'); if (a && M.refsOf(a).some(function (x) { return x.kind === 'var'; })) ok = true; } }); }); return ok ? true : 'the HTTP ingress source is not taken from a variable'; }, { cat: 'security', dim: 'netsec' })]; } },
      variants: {
        v1: { label: 'Variant 1: port 80, 10.60.0.0/16', seed: 'VPC 10.60.0.0/16, public subnet 10.60.1.0/24, web server on TCP 80, HTTP open to the internet.', solution: 'mock-a/v1-reference',
          auto: function () { var C = K(); return [
            { dim: 'core', pts: 6, check: C.publicRoute }, { dim: 'core', pts: 3, check: C.igw }, { dim: 'core', pts: 3, check: C.subnets(['10.60.1.0/24']) }, { dim: 'core', pts: 6, check: C.webInstance }, { dim: 'core', pts: 3, check: C.userData }, { dim: 'core', pts: 3, check: C.sgInVpc },
            { dim: 'netsec', pts: 4, check: C.ingressPort(80, 'world') }, { dim: 'netsec', pts: 4, check: C.webEgress }, { dim: 'netsec', pts: 5, check: C.noWorldAdmin },
            { dim: 'hcl', pts: 3, check: C.pinned }, { dim: 'hcl', pts: 2, check: C.regionVar }, { dim: 'hcl', pts: 3, check: C.typedVars }, { dim: 'hcl', pts: 2, check: C.vpc('10.60.0.0/16') }, { dim: 'hcl', pts: 2, check: C.outputsRef([{ label: 'instance ID', attrs: [['aws_instance', 'id']] }], 'idout') }, { dim: 'hcl', pts: 2, check: urlOut() }, { dim: 'hcl', pts: 2, check: REFS }]; } },
        v2: { label: 'Variant 2: app on 8080, office-only, us-west-2', seed: 'Region us-west-2; VPC 172.16.0.0/16, public subnet 172.16.8.0/24; the app listens on TCP 8080 and must be reachable only from an office range given as a variable (default 198.51.100.0/24) from the start; the URL output includes the port.', solution: 'mock-a/v2-reference',
          auto: function () { var C = K(); return [
            { dim: 'core', pts: 6, check: C.publicRoute }, { dim: 'core', pts: 3, check: C.igw }, { dim: 'core', pts: 3, check: C.subnets(['172.16.8.0/24']) }, { dim: 'core', pts: 6, check: C.webInstance }, { dim: 'core', pts: 3, check: C.userData }, { dim: 'core', pts: 3, check: C.sgInVpc },
            { dim: 'netsec', pts: 4, check: C.ingressPort(8080, 'var', 'Ingress TCP 8080 only from the office range variable') }, { dim: 'netsec', pts: 4, check: C.webEgress }, { dim: 'netsec', pts: 5, check: C.noWorldAdmin },
            { dim: 'hcl', pts: 3, check: C.pinned }, { dim: 'hcl', pts: 2, check: C.regionVar }, { dim: 'hcl', pts: 3, check: C.typedVars }, { dim: 'hcl', pts: 2, check: C.vpc('172.16.0.0/16') }, { dim: 'hcl', pts: 2, check: C.outputsRef([{ label: 'instance ID', attrs: [['aws_instance', 'id']] }], 'idout') }, { dim: 'hcl', pts: 2, check: urlOut(true) }, { dim: 'hcl', pts: 2, check: REFS }]; } }
      },
      manual: [{ id: 'm-core', dim: 'core', pts: 6, label: 'Explained the intended traffic path: browser → public IP → IGW → security group → listener, and the reply', critical: 'Unable to explain the intended traffic path' },
        { id: 'm-ns1', dim: 'netsec', pts: 6, label: 'Justified each rule and what is deliberately not open (no SSH, explicit egress)' },
        { id: 'm-ns2', dim: 'netsec', pts: 6, label: 'Named production gaps: TLS, administration design, a load balancer and private instances' }].concat(MANUAL_COMMON),
      followups: [
        { topic: 'dependencies', q: 'How does Terraform know to create the VPC before the subnet, and where did you need to state a dependency yourself?', strong: 'References create the graph (subnet → VPC). The instance needed depends_on on the route/association because its bootstrap needs internet at first boot and nothing it references waits for the route.', scoring: '2: both halves with the reason · 1: references only · 0: "file order"' },
        { topic: 'failure isolation', q: 'The page times out after apply. Walk me through isolating the cause.', strong: 'Timeout vs refused first. Then association → default route target → public IP → security group ingress → instance console output and service status. One change at a time, same test each time.', scoring: '2: ordered hop-by-hop with evidence · 1: right areas, no order · 0: "open everything"' },
        { topic: 'security', q: 'What did you leave closed, and how would administrators get in?', strong: 'No SSH; explicit egress only. For admin access: Session Manager (agent + instance profile + egress or endpoints), or SSH from a specific admin CIDR via a variable, never 0.0.0.0/0.', scoring: '2: names SSM requirements or a scoped CIDR · 1: "use a bastion" without detail · 0: "open 22"' },
        { topic: 'state', q: 'Where would state live for a team, and what is sensitive in it?', strong: 'Remote backend with encryption, access control and locking; state holds every attribute providers return, including secrets in plain text; never commit it; commit the lock file.', scoring: '2: backend + sensitivity + locking · 1: "remote state" only · 0: "in git"' },
        { topic: 'verification', q: 'Without an AWS account right now, how much can you verify, and what would you do with one?', strong: 'Locally: fmt, init, validate (static). With credentials: plan and read it; apply in a sandbox; curl the URL, check console output; destroy and confirm nothing billable remains.', scoring: '2: separates static from live checks and includes cleanup · 1: one side only · 0: "it validates so it works"' },
        { topic: 'tradeoffs', q: 'How would this look in production?', strong: 'ALB in two AZs with TLS (ACM), private instances in an Auto Scaling group, NAT or endpoints for egress, logs/metrics, tagging and cost awareness.', scoring: '2: multi-AZ + TLS + private instances · 1: one or two of these · 0: "bigger instance"' }
      ],
      reviewText: 'The reference keeps every value that might change in a typed variable; the network is VPC → subnet → IGW → route table → route → association; the security group has one ingress rule (HTTP) and one egress rule (HTTPS for dnf); the instance has a looked-up AMI that matches t3.micro, an explicit public IP, user data that starts nginx and a single narrow depends_on. Common losses: a missing association (critical), no egress (the port answers "refused"), a hard-coded AMI ID, quoted references, and outputs that are strings instead of references.'
    },
    {
      id: 'B', title: 'Mock B: private worker from zero', mins: 45, review: 10,
      brief: 'Write Terraform, from empty files, for a background worker that must reach the internet but never be reachable from it:\n\n- A VPC with a public subnet and a private subnet.\n- An internet gateway, a NAT gateway with an Elastic IP, and route tables with the right default routes and explicit associations.\n- One EC2 worker in the private subnet with no public IP, no inbound access from the internet, and the outbound access it needs.\n- Tags and useful outputs.\n\nExplain your design as you go. You do not need to apply anything.',
      assumptions: ['No AWS account is available during the exercise.', 'A single AZ is acceptable for the core.', 'The worker calls HTTPS endpoints on the internet and installs packages at boot.'],
      allowed: 'Terraform AWS provider resources and data sources. Documentation allowed for practice; confirm actual interview rules. No AI assistance.',
      clarify: [
        { q: 'Does anything need to reach the worker?', a: 'No. It only makes outbound calls.' },
        { q: 'What does it call?', a: 'HTTPS APIs on the internet, and the OS package repositories at boot.' },
        { q: 'High availability?', a: 'One AZ is fine for the exercise; be ready to talk about more.' },
        { q: 'Which Region and CIDRs?', a: 'Variables with the variant\'s defaults.' },
        { q: 'Tags?', a: 'A project tag and managed_by on everything you can.' },
        { q: 'Outputs?', a: 'Both subnet IDs, the worker\'s private IP and the NAT gateway ID.' }
      ],
      extension: { at: 25, prompt: 'Change request (discussion is enough): how does the design change if the worker must survive the loss of one Availability Zone? You may code it, but a correct explanation satisfies this.',
        manualOnly: true, points: ['Private (and public) subnets in two AZs', 'One NAT gateway per AZ in that AZ\'s public subnet', 'One private route table per AZ pointing at the local NAT', 'Workers spread across AZs (e.g. an Auto Scaling group)', 'Cost: a second NAT gateway and its public IPv4'] },
      variants: {
        v1: { label: 'Variant 1: 10.70.0.0/16, HTTPS egress', seed: 'VPC 10.70.0.0/16, public 10.70.0.0/24, private 10.70.10.0/24; worker egress HTTPS to anywhere.', solution: 'mock-b/v1-reference',
          auto: function () { var C = K(); return [
            { dim: 'core', pts: 4, check: C.publicRoute }, { dim: 'core', pts: 5, check: C.natPublic }, { dim: 'core', pts: 6, check: C.privateRoute }, { dim: 'core', pts: 3, check: C.eip }, { dim: 'core', pts: 3, check: C.subnets(['10.70.0.0/24', '10.70.10.0/24']) }, { dim: 'core', pts: 3, check: C.bootDep('required') },
            { dim: 'netsec', pts: 5, check: C.workerPrivate }, { dim: 'netsec', pts: 4, check: C.workerNoIngress }, { dim: 'netsec', pts: 4, check: C.workerEgress },
            { dim: 'hcl', pts: 3, check: C.pinned }, { dim: 'hcl', pts: 2, check: C.regionVar }, { dim: 'hcl', pts: 3, check: C.typedVars }, { dim: 'hcl', pts: 2, check: subOut() }, { dim: 'hcl', pts: 3, check: C.outputsRef([{ label: 'worker private IP', attrs: [['aws_instance', 'private_ip']] }, { label: 'NAT gateway ID', attrs: [['aws_nat_gateway', 'id']] }], 'wout') }, { dim: 'hcl', pts: 3, check: REFS }]; } },
        v2: { label: 'Variant 2: partner allow-list, 192.168.0.0/16, us-west-2', seed: 'Region us-west-2; VPC 192.168.0.0/16, public 192.168.0.0/24, private 192.168.32.0/24. The worker may call only the partner API range (a variable, default 203.0.113.0/24) on HTTPS, plus the package repositories its bootstrap needs. The partner needs your egress address for their allow-list: output the NAT gateway\'s public IP.', solution: 'mock-b/v2-reference',
          auto: function () { var C = K(); return [
            { dim: 'core', pts: 4, check: C.publicRoute }, { dim: 'core', pts: 5, check: C.natPublic }, { dim: 'core', pts: 6, check: C.privateRoute }, { dim: 'core', pts: 3, check: C.eip }, { dim: 'core', pts: 3, check: C.subnets(['192.168.0.0/24', '192.168.32.0/24']) }, { dim: 'core', pts: 3, check: C.bootDep('required') },
            { dim: 'netsec', pts: 5, check: C.workerPrivate }, { dim: 'netsec', pts: 4, check: C.workerNoIngress },
            { dim: 'netsec', pts: 4, check: c('partner', 'Worker egress to the partner range comes from a variable', function (M) { var ok = false; LX.tfsKit.workers(M).forEach(function (w) { M.sgsOf(w).forEach(function (g) { M.sgRules(g).forEach(function (r) { if (r.dir === 'egress' && window.LXHcl.covers(r, 443)) { var a = M.ast(r.block, r.style === 'inline' ? 'cidr_blocks' : 'cidr_ipv4'); if (a && M.refsOf(a).some(function (x) { return x.kind === 'var' && /partner/.test(x.name); })) ok = true; } }); }); }); return ok ? true : 'no egress rule whose destination is the partner range variable'; }, { cat: 'security', dim: 'netsec' }) },
            { dim: 'hcl', pts: 3, check: C.pinned }, { dim: 'hcl', pts: 2, check: C.regionVar }, { dim: 'hcl', pts: 2, check: C.typedVars }, { dim: 'hcl', pts: 2, check: subOut() },
            { dim: 'hcl', pts: 4, check: C.outputsRef([{ label: 'worker private IP', attrs: [['aws_instance', 'private_ip']] }, { label: 'NAT gateway ID', attrs: [['aws_nat_gateway', 'id']] }, { label: 'NAT public IP', attrs: [['aws_eip', 'public_ip'], ['aws_nat_gateway', 'public_ip']] }], 'wout') }, { dim: 'hcl', pts: 3, check: REFS }]; } }
      },
      manual: [{ id: 'm-core', dim: 'core', pts: 6, label: 'Explained the outbound path and the reply through the NAT translation', critical: 'Unable to explain the intended traffic path' },
        { id: 'm-ns1', dim: 'netsec', pts: 6, label: 'Explained why the worker is unreachable (no public IP, NAT only returns replies, no ingress)' },
        { id: 'm-ns2', dim: 'netsec', pts: 6, label: 'Named the single-NAT tradeoff and alternatives (per-AZ NAT, endpoints)' }].concat(MANUAL_COMMON),
      followups: [
        { topic: 'dependencies', q: 'Which dependencies did Terraform infer, and which did you state?', strong: 'Inferred from references (subnets → VPC, NAT → EIP and subnet, routes → tables). Stated: NAT depends_on IGW; worker depends_on the private route and association because the bootstrap needs egress at first boot.', scoring: '2: both with reasons · 1: inferred only · 0: unclear' },
        { topic: 'failure isolation', q: 'The worker cannot reach the internet. How do you narrow it down?', strong: 'Private subnet association → its default route → NAT gateway state and subnet → public table route to the IGW → worker SG egress → console output of the bootstrap. A public IP on the worker or an IGW route in the private table are red flags.', scoring: '2: ordered hops with evidence · 1: partial · 0: "add a public IP"' },
        { topic: 'security', q: 'Why does the worker need no inbound rule, and what would make it exposed?', strong: 'Security groups are stateful; replies to its own connections return automatically. Exposure would come from a public IP plus an IGW route plus an ingress rule — so keep all three out.', scoring: '2: stateful + exposure conditions · 1: one of them · 0: thinks replies need ingress' },
        { topic: 'state', q: 'You need to rename the NAT gateway resource in code. What happens and what do you do?', strong: 'The address changes, so the plan would destroy and recreate it (and its egress); add a moved block and confirm the plan is a no-op.', scoring: '2: moved block + plan check · 1: knows it would be recreated · 0: "just rename"' },
        { topic: 'verification', q: 'How do you prove the worker has egress without SSH?', strong: 'User-data logs via get-console-output, or SSM if configured; outbound call results in logs; check the NAT gateway metrics; flow logs if enabled.', scoring: '2: evidence without inbound access · 1: one method · 0: "SSH in"' },
        { topic: 'tradeoffs', q: 'What does this cost, and what would you change at scale?', strong: 'NAT gateway hours + per-GB processing + public IPv4 are billed (check current pricing); per-AZ NAT for HA; S3/DynamoDB gateway endpoints to cut NAT data; interface endpoints where they help.', scoring: '2: cost drivers + HA + endpoints · 1: one area · 0: quotes prices as fact without checking' }
      ],
      reviewText: 'The reference is Build 3 with the variant\'s values: public subnet with an IGW route; Elastic IP and NAT gateway in the public subnet with depends_on on the IGW; a private table routing 0.0.0.0/0 with nat_gateway_id, explicitly associated; a worker group with egress only; and a worker with associate_public_ip_address = false that waits for the private route. Common losses: NAT in the private subnet, gateway_id instead of nat_gateway_id, the private association missing, a public IP on the worker, and no explanation of the reply path.'
    }
  ];

  LX.tfsRehearsal = {
    id: 'R60', mins: 60, note: 'Optional. Not counted in the 435-minute plan. Use a mock attempt for the middle 45 minutes; the timer and scoring are the mock\'s.',
    parts: [
      { mins: 5, title: 'Opening', text: 'Introduce yourself using your Module 8 worksheet: current AWS work, one troubleshooting example, why this mission. Out loud, timed.' },
      { mins: 45, title: 'Exercise', text: 'Start Mock A or B (a variant you have not done) in interview mode.' },
      { mins: 10, title: 'Your questions', text: 'Ask your three questions out loud and practise follow-ups.' }
    ]
  };

  LX.tfsReadiness = {
    worksheet: [
      { id: 'w1', label: 'Your current relevant AWS work (2–3 sentences)', hint: 'What you operate, in what kind of environment, and what "isolated" means day to day. Facts only — no claims you could not back up with an example.' },
      { id: 'w2', label: 'One concrete troubleshooting example', hint: 'Situation → what you checked first and why → the evidence → the fix → what changed afterwards. Keep it to about 60 seconds.' },
      { id: 'w3', label: 'Why this deployment mission interests you', hint: 'Specific to the Cloud Deployment Engineer role and what you have read about the work. Avoid generic praise.' }
    ],
    noFabrication: 'Write only what you have done. If something is learning in progress (like Terraform from scratch), say so plainly: "I have been building Terraform from blank files this month; here is what I can do now."',
    questions: [
      'Deployment ownership: Where does a Cloud Deployment Engineer\'s responsibility start and end — from infrastructure code through to the systems running on it — and who do you hand off to?',
      'Recurring constraints: What technical constraints come up again and again in your deployments (connectivity, isolation, approvals, hardware), and how does the team design around them?',
      'First 90 days: What would make someone in this role clearly successful after 90 days, and what does the first month usually involve?'
    ],
    checklist: [
      'Confirm the logistics: Friday, October 30, 2026, 2:30–3:30 p.m. America/New_York; the Zoom link and the HackerRank link.',
      'Complete the NDA if it is still outstanding.',
      'Test Zoom, camera, microphone and the browser you will use for HackerRank; close other meetings.',
      'Close or disable AI coding assistants (editor extensions, chat windows). No AI assistance during the interview.',
      'Confirm the documentation policy at the start ("Is it OK if I open the Terraform Registry?") — practice allowed it; the real rules may differ.',
      'Have a calm clarification line ready for when you are stuck: "Let me say what I\'m seeing and what I think the cause is, then check the docs for this argument."',
      'Water, a notepad for the outline, and the warm-up done by 2:00 p.m. — no new architecture today.'
    ],
    backup: {
      title: 'Backup card: if the question is a programming problem (15 minutes, optional)',
      note: 'Outside the Terraform core. The guide leaves a programming question possible; this card is a refresher, not a second curriculum.',
      sections: [
        { h: 'Approach', items: ['Restate inputs, outputs and edge cases (empty input, malformed lines, missing file) before coding.', 'Write the simplest correct version first; mention complexity only if asked.', 'Test with two or three examples out loud, including an edge case.'] },
        { h: 'Bash reminders', items: ['Quote expansions: "$var", "$@".', 'set -u catches unset variables; set -e is not error handling — check important commands and exit with a meaningful status (0 ok, 1 findings, 2 usage).', 'while IFS= read -r line; do …; done < "$file"', 'Send errors to stderr: echo "error" >&2.'] },
        { h: 'Python reminders', items: ['with open(path) as f: for line in f: …', 'collections.Counter for tallies; dict.get(k, 0) + 1 otherwise.', 'json.load / json.loads; sys.argv or argparse for arguments; sys.exit(code).', 'Guard malformed input with try/except around the parse, and say what you skip.'] },
        { h: 'Practice prompt', items: ['Count ERROR lines per service in a log file of the form "<timestamp> <LEVEL> <service>: <message>", busiest first, with a total; handle an empty or missing file. Do it once in the language you would choose, timed at 15 minutes.'] }
      ]
    }
  };
})();
