const H = require('../helpers');
const { chromium } = require('playwright');

/* The Terraform + AWS tech-screen course (track tfaws) in a browser.

   At 390 and 1100 px: every section and the main detail views render with
   content, without horizontal overflow, named buttons or repeated ids. At
   phone width, the behaviours the course promises: enrollment and resume;
   guided, scaffolded and blank starters really differ; an edit survives a
   reload; a hint or the solution marks an attempt assisted; starting a new
   attempt keeps the old one in history; interview mode hides hints, checks,
   the solution and the simulator until submit; pausing a timed attempt
   makes it untimed practice and the timer reconciles across a reload; the
   simulated terminal labels itself and refuses plan before init; mock
   mode hides help, the mock score stays incomplete while manual items are
   unassessed and becomes a total only when all are assessed; renamed but
   equivalent HCL passes the practice checks; keyboard navigation works. */
(async () => {
  const b = await chromium.launch(H.launchOptions());
  let fails = 0, passes = 0;
  const ok = (c, m, d) => { if (c) passes++; else { fails++; console.log('FAIL ' + m + (d !== undefined ? '\n  ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };
  const store = p => p.evaluate(() => JSON.parse(localStorage.getItem('lx.tfaws') || '{}'));
  const overflow = p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const body = p => p.$eval('#view-tfs .prep-body', e => e.textContent);
  const ready = p => p.waitForFunction(() => window.LX && LX.tfsLabs && window.LXTfs && document.querySelector('#view-tfs .prep-nav'), null, { timeout: 20000 });
  const open = (p, d) => p.evaluate(d => LXTfs.open(d), d);
  const attempts = async (p, f) => Object.values((await store(p)).attempts || {}).filter(f);
  async function fits(p, W, what) {
    ok(await overflow(p) <= 0, W + ': ' + what + ' fits', await overflow(p));
    const unnamed = await p.$$eval('#view-tfs button', xs => xs.filter(x => !(x.textContent.trim() || x.getAttribute('aria-label'))).map(x => x.outerHTML.slice(0, 100)));
    ok(!unnamed.length, W + ': ' + what + ' buttons named', unnamed);
    const dup = await p.evaluate(() => { const s = {}, d = []; document.querySelectorAll('[id]').forEach(e => { if (s[e.id]) d.push(e.id); s[e.id] = 1; }); return d; });
    ok(!dup.length, W + ': ' + what + ' unique ids', dup);
    const t = await body(p);
    ok(t.length > 150 && !/could not render/.test(t), W + ': ' + what + ' renders', t.slice(0, 160));
  }
  async function type(p, text) { await p.fill('#tfsEditor', text); await p.waitForTimeout(350); }

  for (const W of [390, 1100]) {
    const ctx = await b.newContext({ viewport: { width: W, height: 950 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    p.on('dialog', d => d.accept());
    await p.goto(H.URL, { waitUntil: 'networkidle' });
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.click('#trackBtn');
    ok(await p.$('.track-row[data-track="tfaws"]'), W + ': the course appears in the catalog');
    await p.click('.track-row[data-track="tfaws"]');
    await ready(p);
    ok(await p.$eval('#view-tfs', e => e.classList.contains('active')), W + ': the course opens on its own view');
    for (const s of ['overview', 'modules', 'schedule', 'mocks', 'review', 'ready', 'about']) { await p.click('[data-tfs-section="' + s + '"]'); await fits(p, W, 'section ' + s); }
    for (const v of [{ kind: 'lesson', id: 'l3c' }, { kind: 'diag' }, { kind: 'quiz', id: 'm3', m: 'm3' }, { kind: 'oral', id: 'm4', m: 'm4' }, { kind: 'lab', id: 'b2', level: 'guided' }, { kind: 'lab', id: 'b3', level: 'interview' }, { kind: 'faults', id: 'b3', m: 'm4' }, { kind: 'tickets', id: 'more', m: 'm5' }, { kind: 'plan', id: 'plan1', m: 'm5' }, { kind: 'mock', id: 'B' }, { kind: 'rehearsal' }]) {
      await open(p, v); await fits(p, W, 'view ' + JSON.stringify(v));
    }
    ok(!errs.length, W + ': no page errors while browsing', errs);
    if (W !== 390) { await ctx.close(); continue; }

    /* ── enrollment and the next action ── */
    await p.click('[data-tfs-section="overview"]');
    await p.click('[data-tfs-enroll]');
    ok((await store(p)).enrolledAt, 'enrollment is recorded');
    ok(/How this course works/.test(await body(p)), 'next action is the first lesson');
    ok(/7 h 15 min/.test(await body(p)) && /5 h 5 min/.test(await body(p)), 'both paths offered');
    const mins = await p.evaluate(() => [LXTfs.pathMins('full'), LXTfs.pathMins('minimum')]);
    ok(mins[0] === 435 && mins[1] === 305, 'path totals 435 and 305', mins);

    /* ── levels really differ ── */
    const starts = {};
    for (const lv of ['guided', 'scaffolded', 'requirements']) { await open(p, { kind: 'lab', id: 'b2', level: lv }); starts[lv] = await p.evaluate(() => Object.values(LXTfs.state().attempts).filter(a => a.labId === 'b2' && a.level === document.querySelector('[data-tfs-level][aria-pressed="true"]').dataset.tfsLevel).pop().files['main.tf']); }
    ok(starts.guided.length > starts.scaffolded.length && starts.scaffolded.length > 200 && starts.requirements === '', 'guided > scaffolded > blank starting files', Object.fromEntries(Object.entries(starts).map(([k, v]) => [k, v.length])));
    ok(/TODO/.test(starts.scaffolded) && /aws_vpc/.test(starts.guided), 'scaffold has TODO blocks; guided has written code');

    /* ── Build 0: edits persist, simulator is labelled and stateful ── */
    await open(p, { kind: 'lab', id: 'b0', level: 'requirements' });
    const ref0 = await p.evaluate(() => LX.tfsSrc['b0-local-manifest/reference']);
    await p.click('[data-tfs-file$="|main.tf"]'); await type(p, ref0['main.tf'].replace(/manifest/g, 'record'));
    await p.click('[data-tfs-file$="|variables.tf"]'); await type(p, ref0['variables.tf']);
    await p.click('[data-tfs-file$="|outputs.tf"]'); await type(p, ref0['outputs.tf'].replace(/manifest/g, 'record'));
    await p.reload({ waitUntil: 'networkidle' }); await ready(p);
    await open(p, { kind: 'lab', id: 'b0', level: 'requirements' });
    await p.click('[data-tfs-file$="|outputs.tf"]');
    ok(/terraform_data\.record\.output/.test(await p.$eval('#tfsEditor', e => e.value)), 'workspace edits survive a reload');
    await p.fill('#tfsSimIn', 'terraform plan'); await p.press('#tfsSimIn', 'Enter');
    ok(/\(simulated\)/.test(await p.$eval('#tfsTerm', e => e.textContent)) && /terraform init/.test(await p.$eval('#tfsTerm', e => e.textContent)), 'simulator labels output and refuses plan before init');
    for (const c of ['terraform init', 'terraform plan']) { await p.fill('#tfsSimIn', c); await p.press('#tfsSimIn', 'Enter'); }
    ok(/1 to add/.test(await p.$eval('#tfsTerm', e => e.textContent)), 'simulated plan follows the files (1 to add)');
    await p.fill('#tfsSimIn', 'terraform apply -auto-approve'); await p.press('#tfsSimIn', 'Enter');
    await p.fill('#tfsSimIn', 'terraform plan -var environment=prod'); await p.press('#tfsSimIn', 'Enter');
    ok(/1 to change/.test(await p.$eval('#tfsTerm', e => e.textContent)), 'changing an input shows an in-place update');
    await p.click('[data-tfs-labcheck]');
    ok(/all required practice checks pass/.test(await body(p)), 'renamed but equivalent HCL passes the practice checks');
    await p.click('[data-tfs-labsubmit]');
    let att = await attempts(p, a => a.labId === 'b0' && a.level === 'requirements');
    ok(att.length === 1 && att[0].submittedAt && att[0].grade.passed && (await p.evaluate(a => LXTfs.classify(a), att[0])) === 'independent', 'unassisted requirements-level submit is independent');

    /* ── hints/solution mark assisted; new attempt keeps history ── */
    await open(p, { kind: 'lab', id: 'b1', level: 'requirements' });
    await type(p, 'resource "aws_s3_bucket" "x" {\n  bucket = "edited-before-reset"\n}\n');
    await p.click('[data-tfs-labhint$=":1"]');
    await p.click('[data-tfs-labsol]');
    ok(/Your files beside the reference/.test(await body(p)), 'solution shows side by side');
    await p.click('[data-tfs-labreset]');
    att = await attempts(p, a => a.labId === 'b1');
    ok(att.length === 2 && att.some(a => a.abandoned && a.files['main.tf'].indexOf('edited-before-reset') !== -1 && a.solutionViewed && a.hints.length === 1), 'reset starts a new attempt and keeps the old one with its edits and assistance', att.map(a => [a.abandoned, a.hints, a.solutionViewed]));
    const fresh = att.find(a => !a.abandoned);
    ok(fresh && fresh.files['main.tf'] === '' && !fresh.hints.length, 'the new attempt starts clean');

    /* ── interview mode hides help; pause → untimed; timer reconciles ── */
    await open(p, { kind: 'lab', id: 'b3', level: 'interview' });
    ok(!(await p.$('[data-tfs-labhint]')) && !(await p.$('[data-tfs-labcheck]')) && !(await p.$('[data-tfs-labsol]')) && !(await p.$('#tfsSimIn')), 'interview hides hints, checks, solution and simulator');
    ok(await p.$('#tfsClock'), 'interview shows a timer');
    const a3 = (await attempts(p, a => a.labId === 'b3' && a.level === 'interview'))[0];
    await p.waitForTimeout(1500);
    await p.reload({ waitUntil: 'networkidle' }); await ready(p);
    const sec = await p.evaluate(id => LXTfs.activeSec(LXTfs.state().attempts[id]), a3.id);
    ok(sec >= 1.2, 'timer keeps running across a reload', sec);
    await open(p, { kind: 'lab', id: 'b3', level: 'interview' });
    await p.click('[data-tfs-pause]');
    const pausedAt = await p.evaluate(id => LXTfs.activeSec(LXTfs.state().attempts[id]), a3.id);
    await p.waitForTimeout(1200);
    ok(Math.abs((await p.evaluate(id => LXTfs.activeSec(LXTfs.state().attempts[id]), a3.id)) - pausedAt) < 0.05, 'paused time does not count');
    await p.click('[data-tfs-resumet]');
    await type(p, 'resource "aws_vpc" "main" {\n  cidr_block = "10.50.0.0/16"\n}\n');
    await p.click('[data-tfs-labsubmit]');
    const a3s = (await attempts(p, a => a.id === a3.id))[0];
    ok((await p.evaluate(a => LXTfs.classify(a), a3s)) === 'untimed practice', 'a paused timed attempt is untimed practice');
    ok(/practice checks/.test(await body(p)) && /Your files beside the reference/.test(await body(p)), 'checks and solution appear after submit');

    /* ── mock: help hidden; score incomplete until manual items assessed ── */
    await open(p, { kind: 'mock', id: 'A' });
    await p.click('[data-tfs-mockstart]');
    ok(!(await p.$('[data-tfs-labhint]')) && !(await p.$('#tfsSimIn')) && !/Reference implementation/.test(await body(p)), 'mock mode hides hints, simulator and reference');
    await p.click('[data-tfs-ask]');
    ok(/Your choice|HTTP is fine|No administrative|No\. Talk|Any current|instance ID/.test(await body(p)), 'clarification answer revealed on request');
    const ma = (await attempts(p, a => a.kind === 'mock'))[0];
    const ref = await p.evaluate(v => LX.tfsSrc[LX.tfsMocks[0].variants[v].solution], ma.variant);
    for (const f of ['main.tf', 'variables.tf', 'outputs.tf']) { await p.click('[data-tfs-file$="|' + f + '"]'); await type(p, ref[f]); }
    await p.reload({ waitUntil: 'networkidle' }); await ready(p);
    await open(p, { kind: 'mock', id: 'A' });
    ok(/aws_vpc/.test(await p.$eval('#tfsEditor', e => e.value)), 'mock draft survives a reload');
    await p.click('[data-tfs-mocksubmit]');
    let sm = (await attempts(p, a => a.id === ma.id))[0];
    ok(sm.score && !sm.score.complete && sm.score.total === null && sm.score.autoEarned === 53, 'score incomplete with 53 auto points while manual items are unassessed', sm.score);
    ok(/Not complete/.test(await body(p)), 'review says the score is not complete');
    const ids = await p.$$eval('[data-tfs-manual$=":full"]', xs => xs.map(x => x.dataset.tfsManual));
    for (const id of ids) await p.click('[data-tfs-manual="' + id + '"]');
    sm = (await attempts(p, a => a.id === ma.id))[0];
    ok(sm.score.complete && sm.score.total === 100 && sm.score.coreOk, 'all assessed: total 100 with the core satisfied', sm.score);
    ok(/not an employer passing score/.test(await body(p)), 'score is labelled as practice');
    await p.click('[data-tfs-mockreviewed]');
    ok((await attempts(p, a => a.id === ma.id))[0].reviewedAt, 'mock review saved');
    const R = await p.evaluate(() => LXTfs.readiness());
    ok(R.count === 1, 'one qualifying mock counted, not two', R);
    await p.click('[data-tfs-section="mocks"]');
    ok(/one independent mock completed/.test(await body(p)), 'mocks page reports one independent mock, not readiness');

    /* ── mistakes and review queue from a missed check ── */
    await open(p, { kind: 'quiz', id: 'm4', m: 'm4' });
    await p.click('[data-tfs-q="q4-1:0"]');
    await p.click('[data-tfs-section="review"]');
    ok(/Start the review/.test(await body(p)) && /Mistake log/.test(await body(p)), 'a miss lands in the mistake log and the review queue');

    /* ── keyboard ── */
    await p.focus('[data-tfs-section="schedule"]'); await p.keyboard.press('Enter');
    ok(await p.$eval('[data-tfs-section="schedule"]', e => e.getAttribute('aria-pressed') === 'true'), 'sections switch from the keyboard');
    await open(p, { kind: 'lesson', id: 'l2' }); await p.focus('#view-tfs .prep-back'); await p.keyboard.press('Escape');
    ok(!(await p.evaluate(() => LXTfs._ui.detail)), 'Escape leaves a detail view');
    ok(!errs.length, 'no page errors during the flows', errs);
    await ctx.close();
  }
  await b.close();
  console.log(passes + ' passed, ' + fails + ' problems');
  process.exit(fails ? 1 : 0);
})();
