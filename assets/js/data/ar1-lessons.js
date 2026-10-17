/* Anduril Round 1 prep — lessons for modules A (network fundamentals),
   B (AWS networking), C (Terraform), D (Bash), plus an optional glossary.

   Every lesson: plain-language explanation, precise explanation, a concrete
   example (and a diagram where it helps), a common misconception, an
   unassisted recall question, an application task, a 30–60 second
   "explain it aloud" prompt and a short self-check. Markdown-lite: blank
   lines between paragraphs, `- ` bullets, `code`, **bold**, ``` blocks. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.ar1Lessons = LX.ar1Lessons || [];

(function () {
  function L(x) { LX.ar1Lessons.push(x); }

  /* ═══ Module A — network fundamentals ════════════════════════════ */
  L({
    id: 'ar1-a-01', module: 'A', title: 'Addresses, ports, sockets and who is the client', mins: 4, prereqs: [],
    objectives: ['Name the four values that identify one TCP connection and say which side picks each.'],
    plain: 'An **IP address** finds a machine (strictly, an interface on it). A **port** finds a program on that machine. A **socket** is one end of a conversation: an address plus a port. The **client** is whoever starts the conversation; the **server** waits on a well-known port.',
    precise: 'A TCP connection is identified by the 4-tuple (source IP, source port, destination IP, destination port), plus the protocol. The server binds a listening socket to a fixed port (443, 22, 5432). The client\'s operating system picks the **source port** from its **ephemeral range** for each new connection — macOS uses 49152–65535, many Linux kernels 32768–60999. Every reply travels back to that ephemeral port, which is why filters must allow it on the return path. An instance can have several interfaces and addresses (a private IPv4 address always; a public IPv4 address only if one is assigned).',
    example: 'Your laptop at 198.51.100.45 runs `ssh bastion`:\n\n```\nsrc 198.51.100.45:51514  →  dst 203.0.113.25:22     (request)\nsrc 203.0.113.25:22      →  dst 198.51.100.45:51514 (every reply)\n```\n\nOpen a second ssh and the source port changes (say 51515); the server side stays :22. That is how one server port serves thousands of clients.',
    misconception: { wrong: 'A connection is "to port 22", so firewalls only need to think about port 22.', right: 'Only the request goes to 22. Replies go to the client\'s random high port. A stateful filter remembers the conversation and allows the reply automatically; a stateless one (a network ACL) needs an explicit rule for that high-port range.' },
    recall: [{ q: 'Without looking: what are the four values that identify a TCP connection, and which one does the client\'s operating system choose?', a: 'Source IP, source port, destination IP, destination port. The client OS chooses the source (ephemeral) port.' }],
    apply: { task: 'A web server on 10.20.1.30 answers a browser on a Windows Server 2019 client at 192.0.2.10. Write the 4-tuple of the reply packet, with a plausible port.', answer: 'src 10.20.1.30:443 → dst 192.0.2.10:<ephemeral>, e.g. 49731 (Windows Server 2008+ uses 49152–65535).' },
    explainAloud: 'Explain in under a minute what a socket is and why "allow port 443" is not the whole story for a stateless filter.',
    checklist: ['I can name the 4-tuple', 'I know macOS and Linux ephemeral ranges roughly', 'I can say where replies are addressed'],
    refs: ['RFC-9293', 'AWS-NACL-EPH']
  });

  L({
    id: 'ar1-a-02', module: 'A', title: 'TCP versus UDP, the handshake, and refused versus timeout', mins: 6, prereqs: ['ar1-a-01'],
    objectives: ['Explain the TCP handshake and what a timeout, a refusal and a success each prove.', 'Choose between TCP and UDP for a use case without over-simplifying.'],
    plain: '**TCP** sets up a conversation first (a handshake), then delivers bytes in order and resends what gets lost. **UDP** just sends individual messages; there is no handshake and no built-in resend. Neither is simply "better": TCP fits most request/response work, UDP fits small queries and real-time traffic where waiting for a resend is worse than a gap.',
    precise: 'TCP opens with **SYN → SYN-ACK → ACK**. If the client\'s SYN gets no answer it retransmits with back-off and eventually reports a **timeout** — something silently dropped the SYN or the SYN-ACK (a filter, a missing route, a dead host). If the host is reached but nothing listens on the port, it answers with **RST** and the client reports **connection refused** — the network path works. A completed handshake proves name resolution (if a name was used), routing and filtering for that port in both directions; it says nothing about TLS or the application. UDP is not automatically faster (QUIC and DNS-over-UDP add their own timers and retries in the application), and applications can build reliability on top of UDP. DNS uses **both**: UDP for most queries, TCP for large responses, zone transfers, and when a response is truncated (TC bit).',
    example: 'Two failures from a Mac:\n\n```\n$ nc -vz 203.0.113.25 22\nnc: connectx to 203.0.113.25 port 22 (tcp) failed: Operation timed out\n$ nc -vz 203.0.113.30 8443\nnc: connectx to 203.0.113.30 port 8443 (tcp) failed: Connection refused\n```\n\nThe first: something dropped packets (start with filters and routes). The second: the packets arrived and the host answered "nobody here" (start with the service, not the firewall).',
    misconception: { wrong: '"Connection refused" means a firewall blocked me.', right: 'A refusal is a TCP reset from a reachable host with nothing listening (or, occasionally, a device that actively rejects). Security groups and network ACLs drop silently, which looks like a timeout.' },
    recall: [{ q: 'What does each of these prove: a timeout, a refusal, a completed handshake?', a: 'Timeout: packets were dropped somewhere (filter, route, host down) — direction unknown. Refusal: the host was reached and nothing listens (path works). Handshake: the network path for that port works both ways; TLS/HTTP not tested.' }],
    apply: { task: 'A teammate says "ping fails, so the database is down". What do you run instead, and what would each outcome tell you?', answer: '`nc -vz db 5432` (or a client connect). Success: the port is reachable. Refused: host reachable, service not listening. Timeout: filter/route/host. Ping uses ICMP, which is often not allowed at all, so it proves nothing about TCP/5432.' },
    explainAloud: 'Walk through the TCP handshake and explain to a junior engineer why a timeout points at filters or routes while a refusal points at the service.',
    checklist: ['I can draw SYN/SYN-ACK/ACK', 'I can map timeout/refused/success to likely causes', 'I do not claim UDP is always faster', 'I know DNS uses TCP too'],
    refs: ['RFC-9293', 'RFC-7766']
  });

  L({
    id: 'ar1-a-03', module: 'A', title: 'DNS: recursion, authority, delegation, TTLs and negative caching', mins: 5, prereqs: ['ar1-a-02'],
    objectives: ['Separate an authoritative answer from a recursive one and explain delegation.', 'Explain negative caching and why a fix is not instantly visible.'],
    plain: 'Your machine asks a **recursive resolver** ("find this name for me"). The resolver asks the hierarchy: root → `example` → `ridgeline.example` → the zone that actually holds the record. Each level either answers or **refers** the resolver to the next level\'s name servers — that referral is **delegation**. The resolver remembers answers for their **TTL**, and also remembers "does not exist" for a while.',
    precise: 'An **authoritative** server answers for zones it hosts (flag `aa`). A parent zone delegates a child by publishing **NS records** for the child (plus glue where needed); if the parent has no NS for the child, the parent answers NXDOMAIN itself. If the NS records point at servers that do not serve the zone (a "lame delegation"), resolvers return **SERVFAIL**. Negative answers (NXDOMAIN/NODATA) are cached for the minimum of the SOA record\'s TTL and its MINIMUM field (RFC 2308). DNS runs over UDP and TCP port 53; TCP is required for truncated or large responses. In a VPC, the Amazon-provided resolver is at the VPC base address +2 (and 169.254.169.253).',
    example: '```\n$ dig reports.ops.ridgeline.example          # through your resolver\nstatus: NXDOMAIN\n$ dig @10.99.1.21 +norecurse reports.ops.ridgeline.example   # the child authority\nstatus: NOERROR, flags: qr aa;  ANSWER: 10.20.11.40\n$ dig @10.99.0.11 +norecurse ops.ridgeline.example NS        # the parent\nstatus: NXDOMAIN (no delegation)\n```\n\nThe record exists; resolvers cannot reach it. Fix the parent\'s NS records, then flush or wait out the negative cache before declaring success.',
    misconception: { wrong: 'If Route 53 shows the record, DNS is fine.', right: 'Route 53 holding the record proves the data exists in that zone. Resolution also needs the parent to delegate to that zone\'s current name servers, and resolvers to stop serving cached negative answers.' },
    recall: [{ q: 'Name the two dig forms that separate "the data" from "the path to the data".', a: '`dig @<authoritative server> +norecurse NAME` for the data; `dig NAME` (through the recursive resolver) or `dig +trace NAME` for the path.' }],
    apply: { task: 'After adding NS records in the parent, `dig NAME` still says NXDOMAIN with "answer served from cache, 240s left". What do you do and why?', answer: 'It is a cached negative answer. Flush that name on a resolver you control, or wait for the TTL (bounded by the SOA minimum) — then verify with a fresh recursive lookup. Do not change the zone again.' },
    explainAloud: 'Explain delegation and negative caching in under a minute, as if to someone who says "but the record is in Route 53".',
    checklist: ['I can name authoritative vs recursive', 'I can describe a delegation', 'I know NXDOMAIN vs SERVFAIL', 'I know DNS uses UDP and TCP', 'I know negative answers are cached'],
    refs: ['RFC-2308', 'RFC-7766', 'AWS-DNS', 'AWS-R53-SUB']
  });

  L({
    id: 'ar1-a-04', module: 'A', title: 'CIDR, subnet membership, overlaps and address counts', mins: 6, prereqs: [],
    objectives: ['Compute size, range and membership for an IPv4 CIDR block.', 'Distinguish total addresses from AWS-usable addresses.'],
    plain: '`10.20.1.0/24` means "the first 24 bits are fixed, the rest vary". Fewer fixed bits means a bigger block. Each step down in the number doubles the size: /24 is 256 addresses, /23 is 512, /25 is 128.',
    precise: 'A /n block has 2^(32−n) addresses. Its range runs from the network address (host bits zero) to the last address (host bits one). An address belongs to the block if its first n bits match. Two blocks **overlap** if either contains the other\'s network address (one is inside the other; aligned CIDR blocks never partially overlap). In AWS, an IPv4 subnet must be between /28 and /16, and **five addresses per subnet are reserved**: the network address, base+1 (VPC router), base+2 (DNS), base+3 (reserved for future use) and the last address. So a /24 has 256 total and 251 usable; a /28 has 16 total and 11 usable (BYOIP ranges are an exception).',
    example: '```\n10.20.11.0/24   → 10.20.11.0 – 10.20.11.255   256 total, 251 usable in AWS\n10.20.11.64/26  → 10.20.11.64 – 10.20.11.127   64 total, 59 usable\n198.51.100.0/27 → .0 – .31  → contains .17, does NOT contain .45\n10.20.0.0/16 and 10.20.8.0/21 overlap (the /21 sits inside the /16)\n```',
    misconception: { wrong: 'A /24 subnet in AWS gives me 254 hosts, like at home.', right: 'AWS reserves five addresses (first four and last), so 251. "254" counts only the network and broadcast addresses.' },
    recall: [{ q: 'How many total and AWS-usable addresses in a /26? What range does 10.0.0.128/26 cover?', a: '64 total, 59 usable in AWS. 10.0.0.128 – 10.0.0.191.' }],
    apply: { task: 'Your VPC is 10.30.0.0/16. Carve two public and two private /24 subnets that do not overlap, and say how many instances each can hold in AWS.', answer: 'For example 10.30.0.0/24, 10.30.1.0/24 (public) and 10.30.10.0/24, 10.30.11.0/24 (private); 251 usable addresses each (fewer once NAT gateways, endpoints or load balancers take addresses).' },
    explainAloud: 'Explain to a teammate how you check whether 198.51.100.45 is inside 198.51.100.0/27 without a calculator.',
    checklist: ['I can convert /n to a size', 'I can find a block\'s first and last address', 'I know the five AWS-reserved addresses', 'I can spot overlap'],
    refs: ['AWS-SUBNET', 'RFC-1918']
  });

  L({
    id: 'ar1-a-05', module: 'A', title: 'Routing, default routes, longest-prefix match and NAT', mins: 5, prereqs: ['ar1-a-04'],
    objectives: ['Predict which route a packet uses.', 'Explain how NAT lets private addresses reach the internet and how replies find their way back.'],
    plain: 'If the destination is on your own network, deliver it directly. Otherwise hand it to a **next hop** (a router) that is closer. The **default route** (0.0.0.0/0) is "everything else". When several routes match, the most specific wins. **NAT** rewrites the source address of private traffic to a public one on the way out and reverses that on the way back.',
    precise: 'Routing uses **longest-prefix match**: among routes whose destination contains the address, the one with the largest prefix length wins (a /32 beats a /24 beats 0.0.0.0/0). RFC 1918 private ranges (10/8, 172.16/12, 192.168/16) are not routed on the internet, so traffic from them must be translated. **Source NAT** keeps a translation table keyed by the connection (address and port), so a reply arriving at the NAT\'s public address and port is mapped back to the original private host and port. Return traffic needs a working path too: a reply that has no route back, or meets a filter, is lost just like a request.',
    example: '```\nRoute table:   10.20.0.0/16 → local\n               10.20.0.0/24 → pcx-…   (peering)\n               0.0.0.0/0    → nat-…\nPacket to 10.20.0.7      → 10.20.0.0/24 (longest match) → peering\nPacket to 10.20.11.9     → local\nPacket to 192.0.2.80     → 0.0.0.0/0 → NAT → leaves as 203.0.113.40:34560\nReply to 203.0.113.40:34560 → NAT table → 10.20.11.25:51514\n```',
    misconception: { wrong: 'The default route always wins because it matches everything.', right: 'It matches everything but has the shortest prefix (/0), so any more specific matching route wins.' },
    recall: [{ q: 'A table has 10.0.0.0/8 → A, 10.1.0.0/16 → B, 10.1.2.0/24 → C, 0.0.0.0/0 → D. Where do 10.1.2.9, 10.1.9.9 and 8.8.8.8 go?', a: 'C, B, D.' }],
    apply: { task: 'Explain why a private instance (10.20.11.25) can make an HTTPS call through a NAT gateway but nothing on the internet can open a connection to it.', answer: 'NAT only has translation entries for connections started from inside; an unsolicited packet to the NAT\'s public address matches no entry and is dropped. The private address is not routable on the internet.' },
    explainAloud: 'Explain longest-prefix match and NAT\'s return-path table in one minute.',
    checklist: ['I can apply longest-prefix match', 'I can name the RFC 1918 ranges', 'I can explain how NAT maps replies back', 'I remember the return path needs a route too'],
    refs: ['RFC-1918', 'AWS-RT']
  });

  L({
    id: 'ar1-a-06', module: 'A', title: 'Stateful and stateless filtering, ephemeral ports and the return path', mins: 5, prereqs: ['ar1-a-01'],
    objectives: ['Write the rules a stateless filter needs for a client/server conversation.', 'Explain why the return path matters.'],
    plain: 'A **stateful** filter remembers that you started a conversation and lets the answers back in automatically. A **stateless** filter judges every packet on its own, so you must allow both the request and the reply — including the reply\'s random high port.',
    precise: 'Stateful filters (AWS security groups, most host firewalls) track connections: an allowed outbound request implies its replies; an allowed inbound request implies its replies. Stateless filters (AWS network ACLs, router ACLs) evaluate each packet against ordered rules — in AWS, lowest rule number first, first match wins, then an implicit deny. For a web server behind a stateless ACL you need inbound TCP 443 from clients AND outbound TCP to the clients\' ephemeral ports (AWS recommends 1024–65535 to cover NAT gateways, load balancers and varied client OSes). For an instance that starts outbound calls you need outbound to the service port AND inbound to your own ephemeral range.',
    example: '```\nNACL on the web subnet (stateless, lowest number first):\n inbound  100 allow tcp 443          0.0.0.0/0\n outbound 100 allow tcp 443          0.0.0.0/0   ← reply goes to :5xxxx, not :443\n outbound  *  deny  all\nResult: the SYN gets in, the SYN-ACK is denied → every client times out.\nFix: outbound 110 allow tcp 1024-65535 0.0.0.0/0\n```',
    misconception: { wrong: 'If I allowed the request, the reply is allowed too.', right: 'Only for stateful filters. A network ACL evaluates the reply as a separate packet, and an earlier-numbered deny can shadow a later allow.' },
    recall: [{ q: 'Which AWS filter is stateful and which is stateless, and in what order are network ACL rules evaluated?', a: 'Security groups are stateful (allow-only); network ACLs are stateless with allow and deny rules, evaluated from the lowest rule number, first match wins, then an implicit deny.' }],
    apply: { task: 'An instance behind a custom NACL must call an HTTPS API. Write the minimal outbound and inbound entries.', answer: 'Outbound: allow TCP 443 to the API (or 0.0.0.0/0). Inbound: allow TCP 1024–65535 (or the instance OS ephemeral range, e.g. 32768–60999 on Amazon Linux) from that destination, numbered before any deny that would match.' },
    explainAloud: 'Explain why a stateless filter needs a rule for the client\'s ephemeral ports, using one concrete packet.',
    checklist: ['I can name which AWS filter is stateful', 'I can write both directions for a stateless filter', 'I know lowest rule number wins', 'I know the AWS ephemeral recommendation'],
    refs: ['AWS-NACL', 'AWS-NACL-EPH', 'AWS-SG']
  });

  L({
    id: 'ar1-a-07', module: 'A', title: 'Layers of failure: TCP, TLS, HTTP — and latency, throughput, loss, MTU', mins: 4, prereqs: ['ar1-a-02'],
    objectives: ['Classify a failure as name resolution, routing/filtering, TLS or application from tool output.'],
    plain: 'An HTTPS request is a stack: find the address (DNS), reach it (routing and filters), agree on encryption and prove identity (TLS), then ask the question (HTTP). Each layer fails with a different message. Read the message before changing anything.',
    precise: '`curl -v` shows the layers in order: "Trying IP" (DNS done), "Connected" (TCP done), the TLS handshake and certificate check, then the HTTP status. `curl: (6)` is resolution; `(7)` refused; `(28)` timed out; `(35)`/`(60)` TLS handshake or verification; an HTTP 4xx/5xx is the application answering. **Latency** is time per round trip; **throughput** is volume per second; **packet loss** forces TCP retransmissions, which cuts throughput and inflates latency. **MTU** problems (large packets dropped where fragmentation is blocked) can make small requests work while large responses hang; advanced packet analysis is optional for this interview.',
    example: '```\n$ curl -v https://api.partner.example/v2/upload\n*   Trying 192.0.2.90:443...\n* Connected to api.partner.example (192.0.2.90) port 443\ncurl: (60) SSL: no alternative certificate subject name matches target host name\n```\n\nDNS worked, TCP worked: opening a firewall cannot help. The certificate does not cover the name.',
    misconception: { wrong: 'If the request fails, start by opening security groups.', right: 'A completed TCP connection already proves filtering for that port. Classify the layer first; most post-connect failures are TLS or the application.' },
    recall: [{ q: 'Map curl exit codes 6, 7, 28 and 60 to layers.', a: '6 name resolution, 7 connection refused, 28 timeout, 60 certificate verification (TLS).' }],
    apply: { task: 'Small API calls succeed but a 5 MB upload hangs from one site only. Name two hypotheses and one discriminating test for each.', answer: 'Path MTU problem (test: a large request with a smaller MTU/MSS, or compare from another network); packet loss/throughput (test: measure retransmits/time for a known-size transfer, compare paths). Also check application limits (413, timeouts) in server logs.' },
    explainAloud: 'Explain to a customer, in one minute, why "the port is open" does not mean "the API works".',
    checklist: ['I can read curl -v by layer', 'I can map curl exit codes', 'I can define latency, throughput, loss', 'I know what an MTU symptom looks like'],
    refs: ['RFC-8446', 'RFC-9293']
  });

  /* ═══ Module B — AWS networking ═══════════════════════════════════ */
  var TOPO = '<svg viewBox="0 0 640 300" role="img" aria-label="AWS topology: a VPC 10.20.0.0/16 with a public subnet 10.20.1.0/24 holding a bastion, a web instance and a NAT gateway, and a private subnet 10.20.11.0/24 holding app-a. The public route table sends 0.0.0.0/0 to the internet gateway; the private route table sends 0.0.0.0/0 to the NAT gateway. The internet gateway connects to the internet."><rect x="10" y="40" width="470" height="250" rx="10" fill="none" stroke="currentColor" stroke-opacity=".5"/><text x="22" y="62" font-size="13" fill="currentColor">VPC 10.20.0.0/16</text><rect x="30" y="76" width="200" height="190" rx="8" fill="none" stroke="currentColor" stroke-dasharray="5 4"/><text x="40" y="95" font-size="12" fill="currentColor">public 10.20.1.0/24</text><text x="40" y="120" font-size="11" fill="currentColor">bastion 10.20.1.15 / 203.0.113.25</text><text x="40" y="140" font-size="11" fill="currentColor">web-a 10.20.1.30 / 203.0.113.30</text><text x="40" y="160" font-size="11" fill="currentColor">NAT gw 10.20.1.10 / EIP 203.0.113.40</text><text x="40" y="250" font-size="11" fill="currentColor">rt: 0.0.0.0/0 → igw</text><rect x="260" y="76" width="200" height="190" rx="8" fill="none" stroke="currentColor" stroke-dasharray="5 4"/><text x="270" y="95" font-size="12" fill="currentColor">private 10.20.11.0/24</text><text x="270" y="120" font-size="11" fill="currentColor">app-a 10.20.11.25 (no public IP)</text><text x="270" y="250" font-size="11" fill="currentColor">rt: 0.0.0.0/0 → nat-…</text><line x1="360" y1="130" x2="210" y2="160" stroke="currentColor" stroke-dasharray="3 3"/><rect x="500" y="130" width="120" height="40" rx="6" fill="none" stroke="currentColor"/><text x="560" y="155" font-size="12" text-anchor="middle" fill="currentColor">internet gateway</text><line x1="230" y1="150" x2="500" y2="150" stroke="currentColor"/><text x="560" y="30" font-size="12" text-anchor="middle" fill="currentColor">internet (laptop 198.51.100.45)</text><line x1="560" y1="40" x2="560" y2="130" stroke="currentColor"/></svg>';

  L({
    id: 'ar1-b-01', module: 'B', title: 'VPC, subnets, route tables, associations and the internet gateway', mins: 5, prereqs: ['ar1-a-05'],
    objectives: ['Explain what makes a subnet "public" and what an instance still needs to be reachable.', 'Find the route table a subnet actually uses.'],
    plain: 'A VPC is your private network in a Region. You split it into subnets, one Availability Zone each. Every subnet uses exactly one route table. A subnet is called "public" when its route table sends 0.0.0.0/0 to an internet gateway — but an instance in it is only reachable from the internet if it also has a public IP and the filters allow the traffic.',
    precise: 'Each subnet is associated with one route table: an **explicit association**, or else the VPC\'s **main** route table. `describe-route-tables --filters Name=association.subnet-id,Values=…` returns only explicit associations — an empty result means the main table applies. Every table has the `local` route for the VPC CIDR. An **internet gateway** performs one-to-one translation between an instance\'s private address and its **public IPv4 address**; an instance without a public IPv4 address cannot use an IGW route even in a "public" subnet. Internet reachability for an instance therefore needs: an attached IGW, a route to it from the instance\'s subnet (also for the return path), a public IPv4 address, security-group and network-ACL rules both ways, and a listening service.',
    example: 'The checklist for "why can\'t I reach my public instance":\n\n1. IGW attached to the VPC?\n2. The subnet\'s route table (explicit or main) has 0.0.0.0/0 → igw-…?\n3. Instance has a public IPv4 address (not just a private one)?\n4. Security group allows the port from your source address?\n5. Network ACL allows the request in and the reply out (ephemeral ports)?\n6. Something listens on the port?',
    diagram: TOPO, diagramCaption: 'The fictional "ridgeline-lab" VPC used by every scenario in this path.',
    misconception: { wrong: 'Putting an instance in the public subnet makes it reachable from the internet.', right: 'The route only makes it possible. The instance also needs a public IPv4 address, and the security group and ACL must allow the traffic both ways.' },
    recall: [{ q: 'List, from memory, the six things an instance needs to accept SSH from your laptop over the internet.', a: 'IGW attached; route to IGW from its subnet; public IPv4 address; security group allows 22 from your address; NACL allows 22 in and ephemeral ports out; sshd listening.' }],
    apply: { task: 'describe-route-tables filtered by the subnet returns `"RouteTables": []`. What does that mean and what do you check next?', answer: 'The subnet has no explicit association, so the VPC\'s main route table applies. Next, describe the main table (Name=association.main,Values=true) and read its routes.' },
    explainAloud: 'Explain to someone what "public subnet" really means in AWS, and the one thing people forget.',
    checklist: ['I know explicit vs main association', 'I know the IGW needs a public IPv4 address', 'I can list the six reachability conditions'],
    refs: ['AWS-RT', 'AWS-IGW', 'AWS-EC2-IP']
  });

  L({
    id: 'ar1-b-02', module: 'B', title: 'Security groups, network ACLs and flow logs as evidence', mins: 5, prereqs: ['ar1-a-06', 'ar1-b-01'],
    objectives: ['Decide which filter to inspect from a symptom, and confirm it with flow logs.'],
    plain: 'Security groups sit on the instance\'s network interface and remember connections. Network ACLs sit on the subnet edge and do not. Flow logs record each accepted or rejected flow at an interface, so they turn "I think it is blocked" into evidence.',
    precise: 'Security groups: allow rules only; stateful; evaluated together for all groups on the ENI; rules can reference CIDRs or other security groups. Network ACLs: allow and deny; stateless; ordered by rule number; applied when traffic enters or leaves the subnet, not within it. VPC Flow Logs (version 2 default format) record `srcaddr dstaddr srcport dstport protocol packets bytes start end action log-status`; an ACCEPT inbound followed by a REJECT outbound for the same conversation is the signature of a stateless return-path block, while a REJECT on the inbound SYN from your address points at the security group or ACL inbound rules. Reachability Analyzer can evaluate a path from configuration without sending traffic (not needed for the interview, useful in practice).',
    example: '```\n2 123456789012 eni-0d3e… 198.51.100.45 10.20.1.30 57071 443 6 1 60 … ACCEPT OK\n2 123456789012 eni-0d3e… 10.20.1.30 198.51.100.45 443 57071 6 1 60 … REJECT OK\n```\n\nThe request was accepted, the reply to 57071 was rejected: a stateless ACL on the outbound side, not the security group.',
    misconception: { wrong: 'Security group rules are evaluated in order, so a deny lower down might win.', right: 'Security groups have no deny rules and no order: if any rule allows the traffic, it is allowed. Ordering and denies are network ACL behaviour.' },
    recall: [{ q: 'You see REJECT on inbound SYNs from your IP to port 22 and no ACL changes. Which filter and what fix?', a: 'The security group: no rule allows your source address on 22. Add a narrow rule for your /32 (not 0.0.0.0/0).' }],
    apply: { task: 'Write the flow-log line pattern you would expect if a NAT gateway subnet\'s ACL blocks replies from the internet.', answer: 'On the NAT gateway\'s ENI: ACCEPT outbound NAT-IP:port→dest:443, then REJECT inbound dest:443→NAT-IP:<1024–65535>.' },
    explainAloud: 'Explain the difference between security groups and network ACLs, and how flow logs tell you which one is dropping traffic.',
    checklist: ['I can contrast SG and NACL in four properties', 'I can read a v2 flow-log line', 'I can recognise the return-path signature'],
    refs: ['AWS-SG', 'AWS-SG-RULES', 'AWS-NACL', 'AWS-FLOW', 'AWS-FLOW-EX', 'AWS-REACH']
  });

  L({
    id: 'ar1-b-03', module: 'B', title: 'NAT gateways versus VPC endpoints', mins: 5, prereqs: ['ar1-b-01'],
    objectives: ['Choose between NAT and an endpoint for a private workload\'s outbound access, including DNS and policy.'],
    plain: 'A **NAT gateway** lets private instances reach the internet (and AWS public endpoints) by borrowing a public address. A **VPC endpoint** lets them reach a specific AWS service without going through the internet path at all.',
    precise: 'A public NAT gateway lives in a public subnet with an Elastic IP; private subnets route 0.0.0.0/0 to it; it uses source ports 1024–65535; you pay per hour and per GB processed; it accepts no inbound connections. A **gateway endpoint** (S3, DynamoDB) adds a **prefix-list route** to the route tables you choose — traffic is steered by the route table, DNS is unchanged; endpoint policies and bucket policies (`aws:SourceVpce`) control access; no hourly charge. An **interface endpoint** (PrivateLink) puts ENIs with private IPs in your subnets; it relies on **private DNS** (or endpoint-specific names), has security groups, and charges per hour and per GB. NAT is needed for anything on the internet that is not an AWS service you can reach privately.',
    example: 'app-a needs S3 (40 GB/day) and an internet vendor API. A defensible design: an S3 gateway endpoint on the private route table plus a NAT gateway for the vendor; the bucket policy requires the endpoint. Interface endpoints are the better fit when on-premises networks or other Regions must reach the service privately.',
    misconception: { wrong: 'Private access to S3 needs a NAT gateway.', right: 'A gateway endpoint gives private S3 access through a route-table entry, without NAT data charges; NAT is for internet destinations.' },
    recall: [{ q: 'How does traffic find a gateway endpoint versus an interface endpoint?', a: 'Gateway endpoint: a prefix-list route in the selected route tables. Interface endpoint: DNS (private DNS or the endpoint names) resolves the service to the endpoint ENIs\' private IPs.' }],
    apply: { task: 'After adding an S3 gateway endpoint, one private subnet still sends S3 traffic through NAT. Why?', answer: 'The endpoint route was added only to the route tables you selected; that subnet\'s route table (possibly the main one) does not have the prefix-list route.' },
    explainAloud: 'Explain when you would choose a gateway endpoint, an interface endpoint and a NAT gateway.',
    checklist: ['I can name what each option needs (route, DNS, policy)', 'I know NAT gateway ports and that it accepts no inbound', 'I can state the cost shape of each'],
    refs: ['AWS-NAT', 'AWS-NAT-BASICS', 'AWS-GWEP', 'AWS-GWEP-S3', 'AWS-IFEP']
  });

  L({
    id: 'ar1-b-04', module: 'B', title: 'An investigation method you can say out loud', mins: 4, prereqs: ['ar1-b-02'],
    objectives: ['Run hypothesis → evidence → interpretation → minimal fix → verification, and narrate it.'],
    plain: 'Say what you think is wrong, choose the test that would prove you wrong fastest, read the result honestly, change one thing, and repeat the exact test that failed. Interviewers listen for this order as much as for the answer.',
    precise: '1. **Hypothesis**: a specific layer and mechanism ("the private route table no longer sends 0.0.0.0/0 to the NAT"). 2. **Evidence**: the cheapest discriminating test, from the right vantage point (test from the instance for outbound problems). 3. **Interpretation**: what the result rules in and out — a timeout is not a refusal; DNS working rules out resolution. 4. **Minimal fix**: change the one thing the evidence points at; avoid broad changes (0.0.0.0/0, allow-all ACLs, public IPs on private instances). 5. **Verification**: the same user-path test, plus a check that you did not widen exposure. On a Mac, prefer `nc -vz`, `curl -v`, `dig`, `netstat -rn`, `lsof -nP -iTCP`; on Linux instances `ss -ltn`, `ip route`, `ncat`.',
    example: '"I think the security group no longer includes our new office address. I\'ll check what address AWS sees for me and compare it with the rule; if the flow logs show REJECT for my address on 22, that confirms it. Then I add a /32 for that address and rerun the same nc test."',
    misconception: { wrong: 'A failed ping means the host or service is down.', right: 'ICMP is a separate protocol that security groups often do not allow. Use a TCP test to the actual port.' },
    recall: [{ q: 'Say the five steps of the investigation method in order.', a: 'Hypothesis, evidence, interpretation, minimal fix, verification.' }],
    apply: { task: 'Narrate the first 60 seconds of investigating "the private instance cannot reach the vendor API".', answer: 'State a hypothesis (routing to NAT), test from the instance (curl -v with a timeout), check DNS separately (dig), then read the subnet\'s effective route table — explaining what each result rules out.' },
    explainAloud: 'Narrate your method on a connectivity problem you solved at work, using the five steps.',
    checklist: ['I say a hypothesis before typing', 'I choose the vantage point deliberately', 'I avoid broad fixes', 'I verify with the same test'],
    refs: ['AWS-REACH', 'AWS-FLOW']
  });

  /* ═══ Module C — Terraform ═════════════════════════════════════════ */
  L({
    id: 'ar1-c-01', module: 'C', title: 'HCL building blocks: providers, resources, data, variables, outputs, references', mins: 6, prereqs: [],
    objectives: ['Write each block type from memory and connect resources with references.'],
    plain: 'Terraform files describe what you want. **Resources** are things to create, **data sources** look things up, **variables** are inputs, **outputs** are results, and the **provider** is the plugin that talks to AWS. You connect resources by referring to each other\'s attributes; Terraform works out the order from those references.',
    precise: 'A block is `TYPE "LABEL" "NAME" { … }`. References use `resource_type.name.attribute` (e.g. `aws_vpc.main.id`), `data.type.name.attribute`, `var.name`, `local.name`. Types include `string`, `number`, `bool`, `list(string)`, `map(string)`, `object({…})`. Variables can carry `default`, `description`, `type` and `validation` blocks; outputs can be `sensitive`. The `terraform` block pins Terraform and providers with `required_providers { aws = { source = "hashicorp/aws", version = "~> 6.60" } }`; the `provider "aws"` block configures it (e.g. `region`). Simple expressions: interpolation `"${var.env}-vpc"`, `cidrsubnet(var.vpc_cidr, 8, 1)`, conditionals `a ? b : c`.',
    example: '```hcl\nterraform {\n  required_providers {\n    aws = { source = "hashicorp/aws", version = "~> 6.60" }\n  }\n}\nprovider "aws" { region = var.region }\n\nvariable "region"   { type = string }\nvariable "vpc_cidr" { type = string  default = "10.40.0.0/16" }\n\nresource "aws_vpc" "main" {\n  cidr_block           = var.vpc_cidr\n  enable_dns_hostnames = true\n  tags = { Name = "lab-vpc" }\n}\n\nresource "aws_subnet" "public" {\n  vpc_id     = aws_vpc.main.id          # reference = implicit dependency\n  cidr_block = cidrsubnet(var.vpc_cidr, 8, 1)\n}\n\noutput "vpc_id" { value = aws_vpc.main.id }\n```\n(Inline `{ type = string  default = … }` on one line is shorthand for this page; write one argument per line in real files.)',
    misconception: { wrong: 'Resource names (the second label) have to match the AWS Name tag.', right: 'The local name (`main`) is only Terraform\'s handle for references. The AWS name comes from the `tags` argument, if you set one.' },
    recall: [{ q: 'Write, without looking, a variable with a type and validation that the CIDR ends in /16.', a: 'variable "vpc_cidr" { type = string; validation { condition = can(regex("/16$", var.vpc_cidr)); error_message = "Use a /16." } } (one argument per line).' }],
    apply: { task: 'Add an output that exposes the public subnet\'s ID and a variable for a trusted client CIDR with no default.', answer: 'output "public_subnet_id" { value = aws_subnet.public.id } and variable "trusted_cidr" { type = string description = "Client CIDR allowed to SSH" }.' },
    explainAloud: 'Explain what a reference like aws_vpc.main.id does, besides passing a value.',
    checklist: ['I can write each block type from memory', 'I know the reference syntax', 'I can pin a provider version'],
    refs: ['TF-LANG', 'TF-REFS', 'TF-VARS', 'TF-OUT', 'TF-REQ']
  });

  L({
    id: 'ar1-c-02', module: 'C', title: 'init, fmt, validate, plan, apply, destroy — and what each proves', mins: 6, prereqs: ['ar1-c-01'],
    objectives: ['Say what each command checks and what it cannot prove.'],
    plain: '`init` downloads providers. `fmt` tidies layout. `validate` checks the configuration is internally consistent. `plan` compares it with reality and lists changes. `apply` makes them. `destroy` removes them. Each one proves less than people assume.',
    precise: '- `terraform init` installs providers into `.terraform/` and writes `.terraform.lock.hcl` — it **downloads from the internet** (or a mirror) even if you never create a resource.\n- `terraform fmt` rewrites whitespace and alignment; it does not check meaning. **Formatting is not validation.**\n- `terraform validate` checks syntax, types, required arguments and references using the provider schema; it calls **no** AWS APIs. **Validation is not a successful plan.**\n- `terraform plan` refreshes state and reads data sources through the provider, which normally needs **credentials and API access** — it is not an offline operation in general.\n- `terraform apply` executes a plan; AWS can still reject things (quotas, permissions, conflicts).\n- A clean apply is still **not proof of connectivity**: routes, filters, public IPs and a listening service decide that — test the path.\n- `terraform destroy` removes what state tracks; anything created outside Terraform is not touched.',
    example: '```\n$ terraform fmt -check      # layout only\n$ terraform validate        # Success! The configuration is valid.\n$ terraform plan            # needs credentials: reads data sources, refreshes\nPlan: 7 to add, 0 to change, 0 to destroy.\n```\n"Valid" and "7 to add" say nothing about whether port 22 is reachable after apply.',
    misconception: { wrong: '`terraform validate` passing means the configuration will work in AWS.', right: 'It only proves the files are consistent with the provider schema. Wrong CIDRs, missing associations, too-broad rules and API-side errors all pass validate.' },
    recall: [{ q: 'Which commands need network access, and which need AWS credentials?', a: 'init needs network (registry or mirror) for providers. plan/apply/destroy need credentials and API access. fmt and validate need neither (validate needs initialised providers).' }],
    apply: { task: 'In the interview you have no AWS account. What can you honestly demonstrate, and what do you say about the rest?', answer: 'Write the configuration, run fmt and (if providers can be installed) validate; explain what plan would show and how you would verify connectivity after apply. Say clearly that validate does not prove the plan or the network path.' },
    explainAloud: 'Explain, in under a minute, why "terraform validate passed" is not "it works".',
    checklist: ['I know what each command proves', 'I know init downloads providers', 'I know plan needs credentials', 'I can say what verifies connectivity'],
    refs: ['TF-INIT', 'TF-FMT', 'TF-VALIDATE', 'TF-PLAN', 'TF-LOCK']
  });

  L({
    id: 'ar1-c-03', module: 'C', title: 'State: what it is for and why it is sensitive', mins: 4, prereqs: ['ar1-c-02'],
    objectives: ['Explain state, drift and why state must be protected.'],
    plain: 'Terraform keeps a record (state) of which real objects belong to which resources in your files. It uses it to know what to change. That record can contain secrets, so it must be protected.',
    precise: 'State maps resource addresses (`aws_vpc.main`) to real IDs and stores their last-known attributes. `plan` refreshes it and diffs config vs state vs reality; a change made outside Terraform shows as **drift**. Losing state means Terraform no longer knows it owns objects (re-creation and duplicates follow). State can hold sensitive values (passwords, private keys, outputs marked sensitive are still stored in plain text in the state file), so store it encrypted with restricted access; remote backends add locking so two runs do not write at once. Remote-state architecture is optional for this interview.',
    example: 'Someone adds an inbound rule in the console. The next `plan` shows Terraform wants to remove it (if the security group\'s rules are managed in-line) — that is drift being corrected, not Terraform "breaking" the change.',
    misconception: { wrong: 'Marking an output `sensitive = true` keeps it out of state.', right: 'It only hides it from CLI output. The value is still in the state file.' },
    recall: [{ q: 'Give two reasons state matters and one reason it is sensitive.', a: 'It maps config to real IDs so Terraform can update/destroy the right objects, and it lets plan detect drift. It can contain secrets in plain text.' }],
    apply: { task: 'A colleague deleted terraform.tfstate locally by mistake. What happens on the next apply, and what should they do?', answer: 'Terraform thinks nothing exists and tries to create everything again (conflicts or duplicates). Restore the state (from the backend/versioning) or import the existing objects before applying.' },
    explainAloud: 'Explain state and drift to someone who manages servers by hand.',
    checklist: ['I can define state and drift', 'I know state can contain secrets', 'I know why locking exists'],
    refs: ['TF-STATE', 'TF-STATE-SENS']
  });

  L({
    id: 'ar1-c-04', module: 'C', title: 'AWS networking in Terraform: dependencies and the current resource patterns', mins: 6, prereqs: ['ar1-c-01', 'ar1-b-01'],
    objectives: ['Write a VPC network with correct relationships and today\'s recommended security-group rule resources.'],
    plain: 'The same reachability checklist from Module B becomes resources: VPC, subnet, internet gateway, route table with a default route, the association that connects the subnet to that table, a security group with narrow rules, and an instance in the subnet with the group attached.',
    precise: '- Dependencies are usually **implicit** through references; use `depends_on` only for dependencies Terraform cannot see (e.g. an Elastic IP or NAT gateway that needs the IGW attached first, as the provider docs show).\n- Routes: either in-line `route { … }` blocks in `aws_route_table` **or** separate `aws_route` resources — never both on one table.\n- Associate subnets explicitly with `aws_route_table_association` (otherwise they use the main table).\n- Security groups: current AWS-provider docs recommend `aws_vpc_security_group_ingress_rule` / `aws_vpc_security_group_egress_rule` (one CIDR per rule) and warn against mixing them with in-line `ingress`/`egress` blocks.\n- When Terraform creates a security group in a VPC it **removes AWS\'s default allow-all egress rule** — add egress explicitly if the instance must reach anything.\n- `aws_eip` uses `domain = "vpc"`; instances in a VPC take `vpc_security_group_ids` and `subnet_id`; `associate_public_ip_address` (or the subnet\'s `map_public_ip_on_launch`) controls the public IPv4 address.\n- An allowed port does not install or start a service.',
    example: '```hcl\nresource "aws_route_table" "public" {\n  vpc_id = aws_vpc.main.id\n  route {\n    cidr_block = "0.0.0.0/0"\n    gateway_id = aws_internet_gateway.gw.id\n  }\n}\nresource "aws_route_table_association" "public" {\n  subnet_id      = aws_subnet.public.id\n  route_table_id = aws_route_table.public.id\n}\nresource "aws_security_group" "ssh" {\n  name   = "lab-ssh"\n  vpc_id = aws_vpc.main.id\n}\nresource "aws_vpc_security_group_ingress_rule" "ssh" {\n  security_group_id = aws_security_group.ssh.id\n  cidr_ipv4         = var.trusted_cidr\n  ip_protocol       = "tcp"\n  from_port         = 22\n  to_port           = 22\n}\nresource "aws_vpc_security_group_egress_rule" "all" {\n  security_group_id = aws_security_group.ssh.id\n  cidr_ipv4         = "0.0.0.0/0"\n  ip_protocol       = "-1"\n}\n```',
    misconception: { wrong: 'A new aws_security_group has AWS\'s default allow-all egress, so outbound just works.', right: 'Terraform removes that default egress rule when it creates the group in a VPC. Without an egress rule, the instance cannot start outbound connections (package installs, API calls).' },
    recall: [{ q: 'Which resource connects a subnet to a route table, and what happens if you forget it?', a: 'aws_route_table_association. Without it the subnet uses the VPC\'s main route table, which usually has only the local route.' }],
    apply: { task: 'List the resources (types only) for one public subnet with an SSH-only instance, in dependency order.', answer: 'aws_vpc → aws_subnet, aws_internet_gateway → aws_route_table (route to igw) → aws_route_table_association → aws_security_group → aws_vpc_security_group_ingress_rule / egress_rule → aws_instance (with a data source or variable for the AMI) → outputs.' },
    explainAloud: 'Explain why you would add depends_on to a NAT gateway but not to a subnet.',
    checklist: ['I can list the resources for a public subnet', 'I use rule resources, not mixed with in-line rules', 'I remember the default egress removal', 'I know when depends_on is warranted'],
    refs: ['REG-VPC', 'REG-SG', 'REG-SGIN', 'REG-NAT', 'TF-DEPS']
  });

  L({
    id: 'ar1-c-05', module: 'C', title: 'From a blank editor with the Registry open', mins: 3, prereqs: ['ar1-c-04'],
    objectives: ['Work from requirements to code under time pressure, using documentation efficiently.'],
    plain: 'Do not try to remember every argument. Write the skeleton you know, then use the Registry page\'s "Example Usage" and "Argument Reference" for each resource. Say what you are doing as you go.',
    precise: 'A 30-minute routine: (1) restate requirements and ask about unknowns — Region, CIDRs, who may connect on which ports, whether a public IP is wanted, AMI choice, and whether apply is expected; (2) write `terraform` + `provider` + variables; (3) network: VPC, subnet, IGW, route table + association; (4) filtering: security group + rule resources (explicit egress); (5) compute: AMI lookup (data `aws_ami` with owner + name filter, or an SSM parameter data source), instance with `subnet_id`, `vpc_security_group_ids`, public IP setting; (6) outputs; (7) `terraform fmt` and `validate` if available; (8) explain verification after apply (connect test, not just a green plan). Search the Registry by resource name (e.g. "aws_route_table_association").',
    example: 'Narration sample: "I\'ll pin the AWS provider, take the Region and trusted CIDR as variables, and build the network first. The subnet only becomes public once the association to the IGW route table exists, so I\'ll add that before the instance. Terraform removes default egress, so I\'ll add an explicit egress rule for package installs."',
    misconception: { wrong: 'Looking things up in the interview looks weak.', right: 'Google and the Registry are explicitly allowed. Looking up argument names quickly and correctly — while your design reasoning stays yours — is what the job looks like.' },
    recall: [{ q: 'What are the eight steps of the blank-editor routine?', a: 'Clarify; terraform/provider/variables; network; filtering; compute; outputs; fmt/validate; explain verification.' }],
    apply: { task: 'Write the clarification questions you would ask in the first five minutes for "create an EC2 instance that a client can reach".', answer: 'Region? Which client CIDR and which ports? Public IP or private with bastion? Existing VPC or new? AMI/OS? Should the service be installed (user_data) or only the network allowed? Is an apply expected or only the code?' },
    explainAloud: 'Explain how you use the Terraform Registry while staying the author of the design.',
    checklist: ['I can run the eight-step routine', 'I know where Example Usage and Argument Reference are', 'I ask about apply expectations'],
    refs: ['REG-AWS', 'REG-AMI', 'TF-VALIDATE']
  });

  /* ═══ Module D — Bash ═══════════════════════════════════════════════ */
  L({
    id: 'ar1-d-01', module: 'D', title: 'Variables, quoting, arguments, exit codes, stdout and stderr', mins: 5, prereqs: [],
    objectives: ['Write a short script that validates arguments, quotes correctly and returns a meaningful exit status.'],
    plain: 'Quote every variable ("$file") so spaces and wildcards cannot break your command. Check your inputs early. Send data to stdout and complaints to stderr. Exit with 0 when everything is fine and a non-zero code when it is not, so other tools (cron, CI) can react.',
    precise: '`"$var"` prevents word splitting and globbing; `"$@"` passes arguments intact. `$#` is the argument count, `$1…` positional parameters, `$?` the last command\'s status. Exit 0 = success; 1 = findings/failure; 2 = usage or input error is a common convention. Errors go to stderr: `echo "error: …" >&2`. Check commands deliberately: `cmd || { echo "…" >&2; exit 2; }`. macOS ships Bash 3.2: avoid associative arrays, `mapfile`, `${var,,}`.',
    example: '```bash\n#!/usr/bin/env bash\nif [ "$#" -ne 1 ]; then\n  echo "usage: count_errors.sh LOGFILE" >&2\n  exit 2\nfi\nlog=$1\nif [ ! -r "$log" ]; then\n  echo "error: cannot read $log" >&2\n  exit 2\nfi\ngrep -c " ERROR " "$log"\n```',
    misconception: { wrong: '`set -euo pipefail` at the top makes a script reliable.', right: 'It helps, but `-e` is skipped inside conditions and `||` lists, and does not explain failures. Check the commands that matter explicitly, print a useful message to stderr, and choose exit codes on purpose.' },
    recall: [{ q: 'Why quote "$file", and where should error messages go?', a: 'To stop word splitting and glob expansion on values with spaces or *; error messages go to stderr (>&2) so stdout stays clean data.' }],
    apply: { task: 'Make a two-line guard that exits 2 with a message if no argument is given.', answer: '[ "$#" -ge 1 ] || { echo "usage: $0 FILE" >&2; exit 2; }' },
    explainAloud: 'Explain why a script should separate stdout from stderr and return meaningful exit codes.',
    checklist: ['I quote expansions', 'I validate arguments first', 'I send errors to stderr', 'I choose exit codes deliberately', 'I avoid Bash 4 features on macOS'],
    refs: ['BASH']
  });

  L({
    id: 'ar1-d-02', module: 'D', title: 'Conditionals, loops, functions, pipelines and jq', mins: 5, prereqs: ['ar1-d-01'],
    objectives: ['Loop over input safely, use a function, and extract JSON fields with jq including missing fields.'],
    plain: 'Read files line by line with `while read`, wrap repeated logic in small functions, and let `jq` do JSON instead of grep and sed.',
    precise: '`while IFS= read -r line; do …; done < "$file"` reads lines exactly (also the last one without a newline: `|| [ -n "$line" ]`). A pipeline\'s status is the last command\'s; `set -o pipefail` makes any failing stage fail the pipeline. Functions return statuses (`return 1`) and print results to stdout. jq: `.Reservations[].Instances[]` flattens; `select(.State.Name != "running")` filters; `// "-"` gives a default for missing fields; `-r` prints raw strings; `@tsv` formats rows; `jq -e` sets the exit status from the output. Malformed JSON makes jq exit non-zero — check it.',
    example: '```bash\njq -r \'.Reservations[].Instances[]\n       | select(.State.Name != "running")\n       | [.InstanceId, .State.Name,\n          ((.Tags // []) | map(select(.Key=="Name"))[0].Value // "-")]\n       | @tsv\' instances.json || { echo "error: bad JSON" >&2; exit 2; }\n```',
    misconception: { wrong: '`cat file | while read line` sets variables I can use after the loop.', right: 'In Bash the loop after a pipe runs in a subshell, so variables set inside are lost. Redirect the file into the loop instead.' },
    recall: [{ q: 'Write the jq filter that prints the Name tag or "-" when Tags is missing.', a: '((.Tags // []) | map(select(.Key=="Name"))[0].Value) // "-"' }],
    apply: { task: 'Write a loop that reads host:port lines, skips blanks and # comments, and counts failures of a check function.', answer: 'fails=0; while IFS= read -r l || [ -n "$l" ]; do case $l in ""|\\#*) continue;; esac; check "$l" || fails=$((fails+1)); done < "$file"; [ "$fails" -eq 0 ]' },
    explainAloud: 'Explain what pipefail changes and why it is not a complete error-handling strategy.',
    checklist: ['I read files with while IFS= read -r', 'I know the pipe-subshell trap', 'I can use select, // and @tsv in jq', 'I check jq\'s exit status'],
    refs: ['BASH', 'JQ']
  });

  /* ═══ Optional glossary ════════════════════════════════════════════ */
  L({
    id: 'ar1-x-01', module: 'X', optional: true, title: 'Optional glossary: the wider stack (context only)', mins: 5, prereqs: [],
    objectives: ['Recognise the wider stack\'s tools in conversation without studying them for Round 1.'],
    plain: 'The team\'s stack includes these tools. Knowing what each is for helps you follow a conversation; Round 1 is about networking and Terraform.',
    precise: '- **Kubernetes**: schedules containers (Pods) across nodes and keeps declared state (Deployments, Services) true; networking adds Services, DNS and NetworkPolicy on top of what you know.\n- **Helm**: packages Kubernetes manifests as charts with values; releases can be upgraded and rolled back.\n- **CloudWatch** (assumed meaning of "CW"): AWS metrics, logs (including VPC flow logs as a destination), alarms and dashboards.\n- **Puppet**: agent-based configuration management with a declarative language; nodes converge to a catalog.\n- **Ansible**: agentless configuration management over SSH with YAML playbooks; idempotent modules.',
    example: 'A plausible link to your work: Terraform builds the VPC and instances; Ansible or Puppet configures them; Kubernetes runs workloads on top; CloudWatch collects their metrics and logs.',
    misconception: { wrong: 'I need to prepare all of these for Round 1.', right: 'They are context. The recruiter emphasised networking and Terraform, with scripting secondary.' },
    recall: [{ q: 'In one sentence each: what is the difference between Terraform and Ansible?', a: 'Terraform provisions infrastructure from declared state with a state file; Ansible configures hosts (and can provision) by running idempotent tasks over SSH without an agent or state file.' }],
    apply: { task: 'If asked "how would you send VPC flow logs somewhere searchable?", what do you say?', answer: 'Enable VPC Flow Logs with a CloudWatch Logs (or S3) destination and an IAM role that can write to it; query them with filters or Logs Insights.' },
    explainAloud: 'Explain in 30 seconds how these tools fit together.',
    checklist: ['I can say one line about each tool', 'I can say why none of them is Round 1 scope'],
    refs: ['AWS-FLOW']
  });
})();
