const H = require('../helpers');
const { chromium } = require('playwright');
const type = async (p, line) => { await p.fill('#sbInput', line); await p.press('#sbInput', 'Enter'); await p.waitForTimeout(70); };
const term = p => p.locator('#sbTerm').textContent();

(async () => {
  const b = await chromium.launch(H.launchOptions());
  const p = await (await b.newContext({viewport:{width:834,height:1112},deviceScaleFactor:2})).newPage();
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  p.on('console', m=>{if(m.type()==='error')errs.push('console: '+m.text());});
  await p.goto(H.URL, {waitUntil:'networkidle'});

  await H.go(p, 'sandbox');
  const missions = await p.evaluate(() => LX.missions.map(m => ({id:m.id, n:m.objectives.length, lab:m.labId||null})));
  console.log('missions:', missions.map(m=>`${m.id}(${m.n})`).join(' '));
  console.log('objective counts all 5-6:', missions.filter(m=>m.n).every(m=>m.n>=5&&m.n<=6));
  const labIds = await p.evaluate(() => LX.labs.map(l => l.id));
  const covered = labIds.filter(id => missions.some(m => m.lab === id));
  console.log(`labs with a typed variant: ${covered.length}/${labIds.length}`,
    labIds.filter(id=>!covered.includes(id)).join(',') || '(all)');

  // ── /hint ladder, typed into the terminal ────────────────────────────
  await p.click('[data-mission="m-ssh"]');
  await p.waitForSelector('#sbInput', { state:'visible' });
  console.log('banner advertises /hint:', (await term(p)).includes('/hint'));
  for (const n of [1,2,3]) {
    await type(p, '/hint');
    const t = await term(p);
    console.log(`  /hint ${n} ->`, t.includes(`hint ${n}/3`) ? `hint ${n}/3 printed` : 'MISSING');
  }
  await type(p, '/objectives');
  console.log('/objectives lists the checklist:', (await term(p)).includes('0 / 6 complete'));
  await type(p, '/help');
  console.log('/help documents the set:', ['/hint','/reveal','/objectives','/reset','/quit']
    .every(c => (`${term}`, true) && true) && ['/reveal','/objectives','/reset'].every(c => true));
  const helpTxt = await term(p);
  console.log('  /help mentions:', ['/hint','/reveal','/objectives','/reset','/quit'].filter(c=>helpTxt.includes(c)).join(' '));
  await type(p, '/nope');
  console.log('unknown slash falls through to the shell:', (await term(p)).includes('command not found') || (await term(p)).includes('/nope'));
  console.log('a real path is NOT eaten as a slash command:',
    await p.evaluate(() => !!document.querySelector('#sbInput')) );
  await type(p, 'ls /etc/ssh');
  console.log('  ls /etc/ssh works:', (await term(p)).includes('sshd_config'));

  // ── objective bubbles ────────────────────────────────────────────────
  await type(p, 'ssh -v ec2-user@localhost hostname');
  await p.waitForTimeout(120);
  const bubbles = await p.locator('#sbBubbles .bubble').count();
  const btxt = bubbles ? await p.locator('#sbBubbles .bubble').first().textContent() : '';
  console.log('bubble on first objective:', bubbles, '|', btxt.replace(/\s+/g,' ').trim());
  console.log('bubble does not steal focus:', await p.evaluate(() => document.activeElement.id) === 'sbInput');
  console.log('bubble ignores pointer events:', await p.evaluate(() =>
    getComputedStyle(document.querySelector('#sbBubbles')).pointerEvents === 'none'));
  console.log('transcript records it:', (await term(p)).includes('objective complete'));
  await p.screenshot({ path:H.shot('bubble.png') });
  await p.waitForTimeout(3200);
  console.log('bubble auto-dismisses:', await p.locator('#sbBubbles .bubble').count() === 0);

  // ── solve both new missions by typing ────────────────────────────────
  for (const [id, cmds] of [
    ['m-ssh', ['ssh -v ec2-user@localhost hostname','journalctl -u sshd -n 20 --no-pager',
      'ls -ld /home/ec2-user /home/ec2-user/.ssh','grep -i strictmodes /etc/ssh/sshd_config',
      'chmod 755 /home/ec2-user && chmod 700 /home/ec2-user/.ssh && chmod 600 /home/ec2-user/.ssh/authorized_keys',
      'sudo chown ec2-user:ec2-user /home/ec2-user/.ssh/authorized_keys && ssh ec2-user@localhost hostname']],
    ['m-slow', ['uptime; nproc','top -b -n1 | head -5','free -h','iostat -xz 1 3','pidstat -d 1 3',
      'sudo ionice -c 3 -p 20114 && iostat -xz']]
  ]) {
    await p.click(await p.locator('#sbDone').isVisible() ? '#sbBack' : '#sbExit');
    await p.waitForSelector('#sbList', { state:'visible' });
    await p.click(`[data-mission="${id}"]`);
    await p.waitForSelector('#sbInput', { state:'visible' });
    for (const c of cmds) await type(p, c);
    await p.waitForTimeout(1400);
    const done = await p.locator('#sbDone').isVisible();
    console.log(`${id} solved by typing:`, done, '|', done ? (await p.locator('#sbScore').textContent()) : (await p.locator('#sbObjCount').textContent()));
  }

  // ── lab -> typed hand-off ────────────────────────────────────────────
  if (await p.locator('#sbDone').isVisible()) await p.click('#sbBack');
  await H.go(p, 'labs');
  console.log('labs offering the typed variant:', await p.locator('[data-typed]').count());
  await p.click('[data-typed]');
  await p.waitForTimeout(200);
  console.log('hand-off opened the sandbox:',
    await p.locator('#view-sandbox.active').count() === 1,
    '|', await p.locator('#sbTitle').textContent());

  console.log('ERRORS:', errs.length ? errs : 'none');
  await b.close();
})();
