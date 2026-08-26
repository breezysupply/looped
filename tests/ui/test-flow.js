const H = require('../helpers');
const { chromium } = require('playwright');
const openPb = async (p, id) => {
  await p.click('.tab[data-group="learn"]');
  const seg = p.locator('#subnav .seg[data-view="playbooks"]');
  if (await seg.count()) await seg.click();
  await p.waitForTimeout(120);
  if (await p.locator('#pbExit').isVisible()) { await p.click('#pbExit'); await p.waitForTimeout(80); }
  await p.click(`[data-pb="${id}"]`);
  await p.waitForTimeout(120);
};
(async () => {
  const b = await chromium.launch(H.launchOptions());
  const p = await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2})).newPage();
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  p.on('console', m=>{if(m.type()==='error')errs.push('console: '+m.text());});
  await p.goto(H.URL,{waitUntil:'networkidle'});

  await openPb(p, 'pb-app-walk');
  console.log('default mode is Flow:', await p.locator('#pbMode .seg.active').textContent() === 'Flow');
  console.log('start node:', await p.locator('.flow-start').textContent());
  console.log('nodes:', await p.locator('.flow-node').count(), '| arrows:', await p.locator('.flow-arrow').count());
  console.log('questions:', await p.locator('.flow-q').allInnerTexts());
  console.log('commands:', await p.locator('.flow-node code').allInnerTexts());
  console.log('all callouts closed at open:', await p.locator('.flow-item.open').count() === 0);
  console.log('overflow (flow, collapsed):', await H.overflow(p));
  await p.screenshot({ path:H.shot('flow.png'), fullPage:true });

  // tap a command -> callout
  await p.locator('.flow-node').nth(2).click();
  await p.waitForTimeout(80);
  const co = p.locator('.flow-item.open .flow-callout');
  console.log('tap opens exactly one callout:', await p.locator('.flow-item.open').count() === 1);
  console.log('  labels:', await p.locator('.flow-item.open .flow-label').allInnerTexts());
  console.log('  "What it is" text:', (await co.locator('.flow-text').first().textContent()).slice(0,90));
  console.log('  syntax line:', await co.locator('.syntax').count() ? (await co.locator('.syntax').first().textContent()).slice(0,60) : 'none');
  console.log('  full-page link:', await co.locator('[data-goto]').count() ? await co.locator('[data-goto]').first().textContent() : 'none');
  console.log('overflow (callout open):', await H.overflow(p));
  await p.screenshot({ path:H.shot('flow-open.png'), fullPage:true });
  await p.locator('.flow-node').nth(2).click(); await p.waitForTimeout(60);
  console.log('tap again closes it:', await p.locator('.flow-item.open').count() === 0);

  // expand all in flow mode
  await p.click('#pbAllBtn'); await p.waitForTimeout(80);
  console.log('expand all opens every callout:', await p.locator('.flow-item.open').count() === 5);
  console.log('overflow (all open):', await H.overflow(p));
  await p.click('#pbAllBtn'); await p.waitForTimeout(60);

  // full-page link jumps to the command entry
  await p.locator('.flow-node').nth(2).click(); await p.waitForTimeout(60);
  await p.locator('.flow-item.open [data-goto]').click(); await p.waitForTimeout(200);
  console.log('full-page link lands on Commands:', await p.locator('#view-commands.active').count() === 1,
    '| search:', await p.inputValue('#search'), '| results:', (await p.locator('#cmdCount').textContent()));

  // walk mode still works and is remembered
  await p.fill('#search',''); await p.waitForTimeout(100);
  await openPb(p, 'pb-app-walk');
  await p.click('#pbMode .seg[data-pbmode="walk"]'); await p.waitForTimeout(100);
  console.log('still on the playbook after toggling mode:', await p.locator('#view-playbooks.active').count() === 1);
  console.log('walk mode renders step cards:', await p.locator('#pbSteps .pb-step').count(),
    '| Next visible:', await p.locator('#pbNext').isVisible(), '| flow gone:', await p.locator('.flow-node').count() === 0);
  await p.click('#pbNext'); await p.waitForTimeout(80);
  console.log('  Next advances to:', await p.locator('#pbSteps .pb-step').count(), 'cards');
  await p.reload({waitUntil:'networkidle'});
  await openPb(p, 'pb-svc-start');
  console.log('mode persists across reload:', await p.locator('#pbMode .seg.active').textContent());
  await p.click('#pbMode .seg[data-pbmode="flow"]'); await p.waitForTimeout(100);

  // every playbook renders in flow mode without overflow or a missing command
  const ids = await p.evaluate(() => LX.playbooks.map(x => x.id));
  let worst = 0, bad = [], nolib = 0, nodes = 0;
  for (const id of ids) {
    await openPb(p, id);
    await p.click('#pbAllBtn'); await p.waitForTimeout(50);
    const o = await H.overflow(p);
    if (o > 0) { bad.push(`${id}:${o}`); worst = Math.max(worst, o); }
    nodes += await p.locator('.flow-node').count();
    nolib += await p.locator('.flow-item.open').count() - await p.locator('.flow-item.open .syntax').count();
    await p.click('#pbAllBtn'); await p.waitForTimeout(30);
  }
  console.log(`all ${ids.length} playbooks in flow mode — overflow:`, bad.join(' ') || 'none', '| worst:', worst);
  console.log(`flow nodes rendered: ${nodes} | without a library match: ${nolib}`);

  // scenarios (no check/why) survive the same renderer
  await p.click('#pbExit'); await p.waitForTimeout(80);
  await p.click('#pbFilter .chip[data-pbfilter="scenario"]'); await p.waitForTimeout(120);
  const sc = await p.locator('#pbList [data-pb]').first().getAttribute('data-pb');
  await p.click(`[data-pb="${sc}"]`); await p.waitForTimeout(120);
  console.log('scenario in flow mode:', await p.locator('.flow-node').count(), 'nodes | overflow:', await H.overflow(p));

  console.log('ERRORS:', errs.length ? errs : 'none');
  await b.close();
})();
