const H = require('../helpers');
const { chromium } = require('playwright');

/* Keyboard and screen-reader basics. Not a full audit — the specific gaps that
   were open: no focus ring outside the search box, no way to skip the top bar,
   role="tab" with no arrow keys and no tabindex, role="tablist" on chip rows
   that have no tabs in them, and terminals a screen reader never announced. */
(async () => {
  const b = await chromium.launch(H.launchOptions());
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(H.URL, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });

  // the skip link is the first stop and it works
  await p.keyboard.press('Tab');
  const first = await p.evaluate(() => ({
    tag: document.activeElement.tagName,
    cls: document.activeElement.className,
    text: document.activeElement.textContent.trim()
  }));
  console.log('first Tab stop:', first.cls, '—', JSON.stringify(first.text));
  console.log('  becomes visible on focus:', await p.evaluate(() =>
    document.querySelector('.skip').getBoundingClientRect().top >= 0));

  // roving tabindex: the whole tab bar is one stop
  const tabIdx = await p.locator('.tabbar .tab').evaluateAll(n =>
    n.map(x => `${x.dataset.group}:${x.getAttribute('tabindex')}`));
  console.log('tab bar tabindex:', tabIdx.join(' '),
    tabIdx.filter(t => t.endsWith(':0')).length === 1 ? '(one stop — correct)' : '(FAIL)');

  // arrow keys move and activate
  await p.locator('.tabbar .tab[data-group="learn"]').focus();
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(120);
  console.log('ArrowRight from Learn ->',
    await p.evaluate(() => document.querySelector('.tab.active').dataset.group),
    '| focus followed:', await p.evaluate(() => document.activeElement.dataset.group));
  await p.keyboard.press('End');
  await p.waitForTimeout(120);
  console.log('End ->', await p.evaluate(() => document.querySelector('.tab.active').dataset.group));
  await p.keyboard.press('Home');
  await p.waitForTimeout(120);
  console.log('Home ->', await p.evaluate(() => document.querySelector('.tab.active').dataset.group),
    '| focus still on a tab:', await p.evaluate(() => !!document.activeElement.dataset.group));

  // sub-nav responds to arrows too (Home put us back on Learn)
  await p.locator('#subnav .seg[data-view="commands"]').focus();
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(120);
  console.log('sub-nav ArrowRight ->',
    await p.evaluate(() => (document.querySelector('.view.active') || {}).id));

  // panels are addressable and announced
  console.log('view panels are tabpanels:', await p.locator('.view[role="tabpanel"]').count());
  console.log('tabs name their panel:', await p.locator('.tab[aria-controls]').count());
  console.log('chip rows no longer claim to be tablists:',
    await p.locator('.chips[role="tablist"]').count() === 0,
    '| now groups:', await p.locator('.chips[role="group"]').count());
  console.log('both terminals are live logs:',
    await p.locator('.term[role="log"][aria-live]').count());

  // Escape closes the track sheet
  await p.click('#trackBtn');
  await p.waitForSelector('#trackSheet', { state: 'visible' });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(120);
  console.log('Escape closes the track sheet:', await p.locator('#trackSheet').isHidden());
  console.log('  focus returned to the pill:',
    await p.evaluate(() => document.activeElement.id) === 'trackBtn');

  // a focus ring exists on something other than the search box
  await p.locator('.tabbar .tab[data-group="quiz"]').focus();
  const ring = await p.evaluate(() => {
    const cs = getComputedStyle(document.activeElement);
    return cs.outlineStyle + ' ' + cs.outlineWidth;
  });
  console.log('focus ring on a tab:', ring, ring.includes('none') ? '(FAIL)' : '');

  console.log('ERRORS:', errs.length ? errs : 'none');
  await b.close();
})();
