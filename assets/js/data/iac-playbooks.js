/* Terraform & IaC — decision trees. Almost every one of these begins with the
   same instruction: read the plan properly before doing anything, because the
   plan already contains the answer and the panic is what causes the damage.  */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.playbooks = LX.playbooks || [];

LX.playbooks.push(

/* ═══ 1. plan wants to destroy ═══ */
{
  id:'tf-plan-destroy', track:'iac', title:'The plan wants to destroy something nobody changed', cat:'drift', level:'advanced',
  cert:['tf-associate:state','tf-associate:modules'],
  prompt:'"You run a routine plan and it says 14 to destroy. Nobody touched production. What do you do?"',
  say:'"I do not apply, and I do not reach for state commands. The plan already explains itself — Terraform prints a `# forces replacement` comment beside the attribute that caused it, so the first job is to read which attribute and on which resources. Then it is nearly always one of four things: a resource was renamed so the old address is gone, a `count` became a `for_each` and every index changed, a provider version bump changed a default or made an attribute force replacement, or something outside Terraform changed an immutable field. The fix is different for each, and three of the four are fixed in code rather than in state."',
  steps:[
    { check:'What exactly is being destroyed, and why?', cmd:'terraform plan -out=tfplan   ·   terraform show -json tfplan | jq -r \'.resource_changes[] | select(.change.actions|index("delete")) | .address\'',
      decide:'Get the list of addresses, then find the `# forces replacement` line for each.',
      why:'Reading the summary line and panicking is the failure mode; the plan body contains the diagnosis. `show -json` gives you the exact set of addresses rather than a scroll through pages of diff, and the human-readable plan marks the offending attribute with `# forces replacement`. Distinguish a pure delete from `-/+` destroy-and-recreate: the first means the address is gone from the configuration, the second means an immutable attribute changed.',
      branches:[
        { when:'All from one module or resource block', then:'A refactor or a rename. The addresses will tell you which.' },
        { when:'Indexes shift — [0] [1] [2] to keys', then:'A count-to-for_each change. Fix with moved blocks.' },
        { when:'One attribute marked forces replacement across many', then:'A provider default changed, or something edited the real resource.' },
        { when:'Pure delete, no recreate', then:'Those addresses no longer exist in the configuration at all.' } ] },

    { check:'Did the addresses change, or did the resources?', cmd:'terraform state list | head -40   ·   git log --oneline -10 -- \'*.tf\'',
      decide:'Compare the addresses in state against the ones the configuration now produces.',
      why:'A destroy plan almost always means Terraform cannot match a state entry to a configuration block, and that is an addressing problem rather than an infrastructure one. `state list` shows what it currently tracks — positional `[0]` indexes versus keyed `["api"]` ones is usually visible immediately. The git log is the other half: if the addresses changed, somebody changed them, and the commit that did it explains the intent far faster than reading the whole diff.',
      branches:[
        { when:'State has [0] and config now produces keys', then:'count → for_each. moved blocks, one per resource.' },
        { when:'A resource or module was renamed', then:'A moved block for the rename.' },
        { when:'Addresses match exactly', then:'Then it is the resources, not the addresses — check the provider.' },
        { when:'Recent module version bump', then:'The module changed underneath you', goto:'tf-module-version' } ] },

    { check:'Has the provider changed underneath you?', cmd:'terraform version   ·   git diff HEAD~5 -- .terraform.lock.hcl',
      decide:'A provider minor release can change a default or make an attribute force replacement.',
      why:'This is the case where nothing in your code changed and the plan still differs, and it is genuinely confusing until you check. A provider upgrade can introduce a new attribute with a default that does not match reality, or reclassify an existing attribute as requiring replacement. The lock file is the evidence: if `.terraform.lock.hcl` moved in a recent commit, or somebody ran `init -upgrade`, that is your answer and the changelog will name the attribute.',
      branches:[
        { when:'Lock file changed recently', then:'Read the provider changelog for that version range.' },
        { when:'Someone ran init -upgrade', then:'Pin back to the previous version, confirm the plan is clean, then upgrade deliberately.' },
        { when:'Provider unchanged', then:'Something outside Terraform changed the resource', goto:'tf-drift' } ] },

    { check:'Write the fix in code, not in state', cmd:'# moved { from = aws_instance.web[0]  to = aws_instance.web["api"] }   ·   terraform plan',
      decide:'The plan should collapse to no changes. If it does not, an address is wrong.',
      why:'`moved` blocks are declarative, reviewed in a pull request, and applied identically by everyone — where `terraform state mv` is one person\'s local action that nobody can see and every colleague has to repeat. Write one block per moved address, re-plan, and read the result: a clean plan proves the mapping is right. If some resources still show as destroyed, those specific addresses are wrong, and the plan is telling you which ones.',
      branches:[
        { when:'Plan is now empty', then:'Correct. Commit the moved blocks and let CI apply them.' },
        { when:'Some still destroying', then:'Those addresses are wrong. Compare against state list again.' },
        { when:'Tempted to use state rm instead', then:'That abandons live resources and does not fix the mismatch', goto:'tf-state-surgery' } ] },

    { check:'Confirm before anyone applies', cmd:'terraform plan -out=tfplan   ·   terraform show -json tfplan | jq \'[.resource_changes[].change.actions[]] | group_by(.) | map({(.[0]): length}) | add\'',
      decide:'An explicit count per action, agreed by a second person on anything production.',
      why:'End with a number rather than an impression. The action counts are unambiguous, they go in the change record, and they are what a reviewer can check in ten seconds. This is also the moment to add the guard that would have caught it earlier — a CI step that fails when a plan against production contains any delete is a few lines of `jq` and it turns this incident into a blocked pull request.',
      branches:[
        { when:'Zero deletes', then:'Apply the saved plan file, not a fresh plan.' },
        { when:'Deletes remain and are intended', then:'Say so explicitly in the change record, with the addresses.' },
        { when:'Nobody available to review', then:'That is a reason to wait, not a reason to proceed.' } ] } ],
  probes:[
    ['What does `-/+` mean and why does it matter more than `-`?','Destroy and recreate. The resource is replaced, so anything not in state — data on an instance store, an IP address other systems hard-coded, a certificate — is gone. A plain `-` at least means the configuration genuinely no longer wants it.'],
    ['Why does count-to-for_each cause this?','count indexes are positional, so `[0]` is an identity. Changing to for_each replaces those with keys, so every old address disappears and every new one is unrecognised — Terraform sees a full set of deletes and a full set of creates.'],
    ['moved block or terraform state mv?','moved, wherever the version supports it. It is reviewed, repeatable, applies identically for everyone and CI, and it self-documents. state mv is a local action nobody can audit afterwards.'],
    ['When is state rm the right answer here?','Almost never. It removes the resource from state and leaves it running, so you get unmanaged infrastructure *and* the original mismatch. It is for handing a resource to another configuration, not for making a plan look better.']
  ],
  trap:'Applying because "Terraform knows best". It does know — it is telling you the addresses do not match, and applying resolves that by destroying production.',
  remember:'Read the forces-replacement line first. Addresses changed, not resources — and the fix goes in code with moved blocks.'
},

/* ═══ 2. state lock ═══ */
{
  id:'tf-state-lock', track:'iac', title:'Error acquiring the state lock', cat:'state', level:'intermediate',
  cert:['tf-associate:state'],
  prompt:'"CI is stuck on a state lock. Do you force-unlock it?"',
  say:'"Not until I know what the lock is protecting. The error message names who holds it, on which host, and when it was taken, so the first question is whether an apply is still running. If it is, force-unlocking lets a second apply run concurrently against the same state, which is how state gets corrupted — the lock is doing its job. If the process is genuinely dead, the real question is not whether the lock is stale but whether that apply finished, because a half-completed apply with a released lock is a worse position than a stuck one."',
  steps:[
    { check:'Who holds it, and since when?', cmd:'# read the full error   ·   aws dynamodb get-item --table-name tf-locks --key \'{"LockID":{"S":"env/prod/terraform.tfstate"}}\'',
      decide:'Operation, who, which host, and the age of the lock.',
      why:'The error is the investigation and most people skim it. It names the operation — apply or plan — the user, the host or CI run, and the creation time. A lock a few minutes old on an apply almost certainly means somebody is mid-apply right now. Hours old, from a CI runner that no longer exists, is a different situation. Reading the lock record directly from DynamoDB gives the same information when the error has scrolled away.',
      branches:[
        { when:'Minutes old, operation is apply', then:'Somebody is applying. Wait — do not unlock.' },
        { when:'Hours old, from a dead CI job', then:'Probably stale. Establish whether that apply finished first.' },
        { when:'Held by a person who is available', then:'Ask them. Thirty seconds, and it settles it.' },
        { when:'Operation is plan', then:'Lower risk, but still confirm nothing is running.' } ] },

    { check:'Is the process actually gone?', cmd:'# check the CI run status for the job named in the lock   ·   ps aux | grep terraform',
      decide:'A cancelled job is not necessarily a stopped process.',
      why:'A cancelled pipeline job usually kills the runner, but not always immediately — and an apply that is still talking to a provider will keep making changes after the pipeline shows as cancelled. Confirm from the CI system that the job is finished, not merely cancelled. If a person holds the lock and the operation is apply, ask them directly; the cost of asking is far lower than the cost of two concurrent applies.',
      branches:[
        { when:'Job confirmed finished or failed', then:'The lock is stale. Now find out what it changed.' },
        { when:'Job still running', then:'Wait. Add -lock-timeout to the pipeline so it queues instead of failing.' },
        { when:'Cannot tell', then:'Treat it as running. Waiting costs time; concurrent applies cost the state file.' } ] },

    { check:'Did that apply finish, and what did it do?', cmd:'terraform state pull | jq \'.serial, .lineage\'   ·   # compare against the CI log for the cancelled run',
      decide:'The state serial and the job log together tell you how far it got.',
      why:'This is the step that separates a lock incident from a state-corruption incident. An apply that was killed halfway has created some resources and recorded some of them; the serial tells you whether state was written at all, and the job log shows which resources reported complete before it died. Skipping straight to `force-unlock` and re-running is usually survivable, but knowing what happened first is what lets you recognise a partial apply instead of being surprised by it.',
      branches:[
        { when:'Serial advanced and log shows creates', then:'A partial apply. Expect the next plan to show the remainder', goto:'tf-apply-fail' },
        { when:'Serial unchanged', then:'It died before writing. A clean re-run should be safe.' },
        { when:'Cannot read state because of the lock', then:'Read the object from the backend directly — S3 will serve it.' } ] },

    { check:'Unlock, with the id from the error', cmd:'terraform force-unlock 8f2b1c04-…',
      decide:'Only once you have established the holder is dead and you know what it did.',
      why:'The lock id is deliberately not guessable — you have to have read the error, which is the point. Do not add `-force` from a human shell; the confirmation prompt is the last checkpoint. If the backend is S3 with DynamoDB locking, deleting the lock item by hand does the same thing, but going through Terraform leaves a cleaner story for whoever reads this later.',
      branches:[
        { when:'Unlock succeeds', then:'Plan before applying. Never apply straight after an unlock.' },
        { when:'Lock id does not match', then:'Someone else already unlocked, or a new lock was taken. Re-read the error.' },
        { when:'Still locked after unlocking', then:'Another process took it immediately — something is retrying in a loop.' } ] },

    { check:'Plan before anything else, then close the gap', cmd:'terraform plan -out=tfplan   ·   # add -lock-timeout=5m to the pipeline',
      decide:'The plan tells you what the interrupted apply left behind.',
      why:'A plan after an unlock is not optional — it is how you find out whether the previous apply half-finished, and it costs a minute. Then remove the recurrence: `-lock-timeout=5m` makes a pipeline queue behind a lock instead of failing, which is the cause of most of these; and a pipeline that cannot be cancelled mid-apply, or that cleans up after itself, removes the rest.',
      branches:[
        { when:'Plan shows the expected remaining work', then:'Apply it. The interrupted run simply resumes.' },
        { when:'Plan shows unexpected destroys', then:'Stop and diagnose', goto:'tf-plan-destroy' },
        { when:'Plan is empty', then:'The apply completed after all. Nothing to do.' } ] } ],
  probes:[
    ['What does the lock actually protect against?','Two applies writing state concurrently and interleaving their writes, producing a state file that matches neither run and no longer matches reality. That is far harder to recover from than a stuck pipeline.'],
    ['When is force-unlock safe?','When you have confirmed the holding process is dead, and you know what it did before it died. The second half is the part people skip.'],
    ['How do you stop lock contention in CI?','-lock-timeout so jobs queue rather than fail, a concurrency group so only one apply per environment runs at a time, and not letting people apply from laptops against an environment CI owns.'],
    ['The state lock table is missing entirely. What does that mean?','No locking at all — concurrent applies are possible and nothing will warn you. That is a finding to fix before it becomes an incident, and on newer versions the S3 backend can lock natively without DynamoDB.']
  ],
  trap:'force-unlock as a reflex when the pipeline is red. If the apply was still running you now have two writing to one state, which is a much worse outage than a blocked deploy.',
  remember:'The error names the holder. Confirm it is dead, find out what it did, then unlock — and always plan before you apply.'
},

/* ═══ 3. drift ═══ */
{
  id:'tf-drift', track:'iac', title:'Reality and the code disagree', cat:'drift', level:'intermediate',
  cert:['tf-associate:state'],
  prompt:'"A plan shows changes to a resource nobody edited in code. Where did they come from?"',
  say:'"Somebody changed it outside Terraform, or something else owns that attribute. A refresh-only plan separates those two questions from what my code wants — it shows me the divergence between state and reality with no configuration change proposed. Then the decision is which side is right, and it is a real decision: applying normally pushes the code back over reality, which reverts whatever somebody did, possibly for a good reason at 3am. Accepting reality into state enshrines an unreviewed change. So I find out who made it and why before I choose."',
  steps:[
    { check:'What has actually drifted?', cmd:'terraform plan -refresh-only',
      decide:'This shows state versus reality only — no configuration changes proposed.',
      why:'A normal plan mixes two questions together: what changed outside Terraform, and what my code would change. `-refresh-only` isolates the first, so you see the divergence cleanly. That matters because the answers are different — drift is somebody else\'s action and a configuration change is yours, and conflating them is how an emergency fix gets reverted by a routine deploy.',
      branches:[
        { when:'Attributes differ from state', then:'Genuine drift. Find out who and why.' },
        { when:'Nothing drifted', then:'Then the diff is your code, not reality. Read the configuration change.' },
        { when:'A resource is gone entirely', then:'It was deleted outside Terraform. Decide: recreate or remove from code.' } ] },

    { check:'Who changed it, and why?', cmd:'aws cloudtrail lookup-events --lookup-attributes AttributeKey=ResourceName,AttributeValue=… --query \'Events[].[EventTime,EventName,Username]\'',
      decide:'A person in a console, automation, or another Terraform configuration.',
      why:'The answer changes what you do. A person in the console during an incident made a deliberate fix that probably belongs in code. Automation — an autoscaler adjusting capacity, a scanner writing a tag — owns that attribute legitimately and the configuration should stop fighting it with `ignore_changes`. And **another Terraform configuration managing the same resource** is the worst case: two states both believing they own it, each reverting the other on every apply.',
      branches:[
        { when:'A person, during an incident', then:'The change is probably right. Put it in code.' },
        { when:'Automation that owns the attribute', then:'Stop fighting it: lifecycle ignore_changes on that attribute only.' },
        { when:'Another Terraform configuration', then:'Two owners. One of them has to stop', goto:'tf-state-surgery' },
        { when:'Nobody knows', then:'That is its own finding — console write access is too broad.' } ] },

    { check:'Decide which side is right', cmd:'terraform apply -refresh-only   ·   # or a normal apply to push code over reality',
      decide:'Accept reality into state, or reassert the code. Deliberately, not by default.',
      why:'`apply -refresh-only` updates state to match the world and changes nothing live — correct when the manual change was right and you are about to codify it. A normal apply reverts the resource to what the code says — correct when the change was unauthorised or wrong. Doing neither and leaving the drift is the worst option, because the next person to run apply for an unrelated reason makes the choice accidentally on your behalf.',
      branches:[
        { when:'The manual change was right', then:'apply -refresh-only now, then update the code to match.' },
        { when:'The manual change was wrong', then:'Normal apply reverts it — and tell whoever made it.' },
        { when:'Unsure', then:'Do not leave it drifting. Ask the owner; an unresolved drift is a landmine.' } ] },

    { check:'Codify it so the next apply is clean', cmd:'# update the .tf to match, then:   terraform plan',
      decide:'A clean plan is the proof that code and reality now agree.',
      why:'Accepting reality into state without updating the configuration only defers the problem: the next plan proposes to change it back, and now the drift is invisible because state agrees with reality while the code does not. Update the resource arguments to match what is actually there, re-plan, and expect no changes. Where another system genuinely owns the attribute, `ignore_changes` on that specific attribute is the durable answer — never `ignore_changes = all`, which hides every future drift as well.',
      branches:[
        { when:'Plan is empty', then:'Done. Code, state and reality agree.' },
        { when:'Still diffs', then:'The code does not match what you accepted. Read it again.' },
        { when:'Attribute is owned elsewhere', then:'ignore_changes on that attribute alone, with a comment saying why.' } ] },

    { check:'Detect it next time without being told', cmd:'terraform plan -refresh-only -detailed-exitcode   ·   # scheduled, alert on exit 2',
      decide:'Exit code 2 means drift. That is a scheduled job and an alert.',
      why:'Drift found during an incident is expensive; drift found by a nightly job is a ticket. `-detailed-exitcode` returns 2 when there are changes, which makes a scheduled refresh-only plan into a drift alarm in one line of pipeline. The deeper fix is reducing how much drift is possible at all — remove console write access in production, route changes through the pipeline, and give people a read-only role by default with elevation that is time-bound and logged.',
      branches:[
        { when:'Alarm in place', then:'Now reduce the source: console write access in production.' },
        { when:'Drift is frequent and legitimate', then:'The boundary is wrong — that attribute should not be Terraform-managed.' },
        { when:'Drift is frequent and not legitimate', then:'An access problem, not a Terraform problem.' } ] } ],
  probes:[
    ['What is drift, precisely?','Divergence between what state records and what actually exists, caused by a change made outside Terraform. It is not the same as a pending configuration change, which is divergence between code and state.'],
    ['refresh-only apply versus normal apply on drift?','refresh-only accepts reality into state and changes nothing live. A normal apply reverts reality to match the code. Choosing without knowing why the change was made is how an emergency fix gets undone.'],
    ['When is ignore_changes right?','When another system legitimately owns the attribute — an autoscaler on desired capacity, a scanner writing a tag. Scope it to that attribute; ignore_changes = all silences real drift forever.'],
    ['Two Terraform configurations manage one resource. What happens?','They fight: each apply reverts the other, and the resource flaps between two states. One configuration has to give it up — state rm on one side, or a data source instead of a resource.']
  ],
  trap:'Running a normal apply to "clean up" the diff without asking why it exists. That reverts whatever somebody did during an incident, often re-breaking the thing they fixed.',
  remember:'refresh-only separates drift from your changes. Find out who changed it before deciding which side wins.'
},

/* ═══ 4. import ═══ */
{
  id:'tf-import', track:'iac', title:'Adopting infrastructure that already exists', cat:'import', level:'advanced',
  cert:['tf-associate:state'],
  prompt:'"There is a production VPC nobody manages with Terraform. How do you bring it in safely?"',
  say:'"The danger with import is that it writes reality into state but does not write my configuration, so if the two disagree the very next plan proposes to change live infrastructure to match my guess. So the loop is: write configuration, import, plan, and expect the plan to be empty — an empty plan is the proof that my code matches what exists. Import blocks are better than the CLI command because they show up in the plan before anything is written, and `-generate-config-out` will draft the configuration from what is actually there."',
  steps:[
    { check:'What are you adopting, and what is its id?', cmd:'aws ec2 describe-vpcs --query \'Vpcs[].[VpcId,CidrBlock,Tags]\'   ·   terraform state list',
      decide:'The provider\'s own id format, and confirmation it is not already managed.',
      why:'Two cheap checks. Each resource type has its own import id format — a VPC takes `vpc-…`, an IAM policy takes an ARN, an S3 bucket takes its name, and a security group rule takes a compound string — so read the provider documentation rather than guessing. And check it is not already in some other configuration\'s state: importing a resource that another configuration manages creates two owners that will revert each other forever.',
      branches:[
        { when:'Id confirmed, not managed anywhere', then:'Write the configuration first.' },
        { when:'Already in another state', then:'Two owners. Decide which one keeps it', goto:'tf-state-surgery' },
        { when:'Dozens of resources', then:'Use import blocks with -generate-config-out rather than doing it by hand.' } ] },

    { check:'Write the configuration, or generate it', cmd:'import { to = aws_vpc.main  id = "vpc-0a1b2c3d" }   ·   terraform plan -generate-config-out=generated.tf',
      decide:'Generated configuration is a draft, not an answer.',
      why:'Import blocks are declarative: they appear in the plan, they are reviewed like any other change, and they can generate a starting configuration. What comes out of `-generate-config-out` is verbose and includes computed attributes you do not want to manage, so treat it as a first draft to trim rather than something to commit. The CLI `terraform import` still works and writes to state immediately with no plan step, which is exactly why the block form is preferable.',
      branches:[
        { when:'Generated a draft', then:'Trim it: remove computed attributes and anything you do not intend to own.' },
        { when:'Wrote it by hand', then:'Good. The plan will tell you what you got wrong.' },
        { when:'Older Terraform without import blocks', then:'CLI import, one resource at a time, planning after each.' } ] },

    { check:'Plan, and expect nothing', cmd:'terraform plan',
      decide:'An empty plan means the configuration matches reality. Anything else is a mismatch.',
      why:'This is the whole safety mechanism. If the plan proposes changes after an import, your configuration disagrees with what actually exists — and applying would change production to match your guess. Read each proposed change: an attribute you omitted, a default the provider filled in differently, or a tag that exists in reality and not in your code. Fix the configuration until the plan is empty; do not apply your way to agreement.',
      branches:[
        { when:'Plan is empty', then:'Adopted cleanly. Commit it.' },
        { when:'Plan proposes updates', then:'Your configuration is wrong. Fix the code, not the infrastructure.' },
        { when:'Plan proposes replacement', then:'Stop. An immutable attribute disagrees, and applying would destroy production.' },
        { when:'Plan proposes to destroy it', then:'The import did not take, or the address does not match the block.' } ] },

    { check:'Work outwards through the dependencies', cmd:'terraform state list   ·   # import subnets, route tables, gateways in turn',
      decide:'Import the container first, then what sits inside it.',
      why:'A VPC is not one resource; it is a VPC, subnets, route tables, associations, gateways and security groups. Import in dependency order so references resolve as you go, and plan after each batch rather than at the end — a clean plan after five resources localises a mistake to those five, whereas a hundred imports and one messy plan is a long evening. Route table associations and security group rules are the ones with the least obvious import ids.',
      branches:[
        { when:'Each batch plans clean', then:'Keep going. This is the boring, correct way.' },
        { when:'A batch introduces diffs', then:'Fix before importing more, or the cause gets buried.' },
        { when:'Some resources should not be managed', then:'That is a legitimate choice — write down which and why.' } ] },

    { check:'Protect it now that you own it', cmd:'# lifecycle { prevent_destroy = true }   ·   terraform plan -out=tfplan',
      decide:'Newly adopted production resources deserve the seatbelt.',
      why:'The moment infrastructure comes under Terraform management, a mistaken plan can destroy it — which was not true an hour ago. `prevent_destroy` on the VPC, the database and anything holding data makes Terraform refuse rather than comply. Also confirm the state backend is versioned and encrypted before you put production in it, because from now on that file is the record of what exists.',
      branches:[
        { when:'Protections added', then:'Now write down what is managed and what is deliberately not.' },
        { when:'State backend is local', then:'Fix that before importing anything else', goto:'tf-state-lock' },
        { when:'Plan is clean and protected', then:'Done. The next apply is safe to run from CI.' } ] } ],
  probes:[
    ['Why must a plan after import be empty?','Because import records reality in state but does not write your configuration. A non-empty plan means the two disagree, and applying would change live infrastructure to match whatever you guessed.'],
    ['Import block or CLI import?','Blocks. They appear in the plan before anything is written, they are reviewed like any other change, and -generate-config-out drafts the configuration. The CLI command writes state immediately with no plan step.'],
    ['What is the inverse of import?','terraform state rm — it forgets the resource and leaves it running. That is the correct way to hand something back to manual management or to another configuration.'],
    ['You import something two configurations already manage. What happens?','Both believe they own it and each apply reverts the other. Nothing warns you; the resource just flaps. One side has to give it up.']
  ],
  trap:'Applying the non-empty plan that follows an import, because it "just needs to converge". It converges by changing production to match a configuration you wrote from memory.',
  remember:'Configuration first, then import, then a plan that must be empty. Import blocks over the CLI, every time.'
},

/* ═══ 5. apply failed halfway ═══ */
{
  id:'tf-apply-fail', track:'iac', title:'Apply failed halfway through', cat:'core', level:'intermediate',
  cert:['tf-associate:cli','tf-associate:state'],
  prompt:'"An apply errored after creating some resources. Is the state broken?"',
  say:'"Almost certainly not. Terraform writes state as it goes, so everything it created before the error is recorded — the state is consistent with what exists, it is just incomplete relative to the plan. So the answer is usually to fix the cause and re-run, and the plan will show only the remainder. What breaks that assumption is a resource that was created but whose id Terraform never received, which leaves an orphan the next apply will try to create again. That is the case worth checking for by name."',
  steps:[
    { check:'Read the error, and how far it got', cmd:'# the apply output names the failing resource and the provider error   ·   terraform state list | wc -l',
      decide:'Which resource failed, why, and how many were created before it.',
      why:'The provider error is usually specific and actionable — a quota, a name collision, an insufficient permission, a dependency that was not ready. Terraform also prints how many resources were added before the failure. Resist re-running immediately: if the cause is a quota or a permission, the second run fails identically and you have burned another few minutes and possibly created more partial state.',
      branches:[
        { when:'A quota or limit error', then:'Raise the quota first; re-running changes nothing.' },
        { when:'A permission error', then:'Fix the role. Note which action — it will be needed again.' },
        { when:'Name or address already exists', then:'Something exists that state does not know about — an orphan.' },
        { when:'A timeout', then:'Often transient. Re-plan and look before re-running.' } ] },

    { check:'What does state now think exists?', cmd:'terraform plan',
      decide:'The plan shows the remainder — what was not created.',
      why:'This is the reassuring step and it is the one people skip in favour of re-running. State is written incrementally, so the resources that succeeded are recorded and the plan proposes only what is left. A plan that matches the outstanding work confirms state is healthy and the failure was ordinary. A plan proposing to recreate something you can see exists is the orphan case, and that needs different handling.',
      branches:[
        { when:'Plan shows only the remaining work', then:'State is fine. Fix the cause and apply.' },
        { when:'Plan wants to recreate something that exists', then:'An orphan — created but not recorded.' },
        { when:'Plan wants to destroy things', then:'Different problem entirely', goto:'tf-plan-destroy' },
        { when:'Cannot plan because of a lock', then:'The failed run may still hold it', goto:'tf-state-lock' } ] },

    { check:'Deal with the orphan, if there is one', cmd:'# find it in the provider, then:   import { to = ADDRESS  id = "…" }',
      decide:'Import it, or delete it by hand. Do not let the next apply collide with it.',
      why:'An orphan happens when a resource is created and the process dies before the id is written to state — rarer than people fear, but real. The next apply tries to create it again and fails on a name collision, which is confusing until you know to look. Importing it is usually right: the resource exists, it is what you wanted, and importing brings it under management. Deleting it by hand is fine for something cheap and stateless.',
      branches:[
        { when:'Resource exists and is correct', then:'Import it, then plan and expect nothing.' },
        { when:'Resource is half-created or broken', then:'Delete it in the provider and let Terraform create it properly.' },
        { when:'No orphan', then:'Good. Fix the original cause and re-run.' } ] },

    { check:'Resist -target', cmd:'terraform apply   # rather than: terraform apply -target=…',
      decide:'A normal apply finishes the job. -target is for recovery, not for routine work.',
      why:'`-target` is tempting after a partial failure because it looks surgical, and Terraform itself warns that it is intended for exceptional recovery. It skips the dependency graph, so it can create a resource whose dependencies are not ready and leave state consistent-looking but wrong. Worse, it becomes a habit — and a team that routinely targets has a configuration nobody can apply as a whole, which is discovered at the worst possible moment.',
      branches:[
        { when:'Full apply works', then:'That is the answer. It was only ever the remainder.' },
        { when:'Full apply is genuinely blocked', then:'Target the specific unblocking resource, then run a full apply immediately.' },
        { when:'Targeting has become normal', then:'That is the finding. The configuration cannot be applied as a whole.' } ] },

    { check:'Make the failure cheaper next time', cmd:'terraform plan -out=tfplan   ·   # then apply the artifact in CI',
      decide:'A clean full plan and apply is the proof that the incident is closed.',
      why:'Finish by proving a whole apply runs, not just the piece you were fixing — a configuration that only works in fragments is a future outage. Then remove the cause: if it was a quota, alarm on quota utilisation; if it was a permission, the CI role needed it and now does; if it was ordering, an explicit `depends_on` where the graph could not infer it. And apply saved plan files from CI, so the thing that runs is the thing that was reviewed.',
      branches:[
        { when:'Full apply clean', then:'Closed. Record what the cause was — it recurs.' },
        { when:'Still failing on the same resource', then:'The cause was not what you thought. Back to the provider error.' },
        { when:'Only works with -target', then:'A real defect in the configuration. Fix it now, not later.' } ] } ],
  probes:[
    ['Does a failed apply corrupt state?','Rarely. Terraform writes as it goes, so what was created is recorded and state is consistent with reality — just incomplete relative to the plan. Re-running usually resumes.'],
    ['What is an orphan?','A resource created in the provider whose id never reached state, because the process died in between. The next apply tries to create it again and collides. Import it or delete it.'],
    ['Why is -target discouraged?','It bypasses the dependency graph, so it can build things out of order and leave state that looks fine and is not. Terraform documents it as an exceptional recovery tool, and using it routinely hides a configuration that cannot be applied whole.'],
    ['Apply failed and the lock is still held. What now?','Confirm the process is dead, work out how far it got from the state serial and the log, then force-unlock and plan. The plan is what tells you what the interrupted run left behind.']
  ],
  trap:'Reaching for `state rm` on the half-created resources to "start clean". That abandons live infrastructure and leaves you with orphans and a bill.',
  remember:'State is written incrementally, so plan first — it shows the remainder. Fix the cause, re-run whole, and keep -target for recovery.'
},

/* ═══ 6. module version ═══ */
{
  id:'tf-module-version', track:'iac', title:'A module bump broke an environment', cat:'providers', level:'intermediate',
  cert:['tf-associate:modules','tf-associate:providers'],
  prompt:'"Staging deployed fine, the same commit in production plans a replacement. Nothing else differs. Why?"',
  say:'"Something resolved differently between the two runs. The candidates are a module reference that is not pinned, a provider version constraint that allowed a newer release, and a lock file that is out of date in one place and not the other. All three produce the same symptom: identical code, different plan. The lock file and the module source line answer it in about a minute, and the fix is always pinning rather than re-running until it works."',
  steps:[
    { check:'Is the module actually pinned?', cmd:'grep -rn "source\\s*=" *.tf   ·   grep -rn "version\\s*=" *.tf',
      decide:'A registry module needs `version`; a git module needs `?ref=` a tag.',
      why:'`version` only applies to registry sources — for a git source the pin lives in the `ref`, and `ref=main` means the module can change between two applies with no diff in your repository to explain it. That is the single most confusing failure in a shared module estate. A missing pin in either form means the two environments almost certainly resolved different module code, which is enough to explain everything.',
      branches:[
        { when:'ref=main or no version', then:'Unpinned. That is the cause until proven otherwise.' },
        { when:'Pinned to a tag or exact version', then:'The module is fixed — check the provider next.' },
        { when:'A loose constraint like >= 5.0', then:'Loose enough for a minor release to land between runs.' } ] },

    { check:'Did the provider version move?', cmd:'terraform version   ·   git diff -- .terraform.lock.hcl   ·   terraform providers',
      decide:'Compare the resolved provider versions between the two environments.',
      why:'The lock file exists exactly to stop this: it pins providers to precise versions with checksums so every run resolves identically. If it is committed and unchanged, providers are not the cause. If it moved recently, or one environment ran `init -upgrade`, that is your difference — and a provider minor release can change a default or reclassify an attribute as forcing replacement, which shows up as an unexplained diff.',
      branches:[
        { when:'Lock file differs between environments', then:'That is it. Make both use the same committed lock.' },
        { when:'Someone ran init -upgrade', then:'Pin back, confirm the plan is clean, then upgrade deliberately.' },
        { when:'Lock file identical', then:'Then it is inputs, not versions — compare the variables.' },
        { when:'Lock file is gitignored', then:'A configuration error. It is meant to be committed.' } ] },

    { check:'What actually changed in the module?', cmd:'git -C ~/src/tf-modules log --oneline v2.3.0..v2.4.0   ·   # or the registry changelog',
      decide:'A changed default, a renamed resource, or a new attribute forcing replacement.',
      why:'Reading the diff between the two module versions turns "it broke" into a specific attribute. The three common culprits are a default value that changed, a resource renamed inside the module — which changes the address and so proposes a replacement — and a new argument whose default does not match what exists. If the module renamed something, the module should have shipped a `moved` block, and its absence is a bug worth reporting upstream.',
      branches:[
        { when:'A default changed', then:'Set it explicitly in your configuration and the diff disappears.' },
        { when:'A resource was renamed inside the module', then:'It needs a moved block', goto:'tf-plan-destroy' },
        { when:'A new required argument', then:'Supply it; the plan should then be clean.' },
        { when:'Nothing relevant in the changelog', then:'Compare inputs between environments instead.' } ] },

    { check:'Are the inputs the same?', cmd:'diff <(terraform -chdir=env/stg console <<< "var.instance_type") <(terraform -chdir=env/prod console <<< "var.instance_type")   ·   diff env/stg.tfvars env/prod.tfvars',
      decide:'The variable that differs may be the whole explanation.',
      why:'If versions are identical, the difference is inputs — and variable precedence hides it: `-var` beats `-var-file` beats a `TF_VAR_` environment variable beats the default. A pipeline that sets `TF_VAR_` for one environment and not the other produces exactly this symptom and nothing in the repository shows it. Diff the tfvars files, then check the pipeline environment.',
      branches:[
        { when:'A tfvars value differs', then:'Expected, or a mistake? That is the question to answer.' },
        { when:'TF_VAR_ set in one pipeline only', then:'Found it. Make the environments symmetrical.' },
        { when:'Inputs identical', then:'Then it is state — the environments diverged earlier.' } ] },

    { check:'Pin it and prove the two agree', cmd:'# version = "~> 5.1.0" or ?ref=v2.3.0, commit the lock file   ·   terraform init -upgrade=false && terraform plan',
      decide:'Both environments, same commit, same plan.',
      why:'The fix is always pinning, never re-running until it works. Pin the module to an exact tag, keep `.terraform.lock.hcl` committed, and re-plan both environments from the same commit — they should now agree. Then make module upgrades a deliberate, reviewed change: bump the pin in a pull request, read the plan for every environment, and roll forward one at a time rather than discovering the difference in production.',
      branches:[
        { when:'Both environments plan identically', then:'Fixed. Now upgrade the pin deliberately.' },
        { when:'Still different', then:'Something else differs — state, credentials, or region.' },
        { when:'Upgrading anyway', then:'Non-production first, read every plan, and expect the diff you saw.' } ] } ],
  probes:[
    ['What does .terraform.lock.hcl do and should it be committed?','It pins provider versions and their checksums so every machine and CI resolve identically. Yes — it is meant to be committed. Gitignoring it reintroduces exactly the drift it prevents.'],
    ['Why is ref=main on a module source dangerous?','The module can change between two applies with nothing in your repository to explain it. Identical code, different plan, and no diff to review.'],
    ['Checksums do not match after adding a colleague on a different platform. Why?','The lock file only has hashes for the platforms it was generated on. `terraform providers lock -platform=…` for each platform you support. Deleting the lock file is the wrong fix.'],
    ['How should a module upgrade be done?','Bump the pin in a pull request, plan every environment against it, apply to non-production first, and read each plan for replacements. Never let a module float and discover the change in production.']
  ],
  trap:'Deleting the lock file or running `init -upgrade` until the error goes away. That resolves whatever is newest today and guarantees a different answer tomorrow.',
  remember:'Identical code with different plans means something is unpinned. Module ref, provider lock, or an input the pipeline sets for one environment only.'
},

/* ═══ 7. auth in CI ═══ */
{
  id:'tf-auth', track:'iac', title:'Terraform cannot authenticate in the pipeline', cat:'ci', level:'intermediate',
  cert:['aws-sec:identity-and-access','tf-associate:providers'],
  prompt:'"The pipeline worked yesterday and today Terraform cannot authenticate. Where do you look?"',
  say:'"First which identity it is actually using, because the provider chain has several sources and they override each other silently — environment variables beat a profile, and an assumed role beats both. Then whether it is authentication or authorisation: a credential failure and a permission denial get reported the same way and land in completely different places. And when nothing changed, something expired: a stored access key, an OIDC trust condition that no longer matches after a repository rename, or a session that is shorter than the apply."',
  steps:[
    { check:'Which identity is it actually using?', cmd:'aws sts get-caller-identity   ·   env | grep -E "AWS_|TF_VAR_|ARM_" | sed \'s/=.*/=***/\'',
      decide:'Compare the ARN against the role the pipeline is supposed to assume.',
      why:'The provider resolves credentials through a chain and the winner is often not what the configuration says: explicit provider arguments, then environment variables, then a shared profile, then an instance or container role. A leftover `AWS_ACCESS_KEY_ID` in the runner environment silently beats the OIDC role the pipeline just assumed. Print the variable names without their values — that is enough to see which source is in play, and it does not put a secret in a build log.',
      branches:[
        { when:'Not the expected role', then:'Something in the chain is overriding. Find and remove it.' },
        { when:'The expected role', then:'Identity is right — so this is permissions or region.' },
        { when:'No identity at all', then:'The credential never resolved. Check the OIDC or secret step.' } ] },

    { check:'Authentication or authorisation?', cmd:'# read the full provider error   ·   terraform plan 2>&1 | tail -20',
      decide:'"Could not load credentials" is authentication. "not authorized to perform" is permissions.',
      why:'They get reported identically by people and they are different investigations. A credential failure means the provider never established an identity — an expired key, a malformed OIDC trust, a missing environment variable. An `AccessDenied` naming an action means the identity is fine and the role lacks a permission, and the error names which action, which is exactly what you need to fix it properly rather than by widening.',
      branches:[
        { when:'Could not load credentials', then:'Authentication. The credential source is broken.' },
        { when:'not authorized to perform: <action>', then:'Permissions. Add that action', goto:'tf-apply-fail' },
        { when:'ExpiredToken mid-apply', then:'The session is shorter than the apply takes.' },
        { when:'Region errors', then:'A missing AWS_REGION or provider region — very common after a runner change.' } ] },

    { check:'Did something expire?', cmd:'aws iam list-access-keys --user-name ci --query \'AccessKeyMetadata[].[AccessKeyId,Status,CreateDate]\'   ·   # check the OIDC trust condition',
      decide:'Keys, certificates, OIDC subject conditions and session durations all expire or stop matching.',
      why:'"Nothing changed" almost always means something expired or a name moved. A stored access key was rotated or disabled. An OIDC trust policy conditions on `token.actions.githubusercontent.com:sub` with the repository and branch — rename the repository, move to a tag-triggered workflow, or change the default branch and the condition silently stops matching. And a role with a one-hour maximum session will fail mid-apply on a large estate, which looks like a random failure until you notice the timing.',
      branches:[
        { when:'Access key expired or rotated', then:'Replace it — and take the opportunity to move to OIDC.' },
        { when:'OIDC sub condition no longer matches', then:'The repository, branch or workflow moved. Update the trust policy.' },
        { when:'ExpiredToken partway through', then:'Raise MaxSessionDuration or split the apply.' },
        { when:'Nothing expired', then:'Then it is the chain or the permissions.' } ] },

    { check:'Is the credential leaking anywhere?', cmd:'terraform plan -no-color -out=tfplan   ·   # confirm the plan artifact is not public',
      decide:'Plan files and logs both contain values from state.',
      why:'This is the step nobody thinks of during an auth incident and it is the cheapest moment to check. A plan file contains resource attributes including secrets, so an artifact uploaded without access control is a leak; a plan posted verbatim into a public pull request comment is the same leak with more readers. Provider debug logging is worse again — `TF_LOG=DEBUG` prints request headers. If a credential was ever printed, rotate it rather than hoping.',
      branches:[
        { when:'Plan artifact is unprotected', then:'Fix that now. It contains state values, secrets included.' },
        { when:'TF_LOG left on', then:'Turn it off and rotate anything that appeared in a log.' },
        { when:'Secrets in tfvars in the repository', then:'Rotate and move to a secret store', goto:'tf-state-surgery' } ] },

    { check:'Remove the class of failure', cmd:'# OIDC trust with a role, no stored keys   ·   aws sts get-caller-identity',
      decide:'Short-lived credentials from a federated role, scoped per environment.',
      why:'OIDC removes stored cloud credentials from the CI system entirely: the pipeline presents a signed token, the role trusts that issuer with a condition on the repository and branch, and the credential is short-lived and cannot be exfiltrated to a laptop. Scope one role per environment so the staging pipeline cannot touch production, and make that role the only identity with write access — which also solves applying-from-a-laptop, because it becomes impossible rather than discouraged.',
      branches:[
        { when:'OIDC in place', then:'Delete the stored keys. Leaving them defeats the point.' },
        { when:'Keys still needed somewhere', then:'Scope them tightly and alarm on their use.' },
        { when:'One role for every environment', then:'Split it. Blast radius is the whole argument.' } ] } ],
  probes:[
    ['What is the AWS provider credential chain?','Explicit provider arguments, then environment variables, then the shared credentials file and profile, then an instance or container role. Higher entries win silently, which is why a leftover environment variable beats the profile you passed.'],
    ['Why OIDC instead of stored access keys?','No long-lived credential exists to leak. The pipeline exchanges a signed token for a short-lived role session, and the trust policy conditions on repository and branch so another repository cannot assume it.'],
    ['ExpiredToken halfway through a large apply. Fix?','The role session is shorter than the apply. Raise MaxSessionDuration, or split the configuration so no single apply runs that long — which is usually the better answer anyway.'],
    ['Why protect a plan file?','It contains resource attributes drawn from state, including secrets. An unprotected artifact or a plan pasted into a public comment is a credential leak, and both happen routinely.']
  ],
  trap:'Widening the CI role to Administrator to get past an AccessDenied. The pipeline is the most attractive identity in the account, and the change is never revisited.',
  remember:'Identity first, then authentication versus authorisation, then what expired. And plan files contain secrets.'
},

/* ═══ 8. state surgery ═══ */
{
  id:'tf-state-surgery', track:'iac', title:'State and reality have diverged badly', cat:'state', level:'advanced',
  cert:['tf-associate:state'],
  prompt:'"State thinks resources exist that do not, and vice versa. How do you get back to a clean plan?"',
  say:'"Carefully, with a backup, and with a written record of every command. State surgery is a last resort because there is no undo on `state rm` and a mistyped address makes things worse silently. So: back up state first, establish exactly which resources are in which of the three categories — in state and not real, real and not in state, in state under the wrong address — and then use the narrowest tool for each. `import` for real-but-untracked, `moved` or `state mv` for wrong-address, and `state rm` only for things that are genuinely gone or genuinely someone else\'s."',
  steps:[
    { check:'Back up before anything', cmd:'terraform state pull > backup-$(date +%Y%m%d-%H%M).tfstate   ·   aws s3api list-object-versions --bucket tfstate --prefix env/prod/',
      decide:'A local copy, and confirmation the backend has versioning.',
      why:'One command, and it is the difference between a recoverable mistake and a rebuilt environment. `state pull` gives you a local snapshot; bucket versioning gives you every prior version with a timestamp, which is usually the better restore path because it is server-side and tamper-evident. If versioning is off, turn it on before touching anything — the five minutes it takes is trivial against what you are about to do.',
      branches:[
        { when:'Backup taken and versioning on', then:'Proceed. You have a way back.' },
        { when:'Versioning is off', then:'Enable it first. This is not the moment to be without it.' },
        { when:'Cannot pull because of a lock', then:'Resolve the lock properly first', goto:'tf-state-lock' } ] },

    { check:'Sort the divergence into three buckets', cmd:'terraform state list > in-state.txt   ·   aws ec2 describe-instances --query \'Reservations[].Instances[].InstanceId\' > real.txt   ·   terraform plan',
      decide:'In state but not real; real but not in state; in state under the wrong address.',
      why:'Each bucket has a different tool and mixing them up is how surgery goes wrong. **In state, not real** — the resource was deleted outside Terraform, so `state rm` is correct or a plan will simply recreate it. **Real, not in state** — `import`. **Wrong address** — `moved` or `state mv`, never `rm` and re-import, because that is two destructive steps where one non-destructive one would do. Write the list down; do not hold it in your head.',
      branches:[
        { when:'In state, not real', then:'state rm, or let the plan recreate it if you want it back.' },
        { when:'Real, not in state', then:'import', goto:'tf-import' },
        { when:'Wrong address', then:'moved block, or state mv with -dry-run first.' },
        { when:'Two configurations own the same resource', then:'One must give it up. That is the real fix.' } ] },

    { check:'Use the narrowest tool, one at a time', cmd:'terraform state mv -dry-run OLD NEW   ·   terraform state rm -dry-run ADDRESS',
      decide:'Dry-run everything, and plan between each change rather than at the end.',
      why:'`-dry-run` on both `mv` and `rm` costs nothing and catches the mistyped address, which is the failure that matters — a wrong destination silently creates an address the configuration does not claim, and the next plan proposes to destroy it. Planning after each individual change localises a mistake to that change; doing ten operations and then one messy plan is how a two-hour job becomes a two-day one.',
      branches:[
        { when:'Dry-run looks right', then:'Do it, then plan immediately.' },
        { when:'Plan gets worse after a step', then:'Stop. Restore the backup and rethink.' },
        { when:'Tempted to batch ten commands', then:'Do not. One at a time, plan between.' } ] },

    { check:'Drive to an empty plan', cmd:'terraform plan',
      decide:'Empty plan means code, state and reality finally agree.',
      why:'The empty plan is the only acceptable finish. Anything remaining means one of the three buckets still has an entry, and the plan names it. Do not accept "the plan only wants to change two small things" — those two things are the residue of the surgery, and leaving them means the next person applies them without context. Where a genuine change is wanted, make it a separate, reviewed commit rather than folding it into the repair.',
      branches:[
        { when:'Empty plan', then:'Done. Now write down what you did.' },
        { when:'Still proposing changes', then:'Read them — each one names a resource still in the wrong bucket.' },
        { when:'Proposing destroys', then:'Stop and diagnose properly', goto:'tf-plan-destroy' } ] },

    { check:'Write it down, and stop it recurring', cmd:'# record every command run, in order, in the incident notes   ·   # then: who has console write access?',
      decide:'The record is part of the work, not paperwork after it.',
      why:'State surgery is invisible in git — nothing in the repository shows that `state rm` was run, so without a written record the next person cannot explain why state and history disagree. Record the commands in order, with the reason. Then address the cause: divergence at this scale almost always means people can change infrastructure outside Terraform, so the durable fixes are removing console write access in production, routing changes through the pipeline, and a scheduled refresh-only drift alarm.',
      branches:[
        { when:'Recorded', then:'Now reduce console write access. That is the actual cause.' },
        { when:'Caused by two configurations owning one resource', then:'Split ownership properly; it will recur otherwise.' },
        { when:'Caused by an emergency console fix', then:'Fine — but it needs a path back into code, and a drift alarm.' } ] } ],
  probes:[
    ['Why is state rm so dangerous?','There is no undo, it leaves the resource running and unmanaged, and it is usually reached for to silence a plan rather than to fix the mismatch the plan was reporting.'],
    ['How do you recover from a bad state operation?','Restore from the state pull backup you took first, or from the backend bucket version history. Without either, you are reconstructing state by importing every resource by hand.'],
    ['What is lineage and why does it matter?','A unique id for the state file\'s history. Two states with different lineage are unrelated, not two versions of one — which is why terraform state push refuses to overwrite across lineages unless forced.'],
    ['How do you avoid needing state surgery at all?','Remove console write access in production, make the pipeline the only identity that can apply, run a scheduled refresh-only drift check, and never let two configurations manage the same resource.']
  ],
  trap:'Batching a dozen state commands and planning once at the end. When the plan is wrong you cannot tell which command caused it, and the backup is now several steps behind.',
  remember:'Back up first, sort into three buckets, dry-run everything, plan between each step, and write down what you did.'
}

);
