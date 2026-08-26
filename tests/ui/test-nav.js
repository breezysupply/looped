const H = require('../helpers');
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch(H.launchOptions());
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(H.URL, { waitUntil: 'networkidle' });

  console.log('bottom tabs:', await p.locator('.tabbar .tab').count());
  console.log('tab labels:', await p.locator('.tabbar .tab').allInnerTexts().then(a => a.map(s => s.split('\n').pop())));

  // group -> sub-nav shape
  for (const [g, n] of [['learn', 3], ['practice', 2], ['quiz', 0], ['review', 0]]) {
    await p.click(`.tab[data-group="${g}"]`);
    await p.waitForTimeout(80);
    const segs = await p.locator('#subnav .seg').count();
    const hidden = await p.locator('#subnav').isHidden();
    console.log(`${g}: segs=${n === 0 ? (hidden ? 0 : segs) : segs} expected=${n} ok=${(n === 0 ? hidden : segs === n && !hidden)}`);
    console.log(`  active tab is ${g}:`, await p.locator('.tab.active').getAttribute('data-group') === g);
  }

  // sub-nav switches the panel, and the group remembers where you were
  await p.click('.tab[data-group="learn"]');
  await p.click('#subnav .seg[data-view="drills"]');
  await p.waitForTimeout(80);
  console.log('drills panel active:', await p.locator('#view-drills.active').count() === 1);
  await p.click('.tab[data-group="review"]');
  await p.waitForTimeout(80);
  await p.click('.tab[data-group="learn"]');
  await p.waitForTimeout(80);
  console.log('learn returns to drills:', await p.locator('#view-drills.active').count() === 1);

  await p.reload({ waitUntil: 'networkidle' });
  console.log('drills survives reload:', await p.locator('#view-drills.active').count() === 1);
  console.log('learn tab active after reload:', await p.locator('.tab.active').getAttribute('data-group') === 'learn');

  // no view is stranded: every panel must be reachable from the nav
  const reach = await p.evaluate(() => Array.prototype.map.call(
    document.querySelectorAll('.view'), s => s.id.slice(5)));
  const wired = await p.evaluate(() => {
    var seen = [];
    document.querySelectorAll('.tab').forEach(function (t) { t.click();
      document.querySelectorAll('#subnav .seg').forEach(function (s) { seen.push(s.dataset.view); });
      if (!document.querySelectorAll('#subnav .seg').length) {
        seen.push(document.querySelector('.view.active').id.slice(5));
      }
    });
    return seen;
  });
  console.log('unreachable views:', reach.filter(v => wired.indexOf(v) === -1).join(', ') || 'none');

  // regression guard: measure overflow WHILE a playbook is open and fully expanded
  await p.goto(H.URL, { waitUntil: 'networkidle' });
  await p.click('.tab[data-group="learn"]');
  await p.click('#subnav .seg[data-view="playbooks"]');
  await p.waitForTimeout(120);
  const ids = await p.locator('#pbList [data-pb]').evaluateAll(n => n.map(x => x.dataset.pb));
  let worst = 0, bad = [];
  for (const id of ids) {
    await p.click(`[data-pb="${id}"]`);
    await p.click('#pbMode .seg[data-pbmode="walk"]');
    await p.waitForSelector('#pbSteps .pb-step');
    await p.click('#pbAllBtn');
    await p.waitForTimeout(60);
    const o = await H.overflow(p);
    if (o > 0) { bad.push(`${id}:${o}`); worst = Math.max(worst, o); }
    await p.click('#pbExit');
    await p.waitForTimeout(40);
  }
  console.log(`playbooks open+expanded with overflow (${ids.length} checked):`, bad.join(' ') || 'none', '| worst:', worst);

  // and with a sandbox mission running
  await p.click('.tab[data-group="practice"]');
  await p.click('#subnav .seg[data-view="sandbox"]');
  await p.waitForTimeout(100);
  await p.click('[data-mission="m-disk"]');
  await p.waitForSelector('#sbInput', { state: 'visible' });
  console.log('sandbox open overflow:', await H.overflow(p));
  console.log('composer clear of tab bar:', await p.evaluate(() => {
    var c = document.querySelector('.sb-composer').getBoundingClientRect();
    var t = document.querySelector('.tabbar').getBoundingClientRect();
    return c.bottom <= t.top + 1;
  }));

  await p.screenshot({ path:H.shot('nav-sandbox.png') });
  await p.click('.tab[data-group="learn"]');
  await p.waitForTimeout(80);
  await p.screenshot({ path:H.shot('nav-learn.png') });

  console.log('ERRORS:', errs.length ? errs : 'none');
  await b.close();
})();
