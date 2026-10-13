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
})();
