/* A small, deterministic model of a Kubernetes namespace, for the onsite
   track's incident labs.

   Why a model rather than fixtures: the lessons that matter are causal. A
   deleted pod is replaced because a ReplicaSet reconciles; a rollout stalls
   because new pods never become Ready while maxUnavailable keeps the old ones;
   a readiness failure removes a pod from a Service without restarting it; a
   ConfigMap fix is picked up by the next container start. Printing stored
   objects cannot teach any of that, so every read here is derived from state
   and every write goes through the controllers.

   Deliberately simplified, and said so in every lab: one logical clock that
   advances a fixed step per command, first-fit scheduling, no watch, no
   informer lag, no network model below "is there a Ready endpoint on that
   port". No Math.random and no Date — the same commands always produce the
   same output, which is what makes the labs testable.

   Loaded as a plain script (window.LXK8s) or required from node. */
(function (root) {
  'use strict';

  var STEP = 5;            /* seconds of logical time per controller pass   */
  var PER_COMMAND = 10;    /* logical seconds each kubectl invocation costs */

  /* ── small utilities ─────────────────────────────────────────── */
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h;
  }
  function hashOf(obj) {
    var a = fnv(JSON.stringify(obj)).toString(16), b = fnv('x' + JSON.stringify(obj)).toString(16);
    return (a + b).replace(/[^0-9a-f]/g, '').slice(0, 10);
  }
  var ALPHA = 'bcdfghjklmnpqrstvwxz2456789';
  function suffix(m, base) {
    m.podSeq++;
    var n = fnv(base + ':' + m.podSeq), s = '';
    for (var i = 0; i < 5; i++) { s += ALPHA.charAt(n % ALPHA.length); n = Math.floor(n / ALPHA.length) + 7 * (i + 1); }
    return s;
  }
  function memMi(q) {
    if (q == null || q === '') return null;
    var s = String(q).trim(), n = parseFloat(s);
    if (isNaN(n)) return null;
    if (/Gi$/.test(s)) return n * 1024;
    if (/Mi$/.test(s)) return n;
    if (/Ki$/.test(s)) return n / 1024;
    if (/G$/.test(s)) return n * 1000 * 1000 * 1000 / 1048576;
    if (/M$/.test(s)) return n * 1000 * 1000 / 1048576;
    if (/k$/.test(s)) return n * 1000 / 1048576;
    return n / 1048576;
  }
  function cpuMilli(q) {
    if (q == null || q === '') return null;
    var s = String(q).trim();
    if (/m$/.test(s)) return parseFloat(s);
    var n = parseFloat(s);
    return isNaN(n) ? null : n * 1000;
  }
  /* kubectl's HumanDuration, closely enough to read naturally. */
  function age(sec) {
    sec = Math.max(0, Math.floor(sec));
    if (sec < 120) return sec + 's';
    var min = Math.floor(sec / 60);
    if (min < 10) return min + 'm' + (sec % 60 ? (sec % 60) + 's' : '');
    if (min < 180) return min + 'm';
    var h = Math.floor(min / 60);
    if (h < 8) return h + 'h' + (min % 60 ? (min % 60) + 'm' : '');
    if (h < 48) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }
  function matches(sel, labels) {
    if (!sel) return false;
    var keys = Object.keys(sel);
    if (!keys.length) return false;
    return keys.every(function (k) { return (labels || {})[k] === sel[k]; });
  }

  /* ── construction ────────────────────────────────────────────── */
  var KINDS = ['nodes', 'deployments', 'services', 'configmaps', 'secrets', 'storageclasses',
               'pvcs', 'pvs', 'serviceaccounts', 'roles', 'rolebindings', 'clusterroles',
               'clusterrolebindings', 'pods'];

  function create(seed) {
    seed = clone(seed || {});
    var now = seed.now || 7200;
    var m = {
      clock: 0, now: now, ns: seed.namespace || 'default', context: seed.context || 'lab-sim',
      user: seed.user || 'lab-admin', version: seed.version || 'v1.33.0 (simulated)',
      replicasets: [], events: [], risky: [], seq: 0, podSeq: 0, pvSeq: 0,
      registry: seed.registry || {}, registryAuth: seed.registryAuth || {},
      policy: seed.policy || null, reachable: seed.reachable || null,
      apps: seed.apps || {}, bundles: seed.bundles || {}, releases: seed.releases || {},
      trustedKeys: seed.trustedKeys || [], verified: {}, imported: {}
    };
    KINDS.forEach(function (k) { m[k] = []; });
    (seed.nodes || []).forEach(function (n) {
      m.nodes.push({
        name: n.name, ready: n.ready !== false, unschedulable: !!n.unschedulable,
        cpu: n.cpu || 4000, mem: n.mem || 8192, arch: n.arch || 'amd64',
        labels: Object.assign({ 'kubernetes.io/hostname': n.name, 'kubernetes.io/arch': n.arch || 'amd64' }, n.labels || {}),
        taints: n.taints || [], role: n.role || '<none>', created: 0
      });
    });
    ['services', 'configmaps', 'secrets', 'storageclasses', 'pvcs', 'serviceaccounts', 'roles',
     'rolebindings', 'clusterroles', 'clusterrolebindings'].forEach(function (k) {
      (seed[k] || []).forEach(function (o) {
        o = clone(o); o.ns = o.ns || (k === 'storageclasses' || k === 'clusterroles' || k === 'clusterrolebindings' ? undefined : m.ns);
        o.created = o.created == null ? 0 : o.created;
        m[k].push(o);
      });
    });
    if (!m.serviceaccounts.some(function (s) { return s.name === 'default' && s.ns === m.ns; })) {
      m.serviceaccounts.push({ name: 'default', ns: m.ns, created: 0 });
    }
    m.pvcs.forEach(function (c) { c.phase = 'Pending'; });

    /* Deployments are replayed from their first template so that ReplicaSets,
       revisions, restart counts and events all come out of the controllers
       rather than being written down by hand. */
    var timeline = [];
    (seed.deployments || []).forEach(function (d) {
      var hist = d.history || [d.template];
      var dep = {
        name: d.name, ns: d.ns || m.ns, replicas: d.replicas == null ? 1 : d.replicas,
        selector: d.selector, template: clone(hist[0]), created: 0,
        strategy: { maxSurge: d.maxSurge == null ? 1 : d.maxSurge, maxUnavailable: d.maxUnavailable == null ? 0 : d.maxUnavailable },
        progressDeadline: d.progressDeadline || 600, revisionHistory: [], annotations: d.annotations || {},
        rolloutStart: 0, conditions: {}
      };
      m.deployments.push(dep);
      for (var i = 1; i < hist.length; i++) {
        timeline.push({ at: now - (d.changedAgo || 1200) + (i - 1) * 60, dep: dep, template: hist[i] });
      }
    });
    (seed.pods || []).forEach(function (p) {
      timeline.push({ at: p.at == null ? 0 : p.at, pod: p });
    });
    (seed.timeline || []).forEach(function (t) { timeline.push(t); });
    timeline.sort(function (a, b) { return a.at - b.at; });

    var ti = 0;
    for (var t = 0; t <= now; t += STEP) {
      m.clock = t;
      while (ti < timeline.length && timeline[ti].at <= t) { applyTimeline(m, timeline[ti]); ti++; }
      reconcile(m);
    }
    m.clock = now;
    return m;
  }

  function applyTimeline(m, e) {
    if (e.dep && e.template) { setTemplate(m, e.dep, clone(e.template), e.cause); return; }
    if (e.pod) { createPod(m, clone(e.pod), null); return; }
    var dep = e.name ? find(m, 'deployments', e.name, e.ns) : null;
    if (e.do === 'scale' && dep) {
      dep.replicas = e.replicas;
      event(m, 'Deployment', dep, 'Normal', 'ScalingReplicaSet',
        'Scaled deployment ' + dep.name + ' to ' + e.replicas, 'deployment-controller');
    }
    if (e.do === 'deletePods') {
      m.pods.filter(function (p) { return matches(e.selector, p.labels) && !p.gone; })
        .forEach(function (p) { removePod(m, p); });
    }
    if (e.do === 'patch' && e.kind && e.obj) {
      var o = find(m, e.kind, e.obj, e.ns);
      if (o) Object.keys(e.set).forEach(function (k) { o[k] = clone(e.set[k]); });
    }
    if (e.do === 'event') {
      m.events.push({ ns: e.ns || m.ns, kind: e.kind, name: e.obj, type: e.type || 'Normal', reason: e.reason,
                      msg: e.msg, from: e.from || 'kubelet', first: m.clock, last: m.clock, count: 1 });
    }
  }

  function find(m, kind, name, ns) {
    var list = m[kind] || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.name === name && (ns === undefined || o.ns === undefined || o.ns === ns) && !o.gone) return o;
    }
    return null;
  }

  function event(m, kind, obj, type, reason, msg, from) {
    var ns = obj.ns || m.ns;
    for (var i = m.events.length - 1; i >= 0; i--) {
      var e = m.events[i];
      if (e.kind === kind && e.name === obj.name && e.reason === reason && e.msg === msg && e.ns === ns) {
        e.count++; e.last = m.clock; return;
      }
    }
    m.events.push({ ns: ns, kind: kind, name: obj.name, type: type, reason: reason, msg: msg,
                    from: from || 'kubelet', first: m.clock, last: m.clock, count: 1 });
    if (m.events.length > 400) m.events.shift();
  }

  /* ── deployments and ReplicaSets ─────────────────────────────── */
  function templateHash(tpl) { return hashOf(tpl); }

  function setTemplate(m, dep, tpl, cause) {
    dep.template = tpl;
    dep.rolloutStart = m.clock;
    dep.changeCause = cause || dep.changeCause;
  }

  function rsFor(m, dep) {
    return m.replicasets.filter(function (r) { return r.owner === dep.name && r.ns === dep.ns; });
  }
  function podsOf(m, rs) {
    return m.pods.filter(function (p) { return p.owner === rs.name && p.ns === rs.ns && !p.gone; });
  }
  function podReady(p) { return p.phase === 'Running' && p.ready; }

  function deploymentController(m) {
    m.deployments.forEach(function (d) {
      if (d.gone) return;
      var h = templateHash(d.template), all = rsFor(m, d);
      var maxRev = all.reduce(function (a, r) { return Math.max(a, r.revision); }, 0);
      var cur = all.filter(function (r) { return r.hash === h; })[0];
      if (!cur) {
        cur = { name: d.name + '-' + h, ns: d.ns, owner: d.name, hash: h, template: clone(d.template),
                replicas: 0, revision: maxRev + 1, created: m.clock, cause: d.changeCause };
        m.replicasets.push(cur);
        if (all.length) d.rolloutStart = m.clock;
      } else if (cur.revision !== maxRev) {
        /* rolling back to an older template promotes that ReplicaSet to the newest revision */
        cur.revision = maxRev + 1;
        cur.cause = d.changeCause;
        d.rolloutStart = m.clock;
      }
      var olds = all.filter(function (r) { return r !== cur; });
      var want = d.replicas, surge = d.strategy.maxSurge, unav = d.strategy.maxUnavailable;
      var total = function () { return rsFor(m, d).reduce(function (a, r) { return a + r.replicas; }, 0); };

      /* scale the new ReplicaSet up within maxSurge */
      if (cur.replicas < want) {
        var room = want + surge - total();
        if (!olds.some(function (r) { return r.replicas > 0; })) room = want - cur.replicas;
        var up = Math.max(0, Math.min(want - cur.replicas, room));
        if (up > 0) {
          cur.replicas += up;
          event(m, 'Deployment', d, 'Normal', 'ScalingReplicaSet',
            'Scaled up replica set ' + cur.name + ' from ' + (cur.replicas - up) + ' to ' + cur.replicas, 'deployment-controller');
        }
      } else if (cur.replicas > want) {
        event(m, 'Deployment', d, 'Normal', 'ScalingReplicaSet',
          'Scaled down replica set ' + cur.name + ' from ' + cur.replicas + ' to ' + want, 'deployment-controller');
        cur.replicas = want;
      }
      /* scale old ReplicaSets down only while availability stays above want - maxUnavailable */
      var ready = rsFor(m, d).reduce(function (a, r) { return a + podsOf(m, r).filter(podReady).length; }, 0);
      var removable = ready - (want - unav);
      olds.forEach(function (r) {
        if (r.replicas <= 0) return;
        var oldReady = podsOf(m, r).filter(podReady).length;
        var oldNotReady = r.replicas - oldReady;
        var down = Math.min(r.replicas, Math.max(0, removable) + oldNotReady);
        if (!cur.replicas && want === 0) down = r.replicas;
        if (down > 0) {
          event(m, 'Deployment', d, 'Normal', 'ScalingReplicaSet',
            'Scaled down replica set ' + r.name + ' from ' + r.replicas + ' to ' + (r.replicas - down), 'deployment-controller');
          r.replicas -= down;
          removable -= Math.max(0, down - oldNotReady);
        }
      });
      /* conditions */
      var newReady = podsOf(m, cur).filter(podReady).length;
      var complete = newReady >= want && cur.replicas === want &&
                     olds.every(function (r) { return r.replicas === 0; });
      var availableNow = ready >= want - unav;
      d.conditions.Available = availableNow ? 'True' : 'False';
      if (complete) {
        d.conditions.Progressing = 'NewReplicaSetAvailable';
        d.rolloutStart = null;
      } else if (d.rolloutStart != null && m.clock - d.rolloutStart > d.progressDeadline) {
        if (d.conditions.Progressing !== 'ProgressDeadlineExceeded') {
          event(m, 'Deployment', d, 'Warning', 'ProgressDeadlineExceeded',
            'Deployment "' + d.name + '" has timed out progressing.', 'deployment-controller');
        }
        d.conditions.Progressing = 'ProgressDeadlineExceeded';
      } else {
        d.conditions.Progressing = 'ReplicaSetUpdated';
      }
    });
  }

  function admissionDenied(m, tpl) {
    if (!m.policy || !m.policy.requireSignature) return null;
    var imgs = (tpl.containers || []).concat(tpl.initContainers || []).map(function (c) { return c.image; });
    for (var i = 0; i < imgs.length; i++) {
      var e = m.registry[imgs[i]];
      if (!e) continue; /* an unknown image fails at pull time, not at admission */
      if (!e.signedBy || m.trustedKeys.indexOf(e.signedBy) === -1) {
        return 'admission webhook "image-signatures.policy.lab" denied the request: image ' + imgs[i] +
               (e.signedBy ? ' is signed by "' + e.signedBy + '", which is not a trusted key' : ' has no signature');
      }
    }
    return null;
  }

  function replicaSetController(m) {
    /* a pod relabelled out of its owner's selector is released, not counted:
       the ReplicaSet makes a replacement and the orphan keeps running */
    m.pods.forEach(function (p) {
      if (!p.owner || p.gone) return;
      var rs = m.replicasets.filter(function (r) { return r.name === p.owner && r.ns === p.ns; })[0];
      var dep = rs ? find(m, 'deployments', rs.owner, rs.ns) : null;
      if (dep && dep.selector && !matches(dep.selector, p.labels)) { p.owner = null; p.ownerKind = null; }
    });
    m.replicasets.forEach(function (rs) {
      var pods = podsOf(m, rs);
      if (pods.length < rs.replicas) {
        var denied = admissionDenied(m, rs.template);
        if (denied) {
          event(m, 'ReplicaSet', rs, 'Warning', 'FailedCreate', 'Error creating: ' + denied, 'replicaset-controller');
          return;
        }
        for (var i = pods.length; i < rs.replicas; i++) {
          var p = createPod(m, { labels: clone(rs.template.labels), spec: clone(rs.template) }, rs);
          event(m, 'ReplicaSet', rs, 'Normal', 'SuccessfulCreate', 'Created pod: ' + p.name, 'replicaset-controller');
        }
      } else if (pods.length > rs.replicas) {
        /* delete not-ready and newest pods first, as the real controller prefers */
        pods.sort(function (a, b) {
          if (podReady(a) !== podReady(b)) return podReady(a) ? 1 : -1;
          return b.created - a.created;
        });
        pods.slice(0, pods.length - rs.replicas).forEach(function (p) {
          event(m, 'ReplicaSet', rs, 'Normal', 'SuccessfulDelete', 'Deleted pod: ' + p.name, 'replicaset-controller');
          removePod(m, p);
        });
      }
    });
  }

  function createPod(m, def, rs) {
    var spec = def.spec || def.template || {};
    var name = def.name || ((rs ? rs.name : 'pod') + '-' + suffix(m, rs ? rs.name : 'pod'));
    var sa = spec.serviceAccount || 'default';
    var saObj = find(m, 'serviceaccounts', sa, def.ns || m.ns);
    var pull = (spec.imagePullSecrets || []).slice();
    if (saObj && saObj.imagePullSecrets) {
      saObj.imagePullSecrets.forEach(function (s) { if (pull.indexOf(s) === -1) pull.push(s); });
    }
    var p = {
      name: name, ns: def.ns || m.ns, owner: rs ? rs.name : null, ownerKind: rs ? 'ReplicaSet' : null,
      labels: clone(def.labels || spec.labels || {}), spec: clone(spec), node: def.node || null,
      phase: def.phase || 'Pending', ready: false, created: m.clock, uid: 'uid-' + (++m.seq),
      ip: null, pullSecrets: pull, serviceAccount: sa, fixedStatus: def.fixedStatus || null,
      init: (spec.initContainers || []).map(function (c) { return containerState(c, true); }),
      containers: (spec.containers || []).map(function (c) { return containerState(c, false); })
    };
    m.pods.push(p);
    return p;
  }
  function containerState(c, init) {
    return { name: c.name, image: c.image, init: init, state: 'waiting', reason: 'ContainerCreating',
             restarts: 0, lastState: null, startedAt: null, endAt: null, endReason: null, endCode: null,
             backoffUntil: 0, done: false, logs: [], prevLogs: null };
  }
  function removePod(m, p) {
    p.gone = true;
    m.pods = m.pods.filter(function (x) { return x !== p; });
  }

  /* ── scheduler ───────────────────────────────────────────────── */
  function requestsOf(spec) {
    var cpu = 0, mem = 0;
    (spec.containers || []).forEach(function (c) {
      var r = (c.resources || {}).requests || {};
      cpu += cpuMilli(r.cpu) || 0; mem += memMi(r.memory) || 0;
    });
    return { cpu: cpu, mem: mem };
  }
  function allocated(m, node) {
    var cpu = 0, mem = 0;
    m.pods.forEach(function (p) {
      if (p.node !== node.name || p.phase === 'Succeeded' || p.phase === 'Failed') return;
      var r = requestsOf(p.spec); cpu += r.cpu; mem += r.mem;
    });
    return { cpu: cpu, mem: mem };
  }
  function tolerates(spec, taint) {
    return (spec.tolerations || []).some(function (t) {
      if (t.operator === 'Exists') return !t.key || t.key === taint.key;
      return t.key === taint.key && (t.value || '') === (taint.value || '') && (!t.effect || t.effect === taint.effect);
    });
  }
  function claimsOf(m, p) {
    return (p.spec.volumes || []).filter(function (v) { return v.pvc; }).map(function (v) {
      return { vol: v, claim: find(m, 'pvcs', v.pvc, p.ns) };
    });
  }
  function scheduler(m) {
    m.pods.forEach(function (p) {
      if (p.node || p.gone || p.fixedStatus) return;
      /* storage first: an unbound Immediate claim stops scheduling outright */
      var claims = claimsOf(m, p), blocker = null;
      claims.forEach(function (c) {
        if (blocker) return;
        if (!c.claim) { blocker = 'persistentvolumeclaim "' + c.vol.pvc + '" not found'; return; }
        if (c.claim.phase === 'Bound') return;
        var sc = storageClassFor(m, c.claim);
        if (!sc || sc.bindingMode !== 'WaitForFirstConsumer') blocker = 'pod has unbound immediate PersistentVolumeClaims';
      });
      var reasons = {}, fit = null, nodes = m.nodes.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      var req = requestsOf(p.spec);
      if (!blocker) {
        nodes.forEach(function (n) {
          var why = null;
          if (!n.ready) why = "node(s) had untolerated taint {node.kubernetes.io/not-ready: }";
          else if (n.unschedulable) why = 'node(s) were unschedulable';
          else if (p.spec.nodeSelector && !matches(p.spec.nodeSelector, n.labels)) why = "node(s) didn't match Pod's node affinity/selector";
          else {
            var bad = (n.taints || []).filter(function (t) { return t.effect !== 'PreferNoSchedule' && !tolerates(p.spec, t); })[0];
            if (bad) why = 'node(s) had untolerated taint {' + bad.key + ': ' + (bad.value || '') + '}';
            else {
              var a = allocated(m, n);
              if (a.mem + req.mem > n.mem) why = 'Insufficient memory';
              else if (a.cpu + req.cpu > n.cpu) why = 'Insufficient cpu';
            }
          }
          if (why) reasons[why] = (reasons[why] || 0) + 1;
          else if (!fit) fit = n;
        });
      }
      if (fit) {
        p.node = fit.name;
        p.ip = '10.244.' + (1 + m.nodes.indexOf(fit)) + '.' + (10 + (fnv(p.name) % 200));
        event(m, 'Pod', p, 'Normal', 'Scheduled', 'Successfully assigned ' + p.ns + '/' + p.name + ' to ' + fit.name, 'default-scheduler');
        claims.forEach(function (c) { if (c.claim && c.claim.phase !== 'Bound') provision(m, c.claim, fit); });
      } else {
        var parts = blocker ? [blocker] : Object.keys(reasons).sort().map(function (k) { return reasons[k] + ' ' + k; });
        var msg = '0/' + m.nodes.length + ' nodes are available: ' + parts.join(', ') +
                  '. preemption: 0/' + m.nodes.length + ' nodes are available: ' + m.nodes.length +
                  ' Preemption is not helpful for scheduling.';
        if (blocker) msg = blocker + '. preemption: not attempted.';
        p.scheduleMsg = msg;
        event(m, 'Pod', p, 'Warning', 'FailedScheduling', msg, 'default-scheduler');
      }
    });
  }

  /* ── storage ─────────────────────────────────────────────────── */
  function storageClassFor(m, claim) {
    if (claim.storageClassName) return find(m, 'storageclasses', claim.storageClassName);
    return m.storageclasses.filter(function (s) { return s.default; })[0] || null;
  }
  function provision(m, claim, node) {
    var sc = storageClassFor(m, claim);
    if (!sc) return;
    var pv = { name: 'pvc-' + hashOf(claim.ns + '/' + claim.name + (++m.pvSeq)).slice(0, 8) + '-' + claim.name,
               capacity: claim.request || '1Gi', claim: claim.ns + '/' + claim.name, storageClassName: sc.name,
               reclaimPolicy: sc.reclaimPolicy || 'Delete', phase: 'Bound', created: m.clock,
               node: node ? node.name : null };
    m.pvs.push(pv);
    claim.phase = 'Bound'; claim.volume = pv.name;
    claim.storageClassName = claim.storageClassName || sc.name;
    event(m, 'PersistentVolumeClaim', claim, 'Normal', 'ProvisioningSucceeded',
      'Successfully provisioned volume ' + pv.name, sc.provisioner || 'provisioner');
  }
  function binder(m) {
    m.pvcs.forEach(function (c) {
      if (c.phase === 'Bound' || c.gone) return;
      var sc = storageClassFor(m, c);
      if (!sc) {
        if (c.storageClassName) {
          event(m, 'PersistentVolumeClaim', c, 'Warning', 'ProvisioningFailed',
            'storageclass.storage.k8s.io "' + c.storageClassName + '" not found', 'persistentvolume-controller');
        } else {
          event(m, 'PersistentVolumeClaim', c, 'Normal', 'FailedBinding',
            'no persistent volumes available for this claim and no storage class is set', 'persistentvolume-controller');
        }
        return;
      }
      if (sc.bindingMode === 'WaitForFirstConsumer') {
        event(m, 'PersistentVolumeClaim', c, 'Normal', 'WaitForFirstConsumer',
          'waiting for first consumer to be created before binding', 'persistentvolume-controller');
        return;
      }
      provision(m, c, null);
    });
  }

  /* ── kubelet ─────────────────────────────────────────────────── */
  function profileFor(m, image) {
    var apps = m.apps || {};
    if (apps[image]) return Object.assign({}, apps[image.split(':')[0]] || {}, apps[image]);
    var repo = image.replace(/@sha256:.*$/, '').replace(/:[^/]*$/, '');
    if (apps[repo]) return apps[repo];
    return { port: 8080, readyPath: '/', livePath: '/', startSec: 3, memMi: 48, boot: ['started'] };
  }
  function envFor(m, p, c) {
    var env = {}, missing = null;
    (c.envFrom || []).forEach(function (f) {
      if (missing) return;
      var src = f.configMapRef ? find(m, 'configmaps', f.configMapRef, p.ns)
                               : find(m, 'secrets', f.secretRef, p.ns);
      if (!src) {
        if (!f.optional) missing = (f.configMapRef ? 'configmap "' + f.configMapRef : 'secret "' + f.secretRef) + '" not found';
        return;
      }
      Object.keys(src.data || {}).forEach(function (k) { env[k] = src.data[k]; });
    });
    (c.env || []).forEach(function (e) {
      if (missing) return;
      if (e.value != null) { env[e.name] = e.value; return; }
      var ref = e.configMapKey || e.secretKey;
      if (!ref) return;
      var src = e.configMapKey ? find(m, 'configmaps', ref.name, p.ns) : find(m, 'secrets', ref.name, p.ns);
      if (!src) { if (!ref.optional) missing = (e.configMapKey ? 'configmap "' : 'secret "') + ref.name + '" not found'; return; }
      if (!(ref.key in (src.data || {}))) {
        if (!ref.optional) missing = "couldn't find key " + ref.key + ' in ' + (e.configMapKey ? 'ConfigMap ' : 'Secret ') + p.ns + '/' + ref.name;
        return;
      }
      env[e.name] = src.data[ref.key];
    });
    return { env: env, missing: missing };
  }
  function pullProblem(m, p, image) {
    var node = find(m, 'nodes', p.node);
    var host = image.indexOf('/') > 0 && /[.:]/.test(image.split('/')[0]) ? image.split('/')[0] : 'docker.io';
    if (m.reachable && m.reachable.indexOf(host) === -1) {
      return 'failed to pull and unpack image "' + image + '": failed to resolve reference "' + image +
             '": failed to do request: Head "https://' + host + '/v2/": dial tcp: lookup ' + host + ': no such host';
    }
    var e = m.registry[image];
    if (!e) {
      return 'failed to pull and unpack image "' + image + '": failed to resolve reference "' + image + '": ' +
             image + ': not found';
    }
    var need = null;
    Object.keys(m.registryAuth).forEach(function (prefix) { if (image.indexOf(prefix) === 0) need = m.registryAuth[prefix]; });
    if (need) {
      var has = p.pullSecrets.indexOf(need) !== -1 && find(m, 'secrets', need, p.ns);
      if (!has) {
        return 'failed to pull and unpack image "' + image + '": failed to resolve reference "' + image +
               '": pull access denied, repository does not exist or may require authorization: ' +
               'authorization failed: 401 Unauthorized';
      }
    }
    if (node && e.arch && e.arch.indexOf(node.arch) === -1) {
      return 'failed to pull and unpack image "' + image + '": no match for platform in manifest: not found';
    }
    return null;
  }
  function probeOk(probe, prof) {
    if (!probe) return true;
    var port = probe.port == null ? prof.port : probe.port;
    if (port !== prof.port && String(port) !== String(prof.namedPort || '')) return false;
    if (probe.exec) return true;
    var want = probe.kind === 'readiness' ? prof.readyPath : prof.livePath;
    return probe.path == null || probe.path === want;
  }

  /* One container instance: decide at start what this run will do, so that
     restart counts and states fall out of time rather than being stored. */
  function startInstance(m, p, c, spec) {
    var prof = profileFor(m, c.image), envr = envFor(m, p, spec), lim = ((spec.resources || {}).limits) || {};
    var limit = memMi(lim.memory), use = prof.memMi || 48;
    c.startedAt = m.clock; c.state = 'running'; c.reason = null; c.endAt = null;
    c.prevLogs = c.logs.length ? c.logs : c.prevLogs;
    c.logs = (prof.boot || ['started']).map(function (l) { return String(l).replace('{port}', prof.port); });
    var missingEnv = (prof.requiresEnv || []).filter(function (k) { return !(k in envr.env) || envr.env[k] === ''; });
    if (missingEnv.length) {
      c.endAt = m.clock + (prof.crashAfter || 2); c.endReason = 'Error'; c.endCode = prof.crashCode || 1;
      c.logs.push((prof.missingEnvLog || 'FATAL: required setting {key} is not set; refusing to start').replace('{key}', missingEnv[0]));
      return;
    }
    if (limit != null && use > limit) {
      c.endAt = m.clock + (prof.oomAfter || 40); c.endReason = 'OOMKilled'; c.endCode = 137;
      (prof.workLogs || []).forEach(function (l) { c.logs.push(l); });
      return;
    }
    var live = spec.liveness ? Object.assign({ kind: 'liveness' }, spec.liveness) : null;
    if (live) {
      var initial = live.initialDelay == null ? 0 : live.initialDelay;
      var period = live.period || 10, fails = live.failureThreshold || 3;
      var liveBad = !probeOk(live, prof) || (prof.startSec || 3) > initial + period * fails;
      if (liveBad) {
        var grace = prof.ignoresSigterm ? 30 : 0;
        c.endAt = m.clock + initial + period * fails + grace;
        c.endReason = 'Error'; c.endCode = prof.ignoresSigterm ? 137 : 143;
        c.killedByLiveness = true;
        c.probeWhy = !probeOk(live, prof)
          ? 'HTTP probe failed with statuscode: 404'
          : 'Get "http://' + p.ip + ':' + prof.port + (live.path || '/') + '": dial tcp ' + p.ip + ':' + prof.port + ': connect: connection refused';
        return;
      }
    }
    c.killedByLiveness = false;
    (prof.runLogs || []).forEach(function (l) { c.logs.push(l); });
  }

  function kubelet(m) {
    m.pods.forEach(function (p) {
      if (!p.node || p.gone) return;
      if (p.fixedStatus) { p.phase = p.fixedStatus.phase || p.phase; p.ready = !!p.fixedStatus.ready; return; }
      var spec = p.spec;
      /* init containers run to completion first */
      for (var i = 0; i < p.init.length; i++) {
        var ic = p.init[i];
        if (ic.done) continue;
        var ispec = (spec.initContainers || [])[i];
        if (!stepContainer(m, p, ic, ispec, true)) { p.phase = 'Pending'; p.ready = false; return; }
      }
      var allRunning = true, allReady = true;
      p.containers.forEach(function (c, idx) {
        var cs = spec.containers[idx];
        stepContainer(m, p, c, cs, false);
        if (c.state !== 'running') { allRunning = false; allReady = false; return; }
        var prof = profileFor(m, c.image);
        var up = m.clock - c.startedAt >= (prof.startSec || 3);
        var rp = cs.readiness ? Object.assign({ kind: 'readiness' }, cs.readiness) : null;
        c.ready = up && probeOk(rp, prof) && !(prof.readyOnlyWhenApiOk && !apiOk(m, p, prof));
        if (up && rp && !probeOk(rp, prof)) {
          event(m, 'Pod', p, 'Warning', 'Unhealthy', 'Readiness probe failed: HTTP probe failed with statuscode: 404');
        }
        if (!c.ready) allReady = false;
        /* apps that call the Kubernetes API log each sync */
        if (up && prof.needsApi) {
          var tick = Math.floor((m.clock - c.startedAt) / 30);
          if (tick !== c.lastSync) {
            c.lastSync = tick;
            c.logs.push(apiOk(m, p, prof) ? (prof.apiOkLog || 'sync ok')
              : 'ERROR ' + forbiddenMsg(saSubject(p), prof.needsApi.verb, prof.needsApi.resource, p.ns));
            if (c.logs.length > 40) c.logs.splice(3, c.logs.length - 40);
          }
        }
      });
      p.phase = allRunning || p.containers.some(function (c) { return c.restarts > 0 || c.state === 'running'; }) ? 'Running' : 'Pending';
      if (p.containers.some(function (c) { return c.restarts > 0 || c.lastState; })) p.phase = 'Running';
      p.ready = allRunning && allReady;
    });
  }

  function stepContainer(m, p, c, spec, isInit) {
    if (c.state === 'waiting' && m.clock < c.backoffUntil) return false;
    if (c.state === 'waiting') {
      var pull = pullProblem(m, p, c.image);
      if (pull) {
        c.reason = c.reason === 'ErrImagePull' || c.reason === 'ImagePullBackOff' ? 'ImagePullBackOff' : 'ErrImagePull';
        c.pullMsg = pull;
        c.pullFails = (c.pullFails || 0) + 1;
        c.backoffUntil = m.clock + Math.min(300, 10 * Math.pow(2, Math.min(5, c.pullFails - 1)));
        event(m, 'Pod', p, 'Warning', 'Failed', 'Failed to pull image "' + c.image + '": ' + pull);
        event(m, 'Pod', p, 'Normal', 'BackOff', 'Back-off pulling image "' + c.image + '"');
        return false;
      }
      var envr = envFor(m, p, spec);
      if (envr.missing) {
        c.reason = 'CreateContainerConfigError'; c.configMsg = envr.missing;
        c.backoffUntil = m.clock + 10;
        event(m, 'Pod', p, 'Warning', 'Failed', 'Error: ' + envr.missing);
        return false;
      }
      if (!c.pulled) {
        c.pulled = true;
        event(m, 'Pod', p, 'Normal', 'Pulled', 'Container image "' + c.image + '" already present on machine');
      }
      startInstance(m, p, c, spec);
      event(m, 'Pod', p, 'Normal', 'Started', 'Started container ' + c.name);
      if (isInit) { c.endAt = m.clock + 3; c.endReason = 'Completed'; c.endCode = 0; }
    }
    if (c.state === 'running' && c.endAt != null && m.clock >= c.endAt) {
      if (isInit && c.endCode === 0) { c.done = true; c.state = 'terminated'; c.reason = 'Completed'; return true; }
      if (c.killedByLiveness) {
        event(m, 'Pod', p, 'Warning', 'Unhealthy', 'Liveness probe failed: ' + c.probeWhy);
        event(m, 'Pod', p, 'Normal', 'Killing', 'Container ' + c.name + ' failed liveness probe, will be restarted');
      }
      c.lastState = { reason: c.endReason, exitCode: c.endCode, started: c.startedAt, finished: m.clock };
      c.prevLogs = c.logs; c.logs = [];
      c.restarts++;
      c.state = 'waiting'; c.reason = 'CrashLoopBackOff';
      c.backoffUntil = m.clock + Math.min(300, 10 * Math.pow(2, Math.min(5, c.restarts - 1)));
      event(m, 'Pod', p, 'Warning', 'BackOff', 'Back-off restarting failed container ' + c.name + ' in pod ' + p.name);
      return false;
    }
    return c.state === 'running' || c.done;
  }

  /* ── RBAC ────────────────────────────────────────────────────── */
  function saSubject(p) { return 'system:serviceaccount:' + p.ns + ':' + (p.serviceAccount || 'default'); }
  function forbiddenMsg(subject, verb, resource, ns) {
    return resource + ' is forbidden: User "' + subject + '" cannot ' + verb + ' resource "' + resource +
           '" in API group "" in the namespace "' + ns + '"';
  }
  function subjectMatches(s, subject, bindingNs) {
    if (s.kind === 'User') return s.name === subject;
    if (s.kind === 'Group') return s.name === 'system:authenticated' ||
      (s.name === 'system:serviceaccounts' && subject.indexOf('system:serviceaccount:') === 0);
    if (s.kind === 'ServiceAccount') {
      return subject === 'system:serviceaccount:' + (s.namespace || bindingNs) + ':' + s.name;
    }
    return false;
  }
  function rulesAllow(rules, verb, resource) {
    return (rules || []).some(function (r) {
      var verbs = r.verbs || [], res = r.resources || [];
      return (verbs.indexOf('*') !== -1 || verbs.indexOf(verb) !== -1) &&
             (res.indexOf('*') !== -1 || res.indexOf(resource) !== -1);
    });
  }
  function canI(m, subject, verb, resource, ns) {
    if (!subject || subject === m.user) return true; /* the lab operator is an admin in the lab */
    var ok = false;
    m.clusterrolebindings.forEach(function (b) {
      if (b.gone || ok) return;
      if (!(b.subjects || []).some(function (s) { return subjectMatches(s, subject, undefined); })) return;
      var role = find(m, 'clusterroles', b.roleRef.name);
      if (role && rulesAllow(role.rules, verb, resource)) ok = true;
    });
    m.rolebindings.forEach(function (b) {
      if (b.gone || ok || b.ns !== ns) return;
      if (!(b.subjects || []).some(function (s) { return subjectMatches(s, subject, b.ns); })) return;
      var role = b.roleRef.kind === 'ClusterRole' ? find(m, 'clusterroles', b.roleRef.name)
                                                   : find(m, 'roles', b.roleRef.name, b.ns);
      if (role && rulesAllow(role.rules, verb, resource)) ok = true;
    });
    return ok;
  }
  function apiOk(m, p, prof) {
    return canI(m, saSubject(p), prof.needsApi.verb, prof.needsApi.resource, p.ns);
  }

  /* ── one controller pass ─────────────────────────────────────── */
  function reconcile(m) {
    deploymentController(m);
    replicaSetController(m);
    binder(m);
    scheduler(m);
    kubelet(m);
    /* a second deployment pass lets a newly-Ready pod release an old one in
       the same instant, which is how the real controllers appear from outside */
    deploymentController(m);
    replicaSetController(m);
  }
  /* Move logical time forward, reconciling as it goes. */
  function advance(m, seconds) {
    var target = m.clock + seconds;
    while (m.clock < target) { m.clock = Math.min(target, m.clock + STEP); reconcile(m); }
  }

  /* ── derived reads ───────────────────────────────────────────── */
  function endpoints(m, svc) {
    var ready = [], notReady = [];
    if (!svc.selector || !Object.keys(svc.selector).length) return { ready: ready, notReady: notReady, port: null };
    m.pods.forEach(function (p) {
      if (p.ns !== svc.ns || p.gone || !p.node || !matches(svc.selector, p.labels)) return;
      (podReady(p) ? ready : notReady).push(p);
    });
    var sp = (svc.ports || [])[0] || {};
    return { ready: ready, notReady: notReady, port: resolveTarget(m, sp, ready[0] || notReady[0]) };
  }
  function resolveTarget(m, sp, p) {
    var t = sp.targetPort == null ? sp.port : sp.targetPort;
    if (typeof t === 'number' || /^\d+$/.test(String(t))) return Number(t);
    if (!p) return t;
    var hit = null;
    (p.spec.containers || []).forEach(function (c) {
      (c.ports || []).forEach(function (cp) { if (cp.name === t) hit = cp.containerPort; });
    });
    return hit == null ? t : hit;
  }
  function rolloutComplete(m, name, ns) {
    var d = find(m, 'deployments', name, ns || m.ns);
    return !!d && d.conditions.Progressing === 'NewReplicaSetAvailable';
  }
  function risky(m, cmd, why) { m.risky.push({ cmd: cmd, why: why, at: m.clock }); }

  var api = {
    STEP: STEP, PER_COMMAND: PER_COMMAND,
    create: create, reconcile: reconcile, advance: advance, find: find, event: event,
    setTemplate: setTemplate, removePod: removePod, createPod: createPod, rsFor: rsFor, podsOf: podsOf,
    podReady: podReady, endpoints: endpoints, resolveTarget: resolveTarget, rolloutComplete: rolloutComplete,
    canI: canI, forbiddenMsg: forbiddenMsg, saSubject: saSubject, profileFor: profileFor, envFor: envFor,
    requestsOf: requestsOf, allocated: allocated, storageClassFor: storageClassFor, provision: provision,
    matches: matches, memMi: memMi, cpuMilli: cpuMilli, age: age, clone: clone, hashOf: hashOf,
    templateHash: templateHash, risky: risky, pullProblem: pullProblem
  };
  root.LXK8s = Object.assign(root.LXK8s || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LXK8s;
})(typeof window !== 'undefined' ? window : globalThis);
