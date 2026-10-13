/* SRE & Cloud Deployment Foundations — question banks for M13–M16.

   Each module: at least eight original bank items (q-mNN-bKK) plus at least
   four unseen gate variants (q-mNN-gKK) that are different questions, not
   reordered choices. Types: mcq, predict (output/log/config context),
   diagnose (context + choose the cause), order (steps in correct order),
   explain (rubric + model answer, self-reviewed). Selected-response items
   list the correct choice first; the gate shuffles positions. Every item
   has a rationale, misconception feedback, difficulty 1–3, objective tags
   and a remediation lesson. All scan output, verify output, timelines and
   provider error messages are synthetic. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreQuestions = LX.sreQuestions || [];
LX.sreReviews = LX.sreReviews || [];

(function () {
  var Q = function (x) { LX.sreQuestions.push(x); };

  /* ═══ M13 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m13-b01', moduleId: 'M13', pool: 'bank', type: 'order', difficulty: 2, objectiveIds: ['obj-m13-01'], remediation: 'les-m13-01',
    q: 'Put the steps of a safe database credential rotation for Beacon in order.',
    steps: ['Create the new role with identical grants alongside the old one', 'Update the Kubernetes Secret and restart the Deployments that consume it', 'Confirm from pg_stat_activity that all sessions use the new role and the old role has zero', 'Verify a request on the user path succeeds', 'Set the old role NOLOGIN', 'Record identifiers and fingerprints, never values, in the evidence'],
    rationale: 'Introduce, move consumers, prove nothing depends on the old credential, verify from the user side, then revoke. Revoking before consumers move is a self-inflicted outage.',
    misconception: 'Changing the password in place feels simpler but cuts every consumer over at once with nothing to fall back to.' });
  Q({ id: 'q-m13-b02', moduleId: 'M13', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m13-01'], remediation: 'les-m13-01',
    context: '$ kubectl -n beacon create secret generic beacon-db --from-file=DATABASE_URL=./dburl.v2 \\\n    --dry-run=client -o yaml | kubectl apply -f -\nsecret/beacon-db configured\n$ kubectl -n beacon get deploy beacon-api -o jsonpath=\'{.spec.template.spec.containers[0].env[0]}\'\n{"name":"DATABASE_URL","valueFrom":{"secretKeyRef":{"key":"DATABASE_URL","name":"beacon-db"}}}\n$ psql -U postgres -c "ALTER ROLE beacon_app_v1 NOLOGIN;"\nALTER ROLE',
    q: 'The Secret was updated and the old role revoked, with no other action. What do the running beacon-api pods do now?',
    choices: ['They keep using the old credential from their environment and fail authentication on every new connection until a rollout restart', 'They pick up the new value within a minute and keep working', 'They crash immediately because the Secret changed', 'They fall back to the new role automatically because the Secret name is the same'],
    a: 0, rationale: 'A Secret consumed as an environment variable is read once at container start. Without `kubectl rollout restart`, the pods still hold the old value, which was just revoked.',
    misconception: 'Environment variables and volume mounts behave differently; only mounted Secrets refresh, and not with subPath.' });
  Q({ id: 'q-m13-b03', moduleId: 'M13', pool: 'bank', type: 'mcq', difficulty: 1, objectiveIds: ['obj-m13-01'], remediation: 'les-m13-01',
    q: 'Which line belongs in the rotation evidence report?',
    choices: ['`rotated beacon-db v1 -> v2, fingerprint 3f9a1c42, old role NOLOGIN at 10:42Z, 0 sessions as v1 before revocation`', '`new DATABASE_URL=postgres://beacon_app_v2:Qx7...@db:5432/beacon`', '`kubectl get secret beacon-db -o yaml` output pasted in full', 'A screenshot of the password manager entry'],
    a: 0, rationale: 'Evidence names the credential by identifier and fingerprint with timestamps. Any value — even base64-encoded in a Secret dump — is a second copy you cannot revoke.',
    misconception: 'Base64 in a Secret is encoding, not protection; pasting it is pasting the secret.' });
  Q({ id: 'q-m13-b04', moduleId: 'M13', pool: 'bank', type: 'diagnose', difficulty: 3, objectiveIds: ['obj-m13-02'], remediation: 'les-m13-02',
    context: '$ grype registry.lab/beacon-api@sha256:7c1e...\nNAME         INSTALLED          FIXED-IN          VULNERABILITY   SEVERITY\nlibssl3      3.0.13-1~deb12u1   3.0.15-1~deb12u1  CVE-2024-6119   High\nzlib1g       1:1.2.13.dfsg-1    (won\'t fix)       CVE-2023-45853  Critical\n$ dpkg -L zlib1g | grep -i minizip\n$ echo $?\n1',
    q: 'CVE-2023-45853 concerns minizip, which the zlib source package contains. Given the evidence, how should the two findings be triaged?',
    choices: ['libssl3: fix by moving the base-image pin to a digest carrying 3.0.15; zlib1g: not applicable, with the empty dpkg -L check as the reason', 'Both: fix by running apt-get upgrade in the Dockerfile', 'zlib1g first because it is Critical; libssl3 can wait', 'Both: unknown, because the scanner cannot be trusted'],
    a: 0, rationale: 'A fixed version exists for libssl3, so it is a pin bump and rebuild. The minizip files are not shipped in the zlib1g binary (dpkg -L finds nothing), so the Critical does not apply here — and the reason is a checkable command.',
    misconception: 'Sorting by severity alone produces busy reports; applicability and fixed-version decide the action.' });
  Q({ id: 'q-m13-b05', moduleId: 'M13', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m13-02'], remediation: 'les-m13-02',
    q: 'A scanner flags `libgnutls30 3.7.9-2+deb12u3` for a CVE, but the Debian security tracker shows that exact version carries the backported fix. Which triage category and reason are correct?',
    choices: ['Already fixed — the distribution backported the fix under the old version string; cite the tracker entry', 'Not applicable — Beacon does not use TLS', 'Fix — rebuild with the upstream version number the scanner wants', 'Unknown — scanners and trackers disagree so nothing can be said'],
    a: 0, rationale: 'Backports keep the version string and change the code, so version matching is wrong. The tracker entry is the checkable reason for "already fixed".',
    misconception: '"Not applicable" requires evidence that the vulnerable component or path is absent; a backport is a different category.' });
  Q({ id: 'q-m13-b06', moduleId: 'M13', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m13-04'], remediation: 'les-m13-03',
    context: '$ cosign sign --key cosign.key registry.lab/beacon-api@sha256:a41d...\nPushing signature to: registry.lab/beacon-api\n# ... later, a rebuilt image is pushed to the same tag ...\n$ crane digest registry.lab/beacon-api:1.8.1\nsha256:9e02...\n$ cosign verify --key cosign.pub registry.lab/beacon-api:1.8.1',
    q: 'What does the final command print, and what should the deploy gate do?',
    choices: ['`Error: no matching signatures` with a non-zero exit; the gate stops, because the tag now resolves to an unsigned digest', 'Verified OK, because the tag is the same one that was signed', 'A warning that the tag moved, then Verified OK', 'Nothing; cosign cannot verify by tag'],
    a: 0, rationale: 'The signature covers digest a41d…; the tag now points at 9e02…, which no signature by this key covers. Verification fails and only exit 0 may continue.',
    misconception: 'Signing by tag reference signs the digest it resolved to at the time; a moved tag is a different artifact.' });
  Q({ id: 'q-m13-b07', moduleId: 'M13', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m13-04'], remediation: 'les-m13-03',
    q: 'What does a valid `cosign verify --key cosign.pub` result prove about a Beacon image?',
    choices: ['That the holder of the matching private key signed exactly this digest — nothing about whether the contents are safe', 'That the image has no known vulnerabilities', 'That the image was built from the main branch', 'That the SBOM is accurate'],
    a: 0, rationale: 'A signature binds a key to bytes. Safety comes from the SBOM, scan and triage; build origin comes from a provenance attestation, which is a separate signed statement.',
    misconception: 'Conflating "signed" with "safe" is how a signed vulnerable image gets deployed without triage.' });
  Q({ id: 'q-m13-b08', moduleId: 'M13', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m13-05'], remediation: 'les-m13-04',
    context: '# isolated cluster, egress NetworkPolicy applied, bundle loaded into registry.lab:5000\n$ kubectl -n beacon get pods\nNAME                           READY   STATUS             RESTARTS   AGE\nbeacon-api-6f9c7d8b5-k2x4p     0/1     Running            0          9m\nbeacon-worker-5d7b9c6f4-q8w2z  1/1     Running            0          9m\nbeacon-redis-0                 0/1     ImagePullBackOff   0          9m\n$ kubectl -n beacon describe pod beacon-redis-0 | grep -A1 Failed\n  Warning  Failed  ... Failed to pull image "registry.lab/redis:7.4.1": dial tcp: lookup registry.lab: no such host',
    q: 'What went wrong with this delivery?',
    choices: ['The inventory or the values were incomplete: the Redis subchart still references the connected-side registry, which is unreachable with egress blocked', 'The egress NetworkPolicy is too strict and must be removed', 'Redis 7.4.1 is not compatible with the cluster', 'The signature on the Redis image is invalid'],
    a: 0, rationale: 'The image reference points at `registry.lab`, not the mirror `registry.lab:5000`; with egress blocked that name does not resolve. The chart values (global.imageRegistry or the subchart image) did not cover the transitive image.',
    misconception: 'Removing the egress policy would "fix" it by leaking a pull to the outside, which is the condition the delivery was supposed to prove it does not need.' });
  Q({ id: 'q-m13-b09', moduleId: 'M13', pool: 'bank', type: 'explain', difficulty: 2, objectiveIds: ['obj-m13-05', 'obj-m13-04'], remediation: 'les-m13-04',
    q: 'Explain why the signing public key must not travel inside the bundle it verifies, and describe the trusted-key bootstrap you would document for the isolated side.',
    rubric: ['States that an attacker who replaces the bundle could replace an in-bundle key, so verification would prove nothing', 'Names an independent channel: a reviewed commit to the isolated configuration repository, or separate media', 'Names the fingerprint check (sha256sum of cosign.pub compared with the runbook) as the bootstrap evidence', 'Mentions the fallback: rotation and compromise handling through the same independent channel'],
    answer: 'If the key arrives with the bundle, whoever controls the bundle controls the key, so a tampered bundle would carry a key that verifies it. The public key must reach the isolated side by a channel the bundle source does not control — a reviewed change to that environment\'s configuration repository, or separate media — and its sha256 fingerprint is compared against the runbook on both sides and recorded. Rotation and compromise handling use the same channel: a new key is distributed first, trust in the old key is removed, and bundles signed only by the old key are treated as unverified until re-signed.',
    rationale: 'Trust has to start somewhere the artifact source cannot touch; the fingerprint check is the recorded evidence that it did.',
    misconception: 'Fetching the key from the registry or the bundle feels convenient and verifies nothing.' });
  Q({ id: 'q-m13-b10', moduleId: 'M13', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m13-03'], remediation: 'les-m13-05',
    q: 'In the kind-cluster lab, how should the evidence package describe physical and environmental protection?',
    choices: ['Not addressed in this environment — no provider to inherit from and nothing implemented; recorded as residual risk', 'Inherited from the cloud provider', 'Implemented, because the laptop has a login password', 'Omitted, because it is out of scope for engineers'],
    a: 0, rationale: 'Inheritance requires a provider who actually provides and documents the control. The lab runs on a personal machine, so the honest entry is "not addressed", with the risk noted.',
    misconception: 'Claiming inheritance for a control nobody provides is the common overclaim; omitting it hides a gap.' });

  Q({ id: 'q-m13-g01', moduleId: 'M13', pool: 'gate', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m13-01'], remediation: 'les-m13-01',
    context: '$ psql -U postgres -c "SELECT usename, count(*) FROM pg_stat_activity WHERE datname=\'beacon\' GROUP BY 1;"\n   usename     | count\n---------------+-------\n beacon_app_v2 |     6\n beacon_app_v1 |     2\n$ kubectl -n beacon get pods -l app=beacon-worker -o jsonpath=\'{.items[*].metadata.creationTimestamp}\'\n2026-10-11T08:02:11Z 2026-10-11T08:02:11Z',
    q: 'The API was restarted after the Secret update, and you are about to set beacon_app_v1 NOLOGIN. What does the evidence say?',
    choices: ['Do not revoke yet: two sessions still use v1, and the worker pods predate the rotation — they were never restarted', 'Revoke now: six of eight sessions are on v2, which is a majority', 'Revoke now: the two v1 sessions are idle leftovers', 'Drop the v1 role directly; NOLOGIN is unnecessary'],
    a: 0, rationale: 'Revocation waits for zero consumers of the old credential. The worker pods were created before the rotation and still hold the old value; a rollout restart of the worker comes first.',
    misconception: 'A majority on the new credential is not the test; any remaining consumer breaks at revocation.' });
  Q({ id: 'q-m13-g02', moduleId: 'M13', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m13-02'], remediation: 'les-m13-02',
    context: 'Dockerfile before:\n  FROM python:3.12.7-slim-bookworm@sha256:3c1e...\nDockerfile after:\n  FROM python:3.12-slim-bookworm\n  RUN apt-get update && apt-get upgrade -y\nCommit message: "pick up security patches automatically"',
    q: 'What has this change done to the image\'s patch evidence?',
    choices: ['Made the build non-reproducible: the packages depend on the day it runs, no single pin changed, and a rescan cannot be tied to a stable input', 'Improved it: the image is now always patched', 'No effect; the scanner looks at the output image only', 'Improved it: a floating tag is equivalent to a digest for a slim image'],
    a: 0, rationale: 'Patching is moving the pin deliberately and rescanning the new digest. A floating tag plus apt-get upgrade hides what changed and makes the before/after pair meaningless.',
    misconception: '"Automatic patches" trade a visible, triaged change for an invisible one.' });
  Q({ id: 'q-m13-g03', moduleId: 'M13', pool: 'gate', type: 'order', difficulty: 2, objectiveIds: ['obj-m13-05', 'obj-m13-04'], remediation: 'les-m13-04',
    q: 'Order the steps on the isolated side when a Beacon bundle arrives.',
    steps: ['Confirm the public key fingerprint against the runbook (key arrived separately)', 'Run sha256sum -c SHA256SUMS and verify the signature over SHA256SUMS', 'Push images into the local mirror registry as OCI artifacts', 'cosign verify each image digest from the mirror', 'Install the chart with values pointing at the mirror', 'Prove egress is blocked with a deliberate failing outbound request'],
    rationale: 'Verify before load, load before point, and prove isolation rather than assume it. Any checksum or signature failure before the load step rejects the whole bundle.',
    misconception: 'Loading first and verifying later means a tampered image may already be in the mirror.' });
  Q({ id: 'q-m13-g04', moduleId: 'M13', pool: 'gate', type: 'explain', difficulty: 3, objectiveIds: ['obj-m13-03'], remediation: 'les-m13-05',
    q: 'A reviewer asks what distinguishes evidence from a claim in your synthetic package, and why the package cannot support any statement about authorization. Answer in three to five sentences.',
    rubric: ['Evidence is specific, dated, reproducible: commands, digests, fingerprints, timestamps, referenced files', 'A claim is a policy statement without an artifact ("we rotate secrets")', 'Evidence never contains the secret it describes', 'Authorization is a decision by a designated official about a real system after assessment; lab artifacts are practice and confer nothing'],
    answer: 'Evidence is an artifact someone else can check: a scan with both digests and a reason per finding, a rotation record with role names, fingerprints and timestamps, a cosign verify output with the key fingerprint, each referencing the file it came from. "We rotate secrets" is a claim with no artifact. Evidence names secrets by identifier, never by value. None of it supports an authorization statement because authorization is a decision an authorizing official makes about a real, categorised, assessed system; this package describes a lab on a laptop with synthetic data and says so on its cover.',
    rationale: 'RMF literacy is mapping artifacts to vocabulary honestly, including the limits of what the artifacts show.',
    misconception: 'Treating a complete-looking package as an approval of anything is the overclaim the exercise fails outright.' });
  Q({ id: 'q-m13-g05', moduleId: 'M13', pool: 'gate', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m13-04'], remediation: 'les-m13-03',
    q: 'Why does `syft` run against the final image digest rather than the source tree when producing Beacon\'s SBOM?',
    choices: ['So the inventory includes what actually ships, including the base image\'s packages, and can be attested to that exact digest', 'Because syft cannot read source code', 'Because the source tree has no Python dependencies', 'So the SBOM is smaller'],
    a: 0, rationale: 'The SBOM must describe the artifact that is deployed. The base image contributes most of the OS packages, and the attestation binds the SBOM to the digest it was generated from.',
    misconception: 'A source-only SBOM misses the base image, where most CVE findings live.' });

  /* ═══ M14 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m14-b01', moduleId: 'M14', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m14-01'], remediation: 'les-m14-01',
    context: 'offered  achieved  p95     errors  api-cpu (of 1000m)  pg-conns (of 100)  pool-wait p95\n100 rps  100 rps    36 ms   0        410m                 9                 1 ms\n150 rps  150 rps    58 ms   0        640m                10                 1 ms\n200 rps  176 rps   420 ms   0        970m                12                 2 ms\n250 rps  180 rps  1900 ms  41        985m                12                 2 ms',
    q: 'Where is the saturation point and what is the bottleneck?',
    choices: ['Capacity is about 180 rps; the bottleneck is API pod CPU, which is at its limit while database connections and pool wait stay low', 'Capacity is 250 rps; the bottleneck is the database', 'There is no saturation; errors at 250 rps are load-generator noise', 'Capacity is 100 rps; latency doubled between 100 and 150'],
    a: 0, rationale: 'Achieved throughput flattens near 180 rps as p95 climbs, and the only resource at its ceiling is API CPU. Database metrics are far from saturation.',
    misconception: 'Latency rising modestly before the knee is normal; the knee is where throughput stops following offered load.' });
  Q({ id: 'q-m14-b02', moduleId: 'M14', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m14-01'], remediation: 'les-m14-01',
    q: 'A staircase test shows latency climbing at 180 rps with API CPU at 300m of 1000m and PostgreSQL connections at 100 of 100 with pool wait rising. What does adding two API replicas do?',
    choices: ['Makes it worse: each replica opens its own pool, so the saturated database sees more connections and contention for the same work', 'Doubles capacity, as replicas always do', 'Fixes it, because the API is the only tier that can scale', 'Nothing either way; replicas are independent of the database'],
    a: 0, rationale: 'Replicas help only when the saturated resource is per-replica. Here the shared database pool is saturated; the fix is a pooler, a smaller per-pod pool or a faster query.',
    misconception: '"Scale out" is a reflex that ignores where the bottleneck actually is.' });
  Q({ id: 'q-m14-b03', moduleId: 'M14', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m14-01'], remediation: 'les-m14-01',
    context: '$ hey -z 60s -c 10 -m POST -D sample.json http://beacon.corp.lab/v1/readings\nSummary:\n  Requests/sec: 199.8\n  Average:      0.0500 secs\n  Slowest:      0.0612 secs',
    q: 'With 10 concurrent workers and 50 ms average latency, is 200 rps the service\'s capacity?',
    choices: ['Not proven: 10 / 0.05 s = 200 rps is exactly the generator\'s own limit by Little\'s law; raise concurrency and repeat until the knee stops moving', 'Yes: the generator reports requests per second directly', 'No: capacity is always higher than any single test shows', 'Yes, because the slowest request is under 100 ms'],
    a: 0, rationale: 'At fixed concurrency, throughput is bounded by concurrency divided by latency. A knee at that bound belongs to the generator, not the service.',
    misconception: 'Reading the generator\'s summary as the service\'s ceiling is the commonest load-test mistake.' });
  Q({ id: 'q-m14-b04', moduleId: 'M14', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m14-02'], remediation: 'les-m14-02',
    q: 'Which three conditions must all hold before a Beacon client retries a failed POST /v1/readings?',
    choices: ['The request carries an idempotency key, the error is retryable (timeout, 503, reset — not 4xx), and the retry budget with backoff and jitter allows it', 'The error is any non-200, the client has not retried more than ten times, and the server is a known host', 'The request is small, the network is fast, and the server returned a body', 'The error is a 403, the token was refreshed, and the retry is immediate'],
    a: 0, rationale: 'Retries are safe only when they cannot duplicate data, the failure might change on a second attempt, and the total retry load is bounded so clients cannot amplify an outage.',
    misconception: 'Retrying 4xx responses or retrying immediately without a budget multiplies load at the worst moment.' });
  Q({ id: 'q-m14-b05', moduleId: 'M14', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m14-02'], remediation: 'les-m14-02',
    context: '# beacon-api config\nDB_STATEMENT_TIMEOUT=2s\nHANDLER_QUEUE_MAX=50          # beyond this: immediate 503 + Retry-After: 2\nDB_BREAKER=open_after 50% failures in 10s, probe every 10s\n# injected fault: PostgreSQL stalls for 30 s at t+0',
    q: 'What does `GET /v1/sensors/42/status` return between t+5s and t+30s, and what happens to POSTs?',
    choices: ['GET serves the last known status from Redis labelled stale with a cheap, fast response; POSTs return 202 and are queued with their idempotency keys for the worker to persist afterwards', 'Both GET and POST return 500 until the stall ends', 'GET waits up to 30 s for the database; POSTs are dropped', 'GET returns an invented default status so clients are not disturbed'],
    a: 0, rationale: 'The breaker opens after the timeouts accumulate, so calls fail fast and the degradation path runs: labelled stale reads and accept-and-queue writes. Data stays correct; only freshness degrades.',
    misconception: 'Graceful degradation never invents data and never silently drops accepted writes.' });
  Q({ id: 'q-m14-b06', moduleId: 'M14', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m14-03'], remediation: 'les-m14-03',
    context: 'Canary: 1 replica of beacon-api-canary (1.9.0) beside 9 replicas of 1.8.1, 8 minutes bake.\nversion  req/s  5xx rate  p95\n1.8.1    162    0.18%     41 ms\n1.9.0     17    3.90%     44 ms\nAbort rule: 5xx rate > baseline + 1 point for 5 min. Release 1.9.0 contains no schema migration.',
    q: 'What is the right action and why is no `helm rollback` involved?',
    choices: ['Remove the canary Deployment so its ~10% of traffic returns to 1.8.1; the main release never changed, so there is nothing to roll back', 'Run helm rollback to the previous revision', 'Promote 1.9.0: p95 is fine and the error rate is a small sample', 'Scale the canary to 5 replicas to get a bigger sample'],
    a: 0, rationale: 'The abort rule fired on a comparison the version label made possible. The canary is a separate Deployment; removing it is the rollback, and the schema is unchanged so there is no compatibility question.',
    misconception: 'A canary that fails is not a reason to collect more failures; the abort criteria were decided beforehand.' });
  Q({ id: 'q-m14-b07', moduleId: 'M14', pool: 'bank', type: 'mcq', difficulty: 3, objectiveIds: ['obj-m14-03'], remediation: 'les-m14-03',
    q: 'Release 1.9.2 ran the contract step of a migration (dropped the `legacy_status` column) and is now rejecting 2% of worker messages. Rollback or fix forward?',
    choices: ['Fix forward with the smallest change: 1.8.x reads the dropped column, so rolling back the code would be a worse outage', 'Rollback: it is always the safer choice', 'Rollback the code and the migration together with helm rollback', 'Neither: wait for the error rate to settle'],
    a: 0, rationale: 'Rollback is available only when the previous version is compatible with the current data. After a contract step it is not; the release note should have said so and named the fix-forward plan.',
    misconception: 'helm rollback reverts manifests, not database schema changes.' });
  Q({ id: 'q-m14-b08', moduleId: 'M14', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m14-04'], remediation: 'les-m14-04',
    context: '11:20 UTC update, posted by the comms lead:\n"We think the database might be having issues. Some users may see errors. The team is looking into it. Will update when we know more."',
    q: 'What is wrong with this update, judged against the structure the course teaches?',
    choices: ['It speculates about cause, has no scope (which operation, what fraction, since when, who), and promises no next-update time', 'It is too short; updates should include the full timeline', 'It should name the engineer who deployed the change', 'Nothing; it is appropriately cautious'],
    a: 0, rationale: 'An update states timestamp, scope, what is known, what is being done and when the next update comes. Cause appears only once established by evidence.',
    misconception: 'Vagueness feels safe but generates the questions that interrupt the people fixing the problem.' });
  Q({ id: 'q-m14-b09', moduleId: 'M14', pool: 'bank', type: 'explain', difficulty: 3, objectiveIds: ['obj-m14-04'], remediation: 'les-m14-04',
    q: 'The 02:00 backup restores in eight minutes but loses every reading since then; repairing the live table keeps everything but takes about an hour and might fail. Write the recovery-point decision as the commander would record it, naming the facts it rests on.',
    rubric: ['States the promised RPO from the design', 'Quantifies the data at stake: how many readings, which tenants, whether the queue or the sources can replay any of it', 'States confidence in and a time budget for the slow path, with the fallback if the budget expires', 'Records the decision with a timestamp so the postmortem can test the facts'],
    answer: 'Example: "11:16 UTC — RPO promise is 15 min. Restoring the 02:00 snapshot loses about 11,400 readings across 3 tenants with no replay source beyond the worker queue, which holds the last 40 minutes. The repair path is understood (one corrupted index) and reversible. Decision: repair in place with a 60-minute budget; if not verified by 12:16 UTC, restore the snapshot and replay the queue. Facts to confirm in the postmortem: the queue retention and the tenant counts." The decision is defensible because the facts and the rejected branch are written down, not because it turns out right.',
    rationale: 'A recovery-point decision with data at stake is a documented trade-off made by the commander with the evidence on the table.',
    misconception: 'Choosing the fast restore "to be safe" without quantifying the loss is an unrecorded data-loss incident.' });
  Q({ id: 'q-m14-b10', moduleId: 'M14', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m14-05'], remediation: 'les-m14-05',
    context: 'Rehearsal log (excerpt):\n13:00 start; promise RTO 30 min / RPO 15 min; last accepted reading id 884,210 at 12:59:40\n13:20 pg_restore complete from 12:50 base backup; WAL replay to 12:58:12\n13:24 queue replay persisted 1,120 readings; last id in DB now 884,198 at 12:59:31\n13:31 API Ready; POST accepted; GET returns restored data\n13:47 verification complete',
    q: 'What are the RTO and RPO achieved, and how do they compare to the promise?',
    choices: ['RTO 31 min to first user-path success (47 min to verified) versus 30 promised; RPO 9 seconds / 12 readings versus 15 min promised — RTO missed slightly, RPO met', 'RTO 20 min, RPO 10 min — both met', 'RTO 47 min, RPO 15 min — RPO met exactly because that is the schedule', 'RTO cannot be measured because verification continued after service returned'],
    a: 0, rationale: 'RTO is measured to the first successful user-path check (13:31), with full verification noted separately. RPO achieved is the measured gap between the last accepted reading and the last one present after replay, not the backup interval.',
    misconception: 'RPO achieved is a measurement against accepted data, not the backup schedule.' });

  Q({ id: 'q-m14-g01', moduleId: 'M14', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m14-02'], remediation: 'les-m14-02',
    context: 'Dependency starts timing out 20% of requests at its knee.\nClient policy: retry up to 3 times, immediately, on any error.',
    q: 'Relative to before the failure, how much traffic does the dependency now receive, and what is the effect?',
    choices: ['Up to 1.6x (1 + 0.2 × 3), concentrated during the failure, pushing the dependency further past its knee', 'Exactly the same; retries replace failed requests one for one', '1.2x, since only failed requests are retried once', 'Less, because failing requests are shorter'],
    a: 0, rationale: 'Each failing request can generate three extra attempts. Unbounded immediate retries turn a partial slowdown into a retry storm; a budget with backoff caps the amplification.',
    misconception: 'Retries are extra load at the moment the service can least absorb it.' });
  Q({ id: 'q-m14-g02', moduleId: 'M14', pool: 'gate', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m14-01'], remediation: 'les-m14-01',
    q: 'What does "headroom" mean in a Beacon capacity report, and how is it computed?',
    choices: ['The gap between normal peak load and the measured saturation point of the current configuration, e.g. a 180 rps knee against a 90 rps peak is 2x', 'The number of replicas that could be added before the node is full', 'The difference between p50 and p95 latency', 'The CPU limit minus the CPU request'],
    a: 0, rationale: 'Headroom tells you how much growth or burst the service absorbs before latency climbs; it is defined against the measured knee, not against a resource limit alone.',
    misconception: 'Resource limits are an input to capacity; the knee is the measured output.' });
  Q({ id: 'q-m14-g03', moduleId: 'M14', pool: 'gate', type: 'order', difficulty: 2, objectiveIds: ['obj-m14-03'], remediation: 'les-m14-03',
    q: 'Order the steps for a replica-proportion canary on the kind cluster.',
    steps: ['Write the health and abort criteria and the bake time before deploying', 'Deploy beacon-api-canary with the new digest and one replica behind the existing Service', 'Compare error rate and p95 by version label in Prometheus for the bake period', 'If abort criteria fire, delete the canary Deployment and record the metric', 'If healthy, change the main Deployment\'s digest to the new one', 'Remove the canary Deployment after promotion'],
    rationale: 'Criteria first, then expose a small share, compare by label over the full bake, and only then promote or abort. Promoting before removing the canary avoids a gap in capacity.',
    misconception: 'Deciding the abort rule after seeing the numbers turns a canary into a rationalisation.' });
  Q({ id: 'q-m14-g04', moduleId: 'M14', pool: 'gate', type: 'diagnose', difficulty: 3, objectiveIds: ['obj-m14-04'], remediation: 'les-m14-04',
    context: 'Postmortem draft — contributing factors:\n1. R. ran the migration during peak hours.\n2. R. forgot to set a lock timeout.\nAction items:\n- Be more careful with migrations.\n- Consider adding an alert.',
    q: 'What must change before this postmortem is acceptable?',
    choices: ['Rewrite factors to be about the system (no lock timeout enforced, no lock-wait alert, migration bundled with a peak-hour deploy) and give each action an owner and a date', 'Add the name of the reviewer who approved the change', 'Remove the action items; the factors are enough', 'Add a severity rating and a root-cause sentence naming R.'],
    a: 0, rationale: 'Blameless means asking why the system allowed a reasonable action to cause harm. Follow-ups without owners and dates are wishes.',
    misconception: '"Human error" as a factor produces "be more careful" as a fix, which changes nothing.' });
  Q({ id: 'q-m14-g05', moduleId: 'M14', pool: 'gate', type: 'explain', difficulty: 2, objectiveIds: ['obj-m14-05'], remediation: 'les-m14-05',
    q: 'Propose one toil reduction from the Beacon labs in the form the course requires: baseline, change, expected effect, re-measurement.',
    rubric: ['Identifies a task that meets the toil properties (manual, repetitive, automatable, tactical, no enduring value, scales with the service)', 'States a measured baseline (occurrences × minutes, or a failure class)', 'Proposes one specific change', 'States the expected measurable effect and when it will be re-measured'],
    answer: 'Example: the manual copy of the backup Secret into each new namespace happens about three times a week at ten minutes each and caused one stale-copy incident last month. Change: a Job in the chart\'s restore mode that syncs the Secret on namespace creation. Expected effect: thirty minutes a week to zero and the stale-copy failure class removed. Re-measure by counting occurrences and incidents over the two weeks after the change ships.',
    rationale: 'A toil reduction is reportable when it has a baseline, one change, a predicted effect and a date to check it.',
    misconception: 'Listing several good intentions without a measurement is not a reduction.' });

  /* ═══ M15 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m15-b01', moduleId: 'M15', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m15-01', 'obj-m15-02'], remediation: 'les-m15-01',
    q: 'Which statement about resource hierarchy is accurate?',
    choices: ['An Azure subscription is a billing and quota container that trusts one Entra ID tenant; the tenant, not the subscription, is the identity boundary', 'An Azure subscription is the exact equivalent of an AWS account', 'A GCP project is a billing unit only; APIs are enabled at the organization', 'AWS Organizations grants permissions to member accounts through service control policies'],
    a: 0, rationale: 'Several subscriptions share one tenant\'s identities; an AWS account is both billing and identity boundary; a GCP project is where APIs are enabled; SCPs only restrict.',
    misconception: 'Treating subscription, account and project as synonyms is the first wrong row in a naive translation.' });
  Q({ id: 'q-m15-b02', moduleId: 'M15', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m15-02'], remediation: 'les-m15-02',
    context: '$ az aks get-credentials -g beacon-prod -n beacon\nThe client \'ops@corp.lab\' with object id \'4f1c...\' does not have authorization to perform action\n\'Microsoft.ContainerService/managedClusters/listClusterUserCredential/action\' over scope\n\'/subscriptions/9a7e.../resourceGroups/beacon-prod/providers/Microsoft.ContainerService/managedClusters/beacon\'\nor the scope is invalid. (AuthorizationFailed)\n$ az role assignment list --assignee ops@corp.lab --output table\nRole                        Scope\nAzure Kubernetes Service Cluster User Role   /subscriptions/9a7e.../resourceGroups/beacon-dev',
    q: 'Why does the call fail, and what is the narrowest fix?',
    choices: ['The role was assigned at the beacon-dev resource group; assignments inherit down, not sideways, so beacon-prod is uncovered — assign the role at the beacon-prod cluster (or its group) scope', 'The user is in the wrong tenant; switch tenants', 'The subscription is wrong; run az account set', 'AKS does not support role assignments; use kubeconfig directly'],
    a: 0, rationale: 'The error names the resource\'s scope; the assignment list shows the grant lives on a sibling resource group. Azure RBAC inherits downward through the scope tree only.',
    misconception: 'Granting "on the subscription" would also work but is wider than needed; least privilege picks the cluster or its resource group.' });
  Q({ id: 'q-m15-b03', moduleId: 'M15', pool: 'bank', type: 'diagnose', difficulty: 3, objectiveIds: ['obj-m15-02'], remediation: 'les-m15-02',
    context: '# inside the pipeline pod on GKE (project beacon-build)\n$ curl -s -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/email\nbeacon-ci@beacon-build.iam.gserviceaccount.com\n$ gcloud artifacts docker images list europe-west4-docker.pkg.dev/beacon-registry/beacon\nERROR: (gcloud.artifacts.docker.images.list) PERMISSION_DENIED: Permission "artifactregistry.repositories.downloadArtifacts" denied on resource "projects/beacon-registry/locations/europe-west4/repositories/beacon" (or it may not exist)\n$ gcloud projects get-iam-policy beacon-build --flatten="bindings[].members" --filter="bindings.members:beacon-ci@" --format="value(bindings.role)"\nroles/artifactregistry.reader',
    q: 'The identity is correct. What explains the 403?',
    choices: ['The reader role was granted on project beacon-build, the caller\'s own project; grants inherit down a hierarchy, never across projects, so beacon-registry has no binding for this service account', 'Workload Identity is not configured, so the pod has no identity', 'The repository does not exist', 'The gcloud CLI is pointed at the wrong project'],
    a: 0, rationale: 'The metadata server proves the principal; the policy on the caller\'s project is irrelevant to a resource in another project. The binding belongs on the repository or project beacon-registry.',
    misconception: 'GCP\'s "or it may not exist" wording hides whether the resource is missing or unreadable; check the resource-side policy.' });
  Q({ id: 'q-m15-b04', moduleId: 'M15', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m15-01'], remediation: 'les-m15-01',
    q: 'Which networking difference changes a two-region Beacon design between providers?',
    choices: ['A GCP VPC is global with regional subnets, while AWS VPCs and Azure VNets are regional, so two regions need peering on AWS/Azure but not on GCP', 'Azure VNets are global and AWS VPCs are regional', 'All three are regional, so the designs are the same', 'GCP has no private subnets'],
    a: 0, rationale: 'Scope of the network primitive differs; a design that assumes two regions share one network is right on GCP and wrong on the other two.',
    misconception: '"A VPC is a VPC" is the analogy that breaks at the first multi-region requirement.' });
  Q({ id: 'q-m15-b05', moduleId: 'M15', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m15-04', 'obj-m15-01'], remediation: 'les-m15-03',
    context: '# from a pod in the AKS cluster\'s VNet; database has public access disabled and a Private Endpoint\n$ dig +short beacon-db.postgres.database.azure.com\nbeacon-db.privatelink.postgres.database.azure.com.\n20.61.14.9',
    q: 'What will the API\'s connection attempt do, and what is missing?',
    choices: ['Time out: the name resolves through the privatelink alias to a public address, so the private DNS zone is not linked to the VNet', 'Succeed: the privatelink alias proves the endpoint is in use', 'Fail with "password authentication failed"', 'Succeed over the public address because the pod has outbound access'],
    a: 0, rationale: 'The alias exists but resolution ends at a public IP, which the server refuses. Linking `privatelink.postgres.database.azure.com` to the VNet makes the name resolve to the endpoint\'s private IP.',
    misconception: '"Connection timed out" to a private service is usually DNS, not a firewall rule.' });
  Q({ id: 'q-m15-b06', moduleId: 'M15', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m15-04'], remediation: 'les-m15-03',
    q: 'Which responsibility stays with the operator on EKS, AKS and GKE alike?',
    choices: ['PodDisruptionBudgets, probes, RBAC, NetworkPolicy and resource requests for the workloads — node upgrades will drain pods regardless', 'etcd backups of the control plane', 'Patching the API server', 'Scheduling the control plane across zones'],
    a: 0, rationale: 'The provider runs the control plane; the operator still owns everything that runs on the cluster and how it survives the provider\'s maintenance.',
    misconception: '"Managed" is read as "managed for me"; the split differs by provider but workloads are never the provider\'s.' });
  Q({ id: 'q-m15-b07', moduleId: 'M15', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m15-03'], remediation: 'les-m15-04',
    context: 'HTTP/1.1 429 Too Many Requests\nRetry-After: 12\nx-ratelimit-limit: 600\nx-ratelimit-remaining: 0\nx-request-id: 7c0e-...\n\n{"error":"rate_limited","scope":"api_key"}',
    q: 'The client retries immediately five times. What does it most likely see, and what should it have done?',
    choices: ['Five more 429s and possibly a longer Retry-After; it should wait at least 12 s with jitter — the limit is per key, so the budget does not refill until it waits', 'A 200 on the second try, because the limit resets per request', 'A 503, because the service is overloaded', 'A 401, because the key was revoked'],
    a: 0, rationale: '429 is the service telling the caller to slow down. The headers state the window and that the key\'s budget is exhausted; immediate retries only consume more.',
    misconception: 'Treating 429 like a 5xx to be retried immediately extends the throttling.' });
  Q({ id: 'q-m15-b08', moduleId: 'M15', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m15-03'], remediation: 'les-m15-04',
    context: '$ python3 repro.py   # GET /v1/sensors/stream, stream=True, timeout=(3.05, 30)\nrun 1: ChunkedEncodingError after 60.0 s, 1840 events, x-request-id 7c0e-a1\nrun 2: ChunkedEncodingError after 60.1 s, 1799 events, x-request-id 7c0e-a2\nrun 3: ChunkedEncodingError after 60.0 s, 1856 events, x-request-id 7c0e-a3\nservice log for 7c0e-a1: stream still writing at t+60.0s, client connection closed by peer',
    q: 'Who owns this failure and what is the likely mechanism?',
    choices: ['Something between client and service (ingress or load balancer) with a 60-second idle timeout; the service was still writing, so the service is not the owner and the stream needs keepalive events or a longer timeout', 'The service, which crashes every minute', 'The client, whose read timeout is too short', 'The network, dropping packets randomly'],
    a: 0, rationale: 'A consistent cut at 60 s with the service still writing and the request id confirming it points at an intermediary\'s idle timeout. The client\'s read timeout is 30 s and did not fire.',
    misconception: 'Random-looking stream drops often have a fixed period once you measure elapsed time.' });
  Q({ id: 'q-m15-b09', moduleId: 'M15', pool: 'bank', type: 'explain', difficulty: 2, objectiveIds: ['obj-m15-03'], remediation: 'les-m15-04',
    q: 'Describe the minimal sanitised Python reproduction you would attach to a support ticket for a failing Beacon API call: what it contains, what it prints, and what it must never include.',
    rubric: ['One call with hard-coded minimal input and an explicit (connect, read) timeout', 'Sends an X-Request-Id and prints both the sent id and the one the service returned', 'Prints status code, relevant headers (Retry-After, WWW-Authenticate) and a bounded body excerpt', 'Token from the environment, never printed; customer identifiers replaced with placeholders'],
    answer: 'A single script: one `requests.post` (or urllib call) to the endpoint with a minimal body, `timeout=(3.05, 30)`, headers carrying `Authorization` from an environment variable and an `X-Request-Id` generated with uuid4. It prints the status code, the request id sent and the `x-request-id` returned, `Retry-After` and `WWW-Authenticate` if present, and the first 300 characters of the body. The token is never printed and tenant or sensor names are replaced with placeholders. Run it with one variable changed at a time (fresh token, different key, different network) to separate caller, auth and service.',
    rationale: 'A reproduction is useful when someone else can run it and the service side can find the request by id, without the ticket leaking a credential.',
    misconception: 'Pasting the application\'s full log is neither minimal nor sanitised.' });
  Q({ id: 'q-m15-b10', moduleId: 'M15', pool: 'bank', type: 'mcq', difficulty: 1, objectiveIds: ['obj-m15-03'], remediation: 'les-m15-04',
    q: 'A customer\'s call returns 403 with a body naming a missing scope. They refresh their token and retry. What happens?',
    choices: ['Another 403: the identity was already understood; a new token does not add a permission or scope', 'Success, because tokens carry permissions', 'A 401, because the old token is now invalid', 'A 429, because the retry counts against quota'],
    a: 0, rationale: '401 is an identity problem; 403 is a permission, scope or tenant problem that only a grant or a different identity changes.',
    misconception: '401 and 403 both read as "denied" but have different owners and different fixes.' });

  Q({ id: 'q-m15-g01', moduleId: 'M15', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m15-02'], remediation: 'les-m15-02',
    context: '$ az group show -n beacon-dev\n(ResourceGroupNotFound) Resource group \'beacon-dev\' could not be found.\n$ az account show --query "{sub:name, tenant:tenantId}" -o tsv\nBeacon Sandbox\t2b9d...\n$ az account list --query "[].name" -o tsv\nBeacon Sandbox\nBeacon Platform',
    q: 'A colleague can see beacon-dev in the portal. What is the most likely cause and fix?',
    choices: ['The CLI\'s default subscription is Beacon Sandbox while the group lives in Beacon Platform; `az account set --subscription "Beacon Platform"` fixes the context, not permissions', 'You lack Reader on beacon-dev; request a role assignment', 'The group was deleted; recreate it', 'You are in the wrong tenant; sign in again'],
    a: 0, rationale: 'Context before permissions: the resource exists in a subscription the CLI is not pointed at. The same tenant lists both subscriptions.',
    misconception: '"Not found" errors in a wrong context are often misread as permission problems and "fixed" by over-granting.' });
  Q({ id: 'q-m15-g02', moduleId: 'M15', pool: 'gate', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m15-01'], remediation: 'les-m15-01',
    q: 'What belongs in the fifth column of every row of the AWS/Azure/GCP decision matrix?',
    choices: ['What differs between the providers for that concern and the check that would catch a wrong assumption', 'A score from 1 to 5 for each provider', 'The cheapest provider for that row', 'A statement that the three are equivalent'],
    a: 0, rationale: 'The analogue cells start the search; the differs-and-check cell is what prevents a design assumption from becoming an outage after migration.',
    misconception: 'A matrix without a differences column is a glossary, not a decision aid.' });
  Q({ id: 'q-m15-g03', moduleId: 'M15', pool: 'gate', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m15-04'], remediation: 'les-m15-03',
    context: '$ kubectl -n beacon get networkpolicy\nNAME        POD-SELECTOR   AGE\ndeny-all    <none>         2d\n$ kubectl -n beacon run t --rm -it --image=registry.lab/beacon-tools@sha256:0d3c... -- nc -vz beacon-api 8080\nbeacon-api (10.0.12.4:8080) open',
    q: 'On a managed cluster, a deny-all policy is applied and yet the connection succeeds. What is the most likely explanation?',
    choices: ['The cluster\'s network plugin is not enforcing NetworkPolicy (the feature was not enabled at creation or a policy engine is absent); the API accepted the object but nothing enforces it', 'deny-all policies only apply to egress', 'nc bypasses network policies', 'The policy needs a restart of the pods to take effect'],
    a: 0, rationale: 'On EKS, AKS and GKE alike, enforcement is a plugin property configured on the cluster; an applied policy with a working blocked connection is the evidence, not the object.',
    misconception: 'The API server accepting a NetworkPolicy says nothing about enforcement.' });
  Q({ id: 'q-m15-g04', moduleId: 'M15', pool: 'gate', type: 'order', difficulty: 2, objectiveIds: ['obj-m15-03'], remediation: 'les-m15-04',
    q: 'Order the steps for handling a customer report that "the API fails randomly".',
    steps: ['Collect status codes, headers (Retry-After, WWW-Authenticate), timestamps and request ids for each failing call', 'Separate the report into distinct symptoms (e.g. 401, 429, dropped stream)', 'Reproduce each with a minimal sanitised script, changing one variable at a time', 'Assign each symptom an owner: caller, auth layer or service', 'Send the customer an update: what we found, what they can do, when we update next'],
    rationale: 'Evidence first, then split symptoms, reproduce each, decide ownership, then communicate with request ids attached. Communicating before reproducing produces speculation.',
    misconception: 'Treating three different failures as one "flaky API" problem leads to a wrong single fix.' });
  Q({ id: 'q-m15-g05', moduleId: 'M15', pool: 'gate', type: 'explain', difficulty: 3, objectiveIds: ['obj-m15-04', 'obj-m15-01'], remediation: 'les-m15-03',
    q: 'Explain, for one of EKS, AKS or GKE, what the provider owns and what the operator owns, and name two things that change for a chart tested on kind.',
    rubric: ['Provider: control plane (API server, etcd, scheduler) and, to a stated degree, nodes', 'Operator: workloads, RBAC, NetworkPolicy and its enforcement, PDBs, requests, cloud-side identity bindings, upgrade timing', 'Names a provider-specific difference (e.g. who initiates upgrades, how auth reaches the API server)', 'Names two kind-to-managed changes: cloud IAM before RBAC, real LoadBalancers, zonal storage, image reachability, node drains'],
    answer: 'On GKE the provider runs the control plane and, in Standard mode, auto-upgrades control plane and nodes by release channel within maintenance windows you set; in Autopilot it also manages the nodes. The operator owns Deployments and probes, RBAC, NetworkPolicy (enforced only with Dataplane V2 or policy enforcement enabled), PodDisruptionBudgets that survive the provider\'s drains, resource requests, and the Workload Identity bindings between Kubernetes and Google service accounts. From kind: access goes through Google IAM before Kubernetes RBAC, a LoadBalancer Service becomes a real costed load balancer, volumes are zonal disks, and images must be reachable from the nodes, possibly through private access.',
    rationale: 'The responsibility split is provider-specific and never removes the operator\'s ownership of what runs on the cluster.',
    misconception: '"Managed" is not "operated for you"; node drains and enforcement gaps surprise teams that assume it is.' });

  /* ═══ M16 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m16-b01', moduleId: 'M16', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m16-01'], remediation: 'les-m16-01',
    q: 'Which rebuild result is the stronger evidence of reproducibility?',
    choices: ['A rebuild from a freshly cloned repository on a new kind cluster that found and fixed four documentation gaps, with timings and commits recorded', 'A forty-minute rebuild on the author\'s machine with no gaps found', 'A rebuild that skipped the steps the author already knew worked', 'A rebuild where missing tools were installed from memory without noting them'],
    a: 0, rationale: 'Reproducibility is proven when the documentation alone suffices for someone without the author\'s machine or memory; a gap ledger with fixes is that proof.',
    misconception: 'A quick clean-looking run on a prepared machine hides the hidden prerequisites the capstone exists to find.' });
  Q({ id: 'q-m16-b02', moduleId: 'M16', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m16-01'], remediation: 'les-m16-01',
    context: 'README step 3: make images\n$ make images\ndocker build ... => CACHED [1/6] FROM python:3.12.8-slim-bookworm@sha256:...\n...\nSuccessfully tagged registry.lab/beacon-api:1.8.1\nreal 0m9.412s',
    q: 'This is supposed to be a clean rebuild. What does a nine-second image build tell you, and what do you record?',
    choices: ['The local daemon still had cached layers from earlier work, so the environment was not clean; record it as a gap in the clean procedure, prune, and rerun', 'The build is well optimised; nothing to record', 'The README is correct and the step passed', 'The base image was pulled from the mirror quickly'],
    a: 0, rationale: '"CACHED" layers mean prior state influenced the run. The capstone treats any dependence on the author\'s machine as a defect in the procedure, not a convenience.',
    misconception: 'A fast step is not a passed step when the goal is proving the documentation alone suffices.' });
  Q({ id: 'q-m16-b03', moduleId: 'M16', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m16-01'], remediation: 'les-m16-01',
    context: 'README step 7: beaconctl seed --count 50\n$ beaconctl seed --count 50\nerror: BEACON_ADMIN_TOKEN is not set\n$ grep -n ADMIN_TOKEN README.md Makefile chart/templates/*.yaml\nchart/templates/admin-secret.yaml:9:  BEACON_ADMIN_TOKEN: {{ randAlphaNum 32 | b64enc }}',
    q: 'What kind of defect is this and what is the right fix?',
    choices: ['A hidden prerequisite: the token is generated into a Secret but never surfaced to the operator; fix the procedure (e.g. have the seed Job read the Secret) and commit it with a focused diff', 'A user error: export the variable from memory and continue', 'A chart bug: remove the randAlphaNum so the token is predictable', 'A tooling bug in beaconctl'],
    a: 0, rationale: 'The step cannot be completed from the documentation. The fix belongs in the repository, not in the operator\'s shell history, and a predictable token would weaken security to paper over a doc gap.',
    misconception: 'Working around a gap from memory makes the rebuild pass and leaves the next person stuck.' });
  Q({ id: 'q-m16-b04', moduleId: 'M16', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m16-01'], remediation: 'les-m16-01',
    q: 'Which check proves least privilege for the rebuilt beacon-api ServiceAccount?',
    choices: ['`kubectl auth can-i --as=system:serviceaccount:beacon:beacon-api delete secrets -n beacon` returns `no`, alongside a Role scoped by resourceNames', 'The pod runs and can read its own Secret', 'The ServiceAccount exists and has a token', 'The namespace has a NetworkPolicy'],
    a: 0, rationale: 'Least privilege is proven by what the identity cannot do, checked from the API server\'s view, not by the workload functioning.',
    misconception: 'A working pod shows permissions are sufficient, not that they are minimal.' });
  Q({ id: 'q-m16-b05', moduleId: 'M16', pool: 'bank', type: 'diagnose', difficulty: 3, objectiveIds: ['obj-m16-02'], remediation: 'les-m16-02',
    context: '00:00 POST /v1/readings -> 500; GET /v1/sensors/demo-1/status -> 200 but updated_at 35 min old\n00:03 beacon-api log: FATAL password authentication failed for user "beacon_app_v2"\n00:06 Secret restored from sealed source; rollout restart beacon-api\n00:11 re-measure: POST -> 202. GET status still 35+ min old\n00:13 beacon-worker log: redis: dial tcp 10.96.0.41:6379: i/o timeout',
    q: 'What does the 00:11 re-measurement establish, and what is the next move?',
    choices: ['A second independent fault exists: the stale-read symptom survived the first fix, so the worker path has its own cause — follow the ladder from the worker (its Redis dependency and the NetworkPolicy)', 'The first fix needs more time to settle; wait five minutes', 'The Secret fix was wrong; revert it', 'Redis is down; restart it'],
    a: 0, rationale: 'Re-measuring immediately after each change is what separates two faults with overlapping symptoms. The surviving symptom gets its own observation-hypothesis-check chain.',
    misconception: 'Assuming the second symptom will clear once the first fix "settles" wastes the time box.' });
  Q({ id: 'q-m16-b06', moduleId: 'M16', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m16-02'], remediation: 'les-m16-02',
    context: '$ kubectl -n beacon get networkpolicy worker-egress -o jsonpath=\'{.spec.egress[0].ports[0].port}\'\n6397\n$ kubectl -n beacon get svc beacon-redis -o jsonpath=\'{.spec.ports[0].port}\'\n6379',
    q: 'Under time pressure, which fix is acceptable and which is a fail?',
    choices: ['Acceptable: correct the one port in the policy to 6379. Fail: delete the policy, even though it would also restore service', 'Acceptable: delete the policy now and recreate it after the incident', 'Acceptable: grant the worker ServiceAccount cluster-admin so it can bypass the policy', 'Both fixes are equivalent since service returns either way'],
    a: 0, rationale: 'The evidence names a typo; the narrow fix is that one value. Removing the control widens the attack surface and fails the privilege check the capstone runs after recovery.',
    misconception: 'Service returning is not the only pass condition; privilege state after recovery is checked too.' });
  Q({ id: 'q-m16-b07', moduleId: 'M16', pool: 'bank', type: 'explain', difficulty: 3, objectiveIds: ['obj-m16-02'], remediation: 'les-m16-02',
    q: 'After restoring service, the readings table has 11,900 rows but the accepted-request counter shows 12,480 since the incident window began. Describe what you do next and what you write down.',
    rubric: ['Treats the gap as data at stake: 580 readings, identify tenants and ids', 'Checks replay sources first (worker queue, source re-send) before considering a restore', 'States the recovery-point facts (RPO promise, data at stake, confidence in the slow path) with a timestamp before acting', 'Verifies data after recovery: counts, latest ids, duplicates by idempotency key; records any loss explicitly'],
    answer: 'The 580-row gap is data at stake, not a rounding error. Identify which ids and tenants are missing, check whether the worker queue still holds them and replay first — that is the cheap path. If the queue covers only part, write the recovery-point decision with a timestamp: the RPO promise, the remaining loss, the tenants affected, and whether a restore plus replay would recover more than it costs within the time box. Then act, and verify with counts against the accepted counter, the latest ids, and a duplicate check on the idempotency key. Any residual loss is written into the incident record as a known, decided loss.',
    rationale: 'Recovery is service plus verified data; an unrecorded loss is a second incident.',
    misconception: 'Declaring recovery on the user path alone hides a data-loss incident.' });
  Q({ id: 'q-m16-b08', moduleId: 'M16', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m16-02'], remediation: 'les-m16-02',
    q: 'When does the time box say to stop diagnosing and consider recovery from a known-good state?',
    choices: ['When the whole-incident box decided in advance expires with no surviving hypothesis', 'When the first rung of the ladder takes longer than a minute', 'As soon as a second symptom appears', 'Never; diagnosis continues until the cause is found'],
    a: 0, rationale: 'The box is set before starting because it will not be set well under pressure; it converts open-ended diagnosis into a bounded decision.',
    misconception: 'Both "restore immediately" and "never restore" are failures of the time box.' });
  Q({ id: 'q-m16-b09', moduleId: 'M16', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m16-03'], remediation: 'les-m16-03',
    q: 'Which sentence turns a design decision into a defended one?',
    choices: ['"A dedicated durable broker would be the better choice once losing the single Redis pod is itself an unacceptable loss; at lab scale it is a listed gap."', '"Redis was the obvious choice."', '"Everyone uses Redis for queues."', '"We chose Redis and it worked in the labs."'],
    a: 0, rationale: 'The condition under which the rejected alternative wins is what shows judgement; it ties the choice to the context and names the gap it carries.',
    misconception: 'A decision defended only by "it worked" reads as a preference.' });
  Q({ id: 'q-m16-b10', moduleId: 'M16', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m16-03'], remediation: 'les-m16-03',
    context: 'Skills and evidence report, closing paragraph (draft):\n"Beacon has been rebuilt, load tested, secured with signed images and verified restores, and is ready for production deployment in a protected environment."',
    q: 'What is wrong with this paragraph?',
    choices: ['It overclaims: all results are lab-scale on a single-node kind cluster with synthetic data and lab-only keys; the paragraph must describe that scope and list the gaps rather than imply production or environment readiness', 'It is too modest; the labs were thorough', 'It should name the reviewer', 'It should list the Helm chart version'],
    a: 0, rationale: 'The report is credible when it names scale, environment, duration and realism gaps before a reviewer does. Readiness claims the course cannot support fail the exercise.',
    misconception: 'Softening gaps to sound finished is the fastest way to lose a reviewer\'s trust.' });
  Q({ id: 'q-m16-b11', moduleId: 'M16', pool: 'bank', type: 'order', difficulty: 2, objectiveIds: ['obj-m16-03'], remediation: 'les-m16-03',
    q: 'Order the parts of one defended design decision as the course structures it.',
    steps: ['State the context: the constraint that made it a decision', 'List the options considered', 'Give the choice and its reason tied to the context', 'Name the rejected alternative and the condition under which it would win', 'Cite the evidence (lab id, metric, digest or timing) that the choice behaved as expected'],
    rationale: 'Context, options, choice, rejected alternative with its winning condition, evidence. Without the fourth part a decision reads as a preference.',
    misconception: 'Starting with the choice and backfilling reasons produces a pitch, not a defence.' });
  Q({ id: 'q-m16-b12', moduleId: 'M16', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m16-03'], remediation: 'les-m16-03',
    q: 'How should the advanced-course backlog be ordered?',
    choices: ['By the risk each named gap carries for the roles targeted, each item with a next step and a size, defended like a design decision', 'By how interesting each topic is', 'Alphabetically by technology', 'By how long each item would take, shortest first'],
    a: 0, rationale: 'The backlog is the gap list turned into action; its order is a judgement that must be defended the same way as the architecture.',
    misconception: 'Starting with the most interesting topic ignores the gap that is most likely to hurt.' });

  Q({ id: 'q-m16-g01', moduleId: 'M16', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m16-01'], remediation: 'les-m16-01',
    context: 'README step 6: helm install beacon chart/ -f values.yaml\n$ kubectl -n beacon get pods\nNAME                          READY   STATUS             RESTARTS   AGE\nbeacon-api-7c9d8f6b5-x1k2p    0/1     ImagePullBackOff   0          4m\n$ kubectl -n beacon describe pod beacon-api-7c9d8f6b5-x1k2p | grep -i "failed to pull"\n  Failed to pull image "registry.lab:5000/beacon-api@sha256:a41d...": manifest unknown\n$ grep -n "bundle" README.md\n(no output)',
    q: 'What is the gap and where does the fix belong?',
    choices: ['The README assumes the signed bundle has already been loaded into the mirror — a hidden prerequisite; add the bundle build and load steps to the README and Makefile as explicit prior steps', 'The image tag is wrong; use a floating tag', 'The registry is down; restart it', 'kind cannot pull from a local registry'],
    a: 0, rationale: 'The mirror has no such digest because the M13 load step lived in lab notes, not the documentation. The repair is to the procedure, committed on a branch.',
    misconception: 'Loading the bundle from memory and moving on passes the step and leaves the gap for the next person.' });
  Q({ id: 'q-m16-g02', moduleId: 'M16', pool: 'gate', type: 'order', difficulty: 2, objectiveIds: ['obj-m16-02'], remediation: 'les-m16-02',
    q: 'Order the evidence ladder for a Beacon request that fails on the user path.',
    steps: ['curl the user path and classify: answers, refused, timeout or error', 'Check ingress logs and the Service\'s EndpointSlices', 'Compare the Service selector with pod labels and read pod status and events', 'Read container logs and probe results', 'Check dependencies: PostgreSQL, Redis, queue depth', 'Check the node: kubectl top node, pressure conditions'],
    rationale: 'Start where the user is and move inward one rung at a time, each with a read-only check under a minute and a time box per rung.',
    misconception: 'Starting from the node or from a favourite hypothesis skips the rung that would have discriminated fastest.' });
  Q({ id: 'q-m16-g03', moduleId: 'M16', pool: 'gate', type: 'diagnose', difficulty: 3, objectiveIds: ['obj-m16-02'], remediation: 'les-m16-02',
    context: '00:24 service recovered; data verified (12,480 rows = accepted counter; 0 duplicates)\n$ kubectl auth can-i --list --as=system:serviceaccount:beacon:beacon-worker -n beacon | grep -E "secrets|networkpolicies"\nsecrets        []  []  [get list watch create update patch delete]\nnetworkpolicies []  []  [get list delete]\nbaseline (from L31 evidence): secrets [get]  networkpolicies: none',
    q: 'Can recovery be declared?',
    choices: ['No: the worker\'s permissions were widened during the incident; revert the RoleBinding to baseline and re-check before declaring recovery', 'Yes: service and data are verified, which are the two pass conditions', 'Yes, as long as the widening is mentioned in the postmortem', 'No: the data check must be repeated first'],
    a: 0, rationale: 'The capstone checks three things after recovery: service, data and privilege state. Elevated access taken during diagnosis must be removed and proven removed.',
    misconception: 'Widening permissions "temporarily" and forgetting is how least privilege erodes.' });
  Q({ id: 'q-m16-g04', moduleId: 'M16', pool: 'gate', type: 'explain', difficulty: 3, objectiveIds: ['obj-m16-03'], remediation: 'les-m16-03',
    q: 'Defend the decision to use key-based signing with an offline bundle for Beacon delivery, including when keyless signing would be the better choice and the gap the decision carries.',
    rubric: ['Context: the target environment has no outbound access', 'Options: keyless with a transparency log, key-based with a lab key, checksums only', 'Reason: verification works offline and the trust root is a file whose bootstrap can be documented and rehearsed', 'When the alternative wins: a connected target with a path to a transparency log, removing key-custody burden', 'Gap: key custody (single file, one custodian, no compromise drill) with a closing step'],
    answer: 'Context: the delivery target has no outbound access. Options: keyless signing against a public transparency log, key-based signing with a lab-only key, or checksums alone. Choice: key-based, because verification needs no connectivity and the trust root is a public key whose independent bootstrap and fingerprint check can be documented and rehearsed; evidence is the L26 bundle, the cosign verify output and the rejected tampered bundle. Keyless would win on a connected platform where short-lived certificates remove key-management burden. The gap carried: the private key sits in one password-protected file with a single custodian and no tested compromise drill; closing it means a custody design and one rehearsal of key rotation on the isolated side.',
    rationale: 'A defence names context, options, reason, the alternative\'s winning condition and the gap; the gap is what makes the rest credible.',
    misconception: 'Presenting the choice as universally correct hides the condition under which it is wrong.' });
  Q({ id: 'q-m16-g05', moduleId: 'M16', pool: 'gate', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m16-01', 'obj-m16-03'], remediation: 'les-m16-01',
    q: 'Which sentence correctly describes a successful capstone rebuild in the skills report?',
    choices: ['"Rebuilt from documentation in 1 h 49 m on a single-node kind cluster with synthetic data; four documentation gaps found and fixed; least privilege, health, telemetry, seed and rollback checks passed at lab scale."', '"Beacon is production-ready and fully reproducible."', '"Rebuilt in 40 minutes with no issues."', '"The deployment meets the requirements of a protected environment."'],
    a: 0, rationale: 'The honest sentence states scope, time including gap fixes, number of gaps and which checks passed, and says it was lab scale — nothing about production or any environment classification.',
    misconception: 'Readiness and environment claims the labs cannot support fail the report, however well the rebuild went.' });

  /* review prompts for M13–M16 (changed symptoms and short recall, not the gate items) */
  LX.sreReviews.push(
    { id: 'rev-m13-01', objectiveIds: ['obj-m13-01'], kind: 'changed-symptom', prompt: 'You rotated the database credential and restarted the API, but the worker Deployment mounts the Secret as a volume with `subPath`. Does the worker pick up the new value? What do you do before revoking the old role?', answer: 'No — subPath mounts are never refreshed. Roll the worker too, confirm zero sessions as the old role in pg_stat_activity, then set it NOLOGIN.' },
    { id: 'rev-m13-02', objectiveIds: ['obj-m13-02', 'obj-m13-04'], kind: 'recall', prompt: 'Without looking: name the four CVE triage categories and the kind of evidence each needs.', answer: 'Fix (fixed version exists: bump the pin, rebuild, rescan the new digest); not applicable (a command shows the component or path is absent); already fixed (distro tracker shows a backport under the old version); unknown (no fix or undetermined — owner and date).' },
    { id: 'rev-m13-03', objectiveIds: ['obj-m13-05', 'obj-m13-03'], kind: 'changed-symptom', prompt: 'On the isolated side, `sha256sum -c SHA256SUMS` passes but `cosign verify-blob` on SHA256SUMS fails with a key error. What is wrong, and may the bundle be loaded?', answer: 'The verifier\'s trust material (cosign.pub) is missing or wrong — a bootstrap problem, not evidence of tampering. The bundle is still unverified; fix the key through the independent channel and re-verify before loading anything.' },
    { id: 'rev-m14-01', objectiveIds: ['obj-m14-01'], kind: 'changed-symptom', prompt: 'The staircase test now shows latency climbing at 120 rps with API CPU at 250m, DB connections at 20 of 100, but Redis p99 at 180 ms and the worker queue depth flat at zero. Where is the bottleneck and would more API replicas help?', answer: 'Redis is the saturated resource (its latency is the only thing at a ceiling). More API replicas add Redis clients and do not help; look at Redis command patterns, a slow command, or its CPU.' },
    { id: 'rev-m14-02', objectiveIds: ['obj-m14-02', 'obj-m14-03'], kind: 'recall', prompt: 'Without looking: what does a circuit breaker do in each of its three states, and what should Beacon\'s read path return while the breaker to PostgreSQL is open?', answer: 'Closed: calls flow, failures counted. Open: calls fail fast without touching the dependency for a cooling period. Half-open: a few probes decide whether to close or reopen. The read path returns the last known status from Redis labelled stale, never an invented value.' },
    { id: 'rev-m14-03', objectiveIds: ['obj-m14-04', 'obj-m14-05'], kind: 'changed-symptom', prompt: 'During a DR rehearsal the restore finishes in 20 minutes but the person running it is the runbook\'s author, who filled two missing steps from memory. What is the RTO achieved for reporting purposes, and what are the findings?', answer: 'The 20 minutes is not a valid RTO: it was not achieved from the runbook alone. Report it as unmeasured, record the two missing steps as findings with owners, and rerun with a different runner.' },
    { id: 'rev-m15-01', objectiveIds: ['obj-m15-02'], kind: 'changed-symptom', prompt: 'A pod on EKS runs `aws sts get-caller-identity` and prints the node instance role instead of the role the ServiceAccount is annotated with. What is wrong?', answer: 'The cloud-side half of the binding is incomplete: the IAM role\'s trust policy does not name the cluster OIDC provider with the exact namespace and ServiceAccount (or the annotation has a typo). Fix the trust policy; the annotation alone grants nothing.' },
    { id: 'rev-m15-02', objectiveIds: ['obj-m15-01', 'obj-m15-04'], kind: 'recall', prompt: 'Without looking: for AWS, Azure and GCP, name the private-access mechanism to a managed service and the DNS piece that most often breaks it.', answer: 'AWS interface endpoint (PrivateLink) with private DNS enabled; Azure Private Endpoint with a privatelink private DNS zone linked to the VNet; GCP Private Service Connect endpoint (or Private Google Access) with a Cloud DNS private zone. In every case the client must resolve the name to the private address.' },
    { id: 'rev-m15-03', objectiveIds: ['obj-m15-03'], kind: 'changed-symptom', prompt: 'A customer\'s calls return 401 with `WWW-Authenticate: Bearer error="invalid_token"`. They say they refreshed the token an hour ago. What do you check in the reproduction, and who owns it?', answer: 'Decode the token\'s `exp` (without verifying) and compare to now; reproduce with a freshly issued token. If a fresh token works, the caller owns it (no refresh before expiry); if it also fails, check the issuer/audience and escalate to the auth layer with the request id.' },
    { id: 'rev-m16-01', objectiveIds: ['obj-m16-01'], kind: 'recall', prompt: 'Without looking: list the five pass conditions a capstone rebuild must prove, with one command or check for each.', answer: 'Least privilege (kubectl auth can-i as the ServiceAccount returns no for anything outside its Role); health (probes present, all replicas available); telemetry (RED metrics with a version label in Prometheus, one alert rule loaded); seeded data (GET returns a seeded sensor); rollback (helm rollback executed and rolled forward, visible in helm history).' },
    { id: 'rev-m16-02', objectiveIds: ['obj-m16-02'], kind: 'changed-symptom', prompt: 'Under assessment, ingest returns 503 and reads are fresh. You find and fix a full PVC on PostgreSQL; ingest recovers. Twenty seconds later reads go stale. Is this the same fault?', answer: 'Not necessarily — re-measure and investigate separately. The worker may have crashed or backed off during the disk-full period, or a second planted fault may have surfaced. Follow the ladder from the worker with its own hypotheses rather than assuming the first fix is settling.' },
    { id: 'rev-m16-03', objectiveIds: ['obj-m16-03'], kind: 'recall', prompt: 'Without looking: name the four categories of gap a capstone report must check for, with one Beacon example each.', answer: 'Scale (single-node kind, a few hundred rps); environment (no real cloud IAM, private networking or egress control beyond NetworkPolicy); duration (no soak, one DR rehearsal); realism (synthetic data, lab-only keys, no accreditation or customers).' }
  );
})();
