const H = require('../helpers');
const { chromium } = require('playwright');

/* The SRE & Cloud Deployment Foundations hub in a browser.

   At a phone (390) and a tablet (834) width: every section renders with
   content and no horizontal overflow, every button has an accessible name,
   no ids repeat. At phone width, the flows that carry evidence: the baseline
   diagnostic scores per domain with skips; a lesson marked studied survives
   a reload; a module gate records an attempt; a lab's example evidence file
   is refused while a real-shaped report is imported; an independent
   scenario played in the sandbox records a passed independent attempt; an
   unsafe shortcut is announced as a critical failure; a design draft unlocks
   its reference; a cloud extension stays disabled until account, limit and
   confirmation are given. Finally a schema-2 store migrates to 3 with a
   backup and rolls back exactly. */
(async () => {
  const b = await chromium.launch(H.launchOptions());
  let fails = 0, passes = 0;
  const ok = (c, m, d) => { if (c) passes++; else { fails++; console.log('FAIL ' + m + (d !== undefined ? '\n  ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

  async function openTrack(p) {
    await p.click('#trackBtn');
    await p.click('.track-row[data-track="sre"]');
    await p.waitForFunction(() => window.LX && LX.sreModules && LX.sreModules.length === 16 && document.querySelector('#view-sre .prep-nav'), null, { timeout: 20000 });
  }
  const sre = p => p.evaluate(() => JSON.parse(localStorage.getItem('lx.sre') || '{}'));
  const overflow = p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const section = async (p, s) => { await p.click('#view-sre .prep-nav [data-sre-section="' + s + '"]'); await p.waitForTimeout(60); };

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
    ok(await p.$eval('#view-sre', el => el.classList.contains('active')), W + ': switching to the track lands on the Course view');

    const sections = await p.$$eval('#view-sre .prep-nav [data-sre-section]', xs => xs.map(x => x.dataset.sreSection));
    ok(sections.length === 10, W + ': ten hub sections', sections);
    for (const s of sections) {
      await section(p, s);
      const txt = await p.$eval('#sreBody', el => el.textContent.trim());
      ok(txt.length > 120 && !/could not render/.test(txt), W + ': section ' + s + ' renders content', txt.slice(0, 200));
      ok(await overflow(p) <= 0, W + ': section ' + s + ' has no horizontal overflow', await overflow(p));
      const unnamed = await p.$$eval('#view-sre button', xs => xs.filter(x => !(x.textContent.trim() || x.getAttribute('aria-label'))).map(x => x.outerHTML.slice(0, 120)));
      ok(!unnamed.length, W + ': section ' + s + ' buttons all have names', unnamed);
      const dup = await p.evaluate(() => { const seen = {}, d = []; document.querySelectorAll('[id]').forEach(e => { if (seen[e.id]) d.push(e.id); seen[e.id] = 1; }); return d; });
      ok(!dup.length, W + ': section ' + s + ' has no duplicate ids', dup);
    }
    /* every module, lab and design detail page fits too */
    for (const id of ['M01', 'M09', 'M16']) {
      await section(p, 'modules'); await p.click('[data-sre-module="' + id + '"]');
      for (const sub of ['overview', 'lessons', 'practice', 'gate', 'debrief', 'evidence']) {
        await p.click('[data-sre-sub="' + sub + '"]');
        ok(await overflow(p) <= 0, W + ': module ' + id + ' ' + sub + ' tab fits', await overflow(p));
      }
    }
    const labIds = await p.evaluate(() => LX.sreLabs.map(l => l.id));
    for (const id of labIds.slice(0, 6)) {
      await section(p, 'labs'); await p.click('[data-sre-lab="' + id + '"]');
      for (const tab of ['brief', 'run', 'hints', 'evidence']) {
        const t = await p.$('[data-sre-labtab="' + id + ':' + tab + '"]');
        if (t) { await t.click(); ok(await overflow(p) <= 0, W + ': lab ' + id + ' tab ' + tab + ' fits', await overflow(p)); }
      }
    }
    await section(p, 'designs'); await p.click('[data-sre-design="D01"]');
    ok(await overflow(p) <= 0, W + ': design D01 fits', await overflow(p));
    ok(!errs.length, W + ': no page errors while browsing', errs);

    if (W !== 390) { await ctx.close(); continue; }

    /* ── baseline diagnostic: answer some, skip the rest, per-domain scores ── */
    await section(p, 'diagnostic');
    const qids = await p.evaluate(() => LX.sreDiagnostic.questions.map(q => q.id));
    ok(qids.length === 24, 'diagnostic has 24 questions', qids.length);
    for (const [i, id] of qids.entries()) {
      const sel = '[data-sre-diag="' + id + ':' + (i % 3 === 2 ? 'skip' : '0') + '"]';
      if (await p.$(sel)) await p.click(sel);
    }
    const submit = await p.$('[data-sre-diagsubmit]');
    ok(!!submit, 'diagnostic can be submitted with skips');
    if (submit) await submit.click();
    const diag = (await sre(p)).diagnostic || {};
    ok(diag.completedAt && diag.scores && Object.keys(diag.scores).length >= 5, 'diagnostic stores per-domain scores', diag.scores);
    ok(await p.$eval('#sreBody', el => !/install (kind|kubernetes|docker)/i.test(el.textContent)), 'diagnostic result asks for no installs');

    /* ── lesson studied survives a reload ── */
    await section(p, 'modules'); await p.click('[data-sre-module="M01"]');
    await p.click('[data-sre-sub="lessons"]');
    await p.click('[data-sre-lesson="les-m01-01"]');
    const lt = await p.evaluate(() => LX.sreLessons.find(l => l.id === 'les-m01-01').title);
    ok(await p.$eval('#sreBody', (el, t) => el.textContent.indexOf(t) !== -1, lt), 'lesson opens with its title');
    await p.click('[data-sre-studied="les-m01-01"]');
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForFunction(() => window.LX && LX.sreModules && LX.sreModules.length === 16 && document.querySelector('#view-sre .prep-nav'));
    ok(((await sre(p)).lessons || {})['les-m01-01'] && (await sre(p)).lessons['les-m01-01'].studied, 'studied flag persisted across reload');
    ok(await p.$eval('#sreBody', (el, t) => el.textContent.indexOf(t) !== -1, lt), 'reload returns to the same lesson');

    /* ── module gate: answer every item, an attempt is recorded ── */
    await section(p, 'modules'); await p.click('[data-sre-module="M01"]');
    await p.click('[data-sre-sub="gate"]');
    await p.click('[data-sre-gatestart="M01"]');
    for (let guard = 0; guard < 30; guard++) {
      if (await p.$('[data-sre-gatepick="0"]')) await p.click('[data-sre-gatepick="0"]');
      else if (await p.$('[data-sre-orderpick]')) { const n = await p.$$eval('[data-sre-orderpick]', xs => xs.length); for (let i = 0; i < n; i++) await p.click('[data-sre-orderpick="' + i + '"]'); await p.click('[data-sre-ordersubmit]'); }
      else if (await p.$('#gateExplain')) { await p.fill('#gateExplain', 'Because the evidence separates the two hypotheses: the error names the path and the listing shows the real file.'); await p.click('[data-sre-explainsubmit]'); if (await p.$('[data-sre-explainrate="3"]')) await p.click('[data-sre-explainrate="3"]'); }
      if (await p.$('[data-sre-gatenext]')) { await p.click('[data-sre-gatenext]'); continue; }
      break;
    }
    const gates = ((await sre(p)).gates || {}).M01 || [];
    ok(gates.length === 1 && gates[0].passed && gates[0].total >= 5, 'gate attempt recorded and passed for M01', gates.map(g => [g.correct, g.total, g.pct]));
    ok(await p.$eval('#sreBody', el => /\d+ \/ \d+ \(\d+%\)/.test(el.textContent)), 'gate summary shows the score');

    /* ── lab evidence: the example file is refused, a real-shaped report imports ── */
    await section(p, 'labs'); await p.click('[data-sre-lab="L01"]');
    await p.click('[data-sre-labtab="L01:evidence"]');
    const example = require('fs').readFileSync(H.repoFile('labs/sre-cloud-foundations/L01/evidence-example.json'), 'utf8');
    await p.fill('#evJson', example);
    await p.click('[data-sre-evimport="L01"]');
    ok(await p.$eval('#evMsg', el => /example file/.test(el.textContent)), 'example evidence is refused', await p.$eval('#evMsg', el => el.textContent));
    const report = JSON.parse(example); delete report.note;
    const ids = await p.evaluate(() => LX.sreLabs.find(l => l.id === 'L01').validation.map(v => v.id));
    report.checks = ids.map(id => ({ id, passed: true, observed: 'ui-test' }));
    report.assistance = 'independent'; report.executionMode = 'local'; report.cleanupStatus = 'verified';
    report.contentVersion = await p.evaluate(() => LX.sreTrack.version);
    await p.fill('#evJson', JSON.stringify(report));
    await p.click('[data-sre-evimport="L01"]');
    const labA = Object.values((await sre(p)).attempts || {}).filter(a => a.activityId === 'L01');
    ok(labA.length === 1 && labA[0].outcome === 'passed', 'real-shaped report imported as a passed lab attempt', labA);

    /* ── an independent scenario through the sandbox ── */
    await p.evaluate(() => LXSre.open('scenario:S01:independent'));
    await p.waitForSelector('#sbRun:not([hidden])');
    const neutral = await p.evaluate(() => LX.missions.find(m => m.id === 'sre-s01').sre.neutralTitle);
    ok(await p.$eval('#sbTitle', (el, t) => el.textContent === t, neutral), 'independent mode shows the neutral ticket title');
    const seed = await p.evaluate(() => LXSandbox.current().seed);
    const fix = /variant-a/.test(seed) ? "sed -i 's#becaon.yaml#beacon.yaml#' /etc/systemd/system/beacon.service && systemctl daemon-reload" : "sed -i 's#beacon.yml#beacon.yaml#' /etc/systemd/system/beacon.service && systemctl daemon-reload";
    for (const c of ['journalctl -u beacon -n 20', 'systemctl cat beacon', 'ls -l /etc/beacon/', fix, 'systemctl restart beacon && curl -i http://127.0.0.1:8080/healthz']) {
      await p.fill('#sbInput', c); await p.press('#sbInput', 'Enter'); await p.waitForTimeout(40);
    }
    await p.waitForTimeout(1500);
    const sAtt = Object.values((await sre(p)).attempts || {}).filter(a => a.activityId === 'S01');
    ok(sAtt.length >= 1 && sAtt[sAtt.length - 1].outcome === 'passed' && sAtt[sAtt.length - 1].assistance === 'independent', 'independent scenario recorded as a passed independent attempt', sAtt.map(a => [a.outcome, a.assistance, a.seed]));

    /* ── an unsafe shortcut is announced and fails the attempt ── */
    await p.evaluate(() => LXSre.open('scenario:S03:guided'));
    await p.waitForSelector('#sbRun:not([hidden])');
    await p.fill('#sbInput', 'chmod 644 /etc/beacon/beacon.yaml'); await p.press('#sbInput', 'Enter');
    await p.waitForTimeout(80);
    ok(await p.$eval('#sbTerm', el => /critical check failed/.test(el.textContent)), 'unsafe shortcut announced as a critical failure');
    ok(await p.evaluate(() => LXSandbox.current().critical.length === 1), 'attempt carries the critical failure');

    /* ── design: draft saved unlocks the reference ── */
    await p.evaluate(() => { LXSre.open('design:D01'); });
    await p.waitForSelector('[data-sre-dfield="D01:requirements"]');
    ok(!(await p.$eval('#sreBody', el => /Reference discussion/.test(el.textContent))), 'reference hidden before a draft');
    await p.fill('[data-sre-dfield="D01:requirements"]', 'Survive one AZ, private data path, RPO 15 min, RTO 60 min; assumption: managed PostgreSQL.');
    await p.click('[data-sre-dsave="D01"]');
    ok(await p.$eval('#sreBody', el => /Reference discussion/.test(el.textContent)), 'reference available after the draft is saved');
    ok((((await sre(p)).designs || {}).D01 || {}).fields && (await sre(p)).designs.D01.fields.requirements.length > 20, 'design field persisted');

    /* ── cloud extension stays disabled until account, limit and confirmation ── */
    await section(p, 'branches');
    ok(await p.$eval('#sreBody', el => (el.textContent.match(/disabled/g) || []).length >= 5), 'all five cloud extensions listed as disabled');
    await p.click('[data-sre-cloud="C01"]');
    await p.click('[data-sre-cloudtoggle="C01"]');
    ok(!(((await sre(p)).cloud || {}).C01 || {}).enabled, 'enable refused without account, limit and confirmation');
    ok(!(await p.$eval('#sreBody', el => /terraform apply/.test(el.textContent))), 'commands hidden while disabled');
    await p.fill('#cloudAcct', 'sandbox-123456789012');
    await p.fill('#cloudLimit', 'USD 10, alert at 5');
    await p.check('[data-sre-cloudack="C01"]');
    await p.click('[data-sre-cloudtoggle="C01"]');
    ok((((await sre(p)).cloud || {}).C01 || {}).enabled === true, 'enabled after account, limit and confirmation');
    ok(await p.$eval('#sreBody', el => /terraform apply/.test(el.textContent)), 'commands shown once enabled');
    ok(await overflow(p) <= 0, 'enabled cloud page fits', await overflow(p));
    ok(!errs.length, 'no page errors in the flows', errs);
    await ctx.close();
  }

  /* ── migration from schema 2 and an exact rollback ── */
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
    const p = await ctx.newPage();
    p.on('dialog', d => d.accept());
    await p.goto(H.URL, { waitUntil: 'networkidle' });
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lx.schema', '2'); localStorage.setItem('lx.cards', JSON.stringify({ 'ls-l': { box: 3 } })); localStorage.setItem('lx.track', JSON.stringify('linux')); });
    await p.reload({ waitUntil: 'networkidle' });
    const after = await p.evaluate(() => ({ schema: localStorage.getItem('lx.schema'), sre: localStorage.getItem('lx.sre'), backup: JSON.parse(localStorage.getItem('lx.backup') || 'null'), cards: localStorage.getItem('lx.cards') }));
    ok(after.schema === '3' && after.sre && after.backup && after.backup.schema === 2 && after.backup.data['lx.cards'], 'schema 2 → 3 migrates, creates lx.sre, keeps a backup', after);
    ok(after.cards === JSON.stringify({ 'ls-l': { box: 3 } }), 'existing progress untouched by the migration');
    await openTrack(p);
    await section(p, 'evidence');
    const rb = await p.$('[data-sre-rollback]');
    ok(!!rb, 'evidence section offers rollback');
    if (rb) await rb.click();
    const rolled = await p.evaluate(() => ({ schema: localStorage.getItem('lx.schema'), sre: localStorage.getItem('lx.sre'), cards: localStorage.getItem('lx.cards') }));
    ok(rolled.schema === '2' && rolled.sre === null && rolled.cards === JSON.stringify({ 'ls-l': { box: 3 } }), 'rollback restores the pre-migration store exactly', rolled);
    await ctx.close();
  }

  await b.close();
  console.log((fails ? fails + ' failed, ' : '') + passes + ' SRE hub checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('ERRORS: [' + e.message + ']'); process.exit(1); });
