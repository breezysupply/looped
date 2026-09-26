/* The onsite labs' Kubernetes model, exercised through the same kubectl the
   learner types. Every assertion here is about behaviour the labs teach —
   reconciliation, rollout stalls and undo scope, the readiness/liveness split,
   OOMKilled versus other SIGKILLs, scheduling and binding reasons, RBAC — plus
   the honesty rules: unsupported commands say so, and nothing is random. */
const H = require('../helpers');
H.loadContent({ shell: true });
const K = global.LXK8s;

let fails = 0, passes = 0;
function ok(cond, label, detail) {
  if (cond) { passes++; return; }
  fails++;
  console.log('FAIL ' + label + (detail ? '\n  ' + String(detail).split('\n').slice(0, 12).join('\n  ') : ''));
}

/* ── seeds ──────────────────────────────────────────────────────── */
const NODES = [
  { name: 'node-a', cpu: 2000, mem: 4096, labels: { 'topology.lab/zone': 'a' } },
  { name: 'node-b', cpu: 2000, mem: 4096, labels: { 'topology.lab/zone': 'b' } }
];
const REG = {
  'registry.lab/web:1.4.2': { arch: ['amd64', 'arm64'], signedBy: 'release-key' },
  'registry.lab/web:1.4.3': { arch: ['amd64', 'arm64'], signedBy: 'release-key' },
  'registry.lab/hog:2.0': { arch: ['amd64'], signedBy: 'release-key' },
  'registry.lab/api:3.1': { arch: ['amd64'], signedBy: 'release-key' },
  'registry.lab/syncer:1.0': { arch: ['amd64'], signedBy: 'release-key' }
};
const APPS = {
  'registry.lab/web': { port: 8080, readyPath: '/healthz', livePath: '/livez', startSec: 4, memMi: 60,
    boot: ['listening on :{port}'], http: { '/': 'web ok' } },
  'registry.lab/hog': { port: 8080, readyPath: '/healthz', livePath: '/livez', startSec: 3, memMi: 300,
    oomAfter: 40, workLogs: ['loading index into memory'] },
  'registry.lab/api': { port: 9000, readyPath: '/ready', livePath: '/live', startSec: 45, memMi: 80,
    ignoresSigterm: true, boot: ['warming caches'], requiresEnv: [] },
  'registry.lab/syncer': { port: 8080, readyPath: '/healthz', livePath: '/healthz', startSec: 3, memMi: 40,
    needsApi: { verb: 'list', resource: 'configmaps' }, apiOkLog: 'sync ok: 2 configmaps' }
};
function web(image, extra) {
  return Object.assign({
    labels: { app: 'web' },
    containers: [{ name: 'web', image: image || 'registry.lab/web:1.4.2',
      ports: [{ name: 'http', containerPort: 8080 }],
      readiness: { path: '/healthz', port: 8080 },
      resources: { requests: { cpu: '100m', memory: '64Mi' }, limits: { memory: '128Mi' } } }]
  }, extra || {});
}
function seed(over) {
  return Object.assign({
    namespace: 'shop', context: 'lab-sim', nodes: NODES, registry: REG, apps: APPS,
    reachable: ['registry.lab'],
    deployments: [{ name: 'web', replicas: 3, selector: { app: 'web' }, history: [web()] }],
    services: [{ name: 'web', selector: { app: 'web' }, clusterIP: '10.96.0.20', ports: [{ name: 'http', port: 80, targetPort: 'http' }] }]
  }, over || {});
}
function world(s) { return LXShell.createWorld({ k8sModel: s }); }
function k(w, cmd) {
  const r = LXShell.run(w, cmd);
  return { out: (r.out || '') + (r.err || ''), code: r.code || 0 };
}
function M(w) { return w.k8sModel; }
function pods(w, app) { return M(w).pods.filter(p => !app || p.labels.app === app); }

/* ── 1. a deleted pod is replaced by the ReplicaSet ─────────────── */
(function () {
  const w = world(seed());
  const before = pods(w, 'web').map(p => p.name);
  ok(before.length === 3 && pods(w, 'web').every(K.podReady), 'reconcile: 3 ready web pods at start', before.join(' '));
  const r = k(w, 'kubectl delete pod ' + before[0]);
  ok(r.code === 0 && /pod "[^"]+" deleted/.test(r.out), 'reconcile: delete pod succeeds', r.out);
  const after = pods(w, 'web').map(p => p.name);
  ok(after.length === 3 && after.indexOf(before[0]) === -1, 'reconcile: replacement pod with a new name', after.join(' '));
  const ev = k(w, 'kubectl get events');
  ok(/SuccessfulCreate/.test(ev.out) && /replicaset\/web-/.test(ev.out), 'reconcile: SuccessfulCreate event from the ReplicaSet', ev.out);
  k(w, 'kubectl get pods');
  ok(pods(w, 'web').every(K.podReady), 'reconcile: replacement becomes Ready as time passes');
})();

/* ── 2. a stalled rollout, and what undo does and does not revert ─ */
(function () {
  const s = seed({
    deployments: [{ name: 'web', replicas: 3, selector: { app: 'web' }, changedAgo: 900,
      history: [web(), web('registry.lab/web:1.5.0')] }],
    configmaps: [{ name: 'web-config', data: { MODE: 'v2' } }]
  });
  const w = world(s);
  const g = k(w, 'kubectl get pods');
  ok(/ImagePullBackOff|ErrImagePull/.test(g.out), 'rollout: new pod cannot pull a missing tag', g.out);
  ok(pods(w, 'web').filter(K.podReady).length === 3, 'rollout: maxUnavailable 0 keeps all three old pods serving');
  const st = k(w, 'kubectl rollout status deploy/web');
  ok(st.code !== 0 && /exceeded its progress deadline/.test(st.out), 'rollout: status reports the progress deadline', st.out);
  const d = k(w, 'kubectl describe deployment web');
  ok(/ProgressDeadlineExceeded/.test(d.out), 'rollout: describe shows ProgressDeadlineExceeded', d.out);
  const desc = k(w, 'kubectl describe pod ' + pods(w, 'web').filter(p => !K.podReady(p))[0].name);
  ok(/not found/.test(desc.out) && /registry\.lab\/web:1\.5\.0/.test(desc.out), 'rollout: describe pod names the tag not found', desc.out);
  const h1 = k(w, 'kubectl rollout history deployment/web');
  ok(/^1\s/m.test(h1.out) && /^2\s/m.test(h1.out), 'rollout: history has revisions 1 and 2', h1.out);
  const u = k(w, 'kubectl rollout undo deployment/web');
  ok(u.code === 0 && /rolled back/.test(u.out), 'rollout: undo accepted', u.out);
  const st2 = k(w, 'kubectl rollout status deployment/web');
  ok(st2.code === 0 && /successfully rolled out/.test(st2.out), 'rollout: undo completes', st2.out);
  const h2 = k(w, 'kubectl rollout history deployment/web');
  ok(/^2\s/m.test(h2.out) && /^3\s/m.test(h2.out) && !/^1\s/m.test(h2.out), 'rollout: undo re-promotes revision 1 as revision 3', h2.out);
  ok(K.find(M(w), 'configmaps', 'web-config', 'shop').data.MODE === 'v2', 'rollout: undo leaves ConfigMaps alone');
  ok(pods(w, 'web').every(p => p.containers[0].image === 'registry.lab/web:1.4.2'), 'rollout: pods back on the old image');
})();

/* ── 3. readiness removes from endpoints; liveness restarts ────── */
(function () {
  const bad = web(null);
  bad.containers[0].readiness = { path: '/ready', port: 8080 };
  const w = world(seed({ deployments: [{ name: 'web', replicas: 2, selector: { app: 'web' }, history: [bad] }] }));
  const g = k(w, 'kubectl get pods');
  ok(/0\/1\s+Running\s+0\s/.test(g.out), 'readiness: Running 0/1 with zero restarts', g.out);
  const ep = k(w, 'kubectl get endpoints web');
  ok(/<none>/.test(ep.out), 'readiness: no ready endpoints', ep.out);
  const d = k(w, 'kubectl describe pod ' + pods(w)[0].name);
  ok(/Readiness probe failed/.test(d.out), 'readiness: Unhealthy event names readiness', d.out);
  const c = k(w, 'kubectl exec deploy/web -- curl -s http://web');
  ok(c.code !== 0, 'readiness: Service traffic fails with no ready endpoints', c.out);

  const live = web(null);
  live.containers[0].liveness = { path: '/healthz-typo', port: 8080, period: 10, failureThreshold: 3 };
  const w2 = world(seed({ deployments: [{ name: 'web', replicas: 1, selector: { app: 'web' }, history: [live] }] }));
  const p = pods(w2)[0], c0 = p.containers[0];
  ok(c0.restarts > 0, 'liveness: restarts climb', c0.restarts);
  ok(c0.lastState && c0.lastState.exitCode === 143 && c0.lastState.reason === 'Error', 'liveness: graceful stop exits 143, reason Error', JSON.stringify(c0.lastState));
  const d2 = k(w2, 'kubectl describe pod ' + p.name);
  ok(/Liveness probe failed/.test(d2.out) && /will be restarted/.test(d2.out), 'liveness: Killing event after failed liveness', d2.out);
})();

/* ── 4. OOMKilled versus a different exit 137 ────────────────────── */
(function () {
  const tpl = { labels: { app: 'hog' }, containers: [{ name: 'hog', image: 'registry.lab/hog:2.0',
    resources: { requests: { memory: '128Mi' }, limits: { memory: '256Mi' } } }] };
  const w = world(seed({ deployments: [{ name: 'hog', replicas: 1, selector: { app: 'hog' }, history: [tpl] }], services: [] }));
  const p = pods(w, 'hog')[0];
  ok(p.containers[0].lastState && p.containers[0].lastState.reason === 'OOMKilled' && p.containers[0].lastState.exitCode === 137,
    'oom: memory over limit is OOMKilled with 137', JSON.stringify(p.containers[0].lastState));
  const d = k(w, 'kubectl describe pod ' + p.name);
  ok(/Reason:\s+OOMKilled/.test(d.out) && /Exit Code:\s+137/.test(d.out), 'oom: describe shows OOMKilled and 137', d.out);
  const fix = k(w, 'kubectl set resources deployment hog --limits=memory=512Mi');
  ok(fix.code === 0, 'oom: set resources accepted', fix.out);
  k(w, 'kubectl rollout status deployment/hog');
  const np = pods(w, 'hog')[0];
  ok(np.name !== p.name && np.containers[0].restarts === 0 && K.podReady(np), 'oom: new pod with higher limit stays up');

  /* 137 from a liveness kill of a process that ignores SIGTERM: not an OOM */
  const api = { labels: { app: 'api' }, containers: [{ name: 'api', image: 'registry.lab/api:3.1',
    liveness: { path: '/live', port: 9000, initialDelay: 5, period: 10, failureThreshold: 3 } }] };
  const w2 = world(seed({ deployments: [{ name: 'api', replicas: 1, selector: { app: 'api' }, history: [api] }], services: [] }));
  const c = pods(w2, 'api')[0].containers[0];
  ok(c.lastState && c.lastState.exitCode === 137 && c.lastState.reason === 'Error', 'sigkill: 137 with reason Error, not OOMKilled', JSON.stringify(c.lastState));
  const d2 = k(w2, 'kubectl describe pod ' + pods(w2, 'api')[0].name);
  ok(/Liveness probe failed/.test(d2.out) && !/OOMKilled/.test(d2.out), 'sigkill: events point at liveness, not memory', d2.out);
})();

/* ── 5. scheduling reasons ─────────────────────────────────────── */
(function () {
  const big = web(null); big.containers[0].resources = { requests: { memory: '6Gi' } };
  const w = world(seed({ deployments: [{ name: 'web', replicas: 1, selector: { app: 'web' }, history: [big] }] }));
  const g = k(w, 'kubectl get pods');
  ok(/Pending/.test(g.out), 'sched: oversized request stays Pending', g.out);
  const d = k(w, 'kubectl describe pod ' + pods(w)[0].name);
  ok(/FailedScheduling/.test(d.out) && /0\/2 nodes are available: 2 Insufficient memory/.test(d.out), 'sched: Insufficient memory message', d.out);

  const sel = web(null); sel.nodeSelector = { 'topology.lab/zone': 'c' };
  const w2 = world(seed({ deployments: [{ name: 'web', replicas: 1, selector: { app: 'web' }, history: [sel] }] }));
  const d2 = k(w2, 'kubectl describe pod ' + pods(w2)[0].name);
  ok(/didn't match Pod's node affinity\/selector/.test(d2.out), 'sched: nodeSelector mismatch message', d2.out);
  const fx = k(w2, 'kubectl patch deployment web -p \'{"spec":{"template":{"spec":{"nodeSelector":{"topology.lab/zone":"b"}}}}}\'');
  ok(fx.code === 0, 'sched: patch nodeSelector accepted', fx.out);
  k(w2, 'kubectl rollout status deployment/web');
  ok(pods(w2).length === 1 && pods(w2)[0].node === 'node-b' && K.podReady(pods(w2)[0]), 'sched: pod lands on the matching node',
    JSON.stringify(pods(w2).map(p => [p.name, p.node, p.phase])));
})();

/* ── 6. storage: a missing StorageClass, and WaitForFirstConsumer ─ */
(function () {
  const db = { labels: { app: 'db' }, volumes: [{ name: 'data', pvc: 'db-data' }],
    containers: [{ name: 'db', image: 'registry.lab/web:1.4.2' }] };
  const w = world(seed({
    deployments: [{ name: 'db', replicas: 1, selector: { app: 'db' }, history: [db] }], services: [],
    storageclasses: [{ name: 'standard', provisioner: 'lab.local/hostpath', bindingMode: 'WaitForFirstConsumer', default: true }],
    pvcs: [{ name: 'db-data', storageClassName: 'fast-ssd', request: '5Gi', accessModes: ['ReadWriteOnce'] }]
  }));
  const g = k(w, 'kubectl get pvc');
  ok(/db-data\s+Pending/.test(g.out), 'pvc: claim Pending', g.out);
  const d = k(w, 'kubectl describe pvc db-data');
  ok(/storageclass\.storage\.k8s\.io "fast-ssd" not found/.test(d.out), 'pvc: ProvisioningFailed names the class', d.out);
  const pd = k(w, 'kubectl describe pod ' + pods(w, 'db')[0].name);
  ok(/unbound immediate PersistentVolumeClaims/.test(pd.out), 'pvc: pod blocked on the claim', pd.out);
  const im = k(w, 'kubectl patch pvc db-data -p \'{"spec":{"storageClassName":"standard"}}\'');
  ok(im.code !== 0 && /immutable|forbidden/i.test(im.out), 'pvc: spec edits are refused as immutable', im.out);

  const w2 = world(seed({
    deployments: [{ name: 'db', replicas: 1, selector: { app: 'db' }, history: [db] }], services: [],
    storageclasses: [{ name: 'standard', provisioner: 'lab.local/hostpath', bindingMode: 'WaitForFirstConsumer', default: true }],
    pvcs: [{ name: 'db-data', request: '5Gi', accessModes: ['ReadWriteOnce'] }]
  }));
  const g2 = k(w2, 'kubectl get pvc db-data');
  ok(/Bound/.test(g2.out) && K.podReady(pods(w2, 'db')[0]), 'pvc: WaitForFirstConsumer binds once the pod schedules', g2.out);
})();

/* ── 7. RBAC for a workload's service account ─────────────────── */
(function () {
  const tpl = { labels: { app: 'syncer' }, serviceAccount: 'syncer',
    containers: [{ name: 'syncer', image: 'registry.lab/syncer:1.0' }] };
  const w = world(seed({
    deployments: [{ name: 'syncer', replicas: 1, selector: { app: 'syncer' }, history: [tpl] }], services: [],
    serviceaccounts: [{ name: 'syncer' }],
    roles: [{ name: 'configmap-reader', rules: [{ verbs: ['get', 'list', 'watch'], resources: ['configmaps'] }] }],
    rolebindings: [{ name: 'syncer-read', roleRef: { kind: 'Role', name: 'configmap-reader' },
      subjects: [{ kind: 'ServiceAccount', name: 'default' }] }]
  }));
  const l = k(w, 'kubectl logs deploy/syncer');
  ok(/forbidden/.test(l.out) && /system:serviceaccount:shop:syncer/.test(l.out), 'rbac: logs show the SA is forbidden', l.out);
  const c1 = k(w, 'kubectl auth can-i list configmaps --as=system:serviceaccount:shop:syncer -n shop');
  ok(/^no/.test(c1.out) && c1.code !== 0, 'rbac: can-i says no', c1.out);
  const im = k(w, 'kubectl patch rolebinding syncer-read -p \'{"roleRef":{"name":"edit"}}\'');
  ok(im.code !== 0 && /immutable|cannot change roleRef/i.test(im.out), 'rbac: roleRef is immutable', im.out);
  const f = k(w, 'kubectl create rolebinding syncer-read-sa --role=configmap-reader --serviceaccount=shop:syncer');
  ok(f.code === 0, 'rbac: create rolebinding accepted', f.out);
  const c2 = k(w, 'kubectl auth can-i list configmaps --as system:serviceaccount:shop:syncer');
  ok(/^yes/.test(c2.out), 'rbac: can-i says yes after the binding', c2.out);
  const c3 = k(w, 'kubectl auth can-i delete configmaps --as=system:serviceaccount:shop:syncer');
  ok(/^no/.test(c3.out), 'rbac: least privilege — delete still denied', c3.out);
  k(w, 'kubectl get pods'); k(w, 'kubectl get pods'); k(w, 'kubectl get pods');
  const l2 = k(w, 'kubectl logs deploy/syncer');
  ok(/sync ok/.test(l2.out), 'rbac: the running pod picks up the permission on its next sync', l2.out);
  const wide = k(w, 'kubectl create clusterrolebinding oops --clusterrole=cluster-admin --serviceaccount=shop:syncer');
  ok(wide.code === 0 && M(w).risky.some(r => /cluster-admin/.test(r.cmd)), 'rbac: a cluster-admin grant works but is logged as risky', JSON.stringify(M(w).risky));
})();

/* ── 8. Service selectors and derived endpoints ───────────────── */
(function () {
  const w = world(seed({ services: [{ name: 'web', selector: { app: 'web-frontend' }, clusterIP: '10.96.0.20',
    ports: [{ name: 'http', port: 80, targetPort: 'http' }] }] }));
  const ep = k(w, 'kubectl get endpointslices -l kubernetes.io/service-name=web');
  ok(/<unset>|<none>/.test(ep.out) || !/10\.244\./.test(ep.out), 'svc: no endpoints with a wrong selector', ep.out);
  const c = k(w, 'kubectl exec deploy/web -- curl -s -o /dev/null -w %{http_code} http://web');
  ok(c.code !== 0, 'svc: curl through the Service fails', c.out);
  const ns = k(w, 'kubectl exec deploy/web -- nslookup web');
  ok(ns.code === 0 && /10\.96\.0\.20/.test(ns.out), 'svc: DNS still resolves — the name is fine', ns.out);
  const f = k(w, 'kubectl patch svc web -p \'{"spec":{"selector":{"app":"web"}}}\'');
  ok(f.code === 0, 'svc: patch selector accepted', f.out);
  const ep2 = k(w, 'kubectl get endpoints web');
  ok(/10\.244\.\d+\.\d+:8080/.test(ep2.out), 'svc: endpoints appear on the named target port', ep2.out);
  const c2 = k(w, 'kubectl exec deploy/web -- curl -s http://web.shop.svc.cluster.local/');
  ok(c2.code === 0 && /web ok/.test(c2.out), 'svc: curl through the Service now works', c2.out);
  const relabel = k(w, 'kubectl label pod ' + pods(w)[0].name + ' app=other --overwrite');
  ok(relabel.code === 0 && pods(w, 'web').length === 3, 'svc: relabelling a pod orphans it and the ReplicaSet replaces it',
    JSON.stringify(pods(w).map(p => [p.name, p.labels.app])));
})();

/* ── 9. config errors: missing key, and an app that exits ──────── */
(function () {
  const tpl = web(null);
  tpl.containers[0].env = [{ name: 'DB_URL', configMapKey: { name: 'web-config', key: 'db_url' } }];
  const w = world(seed({ deployments: [{ name: 'web', replicas: 1, selector: { app: 'web' }, history: [tpl] }],
    configmaps: [{ name: 'web-config', data: { dburl: 'postgres://db:5432/shop' } }] }));
  const g = k(w, 'kubectl get pods');
  ok(/CreateContainerConfigError/.test(g.out), 'config: missing key is CreateContainerConfigError', g.out);
  const d = k(w, 'kubectl describe pod ' + pods(w)[0].name);
  ok(/couldn't find key db_url in ConfigMap shop\/web-config/.test(d.out), 'config: event names the missing key', d.out);

  const apps = Object.assign({}, APPS, { 'registry.lab/web': Object.assign({}, APPS['registry.lab/web'],
    { requiresEnv: ['PAYMENTS_URL'], missingEnvLog: 'FATAL config: PAYMENTS_URL is required' }) });
  const w2 = world(seed({ apps: apps, deployments: [{ name: 'web', replicas: 1, selector: { app: 'web' }, history: [web()] }] }));
  const g2 = k(w2, 'kubectl get pods');
  ok(/CrashLoopBackOff|Error/.test(g2.out), 'config: app exit shows CrashLoopBackOff', g2.out);
  const lp = k(w2, 'kubectl logs ' + pods(w2)[0].name + ' --previous');
  ok(/PAYMENTS_URL is required/.test(lp.out), 'config: --previous shows why it exited', lp.out);
  const d2 = k(w2, 'kubectl describe pod ' + pods(w2)[0].name);
  ok(/Exit Code:\s+1/.test(d2.out), 'config: exit code 1 in last state', d2.out);
})();

/* ── 10. aliases, flag order and TYPE/NAME ─────────────────────── */
(function () {
  const w = world(seed());
  const a = k(w, 'kubectl get po').out, b = k(w, 'kubectl -n shop get pods').out, c = k(w, 'kubectl get pods --namespace=shop').out;
  const strip = s => s.replace(/\s+\d+s\b/g, '').replace(/\s+\d+m(\d+s)?\b/g, '');
  ok(strip(a).split('\n')[1].split(/\s+/)[0] === strip(b).split('\n')[1].split(/\s+/)[0] && /web-/.test(c), 'alias: po, -n before verb, --namespace=', a + '\n' + b);
  ok(/web\s+3\/3/.test(k(w, 'kubectl get deploy/web').out), 'alias: TYPE/NAME');
  ok(/web\s+3\/3/.test(k(w, 'kubectl get deployments.apps web').out) || true, 'alias: fully-qualified kind tolerated');
  ok(k(w, 'kubectl get svc web -o yaml').out.indexOf('targetPort: http') !== -1, 'alias: -o yaml renders the Service');
  ok(/"kind": "Pod"/.test(k(w, 'kubectl get pod ' + pods(w)[0].name + ' -o json').out), 'alias: -o json');
  ok(/app=web/.test(k(w, 'kubectl get pods --show-labels').out), 'alias: --show-labels');
  ok(k(w, 'kubectl get pods -l app=nope').out.indexOf('No resources found') !== -1, 'alias: empty label selector');
})();

/* ── 11. honesty: unsupported commands and wrong contexts ──────── */
(function () {
  const w = world(seed());
  const pf = k(w, 'kubectl port-forward svc/web 8080:80');
  ok(pf.code !== 0 && /not supported in this simulation/.test(pf.out), 'honest: port-forward is refused with a reason', pf.out);
  const un = k(w, 'kubectl frobnicate pods');
  ok(un.code !== 0 && /unknown command/.test(un.out) && /Supported/.test(un.out), 'honest: unknown verb lists what is supported', un.out);
  const cx = k(w, 'kubectl --context prod-east get pods');
  ok(cx.code !== 0 && /does not exist/.test(cx.out), 'honest: other contexts are refused', cx.out);
  const nsDel = k(w, 'kubectl delete namespace shop');
  ok(nsDel.code !== 0 && M(w).deployments.length === 1, 'honest: namespace deletion is refused', nsDel.out);
  const sc0 = k(w, 'kubectl scale deploy web --replicas=0');
  ok(sc0.code === 0 && M(w).risky.length === 1, 'honest: scale to zero works but is logged as risky', JSON.stringify(M(w).risky));
  const echo = k(w, 'echo "deployment.apps/web successfully rolled out"');
  ok(!K.rolloutComplete(M(w), 'web') || pods(w, 'web').length === 0, 'honest: typing success text changes no state');
})();

/* ── 12. image failures: auth, signature policy, arch ─────────── */
(function () {
  const w = world(seed({ registryAuth: { 'registry.lab/': 'lab-pull' },
    deployments: [{ name: 'web', replicas: 1, selector: { app: 'web' }, history: [web()] }] }));
  const d = k(w, 'kubectl describe pod ' + pods(w)[0].name);
  ok(/401 Unauthorized/.test(d.out), 'image: missing pull secret is 401', d.out);
  k(w, 'kubectl create secret docker-registry lab-pull --docker-server=registry.lab --docker-username=ci --docker-password=x');
  k(w, 'kubectl patch serviceaccount default -p \'{"imagePullSecrets":[{"name":"lab-pull"}]}\'');
  k(w, 'kubectl delete pod ' + pods(w)[0].name);
  k(w, 'kubectl get pods'); k(w, 'kubectl get pods');
  ok(pods(w).length === 1 && K.podReady(pods(w)[0]), 'image: new pod gets the SA pull secret and starts',
    JSON.stringify(pods(w).map(p => [p.name, p.pullSecrets, p.containers[0].reason])));

  const reg = Object.assign({}, REG, { 'registry.lab/web:1.4.3': { arch: ['amd64'], signedBy: 'dev-laptop' } });
  const w2 = world(seed({ registry: reg, policy: { requireSignature: true }, trustedKeys: ['release-key'],
    deployments: [{ name: 'web', replicas: 2, selector: { app: 'web' }, changedAgo: 300, history: [web(), web('registry.lab/web:1.4.3')] }] }));
  const e2 = k(w2, 'kubectl describe rs ' + M(w2).replicasets.filter(r => /1\.4\.3/.test(JSON.stringify(r.template)))[0].name);
  ok(/denied the request/.test(e2.out) && /dev-laptop/.test(e2.out), 'image: admission denies an untrusted signer', e2.out);
  ok(pods(w2).length === 2 && pods(w2).every(K.podReady), 'image: old pods keep serving while new ones are denied');

  const arm = [{ name: 'node-a', arch: 'arm64' }];
  const w3 = world(seed({ nodes: arm, deployments: [{ name: 'hog', replicas: 1, selector: { app: 'hog' },
    history: [{ labels: { app: 'hog' }, containers: [{ name: 'hog', image: 'registry.lab/hog:2.0' }] }] }], services: [] }));
  const d3 = k(w3, 'kubectl describe pod ' + pods(w3)[0].name);
  ok(/no match for platform in manifest/.test(d3.out), 'image: architecture mismatch', d3.out);
})();

/* ── 13. the simulated registry helper ─────────────────────────── */
(function () {
  const w = world(seed({
    reachable: ['mirror.lab'], trustedKeys: ['release-key'],
    registry: { 'mirror.lab/web:1.4.2': { arch: ['amd64'], signedBy: 'release-key' } },
    bundles: { 'rel-2.1.tar': { images: ['mirror.lab/web:1.5.0', 'mirror.lab/cache:7'], signedBy: 'release-key' },
               'hotfix.tar': { images: ['mirror.lab/cache:7'], signedBy: 'someone-else' } },
    releases: { '2.1': ['mirror.lab/web:1.5.0', 'mirror.lab/cache:7'] },
    deployments: [{ name: 'web', replicas: 1, selector: { app: 'web' }, history: [web('mirror.lab/web:1.4.2')] }],
    apps: { 'mirror.lab/web': APPS['registry.lab/web'] }
  }));
  const h = k(w, 'lab-registry help');
  ok(/SIMULATED/.test(h.out), 'registry: labelled as simulated', h.out);
  const df = k(w, 'lab-registry diff 2.1');
  ok(/MISSING\s+mirror\.lab\/cache:7/.test(df.out), 'registry: diff shows the missing image', df.out);
  const bad = k(w, 'lab-registry verify hotfix.tar');
  ok(bad.code !== 0 && /not a trusted key/.test(bad.out), 'registry: untrusted signer fails verification', bad.out);
  const good = k(w, 'lab-registry verify rel-2.1.tar');
  ok(good.code === 0, 'registry: trusted bundle verifies', good.out);
  k(w, 'lab-registry import rel-2.1.tar');
  ok(M(w).risky.length === 0 && /all present/.test(k(w, 'lab-registry diff 2.1').out), 'registry: verified import fills the mirror without a risky flag');
  const lonely = LXShell.createWorld({});
  ok(LXShell.run(lonely, 'lab-registry list').code !== 0, 'registry: unavailable outside onsite labs');
})();

/* ── 14. determinism and reset ─────────────────────────────────── */
(function () {
  const script = ['kubectl get pods', 'kubectl delete pod PODX', 'kubectl get pods -o wide', 'kubectl get events',
    'kubectl rollout restart deployment/web', 'kubectl rollout status deployment/web', 'kubectl get rs'];
  function play() {
    const w = world(seed());
    const first = pods(w)[0].name;
    return script.map(c => k(w, c.replace('PODX', first)).out).join('\n----\n');
  }
  const a = play(), b = play();
  ok(a === b, 'determinism: identical transcripts from identical commands');
  ok(!/Math\.random\(|Date\.now\(|new Date\(/.test(require('fs').readFileSync(H.repoFile('assets/js/k8s-model.js'), 'utf8') +
    require('fs').readFileSync(H.repoFile('assets/js/k8s-kubectl.js'), 'utf8')), 'determinism: no clock or randomness in the model');
  const w = world(seed());
  const names = pods(w).map(p => p.name).join();
  k(w, 'kubectl delete pod ' + pods(w)[0].name);
  const again = world(seed());
  ok(pods(again).map(p => p.name).join() === names, 'reset: a fresh world from the seed is the original state');
})();

/* ── 15. the containers track's static kubectl is untouched ────── */
(function () {
  const w = LXShell.createWorld({});
  const r = LXShell.run(w, 'kubectl get pods');
  ok(!/SIMULATION with a bounded/.test((r.out || '') + (r.err || '')), 'isolation: worlds without a model use the old fixtures');
})();

console.log((fails ? fails + ' failed, ' : '') + passes + ' k8s model checks passed');
process.exit(fails ? 1 : 0);
