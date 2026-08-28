/* Identity & M365 labs. Both are incidents where the obvious action is the
   wrong one: unblocking people by adding exclusions, and closing a compromise
   with a password reset. The wrong options carry as much of the teaching as
   the right ones.                                                           */
window.LX = window.LX || {};
LX.labs = LX.labs || [];

LX.labs.push(

/* ─────────────────────────────────── 1. CA lockout ── */
{
  id:'en-l-lockout', title:'A Conditional Access rollout locked out the service desk', cat:'ca',
  track:'entra', level:'advanced', mins:10,
  brief:'08:20. A "Require compliant device" policy was enabled at 08:00 as part of the zero-trust programme. The service desk cannot sign in to anything, tickets are stacking up, and the person who enabled it is on a train. You have a Global Administrator account that you can still sign in with.',
  user:'you', host:'PowerShell',
  steps:[
    { kind:'think',
      ask:'You can still sign in. Before anything else, what does that tell you — and what does it not?',
      hint:'Think about why your account works when theirs does not.',
      opts:[
        { t:'Your device satisfies the policy, or you are excluded — either way you have a working path in, and that is not the same as the policy being safe', ok:true,
          fb:'Right, and it is worth naming explicitly. Your access is incidental: if your device drops out of compliance, or someone edits the policy again, you lose it too. The first job is to confirm there is a break-glass account that is excluded from every policy, because that is the access that does not depend on luck.' },
        { t:'The policy is not applying tenant-wide, so only some users are affected',
          fb:'A reasonable hypothesis and the sign-in logs will settle it, but do not assume from your own success — you may simply be on a compliant device while the service desk is on shared kiosks that are not enrolled.' },
        { t:'Global Administrators are automatically exempt from Conditional Access',
          fb:'They are not. Conditional Access applies to directory roles like any other principal, and a policy targeting All users includes every administrator. That belief is precisely how tenants lock themselves out completely.' },
        { t:'The policy has not finished propagating yet',
          fb:'Propagation takes minutes, and it has been twenty. More importantly, partial propagation would produce intermittent failures rather than one consistent group being blocked.' }
      ] },

    { kind:'cmd',
      ask:'Confirm you have a path in that does not depend on luck.',
      hint:'Every policy should exclude the break-glass accounts. Check, rather than believe.',
      opts:[
        { c:'Get-MgIdentityConditionalAccessPolicy -All | Select-Object DisplayName,State,@{n=\'Excl\';e={$_.Conditions.Users.ExcludeUsers.Count}}', ok:true,
          out:'DisplayName                       State                              Excl\n--------------------------------  ---------------------------------  ----\nRequire MFA for all users         enabled                               2\nBlock legacy authentication       enabled                               2\nRequire compliant device          enabled                               0',
          fb:'The two established policies exclude the break-glass accounts and the new one excludes nobody. That is the defect, and it means your break-glass account is currently blocked too — so the working path is your own session, which you should not lose.',
          parts:[['Get-MgIdentityConditionalAccessPolicy -All','Every policy, not just the one you were told about'],['ExcludeUsers.Count','A count of zero on an enabled policy is the shape that locks a tenant out']] },
        { c:'Get-MgDirectoryRole -All | Where-Object DisplayName -eq "Global Administrator" | ForEach-Object { Get-MgDirectoryRoleMember -DirectoryRoleId $_.Id -All }',
          out:'Id\n--\n9f2c4a11-…\n3b81e7d0-…\n7c04f9a2-…',
          fb:'Three Global Administrators, which is useful context for later. It does not tell you whether any of them can currently sign in — which is the question that matters at 08:20.' },
        { c:'Get-MgContext | Select-Object Account,Scopes',
          out:'Account : admin@contoso.com\nScopes  : {Policy.ReadWrite.ConditionalAccess, Directory.Read.All, AuditLog.Read.All}',
          fb:'Worth confirming you hold Policy.ReadWrite.ConditionalAccess, since without it the rollback will fail at the worst moment. But it says nothing about whether anyone else can get in.' },
        { c:'Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id -State "disabled"',
          out:'(no output)',
          fb:'You may well end up doing exactly this, and quickly. Doing it before you have confirmed which policy is actually blocking means you might disable the wrong one, learn nothing, and still have an outage.' }
      ] },

    { kind:'cmd',
      ask:'Confirm which policy is blocking, from the evidence rather than the assumption.',
      hint:'Every sign-in records the policies evaluated and their results.',
      opts:[
        { c:'(Get-MgAuditLogSignIn -Filter "userPrincipalName eq \'desk1@contoso.com\' and status/errorCode ne 0" -Top 1).AppliedConditionalAccessPolicies | Select-Object DisplayName,Result', ok:true,
          out:'DisplayName                       Result\n--------------------------------  -----------\nRequire MFA for all users         success\nBlock legacy authentication       notApplied\nRequire compliant device          failure',
          fb:'Confirmed from the log rather than from the change record. The MFA policy was satisfied, the legacy policy did not apply to this attempt, and the compliant-device policy failed. This is also proof that the other two policies are not contributing.',
          parts:[['AppliedConditionalAccessPolicies','Every policy evaluated for that sign-in, with its outcome'],['failure','The policy that blocked'],['notApplied','Conditions did not match — this rules a policy out, which is just as useful']] },
        { c:'Get-MgAuditLogSignIn -Filter "status/errorCode eq 53003" -Top 50 | Group-Object UserPrincipalName | Sort-Object Count -Descending',
          out:'Count Name\n----- ----\n   14 desk1@contoso.com\n   11 desk2@contoso.com\n    9 desk3@contoso.com\n  … 41 users total',
          fb:'Excellent for scope — forty-one users, which tells you this is a rollback rather than a support queue. It does not name which policy, and with three enabled policies that is still a guess.' },
        { c:'Get-MgAuditLogSignIn -Filter "userPrincipalName eq \'desk1@contoso.com\'" -Top 5 | Select-Object CreatedDateTime,@{n=\'Err\';e={$_.Status.ErrorCode}}',
          out:'CreatedDateTime      Err\n-------------------  -----\n2026-08-28 08:19:44  53000\n2026-08-28 08:17:02  53000\n2026-08-27 16:40:11      0',
          fb:'53000 is device not compliant, which is a strong hint and better than 53003 would be — but the applied-policies field names the policy outright, which is what you want before touching anything.' },
        { c:'Get-MgDeviceManagementManagedDevice -Filter "complianceState eq \'noncompliant\'" -All | Measure-Object',
          out:'Count : 214',
          fb:'A big number and useful later. Right now it conflates two different populations — devices that genuinely fail a rule and devices that have simply not checked in — and neither tells you which policy is blocking.' }
      ] },

    { kind:'cmd',
      ask:'Restore access. What do you actually run?',
      hint:'There are two rollback states and one of them keeps the data you need.',
      opts:[
        { c:'Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id -State "enabledForReportingButNotEnforced"', ok:true,
          out:'(no output)\n\n$ Get-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id | Select DisplayName,State\nDisplayName : Require compliant device\nState       : enabledForReportingButNotEnforced',
          fb:'Report-only is the better rollback. Users get in within minutes and the policy keeps evaluating and recording what it would have done — which is exactly the dataset you need to fix it properly instead of guessing twice.',
          parts:[['enabledForReportingButNotEnforced','Evaluates and records; blocks nobody'],['Update-…-State','A state change, so the policy definition and its history are preserved']] },
        { c:'Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id -State "disabled"',
          out:'(no output)',
          fb:'This works and restores access just as fast. The cost is the telemetry: a disabled policy evaluates nothing, so you lose the data that would tell you who is still affected and when it is safe to re-enable.' },
        { c:'Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id -BodyParameter @{ conditions=@{ users=@{ excludeGroups=@($serviceDeskGroupId) } } }',
          out:'(no output)',
          fb:'This is the tempting one and it is the trap. It restores the service desk and permanently removes the device requirement for the group most likely to be targeted — and nobody ever audits an exclusion added during an incident.' },
        { c:'Remove-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id',
          out:'(no output)',
          fb:'You have destroyed the policy, its configuration and its history. Somebody now has to rewrite it from memory, which is how the same mistake gets made twice.' }
      ] },

    { kind:'cmd',
      ask:'Access is back. Now find out what the policy actually did.',
      hint:'Read the assignment and the grant control together.',
      opts:[
        { c:'Get-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id | Select-Object -ExpandProperty Conditions | Format-List; (Get-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id).GrantControls', ok:true,
          out:'Users        : @{IncludeUsers=All; ExcludeUsers=System.Object[]; ExcludeGroups=}\nApplications : @{IncludeApplications=All}\nPlatforms    :\nClientAppTypes : {all}\n\nOperator        : OR\nBuiltInControls : {compliantDevice}',
          fb:'All users, all applications, no exclusions, and the only way to satisfy it is a compliant device. That catches break-glass accounts, service principals, unenrolled kiosks and anyone whose device has not checked in — which is the entire service desk on shared machines.',
          parts:[['IncludeUsers=All','With an empty exclusion list, this includes the accounts you would use to fix it'],['IncludeApplications=All','Every application, including the ones administrators use'],['{compliantDevice}','The only grant control, so there is no alternative way to satisfy the policy']] },
        { c:'Get-MgAuditLogDirectoryAudit -Filter "activityDisplayName eq \'Add conditional access policy\'" -Top 3 | Select-Object ActivityDateTime,@{n=\'By\';e={$_.InitiatedBy.User.UserPrincipalName}}',
          out:'ActivityDateTime      By\n--------------------  -------------------------\n2026-08-28 08:00:14   priya@contoso.com',
          fb:'Correct and worth having for the write-up — it dates the change and names who made it. It does not tell you what the policy does, which is what stops it recurring.' },
        { c:'Get-MgDeviceManagementManagedDevice -Filter "complianceState eq \'noncompliant\'" -All | Select-Object DeviceName,UserPrincipalName -First 5',
          out:'DeviceName    UserPrincipalName\n------------  ------------------\nKIOSK-01      desk1@contoso.com\nKIOSK-02      desk2@contoso.com\nLAPTOP-4471   jo@contoso.com',
          fb:'The kiosk names are a strong clue about why the service desk specifically is affected. It is a good next step — but reading the policy tells you why *anyone* was affected, which is the more general answer.' },
        { c:'Get-MgIdentityConditionalAccessPolicy -All | Select-Object DisplayName,State',
          out:'Require MFA for all users         enabled\nBlock legacy authentication       enabled\nRequire compliant device          enabledForReportingButNotEnforced',
          fb:'Confirms the rollback took effect, which you already know. It says nothing about what the policy requires or who it targets.' }
      ] },

    { kind:'think',
      ask:'Why did the service desk get hit and not everyone?',
      hint:'The policy targeted All users. Something else varied.',
      opts:[
        { t:'They work on shared kiosks that are not Intune-enrolled, so those devices can never report as compliant', ok:true,
          fb:'That is it. The policy did apply to everyone; most people are on enrolled laptops that are compliant, so they satisfied it silently and noticed nothing. Shared and kiosk devices are the standard blind spot in a device-based policy — along with contractors on unmanaged machines and anything using a service principal.' },
        { t:'The service desk has a different licence that does not include Conditional Access',
          fb:'Conditional Access is enforced tenant-wide by the policy, not per user licence. Licensing decides whether the tenant may use the feature, not who it applies to once enabled.' },
        { t:'A Conditional Access policy was applied to their group specifically',
          fb:'The conditions you just read say IncludeUsers=All with no group targeting. The variation is in the devices, not in the assignment.' },
        { t:'Their accounts are synced from on-premises and cloud policies do not reach them',
          fb:'Conditional Access applies to the sign-in regardless of where the object is mastered. Source of authority governs object edits, not policy evaluation.' }
      ] },

    { kind:'cmd',
      ask:'Fix the policy properly before it goes back on.',
      hint:'The break-glass exclusion is not optional, and the kiosks need a real answer.',
      opts:[
        { c:'Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id -BodyParameter @{ conditions=@{ users=@{ includeUsers=@("All"); excludeUsers=@($bg1,$bg2) } } }', ok:true,
          out:'(no output)\n\n$ … | Select-Object -ExpandProperty Conditions\nUsers : @{IncludeUsers=All; ExcludeUsers=System.Object[]}   # 2 entries',
          fb:'Break-glass accounts excluded, and the policy still targets everyone — which is what you want. Note what this does not do: it does not fix the kiosks. That is a separate decision about whether those devices get enrolled or whether the policy scopes around them deliberately.',
          parts:[['excludeUsers=@($bg1,$bg2)','The two break-glass accounts, by object id — the exclusion that must exist before any policy is enabled'],['includeUsers=@("All")','Kept deliberately: the fix is the exclusion, not narrowing the target']] },
        { c:'Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id -BodyParameter @{ conditions=@{ users=@{ includeGroups=@($pilotGroup) } } }',
          out:'(no output)',
          fb:'Scoping to a pilot group is a genuinely good rollout technique and worth doing. On its own it leaves the break-glass accounts unexcluded, so the moment the policy widens you are back in the same position.' },
        { c:'Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id -BodyParameter @{ grantControls=@{ operator="OR"; builtInControls=@("compliantDevice","mfa") } }',
          out:'(no output)',
          fb:'With operator OR this now lets MFA alone satisfy the policy — which is a much weaker control and probably not what the zero-trust programme meant. If both are genuinely required, the operator has to be AND, and then the kiosks are still blocked.' },
        { c:'New-MgIdentityConditionalAccessPolicy -BodyParameter @{ displayName="Require compliant device v2"; state="enabled" }',
          out:'(no output)',
          fb:'A second policy alongside the first, enabled immediately, with no exclusions. Policies are additive, so you have just added another way to block people while the original is still there.' }
      ] },

    { kind:'cmd',
      ask:'Decide when it is safe to enforce.',
      hint:'Report-only has been running. Use what it recorded.',
      opts:[
        { c:'Get-MgAuditLogSignIn -Filter "createdDateTime ge 2026-08-28T09:00:00Z" -All | ForEach-Object { $_.AppliedConditionalAccessPolicies | Where-Object DisplayName -eq "Require compliant device" } | Group-Object Result', ok:true,
          out:'Count Name\n----- ----------\n  892 success\n   41 failure\n  116 notApplied',
          fb:'Forty-one sign-ins would still be blocked — the same population as the original incident, so nothing has been remediated yet. That number is the enforcement decision: it is knowable in advance, and it is exactly what report-only mode exists to produce.',
          parts:[['createdDateTime ge','Bound the window to since the rollback, or old failures skew it'],['Group-Object Result','The count of would-be failures — the number that decides whether to enforce']] },
        { c:'Get-MgDeviceManagementManagedDevice -Filter "complianceState eq \'compliant\'" -All | Measure-Object',
          out:'Count : 178',
          fb:'A device count, not a people count, and it says nothing about who is actually trying to sign in. Someone with three compliant devices and one unenrolled kiosk is fine on paper and blocked in practice.' },
        { c:'Get-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id | Select-Object State',
          out:'State : enabledForReportingButNotEnforced',
          fb:'Confirms the policy is still in report-only, which you set. It does not tell you what report-only has learned, which is the entire reason for being in that state.' },
        { c:'Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $id -State "enabled"',
          out:'(no output)',
          fb:'You have re-enabled it without reading the report-only data. The kiosks are still unenrolled, so the service desk is locked out for a second time — this time by you, and with an audit trail saying so.' }
      ] },

    { kind:'think',
      ask:'What is the change that makes this not happen again?',
      hint:'Two of these are process, one is a control, one is not a fix.',
      opts:[
        { t:'Break-glass exclusions applied to every policy as a standing rule, and report-only as a mandatory stage before any enable', ok:true,
          fb:'Both, and they are cheap. The exclusion is the control that makes every future mistake reversible; report-only is the process that turns "who will this break" from a guess into a number. Enforcing that pair — ideally by reviewing CA policy changes the way you review production code — is what separates a mature tenant from a lucky one.' },
        { t:'Restrict who can edit Conditional Access policies',
          fb:'Worth doing, and PIM for the Conditional Access Administrator role is a reasonable control. But the person who made this change was authorised to make it — the gap was the process, not the permission.' },
        { t:'Enrol the kiosks in Intune so they can report compliance',
          fb:'This solves today\'s specific blocker and should happen. It does nothing about the next policy targeting something the kiosks or another population cannot satisfy, which is the recurring shape.' },
        { t:'Send an announcement before enabling any Conditional Access policy',
          fb:'Communication helps people understand an outage; it does not prevent one. The service desk would have known why they could not sign in, and still could not have signed in.' }
      ] }
  ],
  debrief:{
    why:[
      'Your own working session was luck, not a control. Confirming a break-glass account exists and is excluded is the first move, because it is the access that survives the next mistake.',
      'AppliedConditionalAccessPolicies named the blocking policy from evidence rather than from the change record, and its notApplied results ruled the other two policies out at the same time.',
      'Report-only was the right rollback rather than disabling: access returns just as fast and the policy keeps recording what it would have done, which is the dataset needed to fix it once instead of twice.',
      'Adding an exclusion for the affected group would have restored access and permanently removed the device requirement from the people most worth protecting — and nobody audits an exclusion added during an incident.',
      'The policy read All users, All applications, no exclusions, with a single grant control of compliantDevice. That combination catches break-glass accounts, service principals and every unenrolled device.',
      'The service desk was hit because they work on shared kiosks that are not enrolled, which is the standard blind spot of any device-based policy — along with contractors and anything non-interactive.',
      'The enforcement decision came from the report-only counts: forty-one sign-ins would still fail, the same population as the incident, so nothing had been remediated yet.'
    ],
    interview:'Lead with the two facts that make Conditional Access tractable. "Policies are additive — every applicable one has to pass and none of them grant access — and every sign-in records which policies were evaluated and what each returned. So I confirm I still have a break-glass path, then read AppliedConditionalAccessPolicies on a blocked sign-in to name the policy from evidence. I roll back to report-only rather than disabled, because access comes back just as fast and I keep the telemetry. Then I read the assignment and the grant control together: this one was All users, All applications, no exclusions, compliant device only, which catches break-glass accounts and every unenrolled machine — here, the service desk\'s shared kiosks. The fix is the exclusion plus report-only as a mandatory stage, and the number that decides when to enforce is the report-only failure count. What I would not do is add an exclusion for the affected group, because that permanently removes the control from the people most likely to be targeted."',
    prevent:[
      'Two break-glass accounts, cloud-only, excluded from every Conditional Access policy, alerted on, and tested on a schedule.',
      'Report-only as a mandatory stage: no policy goes to enabled without a report-only period and a failure count somebody has read.',
      'Review Conditional Access changes the way you review production code — they have the same blast radius and less rollback.',
      'Name policies for what they require and who they target, so the next person reading twenty of them at speed can find the one that matters.',
      'Keep an inventory of what cannot satisfy device-based controls — kiosks, contractors, service principals, legacy clients — and answer for each before enabling, rather than discovering them as an outage.'
    ]
  }
},

/* ────────────────────────── 2. business email compromise ── */
{
  id:'en-l-bec', title:'Finance is sending invoices nobody wrote', cat:'exo',
  track:'entra', level:'advanced', mins:11,
  brief:'A supplier calls: they have received an email from your accounts-payable manager asking them to update the bank details on file. She did not send it, and it is not in her sent items. She mentions she approved an unexpected sign-in prompt on Tuesday because it "kept nagging". It is now Friday.',
  user:'you', host:'PowerShell',
  steps:[
    { kind:'think',
      ask:'She approved an MFA prompt she did not initiate. What does that establish?',
      hint:'Think about what has to happen before a prompt appears at all.',
      opts:[
        { t:'Someone else already had her password — the prompt only comes after the first factor succeeds', ok:true,
          fb:'Exactly, and it dates the compromise to Tuesday at the latest. MFA fatigue works precisely this way: repeated prompts until a tired person approves one. Three days is long enough to have set up persistence, read the mailbox and study how she writes — so treat everything from Tuesday onwards as attacker-visible.' },
        { t:'Her MFA method is broken and generating spurious prompts',
          fb:'Prompts are generated by sign-in attempts, not by the method. A prompt she did not trigger means an attempt she did not make, and that attempt got past the password.' },
        { t:'Someone spoofed her address from outside — no account access is implied',
          fb:'Possible for the outbound mail alone, but it would not produce MFA prompts. The prompt is the tell that separates a spoof from a genuine compromise, and it points at the latter.' },
        { t:'Her device is infected and generating the prompts locally',
          fb:'Malware is worth ruling out later, but the prompt originates from a sign-in attempt reaching Entra. Start with what the sign-in logs actually record.' }
      ] },

    { kind:'cmd',
      ask:'Contain. What is the first command?',
      hint:'One of these stops the attacker; another one alerts them without stopping them.',
      opts:[
        { c:'Revoke-MgUserSignInSession -UserId finance@contoso.com; Update-MgUser -UserId finance@contoso.com -AccountEnabled:$false', ok:true,
          out:'(no output)\n\n$ Get-MgAuditLogSignIn -Filter "userPrincipalName eq \'finance@contoso.com\'" -Top 1\nCreatedDateTime      ErrorCode  FailureReason\n2026-08-28 11:02:44  50057      User account is disabled.',
          fb:'Revoke then disable, and confirm from the log rather than assuming. Revocation invalidates the refresh tokens so an existing session cannot renew; disabling stops new sign-ins. Doing only the second leaves an already-issued token working for the rest of the hour.',
          parts:[['Revoke-MgUserSignInSession','Invalidates refresh tokens — without this a live session survives a disable'],['-AccountEnabled:$false','Stops new sign-ins'],['50057','Confirmation from the sign-in log that containment took effect']] },
        { c:'Update-MgUser -UserId finance@contoso.com -PasswordProfile @{ forceChangePasswordNextSignIn=$true; password=$new }',
          out:'(no output)',
          fb:'A password reset without revoking sessions leaves every existing token alive, so the attacker keeps working while the legitimate user is locked out of her own account. It also tells the attacker they have been noticed. Reset is part of the answer, not the first part.' },
        { c:'Set-Mailbox finance@contoso.com -ForwardingSmtpAddress $null',
          out:'(no output)',
          fb:'You have removed a persistence mechanism before recording it — and if it was set, you have just destroyed evidence of where mail was going. Contain the identity first; enumerate and record persistence second.' },
        { c:'Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date) -UserIds finance@contoso.com',
          out:'… 3,412 records',
          fb:'You will need this, and shortly. Running it first means the attacker has an active session for however long the search takes and however long you spend reading it.' }
      ] },

    { kind:'cmd',
      ask:'Find what was set up. What do you check, and in what order?',
      hint:'The mechanisms that survive a password reset.',
      opts:[
        { c:'Get-InboxRule -Mailbox finance@contoso.com | Select-Object Name,Enabled,ForwardTo,DeleteMessage,MoveToFolder', ok:true,
          out:'Name  Enabled  ForwardTo                DeleteMessage  MoveToFolder\n----  -------  -----------------------  -------------  ------------\n.     True     ap-collect@mailbox.top   True           RSS Subscriptions',
          fb:'The classic shape: a rule named with a single full stop, forwarding externally, deleting the original and filing anything left in a folder nobody opens. That is why the supplier\'s replies never reached her and why the sent message is not in her sent items — the attacker sent from a session and cleaned up behind it.',
          parts:[['Get-InboxRule','Client-side rules, which live in the mailbox and survive a password reset'],['Name  .','A one-character name is deliberate — it is hard to see and easy to overlook'],['DeleteMessage  True','The victim never sees replies to mail sent in her name']] },
        { c:'Get-MgUser -UserId finance@contoso.com -Property signInActivity | Select-Object -ExpandProperty SignInActivity',
          out:'LastSignInDateTime               : 2026-08-28T10:41:02Z\nLastNonInteractiveSignInDateTime : 2026-08-28T10:58:19Z',
          fb:'Confirms activity right up to containment, which is worth recording. It does not tell you what was configured, and configuration is what outlives the credential.' },
        { c:'Get-MessageTrace -SenderAddress finance@contoso.com -StartDate (Get-Date).AddDays(-5) -EndDate (Get-Date)',
          out:'Received             RecipientAddress          Subject                        Status\n2026-08-27 14:22:08  accounts@supplier.com     Updated bank details            Delivered\n2026-08-26 09:14:51  accounts@othervendor.com  Updated remittance information  Delivered',
          fb:'Two fraudulent emails to two suppliers, which is critical scope and you must run this. As the immediate next step it is second: the rules and grants are what let the attacker keep going, and they need finding before anything else changes.' },
        { c:'Get-MailboxPermission -Identity finance@contoso.com',
          out:'User                  AccessRights\n--------------------  ------------\nNT AUTHORITY\\SELF     {FullAccess}',
          fb:'Clean, and worth checking — delegated mailbox access is a real persistence route. Rules and forwarding are far more common and faster to check, so they come first.' }
      ] },

    { kind:'cmd',
      ask:'What else did they leave behind?',
      hint:'Two more mechanisms that do not care about the password.',
      opts:[
        { c:'Get-MgUserAuthenticationMethod -UserId finance@contoso.com; Get-MgOauth2PermissionGrant -All -Filter "principalId eq \'$uid\'"', ok:true,
          out:'#microsoft.graph.microsoftAuthenticatorAuthenticationMethod\n#microsoft.graph.phoneAuthenticationMethod   (+1 555 0142, registered 2026-08-25)\n\nClientId    : 0a4f91b2-…\nConsentType : Principal\nScope       : Mail.Read Mail.Send offline_access',
          fb:'Both. A phone method registered on Tuesday means the attacker can pass MFA on their own from now on. And a consent grant with offline_access means an application holds its own refresh token to read and send her mail — that one survives password resets and session revocations alike.',
          parts:[['registered 2026-08-25','Tuesday — the same day as the approved prompt, which dates the whole intrusion'],['Mail.Read Mail.Send offline_access','Read and send indefinitely, with no password involved'],['ConsentType : Principal','One user consented, rather than an administrator consenting tenant-wide']] },
        { c:'Get-MgUserAuthenticationMethod -UserId finance@contoso.com',
          out:'#microsoft.graph.microsoftAuthenticatorAuthenticationMethod\n#microsoft.graph.phoneAuthenticationMethod   (+1 555 0142, registered 2026-08-25)',
          fb:'Half of it, and the half you found is genuinely important. Stopping here misses the consent grant, which is the mechanism that would have kept working after you did everything else correctly.' },
        { c:'Get-MgAuditLogDirectoryAudit -Filter "targetResources/any(t: t/userPrincipalName eq \'finance@contoso.com\')" -Top 20',
          out:'ActivityDateTime      ActivityDisplayName            Result\n2026-08-25 03:12:44   User registered security info  success\n2026-08-25 03:14:02   Consent to application         success',
          fb:'A very good answer — the directory audit log records both events with timestamps, which is exactly the evidence trail you want. Enumerating the live objects is the more direct route to knowing what is still in place right now.' },
        { c:'Remove-MgOauth2PermissionGrant -OAuth2PermissionGrantId $id',
          out:'(no output)',
          fb:'Right action, wrong moment — you have removed the grant before recording what it was, who owned the application, and what it could reach. That detail is what tells you the scope of what was accessed.' }
      ] },

    { kind:'think',
      ask:'You have found a rule, a registered phone, and a consent grant. Why is a password reset not enough?',
      hint:'Ask which of the three depends on the password.',
      opts:[
        { t:'None of them do — the rule lives in the mailbox, the method is registered to the account, and the consent grant carries its own refresh token', ok:true,
          fb:'That is the whole lesson of this incident. A password reset addresses only the original entry route. The rule keeps forwarding, the attacker\'s phone still satisfies MFA, and the consented application keeps reading and sending mail with a token that was never derived from her credential. Each has to be removed explicitly.' },
        { t:'It is enough as long as you also revoke sessions',
          fb:'Revocation kills the refresh tokens for her user sessions. The consented application holds its own grant, and the inbox rule and registered method are configuration on the account rather than session state.' },
        { t:'It is enough because the attacker will lose access at the next MFA prompt',
          fb:'They registered their own method on Tuesday, so the prompt goes to them. That is exactly why the registered-methods check matters.' },
        { t:'It is enough if you also disable the account permanently',
          fb:'Disabling stops sign-ins, but the business needs this mailbox back. Once it is re-enabled, every mechanism you did not remove is still there waiting.' }
      ] },

    { kind:'cmd',
      ask:'Establish what was actually accessed.',
      hint:'This is the question a breach-notification decision turns on.',
      opts:[
        { c:'Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-14) -EndDate (Get-Date) -UserIds finance@contoso.com -Operations MailItemsAccessed,FileDownloaded,New-InboxRule -ResultSize 5000', ok:true,
          out:'CreationDate         Operations         UserIds\n-------------------  -----------------  --------------------\n2026-08-25 03:09:41  MailItemsAccessed  finance@contoso.com\n2026-08-25 03:14:55  New-InboxRule      finance@contoso.com\n2026-08-26 02:40:12  MailItemsAccessed  finance@contoso.com\n2026-08-27 14:19:33  FileDownloaded     finance@contoso.com\n                     … 1,847 further records',
          fb:'Nearly two thousand access records over three nights, plus file downloads. This is the difference between "they could have read it" and "they did" — which is the distinction a regulator, a customer and your own legal team all care about.',
          parts:[['MailItemsAccessed','The operation that answers whether data was actually read'],['-ResultSize 5000','The default is small and truncates silently, which understates an incident'],['New-InboxRule','Timestamps the rule creation, tying it to the same session as the reads']] },
        { c:'Get-MessageTrace -SenderAddress finance@contoso.com -StartDate (Get-Date).AddDays(-10) -EndDate (Get-Date)',
          out:'Received             RecipientAddress          Subject                        Status\n2026-08-27 14:22:08  accounts@supplier.com     Updated bank details            Delivered\n2026-08-26 09:14:51  accounts@othervendor.com  Updated remittance information  Delivered',
          fb:'Essential — it names the two suppliers who need calling today, and message trace only goes back ten days so run it while you can. It covers what was sent, not what was read, and both matter.' },
        { c:'Get-MgAuditLogSignIn -Filter "userPrincipalName eq \'finance@contoso.com\'" -Top 50 | Select-Object CreatedDateTime,IPAddress,@{n=\'Loc\';e={$_.Location.CountryOrRegion}}',
          out:'CreatedDateTime      IPAddress        Loc\n2026-08-28 10:41:02  203.0.113.99     NG\n2026-08-25 03:09:12  203.0.113.99     NG\n2026-08-25 08:44:10  198.51.100.7     GB',
          fb:'Establishes the attacker\'s address and that access began in the early hours of Tuesday. Very useful for the timeline and for hunting the same address across other accounts — but it does not tell you what was read.' },
        { c:'Get-Mailbox finance@contoso.com | Select-Object ProhibitSendQuota,TotalItemSize',
          out:'ProhibitSendQuota : 99 GB\nTotalItemSize     : 41.2 GB',
          fb:'Mailbox size tells you nothing about this incident. It is the kind of command that feels like progress and is not.' }
      ] },

    { kind:'cmd',
      ask:'Remove the persistence. What has to go?',
      hint:'All three, and the grant is the one people forget.',
      opts:[
        { c:'Remove-InboxRule -Mailbox finance@contoso.com -Identity "."; Remove-MgUserAuthenticationPhoneMethod -UserId $uid -PhoneAuthenticationMethodId $pid; Remove-MgOauth2PermissionGrant -OAuth2PermissionGrantId $gid', ok:true,
          out:'(no output)\n\n$ Get-MgOauth2PermissionGrant -All -Filter "principalId eq \'$uid\'" | Measure-Object\nCount : 0',
          fb:'All three removed, and verified rather than assumed. The order does not matter much here as long as each is recorded first — what matters is that none of them would have been touched by a password reset, and each one alone is sufficient for the attacker to continue.',
          parts:[['Remove-InboxRule','The forwarding-and-delete rule'],['Remove-MgUserAuthenticationPhoneMethod','The attacker\'s registered second factor'],['Remove-MgOauth2PermissionGrant','The consent grant — the mechanism that survives everything else']] },
        { c:'Remove-InboxRule -Mailbox finance@contoso.com -Identity "."',
          out:'(no output)',
          fb:'One of three. The registered phone method still lets them pass MFA, and the consented application still reads and sends her mail with its own token.' },
        { c:'Update-MgUser -UserId finance@contoso.com -PasswordProfile @{ password=$new; forceChangePasswordNextSignIn=$true }',
          out:'(no output)',
          fb:'Necessary, and it is what most people do first and last. On its own it addresses only the original entry route and leaves all three persistence mechanisms in place.' },
        { c:'Set-Mailbox finance@contoso.com -Type Shared',
          out:'(no output)',
          fb:'That is a leaver action, not an incident action. It converts a mailbox somebody still needs to use and does nothing about the rule, the method or the grant.' }
      ] },

    { kind:'cmd',
      ask:'Is this only her?',
      hint:'You have an attacker IP address and a consented application id.',
      opts:[
        { c:'Get-MgAuditLogSignIn -Filter "ipAddress eq \'203.0.113.99\'" -All | Group-Object UserPrincipalName; Get-MgOauth2PermissionGrant -All -Filter "clientId eq \'0a4f91b2-…\'"', ok:true,
          out:'Count Name\n----- -------------------------\n   38 finance@contoso.com\n    6 ap-clerk@contoso.com\n    2 payroll@contoso.com\n\nClientId    : 0a4f91b2-…   PrincipalId : (ap-clerk)   Scope : Mail.Read offline_access',
          fb:'Two more accounts, and one of them has consented to the same application. This was a campaign against the finance function rather than one unlucky person — which changes the containment scope, the notification list and the conversation you are about to have with the business.',
          parts:[['ipAddress eq','Pivot on the attacker address across every account in the tenant'],['clientId eq','Pivot on the application — anyone else who consented is also compromised'],['ap-clerk@contoso.com','A second victim found by pivoting rather than by waiting for a report']] },
        { c:'Get-MgAuditLogSignIn -Filter "ipAddress eq \'203.0.113.99\'" -All | Group-Object UserPrincipalName',
          out:'Count Name\n----- -------------------------\n   38 finance@contoso.com\n    6 ap-clerk@contoso.com\n    2 payroll@contoso.com',
          fb:'Finds the other two accounts, which is most of the value. It misses anyone who consented to the same application from a different address — and consent phishing campaigns typically send from many.' },
        { c:'Get-MgAuditLogSignIn -Filter "riskLevelDuringSignIn eq \'high\'" -Top 50',
          out:'(no results)',
          fb:'Risk-based detection needs Entra ID P2, and an attacker signing in from a plausible location after a successful MFA approval may not score as risky at all. Absence here is not evidence of anything.' },
        { c:'Get-MgUser -All -Property signInActivity | Where-Object { $_.SignInActivity.LastSignInDateTime -gt (Get-Date).AddDays(-1) }',
          out:'… 412 users',
          fb:'Everyone who signed in yesterday, which is most of the company. No pivot, no signal.' }
      ] },

    { kind:'think',
      ask:'What change would have prevented this specific attack?',
      hint:'Two things happened: a prompt was approved, and an app was consented to.',
      opts:[
        { t:'Number matching in Authenticator, and a user consent policy limiting consent to verified publishers with an admin approval workflow', ok:true,
          fb:'Those two address the two mechanisms directly. Number matching means approving requires reading a number from the sign-in screen, so there is nothing to approve by reflex — it removes MFA fatigue as an attack. Restricting user consent means the application could never have been granted mail access by one phished person. Phishing-resistant methods would remove the first factor problem entirely.' },
        { t:'A stronger password policy and more frequent expiry',
          fb:'Password complexity and rotation do very little against phishing and credential stuffing, and forced expiry measurably makes passwords worse. Neither would have stopped an approved prompt or a consented app.' },
        { t:'Blocking external forwarding at the tenant level',
          fb:'Genuinely worth doing and it would have limited the damage — but the attacker was already in the mailbox, could still read and send, and the fraudulent emails went out through a session rather than a forward.' },
        { t:'Security awareness training for the finance team',
          fb:'It helps, and it belongs in the response. It is also the control everyone reaches for instead of a technical one — this attack worked on somebody who was tired at the end of the day, which training does not reliably fix.' }
      ] }
  ],
  debrief:{
    why:[
      'The approved MFA prompt was the key fact: a prompt only appears after the password succeeds, so the credential was already compromised and the intrusion dated to Tuesday.',
      'Containment was revoke then disable, in that order, confirmed from the sign-in log. Disabling alone leaves an issued token working for the rest of the hour, which is the most common containment mistake there is.',
      'A single-character inbox rule forwarding externally and deleting the original explained both the missing sent item and why the supplier\'s replies never reached her.',
      'Two more mechanisms were found because they were looked for: a phone method registered on Tuesday, meaning the attacker could pass MFA themselves, and a consent grant with offline_access giving an application its own renewable token.',
      'None of the three depended on the password, which is why a reset-and-close would have left the attacker with read and send access to the mailbox.',
      'MailItemsAccessed in the unified audit log turned "they could have read it" into nearly two thousand records over three nights — the evidence a breach-notification decision actually turns on.',
      'Pivoting on the attacker IP address and on the application id found two more compromised accounts, which made this a campaign against the finance function rather than one unlucky person.'
    ],
    interview:'Frame it as containment, persistence, scope. "An MFA prompt the user did not initiate means the password is already known, because the prompt comes after the first factor. So I revoke sessions and disable — revoke first, because disabling alone leaves an issued token alive for up to an hour — and confirm from the sign-in log. Then I hunt the mechanisms that survive a credential change: inbox rules and mailbox forwarding, newly registered authentication methods, and OAuth consent grants. That last one is the one people miss: offline_access gives an app its own refresh token, so it keeps reading and sending mail after every password reset and session revocation. Then scope, with MailItemsAccessed in the unified audit log, because \'was it read\' is a different and legally significant question from \'could it have been\'. Then I pivot on the attacker IP and the application id, which here found two more finance accounts. The prevention is number matching and a restrictive user consent policy — the two mechanisms this attack actually used."',
    prevent:[
      'Number matching and additional context in Microsoft Authenticator, so approving requires reading a number from the sign-in screen rather than tapping a button.',
      'Restrict user consent to verified publishers and low-impact permissions, and enable the admin consent request workflow so legitimate apps still have a path.',
      'Alert on the events this attack generated: a new authentication method registered, a new consent grant, and a new inbox rule that forwards externally.',
      'Block or tightly control automatic external forwarding at the tenant level, and review mailbox-level forwarding on a schedule.',
      'Move the highest-risk roles — finance, payroll, administrators — to phishing-resistant authentication, which removes the first factor problem rather than making it harder.',
      'Put a callback-on-a-known-number rule in the payments process for any change of bank details. The technical controls reduce the odds; that one removes the payout.'
    ]
  }
}

);
