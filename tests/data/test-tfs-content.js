/* Terraform + AWS tech-screen course (terraform-aws-tech-screen): content,
   practice checks and the simulated CLI.

   Budgets (435 recommended, 305 minimum, the nine-day schedule), every path
   item resolves, every substantial lesson has the full Learn → Predict →
   Build → Check → Explain → Rebuild set with a 250–450 word explanation,
   lesson and lab reference solutions pass their own checks while starters
   fail them, assistance levels really differ, each injected fault and bug
   ticket is caught for the right reason, renamed/reordered HCL still
   passes, the mock rubric adds to 100 with automatic and manual points kept
   apart, seeded variants differ materially, the embedded files match the
   lab package, and the simulated terminal behaves as a state machine
   driven by the learner's files. */
const assert = require('assert');
const fs = require('fs');
const { spawnSync } = require('child_process');
const H = require('../helpers');

H.loadContent({ shell: true });
const LX = global.LX, G = global.LXHcl, S = require(H.repoFile('assets/js/tfs-sim.js'));
let n = 0;
function ok(c, m) { assert.ok(c, m); n++; }
const T = LX.tfs, by = (k, id) => (LX[k] || []).find(x => x.id === id);
const tf = key => { const f = LX.tfsSrc[key]; assert.ok(f, 'missing ' + key); const o = {}; Object.keys(f).forEach(k => { if (/\.tf$/.test(k)) o[k] = f[k]; }); return o; };
const sum = a => a.reduce((t, x) => t + x.mins, 0);

/* ── budgets and paths ─────────────────────────────────────────── */
ok(T.id === 'terraform-aws-tech-screen', 'stable course id');
const want = { m0: 10, m1: 40, m2: 40, m3: 65, m4: 65, m5: 50, m6: 45, m7: 110, m8: 10 };
T.modules.forEach(m => { ok(m.mins === want[m.id], m.id + ' core time ' + want[m.id]); ok(sum(m.items) === m.mins, m.id + ' items sum to ' + m.mins + ' (got ' + sum(m.items) + ')'); });
ok(sum(T.modules) === 435, 'recommended total 435');
const min = T.modules.filter(m => T.paths.minimum.modules.includes(m.id)).reduce((t, m) => t + (m.id === 'm5' ? sum(m.items.filter(i => i.min)) : m.id === 'm7' ? sum(m.items.filter(i => T.paths.minimum.m7Only.includes(i.kind + ':' + i.id))) : m.mins), 0);
ok(min === 305, 'minimum path 305 (got ' + min + ')');
ok(sum(T.modules.find(m => m.id === 'm5').items.filter(i => i.min)) === 20, 'Module 5 essentials are 20 minutes');
ok(/not equivalent/i.test(T.paths.minimum.note), 'minimum path is not called equivalent');
ok(JSON.stringify(T.schedule.map(d => [d.date, d.mins])) === JSON.stringify([['2026-10-21', 50], ['2026-10-22', 40], ['2026-10-23', 35], ['2026-10-24', 60], ['2026-10-25', 35], ['2026-10-26', 50], ['2026-10-27', 45], ['2026-10-28', 55], ['2026-10-29', 65]]), 'nine-day schedule matches the brief');
ok(sum(T.schedule) === 435 && T.warmup.date === '2026-10-30' && T.warmup.mins === 10, 'schedule totals 435, Oct 30 warm-up only');
T.schedule.forEach(d => d.items.forEach(ref => { const p = ref.split(':'), m = T.modules.find(x => x.id === p[0]); ok(m && (p[1] === '*' || m.items.some(i => i.kind === p[1] && i.id === p[2])), 'schedule ref resolves: ' + ref); }));
ok(T.modules.flatMap(m => m.items).every(it => T.schedule.some(d => d.items.some(r => { const p = r.split(':'); return T.modules.find(m => m.id === p[0]).items.includes(it) && (p[1] === '*' || (p[1] === it.kind && p[2] === it.id)); }))), 'every core item is scheduled');
ok(T.interview.date === '2026-10-30' && T.interview.tz === 'America/New_York' && /confirm actual interview rules/.test(T.interview.docsLabel), 'interview facts and docs label');
ok(/not a known Anduril question/.test(T.interview.disclaimer) && /HackerRank/.test(T.interview.disclaimer), 'practice is not presented as real questions or HackerRank');

/* ── items resolve ─────────────────────────────────────────────── */
T.modules.forEach(m => m.items.forEach(it => {
  const r = { lesson: () => by('tfsLessons', it.id), diag: () => LX.tfsDiag, lab: () => { const L = by('tfsLabs', it.id); return L && L.levels[it.level]; }, quiz: () => LX.tfsQuiz.filter(q => q.module === it.id).length >= 3, oral: () => LX.tfsOral.filter(o => o.module === it.id).length >= 2, faults: () => by('tfsLabs', 'b3').faults.length === 5, plan: () => by('tfsPlans', it.id), tickets: () => LX.tfsTickets.filter(t => t.set === it.id).length, mock: () => by('tfsMocks', it.id), mockreview: () => by('tfsMocks', it.id), readiness: () => LX.tfsReadiness }[it.kind];
  ok(r && r(), 'item resolves: ' + m.id + ' ' + it.kind + ' ' + it.id);
}));
T.optional.forEach(o => ok(o.kind === 'rehearsal' || o.kind === 'readmore' || (o.kind === 'lab' ? by('tfsLabs', o.id).levels[o.level] : by('tfsMocks', o.id).variants[o.variant]), 'optional item resolves: ' + o.kind + ' ' + o.id));
const SRC = new Set(T.sources.map(s => s.id));
T.sources.forEach(s => ok(/^https:\/\//.test(s.url) && s.accessed && s.status, s.id + ' dated and https'));

/* ── lessons ───────────────────────────────────────────────────── */
LX.tfsLessons.forEach(l => {
  (l.refs || []).forEach(r => ok(SRC.has(r), l.id + ' ref ' + r));
  if (l.light) return;
  const w = l.body.split(/\s+/).filter(Boolean).length;
  ok(w >= 250 && w <= 450, l.id + ' explanation 250–450 words (' + w + ')');
  ok(l.objective && Array.isArray(l.prereqs), l.id + ' objective and prerequisites');
  ok(l.example && l.example.code && l.example.notes.length, l.id + ' annotated example');
  ok(l.predict && l.predict.choices.length >= 3 && l.predict.why, l.id + ' prediction');
  const t = l.task;
  ok(t && t.prompt && t.success.length && t.hints.length === 3 && t.solution && t.why && t.mistakes.length && t.alternative, l.id + ' full task');
  const solved = t.solutionMode === 'replace' ? t.solution : (t.start || '') + '\n' + t.solution;
  ok(G.grade({ 'main.tf': solved }, t.checks()).passed, l.id + ' solution passes its checks');
  ok(!G.grade({ 'main.tf': t.start || '' }, t.checks()).passed, l.id + ' starting file fails its checks');
  ok(l.oral.length >= 2 && l.oral.length <= 3, l.id + ' two or three oral prompts');
  ok(l.retrieval, l.id + ' retrieval task');
  if (l.retrieval.checks) ok(!G.grade({ 'main.tf': l.retrieval.start || '' }, l.retrieval.checks()).passed, l.id + ' retrieval start does not already pass');
});
ok(LX.tfsLessons.filter(l => !l.light).length >= 14, 'fourteen substantial lessons');

/* ── labs ──────────────────────────────────────────────────────── */
LX.tfsLabs.forEach(L => {
  ok(L.hints.length === 3 && L.mistakes.length && L.oral.length && L.success.length && L.brief, L.id + ' complete');
  (L.refs || []).forEach(r => ok(SRC.has(r), L.id + ' ref ' + r));
  Object.keys(L.variants).forEach(v => {
    const V = L.variants[v], res = G.grade(tf(V.solution), V.checks());
    ok(res.passed, L.id + '/' + v + ' reference passes: ' + res.results.filter(r => !r.ok && r.sev !== 'advice').map(r => r.id + ':' + r.why).join(' | '));
    (V.alternatives || []).filter(a => a.src).forEach(a => { const r = G.grade(tf(a.src), V.checks()); ok(r.parsed && r.results.filter(x => !x.ok && x.sev !== 'advice').every(x => ['region', 'typed'].includes(x.id)), L.id + ' alternative ' + a.src + ' differs only where documented'); });
    Object.keys(L.levels).forEach(lv => { const s = L.levels[lv].src; if (s) ok(!G.grade(tf(s), V.checks()).passed, L.id + ' ' + lv + ' starter does not already pass'); });
  });
  if (L.levels.guided && L.levels.guided.src && L.levels.scaffolded && L.levels.scaffolded.src) {
    const g = Object.values(tf(L.levels.guided.src)).join(''), s = Object.values(tf(L.levels.scaffolded.src)).join('');
    ok(g.length > s.length && /TODO/.test(s) && g !== s, L.id + ' guided gives more than the scaffold');
  }
  if (L.levels.requirements) ok(L.levels.requirements.blank || L.levels.requirements.src, L.id + ' requirements level defined');
  if (L.aws) ok(L.aws.billable.length && L.aws.cleanup.length && L.aws.gone && L.aws.steps.some(s => /destroy/.test(s)), L.id + ' AWS mode lists billables, cleanup and verification');
  if (L.aws) ok(!/\$\s?\d|per hour is|costs about|free tier (covers|includes)/i.test(JSON.stringify(L.aws)), L.id + ' no fabricated prices or free-tier promises');
});
const b3 = by('tfsLabs', 'b3');
b3.faults.forEach(F => {
  const f = tf(b3.variants.base.solution);
  F.edits.forEach(([a, c]) => { ok(f['main.tf'].includes(a), F.id + ' anchor present'); f['main.tf'] = f['main.tf'].split(a).join(c); });
  const r = G.grade(f, b3.variants.base.checks());
  ok(r.parsed && !r.passed && !r.results.find(x => x.id === F.expect).ok, F.id + ' detected by ' + F.expect);
  ok(F.symptom && F.diagnosis && F.fix && F.explain, F.id + ' symptom, diagnosis, correction, explanation');
});
ok(['NAT gateway in the private', 'association', 'internet gateway', 'public IP', 'egress'].every(k => b3.faults.some(F => F.title.indexOf(k) !== -1 || F.title.toLowerCase().indexOf(k.toLowerCase()) !== -1)), 'the five required faults are present');
const b4 = by('tfsLabs', 'b4');
ok(G.grade(tf(b4.change.solution), b4.change.checks()).passed && !G.grade(tf(b4.variants.base.solution), b4.change.checks()).passed, 'Build 4 change request is graded on its own');
ok(b4.budget.reduce((t, x) => t + x[1], 0) === 45 && !b4.levels.guided, 'Build 4: 5/25/10/5 budget, no guided level');
const b2 = by('tfsLabs', 'b2');
ok(!G.grade(tf(b2.variants.base.solution), b2.variants.rebuild.checks()).passed, 'Build 2 rebuild variant changes the required values');
/* equivalent HCL: renamed resources, reordered blocks, one file */
const ref2 = tf(b2.variants.base.solution);
const renamed = Object.values(ref2).join('\n').replace(/aws_vpc\.main/g, 'aws_vpc.edge').replace(/"aws_vpc" "main"/, '"aws_vpc" "edge"').replace(/aws_security_group\.web/g, 'aws_security_group.http').replace(/"aws_security_group" "web"/, '"aws_security_group" "http"');
const blocks = renamed.split(/\n(?=resource |data |variable |output |locals |provider |terraform )/);
ok(G.grade({ 'everything.tf': blocks.reverse().join('\n') }, b2.variants.base.checks()).passed, 'renamed, reordered, single-file equivalent passes');

/* ── tickets and plan ──────────────────────────────────────────── */
ok(LX.tfsTickets.length >= 8, 'eight or more bug tickets');
LX.tfsTickets.forEach(t => {
  ok(t.cat in T.mistakeCats && t.fix && t.feedback && t.choices[t.a], t.id + ' complete');
  if (t.error) ok(/Recorded/.test(t.provenance), t.id + ' error marked as recorded');
  else ok(t.symptom && t.kind === 'semantic', t.id + ' no-error tickets are semantic');
  if (t.fixCheck) ok(!G.grade({ 'main.tf': t.files }, t.fixCheck(), { noRefs: true }).passed, t.id + ' broken file fails its fix check');
});
['undeclared', 'Unsupported attribute', 'Invalid default value', 'Invalid index'].forEach(e => ok(LX.tfsTickets.some(t => (t.error || '').indexOf(e) !== -1 || (t.error || '').indexOf('Reference to ' + e) !== -1), 'ticket for: ' + e));
ok(LX.tfsTickets.filter(t => t.set === 'essentials').map(t => t.cat).sort().join() === 'references,references,routing,verification', 'essentials: references ×2, routing, validate vs connectivity');
const P = LX.tfsPlans[0];
ok(P.synthetic && /synthetic/i.test(P.context) && ['-/+', '~ ', '- resource', '+ resource'].every(s => P.text.includes(s)), 'plan exercise is labelled synthetic and has all markers');

/* ── knowledge checks and oral prompts ─────────────────────────── */
ok(LX.tfsQuiz.length >= 24, '24+ knowledge checks');
['m1', 'm2', 'm3', 'm4', 'm5'].forEach(m => ok(LX.tfsQuiz.filter(q => q.module === m).length >= 3, 'checks in ' + m));
['predict', 'debug', 'short'].forEach(t => ok(LX.tfsQuiz.some(q => q.type === t), 'has ' + t + ' items'));
LX.tfsQuiz.forEach(q => { if (q.choices) { ok(q.why && q.whyNot.length === q.choices.length && q.whyNot.every((w, i) => i === q.a || w.length > 5), q.id + ' explains right and wrong choices'); } else ok(q.a && q.points.length, q.id + ' short answer'); ok(by('tfsLessons', q.lesson), q.id + ' lesson link'); });
ok(LX.tfsOral.length >= 12 && LX.tfsOral.every(o => o.strong.length >= 2 && o.weak.length >= 1), '12+ oral prompts with strong and weak answers');
ok(LX.quiz.filter(q => q.track === 'tfaws').length >= 15 && LX.drills.filter(q => q.track === 'tfaws').length >= 14, 'items reach the shared pools');

/* ── mocks ─────────────────────────────────────────────────────── */
const dims = Object.fromEntries(T.rubric.dims.map(d => [d.id, d]));
ok(T.rubric.dims.reduce((t, d) => t + d.pts, 0) === 100 && T.rubric.dims.every(d => d.auto + d.manual === d.pts), 'rubric is 100 points split into auto and manual');
ok(dims.verify.auto === 0 && dims.comm.auto === 0, 'verification and communication are never auto-scored');
LX.tfsMocks.forEach(M => {
  ok(M.mins === 45 && M.review === 10, M.id + ' 45 + 10');
  ok(M.followups.length === 6 && ['dependencies', 'failure isolation', 'security', 'state', 'verification', 'tradeoffs'].every(t => M.followups.some(f => f.topic === t)), M.id + ' six follow-ups on the required topics');
  ok(M.clarify.length >= 4 && M.extension.at === 25 && M.assumptions.length && /confirm actual interview rules/.test(M.allowed), M.id + ' clarifications, minute-25 extension, assumptions, docs label');
  ok(Object.keys(M.variants).length >= 2, M.id + ' two or more seeded variants');
  Object.keys(M.variants).forEach(v => {
    const V = M.variants[v], auto = V.auto();
    const byDim = {}; auto.forEach(x => { byDim[x.dim] = (byDim[x.dim] || 0) + x.pts; });
    const man = {}; M.manual.forEach(x => { man[x.dim] = (man[x.dim] || 0) + x.pts; });
    T.rubric.dims.forEach(d => { ok((byDim[d.id] || 0) === d.auto && (man[d.id] || 0) === d.manual, M.id + v + ' ' + d.id + ' auto ' + d.auto + ' manual ' + d.manual); });
    ok(G.grade(tf(V.solution), auto.map(x => x.check), { noRefs: true }).passed, M.id + v + ' reference earns every auto point');
    Object.keys(M.variants).filter(o => o !== v).forEach(o => ok(!G.grade(tf(M.variants[o].solution), auto.map(x => x.check), { noRefs: true }).passed, M.id + ': variant ' + o + ' answer does not satisfy ' + v + ' (variants differ materially)'));
  });
});
ok(LX.tfsRehearsal.parts.reduce((t, p) => t + p.mins, 0) === 60, 'rehearsal wrapper is 60 minutes, outside the core');
ok(LX.tfsReadiness.questions.length === 3 && LX.tfsReadiness.checklist.length >= 6 && /AI/.test(LX.tfsReadiness.checklist.join(' ')) && /NDA/.test(LX.tfsReadiness.checklist.join(' ')), 'readiness: three questions and the day-of checklist');

/* ── embedded files and honesty lint ───────────────────────────── */
const sync = spawnSync(process.execPath, [H.repoFile('tools/tfs-src.js'), '--check'], { encoding: 'utf8' });
ok(sync.status === 0, 'tfs-src.js matches the lab package: ' + sync.stderr);
const text = ['tfs-course', 'tfs-lessons', 'tfs-labs', 'tfs-debug', 'tfs-quiz', 'tfs-mocks', 'tfs-kit'].map(f => fs.readFileSync(H.repoFile('assets/js/data', f + '.js'), 'utf8')).concat(['tfs.js', 'tfs-sim.js'].map(f => fs.readFileSync(H.repoFile('assets/js', f), 'utf8'))).join('\n');
ok(!/\b(TBD|FIXME|lorem ipsum|coming soon)\b/i.test(text), 'no placeholder text');
ok(!/(guarantee[sd]? (success|a pass)|you will pass|pass probability|chance of passing)/i.test(text), 'no promises of success');
ok(!/free[- ]tier eligible/i.test(text.replace(/promise[^.]*free-tier eligibility/gi, '')), 'no free-tier promises');

/* ── simulated CLI ─────────────────────────────────────────────── */
function run(sim, files, cmd) { return S.run(sim, files, cmd); }
let sim = S.create(), f0 = tf('b0-local-manifest/reference');
let r = run(sim, f0, 'terraform plan');
ok(r.code === 1 && /\(simulated\)/.test(r.out) && /terraform init/.test(r.out), 'plan before init is refused, labelled simulated');
ok(run(sim, f0, 'terraform init').code === 0 && /built into Terraform/.test(run(S.create(), f0, 'terraform init').out), 'init explains the built-in provider');
r = run(sim, f0, 'terraform plan'); ok(/Plan: 1 to add, 0 to change, 0 to destroy/.test(r.out), 'plan lists one create');
r = run(sim, f0, 'terraform apply'); ok(/Enter a value/.test(r.out) && sim.pending, 'apply asks for confirmation');
r = run(sim, f0, 'no'); ok(/cancelled/.test(r.out) && !Object.keys(sim.state).length, 'anything but yes cancels');
run(sim, f0, 'terraform apply'); r = run(sim, f0, 'yes');
ok(/Apply complete! Resources: 1 added/.test(r.out) && /deployment_name = "ridgeline-dev"/.test(r.out), 'apply writes state and evaluates outputs');
ok(/No changes/.test(run(sim, f0, 'terraform plan').out), 'second plan has no changes');
ok(/1 to change/.test(run(sim, f0, 'terraform plan -var environment=prod').out), 'changed input → in-place update (as recorded with real Terraform)');
r = run(sim, f0, 'terraform plan -var environment=qa'); ok(r.code === 1 && /Invalid value for variable/.test(r.out), 'variable validation runs');
r = run(sim, f0, 'terraform plan -var colour=blue'); ok(r.code === 1 && /undeclared variable/.test(r.out), 'undeclared -var rejected');
const f1 = Object.assign({}, f0, { 'main.tf': f0['main.tf'].replace('input = {', 'triggers_replace = var.environment\n  input = {') });
ok(/must be replaced/.test(run(sim, f1, 'terraform plan -var environment=prod').out), 'triggers_replace change → replacement');
const f2 = Object.assign({}, f0, { 'outputs.tf': f0['outputs.tf'].replace('manifest.output.name', 'manifest.outputs.name') });
r = run(sim, f2, 'terraform validate'); ok(r.code === 1 && /Unsupported attribute/.test(r.out) && /Did you mean "output"/.test(r.out), 'attribute typo caught like Terraform');
const f3 = Object.assign({}, f0, { 'variables.tf': f0['variables.tf'].replace(/default\s*=\s*"ridgeline"\n/, '') });
r = run(S.create(), f3, 'terraform init'); r = run(Object.assign(S.create(), { initialized: true }), f3, 'terraform plan'); ok(r.code === 1 && /No value for required variable/.test(r.out), 'missing required variable');
ok(/Destroy complete! Resources: 1 destroyed/.test(run(sim, f0, 'terraform destroy -auto-approve').out) && !Object.keys(sim.state).length, 'destroy empties state');
/* AWS lab: honest notes, for_each addresses, removal, missing init after adding a provider */
sim = S.create(); const fa = tf('b5-iteration/foreach-reference');
run(sim, fa, 'terraform init'); r = run(sim, fa, 'terraform plan');
ok(/aws_subnet\.private\["a"\]/.test(r.out) && /aws_route_table_association\.private\["b"\]/.test(r.out) && /Nothing was sent to AWS/.test(r.out), 'for_each instances by key, AWS note present');
run(sim, fa, 'terraform apply -auto-approve');
const fb = Object.assign({}, fa, { 'variables.tf': fa['variables.tf'].replace(/\s+b = \{[^}]*\}/, '') });
r = run(sim, fb, 'terraform plan'); ok(/aws_subnet\.private\["b"\] will be destroyed/.test(r.out) && !/private\["a"\].*replaced/.test(r.out), 'removing one key destroys only that instance');
sim = S.create(); run(sim, f0, 'terraform init');
r = run(sim, tf('b1-private-s3/reference'), 'terraform plan'); ok(r.code === 1 && /init/.test(r.out), 'adding the AWS provider after init needs init again');
r = run(S.create(), {}, 'ls -la /'); ok(/only understands terraform/.test(run(S.create(), {}, 'rm -rf /').out), 'non-terraform commands are refused honestly');
ok(/not a Terraform binary/.test(run(S.create(), f0, 'terraform version').out), 'version says it is not Terraform');
ok(/does not run terraform fmt/.test(run(S.create(), f0, 'terraform fmt').out), 'fmt is not faked');

console.log(n + ' Terraform + AWS course checks passed · ' + LX.tfsLessons.length + ' lessons, ' + LX.tfsLabs.length + ' builds, ' + LX.tfsTickets.length + ' tickets, ' + LX.tfsQuiz.length + ' checks, ' + LX.tfsOral.length + ' oral prompts, ' + LX.tfsMocks.length + ' mocks');
