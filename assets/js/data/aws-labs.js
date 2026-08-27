/* AWS track labs. Same shape as data/labs.js. Both walk a layered failure,
   because that is what AWS incidents are: the symptom appears at one layer
   and the cause lives at another.                                           */
window.LX = window.LX || {};
LX.labs = LX.labs || [];

LX.labs.push(

/* ───────────────────────────────────── 1. AccessDenied ── */
{
  id:'aws-l-denied', title:'The deploy pipeline started failing with AccessDenied', cat:'iam',
  track:'aws', level:'advanced', mins:10,
  brief:'09:40. The deploy pipeline has failed three times this morning with AccessDenied on an S3 upload. Nobody changed the role — the last commit to the IAM repository was two weeks ago. The same pipeline succeeded at 18:12 last night. You have read access to the account and to Organizations.',
  user:'you', host:'aws-cli',
  steps:[
    { kind:'cmd',
      ask:'Before reading any policy, what do you establish?',
      hint:'Half of these turn out to be a different identity than the one whose policy everyone is reading.',
      opts:[
        { c:'aws sts get-caller-identity --query Arn --output text', ok:true,
          out:'arn:aws:sts::111122223333:assumed-role/ci-deploy/GitHubActions-4930',
          fb:'The pipeline runs as the ci-deploy role via GitHub OIDC. That is the policy to read, and the session name gives you the pipeline run if you need to correlate later.',
          parts:[['sts get-caller-identity','The identity the credentials actually resolve to — not the one you assume'],['assumed-role/ci-deploy','The role is what carries the permissions; the part after it is just the session name']] },
        { c:'aws iam get-user',
          out:'An error occurred (ValidationError) when calling the GetUser operation: Must specify userName when calling with non-User credentials.',
          fb:'The error is itself informative — these are role credentials, not user credentials — but it is a slower way to learn what get-caller-identity says outright.' },
        { c:'aws iam list-attached-role-policies --role-name ci-deploy',
          out:'AttachedPolicies:\n  - PolicyName: ci-deploy-s3\n    PolicyArn: arn:aws:iam::111122223333:policy/ci-deploy-s3',
          fb:'You will want this shortly, but you have skipped a step: you are assuming the pipeline runs as ci-deploy rather than confirming it. That assumption is wrong often enough to be worth thirty seconds.' },
        { c:'aws iam attach-role-policy --role-name ci-deploy --policy-arn arn:aws:iam::aws:policy/AdministratorAccess',
          out:'(no output)',
          fb:'You have granted the pipeline full control of the account without knowing what failed. If the denial came from an SCP or a boundary this changes nothing at all — and now there is a standing audit finding on top of the outage.' }
      ] },

    { kind:'cmd',
      ask:'Get the whole error, not the summary the pipeline printed. What are you looking for?',
      hint:'AWS names the layer that denied it, in the last line.',
      opts:[
        { c:'# re-run the failing command and keep the full message', ok:true,
          out:'An error occurred (AccessDenied) when calling the PutObject operation:\nUser: arn:aws:sts::111122223333:assumed-role/ci-deploy/GitHubActions-4930 is not\nauthorized to perform: s3:PutObject on resource: "arn:aws:s3:::prod-artifacts/app.zip"\nwith an explicit deny in a service control policy',
          fb:'The last line is the whole investigation. "Explicit deny in a service control policy" means this decision was made above the account, and nothing you do to the role can override it.',
          parts:[['explicit deny in a service control policy','An SCP — invisible from inside the account and unoverridable by any account administrator'],['s3:PutObject','The exact action, which you need for the simulator and for the SCP condition']] },
        { c:'aws s3 cp app.zip s3://prod-artifacts/app.zip --debug 2>&1 | tail -20',
          out:'…\nMainThread - botocore.hooks - DEBUG - Event needs-retry.s3.PutObject\nAn error occurred (AccessDenied) when calling the PutObject operation: …',
          fb:'It gets you there, and --debug is genuinely useful for signing and endpoint problems. For a permissions question it buries the one line that matters under several hundred you do not need.' },
        { c:'aws iam get-policy-version --policy-arn arn:aws:iam::111122223333:policy/ci-deploy-s3 --version-id v3',
          out:'{ "Statement": [ { "Effect": "Allow", "Action": ["s3:PutObject","s3:GetObject"],\n    "Resource": "arn:aws:s3:::prod-artifacts/*" } ] }',
          fb:'The policy is correct, which is exactly why this is confusing. Reading it first tells you what is *not* wrong and leaves you no closer — the error text would have named the layer in one line.' },
        { c:'aws s3 ls s3://prod-artifacts/',
          out:'2026-08-26 18:12:41   14238911 app.zip',
          fb:'Listing works and the last successful upload is right there at 18:12 — useful corroboration of the timeline. But listing and writing are different actions, so this does not narrow the denial.' }
      ] },

    { kind:'think',
      ask:'The message says a service control policy. What does that immediately rule in and out?',
      hint:'Think about where SCPs are attached and who can see them.',
      opts:[
        { t:'It is set above the account, cannot be overridden from inside it, and is invisible to any API call made within the member account', ok:true,
          fb:'Exactly right, and it reframes the whole task: no change to the role, its policies or its boundary will help, and you need Organizations access to even see the policy. This is why an account administrator can be denied and find nothing wrong.' },
        { t:'The role is missing a permission and needs a broader policy',
          fb:'That would be an *implicit* deny — "because no identity-based policy allows". An explicit deny in an SCP is a different layer, and adding permissions under it changes nothing.' },
        { t:'The bucket policy has a Deny statement',
          fb:'That would say "explicit deny in a resource-based policy". AWS distinguishes the two in the message precisely so you do not have to guess.' },
        { t:'The permissions boundary is too narrow',
          fb:'A boundary produces an implicit deny with no statement to point at, not an explicit deny naming a service control policy. Worth checking later; it is not what this message says.' }
      ] },

    { kind:'cmd',
      ask:'Find the SCP. What do you run, and where?',
      hint:'Attached policies are not the whole story — inheritance matters.',
      opts:[
        { c:'aws organizations list-policies-for-target --target-id 111122223333 --filter SERVICE_CONTROL_POLICY && aws organizations list-parents --child-id 111122223333', ok:true,
          out:'p-fullaws    FullAWSAccess\np-9a8b7c     DenyNonApprovedRegions\n\nParents:\n  ou-root-prod   ORGANIZATIONAL_UNIT',
          fb:'Two directly attached, and an OU above whose policies also apply. SCPs are inherited cumulatively down the tree, so the OU has to be checked as well as the account.',
          parts:[['list-policies-for-target','SCPs attached directly to this account'],['list-parents','The OU above it — its SCPs apply too, and this is the step people skip'],['--filter SERVICE_CONTROL_POLICY','Tag and backup policies share this API and are not what you want here']] },
        { c:'aws organizations describe-organization',
          out:'{ "Id": "o-a1b2c3d4", "MasterAccountId": "999988887777", "FeatureSet": "ALL" }',
          fb:'Confirms SCPs are even possible — FeatureSet ALL rather than CONSOLIDATED_BILLING — which is a reasonable sanity check. It does not tell you which policies apply.' },
        { c:'aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::111122223333:role/ci-deploy --action-names s3:PutObject --resource-arns arn:aws:s3:::prod-artifacts/app.zip',
          out:'[ [ "allowed", [ "PolicyInputList.1" ] ] ]',
          fb:'A genuinely useful result and a trap if you stop here. The simulator says allowed because it does not fully evaluate SCPs — which, given the error text, is confirmation rather than contradiction. Read it as "the identity layer is fine".' },
        { c:'aws organizations list-policies --filter SERVICE_CONTROL_POLICY',
          out:'p-fullaws     FullAWSAccess\np-9a8b7c      DenyNonApprovedRegions\np-4d5e6f      DenyRootUser\np-7g8h9i      ProtectSecurityServices',
          fb:'Every SCP in the organisation, including the ones attached elsewhere. You would still have to work out which apply here, which is what list-policies-for-target answers directly.' }
      ] },

    { kind:'cmd',
      ask:'Read the policy that is denying you.',
      hint:'The condition is where the surprise lives.',
      opts:[
        { c:'aws organizations describe-policy --policy-id p-9a8b7c --query Policy.Content --output text | jq .', ok:true,
          out:'{\n  "Statement": [\n    { "Effect": "Deny",\n      "NotAction": [ "iam:*", "organizations:*", "support:*" ],\n      "Resource": "*",\n      "Condition": { "StringNotEquals": {\n        "aws:RequestedRegion": [ "us-east-1", "us-west-2" ] } } }\n  ]\n}',
          fb:'Everything outside us-east-1 and us-west-2 is denied. So the question is no longer "what changed in IAM" but "why is this call going to a third region" — which is a completely different investigation and a much more tractable one.',
          parts:[['NotAction','Deny everything *except* these — a common SCP shape, and easy to misread as an allow'],['aws:RequestedRegion','The condition key that makes this a region guardrail rather than a service one'],['jq .','The content comes back as an escaped JSON string; this makes it readable']] },
        { c:'aws organizations describe-policy --policy-id p-fullaws --query Policy.Content --output text',
          out:'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]}',
          fb:'FullAWSAccess, which grants nothing — SCPs are filters, never grants. It has to be attached or nothing would be permitted at all, but it is never the cause of a denial.' },
        { c:'aws organizations list-targets-for-policy --policy-id p-9a8b7c',
          out:'ou-root-prod   ORGANIZATIONAL_UNIT\n111122223333   ACCOUNT',
          fb:'Useful for blast radius — this policy applies to the whole prod OU, so any fix affects more than one account. But you still need the document to know what it denies.' },
        { c:'aws organizations detach-policy --policy-id p-9a8b7c --target-id 111122223333',
          out:'(no output)',
          fb:'You just removed a region guardrail across a production account to unblock one pipeline, without knowing why the pipeline is calling an unapproved region. That guardrail is almost certainly load-bearing for a compliance commitment.' }
      ] },

    { kind:'cmd',
      ask:'Why would a pipeline that worked last night suddenly call a different region?',
      hint:'The bucket has not moved. Something about how it is being addressed has.',
      opts:[
        { c:'aws s3api get-bucket-location --bucket prod-artifacts && env | grep -i AWS_ | sort', ok:true,
          out:'{ "LocationConstraint": "us-east-1" }\n\nAWS_DEFAULT_REGION=eu-west-1\nAWS_REGION=eu-west-1\nAWS_ROLE_ARN=arn:aws:iam::111122223333:role/ci-deploy',
          fb:'There it is. The bucket is in us-east-1 and the runner is now configured for eu-west-1, so the request is signed for and sent to a region the SCP denies. Nothing about IAM changed — the runner environment did.',
          parts:[['get-bucket-location','Where the bucket actually is; LocationConstraint null means us-east-1'],['env | grep AWS_','The region the CLI will use, which comes from the environment before anything else']] },
        { c:'aws configure list',
          out:'      Name                    Value             Type    Location\n   profile                <not set>             None    None\n    region                eu-west-1              env    AWS_REGION',
          fb:'This is a good answer and arguably the cleaner one — it shows the region and, in the Location column, that it came from an environment variable. It just does not confirm where the bucket is, which is the other half of the mismatch.' },
        { c:'aws s3 cp app.zip s3://prod-artifacts/app.zip --region us-east-1',
          out:'upload: ./app.zip to s3://prod-artifacts/app.zip',
          fb:'It works, and it is a legitimate emergency unblock. But you have proved the region theory by accident rather than establishing it, and pinning a flag in one command leaves the runner misconfigured for everything else.' },
        { c:'aws sts get-caller-identity',
          out:'arn:aws:sts::111122223333:assumed-role/ci-deploy/GitHubActions-4930',
          fb:'The same identity as before, which you already knew. The identity was never the problem — the error told you the layer in its last line.' }
      ] },

    { kind:'think',
      ask:'The runner region changed. What is the right fix, and what is the wrong one?',
      hint:'Ask which of the two things — the guardrail or the configuration — is doing its job.',
      opts:[
        { t:'Fix the runner configuration back to the bucket\'s region; the SCP worked exactly as designed', ok:true,
          fb:'Correct, and worth saying out loud in the incident review: the guardrail caught a misconfiguration before anything was written to an unapproved region. The defect is in the pipeline environment — probably a shared runner image or a workflow default that changed — and that is what to fix and pin.' },
        { t:'Add eu-west-1 to the approved region list so this cannot recur',
          fb:'That widens a compliance boundary to accommodate a bug. If eu-west-1 genuinely needs approval that is a deliberate decision with a data-residency conversation attached — not something to do at 09:40 to unblock a deploy.' },
        { t:'Detach the SCP from this account, since it only affects a pipeline',
          fb:'It affects every principal in the account, and it is very likely load-bearing for a data-residency or sovereignty commitment. Removing a control to fix a misconfiguration inverts which one was wrong.' },
        { t:'Give the role a policy that explicitly allows s3:PutObject in eu-west-1',
          fb:'Nothing in an identity policy can override an explicit deny in an SCP. You would add permissions, see no change, and lose an hour concluding IAM is broken.' }
      ] },

    { kind:'cmd',
      ask:'Verify the fix at the layer that failed.',
      hint:'Confirm the region, then make the call for real.',
      opts:[
        { c:'AWS_REGION=us-east-1 aws s3 cp app.zip s3://prod-artifacts/app.zip && aws s3api head-object --bucket prod-artifacts --key app.zip --query LastModified', ok:true,
          out:'upload: ./app.zip to s3://prod-artifacts/app.zip\n"2026-08-27T09:58:22+00:00"',
          fb:'The upload succeeds and the object timestamp proves it landed, rather than trusting the exit code. Now make the region explicit in the workflow so it does not depend on whatever the runner image happens to export.',
          parts:[['AWS_REGION=us-east-1','Set explicitly for this call rather than inherited from the environment that caused the incident'],['head-object … LastModified','Confirm the object actually changed — an exit code alone can hide a no-op']] },
        { c:'aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::111122223333:role/ci-deploy --action-names s3:PutObject --resource-arns arn:aws:s3:::prod-artifacts/app.zip',
          out:'[ [ "allowed", [ "PolicyInputList.1" ] ] ]',
          fb:'It said allowed before the fix too — the simulator does not fully evaluate SCPs, and it has no notion of which region the call will target. Useful for identity policy questions; blind to this one.' },
        { c:'aws organizations list-policies-for-target --target-id 111122223333 --filter SERVICE_CONTROL_POLICY',
          out:'p-fullaws    FullAWSAccess\np-9a8b7c     DenyNonApprovedRegions',
          fb:'Unchanged, which is correct — you deliberately did not touch the SCP. It confirms nothing about whether the pipeline now works.' },
        { c:'aws s3 ls s3://prod-artifacts/',
          out:'2026-08-27 09:58:22   14238911 app.zip',
          fb:'Reasonable, and the timestamp is the evidence you want. Doing the upload and the check in one line is tighter, and a listing after someone else\'s deploy could mislead you.' }
      ] },

    { kind:'think',
      ask:'What makes the next one of these five minutes instead of thirty?',
      hint:'Two of the three are about making the invisible layer visible.',
      opts:[
        { t:'Pin the region explicitly in the pipeline, and make the SCP denial message reachable — document that "explicit deny in a service control policy" means Organizations, not IAM', ok:true,
          fb:'Right on both counts. The configuration fix stops the recurrence and the documentation fix stops the next person spending thirty minutes reading a correct IAM policy. A runbook line mapping each denial phrase to its layer is one of the cheapest artefacts you can write.' },
        { t:'Give the platform team Organizations read access so they can see SCPs',
          fb:'Genuinely useful and worth doing — but on its own it only helps people who already suspect an SCP. The mapping from message to layer is what gets them there.' },
        { t:'Alert on every AccessDenied in CloudTrail',
          fb:'The volume is enormous — normal operation produces denials constantly — and the signal is buried. Alert on denials for specific principals or specific SCP-shaped denials if you must, not on all of them.' },
        { t:'Stop using SCPs, since they are hard to debug',
          fb:'They are the only control an account administrator cannot bypass, which is the entire point. The answer is to make them discoverable, not to remove the strongest guardrail available.' }
      ] }
  ],
  debrief:{
    why:[
      'get-caller-identity took thirty seconds and confirmed which role was actually calling — the step that resolves a large share of these outright.',
      'The full error text named the layer. "Explicit deny in a service control policy" is a different sentence from "no identity-based policy allows", and AWS distinguishes them deliberately.',
      'That one line ruled out every change to the role: no policy, boundary or trust edit can override an SCP, so the whole IAM repository was irrelevant.',
      'list-policies-for-target plus list-parents found the applicable policies, because SCPs are inherited cumulatively down the OU tree and checking only the account misses half of them.',
      'The policy document turned the question from "what changed in IAM" into "why is this call going to eu-west-1" — a much easier question, and the actual defect.',
      'The runner environment had changed, not the permissions. The guardrail worked exactly as intended and caught a misconfiguration before anything reached an unapproved region.',
      'Verification made the real call and checked the object timestamp, rather than trusting a simulator that cannot see SCPs or regions at all.'
    ],
    interview:'Lead with the evaluation order and the error text. "IAM evaluates in a fixed order — explicit deny anywhere wins, then SCPs, then resource policies, then identity policies, then boundaries, then session policies — and the denial message tells you which layer decided. Here it said explicit deny in a service control policy, which means it was set above the account and nothing I do to the role can override it; I need Organizations access to even see it. The SCP denied everything outside two approved regions, so the real question became why the pipeline was calling a third one, and the answer was a runner that had started exporting AWS_REGION=eu-west-1. I fixed the pipeline rather than the guardrail — the guardrail did its job. What I would change afterwards is documentation: a line mapping each denial phrase to its layer saves the next person half an hour."',
    prevent:[
      'Pin the region explicitly in the pipeline rather than inheriting whatever the runner image exports.',
      'Document the mapping from denial phrasing to layer — service control policy, identity-based policy, resource-based policy, implicit deny — where on-call will find it.',
      'Give engineers read access to Organizations, or publish the applicable SCPs per OU, so the invisible layer is at least discoverable.',
      'Alert on the pipeline\'s own AccessDenied events with the principal attached, so a permissions regression is a notification rather than three failed deploys.',
      'Keep SCPs narrow and named for what they enforce — DenyNonApprovedRegions explains itself in a way that a policy called p-9a8b7c does not.'
    ]
  }
},

/* ─────────────────────────────── 2. unreachable web tier ── */
{
  id:'aws-l-unreachable', title:'The new web tier is unreachable', cat:'vpc',
  track:'aws', level:'intermediate', mins:9,
  brief:'A new Auto Scaling group went out in a third availability zone this morning to add capacity. Instances launch and pass their EC2 status checks, the load balancer marks every one of them unhealthy, and nobody can SSH to them either. The two original AZs are fine and serving traffic.',
  user:'you', host:'aws-cli',
  steps:[
    { kind:'cmd',
      ask:'Establish what is actually wrong with the new instances.',
      hint:'The load balancer already has an opinion, and it records why.',
      opts:[
        { c:'aws elbv2 describe-target-health --target-group-arn $TG --query \'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]\' --output table', ok:true,
          out:'-------------------------------------------------------\n|  i-0a1b2c3d  |  healthy   |  None                   |\n|  i-0c4d5e6f  |  healthy   |  None                   |\n|  i-0e7f8a9b  |  unhealthy |  Target.Timeout         |\n|  i-0f1a2b3c  |  unhealthy |  Target.Timeout         |\n-------------------------------------------------------',
          fb:'Both new instances time out while the old ones are healthy. Target.Timeout means nothing answered at all — a security group, a routing problem, or no process listening. It is specifically not "the app returned the wrong thing".',
          parts:[['describe-target-health','The load balancer\'s own verdict on each target'],['TargetHealth.Reason','Timeout, FailedHealthChecks, NotRegistered and Elb.InternalError route to four different investigations'],['Target.Timeout','Nothing answered — so this is reachability, not application behaviour']] },
        { c:'aws autoscaling describe-scaling-activities --auto-scaling-group-name web-prod --max-items 5',
          out:'2026-08-27T09:12:04Z  Successful  Launching a new EC2 instance: i-0e7f8a9b\n2026-08-27T09:14:41Z  Successful  Launching a new EC2 instance: i-0f1a2b3c',
          fb:'The launches succeeded, which is worth knowing — this is not a quota or capacity problem. But it says nothing about why the instances are unhealthy once running.' },
        { c:'aws ec2 describe-instance-status --instance-ids i-0e7f8a9b',
          out:'InstanceId: i-0e7f8a9b\nSystemStatus: ok\nInstanceStatus: ok',
          fb:'Both checks pass, which the brief already told you. Useful as confirmation that the OS is up — but the interesting question is why nothing can reach it, and the target group has already recorded an answer.' },
        { c:'aws autoscaling set-desired-capacity --auto-scaling-group-name web-prod --desired-capacity 8',
          out:'(no output)',
          fb:'More instances in a broken AZ produces more unhealthy targets, burns quota and costs money. Nothing about the failure is capacity-shaped.' }
      ] },

    { kind:'cmd',
      ask:'What is different about the new instances?',
      hint:'They are in a new AZ, which means a new subnet.',
      opts:[
        { c:'aws ec2 describe-instances --instance-ids i-0e7f8a9b i-0a1b2c3d --query \'Reservations[].Instances[].[InstanceId,Placement.AvailabilityZone,SubnetId,SecurityGroups[0].GroupId,PrivateIpAddress]\' --output table', ok:true,
          out:'---------------------------------------------------------------------------\n|  i-0a1b2c3d  |  us-east-1a  |  subnet-0aa11  |  sg-0web123  |  10.0.1.44  |\n|  i-0e7f8a9b  |  us-east-1c  |  subnet-0cc33  |  sg-0web123  |  10.0.5.12  |\n---------------------------------------------------------------------------',
          fb:'Same security group, different subnet. That is the shape of this failure: whatever is wrong is subnet-scoped — a route table or a NACL — rather than instance-scoped, because the security group is shared with instances that work.',
          parts:[['--instance-ids i-0e7f8a9b i-0a1b2c3d','Compare a broken one against a working one; the difference is the answer'],['Placement.AvailabilityZone','The new AZ, which means a new subnet with its own route table and NACL'],['SecurityGroups[0].GroupId','Identical across both — so the security group is very unlikely to be the cause']] },
        { c:'aws ec2 describe-security-groups --group-ids sg-0web123 --query \'SecurityGroups[0].IpPermissions\'',
          out:'[ { "FromPort": 80, "ToPort": 80, "IpProtocol": "tcp",\n    "UserIdGroupPairs": [ { "GroupId": "sg-0alb999" } ] } ]',
          fb:'A correct rule referencing the load balancer\'s group. Since the healthy instances use this same group, it cannot be what separates the two sets — which is exactly the reasoning that should have come first.' },
        { c:'aws ec2 get-console-output --instance-id i-0e7f8a9b --latest --output text | tail -20',
          out:'[  OK  ] Started nginx - high performance web server.\n[  OK  ] Reached target Multi-User System.\nAmazon Linux 2023\nip-10-0-5-12 login:',
          fb:'A clean boot with nginx started, which usefully rules out the application and the AMI. It does not explain why nothing can reach it, and you have not yet established what is different about these instances.' },
        { c:'aws ec2 reboot-instances --instance-ids i-0e7f8a9b',
          out:'(no output)',
          fb:'A reboot of a machine that booted cleanly and is running the right process. It changes nothing, and it resets the console output you would have read.' }
      ] },

    { kind:'cmd',
      ask:'Check the subnet-scoped configuration. Start with routing.',
      hint:'A subnet with no explicit association does not have no route table.',
      opts:[
        { c:'aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=subnet-0cc33 --query \'RouteTables[].[RouteTableId,Associations[0].Main,Routes[].DestinationCidrBlock,Routes[].NatGatewayId]\'', ok:true,
          out:'[\n  [ "rtb-0main99", true,\n    [ "10.0.0.0/16" ],\n    [ null ] ]\n]',
          fb:'`Main: true` and a single local route. The new subnet was never associated with a route table, so it silently inherited the VPC main table — which has no default route at all. No egress, and that is why the instances cannot reach anything.',
          parts:[['Name=association.subnet-id','Asks which table actually governs this subnet, rather than listing all of them'],['"Main": true','The subnet has no explicit association and is falling back to the VPC main table'],['Routes … 10.0.0.0/16 only','Local traffic only — no NAT gateway, no internet gateway, no egress whatsoever']] },
        { c:'aws ec2 describe-subnets --subnet-ids subnet-0cc33 --query \'Subnets[0].[CidrBlock,AvailableIpAddressCount,MapPublicIpOnLaunch]\'',
          out:'[ "10.0.5.0/24", 249, false ]',
          fb:'Plenty of addresses and no auto-assigned public IP — which matches the other subnets, since this is a private tier behind a load balancer. Nothing here separates it from the working AZs.' },
        { c:'aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=subnet-0cc33 --query \'NetworkAcls[].IsDefault\'',
          out:'[ true ]',
          fb:'The default NACL, which allows everything in both directions — so this layer is ruled out. A reasonable check, and cheaper to do after routing, which is the more common cause of a whole-subnet failure.' },
        { c:'aws ec2 describe-nat-gateways --filter Name=vpc-id,Values=vpc-0a1b',
          out:'nat-07c9e1   subnet-0aa11   available   3.94.11.2\nnat-08d2f3   subnet-0bb22   available   3.94.11.9',
          fb:'Two NAT gateways for the two original AZs — which is a real finding: there is nothing for the third. But you have not yet confirmed the new subnet even has a route pointing at one.' }
      ] },

    { kind:'think',
      ask:'The subnet inherits the main route table with no default route. Why does that break the health check?',
      hint:'Ask what the instance needs to do before it can answer anything.',
      opts:[
        { t:'The bootstrap could not reach the package repository, so the application was never fully configured — and the health check has nothing to answer it', ok:true,
          fb:'That is the chain. The load balancer reaches the instance over the local VPC route, but the instance never completed its user-data because it could not get out — so the port the health check wants is not being served. Console output showing nginx started is not the same as nginx serving the application.' },
        { t:'The load balancer cannot route to a subnet with no default route',
          fb:'Not so — load balancer to target traffic is inside the VPC and uses the local route, which exists. The missing default route affects the instance\'s *outbound* traffic, not the inbound path.' },
        { t:'The instance has no public IP, so the health check cannot reach it',
          fb:'Targets never need public addresses. The healthy instances in the other AZs do not have them either — the load balancer connects to private IPs within the VPC.' },
        { t:'The security group blocks the health check port',
          fb:'The same security group is attached to the healthy instances, so it cannot be what distinguishes them. That comparison is why establishing the difference early was worth doing.' }
      ] },

    { kind:'cmd',
      ask:'Confirm the bootstrap failed, without a network path to the instance.',
      hint:'There are two ways onto a box you cannot reach, and one needs no agent at all.',
      opts:[
        { c:'aws ec2 get-console-output --instance-id i-0e7f8a9b --latest --output text | grep -i "cloud-init\\|err\\|timed out"', ok:true,
          out:'Err:1 https://repo.internal.example.com/al2023 InRelease\n  Could not connect to repo.internal.example.com:443 (10.0.9.14), connection timed out\nE: Unable to fetch some archives\ncloud-init[1189]: Failed to run module scripts-user\ncloud-init failed with exit code 1',
          fb:'Confirmed at the source: the bootstrap timed out fetching packages and cloud-init exited non-zero. The instance is up, nginx is running with its default configuration, and the application was never installed.',
          parts:[['get-console-output','Needs no agent, no network path and no credentials on the instance'],['--latest','Live output on Nitro instances rather than the cached snapshot'],['cloud-init failed with exit code 1','The user-data script did not complete — everything it was supposed to install is missing']] },
        { c:'aws ssm start-session --target i-0e7f8a9b',
          out:'An error occurred (TargetNotConnected) when calling the StartSession operation: i-0e7f8a9b is not connected.',
          fb:'The right instinct, and the failure is informative — the agent cannot reach the SSM endpoints, for exactly the same reason the bootstrap failed. But it leaves you without the log, which the console output gives you for free.' },
        { c:'aws ec2 describe-instance-attribute --instance-id i-0e7f8a9b --attribute userData --query UserData.Value --output text | base64 -d',
          out:'#!/bin/bash\ndnf install -y nginx app-agent\nsystemctl enable --now nginx',
          fb:'Shows what was *supposed* to run, which is useful context. It cannot tell you whether it succeeded — and here the whole question is whether it did.' },
        { c:'aws ec2 terminate-instances --instance-ids i-0e7f8a9b',
          out:'(no output)',
          fb:'The replacement launches into the same subnet and fails identically, and you have destroyed the console log that names the cause.' }
      ] },

    { kind:'cmd',
      ask:'Fix the routing. What does the new subnet need?',
      hint:'NAT gateways are zonal, and there are only two.',
      opts:[
        { c:'aws ec2 create-nat-gateway --subnet-id subnet-0cc-public --allocation-id eipalloc-0c3d && aws ec2 create-route-table --vpc-id vpc-0a1b', ok:true,
          out:'NatGatewayId: nat-09e4a7   State: pending\nRouteTableId: rtb-0new77',
          fb:'A NAT gateway in the third AZ\'s public subnet and a dedicated route table for the new private subnet. Zonal NAT keeps the failure domain per-AZ and avoids billing this AZ\'s egress as cross-AZ transfer — which is what a shortcut to one of the existing gateways would have done.',
          parts:[['create-nat-gateway --subnet-id subnet-0cc-public','It must live in a public subnet — one with an internet gateway route — or it has nowhere to forward to'],['--allocation-id','A NAT gateway needs an Elastic IP'],['create-route-table','A dedicated table, so this subnet stops inheriting the main one']] },
        { c:'aws ec2 associate-route-table --route-table-id rtb-0aa11 --subnet-id subnet-0cc33',
          out:'AssociationId: rtbassoc-0f1e2d',
          fb:'It works immediately and it is a defensible emergency move — the subnet now routes through the us-east-1a NAT gateway. The cost is that all of the new AZ\'s egress becomes cross-AZ traffic, and an outage in 1a now takes out 1c too, which is the opposite of why the third AZ was added.' },
        { c:'aws ec2 create-route --route-table-id rtb-0main99 --destination-cidr-block 0.0.0.0/0 --nat-gateway-id nat-07c9e1',
          out:'Return: true',
          fb:'This edits the **main** route table, so every subnet that inherits it — now and in future — is silently changed. Editing the main table to fix one subnet is how a VPC ends up with routing nobody can reason about.' },
        { c:'aws ec2 create-route --route-table-id rtb-0new77 --destination-cidr-block 0.0.0.0/0 --gateway-id igw-0b2c3d',
          out:'Return: true',
          fb:'That makes the private subnet public. The instances have no public IPs so they still cannot reach anything, and you have removed a boundary while fixing nothing.' }
      ] },

    { kind:'cmd',
      ask:'Associate the table, add the route, and get healthy instances.',
      hint:'Existing instances already failed their bootstrap — routing alone does not fix them.',
      opts:[
        { c:'aws ec2 create-route --route-table-id rtb-0new77 --destination-cidr-block 0.0.0.0/0 --nat-gateway-id nat-09e4a7 && aws ec2 associate-route-table --route-table-id rtb-0new77 --subnet-id subnet-0cc33 && aws autoscaling start-instance-refresh --auto-scaling-group-name web-prod', ok:true,
          out:'Return: true\nAssociationId: rtbassoc-0f1e2d\nInstanceRefreshId: 8d1c-4a2b',
          fb:'Route, association, then replacement — in that order. The existing instances failed their user-data at first boot and user data runs once, so they will never install the application no matter how good the routing becomes. They have to be replaced.',
          parts:[['create-route … --nat-gateway-id','The default route the subnet never had'],['associate-route-table','Stops the subnet inheriting the main table'],['start-instance-refresh','User data runs once at first boot — a fixed network does not re-run it']] },
        { c:'aws ec2 associate-route-table --route-table-id rtb-0new77 --subnet-id subnet-0cc33',
          out:'AssociationId: rtbassoc-0f1e2d',
          fb:'Half the fix. The table is associated and still has no default route in it, so nothing changes — and the existing instances would still need replacing even once it does.' },
        { c:'aws ec2 reboot-instances --instance-ids i-0e7f8a9b i-0f1a2b3c',
          out:'(no output)',
          fb:'A reboot does not re-run user data. Cloud-init records that it has already run for this instance, so the packages stay missing and the health check keeps timing out.' },
        { c:'aws elbv2 deregister-targets --target-group-arn $TG --targets Id=i-0e7f8a9b Id=i-0f1a2b3c',
          out:'(no output)',
          fb:'It stops the unhealthy targets showing in the dashboard, which is cosmetic — the Auto Scaling group re-registers them, and you have hidden the symptom rather than fixed the subnet.' }
      ] },

    { kind:'cmd',
      ask:'Verify at the layer that was failing.',
      hint:'The load balancer had the original opinion; go back to it.',
      opts:[
        { c:'aws elbv2 describe-target-health --target-group-arn $TG --query \'TargetHealthDescriptions[].[Target.Id,TargetHealth.State]\' --output table', ok:true,
          out:'------------------------------\n|  i-0a1b2c3d  |  healthy    |\n|  i-0c4d5e6f  |  healthy    |\n|  i-0b8c9d0e  |  healthy    |\n|  i-0d2e3f4a  |  healthy    |\n------------------------------',
          fb:'Four healthy targets across three AZs, including two new instance ids from the refresh. This is the verdict that matters, and it comes from the component that raised the alarm.',
          parts:[['describe-target-health','Verify where the failure was reported, not two layers away'],['new instance ids','The refresh replaced them — the original two could never have recovered']] },
        { c:'aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=subnet-0cc33 --query \'RouteTables[].Routes[]\'',
          out:'10.0.0.0/16   local     None       active\n0.0.0.0/0     None      nat-09e4a7 active',
          fb:'Correct and worth checking — the route exists and is active. It is a check on the fix rather than on the outcome; a right route with instances that never re-bootstrapped still serves nothing.' },
        { c:'aws ec2 get-console-output --instance-id i-0b8c9d0e --latest --output text | grep cloud-init',
          out:'cloud-init[1189]: Cloud-init v. 23.4 finished at Wed, 27 Aug 2026 10:22:14 +0000. Up 41.28 seconds',
          fb:'Good evidence that the bootstrap now completes — genuinely reassuring. But a successful cloud-init on one instance is upstream of the question "is the service healthy", which the target group answers directly.' },
        { c:'curl -sS -o /dev/null -w \'%{http_code}\' https://web.example.com/',
          out:'200',
          fb:'The end-to-end proof, and the right last step. On its own it can mislead: the two healthy AZs would have returned 200 throughout the entire incident.' }
      ] },

    { kind:'think',
      ask:'What made this expensive, and what would you change?',
      hint:'The subnet was created by hand into an environment that expects a pattern.',
      opts:[
        { t:'A subnet was added without the route table, NAT gateway and associations the other AZs have — build AZs from the same module so a third one cannot be half-configured', ok:true,
          fb:'That is the root cause. Every symptom — unreachable instances, failed health checks, a failed bootstrap — descended from one missing association, and inheriting the main route table made it silent rather than obviously broken. Encoding an AZ as a module means adding one is a variable change, not a checklist somebody follows from memory.' },
        { t:'The health check grace period was too short for the new instances',
          fb:'Grace period was never involved; the instances passed their EC2 checks and simply had nothing serving. Raising it would have made the loop slower, not fixed it.' },
        { t:'The application should not depend on an internal package repository at boot',
          fb:'A fair point and a real improvement — baking packages into the AMI removes a whole class of boot-time failure. It would have changed the symptom here without fixing the subnet, which still has no egress for anything else.' },
        { t:'The team should have used a bigger instance type',
          fb:'Nothing in this incident was resource-shaped. The instances were idle the entire time.' }
      ] }
  ],
  debrief:{
    why:[
      'The target group\'s Reason field split the problem immediately: Target.Timeout means nothing answered, which is reachability, not an application returning the wrong thing.',
      'Comparing a broken instance against a working one showed the same security group and a different subnet, which localised the fault to something subnet-scoped before any policy was read.',
      'The route table query asked which table governs the subnet rather than listing tables. `Main: true` was the whole finding — the subnet was never associated and silently inherited a table with no default route.',
      'Inheriting the main route table is the quiet part: nothing is misconfigured, nothing errors, and the subnet simply has no egress.',
      'The console log proved the consequence without any network path to the instance: cloud-init timed out fetching packages and exited non-zero, so the application was never installed.',
      'The fix kept NAT zonal — a gateway in the third AZ rather than a route to an existing one — so the new AZ is a real failure domain rather than a dependency on another one, and its egress is not billed as cross-AZ.',
      'An instance refresh was required because user data runs once at first boot; fixing the network does not re-run it, and a reboot does not either.',
      'Verification went back to the target group, which is where the failure was reported. A correct route with instances that never bootstrapped still serves nothing.'
    ],
    interview:'Frame it as narrowing by comparison. "Target.Timeout means nothing answered, so I am looking at reachability rather than the application. The new instances differed from the healthy ones in exactly one way — a new subnet in a new AZ, same security group — so the cause had to be subnet-scoped: route table or NACL. The route table query showed Main: true, meaning the subnet had never been associated and was inheriting the VPC main table, which had only the local route. No egress, so cloud-init could not reach the package repository, so nothing was serving the health check port — the console log confirmed that without needing to get onto the box. I added a NAT gateway in that AZ rather than routing to an existing one, because zonal NAT keeps the failure domain per-AZ and avoids cross-AZ transfer charges, then associated a dedicated route table and ran an instance refresh, since user data runs once and the existing instances were never going to recover. The real fix is that adding an AZ should be a module variable, not a manual checklist."',
    prevent:[
      'Define an availability zone as a module — subnet, route table, association, NAT gateway — so a third AZ cannot be half-configured by hand.',
      'Alert on any subnet associated with the main route table; it is almost always an oversight and it fails silently.',
      'Bake packages into the AMI rather than installing at boot, so a network problem does not become an application problem.',
      'Give the ASG a lifecycle hook or a longer grace period during first rollout of a new AZ, so a failing instance survives long enough to inspect.',
      'Run a NAT gateway per AZ. One shared gateway makes every other AZ depend on it and bills their egress as cross-AZ transfer.'
    ]
  }
}

);
