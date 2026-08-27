/* AWS track — decision trees. Same shape as the Linux and containers ones:
   each step is a question, the command that answers it, what it settles, and
   where it forks. Sample output for every step lives in aws-outputs.js.      */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.playbooks = LX.playbooks || [];

LX.playbooks.push(

/* ═══ 1. AccessDenied ═══ */
{
  id:'aws-denied', track:'aws', title:'AccessDenied and the policy looks right', cat:'iam', level:'advanced',
  cert:['aws-sec:identity-and-access','aws-saa:secure-architectures'],
  prompt:'"A role has a policy that clearly allows the action, and the call is still denied. Walk me through it."',
  say:'"I would work the evaluation order, because IAM answers this deterministically and there are only six places the decision can come from. An explicit deny anywhere wins first. Then an SCP has to allow it — and from inside the account you cannot see SCPs at all, which is why this one hides. Then a resource policy is checked, and inside one account an allow there is enough on its own. Then the identity policy has to allow it. Then a permissions boundary has to allow it too, and finally any session policy. Before any of that I confirm which identity is actually making the call, because a surprising share of these turn out to be the wrong profile."',
  steps:[
    { check:'Which identity is actually making the call?', cmd:'aws sts get-caller-identity --query Arn --output text',
      decide:'Compare the ARN against the role whose policy you have been reading.',
      why:'This is thirty seconds and it resolves a large fraction of these outright. Credential precedence is environment variables, then the profile, then the shared credential file, then the instance or container role — so an exported `AWS_ACCESS_KEY_ID` from a previous task silently beats the profile you passed. On an instance, the ARN you get is `assumed-role/NAME/session`, and the policy to read is the role\'s, not that of whoever created it.',
      branches:[
        { when:'Not the role you expected', then:'You have been reading the wrong policy. Start again against this ARN.' },
        { when:'The role you expected', then:'The identity is right, so the decision came from a policy. Read the error text next.' },
        { when:'An assumed-role ARN you do not recognise', then:'Something else assumed a role in the chain — check the trust policy.' } ] },

    { check:'What exactly does the denial say?', cmd:'# re-run the failing call and keep the whole message',
      decide:'The wording names the layer. It is not a generic string.',
      why:'AWS distinguishes the cases in the message and almost nobody reads it. "with an explicit deny in a service control policy" is an SCP. "with an explicit deny in an identity-based policy" is a Deny statement on the role. "with an explicit deny in a resource-based policy" is the bucket or key policy. "because no identity-based policy allows" is an implicit deny — nothing matched. And "is not authorized to perform: sts:AssumeRole" is the trust policy, a different problem entirely.',
      branches:[
        { when:'explicit deny in a service control policy', then:'Skip to the SCP step; nothing in the account can override it.' },
        { when:'no identity-based policy allows', then:'Nothing matched. Simulate the action and read which statements applied.' },
        { when:'explicit deny in a resource-based policy', then:'The bucket, key or queue policy is denying', goto:'aws-s3-403' },
        { when:'not authorized to perform: sts:AssumeRole', then:'A trust policy problem, not a permissions one.' },
        { when:'no message kept', then:'Get it. Everything below is guesswork without it.' } ] },

    { check:'What does IAM itself say the answer is?', cmd:'aws iam simulate-principal-policy --policy-source-arn ROLE_ARN --action-names ACTION --resource-arns RESOURCE --query \'EvaluationResults[].[EvalDecision,MatchedStatements[].SourcePolicyId]\'',
      decide:'The simulator names the statement that decided it — or reports that none did.',
      why:'This turns an argument into a lookup, and the `MatchedStatements` list is the part to read: it tells you which policy produced the decision rather than leaving you to guess between five attached documents. Always pass `--resource-arns`; simulating against `*` frequently returns allowed for a policy that is scoped to a different resource, which sends people off in the wrong direction entirely.',
      branches:[
        { when:'implicitDeny with no matched statements', then:'The identity policy genuinely does not cover this resource or action.' },
        { when:'explicitDeny', then:'A Deny statement exists — MatchedStatements names it.' },
        { when:'allowed, but the real call fails', then:'The simulator does not fully evaluate SCPs and resource policies. Check those next.' } ] },

    { check:'Is an SCP quietly forbidding it?', cmd:'aws organizations list-policies-for-target --target-id ACCOUNT_ID --filter SERVICE_CONTROL_POLICY   ·   aws organizations list-parents --child-id ACCOUNT_ID',
      decide:'SCPs attached to the account **and** to every OU above it all apply.',
      why:'This is the layer that produces "I am an administrator and I cannot do it", because there is no API inside a member account that shows the SCPs applying to it — the call has to run in the management account or a delegated administrator. SCPs never grant anything; they only bound what identity policies can grant. Common ones deny actions outside approved regions, deny disabling CloudTrail or GuardDuty, and deny changes to roles that carry a specific tag.',
      branches:[
        { when:'A Deny matching the action or region', then:'Only the organisation can change this. Escalate rather than editing the role.' },
        { when:'No SCP matches', then:'Check the permissions boundary next.' },
        { when:'No access to Organizations', then:'That itself is the answer for now — ask whoever owns the management account.' } ] },

    { check:'Is there a boundary or a session policy capping it?', cmd:'aws iam get-role --role-name NAME --query \'[Role.PermissionsBoundary,Role.MaxSessionDuration]\'',
      decide:'A boundary is a ceiling. The effective permission is the intersection, never the union.',
      why:'A role with `AdministratorAccess` attached and a boundary allowing only S3 can do exactly S3, and nothing in the attached-policy view hints at it. Session policies behave the same way one level down: a credential minted with `assume-role --policy` can only ever be narrower than the role. Both are deliberate guardrails, both are invisible unless you look, and both produce an implicit deny with no statement to point at.',
      branches:[
        { when:'A boundary that omits the action', then:'Widen the boundary, or use a role designed for this. Do not attach more policy — it will not help.' },
        { when:'No boundary', then:'Back to the identity policy: the grant is missing or scoped to a different resource.' },
        { when:'Credentials from assume-role --policy', then:'A session policy is capping it; mint the credential without the extra policy.' } ] },

    { check:'Confirm the fix, and confirm it narrowly', cmd:'aws iam simulate-principal-policy --policy-source-arn ROLE_ARN --action-names ACTION --resource-arns RESOURCE   ·   # then the real call',
      decide:'Simulate, then actually run it. Both, in that order.',
      why:'The simulator confirms the policy logic and the real call confirms the layers the simulator does not model. Do them in that order so that a remaining failure tells you something rather than nothing. Then check the grant you added is scoped: an incident resolved with `Action: "*"` on `Resource: "*"` is not resolved, it is deferred to the next audit.',
      branches:[
        { when:'Both pass', then:'Record why the grant is needed. The next reviewer will ask.' },
        { when:'Simulator passes, call still fails', then:'SCP or resource policy — the two things it does not fully evaluate.' } ] } ],
  probes:[
    ['Give me the evaluation order.','Explicit deny anywhere wins. Then SCPs must allow. Then a resource-based policy — inside one account an allow there suffices on its own; cross-account both sides must allow. Then the identity policy must allow. Then the permissions boundary must also allow. Then any session policy. Default is deny, so "nothing matched" and "denied" are the same result.'],
    ['Why can an account administrator be denied?','An SCP. It applies above the account, it cannot be overridden from inside, and it is invisible to any API call made within the member account.'],
    ['What is the difference between a boundary and a policy?','A policy grants. A boundary caps. The effective permission set is the intersection of the two, so attaching more policy to a bounded role changes nothing.'],
    ['A cross-account call fails. Where do you look?','Both ends. The caller needs an identity policy allowing the action, and the resource — bucket, key, queue — needs a resource policy naming that principal. For a role it is also the trust policy. One side alone is never enough.']
  ],
  trap:'Attaching a broader policy until it works. If the decision came from an SCP, a boundary or an explicit deny, more permission changes nothing — you end up with an over-privileged role *and* the original outage.',
  remember:'Explicit deny → SCP → resource policy → identity policy → boundary → session policy. And always check who you actually are first.'
},

/* ═══ 2. instance unreachable ═══ */
{
  id:'aws-unreachable', track:'aws', title:'An EC2 instance is unreachable', cat:'vpc', level:'beginner',
  cert:['aws-saa:secure-architectures','aws-sysops:networking'],
  prompt:'"You cannot reach an instance — SSH times out. How do you find out why?"',
  say:'"I work outwards from the instance because each layer rules out the ones below it. Is the instance running and passing both status checks? Then is there a route to it at all — public IP, internet gateway, route table? Then the two firewalls: the security group, which is stateful and allow-only, and the NACL, which is stateless and needs a return rule for ephemeral ports. Only after all four do I consider the operating system, and by then the console output usually tells me."',
  steps:[
    { check:'Is it running, and are both status checks passing?', cmd:'aws ec2 describe-instance-status --instance-ids i-… --include-all-instances',
      decide:'System status is AWS\'s hardware. Instance status is your operating system.',
      why:'These two checks split the problem cleanly and cost one call. A failed **system** check means the underlying host or its network is unhealthy — a stop/start migrates you to new hardware and a reboot does not. A failed **instance** check is your OS: it did not finish booting, the filesystem is full, or a kernel or fstab change broke it. If both pass, the instance is fine and the problem is the path to it.',
      branches:[
        { when:'System check failed', then:'AWS-side. Stop and start to move hosts; a reboot stays on the same one.' },
        { when:'Instance check failed', then:'The OS did not come up. Read the console output.' },
        { when:'Both passing', then:'It is healthy. The problem is the network path.' },
        { when:'Instance not running', then:'Check why it stopped', goto:'aws-who-changed' } ] },

    { check:'Is there a path to it at all?', cmd:'aws ec2 describe-instances --instance-ids i-… --query \'Reservations[0].Instances[0].{ip:PublicIpAddress,subnet:SubnetId,sg:SecurityGroups[].GroupId,az:Placement.AvailabilityZone}\'   ·   aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=subnet-…',
      decide:'For public access you need all of: a public IP, an internet gateway, and a 0.0.0.0/0 route to it.',
      why:'"Public subnet" is not a property a subnet has — it is a subnet whose route table sends 0.0.0.0/0 to an internet gateway. A subnet with no explicit route table association inherits the VPC main table, which is how a new subnet ends up private while looking identical to its neighbours. A missing public IP is the other half: an instance without one is unreachable from outside no matter how open the security group is.',
      branches:[
        { when:'No public IP', then:'Reach it privately — SSM, a bastion, or the VPN — or attach an Elastic IP.' },
        { when:'No 0.0.0.0/0 route to an igw', then:'It is a private subnet. That may be correct; use SSM instead.' },
        { when:'Route points at a deleted gateway (blackhole)', then:'Fix the route; packets are being dropped silently.' },
        { when:'Path looks right', then:'On to the firewalls.' } ] },

    { check:'Does the security group allow it?', cmd:'aws ec2 describe-security-groups --group-ids sg-… --query \'SecurityGroups[0].IpPermissions\'',
      decide:'Allow-only and stateful — you are looking for a missing allow, not a hidden deny.',
      why:'Security groups have no deny rules, so this layer either permits the traffic or it does not. Because they are stateful, the reply to an allowed inbound connection is automatically permitted regardless of egress rules, which rules out a whole class of theory. Check the source too: `0.0.0.0/0` on port 22 is a finding, and a rule scoped to an office CIDR that changed last month is a very common cause of "it worked yesterday".',
      branches:[
        { when:'No rule for the port', then:'That is it. Add a scoped rule — never 0.0.0.0/0 for SSH.' },
        { when:'Rule exists but the source CIDR does not include you', then:'Your address changed, or you are coming through a different NAT.' },
        { when:'Rule looks correct', then:'Check the NACL, which is where one-way failures live.' } ] },

    { check:'Does the NACL allow it *both* ways?', cmd:'aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=subnet-… --query \'NetworkAcls[].Entries[]\'',
      decide:'Stateless: the response needs its own outbound rule to ports 1024–65535.',
      why:'This is the classic asymmetric failure. A NACL allowing inbound 22 and outbound 22 lets the connection in and drops every packet coming back, because the reply goes to the client\'s ephemeral port, not to 22. The result is a timeout that looks exactly like a dead host. Rules are also evaluated in ascending numeric order with first match winning, so a broad deny at rule 90 beats a correct allow at rule 100.',
      branches:[
        { when:'No outbound rule for 1024–65535', then:'Found it. Add the ephemeral range.' },
        { when:'A low-numbered deny matching your source', then:'First match wins — renumber or remove it.' },
        { when:'Default NACL, allow all', then:'Not this layer. Confirm with flow logs.' } ] },

    { check:'Do the packets even arrive?', cmd:'aws ec2 describe-flow-logs   ·   # then query for REJECT on the interface   ·   aws ec2 start-network-insights-analysis …',
      decide:'REJECT means a firewall dropped it. No record at all means it never arrived.',
      why:'Flow logs settle the argument that theory cannot. A `REJECT` line proves the packet reached the interface and was dropped by a security group or NACL, which sends you back one step with certainty. **No record at all** means routing, DNS or the client — the packet never got here. Reachability Analyzer answers the same question from configuration in seconds without needing logs enabled, and names the blocking component directly.',
      branches:[
        { when:'REJECT records', then:'A firewall is dropping it — go back and find which.' },
        { when:'No records', then:'Nothing is arriving: routing, DNS, or you are on the wrong network.' },
        { when:'ACCEPT records but still no service', then:'Packets arrive and nothing is listening — the OS or the application.' } ] },

    { check:'Get onto the box without the network', cmd:'aws ssm start-session --target i-…   ·   aws ec2 get-console-output --instance-id i-… --latest --output text | tail -50',
      decide:'SSM needs no inbound rule; console output needs nothing at all.',
      why:'Both routes bypass the layer you have been debugging. SSM requires only that the agent runs, the instance role includes `AmazonSSMManagedInstanceCore`, and the agent can reach the SSM endpoints — through NAT or through VPC endpoints. If SSM is unavailable, the console log still shows a full root filesystem, an fstab entry for a volume that no longer exists, a failed cloud-init script or a kernel that will not boot, all of which look identical from outside.',
      branches:[
        { when:'Console shows a boot failure', then:'The OS, not the network. Fix by rebuilding or by attaching the volume elsewhere.' },
        { when:'SSM connects fine', then:'The instance is healthy; only inbound access is broken. That is a firewall or routing fix.' },
        { when:'Neither works and both checks pass', then:'Check the instance role and whether SSM endpoints are reachable', goto:'aws-no-egress' } ] } ],
  probes:[
    ['Security group versus NACL — one sentence each.','A security group is stateful, allow-only and attached to an interface. A NACL is stateless, ordered, allows and denies, and applies to a whole subnet — so it needs an explicit rule for return traffic on ephemeral ports.'],
    ['What makes a subnet public?','A route table entry sending 0.0.0.0/0 to an internet gateway. Nothing else. The instance also needs a public or elastic IP to be reached from outside.'],
    ['SSH times out versus connection refused — what does the difference tell you?','Timeout means the packet is being dropped: a security group, a NACL, or no route. Refused means something answered — the host is reachable and nothing is listening on that port, so it is a service problem.'],
    ['How would you reach an instance in a private subnet with no bastion?','SSM Session Manager. It needs the agent, an instance role with AmazonSSMManagedInstanceCore, and either NAT or the ssm, ssmmessages and ec2messages VPC endpoints — and it opens no inbound port at all.']
  ],
  trap:'Opening the security group to 0.0.0.0/0 to "test", and then leaving it. If the NACL was the problem it did not even help, and now the instance is exposed.',
  remember:'Status checks, then route, then security group, then NACL, then the OS. Timeout is dropped; refused is reachable.'
},

/* ═══ 3. no egress ═══ */
{
  id:'aws-no-egress', track:'aws', title:'A private subnet cannot reach the internet', cat:'vpc', level:'intermediate',
  cert:['aws-saa:secure-architectures','aws-sysops:networking'],
  prompt:'"An instance in a private subnet cannot download packages or reach an AWS API. What is wrong?"',
  say:'"Outbound from a private subnet goes through a NAT gateway, so I check that path in order: does the route table have a default route to a NAT gateway, is that gateway actually alive and in a public subnet, and does that public subnet have its own route to an internet gateway. If it is an AWS API rather than the general internet, I check whether there is a VPC endpoint that should be handling it instead — and whether private DNS is enabled on it, because without that nothing uses it."',
  steps:[
    { check:'Is there a default route, and where does it point?', cmd:'aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=subnet-… --query \'RouteTables[].Routes[]\'',
      decide:'You want 0.0.0.0/0 with a NatGatewayId, in state active.',
      why:'Three failure modes hide here. There may be no default route at all, which is a subnet that was never finished. The route may point at a NAT gateway that has been deleted, in which case `State: blackhole` and every packet is discarded silently. Or the subnet may have no explicit route table association and be inheriting the VPC main table, which frequently has no NAT route.',
      branches:[
        { when:'No 0.0.0.0/0 route', then:'Add one to the NAT gateway in the same AZ.' },
        { when:'State: blackhole', then:'The next hop is gone. Recreate the NAT gateway and repoint the route.' },
        { when:'Points at an internet gateway', then:'Then this is a public subnet and the instance needs a public IP', goto:'aws-unreachable' },
        { when:'Route looks right', then:'Check the NAT gateway itself.' } ] },

    { check:'Is the NAT gateway healthy, and where does it live?', cmd:'aws ec2 describe-nat-gateways --filter Name=vpc-id,Values=vpc-… --query \'NatGateways[].[NatGatewayId,SubnetId,State,NatGatewayAddresses[0].PublicIp]\'',
      decide:'It must be available, in a **public** subnet, and ideally in the same AZ as the caller.',
      why:'A NAT gateway placed in a private subnet is the mistake that produces a configuration which looks perfect and moves no traffic — it needs a public subnet with an internet gateway route to have anywhere to send packets. It is also zonal: one gateway serving three AZs works, bills the other two AZs\' traffic as cross-AZ transfer on top of NAT processing, and takes outbound traffic down for everything when that one AZ has a bad day.',
      branches:[
        { when:'Gateway in a private subnet', then:'That is the fault. It must sit in a subnet with an igw route.' },
        { when:'State: failed or deleted', then:'Recreate it and update every route table pointing at it.' },
        { when:'One gateway, several AZs', then:'It works, but it is a single point of failure and a cross-AZ bill.' },
        { when:'Healthy and correctly placed', then:'Check the NAT subnet\'s own route to the internet gateway.' } ] },

    { check:'Can the NAT gateway itself get out?', cmd:'aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=NAT_SUBNET --query \'RouteTables[].Routes[?DestinationCidrBlock==`0.0.0.0/0`]\'',
      decide:'The NAT gateway\'s subnet needs 0.0.0.0/0 pointing at an internet gateway.',
      why:'This is the layer people skip because they have already checked "a" route table. Two different subnets are involved: the private one routes to the NAT gateway, and the NAT gateway\'s own public subnet routes to the internet gateway. If the second is missing, packets arrive at the NAT gateway and stop there — and every diagnostic on the instance says "timeout", which points nowhere.',
      branches:[
        { when:'No igw route in the NAT subnet', then:'Found it. That subnet is not actually public.' },
        { when:'No internet gateway attached to the VPC', then:'Attach one; nothing in the VPC can reach the internet without it.' },
        { when:'Route is correct', then:'The path is fine. Check NACLs and then whether this should use an endpoint.' } ] },

    { check:'Is a NACL blocking the return traffic?', cmd:'aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=subnet-… --query \'NetworkAcls[].Entries[?Egress==`true`]\'',
      decide:'Outbound 443 out, and inbound 1024–65535 back.',
      why:'Because NACLs are stateless, outbound HTTPS needs a matching inbound rule for the **ephemeral** port range that the response comes back on. A NACL that allows outbound 443 and inbound 443 permits the request and silently drops every response, which presents as a hang partway through a package download rather than as a clean failure — and looks nothing like a firewall problem.',
      branches:[
        { when:'No inbound ephemeral rule', then:'That is it. Add 1024–65535 inbound from 0.0.0.0/0 or the relevant range.' },
        { when:'Default NACL', then:'Allows everything both ways; not this layer.' },
        { when:'Rules look right', then:'If this is an AWS API rather than the internet, check endpoints next.' } ] },

    { check:'Should this be going through a VPC endpoint at all?', cmd:'aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=vpc-… --query \'VpcEndpoints[].[ServiceName,VpcEndpointType,State,PrivateDnsEnabled]\'',
      decide:'S3 and DynamoDB use free gateway endpoints; everything else is an interface endpoint with private DNS.',
      why:'For AWS API traffic the internet is the wrong answer. A **gateway** endpoint for S3 costs nothing and works by adding a route — pass the route table ids when creating it, or it exists and does nothing. An **interface** endpoint only takes effect when `PrivateDnsEnabled` is true; without that, callers keep resolving the public name, keep going out through NAT, and keep paying for it. This is also how a fully private subnet reaches SSM at all.',
      branches:[
        { when:'Endpoint exists, PrivateDnsEnabled false', then:'Nothing is using it. Enable private DNS.' },
        { when:'Gateway endpoint with no route table association', then:'It was created without --route-table-ids. Associate it.' },
        { when:'No endpoints and heavy S3 traffic', then:'The largest easy saving in most VPCs. Add the gateway endpoint.' },
        { when:'SSM specifically', then:'ssm, ssmmessages and ec2messages endpoints, or the agent stays offline.' } ] } ],
  probes:[
    ['Why would a NAT gateway exist and still not work?','It is in a private subnet, so it has no route to an internet gateway; or the route pointing at it is a blackhole because it was recreated with a new id; or a stateless NACL is dropping the return traffic.'],
    ['Gateway endpoint versus interface endpoint.','Gateway endpoints are S3 and DynamoDB only, free, and work by adding a route to the table you name. Interface endpoints are ENIs with an hourly charge and only take effect when private DNS is enabled.'],
    ['How do you cut a NAT bill?','Move S3 and DynamoDB traffic to gateway endpoints — free and usually the biggest single line. Then check for cross-AZ NAT by running one gateway per AZ, and look at what is chattering: a container pulling an image on every start is a common surprise.'],
    ['A fully private subnet with no NAT — can an instance still be managed?','Yes, with interface endpoints for ssm, ssmmessages and ec2messages. That is the pattern for a genuinely isolated workload that still needs patching and session access.']
  ],
  trap:'Adding an internet gateway route to the private subnet to "just make it work". That makes the subnet public, exposes anything with a public IP, and usually still fails because the instances have no public address.',
  remember:'Two route tables, not one: private → NAT, and the NAT\'s own subnet → internet gateway. And AWS API traffic should not be leaving the VPC at all.'
},

/* ═══ 4. ALB 5xx ═══ */
{
  id:'aws-alb-5xx', track:'aws', title:'The load balancer returns 502 or 503', cat:'scale', level:'intermediate',
  cert:['aws-saa:high-performing','aws-sysops:reliability'],
  prompt:'"Your ALB is returning 5xx. How do you tell whose fault it is?"',
  say:'"The two codes mean different things and that is the first split. A 503 from an ALB usually means there are no healthy targets to send to — the target group is empty or everything is failing its health check. A 502 means it did reach a target and got something it could not use: a connection reset, a malformed response, or a timeout mid-request. So I start at target health, read the reason rather than the state, and then decide whether I am debugging the health check or the application."',
  steps:[
    { check:'Are there any healthy targets?', cmd:'aws elbv2 describe-target-health --target-group-arn $TG --query \'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason,TargetHealth.Description]\'',
      decide:'Read the Reason. Four reasons route to four different investigations.',
      why:'`Target.FailedHealthChecks` means the check reached the target and got the wrong answer — wrong path, wrong status code, or the app is still starting. `Target.Timeout` means nothing answered at all, which is a security group or a process not listening. `Target.NotRegistered` means the Auto Scaling group never added it, so the problem is upstream. `Elb.InternalError` is rare and genuinely AWS. The state alone tells you none of this.',
      branches:[
        { when:'Empty target list', then:'503 with no targets. The ASG or the registration is the problem', goto:'aws-asg-churn' },
        { when:'FailedHealthChecks', then:'The check is reaching the app and disagreeing with it. Compare the check to reality.' },
        { when:'Target.Timeout', then:'Nothing is answering — security group or the process is not listening.' },
        { when:'All healthy', then:'Targets are fine, so the 502 is per-request. Look at the access logs.' } ] },

    { check:'Is the health check asking the right question?', cmd:'aws elbv2 describe-target-groups --target-group-arns $TG --query \'TargetGroups[0].{path:HealthCheckPath,port:HealthCheckPort,proto:HealthCheckProtocol,codes:Matcher.HttpCode,interval:HealthCheckIntervalSeconds,healthy:HealthyThresholdCount}\'',
      decide:'Path, port, protocol and expected status must match what the app actually serves.',
      why:'Most FailedHealthChecks are the check being wrong rather than the app being unhealthy. A `/` path on an app that redirects to `/login` returns 302 and fails a matcher of 200. A check on the traffic port when the app serves health on a different one fails identically. And a health check that hits a database is worse than useless — a slow query then takes the whole fleet out of service at once.',
      branches:[
        { when:'Path returns a redirect', then:'Either widen the matcher or point the check at a real health endpoint.' },
        { when:'Wrong port', then:'Health check port can differ from traffic port; set it explicitly.' },
        { when:'Check is correct and still failing', then:'The application really is unhealthy. Read its logs.' } ] },

    { check:'Can the load balancer reach the target at all?', cmd:'aws ec2 describe-security-groups --group-ids $TARGET_SG --query \'SecurityGroups[0].IpPermissions\'',
      decide:'The target group must allow the load balancer\'s security group on the traffic port and the health check port.',
      why:'`Target.Timeout` is nearly always this. The correct pattern is a rule on the instance security group whose source is the **load balancer\'s security group id**, not a CIDR — it then follows the load balancer\'s nodes as they change addresses, which they do. A CIDR-based rule written against today\'s subnet works until the load balancer scales into another one.',
      branches:[
        { when:'No rule for the LB security group', then:'That is it. Add the group reference, not a CIDR.' },
        { when:'Rule exists on 80 but the check uses 8080', then:'The health check port needs its own allow.' },
        { when:'Security group is fine', then:'Get on the instance: is the process listening, and on which address?' } ] },

    { check:'Is the app listening on the right address?', cmd:'aws ssm start-session --target i-…   ·   ss -ltnp | grep :8080',
      decide:'127.0.0.1:8080 is unreachable from the load balancer. 0.0.0.0:8080 is reachable.',
      why:'A process bound to localhost passes every local test its developer runs and fails every health check from outside. This is the single most common cause of a target group that times out while the application is demonstrably up. The same applies to a container published to `127.0.0.1:8080` on the host. Confirm with `curl` from the instance to its own private address rather than to localhost.',
      branches:[
        { when:'Bound to 127.0.0.1', then:'Found it. Bind to 0.0.0.0 or to the private address.' },
        { when:'Not listening at all', then:'The application failed to start — read its logs and the console output.' },
        { when:'Listening on 0.0.0.0', then:'Reachable in principle; go to the access logs for the per-request failure.' } ] },

    { check:'What do the access logs say about the failing requests?', cmd:'# ALB access logs in S3, queried with Athena   ·   aws logs start-query --log-group-name /aws/alb/… …',
      decide:'target_status_code versus elb_status_code splits app errors from load balancer errors.',
      why:'The ALB access log has both codes on every line. `elb_status_code 502` with `target_status_code -` means the target never returned a valid response — a reset, a closed connection, or a timeout. Both showing 502 means the application genuinely returned one. The other field to read is `target_processing_time`: values sitting exactly at the idle timeout point at a keep-alive mismatch, where the target closes connections sooner than the load balancer expects.',
      branches:[
        { when:'target_status_code is -', then:'The target never answered properly. Check timeouts and keep-alive settings.' },
        { when:'target_processing_time at the idle timeout', then:'Set the target\'s keep-alive higher than the ALB idle timeout.' },
        { when:'Application really returned 502', then:'It is an application bug; the load balancer is reporting faithfully.' } ] } ],
  probes:[
    ['502 versus 503 from an ALB.','503 means no healthy targets to route to. 502 means a target was reached and returned something unusable — a reset, a malformed response, or a timeout mid-request.'],
    ['Why reference a security group instead of a CIDR?','Load balancer nodes change addresses as they scale. A group reference follows them; a CIDR written against today\'s subnets breaks the first time the ALB scales into a new one.'],
    ['A health check that queries the database — good or bad?','Bad. A slow database then fails every target at once and takes the whole service out. Health checks should test that this instance can serve, not that the whole system is well.'],
    ['Requests fail at exactly 60 seconds. What is that?','The ALB idle timeout. Either the request genuinely takes longer, or the target closes idle connections sooner than the ALB does — set the application keep-alive above the ALB idle timeout.']
  ],
  trap:'Raising the healthy threshold or the timeout until the alarm stops. That hides an unhealthy fleet behind a slower detector, and the next real failure takes longer to notice.',
  remember:'Read TargetHealth.Reason, not State. Timeout is a security group or a bind address; FailedHealthChecks is usually the check being wrong.'
},

/* ═══ 5. S3 403 ═══ */
{
  id:'aws-s3-403', track:'aws', title:'S3 returns 403 for a role that should have access', cat:'s3', level:'intermediate',
  cert:['aws-sec:data-protection','aws-saa:secure-architectures'],
  prompt:'"A role can list a bucket but gets AccessDenied on the objects. Where do you look?"',
  say:'"S3 access is a union of several inputs and the error names none of them, so I go through them in a fixed order: the identity policy, the bucket policy, Block Public Access, object ownership and ACLs, the endpoint policy if the call came through a VPC endpoint, and the KMS key policy if the objects are encrypted with a customer-managed key. The split between listing and reading is a strong hint on its own — ListBucket is a bucket-level action and GetObject is object-level, so a policy with the wrong ARN form grants exactly one of them."',
  steps:[
    { check:'Which identity, and does its policy cover both ARN forms?', cmd:'aws sts get-caller-identity --query Arn --output text   ·   aws iam simulate-principal-policy --policy-source-arn ROLE --action-names s3:GetObject --resource-arns \'arn:aws:s3:::bucket/key\'',
      decide:'`s3:ListBucket` needs `arn:aws:s3:::bucket`; `s3:GetObject` needs `arn:aws:s3:::bucket/*`.',
      why:'This is the most common S3 policy bug and it produces exactly the symptom of listing working and reading failing. The bucket itself and the objects inside it are different resources with different ARN forms, and a policy that names only one of them grants only one class of action. Simulating with a real object ARN rather than a wildcard exposes it immediately.',
      branches:[
        { when:'Only the bucket ARN is present', then:'Add the /* form for object actions.' },
        { when:'Both forms present and simulated allow', then:'The identity side is fine — move to the bucket policy.' },
        { when:'Wrong identity entirely', then:'Read the right role\'s policy', goto:'aws-denied' } ] },

    { check:'What does the bucket policy say?', cmd:'aws s3api get-bucket-policy --bucket NAME --query Policy --output text | jq .',
      decide:'Look for Deny statements first — one explicit Deny overrides every allow anywhere.',
      why:'Bucket policies commonly carry a Deny with a condition, and the condition is where the surprise lives: `aws:SecureTransport false` denies plain HTTP, `s3:x-amz-server-side-encryption` denies unencrypted uploads, and `aws:SourceVpce` denies anything not arriving through a specific VPC endpoint. Each of those denies a caller whose identity policy is perfect. `NoSuchBucketPolicy` is a normal answer meaning no policy exists, not an error.',
      branches:[
        { when:'A Deny with a condition you do not meet', then:'That is the answer — read the condition key carefully.' },
        { when:'Cross-account and no Allow naming your principal', then:'Cross-account needs both sides. Add the principal here.' },
        { when:'No bucket policy', then:'Then the identity policy is the only grant. Check ownership and KMS next.' } ] },

    { check:'Is Block Public Access or object ownership involved?', cmd:'aws s3api get-public-access-block --bucket NAME   ·   aws s3api get-bucket-ownership-controls --bucket NAME',
      decide:'BPA overrides policy for public access; ownership decides whether ACLs matter at all.',
      why:'Block Public Access is deliberately absolute: with `RestrictPublicBuckets` on, a policy granting public access is neutralised rather than removed, so the policy reads as though it should work. Object ownership is the other one — with `BucketOwnerEnforced`, ACLs are disabled entirely, so an object uploaded by another account is owned by the bucket owner and a cross-account grant that relied on an ACL stops working.',
      branches:[
        { when:'Access is meant to be public', then:'It should almost certainly not be. Use a presigned URL or CloudFront with OAC instead.' },
        { when:'Objects owned by another account', then:'Uploads must set bucket-owner-full-control, or switch to BucketOwnerEnforced.' },
        { when:'Neither applies', then:'Check encryption — this is where most remaining 403s come from.' } ] },

    { check:'Is it actually a KMS denial?', cmd:'aws s3api head-object --bucket NAME --key KEY --query \'[ServerSideEncryption,SSEKMSKeyId]\'   ·   aws kms get-key-policy --key-id KEY --policy-name default',
      decide:'`kms:Decrypt` on the key policy is required in addition to the S3 permission.',
      why:'An object encrypted with a customer-managed key requires the caller to have `kms:Decrypt` — and KMS key policies are mandatory rather than optional, so an identity policy alone is not enough. S3 reports the failure as `AccessDenied` with no mention of KMS, which is why this is missed so often. Cross-account access needs the key policy to name the principal *and* the caller\'s identity policy to allow the KMS action.',
      branches:[
        { when:'SSE-KMS with a customer key', then:'Add the principal to the key policy and kms:Decrypt to the role.' },
        { when:'SSE-S3 (AES256)', then:'No KMS involved; go back to the policy layers.' },
        { when:'Cross-account with SSE-KMS', then:'Both sides again: key policy and identity policy', goto:'aws-denied' } ] },

    { check:'Did the request come through a VPC endpoint?', cmd:'aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=vpc-… --query \'VpcEndpoints[?contains(ServiceName,`s3`)].[VpcEndpointId,PolicyDocument]\'',
      decide:'An endpoint policy is another allow that must be present.',
      why:'A VPC endpoint has its own policy and it defaults to full access — but once someone scopes it to "our buckets only", any call to a bucket outside that list fails with a 403 that looks identical to an IAM problem. This is a good control and a confusing failure: it is a deliberate boundary stopping data leaving to an unapproved account, and it is invisible from the caller\'s side.',
      branches:[
        { when:'Endpoint policy excludes the bucket', then:'Deliberate boundary. Add the bucket if it is legitimate, and ask why it was not.' },
        { when:'No endpoint policy', then:'Not this layer.' },
        { when:'Bucket policy requires aws:SourceVpce and you are not using it', then:'The call must go through that endpoint. Route it, or relax the condition.' } ] } ],
  probes:[
    ['Listing works, reading fails. First guess?','The policy names arn:aws:s3:::bucket but not arn:aws:s3:::bucket/*. ListBucket is a bucket-level action; GetObject is object-level, and they need different resource ARNs.'],
    ['Name three ways to get a 403 with a correct IAM policy.','A Deny in the bucket policy — often conditional on SecureTransport, encryption or SourceVpce. A KMS key policy that does not allow the principal. A VPC endpoint policy scoped to other buckets. Block Public Access is a fourth if the access was meant to be public.'],
    ['How do you share one object with someone with no AWS account?','A presigned URL. It carries your permissions for a bounded time and needs no identity on their side. For a whole site, CloudFront with origin access control and a private bucket.'],
    ['Cross-account S3 with SSE-KMS — what is needed?','Four things: the bucket policy allows the principal, the caller\'s identity policy allows the S3 action, the key policy allows the principal for kms:Decrypt, and the caller\'s identity policy allows the KMS action too. Missing any one produces the same 403.']
  ],
  trap:'Making the bucket public to unblock a job. It resolves nothing that a scoped policy would not, and it is the incident everyone can name.',
  remember:'Bucket ARN for listing, bucket/* for objects. And an S3 403 with no obvious cause is usually KMS.'
},

/* ═══ 6. RDS connectivity ═══ */
{
  id:'aws-rds-conn', track:'aws', title:'The application cannot connect to RDS', cat:'rds', level:'intermediate',
  cert:['aws-saa:resilient-architectures','aws-sysops:reliability'],
  prompt:'"Your app is timing out on the database. Where do you start?"',
  say:'"First I separate timeout from refused from authentication failure, because they land in completely different places. A timeout is network — security groups, subnets, the wrong endpoint. Refused or an authentication error means I reached the database, so it is credentials, TLS, or the database itself. Then I check whether RDS did something: a failover, a storage-full event, or a connection limit, all of which show up in describe-events and none of which show up in the application logs as anything useful."',
  steps:[
    { check:'What is the database\'s actual state and endpoint?', cmd:'aws rds describe-db-instances --db-instance-identifier ID --query \'DBInstances[0].[DBInstanceStatus,Endpoint.Address,Endpoint.Port,MultiAZ,PubliclyAccessible]\'',
      decide:'Compare the endpoint to what the application is configured with.',
      why:'Applications are routinely pointed at a stale endpoint — an instance that was restored under a new name, a reader endpoint used for writes, or an IP address cached from a previous failover. The status matters as much: `storage-full` and `incompatible-parameters` are states where the instance exists, answers nothing useful, and produces an application error that mentions none of it.',
      branches:[
        { when:'Endpoint differs from the app config', then:'That is it — usually a restore that came back under a new name.' },
        { when:'Status is storage-full', then:'Writes are rejected. Grow storage or enable storage autoscaling.' },
        { when:'Status available and endpoint matches', then:'Move to the network path.' },
        { when:'App uses an IP address', then:'Never do that: a failover changes it. Use the endpoint name.' } ] },

    { check:'Does the network path exist?', cmd:'aws rds describe-db-instances --db-instance-identifier ID --query \'DBInstances[0].VpcSecurityGroups[].VpcSecurityGroupId\'   ·   aws ec2 describe-security-groups --group-ids sg-…',
      decide:'The database security group must allow the application\'s security group on the database port.',
      why:'The right pattern is a rule whose source is the application\'s security group id, not a CIDR — it then survives every re-IP and every subnet change. A timeout with a correct-looking rule usually means the application is in a different VPC or account than assumed, and a peering or Transit Gateway route is missing. Remember that a database in a private subnet is not reachable from your laptop by design, so testing from the wrong place produces a false failure.',
      branches:[
        { when:'No rule for the app security group', then:'Add it, referencing the group rather than a CIDR.' },
        { when:'Different VPC', then:'Peering or Transit Gateway route missing', goto:'aws-no-egress' },
        { when:'Rule present and correct', then:'Packets should arrive. Test from inside the VPC to confirm.' } ] },

    { check:'Prove it from somewhere the app actually runs', cmd:'aws ssm start-session --target i-…   ·   nc -zv DB_ENDPOINT 5432   ·   dig +short DB_ENDPOINT',
      decide:'Timeout, refused, and DNS failure are three different problems.',
      why:'Testing from the application\'s own host removes every assumption at once. **Timeout** means packets are being dropped — back to security groups and routing. **Refused** means something answered, so the network is fine and the problem is the database or the port. **DNS returning nothing** points at a private hosted zone, a missing VPC DNS attribute, or a genuinely wrong hostname — and note that an RDS endpoint resolving to a private address from outside the VPC is expected, not a fault.',
      branches:[
        { when:'Timeout', then:'Network. Go back to the security group and the route.' },
        { when:'Refused', then:'Reachable. It is credentials, TLS, or the database rejecting the connection.' },
        { when:'DNS does not resolve', then:'Check enableDnsHostnames on the VPC and any private hosted zone.' } ] },

    { check:'Has RDS itself done something?', cmd:'aws rds describe-events --source-identifier ID --source-type db-instance --duration 1440 --query \'Events[].[Date,Message]\'',
      decide:'Failovers, restarts, storage events and parameter changes all appear here.',
      why:'A Multi-AZ failover shows as a pair of events about a minute apart and explains a burst of errors that otherwise looks like an application bug — connection pools holding sockets across a failover fail in exactly that shape, and the fix is client-side timeouts and retries rather than anything on the database. Storage autoscaling, backup windows and maintenance reboots are the other events that explain a mystery outage nobody can attribute.',
      branches:[
        { when:'Failover in the window', then:'The pool held dead connections. Fix client timeouts and retry logic.' },
        { when:'Storage-full', then:'Writes were rejected. Grow storage and set an alarm well before the ceiling.' },
        { when:'Nothing in the events', then:'The database was steady — look at connection limits.' } ] },

    { check:'Is it out of connections?', cmd:'aws cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name DatabaseConnections --dimensions Name=DBInstanceIdentifier,Value=ID --start-time … --end-time … --period 300 --statistics Maximum   ·   aws rds describe-db-parameters --db-parameter-group-name GROUP --query \'Parameters[?ParameterName==`max_connections`]\'',
      decide:'Compare peak connections against max_connections, which on RDS is derived from instance memory.',
      why:'Connection exhaustion presents as intermittent timeouts under load and looks exactly like a network problem. `max_connections` defaults to a formula based on the instance class, so scaling **down** an instance silently lowers it. The usual real fix is a proxy or a smaller pool rather than a bigger database: every application instance holding thirty idle connections multiplies fast, and RDS Proxy exists precisely for that shape.',
      branches:[
        { when:'At or near max_connections', then:'Pool smaller, or put RDS Proxy in front. Raising the limit trades one failure for another.' },
        { when:'Connections low', then:'Not saturation. Look at slow queries and locks in the database logs.' },
        { when:'Spiky and correlated with deploys', then:'Each deploy is opening a new pool without draining the old one.' } ] } ],
  probes:[
    ['Timeout versus refused versus auth error.','Timeout is network — dropped packets, so security groups or routing. Refused means you reached the host and nothing is listening on that port. An authentication error means you reached the database itself, so everything below the credential layer is working.'],
    ['Is Multi-AZ a scaling feature?','No. The standby serves no traffic; it exists for availability. Failover is a DNS change taking a minute or two. Read replicas are the scaling answer, and they are asynchronous, so a read straight after a write can miss it.'],
    ['Why would connections suddenly hit the ceiling after a resize?','max_connections on RDS is derived from instance memory by default, so scaling down lowers it. Nothing in the application changed and the limit moved underneath it.'],
    ['How do you make an application survive a failover?','Connect by endpoint name and never cache the IP, keep connection lifetimes short, set aggressive socket timeouts, and retry idempotent operations with backoff. Then test it by triggering a failover deliberately.']
  ],
  trap:'Making the database publicly accessible to test connectivity from a laptop. It proves nothing about the application\'s path and it is an exposure that outlives the incident.',
  remember:'Timeout is network, refused is the port, auth error means you already arrived. And always check describe-events for a failover.'
},

/* ═══ 7. ASG churn ═══ */
{
  id:'aws-asg-churn', track:'aws', title:'Auto Scaling keeps replacing instances', cat:'scale', level:'intermediate',
  cert:['aws-sysops:reliability','aws-saa:resilient-architectures'],
  prompt:'"An Auto Scaling group is launching and terminating instances in a loop. What is happening?"',
  say:'"The group logs its own reasoning, so I read the scaling activities first — the Cause field is a sentence in English and usually names it. The loop is nearly always one of three things: the health check type is ELB and the target group is failing, the grace period is shorter than the application takes to boot, or the launch itself is failing on quota or capacity and the group is retrying. I also suspend the ReplaceUnhealthy process early so I have a stable instance to look at."',
  steps:[
    { check:'What does the group say it is doing, and why?', cmd:'aws autoscaling describe-scaling-activities --auto-scaling-group-name NAME --max-items 10 --query \'Activities[].[StartTime,StatusCode,Cause]\'',
      decide:'The Cause field names the trigger. Read it literally.',
      why:'"Taken out of service in response to an ELB system health check failure" and "in response to a difference between desired and actual capacity" are different incidents with different owners. A `Failed` status here is the other high-value case: `VcpuLimitExceeded` or `InsufficientInstanceCapacity` means the launch never happened at all, which from every other angle looks like an application failure.',
      branches:[
        { when:'ELB health check failure', then:'The target group is judging them unhealthy', goto:'aws-alb-5xx' },
        { when:'EC2 health check failure', then:'The instance itself is failing its status checks.' },
        { when:'StatusCode Failed', then:'The launch failed — quota, capacity or a bad launch template.' },
        { when:'Difference between desired and actual', then:'A scaling policy is driving this, not health.' } ] },

    { check:'Which health check, and how long is the grace period?', cmd:'aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names NAME --query \'AutoScalingGroups[0].[HealthCheckType,HealthCheckGracePeriod,DesiredCapacity,MinSize,MaxSize]\'',
      decide:'The grace period must exceed the time from launch to first successful health check.',
      why:'This is the classic replacement loop: an application that needs ninety seconds to boot behind a sixty-second grace period is killed just before it becomes healthy, forever, and every replacement repeats it. `HealthCheckType: EC2` has the opposite failure — it only watches the EC2 status checks, so an instance whose application is dead but whose OS is fine stays in service indefinitely.',
      branches:[
        { when:'Grace shorter than boot time', then:'That is the loop. Raise it above measured boot time with margin.' },
        { when:'HealthCheckType EC2 with an ALB', then:'Switch to ELB, or the load balancer\'s opinion is ignored.' },
        { when:'Both look right', then:'The instances really are failing. Catch one before it is replaced.' } ] },

    { check:'Stop the churn so you can look at one', cmd:'aws autoscaling suspend-processes --auto-scaling-group-name NAME --scaling-processes ReplaceUnhealthy Terminate',
      decide:'Suspending buys you a live instance to inspect. Write down that you did it.',
      why:'Debugging an instance that gets terminated after two minutes is close to impossible, and each replacement destroys the evidence. Suspending `ReplaceUnhealthy` and `Terminate` freezes the fleet in place; the trade is that genuinely unhealthy instances now stay in service, so this is a deliberate, temporary, written-down action. A lifecycle hook is the durable version of the same idea.',
      branches:[
        { when:'Suspended', then:'Now get onto a failing instance while it still exists.' },
        { when:'Cannot suspend', then:'Use a lifecycle hook on terminate to hold instances in Terminating:Wait.' } ] },

    { check:'Why is the instance not becoming healthy?', cmd:'aws ssm start-session --target i-…   ·   aws ec2 get-console-output --instance-id i-… --latest --output text | tail -50   ·   sudo tail -50 /var/log/cloud-init-output.log',
      decide:'Either user data failed, or the app is not listening where the check looks.',
      why:'On a fresh instance the two candidates are the bootstrap and the bind address. User data runs once at first boot and its output goes to `/var/log/cloud-init-output.log`; a package repository that is unreachable from a private subnet is a very common failure there. The other is an application bound to `127.0.0.1`, which passes every local test and fails every health check from outside.',
      branches:[
        { when:'cloud-init failed', then:'Fix the bootstrap — often no egress to the package repository', goto:'aws-no-egress' },
        { when:'App bound to localhost', then:'Bind to 0.0.0.0; the health check comes from another host.' },
        { when:'Instance never finished booting', then:'Bad AMI or an oversized bootstrap. Bake more into the image.' } ] },

    { check:'Is the launch failing before any of that?', cmd:'aws autoscaling describe-scaling-activities --auto-scaling-group-name NAME --query \'Activities[?StatusCode!=`Successful`].[StatusCode,StatusMessage]\'   ·   aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A',
      decide:'A failed launch is quota, AZ capacity, subnet addresses, or a broken launch template.',
      why:'When nothing ever reaches Running, the loop is at a different layer. `VcpuLimitExceeded` is a quota — counted in vCPUs per family per region, not in instances. `InsufficientInstanceCapacity` is AWS being out of that type in that AZ, and the fix is more instance types and more subnets rather than retrying. An exhausted subnet, a deleted AMI or a KMS key the role cannot use all fail here too, and all say so in `StatusMessage`.',
      branches:[
        { when:'VcpuLimitExceeded', then:'Request a quota increase; nothing else will help.' },
        { when:'InsufficientInstanceCapacity', then:'Add instance types to the mixed-instances policy and spread across more AZs.' },
        { when:'No available IP addresses', then:'The subnet is exhausted — a bigger CIDR or more subnets.' },
        { when:'Launches succeed', then:'Then it is health, not capacity. Back up the tree.' } ] } ],
  probes:[
    ['EC2 versus ELB health check type.','EC2 only watches the instance status checks, so a dead application on a healthy OS stays in service. ELB delegates the judgement to the target group, which is almost always what you want — paired with a grace period longer than the boot.'],
    ['What is a lifecycle hook for?','It holds an instance in Pending:Wait or Terminating:Wait until you complete the action or the timeout expires. That is how you drain connections before termination, or finish a bootstrap before an instance is put into service — and how you keep a failing instance alive long enough to debug it.'],
    ['The AMI was updated but nothing changed. Why?','A launch template version is not automatically adopted — the group has to point at $Latest or a new version number — and even then it only affects new launches. Existing instances need an instance refresh.'],
    ['How do you make capacity failures less likely?','A mixed-instances policy with several types across several AZs, capacity-optimized allocation for spot, and headroom in the vCPU quota. Pinning a fleet to one instance type in one AZ is the fragile version.']
  ],
  trap:'Raising the desired capacity to ride out the churn. It multiplies the failing launches, burns quota, and hides the loop behind more instances doing the same thing.',
  remember:'Read the Cause field first. Grace period shorter than boot time is the classic loop, and a failed launch never reaches health checks at all.'
},

/* ═══ 8. who changed it ═══ */
{
  id:'aws-who-changed', track:'aws', title:'Something changed and nobody owns it', cat:'obs', level:'intermediate',
  cert:['aws-sec:logging-and-monitoring','aws-sysops:monitoring'],
  prompt:'"A resource is different from yesterday and nobody admits to changing it. How do you find out what happened?"',
  say:'"CloudTrail tells me who called what and when, and Config tells me what the resource looked like on either side of it — together they answer who changed it and what changed. I search CloudTrail by resource name first, then read the full event for the principal and source IP, then pull the Config history for the actual diff. If the caller is a role I follow it back to the human or the pipeline that assumed it, because the role name alone is not an answer."',
  steps:[
    { check:'What touched this resource?', cmd:'aws cloudtrail lookup-events --lookup-attributes AttributeKey=ResourceName,AttributeValue=RESOURCE --query \'Events[].[EventTime,EventName,Username]\'',
      decide:'Mutating event names — Create, Modify, Delete, Put, Attach — in the window you care about.',
      why:'Searching by resource is the fastest way in when you know what changed but not who. Note the two hard limits before you rely on it: `lookup-events` reaches back **ninety days** only, and it covers management events — the control plane — not data events. If the change is older or is a data-plane action such as `GetObject`, this call will return nothing and that absence is not evidence.',
      branches:[
        { when:'A mutating event with a username', then:'Read the full event for the principal and source.' },
        { when:'Nothing returned', then:'Older than ninety days, a data event, or a different region — check the trail in S3.' },
        { when:'Only Describe and List calls', then:'Nothing changed it through the API. Consider drift from IaC or an in-guest change.' } ] },

    { check:'Who really made the call?', cmd:'aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=EVENT --query \'Events[].CloudTrailEvent\' --output text | jq \'.userIdentity, .sourceIPAddress, .userAgent\'',
      decide:'`userIdentity` distinguishes a human, a role session, and a service acting on your behalf.',
      why:'The `Username` column flattens a lot of detail. The full record separates `IAMUser` from `AssumedRole` — and for an assumed role, `sessionContext.sessionIssuer` names the role while the session name often carries the human or the pipeline run. `invokedBy: cloudformation.amazonaws.com` or a Terraform user agent tells you this was automation, which redirects the whole investigation from a person to a repository.',
      branches:[
        { when:'AssumedRole with a person-shaped session name', then:'Ask them; the session name is usually the answer.' },
        { when:'invokedBy an AWS service', then:'Automation. Find the stack, pipeline or rule that drove it.' },
        { when:'Terraform or CDK user agent', then:'It came from IaC — the change is in a repository, so read the commit.' },
        { when:'Root user', then:'That is an incident in itself, regardless of what was changed.' } ] },

    { check:'What actually changed?', cmd:'aws configservice get-resource-config-history --resource-type TYPE --resource-id ID --limit 2 --query \'configurationItems[].configuration\' --output text | jq .',
      decide:'Two consecutive configuration items, diffed.',
      why:'CloudTrail says a call was made; Config says what the resource looked like before and after. That distinction matters when the API call took a large payload — a `ModifyDBInstance` or a `PutBucketPolicy` request tells you far less than the two states either side. If Config is not recording that resource type, this is the moment you discover it, and enabling it now at least helps the next incident.',
      branches:[
        { when:'Clear diff', then:'You have the change. Decide whether to revert or to make it official.' },
        { when:'Config not recording this type', then:'Fall back to the CloudTrail request parameters — less complete but usually enough.' },
        { when:'Change matches an IaC template', then:'Not drift: someone deployed. Find the pipeline run.' } ] },

    { check:'Is it drift from what code says it should be?', cmd:'terraform plan   ·   aws cloudformation detect-stack-drift --stack-name NAME',
      decide:'If code and reality disagree, decide which one is right before touching either.',
      why:'A console change on top of an IaC-managed resource is a landmine: everything works until the next apply silently reverts it, usually during an unrelated deploy. Detecting drift makes the choice explicit — either the change was legitimate and belongs in code, or it was not and should be reverted deliberately rather than by accident three weeks later.',
      branches:[
        { when:'Drift detected and the change was intended', then:'Put it in code and apply, so the next deploy does not undo it.' },
        { when:'Drift detected and the change was not intended', then:'Revert through code, not through the console.' },
        { when:'No drift', then:'The change came through the pipeline. The review conversation is upstream.' } ] },

    { check:'Make the next one cheaper to answer', cmd:'aws cloudtrail get-trail-status --name NAME   ·   aws configservice describe-configuration-recorders',
      decide:'Multi-region trail, log file validation, data events where they matter, and Config recording the types you care about.',
      why:'The reason this investigation was hard is a gap in coverage, and the end of the incident is when it is cheapest to close. An organisation trail into a locked S3 bucket with log file validation gives you a tamper-evident record; Config gives you the diffs; an EventBridge rule on the specific API call gives you an alert instead of an archaeology exercise. Data events cost real money, so scope them to the buckets and keys that would matter in a breach.',
      branches:[
        { when:'Single-region trail', then:'Changes in another region are invisible. Make it multi-region and organisation-wide.' },
        { when:'Config not recording', then:'Turn it on for the resource types tied to your controls.' },
        { when:'Coverage is fine', then:'Add an EventBridge rule so this change alerts next time instead of surprising you.' } ] } ],
  probes:[
    ['What are CloudTrail\'s limits?','lookup-events covers ninety days and management events only. Data events — GetObject, Decrypt, Invoke — are off by default and cost extra. Anything older or larger means querying the trail\'s S3 bucket, usually with Athena.'],
    ['CloudTrail or Config — which answers "what changed"?','CloudTrail answers who called what and when. Config answers what the resource looked like before and after. You generally need both, and Config is the one people have not enabled.'],
    ['You see an AssumedRole. How do you get to a person?','sessionContext.sessionIssuer names the role and the session name usually carries the human or the pipeline run — which is exactly why role-session-name should be a name or a ticket, not "session1". Then the trust policy tells you who is allowed to assume it at all.'],
    ['How do you stop console changes drifting from Terraform?','Deny the mutating actions to humans and route changes through the pipeline; run drift detection on a schedule and alert on it; and give people a read-only role by default with elevation that is time-bound and logged.']
  ],
  trap:'Reverting the change before capturing what it was. The evidence goes with it, and if the change was made by automation it comes straight back.',
  remember:'CloudTrail for who and when, Config for before and after, drift detection for whether code agrees. Ninety days, management events only.'
}

);
