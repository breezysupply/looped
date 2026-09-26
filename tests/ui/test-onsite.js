const H = require('../helpers');
const { chromium } = require('playwright');

/* The onsite track end to end in a browser: the Prep hub is scoped to its
   track, every section renders without overflow on a phone and a tablet,
   self-assessment persists, the mock runs start to finish, and the incident
   labs keep their promises — a simulation banner, a mode choice, an
   independent mode that hides the cause, reset, a wrong fix that stays
   incomplete, and a qualitative debrief with no score. */
(async () => {
  const b = await chromium.launch(H.launchOptions());
  let fails = 0, passes = 0;
  const ok = (c, m, d) => { if (c) passes++; else { fails++; console.log('FAIL ' + m + (d ? '\n  ' + String(d).slice(0, 600) : '')); } };

  for (const W of [390, 834]) {
    const p = await (await b.newContext({ viewport: { width: W, height: 900 } })).newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await p.goto(H.URL, { waitUntil: 'networkidle' });
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const segs = () => p.$$eval('#subnav .seg', xs => xs.map(x => x.textContent));
    const ls = () => p.evaluate(() => JSON.parse(localStorage.getItem('lx.onsite') || '{}'));

    /* ── scoping ── */
    ok((await segs()).indexOf('Prep') === -1, W + ': no Prep page on the Linux track', await segs());
    await p.click('#trackBtn'); await p.click('.track-row[data-track="onsite"]');
    await p.waitForFunction(() => window.LX && LX.onsiteQ && LX.onsiteQ.length >= 60 && document.querySelector('#view-prep .prep-nav'));
    const s1 = await segs();
    ok(s1[0] === 'Prep' && s1.indexOf('Commands') === -1 && s1.indexOf('Playbooks') === -1 && s1.indexOf('Drills') !== -1,
       W + ': onsite Learn shows Prep and Drills, not empty pages', s1);
    ok(await p.$eval('#view-prep', el => el.classList.contains('active')), W + ': arriving on the track lands on Prep');

    /* ── every section renders, fits, and has something in it ── */
    const sections = await p.$$eval('[data-prep-section]', xs => xs.map(x => x.dataset.prepSection).filter((v, i, a) => a.indexOf(v) === i));
    ok(sections.length === 11, W + ': eleven Prep sections', sections);
    for (const s of sections) {
      await p.click('.prep-nav [data-prep-section="' + s + '"]');
      const len = await p.$eval('#prepBody', el => el.textContent.trim().length);
      ok(len > 150, W + ': section ' + s + ' has content', len);
      ok(await overflow() <= 0, W + ': section ' + s + ' has no horizontal overflow', await overflow());
    }

    /* ── lessons: open from the path, mark studied, count it ── */
    await p.click('.prep-nav [data-prep-section="path"]');
    await p.click('.path-item[data-prep-open="lesson:les-reconcile"]');
    ok(await p.$eval('#prepBody', el => /reconciliation/i.test(el.querySelector('.prep-h').textContent)), W + ': path item opens its lesson');
    ok(await p.$('#prepBody figure.diagram svg[role="img"]') !== null, W + ': lesson diagram rendered with role=img');
    ok(await overflow() <= 0, W + ': lesson has no overflow', await overflow());
    await p.click('[data-prep-studied="les-reconcile"]');
    ok(!!(await ls()).lessons['les-reconcile'], W + ': studied mark persists');

    /* ── a question: answer first, reveal, follow-up, rate ── */
    await p.evaluate(() => LXOnsite.open('question', 'ons-q-net-04'));
    ok(await p.$('[data-prep-reveal]') !== null && !(await p.$eval('#prepBody', el => /A concise spoken answer/.test(el.textContent))), W + ': answer hidden until requested');
    await p.fill('#prepOwn', 'Resolve the name first, then connect to the Service IP, then the pod IP directly, then read the app response.');
    await p.click('[data-prep-reveal]');
    ok(await p.$eval('#prepBody', el => /A concise spoken answer/.test(el.textContent)), W + ': reveal shows the model answer');
    let q = (await ls()).questions['ons-q-net-04'];
    ok(q && q.answeredFirst === true, W + ': writing before revealing counts as answered first', JSON.stringify(q));
    const fu1 = await p.$$eval('.followup', xs => xs.length);
    await p.click('[data-prep-fu]');
    ok(await p.$$eval('.followup', xs => xs.length) === fu1 + 1, W + ': follow-ups appear one at a time');
    await p.click('[data-prep-rate="q:ons-q-net-04:evidence"]');
    await p.click('[data-prep-rate="q:ons-q-net-04:sound"]');
    q = (await ls()).questions['ons-q-net-04'];
    ok(q.ratings.join() === 'evidence,sound', W + ': self-ratings persist', JSON.stringify(q));
    ok(await overflow() <= 0, W + ': question view has no overflow', await overflow());
    await p.evaluate(() => LXOnsite.open('question', 'ons-q-arch-02'));
    await p.click('[data-prep-reveal]');
    ok((await ls()).questions['ons-q-arch-02'].answeredFirst === false, W + ': revealing with nothing written is not "answered first"');

    /* ── notes adjust priorities; nothing invents a date ── */
    await p.click('.prep-nav [data-prep-section="path"]');
    ok(await p.$eval('#prepBody', el => /No interview date entered/.test(el.textContent)), W + ': no date is invented');
    await p.click('.prep-nav [data-prep-section="notes"]');
    await p.fill('#prepDate', '2026-10-08');
    await p.fill('#prepRecruiter', 'Recruiter: one design session, one troubleshooting session.');
    await p.selectOption('#fmt-design', 'confirmed');
    await p.click('[data-prep-notessave]');
    const n = await ls();
    ok(n.date === '2026-10-08' && /design session/.test(n.recruiter) && n.formats.design === 'confirmed', W + ': notes persist', JSON.stringify(n));
    await p.click('.prep-nav [data-prep-section="path"]');
    ok(await p.$eval('#prepBody', el => /the date you entered \(2026-10-08/.test(el.textContent) && /raised by your notes/.test(el.textContent)), W + ': path reflects the date and the confirmed format');

    /* ── progress: tiers are labelled, nothing is a score ── */
    await p.click('.prep-nav [data-prep-section="progress"]');
    const prog = await p.$eval('#prepBody', el => el.textContent);
    ok(/Studied a concept\s*1 \/ 16/.test(prog) && /Answered independently\s*1 \/ 60/.test(prog), W + ': tiers count what was done', prog.slice(0, 500));
    ok(/Automatically verified real-lab check/.test(prog) && /Not available/.test(prog) && !/readiness score:|%/.test(prog), W + ': no machine-verified claim and no percentage score');

    /* ── mock: start, move through, finish, save ── */
    await p.click('.prep-nav [data-prep-section="mock"]');
    await p.click('[data-prep-mockstart="mock-15"]');
    ok(await p.$('#prepMockTimer') !== null, W + ': mock shows a timer');
    for (let i = 0; i < 4; i++) {
      if (i === 0) { await p.click('[data-prep-mockhint]'); await p.click('[data-prep-mockfu]'); await p.click('[data-prep-mockshow]'); await p.click('[data-prep-rate="m:0:mechanism"]'); }
      await p.click('[data-prep-mocknext]');
    }
    await p.click('[data-prep-mockend]');
    ok(await p.$eval('#prepBody', el => /Self-assessed/.test(el.textContent) && /Incorrect mechanism/.test(el.textContent)), W + ': mock summary lists the self-ratings');
    await p.fill('#prepMockReflect', 'Say the evidence out loud before the conclusion.');
    await p.click('[data-prep-mocksave]');
    ok((await ls()).mocks.length === 1, W + ': mock session saved');

    /* ── sim lab: mode choice, independent hides the cause ── */
    await p.click('.prep-nav [data-prep-section="labs"]');
    await p.click('[data-prep-open="lab:ons-lab-03"]');
    await p.waitForSelector('#sbModePick:not([hidden])');
    ok(await p.$eval('#sbModePick', el => /Simulation/i.test(el.textContent)), W + ': mode picker carries the simulation label');
    await p.click('[data-sb-mode="independent"]');
    const title = await p.$eval('#sbTitle', el => el.textContent);
    const brief = await p.$eval('#sbBrief', el => el.textContent);
    ok(!/selector|label|endpoint/i.test(title + brief), W + ': independent ticket does not reveal the cause', title + ' / ' + brief);
    ok(await p.$eval('#sbSimBanner', el => !el.hidden && /Simulation/i.test(el.textContent)), W + ': simulation banner visible in the lab');
    const objs = await p.$eval('#sbObjectives', el => el.textContent);
    ok(/hidden until met/.test(objs) && !/selector/i.test(objs), W + ': objectives hidden in independent mode', objs);
    const run = async (cmd) => { await p.fill('#sbInput', cmd); await p.press('#sbInput', 'Enter'); };
    await run('kubectl port-forward svc/orders 8080:80');
    ok(await p.$eval('#sbTerm', el => /not supported in this simulation/.test(el.textContent)), W + ': unsupported command answered honestly');
    await run('kubectl get endpoints orders');
    ok(await p.$eval('#sbObjCount', el => /^1 \//.test(el.textContent)), W + ': evidence objective met by a real read', await p.$eval('#sbObjCount', el => el.textContent));
    ok(await overflow() <= 0, W + ': lab has no horizontal overflow', await overflow());
    await p.click('#sbReset');
    ok(await p.$eval('#sbObjCount', el => /^0 \//.test(el.textContent)) && await p.$eval('#sbTerm', el => /reset/.test(el.textContent)), W + ': reset clears objectives and state');

    /* a wrong fix: relabel the pods — traffic returns but the fix objective stays open */
    await run('kubectl get pods');
    const names = await p.$eval('#sbTerm', el => (el.textContent.match(/orders-api-[a-z0-9]+-[a-z0-9]{5}/g) || []).filter((v, i, a) => a.indexOf(v) === i));
    for (const nm of names) await run('kubectl label pod ' + nm + ' track=stable');
    await run('kubectl exec deploy/orders-api -- curl -s http://orders/');
    ok(await p.$eval('#sbTerm', el => /orders ok/.test(el.textContent)), W + ': relabelled pods do serve traffic');
    ok(await p.$eval('#sbObjCount', el => !/^5 \/ 5/.test(el.textContent)), W + ': but the durable-fix objective stays unmet');

    /* guided mode, solved properly, ends in a qualitative debrief */
    await p.click('#sbExit');
    await p.evaluate(() => LXSandbox.open('ons-lab-03', { mode: 'guided' }));
    ok(await p.$eval('#sbTitle', el => /Service/.test(el.textContent)), W + ': guided mode shows the named ticket');
    for (const c of ['kubectl get endpoints orders', 'kubectl exec deploy/orders-api -- nslookup orders', 'kubectl describe svc orders',
                     'kubectl get pods --show-labels', 'kubectl patch svc orders --type=merge -p \'{"spec":{"selector":{"track":null}}}\'',
                     'kubectl exec deploy/orders-api -- curl -s http://orders/']) await run(c);
    await p.waitForSelector('#sbDone:not([hidden])', { timeout: 5000 });
    const deb = await p.$eval('#sbDone', el => el.textContent);
    ok(/Guided simulation complete/.test(deb) && /no score/.test(deb) && /Evidence before change/.test(deb) && /not that you have done it on a production cluster/.test(deb),
       W + ': debrief is qualitative and honest', deb.slice(0, 400));
    ok(!/\b\d+\s*%|\bscore:\s*\d/i.test(deb), W + ': debrief shows no numeric score');
    const sb = await p.evaluate(() => JSON.parse(localStorage.getItem('lx.sandbox') || '{}')['ons-lab-03']);
    ok(sb && sb.modes && sb.modes.guided && sb.modes.guided.unaided === true && !sb.modes.independent, W + ': guided evidence recorded separately', JSON.stringify(sb));
    await p.fill('#sbSummary', 'The name resolved but the Service had no endpoints: its selector required track=stable. I removed that key and verified by name.');
    await p.click('[data-sum-check="0"]');
    await p.click('#sbSummarySave');
    ok(/track=stable/.test(((await ls()).summaries || {})['ons-lab-03'].text), W + ': spoken-summary exercise saved');
    ok(await overflow() <= 0, W + ': debrief has no overflow', await overflow());
    await p.click('#sbDone [data-prep-open^="lesson:"]');
    ok(await p.$eval('#view-prep', el => el.classList.contains('active')) && await p.$('#prepBody .prep-h') !== null, W + ': debrief links into Prep lessons');

    /* ── keyboard: the section chips are reachable and operable ── */
    await p.focus('.prep-nav [data-prep-section="stories"]');
    await p.keyboard.press('Enter');
    ok(await p.$eval('.prep-nav [data-prep-section="stories"]', el => el.getAttribute('aria-pressed') === 'true'), W + ': Enter activates a section chip');
    await p.focus('[data-prep-open^="story:"]');
    await p.keyboard.press('Enter');
    ok(await p.$eval('#prepBody', el => /Details you must supply/.test(el.textContent)), W + ': a story opens from the keyboard');

    /* ── leaving the track removes Prep ── */
    await p.click('#trackBtn'); await p.click('.track-row[data-track="linux"]');
    await p.waitForTimeout(100);
    const s2 = await segs();
    ok(s2.indexOf('Prep') === -1 && s2.indexOf('Commands') !== -1, W + ': Prep disappears on another track', s2);
    ok(!(await p.$eval('#view-prep', el => el.classList.contains('active'))), W + ': another track does not stay on Prep');

    ok(errs.length === 0, W + ': no page errors', errs.join('\n'));
    await p.context().close();
  }
  await b.close();
  console.log((fails ? fails + ' failed, ' : '') + passes + ' onsite UI checks passed');
  process.exit(fails ? 1 : 0);
})();
