/* Anduril Round 1 prep — Terraform labs T1–T4.

   Each lab: requirements (the prompt, kept apart from answers), expected
   invariants as structural checks over the parsed configuration (graph and
   values, never names or exact text), reference solution and alternative
   valid approaches (embedded from labs/anduril-round1/terraform via
   LX.ar1TfSrc — the same files validate-all.sh checks with the real CLI),
   common mistakes, four hint rungs (conceptual → evidence → partial
   structure → full solution), an explanation rubric and local verification
   commands. Checks run LXHcl at call time, never at load time. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.ar1Tf = LX.ar1Tf || [];

(function () {
  function H() { return window.LXHcl; }
  function K(v) { return H().known(v); }
  function first(a) { return a && a.length ? a[0] : null; }
  function vpcOf(M) { return first(M.all('aws_vpc')); }
  function publicSubnets(M) { return M.all('aws_subnet').filter(function (s) { return M.isPublicSubnet(s); }); }
  function rulesIn(M, sg, dir) { return M.sgRules(sg).filter(function (r) { return r.dir === dir; }); }
  function instSg(M, inst) { return first(M.sgsOf(inst)); }
  function theInstance(M) { return first(M.all('aws_instance')); }
  function str(v) { return K(v) ? JSON.stringify(v) : '(not known until apply)'; }

  /* ── reusable checks ─────────────────────────────────────────── */
  var C = {
    pinned: { id: 'pin', label: 'AWS provider declared in required_providers with a version constraint', hint: 'terraform { required_providers { aws = { source = "hashicorp/aws", version = "~> 6.60" } } }',
      test: function (M) { var p = M.providerPin(); if (!p) return 'no required_providers entry for aws'; if (!p.version) return 'aws has no version constraint — runs would pick whatever is newest'; if (p.source && !/hashicorp\/aws$/.test(p.source)) return 'source is ' + p.source; return true; } },
    noSecrets: { id: 'secrets', sev: 'critical', label: 'No credentials in the configuration', hint: 'Let the provider use the normal credential chain (AWS_PROFILE, SSO, environment).',
      test: function (M) { var s = M.embeddedSecrets(); return s.length ? s.join('; ') : true; } },
    vpc: function (cidr) {
      return { id: 'vpc', label: 'A VPC' + (cidr ? ' with CIDR ' + cidr : ' with a valid IPv4 CIDR'), hint: 'resource "aws_vpc" with cidr_block' + (cidr ? ' = "' + cidr + '" (directly or through a variable default)' : ''),
        test: function (M) {
          var v = vpcOf(M); if (!v) return 'no aws_vpc resource';
          var c = M.val(v, 'cidr_block');
          if (!K(c)) return cidr ? 'cidr_block cannot be read (give the variable a default of ' + cidr + ')' : true;
          if (!H().cidr(c)) return 'cidr_block ' + str(c) + ' is not an IPv4 CIDR';
          if (!H().cidr(c).aligned) return str(c) + ' has host bits set; AWS rejects it — use ' + H().cidr(c).str;
          if (cidr && c !== cidr) return 'cidr_block is ' + str(c) + ', the requirement says ' + cidr;
          return true;
        } };
    },
    subnetInVpc: { id: 'subnet', label: 'A subnet in that VPC whose CIDR sits inside the VPC range', hint: 'aws_subnet with vpc_id = aws_vpc.<name>.id and a cidr_block inside the VPC (cidrsubnet() helps).',
      test: function (M) {
        var v = vpcOf(M), subs = M.all('aws_subnet'); if (!subs.length) return 'no aws_subnet';
        var bad = [];
        for (var i = 0; i < subs.length; i++) {
          var s = subs[i];
          if (M.points(s, 'vpc_id', 'aws_vpc') !== v) { bad.push('subnet "' + s.name + '": vpc_id does not reference the VPC resource'); continue; }
          var sc = M.val(s, 'cidr_block'), vc = M.val(v, 'cidr_block');
          if (K(sc) && K(vc) && !H().within(sc, vc)) bad.push('subnet "' + s.name + '": ' + sc + ' is outside ' + vc);
        }
        var pairs = [];
        subs.forEach(function (a, i) { subs.slice(i + 1).forEach(function (b) { var x = M.val(a, 'cidr_block'), y = M.val(b, 'cidr_block'); if (K(x) && K(y) && H().overlaps(x, y)) pairs.push(a.name + '/' + b.name); }); });
        if (pairs.length) bad.push('overlapping subnets: ' + pairs.join(', '));
        return bad.length ? bad.join('; ') : true;
      } },
    igw: { id: 'igw', label: 'An internet gateway attached to the VPC', hint: 'resource "aws_internet_gateway" with vpc_id = aws_vpc.<name>.id',
      test: function (M) { return M.igwFor(vpcOf(M)) ? true : (M.all('aws_internet_gateway').length ? 'the internet gateway is not attached to the VPC (vpc_id or aws_internet_gateway_attachment)' : 'no aws_internet_gateway'); } },
    publicRoute: { id: 'route', label: 'A subnet that uses a route table with 0.0.0.0/0 → the internet gateway', defect: 'routing',
      hint: 'aws_route_table in the VPC, a default route (inline route {} or aws_route) with gateway_id = the IGW, and aws_route_table_association for the subnet.',
      test: function (M) {
        if (publicSubnets(M).length) return true;
        var subs = M.all('aws_subnet'); if (!subs.length) return 'no subnet';
        var why = subs.map(function (s) {
          var r = M.rtFor(s);
          if (!r.rt) return 'subnet "' + s.name + '" has no route-table association, so it uses the VPC\'s main route table (which only has the local route)';
          var d = M.defaultRoute(r.rt);
          if (!d) return 'subnet "' + s.name + '" uses route table "' + r.rt.name + '", which has no 0.0.0.0/0 route';
          if (d.target.kind !== 'igw') return 'the default route in "' + r.rt.name + '" targets ' + (d.target.attr || 'nothing') + (d.target.kind === 'unresolved' ? ' (not a resource in this configuration)' : ' (' + d.target.kind + ')') + ', not the internet gateway';
          return 'subnet "' + s.name + '": route not usable';
        });
        return why.join('; ');
      } },
    routeStyle: { id: 'routestyle', label: 'Each route table uses one route style (inline route blocks or aws_route, not both)',
      hint: 'The provider docs say inline routes and aws_route resources for the same table conflict.',
      test: function (M) { var bad = M.all('aws_route_table').filter(function (rt) { var r = M.routesOf(rt); return r.some(function (x) { return x.style === 'inline'; }) && r.some(function (x) { return x.style === 'resource'; }); }); return bad.length ? 'route table "' + bad[0].name + '" mixes inline routes with aws_route resources' : true; } },
    sgStyle: { id: 'sgstyle', label: 'Each security group uses one rule style (not inline blocks plus separate rule resources)',
      hint: 'Pick inline ingress/egress blocks or aws_vpc_security_group_*_rule resources for a group, never both.',
      test: function (M) { var bad = M.all('aws_security_group').filter(function (sg) { var st = {}; M.sgRules(sg).forEach(function (r) { st[r.style === 'inline' ? 'inline' : 'separate'] = 1; }); return st.inline && st.separate; }); return bad.length ? 'security group "' + bad[0].name + '" mixes inline rules with separate rule resources — they overwrite each other' : true; } },
    sgInVpc: { id: 'sgvpc', label: 'Security groups are created in the VPC (vpc_id references it)', defect: 'reference',
      hint: 'Without vpc_id a security group is created in the Region\'s default VPC, and an instance in your subnet cannot use it.',
      test: function (M) { var v = vpcOf(M); var bad = M.all('aws_security_group').filter(function (sg) { return M.points(sg, 'vpc_id', 'aws_vpc') !== v; }); return bad.length ? 'security group "' + bad[0].name + '" has ' + (M.has(bad[0], 'vpc_id') ? 'a vpc_id that does not reference the VPC' : 'no vpc_id, so AWS puts it in the default VPC') : true; } },
    noWorldAdmin: { id: 'admin', sev: 'critical', label: 'No SSH/RDP or all-traffic ingress from 0.0.0.0/0 or ::/0',
      hint: 'Restrict SSH to an admin CIDR variable, or leave it out and use Session Manager.',
      test: function (M) {
        var hits = [];
        M.all('aws_security_group').forEach(function (sg) { M.sgRules(sg).forEach(function (r) { if (r.dir === 'ingress' && H().worldOpen(r) && (r.proto === '-1' || H().covers(r, 22) || H().covers(r, 3389))) hits.push(sg.name + ': ' + (r.proto === '-1' ? 'all traffic' : 'ports ' + r.from + '-' + r.to) + ' from the internet'); }); });
        return hits.length ? hits.join('; ') : true;
      } },
    egress: { id: 'egress', label: 'Security groups declare the egress they need', hint: 'Terraform removes AWS\'s default allow-all egress rule when it manages a group, so declare egress (for example TCP 443 to 0.0.0.0/0).',
      test: function (M) { var insts = M.all('aws_instance'), sgs = insts.length ? [].concat.apply([], insts.map(function (i) { return M.sgsOf(i); })) : M.all('aws_security_group'); var bad = sgs.filter(function (sg) { return sg && !rulesIn(M, sg, 'egress').length; }); return bad.length ? 'security group "' + bad[0].name + '" has no egress rules, so the instance cannot reach package repositories or APIs' : true; } }
  };
  /* ingress requirement on the group the instance (or any group) uses */
  function ingress(port, from, label, defect) {
    return { id: 'in' + port, label: label, defect: defect || null,
      hint: from === 'world' ? 'An ingress rule for TCP ' + port + ' with cidr_ipv4 = "0.0.0.0/0".' : from === 'sg' ? 'Reference the other security group (referenced_security_group_id, or security_groups in an inline block) instead of a CIDR.' : 'An ingress rule for TCP ' + port + ' from ' + from + ' only.',
      test: function (M) {
        var inst = theInstance(M), sgs = inst ? M.sgsOf(inst) : M.all('aws_security_group');
        if (!sgs.length) return inst ? 'the instance has no security group from this configuration (vpc_security_group_ids)' : 'no security group';
        var rules = [];
        sgs.forEach(function (sg) { rulesIn(M, sg, 'ingress').forEach(function (r) { if (H().covers(r, port)) rules.push(r); }); });
        if (!rules.length) return 'no ingress rule covers TCP ' + port;
        var ok = rules.some(function (r) {
          if (from === 'world') return H().worldOpen(r);
          if (from === 'sg') return r.sgs.length > 0;
          if (from === 'var') return r.cidrs.length > 0 && r.cidrs.every(function (c) { return !K(c) || (c !== '0.0.0.0/0' && c !== '::/0'); });
          return r.cidrs.some(function (c) { return c === from; });
        });
        if (!ok) {
          var seen = rules.map(function (r) { return r.sgs.length ? 'security group ' + r.sgs.map(function (s) { return s && s.name; }).join(',') : r.cidrs.map(function (c) { return K(c) ? c : '(computed)'; }).join(','); }).join('; ');
          return 'TCP ' + port + ' is allowed from ' + seen + ' — the requirement is ' + (from === 'world' ? 'anywhere (0.0.0.0/0)' : from === 'sg' ? 'only the referenced security group' : from === 'var' ? 'an admin range that is not the whole internet' : from);
        }
        var tooWide = rules.filter(function (r) { return from !== 'world' && H().worldOpen(r); });
        if (tooWide.length) return 'TCP ' + port + ' is also open to the whole internet';
        return true;
      } };
  }
  function noExtraWorld(allowed) {
    return { id: 'leastpriv', label: 'Nothing else is open to the internet (only TCP ' + allowed.join(', ') + ')', sev: 'required',
      hint: 'Remove ingress rules the requirements did not ask for.',
      test: function (M) {
        var extra = [];
        M.all('aws_security_group').forEach(function (sg) { rulesIn(M, sg, 'ingress').forEach(function (r) { if (!H().worldOpen(r)) return; if (r.proto === '-1') { extra.push('all traffic'); return; } if (!K(r.from) || !K(r.to)) return; for (var p = Number(r.from); p <= Number(r.to); p++) { if (allowed.indexOf(p) === -1) { extra.push(r.from === r.to ? 'TCP ' + r.from : 'TCP ' + r.from + '-' + r.to); return; } } }); });
        return extra.length ? 'also open to the internet: ' + extra.join(', ') : true;
      } };
  }
  function noIngressPort(port) {
    return { id: 'no' + port, label: 'No ingress on TCP ' + port + ' at all', sev: 'required', hint: 'The requirement says no ' + (port === 22 ? 'SSH' : 'access on ' + port) + '.',
      test: function (M) { var hit = M.all('aws_security_group').some(function (sg) { return rulesIn(M, sg, 'ingress').some(function (r) { return H().covers(r, port); }); }); return hit ? 'an ingress rule still covers TCP ' + port : true; } };
  }
  var I = {
    exists: { id: 'inst', label: 'An EC2 instance in the public subnet, using a security group from this configuration',
      hint: 'aws_instance with subnet_id = the public subnet and vpc_security_group_ids = [aws_security_group.<name>.id].',
      test: function (M) { var i = theInstance(M); if (!i) return 'no aws_instance'; var sn = M.points(i, 'subnet_id', 'aws_subnet'); if (!sn) return 'subnet_id does not reference a subnet in this configuration (it would launch in the default VPC)'; if (!M.isPublicSubnet(sn)) return 'the instance\'s subnet "' + sn.name + '" has no route to the internet gateway'; if (!M.sgsOf(i).length) return 'vpc_security_group_ids does not reference a security group from this configuration'; return true; } },
    publicIp: { id: 'pubip', label: 'The instance gets a public IPv4 address', hint: 'map_public_ip_on_launch on the subnet, associate_public_ip_address on the instance, or an aws_eip with domain = "vpc".',
      test: function (M) { var i = theInstance(M); return i && M.instancePublic(i) ? true : 'no public IPv4: an internet gateway only works for instances with a public or Elastic IP'; } },
    ami: { id: 'ami', sev: 'advice', label: 'AMI comes from a lookup or a variable, not a hard-coded ID', hint: 'data "aws_ami" with owners and a name filter, the public SSM parameter, or a variable.',
      test: function (M) { var i = theInstance(M); var s = i && M.amiSource(i); return s && s !== 'hard-coded' ? true : 'a hard-coded AMI ID only works in one Region and goes stale — say so if you choose it'; } },
    imds: function (sev) { return { id: 'imds', sev: sev || 'advice', label: 'Instance metadata requires IMDSv2 tokens', hint: 'metadata_options { http_tokens = "required" }',
      test: function (M) { var i = theInstance(M); var mo = i && first(M.sub(i, 'metadata_options')); return mo && M.val(mo, 'http_tokens') === 'required' ? true : 'http_tokens is not "required"'; } }; },
    service: { id: 'svc', sev: 'advice', label: 'Something actually starts the service (user_data or a stated plan)', hint: 'An allowed port is not a listening process. user_data, a baked AMI or configuration management has to start it.',
      test: function (M) { var i = theInstance(M); return i && (M.has(i, 'user_data') || M.has(i, 'user_data_base64') || M.has(i, 'launch_template')) ? true : 'nothing in the configuration starts the service — fine if you say how it gets there'; } }
  };
  /* outputs whose values reference particular attributes */
  function outputs(spec) {
    return { id: 'outputs', label: 'Outputs: ' + spec.map(function (s) { return s.label; }).join(', '), hint: 'output "<name>" { value = <resource>.<name>.<attribute> }',
      test: function (M) {
        var missing = spec.filter(function (s) {
          return !M.outputs.some(function (o) {
            var ast = M.ast(o, 'value'); if (!ast) return false;
            var refs = M.refsOf(ast);
            if (s.template && ast.t !== 'tpl') return false;
            return refs.some(function (r) { return r.kind === 'resource' && s.attrs.some(function (a) { return a[0] === r.type && a[1] === r.attr; }); });
          });
        });
        return missing.length ? 'missing an output for: ' + missing.map(function (s) { return s.label; }).join(', ') : true;
      } };
  }
  var OUT = {
    instanceId: { label: 'instance ID', attrs: [['aws_instance', 'id']] },
    publicIp: { label: 'public IP', attrs: [['aws_instance', 'public_ip'], ['aws_eip', 'public_ip']] },
    publicDns: { label: 'public DNS name', attrs: [['aws_instance', 'public_dns'], ['aws_eip', 'public_dns']] },
    url: { label: 'URL built from the public DNS name', attrs: [['aws_instance', 'public_dns'], ['aws_eip', 'public_dns'], ['aws_instance', 'public_ip'], ['aws_eip', 'public_ip']], template: true },
    privateIp: { label: 'private IP', attrs: [['aws_instance', 'private_ip']] },
    sgId: { label: 'security group ID', attrs: [['aws_security_group', 'id']] },
    vpcId: { label: 'VPC ID', attrs: [['aws_vpc', 'id']] },
    subnetId: { label: 'subnet ID', attrs: [['aws_subnet', 'id']] }
  };

  var VERIFY = function (dir) {
    return [
      { title: 'Real checks on your Mac (no AWS account needed)', cmds: 'cd labs/anduril-round1/terraform/' + dir + '\nterraform fmt -check        # style only\nterraform init -backend=false   # downloads hashicorp/aws (needs network)\nterraform validate          # configuration vs provider schema; no AWS calls',
        note: 'These are actual checks, run by the real CLI. They still do not prove AWS will accept the values or that traffic flows.' },
      { title: 'Plan (needs credentials; makes read-only API calls)', cmds: 'export AWS_PROFILE=<a sandbox profile>\nterraform plan -var admin_cidr="$(curl -s https://checkip.amazonaws.com)/32"',
        note: 'Optional. plan reads your account (AMI lookups, AZs) and shows what would change. Never treat plan output as proof of connectivity.' },
      { title: 'Apply (optional, deliberate, costs money)', cmds: 'terraform apply   # review the plan, type yes only in a sandbox account\n# … test with curl / nc / ssh from your Mac …\nterraform destroy',
        note: 'Off by default. EC2, Elastic IPs and NAT gateways are billed; check current pricing for your Region and destroy when done. Use a least-privilege sandbox role, never an admin profile from work.' }
    ];
  };

  /* the check builders, for the mock interviews' Terraform tasks */
  LX.ar1TfKit = { C: C, I: I, OUT: OUT, ingress: ingress, noExtraWorld: noExtraWorld, noIngressPort: noIngressPort, outputs: outputs, verify: VERIFY };

  /* ═══ T1 — guided build: public network ═════════════════════════ */
  LX.ar1Tf.push({
    id: 'T1', title: 'Guided build: VPC, public subnet, internet gateway, routes, security group', mins: 35, dir: 'T1-public-network/starter', modes: ['learn', 'practice'],
    files: ['main.tf', 'variables.tf', 'outputs.tf'],
    prompt: 'Write Terraform for a small public network:\n\n- Pin the AWS provider (hashicorp/aws) with a version constraint; Region from a variable.\n- A VPC (any valid private range; 10.20.0.0/16 is fine).\n- One public subnet inside it.\n- An internet gateway attached to the VPC.\n- A route table with a default route to the internet gateway, **associated with the subnet**.\n- A security group in the VPC: HTTPS (443) from anywhere, SSH (22) only from an `admin_cidr` variable, and the egress the host needs (at least HTTPS out).\n- Outputs: VPC ID, subnet ID, security group ID.\n- No credentials in the files.',
    guide: [
      { step: 'Settings', level: 'full', text: 'Start with `terraform { required_providers { aws = { source = "hashicorp/aws", version = "~> 6.60" } } }` and `provider "aws" { region = var.region }`. Declare `variable "region"` with a default.' },
      { step: 'VPC', level: 'full', text: '`resource "aws_vpc" "main" { cidr_block = var.vpc_cidr }` — turn on enable_dns_support and enable_dns_hostnames so instances get DNS names.' },
      { step: 'Subnet', level: 'nudge', text: 'aws_subnet: reference the VPC\'s id; carve the CIDR with cidrsubnet(); pick an AZ.' },
      { step: 'Internet gateway', level: 'nudge', text: 'One resource, one reference.' },
      { step: 'Route table, default route, association', level: 'nudge', text: 'Three relationships: table → VPC, 0.0.0.0/0 → IGW, subnet → table. The last one is the one people forget.' },
      { step: 'Security group and rules', level: 'none', text: '' },
      { step: 'Outputs', level: 'none', text: '' }
    ],
    checks: function () { return [C.pinned, C.noSecrets, C.vpc(null), C.subnetInVpc, C.igw, C.publicRoute, C.routeStyle, C.sgInVpc, ingress(443, 'world', 'HTTPS (443) allowed from anywhere'), ingress(22, 'var', 'SSH (22) allowed only from an admin range'), C.egress, C.sgStyle, C.noWorldAdmin, outputs([OUT.vpcId, OUT.subnetId, OUT.sgId])]; },
    hints: [
      'Conceptual: a subnet is "public" because of the route table it uses, not because of a flag. Think about the three relationships between subnet, route table and internet gateway, and remember that Terraform removes the default egress rule.',
      'Evidence: run the structural checks and read the first failing line — it names the relationship that is missing, not the fix.',
      'Partial structure:\n```\nresource "aws_route_table" "public" { vpc_id = aws_vpc.main.id }\nresource "aws_route" "default" {\n  route_table_id         = aws_route_table.public.id\n  destination_cidr_block = "0.0.0.0/0"\n  gateway_id             = ???\n}\nresource "aws_route_table_association" "public" {\n  subnet_id      = ???\n  route_table_id = ???\n}\nresource "aws_vpc_security_group_ingress_rule" "ssh" {\n  security_group_id = aws_security_group.web.id\n  ip_protocol = "tcp"\n  from_port = 22\n  to_port = 22\n  cidr_ipv4 = ???\n}\n```',
      'Full worked solution (marks this attempt as assisted).'
    ],
    solution: 'T1/reference', alternatives: [{ src: 'T1/alternative', why: 'Inline route and inline security-group rules, literal CIDRs, a fixed AZ, different names. Equally valid; the separate rule resources are what the current provider docs recommend.' }],
    mistakes: [
      'No aws_route_table_association — the subnet silently keeps the main route table.',
      'Mixing inline `ingress {}` blocks with aws_vpc_security_group_ingress_rule on the same group.',
      'Forgetting egress: Terraform deletes the default allow-all egress rule.',
      'SSH from 0.0.0.0/0 "just for the lab".',
      'Hard-coding a VPC ID instead of referencing the resource (no dependency, not reusable).',
      'Putting access keys in the provider block.'
    ],
    rubric: [
      'Explains why the association makes the subnet public',
      'Explains the dependency order Terraform derives from references',
      'Justifies each ingress rule and the egress rule',
      'Says what validate proves and what it does not',
      'Says how they would verify connectivity after an apply'
    ],
    explainAloud: 'Walk an interviewer through your file top to bottom in 60 seconds: what each resource is for and which reference creates which dependency.',
    verify: VERIFY('T1-public-network/starter'),
    refs: ['TF-REQ', 'REG-AWS', 'REG-VPC', 'REG-SG', 'REG-SGIN', 'AWS-RT', 'AWS-IGW']
  });

  /* ═══ T2 — blank editor: an EC2 environment (three variants) ════ */
  LX.ar1Tf.push({
    id: 'T2', title: 'Blank editor: a reachable EC2 instance with explicit access and outputs', mins: 35, dir: 'T2-blank-editor/starter', modes: ['practice', 'interview'],
    files: ['main.tf', 'variables.tf', 'outputs.tf'], blank: true,
    variants: {
      a: { title: 'Variant A — web app on 8080',
        prompt: 'From empty files, write Terraform for:\n\n- AWS provider pinned; Region from a variable.\n- VPC **10.30.0.0/16** with one public subnet and internet access.\n- One EC2 instance (t3.micro, current Amazon Linux) in that subnet.\n- The app listens on **TCP 8080** and must be reachable from anywhere.\n- SSH only from an `admin_cidr` variable. Nothing else inbound.\n- Outputs: the **instance ID** and its **public IP**.\n- No credentials in files; no broad admin access.',
        checks: function () { return [C.pinned, C.noSecrets, C.vpc('10.30.0.0/16'), C.subnetInVpc, C.igw, C.publicRoute, C.routeStyle, C.sgInVpc, I.exists, I.publicIp, ingress(8080, 'world', 'TCP 8080 from anywhere'), ingress(22, 'var', 'SSH only from the admin range'), noExtraWorld([8080]), C.egress, C.sgStyle, C.noWorldAdmin, outputs([OUT.instanceId, OUT.publicIp]), I.ami, I.service, I.imds('advice')]; },
        solution: 'T2/variant-a/reference', alternatives: [{ src: 'T2/variant-a/alternative', why: 'Inline rules and route, the public SSM parameter for the AMI, an Elastic IP instead of auto-assigned public IPs, a local for the CIDR, user_data from a file, allow-all egress. Valid, with trade-offs worth saying out loud (broader egress, EIP charges).' }] },
      b: { title: 'Variant B — partner HTTPS API, no SSH',
        prompt: 'From empty files, write Terraform for:\n\n- AWS provider pinned; Region from a variable.\n- VPC **172.20.0.0/16** with one public subnet and internet access.\n- One EC2 instance (t3.micro, current Amazon Linux) in that subnet.\n- **HTTPS (443) only from the partner range 198.51.100.0/24** (a variable is fine).\n- **No SSH at all** — management is out of scope.\n- Outputs: the instance\'s **public DNS name** and a **URL** (https://<public DNS>/).\n- Require IMDSv2 on the instance.',
        checks: function () { return [C.pinned, C.noSecrets, C.vpc('172.20.0.0/16'), C.subnetInVpc, C.igw, C.publicRoute, C.routeStyle, C.sgInVpc, I.exists, I.publicIp, ingress(443, '198.51.100.0/24', 'HTTPS only from 198.51.100.0/24'), noIngressPort(22), noExtraWorld([]), C.egress, C.sgStyle, C.noWorldAdmin, outputs([OUT.publicDns, OUT.url]), I.ami, I.imds('required')]; },
        solution: 'T2/variant-b/reference', alternatives: [] },
      c: { title: 'Variant C — metrics from a monitoring group (transfer)', transfer: true,
        prompt: 'From empty files, write Terraform for:\n\n- AWS provider pinned; Region from a variable.\n- VPC **10.50.0.0/16** with one public subnet and internet access.\n- A **monitoring** security group (attached to nothing yet) and a **node** security group.\n- One EC2 instance (t3.micro) using the node group: **HTTPS from anywhere**, and **TCP 9100 only from instances in the monitoring group** (reference the group, not a CIDR). No SSH.\n- Require IMDSv2.\n- Outputs: the instance\'s **private IP** and the node **security group ID**.',
        checks: function () { return [C.pinned, C.noSecrets, C.vpc('10.50.0.0/16'), C.subnetInVpc, C.igw, C.publicRoute, C.routeStyle, C.sgInVpc, I.exists, ingress(443, 'world', 'HTTPS from anywhere'), ingress(9100, 'sg', 'TCP 9100 only from the monitoring security group'), noIngressPort(22), noExtraWorld([443]), C.egress, C.sgStyle, C.noWorldAdmin, outputs([OUT.privateIp, OUT.sgId]), I.ami, I.imds('required')]; },
        solution: 'T2/variant-c/reference', alternatives: [] }
    },
    hints: [
      'Conceptual: list the resources before typing — network (VPC, subnet, IGW, route table, route, association), access (security group and rules), compute (AMI lookup, instance), outputs. Each later item references an earlier one.',
      'Evidence: run the structural checks; each failing line names one missing relationship or value.',
      'Partial structure:\n```\ndata "aws_ami" "al2023" {\n  most_recent = true\n  owners      = ["amazon"]\n  filter {\n    name   = "name"\n    values = ["al2023-ami-2023.*-x86_64"]\n  }\n}\nresource "aws_instance" "app" {\n  ami                    = data.aws_ami.al2023.id\n  instance_type          = "t3.micro"\n  subnet_id              = ???\n  vpc_security_group_ids = [???]\n}\noutput "public_ip" { value = ??? }\n```',
      'Full worked solution for this variant (marks this attempt as assisted; retake with another variant for an independent result).'
    ],
    mistakes: [
      'Port allowed is not service started: nothing listens on the port until user_data, an AMI or configuration management starts it.',
      'Instance with no public IP in a public subnet (map_public_ip_on_launch off, no EIP).',
      'SSH from 0.0.0.0/0, or an "allow all" rule to save time.',
      'Opening extra ports the requirement did not ask for.',
      'Using `security_groups` (names, EC2-Classic era) instead of `vpc_security_group_ids` for an instance in a VPC.',
      'Hard-coded AMI ID that only exists in one Region.'
    ],
    rubric: [
      'Clarified requirements before writing (ports, sources, outputs, Region)',
      'Explains every ingress rule and why nothing else is open',
      'Explains how the instance becomes reachable (route, IGW, public IP, SG)',
      'States what is not proven yet (service listening, apply success) and how to test it',
      'Wrote it without generated code'
    ],
    explainAloud: 'Explain how a request from your laptop reaches the service on this instance and how the reply gets back, naming each Terraform resource on the way.',
    verify: VERIFY('T2-blank-editor/starter'),
    refs: ['REG-AWS', 'REG-SG', 'REG-SGIN', 'REG-AMI', 'TF-OUT', 'TF-VARS', 'AWS-EC2-IP']
  });

  /* ═══ T3 — repair and explain ═══════════════════════════════════ */
  LX.ar1Tf.push({
    id: 'T3', title: 'Repair and explain: a configuration that validates but does not work', mins: 18, dir: 'T3-repair/broken', modes: ['practice', 'interview'],
    files: ['main.tf', 'variables.tf', 'outputs.tf'], start: 'T3/broken',
    prompt: 'A teammate\'s configuration passes `terraform validate`, but after apply nobody on the internet can reach https://<web_url>, and in some accounts the apply itself fails when the instance launches.\n\nRequirement: a public web server — HTTPS from anywhere, SSH only from `admin_cidr`, in its own VPC.\n\nFind and fix **every** defect with the smallest changes, then explain each one: what was wrong, the symptom it causes, and the evidence you would look for in AWS. Do not widen access to make it work.',
    defects: [
      { id: 'D1', kind: 'routing', check: 'route', title: 'Subnet not associated with the public route table', symptom: 'The subnet uses the main route table (local only): connections time out; flow logs show inbound ACCEPT with no route out for replies.', evidence: '`aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=<subnet>` returns nothing.' },
      { id: 'D2', kind: 'filtering', check: 'in443', title: 'HTTPS allowed only from the VPC CIDR', symptom: 'Internet clients time out on 443; flow logs show REJECT for inbound 443 from public addresses.', evidence: '`describe-security-groups` shows 443 from 10.40.0.0/16 only.' },
      { id: 'D3', kind: 'reference', check: 'sgvpc', title: 'Security group has no vpc_id', symptom: 'The group is created in the default VPC (or creation fails where there is none); the instance launch fails because the group and subnet belong to different VPCs.', evidence: 'The group\'s VpcId differs from the subnet\'s; the apply error names the security group / network mismatch.' }
    ],
    checks: function () { return [C.noSecrets, C.vpc('10.40.0.0/16'), C.subnetInVpc, C.igw, C.publicRoute, C.routeStyle, ingress(443, 'world', 'HTTPS (443) allowed from anywhere', 'filtering'), C.sgInVpc, ingress(22, 'var', 'SSH still only from the admin range'), C.noWorldAdmin, noExtraWorld([443]), C.sgStyle, C.egress]; },
    hints: [
      'Conceptual: "validate passes" only means the file is well-formed against the provider schema. Look at relationships: what does the subnet use for routing, where is each security group created, and who is each rule for?',
      'Evidence: there are three defects — one routing, one filtering, one missing reference. The structural checks will name the area of each.',
      'Partial structure: one resource is missing entirely, one argument is missing, one value is wrong. None of the fixes need more than five lines.',
      'Full worked solution (marks this attempt as assisted).'
    ],
    solution: 'T3/reference', alternatives: [{ text: 'Associating the subnet through aws_main_route_table_association (making the public table the VPC\'s main table) also fixes D1, but every future subnet becomes public by default — say why you would not.' }],
    mistakes: ['Fixing D2 by opening 0.0.0.0/0 on every port', 'Adding a second route table instead of associating the existing one', 'Missing D3 because validate and plan accept it'],
    rubric: ['Names each defect and the class (routing / filtering / reference)', 'Gives the symptom each causes', 'Gives the AWS evidence that would confirm each', 'Made minimal changes and did not widen access'],
    explainAloud: 'Explain each defect as you would in an incident review: symptom, cause, evidence, fix, and how you would verify the fix.',
    verify: VERIFY('T3-repair/broken'),
    refs: ['AWS-RT', 'REG-SG', 'REG-SGIN', 'TF-VALIDATE']
  });

  /* ═══ T4 — private subnet with NAT ══════════════════════════════ */
  LX.ar1Tf.push({
    id: 'T4', title: 'Variation: a private subnet with outbound access through NAT', mins: 30, dir: 'T4-private-nat', modes: ['practice'], optional: true,
    files: ['main.tf', 'variables.tf', 'outputs.tf'], start: 'T1/reference',
    prompt: 'Starting from the T1 network (pre-filled), add:\n\n- A **private subnet** in the same VPC.\n- A **NAT gateway** that private instances use for outbound HTTPS, with whatever it needs.\n- A **private route table** with the right default route, associated with the private subnet.\n- An **app instance** in the private subnet with **no public IP**, and a security group that allows **TCP 8080 only from the web security group** and HTTPS out.\n- Outputs for the private subnet ID, the NAT\'s public IP and the app\'s private IP.\n\nSay what you reused, what you added, and what this costs (NAT gateways are billed per hour and per GB processed — check current pricing; deploying is optional).',
    checks: function () {
      return [C.noSecrets, C.vpc(null), C.subnetInVpc, C.igw, C.routeStyle, C.sgInVpc, C.sgStyle, C.noWorldAdmin,
        { id: 'nat', label: 'A NAT gateway in a public subnet, with an Elastic IP (domain = "vpc")', hint: 'aws_eip { domain = "vpc" } and aws_nat_gateway { allocation_id, subnet_id = the PUBLIC subnet }.',
          test: function (M) { var n = first(M.all('aws_nat_gateway')); if (!n) return 'no aws_nat_gateway'; var sn = M.points(n, 'subnet_id', 'aws_subnet'); if (!sn) return 'subnet_id does not reference a subnet'; if (!M.isPublicSubnet(sn)) return 'the NAT gateway is in subnet "' + sn.name + '", which has no route to the internet gateway — a public NAT gateway must sit in a public subnet'; var e = M.points(n, 'allocation_id', 'aws_eip'); if (!e && M.val(n, 'connectivity_type') !== 'private') return 'allocation_id does not reference an aws_eip'; if (e && M.val(e, 'domain') !== 'vpc') return 'the Elastic IP should set domain = "vpc"'; return true; } },
        { id: 'privroute', label: 'The private subnet\'s default route goes to the NAT gateway (nat_gateway_id)', defect: 'routing', hint: 'A second route table with 0.0.0.0/0 → nat_gateway_id, associated with the private subnet.',
          test: function (M) { var priv = M.all('aws_subnet').filter(function (s) { return !M.isPublicSubnet(s); }); if (!priv.length) return 'no private subnet (every subnet routes to the internet gateway)'; var ok = priv.some(function (s) { var d = M.defaultRoute(M.rtFor(s).rt); return d && d.target.kind === 'nat' && d.target.attr === 'nat_gateway_id'; }); if (ok) return true; var s0 = priv[0], r = M.rtFor(s0), d0 = M.defaultRoute(r.rt); if (!r.rt) return 'private subnet "' + s0.name + '" has no association (it uses the main table)'; if (!d0) return 'no 0.0.0.0/0 route in "' + r.rt.name + '"'; return 'the default route uses ' + d0.target.attr + ' → ' + d0.target.kind + '; use nat_gateway_id pointing at the NAT gateway'; } },
        { id: 'apppriv', label: 'The app instance is in the private subnet with no public IP', hint: 'subnet_id = the private subnet; associate_public_ip_address = false (or leave the subnet\'s map_public_ip_on_launch off).',
          test: function (M) { var apps = M.all('aws_instance').filter(function (i) { var sn = M.points(i, 'subnet_id', 'aws_subnet'); return sn && !M.isPublicSubnet(sn); }); if (!apps.length) return 'no instance in a private subnet'; return M.instancePublic(apps[0]) ? 'the app instance would get a public IP (' + M.instancePublic(apps[0]) + ')' : true; } },
        { id: 'appsg', label: 'App security group: 8080 only from the web security group, HTTPS out', hint: 'referenced_security_group_id = aws_security_group.web.id; egress 443.',
          test: function (M) { var apps = M.all('aws_instance').filter(function (i) { var sn = M.points(i, 'subnet_id', 'aws_subnet'); return sn && !M.isPublicSubnet(sn); }); var sg = apps.length && instSg(M, apps[0]); if (!sg) return 'the app instance has no security group from this configuration'; var ins = rulesIn(M, sg, 'ingress').filter(function (r) { return H().covers(r, 8080); }); if (!ins.length) return 'no ingress on 8080'; if (ins.some(function (r) { return r.cidrs.length; })) return '8080 is allowed from a CIDR; the requirement is the web security group only'; if (!ins.some(function (r) { return r.sgs.length; })) return '8080 does not reference the web security group'; if (!rulesIn(M, sg, 'egress').some(function (r) { return H().covers(r, 443); })) return 'no HTTPS egress'; return true; } },
        { id: 'natdep', sev: 'advice', label: 'NAT gateway waits for the internet gateway (depends_on)', hint: 'The provider docs recommend depends_on = [aws_internet_gateway.<name>] for proper ordering.',
          test: function (M) { var n = first(M.all('aws_nat_gateway')); var d = n && M.ast(n, 'depends_on'); return d && M.refsOf(d).some(function (r) { return r.type === 'aws_internet_gateway'; }) ? true : 'no depends_on on the internet gateway — usually fine, but the docs recommend it'; } },
        outputs([{ label: 'private subnet ID', attrs: [['aws_subnet', 'id']] }, { label: 'NAT public IP', attrs: [['aws_eip', 'public_ip'], ['aws_nat_gateway', 'public_ip']] }, OUT.privateIp])];
    },
    hints: [
      'Conceptual: NAT is a destination for the PRIVATE route table, but the NAT gateway itself lives in the PUBLIC subnet and reaches the internet through the internet gateway.',
      'Evidence: the structural checks will say whether the NAT gateway\'s own subnet is public and what the private default route points at.',
      'Partial structure:\n```\nresource "aws_eip" "nat" { domain = "vpc" }\nresource "aws_nat_gateway" "main" {\n  allocation_id = aws_eip.nat.id\n  subnet_id     = ???\n  depends_on    = [aws_internet_gateway.main]\n}\nresource "aws_route" "private_default" {\n  route_table_id         = aws_route_table.private.id\n  destination_cidr_block = "0.0.0.0/0"\n  nat_gateway_id         = ???\n}\n```',
      'Full worked solution (marks this attempt as assisted).'
    ],
    solution: 'T4/reference', alternatives: [{ text: 'If the private instances only need S3 or DynamoDB, a gateway VPC endpoint (aws_vpc_endpoint with vpc_endpoint_type = "Gateway" and route_table_ids) avoids NAT data-processing charges; many designs use both. One NAT gateway per AZ is the resilient version — say what you traded off.' }],
    mistakes: ['NAT gateway placed in the private subnet', 'Private default route with gateway_id pointing at the NAT gateway instead of nat_gateway_id', 'Giving the app instance a public IP "to be safe"', 'Forgetting the private route-table association', 'Allowing 8080 from 0.0.0.0/0 instead of the web group'],
    rubric: ['Explains why the NAT sits in the public subnet', 'Traces the outbound path and the return path through NAT', 'States the cost and AZ-resilience trade-off', 'Mentions the gateway-endpoint alternative for AWS services'],
    explainAloud: 'Explain how a packet from the app instance reaches an internet API and how the reply finds its way back, naming each resource.',
    verify: VERIFY('T4-private-nat/reference'),
    refs: ['AWS-NAT', 'AWS-NAT-BASICS', 'REG-NAT', 'AWS-GWEP']
  });
})();
