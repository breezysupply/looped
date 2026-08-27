/* Containers track — kubectl and docker against a simulated cluster.

   Registered through LXShell.register(), which is why that API exists: the
   engine stays a Linux shell and a track adds its own verbs.

   The world gains a `k8s` object. Everything is derived from it at read time
   rather than stored twice — endpoints come from matching Service selectors
   against pod labels and readiness, so relabelling a pod really does change
   what `kubectl get endpoints` prints. */
(function () {
  'use strict';
  if (typeof LXShell === 'undefined' || !LXShell.register) return;

  var U = LXShell.util;
  var ok = U.ok, err = U.err, pad = U.pad;

  /* ── helpers over the world ──────────────────────────────────── */
  function K(w) { return w.k8s || (w.k8s = { namespace: 'default', pods: [], nodes: [] }); }
  function ns(w, a) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] === '-n' || a[i] === '--namespace') return a[i + 1];
      if (a[i].indexOf('--namespace=') === 0) return a[i].slice(12);
    }
    return a.indexOf('-A') !== -1 || a.indexOf('--all-namespaces') !== -1 ? null : K(w).namespace;
  }
  function has(a, f) { return a.indexOf(f) !== -1; }
  function flagVal(a, names) {
    for (var i = 0; i < a.length; i++) {
      for (var j = 0; j < names.length; j++) {
        if (a[i] === names[j]) return a[i + 1];
        if (a[i].indexOf(names[j] + '=') === 0) return a[i].slice(names[j].length + 1);
      }
    }
    return null;
  }
  /* Flags that take a separate value; without this, `-n payments` makes
     "payments" look like a positional and the pod name is read from the
     wrong slot. */
  var VALUED = ['-n', '--namespace', '-l', '--selector', '-o', '--output', '-c', '--container',
                '--tail', '--since', '--limits', '--requests', '--image', '--timeout',
                '--field-selector', '--sort-by', '-L'];
  function positional(a) {
    var out = [], stop = a.indexOf('--');
    for (var i = 0; i < (stop === -1 ? a.length : stop); i++) {
      if (VALUED.indexOf(a[i]) !== -1) { i++; continue; }
      if (a[i].charAt(0) === '-') continue;
      out.push(a[i]);
    }
    return out;
  }

  function inNs(list, n) {
    return (list || []).filter(function (x) { return n === null || (x.ns || 'default') === n; });
  }
  function selectorMatches(sel, labels) {
    if (!sel) return false;
    var keys = Object.keys(sel);
    if (!keys.length) return false;
    return keys.every(function (k) { return (labels || {})[k] === sel[k]; });
  }
  /* Endpoints are derived: a pod counts when it matches the selector AND is
     ready. That is the whole lesson of the Service tree, so it must be real. */
  function endpointsOf(w, svc) {
    return inNs(K(w).pods, svc.ns || 'default').filter(function (p) {
      return p.status === 'Running' && p.ready !== false && selectorMatches(svc.selector, p.labels);
    });
  }
  function parseLabelSel(str) {
    var out = {};
    String(str || '').split(',').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    });
    return out;
  }
  function podReadyStr(p) {
    var n = (p.containers || [{}]).length;
    return (p.ready === false ? 0 : n) + '/' + n;
  }
  function ageOf(x) { return x.age || '12m'; }
  function event(w, obj, type, reason, msg) {
    K(w).events = K(w).events || [];
    K(w).events.push({ ns: obj.ns || 'default', obj: obj.kind + '/' + obj.name,
                       type: type, reason: reason, msg: msg, age: '1s' });
  }

  /* ── kubectl get ─────────────────────────────────────────────── */
  var GET = {};

  GET.pods = function (w, a, n) {
    var wide = flagVal(a, ['-o', '--output']) === 'wide';
    var sel = flagVal(a, ['-l', '--selector']);
    var list = inNs(K(w).pods, n);
    if (sel) {
      var want = parseLabelSel(sel);
      list = list.filter(function (p) { return selectorMatches(want, p.labels); });
    }
    if (!list.length) return ok('No resources found' + (n ? ' in ' + n + ' namespace' : '') + '.\n');
    var labels = has(a, '--show-labels');
    var head = (n === null ? pad('NAMESPACE', 14, true) : '') + pad('NAME', 26, true) +
      pad('READY', 7, true) + pad('STATUS', 20, true) + pad('RESTARTS', 10, true) + pad('AGE', 7, true) +
      (wide ? pad('IP', 14, true) + pad('NODE', 16, true) : '') + (labels ? 'LABELS' : '');
    return ok(head + '\n' + list.map(function (p) {
      return (n === null ? pad(p.ns || 'default', 14, true) : '') + pad(p.name, 26, true) +
        pad(podReadyStr(p), 7, true) + pad(p.status, 20, true) +
        pad(String(p.restarts || 0), 10, true) + pad(ageOf(p), 7, true) +
        (wide ? pad(p.ip || '<none>', 14, true) + pad(p.node || '<none>', 16, true) : '') +
        (labels ? Object.keys(p.labels || {}).map(function (k) {
          return k + '=' + p.labels[k]; }).join(',') : '');
    }).join('\n') + '\n');
  };

  GET.nodes = function (w, a) {
    var list = K(w).nodes || [];
    if (!list.length) return ok('No resources found.\n');
    var showZone = has(a, '-L') || String(a.join(' ')).indexOf('topology.kubernetes.io/zone') !== -1;
    return ok(pad('NAME', 20, true) + pad('STATUS', 12, true) + pad('ROLES', 10, true) +
      pad('AGE', 7, true) + pad('VERSION', 10, true) + (showZone ? 'ZONE' : '') + '\n' +
      list.map(function (x) {
        return pad(x.name, 20, true) + pad(x.status, 12, true) + pad(x.roles || '<none>', 10, true) +
          pad(x.age || '40d', 7, true) + pad(x.version || 'v1.30.4', 10, true) +
          (showZone ? (x.zone || '') : '');
      }).join('\n') + '\n');
  };

  GET.services = function (w, a, n) {
    var list = inNs(K(w).services, n);
    if (!list.length) return ok('No resources found.\n');
    return ok((n === null ? pad('NAMESPACE', 14, true) : '') + pad('NAME', 18, true) +
      pad('TYPE', 14, true) + pad('CLUSTER-IP', 16, true) + pad('PORT(S)', 14, true) + 'AGE\n' +
      list.map(function (s) {
        return (n === null ? pad(s.ns || 'default', 14, true) : '') + pad(s.name, 18, true) +
          pad(s.type || 'ClusterIP', 14, true) + pad(s.clusterIP || '10.96.0.1', 16, true) +
          pad(s.portStr || (s.port + '/TCP'), 14, true) + (s.age || '20d');
      }).join('\n') + '\n');
  };

  GET.endpoints = function (w, a, n) {
    var list = inNs(K(w).services, n);
    if (!list.length) return ok('No resources found.\n');
    return ok(pad('NAME', 18, true) + pad('ENDPOINTS', 40, true) + 'AGE\n' +
      list.map(function (s) {
        var eps = endpointsOf(w, s).map(function (p) { return (p.ip || '10.0.0.1') + ':' + (s.targetPort || s.port); });
        return pad(s.name, 18, true) + pad(eps.length ? eps.join(',') : '<none>', 40, true) + (s.age || '20d');
      }).join('\n') + '\n');
  };

  GET.deployments = function (w, a, n) {
    var list = inNs(K(w).deployments, n);
    if (!list.length) return ok('No resources found.\n');
    return ok(pad('NAME', 18, true) + pad('READY', 8, true) + pad('UP-TO-DATE', 12, true) +
      pad('AVAILABLE', 11, true) + 'AGE\n' +
      list.map(function (d) {
        var pods = inNs(K(w).pods, d.ns || 'default').filter(function (p) {
          return selectorMatches(d.selector, p.labels);
        });
        var ready = pods.filter(function (p) { return p.status === 'Running' && p.ready !== false; }).length;
        return pad(d.name, 18, true) + pad(ready + '/' + (d.replicas || pods.length), 8, true) +
          pad(String(d.replicas || pods.length), 12, true) + pad(String(ready), 11, true) + (d.age || '20d');
      }).join('\n') + '\n');
  };

  GET.events = function (w, a, n) {
    var list = inNs(K(w).events, n);
    if (has(a, '--types=Warning')) list = list.filter(function (e) { return e.type === 'Warning'; });
    if (!list.length) return ok('No events found.\n');
    return ok(pad('LAST SEEN', 11, true) + pad('TYPE', 9, true) + pad('REASON', 20, true) +
      pad('OBJECT', 28, true) + 'MESSAGE\n' +
      list.map(function (e) {
        return pad(e.age || '2m', 11, true) + pad(e.type, 9, true) + pad(e.reason, 20, true) +
          pad(e.obj, 28, true) + e.msg;
      }).join('\n') + '\n');
  };

  GET.pvc = function (w, a, n) {
    var list = inNs(K(w).pvcs, n);
    if (!list.length) return ok('No resources found.\n');
    return ok(pad('NAME', 22, true) + pad('STATUS', 10, true) + pad('VOLUME', 16, true) +
      pad('CAPACITY', 10, true) + pad('STORAGECLASS', 14, true) + 'AGE\n' +
      list.map(function (c) {
        return pad(c.name, 22, true) + pad(c.status, 10, true) + pad(c.volume || '', 16, true) +
          pad(c.capacity || '', 10, true) + pad(c.storageClass || '<unset>', 14, true) + (c.age || '5m');
      }).join('\n') + '\n');
  };

  GET.netpol = function (w, a, n) {
    var list = inNs(K(w).netpols, n);
    if (!list.length) return ok('No resources found.\n');
    return ok(pad('NAME', 24, true) + 'POD-SELECTOR\n' +
      list.map(function (p) {
        var s = p.podSelector && Object.keys(p.podSelector).length
          ? Object.keys(p.podSelector).map(function (k) { return k + '=' + p.podSelector[k]; }).join(',')
          : '<none>';
        return pad(p.name, 24, true) + s;
      }).join('\n') + '\n');
  };

  var ALIAS = { po: 'pods', pod: 'pods', pods: 'pods', no: 'nodes', node: 'nodes', nodes: 'nodes',
                svc: 'services', service: 'services', services: 'services',
                ep: 'endpoints', endpoints: 'endpoints', endpoint: 'endpoints',
                deploy: 'deployments', deployment: 'deployments', deployments: 'deployments',
                ev: 'events', event: 'events', events: 'events',
                pvc: 'pvc', persistentvolumeclaims: 'pvc',
                netpol: 'netpol', networkpolicy: 'netpol', networkpolicies: 'netpol' };

  /* ── kubectl describe ────────────────────────────────────────── */
  function describePod(w, p) {
    var c = (p.containers || [{}])[0];
    var out = 'Name:             ' + p.name + '\n' +
      'Namespace:        ' + (p.ns || 'default') + '\n' +
      'Node:             ' + (p.node || '<none>') + '\n' +
      'Status:           ' + p.status + '\n' +
      'IP:               ' + (p.ip || '<none>') + '\n' +
      'Labels:           ' + Object.keys(p.labels || {}).map(function (k) {
        return k + '=' + p.labels[k]; }).join('\n                  ') + '\n' +
      'Containers:\n  ' + (c.name || p.name) + ':\n' +
      '    Image:        ' + (c.image || 'unknown') + '\n' +
      '    State:        ' + (c.state || 'Running') + '\n';
    if (c.lastState) {
      out += '    Last State:   Terminated\n' +
             '      Reason:     ' + c.lastState + '\n' +
             '      Exit Code:  ' + (c.exitCode != null ? c.exitCode : 1) + '\n';
    }
    out += '    Ready:        ' + (p.ready === false ? 'False' : 'True') + '\n' +
      '    Restart Count: ' + (p.restarts || 0) + '\n';
    if (c.limits) out += '    Limits:\n      memory:     ' + c.limits + '\n';
    if (c.requests) out += '    Requests:\n      memory:     ' + c.requests + '\n';
    if (c.probe) out += '    ' + c.probe + '\n';
    var evs = (K(w).events || []).filter(function (e) { return e.obj === 'pod/' + p.name; });
    out += 'Events:\n';
    out += evs.length
      ? '  Type     Reason            Age   Message\n' + evs.map(function (e) {
          return '  ' + pad(e.type, 9, true) + pad(e.reason, 18, true) + pad(e.age || '2m', 6, true) + e.msg;
        }).join('\n') + '\n'
      : '  <none>\n';
    return ok(out);
  }

  function describeSvc(w, s) {
    var eps = endpointsOf(w, s);
    return ok('Name:              ' + s.name + '\n' +
      'Namespace:         ' + (s.ns || 'default') + '\n' +
      'Selector:          ' + (s.selector ? Object.keys(s.selector).map(function (k) {
        return k + '=' + s.selector[k]; }).join(',') : '<none>') + '\n' +
      'Type:              ' + (s.type || 'ClusterIP') + '\n' +
      'IP:                ' + (s.clusterIP || '10.96.0.1') + '\n' +
      'Port:              ' + (s.portStr || (s.port + '/TCP')) + '\n' +
      'TargetPort:        ' + (s.targetPort || s.port) + '/TCP\n' +
      'Endpoints:         ' + (eps.length
        ? eps.map(function (p) { return (p.ip || '10.0.0.1') + ':' + (s.targetPort || s.port); }).join(',')
        : '<none>') + '\n');
  }

  function describeNode(w, nd) {
    var pods = (K(w).pods || []).filter(function (p) { return p.node === nd.name; });
    return ok('Name:               ' + nd.name + '\n' +
      'Roles:              ' + (nd.roles || '<none>') + '\n' +
      'Labels:             topology.kubernetes.io/zone=' + (nd.zone || 'us-east-1a') + '\n' +
      'Taints:             ' + (nd.taints && nd.taints.length ? nd.taints.join('\n                    ') : '<none>') + '\n' +
      'Unschedulable:      ' + (nd.unschedulable ? 'true' : 'false') + '\n' +
      'Conditions:\n' +
      '  Type             Status  Message\n' +
      (nd.conditions || [['Ready', nd.status === 'Ready' ? 'True' : 'False', 'kubelet is posting ready status']])
        .map(function (c) { return '  ' + pad(c[0], 17, true) + pad(c[1], 8, true) + (c[2] || ''); }).join('\n') + '\n' +
      'Capacity:\n  cpu:  ' + (nd.cpu || '4') + '\n  memory: ' + (nd.mem || '16Gi') + '\n' +
      'Allocated resources:\n' +
      '  Resource  Requests      Limits\n' +
      '  cpu       ' + pad(nd.reqCpu || '500m (12%)', 14, true) + (nd.limCpu || '1 (25%)') + '\n' +
      '  memory    ' + pad(nd.reqMem || '1Gi (6%)', 14, true) + (nd.limMem || '2Gi (12%)') + '\n' +
      'Non-terminated Pods:  (' + pods.length + ' in total)\n');
  }

  function describePvc(w, c) {
    var evs = (K(w).events || []).filter(function (e) { return e.obj === 'pvc/' + c.name; });
    return ok('Name:          ' + c.name + '\n' +
      'Namespace:     ' + (c.ns || 'default') + '\n' +
      'StorageClass:  ' + (c.storageClass || '') + '\n' +
      'Status:        ' + c.status + '\n' +
      'Volume:        ' + (c.volume || '') + '\n' +
      'Access Modes:  ' + (c.accessModes || 'RWO') + '\n' +
      'Events:\n' + (evs.length
        ? evs.map(function (e) { return '  ' + pad(e.type, 9, true) + pad(e.reason, 20, true) + e.msg; }).join('\n') + '\n'
        : '  <none>\n'));
  }

  /* ── the command ─────────────────────────────────────────────── */
  LXShell.register('kubectl', function (w, a) {
    var verb = a[0];
    var k = K(w);
    if (!verb) return err('kubectl controls the Kubernetes cluster manager.\n\nUsage: kubectl [command]');

    if (verb === 'get') {
      var kind = ALIAS[(a[1] || '').toLowerCase()];
      if (!kind) return err('error: the server doesn\'t have a resource type "' + (a[1] || '') + '"');
      var n = ns(w, a);
      var name = positional(a)[2] || null;
      if (name && kind === 'pods') {
        var one = (k.pods || []).filter(function (p) { return p.name === name; })[0];
        if (!one) return err('Error from server (NotFound): pods "' + name + '" not found');
      }
      return GET[kind](w, a, n);
    }

    if (verb === 'describe') {
      var pos = positional(a);
      var dk = ALIAS[(pos[1] || '').toLowerCase()];
      var dn = pos[2];
      if (!dk || !dn) return err('error: you must specify a resource type and name');
      var nn = ns(w, a);
      if (dk === 'pods') {
        var p = inNs(k.pods, nn).filter(function (x) { return x.name === dn; })[0];
        return p ? describePod(w, p) : err('Error from server (NotFound): pods "' + dn + '" not found');
      }
      if (dk === 'services') {
        var s = inNs(k.services, nn).filter(function (x) { return x.name === dn; })[0];
        return s ? describeSvc(w, s) : err('Error from server (NotFound): services "' + dn + '" not found');
      }
      if (dk === 'nodes') {
        var nd = (k.nodes || []).filter(function (x) { return x.name === dn; })[0];
        return nd ? describeNode(w, nd) : err('Error from server (NotFound): nodes "' + dn + '" not found');
      }
      if (dk === 'pvc') {
        var c = inNs(k.pvcs, nn).filter(function (x) { return x.name === dn; })[0];
        return c ? describePvc(w, c) : err('Error from server (NotFound): persistentvolumeclaims "' + dn + '" not found');
      }
      return err('describe is not implemented for ' + dk + ' here');
    }

    if (verb === 'logs') {
      var lname = positional(a)[1];
      var lp = (k.pods || []).filter(function (x) { return x.name === lname; })[0];
      if (!lp) return err('Error from server (NotFound): pods "' + (lname || '') + '" not found');
      var prev = has(a, '--previous') || has(a, '-p');
      var body = prev ? lp.prevLog : lp.log;
      if (prev && lp.prevLog == null) return err('Error from server (BadRequest): previous terminated container not found');
      return ok((body || '') + (body ? '\n' : ''));
    }

    if (verb === 'top') {
      var tk = ALIAS[(a[1] || '').toLowerCase()];
      if (tk === 'nodes') {
        return ok(pad('NAME', 20, true) + pad('CPU(cores)', 12, true) + pad('CPU%', 7, true) +
          pad('MEMORY(bytes)', 15, true) + 'MEMORY%\n' +
          (k.nodes || []).map(function (x) {
            return pad(x.name, 20, true) + pad(x.topCpu || '210m', 12, true) + pad(x.topCpuPct || '5%', 7, true) +
              pad(x.topMem || '1204Mi', 15, true) + (x.topMemPct || '7%');
          }).join('\n') + '\n');
      }
      var tn = ns(w, a);
      return ok(pad('NAME', 26, true) + pad('CPU(cores)', 12, true) + 'MEMORY(bytes)\n' +
        inNs(k.pods, tn).map(function (p) {
          return pad(p.name, 26, true) + pad(p.topCpu || '4m', 12, true) + (p.topMem || '64Mi');
        }).join('\n') + '\n');
    }

    /* ── state-changing verbs, so a mission can actually be solved ── */
    if (verb === 'label') {
      var lk = ALIAS[(a[1] || '').toLowerCase()];
      var ln = a[2];
      var pairs = a.slice(3).filter(function (x) { return x.indexOf('=') !== -1; });
      if (lk !== 'pods' || !ln || !pairs.length) return err('error: at least one label update is required');
      var target = (k.pods || []).filter(function (x) { return x.name === ln; })[0];
      if (!target) return err('Error from server (NotFound): pods "' + ln + '" not found');
      var over = has(a, '--overwrite');
      var applied = [];
      for (var i = 0; i < pairs.length; i++) {
        var kv = pairs[i].split('='), key = kv[0], val = kv[1];
        target.labels = target.labels || {};
        if (target.labels[key] != null && !over) {
          return err('error: \'' + key + '\' already has a value (' + target.labels[key] +
            '), and --overwrite is false');
        }
        target.labels[key] = val;
        applied.push(key);
      }
      return ok('pod/' + ln + ' labeled\n');
    }

    if (verb === 'set' && a[1] === 'resources') {
      var rt = (a[2] || '').split('/');
      var d = inNs(k.deployments, ns(w, a)).filter(function (x) { return x.name === rt[1]; })[0];
      if (!d) return err('Error from server (NotFound): deployments "' + (rt[1] || '') + '" not found');
      var lim = flagVal(a, ['--limits']);
      if (!lim) return err('error: you must specify --limits or --requests');
      var m = /memory=(\d+)([MG]i)/.exec(lim);
      if (!m) return err('error: invalid resource value "' + lim + '"');
      var mib = m[2] === 'Gi' ? Number(m[1]) * 1024 : Number(m[1]);
      d.memLimitMi = mib;
      inNs(k.pods, d.ns || 'default').filter(function (p) {
        return selectorMatches(d.selector, p.labels);
      }).forEach(function (p) {
        var c0 = (p.containers || [{}])[0];
        c0.limits = m[1] + m[2];
        if (mib >= (p.needMi || 0)) {
          p.status = 'Running'; p.ready = true; c0.state = 'Running';
          delete c0.lastState;
        }
      });
      event(w, { kind: 'deployment', name: d.name, ns: d.ns }, 'Normal', 'ScalingReplicaSet',
        'Updated resource limits to ' + lim);
      return ok('deployment.apps/' + d.name + ' resource requirements updated\n');
    }

    if (verb === 'set' && a[1] === 'image') {
      var it = (a[2] || '').split('/');
      var dep = inNs(k.deployments, ns(w, a)).filter(function (x) { return x.name === it[1]; })[0];
      if (!dep) return err('Error from server (NotFound): deployments "' + (it[1] || '') + '" not found');
      var spec = a[3] || '';
      var eq = spec.indexOf('=');
      if (eq < 1) return err('error: invalid image specification');
      var newImage = spec.slice(eq + 1);
      var valid = (k.registry || []).indexOf(newImage) !== -1;
      inNs(k.pods, dep.ns || 'default').filter(function (p) {
        return selectorMatches(dep.selector, p.labels);
      }).forEach(function (p) {
        var c0 = (p.containers || [{}])[0];
        c0.image = newImage;
        if (valid) { p.status = 'Running'; p.ready = true; c0.state = 'Running'; p.restarts = 0; }
        else {
          p.status = 'ImagePullBackOff'; p.ready = false;
          event(w, { kind: 'pod', name: p.name, ns: p.ns }, 'Warning', 'Failed',
            'Failed to pull image "' + newImage + '": manifest unknown');
        }
      });
      return ok('deployment.apps/' + dep.name + ' image updated\n');
    }

    if (verb === 'taint') {
      var tname = a[2];
      var spec2 = a[3] || '';
      var node = (k.nodes || []).filter(function (x) { return x.name === tname; })[0];
      if (!node) return err('Error from server (NotFound): nodes "' + (tname || '') + '" not found');
      if (spec2.slice(-1) === '-') {
        var keyPart = spec2.slice(0, -1);
        var before = (node.taints || []).length;
        node.taints = (node.taints || []).filter(function (t) { return t.indexOf(keyPart) !== 0; });
        if (node.taints.length === before) return err('error: taint "' + keyPart + '" not found');
        /* anything Pending purely because of that taint can now be placed */
        (k.pods || []).forEach(function (p) {
          if (p.status === 'Pending' && p.blockedBy === 'taint') {
            p.status = 'Running'; p.ready = true; p.node = node.name; p.ip = p.ip || '10.0.3.41';
            delete p.blockedBy;
            event(w, { kind: 'pod', name: p.name, ns: p.ns }, 'Normal', 'Scheduled',
              'Successfully assigned ' + (p.ns || 'default') + '/' + p.name + ' to ' + node.name);
          }
        });
        return ok('node/' + tname + ' untainted\n');
      }
      node.taints = (node.taints || []).concat([spec2]);
      return ok('node/' + tname + ' tainted\n');
    }

    if (verb === 'rollout') {
      var rv = a[1], rt2 = (a[2] || '').split('/');
      var rd = inNs(k.deployments, ns(w, a)).filter(function (x) { return x.name === rt2[1]; })[0];
      if (!rd) return err('Error from server (NotFound): deployments "' + (rt2[1] || '') + '" not found');
      if (rv === 'restart') {
        inNs(k.pods, rd.ns || 'default').filter(function (p) {
          return selectorMatches(rd.selector, p.labels);
        }).forEach(function (p) { p.restarts = 0; p.age = '1s'; });
        return ok('deployment.apps/' + rd.name + ' restarted\n');
      }
      if (rv === 'status') {
        var bad = inNs(k.pods, rd.ns || 'default').filter(function (p) {
          return selectorMatches(rd.selector, p.labels) && (p.status !== 'Running' || p.ready === false);
        });
        return bad.length
          ? { out: 'Waiting for deployment "' + rd.name + '" rollout to finish: ' + bad.length +
                   ' of ' + (rd.replicas || 1) + ' updated replicas are available...\n', code: 1 }
          : ok('deployment "' + rd.name + '" successfully rolled out\n');
      }
      return err('error: unknown rollout command "' + rv + '"');
    }

    if (verb === 'delete' && ALIAS[(a[1] || '').toLowerCase()] === 'pods') {
      var dpn = a[2];
      var idx = (k.pods || []).map(function (x) { return x.name; }).indexOf(dpn);
      if (idx === -1) return err('Error from server (NotFound): pods "' + (dpn || '') + '" not found');
      var dead = k.pods[idx];
      /* a Deployment replaces it; the replacement carries the current spec */
      if (dead.ownedBy) {
        dead.name = dead.name.replace(/-[a-z0-9]{5}$/, '-' + 'w4k2p');
        dead.restarts = 0; dead.age = '1s';
        if (dead.status === 'ImagePullBackOff' && dead.imageFixed) {
          dead.status = 'Running'; dead.ready = true;
        }
      } else k.pods.splice(idx, 1);
      return ok('pod "' + dpn + '" deleted\n');
    }

    if (verb === 'exec') {
      var xn = positional(a)[1];
      var xp = (k.pods || []).filter(function (x) { return x.name === xn; })[0];
      if (!xp) return err('Error from server (NotFound): pods "' + (xn || '') + '" not found');
      var dd = a.indexOf('--');
      if (dd === -1) return err('error: you must specify at least one command for the container');
      var inner = a.slice(dd + 1).join(' ');
      if (xp.status !== 'Running') {
        return err('error: cannot exec into a container in a "' + xp.status + '" state');
      }
      if (/resolv\.conf/.test(inner)) return ok((xp.resolvConf || 'nameserver 10.96.0.10\nsearch default.svc.cluster.local svc.cluster.local cluster.local\noptions ndots:5') + '\n');
      if (/nslookup|dig/.test(inner)) {
        var q = inner.split(/\s+/).filter(function (t) { return /\./.test(t) && !/^-/.test(t); })[0] || '';
        var zone = (k.dns || {});
        var answer = zone[q];
        if (answer === undefined && /\.svc\.cluster\.local$/.test(q)) answer = zone[q.replace(/\.svc\.cluster\.local$/, '')];
        if (zone.blocked) return { out:'', err:';; connection timed out; no servers could be reached', code:1 };
        if (!answer) return { out:'Server:\t\t10.96.0.10\n', err:'** server can\'t find ' + q + ': NXDOMAIN', code:1 };
        return ok('Server:\t\t10.96.0.10\nAddress:\t10.96.0.10#53\n\nName:\t' + q + '\nAddress: ' + answer + '\n');
      }
      if (/^env\b/.test(inner)) {
        return ok(Object.keys(xp.env || { HOME: '/root' }).sort().map(function (kk) {
          return kk + '=' + xp.env[kk]; }).join('\n') + '\n');
      }
      return ok((xp.execOut && xp.execOut[inner]) || '');
    }

    if (verb === 'config') {
      if (a[1] === 'get-contexts') {
        return ok('CURRENT   NAME              CLUSTER           NAMESPACE\n' +
          '*         ' + pad(k.context || 'prod-eks', 18, true) + pad(k.cluster || 'prod-eks', 18, true) +
          (k.namespace || 'default') + '\n');
      }
      if (a[1] === 'set-context') {
        var newNs = flagVal(a, ['--namespace']);
        if (newNs) { k.namespace = newNs; return ok('Context "' + (k.context || 'prod-eks') + '" modified.\n'); }
      }
      return ok('');
    }

    if (verb === 'version') return ok('Client Version: v1.30.4\nServer Version: v1.30.4-eks-a1b2c3d\n');

    return err('error: unknown command "' + verb + '" for "kubectl"');
  });

  /* ── docker, enough of it for the container half ─────────────── */
  LXShell.register('docker', function (w, a) {
    var d = w.docker || (w.docker = { containers: [], images: [] });
    var verb = a[0];
    if (verb === 'ps') {
      var all = has(a, '-a') || has(a, '--all');
      var list = (d.containers || []).filter(function (c) { return all || c.status.indexOf('Up') === 0; });
      if (!list.length) return ok('CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES\n');
      return ok(pad('CONTAINER ID', 15, true) + pad('IMAGE', 22, true) + pad('STATUS', 24, true) +
        pad('PORTS', 24, true) + 'NAMES\n' +
        list.map(function (c) {
          return pad(c.id, 15, true) + pad(c.image, 22, true) + pad(c.status, 24, true) +
            pad(c.ports || '', 24, true) + c.name;
        }).join('\n') + '\n');
    }
    if (verb === 'logs') {
      var ln = a.filter(function (x) { return x.charAt(0) !== '-'; })[1];
      var c2 = (d.containers || []).filter(function (x) { return x.name === ln || x.id === ln; })[0];
      if (!c2) return err('Error: No such container: ' + (ln || ''));
      return ok((c2.log || '') + (c2.log ? '\n' : ''));
    }
    if (verb === 'inspect') {
      var f = flagVal(a, ['--format', '-f']) || '';
      var inn = a.filter(function (x) { return x.charAt(0) !== '-'; }).slice(1)
        .filter(function (x) { return x !== f; })[0];
      var c3 = (d.containers || []).filter(function (x) { return x.name === inn || x.id === inn; })[0];
      if (!c3) return err('Error: No such object: ' + (inn || ''));
      if (/OOMKilled/.test(f)) return ok(String(!!c3.oomKilled) + '\n');
      if (/ExitCode/.test(f)) return ok(String(c3.exitCode != null ? c3.exitCode : 0) + '\n');
      if (/State\.Pid/.test(f)) return ok(String(c3.pid || 0) + '\n');
      return ok(JSON.stringify({ Name: c3.name, State: { ExitCode: c3.exitCode || 0,
        OOMKilled: !!c3.oomKilled, Status: c3.status } }, null, 2) + '\n');
    }
    if (verb === 'stats') {
      return ok(pad('NAME', 18, true) + pad('CPU %', 9, true) + 'MEM USAGE / LIMIT\n' +
        (d.containers || []).filter(function (c) { return c.status.indexOf('Up') === 0; })
          .map(function (c) {
            return pad(c.name, 18, true) + pad(c.cpuPct || '0.4%', 9, true) + (c.mem || '64MiB / 512MiB');
          }).join('\n') + '\n');
    }
    return err('docker: \'' + (verb || '') + '\' is not implemented in this sandbox. Try ps, logs, inspect or stats.');
  });

  /* crictl, because it is the tool that still works when kubectl cannot */
  LXShell.register('crictl', function (w, a) {
    var d = w.docker || { containers: [] };
    if (a[0] === 'ps') {
      return ok(pad('CONTAINER', 15, true) + pad('IMAGE', 22, true) + pad('STATE', 12, true) + 'NAME\n' +
        (d.containers || []).map(function (c) {
          return pad(c.id, 15, true) + pad(c.image, 22, true) +
            pad(c.status.indexOf('Up') === 0 ? 'Running' : 'Exited', 12, true) + c.name;
        }).join('\n') + '\n');
    }
    if (a[0] === 'info') return ok('{\n  "status": {\n    "conditions": [\n      {"type": "RuntimeReady", "status": true},\n      {"type": "NetworkReady", "status": ' + (w.cniReady === false ? 'false' : 'true') + '}\n    ]\n  }\n}\n');
    return err('crictl: unknown command "' + (a[0] || '') + '"');
  });
})();
