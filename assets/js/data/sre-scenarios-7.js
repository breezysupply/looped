/* SRE & Cloud Deployment Foundations — simulated incidents S29–S32 (M15–M16).

   Same contract as sre-scenarios-1.js; played by tests/data/test-sre-scenarios.js.

   S29 models provider-shaped identity after a migration off AWS: an Azure
   world (managed identity, role assignments at a scope, role definitions
   with control-plane `actions` and data-plane `dataActions`, storage account
   public-access settings) and a GCP world (attached service account, IAM
   policies on projects and buckets, uniform bucket-level access, resource
   hierarchy). `az`, `gcloud`, `workload` (the migrated job), `ref`
   (paraphrased reference notes written for this course) and `sleep` are
   world verbs; role grants take effect after a modelled propagation delay.
   S30 is an API-support desk: a customer log, the gateway's JSON-lines
   request log, an account console stand-in, a `repro` client against a mock
   endpoint, a bounded `jq`, and `ticket reply` whose text is reviewed for
   request ids, category, cause, next action and secrets.
   S31 is the capstone release in a restricted cluster on the reconciling
   cluster model (k8s-model.js) with a Helm-like release history, a
   NetworkPolicy evaluator, an admission rule against floating tags, a
   database schema version, `audit note` and `smoke`.
   S32 is a PostgreSQL restore model: base backups with verification state,
   a WAL archive with its coverage, point-in-time restore into a new
   instance, a bounded `psql -c`, the ingest queue, cutover and
   `incident update`.

   Every command advances the scenario clock (verbs are bound with
   LXSim.bind); nothing reads Math.random or Date. Learner-visible text
   (title, briefs, objective text) never names the root cause; mechanism,
   alternatives and the worked fix live in the debrief. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.missions = LX.missions || [];

(function () {
  function SIM() { return window.LXSim; }
  function KM() { return window.LXK8s; }
  function st(c) { return c.w.sre; }
  function M(c) { return c.w.k8sModel; }
  function ran(c, re) { return SIM().ran(c, re); }
  function saw(c, re, outRe) { return SIM().saw(c, re, outRe); }
  function lastIs(c, cmdRe, outRe) { return SIM().lastIs(c, cmdRe, outRe); }
  function lastCode(c) { return SIM().lastCode(c); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function res(out, code, errText) {
    var r = { out: out == null ? '' : String(out), code: code || 0 };
    if (r.out && !/\n$/.test(r.out)) r.out += '\n';
    if (errText) r.err = String(errText).replace(/\n?$/, '\n');
    return r;
  }
  function J(x) { return JSON.stringify(x, null, 2); }
  /* deterministic hex for ids and digests */
  function hex(seed, n) {
    var r = SIM().rng('hex:' + seed), s = '';
    while (s.length < n) s += '0123456789abcdef'.charAt(Math.floor(r.next() * 16));
    return s;
  }
  function guid(seed) { var h = hex(seed, 32); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32); }
  function digestOf(seed) { return 'sha256:' + hex(seed, 64); }
  /* `sleep N`: waits N logical seconds (the default sleep builtin does not move the scenario clock) */
  function sleepVerb(state, after) {
    return function (w, a) {
      var n = parseInt(a[0], 10);
      if (!(n >= 0) || n > 900) return res('', 1, 'sleep (simulation): give a whole number of seconds from 0 to 900');
      state.clock += Math.max(0, n - SIM().PER_COMMAND);
      if (after) after(w, n);
      return res('');
    };
  }
  /* "do not / never / avoid … X" should not count as advising X */
  function negatedBefore(text, idx) {
    var before = text.slice(Math.max(0, idx - 40), idx).toLowerCase();
    return /(do not|don't|dont|never|avoid|rather than|instead of|not to|stop|no more|without)\b[^.;!?]*$/.test(before);
  }

  /* ═══ S29 · Cloud migration access works differently ════════════════ */
  var AZ = {
    sub: '6f1c2b9e-0d3a-4c57-9e21-5a7b0c3d2e29', tenant: 'c0ffee00-1ab0-4d1c-8e5a-000000000029',
    mi: '3c9f6a1e-7b2d-4e8f-a1c4-0d5e6f7a8b29', brett: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c29', sreGroup: '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b29',
    rgApp: 'rg-beacon-app', rgData: 'rg-beacon-data', account: 'stbeaconarchlab', container: 'archive', app: 'beacon-worker'
  };
  AZ.subScope = '/subscriptions/' + AZ.sub;
  AZ.rgAppScope = AZ.subScope + '/resourceGroups/' + AZ.rgApp;
  AZ.rgDataScope = AZ.subScope + '/resourceGroups/' + AZ.rgData;
  AZ.acctScope = AZ.rgDataScope + '/providers/Microsoft.Storage/storageAccounts/' + AZ.account;
  AZ.contScope = AZ.acctScope + '/blobServices/default/containers/' + AZ.container;
  AZ.appScope = AZ.rgAppScope + '/providers/Microsoft.App/containerApps/' + AZ.app;
  var AZ_ROLES = {
    'Owner': { id: '8e3af657-a8ff-443c-a75c-2fe8c4bcb635', description: 'Grants full access to manage all resources, including the ability to assign roles in Azure RBAC.', actions: ['*'], notActions: [], dataActions: [], notDataActions: [] },
    'Contributor': { id: 'b24988ac-6180-42a0-ab88-20f7382dd24c', description: 'Grants full access to manage all resources, but does not allow you to assign roles in Azure RBAC.', actions: ['*'], notActions: ['Microsoft.Authorization/*/Delete', 'Microsoft.Authorization/*/Write', 'Microsoft.Authorization/elevateAccess/Action'], dataActions: [], notDataActions: [] },
    'Reader': { id: 'acdd72a7-3385-48ef-bd42-f606fba81ae7', description: 'View all resources, but does not allow you to make any changes.', actions: ['*/read'], notActions: [], dataActions: [], notDataActions: [] },
    'User Access Administrator': { id: '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9', description: 'Lets you manage user access to Azure resources.', actions: ['*/read', 'Microsoft.Authorization/*'], notActions: [], dataActions: [], notDataActions: [] },
    'Storage Blob Data Reader': { id: '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1', description: 'Allows for read access to Azure Storage blob containers and data.', actions: ['Microsoft.Storage/storageAccounts/blobServices/containers/read', 'Microsoft.Storage/storageAccounts/blobServices/generateUserDelegationKey/action'], notActions: [], dataActions: ['Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'], notDataActions: [] },
    'Storage Blob Data Contributor': { id: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe', description: 'Allows for read, write and delete access to Azure Storage blob containers and data.', actions: ['Microsoft.Storage/storageAccounts/blobServices/containers/delete', 'Microsoft.Storage/storageAccounts/blobServices/containers/read', 'Microsoft.Storage/storageAccounts/blobServices/containers/write', 'Microsoft.Storage/storageAccounts/blobServices/generateUserDelegationKey/action'], notActions: [], dataActions: ['Microsoft.Storage/storageAccounts/blobServices/containers/blobs/delete', 'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read', 'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write', 'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/move/action', 'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action'], notDataActions: [] },
    'Storage Blob Data Owner': { id: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b', description: 'Allows for full access to Azure Storage blob containers and data, including assigning POSIX access control.', actions: ['Microsoft.Storage/storageAccounts/blobServices/containers/*', 'Microsoft.Storage/storageAccounts/blobServices/generateUserDelegationKey/action'], notActions: [], dataActions: ['Microsoft.Storage/storageAccounts/blobServices/containers/blobs/*'], notDataActions: [] }
  };
  var GCP = {
    appPrj: 'looped-app-prj', appNum: '418200000129', dataPrj: 'looped-data-prj', dataNum: '418200000229',
    sa: 'beacon-worker@looped-app-prj.iam.gserviceaccount.com', bucket: 'looped-beacon-archive', region: 'europe-west4'
  };
  var GCP_ROLES = {
    'roles/storage.objectViewer': { title: 'Storage Object Viewer', perms: ['resourcemanager.projects.get', 'storage.folders.get', 'storage.folders.list', 'storage.managedFolders.get', 'storage.managedFolders.list', 'storage.objects.get', 'storage.objects.list'] },
    'roles/storage.objectUser': { title: 'Storage Object User', perms: ['storage.objects.create', 'storage.objects.delete', 'storage.objects.get', 'storage.objects.list', 'storage.objects.update'] },
    'roles/storage.objectAdmin': { title: 'Storage Object Admin', perms: ['storage.objects.*', 'storage.managedFolders.*'] },
    'roles/storage.admin': { title: 'Storage Admin', perms: ['storage.*', 'resourcemanager.projects.get', 'resourcemanager.projects.list'] },
    'roles/owner': { title: 'Owner', perms: ['(all permissions on the resource, including setIamPolicy)'] },
    'roles/editor': { title: 'Editor', perms: ['(most write permissions on the resource; no setIamPolicy)'] },
    'roles/viewer': { title: 'Viewer', perms: ['(read-only metadata permissions on most resources)'] },
    'roles/run.invoker': { title: 'Cloud Run Invoker', perms: ['run.routes.invoke'] },
    'roles/iam.serviceAccountTokenCreator': { title: 'Service Account Token Creator', perms: ['iam.serviceAccounts.getAccessToken', 'iam.serviceAccounts.signBlob', 'iam.serviceAccounts.signJwt'] },
    'roles/storage.legacyBucketOwner': { title: 'Storage Legacy Bucket Owner', perms: ['storage.buckets.get', 'storage.buckets.update', 'storage.objects.create', 'storage.objects.delete', 'storage.objects.list'] },
    'roles/storage.legacyBucketReader': { title: 'Storage Legacy Bucket Reader', perms: ['storage.buckets.get', 'storage.objects.list'] },
    'roles/storage.legacyObjectOwner': { title: 'Storage Legacy Object Owner', perms: ['storage.objects.get', 'storage.objects.update'] },
    'roles/storage.legacyObjectReader': { title: 'Storage Legacy Object Reader', perms: ['storage.objects.get'] }
  };
  var GCP_DATA_ROLES = ['roles/storage.objectViewer', 'roles/storage.objectUser', 'roles/storage.objectAdmin', 'roles/storage.admin', 'roles/owner', 'roles/editor'];
  var REFS = {
    'aws-iam-roles': ['AWS (what the team knew) — paraphrased course note, not a quotation.', '- A workload assumes an IAM role; the role\'s identity-based policy lists actions (s3:GetObject) and resource ARNs.', '- Within one account, an allow on the role\'s policy is usually enough; an explicit deny anywhere wins.', '- The policy travels with the principal: you grant "this role may read that ARN" in one place.', 'Source register: T18 (AWS IAM policy evaluation logic).'],
    'azure-rbac-scope': ['Azure role-based access — paraphrased course note, not a quotation.', '- A role assignment is three things: a security principal (user, group, service principal, managed identity), a role definition, and a scope.', '- Scopes nest: management group > subscription > resource group > resource; an assignment applies at its scope and everything below it.', '- `az role assignment list` without --all or --scope shows subscription-level assignments only; resource-level ones need --all or --scope.', '- New or removed assignments can take several minutes to take effect.', 'Check the current Azure RBAC documentation (course source T19) before relying on details.'],
    'azure-data-plane': ['Azure control plane versus data plane — paraphrased course note, not a quotation.', '- Role definitions have `actions` (management operations through Azure Resource Manager: read the storage account\'s properties, list keys) and `dataActions` (operations on the data itself: read a blob).', '- Reader, Contributor and Owner carry `actions` only. They let a principal see or manage the storage account, not read blob data with its Microsoft Entra token.', '- Reading blobs with a token needs a role with the blob read `dataAction`, such as Storage Blob Data Reader, at a scope that contains the container.', '- Granting at the container (or storage account) keeps the grant to the data the workload needs.', 'Check the current Azure Storage authorization documentation (course source T19).'],
    'gcp-iam-hierarchy': ['Google Cloud IAM — paraphrased course note, not a quotation.', '- An allow policy is attached to a resource: organization, folder, project, or an individual resource such as a bucket.', '- Policies are inherited down the resource hierarchy: a binding on a project applies to resources in THAT project, not to resources in another project.', '- So "where" a grant lives depends on where the resource lives, not where the workload runs.', '- The workload\'s identity is the service account attached to it; grant roles to that member (serviceAccount:NAME).', '- Policy changes can take a few minutes to propagate.', 'Check the current Google Cloud IAM documentation (course source T20).'],
    'gcp-bucket-access': ['Cloud Storage access — paraphrased course note, not a quotation.', '- With uniform bucket-level access enabled, object ACLs are disabled; access is decided by IAM alone (bucket and inherited project policies).', '- Storage Object Viewer (roles/storage.objectViewer) grants storage.objects.get and storage.objects.list; a binding on the bucket limits it to that bucket.', '- allUsers / allAuthenticatedUsers make data public; public access prevention exists to stop exactly that.', 'Check the current Cloud Storage access-control documentation (course source T20).']
  };
  function refVerb() {
    return function (w, a) {
      var t = a[0];
      if (!t || !REFS[t]) return res('ref — reference notes written for this course as short paraphrased summaries (not quotations, not a substitute for the providers\' current documentation).\nTopics: ' + Object.keys(REFS).join(', ') + '\nUsage: ref TOPIC', t ? 1 : 0);
      return res(REFS[t].join('\n'));
    };
  }

  /* effective grants: an assignment or binding counts once its propagation time has passed */
  var PROPAGATE = 60;
  function azEffective(s, principal) {
    return s.az.assignments.filter(function (x) { return x.principalId === principal && s.clock >= (x.effectiveAt || 0); });
  }
  function azCanReadBlobs(s, principal) {
    return azEffective(s, principal).some(function (x) {
      var r = AZ_ROLES[x.role];
      return r && r.dataActions.some(function (d) { return /blobs\/(read|\*)$/.test(d); }) && (AZ.contScope === x.scope || AZ.contScope.indexOf(x.scope + '/') === 0);
    });
  }
  function gcpPolicyOf(s, target) { return target === 'bucket' ? s.gcp.bucketPolicy : s.gcp.projects[target]; }
  function gcpCanList(s, member) {
    function hit(pol) { return pol.some(function (b) { return GCP_DATA_ROLES.indexOf(b.role) !== -1 && b.members.indexOf(member) !== -1 && s.clock >= (b.effectiveAt[member] || 0); }); }
    return hit(s.gcp.bucketPolicy) || hit(s.gcp.projects[GCP.dataPrj]);
  }
  function s29Fixed(s) {
    if (s.variant === 'a') {
      return s.az.assignments.some(function (x) { return x.principalId === AZ.mi && x.role === 'Storage Blob Data Reader' && (x.scope === AZ.acctScope || x.scope === AZ.contScope); });
    }
    return s.gcp.bucketPolicy.some(function (b) { return b.role === 'roles/storage.objectViewer' && b.members.indexOf('serviceAccount:' + GCP.sa) !== -1; });
  }
  function s29Clean(s) {
    if (s.variant === 'a') return !s.az.assignments.some(function (x) { return x.principalId === AZ.mi && x.role === 'Reader'; });
    return !s.gcp.projects[GCP.appPrj].some(function (b) { return b.role === 'roles/storage.objectViewer' && b.members.indexOf('serviceAccount:' + GCP.sa) !== -1; });
  }
  function s29WorkloadOk(s) { return s.variant === 'a' ? azCanReadBlobs(s, AZ.mi) : gcpCanList(s, 'serviceAccount:' + GCP.sa); }
  var BLOBS = [['2026/10/11/readings-0001.jsonl.gz', '398 KiB'], ['2026/10/12/readings-0002.jsonl.gz', '405 KiB'], ['2026/10/12/readings-0003.jsonl.gz', '412 KiB']];

  function workloadRun(s) {
    var t = SIM().stamp(s), L = [];
    if (s.variant === 'a') {
      L.push(t + ' beacon-worker archive-sync starting (identity: system-assigned managed identity, principalId ' + AZ.mi + ')');
      L.push(t + ' token acquired for https://storage.azure.com/ from the managed identity endpoint');
      L.push(t + ' GET https://' + AZ.account + '.blob.core.windows.net/' + AZ.container + '?restype=container&comp=list');
      if (!azCanReadBlobs(s, AZ.mi)) {
        L.push(t + '   -> 403 AuthorizationPermissionMismatch: This request is not authorized to perform this operation using this permission.');
        L.push(t + ' archive-sync FAILED (exit 1)');
        return { out: L.join('\n'), ok: false };
      }
      L.push(t + '   -> 200 OK (' + BLOBS.length + ' blobs)');
      L.push(t + ' GET https://' + AZ.account + '.blob.core.windows.net/' + AZ.container + '/' + BLOBS[2][0] + '   -> 200 OK (' + BLOBS[2][1] + ')');
      L.push(t + ' archive-sync done: ' + BLOBS.length + ' blobs listed, newest downloaded (exit 0)');
      return { out: L.join('\n'), ok: true };
    }
    L.push(t + ' beacon-worker archive-sync starting (credentials: metadata server, service account ' + GCP.sa + ')');
    L.push(t + ' GET https://storage.googleapis.com/storage/v1/b/' + GCP.bucket + '/o?prefix=2026%2F');
    if (!gcpCanList(s, 'serviceAccount:' + GCP.sa)) {
      L.push(t + '   -> 403 ' + GCP.sa + ' does not have storage.objects.list access to the Google Cloud Storage bucket. Permission \'storage.objects.list\' denied on resource (or it may not exist).');
      L.push(t + ' archive-sync FAILED (exit 1)');
      return { out: L.join('\n'), ok: false };
    }
    L.push(t + '   -> 200 OK (' + BLOBS.length + ' objects)');
    L.push(t + ' GET https://storage.googleapis.com/storage/v1/b/' + GCP.bucket + '/o/' + encodeURIComponent(BLOBS[2][0]) + '?alt=media   -> 200 OK (' + BLOBS[2][1] + ')');
    L.push(t + ' archive-sync done: ' + BLOBS.length + ' objects listed, newest downloaded (exit 0)');
    return { out: L.join('\n'), ok: true };
  }
  function workloadVerb(state) {
    return function (w, a) {
      var sub = a[0];
      if (sub === 'run') { var r = workloadRun(state); state.runs.push({ at: state.clock, ok: r.ok }); return res(r.out, r.ok ? 0 : 1); }
      if (sub === 'logs') return res(state.history.join('\n') + (state.runs.length ? '\n(' + state.runs.length + ' manual run(s) since; use `workload run` to see a fresh attempt)' : ''));
      return res('workload is a SIMULATION stand-in for triggering and reading the migrated beacon-worker job (' + (state.variant === 'a' ? 'an Azure Container App' : 'a Cloud Run service') + '); it is not a real tool.\nUsage: workload run | workload logs', sub ? 2 : 0, sub ? 'workload: unknown subcommand "' + sub + '"' : null);
    };
  }

  /* ── az (bounded) ───────────────────────────────────────────────── */
  var AZ_VALUED = ['n', 'g', 'name', 'resource-group', 'query', 'o', 'output', 'assignee', 'role', 'scope', 'account-name', 'container-name', 'auth-mode', 'public-access', 'assignee-object-id', 'assignee-principal-type', 'prefix', 'allow-blob-public-access', 'ids'];
  function azAssignmentView(x) {
    return { id: x.scope + '/providers/Microsoft.Authorization/roleAssignments/' + x.id, name: x.id, principalId: x.principalId, principalName: x.principalName, principalType: x.principalType, roleDefinitionId: AZ.subScope + '/providers/Microsoft.Authorization/roleDefinitions/' + AZ_ROLES[x.role].id, roleDefinitionName: x.role, scope: x.scope, type: 'Microsoft.Authorization/roleAssignments' };
  }
  function azPrincipal(s, who) {
    if (!who) return null;
    if (who === AZ.mi || who === 'beacon-worker') return { id: AZ.mi, name: AZ.mi, type: 'ServicePrincipal' };
    if (who === AZ.brett || who === 'brett@corp.lab') return { id: AZ.brett, name: 'brett@corp.lab', type: 'User' };
    if (who === AZ.sreGroup || who === 'sre-oncall') return { id: AZ.sreGroup, name: 'sre-oncall', type: 'Group' };
    return null;
  }
  var AZ_SCOPES = function () { return [AZ.subScope, AZ.rgAppScope, AZ.rgDataScope, AZ.acctScope, AZ.contScope, AZ.appScope]; };
  function azVerb(state) {
    var s = state;
    return function (w, a) {
      if (s.variant !== 'a') return res('', 127, 'bash: az: command not found\n(this variant of the migration went to Google Cloud: use gcloud)');
      var p = SIM().flags(a, AZ_VALUED), f = p.f, pos = p.pos, cmd = pos.slice(0, 3).join(' ');
      var outFmt = f.o || f.output || 'json';
      if (!pos.length || f.help || f.h) return res('az (simulation): account show · containerapp show|identity show|logs show -n beacon-worker -g ' + AZ.rgApp + ' · role assignment list|create|delete · role definition list --name ROLE · storage blob list --account-name A --container-name C --auth-mode login · storage container show-permission|set-permission · storage account show|update');
      if (cmd === 'account show') return res(J({ environmentName: 'AzureCloud', id: AZ.sub, isDefault: true, name: 'looped-lab', state: 'Enabled', tenantId: AZ.tenant, user: { name: 'brett@corp.lab', type: 'user' } }));
      if (pos[0] === 'containerapp') {
        var name = f.n || f.name, rg = f.g || f['resource-group'];
        if (name !== AZ.app) return res('', 3, 'ERROR: (ResourceNotFound) The Resource \'Microsoft.App/containerApps/' + (name || '') + '\' under resource group \'' + (rg || '') + '\' was not found.');
        if (rg !== AZ.rgApp) return res('', 3, 'ERROR: (ResourceGroupNotFound) Resource group \'' + (rg || '') + '\' could not be found, or does not contain ' + AZ.app + '.');
        var ident = { principalId: AZ.mi, tenantId: AZ.tenant, type: 'SystemAssigned' };
        if (pos[1] === 'identity' && pos[2] === 'show') return res(J(ident));
        if (pos[1] === 'logs' && pos[2] === 'show') return res(s.history.concat(s.runs.length ? ['(' + s.runs.length + ' manual run(s) since)'] : []).join('\n'));
        if (pos[1] === 'show') {
          var app = { id: AZ.appScope, identity: ident, location: 'westeurope', name: AZ.app, properties: { provisioningState: 'Succeeded', template: { containers: [{ name: 'worker', image: 'registry.lab/beacon/worker:1.6.0', env: [{ name: 'ARCHIVE_ACCOUNT', value: AZ.account }, { name: 'ARCHIVE_CONTAINER', value: AZ.container }, { name: 'ARCHIVE_AUTH', value: 'managed-identity' }] }] } }, resourceGroup: AZ.rgApp, type: 'Microsoft.App/containerApps' };
          var q = f.query;
          if (q === 'identity') return res(J(ident));
          if (q === 'identity.principalId') return res(outFmt === 'tsv' ? AZ.mi : J(AZ.mi));
          if (q) return res('', 2, 'az (simulation): --query supports only "identity" and "identity.principalId" here');
          return res(J(app));
        }
        return SIM().unsupported('az containerapp', pos.slice(1).join(' '), ['show', 'identity show', 'logs show']);
      }
      if (pos[0] === 'role' && pos[1] === 'definition' && pos[2] === 'list') {
        var rn = f.name;
        var names = rn ? [rn] : Object.keys(AZ_ROLES);
        var defs = names.filter(function (x) { return AZ_ROLES[x]; }).map(function (x) { var r = AZ_ROLES[x]; return { assignableScopes: ['/'], description: r.description, id: '/providers/Microsoft.Authorization/roleDefinitions/' + r.id, name: r.id, permissions: [{ actions: r.actions, notActions: r.notActions, dataActions: r.dataActions, notDataActions: r.notDataActions }], roleName: x, roleType: 'BuiltInRole' }; });
        return res(J(defs));
      }
      if (pos[0] === 'role' && pos[1] === 'assignment') {
        var who = f.assignee || f['assignee-object-id'];
        if (pos[2] === 'list') {
          var list = s.az.assignments.slice();
          var pr = who ? azPrincipal(s, who) : null;
          if (who && !pr) return res('', 1, 'ERROR: Cannot find user or service principal in graph database for \'' + who + '\'.');
          if (pr) list = list.filter(function (x) { return x.principalId === pr.id; });
          if (f.scope) {
            var sc = String(f.scope).replace(/\/$/, '');
            list = list.filter(function (x) { return x.scope === sc || (f['include-inherited'] && sc.indexOf(x.scope + '/') === 0); });
          } else if (!f.all) {
            list = list.filter(function (x) { return x.scope === AZ.subScope; });
          }
          if (outFmt === 'table') return res(list.length ? SIM().table(['Principal', 'Role', 'Scope'], list.map(function (x) { return [x.principalName, x.role, x.scope]; })) : '');
          return res(J(list.map(azAssignmentView)));
        }
        if (pos[2] === 'create') {
          var role = f.role, scope = f.scope ? String(f.scope).replace(/\/$/, '') : null, prc = azPrincipal(s, who);
          if (!who || !role || !scope) return res('', 2, 'ERROR: the following arguments are required: --assignee (or --assignee-object-id), --role, --scope');
          if (!prc) return res('', 1, 'ERROR: Cannot find user or service principal in graph database for \'' + who + '\'.');
          if (!AZ_ROLES[role]) return res('', 1, 'ERROR: Role \'' + role + '\' doesn\'t exist.');
          if (AZ_SCOPES().indexOf(scope) === -1) return res('', 1, 'ERROR: (InvalidResourceId or not found) The scope \'' + scope + '\' does not exist or is not a resource this simulation knows. Known scopes:\n  ' + AZ_SCOPES().join('\n  '));
          if (s.az.assignments.some(function (x) { return x.principalId === prc.id && x.role === role && x.scope === scope; })) return res('', 1, 'ERROR: (RoleAssignmentExists) The role assignment already exists.');
          var asg = { id: guid('asg:' + s.clock + role + scope), principalId: prc.id, principalName: prc.name, principalType: prc.type, role: role, scope: scope, effectiveAt: s.clock + PROPAGATE, createdAt: s.clock, mine: true };
          s.az.assignments.push(asg);
          return res(J(azAssignmentView(asg)) + '\n(simulation: role assignments here take effect about ' + PROPAGATE + ' s after creation, like real RBAC propagation which can take minutes)');
        }
        if (pos[2] === 'delete') {
          var prd = azPrincipal(s, who);
          if (!prd) return res('', 1, 'ERROR: --assignee is required and must be a principal this simulation knows');
          var before = s.az.assignments.length;
          s.az.assignments = s.az.assignments.filter(function (x) { return !(x.principalId === prd.id && (!f.role || x.role === f.role) && (!f.scope || x.scope === String(f.scope).replace(/\/$/, ''))); });
          return before === s.az.assignments.length ? res('', 1, 'ERROR: No matched assignments were found to delete') : res('');
        }
        return SIM().unsupported('az role assignment', pos[2] || '', ['list', 'create', 'delete']);
      }
      if (pos[0] === 'storage') {
        var acct = f['account-name'] || f.n || f.name;
        if (pos[1] === 'account' && (pos[2] === 'show' || pos[2] === 'update')) {
          if ((f.n || f.name) !== AZ.account) return res('', 3, 'ERROR: (ResourceNotFound) The storage account \'' + (f.n || f.name || '') + '\' was not found.');
          if (pos[2] === 'update' && f['allow-blob-public-access'] != null) s.az.allowPublic = /^true$/i.test(String(f['allow-blob-public-access']));
          return res(J({ name: AZ.account, id: AZ.acctScope, kind: 'StorageV2', location: 'westeurope', allowBlobPublicAccess: s.az.allowPublic, allowSharedKeyAccess: true, minimumTlsVersion: 'TLS1_2', networkRuleSet: { defaultAction: 'Deny', virtualNetworkRules: [{ id: AZ.rgAppScope + '/providers/Microsoft.Network/virtualNetworks/vnet-beacon/subnets/snet-apps', action: 'Allow' }], bypass: 'AzureServices' }, resourceGroup: AZ.rgData }));
        }
        if (acct !== AZ.account) return res('', 1, 'ERROR: storage account \'' + (acct || '') + '\' not found (this simulation has ' + AZ.account + ')');
        if (pos[1] === 'container' && pos[2] === 'show-permission') return res(J({ publicAccess: s.az.containerPublic }));
        if (pos[1] === 'container' && pos[2] === 'set-permission') {
          var pa = f['public-access'] || 'off';
          if (pa !== 'off' && !s.az.allowPublic) return res('', 1, 'ERROR: Public access is not permitted on this storage account.');
          s.az.containerPublic = pa;
          return res(J({ lastModified: SIM().stamp(s), etag: '"0x8DCEB' + hex('etag' + s.clock, 9).toUpperCase() + '"' }));
        }
        if (pos[1] === 'blob' && pos[2] === 'list') {
          if ((f['container-name'] || f.c) !== AZ.container) return res('', 1, 'ERROR: The specified container does not exist.');
          var mode = f['auth-mode'] || 'key';
          if (mode === 'key') return res('', 1, 'There are no credentials provided in your command and environment, we will query for account key for your storage account.\nERROR: (AuthorizationFailed) The client \'brett@corp.lab\' with object id \'' + AZ.brett + '\' does not have authorization to perform action \'Microsoft.Storage/storageAccounts/listKeys/action\' over scope \'' + AZ.acctScope + '\'.');
          if (!azCanReadBlobs(s, AZ.brett)) return res('', 1, 'ERROR: You do not have the required permissions needed to perform this operation.\nAuthorizationPermissionMismatch');
          if (outFmt === 'table') return res(SIM().table(['Name', 'Blob Type', 'Length'], BLOBS.map(function (b) { return [b[0], 'BlockBlob', b[1]]; })));
          return res(J(BLOBS.map(function (b) { return { name: b[0], properties: { blobType: 'BlockBlob', contentLength: b[1] } }; })) + '\n(listed as brett@corp.lab with --auth-mode login)');
        }
        return SIM().unsupported('az storage', pos.slice(1).join(' '), ['account show|update', 'container show-permission|set-permission', 'blob list']);
      }
      return SIM().unsupported('az', pos.join(' '), ['account show', 'containerapp show|identity show|logs show', 'role assignment list|create|delete', 'role definition list', 'storage blob list', 'storage container show-permission|set-permission', 'storage account show|update']);
    };
  }

  /* ── gcloud (bounded) ───────────────────────────────────────────── */
  var G_VALUED = ['region', 'format', 'flatten', 'filter', 'member', 'role', 'project', 'impersonate-service-account', 'add-acl-grant', 'condition'];
  function gcpYaml(pol) {
    var L = ['bindings:'];
    pol.forEach(function (b) { L.push('- members:'); b.members.forEach(function (m) { L.push('  - ' + m); }); L.push('  role: ' + b.role); });
    L.push('etag: BwY' + hex('etag' + pol.length + JSON.stringify(pol), 8));
    L.push('version: 1');
    return L.join('\n');
  }
  function gcpAdd(s, pol, member, role) {
    var b = pol.filter(function (x) { return x.role === role; })[0];
    if (!b) { b = { role: role, members: [], effectiveAt: {} }; pol.push(b); }
    if (b.members.indexOf(member) === -1) { b.members.push(member); b.effectiveAt[member] = s.clock + PROPAGATE; }
  }
  function gcpRemove(pol, member, role) {
    var b = pol.filter(function (x) { return x.role === role; })[0];
    if (!b || b.members.indexOf(member) === -1) return false;
    b.members = b.members.filter(function (m) { return m !== member; });
    return true;
  }
  function gcloudVerb(state) {
    var s = state;
    return function (w, a) {
      if (s.variant !== 'b') return res('', 127, 'bash: gcloud: command not found\n(this variant of the migration went to Azure: use az)');
      var p = SIM().flags(a, G_VALUED), f = p.f, pos = p.pos, cmd = pos.slice(0, 3).join(' ');
      if (!pos.length || f.help) return res('gcloud (simulation): config list · projects list|get-iam-policy|add-iam-policy-binding|remove-iam-policy-binding · run services describe|logs read beacon-worker · iam roles describe ROLE · storage buckets list|describe|get-iam-policy|add-iam-policy-binding|remove-iam-policy-binding · storage ls gs://BUCKET [--impersonate-service-account=SA]');
      if (cmd === 'config list') return res('[core]\naccount = brett@corp.lab\nproject = ' + GCP.appPrj + '\n\nYour active configuration is: [looped-lab]');
      if (cmd === 'projects list') return res(SIM().table(['PROJECT_ID', 'NAME', 'PROJECT_NUMBER'], [[GCP.appPrj, 'Beacon apps (lab)', GCP.appNum], [GCP.dataPrj, 'Beacon data (lab)', GCP.dataNum]]));
      if (pos[0] === 'projects' && /^(get-iam-policy|add-iam-policy-binding|remove-iam-policy-binding)$/.test(pos[1] || '')) {
        var prj = pos[2], pol = s.gcp.projects[prj];
        if (!pol) return res('', 1, 'ERROR: (gcloud.projects.' + pos[1] + ') [brett@corp.lab] does not have permission to access projects instance [' + (prj || '') + '] (or it may not exist)');
        if (pos[1] === 'get-iam-policy') {
          var view = pol;
          var fm = /bindings\.members:\s*"?([^"\s]+)"?/.exec(String(f.filter || ''));
          if (fm) {
            view = pol.filter(function (b) { return b.members.some(function (m) { return m.indexOf(fm[1]) !== -1; }); }).map(function (b) { return { role: b.role, members: b.members.filter(function (m) { return m.indexOf(fm[1]) !== -1; }) }; });
            var et = 'BwY' + hex('etag' + pol.length + JSON.stringify(pol), 8);
            if (/table\(bindings\.role\)/.test(String(f.format || ''))) return res(view.length ? 'ROLE\n' + view.map(function (b) { return b.role; }).join('\n') : 'Listed 0 items.');
            return res(view.length ? view.map(function (b) { return '---\nbindings:\n  members: ' + b.members[0] + '\n  role: ' + b.role + '\netag: ' + et + '\nversion: 1'; }).join('\n') : 'Listed 0 items.');
          }
          return res(gcpYaml(view));
        }
        if (!f.member || !f.role) return res('', 2, 'ERROR: (gcloud.projects.' + pos[1] + ') argument --member and --role are required');
        if (pos[1] === 'add-iam-policy-binding') { gcpAdd(s, pol, f.member, f.role); return res('Updated IAM policy for project [' + prj + '].\n' + gcpYaml(pol) + '\n(simulation: bindings here take effect about ' + PROPAGATE + ' s after the change)'); }
        if (!gcpRemove(pol, f.member, f.role)) return res('', 1, 'ERROR: (gcloud.projects.remove-iam-policy-binding) Policy binding with the specified principal, role, and condition not found!');
        return res('Updated IAM policy for project [' + prj + '].\n' + gcpYaml(pol));
      }
      if (pos[0] === 'run' && pos[1] === 'services') {
        if (pos[3] !== 'beacon-worker' && !(pos[2] === 'logs' && pos[4] === 'beacon-worker')) return res('', 1, 'ERROR: (gcloud.run.services) Cannot find service [' + (pos[3] || pos[4] || '') + '] in region [' + (f.region || GCP.region) + '].');
        if (pos[2] === 'describe') {
          if (/serviceAccountName/.test(String(f.format || ''))) return res(GCP.sa);
          return res('✔ Service beacon-worker in region ' + GCP.region + '\n\nURL:     https://beacon-worker-' + GCP.appNum + '.' + GCP.region + '.run.app\nIngress: internal\n\nLast updated on 2026-10-13T08:12:00Z by brett@corp.lab:\n  Revision beacon-worker-00007-xqz\n  Container None\n    Image:           registry.lab/beacon/worker:1.6.0\n    Env vars:\n      ARCHIVE_BUCKET   ' + GCP.bucket + '\n  Service account:   ' + GCP.sa + '\n  Concurrency:       10\n  VPC access:        Direct VPC egress (private ranges only), Private Google Access on');
        }
        if (pos[2] === 'logs' && pos[3] === 'read') return res(s.history.concat(s.runs.length ? ['(' + s.runs.length + ' manual run(s) since)'] : []).join('\n'));
        return SIM().unsupported('gcloud run services', pos.slice(2).join(' '), ['describe beacon-worker', 'logs read beacon-worker']);
      }
      if (pos[0] === 'iam' && pos[1] === 'roles' && pos[2] === 'describe') {
        var gr = GCP_ROLES[pos[3]];
        if (!gr) return res('', 1, 'ERROR: (gcloud.iam.roles.describe) NOT_FOUND: role ' + (pos[3] || '') + ' is not one this simulation knows');
        return res('description: (simulated summary)\nincludedPermissions:\n' + gr.perms.map(function (x) { return '- ' + x; }).join('\n') + '\nname: ' + pos[3] + '\nstage: GA\ntitle: ' + gr.title);
      }
      if (pos[0] === 'storage') {
        var gsName = function (u) { return String(u || '').replace(/^gs:\/\//, '').replace(/\/.*$/, ''); };
        if (pos[1] === 'buckets' && pos[2] === 'list') {
          var pj = f.project || GCP.appPrj;
          return res(pj === GCP.dataPrj ? '---\nname: ' + GCP.bucket + '\nstorage_url: gs://' + GCP.bucket + '/\nlocation: EUROPE-WEST4' : 'Listed 0 items.');
        }
        if (pos[1] === 'buckets' && pos[2]) {
          var bn = gsName(pos[3]);
          if (bn !== GCP.bucket) return res('', 1, 'ERROR: (gcloud.storage.buckets.' + pos[2] + ') gs://' + bn + ' not found: 404.');
          if (pos[2] === 'describe') return res('creation_time: 2025-03-02T10:14:22+0000\ndefault_storage_class: STANDARD\nlocation: EUROPE-WEST4\nlocation_type: region\nmetageneration: 7\nname: ' + GCP.bucket + '\npublic_access_prevention: inherited\nstorage_url: gs://' + GCP.bucket + '/\nuniform_bucket_level_access: true\nversioning_enabled: true');
          if (pos[2] === 'get-iam-policy') return res(gcpYaml(s.gcp.bucketPolicy));
          if (pos[2] === 'add-iam-policy-binding' || pos[2] === 'remove-iam-policy-binding') {
            if (!f.member || !f.role) return res('', 2, 'ERROR: (gcloud.storage.buckets.' + pos[2] + ') argument --member and --role are required');
            if (pos[2] === 'add-iam-policy-binding') { gcpAdd(s, s.gcp.bucketPolicy, f.member, f.role); return res(gcpYaml(s.gcp.bucketPolicy) + '\n(simulation: bindings here take effect about ' + PROPAGATE + ' s after the change)'); }
            if (!gcpRemove(s.gcp.bucketPolicy, f.member, f.role)) return res('', 1, 'ERROR: (gcloud.storage.buckets.remove-iam-policy-binding) Policy binding with the specified principal, role, and condition not found!');
            return res(gcpYaml(s.gcp.bucketPolicy));
          }
          return SIM().unsupported('gcloud storage buckets', pos[2], ['list', 'describe', 'get-iam-policy', 'add-iam-policy-binding', 'remove-iam-policy-binding']);
        }
        if (pos[1] === 'objects' && pos[2] === 'update') {
          if (f['add-acl-grant']) return res('', 1, 'ERROR: (gcloud.storage.objects.update) HTTPError 400: Cannot use ACL API to update object policy when uniform bucket-level access is enabled. Read more at https://cloud.google.com/storage/docs/uniform-bucket-level-access');
          return SIM().unsupported('gcloud storage objects update', '', ['--add-acl-grant (to see why ACLs do not apply here)']);
        }
        if (pos[1] === 'ls') {
          var b2 = gsName(pos[2]);
          if (b2 !== GCP.bucket) return res('', 1, 'ERROR: (gcloud.storage.ls) gs://' + b2 + ' not found: 404.');
          var imp = f['impersonate-service-account'];
          var member = imp ? 'serviceAccount:' + imp : 'group:sre@corp.lab';
          if (imp && imp !== GCP.sa) return res('', 1, 'ERROR: (gcloud.storage.ls) Failed to impersonate [' + imp + ']: brett@corp.lab lacks iam.serviceAccounts.getAccessToken on it.');
          var head = imp ? 'WARNING: This command is using service account impersonation. All API calls will be executed as [' + imp + '].\n' : '';
          if (!gcpCanList(s, member)) return res(head.replace(/\n$/, ''), 1, 'ERROR: (gcloud.storage.ls) HTTPError 403: ' + (imp || 'brett@corp.lab') + ' does not have storage.objects.list access to the Google Cloud Storage bucket. Permission \'storage.objects.list\' denied on resource (or it may not exist).');
          return res(head + BLOBS.map(function (x) { return 'gs://' + GCP.bucket + '/' + x[0]; }).join('\n'));
        }
        return SIM().unsupported('gcloud storage', pos.slice(1).join(' '), ['buckets list|describe|get-iam-policy|add-iam-policy-binding|remove-iam-policy-binding', 'ls gs://BUCKET', 'objects update --add-acl-grant']);
      }
      return SIM().unsupported('gcloud', pos.join(' '), ['config list', 'projects list|get-iam-policy|add-iam-policy-binding|remove-iam-policy-binding', 'run services describe|logs read', 'iam roles describe', 'storage buckets …', 'storage ls']);
    };
  }

  function s29World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
    var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], runs: [] };
    var hist = [];
    for (var i = 0; i < 3; i++) {
      var t = '2026-10-13T0' + (6 + i) + ':00:1' + i + 'Z';
      if (v === 'a') {
        hist.push(t + ' archive-sync starting (identity: system-assigned managed identity, principalId ' + AZ.mi + ')');
        hist.push(t + ' GET https://' + AZ.account + '.blob.core.windows.net/' + AZ.container + '?restype=container&comp=list -> 403 AuthorizationPermissionMismatch: This request is not authorized to perform this operation using this permission.');
      } else {
        hist.push(t + ' archive-sync starting (credentials: metadata server, service account ' + GCP.sa + ')');
        hist.push(t + ' GET https://storage.googleapis.com/storage/v1/b/' + GCP.bucket + '/o?prefix=2026%2F -> 403 ' + GCP.sa + ' does not have storage.objects.list access to the Google Cloud Storage bucket.');
      }
      hist.push(t + ' archive-sync FAILED (exit 1); next attempt in 1h');
    }
    state.history = hist;
    if (v === 'a') {
      state.az = { allowPublic: false, containerPublic: 'off', assignments: [
        { id: guid('a1'), principalId: AZ.mi, principalName: AZ.mi, principalType: 'ServicePrincipal', role: 'Reader', scope: AZ.acctScope, effectiveAt: 0 },
        { id: guid('a2'), principalId: AZ.brett, principalName: 'brett@corp.lab', principalType: 'User', role: 'Contributor', scope: AZ.rgAppScope, effectiveAt: 0 },
        { id: guid('a3'), principalId: AZ.brett, principalName: 'brett@corp.lab', principalType: 'User', role: 'Storage Blob Data Reader', scope: AZ.acctScope, effectiveAt: 0 },
        { id: guid('a4'), principalId: AZ.sreGroup, principalName: 'sre-oncall', principalType: 'Group', role: 'Reader', scope: AZ.subScope, effectiveAt: 0 }
      ] };
    } else {
      var B = function (role, members) { var e = {}; members.forEach(function (m) { e[m] = 0; }); return { role: role, members: members.slice(), effectiveAt: e }; };
      state.gcp = { projects: {}, bucketPolicy: [
        B('roles/storage.legacyBucketOwner', ['projectEditor:' + GCP.dataPrj, 'projectOwner:' + GCP.dataPrj]),
        B('roles/storage.legacyBucketReader', ['projectViewer:' + GCP.dataPrj]),
        B('roles/storage.legacyObjectOwner', ['projectEditor:' + GCP.dataPrj, 'projectOwner:' + GCP.dataPrj]),
        B('roles/storage.legacyObjectReader', ['projectViewer:' + GCP.dataPrj])
      ] };
      state.gcp.projects[GCP.appPrj] = [B('roles/iam.serviceAccountTokenCreator', ['user:brett@corp.lab']), B('roles/run.admin', ['group:sre@corp.lab']), B('roles/storage.objectViewer', ['serviceAccount:' + GCP.sa])];
      state.gcp.projects[GCP.dataPrj] = [B('roles/owner', ['group:data-admins@corp.lab']), B('roles/storage.objectViewer', ['group:sre@corp.lab'])];
    }
    var initial = JSON.stringify(v === 'a' ? state.az : state.gcp);
    state.initial = initial;
    var mig = v === 'a'
      ? '# beacon-worker migration: AWS -> Azure (CHG-4410)\n\nOn AWS the worker ran as an ECS task whose task role had an IAM policy allowing s3:ListBucket and s3:GetObject on arn:aws:s3:::beacon-archive-lab.\n\nOn Azure:\n- the worker runs as Container App `beacon-worker` in resource group rg-beacon-app (subscription looped-lab)\n- the archive moved to storage account `stbeaconarchlab`, container `archive`, in rg-beacon-data (data team)\n- we enabled the app\'s system-assigned managed identity (no secrets in config) and gave it read access on the storage account, the way the task role had read access on the bucket\n- the storage firewall allows the apps subnet (checked with the network team)\n\nStatus: every hourly archive-sync run since cutover fails. Reading the container from my laptop with `az storage blob list --auth-mode login` works fine, so the data is there.\n'
      : '# beacon-worker migration: AWS -> Google Cloud (CHG-4410)\n\nOn AWS the worker ran as an ECS task whose task role had an IAM policy allowing s3:ListBucket and s3:GetObject on arn:aws:s3:::beacon-archive-lab.\n\nOn Google Cloud:\n- the worker runs as Cloud Run service `beacon-worker` (region europe-west4) in project looped-app-prj with its own service account (no keys)\n- the archive moved to bucket gs://looped-beacon-archive, created and owned by the data team\n- we gave the worker\'s service account the Storage Object Viewer role, the way the task role had read access on the bucket\n- Private Google Access is on for the worker\'s subnet (checked with the network team)\n\nStatus: every hourly archive-sync run since cutover fails. `gcloud storage ls gs://looped-beacon-archive` works from my laptop, so the data is there.\n';
    var verbs = { workload: workloadVerb(state), ref: refVerb(), sleep: sleepVerb(state), az: azVerb(state), gcloud: gcloudVerb(state) };
    return { user: 'lab', host: 'migr-ops', cwd: '/home/lab/migration',
      files: [{ path: '/home/lab/migration/MIGRATION.md', content: mig }, { path: '/home/lab/migration/README.md', content: 'Workspace for the beacon-worker migration follow-up.\n`workload run` triggers the migrated job once and prints its log; `workload logs` shows the last hourly runs.\n`ref TOPIC` prints short reference notes written for this course (paraphrased; check the provider docs before relying on details).\n' }],
      sre: state, extra: SIM().bind(state, verbs) };
  }
  var S29_PAL_A = ['cat MIGRATION.md', 'workload logs', 'workload run', 'az account show', 'az containerapp identity show -n beacon-worker -g rg-beacon-app', 'az role assignment list --assignee ' + AZ.mi + ' --all -o table', 'az role definition list --name "Reader"', 'ref azure-data-plane', 'ref azure-rbac-scope', 'az role assignment create --assignee ' + AZ.mi + ' --role "Storage Blob Data Reader" --scope ', 'az role assignment delete --assignee ' + AZ.mi + ' --role Reader --scope ', 'sleep 60'];
  var S29_PAL_B = ['cat MIGRATION.md', 'workload logs', 'workload run', 'gcloud config list', 'gcloud run services describe beacon-worker --region europe-west4', 'gcloud projects get-iam-policy looped-app-prj', 'gcloud storage buckets get-iam-policy gs://looped-beacon-archive', 'gcloud storage buckets list --project looped-data-prj', 'ref gcp-iam-hierarchy', 'gcloud storage buckets add-iam-policy-binding gs://looped-beacon-archive --member=serviceAccount:' + GCP.sa + ' --role=roles/storage.objectViewer', 'gcloud storage ls gs://looped-beacon-archive --impersonate-service-account=' + GCP.sa, 'sleep 60'];

  LX.missions.push({
    id: 'sre-s29', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'The migrated archive job cannot read its storage',
    brief: function (seed) {
      var v = SIM().variantOf(seed, ['a', 'b']);
      return 'beacon-worker was moved from AWS to ' + (v === 'a' ? 'Azure' : 'Google Cloud') + ' last week (MIGRATION.md has the team\'s notes). Its hourly archive-sync has failed on every run since: it cannot read the archive. The data is there — an engineer can list it from a laptop. Find out why the workload cannot, give it exactly the access it needs and no more, and explain the provider difference using the reference notes (`ref`).';
    },
    keys: S29_PAL_A.concat(S29_PAL_B),
    world: s29World,
    objectives: [
      { id: 'symptom', stage: 'evidence', text: 'See the failure the way the workload sees it, including which identity it used',
        hint: 'An engineer\'s laptop succeeding tells you about the engineer. What does the job itself report?',
        hint2: '`workload logs` (or the provider\'s log command), or trigger one run with `workload run`.',
        reveal: 'workload run',
        done: function (c) { return saw(c, /workload\s+(run|logs)|az\s+containerapp\s+logs\s+show|gcloud\s+run\s+services\s+logs\s+read/, /403|AuthorizationPermissionMismatch|does not have storage\.objects/); } },
      { id: 'identity', stage: 'evidence', text: 'Identify the exact principal the workload runs as',
        hint: 'There is no access key; the platform hands the workload an identity. Which one?',
        hint2: 'Azure: `az containerapp identity show -n beacon-worker -g rg-beacon-app`. Google Cloud: `gcloud run services describe beacon-worker --region europe-west4`.',
        reveal: function (c) { return st(c).variant === 'a' ? 'az containerapp identity show -n beacon-worker -g rg-beacon-app' : 'gcloud run services describe beacon-worker --region europe-west4'; },
        done: function (c) { return saw(c, /az\s+containerapp\s+(identity\s+)?show|gcloud\s+run\s+services\s+describe/, /principalId|Service account:|iam\.gserviceaccount\.com/); } },
      { id: 'grants', stage: 'evidence', text: 'List what that principal has been granted, and where the storage it needs actually lives',
        hint: 'A grant is a role on a scope. Find both halves for this principal, and the storage\'s own place in the provider\'s hierarchy.',
        hint2: 'Azure: `az role assignment list --assignee PRINCIPAL --all`. Google Cloud: `gcloud projects get-iam-policy looped-app-prj` and `gcloud storage buckets get-iam-policy gs://looped-beacon-archive` (or buckets list per project).',
        reveal: function (c) { return st(c).variant === 'a' ? 'az role assignment list --assignee ' + AZ.mi + ' --all' : 'gcloud projects get-iam-policy looped-app-prj && gcloud storage buckets get-iam-policy gs://looped-beacon-archive'; },
        done: function (c) {
          if (st(c).variant === 'a') return saw(c, /az\s+role\s+assignment\s+list/, new RegExp(AZ.mi + '[\\s\\S]*"roleDefinitionName": "Reader"|"roleDefinitionName": "Reader"[\\s\\S]*' + AZ.mi + '|' + AZ.mi + '\\s+Reader'));
          return saw(c, /gcloud\s+projects\s+get-iam-policy\s+looped-app-prj/, /beacon-worker@/) && saw(c, /gcloud\s+storage\s+buckets\s+(get-iam-policy|list)/, /looped-data-prj|looped-beacon-archive/);
        } },
      { id: 'reference', stage: 'evidence', text: 'Check the provider\'s model in the supplied reference notes before changing anything',
        hint: 'The AWS habit was "attach read to the workload\'s role". Which assumption about roles or scopes does this provider not share?',
        hint2: '`ref` lists topics. Azure: the note on control and data planes (or `az role definition list --name Reader`). Google Cloud: the note on the IAM hierarchy.',
        reveal: function (c) { return st(c).variant === 'a' ? 'ref azure-data-plane' : 'ref gcp-iam-hierarchy'; },
        done: function (c) {
          if (st(c).variant === 'a') return saw(c, /ref\b/, /dataActions/) || saw(c, /az\s+role\s+definition\s+list/, /"dataActions": \[\]/);
          return saw(c, /ref\b/, /inherited down the resource hierarchy/);
        } },
      { id: 'grant', stage: 'fix', text: 'Grant the workload\'s identity the narrow read role on the storage it needs, at the narrowest sensible scope',
        hint: 'Read the data, nothing else, on that storage only.',
        hint2: 'Azure: Storage Blob Data Reader on the storage account or the `archive` container. Google Cloud: Storage Object Viewer as a binding on the bucket itself.',
        reveal: function (c) { return st(c).variant === 'a' ? 'az role assignment create --assignee ' + AZ.mi + ' --role "Storage Blob Data Reader" --scope ' + AZ.acctScope : 'gcloud storage buckets add-iam-policy-binding gs://' + GCP.bucket + ' --member=serviceAccount:' + GCP.sa + ' --role=roles/storage.objectViewer'; },
        done: function (c) { return s29Fixed(st(c)); } },
      { id: 'cleanup', stage: 'fix', text: 'Remove the grant from the migration that never gave the access it was meant to',
        hint: 'Least privilege also means not leaving behind a grant that does nothing useful (or more than intended).',
        hint2: 'Azure: delete the Reader assignment on the storage account for the managed identity. Google Cloud: remove the Storage Object Viewer binding for the service account from looped-app-prj.',
        reveal: function (c) { return st(c).variant === 'a' ? 'az role assignment delete --assignee ' + AZ.mi + ' --role Reader --scope ' + AZ.acctScope : 'gcloud projects remove-iam-policy-binding looped-app-prj --member=serviceAccount:' + GCP.sa + ' --role=roles/storage.objectViewer'; },
        done: function (c) { return s29Clean(st(c)) && s29Fixed(st(c)); } },
      { id: 'verify', stage: 'verify', text: 'Prove the workload itself can now read the archive (grants take a little while to apply)',
        hint: 'Your own access never was the question. Test as the workload, after the change has had time to apply.',
        hint2: 'Wait a minute (`sleep 60`), then `workload run` — or on Google Cloud `gcloud storage ls gs://looped-beacon-archive --impersonate-service-account=SA`.',
        reveal: 'sleep 60 && workload run',
        done: function (c) { var s = st(c); return s29Fixed(s) && s29Clean(s) && s29WorkloadOk(s) && (lastIs(c, /workload\s+run/, /archive-sync done/) || lastIs(c, /gcloud\s+storage\s+ls\b.*--impersonate-service-account/, /gs:\/\/looped-beacon-archive\//)) && lastCode(c) === 0; } }
    ],
    sre: {
      scenarioId: 'S29', moduleId: 'M15', lab: 'L29', variants: ['a', 'b'],
      symptom: 'After moving off AWS, the worker\'s archive read fails with 403 on every run while an engineer can read the same data.',
      neutralTitle: 'Migrated worker cannot read the archive',
      neutralBrief: 'Since last week\'s move from AWS, the beacon-worker hourly archive job fails on every run; an engineer can read the same data from a laptop. Find out why the workload cannot, give it exactly the access it needs, and explain the provider difference using the supplied reference notes.',
      impact: 'No archive syncs for a week; downstream reports run on stale data.',
      changes: 'CHG-4410: worker and archive moved from AWS to a new provider; identity configured "the same way as the task role".',
      spoilers: ['data plane', 'dataActions', 'Storage Blob Data', 'control plane', 'hierarchy', 'other project', 'looped-data-prj', 'Reader role', 'bucket binding'],
      tools: ['workload (stand-in for the migrated job)', 'az (account, containerapp, role assignment/definition, storage)', 'gcloud (config, projects, run, iam roles, storage)', 'ref (paraphrased reference notes)', 'sleep'],
      grammar: ['`workload run|logs`, `ref TOPIC`, `sleep N`',
        'Azure: `az containerapp show|identity show|logs show -n beacon-worker -g rg-beacon-app`, `az role assignment list [--assignee ID] [--all|--scope S] [-o table]`, `az role assignment create|delete --assignee ID --role ROLE --scope S`, `az role definition list --name ROLE`, `az storage blob list --account-name A --container-name C --auth-mode login`, `az storage account show|update`, `az storage container show-permission|set-permission`',
        'Google Cloud: `gcloud config list`, `gcloud projects list|get-iam-policy|add-iam-policy-binding|remove-iam-policy-binding`, `gcloud run services describe|logs read beacon-worker`, `gcloud iam roles describe ROLE`, `gcloud storage buckets list|describe|get-iam-policy|add-iam-policy-binding|remove-iam-policy-binding`, `gcloud storage ls gs://B [--impersonate-service-account=SA]`'],
      palette: S29_PAL_A.concat(S29_PAL_B),
      assumptions: ['You (brett@corp.lab) can change role assignments / IAM policies on the resources involved.', 'Networking was checked and is not the problem; the reference notes are paraphrased summaries written for this course.', 'The workload only needs to list and read the archive.'],
      simplified: ['Two providers are modelled only as far as identity and storage access: a handful of principals, role definitions (Azure actions vs dataActions; GCP roles as permission lists), assignments/bindings at named scopes, and inheritance by scope prefix (Azure) or by project/bucket (Google Cloud). No conditions, deny assignments, PIM, organization policies, folders or VPC Service Controls.', 'Propagation of a new grant is a fixed 60 logical seconds; real propagation is usually minutes and not guaranteed.', 'Command output follows the real CLIs closely but is abridged; `workload` is a stand-in for triggering the job and `ref` notes are paraphrases, not provider text.', 'Each command advances the clock 10 seconds.'],
      unsafe: [
        { label: 'granted a broad administrative role to fix a read', why: 'Owner or Contributor at the subscription (or Owner/Editor/Storage Admin on a project) hands the worker control of everything in scope. In Azure it does not even grant blob data access with a token; in Google Cloud it may "work" by granting far more than reading one bucket.',
          test: function (c) {
            var s = st(c);
            if (s.variant === 'a') return s.az.assignments.some(function (x) { return x.mine && /^(Owner|Contributor|User Access Administrator)$/.test(x.role) && (x.scope === AZ.subScope || x.scope === AZ.rgDataScope || x.scope === AZ.rgAppScope); });
            return Object.keys(s.gcp.projects).some(function (k) { return s.gcp.projects[k].some(function (b) { return /^roles\/(owner|editor|storage\.admin)$/.test(b.role) && b.members.some(function (m) { return b.effectiveAt[m] > 0; }); }); });
          },
          demo: function (c, v) { return v === 'a' ? 'az role assignment create --assignee ' + AZ.mi + ' --role Owner --scope ' + AZ.subScope : 'gcloud projects add-iam-policy-binding looped-data-prj --member=serviceAccount:' + GCP.sa + ' --role=roles/storage.admin'; } },
        { label: 'made the archive public', why: 'Anonymous read of the archive (public container, or allUsers/allAuthenticatedUsers on the bucket) exposes every record to the internet to fix one workload\'s identity.',
          test: function (c) {
            var s = st(c);
            if (s.variant === 'a') return s.az.allowPublic || s.az.containerPublic !== 'off';
            return s.gcp.bucketPolicy.concat(s.gcp.projects[GCP.dataPrj]).some(function (b) { return b.members.some(function (m) { return /^(allUsers|allAuthenticatedUsers)$/.test(m); }); });
          },
          demo: function (c, v) { return v === 'a' ? ['az storage account update -n stbeaconarchlab -g rg-beacon-data --allow-blob-public-access true', 'az storage container set-permission --name archive --account-name stbeaconarchlab --public-access blob'] : 'gcloud storage buckets add-iam-policy-binding gs://looped-beacon-archive --member=allUsers --role=roles/storage.objectViewer'; } }
      ],
      alt: function (v) {
        if (v === 'a') return ['cat MIGRATION.md', 'az containerapp logs show -n beacon-worker -g rg-beacon-app', 'az containerapp show -n beacon-worker -g rg-beacon-app',
          'az role assignment list --assignee ' + AZ.mi + ' --all -o table', 'az role definition list --name Reader',
          'az role assignment create --assignee ' + AZ.mi + ' --role "Storage Blob Data Reader" --scope ' + AZ.contScope,
          'az role assignment delete --assignee ' + AZ.mi + ' --role Reader --scope ' + AZ.acctScope, 'sleep 90', 'workload run'];
        return ['cat MIGRATION.md', 'gcloud run services logs read beacon-worker --region europe-west4', 'gcloud run services describe beacon-worker --region europe-west4 --format=value(spec.template.spec.serviceAccountName)',
          'gcloud projects get-iam-policy looped-app-prj --flatten=bindings[].members --filter=bindings.members:' + GCP.sa, 'gcloud storage buckets list --project looped-data-prj', 'ref gcp-iam-hierarchy',
          'gcloud projects remove-iam-policy-binding looped-app-prj --member=serviceAccount:' + GCP.sa + ' --role=roles/storage.objectViewer',
          'gcloud storage buckets add-iam-policy-binding gs://' + GCP.bucket + ' --member=serviceAccount:' + GCP.sa + ' --role=roles/storage.objectViewer', 'sleep 60',
          'gcloud storage ls gs://' + GCP.bucket + ' --impersonate-service-account=' + GCP.sa];
      },
      mechanism: 'On AWS the team granted access by attaching a policy to the workload\'s role naming the bucket, and within one account that was enough. The migration copied that habit and got a grant that looks right but does not reach the data. (a) Azure separates the **control plane** (Azure Resource Manager: see and manage the storage account) from the **data plane** (read the blobs). Reader carries only `actions` (`*/read`), no `dataActions`, so the managed identity can see the account but its token cannot read a blob: 403 AuthorizationPermissionMismatch. The engineer\'s laptop works because that user already holds Storage Blob Data Reader. Fix: assign **Storage Blob Data Reader** to the managed identity at the storage account or the `archive` container, remove the useless Reader assignment, wait for propagation, and test as the workload. (b) Google Cloud IAM policies attach to resources and are **inherited down the hierarchy**. The worker\'s service account got Storage Object Viewer on looped-app-prj, where the worker runs, but the bucket belongs to looped-data-prj (its bucket policy names projectViewer:looped-data-prj), so that grant never applies to it. With uniform bucket-level access there is no ACL to fall back on. Fix: bind roles/storage.objectViewer for the service account **on the bucket**, remove the project-wide binding (it also let the worker read every bucket in the app project), wait, and test as the service account.',
      alternatives: [
        { h: 'Network or firewall', out: 'Ruled out: the request reached the storage service and got a 403 naming the permission; a network block is a timeout or a connection error.' },
        { h: 'The data is missing', out: 'Ruled out: an engineer lists it; the error is about permission, not existence.' },
        { h: 'Give the worker an access key / SAS / service-account key instead', out: 'Works, but brings back a long-lived secret the migration deliberately removed; fix the identity\'s grant instead.' },
        { h: 'Grant at the subscription, resource group or data project', out: 'Works for the data-plane role but grants read on everything in that scope; the bucket/account/container is the narrowest scope that fits.' }
      ],
      clues: ['"Works from my laptop" proves the engineer\'s access, not the workload\'s.', 'The 403 text names the missing permission and the principal: read both.'],
      passRubric: ['Names the principal the workload uses and the grant it actually had (role + scope)', 'Explains the provider-specific reason that grant does not reach the data (data plane vs control plane, or resource hierarchy) citing the reference note', 'Grants the narrow read role at the narrowest sensible scope and removes the ineffective grant', 'Verifies as the workload after propagation, not as themselves'],
      prereqs: ['les-m15-01', 'les-m15-02'], refs: ['T19', 'T20', 'T18']
    }
  });
  /* ═══ S30 · Customer reports random API failures ═════════════════════ */
  var CUST_KEY = 'lab-kestrel-7c1e9b44-not-a-real-secret';
  var TEST_KEY = 'lab-support-sandbox-51d0-not-a-real-secret';
  var S30_CLASSES = { a: ['429', 'timeout'], b: ['401', 'stream'], c: ['403', 'timeout'] };
  var S30_LABEL = { '429': 'rate limiting (429)', 'timeout': 'client timeouts', '401': 'authentication failures (401)', '403': 'permission failures (403)', 'stream': 'interrupted streams' };
  var WINDOW_SEC = { '1d': 8, '7d': 22, '30d': 75 };
  var TPM = 40000;
  /* the review rubric for a customer reply: one row per failure class */
  var S30_RUBRIC = {
    '429': { cat: /\b429\b|rate[ -]?limit/i, cause: /tokens? per minute|\bTPM\b|token quota|quota of|40,?000|reserv|burst|concurren|parallel/i, next: /retry-after|back-?off|honou?r/i },
    'timeout': { cat: /time[ -]?outs?|timed out/i, cause: /30 ?s(ec(ond)?s?)?\b|read timeout|longer than|takes? (about |around |up to )?\d+ ?s|75 ?s|30-day|30d/i, next: /increase|raise|longer timeout|timeout (to|of|above)|stream/i },
    '401': { cat: /\b401\b|authenticat|invalid (api )?key|unauthori/i, cause: /rotat|revoked|old key|previous key|key_k3f9/i, next: /update|replace|new key|key_k7a2|redeploy/i },
    '403': { cat: /\b403\b|permission|entitle|not enabled|forbidden/i, cause: /entitle|plan|enterprise|add-?on|not enabled/i, next: /request access|enable|account (team|manager)|upgrade|contact|add-?on|remove|disable/i },
    'stream': { cat: /stream|SSE|server-sent/i, cause: /proxy|60 ?s|intermediar|max(imum)? (connection )?duration|cut|closed/i, next: /terminal|done event|event: done|\[DONE\]|treat|check|proxy|resume|retry the/i }
  };
  var UNBOUNDED = /retr(y|ies|ying)[^.;!?\n]{0,30}(indefinitely|forever|until (it|they|the request|the call) (works?|succeeds?|goes through)|without (a )?limit|no limit|unlimited|endlessly|immediately and (again|forever))|keep retrying|infinite retr|unlimited retr|retry (on )?every (error|failure) immediately/i;
  function s30Review(s, text) {
    var t = String(text || ''), out = { classes: {}, secret: false, unbounded: false, ok: true };
    (S30_CLASSES[s.variant] || []).forEach(function (k) {
      var R = S30_RUBRIC[k], ids = s.samples[k] || [];
      var row = { rid: ids.some(function (id) { return t.indexOf(id) !== -1; }), cat: R.cat.test(t), cause: R.cause.test(t), next: R.next.test(t) };
      row.ok = row.rid && row.cat && row.cause && row.next;
      if (!row.ok) out.ok = false;
      out.classes[k] = row;
    });
    out.secret = t.indexOf(CUST_KEY) !== -1 || t.indexOf(TEST_KEY) !== -1 || /lab-kestrel-[0-9a-f]+/.test(t) || /Bearer\s+\S{12,}/.test(t);
    var re = new RegExp(UNBOUNDED.source, 'ig'), m;
    while ((m = re.exec(t))) { if (!negatedBefore(t, m.index)) { out.unbounded = true; break; } }
    if (out.secret || out.unbounded) out.ok = false;
    return out;
  }
  function s30ReproDone(s) {
    return (S30_CLASSES[s.variant] || []).every(function (k) { var r = s.repro[k]; return r && r.fail && r.ok; });
  }
  function ridOf(seed, n) { return 'req_' + hex(seed + ':' + n, 14); }
  function s30Stamp(base, sec) {
    var t = base + sec, h = Math.floor(t / 3600), mi = Math.floor(t % 3600 / 60), se = (t % 60).toFixed(3);
    return '2026-10-12T' + (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi + ':' + (se.length < 6 ? '0' : '') + se + 'Z';
  }
  function s30Logs(v, seed) {
    var base = 14 * 3600, n = 0, gw = [], cl = [], samples = { '429': [], 'timeout': [], '401': [], '403': [], 'stream': [] };
    function g(sec, o) { var r = { ts: s30Stamp(base, sec), request_id: ridOf(seed, n++), org: 'org_kestrel' }; Object.keys(o).forEach(function (k) { r[k] = o[k]; }); gw.push(r); return r; }
    function c(sec, line) { cl.push(s30Stamp(base, sec) + ' ' + line); }
    var ok = function (sec, host, path, win, key) {
      var lat = WINDOW_SEC[win] + (n % 3) * 0.4, o = g(sec, { key_id: key || 'key_k7a2', method: 'POST', path: path || '/v1/summaries', window: win, max_tokens: 6000, stream: false, status: 200, latency_ms: Math.round(lat * 1000), client: host });
      c(sec + lat, 'INFO  POST ' + o.path + ' window=' + win + ' status=200 request_id=' + o.request_id + ' elapsed=' + lat.toFixed(1) + 's host=' + host);
    };
    c(0, 'DEBUG client kestrel-batch 2.4 starting 8 workers; read_timeout=30s; retry=on-any-error, immediate');
    c(0.05, 'DEBUG request headers={\'Authorization\': \'Bearer ' + CUST_KEY + '\', \'Content-Type\': \'application/json\'}');
    if (v === 'a') {
      for (var mnt = 0; mnt < 2; mnt++) {
        var t0 = mnt * 60 + 0.1;
        for (var k = 0; k < 8; k++) {
          var host = 'kestrel-batch-' + (1 + k % 3), tk = t0 + k * 0.02;
          if (k < 6) {
            if (k === 1 || k === 4) {
              var o1 = g(tk, { key_id: 'key_k7a2', method: 'POST', path: '/v1/summaries', window: '30d', max_tokens: 6000, stream: false, status: 499, error_type: 'client_closed_request', latency_ms: 30004 + k, upstream_estimate_ms: 75000, client: host });
              samples.timeout.push(o1.request_id);
              c(tk + 30.004, 'ERROR POST /v1/summaries window=30d ReadTimeout: HTTPSConnectionPool(host=\'api.beacon.lab\', port=443): Read timed out. (read timeout=30) host=' + host);
            } else ok(tk, host, '/v1/summaries', '1d');
          } else {
            for (var att = 1; att <= 3; att++) {
              var ta = tk + (att - 1) * 0.15, ra = Math.max(1, Math.round(60 - (ta % 60)));
              var o2 = g(ta, { key_id: 'key_k7a2', method: 'POST', path: '/v1/summaries', window: '1d', max_tokens: 6000, stream: false, status: 429, error_type: 'rate_limit_error', retry_after: ra, ratelimit_limit_tokens: TPM, ratelimit_remaining_tokens: TPM - 36000, latency_ms: 3, client: host });
              samples['429'].push(o2.request_id);
              c(ta + 0.003, 'ERROR POST /v1/summaries status=429 request_id=' + o2.request_id + ' error=rate_limit_error "tokens per minute limit exceeded" retry_after=' + ra + ' -> retrying now (attempt ' + (att + 1) + ')');
            }
          }
        }
      }
    } else if (v === 'b') {
      for (var i = 0; i < 9; i++) {
        var tb = i * 20 + 0.2, hb = 'kestrel-batch-' + (1 + i % 3);
        if (hb === 'kestrel-batch-3') {
          var o3 = g(tb, { key_id: 'key_k3f9', method: 'POST', path: '/v1/summaries', window: '1d', max_tokens: 6000, stream: false, status: 401, error_type: 'authentication_error', error: 'invalid api key (revoked)', latency_ms: 2, client: hb });
          samples['401'].push(o3.request_id);
          c(tb + 0.002, 'ERROR POST /v1/summaries status=401 request_id=' + o3.request_id + ' error=authentication_error "invalid api key" host=' + hb);
        } else if (i % 2 === 0) {
          var o4 = g(tb, { key_id: 'key_k7a2', method: 'POST', path: '/v1/summaries', window: '30d', max_tokens: 6000, stream: true, status: 200, latency_ms: 60002, events_sent: 41, terminal_event_sent: false, close_reason: 'client_closed', client: hb, via: 'egress-proxy.kestrel.example' });
          samples.stream.push(o4.request_id);
          c(tb + 60.002, 'INFO  POST /v1/summaries window=30d stream=true status=200 request_id=' + o4.request_id + ' chunks=41 elapsed=60.0s -> summary saved host=' + hb);
        } else {
          var o5 = g(tb, { key_id: 'key_k7a2', method: 'POST', path: '/v1/summaries', window: '1d', max_tokens: 6000, stream: true, status: 200, latency_ms: 8100, events_sent: 12, terminal_event_sent: true, close_reason: 'complete', client: hb, via: 'egress-proxy.kestrel.example' });
          c(tb + 8.1, 'INFO  POST /v1/summaries window=1d stream=true status=200 request_id=' + o5.request_id + ' chunks=12 elapsed=8.1s -> summary saved host=' + hb);
        }
      }
    } else {
      for (var j = 0; j < 9; j++) {
        var tc = j * 20 + 0.2, hc = 'kestrel-batch-' + (1 + j % 3);
        if (j % 3 === 1) {
          var o6 = g(tc, { key_id: 'key_k7a2', method: 'POST', path: '/v1/forecast', window: '7d', max_tokens: 6000, stream: false, status: 403, error_type: 'permission_error', error: 'organization org_kestrel is not entitled to /v1/forecast', latency_ms: 2, client: hc });
          samples['403'].push(o6.request_id);
          c(tc + 0.002, 'ERROR POST /v1/forecast status=403 request_id=' + o6.request_id + ' error=permission_error host=' + hc);
        } else if (j % 3 === 2) {
          var o7 = g(tc, { key_id: 'key_k7a2', method: 'POST', path: '/v1/summaries', window: '30d', max_tokens: 6000, stream: false, status: 499, error_type: 'client_closed_request', latency_ms: 30003, upstream_estimate_ms: 75000, client: hc });
          samples.timeout.push(o7.request_id);
          c(tc + 30.003, 'ERROR POST /v1/summaries window=30d ReadTimeout: HTTPSConnectionPool(host=\'api.beacon.lab\', port=443): Read timed out. (read timeout=30) host=' + hc);
        } else ok(tc, hc, '/v1/summaries', '1d');
      }
    }
    cl.sort();
    gw.sort(function (x, y) { return x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : 0; });
    return { customer: cl.join('\n') + '\n', gateway: gw.map(function (o) { return JSON.stringify(o); }).join('\n') + '\n', samples: samples };
  }

  /* jq, bounded: . | .a.b | select(EXPR) | {a, b} | [.a, .b] | @tsv | @csv ; EXPR = comparisons joined by and/or, or (.f | test("re")) */
  function splitTop(str, sep) {
    var out = [], cur = '', depth = 0, q = null;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (q) { cur += ch; if (ch === '\\') { cur += str.charAt(++i); } else if (ch === q) q = null; continue; }
      if (ch === '"') { q = ch; cur += ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (depth === 0 && str.substr(i, sep.length) === sep) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); });
  }
  function jqPath(obj, p) {
    if (p === '.') return obj;
    var parts = p.replace(/^\./, '').split('.'), cur = obj;
    for (var i = 0; i < parts.length; i++) { if (cur == null || typeof cur !== 'object') return null; cur = cur[parts[i]]; if (cur === undefined) cur = null; }
    return cur;
  }
  function jqLit(s) { s = s.trim(); if (/^".*"$/.test(s)) return JSON.parse(s); if (s === 'true') return true; if (s === 'false') return false; if (s === 'null') return null; if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s); throw new Error('unsupported literal ' + s); }
  function jqCond(expr) {
    expr = expr.trim();
    while (expr.charAt(0) === '(' && expr.charAt(expr.length - 1) === ')' && (function () { var d = 0; for (var i = 0; i < expr.length - 1; i++) { if (expr.charAt(i) === '(') d++; if (expr.charAt(i) === ')') d--; if (d === 0) return false; } return true; })()) expr = expr.slice(1, -1).trim();
    var ors = splitTop(expr, ' or ');
    if (ors.length > 1) { var fo = ors.map(jqCond); return function (o) { return fo.some(function (f) { return f(o); }); }; }
    var ands = splitTop(expr, ' and ');
    if (ands.length > 1) { var fa = ands.map(jqCond); return function (o) { return fa.every(function (f) { return f(o); }); }; }
    var t = /^(\.[\w.]*)\s*\|\s*(test|startswith|endswith|contains)\(\s*("(?:[^"\\]|\\.)*")\s*\)$/.exec(expr);
    if (t) { var arg = JSON.parse(t[3]), path = t[1], fn = t[2]; return function (o) { var v = jqPath(o, path); if (typeof v !== 'string') return false; return fn === 'test' ? new RegExp(arg).test(v) : fn === 'startswith' ? v.indexOf(arg) === 0 : fn === 'endswith' ? v.slice(-arg.length) === arg : v.indexOf(arg) !== -1; }; }
    var cmp = /^(\.[\w.]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(expr);
    if (cmp) {
      var lit = jqLit(cmp[3]), pth = cmp[1], op = cmp[2];
      return function (o) { var v = jqPath(o, pth); switch (op) { case '==': return v === lit; case '!=': return v !== lit; case '>=': return v != null && v >= lit; case '<=': return v != null && v <= lit; case '>': return v != null && v > lit; default: return v != null && v < lit; } };
    }
    if (/^\.[\w.]*$/.test(expr)) return function (o) { var v = jqPath(o, expr); return v !== null && v !== false; };
    throw new Error('unsupported condition "' + expr + '"');
  }
  function jqStage(stage) {
    var s = stage.trim(), m;
    if (s === '.' ) return function (x) { return [x]; };
    if (/^\.[\w.]+$/.test(s)) return function (x) { return [jqPath(x, s)]; };
    if ((m = /^select\((.*)\)$/.exec(s))) { var c = jqCond(m[1]); return function (x) { return c(x) ? [x] : []; }; }
    if ((m = /^\{(.*)\}$/.exec(s))) {
      var keys = splitTop(m[1], ',').map(function (k) { return k.replace(/^\./, '').trim(); });
      if (!keys.every(function (k) { return /^[\w]+$/.test(k); })) throw new Error('only {a, b, c} shorthand objects are supported');
      return function (x) { var o = {}; keys.forEach(function (k) { o[k] = x && x[k] !== undefined ? x[k] : null; }); return [o]; };
    }
    if ((m = /^\[(.*)\]$/.exec(s))) { var ps = splitTop(m[1], ','); if (!ps.every(function (p) { return /^\.[\w.]+$/.test(p); })) throw new Error('only [.a, .b] arrays are supported'); return function (x) { return [ps.map(function (p) { return jqPath(x, p); })]; }; }
    if (s === '@tsv' || s === '@csv') return function (x) { if (!Array.isArray(x)) throw new Error(s + ' needs an array input'); return [{ __raw: x.map(function (v) { return s === '@csv' && typeof v === 'string' ? '"' + v + '"' : v == null ? '' : String(v); }).join(s === '@tsv' ? '\t' : ',') }]; };
    if (s === 'keys') return function (x) { return [Object.keys(x || {}).sort()]; };
    throw new Error('unsupported filter "' + s + '"');
  }
  function jqVerb() {
    return function (w, a, stdin) {
      var compact = false, raw = false, slurp = false, rest = [];
      a.forEach(function (x) { if (/^-[a-z]+$/.test(x)) { if (x.indexOf('c') !== -1) compact = true; if (x.indexOf('r') !== -1) raw = true; if (x.indexOf('s') !== -1) slurp = true; } else rest.push(x); });
      var filter = rest[0], file = rest[1];
      var SUP = 'jq (simulation) supports: . , .field.path , select(.f == "x" and .n >= 400 or (.f | test("re"))) , {a, b} , [.a, .b] , @tsv , @csv , keys , chained with | ; flags -c -r -s (slurp then: length)';
      if (!filter) return res('', 2, SUP);
      var text = file ? SIM().readFile(w, file) : stdin;
      if (text == null) return res('', 2, 'jq: error: Could not open ' + file + ': No such file or directory');
      var docs = [];
      try { String(text).split('\n').forEach(function (l) { if (l.trim()) docs.push(JSON.parse(l)); }); }
      catch (e) { return res('', 2, 'jq: error (at <stdin>): input is not JSON lines (' + e.message + ')'); }
      if (slurp) { if (filter.trim() === 'length') return res(String(docs.length)); return res('', 3, 'jq: with -s this simulation supports only `length`.\n' + SUP); }
      var stages;
      try { stages = splitTop(filter, '|').map(jqStage); }
      catch (e) { return res('', 3, 'jq: error: ' + e.message + '\n' + SUP); }
      var outs = [];
      try {
        docs.forEach(function (d) {
          var cur = [d];
          stages.forEach(function (fn) { var nx = []; cur.forEach(function (x) { nx = nx.concat(fn(x)); }); cur = nx; });
          cur.forEach(function (x) { outs.push(x && x.__raw !== undefined ? x.__raw : raw && typeof x === 'string' ? x : JSON.stringify(x, null, compact ? 0 : 2)); });
        });
      } catch (e2) { return res('', 5, 'jq: error: ' + e2.message); }
      return res(outs.join('\n'));
    };
  }

  function s30World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
    var L = s30Logs(v, 'S30-' + v);
    var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], samples: L.samples, repro: {}, replies: [], leaked: false, reproSeq: 0 };
    S30_CLASSES[v].forEach(function (k) { state.repro[k] = { fail: false, ok: false, at: null }; });
    function mark(k, which) { if (!state.repro[k]) return; state.repro[k][which] = true; if (state.repro[k].fail && state.repro[k].ok && state.repro[k].at == null) state.repro[k].at = state.clock; }
    var ticket = '# TICKET-4821 — "Random API failures since yesterday"\nFrom: Dana Okafor, platform engineer, Kestrel Analytics (org_kestrel, plan: standard)\nOpened: 2026-10-12T15:02Z · Priority: high\n\n' +
      'Since yesterday afternoon our integration with the Beacon Insights API fails at random. Some requests work, some fail, and we cannot see a pattern. Excerpt of our client log attached (customer-client.log). Please advise ASAP, our nightly reports are incomplete.\n\n' +
      'Our setup: kestrel-batch 2.4 (Python requests 2.32), 8 workers across 3 hosts, read timeout 30 s, max_tokens 6000, we retry any failed request immediately.' +
      (v === 'b' ? ' We rotated our API key yesterday after your security advisory and updated all hosts. Long summaries are streamed (SSE) through our egress proxy.' : '') +
      (v === 'c' ? ' Release 2.4 also turned on the new forecast feature.' : '') + '\n';
    var playbook = '# Support playbook: API failure tickets\n1. Separate the failures into classes from the customer\'s own log; "random" usually means several distinct causes.\n2. Correlate each class with the gateway log by request id (or by time when the client never received one).\n3. Check the account: plan, limits, entitlements, keys.\n4. Reproduce each class minimally against the mock endpoint with `repro` (support sandbox org; never a customer\'s key), and show the corrected request working.\n5. Reply with: the request ids, what each class is, why it happens, and the exact next step. No credentials in replies; never advise unbounded retries.\n';
    var verbs = {
      jq: jqVerb(),
      account: function (w, a) {
        var sub = a[0] || 'show', org = a[1] || 'org_kestrel';
        if (org !== 'org_kestrel') return res('', 1, 'account: no organization "' + org + '" visible to support (try org_kestrel)');
        var rot = v === 'b';
        var lim = 'limits (plan standard):\n  requests per minute: 60\n  tokens per minute:   40000  (each accepted request reserves its max_tokens until the minute rolls over)\n  429 responses carry Retry-After and x-ratelimit-remaining-tokens';
        var ent = 'entitlements:\n  /v1/summaries   enabled (all plans)\n  /v1/forecast    NOT ENABLED (enterprise plan or forecast add-on)';
        var keys = 'keys:\n  key_k7a2  active    created 2026-10-12T13:57:02Z by dana@kestrel.example' + (rot ? '\n  key_k3f9  REVOKED   2026-10-12T13:58:40Z by dana@kestrel.example (reason: rotation); requests still arriving with it from kestrel-batch-3' : '\n  key_k3f9  REVOKED   2026-08-01T09:12:00Z by dana@kestrel.example (reason: rotation); no use since');
        var head = 'account is a SIMULATION stand-in for the support console (read-only).\norg_kestrel  Kestrel Analytics  plan: standard';
        if (sub === 'show') return res(head + '\n' + lim + '\n' + ent + '\n' + keys);
        if (sub === 'limits') return res(head + '\n' + lim);
        if (sub === 'entitlements') return res(head + '\n' + ent);
        if (sub === 'keys') return res(head + '\n' + keys);
        return res('', 2, 'account (simulation): account show|limits|entitlements|keys [org_kestrel]');
      },
      ticket: function (w, a) {
        var sub = a[0];
        if (sub === 'show' || !sub) return res(ticket);
        if (sub === 'reply') {
          var text = null;
          if (a[1] === '-f' || a[1] === '--file') { text = S.readFile(w, a[2] || ''); if (text == null) return res('', 1, 'ticket reply: cannot read ' + (a[2] || '')); }
          else text = a.slice(1).join(' ');
          if (!String(text).trim()) return res('', 2, 'ticket reply: empty reply. Usage: ticket reply "TEXT" | ticket reply -f FILE');
          var rv = s30Review(state, text);
          state.replies.push({ at: state.clock, text: text, review: rv });
          if (rv.secret) state.leaked = true;
          var L2 = ['Reply #' + state.replies.length + ' sent to Dana Okafor on TICKET-4821.', '', 'Support-lead review of this reply:'];
          Object.keys(rv.classes).forEach(function (k) { var r = rv.classes[k]; L2.push('  ' + S30_LABEL[k] + ': request id ' + (r.rid ? 'yes' : 'NO') + ' · category ' + (r.cat ? 'yes' : 'NO') + ' · cause ' + (r.cause ? 'yes' : 'NO') + ' · next step ' + (r.next ? 'yes' : 'NO')); });
          L2.push('  no credentials in the text: ' + (rv.secret ? 'NO — a credential was sent to the customer' : 'yes'));
          L2.push('  retry advice bounded: ' + (rv.unbounded ? 'NO — advises retrying without a bound' : 'yes'));
          L2.push('  reproduced before replying: ' + (s30ReproDone(state) ? 'yes' : 'not yet for every class'));
          return res(L2.join('\n'));
        }
        return res('', 2, 'ticket (simulation): ticket show | ticket reply "TEXT" | ticket reply -f FILE');
      },
      repro: function (w, a) {
        var p = SIM().flags(a, ['endpoint', 'plan', 'key', 'timeout', 'max-tokens', 'window', 'burst', 'via-proxy', 'header', 'H']), f = p.f;
        if (f.help || p.pos.length) return res('repro is a SIMULATION stand-in: a minimal client that sends one request (or a burst) to the MOCK Beacon Insights endpoint as the support sandbox org.\nUsage: repro [--endpoint /v1/summaries|/v1/forecast] [--plan standard|enterprise] [--key current|rotated] [--window 1d|7d|30d] [--max-tokens N] [--timeout SECONDS] [--stream] [--burst N] [--honor-retry-after] [--via-proxy SECONDS]', p.pos.length ? 2 : 0);
        var ep = f.endpoint || '/v1/summaries', plan = f.plan || 'standard', key = f.key || 'current', win = f.window || '1d';
        var maxT = parseInt(f['max-tokens'] || '2000', 10), to = Number(f.timeout || 60), burst = Math.max(1, Math.min(20, parseInt(f.burst || '1', 10))), proxy = f['via-proxy'] ? Number(f['via-proxy']) : null;
        var hdr = String(f.header || f.H || '');
        if (['/v1/summaries', '/v1/forecast'].indexOf(ep) === -1) return res('', 2, 'repro: the mock serves /v1/summaries and /v1/forecast only');
        if (!WINDOW_SEC[win]) return res('', 2, 'repro: --window must be 1d, 7d or 30d');
        var custKey = key.indexOf('lab-kestrel') !== -1 || hdr.indexOf('lab-kestrel') !== -1;
        var L3 = ['repro (SIMULATION — mock endpoint https://mock.api.beacon.lab, support sandbox org; never production)'];
        if (custKey) {
          state.leaked = true;
          L3.push('> POST ' + ep + ' with a customer credential');
          L3.push('< 401 the mock rejects production keys. That value is a customer\'s secret: it is now in your shell history and this transcript and must be reported for rotation.');
          return res(L3.join('\n'), 1);
        }
        if (['current', 'rotated'].indexOf(key) === -1) return res('', 2, 'repro: --key must be current (the sandbox org\'s active key) or rotated (a key revoked by rotation)');
        var srv = WINDOW_SEC[win] + (ep === '/v1/forecast' ? 4 : 0);
        var reserved = 0, results = [], saw429 = false, honor = !!f['honor-retry-after'];
        L3.push('> ' + burst + ' x POST ' + ep + ' window=' + win + ' max_tokens=' + maxT + ' stream=' + !!f.stream + ' timeout=' + to + 's plan=' + plan + (proxy ? ' via proxy closing connections after ' + proxy + 's' : '') + '  (Authorization: Bearer [redacted sandbox ' + key + ' key])');
        for (var i = 0; i < burst; i++) {
          state.reproSeq++;
          var rid = 'req_mock_' + hex('mock' + state.reproSeq + state.seed, 10);
          if (key === 'rotated') { L3.push('< 401 authentication_error "invalid api key (revoked)" x-request-id: ' + rid); results.push(401); continue; }
          if (ep === '/v1/forecast' && plan !== 'enterprise') { L3.push('< 403 permission_error "organization is not entitled to /v1/forecast (plan: standard)" x-request-id: ' + rid); results.push(403); continue; }
          if (reserved + maxT > TPM) {
            saw429 = true;
            L3.push('< 429 rate_limit_error "tokens per minute limit exceeded" retry-after: 38 x-ratelimit-limit-tokens: ' + TPM + ' x-ratelimit-remaining-tokens: ' + Math.max(0, TPM - reserved) + ' x-request-id: ' + rid);
            if (!honor) { results.push(429); continue; }
            L3.push('  client waits 38 s (Retry-After), then retries once the minute has rolled over (attempt 2 of at most 4)');
            reserved = 0;
            state.reproSeq++;
            rid = 'req_mock_' + hex('mock' + state.reproSeq + state.seed, 10);
          }
          reserved += maxT;
          var cut = proxy && proxy < srv;
          if (f.stream) {
            if (cut) { L3.push('< 200 text/event-stream x-request-id: ' + rid + ' · ' + Math.floor(proxy * 0.68) + ' data events, then the connection closed at ' + proxy.toFixed(1) + ' s · terminal event: NOT received (stream incomplete)'); results.push('cut'); }
            else { L3.push('< 200 text/event-stream x-request-id: ' + rid + ' · ' + Math.round(srv * 0.68) + ' data events over ' + srv.toFixed(1) + ' s · terminal event: received (event: done)'); results.push('stream-ok'); }
          } else if (cut) { L3.push('< (connection closed by the proxy at ' + proxy.toFixed(1) + ' s, before response headers; no x-request-id received)'); results.push('cut'); }
          else if (to < srv) { L3.push('< ReadTimeout after ' + to.toFixed(1) + ' s: no response headers yet, so no x-request-id (the server needed ~' + srv + ' s for a ' + win + ' window; the gateway would log this as 499 client_closed_request)'); results.push('timeout'); }
          else { L3.push('< 200 application/json x-request-id: ' + rid + ' · ' + srv.toFixed(1) + ' s · x-ratelimit-remaining-tokens: ' + Math.max(0, TPM - reserved)); results.push(200); }
        }
        var okAll = results.every(function (x) { return x === 200 || x === 'stream-ok'; });
        /* what this run demonstrated, per failure class */
        if (saw429) mark('429', 'fail');
        if (burst > 1 && okAll && burst * maxT >= 20000) mark('429', 'ok');
        if (results.indexOf('timeout') !== -1 && win === '30d') mark('timeout', 'fail');
        if (win === '30d' && okAll && ep === '/v1/summaries') mark('timeout', 'ok');
        if (results.indexOf(401) !== -1) mark('401', 'fail');
        if (key === 'current' && okAll && state.repro['401'] && state.repro['401'].fail) mark('401', 'ok');
        if (results.indexOf(403) !== -1) mark('403', 'fail');
        if (ep === '/v1/forecast' && plan === 'enterprise' && okAll) mark('403', 'ok');
        if (f.stream && results.indexOf('cut') !== -1 && win === '30d') mark('stream', 'fail');
        if (f.stream && okAll && srv > 60) mark('stream', 'ok');
        var fails = results.filter(function (x) { return x !== 200 && x !== 'stream-ok'; }).length;
        L3.push('summary: ' + (results.length - fails) + ' ok, ' + fails + ' failed');
        return res(L3.join('\n'), results.indexOf('timeout') !== -1 ? 28 : 0);
      }
    };
    return { user: 'lab', host: 'support-desk', cwd: '/home/lab/TICKET-4821',
      dirs: [{ path: '/var/log/beacon-gw' }],
      files: [{ path: '/home/lab/TICKET-4821/TICKET.md', content: ticket }, { path: '/home/lab/TICKET-4821/customer-client.log', content: L.customer },
        { path: '/var/log/beacon-gw/requests.jsonl', content: L.gateway }, { path: '/home/lab/TICKET-4821/PLAYBOOK.md', content: playbook }],
      sre: state, extra: SIM().bind(state, verbs) };
  }
  var S30_MARK = { '429': /status=429/, 'timeout': /ReadTimeout|timed out/, '401': /status=401/, '403': /status=403/, 'stream': /stream=true[^\n]*window=30d|window=30d[^\n]*stream=true/ };
  var S30_GW = { '429': /"status":\s?429/, 'timeout': /"status":\s?499/, '401': /"status":\s?401/, '403': /"status":\s?403/, 'stream': /"terminal_event_sent":\s?false/ };
  var CUSTLOG = /^(grep|egrep|cat|awk|cut|sort|uniq|tail|head|sed|wc)\b.*customer-client\.log/;
  var GWLOG = /^(grep|egrep|cat|awk|tail|head|sed|jq)\b.*requests\.jsonl/;
  function s30Repro(v) {
    if (v === 'a') return 'repro --burst 8 --max-tokens 6000; repro --burst 8 --max-tokens 6000 --honor-retry-after; repro --window 30d --timeout 30; repro --window 30d --timeout 120';
    if (v === 'b') return 'repro --key rotated; repro --key current; repro --stream --window 30d --via-proxy 60; repro --stream --window 30d';
    return 'repro --endpoint /v1/forecast --plan standard; repro --endpoint /v1/forecast --plan enterprise; repro --window 30d --timeout 30; repro --window 30d --timeout 120';
  }
  function s30Reply(c) {
    var s = st(c), sm = s.samples;
    if (s.variant === 'a') return 'ticket reply "Hi Dana, thanks for the logs. These are two separate, predictable issues rather than random ones. 1) Rate limiting (HTTP 429), for example request ' + sm['429'][0] + ': your 8 workers start together and each reserves max_tokens 6000, which exceeds the standard plan quota of 40000 tokens per minute; the 429 carries a Retry-After header. Next step: honour Retry-After with capped exponential backoff and jitter (at most 4 attempts) and lower concurrency or max_tokens. 2) Client timeouts, for example request ' + sm.timeout[0] + ' (our gateway logged it as client closed): 30-day summaries take about 75 s on our side but your read timeout is 30 s, so your client gives up first. Next step: raise the read timeout to about 120 s for those requests, or stream them. We reproduced both against our sandbox."';
    if (s.variant === 'b') return 'ticket reply "Hi Dana, thanks for the logs. Two separate issues. 1) Authentication failures (HTTP 401), for example request ' + sm['401'][0] + ': host kestrel-batch-3 still sends key key_k3f9, which was revoked in yesterday\'s rotation at 13:58 UTC. Next step: update that host to the new key key_k7a2 and redeploy. 2) Interrupted streams, for example request ' + sm.stream[0] + ': every 30-day stream that passes your egress proxy is closed at exactly 60 s, before our terminal event (event: done) is sent; your client treats the closed connection as a finished summary. Next step: raise the proxy maximum connection duration above 90 s for api.beacon.lab, and treat a stream without the terminal event as failed and retry it a bounded number of times. We reproduced both against our sandbox."';
    return 'ticket reply "Hi Dana, thanks for the logs. Two separate issues. 1) Permission failures (HTTP 403) on /v1/forecast, for example request ' + sm['403'][0] + ': your organization is on the standard plan, and forecast is not enabled for it (enterprise plan or the forecast add-on). Next step: contact your account team to enable the add-on, or disable forecast in 2.4 until then. 2) Client timeouts, for example request ' + sm.timeout[0] + ' (our gateway logged it as client closed): 30-day summaries take about 75 s but your read timeout is 30 s. Next step: raise the read timeout to about 120 s for those requests, or stream them. We reproduced both against our sandbox."';
  }

  LX.missions.push({
    id: 'sre-s30', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 30, kind: 'incident',
    title: 'A customer reports random failures from the API',
    brief: function () { return 'TICKET-4821: Kestrel Analytics says their integration with the Beacon Insights API "fails at random" since yesterday and attached a client log. You have the gateway\'s request log, the support console (`account`), a minimal client against the mock endpoint (`repro`) and the playbook. Work out what is actually happening, reproduce it safely, and send a precise reply the customer can act on.'; },
    keys: ['cat TICKET.md', 'cat PLAYBOOK.md', 'grep -c ERROR customer-client.log', 'grep -o "status=[0-9]*" customer-client.log | sort | uniq -c', 'grep -E "ERROR|stream=true" customer-client.log', 'jq -c \'select(.status >= 400)\' /var/log/beacon-gw/requests.jsonl', 'jq -c \'select(.org == "org_kestrel") | {ts, request_id, path, status, latency_ms}\' /var/log/beacon-gw/requests.jsonl', 'account show', 'repro --help', 'ticket reply "…"'],
    world: s30World,
    objectives: [
      { id: 'classify', stage: 'evidence', text: 'Sort the customer\'s failures into distinct kinds using their own log',
        hint: '"Random" failures are usually several different failures mixed together. Group by what the client saw.',
        hint2: 'Count by status and error type: `grep -o "status=[0-9]*" customer-client.log | sort | uniq -c`, then look at lines with no status at all, and at the long requests.',
        reveal: 'grep -E "ERROR|window=30d" customer-client.log',
        done: function (c) { return S30_CLASSES[st(c).variant].every(function (k) { return saw(c, CUSTLOG, S30_MARK[k]); }); } },
      { id: 'correlate', stage: 'evidence', text: 'Find each kind of failure in the gateway log by request id (or by time where the client never got one)',
        hint: 'Our side records every request, including the ones whose response the client never saw.',
        hint2: '`jq -c \'select(.status >= 400 or .terminal_event_sent == false)\' /var/log/beacon-gw/requests.jsonl` and compare ids and timestamps with the customer log.',
        reveal: 'jq -c \'select(.status >= 400 or .terminal_event_sent == false)\' /var/log/beacon-gw/requests.jsonl',
        done: function (c) { var s = st(c); return S30_CLASSES[s.variant].every(function (k) { return c.ran.some(function (x, i) { return SIM().cmdIs(x, GWLOG) && s.samples[k].some(function (id) { return (c.out[i] || '').indexOf(id) !== -1; }); }); }); } },
      { id: 'account', stage: 'evidence', text: 'Check the customer\'s account settings that bear on these failures',
        hint: 'Plans, quotas, entitlements and keys explain a lot of 4xx responses.',
        hint2: '`account show` (or `account limits`, `account entitlements`, `account keys`).',
        reveal: 'account show',
        done: function (c) { var v = st(c).variant; var re = v === 'a' ? /tokens per minute/ : v === 'b' ? /REVOKED\s+2026-10-12/ : /forecast\s+NOT ENABLED/; return saw(c, /account\b/, re); } },
      { id: 'repro', stage: 'fix', text: 'Reproduce each kind minimally against the mock endpoint, and show the corrected request succeeding',
        hint: 'One variable at a time: the smallest request that fails the same way, then the same request with the one change your reply will recommend.',
        hint2: '`repro --help`. For example: a burst that exceeds the token quota, then with --honor-retry-after; a long window with the customer\'s timeout, then a longer one; a rotated key, then the current one; a stream through a 60 s proxy, then direct; forecast on standard, then enterprise.',
        reveal: function (c) { return s30Repro(st(c).variant); },
        done: function (c) { var s = st(c); return s30ReproDone(s) && !s.leaked; } },
      { id: 'reply', stage: 'verify', text: 'Send the customer one precise reply: request ids, what each failure is, why it happens, and the next step — with no secrets',
        hint: 'Each kind of failure needs its own id, category, cause and action. Keep their key and ours out of it.',
        hint2: '`ticket reply "…"` (or write it to a file and `ticket reply -f reply.txt`); the reply is reviewed when sent.',
        reveal: function (c) { return s30Reply(c); },
        done: function (c) {
          var s = st(c), last = s.replies[s.replies.length - 1];
          if (!last || !last.review.ok || !s30ReproDone(s)) return false;
          return S30_CLASSES[s.variant].every(function (k) { return s.repro[k].at != null && s.repro[k].at <= last.at; });
        } }
    ],
    sre: {
      scenarioId: 'S30', moduleId: 'M15', lab: 'L30', variants: ['a', 'b', 'c'],
      symptom: 'A customer sees intermittent failures from the API and cannot see a pattern.',
      neutralTitle: 'Customer reports random API failures',
      neutralBrief: 'A customer integration with the Beacon Insights API "fails at random" since yesterday. You have their client log, the gateway request log, a read-only support console and a minimal client against a mock endpoint. Work out what is happening, reproduce it safely, and send a precise reply.',
      impact: 'The customer\'s nightly reports are incomplete; they are considering escalating.',
      changes: 'Customer-side: a new client release and configuration changes they describe in the ticket. Our side: no deploys in the window.',
      spoilers: ['rate limit', '429', 'timeout', '401', '403', 'revoked', 'rotation', 'entitle', 'proxy', 'terminal event', 'quota'],
      tools: ['grep / sort / uniq / cut over the customer log', 'jq (bounded subset) over the gateway JSON-lines log', 'account (support console stand-in)', 'repro (minimal client against the mock endpoint)', 'ticket show | reply'],
      grammar: ['`grep`, `cut`, `sort`, `uniq -c`, `wc`, `cat`, `tail` on customer-client.log', '`jq [-c] [-r] FILTER FILE` where FILTER is `.`, `.a.b`, `select(.f == "x" and .n >= 400 or (.f | test("re")))`, `{a, b}`, `[.a, .b]`, `@tsv`, chained with `|`; `jq -s length`', '`account show|limits|entitlements|keys`', '`repro [--endpoint P] [--plan standard|enterprise] [--key current|rotated] [--window 1d|7d|30d] [--max-tokens N] [--timeout S] [--stream] [--burst N] [--honor-retry-after] [--via-proxy S]`', '`ticket show`, `ticket reply "TEXT"`, `ticket reply -f FILE`'],
      palette: ['cat TICKET.md', 'cat PLAYBOOK.md', 'grep -o "status=[0-9]*" customer-client.log | sort | uniq -c', 'grep -E "ERROR|window=30d" customer-client.log', 'jq -c \'select(.status >= 400 or .terminal_event_sent == false)\' /var/log/beacon-gw/requests.jsonl', 'jq -c \'select(.request_id == "REQ_ID")\' /var/log/beacon-gw/requests.jsonl', 'account show', 'repro --help', 'ticket reply -f reply.txt'],
      assumptions: ['The gateway log is complete for org_kestrel in the window.', 'The mock endpoint behaves like production for status codes, headers, quotas, entitlements and durations; it never accepts production keys.', 'Replies go to the customer; anything you put in one has left the building.'],
      simplified: ['The API, its quota (tokens reserved from max_tokens per minute), its entitlements and its stream behaviour are a small deterministic model; durations depend only on the requested window.', 'jq is a bounded subset (see grammar); the review of a reply is a rubric that checks for request ids, category, cause, next step, credentials and unbounded-retry advice — a support lead would read for tone and accuracy too.', 'repro is a stand-in for the small Python reproduction the local lab L30 has you write; the mock never calls production.', 'Each command advances the clock 10 seconds.'],
      unsafe: [
        { label: 'exposed the customer\'s API key', why: 'The customer pasted a live credential into their log. Copying it into a reproduction (shell history, transcripts) or a reply spreads a secret that must instead be reported for rotation; reproductions use the sandbox org.',
          test: function (c) { return !!st(c).leaked; },
          demo: 'repro --key ' + CUST_KEY },
        { label: 'advised unbounded retries', why: 'Retrying "until it works" turns a quota or an outage into a retry storm and keeps the customer rate-limited; advice must be bounded, honour Retry-After, and back off.',
          test: function (c) { return st(c).replies.some(function (r) { return r.review.unbounded; }); },
          demo: 'ticket reply "Hi Dana, these are transient. Please just retry failed requests until they succeed."' }
      ],
      alt: function (v) {
        if (v === 'a') return ['cat TICKET.md', 'grep -o "status=[0-9]*" customer-client.log | sort | uniq -c', 'grep ReadTimeout customer-client.log',
          'jq -c \'select(.status == 429) | {ts, request_id, retry_after, ratelimit_remaining_tokens}\' /var/log/beacon-gw/requests.jsonl',
          'jq -c \'select(.status == 499) | [.ts, .request_id, .window, .latency_ms]\' /var/log/beacon-gw/requests.jsonl', 'account limits',
          'repro --burst 8 --max-tokens 6000', 'repro --burst 4 --max-tokens 6000', 'repro --window 30d --timeout 30', 'repro --window 30d --stream',
          function (c) { return s30Reply(c).replace('honour Retry-After with capped exponential backoff and jitter (at most 4 attempts) and lower concurrency or max_tokens', 'cap concurrency at 4 workers or lower max_tokens so a minute stays under quota, and back off for Retry-After seconds (at most 3 retries)'); }];
        if (v === 'b') return ['cat TICKET.md', 'grep status=401 customer-client.log', 'grep stream=true customer-client.log',
          'jq -c \'select(.status == 401) | {ts, request_id, key_id, client}\' /var/log/beacon-gw/requests.jsonl',
          'jq -c \'select(.stream == true) | [.request_id, .window, .latency_ms, .terminal_event_sent, .close_reason]\' /var/log/beacon-gw/requests.jsonl', 'account keys',
          'repro --stream --window 30d --via-proxy 60', 'repro --stream --window 30d --via-proxy 120', 'repro --key rotated', 'repro', function (c) { return s30Reply(c); }];
        return ['cat TICKET.md', 'grep -E "status=403|ReadTimeout" customer-client.log', 'jq -c \'select(.path == "/v1/forecast")\' /var/log/beacon-gw/requests.jsonl',
          'jq -c \'select(.status == 499)\' /var/log/beacon-gw/requests.jsonl', 'account entitlements',
          'repro --endpoint /v1/forecast --plan standard', 'repro --endpoint /v1/forecast --plan enterprise', 'repro --window 30d --timeout 30', 'repro --window 30d --stream --timeout 30', function (c) { return s30Reply(c); }];
      },
      mechanism: 'Nothing was random: two independent conditions were interleaved in one log. (a) **429**: eight workers start at the top of each minute and each reserves max_tokens 6000 against a 40000 tokens-per-minute quota, so the 7th and 8th are rejected with Retry-After; the client then retries immediately, which can only fail again. **Timeouts**: 30-day summaries take ~75 s server-side, the client\'s read timeout is 30 s, so the client gives up before headers arrive — it has no request id, and our gateway logs a 499 at 30 s. (b) **401**: one of three hosts still sends key_k3f9, revoked in yesterday\'s rotation, so a third of requests fail. **Stream interruption**: long streams through the customer\'s egress proxy are closed at exactly 60 s, before the terminal `event: done`; the client treats a closed connection as a complete summary. (c) **403**: the new forecast feature calls an endpoint the standard plan is not entitled to, plus the same timeout pattern. A good support response correlates each class by request id (or time), proves it with a minimal reproduction that changes one variable, and tells the customer the cause and the exact next step — without echoing their credential or advising unbounded retries.',
      alternatives: [
        { h: 'Our API is degraded', out: 'Ruled out: the gateway shows fast, well-formed 4xx responses with specific error types, and the mock reproduces each one deterministically.' },
        { h: 'A network problem between us', out: 'Ruled out for most classes: the requests arrive and are answered. The interrupted streams are a network element on their side, shown by the exact 60 s cut and a direct stream completing.' },
        { h: 'Tell them to retry more', out: 'Rejected: retries cannot fix a revoked key, a missing entitlement or a too-short timeout, and unbounded retries make 429s worse.' }
      ],
      clues: ['Timeouts have no request id on the client side; correlate them by timestamp and the 499s in the gateway log.', 'A failure confined to one host or one endpoint is a strong hint that it is not random.'],
      passRubric: ['Separates the failures into distinct classes with counts', 'Correlates each class to gateway evidence by request id (or time)', 'Reproduces each class minimally and shows the one-variable fix', 'Reply gives request ids, category, cause and next step per class, bounded retry advice, and no secrets'],
      prereqs: ['les-m15-04', 'les-m04-05'], refs: ['T11', 'J10']
    }
  });
  /* ═══ S31 · New release fails in restricted environment (capstone) ═══ */
  var S31_MIRROR = 'registry.lab/mirror/beacon/';
  var S31_EXT_WORKER = 'registry.beacon.example/beacon/worker:1.6.0';
  var S31_DSN = 'postgres://beacon@beacon-db.beacon.svc:5432/beacon';
  var S31_SCHEMA = 12;
  var S31_COMPAT = { '1.4.0': [9, 10], '1.5.0': [11, 11], '1.5.1': [11, 12], '1.6.0': [12, 12] };
  var S31_CHART = { '1.4.0': 'beacon-0.7.0', '1.5.0': 'beacon-0.8.0', '1.5.1': 'beacon-0.8.1', '1.6.0': 'beacon-0.9.0' };
  var K8S_RESTRICTED_SIMPLIFIED = [
    'The cluster is the course\'s reconciling model (k8s-model.js): one logical clock, first-fit scheduling, readiness decided by the app profile; kubectl output follows the real tool closely but is abridged.',
    'NetworkPolicy is evaluated as a small rule table (pod selector by app label, egress to a pod label and/or ports, DNS by namespace selector); no CIDR blocks, no ingress rules, no CNI quirks. Admission is one rule (no floating tags) applied to Deployment changes.',
    'Helm is a stand-in: releases are values files rendered by a fixed template; rollback re-applies a revision\'s values; --wait polls readiness for up to 300 logical seconds. No hooks run again, no helm-diff, no --set.',
    'The database is modelled only as its schema version; `audit` and `smoke` are course stand-ins for a change log and a smoke-test job. Each command advances the clock 10 seconds.'
  ];
  function s31Dg(name, ver) { return digestOf('s31:' + name + ':' + ver); }
  function s31Img(name, ver) { return S31_MIRROR + name + ':' + ver + '@' + s31Dg(name, ver); }
  var S31_PG = 'registry.lab/mirror/library/postgres:16.4@' + digestOf('s31:postgres');
  var S31_TOOLBOX = 'registry.lab/mirror/tools/toolbox:1.2.0@' + digestOf('s31:toolbox');
  function s31Floating(img) { var ref = String(img || ''); if (ref.indexOf('@sha256:') !== -1) return false; var last = ref.split('/').pop(); return last.indexOf(':') === -1 || /:latest$/.test(ref); }
  function s31Pinned(img) { return /^registry\.lab\//.test(img) && /@sha256:[0-9a-f]{64}$/.test(img); }
  function s31Values(ver, v) {
    var cfg = { BEACON_STORE_URL: S31_DSN, BEACON_LOG_LEVEL: 'info' };
    var vals = { app: ver, api: { image: s31Img('api', ver) }, worker: { enabled: false, image: '' }, config: cfg, networkPolicy: { apiDbEgress: true, workerDbEgress: false } };
    if (ver === '1.6.0') {
      vals.worker = { enabled: true, image: v === 'a' ? S31_EXT_WORKER : s31Img('worker', '1.6.0') };
      vals.config = v === 'b' ? { BEACON_DB_DSN: S31_DSN, BEACON_QUEUE: 'postgres', BEACON_LOG_LEVEL: 'info' } : { BEACON_STORE_URL: S31_DSN, BEACON_QUEUE: 'postgres', BEACON_LOG_LEVEL: 'info' };
      vals.networkPolicy = { apiDbEgress: true, workerDbEgress: v !== 'c' };
    }
    return vals;
  }
  function s31ValuesYaml(vals) {
    var L = ['# beacon chart values (release ' + vals.app + ')', 'api:', '  image: ' + vals.api.image, 'worker:', '  enabled: ' + !!vals.worker.enabled, '  image: ' + (vals.worker.image || '""'), 'config:'];
    Object.keys(vals.config).forEach(function (k) { L.push('  ' + k + ': ' + vals.config[k]); });
    L.push('networkPolicy:', '  apiDbEgress: ' + !!vals.networkPolicy.apiDbEgress, '  workerDbEgress: ' + !!vals.networkPolicy.workerDbEgress);
    return L.join('\n') + '\n';
  }
  function s31ParseValues(text, appVersion) {
    var d = KM().parseYaml(text || '');
    if (!d || !d.api || !d.api.image || !d.config || typeof d.config !== 'object') throw new Error('values must define api.image, worker.enabled/image, config and networkPolicy');
    var w = d.worker || {}, np = d.networkPolicy || {};
    var cfg = {}; Object.keys(d.config).forEach(function (k) { cfg[k] = String(d.config[k]); });
    return { app: appVersion, api: { image: String(d.api.image) }, worker: { enabled: w.enabled === true, image: w.image ? String(w.image) : '' }, config: cfg, networkPolicy: { apiDbEgress: np.apiDbEgress !== false, workerDbEgress: np.workerDbEgress === true } };
  }
  function s31Render(vals) {
    var sum = { 'checksum/config': KM().hashOf(vals.config) };
    var api = { labels: { app: 'beacon-api' }, annotations: clone(sum), containers: [{ name: 'api', image: vals.api.image, ports: [{ name: 'http', containerPort: 8080 }], envFrom: [{ configMapRef: 'beacon-config' }], readiness: { path: '/ready', port: 8080, period: 5 }, liveness: { path: '/healthz', port: 8080, initialDelay: 10 } }] };
    var worker = vals.worker.enabled ? { labels: { app: 'beacon-worker' }, annotations: clone(sum), containers: [{ name: 'worker', image: vals.worker.image, ports: [{ name: 'http', containerPort: 8080 }],
      env: [{ name: 'BEACON_STORE_URL', configMapKey: { name: 'beacon-config', key: 'BEACON_STORE_URL' } }, { name: 'BEACON_QUEUE', configMapKey: { name: 'beacon-config', key: 'BEACON_QUEUE', optional: true } }],
      readiness: { path: '/ready', port: 8080, period: 5 } }] } : null;
    var pols = [
      { name: 'default-deny-egress', selector: null, egress: [], helm: true },
      { name: 'allow-dns-egress', selector: null, egress: [{ dns: true, toApp: null, any: false, ports: [53] }], helm: true },
      { name: 'beacon-client-egress', selector: 'beacon-client', egress: [{ toApp: 'beacon-api', any: false, ports: [8080] }], helm: true }
    ];
    if (vals.networkPolicy.apiDbEgress) pols.push({ name: 'beacon-api-egress', selector: 'beacon-api', egress: [{ toApp: 'beacon-db', any: false, ports: [5432] }], helm: true });
    if (vals.worker.enabled && vals.networkPolicy.workerDbEgress) pols.push({ name: 'beacon-worker-egress', selector: 'beacon-worker', egress: [{ toApp: 'beacon-db', any: false, ports: [5432] }], helm: true });
    return { api: api, worker: worker, config: clone(vals.config), pols: pols };
  }
  function s31Egress(s, src, dst, port) {
    var app = s.pols.filter(function (p) { return p.selector === null || p.selector === src; });
    if (!app.length) return true;
    return app.some(function (p) { return p.egress.some(function (r) { return (r.any || r.toApp === dst) && (!r.ports.length || r.ports.indexOf(port) !== -1); }); });
  }
  function s31ApiVersions(m) {
    var out = [];
    m.pods.forEach(function (p) { if (!p.gone && (p.labels || {}).app === 'beacon-api' && KM().podReady(p)) { var mm = /\/api:(\d+\.\d+\.\d+)/.exec(p.containers[0].image); if (mm && out.indexOf(mm[1]) === -1) out.push(mm[1]); } });
    return out;
  }
  function s31Dep(m, name) { return KM().find(m, 'deployments', name, m.ns); }
  function s31Ready(m, app) { return m.pods.filter(function (p) { return !p.gone && (p.labels || {}).app === app && KM().podReady(p); }).length; }
  function s31Checks(s, m) {
    var cur = s.rels[s.rels.length - 1], vals = cur.values, R = [];
    var api = s31Dep(m, 'beacon-api');
    var apiOk = !!api && KM().rolloutComplete(m, 'beacon-api', m.ns) && s31Ready(m, 'beacon-api') >= 2;
    R.push({ id: 'api-available', st: apiOk ? 'PASS' : 'FAIL', d: apiOk ? 'beacon-api rollout complete, ' + s31Ready(m, 'beacon-api') + ' ready' : 'beacon-api: rollout incomplete or fewer than 2 ready pods' });
    var vers = s31ApiVersions(m);
    var verOk = apiOk && vers.length === 1 && vers[0] === cur.app;
    R.push({ id: 'api-version', st: verOk ? 'PASS' : 'FAIL', d: 'GET http://beacon-api/version via beacon-client -> ' + (vers.length ? vers.join(', ') : 'no ready backend') + ' (release record says ' + cur.app + ')' });
    var wd = s31Dep(m, 'beacon-worker');
    if (vals.worker.enabled) {
      var wOk = !!wd && KM().rolloutComplete(m, 'beacon-worker', m.ns) && s31Ready(m, 'beacon-worker') >= 1;
      R.push({ id: 'worker-ready', st: wOk ? 'PASS' : 'FAIL', d: wOk ? 'beacon-worker ready' : 'beacon-worker has no ready pod' });
      var dbp = s31Egress(s, 'beacon-worker', 'beacon-db', 5432);
      R.push({ id: 'worker-db-path', st: dbp ? 'PASS' : 'FAIL', d: 'egress beacon-worker -> beacon-db:5432 ' + (dbp ? 'allowed' : 'denied by NetworkPolicy') });
    } else {
      R.push({ id: 'worker-ready', st: 'SKIP', d: 'release ' + cur.app + ' has no worker' });
      R.push({ id: 'worker-db-path', st: 'SKIP', d: 'release ' + cur.app + ' has no worker' });
    }
    var bad = vers.filter(function (x) { var r = S31_COMPAT[x]; return !r || S31_SCHEMA < r[0] || S31_SCHEMA > r[1]; });
    R.push({ id: 'schema-compat', st: vers.length && !bad.length ? 'PASS' : 'FAIL', d: 'database schema ' + S31_SCHEMA + '; serving api ' + (vers.join(', ') || 'none') + (bad.length ? ' (does not support it)' : '') });
    var imgs = [];
    m.deployments.forEach(function (d) { if (!d.gone && /^beacon-/.test(d.name)) d.template.containers.forEach(function (c) { imgs.push(c.image); }); });
    var unpinned = imgs.filter(function (i) { return !s31Pinned(i); });
    R.push({ id: 'images-pinned', st: unpinned.length ? 'FAIL' : 'PASS', d: unpinned.length ? 'not mirror-by-digest: ' + unpinned.join(', ') : imgs.length + ' images from registry.lab by digest' });
    var deny = s.pols.some(function (p) { return p.name === 'default-deny-egress' && p.selector === null && !p.egress.length; });
    var broad = s.pols.some(function (p) { return p.egress.some(function (r) { return r.any; }); });
    var gOk = deny && !broad && s.admission.binding;
    R.push({ id: 'guardrails', st: gOk ? 'PASS' : 'FAIL', d: (deny ? 'default-deny-egress present' : 'default-deny-egress MISSING') + (broad ? ', an allow-all egress rule exists' : '') + ', admission binding ' + (s.admission.binding ? 'present' : 'MISSING') });
    var drift = !s31Matches(s, m, vals);
    R.push({ id: 'release-record', st: cur.status !== 'deployed' ? 'FAIL' : drift ? 'WARN' : 'PASS', d: 'helm revision ' + cur.rev + ' (' + cur.app + ') status ' + cur.status + (drift ? '; cluster differs from the release (manual change?)' : '') });
    return R;
  }
  function s31Matches(s, m, vals) {
    var r = s31Render(vals), api = s31Dep(m, 'beacon-api'), wd = s31Dep(m, 'beacon-worker'), cm = KM().find(m, 'configmaps', 'beacon-config', m.ns);
    if (!api || JSON.stringify(api.template) !== JSON.stringify(r.api)) return false;
    if (!!r.worker !== !!wd || (wd && JSON.stringify(wd.template) !== JSON.stringify(r.worker))) return false;
    return !!cm && JSON.stringify(cm.data) === JSON.stringify(r.config);
  }
  function s31Restored(s, m) {
    var R = s31Checks(s, m);
    return R.every(function (x) { return x.st === 'PASS' || x.st === 'SKIP'; });
  }
  /* readiness that follows the live NetworkPolicy set */
  function s31Profiles(s, m) {
    if (!m) return;
    var w = m.apps[S31_MIRROR + 'worker'], a = m.apps[S31_MIRROR + 'api'];
    if (w) w.readyPath = s31Egress(s, 'beacon-worker', 'beacon-db', 5432) ? '/ready' : '/ready#db-unreachable';
    if (a) a.readyPath = s31Egress(s, 'beacon-api', 'beacon-db', 5432) ? '/ready' : '/ready#db-unreachable';
  }
  function s31CreateDep(m, name, tpl) {
    m.deployments.push({ name: name, ns: m.ns, replicas: 1, selector: { app: name }, template: clone(tpl), created: m.clock,
      strategy: { maxSurge: 1, maxUnavailable: 0 }, progressDeadline: 600, revisionHistory: [], annotations: {}, rolloutStart: m.clock, conditions: {} });
  }
  function s31DeleteDep(m, d) {
    d.gone = true;
    m.deployments = m.deployments.filter(function (x) { return x !== d; });
    KM().rsFor(m, d).forEach(function (r) { KM().podsOf(m, r).forEach(function (p) { KM().removePod(m, p); }); r.replicas = 0; });
    m.replicasets = m.replicasets.filter(function (r) { return r.owner !== d.name; });
  }
  function s31Admit(s, imgs) {
    var f = imgs.filter(s31Floating);
    if (!f.length) return null;
    s.floatingTried = true;
    return 'ValidatingAdmissionPolicy \'restricted-images\' with binding \'restricted-images-beacon\' denied request: image "' + f[0] + '" is not pinned: images must name a version tag or a digest; floating tags such as "lat' + 'est" are not allowed';
  }
  /* apply a release's rendering to the cluster model (what helm install/upgrade/rollback does) */
  function s31Apply(s, m, vals, cause) {
    var r = s31Render(vals);
    if (s.admission.binding) {
      var deny = s31Admit(s, [vals.api.image].concat(r.worker ? [vals.worker.image] : []));
      if (deny) return deny;
    }
    var api = s31Dep(m, 'beacon-api');
    if (JSON.stringify(api.template) !== JSON.stringify(r.api)) KM().setTemplate(m, api, clone(r.api), cause);
    var wd = s31Dep(m, 'beacon-worker');
    if (r.worker && !wd) s31CreateDep(m, 'beacon-worker', r.worker);
    else if (r.worker && wd) { if (wd.replicas < 1) wd.replicas = 1; if (JSON.stringify(wd.template) !== JSON.stringify(r.worker)) KM().setTemplate(m, wd, clone(r.worker), cause); }
    else if (!r.worker && wd) s31DeleteDep(m, wd);
    var cm = KM().find(m, 'configmaps', 'beacon-config', m.ns);
    cm.data = clone(r.config);
    s.pols = s.pols.filter(function (p) { return !p.helm; }).concat(r.pols.map(function (p) { p.created = s.clock; return p; }));
    s31Profiles(s, m);
    KM().reconcile(m);
    return null;
  }
  function s31Healthy(s, m, vals) {
    var ok = KM().rolloutComplete(m, 'beacon-api', m.ns) && s31Ready(m, 'beacon-api') >= 2;
    if (vals.worker.enabled) ok = ok && KM().rolloutComplete(m, 'beacon-worker', m.ns) && s31Ready(m, 'beacon-worker') >= 1;
    return ok;
  }
  var S31_DATES = ['Mon Sep 14 10:02:11 2026', 'Tue Sep 29 09:40:03 2026', 'Mon Oct  5 11:15:47 2026', 'Tue Oct 13 08:50:12 2026'];
  function helmVerb(state) {
    var s = state;
    function revOf(n) { return s.rels.filter(function (r) { return r.rev === n; })[0]; }
    function cur() { return s.rels[s.rels.length - 1]; }
    function manifest(vals) {
      var r = s31Render(vals), out = ['---', '# Source: beacon/templates/configmap.yaml', 'apiVersion: v1', 'kind: ConfigMap', 'metadata:', '  name: beacon-config', 'data:'];
      Object.keys(r.config).forEach(function (k) { out.push('  ' + k + ': "' + r.config[k] + '"'); });
      [['beacon-api', r.api]].concat(r.worker ? [['beacon-worker', r.worker]] : []).forEach(function (pair) {
        var c = pair[1].containers[0];
        out.push('---', '# Source: beacon/templates/' + pair[0].replace('beacon-', '') + '-deployment.yaml', 'apiVersion: apps/v1', 'kind: Deployment', 'metadata:', '  name: ' + pair[0], 'spec:', '  template:', '    metadata:', '      annotations:', '        checksum/config: ' + pair[1].annotations['checksum/config'], '    spec:', '      containers:', '        - name: ' + c.name, '          image: ' + c.image);
        if (c.envFrom) out.push('          envFrom:', '            - configMapRef:', '                name: beacon-config');
        if (c.env) { out.push('          env:'); c.env.forEach(function (e) { out.push('            - name: ' + e.name, '              valueFrom:', '                configMapKeyRef:', '                  name: ' + e.configMapKey.name, '                  key: ' + e.configMapKey.key + (e.configMapKey.optional ? '\n                  optional: true' : '')); }); }
        out.push('          readinessProbe:', '            httpGet: { path: /ready, port: 8080 }');
      });
      r.pols.forEach(function (p) { out.push('---', '# Source: beacon/templates/networkpolicies.yaml', s31PolYaml(p)); });
      return out.join('\n');
    }
    function finish(rec, wait, verb, m) {
      if (wait) {
        var t = 0;
        while (t < 300 && !s31Healthy(s, m, rec.values)) { KM().advance(m, 10); s.clock += 10; t += 10; }
        if (!s31Healthy(s, m, rec.values)) { rec.status = 'failed'; rec.desc = (verb === 'rollback' ? 'Rollback' : 'Upgrade') + ' "beacon" failed: context deadline exceeded'; return res('', 1, 'Error: ' + (verb === 'rollback' ? 'release beacon failed' : 'UPGRADE FAILED') + ': context deadline exceeded (waited ' + t + ' s for resources to become ready)'); }
      }
      return null;
    }
    return function (w, a) {
      var m = w.k8sModel, p = SIM().flags(a, ['f', 'values', 'revision', 'n', 'namespace', 'timeout', 'set', 'o', 'output']), f = p.f, pos = p.pos;
      KM().advance(m, KM().PER_COMMAND);
      if (!pos.length || f.help) return res('helm (simulation): list · status beacon · history beacon · get values|manifest beacon [--revision N] · rollback beacon [REVISION] [--wait] · upgrade beacon ./chart -f VALUES [--wait] · template beacon ./chart -f VALUES');
      if (f.set) return res('', 1, 'helm --set is not supported in this simulation: edit a values file and pass it with -f (the file is the record of what was deployed).');
      var sub = pos[0];
      if (sub === 'version') return res('version.BuildInfo{Version:"v3.18.6", GitCommit:"(simulated)", GoVersion:"go1.24"}');
      if (sub === 'list' || sub === 'ls') { var c0 = cur(); return res(SIM().table(['NAME', 'NAMESPACE', 'REVISION', 'UPDATED', 'STATUS', 'CHART', 'APP VERSION'], [['beacon', 'beacon', c0.rev, c0.date, c0.status, c0.chart, c0.app]])); }
      if (sub === 'diff') return res('', 1, 'Error: unknown command "diff" for "helm" (the helm-diff plugin is not installed here). Compare `helm get values beacon --revision N` across revisions instead.');
      if (pos[1] && pos[1] !== 'beacon' && sub !== 'get') return res('', 1, 'Error: release: not found (this namespace has one release: beacon)');
      if (sub === 'status') { var c1 = cur(); return res('NAME: beacon\nLAST DEPLOYED: ' + c1.date + '\nNAMESPACE: beacon\nSTATUS: ' + c1.status + '\nREVISION: ' + c1.rev + '\nDESCRIPTION: ' + c1.desc + '\nCHART: ' + c1.chart + '  APP VERSION: ' + c1.app); }
      if (sub === 'history' || sub === 'hist') return res(SIM().table(['REVISION', 'UPDATED', 'STATUS', 'CHART', 'APP VERSION', 'DESCRIPTION'], s.rels.map(function (r) { return [r.rev, r.date, r.status, r.chart, r.app, r.desc]; })));
      if (sub === 'get') {
        if (pos[2] !== 'beacon') return res('', 1, 'Error: release: not found');
        var rec = f.revision ? revOf(parseInt(f.revision, 10)) : cur();
        if (!rec) return res('', 1, 'Error: release: not found (revision ' + f.revision + ')');
        if (pos[1] === 'values') return res('USER-SUPPLIED VALUES:\n' + s31ValuesYaml(rec.values).replace(/^# .*\n/, ''));
        if (pos[1] === 'manifest') return res(manifest(rec.values));
        return SIM().unsupported('helm get', pos[1] || '', ['values', 'manifest']);
      }
      if (sub === 'template' || sub === 'upgrade') {
        var chart = pos[2] || '';
        if (!/^(\.\/)?chart\/?$|^\/home\/lab\/beacon\/chart\/?$/.test(chart)) return res('', 1, 'Error: path "' + chart + '" not found (the chart is ./chart)');
        var vf = f.f || f.values;
        if (!vf || vf === true) return res('', 1, 'Error: this simulation needs the full values file: -f release/values-X.yaml');
        var text = SIM().readFile(w, vf);
        if (text == null) return res('', 1, 'Error: open ' + vf + ': no such file or directory');
        var vals;
        try { vals = s31ParseValues(text, '1.6.0'); } catch (e) { return res('', 1, 'Error: failed to parse ' + vf + ': ' + e.message); }
        if (sub === 'template') return res(manifest(vals));
        var deny = s31Apply(s, m, vals, 'helm upgrade');
        var rec2 = { rev: cur().rev + 1, date: SIM().stamp(s), status: 'deployed', chart: 'beacon-0.9.0', app: '1.6.0', desc: 'Upgrade complete', values: vals };
        if (deny) { rec2.status = 'failed'; rec2.desc = 'Upgrade "beacon" failed: admission denied'; s.rels.forEach(function (r) { if (r.status === 'deployed') r.status = 'superseded'; }); s.rels.push(rec2); return res('', 1, 'Error: UPGRADE FAILED: ' + deny); }
        s.rels.forEach(function (r) { if (r.status === 'deployed' || r.status === 'failed') r.status = 'superseded'; });
        s.rels.push(rec2);
        var e2 = finish(rec2, !!(f.wait || f.atomic), 'upgrade', m);
        if (e2) return e2;
        return res('Release "beacon" has been upgraded. Happy Helming!\nNAME: beacon\nLAST DEPLOYED: ' + rec2.date + '\nNAMESPACE: beacon\nSTATUS: deployed\nREVISION: ' + rec2.rev + (f.wait ? '' : '\n(simulation: without --wait, helm records "deployed" as soon as the objects are accepted; it does not check that pods became ready)'));
      }
      if (sub === 'rollback') {
        var to = pos[2] ? parseInt(pos[2], 10) : cur().rev - 1;
        var src = revOf(to);
        if (!src) return res('', 1, 'Error: release has no ' + pos[2] + ' version');
        var deny2 = s31Apply(s, m, src.values, 'helm rollback to ' + to);
        if (deny2) return res('', 1, 'Error: ' + deny2);
        s.rels.forEach(function (r) { if (r.status === 'deployed' || r.status === 'failed') r.status = 'superseded'; });
        var rec3 = { rev: cur().rev + 1, date: SIM().stamp(s), status: 'deployed', chart: src.chart, app: src.app, desc: 'Rollback to ' + to, values: clone(src.values) };
        s.rels.push(rec3);
        var e3 = finish(rec3, !!f.wait, 'rollback', m);
        if (e3) return e3;
        return res('Rollback was a success! Happy Helming!' + (f.wait ? '' : '\n(simulation: without --wait, helm does not wait for pods to become ready)'));
      }
      return SIM().unsupported('helm', sub, ['list', 'status', 'history', 'get values|manifest', 'rollback', 'upgrade', 'template']);
    };
  }
  function s31PolYaml(p) {
    var L = ['apiVersion: networking.k8s.io/v1', 'kind: NetworkPolicy', 'metadata:', '  name: ' + p.name, '  namespace: beacon'];
    if (p.helm) L.push('  labels:', '    app.kubernetes.io/managed-by: Helm');
    L.push('spec:', '  podSelector:' + (p.selector ? '\n    matchLabels:\n      app: ' + p.selector : ' {}'), '  policyTypes:', '    - Egress');
    if (!p.egress.length) { L.push('  egress: []'); return L.join('\n'); }
    L.push('  egress:');
    p.egress.forEach(function (r) {
      var first = true;
      function line(t) { L.push((first ? '    - ' : '      ') + t); first = false; }
      if (r.dns) { line('to:'); L.push('        - namespaceSelector:', '            matchLabels:', '              kubernetes.io/metadata.name: kube-system', '          podSelector:', '            matchLabels:', '              k8s-app: kube-dns'); }
      else if (r.toApp) { line('to:'); L.push('        - podSelector:', '            matchLabels:', '              app: ' + r.toApp); }
      if (r.ports.length) { line('ports:'); r.ports.forEach(function (pt) { L.push('        - protocol: ' + (pt === 53 ? 'UDP' : 'TCP'), '          port: ' + pt); if (pt === 53) L.push('        - protocol: TCP', '          port: 53'); }); }
      if (first) line('{}');
    });
    return L.join('\n');
  }
  function s31PolDescribe(s, p) {
    var L = ['Name:         ' + p.name, 'Namespace:    beacon', 'Created on:   ' + SIM().stamp({ clock: Math.max(0, (p.created || 0) - 1200) }), 'Labels:       ' + (p.helm ? 'app.kubernetes.io/managed-by=Helm' : '<none>'), 'Annotations:  ' + (p.helm ? 'meta.helm.sh/release-name: beacon' : '<none>'), 'Spec:',
      '  PodSelector:     ' + (p.selector ? 'app=' + p.selector : '<none> (Allowing the specific traffic to all pods in this namespace)'), '  Not affecting ingress traffic', '  Allowing egress traffic:'];
    if (!p.egress.length) L.push('    <none> (Selected pods are isolated for egress connectivity)');
    p.egress.forEach(function (r, i) {
      if (i) L.push('    ----------');
      r.ports.forEach(function (pt) { L.push('    To Port: ' + pt + '/' + (pt === 53 ? 'UDP' : 'TCP')); if (pt === 53) L.push('    To Port: 53/TCP'); });
      if (!r.ports.length) L.push('    To Port: <any> (traffic allowed to all ports)');
      L.push('    To:');
      L.push(r.any ? '      <any> (traffic not restricted by destination)' : r.dns ? '      NamespaceSelector: kubernetes.io/metadata.name=kube-system\n      PodSelector: k8s-app=kube-dns' : '      PodSelector: app=' + r.toApp);
    });
    L.push('  Policy Types: Egress');
    return L.join('\n');
  }
  function s31PolFromDoc(doc) {
    if (!doc || doc.kind !== 'NetworkPolicy') return null;
    if (doc.apiVersion !== 'networking.k8s.io/v1') throw new Error('NetworkPolicy must be apiVersion networking.k8s.io/v1');
    var sp = doc.spec || {}, ml = (sp.podSelector || {}).matchLabels || {};
    var rules = (sp.egress || []).map(function (r) {
      r = r || {};
      var to = r.to || [], ports = (r.ports || []).map(function (x) { return Number(x.port); }).filter(function (x) { return x > 0; });
      var dns = to.some(function (t) { return t && (t.namespaceSelector || ((t.podSelector || {}).matchLabels || {})['k8s-app'] === 'kube-dns'); });
      var app = null; to.forEach(function (t) { var l = ((t || {}).podSelector || {}).matchLabels || {}; if (l.app) app = l.app; });
      return { toApp: app, dns: dns && !app, any: !to.length, ports: ports };
    });
    return { name: (doc.metadata || {}).name, selector: ml.app || null, egress: rules, helm: false };
  }
  function s31Kubectl(state) {
    var s = state;
    var POLK = /^(networkpolicy|networkpolicies|netpol|networkpolicy\.networking\.k8s\.io)$/;
    var VAPK = /^(validatingadmissionpolicy|validatingadmissionpolicies|vap)$/, VAPBK = /^(validatingadmissionpolicybinding|validatingadmissionpolicybindings|vapb)$/;
    function base(w, a) { var k = LXShell.builtin('kubectl'); return k ? k(w, a) : res('', 1, 'kubectl: not available'); }
    function positional(a) { var out = [], V = ['-n', '--namespace', '-o', '--output', '-l', '--selector', '-c', '--container', '-f', '--filename', '-p', '--patch', '--type', '--field-selector', '--tail']; for (var i = 0; i < a.length; i++) { if (a[i] === '--') break; if (V.indexOf(a[i]) !== -1) { i++; continue; } if (a[i].charAt(0) === '-') continue; out.push(a[i]); } return out; }
    function oflag(a) { var i = a.indexOf('-o'); if (i === -1) i = a.indexOf('--output'); return i === -1 ? (a.filter(function (x) { return /^-o(yaml|json|wide)$|^--output=/.test(x); })[0] || '').replace(/^-o|^--output=/, '') : a[i + 1]; }
    return function (w, a) {
      var m = w.k8sModel, P = positional(a), verb = P[0], kind = (P[1] || '').split('/')[0], name = P[2] || ((P[1] || '').split('/')[1]);
      function tick() { KM().advance(m, KM().PER_COMMAND); }
      if ((verb === 'get' || verb === 'describe' || verb === 'delete') && POLK.test(kind)) {
        tick();
        var list = s.pols.filter(function (p) { return !name || p.name === name; });
        if (name && !list.length) return res('', 1, 'Error from server (NotFound): networkpolicies.networking.k8s.io "' + name + '" not found');
        if (verb === 'delete') { s.pols = s.pols.filter(function (p) { return p.name !== name; }); s31Profiles(s, m); return res('networkpolicy.networking.k8s.io "' + name + '" deleted'); }
        if (verb === 'describe') return res(list.map(function (p) { return s31PolDescribe(s, p); }).join('\n\n'));
        if (oflag(a) === 'yaml') return res(list.map(s31PolYaml).join('\n---\n'));
        return res(list.length ? SIM().table(['NAME', 'POD-SELECTOR', 'AGE'], list.map(function (p) { return [p.name, p.selector ? 'app=' + p.selector : '<none>', KM().age(Math.max(60, s.clock - (p.created || 0) + 600))]; })) : 'No resources found in beacon namespace.');
      }
      if ((verb === 'get' || verb === 'describe' || verb === 'delete') && (VAPK.test(kind) || VAPBK.test(kind))) {
        tick();
        var isB = VAPBK.test(kind), nm = isB ? 'restricted-images-beacon' : 'restricted-images', present = isB ? s.admission.binding : true;
        if (name && name !== nm) return res('', 1, 'Error from server (NotFound): ' + (isB ? 'validatingadmissionpolicybindings' : 'validatingadmissionpolicies') + '.admissionregistration.k8s.io "' + name + '" not found');
        if (verb === 'delete') {
          if (!isB) return res('', 1, 'Error from server (Forbidden): validatingadmissionpolicies.admissionregistration.k8s.io "restricted-images" is forbidden: platform-owned (cluster-scoped); you may only delete the namespace binding');
          if (!present) return res('', 1, 'Error from server (NotFound): validatingadmissionpolicybindings.admissionregistration.k8s.io "' + nm + '" not found');
          s.admission.binding = false; return res('validatingadmissionpolicybinding.admissionregistration.k8s.io "' + nm + '" deleted');
        }
        if (!present) return res('No resources found');
        if (verb === 'describe' || oflag(a) === 'yaml') return res(isB ? 'apiVersion: admissionregistration.k8s.io/v1\nkind: ValidatingAdmissionPolicyBinding\nmetadata:\n  name: restricted-images-beacon\nspec:\n  policyName: restricted-images\n  validationActions:\n    - Deny\n  matchResources:\n    namespaceSelector:\n      matchLabels:\n        kubernetes.io/metadata.name: beacon'
          : 'apiVersion: admissionregistration.k8s.io/v1\nkind: ValidatingAdmissionPolicy\nmetadata:\n  name: restricted-images\nspec:\n  failurePolicy: Fail\n  matchConstraints:\n    resourceRules:\n      - apiGroups: ["apps"]\n        apiVersions: ["v1"]\n        operations: ["CREATE", "UPDATE"]\n        resources: ["deployments"]\n  validations:\n    - expression: "object.spec.template.spec.containers.all(c, c.image.contains(\'@sha256:\') || (c.image.split(\'/\')[c.image.split(\'/\').size() - 1].contains(\':\') && !c.image.endsWith(\':lat' + 'est\')))"\n      message: images must name a version tag or a digest; floating tags are not allowed');
        return res(isB ? SIM().table(['NAME', 'POLICYNAME', 'PARAMREF', 'AGE'], [[nm, 'restricted-images', '<unset>', '41d']]) : SIM().table(['NAME', 'VALIDATIONS', 'PARAMKIND', 'AGE'], [[nm, '1', '<unset>', '41d']]));
      }
      if (verb === 'apply') {
        var fi = a.indexOf('-f') !== -1 ? a.indexOf('-f') : a.indexOf('--filename'), file = fi !== -1 ? a[fi + 1] : null, text = file ? SIM().readFile(w, file) : null;
        if (text != null && /kind:\s*NetworkPolicy/.test(text)) {
          tick();
          var doc, pol;
          try { doc = KM().parseYaml(text.split('\n').filter(function (l) { return !/^\s*#/.test(l); }).join('\n')); pol = s31PolFromDoc(doc); } catch (e) { return res('', 1, 'error: error validating "' + file + '": ' + e.message); }
          if (!pol || !pol.name) return res('', 1, 'error: error validating "' + file + '": metadata.name not set');
          var had = s.pols.some(function (p) { return p.name === pol.name; });
          s.pols = s.pols.filter(function (p) { return p.name !== pol.name; }).concat([Object.assign(pol, { created: s.clock })]);
          s31Profiles(s, m); KM().reconcile(m);
          return res('networkpolicy.networking.k8s.io/' + pol.name + (had ? ' configured' : ' created'));
        }
      }
      if (verb === 'set' && P[1] === 'image' && s.admission.binding) {
        var imgs = a.filter(function (x) { return x.indexOf('=') > 0 && x.charAt(0) !== '-'; }).map(function (x) { return x.slice(x.indexOf('=') + 1); });
        var den = s31Admit(s, imgs); if (den) { tick(); return res('', 1, 'error: failed to patch image update to pod template: deployments.apps "' + String(P[2] || P[1]).replace(/^.*\//, '') + '" is forbidden: ' + den); }
      }
      if (verb === 'patch' && s.admission.binding && /"image"\s*:/.test(a.join(' '))) {
        var ims = (a.join(' ').match(/"image"\s*:\s*"([^"]*)"/g) || []).map(function (x) { return x.replace(/^"image"\s*:\s*"|"$/g, ''); });
        var den2 = s31Admit(s, ims); if (den2) { tick(); return res('', 1, 'Error from server (Forbidden): ' + den2); }
      }
      if (verb === 'exec' && a.indexOf('--') !== -1) {
        var after = a.slice(a.indexOf('--') + 1);
        if (after[0] === 'psql') {
          tick();
          if (!/beacon-db/.test(P[1] || '')) return res('', 127, 'OCI runtime exec failed: exec: "psql": executable file not found in $PATH');
          var ci = after.indexOf('-c'), q = ci !== -1 ? String(after[ci + 1] || '') : '';
          if (!q) return res('', 2, 'psql (simulation): use -c "SQL"; interactive psql is not modelled');
          if (!/schema_migrations/i.test(q)) return res('', 1, 'psql (simulation): only queries on schema_migrations are modelled in this scenario (e.g. SELECT max(version) FROM schema_migrations;)');
          if (/max\s*\(\s*version\s*\)/i.test(q)) return res(' max \n-----\n  ' + S31_SCHEMA + '\n(1 row)');
          var rows = [[9, 'sensors_status_index', '2026-08-02 10:11'], [10, 'readings_partitioning', '2026-08-30 09:02'], [11, 'drop_legacy_status_column (contract)', '2026-09-29 09:40'], [12, 'add_worker_jobs_table (additive)', '2026-10-13 08:50']];
          return res(' version |                 name                 |    applied_at    \n---------+--------------------------------------+------------------\n' + rows.map(function (r) { return '      ' + (r[0] < 10 ? ' ' : '') + r[0] + ' | ' + SIM().pad(r[1], 36) + ' | ' + r[2]; }).join('\n') + '\n(' + rows.length + ' rows, versions 1–8 omitted)');
        }
      }
      var out = base(w, a);
      if (verb === 'describe' || verb === 'get' || verb === 'events') out = { out: String(out.out || '').replace(/Readiness probe failed: HTTP probe failed with statuscode: 404/g, 'Readiness probe failed: HTTP probe failed with statuscode: 503'), err: out.err, code: out.code };
      if ((verb === 'logs' || verb === 'log') && out.code === 0 && a.indexOf('--previous') === -1 && a.indexOf('-p') === -1 && /beacon-worker/.test(P[1] || '')) {
        var okDb = s31Egress(s, 'beacon-worker', 'beacon-db', 5432);
        var extra = okDb ? ['{"level":"info","msg":"connected to beacon-db:5432; consuming worker_jobs"}'] : ['{"level":"error","msg":"queue consumer: dial tcp 10.96.80.12:5432: i/o timeout (connect to beacon-db:5432 timed out after 5s); retrying"}', '{"level":"error","msg":"readiness: database unreachable"}'];
        out = { out: String(out.out || '') + extra.join('\n') + '\n', err: out.err, code: out.code };
      }
      return out;
    };
  }
  function s31World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
    var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], pols: [], admission: { binding: true }, audit: [], smokes: [], floatingTried: false, restoredAt: null };
    var vals = { '1.4.0': s31Values('1.4.0', v), '1.5.0': s31Values('1.5.0', v), '1.5.1': s31Values('1.5.1', v), '1.6.0': s31Values('1.6.0', v) };
    state.rels = ['1.4.0', '1.5.0', '1.5.1', '1.6.0'].map(function (ver, i) {
      return { rev: i + 1, date: S31_DATES[i], status: i < 3 ? 'superseded' : 'failed', chart: S31_CHART[ver], app: ver, desc: i === 0 ? 'Install complete' : i < 3 ? 'Upgrade complete' : 'Upgrade "beacon" failed: context deadline exceeded', values: vals[ver] };
    });
    var r3 = s31Render(vals['1.5.1']), r4 = s31Render(vals['1.6.0']);
    state.pols = r4.pols.map(function (p) { p.created = 0; return p; });
    var both = ['amd64', 'arm64'], reg = {};
    function put(name, ver) { var dg = s31Dg(name, ver); [S31_MIRROR + name + ':' + ver + '@' + dg, S31_MIRROR + name + '@' + dg, S31_MIRROR + name + ':' + ver].forEach(function (k) { reg[k] = { arch: both, digest: dg }; }); }
    ['1.4.0', '1.5.0', '1.5.1', '1.6.0'].forEach(function (ver) { put('api', ver); });
    put('worker', '1.6.0');
    reg[S31_PG] = { arch: both, digest: S31_PG.split('@')[1] }; reg[S31_TOOLBOX] = { arch: both, digest: S31_TOOLBOX.split('@')[1] };
    function apiProf(ver) { return { port: 8080, namedPort: 'http', readyPath: '/ready', livePath: '/healthz', startSec: 4, memMi: 70, boot: [], requiresEnv: ['BEACON_STORE_URL'], missingEnvLog: '{"level":"fatal","msg":"config: BEACON_STORE_URL is not set (expected from ConfigMap beacon-config); refusing to start","version":"' + ver + '"}',
      runLogs: ['{"level":"info","msg":"starting beacon-api","version":"' + ver + '"}', '{"level":"info","msg":"database schema version ' + S31_SCHEMA + ' (this build supports ' + S31_COMPAT[ver].join('–') + ')"}', 'beacon-api ' + ver + ' listening on 0.0.0.0:8080'],
      http: { '/healthz': 'ok', '/ready': '{"ready": true, "store": "postgres"}', '/version': '{"version": "' + ver + '", "environment": "restricted-lab"}' } }; }
    var apps = {};
    apps[S31_MIRROR + 'api'] = apiProf('1.6.0');
    ['1.4.0', '1.5.0', '1.5.1', '1.6.0'].forEach(function (ver) {
      var pf = apiProf(ver);
      if (S31_SCHEMA > S31_COMPAT[ver][1]) { pf.readyPath = '/ready#schema-too-new'; pf.runLogs = pf.runLogs.slice(0, 1).concat(['{"level":"error","msg":"database schema version ' + S31_SCHEMA + ' is newer than this build supports (max ' + S31_COMPAT[ver][1] + '); serving /healthz only"}']); }
      apps[s31Img('api', ver)] = pf;
    });
    apps[S31_MIRROR + 'worker'] = { port: 8080, namedPort: 'http', readyPath: v === 'c' ? '/ready#db-unreachable' : '/ready', livePath: '/healthz', startSec: 5, memMi: 60, boot: [], runLogs: ['{"level":"info","msg":"starting beacon-worker","version":"1.6.0"}'] };
    apps['registry.lab/mirror/library/postgres'] = { port: 5432, readyPath: '/', livePath: '/', startSec: 6, memMi: 180, boot: ['database system is ready to accept connections'] };
    apps['registry.lab/mirror/tools/toolbox'] = { port: 8080, readyPath: '/', livePath: '/', startSec: 1, memMi: 10, boot: ['toolbox: sleeping; use kubectl exec'] };
    var now = 1800, rel = now - 600;
    var k8s = { namespace: 'beacon', context: 'kind-looped-restricted', now: now, registry: reg, apps: apps, reachable: ['registry.lab'],
      nodes: [{ name: 'looped-restricted-control-plane', arch: 'arm64', role: 'control-plane', taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] }, { name: 'looped-restricted-worker', arch: 'arm64' }, { name: 'looped-restricted-worker2', arch: 'arm64' }],
      configmaps: [{ name: 'beacon-config', data: clone(r3.config) }],
      services: [{ name: 'beacon-api', selector: { app: 'beacon-api' }, clusterIP: '10.96.112.40', ports: [{ name: 'http', port: 80, targetPort: 'http' }] }, { name: 'beacon-db', selector: { app: 'beacon-db' }, clusterIP: '10.96.80.12', ports: [{ name: 'pg', port: 5432, targetPort: 5432 }] }],
      deployments: [
        { name: 'beacon-api', replicas: 2, selector: { app: 'beacon-api' }, changedAgo: 600, history: [r3.api, r4.api] },
        { name: 'beacon-worker', replicas: 0, selector: { app: 'beacon-worker' }, history: [r4.worker] },
        { name: 'beacon-db', replicas: 1, selector: { app: 'beacon-db' }, maxSurge: 0, maxUnavailable: 1, history: [{ labels: { app: 'beacon-db' }, containers: [{ name: 'postgres', image: S31_PG, ports: [{ name: 'pg', containerPort: 5432 }] }] }] },
        { name: 'beacon-client', replicas: 1, selector: { app: 'beacon-client' }, history: [{ labels: { app: 'beacon-client' }, containers: [{ name: 'client', image: S31_TOOLBOX }] }] }
      ],
      timeline: [{ at: rel, do: 'patch', kind: 'configmaps', obj: 'beacon-config', set: { data: clone(r4.config) } }, { at: rel, do: 'scale', name: 'beacon-worker', replicas: 1 }] };
    state.hooks.push(function (s, w) {
      var m = w && w.k8sModel; if (!m) return;
      s31Profiles(s, m);
      if (s.restoredAt == null && s31Restored(s, m)) s.restoredAt = s.clock;
    });
    var files = [
      { path: '/home/lab/beacon/RESTRICTED-ENV.md', content: '# looped-restricted: how this environment works\n- Nodes have no route to the internet. Images come from the internal mirror registry.lab/mirror/…, which syncs approved upstream images nightly; deploy them by digest.\n- The beacon namespace is default-deny for egress. Every dependency gets its own NetworkPolicy rule (rendered by the chart from values).\n- A platform admission rule (ValidatingAdmissionPolicy restricted-images, bound to this namespace) rejects floating image references. It is owned by the platform team; do not remove the binding.\n- Releases go through Helm (release `beacon`, chart in ./chart, values in ./release). A change made only with kubectl is drift: the next release overwrites it.\n- Every production change gets an audit-trail entry: `audit note "…"` (what you changed, why, and the evidence).\n- After any change run the smoke suite: `smoke` (checks in release/smoke.yaml).\n' },
      { path: '/home/lab/beacon/release/RELEASE-1.6.0.md', content: '# Beacon 1.6.0 (chart beacon-0.9.0)\n- New: beacon-worker Deployment (queue consumer for background jobs), with its own values block and NetworkPolicy switches.\n- Database: migration 0012 adds table worker_jobs (additive); run by the chart\'s pre-upgrade hook.\n- Chart: configuration keys tidied in values; worker image published by the vendor pipeline and mirrored nightly.\n- Pipeline #2291: `helm upgrade beacon ./chart -f release/values-1.6.0.yaml --wait --timeout 5m` at 08:50.\n' },
      { path: '/home/lab/beacon/release/COMPATIBILITY.md', content: '# Application / database schema compatibility\n| app   | schema supported | notes |\n|-------|------------------|-------|\n| 1.4.0 | 9–10  | |\n| 1.5.0 | 11    | 0011 dropped the legacy status column (contract step) |\n| 1.5.1 | 11–12 | reads and ignores worker_jobs (0012 is additive) |\n| 1.6.0 | 12    | |\nRolling back the application is safe only to a version whose range includes the current schema. Schema migrations are never rolled back automatically.\n' },
      { path: '/home/lab/beacon/release/smoke.yaml', content: '# checks run by `smoke` against the live namespace\nchecks:\n  - api-available     # beacon-api rollout complete, 2 ready\n  - api-version       # /version through the Service matches the release record\n  - worker-ready      # when the release has a worker\n  - worker-db-path    # worker may reach beacon-db:5432 under the NetworkPolicies\n  - schema-compat     # serving api supports the current schema\n  - images-pinned     # every beacon-* image is from registry.lab and pinned by digest\n  - guardrails        # default-deny egress, no allow-all rule, admission binding present\n  - release-record    # helm release deployed; cluster matches it (drift is a warning)\n' },
      { path: '/home/lab/beacon/release/values-1.6.0.yaml', content: s31ValuesYaml(vals['1.6.0']) },
      { path: '/home/lab/beacon/release/values-1.5.1.yaml', content: s31ValuesYaml(vals['1.5.1']) },
      { path: '/home/lab/beacon/chart/Chart.yaml', content: 'apiVersion: v2\nname: beacon\nversion: 0.9.0\nappVersion: "1.6.0"\ndescription: Beacon API and worker (course chart)\n' },
      { path: '/home/lab/beacon/release/pipeline-2291.log', content: '08:50:02 helm upgrade beacon ./chart -f release/values-1.6.0.yaml --wait --timeout 5m\n08:50:04 pre-upgrade hook beacon-migrate-1.6.0: applied migration 0012 add_worker_jobs_table\n08:55:12 Error: UPGRADE FAILED: context deadline exceeded\n08:55:12 pipeline #2291 FAILED (deploy stage)\n' }
    ];
    var verbs = {
      kubectl: s31Kubectl(state),
      helm: helmVerb(state),
      'lab-registry': function (w, a) { var r = LXShell.builtin('lab-registry'); return r ? r(w, a) : res('', 1, 'lab-registry: not available'); },
      audit: function (w, a) {
        KM().advance(w.k8sModel, KM().PER_COMMAND);
        if (a[0] === 'show' || !a.length) return res(state.audit.length ? state.audit.map(function (x, i) { return '#' + (i + 1) + ' ' + SIM().stamp({ clock: x.at }) + ' brett@corp.lab: ' + x.text; }).join('\n') : '(no audit entries yet)');
        if (a[0] !== 'note' || !a.slice(1).join(' ').trim()) return res('', 2, 'audit (simulation of the change log): audit note "TEXT" | audit show');
        var text = a.slice(1).join(' ');
        state.audit.push({ at: state.clock, text: text });
        return res('audit entry #' + state.audit.length + ' recorded at ' + SIM().stamp(state) + ' (append-only)');
      },
      smoke: function (w, a) {
        var m = w.k8sModel;
        KM().advance(m, KM().PER_COMMAND);
        var R = s31Checks(state, m), fail = R.filter(function (x) { return x.st === 'FAIL'; }).length, warn = R.filter(function (x) { return x.st === 'WARN'; }).length;
        state.smokes.push({ at: state.clock, pass: !fail });
        return res(R.map(function (x) { return SIM().pad(x.st, 5) + ' ' + SIM().pad(x.id, 15) + ' ' + x.d; }).join('\n') + '\n' + (fail ? 'smoke: FAILED (' + fail + ' failing check' + (fail === 1 ? '' : 's') + ')' : 'smoke: all checks passed' + (warn ? ' (' + warn + ' warning' + (warn === 1 ? '' : 's') + ')' : '')), fail ? 1 : 0);
      },
      curl: function () { return res('', 7, 'curl: this workstation is outside the cluster network and has no internet route (simulation). Test from inside: kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version'); },
      edit: SIM().verbs.edit(),
      sleep: sleepVerb(state, function (w, n) { KM().advance(w.k8sModel, n); })
    };
    verbs.k = verbs.kubectl;
    return { user: 'lab', host: 'looped-ops', cwd: '/home/lab/beacon', files: files, k8sModel: k8s, sre: state, extra: SIM().bind(state, verbs) };
  }
  var S31_CAUSE = { a: /mirror|registry\.beacon\.example|external registry|no such host|pull|egress to the internet|internet/i, b: /config ?map|BEACON_STORE_URL|BEACON_DB_DSN|renamed|config key/i, c: /network ?polic|egress rule|5432|beacon-db|database (path|access|egress)/i };
  var S31_ACTION = /roll(ed)? ?back|rollback|revision \d|helm upgrade|forward[- ]fix|values/i;
  function s31AuditOk(s) {
    return s.restoredAt != null && s.audit.some(function (x) { return x.at >= s.restoredAt && x.text.length >= 40 && S31_ACTION.test(x.text) && S31_CAUSE[s.variant].test(x.text); });
  }
  function s31WorkerPod(c) {
    var ps = M(c).pods.filter(function (p) { return !p.gone && (p.labels || {}).app === 'beacon-worker'; }).sort(function (x, y) { return y.created - x.created; });
    return ps.length ? ps[0].name : 'beacon-worker';
  }
  function s31Audit(v) {
    var cause = { a: 'the new worker image was referenced by tag from the external registry registry.beacon.example, which nodes cannot reach (no internet egress); it is in the mirror by digest', b: 'chart values renamed the ConfigMap key BEACON_STORE_URL to BEACON_DB_DSN while the api and worker still read BEACON_STORE_URL', c: 'the release added beacon-worker but no NetworkPolicy egress rule to beacon-db:5432 under default-deny' }[v];
    return 'audit note "REL-1.6.0: rolled back release beacon from revision 4 (1.6.0, failed) to revision 3 (1.5.1) as revision 5. Cause: ' + cause + '. Schema 12 (additive 0012) is supported by 1.5.1 per COMPATIBILITY.md. Smoke run follows; forward fix to be released as a new revision."';
  }

  LX.missions.push({
    id: 'sre-s31', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 30, kind: 'incident',
    title: 'Capstone: release 1.6.0 failed in the restricted cluster',
    brief: function () { return 'Pipeline #2291 released Beacon 1.6.0 (Helm release `beacon`, namespace beacon) to the restricted cluster looped-restricted at 08:50 and failed at its deadline. Read RESTRICTED-ENV.md first: this environment has rules you must keep. Independently diagnose what is wrong, restore a healthy release by a compatible rollback or a forward fix, record the change in the audit trail, and prove it with the smoke suite.'; },
    keys: ['cat RESTRICTED-ENV.md', 'helm status beacon', 'helm history beacon', 'kubectl get pods', 'kubectl get events --field-selector type=Warning', 'kubectl describe pod ', 'kubectl logs deploy/beacon-worker', 'kubectl get networkpolicy', 'helm get values beacon --revision 3', 'cat release/COMPATIBILITY.md', 'lab-registry list registry.lab/mirror/beacon/', 'audit note "…"', 'smoke'],
    world: s31World,
    objectives: [
      { id: 'state', stage: 'evidence', text: 'Establish what state the release and its workloads are in',
        hint: 'The pipeline only says "deadline exceeded". Which workload never became ready, and how is it failing?',
        hint2: '`helm status beacon`, then `kubectl get pods` — read the STATUS and READY columns of each Deployment\'s pods.',
        reveal: 'kubectl get pods',
        done: function (c) { var re = { a: /beacon-worker-\S+\s+0\/1\s+(ImagePullBackOff|ErrImagePull)/, b: /beacon-(worker|api)-\S+\s+0\/1\s+(CreateContainerConfigError|CrashLoopBackOff|Error)/, c: /beacon-worker-\S+\s+0\/1\s+Running/ }[st(c).variant]; return saw(c, /k(ubectl)?\b.*\bget\s+(po|pods?|all)\b/, re); } },
      { id: 'cause', stage: 'evidence', text: 'Find the evidence that names the cause, not just the symptom',
        hint: 'Each failure mode records its reason somewhere different: the pull, the container\'s configuration, or the app\'s own log about its dependencies.',
        hint2: '`kubectl describe pod POD` / `kubectl get events` for pull and config errors; `kubectl logs deploy/beacon-worker` and `kubectl get networkpolicy` for a dependency that cannot be reached.',
        reveal: function (c) { return st(c).variant === 'c' ? 'kubectl logs deploy/beacon-worker && kubectl get networkpolicy' : 'kubectl describe pod ' + s31WorkerPod(c); },
        done: function (c) {
          var v = st(c).variant;
          if (v === 'a') return saw(c, /k(ubectl)?\b.*\b(describe\s+(po|pods?)|get\s+(events?|ev)|events)\b/, /no such host/);
          if (v === 'b') return saw(c, /k(ubectl)?\b.*\b(describe\s+(po|pods?)|get\s+(events?|ev)|events)\b/, /couldn't find key BEACON_STORE_URL/) || saw(c, /k(ubectl)?\b.*\blogs?\b/, /BEACON_STORE_URL is not set/);
          return saw(c, /k(ubectl)?\b.*\blogs?\b.*beacon-worker/, /timed out/) && saw(c, /k(ubectl)?\b.*\b(get|describe)\s+(networkpolic(y|ies)|netpol)\b/, /default-deny-egress/);
        } },
      { id: 'release', stage: 'evidence', text: 'Establish what earlier release would be compatible with the database as it is now',
        hint: 'A rollback returns the application, not the database. What did this release do to the schema, and which version tolerates it?',
        hint2: '`helm history beacon`; the current schema version (`kubectl exec deploy/beacon-db -- psql -U beacon -d beacon -c "SELECT max(version) FROM schema_migrations"`); and release/COMPATIBILITY.md.',
        reveal: 'helm history beacon && kubectl exec deploy/beacon-db -- psql -U beacon -d beacon -c "SELECT max(version) FROM schema_migrations" && cat release/COMPATIBILITY.md',
        done: function (c) { return saw(c, /helm\s+(history|hist)\s+beacon/, /1\.5\.1/) && saw(c, /k(ubectl)?\b.*\bexec\b.*psql/, /\b12\b/) && saw(c, /(cat|grep|head|sed)\b.*COMPATIBILITY\.md/, /1\.5\.1/); } },
      { id: 'restore', stage: 'fix', text: 'Restore a healthy, compatible release through the release tool, keeping every guardrail of this environment',
        hint: 'Two defensible paths: roll back to the newest revision that supports the current schema, or fix the one wrong value and release forward. Either way the release record must match the cluster.',
        hint2: '`helm rollback beacon REVISION --wait`, or edit release/values-1.6.0.yaml (`edit`/`sed -i`) and `helm upgrade beacon ./chart -f release/values-1.6.0.yaml --wait`.',
        reveal: 'helm rollback beacon 3 --wait',
        done: function (c) { return s31Restored(st(c), M(c)); } },
      { id: 'audit', stage: 'fix', text: 'Record the change in the audit trail: what you did, why, and the evidence',
        hint: 'An entry written after the change, that someone else could act on.',
        hint2: '`audit note "…"` naming the revision you went to (or the value you changed), the cause you found, and why it is compatible.',
        reveal: function (c) { return s31Audit(st(c).variant); },
        done: function (c) { return s31AuditOk(st(c)); } },
      { id: 'smoke', stage: 'verify', text: 'Run the smoke suite and show every check passing on the restored release',
        hint: 'The suite checks the user path, the worker, the schema, the images, the guardrails and the release record.',
        hint2: '`smoke`.',
        reveal: 'smoke',
        done: function (c) { return s31Restored(st(c), M(c)) && lastIs(c, /smoke\b/, /smoke: all checks passed/) && lastCode(c) === 0; } }
    ],
    sre: {
      scenarioId: 'S31', moduleId: 'M16', lab: 'L31', variants: ['a', 'b', 'c'],
      symptom: 'Release 1.6.0 timed out in the pipeline; part of the new release never becomes ready in the restricted cluster.',
      neutralTitle: 'Release 1.6.0 failed in the restricted environment',
      neutralBrief: 'The pipeline released Beacon 1.6.0 with Helm to the restricted cluster and failed at its deadline. Diagnose independently, restore a healthy release by a compatible rollback or a forward fix, keep the environment\'s guardrails, record the change in the audit trail and prove it with the smoke suite.',
      impact: 'Depending on the fault: background jobs not processed, or a rollout stuck with the previous api still serving. The release record says failed.',
      changes: 'Release 1.6.0: new worker Deployment, migration 0012, chart values reorganised.',
      spoilers: ['no such host', 'external registry', 'registry.beacon.example', 'BEACON_DB_DSN', 'renamed', 'NetworkPolicy', 'egress rule', 'workerDbEgress', 'digest'],
      tools: ['kubectl (get, describe, logs, events, exec, set, patch, apply -f, delete; plus networkpolicy and validatingadmissionpolicy[binding])', 'helm (list, status, history, get values|manifest, rollback, upgrade, template)', 'lab-registry (simulated registry client)', 'audit note|show', 'smoke', 'edit / sed -i on values files'],
      grammar: ['`helm status|history beacon`, `helm get values|manifest beacon [--revision N]`, `helm rollback beacon [N] [--wait]`, `helm upgrade beacon ./chart -f FILE [--wait]`, `helm template beacon ./chart -f FILE`',
        '`kubectl get|describe pods|deploy|rs|svc|events|cm|networkpolicy|validatingadmissionpolicy|validatingadmissionpolicybinding`, `kubectl logs deploy/NAME [--previous]`, `kubectl exec deploy/beacon-db -- psql -c "… schema_migrations …"`, `kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version`, `kubectl apply -f FILE` (NetworkPolicy, ConfigMap), `kubectl set image`, `kubectl patch`, `kubectl delete`',
        '`lab-registry list|inspect`, `audit note "TEXT"`, `audit show`, `smoke`, `edit FILE KEY VALUE`, `sed -i`, `sleep N`'],
      palette: ['cat RESTRICTED-ENV.md', 'cat release/RELEASE-1.6.0.md', 'helm status beacon', 'helm history beacon', 'kubectl get pods', 'kubectl get events --field-selector type=Warning', 'kubectl describe pod ', 'kubectl logs deploy/beacon-worker', 'kubectl get networkpolicy', 'helm get values beacon --revision 3', 'kubectl exec deploy/beacon-db -- psql -U beacon -d beacon -c "SELECT max(version) FROM schema_migrations"', 'cat release/COMPATIBILITY.md', 'lab-registry list registry.lab/mirror/beacon/', 'helm rollback beacon ', 'helm upgrade beacon ./chart -f release/values-1.6.0.yaml --wait', 'audit note "…"', 'smoke'],
      assumptions: ['The previous api release kept serving where it could (maxUnavailable 0).', 'Migration 0012 has been applied and is not rolled back; COMPATIBILITY.md is accurate.', 'The platform team owns the admission rule and the default-deny policy; you own the release.'],
      simplified: K8S_RESTRICTED_SIMPLIFIED,
      unsafe: [
        { label: 'removed the admission rule\'s binding', why: 'The admission rule is the platform\'s control against unpinned images; deleting its binding to get a release through disables a guardrail for everyone in the namespace and is not yours to remove.',
          test: function (c) { return !st(c).admission.binding; },
          demo: 'kubectl delete validatingadmissionpolicybinding restricted-images-beacon' },
        { label: 'disabled or broadened the egress policy', why: 'Deleting default-deny or adding an allow-all egress rule makes the symptom go away by giving every pod the network — including a route out if one ever exists. The fix is one rule for one dependency.',
          test: function (c) { var s = st(c); return !s.pols.some(function (p) { return p.name === 'default-deny-egress'; }) || s.pols.some(function (p) { return p.egress.some(function (r) { return r.any; }); }); },
          demo: 'kubectl delete networkpolicy default-deny-egress' },
        { label: 'tried a floating image tag', why: 'A floating tag (latest) is exactly what the restricted environment forbids: the image is not reproducible, not reviewable and cannot be rolled back by name. Use the mirror\'s digest.',
          test: function (c) { var s = st(c); if (s.floatingTried) return true; return M(c).deployments.some(function (d) { return !d.gone && d.template.containers.some(function (x) { return s31Floating(x.image); }); }); },
          demo: function () { return 'kubectl set image deploy/beacon-worker worker=registry.lab/mirror/beacon/worker:lat' + 'est'; } },
        { label: 'rolled back past the schema migration', why: 'Revisions 1–2 run application versions that do not support schema 12; rolling back to them risks errors or bad writes. A rollback must land on a version whose range includes the current schema.',
          test: function (c) { return M(c).deployments.some(function (d) { return d.name === 'beacon-api' && !d.gone && d.template.containers.some(function (x) { return /\/api:1\.(4\.0|5\.0)@/.test(x.image); }); }); },
          demo: 'helm rollback beacon 2' }
      ],
      alt: function (v) {
        var head = ['cat RESTRICTED-ENV.md', 'helm status beacon', 'kubectl get pods'];
        var rel = ['helm history beacon', 'kubectl exec deploy/beacon-db -- psql -U beacon -c "select * from schema_migrations"', 'grep 1.5.1 release/COMPATIBILITY.md'];
        if (v === 'a') return head.concat(['kubectl get events --field-selector type=Warning', 'lab-registry list registry.lab/mirror/beacon/worker'], rel, [
          'edit release/values-1.6.0.yaml worker.image ' + s31Img('worker', '1.6.0'), 'helm upgrade beacon ./chart -f release/values-1.6.0.yaml --wait',
          'audit note "REL-1.6.0 forward fix: helm upgrade to revision 5 with worker.image set to the mirror digest (registry.lab/mirror) instead of the external registry tag the nodes could not pull (no such host, no internet egress). api unchanged at 1.6.0."', 'smoke']);
        if (v === 'b') return head.concat([function (c) { return 'kubectl describe pod ' + s31WorkerPod(c); }], rel, [
          "sed -i 's/BEACON_DB_DSN:/BEACON_STORE_URL:/' release/values-1.6.0.yaml", 'helm upgrade beacon ./chart -f release/values-1.6.0.yaml --wait',
          'audit note "REL-1.6.0 forward fix: helm upgrade to revision 5 restoring the ConfigMap key BEACON_STORE_URL in values (it had been renamed to BEACON_DB_DSN; api and worker read BEACON_STORE_URL)."', 'smoke']);
        return head.concat(['kubectl logs deploy/beacon-worker', 'kubectl describe networkpolicy'], rel, [
          'edit release/values-1.6.0.yaml networkPolicy.workerDbEgress true', 'helm upgrade beacon ./chart -f release/values-1.6.0.yaml --wait',
          'audit note "REL-1.6.0 forward fix: helm upgrade to revision 5 enabling networkPolicy.workerDbEgress, which renders one NetworkPolicy egress rule beacon-worker -> beacon-db:5432 under the default-deny; nothing else opened."', 'smoke']);
      },
      mechanism: 'Release 1.6.0 added a worker, applied an additive migration (schema 12) and reorganised chart values; one seeded fault from earlier modules stopped it in an environment that has no internet route, a default-deny egress policy and an admission rule against floating tags. (a) The worker image was referenced by tag from the vendor registry; nodes cannot resolve it ("no such host"), so the pod sits in ImagePullBackOff — the image is in the mirror and must be referenced there by digest. (b) The values renamed ConfigMap key BEACON_STORE_URL to BEACON_DB_DSN while the templates still read BEACON_STORE_URL: the worker cannot be created (CreateContainerConfigError) and new api pods crash, so the api rollout is stuck with 1.5.1 still serving. (c) The worker came up but the chart rendered no egress rule from it to beacon-db:5432, so under default-deny its database connection times out and it never becomes ready. Two defensible recoveries: roll back to revision 3 (1.5.1), which COMPATIBILITY.md shows supports schema 12 (revisions 1–2 do not), or correct the one value and release forward through Helm so the record matches the cluster. Either way: keep the admission binding and default-deny, write an audit entry, and let the smoke suite — not "helm said deployed" — prove the result.',
      alternatives: [
        { h: 'Delete the stuck pods', out: 'The ReplicaSet recreates them with the same spec and the same failure.' },
        { h: 'Roll back to the last revision that "worked" (1)', out: 'Rejected: schema 12 is newer than 1.4.0 supports; COMPATIBILITY.md and the api log say so. The newest compatible revision is 3.' },
        { h: 'Fix it with kubectl and leave the release', out: 'Restores pods but leaves a failed release record and drift; the next pipeline run overwrites the fix. Put the fix through the release.' },
        { h: 'Loosen the guardrails', out: 'Rejected: removing default-deny, the admission binding or pinning hides the cause and breaks the environment\'s rules.' }
      ],
      clues: ['"helm upgrade … --wait" failing means a resource never became ready, not that Helm is broken.', 'The previous api still serving is why users may not notice — it is not evidence the release is fine.'],
      passRubric: ['Names the failing workload and the evidence for its cause (event, config error or log + policy)', 'Chooses rollback or forward fix and justifies compatibility with schema 12', 'Keeps admission binding, default-deny and digest pinning intact', 'Audit entry and a passing smoke run after the change'],
      prereqs: ['les-m16-02', 'les-m10-03', 'les-m09-05'], refs: ['T13', 'T05', 'T02', 'T01']
    }
  });
  /* ═══ S32 · Service restored but data is missing ════════════════════ */
  /* Time is absolute seconds from 2026-10-10T00:00:00Z; one reading every
     5 s, id = slot + 1, so N(t) = ids written before t. Instances hold id
     intervals. The incident (09:41:07) is a retention job that deleted
     readings older than 7 minutes; the primary was fenced at 09:44:30. */
  var P_DAY = 86400, P_TODAY = 3 * P_DAY;
  var P_I = P_TODAY + 9 * 3600 + 41 * 60 + 7, P_F = P_TODAY + 9 * 3600 + 44 * 60 + 30, P_START = P_TODAY + 10 * 3600 + 20 * 60;
  var P_WAL_START = 2 * P_DAY + 21 * 3600 + 2;
  function pN(t) { return Math.max(0, Math.ceil(t / 5)); }
  function pTime(id) { return (id - 1) * 5; }
  function pNow(s) { return P_START + (s.clock || 0); }
  function pHms(t) { var x = ((t % P_DAY) + P_DAY) % P_DAY; return SIM().hms(x); }
  function pStamp(t) { return '2026-10-' + (10 + Math.floor(t / P_DAY)) + 'T' + pHms(t) + 'Z'; }
  function pParse(str) {
    var m = /^2026-10-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?(Z|\+00(?::?00)?)?$/.exec(String(str || '').trim());
    if (!m) return null;
    var d = Number(m[1]) - 10;
    if (d < 0 || d > 3) return null;
    return d * P_DAY + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] || 0);
  }
  function ivNorm(list) {
    var s = list.filter(function (x) { return x[1] >= x[0]; }).map(function (x) { return [x[0], x[1]]; }).sort(function (a, b) { return a[0] - b[0]; }), out = [];
    s.forEach(function (x) { var l = out[out.length - 1]; if (l && x[0] <= l[1] + 1) l[1] = Math.max(l[1], x[1]); else out.push(x); });
    return out;
  }
  function ivAdd(list, lo, hi) { return lo > hi ? list : ivNorm(list.concat([[lo, hi]])); }
  function ivCut(list, lo, hi) {
    var out = [];
    list.forEach(function (x) { if (x[1] < lo || x[0] > hi) out.push(x); else { if (x[0] < lo) out.push([x[0], lo - 1]); if (x[1] > hi) out.push([hi + 1, x[1]]); } });
    return out;
  }
  function ivCount(list, lo, hi) { return list.reduce(function (a, x) { var l = Math.max(lo, x[0]), h = Math.min(hi, x[1]); return a + (h >= l ? h - l + 1 : 0); }, 0); }
  function ivClip(list, lo, hi) { return list.map(function (x) { return [Math.max(lo, x[0]), Math.min(hi, x[1])]; }).filter(function (x) { return x[1] >= x[0]; }); }
  function pMd5(list, day) { var lo = pN(day * P_DAY) + 1, hi = pN((day + 1) * P_DAY); var key = JSON.stringify(ivClip(list, lo, hi)); return hex('md5:' + day + ':' + key, 32); }
  function pFullMd5(day) { return pMd5([[pN(day * P_DAY) + 1, pN((day + 1) * P_DAY)]], day); }
  function pResidual(inst) { return inst ? pN(P_F) - ivCount(inst.rows, 1, pN(P_F)) : Infinity; }
  function pMinResidual(s) { return s.variant === 'b' ? pN(P_TODAY + 9 * 3600) - pN(s.walGap[0]) : 0; }
  function pWalReach(s, from) { if (s.walGap && from < s.walGap[0]) return s.walGap[0]; if (s.walGap && from < s.walGap[1]) return from; return P_F; }
  function pBackups(v) {
    function bk(id, start, end, size, ver, extra) { return Object.assign({ id: id, start: start, end: end, size: size, verified: ver }, extra || {}); }
    var list = [
      bk('bk-20261012-2100', 2 * P_DAY + 21 * 3600 + 2, 2 * P_DAY + 21 * 3600 + 250, '14.2 GB', 'ok'),
      bk('bk-20261013-0300', P_TODAY + 3 * 3600 + 1, P_TODAY + 3 * 3600 + 262, '14.4 GB', 'ok')
    ];
    list.push(v === 'a' ? bk('bk-20261013-0900', P_TODAY + 9 * 3600 + 3, P_TODAY + 9 * 3600 + 231, '9.8 GB', 'never', { truncated: true })
      : bk('bk-20261013-0900', P_TODAY + 9 * 3600 + 3, null, '6.1 GB', 'n/a', { failed: true }));
    return list;
  }
  /* restore a backup into a new instance, replaying WAL as PostgreSQL recovery would */
  function pRestore(s, b, opt) {
    if (b.failed) return { err: 'restore: backup ' + b.id + ' never completed (status FAILED); it cannot be restored' };
    var rows = b.truncated ? [[1, pN(2 * P_DAY + 13 * 3600 + 20 * 60)]] : [[1, pN(b.end)]];
    var stop, log = [];
    if (opt.immediate) { stop = b.end; log.push('LOG:  recovery_target = \'immediate\': stopping at the consistent point ' + pStamp(b.end)); }
    else {
      var reach = pWalReach(s, b.end);
      if (opt.target != null) {
        if (opt.target < b.end) return { err: 'FATAL:  requested recovery stop point is before consistent recovery point (backup ' + b.id + ' is consistent from ' + pStamp(b.end) + ')' };
        stop = opt.target + 1;
        if (stop > reach) return { err: 'LOG:  starting point-in-time recovery to ' + pStamp(opt.target) + '\nLOG:  redo starts at 0/4A000028\nLOG:  redo done at 0/4A3C0F10, last completed transaction was at log time ' + pStamp(reach - 1) + '\n' + (reach < P_F ? 'LOG:  could not restore file "000000010000004A0000003C" from archive: not found\n' : '') + 'FATAL:  recovery ended before configured recovery target was reached\nrestore: instance ' + opt.to + ' did not start; nothing was created' };
        log.push('LOG:  starting point-in-time recovery to ' + pStamp(opt.target));
        log.push('LOG:  redo starts at 0/4A000028');
        log.push('LOG:  recovery stopping before commit of transaction ' + (918000 + pN(stop) % 997) + ', time ' + pStamp(pTime(pN(stop) + 1)));
      } else {
        stop = reach;
        log.push('LOG:  no recovery target: replaying all archived WAL');
        log.push('LOG:  redo starts at 0/4A000028');
        if (reach < P_F) log.push('LOG:  could not restore file "000000010000004A0000003C" from archive: not found');
        log.push('LOG:  redo done at 0/4A3C0F10, last completed transaction was at log time ' + pStamp(reach - 1));
      }
    }
    rows = ivAdd(rows, pN(b.end) + 1, pN(Math.min(stop, P_I)));
    var deleted = false;
    if (stop > P_I) { rows = ivCut(rows, 1, pN(P_I - 420)); rows = ivAdd(rows, pN(P_I) + 1, pN(stop)); deleted = true; }
    log.push('LOG:  selected new timeline ID: 2');
    log.push('LOG:  database system is ready to accept connections (recovery_target_action = promote)');
    return { inst: { name: opt.to, from: b.id, target: opt.target, stop: stop, rows: rows, deleted: deleted, learner: true, horizon: stop, createdAt: s.clock }, log: log };
  }
  function pInstConsistent(s, inst) {
    if (!inst || !inst.learner || inst.deleted) return false;
    var b = s.backups.filter(function (x) { return x.id === inst.from; })[0];
    if (!b || b.truncated || b.failed) return false;
    if (ivCount(inst.rows, 1, pN(Math.min(inst.stop, P_F))) !== pN(Math.min(inst.stop, P_F))) return false;
    return s.variant === 'b' ? inst.stop === s.walGap[0] : inst.stop <= P_I && inst.stop >= P_I - 300;
  }
  function pServing(s) { return s.instances[s.service.db]; }
  function pRecovered(s) { var i = pServing(s); return !!i && i.learner && !i.deleted && s.consumer.running && pResidual(i) === pMinResidual(s); }
  var NOLOSS = /no (readings|rows|records|data)( (were|was|have been|has been))? lost|nothing (was |has been )?lost|zero (readings|rows|records)( lost)?|\b0 (readings|rows|records) (lost|missing)|without (any )?(data )?loss|no data loss|fully recovered/i;
  function pClaimsNoLoss(text) {
    var re = new RegExp(NOLOSS.source, 'ig'), m;
    while ((m = re.exec(text))) { if (!negatedBefore(text, m.index)) return true; }
    return false;
  }
  function pReview(s, text) {
    var inst = pServing(s), resid = pResidual(inst), t = String(text);
    var r = { src: !!inst && !!inst.from && t.indexOf(inst.from) !== -1, counts: /count/i.test(t) && /\d{3,}/.test(t), sums: /checksum|md5|sampl/i.test(t), claim: pClaimsNoLoss(t) };
    r.loss = resid === 0 ? r.claim : (t.indexOf(String(resid)) !== -1 && /lost|not recoverable|unrecoverable|cannot be recovered|missing/i.test(t) && /08:55/.test(t) && !r.claim);
    r.falseClaim = r.claim && resid !== 0;
    r.ok = r.src && r.counts && r.sums && r.loss && !r.falseClaim;
    return r;
  }
  function pQuery(s, inst, q) {
    var Q = String(q).replace(/\s+/g, ' ').trim(), low = Q.toLowerCase(), rows = inst.rows, cols, data;
    var days = [0, 1, 2, 3];
    function dayName(d) { return '2026-10-' + (10 + d); }
    if (/readings_daily_rollup/.test(low)) {
      var have = days.filter(function (d) { return d < 3 && (d + 1) * P_DAY + 600 < inst.horizon; });
      return { cols: ['day', 'row_count', 'id_md5'], rows: have.map(function (d) { return [dayName(d), 17280, pFullMd5(d)]; }) };
    }
    if (!/\bfrom readings\b/.test(low)) return { err: 'psql (simulation): this model answers queries on readings and readings_daily_rollup only.\nSupported: SELECT count(*) FROM readings [WHERE ts >= \'T1\' AND ts < \'T2\'] · SELECT date(ts), count(*) FROM readings GROUP BY 1 · SELECT date(ts), md5(string_agg(id::text, \',\' ORDER BY id)) FROM readings GROUP BY 1 · SELECT min(ts), max(ts) FROM readings · SELECT id, ts, sensor_id, value FROM readings WHERE id IN (…) · SELECT * FROM readings_daily_rollup' };
    var lo = 1, hi = Math.max(pN(pNow(s)), 1);
    var w1 = /ts\s*>=?\s*'([^']+)'/.exec(Q), w2 = /ts\s*<=?\s*'([^']+)'/.exec(Q);
    if (w1) { var a1 = pParse(w1[1].replace(/\+00$/, 'Z')); if (a1 == null) return { err: 'ERROR:  invalid input syntax for type timestamp: "' + w1[1] + '" (use 2026-10-13T09:41:00Z)' }; lo = pN(a1) + 1; }
    if (w2) { var a2 = pParse(w2[1].replace(/\+00$/, 'Z')); if (a2 == null) return { err: 'ERROR:  invalid input syntax for type timestamp: "' + w2[1] + '"' }; hi = pN(a2); }
    var inm = /where id (?:in \(([\d,\s]+)\)|= ?(\d+))/.exec(low);
    if (inm) {
      var ids = (inm[1] || inm[2]).split(',').map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x > 0; }).slice(0, 20);
      return { kind: 'sample', cols: ['id', 'ts', 'sensor_id', 'value'], rows: ids.filter(function (id) { return ivCount(rows, id, id) === 1; }).map(function (id) { return [id, pStamp(pTime(id)).replace('T', ' ').replace('Z', '+00'), 'sensor-' + (1 + id % 24), (18 + (SIM().fnv('v' + id) % 140) / 10).toFixed(1)]; }) };
    }
    if (/group by/.test(low) && /md5|checksum/.test(low)) return { kind: 'sum', cols: ['day', 'id_md5'], rows: days.filter(function (d) { return ivCount(rows, pN(d * P_DAY) + 1, pN((d + 1) * P_DAY)) > 0; }).map(function (d) { return [dayName(d), pMd5(rows, d)]; }) };
    if (/group by/.test(low) && /count\(\*\)/.test(low)) return { kind: 'count', cols: ['day', 'count'], rows: days.map(function (d) { return [dayName(d), ivCount(rows, Math.max(lo, pN(d * P_DAY) + 1), Math.min(hi, pN((d + 1) * P_DAY)))]; }).filter(function (r) { return r[1] > 0; }) };
    if (/count\(\*\)/.test(low)) return { kind: 'count', cols: ['count'], rows: [[ivCount(rows, lo, hi)]] };
    if (/max\(ts\)|min\(ts\)|max\(id\)/.test(low)) {
      var cl = ivClip(rows, lo, hi), mn = cl.length ? cl[0][0] : null, mx = cl.length ? cl[cl.length - 1][1] : null;
      return { cols: ['min', 'max'], rows: [[mn ? pStamp(pTime(mn)).replace('T', ' ').replace('Z', '+00') : '', mx ? pStamp(pTime(mx)).replace('T', ' ').replace('Z', '+00') : '']] };
    }
    return { err: 'psql (simulation): query not recognised. See `psql --help` for the supported shapes.' };
  }
  function pTable(cols, rows) {
    var w = cols.map(function (c, i) { return rows.reduce(function (a, r) { return Math.max(a, String(r[i]).length); }, c.length); });
    var head = ' ' + cols.map(function (c, i) { return SIM().pad(c, w[i]); }).join(' | '), sep = cols.map(function (c, i) { return new Array(w[i] + 3).join('-'); }).join('+');
    return head + '\n' + sep + '\n' + rows.map(function (r) { return ' ' + r.map(function (x, i) { var sx = String(x); return typeof x === 'number' ? new Array(w[i] - sx.length + 1).join(' ') + sx : SIM().pad(sx, w[i]); }).join(' | '); }).join('\n') + '\n(' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ')';
  }
  function s32World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
    var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], backups: pBackups(v), instances: {}, updates: [], val: {}, oldTouchedAt: null, validatedAt: null,
      walGap: v === 'b' ? [P_TODAY + 8 * 3600 + 55 * 60, P_TODAY + 9 * 3600 + 5 * 60] : null,
      retStart: v === 'b' ? P_TODAY + 9 * 3600 : P_TODAY + 4 * 3600 + 20 * 60,
      consumer: { running: false, offset: P_F, db: 'pg-r1' }, service: { db: 'pg-r1', since: P_TODAY + 10 * 3600 + 5 * 60 + 40 } };
    state.instances['pg-old'] = { name: 'pg-old', from: null, rows: [[pN(P_I - 420) + 1, pN(P_F)]], horizon: P_F, fenced: true, learner: false, deleted: true };
    var r1 = v === 'a' ? { name: 'pg-r1', from: 'bk-20261013-0900', target: null, stop: P_TODAY + 9 * 3600 + 231, rows: [[1, pN(2 * P_DAY + 13 * 3600 + 20 * 60)]], horizon: P_TODAY + 9 * 3600 + 231, learner: false }
      : { name: 'pg-r1', from: 'bk-20261013-0300', target: P_TODAY + 7 * 3600 + 40 * 60, stop: P_TODAY + 7 * 3600 + 40 * 60 + 1, rows: [[1, pN(P_TODAY + 7 * 3600 + 40 * 60 + 1)]], horizon: P_TODAY + 7 * 3600 + 40 * 60 + 1, learner: false };
    state.instances['pg-r1'] = r1;
    state.hooks.push(function (s) {
      if (s.consumer.running) { var t = s.instances[s.consumer.db]; if (t) t.rows = ivAdd(t.rows, pN(s.consumer.offset) + 1, pN(pNow(s))); s.consumer.offset = Math.max(s.consumer.offset, pNow(s)); }
    });
    function inst(name) { return state.instances[name === 'beacon-db' ? state.service.db : name]; }
    var verbs = {
      backup: function (w, a) {
        var sub = a[0], s = state;
        if (sub === 'list') return res(SIM().table(['ID', 'TYPE', 'STARTED', 'FINISHED', 'SIZE', 'VERIFIED'], s.backups.map(function (b) { return [b.id, 'full', pStamp(b.start), b.failed ? 'FAILED' : pStamp(b.end), b.size, b.failed ? '-' : b.verified === 'ok' ? 'ok' : b.verified === 'failed' ? 'FAILED' : 'never']; })) + 'Backups are physical base backups; point-in-time recovery replays the WAL archive from a backup\'s end (see `backup wal`).');
        if (sub === 'verify') {
          var b = s.backups.filter(function (x) { return x.id === a[1]; })[0];
          if (!b) return res('', 1, 'backup verify: no backup "' + (a[1] || '') + '" (see backup list)');
          if (b.failed) return res('', 1, 'backup ' + b.id + ' never completed (status FAILED: archive-push to the WAL volume failed); there is nothing to verify');
          if (b.truncated) { b.verified = 'failed'; return res('verifying ' + b.id + ' against its backup_manifest (pg_verifybackup-style)\n  "base/16384/24601": has size 402653184 on disk but size 1073741824 in the manifest\n  "base/16384/24601.1": is present in the manifest but not on disk\n  "base/16384/24601.2": is present in the manifest but not on disk\nRESULT: FAILED — 3 files truncated or missing (relation 24601 = public.readings). Do not restore from this backup.', 1); }
          b.verified = 'ok';
          return res('verifying ' + b.id + ' against its backup_manifest (pg_verifybackup-style)\n  2914 files checked, sizes and checksums match\n  WAL needed for consistency (' + pStamp(b.start) + ' – ' + pStamp(b.end) + ') present in the archive\nRESULT: ok');
        }
        if (sub === 'wal') {
          var L = ['WAL archive /archive/wal/beacon (archive_command on the old primary)', '  oldest segment: ' + pStamp(P_WAL_START) + ' (start of bk-20261012-2100)', '  newest segment: ' + pStamp(P_F) + ' (primary fenced)'];
          if (s.walGap) { L.push('  GAP: ' + pStamp(s.walGap[0]) + ' -> ' + pStamp(s.walGap[1]) + ' (segments 000000010000004A0000003C–000000010000004A00000041 were never archived: archive volume full)'); L.push('  point-in-time recovery from the 21:00 or 03:00 backup can reach at most ' + pStamp(s.walGap[0] - 1) + '; replay cannot continue past a missing segment'); }
          else { L.push('  gaps: none'); L.push('  point-in-time recovery possible from a backup\'s end up to ' + pStamp(P_F)); }
          return res(L.join('\n'));
        }
        return res('backup (simulation of a pgBackRest-style tool): backup list | backup verify ID | backup wal', sub ? 2 : 0);
      },
      restore: function (w, a) {
        var s = state;
        if (a[0] === 'history') return res('2026-10-13T10:03:12Z  oncall-1  restore --to pg-r1 --from ' + (v === 'a' ? 'bk-20261013-0900 --immediate      # "latest backup, fastest restore"' : 'bk-20261013-0300 --target-time 2026-10-13T07:40:00Z   # "just before the incident (09:40 local)"') + '\n2026-10-13T10:05:40Z  oncall-1  service cutover --db pg-r1' + Object.keys(s.instances).filter(function (k) { return s.instances[k].learner; }).map(function (k) { var i = s.instances[k]; return '\n' + pStamp(P_START + i.createdAt) + '  you       restore --to ' + k + ' --from ' + i.from + (i.target != null ? ' --target-time ' + pStamp(i.target) : ''); }).join(''));
        var p = SIM().flags(a, ['to', 'from', 'target-time']), f = p.f;
        if (!f.to || !f.from) return res('', 2, 'restore (simulation): restore --to NEW_INSTANCE --from BACKUP_ID [--target-time 2026-10-13T09:41:00Z | --immediate] [--force]\n       restore history');
        var b = s.backups.filter(function (x) { return x.id === f.from; })[0];
        if (!b) return res('', 1, 'restore: no backup "' + f.from + '"');
        if (s.instances[f.to] && !f.force) return res('', 1, 'restore: instance ' + f.to + ' already exists; restore into a NEW instance (or --force to overwrite it)');
        var tgt = null;
        if (f['target-time']) { tgt = pParse(f['target-time']); if (tgt == null) return res('', 2, 'restore: cannot parse --target-time "' + f['target-time'] + '" (use 2026-10-13T09:41:00Z, UTC)'); }
        var r = pRestore(s, b, { to: f.to, target: tgt, immediate: !!f.immediate });
        if (r.err) return res('', 1, r.err);
        if (f.to === 'pg-old' && s.oldTouchedAt == null) s.oldTouchedAt = s.clock;
        if (f.to === s.service.db) { s.consumer.running = false; }
        s.instances[f.to] = r.inst;
        return res('restore (simulation): base backup ' + b.id + (b.verified === 'ok' ? ' (verified)' : b.verified === 'failed' ? ' (VERIFICATION FAILED)' : ' (never verified)') + ' -> instance ' + f.to + '\n' + r.log.join('\n') + '\n' + f.to + ' is up; the service still points at ' + s.service.db + '.');
      },
      psql: function (w, a) {
        var p = SIM().flags(a, ['h', 'host', 'U', 'd', 'c', 'p']), f = p.f, host = f.h || f.host, q = f.c;
        if (f.help) return res('psql (simulation): psql -h INSTANCE|beacon-db [-U beacon] [-d beacon] -c "SQL"\nInstances: ' + Object.keys(state.instances).join(', ') + '; beacon-db is whatever the service uses.');
        if (!host) return res('', 2, 'psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory (give -h INSTANCE: ' + Object.keys(state.instances).join(', ') + ')');
        var it = inst(host);
        if (!it) return res('', 2, 'psql: error: could not translate host name "' + host + '" to address: Name or service not known');
        if (!q || q === true) return res('', 2, 'psql (simulation): interactive psql is not modelled; use -c "SQL"');
        var r = pQuery(state, it, q);
        if (r.err) return res('', 1, r.err);
        var name = host === 'beacon-db' ? state.service.db : host;
        if (r.kind) { state.val[name] = state.val[name] || {}; state.val[name][r.kind === 'sample' ? 'sum' : r.kind] = state.clock; }
        if (state.validatedAt == null && pRecovered(state) && state.val[state.service.db] && state.val[state.service.db].count != null && state.val[state.service.db].sum != null) state.validatedAt = state.clock;
        return res(pTable(r.cols, r.rows));
      },
      queue: function (w, a) {
        var s = state, sub = a[0];
        if (sub === 'status') {
          var now = pNow(s), L = ['topic readings-ingest (one message per reading, key = reading id; consumers upsert by id)', '  earliest retained message: ' + pStamp(s.retStart) + (v === 'b' ? '  (retention lowered to 80 min under disk pressure at 08:40)' : '  (retention 6 h)'), '  newest message:            ' + pStamp(now),
            'consumer group beacon-writer: ' + (s.consumer.running ? 'RUNNING into ' + s.consumer.db + ', lag 0' : 'PAUSED at ' + pStamp(s.consumer.offset) + ' (primary fenced); lag ' + (pN(now) - pN(s.consumer.offset)) + ' messages'), 'published per hour today (producer ledger):'];
          for (var h = 0; h * 3600 + P_TODAY < now; h++) { var hs = P_TODAY + h * 3600, he = Math.min(now, hs + 3600); L.push('  ' + (h < 10 ? '0' : '') + h + ':00  ' + (pN(he) - pN(hs)) + (he < hs + 3600 ? ' (hour in progress)' : '')); }
          return res(L.join('\n'));
        }
        if (sub === 'replay') {
          var p = SIM().flags(a.slice(1), ['from', 'to']), from = pParse(p.f.from), to = p.f.to;
          if (from == null || !to) return res('', 2, 'queue replay --from 2026-10-13T09:41:00Z --to INSTANCE');
          if (!s.instances[to] || to === 'pg-old') return res('', 1, 'queue replay: ' + (to === 'pg-old' ? 'pg-old is fenced read-only' : 'no instance ' + to));
          if (from < s.retStart) return res('', 1, 'queue replay: offset out of range: earliest retained message is ' + pStamp(s.retStart) + ' (asked for ' + pStamp(from) + ')');
          var t2 = s.instances[to], lo = pN(from) + 1, hi = pN(pNow(s)), before = ivCount(t2.rows, lo, hi);
          t2.rows = ivAdd(t2.rows, lo, hi);
          return res('replayed ' + (hi - lo + 1) + ' messages (' + pStamp(from) + ' -> ' + pStamp(pNow(s)) + ') into ' + to + ': ' + (hi - lo + 1 - before) + ' rows inserted, ' + before + ' already present (idempotent upsert by id)');
        }
        return res('queue (simulation): queue status | queue replay --from TIME --to INSTANCE', sub ? 2 : 0);
      },
      service: function (w, a) {
        var s = state;
        if (a[0] === 'status' || !a[0]) return res('beacon-api -> database ' + s.service.db + ' (reads); writes go to the queue; consumer ' + (s.consumer.running ? 'RUNNING into ' + s.consumer.db : 'PAUSED') + '\ninstances: ' + Object.keys(s.instances).map(function (k) { var i = s.instances[k]; return k + (i.fenced ? ' (old primary, fenced read-only — forensic copy)' : i.from ? ' (from ' + i.from + (i.target != null ? ' to ' + pStamp(i.target) : '') + ')' : ''); }).join(', '));
        if (a[0] === 'cutover') {
          var p = SIM().flags(a.slice(1), ['db']), db = p.f.db;
          if (!db || !s.instances[db]) return res('', 1, 'service cutover --db INSTANCE (one of: ' + Object.keys(s.instances).join(', ') + ')');
          if (db === 'pg-old') return res('', 1, 'service cutover: pg-old is fenced read-only (it is the damaged primary)');
          s.service.db = db; s.consumer.db = db; s.consumer.running = true;
          var t3 = s.instances[db], before = pN(pNow(s)) - pN(s.consumer.offset);
          t3.rows = ivAdd(t3.rows, pN(s.consumer.offset) + 1, pN(pNow(s))); s.consumer.offset = pNow(s);
          return res('beacon-api now reads from ' + db + '; consumer beacon-writer resumed into ' + db + ' from its committed offset (' + before + ' queued messages applied).');
        }
        return res('', 2, 'service (simulation): service status | service cutover --db INSTANCE');
      },
      instance: function (w, a) {
        var s = state;
        if (a[0] === 'list' || !a[0]) return verbs.service(w, ['status']);
        if (a[0] === 'drop') {
          var n = a[1];
          if (!s.instances[n]) return res('', 1, 'instance drop: no instance ' + (n || ''));
          if (n === s.service.db) return res('', 1, 'instance drop: ' + n + ' is serving; cut over first');
          if (n === 'pg-old' && s.oldTouchedAt == null) s.oldTouchedAt = s.clock;
          delete s.instances[n];
          return res('instance ' + n + ' dropped (data directory removed)');
        }
        return res('', 2, 'instance (simulation): instance list | instance drop NAME');
      },
      incident: function (w, a) {
        if (a[0] !== 'update' || !a.slice(1).join(' ').trim()) return res('', 2, 'incident (simulation): incident update "TEXT" — posts to #inc-beacon-data for stakeholders');
        var text = a.slice(1).join(' '), rv = pReview(state, text);
        state.updates.push({ at: state.clock, text: text, review: rv });
        return res('Posted update #' + state.updates.length + ' to #inc-beacon-data.\nIncident-commander checklist: restore source named ' + (rv.src ? 'yes' : 'NO') + ' · counts ' + (rv.counts ? 'yes' : 'NO') + ' · checksum/sample ' + (rv.sums ? 'yes' : 'NO') + ' · remaining loss stated and consistent with the data ' + (rv.loss ? 'yes' : 'NO'));
      },
      sleep: sleepVerb(state)
    };
    var incident = '# INC-2026-10-13 Beacon readings missing after restore\nAll times UTC.\n09:41:07  retention job `prune-readings` ran with interval \'7 minutes\' instead of \'7 days\' on the primary (one DELETE).\n09:44:30  primary fenced read-only (now pg-old); writers paused, the ingest queue buffers new readings.\n10:03     on-call restored a backup into pg-r1 and moved the service to it (see `restore history`).\n10:12     data team: "the dashboards are missing a lot of history".\n\nYour job: quantify what is missing, choose and carry out a defensible recovery, validate the restored contents, and post an honest update (`incident update "…"`).\nKeep pg-old: it is the forensic record of the incident.\n';
    return { user: 'lab', host: 'db-ops', cwd: '/home/lab/incident', files: [{ path: '/home/lab/incident/INCIDENT.md', content: incident }, { path: '/home/lab/incident/RUNBOOK-restore.md', content: '# Restore runbook (excerpt)\n1. Never restore over the damaged primary; restore into a new instance.\n2. Prefer a verified backup; verify one if it is not.\n3. Point-in-time recovery: pick a target time just before the damaging transaction; recovery replays WAL from the backup\'s end to the target.\n4. Fill the gap after the target from the ingest queue (idempotent upsert by id).\n5. Validate before declaring success: per-day counts against readings_daily_rollup and the producer ledger, and checksums or sampled rows.\n6. State the remaining loss in numbers.\n' }], sre: state, extra: SIM().bind(state, verbs) };
  }
  function s32Update(c) {
    var s = st(c);
    if (s.variant === 'a') return 'incident update "Recovery complete. The 09:00 backup that pg-r1 was restored from failed verification (readings file truncated), so we restored the verified bk-20261013-0300 into pg-r2 with point-in-time recovery to 2026-10-13T09:41:00Z, just before the 09:41:07 delete, replayed the ingest queue from 09:41:00 and moved the service to pg-r2. Validation: per-day counts match readings_daily_rollup (17280 per full day) and the producer ledger for today, and per-day md5 checksums match the rollup. No readings were lost. pg-old is kept as the forensic copy."';
    return 'incident update "Recovery complete with a known gap. pg-r1 had been restored to 07:40, two hours too early. The WAL archive has a gap from 08:55 to 09:05, so we restored the verified bk-20261013-0300 into pg-r2 to 2026-10-13T08:54:59Z, the latest reachable point, replayed the ingest queue from its earliest retained message at 09:00 and moved the service to pg-r2. Validation: per-day counts match readings_daily_rollup (17280 per full day) and the producer ledger, and per-day md5 checksums match for the full days. 60 readings between 08:55:00 and 08:59:55 are not recoverable from any source (WAL gap, queue retention, deleted on the primary). pg-old is kept as the forensic copy."';
  }
  var S32_COUNT_Q = 'psql -h pg-r2 -c "SELECT date(ts) AS day, count(*) FROM readings GROUP BY 1 ORDER BY 1"';
  var S32_MD5_Q = 'psql -h pg-r2 -c "SELECT date(ts) AS day, md5(string_agg(id::text, \',\' ORDER BY id)) FROM readings GROUP BY 1 ORDER BY 1"';

  LX.missions.push({
    id: 'sre-s32', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 30, kind: 'incident',
    title: 'Capstone: service restored, but readings are missing',
    brief: function () { return 'A bad maintenance job damaged the Beacon database this morning. On-call restored a backup into a new instance and the service is answering again, but the data team says a lot of readings are missing. INCIDENT.md has the timeline, RUNBOOK-restore.md the house rules. Quantify what is missing, make a defensible recovery, validate the restored contents with numbers, and post an honest update.'; },
    keys: ['cat INCIDENT.md', 'cat RUNBOOK-restore.md', 'service status', 'restore history', 'backup list', 'backup verify ', 'backup wal', 'queue status', 'psql -h pg-r1 -c "SELECT date(ts) AS day, count(*) FROM readings GROUP BY 1 ORDER BY 1"', 'psql -h pg-old -c "SELECT * FROM readings_daily_rollup ORDER BY day"', 'restore --to pg-r2 --from ', 'queue replay --from ', 'service cutover --db ', 'incident update "…"'],
    world: s32World,
    objectives: [
      { id: 'gap', stage: 'evidence', text: 'Quantify what the serving database is missing, against an independent record',
        hint: 'Counts mean nothing without something to compare them to. What else recorded how many readings there should be?',
        hint2: 'Per-day counts on pg-r1 (`psql -h pg-r1 -c "SELECT date(ts) AS day, count(*) FROM readings GROUP BY 1 ORDER BY 1"`) against `readings_daily_rollup` (on pg-old) or the producer ledger in `queue status`.',
        reveal: 'psql -h pg-r1 -c "SELECT date(ts) AS day, count(*) FROM readings GROUP BY 1 ORDER BY 1" && psql -h pg-old -c "SELECT * FROM readings_daily_rollup ORDER BY day"',
        done: function (c) { return saw(c, /psql\b.*-h\s*(pg-r1|beacon-db)\b/, /count|max/) && (saw(c, /psql\b.*readings_daily_rollup/, /17280/) || saw(c, /queue\s+status/, /published per hour/)); } },
      { id: 'cause', stage: 'evidence', text: 'Find out why the first restore came back short, and what the backups and WAL archive can still give you',
        hint: 'Two questions: what exactly did on-call restore, and what is trustworthy and reachable now?',
        hint2: '`restore history`, `backup list`, `backup verify ID` for anything unverified, and `backup wal` for the archive\'s coverage.',
        reveal: function (c) { return st(c).variant === 'a' ? 'backup list; backup verify bk-20261013-0900; backup wal' : 'restore history; backup list; backup wal'; },
        done: function (c) {
          var v = st(c).variant;
          if (!saw(c, /backup\s+wal/, /WAL archive/)) return false;
          return v === 'a' ? saw(c, /backup\s+verify\s+bk-20261013-0900/, /FAILED/) : saw(c, /restore\s+history/, /07:40:00/);
        } },
      { id: 'restore', stage: 'fix', text: 'Restore a verified backup into a NEW instance with point-in-time recovery to the right moment',
        hint: 'Trustworthy base, then replay to just before the damage — or as far as the archive can actually reach.',
        hint2: '`restore --to pg-r2 --from BACKUP --target-time 2026-10-13T…Z`; a target past the archive\'s reach fails, a target after the damaging transaction replays it.',
        reveal: function (c) { return st(c).variant === 'a' ? 'restore --to pg-r2 --from bk-20261013-0300 --target-time 2026-10-13T09:41:00Z' : 'restore --to pg-r2 --from bk-20261013-0300 --target-time 2026-10-13T08:54:59Z'; },
        done: function (c) { var s = st(c); return Object.keys(s.instances).some(function (k) { return pInstConsistent(s, s.instances[k]); }); } },
      { id: 'recover', stage: 'fix', text: 'Bring the restored instance up to date from the queue and move the service to it',
        hint: 'The queue holds what happened after your restore point, as far back as its retention allows.',
        hint2: '`queue status`, `queue replay --from TIME --to INSTANCE`, then `service cutover --db INSTANCE`.',
        reveal: function (c) { return st(c).variant === 'a' ? 'queue replay --from 2026-10-13T09:41:00Z --to pg-r2 && service cutover --db pg-r2' : 'queue replay --from 2026-10-13T09:00:00Z --to pg-r2 && service cutover --db pg-r2'; },
        done: function (c) { var s = st(c); return pRecovered(s) && pInstConsistent(s, pServing(s)); } },
      { id: 'validate', stage: 'verify', text: 'Validate the serving database\'s contents: counts AND checksums or sampled rows',
        hint: 'Counts catch missing rows; checksums or samples catch wrong ones. Compare both with the independent records.',
        hint2: 'Per-day `count(*)` and per-day `md5(string_agg(id::text, \',\' ORDER BY id))` on the new instance, against readings_daily_rollup; or sample ids.',
        reveal: S32_COUNT_Q + ' && ' + S32_MD5_Q,
        done: function (c) { var s = st(c); return pRecovered(s) && s.validatedAt != null; } },
      { id: 'update', stage: 'verify', text: 'Post an incident update that states what was recovered, how it was validated, and what (if anything) is still lost',
        hint: 'Name the source and the restore point, give the validation numbers, and state the remaining loss honestly — in rows and a time window, or "none" only if the numbers say so.',
        hint2: '`incident update "…"`.',
        reveal: function (c) { return s32Update(c); },
        done: function (c) { var s = st(c), u = s.updates[s.updates.length - 1]; return !!u && s.validatedAt != null && u.at >= s.validatedAt && u.review.ok && pRecovered(s); } }
    ],
    sre: {
      scenarioId: 'S32', moduleId: 'M16', lab: 'L32', variants: ['a', 'b'],
      symptom: 'After a restore the service answers, but large ranges of readings are missing.',
      neutralTitle: 'Service restored but data is missing',
      neutralBrief: 'After this morning\'s database incident on-call restored a backup and the service answers again, but the data team reports missing readings. Quantify what is missing, make a defensible recovery, validate the restored contents with numbers, and post an honest update.',
      impact: 'Dashboards and exports are missing hours to days of readings; customers see gaps.',
      changes: 'A retention job misconfiguration at 09:41; an emergency restore at 10:03.',
      spoilers: ['truncated', 'never verified', '07:40', 'too early', 'WAL gap', 'archive volume', '08:55', 'unverified'],
      tools: ['backup list|verify|wal', 'restore --to --from [--target-time|--immediate]', 'restore history', 'psql -h INSTANCE -c', 'queue status|replay', 'service status|cutover', 'instance list|drop', 'incident update'],
      grammar: ['`backup list`, `backup verify ID`, `backup wal`', '`restore --to NEW --from ID [--target-time 2026-10-13T09:41:00Z | --immediate] [--force]`, `restore history`', '`psql -h INSTANCE|beacon-db -c "SQL"` — count(*) [WHERE ts >= \'…\' AND ts < \'…\'], per-day count(*) / md5(string_agg(id::text, \',\' ORDER BY id)) GROUP BY 1, min/max(ts), id IN (…), readings_daily_rollup', '`queue status`, `queue replay --from TIME --to INSTANCE`', '`service status`, `service cutover --db INSTANCE`, `instance list|drop NAME`, `incident update "TEXT"`, `sleep N`'],
      palette: ['cat INCIDENT.md', 'service status', 'restore history', 'backup list', 'backup verify bk-20261013-0900', 'backup wal', 'queue status', 'psql -h pg-r1 -c "SELECT date(ts) AS day, count(*) FROM readings GROUP BY 1 ORDER BY 1"', 'psql -h pg-old -c "SELECT * FROM readings_daily_rollup ORDER BY day"', 'restore --to pg-r2 --from bk-20261013-0300 --target-time ', 'queue replay --from ', 'service cutover --db pg-r2', S32_MD5_Q, 'incident update "…"'],
      assumptions: ['One reading every 5 seconds since 2026-10-10; the producer ledger and readings_daily_rollup are independent, trustworthy records.', 'Readings are inserted with their id; replaying the queue is an idempotent upsert.', 'pg-old (the fenced primary) must be kept until the post-incident review.'],
      simplified: ['The database is modelled as the set of reading ids each instance holds; backups, WAL replay, the damaging DELETE, recovery targets and queue replay are operations on that set. Other tables and transactions are not modelled.', 'A truncated base backup is modelled as one that restores with the tail of the readings table missing; in real PostgreSQL truncation more often fails loudly at restore or first read — which is why verification belongs before the emergency.', 'Recovery follows PostgreSQL semantics in outline (stop before the first commit after the target; FATAL when the target is beyond the reachable WAL); log lines are abridged. psql understands only the query shapes in the grammar.', 'Each command advances the clock 10 seconds; new readings keep arriving in the queue.'],
      unsafe: [
        { label: 'destroyed the forensic original before validating', why: 'pg-old is the only record of what the damaging job did and holds rows written after it; overwriting or dropping it before the recovery is validated removes your fallback and the evidence for the review.',
          test: function (c) { var s = st(c); return s.oldTouchedAt != null && (s.validatedAt == null || s.oldTouchedAt < s.validatedAt); },
          demo: 'restore --to pg-old --from bk-20261013-0300 --force' },
        { label: 'declared no data lost while counts differ', why: 'Telling stakeholders nothing was lost while the serving database is short of the independent records is a false statement that stops everyone looking; the numbers decide what you may say.',
          test: function (c) { return st(c).updates.some(function (u) { return u.review.falseClaim; }); },
          demo: 'incident update "Service restored from backup, no data lost."' }
      ],
      alt: function (v) {
        if (v === 'a') return ['cat INCIDENT.md', 'service status', 'restore history', 'queue status', 'psql -h beacon-db -c "SELECT min(ts), max(ts) FROM readings"', 'backup list', 'backup verify bk-20261013-0900', 'backup verify bk-20261012-2100', 'backup wal',
          'restore --to pg-r3 --from bk-20261012-2100 --target-time 2026-10-13T09:40:30Z', 'queue replay --from 2026-10-13T09:00:00Z --to pg-r3',
          'psql -h pg-r3 -c "SELECT * FROM readings_daily_rollup ORDER BY day"', 'psql -h pg-r3 -c "SELECT date(ts) AS day, count(*) FROM readings GROUP BY 1 ORDER BY 1"', 'psql -h pg-r3 -c "SELECT id, ts, sensor_id, value FROM readings WHERE id IN (17280, 51840, 58810)"',
          'service cutover --db pg-r3', 'psql -h beacon-db -c "SELECT date(ts) AS day, count(*) FROM readings GROUP BY 1 ORDER BY 1"', 'psql -h beacon-db -c "SELECT id, ts, sensor_id, value FROM readings WHERE id IN (17280, 51840, 58810)"',
          'incident update "Recovered. pg-r1 came from bk-20261013-0900, which fails verification (readings relation truncated). New instance pg-r3: verified bk-20261012-2100 plus WAL to 2026-10-13T09:40:30Z, then the queue from 09:00, now serving. Per-day counts equal the rollup (17280 per day) and the ledger; sampled rows 17280, 51840 and 58810 are present with values. No readings were lost."'];
        return ['cat INCIDENT.md', 'queue status', 'psql -h pg-r1 -c "SELECT min(ts), max(ts) FROM readings"', 'restore history', 'backup wal', 'backup list',
          'restore --to pg-r2 --from bk-20261013-0300 --target-time 2026-10-13T09:41:00Z', 'restore --to pg-r2 --from bk-20261013-0300', 'queue replay --from 2026-10-13T09:00:00Z --to pg-r2', 'service cutover --db pg-r2',
          'psql -h beacon-db -c "SELECT count(*) FROM readings WHERE ts >= \'2026-10-13T08:00:00Z\' AND ts < \'2026-10-13T10:00:00Z\'"', 'psql -h beacon-db -c "SELECT date(ts) AS day, md5(string_agg(id::text, \',\' ORDER BY id)) FROM readings GROUP BY 1 ORDER BY 1"',
          'incident update "Update: pg-r1 was restored to 07:40, two hours early. pg-r2 now serves: verified bk-20261013-0300 replayed to the end of usable WAL (archive gap 08:55-09:05), plus the queue from 09:00. Count for 08:00-10:00 is 1380 of 1440 expected and md5 per full day matches readings_daily_rollup. 60 readings from 08:55:00 to 08:59:55 are lost: not in WAL, not in the queue, deleted on the primary."'];
      },
      mechanism: 'Two things decide what a restore can give back: a **trustworthy base** and **how far you can replay**. (a) On-call restored the newest backup, 09:00, which had never been verified: its readings file is truncated (9.8 GB against 14.4 GB; `backup verify` fails), so pg-r1 lacks everything after yesterday 13:20 — and the queue only retains 6 h, so it cannot fill that hole. The defensible recovery restores a verified backup (03:00 or 21:00) into a NEW instance, replays WAL to just before the 09:41:07 DELETE (a target at or after it would replay the damage), fills 09:41→now from the queue (idempotent by id), validates per-day counts and checksums against readings_daily_rollup and the producer ledger, then cuts over. Remaining loss: none, and the numbers show it. (b) On-call restored the verified 03:00 backup but to 07:40 — a local/UTC slip — so pg-r1 lacks 07:40→now. A target of 09:41 now fails ("recovery ended before configured recovery target was reached") because the WAL archive has a gap from 08:55 to 09:05; the latest reachable point is 08:54:59. Replay the queue from its earliest message (09:00, retention was lowered), cut over, validate — and state the residual honestly: 60 readings from 08:55:00 to 08:59:55 are unrecoverable from any source. In both variants pg-old is kept for the review.',
      alternatives: [
        { h: 'Replay the queue into pg-r1 and stop there', out: 'Rejected: the queue does not reach back far enough (6 h in a, 80 min in b); pg-r1 would keep a hole of hours.' },
        { h: 'Restore with no target time', out: 'In (a) that replays the 09:41:07 DELETE and loses almost all history; in (b) it stops at the WAL gap, which happens to be the best reachable point.' },
        { h: 'Restore over pg-old to save space', out: 'Rejected: destroys the forensic record and the rows written after the incident.' },
        { h: 'Declare success when the service answers', out: 'Rejected: availability is not correctness; the counts are the evidence.' }
      ],
      clues: ['A backup that has never been verified is a hypothesis, not a backup.', 'Size is a cheap first check: a full backup much smaller than its neighbours deserves suspicion.', 'Timestamps in UTC everywhere; the runbook and logs are UTC.'],
      passRubric: ['Quantifies the loss on the first restore against an independent record', 'Explains why (truncated unverified backup, or a too-early target) and what the archive and queue can still reach', 'Restores into a new instance from a verified base to a defensible target, fills from the queue, keeps pg-old', 'Validates with counts AND checksums/samples and states the remaining loss in numbers'],
      prereqs: ['les-m12-03', 'les-m12-04', 'les-m16-02'], refs: ['T09', 'T01']
    }
  });
})();
