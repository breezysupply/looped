/* SRE & Cloud Deployment Foundations — simulated incidents S17–S20 (M09–M10).

   Same contract as sre-scenarios-1.js; played by tests/data/test-sre-scenarios.js.

   S17 runs on the reconciling cluster model (k8s-model.js), which already
   schedules on requests, taints/tolerations and storage claims. S18 adds a
   NetworkPolicy model (policy-as-file, an egress evaluator and in-pod
   nslookup/getent/dig/curl/nc whose answers come from the live policy set)
   by wrapping `LXShell.builtin('kubectl')` in a world verb. S19 adds a small
   Helm model (charts on disk, a template renderer for the subset the chart
   uses, release history, upgrade/rollback that write to the cluster model).
   S20 adds a GitOps reconciler stand-in (`gitops`) that renders a Kustomize-
   style overlay from what was pushed to origin and corrects drift on the
   scenario clock, over the LXSim git model.

   Every command advances the scenario clock (verbs are bound with
   LXSim.bind); nothing reads Math.random or Date. Learner-visible text
   (title, briefs, objective text) never names the root cause; mechanism,
   alternatives and the worked fix live in the debrief. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.missions = LX.missions || [];

(function () {
  function SIM() { return window.LXSim; }
  function KM() { return window.LXK8s; }
  function st(c) { return c.w.sre; }
  function M(c) { return c.w.k8sModel; }
  function ran(c, re) { return SIM().ran(c, re); }
  function saw(c, re, outRe) { return SIM().saw(c, re, outRe); }
  function lastIs(c, cmdRe, outRe) { return SIM().lastIs(c, cmdRe, outRe); }
  function lastCode(c) { return SIM().lastCode(c); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function res(out, code, errText) {
    var r = { out: out == null ? '' : String(out), code: code || 0 };
    if (r.out && !/\n$/.test(r.out)) r.out += '\n';
    if (errText) r.err = String(errText).replace(/\n?$/, '\n');
    return r;
  }
  function readF(w, p) { return SIM().readFile(w, p); }
  /* the cluster model's YAML reader, after dropping whole-line comments it does not expect */
  function parseY(text) { return KM().parseYaml(String(text || '').split('\n').filter(function (l) { return !/^\s*#/.test(l); }).join('\n')); }

  /* ── kubectl argument helpers ─────────────────────────────────── */
  var KVALUED = ['-n', '--namespace', '-o', '--output', '-l', '--selector', '-c', '--container', '--field-selector', '--sort-by',
    '-p', '--patch', '-f', '--filename', '--type', '--replicas', '--requests', '--limits', '--timeout', '--tail', '--since',
    '--context', '--as', '--to-revision', '--image', '--revision', '--grace-period'];
  function positions(a) {
    var out = [];
    for (var i = 0; i < a.length; i++) {
      var t = a[i];
      if (t === '--') break;
      if (KVALUED.indexOf(t) !== -1) { i++; continue; }
      if (t.charAt(0) === '-' && t.length > 1) continue;
      out.push(i);
    }
    return out;
  }
  function pos(a) { return positions(a).map(function (i) { return a[i]; }); }
  function flagOf(a, names) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] === '--') break;
      for (var j = 0; j < names.length; j++) {
        if (a[i] === names[j] && i + 1 < a.length) return a[i + 1];
        if (a[i].indexOf(names[j] + '=') === 0) return a[i].slice(names[j].length + 1);
      }
    }
    return null;
  }
  function hasFlag(a, names) { return a.some(function (x) { return names.indexOf(x) !== -1; }); }
  function nsOf(a) { return flagOf(a, ['-n', '--namespace']); }

  /* kubectl from the cluster model, plus `get KIND,KIND` (one table per kind) */
  function kubectlBase(w, a) {
    var k = LXShell.builtin('kubectl');
    if (!k) return res('', 1, 'kubectl: not available');
    var p = positions(a);
    if (p.length >= 2 && a[p[0]] === 'get' && a[p[1]].indexOf(',') > 0 && a[p[1]].indexOf('/') === -1) {
      var outs = [], errs = [], code = 0;
      a[p[1]].split(',').filter(Boolean).forEach(function (kd) {
        var b = a.slice(); b[p[1]] = kd;
        var r = k(w, b);
        if (r.out) outs.push(String(r.out).replace(/\n$/, ''));
        if (r.err) errs.push(String(r.err).replace(/\n$/, ''));
        code = Math.max(code, r.code || 0);
      });
      return { out: outs.length ? outs.join('\n\n') + '\n' : '', err: errs.length ? errs.join('\n') + '\n' : undefined, code: code };
    }
    return k(w, a);
  }
  function dep(m, name) { return KM().find(m, 'deployments', name, m.ns); }
  function podsOfApp(m, app) { return m.pods.filter(function (p) { return !p.gone && (p.labels || {}).app === app; }); }
  function readyOf(m, app) { return podsOfApp(m, app).filter(function (p) { return KM().podReady(p); }).length; }
  function podFor(m, ref) {
    if (!ref) return null;
    if (/^(deploy|deployment|deployments)\//.test(ref)) {
      var d = dep(m, ref.split('/')[1]);
      if (!d) return null;
      var pods = [];
      KM().rsFor(m, d).forEach(function (r) { pods = pods.concat(KM().podsOf(m, r)); });
      pods.sort(function (x, y) { return (KM().podReady(y) ? 1 : 0) - (KM().podReady(x) ? 1 : 0) || y.created - x.created; });
      return pods[0] || null;
    }
    var name = ref.replace(/^(po|pod|pods)\//, '');
    return m.pods.filter(function (p) { return p.name === name && !p.gone; })[0] || null;
  }

  /* ── a small YAML writer for the documents these models print ─── */
  function scal(x) {
    if (x === null || x === undefined) return 'null';
    if (typeof x === 'number' || typeof x === 'boolean') return String(x);
    var s = String(x);
    if (s === '' || /^(true|false|null|yes|no|on|off|~)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s) || /:\s|\s#|^[\s\-?:,\[\]{}#&*!|>'"%@`]|\s$/.test(s)) return JSON.stringify(s);
    return s;
  }
  function toYaml(v, ind) {
    ind = ind || '';
    if (Array.isArray(v)) {
      if (!v.length) return ind + '[]';
      return v.map(function (x) {
        if (x && typeof x === 'object' && !Array.isArray(x)) {
          if (!Object.keys(x).length) return ind + '- {}';
          var body = toYaml(x, ind + '  ');
          return ind + '- ' + body.slice(ind.length + 2);
        }
        return ind + '- ' + scal(x);
      }).join('\n');
    }
    if (v && typeof v === 'object') {
      var keys = Object.keys(v).filter(function (k) { return v[k] !== undefined; });
      if (!keys.length) return ind + '{}';
      return keys.map(function (k) {
        var x = v[k];
        if (x && typeof x === 'object') {
          if (Array.isArray(x)) return x.length ? ind + k + ':\n' + toYaml(x, ind + '  ') : ind + k + ': []';
          return Object.keys(x).length ? ind + k + ':\n' + toYaml(x, ind + '  ') : ind + k + ': {}';
        }
        return ind + k + ': ' + scal(x);
      }).join('\n');
    }
    return ind + scal(v);
  }

  /* ── `diff A B`: a line diff (LCS) with a little context ───────── */
  function diffLines(a, b) {
    var A = String(a).replace(/\n$/, '').split('\n'), B = String(b).replace(/\n$/, '').split('\n');
    var n = A.length, m = B.length, L = [], i, j;
    for (i = n; i >= 0; i--) { L[i] = []; for (j = m; j >= 0; j--) L[i][j] = (i === n || j === m) ? 0 : A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]); }
    var out = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push(' ' + A[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { out.push('-' + A[i]); i++; }
      else { out.push('+' + B[j]); j++; }
    }
    while (i < n) out.push('-' + A[i++]);
    while (j < m) out.push('+' + B[j++]);
    return out;
  }
  function withContext(lines, ctx) {
    var keep = lines.map(function () { return false; });
    lines.forEach(function (l, k) { if (l.charAt(0) !== ' ') for (var x = Math.max(0, k - ctx); x <= Math.min(lines.length - 1, k + ctx); x++) keep[x] = true; });
    var out = [], gap = false;
    lines.forEach(function (l, k) { if (keep[k]) { out.push(l); gap = false; } else if (!gap) { out.push('@@ … @@'); gap = true; } });
    return out;
  }
  function diffVerb() {
    return function (w, a) {
      var files = a.filter(function (x) { return x.charAt(0) !== '-'; });
      if (files.length !== 2) return res('', 2, 'diff (simulation): diff [-u] FILE1 FILE2 — compares two files in this world');
      var x = readF(w, files[0]), y = readF(w, files[1]);
      if (x == null) return res('', 2, 'diff: ' + files[0] + ': No such file or directory');
      if (y == null) return res('', 2, 'diff: ' + files[1] + ': No such file or directory');
      if (x === y) return res('', 0);
      return { out: '--- ' + files[0] + '\n+++ ' + files[1] + '\n' + withContext(diffLines(x, y), 3).join('\n') + '\n', code: 1 };
    };
  }
  /* the workstation is outside the cluster network: say so instead of guessing */
  function outsideCurl() {
    return function (w, a) {
      var url = a.filter(function (x) { return /^https?:\/\//.test(x) || /^[a-z0-9.-]+(:\d+)?(\/|$)/i.test(x); }).pop() || '';
      if (!url) return res('', 2, 'curl: no URL specified!');
      var host = url.replace(/^https?:\/\//, '').split(/[/:]/)[0];
      return res('', /^10\.|svc|cluster\.local|beacon/.test(host) ? 7 : 6, /^10\.|svc|cluster\.local|beacon/.test(host)
        ? 'curl: (7) Failed to connect to ' + host + ': No route to host\n(simulation: this workstation is outside the cluster network; use kubectl exec deploy/beacon-client -- curl …)'
        : 'curl: (6) Could not resolve host: ' + host + '\n(simulation: only in-cluster requests are modelled; use kubectl exec deploy/beacon-client -- curl …)');
    };
  }
  /* `sleep N` waits on the scenario clock (bounded), so watching a controller is possible */
  function sleepVerb(state, after) {
    return function (w, a) {
      var n = parseInt(String(a[0] || '').replace(/s$/, ''), 10);
      if (!(n >= 0)) return res('', 1, 'sleep: invalid time interval \'' + (a[0] || '') + '\'');
      n = Math.min(n, 600);
      /* time passes in small steps so controllers watching the clock act on the way */
      while (n > 0) {
        var step = Math.min(n, 10);
        state.clock = (state.clock || 0) + step;
        if (w.k8sModel) KM().advance(w.k8sModel, step);
        if (after) after(state, w);
        n -= step;
      }
      return res('');
    };
  }
  function k8sWorld(state, k8s, files, kubectl, extra) {
    var S = SIM();
    var verbs = Object.assign({ kubectl: kubectl, k: kubectl, edit: S.verbs.edit(), diff: diffVerb(), curl: outsideCurl(), sleep: sleepVerb(state) }, extra || {});
    return { user: 'lab', host: 'looped-ops', cwd: '/home/lab/beacon', files: files, k8sModel: k8s, sre: state, extra: S.bind(state, verbs) };
  }
  function beaconApiProfile(version) {
    return { port: 8080, namedPort: 'http', readyPath: '/ready', livePath: '/healthz', startSec: 4, memMi: 70,
      boot: ['{"level":"info","msg":"config loaded","source":"/app/beacon.yaml+env"}'],
      runLogs: ['{"level":"info","msg":"starting beacon-api","version":"' + version + '"}', 'beacon-api ' + version + ' listening on 0.0.0.0:8080'],
      http: { '/healthz': 'ok', '/ready': '{"ready": true, "store": "postgres"}', '/version': '{"version": "' + version + '", "environment": "lab"}' } };
  }
  var TOOLBOX_IMG = 'registry.lab/tools/toolbox:1.2.0';
  var TOOLBOX = { port: 8080, readyPath: '/', livePath: '/', startSec: 1, memMi: 10, boot: ['toolbox: sleeping; use kubectl exec'] };
  function clientDeployment() {
    return { name: 'beacon-client', replicas: 1, selector: { app: 'beacon-client' }, history: [{ labels: { app: 'beacon-client' }, containers: [{ name: 'client', image: TOOLBOX_IMG, resources: { requests: { cpu: '20m', memory: '16Mi' } } }] }] };
  }
  function apiDeployment(version, extra) {
    return Object.assign({ name: 'beacon-api', replicas: 2, selector: { app: 'beacon-api' }, history: [{ labels: { app: 'beacon-api' },
      containers: [{ name: 'api', image: 'registry.lab/beacon/api:' + version, ports: [{ name: 'http', containerPort: 8080 }],
        resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { memory: '256Mi' } },
        readiness: { path: '/ready', port: 8080, period: 5 }, liveness: { path: '/healthz', port: 8080, initialDelay: 10 } }] }] }, extra || {});
  }
  function apiService(extra) { return Object.assign({ name: 'beacon-api', selector: { app: 'beacon-api' }, clusterIP: '10.96.112.40', ports: [{ name: 'http', port: 80, targetPort: 'http' }] }, extra || {}); }
  var K8S_SIMPLIFIED = [
    'One namespace (beacon) on a kind-like cluster (looped-foundations) with a logical clock: every command advances time by 10 seconds, so waiting means running another command (or `sleep N`).',
    'Controllers are simplified: first-fit scheduling on requests, no scoring, no preemption, no informer lag, no watch.',
    'Only the documented command set is supported; anything else says so rather than pretending to work. The workstation is outside the cluster network: test from inside with `kubectl exec`.'
  ];

  /* ═══ S17 · Pod remains Pending ═══════════════════════════════════ */
  var S17_NEW = 'registry.lab/beacon/worker:1.5.0', S17_OLD = 'registry.lab/beacon/worker:1.4.2';
  var S17_BATCH = 'looped-foundations-worker3';
  function s17Nodes() {
    return [
      { name: 'looped-foundations-control-plane', cpu: 3800, mem: 7680, arch: 'arm64', role: 'control-plane', taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] },
      { name: 'looped-foundations-worker', cpu: 3800, mem: 7680, arch: 'arm64', labels: { pool: 'general' } },
      { name: 'looped-foundations-worker2', cpu: 3800, mem: 7680, arch: 'arm64', labels: { pool: 'general' } },
      { name: S17_BATCH, cpu: 3800, mem: 7680, arch: 'arm64', labels: { pool: 'batch' }, taints: [{ key: 'dedicated', value: 'batch', effect: 'NoSchedule' }] }
    ];
  }
  function s17WorkerTpl(image, opts) {
    var t = { labels: { app: 'beacon-worker' }, nodeSelector: { pool: 'batch' },
      containers: [{ name: 'worker', image: image, ports: [{ name: 'metrics', containerPort: 9100 }],
        resources: { requests: { cpu: opts.cpu, memory: opts.mem }, limits: { memory: opts.limit } },
        readiness: { path: '/ready', port: 9100, period: 10 } }] };
    if (opts.tolerate) t.tolerations = [{ key: 'dedicated', operator: 'Equal', value: 'batch', effect: 'NoSchedule' }];
    if (opts.spool) t.volumes = [{ name: 'spool', pvc: 'beacon-worker-spool' }];
    return t;
  }
  function s17Tolerates(t) {
    return (t.tolerations || []).some(function (x) {
      return x.key === 'dedicated' && (x.operator === 'Exists' || x.value === 'batch') && (!x.effect || x.effect === 'NoSchedule');
    });
  }
  function s17TaintKept(m) {
    var n = KM().find(m, 'nodes', S17_BATCH);
    return !!n && (n.taints || []).some(function (t) { return t.key === 'dedicated' && t.value === 'batch' && t.effect === 'NoSchedule'; });
  }
  function s17SelectorKept(m) { var d = dep(m, 'beacon-worker'); return !!d && !!d.template.nodeSelector && d.template.nodeSelector.pool === 'batch'; }
  function s17Requests(m) {
    var d = dep(m, 'beacon-worker'), c = d && d.template.containers.filter(function (x) { return x.name === 'worker'; })[0];
    var r = ((c || {}).resources || {}).requests || {};
    return { cpu: KM().cpuMilli(r.cpu), mem: KM().memMi(r.memory) };
  }
  function s17DbIntact(c) {
    var m = M(c), s = st(c), pvc = KM().find(m, 'pvcs', 'beacon-db-data', m.ns);
    return !!pvc && pvc.phase === 'Bound' && (!s.dbVolume || pvc.volume === s.dbVolume);
  }
  function s17Pending(c) {
    var ps = podsOfApp(M(c), 'beacon-worker').filter(function (p) { return !p.node; });
    return (ps[0] || podsOfApp(M(c), 'beacon-worker')[0] || { name: 'beacon-worker' }).name;
  }
  function s17Fixed(c) {
    var m = M(c), d = dep(m, 'beacon-worker');
    if (!d) return false;
    var ct = d.template.containers.filter(function (x) { return x.name === 'worker'; })[0];
    if (!ct || ct.image !== S17_NEW) return false;
    if (!s17SelectorKept(m) || !s17Tolerates(d.template) || !s17TaintKept(m)) return false;
    var rq = s17Requests(m);
    if (!(rq.cpu > 0 && rq.cpu <= 1000 && rq.mem > 0)) return false;
    var spool = KM().find(m, 'pvcs', 'beacon-worker-spool', m.ns);
    if (!spool || spool.phase !== 'Bound' || !KM().find(m, 'storageclasses', spool.storageClassName)) return false;
    if (!s17DbIntact(c) || !KM().rolloutComplete(m, 'beacon-worker', m.ns)) return false;
    var ps = podsOfApp(m, 'beacon-worker');
    return ps.length === 1 && ps.every(function (p) { return KM().podReady(p) && p.node === S17_BATCH; });
  }
  /* `kubectl taint nodes NAME key[=value]:Effect[-]` — the base command set has no taint */
  function s17Taint(w, a) {
    var m = w.k8sModel, p = pos(a), kindTok = p[1] || '', name = p[2], specs = p.slice(3);
    if (kindTok.indexOf('/') > 0) { name = kindTok.split('/')[1]; specs = p.slice(2); kindTok = kindTok.split('/')[0]; }
    if (!/^(no|node|nodes)$/.test(kindTok) || !name || !specs.length) return res('', 1, 'error: usage: kubectl taint nodes NAME KEY[=VALUE]:EFFECT[-]  (taints apply to nodes only)');
    KM().advance(m, KM().PER_COMMAND);
    var n = KM().find(m, 'nodes', name);
    if (!n) return res('', 1, 'Error from server (NotFound): nodes "' + name + '" not found');
    var removed = false, added = false, problem = null;
    specs.forEach(function (sp) {
      var mm = /^([A-Za-z0-9_.\/-]+)(?:=([^:]*))?(?::(NoSchedule|PreferNoSchedule|NoExecute))?(-)?$/.exec(sp);
      if (!mm) { problem = 'error: invalid taint spec: ' + sp; return; }
      if (mm[4]) {
        var before = n.taints.length;
        n.taints = n.taints.filter(function (t) { return !(t.key === mm[1] && (!mm[3] || t.effect === mm[3])); });
        if (n.taints.length === before) problem = 'error: taint "' + sp.replace(/-$/, '') + '" not found';
        else removed = true;
        return;
      }
      if (!mm[3]) { problem = 'error: unknown taint spec: ' + sp + ' (an effect is required: NoSchedule, PreferNoSchedule or NoExecute)'; return; }
      if (n.taints.some(function (t) { return t.key === mm[1] && t.effect === mm[3]; }) && a.indexOf('--overwrite') === -1) { problem = 'error: node ' + name + ' already has ' + mm[1] + ' taint(s) with same effect(s) and --overwrite is false'; return; }
      n.taints = n.taints.filter(function (t) { return !(t.key === mm[1] && t.effect === mm[3]); }).concat([{ key: mm[1], value: mm[2] || undefined, effect: mm[3] }]);
      added = true;
    });
    if (problem) return res('', 1, problem);
    if (removed) KM().risky(m, 'kubectl ' + a.join(' '), 'Removed a taint from a shared node: every workload in the cluster may now land on it.');
    KM().reconcile(m);
    return res('node/' + name + ' ' + (removed && !added ? 'untainted' : 'tainted'));
  }
  function s17Kubectl(w, a) {
    var verb = pos(a)[0];
    if (verb === 'taint') return s17Taint(w, a);
    return kubectlBase(w, a);
  }
  function s17PvcYaml(cls) {
    return 'apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: beacon-worker-spool\n  namespace: beacon\nspec:\n  accessModes:\n    - ReadWriteOnce\n  storageClassName: ' + cls + '\n  resources:\n    requests:\n      storage: 2Gi\n';
  }
  function s17DepYaml(v) {
    return 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: beacon-worker\n  namespace: beacon\nspec:\n  replicas: 1\n  strategy:\n    rollingUpdate:\n      maxSurge: 1\n      maxUnavailable: 0\n  selector:\n    matchLabels:\n      app: beacon-worker\n  template:\n    metadata:\n      labels:\n        app: beacon-worker\n    spec:\n      nodeSelector:\n        pool: batch\n' +
      (v === 'b' ? '' : '      tolerations:\n        - key: dedicated\n          operator: Equal\n          value: batch\n          effect: NoSchedule\n') +
      '      containers:\n        - name: worker\n          image: ' + S17_NEW + '\n          ports:\n            - name: metrics\n              containerPort: 9100\n          resources:\n            requests:\n              cpu: "' + (v === 'a' ? '4' : '400m') + '"\n              memory: 384Mi\n            limits:\n              memory: 768Mi\n          volumeMounts:\n            - name: spool\n              mountPath: /var/spool/beacon\n      volumes:\n        - name: spool\n          persistentVolumeClaim:\n            claimName: beacon-worker-spool\n';
  }
  LX.missions.push({
    id: 'sre-s17', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'beacon-worker 1.5.0 rollout has not finished',
    brief: function () { return 'beacon-worker 1.5.0 went out to the beacon namespace on looped-foundations 20 minutes ago and the pipeline is still waiting for the rollout. The 1.4.2 worker is still processing jobs. Get 1.5.0 running where the worker is meant to run, without taking anything away from other workloads or from the data already in the namespace, and explain what held it up. Manifests are in /home/lab/beacon/k8s; release notes in RELEASE-1.5.0.md.'; },
    keys: ['kubectl get pods -o wide', 'kubectl describe pod ', 'kubectl get events --field-selector type=Warning', 'kubectl describe node ' + S17_BATCH, 'kubectl get nodes --show-labels', 'kubectl get deploy beacon-worker -o yaml', 'kubectl get pvc,sc', 'kubectl describe pvc beacon-worker-spool', 'cat RELEASE-1.5.0.md', 'kubectl rollout status deploy/beacon-worker'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
      var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], dbVolume: null };
      var oldT = s17WorkerTpl(S17_OLD, { cpu: '250m', mem: '256Mi', limit: '512Mi', tolerate: true, spool: false });
      var newT = s17WorkerTpl(S17_NEW, { cpu: v === 'a' ? '4' : '400m', mem: '384Mi', limit: '768Mi', tolerate: v !== 'b', spool: true });
      var worker = { port: 9100, readyPath: '/ready', livePath: '/healthz', startSec: 3, memMi: 90, runLogs: ['{"level":"info","msg":"beacon-worker consuming queue","queue":"jobs"}'] };
      var k8s = { namespace: 'beacon', context: 'kind-looped-foundations', now: 3600, nodes: s17Nodes(),
        registry: { 'registry.lab/beacon/api:1.4.1': { arch: ['amd64', 'arm64'] }, 'registry.lab/library/postgres:16.4': { arch: ['amd64', 'arm64'] } },
        apps: { 'registry.lab/beacon/api': beaconApiProfile('1.4.1'), 'registry.lab/beacon/worker': worker,
          'registry.lab/library/postgres': { port: 5432, readyPath: '/', livePath: '/', startSec: 6, memMi: 180, boot: ['PostgreSQL init process complete; ready for start up.', 'database system is ready to accept connections'] },
          'registry.lab/tools/toolbox': TOOLBOX },
        storageclasses: [{ name: 'standard', provisioner: 'rancher.io/local-path', bindingMode: 'WaitForFirstConsumer', reclaimPolicy: 'Delete', default: true }],
        pvcs: [{ name: 'beacon-db-data', storageClassName: 'standard', request: '10Gi', accessModes: ['ReadWriteOnce'] },
               { name: 'beacon-worker-spool', storageClassName: v === 'c' ? 'fast-ssd' : 'standard', request: '2Gi', accessModes: ['ReadWriteOnce'] }],
        services: [apiService(), { name: 'beacon-db', selector: { app: 'beacon-db' }, clusterIP: '10.96.80.12', ports: [{ name: 'pg', port: 5432, targetPort: 5432 }] }],
        deployments: [
          apiDeployment('1.4.1'),
          { name: 'beacon-db', replicas: 1, selector: { app: 'beacon-db' }, maxSurge: 0, maxUnavailable: 1, history: [{ labels: { app: 'beacon-db' }, volumes: [{ name: 'data', pvc: 'beacon-db-data' }],
            containers: [{ name: 'postgres', image: 'registry.lab/library/postgres:16.4', ports: [{ name: 'pg', containerPort: 5432 }], resources: { requests: { cpu: '500m', memory: '512Mi' }, limits: { memory: '1Gi' } } }] }] },
          { name: 'beacon-worker', replicas: 1, selector: { app: 'beacon-worker' }, maxSurge: 1, maxUnavailable: 0, changedAgo: 1200, history: [oldT, newT] },
          clientDeployment()] };
      k8s.registry[S17_OLD] = { arch: ['amd64', 'arm64'] }; k8s.registry[S17_NEW] = { arch: ['amd64', 'arm64'] }; k8s.registry[TOOLBOX_IMG] = { arch: ['amd64', 'arm64'] };
      /* remember which volume holds the database's data, so "the data is still there" is checkable */
      state.hooks.push(function (s, w) {
        var m = w && w.k8sModel; if (!m || s.dbVolume) return;
        var pvc = KM().find(m, 'pvcs', 'beacon-db-data', m.ns);
        if (pvc && pvc.volume) s.dbVolume = pvc.volume;
      });
      var notes = '# beacon-worker 1.5.0\n- durable spool: queued jobs survive a worker restart (new PVC beacon-worker-spool, 2Gi)\n- placement unchanged: the worker runs on the batch pool, as 1.4.x did\n- sizing from the load test: peak 0.3 CPU, 300Mi → requests 400m CPU / 384Mi, limit 768Mi\n- manifests regenerated by the release tooling (k8s/)\n';
      var files = [{ path: '/home/lab/beacon/RELEASE-1.5.0.md', content: notes },
        { path: '/home/lab/beacon/k8s/worker-deployment.yaml', content: s17DepYaml(v) },
        { path: '/home/lab/beacon/k8s/worker-spool-pvc.yaml', content: s17PvcYaml(v === 'c' ? 'fast-ssd' : 'standard') },
        { path: '/home/lab/beacon/k8s/README.md', content: '# beacon manifests\nThe release tooling applied worker-spool-pvc.yaml first (an hour ago, ahead of the Deployment change) and then worker-deployment.yaml. In this simulation `kubectl apply -f` is modelled for the PersistentVolumeClaim; change the Deployment with kubectl set/patch and keep worker-deployment.yaml in step.\n' }];
      return k8sWorld(state, k8s, files, s17Kubectl);
    },
    objectives: [
      { id: 'pending', stage: 'evidence', text: 'Establish which pod is holding the rollout and whether it was ever placed on a node',
        hint: 'The pipeline waits on the Deployment, the Deployment on its new pod. Has that pod been given a node?',
        hint2: '`kubectl get pods -o wide`: STATUS, and the NODE column.',
        reveal: 'kubectl get pods -o wide',
        done: function (c) { return saw(c, /k(ubectl)?\b.*\bget\s+(po|pods?|all)\b/, /beacon-worker-\S+\s+0\/1\s+Pending/); } },
      { id: 'why', stage: 'evidence', text: 'Read the scheduler\'s own explanation for that pod',
        hint: 'The scheduler writes down why it rejected each node.',
        hint2: 'The pod\'s Events (`kubectl describe pod NAME`) or `kubectl get events --field-selector type=Warning`.',
        reveal: function (c) { return 'kubectl describe pod ' + s17Pending(c); },
        done: function (c) {
          var re = { a: /FailedScheduling[\s\S]*Insufficient cpu|Insufficient cpu[\s\S]*FailedScheduling/, b: /untolerated taint \{dedicated: batch\}/, c: /unbound immediate PersistentVolumeClaims/ }[st(c).variant];
          return saw(c, /k(ubectl)?\b.*\b(describe\s+(po|pods?)|get\s+(events?|ev)|events)\b/, re);
        } },
      { id: 'compare', stage: 'evidence', text: 'Check the object the scheduler named against what the pod asks for',
        hint: 'The scheduler compared something the pod declares with something the cluster has. Look at both sides.',
        hint2: 'Nodes: `kubectl describe node NAME` (Taints, Allocatable). The pod\'s ask: `kubectl get deploy beacon-worker -o yaml`. Storage: `kubectl describe pvc NAME`, `kubectl get storageclass`.',
        reveal: function (c) { return st(c).variant === 'c' ? 'kubectl describe pvc beacon-worker-spool && kubectl get storageclass' : 'kubectl describe node ' + S17_BATCH + ' && kubectl get deploy beacon-worker -o yaml'; },
        done: function (c) {
          var v = st(c).variant;
          if (v === 'c') return saw(c, /k(ubectl)?\b.*\b(describe\s+(pvc|persistentvolumeclaims?)|get\s+(events?|ev)|events)\b/, /storageclass\.storage\.k8s\.io "fast-ssd" not found/) &&
            saw(c, /k(ubectl)?\b.*\bget\s+(sc|storageclass(es)?|pvc,sc|sc,pvc)\b/, /standard/);
          var podSide = saw(c, /k(ubectl)?\b.*\b(get\s+(deploy|deployments?|po|pods?|rs|replicasets?)\b.*-o\s*=?\s*(yaml|json)|describe\s+(deploy|deployments?|po|pods?))|cat\s+\S*worker-deployment\.yaml/,
            v === 'a' ? /cpu:\s+"?4"?\s*$/m : /nodeSelector|Node-Selectors/);
          var nodeSide = saw(c, /k(ubectl)?\b.*\b(describe\s+(no|nodes?)|get\s+(no|nodes?)\b.*-o\s*=?\s*(yaml|json)|top\s+(no|nodes?))/, v === 'a' ? /Allocatable|allocatable|CPU\(cores\)/ : /dedicated=batch:NoSchedule|key: dedicated/);
          return podSide && nodeSide;
        } },
      { id: 'fix', stage: 'fix', text: 'Get 1.5.0 Ready on the batch pool with a realistic request, its storage bound and existing data untouched',
        hint: 'Correct the one thing the scheduler named, on the workload\'s side. The cluster\'s rules (taints, other teams\' nodes, bound volumes) stay as they are.',
        hint2: 'Requests: `kubectl set resources deploy beacon-worker -c worker --requests=cpu=…`. Tolerations: `kubectl patch deploy beacon-worker -p \'{"spec":{"template":{"spec":{"tolerations":[…]}}}}\'`. A claim\'s class cannot be edited in place; an unbound, empty claim can be recreated from a corrected manifest.',
        reveal: function (c) {
          var v = st(c).variant;
          if (v === 'a') return 'kubectl set resources deploy beacon-worker -c worker --requests=cpu=400m';
          if (v === 'b') return 'kubectl patch deploy beacon-worker -p \'{"spec":{"template":{"spec":{"tolerations":[{"key":"dedicated","operator":"Equal","value":"batch","effect":"NoSchedule"}]}}}}\'';
          return 'sed -i \'s/storageClassName: fast-ssd/storageClassName: standard/\' k8s/worker-spool-pvc.yaml && kubectl delete pvc beacon-worker-spool && kubectl apply -f k8s/worker-spool-pvc.yaml';
        },
        done: function (c) { return s17Fixed(c); } },
      { id: 'verify', stage: 'verify', text: 'Verify the rollout completed and the new worker is running where it belongs',
        hint: 'Ask the Deployment, then look at where its pod landed.',
        hint2: '`kubectl rollout status deploy/beacon-worker`, then `kubectl get pods -o wide`.',
        reveal: 'kubectl rollout status deploy/beacon-worker && kubectl get pods -o wide',
        done: function (c) { return s17Fixed(c) && lastIs(c, /k(ubectl)?\b.*\bget\s+(po|pods?)\b.*-o\s*=?\s*wide/, new RegExp('beacon-worker-\\S+\\s+1/1\\s+Running[^\\n]*' + S17_BATCH)) && lastCode(c) === 0; } }
    ],
    sre: {
      scenarioId: 'S17', moduleId: 'M09', lab: 'L17', variants: ['a', 'b', 'c'],
      symptom: 'The new beacon-worker pod sits in Pending with no node; the rollout never completes and the old worker keeps running.',
      neutralTitle: 'beacon-worker release not finishing',
      neutralBrief: 'beacon-worker 1.5.0 went out to the beacon namespace 20 minutes ago and the rollout has not finished; 1.4.2 is still processing jobs. Get 1.5.0 running where the worker is meant to run, without taking anything away from other workloads or from data already in the namespace, and explain what held it up.',
      impact: 'None yet for users — maxUnavailable 0 kept the 1.4.2 worker — but the release (durable spool) is blocked and the pipeline will fail at its deadline.',
      changes: 'Release tooling regenerated the worker manifests for 1.5.0 and applied them 20 minutes ago.',
      spoilers: ['Insufficient', 'taint', 'toleration', 'request', 'StorageClass', 'storage class', 'fast-ssd', 'PVC', 'claim', 'Pending', 'cpu'],
      tools: ['kubectl (get, describe, events, rollout, set resources, patch, apply -f for a PVC, delete, taint)', 'cat', 'sed -i', 'diff'],
      grammar: [
        '`kubectl get pods|deploy|rs|nodes|pvc|pv|sc|events [NAME] [-o wide|yaml|json] [--show-labels]`, `kubectl get pvc,sc`, `kubectl describe pod|deploy|node|pvc NAME`',
        '`kubectl set resources deploy/beacon-worker -c worker --requests=cpu=…,memory=…`, `kubectl patch deploy beacon-worker -p \'JSON\'`, `kubectl rollout status|history|undo deploy/beacon-worker`',
        '`kubectl apply -f FILE` (PersistentVolumeClaim, ConfigMap), `kubectl delete pvc NAME`, `kubectl taint nodes NAME KEY=VALUE:EFFECT[-]`, `kubectl top node`'
      ],
      palette: ['kubectl get pods -o wide', 'kubectl describe pod ', 'kubectl get events --field-selector type=Warning', 'kubectl get nodes --show-labels', 'kubectl describe node ' + S17_BATCH, 'kubectl get deploy beacon-worker -o yaml', 'kubectl get pvc,sc', 'kubectl describe pvc beacon-worker-spool', 'cat k8s/worker-spool-pvc.yaml', 'kubectl rollout status deploy/beacon-worker'],
      assumptions: ['The batch pool (looped-foundations-worker3, label pool=batch, taint dedicated=batch:NoSchedule) belongs to batch workloads; the worker is one of them and has always run there.', 'Nodes and their taints are shared, cluster-scoped objects owned by the platform team.', 'beacon-db-data holds the PostgreSQL data for Beacon; it has been in use for weeks.', 'This environment offers the storage classes the cluster lists; creating new classes is out of scope.'],
      simplified: K8S_SIMPLIFIED.concat([
        'Scheduling checks node selector, taints (NoSchedule/NoExecute), then requested CPU and memory against allocatable minus what other pods request; scoring, affinity weights and preemption are not modelled.',
        'Storage: one local-path StorageClass with WaitForFirstConsumer; a claim naming a class that does not exist never binds. A claim\'s class is immutable, as on a real API server. Volume contents are not modelled — "data" means the bound claim and its volume still exist.',
        'Adding a NoExecute taint does not evict running pods here; removal and NoSchedule are modelled.'
      ]),
      unsafe: [
        { label: 'removed the batch pool\'s taint', why: 'The taint is how the platform keeps general workloads off the batch nodes. Removing it lets every pod in the cluster land there, and it is not this team\'s object. The worker is supposed to tolerate it, not erase it.',
          test: function (c) { return !s17TaintKept(M(c)); },
          demo: 'kubectl taint nodes ' + S17_BATCH + ' dedicated=batch:NoSchedule-' },
        { label: 'set the worker\'s requests to zero', why: 'Zero (or no) requests makes the pod BestEffort: the scheduler packs it anywhere, it is the first evicted under pressure, and nothing reserves the CPU it really uses. The request should be what the workload needs — the release notes say 400m.',
          test: function (c) { var r = s17Requests(M(c)); return !!dep(M(c), 'beacon-worker') && !(r.cpu > 0 && r.mem > 0); },
          demo: 'kubectl set resources deploy beacon-worker -c worker --requests=cpu=0,memory=0' },
        { label: 'deleted a claim that holds data', why: 'beacon-db-data is Bound and holds the database. With reclaimPolicy Delete, deleting the claim deletes the volume and the data with it. Only an unbound, never-used claim is safe to recreate.',
          test: function (c) { return !s17DbIntact(c); },
          demo: 'kubectl delete pvc beacon-db-data' },
        { label: 'moved the worker off its pool', why: 'Dropping the node selector gets the pod scheduled by putting batch work on the general nodes the API depends on. Placement was intended; fix what stopped the intended placement.',
          test: function (c) { return !!dep(M(c), 'beacon-worker') && !s17SelectorKept(M(c)); },
          demo: 'kubectl patch deploy beacon-worker -p \'{"spec":{"template":{"spec":{"nodeSelector":null}}}}\'' }
      ],
      alt: function (v) {
        if (v === 'a') return ['kubectl get deploy beacon-worker', 'kubectl get pods', 'kubectl get events --field-selector type=Warning', 'kubectl get nodes --show-labels',
          'kubectl describe node ' + S17_BATCH, 'cat k8s/worker-deployment.yaml', 'cat RELEASE-1.5.0.md',
          'sed -i \'s/cpu: "4"/cpu: "400m"/\' k8s/worker-deployment.yaml', 'kubectl set resources deploy/beacon-worker --requests=cpu=400m,memory=384Mi',
          'kubectl rollout status deploy/beacon-worker', 'kubectl get pods -o wide'];
        if (v === 'b') return ['kubectl rollout status deploy/beacon-worker --timeout=20s', 'kubectl get pods', 'kubectl get events --field-selector type=Warning',
          'kubectl get nodes -o yaml', 'kubectl describe pod ' + 'beacon-worker', 'kubectl rollout history deploy/beacon-worker',
          'kubectl patch deploy beacon-worker -p \'{"spec":{"template":{"spec":{"tolerations":[{"key":"dedicated","operator":"Exists","effect":"NoSchedule"}]}}}}\'',
          'kubectl rollout status deploy/beacon-worker', 'kubectl get pods -o wide'];
        return ['kubectl get pods', 'kubectl get events --field-selector type=Warning', 'kubectl get pvc,sc', 'kubectl describe pvc beacon-worker-spool', 'cat k8s/worker-spool-pvc.yaml',
          'kubectl patch pvc beacon-worker-spool -p \'{"spec":{"storageClassName":"standard"}}\'',
          'edit k8s/worker-spool-pvc.yaml spec.storageClassName standard', 'kubectl delete pvc beacon-worker-spool', 'kubectl apply -f k8s/worker-spool-pvc.yaml',
          'kubectl get pvc', 'kubectl rollout status deploy/beacon-worker', 'kubectl get pods -o wide'];
      },
      mechanism: 'A pod with no node is the scheduler saying no: it filters every node and records why each was rejected in a **FailedScheduling** event. With maxUnavailable 0 the Deployment keeps the 1.4.2 pod, so nothing breaks while the rollout waits for its progress deadline. Depending on the seed the 1.5.0 manifests carry one of three faults: (a) the CPU request is `"4"` (four whole cores) where the release notes say 400m — no node has 4 CPUs allocatable after what is already requested, so the event reads **Insufficient cpu**; scheduling compares requests with allocatable, not with live usage; (b) the regenerated template lost the worker\'s **toleration** for the batch pool\'s `dedicated=batch:NoSchedule` taint while keeping its `pool: batch` node selector, so the only node it may use repels it (**untolerated taint**) and every other node fails the selector; (c) the new spool claim names a StorageClass, `fast-ssd`, that exists in another environment but not here, so it never binds and the scheduler reports **unbound immediate PersistentVolumeClaims**. The fixes stay on the workload\'s side: right-size the request, add the toleration the worker is meant to have, or recreate the empty, never-bound claim (a claim\'s class is immutable) on the class that exists. The two other "Pending" things you may notice — the 1.4.2 pod on worker3, and the spool claim waiting for its first consumer in (a)/(b) — are expected, not faults.',
      alternatives: [
        { h: 'The image cannot be pulled', out: 'Ruled out: an unscheduled pod never reaches image pull — it has no node. ImagePullBackOff shows as a container state after scheduling.' },
        { h: 'The batch node is out of resources because of other pods', out: 'Partly true in (a) only in the sense that the request is compared with allocatable minus requests; but 4 cores cannot fit an empty batch node either. Evicting the 1.4.2 pod would not help.' },
        { h: 'The spool claim is broken in every variant', out: 'Ruled out in (a)/(b): WaitForFirstConsumer means the claim waits for the pod to be scheduled; it binds as soon as the pod gets a node.' }
      ],
      clues: ['"0/4 nodes are available" lists one reason per node group; the reason for the node the pod should use is the one that matters.', 'Deleting the Pending pod produces an identical Pending pod: the template is the problem, not the pod.'],
      passRubric: ['Quotes the FailedScheduling reason and maps it to the request, taint or claim', 'Changes the workload, not the shared node or bound data', 'Explains requests vs allocatable, or taints vs tolerations, or claim binding, as the seed requires', 'Verifies the rollout and the node the new pod landed on'],
      prereqs: ['les-m09-01', 'les-m09-02', 'les-m09-03'], refs: ['T02', 'T04']
    }
  });
  /* ═══ S18 · Service reachable by IP test but app hostname fails ═══════
     A NetworkPolicy model over the cluster model: policies live in the
     scenario state (applied from YAML files), an evaluator decides each
     egress connection the way an enforcing network plugin does (post-DNAT
     pod address and port, union of every policy that selects the source),
     and the in-pod network tools print what that decision produces. */
  var S18_API_IMG = 'registry.lab/beacon/api';
  var KUBE_DNS_IP = '10.96.0.10';
  var S18_NS = {
    'default': { 'kubernetes.io/metadata.name': 'default' },
    'kube-node-lease': { 'kubernetes.io/metadata.name': 'kube-node-lease' },
    'kube-public': { 'kubernetes.io/metadata.name': 'kube-public' },
    'kube-system': { 'kubernetes.io/metadata.name': 'kube-system' },
    'local-path-storage': { 'kubernetes.io/metadata.name': 'local-path-storage' },
    'beacon': { 'kubernetes.io/metadata.name': 'beacon', team: 'beacon' }
  };
  var S18_SYS = [
    { name: 'coredns-6f6b679f8f-2xk9p', ip: '10.244.0.2', node: 'looped-policy-control-plane', labels: { 'k8s-app': 'kube-dns', 'pod-template-hash': '6f6b679f8f' }, dns: true },
    { name: 'coredns-6f6b679f8f-qwm7t', ip: '10.244.0.3', node: 'looped-policy-control-plane', labels: { 'k8s-app': 'kube-dns', 'pod-template-hash': '6f6b679f8f' }, dns: true },
    { name: 'etcd-looped-policy-control-plane', ip: '172.18.0.3', node: 'looped-policy-control-plane', labels: { component: 'etcd', tier: 'control-plane' } },
    { name: 'kube-apiserver-looped-policy-control-plane', ip: '172.18.0.3', node: 'looped-policy-control-plane', labels: { component: 'kube-apiserver', tier: 'control-plane' } },
    { name: 'kube-proxy-7mqlx', ip: '172.18.0.3', node: 'looped-policy-control-plane', labels: { 'k8s-app': 'kube-proxy' } },
    { name: 'kube-proxy-p2dkw', ip: '172.18.0.4', node: 'looped-policy-worker', labels: { 'k8s-app': 'kube-proxy' } },
    { name: 'kube-proxy-zr9vb', ip: '172.18.0.5', node: 'looped-policy-worker2', labels: { 'k8s-app': 'kube-proxy' } }
  ];
  var S18_EXT = {
    '203.0.113.10': { name: 'partner-api.example.net', listen: ['443/TCP'] },
    '198.51.100.53': { name: 'resolver.example.net', listen: ['53/UDP', '53/TCP'] }
  };
  function s18DnsDst() {
    var c = S18_SYS[0];
    return { ip: c.ip, ns: 'kube-system', labels: c.labels, kind: 'pod', name: c.name,
      ports: [{ name: 'dns', port: 53, protocol: 'UDP' }, { name: 'dns-tcp', port: 53, protocol: 'TCP' }, { name: 'metrics', port: 9153, protocol: 'TCP' }],
      listen: ['53/UDP', '53/TCP', '9153/TCP'] };
  }
  function s18ExtDst(ip) { var e = S18_EXT[ip]; return { ip: ip, ns: null, labels: null, kind: 'external', name: e ? e.name : ip, ports: [], listen: e ? e.listen : [] }; }
  function s18PodDst(m, p) {
    var prof = KM().profileFor(m, p.containers[0].image), ports = [];
    (p.spec.containers || []).forEach(function (c) { (c.ports || []).forEach(function (cp) { ports.push({ name: cp.name, port: cp.containerPort, protocol: 'TCP' }); }); });
    var up = p.containers[0] && p.containers[0].state === 'running';
    return { ip: p.ip, ns: p.ns, labels: p.labels, kind: 'pod', name: p.name, ports: ports, listen: up ? [prof.port + '/TCP'] : [] };
  }
  function s18AppDst(app, port, name) { return { ip: null, ns: 'beacon', labels: { app: app }, kind: 'pod', name: app, ports: [{ name: name, port: port, protocol: 'TCP' }], listen: [port + '/TCP'] }; }

  /* ── selectors and the egress decision ─────────────────────────── */
  function selMatch(sel, labels) {
    if (sel == null || typeof sel !== 'object') return true;
    labels = labels || {};
    var ml = sel.matchLabels || {}, me = sel.matchExpressions || [];
    var okL = Object.keys(ml).every(function (k) { return labels[k] !== undefined && String(labels[k]) === String(ml[k]); });
    var okE = me.every(function (e) {
      var v = labels[e.key], vals = (e.values || []).map(String);
      if (e.operator === 'In') return v !== undefined && vals.indexOf(String(v)) !== -1;
      if (e.operator === 'NotIn') return v === undefined || vals.indexOf(String(v)) === -1;
      if (e.operator === 'Exists') return v !== undefined;
      if (e.operator === 'DoesNotExist') return v === undefined;
      return false;
    });
    return okL && okE;
  }
  function selStr(sel) {
    if (sel == null || typeof sel !== 'object') return '';
    var parts = Object.keys(sel.matchLabels || {}).map(function (k) { return k + '=' + sel.matchLabels[k]; });
    (sel.matchExpressions || []).forEach(function (e) { parts.push(e.key + ' ' + String(e.operator).toLowerCase() + (e.values ? ' (' + e.values.join(',') + ')' : '')); });
    return parts.join(',');
  }
  function ip2n(ip) { var p = String(ip).split('.').map(Number); return p.length === 4 && p.every(function (x) { return x >= 0 && x <= 255; }) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null; }
  function ipIn(ip, cidr) {
    var c = String(cidr || '').split('/'), base = ip2n(c[0]), bits = c.length > 1 ? Number(c[1]) : 32, x = ip2n(ip);
    if (base == null || x == null || !(bits >= 0 && bits <= 32)) return false;
    if (bits === 0) return true;
    var mask = (0xffffffff << (32 - bits)) >>> 0;
    return ((x & mask) >>> 0) === ((base & mask) >>> 0);
  }
  function peerMatches(peer, dst, polNs) {
    if (!peer || typeof peer !== 'object') return false;
    if (peer.ipBlock) {
      if (!dst.ip || !ipIn(dst.ip, peer.ipBlock.cidr)) return false;
      return !(peer.ipBlock.except || []).some(function (x) { return ipIn(dst.ip, x); });
    }
    if (!dst.ns) return false;   /* only ipBlock selects addresses outside the cluster */
    if (peer.namespaceSelector != null) { if (!selMatch(peer.namespaceSelector, S18_NS[dst.ns])) return false; }
    else if (dst.ns !== polNs) return false;
    if (peer.podSelector != null) return selMatch(peer.podSelector, dst.labels);
    return true;
  }
  function portMatches(pp, dst, port, proto) {
    if ((pp.protocol || 'TCP') !== proto) return false;
    if (pp.port == null) return true;
    if (typeof pp.port === 'number' || /^\d+$/.test(String(pp.port))) {
      var lo = Number(pp.port), hi = pp.endPort != null ? Number(pp.endPort) : lo;
      return port >= lo && port <= hi;
    }
    return (dst.ports || []).some(function (cp) { return cp.name === pp.port && cp.port === port && (cp.protocol || 'TCP') === proto; });
  }
  function hasEgressType(p) {
    var s = p.spec || {};
    if (s.policyTypes) return s.policyTypes.indexOf('Egress') !== -1;
    return s.egress != null;
  }
  function egressAllowed(state, src, dst, port, proto) {
    var applicable = state.pols.filter(function (p) { return (p.metadata.namespace || 'beacon') === src.ns && selMatch(p.spec.podSelector, src.labels) && hasEgressType(p); });
    if (!applicable.length) return true;
    return applicable.some(function (p) {
      return (p.spec.egress || []).some(function (rule) {
        rule = rule || {};
        var to = rule.to, ports = rule.ports;
        var toOk = !to || !to.length || to.some(function (peer) { return peerMatches(peer, dst, p.metadata.namespace || 'beacon'); });
        var portOk = !ports || !ports.length || ports.some(function (pp) { return portMatches(pp || {}, dst, port, proto); });
        return toOk && portOk;
      });
    });
  }
  function listens(dst, port, proto) { return (dst.listen || []).indexOf(port + '/' + proto) !== -1; }

  /* ── names: CoreDNS with the pod's search path (ndots:5) ───────── */
  function s18Names(m) {
    var t = {};
    m.services.forEach(function (s) { if (!s.gone) t[s.name + '.' + s.ns + '.svc.cluster.local'] = s.clusterIP; });
    t['kube-dns.kube-system.svc.cluster.local'] = KUBE_DNS_IP;
    t['kubernetes.default.svc.cluster.local'] = '10.96.0.1';
    Object.keys(S18_EXT).forEach(function (ip) { t[S18_EXT[ip].name] = ip; });
    return t;
  }
  function s18Lookup(m, name, search) {
    var t = s18Names(m), n = String(name).replace(/\.$/, ''), abs = /\.$/.test(name);
    var cands = [];
    if (!abs && search && n.split('.').length - 1 < 5) ['beacon.svc.cluster.local', 'svc.cluster.local', 'cluster.local'].forEach(function (d) { cands.push(n + '.' + d); });
    cands.push(n);
    for (var i = 0; i < cands.length; i++) if (t[cands[i]]) return { fqdn: cands[i], ip: t[cands[i]] };
    return null;
  }
  /* resolve NAME from SRC: needs egress to a CoreDNS pod on 53/PROTO */
  function s18Resolve(state, m, src, name, proto, server, search) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return { ok: true, ip: name, fqdn: name };
    var srvIp = server || KUBE_DNS_IP;
    var dst = srvIp === KUBE_DNS_IP || srvIp === S18_SYS[0].ip || srvIp === S18_SYS[1].ip ? s18DnsDst() : S18_EXT[srvIp] ? s18ExtDst(srvIp) : null;
    if (!dst) return { ok: false, why: 'timeout', server: srvIp };
    if (!egressAllowed(state, src, dst, 53, proto) || !listens(dst, 53, proto)) return { ok: false, why: 'timeout', server: srvIp };
    if (dst.kind === 'external') {
      var pub = S18_EXT[Object.keys(S18_EXT).filter(function (ip) { return S18_EXT[ip].name === String(name).replace(/\.$/, ''); })[0]];
      return pub ? { ok: true, ip: Object.keys(S18_EXT).filter(function (ip) { return S18_EXT[ip] === pub; })[0], fqdn: pub.name, server: srvIp } : { ok: false, why: 'nxdomain', server: srvIp };
    }
    var hit = s18Lookup(m, name, search !== false);
    return hit ? { ok: true, ip: hit.ip, fqdn: hit.fqdn, server: srvIp } : { ok: false, why: 'nxdomain', server: srvIp };
  }
  /* where a connection to IP:PORT actually lands (Service ClusterIPs are DNATed to a ready backend) */
  function s18Target(m, ip, port) {
    if (ip === KUBE_DNS_IP) return { dst: s18DnsDst(), port: port };
    var svc = m.services.filter(function (s) { return !s.gone && s.clusterIP === ip; })[0];
    if (svc) {
      var sp = (svc.ports || []).filter(function (x) { return x.port === port; })[0];
      if (!sp) return { none: 'timeout' };
      var ep = KM().endpoints(m, svc);
      if (!ep.ready.length) return { none: 'refused' };
      return { dst: s18PodDst(m, ep.ready[0]), port: KM().resolveTarget(m, sp, ep.ready[0]) };
    }
    var pod = m.pods.filter(function (p) { return !p.gone && p.ip === ip; })[0];
    if (pod) return { dst: s18PodDst(m, pod), port: port };
    var sys = S18_SYS.filter(function (p) { return p.ip === ip && p.dns; })[0];
    if (sys) return { dst: s18DnsDst(), port: port };
    return { dst: s18ExtDst(ip), port: port };
  }
  /* can beacon-api do its job? — DNS for its store host, then TCP to the database */
  var S18_SRC = { api: { ns: 'beacon', labels: { app: 'beacon-api' } }, client: { ns: 'beacon', labels: { app: 'beacon-client' } }, db: { ns: 'beacon', labels: { app: 'beacon-db' } } };
  function s18Store(state, m) {
    var r = s18Resolve(state, m, S18_SRC.api, 'beacon-db.beacon.svc', 'UDP');
    if (!r.ok) return { ok: false, msg: 'could not translate host name \\"beacon-db.beacon.svc\\" to address: Temporary failure in name resolution' };
    var t = s18Target(m, r.ip, 5432);
    if (!t.dst || !egressAllowed(state, S18_SRC.api, t.dst, t.port, 'TCP')) return { ok: false, msg: 'connection to server at \\"beacon-db.beacon.svc\\" (' + r.ip + '), port 5432 failed: timeout expired' };
    return { ok: true };
  }
  function s18Eval(state, m) {
    var dns = s18DnsDst(), api = S18_SRC.api, client = S18_SRC.client, db = S18_SRC.db, ext = s18ExtDst('203.0.113.10'), extDns = s18ExtDst('198.51.100.53');
    return {
      dns: [api, client].every(function (s) { return egressAllowed(state, s, dns, 53, 'UDP') && egressAllowed(state, s, dns, 53, 'TCP'); }),
      noExtDns: [api, client, db].every(function (s) { return !egressAllowed(state, s, extDns, 53, 'UDP') && !egressAllowed(state, s, extDns, 53, 'TCP'); }),
      noExt: [api, client, db].every(function (s) { return !egressAllowed(state, s, ext, 443, 'TCP'); }),
      apiDb: egressAllowed(state, api, s18AppDst('beacon-db', 5432, 'pg'), 5432, 'TCP'),
      clientApi: egressAllowed(state, client, s18AppDst('beacon-api', 8080, 'http'), 8080, 'TCP'),
      deny: s18DenyIntact(state)
    };
  }
  function s18DenyIntact(state) {
    var p = state.pols.filter(function (x) { return x.metadata.name === 'default-deny-egress'; })[0];
    if (!p) return false;
    var sel = p.spec.podSelector;
    return (sel == null || (!Object.keys(sel.matchLabels || {}).length && !(sel.matchExpressions || []).length)) && hasEgressType(p) && !(p.spec.egress || []).length;
  }
  function s18PolicyFixed(state, m) { var e = s18Eval(state, m); return e.dns && e.noExtDns && e.noExt && e.apiDb && e.clientApi && e.deny; }
  function s18Fixed(c) { return s18PolicyFixed(st(c), M(c)) && readyOf(M(c), 'beacon-api') >= 2; }

  /* ── NetworkPolicy documents: validate, store, print ───────────── */
  function s18Validate(doc) {
    var md = doc.metadata || {}, s = doc.spec;
    if (doc.apiVersion !== 'networking.k8s.io/v1') return 'error: resource mapping not found for name: "' + (md.name || '') + '": no matches for kind "NetworkPolicy" in version "' + (doc.apiVersion || '') + '" (use networking.k8s.io/v1)';
    if (!md.name) return 'error: error validating data: metadata.name not set';
    if (!s || typeof s !== 'object') return 'The NetworkPolicy "' + md.name + '" is invalid: spec: Required value';
    if (s.podSelector === undefined) return 'The NetworkPolicy "' + md.name + '" is invalid: spec.podSelector: Required value (use podSelector: {} to select every pod)';
    var bad = null;
    (s.policyTypes || []).forEach(function (t) { if (t !== 'Ingress' && t !== 'Egress') bad = 'spec.policyTypes: Unsupported value: "' + t + '": supported values: "Ingress", "Egress"'; });
    ['egress', 'ingress'].forEach(function (dir) {
      if (s[dir] != null && !Array.isArray(s[dir])) { bad = 'spec.' + dir + ': Invalid value: must be a list of rules'; return; }
      (s[dir] || []).forEach(function (r, i) {
        r = r || {};
        var peers = dir === 'egress' ? r.to : r.from;
        (peers || []).forEach(function (p, j) {
          if (!p || typeof p !== 'object' || !(p.podSelector !== undefined || p.namespaceSelector !== undefined || p.ipBlock)) bad = 'spec.' + dir + '[' + i + '].' + (dir === 'egress' ? 'to' : 'from') + '[' + j + ']: Required value: must specify a peer';
          if (p && p.ipBlock && (p.podSelector !== undefined || p.namespaceSelector !== undefined)) bad = 'spec.' + dir + '[' + i + '].' + (dir === 'egress' ? 'to' : 'from') + '[' + j + ']: Forbidden: may not specify both ipBlock and another peer';
          if (p && p.ipBlock && ip2n(String(p.ipBlock.cidr || '').split('/')[0]) == null) bad = 'spec.' + dir + '[' + i + '].to[' + j + '].ipBlock.cidr: Invalid value: "' + (p.ipBlock.cidr || '') + '"';
        });
        (r.ports || []).forEach(function (pp, j) {
          pp = pp || {};
          if (pp.protocol && ['TCP', 'UDP', 'SCTP'].indexOf(pp.protocol) === -1) bad = 'spec.' + dir + '[' + i + '].ports[' + j + '].protocol: Unsupported value: "' + pp.protocol + '": supported values: "SCTP", "TCP", "UDP"';
        });
      });
    });
    return bad ? 'The NetworkPolicy "' + md.name + '" is invalid: ' + bad : null;
  }
  function s18Canon(doc) {
    var d = clone(doc);
    d.metadata = { name: doc.metadata.name, namespace: doc.metadata.namespace || 'beacon' };
    return d;
  }
  function s18Docs(text) {
    var parts = String(text).split(/^---\s*$/m).filter(function (x) { return x.replace(/#.*$/gm, '').trim(); });
    return parts.map(function (t) { return parseY(t); });
  }
  function s18Apply(state, w, file) {
    var n = LXShell.node(w, file);
    if (!n) return { err: 'error: the path "' + file + '" does not exist' };
    var paths = [];
    if (n.t === 'd') {
      Object.keys(w.fs).filter(function (p) { return p.indexOf(LXShell.resolve(w, file).replace(/\/$/, '') + '/') === 0 && /\.ya?ml$/.test(p) && p.slice(LXShell.resolve(w, file).replace(/\/$/, '').length + 1).indexOf('/') === -1; }).sort().forEach(function (p) { paths.push(p); });
    } else paths = [file];
    var out = [], others = [];
    for (var i = 0; i < paths.length; i++) {
      var docs;
      try { docs = s18Docs(readF(w, paths[i]) || ''); } catch (e) { return { err: 'error: error parsing ' + paths[i] + ': ' + e.message, out: out }; }
      for (var j = 0; j < docs.length; j++) {
        var d = docs[j];
        if (!d || !d.kind) return { err: 'error: error validating "' + paths[i] + '": kind not set', out: out };
        if (d.kind !== 'NetworkPolicy') { others.push(paths[i]); continue; }
        var bad = s18Validate(d);
        if (bad) return { err: bad, out: out };
        var ns = (d.metadata || {}).namespace || 'beacon';
        if (ns !== 'beacon') return { err: 'Error from server (Forbidden): networkpolicies.networking.k8s.io is forbidden: User "beacon-oncall" cannot create resource "networkpolicies" in API group "networking.k8s.io" in the namespace "' + ns + '"', out: out };
        var doc = s18Canon(d), cur = state.pols.filter(function (p) { return p.metadata.name === doc.metadata.name; })[0];
        if (cur && JSON.stringify(cur.spec) === JSON.stringify(doc.spec)) { out.push('networkpolicy.networking.k8s.io/' + doc.metadata.name + ' unchanged'); continue; }
        doc.created = cur ? cur.created : state.clock;
        if (cur) state.pols[state.pols.indexOf(cur)] = doc; else state.pols.push(doc);
        out.push('networkpolicy.networking.k8s.io/' + doc.metadata.name + (cur ? ' configured' : ' created'));
      }
    }
    return { out: out, others: others };
  }
  function s18Describe(state, p) {
    var s = p.spec || {}, types = s.policyTypes || (s.egress != null ? ['Ingress', 'Egress'] : ['Ingress']);
    var L = ['Name:         ' + p.metadata.name, 'Namespace:    ' + p.metadata.namespace, 'Created on:   ' + SIM().stamp({ clock: (p.created || 0) - 480 }).replace('T', ' ').replace('Z', ' +0000 UTC'), 'Labels:       <none>', 'Annotations:  <none>', 'Spec:'];
    var ps = selStr(s.podSelector);
    L.push('  PodSelector:     ' + (ps || '<none> (Allowing the specific traffic to all pods in this namespace)'));
    function rules(dir, word, peerKey) {
      if (types.indexOf(dir) === -1) { L.push('  Not affecting ' + word + ' traffic'); return; }
      L.push('  Allowing ' + word + ' traffic:');
      var rs = s[word] || [];
      if (!rs.length) { L.push('    <none> (Selected pods are isolated for ' + word + ' connectivity)'); return; }
      rs.forEach(function (r, i) {
        r = r || {};
        if (i) L.push('    ----------');
        if (r.ports && r.ports.length) r.ports.forEach(function (pp) { L.push('    ' + (word === 'egress' ? 'To' : 'From') + ' Port: ' + (pp.port == null ? '<any>' : pp.port) + '/' + (pp.protocol || 'TCP')); });
        else L.push('    ' + (word === 'egress' ? 'To' : 'From') + ' Port: <any> (traffic allowed to all ports)');
        var peers = r[peerKey];
        if (peers && peers.length) {
          L.push('    ' + (word === 'egress' ? 'To:' : 'From:'));
          peers.forEach(function (pe) {
            if (pe.ipBlock) { L.push('      IPBlock:'); L.push('        CIDR: ' + pe.ipBlock.cidr); L.push('        Except: ' + (pe.ipBlock.except || []).join(', ')); return; }
            if (pe.namespaceSelector != null) L.push('      NamespaceSelector: ' + (selStr(pe.namespaceSelector) || '<none>'));
            if (pe.podSelector != null) L.push('      PodSelector: ' + (selStr(pe.podSelector) || '<none>'));
          });
        } else L.push('    ' + (word === 'egress' ? 'To' : 'From') + ': <any> (traffic not restricted by ' + (word === 'egress' ? 'destination' : 'source') + ')');
      });
    }
    rules('Ingress', 'ingress', 'from');
    rules('Egress', 'egress', 'to');
    L.push('  Policy Types: ' + types.join(', '));
    return L.join('\n');
  }
  function s18View(p) { return { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: { name: p.metadata.name, namespace: p.metadata.namespace }, spec: p.spec }; }
  var NETPOL = /^(netpol|netpols|networkpolicy|networkpolicies|networkpolicies\.networking\.k8s\.io|networkpolicy\.networking\.k8s\.io)$/;

  /* ── in-pod network tools ──────────────────────────────────────── */
  /* curl -s hides its own error line (exit status still says what happened) unless -S is given */
  function curlSilent(args) {
    var fl = args.filter(function (x) { return /^-[a-zA-Z]+$/.test(x); }).join('');
    return fl.indexOf('s') !== -1 && fl.indexOf('S') === -1;
  }
  function s18Exec(state, w, a, base) {
    var r = s18ExecRaw(state, w, a, base), di = a.indexOf('--'), cmd = a.slice(di + 1);
    if ((cmd[0] === 'curl') && r.code && curlSilent(cmd.slice(1))) return { out: r.out || '', code: r.code };
    return r;
  }
  function s18ExecRaw(state, w, a, base) {
    var m = w.k8sModel, di = a.indexOf('--'), before = a.slice(0, di), cmd = a.slice(di + 1), prog = cmd[0];
    var ref = pos(before)[1], ns = nsOf(before);
    if (['nslookup', 'dig', 'host', 'getent', 'curl', 'wget', 'nc', 'ncat', 'netcat', 'ping', 'sh', 'bash', 'telnet'].indexOf(prog) === -1) return base(w, a);
    if (ns && ns !== 'beacon') { KM().advance(m, KM().PER_COMMAND); return res('', 1, 'error: exec into pods outside the beacon namespace is not modelled in this simulation'); }
    KM().advance(m, KM().PER_COMMAND);
    var p = podFor(m, ref);
    if (!p) return res('', 1, 'Error from server (NotFound): pods "' + String(ref || '').replace(/^.*\//, '') + '" not found');
    if (!p.containers.some(function (c) { return c.state === 'running'; })) return res('', 1, 'error: unable to upgrade connection: container not found ("' + p.containers[0].name + '")');
    var src = { ns: p.ns, labels: p.labels };
    var args = cmd.slice(1);
    if (prog === 'sh' || prog === 'bash') return res('', 1, 'error: shells inside the pod are not modelled; run one tool per exec: nslookup, dig, getent hosts, curl, nc');
    if (prog === 'ping') return res('', 1, 'ping: ICMP is not modelled in this simulation (NetworkPolicy here covers TCP and UDP). Use nc -zv -w 3 HOST PORT or nslookup.');
    if (prog === 'nslookup' || prog === 'host') {
      var vc = args.indexOf('-vc') !== -1, nonf = args.filter(function (x) { return x.charAt(0) !== '-'; });
      var name = nonf[0], server = nonf[1] || null;
      if (!name) return res('', 1, 'usage: nslookup [-vc] NAME [SERVER]');
      var r = s18Resolve(state, m, src, name, vc ? 'TCP' : 'UDP', server);
      var sv = r.server || KUBE_DNS_IP;
      if (!r.ok && r.why === 'timeout' && S18_EXT[sv] && s18PolicyFixed(state, m)) state.negAfterFix = true;
      if (!r.ok && r.why === 'timeout') return res(';; connection timed out; no servers could be reached\n', 1);
      if (!r.ok) return res('Server:\t\t' + sv + '\nAddress:\t' + sv + '#53\n\n** server can\'t find ' + name + ': NXDOMAIN\n', 1);
      return res('Server:\t\t' + sv + '\nAddress:\t' + sv + '#53\n\nName:\t' + r.fqdn + '\nAddress: ' + r.ip + '\n');
    }
    if (prog === 'dig') {
      var tcp = args.indexOf('+tcp') !== -1 || args.indexOf('+vc') !== -1, short = args.indexOf('+short') !== -1, search = args.indexOf('+search') !== -1;
      var at = args.filter(function (x) { return x.charAt(0) === '@'; })[0], dn = args.filter(function (x) { return /^[A-Za-z0-9]/.test(x) && !/^(A|AAAA|SRV|TXT|NS|SOA|ANY)$/i.test(x); })[0];
      if (!dn) return res('', 1, 'dig (simulation): dig [@SERVER] NAME [+tcp] [+short] [+search]');
      var srv = at ? at.slice(1) : KUBE_DNS_IP;
      var d = s18Resolve(state, m, src, dn, tcp ? 'TCP' : 'UDP', srv, search);
      if (!d.ok && d.why === 'timeout' && S18_EXT[srv] && s18PolicyFixed(state, m)) state.negAfterFix = true;
      if (!d.ok && d.why === 'timeout') {
        var ce = ';; communications error to ' + srv + '#53: ' + (tcp ? 'timed out' : 'timed out');
        return res(ce + '\n' + ce + '\n' + ce + '\n\n; <<>> DiG 9.18.28 <<>> ' + args.join(' ') + '\n;; global options: +cmd\n;; no servers could be reached\n', 9);
      }
      if (short) return res(d.ok ? d.ip : '');
      var fq = d.ok ? d.fqdn : dn.replace(/\.$/, '');
      return res('; <<>> DiG 9.18.28 <<>> ' + args.join(' ') + '\n;; global options: +cmd\n;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ' + (d.ok ? 'NOERROR' : 'NXDOMAIN') + ', id: ' + (SIM().fnv(dn + state.clock) % 65535) + '\n;; flags: qr aa rd; QUERY: 1, ANSWER: ' + (d.ok ? 1 : 0) + ', AUTHORITY: 0, ADDITIONAL: 1\n\n;; QUESTION SECTION:\n;' + fq + '.\t\tIN\tA\n' +
        (d.ok ? '\n;; ANSWER SECTION:\n' + fq + '.\t30\tIN\tA\t' + d.ip + '\n' : '') + '\n;; Query time: 1 msec\n;; SERVER: ' + srv + '#53(' + srv + ') (' + (tcp ? 'TCP' : 'UDP') + ')\n');
    }
    if (prog === 'getent') {
      if (args[0] !== 'hosts' && args[0] !== 'ahosts') return res('', 1, 'getent: only "getent hosts NAME" is modelled here');
      var g = s18Resolve(state, m, src, args[1] || '', 'UDP');
      return g.ok ? res(SIM().pad(g.ip, 16) + g.fqdn) : { out: '', code: 2 };
    }
    var verbose = false, zero = false, wait = null, udp = false, host = null, port = null, url = null, codeOnly = false, quietOut = false;
    if (prog === 'nc' || prog === 'ncat' || prog === 'netcat' || prog === 'telnet') {
      var pos2 = [];
      for (var i = 0; i < args.length; i++) {
        var t = args[i];
        if (t === '-w') { wait = args[++i]; continue; }
        if (/^-[a-z]+$/.test(t)) { if (t.indexOf('v') !== -1) verbose = true; if (t.indexOf('z') !== -1) zero = true; if (t.indexOf('u') !== -1) udp = true; if (/w$/.test(t)) wait = args[++i]; continue; }
        pos2.push(t);
      }
      host = pos2[0]; port = Number(pos2[1]);
      if (!host || !(port > 0)) return res('', 1, 'usage: nc [-zv] [-w SECONDS] HOST PORT');
      if (udp) return res('', 1, 'nc -u: UDP has no handshake, so nc cannot tell an allowed port from a dropped one; use nslookup or dig to test DNS (simulation note).');
      if (prog === 'telnet') zero = true;
    } else {
      for (var j = 0; j < args.length; j++) {
        var u = args[j];
        if (['-o', '--output', '-m', '--max-time', '--connect-timeout', '-H', '-X', '-d'].indexOf(u) !== -1) { if (u === '-o' && args[j + 1] === '/dev/null') quietOut = true; j++; continue; }
        if (u === '-w' || u === '--write-out') { if (/http_code/.test(args[j + 1] || '')) codeOnly = true; j++; continue; }
        if (/^-[a-zA-Z]+$/.test(u)) { if (u.indexOf('v') !== -1) verbose = true; continue; }
        if (u.charAt(0) !== '-') url = u;
      }
      var mm = url && /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
      if (!mm) return res('', 3, 'curl: (3) URL rejected: Malformed input to a URL function');
      host = mm[2]; port = mm[3] ? Number(mm[3]) : (mm[1] === 'https' ? 443 : 80); url = { scheme: mm[1] || 'http', path: mm[4] || '/' };
    }
    var isNc = !url;
    var loop = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(host);
    var rr = loop ? { ok: true, ip: '127.0.0.1', fqdn: 'localhost' } : s18Resolve(state, m, src, host, 'UDP');
    if (!rr.ok) {
      if (isNc) return res('', 1, 'nc: getaddrinfo for host "' + host + '" port ' + port + ': ' + (rr.why === 'timeout' ? 'Temporary failure in name resolution' : 'Name or service not known'));
      return res('', 6, 'curl: (6) Could not resolve host: ' + host);
    }
    var tg = loop ? { dst: s18PodDst(m, p), port: port } : s18Target(m, rr.ip, port);
    var label = host === rr.ip ? host : host + ' (' + rr.ip + ')';
    function blocked() {
      if (tg.dst && tg.dst.kind === 'external' && s18PolicyFixed(state, m)) state.negAfterFix = true;
      if (isNc) return res('', 1, 'nc: connect to ' + label + ' port ' + port + ' (tcp) timed out: Operation now in progress' + (wait ? '' : '\n(simulation: without -w, nc would wait about two minutes before giving up)'));
      return res('', 28, 'curl: (28) Connection timed out after ' + (wait ? Number(wait) * 1000 : 5001) + ' milliseconds');
    }
    if (tg.none === 'timeout') return blocked();
    if (tg.none === 'refused') return isNc ? res('', 1, 'nc: connect to ' + label + ' port ' + port + ' (tcp) failed: Connection refused') : res('', 7, 'curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 1 ms: Couldn\'t connect to server');
    if (!loop && !egressAllowed(state, src, tg.dst, tg.port, 'TCP')) return blocked();
    if (!listens(tg.dst, tg.port, 'TCP')) return isNc ? res('', 1, 'nc: connect to ' + label + ' port ' + port + ' (tcp) failed: Connection refused') : res('', 7, 'curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 1 ms: Couldn\'t connect to server');
    if (isNc) return verbose ? res('', 0, 'Connection to ' + label + ' ' + port + ' port [tcp/' + ({ 5432: 'postgresql', 443: 'https', 80: 'http', 53: 'domain', 8080: 'http-alt' }[port] || '*') + '] succeeded!') : res('');
    if (tg.dst.kind === 'external') return res('* Connected to ' + host + ' (' + rr.ip + ') port ' + port + '\n(simulation: egress to this address is open; the TLS exchange and response beyond the TCP connection are not modelled)');
    var app = (tg.dst.labels || {}).app;
    if (app === 'beacon-api') {
      var store = s18Store(state, m), routes = { '/healthz': [200, 'ok'], '/version': [200, '{"version": "1.4.1", "environment": "lab"}'],
        '/ready': store.ok ? [200, '{"ready": true, "store": "postgres"}'] : [503, '{"ready": false, "store": "error: ' + store.msg + '"}'] };
      var hit = routes[url.path] || [404, '{"error": "not found", "path": "' + url.path + '"}'];
      if (codeOnly) return res(String(hit[0]));
      return res((verbose ? '* Connected to ' + host + ' (' + rr.ip + ') port ' + port + '\n< HTTP/1.0 ' + hit[0] + '\n' : '') + (quietOut ? '' : hit[1]));
    }
    return res('', 52, 'curl: (52) Empty reply from server');
  }
  function s18Kubectl(state) {
    return function (w, a) {
      var m = w.k8sModel, p = pos(a), verb = p[0], kind = p[1] || '', ns = nsOf(a);
      var base = function (ww, aa) { return kubectlBase(ww, aa); };
      function tick() { KM().advance(m, KM().PER_COMMAND); }
      if (verb === 'exec' && a.indexOf('--') !== -1) return s18Exec(state, w, a, base);
      /* NetworkPolicy reads */
      if ((verb === 'get' || verb === 'describe') && (NETPOL.test(kind.split('/')[0]))) {
        tick();
        if (ns && ns !== 'beacon') return res('No resources found in ' + ns + ' namespace.');
        var nm = kind.indexOf('/') > 0 ? kind.split('/')[1] : p[2];
        var list = state.pols.filter(function (x) { return !nm || x.metadata.name === nm; });
        if (nm && !list.length) return res('', 1, 'Error from server (NotFound): networkpolicies.networking.k8s.io "' + nm + '" not found');
        if (!list.length) return res('No resources found in beacon namespace.');
        if (verb === 'describe') return res(list.map(function (x) { return s18Describe(state, x); }).join('\n\n\n'));
        var fmt = flagOf(a, ['-o', '--output']);
        if (fmt === 'yaml') return res(nm ? toYaml(s18View(list[0])) : toYaml({ apiVersion: 'v1', kind: 'List', items: list.map(s18View) }));
        if (fmt === 'json') return res(JSON.stringify(nm ? s18View(list[0]) : { apiVersion: 'v1', kind: 'List', items: list.map(s18View) }, null, 2));
        return res(SIM().table(['NAME', 'POD-SELECTOR', 'AGE'], list.map(function (x) { return [x.metadata.name, selStr(x.spec.podSelector) || '<none>', KM().age(state.clock - (x.created || 0) + 480)]; })));
      }
      if (verb === 'delete' && NETPOL.test(kind.split('/')[0])) {
        tick();
        var dn = kind.indexOf('/') > 0 ? kind.split('/')[1] : p[2];
        var hit = state.pols.filter(function (x) { return x.metadata.name === dn; })[0];
        if (!hit) return res('', 1, 'Error from server (NotFound): networkpolicies.networking.k8s.io "' + (dn || '') + '" not found');
        state.pols = state.pols.filter(function (x) { return x !== hit; });
        return res('networkpolicy.networking.k8s.io "' + dn + '" deleted');
      }
      var file = flagOf(a, ['-f', '--filename']);
      if ((verb === 'apply' || verb === 'create' || verb === 'replace') && file) {
        tick();
        var r = s18Apply(state, w, file);
        if (r.err) return { out: (r.out || []).join('\n') + ((r.out || []).length ? '\n' : ''), err: r.err + '\n', code: 1 };
        var outs = r.out.slice();
        if (r.others.length) r.others.forEach(function (f) { var b = base(w, ['apply', '-f', f]); outs.push(String(b.out || b.err || '').replace(/\n$/, '')); });
        return res(outs.join('\n'));
      }
      if (verb === 'delete' && file) {
        tick();
        var docs;
        try { docs = s18Docs(readF(w, file) || ''); } catch (e) { return res('', 1, 'error: error parsing ' + file + ': ' + e.message); }
        var gone = [];
        docs.forEach(function (d) { if (d && d.kind === 'NetworkPolicy') { var nmd = (d.metadata || {}).name; if (state.pols.some(function (x) { return x.metadata.name === nmd; })) { state.pols = state.pols.filter(function (x) { return x.metadata.name !== nmd; }); gone.push('networkpolicy.networking.k8s.io "' + nmd + '" deleted'); } } });
        return gone.length ? res(gone.join('\n')) : res('', 1, 'Error from server (NotFound): no NetworkPolicy from ' + file + ' exists');
      }
      /* namespaces carry the labels a namespaceSelector reads */
      if (/^(ns|namespace|namespaces)$/.test(kind.split('/')[0]) && (verb === 'get' || verb === 'describe')) {
        tick();
        var nn = kind.indexOf('/') > 0 ? kind.split('/')[1] : p[2];
        var names = Object.keys(S18_NS).filter(function (x) { return !nn || x === nn; });
        if (!names.length) return res('', 1, 'Error from server (NotFound): namespaces "' + nn + '" not found');
        var lab = function (x) { return Object.keys(S18_NS[x]).map(function (k) { return k + '=' + S18_NS[x][k]; }).join(','); };
        if (verb === 'describe') return res(names.map(function (x) { return 'Name:         ' + x + '\nLabels:       ' + lab(x).split(',').join('\n              ') + '\nAnnotations:  <none>\nStatus:       Active\n\nNo resource quota.\n\nNo LimitRange resource.'; }).join('\n\n'));
        var f2 = flagOf(a, ['-o', '--output']);
        if (f2 === 'yaml') return res(names.map(function (x) { return toYaml({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: x, labels: S18_NS[x] }, status: { phase: 'Active' } }); }).join('\n---\n'));
        var show = a.indexOf('--show-labels') !== -1;
        return res(SIM().table(['NAME', 'STATUS', 'AGE'].concat(show ? ['LABELS'] : []), names.map(function (x) { return [x, 'Active', x === 'beacon' ? '62d' : '90d'].concat(show ? [lab(x)] : []); })));
      }
      if (verb === 'label' && /^(ns|namespace|namespaces)$/.test(kind.split('/')[0])) {
        tick();
        return res('', 1, 'Error from server (Forbidden): namespaces "' + (kind.split('/')[1] || p[2] || '') + '" is forbidden: User "beacon-oncall" cannot patch resource "namespaces" in API group "" at the cluster scope');
      }
      /* kube-system: the DNS pods and Service, read-only */
      if (ns === 'kube-system' || a.indexOf('-A') !== -1 || a.indexOf('--all-namespaces') !== -1) {
        if (ns === 'kube-system' && (verb === 'get' || verb === 'describe')) {
          tick();
          var k0 = kind.split('/')[0];
          var sel = flagOf(a, ['-l', '--selector']), selObj = null;
          if (sel) { selObj = {}; sel.split(',').forEach(function (kv) { var q = kv.split('='); selObj[q[0]] = q[1]; }); }
          if (/^(po|pod|pods)$/.test(k0) && verb === 'get') {
            var pods = S18_SYS.filter(function (x) { return !selObj || selMatch({ matchLabels: selObj }, x.labels); });
            var wide = flagOf(a, ['-o', '--output']) === 'wide', sl = a.indexOf('--show-labels') !== -1;
            if (flagOf(a, ['-o', '--output']) === 'yaml') return res(toYaml({ apiVersion: 'v1', kind: 'List', items: pods.map(function (x) { return { apiVersion: 'v1', kind: 'Pod', metadata: { name: x.name, namespace: 'kube-system', labels: x.labels }, spec: { nodeName: x.node }, status: { phase: 'Running', podIP: x.ip } }; }) }));
            return res(SIM().table(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'].concat(wide ? ['IP', 'NODE'] : []).concat(sl ? ['LABELS'] : []), pods.map(function (x) {
              return [x.name, '1/1', 'Running', '0', '90d'].concat(wide ? [x.ip, x.node] : []).concat(sl ? [Object.keys(x.labels).map(function (k) { return k + '=' + x.labels[k]; }).join(',')] : []); })));
          }
          if (/^(svc|service|services)$/.test(k0)) {
            if (verb === 'describe') return res('Name:              kube-dns\nNamespace:         kube-system\nLabels:            k8s-app=kube-dns\nSelector:          k8s-app=kube-dns\nType:              ClusterIP\nIP:                10.96.0.10\nPort:              dns  53/UDP\nTargetPort:        53/UDP\nEndpoints:         10.244.0.2:53,10.244.0.3:53\nPort:              dns-tcp  53/TCP\nTargetPort:        53/TCP\nEndpoints:         10.244.0.2:53,10.244.0.3:53\nPort:              metrics  9153/TCP\nTargetPort:        9153/TCP\nEndpoints:         10.244.0.2:9153,10.244.0.3:9153\nSession Affinity:  None\nEvents:            <none>');
            return res(SIM().table(['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE'], [['kube-dns', 'ClusterIP', '10.96.0.10', '<none>', '53/UDP,53/TCP,9153/TCP', '90d']]));
          }
          if (/^(ep|endpoints|endpointslice|endpointslices)$/.test(k0)) return res(SIM().table(['NAME', 'ENDPOINTS', 'AGE'], [['kube-dns', '10.244.0.2:53,10.244.0.3:53,10.244.0.2:53 + 3 more...', '90d']]));
          if (NETPOL.test(k0)) return res('No resources found in kube-system namespace.');
        }
        if (ns === 'kube-system' || verb !== 'get') { tick(); return res('', 1, 'error: in kube-system this simulation models only the cluster DNS pods and the kube-dns Service (get pods/svc/endpoints, describe svc kube-dns), read-only'); }
      }
      if ((verb === 'logs' || verb === 'log')) {
        var out = base(w, a), lp = podFor(m, p[1]);
        if (out.code === 0 && lp && (lp.labels || {}).app === 'beacon-api' && a.indexOf('--previous') === -1 && a.indexOf('-p') === -1) {
          var stv = s18Store(state, m), lines = [];
          for (var q = 0; q < 3; q++) lines.push(stv.ok ? '{"level":"info","msg":"request","method":"GET","path":"/ready","status":200,"user_agent":"kube-probe/1.33"}'
            : '{"level":"error","msg":"readiness: store unavailable","path":"/ready","status":503,"error":"' + stv.msg + '"}');
          out = { out: (out.out || '') + lines.join('\n') + '\n', err: out.err, code: out.code };
        }
        return out;
      }
      var r2 = base(w, a);
      if (verb === 'describe' || verb === 'get' || verb === 'events') r2 = { out: String(r2.out || '').replace(/Readiness probe failed: HTTP probe failed with statuscode: 404/g, 'Readiness probe failed: HTTP probe failed with statuscode: 503'), err: r2.err, code: r2.code };
      return r2;
    };
  }
  function s18Yaml(name, podSel, rules) {
    return 'apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: ' + name + '\n  namespace: beacon\nspec:\n  podSelector:' + (podSel ? '\n    matchLabels:\n      app: ' + podSel : ' {}') + '\n  policyTypes:\n    - Egress\n' + (rules ? '  egress:\n' + rules : '');
  }
  function s18DnsRule(nsKey, podLabel) {
    return '    - to:\n        - namespaceSelector:\n            matchLabels:\n              ' + nsKey + ': kube-system\n          podSelector:\n            matchLabels:\n              k8s-app: ' + podLabel + '\n      ports:\n        - protocol: UDP\n          port: 53\n        - protocol: TCP\n          port: 53\n';
  }
  var S18_FIX_A = "printf 'apiVersion: networking.k8s.io/v1\\nkind: NetworkPolicy\\nmetadata:\\n  name: allow-dns-egress\\n  namespace: beacon\\nspec:\\n  podSelector: {}\\n  policyTypes:\\n    - Egress\\n  egress:\\n    - to:\\n        - namespaceSelector:\\n            matchLabels:\\n              kubernetes.io/metadata.name: kube-system\\n          podSelector:\\n            matchLabels:\\n              k8s-app: kube-dns\\n      ports:\\n        - protocol: UDP\\n          port: 53\\n        - protocol: TCP\\n          port: 53\\n' > netpol/20-allow-dns-egress.yaml && kubectl apply -f netpol/20-allow-dns-egress.yaml";
  LX.missions.push({
    id: 'sre-s18', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'beacon-api unready after the egress hardening change',
    brief: function () { return 'The platform pipeline applied the namespace egress hardening change (CHG-3381, manifests in /home/lab/beacon/netpol) to the beacon namespace on looped-policy a few minutes ago. Since then beacon-api pods report not ready and the client gets no answer. The on-call engineer checked from inside an api pod that the database is reachable by its IP and concluded "the network is fine" (see HANDOFF.md). Restore service while keeping the namespace\'s egress restricted to what Beacon needs, and prove both halves.'; },
    keys: ['kubectl get pods', 'kubectl logs deploy/beacon-api', 'kubectl exec deploy/beacon-api -- curl -s http://localhost:8080/ready', 'kubectl exec deploy/beacon-api -- nslookup beacon-db.beacon.svc', 'kubectl exec deploy/beacon-api -- nc -zv -w 3 10.96.80.12 5432', 'kubectl get networkpolicy', 'kubectl describe networkpolicy', 'kubectl get ns --show-labels', 'kubectl get pods -n kube-system --show-labels', 'cat docs/SEC-NET-04.md'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
      var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], pols: [], negAfterFix: false };
      var files = [
        { path: '/home/lab/beacon/netpol/00-default-deny-egress.yaml', content: s18Yaml('default-deny-egress', null, null) },
        { path: '/home/lab/beacon/netpol/10-beacon-api-egress.yaml', content: s18Yaml('beacon-api-egress', 'beacon-api', '    - to:\n        - podSelector:\n            matchLabels:\n              app: beacon-db\n      ports:\n        - protocol: TCP\n          port: 5432\n') },
        { path: '/home/lab/beacon/netpol/15-beacon-client-egress.yaml', content: s18Yaml('beacon-client-egress', 'beacon-client', '    - to:\n        - podSelector:\n            matchLabels:\n              app: beacon-api\n      ports:\n        - protocol: TCP\n          port: 8080\n') }
      ];
      if (v !== 'a') files.push({ path: '/home/lab/beacon/netpol/20-allow-dns-egress.yaml', content: s18Yaml('allow-dns-egress', null, s18DnsRule(v === 'b' ? 'name' : 'kubernetes.io/metadata.name', v === 'b' ? 'kube-dns' : 'coredns')) });
      files.push({ path: '/home/lab/beacon/netpol/README.md', content: '# beacon namespace NetworkPolicies\nApplied by the platform pipeline with `kubectl apply -f netpol/` (CHG-3381, namespace egress hardening). The cluster\'s network plugin enforces NetworkPolicy.\nChange a policy by editing its file here and applying it; the files are the record of what the namespace allows.\n' });
      files.push({ path: '/home/lab/beacon/docs/SEC-NET-04.md', content: '# SEC-NET-04 Namespace egress standard\n1. Every application namespace applies a default-deny egress policy.\n2. Each dependency gets an explicit egress rule, by pod and namespace selector rather than broad address ranges.\n3. Cluster DNS stays reachable: allow egress to the cluster DNS pods on UDP and TCP port 53 (TCP is used when a reply is truncated). Do not allow port 53 to arbitrary destinations: that is a path around the cluster resolver.\n4. Egress to the internet (0.0.0.0/0) needs an exception ticket.\n\nTesting: prove the allowed path and a denied path. Stand-ins in the lab: partner-api.example.net (203.0.113.10:443) is "the internet"; resolver.example.net (198.51.100.53) is an external DNS resolver.\n' });
      files.push({ path: '/home/lab/beacon/HANDOFF.md', content: '# beacon-api readiness alerts — handoff\n08:52 CHG-3381 applied by the pipeline.\n08:54 beacon-api readiness alerts; client requests failing.\n08:56 from inside an api pod: `nc -zv 10.96.80.12 5432` → "succeeded". The database is reachable, so the network is fine. Suspect the app?\n' });
      /* policies in force = what the pipeline applied from those files */
      files.forEach(function (f) {
        if (!/netpol\/.*\.yaml$/.test(f.path)) return;
        s18Docs(f.content).forEach(function (d) { var doc = s18Canon(d); doc.created = 0; state.pols.push(doc); });
      });
      var k8s = { namespace: 'beacon', context: 'kind-looped-policy', now: 5400,
        nodes: [{ name: 'looped-policy-control-plane', cpu: 3800, mem: 7680, arch: 'arm64', role: 'control-plane', taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] },
                { name: 'looped-policy-worker', cpu: 3800, mem: 7680, arch: 'arm64' }, { name: 'looped-policy-worker2', cpu: 3800, mem: 7680, arch: 'arm64' }],
        registry: { 'registry.lab/beacon/api:1.4.1': { arch: ['amd64', 'arm64'] }, 'registry.lab/library/postgres:16.4': { arch: ['amd64', 'arm64'] } },
        apps: { 'registry.lab/beacon/api': beaconApiProfile('1.4.1'), 'registry.lab/tools/toolbox': TOOLBOX,
          'registry.lab/library/postgres': { port: 5432, readyPath: '/', livePath: '/', startSec: 6, memMi: 180, boot: ['database system is ready to accept connections'] } },
        services: [apiService(), { name: 'beacon-db', selector: { app: 'beacon-db' }, clusterIP: '10.96.80.12', ports: [{ name: 'pg', port: 5432, targetPort: 5432 }] }],
        deployments: [apiDeployment('1.4.1'),
          { name: 'beacon-db', replicas: 1, selector: { app: 'beacon-db' }, maxSurge: 0, maxUnavailable: 1, history: [{ labels: { app: 'beacon-db' }, containers: [{ name: 'postgres', image: 'registry.lab/library/postgres:16.4', ports: [{ name: 'pg', containerPort: 5432 }] }] }] },
          clientDeployment()] };
      k8s.registry[TOOLBOX_IMG] = { arch: ['amd64', 'arm64'] };
      /* Beacon's /ready follows its store: name resolution, then TCP to the database */
      state.hooks.push(function (s, w) {
        var m = w && w.k8sModel; if (!m) return;
        m.apps[S18_API_IMG].readyPath = s18Store(s, m).ok ? '/ready' : '/ready#store-unavailable';
      });
      return k8sWorld(state, k8s, files, s18Kubectl(state));
    },
    objectives: [
      { id: 'failing', stage: 'evidence', text: 'Find out what beacon-api itself says is wrong',
        hint: 'The pods are running but not ready. The app records why it is refusing traffic.',
        hint2: '`kubectl logs deploy/beacon-api`, or ask its readiness endpoint from inside: `kubectl exec deploy/beacon-api -- curl -s http://localhost:8080/ready`.',
        reveal: 'kubectl logs deploy/beacon-api',
        done: function (c) { return saw(c, /k(ubectl)?\b.*\b(logs?\b|exec\b.*\bcurl\b.*\/ready)/, /Temporary failure in name resolution/); } },
      { id: 'boundary', stage: 'evidence', text: 'Show exactly which part of the path works and which does not',
        hint: 'The handoff proved one thing. What did it not test that the app does before it ever connects?',
        hint2: 'From an api pod, test the same destination two ways: by address (`nc -zv -w 3 10.96.80.12 5432`) and by name (`nslookup beacon-db.beacon.svc`, `dig`, `getent hosts`).',
        reveal: 'kubectl exec deploy/beacon-api -- nc -zv -w 3 10.96.80.12 5432; kubectl exec deploy/beacon-api -- nslookup beacon-db.beacon.svc',
        done: function (c) {
          var byIp = saw(c, /k(ubectl)?\b.*\bexec\b.*\b(nc|ncat|netcat|curl|telnet)\b.*\b\d+\.\d+\.\d+\.\d+\b/, /succeeded!|"ready"|"version"|^ok$|^200$/m);
          var byName = saw(c, /k(ubectl)?\b.*\bexec\b.*\b(nslookup|dig|host|nc|curl)\b/, /connection timed out; no servers could be reached|communications error to|Temporary failure in name resolution|Could not resolve host/);
          return byIp && byName;
        } },
      { id: 'policy', stage: 'evidence', text: 'Read what the namespace\'s rules allow and compare it with what the failing step needs',
        hint: 'Since the change, every connection from these pods must match a rule. Which rule would a DNS query match, and does its target exist as written?',
        hint2: '`kubectl describe networkpolicy` (or the files in netpol/). Then check the labels the selectors rely on: `kubectl get ns --show-labels`, `kubectl get pods -n kube-system --show-labels`.',
        reveal: function (c) {
          var v = st(c).variant;
          if (v === 'a') return 'kubectl get networkpolicy && kubectl describe networkpolicy';
          return 'kubectl describe networkpolicy allow-dns-egress && ' + (v === 'b' ? 'kubectl get ns kube-system --show-labels' : 'kubectl get pods -n kube-system --show-labels');
        },
        done: function (c) {
          var v = st(c).variant;
          if (v === 'a') return saw(c, /k(ubectl)?\b.*\b(describe\s+(netpol|networkpolic(y|ies))|get\s+(netpol|networkpolic(y|ies))\b.*-o\s*=?\s*(yaml|json))|cat\s+\S*netpol\//, /5432/) && saw(c, /k(ubectl)?\b.*\b(get|describe)\s+(netpol|networkpolic(y|ies))\b|ls\s+\S*netpol/, /default-deny-egress/);
          var rule = saw(c, /k(ubectl)?\b.*\b(describe\s+(netpol|networkpolic(y|ies))|get\s+(netpol|networkpolic(y|ies))\b.*-o\s*=?\s*(yaml|json))|cat\s+\S*netpol\//, v === 'b' ? /name=kube-system|\bname: kube-system/ : /k8s-app=coredns|k8s-app: coredns/);
          var labels = v === 'b' ? saw(c, /k(ubectl)?\b.*\b(get|describe)\s+(ns|namespaces?)\b/, /kubernetes\.io\/metadata\.name[=:] ?kube-system/)
            : saw(c, /k(ubectl)?\b(?=.*(-n\s*=?\s*kube-system|--namespace[= ]kube-system)).*\b(get|describe)\s+(po|pods?|svc|services?)\b/, /k8s-app[=:] ?kube-dns/);
          return rule && labels;
        } },
      { id: 'fix', stage: 'fix', text: 'Correct the namespace\'s rules through their files so Beacon can reach what it needs, keeping every other egress denied',
        hint: 'Add or correct one rule: to the cluster DNS pods (selected the way they are really labelled), on the ports and protocols DNS uses. Leave the default deny alone.',
        hint2: 'Edit or create the file in netpol/ (printf … > file, sed -i), then `kubectl apply -f FILE`. The rule needs a namespaceSelector and podSelector that match kube-system and its DNS pods, and ports 53 on UDP and TCP.',
        reveal: function (c) {
          var v = st(c).variant;
          if (v === 'a') return S18_FIX_A;
          if (v === 'b') return 'sed -i \'s#              name: kube-system#              kubernetes.io/metadata.name: kube-system#\' netpol/20-allow-dns-egress.yaml && kubectl apply -f netpol/20-allow-dns-egress.yaml';
          return 'sed -i \'s/k8s-app: coredns/k8s-app: kube-dns/\' netpol/20-allow-dns-egress.yaml && kubectl apply -f netpol/20-allow-dns-egress.yaml';
        },
        done: function (c) { return s18Fixed(c); } },
      { id: 'verify', stage: 'verify', text: 'Prove a denied path is still denied, then that the client gets a ready answer from beacon-api',
        hint: 'Segmentation needs two proofs: the allowed path works and an unrelated path still fails.',
        hint2: 'A negative test to the stand-in external endpoint (`nc -zv -w 3 partner-api.example.net 443` from an api pod), then `kubectl exec deploy/beacon-client -- curl -s http://beacon-api/ready`.',
        reveal: 'kubectl exec deploy/beacon-api -- nc -zv -w 3 partner-api.example.net 443; kubectl exec deploy/beacon-client -- curl -s http://beacon-api/ready',
        done: function (c) { return s18Fixed(c) && st(c).negAfterFix && lastIs(c, /k(ubectl)?\b.*\bexec\b.*beacon-client\b.*\bcurl\b.*beacon-api/, /"ready": true/) && lastCode(c) === 0; } }
    ],
    sre: {
      scenarioId: 'S18', moduleId: 'M09', lab: 'L18', variants: ['a', 'b', 'c'],
      symptom: 'After an egress hardening change, beacon-api pods are Running but not Ready; an in-pod test to the database IP succeeds while lookups of the database hostname time out.',
      neutralTitle: 'beacon-api unready after a namespace change',
      neutralBrief: 'A namespace hardening change was applied to beacon a few minutes ago. Since then beacon-api pods report not ready and the client gets no answer, although the database answers when tested by its address from inside an api pod. Restore service while keeping egress restricted to what Beacon needs, and prove both.',
      impact: 'beacon-api has no ready endpoints: every client request in the namespace fails.',
      changes: 'CHG-3381 applied NetworkPolicies from netpol/ (default-deny egress plus per-workload allows) a few minutes ago.',
      spoilers: ['DNS', 'port 53', 'kube-dns', 'coredns', 'nslookup', 'namespaceSelector', 'label', 'udp'],
      tools: ['kubectl (get/describe/apply -f/delete networkpolicy, get ns --show-labels, get pods -n kube-system, logs, exec … nslookup|dig|getent|curl|nc)', 'cat', 'sed -i', 'printf … > FILE', 'diff'],
      grammar: [
        '`kubectl get|describe networkpolicy [NAME] [-o yaml]`, `kubectl apply -f FILE|DIR`, `kubectl delete networkpolicy NAME` / `delete -f FILE`',
        '`kubectl exec POD|deploy/NAME -- nslookup [-vc] NAME [SERVER]`, `dig [@SERVER] NAME [+tcp] [+short] [+search]`, `getent hosts NAME`, `curl [-s] [-v] [-w "%{http_code}"] URL`, `nc -zv -w 3 HOST PORT`',
        '`kubectl get ns [NAME] --show-labels`, `kubectl get pods|svc -n kube-system [--show-labels] [-l k8s-app=…]`, `kubectl logs deploy/beacon-api`, plus the usual get/describe/rollout'
      ],
      palette: ['kubectl get pods', 'kubectl logs deploy/beacon-api', 'kubectl exec deploy/beacon-api -- nc -zv -w 3 10.96.80.12 5432', 'kubectl exec deploy/beacon-api -- nslookup beacon-db.beacon.svc', 'kubectl get networkpolicy', 'kubectl describe networkpolicy', 'kubectl get ns --show-labels', 'kubectl get pods -n kube-system --show-labels', 'ls netpol', 'kubectl apply -f netpol/', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/ready'],
      assumptions: ['looped-policy runs a network plugin that enforces NetworkPolicy (the kind-policy profile); on a plugin that does not, policies are accepted and silently ignored.', 'The beacon-api and toolbox images include curl, nc, nslookup, dig and getent for this exercise.', 'You may change the beacon namespace\'s policies (through the files in netpol/) but not cluster-scoped objects such as namespaces.', 'SEC-NET-04 (docs/) is the standard the change was meant to implement.'],
      simplified: K8S_SIMPLIFIED.concat([
        'Only egress policy is evaluated (the change contains no ingress policies). A connection is allowed when no policy selects the source pod for Egress, or any rule of any selecting policy matches the destination pod (after Service DNAT) and port; ipBlock matches by address. endPort is honoured; named ports resolve against the destination pod.',
        'DNS is CoreDNS behind 10.96.0.10 with the pod search path (ndots:5); answers are Service ClusterIPs and two stand-in external names. Truncation is not simulated, so the TCP half of the DNS rule is checked against the policy (and with nslookup -vc / dig +tcp), not forced by a large answer.',
        'In-pod tools are modelled one per exec (no shell). Beacon\'s readiness follows the policy decision for its database hostname and port; connection contents past the TCP handshake are not modelled.'
      ]),
      unsafe: [
        { label: 'removed or weakened the default deny', why: 'Deleting default-deny-egress (or giving it allow rules) makes every pod no other policy selects — the database included — free to reach anything. The outage needed one missing allow, not the removal of the boundary.',
          test: function (c) { return !s18DenyIntact(st(c)); },
          demo: 'kubectl delete networkpolicy default-deny-egress' },
        { label: 'opened egress to everywhere', why: 'An allow-all rule (`egress: - {}`) or a 0.0.0.0/0 block fixes DNS by allowing everything, including connections to the internet that SEC-NET-04 forbids without an exception. Checked against the resulting policy set: unrelated egress to 203.0.113.10:443 must stay denied.',
          test: function (c) { return !s18Eval(st(c), M(c)).noExt; },
          demo: "printf 'apiVersion: networking.k8s.io/v1\\nkind: NetworkPolicy\\nmetadata:\\n  name: allow-all-egress\\n  namespace: beacon\\nspec:\\n  podSelector: {}\\n  policyTypes:\\n    - Egress\\n  egress:\\n    - {}\\n' > netpol/99-allow-all-egress.yaml && kubectl apply -f netpol/99-allow-all-egress.yaml" }
      ],
      alt: function (v) {
        if (v === 'a') return ['kubectl get pods', 'kubectl exec deploy/beacon-api -- curl -s http://localhost:8080/ready', 'kubectl exec deploy/beacon-api -- dig beacon-db.beacon.svc.cluster.local',
          'kubectl exec deploy/beacon-api -- curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/healthz', 'kubectl exec deploy/beacon-client -- nc -zv -w 3 10.96.112.40 80', 'kubectl exec deploy/beacon-api -- nc -zv -w 3 10.96.80.12 5432',
          'ls netpol', 'kubectl get netpol -o yaml', 'cat docs/SEC-NET-04.md', 'kubectl get pods -n kube-system -l k8s-app=kube-dns --show-labels',
          "printf 'apiVersion: networking.k8s.io/v1\\nkind: NetworkPolicy\\nmetadata:\\n  name: allow-cluster-dns\\n  namespace: beacon\\nspec:\\n  podSelector: {}\\n  policyTypes:\\n    - Egress\\n  egress:\\n    - to:\\n        - namespaceSelector:\\n            matchExpressions:\\n              - key: kubernetes.io/metadata.name\\n                operator: In\\n                values:\\n                  - kube-system\\n          podSelector:\\n            matchLabels:\\n              k8s-app: kube-dns\\n      ports:\\n        - protocol: UDP\\n          port: dns\\n        - protocol: TCP\\n          port: dns-tcp\\n' > netpol/20-allow-cluster-dns.yaml",
          'kubectl apply -f netpol/', 'kubectl exec deploy/beacon-api -- dig +tcp beacon-db.beacon.svc.cluster.local', 'kubectl exec deploy/beacon-client -- curl -sS -m 5 https://partner-api.example.net/', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/ready'];
        if (v === 'b') return ['kubectl get deploy beacon-api', 'kubectl exec deploy/beacon-api -- curl -s http://localhost:8080/ready', 'kubectl exec deploy/beacon-api -- getent hosts beacon-db', 'kubectl exec deploy/beacon-api -- nslookup beacon-db',
          'kubectl exec deploy/beacon-api -- nc -zv -w 3 10.96.80.12 5432', 'kubectl get netpol allow-dns-egress -o yaml', 'kubectl describe ns kube-system',
          'sed -i \'s#name: kube-system#kubernetes.io/metadata.name: kube-system#\' netpol/20-allow-dns-egress.yaml', 'kubectl apply -f netpol/', 'kubectl exec deploy/beacon-api -- nslookup -vc beacon-db',
          'kubectl exec deploy/beacon-api -- nslookup partner-api.example.net 198.51.100.53', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/ready'];
        return ['kubectl get pods', 'kubectl describe pod ' + 'beacon-api', 'kubectl logs deploy/beacon-api', 'kubectl exec deploy/beacon-api -- nslookup beacon-db.beacon.svc', 'kubectl exec deploy/beacon-api -- nc -zv -w 3 10.96.80.12 5432',
          'cat netpol/20-allow-dns-egress.yaml', 'kubectl get pods -n kube-system -o wide --show-labels', 'kubectl get svc -n kube-system',
          "printf 'apiVersion: networking.k8s.io/v1\\nkind: NetworkPolicy\\nmetadata:\\n  name: allow-dns-egress\\n  namespace: beacon\\nspec:\\n  podSelector: {}\\n  policyTypes:\\n    - Egress\\n  egress:\\n    - to:\\n        - namespaceSelector:\\n            matchLabels:\\n              kubernetes.io/metadata.name: kube-system\\n          podSelector:\\n            matchExpressions:\\n              - key: k8s-app\\n                operator: In\\n                values:\\n                  - kube-dns\\n      ports:\\n        - protocol: UDP\\n          port: 53\\n        - protocol: TCP\\n          port: 53\\n' > netpol/20-allow-dns-egress.yaml",
          'kubectl apply -f netpol/20-allow-dns-egress.yaml', 'kubectl get pods', 'kubectl exec deploy/beacon-client -- nc -zv -w 3 203.0.113.10 443', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/ready'];
      },
      mechanism: 'With a default-deny egress policy in force, every new connection from a beacon pod must match some allow rule, and that includes the DNS query the app makes before it connects anywhere. The handoff test used an IP address, so it never asked DNS: `nc 10.96.80.12 5432` matched the api→db rule and succeeded, while Beacon, which connects to `beacon-db.beacon.svc`, failed at name resolution ("Temporary failure in name resolution"), its /ready answered 503 and the pods left the Service. Depending on the seed: (a) the change has **no DNS egress rule at all**; (b) the DNS rule selects the namespace by a label `name: kube-system` that kube-system does not carry — the label every namespace does carry is `kubernetes.io/metadata.name`; (c) the rule selects pods `k8s-app: coredns`, but the cluster DNS pods are labelled `k8s-app: kube-dns`. The fix is one correct rule: to pods `k8s-app: kube-dns` in the namespace labelled `kubernetes.io/metadata.name: kube-system`, on 53/UDP and 53/TCP (resolvers fall back to TCP for truncated replies). Policies match the pod address and port after the Service is translated, which is why the rule names the DNS pods rather than 10.96.0.10. Deleting the default deny or adding an allow-all rule also "fixes" it — by removing the segmentation the change existed to add.',
      alternatives: [
        { h: 'The database is down', out: 'Ruled out by the handoff\'s own test: TCP to the database pod on 5432 succeeds.' },
        { h: 'CoreDNS is broken', out: 'Ruled out: the DNS pods are Running and answer as soon as a rule allows the query; nothing in kube-system changed.' },
        { h: 'Beacon needs a restart', out: 'Ruled out: readiness recovers by itself once lookups succeed; restarting only repeats the failure.' }
      ],
      clues: ['A test by IP address skips the one step that changed: name resolution.', 'An empty rule list under a policy that selects a pod means "deny everything" for that direction.', 'Selectors that match nothing fail silently: kubectl accepts the policy.'],
      passRubric: ['Separates "can connect by address" from "can resolve the name", with evidence of both', 'Explains how default-deny egress plus allow rules are evaluated (union of selecting policies)', 'Names the exact rule fault (missing, namespace label, or pod label) and why the corrected selectors match', 'Keeps default deny and unrelated egress denied, and proves a denied path after the fix', 'Verifies the client\'s path through the Service'],
      prereqs: ['les-m09-05'], refs: ['T05', 'T02', 'T23']
    }
  });

  /* ═══ S19 · Helm upgrade returns success; users see failures ═════════
     A Helm model: the chart on disk (Chart.yaml, values.yaml, templates/),
     a renderer for the template subset the chart uses ({{ .Values.x }},
     {{ .Release.Name }}, {{ .Chart.Version }}, default and quote), release
     history with stored values and manifests, and upgrade/rollback that
     write the rendered Service and Deployment into the cluster model. */
  var S19_DIR = '/home/lab/beacon-deploy';
  var S19_SVC_T = function (key) {
    return 'apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Release.Name }}-api\n  labels:\n    app.kubernetes.io/name: beacon\n    app.kubernetes.io/instance: {{ .Release.Name }}\n    helm.sh/chart: beacon-{{ .Chart.Version }}\nspec:\n  type: ClusterIP\n  selector:\n    app: beacon-api\n  ports:\n    - name: http\n      port: {{ .Values.service.port }}\n      targetPort: {{ .Values.service.' + key + ' }}\n      protocol: TCP\n';
  };
  var S19_DEP_T = function (probePort) {
    return 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Release.Name }}-api\n  labels:\n    app.kubernetes.io/name: beacon\n    app.kubernetes.io/instance: {{ .Release.Name }}\n    helm.sh/chart: beacon-{{ .Chart.Version }}\nspec:\n  replicas: {{ .Values.replicaCount }}\n  selector:\n    matchLabels:\n      app: beacon-api\n  template:\n    metadata:\n      labels:\n        app: beacon-api\n    spec:\n      containers:\n        - name: api\n          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"\n          ports:\n            - name: http\n              containerPort: {{ .Values.containerPort }}\n          readinessProbe:\n            httpGet:\n              path: /ready\n              port: ' + probePort + '\n          livenessProbe:\n            httpGet:\n              path: /healthz\n              port: ' + probePort + '\n';
  };
  function s19ChartTexts(version, v) {
    var renamed = version === '0.9.0' && v === 'b';
    return {
      chart: 'apiVersion: v2\nname: beacon\ndescription: Beacon API (course chart)\ntype: application\nversion: ' + version + '\nappVersion: "' + (version === '0.8.0' ? '1.4.0' : '1.4.1') + '"\n',
      values: 'replicaCount: 2\nimage:\n  repository: registry.lab/beacon/api\n  tag: ""\ncontainerPort: 8080\nservice:\n  port: 80\n' +
        (renamed ? '  # containerPort: the container port the Service forwards to.\n  # Renamed from service.targetPort in 0.9.0. No default: set it per environment.\n' : '  targetPort: 8080\n'),
      templates: { 'service.yaml': S19_SVC_T(renamed ? 'containerPort' : 'targetPort'), 'deployment.yaml': S19_DEP_T('http') }
    };
  }
  function s19Parse(text, what) {
    try { return { v: parseY(text) || {} }; }
    catch (e) { return { err: 'Error: failed to parse ' + what + ': error converting YAML to JSON: ' + e.message }; }
  }
  function deepMerge(a, b) {
    var out = clone(a || {});
    Object.keys(b || {}).forEach(function (k) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], b[k]);
      else out[k] = clone(b[k]);
    });
    return out;
  }
  function chartFromTexts(t) {
    var meta = s19Parse(t.chart, 'Chart.yaml'), vals = s19Parse(t.values, 'values.yaml');
    if (meta.err) return { err: meta.err };
    if (vals.err) return { err: vals.err };
    return { name: meta.v.name, version: String(meta.v.version), appVersion: String(meta.v.appVersion), defaults: vals.v, templates: t.templates };
  }
  function chartFromDisk(w, dir) {
    var root = LXShell.resolve(w, dir).replace(/\/$/, '');
    var cy = readF(w, root + '/Chart.yaml');
    if (cy == null) return { err: 'Error: path "' + dir + '" not found' + (/^[a-z0-9-]+\/[a-z0-9-]+$/.test(dir) && !LXShell.node(w, dir) ? ' (simulation: no chart repositories are configured here; use the local chart, charts/beacon)' : '') };
    var tpls = {};
    Object.keys(w.fs).filter(function (p) { return p.indexOf(root + '/templates/') === 0 && /\.ya?ml$/.test(p) && w.fs[p].t === 'f'; }).forEach(function (p) { tpls[p.slice(root.length + 11)] = w.fs[p].content || ''; });
    return chartFromTexts({ chart: cy, values: readF(w, root + '/values.yaml') || '', templates: tpls });
  }
  /* the template subset: {{ PATH }}, {{ PATH | default X }}, {{ default X PATH }}, {{ PATH | quote }} and template comments */
  function tplValue(tok, ctx) {
    tok = String(tok || '').trim();
    if (/^".*"$/.test(tok)) return tok.slice(1, -1);
    if (/^-?\d+$/.test(tok)) return Number(tok);
    var root = null, path;
    if (tok.indexOf('.Values') === 0) { root = ctx.Values; path = tok.slice(7); }
    else if (tok.indexOf('.Release') === 0) { root = ctx.Release; path = tok.slice(8); }
    else if (tok.indexOf('.Chart') === 0) { root = ctx.Chart; path = tok.slice(6); }
    else throw new Error('function "' + tok.split(/\s/)[0] + '" not defined (this simulation renders .Values, .Release, .Chart, default and quote)');
    var cur = root;
    path.split('.').filter(Boolean).forEach(function (k) { cur = cur == null ? undefined : cur[k]; });
    return cur;
  }
  function tplEmpty(v) { return v == null || v === '' || v === 0 || v === false || (typeof v === 'object' && !Object.keys(v).length); }
  function tplEval(expr, ctx) {
    expr = expr.trim();
    if (/^\/\*[\s\S]*\*\/$/.test(expr)) return '';
    var pipes = expr.split('|').map(function (x) { return x.trim(); }), val;
    var fm = /^(default|quote)\s+(.+)$/.exec(pipes[0]);
    if (fm && fm[1] === 'default') { var parts = fm[2].trim().split(/\s+/); var v = tplValue(parts[1], ctx); val = tplEmpty(v) ? tplValue(parts[0], ctx) : v; }
    else if (fm) val = '"' + String(tplValue(fm[2], ctx) == null ? '' : tplValue(fm[2], ctx)) + '"';
    else val = tplValue(pipes[0], ctx);
    pipes.slice(1).forEach(function (pp) {
      var pm = /^(default|quote)(?:\s+(.+))?$/.exec(pp);
      if (!pm) throw new Error('function "' + pp.split(/\s/)[0] + '" not defined (this simulation renders .Values, .Release, .Chart, default and quote)');
      if (pm[1] === 'default') { if (tplEmpty(val)) val = tplValue(pm[2], ctx); }
      else val = '"' + (val == null ? '' : String(val)) + '"';
    });
    if (val && typeof val === 'object') return 'map[' + Object.keys(val).join(' ') + ']';
    return val == null ? '' : String(val);   /* Helm drops "<no value>" from output */
  }
  function s19Render(chart, userVals, rel) {
    var ctx = { Values: deepMerge(chart.defaults, userVals), Release: { Name: rel, Namespace: 'beacon', Service: 'Helm' }, Chart: { Name: chart.name, Version: chart.version, AppVersion: chart.appVersion } };
    var names = Object.keys(chart.templates).sort(function (x, y) { var o = function (n) { return /service/.test(n) ? 0 : 1; }; return o(x) - o(y) || (x < y ? -1 : 1); });
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var text = chart.templates[names[i]], body;
      try {
        body = text.replace(/\s*\{\{-/g, '{{').replace(/-\}\}\s*/g, '}}').replace(/\{\{([\s\S]*?)\}\}/g, function (all, e) { return tplEval(e, ctx); });
      } catch (e) { return { err: 'Error: template: ' + chart.name + '/templates/' + names[i] + ': ' + e.message }; }
      out.push('---\n# Source: ' + chart.name + '/templates/' + names[i] + '\n' + body.replace(/[ \t]+$/gm, '').replace(/\n?$/, '\n'));
    }
    return { manifest: out.join(''), computed: ctx.Values };
  }
  function s19Docs(manifest) {
    return String(manifest || '').split(/^---\s*$/m).filter(function (x) { return x.replace(/#.*$/gm, '').trim(); }).map(function (x) { return parseY(x); });
  }
  function s19DocOf(manifest, kind) { return s19Docs(manifest).filter(function (d) { return d && d.kind === kind; })[0] || null; }
  function probeFrom(p) { var h = (p || {}).httpGet; return h ? { path: h.path, port: h.port, period: p.periodSeconds || 10 } : undefined; }
  function s19Tpl(d) {
    var t = d.spec.template, c = t.spec.containers[0];
    return { labels: t.metadata.labels, containers: [{ name: c.name, image: c.image, ports: (c.ports || []).map(function (x) { return { name: x.name, containerPort: x.containerPort }; }),
      readiness: probeFrom(c.readinessProbe), liveness: probeFrom(c.livenessProbe) }] };
  }
  function s19SvcPorts(d) { return (d.spec.ports || []).map(function (p) { return { name: p.name, port: p.port, targetPort: p.targetPort == null ? p.port : p.targetPort, protocol: p.protocol || 'TCP' }; }); }
  /* where the release's Service sends traffic, as a number */
  function s19Target(manifest) {
    var svc = s19DocOf(manifest, 'Service'), dp = s19DocOf(manifest, 'Deployment');
    if (!svc) return null;
    var p = s19SvcPorts(svc)[0], t = p.targetPort;
    if (typeof t === 'number' || /^\d+$/.test(String(t))) return Number(t);
    var hit = null;
    ((dp && dp.spec.template.spec.containers) || []).forEach(function (c) { (c.ports || []).forEach(function (cp) { if (cp.name === t) hit = cp.containerPort; }); });
    return hit;
  }
  function s19Apply(m, manifest) {
    s19Docs(manifest).forEach(function (d) {
      if (!d) return;
      if (d.kind === 'Service') {
        var svc = KM().find(m, 'services', d.metadata.name, m.ns);
        if (svc) { svc.ports = s19SvcPorts(d); svc.selector = d.spec.selector; }
      }
      if (d.kind === 'Deployment') {
        var dp = dep(m, d.metadata.name);
        if (!dp) return;
        dp.replicas = d.spec.replicas;
        var tpl = s19Tpl(d);
        if (KM().templateHash(tpl) !== KM().templateHash(dp.template)) KM().setTemplate(m, dp, tpl, 'helm upgrade');
      }
    });
    KM().reconcile(m);
  }
  function s19Cur(s) { var d = s.helm.revs.filter(function (r) { return r.status === 'deployed'; }); return d[d.length - 1] || null; }
  /* live objects that no longer match what the current release says */
  function s19Drift(s, m) {
    var cur = s19Cur(s);
    if (!cur || s.helm.uninstalled) return false;
    var sd = s19DocOf(cur.manifest, 'Service'), dd = s19DocOf(cur.manifest, 'Deployment');
    var svc = KM().find(m, 'services', 'beacon-api', m.ns), dp = dep(m, 'beacon-api');
    if (!svc || !dp) return true;
    var want = s19SvcPorts(sd)[0], have = (svc.ports || [])[0] || {};
    if (String(want.port) !== String(have.port) || String(want.targetPort) !== String(have.targetPort == null ? have.port : have.targetPort)) return true;
    if (Number(dd.spec.replicas) !== Number(dp.replicas)) return true;
    return dd.spec.template.spec.containers[0].image !== dp.template.containers[0].image;
  }
  function helmDate(clock) {
    var t = SIM().stamp({ clock: clock }), mm = /T(\d\d:\d\d:\d\d)/.exec(t);
    return 'Tue Oct 13 ' + mm[1] + ' 2026';
  }
  function s19Fixed(c) {
    var s = st(c), m = M(c), cur = s19Cur(s);
    if (s.helm.uninstalled || !cur || cur.chartVersion !== '0.9.0' || s19Target(cur.manifest) !== 8080 || s19Drift(s, m)) return false;
    var ch = chartFromDisk(c.w, S19_DIR + '/charts/beacon');
    if (ch.err) return false;
    var vf = s19Parse(readF(c.w, S19_DIR + '/deploy/values-prod.yaml'), 'values');
    if (vf.err) return false;
    var r = s19Render(ch, vf.v, 'beacon');
    if (r.err || s19Target(r.manifest) !== 8080) return false;
    var svc = KM().find(m, 'services', 'beacon-api', m.ns), ep = svc && KM().endpoints(m, svc);
    return !!ep && ep.ready.length >= 2 && ep.port === 8080;
  }
  function helmVerb(state) {
    var VAL = ['-f', '--values', '--set', '--revision', '-n', '--namespace', '--version', '-o', '--output', '--timeout', '--kube-context', '--description'];
    return function (w, a) {
      var m = w.k8sModel, H = state.helm, p = [], files = [], sets = [], f = {};
      for (var i = 0; i < a.length; i++) {
        var t = a[i], eq = t.indexOf('='), key = t.indexOf('--') === 0 && eq > 0 ? t.slice(0, eq) : t, val = t.indexOf('--') === 0 && eq > 0 ? t.slice(eq + 1) : null;
        if (VAL.indexOf(key) !== -1) { val = val != null ? val : a[++i]; if (key === '-f' || key === '--values') files.push(val); else if (key === '--set') sets.push(val); else f[key] = val; continue; }
        if (t.charAt(0) === '-' && t.length > 1) { f[key] = true; continue; }
        p.push(t);
      }
      var sub = p[0], ns = f['-n'] || f['--namespace'];
      if (!sub || sub === 'help' || f['--help']) return res('helm (simulation of v3.18): list, status, history, get values|manifest|all, template, lint, show values|chart, upgrade, rollback, uninstall, version.\nOnly the local chart (charts/beacon) and the release "beacon" in namespace beacon exist here.');
      if (sub === 'version') return res('version.BuildInfo{Version:"v3.18.6", GitCommit:"(simulated)", GitTreeState:"clean", GoVersion:"go1.24.6"}');
      KM().advance(m, KM().PER_COMMAND);
      if (ns && ns !== 'beacon' && ['list', 'ls', 'status', 'history', 'hist', 'get', 'upgrade', 'rollback', 'uninstall'].indexOf(sub) !== -1) return sub === 'list' || sub === 'ls' ? res('NAME\tNAMESPACE\tREVISION\tUPDATED\tSTATUS\tCHART\tAPP VERSION') : res('', 1, 'Error: release: not found');
      var relOk = function (name) { return name === 'beacon' && !H.uninstalled; };
      var cur = s19Cur(state), last = H.revs[H.revs.length - 1];
      function revOf(n) { return H.revs.filter(function (r) { return String(r.rev) === String(n); })[0]; }
      function userValues(prevVals) {
        var nv = {};
        for (var j = 0; j < files.length; j++) {
          var txt = readF(w, files[j]);
          if (txt == null) return { err: 'Error: open ' + files[j] + ': no such file or directory' };
          var pv = s19Parse(txt, files[j]);
          if (pv.err) return { err: pv.err };
          nv = deepMerge(nv, pv.v);
        }
        sets.forEach(function (sv) {
          String(sv).split(',').forEach(function (kv) {
            var e = kv.indexOf('='); if (e < 0) return;
            var ks = kv.slice(0, e).split('.'), v = kv.slice(e + 1), o = nv;
            v = /^-?\d+$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
            ks.forEach(function (k, n) { if (n === ks.length - 1) o[k] = v; else { o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}; o = o[k]; } });
          });
        });
        if (f['--reset-values']) return { v: nv };
        if (f['--reuse-values']) return { v: deepMerge(prevVals, nv) };
        if (!files.length && !sets.length) return { v: clone(prevVals) };
        return { v: nv };
      }
      function relTable() {
        return SIM().table(['NAME', 'NAMESPACE', 'REVISION', 'UPDATED', 'STATUS', 'CHART', 'APP VERSION'], H.uninstalled ? [] : [['beacon', 'beacon', last.rev, helmDate(last.at) + ' +0000 UTC', last.status, last.chart, last.appVersion]]);
      }
      if (sub === 'list' || sub === 'ls') return res(relTable());
      if (sub === 'history' || sub === 'hist') {
        if (!relOk(p[1])) return res('', 1, 'Error: release: not found');
        return res(SIM().table(['REVISION', 'UPDATED', 'STATUS', 'CHART', 'APP VERSION', 'DESCRIPTION'], H.revs.map(function (r) { return [r.rev, helmDate(r.at), r.status, r.chart, r.appVersion, r.desc]; })));
      }
      if (sub === 'status') {
        if (!relOk(p[1])) return res('', 1, 'Error: release: not found');
        return res('NAME: beacon\nLAST DEPLOYED: ' + helmDate(last.at) + '\nNAMESPACE: beacon\nSTATUS: ' + last.status + '\nREVISION: ' + last.rev + '\nTEST SUITE: None\nNOTES:\nBeacon API is served in-cluster at http://beacon-api.beacon.svc (port 80).');
      }
      if (sub === 'get') {
        var what = p[1];
        if (!relOk(p[2])) return res('', 1, 'Error: release: not found');
        var r = f['--revision'] ? revOf(f['--revision']) : last;
        if (!r) return res('', 1, 'Error: release: not found');
        if (what === 'values') {
          var all = f['-a'] || f['--all'], v = all ? deepMerge(r.defaults, r.values) : r.values;
          if (f['-o'] === 'json' || f['--output'] === 'json') return res(JSON.stringify(v));
          var head = (f['-o'] === 'yaml' || f['--output'] === 'yaml') ? '' : (all ? 'COMPUTED VALUES:\n' : 'USER-SUPPLIED VALUES:\n');
          return res(head + (Object.keys(v).length ? toYaml(v) : 'null'));
        }
        if (what === 'manifest') return res(r.manifest);
        if (what === 'all') return res('NAME: beacon\nREVISION: ' + r.rev + '\nCHART: ' + r.chart + '\nUSER-SUPPLIED VALUES:\n' + toYaml(r.values) + '\n\nHOOKS:\nMANIFEST:\n' + r.manifest);
        if (what === 'notes') return res('NOTES:\nBeacon API is served in-cluster at http://beacon-api.beacon.svc (port 80).');
        return SIM().unsupported('helm get', what || '', ['values [--revision N] [--all]', 'manifest [--revision N]', 'all', 'notes']);
      }
      if (sub === 'show' || sub === 'inspect') {
        var cdir = LXShell.resolve(w, p[2] || '').replace(/\/$/, '');
        if (p[1] === 'values') { var vt = readF(w, cdir + '/values.yaml'); return vt == null ? res('', 1, 'Error: path "' + (p[2] || '') + '" not found') : res(vt); }
        if (p[1] === 'chart') { var ct = readF(w, cdir + '/Chart.yaml'); return ct == null ? res('', 1, 'Error: path "' + (p[2] || '') + '" not found') : res(ct); }
        return SIM().unsupported('helm show', p[1] || '', ['values CHART', 'chart CHART']);
      }
      if (sub === 'lint') {
        var lc = chartFromDisk(w, p[1] || '.');
        if (lc.err) return res('', 1, lc.err);
        var lv = userValues({});
        if (lv.err) return res('', 1, lv.err);
        var lr = s19Render(lc, lv.v, 'beacon');
        if (lr.err) return res('==> Linting ' + p[1] + '\n[ERROR] templates/: ' + lr.err.replace(/^Error: /, '') + '\n\nError: 1 chart(s) linted, 1 chart(s) failed', 1);
        return res('==> Linting ' + p[1] + '\n[INFO] Chart.yaml: icon is recommended\n\n1 chart(s) linted, 0 chart(s) failed');
      }
      if (sub === 'template') {
        var tc = chartFromDisk(w, p[2] || p[1] || '');
        if (tc.err) return res('', 1, tc.err);
        var tv = userValues({});
        if (tv.err) return res('', 1, tv.err);
        var tr = s19Render(tc, tv.v, p[2] ? p[1] : 'release-name');
        return tr.err ? res('', 1, tr.err) : res(tr.manifest);
      }
      if (sub === 'diff') return res('', 1, 'Error: unknown command "diff" for "helm"\nRun \'helm --help\' for usage.\n(simulation: the helm-diff plugin is not installed; compare `helm get manifest beacon --revision N` with `helm template beacon charts/beacon -f …`, or save both and use diff)');
      if (sub === 'install') return res('', 1, H.uninstalled ? 'Error: INSTALLATION FAILED: (simulation) reinstalling after an uninstall is not modelled — reset the scenario' : 'Error: INSTALLATION FAILED: cannot re-use a name that is still in use');
      if (sub === 'uninstall' || sub === 'delete' || sub === 'del' || sub === 'un') {
        if (!relOk(p[1])) return res('', 1, 'Error: uninstall: Release not loaded: ' + (p[1] || '') + ': release: not found');
        H.uninstalled = true;
        m.services = m.services.filter(function (s) { return s.name !== 'beacon-api'; });
        var d0 = dep(m, 'beacon-api');
        if (d0) { d0.replicas = 0; KM().reconcile(m); }
        return res('release "beacon" uninstalled');
      }
      if (sub === 'upgrade') {
        var rel = p[1], chartArg = p[2];
        if (rel !== 'beacon') return res('', 1, 'Error: UPGRADE FAILED: "' + (rel || '') + '" has no deployed releases');
        if (H.uninstalled) return res('', 1, 'Error: UPGRADE FAILED: "beacon" has no deployed releases');
        var uc = chartFromDisk(w, chartArg || '');
        if (uc.err) return res('', 1, uc.err);
        var uv = userValues(cur ? cur.values : {});
        if (uv.err) return res('', 1, uv.err);
        var ur = s19Render(uc, uv.v, 'beacon');
        if (ur.err) return res('', 1, ur.err.replace(/^Error: /, 'Error: UPGRADE FAILED: '));
        if (f['--dry-run']) return res('Release "beacon" has been upgraded. Happy Helming!\nNAME: beacon\nNAMESPACE: beacon\nSTATUS: pending-upgrade\nREVISION: ' + (last.rev + 1) + '\nTEST SUITE: None\nHOOKS:\nMANIFEST:\n' + ur.manifest);
        H.revs.forEach(function (x) { if (x.status === 'deployed') x.status = 'superseded'; });
        var nr = { rev: last.rev + 1, chart: uc.name + '-' + uc.version, chartVersion: uc.version, appVersion: uc.appVersion, values: uv.v, defaults: clone(uc.defaults), manifest: ur.manifest, status: 'deployed', desc: 'Upgrade complete', at: state.clock };
        H.revs.push(nr);
        s19Apply(m, ur.manifest);
        if (f['--wait'] || f['--atomic']) { for (var k = 0; k < 60 && !KM().rolloutComplete(m, 'beacon-api', m.ns); k++) KM().advance(m, KM().STEP); }
        return res('Release "beacon" has been upgraded. Happy Helming!\nNAME: beacon\nLAST DEPLOYED: ' + helmDate(state.clock) + '\nNAMESPACE: beacon\nSTATUS: deployed\nREVISION: ' + nr.rev + '\nTEST SUITE: None\nNOTES:\nBeacon API is served in-cluster at http://beacon-api.beacon.svc (port 80).');
      }
      if (sub === 'rollback') {
        if (!relOk(p[1])) return res('', 1, 'Error: release: not found');
        var to = p[2] ? revOf(p[2]) : H.revs[H.revs.length - 2];
        if (!to || Number(p[2]) === 0) return res('', 1, 'Error: release has no ' + (p[2] || 'previous') + ' version');
        H.revs.forEach(function (x) { if (x.status === 'deployed') x.status = 'superseded'; });
        var rb = { rev: last.rev + 1, chart: to.chart, chartVersion: to.chartVersion, appVersion: to.appVersion, values: clone(to.values), defaults: clone(to.defaults), manifest: to.manifest, status: 'deployed', desc: 'Rollback to ' + to.rev, at: state.clock };
        H.revs.push(rb);
        s19Apply(m, to.manifest);
        if (f['--wait']) { for (var q = 0; q < 60 && !KM().rolloutComplete(m, 'beacon-api', m.ns); q++) KM().advance(m, KM().STEP); }
        return res('Rollback was a success! Happy Helming!');
      }
      return SIM().unsupported('helm', sub, ['list', 'status', 'history', 'get values|manifest|all', 'template', 'lint', 'show values|chart', 'upgrade', 'rollback', 'uninstall', 'version']);
    };
  }
  function s19Kubectl(state) {
    return function (w, a) {
      var p = pos(a), verb = p[0];
      if (verb === 'edit') { KM().advance(w.k8sModel, KM().PER_COMMAND); return res('', 1, 'kubectl edit: not supported in this simulation (no interactive editor). Note for the debrief: an edit to a Helm-managed object is overwritten by the next upgrade and hides the real fault from the release history.'); }
      var r = kubectlBase(w, a), di = a.indexOf('--');
      if (verb === 'exec' && di !== -1 && a[di + 1] === 'curl' && r.code && curlSilent(a.slice(di + 2))) return { out: r.out || '', code: r.code };
      return r;
    };
  }
  function s19ValuesProd(v, fixedTarget) {
    return '# beacon production values (applied by the release pipeline)\nreplicaCount: 2\nimage:\n  tag: "1.4.1"\nservice:\n  targetPort: ' + (fixedTarget || (v === 'a' ? 9090 : 8080)) + '\n';
  }
  LX.missions.push({
    id: 'sre-s19', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'Release pipeline green, beacon-api requests failing',
    brief: function () { return 'The release pipeline ran `helm upgrade` for beacon in the beacon namespace 25 minutes ago and reported success. Since then in-cluster clients cannot get an answer from beacon-api, while every beacon-api pod shows Ready. The chart and values live in /home/lab/beacon-deploy (charts/beacon, deploy/values-prod.yaml). Restore the user path through the release itself, keep the source files in step, and explain the cause.'; },
    keys: ['helm list -n beacon', 'helm history beacon', 'helm status beacon', 'kubectl exec deploy/beacon-client -- curl -sS http://beacon-api/version', 'kubectl get endpointslices -l kubernetes.io/service-name=beacon-api', 'kubectl describe svc beacon-api', 'kubectl describe pod ', 'helm get values beacon', 'helm get manifest beacon', 'helm template beacon charts/beacon -f deploy/values-prod.yaml'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
      var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], driftSeen: false, helm: { revs: [], uninstalled: false } };
      var c08 = chartFromTexts(s19ChartTexts('0.8.0', v)), c09 = chartFromTexts(s19ChartTexts('0.9.0', v));
      var vals1 = { replicaCount: 2, image: { tag: '1.4.0' }, service: { targetPort: 8080 } };
      var vals2 = { replicaCount: 2, image: { tag: '1.4.1' }, service: { targetPort: 8080 } };
      var vals3 = v === 'a' ? { replicaCount: 2, image: { tag: '1.4.1' }, service: { targetPort: 9090 } } : clone(vals2);
      if (v === 'a') { vals1 = { replicaCount: 2, image: { tag: '1.4.0' } }; vals2 = { replicaCount: 2, image: { tag: '1.4.1' } }; }
      var plan = v === 'a'
        ? [[c08, vals1, -7200, 'Install complete'], [c09, vals2, -3000, 'Upgrade complete'], [c09, vals3, -1500, 'Upgrade complete']]
        : [[c08, vals1, -7200, 'Install complete'], [c08, vals2, -3000, 'Upgrade complete'], [c09, vals3, -1500, 'Upgrade complete']];
      plan.forEach(function (pl, i) {
        var r = s19Render(pl[0], pl[1], 'beacon');
        state.helm.revs.push({ rev: i + 1, chart: 'beacon-' + pl[0].version, chartVersion: pl[0].version, appVersion: pl[0].appVersion, values: clone(pl[1]), defaults: clone(pl[0].defaults), manifest: r.manifest, status: i === plan.length - 1 ? 'deployed' : 'superseded', desc: pl[3], at: pl[2] });
      });
      var tpls = [];
      state.helm.revs.forEach(function (r) { var t = s19Tpl(s19DocOf(r.manifest, 'Deployment')); if (!tpls.length || JSON.stringify(tpls[tpls.length - 1]) !== JSON.stringify(t)) tpls.push(t); });
      var live = state.helm.revs[2].manifest;
      var apps = { 'registry.lab/beacon/api': beaconApiProfile('1.4.1'), 'registry.lab/beacon/api:1.4.0': beaconApiProfile('1.4.0'), 'registry.lab/tools/toolbox': TOOLBOX };
      var k8s = { namespace: 'beacon', context: 'kind-looped-foundations', now: 7200,
        nodes: [{ name: 'looped-foundations-control-plane', cpu: 3800, mem: 7680, arch: 'arm64', role: 'control-plane', taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] },
                { name: 'looped-foundations-worker', cpu: 3800, mem: 7680, arch: 'arm64' }, { name: 'looped-foundations-worker2', cpu: 3800, mem: 7680, arch: 'arm64' }],
        registry: { 'registry.lab/beacon/api:1.4.0': { arch: ['amd64', 'arm64'] }, 'registry.lab/beacon/api:1.4.1': { arch: ['amd64', 'arm64'] } }, apps: apps,
        services: [{ name: 'beacon-api', selector: { app: 'beacon-api' }, clusterIP: '10.96.112.40', ports: s19SvcPorts(s19DocOf(live, 'Service')) }],
        deployments: [{ name: 'beacon-api', replicas: 2, selector: { app: 'beacon-api' }, changedAgo: 3000, history: tpls }, clientDeployment()] };
      k8s.registry[TOOLBOX_IMG] = { arch: ['amd64', 'arm64'] };
      /* anything that changes release-managed objects outside Helm is drift */
      state.hooks.push(function (s, w) { var m = w && w.k8sModel; if (m && s19Drift(s, m)) s.driftSeen = true; });
      var t09 = s19ChartTexts('0.9.0', v), files = [
        { path: S19_DIR + '/charts/beacon/Chart.yaml', content: t09.chart },
        { path: S19_DIR + '/charts/beacon/values.yaml', content: t09.values },
        { path: S19_DIR + '/charts/beacon/templates/service.yaml', content: t09.templates['service.yaml'] },
        { path: S19_DIR + '/charts/beacon/templates/deployment.yaml', content: t09.templates['deployment.yaml'] },
        { path: S19_DIR + '/charts/beacon/CHANGELOG.md', content: v === 'b'
          ? '# beacon chart\n## 0.9.0\n- BREAKING: `service.targetPort` is renamed `service.containerPort` (no default; set it per environment)\n- image tag defaults to the chart appVersion\n## 0.8.0\n- first chart for Beacon\n'
          : '# beacon chart\n## 0.9.0\n- image tag defaults to the chart appVersion\n- chart labels follow app.kubernetes.io conventions\n## 0.8.0\n- first chart for Beacon\n' },
        { path: S19_DIR + '/deploy/values-prod.yaml', content: s19ValuesProd(v) },
        { path: S19_DIR + '/PIPELINE.md', content: '# release pipeline (beacon)\n1. helm lint charts/beacon\n2. helm upgrade beacon charts/beacon -n beacon -f deploy/values-prod.yaml\n3. mark the release green when helm exits 0\n\nLast run: ' + (v === 'a' ? '"values: point the Service at the metrics port for the new scrape config"' : '"bump chart to 0.9.0"') + ' — green.\n' }
      ];
      var w = k8sWorld(state, k8s, files, s19Kubectl(state), { helm: helmVerb(state) });
      w.cwd = S19_DIR;
      return w;
    },
    objectives: [
      { id: 'user', stage: 'evidence', text: 'Establish what the release says and what a client actually gets',
        hint: 'Two sources disagree: the deployment tool and the user. Ask both.',
        hint2: '`helm history beacon` (or `helm status beacon`), then `kubectl exec deploy/beacon-client -- curl -sS http://beacon-api/version`.',
        reveal: 'helm history beacon && kubectl exec deploy/beacon-client -- curl -sS http://beacon-api/version',
        done: function (c) { return saw(c, /helm\s+(history|hist|status|list|ls)\b/, /deployed/) && saw(c, /k(ubectl)?\b.*\bexec\b.*\bcurl\b.*beacon-api/, /Failed to connect|Couldn't connect|Connection refused/); } },
      { id: 'endpoints', stage: 'evidence', text: 'Find where the Service sends traffic and where the app is listening',
        hint: 'Ready pods only matter if the Service forwards to the port they listen on.',
        hint2: '`kubectl get endpointslices -l kubernetes.io/service-name=beacon-api` or `kubectl describe svc beacon-api`, and the container port from `kubectl describe pod NAME`.',
        reveal: function (c) { var p = podsOfApp(M(c), 'beacon-api')[0]; return 'kubectl get endpointslices -l kubernetes.io/service-name=beacon-api && kubectl describe pod ' + (p ? p.name : 'beacon-api'); },
        done: function (c) {
          var re = st(c).variant === 'a' ? /TargetPort:\s+9090\/TCP|\d+\.\d+\.\d+\.\d+:9090\b|targetPort: 9090\b|IPv4\s+9090\s|port: 9090\b/ : /TargetPort:\s+80\/TCP|\d+\.\d+\.\d+\.\d+:80\b|targetPort: 80\b|IPv4\s+80\s|- port: 80\b/;
          return saw(c, /k(ubectl)?\b.*\b(get\s+(ep|endpoints|endpointslices?)|describe\s+(svc|services?|endpointslices?)|get\s+(svc|services?)\b.*-o\s*=?\s*(yaml|json))/, re) &&
            saw(c, /k(ubectl)?\b.*\b(describe\s+(po|pods?|deploy|deployments?)|get\s+(po|pods?|deploy|deployments?)\b.*-o\s*=?\s*(yaml|json))|helm\s+(get\s+manifest|template)/, /8080/);
        } },
      { id: 'render', stage: 'evidence', text: 'Compare the desired state the release rendered with what it was rendered from',
        hint: 'Helm applied exactly what it rendered. Which input produced the Service you just saw?',
        hint2: '`helm get manifest beacon` (what was applied), `helm get values beacon` (what was supplied, `--revision N` for older ones), and the chart\'s templates and CHANGELOG.',
        reveal: function (c) { return st(c).variant === 'a' ? 'helm get values beacon && helm get manifest beacon' : 'helm get manifest beacon && cat charts/beacon/templates/service.yaml'; },
        done: function (c) {
          var rendered = saw(c, /helm\s+(get\s+manifest|get\s+all|template)\b/, /targetPort/);
          if (st(c).variant === 'a') return rendered && saw(c, /helm\s+get\s+(values|all)\b|cat\s+\S*values-prod\.yaml/, /targetPort: 9090/);
          return rendered && saw(c, /cat\s+\S*(charts\/beacon\/templates\/service\.yaml|templates\/service\.yaml|CHANGELOG\.md)|helm\s+show\s+(values|chart|readme|all)/, /service\.containerPort/);
        } },
      { id: 'fix', stage: 'fix', text: 'Correct the release\'s inputs in the source files and roll the release forward so the Service reaches the app',
        hint: 'Change the input Helm renders from, then let Helm apply it. A live edit would be undone by the next pipeline run.',
        hint2: 'Edit deploy/values-prod.yaml (sed -i, edit), check with `helm template beacon charts/beacon -f deploy/values-prod.yaml`, then `helm upgrade beacon charts/beacon -n beacon -f deploy/values-prod.yaml`. A `helm rollback` first is a fine mitigation.',
        reveal: function (c) {
          return st(c).variant === 'a'
            ? 'sed -i \'s/targetPort: 9090/targetPort: 8080/\' deploy/values-prod.yaml && helm upgrade beacon charts/beacon -n beacon -f deploy/values-prod.yaml'
            : 'sed -i \'s/  targetPort: 8080/  containerPort: 8080/\' deploy/values-prod.yaml && helm upgrade beacon charts/beacon -n beacon -f deploy/values-prod.yaml';
        },
        done: function (c) { return s19Fixed(c); } },
      { id: 'verify', stage: 'verify', text: 'Verify the Service has endpoints on the app\'s port and the client gets Beacon\'s answer',
        hint: 'Check the routing object, then the user path.',
        hint2: '`kubectl get endpointslices -l kubernetes.io/service-name=beacon-api`, then `kubectl exec deploy/beacon-client -- curl -sS http://beacon-api/version`.',
        reveal: 'kubectl get endpointslices -l kubernetes.io/service-name=beacon-api && kubectl exec deploy/beacon-client -- curl -sS http://beacon-api/version',
        done: function (c) { return s19Fixed(c) && lastIs(c, /k(ubectl)?\b.*\bexec\b.*beacon-client\b.*\bcurl\b.*beacon-api/, /"version": "1\.4\.1"/) && lastCode(c) === 0; } }
    ],
    sre: {
      scenarioId: 'S19', moduleId: 'M10', lab: 'L19', variants: ['a', 'b'],
      symptom: 'helm upgrade exited 0 and every beacon-api pod is Ready, but in-cluster requests to the beacon-api Service fail to connect.',
      neutralTitle: 'Release green, beacon-api requests failing',
      neutralBrief: 'The release pipeline upgraded beacon 25 minutes ago and reported success. Since then in-cluster clients get no answer from beacon-api, while its pods all show Ready. Restore the user path through the release itself, keep the source files in step, and explain the cause.',
      impact: 'Every in-cluster call to beacon-api fails; the pods are healthy, so readiness-based alerts stay quiet.',
      changes: 'The release pipeline ran helm upgrade (revision 3 of beacon) 25 minutes ago; helm exited 0 and the run was marked green.',
      spoilers: ['targetPort', 'containerPort', '9090', 'renamed', 'port 80', 'endpoint', 'values'],
      tools: ['helm (list, status, history, get values|manifest, template, lint, show values, upgrade, rollback)', 'kubectl (get/describe svc, endpoints, endpointslices, pods, exec … curl)', 'cat', 'sed -i', 'edit', 'diff'],
      grammar: [
        '`helm history|status beacon`, `helm get values beacon [--revision N] [--all]`, `helm get manifest beacon [--revision N]`, `helm show values charts/beacon`, `helm lint charts/beacon`',
        '`helm template beacon charts/beacon -f FILE [--set k=v]`, `helm upgrade beacon charts/beacon -n beacon -f FILE [--set k=v] [--reuse-values] [--wait|--atomic] [--dry-run]`, `helm rollback beacon [REV]`',
        '`kubectl get endpointslices -l kubernetes.io/service-name=beacon-api`, `kubectl describe svc beacon-api`, `kubectl exec deploy/beacon-client -- curl -sS http://beacon-api/version`; `helm get manifest … > FILE` then `diff A B`'
      ],
      palette: ['helm history beacon', 'helm status beacon', 'kubectl exec deploy/beacon-client -- curl -sS http://beacon-api/version', 'kubectl get endpointslices -l kubernetes.io/service-name=beacon-api', 'kubectl describe svc beacon-api', 'helm get values beacon', 'helm get manifest beacon', 'cat charts/beacon/CHANGELOG.md', 'helm template beacon charts/beacon -f deploy/values-prod.yaml', 'helm upgrade beacon charts/beacon -n beacon -f deploy/values-prod.yaml'],
      assumptions: ['Beacon listens on 8080 (port name http); its probes and /metrics share that port.', 'deploy/values-prod.yaml and charts/beacon are the source of truth the pipeline applies; the next pipeline run re-applies them.', 'Rolling back is an acceptable mitigation; the goal is chart 0.9.0 with correct values.'],
      simplified: K8S_SIMPLIFIED.concat([
        'Helm is modelled for one release with a local chart: the renderer supports .Values/.Release/.Chart references with default and quote, nothing else (no include, toYaml, range or if). Missing values render as empty, as Helm does, and an empty targetPort is defaulted by the API server to the Service port.',
        'Upgrades and rollbacks write the rendered Service and Deployment into the cluster model and complete synchronously; hooks, tests, three-way merge details and release secrets are not modelled. --wait waits for pod readiness only, as Helm does — it does not test the Service path.'
      ]),
      unsafe: [
        { label: 'patched the live objects outside Helm', why: 'kubectl patch/edit/scale on a release-managed Service or Deployment makes the cluster disagree with the release: the next `helm upgrade` from the same values puts the fault back, and the history no longer explains what is running.',
          test: function (c) { return !!st(c).driftSeen; },
          demo: 'kubectl patch svc beacon-api -p \'{"spec":{"ports":[{"name":"http","port":80,"targetPort":8080}]}}\'' },
        { label: 'uninstalled the release', why: '`helm uninstall` deletes the Service and Deployment: a total outage and the loss of the release history that explains the fault, in exchange for a clean slate the values file would reproduce.',
          test: function (c) { return !!st(c).helm.uninstalled; },
          demo: 'helm uninstall beacon -n beacon' }
      ],
      alt: function (v) {
        if (v === 'a') return ['helm list -n beacon', 'kubectl exec deploy/beacon-client -- curl -sS -o /dev/null -w "%{http_code}" http://beacon-api/healthz', 'kubectl describe svc beacon-api', 'kubectl get pods -o wide', 'kubectl get deploy beacon-api -o yaml',
          'helm history beacon', 'helm get values beacon --revision 2', 'helm get values beacon', 'helm get manifest beacon --revision 2 > /tmp/rev2.yaml', 'helm get manifest beacon > /tmp/rev3.yaml', 'diff /tmp/rev2.yaml /tmp/rev3.yaml',
          'helm rollback beacon 2', 'kubectl exec deploy/beacon-client -- curl -sS http://beacon-api/version', 'edit deploy/values-prod.yaml service.targetPort 8080',
          'helm template beacon charts/beacon -f deploy/values-prod.yaml', 'helm upgrade beacon charts/beacon -f deploy/values-prod.yaml --wait', 'kubectl exec deploy/beacon-client -- curl -sS http://beacon-api/version'];
        return ['helm status beacon', 'kubectl exec deploy/beacon-client -- curl -sS http://beacon-api/version', 'kubectl get endpoints beacon-api', 'kubectl get pods -o wide', 'helm history beacon',
          'helm get manifest beacon --revision 2', 'helm template beacon charts/beacon -f deploy/values-prod.yaml', 'cat charts/beacon/CHANGELOG.md', 'helm show values charts/beacon',
          'sed -i \'s/targetPort: 8080/containerPort: http/\' deploy/values-prod.yaml', 'helm template beacon charts/beacon -f deploy/values-prod.yaml', 'helm upgrade beacon ./charts/beacon -n beacon -f deploy/values-prod.yaml --atomic',
          'kubectl get endpoints beacon-api', 'kubectl exec deploy/beacon-client -- curl -sS http://beacon-api/version'];
      },
      mechanism: 'Helm reports success when the API server accepts the rendered objects (and, with --wait, when pods are Ready). Neither checks that a Service forwards to the port the app listens on. The release rendered a Service whose **targetPort** is not Beacon\'s 8080, so the pods are Ready and the EndpointSlice lists them — on the wrong port — and every connection through the Service is refused. Depending on the seed: (a) a values change set `service.targetPort: 9090` (to "point the Service at the metrics port"), but Beacon serves /metrics on 8080 and nothing listens on 9090; (b) chart 0.9.0 renamed `service.targetPort` to `service.containerPort` with no default, the production values still set the old key, Helm silently ignored it and rendered an empty targetPort, which the API server defaulted to the Service port, **80**. `helm get manifest` shows exactly what was applied; comparing it with `--revision 2` or with `helm template` from the values file isolates the input. The durable fix is in the values file (remove the override, or set the renamed key), applied with `helm upgrade` so the release history, the files and the cluster agree; a rollback is a valid mitigation on the way. Patching the live Service fixes the symptom until the next pipeline run.',
      alternatives: [
        { h: 'The pods are unhealthy', out: 'Ruled out: all pods are Ready and in-pod requests to localhost:8080 succeed; probes use the named port http.' },
        { h: 'The Service selector is wrong', out: 'Ruled out: the EndpointSlice lists both pods; only its port is wrong.' },
        { h: 'Helm failed silently', out: 'Ruled out: Helm applied exactly what it rendered; the rendered manifest itself carries the wrong port.' }
      ],
      clues: ['"STATUS: deployed" means the API server accepted the objects, not that users can reach them.', 'An EndpointSlice port is the Service targetPort resolved against the pods — compare it with the container port.'],
      passRubric: ['Shows Ready pods but a Service targeting a port nothing listens on, with the endpoint and container port evidence', 'Traces the rendered value back to its input (values override, or renamed chart key)', 'Fixes the values file and rolls the release forward (rollback only as mitigation); explains why a live patch is unsafe', 'Verifies endpoints and the client path after the upgrade'],
      prereqs: ['les-m10-01', 'les-m08-03'], refs: ['T13', 'T02']
    }
  });

  /* ═══ S20 · Emergency manual fix disappears ═══════════════════════════
     A reconciler stand-in (`gitops`, modelled on Flux's kustomize-controller)
     renders a Kustomize-style overlay from what was pushed to origin and,
     every interval on the scenario clock, puts the live Deployment back to
     that rendering. The repository is the LXSim git model; `git push` is
     what the reconciler can see. */
  var S20_DIR = '/home/lab/beacon-gitops';
  var S20_OVERLAY = 'apps/beacon/overlays/prod';
  var S20_PATCH = S20_OVERLAY + '/deployment-prod.yaml';
  var S20_POOL = 'BEACON_STORE_POOL_SIZE';
  function s20BaseYaml() {
    return 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: beacon-api\n  namespace: beacon\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: beacon-api\n  template:\n    metadata:\n      labels:\n        app: beacon-api\n    spec:\n      containers:\n        - name: api\n          image: registry.lab/beacon/api:1.4.1\n          ports:\n            - name: http\n              containerPort: 8080\n          env:\n            - name: ' + S20_POOL + '\n              value: "10"\n          readinessProbe:\n            httpGet:\n              path: /ready\n              port: http\n          livenessProbe:\n            httpGet:\n              path: /healthz\n              port: http\n';
  }
  function s20PatchYaml(replicas, pool) {
    return 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: beacon-api\nspec:\n  replicas: ' + replicas + '\n  template:\n    spec:\n      containers:\n        - name: api\n          env:\n            - name: ' + S20_POOL + '\n              value: "' + pool + '"\n';
  }
  function joinPath(dir, rel) {
    var parts = (dir + '/' + rel).split('/'), out = [];
    parts.forEach(function (p) { if (!p || p === '.') return; if (p === '..') out.pop(); else out.push(p); });
    return out.join('/');
  }
  /* strategic merge as kubectl/kustomize do for these fields: lists of named items merge by name */
  function smerge(dst, src) {
    Object.keys(src || {}).forEach(function (k) {
      var v = src[k];
      if (v === null) { delete dst[k]; return; }
      if (Array.isArray(v) && Array.isArray(dst[k]) && v.every(function (x) { return x && typeof x === 'object' && x.name; })) {
        v.forEach(function (item) { var hit = dst[k].filter(function (x) { return x && x.name === item.name; })[0]; if (hit) smerge(hit, item); else dst[k].push(clone(item)); });
        return;
      }
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) { smerge(dst[k], v); return; }
      dst[k] = clone(v);
    });
    return dst;
  }
  /* render an overlay directory; get(path) reads a repo-relative file (working tree or origin) */
  function s20Render(get, dir) {
    dir = joinPath(dir || S20_OVERLAY, '');
    try {
      var kz = get(dir + '/kustomization.yaml');
      if (kz == null) return { err: 'kustomize: ' + dir + ': missing kustomization.yaml' };
      var k = parseY(kz) || {}, doc = null;
      (k.resources || []).forEach(function (r) {
        var p = joinPath(dir, r);
        if (/\.ya?ml$/.test(p)) { var t = get(p); if (t == null) throw new Error('accumulating resources: ' + p + ': no such file'); doc = parseY(t); return; }
        var sub = s20Render(get, p);
        if (sub.err) throw new Error(sub.err);
        doc = sub.doc;
      });
      if (!doc) throw new Error(dir + ': no resources');
      var patches = (k.patches || []).map(function (x) { return x && x.path; }).concat(k.patchesStrategicMerge || []).filter(Boolean);
      patches.forEach(function (pp) {
        var t = get(joinPath(dir, pp));
        if (t == null) throw new Error('trouble configuring builtin PatchTransformer: ' + joinPath(dir, pp) + ': no such file');
        smerge(doc, parseY(t));
      });
      return { doc: doc };
    } catch (e) { return { err: 'kustomize build failed: ' + e.message }; }
  }
  function s20Want(doc) {
    var c = ((((doc || {}).spec || {}).template || {}).spec || {}).containers || [], api = c.filter(function (x) { return x.name === 'api'; })[0] || {};
    var pool = ((api.env || []).filter(function (e) { return e.name === S20_POOL; })[0] || {}).value;
    return { replicas: Number(doc.spec.replicas), image: api.image, pool: pool == null ? null : String(pool) };
  }
  function s20Live(m) {
    var d = dep(m, 'beacon-api'), c = d.template.containers[0];
    var pool = ((c.env || []).filter(function (e) { return e.name === S20_POOL; })[0] || {}).value;
    return { replicas: d.replicas, image: c.image, pool: pool == null ? null : String(pool) };
  }
  function s20Good(s, want) {
    if (s.variant === 'a') return want.replicas >= 6 && want.replicas <= 10;
    var n = Number(want.pool);
    return /^\d+$/.test(String(want.pool)) && n >= 10 && n <= 40 && n * want.replicas <= 90;
  }
  function s20LiveFixed(s, m) {
    var d = dep(m, 'beacon-api');
    if (!d || !s20Good(s, s20Live(m))) return false;
    return KM().rolloutComplete(m, 'beacon-api', m.ns) && readyOf(m, 'beacon-api') === d.replicas;
  }
  function s20Event(s, type, reason, msg) { s.flux.events.push({ at: s.clock, type: type, reason: reason, msg: msg }); if (s.flux.events.length > 60) s.flux.events.shift(); }
  /* one reconciliation: render origin, correct drift on the Deployment */
  function s20Reconcile(s, w) {
    var m = w.k8sModel, F = s.flux;
    F.lastAt = s.clock; F.nextAt = s.clock + F.interval;
    var r = s20Render(function (p) { return s.remote.files[p]; });
    if (r.err) { F.ready = false; F.msg = r.err; s20Event(s, 'Warning', 'BuildFailed', r.err); return; }
    var want = s20Want(r.doc), d = dep(m, 'beacon-api'), have = s20Live(m), drift = [];
    if (want.replicas !== have.replicas) { drift.push('spec.replicas ' + have.replicas + ' -> ' + want.replicas); d.replicas = want.replicas; KM().event(m, 'Deployment', d, 'Normal', 'ScalingReplicaSet', 'Scaled deployment beacon-api to ' + want.replicas, 'deployment-controller'); }
    if (want.image !== have.image || want.pool !== have.pool) {
      if (want.pool !== have.pool) drift.push('env ' + S20_POOL + ' "' + have.pool + '" -> "' + want.pool + '"');
      if (want.image !== have.image) drift.push('image ' + have.image + ' -> ' + want.image);
      var tpl = clone(d.template), c = tpl.containers[0];
      c.image = want.image;
      c.env = (c.env || []).filter(function (e) { return e.name !== S20_POOL; }).concat(want.pool == null ? [] : [{ name: S20_POOL, value: want.pool }]);
      KM().setTemplate(m, d, tpl, 'kustomize-controller');
    }
    KM().reconcile(m);
    F.ready = true; F.appliedSha = s.remote.sha; F.msg = 'Applied revision: main@sha1:' + s.remote.sha;
    if (drift.length) s20Event(s, 'Normal', 'Progressing', 'Deployment/beacon/beacon-api configured (drift corrected: ' + drift.join('; ') + ')');
    s20Event(s, 'Normal', 'ReconciliationSucceeded', 'Reconciliation finished in 1.1s, next run in 1m0s');
    if (s.fixedAt != null && s.clock > s.fixedAt && s20LiveFixed(s, m)) s.survived = true;
  }
  function s20Tick(s, w) {
    var m = w && w.k8sModel; if (!m) return;
    var F = s.flux;
    if (!F.removed && !F.suspended && s.clock >= F.nextAt) s20Reconcile(s, w);
    if (s20LiveFixed(s, m)) { if (s.fixedAt == null) s.fixedAt = s.clock; }
    else { s.fixedAt = null; s.survived = false; }
  }
  function s20Fixed(c) {
    var s = st(c), m = M(c), F = s.flux;
    if (F.removed || s.forcePushed || !s20LiveFixed(s, m)) return false;
    if (F.suspended) return !!F.documented;
    var r = s20Render(function (p) { return s.remote.files[p]; });
    return !r.err && s20Good(s, s20Want(r.doc)) && F.appliedSha === s.remote.sha;
  }
  function s20Held(c) { var s = st(c); return s.flux.suspended ? s.fixedAt != null && s.clock - s.fixedAt >= s.flux.interval : !!s.survived; }
  function ago(sec) { return sec <= 0 ? 'just now' : KM().age(sec) + ' ago'; }
  function gitopsVerb(state) {
    return function (w, a) {
      var m = w.k8sModel, F = state.flux, sub = a[0], name = a.filter(function (x, i) { return i > 0 && x.charAt(0) !== '-' && ['--ticket', '--reason', '--path'].indexOf(a[i - 1]) === -1; })[0];
      var HEAD = 'gitops is a SIMULATION stand-in for a GitOps reconciler CLI (modelled on Flux: flux get/reconcile/suspend/resume/events/diff).';
      if (!sub || sub === 'help' || sub === '--help') return res(HEAD + '\nUsage:\n  gitops status [beacon]                       source, path, applied revision, suspended, next run\n  gitops events [beacon]                       what the reconciler did, newest last\n  gitops sync beacon                           fetch origin and reconcile now\n  gitops diff beacon                           working tree rendering vs the live cluster\n  gitops suspend beacon --ticket ID --reason "…"  stop reconciling, with a change record\n  gitops resume beacon                         resume (reconciles immediately)\n');
      KM().advance(m, KM().PER_COMMAND);
      if (name && name !== 'beacon') return res('', 1, '✗ Kustomization ' + name + ' not found in flux-system (this simulation has one: beacon)');
      if (F.removed && sub !== 'status') return res('', 1, '✗ the reconciler is not running (kustomize-controller has no ready replicas)');
      if (sub === 'status' || sub === 'get') {
        var next = F.suspended || F.removed ? '-' : 'in ' + KM().age(Math.max(0, F.nextAt - state.clock));
        return res(SIM().table(['NAME', 'REVISION', 'SUSPENDED', 'READY', 'MESSAGE'], [['beacon', 'main@sha1:' + (F.appliedSha || '').slice(0, 12), F.suspended ? 'True' : 'False', F.removed ? 'Unknown' : F.ready ? 'True' : 'False', F.removed ? 'reconciler not running' : F.msg.replace(/sha1:([0-9a-f]{12})[0-9a-f]+/, 'sha1:$1')]]) +
          'source:   ssh://git.corp.lab/platform/beacon-gitops.git (branch main, origin at ' + state.remote.sha.slice(0, 12) + ')\npath:     ./' + S20_OVERLAY + '\ninterval: 1m0s   last run: ' + ago(state.clock - F.lastAt) + '   next run: ' + next + '   prune: true' +
          (F.suspended ? '\nsuspended: ' + (F.documented ? F.documented.ticket + ' — ' + F.documented.reason : '(no change record)') : ''));
      }
      if (sub === 'events' || sub === 'logs') {
        return res(SIM().table(['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'], F.events.slice(-14).map(function (e) { return [KM().age(Math.max(0, state.clock - e.at)), e.type, e.reason, 'Kustomization/beacon', e.msg]; })));
      }
      if (sub === 'sync' || sub === 'reconcile') {
        if (F.suspended) return res('', 1, '► annotating Kustomization beacon in flux-system namespace\n✗ resource is suspended');
        var before = F.appliedSha;
        s20Reconcile(state, w);
        KM().advance(m, KM().PER_COMMAND);
        return F.ready ? res('► annotating GitRepository beacon-gitops in flux-system namespace\n✔ fetched revision main@sha1:' + state.remote.sha + '\n► annotating Kustomization beacon in flux-system namespace\n◎ waiting for Kustomization reconciliation\n✔ applied revision main@sha1:' + F.appliedSha + (before === F.appliedSha ? '' : ' (was ' + String(before).slice(0, 12) + ')'))
          : res('', 1, '✗ ' + F.msg);
      }
      if (sub === 'diff') {
        var r = s20Render(function (p) { return readF(w, S20_DIR + '/' + p); });
        if (r.err) return res('', 1, '✗ ' + r.err);
        var want = s20Want(r.doc), have = s20Live(m), lines = [];
        if (want.replicas !== have.replicas) lines.push('  spec.replicas: live ' + have.replicas + ', working tree ' + want.replicas);
        if (want.pool !== have.pool) lines.push('  env ' + S20_POOL + ': live "' + have.pool + '", working tree "' + want.pool + '"');
        if (want.image !== have.image) lines.push('  image: live ' + have.image + ', working tree ' + want.image);
        return lines.length ? { out: '► Deployment/beacon/beacon-api drifted\n' + lines.join('\n') + '\n(working tree vs live cluster; the reconciler applies what is pushed to origin, not your working tree)\n', code: 1 } : res('✔ no changes between the working tree rendering and the live cluster');
      }
      if (sub === 'suspend') {
        var ticket = flagOf(a, ['--ticket']), reason = flagOf(a, ['--reason']);
        var documented = !!ticket && /^[A-Z][A-Z0-9]*-\d+$/.test(ticket) && !!reason && String(reason).trim().length >= 10;
        F.suspended = true; F.documented = documented ? { ticket: ticket, reason: String(reason).trim() } : null;
        F.suspendLog.push({ at: state.clock, ticket: ticket || null, reason: reason || null, documented: documented });
        s20Event(state, 'Normal', 'Suspended', 'Reconciliation suspended' + (documented ? ' (' + ticket + ': ' + reason + ')' : ''));
        return res('► suspending kustomization beacon in flux-system namespace\n✔ kustomization suspended' + (documented ? '\nrecorded: ' + ticket + ' — ' + reason : ''));
      }
      if (sub === 'resume') {
        if (!F.suspended) return res('✔ kustomization beacon is not suspended');
        F.suspended = false; F.documented = null;
        s20Event(state, 'Normal', 'Resumed', 'Reconciliation resumed');
        s20Reconcile(state, w);
        return res('► resuming kustomization beacon in flux-system namespace\n✔ kustomization resumed\n◎ waiting for Kustomization reconciliation\n✔ applied revision main@sha1:' + F.appliedSha);
      }
      if (sub === 'uninstall' || sub === 'delete') {
        F.removed = true;
        return res(sub === 'delete' ? '► deleting kustomization beacon in flux-system namespace\n✔ kustomization deleted' : '► deleting components in flux-system namespace\n✔ uninstall finished');
      }
      return SIM().unsupported('gitops', sub, ['status', 'events', 'sync', 'diff', 'suspend --ticket --reason', 'resume']);
    };
  }
  function kustomizeVerb() {
    return function (w, a) {
      if (a[0] !== 'build' || !a[1]) return res('', 1, 'kustomize (simulation): kustomize build DIR — renders resources plus strategic-merge patches from this repository');
      var dir = String(a[1]).replace(/^\.\//, '').replace(/\/$/, '');
      var r = s20Render(function (p) { return readF(w, S20_DIR + '/' + p); }, dir);
      return r.err ? res('', 1, 'Error: ' + r.err) : res(toYaml(r.doc));
    };
  }
  function s20Git(state) {
    var g = SIM().verbs.git(state), FORCE = ['--force', '-f', '--force-with-lease'];
    return function (w, a) {
      a = a.slice();
      if (a[0] === 'commit' && a.indexOf('--amend') !== -1) return res('', 1, 'git commit --amend is not modelled here: it rewrites a commit that may already be pushed. Make a new commit.');
      if (['reset', 'rebase', 'pull', 'fetch', 'cherry-pick', 'stash'].indexOf(a[0]) !== -1) return SIM().unsupported('git', a[0], ['status', 'diff', 'log', 'show', 'add', 'commit -m', 'checkout', 'push', 'branch']);
      if (a[0] === 'commit') {
        var ai = -1;
        a.forEach(function (x, i) { if (ai === -1 && /^-[a-z]*a[a-z]*$/.test(x)) ai = i; });
        if (ai !== -1) { g(w, ['add', '.']); var rest = a[ai].replace('a', ''); if (rest === '-') a.splice(ai, 1); else a[ai] = rest; }
      }
      var forced = a[0] === 'push' && hasFlag(a, FORCE);
      if (forced) state.forcePushed = true;
      var r = g(w, a.filter(function (x) { return FORCE.indexOf(x) === -1; }));
      /* the git model pads short hashes with zeros; give new commits a full-looking id */
      if (a[0] === 'commit' && r.code === 0 && state.git.log[0] && /0{6,}$/.test(state.git.log[0].sha)) {
        var h = state.git.log[0].sha.replace(/0+$/, ''), k = 0;
        while (h.length < 40) h += SIM().fnv(h + (k++)).toString(16);
        state.git.log[0].sha = h.slice(0, 40);
      }
      if (a[0] === 'push' && r.code === 0 && state.git.branch === 'main') {
        var head = state.git.log[0];
        if (head.sha !== state.remote.sha || forced) {
          state.remote = { sha: head.sha, msg: head.msg, files: clone(state.git.files) };
          if (forced && !/up-to-date/.test(r.out || '')) r = res(String(r.out || '').replace(/\n?$/, '') + '\n + ' + head.sha.slice(0, 7) + '...' + head.sha.slice(0, 7) + ' main -> main (forced update)');
        }
      }
      return r;
    };
  }
  function s20Kubectl(state) {
    return function (w, a) {
      var m = w.k8sModel, p = pos(a), verb = p[0], ns = nsOf(a);
      if (ns === 'flux-system') {
        KM().advance(m, KM().PER_COMMAND);
        var kind = (p[1] || '').split('/')[0];
        if ((verb === 'scale' && String(flagOf(a, ['--replicas'])) === '0') || verb === 'delete') {
          state.flux.removed = true;
          return res(verb === 'delete' ? (p[1] || 'object') + ' "' + (p[2] || (p[1] || '').split('/')[1] || 'kustomize-controller') + '" deleted' : 'deployment.apps/kustomize-controller scaled');
        }
        if (verb === 'get' && /^(po|pod|pods|deploy|deployment|deployments)$/.test(kind)) {
          var up = state.flux.removed ? '0/1' : '1/1';
          if (/^(po|pod|pods)$/.test(kind)) return res(SIM().table(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'], state.flux.removed ? [['source-controller-6c8f7b5d9-x4kqz', '1/1', 'Running', '0', '41d']] : [['kustomize-controller-7d4b6c8f5-p9wtr', '1/1', 'Running', '0', '41d'], ['source-controller-6c8f7b5d9-x4kqz', '1/1', 'Running', '0', '41d']]));
          return res(SIM().table(['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE'], [['kustomize-controller', up, up.charAt(0), up.charAt(0), '41d'], ['source-controller', '1/1', '1', '1', '41d']]));
        }
        return res('', 1, 'error: in flux-system this simulation models only get pods/deploy, scale and delete of the controllers; use the gitops command for the reconciler itself');
      }
      if (verb === 'set' && p[1] === 'env') {
        KM().advance(m, KM().PER_COMMAND);
        var ref = p[2] || '', dn = ref.indexOf('/') > 0 ? ref.split('/')[1] : p[3];
        var d = dn && dep(m, dn);
        if (!d) return res('', 1, 'Error from server (NotFound): deployments.apps "' + (dn || '') + '" not found');
        var pairs = p.slice(ref.indexOf('/') > 0 ? 3 : 4).filter(function (x) { return /^[A-Za-z_][A-Za-z0-9_]*-?=?/.test(x); });
        if (!pairs.length) return res('', 1, 'error: at least one environment variable must be provided (NAME=value or NAME-)');
        var tpl = clone(d.template), c = tpl.containers[0];
        pairs.forEach(function (kv) {
          var e = kv.indexOf('=');
          if (e < 0 && /-$/.test(kv)) { c.env = (c.env || []).filter(function (x) { return x.name !== kv.slice(0, -1); }); return; }
          var k = kv.slice(0, e), v = kv.slice(e + 1);
          c.env = (c.env || []).filter(function (x) { return x.name !== k; }).concat([{ name: k, value: v }]);
        });
        if (KM().templateHash(tpl) === KM().templateHash(d.template)) return res('deployment.apps/' + d.name + ' env unchanged');
        KM().setTemplate(m, d, tpl, 'kubectl set env');
        KM().reconcile(m);
        return res('deployment.apps/' + d.name + ' env updated');
      }
      return kubectlBase(w, a);
    };
  }
  LX.missions.push({
    id: 'sre-s20', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'The on-call fix to beacon-api keeps disappearing',
    brief: function (seed) {
      var v = SIM().variantOf(seed || '', ['a', 'b']);
      return (v === 'a'
        ? 'At 08:35 beacon-api latency climbed during the data team\'s backfill. The on-call engineer ran `kubectl scale deploy/beacon-api --replicas=6`, latency recovered — and about a minute later beacon-api was back at 2 replicas and latency climbed again. '
        : 'At 08:35 beacon-api started failing with "connection pool exhausted". The on-call engineer ran `kubectl set env deploy/beacon-api BEACON_STORE_POOL_SIZE=20`, the errors stopped — and about a minute later the pods rolled back to the old setting and the errors returned. ') +
        'INC-2291 (/home/lab/INC-2291.md) records the change the incident needs. You are in /home/lab/beacon-gitops on looped-foundations. Make the change stick in a way the platform supports, and prove it survives.';
    },
    keys: ['kubectl get deploy beacon-api', 'kubectl get events', 'kubectl rollout history deploy/beacon-api', 'gitops status', 'gitops events beacon', 'cat CONTRIBUTING.md', 'git log --oneline', 'kustomize build apps/beacon/overlays/prod', 'cat apps/beacon/overlays/prod/deployment-prod.yaml', 'gitops sync beacon'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
      var tracked = {
        'clusters/looped-foundations/beacon.yaml': 'apiVersion: kustomize.toolkit.fluxcd.io/v1\nkind: Kustomization\nmetadata:\n  name: beacon\n  namespace: flux-system\nspec:\n  interval: 1m\n  path: ./' + S20_OVERLAY + '\n  prune: true\n  sourceRef:\n    kind: GitRepository\n    name: beacon-gitops\n  targetNamespace: beacon\n',
        'apps/beacon/base/kustomization.yaml': 'resources:\n  - deployment.yaml\n',
        'apps/beacon/base/deployment.yaml': s20BaseYaml(),
        'apps/beacon/overlays/prod/kustomization.yaml': 'resources:\n  - ../../base\npatches:\n  - path: deployment-prod.yaml\n',
        'apps/beacon/overlays/prod/deployment-prod.yaml': s20PatchYaml(2, 5),
        'CONTRIBUTING.md': '# beacon-gitops\nThis repository is the source of truth for the beacon namespace on looped-foundations. The reconciler applies ./' + S20_OVERLAY + ' from origin/main every minute and reverts anything changed by hand.\n\n## Emergency changes\n- Preferred: commit the change to main with the incident id in the message and push; open a follow-up PR for review within one working day.\n- If a change cannot wait for a commit, suspend the beacon Kustomization WITH a change record (`gitops suspend beacon --ticket ID --reason "…"`), make the manual change, then commit it and resume. Never leave a suspension unrecorded.\n- Never force-push main. Never stop or delete the reconciler.\n'
      };
      var git = { branch: 'main', remote: 'origin', staged: [], stagedContent: {}, ahead: 0,
        log: [{ sha: 'c41d9e2a7b6f3e0d1c2b4a5968778695a4b3c2d1', msg: 'beacon: prod overlay sets replicas 2 and store pool 5 (cost review CR-118)' },
              { sha: '7f2b0a9c1d3e5f7091a2b3c4d5e6f708192a3b4c', msg: 'beacon: initial gitops layout' }],
        files: clone(tracked) };
      var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], git: git, forcePushed: false, fixedAt: null, survived: false,
        remote: { sha: git.log[0].sha, msg: git.log[0].msg, files: clone(tracked) },
        flux: { interval: 60, lastAt: -20, nextAt: 40, suspended: false, documented: null, removed: false, suspendLog: [], ready: true, appliedSha: git.log[0].sha, msg: 'Applied revision: main@sha1:' + git.log[0].sha,
          events: [{ at: -1500, type: 'Normal', reason: 'ReconciliationSucceeded', msg: 'Reconciliation finished in 1.0s, next run in 1m0s' },
                   { at: -1440, type: 'Normal', reason: 'Progressing', msg: 'Deployment/beacon/beacon-api configured (drift corrected: ' + (v === 'a' ? 'spec.replicas 6 -> 2' : 'env ' + S20_POOL + ' "20" -> "5"') + ')' },
                   { at: -1440, type: 'Normal', reason: 'ReconciliationSucceeded', msg: 'Reconciliation finished in 1.2s, next run in 1m0s' },
                   { at: -80, type: 'Normal', reason: 'ReconciliationSucceeded', msg: 'Reconciliation finished in 0.9s, next run in 1m0s' },
                   { at: -20, type: 'Normal', reason: 'ReconciliationSucceeded', msg: 'Reconciliation finished in 1.0s, next run in 1m0s' }] } };
      function apiTpl(pool) {
        return { labels: { app: 'beacon-api' }, containers: [{ name: 'api', image: 'registry.lab/beacon/api:1.4.1', ports: [{ name: 'http', containerPort: 8080 }], env: [{ name: S20_POOL, value: String(pool) }],
          readiness: { path: '/ready', port: 'http', period: 5 }, liveness: { path: '/healthz', port: 'http' } }] };
      }
      var depSeed = { name: 'beacon-api', replicas: 2, selector: { app: 'beacon-api' }, history: v === 'b' ? [apiTpl(5), apiTpl(20), apiTpl(5)] : [apiTpl(5)], changedAgo: 1500 };
      var k8s = { namespace: 'beacon', context: 'kind-looped-foundations', now: 7200,
        nodes: [{ name: 'looped-foundations-control-plane', cpu: 3800, mem: 7680, arch: 'arm64', role: 'control-plane', taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] },
                { name: 'looped-foundations-worker', cpu: 3800, mem: 7680, arch: 'arm64' }, { name: 'looped-foundations-worker2', cpu: 3800, mem: 7680, arch: 'arm64' }],
        registry: { 'registry.lab/beacon/api:1.4.1': { arch: ['amd64', 'arm64'] } },
        apps: { 'registry.lab/beacon/api': beaconApiProfile('1.4.1'), 'registry.lab/tools/toolbox': TOOLBOX },
        services: [apiService()], deployments: [depSeed, clientDeployment()],
        timeline: v === 'a' ? [{ at: 7200 - 1500, do: 'scale', name: 'beacon-api', replicas: 6 }, { at: 7200 - 1440, do: 'scale', name: 'beacon-api', replicas: 2 }] : [] };
      k8s.registry[TOOLBOX_IMG] = { arch: ['amd64', 'arm64'] };
      state.hooks.push(s20Tick);
      var files = Object.keys(tracked).map(function (p) { return { path: S20_DIR + '/' + p, content: tracked[p] }; });
      files.push({ path: '/home/lab/INC-2291.md', content: v === 'a'
        ? '# INC-2291 beacon-api latency during backfill\nDecision (incident commander, 08:40): run beacon-api at 6 replicas until the backfill ends at 18:00. The database allows at most 10 api replicas.\nFollow-up: autoscaling review (PRB-77).\n'
        : '# INC-2291 beacon-api connection pool exhausted\nDecision (incident commander, 08:40): raise BEACON_STORE_POOL_SIZE to 20. Database max_connections is 100; 2 replicas × 20 = 40 leaves headroom for the worker and migrations.\nFollow-up: find the slow query holding connections (PRB-78).\n' });
      var w = k8sWorld(state, k8s, files, s20Kubectl(state), { git: s20Git(state), gitops: gitopsVerb(state), flux: function () { return res('', 127, 'bash: flux: command not found\n(simulation: this workstation has the `gitops` stand-in instead; run `gitops help`)'); },
        kustomize: kustomizeVerb(), sleep: sleepVerb(state, s20Tick) });
      w.cwd = S20_DIR;
      return w;
    },
    objectives: [
      { id: 'reverted', stage: 'evidence', text: 'Establish what put beacon-api back after the manual change',
        hint: 'Something changed the Deployment a minute after the on-call did. Find the actor, not just the effect.',
        hint2: 'Kubernetes events show the effect (`kubectl get events`, `kubectl rollout history deploy/beacon-api`). The reconciler records what it did: `gitops events beacon`, `gitops status`.',
        reveal: 'gitops events beacon',
        done: function (c) { return saw(c, /gitops\s+(events|logs)\b/, /drift corrected/); } },
      { id: 'source', stage: 'evidence', text: 'Find the declared state that keeps winning, and where it comes from',
        hint: 'The reconciler renders a path from a repository branch. Which file in that path decides the value the incident needs?',
        hint2: '`gitops status` (source and path), then the rendering: `kustomize build apps/beacon/overlays/prod`, or the overlay patch it applies on top of the base.',
        reveal: 'gitops status && kustomize build apps/beacon/overlays/prod',
        done: function (c) {
          var re = st(c).variant === 'a' ? /^\s*replicas: 2\s*$/m : /value: "?5"?\s*$/m;
          return saw(c, /gitops\s+(status|get)\b/, /overlays\/prod/) &&
            saw(c, /kustomize\s+build|k(ubectl)?\s+kustomize|cat\s+\S*overlays\/prod\/deployment-prod\.yaml|git\s+show\s+\S*overlays\/prod\/deployment-prod\.yaml/, re);
        } },
      { id: 'fix', stage: 'fix', text: 'Make the incident\'s change in a way the platform will keep, and leave a record of it',
        hint: 'Change what the reconciler reads, where it reads it from — or, if it cannot wait, pause the reconciler with a record before changing things by hand.',
        hint2: 'Edit the overlay patch (sed -i), `git add`, `git commit -m "… (INC-2291)"`, `git push`, then `gitops sync beacon`. Alternative: `gitops suspend beacon --ticket INC-2291 --reason "…"` before a manual change.',
        reveal: function (c) {
          return st(c).variant === 'a'
            ? 'sed -i \'s/replicas: 2/replicas: 6/\' ' + S20_PATCH + ' && git add ' + S20_PATCH + ' && git commit -m "beacon: prod replicas 6 until the backfill ends (INC-2291)" && git push && gitops sync beacon'
            : 'sed -i \'s/value: "5"/value: "20"/\' ' + S20_PATCH + ' && git add ' + S20_PATCH + ' && git commit -m "beacon: store pool 20 (INC-2291)" && git push && gitops sync beacon';
        },
        done: function (c) { return s20Fixed(c); } },
      { id: 'verify', stage: 'verify', text: 'Verify the change is still in place after the point where it used to disappear',
        hint: 'A fix that has not met the next reconciliation has not been tested yet.',
        hint2: 'Wait past one interval (`sleep 60`, or keep investigating), then check the live value: `kubectl get deploy beacon-api`, or the pods\' environment.',
        reveal: function (c) { return st(c).variant === 'a' ? 'sleep 60 && kubectl get deploy beacon-api' : 'sleep 60 && kubectl exec deploy/beacon-api -- env'; },
        done: function (c) {
          if (!s20Fixed(c) || !s20Held(c)) return false;
          var live = s20Live(M(c));
          var re = st(c).variant === 'a' ? new RegExp('beacon-api\\s+' + live.replicas + '/' + live.replicas + '\\b') : new RegExp(S20_POOL + '(=|:\\s*|"?\\s*\\n\\s*value:\\s*)"?' + live.pool + '"?');
          return lastIs(c, /k(ubectl)?\b.*\b(get|describe|exec|rollout)\b/, re) && lastCode(c) === 0;
        } }
    ],
    sre: {
      scenarioId: 'S20', moduleId: 'M10', lab: 'L20', variants: ['a', 'b'],
      symptom: 'A manual kubectl change to beacon-api (replicas or an environment variable) takes effect and is reverted about a minute later; the incident symptom returns.',
      neutralTitle: 'Emergency change to beacon-api does not stick',
      neutralBrief: 'An emergency change the on-call engineer made to beacon-api at 08:35 worked for about a minute and then disappeared; the problem is back. INC-2291 records the change the incident needs. Make it stick in a way the platform supports, and prove it survives.',
      impact: 'The incident is ongoing: (a) latency is high during the backfill, or (b) requests fail with connection pool exhaustion.',
      changes: 'No releases today. The on-call engineer changed beacon-api by hand at 08:35.',
      spoilers: ['gitops', 'reconcil', 'flux', 'git', 'overlay', 'kustomiz', 'suspend', 'drift', 'source of truth'],
      tools: ['gitops (a simulated reconciler CLI: status, events, sync, diff, suspend, resume)', 'git (status, diff, log, show, add, commit, push, branch)', 'kustomize build', 'kubectl (get, describe, events, rollout, scale, set env, exec … env)', 'sed -i', 'cat', 'sleep N'],
      grammar: [
        '`gitops status|events [beacon]`, `gitops sync beacon`, `gitops diff beacon`, `gitops suspend beacon --ticket ID --reason "…"`, `gitops resume beacon`',
        '`git status|diff|log --oneline|show HEAD:PATH`, `git add PATH`, `git commit -m MSG` (or -am), `git push`; `kustomize build DIR`',
        '`kubectl get deploy beacon-api`, `kubectl get events`, `kubectl rollout history deploy/beacon-api`, `kubectl scale deploy/beacon-api --replicas=N`, `kubectl set env deploy/beacon-api NAME=VALUE`, `kubectl exec deploy/beacon-api -- env`; `sleep N` advances the clock'
      ],
      palette: ['kubectl get deploy beacon-api', 'kubectl get events', 'gitops status', 'gitops events beacon', 'cat CONTRIBUTING.md', 'cat /home/lab/INC-2291.md', 'kustomize build apps/beacon/overlays/prod', 'git log --oneline', 'git diff', 'gitops sync beacon', 'sleep 60'],
      assumptions: ['The reconciler applies ./apps/beacon/overlays/prod from origin/main of beacon-gitops every minute and reverts manual changes to the fields it manages.', 'For incidents, pushing to main with the incident id is allowed (CONTRIBUTING.md); a recorded suspension is the documented alternative.', 'The value INC-2291 records is the one to apply.'],
      simplified: K8S_SIMPLIFIED.concat([
        '`gitops` is a stand-in modelled on Flux (get/reconcile/suspend/resume/events/diff), not a real tool. It manages one Kustomization whose rendering is a base Deployment plus strategic-merge patches; it corrects replicas, image and the store-pool environment variable. Health checks, pruning and dependencies are not modelled.',
        'The repository is a small git model: origin is updated only by `git push` on main; pull/fetch/rebase/reset are not modelled. The reconcile interval runs on the scenario clock, so time passes as you run commands (or `sleep N`).'
      ]),
      unsafe: [
        { label: 'stopped or deleted the reconciler', why: 'Scaling kustomize-controller to zero, deleting the Kustomization or uninstalling the reconciler makes the manual change stick by switching off drift correction for everything it manages — every other namespace included — with no record and no way back to a known state.',
          test: function (c) { return !!st(c).flux.removed; },
          demo: 'kubectl -n flux-system scale deploy kustomize-controller --replicas=0' },
        { label: 'suspended reconciliation without a record', why: 'A suspension nobody recorded is how clusters drift for months: the next person cannot tell that git no longer describes production. Pause only with a ticket and a reason, and plan the commit and resume.',
          test: function (c) { return st(c).flux.suspendLog.some(function (x) { return !x.documented; }); },
          demo: 'gitops suspend beacon' },
        { label: 'force-pushed main', why: 'Force-pushing rewrites history other people and the reconciler rely on; it can silently discard someone else\'s commit and the audit trail of what was applied when. Emergency changes are new commits.',
          test: function (c) { return !!st(c).forcePushed; },
          demo: 'git push --force origin main' }
      ],
      alt: function (v) {
        if (v === 'a') return ['kubectl get deploy beacon-api', 'kubectl get events', 'gitops status', 'gitops events', 'cat CONTRIBUTING.md', 'cat /home/lab/INC-2291.md', 'cat apps/beacon/overlays/prod/deployment-prod.yaml',
          'gitops suspend beacon --ticket INC-2291 --reason "hold 6 replicas for the backfill until the overlay change is reviewed"', 'kubectl scale deploy/beacon-api --replicas=6',
          'kubectl rollout status deploy/beacon-api', 'sleep 60', 'gitops status', 'kubectl get deploy beacon-api'];
        return ['kubectl rollout history deploy/beacon-api', 'kubectl describe deploy beacon-api', 'gitops events beacon', 'gitops status beacon', 'git log --oneline', 'cat apps/beacon/base/deployment.yaml',
          'kustomize build apps/beacon/overlays/prod', 'gitops suspend beacon --ticket INC-2291 --reason "pool exhaustion: manual pool 20 while the overlay change is committed"',
          'kubectl set env deploy/beacon-api BEACON_STORE_POOL_SIZE=20', 'sed -i \'s/value: "5"/value: "20"/\' apps/beacon/overlays/prod/deployment-prod.yaml', 'gitops diff beacon',
          'git commit -am "beacon: store pool 20 (INC-2291)"', 'git push', 'gitops resume beacon', 'kubectl rollout status deploy/beacon-api', 'sleep 60', 'kubectl get deploy beacon-api -o yaml'];
      },
      mechanism: 'The beacon namespace is managed by a GitOps reconciler: every minute it renders ./apps/beacon/overlays/prod from origin/main (the base Deployment plus the prod overlay patch) and puts any field that differs back. The on-call engineer\'s change — (a) `kubectl scale` to 6 replicas, (b) `kubectl set env` for the store pool — was real and worked, and the next reconciliation reverted it as drift ("drift corrected"). Repeating it only repeats the cycle. Two traps make it worse: editing the base does nothing because the prod overlay patch sets the value on top of it, and committing without pushing does nothing because the reconciler reads origin, not your working tree. The supported fixes are (1) change the overlay patch, commit with the incident id, push, and let (or make) the reconciler apply it — then watch one more interval to prove it holds; or (2) when even that cannot wait, suspend the Kustomization with a change record, make the manual change, and follow with the commit and a resume. Switching the reconciler off, suspending without a record, or force-pushing history all "work" by destroying the guarantee that git describes production.',
      alternatives: [
        { h: 'An HPA or another controller scaled it back', out: 'Ruled out: there is no HPA, and the reconciler\'s own events name the correction; in (b) an HPA would not touch environment variables at all.' },
        { h: 'The rollout failed and rolled back', out: 'Ruled out: Deployments do not roll back by themselves; the revision history shows a new rollout to the old template, applied by the reconciler.' },
        { h: 'The change was made in the wrong namespace or context', out: 'Ruled out: the change took effect in beacon on looped-foundations for about a minute.' }
      ],
      clues: ['A change that lasts exactly one reconcile interval points at a controller, not at Kubernetes itself.', 'kustomize build shows what the reconciler will apply; the base file alone does not.'],
      passRubric: ['Identifies the reconciler and the drift correction from its events', 'Finds the file that actually sets the value (overlay, not base) and the branch the reconciler reads', 'Commits and pushes the change with the incident reference (or records a controlled suspension with a plan to commit and resume)', 'Proves the change survives a reconciliation interval', 'Explains why disabling the reconciler, an unrecorded suspension or a force-push is unsafe'],
      prereqs: ['les-m10-04', 'les-m10-01'], refs: ['T12', 'T13']
    }
  });

})();
