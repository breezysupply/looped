/* Terraform & IaC labs. Both are incidents where the obvious action destroys
   something: applying a plan that "must be right", and force-unlocking a lock
   that is doing its job.                                                    */
window.LX = window.LX || {};
LX.labs = LX.labs || [];

LX.labs.push(

/* ───────────────────────────── 1. the destroy plan ── */
{
  id:'iac-l-destroy', title:'The production plan says 14 to destroy', cat:'drift',
  track:'iac', level:'advanced', mins:10,
  brief:'09:20. A routine deploy to production. The pipeline posted its plan on the pull request and it reads "14 to add, 0 to change, 14 to destroy" — every application instance and both databases. The change in the pull request is a small refactor somebody did on Friday. Staging applied cleanly yesterday.',
  user:'you', host:'terraform',
  steps:[
    { kind:'think',
      ask:'Fourteen destroys and fourteen adds of the same resources. Before running anything, what does that pattern suggest?',
      hint:'Compare the two numbers rather than reading the first one.',
      opts:[
        { t:'A reindex — the addresses changed, so Terraform sees every old one disappear and every new one arrive', ok:true,
          fb:'Right, and the symmetry is the tell. A genuine deletion has no matching creates; equal counts of the same resource types means Terraform cannot match state entries to configuration blocks. That reframes the whole incident: this is an addressing problem in code, not fourteen resources that need destroying.' },
        { t:'Somebody deleted the resources outside Terraform and it is recreating them',
          fb:'Then they would show only as creates — Terraform would have refreshed and found them gone. Destroys in a plan mean state still believes they exist.' },
        { t:'The state file was lost, so Terraform wants to rebuild everything',
          fb:'A lost state produces creates only, with nothing to destroy. Fourteen destroys means state is present and full.' },
        { t:'A provider downgrade reverted the resource schema',
          fb:'A provider change usually shows as `-/+` replacements with a `# forces replacement` comment on a specific attribute, not as separate destroy and create entries at different addresses.' }
      ] },

    { kind:'cmd',
      ask:'Get the specifics. What do you run?',
      hint:'You want the addresses and the reason, not a scroll through the diff.',
      opts:[
        { c:'terraform show -json tfplan | jq -r \'.resource_changes[] | select(.change.actions|index("delete")) | .address\'', ok:true,
          out:'aws_instance.web[0]\naws_instance.web[1]\naws_instance.web[2]\nmodule.data.aws_db_instance.main[0]\nmodule.data.aws_db_instance.main[1]\n… 14 total',
          fb:'Positional indexes on everything being destroyed. That is the shape of a count-based address, and it lines up with the reindex theory in one command instead of a page of diff.',
          parts:[['show -json tfplan','The plan as structured data, so you can query it instead of reading it'],['select(.change.actions|index("delete"))','Only the resources being destroyed'],['.address','The addresses, which are the vocabulary of every fix that follows']] },
        { c:'terraform plan',
          out:'Plan: 14 to add, 0 to change, 14 to destroy.\n\n  # aws_instance.web[0] will be destroyed\n  # (because index [0] is out of range for count)\n  …',
          fb:'This does contain the answer — the parenthetical explains it outright. It also re-plans against a live state and gives you pages to scroll; querying the saved plan is faster and gives you the exact set.' },
        { c:'terraform state list',
          out:'aws_instance.web[0]\naws_instance.web[1]\naws_instance.web[2]\nmodule.data.aws_db_instance.main[0]\n… 61 total',
          fb:'You will want this in a moment for the comparison. On its own it shows what state tracks without showing what the plan intends, so it is half the picture.' },
        { c:'terraform apply tfplan',
          out:'(applying…)',
          fb:'You have destroyed both production databases and every application instance to resolve a discrepancy you had not diagnosed. The plan was reporting a mismatch, not requesting one.' }
      ] },

    { kind:'cmd',
      ask:'Why are those addresses out of range? Find what changed.',
      hint:'The pull request is a refactor. Read what it refactored.',
      opts:[
        { c:'git log --oneline -3 -- \'*.tf\' && git show --stat HEAD', ok:true,
          out:'9f2c4a1 refactor: key instances by role instead of position\n3b81e7d chore: bump provider constraint\n\n main.tf | 12 ++++------\n\n-  count         = length(var.roles)\n+  for_each      = { for r in var.roles : r.name => r }',
          fb:'There it is, in the commit that is in this pull request. Moving from `count` to `for_each` replaces every positional address with a keyed one, so all fourteen old addresses vanish and fourteen new ones appear. The refactor is correct; what is missing is the migration.',
          parts:[['git log -- \'*.tf\'','Scope the history to Terraform files so unrelated commits do not obscure it'],['count → for_each','The mechanism: positional addresses become keyed ones, and every address changes']] },
        { c:'terraform state list | grep aws_instance',
          out:'aws_instance.web[0]\naws_instance.web[1]\naws_instance.web[2]',
          fb:'Confirms state holds positional addresses, which supports the theory. It does not tell you what changed or when, and the commit that did it explains the intent much faster.' },
        { c:'git diff HEAD~5 -- .terraform.lock.hcl',
          out:'(no output)',
          fb:'A sensible check and it rules the provider out — the lock file has not moved. Worth doing, but the resource block itself is the more likely place given the pull request is a refactor.' },
        { c:'terraform state pull | jq \'.serial\'',
          out:'284',
          fb:'The serial tells you how many times state has been written and nothing about why the addresses changed. Useful before surgery; not diagnostic here.' }
      ] },

    { kind:'think',
      ask:'Staging applied this same commit cleanly yesterday. How?',
      hint:'What is different about the two environments, given the code is identical?',
      opts:[
        { t:'Staging was rebuilt recently, so its state already had keyed addresses and there was nothing to migrate', ok:true,
          fb:'Exactly, and it is the reason nobody caught this. An environment created after the refactor never had positional addresses, so the plan was clean and everyone concluded the change was safe. Long-lived production state is the one carrying the old addresses — which is a good argument for testing changes against a copy of production state rather than a fresh environment.' },
        { t:'Staging uses a different module version',
          fb:'The lock file and the module pin are identical — you checked. And a module version difference would show as a different kind of diff, not as an absence of one.' },
        { t:'Staging has fewer resources so the reindex did not matter',
          fb:'A reindex affects every resource in the block regardless of how many there are. One instance would have shown one destroy and one create.' },
        { t:'The staging pipeline runs with -refresh=false',
          fb:'That would change whether drift is detected, not whether addresses match. Address mismatches come from state versus configuration, which refreshing does not affect.' }
      ] },

    { kind:'cmd',
      ask:'Write the fix. What goes in the code?',
      hint:'Declarative, reviewable, and applied identically by everyone.',
      opts:[
        { c:'# moved { from = aws_instance.web[0]  to = aws_instance.web["api"] }  … one per resource\nterraform plan', ok:true,
          out:'  # aws_instance.web["api"] has moved to aws_instance.web["api"]\n  # module.data.aws_db_instance.main["primary"] has moved to …\n\nPlan: 0 to add, 0 to change, 0 to destroy.',
          fb:'The plan collapses to nothing, which is the proof that every address mapping is right. `moved` blocks are reviewed in the pull request, applied identically by CI and by every colleague, and self-documenting — none of which is true of a local state command.',
          parts:[['moved { from = … to = … }','Declarative address migration; it lives in the code and gets reviewed'],['has moved to','Terraform reports each move explicitly, so a partial fix is visible'],['0 to add, 0 to change, 0 to destroy','The only acceptable outcome — anything else means an address is wrong']] },
        { c:'terraform state mv \'aws_instance.web[0]\' \'aws_instance.web["api"]\'  # ×14',
          out:'Move "aws_instance.web[0]" to "aws_instance.web[\\"api\\"]"\nSuccessfully moved 1 object(s).',
          fb:'It works and it produces the same state. The cost is that nobody can see it: it is not in the pull request, CI did not do it, and every colleague with a checkout has to be told to run the same fourteen commands. `moved` blocks solve all of that.' },
        { c:'terraform state rm \'aws_instance.web[0]\' && terraform import \'aws_instance.web["api"]\' i-0a1b2c3d',
          out:'Removed aws_instance.web[0]\nImport successful!',
          fb:'Two destructive steps where one non-destructive one would do, times fourteen — and between the `rm` and the `import` the resource is unmanaged, so anyone applying in that window destroys nothing but sees a very confusing plan.' },
        { c:'git revert 9f2c4a1',
          out:'[main 4d1e8a2] Revert "refactor: key instances by role instead of position"',
          fb:'A legitimate emergency option that restores the old addresses and makes the plan clean. It also throws away a correct refactor, and the next person to attempt it hits exactly the same wall with no record of why it was reverted.' }
      ] },

    { kind:'cmd',
      ask:'Confirm before anyone applies. What is the check?',
      hint:'End with a number a reviewer can verify in ten seconds.',
      opts:[
        { c:'terraform plan -out=tfplan && terraform show -json tfplan | jq \'[.resource_changes[].change.actions[]] | group_by(.) | map({(.[0]): length}) | add\'', ok:true,
          out:'{\n  "no-op": 61\n}',
          fb:'Sixty-one no-ops and no other key — no creates, no deletes, nothing. That single object is what goes in the change record, and it is unambiguous in a way that "the plan looks fine" is not.',
          parts:[['plan -out=tfplan','Save it, so the thing reviewed is the thing applied'],['group_by(.) | map(…) | add','A count per action across the whole plan'],['"no-op": 61','Every tracked resource is unchanged — the moved blocks did exactly their job']] },
        { c:'terraform plan | tail -1',
          out:'No changes. Your infrastructure matches the configuration.',
          fb:'Correct and readable, and it is the right sanity check. The JSON counts are better for a change record because they cannot be misread and a pipeline can assert on them.' },
        { c:'terraform state list | wc -l',
          out:'61',
          fb:'Confirms the resource count is unchanged, which is reassuring. It says nothing about what the plan intends to do next, which is the thing being reviewed.' },
        { c:'terraform apply -auto-approve',
          out:'(applying…)',
          fb:'Even with the fix correct, applying without a saved plan re-plans against whatever the world looks like now — and `-auto-approve` on production from a shell removes the last checkpoint. Apply the artifact through the pipeline.' }
      ] },

    { kind:'cmd',
      ask:'Stop this reaching a production plan again.',
      hint:'The pipeline already has the plan as JSON.',
      opts:[
        { c:'# CI step:\nterraform show -json tfplan | jq -e \'[.resource_changes[] | select(.change.actions|index("delete"))] | length == 0\'', ok:true,
          out:'false\n$ echo $?\n1',
          fb:'A gate that fails the build whenever a production plan contains any delete. It is three lines, it turns this incident into a blocked pull request with a visible reason, and it needs a deliberate override rather than a judgement call at 09:20.',
          parts:[['jq -e','Sets the exit status from the result, so the pipeline step fails'],['select(.change.actions|index("delete"))','Any resource being destroyed, including as part of a replacement'],['length == 0','The assertion — no deletes at all on production']] },
        { c:'# require two approvals on the infrastructure repository',
          out:'(branch protection updated)',
          fb:'Worth having, and it would not have helped: two people would have read the same summary line and reached the same conclusion. A machine check on the plan JSON does not get tired at 09:20 on a Friday.' },
        { c:'# add lifecycle { prevent_destroy = true } to the databases',
          out:'(configuration updated)',
          fb:'Genuinely valuable and you should do it — Terraform would have refused rather than complied. It protects the resources you remember to mark, whereas the plan gate covers everything, so they complement each other.' },
        { c:'# run terraform plan against staging before every production deploy',
          out:'(pipeline updated)',
          fb:'That is exactly what happened here and it passed, because staging was rebuilt after the refactor and had nothing to migrate. Testing against an environment with different state history is the trap this incident is made of.' }
      ] },

    { kind:'think',
      ask:'Someone asks why you did not just apply, since "Terraform reconciles to the desired state". What do you say?',
      hint:'What was the plan actually reporting?',
      opts:[
        { t:'The plan was reporting that it could not match state to configuration — applying resolves that by destroying production, not by fixing the mismatch', ok:true,
          fb:'That is the sentence to have ready. Terraform is accurate about what it intends and it has no idea that `web[0]` and `web["api"]` are the same machine — only a human knows that, and `moved` blocks are how you tell it. "It reconciles to desired state" is true and the desired state was described by an address list that had silently changed.' },
        { t:'Terraform is unreliable with count and for_each, so plans should not be trusted',
          fb:'The plan was entirely correct given what it knew. Framing it as a tool defect leads to ignoring plans generally, which is far more dangerous than the original mistake.' },
        { t:'The state file was out of date and needed refreshing first',
          fb:'State was current — the refresh had already happened. The mismatch was between state addresses and configuration addresses, which no amount of refreshing changes.' },
        { t:'Production should be applied manually so a human can intervene',
          fb:'The opposite lesson. A human reading the summary line is what nearly caused this; a machine check on the plan JSON is what prevents it. Manual applies also reintroduce laptop credentials and unreviewed plans.' }
      ] },

    { kind:'cmd',
      ask:'Last thing. The moved blocks are applied — what happens to them?',
      hint:'They are idempotent, but they are not free forever.',
      opts:[
        { c:'# leave them in for one release, then delete them in a follow-up PR\nterraform plan', ok:true,
          out:'No changes. Your infrastructure matches the configuration.',
          fb:'Correct. Once applied they are a no-op, so leaving them for a release lets anyone on an older checkout converge; removing them afterwards keeps the configuration readable. Deleting them in the same commit would strand any environment that had not yet applied.',
          parts:[['leave for one release','So every environment and every stale checkout converges'],['then delete','They are permanent clutter otherwise, and they describe a migration that is finished']] },
        { c:'# delete them immediately after the production apply',
          out:'(configuration updated)',
          fb:'Any environment that has not applied yet — a disaster recovery stack, a dormant region, a colleague\'s sandbox — still holds positional addresses and now has nothing telling it how to migrate. It gets the fourteen-destroy plan.' },
        { c:'# keep them permanently, they are harmless',
          out:'(no change)',
          fb:'They are harmless to run and not harmless to read: a configuration accumulating years of completed migrations is noise that makes the real content harder to find. They describe a finished migration.' },
        { c:'terraform state rm on the old addresses to tidy up',
          out:'Error: Invalid target address',
          fb:'Those addresses no longer exist — the moves already happened. If they had, this would abandon live resources.' }
      ] }
  ],
  debrief:{
    why:[
      'Equal destroy and create counts of the same resource types is a reindex, not a deletion. Reading both numbers rather than the first one reframes the incident before any command runs.',
      'Querying the saved plan as JSON gave the exact set of addresses in one command, and the positional indexes confirmed the count-based origin immediately.',
      'The commit in the pull request named the cause: a count-to-for_each refactor, which replaces every positional address with a keyed one so all fourteen old addresses vanish at once.',
      'Staging passed because it had been rebuilt after the refactor and never held positional addresses — testing against an environment with a different state history is what let this reach production.',
      'moved blocks fixed it in code rather than in state: reviewed in the pull request, applied identically by CI and by every colleague, and visible to whoever reads this next.',
      'Verification ended with an explicit count per action rather than an impression, which is what a reviewer can check and what a pipeline can assert on.',
      'The durable fix is a gate on the plan JSON that fails the build on any delete against production — three lines, and it does not get tired at 09:20.'
    ],
    interview:'Lead with the pattern rather than the panic. "Fourteen destroys with fourteen matching creates is a reindex — Terraform cannot match state addresses to configuration addresses, so it sees every old one disappear and every new one arrive. Positional indexes in the destroy list point at count, and the commit confirmed a count-to-for_each refactor. Staging was clean because it had been rebuilt after that change and never had positional addresses, which is why nobody caught it. The fix is moved blocks in code, not state mv and definitely not state rm: they are reviewed, they apply identically for CI and every colleague, and the plan collapsing to zero changes is the proof the mapping is right. Then I would add a CI gate on the plan JSON that fails on any delete against production, because a human reading a summary line at nine in the morning is exactly what nearly went wrong here."',
    prevent:[
      'Gate on the plan JSON: fail the build when a production plan contains any delete action, overridable only deliberately.',
      'lifecycle { prevent_destroy = true } on databases, state buckets and anything else holding data.',
      'Ship moved blocks with any refactor that changes addresses, and require them in review for count-to-for_each changes.',
      'Test risky changes against a copy of production state, not against an environment that was rebuilt last week.',
      'Prefer for_each over count for anything that is a collection, so addresses carry a meaningful key instead of a position.'
    ]
  }
},

/* ─────────────────────────────── 2. the state lock ── */
{
  id:'iac-l-lock', title:'CI is wedged behind a state lock', cat:'state',
  track:'iac', level:'intermediate', mins:9,
  brief:'14:05. The deploy pipeline has failed three times with "Error acquiring the state lock". Someone cancelled a running job about twenty minutes ago because it looked stuck. Two other teams are queued behind this deploy and asking in the channel whether they can just force-unlock it.',
  user:'you', host:'terraform',
  steps:[
    { kind:'cmd',
      ask:'Before anything else, what do you read?',
      hint:'The error is not just an error.',
      opts:[
        { c:'# the full error from the failed pipeline step', ok:true,
          out:'Error: Error acquiring the state lock\n\nLock Info:\n  ID:        8f2b1c04-7e31-4a90-b2cd-19f4e0a7c331\n  Path:      tfstate/env/prod/terraform.tfstate\n  Operation: OperationTypeApply\n  Who:       runner@ci-runner-4471\n  Created:   2026-08-28 13:44:02 +0000 UTC',
          fb:'Everything you need is here and most people skim it. The operation is an **apply**, not a plan, and it was taken twenty-one minutes ago by a specific CI runner. An apply lock is the dangerous kind, because an apply that is still running is making changes.',
          parts:[['Operation: OperationTypeApply','An apply, not a plan — this lock is protecting writes in progress'],['runner@ci-runner-4471','Which job to go and check'],['ID: 8f2b1c04-…','Deliberately not guessable, so you must read this before you can unlock']] },
        { c:'terraform force-unlock -force',
          out:'Error: Lock ID must be specified',
          fb:'It refuses without the id, which is the design working — you have to have read the error. That is a hint about the intended order of operations.' },
        { c:'terraform state pull | jq .serial',
          out:'Error: Error acquiring the state lock',
          fb:'Reasonable instinct, and the lock blocks it. You can read the object directly from S3 to get around that, but the error text is the faster first step.' },
        { c:'terraform plan',
          out:'Error: Error acquiring the state lock',
          fb:'Same lock, same error. Running the command again is not investigation.' }
      ] },

    { kind:'cmd',
      ask:'The lock names a CI runner. Establish whether it is actually gone.',
      hint:'Cancelled is not the same as finished.',
      opts:[
        { c:'# check run 4471 in the CI system', ok:true,
          out:'Run 4471 — status: cancelled, conclusion: cancelled\nDuration: 6m 41s\nLast step: terraform apply  (cancelled)\nRunner ci-runner-4471: offline',
          fb:'Cancelled, finished, and the runner is offline — so nothing is still writing. That is the first of two conditions for a safe unlock. The second, and the one people skip, is finding out what that apply did before it stopped.',
          parts:[['conclusion: cancelled','Confirmed finished rather than merely showing as cancelled in the UI'],['Runner … offline','No process survives to keep making changes'],['Last step: terraform apply','It died during the apply, so some of the plan may have been executed']] },
        { c:'terraform force-unlock 8f2b1c04-7e31-4a90-b2cd-19f4e0a7c331',
          out:'Terraform state has been successfully unlocked!',
          fb:'Too early. You have not established that the process is dead, and if that runner were still applying you would now have two applies able to write to one state. It worked here by luck, not by reasoning.' },
        { c:'aws dynamodb get-item --table-name tf-locks --key \'{"LockID":{"S":"tfstate/env/prod/terraform.tfstate"}}\'',
          out:'{ "Item": { "Info": { "S": "{\\"Operation\\":\\"OperationTypeApply\\",\\"Who\\":\\"runner@ci-runner-4471\\"…" } } }',
          fb:'The same information the error already gave you, read from the source. Useful when the error has scrolled away; it still does not tell you whether the job is alive.' },
        { c:'# ask in the channel whether anyone is applying',
          out:'(no reply for four minutes)',
          fb:'Worth doing in parallel and it is genuinely the fastest answer when someone replies. Silence is not confirmation, and the CI system knows definitively.' }
      ] },

    { kind:'think',
      ask:'The job is dead. Why not unlock now?',
      hint:'What is the difference between a stuck lock and a half-finished apply?',
      opts:[
        { t:'Because you do not yet know what that apply changed before it died — a partial apply with the lock released is a worse position than a stuck one', ok:true,
          fb:'Exactly. The lock being stale is only half the question. An apply cancelled six minutes in has probably created some resources and recorded them, and possibly left one mid-creation. Knowing that now means the next plan showing unexpected work is expected rather than alarming — and it stops someone applying on top of a partial state without realising.' },
        { t:'Because force-unlock requires the state to be readable first',
          fb:'It does not — unlocking is exactly how you make state readable again. The reason to wait is about knowledge, not mechanics.' },
        { t:'Because another team is queued and should go first',
          fb:'Queue order is a coordination question, not a safety one. Whoever goes first still needs to know what the interrupted apply left behind.' },
        { t:'Because unlocking requires an approval from whoever holds the lock',
          fb:'There is no such mechanism, and the runner is offline. The confirmation prompt is the only checkpoint, which is why it is worth answering honestly.' }
      ] },

    { kind:'cmd',
      ask:'Find out how far it got.',
      hint:'Two sources: what state says, and what the dead job logged.',
      opts:[
        { c:'aws s3api get-object --bucket tfstate --key env/prod/terraform.tfstate /tmp/s.json && jq \'.serial\' /tmp/s.json  # and read the run 4471 log', ok:true,
          out:'284\n\n# run 4471 log, last lines before cancellation:\naws_security_group.api: Creation complete after 2s [id=sg-0a1b2c3d]\naws_lb_target_group.api: Creation complete after 3s\naws_lb_listener_rule.api: Still creating... [1m40s elapsed]',
          fb:'The serial advanced and two resources reported complete, so this was a partial apply — some of the plan executed and was recorded. The listener rule was mid-creation when the job died, which is the one that might be an orphan.',
          parts:[['get-object … terraform.tfstate','Read state directly from the backend, which the lock does not prevent'],['Creation complete after 2s','Recorded in state — these are done'],['Still creating...','The one that may exist in AWS without being in state']] },
        { c:'# read the run 4471 log only',
          out:'aws_security_group.api: Creation complete after 2s\naws_lb_target_group.api: Creation complete after 3s\naws_lb_listener_rule.api: Still creating... [1m40s elapsed]',
          fb:'Most of the answer, and the right instinct. Pairing it with the state serial confirms the writes actually landed rather than trusting the log alone.' },
        { c:'aws elbv2 describe-rules --listener-arn $LISTENER --query \'Rules[].Priority\'',
          out:'["default", "100"]',
          fb:'A good check for the specific orphan and you will want it shortly. It only answers one resource, whereas the serial and the log tell you the shape of the whole interrupted run.' },
        { c:'terraform force-unlock 8f2b1c04-7e31-4a90-b2cd-19f4e0a7c331 && terraform apply -auto-approve',
          out:'(applying…)',
          fb:'Unlocking and immediately applying without a plan, on top of a state you have not inspected, on production. If the interrupted run left an orphan this fails on a name collision — and if it left something worse, you have just built on it.' }
      ] },

    { kind:'cmd',
      ask:'Now unlock.',
      hint:'Use the id from the error, and read what it asks you.',
      opts:[
        { c:'terraform force-unlock 8f2b1c04-7e31-4a90-b2cd-19f4e0a7c331', ok:true,
          out:'Do you really want to force-unlock?\n  Terraform will remove the lock on the remote state.\n  This will allow local Terraform commands to modify this state, even though it\n  may still be in use.\n\n  Enter a value: yes\n\nTerraform state has been successfully unlocked!',
          fb:'The prompt names the actual risk — it may still be in use — and you can now answer that honestly, because you checked. That is the difference between this and the same command run twenty minutes ago.',
          parts:[['the lock id from the error','You cannot guess it, which is deliberate'],['may still be in use','The prompt is the last checkpoint; -force removes it for no benefit']] },
        { c:'terraform force-unlock -force 8f2b1c04-7e31-4a90-b2cd-19f4e0a7c331',
          out:'Terraform state has been successfully unlocked!',
          fb:'Same outcome, minus the checkpoint. `-force` exists for automation; from a human shell on production it only removes the one moment designed to make you think.' },
        { c:'aws dynamodb delete-item --table-name tf-locks --key \'{"LockID":{"S":"tfstate/env/prod/terraform.tfstate"}}\'',
          out:'(no output)',
          fb:'It does release the lock — this is where the lock lives. Going through Terraform leaves a cleaner story for whoever reads this later, and deleting the wrong item by hand is a mistake with no prompt attached.' },
        { c:'# wait for the lock to expire',
          out:'(still locked after 10 minutes)',
          fb:'Terraform state locks do not expire. They are held until released, which is why force-unlock exists at all.' }
      ] },

    { kind:'cmd',
      ask:'Before anyone applies, what do you run?',
      hint:'You already know something was left half-done.',
      opts:[
        { c:'terraform plan -out=tfplan', ok:true,
          out:'  # aws_lb_listener_rule.api will be created\n  + resource "aws_lb_listener_rule" "api" {\n      + priority = 100\n    }\n\nPlan: 1 to add, 0 to change, 0 to destroy.\nSaved the plan to: tfplan',
          fb:'Exactly the resource that was mid-creation, and nothing else — which is what a healthy partial apply looks like. The security group and target group are not proposed again because state recorded them.',
          parts:[['plan -out=tfplan','Save it, so the apply runs what was reviewed'],['1 to add','The remainder of the interrupted run, which is what you expected from the log']] },
        { c:'terraform apply',
          out:'Error: creating ELBv2 Listener Rule: PriorityInUse: Priority \'100\' is currently in use',
          fb:'The orphan case, discovered the expensive way. The rule was created in AWS before the job died but its id never reached state, so Terraform tried to create it again. A plan first would not have predicted this, but it would have shown you exactly one resource to look at.' },
        { c:'terraform state list | wc -l',
          out:'60',
          fb:'Confirms state is readable and holds sixty resources. It says nothing about what remains outstanding, which is the question at this moment.' },
        { c:'terraform plan -refresh=false',
          out:'Plan: 1 to add, 0 to change, 0 to destroy.',
          fb:'Faster, and it plans from state without checking reality — which is precisely wrong after an interrupted apply, because reality is where the orphan is.' }
      ] },

    { kind:'cmd',
      ask:'The plan wants to create a listener rule at priority 100, and AWS says priority 100 is in use. Handle it.',
      hint:'The resource exists and is the one you wanted.',
      opts:[
        { c:'# import { to = aws_lb_listener_rule.api  id = "arn:aws:elasticloadbalancing:…" }\nterraform plan', ok:true,
          out:'Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.\n\n# after applying the import:\nNo changes. Your infrastructure matches the configuration.',
          fb:'The rule exists, it is exactly what the configuration describes, so adopting it is right. Import blocks show the adoption in the plan before anything is written, and the empty plan afterwards proves the configuration matches what was created.',
          parts:[['import { to = … id = … }','Adopt the orphan rather than recreating it'],['1 to import','Visible in the plan before state is touched'],['No changes','The proof that the imported resource matches the configuration']] },
        { c:'aws elbv2 delete-rule --rule-arn $RULE_ARN && terraform apply tfplan',
          out:'(deleted)\naws_lb_listener_rule.api: Creation complete after 2s',
          fb:'Also works, and for a cheap stateless resource it is defensible. It is a delete against production to fix a bookkeeping problem, which is a bigger action than importing — and on anything holding data it would be the wrong instinct entirely.' },
        { c:'terraform apply -replace=aws_lb_listener_rule.api',
          out:'Error: Cannot replace aws_lb_listener_rule.api: resource not found in state',
          fb:'Replacement operates on something state knows about, and state has no record of this rule — that is the whole problem. The error is telling you it needs importing first.' },
        { c:'# change the priority to 101 in the configuration',
          out:'(configuration updated)',
          fb:'It gets the apply green and leaves an unmanaged rule at priority 100 that nothing will ever update or delete, plus a configuration that no longer says what you meant. This is how orphans accumulate.' }
      ] },

    { kind:'cmd',
      ask:'Close it out. What changes so the next cancelled job is not an incident?',
      hint:'Two pipeline settings and one habit.',
      opts:[
        { c:'# pipeline: terraform apply -lock-timeout=5m, plus a concurrency group per environment', ok:true,
          out:'concurrency:\n  group: terraform-${{ inputs.environment }}\n  cancel-in-progress: false\n\n- run: terraform apply -lock-timeout=5m tfplan',
          fb:'The timeout makes a queued job wait rather than fail, which removes most of these outright. The concurrency group means only one apply per environment can run at all, and `cancel-in-progress: false` is the important half — it stops the platform killing an apply mid-flight, which is what created this incident.',
          parts:[['-lock-timeout=5m','Queue behind a lock instead of failing immediately'],['concurrency group','One apply per environment, serialised by the CI system'],['cancel-in-progress: false','Never cancel a running apply — that is what left the orphan']] },
        { c:'# document the force-unlock procedure in the runbook',
          out:'(runbook updated)',
          fb:'Worth having, and it is the smaller half. A runbook makes the incident faster to handle; the concurrency settings mean it mostly does not happen.' },
        { c:'# remove the state lock table so applies never block',
          out:'(table deleted)',
          fb:'That removes locking entirely, so two applies can now write to one state concurrently with nothing warning anyone. It converts a visible, recoverable blocked pipeline into an invisible, expensive state corruption.' },
        { c:'# switch to a local backend to avoid lock contention',
          out:'(backend changed)',
          fb:'No sharing, no locking, no versioning, and production state on somebody\'s laptop. Every problem this incident was about gets worse.' }
      ] },

    { kind:'think',
      ask:'Someone says the twenty-minute delay proves locking is more trouble than it is worth. Answer them.',
      hint:'Compare what the lock cost against what it prevented.',
      opts:[
        { t:'The lock cost a delayed deploy; without it two applies could have written to one state concurrently, which is a day of state surgery', ok:true,
          fb:'That is the trade, stated plainly. Interleaved writes produce a state file matching neither run and no longer matching reality, and recovery means reconstructing state by importing resources by hand. A blocked pipeline is visible, bounded and recoverable — which is what a good failure mode looks like.' },
        { t:'Agreed — locking should be optional for low-risk environments',
          fb:'Low-risk environments are where people learn habits they then apply to production. And the cost of locking is a wait; the cost of not having it is unbounded.' },
        { t:'The real problem was that the job was cancelled, so locking is irrelevant',
          fb:'Cancelling the job is what caused this specific incident, and the lock is what stopped a second apply compounding it. Both are true, and only one of them is a safety mechanism.' },
        { t:'Locking is only needed when several people apply from laptops',
          fb:'CI runs concurrently too — that is precisely how two applies collide. If anything, automation makes it more likely, because nobody is watching to notice.' }
      ] }
  ],
  debrief:{
    why:[
      'The error text carried the whole investigation: operation, holder, host and age. An apply lock is categorically different from a plan lock, because an apply that is still running is making changes.',
      'Confirming the job was finished — not merely cancelled — and the runner offline is the first of two conditions for a safe unlock. A cancelled pipeline does not always stop the process immediately.',
      'The second condition is the one people skip: knowing what the interrupted apply did. The state serial plus the job log showed two resources created and recorded, and one mid-creation.',
      'That knowledge is what made the follow-up plan legible. One resource outstanding was expected rather than alarming, and the orphan was predicted rather than discovered as an apply failure.',
      'The orphan was adopted with an import block rather than deleted or worked around. It existed, it was what the configuration described, and importing it left the configuration honest.',
      'The durable fix is in the pipeline, not the runbook: a lock timeout so jobs queue, a concurrency group so only one apply per environment runs, and cancel-in-progress disabled so an apply is never killed mid-flight.',
      'Locking cost a delayed deploy and prevented concurrent writes to one state — a bounded, visible failure instead of an unbounded, invisible one.'
    ],
    interview:'Frame it as two questions rather than one. "The lock error names the operation, the holder, the host and the age, and an apply lock is the dangerous kind. First question: is the holder actually gone — cancelled in the CI system is not the same as the process having stopped. Second question, and this is the one people skip: what did that apply do before it died? The state serial and the job log told me two resources were created and recorded and one was mid-creation, so when the follow-up plan showed exactly one resource outstanding, that was expected. The mid-creation one turned out to be an orphan — created in AWS, never recorded in state — so I imported it rather than deleting it or renaming around it. The fix is in the pipeline: lock-timeout so jobs queue instead of failing, a concurrency group so only one apply per environment runs, and cancel-in-progress disabled, because cancelling a running apply is what created the orphan in the first place."',
    prevent:[
      '-lock-timeout on plan and apply so a queued job waits rather than failing immediately.',
      'A CI concurrency group per environment, with cancel-in-progress disabled so an apply is never killed mid-flight.',
      'Never cancel a running apply — let it finish or fail; cancelling is what leaves partial state and orphans.',
      'Keep state versioning on so a genuinely corrupted state can be restored from the backend rather than reconstructed.',
      'A short runbook entry: read the lock info, confirm the holder is dead, establish what it did, then unlock and plan before applying.'
    ]
  }
}

);
