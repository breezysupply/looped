/* Terraform + AWS tech screen — practice-check builders (LX.tfsKit).

   Every check reads the parsed configuration (LXHcl.Model): resources,
   references between them and values that can be computed locally. None
   depends on resource labels, file order or whitespace. They are labelled
   "practice checks" in the UI: they are not terraform validate, they do not
   load provider schemas, and they never prove AWS behaviour.

   A check: { id, label, cat (mistake category), dim (rubric dimension),
   sev: 'required' | 'critical' | 'advice', hint, lesson, retry,
   test(M) → true | 'why it failed' | null (null = cannot be assessed here) } */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };

(function () {
  function H() { return window.LXHcl; }
  function K(v) { return H().known(v); }
  function first(a) { return a && a.length ? a[0] : null; }
  function vpc(M) { return first(M.all('aws_vpc')); }
  function ingressRules(M, sg) { return M.sgRules(sg).filter(function (r) { return r.dir === 'ingress'; }); }
  function egressRules(M, sg) { return M.sgRules(sg).filter(function (r) { return r.dir === 'egress'; }); }
  function instances(M) { return M.all('aws_instance'); }
  function subnetOf(M, i) { return M.points(i, 'subnet_id', 'aws_subnet'); }
  function privateSubnets(M) { return M.all('aws_subnet').filter(function (s) { return !M.isPublicSubnet(s); }); }
  function publicSubnets(M) { return M.all('aws_subnet').filter(function (s) { return M.isPublicSubnet(s); }); }
  function refsVar(M, block, attr) { var a = M.ast(block, attr); return !!a && M.refsOf(a).some(function (r) { return r.kind === 'var' || r.kind === 'local'; }); }
  function refsKind(M, block, attr, kinds) { var a = M.ast(block, attr); return !!a && M.refsOf(a).some(function (r) { return kinds.indexOf(r.kind) !== -1; }); }
  function chk(o) { o.sev = o.sev || 'required'; return o; }
  /* private workloads: instances outside the NAT gateway's (public) subnet,
     or, with no NAT gateway, instances outside IGW-routed subnets */
  function workers(M) {
    var nat = first(M.all('aws_nat_gateway')), natSub = nat && M.points(nat, 'subnet_id', 'aws_subnet');
    return instances(M).filter(function (i) { var s = subnetOf(M, i); if (!s) return false; return natSub && M.isPublicSubnet(natSub) ? s !== natSub : !M.isPublicSubnet(s); });
  }

  var C = {};
  /* ── settings and hygiene ─────────────────────────────────────── */
  C.pinned = chk({ id: 'pin', label: 'AWS provider declared in required_providers with a version constraint', cat: 'hcl', dim: 'hcl', lesson: 'l2',
    hint: 'terraform { required_providers { aws = { source = "hashicorp/aws", version = "~> 6.60" } } }',
    test: function (M) { var p = M.providerPin(); if (!p) return 'no required_providers entry for aws'; if (!p.version) return 'aws has no version constraint'; return true; } });
  C.regionVar = chk({ id: 'region', label: 'Provider Region comes from an input variable', cat: 'hcl', dim: 'hcl', lesson: 'l2',
    hint: 'provider "aws" { region = var.region }',
    test: function (M) { var p = M.providers.filter(function (x) { return x.labels[0] === 'aws'; })[0]; if (!p) return 'no provider "aws" block'; return refsVar(M, p, 'region') ? true : 'region is not taken from a variable'; } });
  C.noSecrets = chk({ id: 'secrets', sev: 'critical', label: 'No credentials in the files', cat: 'security', dim: 'netsec', lesson: 'l2',
    hint: 'Let the provider find credentials in your environment (AWS_PROFILE, SSO). Never set access_key/secret_key.',
    test: function (M) { var s = M.embeddedSecrets(); return s.length ? s.join('; ') : true; } });
  C.typedVars = chk({ id: 'typed', label: 'Every input variable declares a type', cat: 'hcl', dim: 'hcl', lesson: 'l1b',
    hint: 'variable "x" { type = string }',
    test: function (M) { var bad = Object.keys(M.variables).filter(function (k) { return !M.variables[k].attrs.type; }); if (!Object.keys(M.variables).length) return 'no input variables declared'; return bad.length ? 'no type on: ' + bad.join(', ') : true; } });
  C.outputsRef = function (spec, id) {
    return chk({ id: id || 'outputs', label: 'Outputs: ' + spec.map(function (s) { return s.label; }).join(', '), cat: 'references', dim: 'hcl', lesson: 'l1b',
      hint: 'output "name" { value = <type>.<name>.<attribute> } — a reference, not a quoted string',
      test: function (M) {
        var miss = spec.filter(function (s) { return !M.outputs.some(function (o) { var a = M.ast(o, 'value'); return a && M.refsOf(a).some(function (r) { return r.kind === 'resource' && s.attrs.some(function (x) { return x[0] === r.type && (!x[1] || x[1] === r.attr); }); }); }); });
        return miss.length ? 'missing an output that references: ' + miss.map(function (s) { return s.label; }).join(', ') : true;
      } });
  };

  /* ── Build 0 ──────────────────────────────────────────────────── */
  C.tfData = chk({ id: 'tfdata', label: 'A terraform_data resource stores an input value', cat: 'hcl', dim: 'core', lesson: 'l1a',
    hint: 'resource "terraform_data" "manifest" { input = { … } }',
    test: function (M) { var r = first(M.all('terraform_data')); if (!r) return 'no terraform_data resource'; return r.attrs.input ? true : 'the terraform_data resource has no input argument'; } });
  C.tagsLocal = chk({ id: 'locals', label: 'A local tags map built from the inputs, used by the resource', cat: 'references', dim: 'hcl', lesson: 'l1b',
    hint: 'locals { tags = { project = var.project, environment = var.environment } } and use local.tags',
    test: function (M) {
      var names = Object.keys(M.locals); if (!names.length) return 'no locals block';
      var mapLocal = names.filter(function (n) { var v = M.eval(M.locals[n].ast, 0); return v && typeof v === 'object' && !Array.isArray(v) && M.refsOf(M.locals[n].ast).some(function (r) { return r.kind === 'var'; }); });
      if (!mapLocal.length) return 'no local map that is built from input variables';
      var used = M.resources.concat(M.outputs).some(function (b) { return Object.keys(b.attrs).some(function (k) { return M.refsOf(b.attrs[k].ast).some(function (r) { return r.kind === 'local' && mapLocal.indexOf(r.name) !== -1; }); }); });
      return used ? true : 'local.' + mapLocal[0] + ' is defined but nothing uses it';
    } });
  C.projectEnvVars = chk({ id: 'inputs', label: 'Typed project and environment inputs', cat: 'hcl', dim: 'hcl', lesson: 'l1b',
    hint: 'Two variable blocks, each with type = string.',
    test: function (M) { var v = Object.keys(M.variables).filter(function (k) { return M.variables[k].attrs.type && /string/.test(M.variables[k].attrs.type.raw); }); return v.length >= 2 ? true : 'expected at least two string-typed variables (project and environment)'; } });
  C.outputsFromData = chk({ id: 'outputs', label: 'Outputs read the resource\'s output attribute', cat: 'references', dim: 'hcl', lesson: 'l1b',
    hint: 'value = terraform_data.<name>.output.<key>',
    test: function (M) { var ok = M.outputs.filter(function (o) { var a = M.ast(o, 'value'); return a && M.refsOf(a).some(function (r) { return r.kind === 'resource' && r.type === 'terraform_data' && r.attr === 'output'; }); }); return ok.length >= 2 ? true : 'expected two outputs that reference terraform_data.<name>.output (found ' + ok.length + ')'; } });

  /* ── Build 1: S3 ───────────────────────────────────────────────── */
  function bucket(M) { return first(M.all('aws_s3_bucket')); }
  function onBucket(M, type) { var b = bucket(M); return M.all(type).filter(function (r) { return b && M.points(r, 'bucket', 'aws_s3_bucket') === b; }); }
  C.s3Bucket = chk({ id: 's3', label: 'One bucket whose name comes from a caller-supplied input', cat: 'references', dim: 'core', lesson: 'l2',
    hint: 'resource "aws_s3_bucket" "x" { bucket = var.bucket_name }',
    test: function (M) { var b = bucket(M); if (!b) return 'no aws_s3_bucket'; if (!M.has(b, 'bucket')) return 'bucket name is not set (AWS would generate one)'; return refsVar(M, b, 'bucket') ? true : 'the bucket name is hard-coded; take it from a variable so each learner can pick a unique one'; } });
  C.s3Pab = chk({ id: 'pab', label: 'Public access block on the same bucket with all four settings true', cat: 'security', dim: 'netsec', lesson: 'l2',
    hint: 'aws_s3_bucket_public_access_block with bucket = aws_s3_bucket.<name>.id and the four flags = true',
    test: function (M) { var p = first(onBucket(M, 'aws_s3_bucket_public_access_block')); if (!p) return M.all('aws_s3_bucket_public_access_block').length ? 'the public access block does not reference the bucket resource' : 'no aws_s3_bucket_public_access_block'; var off = ['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets'].filter(function (k) { return M.val(p, k) !== true; }); return off.length ? 'not true: ' + off.join(', ') : true; } });
  C.s3Versioning = chk({ id: 'ver', label: 'Versioning enabled on the same bucket', cat: 'references', dim: 'core', lesson: 'l2',
    hint: 'aws_s3_bucket_versioning { bucket = …; versioning_configuration { status = "Enabled" } }',
    test: function (M) { var v = first(onBucket(M, 'aws_s3_bucket_versioning')); if (!v) return M.all('aws_s3_bucket_versioning').length ? 'the versioning resource does not reference the bucket' : 'no aws_s3_bucket_versioning'; var c = first(M.sub(v, 'versioning_configuration')); return c && M.val(c, 'status') === 'Enabled' ? true : 'versioning_configuration.status is not "Enabled"'; } });
  C.s3Sse = chk({ id: 'sse', label: 'Explicit server-side encryption configuration on the same bucket', cat: 'security', dim: 'netsec', lesson: 'l2',
    hint: 'aws_s3_bucket_server_side_encryption_configuration { rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } } }',
    test: function (M) { var e = first(onBucket(M, 'aws_s3_bucket_server_side_encryption_configuration')); if (!e) return M.all('aws_s3_bucket_server_side_encryption_configuration').length ? 'the encryption resource does not reference the bucket' : 'no aws_s3_bucket_server_side_encryption_configuration'; var r = first(M.sub(e, 'rule')), d = r && first(M.sub(r, 'apply_server_side_encryption_by_default')); var alg = d && M.val(d, 'sse_algorithm'); return ['AES256', 'aws:kms', 'aws:kms:dsse'].indexOf(alg) !== -1 ? true : 'no rule.apply_server_side_encryption_by_default.sse_algorithm (AES256 or aws:kms)'; } });
  C.s3NotPublic = chk({ id: 's3safe', label: 'No public website, public policy, public ACL or force_destroy', cat: 'security', dim: 'netsec', lesson: 'l2',
    hint: 'Leave force_destroy at its default; no aws_s3_bucket_website_configuration or bucket policy in this build.',
    test: function (M) { var bad = []; if (M.all('aws_s3_bucket_website_configuration').length) bad.push('website hosting'); if (M.all('aws_s3_bucket_policy').length) bad.push('a bucket policy (not part of this build)'); M.all('aws_s3_bucket_acl').forEach(function (a) { if (/public/.test(String(M.val(a, 'acl')))) bad.push('a public ACL'); }); M.all('aws_s3_bucket').forEach(function (b) { if (M.val(b, 'force_destroy') === true) bad.push('force_destroy = true (would delete every object version on destroy)'); }); return bad.length ? bad.join('; ') : true; } });
  C.s3Tags = chk({ id: 'tags', label: 'Tags on the bucket (a tags argument or provider default_tags)', cat: 'hcl', dim: 'hcl', lesson: 'l2',
    hint: 'tags = local.tags, or default_tags in the provider block',
    test: function (M) { var b = bucket(M); if (!b) return 'no bucket'; if (M.has(b, 'tags')) return true; return M.providers.some(function (p) { return M.sub(p, 'default_tags').length; }) ? true : 'no tags argument and no provider default_tags'; } });
  C.s3EnvVar = chk({ id: 'env', label: 'An environment input used in the tags', cat: 'hcl', dim: 'hcl', lesson: 'l2',
    hint: 'variable "environment" { type = string } and environment = var.environment in the tags map',
    test: function (M) { if (!M.variables.environment) return 'no variable named environment'; var used = M.resources.concat(M.providers).some(function (b) { return JSON.stringify(b).indexOf('"environment"') !== -1; }) || Object.keys(M.locals).some(function (k) { return M.refsOf(M.locals[k].ast).some(function (r) { return r.kind === 'var' && r.name === 'environment'; }); }); return used ? true : 'var.environment is declared but not used'; } });

  /* ── networking ───────────────────────────────────────────────── */
  C.vpc = function (cidr) {
    return chk({ id: 'vpc', label: 'A VPC' + (cidr ? ' with CIDR ' + cidr : ' with a valid IPv4 CIDR'), cat: 'hcl', dim: 'core', lesson: 'l3a',
      hint: 'resource "aws_vpc" "main" { cidr_block = var.vpc_cidr }' + (cidr ? ' with default "' + cidr + '"' : ''),
      test: function (M) { var v = vpc(M); if (!v) return 'no aws_vpc'; var c = M.val(v, 'cidr_block'); if (!K(c)) return cidr ? 'cidr_block cannot be read: give the variable a default of ' + cidr : true; if (!H().cidr(c)) return '"' + c + '" is not an IPv4 CIDR'; if (!H().cidr(c).aligned) return c + ' has host bits set (use ' + H().cidr(c).str + ')'; if (cidr && c !== cidr) return 'cidr_block is ' + c + '; the requirement is ' + cidr; return true; } });
  };
  C.subnets = function (want) {
    return chk({ id: 'subnets', label: 'Subnets in that VPC, inside its range, not overlapping' + (want ? ' (' + want.join(', ') + ')' : ''), cat: 'routing', dim: 'core', lesson: 'l3a',
      hint: 'aws_subnet with vpc_id = aws_vpc.<name>.id and a cidr_block inside the VPC',
      test: function (M) {
        var v = vpc(M), subs = M.all('aws_subnet'); if (!subs.length) return 'no aws_subnet';
        var bad = [];
        subs.forEach(function (s) {
          if (M.points(s, 'vpc_id', 'aws_vpc') !== v) { bad.push('"' + s.name + '" does not reference the VPC'); return; }
          var sc = M.val(s, 'cidr_block'), vc = M.val(v, 'cidr_block');
          if (K(sc) && K(vc) && !H().within(sc, vc)) bad.push('"' + s.name + '" ' + sc + ' is outside ' + vc);
        });
        subs.forEach(function (a, i) { subs.slice(i + 1).forEach(function (b) { var x = M.val(a, 'cidr_block'), y = M.val(b, 'cidr_block'); if (K(x) && K(y) && H().overlaps(x, y)) bad.push('"' + a.name + '" and "' + b.name + '" overlap'); }); });
        if (want) { var got = subs.map(function (s) { return M.val(s, 'cidr_block'); }); want.forEach(function (c) { if (got.indexOf(c) === -1 && got.every(K)) bad.push('no subnet with ' + c); }); }
        return bad.length ? bad.join('; ') : true;
      } });
  };
  C.igw = chk({ id: 'igw', label: 'Internet gateway attached to the VPC', cat: 'routing', dim: 'core', lesson: 'l3a',
    hint: 'resource "aws_internet_gateway" "main" { vpc_id = aws_vpc.main.id }',
    test: function (M) { return M.igwFor(vpc(M)) ? true : (M.all('aws_internet_gateway').length ? 'the internet gateway is not attached to the VPC' : 'no aws_internet_gateway'); } });
  C.publicRoute = chk({ id: 'pubroute', label: 'Public subnet explicitly associated with a route table whose 0.0.0.0/0 goes to the internet gateway', cat: 'routing', dim: 'core', sev: 'critical', lesson: 'l3a', critical: 'Required routing missing',
    hint: 'aws_route (or an inline route) 0.0.0.0/0 → gateway_id = the IGW, plus aws_route_table_association for the subnet',
    test: function (M) {
      if (M.all('aws_subnet').some(function (s) { return M.rtFor(s).how === 'explicit' && M.isPublicSubnet(s); })) return true;
      var why = M.all('aws_subnet').map(function (s) { var r = M.rtFor(s); if (!r.rt) return '"' + s.name + '" has no association (it would use the VPC\'s main table: local route only)'; var d = M.defaultRoute(r.rt); if (!d) return '"' + s.name + '" uses a table with no 0.0.0.0/0 route'; if (d.target.kind !== 'igw') return '"' + s.name + '": 0.0.0.0/0 goes to ' + d.target.kind + ', not the internet gateway'; return '"' + s.name + '" is associated only through the main table'; });
      return why.join('; ') || 'no subnet';
    } });
  C.routeStyle = chk({ id: 'routestyle', label: 'Each route table uses one route style', cat: 'hcl', dim: 'hcl', lesson: 'l3a',
    hint: 'Inline route blocks and aws_route resources for the same table conflict.',
    test: function (M) { var bad = M.all('aws_route_table').filter(function (rt) { var r = M.routesOf(rt); return r.some(function (x) { return x.style === 'inline'; }) && r.some(function (x) { return x.style === 'resource'; }); }); return bad.length ? '"' + bad[0].name + '" mixes inline routes with aws_route' : true; } });
  C.sgInVpc = chk({ id: 'sgvpc', label: 'Security groups belong to the VPC', cat: 'references', dim: 'core', lesson: 'l3b',
    hint: 'vpc_id = aws_vpc.<name>.id on every aws_security_group',
    test: function (M) { var v = vpc(M), sgs = M.all('aws_security_group'); if (!sgs.length) return 'no security group'; var bad = sgs.filter(function (g) { return M.points(g, 'vpc_id', 'aws_vpc') !== v; }); return bad.length ? '"' + bad[0].name + '" has no vpc_id reference (it would land in the default VPC)' : true; } });
  C.sgStyle = chk({ id: 'sgstyle', label: 'No security group mixes inline rules with separate rule resources', cat: 'hcl', dim: 'hcl', lesson: 'l3b',
    hint: 'Use aws_vpc_security_group_ingress_rule/egress_rule resources (or inline blocks), never both on one group.',
    test: function (M) { var bad = M.all('aws_security_group').filter(function (g) { var st = {}; M.sgRules(g).forEach(function (r) { st[r.style === 'inline' ? 'i' : 's'] = 1; }); return st.i && st.s; }); return bad.length ? '"' + bad[0].name + '" mixes both styles' : true; } });
  C.noWorldAdmin = chk({ id: 'admin', sev: 'critical', label: 'No SSH/RDP or all-traffic ingress from anywhere', cat: 'security', dim: 'netsec', lesson: 'l3b', critical: 'Unrestricted administrative ingress',
    hint: 'Leave SSH out of this build, or restrict it to a specific admin CIDR variable.',
    test: function (M) { var hit = []; M.all('aws_security_group').forEach(function (g) { ingressRules(M, g).forEach(function (r) { if (H().worldOpen(r) && (r.proto === '-1' || H().covers(r, 22) || H().covers(r, 3389))) hit.push(g.name + ': ' + (r.proto === '-1' ? 'all traffic' : 'ports ' + r.from + '-' + r.to)); }); }); return hit.length ? hit.join('; ') + ' from 0.0.0.0/0' : true; } });
  C.ipv4Only = chk({ id: 'ipv4', sev: 'advice', label: 'IPv4 scope only (no accidental IPv6 rules)', cat: 'security', dim: 'netsec', lesson: 'l3b',
    hint: 'Beginner labs use cidr_ipv4 only; leave ::/0 out unless you add IPv6 on purpose.',
    test: function (M) { var six = M.all('aws_security_group').some(function (g) { return M.sgRules(g).some(function (r) { return r.cidrs.some(function (c) { return K(c) && /:/.test(String(c)); }); }); }); return six ? 'an IPv6 rule is present though the VPC has no IPv6 range' : true; } });
  C.ingressPort = function (port, from, label) {
    return chk({ id: 'in' + port, label: label || 'Ingress TCP ' + port + (from === 'world' ? ' from anywhere' : from === 'var' ? ' from a configurable range' : ''), cat: 'security', dim: 'netsec', lesson: 'l3b',
      hint: 'aws_vpc_security_group_ingress_rule { ip_protocol = "tcp", from_port = ' + port + ', to_port = ' + port + ', cidr_ipv4 = … }',
      test: function (M) {
        var web = instances(M).filter(function (i) { var s = subnetOf(M, i); return s && M.isPublicSubnet(s); })[0];
        var sgs = web ? M.sgsOf(web) : M.all('aws_security_group');
        var rules = []; sgs.forEach(function (g) { ingressRules(M, g).forEach(function (r) { if (H().covers(r, port)) rules.push(r); }); });
        if (!rules.length) return 'no ingress rule on the web instance\'s group covers TCP ' + port;
        if (from === 'var' && !rules.some(function (r) { return refsKind(M, r.block, r.style === 'inline' ? 'cidr_blocks' : 'cidr_ipv4', ['var', 'local']); })) return 'the source is fixed in the code; take it from a variable';
        if (from === 'world' && !rules.some(function (r) { return H().worldOpen(r) || refsKind(M, r.block, r.style === 'inline' ? 'cidr_blocks' : 'cidr_ipv4', ['var']); })) return 'the requirement is reachable from the internet (0.0.0.0/0 or a variable defaulting to it)';
        return true;
      } });
  };
  C.webEgress = chk({ id: 'egress', label: 'Explicit outbound access for the bootstrap (Terraform removes the default egress rule)', cat: 'security', dim: 'netsec', lesson: 'l3b',
    hint: 'aws_vpc_security_group_egress_rule allowing TCP 443 to 0.0.0.0/0 (package repositories).',
    test: function (M) { var i = instances(M); if (!i.length) return 'no instance'; var bad = i.filter(function (x) { return !M.sgsOf(x).some(function (g) { return egressRules(M, g).some(function (r) { return H().covers(r, 443); }); }); }); return bad.length ? 'instance "' + bad[0].name + '" has no egress rule covering TCP 443' : true; } });
  C.webInstance = chk({ id: 'web', label: 'Instance in the public subnet, with the group attached and an explicit public IPv4', cat: 'routing', dim: 'core', lesson: 'l3c',
    hint: 'subnet_id = the public subnet, vpc_security_group_ids = [the group], associate_public_ip_address = true',
    test: function (M) { var i = first(instances(M)); if (!i) return 'no aws_instance'; var s = subnetOf(M, i); if (!s) return 'subnet_id does not reference a subnet in this configuration'; if (!M.isPublicSubnet(s)) return 'the instance\'s subnet has no route to the internet gateway'; if (!M.sgsOf(i).length) return 'vpc_security_group_ids does not reference a group from this configuration'; if (M.val(i, 'associate_public_ip_address') !== true && !M.eipFor(i)) return 'no explicit public IPv4 (associate_public_ip_address = true or an Elastic IP)'; return true; } });
  C.ami = chk({ id: 'ami', label: 'AMI from a documented lookup or a validated input (not an unexplained ID)', cat: 'hcl', dim: 'core', lesson: 'l3c',
    hint: 'data "aws_ami" with owners = ["amazon"] and a name filter, the public SSM parameter, or a variable with validation.',
    test: function (M) { var i = first(instances(M)); if (!i) return 'no instance'; var s = M.amiSource(i); if (s === 'data.aws_ami' || s === 'ssm parameter') return true; if (s === 'variable') { var r = M.refsOf(M.ast(i, 'ami')).filter(function (x) { return x.kind === 'var'; })[0]; return r && M.variables[r.name] && M.sub(M.variables[r.name], 'validation').length ? true : 'an AMI variable is fine, but validate it (e.g. starts with "ami-")'; } return 'hard-coded AMI ID: it exists in one Region only and goes stale'; } });
  C.arch = chk({ id: 'arch', label: 'Instance type architecture matches the AMI', cat: 'hcl', dim: 'core', lesson: 'l3c',
    hint: 'x86_64 AMI → t3/m5/c5…; arm64 AMI → t4g/m7g/c7g…',
    test: function (M) {
      var i = first(instances(M)); if (!i) return 'no instance';
      var t = M.val(i, 'instance_type'); if (!K(t)) return null;
      var armType = /^[a-z]+\d+[a-z]*g[a-z]*\./.test(String(t)) && !/^g\d/.test(String(t));
      var amiArch = null;
      M.data.forEach(function (d) { var txt = JSON.stringify(d); if (/arm64|aarch64/.test(txt)) amiArch = 'arm64'; else if (/x86_64/.test(txt)) amiArch = amiArch || 'x86_64'; });
      if (!amiArch) return null;
      if (amiArch === 'arm64' && !armType) return t + ' is x86_64 but the AMI lookup is arm64';
      if (amiArch === 'x86_64' && armType) return t + ' is arm64 (Graviton) but the AMI lookup is x86_64';
      return true;
    } });
  C.userData = chk({ id: 'userdata', label: 'User data starts the web server (port allowed ≠ service listening)', cat: 'verification', dim: 'core', lesson: 'l3c',
    hint: 'user_data = <<-EOT … dnf install -y nginx; systemctl enable --now nginx … EOT',
    test: function (M) { var i = first(instances(M)); if (!i) return 'no instance'; if (!M.has(i, 'user_data') && !M.has(i, 'user_data_base64')) return 'no user_data: nothing would listen on the port'; var u = String(M.val(i, 'user_data') || ''); if (/apt(-get)? install/.test(u) && /al2023|amzn/i.test(JSON.stringify(M.data))) return 'apt is not the Amazon Linux 2023 package manager (use dnf)'; return true; } });
  C.bootDep = function (sev) {
    return chk({ id: 'bootdep', sev: sev || 'advice', label: 'Bootstrap waits for the route it needs (narrow depends_on)', cat: 'references', dim: 'core', lesson: 'l3c',
      hint: 'depends_on = [aws_route.<default>, aws_route_table_association.<subnet>] on the instance',
      test: function (M) {
        var list = instances(M).filter(function (i) { return M.has(i, 'user_data'); }); if (!list.length) return null;
        var bad = list.filter(function (i) { var d = M.ast(i, 'depends_on'); return !d || !M.refsOf(d).some(function (r) { return r.type === 'aws_route' || r.type === 'aws_route_table_association' || r.type === 'aws_nat_gateway'; }); });
        return bad.length ? 'instance "' + bad[0].name + '" can boot before its default route exists; nothing it references waits for the route' : true;
      } });
  };
  C.overDepends = chk({ id: 'depends', sev: 'advice', label: 'depends_on used narrowly', cat: 'references', dim: 'hcl', lesson: 'l3c',
    hint: 'References already order most things; add depends_on only for hidden dependencies.',
    test: function (M) { var n = M.resources.filter(function (r) { return M.has(r, 'depends_on'); }).length; return n > 3 ? n + ' resources use depends_on — most ordering should come from references' : true; } });

  /* ── NAT and private worker ───────────────────────────────────── */
  C.eip = chk({ id: 'eip', label: 'Elastic IP for the NAT gateway (domain = "vpc")', cat: 'routing', dim: 'core', lesson: 'l4a',
    hint: 'resource "aws_eip" "nat" { domain = "vpc" }',
    test: function (M) { var n = first(M.all('aws_nat_gateway')); var e = n && M.points(n, 'allocation_id', 'aws_eip'); if (!e) return M.all('aws_eip').length ? 'the NAT gateway\'s allocation_id does not reference the Elastic IP' : 'no aws_eip'; return M.val(e, 'domain') === 'vpc' ? true : 'set domain = "vpc" on the Elastic IP'; } });
  C.natPublic = chk({ id: 'natpub', label: 'Public NAT gateway in the public subnet', cat: 'routing', dim: 'core', lesson: 'l4a',
    hint: 'aws_nat_gateway { allocation_id = aws_eip.<x>.id, subnet_id = aws_subnet.<public>.id }',
    test: function (M) { var n = first(M.all('aws_nat_gateway')); if (!n) return 'no aws_nat_gateway'; var s = M.points(n, 'subnet_id', 'aws_subnet'); if (!s) return 'subnet_id does not reference a subnet'; return M.isPublicSubnet(s) ? true : 'the NAT gateway is in "' + s.name + '", which has no route to the internet gateway: its traffic could never leave the VPC'; } });
  C.privateRoute = chk({ id: 'privroute', sev: 'critical', label: 'Private subnet explicitly associated with a route table whose 0.0.0.0/0 goes to the NAT gateway', cat: 'routing', dim: 'core', lesson: 'l4a', critical: 'Required routing missing',
    hint: 'aws_route { destination_cidr_block = "0.0.0.0/0", nat_gateway_id = aws_nat_gateway.<x>.id } and an association for the private subnet',
    test: function (M) {
      var cands = [];
      workers(M).forEach(function (i) { var sn = subnetOf(M, i); if (cands.indexOf(sn) === -1) cands.push(sn); });
      if (!cands.length) cands = M.all('aws_subnet').filter(function (sn) { var d = M.defaultRoute(M.rtFor(sn).rt); return !(d && d.target.kind === 'igw'); });
      if (!cands.length) return 'no private subnet';
      var bad = cands.filter(function (s) { var r = M.rtFor(s); if (r.how !== 'explicit') return true; var d = M.defaultRoute(r.rt); return !(d && d.target.kind === 'nat' && d.target.attr === 'nat_gateway_id'); });
      if (!bad.length) return true;
      var s0 = bad[0], r0 = M.rtFor(s0), d0 = M.defaultRoute(r0.rt);
      if (r0.how !== 'explicit') return '"' + s0.name + '" has no route-table association (it would use the main table: no egress)';
      if (!d0) return '"' + s0.name + '" uses a table with no 0.0.0.0/0 route';
      if (d0.target.kind === 'igw') return '"' + s0.name + '" sends 0.0.0.0/0 to the internet gateway; without a public IP that cannot reach the internet, and it is not outbound-only';
      return '"' + s0.name + '": 0.0.0.0/0 uses ' + d0.target.attr + ' — point nat_gateway_id at the NAT gateway';
    } });
  C.workerPrivate = chk({ id: 'nopublic', sev: 'critical', label: 'Worker in a private subnet with no public IPv4', cat: 'security', dim: 'netsec', lesson: 'l4a', critical: 'A private instance exposed publicly',
    hint: 'subnet_id = the private subnet; associate_public_ip_address = false (or unset, with the subnet not mapping public IPs)',
    test: function (M) { var all = instances(M); if (!all.length) return 'no worker instance'; var bad = all.filter(function (i) { return M.instancePublic(i); }); if (bad.length) return 'instance "' + bad[0].name + '" gets a public IPv4 (' + M.instancePublic(bad[0]) + ')'; return workers(M).length ? true : 'the worker sits in the NAT gateway\'s public subnet'; } });
  C.workerNoIngress = chk({ id: 'noingress', sev: 'critical', label: 'No inbound internet rule on the worker', cat: 'security', dim: 'netsec', lesson: 'l4b', critical: 'A private instance exposed publicly',
    hint: 'The worker\'s security group needs no ingress at all; replies to its own outbound connections are allowed automatically.',
    test: function (M) { var bad = []; workers(M).forEach(function (w) { M.sgsOf(w).forEach(function (g) { ingressRules(M, g).forEach(function (r) { if (H().worldOpen(r)) bad.push(g.name + ' ' + (r.proto === '-1' ? 'all' : r.from + '-' + r.to)); }); }); }); return bad.length ? 'open to 0.0.0.0/0: ' + bad.join(', ') : true; } });
  C.workerEgress = chk({ id: 'wegress', label: 'Worker security group allows the outbound access it needs', cat: 'security', dim: 'netsec', lesson: 'l4b',
    hint: 'aws_vpc_security_group_egress_rule TCP 443 to the destinations (0.0.0.0/0 for package repositories)',
    test: function (M) { var w = workers(M); if (!w.length) return 'no worker in a private subnet'; var ok = w.every(function (i) { return M.sgsOf(i).some(function (g) { return egressRules(M, g).some(function (r) { return H().covers(r, 443); }); }); }); return ok ? true : 'no egress rule covering TCP 443 on the worker\'s group'; } });

  /* ── iteration and parameters ─────────────────────────────────── */
  C.forEachSubnets = chk({ id: 'foreach', label: 'Private subnets come from one map-driven for_each block', cat: 'hcl', dim: 'hcl', lesson: 'l5b',
    hint: 'resource "aws_subnet" "private" { for_each = var.private_subnets … each.value.cidr … }',
    test: function (M) { var s = M.all('aws_subnet').filter(function (x) { return x.attrs.for_each; })[0]; if (!s) return 'no aws_subnet uses for_each'; var inst = M.instancesOf(s); if (!inst || inst.length < 2) return 'the for_each collection does not produce two or more subnets'; if (M.all('aws_subnet').length > 1) return 'hand-written subnets remain alongside the for_each block'; return true; } });
  C.forEachAssoc = chk({ id: 'assoc', label: 'Every subnet instance gets exactly one association, keyed the same way', cat: 'routing', dim: 'core', lesson: 'l5b',
    hint: 'resource "aws_route_table_association" "private" { for_each = aws_subnet.private; subnet_id = each.value.id … }',
    test: function (M) { var s = M.all('aws_subnet').filter(function (x) { return x.attrs.for_each; })[0]; if (!s) return 'no for_each subnet block'; var a = M.all('aws_route_table_association').filter(function (x) { return M.points(x, 'subnet_id', 'aws_subnet') === s; })[0]; if (!a) return 'no association references the for_each subnets'; if (!a.attrs.for_each) return 'one association for a whole collection: use for_each on the association too'; var si = M.instancesOf(s) || [], ai = M.instancesOf(a) || []; var sk = si.map(function (x) { return String(x.key); }).sort().join(','), ak = ai.map(function (x) { return String(x.key); }).sort().join(','); return sk === ak ? true : 'association keys (' + ak + ') do not match subnet keys (' + sk + ')'; } });
  C.forEachOutput = chk({ id: 'colout', label: 'An output derived from the collection', cat: 'references', dim: 'hcl', lesson: 'l5b',
    hint: 'value = { for k, s in aws_subnet.private : k => s.id }',
    test: function (M) { var s = M.all('aws_subnet').filter(function (x) { return x.attrs.for_each; })[0]; if (!s) return 'no for_each subnets'; var ok = M.outputs.some(function (o) { var a = M.ast(o, 'value'); return a && M.refsOf(a).some(function (r) { return r.kind === 'resource' && r.type === 'aws_subnet' && r.name === s.name; }); }); return ok ? true : 'no output reads the subnet collection'; } });
  C.paramCidr = chk({ id: 'param', label: 'VPC CIDR and instance type come from typed variables', cat: 'hcl', dim: 'hcl', lesson: 'l5a',
    hint: 'cidr_block = var.vpc_cidr; instance_type = var.instance_type; both variables typed',
    test: function (M) { var v = vpc(M), i = first(instances(M)); if (!v || !i) return 'needs the VPC and the instance'; if (!refsVar(M, v, 'cidr_block')) return 'the VPC CIDR is still a literal'; if (!refsVar(M, i, 'instance_type')) return 'instance_type is still a literal'; return true; } });
  C.derivedSubnet = chk({ id: 'derived', label: 'Subnet CIDR derived from the VPC CIDR (not a second literal)', cat: 'hcl', dim: 'hcl', lesson: 'l5a',
    hint: 'cidr_block = cidrsubnet(var.vpc_cidr, 8, 1) — directly or through a local',
    test: function (M) { var s = first(M.all('aws_subnet')); if (!s) return 'no subnet'; return refsVar(M, s, 'cidr_block') ? true : 'the subnet CIDR is a literal that will not follow a new VPC range'; } });
  C.validation = chk({ id: 'validation', sev: 'advice', label: 'Variables validate their values', cat: 'hcl', dim: 'hcl', lesson: 'l5a',
    hint: 'validation { condition = can(cidrhost(var.vpc_cidr, 0)) error_message = "…" }',
    test: function (M) { return Object.keys(M.variables).some(function (k) { return M.sub(M.variables[k], 'validation').length; }) ? true : 'no validation blocks'; } });

  /* ── stretch: ALB ─────────────────────────────────────────────── */
  C.albPublic = chk({ id: 'alb', label: 'Internet-facing application load balancer in two public subnets', cat: 'routing', dim: 'core', lesson: 'l4b',
    hint: 'aws_lb { load_balancer_type = "application", internal = false, subnets = [both public subnets], security_groups = [alb group] }',
    test: function (M) { var lb = first(M.all('aws_lb')); if (!lb) return 'no aws_lb'; if (M.val(lb, 'internal') === true) return 'internal = true: not internet-facing'; var t = M.val(lb, 'load_balancer_type'); if (K(t) && t && t !== 'application') return 'load_balancer_type is ' + t; var subs = M.pointsAll(lb, 'subnets', 'aws_subnet'); if (!subs.length) return 'subnets does not reference subnets'; var n = subs.reduce(function (k, s) { return k + ((M.instancesOf(s) || [1]).length); }, 0); if (n < 2) return 'an ALB needs subnets in at least two AZs'; return subs.every(function (s) { return M.isPublicSubnet(s); }) ? true : 'the ALB subnets are not public'; } });
  C.albChain = chk({ id: 'chain', label: 'Listener → target group → registered targets, on the application port', cat: 'references', dim: 'core', lesson: 'l4b',
    hint: 'aws_lb_listener default_action forward to aws_lb_target_group; aws_lb_target_group_attachment per instance',
    test: function (M) { var l = first(M.all('aws_lb_listener')); if (!l) return 'no listener'; var da = first(M.sub(l, 'default_action')); var tg = da && M.points(da, 'target_group_arn', 'aws_lb_target_group'); if (!tg) return 'the listener does not forward to a target group'; var att = M.all('aws_lb_target_group_attachment').filter(function (a) { return M.points(a, 'target_group_arn', 'aws_lb_target_group') === tg; }); if (!att.length) return 'no targets registered'; var n = att.reduce(function (k, a) { return k + ((M.instancesOf(a) || [1]).length); }, 0); if (n < 2) return 'only one target registered; the brief asks for one per AZ'; if (!M.sub(tg, 'health_check').length) return 'no health_check on the target group (targets are not the same as healthy targets)'; return true; } });
  C.appFromAlb = chk({ id: 'appsg', label: 'App ingress only from the ALB security group', cat: 'security', dim: 'netsec', lesson: 'l3b',
    hint: 'referenced_security_group_id = aws_security_group.alb.id on the app ingress rule',
    test: function (M) { var w = workers(M); if (!w.length) return 'no private targets'; var g = first(M.sgsOf(w[0])); if (!g) return 'targets have no group'; var ins = ingressRules(M, g); if (!ins.length) return 'no ingress on the app group: the ALB cannot reach the targets'; if (ins.some(function (r) { return r.cidrs.length; })) return 'the app group allows a CIDR; restrict it to the ALB group'; return ins.some(function (r) { return r.sgs.length; }) ? true : 'the app ingress does not reference the ALB group'; } });

  LX.tfsKit = { C: C, workers: workers, publicSubnets: publicSubnets, privateSubnets: privateSubnets };
})();
