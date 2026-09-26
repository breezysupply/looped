/* Onsite track — configuration, identity and storage questions (topic: config).
   Records are ordered foundations first (level 1, then 2, then 3), so ids are not in numeric order. */
window.LX = window.LX || {};
LX.onsiteQ = LX.onsiteQ || [];
LX.onsiteQ.push(

/* ── 02 ServiceAccounts vs RBAC vs cloud IAM ─────────────────── */
{ id: 'ons-q-config-02', track: 'onsite', topic: 'config', priority: 'P1', level: 1, mins: 4,
  prereqs: ['les-identity'],
  labs: ['ons-lab-09'],
  q: 'How do service accounts, Kubernetes RBAC and cloud IAM differ?',
  context: 'A workload needs to read ConfigMaps in its namespace and write objects to a cloud storage bucket. The interviewer wants to know which layer controls which access.',
  evaluates: [
    'A ServiceAccount is an identity, not a permission set',
    'RBAC authorizes calls to the Kubernetes API only, and is additive (no deny)',
    'Cloud IAM authorizes cloud API calls and needs a federation link to a ServiceAccount',
    'The three layers do not imply each other',
    'Can map these to AWS concepts and say where the mapping breaks'
  ],
  spoken: 'They answer three different questions.\n\nA ServiceAccount is who the pod is. It is a namespaced Kubernetes identity. The kubelet mounts a short-lived, audience-bound token for it, and the pod presents that token to prove its identity. On its own it grants almost nothing.\n\nRBAC decides what that identity may do against the Kubernetes API. A Role or ClusterRole lists verbs on resources, and a RoleBinding or ClusterRoleBinding grants it to subjects such as a ServiceAccount. RBAC has only allow rules, so you fix an over-grant by removing a binding, not by adding a deny. It has no say over anything outside the Kubernetes API.\n\nCloud IAM decides what may be done against the cloud provider\'s APIs, like the bucket. To connect them you use workload identity federation: the cloud trusts the cluster\'s token issuer, and a cloud role\'s trust policy says "the token for ServiceAccount shop/uploader may assume this role". On AWS that is, for example, IRSA or EKS Pod Identity.\n\nSo in this case: RBAC grants the ConfigMap reads, and a federated cloud role grants the bucket writes. Neither implies the other.',
  deep: '**Identity: ServiceAccounts.** Every pod runs as a ServiceAccount (`default` if unspecified) in its namespace. Current Kubernetes versions give pods a projected, time-limited token bound to the pod and to an audience, obtained through the TokenRequest API and rotated by the kubelet. The legacy long-lived Secret-based tokens are no longer created automatically. The token\'s subject is `system:serviceaccount:<namespace>:<name>`. The API server authenticates it. Anything else (a cloud STS, a vault) can verify it through the cluster\'s OIDC discovery document and public keys.\n\n**Kubernetes authorization: RBAC.** After authentication, the API server asks its authorizers whether this user or group may perform a given verb on a given resource, namespace and name. With RBAC, `Role` (namespaced) and `ClusterRole` (cluster-wide or reusable) define rules, and `RoleBinding`/`ClusterRoleBinding` attach them to users, groups or ServiceAccounts. Rules only add permissions, there are no deny rules, and permissions from all bindings are unioned. A RoleBinding can reference a ClusterRole to grant it only inside one namespace. RBAC says nothing about network access, cloud APIs or what the process can do on the node.\n\n**Cloud authorization: IAM.** The cloud provider has its own principals and policies. To avoid long-lived keys, the cloud is configured to trust the cluster\'s ServiceAccount token issuer (OIDC federation) or a platform agent, and a cloud role is mapped to a specific namespace/ServiceAccount through trust-policy conditions on `sub` and `aud`. The pod exchanges its projected token for short-lived cloud credentials. Details differ by provider. On AWS, IRSA and EKS Pod Identity are examples of this pattern.\n\n**Why the separation matters.** Granting `cluster-admin` does not let a pod write to a bucket. Granting a cloud role does not let it list pods. Namespaces scope RBAC, but they do not isolate network traffic (that is NetworkPolicy, if the CNI enforces it). Also, anyone who can create pods in a namespace can run them as any ServiceAccount in that namespace, and so borrow its RBAC and cloud permissions. That makes pod-creation rights part of your identity boundary.',
  followups: [
    { q: 'A developer has `edit` in namespace shop. Can they get the cloud permissions of the `uploader` ServiceAccount?',
      guidance: 'Yes, effectively. Being able to create pods or Deployments in that namespace lets them run a pod as `uploader` and receive its tokens and so its federated cloud role. Controls include separate namespaces for sensitive identities, admission policy restricting serviceAccountName, and tight trust-policy conditions.' },
    { q: 'How would you express "everyone except X may read Secrets" in RBAC?',
      guidance: 'You cannot express deny in RBAC. Grant read only to the explicit subjects that need it, and review aggregated or broad ClusterRoles. If you truly need deny semantics, use an additional authorizer or admission policy, which is a platform decision.' },
    { q: 'Where would you look to see what a ServiceAccount can actually do, across both layers?',
      guidance: 'Kubernetes: `kubectl auth can-i --list --as=system:serviceaccount:ns:sa` and the bindings that reference it. Cloud: the role mapped to it, the role\'s trust policy conditions and attached policies, and the cloud\'s policy simulator or access analysis tooling where available.' }
  ],
  misconceptions: [
    '"A ServiceAccount has permissions." It is an identity. RBAC bindings and cloud role mappings grant permissions to it.',
    '"cluster-admin can do anything, including cloud calls." RBAC covers only the Kubernetes API.',
    '"RBAC can deny." It is additive only. Remove the grant instead.',
    '"Kubernetes RBAC and IAM work the same way." IAM has explicit deny, conditions and resource ARNs. RBAC has verbs, resources, optional resourceNames, and no deny.'
  ],
  weak: [
    'Blurs identity and authorization',
    'Suggests mounting static cloud access keys as a Secret as the normal approach',
    'Cannot say how a pod gets cloud credentials',
    'Ignores the "pod creation implies ServiceAccount use" risk'
  ],
  evidence: '# example output\n$ kubectl get pod uploader-5d8f7-lq2vx -n shop -o jsonpath=\'{.spec.serviceAccountName}{"\\n"}\'\nuploader\n\n$ kubectl auth can-i --list -n shop --as=system:serviceaccount:shop:uploader | head -4\nResources                                       Non-Resource URLs   Resource Names   Verbs\nselfsubjectreviews.authentication.k8s.io        []                  []               [create]\nconfigmaps                                      []                  []               [get list watch]\n\n$ kubectl get rolebindings -n shop -o wide | grep uploader\nuploader-config-read   Role/config-reader   41d   shop/uploader\n\n# token claims (payload decoded) that a cloud trust policy would match on\n{\n  "aud": ["sts.example.com"],\n  "iss": "https://oidc.cluster.example.internal",\n  "sub": "system:serviceaccount:shop:uploader",\n  "exp": 1790436000\n}',
  rubric: {
    strong: [
      'ServiceAccount = identity with projected, audience-bound tokens',
      'RBAC = Kubernetes API authorization, additive, Role/ClusterRole + bindings',
      'Cloud IAM = cloud API authorization linked by OIDC federation or a platform agent',
      'States the layers are independent and gives an example',
      'Notes the pod-creation-implies-identity risk'
    ],
    acceptable: [
      'Describes federation in terms of one provider, clearly labelled as an example',
      'Mentions other authorizers (Node, webhook) alongside RBAC'
    ],
    redFlags: [
      'Claims RBAC grants cloud access or IAM grants Kubernetes access',
      'Recommends static cloud keys in Secrets as standard practice',
      'Claims RBAC supports deny rules'
    ]
  },
  aws: { analogy: 'An ECS task role (identity plus IAM permissions in one) compared with a ServiceAccount plus RBAC plus a federated IAM role.',
    breaks: 'An ECS task role is an IAM role, so identity and cloud authorization are one object. In Kubernetes the ServiceAccount is a cluster identity, RBAC controls only the Kubernetes API, and cloud access needs a separate federation mapping. IAM supports explicit deny and conditions. RBAC is allow-only.' },
  refs: [
    { t: 'Service Accounts', u: 'https://kubernetes.io/docs/concepts/security/service-accounts/' },
    { t: 'Using RBAC Authorization', u: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/' },
    { t: 'Configure Service Accounts for Pods', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/' }
  ],
  verify: 'Legacy Secret-based ServiceAccount tokens stopped being auto-created in recent versions (around v1.24+); confirm the cluster version.'
},

/* ── 03 Are Secrets secure? ──────────────────────────────────── */
{ id: 'ons-q-config-03', track: 'onsite', topic: 'config', priority: 'P1', level: 1, mins: 4,
  prereqs: ['les-config', 'les-identity'],
  labs: [],
  q: 'Are Kubernetes Secrets secure? What would you change?',
  context: 'A team stores database passwords in Secrets and injects them as environment variables. They ask whether that is "secure enough" and what to improve.',
  evaluates: [
    'Knows base64 is encoding, not encryption',
    'Knows encryption at rest in etcd must be configured on the API server',
    'Understands RBAC exposure: list/watch and pod creation reveal Secrets',
    'Compares env vars and mounted files accurately',
    'Proposes layered improvements, including external secret stores'
  ],
  spoken: 'By default, Secrets are only as secure as your cluster configuration. The base64 in a Secret is encoding, not encryption. Anyone who can read the object can decode it in one command.\n\nThere are three layers to check. First, at rest: Secrets live in etcd, and they are encrypted there only if the API server has an encryption configuration, ideally backed by a KMS. Existing Secrets must be rewritten after you enable it. Second, access: RBAC get, list or watch on Secrets in a namespace exposes their contents, and anyone who can create pods there can mount any Secret in it. So I would audit who holds those rights. Third, use: environment variables are easy but never update, are visible to anyone who can exec into the container, and are often dumped by crash reporters or debug endpoints. Mounted files update in place and are easier to control.\n\nWhat I would change: turn on encryption at rest, tighten RBAC, prefer mounted files, and enable audit logging for Secret reads. Where the platform supports it, use an external secret manager through a CSI driver or a sync controller, with short-lived credentials. And never put secrets in images, ConfigMaps or plain Git.',
  deep: '**What a Secret is.** A Secret is an API object with `data` values base64-encoded so that binary data survives JSON/YAML. `kubectl get secret x -o jsonpath=\'{.data.password}\' | base64 -d` prints the value. The protections that matter are elsewhere.\n\n**At rest.** The API server stores objects in etcd. Unless an `EncryptionConfiguration` is set for `secrets` (providers such as `aescbc`, `aesgcm`, `secretbox`, or `kms` v2 with an external key service), Secret data sits unencrypted in etcd and in etcd backups. Enabling encryption applies to newly written objects, so existing Secrets must be rewritten. On self-managed control planes you can confirm with `etcdctl get` that the stored value starts with a prefix like `k8s:enc:aescbc:v1:`. On managed control planes you check the provider\'s setting.\n\n**Access.** Anyone with `get` on a Secret can read it. `list` and `watch` also return full contents, so "list only" is not a safe grant. Anyone who can create a pod, or a Deployment, Job and so on, in a namespace can mount any Secret in that namespace and read it from inside. Audit logging at the Metadata level for Secrets shows who read what without logging the values. The Node authorizer limits kubelets to Secrets for pods on their own node.\n\n**Consumption.** Secrets exposed as environment variables are fixed at container start and never update. They are visible to anything that can exec into the container or read its process environment on the node, and they are frequently leaked by crash dumps, `/env` debug endpoints or logs of the full environment. `kubectl describe pod` shows the reference (`secretKeyRef`), not the value, but an env entry written as a literal `value:` in the manifest puts the secret into the pod spec, and so into rollout history and Git. Mounted Secret volumes are tmpfs-backed files that are updated in place eventually (not for `subPath` mounts). The application must re-read them.\n\n**Improvements.** Encryption at rest with KMS. Least-privilege RBAC, with no broad list/watch on secrets and a review of who can create pods. Audit logging. Mounted files instead of env. Immutable Secrets where rotation happens by name. An external store (for example a cloud secrets manager or a vault) accessed through a secrets-store CSI driver or a sync controller. Note that syncing into a Secret object puts the value back in etcd, while CSI mounts can avoid that, depending on configuration. Prefer short-lived, workload-identity-based credentials over static passwords altogether. Keep secrets out of images, ConfigMaps and plain Git. Use sealed or encrypted formats if they must live in Git.',
  followups: [
    { q: 'You enabled encryption at rest yesterday. Is last month\'s database password encrypted in etcd?',
      guidance: 'Not unless it was rewritten. Encryption applies when an object is written. Rewrite all Secrets (for example read and replace them), then verify in etcd if you can. Backups taken before still hold plaintext and need handling.' },
    { q: 'What is the practical difference between a secrets-store CSI mount and syncing into a Kubernetes Secret?',
      guidance: 'A CSI mount fetches from the external store at pod start (and optionally on rotation) and writes to the pod\'s volume, so the value need not exist in etcd. Syncing creates a Secret object, which is convenient for env vars and other consumers but brings back etcd and RBAC exposure. Both need a workload identity to reach the store.' },
    { q: 'How would you detect a Secret being read by something that should not?',
      guidance: 'API audit logs with Secret access at Metadata level, alerting on unexpected subjects or list/watch calls. Periodic review of RBAC bindings to secrets. At the external store, its own access logs. Rotation limits the value of anything leaked.' }
  ],
  misconceptions: [
    '"Secrets are encrypted because they are base64." Base64 is encoding. Encryption at rest is separate API-server configuration.',
    '"Granting list but not get protects values." List and watch return full Secret contents.',
    '"Env var secrets update when the Secret changes." They are fixed at container start.',
    '"Users without Secret RBAC cannot read Secrets." Pod-creation rights in the namespace let them mount and read any Secret there.'
  ],
  weak: [
    'Answers "yes, they are secure" or "no, never use them" with no nuance',
    'Does not mention etcd or encryption configuration',
    'Ignores who can read Secrets via RBAC or pod creation',
    'Proposes an external tool as a silver bullet without considering how the pod authenticates to it'
  ],
  evidence: '# example output\n$ kubectl get secret db-creds -n shop -o jsonpath=\'{.data.password}\' | base64 -d; echo\nS3cr3t-Example-Only\n\n$ kubectl auth can-i list secrets -n shop --as=system:serviceaccount:shop:reporting\nyes     # list returns contents: this is a finding\n\n$ kubectl get pod api-6c7d9-x1q2w -n shop -o jsonpath=\'{.spec.containers[0].env[?(@.name=="DB_PASSWORD")]}{"\\n"}\'\n{"name":"DB_PASSWORD","valueFrom":{"secretKeyRef":{"key":"password","name":"db-creds"}}}\n\n# self-managed control plane only: is it encrypted in etcd?\n$ ETCDCTL_API=3 etcdctl get /registry/secrets/shop/db-creds | hexdump -C | head -3\n00000000  2f 72 65 67 69 73 74 72  79 2f 73 65 63 72 65 74  |/registry/secret|\n00000010  73 2f 73 68 6f 70 2f 64  62 2d 63 72 65 64 73 0a  |s/shop/db-creds.|\n00000020  6b 38 73 3a 65 6e 63 3a  6b 6d 73 3a 76 32 3a 00  |k8s:enc:kms:v2:.|',
  rubric: {
    strong: [
      'States base64 is encoding and encryption at rest is API-server configuration',
      'Covers RBAC exposure including list/watch and pod-creation paths',
      'Accurately contrasts env vars and mounted files',
      'Proposes layered fixes: KMS encryption, RBAC, audit, mounts, external store',
      'Notes existing Secrets must be rewritten after enabling encryption'
    ],
    acceptable: [
      'Focuses on replacing static secrets with workload identity where possible',
      'Recommends a specific external-store pattern, labelled as an example'
    ],
    redFlags: [
      'Calls base64 encryption',
      'Recommends storing secrets in ConfigMaps or baking them into images',
      'Claims describe/get pod always prints secret values'
    ]
  },
  aws: { analogy: 'AWS Secrets Manager or SSM Parameter Store SecureString compared with a Kubernetes Secret object.',
    breaks: 'Secrets Manager encrypts with KMS by default, has per-secret resource policies, built-in rotation and CloudTrail audit. A Kubernetes Secret is an API object whose protection depends on cluster settings (encryption config, RBAC, audit policy). ECS can inject Secrets Manager values into env at task start, but that still has the "env is fixed at start" property.' },
  refs: [
    { t: 'Secrets', u: 'https://kubernetes.io/docs/concepts/configuration/secret/' },
    { t: 'Good practices for Kubernetes Secrets', u: 'https://kubernetes.io/docs/concepts/security/secrets-good-practices/' },
    { t: 'Encrypting Confidential Data at Rest', u: 'https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/' }
  ],
  verify: 'KMS v2 availability and stored prefixes depend on Kubernetes version and provider configuration.'
},

/* ── 05 ConfigMap changes ────────────────────────────────────── */
{ id: 'ons-q-config-05', track: 'onsite', topic: 'config', priority: 'P1', level: 1, mins: 4,
  prereqs: ['les-config', 'les-rollouts'],
  labs: ['ons-lab-06'],
  q: 'How do ConfigMap changes reach a running application?',
  context: 'Someone ran `kubectl edit configmap app-config` to change a log level and a feature flag. One setting took effect, the other did not, and nothing appears in rollout history.',
  evaluates: [
    'Env vars are read at container start and need a restart',
    'Mounted volumes update eventually, except subPath, and the app must reload',
    'Hedges on update timing (kubelet sync plus cache)',
    'Knows config edits are not in rollout history unless versioned',
    'Proposes versioned or hashed config to make changes rollable'
  ],
  spoken: 'It depends on how the pod consumes the ConfigMap.\n\nIf it is injected as environment variables, the values are copied when the container starts and never change. The edit reaches nothing until the pods restart, for example with `kubectl rollout restart`.\n\nIf it is mounted as a volume, the kubelet updates the files in place, eventually. The delay is the kubelet sync period plus its cache, so seconds up to a minute or more, depending on configuration. It happens through an atomic symlink swap. But the application only sees the change if it re-reads the file. And a file mounted with subPath never updates.\n\nIn this scenario, the log level was probably a mounted file the app watches, and the feature flag was probably an env var.\n\nThe bigger problem is that an in-place edit is not in rollout history. The Deployment\'s template did not change, so there is no new revision and nothing to roll back to. I prefer versioned ConfigMap names, or a hash of the config in a template annotation, so each config change triggers a rollout and a rollback restores the old reference. Immutable ConfigMaps enforce that pattern.',
  deep: '**Environment variables** (`env.valueFrom.configMapKeyRef` or `envFrom`) are resolved by the kubelet when it creates the container. After that they are part of the process environment and never updated. A restart is needed: `kubectl rollout restart deploy/x` patches a `restartedAt` annotation into the template, which creates a new ReplicaSet and rolls pods under the normal strategy.\n\n**Mounted volumes.** The kubelet projects keys as files. Updates are written into a new timestamped directory and a `..data` symlink is swapped atomically, so readers never see a half-written set. The update is eventually consistent: the delay is roughly the kubelet sync period plus the ConfigMap cache propagation delay (watch-based by default), so it is not instant and not precisely predictable. Containers that mount a single key with `subPath` do not receive updates, because the bind mount points at the original file. The application must notice the change (inotify, polling, or a reload signal from a sidecar). Many applications read config once at start.\n\n**Missing keys and objects.** If a pod references a key that does not exist and the reference is not `optional: true`, env consumption fails with `CreateContainerConfigError` and volume consumption leaves the pod in `ContainerCreating` with a mount error. Deleting a ConfigMap that running pods use does not affect already-started env vars, but it breaks the next restart.\n\n**History and rollback.** Rollout history tracks pod templates. An in-place ConfigMap edit changes no template, so there is no revision and no record of what the previous value was, beyond your version control or audit logs. Two common patterns: create a new ConfigMap per version (for example with a content-hash suffix, as some manifest tools generate) and update the reference in the template; or put a checksum of the config in a template annotation. Either way, a config change becomes a rollout, gets the Deployment\'s surge and unavailable safety, and `rollout undo` restores the old reference, as long as the old ConfigMap still exists. `immutable: true` ConfigMaps make in-place edits impossible and reduce kubelet watch load.',
  followups: [
    { q: 'You want config changes to roll out gradually and be reversible. Design it.',
      guidance: 'Use versioned or hashed ConfigMap names referenced from the template, managed in Git. Every change becomes a rollout with maxUnavailable/maxSurge and readiness gating. Keep old ConfigMaps for the revision history window. Optionally mark them immutable. Rollback restores the previous reference.' },
    { q: 'An app watches its config file but never sees updates. The ConfigMap was definitely changed. Why?',
      guidance: 'Likely a subPath mount, which does not receive updates, or the app watches the file inode rather than the directory (the symlink swap changes the target). Check the volumeMounts for subPath and look at the ..data symlink in the container.' },
    { q: 'What is the risk of hot-reloading config across all replicas at once?',
      guidance: 'A bad value hits every replica at nearly the same time with no readiness gating, so there is no canary. A rollout-based change limits the blast radius and can stall on readiness. Hot reload suits low-risk knobs such as log level, not behaviour-changing flags.' }
  ],
  misconceptions: [
    '"Editing a ConfigMap updates the app." Env vars never update, and mounted files update only if the app re-reads them.',
    '"Mounted ConfigMaps update instantly." Updates are eventually consistent, and subPath mounts do not update at all.',
    '"I can roll back a ConfigMap edit with rollout undo." In-place edits are not in the Deployment\'s history.',
    '"rollout restart reverts config." It restarts pods with whatever the ConfigMap holds now.'
  ],
  weak: [
    'Gives one answer without distinguishing env from volume',
    'Promises exact propagation timing',
    'Recommends routine `kubectl edit` in production without version control',
    'Does not mention that the application must reload'
  ],
  evidence: '# example output\n$ kubectl exec deploy/api -- printenv FEATURE_NEW_CART\nfalse          # env var: still the value from container start\n\n$ kubectl exec deploy/api -- cat /etc/api/log-level\ndebug          # mounted file: already updated\n\n$ kubectl exec deploy/api -- ls -la /etc/api\nlrwxrwxrwx 1 root root   31 Sep 26 14:10 ..data -> ..2026_09_26_14_10_03.118203411\nlrwxrwxrwx 1 root root   16 Sep 26 09:02 log-level -> ..data/log-level\n\n$ kubectl rollout history deploy/api | tail -1\n14        release 2026.09.20      # no entry for the ConfigMap edit\n\n$ kubectl rollout restart deploy/api\ndeployment.apps/api restarted',
  rubric: {
    strong: [
      'Env vars fixed at start; restart required',
      'Mounted files eventually updated via symlink swap; subPath excluded; app must reload',
      'Hedges on timing (sync period plus cache)',
      'Explains absence from rollout history',
      'Proposes versioned or hashed config for safe, reversible changes'
    ],
    acceptable: [
      'Uses a reloader controller pattern that triggers rollouts on config change, described generically',
      'Recommends immutable ConfigMaps with new names per change'
    ],
    redFlags: [
      'Claims env vars update live',
      'Claims rollout undo reverts ConfigMap content',
      'Relies on exact timing for mounted updates'
    ]
  },
  aws: { analogy: 'ECS task definition environment variables compared with an app that reads SSM Parameter Store or AppConfig at runtime.',
    breaks: 'Changing ECS env vars requires a new immutable task definition revision and a deployment, so changes are versioned automatically. A ConfigMap can be edited in place under running pods with no rollout record. Kubernetes mounted-file updates are closer to runtime fetching, but with kubelet-controlled, eventually-consistent timing.' },
  refs: [
    { t: 'ConfigMaps', u: 'https://kubernetes.io/docs/concepts/configuration/configmap/' },
    { t: 'Configure a Pod to Use a ConfigMap', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/' }
  ],
  verify: 'Mounted ConfigMap propagation delay depends on kubelet sync period and cache strategy configuration.'
},

/* ── 01 Pending PVC ──────────────────────────────────────────── */
{ id: 'ons-q-config-01', track: 'onsite', topic: 'config', priority: 'P1', level: 2, mins: 4,
  prereqs: ['les-storage', 'ons-q-trouble-01'],
  labs: ['ons-lab-08'],
  q: 'How would you diagnose a Pending PersistentVolumeClaim?',
  context: 'A new StatefulSet\'s first pod is Pending and its PVC shows STATUS Pending. The cluster uses dynamic provisioning through a CSI driver.',
  evaluates: [
    'Reads PVC events before guessing',
    'Knows WaitForFirstConsumer Pending is normal until a pod is scheduled',
    'Covers missing/incorrect StorageClass, provisioner health and static PV mismatches',
    'Links volume topology to pod scheduling',
    'Knows most PVC spec fields are immutable, so fixes often mean recreate'
  ],
  spoken: 'First, `kubectl describe pvc`, because the events usually name the cause. Then I work through a short list.\n\nIs the Pending expected? If the StorageClass uses volumeBindingMode WaitForFirstConsumer, the PVC stays Pending on purpose until a pod that uses it is scheduled. The event says "waiting for first consumer". Then the real question is why the pod is not scheduling, which is a scheduler problem.\n\nIs there a StorageClass? If storageClassName names a class that does not exist, or it is empty and the cluster has no default, nothing will provision it.\n\nIs the provisioner working? The class names a CSI driver. If its controller pods are down or it cannot reach the storage backend, events say "waiting for a volume to be created by external provisioner", or show provisioning errors. I check the driver\'s pods and logs.\n\nFor static PVs: does any PV match the requested size, access mode, class and selector? Asking for ReadWriteMany against block-only PVs never binds.\n\nFinally, topology: a volume pinned to one zone means the pod can only run there. Most PVC spec fields are immutable, so the fix often means recreating the PVC, carefully.',
  deep: '**How binding works.** A PVC requests size, access modes and a StorageClass. For static provisioning, the PV controller looks for an existing PV that satisfies all of these (and any label selector) and binds one-to-one. For dynamic provisioning, the class\'s provisioner (usually a CSI driver\'s external-provisioner sidecar) creates a volume and a matching PV. `volumeBindingMode: Immediate` provisions as soon as the PVC exists. `WaitForFirstConsumer` delays provisioning until the scheduler has chosen a node for a pod using the claim, so the volume is created in a topology (zone) where the pod can run.\n\n**Diagnosis by event.**\n- `waiting for first consumer to be created before binding`: expected with WaitForFirstConsumer. Look at the pod: is it Pending for other reasons (requests, taints, affinity)? The PVC binds after the pod is scheduled.\n- `storageclass.storage.k8s.io "fast-ssd" not found`, or no events and an empty class: check `kubectl get storageclass` and whether a default (annotated) class exists. A PVC with `storageClassName: ""` explicitly asks for no dynamic provisioning and binds only to static PVs.\n- `waiting for a volume to be created, either by external provisioner "x" or manually created by system administrator`: the provisioner has not acted. Check that the driver\'s controller pods are running, their logs (credentials, quota, backend API errors), and that the driver name in the class matches an installed CSIDriver.\n- `no persistent volumes available for this claim and no storage class is set`: static provisioning with no matching PV. Compare capacity, accessModes, volumeMode and storageClassName.\n- On the pod: `pod has unbound immediate PersistentVolumeClaims` (Immediate class, PVC not bound yet) or `node(s) had volume node affinity conflict` (the PV exists in a zone with no eligible node).\n\n**Fixing it.** Most of a PVC\'s spec (class, access modes, selector) is immutable after creation. Only storage requests can grow, and only if the class allows expansion. Fixing a wrong class usually means deleting and recreating the PVC. For a StatefulSet, the volumeClaimTemplates are also largely immutable, so check reclaim policies before deleting anything that might already be bound to data.',
  followups: [
    { q: 'The PVC shows "waiting for first consumer" and the pod shows FailedScheduling with "volume node affinity conflict". What is going on?',
      guidance: 'This usually means an already-provisioned volume (for example from a previous pod, or a static PV) lives in a zone where no node currently has room or matches. Options: add capacity in that zone, relax other constraints, or (if the data is disposable) recreate the claim. Waiting only helps if nodes will appear in that zone.' },
    { q: 'Why is WaitForFirstConsumer generally preferred for zonal block storage?',
      guidance: 'Immediate binding may create the volume in a zone chosen without knowing where the pod can run, which can make the pod unschedulable. Delayed binding lets the scheduler pick a node first and provision in that node\'s topology.' },
    { q: 'A developer wants to "just change the StorageClass" on a bound PVC with data. What do you tell them?',
      guidance: 'The class is immutable on the PVC. Migrating means creating a new PVC in the new class and copying data (a job, a snapshot restore if supported across classes, or application-level replication), then switching the workload, with a verified backup first.' }
  ],
  misconceptions: [
    '"A Pending PVC is always broken." With WaitForFirstConsumer it is expected until a pod is scheduled.',
    '"Leaving storageClassName empty uses the default class." Omitting the field uses the default. Setting it to "" explicitly disables dynamic provisioning.',
    '"You can edit the PVC to fix the class or access mode." Those fields are immutable. Only requested size can grow (if expansion is allowed).',
    '"Storage problems and scheduling problems are separate." Volume topology constrains where the pod can be scheduled.'
  ],
  weak: [
    'Deletes and recreates PVCs before reading events',
    'Does not check whether the provisioner is running',
    'Ignores binding mode',
    'Treats storage and scheduling as unrelated'
  ],
  evidence: '# example output\n$ kubectl get pvc -n db\nNAME          STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS   AGE\ndata-pg-0     Pending                                      fast-ssd       6m\n\n$ kubectl describe pvc data-pg-0 -n db | sed -n \'/^Events/,$p\'\nEvents:\n  Type     Reason                Message\n  Normal   ExternalProvisioning  Waiting for a volume to be created either by the external provisioner \'csi.example.com\' or manually by the system administrator.\n  Warning  ProvisioningFailed    failed to provision volume with StorageClass "fast-ssd": rpc error: code = ResourceExhausted desc = volume quota exceeded\n\n$ kubectl get storageclass\nNAME                 PROVISIONER       RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION\nfast-ssd             csi.example.com   Delete          WaitForFirstConsumer   true\nstandard (default)   csi.example.com   Delete          WaitForFirstConsumer   true\n\n$ kubectl get pods -n kube-system -l app=csi-example-controller\nNAME                                READY   STATUS    RESTARTS   AGE\ncsi-example-controller-6b8d-9xk2p   5/5     Running   0          12d',
  rubric: {
    strong: [
      'Reads PVC and pod events and classifies the cause',
      'Recognises WaitForFirstConsumer Pending as expected and pivots to pod scheduling',
      'Checks StorageClass existence/default and provisioner health',
      'Explains static PV matching (size, access mode, class, selector)',
      'Knows immutability and plans a safe recreate'
    ],
    acceptable: [
      'Starts from the pod\'s FailedScheduling message and works back to the PVC',
      'Uses CSI driver logs as the primary source when events are sparse'
    ],
    redFlags: [
      'Assumes every Pending PVC is an error',
      'Deletes bound PVCs or PVs without checking reclaim policy',
      'Edits immutable fields and is surprised by the rejection'
    ]
  },
  aws: { analogy: 'An EBS volume created by CloudFormation or a launch template: it must be in the same Availability Zone as the instance that attaches it.',
    breaks: 'In Kubernetes, a claim-provision-bind flow run by controllers and a CSI driver creates the volume, and binding mode decides whether the zone is chosen before or after pod placement. EBS in ECS on EC2 has no claim object or delayed binding. Access modes and StorageClasses are Kubernetes abstractions.' },
  refs: [
    { t: 'Persistent Volumes', u: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/' },
    { t: 'Storage Classes', u: 'https://kubernetes.io/docs/concepts/storage/storage-classes/' },
    { t: 'Dynamic Volume Provisioning', u: 'https://kubernetes.io/docs/concepts/storage/dynamic-provisioning/' }
  ],
  verify: 'Exact event wording varies by Kubernetes and CSI sidecar versions.'
},

/* ── 04 RBAC forbidden ───────────────────────────────────────── */
{ id: 'ons-q-config-04', track: 'onsite', topic: 'config', priority: 'P1', level: 2, mins: 4,
  prereqs: ['les-identity', 'ons-q-config-02'],
  labs: ['ons-lab-09'],
  q: 'An application logs "forbidden: User system:serviceaccount:ns:app cannot list configmaps". How do you fix it safely?',
  context: 'The app runs in namespace `ns` as ServiceAccount `app` and started failing after a redeploy. You can manage RBAC in that namespace through the team\'s normal change process.',
  evaluates: [
    'Parses the message: subject, verb, resource, API group, scope',
    'Reproduces with `kubectl auth can-i --as`',
    'Finds existing bindings and common mismatches',
    'Grants least privilege with a namespaced Role and RoleBinding',
    'Verifies and avoids broad grants like cluster-admin or edit'
  ],
  spoken: 'First I read the message carefully. It names the subject, system:serviceaccount:ns:app. It names the verb, list, the resource, configmaps in the core API group, and the scope, either "in the namespace ns" or "at the cluster scope". That last part matters: cluster scope means the app is listing across all namespaces, and I would ask whether it should.\n\nThen I reproduce it: `kubectl auth can-i list configmaps -n ns --as=system:serviceaccount:ns:app`. I look at what changed. Maybe the redeploy switched the pod to a different ServiceAccount, or the default one. Maybe an existing RoleBinding names the ServiceAccount with the wrong namespace in its subject. Maybe the binding is in another namespace, or points at a Role that lacks list.\n\nThe fix is a namespaced Role with only what the app needs, probably get, list and watch on configmaps. Then a RoleBinding to that ServiceAccount, applied through the normal change process. roleRef cannot be changed on an existing binding, so fixing the wrong role means recreating it. I verify with can-i and then the app logs. What I would not do is bind cluster-admin or edit to make the error go away, because RBAC has no deny to undo an over-grant later.',
  deep: '**Read the error.** A full message looks like: `configmaps is forbidden: User "system:serviceaccount:ns:app" cannot list resource "configmaps" in API group "" in the namespace "ns"`. The subject tells you which identity the pod actually used. The verb and resource tell you the minimum rule. The empty API group means core. The scope decides Role versus ClusterRole: if it says "at the cluster scope", the client made an all-namespaces request, which often means a library default you can change instead of widening access.\n\n**Reproduce and locate.** `kubectl auth can-i list configmaps -n ns --as=system:serviceaccount:ns:app` gives yes or no from the authorizer, and `--list` shows everything the subject can do. Then find bindings that mention the subject: `kubectl get rolebindings,clusterrolebindings -A -o wide | grep app`, or query subjects with jsonpath. Common mismatches:\n- The pod runs as a different ServiceAccount than expected (check `spec.serviceAccountName`). A chart value or manifest change can switch it to `default`.\n- The binding\'s subject has `kind: ServiceAccount` but the wrong `namespace` (that field is required for ServiceAccount subjects).\n- The RoleBinding is in a different namespace than the resources, or points at a Role in another namespace. A RoleBinding can reference only a Role in its own namespace, or a ClusterRole.\n- The Role grants `get` but not `list`/`watch`, or has a typo in resources (`configmap` vs `configmaps`) or apiGroups.\n\n**Least-privilege fix.** Create a `Role` in `ns` with `apiGroups: [""]`, `resources: ["configmaps"]` and `verbs: ["get","list","watch"]`, then a `RoleBinding` in `ns` to `ServiceAccount app`. `resourceNames` can limit `get` to specific objects, but it does not narrow `list`/`watch` in the usual way, so if you need that, the app should get by name. Apply it through version control like any other change. RBAC prevents privilege escalation: you can grant only permissions you hold, unless you have `escalate`/`bind`. `roleRef` is immutable, so changing the role means deleting and recreating the binding.\n\n**Verify.** `can-i` returns yes, the app\'s next list succeeds, and `can-i --list` shows nothing broader than intended. Because RBAC is additive, any overly broad grant made in a hurry stays until someone removes it, so put a follow-up in the incident notes if you had to.',
  followups: [
    { q: 'The error says "at the cluster scope". What changes?',
      guidance: 'The app listed configmaps across all namespaces. First ask whether it needs to, since many clients default to all namespaces and can be scoped to one. If it truly needs several namespaces, prefer RoleBindings in each to a ClusterRole over a ClusterRoleBinding. Use a ClusterRoleBinding only if cluster-wide access is really required.' },
    { q: 'can-i now says yes but the app still logs forbidden. Why might that be?',
      guidance: 'The pod may be using a different ServiceAccount than the one you tested, or a different namespace. The app may call a different verb (watch) or resource (a subresource or another API group). Or a long-lived client cache or stale token (legacy token) is involved. Read the new error text and compare it exactly.' },
    { q: 'How would you stop this class of incident recurring?',
      guidance: 'Keep RBAC alongside the app manifests in the same change, test with `kubectl auth can-i` in CI against a test cluster, alert on 403s from service accounts in API audit logs, and review permissions periodically.' }
  ],
  misconceptions: [
    '"Bind edit or cluster-admin to be safe." That grants far more than list configmaps, and RBAC has no deny to claw it back.',
    '"The binding exists, so it must be right." Subject namespace, roleRef kind or name, and binding namespace are common mismatches.',
    '"I can edit roleRef on the binding." roleRef is immutable. Recreate the binding.',
    '"Forbidden means authentication failed." Forbidden (403) is authorization. Unauthenticated is 401.'
  ],
  weak: [
    'Grants broad roles to make the error disappear',
    'Does not verify with can-i',
    'Ignores which ServiceAccount the pod actually runs as',
    'Changes RBAC by hand outside version control without noting it'
  ],
  evidence: '# example output\n$ kubectl auth can-i list configmaps -n ns --as=system:serviceaccount:ns:app\nno\n\n$ kubectl get pod -n ns -l app=app -o jsonpath=\'{.items[0].spec.serviceAccountName}{"\\n"}\'\napp\n\n$ kubectl get rolebinding app-config -n ns -o jsonpath=\'{.roleRef.kind}/{.roleRef.name} -> {.subjects[0].kind}:{.subjects[0].namespace}/{.subjects[0].name}{"\\n"}\'\nRole/config-reader -> ServiceAccount:default/app      # wrong subject namespace\n\n$ kubectl create role config-reader -n ns --verb=get,list,watch --resource=configmaps --dry-run=client -o yaml > role.yaml\n$ kubectl create rolebinding app-config-reader -n ns --role=config-reader --serviceaccount=ns:app --dry-run=client -o yaml > binding.yaml\n# commit, review, apply through the normal process, then:\n$ kubectl auth can-i list configmaps -n ns --as=system:serviceaccount:ns:app\nyes',
  rubric: {
    strong: [
      'Parses subject, verb, resource, group and scope from the message',
      'Reproduces and verifies with `kubectl auth can-i --as`',
      'Checks serviceAccountName and binding subject namespace/roleRef',
      'Grants a minimal namespaced Role + RoleBinding via normal change control',
      'Notes additive RBAC and roleRef immutability'
    ],
    acceptable: [
      'Reuses the built-in `view` ClusterRole via a namespaced RoleBinding, while noting it grants more than configmaps',
      'Changes the app to avoid cluster-wide list instead of granting more'
    ],
    redFlags: [
      'Binds cluster-admin or a cluster-wide edit to the ServiceAccount',
      'Grants to the group system:serviceaccounts',
      'Confuses 403 authorization with authentication'
    ]
  },
  aws: { analogy: 'An AccessDenied error from an IAM role missing an action, fixed by adding a scoped policy statement.',
    breaks: 'IAM errors can come from explicit denies, SCPs, permission boundaries or resource policies. RBAC has none of these: it is allow-only, so a missing grant is the only cause. RBAC rules use verbs on resource types (and optional names), not action/ARN pairs, and bindings are separate objects whose roleRef cannot be edited.' },
  refs: [
    { t: 'Using RBAC Authorization', u: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/' },
    { t: 'kubectl auth can-i', u: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/' },
    { t: 'Role Based Access Control Good Practices', u: 'https://kubernetes.io/docs/concepts/security/rbac-good-practices/' }
  ],
  verify: ''
},

/* ── 06 Access modes ─────────────────────────────────────────── */
{ id: 'ons-q-config-06', track: 'onsite', topic: 'config', priority: 'P1', level: 2, mins: 4,
  prereqs: ['les-storage', 'ons-q-config-01'],
  labs: ['ons-lab-08'],
  q: 'Explain PV access modes and why a second replica can\'t mount the same volume.',
  context: 'A Deployment with one ReadWriteOnce PVC was scaled from 1 to 2 replicas. The second pod is stuck in ContainerCreating. Later, a normal rolling update also hangs.',
  evaluates: [
    'Knows RWO is per node, not per pod; RWOP is per pod',
    'Knows RWX requires a backend that supports it',
    'Recognises Multi-Attach errors and the attach/detach mechanism',
    'Explains the rolling-update deadlock with a single RWO volume',
    'Proposes StatefulSet volumeClaimTemplates or Recreate as appropriate'
  ],
  spoken: 'Access modes describe how a volume can be attached. ReadWriteOnce means read-write by a single node. Several pods on the same node can share it, but a pod on another node cannot. ReadWriteOncePod narrows that to exactly one pod. ReadOnlyMany and ReadWriteMany allow many nodes, but only if the storage backend supports it. Block volumes usually do not. Shared file systems usually do.\n\nHere the second replica landed on a different node. The volume is already attached to the first node, so the attach fails with a Multi-Attach error and the pod sits in ContainerCreating. Scaling a Deployment does not give each replica its own storage, because every replica references the same PVC.\n\nThe rolling update hangs for the same reason. The new pod lands on a different node and cannot attach. With maxUnavailable at zero, the old pod will not terminate until the new one is Ready. Each is waiting for the other.\n\nFixes: if each replica needs its own data, use a StatefulSet with volumeClaimTemplates, which gives one PVC per replica. If it is really a single-writer app, use the Recreate strategy. RWX is only right when the backend supports it and the application is safe with concurrent writers.',
  deep: '**What access modes mean.** Access modes are declared on PVs and requested by PVCs, and they are used for matching. Some also constrain where a volume can be mounted, but they do not enforce write protection once mounted. `ReadWriteOnce` (RWO): mountable read-write by a single node, so multiple pods on that node can use it. `ReadOnlyMany` (ROX): read-only by many nodes. `ReadWriteMany` (RWX): read-write by many nodes. `ReadWriteOncePod` (RWOP): a single pod across the whole cluster, stable in recent versions and supported by CSI volumes. What a class can actually provide depends on the driver: cloud block devices are typically RWO or RWOP only, while network file systems can offer RWX.\n\n**The mechanism behind the error.** For attachable volumes, the attach/detach controller (with the CSI driver) attaches the volume to a node before the kubelet mounts it. If an RWO volume is already attached to node A and a pod using it is scheduled to node B, attach fails. You see `FailedAttachVolume ... Multi-Attach error for volume "pvc-..." Volume is already used by pod(s) ...` on the new pod, which stays in ContainerCreating. With RWOP, a second pod is prevented from using the claim at scheduling or mount time instead.\n\n**Rolling-update deadlock.** A Deployment with one RWO PVC and `RollingUpdate` creates the new pod before deleting the old one. If the new pod is scheduled to another node, it cannot attach. It never becomes Ready, so the old pod is never removed (especially with maxUnavailable 0), and the volume never detaches. Options: `strategy: Recreate` (accept brief downtime), a StatefulSet (ordered replacement, one pod identity per volume), or pinning to a node (fragile, loses the benefit of rescheduling). Node loss adds another wrinkle: detaching a volume from an unreachable node can take time or need manual steps, depending on version and configuration.\n\n**One volume per replica.** A StatefulSet\'s `volumeClaimTemplates` create a PVC per ordinal (`data-web-0`, `data-web-1`), and a replacement pod with the same ordinal reuses its PVC. That is what replicated stateful systems need. They replicate data at the application layer, not by sharing a disk.\n\n**Topology.** Zonal volumes add node affinity. An RWO volume in zone A restricts its pod to nodes in zone A, which is one reason to use WaitForFirstConsumer.',
  followups: [
    { q: 'Could you just switch the PVC to ReadWriteMany?',
      guidance: 'Only if the StorageClass and backend support RWX, and access mode on an existing PVC is immutable, so it means a new PVC and a data migration. More importantly, the application must tolerate concurrent writers. Most databases and many file-based apps do not, and two writers can corrupt data.' },
    { q: 'A node died and the replacement pod shows Multi-Attach for six minutes. Why?',
      guidance: 'The volume is still recorded as attached to the dead node. Kubernetes waits before force-detaching, to avoid corrupting a volume that might still be in use. Depending on version, marking the node out of service (non-graceful node shutdown handling) or confirming the node is really gone speeds this up. Check VolumeAttachment objects.' },
    { q: 'When would you choose ReadWriteOncePod?',
      guidance: 'When correctness requires exactly one writer pod, even on the same node. For example, a single-writer database or a leader-only workload where accidental co-scheduling of a second pod on the same node would be dangerous. It needs CSI support and a recent enough version.' }
  ],
  misconceptions: [
    '"ReadWriteOnce means one pod." It means one node. Several pods on that node can mount it. RWOP means one pod.',
    '"Access modes enforce read-only or write protection." They mainly govern matching and attachment, not in-container write protection.',
    '"Scaling a Deployment gives each replica its own volume." All replicas share the one PVC in the template. Use a StatefulSet for per-replica volumes.',
    '"RWX is always available." It depends on the storage backend and CSI driver.'
  ],
  weak: [
    'Says RWO means "one pod"',
    'Suggests RWX without considering backend support or app concurrency',
    'Cannot explain why the rolling update hangs',
    'Force-deletes pods or VolumeAttachments without understanding the risk'
  ],
  evidence: '# example output\n$ kubectl get pods -l app=uploads -o wide\nNAME                       READY   STATUS              RESTARTS   AGE   NODE\nuploads-6d9c7b8f5-2kq9s    1/1     Running             0          3d    worker-1\nuploads-6d9c7b8f5-x7m4p    0/1     ContainerCreating   0          8m    worker-3\n\n$ kubectl describe pod uploads-6d9c7b8f5-x7m4p | grep -A1 FailedAttach\n  Warning  FailedAttachVolume  attachdetach-controller  Multi-Attach error for volume "pvc-3f8e1c2a-..." Volume is already used by pod(s) uploads-6d9c7b8f5-2kq9s\n\n$ kubectl get pvc uploads-data -o jsonpath=\'{.spec.accessModes}{"\\n"}\'\n["ReadWriteOnce"]\n\n$ kubectl get volumeattachments | grep pvc-3f8e1c2a\ncsi-7a1b...   csi.example.com   pvc-3f8e1c2a-...   worker-1   true   3d',
  rubric: {
    strong: [
      'Defines RWO (node), RWOP (pod), ROX, RWX correctly',
      'Explains attach/detach and the Multi-Attach error',
      'Explains the rolling-update deadlock and the Recreate/StatefulSet fixes',
      'States RWX depends on backend and app concurrency safety',
      'Mentions volumeClaimTemplates for per-replica storage'
    ],
    acceptable: [
      'Solves it by redesigning to object storage instead of a shared volume',
      'Mentions zonal topology as an additional constraint'
    ],
    redFlags: [
      'Says RWO is per pod',
      'Recommends RWX for a database without caveats',
      'Suggests force-detaching volumes as routine'
    ]
  },
  aws: { analogy: 'An EBS volume attaches to one EC2 instance in one AZ (io1/io2 Multi-Attach aside), while EFS can be mounted by many instances.',
    breaks: 'RWO is a Kubernetes-level contract implemented by the CSI driver and attach/detach controller. It is per node, so several pods on that node can share it. Kubernetes adds RWOP for single-pod semantics, and the rolling-update deadlock is a Deployment-controller behaviour with no direct ECS counterpart.' },
  refs: [
    { t: 'Persistent Volumes (access modes)', u: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes' },
    { t: 'StatefulSets', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/' },
    { t: 'Deployments (strategy)', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' }
  ],
  verify: 'ReadWriteOncePod is stable since v1.29 (CSI volumes only); force-detach timing after node loss depends on version and configuration.'
},

/* ── 07 Deleting PVCs and StatefulSets ───────────────────────── */
{ id: 'ons-q-config-07', track: 'onsite', topic: 'config', priority: 'P1', level: 2, mins: 4,
  prereqs: ['les-storage', 'ons-q-config-06'],
  labs: ['ons-lab-08'],
  q: 'What happens to data when you delete a PVC or a StatefulSet?',
  context: 'You are asked to clean up an old StatefulSet-based database in a namespace, and to delete its PVCs to reclaim storage. The data might still be needed for an audit.',
  evaluates: [
    'Knows StatefulSet deletion keeps PVCs by default',
    'Knows reclaimPolicy (Delete vs Retain) decides the backing volume\'s fate',
    'Knows dynamically provisioned PVs inherit Delete by default',
    'Treats snapshots/backups as separate and verifiable',
    'Proposes a safe, reversible procedure'
  ],
  spoken: 'Deleting the StatefulSet removes the pods, but by default its PVCs are kept. That is deliberate, so a mistaken delete does not lose data. Newer versions let you set persistentVolumeClaimRetentionPolicy to delete them on StatefulSet deletion or scale-down. So I check that field first.\n\nDeleting a PVC is where data can go. The PVC is released from its PV, and the PV\'s reclaimPolicy decides what happens next. With Delete, which is what dynamically provisioned volumes usually get from their StorageClass, the provisioner deletes the backing disk and the data is gone. With Retain, the PV becomes Released, the disk and data stay, and an admin has to clean up or reattach it by hand.\n\nFor this task, because the data might be needed, I would record which PV and backing volume each PVC maps to. I would patch those PVs to Retain before deleting anything, take a backup or snapshot and confirm it can be restored, and get sign-off. Then delete the StatefulSet, then the PVCs. Also be careful with namespace deletion: it deletes every PVC in the namespace, with the same reclaim consequences.',
  deep: '**StatefulSet deletion.** Deleting a StatefulSet deletes its pods (use a scale-to-zero first if ordered shutdown matters) but, by default, leaves the PVCs created from `volumeClaimTemplates`. `spec.persistentVolumeClaimRetentionPolicy` has `whenDeleted` and `whenScaled`, each `Retain` (default) or `Delete`. With `Delete`, the controller sets owner references so the garbage collector removes the PVCs after the pods terminate. This field is stable in recent versions and was feature-gated before that.\n\n**PVC deletion.** Storage-object-in-use protection (a finalizer) keeps a PVC in `Terminating` while any pod still uses it. Once released, the bound PV\'s `persistentVolumeReclaimPolicy` applies:\n- `Delete`: the external provisioner deletes the PV and the backing storage asset. Dynamically provisioned PVs inherit the StorageClass `reclaimPolicy`, which defaults to `Delete`.\n- `Retain`: the PV moves to `Released`, the storage asset and data remain, and it is not automatically reusable. An admin must clean it and delete the PV, or clear its `claimRef` so a new claim can bind.\n- (`Recycle` is deprecated.)\nYou can change a PV\'s reclaim policy at any time with `kubectl patch pv`, which is the key safety step before deletions.\n\n**Namespace deletion** cascades to every PVC in it, which triggers the reclaim policy for each. PVs are cluster-scoped and survive only if Retain.\n\n**Snapshots and backups.** `VolumeSnapshot` objects need CSI snapshot support and a snapshot controller. A snapshot\'s own lifetime follows its `VolumeSnapshotClass` deletionPolicy. A snapshot may live in the same storage system and failure domain as the volume, so it is not automatically an off-site backup. The only proof of a backup is a test restore.\n\n**Safe procedure.** Inventory (PVC → PV → volume handle), patch PVs to Retain, snapshot or back up, restore-test, get approval, scale down, delete the StatefulSet, delete the PVCs, then decide separately and later what to do with Released PVs and their disks. Write it as a runbook with a check at each step. That is standard change-control practice.',
  followups: [
    { q: 'You deleted a PVC and its PV was Retain. How do you attach that data to a new pod?',
      guidance: 'The PV is Released with a stale claimRef. Clear `spec.claimRef` (or create a new PV pointing at the same volume handle), then create a PVC that matches it (same class, size, access mode, optionally `volumeName`) so they bind. Verify the data before putting the application back.' },
    { q: 'Someone set whenScaled: Delete. What is the risk when an autoscaler or operator scales down?',
      guidance: 'Scaling down deletes the PVCs of removed ordinals, and with a Delete reclaim policy their data is destroyed. A later scale-up gets fresh empty volumes. That is fine for caches, dangerous for data stores that expect to rejoin with their data.' },
    { q: 'How would you guard against accidental namespace deletion wiping databases?',
      guidance: 'Retain reclaim policy on classes or PVs for critical data, restricted RBAC for namespace delete, admission policies that block deletion of labelled namespaces, regular tested backups stored outside the cluster, and GitOps or pipeline safeguards against pruning.' }
  ],
  misconceptions: [
    '"Deleting a StatefulSet deletes its data." By default its PVCs are retained, unless the retention policy says Delete.',
    '"Deleting a PVC always keeps the disk." With a Delete reclaim policy, the default for dynamic provisioning, the backing volume is destroyed.',
    '"A snapshot is a backup." It may share a failure domain with the source and is unproven until restored.',
    '"Retain means the volume will be reused automatically." A Released PV needs manual action before it can bind again.'
  ],
  weak: [
    'Deletes first and checks policies afterwards',
    'Does not distinguish PVC, PV and backing storage',
    'Ignores namespace deletion cascade',
    'No restore test or approval step'
  ],
  evidence: '# example output\n$ kubectl get sts pg -n legacy -o jsonpath=\'{.spec.persistentVolumeClaimRetentionPolicy}{"\\n"}\'\n{"whenDeleted":"Retain","whenScaled":"Retain"}\n\n$ kubectl get pvc -n legacy\nNAME        STATUS   VOLUME                                     CAPACITY   STORAGECLASS\ndata-pg-0   Bound    pvc-9c1e7f3a-2b4d-4e8f-a1c2-7d6e5f4a3b21   100Gi      standard\n\n$ kubectl get pv pvc-9c1e7f3a-2b4d-4e8f-a1c2-7d6e5f4a3b21 -o custom-columns=NAME:.metadata.name,RECLAIM:.spec.persistentVolumeReclaimPolicy,HANDLE:.spec.csi.volumeHandle\nNAME                                       RECLAIM   HANDLE\npvc-9c1e7f3a-2b4d-4e8f-a1c2-7d6e5f4a3b21   Delete    vol-0example1234\n\n$ kubectl patch pv pvc-9c1e7f3a-2b4d-4e8f-a1c2-7d6e5f4a3b21 -p \'{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}\'\npersistentvolume/pvc-9c1e7f3a-2b4d-4e8f-a1c2-7d6e5f4a3b21 patched',
  rubric: {
    strong: [
      'StatefulSet deletion retains PVCs by default; mentions retention policy',
      'Explains Delete vs Retain and that dynamic PVs default to Delete via the StorageClass',
      'Patches to Retain and inventories volume handles before deleting',
      'Treats backups/snapshots as separate and requires a restore test',
      'Mentions namespace deletion cascade'
    ],
    acceptable: [
      'Uses an application-level dump instead of volume snapshots, with restore verification',
      'Describes the procedure as a change-controlled runbook rather than commands'
    ],
    redFlags: [
      'Claims deleting a PVC never loses data',
      'Deletes PVCs without checking reclaim policy',
      'Treats an unverified snapshot as a sufficient backup'
    ]
  },
  aws: { analogy: 'EBS DeleteOnTermination on instance volumes, and CloudFormation DeletionPolicy Retain/Snapshot on resources.',
    breaks: 'In Kubernetes the policy lives on the PV (copied from the StorageClass at provisioning) and is triggered by PVC deletion, not instance or stack deletion. Namespace deletion cascades to PVCs. There is no built-in "snapshot on delete" policy like CloudFormation\'s Snapshot.' },
  refs: [
    { t: 'Persistent Volumes (reclaiming)', u: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/' },
    { t: 'StatefulSets (PVC retention)', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/' },
    { t: 'Change the Reclaim Policy of a PersistentVolume', u: 'https://kubernetes.io/docs/tasks/administer-cluster/change-pv-reclaim-policy/' }
  ],
  verify: 'persistentVolumeClaimRetentionPolicy is stable since v1.32 (available from v1.23 behind the StatefulSetAutoDeletePVC feature gate); older clusters may not honour it.'
},

/* ── 08 Cloud auth without long-lived keys ───────────────────── */
{ id: 'ons-q-config-08', track: 'onsite', topic: 'config', priority: 'P1', level: 3, mins: 5,
  prereqs: ['les-identity', 'ons-q-config-02'],
  labs: ['ons-lab-09'],
  q: 'How should a pod authenticate to a cloud API without long-lived keys?',
  context: 'A team currently mounts a static cloud access key from a Secret. You are asked to replace it with short-lived credentials and to explain what can go wrong.',
  evaluates: [
    'Explains projected ServiceAccount tokens with audience and expiry',
    'Explains OIDC federation: issuer discovery, JWKS, trust policy on sub/aud',
    'Scopes identity per workload and understands who can use a ServiceAccount',
    'Knows concrete failure modes and how to diagnose them',
    'Considers disconnected/private environments where issuer discovery may not be reachable'
  ],
  spoken: 'I would use workload identity federation, so the pod proves who it is with a Kubernetes-issued token and swaps it for short-lived cloud credentials.\n\nIt works like this. The pod runs as a dedicated ServiceAccount. The kubelet projects a token for it into the pod: a signed JWT with the ServiceAccount as subject, an audience the cloud expects, and a short expiry, rotated automatically. The cluster\'s token issuer publishes OIDC discovery and public keys. The cloud account trusts that issuer, and a role\'s trust policy says: accept tokens with this audience whose subject is system:serviceaccount:shop:uploader. The SDK sends the token to the cloud\'s token service and gets temporary credentials for that role. On AWS, IRSA works this way, and EKS Pod Identity reaches the same goal through a node agent.\n\nWhat goes wrong: the audience does not match, the subject in the trust policy has the wrong namespace or name, the cloud cannot reach the issuer\'s keys (common in private or air-gapped setups, where you may need to publish or pre-register keys), clock skew, or the SDK picking up an old static key first. And remember that anyone who can create pods in that namespace can use the ServiceAccount.',
  deep: '**Token side.** A projected `serviceAccountToken` volume source asks the kubelet to call the TokenRequest API for the pod\'s ServiceAccount with a specified `audience` and `expirationSeconds`. The resulting JWT carries `iss` (the cluster\'s issuer URL), `sub` (`system:serviceaccount:<ns>:<name>`), `aud`, `exp`, and claims binding it to the pod. The kubelet refreshes the file before expiry: it rotates tokens older than 80% of their TTL or older than 24 hours. The app or SDK must re-read the file rather than cache the first token forever.\n\n**Trust side.** The API server serves `/.well-known/openid-configuration` and a JWKS at `/openid/v1/jwks` for the configured issuer. The cloud provider is configured with that issuer as an OIDC identity provider, and it fetches or is given the public keys to verify signatures. A cloud role\'s trust policy allows web-identity federation from that provider with conditions on `aud` and `sub` (exact match on namespace and ServiceAccount, not wildcards). The permissions policy on the role grants only what this workload needs. Some platforms use a node-level agent that the pod calls instead of direct federation. The trust question is the same, but the plumbing differs.\n\n**Scoping.** One ServiceAccount per workload, one role per ServiceAccount, and no reuse of `default`. Pod-creation rights in the namespace are effectively the right to assume that role, so keep sensitive identities in namespaces with tight RBAC and consider admission policy on `serviceAccountName`. Remove the static key Secret and revoke the key once the new path is verified.\n\n**Failure modes and evidence.**\n- `aud` mismatch: the token\'s audience is not the one the cloud expects. Decode the token and compare.\n- `sub` mismatch: a namespace or name typo in the trust policy, or the pod running as a different ServiceAccount.\n- Issuer or keys problem: the issuer URL in the token differs from the registered provider, or the cloud cannot fetch the JWKS (private API endpoint, air-gapped region), or the keys changed after signing-key rotation without updating the provider. Depending on provider, you can host the discovery documents at a reachable location or upload keys directly.\n- Clock skew: nodes with bad time produce tokens that look not-yet-valid or expired.\n- SDK credential chain: leftover static keys in env or config take precedence over web identity.\n- Expiry: the app reads the token once and fails hours later.\n\n**Diagnosis flow.** Decode the token (claims only, never paste it anywhere shared), compare with the trust policy, check cloud-side audit logs for the federation call and its error, check node time, and check which credential source the SDK actually used.',
  followups: [
    { q: 'In a disconnected region, the cloud token service cannot reach your cluster\'s issuer URL. What are your options?',
      guidance: 'Host the OIDC discovery document and JWKS somewhere the provider can reach inside that environment, or register the public keys directly if the provider supports it. Plan for signing-key rotation, because the published keys must be updated before new keys sign tokens. Validate end to end in a staging environment with the same network constraints.' },
    { q: 'How would you roll this out without an outage for the team currently using a static key?',
      guidance: 'Create the role and trust policy, add the projected token and SDK config alongside the existing key, verify from a canary pod that the SDK uses web identity (cloud audit shows the federated principal), remove the static key from the pod spec, roll out, watch errors, then revoke the key. Keep the steps reversible until revocation.' },
    { q: 'Two teams want to share one ServiceAccount to save setup work. What do you say?',
      guidance: 'Sharing merges their blast radius and audit trail: every cloud action appears as one principal, and least privilege becomes the union of both needs. Separate ServiceAccounts and roles cost little and keep permissions and accountability clear.' }
  ],
  misconceptions: [
    '"The ServiceAccount token is a cloud credential." It is a Kubernetes-issued JWT that the cloud must be configured to trust and exchange.',
    '"Federation removes all secrets." It removes long-lived keys, but the issuer\'s signing keys and trust configuration become critical assets.',
    '"Wildcard subjects in the trust policy are fine." They let any matching ServiceAccount assume the role. Match exact namespace and name.',
    '"Tokens never expire, so read once at start." Projected tokens rotate, and the app must re-read them.'
  ],
  weak: [
    'Proposes rotating static keys more often as the whole answer',
    'Cannot explain how the cloud verifies a Kubernetes token',
    'Ignores who can run pods as the ServiceAccount',
    'Has no diagnosis path when federation fails'
  ],
  evidence: '# example output\n$ kubectl get pod uploader-7f8d9-k2l4m -n shop -o jsonpath=\'{.spec.volumes[?(@.projected)].projected.sources[*].serviceAccountToken}{"\\n"}\'\n{"audience":"sts.example.com","expirationSeconds":3600,"path":"token"}\n\n$ kubectl get --raw /.well-known/openid-configuration\n{"issuer":"https://oidc.cluster.example.internal","jwks_uri":"https://oidc.cluster.example.internal/openid/v1/jwks","response_types_supported":["id_token"],"subject_types_supported":["public"],"id_token_signing_alg_values_supported":["RS256"]}\n\n# decode claims only (payload), locally\n$ kubectl exec uploader-7f8d9-k2l4m -n shop -- cat /var/run/secrets/tokens/token | cut -d. -f2 | base64 -d 2>/dev/null\n{"aud":["sts.example.com"],"exp":1790439600,"iat":1790436000,"iss":"https://oidc.cluster.example.internal","sub":"system:serviceaccount:shop:uploader"}\n\n# node clock check\n$ timedatectl | grep synchronized\nSystem clock synchronized: yes',
  rubric: {
    strong: [
      'Explains projected, audience-bound, rotating ServiceAccount tokens',
      'Explains OIDC discovery/JWKS and trust-policy conditions on sub and aud',
      'Scopes one ServiceAccount and role per workload and notes the pod-creation risk',
      'Lists concrete failure modes with evidence (aud, sub, JWKS reachability, clock, SDK chain)',
      'Addresses disconnected environments with hedged options'
    ],
    acceptable: [
      'Describes a node-agent model (for example EKS Pod Identity) as an alternative to direct federation',
      'Uses an external secrets or vault system authenticated by the ServiceAccount token, with the same trust reasoning'
    ],
    redFlags: [
      'Keeps static keys in Secrets as the recommended end state',
      'Uses wildcard subject conditions',
      'Pastes full tokens into tickets or chat when debugging'
    ]
  },
  aws: { analogy: 'An ECS task role, where the ECS agent provides short-lived credentials, compared with IRSA (OIDC web identity federation) or EKS Pod Identity.',
    breaks: 'With ECS, AWS itself vouches for the task, so there is no issuer to publish and no trust policy on a Kubernetes subject. Kubernetes federation depends on the cluster\'s own token issuer, its signing keys and their discovery, which you operate and must keep reachable and rotated. That matters especially in isolated regions.' },
  refs: [
    { t: 'Configure Service Accounts for Pods (token projection, issuer discovery)', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/' },
    { t: 'Projected Volumes', u: 'https://kubernetes.io/docs/concepts/storage/projected-volumes/' },
    { t: 'Service Accounts', u: 'https://kubernetes.io/docs/concepts/security/service-accounts/' }
  ],
  verify: 'Air-gapped options (hosting discovery documents vs uploading keys) depend on the cloud provider; confirm with that provider\'s documentation.'
}

);
