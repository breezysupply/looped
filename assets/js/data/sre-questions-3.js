/* SRE & Cloud Deployment Foundations — question banks for M09–M12.

   Each module: at least eight original bank items (q-mNN-bKK) plus at least
   four unseen gate variants (q-mNN-gKK) that are different questions, not
   reordered choices. Types: mcq, predict (output/log/config context),
   diagnose (context + choose the cause), order (steps in correct order),
   explain (rubric + model answer, self-reviewed). Selected-response items
   list the correct choice first; the gate shuffles positions. Every item
   has a rationale, misconception feedback, difficulty 1–3, objective tags
   and a remediation lesson. Diagnosis over flag trivia. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreQuestions = LX.sreQuestions || [];
LX.sreReviews = LX.sreReviews || [];

(function () {
  var Q = function (x) { LX.sreQuestions.push(x); };

  /* ═══ M09 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m09-b01', moduleId: 'M09', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m09-01'], remediation: 'les-m09-01',
    context: '$ kubectl describe pod -n beacon beacon-worker-6d9f7c4b8-x2k7p | tail -2\n  Warning  FailedScheduling  9s (x5 over 4m)  default-scheduler  0/3 nodes are available: 1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }, 2 Insufficient memory. preemption: 0/3 nodes are available: 2 No preemption victims found for incoming pod, 1 Preemption is not helpful for scheduling.\n$ kubectl describe node looped-foundations-worker | grep -A3 "Allocated resources"\n  Resource  Requests       Limits\n  cpu       1150m (57%)    2 (100%)\n  memory    2560Mi (66%)   3Gi (79%)\n$ kubectl top pod -n beacon --containers | grep worker\nbeacon-worker-5b7c9d8f6-old   worker   40m   298Mi',
    q: 'The worker\'s memory request was raised to 4Gi this morning. Which change restores scheduling without over-provisioning?',
    choices: ['Set the request from evidence (about 384Mi, limit 512Mi) so it fits a worker node', 'Add a toleration for the control-plane taint so the Pod can land there', 'Delete other Pods on the worker nodes until 4Gi is free', 'Remove the memory request entirely so the scheduler stops checking'],
    a: 0, rationale: 'Two workers failed on memory because 4Gi exceeds their unreserved allocatable; measured usage peaks around 300Mi. A request near the working set fits and is honest. The taint only explains the third node.',
    misconception: 'Tolerating the control-plane taint fixes one of three rejections; dropping the request makes the Pod BestEffort and first to be evicted.' });
  Q({ id: 'q-m09-b02', moduleId: 'M09', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m09-01'], remediation: 'les-m09-02',
    context: '$ kubectl get pod -n beacon beacon-api-7c9d4d5f6-z7t3c -o jsonpath=\'{.status.containerStatuses[0].lastState}\'\n{"terminated":{"exitCode":137,"reason":"OOMKilled","finishedAt":"2026-10-13T10:14:09Z"}}\n$ kubectl logs -n beacon beacon-api-7c9d4d5f6-z7t3c --previous | tail -2\n{"level":"info","msg":"status accepted","sensor_id":"S-0412"}\n{"level":"info","msg":"status accep\n$ kubectl top pod -n beacon beacon-api-7c9d4d5f6-z7t3c --containers\nPOD                          NAME   CPU   MEMORY\nbeacon-api-7c9d4d5f6-z7t3c   api    61m   497Mi   # limit 512Mi, 30s after start',
    q: 'What ended the previous container, and what does the log tell you about it?',
    choices: ['The kernel OOM killer (exit 137) because usage reached the memory limit; the truncated log with no traceback is consistent with SIGKILL', 'The application crashed on a malformed record; the last log line is the error', 'The kubelet sent SIGTERM for a failed liveness probe', 'The Pod was evicted because the node ran out of memory'],
    a: 0, rationale: 'Reason OOMKilled with exit 137 is the cgroup limit being enforced; a SIGKILLed process cannot write a final message, so a mid-line truncation is expected. Usage sitting at the limit immediately after start says the limit is below the working set.',
    misconception: 'A truncated log is read as "no evidence"; with 137 it is the evidence. Node eviction shows as status Evicted, not OOMKilled in lastState.' });
  Q({ id: 'q-m09-b03', moduleId: 'M09', pool: 'bank', type: 'mcq', difficulty: 1, objectiveIds: ['obj-m09-01'], remediation: 'les-m09-02',
    q: 'A container exits with code 143 repeatedly and the Pod shows CrashLoopBackOff. Which signal does 143 indicate, and what is a likely sender?',
    choices: ['SIGTERM (128 + 15), typically from the kubelet after a failed liveness probe or during a rollout', 'SIGKILL (128 + 9) from the kernel OOM killer', 'An application exit after an unhandled exception', 'SIGHUP from a config reload'],
    a: 0, rationale: 'Exit codes above 128 encode a signal: 143 is SIGTERM, 137 is SIGKILL. A liveness failure makes the kubelet send SIGTERM first; an unhandled exception usually exits 1.',
    misconception: '137 and 143 are often conflated; only 137 with reason OOMKilled is the memory limit.' });
  Q({ id: 'q-m09-b04', moduleId: 'M09', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m09-02'], remediation: 'les-m09-03',
    context: '$ kubectl get storageclass\nNAME                 PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE      AGE\nstandard (default)   rancher.io/local-path   Delete          WaitForFirstConsumer   3d\n$ kubectl apply -f pvc.yaml   # 5Gi, RWO, no storageClassName, no Pod uses it yet\n$ sleep 60; kubectl get pvc -n beacon data-beacon-db-0\nNAME               STATUS    VOLUME   CAPACITY   STORAGECLASS   AGE\ndata-beacon-db-0   Pending                       standard       60s',
    q: 'Is this claim broken? What will `kubectl describe pvc` say, and what makes it Bound?',
    choices: ['Not broken: the event says waiting for first consumer; it binds when a Pod using the claim is scheduled', 'Broken: no storage class was set so nothing will provision it', 'Broken: the provisioner failed; recreate the claim with Immediate binding', 'Broken: 5Gi exceeds what local-path can provide'],
    a: 0, rationale: 'The class is the default and uses WaitForFirstConsumer, so a claim with no consuming Pod stays Pending by design. Scheduling the Pod triggers provisioning on that node.',
    misconception: 'Pending is read as failure; under WaitForFirstConsumer it is the normal pre-consumer state and switching to Immediate can place the volume where the Pod cannot run.' });
  Q({ id: 'q-m09-b05', moduleId: 'M09', pool: 'bank', type: 'explain', difficulty: 2, objectiveIds: ['obj-m09-02'], remediation: 'les-m09-03',
    q: 'You deleted the Beacon database Pod on a single-node kind cluster and the recreated Pod had all its rows. Write the limit statement for the evidence report: what was proven and what was not, and what would be needed for the rest.',
    rubric: ['States that persistence across Pod replacement on a local-path (node-local) volume was proven', 'States that survival of node loss or zone loss was not demonstrated', 'Explains why: the PV is a directory on that node with node affinity', 'Names replication (database-level or replicated storage) as what multi-node/zone durability requires'],
    answer: 'The test proved that the PVC and its data outlive the container: the StatefulSet reattached the same claim and the rows were present. It did not prove durability beyond this node, because the local-path PV is a directory on the node and the claim is pinned to it; if the node were lost the data would be lost. Surviving node or zone loss requires replication, either PostgreSQL streaming replication or storage that replicates, neither of which this lab exercised.',
    rationale: 'Honest scoping of what a local volume proves is a pass condition; a PVC setting cannot create durability the storage does not have.',
    misconception: 'Surviving a Pod restart is reported as "data is durable", which overstates what a node-local volume provides.' });
  Q({ id: 'q-m09-b06', moduleId: 'M09', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m09-04'], remediation: 'les-m09-04',
    context: '$ kubectl logs -n beacon deploy/beacon-worker | tail -1\nconfigmaps "beacon-config" is forbidden: User "system:serviceaccount:beacon:beacon-worker" cannot get resource "configmaps" in API group "" in the namespace "beacon"\n$ kubectl auth can-i --list -n beacon --as=system:serviceaccount:beacon:beacon-worker\nResources   Non-Resource URLs   Resource Names   Verbs\n            [/api/*]                             [get]\n            [/healthz]                           [get]',
    q: 'Which change is the least-privilege fix?',
    choices: ['A Role allowing get (and watch) on configmaps with resourceNames beacon-config, bound to beacon-worker by a RoleBinding', 'Bind the built-in edit ClusterRole to beacon-worker in the namespace', 'Bind cluster-admin to the default service account', 'Mount the ConfigMap as a volume instead, which bypasses RBAC'],
    a: 0, rationale: 'The Forbidden message names the resource, verb, group and namespace exactly; a Role with those fields and the resource name, bound to this account, grants nothing more.',
    misconception: 'Reaching for edit or cluster-admin fixes the symptom with far wider rights; a volume mount does not change what the worker\'s token can do and does not address the code that calls the API.' });
  Q({ id: 'q-m09-b07', moduleId: 'M09', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m09-04'], remediation: 'les-m09-04',
    q: 'Why does the course require a real API call with the Pod\'s token after `kubectl auth can-i --as=system:serviceaccount:beacon:beacon-api` says yes?',
    choices: ['can-i tests only the authorisation rules; the real call also proves the token is mounted, the CA is trusted and the API is reachable from the Pod', 'can-i is unreliable for service accounts', 'The real call is needed to create the RoleBinding', 'can-i only works for cluster-scoped resources'],
    a: 0, rationale: 'Authorisation is one step of the path. A Pod with automountServiceAccountToken false, a NetworkPolicy blocking the API, or a wrong audience would still fail despite a yes.',
    misconception: 'A rule check is mistaken for an end-to-end check.' });
  Q({ id: 'q-m09-b08', moduleId: 'M09', pool: 'bank', type: 'predict', difficulty: 3, objectiveIds: ['obj-m09-03'], remediation: 'les-m09-05',
    context: 'apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata: { name: default-deny, namespace: beacon }\nspec:\n  podSelector: {}\n  policyTypes: [Ingress, Egress]\n---\n$ kubectl get pods -n kube-system -l k8s-app=calico-node -o name\npod/calico-node-7x2qk\n$ kubectl rollout restart deploy/beacon-api -n beacon',
    q: 'This is the only policy in the namespace. What does the API Pod log on its first database connection attempt?',
    choices: ['A DNS resolution failure for beacon-db after a timeout: egress to CoreDNS on port 53 is now dropped', 'Connection refused on beacon-db:5432', 'Nothing changes: a policy with no rules allows everything', 'A TLS error because the CA is unreachable'],
    a: 0, rationale: 'Calico enforces. An egress default deny with no allow rule drops the UDP/TCP 53 packets to kube-system first, so name resolution fails before any TCP connect; a drop times out rather than refusing.',
    misconception: 'Empty rule lists are read as "allow all"; selecting a Pod with policyTypes set and no rules is the definition of default deny.' });
  Q({ id: 'q-m09-b09', moduleId: 'M09', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m09-03'], remediation: 'les-m09-05',
    context: '$ kubectl get networkpolicy -n beacon\nNAME           POD-SELECTOR    AGE\ndefault-deny   <none>          10m\ndb-allow       app=beacon-db   10m\n$ kubectl run -n beacon probe --rm -it --restart=Never --image=registry.lab/tools/netshoot:2025.10 -- nc -zv beacon-db 5432\nbeacon-db (10.96.14.2:5432) open\n$ kubectl get pods -n kube-system -o name | grep -E \'calico|cilium\'\n$ kubectl get pods -n kube-system -l app=kindnet -o name\npod/kindnet-9fz2x',
    q: 'The unlabelled probe reached the database. What is the standing explanation?',
    choices: ['Nothing enforces the policy: the cluster runs kindnet, which does not implement NetworkPolicy', 'The db-allow policy matches the probe because it has no labels', 'default-deny is missing policyTypes so it only affects ingress', 'The Service bypasses NetworkPolicy; only Pod IPs are filtered'],
    a: 0, rationale: 'Policies are stored by the API regardless of enforcement. No Calico or Cilium Pods and a kindnet Pod present means the CNI ignores them; the test behaves exactly as if no policy existed.',
    misconception: 'A clean apply is taken as enforcement. Service ClusterIPs are translated to Pod IPs before policy applies, so that is not the escape.' });
  Q({ id: 'q-m09-b10', moduleId: 'M09', pool: 'bank', type: 'order', difficulty: 2, objectiveIds: ['obj-m09-05'], remediation: 'les-m09-06',
    q: 'A drain of worker2 is stuck on "Cannot evict pod as it would violate the pod\'s disruption budget". Order the correct response.',
    steps: ['Read the PDB: kubectl get pdb -n beacon shows ALLOWED DISRUPTIONS 0 with minAvailable 2', 'List the selected Pods with -o wide and count how many are Ready and where they run', 'Identify why there is no slack (a CrashLooping replica, or two replicas on the draining node)', 'Restore slack: fix the unready replica or scale the Deployment up temporarily', 'Let the drain continue and confirm the node shows SchedulingDisabled with no app Pods', 'Scale back and record why the budget blocked the drain'],
    rationale: 'The budget is the application\'s stated tolerance; the fix is to restore the slack it expects, not to bypass it with --force or --disable-eviction.',
    misconception: 'Treating the blocked drain as a PDB misconfiguration leads to deleting the budget and taking the outage it was preventing.' });

  Q({ id: 'q-m09-g01', moduleId: 'M09', pool: 'gate', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m09-01'], remediation: 'les-m09-02',
    context: '$ kubectl get pod -n beacon\nNAME                          READY   STATUS             RESTARTS      AGE\nbeacon-api-7c9d4d5f6-q8w2z    0/1     CrashLoopBackOff   6 (90s ago)   8m\n$ kubectl get pod -n beacon beacon-api-7c9d4d5f6-q8w2z -o jsonpath=\'{.status.containerStatuses[0].lastState.terminated}\'\n{"exitCode":1,"reason":"Error"}\n$ kubectl logs -n beacon beacon-api-7c9d4d5f6-q8w2z --previous | tail -3\nTraceback (most recent call last):\n  File "/app/beacon/config.py", line 31, in load\n    return os.environ["BEACON_DB_URL"]\nKeyError: \'BEACON_DB_URL\'',
    q: 'Where is the fault and what is the smallest fix?',
    choices: ['The Deployment\'s container env lacks BEACON_DB_URL (or its secretKeyRef is wrong); add the reference and roll out', 'The memory limit is too low; raise it to stop the restarts', 'The liveness probe is too aggressive; lengthen initialDelaySeconds', 'Delete the Pod so the ReplicaSet makes a fresh one'],
    a: 0, rationale: 'Exit 1 with a Python traceback is the application ending itself on missing configuration. Nothing about memory or probes appears; deleting the Pod reproduces the same failure.',
    misconception: 'CrashLoopBackOff is treated as a resource or probe problem by reflex instead of reading the exit code and previous log.' });
  Q({ id: 'q-m09-g02', moduleId: 'M09', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m09-04'], remediation: 'les-m09-04',
    context: '$ kubectl exec -n beacon deploy/beacon-api -- sh -c \'curl -s -o /dev/null -w "%{http_code}" --cacert $SA/ca.crt -H "Authorization: Bearer $(cat $SA/token)" https://kubernetes.default.svc/api/v1/namespaces/beacon/secrets\'\n# RoleBinding for beacon-api grants: configmaps get,watch (resourceNames beacon-config)',
    q: 'What status code is returned, and what would a 401 have meant instead?',
    choices: ['403: the token is valid but no rule allows listing secrets; a 401 would mean the token itself was rejected', '200: service accounts can read secrets in their own namespace', '404: the secrets endpoint does not exist for namespaces', '401: service accounts cannot call the API directly'],
    a: 0, rationale: 'Authentication succeeded (the identity is known), authorisation failed: 403 Forbidden with the templated message. 401 is an authentication failure such as a missing or expired token.',
    misconception: 'Confusing authentication (401) with authorisation (403) sends the investigation to the wrong layer.' });
  Q({ id: 'q-m09-g03', moduleId: 'M09', pool: 'gate', type: 'mcq', difficulty: 3, objectiveIds: ['obj-m09-03'], remediation: 'les-m09-05',
    q: 'Which ingress rule lets Prometheus Pods (label app=prometheus) in namespace monitoring scrape beacon-api on 9102, and nothing else?',
    choices: ['One `from` item combining namespaceSelector kubernetes.io/metadata.name=monitoring AND podSelector app=prometheus, ports TCP 9102', 'Two `from` items, one namespaceSelector for monitoring and one podSelector app=prometheus, ports TCP 9102', 'A podSelector app=prometheus alone, since labels are cluster-wide', 'An ipBlock for the node CIDR on port 9102'],
    a: 0, rationale: 'A single item with both selectors is an AND. Two items are an OR: any Pod in monitoring plus any Pod labelled app=prometheus in the policy\'s own namespace. A bare podSelector only matches the local namespace.',
    misconception: 'Dash placement in `from` changes AND to OR and silently widens the rule.' });
  Q({ id: 'q-m09-g04', moduleId: 'M09', pool: 'gate', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m09-06'], remediation: 'les-m09-06',
    context: '$ kubectl get hpa -n beacon\nNAME         REFERENCE               TARGETS         MINPODS   MAXPODS   REPLICAS   AGE\nbeacon-api   Deployment/beacon-api   <unknown>/60%   2         10        2          15m\n$ kubectl describe hpa -n beacon beacon-api | tail -2\n  Warning  FailedGetResourceMetric  20s (x30 over 15m)  horizontal-pod-autoscaler  failed to get cpu utilization: unable to get metrics for resource cpu: no metrics returned from resource metrics API\n$ kubectl top pod -n beacon\nerror: Metrics API not available',
    q: 'Why is the HPA not scaling, and what is the prerequisite to install?',
    choices: ['No metrics.k8s.io provider is running; install metrics-server (kind does not ship it), then confirm kubectl top works', 'The Deployment has no CPU requests, so utilisation cannot be computed', 'The HPA targets the wrong Deployment name', 'CPU is below 60% so no scaling is needed'],
    a: 0, rationale: 'Both the HPA event and kubectl top say the Metrics API is absent. Missing requests would produce a different message once metrics exist.',
    misconception: '<unknown> is read as "low" rather than "no data"; an HPA without a metrics source never scales in either direction.' });
  Q({ id: 'q-m09-g05', moduleId: 'M09', pool: 'gate', type: 'explain', difficulty: 3, objectiveIds: ['obj-m09-06', 'obj-m09-01'], remediation: 'les-m09-06',
    q: 'Beacon API p95 latency tripled. API Pod CPU throttling is 1%, `beacon_db_query_duration_seconds` p95 went from 6 ms to 700 ms, and the connection pool on every replica is fully in use. A teammate proposes scaling the API from 6 to 12 replicas. Explain whether this removes the bottleneck and what it would do instead.',
    rubric: ['Identifies the dependency (database query time) as the saturated resource, not the API Pods', 'States that more replicas add concurrent queries and pool connections against the slow database', 'Names the likely consequence: hitting max_connections or deeper lock queues, latency unchanged or worse', 'Names where the fix belongs (the database: locks, plan, index) and what evidence would justify scaling the API instead (CPU throttling, local saturation)'],
    answer: 'Scaling does not remove the bottleneck. The API is not saturated (1% throttling); it is waiting on the database, whose per-query time rose a hundredfold, which is why every pool is full. Twelve replicas would open twice the connections and send twice the concurrent queries to the same slow database, likely exceeding max_connections and lengthening the lock or CPU queue there, so user latency would stay high or get worse. The fix belongs on the database side: find the blocking transaction or the plan change. Scaling the API would be justified only if the API Pods themselves were saturated, which CPU throttling or in-flight request saturation would show.',
    rationale: 'Adding replicas moves work to the bottleneck; the evidence points at a dependency, so the lever is elsewhere.',
    misconception: 'High latency is answered with more replicas regardless of which resource is saturated.' });

  /* ═══ M10 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m10-b01', moduleId: 'M10', pool: 'bank', type: 'predict', difficulty: 1, objectiveIds: ['obj-m10-01'], remediation: 'les-m10-01',
    context: '# charts/beacon/values.yaml\napi:\n  replicas: 1\n# values-staging.yaml\napi:\n  replicas: 2\n$ helm template beacon ./charts/beacon -f values-staging.yaml --set api.replicas=3 | grep replicas',
    q: 'What replica count is rendered?',
    choices: ['3: --set has the highest precedence, above -f files, above chart defaults', '2: the environment file wins over command-line flags', '1: chart defaults are authoritative', 'An error: conflicting values are rejected'],
    a: 0, rationale: 'Values merge lowest to highest: chart values.yaml, then -f files in order, then --set.',
    misconception: 'Treating the values file as the final word hides that a --set on the command line overrides it and is recorded nowhere.' });
  Q({ id: 'q-m10-b02', moduleId: 'M10', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m10-01'], remediation: 'les-m10-01',
    context: '$ helm history beacon -n beacon\nREVISION  STATUS      CHART         APP VERSION  DESCRIPTION\n1         superseded  beacon-1.3.0  2.4.1        Install complete\n2         superseded  beacon-1.4.0  2.5.0        Upgrade complete\n3         failed      beacon-1.4.1  2.5.1        Upgrade "beacon" failed: timed out waiting for the condition\n4         deployed    beacon-1.4.0  2.5.0        Rollback to 2\n$ kubectl get pod -n beacon -l app=beacon-api\nbeacon-api-7c9d4d5f6-a1b2c   1/1   Running   0   4d',
    q: 'Which chart and app version are live, and what does the history say about revision 3?',
    choices: ['Chart 1.4.0 / app 2.5.0 are live via revision 4, a copy of revision 2; revision 3 failed and stays in history', 'Chart 1.4.1 / app 2.5.1 are live because it is the newest revision', 'Revision 2 is live; rollback reactivates the old revision', 'Nothing is live; the failed upgrade removed the release'],
    a: 0, rationale: 'Only the deployed row is live. Rollback creates a new revision with the target\'s manifest; the failed revision remains as a record.',
    misconception: 'The highest revision number or the newest chart is assumed live; the STATUS column decides.' });
  Q({ id: 'q-m10-b03', moduleId: 'M10', pool: 'bank', type: 'mcq', difficulty: 1, objectiveIds: ['obj-m10-01'], remediation: 'les-m10-01',
    q: 'A change edits a template\'s readiness path but leaves the image the same. Which field in Chart.yaml must change?',
    choices: ['version (the chart SemVer), because the templates changed; appVersion stays', 'appVersion, because the application behaves differently', 'Both version and appVersion', 'Neither; Helm versions releases automatically'],
    a: 0, rationale: 'version tracks the chart; appVersion describes the packaged application and is informational. Release revisions are separate from both.',
    misconception: 'Chart version and app version are treated as one number.' });
  Q({ id: 'q-m10-b04', moduleId: 'M10', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m10-02'], remediation: 'les-m10-02',
    context: '# pipeline excerpt\n- name: test\n  run: python -m pytest -q || echo "flaky, continuing"\n- name: build\n  run: make build\n- name: publish\n  needs: [build]\n  run: make publish\n# last run\ntest     1 failed, 212 passed  (exit 0)\nbuild    ok\npublish  ok  sha256:4b71d2e0...',
    q: 'An image with a known regression was published. Which statement explains why, and the correct repair?',
    choices: ['The test stage cannot fail because of the || echo, and build does not depend on test; remove the suppression and add needs: [test]', 'pytest returned the wrong exit code; pin a newer pytest', 'publish should run the tests again before pushing', 'The regression is in a test that should be marked expected-failure'],
    a: 0, rationale: 'A gate must exit non-zero and be a dependency of the next stage. Here both conditions were defeated, so the stage was a report, not a gate.',
    misconception: 'Retrying or re-running tests in later stages patches around a disabled gate rather than restoring it.' });
  Q({ id: 'q-m10-b05', moduleId: 'M10', pool: 'bank', type: 'order', difficulty: 2, objectiveIds: ['obj-m10-02', 'obj-m10-03'], remediation: 'les-m10-02',
    q: 'Order the stages of the Beacon delivery workflow so that each gate protects the next step.',
    steps: ['Run unit and contract tests; fail the run on any failure', 'Build the image once and record its digest', 'Scan that digest and generate the SBOM; block on policy', 'Publish the digest as a release candidate (main branch only)', 'Promote the same digest into the staging values file', 'Human approval, then the same digest into the production values file'],
    rationale: 'Tests before build, build once, scan the thing that was built, publish only what passed, promote by digest with the human gate after the automated ones.',
    misconception: 'Rebuilding at publish or promote time breaks the chain: the promoted artifact is not the one that was tested and scanned.' });
  Q({ id: 'q-m10-b06', moduleId: 'M10', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m10-03'], remediation: 'les-m10-03',
    context: '# deploy/prod/values.yaml\nimage:\n  repository: registry.lab/beacon/api\n  tag: 2.5.1\n$ docker buildx imagetools inspect registry.lab/beacon/api:2.5.1 | grep Digest\nDigest: sha256:4b71d2e0...\n# scan report attached to the release ticket: sha256:9f3c1a0b...',
    q: 'What does the mismatch tell you, and what change prevents it?',
    choices: ['The tag was re-pushed after the scan, so production can run unscanned bytes; reference the digest in values and verify imageID on the Pods', 'The scanner hashed the wrong layer; re-run the scan', 'Tags and digests always differ; nothing is wrong', 'The registry corrupted the image; re-push it'],
    a: 0, rationale: 'A tag is a movable pointer. The scanned digest and the tag\'s current digest differ, so the artifact identity changed between scan and deploy. Digest references make the promoted artifact immutable.',
    misconception: 'A version-looking tag is assumed immutable.' });
  Q({ id: 'q-m10-b07', moduleId: 'M10', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m10-03'], remediation: 'les-m10-03',
    q: 'Which field proves which image a Beacon Pod is actually running, as opposed to what the Deployment asked for?',
    choices: ['.status.containerStatuses[].imageID, which carries the pulled digest', '.spec.containers[].image', 'The Deployment\'s revision annotation', 'The Helm release appVersion'],
    a: 0, rationale: 'The spec says what was requested; imageID records what the kubelet pulled, by digest. The two differ during rollouts or when a tag moved.',
    misconception: 'The desired state is read as the running state.' });
  Q({ id: 'q-m10-b08', moduleId: 'M10', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m10-04'], remediation: 'les-m10-04',
    context: '09:41  kubectl scale deploy/beacon-api -n beacon --replicas=6   # latency recovers\n09:46  kubectl get deploy beacon-api -n beacon → 2/2\n$ kubectl describe deploy beacon-api -n beacon | grep -A2 Events\n  Normal  ScalingReplicaSet  3m  deployment-controller  Scaled down replica set beacon-api-7c9d4d5f6 from 6 to 2\n$ flux get kustomizations -n flux-system\nNAME     REVISION          READY  MESSAGE\nbeacon   main@sha1:3f9e..  True   Applied revision: main@sha1:3f9e..',
    q: 'Why did the replica count revert, and what are the two acceptable ways to hold 6 replicas?',
    choices: ['The reconciler applied Git (replicas: 2) over the manual change; commit replicas 6 to the deploy repo, or suspend the Kustomization with a recorded reason and deadline', 'The HPA scaled it down; raise minReplicas with kubectl', 'The scale command needs --record to persist', 'Flux is broken; restart the kustomize-controller'],
    a: 0, rationale: 'Drift is removed by design. Git is the source of truth; a documented pause is the escape hatch when Git cannot carry the change yet.',
    misconception: 'The reconciler reverting a fix is read as a bug rather than the defining behaviour.' });
  Q({ id: 'q-m10-b09', moduleId: 'M10', pool: 'bank', type: 'diagnose', difficulty: 3, objectiveIds: ['obj-m10-05'], remediation: 'les-m10-05',
    context: '$ psql -d beacon -c "select version, applied_at, description from schema_migrations order by applied_at desc limit 2"\n 0043 | 2026-10-13 08:02 | drop column sensor_status.state\n 0042 | 2026-10-06 09:15 | add sensor_status.status, backfill from state\n$ git show v2.5.1:beacon/db/queries.py | grep -c "state"\n4\n# proposal: helm rollback beacon 7   (revision 7 = app 2.5.1)',
    q: 'Is the rollback safe?',
    choices: ['No: a destructive migration already ran and 2.5.1 reads the dropped column; every query would fail. Fix forward instead', 'Yes: helm rollback restores the previous schema along with the manifests', 'Yes: the previous image is still in the registry so it will run as before', 'Yes, if you also run the down migration to recreate the column'],
    a: 0, rationale: 'Helm rolls back manifests only. After contract (drop column) the previous code is incompatible with the schema; a down migration cannot restore the dropped data.',
    misconception: '"The old image still exists" is mistaken for "the old version still works".' });
  Q({ id: 'q-m10-b10', moduleId: 'M10', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m10-05'], remediation: 'les-m10-05',
    q: 'Which of these keeps the database password out of Git, rendered manifests and logs while still delivering it to the Beacon Pod?',
    choices: ['The chart renders a secretKeyRef to a Secret created outside the chart; values files carry only the Secret name; the app logs config keys, never values', 'Put the password in values-prod.yaml and rely on repository permissions', 'Base64-encode the password in the chart\'s Secret template', 'Pass it as --set db.password on the upgrade command'],
    a: 0, rationale: 'A reference is safe to render and commit; the value never enters the chart, Git, helm get values output or logs.',
    misconception: 'base64 is confused with encryption, and --set is forgotten to be visible in shell history and CI logs.' });

  Q({ id: 'q-m10-g01', moduleId: 'M10', pool: 'gate', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m10-01'], remediation: 'les-m10-01',
    context: '$ helm upgrade --install beacon ./charts/beacon -n beacon -f values-staging.yaml --wait --timeout 3m\nError: UPGRADE FAILED: timed out waiting for the condition\n$ kubectl get pod -n beacon -l app=beacon-api\nbeacon-api-5f8b9c7d6-k2m4n   0/1   Running   0   3m\nbeacon-api-7c9d4d5f6-a1b2c   1/1   Running   0   4d\n$ kubectl describe pod -n beacon beacon-api-5f8b9c7d6-k2m4n | grep Readiness\n  Readiness probe failed: HTTP probe failed with statuscode: 404\n$ helm get manifest beacon -n beacon --revision 3 | grep -A1 readinessProbe\n      readinessProbe:\n        httpGet: { path: /ready, port: http }',
    q: 'What caused the failed upgrade and did users notice?',
    choices: ['The new chart revision changed the readiness path to one the app does not serve; the old ReplicaSet kept serving so users saw nothing', 'The new image is broken; users saw errors for 3 minutes', 'The --wait timeout is too short; rerun with 10m', 'The old Pod blocks the rollout; delete it'],
    a: 0, rationale: 'Readiness failing with 404 on the new path while the app is Running points at the probe change in the chart. A rollout that never passes readiness keeps the old Pods in the Service.',
    misconception: 'A failed upgrade is assumed to mean a user-visible outage; readiness gating is what prevented one.' });
  Q({ id: 'q-m10-g02', moduleId: 'M10', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m10-04'], remediation: 'les-m10-04',
    context: '$ flux suspend kustomization beacon -n flux-system\n✔ kustomization suspended\n$ kubectl set env deploy/beacon-api -n beacon LOG_LEVEL=debug\n# 40 minutes pass; the engineer goes to lunch without a note; the values file in Git still says LOG_LEVEL=info',
    q: 'What is the state of the cluster an hour later, and what did the course require that is missing?',
    choices: ['LOG_LEVEL stays debug indefinitely because reconciliation is paused; the pause needed an owner, reason, deadline and a Git catch-up or revert before resume', 'Flux resumes automatically after 30 minutes and reverts it', 'The HPA reverts the env change', 'Git is updated automatically from the cluster'],
    a: 0, rationale: 'Suspend is indefinite. The documented-pause rule exists precisely so an undocumented suspension does not become months of drift.',
    misconception: 'Pausing is treated as self-correcting.' });
  Q({ id: 'q-m10-g03', moduleId: 'M10', pool: 'gate', type: 'order', difficulty: 3, objectiveIds: ['obj-m10-05'], remediation: 'les-m10-05',
    q: 'Order the expand/contract steps for renaming column `state` to `status` so that rollback stays safe at each release.',
    steps: ['Add nullable column status and backfill it from state', 'Deploy code that writes both columns and reads status with fallback to state', 'Deploy code that reads and writes only status', 'Wait for the full rollback window to pass', 'Drop column state in a separate, scheduled migration'],
    rationale: 'Each step leaves the previous code version working; the destructive step runs only after the versions that need the old column are outside the rollback window.',
    misconception: 'A single rename migration is fast and makes rollback impossible the moment it runs.' });
  Q({ id: 'q-m10-g04', moduleId: 'M10', pool: 'gate', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m10-02'], remediation: 'les-m10-02',
    q: 'A scan stage starts failing on a run with no code or dependency change. What is the most likely cause and the right response?',
    choices: ['The vulnerability database updated and the base image now has a blocking finding; rebuild on a patched base, do not bypass the gate', 'The scanner is flaky; add a retry', 'The pipeline cache is stale; clear it and rerun', 'The SBOM is malformed; skip the scan this once'],
    a: 0, rationale: 'Scanning the same digest against a newer database legitimately produces new findings; that is why the pushed digest is scanned every run.',
    misconception: 'A gate failing without a code change is read as noise instead of as new information about the artifact.' });
  Q({ id: 'q-m10-g05', moduleId: 'M10', pool: 'gate', type: 'explain', difficulty: 2, objectiveIds: ['obj-m10-03', 'obj-m10-05'], remediation: 'les-m10-03',
    q: 'Explain what "rollback without changing the artifact identity" means for Beacon, and name the one check that must happen before the rollback even though the digest is unchanged.',
    rubric: ['Defines rollback as re-referencing the previous digest in the desired state (values file or helm revision), not rebuilding or retagging', 'States that the previous bytes are unchanged because digests are content-addressed and the image was never overwritten', 'Names the schema/data compatibility check: migrations since the target version, especially destructive ones', 'Mentions verifying the running imageID after rollback'],
    answer: 'Rollback means the desired state points at the previous digest again, through a Git change or helm rollback, so the exact bytes that ran before run again; nothing is rebuilt or retagged. Before doing it, read the migration history since that version: if a destructive migration (drop, rename, type change) has run, the previous code will fail against the current schema and the rollback is unsafe, so the fix must go forward. After rollback, confirm the Pods\' imageID shows the intended digest.',
    rationale: 'Artifact immutability and data compatibility are separate properties; a rollback needs both.',
    misconception: 'An unchanged image is assumed to guarantee unchanged behaviour.' });

  /* ═══ M11 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m11-b01', moduleId: 'M11', pool: 'bank', type: 'mcq', difficulty: 1, objectiveIds: ['obj-m11-01'], remediation: 'les-m11-01',
    q: 'Which signal answers "why did request 7f3a9c return 500" and which answers "what fraction of requests returned 500 in the last five minutes"?',
    choices: ['Logs (filtered by request_id or trace_id) for the first; metrics (a counter with a status label and rate()) for the second', 'Metrics for both, with a request_id label', 'Traces for both', 'Logs for both, aggregated at query time'],
    a: 0, rationale: 'Logs carry per-event context; metrics pre-aggregate so rates are cheap. A request_id metric label would create one series per request.',
    misconception: 'Treating one signal as sufficient for every question leads to either unbounded metric labels or log queries that cannot compute rates at scale.' });
  Q({ id: 'q-m11-b02', moduleId: 'M11', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m11-01'], remediation: 'les-m11-01',
    context: '# api: enqueue\nredis.xadd("beacon:ingest", {"sensor_id": sid, "status": st, "request_id": rid})\n# worker: consume\nwith tracer.start_as_current_span("process-status"):\n    handle(msg)',
    q: 'A status write is traced from the HTTP request to the database. What does the trace show for the worker\'s processing?',
    choices: ['Nothing linked: the worker starts a new root trace because no traceparent was carried in the message, so the queue wait is invisible', 'A child span under the API\'s enqueue span, because Redis propagates context', 'A child span, because request_id is in the message', 'An error span, because the worker cannot find the parent'],
    a: 0, rationale: 'Trace context propagates only if the producer writes traceparent into the carrier and the consumer extracts it. request_id helps log correlation, not span parenting.',
    misconception: 'Context propagation is assumed to be automatic across a queue.' });
  Q({ id: 'q-m11-b03', moduleId: 'M11', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m11-02'], remediation: 'les-m11-02',
    context: 'sum(rate(beacon_http_requests_total[5m]))                                                → 208/s (baseline 200/s)\nrate(container_cpu_cfs_throttled_periods_total{container="api"}[5m]) / rate(container_cpu_cfs_periods_total{container="api"}[5m])  → 0.62\nhistogram_quantile(0.95, sum by (le) (rate(beacon_db_query_duration_seconds_bucket[5m])))  → 0.007 (baseline 0.006)\nbeacon_db_pool_in_use / beacon_db_pool_size                                                 → 0.2',
    q: 'API p95 latency tripled. Which story do the numbers support, and which lever follows?',
    choices: ['Local CPU saturation: the container is throttled 62% of periods while the database and pool are normal; raise the CPU limit or add replicas after checking what consumes CPU', 'A slow dependency: scale the database', 'Pool exhaustion: enlarge the pool', 'Load spike: enable backpressure'],
    a: 0, rationale: 'Rate is flat, dependency latency and pool usage are flat, CPU throttling is high. The resource that is saturated is the API container\'s own CPU.',
    misconception: 'High latency is attributed to the database by default; the client-side dependency metrics show it is not.' });
  Q({ id: 'q-m11-b04', moduleId: 'M11', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m11-02'], remediation: 'les-m11-02',
    q: 'Which expression gives the fraction of Beacon requests that returned 5xx over the last five minutes?',
    choices: ['sum(rate(beacon_http_requests_total{status=~"5.."}[5m])) / sum(rate(beacon_http_requests_total[5m]))', 'rate(sum(beacon_http_requests_total{status=~"5.."})[5m]) / rate(sum(beacon_http_requests_total)[5m])', 'beacon_http_requests_total{status=~"5.."} / beacon_http_requests_total', 'increase(beacon_http_requests_total{status=~"5.."}[5m])'],
    a: 0, rationale: 'rate() on each counter, then aggregate, then divide. Summing raw counters before rate() is wrong because resets happen at different times; raw counter division ignores time.',
    misconception: 'Aggregating before rate() looks equivalent and is not.' });
  Q({ id: 'q-m11-b05', moduleId: 'M11', pool: 'bank', type: 'predict', difficulty: 3, objectiveIds: ['obj-m11-05', 'obj-m11-02'], remediation: 'les-m11-03',
    context: 'beacon_http_request_duration_seconds_bucket{route="/v1/status",le="0.1"}   9630\nbeacon_http_request_duration_seconds_bucket{route="/v1/status",le="0.25"}  9700\nbeacon_http_request_duration_seconds_bucket{route="/v1/status",le="0.5"}   9712\nbeacon_http_request_duration_seconds_bucket{route="/v1/status",le="+Inf"}  9720\n# SLO threshold: 300 ms',
    q: 'Can "fraction of requests under 300 ms" be computed exactly from these buckets, and what does histogram_quantile do at that point?',
    choices: ['No: 0.3 is not a bucket boundary; any value between 0.25 and 0.5 is a linear interpolation. Add a 0.3 bucket', 'Yes: histogram_quantile interpolates exactly from the _sum', 'Yes: use le="0.25" since it is close enough for an SLO', 'No: histograms cannot answer threshold questions at all'],
    a: 0, rationale: 'Buckets are cumulative counts at fixed edges; between edges the distribution is unknown and the function assumes it is uniform. An SLI threshold must be an edge.',
    misconception: 'Histogram quantiles are assumed exact; precision is set by the bucket layout.' });
  Q({ id: 'q-m11-b06', moduleId: 'M11', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m11-05'], remediation: 'les-m11-03',
    context: '# Prometheus: memory at limit, "scrape timeout" for beacon-api targets\ntopk(3, count by (__name__) ({__name__=~"beacon_.*"}))\nbeacon_ingest_records_total   1842117\nbeacon_http_requests_total        1280\nbeacon_db_queries_total             96\ncount(count by (sensor_id) (beacon_ingest_records_total))  → 38210',
    q: 'What took the dashboard down, and what keeps the "which sensors are noisy" question answerable?',
    choices: ['A sensor_id label on the ingest counter created a series per sensor per replica; remove the label and log sensor_id on the ingest event instead', 'Too many replicas; scale the API down', 'Prometheus retention is too long; shorten it', 'The histogram has too many buckets; reduce them'],
    a: 0, rationale: 'Series count is the product of label values; an unbounded sensor_id multiplies it into millions. Per-entity detail belongs in logs or trace attributes.',
    misconception: 'A label is treated as free metadata rather than as a series multiplier.' });
  Q({ id: 'q-m11-b07', moduleId: 'M11', pool: 'bank', type: 'explain', difficulty: 2, objectiveIds: ['obj-m11-03'], remediation: 'les-m11-04',
    q: 'Write Beacon\'s availability SLI as a numerator and denominator, with at least two explicit exclusions and the reason for each.',
    rubric: ['Denominator: valid requests to /v1/ routes that reached the API', 'Numerator: valid requests that were not 5xx', 'Excludes /healthz and /metrics because they are not user traffic and would dilute the ratio', 'Treats correctly returned 4xx as good (or states the exception for 4xx the service caused) and notes that requests failing before the API need an edge-measured SLI'],
    answer: 'Numerator: requests to routes matching /v1/ with a non-5xx status. Denominator: all requests to routes matching /v1/. Exclusions: /healthz and /metrics are left out of both halves because they are not user traffic and always succeed, so they would inflate the ratio; 4xx responses count as good because a correct rejection of a bad request is the service working, with a separate alert for 401 spikes we cause. Requests that fail at the load balancer never reach these counters, so the SLI is paired with one measured at the edge.',
    rationale: 'An SLI is only defensible when both halves and the exclusions are written down.',
    misconception: 'Counting every HTTP request, including health checks, as valid makes a failing service look green.' });
  Q({ id: 'q-m11-b08', moduleId: 'M11', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m11-03'], remediation: 'les-m11-04',
    context: 'window: 30 days, SLO 99.5% availability\nvalid requests (/v1/*):   12,400,000\n5xx responses:                31,000\n/healthz requests:        30,000,000 (all 200)',
    q: 'What fraction of the error budget remains, and what would including /healthz in the denominator have done?',
    choices: ['Budget 62,000 bad allowed, 31,000 spent, 50% remains; including health checks would have shrunk the apparent error rate and overstated remaining budget', '75% remains; health checks make no difference', '0% remains; the SLO is breached', '50% remains; including health checks would have made the SLI stricter'],
    a: 0, rationale: '0.005 × 12,400,000 = 62,000; 31,000 / 62,000 = 50% spent. Adding 30 million always-good requests to the denominator dilutes the ratio.',
    misconception: 'Health-check traffic is counted as user traffic, hiding user-facing failures.' });
  Q({ id: 'q-m11-b09', moduleId: 'M11', pool: 'bank', type: 'diagnose', difficulty: 3, objectiveIds: ['obj-m11-04'], remediation: 'les-m11-05',
    context: '# alert rule\n- alert: BeaconErrorRate\n  expr: sum(rate(beacon_http_requests_total{status=~"5.."}[5m])) / sum(rate(beacon_http_requests_total[5m])) > 0.05\n  for: 5m\n# incident: 10:02–10:27 all API Pods OOMKilled and restarting; no Pod Ready\n# Prometheus: up{job="beacon-api"} == 0 from 10:02\n# alert history: no BeaconErrorRate alert fired',
    q: 'Why did the alert stay silent during a total outage, and what rule covers this?',
    choices: ['With no target up there were no samples; rate() returned nothing and the ratio was empty, so the expression never evaluated true. Add absent(up{job="beacon-api"}) or up == 0 as a page', 'The threshold 0.05 was too high; lower it to 0.01', 'The for: 5m was too long for a 25-minute outage', 'Prometheus was also down'],
    a: 0, rationale: 'No data is not a low error rate; an empty result resolves the alert. Absence must be alerted separately.',
    misconception: 'A quiet alert is read as healthy when it may be blind.' });
  Q({ id: 'q-m11-b10', moduleId: 'M11', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m11-04'], remediation: 'les-m11-05',
    q: 'Why pair a 1-hour window with a 5-minute window in a burn-rate page?',
    choices: ['The long window proves the burn is sustained; the short window makes the alert clear soon after the burn stops instead of waiting for the long average to drain', 'The short window fires first and the long window confirms it later', 'Two windows double the sensitivity', 'Prometheus requires two windows for ratio alerts'],
    a: 0, rationale: 'Both conditions are ANDed: sustained impact and still happening. Without the short window a 5-minute stall keeps the page red for most of an hour.',
    misconception: 'Longer windows are assumed to be strictly better.' });

  Q({ id: 'q-m11-g01', moduleId: 'M11', pool: 'gate', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m11-02'], remediation: 'les-m11-02',
    context: 'sum(rate(beacon_http_requests_total[5m]))                                                → 203/s (baseline 200/s)\nrate(container_cpu_cfs_throttled_periods_total{container="api"}[5m]) / rate(container_cpu_cfs_periods_total{container="api"}[5m])  → 0.01\nhistogram_quantile(0.95, sum by (le) (rate(beacon_db_query_duration_seconds_bucket[5m])))  → 0.006 (baseline)\nbeacon_db_pool_in_use / beacon_db_pool_size                                                 → 1.0\nbeacon_db_pool_wait_seconds (p95)                                                           → 0.9',
    q: 'Latency is up. Queries are fast, CPU is idle, the pool is full and callers wait on it. What is the bottleneck?',
    choices: ['Connection concurrency, not the database: connections are held beyond query time (an open transaction or leaked session); inspect pg_stat_activity and the code path, do not simply enlarge the pool', 'The database is slow; add an index', 'The API is CPU-bound; add replicas', 'The network between API and database'],
    a: 0, rationale: 'Query p95 unchanged and CPU idle rule out the first two; a full pool with fast queries means connections are held by something other than queries.',
    misconception: 'Pool exhaustion is answered with a bigger pool, which delays the same failure and pressures max_connections.' });
  Q({ id: 'q-m11-g02', moduleId: 'M11', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m11-04'], remediation: 'les-m11-05',
    context: 'tests:\n- interval: 1m\n  input_series:\n  - series: \'beacon_http_requests_total{status="200"}\'\n    values: \'0+100x120\'\n  - series: \'beacon_http_requests_total{status="500"}\'\n    values: \'0+0x60 0+20x60\'\n  alert_rule_test:\n  - eval_time: 61m\n    alertname: BeaconAvailabilityBurnFast\n    exp_alerts: []\n# rule: (error_ratio_1h > 14.4*0.005) and (error_ratio_5m > 14.4*0.005), for: 2m',
    q: 'Errors begin at minute 60 at 16.7% of requests. Does the test at 61m pass, and when would the alert first be active?',
    choices: ['It passes: at 61m the 1h ratio is far below 7.2%; the alert becomes active once the 1h window carries enough bad samples and for: 2m has elapsed, well after minute 61', 'It fails: the alert fires immediately at 60m', 'It fails: 16.7% exceeds 7.2% so the alert is active at 61m', 'It passes only if for: is removed'],
    a: 0, rationale: 'The short window exceeds the threshold quickly but the long window averages over an hour that was mostly clean; both must be true, then the for: delay applies.',
    misconception: 'A multi-window rule is read as firing on the short window alone.' });
  Q({ id: 'q-m11-g03', moduleId: 'M11', pool: 'gate', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m11-05'], remediation: 'les-m11-03',
    q: 'Which label set on beacon_http_requests_total is bounded?',
    choices: ['method, route (router template), status', 'method, path (as requested), status', 'method, route, status, request_id', 'method, route, status, sensor_id'],
    a: 0, rationale: 'Templates, methods and status codes are finite sets. Raw paths with ids, request ids and sensor ids are unbounded and create a series per value.',
    misconception: 'The raw path looks like a route but every id in it makes a new series.' });
  Q({ id: 'q-m11-g04', moduleId: 'M11', pool: 'gate', type: 'order', difficulty: 2, objectiveIds: ['obj-m11-01', 'obj-m11-02'], remediation: 'les-m11-01',
    q: 'Order the steps to go from "the API is slow" to the exact event, using the three signals.',
    steps: ['Metrics: confirm p95 latency rose and on which route; check dependency latency and CPU throttling', 'Traces: pick a slow trace for that route and find the span that carries the time', 'Logs: filter by that trace_id or request_id to read the exact event and its fields', 'Form the hypothesis with the evidence (e.g. pool wait behind a slow query) and choose the discriminating check'],
    rationale: 'Each signal narrows the next search: aggregate to where, trace to which span, log to what exactly.',
    misconception: 'Starting with logs on a busy service means reading thousands of lines without knowing which request matters.' });
  Q({ id: 'q-m11-g05', moduleId: 'M11', pool: 'gate', type: 'explain', difficulty: 3, objectiveIds: ['obj-m11-03', 'obj-m11-04'], remediation: 'les-m11-04',
    q: 'A probe hits /healthz every 10 seconds and the SLO dashboard is green, while users cannot write status records because the database connection pool is exhausted. Explain the blind spot and how the SLI definition should change.',
    rubric: ['Identifies that /healthz succeeds without exercising the database, so the probe measures process liveness, not the user path', 'States that the SLI must be computed from user requests on /v1/ routes, excluding health checks', 'Proposes counting timeouts and 5xx on the user path as bad events (and an edge-measured SLI for failures before the API)', 'Mentions a no-data alert so an empty ratio does not read as healthy'],
    answer: 'The dashboard is green because its SLI is built from the health probe, which returns 200 from a process whose database access is gone; it measures that the process is alive, not that users can write. The SLI must use user traffic: valid events are requests to /v1/ routes, good events are those that complete without 5xx or timeout, and /healthz is excluded. Failures that never reach the API need a second SLI measured at the edge, and an absence rule must page when the user-path series stops, so silence is not mistaken for health.',
    rationale: 'A monitor that watches the wrong denominator reports health that users do not experience.',
    misconception: 'A passing health check is equated with a working service.' });

  /* ═══ M12 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m12-b01', moduleId: 'M12', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m12-01'], remediation: 'les-m12-01',
    context: 'EXPLAIN ANALYZE SELECT id, status FROM sensor_status WHERE sensor_id = \'S-0042\' AND recorded_at > now() - interval \'1 hour\' ORDER BY recorded_at DESC LIMIT 50;\n Limit  (actual time=812.330..812.341 rows=38 loops=1)\n   ->  Sort  (actual time=812.328..812.333 rows=38 loops=1)\n         Sort Key: recorded_at DESC\n         ->  Seq Scan on sensor_status  (cost=0.00..28307.00 rows=118 width=27) (actual time=0.031..812.190 rows=38 loops=1)\n               Filter: ((sensor_id = \'S-0042\'::text) AND (recorded_at > (now() - \'01:00:00\'::interval)))\n               Rows Removed by Filter: 1199962\n Execution Time: 812.389 ms',
    q: 'Why is this slow and which index changes the plan most?',
    choices: ['Every row is read to find 38; a B-tree on (sensor_id, recorded_at DESC) serves the equality, the range and the sort, removing the Seq Scan and the Sort', 'The estimate (118) is wrong; run ANALYZE and the plan will change', 'An index on status; the query returns status', 'An index on recorded_at alone, since the sort is on it'],
    a: 0, rationale: 'Estimated and actual rows are close, so statistics are fine. Rows Removed by Filter shows the cost; a composite index with the equality column first lets the planner jump to the sensor and walk the time range in order.',
    misconception: 'Indexing the sort column alone scans an hour of every sensor; the leading column must be the equality predicate.' });
  Q({ id: 'q-m12-b02', moduleId: 'M12', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m12-01'], remediation: 'les-m12-01',
    q: 'An index exists on (sensor_id, recorded_at). Which query can use it?',
    choices: ['WHERE sensor_id = \'S-0042\' AND recorded_at > now() - interval \'1 day\'', 'WHERE recorded_at > now() - interval \'1 day\'', 'WHERE lower(sensor_id) = \'s-0042\'', 'WHERE sensor_id LIKE \'%042\''],
    a: 0, rationale: 'A B-tree serves a leftmost prefix with plain comparisons. A non-leading column, a function on the column and a leading wildcard cannot be found by sorted order.',
    misconception: 'Any query mentioning an indexed column is assumed to use the index.' });
  Q({ id: 'q-m12-b03', moduleId: 'M12', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m12-01'], remediation: 'les-m12-01',
    context: 'SELECT count(*) FROM sensor_status WHERE status = \'ok\';   -- 97% of 1.2M rows are ok\nCREATE INDEX ON sensor_status (status);\nEXPLAIN SELECT count(*) FROM sensor_status WHERE status = \'ok\';',
    q: 'What plan does the planner most likely choose after the index is created, and is that a problem?',
    choices: ['Still a Seq Scan (or a cheap aggregate over it): returning 97% of the table sequentially is cheaper than a million index jumps; the index is correctly ignored', 'An Index Scan, because the column is now indexed', 'An error: an index on a low-cardinality column is rejected', 'An Index Only Scan that is 100 times faster'],
    a: 0, rationale: 'Index usefulness depends on selectivity. For an unselective predicate the planner estimates the sequential read as cheaper and is right.',
    misconception: 'A Seq Scan is treated as always wrong.' });
  Q({ id: 'q-m12-b04', moduleId: 'M12', pool: 'bank', type: 'diagnose', difficulty: 3, objectiveIds: ['obj-m12-02'], remediation: 'les-m12-02',
    context: 'SELECT pid, state, wait_event_type, now()-xact_start AS xact_age, left(query,40) FROM pg_stat_activity WHERE datname=\'beacon\' AND state<>\'idle\' ORDER BY xact_start;\n  pid  |        state        | wait_event_type | xact_age | query\n 41822 | idle in transaction | Client          | 00:14:07 | UPDATE sensors SET last_seen = now()\n 41901 | active              | Lock            | 00:13:58 | UPDATE sensors SET name = \'north-42\'\n 41944 | active              | Lock            | 00:09:12 | ALTER TABLE sensors ADD COLUMN zone\n 42010 | active              | Lock            | 00:00:41 | SELECT id, status FROM sensors WHERE\n (37 more rows, all Lock)\nSELECT pg_blocking_pids(42010);  → {41944}\nSELECT pg_blocking_pids(41944);  → {41822}',
    q: 'Which single session should be terminated, and why not the others?',
    choices: ['41822: it is idle in transaction holding the row lock at the root of the chain; the ALTER and the reads are legitimate waiters that proceed once it is gone', '41944: the ALTER TABLE is blocking all the reads', 'All sessions with wait_event_type Lock, to clear the pile-up', 'Restart PostgreSQL to release every lock'],
    a: 0, rationale: 'pg_blocking_pids traces the chain to a session that is not itself waiting and is doing nothing. Terminating it releases the lock; killing waiters or restarting aborts dozens of innocent transactions and destroys the evidence.',
    misconception: 'The most visible blocker (the ALTER) is targeted instead of the root; or everything is killed.' });
  Q({ id: 'q-m12-b05', moduleId: 'M12', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m12-02'], remediation: 'les-m12-02',
    context: 'max_connections = 100\nAPI replicas: 12 (HPA scaled up), pool size per replica: 10\nworker replicas: 2, pool size: 5\nmonitoring + operators: ~6 connections',
    q: 'What do the newest API replicas log, and which two changes avoid it without raising max_connections?',
    choices: ['FATAL: sorry, too many clients already — reduce pool size per replica or put a pooler (PgBouncer) in front, and cap HPA maxReplicas to the arithmetic', 'Nothing; PostgreSQL queues extra connections', 'A lock timeout; add lock_timeout', 'Out of memory on the API; raise the memory limit'],
    a: 0, rationale: '12×10 + 2×5 + 6 = 136 > 100, so connections past the limit are refused at connect time. The fix is in the replica × pool arithmetic or a pooler.',
    misconception: 'Scaling replicas is assumed to be free of dependency-side limits.' });
  Q({ id: 'q-m12-b06', moduleId: 'M12', pool: 'bank', type: 'order', difficulty: 2, objectiveIds: ['obj-m12-03'], remediation: 'les-m12-03',
    q: 'Order the steps of a restore drill that produces evidence rather than a claim.',
    steps: ['Record the dump timestamp and start the clock', 'Create a fresh database and pg_restore the archive into it', 'Compare row counts and max(recorded_at) between source (scoped to the snapshot time) and restored', 'Compare an ordered checksum of a table or range on both sides', 'Read a known record through a test instance of the application', 'Stop the clock and report RTO measured, RPO as configured, and whether each met the target'],
    rationale: 'Fresh database, then counts, recovery point, checksum, application read, and a measured interval; restore exit status alone proves nothing.',
    misconception: 'A restore that "completed successfully" is reported without comparison or timing.' });
  Q({ id: 'q-m12-b07', moduleId: 'M12', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m12-03'], remediation: 'les-m12-03',
    q: 'A streaming replica with 2 s of lag is proposed as the backup strategy. What does it fail to protect against?',
    choices: ['Bad data: a mistaken DELETE or DROP replays on the standby within seconds; only backups or PITR can restore to before it', 'Primary node failure', 'Read load on the primary', 'Nothing; replication is a complete backup'],
    a: 0, rationale: 'Replication provides availability and a failover target; it faithfully copies destructive changes. Backups and WAL-based point-in-time recovery answer "the data was right at 09:40".',
    misconception: 'A replica is called a backup.' });
  Q({ id: 'q-m12-b08', moduleId: 'M12', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m12-04'], remediation: 'les-m12-04',
    context: '# worker, per message\nwith db.transaction():\n    db.execute("INSERT INTO processed_messages (idem_key) VALUES (%s) ON CONFLICT DO NOTHING RETURNING idem_key", (msg.idem,))  → row\n    if row: insert sensor_status; update sensors.last_seen\n# commit succeeds; worker is SIGKILLed before XACK\n# 60s later XAUTOCLAIM hands the message to worker w2',
    q: 'What does w2 do and how many sensor_status rows exist for this message at the end?',
    choices: ['w2 runs the insert, hits the conflict on idem_key, skips the effect, logs a duplicate and acks: one row', 'w2 inserts again: two rows, because the first ack never happened', 'w2 fails with a unique violation and the message is dead-lettered', 'The message is lost because the first delivery was consumed'],
    a: 0, rationale: 'The key committed with the effect; the redelivery is detected by the conflict and acked. At-least-once delivery plus an idempotent handler yields exactly one effect.',
    misconception: 'Redelivery is assumed to mean duplicate data, or ON CONFLICT DO NOTHING is mistaken for an error.' });
  Q({ id: 'q-m12-b09', moduleId: 'M12', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m12-04'], remediation: 'les-m12-04',
    context: '$ redis-cli XPENDING beacon:ingest workers - + 5\n1) 1) "1760350447412-0"  2) "w3"  3) (integer) 480211  4) (integer) 9\n2) 1) "1760350447413-0"  2) "w1"  3) (integer) 1200    4) (integer) 1\n$ kubectl logs -n beacon deploy/beacon-worker | grep 1760350447412-0 | tail -1\n{"level":"error","msg":"parse failed","field":"recorded_at","value":"13/10/2026"}',
    q: 'What is the first message, and what should the system have done with it?',
    choices: ['A poison message delivered nine times over eight minutes; past the delivery cap it should be moved to a dead-letter stream with the error and acked so workers are not stuck on it', 'A slow message; give workers more time', 'A duplicate; delete it', 'A lost message; re-enqueue it'],
    a: 0, rationale: 'Delivery count 9 with a persistent parse error is the fingerprint of a message that will never succeed. Unbounded redelivery occupies a worker forever.',
    misconception: 'Retry-until-success is applied to a non-transient failure.' });
  Q({ id: 'q-m12-b10', moduleId: 'M12', pool: 'bank', type: 'explain', difficulty: 3, objectiveIds: ['obj-m12-05'], remediation: 'les-m12-05',
    q: 'Beacon receives 10,000 writes/s for 2 minutes while the worker tier drains 3,000/s. The acceptable processing delay is 60 s. Compute the backlog, the drain time, and the queue depth bound, and state what the API does beyond it.',
    rubric: ['Backlog = (10,000 − 3,000) × 120 = 840,000 messages', 'Drain time = 840,000 / 3,000 = 280 s, which exceeds the 60 s acceptable delay', 'Depth bound = 3,000 × 60 = 180,000 messages', 'Beyond the bound the API applies backpressure: 503 with Retry-After, clients retry with bounded jittered retries carrying the same idempotency key'],
    answer: 'The burst adds 7,000 messages per second for 120 s, a backlog of 840,000, which takes 280 s to drain at 3,000/s — far beyond the 60 s the design allows. The depth that keeps delay under 60 s is 3,000 × 60 = 180,000 messages. Past that the API should reject with 503 and Retry-After rather than buffer without bound; clients retry with jittered backoff and the same idempotency key, so shed writes are retried safely later. Partitioning by sensor_id preserves per-sensor order while allowing parallel drain.',
    rationale: 'A design decision with units: backlog, drain time, bound and the shedding behaviour.',
    misconception: 'An unbounded queue is treated as "nothing is lost" when it converts a burst into unbounded delay and eventual memory exhaustion.' });

  Q({ id: 'q-m12-g01', moduleId: 'M12', pool: 'gate', type: 'predict', difficulty: 3, objectiveIds: ['obj-m12-01'], remediation: 'les-m12-01',
    context: 'EXPLAIN ANALYZE SELECT count(*) FROM sensor_status WHERE recorded_at::date = CURRENT_DATE;\n Aggregate  (actual time=1402.117..1402.118 rows=1 loops=1)\n   ->  Seq Scan on sensor_status  (actual time=0.019..1298.330 rows=410221 loops=1)\n         Filter: ((recorded_at)::date = CURRENT_DATE)\n         Rows Removed by Filter: 789779\n-- indexes: sensor_status_sensor_time_idx (sensor_id, recorded_at DESC)',
    q: 'Why is the existing index not used, and what would the rewritten query achieve?',
    choices: ['The cast makes the predicate non-sargable and recorded_at is not the leading column; a range predicate plus an index on (recorded_at) lets the planner use an index, but a third of the table is returned so it stays slow — a maintained counter is the real fix', 'The planner has stale statistics; ANALYZE fixes it', 'The index is corrupt; REINDEX', 'count(*) never uses indexes'],
    a: 0, rationale: 'A function on the column defeats the B-tree and the composite index is led by sensor_id. Even with a usable index, returning 410,000 of 1.2 million rows is not a few-rows-among-many problem.',
    misconception: 'An index is expected to make reading a third of a table fast.' });
  Q({ id: 'q-m12-g02', moduleId: 'M12', pool: 'gate', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m12-02'], remediation: 'les-m12-02',
    context: '# API latency alert; DB CPU 6%\nbeacon_db_pool_in_use / beacon_db_pool_size → 1.0 on all replicas\nSELECT state, count(*) FROM pg_stat_activity WHERE datname=\'beacon\' GROUP BY 1;\n active               | 41\n idle in transaction  | 1\n idle                 | 12\nSELECT wait_event_type, count(*) FROM pg_stat_activity WHERE state=\'active\' GROUP BY 1;\n Lock | 41',
    q: 'What is the shape of this incident and the first command to run?',
    choices: ['A lock pile-up behind one idle-in-transaction session, not database load; run pg_blocking_pids on a waiter to confirm the root pid before terminating only it', 'Database overload; add CPU', 'Pool too small; raise pool size to 20', 'Network partition; restart the API'],
    a: 0, rationale: 'Forty-one active sessions all waiting on Lock with 6% CPU and one idle-in-transaction session is a blocking chain. Confirm the root with pg_blocking_pids, then terminate that pid only.',
    misconception: 'Many waiting sessions are read as "the database is busy".' });
  Q({ id: 'q-m12-g03', moduleId: 'M12', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m12-03'], remediation: 'les-m12-03',
    context: 'backup policy: pg_dump nightly at 02:00, retained 14 days; no WAL archiving; one async streaming replica (lag ~1 s)\nincident: at 13:30 an operator runs DELETE FROM sensor_status; (no WHERE) on the primary\nD04 target: RPO 15 minutes, RTO 30 minutes',
    q: 'What can be recovered, and does the policy meet the target?',
    choices: ['Only the 02:00 snapshot: the replica replayed the DELETE within a second and there is no WAL archive, so about 11.5 hours are lost; RPO target not met — WAL archiving (PITR) would allow restoring to 13:29', 'Everything: promote the replica', 'Everything up to 13:30: restore the dump then replay the replica', 'Nothing: the dump is also affected'],
    a: 0, rationale: 'Replication copies destructive changes; a logical dump gives the snapshot time only. Meeting a 15-minute RPO needs continuous WAL archiving and a base backup.',
    misconception: 'The replica is treated as a recovery point.' });
  Q({ id: 'q-m12-g04', moduleId: 'M12', pool: 'gate', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m12-04'], remediation: 'les-m12-04',
    q: 'Why must the idempotency key be generated by the producer (API) rather than taken from the Redis stream entry id?',
    choices: ['A client retrying its HTTP request creates a new stream entry with a new id; a producer-derived key (request id or record hash) is identical across the retry so the duplicate is caught', 'Stream ids are not unique', 'Redis cannot store the entry id in the message', 'The database cannot index stream ids'],
    a: 0, rationale: 'Deduplication must cover every layer that can retry, including the client; only a key derived from the request content or client request id is stable across all of them.',
    misconception: 'Deduplicating only at the queue layer leaves client retries producing duplicates.' });
  Q({ id: 'q-m12-g05', moduleId: 'M12', pool: 'gate', type: 'explain', difficulty: 2, objectiveIds: ['obj-m12-05'], remediation: 'les-m12-05',
    q: 'The fleet dashboard reads sensor status from a Redis cache with a 30 s TTL that is deleted on every write. State the consistency model for that read path in one sentence, explain why the write path deletes rather than sets the key, and name one failure mode of this cache and its mitigation.',
    rubric: ['States eventual consistency with an explicit bound (up to 30 s stale) and contrasts with a strongly consistent primary read', 'Explains delete-on-write avoids two writers racing to set and leaving the older value last', 'Names a stampede (popular key expiring under load) or cache loss, with jittered TTLs, single-flight recompute or load shedding as mitigation', 'Expresses the tradeoff as a product decision that is written down'],
    answer: 'The dashboard is eventually consistent: a status may be up to 30 seconds stale, while the operator detail page reads the primary and is strongly consistent. Writes delete the key instead of setting it because two concurrent writers setting it could leave the older value in place; deletion forces the next reader to load the committed value. One failure mode is a stampede when a hot key expires and many readers hit the database at once; mitigations are TTL jitter or letting one request recompute while others serve the stale value. The 30 s bound is a product decision recorded in the design.',
    rationale: 'A cache is a consistency tradeoff with a bound, an invalidation rule and known failure modes.',
    misconception: 'Caching is described as pure speed-up with no statement of staleness or failure behaviour.' });

  /* review prompts (changed symptoms, not the same questions) */
  LX.sreReviews.push(
    { id: 'rev-m09-01', objectiveIds: ['obj-m09-01'], kind: 'changed-symptom', prompt: 'A Pod is Pending and the only FailedScheduling line is `0/3 nodes are available: 3 node(s) didn\'t match Pod\'s node affinity/selector`. Memory and CPU are plentiful. What is the fault and the smallest fix?', answer: 'A nodeSelector or required affinity names a label no node carries; fix the selector (or label the intended node), not the requests.' },
    { id: 'rev-m09-02', objectiveIds: ['obj-m09-03'], kind: 'recall', prompt: 'Without looking: why does a denied NetworkPolicy connection time out rather than fail with connection refused, and why does that matter?', answer: 'Enforcement drops packets silently; refused means a packet arrived and nothing listened, so refused points at the service, timeout at the policy.' },
    { id: 'rev-m09-03', objectiveIds: ['obj-m09-05', 'obj-m09-04'], kind: 'changed-symptom', prompt: '`kubectl drain` succeeds immediately on a node running two Beacon API Pods even though a PDB with minAvailable 2 exists. What is the most likely reason?', answer: 'The PDB selector does not match the Pods\' labels (ALLOWED DISRUPTIONS shows the count it protects as 0 of 0), so it protects nothing while looking configured.' },
    { id: 'rev-m10-01', objectiveIds: ['obj-m10-01'], kind: 'changed-symptom', prompt: 'After `helm upgrade --reuse-values --set api.replicas=4`, a chart upgrade later ships a new default `api.resources`, yet the Pods keep the old resources. Why?', answer: '--reuse-values bases the merge on the previous revision\'s values, ignoring new chart defaults; always pass the full environment values file instead.' },
    { id: 'rev-m10-02', objectiveIds: ['obj-m10-03', 'obj-m10-05'], kind: 'recall', prompt: 'Without looking: name the two things a rollback by digest does not restore.', answer: 'The database schema/data written by the newer version, and anything else it changed outside the manifests (queued message formats, rotated secrets).' },
    { id: 'rev-m10-03', objectiveIds: ['obj-m10-04'], kind: 'changed-symptom', prompt: 'A merged commit changes values-prod.yaml but the cluster never changes and the reconciler shows READY True with an older revision. Name two causes.', answer: 'The Kustomization/Application watches a different branch or path, or the chart does not read that values file; compare the last-applied revision with the commit SHA.' },
    { id: 'rev-m11-01', objectiveIds: ['obj-m11-04'], kind: 'changed-symptom', prompt: 'A latency alert with a single 1h window keeps firing for 50 minutes after a 5-minute stall ended. What change makes it clear honestly?', answer: 'Pair the 1h window with a 5m window ANDed together so the alert resolves once the short window shows the burn stopped.' },
    { id: 'rev-m11-02', objectiveIds: ['obj-m11-03'], kind: 'recall', prompt: 'Without looking: for a 99.9% SLO over 30 days with 5,000,000 valid requests, how many bad requests does the budget allow, and what does burn rate 10 mean?', answer: '5,000 bad requests; burn 10 means the month\'s budget would be gone in three days.' },
    { id: 'rev-m11-03', objectiveIds: ['obj-m11-05', 'obj-m11-01'], kind: 'changed-symptom', prompt: 'Prometheus memory is climbing and `count by (__name__)` shows beacon_http_requests_total with 200,000 series. Which label is the likely culprit and where does that information belong?', answer: 'A raw path or id label (path with sensor ids, request_id); use the route template and move per-entity detail to logs or trace attributes.' },
    { id: 'rev-m12-01', objectiveIds: ['obj-m12-02'], kind: 'changed-symptom', prompt: 'pg_stat_activity shows 30 sessions waiting on Lock and the oldest transaction is an `active` ALTER TABLE with no idle-in-transaction session anywhere. What is blocking the ALTER, and which setting would have made it fail fast?', answer: 'A long-running active query on the table (an open read or report) holds a lock the ALTER needs; lock_timeout on the migration session would have aborted it instead of queueing everyone.' },
    { id: 'rev-m12-02', objectiveIds: ['obj-m12-03'], kind: 'recall', prompt: 'Without looking: define RPO and RTO in one sentence each and say which one a nightly pg_dump sets to about 24 hours.', answer: 'RPO is how much data (in time) you accept losing; RTO is how long until verified service is back. A nightly dump sets RPO to up to 24 h.' },
    { id: 'rev-m12-03', objectiveIds: ['obj-m12-04', 'obj-m12-05'], kind: 'changed-symptom', prompt: 'Duplicate rows appear only when the worker is scaled from 1 to 4 replicas. The handler checks `SELECT 1 FROM processed_messages WHERE idem_key = ...` before inserting. What is wrong?', answer: 'Check-then-insert races between workers; a UNIQUE constraint on idem_key with INSERT ... ON CONFLICT DO NOTHING in the same transaction as the effect is what makes it idempotent.' }
  );
})();
