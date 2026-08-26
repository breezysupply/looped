const H = require('../helpers');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(H.launchOptions());
  const p = await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2})).newPage();
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  p.on('console', m=>{if(m.type()==='error')errs.push('console: '+m.text());});
  await p.goto(H.URL,{waitUntil:'networkidle'});
  await p.evaluate(() => localStorage.clear());
  await p.reload({waitUntil:'networkidle'});
  await p.click('.tab[data-group="learn"]');
  await p.click('#subnav .seg[data-view="playbooks"]');
  await p.waitForTimeout(150);

  const ids = await p.evaluate(() => LX.playbooks.map(x => x.id));
  let totalSamples = 0, totalMarks = 0, bad = [], worst = 0;
  for (const id of ids) {
    if (await p.locator('#pbExit').isVisible()) { await p.click('#pbExit'); await p.waitForTimeout(60); }
    await p.click(`[data-pb="${id}"]`); await p.waitForTimeout(80);
    await p.click('#pbAllBtn'); await p.waitForTimeout(80);
    const s = await p.locator('.pb-sample').count();
    const m = await p.locator('.pb-sample mark').count();
    totalSamples += s; totalMarks += m;
    const o = await H.overflow(p);
    if (o > 0) { bad.push(`${id}:${o}`); worst = Math.max(worst, o); }
    const expected = await p.evaluate(x => (LX.pbOut[x]||[]).filter(Boolean).length, id);
    if (s !== expected) bad.push(`${id} rendered ${s} of ${expected}`);
    await p.click('#pbAllBtn'); await p.waitForTimeout(40);
  }
  console.log('flow mode — samples rendered:', totalSamples, '| highlighted lines:', totalMarks);
  console.log('page overflow across all 22:', bad.join(' ') || 'none', '| worst:', worst);

  // the sample block must scroll inside itself, not push the page wide
  await p.click('#pbExit'); await p.waitForTimeout(60);
  await p.click('[data-pb="pb-app-walk"]'); await p.waitForTimeout(80);
  await p.locator('.flow-node').first().click(); await p.waitForTimeout(80);
  console.log('sample visible in flow callout:', await p.locator('.pb-sample').first().isVisible());
  console.log('  scrolls inside itself:', await p.evaluate(() => {
    var e = document.querySelector('.pb-sample');
    return e.scrollWidth > e.clientWidth && getComputedStyle(e).overflowX === 'auto';
  }));
  console.log('  marks in it:', await p.locator('.pb-sample mark').allInnerTexts());
  console.log('  note present:', await p.locator('.pb-sample-note').count() > 0);
  await p.screenshot({path:H.shot('sample-flow.png'), fullPage:true});

  // walk mode gets them too
  await p.click('#pbMode .seg[data-pbmode="walk"]'); await p.waitForTimeout(100);
  await p.click('#pbAllBtn'); await p.waitForTimeout(100);
  console.log('walk mode samples:', await p.locator('.pb-sample').count(), '| overflow:', await H.overflow(p));

  // light theme legibility
  await p.click('#themeBtn'); await p.waitForTimeout(150);
  console.log('light theme mark contrast ok:', await p.evaluate(() => {
    var m = document.querySelector('.pb-sample mark');
    return m ? getComputedStyle(m).backgroundColor !== 'rgba(0, 0, 0, 0)' : false;
  }));
  await p.screenshot({path:H.shot('sample-light.png')});
  console.log('ERRORS:', errs.length?errs:'none');
  await b.close();
})();
