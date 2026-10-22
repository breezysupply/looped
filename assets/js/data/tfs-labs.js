/* Terraform + AWS tech screen — builds.

   Each build: the requirement brief (kept apart from answers), explicit
   success criteria, starting files per assistance level (embedded from
   labs/terraform-aws-tech-screen via LX.tfsSrc), practice checks per
   variant, three hints (concept, structure, targeted fragment), reference
   and alternative solutions, why it works, common mistakes, oral prompts,
   and what Local and optional AWS modes involve. Checks are built at call
   time from LX.tfsKit. Levels a build does not offer say why. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.tfsLabs = LX.tfsLabs || [];

(function () {
  function K() { return LX.tfsKit.C; }
  function first(a) { return a && a.length ? a[0] : null; }
  function c(id, label, test, extra) { var o = { id: id, label: label, test: test, sev: 'required', cat: 'references', dim: 'hcl' }; for (var k in extra || {}) o[k] = extra[k]; return o; }
  function twoSubnetOutputs() {
    return c('subout', 'Outputs for both subnet IDs', function (M) { var names = {}; M.outputs.forEach(function (o) { var a = M.ast(o, 'value'); if (a) M.refsOf(a).forEach(function (r) { if (r.type === 'aws_subnet' && r.attr === 'id') names[r.name] = 1; }); }); return Object.keys(names).length >= 2 ? true : 'expected outputs for the public and the private subnet IDs'; });
  }
  function azConfigurable() {
    return c('az', 'Availability Zone is configurable (variable, local or lookup)', function (M) { var s = first(M.all('aws_subnet')); if (!s) return 'no subnet'; if (!M.has(s, 'availability_zone')) return 'no availability_zone on the subnet (AWS picks one; the brief asks for it to be configurable)'; var a = M.ast(s, 'availability_zone'); return M.refsOf(a).some(function (r) { return r.kind === 'var' || r.kind === 'local' || r.kind === 'data'; }) ? true : 'the AZ is a literal'; }, { cat: 'hcl', sev: 'advice' });
  }
  function urlOutput(port) {
    return c('url', 'An HTTP URL output built from the public IP' + (port ? ' (with the app port)' : ''), function (M) { return M.outputs.some(function (o) { var a = M.ast(o, 'value'); return a && a.t === 'tpl' && M.refsOf(a).some(function (r) { return (r.type === 'aws_instance' || r.type === 'aws_eip') && /public_(ip|dns)/.test(r.attr || ''); }) && (!port || /app_port|8080/.test(o.attrs.value.raw)); }) ? true : 'no output that builds http://<public ip>' + (port ? ':<port>' : '') + '/'; });
  }
  function webChecks(cidr, sub, opts) {
    opts = opts || {};
    return function () {
      var C = K();
      return [C.pinned, C.regionVar, C.noSecrets, C.typedVars, C.vpc(cidr), C.subnets(sub ? [sub] : null), azConfigurable(), C.igw, C.publicRoute, C.routeStyle, C.sgInVpc, C.sgStyle, C.noWorldAdmin, C.ipv4Only,
        C.ingressPort(opts.port || 80, opts.restricted ? 'var' : 'world', opts.restricted ? 'Ingress on the app port only from a configurable source range' : null), C.webEgress, C.webInstance, C.ami, C.arch, C.userData, C.bootDep('advice'), C.overDepends,
        C.outputsRef([{ label: 'instance ID', attrs: [['aws_instance', 'id']] }]), urlOutput(opts.port)];
    };
  }
  function natChecks(cidr, opts) {
    opts = opts || {};
    return function () {
      var C = K();
      var out = [C.pinned, C.regionVar, C.noSecrets, C.typedVars, C.vpc(cidr), C.subnets(opts.subnets), C.igw, C.publicRoute, C.routeStyle, C.sgInVpc, C.sgStyle, C.noWorldAdmin, C.ipv4Only,
        C.eip, C.natPublic, C.privateRoute, C.workerPrivate, C.workerNoIngress, C.workerEgress, C.ami, C.arch, C.userData, C.bootDep('required'), C.overDepends,
        twoSubnetOutputs(), C.outputsRef([{ label: 'worker private IP', attrs: [['aws_instance', 'private_ip']] }, { label: 'NAT gateway ID', attrs: [['aws_nat_gateway', 'id']] }], 'outputs')];
      if (opts.tags) out.push(c('tags', 'Tags applied to the resources (a tags map or provider default_tags)', function (M) { var tagged = M.resources.filter(function (r) { return M.has(r, 'tags'); }).length; return tagged >= 3 || M.providers.some(function (p) { return M.sub(p, 'default_tags').length; }) ? true : 'fewer than three resources carry tags'; }, { cat: 'hcl' }));
      return out;
    };
  }
  var LOCAL_AWS = 'terraform init -backend=false   # downloads hashicorp/aws (internet needed once)\nterraform fmt -check\nterraform validate              # static: no AWS calls, no credentials';
  var AWS_STEPS = function (extraVerify) {
    return [
      'Use a sandbox account you control. Configure credentials in your shell only (`aws configure sso` or `export AWS_PROFILE=<sandbox profile>`); never in the browser or in .tf files.',
      'Work in a separate copy of the lab folder so its state never mixes with practice runs; keep `terraform.tfstate` out of git.',
      'Run `terraform plan -out=tfplan` and read every line: count of resources, nothing destroyed, the Region you expect.',
      'Apply by hand: `terraform apply tfplan`.',
      'Verify: ' + extraVerify,
      'Clean up the same session: `terraform destroy`, read its plan, type yes.',
      'Confirm nothing is left (see the checks below) and check the billing console the next day.'
    ];
  };
  var VERIFY_GONE = 'aws ec2 describe-instances --filters Name=tag:managed_by,Values=terraform Name=instance-state-name,Values=pending,running,stopped --query "Reservations[].Instances[].InstanceId"\naws ec2 describe-nat-gateways --filter Name=state,Values=pending,available --query "NatGateways[].NatGatewayId"\naws ec2 describe-addresses --query "Addresses[].AllocationId"\naws ec2 describe-vpcs --filters Name=tag:managed_by,Values=terraform --query "Vpcs[].VpcId"';

  /* ═══ Build 0 ═════════════════════════════════════════════════════ */
  LX.tfsLabs.push({
    id: 'b0', module: 'm1', title: 'Build 0: local deployment manifest', mins: 12, kind: 'local', dir: 'b0-local-manifest',
    files: ['main.tf', 'variables.tf', 'outputs.tf'],
    brief: 'Using only the built-in `terraform_data` resource — no AWS provider, no cloud account — write a small deployment manifest:\n\n- A `terraform` block requiring a compatible Terraform version (1.6 or newer, below 2.0).\n- Typed `project` and `environment` string inputs with defaults.\n- A local `tags` map built from them, plus `managed_by = "terraform"`.\n- A `terraform_data` resource whose `input` holds a name (`<project>-<environment>`) and the tags.\n- Outputs for the name and the tags, read from the resource\'s `output` attribute.\n\nThen: **predict** the plan before you run it, apply it, change the environment with `-var environment=prod`, predict again, compare, and explain what state now records.',
    success: ['terraform_data with an input', 'Typed project and environment inputs', 'A local tags map built from the inputs and used by the resource', 'Two outputs reading terraform_data.<name>.output'],
    levels: { guided: { src: 'b0-local-manifest/guided' }, scaffolded: { src: 'b0-local-manifest/scaffolded' }, requirements: { blank: true }, interview: { blank: true, mins: 15 } },
    variants: { base: { label: 'Base', checks: function () { var C = K(); return [C.tfData, C.projectEnvVars, C.typedVars, C.tagsLocal, C.outputsFromData]; }, solution: 'b0-local-manifest/reference', alternatives: [{ text: 'Putting the tags map directly in the resource\'s input (no locals) works, but the local is what lets every resource in a real project share one map.' }] } },
    predictions: [
      { q: 'Before your first apply: how many resources will the plan add, and which outputs will be "(known after apply)"?', a: '1 to add (terraform_data.manifest). Both outputs show (known after apply) in the plan, because they read the output attribute, which exists only after apply.' },
      { q: 'After applying with dev, you plan with -var environment=prod. Update, replace, or nothing?', a: 'Update in place: changing input on terraform_data is an in-place update (recorded with real Terraform 1.13.3). Only triggers_replace forces a replacement.' }
    ],
    hints: ['Three kinds of value flow here: inputs (variables), a computed value (the local map) and a result (outputs). terraform_data stores whatever you give it in input and returns it as output.', 'variable "project" {…}  variable "environment" {…}\nlocals { tags = {…} }\nresource "terraform_data" "manifest" { input = { name = …, tags = … } }\noutput "deployment_name" { value = terraform_data.manifest.output.name }', 'resource "terraform_data" "manifest" {\n  input = {\n    name = "${var.project}-${var.environment}"\n    tags = local.tags\n  }\n}'],
    why: 'Nothing here talks to a cloud, so you can watch Terraform\'s own mechanics: the plan reads your files, apply writes `terraform.tfstate`, and changing an input produces an update you can see before it happens.',
    mistakes: ['Reading `.outputs` instead of `.output` (Unsupported attribute)', 'Expecting a .terraform.lock.hcl: terraform_data is built in, so there is none', 'Committing terraform.tfstate'],
    oral: ['Explain what terraform.tfstate contains after the first apply and why the second plan shows an update rather than a create.', 'Why did init download nothing for this build?'],
    local: { note: 'Build 0 runs end to end with real Terraform and no AWS account.', cmds: 'terraform init\nterraform plan\nterraform apply            # type yes\nterraform output\nterraform plan -var environment=prod\nterraform apply -var environment=prod\ncat terraform.tfstate      # look, then never commit it\nterraform destroy' },
    aws: null,
    refs: ['TF-DATA', 'TF-STATE', 'TF-VARS', 'TF-LOCALS', 'TF-OUTPUTS']
  });

  /* ═══ Build 1 ═════════════════════════════════════════════════════ */
  LX.tfsLabs.push({
    id: 'b1', module: 'm2', title: 'Build 1: private operations artifact bucket', mins: 24, kind: 'aws', dir: 'b1-private-s3',
    files: ['main.tf', 'variables.tf', 'outputs.tf'],
    brief: 'Create a private S3 bucket for operations artifacts:\n\n- AWS provider with explicit `required_providers` version constraints and a Region input.\n- A **caller-supplied, globally unique** bucket name (an input; no default).\n- The bucket, a public access block (all four settings on), versioning, explicit server-side encryption, and tags.\n- Outputs for the bucket name and ARN, using references.\n- No public website hosting, no public bucket policy, no credentials in files, and no `force_destroy`.\n\nIn guided mode the bucket, public access block and versioning are written for you. **On your own:** add an `environment` variable and use it in the tags, write the encryption resource, and write both outputs.',
    success: ['Provider pinned; Region from a variable', 'Bucket name from an input', 'Public access block, versioning and encryption all reference the same bucket', 'Tags, including environment', 'Name and ARN outputs are references'],
    levels: { guided: { src: 'b1-private-s3/guided' }, scaffolded: { src: 'b1-private-s3/scaffolded' }, requirements: { blank: true }, interview: { blank: true, mins: 25 } },
    variants: { base: { label: 'Base', checks: function () { var C = K(); return [C.pinned, C.regionVar, C.noSecrets, C.typedVars, C.s3Bucket, C.s3Pab, C.s3Versioning, C.s3Sse, C.s3NotPublic, C.s3Tags, C.s3EnvVar, C.outputsRef([{ label: 'bucket name', attrs: [['aws_s3_bucket', 'id'], ['aws_s3_bucket', 'bucket']] }, { label: 'bucket ARN', attrs: [['aws_s3_bucket', 'arn']] }])]; }, solution: 'b1-private-s3/reference',
      alternatives: [{ src: 'b1-private-s3/alternative', why: 'Provider default_tags instead of per-resource tags, SSE-KMS with the AWS managed key and a bucket key, different local names. Equally valid.' }] } },
    hints: ['One bucket, several resources: each setting is its own resource that points back at the bucket with a reference.', 'aws_s3_bucket (bucket = var…) → aws_s3_bucket_public_access_block / _versioning / _server_side_encryption_configuration, each with bucket = aws_s3_bucket.<name>.id', 'resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {\n  bucket = aws_s3_bucket.artifacts.id\n  rule {\n    apply_server_side_encryption_by_default {\n      sse_algorithm = "AES256"\n    }\n  }\n}'],
    why: 'Every aspect of the bucket is explicit and reviewable as its own resource; references tie them to the right bucket and make Terraform create the bucket first; the name stays an input because only the caller knows a globally unique one.',
    mistakes: ['Inline versioning/acl/encryption on aws_s3_bucket (deprecated style)', 'A hard-coded bucket name in a shared lab', 'force_destroy = true', 'Outputs as quoted strings'],
    oral: ['Explain resource type, local name and remote bucket name with this build as the example.', 'Why does destroying this bucket fail once it holds objects, and how would you clean it up deliberately?', 'Where do the credentials come from when you run plan?'],
    local: { note: 'validate checks the configuration against the provider schema. It does not check that your bucket name is free — only a real apply can.', cmds: LOCAL_AWS },
    aws: { billable: ['S3 storage for any objects and every retained version', 'S3 requests'], steps: AWS_STEPS('`aws s3api get-public-access-block --bucket <name>`, `aws s3api get-bucket-versioning --bucket <name>` and `aws s3api get-bucket-encryption --bucket <name>` show the settings.'),
      cleanup: ['Versioning keeps every object version and delete marker, so Terraform\'s destroy fails with BucketNotEmpty while any remain.', 'Empty the lab bucket deliberately: in the S3 console choose the bucket → Empty, type the confirmation; this removes all versions. Only do this for the lab bucket.', 'Then `terraform destroy`.', 'Do not add force_destroy = true to make this easier on anything that could hold real data.'],
      gone: 'aws s3api head-bucket --bucket <name>   # expect a 404 / Not Found' },
    refs: ['REG-S3', 'REG-S3PAB', 'REG-S3VER', 'REG-S3SSE', 'AWS-S3NAMES', 'AWS-S3DEL']
  });

  /* ═══ Build 2 ═════════════════════════════════════════════════════ */
  LX.tfsLabs.push({
    id: 'b2', module: 'm3', title: 'Build 2: single public web server', mins: 32, kind: 'aws', dir: 'b2-public-web',
    files: ['main.tf', 'variables.tf', 'outputs.tf'],
    brief: 'One web server reachable over HTTP from the internet:\n\n- VPC `10.42.0.0/16` and public subnet `10.42.10.0/24`; Region and AZ configurable.\n- Internet gateway attached to the VPC.\n- Public route table with an IPv4 default route to the internet gateway and an explicit subnet association.\n- Security group in that VPC: inbound TCP 80; the explicit outbound access the bootstrap needs.\n- EC2 instance in the subnet: explicit public IPv4, an AMI from a documented lookup with a matching instance architecture, the security group, tags, and user data that installs and starts a web server with the image\'s package manager.\n- Outputs: instance ID and the public HTTP URL.\n- No SSH open to the world. Administration is out of scope here.\n\nThis is a plain-HTTP teaching demo, not a production TLS architecture.',
    parts: ['Network: VPC, subnet, IGW, route table, route, association', 'Security: group, ingress 80, egress 443', 'Compute: AMI lookup, instance, user data, public IP, narrow depends_on', 'Traffic walkthrough: say the path out loud (Lesson 3.4)'],
    success: ['Subnet is public because of an explicit association with an IGW-routed table', 'Instance has a public IPv4, the group, and user data that starts a web server', 'Port 80 in; HTTPS out; no world-open SSH', 'Instance ID and URL outputs'],
    levels: { guided: { src: 'b2-public-web/guided' }, scaffolded: { src: 'b2-public-web/scaffolded' }, requirements: { blank: true }, interview: { blank: true, mins: 45 } },
    variants: {
      base: { label: 'Base (10.42.0.0/16)', checks: webChecks('10.42.0.0/16', '10.42.10.0/24'), solution: 'b2-public-web/reference',
        alternatives: [{ src: 'b2-public-web/alternative', why: 'Inline route, the public SSM parameter for the AMI, Python\'s built-in web server (nothing to install), different names — valid HCL, but its Region, AZ and CIDRs are hard-coded, so it misses the "configurable" requirement and the depends_on advice.' }] },
      rebuild: { label: 'Rebuild: orchard-web (10.77.0.0/16, us-west-2)', brief: 'Rebuild variant: same requirements with different values — Region `us-west-2`, VPC `10.77.0.0/16`, public subnet `10.77.4.0/24`, name prefix `orchard-web`. Start from the scaffold, not from your Build 2 files.', checks: webChecks('10.77.0.0/16', '10.77.4.0/24'), solution: 'b2-public-web/rebuild-reference', alternatives: [] }
    },
    hints: ['Reachable means three things at once: a route to the IGW (via the association), a public IPv4 on the instance, and a security group that allows it — plus something listening, which needs egress at boot.', 'network: aws_vpc → aws_subnet → aws_internet_gateway → aws_route_table → aws_route → aws_route_table_association\nsecurity: aws_security_group → ingress rule (80) → egress rule (443)\ncompute: data "aws_ami" → aws_instance (associate_public_ip_address, user_data, depends_on)', 'resource "aws_instance" "web" {\n  ami                         = data.aws_ami.al2023.id\n  instance_type               = var.instance_type\n  subnet_id                   = aws_subnet.public.id\n  vpc_security_group_ids      = [aws_security_group.web.id]\n  associate_public_ip_address = true\n  user_data                   = <<-EOT … EOT\n  depends_on                  = [aws_route.public_default, aws_route_table_association.public]\n}'],
    why: 'Each hop of browser → public IP → IGW → subnet → security group → nginx is one resource or argument you wrote; the depends_on covers the one ordering requirement that no reference expresses.',
    mistakes: ['Missing association (subnet stays on the main table)', 'No public IPv4', 'No egress rule, so the install fails and port 80 answers "connection refused"', 'SSH from 0.0.0.0/0', 'Unexplained AMI ID', 'arm64 image with an x86_64 type'],
    oral: ['Walk the request from the browser to nginx and the reply back, naming each resource.', 'An internet gateway exists, so why is "public" more than that?', 'What would change for a production version of this?'],
    local: { note: 'validate passes without credentials. A real plan calls AWS (the AMI and AZ lookups), so it needs credentials even before anything is created.', cmds: LOCAL_AWS },
    aws: { billable: ['EC2 instance hours', 'Public IPv4 address hours', 'EBS root volume', 'Data transfer out'], steps: AWS_STEPS('`curl -v "$(terraform output -raw url)"` returns the page. If it times out, check the association and the security group; if it is refused, check the user-data log (`aws ec2 get-console-output --instance-id <id>`).'),
      cleanup: ['`terraform destroy` removes everything Build 2 created.'], gone: VERIFY_GONE },
    refs: ['REG-VPC', 'REG-SGIN', 'REG-INST', 'REG-AMI', 'AWS-RT', 'AWS-IGW', 'AWS-SG', 'AWS-USERDATA', 'AWS-AL2023']
  });

  /* ═══ Build 3 ═════════════════════════════════════════════════════ */
  var B3 = 'b3-private-nat/reference';
  LX.tfsLabs.push({
    id: 'b3', module: 'm4', title: 'Build 3: private worker with outbound internet access', mins: 30, kind: 'aws', dir: 'b3-private-nat',
    files: ['main.tf', 'variables.tf', 'outputs.tf'],
    brief: 'A worker that can reach the internet but cannot be reached from it:\n\n- VPC with non-overlapping public and private subnets.\n- Public route table: default route to the internet gateway.\n- Elastic IP and a public NAT gateway in the public subnet.\n- Private route table: default route to the NAT gateway, explicitly associated with the private subnet.\n- Worker EC2 instance in the private subnet: no public IPv4, no inbound internet rule, outbound access it needs.\n- Outputs: both subnet IDs, the worker\'s private address and the NAT gateway ID.\n- Correct references and dependencies; no made-up resource IDs.\n\nThe scaffold starts with the public half copied from Build 2\'s network; you add the rest.',
    success: ['NAT gateway with an Elastic IP in the public subnet', 'Private subnet associated with a table routing 0.0.0.0/0 to the NAT gateway', 'Worker: private subnet, no public IPv4, no ingress, HTTPS egress, waits for the route', 'All four outputs'],
    levels: { guided: { src: 'b3-private-nat/guided' }, scaffolded: { src: 'b3-private-nat/scaffolded' }, requirements: { blank: true }, interview: { blank: true, mins: 45 } },
    variants: { base: { label: 'Base (10.50.0.0/16)', checks: natChecks(null), solution: B3, alternatives: [{ text: 'An S3 gateway endpoint on the private route table (Lesson 4.2) can sit alongside the NAT gateway; it does not replace it for non-AWS destinations.' }] } },
    hints: ['Two route tables: public → internet gateway, private → NAT gateway. The NAT gateway lives where the internet route is.', 'aws_eip → aws_nat_gateway (public subnet, depends_on IGW) → private aws_route_table → aws_route (nat_gateway_id) → association → worker group (egress only) → worker instance (associate_public_ip_address = false, depends_on the private route)', 'resource "aws_route" "private_default" {\n  route_table_id         = aws_route_table.private.id\n  destination_cidr_block = "0.0.0.0/0"\n  nat_gateway_id         = aws_nat_gateway.main.id\n}'],
    why: 'Outbound traffic follows private table → NAT (public subnet) → public table → IGW; replies return through the NAT translation; nothing outside can start a connection because the worker has no public address and its group has no ingress.',
    mistakes: ['NAT gateway in the private subnet', 'gateway_id instead of nat_gateway_id', 'Missing private association', 'A public IP on the worker', 'Worker boots before egress exists'],
    oral: ['Trace the worker\'s request out and the reply back.', 'Why is one NAT gateway a training design, and what would production use?', 'Why does the worker need no ingress rule for the replies?'],
    faults: [
      { id: 'F1', title: 'NAT gateway in the private subnet', edits: [['  subnet_id     = aws_subnet.public.id\n  tags          = merge(local.tags, { Name = "${var.name}-nat" })', '  subnet_id     = aws_subnet.private.id\n  tags          = merge(local.tags, { Name = "${var.name}-nat" })']], expect: 'natpub',
        symptom: 'Everything applies. The worker\'s first-boot `dnf install` times out, and so does any outbound call.', diagnosis: 'The NAT gateway sends traffic according to its own subnet\'s route table. In the private subnet that table points 0.0.0.0/0 back at the NAT gateway, so nothing reaches the internet gateway.', fix: 'subnet_id = aws_subnet.public.id', explain: 'A public NAT gateway belongs in a subnet whose route table reaches the internet gateway.' },
      { id: 'F2', title: 'Missing private route-table association', edits: [['resource "aws_route_table_association" "private" {\n  subnet_id      = aws_subnet.private.id\n  route_table_id = aws_route_table.private.id\n}\n', ''], ['  depends_on = [aws_route.private_default, aws_route_table_association.private]', '  depends_on = [aws_route.private_default]']], expect: 'privroute',
        symptom: 'Applies cleanly; the private route table even shows the NAT route. The worker still has no outbound access.', diagnosis: 'With no explicit association, the private subnet uses the VPC\'s main route table, which has only the local route.', fix: 'resource "aws_route_table_association" "private" {\n  subnet_id      = aws_subnet.private.id\n  route_table_id = aws_route_table.private.id\n}', explain: 'A route table does nothing until a subnet uses it.' },
      { id: 'F3', title: 'Private default route targets the internet gateway', edits: [['  nat_gateway_id         = aws_nat_gateway.main.id', '  gateway_id             = aws_internet_gateway.main.id']], expect: 'privroute',
        symptom: 'Applies cleanly. The worker\'s outbound calls time out.', diagnosis: 'An internet gateway only translates for instances that have a public IPv4 address. The worker has none, so its traffic cannot use the IGW — and the subnet is no longer outbound-only by design.', fix: 'nat_gateway_id = aws_nat_gateway.main.id', explain: 'Private subnets send 0.0.0.0/0 to the NAT gateway; only the NAT gateway\'s own subnet routes to the IGW.' },
      { id: 'F4', title: 'Worker accidentally assigned a public IP', edits: [['  associate_public_ip_address = false', '  associate_public_ip_address = true']], expect: 'nopublic',
        symptom: 'Everything works — which is the problem: the worker now has a public address.', diagnosis: 'A public IPv4 on an instance in a NAT-routed subnet is pointless for egress and makes the instance addressable from the internet the moment someone adds an ingress rule or an IGW route.', fix: 'associate_public_ip_address = false', explain: 'Private means no public address and no inbound path; the security group is the second layer, not the only one.' },
      { id: 'F5', title: 'Bootstrap runs before egress exists', edits: [['\n  # The bootstrap needs egress through the NAT gateway at first boot.\n  depends_on = [aws_route.private_default, aws_route_table_association.private]\n', '\n']], expect: 'bootdep',
        symptom: 'Sometimes the worker is fine; sometimes its user-data log shows `dnf install` failing with timeouts. Re-running apply "fixes" nothing.', diagnosis: 'The instance references only its subnet and group, so Terraform may launch it while the NAT route is still being created. User data runs once at first boot and fails then.', fix: 'depends_on = [aws_route.private_default, aws_route_table_association.private]', explain: 'A narrow explicit dependency states the one ordering requirement no reference captures.' }
    ],
    local: { note: 'validate passes without credentials; it cannot see any of the five faults above, because each is valid configuration.', cmds: LOCAL_AWS },
    aws: { billable: ['NAT gateway hours and per-GB processing', 'Elastic IP / public IPv4 hours', 'EC2 instance hours', 'EBS root volume'], steps: AWS_STEPS('the worker has no public address, so check egress from its user-data log: `aws ec2 get-console-output --instance-id <id> --latest` should show the dnf install succeeding.'),
      cleanup: ['`terraform destroy`. NAT gateways take a few minutes to delete; the Elastic IP is released after it.'], gone: VERIFY_GONE },
    refs: ['AWS-NAT', 'AWS-NAT-USE', 'REG-NAT', 'REG-EIP', 'AWS-RT', 'AWS-VPCPRICE']
  });

  /* ═══ Module 5 exercises ═════════════════════════════════════════ */
  LX.tfsLabs.push({
    id: 'b5a', module: 'm5', title: 'Exercise 5.1: map-driven subnets with for_each', mins: 8, kind: 'aws', dir: 'b5-iteration', refactor: true,
    files: ['main.tf', 'variables.tf', 'outputs.tf'],
    brief: 'Two private subnets and their associations are written out by hand, and one association points at the wrong subnet. Replace them with one `for_each` subnet block driven by a map variable, one association per subnet keyed the same way, and an output map of subnet IDs. `terraform validate` passes on the starting files — the bug is behaviour, not syntax.',
    success: ['One aws_subnet block with for_each over a map', 'Associations iterate over the subnets', 'Output derived from the collection'],
    levels: { scaffolded: { src: 'b5-iteration/foreach-start', note: 'Refactoring exercise: every level starts from the existing code.' }, requirements: { src: 'b5-iteration/foreach-start' }, interview: { src: 'b5-iteration/foreach-start', mins: 10 } },
    variants: { base: { label: 'Base', checks: function () { var C = K(); return [C.forEachSubnets, C.forEachAssoc, C.forEachOutput, C.typedVars]; }, solution: 'b5-iteration/foreach-reference', alternatives: [{ text: 'map(string) of CIDRs is enough if every subnet uses the same AZ rule.' }] } },
    hints: ['Data that differs per subnet goes in a map; the block is written once.', 'variable "private_subnets" { type = map(object({ cidr = string, az_suffix = string })) … }\nresource "aws_subnet" "private" { for_each = var.private_subnets … }\nresource "aws_route_table_association" "private" { for_each = aws_subnet.private … }', 'output "private_subnet_ids" {\n  value = { for key, subnet in aws_subnet.private : key => subnet.id }\n}'],
    why: 'Stable keys give stable addresses (aws_subnet.private["a"]), and iterating the association over the subnet collection makes a missing or crossed association impossible.',
    mistakes: ['count over a list (index shifts)', 'for_each over a list (needs a map or set)', 'Leaving one hand-written subnet behind'],
    oral: ['Why does iterating the association over aws_subnet.private remove a whole class of bugs?', 'What happens to existing subnets if you change from hand-written resources to for_each without moved blocks?'],
    local: { note: 'validate passes on both the start and the reference; only the reference is correct.', cmds: LOCAL_AWS }, aws: null,
    refs: ['TF-FOREACH', 'TF-COUNT']
  });
  LX.tfsLabs.push({
    id: 'b5b', module: 'm5', title: 'Exercise 5.2: parameterise a hard-coded CIDR and instance type', mins: 5, kind: 'aws', dir: 'b5-iteration', refactor: true,
    files: ['main.tf', 'variables.tf', 'outputs.tf'],
    brief: 'The VPC CIDR, the subnet CIDR and the instance type are literals. Make the VPC CIDR and instance type typed variables (keep today\'s values as defaults), derive the subnet CIDR from the VPC CIDR, and add validation where it prevents a real mistake.',
    success: ['VPC CIDR and instance type from typed variables', 'Subnet CIDR derived from the VPC CIDR'],
    levels: { scaffolded: { src: 'b5-iteration/param-start', note: 'Refactoring exercise: every level starts from the existing code.' }, requirements: { src: 'b5-iteration/param-start' } },
    variants: { base: { label: 'Base', checks: function () { var C = K(); return [C.paramCidr, C.derivedSubnet, C.typedVars, C.validation]; }, solution: 'b5-iteration/param-reference', alternatives: [{ text: 'A separate subnet_cidr variable is fine if you validate that it falls inside the VPC range.' }] } },
    hints: ['What changes between environments becomes an input; what follows from it becomes a local.', 'variable "vpc_cidr" { type; default; validation }  variable "instance_type" { … }\nlocals { app_subnet_cidr = cidrsubnet(var.vpc_cidr, 8, 1) }', 'validation {\n  condition     = contains(["t3.micro", "t3.small", "t3.medium"], var.instance_type)\n  error_message = "Choose an x86_64 t3 size."\n}'],
    why: 'Defaults keep today\'s behaviour (the plan shows no changes), while the next environment changes one value instead of three.',
    mistakes: ['Changing the default values while refactoring (the plan then replaces the VPC)', 'Validation that rejects legitimate values'],
    oral: ['How would you prove a refactor like this changed nothing? (Plan shows no changes.)'],
    local: { note: 'After the refactor, a real plan against already-applied infrastructure should show no changes — that is the test of a safe refactor.', cmds: LOCAL_AWS }, aws: null,
    refs: ['TF-VARS', 'TF-LOCALS']
  });

  /* ═══ Build 4 ═════════════════════════════════════════════════════ */
  LX.tfsLabs.push({
    id: 'b4', module: 'm6', title: 'Build 4: independent private worker environment', mins: 45, kind: 'aws', dir: 'b4-independent', independent: true,
    files: ['main.tf', 'variables.tf', 'outputs.tf'],
    brief: 'Harbor Jobs needs an environment for a background worker. Requirements:\n\n- Region input, default `us-east-2`; name prefix input, default `harbor-jobs`.\n- VPC `10.80.0.0/16`.\n- A public **egress** subnet `10.80.0.0/24` and a private **worker** subnet `10.80.20.0/24`.\n- A public NAT gateway giving the worker subnet outbound access.\n- One EC2 worker in the private subnet: no public IPv4, no inbound internet access, HTTPS out.\n- Typed inputs; a tags map applied to resources (callers may add extra tags).\n- Outputs: both subnet IDs, the worker\'s private IP and the NAT gateway ID.\n\nTime budget: 5 minutes clarifying and designing (write your outline in the notes), 25 implementing, 10 checking and fixing, 5 explaining.',
    budget: [['Clarify and design', 5], ['Implement', 25], ['Check and fix', 10], ['Explain', 5]],
    change: { at: 'halfway', prompt: 'Change request (optional): add a second private subnet `10.80.21.0/24` for a future worker, using the same private route table. No high-availability redesign is needed.',
      checks: function () { return [c('change', 'A second private subnet associated with the NAT-routed table', function (M) { var priv = M.all('aws_subnet').filter(function (s) { var r = M.rtFor(s), d = M.defaultRoute(r.rt); return r.how === 'explicit' && d && d.target.kind === 'nat'; }); var n = priv.reduce(function (k, s) { return k + ((M.instancesOf(s) || [1]).length); }, 0); return n >= 2 ? true : 'only ' + n + ' private subnet(s) use the NAT-routed table'; }, { cat: 'routing', dim: 'core' })]; }, solution: 'b4-independent/change-reference' },
    success: ['Everything Build 3 required, with the new names and ranges', 'Typed inputs and tags', 'Recorded as independent only without hints or solutions'],
    levels: { requirements: { blank: true }, interview: { blank: true, mins: 45 }, scaffolded: { src: 'b3-private-nat/scaffolded', note: 'Fallback only: the Build 3 scaffold with Build 3\'s defaults. Using it makes this attempt assisted.' } },
    variants: { base: { label: 'Harbor Jobs (10.80.0.0/16)', checks: natChecks('10.80.0.0/16', { subnets: ['10.80.0.0/24', '10.80.20.0/24'], tags: true }), solution: 'b4-independent/reference', alternatives: [{ text: 'Tags through provider default_tags satisfy the tag requirement as well as a merged local map.' }] } },
    hints: ['Same shape as Build 3. Start by listing resources and the reference each needs before typing.', 'Outline: vpc · 2 subnets · igw · public rt/route/assoc · eip · nat · private rt/route/assoc · worker sg + egress · ami lookup · worker · 4 outputs', 'locals {\n  tags = merge({ project = var.name, managed_by = "terraform" }, var.extra_tags)\n}'],
    why: 'Doing it from blank files shows which relationships you can produce without prompts — the skill the screen measures.',
    mistakes: ['Re-using Build 3\'s CIDRs', 'Skipping the clarify step', 'Leaving the private association out under time pressure'],
    oral: ['Explain your design in two minutes before you type.', 'What did you leave out deliberately, and why?'],
    local: { note: 'validate is your fastest correctness signal in the real interview if a CLI is available; it still says nothing about routing.', cmds: LOCAL_AWS },
    aws: { billable: ['NAT gateway hours and per-GB processing', 'Elastic IP / public IPv4 hours', 'EC2 instance hours'], steps: AWS_STEPS('worker console output shows the bootstrap succeeded.'), cleanup: ['`terraform destroy`.'], gone: VERIFY_GONE },
    refs: ['AWS-NAT', 'REG-NAT', 'AWS-RT']
  });

  /* ═══ Stretch ═════════════════════════════════════════════════════ */
  LX.tfsLabs.push({
    id: 'stretch', module: 'm6', title: 'Stretch: two-AZ web application behind an ALB', mins: 75, kind: 'aws', dir: 'stretch-alb', optional: true,
    files: ['main.tf', 'variables.tf', 'outputs.tf'],
    brief: 'Only after the core. Two public and two private subnets across two AZs; an internet-facing Application Load Balancer in the public subnets; private EC2 targets in both AZs; a target group on the application port with a health check; a listener forwarding to it; an ALB security group, and application ingress restricted to the ALB security group. State your egress/bootstrap strategy and the HA and cost tradeoffs. This is a stretch architecture, not something to finish in a 45-minute screen.',
    design: ['Two AZs, each with one public and one private subnet (for_each over a two-entry map keeps it short).', 'One NAT gateway in AZ a for egress (cost-conscious; say that AZ a is now a shared dependency).', 'ALB security group: TCP 80 from 0.0.0.0/0 in; out only to the app port on the app group.', 'App security group: app port only from the ALB group; HTTPS out for patches.', 'Targets: one instance per private subnet; Python\'s built-in web server on the app port means first boot downloads nothing.', 'Listener :80 → target group (port = app port, health check path "/") → one attachment per instance.', 'Registered targets are not healthy targets: the ALB sends traffic only to targets passing the health check.'],
    success: ['ALB internet-facing in both public subnets', 'Listener → target group → two registered targets with a health check', 'Targets private, ingress only from the ALB group', 'Egress strategy stated'],
    levels: { guided: { blank: true, design: true, note: 'Guided here means the design walkthrough below, with blank files.' }, requirements: { blank: true } },
    variants: { base: { label: 'Base', checks: function () { var C = K(); return [C.pinned, C.noSecrets, C.vpc(null), C.subnets(), C.igw, C.publicRoute, C.natPublic, C.privateRoute, C.workerPrivate, C.albPublic, C.albChain, C.appFromAlb, C.noWorldAdmin, C.sgStyle, C.workerEgress]; }, solution: 'stretch-alb/reference', alternatives: [{ text: 'One NAT gateway per AZ with per-AZ private route tables removes the shared dependency at higher cost.' }] } },
    hints: ['Traffic path: client → ALB (public subnets) → target group → healthy targets (private subnets). Security groups chain: internet → ALB group → app group.', 'aws_lb (subnets = both public) · aws_lb_target_group (port, vpc_id, health_check) · aws_lb_listener (default_action forward) · aws_lb_target_group_attachment (for_each over instances)', 'resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {\n  security_group_id            = aws_security_group.app.id\n  ip_protocol                  = "tcp"\n  from_port                    = var.app_port\n  to_port                      = var.app_port\n  referenced_security_group_id = aws_security_group.alb.id\n}'],
    why: 'Only the load balancer is public; targets accept traffic only from it; the health check decides which registered targets receive requests.',
    mistakes: ['ALB in one AZ only', 'App group open to 0.0.0.0/0', 'Target group on port 80 while the app listens on 8080', 'Assuming "registered" means "healthy"'],
    oral: ['Explain listener → target group → target, and the difference between registered and healthy.', 'What are the HA and cost costs of one NAT gateway here?'],
    local: { note: 'validate passes on the reference; nothing here is checked against AWS.', cmds: LOCAL_AWS },
    aws: { billable: ['Application Load Balancer hours and LCUs', 'NAT gateway hours and per-GB processing', 'Elastic IP / public IPv4 hours', 'Two EC2 instances'], steps: AWS_STEPS('`curl -v "$(terraform output -raw url)"`; `aws elbv2 describe-target-health --target-group-arn <arn>` shows healthy targets.'), cleanup: ['`terraform destroy`.'], gone: VERIFY_GONE + '\naws elbv2 describe-load-balancers --query "LoadBalancers[].LoadBalancerArn"' },
    refs: ['AWS-ALB', 'REG-LB', 'AWS-NAT', 'AWS-SG']
  });
})();
