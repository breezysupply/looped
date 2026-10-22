/* Terraform + AWS tech screen — knowledge checks and oral interview prompts.

   26 knowledge checks across Modules 1–5: code prediction, debugging and
   short answer as well as concept questions. Each multiple-choice item
   explains why the right answer is right and why each wrong one is wrong.
   14 oral prompts with a strong-answer outline and common weak answers.
   The multiple-choice items without code blocks are also mapped into the
   app-wide Quiz pool (track tfaws); short-answer and oral items into Drills. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.quiz = LX.quiz || [];
LX.drills = LX.drills || [];

(function () {
  var Q = LX.tfsQuiz = [];
  function q(x) { Q.push(x); }

  /* ── Module 1 ───────────────────────────────────────────────────── */
  q({ id: 'q1-1', module: 'm1', cat: 'references', type: 'predict', lesson: 'l1a',
    q: 'Given:\n```\nresource "aws_subnet" "a" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.0.1.0/24"\n}\nresource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n```\nWhat does Terraform create first?',
    choices: ['The subnet, because it is first in the file', 'The VPC, because the subnet references it', 'Both in parallel', 'It refuses: the VPC must be declared first'], a: 1,
    why: 'References build the dependency graph; file order is irrelevant.',
    whyNot: ['File order never decides creation order.', '', 'They are dependent, so they cannot run in parallel.', 'Declaration order does not matter in Terraform.'] });
  q({ id: 'q1-2', module: 'm1', cat: 'hcl', type: 'mcq', lesson: 'l1a',
    q: 'In `resource "aws_s3_bucket" "artifacts"`, what is `artifacts`?',
    choices: ['The bucket name in AWS', 'The local name used to refer to this resource in the configuration', 'The provider alias', 'A tag'], a: 1,
    why: 'It is the local name: `aws_s3_bucket.artifacts` in references. The AWS bucket name is the `bucket` argument.',
    whyNot: ['The remote name comes from the bucket argument.', '', 'Provider aliases use `provider = aws.<alias>`.', 'Tags are set with the tags argument.'] });
  q({ id: 'q1-3', module: 'm1', cat: 'references', type: 'debug', lesson: 'l1b',
    q: '`vpc_id = "aws_vpc.main.id"` (quoted). When does it fail?',
    choices: ['terraform fmt', 'terraform validate', 'At apply, when AWS receives an invalid VPC ID', 'Never'], a: 2,
    why: 'Any string is a valid vpc_id to the schema, so validate passes; AWS rejects the literal text at apply. No dependency is recorded either.',
    whyNot: ['fmt only changes layout.', 'The value is a valid string as far as the schema knows.', '', 'AWS rejects it.'] });
  q({ id: 'q1-4', module: 'm1', cat: 'state', type: 'mcq', lesson: 'l1c',
    q: 'Which file should be committed to git?',
    choices: ['terraform.tfstate', '.terraform/ (the plugin directory)', '.terraform.lock.hcl', 'terraform.tfstate.backup'], a: 2,
    why: 'The dependency lock file pins provider versions and checksums so every run uses the same plugins.',
    whyNot: ['State can hold secrets in plain text and belongs in a protected backend.', 'Plugins are downloaded per machine by init.', '', 'A backup of state has the same problem as state.'] });
  q({ id: 'q1-5', module: 'm1', cat: 'state', type: 'predict', lesson: 'l1c',
    q: 'Build 0 is applied. You change `input` on terraform_data (via a variable) and plan. What does the plan show?',
    choices: ['No changes', '1 to change (update in place)', '1 to add, 1 to destroy (replace)', 'An error'], a: 1,
    why: 'Recorded with real Terraform 1.13.3: input changes are updated in place. Only triggers_replace forces replacement.',
    whyNot: ['The stored input differs, so there is a change.', '', 'That is what triggers_replace does, not input.', 'Changing inputs is normal.'] });
  q({ id: 'q1-6', module: 'm1', cat: 'verification', type: 'short', lesson: 'l1c',
    q: 'In one or two sentences: what does `terraform validate` prove, and name two things it cannot know.',
    a: 'That the configuration is syntactically valid and consistent with the provider schemas (names, types, references). It cannot know whether AWS will accept the values (an AMI exists, a bucket name is free) or whether traffic will flow (routes, security groups, listeners).',
    points: ['Static: syntax, references, schema', 'Cannot know AWS acceptance', 'Cannot know connectivity'] });

  /* ── Module 2 ───────────────────────────────────────────────────── */
  q({ id: 'q2-1', module: 'm2', cat: 'hcl', type: 'mcq', lesson: 'l2',
    q: 'With hashicorp/aws 6.x, how should a bucket\'s versioning be managed?',
    choices: ['`versioning { enabled = true }` inside aws_s3_bucket', 'A separate aws_s3_bucket_versioning resource that references the bucket', 'An S3 bucket policy', 'A tag named versioning'], a: 1,
    why: 'Bucket settings are separate resources; the inline arguments are deprecated.',
    whyNot: ['Deprecated inline style; do not mix it with the separate resource.', '', 'Policies control access, not versioning.', 'Tags do not configure anything.'] });
  q({ id: 'q2-2', module: 'm2', cat: 'security', type: 'mcq', lesson: 'l2',
    q: 'Where should the AWS provider get credentials for these labs?',
    choices: ['access_key and secret_key in provider "aws"', 'A variable with a default', 'The environment: AWS_PROFILE, SSO or an instance role', 'A terraform.tfvars file committed to git'], a: 2,
    why: 'Credentials stay outside the configuration; the provider\'s default chain finds them.',
    whyNot: ['Anything in a .tf file ends up in git and in plans.', 'Defaults are code too.', '', 'Committed files are shared files.'] });
  q({ id: 'q2-3', module: 'm2', cat: 'state', type: 'predict', lesson: 'l2',
    q: 'A versioned lab bucket holds objects. You run `terraform destroy`. What happens?',
    choices: ['The bucket and all versions are deleted', 'Destroy fails for the bucket (BucketNotEmpty) because force_destroy is false', 'Terraform empties it automatically', 'Only the versioning resource is removed and the plan stops'], a: 1,
    why: 'Terraform will not delete a non-empty bucket unless force_destroy is true. Empty it deliberately, then destroy.',
    whyNot: ['Only with force_destroy = true.', '', 'Not without force_destroy.', 'The other resources may be removed, but the bucket deletion fails.'] });
  q({ id: 'q2-4', module: 'm2', cat: 'references', type: 'debug', lesson: 'l2',
    q: 'The public access block says `bucket = "ridgeline-ops-artifacts"` (a literal) while the bucket name comes from var.bucket_name. What is the risk?',
    choices: ['None', 'No dependency on the bucket resource, and it silently targets the wrong bucket when the variable changes', 'validate fails', 'It disables encryption'], a: 1,
    why: 'A reference both points at the right bucket and orders creation; a literal does neither.',
    whyNot: ['The two can drift apart.', '', 'A string is valid to the schema.', 'Unrelated resource.'] });

  /* ── Module 3 ───────────────────────────────────────────────────── */
  q({ id: 'q3-1', module: 'm3', cat: 'routing', type: 'debug', lesson: 'l3a',
    q: 'A route table has `0.0.0.0/0 → igw`, but the instance in the subnet is unreachable and its subnet has no explicit association. Why?',
    choices: ['The IGW needs depends_on', 'The subnet uses the main route table, which has only the local route', 'Route tables apply after a reboot', 'IPv4 needs ::/0 as well'], a: 1,
    why: 'Associations decide which table a subnet uses; otherwise it uses the main table.',
    whyNot: ['The IGW reference already orders things.', '', 'Routes apply immediately.', 'IPv6 is unrelated to IPv4 reachability.'] });
  q({ id: 'q3-2', module: 'm3', cat: 'security', type: 'predict', lesson: 'l3b',
    q: 'A Terraform-managed security group has ingress TCP 80 only. The user data installs nginx with dnf. What does `curl http://<ip>/` show?',
    choices: ['The nginx page', 'Connection refused: no egress rule, so the install failed and nothing listens', 'A timeout', 'HTTP 403'], a: 1,
    why: 'Terraform removes the default egress rule; the install cannot reach the repositories; the port answers with a reset.',
    whyNot: ['nginx was never installed.', '', 'A timeout means packets are dropped; here the host answers.', 'Nothing is serving HTTP.'] });
  q({ id: 'q3-3', module: 'm3', cat: 'security', type: 'mcq', lesson: 'l3b',
    q: 'Why not mix inline `ingress {}` blocks with aws_vpc_security_group_ingress_rule on the same group?',
    choices: ['It is a syntax error', 'The two styles manage the same rules and overwrite each other, causing churn or lost rules', 'Inline blocks are faster', 'Rule resources only work for egress'], a: 1,
    why: 'The provider documentation warns against it.',
    whyNot: ['It validates; the problem is behaviour.', '', 'Speed is not the issue.', 'There are separate ingress and egress rule resources.'] });
  q({ id: 'q3-4', module: 'm3', cat: 'routing', type: 'mcq', lesson: 'l3c',
    q: 'Why does the Build 2 instance have `depends_on = [aws_route.public_default, aws_route_table_association.public]`?',
    choices: ['Instances always need depends_on', 'The bootstrap needs internet access at first boot, and no reference tells Terraform to wait for the route', 'To make it deploy faster', 'Because the AMI is a data source'], a: 1,
    why: 'depends_on states a hidden dependency that references do not capture.',
    whyNot: ['Use it only for hidden dependencies.', '', 'It adds ordering, not speed.', 'The data source is already referenced.'] });
  q({ id: 'q3-5', module: 'm3', cat: 'hcl', type: 'predict', lesson: 'l3c',
    q: 'The AMI lookup filters on arm64 and `instance_type = "t3.micro"`. Where does it fail?',
    choices: ['validate', 'plan', 'apply, when AWS launches the instance', 'It works'], a: 2,
    why: 'Both values are valid strings for the schema; AWS rejects the combination when it launches the instance.',
    whyNot: ['The schema cannot know architectures.', 'A plan launches nothing.', '', 't3 is x86_64.'] });
  q({ id: 'q3-6', module: 'm3', cat: 'verification', type: 'short', lesson: 'l3d',
    q: 'Users say "it times out". Another time, "connection refused". What do you suspect in each case?',
    a: 'Timeout: packets are dropped — routing (association, IGW route, missing public IP) or filtering (security group, NACL). Refused: the packet reached the instance and nothing listens on the port — the service did not start (often the bootstrap failed) or listens on another port.',
    points: ['Timeout → routing or filtering', 'Refused → reached host, nothing listening', 'Names a check for each'] });

  /* ── Module 4 ───────────────────────────────────────────────────── */
  q({ id: 'q4-1', module: 'm4', cat: 'routing', type: 'mcq', lesson: 'l4a',
    q: 'Where must a public NAT gateway be placed?',
    choices: ['In the private subnet it serves', 'In a public subnet whose route table reaches the internet gateway', 'Anywhere in the VPC', 'Outside the VPC'], a: 1,
    why: 'NAT traffic follows the NAT gateway\'s own subnet route table to the IGW.',
    whyNot: ['Its traffic would loop back to itself.', '', 'Placement determines its route.', 'It is a VPC resource.'] });
  q({ id: 'q4-2', module: 'm4', cat: 'routing', type: 'debug', lesson: 'l4a',
    q: '```\nresource "aws_route" "private_default" {\n  route_table_id         = aws_route_table.private.id\n  destination_cidr_block = "0.0.0.0/0"\n  gateway_id             = aws_internet_gateway.main.id\n}\n```\nThe worker has no public IP. What happens?',
    choices: ['Outbound works through the IGW', 'Outbound fails: an IGW only translates for instances with a public IPv4; the route should use nat_gateway_id', 'validate fails', 'The NAT gateway takes over automatically'], a: 1,
    why: 'Private subnets route to the NAT gateway; only the NAT gateway\'s subnet routes to the IGW.',
    whyNot: ['No public IP, nothing to translate to.', '', 'It is valid configuration.', 'Routes do exactly what they say.'] });
  q({ id: 'q4-3', module: 'm4', cat: 'security', type: 'mcq', lesson: 'l4b',
    q: 'The worker\'s security group has egress 443 and no ingress. Do replies from the API it calls get back in?',
    choices: ['No: add ingress for the ephemeral ports', 'Yes: security groups are stateful and allow replies to connections the instance started', 'Only through the NAT gateway\'s group', 'Only with a NACL rule'], a: 1,
    why: 'Stateful filtering tracks the connection.',
    whyNot: ['That is how stateless NACLs behave, not security groups.', '', 'NAT gateways have no security group.', 'The default NACL allows all.'] });
  q({ id: 'q4-4', module: 'm4', cat: 'routing', type: 'mcq', lesson: 'l4b',
    q: 'What is the main weakness of one NAT gateway serving private subnets in two AZs?',
    choices: ['It is too fast', 'If its AZ fails, every private subnet loses outbound access', 'It cannot serve two subnets', 'It needs two Elastic IPs'], a: 1,
    why: 'NAT gateways are zonal and routes do not fail over; production uses one per AZ.',
    whyNot: ['Performance is not the issue.', '', 'Any number of subnets can route to it.', 'One EIP per NAT gateway.'] });
  q({ id: 'q4-5', module: 'm4', cat: 'routing', type: 'short', lesson: 'l4a',
    q: 'Trace a private worker\'s HTTPS request to the internet and the reply back, in four or five hops.',
    a: 'Worker (private IP) → private route table 0.0.0.0/0 → NAT gateway in the public subnet, which rewrites the source to its Elastic IP → public route table 0.0.0.0/0 → internet gateway → destination. The reply returns to the Elastic IP, the NAT gateway maps it back to the worker\'s private IP, and the stateful security group allows it in.',
    points: ['Private RT → NAT', 'NAT in public subnet with EIP', 'Public RT → IGW', 'Reply via NAT translation', 'Stateful SG'] });

  /* ── Module 5 ───────────────────────────────────────────────────── */
  q({ id: 'q5-1', module: 'm5', cat: 'state', type: 'predict', lesson: 'l5b',
    q: 'Subnets use `count = length(var.cidrs)` over three CIDRs. You remove the first one. What does the plan propose?',
    choices: ['Destroy only that subnet', 'Changes at indexes 0 and 1 (their CIDRs shift; replacement) and destroy index 2', 'No changes', 'An error'], a: 1,
    why: 'count addresses are positions; for_each with stable keys avoids the shift.',
    whyNot: ['That is what for_each would do.', '', 'The values at each index changed.', 'Valid configuration.'] });
  q({ id: 'q5-2', module: 'm5', cat: 'references', type: 'mcq', lesson: 'l5b',
    q: 'How do you reference the subnet with key "a" from `aws_subnet.private` (for_each)?',
    choices: ['aws_subnet.private.a.id', 'aws_subnet.private["a"].id', 'aws_subnet.private[0].id', 'each.private.a'], a: 1,
    why: 'for_each instances are addressed by key in brackets.',
    whyNot: ['Dot syntax reads attributes, not instances.', '', 'Numeric indexes are for count.', 'each is only available inside the block.'] });
  q({ id: 'q5-3', module: 'm5', cat: 'verification', type: 'mcq', lesson: 'l5d',
    q: 'Which stage first reports an output that indexes a for_each key that does not exist?',
    choices: ['terraform validate', 'terraform plan ("Invalid index")', 'terraform apply', 'Never'], a: 1,
    why: 'Recorded with real Terraform: validate passes, plan fails with "Invalid index".',
    whyNot: ['validate does not evaluate the map\'s keys.', '', 'It fails before apply.', 'It does fail, at plan.'] });
  q({ id: 'q5-4', module: 'm5', cat: 'state', type: 'mcq', lesson: 'l5c',
    q: 'A plan shows `aws_s3_bucket.artifacts will be destroyed` and `aws_s3_bucket.logs will be created` with the same bucket name. Best response?',
    choices: ['Apply; Terraform handles renames', 'Add `moved { from = aws_s3_bucket.artifacts  to = aws_s3_bucket.logs }` and plan again', 'Edit terraform.tfstate by hand', 'Use -target to skip the bucket'], a: 1,
    why: 'A moved block is the reviewable, declarative way to rename.',
    whyNot: ['It would try to delete the bucket.', '', 'Hand edits bypass review and are error-prone.', '-target is for recovery, not routine work.'] });
  q({ id: 'q5-5', module: 'm5', cat: 'hcl', type: 'short', lesson: 'l5a',
    q: 'Write a validation condition that accepts only valid IPv4 CIDRs for var.vpc_cidr, and say what can() does.',
    a: '`condition = can(cidrhost(var.vpc_cidr, 0))` — can() evaluates its argument and returns true if it succeeds and false if it errors, so an invalid CIDR (where cidrhost errors) fails validation with your error_message.',
    points: ['can(cidrhost(var.vpc_cidr, 0))', 'can returns false instead of erroring', 'Runs before any API call'] });

  /* ═══ oral interview prompts ═════════════════════════════════════ */
  var O = LX.tfsOral = [];
  function o(x) { O.push(x); }
  o({ id: 'o1', module: 'm1', q: 'What does Terraform do between `plan` and `apply`, and what does state have to do with it?', strong: ['Plan compares configuration, state and refreshed reality and proposes actions', 'Apply executes the reviewed actions and writes results to state', 'State maps addresses to real IDs; without it Terraform could not tell create from existing', 'Mentions saving a plan and applying exactly it'], weak: ['"Plan is a dry run" with no mention of state', 'Thinks apply re-reads files and does whatever they say regardless of review'] });
  o({ id: 'o2', module: 'm1', q: 'Why is state sensitive, and where should it live for a team?', strong: ['Contains every attribute providers return, including secrets in plain text', 'sensitive = true hides values in output, not in state', 'Remote backend with encryption, access control and locking', 'Never in git'], weak: ['"Mark outputs sensitive and it is fine"', 'Commit it so teammates have it'] });
  o({ id: 'o3', module: 'm2', q: 'Walk me through a private S3 bucket in Terraform.', strong: ['Provider pinned; credentials from the environment', 'Bucket name from an input (global uniqueness)', 'Public access block, versioning, encryption as separate resources referencing the bucket', 'Outputs by reference; no force_destroy; cleanup of versions is deliberate'], weak: ['Inline deprecated arguments', 'Hard-coded keys', '"force_destroy so cleanup is easy"'] });
  o({ id: 'o15', module: 'm2', q: 'How do you choose and manage the bucket name, and why does it matter for Terraform?', strong: ['Bucket names are global across accounts in a partition; take the name from an input', '3–63 lowercase letters, digits, dots, hyphens; validate it', 'The name is the remote name; the local name is only for references', 'Changing it forces a new bucket — plan shows a replacement'], weak: ['Hard-codes a name and is surprised it is taken', 'Confuses the local name with the bucket name'] });
  o({ id: 'o4', module: 'm3', q: 'What makes an EC2 instance reachable from the internet over HTTP?', strong: ['Subnet associated with a route table whose 0.0.0.0/0 goes to an attached IGW', 'Public IPv4 on the instance', 'Security group ingress on the port (NACL allows)', 'Something listening — and the bootstrap had egress to install it'], weak: ['"It is in a public subnet" without defining it', 'Forgets the public IP or the listener'] });
  o({ id: 'o5', module: 'm3', q: 'A deployed web server times out. How do you debug it?', strong: ['Timeout vs refused distinction first', 'Check association → default route target → public IP → security group (and NACL)', 'Then the instance: console output/user-data log, service status', 'Change one thing, re-test the same way'], weak: ['Open all ports to see if it helps', 'Redeploy without a hypothesis'] });
  o({ id: 'o6', module: 'm3', q: 'When do you use depends_on, and when not?', strong: ['References create most dependencies automatically', 'depends_on only for hidden dependencies (bootstrap needs a route; NAT needs the IGW)', 'Keep it narrow; overuse slows plans and hides design'], weak: ['"Add it everywhere to be safe"', 'Never heard of hidden dependencies'] });
  o({ id: 'o7', module: 'm4', q: 'Explain how a private instance reaches the internet and why the internet cannot reach it.', strong: ['Private RT → NAT in public subnet → public RT → IGW', 'NAT rewrites source to its Elastic IP and maps replies back', 'No public IP and NAT only forwards replies to inside-initiated connections', 'Security group stateful; no ingress needed'], weak: ['"NAT makes it public"', 'Routes the private subnet to the IGW'] });
  o({ id: 'o8', module: 'm4', q: 'How would you make Build 3 production-ready, and what does it cost?', strong: ['One NAT gateway per AZ with per-AZ private route tables', 'Gateway endpoints for S3/DynamoDB to cut NAT data processing', 'States that NAT hours, data and public IPv4 are billed; checks current pricing rather than quoting', 'Multiple private subnets/AZs for the workload'], weak: ['"Add a second NAT" without routes per AZ', 'Quotes a price from memory as fact'] });
  o({ id: 'o9', module: 'm4', q: 'Security groups versus network ACLs — what is the difference that matters?', strong: ['Stateful vs stateless', 'NACL rules evaluated in number order with an implicit deny; need ephemeral return ranges', 'SG per ENI, NACL per subnet', 'Default NACL allows all'], weak: ['"They are the same, ACLs are older"', 'Thinks SGs need ingress rules for replies'] });
  o({ id: 'o10', module: 'm5', q: 'count or for_each — how do you choose?', strong: ['Addresses: index vs key', 'Removing an element shifts count indexes, causing replacements', 'for_each for things with identities; count for N identical or a 0/1 toggle', 'Moving between them needs moved blocks'], weak: ['"for_each is newer so always better"', 'No mention of addresses'] });
  o({ id: 'o11', module: 'm5', q: 'How do you review a plan before applying?', strong: ['Summary line first, then every destroy/replace', 'Ask what holds data and what depends on replaced objects', 'Look for "forces replacement" and unexpected Region/account', 'Save the plan and apply exactly it'], weak: ['"If plan works, apply"', 'Only reads the summary'] });
  o({ id: 'o12', module: 'm5', q: 'validate passes but the system does not work. What does that tell you, and what do you do?', strong: ['validate is static: syntax, references, schema only', 'Plan/apply catch value and API errors; behaviour is never reported', 'Trace the traffic path hop by hop against the code', 'Verify with a real request after apply'], weak: ['"Terraform must have a bug"', 'Equates validate with working'] });
  o({ id: 'o13', module: 'm7', q: 'You are 20 minutes into the screen and stuck on an error you do not recognise. What do you say and do?', strong: ['Say what you see and your hypothesis out loud', 'Read the error\'s file and line; check the Registry for the argument/attribute', 'Narrow scope: comment out the newest block or validate a smaller piece', 'Ask a clarifying question if the requirement is ambiguous; keep the core path moving'], weak: ['Silence while searching', 'Rewriting large parts at random'] });
  o({ id: 'o14', module: 'm7', q: 'How would you verify your configuration works, and clean up afterwards?', strong: ['fmt and validate first; plan with credentials and read it', 'After apply: curl/console output/route and SG evidence', 'destroy, then confirm nothing billable remains (NAT, EIP, instances)', 'Separate state for labs; never auto-apply'], weak: ['"Apply and see"', 'Forgets NAT/EIP cleanup and costs'] });

  /* ── shared Quiz and Drills pools (track tfaws) ──────────────────── */
  var CAT = { m1: 'foundations', m2: 's3', m3: 'network', m4: 'nat', m5: 'debug', m7: 'interview' };
  Q.forEach(function (x) {
    if (x.choices && !/```/.test(x.q)) LX.quiz.push({ track: 'tfaws', cat: CAT[x.module], level: x.type === 'debug' || x.type === 'predict' ? 'intermediate' : 'beginner', tfsId: x.id, q: x.q, choices: x.choices.slice(), a: x.a, why: x.why });
    else if (x.type === 'short') LX.drills.push({ track: 'tfaws', cat: CAT[x.module], level: 'intermediate', tfsId: x.id, q: x.q, a: x.a, points: x.points.slice() });
  });
  O.forEach(function (x) { LX.drills.push({ track: 'tfaws', cat: CAT[x.module] || 'interview', level: 'advanced', tfsId: x.id, q: x.q, a: 'A strong answer covers: ' + x.strong.join('; ') + '.', points: x.strong.slice(0, 5) }); });
})();
