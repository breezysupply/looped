/* SRE & Cloud Deployment Foundations — local lab specifications L13–L16.
   Same record shape as sre-labs.js (see L01/L03 there). M07: Beacon as an
   unprivileged image (L13) and a Compose project with PostgreSQL (L14) on the
   compose profile; M08: Deployment/ReplicaSet/Pod reconciliation (L15) and a
   request through a Service with configuration and probes (L16) on the
   kind-basic profile. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreLabs = LX.sreLabs || [];

(function () {
  var DIR = 'labs/sre-cloud-foundations/';
  var K = 'kubectl --context kind-looped-foundations -n beacon';
  function lab(x) { x.version = x.version || '1.0'; LX.sreLabs.push(x); }

  lab({
    id: 'L13', moduleId: 'M07', title: 'Beacon as an unprivileged container',
    objectiveIds: ['obj-m07-01', 'obj-m07-02', 'obj-m07-05'], executionMode: 'local', estimatedMinutes: 120, environmentProfile: 'compose', prerequisites: ['L03'],
    learnerBrief: 'A colleague containerised Beacon: a Dockerfile with a pinned base, a .dockerignore, a hash-checked dependency lock and a wheelhouse. The container `looped-l13-api` is "up", but a smoke test from your Mac does not get a healthy answer. Prove what the image is (base, user, entry point, architecture, what is inside it), make the host request work with the smallest change, and leave an image record a reviewer can check.\n\nRuns on your Mac against the local engine. `inject.sh` breaks the build context or the image in one of three ways; the validator inspects the real image and container and never says which.',
    checkpoints: [
      { id: 'c1', title: 'Build context and image record', resumeInstructions: '`bash ' + DIR + 'L13/setup.sh` rebuilds work/ and the image (idempotent); your notes in evidence/L13-notes.md are kept.' },
      { id: 'c2', title: 'Reproduce, discriminate, fix', resumeInstructions: '`bash ' + DIR + 'L13/reset.sh` restores the same variant; `bash ' + DIR + 'L13/rebuild.sh` rebuilds work/ and replaces only the L13-labelled container.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'rebuild.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'starter/Dockerfile', 'starter/.dockerignore', 'starter/requirements.lock', 'starter/conf/beacon.yaml', 'starter/conf/.env.local', 'assets/foreign/Dockerfile', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json', '../profiles/compose/README.md'],
    setup: ['# on the Mac, engine running, at the repository root', 'labs/sre-cloud-foundations/profiles/compose/check.sh', 'bash ' + DIR + 'L13/setup.sh', 'curl -sS http://127.0.0.1:18013/healthz'],
    faultInjection: ['# setup.sh already injected variant-a; to choose explicitly:', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L13/inject.sh   # or variant-c'],
    tasks: ['Explain every instruction of work/Dockerfile and work/.dockerignore in evidence/L13-notes.md (template in assets/).', 'Record the image: `docker image inspect looped-l13-beacon:1.4.0 --format \'{{.Id}} {{.Os}}/{{.Architecture}} user={{.Config.User}}\'`, the base index (`docker buildx imagetools inspect python:3.12.7-slim-bookworm`) and the engine architecture (`docker info --format \'{{.Architecture}}\'`).', 'Reproduce from the host (`curl -sS http://127.0.0.1:18013/healthz`, `docker ps -a --filter label=looped.lab/id=L13`) and quote the symptom.', 'Two hypotheses, then one read-only discriminating check (`docker logs`, `docker port`, `docker exec looped-l13-api …`, `docker image inspect`, `docker history --no-trunc`).', 'Make the smallest change in work/ and run `bash ' + DIR + 'L13/rebuild.sh`; never delete .dockerignore, run as root or bake an environment file into the image.', 'Prove it: host curl returns ok, `docker exec looped-l13-api id -u` is not 0, PID 1 is python3, and your request appears in `docker logs`. Run validate.py.'],
    validation: [
      { id: 'image-present', description: 'looped-l13-beacon:1.4.0 exists with label looped.lab/id=L13', critical: true },
      { id: 'base-pinned', description: 'every FROM names an exact x.y.z tag or a digest, never latest', critical: true },
      { id: 'base-digest', description: 'the base is also pinned by digest (advisory)', critical: false },
      { id: 'architecture', description: 'image os/arch equals the engine architecture (both recorded)', critical: true },
      { id: 'non-root-config', description: 'the image USER is not root', critical: true },
      { id: 'exec-entrypoint', description: 'ENTRYPOINT is exec form, no /bin/sh -c', critical: true },
      { id: 'healthcheck', description: 'the image declares a HEALTHCHECK', critical: true },
      { id: 'container-running', description: 'looped-l13-api is running and labelled L13', critical: true },
      { id: 'runs-as-non-root', description: '`docker exec looped-l13-api id -u` is not 0', critical: true },
      { id: 'pid1-is-app', description: 'PID 1 in the container is the Python process', critical: true },
      { id: 'healthy', description: 'Docker reports the container healthy', critical: true },
      { id: 'user-path', description: 'HTTP from the host through the published port: /healthz 200 and /version 1.4.0', critical: true },
      { id: 'logs-visible', description: 'the validator\'s request appears in docker logs as a JSON line', critical: true },
      { id: 'no-secret-in-image', description: 'no secret-shaped value in history or env; no .env/.pem/.git under /app', critical: true },
      { id: 'notes', description: 'evidence/L13-notes.md filled in with the image record (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L13/reset.sh   # same variant; evidence kept', 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L13/reset.sh   # another variant'],
    teardown: ['bash ' + DIR + 'L13/teardown.sh   # only the looped.lab/id=L13 container and image, and work/'],
    evidenceInstructions: ['`python3 ' + DIR + 'L13/validate.py --out ' + DIR + 'L13/evidence/latest.json --explanation-file ' + DIR + 'L13/evidence/L13-notes.md`', 'Add `--assistance assisted` if you opened hints rung 3–4 or the solution.', 'The report records image ID, image platform, engine architecture and the base reference; the only credential in the lab is a fake token that must not appear in it.'],
    hints: [
      { level: 1, text: 'Separate three places a request can die: the build (what went into the image), the container start (what the process saw), the path from your host into the container (what listens where). `docker ps -a` and the first lines of `docker logs` say which.' },
      { level: 2, text: 'Compare the image\'s own description with the engine\'s: `docker image inspect` (User, Entrypoint, Os/Architecture), `docker port`, `docker info --format \'{{.Architecture}}\'`, and what is inside: `docker run --rm --entrypoint ls looped-l13-beacon:1.4.0 -laR /app`.' },
      { level: 3, text: 'Healthy container, failing host: `docker logs looped-l13-api | grep listening` versus `docker port looped-l13-api`. Exiting container: `ls` of /app/conf in the image versus work/conf and work/.dockerignore. Exec format error: image Architecture versus `docker info`.' },
      { level: 4, text: 'A: Beacon binds 127.0.0.1 inside the container; set server.listen 0.0.0.0 in work/conf/beacon.yaml and rebuild. B: .dockerignore excludes every *.yaml so conf/beacon.yaml never enters the context; add `!conf/beacon.yaml` (keep .dockerignore — it keeps conf/.env.local out). C: the image was built for the other architecture; `bash rebuild.sh` builds natively; record the platform.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T06', 'T16'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-c bash ' + DIR + 'L13/reset.sh` (or variant-a / variant-b), rewrite the diagnosis sections of your notes for the new symptom, validate with `--variant variant-c --assistance independent --out ' + DIR + 'L13/evidence/variant.json`, and import it.', command: 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L13/reset.sh' },
    limits: ['Proves building, inspecting and running one unprivileged image locally and explaining what is in it. Not multi-platform publishing, signing, provenance or vulnerability management, and nothing about Kubernetes.', 'Whether an image for the other architecture runs depends on the engine\'s emulation; the validator judges the recorded architecture, not whether emulation happened to work.', 'Executed during development on Linux amd64 (Docker 29.8, BuildKit, Python 3.13 host): all three variants ran setup → validate FAIL → fix → validate PASS → reset, the delete-.dockerignore shortcut was rejected (no-secret-in-image), and teardown removed every L13-labelled container and image. Not executed on Apple Silicon or Docker Desktop.']
  });

  lab({
    id: 'L14', moduleId: 'M07', title: 'Beacon on Compose: dependencies, persistence, shutdown',
    objectiveIds: ['obj-m07-03', 'obj-m07-04'], executionMode: 'local', estimatedMinutes: 120, environmentProfile: 'compose', prerequisites: ['L13'],
    learnerBrief: 'The Beacon stack — API, worker and PostgreSQL 16 — runs as the Compose project `looped-l14`. This morning the API was gone and nobody knew why. Find what is wrong with the project as you received it, fix it in the Compose file, and prove two promises against the running stack: records survive the database container being replaced, and `docker compose stop` is quick and clean.\n\nThe validator queries the real project and, to prove the promises, writes a record, replaces the db container, recreates the API and stops/starts the services — all inside `looped-l14`. Volumes are removed only when you ask (LOOPED_RESET_DATA=1).',
    checkpoints: [
      { id: 'c1', title: 'Bring it up, read the evidence', resumeInstructions: '`bash ' + DIR + 'L14/setup.sh` rebuilds work/ and starts the project; existing looped-l14 volumes are reused, never deleted. Notes in evidence/L14-notes.md are kept.' },
      { id: 'c2', title: 'Diagnose and fix the Compose file', resumeInstructions: '`docker compose -f ' + DIR + 'L14/work/compose.yaml up -d --wait` applies your edit; `bash ' + DIR + 'L14/reset.sh` restores the same variant (data kept).' },
      { id: 'c3', title: 'Prove persistence and shutdown', resumeInstructions: 'Write a record, `docker compose -f ' + DIR + 'L14/work/compose.yaml rm -fsv db && docker compose -f ' + DIR + 'L14/work/compose.yaml up -d --wait`, read it back; `time docker compose -f ' + DIR + 'L14/work/compose.yaml stop api`.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'starter/compose.yaml', 'starter/app/Dockerfile', 'starter/app/.dockerignore', 'starter/app/requirements.lock', 'starter/app/conf/beacon.yaml', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json', '../profiles/compose/README.md'],
    setup: ['labs/sre-cloud-foundations/profiles/compose/check.sh', 'bash ' + DIR + 'L14/setup.sh', 'docker compose -f ' + DIR + 'L14/work/compose.yaml ps -a'],
    faultInjection: ['# setup.sh already injected variant-a; to choose explicitly:', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L14/inject.sh   # or variant-c'],
    tasks: ['Wait a minute after setup, then read `docker compose … ps -a`, the last log lines of api and db, and `curl -sS http://127.0.0.1:18014/ready`. Quote the first thing that looks wrong.', 'Read `docker compose … config`: service names, the host in the store URL, each depends_on condition and health check, every volume target.', 'Two hypotheses and one discriminating check (a DNS probe from the api image, log timestamps, `docker inspect looped-l14-db-1` Mounts/Health).', 'Fix the smallest thing in work/compose.yaml and apply with `up -d --wait` (replace the db with `rm -fsv db` if needed).', 'Prove persistence across replacement of the db container, and time `docker compose … stop api` with its exit code; explain PID 1 and the grace period in your notes.', 'Run validate.py (it replaces containers inside looped-l14) and import the evidence.'],
    validation: [
      { id: 'compose-config', description: '`docker compose config` parses with services api, worker, db', critical: true },
      { id: 'images-pinned', description: 'postgres pinned to an exact 16.x tag (digest welcome); nothing tagged latest or untagged', critical: true },
      { id: 'readiness-gated', description: 'db has a health check and api depends_on db with condition service_healthy', critical: true },
      { id: 'services-running', description: 'api, worker and db are running and labelled L14', critical: true },
      { id: 'db-healthy', description: 'Docker reports the db container healthy', critical: true },
      { id: 'store-host-resolves', description: 'the database host in the store URL resolves on the project network', critical: true },
      { id: 'api-ready', description: 'GET /ready returns 200 on PostgreSQL', critical: true },
      { id: 'worker-consumes', description: 'a job POSTed to /jobs is processed by the worker', critical: true },
      { id: 'data-on-named-volume', description: 'the database data directory is the named volume looped-l14_pgdata', critical: true },
      { id: 'record-survives', description: 'a record written before the db container is replaced is read back after', critical: true },
      { id: 'graceful-stop', description: 'api and worker stop on SIGTERM in under 8 s with exit code 0', critical: true },
      { id: 'no-secret-in-logs', description: 'the fixture database password never appears in api/worker logs', critical: true },
      { id: 'fixture-kept', description: 'variant-b only: the late-start fixture is still in place', critical: true }
    ],
    reset: ['bash ' + DIR + 'L14/reset.sh   # compose down (volumes kept), fresh work/, same variant', 'LOOPED_RESET_DATA=1 bash ' + DIR + 'L14/reset.sh   # also removes the looped-l14 volumes'],
    teardown: ['bash ' + DIR + 'L14/teardown.sh   # project looped-l14 down, L14 image and work/ removed; volumes kept', 'LOOPED_RESET_DATA=1 bash ' + DIR + 'L14/teardown.sh   # also removes looped-l14_pgdata and looped-l14_queue'],
    evidenceInstructions: ['`python3 ' + DIR + 'L14/validate.py --out ' + DIR + 'L14/evidence/latest.json --explanation-file ' + DIR + 'L14/evidence/L14-notes.md`', 'Expect about 20 s on a healthy stack and up to 3 minutes when something is wrong (the validator waits for readiness before judging).', 'Never paste the store URL into notes; the report records the db image, Compose version and stop timings only.'],
    hints: [
      { level: 1, text: 'Decide which promise is broken: the stack never becomes ready, or it becomes ready but loses data when a container is replaced. Exit codes in `docker compose ps -a` and each service\'s last log lines separate the first; for the second you must run the persistence test yourself.' },
      { level: 2, text: '`docker compose config` is the file as Compose understood it: service names, the host in the store URL, each depends_on condition and health check, every volume target. `docker inspect` shows what happened: State.Health, Mounts, Config.Env (PGDATA).' },
      { level: 3, text: 'Name resolution: a getaddrinfo probe from `docker compose run --rm --no-deps --entrypoint python3 api` for the URL\'s host versus `db`. Timing: the api\'s FATAL timestamp versus the db\'s "ready to accept connections". Data location: db Mounts versus PGDATA.' },
      { level: 4, text: 'A: the URL names host `postgres` but the service is `db`. B: db has no health check and api waits only for service_started, so the bounded retry runs out before the slow db listens; restore the pg_isready check and condition service_healthy (keep the fixture). C: pgdata is mounted at /var/lib/postgres/data while PostgreSQL writes /var/lib/postgresql/data; fix the target and replace the db with `rm -fsv db && up -d --wait`.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T16', 'T09'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-c bash ' + DIR + 'L14/reset.sh` (or variant-a / variant-b; add LOOPED_RESET_DATA=1 for an empty database), test the persistence promise yourself before validating, then validate with `--variant variant-c --assistance independent --out ' + DIR + 'L14/evidence/variant.json` and import it.', command: 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L14/reset.sh' },
    limits: ['Proves dependency readiness, persistence across container replacement and graceful shutdown for one Compose project on one engine. Not backup/restore, durability beyond one local volume, connection pooling under load or high availability; the late-start fixture is a sleep, not a slow disk.', 'Executed during development on Linux amd64 (Docker 29.8, Compose 5.6, postgres:16.4 by digest): all three variants ran setup → validate FAIL → fix → validate PASS → reset; the "start api by hand" shortcut for variant-b was rejected (readiness-gated); teardown with LOOPED_RESET_DATA=1 removed the project, volumes and L14 image. Not executed on Apple Silicon or Docker Desktop.']
  });

  lab({
    id: 'L15', moduleId: 'M08', title: 'Desired state: Deployment, ReplicaSet, Pod',
    objectiveIds: ['obj-m08-01', 'obj-m08-02'], executionMode: 'local', estimatedMinutes: 120, environmentProfile: 'kind-basic', prerequisites: ['L14'],
    learnerBrief: 'Beacon runs three replicas on the local kind cluster `looped-foundations` from `L15/work/deployment.yaml`. Change request CR-1042 is approved: every pod must carry `tier: api` and report `environment: kind-lab-l15`. The cluster is shared and "someone has been helping". Map Deployment → ReplicaSet → Pod, watch the ReplicaSet replace a deleted pod, then ship CR-1042 the desired-state way — the file is the source of truth and the cluster is made to match it.\n\nEvery command names the context and namespace: `' + K + '`. One of three interferences is injected; the validator queries the real cluster and never says which.',
    checkpoints: [
      { id: 'c1', title: 'Map the objects, watch self-healing', resumeInstructions: '`bash ' + DIR + 'L15/setup.sh` redeploys the baseline and re-injects (replaces work/); your relationship map in evidence/L15-notes.md is kept.' },
      { id: 'c2', title: 'Ship CR-1042', resumeInstructions: 'Edit ' + DIR + 'L15/work/deployment.yaml and `kubectl --context kind-looped-foundations apply -f` it; `bash ' + DIR + 'L15/reset.sh` restores the same variant if you want to start over.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'manifests/deployment.yaml', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json', '../profiles/kind-basic/README.md', '../profiles/kind-basic/kind-config.yaml'],
    setup: ['# once per module: the cluster, namespace beacon and the Beacon image', 'bash ' + DIR + 'profiles/kind-basic/setup.sh', 'bash ' + DIR + 'L15/setup.sh', K + ' get deploy,rs,pods -l app.kubernetes.io/name=beacon -o wide'],
    faultInjection: ['# setup.sh already injected variant-a; to choose explicitly:', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L15/inject.sh   # or variant-c'],
    tasks: ['Follow one pod\'s ownerReferences up to the Deployment and note the pod-template-hash; write `deploy/beacon -> rs/<name> -> pods` in your notes.', 'Delete one pod (`' + K + ' delete pod <name>`), watch its replacement, and find the event that names the controller that acted.', 'Compare file, live spec and status: `kubectl --context kind-looped-foundations diff -f ' + DIR + 'L15/work/deployment.yaml`, `' + K + ' get deploy beacon -o yaml`, `' + K + ' describe deploy beacon`, `' + K + ' rollout status deploy/beacon`. Quote the first gap; two hypotheses, one discriminating check.', 'Edit work/deployment.yaml for CR-1042 and apply it; if the API server rejects it, read which field and which rule.', 'Watch the rollout (a new ReplicaSet, the old one at 0) and prove: pods carry tier=api, /version reports kind-lab-l15, `kubectl diff` prints nothing.', 'Run validate.py (it deletes one Beacon pod to test self-healing) and import the evidence.'],
    validation: [
      { id: 'cluster-context', description: 'the lab context answers, is local, and its nodes are looped-foundations-*', critical: true },
      { id: 'manifest-valid', description: 'work/deployment.yaml is accepted by a server-side dry run', critical: true },
      { id: 'change-request', description: 'CR-1042 in the file and on every live pod; selector unchanged', critical: true },
      { id: 'in-sync', description: '`kubectl diff -f work/deployment.yaml` reports no difference', critical: true },
      { id: 'replicas', description: 'spec.replicas equals the manifest (3) and 3 pods are ready', critical: true },
      { id: 'rollout-complete', description: 'not paused; observedGeneration current; updated == available == replicas', critical: true },
      { id: 'ownership-chain', description: 'Deployment -> one active ReplicaSet -> exactly the desired pods; no strays', critical: true },
      { id: 'self-healing', description: 'a pod deleted by the validator is replaced and readiness returns to 3', critical: true },
      { id: 'notes', description: 'evidence/L15-notes.md filled in with the ReplicaSet chain (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L15/reset.sh   # baseline redeployed, same variant, work/ replaced, evidence kept'],
    teardown: ['bash ' + DIR + 'L15/teardown.sh   # L15 objects in namespace beacon and work/ only; the cluster stays for L16', '# the cluster itself, at the end of M08:', 'bash ' + DIR + 'profiles/kind-basic/teardown.sh'],
    evidenceInstructions: ['`python3 ' + DIR + 'L15/validate.py --out ' + DIR + 'L15/evidence/latest.json --explanation-file ' + DIR + 'L15/evidence/L15-notes.md`', 'Name the controller that acted at each step and the status field or event that showed it.', 'The report records context, nodes, kubelet version and the ReplicaSet chain; no secrets are involved.'],
    hints: [
      { level: 1, text: 'Every symptom here is a gap between three things: what work/deployment.yaml says, what the Deployment\'s live spec says, and what its status and pods show. Find which pair disagrees before changing anything.' },
      { level: 2, text: '`kubectl diff -f work/deployment.yaml` compares file and live spec; `get deploy beacon -o yaml` shows spec and status together; `describe deploy beacon` shows Conditions and Events; `rollout status` says what it waits for; an API error names the field it rejected.' },
      { level: 3, text: 'Spec changed out of band: diff shows a field you did not edit, and describe has a "Scaled … replica set" event you did not cause. Change rejected: `kubectl apply --dry-run=server -f work/deployment.yaml` and read which field is immutable. Accepted but nothing moves: `.spec.paused` and the Progressing reason.' },
      { level: 4, text: 'A: someone ran kubectl scale --replicas=1; apply the file (with CR-1042) and replicas return to 3. B: the working copy changes spec.selector, immutable in apps/v1; put tier: api in the template labels only. C: the Deployment is paused; `kubectl rollout resume deploy/beacon` and watch rollout status.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T04', 'T02', 'T22'], status: 'execution-not-tested',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-c bash ' + DIR + 'L15/reset.sh` (or variant-a / variant-b), make CR-1042 again, validate with `--variant variant-c --assistance independent --out ' + DIR + 'L15/evidence/variant.json`, and import it with an explanation naming each controller that acted.', command: 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L15/reset.sh' },
    limits: ['Proves reading and driving Deployment → ReplicaSet → Pod reconciliation, a template rollout and an immutable-field rejection on a local kind cluster. Not scheduling, resource pressure or node failure (L17), Services and probes (L16), or managed Kubernetes.', 'Manifests schema-checked with kubeconform v0.7.0; no cluster available in the authoring environment. Scripts passed bash -n, the validator passed py_compile and a code-path dry run against a stub kubectl (not a cluster); setup → fault → validate → fix was not executed.']
  });

  lab({
    id: 'L16', moduleId: 'M08', title: 'A request through a Service: EndpointSlices, configuration, probes',
    objectiveIds: ['obj-m08-03', 'obj-m08-04', 'obj-m08-05'], executionMode: 'local', estimatedMinutes: 120, environmentProfile: 'kind-basic', prerequisites: ['L15'],
    learnerBrief: 'Beacon now runs behind the ClusterIP Service `beacon`, with configuration from the ConfigMap `beacon-config`, a (fake) database URL from the Secret `beacon-secrets`, and startup, readiness and liveness probes. After the latest change, in-cluster callers cannot get an answer from `http://beacon.beacon.svc.cluster.local/version`. Trace the request hop by hop — DNS, ClusterIP, EndpointSlice endpoint, pod port — find where it stops, fix the manifest in `L16/work/`, and prove the user path without weakening the probes.\n\nAll three variants produce the same client error; the validator queries the real cluster, makes a real request through the Service from a client pod, and never says which variant you have.',
    checkpoints: [
      { id: 'c1', title: 'Map the request path', resumeInstructions: '`bash ' + DIR + 'L16/setup.sh` re-applies the baseline with the variant (replaces work/); your path diagram in evidence/L16-notes.md is kept.' },
      { id: 'c2', title: 'Diagnose, fix, prove through the Service', resumeInstructions: 'Edit ' + DIR + 'L16/work/*.yaml and `kubectl --context kind-looped-foundations apply -f ' + DIR + 'L16/work/`; `bash ' + DIR + 'L16/reset.sh` restores the same variant.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'manifests/configmap.yaml', 'manifests/secret.yaml', 'manifests/deployment.yaml', 'manifests/service.yaml', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json', '../profiles/kind-basic/README.md'],
    setup: ['bash ' + DIR + 'profiles/kind-basic/setup.sh   # if the cluster is not up', 'bash ' + DIR + 'L16/setup.sh   # replaces L15\'s Deployment', K + ' get deploy,svc,endpointslices,pods -l looped.lab/id=L16'],
    faultInjection: ['# setup.sh already injected variant-a; to choose explicitly:', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L16/inject.sh   # or variant-c'],
    tasks: ['Reproduce from a throwaway client pod that meets the namespace\'s restricted policy (command in README step 2) and quote the error.', 'Draw the path in your notes from `get svc beacon -o wide`, `get endpointslices -l kubernetes.io/service-name=beacon -o yaml`, `get pods -o wide --show-labels` and `describe pod` (probe lines, Events).', 'Compare each hop with the next (selector vs pod labels, endpoint port vs container port, endpoint ready vs pod readiness and probe events); two hypotheses, one discriminating check.', 'Fix the one wrong field in work/ and `kubectl --context kind-looped-foundations apply -f ' + DIR + 'L16/work/`; re-run the client.', 'Explain what each probe failure does (startup, readiness, liveness) and why liveness must not call /ready.', 'Run validate.py (it creates and deletes one labelled client pod) and import the evidence.'],
    validation: [
      { id: 'cluster-context', description: 'the lab context answers, is local, and its nodes are looped-foundations-*', critical: true },
      { id: 'manifests-valid', description: 'work/ is accepted by a server-side dry run', critical: true },
      { id: 'deployment-available', description: 'deploy/beacon has all replicas (>= 2) available', critical: true },
      { id: 'probes-correct', description: 'startup probe present; readiness GETs /ready; liveness GETs /healthz, never /ready', critical: true },
      { id: 'service-selects-pods', description: 'the Service selector matches the Deployment\'s pods', critical: true },
      { id: 'endpointslice-membership', description: 'ready EndpointSlice addresses are exactly the Ready pods\' IPs, one per replica', critical: true },
      { id: 'targetport-matches', description: 'the EndpointSlice port equals the container port Beacon listens on', critical: true },
      { id: 'config-from-configmap', description: 'environment comes from ConfigMap beacon-config via envFrom', critical: true },
      { id: 'secret-by-reference', description: 'the store URL comes from Secret beacon-secrets by reference and is absent from the Deployment and logs', critical: true },
      { id: 'user-path', description: '5 HTTP requests from a client pod to the Service DNS name all return 200 with the ConfigMap\'s environment', critical: true },
      { id: 'no-restarts', description: 'no container restarts in the current pods (advisory)', critical: false },
      { id: 'notes', description: 'evidence/L16-notes.md filled in with the request path (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L16/reset.sh   # baseline re-applied with the same variant; work/ replaced; evidence kept'],
    teardown: ['bash ' + DIR + 'L16/teardown.sh   # L16 objects in namespace beacon and work/ only', '# end of M08: delete the cluster', 'bash ' + DIR + 'profiles/kind-basic/teardown.sh'],
    evidenceInstructions: ['`python3 ' + DIR + 'L16/validate.py --out ' + DIR + 'L16/evidence/latest.json --explanation-file ' + DIR + 'L16/evidence/L16-notes.md`', 'Name the first hop where the evidence disagreed with the next one, and the field you changed.', 'The Secret is a fake (`lab-…-not-a-real-secret`) and the report never includes its value; do not paste `kubectl get secret -o yaml` into notes.'],
    hints: [
      { level: 1, text: 'Beacon is healthy inside every pod; the request dies between the client and a pod. Walk the hops in order — Service selector, EndpointSlice endpoints, endpoint port, endpoint readiness — and stop at the first that disagrees with the next.' },
      { level: 2, text: '`kubectl get endpointslices -l kubernetes.io/service-name=beacon -o yaml` is the hinge: which pods the Service picked, on which port, and whether each is ready. Compare it with `get svc beacon -o yaml`, `get pods --show-labels -o wide` and the Events of `describe pod`.' },
      { level: 3, text: 'No endpoints: Service selector versus pod labels. Endpoints ready but refused: slice port versus containerPort and the "listening on" log line. Endpoints not ready: "Readiness probe failed" in describe pod, then ask Beacon itself with kubectl exec on /ready.' },
      { level: 4, text: 'A: the Service selects component beacon-api but pods carry component api; fix the selector. B: targetPort 8081 while Beacon listens on 8080; use targetPort http. C: the readiness probe requests /readyz (404); set /ready. Never delete or weaken probes to make traffic flow.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T02', 'T22', 'T04'], status: 'execution-not-tested',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-c bash ' + DIR + 'L16/reset.sh` (or variant-a / variant-b), name the first disagreeing hop in fresh notes, validate with `--variant variant-c --assistance independent --out ' + DIR + 'L16/evidence/variant.json`, and import it.', command: 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L16/reset.sh' },
    limits: ['Proves tracing a ClusterIP request to ready backends through EndpointSlices, ConfigMap/Secret wiring and correct probe roles on kind. Not ingress, TLS, NetworkPolicy (L18), autoscaling, load, or cloud load balancers.', 'Manifests schema-checked with kubeconform v0.7.0; no cluster available in the authoring environment. Scripts passed bash -n, the validator passed py_compile and a code-path dry run against a stub kubectl (not a cluster), and its in-cluster client script was run against a local Beacon container; setup → fault → validate → fix was not executed.']
  });
})();
