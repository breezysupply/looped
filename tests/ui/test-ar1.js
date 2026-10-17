const H = require('../helpers');
const { chromium } = require('playwright');

/* The Anduril Round 1 prep hub in a browser.

   At phone (390) and tablet (834) widths: every section and the main detail
   views render with content, fit without horizontal overflow, name every
   button and repeat no ids. At phone width, the flows the brief asks for:
   the landing page names the next action with its duration and reason; a
   lesson's recall attempt persists; a Terraform draft survives a reload and
   a hint rung is recorded; interview mode hides hints, solutions and
   structural feedback and its timer survives a reload; a mock interview
   hides help, keeps its draft and timer across a reload, is reviewed into a
   band, and a deliberate restart records a second attempt; a VPC scenario
   launched from the hub plays in the sandbox and records an attempt back in
   the hub; switching routes keeps progress; keyboard navigation works. */
(async () => {
  const b = await chromium.launch(H.launchOptions());
  let fails = 0, passes = 0;
  const ok = (c, m, d) => { if (c) passes++; else { fails++; console.log('FAIL ' + m + (d !== undefined ? '\n  ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };
  const store = p => p.evaluate(() => JSON.parse(localStorage.getItem('lx.anduril') || '{}'));
  const overflow = p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const body = p => p.$eval('#view-ar1 .prep-body', el => el.textContent);
  async function ready(p) { await p.waitForFunction(() => window.LX && LX.ar1 && LX.ar1Tf && window.LXAr1 && document.querySelector('#view-ar1 .prep-nav'), null, { timeout: 20000 }); }
  async function openTrack(p) { await p.click('#trackBtn'); await p.click('.track-row[data-track="anduril"]'); await ready(p); }
  const section = async (p, s) => { await p.click('#view-ar1 .prep-nav [data-ar1-section="' + s + '"]'); await p.waitForTimeout(50); };
  async function fits(p, W, what) {
    ok(await overflow(p) <= 0, W + ': ' + what + ' has no horizontal overflow', await overflow(p));
    const unnamed = await p.$$eval('#view-ar1 button', xs => xs.filter(x => !(x.textContent.trim() || x.getAttribute('aria-label'))).map(x => x.outerHTML.slice(0, 120)));
    ok(!unnamed.length, W + ': ' + what + ' buttons all have names', unnamed);
    const dup = await p.evaluate(() => { const seen = {}, d = []; document.querySelectorAll('[id]').forEach(e => { if (seen[e.id]) d.push(e.id); seen[e.id] = 1; }); return d; });
    ok(!dup.length, W + ': ' + what + ' has no duplicate ids', dup);
    const txt = await body(p);
    ok(txt.length > 150 && !/could not render/.test(txt), W + ': ' + what + ' renders content', txt.slice(0, 200));
  }
  const show = (p, d) => p.evaluate(d => LXAr1.open(d), d);

  for (const W of [390, 834]) {
    const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    p.on('dialog', d => d.accept());
    await p.goto(H.URL, { waitUntil: 'networkidle' });
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await openTrack(p);
    ok(await p.$eval('#view-ar1', el => el.classList.contains('active')), W + ': switching to the track lands on the Prep view');

    const sections = await p.$$eval('#view-ar1 .prep-nav [data-ar1-section]', xs => xs.map(x => x.dataset.ar1Section));
    ok(sections.length === 7, W + ': seven hub sections', sections);
    for (const s of sections) { await section(p, s); await fits(p, W, 'section ' + s); }
    const views = [
      { kind: 'lesson', id: 'ar1-b-01' }, { kind: 'lesson', id: 'ar1-a-06' }, { kind: 'diag' }, { kind: 'ex', id: 'X1' }, { kind: 'transfer' },
      { kind: 'scenario', id: 'N1' }, { kind: 'card', id: 'N5' }, { kind: 'card', id: 'N6' },
      { kind: 'tf', id: 'T1', mode: 'learn' }, { kind: 'tf', id: 'T2', mode: 'practice' }, { kind: 'tf', id: 'T3', mode: 'practice' }, { kind: 'tf', id: 'T4', mode: 'practice' },
      { kind: 'bash', id: 'B1' }, { kind: 'bash', id: 'B2' }, { kind: 'mock', id: 'MA' }, { kind: 'mock', id: 'MS' }, { kind: 'remediate' }
    ];
    for (const v of views) { await show(p, v); await fits(p, W, 'view ' + JSON.stringify(v)); }
    ok(!errs.length, W + ': no page errors while browsing', errs);
    if (W !== 390) { await ctx.close(); continue; }

    /* ── landing: next action with duration and why ── */
    await section(p, 'today');
    const today = await body(p);
    ok(/Next useful action/.test(today) && /Diagnostic/.test(today) && /min now/.test(today) && /Why it matters/.test(today), 'landing names the next action, its duration and why', today.slice(0, 400));
    ok(/not real Anduril questions/.test(today), 'landing labels the practice as invented');

    /* ── diagnostic with skips completes the first item ── */
    await p.click('#view-ar1 [data-ar1-item]');
    const dq = await p.evaluate(() => LX.ar1Diag.items.map(q => q.id));
    for (const [i, id] of dq.entries()) await p.click('[data-ar1-diag="' + id + ':' + (i % 3 === 0 ? 'skip' : '1') + '"]');
    await p.click('[data-ar1-diagsubmit]');
    const sd = await store(p);
    ok(sd.diag && sd.diag.completedAt && sd.diag.scores.net.skipped >= 1, 'diagnostic records per-domain scores with skips', sd.diag);

    /* ── lesson: recall attempt persists; opening alone is not completion ── */
    await show(p, { kind: 'lesson', id: 'ar1-a-01' });
    ok(!(await p.evaluate(() => LXAr1.itemDone({ kind: 'lesson', id: 'ar1-a-01' }))), 'opening a lesson does not complete it');
    await p.fill('[data-ar1-ltext="ar1-a-01:r0"]', 'source ip, source port, destination ip, destination port; client picks source port');
    await p.click('[data-ar1-recall="ar1-a-01:r0"]');
    ok(/Model answer/.test(await body(p)), 'model answer appears after an attempt');
    await p.reload({ waitUntil: 'networkidle' }); await ready(p);
    ok(await p.evaluate(() => LXAr1.itemDone({ kind: 'lesson', id: 'ar1-a-01' })), 'recall attempt survives a reload');

    /* ── Terraform practice: draft survives reload; hint rung recorded ── */
    await show(p, { kind: 'tf', id: 'T2', mode: 'practice', variant: 'a' });
    await p.fill('#ar1Editor', 'resource "aws_vpc" "main" {\n  cidr_block = "10.30.0.0/16"\n}\n');
    await p.waitForTimeout(400);
    await p.reload({ waitUntil: 'networkidle' }); await ready(p);
    await show(p, { kind: 'tf', id: 'T2', mode: 'practice', variant: 'a' });
    ok(/10\.30\.0\.0\/16/.test(await p.$eval('#ar1Editor', e => e.value)), 'Terraform draft survives a reload');
    await p.click('[data-ar1-tfcheck]');
    ok(/Structural checks/.test(await body(p)) && /no aws_subnet|aws_subnet/.test(await body(p)), 'structural checks run and are labelled');
    await p.click('[data-ar1-tfhint$="|1"]');
    ok(((await store(p)).hints['tf:T2:a:practice'] || []).indexOf(1) !== -1, 'hint rung 1 recorded');
    await p.click('[data-ar1-tfsubmit]');
    let att = Object.values((await store(p)).attempts).filter(a => a.activityId === 'T2');
    ok(att.length === 1 && att[0].assistance === 'hinted' && att[0].outcome === 'failed', 'practice attempt recorded as hinted and failed', att.map(a => [a.assistance, a.outcome]));

    /* ── Terraform interview mode: no help, timer survives reload ── */
    await show(p, { kind: 'tf', id: 'T2', mode: 'interview', variant: 'b' });
    await p.click('[data-ar1-tfstart]');
    ok(!(await p.$('[data-ar1-tfhint]')) && !(await p.$('[data-ar1-tfcheck]')), 'interview mode shows no hints and no structural checks');
    ok(!/Reference solution|Full worked solution/.test(await body(p)), 'interview mode shows no solution');
    ok(await p.$('#ar1Clock'), 'interview mode shows a timer');
    const t1 = await p.$eval('#ar1Clock', e => e.dataset.ar1Clock);
    await p.fill('#ar1Editor', 'resource "aws_vpc" "x" {\n  cidr_block = "172.20.0.0/16"\n}\n'); await p.waitForTimeout(400);
    await p.reload({ waitUntil: 'networkidle' }); await ready(p);
    await show(p, { kind: 'tf', id: 'T2', mode: 'interview', variant: 'b' });
    ok(await p.$eval('#ar1Clock', (e, t) => e.dataset.ar1Clock === t, t1), 'interview timer resumes from the original start after a reload');
    ok(/172\.20/.test(await p.$eval('#ar1Editor', e => e.value)), 'interview draft survives a reload');
    await p.click('[data-ar1-tfsubmit]');
    att = Object.values((await store(p)).attempts).filter(a => a.activityId === 'T2' && a.mode === 'interview');
    ok(att.length === 1 && att[0].variant === 'b' && att[0].assistance === 'independent', 'interview attempt recorded', att);
    ok(/Reference solution/.test(await body(p)), 'the solution is available after submission');

    /* ── mock interview ── */
    await show(p, { kind: 'mock', id: 'MA' });
    await p.check('#ar1Attest');
    await p.click('[data-ar1-mockstart]');
    ok(/Mock mode/.test(await body(p)) && await p.$('#ar1Clock'), 'mock starts with a timer and mock-mode notice');
    await p.click('[data-ar1-mockphase="1"]');
    ok(!(await p.$('[data-ar1-tfhint]')) && !(await p.$('[data-ar1-tfcheck]')) && !/Reference solution|A strong answer/.test(await body(p)), 'mock hides hints, checks and answers');
    const ma = await p.evaluate(() => LX.ar1TfSrc['MA/reference']);
    for (const f of ['main.tf', 'variables.tf', 'outputs.tf']) {
      await p.click('[data-ar1-file$="|' + f + '"]');
      await p.fill('#ar1Editor', ma[f]); await p.waitForTimeout(350);
    }
    const mStart = await p.$eval('#ar1Clock', e => e.dataset.ar1Clock);
    await p.reload({ waitUntil: 'networkidle' }); await ready(p);
    await show(p, { kind: 'mock', id: 'MA' });
    ok(await p.$eval('#ar1Clock', (e, t) => e.dataset.ar1Clock === t, mStart), 'mock timer resumes after a reload');
    ok(/aws_vpc/.test(await p.$eval('#ar1Editor', e => e.value)), 'mock draft and phase survive a reload');
    await p.click('[data-ar1-mockphase="2"]');
    await p.fill('[data-ar1-mocktext$=":net:0"]', 'Check public IP, route table association, SG, NACL both ways with ephemeral ports, flow logs, then ss -ltn.');
    await p.click('[data-ar1-mocksubmit]');
    let mk = Object.values((await store(p)).attempts).filter(a => a.kind === 'mock');
    ok(mk.length === 1 && mk[0].status === 'submitted' && mk[0].tfGrade && mk[0].tfGrade.passed, 'mock submitted and the Terraform phase graded', mk.map(a => [a.status, a.tfGrade && a.tfGrade.passed]));
    ok(/A strong answer/.test(await body(p)) && /Structural checks/.test(await body(p)), 'review shows model answers and structural checks');
    for (const d of ['net', 'tf', 'verify', 'comm', 'clarify']) await p.click('[data-ar1-mockrate$=":' + d + ':4"]');
    await p.click('[data-ar1-mockreview]');
    mk = Object.values((await store(p)).attempts).filter(a => a.kind === 'mock');
    ok(mk[0].review.band === 'independent' && mk[0].review.pct === 100, 'review computes the weighted score and band', mk[0].review);
    ok(!/probab/i.test(await body(p)), 'no pass probability shown');
    await p.click('[data-ar1-mockrestart]');
    await p.click('[data-ar1-mockstart]');
    mk = Object.values((await store(p)).attempts).filter(a => a.kind === 'mock');
    ok(mk.length === 2 && mk.filter(a => a.status === 'running').length === 1, 'deliberate restart records a new attempt and keeps the old one');
    await p.click('[data-ar1-mockabandon]');

    /* ── a VPC scenario from the hub, played in the sandbox ── */
    await show(p, { kind: 'scenario', id: 'N1' });
    await p.click('[data-ar1-scen="N1:independent"]');
    await p.waitForSelector('#sbRun:not([hidden])');
    for (let i = 0; i < 12; i++) {
      const next = await p.evaluate(() => { const r = LXSandbox.current(); if (!r) return null; const o = r.mission.objectives.find(x => !r.met[x.id]); if (!o) return null; const c = { w: r.w, ran: r.ran, out: r.out, code: r.code, last: r.last }; return typeof o.reveal === 'function' ? o.reveal(c) : o.reveal; });
      if (!next) break;
      await p.fill('#sbInput', next); await p.press('#sbInput', 'Enter'); await p.waitForTimeout(40);
    }
    await p.waitForTimeout(1500);
    const sa = Object.values((await store(p)).attempts).filter(a => a.activityId === 'N1');
    ok(sa.length === 1 && sa[0].outcome === 'passed' && sa[0].simulated, 'scenario attempt recorded in the AR1 hub', sa.map(a => [a.outcome, a.assistance, a.seed]));
    ok(await p.$('#sbDebrief [data-ar1-sdsave]'), 'sandbox debrief comes from the AR1 hub');
    await p.fill('#ar1sdhyp', 'The security group no longer matches the office egress address.');
    await p.click('#sbDebrief [data-ar1-sdsave]');
    ok(Object.keys((await store(p)).debriefs).length === 1, 'scenario write-up saved');
    await p.click('#sbDebrief [data-ar1-home]');
    await ready(p);

    /* ── routes keep progress; target date persists ── */
    await section(p, 'today');
    await p.click('[data-ar1-route="triage"]');
    ok(/Triage block/.test(await body(p)), 'triage route drives the next action');
    ok(await p.evaluate(() => LXAr1.itemDone({ kind: 'diag' })), 'progress carries across routes');
    await p.click('[data-ar1-route="core"]');
    await p.fill('#ar1Target', '2026-10-23'); await p.dispatchEvent('#ar1Target', 'change');
    ok((await store(p)).ui.target === '2026-10-23', 'target date is editable and saved');

    /* ── keyboard ── */
    await p.focus('#view-ar1 [data-ar1-section="review"]');
    await p.keyboard.press('Enter');
    ok(await p.$eval('#view-ar1 [data-ar1-section="review"]', e => e.getAttribute('aria-pressed') === 'true'), 'sections switch from the keyboard');
    await show(p, { kind: 'lesson', id: 'ar1-a-02' });
    await p.focus('#view-ar1 .prep-back');
    await p.keyboard.press('Escape');
    ok(!(await p.evaluate(() => LXAr1._ui.detail)), 'Escape leaves a detail view');

    ok(!errs.length, 'no page errors during the flows', errs);
    await ctx.close();
  }
  await b.close();
  console.log(passes + ' passed, ' + fails + ' problems');
  process.exit(fails ? 1 : 0);
})();
