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

  /* ── lazy loading ────────────────────────────────────────────────────
     The default track is the only one in the document. A non-default track's
     files must be absent until it is chosen, and its content genuinely absent
     from the pools — a shrunken library that still renders is the failure mode
     this whole phase risks. */
  const srcs = () => p.evaluate(() =>
    Array.from(document.scripts).map(s => (s.getAttribute('src') || '')).filter(Boolean));
  const trackFiles = (id) => p.evaluate(t => LX.track.files(t), id);

  const cnFiles = await trackFiles('containers');
  const atBoot = await srcs();
  console.log('containers files in registry:', cnFiles.length);
  console.log('  none of them in the initial document:',
    cnFiles.every(f => atBoot.indexOf(f) === -1));
  console.log('  containers content absent from LX.commands:', await p.evaluate(() =>
    LX.commands.filter(c => c.track === 'containers').length === 0));
  console.log('  kubectl not registered in the shell:', await p.evaluate(() =>
    !LXShell.registered('kubectl')));
  console.log('  linux loaded, containers not:', await p.evaluate(() =>
    LX.track.isLoaded('linux') && !LX.track.isLoaded('containers')));

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
  await p.waitForTimeout(400);
  console.log('\nswitched to containers — pill:', await p.locator('#trackName').textContent());
  const afterSwitch = await srcs();
  const added = afterSwitch.filter(f => atBoot.indexOf(f) === -1);
  console.log('  scripts injected:', added.length,
    '| exactly the containers files:',
    added.length === cnFiles.length && cnFiles.every(f => added.indexOf(f) !== -1));
  console.log('  content arrived:', await p.evaluate(() =>
    LX.commands.filter(c => c.track === 'containers').length));
  console.log('  shell verbs arrived:', await p.evaluate(() =>
    ['kubectl', 'docker', 'crictl'].every(v => LXShell.registered(v))));
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
  await p.waitForTimeout(300);
  console.log('\nno re-injection on the way back:',
    (await srcs()).length === afterSwitch.length);
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

  /* index.html no longer references the lazy files, so nothing but sw.js
     ASSETS puts them in the cache. Prove it: a fresh profile that has only
     ever seen the linux track, then offline, then a track it never opened. */
  const off = await b.newContext({ viewport: { width: 390, height: 844 } });
  const q = await off.newPage();
  const offErrs = []; q.on('pageerror', e => offErrs.push(e.message));
  await q.goto(H.URL, { waitUntil: 'networkidle' });
  await q.evaluate(() => navigator.serviceWorker.ready);
  await q.waitForTimeout(600);                 /* addAll finishes after ready */
  await q.reload({ waitUntil: 'networkidle' });
  await off.setOffline(true);
  await q.click('#trackBtn');
  await q.click('.track-row[data-track="containers"]');
  await q.waitForTimeout(800);
  await H.go(q, 'commands');
  console.log('\noffline, track never opened before —',
    await q.locator('#cmdCount').textContent(),
    '| cards:', await q.locator('#cmdList .card').count());
  console.log('  errors:', offErrs.length ? offErrs : 'none');
  await off.setOffline(false);

  await b.close();
})();
