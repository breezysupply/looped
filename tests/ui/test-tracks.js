const H = require('../helpers');
const { chromium } = require('playwright');

/* Track scoping is the property every future content phase depends on: with a
   track selected, no other track's content may appear anywhere. */
(async () => {
  const b = await chromium.launch(H.launchOptions());
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(H.URL, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });

  console.log('registry:', await p.evaluate(() => LX.tracks.map(t => t.id).join(', ')));
  console.log('default track pill:', await p.locator('#trackName').textContent());
  console.log('pill shown (more than one track):', await p.locator('#trackBtn').isVisible());

  // the sheet lists every track plus All
  await p.click('#trackBtn');
  await p.waitForSelector('#trackSheet', { state: 'visible' });
  const rows = await p.locator('.track-row').evaluateAll(n => n.map(x => ({
    id: x.dataset.track,
    name: x.querySelector('.track-nm').textContent,
    count: Number(x.querySelector('.track-count').textContent)
  })));
  console.log('sheet rows:', rows.map(r => `${r.id}(${r.count})`).join(' '));
  console.log('has an All option:', rows.some(r => r.id === 'all'));
  console.log('every track has content:', rows.filter(r => r.id !== 'all').every(r => r.count > 0));
  console.log('All is the sum of the parts:',
    rows.find(r => r.id === 'all').count === rows.filter(r => r.id !== 'all').reduce((a, r) => a + r.count, 0));

  // switching to an empty track must empty every list, not error
  await p.click('.track-row[data-track="containers"]');
  await p.waitForTimeout(200);
  console.log('\nswitched to containers — pill:', await p.locator('#trackName').textContent());
  console.log('  sheet closed:', await p.locator('#trackSheet').isHidden());
  await H.go(p, 'commands');
  console.log('  commands:', await p.locator('#cmdCount').textContent(),
    '| cards:', await p.locator('#cmdList .card').count());
  const chips = await p.locator('#catChips .chip').allInnerTexts();
  const leaked = await p.evaluate((names) => {
    const own = Object.values(LX.track.byId('containers').cats);
    return names.filter(n => n !== 'All' && own.indexOf(n) === -1);
  }, chips);
  console.log('  category chips:', chips.length, '| from another track:', leaked.length ? leaked : 'none');
  await H.go(p, 'playbooks');
  console.log('  playbooks:', await p.locator('#pbList [data-pb]').count());
  await H.go(p, 'drills');
  console.log('  drills:', await p.locator('#drillList .card').count(),
    '| playbook/mission content is containers-only:', await p.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('#pbList [data-pb]')).map(e => e.dataset.pb);
      return ids.every(id => (LX.playbooks.filter(p => p.id === id)[0] || {}).track === 'containers');
    }));
  await H.go(p, 'labs');
  console.log('  labs:', await p.locator('#labList [data-lab]').count(),
    '| missions:', await p.locator('#sbList [data-mission]').count());
  await H.go(p, 'quiz');
  const topics = await p.locator('#quizCat option').allInnerTexts();
  console.log('  quiz topic dropdown:', JSON.stringify(topics));
  console.log('  overflow:', await H.overflow(p));

  // and back
  await p.click('#trackBtn');
  await p.click('.track-row[data-track="linux"]');
  await p.waitForTimeout(200);
  await H.go(p, 'commands');
  const back = await p.locator('#cmdCount').textContent();
  console.log('\nback on linux —', back, '| chips:', await p.locator('#catChips .chip').count());
  console.log('  every rendered card is linux:', await p.evaluate(() => {
    const shown = Array.from(document.querySelectorAll('#cmdList .card-title')).map(e => e.textContent);
    const linux = LX.commands.filter(c => (c.track || 'linux') === 'linux').map(c => c.name);
    return shown.every(t => linux.indexOf(t) !== -1);
  }));

  // choice persists
  await p.click('#trackBtn');
  await p.click('.track-row[data-track="containers"]');
  await p.waitForTimeout(150);
  await p.reload({ waitUntil: 'networkidle' });
  console.log('  track survives reload:', await p.locator('#trackName').textContent());

  // All tracks shows everything
  await p.click('#trackBtn');
  await p.click('.track-row[data-track="all"]');
  await p.waitForTimeout(200);
  await H.go(p, 'commands');
  console.log('  all tracks:', await p.locator('#cmdCount').textContent());

  console.log('\nERRORS:', errs.length ? errs : 'none');
  await b.close();
})();
