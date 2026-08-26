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

  console.log('data:', JSON.stringify(await page.evaluate(() => ({
    cmds: LX.commands.length, scen: LX.scenarios.length, drills: LX.drills.length,
    mcq: LX.quiz.length, output: LX.outputQs.length, danger: LX.dangerQs.length, labs: LX.labs.length
  }))));

  // exercise each question style in isolation
  for (const type of ['mcq', 'output', 'danger', 'order', 'build']) {
    await H.go(page, 'quiz');
    await page.evaluate(() => { document.querySelector('#quizAgain') && document.querySelector('#quizAgain').click(); });
    // select only this style
    // select the target style FIRST (the engine refuses to deselect the last one)
    const target = page.locator(`#typeChips .chip[data-type="${type}"]`);
    if (!await target.evaluate(el => el.classList.contains('active'))) await target.click();
    for (const t of ['mcq', 'output', 'danger', 'order', 'build']) {
      if (t === type) continue;
      const chip = page.locator(`#typeChips .chip[data-type="${t}"]`);
      if (await chip.evaluate(el => el.classList.contains('active'))) await chip.click();
    }
    const activeNow = await page.locator('#typeChips .chip.active').evaluateAll(els => els.map(e => e.dataset.type));
    if (activeNow.join() !== type) throw new Error(`style isolation failed: ${activeNow}`);
    await page.click('#quizStartBtn');
    await page.waitForSelector('#quizStage');
    const label = await page.locator('#quizType').textContent();

    // answer 3 questions of this style
    for (let n = 0; n < 3; n++) {
      const kind = await page.evaluate(() => {
        if (document.querySelector('#quizStage [data-pick]')) return 'pick';
        if (document.querySelector('#quizStage [data-ord]')) return 'order';
        if (document.querySelector('#quizStage [data-tok]')) return 'build';
        return 'unknown';
      });
      if (kind === 'pick') {
        await page.click('#quizStage [data-pick="0"]');
      } else if (kind === 'order') {
        const count = await page.locator('#quizStage [data-ord]').count();
        for (let i = 0; i < count; i++) await page.click(`#quizStage [data-ord="${i}"]`);
      } else if (kind === 'build') {
        const count = await page.locator('#quizStage [data-tok]').count();
        for (let i = 0; i < count; i++) await page.click(`#quizStage [data-tok="${i}"]`);
        await page.click('#buildRun');
      } else {
        throw new Error(`${type}: unknown stage`);
      }
      await page.waitForSelector('#quizNext:not([hidden])');
      if (n === 0) await page.screenshot({ path: H.shot(`q-${type}.png`) });
      await page.click('#quizNext');
      await page.waitForTimeout(60);
    }
    console.log(`  ${type} → labelled "${label}", 3 questions answered ok`);
    // finish out the round
    for (let n = 0; n < 12; n++) {
      if (await page.locator('#quizScore').isVisible().catch(() => false)) break;
      const kind = await page.evaluate(() => {
        if (document.querySelector('#quizStage [data-pick]')) return 'pick';
        if (document.querySelector('#quizStage [data-ord]')) return 'order';
        if (document.querySelector('#quizStage [data-tok]')) return 'build';
        return null;
      });
      if (!kind) break;
      if (kind === 'pick') await page.click('#quizStage [data-pick="1"]').catch(() => {});
      else if (kind === 'order') {
        const c = await page.locator('#quizStage [data-ord]').count();
        for (let i = c - 1; i >= 0; i--) await page.click(`#quizStage [data-ord="${i}"]`);
      } else {
        const c = await page.locator('#quizStage [data-tok]').count();
        for (let i = 0; i < c; i++) await page.click(`#quizStage [data-tok="${i}"]`);
        await page.click('#buildRun');
      }
      await page.waitForSelector('#quizNext:not([hidden])');
      await page.click('#quizNext');
      await page.waitForTimeout(50);
    }
    await page.waitForSelector('#quizScore');
  }
  await page.screenshot({ path:H.shot('q-results.png') });

  // speed round
  await page.click('#quizAgain');
  await page.click('#typeChips .chip[data-type="mcq"]');   // re-enable a couple of styles
  await page.click('#modeChips .chip[data-mode="speed"]');
  await page.click('#quizStartBtn');
  await page.waitForSelector('#quizStage');
  console.log('speed timer visible:', await page.locator('#quizTimer').isVisible());
  const t1 = await page.locator('#quizTimer').textContent();
  await page.waitForTimeout(1200);
  const t2 = await page.locator('#quizTimer').textContent();
  console.log(`timer counts down: ${t1} -> ${t2}`);
  await page.click('#quizQuit');

  // weak-spot mode uses the misses recorded above
  await page.click('#modeChips .chip[data-mode="weak"]');
  await page.click('#quizStartBtn');
  const weakStarted = await page.locator('#quizStage [data-pick]').count();
  console.log('weak-spot round questions rendered:', weakStarted > 0);
  await page.click('#quizQuit');

  // review tab
  await H.go(page, 'review');
  const tiles = await page.locator('#revStreak .stat-tile .stat-n').allTextContents();
  console.log('review tiles [streak, due, deck, accuracy]:', JSON.stringify(tiles));
  console.log('mastery bars:', await page.locator('#revMastery .mastery').count());
  console.log('weak entries:', await page.locator('#revWeak .review-item').count());
  await page.screenshot({ path:H.shot('review-home.png') });

  // seed the deck, then run a flashcard session
  await page.selectOption('#seedCat', 'net');
  await page.click('#seedBtn');
  await page.waitForTimeout(200);
  const deckSize = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('lx.cards') || '{}')).length);
  console.log('deck size after seeding:', deckSize);

  await page.click('#revStartBtn');
  await page.waitForSelector('#revFront');
  await page.click('#revShow');
  await page.screenshot({ path:H.shot('review-card.png') });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('lx.cards')));
  const firstId = Object.keys(before)[0];
  for (const g of ['good', 'again', 'easy', 'hard']) {
    if (await page.locator('#revDone').isVisible().catch(() => false)) break;
    if (await page.locator('#revShow').isVisible()) await page.click('#revShow');
    await page.click(`[data-grade="${g}"]`);
    await page.waitForTimeout(60);
  }
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('lx.cards')));
  const changed = Object.keys(after).filter(id => after[id].reps > 0);
  console.log('cards graded:', changed.length, '| sample schedule:',
    JSON.stringify(changed.slice(0, 3).map(id => ({ due: after[id].due, ivl: Math.round(after[id].ivl * 10) / 10, ease: Math.round(after[id].ease * 100) / 100 }))));

  // streak recorded?
  console.log('streak:', JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem('lx.streak')))));

  // starring adds a card
  await H.go(page, 'commands');
  await page.locator('#cmdList .star').first().click();
  await page.waitForTimeout(120);
  const starAdded = await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('lx.cards') || '{}');
    return Object.keys(c).some(k => k.startsWith('c:'));
  });
  console.log('starring created a review card:', starAdded);

  // lab misstep creates a card
  await H.go(page, 'labs');
  await page.click('[data-lab="disk-full"]');
  const wrongIdx = await page.evaluate(() => LX.labs.find(l => l.id === 'disk-full').steps[0].opts.findIndex(o => !o.ok));
  await page.click(`#labOpts .lab-opt[data-opt="${wrongIdx}"]`);
  await page.waitForTimeout(120);
  console.log('lab misstep created a card:', await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('lx.cards') || '{}');
    return Object.keys(c).some(k => k.startsWith('l:'));
  }));

  // persistence across reload
  await page.reload({ waitUntil: 'networkidle' });
  await H.go(page, 'review');
  console.log('deck after reload:', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('lx.cards') || '{}')).length));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('horizontal overflow px:', overflow);
  console.log('ERRORS:', errs.length ? JSON.stringify(errs, null, 1) : 'none');
  await browser.close();
})();
