/* Onsite track — incident labs on the reconciling cluster model (k8s-model.js).

   Every lab is a sandbox mission with an `onsite` block. The sandbox reads that
   block to offer two modes: Guided (named ticket, visible objectives, scenario
   command palette, labelled hint ladder) and Independent (neutral ticket, hidden
   objectives, generic palette). Objectives are one of three stages:

     evidence  a command produced the output that proves something
     fix       the MODEL STATE is repaired — typed strings never satisfy it
     verify    the state is repaired AND the command just run shows it

   Nothing depends on command order; wrong fixes leave `fix` unmet; risky
   actions are logged by the model for the debrief rather than blocked.
   tests/data/test-onsite-labs.js plays each lab through several paths. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.missions = LX.missions || [];

(function () {
  var K = function () { return window.LXK8s; };
  function M(c) { return c.w.k8sModel; }
  function podsOf(c, app) {
    return M(c).pods.filter(function (p) { return !p.gone && (p.labels || {}).app === app; });
  }
  /* reveals name a real pod from the current state, never a placeholder */
  function notReady(p) { return !K().podReady(p); }
  function restarted(p) { return p.containers.some(function (x) { return x.restarts > 0; }); }
  function podName(c, app, pred) {
    var ps = podsOf(c, app), hit = pred ? ps.filter(pred)[0] : null;
    return (hit || ps[0] || { name: app }).name;
  }
  function readyOf(c, app) { return podsOf(c, app).filter(function (p) { return K().podReady(p); }).length; }
  function dep(c, name) { return K().find(M(c), 'deployments', name, M(c).ns); }
  function complete(c, name) { return K().rolloutComplete(M(c), name, M(c).ns); }
  /* the command that just ran matches — how verify objectives insist on
     checking AFTER the repair rather than at any point */
  function lastIs(c, cmdRe, outRe) {
    var i = c.ran.length - 1;
    if (i < 0 || !cmdRe.test(c.ran[i])) return false;
    return !outRe || outRe.test(c.out[i] || '');
  }
  function lastOk(c, cmdRe, outRe) { return lastIs(c, cmdRe, outRe) && (c.code[c.ran.length - 1] || 0) === 0; }
  /* a container has stayed up long enough to trust it (probes and OOM
     both take tens of seconds to show) */
  function stable(c, app, secs) {
    var ps = podsOf(c, app);
    /* uptime, not restart count: a crash or a probe kill resets startedAt,
       and a fix that needs no new pods (a ConfigMap) keeps the old count */
    return ps.length > 0 && ps.every(function (p) {
      return K().podReady(p) && p.containers.every(function (x) {
        return x.state === 'running' && M(c).clock - x.startedAt >= (secs || 60);
      });
    });
  }
  var GET = /kubectl\b.*\bget\b/, DESC = /kubectl\b.*\bdescribe\b/;
  var GENERIC = ['kubectl get pods', 'kubectl get deploy', 'kubectl get events', 'kubectl describe pod ',
    'kubectl describe deploy ', 'kubectl logs ', '--previous', 'kubectl get svc', 'kubectl get endpoints',
    '-o wide', '-o yaml', 'kubectl rollout status deploy/', 'kubectl auth can-i ', 'kubectl top pod'];
  var SIMPLIFIED = [
    'One namespace, a few nodes, and a logical clock: every command you run advances time by 10 seconds, so waiting means running another read-only command.',
    'Controllers are simplified: first-fit scheduling, no informer lag, no watch (-w prints one snapshot).',
    'The network is modelled only as far as DNS names, Service ports, ready endpoints and target ports — there are no packets, MTUs or NetworkPolicies.',
    'Output layouts follow real kubectl closely but not byte-for-byte; ages and names are deterministic so the lab can be replayed.',
    'Only the documented command set is supported; anything else says so rather than pretending to work.'
  ];
  function simNodes(n, extra) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(Object.assign({ name: 'node-' + 'abc'.charAt(i), cpu: 4000, mem: 8192 }, extra || {}));
    return out;
  }
  function world(k8s, files) {
    return { user: 'lab', host: 'onsite-sim', cwd: '/home/lab', files: files || [], k8sModel: k8s };
  }

  /* ═══ 1. Replica reconciliation after pod deletion ═══════════════ */
  LX.missions.push({
    id: 'ons-lab-01', track: 'onsite', cat: 'lab', level: 'beginner', mins: 12, kind: 'incident',
    title: 'Pods were deleted during an alert — did we lose capacity?',
    brief: 'Overnight, during a noisy alert, someone ran a delete against the catalog pods "to restart them". A stakeholder now asks whether catalog lost capacity, whether anyone needs to recreate the pods, and why a debugging pod someone else deleted last week never came back. Recent changes: none to catalog in 3 days. Answer with evidence, then demonstrate the behaviour safely.',
    keys: ['kubectl get deploy', 'kubectl get rs', 'kubectl get pods -o wide', 'kubectl describe pod ', 'kubectl get events',
      'kubectl delete pod ', 'kubectl describe pod catalog-debug', 'kubectl get pods -l app=catalog'],
    world: world({
      namespace: 'storefront', context: 'lab-sim',
      nodes: simNodes(2),
      registry: { 'registry.lab/catalog:3.2.0': { arch: ['amd64'] }, 'registry.lab/cart:1.8.1': { arch: ['amd64'] },
                  'registry.lab/toolbox:1.0': { arch: ['amd64'] } },
      apps: { 'registry.lab/catalog': { port: 8080, readyPath: '/ready', livePath: '/live', startSec: 6, memMi: 120, boot: ['catalog listening on :{port}'] },
              'registry.lab/cart': { port: 8080, readyPath: '/ready', livePath: '/live', startSec: 4, memMi: 90, boot: ['cart listening on :{port}'] },
              'registry.lab/toolbox': { port: 8080, readyPath: '/', livePath: '/', startSec: 1, memMi: 10, boot: ['sleeping'] } },
      deployments: [
        { name: 'catalog', replicas: 3, selector: { app: 'catalog' }, history: [{ labels: { app: 'catalog' }, containers: [{ name: 'catalog', image: 'registry.lab/catalog:3.2.0', ports: [{ name: 'http', containerPort: 8080 }], readiness: { path: '/ready', port: 8080 }, resources: { requests: { cpu: '200m', memory: '256Mi' }, limits: { memory: '512Mi' } } }] }] },
        { name: 'cart', replicas: 2, selector: { app: 'cart' }, history: [{ labels: { app: 'cart' }, containers: [{ name: 'cart', image: 'registry.lab/cart:1.8.1', readiness: { path: '/ready', port: 8080 } }] }] }
      ],
      pods: [
        { name: 'catalog-debug', at: 4800, labels: { app: 'catalog-debug', owner: 'jlee' }, spec: { containers: [{ name: 'shell', image: 'registry.lab/toolbox:1.0' }] } },
        { name: 'catalog-reindex-29174-8vx2k', at: 3000, labels: { job: 'catalog-reindex' }, fixedStatus: { phase: 'Succeeded', ready: false }, node: 'node-b',
          spec: { containers: [{ name: 'reindex', image: 'registry.lab/catalog:3.2.0' }] } }
      ],
      timeline: [{ at: 4600, do: 'deletePods', selector: { app: 'catalog' } }],
      services: [{ name: 'catalog', selector: { app: 'catalog' }, clusterIP: '10.96.12.40', ports: [{ name: 'http', port: 80, targetPort: 'http' }] }]
    }),
    objectives: [
      { id: 'desired', stage: 'evidence', text: 'Compare catalog\'s desired replicas with how many are ready now',
        hint: 'Capacity is a question about the owner of the pods, not the pods themselves.',
        hint2: 'The Deployment reports desired, up-to-date and available counts in one line.',
        reveal: 'kubectl get deploy catalog',
        done: function (c) { return did(c, /kubectl\b.*\b(get|describe)\s+(deploy|deployments?|deployment\.apps)\b/, /catalog\s+3\/3|Replicas:\s+3 desired \| 3 updated \| 3 total \| 3 available/); } },
      { id: 'owner', stage: 'evidence', text: 'Show what created the catalog pods that exist now',
        hint: 'Every managed pod records its controller. Which object is that for catalog?',
        hint2: 'Describe one catalog pod and read "Controlled By", or list ReplicaSets.',
        reveal: 'kubectl get rs',
        done: function (c) { return did(c, /kubectl\b.*\b(describe\s+(po|pods?)\s+catalog-(?!debug)|get\s+(rs|replicasets?))\b/, /Controlled By:\s+ReplicaSet\/catalog-|catalog-[a-f0-9]+\s+3\s+3\s+3/); } },
      { id: 'replaced', stage: 'evidence', text: 'Find the evidence that the deleted pods were replaced automatically',
        hint: 'Controllers leave a trail when they act.',
        hint2: 'Events from the replicaset-controller record each pod it creates; pod AGE shows which pods are new.',
        reveal: 'kubectl get events',
        done: function (c) { return did(c, /kubectl\b.*\b(get\s+(events?|ev)|events|describe\s+(rs|replicasets?)\b)/, /SuccessfulCreate|Created pod: catalog-/); } },
      { id: 'bare', stage: 'evidence', text: 'Show why a pod like catalog-debug would not come back if deleted',
        hint: 'Compare catalog-debug with a catalog pod: what does it lack?',
        hint2: 'Describe catalog-debug and look at "Controlled By".',
        reveal: 'kubectl describe pod catalog-debug',
        done: function (c) { return did(c, /kubectl\b.*\b(describe\s+(po|pods?)|get\s+(po|pods?))\s+catalog-debug\b/, /Controlled By:\s+<none>|^(?![\s\S]*ownerReferences)[\s\S]*name: catalog-debug/); } },
      { id: 'demo', stage: 'fix', text: 'Demonstrate reconciliation: delete one catalog pod and let the ReplicaSet replace it',
        hint: 'One replica out of three is a safe experiment while the other two serve.',
        hint2: 'Delete a single catalog pod by name, then look at the pod list again.',
        reveal: function (c) { return 'kubectl delete pod ' + podName(c, 'catalog'); },
        done: function (c) { return did(c, /kubectl\b.*\bdelete\s+(po|pods?)\s+catalog-(?!debug)[a-z0-9-]+/, /deleted/) && podsOf(c, 'catalog').length === 3; } },
      { id: 'verify', stage: 'verify', text: 'Verify catalog is back to three ready replicas after your deletion',
        hint: 'The replacement needs a few seconds to pass readiness.',
        hint2: 'Re-run a read that shows ready counts, once the new pod is Ready.',
        reveal: 'kubectl get deploy catalog',
        done: function (c) {
          return did(c, /kubectl\b.*\bdelete\s+(po|pods?)\s+catalog-(?!debug)/, /deleted/) && readyOf(c, 'catalog') === 3 &&
            lastIs(c, /kubectl\b.*\b(get|describe)\b/, /catalog\s+3\/3|(catalog-\S+\s+1\/1\s+Running[\s\S]*){3}|3 available/);
        } }
    ],
    onsite: {
      spoilers: ['ReplicaSet', 'reconcil', 'controller'],
      neutralTitle: 'Storefront: capacity question after last night\'s alert',
      neutralBrief: 'A stakeholder asks whether storefront lost capacity after overnight activity, and whether anything needs recreating. They also mention a pod that "never came back". Recent changes: none to storefront workloads in 3 days. Investigate and answer with evidence.',
      impact: 'None visible to customers so far; a stakeholder needs a confident answer.',
      changes: 'No deploys in 3 days. Someone deleted pods overnight.',
      assumptions: ['You are the lab operator with admin rights in this namespace only.', 'The cluster is healthy apart from what the ticket describes.'],
      clues: ['A Completed catalog-reindex pod is a finished Job pod — Completed is its success state, not a fault.',
              'The cart workload is unrelated; its pods are older because nobody touched them.'],
      mechanism: 'Deleting a pod removes that one object. The ReplicaSet that owns the catalog pods continuously compares desired replicas (3) with the pods matching its selector and creates new ones to close the gap — new names, new IPs, new UIDs. That loop is what "self-healing" means. A bare pod has no controller, so nothing recreates it. Deleting pods is therefore not a restart: the old containers and their logs are gone, and during the gap the Service had fewer ready endpoints.',
      alternatives: [
        { h: 'Capacity was permanently lost', out: 'Ruled out: the Deployment reports 3/3 available and the ReplicaSet created replacements.' },
        { h: 'Someone recreated the pods by hand', out: 'Ruled out: the SuccessfulCreate events come from the replicaset-controller, and the pods carry a ReplicaSet owner.' },
        { h: 'catalog-debug failed to restart', out: 'Ruled out: it has no controller (Controlled By: <none>), so nothing would ever recreate it.' }
      ],
      summaryPrompt: 'In 3–4 sentences, tell the stakeholder what happened overnight, whether capacity was lost, and why the debug pod did not come back.',
      summaryChecklist: ['States the current capacity with evidence (3/3 available)', 'Explains the ReplicaSet recreated the pods (with the event as evidence)', 'Notes the short capacity dip and lost logs as the real cost of deleting pods', 'Explains bare pods have no controller', 'Suggests a safer habit (rollout restart, or no action) for next time'],
      prereqs: ['les-reconcile', 'les-workloads', 'les-failure'],
      questions: ['ons-q-arch-01', 'ons-q-arch-03', 'ons-q-arch-08'],
      refs: [{ t: 'ReplicaSet', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/' },
             { t: 'Pod lifecycle', u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/' }],
      simplified: SIMPLIFIED,
      palette: GENERIC
    }
  });

  /* ═══ 2. Failed image rollout: registry authorization ═══════════ */
  LX.missions.push({
    id: 'ons-lab-02', track: 'onsite', cat: 'lab', level: 'intermediate', mins: 18, kind: 'incident',
    title: 'Rollout stuck: new payments pods cannot pull their image',
    brief: 'The payments-api 2.8.0 release started 15 minutes ago and the pipeline is still "waiting for rollout". Release notes: images moved to the secured repository path registry.lab/secure/, and a database migration Job ran first. Checkout success rate looks normal so far. Get the rollout to a finished, healthy state — by rolling back or fixing forward — and prove it.',
    keys: ['kubectl rollout status deploy/payments-api', 'kubectl get pods', 'kubectl describe pod ', 'kubectl get endpoints payments-api',
      'kubectl get secrets', 'kubectl get sa default -o yaml', 'kubectl rollout undo deploy/payments-api',
      'kubectl patch serviceaccount default -p \'{"imagePullSecrets":[{"name":"secure-pull"}]}\'', 'kubectl rollout restart deploy/payments-api',
      'kubectl rollout history deploy/payments-api'],
    world: world({
      namespace: 'payments', context: 'lab-sim', nodes: simNodes(3),
      registry: { 'registry.lab/payments-api:2.7.4': { arch: ['amd64'] }, 'registry.lab/secure/payments-api:2.8.0': { arch: ['amd64'] },
                  'registry.lab/payments-migrate:2.8.0': { arch: ['amd64'] } },
      registryAuth: { 'registry.lab/secure/': 'secure-pull' },
      apps: { 'registry.lab/payments-api': { port: 8080, readyPath: '/ready', livePath: '/live', startSec: 5, memMi: 180, boot: ['payments-api 2.7.4 listening on :{port}'], http: { '/': 'ok' } },
              'registry.lab/secure/payments-api': { port: 8080, readyPath: '/ready', livePath: '/live', startSec: 5, memMi: 180, boot: ['payments-api 2.8.0 listening on :{port}'], http: { '/': 'ok' } } },
      secrets: [{ name: 'secure-pull', type: 'kubernetes.io/dockerconfigjson', data: { '.dockerconfigjson': '(simulated credential for registry.lab)' } },
                { name: 'payments-db', type: 'Opaque', data: { password: 'cGxhY2Vob2xkZXI=' } }],
      deployments: [{ name: 'payments-api', replicas: 3, selector: { app: 'payments-api' }, changedAgo: 900, history: [
        { labels: { app: 'payments-api' }, containers: [{ name: 'api', image: 'registry.lab/payments-api:2.7.4', ports: [{ name: 'http', containerPort: 8080 }], readiness: { path: '/ready', port: 8080 } }] },
        { labels: { app: 'payments-api' }, containers: [{ name: 'api', image: 'registry.lab/secure/payments-api:2.8.0', ports: [{ name: 'http', containerPort: 8080 }], readiness: { path: '/ready', port: 8080 } }] }
      ] }],
      pods: [{ name: 'payments-migrate-2-8-0-q7wzt', at: 6250, labels: { job: 'payments-migrate' }, node: 'node-c', fixedStatus: { phase: 'Succeeded', ready: false },
               spec: { containers: [{ name: 'migrate', image: 'registry.lab/payments-migrate:2.8.0' }] } }],
      services: [{ name: 'payments-api', selector: { app: 'payments-api' }, clusterIP: '10.96.40.8', ports: [{ name: 'http', port: 80, targetPort: 'http' }] }]
    }),
    objectives: [
      { id: 'stalled', stage: 'evidence', text: 'Establish what state the rollout is in',
        hint: 'A rollout has a status of its own, separate from the pods.',
        hint2: 'rollout status, or the Deployment\'s conditions in describe.',
        reveal: 'kubectl rollout status deploy/payments-api',
        done: function (c) { return did(c, /kubectl\b.*\b(rollout\s+status|describe\s+(deploy|deployments?)|get\s+(deploy|deployments?))\b/, /progress deadline|ProgressDeadlineExceeded|Waiting for deployment|payments-api\s+3\/3\s+1\s/); } },
      { id: 'serving', stage: 'evidence', text: 'Check whether customers are affected: what is the Service sending traffic to?',
        hint: 'maxUnavailable decides whether old pods are removed before new ones are ready.',
        hint2: 'Ready endpoints on the Service, or READY 1/1 on the old pods.',
        reveal: 'kubectl get endpoints payments-api',
        done: function (c) { return did(c, /kubectl\b.*\b(get\s+(ep|endpoints|endpointslices?)|describe\s+(svc|service))\b/, /10\.244\.\d+\.\d+:8080,10\.244|10\.244[\s\S]*10\.244[\s\S]*10\.244/) || did(c, /kubectl\b.*\bget\s+(po|pods?)\b/, /(payments-api-\S+\s+1\/1\s+Running[\s\S]*){3}/); } },
      { id: 'cause', stage: 'evidence', text: 'Find the exact error the new pod gets',
        hint: 'The pod status names a category; the events carry the registry\'s actual answer.',
        hint2: 'Describe the new pod (the one not Ready) and read its Events.',
        reveal: function (c) { return 'kubectl describe pod ' + podName(c, 'payments-api', notReady); },
        done: function (c) { return did(c, /kubectl\b.*\b(describe\s+(po|pods?)|get\s+(events?|ev)|events)\b/, /401 Unauthorized/); } },
      { id: 'repair', stage: 'fix', text: 'Bring payments-api to a completed, healthy rollout (roll back or fix forward)',
        hint: 'Two defensible paths: return to the known-good revision now, or give the pods the credential they are missing.',
        hint2: 'The secret already exists. Pods get pull secrets from their own spec or from their ServiceAccount — at creation time.',
        reveal: 'kubectl rollout undo deploy/payments-api',
        done: function (c) { return complete(c, 'payments-api') && readyOf(c, 'payments-api') === 3; } },
      { id: 'verify', stage: 'verify', text: 'Verify the rollout finished and all three replicas serve',
        hint: 'Ask the Deployment again, now that the state has changed.',
        reveal: 'kubectl rollout status deploy/payments-api',
        done: function (c) { return complete(c, 'payments-api') && lastOk(c, /kubectl\b.*\b(rollout\s+status|get\s+(deploy|deployments?))\b/, /successfully rolled out|payments-api\s+3\/3\s+3\s+3/); } }
    ],
    onsite: {
      spoilers: ['401', 'pull secret', 'imagePullSecret', 'authoriz', 'credential', 'cannot pull'],
      neutralTitle: 'payments-api release not completing',
      neutralBrief: 'The payments-api release pipeline has been "waiting for rollout" for 15 minutes. Release notes mention an image repository path change and a database migration Job. Checkout looks normal so far. Get the release to a finished, healthy state and prove it.',
      impact: 'None yet — the old replicas are still serving — but the release is blocked and the pipeline will eventually fail.',
      changes: 'payments-api 2.8.0: new image path under registry.lab/secure/; migration Job payments-migrate ran first.',
      assumptions: ['The secure repository requires authentication; a credential Secret named secure-pull was created by the platform team.', 'Rolling back is acceptable to the service owner.'],
      clues: ['The migration Job pod shows Completed — that is its success state and unrelated to the pull failure.',
              'payments-db is an unrelated Secret; its value is base64-encoded, which is not encryption.'],
      mechanism: 'The new ReplicaSet\'s pod could not pull registry.lab/secure/payments-api:2.8.0 because the registry answered 401: the pod carried no credential for that path. With maxUnavailable 0 the Deployment never removed old pods, so traffic kept flowing to 2.7.4 while the rollout sat until its progress deadline (ProgressDeadlineExceeded — it does not roll back on its own). Pull secrets are attached at pod creation, from the pod spec or its ServiceAccount, so adding one to the ServiceAccount only helps pods created afterwards (a restart, or deleting the stuck pod).',
      alternatives: [
        { h: 'The tag 2.8.0 does not exist', out: 'Ruled out: the registry says 401 Unauthorized, not "not found".' },
        { h: 'The migration broke the database', out: 'Ruled out for this symptom: the new pod never started a container; old pods are Ready.' },
        { h: 'Signature or admission policy', out: 'Ruled out: an admission denial shows as FailedCreate on the ReplicaSet and no pod exists; here the pod exists and fails to pull.' }
      ],
      summaryPrompt: 'Write the 4–5 sentence incident update you would post in the release channel.',
      summaryChecklist: ['Impact stated honestly (none to customers; release blocked)', 'Cause with evidence (401 from the secure path; pull secret missing on the pods)', 'Action taken and why (rollback vs fix forward)', 'Verification (rollout status successful, 3/3 ready)', 'Follow-up (reference the pull secret in the release manifests; a preflight that pulls the image)'],
      prereqs: ['les-rollouts', 'les-pod-lifecycle', 'les-disconnected'],
      questions: ['ons-q-trouble-04', 'ons-q-trouble-05', 'ons-q-trouble-08', 'ons-q-delivery-04'],
      refs: [{ t: 'Deployments — failed deployment', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#failed-deployment' },
             { t: 'Pull an image from a private registry', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/' }],
      simplified: SIMPLIFIED,
      palette: GENERIC
    }
  });

  /* ═══ 3. Running pods behind a broken Service selector ══════════ */
  LX.missions.push({
    id: 'ons-lab-03', track: 'onsite', cat: 'lab', level: 'beginner', mins: 15, kind: 'incident',
    title: 'Healthy pods, but the orders Service returns nothing',
    brief: 'After this morning\'s "label cleanup" change to the orders Service manifest, the storefront reports connection failures to orders. All three orders-api pods are Running and Ready. Someone in the channel says "it\'s DNS". Find the break, fix it durably (not in a way the next rollout undoes), and prove requests work.',
    keys: ['kubectl get pods --show-labels', 'kubectl get endpoints orders', 'kubectl describe svc orders', 'kubectl exec deploy/orders-api -- nslookup orders',
      'kubectl exec deploy/orders-api -- curl -s http://orders/', 'kubectl get deploy orders-api -o yaml',
      'kubectl patch svc orders --type=merge -p \'{"spec":{"selector":{"track":null}}}\''],
    world: world({
      namespace: 'orders', context: 'lab-sim', nodes: simNodes(2),
      registry: { 'registry.lab/orders-api:4.0.2': { arch: ['amd64'] } },
      apps: { 'registry.lab/orders-api': { port: 8080, readyPath: '/ready', livePath: '/live', startSec: 4, memMi: 140, boot: ['orders-api listening on :{port}'], http: { '/': 'orders ok', '/orders/42': '{"id":42,"status":"shipped"}' } } },
      deployments: [{ name: 'orders-api', replicas: 3, selector: { app: 'orders' }, history: [
        { labels: { app: 'orders', tier: 'backend' }, containers: [{ name: 'api', image: 'registry.lab/orders-api:4.0.2', ports: [{ name: 'http', containerPort: 8080 }], readiness: { path: '/ready', port: 8080 } }] }] }],
      services: [{ name: 'orders', selector: { app: 'orders', track: 'stable' }, clusterIP: '10.96.33.7', created: 6500, ports: [{ name: 'http', port: 80, targetPort: 'http' }] }]
    }),
    objectives: [
      { id: 'endpoints', stage: 'evidence', text: 'Check what the orders Service is routing to',
        hint: 'A Service is a selector plus ports; its backends are derived, not declared.',
        hint2: 'Endpoints (or EndpointSlices) show exactly which pod IPs are selected.',
        reveal: 'kubectl get endpoints orders',
        done: function (c) { return did(c, /kubectl\b.*\b(get\s+(ep|endpoints|endpointslices?)|describe\s+(svc|service|services))\b/, /orders\s+<none>|Endpoints:\s+<none>|<unset>/); } },
      { id: 'dns', stage: 'evidence', text: 'Test the "it\'s DNS" theory from inside the namespace',
        hint: 'Resolving the name and connecting to it are different steps.',
        hint2: 'nslookup from one of the running pods.',
        reveal: 'kubectl exec deploy/orders-api -- nslookup orders',
        done: function (c) { return did(c, /kubectl\b.*\bexec\b.*--\s*(nslookup|dig|host)\b/, /10\.96\.33\.7/); } },
      { id: 'compare', stage: 'evidence', text: 'Compare the Service selector with the labels the pods carry',
        hint: 'Selectors are exact matches on every key they list.',
        hint2: 'describe svc shows the selector; --show-labels shows the pods\' labels.',
        reveal: function (c) {
          return did(c, /kubectl\b.*\bdescribe\s+(svc|service)/, /track=stable/) ? 'kubectl get pods --show-labels' : 'kubectl describe svc orders';
        },
        done: function (c) {
          return did(c, /kubectl\b.*\b(describe\s+(svc|service)|get\s+(svc|service|services)\b.*-o\s*(yaml|json|wide))/, /track=stable|track: stable|"track": "stable"/) &&
                 did(c, /kubectl\b.*\b(get\s+(po|pods?)\b.*--show-labels|describe\s+(po|pods?)|get\s+(deploy|deployments?)\b.*-o\s*(yaml|json))/, /app=orders|app: orders/);
        } },
      { id: 'durable', stage: 'fix', text: 'Make the Service select the Deployment\'s pods in a way the next rollout keeps',
        hint: 'Change the object that is wrong — the Service — or deliberately make the pod template carry the label. Relabelling running pods does not survive the next rollout.',
        hint2: 'A merge patch with "track": null removes that key from the selector.',
        reveal: 'kubectl patch svc orders --type=merge -p \'{"spec":{"selector":{"track":null}}}\'',
        done: function (c) {
          var s = K().find(M(c), 'services', 'orders', M(c).ns), d = dep(c, 'orders-api');
          if (!s || !d) return false;
          var ep = K().endpoints(M(c), s);
          return K().matches(s.selector, d.template.labels) && ep.ready.length >= 3 && complete(c, 'orders-api');
        } },
      { id: 'verify', stage: 'verify', text: 'Prove a request through the Service name now succeeds',
        hint: 'Test the way a client would: by Service name, from inside the namespace.',
        reveal: 'kubectl exec deploy/orders-api -- curl -s http://orders/',
        done: function (c) {
          var s = K().find(M(c), 'services', 'orders', M(c).ns), d = dep(c, 'orders-api');
          return s && d && K().matches(s.selector, d.template.labels) && lastOk(c, /kubectl\b.*\bexec\b.*--\s*(curl|wget)\b.*orders/, /orders ok|shipped|200/);
        } }
    ],
    onsite: {
      spoilers: ['selector', 'label', 'endpoint'],
      neutralTitle: 'Storefront cannot reach orders',
      neutralBrief: 'Since this morning the storefront reports connection failures to the orders service. The orders pods look healthy on the dashboard. A config change to the orders Service manifest went out this morning. Someone suspects DNS. Restore service durably and prove it.',
      impact: 'Order history and order placement fail for all storefront users.',
      changes: 'This morning: a "label cleanup" edit to the orders Service manifest.',
      assumptions: ['You may change the Service or the Deployment; the change will be committed back to source afterwards.'],
      clues: ['"It\'s DNS" — the name resolves to the ClusterIP, so name resolution is not the failure.',
              'The pods are Running and Ready — the application is fine; the problem is between the Service and the pods.'],
      mechanism: 'A Service does not own pods; the EndpointSlice controller continuously selects every Ready pod whose labels match ALL keys in the Service selector. The cleanup added track=stable to the selector, which no pod carries, so the Service had zero endpoints: DNS still returned the ClusterIP, but connections had nowhere to go. Relabelling running pods would bring traffic back until the next rollout replaced them from a template without the label — so the durable fix is in the Service (or, deliberately, in the pod template).',
      alternatives: [
        { h: 'DNS failure', out: 'Ruled out: nslookup returns the ClusterIP 10.96.33.7.' },
        { h: 'Application failure', out: 'Ruled out: pods are Ready, and a request that reaches them returns 200.' },
        { h: 'Wrong targetPort', out: 'Would show endpoints but refused connections; here the endpoint list itself is empty.' }
      ],
      summaryPrompt: 'Explain to the storefront team, in 3–4 sentences, why the name resolved but requests failed, and what you changed.',
      summaryChecklist: ['Distinguishes name resolution from routing', 'Names the selector mismatch with evidence (empty endpoints; track=stable not on pods)', 'Explains why the fix is durable', 'Shows verification by Service name', 'Suggests prevention (check endpoints after Service changes; review selectors against templates)'],
      prereqs: ['les-services', 'les-request-path'],
      questions: ['ons-q-net-01', 'ons-q-net-03', 'ons-q-net-04', 'ons-q-arch-08'],
      refs: [{ t: 'Service', u: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
             { t: 'EndpointSlices', u: 'https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/' }],
      simplified: SIMPLIFIED,
      palette: GENERIC
    }
  });

  /* ═══ 4. Readiness failure versus liveness-driven restart ═══════ */
  LX.missions.push({
    id: 'ons-lab-04', track: 'onsite', cat: 'lab', level: 'intermediate', mins: 20, kind: 'incident',
    title: 'Search launch: one workload never Ready, another keeps restarting',
    brief: 'The new search service launched an hour ago. search-api pods are Running but the gateway gets 503s; search-indexer restarts every minute or so. Both manifests were copied from a template and "the probes were adjusted". Fix both without removing health checking, and verify.',
    keys: ['kubectl get pods', 'kubectl describe pod ', 'kubectl get endpoints search-api', 'kubectl logs ', '--previous',
      'kubectl get deploy search-api -o yaml',
      'kubectl patch deploy search-api -p \'{"spec":{"template":{"spec":{"containers":[{"name":"api","readinessProbe":{"httpGet":{"path":"/ready","port":8080}}}]}}}}\'',
      'kubectl patch deploy search-indexer -p \'{"spec":{"template":{"spec":{"containers":[{"name":"indexer","startupProbe":{"httpGet":{"path":"/healthz","port":9090},"periodSeconds":10,"failureThreshold":12}}]}}}}\''],
    world: world({
      namespace: 'search', context: 'lab-sim', nodes: simNodes(2),
      registry: { 'registry.lab/search-api:1.0.0': { arch: ['amd64'] }, 'registry.lab/search-indexer:1.0.0': { arch: ['amd64'] } },
      apps: { 'registry.lab/search-api': { port: 8080, readyPath: '/ready', livePath: '/healthz', startSec: 5, memMi: 200, boot: ['search-api listening on :{port}', 'GET /ready -> 200 when index shard is loaded'], http: { '/': 'search ok', '/search?q=boots': '{"hits":12}' } },
              'registry.lab/search-indexer': { port: 9090, readyPath: '/healthz', livePath: '/healthz', startSec: 50, memMi: 300, boot: ['loading index segments from disk (takes ~50s)'], runLogs: ['index ready; watching for updates'] } },
      deployments: [
        { name: 'search-api', replicas: 2, selector: { app: 'search-api' }, history: [{ labels: { app: 'search-api' }, containers: [{ name: 'api', image: 'registry.lab/search-api:1.0.0', ports: [{ name: 'http', containerPort: 8080 }], readiness: { path: '/readyz', port: 8080 }, liveness: { path: '/healthz', port: 8080, initialDelay: 10, period: 10, failureThreshold: 3 } }] }] },
        { name: 'search-indexer', replicas: 1, selector: { app: 'search-indexer' }, history: [{ labels: { app: 'search-indexer' }, containers: [{ name: 'indexer', image: 'registry.lab/search-indexer:1.0.0', ports: [{ name: 'metrics', containerPort: 9090 }], liveness: { path: '/healthz', port: 9090, initialDelay: 5, period: 10, failureThreshold: 3 } }] }] }
      ],
      services: [{ name: 'search-api', selector: { app: 'search-api' }, clusterIP: '10.96.51.2', ports: [{ name: 'http', port: 80, targetPort: 'http' }] }]
    }),
    objectives: [
      { id: 'notready', stage: 'evidence', text: 'Show that search-api is up but not Ready — and not restarting',
        hint: 'Running and Ready are different columns for a reason.',
        hint2: 'Look at READY and RESTARTS together in the pod list.',
        reveal: 'kubectl get pods',
        done: function (c) { return did(c, /kubectl\b.*\bget\s+(po|pods?)\b/, /search-api-\S+\s+0\/1\s+Running\s+0\s/); } },
      { id: 'readywhy', stage: 'evidence', text: 'Find why search-api fails readiness',
        hint: 'The kubelet records probe failures as events on the pod.',
        hint2: 'Describe a search-api pod; compare the probe path with what the app serves (its log says).',
        reveal: function (c) { return 'kubectl describe pod ' + podName(c, 'search-api'); },
        done: function (c) { return did(c, /kubectl\b.*\bdescribe\s+(po|pods?)\s+search-api/, /Readiness probe failed/); } },
      { id: 'livewhy', stage: 'evidence', text: 'Find what is restarting search-indexer',
        hint: 'A restart is the kubelet acting. What told it to?',
        hint2: 'Describe the indexer pod: last state, exit code, and the probe events.',
        reveal: function (c) { return 'kubectl describe pod ' + podName(c, 'search-indexer'); },
        done: function (c) { return did(c, /kubectl\b.*\bdescribe\s+(po|pods?)\s+search-indexer/, /Liveness probe failed|failed liveness probe/); } },
      { id: 'readyfix', stage: 'fix', text: 'Make search-api pass readiness so the Service has endpoints',
        hint: 'Point the readiness probe at the endpoint the app actually serves for readiness.',
        hint2: 'The app\'s log says GET /ready. Patch the probe path in the pod template.',
        reveal: 'kubectl patch deploy search-api -p \'{"spec":{"template":{"spec":{"containers":[{"name":"api","readinessProbe":{"httpGet":{"path":"/ready","port":8080}}}]}}}}\'',
        done: function (c) {
          var d = dep(c, 'search-api'), s = K().find(M(c), 'services', 'search-api', M(c).ns);
          return d && complete(c, 'search-api') && K().endpoints(M(c), s).ready.length === 2 && !!d.template.containers[0].readiness;
        } },
      { id: 'livefix', stage: 'fix', text: 'Stop the indexer restarting while keeping a liveness check',
        hint: 'The app needs ~50s to start; liveness gives up after 5 + 3×10 seconds.',
        hint2: 'A startupProbe holds liveness off until startup succeeds; or lengthen the liveness delay. Keep liveness in place.',
        reveal: 'kubectl patch deploy search-indexer -p \'{"spec":{"template":{"spec":{"containers":[{"name":"indexer","startupProbe":{"httpGet":{"path":"/healthz","port":9090},"periodSeconds":10,"failureThreshold":12}}]}}}}\'',
        done: function (c) {
          var d = dep(c, 'search-indexer');
          return d && !!d.template.containers[0].liveness && complete(c, 'search-indexer') && stable(c, 'search-indexer', 70);
        } },
      { id: 'verify', stage: 'verify', text: 'Verify: all search pods Ready with no new restarts, and search answers through the Service',
        hint: 'A request through the Service name is the client\'s view.',
        reveal: 'kubectl exec deploy/search-api -- curl -s http://search-api/',
        done: function (c) {
          var d = dep(c, 'search-indexer');
          return complete(c, 'search-api') && d && !!d.template.containers[0].liveness && stable(c, 'search-indexer', 70) &&
            (lastOk(c, /kubectl\b.*\bexec\b.*--\s*(curl|wget)\b.*search-api/, /search ok|hits/) ||
             lastIs(c, /kubectl\b.*\bget\s+(po|pods?)\b/, /search-indexer-\S+\s+1\/1\s+Running\s+0\s/));
        } }
    ],
    onsite: {
      spoilers: ['probe', 'readiness', 'liveness', 'startup'],
      neutralTitle: 'Search launch unhealthy',
      neutralBrief: 'The new search service launched an hour ago. The gateway returns 503 for search, and dashboards show pod churn in the namespace. Manifests were copied from a shared template and adjusted. Restore service at the cause — do not delete checks or configuration to hide symptoms — and verify.',
      impact: 'Search is unavailable to all users.',
      changes: 'New service; manifests copied from a template with probe adjustments.',
      assumptions: ['You may change probe configuration in the pod templates. Removing probes entirely is not acceptable to the service owner.'],
      clues: ['search-api\'s liveness probe is fine — its restarts stay at zero.', 'The indexer is not out of memory: its exit code is 143 (SIGTERM, graceful stop), and the reason is Error, not OOMKilled.'],
      mechanism: 'Readiness and liveness answer different questions. search-api\'s readiness probe asked for /readyz, which the app does not serve, so the kubelet marked the pod not Ready and the EndpointSlice controller kept it out of the Service — but readiness failure never restarts anything, so RESTARTS stayed 0. search-indexer takes about 50 seconds to load; its liveness probe began at 5 seconds and gave up after three failures, so the kubelet killed it (SIGTERM, exit 143) and started it again, forever. A startup probe suspends liveness until the app has started once; lengthening the liveness delay works too but also delays detection of real hangs later.',
      alternatives: [
        { h: 'Out of memory', out: 'Ruled out: last state reason is Error with exit 143, not OOMKilled/137.' },
        { h: 'Application crash', out: 'Ruled out: the log shows it was still loading; the Killing event names the liveness probe.' },
        { h: 'Service selector wrong', out: 'Ruled out: the pods are selected (they appear as not-ready endpoints); readiness is what excludes them.' }
      ],
      summaryPrompt: 'In 4–5 sentences, explain the two failures and why they looked different (no restarts vs restarts).',
      summaryChecklist: ['Readiness → endpoint membership only, no restart', 'Liveness → restart by the kubelet, with the event as evidence', 'Startup probe (or delay) chosen with its tradeoff', 'Verification through the Service and restart counts', 'Prevention: probe review for templates, startup budgets from measured start times'],
      prereqs: ['les-probes', 'les-pod-lifecycle', 'les-services'],
      questions: ['ons-q-trouble-03', 'ons-q-net-03', 'ons-q-trouble-06'],
      refs: [{ t: 'Liveness, readiness and startup probes', u: 'https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/' },
             { t: 'Configure probes', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/' }],
      simplified: SIMPLIFIED.concat(['Probe timing is simplified to initial delay + period × failure threshold; timeouts and success thresholds are not modelled.']),
      palette: GENERIC
    }
  });

  /* ═══ 5. Pending from requests / placement ═══════════════════════ */
  LX.missions.push({
    id: 'ons-lab-05', track: 'onsite', cat: 'lab', level: 'intermediate', mins: 15, kind: 'incident',
    title: 'report-builder release stuck with a Pending pod',
    brief: 'The report-builder release went out 15 minutes ago; its new pod has been Pending since. The release raised memory for larger reports. Platform cordoned node-b this morning for kernel patching, and node-c is the GPU pool (tainted). Get the release running without disturbing the platform team\'s maintenance or the GPU pool.',
    keys: ['kubectl get pods -o wide', 'kubectl describe pod ', 'kubectl describe node node-a', 'kubectl get nodes', 'kubectl top node',
      'kubectl get deploy report-builder -o yaml', 'kubectl set resources deploy report-builder --requests=memory=2Gi --limits=memory=3Gi'],
    world: world({
      namespace: 'analytics', context: 'lab-sim',
      nodes: [{ name: 'node-a', cpu: 4000, mem: 8192, labels: { pool: 'general' } },
              { name: 'node-b', cpu: 4000, mem: 8192, labels: { pool: 'general' }, unschedulable: true },
              { name: 'node-c', cpu: 8000, mem: 8192, labels: { pool: 'gpu' }, taints: [{ key: 'gpu', value: 'true', effect: 'NoSchedule' }] }],
      registry: { 'registry.lab/report-builder:6.3.0': { arch: ['amd64'] }, 'registry.lab/report-builder:6.4.0': { arch: ['amd64'] } },
      apps: { 'registry.lab/report-builder': { port: 8080, readyPath: '/ready', livePath: '/live', startSec: 5, memMi: 700, boot: ['report-builder listening on :{port}'] } },
      deployments: [{ name: 'report-builder', replicas: 2, selector: { app: 'report-builder' }, changedAgo: 900, history: [
        { labels: { app: 'report-builder' }, nodeSelector: { pool: 'general' }, containers: [{ name: 'builder', image: 'registry.lab/report-builder:6.3.0', readiness: { path: '/ready', port: 8080 }, resources: { requests: { cpu: '500m', memory: '1Gi' }, limits: { memory: '2Gi' } } }] },
        { labels: { app: 'report-builder' }, nodeSelector: { pool: 'general' }, containers: [{ name: 'builder', image: 'registry.lab/report-builder:6.4.0', readiness: { path: '/ready', port: 8080 }, resources: { requests: { cpu: '500m', memory: '12Gi' }, limits: { memory: '12Gi' } } }] }
      ] }],
      services: []
    }),
    objectives: [
      { id: 'pending', stage: 'evidence', text: 'Confirm which pod is Pending and that it was never scheduled',
        hint: 'Pending covers "not yet placed" and "placed but not started". Which is this?',
        hint2: 'A pod with no NODE in -o wide has not been scheduled.',
        reveal: 'kubectl get pods -o wide',
        done: function (c) { return did(c, /kubectl\b.*\bget\s+(po|pods?)\b/, /report-builder-\S+\s+0\/1\s+Pending/); } },
      { id: 'why', stage: 'evidence', text: 'Read the scheduler\'s explanation for every node',
        hint: 'The scheduler says why each node was rejected.',
        hint2: 'describe pod → the FailedScheduling event lists a reason per node.',
        reveal: function (c) { return 'kubectl describe pod ' + podName(c, 'report-builder', notReady); },
        done: function (c) { return did(c, /kubectl\b.*\b(describe\s+(po|pods?)|get\s+(events?|ev)|events)\b/, /Insufficient memory/); } },
      { id: 'request', stage: 'evidence', text: 'Find the request that cannot fit, and the capacity it is compared against',
        hint: 'Scheduling compares requests (not usage) against allocatable.',
        hint2: 'The new template\'s memory request, and a node\'s Allocatable.',
        reveal: 'kubectl describe node node-a',
        done: function (c) {
          return did(c, /kubectl\b.*\b(describe\s+(po|pods?|deploy|deployments?)|get\s+(deploy|deployments?|po|pods?)\b.*-o\s*(yaml|json))/, /12Gi/) &&
                 did(c, /kubectl\b.*\b(describe\s+(no|nodes?)|top\s+(no|nodes?)|get\s+(no|nodes?)\b.*-o\s*(yaml|json))/, /Allocatable|allocatable|MEMORY/);
        } },
      { id: 'fix', stage: 'fix', text: 'Get the release running on the general pool with a request that fits',
        hint: 'Change the request, not the cluster: uncordoning node-b or tolerating the GPU taint would still not fit 12Gi on an 8Gi node — and they are not yours to change.',
        hint2: 'kubectl set resources on the Deployment, with a request that fits a general node alongside what is already there.',
        reveal: 'kubectl set resources deploy report-builder --requests=memory=2Gi --limits=memory=3Gi',
        done: function (c) {
          var d = dep(c, 'report-builder');
          var n = K().find(M(c), 'nodes', 'node-b');
          return d && complete(c, 'report-builder') && readyOf(c, 'report-builder') === 2 &&
                 podsOf(c, 'report-builder').every(function (p) { return p.node === 'node-a'; }) && n.unschedulable;
        } },
      { id: 'verify', stage: 'verify', text: 'Verify both replicas run the new version',
        hint: 'Ask the Deployment whether the rollout completed.',
        reveal: 'kubectl rollout status deploy/report-builder',
        done: function (c) { return complete(c, 'report-builder') && lastOk(c, /kubectl\b.*\b(rollout\s+status|get\s+(deploy|deployments?|po|pods?))\b/, /successfully rolled out|report-builder\s+2\/2\s+2\s+2|(report-builder-\S+\s+1\/1\s+Running[\s\S]*){2}/); } }
    ],
    onsite: {
      spoilers: ['12Gi', 'request', 'Insufficient', 'Pending'],
      neutralTitle: 'report-builder release not finishing',
      neutralBrief: 'The report-builder release went out 15 minutes ago and has not finished. Platform cordoned node-b this morning for kernel patching; node-c is the GPU pool. Get the release running without disturbing either, and verify.',
      impact: 'Old version still serving; the release that customers asked for (larger reports) is blocked.',
      changes: 'report-builder 6.4.0 with a memory change; node-b cordoned for maintenance.',
      assumptions: ['report-builder 6.4.0 actually uses under 1Gi of memory; the 12Gi value was a typo for 1.2Gi in review.', 'You may change report-builder\'s resources but not nodes.'],
      clues: ['node-b being cordoned is real, but uncordoning it would not help: 12Gi does not fit on any 8Gi node.',
              'node-c\'s GPU taint is also listed; tolerating it would not fit 12Gi either, and would put a CPU job on scarce GPU nodes.'],
      mechanism: 'The scheduler filters nodes using the pod\'s requests against each node\'s allocatable minus what is already requested there — not live usage. A 12Gi request cannot fit any 8Gi node, so the new pod stays Pending with FailedScheduling listing a reason per node, and with maxUnavailable 0 the old pods keep serving. Lowering the request to a value that fits (and that the app really needs) lets the scheduler place it.',
      alternatives: [
        { h: 'Cordoned node', out: 'Contributes one reason but is not the cause: even an uncordoned node-b has only 8Gi.' },
        { h: 'Taint on node-c', out: 'Same: tolerating it would still be Insufficient memory, and it moves work onto the GPU pool.' },
        { h: 'Image pull problem', out: 'Ruled out: an unscheduled pod never reaches image pull; there is no Node assigned.' }
      ],
      summaryPrompt: 'Explain to the report-builder owner in 3–4 sentences why their pod was Pending and what you changed.',
      summaryChecklist: ['Requests vs allocatable, not usage', 'Quotes the scheduler\'s reasons', 'Explains why cordon/taint were not the fix', 'Verification of rollout', 'Prevention: request review against node size, admission checks for oversized requests'],
      prereqs: ['les-scheduling', 'les-resources'],
      questions: ['ons-q-trouble-01', 'ons-q-trouble-02', 'ons-q-design-06'],
      refs: [{ t: 'Resource management for pods and containers', u: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/' },
             { t: 'Taints and tolerations', u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/' }],
      simplified: SIMPLIFIED.concat(['Scheduling is first-fit over requests only; scoring, affinity weights and preemption are not modelled.']),
      palette: GENERIC
    }
  });

  /* ═══ 6. CrashLoopBackOff: missing configuration vs app error ═══ */
  LX.missions.push({
    id: 'ons-lab-06', track: 'onsite', cat: 'lab', level: 'intermediate', mins: 18, kind: 'incident',
    title: 'notify-api 3.0 pods crash-looping after release',
    brief: 'notify-api 3.0 went out five minutes ago; its new pods are in CrashLoopBackOff. The release moved configuration into a new ConfigMap that the release pipeline was supposed to create. Old pods are still serving. Find the actual cause, restore a healthy rollout, and verify.',
    keys: ['kubectl get pods', 'kubectl logs ', '--previous', 'kubectl describe pod ', 'kubectl get cm', 'kubectl get cm notify-config -o yaml',
      'kubectl get deploy notify-api -o yaml', 'kubectl create configmap notify-v3 --from-literal=QUEUE_URL=amqp://queue.notify.svc:5672',
      'kubectl rollout restart deploy/notify-api', 'kubectl rollout undo deploy/notify-api'],
    world: world({
      namespace: 'notify', context: 'lab-sim', nodes: simNodes(2),
      registry: { 'registry.lab/notify-api:2.9.1': { arch: ['amd64'] }, 'registry.lab/notify-api:3.0.0': { arch: ['amd64'] } },
      apps: { 'registry.lab/notify-api': { port: 8080, readyPath: '/ready', livePath: '/live', startSec: 4, memMi: 120,
        boot: ['notify-api starting', 'WARN tls: cipher suite TLS_RSA_WITH_AES_128_CBC_SHA is deprecated'],
        requiresEnv: ['QUEUE_URL'], missingEnvLog: 'FATAL config: QUEUE_URL is required (set it via the notify ConfigMap)', runLogs: ['connected to queue', 'notify-api ready on :8080'] } },
      configmaps: [{ name: 'notify-config', data: { QUEUE_URL: 'amqp://queue.notify.svc:5672', LOG_LEVEL: 'info' } }],
      deployments: [{ name: 'notify-api', replicas: 2, selector: { app: 'notify-api' }, changedAgo: 300, history: [
        { labels: { app: 'notify-api' }, containers: [{ name: 'api', image: 'registry.lab/notify-api:2.9.1', envFrom: [{ configMapRef: 'notify-config' }], readiness: { path: '/ready', port: 8080 } }] },
        { labels: { app: 'notify-api' }, containers: [{ name: 'api', image: 'registry.lab/notify-api:3.0.0', envFrom: [{ configMapRef: 'notify-v3', optional: true }], readiness: { path: '/ready', port: 8080 } }] }
      ] }],
      services: [{ name: 'notify-api', selector: { app: 'notify-api' }, clusterIP: '10.96.70.3', ports: [{ port: 80, targetPort: 8080 }] }]
    }),
    objectives: [
      { id: 'state', stage: 'evidence', text: 'Identify which pods are failing and how',
        hint: 'Status is the symptom label, not the cause.',
        reveal: 'kubectl get pods',
        done: function (c) { return did(c, /kubectl\b.*\bget\s+(po|pods?)\b/, /CrashLoopBackOff|notify-api-\S+\s+0\/1\s+(Error|Running)/); } },
      { id: 'previous', stage: 'evidence', text: 'Read what the crashed container said before it exited',
        hint: 'The current container may have just started; you want the one that died.',
        hint2: 'logs --previous on a crash-looping pod.',
        reveal: function (c) { return 'kubectl logs ' + podName(c, 'notify-api', restarted) + ' --previous'; },
        done: function (c) { return did(c, /kubectl\b.*\blogs?\b.*(--previous|-p\b)/, /FATAL config/); } },
      { id: 'exit', stage: 'evidence', text: 'Confirm how the container terminated (reason and exit code)',
        hint: 'An exit code distinguishes "the app gave up" from "something killed it".',
        reveal: function (c) { return 'kubectl describe pod ' + podName(c, 'notify-api', restarted); },
        done: function (c) { return did(c, /kubectl\b.*\bdescribe\s+(po|pods?)\s+notify-api/, /Exit Code:\s+1\b/); } },
      { id: 'source', stage: 'evidence', text: 'Find where 3.0 expects its configuration and what actually exists',
        hint: 'Compare what the pod template references with the ConfigMaps in the namespace.',
        hint2: 'The template (describe deploy or -o yaml) names notify-v3; get cm lists what exists.',
        reveal: 'kubectl get cm',
        done: function (c) {
          return did(c, /kubectl\b.*\b(get\s+(cm|configmaps?))\b/, /notify-config/) &&
                 did(c, /kubectl\b.*\b(describe\s+(deploy|deployments?|po|pods?)|get\s+(deploy|deployments?|po|pods?)\b.*-o\s*(yaml|json))/, /notify-v3/);
        } },
      { id: 'healthy', stage: 'fix', text: 'Restore a completed, healthy rollout (fix forward or roll back)',
        hint: 'Either provide the configuration 3.0 expects, or return to 2.9.1.',
        hint2: 'Environment variables are read at container start: after creating the ConfigMap, the next start (or a rollout restart) picks it up.',
        reveal: 'kubectl create configmap notify-v3 --from-literal=QUEUE_URL=amqp://queue.notify.svc:5672',
        done: function (c) { return complete(c, 'notify-api') && readyOf(c, 'notify-api') === 2; } },
      { id: 'verify', stage: 'verify', text: 'Verify both replicas are Ready and stay up',
        hint: 'Check after the fix, and give it a little time.',
        reveal: 'kubectl rollout status deploy/notify-api',
        done: function (c) { return complete(c, 'notify-api') && stable(c, 'notify-api', 30) && lastOk(c, /kubectl\b.*\b(rollout\s+status|get\s+(po|pods?|deploy|deployments?))\b/, /successfully rolled out|notify-api\s+2\/2|(notify-api-\S+\s+1\/1\s+Running[\s\S]*){2}/); } }
    ],
    onsite: {
      spoilers: ['QUEUE_URL', 'notify-v3', 'ConfigMap', 'missing', 'CrashLoop'],
      neutralTitle: 'notify-api release unhealthy',
      neutralBrief: 'notify-api 3.0 went out five minutes ago and its new pods are unhealthy. Old pods are still serving. The release changed how configuration is supplied. Find the cause, restore a healthy rollout, and verify.',
      impact: 'None yet to users (old pods serving); the release is blocked.',
      changes: 'notify-api 3.0.0; configuration moved to a new ConfigMap expected from the pipeline.',
      assumptions: ['The queue URL did not change between 2.9.1 and 3.0.0.', 'Either fixing forward or rolling back is acceptable.'],
      clues: ['The deprecated-cipher WARN appears in every start, including healthy 2.9.1 — it is noise here.', 'Exit code 1 rules out OOM (137) and graceful kills (143).'],
      mechanism: 'CrashLoopBackOff is the kubelet backing off between restarts of a container that keeps exiting; it is never the cause. The cause was in the previous container\'s log: QUEUE_URL was missing. 3.0 referenced a ConfigMap notify-v3 marked optional, so the pod started without it (had it been required, the pod would have shown CreateContainerConfigError before starting). Environment from a ConfigMap is read at container start, so the fix is picked up on the next restart — or immediately with a rollout restart.',
      alternatives: [
        { h: 'Out of memory', out: 'Ruled out: exit code 1, reason Error.' },
        { h: 'Liveness probe killing it', out: 'Ruled out: no liveness probe events; the process exits by itself within seconds.' },
        { h: 'Bad image', out: 'Ruled out: the image pulled and the process ran and logged.' }
      ],
      summaryPrompt: 'Write the 3–4 sentence explanation you would give in the release review.',
      summaryChecklist: ['CrashLoopBackOff as symptom; the log line as cause', 'Why optional:true hid the problem until runtime', 'Fix and why a restart was needed (env read at start)', 'Verification', 'Prevention: fail the release if referenced ConfigMaps are missing; avoid optional for required config'],
      prereqs: ['les-pod-lifecycle', 'les-config'],
      questions: ['ons-q-trouble-06', 'ons-q-config-05', 'ons-q-config-03'],
      refs: [{ t: 'Debug running pods', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/' },
             { t: 'ConfigMaps', u: 'https://kubernetes.io/docs/concepts/configuration/configmap/' }],
      simplified: SIMPLIFIED.concat(['Back-off doubles from 10s up to a 300s cap, as in the default kubelet; exact timing varies in real clusters.']),
      palette: GENERIC
    }
  });

  /* ═══ 7. Memory termination vs other kills ═══════════════════════ */
  LX.missions.push({
    id: 'ons-lab-07', track: 'onsite', cat: 'lab', level: 'advanced', mins: 20, kind: 'incident',
    title: 'Two media workers restarting with exit code 137',
    brief: 'thumbnailer and transcoder both restart repeatedly and both show exit code 137. A teammate proposes doubling memory limits on both. Yesterday thumbnailer\'s batch size was raised; transcoder was moved to a new base image that takes longer to boot. Establish what is actually killing each one, fix each at its cause, and verify.',
    keys: ['kubectl get pods', 'kubectl describe pod ', 'kubectl top pod', 'kubectl logs ', '--previous',
      'kubectl set resources deploy thumbnailer --limits=memory=1Gi --requests=memory=768Mi',
      'kubectl patch deploy transcoder -p \'{"spec":{"template":{"spec":{"containers":[{"name":"transcoder","startupProbe":{"httpGet":{"path":"/live","port":8080},"periodSeconds":10,"failureThreshold":10}}]}}}}\''],
    world: world({
      namespace: 'media', context: 'lab-sim', nodes: simNodes(2),
      registry: { 'registry.lab/thumbnailer:2.2.0': { arch: ['amd64'] }, 'registry.lab/transcoder:5.0.0': { arch: ['amd64'] } },
      apps: { 'registry.lab/thumbnailer': { port: 8080, readyPath: '/ready', livePath: '/live', startSec: 3, memMi: 700, oomAfter: 45, boot: ['thumbnailer starting, batch size 64'], workLogs: ['processing batch of 64 images', 'decoding 64 x 12MP images into memory'], runLogs: ['batch done'] },
              'registry.lab/transcoder': { port: 8080, readyPath: '/ready', livePath: '/live', startSec: 60, memMi: 250, ignoresSigterm: true, boot: ['transcoder: warming codec cache (slow on the new base image)'], runLogs: ['transcoder ready'] } },
      deployments: [
        { name: 'thumbnailer', replicas: 1, selector: { app: 'thumbnailer' }, history: [{ labels: { app: 'thumbnailer' }, containers: [{ name: 'thumbnailer', image: 'registry.lab/thumbnailer:2.2.0', readiness: { path: '/ready', port: 8080 }, resources: { requests: { memory: '384Mi' }, limits: { memory: '512Mi' } } }] }] },
        { name: 'transcoder', replicas: 1, selector: { app: 'transcoder' }, history: [{ labels: { app: 'transcoder' }, containers: [{ name: 'transcoder', image: 'registry.lab/transcoder:5.0.0', readiness: { path: '/ready', port: 8080 }, liveness: { path: '/live', port: 8080, initialDelay: 10, period: 10, failureThreshold: 3 }, resources: { requests: { memory: '384Mi' }, limits: { memory: '512Mi' } } }] }] }
      ],
      services: []
    }),
    objectives: [
      { id: 'oom', stage: 'evidence', text: 'Show what terminated thumbnailer\'s last container',
        hint: 'Exit code alone says "SIGKILL". The container\'s last state says who and why.',
        reveal: function (c) { return 'kubectl describe pod ' + podName(c, 'thumbnailer'); },
        done: function (c) { return did(c, /kubectl\b.*\b(describe\s+(po|pods?)\s+thumbnailer|get\s+(po|pods?)\s+thumbnailer\S*\s.*-o\s*(yaml|json))/, /OOMKilled/); } },
      { id: 'notoom', stage: 'evidence', text: 'Show what terminated transcoder\'s last container — and that it was not memory',
        hint: 'Same exit code, different last-state reason. What else can SIGKILL a container?',
        hint2: 'Describe transcoder: reason, exit code, and the probe events.',
        reveal: function (c) { return 'kubectl describe pod ' + podName(c, 'transcoder'); },
        done: function (c) { return did(c, /kubectl\b.*\bdescribe\s+(po|pods?)\s+transcoder/, /Reason:\s+Error[\s\S]*Exit Code:\s+137[\s\S]*(Liveness probe failed|failed liveness probe)/); } },
      { id: 'usage', stage: 'evidence', text: 'Compare thumbnailer\'s memory use with its limit',
        hint: 'The limit is in the spec; usage comes from metrics.',
        reveal: 'kubectl top pod',
        done: function (c) { return did(c, /kubectl\b.*\btop\s+(po|pods?)\b/, /thumbnailer/); } },
      { id: 'memfix', stage: 'fix', text: 'Stop thumbnailer\'s OOM kills at their cause',
        hint: 'It genuinely needs ~700Mi for a 64-image batch. Give it a limit (and request) that fits, or reduce the batch.',
        hint2: 'kubectl set resources with a memory limit comfortably above observed use.',
        reveal: 'kubectl set resources deploy thumbnailer --limits=memory=1Gi --requests=memory=768Mi',
        done: function (c) { return complete(c, 'thumbnailer') && stable(c, 'thumbnailer', 60); } },
      { id: 'probefix', stage: 'fix', text: 'Stop transcoder\'s kills at their cause, keeping a liveness check',
        hint: 'More memory will not help a probe that gives up before the app has booted.',
        hint2: 'Add a startupProbe with a budget longer than the ~60s boot, or delay liveness.',
        reveal: 'kubectl patch deploy transcoder -p \'{"spec":{"template":{"spec":{"containers":[{"name":"transcoder","startupProbe":{"httpGet":{"path":"/live","port":8080},"periodSeconds":10,"failureThreshold":10}}]}}}}\'',
        done: function (c) { var d = dep(c, 'transcoder'); return d && !!d.template.containers[0].liveness && complete(c, 'transcoder') && stable(c, 'transcoder', 80); } },
      { id: 'verify', stage: 'verify', text: 'Verify both workloads are Ready with no new restarts',
        hint: 'Restart counts on the current pods tell you.',
        reveal: 'kubectl get pods',
        done: function (c) {
          return stable(c, 'thumbnailer', 60) && stable(c, 'transcoder', 80) &&
            lastIs(c, /kubectl\b.*\bget\s+(po|pods?)\b/, /thumbnailer-\S+\s+1\/1\s+Running\s+0\s[\s\S]*transcoder-\S+\s+1\/1\s+Running\s+0\s|transcoder-\S+\s+1\/1\s+Running\s+0\s[\s\S]*thumbnailer-\S+\s+1\/1\s+Running\s+0\s/);
        } }
    ],
    onsite: {
      spoilers: ['OOM', 'liveness', 'probe', 'SIGKILL', '137'],
      neutralTitle: 'Media workers restarting',
      neutralBrief: 'Two media workers, thumbnailer and transcoder, restart repeatedly. A teammate proposes doubling memory limits on both. Yesterday thumbnailer\'s batch size was raised and transcoder moved to a new base image. Find what is terminating each, fix each at its cause, and verify.',
      impact: 'Thumbnail and transcode jobs are delayed; retries are piling up.',
      changes: 'thumbnailer: batch size raised. transcoder: new base image, slower boot.',
      assumptions: ['Nodes have room for about 1Gi more per worker.', 'Removing liveness checking is not acceptable.'],
      clues: ['Both show 137 — the shared number is the trap.', 'Doubling transcoder\'s memory would change nothing: it uses ~250Mi of 512Mi.'],
      mechanism: 'Exit code 137 means the process received SIGKILL (128 + 9). For thumbnailer the kernel\'s OOM killer sent it, because the container exceeded its cgroup memory limit; Kubernetes records that as reason OOMKilled. For transcoder the kubelet sent it: the liveness probe failed while the app was still booting, the kubelet asked it to stop with SIGTERM, and because this process ignores SIGTERM it was killed with SIGKILL after the grace period — also 137, but reason Error, with Unhealthy/Killing events. Same number, two mechanisms, two different fixes.',
      alternatives: [
        { h: 'Both are OOM', out: 'Ruled out for transcoder: reason Error, usage well under the limit, and liveness events precede each kill.' },
        { h: 'Node-pressure eviction', out: 'Ruled out: eviction replaces the pod with status Evicted; here the same pods restart their containers.' },
        { h: 'Application crash', out: 'Ruled out: an app crash exits with its own code (e.g. 1), not a signal.' }
      ],
      summaryPrompt: 'Explain in 4–5 sentences why "137 on both" did not mean the same thing, and what you did about each.',
      summaryChecklist: ['137 = SIGKILL, not proof of OOM', 'OOMKilled evidence for thumbnailer (reason + usage vs limit)', 'Liveness-kill evidence for transcoder (events, reason Error, SIGTERM ignored)', 'Two different fixes, each at the cause', 'Verification by restart counts over time'],
      prereqs: ['les-resources', 'les-probes', 'les-pod-lifecycle'],
      questions: ['ons-q-trouble-07', 'ons-q-trouble-02', 'ons-q-trouble-10'],
      refs: [{ t: 'Assign memory resources', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/' },
             { t: 'Pod termination', u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination' }],
      simplified: SIMPLIFIED.concat(['Memory use is a fixed number per app version; real usage grows and varies. top shows that modelled number.']),
      palette: GENERIC
    }
  });

  /* ═══ 8. Pending storage claim ═══════════════════════════════════ */
  LX.missions.push({
    id: 'ons-lab-08', track: 'onsite', cat: 'lab', level: 'intermediate', mins: 18, kind: 'incident',
    title: 'ledger-db will not start in the new environment: storage claim Pending',
    brief: 'The ledger service is being brought up in a new environment using manifests copied from the existing one. ledger-db has been Pending for 20 minutes. Nothing has been written yet — the claim never bound. The manifests are in ~/ledger/. Get ledger-db running on storage that exists here, and verify. Do not touch ledger-scratch, which belongs to a batch job that has not been scheduled yet.',
    keys: ['kubectl get pods', 'kubectl describe pod ', 'kubectl get pvc', 'kubectl describe pvc ledger-data', 'kubectl get storageclass',
      'cat ledger/pvc.yaml', 'sed -i \'s/fast-ssd/standard/\' ledger/pvc.yaml', 'kubectl delete pvc ledger-data', 'kubectl apply -f ledger/pvc.yaml'],
    world: world({
      namespace: 'ledger', context: 'lab-sim', nodes: simNodes(2),
      registry: { 'registry.lab/ledger-db:14.2': { arch: ['amd64'] } },
      apps: { 'registry.lab/ledger-db': { port: 5432, readyPath: '/ready', livePath: '/live', startSec: 8, memMi: 400, boot: ['ledger-db: initialising data directory on /data', 'ledger-db ready on :{port}'] } },
      storageclasses: [{ name: 'standard', provisioner: 'lab.local/local-path', bindingMode: 'WaitForFirstConsumer', reclaimPolicy: 'Delete', default: true },
                       { name: 'retained', provisioner: 'lab.local/local-path', bindingMode: 'WaitForFirstConsumer', reclaimPolicy: 'Retain' }],
      pvcs: [{ name: 'ledger-data', storageClassName: 'fast-ssd', request: '20Gi', accessModes: ['ReadWriteOnce'], created: 6000 },
             { name: 'ledger-scratch', request: '5Gi', accessModes: ['ReadWriteOnce'], created: 6000 }],
      deployments: [{ name: 'ledger-db', replicas: 1, selector: { app: 'ledger-db' }, maxSurge: 0, maxUnavailable: 1, history: [
        { labels: { app: 'ledger-db' }, volumes: [{ name: 'data', pvc: 'ledger-data' }], containers: [{ name: 'db', image: 'registry.lab/ledger-db:14.2', ports: [{ containerPort: 5432 }], readiness: { port: 5432 } }] }] }],
      services: []
    }, [
      { path: '/home/lab/ledger/pvc.yaml', content: 'apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: ledger-data\n  namespace: ledger\nspec:\n  accessModes:\n    - ReadWriteOnce\n  storageClassName: fast-ssd\n  resources:\n    requests:\n      storage: 20Gi\n' },
      { path: '/home/lab/ledger/README', content: 'Copied from the existing environment on Monday. Apply pvc.yaml before the deployment.\n' }
    ]),
    objectives: [
      { id: 'pod', stage: 'evidence', text: 'Find what is holding the ledger-db pod',
        hint: 'Pending — but is it waiting on a node, or on something the node needs first?',
        hint2: 'describe pod: the FailedScheduling event says what the scheduler is waiting for.',
        reveal: function (c) { return 'kubectl describe pod ' + podName(c, 'ledger-db'); },
        done: function (c) { return did(c, /kubectl\b.*\b(describe\s+(po|pods?)|get\s+(events?|ev)|events)\b/, /unbound immediate PersistentVolumeClaims/); } },
      { id: 'claim', stage: 'evidence', text: 'Find why the ledger-data claim cannot bind',
        hint: 'The claim has its own events.',
        reveal: 'kubectl describe pvc ledger-data',
        done: function (c) { return did(c, /kubectl\b.*\b(describe\s+(pvc|persistentvolumeclaims?)|get\s+(events?|ev)|events)\b/, /storageclass\.storage\.k8s\.io "fast-ssd" not found/); } },
      { id: 'classes', stage: 'evidence', text: 'List the storage classes this environment actually has',
        hint: 'Manifests copied between environments carry the old environment\'s names. What does this one offer?',
        hint2: 'StorageClasses are cluster-scoped; list them and note which is the default and its binding mode.',
        reveal: 'kubectl get storageclass',
        done: function (c) { return did(c, /kubectl\b.*\bget\s+(sc|storageclass(es)?)\b/, /standard/); } },
      { id: 'bound', stage: 'fix', text: 'Get ledger-data bound on a class that exists and ledger-db running',
        hint: 'A claim\'s storage class cannot be edited in place. It never bound, so there is no data to lose.',
        hint2: 'Fix the manifest, delete the unbound claim, apply the corrected one. The waiting pod will schedule by itself.',
        reveal: function (c) {
          var f = LXShell.node(c.w, '/home/lab/ledger/pvc.yaml'), pvc = K().find(M(c), 'pvcs', 'ledger-data', M(c).ns);
          if (f && /fast-ssd/.test(f.content || '')) return 'sed -i \'s/fast-ssd/standard/\' ledger/pvc.yaml';
          if (pvc && pvc.storageClassName === 'fast-ssd') return 'kubectl delete pvc ledger-data';
          return 'kubectl apply -f ledger/pvc.yaml';
        },
        done: function (c) {
          var pvc = K().find(M(c), 'pvcs', 'ledger-data', M(c).ns);
          return pvc && pvc.phase === 'Bound' && K().find(M(c), 'storageclasses', pvc.storageClassName) && readyOf(c, 'ledger-db') === 1 &&
                 !!K().find(M(c), 'pvcs', 'ledger-scratch', M(c).ns);
        } },
      { id: 'verify', stage: 'verify', text: 'Verify the claim is Bound and ledger-db is Ready',
        hint: 'Check both halves: the claim and the pod that uses it.',
        reveal: 'kubectl get pvc,pods',
        done: function (c) {
          var pvc = K().find(M(c), 'pvcs', 'ledger-data', M(c).ns);
          return pvc && pvc.phase === 'Bound' && readyOf(c, 'ledger-db') === 1 &&
            (lastIs(c, /kubectl\b.*\bget\s+(pvc|persistentvolumeclaims?)\b/, /ledger-data\s+Bound/) || lastIs(c, /kubectl\b.*\bget\s+(po|pods?)\b/, /ledger-db-\S+\s+1\/1\s+Running/));
        } }
    ],
    onsite: {
      spoilers: ['StorageClass', 'storage class', 'fast-ssd', 'PVC', 'claim', 'PersistentVolume', 'Pending'],
      neutralTitle: 'ledger-db not starting in the new environment',
      neutralBrief: 'The ledger service is being brought up in a new environment from copied manifests (in ~/ledger/). ledger-db has not started after 20 minutes. Nothing has been written yet. Get it running and verify. Leave ledger-scratch alone — it belongs to a batch job not yet scheduled.',
      impact: 'Environment bring-up is blocked.',
      changes: 'New environment; manifests copied from an existing one.',
      assumptions: ['This environment offers the storage classes listed by the cluster; creating new classes is out of scope.', 'The claim never bound, so deleting it loses no data. That would not be true for a Bound claim.'],
      clues: ['ledger-scratch is Pending with "waiting for first consumer" — that is normal for WaitForFirstConsumer until a pod uses it.',
              'The pod is not failing on image or memory — it has not been scheduled at all.'],
      mechanism: 'A pod that mounts a claim cannot be scheduled until the claim can bind (or, with WaitForFirstConsumer, until the scheduler can pick a node and trigger provisioning). ledger-data named a StorageClass that exists in the old environment but not here, so no provisioner would ever act on it. Most of a claim\'s spec is immutable after creation, so the fix is to recreate the (empty, unbound) claim with a class that exists. With WaitForFirstConsumer the volume is provisioned when the waiting pod is scheduled.',
      alternatives: [
        { h: 'Insufficient node resources', out: 'Ruled out: the scheduler message names the unbound claim, not CPU or memory.' },
        { h: 'ledger-scratch is broken too', out: 'Ruled out: it is WaitForFirstConsumer with no consumer yet — expected.' },
        { h: 'Provisioner down', out: 'Would show a class that exists but no ProvisioningSucceeded; here the class itself is missing.' }
      ],
      summaryPrompt: 'Write the 3–4 sentence note for the bring-up checklist explaining what failed and how to catch it earlier.',
      summaryChecklist: ['Pod blocked on claim; claim blocked on missing class (evidence)', 'Why recreation was safe here (never bound) and when it would not be', 'WaitForFirstConsumer is normal for ledger-scratch', 'Verification', 'Prevention: environment-specific values validated before apply; preflight that lists storage classes'],
      prereqs: ['les-storage'],
      questions: ['ons-q-config-01', 'ons-q-config-06', 'ons-q-config-07'],
      refs: [{ t: 'Persistent volumes', u: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/' },
             { t: 'Storage classes', u: 'https://kubernetes.io/docs/concepts/storage/storage-classes/' }],
      simplified: SIMPLIFIED.concat(['Provisioning is instantaneous and always succeeds for an existing class; attach/mount failures and topology are not modelled.']),
      palette: GENERIC.concat(['cat ', 'sed -i ', 'kubectl apply -f '])
    }
  });

  /* ═══ 9. API access denied by RBAC ═══════════════════════════════ */
  LX.missions.push({
    id: 'ons-lab-09', track: 'onsite', cat: 'lab', level: 'intermediate', mins: 15, kind: 'incident',
    title: 'stock-sync Running and Ready, but not syncing: API access denied',
    brief: 'Inventory counts stopped updating after last week\'s namespace migration from inventory-old to inventory. The stock-sync pod is Running and Ready and nobody has touched its Deployment. It reads ConfigMaps through the Kubernetes API. Restore syncing with least privilege, and verify.',
    keys: ['kubectl logs deploy/stock-sync', 'kubectl auth can-i list configmaps --as=system:serviceaccount:inventory:stock-sync',
      'kubectl get rolebindings', 'kubectl describe rolebinding stock-sync-read', 'kubectl describe role configmap-reader',
      'kubectl create rolebinding stock-sync-read-v2 --role=configmap-reader --serviceaccount=inventory:stock-sync'],
    world: world({
      namespace: 'inventory', context: 'lab-sim', nodes: simNodes(2),
      registry: { 'registry.lab/stock-sync:1.6.0': { arch: ['amd64'] } },
      apps: { 'registry.lab/stock-sync': { port: 8080, readyPath: '/healthz', livePath: '/healthz', startSec: 3, memMi: 80,
        boot: ['stock-sync starting', 'WARN supplier feed responded slowly (2.1s)'], needsApi: { verb: 'list', resource: 'configmaps' }, apiOkLog: 'sync ok: 3 stock ConfigMaps reconciled' } },
      serviceaccounts: [{ name: 'stock-sync' }],
      roles: [{ name: 'configmap-reader', rules: [{ apiGroups: [''], verbs: ['get', 'list', 'watch'], resources: ['configmaps'] }] }],
      rolebindings: [{ name: 'stock-sync-read', roleRef: { kind: 'Role', name: 'configmap-reader' }, subjects: [{ kind: 'ServiceAccount', name: 'stock-sync', namespace: 'inventory-old' }] }],
      configmaps: [{ name: 'stock-warehouse-a', data: { units: '1200' } }, { name: 'stock-warehouse-b', data: { units: '430' } }, { name: 'stock-warehouse-c', data: { units: '87' } }],
      deployments: [{ name: 'stock-sync', replicas: 1, selector: { app: 'stock-sync' }, history: [{ labels: { app: 'stock-sync' }, serviceAccount: 'stock-sync', containers: [{ name: 'sync', image: 'registry.lab/stock-sync:1.6.0', readiness: { path: '/healthz', port: 8080 } }] }] }],
      services: []
    }),
    objectives: [
      { id: 'logs', stage: 'evidence', text: 'Find what the running application is reporting',
        hint: 'Ready only means the health endpoint answered.',
        reveal: 'kubectl logs deploy/stock-sync',
        done: function (c) { return did(c, /kubectl\b.*\blogs?\b/, /forbidden/); } },
      { id: 'cani', stage: 'evidence', text: 'Confirm the denial as the workload\'s own identity',
        hint: 'You are an admin; the pod is not. Ask the API as the pod\'s ServiceAccount.',
        hint2: 'auth can-i with --as=system:serviceaccount:NAMESPACE:NAME',
        reveal: 'kubectl auth can-i list configmaps --as=system:serviceaccount:inventory:stock-sync',
        done: function (c) { return did(c, /kubectl\b.*\bauth\s+can-i\b.*--as[= ]system:serviceaccount:inventory:stock-sync/, /^no/m); } },
      { id: 'binding', stage: 'evidence', text: 'Find the binding that should grant access, and why it does not',
        hint: 'A binding connects a role to subjects. Read the subject carefully.',
        reveal: 'kubectl describe rolebinding stock-sync-read',
        done: function (c) { return did(c, /kubectl\b.*\b(describe\s+(rolebindings?|rb)|get\s+(rolebindings?|rb)\b.*-o\s*(yaml|json))/, /inventory-old/); } },
      { id: 'least', stage: 'fix', text: 'Grant stock-sync exactly the access it needs — and no more',
        hint: 'The Role is right; the subject is wrong. Subjects can be changed; roleRef cannot.',
        hint2: 'Patch the binding\'s subjects to the inventory namespace, or create a new RoleBinding to the same Role.',
        reveal: 'kubectl create rolebinding stock-sync-read-v2 --role=configmap-reader --serviceaccount=inventory:stock-sync',
        done: function (c) {
          var m = M(c), sub = 'system:serviceaccount:inventory:stock-sync';
          return K().canI(m, sub, 'list', 'configmaps', 'inventory') && !K().canI(m, sub, 'delete', 'configmaps', 'inventory') &&
                 !K().canI(m, sub, 'list', 'secrets', 'inventory') && !K().canI(m, sub, 'list', 'configmaps', 'default');
        } },
      { id: 'verify', stage: 'verify', text: 'Verify the application syncs again',
        hint: 'The app retries every 30 seconds; its next log line tells you.',
        reveal: 'kubectl logs deploy/stock-sync',
        done: function (c) {
          var m = M(c), sub = 'system:serviceaccount:inventory:stock-sync';
          return K().canI(m, sub, 'list', 'configmaps', 'inventory') && lastIs(c, /kubectl\b.*\blogs?\b/, /sync ok[^\n]*\n?$/);
        } }
    ],
    onsite: {
      spoilers: ['RBAC', 'forbidden', 'RoleBinding', 'inventory-old', 'ServiceAccount', 'permission'],
      neutralTitle: 'Inventory counts not updating',
      neutralBrief: 'Inventory counts stopped updating after last week\'s namespace migration. The stock-sync workload looks healthy on the dashboard and its Deployment has not changed. Find the cause, restore syncing safely, and verify.',
      impact: 'Stock levels shown to customers are stale.',
      changes: 'Namespace migration from inventory-old to inventory last week.',
      assumptions: ['The configmap-reader Role reflects what stock-sync needs.', 'Cluster-wide grants are not acceptable.'],
      clues: ['The WARN about a slow supplier feed appears on every start; it is not the failure.', 'The pod is Running and Ready: its health endpoint does not exercise API access.'],
      mechanism: 'The pod authenticates to the API server as its ServiceAccount (system:serviceaccount:inventory:stock-sync). RBAC authorises by matching that exact identity against binding subjects; the old binding still named the ServiceAccount in inventory-old, so nothing granted the new identity anything and every list was denied. RBAC is additive with no deny rules, so the fix is a binding with the right subject to the same narrow Role; binding a broad ClusterRole like edit or cluster-admin would also "work" and silently over-grant.',
      alternatives: [
        { h: 'The Role lacks list', out: 'Ruled out: describe role shows get/list/watch on configmaps.' },
        { h: 'Network policy blocking the API server', out: 'Would time out; here the API answers with an explicit forbidden.' },
        { h: 'The app is unhealthy', out: 'Ruled out: it is Running/Ready and logs its failure clearly.' }
      ],
      summaryPrompt: 'In 3–4 sentences, explain the denial and how you proved the fix is least-privilege.',
      summaryChecklist: ['Identity: the ServiceAccount, fully qualified', 'Binding subject pointed at the old namespace (evidence)', 'Fix scoped to one Role in one namespace; can-i checks for what is still denied', 'Verification via app logs', 'Prevention: migrations re-render bindings; a can-i check in post-deploy validation'],
      prereqs: ['les-identity'],
      questions: ['ons-q-config-02', 'ons-q-config-04'],
      refs: [{ t: 'Using RBAC authorization', u: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/' },
             { t: 'Service accounts', u: 'https://kubernetes.io/docs/concepts/security/service-accounts/' }],
      simplified: SIMPLIFIED.concat(['RBAC evaluation covers Roles, ClusterRoles and their bindings for core resources only; aggregation, resourceNames and non-resource URLs are not modelled.']),
      palette: GENERIC.concat(['kubectl get rolebindings', 'kubectl describe rolebinding ', 'kubectl create rolebinding '])
    }
  });

  /* ═══ 10. Disconnected release missing a dependency ══════════════ */
  LX.missions.push({
    id: 'ons-lab-10', track: 'onsite', cat: 'lab', level: 'advanced', mins: 25, kind: 'incident',
    title: 'Edge site: release 4.2 cannot start — an image is missing from the local mirror',
    brief: 'An edge appliance runs disconnected from the internet; its cluster pulls only from the site mirror (mirror.site.lab). Release 4.2 of edge-gateway was applied 7 minutes ago and its new pod cannot start. Two transfer bundles are waiting on the import host. The site admission policy only admits images signed by a trusted key. Get release 4.2 running using only trustworthy artifacts, and verify.',
    keys: ['kubectl get pods', 'kubectl describe pod ', 'lab-registry help', 'lab-registry diff 4.2', 'lab-registry bundles', 'lab-registry keys',
      'lab-registry verify ', 'lab-registry import ', 'kubectl rollout status deploy/edge-gateway', 'kubectl describe rs '],
    world: world({
      namespace: 'edge', context: 'lab-sim',
      nodes: [{ name: 'edge-node-1', cpu: 4000, mem: 8192, arch: 'arm64' }, { name: 'edge-node-2', cpu: 4000, mem: 8192, arch: 'arm64' }],
      reachable: ['mirror.site.lab'],
      trustedKeys: ['release-signing-2026'],
      policy: { requireSignature: true },
      registry: {
        'mirror.site.lab/edge/gateway:4.1.3': { arch: ['amd64', 'arm64'], signedBy: 'release-signing-2026' },
        'mirror.site.lab/edge/gateway:4.2.0': { arch: ['amd64', 'arm64'], signedBy: 'release-signing-2026' },
        'mirror.site.lab/edge/config-agent:2.0.1': { arch: ['amd64', 'arm64'], signedBy: 'release-signing-2026' }
      },
      bundles: {
        'metrics-sidecar-1.3-portal.tar': { images: ['mirror.site.lab/edge/metrics-sidecar:1.3'], signedBy: 'vendor-portal-mirror',
          meta: { 'mirror.site.lab/edge/metrics-sidecar:1.3': { arch: ['amd64'], signedBy: 'vendor-portal-mirror' } } },
        'release-4.2-supplement.tar': { images: ['mirror.site.lab/edge/metrics-sidecar:1.3'], signedBy: 'release-signing-2026',
          meta: { 'mirror.site.lab/edge/metrics-sidecar:1.3': { arch: ['amd64', 'arm64'], signedBy: 'release-signing-2026' } } }
      },
      releases: { '4.2': ['mirror.site.lab/edge/gateway:4.2.0', 'mirror.site.lab/edge/metrics-sidecar:1.3', 'mirror.site.lab/edge/config-agent:2.0.1'] },
      apps: { 'mirror.site.lab/edge/gateway': { port: 8443, readyPath: '/ready', livePath: '/live', startSec: 5, memMi: 150, boot: ['edge-gateway listening on :{port}'] },
              'mirror.site.lab/edge/metrics-sidecar': { port: 9100, readyPath: '/metrics', livePath: '/metrics', startSec: 2, memMi: 30, boot: ['metrics sidecar on :{port}'] },
              'mirror.site.lab/edge/config-agent': { port: 8081, readyPath: '/', livePath: '/', startSec: 2, memMi: 30 },
              'docker.io/library/busybox': { port: 8080, startSec: 1, memMi: 5 } },
      deployments: [
        { name: 'edge-gateway', replicas: 2, selector: { app: 'edge-gateway' }, changedAgo: 420, history: [
          { labels: { app: 'edge-gateway' }, containers: [{ name: 'gateway', image: 'mirror.site.lab/edge/gateway:4.1.3', readiness: { path: '/ready', port: 8443 } }] },
          { labels: { app: 'edge-gateway' }, containers: [{ name: 'gateway', image: 'mirror.site.lab/edge/gateway:4.2.0', readiness: { path: '/ready', port: 8443 } },
                                                          { name: 'metrics', image: 'mirror.site.lab/edge/metrics-sidecar:1.3' }] }
        ] },
        { name: 'config-agent', replicas: 1, selector: { app: 'config-agent' }, history: [{ labels: { app: 'config-agent' }, containers: [{ name: 'agent', image: 'mirror.site.lab/edge/config-agent:2.0.1' }] }] }
      ],
      pods: [{ name: 'net-debug', at: 5000, labels: { run: 'net-debug' }, spec: { containers: [{ name: 'net-debug', image: 'docker.io/library/busybox:1.36' }] } }],
      services: [{ name: 'edge-gateway', selector: { app: 'edge-gateway' }, clusterIP: '10.96.9.9', ports: [{ port: 443, targetPort: 8443 }] }]
    }),
    objectives: [
      { id: 'pullerr', stage: 'evidence', text: 'Find exactly why the new edge-gateway pod cannot start',
        hint: 'Which image, and what did the registry say? "Not found" and "no such host" mean different things.',
        reveal: function (c) { return 'kubectl describe pod ' + podName(c, 'edge-gateway', notReady); },
        done: function (c) { return did(c, /kubectl\b.*\b(describe\s+(po|pods?)|get\s+(events?|ev)|events)\b/, /metrics-sidecar:1\.3[^\n]*not found/); } },
      { id: 'inventory', stage: 'evidence', text: 'Check the release\'s full image inventory against the mirror',
        hint: 'One missing image may not be the only one. Compare the whole release.',
        reveal: 'lab-registry diff 4.2',
        done: function (c) { return did(c, /lab-registry\s+diff\b/, /MISSING/); } },
      { id: 'trust', stage: 'evidence', text: 'Verify candidate bundles against the site\'s trusted keys before importing anything',
        hint: 'Two bundles claim to contain the image. Which one can you trust, and how do you know?',
        hint2: 'lab-registry verify each bundle; compare the signer with lab-registry keys.',
        reveal: 'lab-registry verify release-4.2-supplement.tar',
        done: function (c) { return did(c, /lab-registry\s+verify\s+release-4\.2-supplement\.tar/, /PASS|verified|OK/i); } },
      { id: 'import', stage: 'fix', text: 'Import the trustworthy artifact and get release 4.2 fully rolled out',
        hint: 'Only a bundle signed by a trusted key will pass admission; the arm64 nodes also need an arm64 image.',
        hint2: 'Import the verified bundle. The stuck pod retries on its back-off; deleting that one pod makes it retry now.',
        reveal: 'lab-registry import release-4.2-supplement.tar',
        done: function (c) {
          var e = M(c).registry['mirror.site.lab/edge/metrics-sidecar:1.3'];
          return e && e.signedBy === 'release-signing-2026' && complete(c, 'edge-gateway') && readyOf(c, 'edge-gateway') === 2;
        } },
      { id: 'verify', stage: 'verify', text: 'Verify the rollout completed on 4.2',
        hint: 'The release is done when the Deployment says so — ask it again now.',
        reveal: 'kubectl rollout status deploy/edge-gateway',
        done: function (c) {
          var d = dep(c, 'edge-gateway');
          return complete(c, 'edge-gateway') && d.template.containers[0].image === 'mirror.site.lab/edge/gateway:4.2.0' &&
            lastOk(c, /kubectl\b.*\b(rollout\s+status|get\s+(deploy|deployments?))\b/, /successfully rolled out|edge-gateway\s+2\/2\s+2\s+2/);
        } }
    ],
    onsite: {
      spoilers: ['metrics-sidecar', 'sidecar', 'missing', 'not found'],
      neutralTitle: 'Edge site: release 4.2 not starting',
      neutralBrief: 'An edge appliance runs disconnected; its cluster pulls only from the site mirror. Release 4.2 of edge-gateway was applied 7 minutes ago and has not come up. Two transfer bundles are waiting on the import host. The site only runs images signed by a trusted key. Get 4.2 running using only trustworthy artifacts, and verify.',
      impact: 'The site keeps running 4.1.3; the 4.2 security fix is not deployed.',
      changes: 'Release 4.2 adds a metrics sidecar image.',
      assumptions: ['"Disconnected" is SIMULATED: the model refuses pulls from any host but mirror.site.lab. It is not real network isolation.',
                    'lab-registry is a simulated stand-in for a registry client and signature tool; it is not a real command.',
                    'The site\'s trusted key (release-signing-2026) arrived through a separate, trusted channel before this incident.'],
      clues: ['net-debug is someone\'s old debugging pod trying to pull from docker.io — "no such host" is expected at a disconnected site and unrelated.',
              'config-agent is healthy and part of 4.2 already.'],
      mechanism: 'Inside a disconnected site, everything a release needs must already be in the local mirror. 4.2 added a sidecar image that was never transferred, so the kubelet got "not found" from the mirror (distinct from "no such host", which means the registry name itself is unreachable). Of the two bundles, only one is signed by the site\'s trusted key — and it is also the one with an arm64 build. A digest or hash would only prove the bytes match what a manifest says; the signature checked against a key distributed in advance is what tells you who published it. Importing the untrusted bundle would have failed admission (FailedCreate on the ReplicaSet) or, without the policy, run an unverified, wrong-architecture image.',
      alternatives: [
        { h: 'Mirror unreachable', out: 'Ruled out: the error is "not found" from mirror.site.lab, and 4.2.0 gateway pulls fine.' },
        { h: 'Use the portal bundle — it has the same tag', out: 'Rejected: same tag, different signer (not trusted) and amd64 only; a tag says nothing about origin.' },
        { h: 'Only the sidecar is missing', out: 'Confirmed with the release inventory, rather than assumed.' }
      ],
      summaryPrompt: 'Write the 4–5 sentence site report: what was missing, how you chose what to import, and how you verified.',
      summaryChecklist: ['Names the missing image with the "not found" evidence', 'Uses the release inventory, not just the first error', 'Explains why one bundle was trusted (signer = pre-distributed key) and one not', 'Mentions architecture (arm64) as a second check', 'Verification of the rollout; prevention: release inventory checked against the mirror before applying'],
      prereqs: ['les-disconnected', 'les-rollouts'],
      questions: ['ons-q-delivery-01', 'ons-q-delivery-02', 'ons-q-delivery-03', 'ons-q-delivery-05'],
      refs: [{ t: 'Images', u: 'https://kubernetes.io/docs/concepts/containers/images/' },
             { t: 'Dynamic admission control', u: 'https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/' }],
      simplified: SIMPLIFIED.concat(['Disconnection is simulated by a list of reachable registry hosts — there is no real network isolation in this lab.',
        'Signatures are modelled as a signer name compared with a trusted-key list; real verification checks cryptographic signatures and, depending on the tool, certificate identities.']),
      palette: GENERIC.concat(['lab-registry help', 'lab-registry diff ', 'lab-registry bundles', 'lab-registry verify ', 'lab-registry import '])
    }
  });
})();
