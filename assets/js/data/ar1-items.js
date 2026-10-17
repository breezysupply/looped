/* Anduril Round 1 prep — retrieval items, diagnostic, delayed-recall sets and
   the traffic-path exercises (X1 and its transfer variant X2).

   Item types (graded deterministically unless noted):
     mcq   — choices[], a (index), why
     num   — a (number), why
     text  — accept[] (case-insensitive regex sources), a (display answer), why
     order — steps[] in the correct order (shown shuffled), why
     self  — free recall; a (model answer) and points[] the learner ticks
             against their own answer (self-reviewed, labelled as such)
   Every item: id, module (A|B|C|D), domain (net|tf|bash), kind
   (explain|interpret|troubleshoot|recall|compute) and q. Answers live in
   fields the UI only shows after an attempt. This is a learning affordance
   in a client-only app, not a secret. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.ar1Items = LX.ar1Items || [];

(function () {
  function I(x) { LX.ar1Items.push(x); }

  /* ═══ Module A — network fundamentals (16) ═══════════════════════ */
  I({ id: 'ar1-qa-01', module: 'A', domain: 'net', kind: 'explain', type: 'self', lesson: 'ar1-a-01',
    q: 'Without notes: what identifies one TCP connection, and which value does the client\'s OS choose?',
    a: 'The 4-tuple (source IP, source port, destination IP, destination port) plus the protocol. The client OS picks the source port from its ephemeral range; replies are addressed to it.',
    points: ['Names all four values', 'Says the client picks the source (ephemeral) port', 'Says replies are addressed to that port'] });
  I({ id: 'ar1-qa-02', module: 'A', domain: 'net', kind: 'interpret', type: 'mcq', lesson: 'ar1-a-02',
    q: 'From your Mac: `nc -vz 10.20.11.25 5432` prints `Connection refused` immediately. What is the best reading?',
    choices: ['A security group dropped the SYN', 'The host was reached and nothing is listening on 5432 (or a device actively rejected)', 'DNS failed', 'The route table has no route to 10.20.11.0/24'],
    a: 1, why: 'A refusal is a TCP RST from something that received the SYN. Security groups and NACLs drop silently, which shows up as a timeout. A missing route also gives a timeout (or "no route to host" locally).' });
  I({ id: 'ar1-qa-03', module: 'A', domain: 'net', kind: 'troubleshoot', type: 'mcq', lesson: 'ar1-a-02',
    q: '`ping db.internal` gets 100% packet loss, but the application on another host connects to db.internal:5432 fine. What do you conclude?',
    choices: ['The database is down and the app is using a cache', 'ICMP is not permitted on the path; ping says nothing about TCP/5432', 'DNS is returning two different answers', 'MTU is too small'],
    a: 1, why: 'Ping uses ICMP echo, which security groups commonly do not allow. A failed ping never proves a host or service is down; test the actual protocol and port.' });
  I({ id: 'ar1-qa-04', module: 'A', domain: 'net', kind: 'compute', type: 'num', lesson: 'ar1-a-04',
    q: 'How many addresses can you assign to instances in an AWS subnet of 10.20.1.0/28?',
    a: 11, why: 'A /28 has 16 addresses. AWS reserves 5 in every subnet (network, VPC router, DNS, future use, broadcast), leaving 11.' });
  I({ id: 'ar1-qa-05', module: 'A', domain: 'net', kind: 'compute', type: 'mcq', lesson: 'ar1-a-04',
    q: 'Which address is inside 10.20.11.128/25?',
    choices: ['10.20.11.100', '10.20.11.200', '10.20.12.5', '10.20.10.255'],
    a: 1, why: '/25 splits the /24 into .0–.127 and .128–.255. 10.20.11.200 falls in .128–.255.' });
  I({ id: 'ar1-qa-06', module: 'A', domain: 'net', kind: 'compute', type: 'mcq', lesson: 'ar1-a-04',
    q: 'You need to peer a new VPC 10.20.0.0/16 with an existing one. Which existing CIDR conflicts?',
    choices: ['10.21.0.0/16', '10.20.128.0/17', '172.20.0.0/16', '192.168.20.0/24'],
    a: 1, why: '10.20.128.0/17 is the upper half of 10.20.0.0/16 — the ranges overlap, and peering does not support overlapping CIDRs.' });
  I({ id: 'ar1-qa-07', module: 'A', domain: 'net', kind: 'interpret', type: 'text', lesson: 'ar1-a-05',
    q: 'Route table:\n```\n10.20.0.0/16   local\n10.40.0.0/16   pcx-0c4e\n10.40.5.0/24   tgw-07aa\n0.0.0.0/0      nat-04f1\n```\nWhich target carries a packet to 10.40.5.9? Type the target.',
    accept: ['^tgw(-07aa)?$', 'transit'], a: 'tgw-07aa',
    why: 'Longest prefix wins: 10.40.5.0/24 is more specific than 10.40.0.0/16 and 0.0.0.0/0.' });
  I({ id: 'ar1-qa-08', module: 'A', domain: 'net', kind: 'interpret', type: 'text', lesson: 'ar1-a-05',
    q: 'Same table as before. Which target carries a packet to 10.40.9.1? Type the target.',
    accept: ['^pcx(-0c4e)?$', 'peering'], a: 'pcx-0c4e',
    why: '10.40.9.1 is not in 10.40.5.0/24, so the next most specific match is 10.40.0.0/16 → the peering connection.' });
  I({ id: 'ar1-qa-09', module: 'A', domain: 'net', kind: 'explain', type: 'self', lesson: 'ar1-a-05',
    q: 'Explain what a NAT gateway changes on an outbound packet and on the reply, and why the private instance never needs a public IP.',
    a: 'Outbound, it rewrites the source IP (and source port) to its own address — the Elastic IP once it leaves via the internet gateway. It keeps a translation entry; the reply arrives addressed to the EIP and NAT port, and the gateway rewrites the destination back to the instance\'s private IP and port. Internet hosts only ever see the EIP, and nothing can start a connection inward through it.',
    points: ['Source address and port rewritten outbound', 'Translation table maps the reply back', 'Reply destination rewritten to the private IP', 'Inbound-initiated connections are not possible through it'] });
  I({ id: 'ar1-qa-10', module: 'A', domain: 'net', kind: 'interpret', type: 'mcq', lesson: 'ar1-a-06',
    q: 'A network ACL on a subnet allows inbound TCP 443 from 0.0.0.0/0 and outbound TCP 443 to 0.0.0.0/0. Clients connecting to a web server in that subnet time out. Why?',
    choices: ['NACLs need an inbound rule for 80 as well', 'The replies leave towards the clients\' ephemeral ports, which no outbound rule allows', 'The security group must also allow outbound 443', 'The internet gateway needs a NACL'],
    a: 1, why: 'NACLs are stateless. The server\'s replies go from :443 to the client\'s ephemeral port (for example 49152–65535 on macOS), so the outbound rules need that range.' });
  I({ id: 'ar1-qa-11', module: 'A', domain: 'net', kind: 'recall', type: 'text', lesson: 'ar1-a-06',
    q: 'What ephemeral port range do many Linux kernels (including Amazon Linux) use for outbound connections? Format: low-high.',
    accept: ['^32768\\s*[-–to ]+\\s*6(0999|1000)$'], a: '32768–60999 (the AWS NACL page lists 32768–61000)',
    why: 'The kernel default for net.ipv4.ip_local_port_range is 32768 60999; the AWS NACL page lists 32768–61000 for Linux including Amazon Linux. macOS and Windows Server 2008+ use 49152–65535. AWS NAT gateways and Elastic Load Balancing use 1024–65535. When unsure, allow 1024–65535 for return traffic.' });
  I({ id: 'ar1-qa-12', module: 'A', domain: 'net', kind: 'explain', type: 'self', lesson: 'ar1-a-06',
    q: 'Explain the difference between stateful and stateless filtering using a security group and a network ACL, including the return traffic.',
    a: 'A security group is stateful: once a connection is allowed in either direction, its replies are allowed automatically regardless of rules. A network ACL is stateless: every packet is evaluated against the rules for its direction, in rule-number order, first match wins, with an implicit deny — so replies need their own rule, usually for the ephemeral port range.',
    points: ['SG stateful, replies tracked', 'NACL stateless, each direction evaluated', 'NACL rule order and first match', 'NACL implicit deny', 'Return traffic needs the ephemeral range'] });
  I({ id: 'ar1-qa-13', module: 'A', domain: 'net', kind: 'troubleshoot', type: 'mcq', lesson: 'ar1-a-03',
    q: 'You create the record `api.ridgeline.example`. Two minutes earlier someone looked it up and got NXDOMAIN. They still get NXDOMAIN from the corporate resolver. Most likely?',
    choices: ['The record is wrong', 'The resolver cached the negative answer for the SOA-derived negative TTL', 'TCP 53 is blocked', 'The resolver is using the old IP'],
    a: 1, why: 'Resolvers cache NXDOMAIN for the negative TTL taken from the zone\'s SOA (RFC 2308). Query the authoritative servers directly to confirm the record exists, then wait out (or flush) the negative cache.' });
  I({ id: 'ar1-qa-14', module: 'A', domain: 'net', kind: 'interpret', type: 'mcq', lesson: 'ar1-a-07',
    q: '`nc -vz api.vendor.example 443` succeeds. `curl https://api.vendor.example` prints `SSL: no alternative certificate subject name matches target host name`. Which layer failed?',
    choices: ['Routing', 'Filtering', 'TLS (certificate name)', 'HTTP'],
    a: 2, why: 'The TCP handshake worked, so routes and filters for 443 are fine. The TLS handshake failed on name verification: the certificate does not cover the name you used. Opening firewall rules cannot fix this.' });
  I({ id: 'ar1-qa-15', module: 'A', domain: 'net', kind: 'order', type: 'order', lesson: 'ar1-a-07',
    q: 'Put the events of a first `curl https://api.vendor.example/health` in order.',
    steps: ['DNS lookup returns an address', 'TCP SYN → SYN-ACK → ACK', 'TLS ClientHello → certificate verified → keys agreed', 'HTTP request sent (GET /health)', 'HTTP response status received'],
    why: 'Each layer depends on the one before it. Evidence from a later step (an HTTP status) proves every earlier step worked.' });
  I({ id: 'ar1-qa-16', module: 'A', domain: 'net', kind: 'explain', type: 'self', lesson: 'ar1-a-07',
    q: 'A transfer between regions is slow but never fails. Name two different explanations from latency, throughput, loss and MTU, and one piece of evidence for each.',
    a: 'Examples: high round-trip latency limits a single TCP stream\'s throughput (evidence: RTT from ping/mtr or TCP handshake time; parallel streams go faster). Packet loss causes retransmits and congestion back-off (evidence: retransmit counters, `ss -ti` retrans). An MTU black hole stalls large packets while small ones pass (evidence: small requests work, large ones hang; tracepath shows the path MTU).',
    points: ['Two distinct mechanisms', 'Concrete evidence for each', 'Does not treat bandwidth and latency as the same thing'] });

  /* ═══ Module B — AWS networking (9) ══════════════════════════════ */
  I({ id: 'ar1-qb-01', module: 'B', domain: 'net', kind: 'interpret', type: 'mcq', lesson: 'ar1-b-01',
    q: 'A subnet has no explicit route-table association. Which route table does it use?',
    choices: ['None — traffic is dropped', 'The VPC\'s main route table', 'The route table of the first subnet created', 'The internet gateway\'s table'],
    a: 1, why: 'Subnets without an explicit association use the main route table. That makes "the association was removed" a quiet failure: the subnet keeps working, just with different routes.' });
  I({ id: 'ar1-qb-02', module: 'B', domain: 'net', kind: 'explain', type: 'self', lesson: 'ar1-b-01',
    q: 'What makes a subnet "public" in AWS, precisely?',
    a: 'Its route table has a route (usually 0.0.0.0/0) to an internet gateway. For an instance in it to be reachable or reach the internet directly it also needs a public IPv4 or Elastic IP, and the security group / NACL must allow the traffic. "Auto-assign public IP" is a convenience, not the definition.',
    points: ['Route to an internet gateway', 'Instance needs a public or Elastic IP', 'Filters still apply', 'Auto-assign is not the definition'] });
  I({ id: 'ar1-qb-03', module: 'B', domain: 'net', kind: 'troubleshoot', type: 'mcq', lesson: 'ar1-b-01',
    q: 'An instance in a private subnet has a route `0.0.0.0/0 → igw-…` and no public IP. Outbound HTTPS times out. Why?',
    choices: ['The IGW only accepts UDP', 'An internet gateway only translates for instances with a public IPv4; a private-only address cannot use it', 'Security groups block all outbound by default', 'The route needs to be 0.0.0.0/1'],
    a: 1, why: 'The internet gateway performs 1:1 NAT between an instance\'s private IP and its public IP. Without a public IPv4 there is nothing to translate to, so traffic does not reach the internet. Point the default route at a NAT gateway instead.' });
  I({ id: 'ar1-qb-04', module: 'B', domain: 'net', kind: 'interpret', type: 'mcq', lesson: 'ar1-b-02',
    q: 'Flow log record on the instance ENI:\n```\n2 123456789012 eni-0d1 10.20.11.25 192.0.2.80 41322 443 6 3 180 1760430012 1760430070 ACCEPT OK\n2 123456789012 eni-0d1 192.0.2.80 10.20.11.25 443 41322 6 2 120 1760430012 1760430070 REJECT OK\n```\nWhat is the most likely cause?',
    choices: ['Security group egress blocks 443', 'A network ACL rejects the inbound reply to the ephemeral port 41322', 'DNS failure', 'The vendor is down'],
    a: 1, why: 'The outbound SYN was accepted; the reply from :443 to :41322 was rejected. A security group would allow the reply automatically (stateful), so a stateless NACL without an inbound ephemeral rule is the likely culprit. Confirm with describe-network-acls.' });
  I({ id: 'ar1-qb-05', module: 'B', domain: 'net', kind: 'interpret', type: 'mcq', lesson: 'ar1-b-02',
    q: 'NACL inbound rules: `90 deny tcp 22 0.0.0.0/0`, `100 allow tcp 22 198.51.100.0/24`, `* deny all`. Can 198.51.100.45 SSH in?',
    choices: ['Yes — rule 100 is more specific', 'No — rule 90 matches first and denies', 'Yes — NACLs are stateful', 'Only if the security group allows it'],
    a: 1, why: 'NACL rules are evaluated in ascending number order and the first match wins. Specificity does not matter. Rule 90 matches TCP/22 from anywhere and denies.' });
  I({ id: 'ar1-qb-06', module: 'B', domain: 'net', kind: 'explain', type: 'self', lesson: 'ar1-b-03',
    q: 'When would you choose a gateway VPC endpoint over a NAT gateway for S3 access from private subnets, and what does each cost you in design terms?',
    a: 'A gateway endpoint (S3 or DynamoDB only) adds a prefix-list route in the route tables you choose; traffic stays on the AWS network, there is no hourly endpoint or data processing charge, and you can attach an endpoint policy. A NAT gateway is general internet egress: it is needed for non-AWS destinations, has hourly and per-GB processing charges, and is per-AZ for resilience. Many designs use both: endpoint for S3, NAT for everything else.',
    points: ['Gateway endpoint is S3/DynamoDB only and route-table based', 'Endpoint policy can restrict access', 'NAT is general egress with hourly + per-GB charges', 'AZ resilience for NAT', 'Both can coexist'] });
  I({ id: 'ar1-qb-07', module: 'B', domain: 'net', kind: 'interpret', type: 'mcq', lesson: 'ar1-b-02',
    q: 'Two instances in the same subnet cannot reach each other on 8080. Which control is NOT evaluated for this traffic?',
    choices: ['The source instance\'s security group egress', 'The destination instance\'s security group ingress', 'The subnet\'s network ACL', 'The listener on the destination'],
    a: 2, why: 'Network ACLs filter traffic entering and leaving a subnet; traffic between instances in the same subnet does not cross that boundary. Security groups apply per ENI, so both still matter.' });
  I({ id: 'ar1-qb-08', module: 'B', domain: 'net', kind: 'order', type: 'order', lesson: 'ar1-b-04',
    q: 'Put the investigation steps in the order you would say them in an interview.',
    steps: ['State a hypothesis and what would disprove it', 'Collect evidence closest to the failure (reproduce from the right vantage point)', 'Interpret: which layer/control does the evidence implicate?', 'Make the smallest change that addresses the cause', 'Verify with the original failing test and check nothing else broke'],
    why: 'Hypothesis → evidence → interpretation → minimal fix → verification. Starting with a fix ("open the firewall") skips the step that tells you whether it is a filter at all.' });
  I({ id: 'ar1-qb-09', module: 'B', domain: 'net', kind: 'troubleshoot', type: 'mcq', lesson: 'ar1-b-03',
    q: 'A NAT gateway exists in the public subnet, the private route table points 0.0.0.0/0 at it, but outbound still times out. Which is a plausible cause?',
    choices: ['The private subnet needs auto-assign public IP', 'The public subnet\'s route table has no 0.0.0.0/0 → internet gateway route', 'The NAT gateway needs a security group allowing 443', 'The NAT gateway must be in the private subnet'],
    a: 1, why: 'A public NAT gateway sends traffic to the internet through the internet gateway, so the NAT\'s own subnet needs that default route. NAT gateways do not have security groups; they belong in a public subnet.' });

  /* ═══ Module C — Terraform (11) ══════════════════════════════════ */
  I({ id: 'ar1-qc-01', module: 'C', domain: 'tf', kind: 'explain', type: 'self', lesson: 'ar1-c-01',
    q: 'Explain the difference between a `resource` block and a `data` block, with an AWS example of each.',
    a: 'A resource block declares an object Terraform creates, updates and destroys (for example `aws_vpc`). A data block reads something that already exists or is computed elsewhere, without managing it (for example `data "aws_ami"` to find the latest Amazon Linux image, or `data "aws_availability_zones"`).',
    points: ['Resource = managed lifecycle', 'Data = read-only lookup', 'A correct AWS example of each'] });
  I({ id: 'ar1-qc-02', module: 'C', domain: 'tf', kind: 'interpret', type: 'mcq', lesson: 'ar1-c-01',
    q: 'Which line creates an implicit dependency from the subnet on the VPC?',
    choices: ['`vpc_id = "vpc-0a7c1e5d2b9f40316"`', '`vpc_id = aws_vpc.main.id`', '`depends_on = []`', '`cidr_block = var.cidr`'],
    a: 1, why: 'Referencing another resource\'s attribute creates the dependency edge. A hard-coded ID gives Terraform nothing to order on (and ties the code to one environment).' });
  I({ id: 'ar1-qc-03', module: 'C', domain: 'tf', kind: 'recall', type: 'mcq', lesson: 'ar1-c-02',
    q: '`terraform validate` passes. What has it proven?',
    choices: ['The AWS resources will create successfully', 'The configuration is syntactically valid and internally consistent (types, references, required arguments)', 'Your credentials work', 'The security group allows the right traffic'],
    a: 1, why: 'validate checks the configuration itself (it needs `init` first so the provider schemas are available). It does not contact AWS: credentials, quotas, AMI availability and connectivity are only exercised by plan/apply and by testing the result.' });
  I({ id: 'ar1-qc-04', module: 'C', domain: 'tf', kind: 'recall', type: 'order', lesson: 'ar1-c-02',
    q: 'Order the commands for a first run of a new configuration.',
    steps: ['terraform init', 'terraform fmt', 'terraform validate', 'terraform plan', 'terraform apply (only when deliberately enabled)'],
    why: 'init installs the provider and backend; fmt rewrites style; validate checks the configuration against provider schemas; plan needs credentials and reads real state; apply changes infrastructure. (fmt can run before init; validate cannot.)' });
  I({ id: 'ar1-qc-05', module: 'C', domain: 'tf', kind: 'troubleshoot', type: 'mcq', lesson: 'ar1-c-02',
    q: '`terraform plan` fails with `No valid credential sources found`. What does that tell you about your HCL?',
    choices: ['It has a syntax error', 'Nothing yet — plan needs AWS credentials to refresh and read data sources, which is separate from whether the HCL is correct', 'The provider version is wrong', 'The state file is corrupt'],
    a: 1, why: 'plan is not an offline check: it calls AWS to read existing objects and data sources. Fix the credential chain (profile, SSO, environment variables) — never paste keys into the configuration.' });
  I({ id: 'ar1-qc-06', module: 'C', domain: 'tf', kind: 'explain', type: 'self', lesson: 'ar1-c-03',
    q: 'What is Terraform state for, and why do you treat it as sensitive?',
    a: 'State maps resources in the configuration to real objects (IDs) and caches their attributes so Terraform can compute diffs and dependencies. It can contain secrets in plain text (passwords, generated keys, outputs marked sensitive are still stored), so keep it in a protected remote backend with encryption and locking, never commit it to git.',
    points: ['Maps config to real object IDs', 'Used to compute the plan', 'Contains sensitive values in plain text', 'Remote backend, encryption, locking, not in git'] });
  I({ id: 'ar1-qc-07', module: 'C', domain: 'tf', kind: 'interpret', type: 'mcq', lesson: 'ar1-c-04',
    q: 'You define an `aws_security_group` with inline `ingress {}` blocks and also add `aws_vpc_security_group_ingress_rule` resources for the same group. What happens?',
    choices: ['Terraform merges them', 'They fight: the group\'s inline rules and the separate rule resources overwrite each other\'s view, causing perpetual diffs or removed rules', 'Validation fails with a syntax error', 'AWS rejects duplicates silently and all is fine'],
    a: 1, why: 'The provider documentation says not to mix inline rules with separate rule resources for the same group. Pick one style — the separate rule resources are the current recommendation.' });
  I({ id: 'ar1-qc-08', module: 'C', domain: 'tf', kind: 'recall', type: 'mcq', lesson: 'ar1-c-04',
    q: 'You manage a security group with Terraform and declare only an ingress rule. What happens to outbound traffic?',
    choices: ['AWS\'s default allow-all egress stays', 'Terraform removes the default allow-all egress rule, so you must declare the egress you need', 'Egress is always allowed for stateful groups', 'Terraform adds an egress rule for the same port'],
    a: 1, why: 'The AWS provider removes the default egress rule when it creates a security group. Declare egress explicitly (for example HTTPS to 0.0.0.0/0, or to a specific prefix list).' });
  I({ id: 'ar1-qc-09', module: 'C', domain: 'tf', kind: 'troubleshoot', type: 'mcq', lesson: 'ar1-c-04',
    q: 'Your public subnet, route table with `0.0.0.0/0 → aws_internet_gateway.main.id` and instance all apply, but the instance is unreachable from the internet. Which resource is most commonly missing?',
    choices: ['aws_eip_association', 'aws_route_table_association', 'aws_vpc_dhcp_options', 'aws_network_interface'],
    a: 1, why: 'Without an association the subnet uses the main route table, which has no internet route. Terraform creates the route table happily even if nothing uses it.' });
  I({ id: 'ar1-qc-10', module: 'C', domain: 'tf', kind: 'explain', type: 'self', lesson: 'ar1-c-01',
    q: 'Why pin the AWS provider version, and what does `~> 6.60` allow?',
    a: 'Provider releases change resource schemas and behaviour; pinning keeps plans reproducible and lets you upgrade deliberately. `~> 6.60` allows any 6.x release from 6.60 upward (6.61, 6.68…) but not 7.0. The dependency lock file records the exact version and checksums chosen.',
    points: ['Reproducibility / deliberate upgrades', '~> 6.60 = >= 6.60, < 7.0', 'Lock file records exact selection'] });
  I({ id: 'ar1-qc-11', module: 'C', domain: 'tf', kind: 'interpret', type: 'mcq', lesson: 'ar1-c-05',
    q: 'In a blank-editor interview, which is the strongest way to get the AMI for an instance?',
    choices: ['Hard-code an AMI ID you remember', 'A `data "aws_ami"` lookup (or the public SSM parameter) with filters for the OS you want, or a variable — and say which you chose and why', 'Leave `ami` out; AWS picks one', 'Use `ami = "latest"`'],
    a: 1, why: 'AMI IDs differ per region and change over time. A data lookup or SSM parameter, or a variable the caller supplies, are all defensible; say the trade-off out loud.' });

  /* ═══ Module D — Bash (7) ═════════════════════════════════════════ */
  I({ id: 'ar1-qd-01', module: 'D', domain: 'bash', kind: 'interpret', type: 'mcq', lesson: 'ar1-d-01',
    q: '`f="my log.txt"; wc -l $f` fails with two "No such file" errors. Fix?',
    choices: ['wc -l ${f}', 'wc -l "$f"', "wc -l '$f'", 'wc -l $(f)'],
    a: 1, why: 'Unquoted expansion is word-split on spaces. Double quotes keep it one argument and still expand; single quotes would pass the literal text $f.' });
  I({ id: 'ar1-qd-02', module: 'D', domain: 'bash', kind: 'recall', type: 'mcq', lesson: 'ar1-d-01',
    q: 'Which sends an error message to standard error?',
    choices: ['echo "error" > 2', 'echo "error" >&2', 'echo "error" 2>&1', 'echo "error" | stderr'],
    a: 1, why: '`>&2` duplicates stdout onto file descriptor 2. `> 2` writes to a file named "2"; `2>&1` redirects stderr onto stdout.' });
  I({ id: 'ar1-qd-03', module: 'D', domain: 'bash', kind: 'explain', type: 'self', lesson: 'ar1-d-01',
    q: 'Why is `set -e` not a complete error-handling strategy?',
    a: 'It is ignored in many contexts (conditions of if/while, commands joined with && or ||, commands whose status is negated with !, and every pipeline stage but the last unless pipefail is on), and in command substitutions/functions behaviour is subtle. It also exits without telling the user what failed. Check the important commands explicitly, use pipefail, and print a useful message with a deliberate exit code.',
    points: ['Ignored in if/&&/|| contexts', 'Pipelines only report the last command without pipefail', 'No message on exit', 'Explicit checks for important steps'] });
  I({ id: 'ar1-qd-04', module: 'D', domain: 'bash', kind: 'interpret', type: 'mcq', lesson: 'ar1-d-02',
    q: '`grep ERROR app.log | wc -l` runs on a file that does not exist. With `set -o pipefail`, what is the pipeline\'s exit status?',
    choices: ['0', '2 (grep\'s status, because pipefail reports the rightmost non-zero status)', '1', '127'],
    a: 1, why: 'Without pipefail you get wc\'s 0 and the error is lost. With pipefail the pipeline returns the last non-zero status, which is grep\'s 2 for a missing file.' });
  I({ id: 'ar1-qd-05', module: 'D', domain: 'bash', kind: 'interpret', type: 'text', lesson: 'ar1-d-02',
    q: 'Write a jq filter that prints the InstanceId of every instance whose State.Name is not "running", from `aws ec2 describe-instances` output (Reservations[].Instances[]).',
    accept: ['\\.Reservations\\[\\]\\??\\s*\\.Instances\\[\\]\\??\\s*\\|\\s*select\\(.*State.*Name.*!=\\s*"running".*\\)\\s*\\|\\s*\\.InstanceId', 'select\\(\\s*\\(?\\.State\\.Name.*!=\\s*"running"'],
    a: '.Reservations[]?.Instances[]? | select(.State.Name? != "running") | .InstanceId',
    why: '`[]?` tolerates missing arrays; `select` keeps matching objects. A missing State becomes null, which is != "running" — decide out loud whether that should count.' });
  I({ id: 'ar1-qd-06', module: 'D', domain: 'bash', kind: 'recall', type: 'mcq', lesson: 'ar1-d-02',
    q: 'Which loop reads a file line by line without word-splitting or mangling backslashes?',
    choices: ['for l in $(cat f); do …', 'while IFS= read -r line; do … done < f', 'cat f | for line …', 'while read line; do … done < f'],
    a: 1, why: '`IFS=` keeps leading/trailing whitespace and `-r` keeps backslashes. `for … in $(cat f)` splits on every space.' });
  I({ id: 'ar1-qd-07', module: 'D', domain: 'bash', kind: 'explain', type: 'self', lesson: 'ar1-d-02',
    q: 'You check five endpoints. How do you make the script\'s exit status meaningful, and why bound each check with a timeout?',
    a: 'Track failures in a counter or flag as you go, print a summary, then `exit 1` if anything failed (0 if all passed, 2 for usage/input errors). Each check gets a timeout (for example `curl --max-time 5` or `--connect-timeout`) so one black-holed endpoint cannot hang the whole run and so the total runtime is bounded.',
    points: ['Accumulate failures, do not exit on the first', 'Summary output', 'Distinct exit codes', 'Per-check timeout bounds runtime'] });

  /* ═══ Diagnostic (12, separate from practice items) ══════════════ */
  LX.ar1Diag = {
    note: 'About 8 minutes. Answer from memory; "I don\'t know yet" is a useful answer, not a failure. Scores only steer where the path spends time.',
    domains: [{ id: 'net', label: 'Network fundamentals' }, { id: 'awsnet', label: 'AWS networking' }, { id: 'tf', label: 'Terraform' }, { id: 'bash', label: 'Bash' }],
    items: [
      { id: 'd-01', domain: 'net', q: 'A TCP connect attempt times out. What does that rule in?', choices: ['Nothing is listening on the port', 'Packets are being dropped (filter, missing route, or dead host)', 'DNS failed', 'The certificate expired'], a: 1 },
      { id: 'd-02', domain: 'net', q: 'How many total addresses does a /26 contain?', choices: ['32', '62', '64', '128'], a: 2 },
      { id: 'd-03', domain: 'net', q: 'A route table has 10.0.0.0/8 → A and 10.1.0.0/16 → B. Where does 10.1.2.3 go?', choices: ['A', 'B', 'Both (ECMP)', 'Dropped'], a: 1 },
      { id: 'd-04', domain: 'net', q: 'Where are a server\'s reply packets addressed?', choices: ['Port 443 on the client', 'The client\'s ephemeral source port', 'Port 0', 'The server\'s own port'], a: 1 },
      { id: 'd-05', domain: 'awsnet', q: 'Which is stateless?', choices: ['Security group', 'Network ACL', 'Both', 'Neither'], a: 1 },
      { id: 'd-06', domain: 'awsnet', q: 'A private instance needs to call an internet API. What is the usual path?', choices: ['Default route to an internet gateway', 'Default route to a NAT gateway in a public subnet', 'A security group rule', 'A VPC peering connection'], a: 1 },
      { id: 'd-07', domain: 'awsnet', q: 'A subnet with no explicit route-table association uses…', choices: ['No route table', 'The main route table', 'The IGW route table', 'The default NACL'], a: 1 },
      { id: 'd-08', domain: 'tf', q: 'What creates an implicit dependency in Terraform?', choices: ['Order of blocks in the file', 'Referencing another resource\'s attribute', 'File names', 'Alphabetical resource names'], a: 1 },
      { id: 'd-09', domain: 'tf', q: 'Which command needs cloud credentials?', choices: ['terraform fmt', 'terraform validate', 'terraform plan', 'None of them'], a: 2 },
      { id: 'd-10', domain: 'tf', q: 'Which resource connects a subnet to a route table?', choices: ['aws_route', 'aws_route_table_association', 'aws_subnet_route', 'aws_vpc_attachment'], a: 1 },
      { id: 'd-11', domain: 'bash', q: 'What is `$?` right after a command?', choices: ['Its PID', 'Its exit status', 'The number of arguments', 'Its stderr'], a: 1 },
      { id: 'd-12', domain: 'bash', q: 'Why quote "$var"?', choices: ['Speed', 'To stop word splitting and glob expansion', 'To make it read-only', 'Bash requires it'], a: 1 }
    ]
  };

  /* ═══ Delayed-recall sets (pull from modules studied earlier) ════ */
  LX.ar1Recall = {
    'recall-S2': { title: 'Delayed recall: session 1', modules: ['A'], n: 5, why: 'Retrieve yesterday\'s networking before building on it.' },
    'recall-S3': { title: 'Delayed recall: networking', modules: ['A', 'B'], n: 4, why: 'Keep the network model warm while switching to Terraform.' },
    'recall-S4': { title: 'Delayed recall: Terraform basics', modules: ['C', 'B'], n: 5, why: 'Commands, dependencies and patterns, from memory, before the blank editor.' },
    'recall-S7': { title: 'Final mixed recall', modules: ['A', 'B', 'C', 'D'], n: 6, why: 'One more spaced pass across all four domains.' }
  };

  /* ═══ Traffic-path exercises ═════════════════════════════════════
     X1 (required, S1): private EC2 → external HTTPS via NAT, incl. return.
     X2 (transfer, S7): laptop → public web server, incl. return via IGW. */
  LX.ar1Exercises = [
    {
      id: 'X1', title: 'Trace HTTPS from a private EC2 instance to an external API', mins: 11, domain: 'net',
      setup: 'Instance **app-a** (10.20.11.25, Amazon Linux, no public IP) in private subnet 10.20.11.0/24 runs `curl https://api.vendor.example/health`. The VPC is 10.20.0.0/16 with resolver 10.20.0.2. The private route table has `10.20.0.0/16 local` and `0.0.0.0/0 → nat-04f1`. The NAT gateway sits in public subnet 10.20.1.0/24 with Elastic IP 203.0.113.40; that subnet\'s table has `0.0.0.0/0 → igw-0b5e`. api.vendor.example is 192.0.2.80. All addresses are documentation ranges; the topology is invented.',
      diagram: 'path-nat',
      parts: [
        { id: 'p1', type: 'order', q: 'Order the outbound hops for the first TCP SYN (after DNS has answered).',
          steps: ['app-a security group egress allows TCP 443 (connection tracked)', 'Private subnet NACL outbound rule allows TCP 443', 'Private route table: 0.0.0.0/0 → NAT gateway', 'Public subnet NACL inbound allows the packet to the NAT gateway', 'NAT gateway rewrites source to 203.0.113.40:<NAT port>', 'Public route table: 0.0.0.0/0 → internet gateway', 'Internet gateway → 192.0.2.80:443'],
          why: 'Security groups are evaluated at the ENI before the packet leaves; the NACL at the subnet boundary; then the route lookup sends it to the NAT, which translates and forwards via the IGW.' },
        { id: 'p2', type: 'mcq', q: 'What are the destination address and port of the vendor\'s SYN-ACK when it reaches the internet gateway?',
          choices: ['10.20.11.25:443', '203.0.113.40:<the NAT gateway\'s chosen port, 1024–65535>', '10.20.11.25:<app-a ephemeral port>', '203.0.113.40:443'],
          a: 1, why: 'The vendor only ever saw the NAT gateway\'s Elastic IP and the port the NAT chose. The NAT gateway rewrites the destination back to 10.20.11.25:<original port> afterwards.' },
        { id: 'p3', type: 'mcq', q: 'On the way back, which inbound NACL rule must the **private** subnet have?',
          choices: ['Allow TCP 443 from 0.0.0.0/0', 'Allow TCP 32768–60999 from 192.0.2.80 (or 0.0.0.0/0)', 'Allow TCP 1024–65535 from 203.0.113.40', 'None — NACLs track connections'],
          a: 1, why: 'The reply enters the private subnet from the vendor\'s address (the NAT rewrites only the destination) to app-a\'s ephemeral port, which is 32768–60999 on Amazon Linux. The public subnet\'s NACL separately needs inbound 1024–65535 for replies to the NAT.' },
        { id: 'p4', type: 'mcq', q: 'Does app-a\'s security group need an inbound rule for the reply?',
          choices: ['Yes, TCP 32768–60999', 'Yes, TCP 443 from 192.0.2.80', 'No — security groups are stateful and allow replies to allowed outbound connections', 'Only if the NACL allows it'],
          a: 2, why: 'Security groups track the connection; replies to allowed outbound traffic are allowed regardless of inbound rules.' },
        { id: 'p5', type: 'classify', q: 'For each piece of evidence, which layer does it implicate?', cats: ['DNS', 'Route', 'Filter', 'TLS', 'HTTP'],
          items: [
            { text: '`curl: (6) Could not resolve host: api.vendor.example`', cat: 'DNS' },
            { text: '`aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=subnet-07d2…` returns nothing, and the main table has only `local`', cat: 'Route' },
            { text: 'Flow log on app-a\'s ENI: `192.0.2.80 10.20.11.25 443 41322 6 … REJECT`', cat: 'Filter' },
            { text: '`nc -vz api.vendor.example 443` succeeds; curl says `SSL certificate problem: certificate has expired`', cat: 'TLS' },
            { text: 'curl -v shows the TLS handshake completed, then `< HTTP/1.1 403 Forbidden`', cat: 'HTTP' },
            { text: '`dig api.vendor.example` returns `status: SERVFAIL` from 10.20.0.2', cat: 'DNS' },
            { text: 'curl times out; flow logs show no records at all for 443 from app-a, and the subnet\'s table sends 0.0.0.0/0 to an internet gateway while app-a has no public IP', cat: 'Route' }
          ], why: 'DNS errors stop before any packet to the API. Route faults show up in route tables (and as missing NAT traffic). Filter faults leave REJECT records. A completed TCP handshake moves you to TLS; a completed TLS handshake moves you to HTTP.' },
        { id: 'p6', type: 'self', q: 'In two or three sentences: what single piece of evidence separates "a route is missing" from "a filter is dropping it", and why?',
          a: 'Flow logs (or the route table itself). A filter drop produces a REJECT record on the ENI; a routing fault produces no REJECT — the packet is either never sent to the right target (route table shows no matching route / wrong target) or is ACCEPTed outbound with nothing ever coming back from the NAT. Reading the effective route table for the subnet (explicit association, else main) confirms it.',
          points: ['Names flow logs and/or the effective route table', 'REJECT implicates a filter', 'Absence of REJECT plus a wrong/missing route implicates routing', 'Mentions the explicit-vs-main association'] }
      ],
      explainAloud: 'Narrate the whole round trip for this curl in 60 seconds: DNS, the outbound hops, what the NAT changes, the reply\'s addresses, and which filters see it.',
      refs: ['AWS-NAT-BASICS', 'AWS-NACL-EPH', 'AWS-SG', 'AWS-RT', 'AWS-FLOW-EX']
    },
    {
      id: 'X2', title: 'Transfer: trace HTTPS from your laptop to a public web server', mins: 12, domain: 'net', transfer: true,
      setup: 'Your Mac (198.51.100.45) opens https://203.0.113.30/. That is the public IP of **web-a** (private 10.20.1.30, Amazon Linux) in public subnet 10.20.1.0/24, whose route table has `0.0.0.0/0 → igw-0b5e`. web-a\'s security group allows TCP 443 from 0.0.0.0/0. The subnet has a custom NACL. Invented topology, documentation addresses.',
      diagram: 'path-igw',
      parts: [
        { id: 'p1', type: 'mcq', q: 'What destination IP does web-a\'s network interface see on the incoming SYN?',
          choices: ['203.0.113.30', '10.20.1.30', '198.51.100.45', '10.20.0.1'],
          a: 1, why: 'The internet gateway translates the public IPv4 to the instance\'s private address; the instance\'s OS never sees its public IP.' },
        { id: 'p2', type: 'mcq', q: 'Which outbound NACL rule does the reply need?',
          choices: ['TCP 443 to 0.0.0.0/0', 'TCP 49152–65535 to 198.51.100.45 (or 0.0.0.0/0)', 'TCP 32768–60999 to 0.0.0.0/0', 'None'],
          a: 1, why: 'The reply goes to the Mac\'s ephemeral port; macOS uses 49152–65535. (To serve every client OS you would allow 1024–65535.)' },
        { id: 'p3', type: 'order', q: 'Order the return path for the SYN-ACK.',
          steps: ['web-a sends from 10.20.1.30:443 to 198.51.100.45:<ephemeral>', 'Security group allows it (tracked connection)', 'Public subnet NACL outbound allows the ephemeral range', 'Route table: 0.0.0.0/0 → internet gateway', 'Internet gateway rewrites the source to 203.0.113.30'],
          why: 'Mirror image of the inbound path, with the source translation happening at the internet gateway.' },
        { id: 'p4', type: 'classify', q: 'Which layer does each observation implicate?', cats: ['DNS', 'Route', 'Filter', 'TLS', 'HTTP'],
          items: [
            { text: 'curl to 203.0.113.30 hangs; flow log shows `198.51.100.45 10.20.1.30 52011 443 6 … ACCEPT` and `10.20.1.30 198.51.100.45 443 52011 6 … REJECT`', cat: 'Filter' },
            { text: '`curl: (60) SSL: no alternative certificate subject name matches target host name \'203.0.113.30\'`', cat: 'TLS' },
            { text: '`< HTTP/1.1 502 Bad Gateway` from the web server', cat: 'HTTP' },
            { text: 'The public subnet is explicitly associated with a table that has only `10.20.0.0/16 local`', cat: 'Route' }
          ], why: 'Same layers, other direction. A TLS name mismatch on an IP address is expected — certificates name hosts, so use the DNS name.' },
        { id: 'p5', type: 'self', q: 'Explain why "allow 443 inbound" on a NACL is not enough, in a way an interviewer would accept.',
          a: 'NACLs are stateless: the inbound rule admits the client\'s packets to :443, but every reply leaves towards the client\'s ephemeral port and is evaluated by the outbound rules on its own. Without an outbound rule for the ephemeral range (49152–65535 for macOS; 1024–65535 to cover all clients) the replies hit the implicit deny, which the client sees as a timeout.',
          points: ['Stateless', 'Replies go to the client\'s ephemeral port', 'Outbound rule needed for that range', 'Symptom is a timeout'] }
      ],
      explainAloud: 'Explain the inbound and return path to a public instance, and say where the public-to-private address translation happens.',
      refs: ['AWS-IGW', 'AWS-NACL-EPH', 'AWS-SG', 'AWS-EC2-IP']
    }
  ];
})();
