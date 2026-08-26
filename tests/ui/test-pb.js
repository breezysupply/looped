const H = require('../helpers');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(H.launchOptions());
  const p = await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2})).newPage();
  const errs=[]; p.on('pageerror', e=>errs.push(e.message)); p.on('console', m=>{if(m.type()==='error')errs.push('console: '+m.text());});
  await p.goto(H.URL, {waitUntil:'networkidle'});

  await H.go(p, 'playbooks');
  console.log('playbook cards:', await p.locator('#pbList .lab-card').count());
  await p.screenshot({ path:H.shot('pb-list.png') });

  // scenarios still reachable through the same walker
  await p.click('#pbFilter .chip[data-pbfilter="scenario"]');
  await p.waitForTimeout(150);
  console.log('scenario cards:', await p.locator('#pbList .lab-card').count());
  await p.click('#pbFilter .chip[data-pbfilter="playbook"]');
  await p.waitForTimeout(120);

  // walk the disk-full tree one step at a time
  await p.click('[data-pb="pb-disk-full"]');
  await p.click('#pbMode .seg[data-pbmode="walk"]');
  await p.waitForSelector('#pbSteps .pb-step');
  console.log('steps visible at open:', await p.locator('#pbSteps .pb-step').count());
  console.log('first step auto-expanded:', await p.locator('#pbSteps .pb-step.open').count() === 1);
  console.log('talk track present:', await p.locator('#pbSayWrap').isVisible());
  await p.screenshot({ path:H.shot('pb-step1.png') });

  // collapse/expand a step by tapping it
  await p.click('#pbSteps .pb-step:first-child .pb-step-head');
  await p.waitForTimeout(80);
  console.log('tap collapses:', await p.locator('#pbSteps .pb-step.open').count() === 0);
  await p.click('#pbSteps .pb-step:first-child .pb-step-head');
  await p.waitForTimeout(80);
  console.log('tap re-expands:', await p.locator('#pbSteps .pb-step.open').count() === 1);

  // next step
  const total = await p.evaluate(() => LX.playbooks.find(x => x.id === 'pb-disk-full').steps.length);
  await p.click('#pbNext'); await p.waitForTimeout(120);
  console.log(`after Next: ${await p.locator('#pbSteps .pb-step').count()} of ${total} steps`);
  console.log('progress label:', await p.locator('#pbStepNo').textContent());

  // branch inside step 2
  const branches = await p.locator('#pbSteps .pb-branch').count();
  console.log('branches rendered on step 2:', branches);
  await p.screenshot({ path:H.shot('pb-branch.png') });

  // expand all
  await p.click('#pbAllBtn'); await p.waitForTimeout(150);
  console.log('expand all shows every step:', await p.locator('#pbSteps .pb-step').count() === total);
  console.log('all open:', await p.locator('#pbSteps .pb-step.open').count() === total);
  console.log('end matter visible:', await p.locator('#pbEnd').isVisible());
  console.log('button label:', await p.locator('#pbAllBtn').textContent());
  await p.screenshot({ path:H.shot('pb-expandall.png'), fullPage:false });

  // trap / remember / probes at the end
  console.log('probes rendered:', await p.locator('#pbEnd .breakdown').count());
  console.log('practise button:', await p.locator('#pbEnd [data-practise]').count());

  // branch jump between trees
  await p.click('#pbExit'); await p.waitForSelector('#pbList', {state:'visible'});
  await p.click('[data-pb="pb-framework"]');
  await p.click('#pbNext'); await p.waitForTimeout(120);
  const gotoBtn = p.locator('#pbSteps [data-goto-pb]').first();
  const target = await gotoBtn.getAttribute('data-goto-pb');
  await gotoBtn.click(); await p.waitForTimeout(150);
  console.log(`branch jump → ${target}:`, (await p.locator('#pbTitle').textContent()).length > 0,
    '|', await p.locator('#pbTitle').textContent());

  // hand-off into the sandbox
  await p.click('#pbExit'); await p.waitForSelector('#pbList', {state:'visible'});
  await p.click('[data-pb="pb-disk-full"]');
  await p.click('#pbAllBtn'); await p.waitForTimeout(150);
  await p.click('#pbEnd [data-practise]'); await p.waitForTimeout(250);
  console.log('practise opened the sandbox mission:', await p.locator('#sbInput').isVisible(),
    '|', await p.locator('#sbTitle').textContent());

  // walked badge persists
  await p.reload({ waitUntil:'networkidle' });
  await H.go(p, 'playbooks');
  console.log('walked badges after reload:', await p.locator('#pbList .badge.done').count());

  // search reaches playbooks
  await p.fill('#search','inode'); await p.waitForTimeout(200);
  console.log('playbooks matching "inode":', await p.locator('#pbList .lab-card').count());
  await p.fill('#search','');

  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('horizontal overflow px:', overflow);
  console.log('ERRORS:', errs.length?errs:'none');
  await b.close();
})();
