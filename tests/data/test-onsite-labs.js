/* The onsite incident labs, played through several paths each:

   - the lab's own reveal ladder solves it (in any mode — modes are UI only)
   - reasonable alternative fixes also complete it
   - wrong fixes, verifying before fixing, and typing the expected text leave
     the fix/verify objectives unmet
   - independent-mode ticket text does not give away the root cause
   - a fresh world from the seed is the original state (what /reset relies on)

   Waiting is modelled as running read-only commands, because the model's
   clock only moves when a command runs. */
const H = require('../helpers');
H.loadContent({ shell: true });
const K = global.LXK8s;

let fails = 0, passes = 0;
function ok(cond, label, detail) {
  if (cond) { passes++; return; }
  fails++;
  console.log('FAIL ' + label + (detail ? '\n  ' + String(detail).split('\n').slice(0, 14).join('\n  ') : ''));
}

const LABS = LX.missions.filter(m => m.track === 'onsite');
function lab(id) { return LABS.filter(m => m.id === id)[0]; }

function session(m) {
  const w = LXShell.createWorld(m.world);
  const c = { w: w, ran: [], out: [], code: [], last: null };
  const met = {};
  const s = {
    c: c, w: w, met: met, m: w.k8sModel,
    run: function (cmd) {
      const r = LXShell.run(w, cmd);
      c.ran.push(cmd); c.out.push((r.out || '') + (r.err || '')); c.code.push(r.code || 0);
      c.last = { cmd: cmd, out: c.out[c.out.length - 1] };
      m.objectives.forEach(function (o) {
        if (met[o.id]) return;
        let p = false;
        try { p = !!o.done(c); } catch (e) { console.log('   ' + m.id + '/' + o.id + ' threw: ' + e.message); }
        if (p) met[o.id] = c.ran.length;
      });
      return c.last.out;
    },
    wait: function (n) { for (let i = 0; i < (n || 1); i++) s.run('kubectl get pods'); },
    script: function (cmds) { cmds.forEach(function (x) { s.run(typeof x === 'function' ? x(c, s) : x); }); return s; },
    unmet: function () { return m.objectives.filter(o => !met[o.id]).map(o => o.id); },
    podOf: function (app, pred) {
      const ps = s.m.pods.filter(p => (p.labels || {}).app === app);
      return ((pred ? ps.filter(pred)[0] : null) || ps[0] || {}).name;
    }
  };
  return s;
}
function reveal(o, c) { return typeof o.reveal === 'function' ? o.reveal(c) : o.reveal; }

/* the reveal ladder, as a learner pressing "Show one" would use it */
function solveByReveals(m) {
  const s = session(m);
  let guard = 0;
  while (guard++ < 90) {
    const o = m.objectives.filter(x => !s.met[x.id])[0];
    if (!o) break;
    let cmd = reveal(o, s.c);
    s.run(cmd);
    for (let i = 0; i < 40 && !s.met[o.id]; i++) {
      const next = reveal(o, s.c);
      if (o.stage !== 'fix' || next !== cmd) { if (o.stage !== 'fix') s.wait(1); s.run(next); cmd = next; }
      else s.wait(1);
    }
    if (!s.met[o.id]) break;
  }
  return s;
}

/* ── every lab: schema, spoilers, reveal path, reset ─────────────── */
LABS.forEach(function (m) {
  const o = m.onsite || {};
  ok(m.objectives.length >= 5, m.id + ': at least five objectives');
  ['evidence', 'fix', 'verify'].forEach(function (st) {
    ok(m.objectives.some(x => x.stage === st), m.id + ': has a ' + st + ' objective');
  });
  ok(m.objectives.every(x => x.hint && x.reveal), m.id + ': every objective has a conceptual hint and an explicit reveal');
  ok(m.objectives.filter(x => x.hint2).length >= 2, m.id + ': diagnostic hints on at least two objectives');
  ['neutralTitle', 'neutralBrief', 'impact', 'changes', 'mechanism', 'summaryPrompt'].forEach(function (f) {
    ok(typeof o[f] === 'string' && o[f].length > 20, m.id + ': onsite.' + f + ' present');
  });
  ['assumptions', 'clues', 'alternatives', 'summaryChecklist', 'prereqs', 'questions', 'refs', 'simplified', 'palette', 'spoilers'].forEach(function (f) {
    ok(Array.isArray(o[f]) && o[f].length > 0, m.id + ': onsite.' + f + ' present');
  });
  (o.refs || []).forEach(function (r) {
    ok(/^https:\/\/(kubernetes\.io|kind\.sigs\.k8s\.io)\//.test(r.u), m.id + ': reference on an official domain: ' + r.u);
  });
  const neutral = (o.neutralTitle + ' ' + o.neutralBrief).toLowerCase();
  (o.spoilers || []).forEach(function (w) {
    ok(neutral.indexOf(w.toLowerCase()) === -1, m.id + ': independent ticket does not reveal "' + w + '"', o.neutralTitle + ' — ' + o.neutralBrief);
  });

  const s = solveByReveals(m);
  ok(s.unmet().length === 0, m.id + ': solvable by its own reveal ladder', 'unmet: ' + s.unmet() + '\nlast: ' + (s.c.last && s.c.last.cmd) + '\n' + (s.c.last && s.c.last.out));
  ok(s.m.risky.length === 0, m.id + ': reveal path logs no risky actions', JSON.stringify(s.m.risky));

  /* verifying first proves nothing */
  const v = session(m);
  m.objectives.filter(x => x.stage === 'verify').forEach(function (x) { v.run(reveal(x, v.c)); v.wait(2); v.run(reveal(x, v.c)); });
  ok(m.objectives.filter(x => x.stage !== 'evidence').every(x => !v.met[x.id]), m.id + ': verifying before fixing meets no fix/verify objective', 'met: ' + Object.keys(v.met));

  /* typing what success looks like changes nothing */
  const t = session(m);
  t.script(['echo "successfully rolled out 3/3 Running Bound sync ok orders ok"', 'echo "deployment.apps/x patched"']);
  ok(Object.keys(t.met).length === 0, m.id + ': typed success text meets nothing', Object.keys(t.met));

  /* reset rebuilds the exact starting state */
  const a = LXShell.createWorld(m.world), b = LXShell.createWorld(m.world);
  ok(JSON.stringify(a.k8sModel) === JSON.stringify(b.k8sModel), m.id + ': a fresh world equals the seed state');
  ok(JSON.stringify(s.w.k8sModel) !== JSON.stringify(a.k8sModel), m.id + ': a played world differs from the seed (reset has work to do)');
});

/* ── alternate valid paths and wrong fixes, per lab ─────────────── */
function met(s, id) { return !!s.met[id]; }

(function lab01() {
  const m = lab('ons-lab-01');
  const w = session(m).script(['kubectl delete pod catalog-debug', 'kubectl get pods']);
  ok(!met(w, 'demo') && !w.m.pods.some(p => p.name === 'catalog-debug'), 'lab01: deleting the bare pod is not the demonstration, and it never returns');
  const a = session(m).script([(c, S) => 'kubectl delete pod ' + S.podOf('catalog'), 'kubectl get pods -l app=catalog']);
  a.wait(1); a.run('kubectl get pods -l app=catalog');
  ok(met(a, 'demo') && met(a, 'verify'), 'lab01: verification by pod list works as well as by Deployment', a.unmet());
  const many = session(m).script(['kubectl delete pods -l app=catalog']);
  ok(many.m.risky.length > 0, 'lab01: deleting every catalog pod at once is logged as risky');
})();

(function lab02() {
  const m = lab('ons-lab-02');
  const f = session(m).script(['kubectl patch serviceaccount default -p \'{"imagePullSecrets":[{"name":"secure-pull"}]}\'',
    'kubectl rollout restart deploy/payments-api']);
  f.wait(4); f.run('kubectl rollout status deploy/payments-api');
  ok(met(f, 'repair') && met(f, 'verify') && K.find(f.m, 'deployments', 'payments-api').template.containers[0].image.indexOf('2.8.0') !== -1,
    'lab02: fix forward via the ServiceAccount + restart completes on 2.8.0', f.unmet() + '\n' + f.c.last.out);
  const g = session(m).script(['kubectl patch deploy payments-api -p \'{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"secure-pull"}]}}}}\'']);
  g.wait(4); g.run('kubectl rollout status deploy/payments-api');
  ok(met(g, 'repair'), 'lab02: fix forward via the pod template completes', g.unmet());
  const x = session(m).script(['kubectl patch serviceaccount default -p \'{"imagePullSecrets":[{"name":"secure-pull"}]}\'']);
  x.wait(6);
  ok(!met(x, 'repair'), 'lab02: patching the ServiceAccount alone does not fix the already-created pod', x.unmet());
  const d = session(m).script(['kubectl delete deployment payments-api']);
  ok(d.m.risky.length > 0 && !met(d, 'repair'), 'lab02: deleting the Deployment is risky and not a repair');
})();

(function lab03() {
  const m = lab('ons-lab-03');
  const r = session(m);
  r.m.pods.slice().forEach(p => r.run('kubectl label pod ' + p.name + ' track=stable'));
  r.run('kubectl get endpoints orders');
  ok(/10\.244/.test(r.c.last.out) && !met(r, 'durable'), 'lab03: relabelling pods restores traffic but is not the durable fix', r.c.last.out);
  const t = session(m).script(['kubectl patch deploy orders-api -p \'{"spec":{"template":{"metadata":{"labels":{"track":"stable"}}}}}\'']);
  t.wait(4); t.run('kubectl exec deploy/orders-api -- curl -s http://orders/');
  ok(met(t, 'durable') && met(t, 'verify'), 'lab03: adding the label to the pod template is a valid durable fix', t.unmet() + '\n' + t.c.last.out);
  const n = session(m).script(['kubectl exec deploy/orders-api -- nslookup orders']);
  ok(met(n, 'dns') && !met(n, 'durable'), 'lab03: DNS evidence alone fixes nothing');
})();

(function lab04() {
  const m = lab('ons-lab-04');
  const d = session(m).script(['kubectl patch deploy search-indexer -p \'{"spec":{"template":{"spec":{"containers":[{"name":"indexer","livenessProbe":{"initialDelaySeconds":90}}]}}}}\'']);
  d.wait(12);
  ok(met(d, 'livefix'), 'lab04: a longer liveness delay is an accepted alternative', d.unmet());
  const x = session(m).script(['kubectl patch deploy search-indexer -p \'{"spec":{"template":{"spec":{"containers":[{"name":"indexer","livenessProbe":null}]}}}}\'']);
  x.wait(12);
  ok(!met(x, 'livefix'), 'lab04: deleting the liveness probe does not count as a fix', x.unmet());
  const r = session(m).script(['kubectl rollout restart deploy/search-api']);
  r.wait(4);
  ok(!met(r, 'readyfix'), 'lab04: restarting search-api does not fix readiness');
  const p = session(m).script(['kubectl patch deploy search-api -p \'{"spec":{"template":{"spec":{"containers":[{"name":"api","readinessProbe":null}]}}}}\'']);
  p.wait(4);
  ok(!met(p, 'readyfix'), 'lab04: removing the readiness probe does not count as a fix', p.unmet());
})();

(function lab05() {
  const m = lab('ons-lab-05');
  const u = session(m).script(['kubectl uncordon node-b']);
  u.wait(3);
  ok(!met(u, 'fix') && u.m.risky.length > 0, 'lab05: uncordoning node-b does not fit 12Gi and is logged as risky', JSON.stringify(u.m.risky));
  const t = session(m).script(['kubectl patch deploy report-builder -p \'{"spec":{"template":{"spec":{"tolerations":[{"key":"gpu","operator":"Exists"}],"nodeSelector":null}}}}\'']);
  t.wait(3);
  ok(!met(t, 'fix'), 'lab05: tolerating the GPU taint does not fix it');
  const g = session(m).script(['kubectl set resources deploy report-builder --requests=memory=1200Mi']);
  g.wait(3); g.run('kubectl rollout status deploy/report-builder');
  ok(met(g, 'fix') && met(g, 'verify'), 'lab05: any request that fits is accepted', g.unmet() + '\n' + g.c.last.out);
})();

(function lab06() {
  const m = lab('ons-lab-06');
  const u = session(m).script(['kubectl rollout undo deploy/notify-api']);
  u.wait(4); u.run('kubectl rollout status deploy/notify-api');
  ok(met(u, 'healthy') && met(u, 'verify'), 'lab06: rolling back is an accepted path', u.unmet() + '\n' + u.c.last.out);
  const p = session(m).script(['kubectl patch deploy notify-api -p \'{"spec":{"template":{"spec":{"containers":[{"name":"api","envFrom":[{"configMapRef":{"name":"notify-config"}}]}]}}}}\'']);
  p.wait(4); p.run('kubectl rollout status deploy/notify-api');
  ok(met(p, 'healthy'), 'lab06: pointing 3.0 at the existing ConfigMap is an accepted fix', p.unmet());
  const r = session(m).script(['kubectl rollout restart deploy/notify-api']);
  r.wait(6);
  ok(!met(r, 'healthy'), 'lab06: a restart without the configuration stays broken');
  const q = session(m).script([(c, S) => 'kubectl delete pod ' + S.podOf('notify-api', p => p.containers[0].restarts > 0)]);
  ok(q.m.risky.some(x => /previous-container logs/.test(x.why)), 'lab06: deleting a crashing pod is logged for discarding its evidence', JSON.stringify(q.m.risky));
})();

(function lab07() {
  const m = lab('ons-lab-07');
  const d = session(m).script(['kubectl set resources deploy transcoder --limits=memory=1Gi']);
  d.wait(12);
  ok(!met(d, 'probefix'), 'lab07: more memory for transcoder does not stop its kills', d.unmet());
  const b = session(m).script(['kubectl set resources deploy thumbnailer --limits=memory=600Mi']);
  b.wait(10);
  ok(!met(b, 'memfix'), 'lab07: a limit still below use keeps OOM-killing', b.unmet());
  const l = session(m).script(['kubectl patch deploy transcoder -p \'{"spec":{"template":{"spec":{"containers":[{"name":"transcoder","livenessProbe":{"initialDelaySeconds":90}}]}}}}\'']);
  l.wait(14);
  ok(met(l, 'probefix'), 'lab07: delaying liveness is an accepted alternative for transcoder', l.unmet());
})();

(function lab08() {
  const m = lab('ons-lab-08');
  const i = session(m).script(['kubectl patch pvc ledger-data -p \'{"spec":{"storageClassName":"standard"}}\'']);
  ok(/immutable|Forbidden/.test(i.c.last.out) && !met(i, 'bound'), 'lab08: editing the claim in place is refused', i.c.last.out);
  const x = session(m).script(['kubectl delete pvc ledger-scratch', 'sed -i \'s/fast-ssd/standard/\' ledger/pvc.yaml',
    'kubectl delete pvc ledger-data', 'kubectl apply -f ledger/pvc.yaml']);
  x.wait(3);
  ok(!met(x, 'bound'), 'lab08: deleting ledger-scratch (not yours) keeps the fix objective unmet');
  const r = session(m).script(['sed -i \'s/fast-ssd/retained/\' ledger/pvc.yaml', 'kubectl delete pvc ledger-data', 'kubectl apply -f ledger/pvc.yaml']);
  r.wait(3); r.run('kubectl get pvc');
  ok(met(r, 'bound') && met(r, 'verify'), 'lab08: any class that exists is accepted', r.unmet());
  const a = session(m).script(['kubectl apply -f ledger/pvc.yaml']);
  ok(!met(a, 'bound'), 'lab08: re-applying the unchanged manifest does nothing', a.c.last.out);
})();

(function lab09() {
  const m = lab('ons-lab-09');
  const w = session(m).script(['kubectl create clusterrolebinding stock-sync-admin --clusterrole=cluster-admin --serviceaccount=inventory:stock-sync']);
  w.wait(4);
  ok(!met(w, 'least') && w.m.risky.length > 0, 'lab09: cluster-admin works technically but fails least privilege and is logged', w.unmet());
  const e = session(m).script(['kubectl create rolebinding stock-sync-edit --clusterrole=edit --serviceaccount=inventory:stock-sync']);
  ok(!met(e, 'least'), 'lab09: binding edit over-grants and is not accepted');
  const p = session(m).script(['kubectl patch rolebinding stock-sync-read -p \'{"subjects":[{"kind":"ServiceAccount","name":"stock-sync","namespace":"inventory"}]}\'']);
  p.wait(4); p.run('kubectl logs deploy/stock-sync');
  ok(met(p, 'least') && met(p, 'verify'), 'lab09: fixing the subject in place is an accepted path', p.unmet() + '\n' + p.c.last.out);
  const r = session(m).script(['kubectl patch rolebinding stock-sync-read -p \'{"roleRef":{"kind":"ClusterRole","name":"view"}}\'']);
  ok(r.c.code[0] !== 0, 'lab09: roleRef cannot be changed', r.c.last.out);
})();

(function lab10() {
  const m = lab('ons-lab-10');
  const u = session(m).script(['lab-registry import metrics-sidecar-1.3-portal.tar', (c, S) => 'kubectl delete pod ' + S.podOf('edge-gateway', p => !K.podReady(p))]);
  u.wait(4);
  ok(!met(u, 'import') && u.m.risky.some(x => /had not been verified/.test(x.why)), 'lab10: importing an unverified bundle is logged and does not complete the release', u.unmet());
  const rs = u.run('kubectl get events');
  ok(/FailedCreate|denied the request/.test(rs), 'lab10: the untrusted image is refused at admission', rs);
  const g = session(m).script(['lab-registry verify metrics-sidecar-1.3-portal.tar', 'lab-registry verify release-4.2-supplement.tar',
    'lab-registry import release-4.2-supplement.tar', (c, S) => 'kubectl delete pod ' + S.podOf('edge-gateway', p => !K.podReady(p))]);
  g.wait(3); g.run('kubectl rollout status deploy/edge-gateway');
  ok(met(g, 'trust') && met(g, 'import') && met(g, 'verify') && g.m.risky.length === 0, 'lab10: verify, import the trusted bundle, retry the pod', g.unmet() + '\n' + JSON.stringify(g.m.risky));
  const b = session(m).script(['kubectl get pods']);
  const dbg = b.run('kubectl describe pod net-debug');
  ok(/no such host/.test(dbg), 'lab10: the unrelated debug pod shows a different error (no such host)', dbg);
})();

console.log((fails ? fails + ' failed, ' : '') + passes + ' onsite lab checks passed');
process.exit(fails ? 1 : 0);
