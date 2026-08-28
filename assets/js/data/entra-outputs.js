/* Identity & M365 — what each playbook step prints, with the deciding line
   marked. PowerShell output is verbose and mostly noise; the point of this
   file is knowing which two fields to read.                                 */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.pbOut = LX.pbOut || {};

LX.pbOut['en-signin-fail'] = [
  { out:'CreatedDateTime      AppDisplayName      Err    Why\n' +
        '-------------------  ------------------  -----  ------------------------------------------\n' +
        '2026-08-28 08:14:02  Office 365 Exchange 53003  Access has been blocked by Conditional\n' +
        '                                                Access policies. The access policy does not\n' +
        '                                                allow token issuance.\n' +
        '2026-08-28 08:13:41  Office 365 Exchange 53003  Access has been blocked by Conditional\n' +
        '                                                Access policies.',
    mark:['53003','blocked by Conditional'],
    note:'The code routes everything. 53003 means a Conditional Access policy refused to issue a token — the password was fine and the second factor may have been too. Compare with 50126 (wrong password), 50076 (MFA required), 50079 (MFA not registered) and 50105 (not assigned to the application): five completely different investigations behind one complaint.' },

  { out:'AccountEnabled           : True\n' +
        'OnPremisesSyncEnabled    : True\n' +
        'UserType                 : Member\n' +
        'SignInActivity           : @{LastSignInDateTime=2026-08-27T17:44:11Z;\n' +
        '                            LastNonInteractiveSignInDateTime=2026-08-28T08:02:19Z}',
    mark:['OnPremisesSyncEnabled    : True','LastSignInDateTime=2026-08-27T17:44:11Z'],
    note:'Enabled, and mastered on-premises — so any cloud-side fix to this object is reverted at the next sync cycle. The last successful sign-in was yesterday evening, which rules out a broken onboarding and dates the change to overnight. `SignInActivity` needs AuditLog.Read.All on top of the user scope, which is why it silently comes back empty for many people.' },

  { out:'#microsoft.graph.passwordAuthenticationMethod\n' +
        '#microsoft.graph.phoneAuthenticationMethod\n\n' +
        '# a well-registered user looks like this instead:\n' +
        '# #microsoft.graph.microsoftAuthenticatorAuthenticationMethod\n' +
        '# #microsoft.graph.fido2AuthenticationMethod',
    mark:['phoneAuthenticationMethod','fido2AuthenticationMethod'],
    note:'A password and a phone number, nothing else. SMS is the weakest second factor still in common use and one SIM swap from useless — worth flagging even when it is not today\'s fault. The registration report finds everyone in this state before an attacker does.' },

  { out:'CreatedDateTime      AppDisplayName        IPAddress        ClientAppUsed        Loc\n' +
        '-------------------  --------------------  ---------------  -------------------  ---\n' +
        '2026-08-28 08:14:02  Office 365 Exchange   203.0.113.44     IMAP4                GB\n' +
        '2026-08-28 08:13:41  Office 365 Exchange   203.0.113.44     IMAP4                GB\n' +
        '2026-08-27 17:44:11  Microsoft Teams       198.51.100.7     Browser              GB',
    mark:['IMAP4','Browser'],
    note:'The failures are all IMAP4 and the last success was a browser. A legacy protocol cannot do modern authentication or MFA at all, so a policy blocking legacy clients produces a failure the user experiences as a broken password. The answer is a mail client that supports modern auth — not an exception to the policy.' },

  { out:'Id                  : 3f2b8c11-…\n' +
        'TemporaryAccessPass : 47281950\n' +
        'LifetimeInMinutes   : 60\n' +
        'IsUsableOnce        : True\n\n' +
        '$ Get-MgAuditLogSignIn … -Top 3\n' +
        '2026-08-28 09:22:07  Microsoft Teams  0  ',
    mark:['TemporaryAccessPass : 47281950','IsUsableOnce        : True'],
    note:'A single-use, time-boxed pass lets the user sign in once and register a real method — restoring access without removing a control. An error code of 0 on the follow-up sign-in is the confirmation; asking the user whether it worked is not. Read the pass to them over a channel you have verified, not the one that raised the ticket.' }
];

LX.pbOut['en-ca-lockout'] = [
  { out:'DisplayName                       State\n' +
        '--------------------------------  --------\n' +
        'Require MFA for all users         enabled\n' +
        'Block legacy authentication       enabled\n' +
        'Require compliant device          enabled\n\n' +
        '# and the exclusion check:\n' +
        'Require MFA for all users         excludes break-glass: False',
    mark:['excludes break-glass: False','Require MFA for all users'],
    note:'The new policy does not exclude the break-glass accounts, which is the defect that turns a mistake into an emergency. Two cloud-only accounts on the .onmicrosoft.com domain, excluded from every policy, with sign-in alerts, are what make every other Conditional Access change reversible.' },

  { out:'DisplayName                       Result\n' +
        '--------------------------------  -----------\n' +
        'Require MFA for all users         success\n' +
        'Block legacy authentication       notApplied\n' +
        'Require compliant device          failure\n' +
        'Require approved client app       notEnabled',
    mark:['failure','notApplied','notEnabled'],
    note:'This one field is why Conditional Access is more debuggable than most access systems. Every policy evaluated is listed with its result, so you can name the one that blocked instead of reasoning about twenty. `notApplied` means the conditions did not match this attempt — useful, because it rules a policy out — and `notEnabled` means it is disabled or report-only.' },

  { out:'DisplayName : Require compliant device\n' +
        'State       : enabledForReportingButNotEnforced\n' +
        'ModifiedDateTime : 2026-08-28T09:31:44Z',
    mark:['enabledForReportingButNotEnforced'],
    note:'Report-only is the better rollback than disabling: users get in immediately and the policy keeps recording what it *would* have done, which is exactly the data needed to fix it properly. Propagation takes minutes rather than being instant, so say so rather than letting people retry in a loop.' },

  { out:'Users        : @{IncludeUsers=System.Object[]; ExcludeUsers=System.Object[];\n' +
        '                IncludeGroups=System.Object[]}\n' +
        'Applications : @{IncludeApplications=All}\n' +
        'Platforms    :\n\n' +
        '$ … | Select-Object -ExpandProperty GrantControls\n' +
        'Operator          : OR\n' +
        'BuiltInControls   : {compliantDevice}',
    mark:['IncludeApplications=All','{compliantDevice}'],
    note:'Every application, and the only way to satisfy it is a compliant device. That combination catches service principals, legacy clients and anyone whose device has not checked in with Intune recently — including the administrators who would fix it. `IncludeApplications=All` is the condition worth reading twice on every policy.' },

  { out:'DisplayName      : Require compliant device\n' +
        'State            : enabledForReportingButNotEnforced\n' +
        'Conditions       : @{users=@{excludeUsers=System.Object[]}}\n\n' +
        '# after two days of report-only data:\n' +
        'Result     Count\n' +
        '---------  -----\n' +
        'success      412\n' +
        'failure       38',
    mark:['failure       38','success      412'],
    note:'Thirty-eight users would still be blocked. That number is the entire point of report-only — it is knowable before anyone is affected, and it converts an outage into a remediation list. Enforce when the failure count is people you have already contacted, not before.' }
];

LX.pbOut['en-app-401'] = [
  { out:'DisplayName        Secrets\n' +
        '-----------------  --------------------\n' +
        'Nightly Report     2026-08-27T00:00:00Z\n\n' +
        '# and the error the caller logged:\n' +
        'AADSTS7000215: Invalid client secret provided. Ensure the secret being sent\n' +
        'in the request is the client secret value, not the client secret ID.',
    mark:['2026-08-27T00:00:00Z','AADSTS7000215'],
    note:'The secret expired yesterday and the job failed overnight — "nothing changed" is nearly always something expired. The error text also names the other everyday mistake: the secret *value* is shown once at creation and the *id* is shown forever, and people paste the wrong one.' },

  { out:'AppDisplayName   ErrorCode  FailureReason\n' +
        '---------------  ---------  --------------------------------------------\n' +
        'Nightly Report   7000215    Invalid client secret provided\n' +
        'Nightly Report   7000215    Invalid client secret provided\n\n' +
        '# the 403 case looks completely different:\n' +
        '# Authorization_RequestDenied: Insufficient privileges to complete the operation.',
    mark:['7000215','Authorization_RequestDenied'],
    note:'Service principal sign-ins appear in the sign-in logs too, which people forget. 401 with an AADSTS code is authentication — bad secret, wrong app id, wrong tenant. `Authorization_RequestDenied` inside a 403 is authorisation, and sends you to consent and permission type instead. Both get reported as "it broke".' },

  { out:'{\n' +
        '  "resourceAppId": "00000003-0000-0000-c000-000000000000",\n' +
        '  "resourceAccess": [\n' +
        '    { "id": "df021288-bdef-4463-88db-98f22de89214", "type": "Role" },\n' +
        '    { "id": "e1fe6dd8-ba31-4d61-89e7-88639da4683d", "type": "Scope" }\n' +
        '  ]\n' +
        '}',
    mark:['"type": "Role"','"type": "Scope"'],
    note:'`Role` is an application permission — the app acts as itself, with no user, which is what a daemon needs. `Scope` is delegated, acting on behalf of a signed-in user and capped by that user\'s rights. A script that works interactively and fails as a scheduled job is almost always holding only Scope. That resourceAppId is Microsoft Graph, and it is the same in every tenant.' },

  { out:'ClientId     : 8c1f…   ConsentType : AllPrincipals\n' +
        'Scope        : User.Read.All Directory.Read.All\n\n' +
        '$ Get-MgServicePrincipal -ServicePrincipalId $sp | Select AccountEnabled,AppRoleAssignmentRequired\n' +
        'AccountEnabled           : True\n' +
        'AppRoleAssignmentRequired: False',
    mark:['ConsentType : AllPrincipals','AccountEnabled           : True'],
    note:'Consent exists tenant-wide and the service principal is enabled, so neither is the cause here — which is worth confirming rather than assuming. Note that this grant covers delegated scopes only; application permissions are separate objects, read with Get-MgServicePrincipalAppRoleAssignment.' },

  { out:'DisplayName          AppId\n' +
        '-------------------  ------------------------------------\n' +
        'Nightly Report       4c9e1a77-…\n' +
        'Legacy Sync Job      b71f2d05-…\n' +
        'Vendor Integration   0f38ac91-…',
    mark:['Legacy Sync Job','Vendor Integration'],
    note:'Three more applications with credentials expiring inside sixty days — the same outage queued up twice more. One scheduled query turns each of them from a 3am surprise into a ticket. Certificates avoid the class entirely, since the private key never travels into a config file or a pipeline variable.' }
];

LX.pbOut['en-license-gap'] = [
  { out:'SkuPartNumber : SPE_E3\n' +
        'Plans         : {EXCHANGE_S_ENTERPRISE, SHAREPOINTENTERPRISE, OFFICESUBSCRIPTION,\n' +
        '                 MCOSTANDARD, TEAMS1, INTUNE_A, AAD_PREMIUM, …}\n\n' +
        '# what this user actually has:\n' +
        'Plans         : {EXCHANGE_S_ENTERPRISE, SHAREPOINTENTERPRISE, OFFICESUBSCRIPTION}',
    mark:['TEAMS1','SPE_E3'],
    note:'The SKU is right and the Teams service plan is missing from the assignment. A licence is a bundle whose individual plans can be switched off independently, usually by a licensing template configured years ago to disable something nobody wanted then. From every other angle this user has E3.' },

  { out:'SkuId                                 AssignedByGroup                       State  Error\n' +
        '------------------------------------  ------------------------------------  -----  -----------------\n' +
        '05e9a617-0261-4cee-bb44-138d3ef5d965  7d2a91c4-…                            Error  CountViolation',
    mark:['CountViolation','AssignedByGroup'],
    note:'Two facts in one line. The licence came from a group, so it cannot be fixed on the user — you fix the group or the tenant. And `CountViolation` means the tenant ran out of that SKU: group-based licensing records the failure per user and carries on silently, which is why the first symptom is a person complaining days later.' },

  { out:'SkuPartNumber        Used  Owned\n' +
        '-------------------  ----  -----\n' +
        'SPE_E3                250    250\n' +
        'EMSPREMIUM             84    100\n' +
        'POWER_BI_STANDARD      12  10000',
    mark:['250    250'],
    note:'Fully consumed, so the next joiner gets nothing. Before buying more, look at disabled accounts still holding licences — a leaver process that disables without reclaiming is usually why a tenant is "out" while paying for people who left. An alert at ninety percent consumption costs nothing and removes this whole failure mode.' },

  { out:'DisplayName          : Licensing - E3\n' +
        'GroupTypes           : {DynamicMembership}\n' +
        'MembershipRule       : (user.department -eq "Sales") -and (user.accountEnabled -eq true)\n' +
        'OnPremisesSyncEnabled: \n\n' +
        '# and the new starter:\n' +
        '# department : (empty)',
    mark:['{DynamicMembership}','user.department -eq "Sales"'],
    note:'A dynamic group, and the new starter has no department set — so they will never join, and adding them by hand fails outright. The fix is the source attribute, not the group. Dynamic processing also lags, so a correct user can simply not be there yet in a large tenant.' },

  { out:'ServicePlanName        ProvisioningStatus\n' +
        '---------------------  -------------------\n' +
        'TEAMS1                 PendingProvisioning\n' +
        'MCOSTANDARD            Success\n' +
        'EXCHANGE_S_ENTERPRISE  Success',
    mark:['PendingProvisioning'],
    note:'Assigned is not provisioned. Each workload provisions independently over minutes to a few hours, so "I assigned the licence and it still does not work" is often true and briefly correct. `PendingProvisioning` means wait; `Disabled` means the plan is switched off and waiting will not help.' }
];

LX.pbOut['en-hybrid-stale'] = [
  { out:'2026-08-27T14:02:11Z\n\n' +
        '# it is currently 2026-08-28T09:40:00Z — nineteen hours ago.\n' +
        '# a healthy tenant shows a timestamp within the last thirty minutes.',
    mark:['2026-08-27T14:02:11Z','nineteen hours ago'],
    note:'One value splits the whole investigation. Nineteen hours against a default cycle of thirty minutes means synchronisation itself has stopped, so this is not about one user — every on-premises change since yesterday afternoon is queued behind it. That is a much larger incident than the ticket described.' },

  { out:'SyncCycleEnabled      : True\n' +
        'StagingModeEnabled    : True\n' +
        'NextSyncCyclePolicyType : Delta\n' +
        'NextSyncCycleStartTimeInUTC : 2026-08-28T10:00:00Z',
    mark:['StagingModeEnabled    : True'],
    note:'The scheduler is running and the server is in staging mode, so it imports and synchronises and exports nothing at all. This is the state a standby server sits in, and a failover that was started and never completed leaves a server looking completely healthy while changing nothing in the cloud.' },

  { out:'OnPremisesSyncEnabled     : True\n' +
        'OnPremisesLastSyncDateTime: 2026-08-27T14:02:11Z\n' +
        'OnPremisesImmutableId     : SDU3cVhF…\n' +
        'AccountEnabled            : True',
    mark:['OnPremisesSyncEnabled     : True','AccountEnabled            : True'],
    note:'Mastered on-premises and still enabled in the cloud. Because Active Directory is the source of authority, disabling this object in the cloud would be reverted at the next cycle — the change has to be made in AD. The stale sync timestamp matches the tenant-wide one, so this object is not individually broken.' },

  { out:'Connector           : contoso.local\n' +
        'Object              : CN=Jo Smith,OU=Users,DC=contoso,DC=local\n' +
        'Error               : AttributeValueMustBeUnique\n' +
        'Attribute           : proxyAddresses\n' +
        'Conflicting object  : CN=J.Smith (old),OU=Disabled,DC=contoso,DC=local',
    mark:['AttributeValueMustBeUnique','proxyAddresses'],
    note:'A per-object failure while everything else flows — which is why the tenant-wide timestamp can look perfectly healthy while one user never updates. A duplicate proxyAddresses or userPrincipalName against a leftover disabled object is the usual cause, and the export retries on its own once the conflict is resolved.' },

  { out:'# Revoke-MgUserSignInSession returns nothing on success\n\n' +
        '$ Get-MgAuditLogSignIn -Filter "userPrincipalName eq \'jo@contoso.com\'" -Top 5\n' +
        'CreatedDateTime      AppDisplayName       ErrorCode\n' +
        '2026-08-28 09:52:14  Office 365 Exchange  50058\n' +
        '2026-08-28 09:14:07  Office 365 Exchange  0',
    mark:['50058'],
    note:'The 09:14 sign-in succeeded and the 09:52 one failed with 50058, silent sign-in failed — the refresh token was revoked and the client can no longer renew. That gap is exactly the window a disable-without-revoke leaves open: up to an hour of continued access on an already-issued token.' }
];

LX.pbOut['en-mail-missing'] = [
  { out:'Received             SenderAddress          Subject              Status\n' +
        '-------------------  ---------------------  -------------------  ---------------\n' +
        '2026-08-27 16:41:09  billing@supplier.com   Invoice INV-88214    Quarantined\n' +
        '2026-08-27 09:12:44  billing@supplier.com   Invoice INV-88103    FilteredAsSpam',
    mark:['Quarantined','FilteredAsSpam'],
    note:'There is a record, so the message reached Exchange Online and was judged — the fix is a policy, not the mailbox. Compare the three other outcomes: `Delivered` sends you to rules and folders, `Failed` carries an SMTP response, and no record at all means it never arrived and nothing in the mailbox will explain it.' },

  { out:'Event                Detail\n' +
        '-------------------  --------------------------------------------------------\n' +
        'Receive              Message received by Exchange Online\n' +
        'Transport rule       Rule "Quarantine external invoices" matched\n' +
        'Quarantine           Message quarantined by policy',
    mark:['Rule "Quarantine external invoices" matched'],
    note:'Not the spam filter at all — a mail flow rule somebody wrote deliberately, doing exactly what it says. That distinction matters: tuning the anti-spam policy would have changed nothing, and the conversation is now with whoever owns the rule rather than with Microsoft.' },

  { out:'Name                            State    Priority  StopRuleProcessing\n' +
        '------------------------------  -------  --------  ------------------\n' +
        'External sender warning         Enabled         0               False\n' +
        'Quarantine external invoices    Enabled         1                True\n' +
        'Route finance to shared box     Enabled         2               False',
    mark:['True','Priority'],
    note:'Rule 1 sets StopRuleProcessing, so rule 2 never runs for any message rule 1 matches — the finance routing rule looks correct and is unreachable. Rules evaluate in ascending priority and the chain can be truncated, which is why reading them sorted is the only way to see what actually applies.' },

  { out:'ReceivedTime         SenderAddress          Subject             Type\n' +
        '-------------------  ---------------------  ------------------  ------------\n' +
        '2026-08-27 16:41:09  billing@supplier.com   Invoice INV-88214   TransportRule\n\n' +
        '# and the sender\'s authentication:\n' +
        'spf=fail (sender IP is 198.51.100.9) smtp.mailfrom=supplier.com',
    mark:['TransportRule','spf=fail'],
    note:'The message is recoverable, and the sender fails SPF — their DNS does not list the address that sent it. An allow entry on your side would disable authentication checking for exactly the domain most worth spoofing; telling the supplier to fix their SPF record is the answer that helps everyone they mail.' },

  { out:'Received             SenderAddress          Status\n' +
        '-------------------  ---------------------  ---------\n' +
        '2026-08-28 09:58:31  billing@supplier.com   Delivered\n\n' +
        '$ Get-Mailbox jo@contoso.com | Select ForwardingSmtpAddress\n' +
        'ForwardingSmtpAddress : smtp:jo.personal@outlook.com',
    mark:['Delivered','smtp:jo.personal@outlook.com'],
    note:'Delivered — confirmed with a fresh trace rather than by asking. And an unexpected find while you were in there: mailbox-level forwarding to a personal address, which is both a data-loss route and a standard post-compromise persistence mechanism. Cheapest moment you will ever have to notice it.' }
];

LX.pbOut['en-compromise'] = [
  { out:'# Revoke-MgUserSignInSession and Update-MgUser return nothing on success.\n' +
        '# confirm with the sign-in log a minute later:\n' +
        'CreatedDateTime      ErrorCode  FailureReason\n' +
        '2026-08-28 10:02:44  50057      User account is disabled.',
    mark:['50057'],
    note:'50057 confirms containment took effect — the account is disabled and sign-ins are being refused. Revocation and disabling are two separate actions: disabling stops new sign-ins, revoking invalidates the refresh tokens that would otherwise keep an existing session alive for the rest of the hour.' },

  { out:'Name  Enabled  ForwardTo                  DeleteMessage  MoveToFolder\n' +
        '----  -------  -------------------------  -------------  ------------\n' +
        '.     True     ext-collect@mailbox.top    True           RSS Feeds\n\n' +
        '$ Get-MgUserAuthenticationMethod -UserId jo@contoso.com\n' +
        '#microsoft.graph.phoneAuthenticationMethod   (+1 555 0142)  registered 2026-08-28',
    mark:['ext-collect@mailbox.top','registered 2026-08-28'],
    note:'Both classic persistence mechanisms in one screen. A rule named with a single full stop, forwarding externally and deleting the original, so the user never sees replies to mail sent in their name. And a phone method registered this morning — the attacker can now pass MFA themselves. Neither of these cares about a password reset.' },

  { out:'ClientId    : 0a4f91b2-…\n' +
        'ConsentType : Principal\n' +
        'Scope       : Mail.Read Mail.Send offline_access\n\n' +
        '$ Get-MgServicePrincipal -ServicePrincipalId 0a4f91b2-… | Select DisplayName,AppOwnerOrganizationId\n' +
        'DisplayName             : Mail Backup Pro\n' +
        'AppOwnerOrganizationId  : 9d31f7ac-…   (not this tenant)',
    mark:['Mail.Read Mail.Send offline_access','not this tenant'],
    note:'An illicit consent grant: the user approved an app owned by another tenant that can read and send their mail indefinitely, because `offline_access` gives it a refresh token. No password is involved, so resetting the credential and revoking sessions changes nothing — only revoking the grant cuts this access.' },

  { out:'CreationDate         Operations           UserIds\n' +
        '-------------------  -------------------  ------------------\n' +
        '2026-08-28 04:11:52  MailItemsAccessed    jo@contoso.com\n' +
        '2026-08-28 04:12:07  MailItemsAccessed    jo@contoso.com\n' +
        '2026-08-28 04:19:33  FileDownloadedFull   jo@contoso.com\n' +
        '                     … 214 further records',
    mark:['MailItemsAccessed','214 further records'],
    note:'This is the evidence a breach-notification decision turns on — not "could they have read it" but "did they". Two caveats to state plainly in any report: the operation requires auditing to have been enabled beforehand, and retention is ninety days on E3, so absence of records is not evidence of absence.' },

  { out:'#microsoft.graph.fido2AuthenticationMethod\n' +
        '#microsoft.graph.passwordAuthenticationMethod\n\n' +
        '$ Get-MgAuditLogSignIn … -Top 10\n' +
        '2026-08-28 11:40:02  Microsoft Teams  0   (MFA: fido2)',
    mark:['fido2AuthenticationMethod','(MFA: fido2)'],
    note:'Re-registered on a phishing-resistant method rather than back onto SMS. A FIDO2 key or passkey cannot be phished or relayed, which removes the attack rather than making it harder — and Authenticator with number matching is the next-best option where hardware keys are not practical.' }
];

LX.pbOut['en-device-blocked'] = [
  { out:'UserPrincipalName      AppDisplayName        Dev\n' +
        '---------------------  --------------------  ----------------\n' +
        'jo@contoso.com         Office 365 Exchange   LAPTOP-4471\n' +
        'sam@contoso.com        Microsoft Teams       LAPTOP-2210\n' +
        'ali@contoso.com        Office 365 SharePoint LAPTOP-0983\n' +
        '                       … 214 users total',
    mark:['214 users total'],
    note:'Error 53000 across 214 users is a fleet event, not a support queue — and the number is what decides between rolling back and remediating. Distinguish the neighbouring codes: 53000 is device not compliant, 53001 is device not hybrid joined at all, and 53003 is a Conditional Access block on some other condition.' },

  { out:'DeviceName    UserPrincipalName   OsVersion     LastSyncDateTime\n' +
        '------------  ------------------  ------------  -------------------\n' +
        'LAPTOP-4471   jo@contoso.com      10.0.19045.2  2026-08-28 07:12:04\n' +
        'LAPTOP-2210   sam@contoso.com     10.0.19045.2  2026-08-26 18:41:55\n\n' +
        '$ Get-MgDeviceManagementManagedDeviceCompliancePolicyState -ManagedDeviceId …\n' +
        'DisplayName                State\n' +
        'Windows - minimum build    nonCompliant',
    mark:['10.0.19045.2','Windows - minimum build'],
    note:'The per-policy state names the rule rather than just the verdict: a minimum build requirement raised past what the fleet is actually running. Note the second device last synced two days ago — it cannot have evaluated the new rule at all, which is a timing problem rather than a compliance one.' },

  { out:'DisplayName : Require compliant device\n' +
        'State       : enabledForReportingButNotEnforced\n\n' +
        '# sign-ins five minutes later:\n' +
        'ErrorCode  Count\n' +
        '---------  -----\n' +
        '0            198\n' +
        '53000          3',
    mark:['enabledForReportingButNotEnforced','53000          3'],
    note:'Flipping the Conditional Access policy restores access in minutes; loosening the compliance policy would not, because each device has to check in and re-evaluate first. Knowing which of the two systems to touch is most of the speed here — Intune judges, Conditional Access enforces.' },

  { out:'GracePeriodHours : 0\n' +
        'ActionType       : block\n' +
        'NotificationTemplateId :\n\n' +
        '# what a safe rollout looks like instead:\n' +
        '# GracePeriodHours : 48\n' +
        '# ActionType       : notification',
    mark:['GracePeriodHours : 0','GracePeriodHours : 48'],
    note:'Zero grace means a device is marked non-compliant the instant it fails, and with a Conditional Access requirement that is an immediate lockout. Most fleet-wide compliance incidents are this one setting rather than the rule itself — and it is one call to check before enabling anything.' },

  { out:'Name          Count\n' +
        '------------  -----\n' +
        'compliant       178\n' +
        'nonCompliant     36\n' +
        'unknown           9',
    mark:['nonCompliant     36','unknown           9'],
    note:'Eighty-three percent passing, which is the number to decide on: enforcing here means thirty-six people cannot work and nine devices whose state nobody knows. The nine `unknown` are the more interesting group — devices that are not reporting at all are unmanaged in practice, which is a bigger problem than the rule you were rolling out.' }
];
