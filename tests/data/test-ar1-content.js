/* Anduril Round 1 — path content and the VPC model.

   Time budgets (core 360, triage 180, optional work outside both), every
   referenced id resolves, the required counts from the brief (12+ module A
   retrieval items of mixed types, six scenarios with at least four
   interactive, four Terraform labs, a blank-editor lab with 2+ variants,
   three Bash exercises, two+ mocks with the stated rubric weights), no
   placeholder text, sourced links carry an access date and status, and the
   VPC model's rules: longest-prefix match, main-table fallback, NACL rule
   order and implicit deny, ephemeral return ports, NAT return path, and
   evidence that changes when the topology changes. */
const assert = require('assert');
const fs = require('fs');
const H = require('../helpers');

H.loadContent({ shell: true });
const LX = global.LX, N = global.LXNet;
let n = 0;
function ok(c, m) { assert.ok(c, m); n++; }

const P = LX.ar1;
/* ── budgets ───────────────────────────────────────────────────── */
const sum = a => a.reduce((t, x) => t + x.mins, 0);
ok(P.sessions.length === 7, 'seven core sessions');
ok(sum(P.sessions) === 360, 'core sprint is 360 min, got ' + sum(P.sessions));
P.sessions.forEach(s => ok(sum(s.items) === s.mins, s.id + ' items sum to ' + s.mins + ' (got ' + sum(s.items) + ')'));
ok([45, 60, 60, 60, 30, 60, 45].join() === P.sessions.map(s => s.mins).join(), 'session lengths match the brief');
ok(P.triage.mins === 180 && sum(P.triage.blocks) === 180, 'triage is 180 min');
P.triage.blocks.forEach(b => ok(sum(b.items) === b.mins, 'triage block ' + b.title + ' sums'));
ok([30, 30, 45, 15, 60].join() === P.triage.blocks.map(b => b.mins).join(), 'triage blocks match the brief');
ok(/reduced coverage/i.test(P.triage.label) && P.triage.skipped.length >= 4, 'triage labelled reduced coverage, with skipped topics');
ok(P.weights.net + P.weights.tf + P.weights.bash === 100 && P.weights.net === 45 && P.weights.tf === 45, 'weights 45/45/10');

/* ── ids resolve ───────────────────────────────────────────────── */
const by = (k, id) => (LX[k] || []).find(x => x.id === id);
function resolves(it) {
  switch (it.kind) {
    case 'diag': return !!LX.ar1Diag;
    case 'lesson': return !!by('ar1Lessons', it.id);
    case 'exercise': return !!by('ar1Exercises', it.id);
    case 'transfer': return !!by('ar1Exercises', 'X2');
    case 'review': return it.id === 'mock-review' || !!LX.ar1Recall[it.id];
    case 'scenario': return LX.missions.some(m => m.track === 'anduril' && m.sre && m.sre.scenarioId === it.id);
    case 'card': return !!by('ar1Cards', it.id);
    case 'tf': { const L = by('ar1Tf', it.id); return !!L && L.modes.indexOf(it.mode) !== -1 && (!it.variant || !!L.variants[it.variant]); }
    case 'bash': return !!by('ar1Bash', it.id);
    case 'mock': return !!by('ar1Mocks', it.id);
    case 'remediate': return true;
    default: return false;
  }
}
const allItems = [].concat(...P.sessions.map(s => s.items), ...P.triage.blocks.map(b => b.items), P.extra);
allItems.forEach(it => ok(resolves(it), 'path item resolves: ' + JSON.stringify(it)));
ok(P.extra.every(x => x.why), 'every optional item says why');
ok(P.sessions.every(s => s.why), 'every session says why it matters');

/* ── lessons ───────────────────────────────────────────────────── */
const SRC = new Set(P.sources.map(s => s.id));
LX.ar1Lessons.forEach(l => {
  ['plain', 'precise', 'explainAloud'].forEach(f => ok(l[f] && l[f].length > 20, l.id + ' has ' + f));
  ok(l.misconception && l.misconception.wrong && l.misconception.right, l.id + ' misconception');
  ok(l.recall && l.recall.length && l.recall.every(r => r.q && r.a), l.id + ' recall');
  ok(l.apply && l.apply.task && l.apply.answer, l.id + ' application task');
  ok(l.checklist && l.checklist.length >= 2, l.id + ' self-check');
  (l.prereqs || []).forEach(p => ok(by('ar1Lessons', p), l.id + ' prereq ' + p));
  (l.refs || []).forEach(r => ok(SRC.has(r), l.id + ' ref ' + r));
});
['A', 'B', 'C', 'D'].forEach(m => ok(LX.ar1Lessons.some(l => l.module === m), 'module ' + m + ' has lessons'));

/* ── retrieval items ───────────────────────────────────────────── */
const A = LX.ar1Items.filter(q => q.module === 'A');
ok(A.length >= 12, 'module A has 12+ retrieval items (' + A.length + ')');
ok(A.filter(q => q.type !== 'mcq').length >= 5, 'module A is not all multiple choice');
['explain', 'interpret', 'troubleshoot'].forEach(k => ok(A.some(q => q.kind === k), 'module A has ' + k + ' items'));
const ids = new Set();
LX.ar1Items.forEach(q => {
  ok(!ids.has(q.id), 'unique item id ' + q.id); ids.add(q.id);
  ok(by('ar1Lessons', q.lesson), q.id + ' lesson resolves');
  if (q.type === 'mcq') ok(q.choices.length >= 3 && q.a >= 0 && q.a < q.choices.length && q.why, q.id + ' mcq well-formed');
  if (q.type === 'text') { ok(q.accept.length && q.a, q.id + ' text answer'); ok(q.accept.some(re => new RegExp(re, 'i').test(String(q.a).replace(/ \(.*\)$/, ''))), q.id + ' accepts its own display answer'); }
  if (q.type === 'num') ok(typeof q.a === 'number', q.id + ' numeric');
  if (q.type === 'order') ok(q.steps.length >= 3, q.id + ' order steps');
  if (q.type === 'self') ok(q.a && q.points.length >= 2, q.id + ' self-check points');
});
ok(new RegExp(by('ar1Items', 'ar1-qa-11').accept[0], 'i').test('32768-61000'), 'Linux ephemeral range accepts the AWS-documented 61000 too');
Object.keys(LX.ar1Recall).forEach(k => ok(LX.ar1Recall[k].modules.every(m => LX.ar1Items.some(q => q.module === m)), k + ' draws from populated modules'));
ok(LX.ar1Diag.items.length >= 10 && new Set(LX.ar1Diag.items.map(q => q.domain)).size === 4, 'diagnostic covers four domains');
['X1', 'X2'].forEach(id => {
  const X = by('ar1Exercises', id);
  ok(X.parts.some(p => p.type === 'classify') && X.parts.some(p => p.type === 'order'), id + ' has ordering and evidence classification');
  ok(/return|reply|back/i.test(JSON.stringify(X.parts)), id + ' covers the return path');
});
const cls = by('ar1Exercises', 'X1').parts.find(p => p.type === 'classify');
['DNS', 'Route', 'Filter', 'TLS', 'HTTP'].forEach(c => ok(cls.items.some(i => i.cat === c), 'X1 evidence includes a ' + c + ' failure'));

/* ── scenarios and cards ───────────────────────────────────────── */
const scen = LX.missions.filter(m => m.track === 'anduril' && m.sre);
ok(scen.length >= 4, 'at least four interactive scenarios');
ok(scen.length + LX.ar1Cards.length >= 6, 'six scenarios in all');
scen.forEach(m => {
  ok(m.sre.hub === 'LXAr1', m.id + ' routes to the AR1 hub');
  ok(m.sre.variants.length >= 2, m.id + ' has two variants');
  (m.sre.prereqs || []).forEach(p => ok(by('ar1Lessons', p), m.id + ' prereq ' + p));
  (m.sre.refs || []).forEach(r => ok(SRC.has(r), m.id + ' ref ' + r));
});
LX.ar1Cards.forEach(c => (c.refs || []).forEach(r => ok(SRC.has(r), c.id + ' ref ' + r)));
ok(by('ar1Cards', 'N5').unsafe.some(u => /open|firewall|security group/i.test(u)), 'N5 says opening the firewall is not the fix');
ok(by('ar1Cards', 'N6').options.filter(o => o.verdict === 'strong' || o.verdict === 'defensible').length >= 2, 'N6 accepts more than one defensible design');

/* ── labs, bash, mocks ─────────────────────────────────────────── */
ok(['T1', 'T2', 'T3', 'T4'].every(id => by('ar1Tf', id)), 'four Terraform labs');
ok(Object.keys(by('ar1Tf', 'T2').variants).length >= 2 && by('ar1Tf', 'T2').modes.indexOf('interview') !== -1, 'blank-editor lab has 2+ variants and interview mode');
LX.ar1Tf.forEach(L => (L.refs || []).forEach(r => ok(SRC.has(r), L.id + ' ref ' + r)));
ok(LX.ar1Bash.length === 3, 'three Bash exercises');
LX.ar1Bash.forEach(B => { ok(fs.existsSync(H.repoFile('labs/anduril-round1/bash', B.dir, 'tests.sh')), B.id + ' has local tests'); ok(fs.existsSync(H.repoFile('labs/anduril-round1/bash', B.dir, 'solution', B.script)), B.id + ' has a reference solution'); ok(B.hints.length === 4, B.id + ' four hint rungs'); });
ok(LX.ar1Mocks.length >= 2, 'two or more mocks');
const W = m => Object.fromEntries(by('ar1Mocks', m).rubric.map(r => [r.id, r.weight]));
LX.ar1Mocks.forEach(M => {
  ok(sum(M.phases) === M.mins, M.id + ' phases sum to ' + M.mins);
  ok(M.rubric.reduce((t, r) => t + r.weight, 0) === 100, M.id + ' rubric weights sum to 100');
  M.phases.filter(p => p.kind === 'tf').forEach(p => { ok(LX.ar1TfSrc[p.solution], M.id + ' reference solution embedded'); ok(global.LXHcl.grade(Object.fromEntries(Object.entries(LX.ar1TfSrc[p.solution]).filter(([f]) => /\.tf$/.test(f))), p.checks()).passed, M.id + ' reference passes its own checks'); });
  M.phases.filter(p => p.kind === 'bash').forEach(p => ok(fs.readdirSync(H.repoFile('labs/anduril-round1/bash')).some(d => d.indexOf(p.exercise + '-') === 0), M.id + ' bash exercise ' + p.exercise + ' exists'));
  M.phases.filter(p => p.kind === 'net').forEach(p => p.questions.forEach(q => ok(LX.ar1MockKit.followups[q], M.id + ' follow-up ' + q)));
});
ok(JSON.stringify(W('MA')) === JSON.stringify({ net: 35, tf: 35, verify: 15, comm: 10, clarify: 5 }), 'Mock A rubric weights');
ok(W('MB').tf === 25 && W('MB').bash === 10 && W('MB').net === 35, 'mixed mock moves 10 points from Terraform to Bash');
ok(JSON.stringify(by('ar1Mocks', 'MA').phases.map(p => p.mins)) === JSON.stringify([5, 35, 15, 5]), 'Mock A phases 5/35/15/5');
ok(JSON.stringify(by('ar1Mocks', 'MB').phases.map(p => p.mins)) === JSON.stringify([5, 25, 15, 10, 5]), 'Mock B phases 5/25/15/10/5');

/* ── sources and honesty ───────────────────────────────────────── */
P.sources.forEach(s => { ok(/^https:\/\//.test(s.url), s.id + ' https'); ok(s.accessed && s.status, s.id + ' has access date and status'); });
const files = ['ar1-path', 'ar1-lessons', 'ar1-items', 'ar1-tf', 'ar1-bash', 'ar1-mocks', 'ar1-scenarios', 'ar1-quiz'].map(f => fs.readFileSync(H.repoFile('assets/js/data', f + '.js'), 'utf8')).concat([fs.readFileSync(H.repoFile('assets/js/ar1.js'), 'utf8')]);
files.forEach((txt, i) => ok(!/\b(TODO|TBD|FIXME|XXX|lorem ipsum)\b/.test(txt), 'no placeholder text in file ' + i));
const allText = files.join('\n');
ok(!/pass(ing)? probability|chance of passing|likely to pass/i.test(allText), 'no pass probability anywhere');
ok(/not real Anduril/i.test(allText) && /invented/i.test(P.invented), 'invented practice is labelled');
ok(!/real Anduril (interview )?question[^s]/i.test(allText.replace(/(not|none of it is a) real Anduril[^.']*/gi, '')), 'nothing claims to be a real Anduril question');
ok(LX.quiz.filter(q => q.track === 'anduril').length >= 15 && LX.drills.filter(q => q.track === 'anduril').length >= 8, 'items reach the shared Quiz and Drills pools');

/* ── VPC model ─────────────────────────────────────────────────── */
function topo() {
  return {
    vpcs: { v: { cidr: '10.0.0.0/16' } },
    subnets: { pub: { vpc: 'v', cidr: '10.0.1.0/24' }, priv: { vpc: 'v', cidr: '10.0.11.0/24' } },
    rtbs: {
      main: { id: 'main', vpc: 'v', main: true, routes: [{ dest: '10.0.0.0/16', target: 'local' }] },
      rp: { id: 'rp', vpc: 'v', routes: [{ dest: '10.0.0.0/16', target: 'local' }, { dest: '0.0.0.0/0', target: 'igw-1' }] },
      rq: { id: 'rq', vpc: 'v', routes: [{ dest: '10.0.0.0/16', target: 'local' }, { dest: '0.0.0.0/0', target: 'nat-1' }, { dest: '192.0.2.0/24', target: 'local' }] }
    },
    assoc: { pub: { rtb: 'rp' }, priv: { rtb: 'rq' } },
    igws: { 'igw-1': { vpc: 'v' } }, nats: { 'nat-1': { subnet: 'pub', eip: '203.0.113.40', privateIp: '10.0.1.10', state: 'available' } },
    sgs: { web: { id: 'web', ingress: [{ proto: 'tcp', from: 443, to: 443, cidr: '0.0.0.0/0' }], egress: [{ proto: '-1', from: -1, to: -1, cidr: '0.0.0.0/0' }] },
      app: { id: 'app', ingress: [], egress: [{ proto: 'tcp', from: 443, to: 443, cidr: '0.0.0.0/0' }] } },
    nacls: {}, endpoints: {},
    instances: {
      w: { id: 'w', subnet: 'pub', privateIp: '10.0.1.30', publicIp: '203.0.113.30', eni: 'eni-w', sgs: ['web'], listeners: [{ port: 443, proc: 'nginx' }] },
      a: { id: 'a', subnet: 'priv', privateIp: '10.0.11.25', eni: 'eni-a', sgs: ['app'], listeners: [] }
    },
    internet: { '192.0.2.80': { name: 'api', listeners: [443] } }, dns: {}, client: { ip: '198.51.100.45', os: 'macos' }, flows: []
  };
}
let t = topo();
ok(N.routeLookup(t, t.rtbs.rq, '192.0.2.80').route.target === 'local', 'longest prefix wins over the default route');
ok(N.routeLookup(t, t.rtbs.rq, '8.8.8.8').route.target === 'nat-1', 'default route used otherwise');
delete t.assoc.priv;
ok(N.rtbFor(t, 'priv').id === 'main', 'an unassociated subnet falls back to the main table');
const nacl = { id: 'acl', entries: [{ n: 90, proto: 'tcp', from: 22, to: 22, cidr: '0.0.0.0/0', action: 'deny' }, { n: 100, proto: 'tcp', from: 22, to: 22, cidr: '198.51.100.0/24', action: 'allow' }] };
ok(!N.naclDecision(nacl, 'in', 'tcp', 22, '198.51.100.45').allow, 'NACL: lowest rule number wins, not the most specific');
ok(/\*/.test(N.naclDecision(nacl, 'in', 'tcp', 443, '198.51.100.45').rule), 'NACL: implicit deny at the end');
ok(N.naclDecision({ isDefault: true }, 'in', 'tcp', 1, '1.2.3.4').allow, 'default NACL allows');

t = topo();
ok(N.connect(N.clone(t), 'client', '203.0.113.30', 443).result === 'ok', 'client reaches the public web server');
ok(N.connect(N.clone(t), 'a', '192.0.2.80', 443).result !== 'ok', 'private instance with a local-only route for the target does not reach it');
t.rtbs.rq.routes = t.rtbs.rq.routes.filter(r => r.dest !== '192.0.2.0/24');
ok(N.connect(N.clone(t), 'a', '192.0.2.80', 443).result === 'ok', 'private instance reaches the internet through NAT');
/* stateless return path: allow 443 both ways only */
t.nacls.web = { id: 'acl-web', subnets: ['pub'], entries: [{ n: 100, proto: 'tcp', from: 443, to: 443, cidr: '0.0.0.0/0', action: 'allow' }, { n: 100, egress: true, proto: 'tcp', from: 443, to: 443, cidr: '0.0.0.0/0', action: 'allow' }] };
let r = N.connect(N.clone(t), 'client', '203.0.113.30', 443);
ok(r.result === 'timeout', 'reply to the client ephemeral port is denied by a 443-only outbound NACL');
const c2 = N.clone(t); c2.flows = []; N.connect(c2, 'client', '203.0.113.30', 443);
ok(c2.flows.some(f => / 443 (49|5|6)\d+ 6 .* REJECT OK$/.test(f)), 'flow log shows the REJECTed reply to an ephemeral port: ' + c2.flows.join(' | '));
t.nacls.web.entries.push({ n: 110, egress: true, proto: 'tcp', from: 1024, to: 65535, cidr: '0.0.0.0/0', action: 'allow' });
ok(N.connect(N.clone(t), 'client', '203.0.113.30', 443).result === 'ok', 'adding the ephemeral outbound rule changes the outcome');
/* NAT's own subnet NACL governs the return from the internet */
t.nacls.web.entries = t.nacls.web.entries.filter(e => e.n !== 110);
ok(N.connect(N.clone(t), 'a', '192.0.2.80', 443).result !== 'ok', 'NAT return traffic is subject to the public subnet NACL');
t = topo(); t.rtbs.rq.routes = t.rtbs.rq.routes.filter(r => r.dest !== '192.0.2.0/24');
t.rtbs.rq.routes = t.rtbs.rq.routes.map(r => r.dest === '0.0.0.0/0' ? { dest: '0.0.0.0/0', target: 'igw-1' } : r);
ok(N.connect(N.clone(t), 'a', '192.0.2.80', 443).result === 'timeout', 'an IGW route does not work for an instance without a public IP');
t = topo(); t.sgs.web.ingress = [];
r = N.connect(N.clone(t), 'client', '203.0.113.30', 443);
ok(r.result === 'timeout' && /security.group/i.test(r.why), 'security groups drop silently (timeout): ' + r.why);
t = topo(); t.instances.w.listeners = [];
ok(N.connect(N.clone(t), 'client', '203.0.113.30', 443).result === 'refused', 'reachable host without a listener refuses');

console.log(n + ' AR1 content and model checks passed');
