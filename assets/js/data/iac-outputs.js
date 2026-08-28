/* Terraform & IaC — what each playbook step prints, with the deciding line
   marked. Plan output is mostly noise around two or three lines that matter;
   this file is about knowing which ones.                                    */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.pbOut = LX.pbOut || {};

LX.pbOut['tf-plan-destroy'] = [
  { out:'Terraform will perform the following actions:\n\n' +
        '  # aws_instance.web[0] will be destroyed\n' +
        '  # (because index [0] is out of range for count)\n' +
        '  - resource "aws_instance" "web" {\n' +
        '      - id            = "i-0a1b2c3d4e5f" -> null\n' +
        '      - instance_type = "t3.small" -> null\n' +
        '    }\n\n' +
        '  # aws_instance.web["api"] will be created\n' +
        '  + resource "aws_instance" "web" {\n' +
        '      + instance_type = "t3.small"\n' +
        '    }\n\n' +
        'Plan: 14 to add, 0 to change, 14 to destroy.',
    mark:['index [0] is out of range for count','Plan: 14 to add, 0 to change, 14 to destroy.'],
    note:'Fourteen destroys and fourteen creates of the same resources is the signature of a reindex, not a deletion. The parenthetical is the whole diagnosis: the address `web[0]` no longer exists because the block moved from `count` to `for_each`, so Terraform sees every old address disappear and every new keyed address arrive.' },

  { out:'$ terraform state list | head -6\n' +
        'aws_instance.web[0]\n' +
        'aws_instance.web[1]\n' +
        'aws_instance.web[2]\n' +
        'module.network.aws_subnet.private[0]\n\n' +
        '$ git log --oneline -3 -- \'*.tf\'\n' +
        '9f2c4a1 refactor: key instances by role instead of position\n' +
        '3b81e7d chore: bump provider constraint',
    mark:['aws_instance.web[0]','key instances by role instead of position'],
    note:'State holds positional indexes and the commit message says what happened. Positional addresses in state next to keyed addresses in the plan is a mismatch you can see in two commands — and the commit tells you the intent was a refactor, not a deletion, which is what makes `moved` the right fix rather than an argument about whether to apply.' },

  { out:'Terraform v1.9.5\n' +
        'on linux_amd64\n' +
        '+ provider registry.terraform.io/hashicorp/aws v5.61.0\n\n' +
        '$ git diff HEAD~5 -- .terraform.lock.hcl\n' +
        '-  version     = "5.48.0"\n' +
        '+  version     = "5.61.0"',
    mark:['version     = "5.48.0"','version     = "5.61.0"'],
    note:'The lock file moved thirteen minor versions in a recent commit, so the provider is a live suspect for anything that now forces replacement. This is the case where nothing in your own resource blocks changed and the plan still differs — read the provider changelog for that range and look for attributes reclassified as requiring replacement.' },

  { out:'moved {\n' +
        '  from = aws_instance.web[0]\n' +
        '  to   = aws_instance.web["api"]\n' +
        '}\n\n' +
        '$ terraform plan\n' +
        'Terraform will perform the following actions:\n\n' +
        '  # aws_instance.web["api"] has moved to aws_instance.web["api"]\n\n' +
        'Plan: 0 to add, 0 to change, 0 to destroy.',
    mark:['has moved to','Plan: 0 to add, 0 to change, 0 to destroy.'],
    note:'The plan collapses to nothing, which is the proof that the address mapping is right. Terraform reports the move explicitly rather than silently, so a partial fix is visible: any resource still showing as destroyed has a `moved` block with a wrong address, and the plan names exactly which.' },

  { out:'{\n' +
        '  "create": 0,\n' +
        '  "no-op": 27,\n' +
        '  "update": 1\n' +
        '}',
    mark:['"create": 0','"update": 1'],
    note:'An explicit count per action, which is what goes in the change record and what a reviewer can check in ten seconds. No delete key at all is the outcome you wanted. This same `jq` expression makes a CI gate: fail the build when a plan against production contains any delete, and this incident becomes a blocked pull request instead.' }
];

LX.pbOut['tf-state-lock'] = [
  { out:'Error: Error acquiring the state lock\n\n' +
        'Error message: ConditionalCheckFailedException: The conditional request failed\n' +
        'Lock Info:\n' +
        '  ID:        8f2b1c04-7e31-4a90-b2cd-19f4e0a7c331\n' +
        '  Path:      tfstate/env/prod/terraform.tfstate\n' +
        '  Operation: OperationTypeApply\n' +
        '  Who:       runner@ci-runner-4471\n' +
        '  Created:   2026-08-28 09:41:22.108 +0000 UTC',
    mark:['Operation: OperationTypeApply','runner@ci-runner-4471','8f2b1c04-7e31-4a90-b2cd-19f4e0a7c331'],
    note:'The error is the investigation and most people skim past it. Operation, holder, host and creation time are all here — an apply held by a CI runner is a completely different situation from a plan held by a colleague. The lock id is deliberately not guessable, so you have to have read this before you can unlock, which is the point.' },

  { out:'# GitHub Actions run 4471\n' +
        'Status:     cancelled\n' +
        'Conclusion: cancelled\n' +
        'Duration:   4m 12s\n' +
        'Last step:  terraform apply (cancelled)\n\n' +
        '$ ps aux | grep [t]erraform\n' +
        '(no output)',
    mark:['cancelled','(no output)'],
    note:'The job is confirmed finished rather than merely showing as cancelled, and no terraform process survives. Both halves matter: a cancelled pipeline does not always stop the process immediately, and an apply still talking to a provider keeps making changes after the UI says cancelled.' },

  { out:'$ terraform state pull | jq \'.serial, .lineage\'\n' +
        '284\n' +
        '"a3f1c7e2-9b04-4d6f-8c11-77e2a5db3390"\n\n' +
        '# the cancelled run logged before it died:\n' +
        'aws_security_group.api: Creation complete after 2s\n' +
        'aws_lb_target_group.api: Creation complete after 3s\n' +
        'aws_lb_listener_rule.api: Still creating... [1m40s elapsed]',
    mark:['284','Creation complete after 2s','Still creating...'],
    note:'The serial advanced and two resources reported complete, so this was a partial apply — some of the plan is done and recorded. That is the difference between a lock incident and a state-corruption incident: knowing this now means the next plan showing the remainder is expected rather than alarming.' },

  { out:'Do you really want to force-unlock?\n' +
        '  Terraform will remove the lock on the remote state.\n' +
        '  This will allow local Terraform commands to modify this state, even though it\n' +
        '  may still be in use. Only \'yes\' will be accepted to confirm.\n\n' +
        '  Enter a value: yes\n\n' +
        'Terraform state has been successfully unlocked!',
    mark:['may still be in use','successfully unlocked'],
    note:'The confirmation text names the actual risk: it may still be in use. That prompt is the last checkpoint before two applies can run concurrently against one state, which is why `-force` from a human shell is a habit worth not having.' },

  { out:'Terraform will perform the following actions:\n\n' +
        '  # aws_lb_listener_rule.api will be created\n' +
        '  + resource "aws_lb_listener_rule" "api" {\n' +
        '      + priority = 100\n' +
        '    }\n\n' +
        'Plan: 1 to add, 0 to change, 0 to destroy.',
    mark:['Plan: 1 to add, 0 to change, 0 to destroy.'],
    note:'Exactly the resource that was mid-creation when the run was cancelled, and nothing else. That is what a healthy partial apply looks like: state recorded what completed, and the plan proposes only the remainder. Applying this simply resumes where the cancelled run stopped.' }
];

LX.pbOut['tf-drift'] = [
  { out:'Note: Objects have changed outside of Terraform\n\n' +
        'Terraform detected the following changes made outside of Terraform since the\n' +
        'last "terraform apply" which may have affected this plan:\n\n' +
        '  # aws_security_group.api has been changed\n' +
        '  ~ resource "aws_security_group" "api" {\n' +
        '      + ingress {\n' +
        '          + from_port   = 22\n' +
        '          + cidr_blocks = ["0.0.0.0/0"]\n' +
        '        }\n' +
        '    }\n\n' +
        'This is a refresh-only plan, so Terraform will not take any actions.',
    mark:['changed outside of Terraform','cidr_blocks = ["0.0.0.0/0"]','refresh-only plan'],
    note:'Refresh-only isolates the question: this is what the world did, with no proposal about what your code would do. And the drift itself is a finding — SSH opened to the internet on a managed security group, which somebody added by hand and which a normal apply would have silently reverted without anyone learning it happened.' },

  { out:'EventTime             EventName                        Username\n' +
        '--------------------  -------------------------------  ------------\n' +
        '2026-08-27 22:14:07   AuthorizeSecurityGroupIngress    alex\n' +
        '2026-08-27 22:13:51   DescribeSecurityGroups           alex\n\n' +
        '# and the same principal in the incident channel at 22:12',
    mark:['AuthorizeSecurityGroupIngress','alex'],
    note:'A person, in the console, late at night, during an incident. That changes the decision entirely: the change was probably deliberate and correct, so a normal apply would revert an emergency fix. The right move is to accept it into state and then codify it — and separately to ask why console write access exists in production.' },

  { out:'Terraform will perform the following actions:\n\n' +
        '  # aws_security_group.api has changed\n\n' +
        'Would you like to update the Terraform state to reflect these detected changes?\n' +
        '  Enter a value: yes\n\n' +
        'Apply complete! Resources: 0 added, 0 changed, 0 destroyed.',
    mark:['0 added, 0 changed, 0 destroyed'],
    note:'A refresh-only apply changes nothing live — it only updates state to match reality, which the zeros confirm. This is the correct move when the manual change was right; a normal apply would have removed that rule and re-broken whatever it fixed.' },

  { out:'$ terraform plan\n\n' +
        'No changes. Your infrastructure matches the configuration.',
    mark:['No changes. Your infrastructure matches the configuration.'],
    note:'The proof that the loop closed. Accepting drift into state without updating the code only defers the problem — the next plan proposes to change it back, and now the drift is invisible because state agrees with reality while the configuration does not. An empty plan means all three agree.' },

  { out:'$ terraform plan -refresh-only -detailed-exitcode\n' +
        'No changes. Your infrastructure still matches the configuration.\n' +
        '$ echo $?\n' +
        '0\n\n' +
        '# when drift appears, the same command exits 2:\n' +
        '# 0 = no changes, 1 = error, 2 = changes present',
    mark:['-detailed-exitcode','2 = changes present'],
    note:'Exit code 2 turns a scheduled refresh-only plan into a drift alarm in one line of pipeline. Drift found by a nightly job is a ticket; drift found during an incident is an argument about whether to revert somebody’s fix while the service is down.' }
];

LX.pbOut['tf-import'] = [
  { out:'---------------------------------------------\n' +
        '|  vpc-0a1b2c3d  |  10.0.0.0/16  |  prod    |\n' +
        '---------------------------------------------\n\n' +
        '$ terraform state list | grep vpc\n' +
        '(no output)',
    mark:['vpc-0a1b2c3d','(no output)'],
    note:'The id in the provider format, and confirmation that nothing already manages it. Both checks are cheap and the second matters more than it looks: importing a resource another configuration owns creates two states that each believe they own it, and they will revert each other on every apply with nothing warning you.' },

  { out:'$ terraform plan -generate-config-out=generated.tf\n\n' +
        'Terraform will perform the following actions:\n\n' +
        '  # aws_vpc.main will be imported\n' +
        '    resource "aws_vpc" "main" {\n' +
        '        cidr_block = "10.0.0.0/16"\n' +
        '        id         = "vpc-0a1b2c3d"\n' +
        '    }\n\n' +
        'Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.\n' +
        'Terraform has generated configuration in generated.tf',
    mark:['1 to import, 0 to add, 0 to change, 0 to destroy','generated configuration in generated.tf'],
    note:'The import block shows up in the plan before anything is written to state, which the CLI `terraform import` never gave you. Note the counts: one import and nothing else. The generated file is a verbose first draft including computed attributes you do not want to own — trim it rather than committing it whole.' },

  { out:'$ terraform plan\n\n' +
        '  # aws_vpc.main will be updated in-place\n' +
        '  ~ resource "aws_vpc" "main" {\n' +
        '      ~ enable_dns_hostnames = true -> false\n' +
        '    }\n\n' +
        'Plan: 0 to add, 1 to change, 0 to destroy.',
    mark:['enable_dns_hostnames = true -> false','1 to change'],
    note:'Not an empty plan, so the configuration disagrees with reality — and applying would turn off DNS hostnames on a production VPC because the code omitted an attribute that is actually enabled. This is exactly the failure importing is prone to: fix the configuration to match what exists, never apply your way to agreement.' },

  { out:'$ terraform state list\n' +
        'aws_vpc.main\n' +
        'aws_subnet.private["a"]\n' +
        'aws_subnet.private["b"]\n' +
        'aws_route_table.private\n' +
        'aws_route_table_association.private["a"]\n\n' +
        '$ terraform plan\n' +
        'No changes. Your infrastructure matches the configuration.',
    mark:['aws_route_table_association.private["a"]','No changes. Your infrastructure matches the configuration.'],
    note:'Imported in dependency order, planning after each batch. Route table associations and security group rules have the least obvious import ids, so they are the ones to do deliberately — and a clean plan after each batch localises any mistake to those few resources rather than to a hundred.' },

  { out:'lifecycle {\n' +
        '  prevent_destroy = true\n' +
        '}\n\n' +
        '$ terraform plan -out=tfplan\n' +
        'No changes. Your infrastructure matches the configuration.\n' +
        'Saved the plan to: tfplan',
    mark:['prevent_destroy = true','Saved the plan to: tfplan'],
    note:'The moment infrastructure comes under management, a mistaken plan can destroy it — which was not true an hour ago. `prevent_destroy` makes Terraform refuse outright rather than comply, and the fact that it will block a legitimate destroy later is exactly the interruption you want on a production VPC.' }
];

LX.pbOut['tf-apply-fail'] = [
  { out:'aws_security_group.api: Creation complete after 2s [id=sg-0a1b2c3d]\n' +
        'aws_lb_target_group.api: Creation complete after 3s [id=arn:aws:...]\n' +
        'aws_instance.api: Creating...\n\n' +
        'Error: creating EC2 Instance: VcpuLimitExceeded: You have requested more vCPU\n' +
        'capacity than your current vCPU limit of 64 allows for the instance bucket\n' +
        'that the specified instance type belongs to.\n\n' +
        'Apply complete! Resources: 2 added, 0 changed, 0 destroyed.',
    mark:['VcpuLimitExceeded','2 added, 0 changed, 0 destroyed'],
    note:'A quota, not a Terraform problem — and re-running immediately fails identically. The summary line is the reassuring part: two resources were created and recorded, so state is consistent with reality and simply incomplete relative to the plan.' },

  { out:'$ terraform plan\n\n' +
        '  # aws_instance.api will be created\n' +
        '  + resource "aws_instance" "api" {\n' +
        '      + instance_type = "m6i.4xlarge"\n' +
        '    }\n\n' +
        'Plan: 1 to add, 0 to change, 0 to destroy.',
    mark:['Plan: 1 to add, 0 to change, 0 to destroy.'],
    note:'Exactly the remainder — the security group and target group are not proposed again, because state recorded them. This is what a healthy partial apply looks like, and running this plan before re-applying is the step that turns anxiety into a one-line answer.' },

  { out:'$ terraform plan\n' +
        '  # aws_s3_bucket.artifacts will be created\n\n' +
        '$ terraform apply\n' +
        'Error: creating S3 Bucket (app-artifacts-prod): BucketAlreadyOwnedByYou\n\n' +
        '$ terraform state list | grep artifacts\n' +
        '(no output)',
    mark:['BucketAlreadyOwnedByYou','(no output)'],
    note:'The orphan case: the bucket exists in the account and state has no record of it, because the process died between creating it and writing the id. The next apply collides on the name. Importing it is usually right — the resource exists and is what you wanted.' },

  { out:'$ terraform apply\n' +
        'aws_instance.api: Creation complete after 41s [id=i-0f1a2b3c]\n' +
        'aws_lb_listener_rule.api: Creation complete after 2s\n\n' +
        'Apply complete! Resources: 2 added, 0 changed, 0 destroyed.',
    mark:['Apply complete! Resources: 2 added, 0 changed, 0 destroyed.'],
    note:'A full apply finished the job once the quota was raised — no `-target` needed. That matters as evidence, not just as an outcome: a configuration that only applies in fragments is a future outage, so proving the whole thing runs is part of closing the incident.' },

  { out:'$ terraform plan -out=tfplan\n' +
        'No changes. Your infrastructure matches the configuration.\n\n' +
        '$ aws service-quotas get-service-quota --service-code ec2 \\\n' +
        '    --quota-code L-1216C47A --query Quota.Value\n' +
        '256.0',
    mark:['No changes. Your infrastructure matches the configuration.','256.0'],
    note:'Clean plan and the quota raised from 64 to 256, so the cause is removed rather than worked around. EC2 limits are counted in vCPUs per family group per region, not in instances — which is why an alarm on quota utilisation catches this before an apply does.' }
];

LX.pbOut['tf-module-version'] = [
  { out:'modules/network/main.tf:3:  source = "git::ssh://git@github.com/org/tf-modules.git//vpc?ref=main"\n' +
        'modules/service/main.tf:3:  source = "terraform-aws-modules/ecs/aws"\n' +
        'modules/service/main.tf:4:  version = "~> 5.0"',
    mark:['?ref=main','version = "~> 5.0"'],
    note:'`ref=main` is the whole answer: that module can change between two applies with nothing in your repository to explain it, so staging and production resolved different code from the same commit. The registry module below it is pinned, but `~> 5.0` still allows any 5.x minor, which is looser than most people intend.' },

  { out:'Terraform v1.9.5\n' +
        '+ provider registry.terraform.io/hashicorp/aws v5.61.0\n\n' +
        '# in the other environment:\n' +
        '+ provider registry.terraform.io/hashicorp/aws v5.48.0\n\n' +
        '$ git status --short .terraform.lock.hcl\n' +
        '?? .terraform.lock.hcl',
    mark:['v5.61.0','v5.48.0','?? .terraform.lock.hcl'],
    note:'Two environments on different provider versions, and the lock file is untracked — the `??` means git has never seen it. That is a configuration error rather than a preference: the lock file exists to make every machine resolve identically, and gitignoring it reintroduces exactly the drift it prevents.' },

  { out:'$ git log --oneline v2.3.0..v2.4.0\n' +
        '7c1e04a feat: rename aws_lb to aws_lb.main for consistency\n' +
        'b92f5d1 fix: default enable_deletion_protection to true\n\n' +
        '# and no moved block shipped with the rename',
    mark:['rename aws_lb to aws_lb.main','no moved block shipped'],
    note:'A resource renamed inside the module changes its address, so every consumer sees a destroy and recreate. The module should have shipped a `moved` block with that rename and did not — which is a bug worth reporting upstream, and in the meantime you write the `moved` blocks yourself.' },

  { out:'$ diff env/stg.tfvars env/prod.tfvars\n' +
        '3c3\n' +
        '< instance_type = "t3.small"\n' +
        '---\n' +
        '> instance_type = "m6i.large"\n\n' +
        '$ env | grep TF_VAR_\n' +
        'TF_VAR_enable_deletion_protection=false',
    mark:['TF_VAR_enable_deletion_protection=false'],
    note:'The tfvars difference is expected; the environment variable is not. `TF_VAR_` beats the default and is set in one pipeline and not the other, so nothing in the repository explains the difference. Variable precedence is command line, then var-file, then TF_VAR_, then default — and a value that "is not taking effect" is usually something higher winning silently.' },

  { out:'$ terraform init -upgrade=false && terraform plan\n' +
        'Initializing modules...\n' +
        'Downloading git::ssh://git@github.com/org/tf-modules.git?ref=v2.3.0 for network...\n\n' +
        'No changes. Your infrastructure matches the configuration.',
    mark:['?ref=v2.3.0','No changes. Your infrastructure matches the configuration.'],
    note:'Pinned to a tag and both environments now plan identically from the same commit. The fix is always pinning, never re-running until it works — and the module upgrade becomes a deliberate pull request where every environment plan is read before anything is applied.' }
];

LX.pbOut['tf-auth'] = [
  { out:'{\n' +
        '    "UserId": "AIDAI23HXD2O5EXAMPLE",\n' +
        '    "Account": "111122223333",\n' +
        '    "Arn": "arn:aws:iam::111122223333:user/legacy-ci"\n' +
        '}\n\n' +
        '$ env | grep -E "AWS_|TF_VAR_" | sed \'s/=.*/=***/\'\n' +
        'AWS_ACCESS_KEY_ID=***\n' +
        'AWS_SECRET_ACCESS_KEY=***\n' +
        'AWS_ROLE_ARN=***',
    mark:['user/legacy-ci','AWS_ACCESS_KEY_ID=***'],
    note:'The pipeline assumed an OIDC role and is running as an IAM user instead — a leftover access key in the runner environment beats it silently, because environment variables sit above the role in the credential chain. Printing the variable names with the values stripped is enough to diagnose this and puts no secret in the build log.' },

  { out:'Error: configuring Terraform AWS Provider: no valid credential sources for\n' +
        'Terraform AWS Provider found.\n\n' +
        '# versus the other kind:\n' +
        'Error: creating IAM Role (tf-exec): AccessDenied: User: arn:aws:sts::1111:\n' +
        'assumed-role/tf-ci/run-4471 is not authorized to perform: iam:CreateRole',
    mark:['no valid credential sources','is not authorized to perform: iam:CreateRole'],
    note:'Two errors that people report identically. The first is authentication — no identity was established at all, so the credential source is broken. The second is authorisation, and it names the exact action the role is missing, which is what lets you add that one permission rather than widening to Administrator.' },

  { out:'AccessKeyId           Status    CreateDate\n' +
        '--------------------  --------  -------------------\n' +
        'AKIAI44QH8DHBEXAMPLE  Inactive  2024-03-11\n\n' +
        '# and the OIDC trust condition:\n' +
        '"token.actions.githubusercontent.com:sub": "repo:org/infra:ref:refs/heads/master"',
    mark:['Inactive','refs/heads/master'],
    note:'Two expiries in one screen. The stored key was deactivated during a rotation, and the OIDC trust still conditions on `master` after the default branch was renamed to `main` — so the token no longer matches and the role cannot be assumed. Nothing changed in the pipeline; the names moved underneath it.' },

  { out:'$ ls -l tfplan\n' +
        '-rw-r--r--  1 runner  runner  184320 Aug 28 09:14 tfplan\n\n' +
        '$ terraform show -json tfplan | jq -r \'.. | strings\' | grep -c "password"\n' +
        '3',
    mark:['-rw-r--r--','password'],
    note:'A plan file contains resource attributes drawn from state, secrets included — three password strings in this one. World-readable, uploaded as an unprotected artifact, or pasted into a public pull request comment, it is a credential leak. If anything sensitive was ever printed, rotate it rather than hoping nobody read the log.' },

  { out:'{\n' +
        '    "Arn": "arn:aws:sts::111122223333:assumed-role/tf-prod-deploy/run-4472"\n' +
        '}\n\n' +
        '# trust policy condition, corrected:\n' +
        '"token.actions.githubusercontent.com:sub": "repo:org/infra:ref:refs/heads/main"',
    mark:['assumed-role/tf-prod-deploy','refs/heads/main'],
    note:'A short-lived session from a federated role, scoped to one environment, with no stored credential anywhere in the CI system. Delete the old access keys once this works — leaving them means the credential chain can still pick the wrong identity, which is what caused the incident.' }
];

LX.pbOut['tf-state-surgery'] = [
  { out:'$ terraform state pull > backup-20260828-1041.tfstate\n' +
        '$ jq \'.serial, (.resources | length)\' backup-20260828-1041.tfstate\n' +
        '284\n' +
        '61\n\n' +
        '$ aws s3api list-object-versions --bucket tfstate --prefix env/prod/ \\\n' +
        '    --query \'Versions[:3].[VersionId,LastModified]\' --output text\n' +
        '3sL4kqtJlcpXroDTDm  2026-08-28T09:41:22Z\n' +
        'nmZLdE7pbb2yqXk9Fw  2026-08-27T18:02:11Z',
    mark:['backup-20260828-1041.tfstate','3sL4kqtJlcpXroDTDm'],
    note:'A local snapshot and a versioned backend, which are two independent ways back. Bucket versioning is usually the better restore path because it is server-side and timestamped, and it captures states you never pulled. If versioning is off, turn it on before touching anything — the five minutes is trivial against what comes next.' },

  { out:'in state, not real:   aws_instance.old       (terminated 2026-08-20)\n' +
        'real, not in state:   sg-0c4d5e6f            (created by hand)\n' +
        'wrong address:        aws_instance.web[2]    (should be web["worker"])\n\n' +
        '$ terraform plan | tail -1\n' +
        'Plan: 2 to add, 0 to change, 3 to destroy.',
    mark:['in state, not real','real, not in state','wrong address'],
    note:'Three buckets, three different tools, and mixing them up is how surgery goes wrong. In state but not real takes `state rm`; real but not in state takes `import`; wrong address takes `moved` or `state mv` — never remove and re-import, which is two destructive steps where one non-destructive one would do.' },

  { out:'$ terraform state mv -dry-run \'aws_instance.web[2]\' \'aws_instance.web["worker"]\'\n' +
        'Would move "aws_instance.web[2]" to "aws_instance.web[\\"worker\\"]"\n\n' +
        '$ terraform state rm -dry-run aws_instance.old\n' +
        'Would remove aws_instance.old\n' +
        'Destroy the object outside of Terraform? No.',
    mark:['Would move','Would remove'],
    note:'Dry-run on both costs nothing and catches the mistyped address, which is the failure that matters — a wrong destination silently creates an address the configuration does not claim, and the next plan proposes to destroy it. Note what `state rm` says about the object: it stays, unmanaged, which is why it is so often the wrong tool.' },

  { out:'$ terraform plan\n\n' +
        'No changes. Your infrastructure matches the configuration.\n\n' +
        '$ terraform state list | wc -l\n' +
        '60',
    mark:['No changes. Your infrastructure matches the configuration.','wc -l\n60'],
    note:'An empty plan is the only acceptable finish — anything remaining means one of the three buckets still has an entry, and the plan names it. Do not accept "it only wants to change two small things": those are the residue of the surgery, and leaving them means the next person applies them without context.' },

  { out:'# incident notes, 2026-08-28\n' +
        '10:41  terraform state pull > backup-20260828-1041.tfstate\n' +
        '10:52  terraform state mv aws_instance.web[2] aws_instance.web["worker"]\n' +
        '10:55  terraform import aws_security_group.bastion sg-0c4d5e6f\n' +
        '11:02  terraform state rm aws_instance.old   # terminated by hand 2026-08-20\n' +
        '11:04  terraform plan -> No changes',
    mark:['backup-20260828-1041.tfstate','terraform state rm aws_instance.old','No changes'],
    note:'State surgery is invisible in git — nothing in the repository shows that `state rm` was run, so without this record the next person cannot explain why state and history disagree. Each line has a command, a time and a reason, which is the minimum that makes the change auditable.' }
];
