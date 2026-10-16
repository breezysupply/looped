/* Anduril Round 1 — Terraform structural grader.

   The reference and alternative solutions (the files validate-all.sh checks
   with the real terraform CLI) must pass their lab's checks; deliberately
   broken copies must fail, and fail on the check that names the actual
   defect. T3's three defects must be graded independently. */
const assert = require('assert');
const { spawnSync } = require('child_process');
const H = require('../helpers');

H.loadContent({ shell: true });
const LX = global.LX, G = global.LXHcl;
let n = 0;
function ok(cond, msg) { assert.ok(cond, msg); n++; }

/* the embedded copy is the package on disk */
const sync = spawnSync(process.execPath, [H.repoFile('tools/ar1-tf-src.js'), '--check'], { encoding: 'utf8' });
ok(sync.status === 0, 'ar1-tf-src.js is stale — run node tools/ar1-tf-src.js\n' + sync.stderr);

const lab = id => LX.ar1Tf.find(l => l.id === id);
const src = key => { const f = LX.ar1TfSrc[key]; assert.ok(f, 'missing source ' + key); const o = {}; Object.keys(f).filter(k => /\.tf$/.test(k)).forEach(k => { o[k] = f[k]; }); return o; };
function checksOf(id, v) { const L = lab(id); return v ? L.variants[v].checks() : L.checks(); }
function run(files, id, v) { return G.grade(files, checksOf(id, v)); }
function failing(r) { return r.results.filter(x => !x.ok && x.sev !== 'advice').map(x => x.id).sort(); }
function edit(files, file, from, to) {
  const o = Object.assign({}, files);
  assert.ok(o[file].indexOf(from) !== -1, 'mutation anchor not found in ' + file + ': ' + from.slice(0, 50));
  o[file] = o[file].split(from).join(to);
  return o;
}
function passes(files, id, v, what) { const r = run(files, id, v); ok(r.parsed, what + ' parses: ' + JSON.stringify(r.errors)); ok(r.passed, what + ' passes; failing: ' + failing(r).join(', ') + ' ' + JSON.stringify(r.results.filter(x => !x.ok && x.sev !== 'advice').map(x => x.why))); return r; }
function failsOn(files, id, v, ids, what) {
  const r = run(files, id, v);
  ok(r.parsed, what + ' parses: ' + JSON.stringify(r.errors));
  ok(!r.passed, what + ' should not pass');
  ids.forEach(c => ok(failing(r).indexOf(c) !== -1, what + ': expected check ' + c + ' to fail; failing: ' + failing(r).join(', ')));
  return r;
}

/* ── parser ─────────────────────────────────────────────────────── */
(function parser() {
  const p = G.parse('# c\nresource "a_b" "x" {\n  s = "v-${var.n}"\n  /* block\ncomment */\n  l = [for x in var.y : x]\n  h = <<-EOT\n    hello ${var.n}\n  EOT\n  nested {\n    k = 1 // trailing\n  }\n}\n');
  ok(p.ok, 'parses comments, templates, for, heredoc: ' + p.error);
  const b = p.body.blocks[0];
  ok(b.labels.join('.') === 'a_b.x' && b.blocks[0].type === 'nested', 'labels and nested blocks');
  const bad = G.parse('resource "a" "b" {\n  x = 1\n');
  ok(!bad.ok && /closing/.test(bad.error), 'missing brace reported: ' + bad.error);
  const bad2 = G.parse('resource "a" "b" {\n  x = (1\n}\n');
  ok(!bad2.ok && bad2.line >= 2, 'unbalanced expression reported with a line: ' + JSON.stringify(bad2));
  const bad3 = G.parse('resource "a" "b" {\n  x = 1\n  x = 2\n}\n');
  ok(!bad3.ok && /twice/.test(bad3.error), 'duplicate argument reported');
  ok(G.cidrsubnet('10.20.0.0/16', 8, 11) === '10.20.11.0/24', 'cidrsubnet');
  ok(G.within('10.20.11.0/24', '10.20.0.0/16') && !G.within('10.21.0.0/24', '10.20.0.0/16'), 'within');
  ok(G.overlaps('10.20.0.0/16', '10.20.128.0/17') && !G.overlaps('10.20.0.0/16', '10.21.0.0/16'), 'overlaps');
  const M = new G.Model({ 'm.tf': 'variable "c" {\n  default = "10.9.0.0/16"\n}\nlocals {\n  sub = cidrsubnet(var.c, 8, 2)\n}\nresource "aws_vpc" "v" {\n  cidr_block = var.c\n}\nresource "aws_subnet" "s" {\n  vpc_id     = aws_vpc.v.id\n  cidr_block = local.sub\n}\n' });
  ok(M.ok && M.val(M.find('aws_subnet', 's'), 'cidr_block') === '10.9.2.0/24', 'evaluates var defaults, locals and cidrsubnet');
  ok(M.points(M.find('aws_subnet', 's'), 'vpc_id', 'aws_vpc') === M.find('aws_vpc', 'v'), 'resolves references');
})();

/* ── every embedded configuration parses ───────────────────────── */
Object.keys(LX.ar1TfSrc).forEach(k => { const files = src(k); if (!Object.keys(files).some(f => files[f].trim())) return; const M = new G.Model(files); ok(M.ok, k + ' parses: ' + JSON.stringify(M.errors)); });

/* ── T1 ─────────────────────────────────────────────────────────── */
const t1 = src('T1/reference');
passes(t1, 'T1', null, 'T1 reference');
passes(src('T1/alternative'), 'T1', null, 'T1 alternative (inline route + inline rules, other names)');
failsOn(edit(t1, 'main.tf', 'resource "aws_route_table_association" "public" {\n  subnet_id      = aws_subnet.public.id\n  route_table_id = aws_route_table.public.id\n}\n', ''), 'T1', null, ['route'], 'T1 without the association');
let r = run(edit(t1, 'main.tf', 'resource "aws_route_table_association" "public" {\n  subnet_id      = aws_subnet.public.id\n  route_table_id = aws_route_table.public.id\n}\n', ''), 'T1');
ok(/main route table/.test(r.results.find(x => x.id === 'route').why), 'missing association explained as falling back to the main table');
failsOn(edit(t1, 'main.tf', 'cidr_ipv4         = var.admin_cidr', 'cidr_ipv4         = "0.0.0.0/0"'), 'T1', null, ['in22'], 'T1 with SSH from anywhere');
r = run(edit(t1, 'main.tf', 'cidr_ipv4         = var.admin_cidr', 'cidr_ipv4         = "0.0.0.0/0"'), 'T1');
ok(r.critical.some(c => c.id === 'admin'), 'world SSH is a critical finding');
failsOn(edit(t1, 'main.tf', '  vpc_id      = aws_vpc.main.id\n}\n\nresource "aws_vpc_security_group_ingress_rule" "https"', '  vpc_id      = aws_vpc.main.id\n\n  ingress {\n    protocol    = "tcp"\n    from_port   = 80\n    to_port     = 80\n    cidr_blocks = ["10.0.0.0/8"]\n  }\n}\n\nresource "aws_vpc_security_group_ingress_rule" "https"'), 'T1', null, ['sgstyle'], 'T1 mixing inline and separate rules');
const noEgress = edit(t1, 'main.tf', t1['main.tf'].slice(t1['main.tf'].indexOf('# Terraform removes the default')), '');
failsOn(noEgress, 'T1', null, ['egress'], 'T1 without egress');
r = run(edit(t1, 'main.tf', 'provider "aws" {\n  region = var.region\n}', 'provider "aws" {\n  region     = var.region\n  access_key = "AKIAABCDEFGHIJKLMNOP"\n  secret_key = "not-a-real-secret"\n}'), 'T1');
ok(!r.passed && r.critical.some(c => c.id === 'secrets'), 'embedded credentials are critical');
failsOn(edit(t1, 'main.tf', 'cidr_block              = cidrsubnet(var.vpc_cidr, 8, 1)', 'cidr_block              = "10.99.1.0/24"'), 'T1', null, ['subnet'], 'T1 subnet outside the VPC');
failsOn(edit(t1, 'main.tf', 'gateway_id             = aws_internet_gateway.main.id', 'gateway_id             = "igw-0123456789abcdef0"'), 'T1', null, ['route'], 'T1 default route to a hard-coded ID');
failsOn(edit(t1, 'main.tf', 'resource "aws_route_table" "public" {\n  vpc_id = aws_vpc.main.id\n', 'resource "aws_route_table" "public" {\n  vpc_id = aws_vpc.main.id\n\n  route {\n    cidr_block = "10.99.0.0/16"\n    gateway_id = aws_internet_gateway.main.id\n  }\n'), 'T1', null, ['routestyle'], 'T1 mixing inline routes and aws_route');
failsOn(edit(t1, 'main.tf', '      version = "~> 6.60"\n', ''), 'T1', null, ['pin'], 'T1 without a version constraint');
failsOn(edit(t1, 'main.tf', 'cidr_ipv4         = "0.0.0.0/0"\n}\n\nresource "aws_vpc_security_group_ingress_rule" "ssh_admin"', 'cidr_ipv4         = "10.20.0.0/16"\n}\n\nresource "aws_vpc_security_group_ingress_rule" "ssh_admin"'), 'T1', null, ['in443'], 'T1 HTTPS only from the VPC');
/* names do not matter */
passes(edit(edit(edit(t1, 'main.tf', 'aws_vpc.main', 'aws_vpc.network'), 'outputs.tf', 'aws_vpc.main', 'aws_vpc.network'), 'main.tf', 'resource "aws_vpc" "main"', 'resource "aws_vpc" "network"'), 'T1', null, 'T1 with a renamed VPC');
failsOn(edit(edit(t1, 'main.tf', 'aws_vpc.main', 'aws_vpc.network'), 'main.tf', 'resource "aws_vpc" "main"', 'resource "aws_vpc" "network"'), 'T1', null, ['refs'], 'T1 renamed in one file only (dangling reference)');
failsOn(Object.assign({}, t1, { 'variables.tf': t1['variables.tf'].replace(/variable "admin_cidr"[\s\S]*$/, '') }), 'T1', null, ['refs'], 'T1 using an undeclared variable');

/* ── T2 ─────────────────────────────────────────────────────────── */
const t2a = src('T2/variant-a/reference');
passes(t2a, 'T2', 'a', 'T2a reference');
passes(src('T2/variant-a/alternative'), 'T2', 'a', 'T2a alternative (inline rules, SSM AMI, Elastic IP)');
passes(src('T2/variant-b/reference'), 'T2', 'b', 'T2b reference');
passes(src('T2/variant-c/reference'), 'T2', 'c', 'T2c reference');
failsOn(src('T2/variant-b/reference'), 'T2', 'a', ['vpc', 'in8080'], 'variant B answer submitted for variant A');
failsOn(t2a, 'T2', 'c', ['vpc', 'in9100'], 'variant A answer submitted for variant C');
failsOn(edit(t2a, 'main.tf', 'from_port         = 8080\n  to_port           = 8080', 'from_port         = 80\n  to_port           = 80'), 'T2', 'a', ['in8080'], 'T2a app port wrong');
failsOn(edit(t2a, 'main.tf', 'resource "aws_vpc_security_group_ingress_rule" "ssh_admin" {', 'resource "aws_vpc_security_group_ingress_rule" "db" {\n  security_group_id = aws_security_group.app.id\n  ip_protocol       = "tcp"\n  from_port         = 3306\n  to_port           = 3306\n  cidr_ipv4         = "0.0.0.0/0"\n}\n\nresource "aws_vpc_security_group_ingress_rule" "ssh_admin" {'), 'T2', 'a', ['leastpriv'], 'T2a with an extra world-open port');
failsOn(Object.assign({}, t2a, { 'outputs.tf': '' }), 'T2', 'a', ['outputs'], 'T2a without outputs');
failsOn(edit(t2a, 'main.tf', 'subnet_id              = aws_subnet.public.id', 'subnet_id              = "subnet-0123456789abcdef0"'), 'T2', 'a', ['inst'], 'T2a with a hard-coded subnet');
failsOn(edit(t2a, 'main.tf', 'map_public_ip_on_launch = true', 'map_public_ip_on_launch = false'), 'T2', 'a', ['pubip'], 'T2a with no public IP');
r = run(edit(t2a, 'main.tf', 'ami                    = data.aws_ami.al2023.id', 'ami                    = "ami-0abcdef1234567890"'), 'T2', 'a');
ok(r.passed && r.results.find(x => x.id === 'ami').ok === false, 'hard-coded AMI is advice, not a failure');
r = run(edit(t2a, 'main.tf', t2a['main.tf'].slice(t2a['main.tf'].indexOf('  # An open port'), t2a['main.tf'].indexOf('  tags = {\n    Name = "${var.name}-app"')), ''), 'T2', 'a');
ok(r.passed && r.results.find(x => x.id === 'svc').ok === false, 'missing user_data flagged: an allowed port is not a running service');
const t2b = src('T2/variant-b/reference');
failsOn(edit(t2b, 'main.tf', 'resource "aws_vpc_security_group_egress_rule" "https_out" {', 'resource "aws_vpc_security_group_ingress_rule" "ssh" {\n  security_group_id = aws_security_group.api.id\n  ip_protocol       = "tcp"\n  from_port         = 22\n  to_port           = 22\n  cidr_ipv4         = "198.51.100.0/24"\n}\n\nresource "aws_vpc_security_group_egress_rule" "https_out" {'), 'T2', 'b', ['no22'], 'T2b with SSH added');
failsOn(edit(t2b, 'variables.tf', 'default     = "198.51.100.0/24"', 'default     = "0.0.0.0/0"'), 'T2', 'b', ['in443'], 'T2b with HTTPS opened to everyone');
failsOn(edit(t2b, 'main.tf', '    http_tokens = "required"', '    http_tokens = "optional"'), 'T2', 'b', ['imds'], 'T2b with IMDSv1 allowed');
const t2c = src('T2/variant-c/reference');
failsOn(edit(t2c, 'main.tf', 'referenced_security_group_id = aws_security_group.monitoring.id', 'cidr_ipv4                    = "10.50.0.0/16"'), 'T2', 'c', ['in9100'], 'T2c with a CIDR instead of the monitoring group');

/* ── T3: each defect graded on its own ─────────────────────────── */
const t3 = src('T3/broken');
const r3 = failsOn(t3, 'T3', null, ['route', 'in443', 'sgvpc'], 'T3 broken');
ok(failing(r3).join(',') === ['in443', 'route', 'sgvpc'].join(','), 'T3 broken fails exactly its three defects: ' + failing(r3).join(','));
const fixD1 = edit(t3, 'main.tf', 'resource "aws_security_group" "web" {', 'resource "aws_route_table_association" "public" {\n  subnet_id      = aws_subnet.public.id\n  route_table_id = aws_route_table.public.id\n}\n\nresource "aws_security_group" "web" {');
ok(failing(run(fixD1, 'T3')).join(',') === 'in443,sgvpc', 'fixing D1 alone clears only the routing check');
const fixD2 = edit(t3, 'main.tf', 'cidr_ipv4         = aws_vpc.main.cidr_block', 'cidr_ipv4         = "0.0.0.0/0"');
ok(failing(run(fixD2, 'T3')).join(',') === 'route,sgvpc', 'fixing D2 alone clears only the filtering check');
const fixD3 = edit(t3, 'main.tf', '  description = "Public web server"\n}', '  description = "Public web server"\n  vpc_id      = aws_vpc.main.id\n}');
ok(failing(run(fixD3, 'T3')).join(',') === 'in443,route', 'fixing D3 alone clears only the reference check');
passes(src('T3/reference'), 'T3', null, 'T3 reference');
r = run(edit(src('T3/reference'), 'main.tf', 'from_port         = 443\n  to_port           = 443\n  cidr_ipv4         = "0.0.0.0/0" # D2', 'from_port         = 0\n  to_port           = 65535\n  cidr_ipv4         = "0.0.0.0/0" # D2'), 'T3');
ok(!r.passed && r.critical.some(c => c.id === 'admin'), '"fix" by opening every port is rejected as critical');
ok(lab('T3').defects.every(d => checksOf('T3').some(c => c.id === d.check)), 'every T3 defect maps to a check');

/* ── T4 ─────────────────────────────────────────────────────────── */
const t4 = src('T4/reference');
passes(t4, 'T4', null, 'T4 reference');
failsOn(edit(t4, 'main.tf', 'allocation_id = aws_eip.nat.id\n  subnet_id     = aws_subnet.public.id', 'allocation_id = aws_eip.nat.id\n  subnet_id     = aws_subnet.private.id'), 'T4', null, ['nat'], 'T4 NAT gateway in the private subnet');
failsOn(edit(t4, 'main.tf', 'nat_gateway_id         = aws_nat_gateway.main.id', 'gateway_id             = aws_internet_gateway.main.id'), 'T4', null, ['privroute', 'apppriv'], 'T4 private default route to the IGW (subnet becomes public)');
failsOn(edit(t4, 'main.tf', 'associate_public_ip_address = false', 'associate_public_ip_address = true'), 'T4', null, ['apppriv'], 'T4 app with a public IP');
failsOn(edit(t4, 'main.tf', 'referenced_security_group_id = aws_security_group.web.id', 'cidr_ipv4                    = "0.0.0.0/0"'), 'T4', null, ['appsg'], 'T4 app port open to a CIDR');
failsOn(edit(t4, 'main.tf', 'resource "aws_route_table_association" "private" {\n  subnet_id      = aws_subnet.private.id\n  route_table_id = aws_route_table.private.id\n}\n', ''), 'T4', null, ['privroute'], 'T4 without the private association');

/* ── lab metadata ───────────────────────────────────────────────── */
LX.ar1Tf.forEach(L => {
  ok(L.hints.length === 4, L.id + ' has four hint rungs');
  ok(L.rubric.length >= 3 && L.mistakes.length >= 3 && L.verify.length === 3, L.id + ' rubric, mistakes, verification');
  const sols = L.variants ? Object.keys(L.variants).map(v => L.variants[v].solution) : [L.solution];
  sols.forEach(s => ok(LX.ar1TfSrc[s], L.id + ' solution source ' + s));
});
ok(Object.keys(lab('T2').variants).length >= 2, 'T2 has at least two fresh variants');
ok(new Set(Object.keys(lab('T2').variants).map(v => lab('T2').variants[v].prompt.match(/\*\*([\d.\/]+)\*\*/)[1])).size === 3, 'T2 variants use different VPC ranges');

console.log(n + ' Terraform grader checks passed · ' + Object.keys(LX.ar1TfSrc).length + ' embedded configurations');
