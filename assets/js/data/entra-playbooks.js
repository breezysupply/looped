/* Identity & M365 — decision trees. Sign-in failures have the best diagnostic
   surface of any system in this app: the log names the policy, the error code
   names the layer. Most of these trees are about reading that properly.      */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.playbooks = LX.playbooks || [];

LX.playbooks.push(

/* ═══ 1. a user cannot sign in ═══ */
{
  id:'en-signin-fail', track:'entra', title:'A user cannot sign in', cat:'mfa', level:'beginner',
  cert:['ms-102:identity','sc-300:access'],
  prompt:'"Someone says they cannot log in. Walk me through how you find out why."',
  say:'"The sign-in log answers this almost every time, so I go there before I touch the account. Every attempt carries an AADSTS error code, and the code routes the whole investigation: a credential problem, an MFA requirement, a Conditional Access block, or a per-application assignment. The log also lists every Conditional Access policy evaluated with its result, so if a policy blocked them I can name it rather than guess. What I try not to do is start disabling controls to see what happens, because a lockout report is also what an attacker with a stolen password sounds like."',
  steps:[
    { check:'What does the sign-in log say?', cmd:'Get-MgAuditLogSignIn -Filter "userPrincipalName eq \'jo@contoso.com\' and status/errorCode ne 0" -Top 10',
      decide:'Read the error code and the failure reason together.',
      why:'This is the highest-yield command in the whole product. Every failed attempt records the application, the client, the location, the device state and an AADSTS code with human-readable text. Before this, everything is a guess; after it, you know which of four completely different problems you have. If there are **no failure records at all**, that is itself the answer — the request never reached Entra, so it is DNS, a federated identity provider, or the user is signing in somewhere you are not looking.',
      branches:[
        { when:'50126 — invalid username or password', then:'Credentials. Check for smart lockout and whether the account is even enabled.' },
        { when:'50076 / 50079 — MFA required or not registered', then:'The method, not the password', goto:'en-compromise' },
        { when:'53003 — blocked by Conditional Access', then:'A policy said no. The log names which one.', goto:'en-ca-lockout' },
        { when:'50105 — not assigned to a role for the application', then:'App assignment, not identity', goto:'en-app-401' },
        { when:'No records at all', then:'The request never arrived — check the domain\'s authentication type.' } ] },

    { check:'Is the account actually usable?', cmd:'Get-MgUser -UserId jo@contoso.com -Property accountEnabled,onPremisesSyncEnabled,userType,signInActivity | Format-List',
      decide:'Enabled, and mastered where you think it is.',
      why:'Two cheap checks that save an afternoon. `accountEnabled: false` ends the investigation immediately. `onPremisesSyncEnabled: true` means the object is mastered in Active Directory, so a cloud-side fix will be reverted at the next sync cycle and the change has to be made on-premises — this is the single most common wasted effort in a hybrid tenant. `signInActivity` also tells you whether they have ever signed in successfully, which distinguishes a broken account from a broken onboarding.',
      branches:[
        { when:'accountEnabled false and synced', then:'Enable it in Active Directory, not in the cloud', goto:'en-hybrid-stale' },
        { when:'accountEnabled false, cloud-only', then:'Enable it here, and find out who disabled it and why.' },
        { when:'Never signed in successfully', then:'This is onboarding, not a lockout. Check licences and app assignment.' },
        { when:'Enabled and previously working', then:'Back to the error code.' } ] },

    { check:'Is it the credential or the second factor?', cmd:'Get-MgUserAuthenticationMethod -UserId jo@contoso.com',
      decide:'50126 is the password. 50076 or 50079 means the password worked.',
      why:'That distinction matters more than it sounds: if the code is 50076, the password was accepted and only the second factor failed, which means the credential is valid and — if the user did not initiate this — potentially known to somebody else. 50079 means they have never registered a method, which is an onboarding gap. A user whose only method is a phone number is also worth flagging while you are here, because SMS is the weakest option still in common use.',
      branches:[
        { when:'No methods registered', then:'Issue a Temporary Access Pass so they can register properly.' },
        { when:'Method registered but failing', then:'Lost device. Temporary Access Pass, then re-register — never remove the requirement.' },
        { when:'Repeated 50076 the user did not initiate', then:'Someone else has the password', goto:'en-compromise' },
        { when:'Password itself failing', then:'Smart lockout may be active; check the location and client on the failures.' } ] },

    { check:'Where and what is signing in?', cmd:'Get-MgAuditLogSignIn -Filter "userPrincipalName eq \'jo@contoso.com\'" -Top 20 | Select-Object CreatedDateTime,AppDisplayName,IPAddress,ClientAppUsed,@{n=\'Loc\';e={$_.Location.CountryOrRegion}}',
      decide:'The application and client tell you whether the ticket is even about what the user thinks.',
      why:'"I cannot log in" usually means one specific application, and the log shows which. `ClientAppUsed` is the field that catches legacy authentication — a mail client using IMAP or basic auth cannot do modern authentication at all, so a policy blocking legacy protocols produces a failure the user experiences as a broken password. Unfamiliar countries or a burst of attempts from several addresses changes this from a support ticket into a security incident.',
      branches:[
        { when:'One application only', then:'App assignment or app-specific policy', goto:'en-app-401' },
        { when:'ClientAppUsed shows a legacy protocol', then:'Blocked by design. The client needs modern auth, not an exception.' },
        { when:'Attempts from unfamiliar locations', then:'Treat as a possible compromise', goto:'en-compromise' },
        { when:'Everything, from their usual place', then:'It is the account or a tenant-wide policy.' } ] },

    { check:'Fix it without weakening anything, then confirm', cmd:'New-MgUserAuthenticationTemporaryAccessPassMethod -UserId jo@contoso.com -BodyParameter @{ lifetimeInMinutes=60; isUsableOnce=$true }   ·   Get-MgAuditLogSignIn -Filter "userPrincipalName eq \'jo@contoso.com\'" -Top 3',
      decide:'The fix should restore access without removing a control.',
      why:'The tempting shortcuts — excluding the user from a Conditional Access policy, removing the MFA requirement, resetting the password and reading it out over the phone — all trade a lasting weakness for a quick close, and lockout complaints are a standard social-engineering opening. A Temporary Access Pass is time-boxed, single-use if you want, fully audited, and lets the user register a real method themselves. Verify with the sign-in log rather than asking whether it worked.',
      branches:[
        { when:'Successful sign-in in the log', then:'Done. Confirm the method they registered is not SMS only.' },
        { when:'Still failing with the same code', then:'The original diagnosis was wrong — go back to the code.' },
        { when:'Identity was verified out of band', then:'Note that in the ticket. It is the control that makes this process safe.' } ] } ],
  probes:[
    ['Which AADSTS codes do you know by heart?','50126 invalid credentials; 50053 account locked by smart lockout or blocked sign-in; 50076 MFA required; 50079 MFA not registered; 53003 blocked by Conditional Access; 53000 device not compliant; 50105 user not assigned to the application; 7000215 invalid client secret; 65001 consent not granted.'],
    ['A user says MFA is broken. What do you not do?','Remove the MFA requirement. That is exactly what an attacker with a stolen password wants. Verify identity out of band, issue a Temporary Access Pass, and let them register a new method.'],
    ['No failed sign-ins appear at all. What does that mean?','The attempt never reached Entra. Either the domain is federated and the identity provider rejected it, or DNS or the client is pointing somewhere else, or the user is signing in to a different tenant than the one you are searching.'],
    ['How long do you have to investigate?','Thirty days of sign-in logs with Entra ID P1 or P2, seven without. Anything longer has to have been exported to Log Analytics or a SIEM in advance — which is a decision you make before the incident, not during it.']
  ],
  trap:'Excluding the user from a Conditional Access policy to unblock them. The exclusion is permanent, nobody reviews it, and it silently accumulates until the policy protects a fraction of the people it names.',
  remember:'The sign-in log names the code, the policy and the client. Read it before you change anything.'
},

/* ═══ 2. Conditional Access lockout ═══ */
{
  id:'en-ca-lockout', track:'entra', title:'A Conditional Access policy locked people out', cat:'ca', level:'advanced',
  cert:['sc-300:access','ms-102:identity','az-104:identity'],
  prompt:'"A Conditional Access change has locked out a group of users — possibly including admins. What now?"',
  say:'"First I find out whether I still have a way in, because that decides whether this is an incident or an emergency. Break-glass accounts are excluded from every policy for exactly this reason. Then the sign-in logs tell me precisely which policy is blocking, because every attempt lists the policies evaluated and their results. Rollback is disabling the policy or flipping it to report-only, both of which take effect in minutes. Then I work out what the policy actually did that nobody expected — usually an assignment of All users with no exclusions, or a grant control that legacy clients and service principals cannot satisfy."',
  steps:[
    { check:'Do you still have a way in?', cmd:'# sign in with a break-glass account   ·   Get-MgIdentityConditionalAccessPolicy -All | Where-Object { $_.Conditions.Users.ExcludeUsers -contains $breakGlassId }',
      decide:'Every policy should exclude the break-glass accounts. Confirm before anything else.',
      why:'This is the difference between a bad morning and a support case with Microsoft. Two cloud-only accounts on the tenant\'s `.onmicrosoft.com` domain, with long random passwords held offline, excluded from every Conditional Access policy and alerted on when used — that is the standard pattern, and it only works if it was set up in advance. If no such account exists and every administrator is blocked, opening a support case is genuinely the remaining option, so establish this first.',
      branches:[
        { when:'Break-glass works', then:'You have control. Proceed calmly.' },
        { when:'No break-glass account exists', then:'Try a device or network that satisfies the policy; otherwise it is a support case.' },
        { when:'Break-glass exists but is not excluded from the new policy', then:'That is the actual defect. Fix it after the rollback.' } ] },

    { check:'Which policy is blocking, exactly?', cmd:'(Get-MgAuditLogSignIn -Filter "userPrincipalName eq \'blocked@contoso.com\' and status/errorCode eq 53003" -Top 1).AppliedConditionalAccessPolicies | Select-Object DisplayName,Result',
      decide:'Every policy evaluated is listed with success, failure, notApplied or notEnabled.',
      why:'This field is why Conditional Access is more debuggable than most access systems: you do not have to reason about which policies might apply, because the log records the evaluation. A result of `failure` names the policy that blocked. `notApplied` means the conditions did not match this attempt, which is just as useful — it rules a policy out. Working from the policy list instead of the log is guesswork, and with twenty policies it is slow guesswork.',
      branches:[
        { when:'One policy with result failure', then:'That is your policy. Read what it requires.' },
        { when:'Several failing', then:'Policies are additive — every applicable one must pass. Fix them all.' },
        { when:'None failing but sign-in blocked', then:'Not Conditional Access. Re-read the error code', goto:'en-signin-fail' } ] },

    { check:'Roll it back', cmd:'Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id -State "disabled"   ·   # or "enabledForReportingButNotEnforced"',
      decide:'Disabled stops it entirely; report-only keeps the telemetry without enforcing.',
      why:'Report-only is usually the better rollback: users get in immediately and the sign-in logs keep recording what the policy *would* have done, which is exactly the data you need to fix it properly. Changes propagate in minutes rather than instantly, so tell people it is not immediate. Resist narrowing the policy under pressure — an exclusion added in an incident is an exclusion nobody reviews, and it is how a policy ends up protecting a fraction of the people it names.',
      branches:[
        { when:'Users get in again', then:'Incident over. Now find out what the policy actually did.' },
        { when:'Still blocked after several minutes', then:'Another policy is also failing, or tokens are cached — check the log again.' },
        { when:'Tempted to add exclusions instead', then:'Do not. Roll back whole, fix, and redeploy in report-only.' } ] },

    { check:'What did the policy actually do?', cmd:'Get-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id | Select-Object -ExpandProperty Conditions | Format-List   ·   … | Select-Object -ExpandProperty GrantControls',
      decide:'Read the assignment and the grant control together — the surprise is nearly always in one of them.',
      why:'Four shapes cause most lockouts. `IncludeUsers: All` with no exclusions catches break-glass accounts and service principals. `IncludeApplications: All` catches applications nobody was thinking about, including the ones administrators use to fix things. A grant control requiring a compliant or hybrid-joined device catches everyone whose device has not checked in recently. And requiring MFA for users who have never registered a method produces 50079 rather than a prompt — they cannot satisfy it at all.',
      branches:[
        { when:'All users, no exclusions', then:'Add the break-glass exclusions before re-enabling. Every time.' },
        { when:'Requires compliant device', then:'Check device compliance state and grace periods', goto:'en-device-blocked' },
        { when:'Requires MFA, users not registered', then:'Registration campaign first, enforcement second.' },
        { when:'Blocks legacy authentication', then:'Correct policy, unprepared clients — find them in the logs first.' } ] },

    { check:'Redeploy safely', cmd:'Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id -BodyParameter @{ state="enabledForReportingButNotEnforced"; conditions=@{ users=@{ excludeUsers=@($bg1,$bg2) } } }',
      decide:'Report-only, exclusions in place, then read the logs before enforcing.',
      why:'Report-only mode evaluates the policy against real sign-ins and records the result without blocking anyone, so you can query `AppliedConditionalAccessPolicies` for a few days and see exactly who would have been affected. That is the whole safety mechanism, and skipping it is what caused the incident. The other habit worth adopting is naming policies for what they do and to whom, so the next person reading twenty policies at speed can tell which one matters.',
      branches:[
        { when:'Report-only shows unexpected failures', then:'Fix the assignment before enforcing. That is the point.' },
        { when:'Report-only looks clean', then:'Enable it, and watch the sign-in logs for the first hour.' },
        { when:'Change was not reviewed by anyone', then:'CA policy changes deserve the same review as production code.' } ] } ],
  probes:[
    ['How do Conditional Access policies combine?','Additively. Every applicable policy must be satisfied, and there is no allow that overrides another policy\'s block — adding a policy can only restrict. Exclusions are the only escape.'],
    ['What is a break-glass account and what makes one correct?','A cloud-only account on the .onmicrosoft.com domain, with a long random password stored offline, excluded from every Conditional Access policy, with sign-in alerts. Two of them, so one being compromised or lost does not lock you out. Tested on a schedule, because an untested one is a belief.'],
    ['Report-only mode — what does it actually get you?','The policy is evaluated against real sign-ins and the result is recorded in AppliedConditionalAccessPolicies without anyone being blocked. You get the exact list of who would have been affected, before affecting them.'],
    ['A policy requiring a compliant device locks out a fleet. What went wrong?','Almost always that compliance was evaluated at check-in and the devices had not checked in, or a compliance rule was tightened with no grace period. Device state and CA are separate systems and they fail together.']
  ],
  trap:'Adding exclusions during the incident instead of rolling back. Every exclusion is permanent in practice, nobody audits them, and the policy quietly stops covering the people it was written for.',
  remember:'Break-glass first, AppliedConditionalAccessPolicies second, report-only third. Policies are additive and only ever restrict.'
},

/* ═══ 3. app or script 401 ═══ */
{
  id:'en-app-401', track:'entra', title:'An app or script started returning 401', cat:'apps', level:'intermediate',
  cert:['sc-300:apps','ms-102:identity'],
  prompt:'"A nightly Graph job that has run for a year started failing with 401. Nothing changed. What is it?"',
  say:'"When nothing changed and something started failing, something expired. My first guess for an app registration is the client secret, because secrets have an end date and nobody sets a reminder. After that I check whether it is really authentication or authorisation — a 401 is an identity failure and a 403 is a permission one, and people report both as \'it broke\'. Then the two things that catch scripts specifically: the difference between delegated and application permissions, and whether admin consent was ever granted for the permission the code is using."',
  steps:[
    { check:'Has the client secret expired?', cmd:'Get-MgApplication -Filter "appId eq \'…\'" | Select-Object DisplayName,@{n=\'Secrets\';e={$_.PasswordCredentials.EndDateTime}}',
      decide:'An EndDateTime in the past is the whole answer.',
      why:'This is the most common cause by a wide margin and it takes one call to rule in or out. Secrets are created with a default lifetime — often one or two years — and nothing warns you. The error is AADSTS7000215, "invalid client secret provided", which is unambiguous once you have seen it once. The durable fix is a certificate rather than a secret, because the private key never travels; the immediate fix is a new secret and a note in the calendar.',
      branches:[
        { when:'Secret expired', then:'Add a new one, update the caller, and set an expiry alert this time.' },
        { when:'Secret still valid', then:'Not authentication. Check the error code precisely.' },
        { when:'Several secrets, one expired', then:'The app may be using the wrong one — check what the caller holds.' } ] },

    { check:'Is it 401 or 403 — and what is the AADSTS code?', cmd:'# capture the full error body from the caller   ·   Get-MgAuditLogSignIn -Filter "appDisplayName eq \'Nightly Report\' and status/errorCode ne 0" -Top 5',
      decide:'401 is "I do not know who you are". 403 is "I know, and no".',
      why:'The two get reported identically and they are completely different investigations. 401 with AADSTS7000215 is a bad secret; with 700016 the application was not found in the directory, usually a wrong tenant or app id; with 90002 the tenant itself was not found. A 403 means authentication succeeded and the token lacks the permission, which sends you to consent and permission type instead. Service principal sign-ins appear in the sign-in logs too, which people forget.',
      branches:[
        { when:'401 / 7000215', then:'Bad or expired secret.' },
        { when:'401 / 700016 or 90002', then:'Wrong app id or wrong tenant — check the configuration, not the permissions.' },
        { when:'403', then:'Authenticated but not authorised. Go to permissions.' },
        { when:'50105', then:'The app requires assignment and this principal is not assigned.' } ] },

    { check:'Delegated or application permission?', cmd:'(Get-MgApplication -ApplicationId $obj).RequiredResourceAccess | ConvertTo-Json -Depth 5   ·   Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp',
      decide:'A daemon with no signed-in user needs **application** permissions, not delegated ones.',
      why:'This is the distinction that breaks unattended jobs. **Delegated** permissions act on behalf of a signed-in user and are capped by that user\'s own rights; **application** permissions act as the app itself with no user involved. A script that works when a developer runs it interactively and fails as a scheduled job is almost always holding delegated permissions and running with no user. `Get-MgServicePrincipalAppRoleAssignment` lists the application permissions actually granted, which is the list that matters for a daemon.',
      branches:[
        { when:'Only delegated permissions, running unattended', then:'That is the bug. Add the application permission and grant admin consent.' },
        { when:'Application permission present but not consented', then:'It is requested, not granted. Admin consent is a separate step.' },
        { when:'Correct permissions present', then:'Check whether consent was revoked or the service principal disabled.' } ] },

    { check:'Was consent granted — and is the service principal alive?', cmd:'Get-MgOauth2PermissionGrant -All -Filter "clientId eq \'$sp\'"   ·   Get-MgServicePrincipal -ServicePrincipalId $sp | Select-Object AccountEnabled,AppRoleAssignmentRequired',
      decide:'A requested permission is not a granted one, and a disabled service principal blocks everything.',
      why:'Requesting a permission in the app registration and having it granted are two different states, and the portal shows them side by side in a way that is easy to misread. AADSTS65001 is the explicit "user or administrator has not consented" case. Consent can also be **revoked** — during a security review, or automatically if the app was flagged — which produces a sudden failure with no configuration change. And a service principal with `AccountEnabled: false` blocks every sign-in to that app regardless of permissions.',
      branches:[
        { when:'No grant for the scope in use', then:'Grant admin consent for exactly that permission.' },
        { when:'Grant removed recently', then:'Check the audit log for who revoked it — there was probably a reason.' },
        { when:'Service principal disabled', then:'Someone disabled the enterprise app. Find out why before re-enabling.' },
        { when:'AppRoleAssignmentRequired true', then:'Assign the principal to the app; this is AADSTS50105.' } ] },

    { check:'Fix it durably', cmd:'# add a certificate credential rather than a secret   ·   Get-MgApplication -All | Where-Object { $_.PasswordCredentials.EndDateTime -lt (Get-Date).AddDays(60) } | Select-Object DisplayName,AppId',
      decide:'Restore service, then remove the class of failure.',
      why:'A new secret with the same default lifetime schedules the identical outage for next year. Certificates avoid the shared-secret problem entirely; failing that, a scheduled query for credentials expiring within sixty days turns a surprise outage into a ticket. While you are in the app registration, check whether the permissions it holds are still the ones it needs — apps accumulate permissions and almost never shed them, and an over-permissioned daemon is exactly what an attacker looks for.',
      branches:[
        { when:'Certificate adopted', then:'Best outcome. Note the certificate expiry too — it also expires.' },
        { when:'New secret issued', then:'Set the expiry alert now, while you remember.' },
        { when:'Permissions broader than needed', then:'Trim them. Nobody else will.' } ] } ],
  probes:[
    ['Delegated versus application permissions.','Delegated act as the signed-in user and are limited by that user\'s own rights. Application permissions act as the app with no user at all and are not capped by anyone — which is why they always require admin consent, and why a daemon needs them.'],
    ['401 versus 403.','401 is authentication: the token is missing, malformed or the credential is wrong. 403 is authorisation: the identity is established and lacks permission. The AADSTS code inside the 401 tells you which credential problem it is.'],
    ['Why prefer a certificate over a client secret?','The private key never leaves the machine, so nothing sensitive travels or sits in a pipeline variable. Secrets get copied into config files, logs and chat messages; certificates cannot be used by someone who only saw them.'],
    ['How would you find every app about to break?','Query every application registration for PasswordCredentials.EndDateTime within the next sixty days and alert on it. It costs one scheduled script and removes a whole class of self-inflicted outage.']
  ],
  trap:'Granting a broader permission to make the 403 go away. `Directory.ReadWrite.All` on a reporting job is an audit finding and a real risk, and it is never revisited once the ticket closes.',
  remember:'Nothing changed means something expired. Secret first, then 401-versus-403, then delegated-versus-application, then consent.'
},

/* ═══ 4. licensing ═══ */
{
  id:'en-license-gap', track:'entra', title:'A user is missing a service they should have', cat:'lic', level:'intermediate',
  cert:['ms-102:identity'],
  prompt:'"A new starter has an E3 licence but no Teams. Where do you look?"',
  say:'"Licences fail in a few specific ways and none of them announce themselves. I check what the user actually holds, then where it came from — direct or group-based — because a group-assigned licence cannot be removed or fixed on the user. Then the two error states: CountViolation, which means the tenant has run out of that SKU, and MutuallyExclusiveViolation, which means two overlapping licences conflict. Then service plans, because a SKU can be assigned with individual services switched off."',
  steps:[
    { check:'What does the user actually hold?', cmd:'Get-MgUserLicenseDetail -UserId jo@contoso.com | Select-Object SkuPartNumber,@{n=\'Plans\';e={$_.ServicePlans.ServicePlanName}}',
      decide:'The SKU, and the individual service plans inside it.',
      why:'A SKU is a bundle and the individual service plans can be disabled independently — a user can hold E3 with Teams switched off, which looks identical to holding E3 from every other angle. This is a common outcome of a licensing template that was set up years ago to disable a service nobody wanted then. Reading the plan list settles it in one call.',
      branches:[
        { when:'No licence at all', then:'Assignment never happened. Check group membership and the tenant\'s free count.' },
        { when:'SKU present, service plan disabled', then:'That is it — the plan is switched off in the assignment.' },
        { when:'Everything looks correct', then:'Check the assignment state for an error.' } ] },

    { check:'Where did the licence come from, and did it succeed?', cmd:'(Get-MgUser -UserId jo@contoso.com -Property licenseAssignmentStates).LicenseAssignmentStates | Select-Object SkuId,AssignedByGroup,State,Error',
      decide:'`AssignedByGroup` populated means group-based; `Error` is where the failure is named.',
      why:'This one field explains most licensing mysteries. If `AssignedByGroup` is set, the licence comes from group membership and cannot be removed or repaired on the user — you change the group. The `Error` value names the failure directly: `CountViolation` means the tenant is out of that SKU, `MutuallyExclusiveViolation` means two assignments conflict, `ProlongedOutage` means the service could not process it and it will retry. A `State` of `Error` with nobody watching is how a new starter silently gets nothing.',
      branches:[
        { when:'CountViolation', then:'Out of licences. Buy more or reclaim from disabled accounts.' },
        { when:'MutuallyExclusiveViolation', then:'Two groups grant the same service plan. Remove one.' },
        { when:'AssignedByGroup with no error', then:'Assignment is fine — check whether the group membership is recent.' },
        { when:'No assignment state at all', then:'They are not in the licensing group. Check the group\'s membership rule.' } ] },

    { check:'Does the tenant have any left?', cmd:'Get-MgSubscribedSku | Select-Object SkuPartNumber,@{n=\'Used\';e={$_.ConsumedUnits}},@{n=\'Owned\';e={$_.PrepaidUnits.Enabled}}',
      decide:'Consumed against owned, with the warning tier as a third column.',
      why:'Running out is silent: group-based licensing records `CountViolation` on each user it could not license and carries on, so the first symptom is a person complaining days later. Before buying more, look at disabled accounts still holding licences — a leaver process that disables without reclaiming is the usual reason a tenant is "out" while paying for people who left. `PrepaidUnits.Warning` shows licences in the grace period after expiry, which is its own kind of surprise.',
      branches:[
        { when:'Zero free', then:'Reclaim from disabled accounts first; that is usually enough.' },
        { when:'Free licences available', then:'Not a count problem — go back to the assignment error.' },
        { when:'Units in Warning', then:'The subscription has lapsed and is in grace. That is a procurement conversation, urgently.' } ] },

    { check:'Is the group the problem?', cmd:'Get-MgGroup -GroupId $g -Property displayName,groupTypes,membershipRule,onPremisesSyncEnabled | Format-List   ·   Get-MgGroupMember -GroupId $g -All',
      decide:'Dynamic membership rules and on-premises mastering both change what you can fix here.',
      why:'If the licensing group is **dynamic**, membership is computed from a rule and adding the user directly fails — the user appears when their attributes match, so the fix is the attribute or the rule. If the group is **synced from on-premises**, membership is mastered in Active Directory and any cloud edit is reverted. Dynamic group processing also lags, from minutes to considerably longer in a large tenant, so a new starter can be correct and simply not there yet.',
      branches:[
        { when:'Dynamic group, user does not match', then:'Fix the source attribute — usually department or employeeType.' },
        { when:'Synced group', then:'Change membership in Active Directory', goto:'en-hybrid-stale' },
        { when:'User is a member and licensed', then:'Assignment succeeded; the problem is downstream provisioning.' } ] },

    { check:'Confirm the service actually provisioned', cmd:'Get-MgUserLicenseDetail -UserId jo@contoso.com | ForEach-Object { $_.ServicePlans | Where-Object ProvisioningStatus -ne "Success" }',
      decide:'Assigned is not provisioned — each service plan has its own status.',
      why:'A licence assignment triggers provisioning in each workload and those complete independently, over minutes to a few hours. `ProvisioningStatus` of `PendingProvisioning` means it is still working and the answer is to wait; `PendingInput` or `Disabled` means it will not complete on its own. This is why "I assigned the licence and it still does not work" is usually true, briefly, and why closing the ticket on assignment alone produces a second ticket.',
      branches:[
        { when:'PendingProvisioning', then:'Wait. Check again in an hour before doing anything else.' },
        { when:'Disabled', then:'The service plan is switched off in the assignment. Enable it.' },
        { when:'All Success but still no access', then:'It is not licensing — check app assignment and Conditional Access', goto:'en-signin-fail' } ] } ],
  probes:[
    ['Direct versus group-based licensing.','Group-based scales and is the right default: membership drives entitlement, so joiners and leavers are handled by group membership rather than by a person. The trade is that you cannot fix an individual on the user object, and two groups granting the same service plan produce a mutually-exclusive conflict.'],
    ['What is CountViolation?','The tenant has no free units of that SKU, so group-based licensing could not assign it. It is recorded per user and fails silently, which is why an alert at ninety percent consumption is worth having.'],
    ['A user keeps losing their licence. Why?','They are dropping out of a dynamic group because an attribute changed, or the group is synced from on-premises and the cloud membership is being reverted every cycle, or two overlapping assignments are conflicting.'],
    ['How do you reclaim licences safely?','Find disabled accounts still holding them, convert leaver mailboxes to shared so the mail survives without a licence, and only then remove. Removing a licence deletes the associated data after a grace period, so ordering matters.']
  ],
  trap:'Assigning a second licence directly to fix a group-based one. You now have two sources of truth, a likely mutually-exclusive conflict, and a manual assignment nobody will remember to remove.',
  remember:'LicenseAssignmentStates names the source and the error. Assigned is not provisioned, and group-assigned cannot be fixed on the user.'
},

/* ═══ 5. hybrid ═══ */
{
  id:'en-hybrid-stale', track:'entra', title:'An on-premises change never reached the cloud', cat:'hybrid', level:'advanced',
  cert:['ms-102:identity','az-104:identity'],
  prompt:'"Someone was disabled in Active Directory yesterday and can still get to their mail. Explain."',
  say:'"Two possibilities and they need different fixes. Either synchronisation has stopped, so nothing at all is arriving, or synchronisation is fine and the object is failing for its own reason. So I check the tenant-wide last sync time first — one number that tells me which of those it is. Then, if sync is healthy, I check the specific object and the source of authority, because a change made in the wrong place is reverted every cycle. And separately, disabling never ends existing sessions, so even a perfect sync leaves an active token working for up to an hour."',
  steps:[
    { check:'Is anything arriving at all?', cmd:'(Get-MgOrganization).OnPremisesLastSyncDateTime',
      decide:'More than an hour old means the sync service is the problem, not this user.',
      why:'One value splits the investigation. Default sync is every thirty minutes, so a timestamp within the hour means synchronisation is healthy and this is an object-level problem. Hours or days old means the sync server is down, its service account credentials expired, or the scheduler is suspended — and every change made on-premises since then is queued behind it, which is a much larger incident than one account.',
      branches:[
        { when:'Within the last hour', then:'Sync is healthy. It is this object or this change.' },
        { when:'Hours or days old', then:'The sync service is down. That is the incident — go to the server.' },
        { when:'No value at all', then:'Directory synchronisation may not be enabled for this tenant.' } ] },

    { check:'What is the sync server doing?', cmd:'# on the Entra Connect server:   Get-ADSyncScheduler   ·   Start-ADSyncSyncCycle -PolicyType Delta',
      decide:'SyncCycleEnabled, StagingModeEnabled, and when the next cycle is due.',
      why:'Three states stop synchronisation silently. `SyncCycleEnabled: False` means the scheduler was disabled, often during maintenance and never re-enabled. `StagingModeEnabled: True` means the server is a standby that imports but exports nothing — a very common state after a failover that was never completed. And expired credentials on the AD connector account stop imports with an error that only appears in the Synchronization Service Manager. `Start-ADSyncSyncCycle -PolicyType Delta` forces a cycle, which is the right immediate action once the cause is understood.',
      branches:[
        { when:'SyncCycleEnabled false', then:'Re-enable the scheduler and find out who disabled it.' },
        { when:'StagingModeEnabled true', then:'This server exports nothing. The real one is elsewhere, or the failover was never finished.' },
        { when:'Connector errors', then:'Usually expired credentials. The Synchronization Service Manager names the object and the error.' },
        { when:'Scheduler healthy', then:'Force a delta cycle and check the object again.' } ] },

    { check:'Where is this object mastered?', cmd:'Get-MgUser -UserId jo@contoso.com -Property onPremisesSyncEnabled,onPremisesLastSyncDateTime,onPremisesImmutableId,accountEnabled | Format-List',
      decide:'`onPremisesSyncEnabled: true` means Active Directory wins, always.',
      why:'This is the source-of-authority rule and it explains most wasted effort in hybrid tenants. A synchronised object cannot be meaningfully edited in the cloud — the change is rejected outright or silently reverted at the next cycle, which is worse because it appears to work. If the account is still enabled in the cloud and `onPremisesLastSyncDateTime` is recent, then the disable never happened on-premises, or it happened to a different object than you think.',
      branches:[
        { when:'Synced and still enabled, sync recent', then:'The on-premises change did not happen. Check the actual AD object.' },
        { when:'Synced, last sync is old', then:'This object is failing to sync. Check the connector for a per-object error.' },
        { when:'Not synced at all', then:'It is a cloud-only account. Disable it here.' },
        { when:'Duplicate object', then:'A second cloud object with the same person — the classic immutable-id mismatch.' } ] },

    { check:'Did anything block this specific object?', cmd:'# Synchronization Service Manager → Connectors → Search Connector Space   ·   Get-MgDirectoryOnPremiseSynchronization | Select-Object -ExpandProperty Configuration',
      decide:'Per-object errors and the accidental-deletion threshold both stop individual changes.',
      why:'Two object-level blocks are common. A **duplicate attribute** — usually `proxyAddresses` or `userPrincipalName` conflicting with another object — makes the export fail for that one user while everything else flows, so the tenant-wide timestamp looks perfectly healthy. And **accidental deletion prevention** halts an export batch when it would delete more objects than the threshold allows, which is a feature: it has saved more tenants than it has annoyed, and the right response is to confirm the deletions are intended rather than to raise the threshold blindly.',
      branches:[
        { when:'Duplicate attribute error', then:'Find and fix the conflicting object; the export retries automatically.' },
        { when:'Export blocked by deletion threshold', then:'Confirm the deletions are intended before overriding — this is a safety net.' },
        { when:'No object errors', then:'The change was not made where you think it was.' } ] },

    { check:'Revoke what is already issued', cmd:'Revoke-MgUserSignInSession -UserId jo@contoso.com   ·   Get-MgAuditLogSignIn -Filter "userPrincipalName eq \'jo@contoso.com\'" -Top 5',
      decide:'Disabling stops new sign-ins. It does not end existing sessions.',
      why:'Even with a perfect sync, a disabled user keeps working until their access token expires — typically up to an hour — and a refresh token can extend that considerably. This is the step most leaver runbooks omit and it is exactly the gap that matters for a hostile departure. `Revoke-MgUserSignInSession` invalidates the refresh tokens so the next renewal fails. Verify with the sign-in log rather than by asking.',
      branches:[
        { when:'Sessions revoked and sign-ins now failing', then:'Done. Add this step to the leaver runbook.' },
        { when:'Still succeeding after revocation', then:'A non-interactive or legacy client may hold a separate token — check ClientAppUsed.' },
        { when:'This is a hostile departure', then:'Revoke first, disable second, and check for forwarding rules', goto:'en-compromise' } ] } ],
  probes:[
    ['What is source of authority?','Whichever directory masters the object. A synced object is mastered on-premises, so cloud edits are rejected or reverted at the next cycle. It decides where every change has to be made, and getting it wrong is the most common wasted effort in a hybrid tenant.'],
    ['Sync is healthy but one user will not update. What is it?','A per-object error, almost always a duplicate proxyAddresses or userPrincipalName conflicting with another object. The tenant-wide sync timestamp stays healthy because everything else is flowing.'],
    ['What does staging mode do?','The server imports and synchronises but exports nothing. It is for standby servers and migrations, and a server left in it after a failover looks completely healthy while changing nothing in the cloud.'],
    ['Why does disabling not stop access immediately?','Tokens already issued remain valid until they expire — up to an hour for an access token, much longer for a refresh token. Revoke-MgUserSignInSession invalidates the refresh tokens; without it, a leaver keeps working for the rest of the hour.']
  ],
  trap:'Making the change in the cloud because it is faster. It appears to work, gets reverted at the next cycle, and the ticket reopens a day later with nobody able to explain it.',
  remember:'Tenant sync time first, then source of authority, then per-object errors. Disable and revoke are two different actions.'
},

/* ═══ 6. mail ═══ */
{
  id:'en-mail-missing', track:'entra', title:'Mail is not arriving', cat:'exo', level:'beginner',
  cert:['ms-102:exchange'],
  prompt:'"A customer says they sent us an invoice and we never got it. Find it."',
  say:'"Message trace first, because the status tells me which of three worlds I am in. If there is a record and it says delivered, the message is in the mailbox and this is a client or a rule problem. If it says quarantined or filtered, Exchange made a judgement and I go to the policy. If there is no record at all, the message never reached us, and that is DNS or the sender — no amount of mailbox investigation will find it. Then I check rules, at both the transport and the mailbox level, because a rule that moves or deletes mail produces exactly this complaint."',
  steps:[
    { check:'Did it arrive at all?', cmd:'Get-MessageTrace -RecipientAddress jo@contoso.com -StartDate (Get-Date).AddDays(-2) -EndDate (Get-Date) | Select-Object Received,SenderAddress,Subject,Status',
      decide:'Delivered, FilteredAsSpam, Quarantined, Failed — or no record at all.',
      why:'The status routes everything. **Delivered** means it is in the mailbox and the problem is downstream — a rule, a folder, or the client. **FilteredAsSpam** or **Quarantined** means Exchange accepted it and judged it, so the fix is policy. **Failed** means it was rejected and the detail carries the SMTP response. **No record** is the most informative of all: it never reached Exchange Online, so the sender, DNS or a connector is at fault. Note the ten-day limit on this cmdlet.',
      branches:[
        { when:'Delivered', then:'It is in the mailbox. Check rules and folders.' },
        { when:'Quarantined or FilteredAsSpam', then:'A policy judged it. Release and tune the policy.' },
        { when:'Failed', then:'Read the detail for the SMTP response — usually recipient or connector.' },
        { when:'No record', then:'It never arrived. Check MX records and ask the sender for their bounce.' } ] },

    { check:'Why was it handled that way?', cmd:'Get-MessageTraceDetail -MessageTraceId $id -RecipientAddress jo@contoso.com | Select-Object Event,Detail',
      decide:'The detail names the transport rule or the filter verdict.',
      why:'The per-hop detail is where the actual reason lives, including which mail flow rule matched and what it did. This is how you distinguish "our spam filter scored it high" from "a transport rule somebody wrote in 2023 redirects anything with the word invoice". Both present identically to the recipient, and only one of them is a filtering problem.',
      branches:[
        { when:'A transport rule matched', then:'Read the rule — it may be doing exactly what it was written to do.' },
        { when:'High spam confidence level', then:'Filtering. Consider an allow entry for the sender, scoped narrowly.' },
        { when:'Recipient not found', then:'Wrong address, or an alias that no longer exists.' },
        { when:'Connector rejection', then:'Inbound connector configuration, common after a migration.' } ] },

    { check:'Is a rule moving or deleting it?', cmd:'Get-TransportRule | Select-Object Name,State,Priority,StopRuleProcessing | Sort-Object Priority   ·   Get-InboxRule -Mailbox jo@contoso.com',
      decide:'Transport rules act tenant-wide; inbox rules act in one mailbox.',
      why:'Two layers, and they need separate checks. Transport rules run in priority order and `StopRuleProcessing` truncates the chain, so a rule can be unreachable because something above it stopped evaluation. Inbox rules are client-side and belong to the user — which is also why they are a favourite attacker mechanism: a rule with a single-character name that forwards to an external address and deletes the original is invisible to the user and survives a password reset.',
      branches:[
        { when:'A transport rule matches', then:'Fix or scope the rule. Check nothing else depended on it.' },
        { when:'An inbox rule the user does not recognise', then:'Treat as compromise', goto:'en-compromise' },
        { when:'No rules involved', then:'Check quarantine and the junk folder directly.' } ] },

    { check:'Is it sitting in quarantine?', cmd:'Get-QuarantineMessage -RecipientAddress jo@contoso.com -StartReceivedDate (Get-Date).AddDays(-7) | Select-Object ReceivedTime,SenderAddress,Subject,Type',
      decide:'Released, or the policy tuned so the next one is not caught.',
      why:'Quarantine is a holding area with its own retention, and the notification that would have told the user often does not reach them or goes unread. Releasing a single message is the immediate fix; the durable one is understanding why it scored as it did. A legitimate sender repeatedly quarantined usually has a DNS problem on their side — a missing SPF record, a DKIM signature that does not validate, or no DMARC alignment — and telling them that is more useful than adding a permanent allow entry on yours.',
      branches:[
        { when:'Found in quarantine', then:'Release it, then look at why it scored high.' },
        { when:'Sender fails SPF or DKIM', then:'Their DNS is the cause. An allow entry papers over a real problem.' },
        { when:'Not in quarantine either', then:'Back to the trace — the message may never have arrived.' } ] },

    { check:'Confirm and close the gap', cmd:'Get-MessageTrace -RecipientAddress jo@contoso.com -StartDate (Get-Date).AddHours(-1) -EndDate (Get-Date)   ·   Get-Mailbox jo@contoso.com | Select-Object ForwardingSmtpAddress',
      decide:'Verify delivery, and check nothing is quietly copying mail elsewhere.',
      why:'Confirm with a fresh trace rather than by asking the user, who may be looking in the wrong folder. While you are in the mailbox, check `ForwardingSmtpAddress` — a mailbox-level forward to an external address is both a data-loss risk and a standard post-compromise persistence mechanism, and this is the cheapest moment you will ever have to look at it.',
      branches:[
        { when:'Delivered and visible', then:'Done. Consider whether the filtering policy needs tuning.' },
        { when:'External forwarding found', then:'Investigate immediately', goto:'en-compromise' },
        { when:'Recurring for one sender', then:'Fix it at the source: their SPF, DKIM and DMARC.' } ] } ],
  probes:[
    ['No record in the message trace. What does that tell you?','The message never reached Exchange Online. The problem is upstream — MX records, the sending system, or a connector — and nothing you do in the mailbox will find it. Ask the sender for their bounce message.'],
    ['Transport rule versus inbox rule.','Transport rules are tenant-wide, run in priority order, and act before delivery. Inbox rules belong to one mailbox and run after. Attackers use inbox rules; administrators use transport rules; both can silently delete mail.'],
    ['A legitimate sender is always quarantined. What is the right fix?','Usually theirs: a missing or wrong SPF record, DKIM that does not validate, or no DMARC alignment. An allow entry on your side hides a real authentication failure and creates a permanent exception.'],
    ['What do you check first in a suspected mailbox compromise?','Inbox rules and mailbox forwarding. Attackers create a forwarding rule within minutes, usually with a one-character name, and it survives a password reset because it lives in the mailbox rather than in the credential.']
  ],
  trap:'Adding a permanent allow entry for a sender that fails SPF. You have disabled authentication checks for exactly the domain most worth spoofing.',
  remember:'Status routes the investigation: delivered, judged, rejected, or never arrived. No record means look upstream.'
},

/* ═══ 7. compromise ═══ */
{
  id:'en-compromise', track:'entra', title:'An account is probably compromised', cat:'mfa', level:'advanced',
  cert:['ms-102:security','sc-300:access'],
  prompt:'"A user reports MFA prompts they did not request. What do you do, in order?"',
  say:'"That report means somebody has the password, because the prompt only happens after the first factor succeeds. So I contain first and investigate second: revoke the sessions, reset the password, and confirm the registered authentication methods are still theirs. Then I look for the things an attacker sets up in the first few minutes — an inbox rule that forwards and deletes, a mailbox forward, a new authentication method, an OAuth consent grant. Then I work out the blast radius from the sign-in and unified audit logs. Password reset alone is the mistake, because none of those persistence mechanisms depend on the password."',
  steps:[
    { check:'Contain first', cmd:'Revoke-MgUserSignInSession -UserId jo@contoso.com   ·   Update-MgUser -UserId jo@contoso.com -AccountEnabled:$false',
      decide:'Revoke tokens, then decide whether to disable or reset.',
      why:'MFA prompts the user did not trigger mean the password is known to someone else — the second factor is the only thing still holding, and MFA fatigue attacks work precisely by waiting for someone to approve out of irritation. Revoking sessions invalidates refresh tokens so an attacker who already got in loses access at the next renewal. A password reset without revocation leaves existing sessions alive, which is the most common containment mistake there is.',
      branches:[
        { when:'User is available and can verify identity', then:'Reset the password and revoke sessions together.' },
        { when:'Cannot reach the user', then:'Disable the account. Availability is the smaller loss here.' },
        { when:'Already approved a prompt', then:'Assume full compromise and work the persistence checks quickly.' } ] },

    { check:'What did the attacker set up?', cmd:'Get-InboxRule -Mailbox jo@contoso.com   ·   Get-Mailbox jo@contoso.com | Select-Object ForwardingSmtpAddress,ForwardingAddress   ·   Get-MgUserAuthenticationMethod -UserId jo@contoso.com',
      decide:'Rules, forwarding and authentication methods — all three, in the first few minutes.',
      why:'These are the persistence mechanisms that survive a password reset, and attackers create them almost immediately. An inbox rule named with a single character or a full stop, forwarding to an external address and deleting the original, means the user never sees replies to messages sent in their name. A registered authentication method the user does not recognise means the attacker can pass MFA on their own. Each of these has to be removed explicitly; none of them go away with the credential.',
      branches:[
        { when:'Unrecognised inbox rule', then:'Remove it and record it — it is evidence of what they were after.' },
        { when:'External forwarding set', then:'Remove it, then find out what was forwarded and for how long.' },
        { when:'Unknown authentication method', then:'Remove it. They can pass MFA without it being removed.' },
        { when:'Nothing found', then:'Good, but keep going — consent grants are the quieter mechanism.' } ] },

    { check:'Was an application consented to?', cmd:'Get-MgOauth2PermissionGrant -All -Filter "principalId eq \'$userId\'"   ·   Get-MgServicePrincipal -ServicePrincipalId $clientId | Select-Object DisplayName,AppOwnerOrganizationId',
      decide:'A grant over mail or files means an app can read the mailbox with its own token.',
      why:'Illicit consent grants are the mechanism people miss, because no password is involved at all: the user was phished into approving an application requesting `Mail.Read` and `offline_access`, and the attacker reads mail through Graph with a legitimate token that survives every password reset and every session revocation. Check `AppOwnerOrganizationId` — an app owned by a tenant you do not recognise, consented to by one user, granting mail access, is the shape of the attack.',
      branches:[
        { when:'Grant over Mail or Files', then:'Revoke the grant and the tokens. This is the access that outlives the password.' },
        { when:'Consented for AllPrincipals', then:'An administrator approved it tenant-wide. Much larger blast radius.' },
        { when:'No suspicious grants', then:'Move to scope: what did they actually reach.' } ] },

    { check:'What did they reach?', cmd:'Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-14) -EndDate (Get-Date) -UserIds jo@contoso.com -Operations MailItemsAccessed,FileDownloaded,FileSyncDownloadedFull,Add-MailboxPermission',
      decide:'This is the evidence a breach-notification decision turns on.',
      why:'`MailItemsAccessed` is what answers "was the data actually read", which is a legal question as much as a technical one. Two caveats matter: the operation requires auditing to have been on beforehand — it is enabled by default now, but not retroactively — and retention depends on licensing, ninety days on E3 and longer on E5. If the account had delegated access to shared mailboxes, or held a directory role, the blast radius is much wider than one mailbox and the search has to widen with it.',
      branches:[
        { when:'MailItemsAccessed records exist', then:'Enumerate what was read. Involve whoever owns breach notification.' },
        { when:'No records but auditing was off', then:'Absence is not evidence. Say so plainly in the report.' },
        { when:'The account held a privileged role', then:'Treat as a tenant incident, not a user one — check directory audit logs.' },
        { when:'Files downloaded in bulk', then:'Data exfiltration. Scope it before anyone asks.' } ] },

    { check:'Restore and harden', cmd:'Get-MgUserAuthenticationMethod -UserId jo@contoso.com   ·   Get-MgAuditLogSignIn -Filter "userPrincipalName eq \'jo@contoso.com\'" -Top 10',
      decide:'Re-register the user cleanly, then close the route in.',
      why:'Bring them back with a Temporary Access Pass and a freshly registered method — ideally a phishing-resistant one, since FIDO2 or a passkey cannot be phished and Authenticator with number matching is far better than SMS. Then close the route: if it was MFA fatigue, number matching stops it; if it was consent phishing, the user consent policy and the admin consent workflow stop it; if it was a password spray from an unusual location, Conditional Access on location or sign-in risk stops it.',
      branches:[
        { when:'MFA fatigue', then:'Number matching and additional context in Authenticator.' },
        { when:'Consent phishing', then:'Restrict user consent to verified publishers and enable the admin consent workflow.' },
        { when:'Password spray', then:'Sign-in risk policy, and check whether legacy authentication is still permitted.' },
        { when:'Contained', then:'Write it up. The next one will be the same shape.' } ] } ],
  probes:[
    ['Why is a password reset not enough?','Because none of the persistence mechanisms depend on the password: inbox rules, mailbox forwarding, a registered authentication method and an OAuth consent grant all survive it. Revoke sessions, remove each mechanism explicitly, then reset.'],
    ['What is an illicit consent grant?','The user approves an application requesting permissions like Mail.Read and offline_access. The attacker then reads mail through Graph with a legitimate token, with no password involved — so resetting the credential changes nothing. Revoking the grant is what cuts access.'],
    ['MFA fatigue — what is the fix?','Number matching and additional context in Microsoft Authenticator, so approving requires typing a number shown on the sign-in screen rather than tapping a button. Phishing-resistant methods remove the attack entirely.'],
    ['How do you know whether data was actually accessed?','MailItemsAccessed and file operations in the unified audit log. It requires auditing to have been enabled beforehand and retention that reaches back far enough — both decisions made long before the incident.']
  ],
  trap:'Resetting the password and closing the ticket. The forwarding rule, the extra authentication method and the consent grant are all still there, and none of them cared about the password.',
  remember:'Revoke, then hunt persistence — rules, forwarding, methods, consent — then scope with the audit log. Reset alone fixes nothing.'
},

/* ═══ 8. device compliance ═══ */
{
  id:'en-device-blocked', track:'entra', title:'Devices went non-compliant and users are blocked', cat:'intune', level:'intermediate',
  cert:['ms-102:devices','sc-300:access'],
  prompt:'"A compliance policy change went out this morning and now half the fleet cannot sign in. Explain what happened."',
  say:'"Two systems interacting. Intune decides compliance and Conditional Access enforces it, so a compliance rule that tightens turns instantly into a sign-in failure for anyone whose device does not meet it. The specific error is AADSTS53000, device not compliant, which is different from a plain Conditional Access block. Then the timing question: compliance is evaluated by the device at check-in, so devices that have not checked in recently carry whatever state they last reported — which means both false blocks and stale passes. The immediate lever is the Conditional Access policy, not the compliance policy, because it takes effect faster."',
  steps:[
    { check:'Confirm it is device compliance, not something else', cmd:'Get-MgAuditLogSignIn -Filter "status/errorCode eq 53000" -Top 20 | Select-Object UserPrincipalName,AppDisplayName,@{n=\'Dev\';e={$_.DeviceDetail.DisplayName}}',
      decide:'53000 is device not compliant; 53003 is a Conditional Access block generally; 53001 is not domain joined.',
      why:'The codes distinguish three different problems that all look like "cannot sign in". 53000 means the policy required a compliant device and Intune says this one is not. 53001 means it required hybrid Azure AD join and the device is not joined at all — a different fix entirely. Counting affected users here also tells you the scale, which decides whether this is a rollback or a support queue.',
      branches:[
        { when:'53000 across many users', then:'Compliance. Find out which rule they are failing.' },
        { when:'53001', then:'Device registration, not compliance. Different remediation.' },
        { when:'53003 without 53000', then:'A different Conditional Access condition', goto:'en-ca-lockout' } ] },

    { check:'Which rule are they failing?', cmd:'Get-MgDeviceManagementManagedDevice -Filter "complianceState eq \'noncompliant\'" -All | Select-Object DeviceName,UserPrincipalName,OsVersion,LastSyncDateTime   ·   Get-MgDeviceManagementManagedDeviceCompliancePolicyState -ManagedDeviceId $id',
      decide:'The per-policy state names the setting, not just the verdict.',
      why:'"Non-compliant" is a summary; the per-policy state is the reason. The usual causes of a sudden fleet-wide failure are an operating-system version floor raised past what the fleet is actually running, a disk-encryption requirement on devices that were never encrypted, or a defender or firewall setting the devices cannot report. `LastSyncDateTime` is the other half: a device that has not checked in cannot have evaluated the new rule at all.',
      branches:[
        { when:'OS version floor', then:'The fleet needs updating. That is a patching project, not a today fix.' },
        { when:'Encryption requirement', then:'Encryption takes time and may need user action. Grace period, not enforcement.' },
        { when:'Devices have not synced', then:'They cannot pass a rule they have not seen. That is a timing problem.' },
        { when:'Genuinely non-compliant', then:'The policy is right and the fleet is not. Decide which one moves.' } ] },

    { check:'Restore access with the faster lever', cmd:'Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $ca -State "enabledForReportingButNotEnforced"',
      decide:'Flip the Conditional Access policy, not the compliance policy.',
      why:'Loosening the compliance policy does not restore access quickly, because each device has to check in and re-evaluate before its state changes — that is minutes to hours across a fleet. Putting the Conditional Access policy into report-only stops the blocking immediately while keeping the telemetry. It is the same rollback lever as any other CA incident, and knowing which of the two systems to touch is most of the speed here.',
      branches:[
        { when:'Users get in again', then:'Contained. Now fix compliance properly.' },
        { when:'Still blocked', then:'Another policy is also failing — read AppliedConditionalAccessPolicies.' },
        { when:'Tempted to loosen compliance instead', then:'Slower, and it leaves the CA policy ready to block again.' } ] },

    { check:'Check the grace period', cmd:'(Get-MgDeviceManagementDeviceCompliancePolicy -DeviceCompliancePolicyId $p).ScheduledActionsForRule.ScheduledActionConfigurations',
      decide:'Zero hours means devices are marked non-compliant the instant they fail.',
      why:'This setting is the difference between a rollout and an outage. With a grace period, a device that fails a new rule stays compliant for a day or two while the user is notified and remediation runs; with zero, it flips immediately and Conditional Access blocks it on the next sign-in. Most fleet-wide compliance incidents are this setting rather than the rule itself, and it is checked in one call before enabling anything.',
      branches:[
        { when:'Grace period is zero', then:'Set one or two days and let remediation catch up.' },
        { when:'Grace period exists but was exceeded', then:'The rule has been failing for days and nobody watched the report.' },
        { when:'Rule is genuinely unmeetable', then:'Withdraw it. A rule the fleet cannot satisfy is not a control.' } ] },

    { check:'Redeploy in the right order', cmd:'# compliance policy to a pilot group first   ·   Get-MgDeviceManagementDeviceCompliancePolicyDeviceStatus -DeviceCompliancePolicyId $p | Group-Object Status',
      decide:'Pilot group, grace period, report-only Conditional Access, then enforce.',
      why:'The safe order inverts what happened: target a pilot group, give it a real grace period, watch the device status report until the pass rate is acceptable, keep the Conditional Access policy in report-only throughout, and only then enforce. The status grouping gives you the number to decide on — enforcing at an eighty percent pass rate means a fifth of the company cannot work, and that number is knowable in advance.',
      branches:[
        { when:'Pass rate acceptable', then:'Enforce, and watch the sign-in logs for the first hour.' },
        { when:'Pass rate low', then:'The fleet is not ready. Remediate first; the date is not the point.' },
        { when:'Some devices never report', then:'They are unmanaged in practice. That is a separate and larger problem.' } ] } ],
  probes:[
    ['How do Intune and Conditional Access interact?','Intune evaluates compliance and writes the state to the device object; Conditional Access reads that state as a grant control. They are separate systems, so a compliance change becomes an access change with a delay — and the fast rollback lever is the CA policy, not the compliance policy.'],
    ['What is AADSTS53000?','The Conditional Access policy required a compliant device and Intune reported this one as non-compliant. 53001 is the related but different case of a device that is not hybrid joined at all.'],
    ['Why do devices stay non-compliant after being fixed?','Compliance is evaluated at check-in, not continuously. Until the device syncs, it carries its last reported state — which is also why a device that has stopped checking in can stay compliant long after it should not.'],
    ['Compliance policy versus configuration profile.','A compliance policy checks and reports; a configuration profile pushes settings. Expecting a compliance policy to fix a device is a common and expensive misunderstanding.']
  ],
  trap:'Excluding the affected users from the Conditional Access policy. It restores access and permanently removes the device requirement for exactly the people whose devices are known not to meet it.',
  remember:'Intune judges, Conditional Access enforces. Roll back at the CA policy, and check the grace period before enabling anything.'
}

);
