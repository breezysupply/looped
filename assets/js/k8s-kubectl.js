/* kubectl, and a clearly-labelled simulated registry helper, over the model in
   k8s-model.js. Every read is derived from model state; every write goes
   through the controllers before the command returns.

   The command set is bounded on purpose. Anything outside it gets an honest
   "not supported in this simulation" answer naming what is, never a fake
   success. Output layouts follow real kubectl closely enough to practise
   reading, but column widths and some messages are simplified. */
(function (root) {
  'use strict';
  var K = root.LXK8s;
  if (!K) return;

  /* ── argument handling ───────────────────────────────────────── */
  var KIND = {
    po: 'pods', pod: 'pods', pods: 'pods',
    deploy: 'deployments', deployment: 'deployments', deployments: 'deployments',
    rs: 'replicasets', replicaset: 'replicasets', replicasets: 'replicasets',
    svc: 'services', service: 'services', services: 'services',
    ep: 'endpoints', endpoints: 'endpoints',
    endpointslice: 'endpointslices', endpointslices: 'endpointslices',
    'endpointslices.discovery.k8s.io': 'endpointslices',
    ev: 'events', event: 'events', events: 'events',
    no: 'nodes', node: 'nodes', nodes: 'nodes',
    cm: 'configmaps', configmap: 'configmaps', configmaps: 'configmaps',
    secret: 'secrets', secrets: 'secrets',
    pvc: 'pvcs', persistentvolumeclaim: 'pvcs', persistentvolumeclaims: 'pvcs',
    pv: 'pvs', persistentvolume: 'pvs', persistentvolumes: 'pvs',
    sc: 'storageclasses', storageclass: 'storageclasses', storageclasses: 'storageclasses',
    sa: 'serviceaccounts', serviceaccount: 'serviceaccounts', serviceaccounts: 'serviceaccounts',
    role: 'roles', roles: 'roles', rolebinding: 'rolebindings', rolebindings: 'rolebindings',
    clusterrole: 'clusterroles', clusterroles: 'clusterroles',
    clusterrolebinding: 'clusterrolebindings', clusterrolebindings: 'clusterrolebindings',
    ns: 'namespaces', namespace: 'namespaces', namespaces: 'namespaces', all: 'all'
  };
  var RESOURCE = { pods: 'pods', deployments: 'deployments', replicasets: 'replicasets', services: 'services',
    endpoints: 'endpoints', endpointslices: 'endpointslices', events: 'events', nodes: 'nodes',
    configmaps: 'configmaps', secrets: 'secrets', pvcs: 'persistentvolumeclaims', pvs: 'persistentvolumes',
    storageclasses: 'storageclasses', serviceaccounts: 'serviceaccounts', roles: 'roles',
    rolebindings: 'rolebindings', clusterroles: 'clusterroles', clusterrolebindings: 'clusterrolebindings',
    namespaces: 'namespaces' };
  var CLUSTER_SCOPED = ['nodes', 'pvs', 'storageclasses', 'clusterroles', 'clusterrolebindings', 'namespaces'];
  var VALUED = ['-n', '--namespace', '-o', '--output', '-l', '--selector', '-c', '--container', '--as',
    '--tail', '--replicas', '--to-revision', '--type', '-p', '--patch', '-f', '--filename', '--role',
    '--clusterrole', '--serviceaccount', '--user', '--limits', '--requests', '--timeout', '--context',
    '--since', '--sort-by', '--field-selector', '--from-literal', '--image', '--grace-period', '--cluster'];

  function parse(a) {
    var o = { pos: [], f: {}, multi: {} };
    var stop = a.indexOf('--');
    var head = stop === -1 ? a : a.slice(0, stop);
    o.after = stop === -1 ? [] : a.slice(stop + 1);
    for (var i = 0; i < head.length; i++) {
      var t = head[i];
      if (t.indexOf('--') === 0 && t.indexOf('=') > 0) {
        var k = t.slice(0, t.indexOf('=')), v = t.slice(t.indexOf('=') + 1);
        setF(o, k, v); continue;
      }
      if (VALUED.indexOf(t) !== -1) { setF(o, t, head[i + 1]); i++; continue; }
      if (t.charAt(0) === '-' && t.length > 1) { setF(o, t, true); continue; }
      o.pos.push(t);
    }
    return o;
  }
  function setF(o, k, v) {
    var alias = { '-n': '--namespace', '-o': '--output', '-l': '--selector', '-c': '--container',
                  '-f': '--filename', '-A': '--all-namespaces', '-w': '--watch' };
    k = alias[k] || k;
    if (k === '--from-literal') { (o.multi[k] = o.multi[k] || []).push(v); }
    o.f[k] = v;
  }
  /* "pod/name", "pods name" and "deploy name" all work */
  function target(o, startAt) {
    var p = o.pos.slice(startAt);
    if (!p.length) return { kind: null, name: null, rest: [] };
    if (p[0].indexOf('/') > 0) {
      var s = p[0].split('/');
      return { kind: KIND[s[0].toLowerCase()] || null, rawKind: s[0], name: s[1], rest: p.slice(1) };
    }
    return { kind: KIND[p[0].toLowerCase()] || null, rawKind: p[0], name: p[1] || null, rest: p.slice(2) };
  }

  /* ── output helpers ──────────────────────────────────────────── */
  function ok(out) { return { out: out, code: 0 }; }
  function fail(msg, code) { return { out: '', err: msg.replace(/\n?$/, '\n'), code: code == null ? 1 : code }; }
  function table(head, rows) {
    var w = head.map(function (h, i) {
      return rows.reduce(function (a, r) { return Math.max(a, String(r[i]).length); }, h.length);
    });
    function line(r) {
      return r.map(function (c, i) { return i === r.length - 1 ? String(c) : pad(String(c), w[i] + 3); }).join('').replace(/\s+$/, '');
    }
    return [line(head)].concat(rows.map(line)).join('\n') + '\n';
  }
  function pad(s, n) { while (s.length < n) s += ' '; return s; }
  function ageOf(m, created) { return K.age(m.clock - (created || 0)); }
  function labelStr(l) {
    var k = Object.keys(l || {});
    return k.length ? k.map(function (x) { return x + '=' + l[x]; }).join(',') : '<none>';
  }
  function none(ns, all) {
    return ok('No resources found' + (all ? '' : ' in ' + ns + ' namespace') + '.\n');
  }

  /* ── pod presentation ────────────────────────────────────────── */
  function podStatus(p) {
    if (p.fixedStatus) return p.fixedStatus.status || p.phase;
    if (!p.node) return 'Pending';
    for (var i = 0; i < p.init.length; i++) {
      var ic = p.init[i];
      if (!ic.done) {
        if (ic.state === 'waiting' && ic.reason && ic.reason !== 'ContainerCreating') return 'Init:' + ic.reason;
        return 'Init:' + i + '/' + p.init.length;
      }
    }
    var waiting = p.containers.filter(function (c) { return c.state === 'waiting'; })[0];
    if (waiting) return waiting.reason || 'ContainerCreating';
    return p.phase;
  }
  function readyStr(p) {
    var n = p.containers.length;
    return p.containers.filter(function (c) { return c.state === 'running' && c.ready; }).length + '/' + n;
  }
  function restartStr(m, p) {
    var r = p.containers.reduce(function (a, c) { return a + c.restarts; }, 0);
    var last = p.containers.reduce(function (a, c) { return c.lastState ? Math.max(a, c.lastState.finished) : a; }, -1);
    return r && last >= 0 ? r + ' (' + K.age(m.clock - last) + ' ago)' : String(r);
  }
  function podsIn(m, ns, sel) {
    return m.pods.filter(function (p) {
      return (ns === null || p.ns === ns) && (!sel || K.matches(sel, p.labels));
    });
  }
  function parseSel(str) {
    var out = {};
    String(str || '').split(',').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) out[kv.slice(0, i).replace(/=$/, '').trim()] = kv.slice(i + 1).replace(/^=/, '').trim();
    });
    return out;
  }

  /* ── object views (for -o yaml/json and jsonpath) ────────────── */
  function meta(m, o, extra) {
    var md = { name: o.name };
    if (o.ns) md.namespace = o.ns;
    if (o.labels && Object.keys(o.labels).length) md.labels = o.labels;
    if (extra) Object.keys(extra).forEach(function (k) { md[k] = extra[k]; });
    return md;
  }
  function containerView(c) {
    var v = { name: c.name, image: c.image };
    if (c.ports) v.ports = c.ports.map(function (p) { var x = { containerPort: p.containerPort }; if (p.name) x.name = p.name; return x; });
    if (c.env) v.env = c.env.map(function (e) {
      if (e.value != null) return { name: e.name, value: e.value };
      var r = e.configMapKey || e.secretKey, key = e.configMapKey ? 'configMapKeyRef' : 'secretKeyRef', vf = {};
      vf[key] = { name: r.name, key: r.key }; return { name: e.name, valueFrom: vf };
    });
    if (c.envFrom) v.envFrom = c.envFrom.map(function (f) {
      return f.configMapRef ? { configMapRef: { name: f.configMapRef } } : { secretRef: { name: f.secretRef } };
    });
    if (c.resources) v.resources = c.resources;
    if (c.readiness) v.readinessProbe = probeView(c.readiness);
    if (c.liveness) v.livenessProbe = probeView(c.liveness);
    return v;
  }
  function probeView(p) {
    var v = { httpGet: { path: p.path || '/', port: p.port } };
    if (p.initialDelay != null) v.initialDelaySeconds = p.initialDelay;
    v.periodSeconds = p.period || 10; v.failureThreshold = p.failureThreshold || 3;
    return v;
  }
  function specView(t) {
    var s = { containers: (t.containers || []).map(containerView) };
    if (t.initContainers) s.initContainers = t.initContainers.map(containerView);
    if (t.serviceAccount) s.serviceAccountName = t.serviceAccount;
    if (t.nodeSelector) s.nodeSelector = t.nodeSelector;
    if (t.tolerations) s.tolerations = t.tolerations;
    if (t.imagePullSecrets) s.imagePullSecrets = t.imagePullSecrets.map(function (n) { return { name: n }; });
    if (t.volumes) s.volumes = t.volumes.map(function (v) {
      return v.pvc ? { name: v.name, persistentVolumeClaim: { claimName: v.pvc } } : { name: v.name, configMap: { name: v.configMap } };
    });
    return s;
  }
  function view(m, kind, o) {
    switch (kind) {
      case 'pods': return { apiVersion: 'v1', kind: 'Pod', metadata: meta(m, o, o.owner ? { ownerReferences: [{ kind: 'ReplicaSet', name: o.owner, controller: true }] } : null),
        spec: Object.assign(specView(o.spec), { nodeName: o.node || undefined }),
        status: { phase: o.phase, podIP: o.ip || undefined, containerStatuses: o.containers.map(function (c) {
          var st = {}; st[c.state] = c.state === 'waiting' ? { reason: c.reason } : { startedAt: 't+' + c.startedAt + 's' };
          var v = { name: c.name, image: c.image, ready: !!c.ready, restartCount: c.restarts, state: st };
          if (c.lastState) v.lastState = { terminated: { reason: c.lastState.reason, exitCode: c.lastState.exitCode } };
          return v; }) } };
      case 'deployments': return { apiVersion: 'apps/v1', kind: 'Deployment', metadata: meta(m, o, { generation: K.rsFor(m, o).length }),
        spec: { replicas: o.replicas, selector: { matchLabels: o.selector },
          strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: o.strategy.maxSurge, maxUnavailable: o.strategy.maxUnavailable } },
          template: { metadata: { labels: o.template.labels }, spec: specView(o.template) } },
        status: deployStatus(m, o) };
      case 'services': return { apiVersion: 'v1', kind: 'Service', metadata: meta(m, o),
        spec: { type: o.type || 'ClusterIP', clusterIP: o.clusterIP, selector: o.selector, ports: o.ports } };
      case 'configmaps': return { apiVersion: 'v1', kind: 'ConfigMap', metadata: meta(m, o), data: o.data || {} };
      case 'secrets': {
        var d = {};
        Object.keys(o.data || {}).forEach(function (k) { d[k] = b64(o.data[k]); });
        return { apiVersion: 'v1', kind: 'Secret', type: o.type || 'Opaque', metadata: meta(m, o), data: d };
      }
      case 'pvcs': return { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: meta(m, o),
        spec: { accessModes: o.accessModes || ['ReadWriteOnce'], storageClassName: o.storageClassName || undefined,
                resources: { requests: { storage: o.request || '1Gi' } }, volumeName: o.volume || undefined },
        status: { phase: o.phase } };
      case 'serviceaccounts': return { apiVersion: 'v1', kind: 'ServiceAccount', metadata: meta(m, o),
        imagePullSecrets: (o.imagePullSecrets || []).map(function (n) { return { name: n }; }) };
      case 'roles': case 'clusterroles': return { apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: kind === 'roles' ? 'Role' : 'ClusterRole', metadata: meta(m, o), rules: o.rules };
      case 'rolebindings': case 'clusterrolebindings': return { apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: kind === 'rolebindings' ? 'RoleBinding' : 'ClusterRoleBinding', metadata: meta(m, o),
        roleRef: Object.assign({ apiGroup: 'rbac.authorization.k8s.io' }, o.roleRef), subjects: o.subjects };
      case 'nodes': return { apiVersion: 'v1', kind: 'Node', metadata: { name: o.name, labels: o.labels },
        spec: { taints: o.taints.length ? o.taints : undefined, unschedulable: o.unschedulable || undefined },
        status: { allocatable: { cpu: o.cpu + 'm', memory: o.mem + 'Mi' }, nodeInfo: { architecture: o.arch } } };
      case 'replicasets': return { apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: meta(m, o, { annotations: { 'deployment.kubernetes.io/revision': String(o.revision) } }),
        spec: { replicas: o.replicas, template: { metadata: { labels: o.template.labels }, spec: specView(o.template) } } };
      case 'storageclasses': return { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name: o.name },
        provisioner: o.provisioner, volumeBindingMode: o.bindingMode || 'Immediate', reclaimPolicy: o.reclaimPolicy || 'Delete' };
      default: return { name: o.name };
    }
  }
  function deployStatus(m, d) {
    var rs = K.rsFor(m, d), h = K.templateHash(d.template);
    var pods = [];
    rs.forEach(function (r) { pods = pods.concat(K.podsOf(m, r)); });
    var cur = rs.filter(function (r) { return r.hash === h; })[0];
    return { replicas: pods.length, updatedReplicas: cur ? K.podsOf(m, cur).length : 0,
             readyReplicas: pods.filter(K.podReady).length, availableReplicas: pods.filter(K.podReady).length,
             conditions: [{ type: 'Available', status: d.conditions.Available },
                          { type: 'Progressing', status: d.conditions.Progressing === 'ProgressDeadlineExceeded' ? 'False' : 'True',
                            reason: d.conditions.Progressing }] };
  }
  /* base64 of printable ASCII, written out so this file has no dependency */
  function b64(s) {
    var c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', o = '', i = 0;
    s = String(s);
    while (i < s.length) {
      var a = s.charCodeAt(i++), b = s.charCodeAt(i++), d = s.charCodeAt(i++);
      var n = (a << 16) | ((b || 0) << 8) | (d || 0);
      o += c.charAt((n >> 18) & 63) + c.charAt((n >> 12) & 63) +
           (isNaN(b) ? '=' : c.charAt((n >> 6) & 63)) + (isNaN(d) ? '=' : c.charAt(n & 63));
    }
    return o;
  }
  function yaml(v, ind) {
    ind = ind || '';
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return '\n' + v.map(function (x) {
        if (x && typeof x === 'object' && !Array.isArray(x)) {
          var body = yaml(x, ind + '  ').replace(/^\n/, '');
          return ind + '- ' + body.replace(new RegExp('^' + ind + '  '), '');
        }
        return ind + '- ' + scalar(x);
      }).join('\n');
    }
    if (typeof v === 'object') {
      var keys = Object.keys(v).filter(function (k) { return v[k] !== undefined; });
      if (!keys.length) return '{}';
      return '\n' + keys.map(function (k) {
        var x = v[k];
        if (x && typeof x === 'object') {
          var inner = yaml(x, ind + '  ');
          if (Array.isArray(x) && x.length) inner = yaml(x, ind);
          return ind + k + ':' + (inner.charAt(0) === '\n' ? inner : ' ' + inner);
        }
        return ind + k + ': ' + scalar(x);
      }).join('\n');
    }
    return scalar(v);
  }
  function scalar(x) {
    if (typeof x === 'number' || typeof x === 'boolean') return String(x);
    var s = String(x);
    return /^[A-Za-z0-9_./@:+-][A-Za-z0-9_./@:+ -]*$/.test(s) && !/^(true|false|null|\d+)$/.test(s) && !/:\s/.test(s) ? s : JSON.stringify(s);
  }
  function jsonpath(obj, expr) {
    var e = String(expr || '').replace(/^\{|\}$/g, '').trim();
    if (/range|\?\(|@\./.test(e)) return { err: 'error: this simulation supports simple jsonpath like {.spec.selector} or {.items[*].metadata.name}; range and filter expressions are not implemented' };
    var parts = e.replace(/^\./, '').split('.').filter(Boolean);
    var cur = [obj];
    for (var i = 0; i < parts.length; i++) {
      var mm = /^([^[]+)(\[(\*|\d+)\])?$/.exec(parts[i]);
      if (!mm) return { err: 'error: error parsing jsonpath ' + expr };
      var next = [];
      cur.forEach(function (c) {
        if (c == null) return;
        var v = c[mm[1]];
        if (mm[3] === '*' && Array.isArray(v)) next = next.concat(v);
        else if (mm[3] != null && Array.isArray(v)) next.push(v[Number(mm[3])]);
        else next.push(v);
      });
      cur = next;
    }
    return { out: cur.filter(function (x) { return x !== undefined; }).map(function (x) {
      return typeof x === 'object' ? JSON.stringify(x) : String(x); }).join(' ') };
  }
  function emit(m, kind, list, o, single) {
    var fmt = o.f['--output'];
    if (fmt === 'yaml' || fmt === 'json' || (fmt && fmt.indexOf('jsonpath') === 0)) {
      var views = list.map(function (x) { return view(m, kind, x); });
      var doc = single ? views[0] : { apiVersion: 'v1', kind: 'List', items: views };
      if (fmt === 'json') return ok(JSON.stringify(doc, null, 2) + '\n');
      if (fmt === 'yaml') return ok(yaml(doc).replace(/^\n/, '') + '\n');
      var jp = jsonpath(doc, fmt.slice(fmt.indexOf('=') + 1).replace(/^'|'$/g, ''));
      return jp.err ? fail(jp.err) : ok(jp.out + '\n');
    }
    return null;
  }

  /* ── get ─────────────────────────────────────────────────────── */
  function nsFor(m, o) {
    if (o.f['--all-namespaces']) return null;
    return o.f['--namespace'] || m.ns;
  }
  function namesOrAll(m, kind, list, name, ns) {
    if (!name) return list;
    var hit = list.filter(function (x) { return x.name === name; });
    return hit;
  }
  function notFound(kind, name) {
    var singular = { pods: 'pods', deployments: 'deployments.apps', services: 'services', configmaps: 'configmaps',
      secrets: 'secrets', pvcs: 'persistentvolumeclaims', serviceaccounts: 'serviceaccounts', replicasets: 'replicasets.apps',
      roles: 'roles.rbac.authorization.k8s.io', rolebindings: 'rolebindings.rbac.authorization.k8s.io', nodes: 'nodes',
      storageclasses: 'storageclasses.storage.k8s.io', pvs: 'persistentvolumes', clusterroles: 'clusterroles.rbac.authorization.k8s.io',
      clusterrolebindings: 'clusterrolebindings.rbac.authorization.k8s.io', endpoints: 'endpoints' };
    return fail('Error from server (NotFound): ' + (singular[kind] || kind) + ' "' + name + '" not found');
  }

  function get(m, o, as) {
    var t = target(o, 1), ns = nsFor(m, o), all = ns === null;
    if (!t.kind) {
      if (!t.rawKind) return fail('You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.');
      return fail('error: the server doesn\'t have a resource type "' + t.rawKind + '"');
    }
    var denied = rbac(m, as, t.name ? 'get' : 'list', t.kind, ns);
    if (denied) return denied;
    if (o.f['--watch']) {
      var once = get(m, Object.assign({}, o, { f: Object.assign({}, o.f, { '--watch': undefined }) }), as);
      return ok((once.out || '') + '(simulation: -w/--watch is not streamed here; this is one snapshot. Re-run the command to see later state.)\n');
    }
    var sel = o.f['--selector'] ? parseSel(o.f['--selector']) : null;
    var inNs = function (x) { return CLUSTER_SCOPED.indexOf(t.kind) !== -1 || all || x.ns === ns; };
    var list, rows, head;
    switch (t.kind) {
      case 'all': {
        var out = '';
        ['pods', 'services', 'deployments', 'replicasets'].forEach(function (k) {
          var r = get(m, { pos: ['get', k], f: { '--namespace': o.f['--namespace'], '--all-namespaces': o.f['--all-namespaces'] }, multi: {} }, as);
          if (r.code === 0 && !/^No resources/.test(r.out)) {
            out += r.out.replace(/^NAME/, 'NAME').split('\n').map(function (l, i) {
              if (i === 0 || !l) return l;
              var pre = { pods: 'pod/', services: 'service/', deployments: 'deployment.apps/', replicasets: 'replicaset.apps/' }[k];
              return pre + l;
            }).join('\n') + '\n';
          }
        });
        return ok(out || 'No resources found in ' + ns + ' namespace.\n');
      }
      case 'pods': {
        list = namesOrAll(m, 'pods', podsIn(m, ns, sel), t.name);
        if (t.name && !list.length) return notFound('pods', t.name);
        var e = emit(m, 'pods', list, o, !!t.name); if (e) return e;
        if (!list.length) return none(ns, all);
        var wide = o.f['--output'] === 'wide', lab = o.f['--show-labels'];
        head = (all ? ['NAMESPACE'] : []).concat(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'])
          .concat(wide ? ['IP', 'NODE', 'NOMINATED NODE', 'READINESS GATES'] : []).concat(lab ? ['LABELS'] : []);
        rows = list.map(function (p) {
          return (all ? [p.ns] : []).concat([p.name, readyStr(p), podStatus(p), restartStr(m, p), ageOf(m, p.created)])
            .concat(wide ? [p.ip || '<none>', p.node || '<none>', '<none>', '<none>'] : []).concat(lab ? [labelStr(p.labels)] : []);
        });
        return ok(table(head, rows));
      }
      case 'deployments': {
        list = namesOrAll(m, 'deployments', m.deployments.filter(function (d) { return !d.gone && inNs(d) && (!sel || K.matches(sel, d.template.labels)); }), t.name);
        if (t.name && !list.length) return notFound('deployments', t.name);
        var e2 = emit(m, 'deployments', list, o, !!t.name); if (e2) return e2;
        if (!list.length) return none(ns, all);
        head = ['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE'];
        if (o.f['--output'] === 'wide') head = head.concat(['CONTAINERS', 'IMAGES', 'SELECTOR']);
        rows = list.map(function (d) {
          var s = deployStatus(m, d);
          var r = [d.name, s.readyReplicas + '/' + d.replicas, s.updatedReplicas, s.availableReplicas, ageOf(m, d.created)];
          if (o.f['--output'] === 'wide') r = r.concat([d.template.containers.map(function (c) { return c.name; }).join(','),
            d.template.containers.map(function (c) { return c.image; }).join(','), labelStr(d.selector)]);
          return r;
        });
        return ok(table(head, rows));
      }
      case 'replicasets': {
        list = namesOrAll(m, 'replicasets', m.replicasets.filter(inNs), t.name);
        if (t.name && !list.length) return notFound('replicasets', t.name);
        var e3 = emit(m, 'replicasets', list, o, !!t.name); if (e3) return e3;
        if (!list.length) return none(ns, all);
        rows = list.map(function (r) {
          var pods = K.podsOf(m, r);
          return [r.name, r.replicas, pods.length, pods.filter(K.podReady).length, ageOf(m, r.created)];
        });
        return ok(table(['NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE'], rows));
      }
      case 'services': {
        list = namesOrAll(m, 'services', m.services.filter(function (s) { return !s.gone && inNs(s); }), t.name);
        if (t.name && !list.length) return notFound('services', t.name);
        var e4 = emit(m, 'services', list, o, !!t.name); if (e4) return e4;
        if (!list.length) return none(ns, all);
        rows = list.map(function (s) {
          var type = s.type || 'ClusterIP';
          var ext = type === 'LoadBalancer' ? (s.externalIP || '<pending>') : '<none>';
          var ports = (s.ports || []).map(function (p) {
            return p.port + (type === 'NodePort' || type === 'LoadBalancer' ? ':' + (p.nodePort || 30080) : '') + '/' + (p.protocol || 'TCP');
          }).join(',');
          return [s.name, type, s.clusterIP || 'None', ext, ports, ageOf(m, s.created)];
        });
        return ok(table(['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE'], rows));
      }
      case 'endpoints': {
        list = namesOrAll(m, 'services', m.services.filter(function (s) { return !s.gone && inNs(s); }), t.name);
        if (t.name && !list.length) return notFound('endpoints', t.name);
        if (!list.length) return none(ns, all);
        rows = list.map(function (s) {
          var ep = K.endpoints(m, s);
          var addrs = ep.ready.map(function (p) { return p.ip + ':' + ep.port; });
          return [s.name, addrs.length ? (addrs.length > 3 ? addrs.slice(0, 3).join(',') + ' + ' + (addrs.length - 3) + ' more...' : addrs.join(',')) : '<none>', ageOf(m, s.created)];
        });
        return ok(table(['NAME', 'ENDPOINTS', 'AGE'], rows) +
          'Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice\n');
      }
      case 'endpointslices': {
        var svcName = sel && sel['kubernetes.io/service-name'];
        list = m.services.filter(function (s) { return !s.gone && inNs(s) && (!svcName || s.name === svcName); });
        if (!list.length) return none(ns, all);
        if (o.f['--output'] === 'yaml' || o.f['--output'] === 'json') {
          var docs = list.map(function (s) {
            var ep = K.endpoints(m, s);
            return { apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice',
              metadata: { name: s.name + '-' + K.hashOf(s.name).slice(0, 5), namespace: s.ns, labels: { 'kubernetes.io/service-name': s.name } },
              addressType: 'IPv4', ports: [{ port: ep.port, protocol: 'TCP' }],
              endpoints: ep.ready.map(function (p) { return { addresses: [p.ip], conditions: { ready: true }, targetRef: { kind: 'Pod', name: p.name } }; })
                .concat(ep.notReady.filter(function (p) { return p.ip; }).map(function (p) { return { addresses: [p.ip], conditions: { ready: false }, targetRef: { kind: 'Pod', name: p.name } }; })) };
          });
          var one = docs.length === 1 ? docs[0] : { apiVersion: 'v1', kind: 'List', items: docs };
          return ok(o.f['--output'] === 'json' ? JSON.stringify(one, null, 2) + '\n' : yaml(one).replace(/^\n/, '') + '\n');
        }
        rows = list.map(function (s) {
          var ep = K.endpoints(m, s), ips = ep.ready.map(function (p) { return p.ip; });
          return [s.name + '-' + K.hashOf(s.name).slice(0, 5), 'IPv4', ep.port == null ? '<unset>' : ep.port,
                  ips.length ? ips.join(',') : '<unset>', ageOf(m, s.created)];
        });
        return ok(table(['NAME', 'ADDRESSTYPE', 'PORTS', 'ENDPOINTS', 'AGE'], rows));
      }
      case 'events': {
        var evs = m.events.filter(function (e) { return all || e.ns === ns; });
        if (o.f['--field-selector']) {
          var fsel = parseSel(o.f['--field-selector']);
          evs = evs.filter(function (e) {
            return (!fsel['involvedObject.name'] || e.name === fsel['involvedObject.name']) &&
                   (!fsel.type || e.type === fsel.type) && (!fsel.reason || e.reason === fsel.reason);
          });
        }
        evs = evs.slice().sort(function (a, b) { return a.last - b.last; }).slice(-30);
        if (!evs.length) return none(ns, all);
        rows = evs.map(function (e) {
          return (all ? [e.ns] : []).concat([K.age(m.clock - e.last), e.type, e.reason, e.kind.toLowerCase() + '/' + e.name,
            e.msg + (e.count > 1 ? ' (x' + e.count + ')' : '')]);
        });
        return ok(table((all ? ['NAMESPACE'] : []).concat(['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE']), rows));
      }
      case 'nodes': {
        list = namesOrAll(m, 'nodes', m.nodes, t.name);
        if (t.name && !list.length) return notFound('nodes', t.name);
        var e5 = emit(m, 'nodes', list, o, !!t.name); if (e5) return e5;
        rows = list.map(function (n) {
          var st = n.ready ? 'Ready' : 'NotReady';
          if (n.unschedulable) st += ',SchedulingDisabled';
          return [n.name, st, n.role, ageOf(m, n.created), 'v1.33.0'].concat(o.f['--show-labels'] ? [labelStr(n.labels)] : []);
        });
        return ok(table(['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION'].concat(o.f['--show-labels'] ? ['LABELS'] : []), rows));
      }
      case 'configmaps': case 'secrets': case 'serviceaccounts': case 'roles': case 'rolebindings':
      case 'clusterroles': case 'clusterrolebindings': case 'storageclasses': case 'pvs': case 'pvcs': {
        list = namesOrAll(m, t.kind, m[t.kind].filter(function (x) { return !x.gone && inNs(x); }), t.name);
        if (t.name && !list.length) return notFound(t.kind, t.name);
        var e6 = emit(m, t.kind, list, o, !!t.name); if (e6) return e6;
        if (!list.length) return none(ns, all);
        if (t.kind === 'configmaps') { head = ['NAME', 'DATA', 'AGE']; rows = list.map(function (x) { return [x.name, Object.keys(x.data || {}).length, ageOf(m, x.created)]; }); }
        if (t.kind === 'secrets') { head = ['NAME', 'TYPE', 'DATA', 'AGE']; rows = list.map(function (x) { return [x.name, x.type || 'Opaque', Object.keys(x.data || {}).length, ageOf(m, x.created)]; }); }
        if (t.kind === 'serviceaccounts') { head = ['NAME', 'SECRETS', 'AGE']; rows = list.map(function (x) { return [x.name, 0, ageOf(m, x.created)]; }); }
        if (t.kind === 'roles' || t.kind === 'clusterroles') { head = ['NAME', 'CREATED AT']; rows = list.map(function (x) { return [x.name, 't-' + ageOf(m, x.created)]; }); }
        if (t.kind === 'rolebindings' || t.kind === 'clusterrolebindings') {
          head = ['NAME', 'ROLE', 'AGE']; rows = list.map(function (x) { return [x.name, x.roleRef.kind + '/' + x.roleRef.name, ageOf(m, x.created)]; });
        }
        if (t.kind === 'storageclasses') {
          head = ['NAME', 'PROVISIONER', 'RECLAIMPOLICY', 'VOLUMEBINDINGMODE', 'ALLOWVOLUMEEXPANSION', 'AGE'];
          rows = list.map(function (x) { return [x.name + (x.default ? ' (default)' : ''), x.provisioner, x.reclaimPolicy || 'Delete', x.bindingMode || 'Immediate', 'false', ageOf(m, x.created)]; });
        }
        if (t.kind === 'pvcs') {
          head = ['NAME', 'STATUS', 'VOLUME', 'CAPACITY', 'ACCESS MODES', 'STORAGECLASS', 'AGE'];
          rows = list.map(function (x) { return [x.name, x.phase, x.volume || '', x.phase === 'Bound' ? (x.request || '1Gi') : '', x.phase === 'Bound' ? 'RWO' : '', x.storageClassName || '<unset>', ageOf(m, x.created)]; });
        }
        if (t.kind === 'pvs') {
          head = ['NAME', 'CAPACITY', 'ACCESS MODES', 'RECLAIM POLICY', 'STATUS', 'CLAIM', 'STORAGECLASS', 'AGE'];
          rows = list.map(function (x) { return [x.name, x.capacity, 'RWO', x.reclaimPolicy, x.phase, x.claim, x.storageClassName, ageOf(m, x.created)]; });
        }
        return ok(table(head, rows));
      }
      case 'namespaces':
        return ok(table(['NAME', 'STATUS', 'AGE'], [['default', 'Active', '90d'], ['kube-system', 'Active', '90d'], [m.ns, 'Active', '62d']]));
    }
    return fail('error: "' + t.rawKind + '" is recognised but not listable in this simulation');
  }

  /* ── describe ────────────────────────────────────────────────── */
  function eventsFor(m, kind, name, ns) {
    var ev = m.events.filter(function (e) { return e.kind === kind && e.name === name && (!ns || e.ns === ns); })
      .sort(function (a, b) { return a.last - b.last; }).slice(-10);
    if (!ev.length) return 'Events:            <none>\n';
    return 'Events:\n' + table(['  Type', 'Reason', 'Age', 'From', 'Message'], ev.map(function (e) {
      var a = e.count > 1 ? K.age(m.clock - e.last) + ' (x' + e.count + ' over ' + K.age(m.clock - e.first) + ')' : K.age(m.clock - e.last);
      return ['  ' + e.type, e.reason, a, e.from, e.msg];
    })).replace(/^/gm, '');
  }
  function resStr(r) {
    if (!r) return '';
    var out = '';
    if (r.limits) out += '    Limits:\n' + Object.keys(r.limits).map(function (k) { return '      ' + k + ':  ' + r.limits[k] + '\n'; }).join('');
    if (r.requests) out += '    Requests:\n' + Object.keys(r.requests).map(function (k) { return '      ' + k + ':  ' + r.requests[k] + '\n'; }).join('');
    return out;
  }
  function probeStr(label, p, prof) {
    if (!p) return '';
    return '    ' + label + ':  http-get http://:' + (p.port == null ? prof.port : p.port) + (p.path || '/') +
      ' delay=' + (p.initialDelay || 0) + 's timeout=1s period=' + (p.period || 10) + 's #success=1 #failure=' + (p.failureThreshold || 3) + '\n';
  }
  function describePod(m, p) {
    var s = 'Name:             ' + p.name + '\nNamespace:        ' + p.ns + '\nNode:             ' +
      (p.node ? p.node + '/' + (K.find(m, 'nodes', p.node) ? '10.0.0.' + (m.nodes.indexOf(K.find(m, 'nodes', p.node)) + 11) : '') : '<none>') +
      '\nLabels:           ' + labelStr(p.labels).split(',').join('\n                  ') +
      '\nStatus:           ' + (p.fixedStatus ? p.fixedStatus.phase : p.phase) + '\nIP:               ' + (p.ip || '') +
      '\nService Account:  ' + p.serviceAccount +
      '\nControlled By:    ' + (p.owner ? 'ReplicaSet/' + p.owner : '<none>') + '\n';
    function cont(c, spec) {
      var prof = K.profileFor(m, c.image);
      var st;
      if (c.state === 'running') st = '    State:          Running\n      Started:      ' + K.age(m.clock - c.startedAt) + ' ago\n';
      else if (c.state === 'terminated') st = '    State:          Terminated\n      Reason:       ' + c.reason + '\n      Exit Code:    0\n';
      else st = '    State:          Waiting\n      Reason:       ' + (c.reason || 'ContainerCreating') + '\n' +
        (c.reason === 'CreateContainerConfigError' ? '      Message:      ' + c.configMsg + '\n' : '');
      var last = c.lastState ? '    Last State:     Terminated\n      Reason:       ' + c.lastState.reason +
        '\n      Exit Code:    ' + c.lastState.exitCode + '\n      Started:      ' + K.age(m.clock - c.lastState.started) +
        ' ago\n      Finished:     ' + K.age(m.clock - c.lastState.finished) + ' ago\n' : '';
      var env = (spec.envFrom || []).map(function (f) {
        return '      ' + (f.configMapRef || f.secretRef) + '  ' + (f.configMapRef ? 'ConfigMap' : 'Secret') + '  Optional: ' + !!f.optional + '\n';
      }).join('');
      var envv = (spec.env || []).map(function (e) {
        if (e.value != null) return '      ' + e.name + ':  ' + e.value + '\n';
        var r = e.configMapKey || e.secretKey;
        return '      ' + e.name + ':  <set to the key \'' + r.key + '\' of ' + (e.configMapKey ? 'config map' : 'secret') + " '" + r.name + "'>  Optional: " + !!r.optional + '\n';
      }).join('');
      return '  ' + c.name + ':\n    Image:          ' + c.image + '\n' +
        ((spec.ports || []).length ? '    Port:           ' + spec.ports.map(function (x) { return x.containerPort + '/TCP' + (x.name ? ' (' + x.name + ')' : ''); }).join(', ') + '\n' : '') +
        st + last + '    Ready:          ' + (c.state === 'running' && c.ready ? 'True' : 'False') + '\n    Restart Count:  ' + c.restarts + '\n' +
        resStr(spec.resources) + probeStr('Liveness', spec.liveness, prof) + probeStr('Readiness', spec.readiness, prof) +
        (env ? '    Environment Variables from:\n' + env : '') + (envv ? '    Environment:\n' + envv : '    Environment:    <none>\n');
    }
    if (p.init.length) s += 'Init Containers:\n' + p.init.map(function (c, i) { return cont(c, p.spec.initContainers[i]); }).join('');
    s += 'Containers:\n' + p.containers.map(function (c, i) { return cont(c, p.spec.containers[i]); }).join('');
    var ready = K.podReady(p);
    s += 'Conditions:\n  Type                        Status\n  PodScheduled                ' + (p.node ? 'True' : 'False') +
      '\n  Initialized                 ' + (p.init.every(function (c) { return c.done; }) ? 'True' : 'False') +
      '\n  Ready                       ' + (ready ? 'True' : 'False') + '\n  ContainersReady             ' + (ready ? 'True' : 'False') + '\n';
    if ((p.spec.volumes || []).length) {
      s += 'Volumes:\n' + p.spec.volumes.map(function (v) {
        return '  ' + v.name + ':\n' + (v.pvc ? '    Type:       PersistentVolumeClaim\n    ClaimName:  ' + v.pvc + '\n' : '    Type:       ConfigMap\n    Name:       ' + v.configMap + '\n');
      }).join('');
    }
    if (p.spec.nodeSelector) s += 'Node-Selectors:              ' + labelStr(p.spec.nodeSelector) + '\n';
    if (p.spec.tolerations) s += 'Tolerations:                 ' + p.spec.tolerations.map(function (t) { return t.key + '=' + (t.value || '') + ':' + (t.effect || ''); }).join(', ') + '\n';
    return s + eventsFor(m, 'Pod', p.name, p.ns);
  }
  function describe(m, o, as) {
    var t = target(o, 1), ns = o.f['--namespace'] || m.ns;
    if (!t.kind) return fail('error: the server doesn\'t have a resource type "' + (t.rawKind || '') + '"');
    var denied = rbac(m, as, 'get', t.kind, ns); if (denied) return denied;
    var sel = o.f['--selector'] ? parseSel(o.f['--selector']) : null;
    if (t.kind === 'pods') {
      var pods = t.name ? podsIn(m, ns).filter(function (p) { return p.name === t.name || (p.name.indexOf(t.name) === 0 && t.name.length > 3); })
                        : podsIn(m, ns, sel);
      if (t.name && pods.length > 1) pods = pods.filter(function (p) { return p.name === t.name; }).concat(pods).slice(0, 1);
      if (!pods.length) return t.name ? notFound('pods', t.name) : none(ns);
      return ok(pods.map(function (p) { return describePod(m, p); }).join('\n\n'));
    }
    if (t.kind === 'deployments') {
      var d = t.name ? K.find(m, 'deployments', t.name, ns) : m.deployments.filter(function (x) { return x.ns === ns && !x.gone; })[0];
      if (!d) return notFound('deployments', t.name);
      var st = deployStatus(m, d), rs = K.rsFor(m, d), h = K.templateHash(d.template);
      var cur = rs.filter(function (r) { return r.hash === h; })[0];
      var olds = rs.filter(function (r) { return r !== cur && r.replicas > 0; });
      var tpl = d.template.containers.map(function (c) {
        return '   ' + c.name + ':\n    Image:      ' + c.image + '\n' + resStr(c.resources).replace(/^ {4}/gm, '    ') +
          probeStr('Liveness', c.liveness, K.profileFor(m, c.image)) + probeStr('Readiness', c.readiness, K.profileFor(m, c.image)) +
          (c.envFrom ? '    Environment Variables from:\n' + c.envFrom.map(function (f) { return '      ' + (f.configMapRef || f.secretRef) + '  ' + (f.configMapRef ? 'ConfigMap' : 'Secret') + '\n'; }).join('') : '');
      }).join('');
      return ok('Name:                   ' + d.name + '\nNamespace:              ' + d.ns +
        '\nSelector:               ' + labelStr(d.selector) +
        '\nReplicas:               ' + d.replicas + ' desired | ' + st.updatedReplicas + ' updated | ' + st.replicas + ' total | ' +
        st.availableReplicas + ' available | ' + Math.max(0, st.replicas - st.availableReplicas) + ' unavailable' +
        '\nStrategyType:           RollingUpdate\nRollingUpdateStrategy:  ' + d.strategy.maxUnavailable + ' max unavailable, ' + d.strategy.maxSurge + ' max surge' +
        '\nPod Template:\n  Labels:  ' + labelStr(d.template.labels) +
        (d.template.serviceAccount ? '\n  Service Account:  ' + d.template.serviceAccount : '') +
        (d.template.nodeSelector ? '\n  Node-Selectors:  ' + labelStr(d.template.nodeSelector) : '') +
        '\n  Containers:\n' + tpl +
        'Conditions:\n  Type           Status  Reason\n  ----           ------  ------\n  Available      ' + d.conditions.Available + '    ' +
        (d.conditions.Available === 'True' ? 'MinimumReplicasAvailable' : 'MinimumReplicasUnavailable') +
        '\n  Progressing    ' + (d.conditions.Progressing === 'ProgressDeadlineExceeded' ? 'False' : 'True') + '    ' + d.conditions.Progressing +
        '\nOldReplicaSets:  ' + (olds.length ? olds.map(function (r) { return r.name + ' (' + K.podsOf(m, r).length + '/' + r.replicas + ' replicas created)'; }).join(', ') : '<none>') +
        '\nNewReplicaSet:   ' + (cur ? cur.name + ' (' + K.podsOf(m, cur).length + '/' + cur.replicas + ' replicas created)' : '<none>') + '\n' +
        eventsFor(m, 'Deployment', d.name, d.ns));
    }
    if (t.kind === 'replicasets') {
      var r = K.find(m, 'replicasets', t.name, ns);
      if (!r) return notFound('replicasets', t.name);
      return ok('Name:           ' + r.name + '\nNamespace:      ' + r.ns + '\nControlled By:  Deployment/' + r.owner +
        '\nReplicas:       ' + K.podsOf(m, r).length + ' current / ' + r.replicas + ' desired\nPod Template:\n  Containers:\n' +
        r.template.containers.map(function (c) { return '   ' + c.name + ':\n    Image:  ' + c.image + '\n'; }).join('') + eventsFor(m, 'ReplicaSet', r.name, r.ns));
    }
    if (t.kind === 'services') {
      var s = t.name ? K.find(m, 'services', t.name, ns) : null;
      if (!s) return notFound('services', t.name || '');
      var ep = K.endpoints(m, s), sp = (s.ports || [])[0] || {};
      return ok('Name:              ' + s.name + '\nNamespace:         ' + s.ns + '\nSelector:          ' + labelStr(s.selector) +
        '\nType:              ' + (s.type || 'ClusterIP') + '\nIP:                ' + s.clusterIP +
        (s.type === 'LoadBalancer' ? '\nLoadBalancer Ingress:  ' + (s.externalIP || '') : '') +
        '\nPort:              ' + (sp.name || '<unset>') + '  ' + sp.port + '/TCP\nTargetPort:        ' + (sp.targetPort == null ? sp.port : sp.targetPort) + '/TCP' +
        '\nEndpoints:         ' + (ep.ready.length ? ep.ready.map(function (p) { return p.ip + ':' + ep.port; }).join(',') : '') +
        '\nSession Affinity:  None\n' + eventsFor(m, 'Service', s.name, s.ns));
    }
    if (t.kind === 'nodes') {
      var n = K.find(m, 'nodes', t.name);
      if (!n) return notFound('nodes', t.name);
      var a = K.allocated(m, n);
      var pods = m.pods.filter(function (p) { return p.node === n.name; });
      return ok('Name:               ' + n.name + '\nRoles:              ' + n.role + '\nLabels:             ' + labelStr(n.labels).split(',').join('\n                    ') +
        '\nTaints:             ' + (n.taints.length ? n.taints.map(function (x) { return x.key + '=' + (x.value || '') + ':' + x.effect; }).join('\n                    ') : '<none>') +
        '\nUnschedulable:      ' + !!n.unschedulable + '\nConditions:\n  Type    Status\n  Ready   ' + (n.ready ? 'True' : 'Unknown') +
        '\nAllocatable:\n  cpu:     ' + n.cpu + 'm\n  memory:  ' + n.mem + 'Mi\nSystem Info:\n  Architecture:  ' + n.arch +
        '\nNon-terminated Pods:  (' + pods.length + ' in total)\n' + pods.map(function (p) {
          var r = K.requestsOf(p.spec); return '  ' + p.ns + '  ' + p.name + '  cpu ' + r.cpu + 'm  memory ' + r.mem + 'Mi\n'; }).join('') +
        'Allocated resources:\n  Resource  Requests\n  --------  --------\n  cpu       ' + a.cpu + 'm (' + Math.round(a.cpu / n.cpu * 100) + '%)\n  memory    ' +
        a.mem + 'Mi (' + Math.round(a.mem / n.mem * 100) + '%)\n' + eventsFor(m, 'Node', n.name));
    }
    if (t.kind === 'pvcs') {
      var c = K.find(m, 'pvcs', t.name, ns);
      if (!c) return notFound('pvcs', t.name);
      var users = m.pods.filter(function (p) { return (p.spec.volumes || []).some(function (v) { return v.pvc === c.name; }); });
      return ok('Name:          ' + c.name + '\nNamespace:     ' + c.ns + '\nStorageClass:  ' + (c.storageClassName || '') +
        '\nStatus:        ' + c.phase + '\nVolume:        ' + (c.volume || '') + '\nCapacity:      ' + (c.phase === 'Bound' ? c.request : '') +
        '\nAccess Modes:  ' + (c.phase === 'Bound' ? 'RWO' : '') + '\nUsed By:       ' + (users.length ? users.map(function (p) { return p.name; }).join('\n               ') : '<none>') +
        '\n' + eventsFor(m, 'PersistentVolumeClaim', c.name, c.ns));
    }
    if (['configmaps', 'secrets', 'serviceaccounts', 'rolebindings', 'roles', 'clusterroles', 'clusterrolebindings', 'storageclasses'].indexOf(t.kind) !== -1) {
      var obj = K.find(m, t.kind, t.name, CLUSTER_SCOPED.indexOf(t.kind) !== -1 ? undefined : ns);
      if (!obj) return notFound(t.kind, t.name);
      if (t.kind === 'configmaps') return ok('Name:         ' + obj.name + '\nNamespace:    ' + obj.ns + '\n\nData\n====\n' +
        Object.keys(obj.data || {}).map(function (k) { return k + ':\n----\n' + obj.data[k] + '\n'; }).join('\n') + '\n');
      if (t.kind === 'secrets') return ok('Name:         ' + obj.name + '\nNamespace:    ' + obj.ns + '\nType:  ' + (obj.type || 'Opaque') + '\n\nData\n====\n' +
        Object.keys(obj.data || {}).map(function (k) { return k + ':  ' + String(obj.data[k]).length + ' bytes\n'; }).join(''));
      if (t.kind === 'rolebindings' || t.kind === 'clusterrolebindings') return ok('Name:         ' + obj.name + '\nRole:\n  Kind:  ' + obj.roleRef.kind + '\n  Name:  ' + obj.roleRef.name +
        '\nSubjects:\n  Kind            Name              Namespace\n  ----            ----              ---------\n' +
        (obj.subjects || []).map(function (s) { return '  ' + pad(s.kind, 16) + pad(s.name, 18) + (s.namespace || ''); }).join('\n') + '\n');
      if (t.kind === 'roles' || t.kind === 'clusterroles') return ok('Name:         ' + obj.name + '\nPolicyRule:\n  Resources   Verbs\n  ---------   -----\n' +
        obj.rules.map(function (r) { return '  ' + pad(r.resources.join(','), 12) + '[' + r.verbs.join(' ') + ']'; }).join('\n') + '\n');
      return ok(yaml(view(m, t.kind, obj)).replace(/^\n/, '') + '\n');
    }
    return fail('error: describe for "' + t.rawKind + '" is not implemented in this simulation');
  }

  /* ── logs ─────────────────────────────────────────────────────── */
  function podByRef(m, t, ns) {
    if (t.kind === 'deployments') {
      var d = K.find(m, 'deployments', t.name, ns); if (!d) return null;
      var pods = []; K.rsFor(m, d).forEach(function (r) { pods = pods.concat(K.podsOf(m, r)); });
      pods.sort(function (a, b) { return b.created - a.created; });
      return pods[0] || null;
    }
    return podsIn(m, ns).filter(function (p) { return p.name === t.name; })[0] || null;
  }
  function logs(m, o, as) {
    var ns = o.f['--namespace'] || m.ns;
    var ref = o.pos[1] || '';
    var t = ref.indexOf('/') > 0 ? target(o, 1) : { kind: 'pods', name: ref };
    var denied = rbac(m, as, 'get', 'pods', ns); if (denied) return denied;
    if (!t.name) return fail('error: expected \'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]\'.');
    var p = podByRef(m, t, ns);
    if (!p) return fail('Error from server (NotFound): pods "' + t.name + '" not found');
    var cname = o.f['--container'];
    var list = p.containers.concat(p.init);
    var c = cname ? list.filter(function (x) { return x.name === cname; })[0] : p.containers[0];
    if (!c) return fail('error: container ' + cname + ' is not valid for pod ' + p.name);
    if (!cname && p.containers.length > 1) {
      return fail('error: a container name must be specified for pod ' + p.name + ', choose one of: [' + p.containers.map(function (x) { return x.name; }).join(' ') + ']');
    }
    var prev = o.f['--previous'] || o.f['-p'];
    if (prev) {
      if (!c.prevLogs || !c.lastState) return fail('Error from server (BadRequest): previous terminated container "' + c.name + '" in pod "' + p.name + '" not found');
      return ok(c.prevLogs.join('\n') + (c.prevLogs.length ? '\n' : ''));
    }
    if (c.state === 'waiting') {
      return fail('Error from server (BadRequest): container "' + c.name + '" in pod "' + p.name + '" is waiting to start: ' +
        (c.reason === 'CrashLoopBackOff' ? 'CrashLoopBackOff (use --previous for the last run)' : (c.reason === 'ImagePullBackOff' || c.reason === 'ErrImagePull' ? 'trying and failing to pull image' : (c.reason || 'ContainerCreating'))));
    }
    var lines = c.logs.slice();
    if (o.f['--tail']) lines = lines.slice(-Number(o.f['--tail']));
    return ok(lines.join('\n') + (lines.length ? '\n' : ''));
  }

  /* ── RBAC gate for --as ──────────────────────────────────────── */
  function rbac(m, as, verb, kind, ns) {
    if (!as) return null;
    var res = RESOURCE[kind] || kind;
    if (res === 'endpointslices') res = 'endpointslices';
    if (K.canI(m, as, verb, res, ns || m.ns)) return null;
    return fail('Error from server (Forbidden): ' + K.forbiddenMsg(as, verb, res, ns || m.ns).replace(' in API group ""', ' in API group "' + (kind === 'deployments' || kind === 'replicasets' ? 'apps' : '') + '"'));
  }

  /* ── mutations ───────────────────────────────────────────────── */
  function depRef(m, o, idx, ns) {
    var t = target(o, idx);
    if (t.kind !== 'deployments') return { err: fail('error: this simulation supports ' + o.pos[0] + ' on deployments only (deploy/NAME)') };
    var d = K.find(m, 'deployments', t.name, ns);
    if (!d) return { err: notFound('deployments', t.name) };
    return { d: d, t: t };
  }
  function changeTemplate(m, d, mutate, cause) {
    var tpl = K.clone(d.template);
    mutate(tpl);
    if (K.templateHash(tpl) === K.templateHash(d.template)) return false;
    K.setTemplate(m, d, tpl, cause);
    K.reconcile(m);
    return true;
  }
  function setCmd(m, o, raw) {
    var ns = o.f['--namespace'] || m.ns, what = o.pos[1];
    if (what !== 'image' && what !== 'resources') return fail('error: set ' + (what || '') + ' is not supported in this simulation (supported: set image, set resources)');
    var r = depRef(m, o, 2, ns); if (r.err) return r.err;
    var d = r.d;
    if (what === 'image') {
      var pairs = r.t.rest.filter(function (x) { return x.indexOf('=') > 0; });
      if (!pairs.length) return fail('error: at least one image update is required (container=image)');
      var bad = null;
      var changed = changeTemplate(m, d, function (tpl) {
        pairs.forEach(function (pr) {
          var k = pr.slice(0, pr.indexOf('=')), v = pr.slice(pr.indexOf('=') + 1);
          var cs = tpl.containers.concat(tpl.initContainers || []).filter(function (c) { return k === '*' || c.name === k; });
          if (!cs.length) bad = k;
          cs.forEach(function (c) { c.image = v; });
        });
      }, raw);
      if (bad) return fail('error: unable to find container named "' + bad + '"');
      return ok('deployment.apps/' + d.name + ' image ' + (changed ? 'updated' : 'unchanged') + '\n');
    }
    var lim = o.f['--limits'], req = o.f['--requests'], cname = o.f['--container'];
    if (!lim && !req) return fail('error: you must specify an update to requests or limits (in the form of --requests/--limits)');
    function kv(s) { var out = {}; String(s || '').split(',').forEach(function (x) { var i = x.indexOf('='); if (i > 0) out[x.slice(0, i)] = x.slice(i + 1); }); return out; }
    var changed2 = changeTemplate(m, d, function (tpl) {
      tpl.containers.forEach(function (c) {
        if (cname && c.name !== cname) return;
        c.resources = c.resources || {};
        if (lim) c.resources.limits = Object.assign({}, c.resources.limits || {}, kv(lim));
        if (req) c.resources.requests = Object.assign({}, c.resources.requests || {}, kv(req));
      });
    }, raw);
    return ok('deployment.apps/' + d.name + ' resource requirements ' + (changed2 ? 'updated' : 'unchanged') + '\n');
  }
  function scale(m, o, raw) {
    var ns = o.f['--namespace'] || m.ns, n = o.f['--replicas'];
    if (n == null || !/^\d+$/.test(String(n))) return fail('error: --replicas=COUNT is required');
    var r = depRef(m, o, 1, ns); if (r.err) return r.err;
    if (Number(n) === 0) K.risky(m, raw, 'Scaling to zero removes all serving capacity for ' + r.d.name + '.');
    r.d.replicas = Number(n);
    K.event(m, 'Deployment', r.d, 'Normal', 'ScalingReplicaSet', 'Scaled deployment ' + r.d.name + ' to ' + n, 'deployment-controller');
    K.reconcile(m);
    return ok('deployment.apps/' + r.d.name + ' scaled\n');
  }
  function rollout(m, o, raw) {
    var ns = o.f['--namespace'] || m.ns, sub = o.pos[1];
    if (['status', 'history', 'undo', 'restart'].indexOf(sub) === -1) return fail('error: rollout ' + (sub || '') + ' is not supported in this simulation (supported: status, history, undo, restart)');
    var r = depRef(m, o, 2, ns); if (r.err) return r.err;
    var d = r.d;
    if (sub === 'history') {
      var rsl = K.rsFor(m, d).slice().sort(function (a, b) { return a.revision - b.revision; });
      if (o.f['--revision']) {
        var one = rsl.filter(function (x) { return String(x.revision) === String(o.f['--revision']); })[0];
        if (!one) return fail('error: unable to find the specified revision');
        return ok('deployment.apps/' + d.name + ' with revision #' + one.revision + '\nPod Template:\n  Labels:  ' + labelStr(one.template.labels) +
          '\n  Containers:\n' + one.template.containers.map(function (c) { return '   ' + c.name + ':\n    Image:  ' + c.image + '\n'; }).join(''));
      }
      return ok('deployment.apps/' + d.name + '\n' + table(['REVISION', 'CHANGE-CAUSE'], rsl.map(function (x) { return [x.revision, x.cause || '<none>']; })));
    }
    if (sub === 'undo') {
      var list = K.rsFor(m, d).slice().sort(function (a, b) { return b.revision - a.revision; });
      var curHash = K.templateHash(d.template);
      var to = o.f['--to-revision'] ? list.filter(function (x) { return String(x.revision) === String(o.f['--to-revision']); })[0]
                                    : list.filter(function (x) { return x.hash !== curHash; })[0];
      if (!to) return fail('error: no rollout history found for deployment "' + d.name + '"' + (o.f['--to-revision'] ? ' at revision ' + o.f['--to-revision'] : ''));
      K.setTemplate(m, d, K.clone(to.template), raw);
      K.reconcile(m);
      return ok('deployment.apps/' + d.name + ' rolled back\n');
    }
    if (sub === 'restart') {
      changeTemplate(m, d, function (tpl) {
        tpl.annotations = Object.assign({}, tpl.annotations || {}, { 'kubectl.kubernetes.io/restartedAt': 't+' + m.clock });
      }, raw);
      return ok('deployment.apps/' + d.name + ' restarted\n');
    }
    /* status: step simulated time until done, stuck, or a bounded wait */
    var out = '', last = '', waited = 0, cap = Number(String(o.f['--timeout'] || '').replace(/s$/, '')) || 180;
    while (true) {
      var st = deployStatus(m, d);
      var rs = K.rsFor(m, d), h = K.templateHash(d.template), cur = rs.filter(function (x) { return x.hash === h; })[0];
      var oldPods = rs.filter(function (x) { return x !== cur; }).reduce(function (a, x) { return a + K.podsOf(m, x).length; }, 0);
      var newReady = cur ? K.podsOf(m, cur).filter(K.podReady).length : 0;
      if (K.rolloutComplete(m, d.name, d.ns)) { out += 'deployment "' + d.name + '" successfully rolled out\n'; return ok(out); }
      if (d.conditions.Progressing === 'ProgressDeadlineExceeded') {
        return { out: out, err: 'error: deployment "' + d.name + '" exceeded its progress deadline\n', code: 1 };
      }
      var msg;
      if (st.updatedReplicas < d.replicas) msg = 'Waiting for deployment "' + d.name + '" rollout to finish: ' + st.updatedReplicas + ' out of ' + d.replicas + ' new replicas have been updated...';
      else if (oldPods > 0) msg = 'Waiting for deployment "' + d.name + '" rollout to finish: ' + oldPods + ' old replicas are pending termination...';
      else msg = 'Waiting for deployment "' + d.name + '" rollout to finish: ' + newReady + ' of ' + d.replicas + ' updated replicas are available...';
      if (msg !== last) { out += msg + '\n'; last = msg; }
      if (waited >= cap) {
        return { out: out, err: 'error: timed out waiting for the condition (simulation: stopped after ' + K.age(waited) + ' of simulated time)\n', code: 1 };
      }
      K.advance(m, K.STEP); waited += K.STEP;
    }
  }
  function label(m, o, raw) {
    var ns = o.f['--namespace'] || m.ns, t = target(o, 1);
    if (['pods', 'services', 'deployments', 'nodes'].indexOf(t.kind) === -1) return fail('error: label is supported for pods, services, deployments and nodes in this simulation');
    var objs = t.kind === 'pods' ? (o.f['--all'] ? podsIn(m, ns) : podsIn(m, ns).filter(function (p) { return p.name === t.name; }))
                                 : [K.find(m, t.kind, t.name, t.kind === 'nodes' ? undefined : ns)].filter(Boolean);
    if (!objs.length) return notFound(t.kind, t.name);
    var changes = t.rest.filter(function (x) { return /=|-$/.test(x); });
    if (!changes.length) return fail('error: at least one label update is required');
    for (var i = 0; i < objs.length; i++) {
      var target_ = t.kind === 'deployments' ? (objs[i].labels = objs[i].labels || {}) : (objs[i].labels = objs[i].labels || {});
      for (var j = 0; j < changes.length; j++) {
        var ch = changes[j];
        if (/-$/.test(ch) && ch.indexOf('=') === -1) { delete target_[ch.slice(0, -1)]; continue; }
        var k = ch.slice(0, ch.indexOf('=')), v = ch.slice(ch.indexOf('=') + 1);
        if (k in target_ && target_[k] !== v && !o.f['--overwrite']) {
          return fail("error: '" + k + "' already has a value (" + target_[k] + "), and --overwrite is false");
        }
        target_[k] = v;
      }
    }
    K.reconcile(m);
    return ok(objs.map(function (x) { return (t.kind === 'pods' ? 'pod/' : t.kind === 'services' ? 'service/' : t.kind === 'nodes' ? 'node/' : 'deployment.apps/') + x.name + ' labeled'; }).join('\n') + '\n');
  }

  /* strategic-ish merge: containers merge by name, other arrays replace */
  function merge(dst, src, strategic) {
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (v === null) { delete dst[k]; return; }
      if (Array.isArray(v) && strategic && Array.isArray(dst[k]) && v.every(function (x) { return x && x.name; })) {
        v.forEach(function (item) {
          var hit = dst[k].filter(function (x) { return x.name === item.name; })[0];
          if (hit) merge(hit, item, strategic); else dst[k].push(K.clone(item));
        });
        return;
      }
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) { merge(dst[k], v, strategic); return; }
      dst[k] = K.clone(v);
    });
    return dst;
  }
  /* Translate the Kubernetes-shaped patch into the model's field names. */
  function containerIn(c) {
    var out = {};
    Object.keys(c).forEach(function (k) {
      if (k === 'readinessProbe') out.readiness = probeIn(c[k]);
      else if (k === 'livenessProbe') out.liveness = probeIn(c[k]);
      else if (k === 'envFrom') out.envFrom = c[k].map(function (f) { return f.configMapRef ? { configMapRef: f.configMapRef.name, optional: f.configMapRef.optional } : { secretRef: f.secretRef.name }; });
      else if (k === 'env') out.env = c[k].map(function (e) {
        if (e.valueFrom && e.valueFrom.configMapKeyRef) return { name: e.name, configMapKey: e.valueFrom.configMapKeyRef };
        if (e.valueFrom && e.valueFrom.secretKeyRef) return { name: e.name, secretKey: e.valueFrom.secretKeyRef };
        return { name: e.name, value: e.value };
      });
      else out[k] = c[k];
    });
    return out;
  }
  function probeIn(p) {
    if (p === null) return null;
    var h = p.httpGet || {};
    return { path: h.path, port: h.port, initialDelay: p.initialDelaySeconds, period: p.periodSeconds, failureThreshold: p.failureThreshold };
  }
  function podSpecIn(s) {
    var out = {};
    Object.keys(s).forEach(function (k) {
      if (k === 'containers' || k === 'initContainers') out[k] = s[k].map(containerIn);
      else if (k === 'serviceAccountName') out.serviceAccount = s[k];
      else if (k === 'imagePullSecrets') out.imagePullSecrets = s[k].map(function (x) { return x.name; });
      else if (k === 'volumes') out.volumes = s[k].map(function (v) { return v.persistentVolumeClaim ? { name: v.name, pvc: v.persistentVolumeClaim.claimName } : { name: v.name, configMap: (v.configMap || {}).name }; });
      else out[k] = s[k];
    });
    return out;
  }
  function patch(m, o, raw) {
    var ns = o.f['--namespace'] || m.ns, t = target(o, 1), body = o.f['--patch'] || o.f['-p'];
    if (!t.kind || !t.name) return fail('error: expected patch TYPE NAME -p PATCH');
    if (!body || body === true) return fail('error: must specify -p to patch');
    var p;
    try { p = JSON.parse(String(body).replace(/^'|'$/g, '')); }
    catch (e) { return fail('error: unable to parse "' + body + '": this simulation accepts JSON patches only (e.g. -p \'{"spec":{"replicas":3}}\')'); }
    var strategic = (o.f['--type'] || 'strategic') === 'strategic';
    if (o.f['--type'] === 'json') return fail('error: --type=json patches are not implemented in this simulation; use a merge patch');
    var obj = K.find(m, t.kind, t.name, CLUSTER_SCOPED.indexOf(t.kind) !== -1 ? undefined : ns);
    if (!obj) return notFound(t.kind, t.name);
    var kindWord = { deployments: 'deployment.apps', services: 'service', configmaps: 'configmap', secrets: 'secret',
      serviceaccounts: 'serviceaccount', rolebindings: 'rolebinding.rbac.authorization.k8s.io', pvcs: 'persistentvolumeclaim', nodes: 'node' }[t.kind] || t.kind;
    if (t.kind === 'deployments') {
      var spec = p.spec || {};
      if (spec.selector) return fail('The Deployment "' + obj.name + '" is invalid: spec.selector: Invalid value: ' + JSON.stringify(spec.selector) + ': field is immutable');
      if (spec.replicas != null) { if (spec.replicas === 0) K.risky(m, raw, 'Scaling to zero removes all serving capacity.'); obj.replicas = spec.replicas; }
      if (spec.template) {
        var tp = spec.template;
        var ch = changeTemplate(m, obj, function (tpl) {
          if (tp.metadata && tp.metadata.labels) merge(tpl.labels = tpl.labels || {}, tp.metadata.labels, true);
          if (tp.metadata && tp.metadata.annotations) merge(tpl.annotations = tpl.annotations || {}, tp.metadata.annotations, true);
          if (tp.spec) merge(tpl, podSpecIn(tp.spec), strategic);
        }, raw);
        if (!K.matches(obj.selector, obj.template.labels)) {
          return fail('The Deployment "' + obj.name + '" is invalid: spec.template.metadata.labels: Invalid value: ' + JSON.stringify(obj.template.labels) + ': `selector` does not match template `labels`');
        }
        K.reconcile(m);
        return ok(kindWord + '/' + obj.name + ' ' + (ch || spec.replicas != null ? 'patched' : 'patched (no change)') + '\n');
      }
      K.reconcile(m);
      return ok(kindWord + '/' + obj.name + ' patched\n');
    }
    if (t.kind === 'services') {
      var ss = p.spec || {};
      if (ss.clusterIP) return fail('The Service "' + obj.name + '" is invalid: spec.clusterIP: Invalid value: field is immutable');
      if (ss.selector !== undefined) obj.selector = strategic || o.f['--type'] === 'merge' ? merge(K.clone(obj.selector || {}), ss.selector, false) : ss.selector;
      if (ss.ports) obj.ports = strategic ? ss.ports.map(function (np) { var old = (obj.ports || []).filter(function (x) { return x.port === np.port || x.name === np.name; })[0]; return Object.assign({}, old || {}, np); }) : ss.ports;
      if (ss.type) { obj.type = ss.type; if (ss.type === 'LoadBalancer') K.risky(m, raw, 'Changing the Service type to LoadBalancer requests an external load balancer — a new exposure, and in this simulation no controller provisions one.'); }
      K.reconcile(m);
      return ok('service/' + obj.name + ' patched\n');
    }
    if (t.kind === 'configmaps' || t.kind === 'secrets') {
      if (p.data) merge(obj.data = obj.data || {}, p.data, false);
      if (p.stringData) merge(obj.data = obj.data || {}, p.stringData, false);
      K.reconcile(m);
      return ok(kindWord + '/' + obj.name + ' patched\n');
    }
    if (t.kind === 'serviceaccounts') {
      if (p.imagePullSecrets) obj.imagePullSecrets = p.imagePullSecrets.map(function (x) { return x.name; });
      K.reconcile(m);
      return ok('serviceaccount/' + obj.name + ' patched\n');
    }
    if (t.kind === 'rolebindings' || t.kind === 'clusterrolebindings') {
      if (p.roleRef) return fail('The RoleBinding "' + obj.name + '" is invalid: roleRef: Invalid value: ' + JSON.stringify(p.roleRef) + ': cannot change roleRef');
      if (p.subjects) obj.subjects = p.subjects;
      K.reconcile(m);
      return ok(kindWord + '/' + obj.name + ' patched\n');
    }
    if (t.kind === 'pvcs') {
      if (p.spec && (p.spec.storageClassName !== undefined || p.spec.accessModes)) {
        return fail('The PersistentVolumeClaim "' + obj.name + '" is invalid: spec: Forbidden: spec is immutable after creation except resources.requests and volumeAttributesClassName for bound claims');
      }
      return fail('error: this simulation only models immutability checks for PersistentVolumeClaim patches');
    }
    if (t.kind === 'nodes') {
      if (p.spec && p.spec.unschedulable != null) obj.unschedulable = p.spec.unschedulable;
      K.reconcile(m);
      return ok('node/' + obj.name + ' patched\n');
    }
    return fail('error: patch for "' + t.rawKind + '" is not implemented in this simulation');
  }

  /* ── create / delete / apply ─────────────────────────────────── */
  function create(m, o, raw) {
    var ns = o.f['--namespace'] || m.ns, what = o.pos[1], name = o.pos[2];
    if (what === 'configmap' || what === 'cm' || what === 'secret') {
      var isSecret = what === 'secret';
      var sType = 'Opaque';
      if (isSecret && (name === 'generic' || name === 'docker-registry')) {
        if (name === 'docker-registry') sType = 'kubernetes.io/dockerconfigjson';
        name = o.pos[3];
      } else if (isSecret) {
        return fail('error: create secret needs a type in this simulation: generic or docker-registry (tls is not modelled)');
      }
      if (!name) return fail('error: exactly one NAME is required');
      if (K.find(m, isSecret ? 'secrets' : 'configmaps', name, ns)) return fail('Error from server (AlreadyExists): ' + (isSecret ? 'secrets' : 'configmaps') + ' "' + name + '" already exists');
      var data = {};
      (o.multi['--from-literal'] || []).forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) data[kv.slice(0, i)] = kv.slice(i + 1); });
      if (sType !== 'Opaque') {
        if (!o.f['--docker-server']) return fail('error: --docker-server is required for a docker-registry secret');
        /* the credential itself is never modelled or echoed */
        data = { '.dockerconfigjson': '(simulated credential for ' + o.f['--docker-server'] + ')' };
      }
      var rec = { name: name, ns: ns, data: data, created: m.clock };
      if (isSecret) rec.type = sType;
      m[isSecret ? 'secrets' : 'configmaps'].push(rec);
      K.reconcile(m);
      return ok((isSecret ? 'secret/' : 'configmap/') + name + ' created\n');
    }
    if (what === 'rolebinding' || what === 'clusterrolebinding') {
      if (!name) return fail('error: exactly one NAME is required');
      var role = o.f['--role'], crole = o.f['--clusterrole'];
      if (!role && !crole) return fail('error: exactly one of clusterrole or role must be specified');
      var subs = [];
      if (o.f['--serviceaccount']) { var sp = String(o.f['--serviceaccount']).split(':'); subs.push({ kind: 'ServiceAccount', name: sp[1], namespace: sp[0] }); }
      if (o.f['--user']) subs.push({ kind: 'User', name: o.f['--user'] });
      if (!subs.length) return fail('error: at least one subject (--serviceaccount=NS:NAME or --user) is required');
      var coll = what === 'rolebinding' ? 'rolebindings' : 'clusterrolebindings';
      if (K.find(m, coll, name, what === 'rolebinding' ? ns : undefined)) return fail('Error from server (AlreadyExists): ' + coll + '.rbac.authorization.k8s.io "' + name + '" already exists');
      if (crole && ['cluster-admin', 'admin', 'edit'].indexOf(crole) !== -1) {
        K.risky(m, raw, 'Binding "' + crole + '" grants far more than the workload needs; least privilege means a Role scoped to the verbs and resources it uses.');
      }
      if (what === 'clusterrolebinding') K.risky(m, raw, 'A ClusterRoleBinding applies in every namespace — wider than a namespaced problem needs.');
      m[coll].push({ name: name, ns: what === 'rolebinding' ? ns : undefined, created: m.clock,
                     roleRef: { kind: role ? 'Role' : 'ClusterRole', name: role || crole }, subjects: subs });
      K.reconcile(m);
      return ok((what === 'rolebinding' ? 'rolebinding' : 'clusterrolebinding') + '.rbac.authorization.k8s.io/' + name + ' created\n');
    }
    if (what === 'role') {
      if (!name) return fail('error: exactly one NAME is required');
      var verbs = String(o.f['--verb'] || '').split(',').filter(Boolean), res = String(o.f['--resource'] || '').split(',').filter(Boolean);
      if (!verbs.length || !res.length) return fail('error: --verb and --resource are required');
      m.roles.push({ name: name, ns: ns, rules: [{ apiGroups: [''], resources: res, verbs: verbs }], created: m.clock });
      K.reconcile(m);
      return ok('role.rbac.authorization.k8s.io/' + name + ' created\n');
    }
    return fail('error: create ' + (what || '') + ' is not supported in this simulation (supported: configmap, secret generic, role, rolebinding, clusterrolebinding). Use apply -f for manifests.');
  }
  function del(m, o, raw) {
    var ns = o.f['--namespace'] || m.ns, t = target(o, 1);
    if (!t.kind) return fail('error: the server doesn\'t have a resource type "' + (t.rawKind || '') + '"');
    if (t.kind === 'pods') {
      var sel = o.f['--selector'] ? parseSel(o.f['--selector']) : null;
      var victims = o.f['--all'] ? podsIn(m, ns) : sel ? podsIn(m, ns, sel) : podsIn(m, ns).filter(function (p) { return p.name === t.name; });
      if (!victims.length) return t.name ? notFound('pods', t.name) : none(ns);
      if (o.f['--all'] || (sel && victims.length > 1)) K.risky(m, raw, 'Deleting many pods at once removes capacity simultaneously and discards their --previous logs.');
      if (o.f['--force']) K.risky(m, raw, '--force skips graceful termination and does not wait for the kubelet to confirm the container stopped.');
      victims.forEach(function (p) {
        if (p.containers.some(function (c) { return c.lastState; })) K.risky(m, raw, 'Deleting ' + p.name + ' discarded its previous-container logs — evidence for why it was restarting.');
        K.removePod(m, p);
      });
      K.reconcile(m);
      return ok(victims.map(function (p) { return 'pod "' + p.name + '" deleted from ' + ns + ' namespace'; }).join('\n') + '\n');
    }
    var obj = K.find(m, t.kind, t.name, CLUSTER_SCOPED.indexOf(t.kind) !== -1 ? undefined : ns);
    if (!obj) return notFound(t.kind, t.name);
    if (t.kind === 'deployments') K.risky(m, raw, 'Deleting the Deployment removes every replica and its rollout history.');
    if (t.kind === 'services') K.risky(m, raw, 'Deleting the Service breaks every client and changes its ClusterIP when recreated.');
    if (t.kind === 'pvcs' && obj.phase === 'Bound') K.risky(m, raw, 'Deleting a Bound claim can delete its volume and data, depending on the reclaim policy.');
    if (t.kind === 'namespaces') { K.risky(m, raw, 'Deleting the namespace deletes everything in it.'); return fail('Error from server (Forbidden): the lab refuses to delete namespaces'); }
    obj.gone = true;
    m[t.kind] = m[t.kind].filter(function (x) { return x !== obj; });
    if (t.kind === 'deployments') {
      K.rsFor(m, obj).forEach(function (r) { K.podsOf(m, r).forEach(function (p) { K.removePod(m, p); }); r.replicas = 0; });
      m.replicasets = m.replicasets.filter(function (r) { return r.owner !== obj.name; });
    }
    K.reconcile(m);
    var word = { deployments: 'deployment.apps', services: 'service', configmaps: 'configmap', pvcs: 'persistentvolumeclaim',
      rolebindings: 'rolebinding.rbac.authorization.k8s.io', clusterrolebindings: 'clusterrolebinding.rbac.authorization.k8s.io',
      roles: 'role.rbac.authorization.k8s.io', secrets: 'secret' }[t.kind] || t.kind;
    return ok(word + ' "' + obj.name + '" deleted\n');
  }

  /* A deliberately small YAML reader for the lab's staged manifests: block
     maps, block lists, scalars and quoted strings. It says so when it meets
     anything else rather than guessing. */
  function parseYaml(text) {
    var lines = String(text).split('\n').map(function (l) { return l.replace(/\s+#.*$/, '').replace(/\s+$/, ''); })
      .filter(function (l) { return l.trim() && l.trim() !== '---'; });
    var i = 0;
    function indentOf(l) { return l.match(/^ */)[0].length; }
    function val(s) {
      s = s.trim();
      if (/^".*"$/.test(s) || /^'.*'$/.test(s)) return s.slice(1, -1);
      if (/^-?\d+$/.test(s)) return Number(s);
      if (s === 'true' || s === 'false') return s === 'true';
      if (s === '[]') return [];
      if (s === '{}') return {};
      if (/^[[{]/.test(s)) throw new Error('flow-style collections are not supported by this simulation: ' + s);
      return s;
    }
    function block(ind) {
      if (i >= lines.length) return null;
      if (lines[i].trim().indexOf('- ') === 0 || lines[i].trim() === '-') return list(indentOf(lines[i]));
      return map(ind);
    }
    function map(ind) {
      var out = {};
      while (i < lines.length && indentOf(lines[i]) === ind && lines[i].trim().indexOf('- ') !== 0) {
        var l = lines[i].trim(), c = l.indexOf(':');
        if (c < 0) throw new Error('cannot parse line: ' + l);
        var k = l.slice(0, c).trim(), rest = l.slice(c + 1);
        i++;
        if (rest.trim()) out[k] = val(rest);
        else if (i < lines.length && indentOf(lines[i]) > ind) out[k] = block(indentOf(lines[i]));
        else if (i < lines.length && indentOf(lines[i]) === ind && lines[i].trim().indexOf('- ') === 0) out[k] = list(ind);
        else out[k] = null;
      }
      return out;
    }
    function list(ind) {
      var out = [];
      while (i < lines.length && indentOf(lines[i]) === ind && lines[i].trim().indexOf('-') === 0) {
        var l = lines[i], body = l.trim().slice(1).trim();
        if (!body) { i++; out.push(block(indentOf(lines[i]))); continue; }
        if (/^[A-Za-z0-9_.\/-]+:( |$)/.test(body)) {
          lines[i] = new Array(ind + 3).join(' ') + body;
          out.push(map(ind + 2));
        } else { out.push(val(body)); i++; }
      }
      return out;
    }
    return map(0);
  }
  function apply(m, o, raw, w, U) {
    var file = o.f['--filename'];
    if (!file || file === true) return fail('error: must specify one of -f and -k');
    var n = U && U.node ? U.node(w, file) : null;
    if (!n || n.t !== 'f') return fail('error: the path "' + file + '" does not exist');
    var doc;
    try { doc = parseYaml(n.content); } catch (e) { return fail('error: error parsing ' + file + ': ' + e.message); }
    if (!doc || !doc.kind) return fail('error: error validating "' + file + '": kind not set');
    var md = doc.metadata || {}, ns = md.namespace || o.f['--namespace'] || m.ns;
    if (!md.name) return fail('error: error validating "' + file + '": metadata.name not set');
    if (doc.kind === 'PersistentVolumeClaim') {
      var spec = doc.spec || {}, existing = K.find(m, 'pvcs', md.name, ns);
      var wantClass = spec.storageClassName, req = ((spec.resources || {}).requests || {}).storage || '1Gi';
      if (existing) {
        if ((wantClass || existing.storageClassName) !== existing.storageClassName) {
          return fail('The PersistentVolumeClaim "' + md.name + '" is invalid: spec: Forbidden: spec is immutable after creation except resources.requests and volumeAttributesClassName for bound claims');
        }
        return ok('persistentvolumeclaim/' + md.name + ' unchanged\n');
      }
      m.pvcs.push({ name: md.name, ns: ns, storageClassName: wantClass, request: req, accessModes: spec.accessModes, phase: 'Pending', created: m.clock });
      K.reconcile(m);
      return ok('persistentvolumeclaim/' + md.name + ' created\n');
    }
    if (doc.kind === 'ConfigMap') {
      var cm = K.find(m, 'configmaps', md.name, ns);
      if (cm) { cm.data = doc.data || {}; K.reconcile(m); return ok('configmap/' + md.name + ' configured\n'); }
      m.configmaps.push({ name: md.name, ns: ns, data: doc.data || {}, created: m.clock });
      K.reconcile(m);
      return ok('configmap/' + md.name + ' created\n');
    }
    if (doc.kind === 'RoleBinding') {
      var rb = K.find(m, 'rolebindings', md.name, ns);
      var rr = { kind: (doc.roleRef || {}).kind, name: (doc.roleRef || {}).name };
      if (rb && (rb.roleRef.kind !== rr.kind || rb.roleRef.name !== rr.name)) return fail('The RoleBinding "' + md.name + '" is invalid: roleRef: Invalid value: cannot change roleRef');
      if (rb) { rb.subjects = doc.subjects || []; K.reconcile(m); return ok('rolebinding.rbac.authorization.k8s.io/' + md.name + ' configured\n'); }
      m.rolebindings.push({ name: md.name, ns: ns, roleRef: rr, subjects: doc.subjects || [], created: m.clock });
      K.reconcile(m);
      return ok('rolebinding.rbac.authorization.k8s.io/' + md.name + ' created\n');
    }
    return fail('error: apply for kind ' + doc.kind + ' is not implemented in this simulation (supported: ConfigMap, PersistentVolumeClaim, RoleBinding). Use patch, set or scale for other objects.');
  }

  /* ── auth, top, exec, cordon ─────────────────────────────────── */
  function auth(m, o) {
    if (o.pos[1] !== 'can-i') return fail('error: auth ' + (o.pos[1] || '') + ' is not supported in this simulation (supported: auth can-i)');
    var ns = o.f['--namespace'] || m.ns, as = o.f['--as'];
    if (o.f['--list']) {
      var res = ['pods', 'configmaps', 'secrets', 'deployments', 'services', 'persistentvolumeclaims'];
      var verbs = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'];
      var rows = res.map(function (r) {
        return [r, '[' + verbs.filter(function (v) { return K.canI(m, as, v, r, ns); }).join(' ') + ']'];
      }).filter(function (r) { return r[1] !== '[]'; });
      return ok(table(['Resources', 'Verbs'], rows.length ? rows : [['(none)', '[]']]));
    }
    var verb = o.pos[2], resource = o.pos[3];
    if (!verb || !resource) return fail('error: you must specify two arguments: verb resource or a non-resource URL');
    var r = KIND[resource] ? RESOURCE[KIND[resource]] : resource;
    var yes = K.canI(m, as, verb, r, ns);
    return { out: yes ? 'yes\n' : 'no\n', code: yes ? 0 : 1 };
  }
  function top(m, o) {
    var ns = o.f['--namespace'] || m.ns;
    if (o.pos[1] === 'node' || o.pos[1] === 'nodes') {
      return ok(table(['NAME', 'CPU(cores)', 'CPU(%)', 'MEMORY(bytes)', 'MEMORY(%)'], m.nodes.map(function (n) {
        var used = m.pods.filter(function (p) { return p.node === n.name; }).reduce(function (a, p) {
          return a + p.containers.reduce(function (b, c) { return b + (c.state === 'running' ? (K.profileFor(m, c.image).memMi || 48) : 0); }, 0); }, 400);
        return [n.name, '310m', Math.round(310 / n.cpu * 100) + '%', Math.round(used) + 'Mi', Math.round(used / n.mem * 100) + '%'];
      })));
    }
    if (o.pos[1] !== 'pod' && o.pos[1] !== 'pods' && o.pos[1] !== 'po') return fail('error: top ' + (o.pos[1] || '') + ' is not supported (supported: top pod, top node)');
    var pods = podsIn(m, ns).filter(function (p) { return p.containers.some(function (c) { return c.state === 'running'; }); });
    if (o.pos[2]) pods = pods.filter(function (p) { return p.name === o.pos[2]; });
    if (!pods.length) return fail('error: metrics not available yet');
    return ok(table(['NAME', 'CPU(cores)', 'MEMORY(bytes)'], pods.map(function (p) {
      var mem = p.containers.reduce(function (a, c) {
        var prof = K.profileFor(m, c.image), lim = K.memMi((((p.spec.containers.filter(function (x) { return x.name === c.name; })[0] || {}).resources || {}).limits || {}).memory);
        var use = prof.memMi || 48;
        if (lim != null && use > lim) use = lim * 0.97; /* climbing to the limit before the kill */
        return a + (c.state === 'running' ? use : 0);
      }, 0);
      return [p.name, (5 + K.hashOf(p.name).charCodeAt(0) % 40) + 'm', Math.round(mem) + 'Mi'];
    })));
  }
  function resolveName(m, host, fromNs) {
    var h = host.replace(/\.$/, '');
    var parts = h.split('.');
    var svcName = parts[0], ns = parts[1] || fromNs;
    if (parts.length > 2 && parts[2] !== 'svc') return null;
    if (parts.length > 3 && h.slice(-('svc.cluster.local'.length)) !== 'svc.cluster.local') return null;
    var s = K.find(m, 'services', svcName, ns);
    return s ? { svc: s, fqdn: s.name + '.' + s.ns + '.svc.cluster.local' } : null;
  }
  function exec(m, o) {
    var ns = o.f['--namespace'] || m.ns, ref = o.pos[1];
    if (!ref) return fail('error: expected \'exec (POD | TYPE/NAME) [-c CONTAINER] -- COMMAND [args...]\'');
    var t = ref.indexOf('/') > 0 ? { kind: KIND[ref.split('/')[0]], name: ref.split('/')[1] } : { kind: 'pods', name: ref };
    var p = podByRef(m, t, ns);
    if (!p) return fail('Error from server (NotFound): pods "' + t.name + '" not found');
    if (!p.containers.some(function (c) { return c.state === 'running'; })) return fail('error: unable to upgrade connection: container not found ("' + p.containers[0].name + '")');
    var cmd = o.after;
    if (!cmd.length) return fail('error: you must specify at least one command for the container');
    var prog = cmd[0], args = cmd.slice(1).filter(function (x) { return x.charAt(0) !== '-'; });
    if (prog === 'env' || prog === 'printenv') {
      var envr = K.envFor(m, p, p.spec.containers[0]);
      return ok(Object.keys(envr.env).map(function (k) { return k + '=' + envr.env[k]; }).join('\n') + '\nHOSTNAME=' + p.name + '\n');
    }
    if (prog === 'cat' && cmd[1] === '/etc/resolv.conf') {
      return ok('search ' + p.ns + '.svc.cluster.local svc.cluster.local cluster.local\nnameserver 10.96.0.10\noptions ndots:5\n');
    }
    if (prog === 'nslookup' || prog === 'dig' || prog === 'host') {
      var name = args[args.length - 1] || '';
      if (m.dnsBroken) return fail(';; connection timed out; no servers could be reached\n');
      var r = resolveName(m, name, p.ns);
      if (!r) return { out: 'Server:\t\t10.96.0.10\nAddress:\t10.96.0.10:53\n\n** server can\'t find ' + name + ': NXDOMAIN\n', code: 1 };
      return ok('Server:\t\t10.96.0.10\nAddress:\t10.96.0.10:53\n\nName:\t' + r.fqdn + '\nAddress: ' + r.svc.clusterIP + '\n');
    }
    if (prog === 'curl' || prog === 'wget') {
      var url = args.filter(function (x) { return /^https?:\/\//.test(x) || /^[a-z0-9.-]+(:\d+)?(\/|$)/i.test(x); }).pop() || '';
      var mm = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
      if (!mm) return fail('curl: (3) URL rejected: Malformed input to a URL function');
      var host = mm[1], port = mm[2] ? Number(mm[2]) : 80, path = mm[3] || '/';
      var code = cmd.join(' ').indexOf('%{http_code}') !== -1;
      var hit = resolveName(m, host, p.ns), svc = hit && hit.svc;
      if (!svc) {
        var byIp = m.services.filter(function (s) { return s.clusterIP === host; })[0];
        if (byIp) svc = byIp;
      }
      if (!svc) {
        var podT = m.pods.filter(function (x) { return x.ip === host; })[0];
        if (!podT) return fail('curl: (6) Could not resolve host: ' + host);
        var pp = K.profileFor(m, podT.containers[0].image);
        if (!K.podReady(podT) && podT.containers[0].state !== 'running') return fail('curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 1 ms: Couldn\'t connect to server');
        if (port !== pp.port) return fail('curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 1 ms: Couldn\'t connect to server');
        return httpReply(pp, path, code);
      }
      var sp = (svc.ports || []).filter(function (x) { return x.port === port; })[0];
      if (!sp) return fail('curl: (28) Connection timed out after 5001 milliseconds (no Service port ' + port + ' on ' + svc.name + ')');
      var ep = K.endpoints(m, svc);
      if (!ep.ready.length) return fail('curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 2 ms: Couldn\'t connect to server');
      var target_ = K.resolveTarget(m, sp, ep.ready[0]);
      var prof = K.profileFor(m, ep.ready[0].containers[0].image);
      if (target_ !== prof.port) return fail('curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 1 ms: Couldn\'t connect to server');
      return httpReply(prof, path, code);
    }
    return fail('error: this simulation only supports exec with: nslookup, curl, wget, env, printenv, cat /etc/resolv.conf');
  }
  function httpReply(prof, path, codeOnly) {
    var routes = prof.http || {};
    var body = routes[path] != null ? routes[path] : (path === prof.readyPath || path === prof.livePath ? 'ok' : null);
    if (body == null) return ok(codeOnly ? '404' : '404 page not found\n');
    return ok(codeOnly ? '200' : body + '\n');
  }
  function cordon(m, o, raw) {
    var n = K.find(m, 'nodes', o.pos[1]);
    if (!n) return notFound('nodes', o.pos[1] || '');
    if (o.pos[0] === 'drain') {
      K.risky(m, raw, 'Draining evicts every pod on the node; in this lab it is rarely the fix for a namespaced fault.');
      n.unschedulable = true;
      m.pods.filter(function (p) { return p.node === n.name && p.owner; }).forEach(function (p) { K.removePod(m, p); });
      K.reconcile(m);
      return ok('node/' + n.name + ' cordoned\nnode/' + n.name + ' drained\n');
    }
    n.unschedulable = o.pos[0] === 'cordon';
    K.reconcile(m);
    return ok('node/' + n.name + ' ' + (n.unschedulable ? 'cordoned' : 'uncordoned') + '\n');
  }

  /* ── dispatch ─────────────────────────────────────────────────── */
  var SUPPORTED = 'get, describe, logs, events, rollout (status|history|undo|restart), set (image|resources), scale, label, patch, apply -f, create (configmap|secret|role|rolebinding|clusterrolebinding), delete, auth can-i, top, exec, cordon, uncordon, drain, config current-context, version';
  var WHY_NOT = {
    edit: 'kubectl edit needs an interactive editor, which this simulation does not provide. Use patch, set, scale, or edit a file with sed and apply -f.',
    port: 'port-forward needs a real network connection; this simulation has none. Use kubectl exec … -- curl to test from inside the namespace.',
    'port-forward': 'port-forward needs a real network connection; this simulation has none. Use kubectl exec … -- curl to test from inside the namespace.',
    debug: 'kubectl debug creates ephemeral containers, which this simulation does not model.',
    cp: 'kubectl cp is not modelled — there are no container filesystems here.',
    run: 'kubectl run is not modelled; the lab objects are created for you.',
    expose: 'kubectl expose is not modelled; patch the existing Service instead.',
    replace: 'kubectl replace is not modelled; use apply -f for supported kinds, or patch.',
    'api-resources': 'api-resources is not modelled; the supported kinds are pods, deployments, replicasets, services, endpoints, endpointslices, events, nodes, configmaps, secrets, pvc, pv, storageclasses, serviceaccounts, roles, rolebindings.'
  };
  function run(w, a, U) {
    var m = w.k8sModel;
    var o = parse(a);
    var verb = o.pos[0];
    var raw = 'kubectl ' + a.join(' ');
    if (!verb || verb === 'help' || o.f['--help']) {
      return ok('kubectl — SIMULATION with a bounded command set.\nSupported: ' + SUPPORTED + '.\n' +
        'Everything you see is derived from a small model of this namespace; see the lab notes for what is simplified.\n');
    }
    if (o.f['--context'] && o.f['--context'] !== m.context) {
      return fail('error: context "' + o.f['--context'] + '" does not exist (this lab has one context: ' + m.context + ')');
    }
    if (WHY_NOT[verb]) return fail('kubectl ' + verb + ': not supported in this simulation. ' + WHY_NOT[verb]);
    if (verb === 'version') return ok('Client Version: v1.33.0\nServer Version: v1.33.0 (simulated)\n');
    if (verb === 'config') {
      if (o.pos[1] === 'current-context') return ok(m.context + '\n');
      if (o.pos[1] === 'get-contexts') return ok(table(['CURRENT', 'NAME', 'CLUSTER', 'AUTHINFO', 'NAMESPACE'], [['*', m.context, m.context, m.user, m.ns]]));
      return fail('error: config ' + (o.pos[1] || '') + ' is not supported in this simulation (supported: current-context, get-contexts)');
    }
    /* time passes between commands: this is what lets a crash loop, a
       rollout or a backoff move forward while you investigate */
    K.advance(m, K.PER_COMMAND);
    var as = o.f['--as'] && o.f['--as'] !== true ? o.f['--as'] : null;
    switch (verb) {
      case 'get': return get(m, o, as);
      case 'describe': return describe(m, o, as);
      case 'logs': case 'log': return logs(m, o, as);
      case 'events': return get(m, { pos: ['get', 'events'], f: o.f, multi: o.multi }, as);
      case 'rollout': return as ? rbac(m, as, 'patch', 'deployments', o.f['--namespace'] || m.ns) || rollout(m, o, raw) : rollout(m, o, raw);
      case 'set': return as ? rbac(m, as, 'patch', 'deployments', o.f['--namespace'] || m.ns) || setCmd(m, o, raw) : setCmd(m, o, raw);
      case 'scale': return as ? rbac(m, as, 'patch', 'deployments', o.f['--namespace'] || m.ns) || scale(m, o, raw) : scale(m, o, raw);
      case 'label': return label(m, o, raw);
      case 'annotate': return fail('kubectl annotate: not supported in this simulation. Annotations do not affect any behaviour modelled here.');
      case 'patch': return as ? rbac(m, as, 'patch', target(o, 1).kind, o.f['--namespace'] || m.ns) || patch(m, o, raw) : patch(m, o, raw);
      case 'apply': return apply(m, o, raw, w, U);
      case 'create': return create(m, o, raw);
      case 'delete': return as ? rbac(m, as, 'delete', target(o, 1).kind, o.f['--namespace'] || m.ns) || del(m, o, raw) : del(m, o, raw);
      case 'auth': return auth(m, o);
      case 'top': return top(m, o);
      case 'exec': return exec(m, o);
      case 'cordon': case 'uncordon': case 'drain': return cordon(m, o, raw);
    }
    return fail('error: unknown command "' + verb + '" for "kubectl" in this simulation.\nSupported: ' + SUPPORTED + '.');
  }

  /* ── lab-registry: a stand-in for whatever registry client you use ─ */
  function registry(w, a) {
    var m = w.k8sModel;
    if (!m) return fail('lab-registry: no simulated registry in this lab');
    var sub = a[0], arg = a[1];
    var HEAD = 'lab-registry is a SIMULATED stand-in for a real registry client; it is not a real tool.\n';
    if (!sub || sub === 'help' || sub === '--help') {
      return ok(HEAD + 'Usage:\n  lab-registry list [PREFIX]          images present in reachable registries\n' +
        '  lab-registry inspect IMAGE          digest, platforms and signature of one image\n' +
        '  lab-registry bundles                transfer bundles waiting on the import host\n' +
        '  lab-registry verify BUNDLE          check a bundle\'s digests and signature against trusted keys\n' +
        '  lab-registry diff RELEASE           images a release needs that the mirror does not have\n' +
        '  lab-registry import BUNDLE          load a bundle\'s images into the mirror\n' +
        '  lab-registry keys                   the keys this environment trusts\n');
    }
    K.advance(m, K.PER_COMMAND);
    if (sub === 'list') {
      var imgs = Object.keys(m.registry).filter(function (i) { return !arg || i.indexOf(arg) === 0; }).sort();
      return ok(imgs.length ? imgs.join('\n') + '\n' : '(no images match)\n');
    }
    if (sub === 'inspect') {
      if (!arg) return fail('lab-registry inspect: an image reference is required');
      var e = m.registry[arg];
      if (!e) return fail('lab-registry inspect: ' + arg + ': not found in any reachable registry');
      return ok('image:     ' + arg + '\ndigest:    ' + (e.digest || 'sha256:' + K.hashOf(arg) + K.hashOf(arg + '1') + '...') +
        '\nplatforms: ' + (e.arch || ['amd64']).map(function (x) { return 'linux/' + x; }).join(', ') +
        '\nsignature: ' + (e.signedBy ? 'present, signed by key "' + e.signedBy + '"' + (m.trustedKeys.indexOf(e.signedBy) !== -1 ? ' (trusted here)' : ' (NOT in this environment\'s trusted keys)') : 'none') + '\n');
    }
    if (sub === 'keys') return ok('trusted keys:\n' + m.trustedKeys.map(function (k) { return '  ' + k; }).join('\n') + '\n');
    if (sub === 'bundles') {
      var names = Object.keys(m.bundles);
      return ok(names.length ? table(['BUNDLE', 'IMAGES', 'IMPORTED'], names.map(function (b) {
        return [b, m.bundles[b].images.length, m.imported[b] ? 'yes' : 'no']; })) : '(no bundles on the import host)\n');
    }
    if (sub === 'verify') {
      var b = m.bundles[arg];
      if (!b) return fail('lab-registry verify: no bundle named "' + (arg || '') + '"');
      var out = 'bundle ' + arg + '\n';
      var bad = (b.corrupt || []);
      b.images.forEach(function (i) { out += '  ' + (bad.indexOf(i) !== -1 ? 'DIGEST MISMATCH ' : 'digest ok       ') + i + '\n'; });
      var trusted = b.signedBy && m.trustedKeys.indexOf(b.signedBy) !== -1;
      out += 'manifest signature: ' + (b.signedBy ? 'signed by "' + b.signedBy + '"' : 'MISSING') + '\n';
      var pass = trusted && !bad.length;
      out += 'result: ' + (pass ? 'VERIFIED — digests match and the signer is a trusted key'
        : 'FAILED — ' + (!b.signedBy ? 'no signature' : !trusted ? 'signer "' + b.signedBy + '" is not a trusted key' : 'digest mismatch')) + '\n';
      if (pass) m.verified[arg] = m.clock;
      return { out: out, code: pass ? 0 : 1 };
    }
    if (sub === 'diff') {
      var rel = m.releases[arg];
      if (!rel) return fail('lab-registry diff: no release manifest named "' + (arg || '') + '" (known: ' + Object.keys(m.releases).join(', ') + ')');
      var missing = rel.filter(function (i) { return !m.registry[i]; });
      return ok('release ' + arg + ' requires ' + rel.length + ' images\n' + rel.map(function (i) {
        return '  ' + (m.registry[i] ? 'present  ' : 'MISSING  ') + i; }).join('\n') + '\n' +
        (missing.length ? missing.length + ' missing from the mirror\n' : 'all present\n'));
    }
    if (sub === 'import') {
      var bb = m.bundles[arg];
      if (!bb) return fail('lab-registry import: no bundle named "' + (arg || '') + '"');
      if (!m.verified[arg]) K.risky(m, 'lab-registry import ' + arg, 'Imported a bundle that had not been verified — digests and signer were never checked against a trusted key.');
      bb.images.forEach(function (i) { m.registry[i] = K.clone((bb.meta || {})[i] || { arch: ['amd64', 'arm64'], signedBy: bb.signedBy }); });
      m.imported[arg] = m.clock;
      K.reconcile(m);
      return ok('imported ' + bb.images.length + ' images from ' + arg + ' into the mirror\n');
    }
    return fail('lab-registry: unknown subcommand "' + sub + '" (try: lab-registry help)');
  }

  root.LXK8s.run = run;
  root.LXK8s.registry = registry;
  root.LXK8s.parseYaml = parseYaml;
  root.LXK8s.table = table;
  root.LXK8s.SUPPORTED = SUPPORTED;
  if (root.LXShell && root.LXShell.register) {
    root.LXShell.register('lab-registry', function (w, a) {
      if (!w.k8sModel) return fail('lab-registry: only available inside the onsite simulation labs');
      return registry(w, a);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
