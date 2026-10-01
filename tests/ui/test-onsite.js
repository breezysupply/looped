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
    ok(sections.length === 15, W + ': fifteen Prep sections', sections);
    for (const s of sections) {
      await p.click('.prep-nav [data-prep-section="' + s + '"]');
      const len = await p.$eval('#prepBody', el => el.textContent.trim().length);
      ok(len > 150, W + ': section ' + s + ' has content', len);
      ok(await overflow() <= 0, W + ': section ' + s + ' has no horizontal overflow', await overflow());
    }

    /* ── the path defaults to Fundamentals, from the team's note ── */
    await p.click('.prep-nav [data-prep-section="path"]');
    ok(await p.$eval('[data-prep-path="fundamentals"]', el => el.getAttribute('aria-pressed') === 'true'), W + ': Fundamentals is the default path');
    ok(await p.$$eval('.path-item[data-prep-open^="hands:"]', xs => xs.length) >= 9, W + ': Fundamentals links every hands-on scenario');
    await p.click('[data-prep-path="day"]');
    const slots = await p.$$eval('.path-card .time-slot', xs => xs.map(x => x.textContent));
    ok(slots.length === 5 && /EDT/.test(slots[0]) && await p.$eval('#prepBody', el => /confirm the local time/.test(el.textContent)), W + ': Onsite day shows five timed loops and the time-zone note', slots);
    ok(await overflow() <= 0, W + ': Onsite day has no overflow', await overflow());
    await p.click('[data-prep-path="fundamentals"]');

    /* ── hands-on: hint, reveal, done, report, environment notes ── */
    await p.click('.path-item[data-prep-open="hands:ons-hands-05"]');
    ok(await p.$eval('#prepBody', el => /Expose it outside the cluster/.test(el.textContent) && /current-context/.test(el.textContent)), W + ': hands-on scenario opens with the context warning');
    ok(await p.$$eval('.hands-task pre', xs => xs.length) === 0, W + ': commands hidden until asked');
    await p.click('[data-prep-hhint="ons-hands-05:2"]');
    ok(await p.$eval('.hands-task:nth-child(3)', el => /Hint:/.test(el.textContent)), W + ': hint shown on request');
    await p.click('[data-prep-hshow="ons-hands-05:2"]');
    ok(await p.$eval('.hands-task:nth-child(3)', el => /NODE_PORT=/.test(el.textContent) && /Killercoda:/.test(el.textContent)), W + ': command and Killercoda note revealed');
    await p.click('[data-prep-henv="desktop"]');
    ok(await p.$eval('.hands-task:nth-child(3)', el => /Docker Desktop:/.test(el.textContent) && /localhost/.test(el.textContent)), W + ': switching environment swaps the note');
    await p.click('[data-prep-htask="ons-hands-05:0"]');
    await p.click('[data-prep-hstatus="ons-hands-05:checked"]');
    const hr = (await ls()).hands['ons-hands-05'];
    ok(hr && hr.tasks['0'] === true && hr.open['2'] === true && hr.status === 'checked' && hr.env === 'desktop', W + ': hands-on progress persists', JSON.stringify(hr));
    ok(await p.$('.copy-btn') !== null && await overflow() <= 0, W + ': copy buttons present and no overflow', await overflow());

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
    await p.selectOption('#fmt-kubernetes', 'confirmed');
    await p.click('[data-prep-notessave]');
    const n = await ls();
    ok(n.date === '2026-10-08' && /design session/.test(n.recruiter) && n.formats.kubernetes === 'confirmed', W + ': notes persist', JSON.stringify(n));
    await p.click('.prep-nav [data-prep-section="path"]');
    ok(await p.$eval('#prepBody', el => /the date you entered \(2026-10-08/.test(el.textContent) && /raised by your notes/.test(el.textContent)), W + ': path reflects the date and the confirmed format');

    /* ── progress: tiers are labelled, nothing is a score ── */
    await p.click('.prep-nav [data-prep-section="progress"]');
    const prog = await p.$eval('#prepBody', el => el.textContent);
    ok(/Studied a concept\s*1 \/ 17/.test(prog) && /Answered independently\s*1 \/ 60/.test(prog), W + ': tiers count what was done', prog.slice(0, 500));
    ok(/Reported a hands-on PASS check\s*1 \/ 11/.test(prog), W + ': hands-on PASS counted as self-reported', prog.slice(0, 900));
    ok(/Automatically verified real-lab check/.test(prog) && /Not available/.test(prog) && !/readiness score:|%/.test(prog), W + ': no machine-verified claim and no percentage score');

    /* ── design: the hour-long pacing and a walkthrough of your own system ── */
    await p.evaluate(() => LXOnsite.open('design', 'ons-design-stateful'));
    ok(await p.$eval('[data-prep-pace="60"]', el => el.getAttribute('aria-pressed') === 'true') && await p.$eval('#prepBody', el => /Clarify \(8 min\)/.test(el.textContent)), W + ': design defaults to the 60-minute pacing');
    await p.click('[data-prep-pace="45"]');
    ok(await p.$eval('#prepBody', el => /Requirements \(7 min\)/.test(el.textContent)), W + ': 45-minute pacing still available');
    await p.click('[data-prep-pace="60"]');
    await p.evaluate(() => LXOnsite.open('walk', 'ons-walk-bringup'));
    ok(await p.$eval('#prepBody', el => /Walk me through an infrastructure architecture/.test(el.textContent) && /stored only in this browser/.test(el.textContent)), W + ': walkthrough opens with the prompt and the local-only note');
    await p.fill('[data-prep-walk="ons-walk-bringup|0.1"]', 'I owned the readiness validation.');
    await p.click('[data-prep-walkrev="ons-walk-bringup"]');
    const wk = (await ls()).walks['ons-walk-bringup'];
    ok(wk && wk.reviewed && wk.fields['0.1'] === 'I owned the readiness validation.', W + ': walkthrough notes and rehearsal persist', JSON.stringify(wk));
    ok(await overflow() <= 0, W + ': walkthrough has no overflow', await overflow());

    /* ── interviewer-led case: ask, hypothesise, reveal, debrief ── */
    await p.evaluate(() => LXOnsite.open('case', 'ons-case-01'));
    ok(await p.$eval('#prepBody', el => /Interviewer:/.test(el.textContent) && !/The cause/.test(el.textContent)), W + ': case opens with the interviewer\'s symptom and no answer');
    await p.click('[data-prep-cctx="ons-case-01"]');
    const askIds = await p.$$eval('[data-prep-cask^="ons-case-01:"]', xs => xs.slice(0, 2).map(x => x.dataset.prepCask));
    for (const a of askIds) await p.click('[data-prep-cask="' + a + '"]');
    ok(await p.$$eval('#prepBody .followup pre', xs => xs.length) === 2, W + ': each ask reveals its evidence');
    await p.fill('#caseHyp', 'Leading hypothesis and how I would disprove it.');
    await p.click('[data-prep-creveal="ons-case-01"]');
    const cr = (await ls()).cases['ons-case-01'];
    ok(cr && cr.revealed && cr.asked.length === 2 && /Leading hypothesis/.test(cr.hyp), W + ': case progress persists', JSON.stringify(cr));
    ok(await p.$eval('#prepBody', el => /The cause/.test(el.textContent) && /Key evidence/.test(el.textContent) && /no score/.test(el.textContent)), W + ': debrief shows the cause and a qualitative scorecard');
    ok(await overflow() <= 0, W + ': case has no overflow', await overflow());
    await p.click('[data-prep-creset="ons-case-01"]');
    ok(!((await ls()).cases['ons-case-01'].revealed), W + ': a case can be worked again');

    /* ── System lab: design, map the failure points, linked incidents ── */
    await p.click('.prep-nav [data-prep-section="system"]');
    ok(await p.$eval('#prepBody', el => /not any company/.test(el.textContent) && /Part 1 · Architecture/i.test(el.textContent) && el.querySelector('figure.diagram svg') !== null), W + ': System lab shows both parts, the caveat and the reference architecture');
    ok(await p.$$eval('.sys-point', xs => xs.length) === 0, W + ': reference failure map hidden until asked');
    await p.fill('#sysMap', 'Database connections vs HPA max; payment provider slow; queue poison message.');
    await p.click('[data-prep-sreveal="ons-sys-orders"]');
    ok(await p.$$eval('.sys-point', xs => xs.length) >= 8, W + ': reference failure map revealed');
    const sy = (await ls()).systems['ons-sys-orders'];
    ok(sy && sy.mapRevealed && /HPA max/.test(sy.map), W + ': failure map and reveal persist', JSON.stringify(sy));
    ok(await overflow() <= 0, W + ': System lab has no overflow', await overflow());
    await p.click('[data-prep-open="design:ons-design-webapp"]');
    ok(await p.$eval('#prepBody', el => /order API/.test(el.textContent) && /Clarify \(8 min\)/.test(el.textContent)), W + ': part 1 opens the design with 60-minute pacing');
    await p.click('.prep-nav [data-prep-section="system"]');
    await p.click('[data-prep-open="case:ons-case-10"]');
    ok(await p.$('.case-system figure.diagram svg') !== null && await p.$eval('#prepBody', el => /The setup:/.test(el.textContent) && !/The cause/.test(el.textContent)), W + ': linked case shows the system and hides the cause');
    ok(await overflow() <= 0, W + ': linked case has no overflow', await overflow());

    /* ── conversation prep: fill, pick questions, mark ready ── */
    await p.click('.prep-nav [data-prep-section="path"]');
    await p.click('[data-prep-path="day"]');
    ok(await p.$('.path-item[data-prep-open="talk:talk-cofounder"]') !== null, W + ': Onsite day links the co-founder conversation prep');
    await p.click('.path-item[data-prep-open="talk:talk-cofounder"]');
    ok(await p.$eval('#prepBody', el => /Why this role, and why now/.test(el.textContent) && /reasonable guess/.test(el.textContent)), W + ': conversation prep opens with its prompts and the guess caveat');
    await p.fill('[data-prep-talk="talk-cofounder|1.0"]', 'Disconnected delivery is the work I know.');
    await p.check('[data-prep-tpick="talk-cofounder:0"]');
    await p.check('[data-prep-tpick="talk-cofounder:3"]');
    await p.click('[data-prep-talkready="talk-cofounder"]');
    const tk = (await ls()).talk['talk-cofounder'];
    ok(tk && tk.ready && tk.fields['1.0'] === 'Disconnected delivery is the work I know.' && tk.picked.sort().join() === '0,3', W + ': conversation notes, chosen questions and ready state persist', JSON.stringify(tk));
    ok(await p.$eval('[data-prep-tpick="talk-cofounder:3"]', el => el.checked) && await p.$eval('[data-prep-talk="talk-cofounder|1.0"]', el => /Disconnected/.test(el.value)), W + ': re-render keeps the choices');
    ok(await overflow() <= 0, W + ': conversation prep has no overflow', await overflow());
    await p.click('.prep-nav [data-prep-section="talk"]');
    ok(await p.$eval('#prepBody', el => /2 questions chosen/.test(el.textContent) && /✓ ready/.test(el.textContent)), W + ': Talk list shows chosen questions and ready state');
    await p.click('.prep-nav [data-prep-section="path"]');
    await p.click('[data-prep-path="fundamentals"]');

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
    await run('k get endpoints orders');
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
