/* AWS track — what each playbook step actually prints, with the line that
   decides the next move marked. Keyed by playbook id, indexed by step.
   This is the half that stops you leaving the app to check a format.        */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.pbOut = LX.pbOut || {};

LX.pbOut['aws-denied'] = [
  { out:'arn:aws:sts::111122223333:assumed-role/ci-deploy/i-0a1b2c3d4e5f\n\n' +
        '# and the one you were reading the policy for:\n' +
        '# arn:aws:iam::111122223333:role/platform-admin',
    mark:['assumed-role/ci-deploy','arn:aws:iam::111122223333:role/platform-admin'],
    note:'Two different identities. The call is being made as the instance role `ci-deploy`, and the policy under review belongs to `platform-admin`. An exported AWS_ACCESS_KEY_ID or an instance profile beats the profile you thought you were using, and this is the thirty seconds that catches it.' },

  { out:'An error occurred (AccessDenied) when calling the PutObject operation:\n' +
        'User: arn:aws:sts::111122223333:assumed-role/ci-deploy/i-0a1b2c3d4e5f is not\n' +
        'authorized to perform: s3:PutObject on resource: "arn:aws:s3:::prod-artifacts/app.zip"\n' +
        'with an explicit deny in a service control policy',
    mark:['with an explicit deny in a service control policy','s3:PutObject'],
    note:'The last line is the entire answer and almost nobody reads it. AWS names the layer: "explicit deny in a service control policy" is an SCP, "explicit deny in an identity-based policy" is a Deny on the role, "explicit deny in a resource-based policy" is the bucket or key, and "because no identity-based policy allows" means nothing matched at all.' },

  { out:'[\n' +
        '    [\n' +
        '        "implicitDeny",\n' +
        '        []\n' +
        '    ]\n' +
        ']\n\n' +
        '# with a matching statement it looks like this instead:\n' +
        '# [ [ "allowed", [ "PolicyInputList.1" ] ] ]',
    mark:['implicitDeny','allowed'],
    note:'`implicitDeny` with an empty MatchedStatements list means no statement applied — the grant is missing or scoped to a different resource ARN, not overridden. `explicitDeny` with a named statement means a Deny exists and the list tells you where. Always pass --resource-arns: simulating against `*` frequently returns allowed for a policy scoped elsewhere.' },

  { out:'-------------------------------------------\n' +
        '|        ListPoliciesForTarget            |\n' +
        '+-------------+---------------------------+\n' +
        '|  p-fullaws  |  FullAWSAccess            |\n' +
        '|  p-9a8b7c   |  DenyNonApprovedRegions   |\n' +
        '+-------------+---------------------------+\n\n' +
        '$ aws organizations describe-policy --policy-id p-9a8b7c --query Policy.Content --output text | jq .\n' +
        '{ "Statement": [ { "Effect": "Deny", "NotAction": "s3:*",\n' +
        '    "Resource": "*", "Condition": { "StringNotEquals": {\n' +
        '      "aws:RequestedRegion": [ "us-east-1", "us-west-2" ] } } } ] }',
    mark:['DenyNonApprovedRegions','aws:RequestedRegion','FullAWSAccess'],
    note:'An SCP is a filter, never a grant — `FullAWSAccess` attached alongside it grants nothing on its own. This one denies everything outside two regions, so a perfectly correct role fails the moment a deploy targets eu-west-1. From inside the member account there is no API that shows you this, which is exactly why it hides.' },

  { out:'[\n' +
        '    {\n' +
        '        "PermissionsBoundaryType": "Policy",\n' +
        '        "PermissionsBoundaryArn": "arn:aws:iam::111122223333:policy/DeveloperBoundary"\n' +
        '    },\n' +
        '    3600\n' +
        ']',
    mark:['PermissionsBoundaryArn','DeveloperBoundary','3600'],
    note:'A boundary is a ceiling, not a grant: the effective permission is the intersection of the attached policies and this document, so a role with AdministratorAccess and this boundary can do only what the boundary allows. Nothing in the attached-policies view hints that it exists. The 3600 is MaxSessionDuration — why a long job loses its credentials after an hour.' },

  { out:'[\n' +
        '    [\n' +
        '        "allowed",\n' +
        '        [ "PolicyInputList.1" ]\n' +
        '    ]\n' +
        ']\n\n' +
        '$ aws s3 cp app.zip s3://prod-artifacts/app.zip\n' +
        'upload: ./app.zip to s3://prod-artifacts/app.zip',
    mark:['allowed','upload:'],
    note:'Simulate then actually run it, in that order, so a remaining failure still tells you something. If the simulator says allowed and the real call fails, the decision came from the two layers it does not fully model — an SCP or a resource policy. Then check the grant you added is scoped: `Action: "*"` on `Resource: "*"` closes the ticket and opens the audit finding.' }
];

LX.pbOut['aws-unreachable'] = [
  { out:'{\n' +
        '    "InstanceStatuses": [\n' +
        '        {\n' +
        '            "InstanceId": "i-0a1b2c3d4e5f",\n' +
        '            "InstanceState": { "Name": "running" },\n' +
        '            "SystemStatus": { "Status": "ok" },\n' +
        '            "InstanceStatus": { "Status": "impaired",\n' +
        '                "Details": [ { "Name": "reachability", "Status": "failed" } ] }\n' +
        '        }\n' +
        '    ]\n' +
        '}',
    mark:['"SystemStatus": { "Status": "ok" }','"impaired"','"reachability", "Status": "failed"'],
    note:'System check ok, instance check impaired: the hardware and its network are fine and the operating system is not. A stop/start would move you to a new host and change nothing here. This is the split that decides whether you open a support case or open the console log.' },

  { out:'{\n' +
        '    "ip": null,\n' +
        '    "subnet": "subnet-0d4e5f6a",\n' +
        '    "sg": [ "sg-0a1b2c3d" ],\n' +
        '    "az": "us-east-1b"\n' +
        '}\n\n' +
        '$ aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=subnet-0d4e5f6a\n' +
        'DestinationCidrBlock   GatewayId     NatGatewayId    State\n' +
        '10.0.0.0/16            local         None            active\n' +
        '0.0.0.0/0              None          nat-07c9e1      active',
    mark:['"ip": null','nat-07c9e1','10.0.0.0/16'],
    note:'No public IP and the default route goes to a NAT gateway rather than an internet gateway — this is a private subnet, and it is unreachable from outside by design. Nothing here is broken; the access method is wrong. Use Session Manager instead of trying to make the subnet public.' },

  { out:'[\n' +
        '    {\n' +
        '        "FromPort": 443, "ToPort": 443, "IpProtocol": "tcp",\n' +
        '        "IpRanges": [ { "CidrIp": "10.0.0.0/16" } ]\n' +
        '    },\n' +
        '    {\n' +
        '        "FromPort": 22, "ToPort": 22, "IpProtocol": "tcp",\n' +
        '        "IpRanges": [ { "CidrIp": "203.0.113.14/32" } ]\n' +
        '    }\n' +
        ']',
    mark:['"FromPort": 22','203.0.113.14/32'],
    note:'SSH is allowed from exactly one address — last quarter\'s office IP. This is the everyday cause of "it worked yesterday": the rule is correct, scoped and stale. Note the shape of the good answer here: a /32 rather than 0.0.0.0/0, which is what you want to keep even while fixing it.' },

  { out:'RuleNumber  Egress  Protocol  CidrBlock     RuleAction  PortRange\n' +
        '100         False   6         0.0.0.0/0     allow       22 to 22\n' +
        '32767       False   -1        0.0.0.0/0     deny        \n' +
        '100         True    6         0.0.0.0/0     allow       443 to 443\n' +
        '32767       True    -1        0.0.0.0/0     deny        ',
    mark:['allow       22 to 22','allow       443 to 443','deny'],
    note:'Inbound 22 is allowed and outbound only permits 443 — so the SSH connection is accepted and every reply is dropped, because responses go to the client\'s ephemeral port, not to 22. The result is a timeout indistinguishable from a dead host. NACLs are stateless: outbound needs 1024–65535.' },

  { out:'# CloudWatch Logs Insights over /vpc/flow\n' +
        'srcAddr        dstAddr      dstPort  protocol  action\n' +
        '203.0.113.14   10.0.4.31    22       6         REJECT\n' +
        '203.0.113.14   10.0.4.31    22       6         REJECT\n\n' +
        '# and the Reachability Analyzer verdict on the same path:\n' +
        '[ false, [ "ENI_SG_RULES_MISMATCH" ] ]',
    mark:['REJECT','ENI_SG_RULES_MISMATCH','false'],
    note:'`REJECT` proves the packet arrived and a firewall dropped it, which sends you back up the tree with certainty rather than theory. No record at all would have meant the opposite — it never got here, so routing, DNS or the client. Reachability Analyzer answers the same question from configuration alone and names the component.' },

  { out:'Starting session with SessionId: alex-0a1b2c3d4e5f\n' +
        'sh-5.2$ \n\n' +
        '# or, when SSM is unavailable, the console log:\n' +
        '[  OK  ] Started Security Auditing Service.\n' +
        '[FAILED] Failed to mount /data.\n' +
        'You are in emergency mode. After logging in, type "journalctl -xb"\n' +
        'Give root password for maintenance (or press Control-D to continue):',
    mark:['Starting session with SessionId','[FAILED] Failed to mount /data','emergency mode'],
    note:'Two independent ways onto a box you cannot reach over the network. Session Manager needs no inbound rule at all. The console log is the fallback and it is decisive: an fstab entry for a volume that no longer exists drops the instance into emergency mode, where it passes its system check, fails its instance check, and answers nothing.' }
];

LX.pbOut['aws-no-egress'] = [
  { out:'DestinationCidrBlock   GatewayId   NatGatewayId    State\n' +
        '10.0.0.0/16            local       None            active\n' +
        '0.0.0.0/0              None        nat-07c9e1      blackhole',
    mark:['blackhole','nat-07c9e1'],
    note:'`blackhole` means the next hop no longer exists — the NAT gateway was deleted or recreated with a new id and the route was never updated. Every packet matching this route is discarded silently, so the instance reports a timeout and nothing anywhere reports an error. This is the single highest-value thing to grep route tables for.' },

  { out:'------------------------------------------------------------\n' +
        '|                   DescribeNatGateways                     |\n' +
        '+--------------+-------------------+-----------+------------+\n' +
        '|  nat-07c9e1  |  subnet-0d4e5f6a  |  available|  3.94.11.2 |\n' +
        '+--------------+-------------------+-----------+------------+\n\n' +
        '# and that subnet\'s route table:\n' +
        'DestinationCidrBlock   GatewayId\n' +
        '10.0.0.0/16            local',
    mark:['subnet-0d4e5f6a','available','3.94.11.2'],
    note:'The gateway is healthy and has a public address — and it sits in a subnet whose route table has no internet gateway route, so it is a NAT gateway in a private subnet. It will accept packets and have nowhere to send them. This configuration looks perfect in a diagram and moves no traffic at all.' },

  { out:'[\n' +
        '    {\n' +
        '        "DestinationCidrBlock": "0.0.0.0/0",\n' +
        '        "GatewayId": "igw-0b2c3d4e",\n' +
        '        "State": "active"\n' +
        '    }\n' +
        ']',
    mark:['igw-0b2c3d4e'],
    note:'This is what the NAT gateway\'s own subnet has to look like: a default route to an internet gateway. Two route tables are involved in every private-subnet egress path — the private subnet points at the NAT gateway, and the NAT gateway\'s public subnet points at the internet gateway — and the second is the one people skip because they have already "checked the route table".' },

  { out:'RuleNumber  Egress  Protocol  CidrBlock    RuleAction  PortRange\n' +
        '100         True    6         0.0.0.0/0    allow       443 to 443\n' +
        '32767       True    -1        0.0.0.0/0    deny        \n\n' +
        '# inbound side:\n' +
        '100         False   6         10.0.0.0/16  allow       443 to 443\n' +
        '32767       False   -1        0.0.0.0/0    deny        ',
    mark:['allow       443 to 443','deny'],
    note:'Outbound 443 is allowed and the inbound side only permits 443 from inside the VPC — so the request leaves and the response, which arrives on an ephemeral port from an internet address, hits the default deny. A package download hangs partway through and looks nothing like a firewall problem. The missing rule is inbound 1024–65535.' },

  { out:'-----------------------------------------------------------------------\n' +
        '|                        DescribeVpcEndpoints                          |\n' +
        '+------------------------------------+-----------+---------+----------+\n' +
        '|  com.amazonaws.us-east-1.s3        |  Gateway  |  available|  None  |\n' +
        '|  com.amazonaws.us-east-1.ssm       |  Interface|  available|  False |\n' +
        '+------------------------------------+-----------+---------+----------+',
    mark:['Gateway','Interface','False'],
    note:'The SSM interface endpoint exists with `PrivateDnsEnabled: False`, so every caller still resolves the public endpoint, still goes out through NAT, and still pays for it — the endpoint is running and doing nothing. For a genuinely private subnet you need ssm, ssmmessages and ec2messages, all with private DNS on. The S3 gateway endpoint is free and is usually the largest NAT saving available.' }
];

LX.pbOut['aws-alb-5xx'] = [
  { out:'-------------------------------------------------------------------------\n' +
        '|                        DescribeTargetHealth                            |\n' +
        '+----------------+-----------+-------------------------+----------------+\n' +
        '|  i-0a1b2c3d    |  unhealthy|  Target.Timeout         |  Request timed |\n' +
        '|                |           |                         |  out           |\n' +
        '|  i-0c4d5e6f    |  unhealthy|  Target.FailedHealthChecks|  Health checks|\n' +
        '|                |           |                         |  failed with   |\n' +
        '|                |           |                         |  code 302      |\n' +
        '+----------------+-----------+-------------------------+----------------+',
    mark:['Target.Timeout','Target.FailedHealthChecks','code 302'],
    note:'Two unhealthy targets for two completely different reasons. `Target.Timeout` means nothing answered — a security group or a process not listening. `Target.FailedHealthChecks` with code 302 means the check reached the app and got a redirect where it wanted a 200. Reading State alone would have told you neither.' },

  { out:'{\n' +
        '    "path": "/",\n' +
        '    "port": "traffic-port",\n' +
        '    "proto": "HTTP",\n' +
        '    "codes": "200",\n' +
        '    "interval": 30,\n' +
        '    "healthy": 5\n' +
        '}',
    mark:['"path": "/"','"codes": "200"','"healthy": 5'],
    note:'The check requests `/` and demands a 200, while the application redirects `/` to `/login` — a 302, which fails. Either point the check at a real health endpoint or widen the matcher to `200-399`. Note the healthy threshold of 5 at a 30-second interval too: recovery takes two and a half minutes, which feels like the fix did not work.' },

  { out:'[\n' +
        '    {\n' +
        '        "FromPort": 80, "ToPort": 80, "IpProtocol": "tcp",\n' +
        '        "UserIdGroupPairs": [ { "GroupId": "sg-0alb1234" } ]\n' +
        '    }\n' +
        ']',
    mark:['"FromPort": 80','sg-0alb1234'],
    note:'The load balancer group is allowed on port 80 and the health check runs against 8080, so the check times out while real traffic works. Referencing the load balancer\'s security group rather than a CIDR is the right pattern — it follows the ALB nodes as they scale into new subnets, which a hard-coded CIDR does not.' },

  { out:'State    Recv-Q  Send-Q  Local Address:Port   Peer Address:Port  Process\n' +
        'LISTEN   0       128     127.0.0.1:8080       0.0.0.0:*          users:(("app",pid=1442,fd=6))\n\n' +
        '$ curl -sS -o /dev/null -w \'%{http_code}\\n\' http://10.0.4.31:8080/healthz\n' +
        'curl: (7) Failed to connect to 10.0.4.31 port 8080: Connection refused',
    mark:['127.0.0.1:8080','Connection refused'],
    note:'Bound to loopback. The process is up, `curl localhost:8080` works perfectly for the developer, and nothing outside the instance can reach it — including the health check. Testing against the instance\'s own private address rather than localhost is what exposes it in one command.' },

  { out:'# ALB access log, one line, split for reading:\n' +
        'https 2026-08-27T11:20:41 app/prod-alb 10.0.1.7:52344 10.0.4.31:8080\n' +
        '0.001 60.000 -1  502 - 512 0 "GET https://api.example.com/report HTTP/2.0"\n\n' +
        '# fields: request_processing_time target_processing_time response_processing_time\n' +
        '#         elb_status_code target_status_code',
    mark:['60.000','502'],
    note:'`target_processing_time` sitting exactly on 60.000 with an elb_status_code of 502 and no target status code is the idle-timeout signature: the target closed the connection before the load balancer did. The fix is on the application — set its keep-alive above the ALB idle timeout — not on the load balancer.' }
];

LX.pbOut['aws-s3-403'] = [
  { out:'arn:aws:iam::111122223333:role/report-reader\n\n' +
        '$ aws iam simulate-principal-policy … --action-names s3:GetObject \\\n' +
        '    --resource-arns \'arn:aws:s3:::prod-data/reports/q3.csv\'\n' +
        '[ [ "implicitDeny", [] ] ]\n\n' +
        '# the attached policy:\n' +
        '"Action": [ "s3:ListBucket", "s3:GetObject" ],\n' +
        '"Resource": "arn:aws:s3:::prod-data"',
    mark:['implicitDeny','"Resource": "arn:aws:s3:::prod-data"'],
    note:'The resource names the bucket and not its contents. `s3:ListBucket` acts on the bucket ARN, `s3:GetObject` acts on `arn:aws:s3:::prod-data/*` — a different resource. That single missing `/*` produces exactly this symptom: listing works, reading is denied.' },

  { out:'{\n' +
        '  "Statement": [\n' +
        '    { "Sid": "DenyUnencryptedTransport",\n' +
        '      "Effect": "Deny", "Principal": "*", "Action": "s3:*",\n' +
        '      "Resource": [ "arn:aws:s3:::prod-data", "arn:aws:s3:::prod-data/*" ],\n' +
        '      "Condition": { "Bool": { "aws:SecureTransport": "false" } } },\n' +
        '    { "Sid": "DenyOutsideVpce",\n' +
        '      "Effect": "Deny", "Principal": "*", "Action": "s3:GetObject",\n' +
        '      "Resource": "arn:aws:s3:::prod-data/*",\n' +
        '      "Condition": { "StringNotEquals": { "aws:SourceVpce": "vpce-0a1b2c3d" } } }\n' +
        '  ]\n' +
        '}',
    mark:['DenyOutsideVpce','aws:SourceVpce','aws:SecureTransport'],
    note:'Two conditional denies, and the second is the one that bites: any request not arriving through that specific VPC endpoint is denied no matter how correct the identity policy is. Read Deny statements first — one explicit deny beats every allow anywhere in the evaluation.' },

  { out:'{\n' +
        '    "PublicAccessBlockConfiguration": {\n' +
        '        "BlockPublicAcls": true, "IgnorePublicAcls": true,\n' +
        '        "BlockPublicPolicy": true, "RestrictPublicBuckets": true\n' +
        '    }\n' +
        '}\n\n' +
        '$ aws s3api get-bucket-ownership-controls --bucket prod-data\n' +
        '{ "OwnershipControls": { "Rules": [ { "ObjectOwnership": "BucketOwnerEnforced" } ] } }',
    mark:['RestrictPublicBuckets','BucketOwnerEnforced'],
    note:'All four blocks are on, which is what you want — and it means a policy granting public access is neutralised rather than removed, so the policy reads as though it should work. `BucketOwnerEnforced` disables ACLs entirely, which breaks any cross-account grant that relied on one and is otherwise the setting to prefer.' },

  { out:'[\n' +
        '    "aws:kms",\n' +
        '    "arn:aws:kms:us-east-1:111122223333:key/8f3b2a1c-…"\n' +
        ']\n\n' +
        '$ aws kms get-key-policy --key-id 8f3b2a1c-… --policy-name default | jq \'.Statement[].Principal\'\n' +
        '{ "AWS": "arn:aws:iam::111122223333:root" }\n' +
        '{ "AWS": "arn:aws:iam::111122223333:role/etl-writer" }',
    mark:['"aws:kms"','role/etl-writer'],
    note:'The object is encrypted with a customer-managed key and the key policy names `etl-writer` — not `report-reader`. S3 reports this as AccessDenied with no mention of KMS whatsoever, which is why an S3 403 with no obvious cause is so often a key policy. KMS key policies are mandatory, not optional: an identity policy alone never grants use of a key.' },

  { out:'-------------------------------------------------------------\n' +
        '|                    DescribeVpcEndpoints                    |\n' +
        '+-------------------+---------------------------------------+\n' +
        '|  vpce-0a1b2c3d    |  {"Statement":[{"Effect":"Allow",      |\n' +
        '|                   |   "Resource":["arn:aws:s3:::build-*"]}]} |\n' +
        '+-------------------+---------------------------------------+',
    mark:['vpce-0a1b2c3d','arn:aws:s3:::build-*'],
    note:'The endpoint policy allows only buckets whose name starts with `build-`, so `prod-data` is denied on the way out of the VPC — a deliberate boundary that stops data leaving to an unapproved account, and completely invisible from the caller\'s side. This is a good control producing a confusing 403.' }
];

LX.pbOut['aws-rds-conn'] = [
  { out:'available\tprod-db-restore.cluster-abc123.us-east-1.rds.amazonaws.com\t5432\tTrue\tFalse\n\n' +
        '# and what the application has in its configuration:\n' +
        '# DB_HOST=prod-db.cluster-abc123.us-east-1.rds.amazonaws.com',
    mark:['prod-db-restore.cluster-abc123','DB_HOST=prod-db.cluster-abc123'],
    note:'The instance answering is `prod-db-restore` and the application is configured for `prod-db` — a restore came back under a new name and the configuration was never updated. `PubliclyAccessible: False` is correct and healthy here; it is not the fault.' },

  { out:'[ "sg-0db12345" ]\n\n' +
        '$ aws ec2 describe-security-groups --group-ids sg-0db12345 \\\n' +
        '    --query \'SecurityGroups[0].IpPermissions\'\n' +
        '[ { "FromPort": 5432, "ToPort": 5432, "IpProtocol": "tcp",\n' +
        '    "UserIdGroupPairs": [ { "GroupId": "sg-0app9876" } ] } ]',
    mark:['sg-0db12345','sg-0app9876','"FromPort": 5432'],
    note:'The database allows 5432 from the application\'s security group by reference rather than by CIDR, which is the pattern that survives every re-IP and subnet change. If the application instances are not in `sg-0app9876` — a new node group, a Lambda, a different account — this correct-looking rule allows nothing.' },

  { out:'$ nc -zv prod-db.cluster-abc123.us-east-1.rds.amazonaws.com 5432\n' +
        'nc: connect to prod-db… port 5432 (tcp) failed: Connection timed out\n\n' +
        '$ dig +short prod-db.cluster-abc123.us-east-1.rds.amazonaws.com\n' +
        '10.0.6.212',
    mark:['Connection timed out','10.0.6.212'],
    note:'DNS resolves to a private address, so the name is right and the VPC DNS is working — and the connection times out, which means packets are being dropped rather than refused. Timeout is network: security group or routing. `Connection refused` would have meant you arrived and nothing was listening, which is a different investigation entirely.' },

  { out:'-------------------------------------------------------------------------\n' +
        '|  2026-08-27T11:18:02Z |  Multi-AZ instance failover started            |\n' +
        '|  2026-08-27T11:19:14Z |  Multi-AZ instance failover completed          |\n' +
        '|  2026-08-27T03:07:41Z |  Backup completed                             |\n' +
        '-------------------------------------------------------------------------',
    mark:['failover started','failover completed'],
    note:'A failover, seventy-two seconds end to end, right when the errors began. The database is healthy; the connection pool held sockets to an endpoint that had moved. The fix is client-side — shorter connection lifetimes, aggressive socket timeouts, and retries on idempotent operations — not anything on RDS.' },

  { out:'Timestamp                 Maximum\n' +
        '2026-08-27T11:15:00Z      412.0\n' +
        '2026-08-27T11:20:00Z      412.0\n\n' +
        '$ aws rds describe-db-parameters --db-parameter-group-name prod-pg16 \\\n' +
        '    --query \'Parameters[?ParameterName==`max_connections`].[ParameterValue]\'\n' +
        '[ [ "LEAST({DBInstanceClassMemory/9531392},5000)" ] ]',
    mark:['412.0','LEAST({DBInstanceClassMemory/9531392},5000)'],
    note:'Connections pinned flat at 412 is a ceiling, not a workload — real traffic varies. `max_connections` is a formula over instance memory, so scaling the instance **down** lowers it without anything in the application changing. The answer is usually a smaller pool or RDS Proxy rather than a bigger database.' }
];

LX.pbOut['aws-asg-churn'] = [
  { out:'2026-08-27T11:31:02Z  Successful  At 2026-08-27T11:31:02Z an instance was taken\n' +
        '                                  out of service in response to an ELB system\n' +
        '                                  health check failure.\n' +
        '2026-08-27T11:29:44Z  Successful  At 2026-08-27T11:29:44Z an instance was started\n' +
        '                                  in response to a difference between desired and\n' +
        '                                  actual capacity, increasing the capacity from\n' +
        '                                  3 to 4.',
    mark:['ELB system\n                                  health check failure','difference between desired and\n                                  actual capacity'],
    note:'Ninety seconds between a launch and its termination, and the Cause field names the trigger in plain English. "ELB system health check failure" points at the target group, not at the instance — so this is a health-check investigation, and the ninety-second lifetime is itself the clue about the grace period.' },

  { out:'[\n' +
        '    "ELB",\n' +
        '    60,\n' +
        '    4,\n' +
        '    2,\n' +
        '    8\n' +
        ']',
    mark:['"ELB"','60,'],
    note:'A sixty-second grace period against an application that takes ninety seconds to serve its first request: every instance is killed just before it becomes healthy, forever. This is the classic replacement loop and the fix is to raise the grace period above measured boot time with margin — not to change the health check.' },

  { out:'{\n' +
        '    "ScalingProcesses": []\n' +
        '}\n\n' +
        '$ aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names app-prod \\\n' +
        '    --query \'AutoScalingGroups[0].SuspendedProcesses\'\n' +
        '[ { "ProcessName": "ReplaceUnhealthy" }, { "ProcessName": "Terminate" } ]',
    mark:['ReplaceUnhealthy','Terminate'],
    note:'Both processes suspended, so the fleet is frozen and you finally have a live instance to inspect. The trade is real: genuinely unhealthy instances now stay in service, so this is temporary and it belongs in the incident channel. `resume-processes` is the command you must not forget.' },

  { out:'Cloud-init v. 23.4 running \'modules:final\'\n' +
        'Err:1 https://repo.internal.example.com/al2023 InRelease\n' +
        '  Could not connect to repo.internal.example.com:443 (10.0.9.14),\n' +
        '  connection timed out\n' +
        'E: Unable to fetch some archives\n' +
        '2026-08-27 11:30:12,441 - cc_scripts_user.py[WARNING]: Failed to run module scripts-user\n' +
        'cloud-init failed with exit code 1',
    mark:['connection timed out','cloud-init failed with exit code 1'],
    note:'The bootstrap never finished, so the application was never installed and the health check was never going to pass. The failure is egress from a private subnet, not scaling — which is why the ASG tree hands off here. Baking packages into the AMI rather than installing at boot removes this failure mode entirely.' },

  { out:'Failed\tLaunching a new EC2 instance. Status Reason: Your request for accessing\n' +
        '       resources in this region is being validated, and you will not be able to\n' +
        '       launch additional resources in this region until the validation is\n' +
        '       complete. Launching EC2 instance failed.\n\n' +
        '# the more common one:\n' +
        'Failed\tYou have requested more vCPU capacity than your current vCPU limit of 64\n' +
        '       allows for the instance bucket that the specified instance type belongs to.\n' +
        '       (VcpuLimitExceeded)',
    mark:['VcpuLimitExceeded','vCPU limit of 64'],
    note:'Nothing ever reached Running, so no health check was involved at all. EC2 limits are counted in vCPUs per family group per region, not in instances — sixteen large instances and one enormous one hit the same wall. A quota increase is the only fix, and an alarm on quota utilisation is much cheaper than discovering this during a scale-out.' }
];

LX.pbOut['aws-who-changed'] = [
  { out:'----------------------------------------------------------------------\n' +
        '|  2026-08-26T21:14:07Z |  AuthorizeSecurityGroupIngress |  ci-deploy |\n' +
        '|  2026-08-26T21:14:06Z |  DescribeSecurityGroups        |  ci-deploy |\n' +
        '|  2026-08-19T09:02:55Z |  RevokeSecurityGroupIngress    |  alex      |\n' +
        '----------------------------------------------------------------------',
    mark:['AuthorizeSecurityGroupIngress','ci-deploy'],
    note:'A mutating call at 21:14 the night before, by a role rather than a person. Note what is not here: `lookup-events` covers ninety days and management events only, so an older change or a data-plane action such as GetObject returns nothing — and that silence is not evidence of nothing happening.' },

  { out:'{\n' +
        '  "type": "AssumedRole",\n' +
        '  "arn": "arn:aws:sts::111122223333:assumed-role/ci-deploy/GitHubActions-4821",\n' +
        '  "sessionContext": { "sessionIssuer": { "userName": "ci-deploy" },\n' +
        '    "webIdFederationData": { "federatedProvider": "token.actions.githubusercontent.com" } }\n' +
        '}\n' +
        '"192.0.2.44"\n' +
        '"aws-cli/2.17.9 Python/3.11 exec-env/GitHubActions"',
    mark:['GitHubActions-4821','token.actions.githubusercontent.com','exec-env/GitHubActions'],
    note:'The session name carries the pipeline run — which is exactly why `--role-session-name` should be a name or a ticket rather than "session1". This was automation via GitHub OIDC, so the investigation moves from a person to run 4821 and the commit behind it.' },

  { out:'--- previous\n' +
        '+++ current\n' +
        '   "ipPermissions": [\n' +
        '     { "fromPort": 443, "toPort": 443, "ipRanges": [ "10.0.0.0/16" ] },\n' +
        '+    { "fromPort": 22,  "toPort": 22,  "ipRanges": [ "0.0.0.0/0" ] }\n' +
        '   ]',
    mark:['"fromPort": 22','0.0.0.0/0'],
    note:'CloudTrail said a call was made; Config shows what the resource looked like on either side of it. Here that is the whole finding — SSH opened to the world — and it is the difference between "somebody modified a security group" and a specific, actionable diff.' },

  { out:'Terraform will perform the following actions:\n\n' +
        '  # aws_security_group.app will be updated in-place\n' +
        '  ~ resource "aws_security_group" "app" {\n' +
        '      - ingress {\n' +
        '          - from_port = 22\n' +
        '          - cidr_blocks = [ "0.0.0.0/0" ]\n' +
        '        }\n' +
        '    }\n\n' +
        'Plan: 0 to add, 1 to change, 0 to destroy.',
    mark:['will be updated in-place','Plan: 0 to add, 1 to change, 0 to destroy'],
    note:'Code and reality disagree, and the next apply would silently revert the change — probably during an unrelated deploy, which is the worst time to discover it. Detecting drift makes the choice explicit: either the change was legitimate and belongs in the repository, or it was not and should be reverted deliberately.' },

  { out:'{\n' +
        '    "IsLogging": true,\n' +
        '    "LatestDeliveryTime": "2026-08-27T11:42:03Z"\n' +
        '}\n\n' +
        '$ aws cloudtrail describe-trails --query \'trailList[].[Name,IsMultiRegionTrail,LogFileValidationEnabled]\'\n' +
        '[ [ "org-trail", true, false ] ]',
    mark:['"IsLogging": true','"org-trail", true, false'],
    note:'Logging and multi-region, but log file validation is off — so the record is complete and not tamper-evident, which matters the moment an incident involves a credential rather than a mistake. The end of an investigation is the cheapest time to close the gap that made it hard: validation on, Config recording the types tied to your controls, and an EventBridge rule so the next one alerts instead of needing archaeology.' }
];
