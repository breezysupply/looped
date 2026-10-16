/* A small, deterministic model of one AWS VPC for the Anduril Round 1 prep
   path (window.LXNet). It answers one question — "does this connection
   work, and what would each tool show?" — from state, so changing a route,
   an association, a security-group rule or a network-ACL entry changes
   every later observation consistently.

   What it models (and says so in every scenario):
   - route tables: explicit subnet associations or the VPC's main table;
     longest-prefix match; targets local, igw-*, nat-*, vpce-* (S3 prefix
     list) and blackhole when nothing matches;
   - internet gateway: works only for a source that has a public IPv4
     address; return traffic needs a route back to the IGW;
   - NAT gateway: in a public subnet with an Elastic IP; source NAT for
     private instances; its own subnet's route table and NACL apply; it
     uses source ports 1024-65535;
   - security groups: stateful, allow-only, evaluated per instance;
   - network ACLs: stateless, ordered by rule number, first match wins,
     final implicit deny; evaluated only when traffic crosses a subnet
     boundary; the return direction is checked against the client's
     ephemeral port;
   - listeners: an allowed port with nothing listening is a TCP reset
     ("connection refused"), not a timeout;
   - VPC flow log records for every attempt the model evaluates.
   What it does not model: IPv6, prefix lists other than one S3 list,
   transit/peering, load balancers, MTU, real packet timing. No AWS API
   is called and no packet is captured.

   Loaded as a plain script or required from node (tests). Depends on
   LXSim (sre-sim.js) only for bind/ok/err/flags. */
(function (root) {
  'use strict';
  function S() { return root.LXSim; }

  /* ── addressing ─────────────────────────────────────────────────── */
  function ip2n(ip) { var p = String(ip).split('.').map(Number); if (p.length !== 4 || p.some(function (x) { return !(x >= 0 && x <= 255); })) return null; return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; }
  function n2ip(n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
  function parseCidr(c) {
    var m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(String(c || '').trim());
    if (!m) return null;
    var len = +m[2], base = ip2n(m[1]);
    if (base == null || len > 32) return null;
    var mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
    return { base: (base & mask) >>> 0, len: len, mask: mask, size: Math.pow(2, 32 - len) };
  }
  function inCidr(ip, cidr) { var c = parseCidr(cidr), n = ip2n(ip); return !!c && n != null && ((n & c.mask) >>> 0) === c.base; }
  function cidrStr(c) { return n2ip(c.base) + '/' + c.len; }

  /* ── topology helpers ───────────────────────────────────────────── */
  function rtbFor(t, subnetId) {
    var a = (t.assoc || {})[subnetId];
    if (a && t.rtbs[a.rtb]) return t.rtbs[a.rtb];
    var sn = t.subnets[subnetId], main = null;
    Object.keys(t.rtbs).forEach(function (id) { var r = t.rtbs[id]; if (r.main && (!sn || r.vpc === sn.vpc)) main = r; });
    return main;
  }
  function routeLookup(t, rtb, dst) {
    var best = null;
    (rtb ? rtb.routes : []).forEach(function (r) {
      var cidrs = r.dest.indexOf('pl-') === 0 ? ((t.prefixLists || {})[r.dest] || {}).cidrs || [] : [r.dest];
      cidrs.forEach(function (c) {
        var pc = parseCidr(c);
        if (pc && inCidr(dst, c) && (!best || pc.len > best.len)) best = { route: r, len: pc.len, via: c };
      });
    });
    return best;
  }
  function naclFor(t, subnetId) {
    var hit = null;
    Object.keys(t.nacls || {}).forEach(function (id) { if ((t.nacls[id].subnets || []).indexOf(subnetId) !== -1) hit = t.nacls[id]; });
    return hit || { id: 'acl-default', isDefault: true, entries: [] };
  }
  function protoMatch(entryProto, proto) { return entryProto === '-1' || entryProto === 'all' || entryProto === proto || (entryProto === '6' && proto === 'tcp') || (entryProto === '17' && proto === 'udp') || (entryProto === '1' && proto === 'icmp'); }
  /* dir 'in': the packet enters the subnet from peerIp to `port`;
     dir 'out': the packet leaves the subnet to peerIp destined for `port` */
  function naclDecision(nacl, dir, proto, port, peerIp) {
    if (nacl.isDefault) return { allow: true, rule: 'default NACL (allows all)' };
    var es = nacl.entries.filter(function (e) { return (dir === 'in') === !e.egress; }).slice().sort(function (a, b) { return a.n - b.n; });
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      if (!protoMatch(e.proto, proto)) continue;
      if (proto !== 'icmp' && e.proto !== '-1' && e.proto !== 'all' && (port < e.from || port > e.to)) continue;
      if (!inCidr(peerIp, e.cidr)) continue;
      return { allow: e.action === 'allow', rule: 'rule ' + e.n + ' (' + e.action + ')' };
    }
    return { allow: false, rule: 'rule * (deny)' };
  }
  function sgAllows(t, inst, dir, proto, port, peerIp) {
    var hit = null;
    (inst.sgs || []).forEach(function (gid) {
      var g = t.sgs[gid]; if (!g || hit) return;
      (dir === 'in' ? g.ingress : g.egress).forEach(function (r) {
        if (hit) return;
        if (!protoMatch(r.proto, proto)) return;
        if (proto !== 'icmp' && r.proto !== '-1' && (port < r.from || port > r.to)) return;
        if (r.cidr && !inCidr(peerIp, r.cidr)) return;
        if (r.sg) { var peer = instByIp(t, peerIp); if (!peer || (peer.sgs || []).indexOf(r.sg) === -1) return; }
        hit = { gid: gid, rule: r };
      });
    });
    return hit;
  }
  function instByIp(t, ip) {
    var id = Object.keys(t.instances).filter(function (k) { var i = t.instances[k]; return i.privateIp === ip || i.publicIp === ip; })[0];
    return id ? t.instances[id] : null;
  }
  function natById(t, id) { return (t.nats || {})[id] || null; }
  function vpcOf(t, subnetId) { var sn = t.subnets[subnetId]; return sn && t.vpcs[sn.vpc]; }

  /* deterministic ephemeral ports by client OS (AWS doc ranges) */
  function ephemeral(t, kind) {
    t._eph = (t._eph || 0) + 1;
    var k = t._eph * 7919;
    if (kind === 'macos') return 49152 + (k % 16000);          /* 49152-65535 */
    if (kind === 'nat') return 1024 + (k % 64000);             /* NAT gateway: 1024-65535 */
    return 32768 + (k % 28000);                                /* Amazon Linux: 32768-60999 */
  }

  /* flow log v2: version account eni src dst srcport dstport proto packets bytes start end action status */
  function flow(t, eni, src, dst, sp, dp, proto, action) {
    var start = 1760430000 + (t.clockRef ? t.clockRef.clock || 0 : 0);
    t.flows = t.flows || [];
    t.flows.push('2 123456789012 ' + eni + ' ' + src + ' ' + dst + ' ' + sp + ' ' + dp + ' ' + (proto === 'udp' ? 17 : proto === 'icmp' ? 1 : 6) + ' ' + (action === 'ACCEPT' ? 6 : 1) + ' ' + (action === 'ACCEPT' ? 520 : 60) + ' ' + start + ' ' + (start + 9) + ' ' + action + ' OK');
  }

  /* ── the one question: does src reach dstIp:port? ───────────────────
     src: 'client' (the internet client, e.g. the engineer's laptop) or an
     instance id. Returns { result: ok|timeout|refused, why, hops[] } and
     appends flow-log records. */
  function connect(t, src, dstIp, port, proto) {
    proto = proto || 'tcp';
    var hops = [], why = '';
    function drop(reason) { return { result: 'timeout', why: reason, hops: hops }; }
    function deliverToInstance(inst, fromIp, fromPort, fromKind) {
      /* the packet arrives at the instance's subnet from outside it */
      var nacl = naclFor(t, inst.subnet), sameSubnet = fromKind && fromKind.subnet === inst.subnet;
      if (!sameSubnet) {
        var ni = naclDecision(nacl, 'in', proto, port, fromIp);
        hops.push('NACL ' + nacl.id + ' inbound ' + proto + '/' + port + ' from ' + fromIp + ': ' + ni.rule);
        if (!ni.allow) { flow(t, inst.eni, fromIp, inst.privateIp, fromPort, port, proto, 'REJECT'); return drop('network ACL ' + nacl.id + ' denies the request inbound (' + ni.rule + ')'); }
      }
      var sg = sgAllows(t, inst, 'in', proto, port, fromIp);
      hops.push('security groups of ' + inst.id + ' inbound ' + proto + '/' + port + ' from ' + fromIp + ': ' + (sg ? 'allowed by ' + sg.gid : 'no matching rule'));
      if (!sg) { flow(t, inst.eni, fromIp, inst.privateIp, fromPort, port, proto, 'REJECT'); return drop('no security-group rule on ' + inst.id + ' allows ' + proto + '/' + port + ' from ' + fromIp); }
      flow(t, inst.eni, fromIp, inst.privateIp, fromPort, port, proto, 'ACCEPT');
      var listening = proto === 'icmp' ? true : (inst.listeners || []).some(function (l) { return l.port === port && (l.proto || 'tcp') === proto; });
      /* the reply (SYN-ACK or RST) leaves the subnet toward the client's ephemeral port */
      if (!sameSubnet) {
        var no = naclDecision(nacl, 'out', proto, proto === 'icmp' ? 0 : fromPort, fromIp);
        hops.push('NACL ' + nacl.id + ' outbound reply to ' + fromIp + ':' + fromPort + ': ' + no.rule);
        if (!no.allow) { flow(t, inst.eni, inst.privateIp, fromIp, port, fromPort, proto, 'REJECT'); return drop('network ACL ' + nacl.id + ' blocks the reply to the client\'s ephemeral port ' + fromPort + ' (' + no.rule + '); the request got in, the answer cannot get out'); }
      }
      return { listening: listening };
    }
    function replyRoute(inst, toIp) {
      if (t.subnets[inst.subnet] && inCidr(toIp, vpcOf(t, inst.subnet).cidr)) return true;
      var r = routeLookup(t, rtbFor(t, inst.subnet), toIp);
      hops.push('return route from ' + inst.subnet + ' to ' + toIp + ': ' + (r ? r.route.dest + ' → ' + r.route.target : 'none (no matching route)'));
      return !!r && /^igw-/.test(r.route.target) && !!inst.publicIp;
    }

    if (src === 'client') {
      var c = t.client, cport = ephemeral(t, c.os || 'macos');
      var inst = Object.keys(t.instances).map(function (k) { return t.instances[k]; }).filter(function (i) { return i.publicIp === dstIp; })[0];
      var extHost = (t.internet || {})[dstIp];
      if (extHost) {
        hops.push('client ' + c.ip + ':' + cport + ' → ' + (extHost.name || dstIp) + ':' + port + ' across the internet (outside the VPC model)');
        return (extHost.listeners || []).indexOf(port) !== -1 ? { result: 'ok', why: 'reached ' + (extHost.name || dstIp), hops: hops, ext: extHost } : { result: 'refused', why: dstIp + ' refuses ' + port, hops: hops };
      }
      if (!inst) {
        var nat = Object.keys(t.nats || {}).map(function (k) { return t.nats[k]; }).filter(function (n) { return n.eip === dstIp; })[0];
        if (nat) return drop('a NAT gateway does not accept unsolicited inbound connections');
        return drop('nothing on the internet answers at ' + dstIp + ' in this scenario');
      }
      hops.push('client ' + c.ip + ':' + cport + ' → ' + dstIp + ':' + port + ' via the internet gateway (public IP ' + inst.publicIp + ' → private ' + inst.privateIp + ')');
      var igwOk = Object.keys(t.igws || {}).some(function (k) { return t.igws[k].vpc === t.subnets[inst.subnet].vpc; });
      if (!igwOk) return drop('the VPC has no internet gateway attached');
      var d = deliverToInstance(inst, c.ip, cport, null);
      if (d.result) return d;
      if (!replyRoute(inst, c.ip)) { flow(t, inst.eni, inst.privateIp, c.ip, port, cport, proto, 'ACCEPT'); return drop('the reply has no route back to the internet gateway from subnet ' + inst.subnet + ' (route table ' + (rtbFor(t, inst.subnet) || {}).id + ')'); }
      if (!d.listening) return { result: 'refused', why: 'packets arrive but nothing listens on ' + proto + '/' + port + ' on ' + inst.id, hops: hops };
      return { result: 'ok', why: 'connected to ' + inst.id + ' (' + (inst.name || '') + ') on ' + port, hops: hops, inst: inst };
    }

    /* from an instance */
    var me = t.instances[src];
    if (!me) return { result: 'timeout', why: 'unknown source', hops: hops };
    var sport = ephemeral(t, 'linux');
    var eg = sgAllows(t, me, 'out', proto, port, dstIp);
    hops.push('security groups of ' + me.id + ' outbound ' + proto + '/' + port + ' to ' + dstIp + ': ' + (eg ? 'allowed by ' + eg.gid : 'no matching rule'));
    if (!eg) { flow(t, me.eni, me.privateIp, dstIp, sport, port, proto, 'REJECT'); return drop('no outbound security-group rule on ' + me.id + ' allows ' + proto + '/' + port + ' to ' + dstIp); }
    var vpcCidr = vpcOf(t, me.subnet).cidr;
    var myNacl = naclFor(t, me.subnet);
    var peer = instByIp(t, dstIp);
    var inVpc = inCidr(dstIp, vpcCidr);
    if (!(peer && peer.subnet === me.subnet)) {
      var o = naclDecision(myNacl, 'out', proto, port, dstIp);
      hops.push('NACL ' + myNacl.id + ' outbound ' + proto + '/' + port + ' to ' + dstIp + ': ' + o.rule);
      if (!o.allow) { flow(t, me.eni, me.privateIp, dstIp, sport, port, proto, 'REJECT'); return drop('network ACL ' + myNacl.id + ' denies the request outbound (' + o.rule + ')'); }
    }
    if (inVpc) {
      if (!peer) return drop('no instance at ' + dstIp + ' in this model');
      hops.push('route: ' + dstIp + ' is inside ' + vpcCidr + ' → local');
      var dd = deliverToInstance(peer, me.privateIp, sport, me);
      if (dd.result) return dd;
      if (peer.subnet !== me.subnet) {
        var ri = naclDecision(myNacl, 'in', proto, sport, dstIp);
        hops.push('NACL ' + myNacl.id + ' inbound reply from ' + dstIp + ' to port ' + sport + ': ' + ri.rule);
        if (!ri.allow) return drop('network ACL ' + myNacl.id + ' blocks the reply to ephemeral port ' + sport);
      }
      flow(t, me.eni, me.privateIp, dstIp, sport, port, proto, 'ACCEPT');
      return dd.listening ? { result: 'ok', why: 'connected inside the VPC', hops: hops } : { result: 'refused', why: 'nothing listens on ' + port + ' at ' + dstIp, hops: hops };
    }
    var rtb = rtbFor(t, me.subnet), r = routeLookup(t, rtb, dstIp);
    hops.push('route table ' + (rtb ? rtb.id + (t.assoc[me.subnet] ? ' (explicitly associated)' : ' (main table — no explicit association)') : '(none)') + ' for ' + dstIp + ': ' + (r ? r.route.dest + ' → ' + r.route.target : 'no matching route'));
    if (!r) { flow(t, me.eni, me.privateIp, dstIp, sport, port, proto, 'ACCEPT'); return drop('no route matches ' + dstIp + ' in ' + (rtb ? rtb.id : 'the route table') + ', so the VPC drops the packet'); }
    var target = r.route.target, ext = (t.internet || {})[dstIp];
    flow(t, me.eni, me.privateIp, dstIp, sport, port, proto, 'ACCEPT');
    var inboundNacl = function (fromIp, toPort) {
      var ri2 = naclDecision(myNacl, 'in', proto, toPort, fromIp);
      hops.push('NACL ' + myNacl.id + ' inbound reply from ' + fromIp + ' to port ' + toPort + ': ' + ri2.rule);
      return ri2.allow;
    };
    if (/^vpce-/.test(target)) {
      var ep = (t.endpoints || {})[target];
      hops.push('gateway endpoint ' + target + ' (' + (ep ? ep.service : '?') + ')');
      if (!ep) return drop('the endpoint does not exist');
      if (!inboundNacl(dstIp, sport)) return drop('network ACL ' + myNacl.id + ' blocks the reply from the endpoint path to ephemeral port ' + sport);
      return { result: 'ok', why: 'reached ' + ep.service + ' privately through ' + target, hops: hops, via: 'endpoint' };
    }
    if (/^igw-/.test(target)) {
      if (!me.publicIp) return drop('the route points at the internet gateway, but ' + me.id + ' has no public IPv4 address, so the gateway has nothing to translate it to and the traffic is dropped');
      if (!ext) return drop('nothing answers at ' + dstIp);
      if (!inboundNacl(dstIp, sport)) return drop('network ACL ' + myNacl.id + ' blocks the reply to ephemeral port ' + sport);
      if (!(ext.listeners || []).some(function (p) { return p === port; })) return { result: 'refused', why: dstIp + ' refuses ' + port, hops: hops };
      return { result: 'ok', why: 'reached ' + (ext.name || dstIp) + ' through ' + target + ' using public IP ' + me.publicIp, hops: hops, ext: ext };
    }
    if (/^nat-/.test(target)) {
      var nat2 = natById(t, target);
      if (!nat2 || nat2.state !== 'available') return drop('NAT gateway ' + target + ' is not available');
      var natNacl = naclFor(t, nat2.subnet);
      if (nat2.subnet !== me.subnet) {
        var ni2 = naclDecision(natNacl, 'in', proto, port, me.privateIp);
        hops.push('NACL ' + natNacl.id + ' (NAT subnet) inbound from ' + me.privateIp + ': ' + ni2.rule);
        if (!ni2.allow) return drop('the NAT gateway\'s subnet ACL denies traffic from the instance');
      }
      var nr = routeLookup(t, rtbFor(t, nat2.subnet), dstIp);
      hops.push('NAT ' + target + ' (' + nat2.eip + ') route for ' + dstIp + ': ' + (nr ? nr.route.dest + ' → ' + nr.route.target : 'no matching route'));
      if (!nr || !/^igw-/.test(nr.route.target)) return drop('the NAT gateway\'s own subnet has no route to the internet gateway');
      var nport = ephemeral(t, 'nat');
      var no2 = naclDecision(natNacl, 'out', proto, port, dstIp);
      hops.push('NACL ' + natNacl.id + ' (NAT subnet) outbound to ' + dstIp + ':' + port + ': ' + no2.rule);
      if (!no2.allow) return drop('the NAT subnet ACL denies the translated request outbound');
      if (!ext) return drop('nothing answers at ' + dstIp);
      var nri = naclDecision(natNacl, 'in', proto, nport, dstIp);
      hops.push('NACL ' + natNacl.id + ' (NAT subnet) inbound reply from ' + dstIp + ' to NAT port ' + nport + ': ' + nri.rule);
      if (!nri.allow) return drop('the NAT subnet ACL blocks the reply to the NAT gateway\'s port ' + nport + ' (NAT gateways use 1024-65535)');
      if (nat2.subnet !== me.subnet) {
        var nro = naclDecision(natNacl, 'out', proto, sport, me.privateIp);
        hops.push('NACL ' + natNacl.id + ' (NAT subnet) outbound reply to ' + me.privateIp + ':' + sport + ': ' + nro.rule);
        if (!nro.allow) return drop('the NAT subnet ACL blocks the reply toward the instance');
        if (!inboundNacl(dstIp, sport)) return drop('network ACL ' + myNacl.id + ' blocks the reply to ephemeral port ' + sport);
      }
      if (!(ext.listeners || []).some(function (p) { return p === port; })) return { result: 'refused', why: dstIp + ' refuses ' + port, hops: hops };
      return { result: 'ok', why: 'reached ' + (ext.name || dstIp) + ' through ' + target + ' as ' + nat2.eip, hops: hops, ext: ext, via: 'nat' };
    }
    return drop('route target ' + target + ' is not modelled');
  }

  /* ── deep-ish copy for reset determinism ───────────────────────── */
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  root.LXNet = { ip2n: ip2n, n2ip: n2ip, parseCidr: parseCidr, inCidr: inCidr, cidrStr: cidrStr,
    rtbFor: rtbFor, routeLookup: routeLookup, naclFor: naclFor, naclDecision: naclDecision,
    sgAllows: sgAllows, instByIp: instByIp, connect: connect, clone: clone, ephemeral: ephemeral };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LXNet;
})(typeof window !== 'undefined' ? window : globalThis);
