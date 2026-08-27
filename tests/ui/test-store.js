const H = require('../helpers');
const { chromium } = require('playwright');

/* Upgrading must not cost anyone their deck. Seed localStorage in the old shape
   — cards keyed by the content text itself — load the new build, and check the
   cards survived, kept their schedule, and did not duplicate. */
(async () => {
  const b = await chromium.launch(H.launchOptions());
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  // land on the origin so localStorage is writable, then seed the v1 shape
  await p.goto(H.URL, { waitUntil: 'networkidle' });
  await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('lx.cards', JSON.stringify({
      'c:truncate': { front: 'What does `truncate` do?', back: 'Sets a file to a size.',
                      cat: 'disk', ivl: 6, ease: 2.65, due: '2026-09-02', reps: 4, lapses: 1 },
      'd:Walk me through what happens when a Linux box boots.':
                    { front: 'boot', back: 'firmware…', cat: 'sys',
                      ivl: 3, ease: 2.5, due: '2026-08-30', reps: 2, lapses: 0 },
      's:A user cannot access a file': { front: 'x', back: 'y', cat: 'perms',
                      ivl: 1, ease: 2.3, due: '2026-08-28', reps: 1, lapses: 2 }
    }));
    localStorage.setItem('lx.saved', JSON.stringify(['c:truncate', 'd:Walk me through what happens when a Linux box boots.']));
    localStorage.setItem('lx.streak', JSON.stringify({ last: '2026-08-26', days: 9 }));
    localStorage.setItem('lx.stats', JSON.stringify({ taken: 40, correct: 31 }));
    // deliberately no lx.schema — that is what a pre-versioning install looks like
  });
  await p.reload({ waitUntil: 'networkidle' });

  const after = await p.evaluate(() => ({
    schema: JSON.parse(localStorage.getItem('lx.schema')),
    migrated: window.LXStore.migrated,
    cards: JSON.parse(localStorage.getItem('lx.cards')),
    saved: JSON.parse(localStorage.getItem('lx.saved')),
    streak: JSON.parse(localStorage.getItem('lx.streak')),
    stats: JSON.parse(localStorage.getItem('lx.stats'))
  }));
  const ids = Object.keys(after.cards);
  console.log('schema after load:', after.schema, '| migrations run:', JSON.stringify(after.migrated));
  console.log('cards kept:', ids.length, '(was 3)');
  console.log('no content-keyed ids left:', !ids.some(i => i.indexOf('~') === -1));
  console.log('ids now:', ids.map(i => i.slice(0, 34)).join('\n           '));

  const trunc = after.cards[ids.find(i => i.startsWith('c:truncate'))];
  console.log('schedule survived:', JSON.stringify({ ivl: trunc.ivl, ease: trunc.ease, due: trunc.due, reps: trunc.reps }));
  console.log('source text remembered:', JSON.stringify(trunc.src));
  console.log('streak survived:', JSON.stringify(after.streak), '| stats:', JSON.stringify(after.stats));
  console.log('starred ids remapped:', after.saved.every(s => s.indexOf('~') !== -1), after.saved.length + ' of 2');

  // running again must change nothing
  await p.reload({ waitUntil: 'networkidle' });
  const twice = await p.evaluate(() => ({
    n: Object.keys(JSON.parse(localStorage.getItem('lx.cards'))).length,
    ran: window.LXStore.migrated.ran
  }));
  console.log('idempotent — cards still', twice.n, '| migrations re-run:', JSON.stringify(twice.ran));

  // the star still lights up, which proves the id space is shared with the UI
  await H.go(p, 'review');
  const tiles = await p.locator('#revStreak .stat-tile .stat-n').allTextContents();
  console.log('review tiles [streak, due, deck, accuracy]:', JSON.stringify(tiles));
  await H.go(p, 'commands');
  await p.fill('#search', 'truncate');
  await p.waitForTimeout(200);
  console.log('starred command shows as starred:',
    await p.locator('#cmdList .star.on').count() > 0);

  // export / import round-trip
  const exported = await p.evaluate(() => window.LXStore.exportAll());
  console.log('\nexport is valid JSON:', (() => { try { JSON.parse(exported); return true; } catch (e) { return false; } })(),
    '|', Object.keys(JSON.parse(exported).data).length, 'keys,', exported.length, 'bytes');
  const round = await p.evaluate((text) => {
    localStorage.clear();
    const r = window.LXStore.importAll(text);
    return { r: r, cards: Object.keys(JSON.parse(localStorage.getItem('lx.cards') || '{}')).length,
             streak: JSON.parse(localStorage.getItem('lx.streak') || 'null') };
  }, exported);
  console.log('import restored:', JSON.stringify(round.r), '| cards:', round.cards, '| streak:', JSON.stringify(round.streak));

  const junk = await p.evaluate(() => window.LXStore.importAll('{"nope":1}'));
  console.log('import rejects a foreign file:', JSON.stringify(junk));

  // a fresh install must not think it needs migrating
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  console.log('fresh install:', JSON.stringify(await p.evaluate(() => window.LXStore.migrated)));

  console.log('ERRORS:', errs.length ? errs : 'none');
  await b.close();
})();
