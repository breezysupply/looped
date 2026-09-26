/* Onsite track — delivery questions: digests, pull credentials, disconnected dependencies, trust chains,
   GitOps, progressive rollout, admission policy and supply-chain evidence for air-gapped releases.
   Practice answers are generic: they do not describe any particular employer's stack. */
window.LX = window.LX || {};
LX.onsiteQ = LX.onsiteQ || [];
LX.onsiteQ.push(

{ id: 'ons-q-delivery-03', track: 'onsite', topic: 'delivery', priority: 'P1', level: 1, mins: 3,
  prereqs: ['les-workloads', 'les-rollouts'],
  q: 'Why pin images by digest rather than tag?',
  context: 'You are reviewing a release process whose manifests reference images such as `registry.example/api:2.4.1`. The interviewer asks what you would change and why.',
  evaluates: [
    'Understands that a tag is a mutable pointer and a digest is a content address',
    'Can explain the rollback failure mode when a tag has been re-pushed',
    'Knows the difference between a multi-arch index digest and a per-platform manifest digest',
    'Keeps human-readable versioning without giving up the digest'
  ],
  spoken: 'A tag is a mutable pointer in the registry. Anyone with push rights can move `api:2.4.1` to different content, and nothing in Kubernetes warns you. A digest is a hash of the image manifest, so it is a content address: if the bits change, the digest changes.\n\nPinning by digest buys three things. First, every node runs the same image. With a tag, each node\'s runtime resolves the tag when it pulls, so two nodes pulling at different times can get different content. Second, rollback means something. If I roll back to `2.4.0` and someone re-pushed that tag, I get different bits from the ones I ran last week. Third, signatures and scan results attach to a digest, so policy can check exactly what runs.\n\nMulti-arch images have a wrinkle: there is an index digest and a separate manifest digest per platform. I pin the index digest so each node selects its own platform, and I make sure I know which of the two my signatures cover. For readability I write both, `api:2.4.1@sha256:...`. Kubernetes pulls by the digest and the tag is there for humans.',
  deep: 'An image reference has up to three parts: repository, tag, digest. The registry keeps a mapping from tag to manifest digest, and that mapping can be overwritten by a push. The manifest lists the config blob and each layer by their own digests, so a manifest digest transitively pins every byte of the image. When a reference contains a digest, the Kubernetes images documentation notes that only the digest is used for pulling, even if a tag is also present.\n\nTag references interact badly with pull policy. By default, a tag other than `latest` gets `IfNotPresent`, so a node that already has an old copy of `api:2.4.1` keeps using it while a new node pulls whatever the tag points at today. That is how a fleet ends up running mixed content under one version label, and it is invisible in the Deployment spec. `kubectl get pod -o jsonpath` on `status.containerStatuses[*].imageID` shows what each container actually resolved to, which is the evidence you use to prove or disprove drift.\n\nRollback is the sharpest case. `kubectl rollout undo` restores the previous pod template, which contains the image reference string. If that string is a tag and the tag has moved, the undo brings back a name, not the bits you previously ran. With a digest, undo returns to exactly the previous content.\n\nMulti-architecture images are published as an image index (manifest list) that points to one manifest per platform. The index has its own digest. Pin the index digest when nodes may differ in architecture; pinning a single platform digest on a mixed cluster can fail to run on the other architecture. Signing tools can sign either level, so know which one your verification policy expects.\n\nReadable versioning survives through `name:tag@digest` references, a release manifest that maps version to digest, and OCI labels or annotations recording the version and source commit. Build tooling resolves tags to digests once, at release time, and writes the digests into the rendered manifests. Note what a digest does not do: it proves the content is the content you named, not who built it. Publisher authenticity needs a signature checked against a trusted key.',
  followups: [
    { q: 'Your team pins digests, but a developer says it makes image updates painful. How do you keep it workable?',
      guidance: 'Automate the resolution: the pipeline resolves tag to digest at release time and writes it into manifests or values, ideally with a bot that proposes updates. Keep the tag alongside for readability. Humans should never hand-edit digests. The release manifest records version, digest and source commit together.' },
    { q: 'How would you prove whether every replica of a Deployment is running the same bits?',
      guidance: 'Compare `status.containerStatuses[].imageID` across pods, not `spec.containers[].image`, because the spec shows the reference and the status shows what the runtime resolved. Note that which digest is reported for multi-arch images can depend on the runtime, so compare like with like.' },
    { q: 'You pinned a platform manifest digest and pods on some nodes fail to start. What happened?',
      guidance: 'Probably a mixed-architecture cluster: the platform digest points at, for example, an amd64 manifest, and arm64 nodes cannot run it. Pin the index digest so the runtime selects the matching platform, and check that the signature policy verifies the digest you pinned.' }
  ],
  misconceptions: [
    'A version-number tag such as 2.4.1 is immutable. It is only immutable if the registry enforces tag immutability; that is a registry setting, not a Kubernetes guarantee.',
    'A digest proves who built the image. It proves content identity against a value you already trust; publisher authenticity needs a signature verified against a trusted key.',
    '`kubectl rollout undo` restores the previous image. It restores the previous pod template, which is only the previous image if the reference was a digest.'
  ],
  weak: [
    'Says "digests are more secure" without explaining mutability of tags',
    'Cannot explain why rollback to a tag can give different bits',
    'Treats a digest as a signature',
    'Ignores readability and operational cost, so the proposal sounds impractical'
  ],
  evidence: '$ kubectl get pods -l app=api -o jsonpath=\'{range .items[*]}{.spec.nodeName}{"  "}{.status.containerStatuses[0].imageID}{"\\n"}{end}\'\nnode-a  registry.example/api@sha256:9f1c...e2\nnode-b  registry.example/api@sha256:41ab...07   <- same tag, different bits\n\n# pinned reference: tag kept for humans, digest used for pulling\nimage: registry.example/api:2.4.1@sha256:9f1c...e2',
  rubric: {
    strong: [
      'Explains tag mutability and digest as content address in one or two sentences',
      'Gives the rollback-to-re-pushed-tag failure mode and the mixed-fleet failure mode',
      'Distinguishes index digest from platform digest and says which to pin',
      'Keeps readable versioning with tag@digest or a release manifest',
      'Notes a digest is integrity, not authenticity'
    ],
    acceptable: [
      'Relies on registry-enforced tag immutability plus digest recording at deploy time, with the trade-off stated',
      'Resolves tags to digests in the pipeline and stores the mapping in a release manifest'
    ],
    redFlags: [
      'Claims tags cannot change',
      'Claims a SHA-256 digest proves the publisher',
      'Recommends `latest` for production'
    ]
  },
  aws: { analogy: 'ECR tag immutability, and referencing an image by digest in an ECS task definition.',
    breaks: 'In Kubernetes, tag immutability is whatever your registry enforces; the cluster pins nothing for you. With a tag reference, each node\'s runtime resolves the tag when it pulls, so nodes can diverge, and `kubectl rollout undo` restores the reference string rather than the bits.' },
  refs: [
    { t: 'Images', u: 'https://kubernetes.io/docs/concepts/containers/images/' },
    { t: 'Deployments', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' }
  ],
  verify: 'Default imagePullPolicy rules, and which digest `imageID` reports for multi-arch images, can vary by Kubernetes version and container runtime; confirm on your cluster.'
},

{ id: 'ons-q-delivery-04', track: 'onsite', topic: 'delivery', priority: 'P1', level: 2, mins: 4,
  prereqs: ['les-identity', 'les-pod-lifecycle', 'les-disconnected'],
  labs: ['ons-lab-02'],
  q: 'How do image pull credentials and registry mirrors work in a cluster?',
  context: 'A team moved its images to an internal registry and now sees ImagePullBackOff. You are asked how the node gets credentials, where mirror configuration lives, and how you would tell the failures apart.',
  evaluates: [
    'Knows the kubelet and container runtime pull images, not the API server or a controller',
    'Can name pod imagePullSecrets, ServiceAccount imagePullSecrets and node-level credentials, and when each applies',
    'Understands mirror configuration is node-level runtime configuration',
    'Can compare rewriting image references with runtime mirrors for air-gapped sites',
    'Reads pod events to separate auth, not-found and reachability failures'
  ],
  spoken: 'The pull is done by the kubelet and the container runtime on the node the pod was scheduled to. So the credentials have to reach that node\'s runtime. There are three common routes. A pod can list `imagePullSecrets`: registry-credential Secrets in the pod\'s own namespace. A ServiceAccount can carry `imagePullSecrets`, and they are copied into pods created with that ServiceAccount after you add them. Existing pods do not change. Or the node authenticates itself, through runtime configuration or a kubelet credential provider plugin that fetches short-lived tokens.\n\nMirrors are a separate mechanism. They are usually node-level runtime configuration that says "when asked for registry A, try host B". The pod spec still says registry A. In an air-gapped site you choose between that and rewriting image references to the internal registry when you build the bundle. Rewriting is explicit and visible in the manifests. Mirroring keeps upstream names but hides the redirect in node config, which has to be identical on every node.\n\nWhen a pull fails, I read the pod events. A 401 or 403 is credentials. "Not found" is a missing image or a wrong path. A timeout or TLS error is reachability or CA trust on the node.',
  deep: 'The sequence: the scheduler binds the pod to a node; the kubelet on that node asks the container runtime to pull each image, supplying any credentials it has for that registry. Nothing in the control plane downloads images. That is why "the cluster can reach the registry" is not a meaningful statement; what matters is whether each node, with its runtime\'s configuration and trust store, can.\n\nCredentials come from three places. Pod `spec.imagePullSecrets` references Secrets of type `kubernetes.io/dockerconfigjson` in the same namespace, and a Secret in another namespace does nothing. ServiceAccount `imagePullSecrets` are injected into the pod spec at admission time, so adding a secret to a ServiceAccount affects pods created afterwards; running pods keep the spec they were admitted with. Node-level credentials are either static runtime configuration or a kubelet credential provider, an exec plugin the kubelet invokes for images matching configured patterns, typically to obtain short-lived registry tokens without storing long-lived Secrets in the cluster.\n\nMirrors live in container runtime configuration, for example containerd\'s per-registry host configuration. They are node state, not a Kubernetes API object, so changing them is a node rollout. Two traps: if the mirror fails, the runtime may fall back to the upstream host, which in an air-gapped site means a slow timeout rather than a clear error; and a private registry\'s TLS certificate must be trusted by the runtime on each node, which is also node-level configuration.\n\nRewriting versus mirroring. Rewriting image references (for example `upstream.example/app` to `registry.internal/app`) makes the dependency explicit and auditable in the manifests, and works identically on every node. It does require rewriting everything, including image references inside operator defaults and Helm hooks. Mirroring keeps manifests unchanged, which helps when upstream charts are hard to patch, but every node must be configured the same way and the redirect is invisible in the manifest. If content is copied byte-for-byte, the digest stays the same under the new name; tools that re-serialise or convert manifests can change it, which breaks digest pins and signature checks.\n\nDiagnosis: `kubectl describe pod` shows `Failed` events with the runtime\'s error, then `ErrImagePull`, then `ImagePullBackOff` while the kubelet backs off between retries. Read the first error, not the back-off. Check which `imagePullSecrets` the pod actually has (`-o jsonpath=\'{.spec.imagePullSecrets}\'`). If you have node access, pulling the same reference with the runtime\'s CLI isolates node configuration from Kubernetes.',
  followups: [
    { q: 'You added imagePullSecrets to the default ServiceAccount but pods still fail with 401. Why?',
      guidance: 'The injection happens at pod creation, so existing pods and pods retrying in a ReplicaSet created earlier keep their old spec; delete or roll the pods. Also check the pods actually use that ServiceAccount, that the Secret is in the same namespace, and that the credential is valid for that registry host.' },
    { q: 'The mirror is configured but pulls hang for minutes before failing. What is going on?',
      guidance: 'Likely the mirror is failing (wrong path, TLS trust, missing image) and the runtime falls back to the upstream registry, which is unreachable, so you wait for a connection timeout. Test the mirror directly from the node, check the runtime logs, and consider disabling upstream fallback where the runtime allows it.' },
    { q: 'Rewriting references to the internal registry broke your signature verification. Why?',
      guidance: 'Policies often match on image name or require the signature to be stored alongside the image; after rewriting, the signature may not have been copied or the policy pattern no longer matches. If the copy re-serialised the manifest, the digest changed and the signature no longer applies. Copy signatures with the images and write policies against the internal names.' }
  ],
  misconceptions: [
    'The API server or a controller pulls images. The kubelet and container runtime on the node do.',
    'Adding imagePullSecrets to a ServiceAccount fixes running pods. It affects pods created afterwards.',
    'A registry mirror is a Kubernetes object. It is typically node-level runtime configuration.',
    'ImagePullBackOff is the error. It is the back-off state; the cause is in the preceding Failed event.'
  ],
  weak: [
    'Says "check the registry" without saying which node or which error',
    'Does not know credentials must be in the same namespace as the pod',
    'Confuses mirroring (redirecting pulls) with replication (copying content)',
    'Stops at "ImagePullBackOff" without reading the underlying message'
  ],
  evidence: '$ kubectl describe pod api-7d9f-x2 | sed -n \'/Events/,$p\'\n  Warning  Failed   12s  kubelet  Failed to pull image "registry.internal/api@sha256:9f1c...": ... 401 Unauthorized\n  Warning  Failed   12s  kubelet  Error: ErrImagePull\n  Normal   BackOff  1s   kubelet  Back-off pulling image "registry.internal/api@sha256:9f1c..."\n\n$ kubectl get pod api-7d9f-x2 -o jsonpath=\'{.spec.serviceAccountName} {.spec.imagePullSecrets}\'\n$ kubectl get sa default -n shop -o jsonpath=\'{.imagePullSecrets}\'\n\n# on the node, runtime-specific: isolates node config from Kubernetes\n$ crictl pull registry.internal/api@sha256:9f1c...',
  rubric: {
    strong: [
      'Places the pull on the node (kubelet plus runtime)',
      'Explains pod, ServiceAccount and node-level credentials, including "pods created afterwards"',
      'Explains mirrors as node runtime config and compares with reference rewriting',
      'Uses event text to separate auth, not-found and network/TLS failures'
    ],
    acceptable: [
      'Prefers node-level credential providers over Secrets and explains why (short-lived tokens, fewer Secrets)',
      'Prefers reference rewriting for auditability and explains the cost'
    ],
    redFlags: [
      'Says the API server pulls images',
      'Suggests turning off TLS verification on the registry as the fix',
      'Treats ImagePullBackOff as the root cause'
    ]
  },
  aws: { analogy: 'The ECS task execution role pulling from ECR, and ECR replication or pull-through cache to get images closer to where they run.',
    breaks: 'There is no per-pod IAM role for image pulls by default: credentials are namespace Secrets or node-level providers. ECR replication copies images; a runtime mirror only redirects pulls on each node and copies nothing, so the internal registry still has to be populated.' },
  refs: [
    { t: 'Images: private registries and imagePullSecrets', u: 'https://kubernetes.io/docs/concepts/containers/images/' },
    { t: 'Add ImagePullSecrets to a ServiceAccount', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/' },
    { t: 'Kubelet image credential providers', u: 'https://kubernetes.io/docs/tasks/administer-cluster/kubelet-credential-provider/' }
  ],
  verify: 'Mirror configuration format, file location and upstream fallback behaviour are container-runtime and version specific (for example containerd host configuration); confirm for your runtime.'
},

{ id: 'ons-q-delivery-01', track: 'onsite', topic: 'delivery', priority: 'P1', level: 2, mins: 5,
  prereqs: ['les-disconnected', 'les-operators'],
  labs: ['ons-lab-10'],
  q: 'What dependencies must be available inside a disconnected environment for a Kubernetes release to install and run?',
  context: 'You are preparing a release of a Kubernetes-based service for a site with no internet access. Anything not carried in the bundle or already present on site does not exist there.',
  evaluates: [
    'Covers workload, cluster and platform layers rather than just "the images"',
    'Knows operators create operand images that may not appear in the chart',
    'Remembers the services the internet normally hides: DNS, time, CAs, trust roots',
    'Builds the inventory from rendered manifests and proves it with an egress-blocked install'
  ],
  spoken: 'I split it into layers and build the list from what will actually run, not from memory.\n\nThe workload layer is every container image, including init containers, sidecars and anything injected, each pinned by digest. It also includes the Helm charts or manifests and the CRDs they depend on. If there is an operator, I need its image and also the operand images it creates at runtime, which often appear nowhere in the chart because they sit in the operator\'s defaults.\n\nThe cluster layer is node OS packages, the Kubernetes and runtime versions, and in a lab something like the kind node image.\n\nThen there are the platform services the internet normally hides. DNS. NTP, because certificate and signature validation break when clocks drift. CA bundles and certificates, and the public keys or trust roots for verifying signatures. After that come licence files, a vulnerability database snapshot, the registry mirror configuration, the Python or npm packages our tooling needs, and the runbooks and docs, because nobody on site can browse to them.\n\nMy method is to render the manifests with the exact site values, extract every image reference and diff that against the bundle. Then I test-install in an isolated environment with egress blocked. That install is what catches the dependency nobody remembered.',
  deep: 'Why render instead of reading the chart: values toggle subcharts and sidecars, conditionals change image references, and Helm hooks run Jobs with their own images that never appear in the main templates. Rendering with the site\'s exact values file produces the real list. A second source of truth is a connected reference install: list every `imageID` running after install and compare with the rendered list, because the difference is exactly the set of images created at runtime.\n\nHidden image references are the common failure. Operators typically carry the images of what they manage as defaults or environment variables and create those pods later, so the install looks fine and the failure appears minutes afterwards, when the operator reconciles its first custom resource. Admission webhooks, CRD conversion webhooks, CNI and CSI plugin images, and the runtime\'s sandbox ("pause") image are other easy misses. The sandbox image is configured in the container runtime, not in any manifest, and a missing one blocks every pod on the node.\n\nCluster and node dependencies: the OS packages for the node image, the kubelet, runtime and CLI binaries at matching versions, kernel modules the CNI needs, and for local rehearsal, the kind node image and the images kind itself uses. Tooling dependencies are easy to forget: Python wheels built for the site\'s architecture and interpreter version, CLI binaries, and any plugin the operators expect.\n\nPlatform services: internal DNS for the registry and service names; a time source, because TLS validation, token expiry and signature timestamps all depend on correct clocks; the CA bundles clients need to trust internal endpoints; the public keys or trust roots for signature verification, distributed through a separate trusted channel; and licence files if software checks them. Also look for runtime calls out of the site, such as update checkers, telemetry, licence servers or certificate revocation endpoints, which fail or hang when egress is blocked.\n\nThe inventory itself should be an artifact: a machine-readable manifest listing each item with its source, digest, size and signature status, versioned with the release. The acceptance test is an install into an environment with egress denied, followed by watching for `ImagePullBackOff`, failed hook Jobs, CrashLoopBackOff from missing config, and connection timeouts in logs.',
  followups: [
    { q: 'The install succeeds, but ten minutes later new pods fail with ImagePullBackOff. What would you suspect first?',
      guidance: 'Images created at runtime rather than at install: operator operand images, Jobs from CronJobs or hooks, or autoscaled replicas landing on nodes without a cached image. Read the failing pod\'s owner and the exact image reference in the event, then check whether that reference was in the rendered inventory.' },
    { q: 'How would you make the dependency inventory trustworthy rather than a spreadsheet someone maintains?',
      guidance: 'Generate it from rendered manifests plus a reference install\'s running imageIDs, store it as a signed release manifest with digests, and fail the release pipeline if the bundle and the inventory disagree. The egress-blocked install is the test that keeps it honest.' },
    { q: 'Why does time synchronisation belong on a list of release dependencies?',
      guidance: 'Certificate validity, token expiry and signature timestamps are all checked against the local clock. A drifted clock can make valid certificates look expired or not-yet-valid and make verification fail, which looks like a broken release rather than a time problem.' }
  ],
  misconceptions: [
    'The chart lists every image. Operators, hooks and runtime-created pods reference images that may appear in no template.',
    'If images are present the release will run. DNS, time, CA trust, signing keys and licence files are also dependencies.',
    'A lab install on a connected laptop proves the bundle is complete. Only an install with egress blocked shows what the site will see.'
  ],
  weak: [
    'Lists only application images',
    'Builds the inventory from memory or documentation rather than rendered output',
    'Forgets that verification keys must arrive through a separate trusted channel',
    'No validation step before shipping'
  ],
  evidence: '# 1. render with the exact values the site will use, then extract image references\n$ helm template rel ./chart -f site-values.yaml > rendered.yaml\n$ grep -E \'^\\s*image:\' rendered.yaml | sort -u\n\n# 2. on a connected reference install, list what actually ran (includes runtime-created pods)\n$ kubectl get pods -A -o jsonpath=\'{..imageID}\' | tr \' \' \'\\n\' | sort -u\n\n# 3. diff (1)+(2) against the bundle manifest; then test-install with egress denied\n$ kubectl get events -A --field-selector type=Warning\n\n# not visible in manifests: sandbox (pause) image, CNI/CSI images, operator operand images,\n#   DNS, time source, CA bundles, verification keys, licence files, vuln DB snapshot, runbooks',
  rubric: {
    strong: [
      'Covers workload, cluster and platform layers, including DNS, time, CAs and trust roots',
      'Calls out operator operand images and hook images as hidden references',
      'Derives the inventory from rendered manifests and a reference install',
      'Validates with an egress-blocked install before shipping'
    ],
    acceptable: [
      'Uses a connected staging install as the primary source of truth, with the rendered diff as a cross-check',
      'Organises by lifecycle phase (install, runtime, day-2 operations) instead of by layer'
    ],
    redFlags: [
      'Only "copy the images over"',
      'Ships the verification key inside the same bundle it is meant to verify',
      'Assumes the site can reach the internet for "just one thing"'
    ]
  },
  aws: { analogy: 'Bringing a service up in a new region, where every AMI, ECR image, Lambda artifact and S3 asset must be copied in before the CloudFormation stacks will deploy.',
    breaks: 'In an AWS region, the platform supplies DNS, time sync, certificate services and service endpoints. In a disconnected Kubernetes site you usually carry or run those yourself, and operators pull operand images that no template lists.' },
  refs: [
    { t: 'Images', u: 'https://kubernetes.io/docs/concepts/containers/images/' },
    { t: 'Operator pattern', u: 'https://kubernetes.io/docs/concepts/extend-kubernetes/operator/' },
    { t: 'kind: Working offline', u: 'https://kind.sigs.k8s.io/docs/user/working-offline/' }
  ],
  verify: 'How the sandbox (pause) image is named and configured depends on the container runtime and its version; confirm for the runtime you ship.'
},

{ id: 'ons-q-delivery-06', track: 'onsite', topic: 'delivery', priority: 'P1', level: 2, mins: 4,
  prereqs: ['les-reconcile', 'les-operators', 'les-disconnected'],
  q: 'What does a GitOps controller actually do, and how does it behave in a disconnected environment?',
  context: 'No particular GitOps tool is assumed. The interviewer wants the mechanism, its limits, and what changes when the cluster cannot reach the internet.',
  evaluates: [
    'Describes the reconcile loop: source, render, diff, apply, prune, report',
    'Knows the controller does not pull images; the kubelet and runtime do',
    'Knows the source must be local in a disconnected site, and images must already be in the internal registry',
    'Handles CRD ordering and pausing reconciliation during incidents'
  ],
  spoken: 'A GitOps controller is a reconciler whose desired state lives outside the cluster. It watches a configured source, such as a Git repository or an OCI artifact, renders the manifests, compares them with the live objects and applies the difference. It reports drift when someone changes the cluster by hand, and depending on configuration it corrects the drift and prunes objects that were removed from the source.\n\nWhat it does not do is pull images. It writes Deployments and other objects to the API server. The kubelet and container runtime on each node still pull the images, so image availability and pull credentials are a separate problem.\n\nIn a disconnected site the source has to be local, meaning a mirrored Git server or an internal OCI registry. The images also have to be in the internal registry before the controller applies manifests that reference them. Otherwise you get a clean sync and a cluster full of ImagePullBackOff.\n\nOrdering matters too. CRDs must exist before the custom resources that use them, so I use the tool\'s ordering mechanism or split CRDs into their own sync.\n\nDuring an incident I pause automated sync for the affected app, or the controller will revert my mitigation. I commit the fix to the source before resuming.',
  deep: 'The loop is the same pattern as any Kubernetes controller, with the desired state held outside the API server: fetch the source at a revision, render it (plain manifests, Kustomize, Helm, depending on the tool), compute the difference from live objects, apply, optionally prune objects that are no longer in the source, and report two different things: sync status (does live match source) and health (did the resources become healthy by the tool\'s checks). A synced application can be unhealthy, and a healthy-looking one can still be wrong, because health usually means readiness, not correctness.\n\nImages are outside its job. The controller creates or updates a Deployment; the Deployment controller creates a ReplicaSet; the ReplicaSet creates pods; the scheduler places them; the kubelet asks the runtime to pull. The GitOps controller\'s own images, and its access to the source, are its only direct artifact dependencies. So in a disconnected site, the release order is: images and signatures into the internal registry, then the configuration source updated, then reconciliation.\n\nSource in a disconnected site: a mirrored Git repository with commits pinned, or an OCI artifact in the internal registry pinned by digest. Verify the source\'s integrity (signed commits or a signed artifact) against keys delivered through a trusted channel, because whoever can write to the source can change every cluster that follows it.\n\nOrdering: applying a custom resource before its CRD fails because the API server does not know the kind. Most tools offer ordering (waves, dependencies, separate applications); the generic fix is to install CRDs and operators first and wait for the CRD to be established. Pruning is the dangerous half of the loop: a wrong path or an empty render can look like "everything was deleted from the source". Use prune protections and treat an unexpectedly empty render as an error.\n\nIncidents: a continuously reconciling controller will overwrite manual changes. Each tool has a way to suspend automated sync per application; use it, record that you did, fix the source, then resume. Also expect legitimate drift, such as replica counts managed by an autoscaler or fields set by mutating webhooks, and configure the tool to ignore those fields rather than fighting them.',
  followups: [
    { q: 'The controller shows the application as synced and healthy, but users see errors. How is that possible?',
      guidance: 'Synced means live objects match the source; healthy typically means resources reached a Ready state by probes. Neither proves the application behaves correctly: the source may contain the bug, or probes may not exercise the failing path. Look at service-level signals and at what changed in the source revision.' },
    { q: 'A change to the source path makes the render empty. What happens, and how do you guard against it?',
      guidance: 'With pruning enabled, the controller may treat every resource as removed and delete them. Guards: refuse to apply an empty or drastically smaller render, require confirmation for large prunes, protect critical resources from pruning, and roll changes to the controller configuration through a canary cluster first.' },
    { q: 'How would you deliver configuration updates to a site that is reachable only through periodic transfers?',
      guidance: 'Package the configuration as a versioned, signed artifact (Git bundle or OCI artifact) alongside the images, verify on import, push to the local source, and let the local controller reconcile. Report sync and health status back through the next outbound transfer.' }
  ],
  misconceptions: [
    'GitOps controllers pull everything, including images, from a registry. They reconcile Kubernetes resources from a configured source; images are pulled by the kubelet and container runtime.',
    'Synced means working. It means live state matches the source.',
    'Manual fixes during an incident will stick. A reconciling controller will revert them unless sync is paused.'
  ],
  weak: [
    'Describes GitOps as "deploying from Git" with no mention of drift or pruning',
    'Assumes the controller can reach a public Git host from a disconnected site',
    'Does not consider CRD ordering',
    'Names one specific tool\'s features as if they were universal'
  ],
  evidence: 'source : oci://registry.internal/releases/shop-config@sha256:ab12...   (or a Git mirror at a pinned commit)\nloop   : fetch -> verify -> render -> diff(live) -> apply -> prune (if enabled) -> report sync + health\n\n# "synced" but broken: check what the kubelet and controllers saw\n$ kubectl get deploy -n shop\n$ kubectl get events -n shop --field-selector type=Warning\n$ kubectl get crd widgets.example.com -o jsonpath=\'{.status.conditions[?(@.type=="Established")].status}\'',
  rubric: {
    strong: [
      'Explains the reconcile loop including drift and pruning',
      'States that images are pulled by the kubelet and runtime, not the controller',
      'Explains local sources and image pre-staging for disconnected sites',
      'Covers CRD ordering and pausing sync during incidents'
    ],
    acceptable: [
      'Describes a push-based pipeline with drift detection, and compares it fairly with pull-based reconciliation',
      'Uses a specific tool as an example while keeping the explanation generic'
    ],
    redFlags: [
      'Says the controller pulls images',
      'Recommends disabling pruning everywhere without discussing the orphaned-resource cost',
      'Makes manual changes during incidents without pausing reconciliation'
    ]
  },
  aws: { analogy: 'CloudFormation stacks deployed from a pipeline, with drift detection.',
    breaks: 'CloudFormation detects drift when asked and changes resources only when you deploy. A GitOps controller runs continuously and actively reverts manual changes, including an incident mitigation, unless you pause it.' },
  refs: [
    { t: 'Declarative management with kubectl apply', u: 'https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/' },
    { t: 'CustomResourceDefinitions', u: 'https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/' }
  ],
  verify: ''
},

{ id: 'ons-q-delivery-02', track: 'onsite', topic: 'delivery', priority: 'P1', level: 2, mins: 5,
  prereqs: ['les-disconnected'],
  labs: ['ons-lab-10'],
  q: 'How do you verify a release and its trust chain without internet access?',
  context: 'A release bundle arrives at a disconnected site on removable media or through a one-way transfer. You must decide whether it can be imported, with no online service to ask.',
  evaluates: [
    'Separates integrity (same content) from authenticity (right publisher)',
    'Knows a hash only proves integrity relative to a value you already trust',
    'Distributes verification keys or identities through a separate trusted channel beforehand',
    'States offline limits: revocation, expiry, transparency logs',
    'Verifies before import and records provenance'
  ],
  spoken: 'I separate two questions: is this the same content that was released, and who released it.\n\nHashes answer only the first, and only relative to a value I already trust. If an attacker can swap the bundle, they can swap the checksum file next to it. So the release has a manifest that lists every artifact by digest, and the manifest is signed. The public key or signing identity reaches the site earlier, through a separate trusted channel. It is installed during site setup and is never shipped inside the bundle it is supposed to verify.\n\nOn the receiving side I verify the signature on the manifest, check each artifact\'s digest against the manifest, and only then import into the internal registry. Verification happens before import, not after something is already running.\n\nOffline, there are limits I state openly. I cannot check revocation live. Signing schemes that rely on an online transparency log need an offline verification mode or pre-distributed material. So I plan for key expiry and rotation, and carry an updated revocation list with each transfer.\n\nFinally I record provenance: who built the release, from which commit, which checks passed at import, and the digests admitted. That lines up with the air-gapped artifact transfer work I did at AWS.',
  deep: 'Integrity versus authenticity: a SHA-256 digest proves that the bytes match a reference digest. It says nothing about who produced the reference. A signature over a manifest of digests binds many artifacts to one signing key or identity, so authenticity reduces to one question: do I trust this key? That trust cannot come from the bundle itself; it comes from a trust root installed out of band, such as keys provisioned at site build, delivered on separate media, or confirmed by a fingerprint read over a separate channel.\n\nA practical chain: the build system signs images and attestations; the release process produces a manifest of every artifact (images, charts, CRDs, SBOMs, tools) with digests, and signs it, possibly with a separate release key so that no single compromised key is sufficient; the receiving site verifies the manifest signature with the pre-installed key, recomputes every digest, rejects the whole bundle on any mismatch, imports into the internal registry, and confirms the registry reports the same digests. Inside the cluster, an admission policy can verify image signatures again at deploy time, which protects against something added to the registry by another path.\n\nOffline limits: certificate-based signatures carry validity periods checked against the local clock, so time sync matters. Revocation can only be as fresh as the last revocation data carried in. Keyless schemes that depend on short-lived certificates and a public transparency log need either an offline-verifiable proof bundled with the signature or a different, key-based mode; support varies by tool. Long-lived keys offline mean key custody and rotation plans matter more than they do online.\n\nVerify the verifier: the verification tool and its configuration are also artifacts. Carry them through the same trusted channel as the keys, or verify them against a trusted digest, so a tampered tool cannot approve a tampered bundle.\n\nProvenance record: bundle identifier, manifest digest, verifying key identifier, results of each check, who performed the import and when, and the list of digests admitted. That record is what lets you answer "what is running here and where did it come from" months later.',
  followups: [
    { q: 'Someone proposes shipping the public key inside the bundle "for convenience". What is wrong with that?',
      guidance: 'Anyone who can replace the bundle can replace the key and re-sign, so the check verifies nothing. The key must come from a channel the attacker does not control and be installed before the bundle arrives. A key rotation can be delivered in a bundle only if the new key is signed by the currently trusted key.' },
    { q: 'A signing key is compromised. How do you handle that across disconnected sites?',
      guidance: 'Issue a revocation and a replacement key through the trusted channel, signed by a key the sites still trust (or by re-provisioning). Identify every release signed with the compromised key after the suspected time, re-sign or rebuild what is legitimate, and re-verify what is running. Expect a lag: each site is only as current as its last transfer.' },
    { q: 'Why verify again with admission policy inside the cluster if the bundle was verified on import?',
      guidance: 'Import verification protects one path. Admission verification protects the point of execution against images added by other paths, mistakes, or registry tampering after import. The two layers answer different questions and fail differently.' }
  ],
  misconceptions: [
    'A matching SHA-256 authenticates the publisher. It proves integrity only against a value you already trust.',
    'A signature is meaningful on its own. It needs a trusted key or identity distributed separately.',
    'Offline verification is the same as online verification. Revocation freshness, time sync and transparency logs all behave differently.'
  ],
  weak: [
    'Only mentions checksums',
    'Cannot say where the verification key comes from',
    'Verifies after import or after deployment',
    'Ignores key rotation and revocation'
  ],
  evidence: 'release-2.4.1/\n  manifest.json        # every artifact: name, digest, size\n  manifest.json.sig    # signature over manifest.json\n  images/  charts/  crds/  sbom/  attestations/\n\nreceiving side, before import:\n1. verify manifest.json.sig with the pre-installed key (never a key from the bundle)\n2. sha256sum every file and compare with manifest.json; any mismatch -> reject the whole bundle\n3. import to the internal registry; confirm the registry digests equal the manifest digests\n4. write an import record: bundle id, key id, check results, operator, time, admitted digests',
  rubric: {
    strong: [
      'Separates integrity from authenticity explicitly',
      'Signed manifest of digests, with keys distributed out of band beforehand',
      'Verification before import, whole-bundle rejection on mismatch',
      'States offline limits (revocation, expiry, transparency log) with hedges',
      'Records provenance'
    ],
    acceptable: [
      'Uses multiple independent signatures (build and release) as defence in depth',
      'Relies on per-image signatures verified by admission, with the bundle manifest as the transfer-level check'
    ],
    redFlags: [
      'Treats a hash as proof of origin',
      'Ships the trust root in the same bundle',
      'Skips verification because the transfer medium is "trusted"'
    ]
  },
  aws: { analogy: 'AWS Signer with Lambda code signing, or signing artifacts with KMS asymmetric keys.',
    breaks: 'In AWS the trust root, key policy and revocation are online services consulted at deploy time. Offline, you distribute key material yourself, revocation is only as fresh as the last data you carried in, and there is no service to ask.' },
  refs: [
    { t: 'Verify signed Kubernetes artifacts', u: 'https://kubernetes.io/docs/tasks/administer-cluster/verify-signed-artifacts/' },
    { t: 'Images', u: 'https://kubernetes.io/docs/concepts/containers/images/' }
  ],
  verify: 'Offline verification of transparency-log-backed (keyless) signatures depends on the signing tool and version; confirm what your tool can verify without network access.'
},

{ id: 'ons-q-delivery-07', track: 'onsite', topic: 'delivery', priority: 'P1', level: 2, mins: 5,
  prereqs: ['les-rollouts', 'les-probes'],
  q: 'How do you roll out a change to many environments safely, and what are your rollback criteria?',
  context: 'You own a change that must reach dozens of clusters or environments. The interviewer wants the rollout plan, the gates between steps, and when and how you would roll back.',
  evaluates: [
    'Uses progressive waves with a canary and bake time',
    'Knows a successful rollout proves pods became Ready, not that the application is correct',
    'Defines halt criteria in advance and automates them, including missing data',
    'Knows rollback limits for data, schema and CRDs',
    'Makes scoping fail closed: an empty target set must not mean "everything"'
  ],
  spoken: 'I roll out in waves. First a canary environment that sees real but limited traffic, then small batches, then the rest. Between waves there is a bake time long enough to catch slow failures such as memory growth, batch jobs or the daily traffic peak.\n\nThe gate between waves is not "rollout complete". A completed rollout only says the pods became Ready by their probes; it says nothing about whether responses are correct. So the gate is service health: error rates, latency, business-level checks and synthetic transactions, compared with the previous version and with the environments not yet changed. Halt criteria are written before the rollout and evaluated automatically, and if telemetry is missing the default is to stop, not proceed.\n\nRollback has limits I state up front. Reverting the pod template does not revert a schema migration, data written in a new format, or a CRD change. So I split risky changes: expand the schema first, deploy code that works with both versions, contract later.\n\nScoping must fail closed. If the target list or selector resolves to nothing because of a bug, the automation refuses; it never treats that as "everything". This is where my controlled-deployment experience applies most directly.',
  deep: 'Waves limit blast radius in space; bake time limits it in time. Order waves by risk and by independence: never change both halves of a redundant pair in the same wave, start where impact is smallest and observability is best, and make later waves larger only after earlier ones have seen real load. Bake long enough to cover the failure modes you expect: leaks, scheduled jobs, certificate or token refresh intervals, traffic peaks.\n\nHealth signals beyond rollout status: a Deployment rollout completes when the new ReplicaSet\'s pods are available by their readiness probes. Probes usually test "can this process serve", not "is the answer right". Gate on symptoms users would notice (error rate, latency, failed transactions), compare against the pre-change baseline and against unchanged environments at the same time of day, and include synthetic checks that exercise real paths.\n\nAutomated halt: define thresholds and the action (pause the wave, alert the owner, optionally roll back) before starting. Treat absent telemetry as its own condition that halts progress, because "no errors reported" from a site that stopped reporting is not evidence of health.\n\nRollback limits: `kubectl rollout undo` switches the Deployment back to the previous ReplicaSet\'s pod template. It does not restore ConfigMaps or Secrets the pods read (unless they are versioned by name), CRDs, database schema, or data written by the new version. A Deployment exceeding `progressDeadlineSeconds` is marked as not progressing; it does not roll itself back. Use expand-and-contract for schema, feature flags to separate deploy from release, and make sure the previous version can read anything the new version writes.\n\nScoping: in Kubernetes label-selector semantics an empty selector matches all objects, which is the opposite of what a rollout script intends when a variable is unexpectedly empty. Resolve targets explicitly, print them, check the count against an expected range, and abort on zero or on more than expected.',
  followups: [
    { q: 'Wave 2 shows a small error-rate increase that is within your threshold, but it did not appear in wave 1. What do you do?',
      guidance: 'Pause and investigate rather than proceed on a technicality: a new signal that appears only in a larger or different population can be environment-specific. Compare wave 2 environments with unchanged peers, check what differs (data, traffic mix, versions), and decide whether to tighten the threshold. Record the decision.' },
    { q: 'The new version wrote data in a new format before you noticed a bug. Rollback of the Deployment is done. Are you safe?',
      guidance: 'Not necessarily: the old version may fail on the new data. You need a forward fix or a data migration, which is why the design should have made the previous version tolerant of the new format first. Rollback criteria should include "is the data compatible in both directions".' },
    { q: 'How do you stop a bad rollout if the automation driving it is itself broken?',
      guidance: 'An independent kill switch: a flag or lock the automation checks before every wave that humans can set without the automation\'s cooperation, plus the ability to pause Deployments directly (`kubectl rollout pause`) and to pause the GitOps sync if one is in use.' }
  ],
  misconceptions: [
    'A successful rollout proves the application is correct. It proves pods became Ready by their probes.',
    '`kubectl rollout undo` restores everything. It restores the previous pod template only.',
    'A Deployment rolls back automatically when it fails. Exceeding the progress deadline marks a condition; nothing rolls back unless you or your tooling do it.',
    'An empty selector matches nothing. In Kubernetes label-selector semantics it matches everything.'
  ],
  weak: [
    'Uses "all pods Ready" as the only gate',
    'Has no halt criteria defined in advance',
    'Assumes rollback is always possible',
    'Does not mention blast radius or wave ordering'
  ],
  evidence: 'wave plan  : canary (1 env) -> wave 1 (~5%) -> wave 2 (~25%) -> remainder\nper wave   : bake >= one traffic peak; compare error rate, latency, synthetics vs baseline and vs unchanged envs\nhalt if    : errors > baseline + X | p99 > Y | synthetic failure | telemetry missing  -> stop, page owner\nscope check: targets = resolve(selector); abort if len(targets) == 0 or len(targets) > expected_max\n\n$ kubectl rollout status deploy/api --timeout=10m   # proves Ready, not correct\n$ kubectl rollout undo deploy/api                    # previous pod template only',
  rubric: {
    strong: [
      'Waves with canary, bake time and independence between waves',
      'Health gates based on service symptoms, not rollout completion',
      'Pre-agreed automated halt criteria, with missing telemetry halting',
      'Rollback limits for data, schema and CRDs, with expand-and-contract',
      'Fail-closed scoping'
    ],
    acceptable: [
      'Blue-green per environment with traffic switching, if the answer covers data compatibility',
      'Feature-flag-driven release with code deployed dark, if flags are themselves rolled out progressively'
    ],
    redFlags: [
      'Deploys everywhere at once because "tests passed"',
      'Treats rollout complete as proof of correctness',
      'No plan for irreversible changes'
    ]
  },
  aws: { analogy: 'CodeDeploy deployment configurations with CloudWatch alarm-based automatic rollback, and CloudFormation stack rollback.',
    breaks: 'A Deployment has no built-in alarm-driven rollback; exceeding the progress deadline only sets a condition. `kubectl rollout undo` restores the previous pod template, not ConfigMaps, CRDs, schema or data. CloudFormation rollback cannot undo data changes either, so that limitation is shared.' },
  refs: [
    { t: 'Deployments: rolling back, progress deadline', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' },
    { t: 'kubectl rollout undo', u: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/' }
  ],
  verify: 'Default progressDeadlineSeconds is 600 per the current Deployment docs; confirm for your cluster version.'
},

{ id: 'ons-q-delivery-05', track: 'onsite', topic: 'delivery', priority: 'P1', level: 3, mins: 5,
  prereqs: ['les-reconcile', 'les-workloads', 'ons-q-delivery-02'],
  labs: ['ons-lab-02'],
  q: 'How can a cluster refuse to run unsigned or untrusted images?',
  context: 'You need to enforce that only images signed by your release process run in workload namespaces. No particular policy engine is assumed.',
  evaluates: [
    'Places enforcement at admission, via a validating webhook or policy engine',
    'Knows denial shows as FailedCreate on the ReplicaSet and pods never appear',
    'Reasons about failurePolicy: fail-open versus fail-closed',
    'Plans exemptions, break-glass and key rotation'
  ],
  spoken: 'The enforcement point is admission control in the API server. A validating admission webhook, or a policy engine built on one, sees each pod create request and checks the image references. Typically it checks that each image is referenced by digest, comes from an allowed registry, and has a valid signature from a trusted key. If not, the API server rejects the request.\n\nThe part people miss is where that denial shows up. You apply a Deployment and it succeeds, because the Deployment object is fine. The ReplicaSet controller then tries to create pods and is rejected. So you see FailedCreate warnings on the ReplicaSet and no pods at all: not Pending, not ImagePullBackOff, just absent.\n\nThe big design decision is the failure policy. Fail-closed means that if the webhook is down, pod creation stops everywhere the policy applies, including pods that might repair things. Fail-open means an outage of the verifier quietly admits unverified images. I usually choose fail-closed for workload namespaces, exempt the system namespaces and the verifier itself so the cluster can recover, and keep a documented, audited break-glass path.\n\nKey rotation needs an overlap: trust both the old and new keys, re-sign, then remove the old key.',
  deep: 'Admission runs after authentication and authorisation and before the object is persisted. Mutating admission runs first (a policy might resolve a tag to a digest here), then validating admission. Webhooks are called over HTTPS by the API server; in-process validating admission policies (CEL expressions) can check things like "image must contain @sha256:" or "registry must be registry.internal" without a webhook, but cryptographic signature verification usually needs a webhook that can fetch and check signatures.\n\nWhere the denial lands: admission applies to the request that creates the pod. For a Deployment, that request comes from the ReplicaSet controller, so the error appears as a `FailedCreate` event on the ReplicaSet, and the Deployment gets a `ReplicaFailure` condition. `kubectl get pods` shows nothing new. Engineers who only look at pods conclude "nothing happened".\n\nFailure policy: the webhook configuration\'s `failurePolicy` decides what happens when the webhook cannot be reached or errors; the Kubernetes docs give `Fail` as the default. An explicit rejection always denies regardless of that setting. Fail-closed makes the verifier part of the cluster\'s critical path, so run it with multiple replicas, a PodDisruptionBudget, a priority class, and a short timeout, and scope it with `namespaceSelector` and `objectSelector` so that kube-system and the verifier\'s own namespace are excluded. Otherwise a verifier outage can prevent the verifier from being rescheduled.\n\nAdmission is evaluated at create and update time. Pods admitted before a key was revoked keep running until they are recreated. Periodic audits of running images against current policy close that gap.\n\nKey rotation: add the new key to the trusted set, start signing with it, re-sign the images you still run, confirm nothing depends on the old key, then remove it. Break-glass: a narrowly scoped exemption (a label or namespace the policy skips) that only a small group can apply, which alerts when used and expires.',
  followups: [
    { q: 'The verifier webhook\'s pods are evicted during a node failure and cannot come back. Why, and how do you prevent it?',
      guidance: 'With fail-closed and no exemption for its own namespace, creating the verifier\'s replacement pods requires the verifier, which is down. Exclude the verifier namespace and system namespaces via namespaceSelector, run multiple replicas across nodes with a PDB and priority class, and document a break-glass to change the failure policy.' },
    { q: 'How would you roll out this policy to a cluster that already runs many unsigned images?',
      guidance: 'Start in audit or warn mode to inventory violations, sign or replace images, then enforce namespace by namespace. Keep a report of running images that would be denied, because enforcement only acts when pods are recreated.' },
    { q: 'Why is checking for "@sha256:" in the image reference not enough?',
      guidance: 'It proves the reference is pinned, not that the content is trusted. Anyone could push an image and reference its digest. You still need a signature over that digest verified against a trusted key, or an allowed-registry rule backed by controlled write access.' }
  ],
  misconceptions: [
    'A policy denial shows up as a failing pod. The pod is never created; the error is a FailedCreate event on the ReplicaSet.',
    'Fail-open is safer for availability with no downside. It silently admits unverified images whenever the verifier is unavailable.',
    'A signature check is meaningful without a trusted key. It needs a trust root distributed separately.',
    'Enforcing the policy removes untrusted pods already running. Admission applies at create and update time.'
  ],
  weak: [
    'Proposes scanning images in CI as the only control',
    'Does not know where denial evidence appears',
    'Chooses a failure policy without discussing the trade-off',
    'Forgets system namespace exemptions'
  ],
  evidence: '$ kubectl apply -f deploy.yaml\ndeployment.apps/api configured             # accepted: the Deployment itself is valid\n$ kubectl get pods -l app=api              # no new pods appear\n$ kubectl describe rs api-6c9d8f | sed -n \'/Events/,$p\'\n  Warning  FailedCreate  8s  replicaset-controller  Error creating: admission webhook "verify-images.example.com" denied the request: signature not verified for registry.internal/api@sha256:41ab...\n$ kubectl get deploy api -o jsonpath=\'{.status.conditions[?(@.type=="ReplicaFailure")].message}\'',
  rubric: {
    strong: [
      'Admission-time enforcement via validating webhook or policy engine',
      'Describes FailedCreate on the ReplicaSet and absent pods',
      'Weighs fail-open versus fail-closed and mitigates the chosen risk',
      'Covers exemptions for system namespaces and the verifier, break-glass and key rotation'
    ],
    acceptable: [
      'Uses in-process CEL policies for registry and digest rules plus a webhook only for signatures',
      'Enforces at the registry (only signed images can be pushed or pulled) and explains why admission is still valuable'
    ],
    redFlags: [
      'Fail-closed with no exemptions and no recovery path',
      'Trusts a signature without saying which key or identity it is verified against',
      'Assumes existing pods are removed by the policy'
    ]
  },
  aws: { analogy: 'Lambda code signing configuration, with an untrusted-artifact policy of Warn or Enforce.',
    breaks: 'Lambda checks signatures at deploy time inside a managed service. In Kubernetes the verifier is a webhook you run, so its availability becomes part of the cluster\'s control path, and the rejection lands on the controller creating pods (the ReplicaSet) rather than on the object you applied.' },
  refs: [
    { t: 'Dynamic admission control', u: 'https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/' },
    { t: 'Validating Admission Policy', u: 'https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/' },
    { t: 'ReplicaSet', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/' }
  ],
  verify: 'Event message wording varies by version and policy engine; ValidatingAdmissionPolicy availability depends on cluster version.'
},

{ id: 'ons-q-delivery-08', track: 'onsite', topic: 'delivery', priority: 'P1', level: 3, mins: 5,
  prereqs: ['les-disconnected', 'ons-q-delivery-02'],
  q: 'How would you handle vulnerability scanning, SBOMs and provenance for artifacts that go into air-gapped environments?',
  context: 'Your images are built on a connected build system and run in sites that receive periodic transfers. Security wants to know what is running and whether it is vulnerable.',
  evaluates: [
    'Generates SBOM and provenance at build and signs them as attestations bound to digests',
    'Ships attestations with the bundle and verifies them with the same trust root',
    'Understands that the scanner database inside is an imported, stale snapshot, and records its date',
    'Has an exception policy with owners and expiry',
    'States that provenance is only as trustworthy as the builder'
  ],
  spoken: 'I generate the SBOM and provenance at build time, when the builder actually knows what went in, and sign them as attestations bound to the image digest. They travel in the same bundle as the images, listed in the signed manifest, so they are verified with the same trust root on the other side.\n\nScanning is where air gaps bite. A scanner is only as current as its vulnerability database, and inside the site that database is a snapshot I imported. So every scan result records the database date, and I re-scan inside after each database import, because an image that was clean at build time can have known vulnerabilities a month later. The SBOM makes that cheaper: I can match a new advisory against SBOMs without re-scanning every image.\n\nExceptions need a policy: who can accept a finding, for how long, recorded with an expiry date. The alternative is someone quietly disabling the gate.\n\nAnd I am explicit about the limit. Provenance tells you what the build system claims. If the builder or its signing key is compromised, the attestation is signed, valid and wrong. So builder isolation and key protection matter as much as the documents.',
  deep: 'Build-time generation: the SBOM (in a standard format such as SPDX or CycloneDX) lists packages and versions in the image; provenance records source repository and commit, build inputs, builder identity and time. Both are most accurate when produced by the build itself rather than reconstructed by scanning afterwards. Signing them as attestations over the image digest binds the claims to exactly one artifact. The Kubernetes project, for example, publishes signed SPDX documents alongside its release artifacts.\n\nTransfer: attestations are artifacts. List them in the release manifest with their digests, verify them on import with the same pre-distributed trust root, and store them next to the images in the internal registry or an evidence store, so admission policy can require their presence if you choose.\n\nScanning offline: the scanner\'s vulnerability database must be imported through the same controlled channel and is stale from the moment it is exported. Record scanner version and database snapshot date in every report, set a maximum age after which results are flagged, re-scan every running digest after each import, and diff against the previous report so that new findings are visible. Also scan at build time on the connected side, so the bundle arrives with a baseline report.\n\nExceptions: a record per finding with justification (not reachable, not present in the runtime path, compensating control), an owner, an expiry, and a review date. Standard formats exist for "not affected" statements; the key is that exceptions are data with expiry, not a disabled check.\n\nLimits: SBOMs miss what the generator cannot see (statically linked code, copied binaries). Provenance is a claim signed by the builder, so a compromised builder produces valid-looking lies; mitigations are isolated, ephemeral build environments, protected signing keys, and reproducible builds where practical.',
  followups: [
    { q: 'A critical advisory lands. How do you find out which disconnected sites are affected?',
      guidance: 'Query the SBOMs you hold centrally for the affected package and version to get a list of digests, then map digests to sites using the import records and the last reported running inventory. Sites whose reports are old are "unknown", not "safe". Send a targeted rescan and updated DB with the next transfer.' },
    { q: 'Why not just scan inside the site and skip build-time SBOMs?',
      guidance: 'A scan inside depends on a stale DB and on what the scanner can infer from the image; a build-time SBOM records what the builder actually used. Build-time data also lets you answer questions centrally without waiting for the site. Doing both gives you a baseline and a current view.' },
    { q: 'Security asks you to block deployment of any image with a critical finding. What problems do you anticipate?',
      guidance: 'Findings change as the DB updates, so an image that was admitted can become non-compliant, and a strict gate can block emergency fixes. Pair the gate with an expiring exception process, evaluate against a recorded DB date, and decide in advance how running workloads are handled when new findings appear.' }
  ],
  misconceptions: [
    'A clean scan means the image is safe. It means no known issue matched in that database snapshot, on that date.',
    'Signed provenance proves the build was honest. It proves the builder\'s key signed the claim.',
    'An SBOM is complete. It lists what the generator could detect.'
  ],
  weak: [
    'Treats scanning as a one-time build step',
    'Does not record database age',
    'No exception process, or exceptions with no expiry',
    'Assumes attestations need no verification on arrival'
  ],
  evidence: 'bundle/attestations/api@sha256-9f1c.../\n  sbom.spdx.json         (signed, bound to the image digest)\n  provenance.json        (signed: source commit, builder id, build time)\n  scan-baseline.json     (scanner version, DB snapshot date)\n\ninside the site, after each DB import:\n  rescan every running digest -> diff with last report -> triage new findings -> record DB date\n$ kubectl get pods -A -o jsonpath=\'{..imageID}\' | tr \' \' \'\\n\' | sort -u   # what is actually running',
  rubric: {
    strong: [
      'Build-time SBOM and provenance, signed and bound to digests',
      'Shipped and verified with the bundle under the same trust root',
      'Records DB date and re-scans inside after each import',
      'Exception policy with owners and expiry',
      'States the builder-integrity limit'
    ],
    acceptable: [
      'Central SBOM query as the primary response to advisories, with in-site rescans as confirmation',
      'Admission policy requiring attestations, with the operational trade-offs described'
    ],
    redFlags: [
      'Presents scan results without a database date',
      'Claims provenance guarantees the build was not tampered with',
      'Allows permanent exceptions without review'
    ]
  },
  aws: { analogy: 'Amazon Inspector scanning of ECR images, which re-evaluates images as new vulnerabilities are published.',
    breaks: 'Inspector\'s vulnerability data is updated continuously by the service. Offline, the database is a snapshot you imported, rescans happen only when you run them, and findings are only as fresh as that snapshot.' },
  refs: [
    { t: 'Verify signed Kubernetes artifacts', u: 'https://kubernetes.io/docs/tasks/administer-cluster/verify-signed-artifacts/' },
    { t: 'Images', u: 'https://kubernetes.io/docs/concepts/containers/images/' }
  ],
  verify: ''
}

);
