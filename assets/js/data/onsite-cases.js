/* Onsite track — interviewer-led troubleshooting cases.

   Each case practises the verbal format some troubleshooting interviews use: the
   interviewer describes a symptom, you ask for one piece of evidence at a time,
   the interviewer reveals it, and you narrate hypotheses, keep the blast radius
   small and say how you would verify the fix. The skill being trained is asking
   for the RIGHT evidence in a sensible order.

   These are practice scenarios written for Looped. They are not actual interview
   questions and say nothing about any company's internal stack. Every piece of
   evidence is canned EXAMPLE output: real tools print slightly different text
   depending on version and configuration, so read for the signal, not the exact
   wording.

   Fields: opening (what the interviewer says first), context (answer to "what
   does the setup look like?"), asks (things you can ask for; array order is
   display order, not solution order), efficient (one reasonable efficient
   ordering of key asks — other orders are fine), cause / mechanism / fix /
   verify, followups, rubric, lessons, questions, alsoPractise, refs,
   verify_note (version-sensitive claims to double-check). */
window.LX = window.LX || {};
LX.onsiteCases = LX.onsiteCases || [];

/* ---------------------------------------------------------------- case 01 */
LX.onsiteCases.push({
  id: 'ons-case-01', track: 'onsite', title: 'Errors through the load balancer during deploys', domain: 'kubernetes',
  level: 1, mins: 10,
  opening: 'Users of the orders API are seeing bursts of 502 errors, and a few 503s, from the load balancer. It is not constant — it comes and goes during the day. The team wants to know why, and whether it is safe to keep deploying.',
  context: 'The orders API is a Deployment of 4 replicas behind a ClusterIP Service, exposed through an ingress controller that sends traffic straight to pod IPs. The app is a JVM service that loads pricing rules into a cache when it starts. It is deployed several times a day with a rolling update.',
  asks: [
    { id: 'a1', label: 'What changed recently?', group: 'Scope & changes',
      shows: 'Nothing unusual. The team ships the orders API several times a day and the manifest has not been edited in months apart from the image tag. When you line the error bursts up against the deploy log, every burst in the last week starts within a few seconds of a rollout and lasts 30–60 seconds.',
      reads: 'The errors correlate with rollouts, not with traffic or time of day. That narrows the search to what happens while pods are being replaced: new pods joining and old pods leaving.',
      key: true, herring: false },
    { id: 'a2', label: 'Who / what is affected (scope)?', group: 'Scope & changes',
      shows: 'Only the orders API. Other services behind the same ingress controller have no 5xx during those windows. During a rollout about 2–4% of orders requests fail; outside rollouts it is effectively 0%. All clients see it, not one region or one customer.',
      reads: 'One service, only during its own rollouts, a small percentage of requests. That points at this workload\'s pod lifecycle rather than the shared ingress layer or the network.',
      key: true, herring: false },
    { id: 'a3', label: 'Pod status during a rollout', group: 'Workload',
      shows: '$ kubectl get pods -n orders -l app=orders-api -w\nNAME                         READY   STATUS              RESTARTS   AGE\norders-api-7c9d8f6b5-x2k8p   0/1     ContainerCreating   0          1s\norders-api-7c9d8f6b5-x2k8p   1/1     Running             0          3s\norders-api-5f6b7c4d9-q7lmn   1/1     Terminating         0          6h\norders-api-7c9d8f6b5-m4wz9   0/1     ContainerCreating   0          1s\norders-api-7c9d8f6b5-m4wz9   1/1     Running             0          3s\n(no restarts; every new pod shows 1/1 about 3 seconds after creation)',
      reads: 'New pods report Ready almost immediately. If a container has no readiness probe, Kubernetes treats it as ready as soon as it is running — so 1/1 here only says the process started, not that it can serve. Running does not imply Ready in general, and here Ready does not imply "listening". Next question: how long does the app actually take to start?',
      key: true, herring: false },
    { id: 'a4', label: 'The Deployment spec (probes, strategy, lifecycle)', group: 'Workload',
      shows: '$ kubectl get deploy orders-api -n orders -o yaml   (excerpt)\nspec:\n  replicas: 4\n  strategy:\n    type: RollingUpdate\n    rollingUpdate: {maxSurge: 25%, maxUnavailable: 25%}\n  template:\n    spec:\n      terminationGracePeriodSeconds: 30\n      containers:\n      - name: orders-api\n        image: registry.example.com/orders-api:4.18.2\n        ports:\n        - containerPort: 8080\n        resources:\n          requests: {cpu: 500m, memory: 1Gi}\n          limits: {cpu: "2", memory: 2Gi}\n        # no readinessProbe, no livenessProbe, no startupProbe, no lifecycle hooks',
      reads: 'No readiness probe, so readiness is never actually tested. The rolling update will count each new pod as available the moment it starts and move on to replacing the next old pod. No preStop hook either, which matters for the pods that are leaving.',
      key: true, herring: false },
    { id: 'a5', label: 'Application logs from a new pod', group: 'Application',
      shows: '$ kubectl logs orders-api-7c9d8f6b5-x2k8p -n orders --timestamps\n2026-09-28T14:02:11.204Z INFO  starting orders-api 4.18.2\n2026-09-28T14:02:11.980Z WARN  config key \'cache.ttl\' is deprecated; use \'cache.ttlSeconds\'\n2026-09-28T14:02:12.410Z INFO  loading pricing rules from database\n2026-09-28T14:02:29.877Z INFO  warmed 18402 pricing rules into cache\n2026-09-28T14:02:31.102Z INFO  HTTP server listening on :8080',
      reads: 'The process starts at 14:02:11 but only listens at 14:02:31 — about 20 seconds later. With Ready at about 3 seconds, there is a window of roughly 17 seconds where the pod is a routable endpoint but refuses connections. The WARN line is a deprecation notice and is not related.',
      key: true, herring: false },
    { id: 'a6', label: 'Ingress / load balancer logs for the failed requests', group: 'Network & DNS',
      shows: '$ kubectl logs -n ingress deploy/ingress-controller --since=10m | grep orders   (example: an NGINX-based controller)\n2026/09/28 14:02:14 [error] 88#88: *51233 connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://10.244.3.41:8080/v1/quote"\n2026/09/28 14:02:19 [error] 88#88: *51290 connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://10.244.3.41:8080/v1/orders"\n2026/09/28 14:03:02 [error] 91#91: *51877 upstream prematurely closed connection while reading response header from upstream, upstream: "http://10.244.1.17:8080/v1/orders"\n(10.244.3.41 is new pod x2k8p; 10.244.1.17 is old pod q7lmn, which was terminating at 14:03:02)',
      reads: 'Two failure shapes. Most errors are "connection refused" to a brand-new pod — it is in the backend list before anything listens on 8080, so the controller returns 502. A smaller number are connections cut by a pod that is shutting down while it is still receiving traffic; depending on the controller, those surface as 502 or 503.',
      key: true, herring: false },
    { id: 'a7', label: 'EndpointSlice for the Service during a rollout', group: 'Network & DNS',
      shows: '$ kubectl get endpointslice -n orders -l kubernetes.io/service-name=orders-api -o yaml   (excerpt, captured at 14:02:14)\nendpoints:\n- addresses: ["10.244.3.41"]\n  conditions: {ready: true, serving: true, terminating: false}\n  targetRef: {kind: Pod, name: orders-api-7c9d8f6b5-x2k8p}',
      reads: 'Confirms the mechanism: the new pod is published as a ready endpoint 3 seconds after it starts, so kube-proxy and the ingress controller route to it. Readiness is the only thing that gates this, and with no probe it is true as soon as the container is running.',
      key: false, herring: false },
    { id: 'a8', label: 'CPU and memory graphs for the pods', group: 'Workload',
      shows: 'Each new pod jumps to about 1.8 cores for ~20 seconds after start, then settles at ~0.3 cores. Memory climbs to 1.1 GiB and stays flat. Limits are 2 cores / 2 GiB. No OOM kills, no restarts.',
      reads: 'The CPU spike is the cache warm-up visible in the logs — expected startup work. It explains why startup takes 20 seconds, but it is not why requests fail. The failures come from routing traffic to the pod before it listens.',
      key: false, herring: true },
    { id: 'a9', label: 'Warnings in the application logs', group: 'Application',
      shows: '$ kubectl logs deploy/orders-api -n orders --since=24h | grep -c WARN\n11\n(all 11 are the same \'cache.ttl is deprecated\' line, one per pod start; the same line appears in logs from three months ago)',
      reads: 'A harmless deprecation notice that has been there for months. Worth a ticket, not the cause.',
      key: false, herring: true },
    { id: 'a10', label: 'How the app shuts down (SIGTERM handling)', group: 'Application',
      shows: 'The app catches SIGTERM, closes its listening socket immediately and exits within about 1 second. There is no preStop hook, so SIGTERM arrives as soon as the pod is marked for deletion.',
      reads: 'When a pod is deleted, removing it from endpoints and sending SIGTERM happen in parallel, and the ingress controller and kube-proxy take a moment to see the endpoint change. An app that stops listening instantly can still be sent requests for a few seconds. That is the smaller, terminating-pod share of the errors.',
      key: false, herring: false },
    { id: 'a11', label: 'Node and cluster health', group: 'Platform',
      shows: 'All nodes Ready. No evictions or node events in the last 24 hours. Ingress controller pods 3/3 Ready with no restarts in 12 days.',
      reads: 'Rules out node trouble and an unhealthy ingress layer. The ingress controller is reporting upstream failures accurately, not causing them.',
      key: false, herring: false }
  ],
  efficient: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
  cause: 'The Deployment has no readiness probe, so each new pod is marked Ready and added to the Service\'s endpoints as soon as its container starts — about 17 seconds before the app is listening. The ingress controller sends requests to it and gets connection refused (502). Secondarily, with no preStop delay, terminating pods stop listening while they are still receiving traffic.',
  mechanism: 'Readiness decides whether a pod\'s IP is published as a ready endpoint in the Service\'s EndpointSlices. Without a readiness probe, the kubelet reports the container ready as soon as it is running. The rolling update also uses readiness to decide when a new pod is "available", so it happily replaces old pods with new ones that cannot serve yet.\n\nOn the way out, the API server marks the pod as terminating; the endpoints controller removes it from the EndpointSlice and the kubelet sends SIGTERM at roughly the same time. Proxies and ingress controllers learn about the endpoint change asynchronously, so for a short window traffic can still arrive at a pod that has already closed its socket.',
  fix: 'Add a readiness probe that reflects "able to serve" — for example an HTTP check on a lightweight endpoint that only returns 200 once the cache is warm — with a sensible period and failure threshold. If startup can be slow, a startup probe can protect a future liveness probe from killing a warming pod. For shutdown, add a short preStop delay (a few seconds) and make the app drain in-flight requests on SIGTERM, keeping terminationGracePeriodSeconds longer than the delay plus drain time. Roll this out as a normal Deployment change: it touches one workload and, because the rolling update now waits for readiness, the rollout itself becomes safer. Do not add a liveness probe with a short initial delay as the "fix" — liveness restarts containers and would kill pods mid-warm-up; do not just add replicas, which dilutes the error rate without removing it.',
  verify: 'Run a steady load generator through the ingress (for example a loop of requests counting non-2xx) and do a real rollout: the error count during the rollout should be zero. Watch the EndpointSlice while it happens — new pod IPs should appear as ready only after the "listening" log line, and terminating pods should disappear before they stop serving.',
  followups: [
    { q: 'Why not use a liveness probe instead? What would each probe do here?', guidance: 'Readiness failure removes the pod from Service endpoints and does not restart it; liveness failure restarts the container. The problem is routing to a not-yet-ready pod, which is readiness. A liveness probe with a short delay would restart pods during warm-up and could cause a restart loop; a startup probe exists to hold off liveness until the app has started.' },
    { q: 'The readiness probe is in place, but you still see a few errors at the end of each rollout. What is left?', guidance: 'The termination path: endpoint removal and SIGTERM race, so a pod can be sent traffic after it stops listening. A short preStop sleep plus graceful drain in the app, and a grace period long enough for both. Also check connection reuse: long-lived keep-alive connections to an old pod need to be closed cleanly.' },
    { q: 'Should the readiness endpoint check the database?', guidance: 'Usually be careful: if every pod\'s readiness depends on a shared dependency, a dependency blip removes all pods from the Service at once and turns a partial degradation into a full outage. Readiness should answer "can this pod usefully serve"; dependency health is often better handled by the app degrading or by alerting.' }
  ],
  rubric: {
    strong: [
      'Asks what changed and correlates errors with rollouts before looking at pods',
      'Distinguishes "Running/Ready 1/1" from "actually listening" and asks how readiness is determined',
      'Uses the app log timestamps and ingress errors (connection refused to new pod IPs) to confirm the window',
      'Explains that readiness gates Service endpoints and does not restart containers',
      'Mentions the termination race and a preStop delay / graceful drain as the second half'
    ],
    acceptable: [
      'Starts from the ingress controller logs and works back to the pod lifecycle',
      'Proposes a startup probe plus readiness probe for the slow warm-up',
      'Suggests pausing deploys or deploying at low traffic as a short-term mitigation while the probe change is made'
    ],
    redFlags: [
      'Chases the CPU spike or the deprecation warning as the cause',
      'Adds an aggressive liveness probe as the fix',
      'Claims a failing readiness probe restarts the container',
      'Declares it fixed without doing a rollout under load and checking for errors'
    ]
  },
  lessons: ['les-probes', 'les-rollouts', 'les-services'],
  questions: ['ons-q-trouble-03', 'ons-q-net-03', 'ons-q-net-08'],
  alsoPractise: [{ track: 'containers', what: 'Readiness vs liveness and "Service has no endpoints" scenarios' }],
  refs: [
    { t: 'Configure Liveness, Readiness and Startup Probes', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/' },
    { t: 'Pod Lifecycle (container probes, termination)', u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/' },
    { t: 'Container Lifecycle Hooks', u: 'https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/' }
  ],
  verify_note: 'The built-in preStop "sleep" action depends on Kubernetes version (it arrived as a newer feature); on older clusters use an exec sleep if the image has a shell. How an ingress controller maps a refused or reset upstream to 502 vs 503 depends on the controller.'
});

/* ---------------------------------------------------------------- case 02 */
LX.onsiteCases.push({
  id: 'ons-case-02', track: 'onsite', title: 'A worker node drops out', domain: 'kubernetes',
  level: 2, mins: 12,
  opening: 'About fifteen minutes ago we got an alert that one worker node is NotReady. Pods that were on it have been rescheduled onto other nodes, and a couple of services had brief errors while that happened. We want to know why the node dropped out and whether it will happen again.',
  context: 'A general-purpose cluster with 12 worker nodes of the same size. Each node has a single 100 GiB root disk that holds the OS, container images and container logs. Mixed workloads, including a few scheduled batch jobs.',
  asks: [
    { id: 'a1', label: 'What changed recently?', group: 'Scope & changes',
      shows: 'Four days ago a team added a nightly "export" CronJob. Three days ago kube-proxy was restarted on every node as part of a config rollout. No node image, kubelet or container runtime changes this month.',
      reads: 'Two candidates. A kube-proxy change affects Service routing, not node health, so it is less likely to make a node NotReady. A new batch job that runs nightly is worth following up: what does it do on the node?',
      key: true, herring: false },
    { id: 'a2', label: 'Who / what is affected (scope)?', group: 'Scope & changes',
      shows: 'Only node-07 is NotReady; the other 11 are Ready. Pods from 9 workloads were on node-07; they are now Running elsewhere. No other node alert is firing.',
      reads: 'A single node, so start with node-local causes (disk, memory, kubelet, runtime, hardware, the node\'s own network) rather than the control plane or the cluster network.',
      key: true, herring: false },
    { id: 'a3', label: 'Node conditions and taints (describe node)', group: 'Node & host',
      shows: '$ kubectl describe node node-07   (excerpt)\nTaints:  node.kubernetes.io/disk-pressure:NoSchedule\n         node.kubernetes.io/not-ready:NoExecute\nConditions:\n  Type            Status  LastTransitionTime   Reason                      Message\n  MemoryPressure  False   ...                  KubeletHasSufficientMemory  kubelet has sufficient memory available\n  DiskPressure    True    2026-09-29 14:02     KubeletHasDiskPressure      kubelet has disk pressure\n  PIDPressure     False   ...                  KubeletHasSufficientPID     kubelet has sufficient PID available\n  Ready           False   2026-09-29 14:19     KubeletNotReady             PLEG is not healthy: pleg was last seen active 3m12s ago; threshold is 3m0s',
      reads: 'Order matters: DiskPressure became true at 14:02, then Ready went False at 14:19 because the kubelet stopped hearing from the container runtime (PLEG = the kubelet\'s loop that checks container state). The kubelet is still posting status, so this is not a network partition. Disk first, runtime trouble second.',
      key: true, herring: false },
    { id: 'a4', label: 'Events for the node and evicted pods', group: 'Node & host',
      shows: '$ kubectl get events -A --sort-by=.lastTimestamp | grep -E \'node-07|Evicted\'   (excerpt)\n14:02  Warning  EvictionThresholdMet  node/node-07  Attempting to reclaim ephemeral-storage\n14:02  Normal   NodeHasDiskPressure   node/node-07  Node node-07 status is now: NodeHasDiskPressure\n14:03  Warning  FreeDiskSpaceFailed   node/node-07  Failed to garbage collect required amount of images. Attempted to free 9.6 GB, but only found 1.2 GB eligible to free.\n14:04  Warning  Evicted               pod/web-5d8f7-kq2lp   The node was low on resource: ephemeral-storage. ...\n14:06  Warning  Evicted               pod/search-7b9c-2mzdx The node was low on resource: ephemeral-storage. ...\n14:19  Normal   NodeNotReady          node/node-07  Node node-07 status is now: NodeNotReady\n14:24  Normal   TaintManagerEviction  pod/api-6c8b9f-7xq8p  Marking for deletion Pod orders/api-6c8b9f-7xq8p',
      reads: 'The kubelet tried to reclaim disk: image garbage collection found almost nothing to free, and evicting pods did not bring usage back under the threshold. Whatever is filling the disk is not unused images and not something eviction releases. Later, after NotReady, pods were removed by the not-ready taint (after the default toleration period) and recreated elsewhere by their controllers.',
      key: true, herring: false },
    { id: 'a5', label: 'Disk usage on the node (df / du)', group: 'Node & host',
      shows: '$ df -h /\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p1  100G  100G     0 100% /\n$ sudo du -xsh /var/lib/containerd /var/log/pods /var/log/journal /var/log/export 2>/dev/null\n21G   /var/lib/containerd\n1.4G  /var/log/pods\n1.1G  /var/log/journal\n74G   /var/log/export',
      reads: 'The root filesystem is full. Images (containerd) and container stdout logs (/var/log/pods, which the kubelet rotates) are normal sizes. 74 GiB is in /var/log/export, a directory that is not part of the kubelet\'s own bookkeeping. With the disk at 100%, the runtime cannot write state, which is why PLEG stalled and the node went NotReady.',
      key: true, herring: false },
    { id: 'a6', label: 'What is writing to that directory?', group: 'Workload',
      shows: '$ sudo ls -lht /var/log/export | head -4\n-rw-r--r-- 1 root root  19G Sep 29 13:58 export-2026-09-29.ndjson\n-rw-r--r-- 1 root root  18G Sep 28 02:41 export-2026-09-28.ndjson\n-rw-r--r-- 1 root root  19G Sep 27 02:37 export-2026-09-27.ndjson\n$ kubectl get cronjob nightly-export -n reports -o yaml   (excerpt)\n      volumes:\n      - name: out\n        hostPath: {path: /var/log/export, type: DirectoryOrCreate}\n(the job writes a full, uncompressed export each run and never deletes old ones; today\'s run was a re-run started at 13:30)',
      reads: 'The export job writes ~19 GiB per run to a hostPath directory and never cleans up. hostPath data lives on the node, outside the pod: it is not counted as the pod\'s ephemeral storage and it is not deleted when the pod is evicted or finishes. So eviction could not relieve the pressure, and the data accumulates on whichever nodes the job lands on.',
      key: true, herring: false },
    { id: 'a7', label: 'kubelet and container runtime logs', group: 'Node & host',
      shows: '$ journalctl -u kubelet --since 14:00 | grep -E \'eviction|PLEG\' | head -3\n... eviction_manager.go: "Eviction manager: attempting to reclaim" resourceName="ephemeral-storage"\n... eviction_manager.go: "Eviction manager: must evict pod(s) to reclaim" resourceName="ephemeral-storage"\n... kubelet.go: "Skipping pod synchronization" err="PLEG is not healthy: pleg was last seen active 3m12s ago; threshold is 3m0s"\n$ journalctl -u containerd --since 14:00 | grep -i "no space" | head -1\n... failed to write ... : no space left on device',
      reads: 'Confirms the chain: disk pressure, eviction attempts, then the runtime failing writes with ENOSPC and the kubelet losing track of container state.',
      key: false, herring: false },
    { id: 'a8', label: 'The kube-proxy restart', group: 'Network & DNS',
      shows: 'kube-proxy DaemonSet was rolled three days ago; all 12 kube-proxy pods are Running with 1 restart each from that rollout and none since. Service traffic from other nodes is healthy.',
      reads: 'A real change, but it happened three days ago on every node and every other node is fine. kube-proxy programs Service routing; it does not decide whether a node is Ready. Not the cause.',
      key: false, herring: true },
    { id: 'a9', label: 'Instance / hardware health', group: 'Platform',
      shows: 'The underlying VM passes its platform status checks. No scheduled maintenance, no disk I/O errors in dmesg, no kernel messages about hardware.',
      reads: 'A reasonable thing to rule out for a single-node failure, but the hardware is fine — the disk is full, not broken.',
      key: false, herring: true },
    { id: 'a10', label: 'Memory, CPU and network on the node', group: 'Node & host',
      shows: 'Before the incident: memory 61% used, CPU 35%, no OOM kills in dmesg. You can SSH to node-07 and ping it from the control-plane subnet with no loss.',
      reads: 'Rules out memory pressure and a network partition — consistent with the kubelet still posting its (NotReady) status.',
      key: false, herring: false },
    { id: 'a11', label: 'Disk usage on the other nodes', group: 'Node & host',
      shows: '$ (from your node disk dashboard)\nnode-06  83%   (ran the export job on Sep 27)\nnode-09  79%   (ran the export job on Sep 28)\nall other nodes 30–45%',
      reads: 'The same cause is heading for two more nodes. This answers "will it happen again": yes, within days, unless the job is changed and the old files are cleaned up.',
      key: false, herring: false },
    { id: 'a12', label: 'Kubelet eviction and log rotation settings', group: 'Platform',
      shows: 'Kubelet config uses defaults: hard eviction at nodefs.available<10% and imagefs.available<15%; image GC high/low thresholds 85%/80%; containerLogMaxSize 10Mi, containerLogMaxFiles 5.',
      reads: 'Container stdout logs are capped per container by the kubelet, and image GC only removes unused images. Neither covers files an app writes to a hostPath. The thresholds are fine; raising them would only delay the failure.',
      key: false, herring: false }
  ],
  efficient: ['a2', 'a3', 'a5', 'a1', 'a6'],
  cause: 'A new nightly export CronJob writes ~19 GiB per run to a hostPath directory on the node and never deletes old files. On node-07 this filled the root disk, the kubelet reported DiskPressure and evicted pods (which freed nothing, because hostPath data is not pod ephemeral storage), then the container runtime could not write and the kubelet went NotReady.',
  mechanism: 'The kubelet watches filesystem signals such as nodefs.available and imagefs.available. When a threshold is crossed it sets DiskPressure, taints the node so no new pods are scheduled, garbage-collects unused images and dead containers, and then evicts pods ranked by their ephemeral-storage usage. Data written to a hostPath is outside that accounting and survives the pod, so none of those steps reclaim it.\n\nOnce the disk reaches 100%, the container runtime cannot write its state, the kubelet\'s pod lifecycle event loop (PLEG) stalls, and the kubelet reports Ready=False. The node lifecycle controller then applies the not-ready NoExecute taint, and after the default toleration period pods are deleted and recreated elsewhere by their controllers.',
  fix: 'First stop the growth with the smallest change: suspend the CronJob (set spec.suspend: true) and tell the owning team. Then free space on node-07 by moving or deleting old export files after the owner confirms they were already shipped — not by deleting things under /var/lib/containerd by hand (use the runtime\'s own image prune if images matter). The runtime and kubelet usually recover once there is space; restart them only if they stay wedged. Clean up node-06 and node-09 before they fail. The durable fix is in the job: write to a PersistentVolume or object storage with retention, or to an emptyDir with a sizeLimit (which is counted and enforced), and add disk-usage alerting well before the eviction threshold. Do not raise eviction thresholds, and do not just replace the node and move on — the next run fills another one.',
  verify: 'On node-07: df shows usage well under the thresholds, DiskPressure is False, Ready is True and the taints are gone; a test pod schedules there and starts. On node-06/09 usage is back down. After the next export run (to the new destination), node disk usage stays flat.',
  followups: [
    { q: 'How is node-pressure eviction different from an OOM kill or from preemption?', guidance: 'Node-pressure eviction is the kubelet proactively terminating pods to reclaim a node resource (memory, disk, inodes, PIDs), ranked by usage relative to requests and priority. An OOM kill is the kernel killing a process that exceeded its cgroup memory limit or when the node runs out. Preemption is the scheduler evicting lower-priority pods to make room for a higher-priority pending pod.' },
    { q: 'The disk was only at 60%, but the node still reported DiskPressure. What else could it be?', guidance: 'Inodes: the kubelet also watches nodefs.inodesFree and imagefs.inodesFree. Many tiny files can exhaust inodes while bytes look fine. Check df -i. Also check whether the image filesystem is separate and the pressure is on that one.' },
    { q: 'How would you stop a workload from doing this again across the cluster?', guidance: 'Restrict hostPath through admission policy (Pod Security admission baseline/restricted disallow it for most workloads), require ephemeral-storage requests/limits or emptyDir sizeLimit, add node disk alerts at 75–80%, and review new batch jobs for storage behaviour.' }
  ],
  rubric: {
    strong: [
      'Reads node conditions in order and notices DiskPressure preceded NotReady',
      'Uses df/du on the node to find where the space went instead of guessing',
      'Explains why eviction and image GC did not help (hostPath is outside ephemeral-storage accounting)',
      'Stops the growth first (suspend the job) and checks other nodes for the same pattern',
      'Proposes a durable fix in the workload plus earlier alerting'
    ],
    acceptable: [
      'Cordons and drains the node first to stabilise, then investigates the disk',
      'Replaces the node as a short-term mitigation while explicitly fixing the job before the next run'
    ],
    redFlags: [
      'Blames the kube-proxy restart without evidence',
      'Deletes files under /var/lib/containerd or /var/lib/kubelet by hand',
      'Raises eviction thresholds or disables eviction',
      'Treats the node as fixed after a reboot without finding what filled it'
    ]
  },
  lessons: ['les-failure', 'les-resources'],
  questions: ['ons-q-arch-04', 'ons-q-trouble-10'],
  alsoPractise: [
    { track: 'containers', what: 'Node DiskPressure / evicted pods scenarios on a node' },
    { track: 'linux', what: 'Finding what filled a disk with df and du, one directory level at a time' }
  ],
  refs: [
    { t: 'Node-pressure Eviction', u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/' },
    { t: 'Logging Architecture (log rotation)', u: 'https://kubernetes.io/docs/concepts/cluster-administration/logging/' },
    { t: 'Nodes', u: 'https://kubernetes.io/docs/concepts/architecture/nodes/' }
  ],
  verify_note: 'Kubelet event and log wording (FreeDiskSpaceFailed, PLEG messages, TaintManagerEviction) varies by version. Default eviction thresholds and log rotation defaults are from the Kubernetes docs; your distribution may override them. The default not-ready/unreachable toleration is typically 300 seconds.'
});

/* ---------------------------------------------------------------- case 03 */
LX.onsiteCases.push({
  id: 'ons-case-03', track: 'onsite', title: 'Outbound calls failing since last night', domain: 'network',
  level: 2, mins: 12,
  opening: 'Since late last night, several services in the cluster are failing when they call a partner API. The calls hang for a while and then time out. Calls between services inside the cluster look fine. We need to understand what is going on.',
  context: 'A cluster in a corporate data-centre network. Cluster DNS is served by CoreDNS. Pods reach the partner API by hostname, directly through the corporate network (no outbound HTTP proxy). The corporate network team owns the upstream DNS resolvers and the firewalls between VLANs.',
  asks: [
    { id: 'a1', label: 'What changed recently?', group: 'Scope & changes',
      shows: 'The network team had a change window last night from 22:00 to 23:30 to "tighten egress rules between the server VLANs and the shared-services VLAN". No cluster changes in the last week. The first timeout alerts fired at 23:12.',
      reads: 'A network change that finished right around when the errors started. The shared-services VLAN usually hosts things like DNS resolvers, NTP and directory services, so keep that in mind — but do not assume; get evidence.',
      key: true, herring: false },
    { id: 'a2', label: 'Who / what is affected (scope)?', group: 'Scope & changes',
      shows: 'Every namespace that calls something outside the cluster by name: the partner API, the corporate LDAP host and the internal package mirror. Service-to-service calls inside the cluster are fine. From an office laptop, the partner hostname resolves and the API responds.',
      reads: 'Everything external-by-name fails, across namespaces and destinations; in-cluster names work. Many unrelated destinations failing at once suggests a shared dependency on the way out — name resolution or a common egress path — rather than the partner.',
      key: true, herring: false },
    { id: 'a3', label: 'DNS lookup of an in-cluster name from a pod', group: 'Network & DNS',
      shows: '$ kubectl exec -n shop deploy/netdebug -- dig +short payments.shop.svc.cluster.local\n10.96.44.120\n;; Query time: 1 msec\n;; SERVER: 10.96.0.10#53(10.96.0.10)',
      reads: 'Pods can reach CoreDNS at the cluster DNS Service IP and CoreDNS answers for the cluster zone. So pod-to-CoreDNS networking and CoreDNS itself are basically working.',
      key: true, herring: false },
    { id: 'a4', label: 'DNS lookup of the external hostname from a pod', group: 'Network & DNS',
      shows: '$ kubectl exec -n shop deploy/netdebug -- dig api.partner.example.com\n;; ->>HEADER<<- opcode: QUERY, status: SERVFAIL, id: 40211\n;; QUESTION SECTION:\n;api.partner.example.com.   IN  A\n;; Query time: 5004 msec\n;; SERVER: 10.96.0.10#53(10.96.0.10)',
      reads: 'Not NXDOMAIN — nobody said the name does not exist. SERVFAIL after about 5 seconds means the resolver the pod asked (CoreDNS) could not get an answer from its upstream. Depending on the client and its retry settings, an app may see this as a slow failure or a plain timeout, which matches "hangs then times out".',
      key: true, herring: false },
    { id: 'a5', label: 'CoreDNS pod status and logs', group: 'Platform',
      shows: '$ kubectl get pods -n kube-system -l k8s-app=kube-dns\nNAME                       READY   STATUS    RESTARTS   AGE\ncoredns-5d78c9-4kk2n       1/1     Running   0          9d\ncoredns-5d78c9-p8r7w       1/1     Running   0          9d\n$ kubectl logs -n kube-system coredns-5d78c9-4kk2n --since=10m | tail -3\n[ERROR] plugin/errors: 2 api.partner.example.com. A: read udp 10.244.2.9:51844->10.20.0.53:53: i/o timeout\n[ERROR] plugin/errors: 2 api.partner.example.com. AAAA: read udp 10.244.2.9:40112->10.20.0.53:53: i/o timeout\n[ERROR] plugin/errors: 2 ldap.corp.example.com. A: read udp 10.244.2.9:38827->10.20.0.53:53: i/o timeout',
      reads: 'CoreDNS is healthy, but its queries to 10.20.0.53 on port 53 time out. The problem is between CoreDNS and its upstream resolver, not inside CoreDNS. (These errors appear because the Corefile enables the errors plugin, as default configurations typically do.)',
      key: true, herring: false },
    { id: 'a6', label: 'The CoreDNS configuration (Corefile)', group: 'Platform',
      shows: '$ kubectl get configmap coredns -n kube-system -o jsonpath=\'{.data.Corefile}\'\n.:53 {\n    errors\n    health\n    ready\n    kubernetes cluster.local in-addr.arpa ip6.arpa {\n       pods insecure\n       fallthrough in-addr.arpa ip6.arpa\n    }\n    prometheus :9153\n    forward . /etc/resolv.conf\n    cache 30\n    loop\n    reload\n    loadbalance\n}\n$ cat /etc/resolv.conf   (on a worker node)\nnameserver 10.20.0.53',
      reads: 'CoreDNS answers cluster.local itself and forwards everything else to the resolvers in its own /etc/resolv.conf — inherited from the node — which is 10.20.0.53, a corporate resolver. So every external lookup from every pod depends on nodes reaching 10.20.0.53.',
      key: true, herring: false },
    { id: 'a7', label: 'Query the upstream resolver directly (from a node and elsewhere)', group: 'Network & DNS',
      shows: 'node-03$ dig @10.20.0.53 api.partner.example.com +time=3 +tries=1\n;; communications error to 10.20.0.53#53: timed out\n;; no servers could be reached\nnode-03$ dig @10.20.0.53 api.partner.example.com +tcp +time=3 +tries=1\n;; communications error to 10.20.0.53#53: timed out\njumphost (management VLAN)$ dig @10.20.0.53 +short api.partner.example.com\n203.0.113.40',
      reads: 'The resolver is up and answers from the management VLAN, but worker nodes cannot reach it on UDP or TCP 53. Combined with last night\'s change, the likely cause is the new egress rules blocking DNS from the worker-node subnet to the shared-services VLAN. CoreDNS traffic to its upstream typically leaves with the node\'s address, so a node-subnet rule is what matters.',
      key: true, herring: false },
    { id: 'a8', label: 'Can a pod reach the partner by IP?', group: 'Network & DNS',
      shows: '$ kubectl exec -n shop deploy/netdebug -- curl -sS -o /dev/null -w \'%{http_code}\\n\' --resolve api.partner.example.com:443:203.0.113.40 https://api.partner.example.com/health\n200',
      reads: 'With name resolution bypassed, routing, egress and TLS to the partner all work. The failure is name resolution only. This is the cleanest way to separate "DNS" from "routing" from "application".',
      key: false, herring: false },
    { id: 'a9', label: 'Pod resolv.conf (search domains and ndots)', group: 'Network & DNS',
      shows: '$ kubectl exec -n shop deploy/netdebug -- cat /etc/resolv.conf\nsearch shop.svc.cluster.local svc.cluster.local cluster.local\nnameserver 10.96.0.10\noptions ndots:5',
      reads: 'With ndots:5, a name with fewer than five dots is tried with each search suffix first, so api.partner.example.com generates extra cluster.local queries before the real one. That is a real source of extra query volume and some latency, and worth knowing. But those suffixed queries are answered locally by CoreDNS with NXDOMAIN, this setting has not changed, and it cannot explain a sudden timeout. Not the cause here.',
      key: false, herring: true },
    { id: 'a10', label: 'NetworkPolicies in the affected namespaces', group: 'Network & DNS',
      shows: 'The shop namespace has one NetworkPolicy: egress allowed to kube-dns on 53/UDP and 53/TCP, and to any address on 443. Unchanged for three months. Other affected namespaces have no NetworkPolicy at all.',
      reads: 'In-cluster DNS works, so pod-to-CoreDNS traffic is allowed. Namespaces without any policy fail too. NetworkPolicy is not the difference; the failing hop is CoreDNS-to-upstream, which the corporate firewall controls.',
      key: false, herring: true },
    { id: 'a11', label: 'CoreDNS metrics (responses by code, latency)', group: 'Platform',
      shows: 'coredns_dns_responses_total by rcode: SERVFAIL went from ~0/s to ~40/s at 23:12; NOERROR for cluster.local names unchanged. Request latency p99 jumped to ~5 s for non-cluster names only.',
      reads: 'Pins the start time to 23:12, inside the change window, and shows the failures are only for forwarded (external) names.',
      key: false, herring: false }
  ],
  efficient: ['a1', 'a3', 'a4', 'a5', 'a7'],
  cause: 'Last night\'s firewall change blocked DNS (UDP and TCP 53) from the worker-node subnet to the corporate resolver 10.20.0.53. CoreDNS forwards every non-cluster name to that resolver, so external lookups fail with SERVFAIL/timeouts while cluster names, answered by CoreDNS itself, keep working.',
  mechanism: 'A pod sends every DNS query to the cluster DNS Service IP. CoreDNS answers names in cluster.local from the Kubernetes API itself; for anything else, the forward plugin sends the query to the upstream resolvers — here taken from the node\'s /etc/resolv.conf. When the upstream is unreachable, CoreDNS waits, then returns SERVFAIL, and the client retries until its own timeout.\n\nThe response code tells you a lot: NXDOMAIN means a resolver got an authoritative "no such name" (a naming or search-path problem); SERVFAIL or a timeout means the resolution chain could not complete (reachability or upstream health). Checking an in-cluster name, an external name, and the upstream directly from a node isolates which hop is broken.',
  fix: 'Ask the network team to restore the allow rule from the worker-node subnet to the resolver on UDP and TCP 53 — reverting one rule from their change is the smallest, best-understood fix, and you can hand them the exact source subnet, destination and ports from your evidence. If that cannot happen quickly, a fallback is pointing CoreDNS\'s forward at a resolver the nodes are allowed to reach, but that is a cluster-wide config change and needs the same care. Do not restart or scale CoreDNS (it is healthy), do not add hostAliases or /etc/hosts entries to pods, do not change ndots cluster-wide in the middle of an incident, and do not point pods at public resolvers (they may be blocked too, and they cannot resolve internal names).',
  verify: 'From a debug pod, dig of the partner name through 10.96.0.10 returns NOERROR in milliseconds, over UDP and with +tcp. CoreDNS SERVFAIL rate returns to baseline, and the affected services\' outbound error rate drops to zero. Some clients cache failures or connections, so check the apps themselves, not just dig.',
  followups: [
    { q: 'After the rule is restored, one service keeps failing for another 20 minutes. Why might that be?', guidance: 'Client-side caching: some runtimes cache DNS results (including failures) in-process, connection pools may hold failed state, and CoreDNS may briefly cache negative or failed answers depending on its cache settings. Check from inside that pod and restart only that workload if needed.' },
    { q: 'How would you tell NXDOMAIN, SERVFAIL and a timeout apart, and what does each point to?', guidance: 'NXDOMAIN: the name does not exist as asked — look at spelling, search domains, ndots, or the zone. SERVFAIL: the resolver could not complete resolution — upstream unreachable, DNSSEC failure, broken delegation. Timeout: no answer at all — packets dropped between client and resolver. Use dig with the status line and query time, query the next hop directly.' },
    { q: 'How would you have caught this during the change window rather than from user reports?', guidance: 'Treat DNS as an explicit dependency in the change plan; run a synthetic check from worker nodes (and from a pod) that resolves an external and an internal name through the real path; alert on CoreDNS SERVFAIL rate and forward latency; include a pre/post verification step owned by both teams.' }
  ],
  rubric: {
    strong: [
      'Separates in-cluster DNS, external DNS and raw connectivity with targeted tests',
      'Reads SERVFAIL/timeout vs NXDOMAIN correctly and follows the chain to the upstream',
      'Uses CoreDNS logs and the Corefile forward line to identify the upstream and its address',
      'Tests the upstream directly from a node and from a known-good network segment',
      'Hands the network team precise evidence and asks for the smallest rollback'
    ],
    acceptable: [
      'Starts from the CoreDNS logs and works outward',
      'Uses curl --resolve or a direct IP test first to prove it is name resolution',
      'Temporarily repoints the forward to another reachable internal resolver with change approval'
    ],
    redFlags: [
      'Restarts or scales CoreDNS repeatedly without evidence it is the problem',
      'Blames ndots or search domains for a sudden outage without testing',
      'Hardcodes IPs in /etc/hosts or hostAliases as the fix',
      'Assumes namespaces or NetworkPolicy are involved without checking'
    ]
  },
  lessons: ['les-request-path', 'les-netpol'],
  questions: ['ons-q-net-04', 'ons-q-net-05'],
  alsoPractise: [
    { track: 'containers', what: 'Cluster DNS scenarios: checking the resolver a pod was given and ruling out CoreDNS' },
    { track: 'linux', what: 'dig / resolv.conf basics and refusal vs timeout on the host' }
  ],
  refs: [
    { t: 'Debugging DNS Resolution', u: 'https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/' },
    { t: 'Customizing DNS Service', u: 'https://kubernetes.io/docs/tasks/administer-cluster/dns-custom-nameservers/' },
    { t: 'DNS for Services and Pods', u: 'https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/' }
  ],
  verify_note: 'CoreDNS log wording, how long forward waits before returning SERVFAIL, whether failures are cached, and metric names vary by CoreDNS version and Corefile. Whether traffic from CoreDNS to an external resolver is source-NATed to the node IP depends on the CNI configuration.'
});

/* ---------------------------------------------------------------- case 04 */
LX.onsiteCases.push({
  id: 'ons-case-04', track: 'onsite', title: 'Some clients cannot talk to an internal API', domain: 'tls',
  level: 2, mins: 12,
  opening: 'Since this morning, several internal services are failing when they call the inventory API, and their logs mention TLS or certificate errors. If you open the same URL in a browser, it loads fine and the padlock looks normal. We need callers working again.',
  context: 'The inventory API is served at https://inventory.internal.example.com through a reverse proxy (for example an ingress controller) that terminates TLS. Certificates come from the company\'s internal CA, which has an offline root and an issuing intermediate. Callers include Go and Python services and people using browsers on company laptops.',
  asks: [
    { id: 'a1', label: 'What changed recently?', group: 'Scope & changes',
      shows: 'The inventory API\'s certificate was rotated yesterday at 17:00, a week before the old one expired. The new certificate was issued by the same internal intermediate. The TLS Secret the proxy uses was replaced; there was no application release.',
      reads: 'A certificate rotation right before TLS errors is a strong lead. Keep an open mind about what exactly differs between the old and new setup: the certificate itself, its chain, its names, or how it was installed.',
      key: true, herring: false },
    { id: 'a2', label: 'Who / what is affected (scope)?', group: 'Scope & changes',
      shows: 'Every non-browser client that opened a new connection to inventory.internal.example.com since yesterday evening. Services with long-lived connections opened before 17:00 kept working until they reconnected. Other hostnames on the same proxy are fine. Browsers are fine.',
      reads: 'One hostname, only the new certificate, only new handshakes, only non-browser clients. Certificates are verified during the handshake, so existing connections are unaffected — and something about how browsers verify is different.',
      key: true, herring: false },
    { id: 'a3', label: 'The exact client error messages', group: 'Application',
      shows: 'Go service:\n  Get "https://inventory.internal.example.com/v2/stock": tls: failed to verify certificate: x509: certificate signed by unknown authority\nPython service:\n  requests.exceptions.SSLError: HTTPSConnectionPool(host=\'inventory.internal.example.com\', port=443): ... [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate',
      reads: 'Both are chain-building failures: the client could not link the server\'s certificate to a root it trusts. Not expiry ("certificate has expired or is not yet valid") and not a name mismatch ("certificate is valid for ..., not ..."), which have different messages.',
      key: true, herring: false },
    { id: 'a4', label: 'curl -v from a failing client host', group: 'Network & DNS',
      shows: '$ curl -v https://inventory.internal.example.com/health\n*   Trying 10.30.4.20:443...\n* Connected to inventory.internal.example.com (10.30.4.20) port 443\n* TLSv1.3 (OUT), TLS handshake, Client hello (1):\n* TLSv1.3 (IN), TLS handshake, Server hello (2):\n* TLSv1.3 (IN), TLS handshake, Certificate (11):\n* TLSv1.3 (OUT), TLS alert, unknown CA (560):\n* SSL certificate problem: unable to get local issuer certificate\ncurl: (60) SSL certificate problem: unable to get local issuer certificate',
      reads: 'DNS, routing and TCP are fine and the TLS handshake starts normally. The client receives the certificate and rejects it with "unknown CA". The failure is purely certificate verification.',
      key: false, herring: false },
    { id: 'a5', label: 'openssl s_client -showcerts against the server', group: 'Network & DNS',
      shows: '$ openssl s_client -connect inventory.internal.example.com:443 -servername inventory.internal.example.com -showcerts </dev/null\nCONNECTED(00000003)\ndepth=0 CN = inventory.internal.example.com\nverify error:num=20:unable to get local issuer certificate\nverify return:1\ndepth=0 CN = inventory.internal.example.com\nverify error:num=21:unable to verify the first certificate\nverify return:1\n---\nCertificate chain\n 0 s:CN = inventory.internal.example.com\n   i:C = US, O = Example Corp, CN = Example Corp Issuing CA 2\n-----BEGIN CERTIFICATE-----\n(...)\n-----END CERTIFICATE-----\n---\n...\nVerify return code: 21 (unable to verify the first certificate)',
      reads: 'The server sends exactly one certificate: the leaf (depth 0), issued by "Issuing CA 2". It does not send the intermediate. A client that trusts only the root cannot build the path leaf → intermediate → root, so verification fails.',
      key: true, herring: false },
    { id: 'a6', label: 'Compare with a hostname on the same proxy that still works', group: 'Network & DNS',
      shows: '$ openssl s_client -connect reports.internal.example.com:443 -servername reports.internal.example.com -showcerts </dev/null\n...\nCertificate chain\n 0 s:CN = reports.internal.example.com\n   i:C = US, O = Example Corp, CN = Example Corp Issuing CA 2\n 1 s:C = US, O = Example Corp, CN = Example Corp Issuing CA 2\n   i:C = US, O = Example Corp, CN = Example Corp Root CA\n...\nVerify return code: 0 (ok)',
      reads: 'The working host sends the leaf plus the intermediate. Same proxy, same CA — the difference is what was installed for the inventory hostname.',
      key: false, herring: false },
    { id: 'a7', label: 'The TLS Secret contents', group: 'Platform',
      shows: '$ kubectl get secret inventory-tls -n inventory -o jsonpath=\'{.data.tls\\.crt}\' | base64 -d | grep -c \'BEGIN CERTIFICATE\'\n1\n$ kubectl get secret reports-tls -n reports -o jsonpath=\'{.data.tls\\.crt}\' | base64 -d | grep -c \'BEGIN CERTIFICATE\'\n2',
      reads: 'The new tls.crt contains one PEM block: the leaf only. The rotation used the leaf file where the full chain (leaf followed by intermediate) was needed. (Note the base64 here is encoding, not encryption — anyone who can read the Secret can read it.)',
      key: true, herring: false },
    { id: 'a8', label: 'Client and server clocks', group: 'Node & host',
      shows: 'date -u on a failing client: 2026-09-29 09:14 UTC, NTP synchronised. New certificate: notBefore 2026-09-28 16:40 UTC, notAfter 2027-09-28 16:40 UTC. The proxy host\'s clock is also correct.',
      reads: 'A clock problem produces "not yet valid" or "expired" errors, not "unknown authority". The certificate was valid before rotation and the clocks are fine. Ruled out.',
      key: false, herring: true },
    { id: 'a9', label: 'Do the clients trust the company root CA?', group: 'Application',
      shows: 'The client images add "Example Corp Root CA" to their trust bundle at build time, and it is present in the failing containers. The intermediate is not in the bundle — which is normal; intermediates are expected to come from the server. The client images have not changed this week.',
      reads: 'The trust anchor is there, so the client side has not changed. The missing piece is the link between the leaf and that root.',
      key: false, herring: false },
    { id: 'a10', label: 'TLS versions and cipher settings', group: 'Platform',
      shows: 'The proxy offers TLS 1.2 and 1.3; the failing handshakes negotiate TLS 1.3 with TLS_AES_128_GCM_SHA256 before failing. No proxy TLS settings changed.',
      reads: 'Protocol and cipher negotiation succeed; version or cipher mismatches fail earlier with handshake or protocol errors, not certificate-verification errors. Not relevant.',
      key: false, herring: true },
    { id: 'a11', label: 'Why do browsers work?', group: 'Application',
      shows: 'On a company laptop, the browser\'s certificate viewer shows a full path: inventory.internal.example.com → Example Corp Issuing CA 2 → Example Corp Root CA. Device management installs both the root and the intermediate into the OS certificate store.',
      reads: 'Browsers can fill in a missing intermediate from certificates they already have (installed, cached from earlier sites) or, on some platforms, by fetching it from the URL in the certificate\'s Authority Information Access field. Strict clients such as Go, Python and curl typically do not. A working browser does not prove the server is configured correctly.',
      key: false, herring: false },
    { id: 'a12', label: 'Proxy / ingress error logs', group: 'Platform',
      shows: '[info] ... SSL_do_handshake() failed (SSL: error:0A000418:SSL routines::tlsv1 alert unknown ca:SSL alert number 48) while SSL handshaking, client: 10.40.2.17, server: 0.0.0.0:443',
      reads: 'Server-side confirmation: clients are aborting the handshake with an "unknown CA" alert. Consistent with the chain problem.',
      key: false, herring: false }
  ],
  efficient: ['a1', 'a2', 'a3', 'a5', 'a7'],
  cause: 'The rotated certificate was installed without its intermediate: the server now sends only the leaf. Clients that trust the company root but do not have the intermediate cannot build a chain and fail with "unknown authority"; browsers work because they already have or can fetch the intermediate.',
  mechanism: 'A TLS server is expected to send its leaf certificate plus every intermediate needed to reach a root; the client supplies only the root (trust anchor). The client builds the path leaf → intermediate → root and checks each signature. If the intermediate is missing and the client has no other way to find it, the path cannot be built and verification fails, even though the leaf itself is perfectly valid.\n\nMany browsers mask this: they reuse intermediates they have seen or that are installed on the device, and some fetch missing intermediates using the Authority Information Access URL in the certificate. Libraries used by services (Go crypto/tls, OpenSSL-based Python and curl) typically do not, which is why "works in my browser" is a classic trap for this failure.',
  fix: 'Rebuild the TLS Secret with tls.crt containing the leaf followed by the intermediate (the root is not needed), apply it, and confirm the proxy picked it up (many controllers watch Secrets and reload automatically). The blast radius is one hostname; the change adds a certificate the server should always have sent. Do not tell callers to disable verification (InsecureSkipVerify, verify=False, curl -k), and do not "fix" it by adding the intermediate to every client\'s trust store — that hides the server bug and breaks again when the intermediate rotates. There is no need to re-issue the certificate. Afterwards, add a chain check to the rotation procedure (verify the served chain against a root-only bundle).',
  verify: 'openssl s_client -showcerts shows depth 0 and depth 1 and "Verify return code: 0 (ok)" when given only the root bundle; curl without -k succeeds from a previously failing host; the Go and Python services\' error rates drop to zero on new connections.',
  followups: [
    { q: 'Why did services with long-lived connections keep working after the rotation?', guidance: 'Certificate verification happens during the TLS handshake. Existing connections were established with the old certificate and are not re-verified; they fail only when they reconnect. That is also why rotations can look fine for hours and then fail during a restart or scale-up.' },
    { q: 'How would you rotate certificates for hundreds of endpoints across isolated environments without this happening?', guidance: 'Automate issuance and installation, validate the full chain against a root-only bundle before and after install, stage the rollout (canary endpoints first), monitor both expiry and chain validity from a strict client, and plan trust-bundle changes (new roots or intermediates) to be distributed before any certificate that depends on them.' },
    { q: 'Does the order of certificates in the chain file matter?', guidance: 'Yes: the leaf must come first, followed by intermediates in order toward the root. Many servers send exactly what is in the file, and some clients are strict about order. Including the root is unnecessary; clients must already trust it.' }
  ],
  rubric: {
    strong: [
      'Correlates with the rotation and scopes to one hostname and new handshakes',
      'Reads the error text to separate chain problems from expiry and name mismatches',
      'Uses openssl s_client -showcerts to see what the server actually sends',
      'Explains why browsers mask a missing intermediate',
      'Fixes the server chain and rejects disabling verification'
    ],
    acceptable: [
      'Compares against a working hostname on the same proxy to find the difference',
      'Inspects the Secret or certificate file first and counts the certificates in it'
    ],
    redFlags: [
      'Suggests turning off certificate verification in clients',
      'Adds the intermediate to client trust stores as the permanent fix',
      'Concludes the server is fine because the browser works',
      'Focuses on clock skew or cipher settings without evidence'
    ]
  },
  lessons: ['les-config', 'les-disconnected'],
  questions: ['ons-q-design-08', 'ons-q-net-04', 'ons-q-config-03'],
  alsoPractise: [{ track: 'linux', what: 'Reading openssl and curl -v output on the host' }],
  refs: [
    { t: 'Ingress (TLS section)', u: 'https://kubernetes.io/docs/concepts/services-networking/ingress/' },
    { t: 'Secrets (TLS Secrets)', u: 'https://kubernetes.io/docs/concepts/configuration/secret/' }
  ],
  verify_note: 'Error text differs between Go, Python/OpenSSL and curl versions. Whether a browser fetches missing intermediates (AIA) or relies on cached/preloaded intermediates depends on the browser and platform. Whether the proxy reloads a changed Secret automatically depends on the ingress controller.'
});

/* ---------------------------------------------------------------- case 05 */
LX.onsiteCases.push({
  id: 'ons-case-05', track: 'onsite', title: 'New capacity that will not run workloads', domain: 'cloud',
  level: 3, mins: 15,
  opening: 'We added a new group of worker nodes to a cluster in an isolated environment yesterday to get more capacity. Pods that land on the new nodes never start. Everything that was already running is fine. We would like to use the new capacity this week.',
  context: 'The environment has no internet access. All images come from a private registry mirror inside the environment, at mirror.registry.internal, which serves a certificate issued by the environment\'s own internal CA. Nodes run containerd as the container runtime in this example, and are built from a versioned node image plus a bootstrap script that runs at first boot.',
  asks: [
    { id: 'a1', label: 'What changed recently?', group: 'Scope & changes',
      shows: 'New node group "workers-b" (4 nodes) created yesterday from node image v2026.09.1. The existing group "workers-a" (6 nodes) runs v2026.06.3. The new image was built on a newer base OS release, and the bootstrap script was refactored at the same time. Separately, the mirror was re-synced with new application images last night, as it is every night.',
      reads: 'Two changes. The node image and bootstrap changed together and only affect the new nodes, which matches the symptom. The mirror sync affects everyone, and old nodes are fine, so it is less likely.',
      key: true, herring: false },
    { id: 'a2', label: 'Who / what is affected (scope)?', group: 'Scope & changes',
      shows: 'Every pod scheduled onto a workers-b node fails to start — across all namespaces and all images, including the log-shipper DaemonSet pod on those nodes. The same images, by the same digests, run fine on workers-a nodes.',
      reads: 'The variable is the node, not the image or the workload. Something about the new nodes prevents them from running any image from the mirror.',
      key: true, herring: false },
    { id: 'a3', label: 'Pod status and events (describe a failing pod)', group: 'Workload',
      shows: '$ kubectl describe pod orders-api-6b7d9c-2kx8v -n orders   (events excerpt)\n  Normal   Scheduled  14m                  default-scheduler  Successfully assigned orders/orders-api-6b7d9c-2kx8v to workers-b-2\n  Normal   Pulling    12m (x4 over 14m)    kubelet  Pulling image "mirror.registry.internal/apps/orders-api@sha256:9f2c...e41"\n  Warning  Failed     12m (x4 over 14m)    kubelet  Failed to pull image "mirror.registry.internal/apps/orders-api@sha256:9f2c...e41": failed to pull and unpack image "...": failed to resolve reference "...": failed to do request: Head "https://mirror.registry.internal/v2/apps/orders-api/manifests/sha256:9f2c...e41": tls: failed to verify certificate: x509: certificate signed by unknown authority\n  Warning  Failed     12m (x4 over 14m)    kubelet  Error: ErrImagePull\n  Normal   BackOff    2m (x42 over 14m)    kubelet  Back-off pulling image "mirror.registry.internal/apps/orders-api@sha256:9f2c...e41"\n  Warning  Failed     2m (x42 over 14m)    kubelet  Error: ImagePullBackOff',
      reads: 'Scheduling worked. The pull fails at the TLS handshake with the mirror — before authentication and before any manifest lookup. This is not "not found", "unauthorized" or "too many requests"; the node does not trust the certificate the mirror presents. ImagePullBackOff is the back-off state; the reason is in the Failed event.',
      key: true, herring: false },
    { id: 'a4', label: 'Which nodes are the failing pods on?', group: 'Node & host',
      shows: '$ kubectl get pods -A -o wide --field-selector=status.phase=Pending | awk \'{print $8}\' | sort | uniq -c\n   7 workers-b-1\n   6 workers-b-2\n   5 workers-b-3\n   6 workers-b-4\n(no failing pods on any workers-a node)',
      reads: 'Every failing pod is on a workers-b node. Clean split by node group.',
      key: false, herring: false },
    { id: 'a5', label: 'Node status of the new nodes', group: 'Node & host',
      shows: '$ kubectl get nodes -l node-group=workers-b\nNAME          STATUS   ROLES    AGE   VERSION\nworkers-b-1   Ready    <none>   21h   v1.xx.y\nworkers-b-2   Ready    <none>   21h   v1.xx.y\nworkers-b-3   Ready    <none>   21h   v1.xx.y\nworkers-b-4   Ready    <none>   21h   v1.xx.y\n(no pressure conditions; the node image pre-loads the pause and CNI plugin images, so networking came up without pulling from the mirror)',
      reads: 'Ready only means the kubelet, runtime and network plugin are healthy. It says nothing about whether the node can pull application images. That is why the scheduler keeps placing pods there.',
      key: false, herring: false },
    { id: 'a6', label: 'Pull by hand and test TLS on a new node and an old node', group: 'Node & host',
      shows: 'workers-b-2$ sudo crictl pull mirror.registry.internal/apps/orders-api@sha256:9f2c...e41\nE0929 ... PullImage from image service failed ... tls: failed to verify certificate: x509: certificate signed by unknown authority\nworkers-b-2$ curl -sS https://mirror.registry.internal/v2/\ncurl: (60) SSL certificate problem: unable to get local issuer certificate\nworkers-a-3$ curl -sS -o /dev/null -w \'%{http_code}\\n\' https://mirror.registry.internal/v2/\n401',
      reads: 'On the old node, TLS succeeds and the registry asks for credentials (401 on /v2/ is normal). On the new node, both the runtime and the OS tools reject the mirror\'s certificate. The internal CA is missing from the new node\'s trust configuration.',
      key: true, herring: false },
    { id: 'a7', label: 'Trust configuration on old vs new node', group: 'Node & host',
      shows: 'workers-a-3$ ls /etc/containerd/certs.d/mirror.registry.internal/\nca.crt  hosts.toml\nworkers-a-3$ trust list | grep -c "Example Internal Root CA"\n1\nworkers-b-2$ ls /etc/containerd/certs.d/\nls: cannot access \'/etc/containerd/certs.d/\': No such file or directory\nworkers-b-2$ trust list | grep -c "Example Internal Root CA"\n0',
      reads: 'Old nodes have the internal root CA both in the OS trust store and in the runtime\'s per-registry configuration. New nodes have neither.',
      key: true, herring: false },
    { id: 'a8', label: 'Diff the bootstrap script between node images', group: 'Platform',
      shows: '$ diff bootstrap-v2026.06.3.sh bootstrap-v2026.09.1.sh\n< install -m 0644 /opt/bootstrap/certs/internal-root-ca.pem /etc/pki/ca-trust/source/anchors/\n< update-ca-trust extract\n< mkdir -p /etc/containerd/certs.d/mirror.registry.internal\n< cp /opt/bootstrap/certs/internal-root-ca.pem /etc/containerd/certs.d/mirror.registry.internal/ca.crt\n< cp /opt/bootstrap/containerd/hosts.toml /etc/containerd/certs.d/mirror.registry.internal/hosts.toml\n---\n> # trust configuration moved to the node image build (see image pipeline)\n(the image pipeline for v2026.09.1 has no step that installs the CA)',
      reads: 'The refactor removed the CA installation from bootstrap on the assumption the image build would do it, and the image build never did. The root cause is a gap in the node build process, not the nodes themselves.',
      key: true, herring: false },
    { id: 'a9', label: 'Registry capacity and rate limiting', group: 'Platform',
      shows: 'Mirror dashboards: 3% CPU, 41% storage used, p99 manifest latency 35 ms, zero 429 or 5xx responses in the last 24 hours. Pull rates from workers-a nodes are normal.',
      reads: 'The mirror is healthy and not throttling. Rate limiting would appear as HTTP 429 or "too many requests" in the events; here the connection fails at TLS before any HTTP status. Not the cause.',
      key: false, herring: true },
    { id: 'a10', label: 'Last night\'s mirror re-sync', group: 'Platform',
      shows: 'The sync job completed: 37 images updated, digests verified against the release manifest. The failing pods include images that were not touched by this sync, such as the log shipper, unchanged for three months.',
      reads: 'A routine sync, verified, and failing images include ones it did not touch. Not related.',
      key: false, herring: true },
    { id: 'a11', label: 'Image pull secrets / registry credentials', group: 'Workload',
      shows: 'Pods use the same imagePullSecret on both node groups; the Secret has not changed in months. On the new nodes the error occurs during the TLS handshake, before credentials would be sent.',
      reads: 'Rules out authentication. A credential problem looks like 401/403 "unauthorized" in the events, after TLS succeeds.',
      key: false, herring: false }
  ],
  efficient: ['a2', 'a3', 'a1', 'a6', 'a8'],
  cause: 'The new node image\'s bootstrap no longer installs the environment\'s internal root CA (the step was removed in a refactor and never added to the image build). The container runtime on the new nodes therefore does not trust the mirror\'s certificate, so every image pull fails with an x509 "unknown authority" error.',
  mechanism: 'The kubelet asks the container runtime to pull images; the runtime connects to the registry over HTTPS and verifies its certificate like any TLS client. In an isolated environment the registry certificate comes from a private CA, so each node must be given that trust root — typically through the OS trust store, the runtime\'s per-registry configuration, or both, depending on the runtime and its configuration. Without it, the TLS handshake fails before authentication or any manifest lookup.\n\nThe node still reports Ready because Ready reflects the kubelet, runtime and network plugin, and the images needed to bring the node up were pre-loaded. So the scheduler keeps placing pods on nodes that cannot run them.',
  fix: 'First limit the damage: cordon the workers-b nodes so no new pods are placed there, then delete the stuck pods so their controllers recreate them on workers-a, after checking workers-a has room for their requests (DaemonSet pods will stay on workers-b; that is expected). To prove the hypothesis, install the CA by hand on one new node, restart the runtime if its configuration requires it, and confirm a pull succeeds — then discard that node rather than keeping a hand-patched one. The real fix is in the build: put the CA installation back into the node image or bootstrap, build a new image version, and replace the workers-b nodes through the normal node-group process. Blast radius stays limited to the new group. Do not mark the registry as insecure or skip TLS verification, and do not copy the CA onto nodes through an ad hoc, unverified channel.',
  verify: 'On a rebuilt node, crictl pull of a known digest succeeds. Uncordon one node, schedule a canary pod pinned to it (for example with a nodeSelector), and watch it pull, start and become Ready. Then uncordon the rest and confirm normal pods land and run there.',
  followups: [
    { q: 'How would you stop the scheduler from placing pods on a node that cannot pull images?', guidance: 'Have new nodes join with a startup taint (or cordoned) and remove it only after a readiness check passes — for example pulling a known image from the mirror by digest and checking time sync and DNS. Build the same check into the node-image pipeline so a bad image fails before it reaches a node group.' },
    { q: 'In a disconnected environment, how do you distribute and rotate the internal root CA to nodes?', guidance: 'Treat the trust bundle as a versioned artifact delivered with the node image or bootstrap through the same verified release process as everything else. For rotation, add the new root alongside the old one everywhere first, then reissue server certificates, then remove the old root once nothing depends on it.' },
    { q: 'Someone suggests adding the mirror as an insecure registry to unblock the team today. What do you say?', guidance: 'No: it removes the only thing proving the node is talking to the real mirror, in an environment where the mirror is the root of software supply. The safe short-term option exists — cordon and run on the old nodes — and the real fix is a small build change.' }
  ],
  rubric: {
    strong: [
      'Scopes to the node group quickly and asks what differs about those nodes',
      'Reads the pull error closely: TLS/x509 at the handshake, not auth, not 404, not 429',
      'Tests the same pull on an old and a new node to isolate the variable',
      'Contains the impact first (cordon, reschedule after checking capacity)',
      'Fixes the build or bootstrap rather than hand-patching nodes, and refuses insecure registries'
    ],
    acceptable: [
      'Diffs node images or bootstrap scripts first after seeing the split by node group',
      'Hand-fixes one node purely to confirm the hypothesis before rebuilding'
    ],
    redFlags: [
      'Configures the registry as insecure or disables TLS verification',
      'Blames registry capacity or rate limiting without evidence',
      'Assumes a Ready node can run workloads',
      'Leaves the new nodes schedulable while investigating'
    ]
  },
  lessons: ['les-disconnected', 'les-scheduling', 'les-pod-lifecycle'],
  questions: ['ons-q-trouble-08', 'ons-q-delivery-04', 'ons-q-delivery-01'],
  alsoPractise: [{ track: 'containers', what: 'ImagePullBackOff scenarios: which tag or digest was requested and why the pull failed' }],
  refs: [
    { t: 'Images', u: 'https://kubernetes.io/docs/concepts/containers/images/' },
    { t: 'Debugging Kubernetes nodes with crictl', u: 'https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/' },
    { t: 'Safely Drain a Node (cordon/drain)', u: 'https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/' }
  ],
  verify_note: 'Exact pull error wording depends on the container runtime and version. Whether containerd uses the OS trust store, a per-registry ca in /etc/containerd/certs.d/<host>/ (config_path), or both depends on containerd version and configuration; other runtimes (for example CRI-O) use different paths. Whether a runtime restart is needed after adding a CA also varies.'
});

/* ---------------------------------------------------------------- case 06 */
LX.onsiteCases.push({
  id: 'ons-case-06', track: 'onsite', title: 'Writes failing on an application host', domain: 'linux',
  level: 2, mins: 10,
  opening: 'An application host started throwing errors about an hour ago. Uploads fail and the app log says "No space left on device". The engineer who got paged ran df -h, saw the disk is only about 60% full, and is confused.',
  context: 'A single Linux VM running a web application and a background worker. One 200 GB ext4 root filesystem. It is managed by configuration management, and the VM was rebuilt from a new base image a few weeks ago.',
  asks: [
    { id: 'a1', label: 'What changed recently?', group: 'Scope & changes',
      shows: 'No application release in 9 days. The VM was rebuilt from a new base image 17 days ago; configuration management applied the same roles as before. Traffic is normal.',
      reads: 'Nothing changed today. A rebuild 17 days ago is a slow-burn candidate: something that used to happen on the old image might not happen any more.',
      key: true, herring: false },
    { id: 'a2', label: 'Who / what is affected (scope)?', group: 'Scope & changes',
      shows: 'Uploads fail and new logins fail; users who are already logged in can still browse. The background worker also logs failures creating temp files. Reads are fine.',
      reads: 'What fails is creating new files; reading and appending to existing ones seem fine. That is a useful hint about what kind of "space" is missing.',
      key: true, herring: false },
    { id: 'a3', label: 'The exact error messages', group: 'Application',
      shows: '2026-09-29T08:12:44Z ERROR upload: open /var/lib/webapp/tmp/upl-8f2a1c: no space left on device\n2026-09-29T08:12:47Z ERROR session: open /var/lib/webapp/sessions/sess_7d1e9a: no space left on device',
      reads: 'ENOSPC on open() for new files. ENOSPC means the filesystem could not allocate what it needed — data blocks or inodes. (A quota would say "Disk quota exceeded"; a read-only filesystem would say "Read-only file system".)',
      key: true, herring: false },
    { id: 'a4', label: 'df -h', group: 'Node & host',
      shows: '$ df -h /\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       197G  116G   73G  62% /',
      reads: 'Plenty of free blocks. If bytes are not the problem, check the other thing a filesystem can run out of.',
      key: true, herring: false },
    { id: 'a5', label: 'df -i', group: 'Node & host',
      shows: '$ df -i /\nFilesystem       Inodes    IUsed IFree IUse% Mounted on\n/dev/sda1      13107200 13107200     0  100% /',
      reads: 'Every inode is used. Every file and directory needs one inode, so no new file can be created regardless of free bytes. On ext4 the inode count is fixed when the filesystem is created.',
      key: true, herring: false },
    { id: 'a6', label: 'Where are all the files? (counts by directory)', group: 'Node & host',
      shows: '$ sudo find /var/lib/webapp -xdev -type f | cut -d/ -f1-5 | sort | uniq -c | sort -rn | head -3\n12384102 /var/lib/webapp/sessions\n   48211 /var/lib/webapp/tmp\n     902 /var/lib/webapp/static\n(took about 4 minutes)\n$ sudo ls -ltr /var/lib/webapp/sessions | head -2\ntotal 49536408\n-rw------- 1 webapp webapp 412 Sep 12 03:10 sess_00a3c1...',
      reads: 'About 12.4 million small session files, the oldest from 17 days ago — the day of the rebuild. Sessions are being created and never cleaned up.',
      key: true, herring: false },
    { id: 'a7', label: 'Session cleanup jobs / timers', group: 'Application',
      shows: 'On a host still on the old image:\n$ cat /etc/cron.d/webapp-session-gc\n*/30 * * * * webapp find /var/lib/webapp/sessions -type f -mmin +1440 -delete\nOn this host:\n$ ls /etc/cron.d/ | grep -i session\n(nothing)\n$ systemctl list-timers | grep -i session\n(nothing)\n(the cron file was baked into the old base image by hand; it was never in configuration management)',
      reads: 'The cleanup job existed only in the old image, not in configuration management, so the rebuild silently dropped it. That is the root cause; inode exhaustion is the symptom.',
      key: true, herring: false },
    { id: 'a8', label: 'Deleted-but-open files and du vs df', group: 'Node & host',
      shows: '$ sudo lsof +L1 | head -3\nCOMMAND  PID USER FD TYPE DEVICE SIZE/OFF NLINK   NODE NAME\nrsyslogd 812 root 7w REG    8,1    18432     0 131090 /var/log/messages-20260928 (deleted)\n$ sudo du -xsh /\n115G\t/',
      reads: 'The other classic "df and reality disagree" case — a large file deleted while a process still holds it open, so df counts the space but du cannot see it — is not happening: the only deleted-open file is 18 KB, and du (115G) agrees with df (116G). It would also show up as block usage, not inode usage.',
      key: false, herring: false },
    { id: 'a9', label: 'The biggest log file', group: 'Application',
      shows: '$ ls -lh /var/log/webapp/app.log\n-rw-r----- 1 webapp webapp 3.8G Sep 29 09:02 /var/log/webapp/app.log\n$ cat /etc/logrotate.d/webapp\n/var/log/webapp/*.log { daily rotate 7 compress missingok }',
      reads: 'Large, but it is one file — one inode — and logrotate manages it. Worth tuning later; not why file creation fails.',
      key: false, herring: true },
    { id: 'a10', label: 'Memory and load on the host', group: 'Node & host',
      shows: '$ free -m\n              total   used   free  shared  buff/cache  available\nMem:          15884   9120    612     210        6152       5210\n$ uptime\n 09:05:12 up 17 days,  2:41,  1 user,  load average: 1.21, 1.30, 1.18',
      reads: 'Healthy memory and load on 8 vCPUs. Irrelevant to "No space left on device".',
      key: false, herring: true },
    { id: 'a11', label: 'Kernel messages / filesystem health', group: 'Node & host',
      shows: '$ dmesg -T | grep -iE \'ext4|i/o error|remount\' | tail -3\n(nothing)\n$ findmnt -no OPTIONS /\nrw,relatime',
      reads: 'No filesystem errors and the filesystem is mounted read-write. Rules out corruption or an emergency read-only remount.',
      key: false, herring: false }
  ],
  efficient: ['a3', 'a4', 'a5', 'a6', 'a7'],
  cause: 'The root filesystem has run out of inodes: about 12.4 million session files have accumulated because the session cleanup cron job was baked into the old base image and was lost when the VM was rebuilt. Free bytes do not help because every new file needs an inode.',
  mechanism: 'A filesystem tracks two separate budgets: data blocks (bytes, what df -h shows) and inodes (one per file or directory, what df -i shows). On ext4 the number of inodes is fixed when the filesystem is created, based on an expected average file size. Millions of tiny files consume inodes far faster than blocks, so a filesystem can be 60% full by bytes and 100% full by inodes. When no inode is free, creating a file fails with ENOSPC — the same "No space left on device" error as a full disk.\n\nThe accumulation came from configuration drift: the cleanup existed only on the old hand-built image, so the rebuild removed it without anyone noticing, and inodes ran out 17 days later.',
  fix: 'Free inodes with the narrowest safe deletion: remove only sessions older than the session lifetime, for example find /var/lib/webapp/sessions -xdev -type f -mmin +1440 -delete (run under nice/ionice; it will take a while). find -delete avoids the "Argument list too long" failure of rm * and keeps current users logged in. Then restore the cleanup through configuration management, not by hand, and add monitoring for inode usage (for example alert at 80%). Blast radius is one host. Do not rm -rf the whole sessions directory (it logs everyone out and the app may expect the directory to exist), do not reboot (it frees nothing), and do not treat growing the disk as the fix — it can add inodes on ext4 but only buys time.',
  verify: 'df -i shows IUse% well below 100%; a test upload and a new login succeed; the app\'s ENOSPC errors stop. After the next scheduled run, the session file count stays roughly stable instead of growing.',
  followups: [
    { q: 'Now flip it: df says the disk is 100% full, but du only adds up to 60%. What is going on?', guidance: 'Most often a large file that was deleted while a process still holds it open (lsof +L1 shows it); the space is freed when the process closes it or restarts, or you can truncate it through /proc/<pid>/fd. Other causes: files hidden under a mount point, or reserved blocks for root.' },
    { q: 'How does inode exhaustion show up on a Kubernetes node?', guidance: 'The kubelet watches nodefs.inodesFree (and imagefs.inodesFree); crossing the threshold sets DiskPressure and triggers garbage collection and eviction. Pods writing many small files into emptyDir or container writable layers can cause it.' },
    { q: 'What in the process allowed this to happen, and how would you fix that?', guidance: 'Configuration drift: behaviour lived on a hand-built image rather than in code. Fix by moving all host configuration into configuration management, comparing old and new hosts during rebuilds, and adding inode usage to standard host monitoring.' }
  ],
  rubric: {
    strong: [
      'Recognises ENOSPC can mean inodes as well as bytes and checks df -i',
      'Finds where the files are with a targeted count, not by guessing',
      'Connects the accumulation to the rebuild and the missing cleanup job',
      'Deletes narrowly (only expired sessions) and restores cleanup through configuration management',
      'Mentions and rules out the deleted-but-open file case'
    ],
    acceptable: [
      'Checks lsof +L1 first, rules it out, then moves to inodes',
      'Frees a small number of inodes first to restore service, then does the full cleanup'
    ],
    redFlags: [
      'Deletes the big log file and declares victory',
      'Reboots the host hoping it helps',
      'rm -rf the whole sessions directory without considering users',
      'Grows the disk as the only action'
    ]
  },
  lessons: ['les-resources'],
  questions: ['ons-q-trouble-10', 'ons-q-behavior-02'],
  alsoPractise: [{ track: 'linux', what: 'Disk-full troubleshooting: df vs df -i, du one level at a time, and deleted-but-open files with lsof +L1' }],
  refs: [
    { t: 'Node-pressure Eviction (inode signals)', u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/' }
  ],
  verify_note: 'Inode behaviour depends on the filesystem: ext4 fixes the inode count at creation (resize can add inodes with new block groups), while XFS allocates inodes dynamically and rarely runs out this way.'
});

/* ---------------------------------------------------------------- case 07 */
LX.onsiteCases.push({
  id: 'ons-case-07', track: 'onsite', title: 'Tail latency regression after a routine change', domain: 'kubernetes',
  level: 3, mins: 15,
  opening: 'The p99 latency of the pricing API roughly tripled starting yesterday afternoon. The median barely moved and there are no errors. The team says the only change was "adding resource limits", which should not affect anything because the service never uses its full allocation.',
  context: 'The pricing API is a Deployment of 6 replicas on nodes with 16 vCPUs. It is a multi-threaded service with a worker pool sized to the number of CPUs it detects. Metrics come from a Prometheus-style monitoring stack that scrapes container metrics from the kubelet.',
  asks: [
    { id: 'a1', label: 'What changed recently?', group: 'Scope & changes',
      shows: 'Yesterday at 15:10 a platform-wide policy added CPU and memory limits to every workload that lacked them. For pricing-api: requests cpu 500m / memory 1Gi (unchanged); new limits cpu 1 / memory 2Gi. Same image, same replica count, same traffic pattern.',
      reads: 'The regression lines up exactly with new limits. "It never uses its full allocation" is a claim about averages; keep it as a hypothesis to test, not a fact.',
      key: true, herring: false },
    { id: 'a2', label: 'Who / what is affected (scope)?', group: 'Scope & changes',
      shows: 'pricing-api p99: 110 ms before, 340 ms after. p50: 22 ms → 25 ms. The p99 is worst during bursts at the top of each minute, when batch clients send many requests at once. Two other services report smaller tail regressions since yesterday; most report nothing.',
      reads: 'Only the tail moved, and it is worst during bursts. Something is adding delay to some requests some of the time — a pattern that fits short stalls rather than a slower code path.',
      key: true, herring: false },
    { id: 'a3', label: 'CPU usage vs the limit (average)', group: 'Workload',
      shows: '$ kubectl top pods -n pricing\nNAME                          CPU(cores)   MEMORY(bytes)\npricing-api-7d9f5c6b8-4xk2p   612m         1104Mi\npricing-api-7d9f5c6b8-9mlq2   588m         1090Mi\npricing-api-7d9f5c6b8-b7wtn   640m         1121Mi\n(dashboard: 1-minute average about 0.6 cores against a 1-core limit)',
      reads: 'On average the pods use about 60% of the limit — which is exactly why the team believes limits cannot matter. But a 1-minute or 15-second average can hide what happens inside each 100 ms scheduling period.',
      key: true, herring: false },
    { id: 'a4', label: 'CPU throttling metrics', group: 'Workload',
      shows: '# fraction of CFS periods in which the container was throttled (example query)\nrate(container_cpu_cfs_throttled_periods_total{namespace="pricing",container="pricing-api"}[5m])\n  / rate(container_cpu_cfs_periods_total{namespace="pricing",container="pricing-api"}[5m])\npricing-api-7d9f5c6b8-4xk2p   0.38\npricing-api-7d9f5c6b8-9mlq2   0.36\npricing-api-7d9f5c6b8-b7wtn   0.41\n(before 15:10 yesterday these series were empty: with no CPU limit there is no quota to be throttled against)',
      reads: 'In roughly 40% of 100 ms periods, the container hit its quota and was paused until the next period. That is the stall pattern that inflates tail latency.',
      key: true, herring: false },
    { id: 'a5', label: 'cgroup cpu.max and cpu.stat inside the container', group: 'Node & host',
      shows: '$ kubectl exec -n pricing pricing-api-7d9f5c6b8-4xk2p -- cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/cpu.stat\n100000 100000\nusage_usec 91833412210\nuser_usec 80122039112\nsystem_usec 11711373098\nnr_periods 812344\nnr_throttled 301877\nthrottled_usec 18422871123',
      reads: 'cpu.max "100000 100000" means 100 ms of CPU time per 100 ms period — a limit of 1 CPU. nr_throttled / nr_periods is about 37%, and throttled time adds up to hours. This is the raw evidence behind the metric (cgroup v2 paths; cgroup v1 names differ).',
      key: false, herring: false },
    { id: 'a6', label: 'How many threads does the service run?', group: 'Application',
      shows: 'The worker pool size is 16 — detected from the host\'s CPU count, not from the container\'s limit. Under a burst, ps -T shows all 16 worker threads busy at once.',
      reads: 'Sixteen threads running in parallel can use 100 ms of CPU quota in about 6–7 ms of wall-clock time. Then every thread is paused for the remaining ~93 ms of the period. Requests caught in that window wait, which shows up only in the tail.',
      key: true, herring: false },
    { id: 'a7', label: 'Garbage-collector logs', group: 'Application',
      shows: 'Young-generation pauses of 6–12 ms, a few per minute, the same frequency and duration as last week. No full collections.',
      reads: 'GC pauses are a classic suspect for tail latency, but nothing changed here since before the regression. Not the cause.',
      key: false, herring: true },
    { id: 'a8', label: 'Node CPU utilisation', group: 'Node & host',
      shows: 'Nodes running pricing-api are 30–45% busy overall; CPU steal is 0; no other pod on those nodes is near its limits.',
      reads: 'The node has idle CPU. The container is not waiting because the machine is busy; it is waiting because its own quota ran out. That is the difference between contention (handled by requests/CPU weight) and throttling (caused by limits).',
      key: false, herring: false },
    { id: 'a9', label: 'Database latency and slow queries', group: 'Application',
      shows: 'Database p99 query time is flat at about 8 ms. The slow query log has three entries, all from the nightly report job at 02:00.',
      reads: 'The dependency is healthy and the slow queries are at a different time. Not related.',
      key: false, herring: true },
    { id: 'a10', label: 'Memory usage and OOM events', group: 'Workload',
      shows: 'Working set about 1.1 GiB against a 2 GiB limit; no OOMKilled in any container\'s last state; 0 restarts.',
      reads: 'The memory limit is not a factor. Rules out the other half of yesterday\'s change.',
      key: false, herring: false },
    { id: 'a11', label: 'Run one replica without the CPU limit (canary)', group: 'Workload',
      shows: 'With approval, one extra replica runs with the CPU limit removed and the request unchanged. Over 30 minutes it shows p99 of 105 ms and zero throttled periods, while its siblings stay at about 330 ms.',
      reads: 'A controlled experiment that changes one variable and confirms the hypothesis directly.',
      key: false, herring: false }
  ],
  efficient: ['a1', 'a2', 'a3', 'a4', 'a6'],
  cause: 'The new 1-CPU limit enforces a CFS quota of 100 ms of CPU time per 100 ms period. The service\'s 16 worker threads burn through that quota in a few milliseconds during bursts, and the container is then throttled for the rest of the period. Average usage stays below the limit, but requests that arrive during those pauses wait — raising p99 while p50 barely moves.',
  mechanism: 'On Linux, a Kubernetes CPU limit is enforced by the kernel\'s CFS bandwidth control: the container\'s cgroup gets a quota of CPU time per period (by default 100 ms). All threads in the cgroup share that quota. When it is used up, every thread is paused until the next period starts. A CPU request, by contrast, sets the container\'s relative weight when CPU is contended and is what the scheduler uses for placement; it does not cap usage.\n\nBecause the quota is measured per period, bursty multi-threaded work can be throttled heavily while average usage looks comfortable. Averages over seconds or minutes cannot show 100 ms-scale stalls; throttling counters (nr_throttled, throttled time) can. A worker pool sized from the host\'s CPU count, not the container\'s budget, makes the effect worse.',
  fix: 'For this latency-sensitive service, remove the CPU limit or raise it well above the burst need, keep the CPU request accurate (it still guarantees a share under contention), and size the worker pool to the CPU budget. Do it through the platform policy\'s exception process, one service at a time, starting with a canary replica and comparing it to its siblings. Whether to use CPU limits at all is a real debate: some teams keep them for predictability, multi-tenant fairness or chargeback, others avoid them because requests already protect each workload under contention and limits can throttle on an otherwise idle node — both are defensible if you can explain the trade-off. Do not roll back the whole platform policy for every workload without its owners (the memory limits are likely useful), and do not treat adding replicas as the fix; it may lower per-pod load but leaves the stall pattern in place.',
  verify: 'Throttled-period ratio drops to near zero for pricing-api, and p99 returns to about 110 ms during the same top-of-minute bursts, compared over a comparable traffic window. Check the two other services with smaller regressions for the same throttling signature.',
  followups: [
    { q: 'Would you set CPU limits at all? Defend your answer.', guidance: 'A good answer states the trade-off rather than a slogan: limits give predictability and fairness and are sometimes required for chargeback or Guaranteed QoS; they cause throttling even on idle nodes. Requests set scheduling and share under contention. Many teams set requests on everything, memory limits on everything, and CPU limits selectively or with generous headroom.' },
    { q: 'What changes if the pod is Guaranteed QoS with integer CPUs and the static CPU manager policy?', guidance: 'With the static policy, a Guaranteed pod requesting whole CPUs can get exclusive cores, which avoids sharing with noisy neighbours. It still has a limit equal to its request, so sizing threads to the allocation still matters. It is a node-level kubelet setting, not a pod field.' },
    { q: 'How would you have caught this during the platform-wide rollout?', guidance: 'Roll the policy out in waves with a bake period, watch tail latency and throttling ratios per workload, alert when throttling crosses a threshold, and have an exception path ready for latency-sensitive services.' }
  ],
  rubric: {
    strong: [
      'Treats "only added limits" as the leading hypothesis despite average CPU looking fine',
      'Explains CFS quota per period and why averages hide throttling',
      'Asks for throttling counters and relates thread count to quota',
      'Separates contention (requests/weight) from throttling (limits)',
      'Proposes a scoped, canaried change and states the CPU-limits trade-off honestly'
    ],
    acceptable: [
      'Runs a canary without the limit first to confirm, then explains the mechanism',
      'Keeps a CPU limit but raises it and sizes the thread pool to it'
    ],
    redFlags: [
      'Concludes limits are irrelevant because average usage is below the limit',
      'Chases GC or the database without evidence of change',
      'Rolls back the platform policy cluster-wide without the owners',
      'States as absolute fact that CPU limits should never be used'
    ]
  },
  lessons: ['les-resources'],
  questions: ['ons-q-trouble-02', 'ons-q-design-06'],
  alsoPractise: [{ track: 'containers', what: 'Requests vs limits scenarios: compare live usage against the limit on the container' }],
  refs: [
    { t: 'Resource Management for Pods and Containers', u: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/' },
    { t: 'Control CPU Management Policies on the Node', u: 'https://kubernetes.io/docs/tasks/administer-cluster/cpu-management-policies/' }
  ],
  verify_note: 'Throttling metric names (container_cpu_cfs_throttled_periods_total etc.) come from cAdvisor via the kubelet and may differ in your monitoring stack. cpu.max/cpu.stat are cgroup v2; cgroup v1 uses cpu.cfs_quota_us, cpu.cfs_period_us and cpu.stat with throttled_time. The 100 ms CFS period is the usual default. Kernel features such as CFS burst vary by kernel version.'
});

/* ---------------------------------------------------------------- case 08 */
LX.onsiteCases.push({
  id: 'ons-case-08', track: 'onsite', title: 'New pods not appearing across several namespaces', domain: 'kubernetes',
  level: 3, mins: 15,
  opening: 'Several teams say their deployments are stuck this morning: new versions never start, and scaling up does nothing. Existing pods are still running and serving traffic, so users are not affected yet.',
  context: 'A shared cluster with about 30 application namespaces. The platform team runs several cluster add-ons, including a policy engine that validates pod specs through an admission webhook. Add-ons are deployed from Git by a GitOps controller.',
  asks: [
    { id: 'a1', label: 'What changed recently?', group: 'Scope & changes',
      shows: 'At 09:10 the platform team upgraded the policy engine to a new release. Yesterday the monitoring stack was upgraded. The first "deployment stuck" report came in at about 09:15.',
      reads: 'The policy engine upgrade is minutes before the first report and is an admission component — exactly the kind of thing that can block pod creation cluster-wide. The monitoring upgrade was a day earlier; note it but it fits the timing less well.',
      key: true, herring: false },
    { id: 'a2', label: 'Who / what is affected (scope)?', group: 'Scope & changes',
      shows: 'Teams in payments, orders and search report stuck deployments; checking others, every application namespace is affected. kube-system workloads appear unaffected. A node was drained for patching at 09:30 and its pods have not come back anywhere.',
      reads: 'Cluster-wide for pod creation, with kube-system exempt — a pattern that suggests a cluster-level control with a namespace scope. The drained node raises the stakes: capacity is quietly shrinking, because nothing that is removed can be replaced.',
      key: true, herring: false },
    { id: 'a3', label: 'Deployment and ReplicaSet status', group: 'Workload',
      shows: '$ kubectl get deploy,rs -n orders\nNAME                         READY   UP-TO-DATE   AVAILABLE   AGE\ndeployment.apps/orders-api   3/4     0            3           41d\nNAME                                   DESIRED   CURRENT   READY   AGE\nreplicaset.apps/orders-api-5c7f9b8d6   1         0         0       22m\nreplicaset.apps/orders-api-7b8c6d5f4   3         3         3       6d\n$ kubectl get pods -n orders --field-selector=status.phase=Pending\nNo resources found in orders namespace.',
      reads: 'The new ReplicaSet wants 1 pod and has 0 — and there are no Pending pods. The pod objects are never being created, so the scheduler is not involved. Pod creation is being rejected at the API server; the ReplicaSet\'s events will say why.',
      key: true, herring: false },
    { id: 'a4', label: 'Events on the new ReplicaSet', group: 'Workload',
      shows: '$ kubectl describe rs orders-api-5c7f9b8d6 -n orders   (events excerpt)\n  Warning  FailedCreate  3m (x19 over 22m)  replicaset-controller  Error creating: Internal error occurred: failed calling webhook "pods.validate.policy.example.com": failed to call webhook: Post "https://policy-webhook.policy-system.svc:443/validate-pods?timeout=10s": no endpoints available for service "policy-webhook"',
      reads: 'The API server tried to call the validating webhook for the pod create, could not reach any backend ("no endpoints available"), and rejected the request. The webhook is not denying pods on policy grounds — it is unavailable, and the configuration fails closed.',
      key: true, herring: false },
    { id: 'a5', label: 'Webhook configurations in the cluster', group: 'Platform',
      shows: '$ kubectl get validatingwebhookconfiguration policy-engine -o yaml   (excerpt)\nwebhooks:\n- name: pods.validate.policy.example.com\n  clientConfig:\n    service: {namespace: policy-system, name: policy-webhook, path: /validate-pods, port: 443}\n  failurePolicy: Fail\n  rules:\n  - apiGroups: [""]\n    apiVersions: ["v1"]\n    operations: ["CREATE", "UPDATE"]\n    resources: ["pods"]\n  namespaceSelector:\n    matchExpressions:\n    - key: kubernetes.io/metadata.name\n      operator: NotIn\n      values: ["kube-system", "policy-system"]\n  timeoutSeconds: 10',
      reads: 'failurePolicy: Fail on every pod CREATE/UPDATE outside kube-system and policy-system. That explains the scope exactly. Importantly, the webhook\'s own namespace is excluded, so its pods can still be created — recovery is possible without touching this configuration.',
      key: true, herring: false },
    { id: 'a6', label: 'The webhook\'s pods and endpoints', group: 'Platform',
      shows: '$ kubectl get pods -n policy-system\nNAME                             READY   STATUS             RESTARTS      AGE\npolicy-webhook-6f9d7b5c8-h2m4q   0/1     CrashLoopBackOff   9 (2m ago)    24m\npolicy-webhook-6f9d7b5c8-tx8wn   0/1     CrashLoopBackOff   9 (1m ago)    24m\n$ kubectl get endpointslices -n policy-system -l kubernetes.io/service-name=policy-webhook -o jsonpath=\'{range .items[*].endpoints[*]}{.addresses[0]} ready={.conditions.ready}{"\\n"}{end}\'\n10.244.5.31 ready=false\n10.244.2.18 ready=false\n$ kubectl get deploy policy-webhook -n policy-system -o jsonpath=\'{.spec.strategy.type}\'\nRecreate',
      reads: 'Both replicas of the new release are crash-looping, so the Service has no ready endpoints. The Deployment uses the Recreate strategy, so the old, working pods were stopped before the new ones started — nothing was left serving. CrashLoopBackOff is a back-off state, not a cause; the cause is in the previous container\'s logs.',
      key: true, herring: false },
    { id: 'a7', label: 'Logs from the crashing webhook pods', group: 'Application',
      shows: '$ kubectl logs -n policy-system policy-webhook-6f9d7b5c8-h2m4q --previous\n{"level":"info","msg":"starting policy engine","version":"3.4.0"}\n{"level":"info","msg":"loading policies","path":"/etc/policy/bundles"}\n{"level":"fatal","msg":"failed to load policy bundle","error":"open /etc/policy/bundles/bundle.tar.gz: no such file or directory"}\n$ kubectl describe pod ... | grep -A3 "Last State"\n    Last State:  Terminated\n      Reason:    Error\n      Exit Code: 1',
      reads: 'The new release looks for its policy bundle at a path the deployed configuration does not provide, and exits. A configuration mismatch introduced by the upgrade — the reason the webhook has no endpoints.',
      key: true, herring: false },
    { id: 'a8', label: 'ResourceQuota in the affected namespaces', group: 'Workload',
      shows: '$ kubectl describe resourcequota -n orders\nResource         Used  Hard\n--------         ----  ----\npods             7     50\nrequests.cpu     3     20\nrequests.memory  6Gi   40Gi',
      reads: 'Plenty of headroom. Quota rejections also show up as FailedCreate, but with "exceeded quota" in the message. Not the cause.',
      key: false, herring: true },
    { id: 'a9', label: 'Node capacity and the scheduler', group: 'Node & host',
      shows: 'Nodes are about 55% requested on CPU and memory. There are no Pending pods anywhere in the cluster, and the cluster autoscaler has nothing to do.',
      reads: 'Capacity would matter for Pending pods, but these pods never exist, so the scheduler is never asked. Not the cause.',
      key: false, herring: true },
    { id: 'a10', label: 'API server health and logs', group: 'Platform',
      shows: '$ kubectl get --raw=\'/readyz?verbose\' | tail -2\n[+]poststarthook/... ok\nreadyz check passed\n(API server logs, excerpt)\nFailed calling webhook, failing closed pods.validate.policy.example.com: failed calling webhook "pods.validate.policy.example.com": failed to call webhook: Post "https://policy-webhook.policy-system.svc:443/validate-pods?timeout=10s": no endpoints available for service "policy-webhook"',
      reads: 'The API server itself is healthy and states plainly that it is failing closed on this webhook. Confirms the path.',
      key: false, herring: false },
    { id: 'a11', label: 'The monitoring stack upgrade', group: 'Platform',
      shows: 'The monitoring upgrade yesterday replaced the metrics agents; all its pods are healthy. It does not register any admission webhooks (kubectl get validatingwebhookconfigurations,mutatingwebhookconfigurations shows none from it).',
      reads: 'A recent change, but it cannot intercept pod creation and it happened a day before the problem. Not related.',
      key: false, herring: true },
    { id: 'a12', label: 'Who owns the webhook, and how is it deployed?', group: 'Platform',
      shows: 'The policy engine is owned by the platform security team and deployed from a Git repository by a GitOps controller; the webhook configuration is part of the same release. Live kubectl edits will be reverted at the next sync unless the change goes through Git or the sync is paused.',
      reads: 'Any fix should go through the source of truth, with the owning team, or it will be undone — and lowering a security control needs their agreement.',
      key: false, herring: false }
  ],
  efficient: ['a1', 'a3', 'a4', 'a6', 'a7'],
  cause: 'The policy engine upgrade introduced a configuration mismatch that makes its webhook pods crash on start. With the Recreate strategy, no working replica remained, so the webhook Service has no ready endpoints. Because the ValidatingWebhookConfiguration uses failurePolicy: Fail for all pod creates outside two namespaces, the API server rejects every new pod, and ReplicaSets across the cluster fail to create pods.',
  mechanism: 'When a request to create a pod reaches the API server, it passes through admission: built-in controllers, then any matching mutating and validating webhooks. For each matching webhook, the API server calls the backing Service. If the call fails (no endpoints, timeout, TLS error), failurePolicy decides the outcome: Fail rejects the request (fail-closed), Ignore lets it through without the check (fail-open).\n\nExisting pods keep running because the webhook only intercepts CREATE and UPDATE — nothing checks running pods. But anything that needs a new pod — rollouts, scale-ups, rescheduling after a drain or node failure — silently stops. The namespaceSelector exclusion of policy-system is what keeps this recoverable: without it, the webhook would block creation of its own pods, a deadlock.',
  fix: 'Restore the webhook backend by rolling back the policy engine release to the previous version through its source of truth (revert in Git so the GitOps controller applies it), working with the owning team. Because policy-system is excluded from the webhook, the rolled-back pods can be created. This touches one add-on in one namespace and restores both pod creation and policy enforcement. If rollback cannot happen quickly and the impact is growing (for example the drained node\'s pods), a time-boxed, approved change to failurePolicy: Ignore or a narrower namespaceSelector for critical namespaces is an option — made through Git, with a record of which pods were admitted unchecked so they can be reviewed. Do not delete the ValidatingWebhookConfiguration (it silently removes a security control, the GitOps controller may fight you, and it is easy to forget to restore), and do not restart the API server or mass-restart workloads.',
  verify: 'The webhook EndpointSlice shows ready endpoints. A server-side dry run of a normal pod in an affected namespace (kubectl apply --dry-run=server) succeeds, and a known-bad pod spec is still denied — proving enforcement is back, not just bypassed. ReplicaSets reach their desired counts, FailedCreate events stop, and the drained node\'s workloads are running again.',
  followups: [
    { q: 'What if the webhook\'s own namespace had not been excluded?', guidance: 'Deadlock: the webhook pods cannot be created because creating them requires the webhook. Recovery needs a change to the webhook configuration itself (exclude its namespace, or temporarily set failurePolicy: Ignore) — which is why good practice excludes the webhook\'s namespace and critical system namespaces.' },
    { q: 'Fail-open or fail-closed: how do you choose?', guidance: 'Fail-closed protects the policy (nothing unchecked runs) but makes the webhook a hard dependency for all pod creation; fail-open keeps the cluster operating but lets unchecked workloads in during an outage. Security-critical checks usually fail closed, which means the webhook must be run like critical infrastructure: multiple replicas, RollingUpdate, PodDisruptionBudget, readiness probes, careful scoping, short timeouts and alerting.' },
    { q: 'How would you detect this before teams notice?', guidance: 'Alert on the webhook Service having no ready endpoints, on API server admission webhook error/rejection metrics, and on FailedCreate events. Run a periodic synthetic server-side dry-run pod create. Upgrade the add-on in a staging cluster first and gate the rollout on those checks.' }
  ],
  rubric: {
    strong: [
      'Notices no Pending pods and moves from scheduling to admission',
      'Reads ReplicaSet FailedCreate events and identifies the unreachable webhook',
      'Checks failurePolicy and namespaceSelector to explain scope and recoverability',
      'Finds why the webhook has no endpoints (crashing new release, Recreate strategy) using logs --previous',
      'Restores the backend via the source of truth and verifies enforcement still works'
    ],
    acceptable: [
      'Starts from the API server logs or webhook configuration list and works to the backend',
      'Uses a time-boxed, approved fail-open or scoped exclusion when rollback is not quick, with an audit afterwards'
    ],
    redFlags: [
      'Deletes the webhook configuration as the fix',
      'Chases quotas or node capacity when no pods are Pending',
      'Treats CrashLoopBackOff as the root cause without reading the logs',
      'Makes live edits a GitOps controller will revert and assumes the problem is solved'
    ]
  },
  lessons: ['les-reconcile', 'les-workloads', 'les-rollouts'],
  questions: ['ons-q-trouble-04', 'ons-q-delivery-05', 'ons-q-design-01'],
  alsoPractise: [],
  refs: [
    { t: 'Dynamic Admission Control', u: 'https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/' },
    { t: 'Admission Webhook Good Practices', u: 'https://kubernetes.io/docs/concepts/cluster-administration/admission-webhooks-good-practices/' }
  ],
  verify_note: 'The exact FailedCreate and API server log wording for webhook failures varies by Kubernetes version. Admission webhook metric names (for example apiserver_admission_webhook_rejection_count) depend on version. Server-side dry run calls webhooks only if they declare sideEffects None or NoneOnDryRun.'
});
