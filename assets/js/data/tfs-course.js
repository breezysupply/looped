/* Terraform + AWS: From Guided Builds to Live Tech Screen — course definition.

   Modules, paths (full 435 min, minimum 305 min, self-paced), the nine-day
   schedule, execution modes, the practice rubric and sources. Minutes are
   required work; optional rebuilds, the stretch lab and the 60-minute
   rehearsal wrapper are listed separately and never counted. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };

LX.tfs = {
  id: 'terraform-aws-tech-screen', track: 'tfaws', version: '1.0',
  title: 'Terraform + AWS: From Guided Builds to Live Tech Screen',
  learner: 'Brett',
  learnerNote: 'You know AWS from operating it; this course assumes no Terraform. New Terraform ideas are explained plainly and tied to the AWS objects you already run.',
  outcome: 'Given an AWS requirement, clarify it, outline the resources and how they connect, write coherent Terraform, read errors and plan output, explain the networking and security choices, and talk through validation and cleanup — within 45 minutes.',
  interview: {
    date: '2026-10-30', start: '14:30', end: '15:30', tz: 'America/New_York',
    role: 'Cloud Deployment Engineer',
    format: [
      '5–10 minutes: introductions and why Anduril.',
      '40–45 minutes: live technical coding/scripting in HackerRank. Likely Terraform + AWS if Terraform is on your resume; a programming question is still possible.',
      '5–10 minutes: your questions.'
    ],
    evaluation: ['Structured problem solving', 'The final solution', 'Communication', 'Collaboration', 'Real-world experience'],
    rules: 'No AI assistance during the interview. An earlier recruiter note said Google and the Terraform Registry were allowed; the written guide does not confirm it.',
    docsLabel: 'Documentation allowed for practice; confirm actual interview rules.',
    disclaimer: 'Every exercise here is representative practice written for this course — not a known Anduril question. This app does not reproduce HackerRank or its grading.'
  },
  budget: 'Your usual study time is 3–4 hours a week. This sprint asks for more than that for nine days; the minimum path exists for when that is not possible.',

  /* kinds: lesson | diag | lab | quiz | oral | faults | plan | tickets | mock | mockreview | readiness */
  modules: [
    { id: 'm0', n: 0, title: 'Orientation and baseline', mins: 10, outcome: 'Know the workflow and your baseline gaps',
      items: [{ kind: 'lesson', id: 'l0', mins: 4 }, { kind: 'diag', id: 'diag', mins: 6 }] },
    { id: 'm1', n: 1, title: 'Terraform foundations + local warm-up', mins: 40, outcome: 'Read and write HCL; understand lifecycle and state',
      items: [{ kind: 'lesson', id: 'l1a', mins: 8 }, { kind: 'lesson', id: 'l1b', mins: 8 }, { kind: 'lesson', id: 'l1c', mins: 8 }, { kind: 'lab', id: 'b0', level: 'guided', mins: 12 }, { kind: 'quiz', id: 'm1', mins: 4 }] },
    { id: 'm2', n: 2, title: 'Guided private S3 build', mins: 40, outcome: 'Connect resources, inputs and outputs',
      items: [{ kind: 'lesson', id: 'l2', mins: 8 }, { kind: 'lab', id: 'b1', level: 'guided', mins: 24 }, { kind: 'quiz', id: 'm2', mins: 4 }, { kind: 'oral', id: 'm2', mins: 4 }] },
    { id: 'm3', n: 3, title: 'Guided public EC2 network', mins: 65, outcome: 'Translate a traffic path into Terraform',
      items: [{ kind: 'lesson', id: 'l3a', mins: 7 }, { kind: 'lesson', id: 'l3b', mins: 6 }, { kind: 'lab', id: 'b2', level: 'guided', mins: 32, part: 'network + security, then compute' }, { kind: 'lesson', id: 'l3c', mins: 7 }, { kind: 'lesson', id: 'l3d', mins: 5 }, { kind: 'quiz', id: 'm3', mins: 4 }, { kind: 'oral', id: 'm3', mins: 4 }] },
    { id: 'm4', n: 4, title: 'Scaffolded private subnet + NAT', mins: 65, outcome: 'Build and explain outbound-only connectivity',
      items: [{ kind: 'lesson', id: 'l4a', mins: 8 }, { kind: 'lesson', id: 'l4b', mins: 6 }, { kind: 'lab', id: 'b3', level: 'scaffolded', mins: 30 }, { kind: 'faults', id: 'b3', mins: 14 }, { kind: 'quiz', id: 'm4', mins: 3 }, { kind: 'oral', id: 'm4', mins: 4 }] },
    { id: 'm5', n: 5, title: 'Variables, iteration and debugging', mins: 50, outcome: 'Modify and repair configurations confidently',
      items: [{ kind: 'lesson', id: 'l5a', mins: 5 }, { kind: 'lesson', id: 'l5b', mins: 5 }, { kind: 'lesson', id: 'l5c', mins: 4 }, { kind: 'lesson', id: 'l5d', mins: 4, min: true },
        { kind: 'lab', id: 'b5a', level: 'scaffolded', mins: 8 }, { kind: 'lab', id: 'b5b', level: 'scaffolded', mins: 5 },
        { kind: 'plan', id: 'plan1', mins: 5, min: true }, { kind: 'tickets', id: 'essentials', mins: 11, min: true }, { kind: 'tickets', id: 'more', mins: 3 }] },
    { id: 'm6', n: 6, title: 'Requirements-only independent build', mins: 45, outcome: 'Complete a fresh architecture without scaffolding',
      items: [{ kind: 'lab', id: 'b4', level: 'requirements', mins: 45 }] },
    { id: 'm7', n: 7, title: 'Two mock screens + reviews', mins: 110, outcome: 'Practise timing, reasoning and recovery',
      items: [{ kind: 'mock', id: 'A', mins: 45 }, { kind: 'mockreview', id: 'A', mins: 10 }, { kind: 'mock', id: 'B', mins: 45 }, { kind: 'mockreview', id: 'B', mins: 10 }] },
    { id: 'm8', n: 8, title: 'Interview readiness', mins: 10, outcome: 'Prepare the opening, your questions and the final checklist',
      items: [{ kind: 'readiness', id: 'ready', mins: 10 }] }
  ],

  paths: {
    full: { label: 'Recommended interview sprint', mins: 435, note: 'Modules 0–8 in order: about 7 h 15 min over nine days.' },
    minimum: { label: 'Minimum path', mins: 305, note: 'Modules 0–4, the 20-minute essentials of Module 5, one mock with its review, and Module 8: about 5 h 5 min. It is not equivalent preparation: it skips iteration practice, the requirements-only build and the second mock. Those stay visible below as recommended follow-up.',
      modules: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm7', 'm8'], m5Only: 'min', m7Only: ['mock:A', 'mockreview:A'] },
    self: { label: 'Self-paced', note: 'Same content with no dates. Work module by module; the course never locks because a date passed.' }
  },

  schedule: [
    { date: '2026-10-21', mins: 50, label: 'Modules 0 and 1', items: ['m0:*', 'm1:*'] },
    { date: '2026-10-22', mins: 40, label: 'Module 2', items: ['m2:*'] },
    { date: '2026-10-23', mins: 35, label: 'Module 3: network and security', items: ['m3:lesson:l3a', 'm3:lesson:l3b', 'm3:lab:b2'], note: 'Lessons 3.1–3.2, then Build 2 up to and including the security group (about 22 minutes of the lab).' },
    { date: '2026-10-24', mins: 60, label: 'Finish Module 3; begin Module 4', items: ['m3:lab:b2', 'm3:lesson:l3c', 'm3:lesson:l3d', 'm3:quiz:m3', 'm3:oral:m3', 'm4:lesson:l4a', 'm4:lesson:l4b', 'm4:lab:b3'], note: 'Finish Build 2 (compute, outputs, traffic walkthrough), then Lessons 4.1–4.2 and the first half of Build 3.' },
    { date: '2026-10-25', mins: 35, label: 'Finish Module 4', items: ['m4:lab:b3', 'm4:faults:b3', 'm4:quiz:m4', 'm4:oral:m4'] },
    { date: '2026-10-26', mins: 50, label: 'Module 5', items: ['m5:*'] },
    { date: '2026-10-27', mins: 45, label: 'Module 6', items: ['m6:*'] },
    { date: '2026-10-28', mins: 55, label: 'Mock A + review', items: ['m7:mock:A', 'm7:mockreview:A'] },
    { date: '2026-10-29', mins: 65, label: 'Mock B + review; Module 8', items: ['m7:mock:B', 'm7:mockreview:B', 'm8:*'] }
  ],
  warmup: { date: '2026-10-30', mins: 10, text: 'Optional 10-minute warm-up only: write a VPC, a subnet and a route table association from memory, say the private-instance egress path out loud, then stop. No new architecture today.' },
  deferOrder: ['The stretch two-AZ ALB lab', 'Module 5 iteration exercises (for_each, parameterising) beyond the 20-minute essentials', 'Modules and remote state (optional follow-ups)', 'Build 2 and Build 3 rebuild variants', 'Mock B — but protect at least one blank-editor mock'],
  optional: [
    { kind: 'lab', id: 'b2', level: 'scaffolded', variant: 'rebuild', mins: 25, why: 'Rebuild Build 2 with different CIDRs, names and Region from a scaffold.' },
    { kind: 'lab', id: 'b3', level: 'requirements', mins: 30, why: 'Build 3 again from blank files.' },
    { kind: 'lab', id: 'stretch', level: 'guided', mins: 75, why: 'Stretch: two-AZ web application behind an ALB (60–90 min). Only after the core.' },
    { kind: 'mock', id: 'A', variant: 'v2', mins: 45, why: 'Mock A with a different seeded requirement set.' },
    { kind: 'mock', id: 'B', variant: 'v2', mins: 45, why: 'Mock B with a different seeded requirement set.' },
    { kind: 'rehearsal', id: 'R60', mins: 60, why: 'Full 60-minute rehearsal: 5-minute opening, 45-minute exercise, 10 minutes of your questions.' },
    { kind: 'readmore', id: 'modules', mins: 15, why: 'Optional follow-up: modules and remote state, conceptually.' }
  ],

  modes: {
    sim: { label: 'Simulated', short: 'In-app simulation', badge: 'simulated',
      text: 'Default. No AWS credentials and no Terraform binary. The simulated terminal teaches command order and reads your files with a practice parser, so its plans follow what you typed — but every line is labelled simulated. It does not run Terraform, does not check provider schemas, creates nothing in AWS and proves no connectivity.' },
    local: { label: 'Local Terraform', short: 'Local Terraform practice', badge: 'local',
      text: 'You copy or download the lab folder and run the real Terraform CLI on your Mac. Build 0 runs end to end without AWS. AWS labs: `terraform init -backend=false`, then `terraform fmt -check` and `terraform validate` (first download needs internet). Validate is static: not an AWS plan, and not proof of reachability. Results you paste back are stored as learner-supplied.' },
    aws: { label: 'AWS deployment (optional)', short: 'Optional AWS deployment', badge: 'aws',
      text: 'Explicit opt-in, in a sandbox account you control, from a separate lab directory with its own state. You configure credentials locally (never in the browser or in files), review the plan, apply by hand, verify, then destroy and confirm nothing is left. Nothing is automatic. Billable resources are listed per lab; check current pricing yourself — this course does not quote prices or promise free-tier eligibility.' }
  },

  versions: {
    terraform: '>= 1.6.0, < 2.0.0 (checked with Terraform v1.13.3)',
    aws: '~> 6.60 (resolved to and checked with hashicorp/aws v6.69.1 on 2026-10-21)',
    checked: 'Every reference and alternative in labs/terraform-aws-tech-screen passed terraform fmt -check, init -backend=false and validate on 2026-10-21. Build 0 was also planned and applied with real Terraform (it needs no cloud). Nothing was planned or applied against AWS.'
  },

  /* 100-point practice rubric. Each dimension splits into automatically
     checked points (structural checks) and manual points (self-assessed). */
  rubric: {
    dims: [
      { id: 'core', label: 'Core resource requirements and valid relationships', pts: 30, auto: 24, manual: 6 },
      { id: 'netsec', label: 'Network and security reasoning/correctness', pts: 25, auto: 13, manual: 12 },
      { id: 'hcl', label: 'HCL, inputs, references and outputs', pts: 20, auto: 16, manual: 4 },
      { id: 'verify', label: 'Verification strategy and debugging', pts: 15, auto: 0, manual: 15 },
      { id: 'comm', label: 'Clarification, communication and tradeoffs', pts: 10, auto: 0, manual: 10 }
    ],
    manualLevels: [['0', 'not shown'], ['half', 'partly'], ['full', 'clearly shown']],
    readiness: 'Practice target (not an employer passing score): two independent, timed mocks at 80 or above, core requirements satisfied, and no unresolved critical issue.',
    critical: ['Required routing missing', 'A private instance exposed publicly', 'Unrestricted administrative ingress (SSH/RDP from anywhere)', 'Credentials embedded in files', 'Unable to explain the intended traffic path']
  },
  mistakeCats: { hcl: 'HCL syntax and types', references: 'References and dependencies', routing: 'Routing', security: 'Security groups and exposure', state: 'State and lifecycle', verification: 'Verification and debugging', communication: 'Clarification and communication' },

  sources: [
    { id: 'TF-LANG', title: 'Terraform language documentation', url: 'https://developer.hashicorp.com/terraform/language' },
    { id: 'TF-TUT', title: 'Terraform: Get started with AWS (tutorials)', url: 'https://developer.hashicorp.com/terraform/tutorials/aws-get-started' },
    { id: 'TF-INSTALL', title: 'Install Terraform', url: 'https://developer.hashicorp.com/terraform/install' },
    { id: 'TF-INIT', title: 'terraform init command', url: 'https://developer.hashicorp.com/terraform/cli/commands/init' },
    { id: 'TF-FMT', title: 'terraform fmt command', url: 'https://developer.hashicorp.com/terraform/cli/commands/fmt' },
    { id: 'TF-VALIDATE', title: 'terraform validate command', url: 'https://developer.hashicorp.com/terraform/cli/commands/validate' },
    { id: 'TF-PLAN', title: 'terraform plan command', url: 'https://developer.hashicorp.com/terraform/cli/commands/plan' },
    { id: 'TF-DESTROY', title: 'terraform destroy command', url: 'https://developer.hashicorp.com/terraform/cli/commands/destroy' },
    { id: 'TF-DATA', title: 'terraform_data resource reference', url: 'https://developer.hashicorp.com/terraform/language/resources/terraform-data' },
    { id: 'TF-STATE', title: 'Terraform state', url: 'https://developer.hashicorp.com/terraform/language/state' },
    { id: 'TF-SENSITIVE', title: 'Manage sensitive data in your configuration', url: 'https://developer.hashicorp.com/terraform/language/state/sensitive-data' },
    { id: 'TF-LOCK', title: 'Dependency lock file (.terraform.lock.hcl)', url: 'https://developer.hashicorp.com/terraform/language/files/dependency-lock' },
    { id: 'TF-STATELOCK', title: 'State locking', url: 'https://developer.hashicorp.com/terraform/language/state/locking' },
    { id: 'TF-VARS', title: 'Input variables', url: 'https://developer.hashicorp.com/terraform/language/values/variables' },
    { id: 'TF-LOCALS', title: 'Local values', url: 'https://developer.hashicorp.com/terraform/language/values/locals' },
    { id: 'TF-OUTPUTS', title: 'Output values', url: 'https://developer.hashicorp.com/terraform/language/values/outputs' },
    { id: 'TF-FOREACH', title: 'for_each meta-argument', url: 'https://developer.hashicorp.com/terraform/language/meta-arguments/for_each' },
    { id: 'TF-COUNT', title: 'count meta-argument', url: 'https://developer.hashicorp.com/terraform/language/meta-arguments/count' },
    { id: 'TF-DEPENDS', title: 'depends_on meta-argument', url: 'https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on' },
    { id: 'REG-AWS', title: 'Terraform Registry: AWS provider', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs' },
    { id: 'REG-S3', title: 'Registry: aws_s3_bucket', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket' },
    { id: 'REG-S3PAB', title: 'Registry: aws_s3_bucket_public_access_block', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_public_access_block' },
    { id: 'REG-S3VER', title: 'Registry: aws_s3_bucket_versioning', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_versioning' },
    { id: 'REG-S3SSE', title: 'Registry: aws_s3_bucket_server_side_encryption_configuration', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_server_side_encryption_configuration' },
    { id: 'REG-VPC', title: 'Registry: aws_vpc', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc' },
    { id: 'REG-SG', title: 'Registry: aws_security_group (inline vs separate rules)', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group' },
    { id: 'REG-SGIN', title: 'Registry: aws_vpc_security_group_ingress_rule', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_ingress_rule' },
    { id: 'REG-INST', title: 'Registry: aws_instance', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/instance' },
    { id: 'REG-AMI', title: 'Registry: aws_ami data source', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/ami' },
    { id: 'REG-NAT', title: 'Registry: aws_nat_gateway', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/nat_gateway' },
    { id: 'REG-EIP', title: 'Registry: aws_eip', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/eip' },
    { id: 'REG-LB', title: 'Registry: aws_lb', url: 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lb' },
    { id: 'AWS-RT', title: 'Amazon VPC: Configure route tables', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html' },
    { id: 'AWS-IGW', title: 'Amazon VPC: Internet gateways', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html' },
    { id: 'AWS-NAT', title: 'Amazon VPC: NAT gateways', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html' },
    { id: 'AWS-NAT-USE', title: 'Amazon VPC: NAT gateway use cases', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-scenarios.html' },
    { id: 'AWS-SG', title: 'Amazon VPC: Security groups', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html' },
    { id: 'AWS-NACL', title: 'Amazon VPC: Network ACLs', url: 'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html' },
    { id: 'AWS-GWEP', title: 'Amazon VPC: Gateway endpoints', url: 'https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html' },
    { id: 'AWS-EC2-IP', title: 'Amazon EC2 instance IP addressing', url: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-instance-addressing.html' },
    { id: 'AWS-USERDATA', title: 'Amazon EC2: user data', url: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html' },
    { id: 'AWS-AL2023', title: 'Amazon Linux 2023 on Amazon EC2', url: 'https://docs.aws.amazon.com/linux/al2023/ug/ec2.html' },
    { id: 'AWS-S3NAMES', title: 'Amazon S3: general purpose bucket naming rules', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html' },
    { id: 'AWS-S3DEL', title: 'Amazon S3: deleting a bucket', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/delete-bucket.html' },
    { id: 'AWS-ALB', title: 'What is an Application Load Balancer?', url: 'https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html' },
    { id: 'AWS-VPCPRICE', title: 'Amazon VPC pricing (NAT gateways, public IPv4)', url: 'https://aws.amazon.com/vpc/pricing/' },
    { id: 'AWS-CLICREDS', title: 'AWS CLI configuration and credential files', url: 'https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html' }
  ],
  sourcesAccessed: '2026-10-21',
  sourcesNote: 'Each link was fetched on 2026-10-21. HashiCorp and Registry pages render client-side; HashiCorp pages were confirmed by their page metadata (a made-up path returns 404), and every AWS-provider argument the labs use was confirmed in the provider schema of hashicorp/aws 6.69.1.'
};
(LX.tfs.sources || []).forEach(function (s) { s.accessed = LX.tfs.sourcesAccessed; s.status = s.status || 'verified'; });
