/* Anduril Round 1 prep — timed mock interviews.

   MA (core, 60 min): Terraform emphasis. MB (optional, 60 min): mixed.
   MS (optional, 45 min): scripting-only replacement for the "and/or" case.

   Mock mode turns off this app's hints, reference answers, solution code
   and AI help until you submit or deliberately abandon. Documentation
   (Terraform Registry, AWS docs, man pages) is allowed, as in the real
   round. The app cannot see other windows, so independence is a
   self-attestation, recorded as such. Invented practice — not real
   Anduril questions. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };

(function () {
  function K() { return LX.ar1TfKit; }

  var DOCS = [
    { t: 'Terraform Registry: AWS provider', u: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs' },
    { t: 'Terraform language documentation', u: 'https://developer.hashicorp.com/terraform/language' },
    { t: 'Amazon VPC User Guide', u: 'https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html' },
    { t: 'GNU Bash manual', u: 'https://www.gnu.org/software/bash/manual/bash.html' },
    { t: 'jq manual', u: 'https://jqlang.org/manual/' }
  ];

  var CLARIFY = [
    'Which Region, and is there an existing VPC or am I creating everything?',
    'Who must reach the service, on which ports, and from where (anywhere, a partner range, another tier)?',
    'Is SSH needed at all, and from where? Is Session Manager an option?',
    'Do you want me to apply this, or is plan/validate enough? Is there an account I can use?',
    'Which outputs matter to you (IDs, IPs, a URL)?',
    'Any constraints on the AMI, instance size, or tagging?',
    'For scripting: which language and shell can I use, and what environment does it run in?'
  ];

  var RUBRIC_BANDS = [
    { id: 'guided', label: 'Needs guided practice', test: 'Under 50%, any critical finding, or the core task not working.' },
    { id: 'refs', label: 'Can solve with references', test: '50–79%, or 80%+ but with hints, solution viewing or outside help during the attempt.' },
    { id: 'independent', label: 'Independent on this exercise', test: '80%+, core task checks passing, no critical findings, and you attest the attempt was independent.' }
  ];
  var LEVELS = ['0 — not shown', '1 — fragments, needed rescue', '2 — partly, with gaps or errors', '3 — solid, minor gaps', '4 — clear, correct, unprompted'];

  var NET_FOLLOWUPS = [
    { q: 'Your instance is up, the security group allows 443, but `curl https://<ip>` from your laptop times out. Walk through what you check, in order.', a: 'Reproduce from the right vantage point; check the instance has a public IP; the subnet\'s effective route table (explicit association, else main) has 0.0.0.0/0 → IGW; the security group ingress from my source; the NACL both directions including the ephemeral return range; flow logs for ACCEPT/REJECT; then on the host whether anything listens on 443 (`ss -ltn`). A refusal instead of a timeout would point at the service.', points: ['Vantage point', 'Public IP + route + association', 'SG and NACL incl. return path', 'Flow logs as evidence', 'Listener check; timeout vs refused'] },
    { q: 'How would the design change if this instance must not have a public IP but still needs to download packages?', a: 'Move it to a private subnet whose default route points at a NAT gateway in a public subnet (with an Elastic IP); keep egress 443 in the security group; for S3/DynamoDB a gateway endpoint avoids NAT processing charges; access via a load balancer or Session Manager instead of SSH.', points: ['Private subnet + NAT in public subnet', 'Route table change', 'Endpoint option for AWS services', 'How users/operators reach it now'] },
    { q: 'A teammate adds a NACL allowing inbound 443 and outbound 443. Users now time out. Explain why and fix it.', a: 'NACLs are stateless; replies leave from 443 to the client\'s ephemeral port, which no outbound rule allows. Add an outbound allow for the ephemeral range (1024–65535 to cover all clients, or 49152–65535 / 32768–60999 if the clients are known) before the implicit deny.', points: ['Stateless', 'Ephemeral destination port', 'Concrete rule', 'Rule ordering'] },
    { q: 'What does `terraform validate` passing tell you, and what would you still need to check before calling this done?', a: 'Only that the configuration is well-formed against the provider schema. Still: plan with credentials (AMI lookup, quotas, conflicts), apply in a sandbox if allowed, then test the actual traffic (curl/nc from outside, ss on the host), and check that nothing is broader than required.', points: ['Schema-level only', 'Plan needs credentials', 'Behaviour must be tested', 'Least privilege review'] },
    { q: 'DNS for the service name returns NXDOMAIN for some users right after you created the record. What is happening and how do you prove it?', a: 'Negative caching: resolvers that looked the name up before it existed cache NXDOMAIN for the SOA-derived negative TTL. Prove it by querying the authoritative servers directly (`dig @ns … +norecurse`) — the record is there — and comparing with the resolver\'s answer and remaining TTL.', points: ['Negative caching', 'SOA minimum / negative TTL', 'Query authoritative directly', 'Wait or flush, don\'t change the record'] },
    { q: 'TCP connects to 443 but the client reports a certificate error. Would changing security groups help? What do you check?', a: 'No — the network path works (the handshake completed). Check the certificate the server presents (`openssl s_client -connect host:443 -servername name`): subject alternative names, expiry, chain/trust, and whether the client used the right hostname (SNI).', points: ['Network path is proven', 'Inspect presented cert', 'SAN / expiry / chain / SNI'] }
  ];

  LX.ar1Mocks = [
    {
      id: 'MA', title: 'Mock A — Terraform emphasis', mins: 60, core: true,
      intro: 'One timed hour shaped like the confirmed format: an engineer on a call, a Terraform task that may start from an empty file, and networking follow-ups. Speak your reasoning aloud the whole time — record yourself if you can.',
      phases: [
        { id: 'clarify', kind: 'clarify', title: 'Clarify the requirements', mins: 5, prompt: 'The "interviewer" says: "We need a small public status page on AWS. Can you write the Terraform for it?" Write the questions you would ask before typing. Then read the clarified requirements on the next phase.' },
        { id: 'tf', kind: 'tf', title: 'Blank-editor Terraform', mins: 35, files: ['main.tf', 'variables.tf', 'outputs.tf'],
          prompt: 'Clarified requirements:\n\n- New VPC **10.60.0.0/16**, one public subnet, internet access.\n- One EC2 instance (t3.micro, current Amazon Linux) serving the status page.\n- **HTTP (80) and HTTPS (443) from anywhere**; **SSH only from an `admin_cidr` variable**; nothing else inbound.\n- Pin the AWS provider; no credentials in files.\n- Outputs: **instance ID** and **public IP**.\n- Validate is enough; no apply.',
          checks: function () { var k = K(), C = k.C, I = k.I; return [C.pinned, C.noSecrets, C.vpc('10.60.0.0/16'), C.subnetInVpc, C.igw, C.publicRoute, C.routeStyle, C.sgInVpc, I.exists, I.publicIp, k.ingress(80, 'world', 'HTTP (80) from anywhere'), k.ingress(443, 'world', 'HTTPS (443) from anywhere'), k.ingress(22, 'var', 'SSH only from the admin range'), k.noExtraWorld([80, 443]), C.egress, C.sgStyle, C.noWorldAdmin, k.outputs([k.OUT.instanceId, k.OUT.publicIp]), I.ami, I.service, I.imds('advice')]; },
          solution: 'MA/reference' },
        { id: 'net', kind: 'net', title: 'Network troubleshooting follow-ups', mins: 15, questions: [0, 2, 1], prompt: 'Answer each out loud first (about 4–5 minutes each), then write the key points.' },
        { id: 'explain', kind: 'explain', title: 'Explain your decisions', mins: 5, prompt: 'Without looking at notes: explain the three decisions in your Terraform you would defend hardest, and one thing you would change with more time.' }
      ],
      rubric: [
        { id: 'net', label: 'Networking reasoning', weight: 35 },
        { id: 'tf', label: 'Terraform implementation', weight: 35 },
        { id: 'verify', label: 'Verification and troubleshooting', weight: 15 },
        { id: 'comm', label: 'Communication', weight: 10 },
        { id: 'clarify', label: 'Requirement clarification', weight: 5 }
      ]
    },
    {
      id: 'MB', title: 'Mock B — mixed: Terraform, Bash and networking', mins: 60, optional: true,
      intro: 'A second, different hour: a shorter Terraform build, a Bash task on your Mac against local fixtures, and networking questions. Use it after Mock A, or instead of a repeat of it.',
      phases: [
        { id: 'clarify', kind: 'clarify', title: 'Clarify the requirements', mins: 5, prompt: 'The "interviewer" says: "Lay out the network and security groups for an app tier and a database tier. Then we\'ll do a quick script." Write your questions.' },
        { id: 'tf', kind: 'tf', title: 'Terraform: two tiers', mins: 25, files: ['main.tf', 'variables.tf', 'outputs.tf'],
          prompt: 'Clarified requirements:\n\n- VPC **10.70.0.0/16**; an **app subnet** with internet access and a **db subnet with no route to the internet**.\n- App security group: **HTTPS from anywhere**.\n- DB security group: **PostgreSQL (5432) only from the app security group** (reference the group, not a CIDR).\n- No instances needed. Pin the provider.\n- Outputs: both **security group IDs** and the **db subnet ID**.',
          checks: function () {
            var k = K(), C = k.C, H = window.LXHcl;
            return [C.pinned, C.noSecrets, C.vpc('10.70.0.0/16'), C.subnetInVpc, C.igw, C.publicRoute, C.routeStyle, C.sgInVpc, C.sgStyle, C.noWorldAdmin,
              { id: 'dbsubnet', label: 'A db subnet with no route to the internet', hint: 'Its route table (explicit or main) has no 0.0.0.0/0.',
                test: function (M) { var subs = M.all('aws_subnet').filter(function (s) { var d = M.defaultRoute(M.rtFor(s).rt); return !d; }); return subs.length ? true : 'every subnet has a default route — the db subnet should not'; } },
              k.ingress(443, 'world', 'App: HTTPS from anywhere'),
              { id: 'in5432', label: 'DB: 5432 only from the app security group', hint: 'aws_vpc_security_group_ingress_rule with referenced_security_group_id.',
                test: function (M) { var rules = []; M.all('aws_security_group').forEach(function (sg) { M.sgRules(sg).forEach(function (r) { if (r.dir === 'ingress' && H.covers(r, 5432)) rules.push(r); }); }); if (!rules.length) return 'no ingress covers 5432'; if (rules.some(function (r) { return r.cidrs.length; })) return '5432 is allowed from a CIDR; the requirement is the app group only'; return rules.some(function (r) { return r.sgs.length; }) ? true : '5432 does not reference a security group'; } },
              k.noExtraWorld([443]),
              { id: 'outputs', label: 'Outputs: two security group IDs and the db subnet ID', hint: 'output blocks referencing aws_security_group.<x>.id (twice) and aws_subnet.<db>.id.',
                test: function (M) { var sg = {}, sub = 0; M.outputs.forEach(function (o) { var a = M.ast(o, 'value'); if (!a) return; M.refsOf(a).forEach(function (r) { if (r.kind === 'resource' && r.type === 'aws_security_group' && r.attr === 'id') sg[r.name] = 1; if (r.kind === 'resource' && r.type === 'aws_subnet' && r.attr === 'id') sub++; }); }); var n = Object.keys(sg).length; return n >= 2 && sub ? true : 'found ' + n + ' security group ID output(s) and ' + sub + ' subnet ID output(s)'; } }];
          },
          solution: 'MB/reference' },
        { id: 'bash', kind: 'bash', title: 'Bash: REJECTs per port from flow logs', mins: 15, exercise: 'M1',
          prompt: 'On your Mac, in `labs/anduril-round1/bash/M1-flow-rejects/starter/flow_rejects.sh`: read VPC Flow Log v2 records from FILE, count REJECT records per destination port (busiest first), print a total line, warn about malformed lines on stderr, and exit 0 (no REJECTs) / 1 (some) / 2 (usage or unreadable). Full spec in that folder\'s README. Test with `./run-tests.sh starter M1`.' },
        { id: 'net', kind: 'net', title: 'Networking questions', mins: 10, questions: [3, 4], prompt: 'Answer aloud first, then note the key points.' },
        { id: 'explain', kind: 'explain', title: 'Explain your decisions', mins: 5, prompt: 'Explain why the db tier references the app security group instead of a CIDR, and what your script does with a malformed line and why.' }
      ],
      rubric: [
        { id: 'net', label: 'Networking reasoning', weight: 35 },
        { id: 'tf', label: 'Terraform implementation', weight: 25 },
        { id: 'bash', label: 'Bash implementation', weight: 10 },
        { id: 'verify', label: 'Verification and troubleshooting', weight: 15 },
        { id: 'comm', label: 'Communication', weight: 10 },
        { id: 'clarify', label: 'Requirement clarification', weight: 5 }
      ]
    },
    {
      id: 'MS', title: 'Scripting-only mock (replacement)', mins: 45, optional: true,
      intro: 'For the "and/or" in the recruiter\'s description: if the hour turns out to be a scripting question, this is the rehearsal. Bash on your Mac, local fixtures, no network.',
      phases: [
        { id: 'clarify', kind: 'clarify', title: 'Clarify the requirements', mins: 5, prompt: 'The "interviewer" says: "Write a script that finds security-group rules open to the internet." Write your questions (input source, which ports are acceptable, output format, exit status, language).' },
        { id: 'bash', kind: 'bash', title: 'Bash + jq: internet-open ingress', mins: 25, exercise: 'M2',
          prompt: 'In `labs/anduril-round1/bash/M2-open-ingress/starter/open_ingress.sh`: read `aws ec2 describe-security-groups` JSON from a file or stdin and report every ingress permission open to 0.0.0.0/0 or ::/0 other than exactly TCP 80 or TCP 443, then a summary line. Handle empty/invalid/wrong-shaped input with exit 2. Full spec in that folder\'s README. Test with `./run-tests.sh starter M2`.' },
        { id: 'net', kind: 'net', title: 'Networking follow-ups', mins: 10, questions: [2, 5], prompt: 'Answer aloud, then note the key points.' },
        { id: 'explain', kind: 'explain', title: 'Explain your script', mins: 5, prompt: 'Walk through your script: how it fails safely on bad input, why the exit codes are what they are, and one limitation.' }
      ],
      rubric: [
        { id: 'net', label: 'Networking reasoning', weight: 35 },
        { id: 'bash', label: 'Bash implementation', weight: 35 },
        { id: 'verify', label: 'Verification and troubleshooting', weight: 15 },
        { id: 'comm', label: 'Communication', weight: 10 },
        { id: 'clarify', label: 'Requirement clarification', weight: 5 }
      ]
    }
  ];

  LX.ar1MockKit = {
    docs: DOCS, clarify: CLARIFY, followups: NET_FOLLOWUPS, bands: RUBRIC_BANDS, levels: LEVELS,
    attest: 'I did this attempt without AI assistance and without looking at this app\'s solutions or hints; I used only documentation (Terraform Registry, AWS docs, man pages).',
    rules: [
      'Hints, reference answers, solutions and the app\'s help are hidden until you submit or abandon.',
      'Documentation is allowed: open the links below in another tab, as in the real round.',
      'Talk out loud. Record yourself if you can — communication is scored.',
      'The timer keeps running if you refresh or leave; your draft is saved as you type.',
      'Restarting a mock starts a new, separately recorded attempt.'
    ]
  };
})();
