const H = require('../helpers');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch(H.launchOptions());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await page.goto(H.URL, { waitUntil: 'networkidle' });

  /* Labs belong to tracks and every track but the default loads lazily, so a
     plain load sees only the Linux labs. Select All tracks and reload, and this
     suite covers the whole library instead of a shrinking fraction of it. */
  await page.evaluate(() => localStorage.setItem('lx.track', '"all"'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => LX.track.isLoaded('all'));

  // lab data sanity
  const info = await page.evaluate(() => {
    const problems = [];
    LX.labs.forEach(l => {
      ['id','title','cat','level','brief','user','host','steps','debrief','mins'].forEach(k => {
        if (!l[k]) problems.push(l.id + ' missing ' + k);
      });
      l.steps.forEach((s, i) => {
        if (!s.ask) problems.push(l.id + ' step ' + i + ' no ask');
        if (!s.opts || s.opts.length < 2) problems.push(l.id + ' step ' + i + ' too few options');
        if (!s.opts.some(o => o.ok)) problems.push(l.id + ' step ' + i + ' has NO correct option');
        s.opts.forEach(o => {
          if (!o.fb) problems.push(l.id + ' step ' + i + ' option without feedback');
          if (s.kind === 'think' && !o.t) problems.push(l.id + ' step ' + i + ' think option missing t');
          if (s.kind !== 'think' && !o.c) problems.push(l.id + ' step ' + i + ' cmd option missing c');
          if (s.kind !== 'think' && o.out === undefined) problems.push(l.id + ' step ' + i + ' cmd option missing out');
        });
      });
      ['why','interview','prevent'].forEach(k => { if (!l.debrief[k]) problems.push(l.id + ' debrief missing ' + k); });
      if (l.debrief.why.length < l.steps.length - 2) problems.push(l.id + ' debrief thin');
    });
    return {
      labs: LX.labs.length,
      steps: LX.labs.reduce((n, l) => n + l.steps.length, 0),
      opts: LX.labs.reduce((n, l) => n + l.steps.reduce((m, s) => m + s.opts.length, 0), 0),
      withParts: LX.labs.reduce((n, l) => n + l.steps.reduce((m, s) => m + s.opts.filter(o => o.parts).length, 0), 0),
      problems
    };
  });
  console.log('labs:', info.labs, 'steps:', info.steps, 'options:', info.opts, 'with arg breakdowns:', info.withParts);
  console.log('data problems:', JSON.stringify(info.problems));

  await H.go(page, 'labs');
  console.log('lab cards:', await page.locator('#labList .lab-card').count());
  await page.screenshot({ path:H.shot('lab-list.png') });

  // play every lab: first pick a WRONG option (where one exists), then the right one
  for (const labId of await page.evaluate(() => LX.labs.map(l => l.id))) {
    await page.click(`[data-lab="${labId}"]`);
    const stepCount = await page.evaluate(id => LX.labs.find(l => l.id === id).steps.length, labId);
    for (let s = 0; s < stepCount; s++) {
      await page.waitForSelector('#labOpts .lab-opt');
      const wrongIdx = await page.evaluate(([id, si]) => {
        const opts = LX.labs.find(l => l.id === id).steps[si].opts;
        return opts.findIndex(o => !o.ok);
      }, [labId, s]);
      if (wrongIdx >= 0) {
        await page.click(`#labOpts .lab-opt[data-opt="${wrongIdx}"]`);
        await page.waitForTimeout(40);
        const retryShown = await page.locator('.fb-retry').count();
        if (!retryShown) throw new Error(`${labId} step ${s}: wrong answer did not prompt a retry`);
      }
      if (labId === 'disk-full' && s === 0) await page.screenshot({ path:H.shot('lab-step.png') });
      const rightIdx = await page.evaluate(([id, si]) => {
        const opts = LX.labs.find(l => l.id === id).steps[si].opts;
        return opts.findIndex(o => o.ok);
      }, [labId, s]);
      await page.click(`#labOpts .lab-opt[data-opt="${rightIdx}"]`);
      await page.waitForSelector('#labNext');
      if (labId === 'disk-full' && s === 4) await page.screenshot({ path:H.shot('lab-feedback.png') });
      await page.click('#labNext');
      await page.waitForTimeout(40);
    }
    await page.waitForSelector('#labScore');
    const score = await page.locator('#labScore').textContent();
    const cmds = await page.locator('#labDebrief .breakdown').count();
    console.log(`  ${labId}: "${score}", ${cmds} command breakdowns in debrief`);
    if (labId === 'disk-full') await page.screenshot({ path:H.shot('lab-debrief.png'), fullPage: false });
    await page.click('#labBack');
    await page.waitForTimeout(60);
  }

  // progress persisted?
  console.log('badges after play:', await page.locator('#labList .badge.done').count());
  await page.reload({ waitUntil: 'networkidle' });
  await H.go(page, 'labs');
  console.log('badges after reload:', await page.locator('#labList .badge.done').count());

  // search filters labs too
  await page.fill('#search', 'oom');
  await page.waitForTimeout(150);
  console.log('lab cards matching "oom":', await page.locator('#labList .lab-card').count());
  await page.fill('#search', '');

  // other tabs still fine
  await H.go(page, 'quiz');
  await page.click('#quizStartBtn');
  /* On the rare miss, say why: start() bails with a toast when the pool is
     empty, and a bare 30s selector timeout tells you nothing about which. */
  const started = await page.waitForSelector('#quizStage .choice', { timeout: 15000 })
    .then(() => true).catch(() => false);
  if (started) console.log('quiz still works: yes');
  else {
    console.log('FAIL quiz produced no questions —',
      'panel hidden:', await page.locator('#quizStart').isHidden(),
      '| toast:', JSON.stringify(await page.locator('#toast').textContent().catch(() => '')),
      '| track:', await page.evaluate(() => LXUtil.track()),
      '| cat/level:', await page.inputValue('#quizCat'), await page.inputValue('#quizLevel'));
  }

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('horizontal overflow px:', overflow);
  console.log('ERRORS:', errs.length ? JSON.stringify(errs, null, 1) : 'none');
  await browser.close();
})();
