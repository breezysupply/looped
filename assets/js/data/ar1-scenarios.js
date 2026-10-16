/* Anduril Round 1 prep — AWS networking investigations N1–N4 (sandbox
   missions) and evidence cards N5–N6.

   INVENTED PRACTICE SCENARIOS on a fictional VPC ("ridgeline-lab", account
   123456789012, documentation address ranges). They are not Anduril
   interview questions and not anyone's real environment. N4 is inspired by
   a real DNS investigation the learner described; every name and address
   in it is fictional.

   Each mission runs in the existing sandbox with the SRE-style scenario
   machinery (guided/independent modes, seeded variants, a four-rung hint
   ladder, documented unsafe shortcuts) but records into the prep path's
   own store through sre.hub = 'LXAr1'. Every output is derived from the
   LXNet model (assets/js/ar1-net.js, ar1-tools.js), so a route or rule
   change updates later evidence. Shape of each investigation:
   hypothesis (note) → evidence → interpretation → minimal fix → verification. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.missions = LX.missions || [];
LX.ar1Cards = LX.ar1Cards || [];

(function () {
  function SIM() { return window.LXSim; }
  function NET() { return window.LXNet; }
  function st(c) { return c.w.sre; }
  function ran(c, re) { return SIM().ran(c, re); }
  function saw(c, re, outRe) { return SIM().saw(c, re, outRe); }
  function lastIs(c, re, outRe) { return SIM().lastIs(c, re, outRe); }
  function noted(c, kind, words) { return (st(c).notes || []).some(function (n) { return n.kind === kind && n.text.split(/\s+/).length >= (words || 5); }); }
  function probed(c, fn) { return (st(c).probes || []).some(fn); }
  function lastProbe(c) { return st(c).lastProbe || {}; }
  /* the last command line ran a connectivity test, and that test is the most recent probe */
  function lastWasProbe(c) { var L = lastProbe(c), i = c.ran.length - 1; return i >= 0 && L.clock === st(c).clock && SIM().cmdIs(c.ran[i], /(nc|ssh|curl|dig)\b/); }

  var HUB = 'LXAr1';
  var SIMPLIFIED = [
    'One VPC, IPv4 only, one Availability Zone of each subnet type; no peering, transit gateways, load balancers or IPv6.',
    'Security groups, network ACLs, route tables, the internet gateway and the NAT gateway follow the documented AWS rules (stateful vs stateless, longest-prefix match, ephemeral return ports), but timing, MTU and packet loss are not modelled.',
    'AWS CLI output is a realistic JSON subset generated from the model; no AWS API is called and --query is not evaluated.',
    'The laptop behaves like macOS (ephemeral ports 49152–65535, BSD nc); instances behave like Amazon Linux (32768–60999, ncat). `console` is an out-of-band shell so testing a path never depends on that path.'
  ];
  var GRAMMAR = [
    '`ssh user@HOST`, `nc -vz [-w N] HOST PORT`, `curl [-v] [--max-time N] URL`, `ping HOST`, `dig [+short] NAME` — from the laptop, or from an instance after `console i-…` (`exit` to return)',
    'on an instance: `ip route`, `ss -ltn`, `cat /etc/resolv.conf`',
    '`aws ec2 describe-instances|security-groups|route-tables|network-acls|subnets|nat-gateways|internet-gateways|vpc-endpoints [--…-ids …] [--filters Name=association.subnet-id,Values=…]`',
    '`aws ec2 authorize|revoke-security-group-ingress --group-id … --protocol tcp --port N[-M] --cidr X/Y`; `create|replace|delete-route --route-table-id … --destination-cidr-block … --gateway-id|--nat-gateway-id …`; `associate-route-table --route-table-id … --subnet-id …`; `create|replace|delete-network-acl-entry --network-acl-id … --ingress|--egress --rule-number N --protocol tcp --port-range From=A,To=B --cidr-block X/Y --rule-action allow|deny`',
    '`aws logs filter-log-events --log-group-name /vpc/ridgeline-lab/flow [--filter-pattern REJECT]` (VPC flow logs, version 2 format)',
    '`note hypothesis: …` and `note interpretation: …` — your written reasoning, kept with the attempt (self-reviewed)'
  ];
  var TOOLS = ['ssh', 'nc', 'curl', 'ping', 'dig', 'ip route', 'ss', 'aws ec2 (subset)', 'aws logs filter-log-events', 'console/exit', 'note'];

  /* ── the shared fictional topology ─────────────────────────────── */
  var IDS = {
    vpc: 'vpc-0a7c1e5d2b9f40316', pub: 'subnet-0e41b7a2c95d0f863', app: 'subnet-07d2c9e1a4b5f6038',
    igw: 'igw-0b5e2d8a1c7f94e60', nat: 'nat-04f1c8e2a7b9d3065', rtMain: 'rtb-0c1d2e3f4a5b6c7d8',
    rtPub: 'rtb-0a9b8c7d6e5f40312', rtApp: 'rtb-0f6e5d4c3b2a19087',
    bastion: 'i-0b4a7e2c91d5f3086', app1: 'i-0d8e3a6f1b2c4e507', web: 'i-0c2f9b8e7a6d5c401',
    sgBastion: 'sg-0d1e2f3a4b5c6d7e8', sgApp: 'sg-0a1b2c3d4e5f60718', sgWeb: 'sg-0f9e8d7c6b5a40321',
    aclWeb: 'acl-0e7d6c5b4a3920187'
  };
  var LAPTOP = '198.51.100.45', VENDOR = '192.0.2.80', CHECKIP = '192.0.2.53';
  function baseNet() {
    var t = {
      vpcs: {}, subnets: {}, rtbs: {}, assoc: {}, igws: {}, nats: {}, sgs: {}, nacls: {}, instances: {}, endpoints: {},
      client: { ip: LAPTOP, os: 'macos' }, flowLogGroup: '/vpc/ridgeline-lab/flow', vpcResolver: '10.20.0.2',
      internet: {}, dns: {}, flows: []
    };
    t.vpcs[IDS.vpc] = { cidr: '10.20.0.0/16', name: 'ridgeline-lab' };
    t.subnets[IDS.pub] = { vpc: IDS.vpc, cidr: '10.20.1.0/24', az: 'us-west-2a', name: 'public-a', mapPublic: true };
    t.subnets[IDS.app] = { vpc: IDS.vpc, cidr: '10.20.11.0/24', az: 'us-west-2a', name: 'private-app-a', mapPublic: false };
    t.igws[IDS.igw] = { vpc: IDS.vpc, name: 'ridgeline-igw' };
    t.nats[IDS.nat] = { subnet: IDS.pub, eip: '203.0.113.40', privateIp: '10.20.1.10', state: 'available', name: 'ridgeline-nat-a' };
    t.rtbs[IDS.rtMain] = { id: IDS.rtMain, vpc: IDS.vpc, main: true, name: 'main (unused)', routes: [{ dest: '10.20.0.0/16', target: 'local' }] };
    t.rtbs[IDS.rtPub] = { id: IDS.rtPub, vpc: IDS.vpc, name: 'public-rt', routes: [{ dest: '10.20.0.0/16', target: 'local' }, { dest: '0.0.0.0/0', target: IDS.igw }] };
    t.rtbs[IDS.rtApp] = { id: IDS.rtApp, vpc: IDS.vpc, name: 'private-app-rt', routes: [{ dest: '10.20.0.0/16', target: 'local' }, { dest: '0.0.0.0/0', target: IDS.nat }] };
    t.assoc[IDS.pub] = { rtb: IDS.rtPub, id: 'rtbassoc-0a1f2e3d4c5b6a798' };
    t.assoc[IDS.app] = { rtb: IDS.rtApp, id: 'rtbassoc-0b2e3d4c5f6a7b890' };
    t.sgs[IDS.sgBastion] = { id: IDS.sgBastion, vpc: IDS.vpc, name: 'bastion-ssh', ingress: [], egress: [{ proto: '-1', from: -1, to: -1, cidr: '0.0.0.0/0' }] };
    t.sgs[IDS.sgApp] = { id: IDS.sgApp, vpc: IDS.vpc, name: 'app-a', ingress: [{ proto: 'tcp', from: 22, to: 22, sg: IDS.sgBastion }], egress: [{ proto: 'tcp', from: 443, to: 443, cidr: '0.0.0.0/0' }] };
    t.sgs[IDS.sgWeb] = { id: IDS.sgWeb, vpc: IDS.vpc, name: 'web-https', ingress: [{ proto: 'tcp', from: 443, to: 443, cidr: '0.0.0.0/0' }], egress: [{ proto: '-1', from: -1, to: -1, cidr: '0.0.0.0/0' }] };
    t.instances[IDS.bastion] = { id: IDS.bastion, name: 'bastion-a', subnet: IDS.pub, privateIp: '10.20.1.15', publicIp: '203.0.113.25', eni: 'eni-0b1a2c3d4e5f60789', sgs: [IDS.sgBastion], listeners: [{ port: 22, proc: 'sshd' }] };
    t.instances[IDS.app1] = { id: IDS.app1, name: 'app-a', subnet: IDS.app, privateIp: '10.20.11.25', eni: 'eni-0c2d3e4f5a6b70891', sgs: [IDS.sgApp], listeners: [{ port: 22, proc: 'sshd' }, { port: 8080, proc: 'beacon' }] };
    t.instances[IDS.web] = { id: IDS.web, name: 'web-a', subnet: IDS.pub, privateIp: '10.20.1.30', publicIp: '203.0.113.30', eni: 'eni-0d3e4f5a6b7c80912', sgs: [IDS.sgWeb], listeners: [{ port: 443, proc: 'nginx' }],
      tls: { cn: 'www.ridgeline.example' }, http: { status: 200, body: '<!doctype html><title>Ridgeline status</title>OK' } };
    t.internet[VENDOR] = { name: 'api.vendor.example', listeners: [443], tls: { cn: 'api.vendor.example' }, http: { status: 200, body: '{"status":"ok","service":"vendor-api"}' } };
    t.internet[CHECKIP] = { name: 'checkip.amazonaws.com', listeners: [443, 80], tls: { cn: 'checkip.amazonaws.com' },
      http: { status: 200, body: function (s, r) { return r.via === 'nat' ? s.net.nats[IDS.nat].eip : s.at === 'laptop' ? LAPTOP : (s.net.instances[s.at] || {}).publicIp || '?'; } } };
    t.dns = { 'api.vendor.example': VENDOR, 'checkip.amazonaws.com': CHECKIP, 'www.ridgeline.example': '203.0.113.30', 'bastion.ridgeline.example': '203.0.113.25' };
    return t;
  }
  function sg(c, id) { return st(c).net.sgs[id]; }
  function conn(c, src, ip, port) { return NET().connect(NET().clone(stripFns(st(c).net)), src, ip, port, 'tcp'); }
  /* connect() appends flow records and bumps counters; objectives evaluate on a copy so checking never changes what the learner sees */
  function stripFns(t) { var x = {}; Object.keys(t).forEach(function (k) { if (k !== 'clockRef') x[k] = t[k]; }); return x; }
  function hasBroadRule(t, gid, port) { return (t.sgs[gid].ingress || []).some(function (r) { var c = r.cidr && NET().parseCidr(r.cidr); return c && c.len <= 8 && (r.proto === '-1' || (port >= r.from && port <= r.to)); }); }

  /* ═══ N1 · SSH times out to an instance that is up ═════════════════ */
  LX.missions.push({
    id: 'ar1-n1', track: 'anduril', cat: 'awsnet', level: 'intermediate', mins: 20, kind: 'incident',
    title: 'SSH to the bastion times out after the office network change',
    brief: function () { return 'Since this morning your `ssh ec2-user@bastion.ridgeline.example` from the laptop hangs and then fails. The instance shows as running and nobody changed it. Work it as hypothesis → evidence → interpretation → minimal fix → verification. Start by writing a hypothesis with `note hypothesis: …`.'; },
    keys: ['note hypothesis: ', 'ssh ec2-user@bastion.ridgeline.example', 'nc -vz -w 5 bastion.ridgeline.example 22', 'aws ec2 describe-instances --instance-ids ' + IDS.bastion, 'aws ec2 describe-security-groups --group-ids ' + IDS.sgBastion, 'curl -s https://checkip.amazonaws.com', 'aws logs filter-log-events --log-group-name /vpc/ridgeline-lab/flow --filter-pattern REJECT', 'console ' + IDS.bastion, 'ss -ltn', 'exit'],
    world: function (seed) {
      var v = SIM().variantOf(seed, ['a', 'b']), t = baseNet();
      t.sgs[IDS.sgBastion].ingress = v === 'a'
        ? [{ proto: 'tcp', from: 22, to: 22, cidr: '198.51.100.0/27', desc: 'office (old range)' }]
        : [{ proto: 'tcp', from: 22, to: 22, cidr: '198.51.100.17/32', desc: 'office NAT (pre-change)' }];
      return NET().world(seed, t, { variant: v, prime: [['client', '203.0.113.25', 22], ['client', '203.0.113.25', 22]] });
    },
    objectives: [
      { id: 'hypothesis', stage: 'evidence', text: 'Write a hypothesis before you test anything',
        hint: 'What are the places a TCP connection to port 22 can die between your laptop and sshd?', hint2: 'Name one layer (DNS, routing, filtering, the service) and what you expect to see if it is the cause: `note hypothesis: …`.',
        reveal: 'note hypothesis: the change altered our source address and the security group no longer allows it, so SYNs are dropped and ssh times out',
        done: function (c) { return noted(c, 'hypothesis', 6); } },
      { id: 'reproduce', stage: 'evidence', text: 'Reproduce with a TCP test and read whether it is a timeout or a refusal',
        hint: 'A timeout and "connection refused" mean different things.', hint2: '`nc -vz -w 5 bastion.ridgeline.example 22` from the laptop.',
        reveal: 'nc -vz -w 5 bastion.ridgeline.example 22',
        done: function (c) { return probed(c, function (p) { return p.at === 'laptop' && p.port === 22 && p.result === 'timeout'; }) && saw(c, /^(nc|ssh)\b/, /timed out/); } },
      { id: 'host', stage: 'evidence', text: 'Rule out the host: it is running, has a public address, and sshd listens',
        hint: 'Check the instance from the control plane, and the service from inside.', hint2: '`aws ec2 describe-instances --instance-ids …` for state and PublicIpAddress; `console …` then `ss -ltn` for port 22.',
        reveal: 'aws ec2 describe-instances --instance-ids ' + IDS.bastion + ' && console ' + IDS.bastion + ' && ss -ltn',
        done: function (c) { return saw(c, /^aws\s+ec2\s+describe-instances/, /PublicIpAddress/) && saw(c, /^ss\b/, /:22\b/); } },
      { id: 'filter', stage: 'evidence', text: 'Compare the source address AWS sees with the rule that should allow it',
        hint: 'A rule is only as good as the address it names. What is your address on the internet today?', hint2: '`curl -s https://checkip.amazonaws.com` (from the laptop) and `aws ec2 describe-security-groups --group-ids …`; flow logs show the REJECTs for your address.',
        reveal: 'exit && curl -s https://checkip.amazonaws.com && aws ec2 describe-security-groups --group-ids ' + IDS.sgBastion,
        done: function (c) { return (saw(c, /^curl\b.*checkip/, new RegExp(LAPTOP.replace(/\./g, '\\.'))) || saw(c, /^aws\s+logs\s+filter-log-events/, new RegExp(LAPTOP.replace(/\./g, '\\.') + '.*REJECT'))) && saw(c, /^aws\s+ec2\s+describe-security-groups/, /CidrIp/); } },
      { id: 'fix', stage: 'fix', text: 'Make the smallest change that lets your address reach port 22 — and nothing broader',
        hint: 'Change the rule, not the instance, and not the whole internet.', hint2: '`aws ec2 authorize-security-group-ingress --group-id … --protocol tcp --port 22 --cidr YOUR.IP/32` (and revoke the stale rule if it is no longer needed).',
        reveal: 'aws ec2 authorize-security-group-ingress --group-id ' + IDS.sgBastion + ' --protocol tcp --port 22 --cidr ' + LAPTOP + '/32',
        explain: 'The office egress address changed (variant a: from inside 198.51.100.0/27 to .45; variant b: from .17 to .45). The bastion security group only allows TCP/22 from the old address, so every SYN from the laptop is dropped silently: ssh and nc time out (no RST), ping proves nothing either way, and the flow logs show REJECT for 198.51.100.45 → 10.20.1.15:22. Allow 198.51.100.45/32 on port 22 (and revoke the stale entry if the old address is gone); verify with nc/ssh.',
        done: function (c) { var t = st(c).net; return conn(c, 'client', '203.0.113.25', 22).result === 'ok' && !hasBroadRule(t, IDS.sgBastion, 22); } },
      { id: 'verify', stage: 'verify', text: 'Verify on the user path: SSH (or a TCP test to 22) now succeeds from the laptop',
        hint: 'The proof is the same test that failed.', hint2: '`nc -vz -w 5 bastion.ridgeline.example 22` or `ssh ec2-user@bastion.ridgeline.example`.',
        reveal: 'ssh ec2-user@bastion.ridgeline.example',
        done: function (c) { var L = lastProbe(c); return lastWasProbe(c) && L.at === 'laptop' && L.port === 22 && L.result === 'ok'; } }
    ],
    sre: {
      scenarioId: 'N1', hub: HUB, moduleId: 'AR1-B', lab: null, variants: ['a', 'b'],
      symptom: 'ssh to a running instance hangs, then "Operation timed out".',
      neutralTitle: 'SSH to a running instance fails from the laptop',
      neutralBrief: 'Since this morning ssh from your laptop to bastion.ridgeline.example hangs and then fails. The instance is running and nobody changed it. Find the cause with evidence, make the smallest fix, and verify.',
      impact: 'Operators cannot reach the bastion.', changes: 'The office network team moved internet egress to a new range this morning.',
      spoilers: ['security group', 'source address', 'CIDR', '/32', 'office address'],
      tools: TOOLS, grammar: GRAMMAR, palette: [],
      assumptions: ['You are allowed to change the bastion security group.', 'Your laptop is on the office network.'],
      simplified: SIMPLIFIED,
      unsafe: [
        { label: 'opened SSH to the whole internet', why: 'Allowing 22/tcp from 0.0.0.0/0 (or any /8-sized range) makes the symptom disappear by exposing the bastion to every scanner on the internet; the fault was one stale address.',
          test: function (c) { return hasBroadRule(st(c).net, IDS.sgBastion, 22); },
          demo: 'aws ec2 authorize-security-group-ingress --group-id ' + IDS.sgBastion + ' --protocol tcp --port 22 --cidr 0.0.0.0/0' }
      ],
      alt: function () { return ['note hypothesis: the new office egress address is not in the security group rule for port 22', 'ssh ec2-user@bastion.ridgeline.example', 'aws ec2 describe-instances --instance-ids ' + IDS.bastion, 'console ' + IDS.bastion, 'ss -ltn', 'exit',
        'aws logs filter-log-events --log-group-name /vpc/ridgeline-lab/flow --filter-pattern REJECT', 'aws ec2 describe-security-groups --group-ids ' + IDS.sgBastion,
        'aws ec2 authorize-security-group-ingress --group-id ' + IDS.sgBastion + ' --protocol tcp --port 22 --cidr 198.51.100.32/28', 'nc -vz -w 5 bastion.ridgeline.example 22']; },
      mechanism: 'A security group is an allow-list evaluated on the source address the instance actually sees. The office moved its internet egress, so the laptop now arrives as 198.51.100.45, which the only port-22 rule does not cover. Security groups drop non-matching packets silently, so the client sees a **timeout**, not a refusal (a refusal would mean the packet reached the host and nothing listened). The host is fine: it is running, has a public address and sshd listens. The minimal fix is to allow the new /32 (or the office\'s documented range) on 22 — never 0.0.0.0/0 — and remove the stale entry once nobody uses it.',
      alternatives: [
        { h: 'The instance is down', out: 'Ruled out: describe-instances shows running with a public IP, and `ss -ltn` on the console shows sshd on :22.' },
        { h: 'Routing or the internet gateway', out: 'Ruled out for this path: the public subnet routes 0.0.0.0/0 to the IGW and the flow logs record the SYNs arriving and being REJECTed — they got to the instance\'s interface.' },
        { h: 'sshd is broken', out: 'A dead sshd would give "Connection refused" (an RST), not a timeout.' },
        { h: 'ping fails, so the host is down', out: 'ICMP is not allowed by the group at all; a failed ping proves nothing about TCP/22.' }
      ],
      clues: ['ping failing is a red herring: the group has no ICMP rule.'],
      passRubric: ['States a hypothesis before testing', 'Separates timeout from refusal and says what each proves', 'Finds the address mismatch with evidence (checkip or flow logs + the rule)', 'Fixes with a narrow rule and verifies with the same test'],
      prereqs: ['ar1-a-04', 'ar1-b-02'], refs: ['AWS-SG', 'AWS-FLOW', 'RFC-9293']
    }
  });

  /* ═══ N2 · Private instance cannot reach an HTTPS API ═════════════ */
  LX.missions.push({
    id: 'ar1-n2', track: 'anduril', cat: 'awsnet', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'The private app instance cannot reach the vendor HTTPS API',
    brief: function () { return '`app-a` (private subnet, no public IP) calls `https://api.vendor.example` and every call times out since yesterday\'s network change window. The NAT gateway exists and other teams say it works. Investigate from the instance (`console ' + IDS.app1 + '`), state a hypothesis first, fix the smallest thing, and verify from the instance.'; },
    keys: ['note hypothesis: ', 'console ' + IDS.app1, 'curl -v --max-time 10 https://api.vendor.example/health', 'dig +short api.vendor.example', 'ip route', 'exit', 'aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=' + IDS.app, 'aws ec2 describe-route-tables --route-table-ids ' + IDS.rtApp, 'aws ec2 describe-nat-gateways'],
    world: function (seed) {
      var v = SIM().variantOf(seed, ['a', 'b']), t = baseNet();
      if (v === 'a') delete t.assoc[IDS.app];                                      /* falls back to the main table */
      else t.rtbs[IDS.rtApp].routes[1].target = IDS.igw;                           /* "default route to the IGW" */
      return NET().world(seed, t, { variant: v, prime: [[IDS.app1, VENDOR, 443], [IDS.app1, VENDOR, 443]] });
    },
    objectives: [
      { id: 'hypothesis', stage: 'evidence', text: 'Write a hypothesis before testing',
        hint: 'List what an HTTPS call from a private instance depends on, in order.', hint2: 'DNS, a route to the NAT gateway, the NAT\'s route to the IGW, filters both ways, TLS, HTTP. Pick the likeliest broken link: `note hypothesis: …`.',
        reveal: 'note hypothesis: name resolution works but the private subnet no longer routes 0.0.0.0/0 to the NAT gateway so connections time out',
        done: function (c) { return noted(c, 'hypothesis', 6); } },
      { id: 'reproduce', stage: 'evidence', text: 'Reproduce from the instance itself and read where it fails',
        hint: 'Test from where the problem is, not from your laptop.', hint2: '`console ' + IDS.app1 + '` then `curl -v --max-time 10 https://api.vendor.example/health`.',
        reveal: 'console ' + IDS.app1 + ' && curl -v --max-time 10 https://api.vendor.example/health',
        done: function (c) { return probed(c, function (p) { return p.at === IDS.app1 && p.port === 443 && p.result === 'timeout'; }); } },
      { id: 'dns', stage: 'evidence', text: 'Show that name resolution is not the problem',
        hint: 'curl printed an address before it timed out — or did it?', hint2: '`dig +short api.vendor.example` on the instance; the VPC resolver does not need the NAT gateway.',
        reveal: 'dig +short api.vendor.example',
        done: function (c) { return probed(c, function (p) { return p.tool === 'dig' && p.at === IDS.app1 && p.result === 'ok'; }) || saw(c, /^curl\b.*-v/, /Trying 192\.0\.2\.80/); } },
      { id: 'routes', stage: 'evidence', text: 'Find which route table the subnet really uses and where 0.0.0.0/0 goes',
        hint: '`ip route` on the instance only says "send it to the VPC router". The decision is in AWS.', hint2: '`aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=' + IDS.app + '` — an empty list means the MAIN table applies; then read that table\'s routes.',
        reveal: 'exit && aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=' + IDS.app + ' && aws ec2 describe-route-tables --route-table-ids ' + IDS.rtMain + ' ' + IDS.rtApp,
        done: function (c) { return saw(c, /^aws\s+ec2\s+describe-route-tables/, /RouteTables/) && saw(c, /^aws\s+ec2\s+describe-route-tables/, /0\.0\.0\.0\/0|"Main": true/); } },
      { id: 'fix', stage: 'fix', text: 'Restore the private subnet\'s path through the NAT gateway with the smallest change',
        hint: 'The NAT gateway is fine. What connects this subnet to it?', hint2: 'Either associate the subnet with the private route table, or point its 0.0.0.0/0 back at the NAT gateway — whichever is actually broken.',
        reveal: function (c) { return st(c).variant === 'a' ? 'aws ec2 associate-route-table --route-table-id ' + IDS.rtApp + ' --subnet-id ' + IDS.app : 'aws ec2 replace-route --route-table-id ' + IDS.rtApp + ' --destination-cidr-block 0.0.0.0/0 --nat-gateway-id ' + IDS.nat; },
        explain: 'Variant a: the subnet lost its explicit association, so it fell back to the main route table, which has only the local route — no default route at all. Variant b: the private table\'s default route was pointed at the internet gateway; the instance has no public IPv4 address, so the IGW has nothing to translate it to and drops the traffic. Fix the association (a) or the route target (b); DNS kept working throughout because the VPC resolver (10.20.0.2) does not use the NAT gateway.',
        done: function (c) { var r = conn(c, IDS.app1, VENDOR, 443); return r.result === 'ok' && r.via === 'nat' && !st(c).net.instances[IDS.app1].publicIp; } },
      { id: 'verify', stage: 'verify', text: 'Verify from the instance: the HTTPS call succeeds and leaves through the NAT gateway',
        hint: 'Same command as the reproduction, from the same place.', hint2: '`console …` then `curl --max-time 10 https://api.vendor.example/health`; `curl -s https://checkip.amazonaws.com` shows the NAT gateway\'s address.',
        reveal: 'console ' + IDS.app1 + ' && curl -v --max-time 10 https://api.vendor.example/health',
        done: function (c) { var L = lastProbe(c); return lastWasProbe(c) && L.at === IDS.app1 && L.port === 443 && L.result === 'ok'; } }
    ],
    sre: {
      scenarioId: 'N2', hub: HUB, moduleId: 'AR1-B', lab: null, variants: ['a', 'b'],
      symptom: 'HTTPS calls from a private instance time out; DNS works.',
      neutralTitle: 'A private instance\'s outbound HTTPS calls time out',
      neutralBrief: 'app-a, in a private subnet without a public IP, cannot complete HTTPS calls to api.vendor.example since yesterday\'s change window. The NAT gateway exists. Find the broken link with evidence, fix the smallest thing and verify from the instance.',
      impact: 'The app cannot reach a required vendor API.', changes: 'A network change window yesterday touched route tables.',
      spoilers: ['route table', 'association', 'main table', 'internet gateway', 'default route'],
      tools: TOOLS, grammar: GRAMMAR, palette: [],
      assumptions: ['The NAT gateway, its Elastic IP and its public subnet are correctly configured.', 'You may change route tables and associations.'],
      simplified: SIMPLIFIED,
      unsafe: [
        { label: 'gave the private instance a public address', why: 'Attaching a public IP (or moving the instance to the public subnet) turns a private workload into an internet-facing one to dodge a routing fault.',
          test: function (c) { return !!st(c).net.instances[IDS.app1].publicIp; },
          demo: ['aws ec2 allocate-address', 'aws ec2 associate-address --instance-id ' + IDS.app1 + ' --allocation-id eipalloc-0lab1'] },
        { label: 'opened the app security group to the internet', why: 'Inbound rules do not affect an outbound call\'s return traffic (security groups are stateful); 0.0.0.0/0 inbound only adds exposure.',
          test: function (c) { return hasBroadRule(st(c).net, IDS.sgApp, 443) || hasBroadRule(st(c).net, IDS.sgApp, 22); },
          demo: 'aws ec2 authorize-security-group-ingress --group-id ' + IDS.sgApp + ' --protocol tcp --port 443 --cidr 0.0.0.0/0' }
      ],
      alt: function (v) { return ['note hypothesis: the private subnet default route does not reach the NAT gateway any more', 'console ' + IDS.app1, 'curl --max-time 5 https://api.vendor.example/health', 'cat /etc/resolv.conf', 'dig +short api.vendor.example', 'exit',
        'aws ec2 describe-route-tables --filters Name=vpc-id,Values=' + IDS.vpc, 'aws ec2 describe-nat-gateways',
        v === 'a' ? 'aws ec2 associate-route-table --subnet-id ' + IDS.app + ' --route-table-id ' + IDS.rtApp : 'aws ec2 replace-route --route-table-id ' + IDS.rtApp + ' --destination-cidr-block 0.0.0.0/0 --nat-gateway-id ' + IDS.nat,
        'console ' + IDS.app1, 'curl -s https://checkip.amazonaws.com', 'curl --max-time 5 https://api.vendor.example/health']; },
      mechanism: 'A subnet uses exactly one route table: its explicit association, or the VPC\'s main table if it has none. The instance\'s own `ip route` cannot show this — it only points at the VPC router (.1). In variant a the explicit association was removed, so the subnet silently fell back to the main table, which has no default route; in variant b the default route was re-pointed at the internet gateway, which only translates for instances that have a public IPv4 address, so a private instance\'s packets are dropped. Either way TCP never completes and curl times out, while DNS keeps working because the VPC resolver at the VPC base +2 is reached without the NAT gateway. Restoring the association (or the NAT target) fixes it; `checkip` from the instance then shows the NAT gateway\'s Elastic IP.',
      alternatives: [
        { h: 'DNS is broken', out: 'Ruled out: dig on the instance returns 192.0.2.80, and curl -v prints "Trying 192.0.2.80:443" before timing out.' },
        { h: 'The NAT gateway is down', out: 'Ruled out: describe-nat-gateways shows it available, its own subnet routes to the IGW, and other subnets use it.' },
        { h: 'The security group blocks it', out: 'Ruled out: the group allows 443 outbound; security groups are stateful, so the reply needs no inbound rule.' },
        { h: 'The vendor is down', out: 'A timeout before TCP completes cannot tell you that; after the routing fix the same call succeeds.' }
      ],
      clues: ['`ip route` on the instance looks normal in every variant — it cannot see AWS route tables.'],
      passRubric: ['Tests from the instance, not the laptop', 'Separates DNS from routing with evidence', 'Explains explicit association vs main table, or why an IGW route cannot serve a private instance', 'Verifies from the instance and shows the NAT egress address'],
      prereqs: ['ar1-a-05', 'ar1-b-01', 'ar1-b-02'], refs: ['AWS-RT', 'AWS-NAT', 'AWS-IGW']
    }
  });

  /* ═══ N3 · Request allowed, reply blocked (network ACL) ═══════════ */
  LX.missions.push({
    id: 'ar1-n3', track: 'anduril', cat: 'awsnet', level: 'advanced', mins: 25, kind: 'incident',
    title: 'The status site times out after a subnet ACL was added',
    brief: function () { return 'The security team attached a custom network ACL to the public subnet yesterday ("only HTTPS in and out"). Since then `https://www.ridgeline.example` times out for everyone; `web-a` is running and nginx listens on 443. Find exactly which packet is dropped, make the minimal ACL change, and verify. Write your hypothesis first.'; },
    keys: ['note hypothesis: ', 'curl -v --max-time 10 https://www.ridgeline.example/', 'aws ec2 describe-security-groups --group-ids ' + IDS.sgWeb, 'aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=' + IDS.pub, 'aws logs filter-log-events --log-group-name /vpc/ridgeline-lab/flow --filter-pattern 203.0.113.30', 'aws logs filter-log-events --log-group-name /vpc/ridgeline-lab/flow --filter-pattern REJECT', 'note interpretation: '],
    world: function (seed) {
      var v = SIM().variantOf(seed, ['a', 'b']), t = baseNet();
      var entries = [
        { n: 100, proto: 'tcp', from: 443, to: 443, cidr: '0.0.0.0/0', action: 'allow', egress: false },
        { n: 110, proto: 'tcp', from: 1024, to: 65535, cidr: '0.0.0.0/0', action: 'allow', egress: false },
        { n: 100, proto: 'tcp', from: 443, to: 443, cidr: '0.0.0.0/0', action: 'allow', egress: true }
      ];
      if (v === 'b') {
        entries.push({ n: 50, proto: 'tcp', from: 32768, to: 65535, cidr: '0.0.0.0/0', action: 'deny', egress: true });
        entries.push({ n: 120, proto: 'tcp', from: 1024, to: 65535, cidr: '0.0.0.0/0', action: 'allow', egress: true });
      }
      t.nacls[IDS.aclWeb] = { id: IDS.aclWeb, name: 'public-https-only', subnets: [IDS.pub], entries: entries };
      /* keep the bastion out of this story: it lives in the same subnet but nobody is using it */
      return NET().world(seed, t, { variant: v, prime: [['client', '203.0.113.30', 443], ['client', '203.0.113.30', 443]] });
    },
    objectives: [
      { id: 'hypothesis', stage: 'evidence', text: 'Write a hypothesis before testing',
        hint: 'What changed, and what is different about a network ACL compared with a security group?', hint2: '`note hypothesis: …` naming which direction of which packet you think is dropped.',
        reveal: 'note hypothesis: the new network ACL lets the request in but its outbound rules block the reply to the client ephemeral port',
        done: function (c) { return noted(c, 'hypothesis', 6); } },
      { id: 'reproduce', stage: 'evidence', text: 'Reproduce from the laptop and classify the failure',
        hint: 'Timeout or refusal?', hint2: '`curl -v --max-time 10 https://www.ridgeline.example/`.',
        reveal: 'curl -v --max-time 10 https://www.ridgeline.example/',
        done: function (c) { return probed(c, function (p) { return p.at === 'laptop' && p.port === 443 && p.result === 'timeout'; }); } },
      { id: 'layers', stage: 'evidence', text: 'Check the security group and the subnet\'s network ACL rules, in rule-number order',
        hint: 'Two filters sit in front of the instance; one remembers connections and one does not.', hint2: '`aws ec2 describe-security-groups --group-ids ' + IDS.sgWeb + '` and `aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=' + IDS.pub + '`.',
        reveal: 'aws ec2 describe-security-groups --group-ids ' + IDS.sgWeb + ' && aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=' + IDS.pub,
        done: function (c) { return saw(c, /^aws\s+ec2\s+describe-security-groups/, /IpPermissions/) && saw(c, /^aws\s+ec2\s+describe-network-acls/, /"RuleNumber"/); } },
      { id: 'flows', stage: 'evidence', text: 'Prove which direction is dropped with the flow logs, and note the client\'s port',
        hint: 'Flow logs record each direction separately, with ports.', hint2: '`aws logs filter-log-events --log-group-name /vpc/ridgeline-lab/flow --filter-pattern 203.0.113.30` (or 10.20.1.30); compare ACCEPT inbound to :443 with REJECT outbound to the client\'s high port. Then `note interpretation: …`.',
        reveal: 'aws logs filter-log-events --log-group-name /vpc/ridgeline-lab/flow --filter-pattern REJECT && note interpretation: inbound 443 is accepted but the reply from 443 to the client high port is rejected by the ACL outbound rules',
        done: function (c) { return saw(c, /^aws\s+logs\s+filter-log-events/, /10\.20\.1\.30 198\.51\.100\.45 443 \d+ 6 \d+ \d+ \d+ \d+ REJECT/) && noted(c, 'interpretation', 6); } },
      { id: 'fix', stage: 'fix', text: 'Change the ACL minimally so replies to clients\' ephemeral ports can leave — without allowing everything',
        hint: 'Clients choose their own source ports; macOS uses 49152–65535, many Linux kernels 32768–61000, NAT gateways and load balancers 1024–65535.', hint2: 'Variant without a deny: add an outbound allow for TCP 1024-65535. With a lower-numbered deny: rules are evaluated lowest number first — fix the deny (replace or delete it) or add an allow with a smaller number.',
        reveal: function (c) { return st(c).variant === 'a'
          ? 'aws ec2 create-network-acl-entry --network-acl-id ' + IDS.aclWeb + ' --egress --rule-number 110 --protocol tcp --port-range From=1024,To=65535 --cidr-block 0.0.0.0/0 --rule-action allow'
          : 'aws ec2 delete-network-acl-entry --network-acl-id ' + IDS.aclWeb + ' --egress --rule-number 50'; },
        explain: 'The ACL is stateless: an inbound allow for 443 says nothing about the reply. The reply leaves the subnet from port 443 to the client\'s ephemeral port (e.g. 198.51.100.45:5xxxx on macOS). Variant a has no outbound rule for that range, so the implicit deny (*) drops it. Variant b has an allow at rule 120 but an earlier rule 50 denies 32768–65535; lower numbers win, so the deny applies first. Add an outbound allow for TCP 1024–65535 (variant a), or remove/replace rule 50 or insert an allow below 50 (variant b).',
        done: function (c) { var t = st(c).net, acl = t.nacls[IDS.aclWeb]; var broad = acl.entries.some(function (e) { return e.action === 'allow' && (e.proto === '-1' || e.proto === 'all') && e.cidr === '0.0.0.0/0'; }); return !broad && acl.subnets.indexOf(IDS.pub) !== -1 && conn(c, 'client', '203.0.113.30', 443).result === 'ok'; } },
      { id: 'verify', stage: 'verify', text: 'Verify from the laptop: the page loads over HTTPS',
        hint: 'Repeat the reproduction.', hint2: '`curl -v --max-time 10 https://www.ridgeline.example/`.',
        reveal: 'curl -v --max-time 10 https://www.ridgeline.example/',
        done: function (c) { var L = lastProbe(c); return lastWasProbe(c) && L.at === 'laptop' && L.port === 443 && L.result === 'ok'; } }
    ],
    sre: {
      scenarioId: 'N3', hub: HUB, moduleId: 'AR1-B', lab: null, variants: ['a', 'b'],
      symptom: 'HTTPS to a public web instance times out for every client; the server is up.',
      neutralTitle: 'A public HTTPS site times out after a security change',
      neutralBrief: 'Since yesterday\'s security change on the public subnet, https://www.ridgeline.example times out for everyone, while web-a is running and nginx listens on 443. Find which packet is dropped, make the minimal change and verify.',
      impact: 'The public status site is unreachable.', changes: 'A subnet-level filter was added yesterday by the security team.',
      spoilers: ['ephemeral', 'network ACL', 'NACL', 'stateless', 'outbound rule', 'rule 50'],
      tools: TOOLS, grammar: GRAMMAR, palette: [],
      assumptions: ['The ACL\'s intent is legitimate: only HTTPS should be allowed in.', 'You may change the ACL entries.'],
      simplified: SIMPLIFIED,
      unsafe: [
        { label: 'allowed all traffic through the ACL', why: 'An allow-all entry (protocol -1 to/from 0.0.0.0/0) removes the control the security team added; only the reply range needed opening.',
          test: function (c) { return st(c).net.nacls[IDS.aclWeb].entries.some(function (e) { return e.action === 'allow' && (e.proto === '-1' || e.proto === 'all') && e.cidr === '0.0.0.0/0'; }); },
          demo: 'aws ec2 create-network-acl-entry --network-acl-id ' + IDS.aclWeb + ' --egress --rule-number 10 --protocol -1 --cidr-block 0.0.0.0/0 --rule-action allow' }
      ],
      alt: function (v) { return ['note hypothesis: the subnet ACL is stateless and nothing allows the reply traffic out to the client', 'nc -vz -w 5 www.ridgeline.example 443', 'aws ec2 describe-network-acls --network-acl-ids ' + IDS.aclWeb, 'aws ec2 describe-security-groups --group-ids ' + IDS.sgWeb,
        'aws logs filter-log-events --log-group-name /vpc/ridgeline-lab/flow --filter-pattern 198.51.100.45', 'note interpretation: SYN to 443 accepted, SYN-ACK back to the client ephemeral port rejected by an outbound ACL rule',
        v === 'a' ? 'aws ec2 create-network-acl-entry --network-acl-id ' + IDS.aclWeb + ' --egress --rule-number 120 --protocol tcp --port-range From=1024,To=65535 --cidr-block 0.0.0.0/0 --rule-action allow'
                  : 'aws ec2 replace-network-acl-entry --network-acl-id ' + IDS.aclWeb + ' --egress --rule-number 50 --protocol tcp --port-range From=1024,To=65535 --cidr-block 0.0.0.0/0 --rule-action allow',
        'nc -vz -w 5 www.ridgeline.example 443']; },
      mechanism: 'A network ACL is stateless and evaluated in rule-number order, lowest first, first match wins, with an implicit deny (*) at the end. The client (macOS here) opens 198.51.100.45:5xxxx → 203.0.113.30:443. The inbound SYN matches rule 100 and the security group (stateful) allows it, so nginx answers — but the SYN-ACK must leave the subnet from 443 to the client\'s ephemeral port, and that is a separate outbound evaluation. With only "outbound 443" allowed (variant a) the reply hits the implicit deny; in variant b an earlier rule 50 denies 32768–65535 before the allow at 120 is reached. The client never receives the SYN-ACK and times out. Allowing TCP 1024–65535 outbound (the range AWS recommends to cover NAT gateways, load balancers and varied client OSes) — or removing the shadowing deny — fixes it without loosening inbound.',
      alternatives: [
        { h: 'nginx is down', out: 'Ruled out: the flow logs show the inbound SYN accepted, and a down service would be "connection refused".' },
        { h: 'The security group', out: 'Ruled out: it allows 443 from anywhere, and security groups automatically allow the reply.' },
        { h: 'Routing back to the client', out: 'Ruled out: the public subnet routes 0.0.0.0/0 to the IGW; the flow log shows the reply REJECTed at the ACL, not missing.' }
      ],
      clues: ['The inbound rule 110 for 1024–65535 is for replies to connections the subnet starts — it does nothing for this direction.'],
      passRubric: ['Distinguishes stateless ACLs from stateful security groups', 'Names the client\'s ephemeral port and the reply direction from flow-log evidence', 'Explains rule-number ordering (variant b) and the implicit deny', 'Fixes narrowly and verifies on the user path'],
      prereqs: ['ar1-a-06', 'ar1-b-03'], refs: ['AWS-NACL', 'AWS-NACL-EPH', 'AWS-FLOW-EX']
    }
  });

  /* ═══ N4 · Name exists at the authority, not in the world (DNS) ══ */
  var PARENT = 'ridgeline.example', CHILD = 'ops.ridgeline.example', TARGET = 'reports.ops.ridgeline.example';
  var NEW_NS = ['ns-1342.awsdns-lab-39.example', 'ns-217.awsdns-lab-27.example'], OLD_NS = ['ns-0901.awsdns-lab-12.example', 'ns-1630.awsdns-lab-04.example'];
  var NS_IP = { 'ns-1342.awsdns-lab-39.example': '10.99.1.21', 'ns-217.awsdns-lab-27.example': '10.99.1.22', 'ns-0901.awsdns-lab-12.example': '10.99.9.31', 'ns-1630.awsdns-lab-04.example': '10.99.9.32', 'ns-401.awsdns-lab-50.example': '10.99.0.11' };
  function dnsWorld(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
    var state = { clock: 0, risky: [], hooks: [], variant: v, notes: [],
      dns: { root: '10.99.0.1', defaultServer: '10.30.0.53',
        zones: {
          'example': { ns: ['10.99.0.1'], negTtl: 300, records: {}, delegations: {} },
          'ridgeline.example': { ns: ['10.99.0.11'], negTtl: 300, records: { 'www.ridgeline.example': { A: ['203.0.113.30'] } }, delegations: v === 'a' ? {} : { 'ops.ridgeline.example': ['10.99.9.31', '10.99.9.32'] } },
          'ops.ridgeline.example': { ns: ['10.99.1.21', '10.99.1.22'], negTtl: 60, records: { 'reports.ops.ridgeline.example': { A: ['10.20.11.40'] }, 'grafana.ops.ridgeline.example': { A: ['10.20.11.41'] } } }
        },
        servers: { '10.99.0.1': { zones: ['example'] }, '10.99.0.11': { zones: ['ridgeline.example'] }, '10.99.1.21': { zones: ['ops.ridgeline.example'] }, '10.99.1.22': { zones: ['ops.ridgeline.example'] },
          '10.99.9.31': { zones: [] }, '10.99.9.32': { zones: [] }, '10.30.0.53': { recursive: true, cache: {} } } } };
    /* 10.99.9.31/.32 are the deleted zone's old servers: they still answer, but REFUSE this zone (a lame delegation) */
    state.dns.zones['example'].delegations['ridgeline.example'] = ['10.99.0.11'];
    /* the reported failure already happened, so the corporate resolver has it cached */
    S.dns.recurse(state, '10.30.0.53', TARGET, 'A');
    var parentDelegation = function () { var d = state.dns.zones[PARENT].delegations[CHILD]; return d ? d.slice() : null; };
    var nsNamesFor = function (ips) { return Object.keys(NS_IP).filter(function (n) { return ips.indexOf(NS_IP[n]) !== -1; }); };
    var r53 = function (w, a) {
      var m = NET().argMap(a.slice(1)), op = a[0];
      var zid = { Z0PARENTRIDGE01: PARENT, Z0OPSCHILD0042: CHILD };
      if (op === 'list-hosted-zones') return S.ok(JSON.stringify({ HostedZones: [{ Id: '/hostedzone/Z0PARENTRIDGE01', Name: PARENT + '.', ResourceRecordSetCount: 3 }, { Id: '/hostedzone/Z0OPSCHILD0042', Name: CHILD + '.', ResourceRecordSetCount: 4 }] }, null, 4));
      if (op === 'get-hosted-zone') { var z0 = zid[String(m.id || '').replace('/hostedzone/', '')]; if (!z0) return S.err('An error occurred (NoSuchHostedZone) when calling the GetHostedZone operation', 254); return S.ok(JSON.stringify({ HostedZone: { Id: '/hostedzone/' + m.id, Name: z0 + '.' }, DelegationSet: { NameServers: z0 === CHILD ? NEW_NS : ['ns-401.awsdns-lab-50.example'] } }, null, 4)); }
      if (op === 'list-resource-record-sets') {
        var zn = zid[String(m['hosted-zone-id'] || '').replace('/hostedzone/', '')];
        if (!zn) return S.err('An error occurred (NoSuchHostedZone) when calling the ListResourceRecordSets operation: No hosted zone found with ID: ' + m['hosted-zone-id'], 254);
        var z = state.dns.zones[zn], rr = [{ Name: zn + '.', Type: 'NS', TTL: 172800, ResourceRecords: (zn === CHILD ? NEW_NS : ['ns-401.awsdns-lab-50.example']).map(function (x) { return { Value: x + '.' }; }) }, { Name: zn + '.', Type: 'SOA', TTL: 900, ResourceRecords: [{ Value: 'ns-401.awsdns-lab-50.example. hostmaster.example. 1 7200 900 1209600 ' + z.negTtl }] }];
        Object.keys(z.delegations || {}).forEach(function (d) { rr.push({ Name: d + '.', Type: 'NS', TTL: 172800, ResourceRecords: nsNamesFor(z.delegations[d]).map(function (x) { return { Value: x + '.' }; }) }); });
        Object.keys(z.records || {}).forEach(function (n) { Object.keys(z.records[n]).forEach(function (ty) { if (ty !== 'ttl') rr.push({ Name: n + '.', Type: ty, TTL: 300, ResourceRecords: z.records[n][ty].map(function (x) { return { Value: x }; }) }); }); });
        return S.ok(JSON.stringify({ ResourceRecordSets: rr }, null, 4));
      }
      if (op === 'change-resource-record-sets') {
        var zn2 = zid[String(m['hosted-zone-id'] || '').replace('/hostedzone/', '')];
        if (!zn2) return S.err('An error occurred (NoSuchHostedZone) when calling the ChangeResourceRecordSets operation', 254);
        var raw = m['change-batch'];
        if (!raw || raw === true) return S.err('aws: error: the following arguments are required: --change-batch', 252);
        if (/^file:\/\//.test(raw)) { raw = S.readFile(w, raw.slice(7)); if (raw == null) return S.err('Error parsing parameter \'--change-batch\': Unable to load paramfile', 255); }
        var batch; try { batch = JSON.parse(String(raw).replace(/^'|'$/g, '')); } catch (e) { return S.err('Error parsing parameter \'--change-batch\': Invalid JSON: ' + e.message, 252); }
        var changes = (batch && batch.Changes) || [];
        for (var i = 0; i < changes.length; i++) {
          var ch = changes[i], rs = ch.ResourceRecordSet || {}, nm = String(rs.Name || '').replace(/\.$/, ''), ty = rs.Type, vals = (rs.ResourceRecords || []).map(function (r) { return String(r.Value).replace(/\.$/, ''); });
          if (!/^(CREATE|UPSERT|DELETE)$/.test(ch.Action)) return S.err('An error occurred (InvalidInput) when calling the ChangeResourceRecordSets operation: Invalid action ' + ch.Action, 254);
          var zz = state.dns.zones[zn2];
          if (ty === 'NS' && nm !== zn2) {
            if (ch.Action === 'DELETE') { delete zz.delegations[nm]; continue; }
            if (ch.Action === 'CREATE' && zz.delegations[nm]) return S.err('An error occurred (InvalidChangeBatch) when calling the ChangeResourceRecordSets operation: [Tried to create resource record set [name=\'' + nm + '.\', type=\'NS\'] but it already exists]', 254);
            zz.delegations[nm] = vals.map(function (x) { return NS_IP[x] || ('unresolved:' + x); });
          } else if (/^(A|CNAME|TXT)$/.test(ty)) {
            zz.records = zz.records || {}; zz.records[nm] = zz.records[nm] || {};
            if (ch.Action === 'DELETE') delete zz.records[nm][ty]; else zz.records[nm][ty] = vals;
          } else return S.err('simulation: only NS (delegation), A, CNAME and TXT changes are modelled here', 2);
        }
        return S.ok(JSON.stringify({ ChangeInfo: { Id: '/change/C0LAB' + (state.clock / 10), Status: 'PENDING', SubmittedAt: '2026-10-13T09:00:00Z' } }, null, 4) + '\n(simulation: the change is in sync on the authoritative servers immediately; resolvers may still hold cached answers)');
      }
      return S.unsupported('aws route53', op || '', ['list-hosted-zones', 'get-hosted-zone --id Z…', 'list-resource-record-sets --hosted-zone-id Z…', 'change-resource-record-sets --hosted-zone-id Z… --change-batch \'{json}\'|file://PATH']);
    };
    var verbs = {
      dig: S.verbs.dig(state),
      aws: function (w, a) { if (a[0] === 'route53') return r53(w, a.slice(1)); return S.unsupported('aws', a[0] || '', ['route53 (this scenario)']); },
      rndc: function (w, a) {
        var srv = state.dns.servers['10.30.0.53'];
        if (a[0] === 'flushname' && a[1]) { var n = 0; Object.keys(srv.cache).forEach(function (k) { if (k.indexOf(a[1].replace(/\.$/, '') + '/') === 0) { delete srv.cache[k]; n++; } }); return S.ok('(simulated rndc on the corporate resolver 10.30.0.53) flushed ' + n + ' entr' + (n === 1 ? 'y' : 'ies') + ' for ' + a[1]); }
        if (a[0] === 'flush') { srv.cache = {}; return S.ok('(simulated) cache flushed on 10.30.0.53'); }
        if (a[0] === 'dumpdb' || a[0] === 'cache') { var ks = Object.keys(srv.cache); return S.ok(ks.length ? ks.map(function (k) { var c = srv.cache[k]; return k + '  ' + c.res.status + '  expires in ' + Math.max(0, c.expires - state.clock) + 's'; }).join('\n') : '(cache empty)'); }
        return S.unsupported('rndc', a[0] || '', ['flushname NAME', 'flush', 'cache (show entries — a stand-in for dumpdb)']);
      },
      sleep: function (w, a) { var n = Math.min(900, Math.max(0, parseInt(a[0], 10) || 0)); state.clock += n; return S.ok(''); },
      note: NET().tools(state).note
    };
    return { user: 'brett', host: 'ops-workstation', cwd: '/home/brett',
      files: [{ path: '/etc/resolv.conf', content: 'nameserver 10.30.0.53\nsearch corp.ridgeline.example\n' }, { path: '/home/brett/README-dns.md', content: '# ridgeline DNS (fictional)\nParent zone ridgeline.example — Route 53 hosted zone Z0PARENTRIDGE01 (ns-401.awsdns-lab-50.example = 10.99.0.11)\nChild zone ops.ridgeline.example — hosted zone Z0OPSCHILD0042, recreated last week\nCorporate recursive resolver: 10.30.0.53 (BIND; rndc available)\n' }],
      sre: state, extra: S.bind(state, verbs) };
  }
  function delegationOk(c) { var d = st(c).dns.zones[PARENT].delegations[CHILD] || []; return d.length === 2 && d.indexOf('10.99.1.21') !== -1 && d.indexOf('10.99.1.22') !== -1; }
  function shadow(c) { var r = st(c).dns.zones[PARENT].records || {}; return Object.keys(r).some(function (n) { return n === TARGET || n.slice(-CHILD.length - 1) === '.' + CHILD; }); }
  var DELEG_JSON = '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"ops.ridgeline.example","Type":"NS","TTL":172800,"ResourceRecords":[{"Value":"ns-1342.awsdns-lab-39.example"},{"Value":"ns-217.awsdns-lab-27.example"}]}}]}';

  LX.missions.push({
    id: 'ar1-n4', track: 'anduril', cat: 'awsnet', level: 'advanced', mins: 30, kind: 'incident',
    title: 'reports.ops.ridgeline.example does not resolve, but Route 53 shows the record',
    brief: function () { return 'The platform team says `reports.ops.ridgeline.example` "is in Route 53" — and it is, in the `ops.ridgeline.example` hosted zone. From your workstation (corporate resolver 10.30.0.53) the name does not resolve. Prove where resolution breaks, repair it where it belongs, and show a fresh lookup works — accounting for what the resolver already cached. Hypothesis first (`note hypothesis: …`).'; },
    keys: ['note hypothesis: ', 'dig ' + TARGET, 'dig @10.99.1.21 +norecurse ' + TARGET, 'dig @10.99.0.11 +norecurse ' + CHILD + ' NS', 'dig +trace ' + TARGET, 'aws route53 list-hosted-zones', 'aws route53 get-hosted-zone --id Z0OPSCHILD0042', 'aws route53 list-resource-record-sets --hosted-zone-id Z0PARENTRIDGE01', 'rndc cache', 'rndc flushname ' + TARGET],
    world: function (seed) { return dnsWorld(seed); },
    objectives: [
      { id: 'hypothesis', stage: 'evidence', text: 'Write a hypothesis before testing',
        hint: 'The record exists somewhere. What has to be true for a resolver to find it?', hint2: '`note hypothesis: …` — think about how a resolver walks from the parent zone to the child.',
        reveal: 'note hypothesis: the child zone has the record but the parent zone does not delegate to its current name servers so resolvers never reach it',
        done: function (c) { return noted(c, 'hypothesis', 6); } },
      { id: 'recursive', stage: 'evidence', text: 'Reproduce through the resolver you actually use and record the status',
        hint: 'NXDOMAIN and SERVFAIL are different findings.', hint2: '`dig ' + TARGET + '` (uses 10.30.0.53).',
        reveal: 'dig ' + TARGET,
        done: function (c) { return saw(c, /^dig\b(?!.*@)(?!.*\+trace)/, /status: (NXDOMAIN|SERVFAIL)/); } },
      { id: 'authoritative', stage: 'evidence', text: 'Prove the child zone\'s own name servers answer for the record',
        hint: 'Ask the authority directly, without recursion.', hint2: '`aws route53 get-hosted-zone --id Z0OPSCHILD0042` lists its name servers; `dig @10.99.1.21 +norecurse ' + TARGET + '`.',
        reveal: 'aws route53 get-hosted-zone --id Z0OPSCHILD0042 && dig @10.99.1.21 +norecurse ' + TARGET,
        done: function (c) { return saw(c, /^dig\b.*@10\.99\.1\.2[12]/, /10\.20\.11\.40/); } },
      { id: 'parent', stage: 'evidence', text: 'Check what the parent zone says about the child (delegation)',
        hint: 'A resolver only reaches the child if the parent refers it there — to the right servers.', hint2: '`dig @10.99.0.11 +norecurse ' + CHILD + ' NS`, `dig +trace ' + TARGET + '`, or list the parent zone\'s records.',
        reveal: 'dig @10.99.0.11 +norecurse ' + CHILD + ' NS && aws route53 list-resource-record-sets --hosted-zone-id Z0PARENTRIDGE01',
        done: function (c) { return saw(c, /^dig\b.*(@10\.99\.0\.11|\+trace)/, /NXDOMAIN|AUTHORITY SECTION|referral|delegation is broken|none of/) || saw(c, /^aws\s+route53\s+list-resource-record-sets.*Z0PARENT/, /ResourceRecordSets/); } },
      { id: 'fix', stage: 'fix', text: 'Repair the delegation in the parent zone so it points at the child\'s current name servers',
        hint: 'Fix the link in the chain, not the answer at the end of it.', hint2: 'An NS record set for ops.ridgeline.example in the PARENT hosted zone, with the child zone\'s name servers (get-hosted-zone shows them). UPSERT replaces a stale set.',
        reveal: 'aws route53 change-resource-record-sets --hosted-zone-id Z0PARENTRIDGE01 --change-batch \'' + DELEG_JSON + '\'',
        explain: 'The record lives in the child hosted zone, but resolvers start at the parent. Variant a: the parent has no NS records for ops.ridgeline.example, so the parent answers NXDOMAIN itself (with its SOA, and the resolver caches that negative answer for the SOA minimum, 300 s here). Variant b: the child zone was deleted and recreated last week, which gave it a NEW set of name servers; the parent still lists the OLD ones, which refuse queries, so resolvers get SERVFAIL. Fix: UPSERT the NS record set in the parent with the child\'s current servers. Then account for caching: flush the name on the resolver you control, or wait out the negative TTL, before calling it verified.',
        done: function (c) { return delegationOk(c) && !shadow(c); } },
      { id: 'fresh', stage: 'verify', text: 'Verify with a fresh recursive lookup from your workstation — not a cached answer',
        hint: 'The resolver remembers "no" for a while. Your fix does not change its memory.', hint2: '`rndc cache` shows what 10.30.0.53 holds; `rndc flushname ' + TARGET + '` (or `sleep 300`) and then `dig ' + TARGET + '`.',
        reveal: 'rndc flushname ' + TARGET + ' && dig ' + TARGET,
        done: function (c) { return delegationOk(c) && lastIs(c, /^dig\b(?!.*@)(?!.*\+norec)/, /10\.20\.11\.40/); } }
    ],
    sre: {
      scenarioId: 'N4', hub: HUB, moduleId: 'AR1-B', lab: null, variants: ['a', 'b'],
      symptom: 'A name that exists in Route 53 does not resolve from the corporate network.',
      neutralTitle: 'A DNS name exists in Route 53 but does not resolve',
      neutralBrief: 'reports.ops.ridgeline.example exists in a Route 53 hosted zone, yet lookups from your workstation fail. Prove where resolution breaks, repair it in the right place and show that a fresh lookup works.',
      impact: 'The reporting service is unreachable by name.', changes: 'The child hosted zone was set up (or recreated) recently.',
      spoilers: ['delegation', 'NS record', 'negative cach', 'parent zone', 'name servers', 'recreated'],
      tools: ['dig (@server, +norecurse, +trace, +short, NS)', 'aws route53 list-hosted-zones|get-hosted-zone|list-resource-record-sets|change-resource-record-sets', 'rndc flushname|flush|cache (simulated, corporate BIND resolver)', 'sleep N (advances the clock)', 'note'],
      grammar: ['`dig [@SERVER] NAME [A|NS|SOA] [+short] [+norecurse] [+trace]`', '`aws route53 list-hosted-zones`, `get-hosted-zone --id Z…`, `list-resource-record-sets --hosted-zone-id Z…`, `change-resource-record-sets --hosted-zone-id Z… --change-batch \'{"Changes":[…]}\'`', '`rndc cache|flushname NAME|flush` (simulated stand-in for BIND\'s rndc on 10.30.0.53)', '`sleep SECONDS`', '`note hypothesis: …` / `note interpretation: …`'],
      palette: [],
      assumptions: ['Both hosted zones are in your account (in real life the parent is often owned by another team or account).', 'You can flush the corporate resolver\'s cache; the VPC Route 53 Resolver has no flush — there you wait for the TTL.'],
      simplified: ['DNS is modelled as authoritative zones with delegations and one recursive resolver with a cache, TTLs in logical seconds (10 per command, or `sleep`).', 'No DNSSEC, glue subtleties or IPv6; name-server hostnames map to fixed addresses.', 'Route 53 changes are in sync immediately; real changes take a short time (GetChange shows INSYNC).'],
      unsafe: [
        { label: 'added a shadow record in the parent instead of delegating', why: 'An A record for the child\'s name in the parent zone makes this one lookup succeed and silently diverges from the child zone the platform team maintains; every other name in the child stays broken.',
          test: function (c) { return shadow(c); },
          demo: 'aws route53 change-resource-record-sets --hosted-zone-id Z0PARENTRIDGE01 --change-batch \'{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"reports.ops.ridgeline.example","Type":"A","TTL":300,"ResourceRecords":[{"Value":"10.20.11.40"}]}}]}\'' }
      ],
      alt: function () { return ['note hypothesis: resolvers cannot follow the parent zone to the current child name servers', 'dig +short ' + TARGET, 'dig ' + TARGET, 'aws route53 list-hosted-zones', 'aws route53 get-hosted-zone --id Z0OPSCHILD0042', 'dig @10.99.1.22 +norecurse ' + TARGET, 'dig +trace ' + TARGET,
        'aws route53 change-resource-record-sets --hosted-zone-id Z0PARENTRIDGE01 --change-batch \'' + DELEG_JSON + '\'', 'rndc cache', 'sleep 300', 'dig ' + TARGET]; },
      mechanism: 'Resolution has two halves: the data (the child hosted zone has the A record — "it is in Route 53" is true) and the path to it (a resolver walks from the root through the parent zone, which must hand out an NS referral to the child\'s CURRENT name servers). A Route 53 hosted zone gets its own name-server set when created; recreating it changes the set. Without the referral (variant a) the parent answers NXDOMAIN authoritatively; with a stale referral (variant b) the listed servers refuse and the resolver returns SERVFAIL. After the parent is fixed, a recursive resolver can still return the old negative answer until its cached entry expires (RFC 2308: the SOA minimum/TTL bounds negative caching) — verification must use a fresh lookup.',
      alternatives: [
        { h: 'The record is missing', out: 'Ruled out by `dig @10.99.1.21 +norecurse`: the child\'s authority answers 10.20.11.40.' },
        { h: 'The workstation cannot reach DNS', out: 'Ruled out: other names resolve and the resolver answers with a status.' },
        { h: 'Add the A record to the parent', out: 'Rejected: it masks the delegation fault and creates two sources of truth.' }
      ],
      clues: ['The README says the child zone was recreated last week — that is why its name servers changed.'],
      passRubric: ['Separates authoritative from recursive answers with the right dig forms', 'Shows what the parent says (missing or stale NS) with evidence', 'Explains negative caching and why the fix is not instantly visible', 'Verifies with a fresh recursive lookup after flush or TTL'],
      prereqs: ['ar1-a-03'], refs: ['AWS-R53-SUB', 'RFC-2308', 'RFC-7766']
    }
  });

  /* ═══ N5 · Evidence card: TCP connects, the request still fails ══ */
  LX.ar1Cards.push({
    id: 'N5', title: 'Connection succeeds, request fails', mins: 15, module: 'B',
    brief: 'From `app-a`, `nc -vz api.partner.example 443` succeeds every time, but the job that calls `https://api.partner.example/v2/upload` fails. A teammate suggests "opening the firewall". Use the evidence below to decide what layer is failing and what the minimal next action is.',
    variants: [
      { id: 'a', label: 'Variant A — certificate name',
        evidence: [
          { cmd: 'nc -vz -w 5 api.partner.example 443', out: 'Ncat: Connected to 192.0.2.90:443.\nNcat: 0 bytes sent, 0 bytes received in 0.03 seconds.' },
          { cmd: 'curl -sS https://api.partner.example/v2/upload', out: 'curl: (60) SSL: no alternative certificate subject name matches target host name \'api.partner.example\'\nMore details here: https://curl.se/docs/sslcerts.html' },
          { cmd: 'openssl s_client -connect api.partner.example:443 -servername api.partner.example </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName', out: 'subject=CN = legacy-gw.partner.example\nX509v3 Subject Alternative Name:\n    DNS:legacy-gw.partner.example, DNS:gw.partner.example' }
        ],
        layer: 'TLS (server identity)', fix: 'Ask the partner (or whoever runs that endpoint) to serve a certificate whose SAN includes api.partner.example — or call the hostname the certificate is actually issued for if that is the documented endpoint. Do not add -k or disable verification.',
        verify: '`curl -sS https://api.partner.example/v2/upload` completes the handshake (no curl 60) and returns an HTTP status from the application.' },
      { id: 'b', label: 'Variant B — application error',
        evidence: [
          { cmd: 'nc -vz -w 5 api.partner.example 443', out: 'Ncat: Connected to 192.0.2.90:443.' },
          { cmd: 'curl -sS -o /dev/null -w "%{http_code} %{time_total}\\n" https://api.partner.example/v2/upload', out: '503 0.084' },
          { cmd: 'curl -sS -i https://api.partner.example/v2/upload', out: 'HTTP/2 503\nretry-after: 120\nx-request-id: 4f1e8a2c-lab\ncontent-type: application/json\n\n{"error":"upstream_unavailable","detail":"storage backend maintenance until 14:00Z"}' }
        ],
        layer: 'Application (HTTP 503 from the service)', fix: 'Nothing to change on your network: TCP and TLS work and the server answered. Honour Retry-After with bounded retries, and escalate to the partner with the request id if it persists past the stated window.',
        verify: 'After the window, the same request returns 2xx; your job logs show bounded retries, not a retry storm.' }
    ],
    questions: [
      { q: 'What does a successful `nc -vz … 443` prove?', choices: ['A TCP handshake completed: name resolution, routing and filtering for 443 work in both directions', 'The HTTPS service is healthy', 'The certificate is valid', 'Nothing — nc is unreliable'], a: 0, why: 'A completed handshake proves the network path for that port; TLS and HTTP are later layers it never touches.' },
      { q: 'Your teammate wants to "open the firewall". Why is that wrong here?', choices: ['Filtering is already proven fine by the completed TCP connection; the failure is in TLS or the application', 'Firewalls cannot be changed during incidents', 'Opening it would fix TLS too', 'It is right if done for 443 only'], a: 0, why: 'A security-group or ACL change cannot alter a certificate or an HTTP response.' }
    ],
    unsafe: ['Opening security groups or ACLs (the TCP path already works)', 'Using `curl -k` / disabling verification as the "fix"'],
    refs: ['RFC-8446', 'RFC-9293']
  });

  /* ═══ N6 · Evidence card: private access design ═════════════════════ */
  LX.ar1Cards.push({
    id: 'N6', title: 'Private service access: gateway endpoint or NAT?', mins: 15, module: 'B',
    brief: 'app-a in a private subnet must read and write objects in one S3 bucket in the same Region (about 40 GB/day) and also call api.vendor.example on the internet. Security wants S3 traffic to stay off the internet and the bucket to accept requests only from this VPC. Compare an endpoint-based path with a NAT-based path for S3, and pick a design.',
    options: [
      { id: 'gw', label: 'S3 gateway endpoint for S3 + NAT gateway for the vendor API', verdict: 'strong',
        why: 'S3 traffic follows a prefix-list route to the gateway endpoint (no hourly endpoint charge, no NAT data processing), the bucket policy can require aws:SourceVpce, and the endpoint policy can restrict to the one bucket. The vendor API still needs NAT because it is on the internet. DNS: S3\'s regional name resolves normally; the route table, not DNS, steers it.' },
      { id: 'if', label: 'S3 interface endpoint (PrivateLink) + NAT for the vendor API', verdict: 'defensible',
        why: 'Works and supports on-premises or cross-Region access through private IPs, but adds hourly and per-GB endpoint charges and security-group management; usually chosen when you need access from outside the VPC\'s route tables. DNS matters: private DNS or the endpoint-specific names must be used.' },
      { id: 'nat', label: 'NAT gateway only (S3 over the internet path)', verdict: 'weak',
        why: 'Functional, but S3 traffic is processed and billed by the NAT gateway, leaves through the internet gateway path, and the bucket cannot require a VPC endpoint condition. It does not meet the "off the internet / only this VPC" requirement.' },
      { id: 'pub', label: 'Public subnet with a public IP on app-a', verdict: 'reject',
        why: 'Exposes the workload and still does not satisfy the bucket restriction.' }
    ],
    considerations: ['Route tables: a gateway endpoint adds a prefix-list route to the route tables you choose — only those subnets use it.', 'Policies: endpoint policy (what can go through) and bucket policy (aws:SourceVpce) are separate controls.', 'DNS: gateway endpoints need no DNS change; interface endpoints rely on private DNS or endpoint DNS names.', 'Cost: NAT gateways charge per hour and per GB processed; gateway endpoints for S3 have no hourly or data-processing charge — check current pricing for your Region.'],
    rubric: ['States both requirements (S3 private + internet API) and maps each to a path', 'Explains route-table steering for gateway endpoints and DNS for interface endpoints', 'Names policy controls on both sides', 'Accepts that more than one design can be defensible and says when'],
    refs: ['AWS-GWEP', 'AWS-GWEP-S3', 'AWS-IFEP', 'AWS-NAT']
  });
})();
