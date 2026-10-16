/* Anduril Round 1 prep — path definition: facts, sessions, routes, sources.

   Separates what the recruiter confirmed from what this path invents. Times
   are minutes of required work; optional work is listed separately and never
   counted in the 360-minute sprint or the 180-minute triage route. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };

LX.ar1 = {
  id: 'anduril', version: '1.0', title: 'Anduril Round 1: Networking + AWS Terraform',
  learner: 'Brett Pierce',
  defaultTarget: '2026-10-22',
  targetNote: 'Tentative: the recruiter is submitting you to the hiring manager; if approved, Round 1 could be October 22 or 23, 2026. Not a scheduled appointment — edit the date when it is confirmed.',
  confirmed: [
    'Round 1 is a 60-minute Zoom with an engineer.',
    'The recruiter described an AWS Terraform question and/or a scripting question; Terraform may need to be written from scratch.',
    'Google and the Terraform Registry are allowed. AI may not write your interview code.',
    'Networking was emphasized repeatedly; general networking and Terraform are the priority, Bash is secondary.',
    'The broader stack includes Kubernetes, Helm, CloudWatch (assumed expansion of "CW"), Puppet and Ansible — context, not Round 1 scope.'
  ],
  unknown: [
    'The exact exercise, and whether an AWS apply is required.',
    'Which scripting languages are accepted and what execution environment you get.',
    'How the time is split inside the hour.'
  ],
  invented: 'Every scenario, lab, mock and question in this path is invented practice built from the description above. None of it is a real Anduril interview question.',
  weights: { net: 45, tf: 45, bash: 10 },
  target: 'Training target (not Anduril\'s hiring bar): two independent passes on unfamiliar exercises, correct traffic-path reasoning, and explaining your key decisions without looking at a solution.',

  /* kinds: diag | lesson | exercise | items | scenario | card | tf | bash | mock | review | remediate */
  sessions: [
    { id: 'S1', n: 1, mins: 45, title: 'Diagnostic and networking foundations', why: 'Find out what you already know, then rebuild the packet-level model every later exercise relies on.',
      items: [
        { kind: 'diag', id: 'diag', mins: 8 },
        { kind: 'lesson', id: 'ar1-a-01', mins: 4 }, { kind: 'lesson', id: 'ar1-a-02', mins: 6 },
        { kind: 'lesson', id: 'ar1-a-04', mins: 6 }, { kind: 'lesson', id: 'ar1-a-05', mins: 5 }, { kind: 'lesson', id: 'ar1-a-06', mins: 5 },
        { kind: 'exercise', id: 'X1', mins: 11 }
      ] },
    { id: 'S2', n: 2, mins: 60, title: 'AWS networking and two investigations', why: 'Interviewers probe whether you can find a connectivity fault from evidence instead of guessing; this is where your operations experience pays off.',
      items: [
        { kind: 'review', id: 'recall-S2', mins: 4 },
        { kind: 'lesson', id: 'ar1-a-03', mins: 5 }, { kind: 'lesson', id: 'ar1-a-07', mins: 4 },
        { kind: 'lesson', id: 'ar1-b-01', mins: 5 }, { kind: 'lesson', id: 'ar1-b-02', mins: 5 },
        { kind: 'scenario', id: 'N1', mins: 18 }, { kind: 'scenario', id: 'N2', mins: 19 }
      ] },
    { id: 'S3', n: 3, mins: 60, title: 'Terraform fundamentals and a guided build', why: 'You need to produce working HCL from memory plus the Registry; this session builds the vocabulary and a first network with fading help.',
      items: [
        { kind: 'review', id: 'recall-S3', mins: 3 },
        { kind: 'lesson', id: 'ar1-c-01', mins: 6 }, { kind: 'lesson', id: 'ar1-c-02', mins: 6 }, { kind: 'lesson', id: 'ar1-c-03', mins: 4 }, { kind: 'lesson', id: 'ar1-c-04', mins: 6 },
        { kind: 'tf', id: 'T1', mode: 'practice', mins: 35 }
      ] },
    { id: 'S4', n: 4, mins: 60, title: 'Blank-editor build, then a broken configuration', why: 'The interview may start from an empty file. Building and repairing under a clock is the skill being tested.',
      items: [
        { kind: 'review', id: 'recall-S4', mins: 4 },
        { kind: 'lesson', id: 'ar1-c-05', mins: 3 },
        { kind: 'tf', id: 'T2', mode: 'practice', mins: 35 },
        { kind: 'tf', id: 'T3', mode: 'practice', mins: 18 }
      ] },
    { id: 'S5', n: 5, mins: 30, title: 'Bash for operations', why: 'If the hour turns into a scripting question, you want quoting, exit codes and jq to be automatic.',
      items: [
        { kind: 'lesson', id: 'ar1-d-01', mins: 5 }, { kind: 'lesson', id: 'ar1-d-02', mins: 5 },
        { kind: 'bash', id: 'B1', mins: 20 }
      ] },
    { id: 'S6', n: 6, mins: 60, title: 'Timed mock interview (Terraform emphasis)', why: 'Rehearse the whole hour once, with no hints, before the real one.',
      items: [{ kind: 'mock', id: 'MA', mins: 60 }] },
    { id: 'S7', n: 7, mins: 45, title: 'Review the mock, remediate, transfer', why: 'Turn the mock\'s weakest dimension into practice, then prove it on something you have not seen.',
      items: [
        { kind: 'review', id: 'mock-review', mins: 10 },
        { kind: 'remediate', id: 'remediate', mins: 15 },
        { kind: 'transfer', id: 'transfer', mins: 15 },
        { kind: 'review', id: 'recall-S7', mins: 5 }
      ] }
  ],

  triage: {
    mins: 180,
    label: 'Reduced coverage — not equivalent readiness',
    blocks: [
      { title: 'Diagnostic and networking', mins: 30, items: [{ kind: 'diag', id: 'diag', mins: 8 }, { kind: 'lesson', id: 'ar1-a-02', mins: 5 }, { kind: 'lesson', id: 'ar1-a-06', mins: 5 }, { kind: 'exercise', id: 'X1', mins: 12 }] },
      { title: 'AWS network troubleshooting', mins: 30, items: [{ kind: 'lesson', id: 'ar1-b-01', mins: 5 }, { kind: 'scenario', id: 'N2', mins: 25 }] },
      { title: 'Terraform build', mins: 45, items: [{ kind: 'lesson', id: 'ar1-c-02', mins: 5 }, { kind: 'lesson', id: 'ar1-c-04', mins: 5 }, { kind: 'tf', id: 'T2', mode: 'practice', mins: 35 }] },
      { title: 'Bash', mins: 15, items: [{ kind: 'lesson', id: 'ar1-d-01', mins: 4 }, { kind: 'bash', id: 'B1', mins: 11 }] },
      { title: 'Mock interview', mins: 60, items: [{ kind: 'mock', id: 'MA', mins: 60 }] }
    ],
    skipped: [
      'DNS delegation and negative caching (lesson A3, scenario N4)',
      'Network ACL return traffic and ephemeral ports in AWS (N3) beyond the lesson',
      'The SSH filtering investigation (N1)',
      'Terraform state, guided build T1, repair T3 and the private-subnet variation T4',
      'Bash jq and endpoint-check exercises (B2, B3)',
      'Reviewing the mock and the transfer exercise (session 7)'
    ]
  },

  extra: [
    { kind: 'scenario', id: 'N3', mins: 25, why: 'Stateless filtering and the return path — the most common "it should work" trap.' },
    { kind: 'scenario', id: 'N4', mins: 30, why: 'DNS delegation and negative caching, built from the kind of investigation you have done for real.' },
    { kind: 'card', id: 'N5', mins: 15, why: 'Separates TCP, TLS and HTTP failures quickly.' },
    { kind: 'card', id: 'N6', mins: 15, why: 'A design question: gateway endpoint versus NAT for AWS service access.' },
    { kind: 'tf', id: 'T4', mode: 'practice', mins: 30, why: 'Private subnet with NAT: what is reused and what is added.' },
    { kind: 'tf', id: 'T2', mode: 'interview', variant: 'b', mins: 35, why: 'A second blank-editor variant, unassisted.' },
    { kind: 'bash', id: 'B2', mins: 20, why: 'jq over EC2-shaped JSON.' },
    { kind: 'bash', id: 'B3', mins: 20, why: 'Bounded checks and a meaningful exit status.' },
    { kind: 'mock', id: 'MB', mins: 60, why: 'Mixed format: Terraform, Bash and networking.' },
    { kind: 'mock', id: 'MS', mins: 45, why: 'Scripting-only replacement, for the "and/or" wording.' },
    { kind: 'lesson', id: 'ar1-x-01', mins: 5, why: 'Glossary of the wider stack (Kubernetes, Helm, CloudWatch, Puppet, Ansible) — context only.' }
  ],

  sources: [
    { id: 'AWS-SUBNET', title: 'Amazon VPC: Subnet CIDR blocks (reserved addresses)', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html' },
    { id: 'AWS-RT', title: 'Amazon VPC: Configure route tables', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html' },
    { id: 'AWS-RT-EX', title: 'Amazon VPC: Example routing options', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html' },
    { id: 'AWS-IGW', title: 'Amazon VPC: Enable internet access using an internet gateway', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html' },
    { id: 'AWS-NAT', title: 'Amazon VPC: NAT gateways', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html' },
    { id: 'AWS-NAT-BASICS', title: 'Amazon VPC: NAT gateway basics (ports 1024–65535)', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html' },
    { id: 'AWS-SG', title: 'Amazon VPC: Control traffic using security groups', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html' },
    { id: 'AWS-SG-RULES', title: 'Amazon VPC: Security group rules', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html' },
    { id: 'AWS-NACL', title: 'Amazon VPC: Control subnet traffic with network ACLs', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html' },
    { id: 'AWS-NACL-EPH', title: 'Amazon VPC: Custom network ACLs — ephemeral ports', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html#nacl-ephemeral-ports' },
    { id: 'AWS-FLOW', title: 'Amazon VPC: Logging IP traffic using VPC Flow Logs', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html' },
    { id: 'AWS-FLOW-EX', title: 'Amazon VPC: Flow log record examples', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs-records-examples.html' },
    { id: 'AWS-DNS', title: 'Amazon VPC: Understanding Amazon DNS', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/AmazonDNS-concepts.html' },
    { id: 'AWS-GWEP', title: 'AWS PrivateLink: Gateway endpoints', url: 'https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html' },
    { id: 'AWS-GWEP-S3', title: 'AWS PrivateLink: Gateway endpoints for Amazon S3', url: 'https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html' },
    { id: 'AWS-IFEP', title: 'AWS PrivateLink: Access an AWS service using an interface VPC endpoint', url: 'https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html' },
    { id: 'AWS-EC2-IP', title: 'Amazon EC2: Instance IP addressing', url: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-instance-addressing.html' },
    { id: 'AWS-R53-SUB', title: 'Route 53: Creating a subdomain without migrating the parent domain', url: 'https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingNewSubdomain.html' },
    { id: 'AWS-REACH', title: 'VPC Reachability Analyzer', url: 'https://docs.aws.amazon.com/vpc/latest/reachability/what-is-reachability-analyzer.html' },
    { id: 'RFC-9293', title: 'RFC 9293: Transmission Control Protocol (TCP)', url: 'https://www.rfc-editor.org/rfc/rfc9293' },
    { id: 'RFC-7766', title: 'RFC 7766: DNS Transport over TCP', url: 'https://www.rfc-editor.org/rfc/rfc7766' },
    { id: 'RFC-2308', title: 'RFC 2308: Negative Caching of DNS Queries', url: 'https://www.rfc-editor.org/rfc/rfc2308' },
    { id: 'RFC-1918', title: 'RFC 1918: Address Allocation for Private Internets', url: 'https://www.rfc-editor.org/rfc/rfc1918' },
    { id: 'RFC-5737', title: 'RFC 5737: IPv4 Address Blocks Reserved for Documentation', url: 'https://www.rfc-editor.org/rfc/rfc5737' },
    { id: 'RFC-8446', title: 'RFC 8446: TLS 1.3', url: 'https://www.rfc-editor.org/rfc/rfc8446' },
    { id: 'TF-LANG', title: 'Terraform language documentation', url: 'https://developer.hashicorp.com/terraform/language' },
    { id: 'TF-REFS', title: 'Terraform: References to values', url: 'https://developer.hashicorp.com/terraform/language/expressions/references' },
    { id: 'TF-VARS', title: 'Terraform: Input variables', url: 'https://developer.hashicorp.com/terraform/language/values/variables' },
    { id: 'TF-OUT', title: 'Terraform: Output values', url: 'https://developer.hashicorp.com/terraform/language/values/outputs' },
    { id: 'TF-DEPS', title: 'Terraform: depends_on', url: 'https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on' },
    { id: 'TF-REQ', title: 'Terraform: Provider requirements', url: 'https://developer.hashicorp.com/terraform/language/providers/requirements' },
    { id: 'TF-LOCK', title: 'Terraform: Dependency lock file', url: 'https://developer.hashicorp.com/terraform/language/files/dependency-lock' },
    { id: 'TF-STATE', title: 'Terraform: State', url: 'https://developer.hashicorp.com/terraform/language/state' },
    { id: 'TF-STATE-SENS', title: 'Terraform: Sensitive data in state', url: 'https://developer.hashicorp.com/terraform/language/state/sensitive-data' },
    { id: 'TF-INIT', title: 'Terraform CLI: init', url: 'https://developer.hashicorp.com/terraform/cli/commands/init' },
    { id: 'TF-FMT', title: 'Terraform CLI: fmt', url: 'https://developer.hashicorp.com/terraform/cli/commands/fmt' },
    { id: 'TF-VALIDATE', title: 'Terraform CLI: validate', url: 'https://developer.hashicorp.com/terraform/cli/commands/validate' },
    { id: 'TF-PLAN', title: 'Terraform CLI: plan', url: 'https://developer.hashicorp.com/terraform/cli/commands/plan' },
    { id: 'REG-AWS', title: 'Terraform Registry: AWS provider docs', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs' },
    { id: 'REG-VPC', title: 'Registry: aws_vpc', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc' },
    { id: 'REG-SG', title: 'Registry: aws_security_group (note on default egress and in-line rules)', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group' },
    { id: 'REG-SGIN', title: 'Registry: aws_vpc_security_group_ingress_rule', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_ingress_rule' },
    { id: 'REG-NAT', title: 'Registry: aws_nat_gateway', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/nat_gateway' },
    { id: 'REG-AMI', title: 'Registry: aws_ami data source', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/ami' },
    { id: 'BASH', title: 'GNU Bash Reference Manual', url: 'https://www.gnu.org/software/bash/manual/bash.html' },
    { id: 'JQ', title: 'jq 1.8 Manual', url: 'https://jqlang.org/manual/' }
  ],
  sourcesAccessed: '2026-10-16',
  sourcesNote: 'Each link was fetched on 2026-10-16 and its page title checked (AWS pages that silently redirect to the guide home were replaced). Terraform Registry pages are single-page apps; their content was checked against the provider\'s v6.60.0 documentation source, and every argument the labs use was confirmed in the schema of hashicorp/aws 6.69.1 (the version `~> 6.60` resolved to on 2026-10-16).'
};
(LX.ar1.sources || []).forEach(function (s) { s.accessed = s.accessed || LX.ar1.sourcesAccessed; s.status = s.status || 'verified'; });
