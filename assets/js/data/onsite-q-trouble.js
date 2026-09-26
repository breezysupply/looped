/* Onsite track — troubleshooting questions (topic: trouble).
   Mechanism first, then the evidence that proves it. Say the answer out loud before you expand it. */
window.LX = window.LX || {};
LX.onsiteQ = LX.onsiteQ || [];
LX.onsiteQ.push(

/* ── 01 Pending pods ─────────────────────────────────────────── */
{ id: 'ons-q-trouble-01', track: 'onsite', topic: 'trouble', priority: 'P0', level: 1, mins: 4,
  prereqs: ['les-scheduling', 'les-pod-lifecycle', 'les-resources'],
  labs: ['ons-lab-05', 'ons-lab-08'],
  q: 'Why might a Pod remain Pending?',
  context: 'A Deployment was scaled up and one new pod has shown Pending for several minutes. Nothing else changed. You have read access to the namespace and the nodes.',
  evaluates: [
    'Splits Pending into "not yet scheduled" and "scheduled but containers not started" before guessing',
    'Knows the scheduler compares requests to node allocatable, not to live usage',
    'Can decode a FailedScheduling message into its separate reasons',
    'Knows quota rejection happens at admission, so no pod exists to be Pending',
    'Goes to evidence (describe, events, node view) before changing anything'
  ],
  spoken: 'Pending is a phase, not a diagnosis, so first I split it in two. `kubectl get pod -o wide`: if NODE is empty, the scheduler has not placed it. If a node is set, it was scheduled and something before container start is stuck, usually an image pull, a volume mount or an init container.\n\nFor an unscheduled pod I read the FailedScheduling event in `describe`. It reads like "0/3 nodes are available", followed by a count per reason. The usual reasons are: not enough allocatable CPU or memory for the pod\'s requests, which is bookkeeping and not live usage; a nodeSelector or affinity that no node matches; a taint the pod does not tolerate; or a PersistentVolumeClaim that is unbound or whose volume is pinned to a zone with no fitting node.\n\nOne thing that does not show as Pending is a ResourceQuota rejection. That happens at admission, so the pod is never created, and the error shows up as a FailedCreate event on the ReplicaSet. Once I know which case I am in, the fix is usually one of three things: change the requests, change the placement rules, or add capacity.',
  deep: '**Two different kinds of Pending.** The Pending phase means the API accepted the pod but at least one container has not been set up to run. That includes the time spent waiting for the scheduler and the time spent pulling images and mounting volumes after scheduling. The first thing to look at is `spec.nodeName` (NODE in `-o wide`). If it is empty, this is a scheduling problem and the scheduler owns it. If it is set, the kubelet on that node owns it, and STATUS usually tells you more: `ContainerCreating`, `Init:0/1`, `ErrImagePull`/`ImagePullBackOff`. The phase is still Pending in every one of those cases.\n\n**How the scheduler decides.** For each pending pod, the scheduler filters out nodes that cannot run it, scores the rest and binds the pod to the best one. Filtering looks at: the sum of requests of pods already bound to the node, compared with the node\'s allocatable (capacity minus system and kubelet reservations); nodeSelector and required node affinity; taints without a matching toleration; pod affinity/anti-affinity and topology spread constraints; host port conflicts; and volume constraints (the PVC must be bound or bindable, and the volume\'s node affinity must match). A node at 10% real CPU can still be full, because requests are what count. If no node passes, the pod stays Pending, the scheduler retries, and it records a FailedScheduling event. If the pod has a priority, preemption may try to make room.\n\n**Reading the message.** `0/3 nodes are available: 1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }, 2 Insufficient memory.` means every node was filtered out, and it gives the count per reason. The counts add up to the node total. Fix the biggest group first, and do not "fix" the taint on a control-plane node that should not run workloads. With volumes you will see messages like `pod has unbound immediate PersistentVolumeClaims` or `node(s) had volume node affinity conflict`. The second one usually means a zonal volume lives in a zone where no node has room.\n\n**Things that look similar but are not scheduler problems.** A ResourceQuota or a LimitRange violation, or a denial by a policy admission controller, rejects the create call itself. The ReplicaSet shows `FailedCreate` and the pod count stays low, with no Pending pod anywhere. A missing ConfigMap volume or a slow image pull happens after scheduling, so NODE is populated. Cluster autoscaling, if present, reacts to unschedulable pods. A Pending pod that clears on its own after a few minutes may have been waiting for a new node.',
  followups: [
    { q: 'The event says "Insufficient cpu" but `kubectl top nodes` shows every node under 30% CPU. Explain.',
      guidance: 'The scheduler compares the sum of requests against allocatable. It does not look at live usage. Show `describe node` → Allocated resources to prove the requests are near 100%. The fix is to right-size requests (often inflated), add capacity, or accept overcommit through limits. A good answer does not "fix" this by removing requests.' },
    { q: 'The pod has a node assigned but has been Pending for ten minutes. What now?',
      guidance: 'That means it was scheduled, so look at the kubelet side: events for FailedMount/FailedAttachVolume, image pull errors, init containers (`Init:` status and `logs -c <init>`). Check whether the node itself is healthy (NotReady nodes do not start pods). Scheduling is no longer the issue.' },
    { q: 'How would you make sure a critical pod gets scheduled on a full cluster, and what are the risks?',
      guidance: 'A PriorityClass lets the scheduler preempt lower-priority pods. Mention that victims get graceful termination and that PodDisruptionBudgets are respected on a best-effort basis only. The risk is displacing other workloads and hiding a capacity problem. Alternatives are reserved capacity, dedicated tainted nodes with tolerations, and autoscaling.' }
  ],
  misconceptions: [
    '"Pending means the scheduler could not place it." Pending also covers pods that are scheduled but still pulling images or mounting volumes. Check NODE first.',
    '"The node has free CPU, so the pod should fit." Scheduling uses requests against allocatable, not measured usage.',
    '"A ResourceQuota violation leaves the pod Pending." Quota is checked at admission, so the pod is never created. The error is a FailedCreate on the ReplicaSet.',
    '"Removing the taint fixes it." Taints are usually deliberate (control plane, dedicated or unhealthy nodes). Add a toleration only if the workload really belongs there.'
  ],
  weak: [
    'Lists causes from memory without saying how to tell which one applies',
    'Jumps to "add more nodes" without reading the FailedScheduling message',
    'Deletes and recreates the pod hoping it lands somewhere else',
    'Treats ContainerCreating and unscheduled Pending as the same problem'
  ],
  evidence: '# example output\n$ kubectl get pod web-7d9f6c-x2k4p -o wide\nNAME               READY   STATUS    RESTARTS   AGE   IP       NODE\nweb-7d9f6c-x2k4p   0/1     Pending   0          7m    <none>   <none>\n\n$ kubectl describe pod web-7d9f6c-x2k4p | sed -n \'/^Events/,$p\'\nEvents:\n  Type     Reason            From               Message\n  Warning  FailedScheduling  default-scheduler  0/3 nodes are available: 1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }, 2 Insufficient memory. preemption: 0/3 nodes are available: 1 Preemption is not helpful for scheduling, 2 No preemption victims found for incoming pod.\n\n$ kubectl describe node worker-2 | grep -A5 "Allocated resources"\nAllocated resources:\n  Resource  Requests       Limits\n  cpu       1850m (92%)    3 (150%)\n  memory    3700Mi (95%)   5Gi (131%)\n\n# quota rejections show on the ReplicaSet, not a pod\n$ kubectl describe rs web-7d9f6c | grep FailedCreate\n  Warning  FailedCreate  replicaset-controller  Error creating: pods "web-7d9f6c-q8z1n" is forbidden: exceeded quota: team-quota, requested: requests.memory=2Gi, used: requests.memory=19Gi, limited: requests.memory=20Gi',
  rubric: {
    strong: [
      'Checks NODE to separate unscheduled from scheduled-but-not-started',
      'Decodes FailedScheduling into its reasons and counts',
      'Explains that requests are compared to allocatable, not usage',
      'Covers placement rules, taints and volume binding/topology',
      'Separates admission-time quota rejection (FailedCreate) from Pending'
    ],
    acceptable: [
      'Starts from `kubectl get events --sort-by=.lastTimestamp` instead of describe, as long as it reaches the same reasons',
      'Mentions cluster autoscaler behaviour as context without leaning on it'
    ],
    redFlags: [
      'Claims Pending always means the scheduler failed',
      'Removes taints or requests cluster-wide to make one pod fit',
      'Says quota exhaustion shows as a Pending pod'
    ]
  },
  aws: { analogy: 'An ECS task stuck in PROVISIONING/PENDING because no container instance has enough registered CPU/memory, or a placement constraint cannot be satisfied.',
    breaks: 'ECS reports placement failures as a service event on the service. Kubernetes records a FailedScheduling event on the pod and keeps retrying. Kubernetes also has taints/tolerations, volume topology and priority preemption, which ECS placement does not model the same way, and its Pending phase also covers post-scheduling image pulls.' },
  refs: [
    { t: 'Kubernetes Scheduler', u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/' },
    { t: 'Debug Pods', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/' },
    { t: 'Pod Lifecycle', u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/' }
  ],
  verify: 'Exact FailedScheduling wording (including the preemption suffix) varies by scheduler version.'
},

/* ── 02 Requests and limits ──────────────────────────────────── */
{ id: 'ons-q-trouble-02', track: 'onsite', topic: 'trouble', priority: 'P0', level: 1, mins: 4,
  prereqs: ['les-resources'],
  labs: ['ons-lab-05', 'ons-lab-07'],
  q: 'What do resource requests and limits do?',
  context: 'You are reviewing a Deployment manifest that sets CPU and memory requests and limits. The interviewer wants the mechanism at scheduling time and at runtime.',
  evaluates: [
    'Separates scheduling (requests) from runtime enforcement (limits)',
    'Knows CPU over limit is throttled while memory over limit is OOM-killed',
    'Can name the QoS classes and say how they are derived',
    'Connects requests/QoS to node-pressure eviction order',
    'Gives a nuanced view on CPU limits instead of a slogan'
  ],
  spoken: 'Requests and limits act at two different times. The scheduler uses requests: a pod goes only on a node whose allocatable capacity, minus the requests of pods already there, covers it. It is bookkeeping, not measured usage. At runtime, the CPU request becomes a relative weight in the cgroup, so under contention a container gets CPU roughly in proportion to its request.\n\nLimits are enforced by the kernel through cgroups. Over the CPU limit, the container is throttled for the rest of each scheduling period. That shows up as latency, not a restart. Over the memory limit, the kernel\'s OOM killer kills a process in that container\'s cgroup, and Kubernetes reports OOMKilled.\n\nRequests and limits together define the QoS class. Guaranteed means every container has requests equal to limits for CPU and memory. Burstable means some requests are set. BestEffort means none. When a node runs short of memory, the kubelet evicts pods that are over their requests first, so honest requests protect you. On CPU limits, teams disagree. Some drop them for latency-sensitive services to avoid throttling, others keep them for predictability. I would decide per workload from throttling metrics.',
  deep: '**Requests: placement and fair share.** The scheduler sums the requests of all containers in a pod (plus init-container rules and any pod overhead) and filters out nodes where `allocatable − sum(existing requests)` is too small. Live usage is not considered. On the node, the CPU request is translated into a cgroup CPU weight (cpu.shares on cgroup v1, cpu.weight on v2). That only matters under contention, when CPU time is split in proportion to the weights. The memory request is not a runtime reservation in the usual configuration. It feeds the scheduler, the eviction ranking and the OOM score adjustment.\n\n**Limits: kernel enforcement.** The container runtime writes limits into the container\'s cgroup. A CPU limit becomes a CFS quota: in each period (100 ms by default), the container may use `limit × period` of CPU time and is then paused until the next period. A multi-threaded process can burn its quota early in the period and stall, which is why a pod can show throttling at low average CPU. A memory limit becomes the cgroup memory maximum. When the cgroup cannot reclaim below it, the kernel OOM killer kills a process in that cgroup and the container status shows `Reason: OOMKilled`, exit code 137. Memory is not throttled in the default configuration.\n\n**QoS classes.** Guaranteed: every container sets CPU and memory limits, and requests equal limits (if you set only limits, requests default to them). Burstable: at least one request or limit is set, but not the Guaranteed shape. BestEffort: nothing is set. The kubelet sets each container\'s `oom_score_adj` by class, so under node-level OOM BestEffort goes first and Guaranteed last. Node-pressure eviction first ranks pods whose usage exceeds their requests, then orders by priority and by how far over request they are.\n\n**The CPU-limit debate.** Without a CPU limit, a container can use idle CPU on the node. Its request still guarantees its share under contention. With a limit, you get a hard ceiling and more predictable neighbours, at the cost of throttling. A reasonable default is: always set memory requests and limits, always set CPU requests, and set CPU limits where you need hard isolation or chargeback. Check `nr_throttled`/`throttled_usec` before and after. LimitRange objects can inject defaults, so check what the cluster adds.',
  followups: [
    { q: 'A service has p99 latency spikes, CPU usage averages 30% of its limit, and nothing restarts. What do you suspect and how do you prove it?',
      guidance: 'Suspect CFS throttling: bursts that use up the quota inside each period. Prove it with the cgroup `cpu.stat` (nr_throttled, throttled_usec) or a container throttling metric, and correlate it with latency. Options are raising or removing the CPU limit, tuning thread pools, or both. Averages hide throttling.' },
    { q: 'What happens if you set a memory limit but no memory request?',
      guidance: 'The request defaults to the limit (unless a LimitRange default changes it), so the scheduler reserves the full limit. If CPU is also only limited, the pod may end up Guaranteed. Knowing this avoids surprise over-reservation.' },
    { q: 'How would you choose requests for a new service with no history?',
      guidance: 'Start from load-test or staging measurements. Set memory request near steady-state working set and the limit with headroom for peaks. Set CPU request near typical usage. Then iterate from production metrics, for example percentiles over a week. A recommender tool can suggest values, but its output should be reviewed by a person.' }
  ],
  misconceptions: [
    '"Requests reserve resources based on current usage." They are declarations the scheduler adds up. Usage is not considered.',
    '"Exceeding a CPU limit kills the container." CPU is throttled. Only memory over the limit leads to an OOM kill.',
    '"A memory request guarantees that memory at runtime." By default it guides scheduling, eviction ranking and OOM scoring. It is not a hard reservation.',
    '"Every pod should always have a CPU limit." It depends on the workload. Throttling can hurt latency-sensitive services.'
  ],
  weak: [
    'Defines requests as "minimum" and limits as "maximum" and stops there',
    'Cannot say what happens at runtime when each is exceeded',
    'Does not mention QoS or eviction',
    'States one side of the CPU-limit debate as absolute truth'
  ],
  evidence: '# example output\n$ kubectl get pod api-5c7b9-lq2vx -o jsonpath=\'{.status.qosClass}{"\\n"}\'\nBurstable\n\n$ kubectl get pod api-5c7b9-lq2vx -o jsonpath=\'{.spec.containers[0].resources}{"\\n"}\'\n{"limits":{"cpu":"1","memory":"512Mi"},"requests":{"cpu":"250m","memory":"256Mi"}}\n\n$ kubectl top pod api-5c7b9-lq2vx\nNAME              CPU(cores)   MEMORY(bytes)\napi-5c7b9-lq2vx   310m         402Mi\n\n# cgroup v2: throttling counters inside the container\n$ kubectl exec api-5c7b9-lq2vx -- cat /sys/fs/cgroup/cpu.stat\nusage_usec 83412233\nnr_periods 51220\nnr_throttled 9120\nthrottled_usec 402118877',
  rubric: {
    strong: [
      'Requests drive scheduling against allocatable and CPU share under contention',
      'CPU over limit is throttled, memory over limit is OOM-killed by the kernel in the cgroup',
      'Names and derives the three QoS classes',
      'Links requests/QoS to eviction order and OOM scoring',
      'Treats CPU limits as a trade-off backed by measurement'
    ],
    acceptable: [
      'Explains enforcement in terms of cgroups without naming CFS quota specifically',
      'Recommends setting requests equal to limits for critical workloads (Guaranteed) with a stated reason'
    ],
    redFlags: [
      'Says CPU limit breaches cause restarts',
      'Says the scheduler places pods using live utilisation',
      'Recommends removing all requests to "fit more pods"'
    ]
  },
  aws: { analogy: 'ECS task- and container-level CPU units and memory / memoryReservation (soft) vs memory (hard) limits.',
    breaks: 'ECS memoryReservation is similar to a memory request and hard memory is similar to a limit, but ECS has no QoS classes and no kubelet eviction ranking. On Fargate the task size is a fixed allocation, not a shared node. Kubernetes CPU limits use CFS quota throttling per period, and CPU requests are relative weights.' },
  refs: [
    { t: 'Resource Management for Pods and Containers', u: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/' },
    { t: 'Pod Quality of Service Classes', u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/' },
    { t: 'Node-pressure Eviction', u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/' }
  ],
  verify: 'cgroup file names differ between cgroup v1 and v2; memory throttling via the MemoryQoS feature is feature-gated and version-dependent.'
},

/* ── 03 Probes ───────────────────────────────────────────────── */
{ id: 'ons-q-trouble-03', track: 'onsite', topic: 'trouble', priority: 'P0', level: 1, mins: 4,
  prereqs: ['les-probes', 'les-services'],
  labs: ['ons-lab-04'],
  q: 'How do readiness, liveness and startup probes differ?',
  context: 'A team is adding probes to a Java service that takes up to 90 seconds to start and calls a database on most requests. They ask what each probe should check.',
  evaluates: [
    'Readiness gates traffic via endpoints and never restarts anything',
    'Liveness failure causes the kubelet to restart the container',
    'Startup probe holds off the other two until it succeeds',
    'Can compute the time budget from periodSeconds and failureThreshold',
    'Warns against liveness checks that depend on downstream services'
  ],
  spoken: 'All three are checks the kubelet runs, but each one has a different consequence when it fails.\n\nReadiness decides traffic. When it fails, the pod\'s Ready condition goes false and the pod is marked not-ready in the Service\'s EndpointSlices, so it stops receiving load-balanced traffic. Nothing is restarted, so the pod can be Running and not Ready at the same time.\n\nLiveness decides restarts. When it fails failureThreshold times in a row, the kubelet kills the container and restarts it under the pod\'s restart policy. It should answer one question: is this process stuck beyond recovery?\n\nStartup is for slow starters. While it is configured and has not yet succeeded, liveness and readiness do not run. Once it succeeds it stops, and the other two take over. For this service I would give startup a budget of about failureThreshold 12 times periodSeconds 10, which is two minutes. Liveness would be a cheap in-process check, and readiness would say whether this instance can serve right now.\n\nThe classic mistake is a liveness probe that calls the database. The database blips, every pod fails liveness, and the kubelet restarts the whole fleet at once, which turns a dependency problem into an outage.',
  deep: '**Who runs them and what happens.** The kubelet runs probes against each container: an HTTP GET, a TCP connect, a gRPC health check, or an exec command. Each probe has `initialDelaySeconds`, `periodSeconds` (default 10), `timeoutSeconds` (default 1), `successThreshold` and `failureThreshold` (default 3).\n\n**Readiness** runs for the whole life of the container. Failure sets the container, and so the pod, Ready=False. The EndpointSlice controller marks the endpoint not ready, and kube-proxy or the dataplane stops sending Service traffic to it. There is no restart. That is why a rollout can stall with pods Running 0/1: the Deployment counts only Ready pods as available.\n\n**Liveness** failure (failureThreshold consecutive failures) makes the kubelet kill the container. It sends SIGTERM, waits for the grace period, then sends SIGKILL, and the container restarts per `restartPolicy`. Frequent liveness kills produce rising RESTARTS and can lead to CrashLoopBackOff. `Unhealthy` events name the probe type.\n\n**Startup**, if defined, disables liveness and readiness until it succeeds once. If it fails failureThreshold times, the kubelet kills the container just as a liveness failure would. The worst-case startup allowance is roughly `initialDelaySeconds + failureThreshold × periodSeconds`. This replaces the old habit of a huge liveness `initialDelaySeconds`, which also delayed detection of real hangs later.\n\n**Design guidance.** Liveness should check only the process itself (event loop responsive, not deadlocked) and should be cheap and tolerant: a few failures over tens of seconds, not one timeout. Readiness may include "can I serve", such as caches warmed or a required local dependency present. Be careful with shared dependencies even there: if every replica goes unready because the database blips, the Service has zero endpoints and callers get connection errors instead of a clear 503. Never point liveness at a downstream service. Remember that a successful rollout proves only that pods passed these probes, not that the application is correct.',
  followups: [
    { q: 'All pods of a service went unready at the same moment and the Service returned connection refused. What happened and how would you redesign it?',
      guidance: 'Readiness probably depended on a shared dependency, so every pod dropped out of the EndpointSlices together. Keep readiness about the local instance, handle dependency failure in the app with degraded responses, circuit breakers or clear 5xx, and alert on the dependency separately.' },
    { q: 'Liveness uses a 1-second timeout on an endpoint that does GC-heavy work. What will you see under load?',
      guidance: 'Timeouts under load produce liveness failures, then restarts, then less capacity, then more load: a restart storm. Evidence is Unhealthy events with timeout messages and restarts that line up with traffic peaks. The fix is a cheaper endpoint, longer timeout and threshold, and possibly no liveness probe at all if the process fails cleanly on its own.' },
    { q: 'How do probes interact with a rolling update\'s maxUnavailable and minReadySeconds?',
      guidance: 'New pods count as available only after being Ready for minReadySeconds. Until then the Deployment will not remove more old pods than maxUnavailable allows. A readiness probe that never passes therefore stalls the rollout while the old pods keep serving.' }
  ],
  misconceptions: [
    '"A failing readiness probe restarts the container." It only removes the pod from Service endpoints. Liveness (or a failed startup probe) causes restarts.',
    '"Running means Ready." A pod can be Running with 0/1 Ready and receive no Service traffic.',
    '"Liveness should check the database so we restart when it is down." Restarting the app does not fix the database and can restart every replica at once.',
    '"A long initialDelaySeconds on liveness is the way to handle slow starts." A startup probe does this without delaying hang detection for the rest of the container\'s life.'
  ],
  weak: [
    'Describes probes as interchangeable "health checks"',
    'Cannot say which component acts on each probe\'s result',
    'Never mentions thresholds or timing',
    'Recommends identical endpoints for liveness and readiness without thought'
  ],
  evidence: '# example output\n$ kubectl get pods -l app=orders\nNAME                      READY   STATUS    RESTARTS      AGE\norders-6f9d8b7c4-2mlq8    0/1     Running   0             4m\norders-6f9d8b7c4-9zt7x    1/1     Running   3 (52s ago)   4m\n\n$ kubectl describe pod orders-6f9d8b7c4-2mlq8 | grep -E "Readiness|Liveness|Startup|Unhealthy"\n    Liveness:   http-get http://:8080/livez delay=0s timeout=1s period=10s #success=1 #failure=3\n    Readiness:  http-get http://:8080/readyz delay=0s timeout=1s period=5s #success=1 #failure=3\n    Startup:    http-get http://:8080/livez delay=0s timeout=1s period=10s #success=1 #failure=12\n  Warning  Unhealthy  kubelet  Readiness probe failed: HTTP probe failed with statuscode: 503\n\n$ kubectl describe pod orders-6f9d8b7c4-9zt7x | grep -A1 Unhealthy\n  Warning  Unhealthy  kubelet  Liveness probe failed: Get "http://10.244.1.17:8080/livez": context deadline exceeded\n  Normal   Killing    kubelet  Container orders failed liveness probe, will be restarted\n\n$ kubectl get endpointslices -l kubernetes.io/service-name=orders -o jsonpath=\'{range .items[*].endpoints[*]}{.addresses[0]} ready={.conditions.ready}{"\\n"}{end}\'\n10.244.2.9 ready=false\n10.244.1.17 ready=true',
  rubric: {
    strong: [
      'Readiness → endpoints/traffic only; liveness → kubelet restart; startup → gates the others',
      'Computes the startup budget from failureThreshold × periodSeconds',
      'Warns that liveness must not depend on downstream services',
      'Explains that Running is not Ready and what that means for Services',
      'Connects readiness to rollout progress'
    ],
    acceptable: [
      'Chooses to omit liveness for a process that exits cleanly on fatal errors, with that reasoning stated',
      'Uses exec or gRPC probes instead of HTTP with a clear reason'
    ],
    redFlags: [
      'Says readiness failure restarts the pod',
      'Puts a database query in the liveness probe',
      'Treats Running as proof the service is taking traffic'
    ]
  },
  aws: { analogy: 'ALB target group health checks (traffic) vs ECS container health checks that make ECS replace an unhealthy task.',
    breaks: 'In ECS, a failing ALB health check can also cause ECS to replace the task, because the service scheduler acts on it. Kubernetes readiness never restarts anything. ECS has a health check grace period instead of a separate startup probe. Kubernetes probes are run by the kubelet on the node, not by the load balancer.' },
  refs: [
    { t: 'Liveness, Readiness, and Startup Probes', u: 'https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/' },
    { t: 'Configure Liveness, Readiness and Startup Probes', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/' }
  ],
  verify: 'Probe field defaults (period 10s, timeout 1s, failureThreshold 3) — confirm for your cluster version.'
},

/* ── 04 Stalled rollout ──────────────────────────────────────── */
{ id: 'ons-q-trouble-04', track: 'onsite', topic: 'trouble', priority: 'P0', level: 2, mins: 5,
  prereqs: ['les-rollouts', 'les-probes', 'ons-q-trouble-03'],
  labs: ['ons-lab-02'],
  q: 'Why might a rollout stall while old replicas remain healthy?',
  context: 'A Deployment update was applied 15 minutes ago. `kubectl rollout status` is still waiting, users see no errors, and the old pods are serving normally.',
  evaluates: [
    'Explains why maxUnavailable/maxSurge keep old pods serving',
    'Enumerates reasons new pods never become Ready or never get created',
    'Knows progressDeadlineSeconds reports a condition and does not roll back',
    'Looks at the new ReplicaSet\'s events for admission/quota failures',
    'Chooses between rolling back and fixing forward with a reason'
  ],
  spoken: 'This is the rolling update doing its job. With the default strategy, the Deployment creates a new ReplicaSet and only scales the old one down as new pods become available, which means Ready for minReadySeconds. With maxUnavailable at zero, or a small value, the old pods keep serving while the new ones never qualify. That is why users see nothing.\n\nSo the question becomes: why are the new pods not available? I check the new ReplicaSet and its pods. If the pods exist, they may be in ImagePullBackOff, CrashLoopBackOff, Running but failing readiness, or Pending because the surge pod cannot be scheduled. If the pods do not exist at all, I describe the ReplicaSet. A FailedCreate event there means admission refused them, for example quota, a policy controller or a missing ServiceAccount.\n\nAfter progressDeadlineSeconds, 600 by default, the Deployment gets Progressing=False with reason ProgressDeadlineExceeded. That is only a status report. Kubernetes does not roll back on its own. Then I decide: if the cause is clear and small, fix forward. Otherwise `rollout undo` and investigate without time pressure.',
  deep: '**Why the old pods stay.** A RollingUpdate Deployment manages two ReplicaSets. The controller may create up to `replicas + maxSurge` pods in total and must keep at least `replicas − maxUnavailable` available (both default to 25%, rounded up for surge and down for unavailable). It scales the old ReplicaSet down only as new pods become available. If no new pod ever becomes available, the old ReplicaSet stays at its floor. With maxUnavailable > 0, part of the old capacity has already been removed, so a stalled rollout can mean less headroom than you think, even while users see nothing.\n\n**New pods exist but are not available.**\n- Image problems: `ErrImagePull`/`ImagePullBackOff` (wrong tag, auth, registry reachability, architecture).\n- Crashes: `CrashLoopBackOff` from bad config or a code bug. Read `logs --previous` and the exit code.\n- Config references: `CreateContainerConfigError` for a missing ConfigMap/Secret key referenced in env, or `ContainerCreating` with FailedMount for a missing volume source.\n- Readiness: Running 0/1 because a new endpoint path, port or dependency is wrong.\n- Scheduling: the surge pod is Pending because the new template raised requests or added affinity that nothing satisfies.\n\n**New pods are never created.** Admission happens when the ReplicaSet controller creates pods, so errors land on the ReplicaSet as `FailedCreate` events: quota exceeded, a LimitRange violation, a signature- or policy-verifying admission controller denying the image, a missing ServiceAccount, or a Pod Security violation. The Deployment shows 0 up-to-date pods and no new pods exist. People who only run `kubectl get pods` miss this completely.\n\n**The progress deadline.** If no progress is made for `progressDeadlineSeconds`, the controller sets `Progressing=False, reason=ProgressDeadlineExceeded` and `rollout status` exits non-zero. It keeps retrying and takes no other action. Rollback is left to you or to higher-level tooling such as a pipeline or progressive-delivery controller that watches that condition. A paused Deployment does not count against the deadline.\n\n**Deciding what to do.** If the old version is healthy and nothing irreversible happened (such as a schema migration), `kubectl rollout undo` gets you back to a clean state quickly. If the Deployment is managed by a GitOps controller, revert in the source of truth, or the controller may re-apply the broken spec.',
  followups: [
    { q: 'The new ReplicaSet has 0 pods and no pod events exist anywhere. Where do you look?',
      guidance: '`kubectl describe rs <new-rs>` for FailedCreate events, which carry the admission error (quota, policy webhook denial, PodSecurity, missing ServiceAccount). Also check `kubectl get events -n <ns>` sorted by time, and the admission controller\'s own logs or policy reports if a webhook denied it.' },
    { q: 'Why might `rollout undo` not unstick this, and what else could you do?',
      guidance: 'If the cause is external to the pod template, such as a quota change, a new admission policy that also rejects the old image, or a deleted Secret, the old template fails too. You would restore that dependency, raise the quota or add a policy exception, or pause the Deployment while you fix it. Also check whether a GitOps controller is reverting manual changes.' },
    { q: 'How would you make stalled rollouts detectable and self-limiting in a pipeline?',
      guidance: 'Set progressDeadlineSeconds deliberately, make the pipeline wait on `rollout status --timeout` or the Progressing condition, fail the stage, and run an automated or one-click rollback. Add post-rollout checks against service metrics, because Ready pods are not proof of correctness. Consider canary steps.' }
  ],
  misconceptions: [
    '"The Deployment will roll back automatically after the deadline." It only sets Progressing=False with ProgressDeadlineExceeded.',
    '"If there are no new pods, nothing happened." Admission failures appear as FailedCreate events on the ReplicaSet.',
    '"A completed rollout proves the release works." It proves pods became Ready by their probes.',
    '"Users see no errors, so capacity is unaffected." With maxUnavailable > 0, some old replicas were already removed.'
  ],
  weak: [
    'Only runs `kubectl get pods` and concludes "nothing is wrong"',
    'Restarts the old pods or deletes the new ReplicaSet by hand',
    'Does not distinguish pods-not-Ready from pods-not-created',
    'Rolls back with no evidence captured first'
  ],
  evidence: '# example output\n$ kubectl rollout status deploy/checkout --timeout=10s\nWaiting for deployment "checkout" rollout to finish: 1 out of 4 new replicas have been updated...\nerror: deployment "checkout" exceeded its progress deadline\n\n$ kubectl get rs -l app=checkout\nNAME                  DESIRED   CURRENT   READY   AGE\ncheckout-5b8c7d9f6    4         4         4       9d\ncheckout-7c9f4d2b1    1         1         0       16m\n\n$ kubectl get deploy checkout -o jsonpath=\'{range .status.conditions[*]}{.type}={.status} {.reason}{"\\n"}{end}\'\nAvailable=True MinimumReplicasAvailable\nProgressing=False ProgressDeadlineExceeded\n\n$ kubectl get pods -l app=checkout,pod-template-hash=7c9f4d2b1\nNAME                        READY   STATUS             RESTARTS   AGE\ncheckout-7c9f4d2b1-kx8zp    0/1     ImagePullBackOff   0          16m\n\n# if CURRENT were 0, read the ReplicaSet events instead\n$ kubectl describe rs checkout-7c9f4d2b1 | grep FailedCreate\n  Warning  FailedCreate  replicaset-controller  Error creating: admission webhook "verify-images.example.internal" denied the request: image signature not verified',
  rubric: {
    strong: [
      'Explains old pods persist because new pods never become available within surge/unavailable bounds',
      'Separates pods-not-Ready causes from pods-not-created (FailedCreate) causes',
      'States that ProgressDeadlineExceeded is a condition, not a rollback',
      'Uses ReplicaSet-level evidence and pod-template-hash to find the new pods',
      'Makes a reasoned rollback vs fix-forward call, noting GitOps reconciliation'
    ],
    acceptable: [
      'Reaches the same conclusions via `kubectl get events --sort-by` instead of describe',
      'Pauses the rollout while investigating instead of undoing it'
    ],
    redFlags: [
      'Claims Kubernetes auto-rolls back stalled Deployments',
      'Deletes pods or ReplicaSets by hand as a first step',
      'Declares success because old pods are healthy'
    ]
  },
  aws: { analogy: 'An ECS rolling deployment where new tasks keep failing health checks while old tasks keep serving, optionally with the deployment circuit breaker.',
    breaks: 'The ECS deployment circuit breaker can be configured to roll back automatically. A Kubernetes Deployment only reports ProgressDeadlineExceeded. ECS surfaces failures as service events and stopped-task reasons. Kubernetes spreads the evidence across Deployment conditions, ReplicaSet FailedCreate events and pod status.' },
  refs: [
    { t: 'Deployments (failed deployment, progress deadline)', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' },
    { t: 'ReplicaSet', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/' }
  ],
  verify: ''
},

/* ── 05 rollout undo ─────────────────────────────────────────── */
{ id: 'ons-q-trouble-05', track: 'onsite', topic: 'trouble', priority: 'P0', level: 2, mins: 4,
  prereqs: ['les-rollouts', 'ons-q-trouble-04'],
  labs: ['ons-lab-02'],
  q: 'What does `kubectl rollout undo` restore, and what does it not restore?',
  context: 'A release changed the image, edited a ConfigMap in place, bumped the HPA minimum and ran a database migration. Error rates rose and someone proposes `kubectl rollout undo`.',
  evaluates: [
    'Knows undo restores only the Deployment\'s pod template from an old ReplicaSet',
    'Lists what lives outside the template and is untouched',
    'Understands revision renumbering and history limits',
    'Flags mutable image tags and one-way changes like migrations',
    'Considers GitOps reconciliation reverting a manual undo'
  ],
  spoken: 'Each Deployment revision is really a ReplicaSet that holds a copy of the pod template. `rollout undo` copies the template from the previous revision, or from --to-revision, back into the Deployment. The controller then scales that old ReplicaSet up and the current one down, as a normal rolling update. The restored revision gets a new, higher revision number.\n\nSo it restores what is inside `spec.template`: the image reference, command, env as written, probes, resources, volume references. It does not restore anything else. In this scenario the ConfigMap was edited in place, and the template only refers to it by name, so the old pods would read the new config. The replica count and HPA settings are not in the template. The database migration is not touched at all, and the old code may not understand the new schema. Services, Ingress, RBAC, CRDs and external dependencies are also outside it.\n\nTwo more traps. If the template uses a mutable tag like `:1.4` and that tag was re-pushed, you may not get the old bits back, which is one reason to deploy by digest. And if a GitOps controller manages this Deployment, it will re-apply the broken spec unless the revert happens in Git.',
  deep: '**Mechanism.** The Deployment controller creates a ReplicaSet per distinct pod template, identified by the `pod-template-hash` label, and records `deployment.kubernetes.io/revision` on it. `kubectl rollout undo deploy/x [--to-revision=N]` copies that ReplicaSet\'s template back into `deploy.spec.template`. Because the template matches an existing ReplicaSet, the controller reuses it (same hash) and bumps its revision number to the next one, so revision N disappears from history and reappears as N+k. The normal rolling-update rules apply. `.spec.revisionHistoryLimit` (default 10) controls how many old ReplicaSets are kept. If the one you need was garbage-collected, there is nothing to undo to.\n\n**Restored:** everything inside `spec.template`: container images as written (tag or digest), commands/args, env entries as written (including which ConfigMap/Secret keys are referenced), probes, resources, volumes and their references, the serviceAccountName, labels and annotations on the template.\n\n**Not restored:**\n- The content of ConfigMaps and Secrets. The template references them by name, so an in-place edit stays. Versioned names (for example a hash suffix) make config part of the template and therefore part of rollback.\n- `spec.replicas`, the strategy, and any HorizontalPodAutoscaler.\n- Services, Ingress/Gateway routes, NetworkPolicies, RBAC, PodDisruptionBudgets.\n- PersistentVolume data, and database schema or data migrations. Rolling code back over a forward-only migration can break things worse.\n- CRDs or operator versions, cluster add-ons, and external services, feature flags or DNS.\n- The actual image bits behind a mutable tag. With `imagePullPolicy: IfNotPresent`, some nodes may still have the old cached image and others pull the new one, so replicas can differ.\n\n**In practice.** Before undoing, run `kubectl rollout history deploy/x --revision=N` to confirm what you are going back to, and check what else the release changed. If a GitOps controller owns the object, revert the commit instead, or suspend the controller as a deliberate, recorded step. Afterwards, verify with user-facing signals, not just `rollout status`.',
  followups: [
    { q: 'How would you design releases so that rollback really does restore the previous behaviour?',
      guidance: 'Pin images by digest. Version config objects by name or hash so config changes produce a new template. Keep schema migrations backward compatible (expand/contract) so N-1 code works on the new schema. Put all manifests in version control so a revert is a single commit. Rehearse rollback.' },
    { q: 'You ran `rollout undo` and five minutes later the broken version is back. Why?',
      guidance: 'Most likely a GitOps controller or CD pipeline reconciled the Deployment to the declared (broken) state. Other possibilities are a second apply from automation or an operator that owns the Deployment. Fix it in the source of truth or pause that reconciler as a deliberate, documented action.' },
    { q: 'History shows revisions 4, 5 and 7. Where did 6 go?',
      guidance: 'A previous undo or re-apply matched the template of revision 6\'s ReplicaSet (or an older one) and renumbered it, or history cleanup removed it. Revision numbers follow ReplicaSets, and a reused ReplicaSet takes the next number.' }
  ],
  misconceptions: [
    '"Undo puts the whole application back to how it was." It restores only the pod template.',
    '"Rolling back reverts my ConfigMap edit." Referenced ConfigMap/Secret content is untouched unless the name changed.',
    '"Same tag means same image." Tags are mutable. Only a digest pins content.',
    '"Revision 3 is still revision 3 after undo." The restored ReplicaSet gets a new, higher revision number.'
  ],
  weak: [
    'Treats undo as a universal "go back" button',
    'Ignores the database migration in the scenario',
    'Does not verify what revision is being restored',
    'Undoes a GitOps-managed object and walks away'
  ],
  evidence: '# example output\n$ kubectl rollout history deploy/checkout\ndeployment.apps/checkout\nREVISION  CHANGE-CAUSE\n5         release 2026.09.18\n6         release 2026.09.25\n\n$ kubectl rollout history deploy/checkout --revision=5 | grep -E "Image|Environment|Mounts" -A1\n    Image:      registry.example.internal/checkout@sha256:4f1c...e9a2\n    Environment Variables from:\n      checkout-config  ConfigMap  Optional: false\n\n$ kubectl rollout undo deploy/checkout --to-revision=5\ndeployment.apps/checkout rolled back\n\n$ kubectl rollout history deploy/checkout\nREVISION  CHANGE-CAUSE\n6         release 2026.09.25\n7         release 2026.09.18\n\n# not covered by undo: check separately\n$ kubectl get hpa checkout -o jsonpath=\'{.spec.minReplicas}{"\\n"}\'\n8\n$ kubectl get configmap checkout-config -o jsonpath=\'{.metadata.resourceVersion}{"\\n"}\'\n948211',
  rubric: {
    strong: [
      'Says undo copies an old ReplicaSet\'s pod template into the Deployment',
      'Lists config content, replicas/HPA, Services, data and migrations as not restored',
      'Mentions revision renumbering and revisionHistoryLimit',
      'Recommends digests and versioned config for real rollbacks',
      'Accounts for GitOps reconciliation'
    ],
    acceptable: [
      'Chooses to fix forward because of the migration, with that reasoning explained',
      'Uses `kubectl rollout history --revision` to diff before undoing'
    ],
    redFlags: [
      'Claims undo reverts ConfigMaps, Secrets or database state',
      'Rolls back code over a non-backward-compatible migration without mentioning risk',
      'Assumes tags are immutable'
    ]
  },
  aws: { analogy: 'Updating an ECS service back to the previous task definition revision, or a CloudFormation rollback.',
    breaks: 'An ECS task definition revision is immutable and includes env values (though not Parameter Store or Secrets Manager contents). A Kubernetes template refers to ConfigMaps by name, and those can change underneath it. CloudFormation rollback reverts every resource in the stack. `rollout undo` touches one Deployment\'s template only. Neither reverts database migrations.' },
  refs: [
    { t: 'Deployments (rolling back)', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' },
    { t: 'kubectl rollout undo', u: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/' },
    { t: 'kubectl rollout history', u: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_history/' }
  ],
  verify: 'CHANGE-CAUSE comes from the kubernetes.io/change-cause annotation; the old --record flag is deprecated — confirm your kubectl version.'
},

/* ── 06 CrashLoopBackOff ─────────────────────────────────────── */
{ id: 'ons-q-trouble-06', track: 'onsite', topic: 'trouble', priority: 'P0', level: 2, mins: 4,
  prereqs: ['les-pod-lifecycle', 'les-config'],
  labs: ['ons-lab-06'],
  q: 'A pod is in CrashLoopBackOff. How do you find the actual cause?',
  context: 'After a config change, pods of a service show CrashLoopBackOff with a climbing restart count. You have kubectl access to the namespace.',
  evaluates: [
    'States that CrashLoopBackOff is a back-off state, not a cause',
    'Uses logs --previous, lastState exit code/reason and events',
    'Distinguishes app exit, OOM, liveness kills and config errors that happen before start',
    'Knows back-off timing and what resets it',
    'Handles the "no logs" case'
  ],
  spoken: 'CrashLoopBackOff is not a cause. It means the container keeps exiting and the kubelet is waiting longer between restarts, by default doubling from ten seconds up to a cap of five minutes. The cause is in three places.\n\nFirst, `kubectl logs --previous`, because the current container may have just started and the useful output is in the one that died. Second, `describe pod`, where Last State shows the exit code and reason. Reason Error with exit 1 is usually the application failing, like a missing setting or a failed connection. OOMKilled points at the memory limit. Reason Completed with exit 0 means the process finished, which under restartPolicy Always also loops. Third, events: repeated "Liveness probe failed" before each kill means the kubelet is restarting it, not the app crashing.\n\nI also check for look-alikes. A missing ConfigMap or Secret key referenced in env gives CreateContainerConfigError. The container never starts, so there are no logs, and it is a different status. If the logs are empty, the process died before logging: I check the command, args and entrypoint. I may run a debug copy with a shell to reproduce it.',
  deep: '**What the state means.** When a container exits and restartPolicy allows a restart, the kubelet restarts it with an exponential back-off: 10s, 20s, 40s and so on, capped at 300s by default. The back-off resets after a container runs for 10 minutes without problems. During the wait, the container\'s waiting reason is `CrashLoopBackOff`. This tells you only that there have been repeated exits. It says nothing about why.\n\n**Evidence in order.**\n1. `kubectl logs <pod> -c <container> --previous`: stdout/stderr of the last terminated instance. Plain `kubectl logs` may show the new instance, which is often empty.\n2. `kubectl describe pod`, Last State: `Terminated`, `Reason`, `Exit Code`, `Started/Finished`. Exit 1 or 2 means the application chose to exit (config validation, unhandled exception). 137 means SIGKILL; look for `Reason: OOMKilled` versus liveness events. 143 means SIGTERM honoured. 0 with `Completed` means the process simply ended, for example a one-shot script run as a Deployment. A missing executable or bad entrypoint typically appears as a runtime start error, `StartError`/`RunContainerError`, with a message naming the path.\n3. Events: `Unhealthy`/`Killing` for liveness-driven restarts, `BackOff` for the loop itself, `Pulled`/`Created`/`Started` for timing.\n4. `terminationMessagePath` or `terminationMessagePolicy: FallbackToLogsOnError` can surface the last lines in `describe` even after the logs rotate.\n\n**Config failures that are not CrashLoopBackOff.** A referenced ConfigMap/Secret or key that does not exist in `env`/`envFrom` gives `CreateContainerConfigError`. The kubelet cannot build the container, so there are no logs and the restart count stays at 0. A missing volume source leaves the pod in `ContainerCreating` with a `FailedMount` event. By contrast, if the key exists but has the wrong value, the app starts, rejects it and exits 1. That is CrashLoopBackOff, and the log says so. Telling these apart points you straight at the fix.\n\n**When logs are empty.** Check that command/args match the image\'s entrypoint. Run `kubectl debug <pod> --copy-to=<name> --container=<c> -- sh` to get a copy with a shell and try the start command by hand. Check whether the app logs to a file instead of stdout. Compare against the previous ReplicaSet\'s template to see what changed.',
  followups: [
    { q: 'Restarts climb, Last State shows exit 137, and there is no OOMKilled reason. What next?',
      guidance: 'Look for liveness-probe Unhealthy and Killing events just before each restart. The kubelet kills the container after the grace period if it ignores SIGTERM, which gives 137. Also consider something else sending SIGKILL. Check probe timing against startup time. See ons-q-trouble-07.' },
    { q: 'The pod shows CreateContainerConfigError after the same change. How is that different?',
      guidance: 'The container was never created because a referenced ConfigMap/Secret or key is missing. There are no logs and the describe message names the missing object or key. The fix is to create the object or correct the reference. The app code is not involved.' },
    { q: 'How would you stop a crash-looping release from hurting users while you investigate?',
      guidance: 'If it is a rollout, the old ReplicaSet may still be serving, so pause the rollout or undo it. Capture logs --previous and the describe output first. Avoid deleting pods repeatedly, which resets evidence and does not change the cause.' }
  ],
  misconceptions: [
    '"The cause is CrashLoopBackOff." It is the kubelet\'s back-off state. The cause is in logs --previous, the exit code and events.',
    '"`kubectl logs` shows why it crashed." Without --previous you often see the fresh instance, not the one that died.',
    '"A missing ConfigMap makes the app crash-loop." A missing referenced key usually gives CreateContainerConfigError before start. A wrong value makes the app exit and crash-loop.',
    '"Deleting the pod clears the problem." The replacement runs the same template and fails the same way.'
  ],
  weak: [
    'Stops at "it is crash-looping"',
    'Reads current logs only and reports "no errors"',
    'Ignores the exit code and reason',
    'Restarts or deletes pods before collecting evidence'
  ],
  evidence: '# example output\n$ kubectl get pods -l app=billing\nNAME                       READY   STATUS             RESTARTS      AGE\nbilling-6d5f7c8b9-7qkz2    0/1     CrashLoopBackOff   6 (2m ago)    9m\n\n$ kubectl describe pod billing-6d5f7c8b9-7qkz2 | sed -n \'/Last State/,/Ready/p\'\n    Last State:     Terminated\n      Reason:       Error\n      Exit Code:    1\n      Started:      Sat, 26 Sep 2026 14:02:11 +0000\n      Finished:     Sat, 26 Sep 2026 14:02:12 +0000\n    Ready:          False\n\n$ kubectl logs billing-6d5f7c8b9-7qkz2 --previous | tail -2\nconfig: loading /etc/billing/app.yaml\nFATAL: invalid value for payments.timeout: "30 seconds" (expected duration like 30s)\n\n# a missing referenced key looks different: never started, no logs\n$ kubectl get pod billing-6d5f7c8b9-p2lm4\nNAME                       READY   STATUS                       RESTARTS   AGE\nbilling-6d5f7c8b9-p2lm4    0/1     CreateContainerConfigError   0          1m\n$ kubectl describe pod billing-6d5f7c8b9-p2lm4 | grep -i "Error:"\n  Warning  Failed  kubelet  Error: couldn\'t find key DB_URL in ConfigMap shop/billing-config',
  rubric: {
    strong: [
      'Names CrashLoopBackOff as a back-off state with bounded exponential delay',
      'Uses logs --previous, Last State exit code/reason, and events together',
      'Distinguishes app exit, OOMKilled, liveness kill and exit 0 Completed',
      'Separates CreateContainerConfigError and FailedMount from crash loops',
      'Has a plan for empty logs (debug copy, entrypoint check)'
    ],
    acceptable: [
      'Uses a logging backend instead of kubectl logs, as long as it targets the terminated instance',
      'Compares the new template to the previous ReplicaSet as a first step because a change is known'
    ],
    redFlags: [
      'Treats CrashLoopBackOff as the root cause',
      'Deletes pods repeatedly as the fix',
      'Assumes every restart is an application bug without checking probes or OOM'
    ]
  },
  aws: { analogy: 'An ECS service repeatedly starting tasks that stop, where you read the stopped reason and exit code on the task and the CloudWatch Logs stream for that task.',
    breaks: 'ECS replaces a stopped task with a new task, with a new ID and log stream. Kubernetes restarts the container inside the same pod with back-off, so the previous instance\'s logs are reachable only through --previous (or your log pipeline). ECS has no direct equivalent of CreateContainerConfigError. A missing secret shows as a task that fails to start with a stopped reason.' },
  refs: [
    { t: 'Pod Lifecycle (container restarts and back-off)', u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/' },
    { t: 'Determine the Reason for Pod Failure', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/determine-reason-pod-failure/' },
    { t: 'Debug Running Pods', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/' }
  ],
  verify: 'Back-off cap (300s) and the 10-minute reset are defaults; newer versions add feature-gated options to shorten or configure the maximum delay per node. Exact runtime error reasons for a missing entrypoint vary by container runtime.'
},

/* ── 07 Exit code 137 ────────────────────────────────────────── */
{ id: 'ons-q-trouble-07', track: 'onsite', topic: 'trouble', priority: 'P0', level: 2, mins: 4,
  prereqs: ['les-pod-lifecycle', 'les-resources', 'ons-q-trouble-06'],
  labs: ['ons-lab-07'],
  q: 'A container shows exit code 137. Is it out of memory? How do you prove it either way?',
  context: 'A teammate says a service is "running out of memory" because its containers restart with exit code 137. You are asked to confirm before anyone raises limits.',
  evaluates: [
    'Knows 137 = 128 + 9, i.e. SIGKILL, with several possible senders',
    'Uses lastState.terminated.reason (OOMKilled) as the discriminator',
    'Considers liveness kills past the grace period and other SIGKILL sources',
    'Distinguishes container OOM from node-level OOM and eviction',
    'Proposes evidence-led fixes (not just "raise the limit")'
  ],
  spoken: 'Not by itself. 137 is 128 plus 9, which means the process was killed with SIGKILL. The OOM killer is one sender, but not the only one.\n\nThe discriminator is the container\'s last state. In `describe`, or `status.containerStatuses[].lastState.terminated`, Reason OOMKilled means the kernel killed it for exceeding its cgroup memory limit. Reason Error or Unknown with 137 means look elsewhere.\n\nThe usual other sender is the kubelet. After a liveness probe fails, or on any stop, it sends SIGTERM and waits for the grace period. A process that ignores SIGTERM then gets SIGKILL, which is 137. The events show it: "Liveness probe failed", then "Container will be restarted". Other senders are node-level pressure, where an evicted pod shows Reason Evicted on the pod rather than a normal restart, a host-level OOM, or someone killing it by hand.\n\nTo back up an OOM diagnosis I compare memory usage over time to the limit. On a real node, the kernel log shows "Memory cgroup out of memory: Killed process". Only then do I decide between raising the limit and fixing a leak.',
  deep: '**What 137 encodes.** By convention, a process terminated by signal N is reported as exit code 128+N. SIGKILL is 9, so 137. SIGTERM is 15, so 143 when the process lets the default handler kill it. Many runtimes report 143 when the app exits cleanly on SIGTERM, and some apps exit 0. SIGKILL cannot be caught, so 137 says only that someone sent SIGKILL.\n\n**Senders of SIGKILL, and how to tell them apart.**\n- **Container memory limit (cgroup OOM):** the kernel kills a process in the container\'s cgroup when usage cannot be reclaimed below the limit. The kubelet/runtime reports `lastState.terminated.reason: OOMKilled`. Memory metrics show a climb to the limit. With cgroup v2 and recent versions, the whole container is typically killed as a group. On older setups a child process could be killed while PID 1 survived, and then you see no restart at all, just a missing worker.\n- **Liveness or stop past the grace period:** the kubelet sends SIGTERM, waits `terminationGracePeriodSeconds` (or the probe-level override), then SIGKILL. Evidence: `Unhealthy` (Liveness) and `Killing` events just before each restart, and reason `Error`, not OOMKilled. Fix the probe or the SIGTERM handling, not the memory.\n- **Node-pressure eviction:** the kubelet evicts whole pods. The pod gets `status.phase: Failed, reason: Evicted` with a message naming the resource, and its controller creates a replacement pod. It is not a restart inside the same pod. Hard thresholds use a zero grace period.\n- **Node-level OOM:** if the node runs out of memory before the kubelet reacts, the kernel OOM killer picks by oom_score (adjusted by QoS). The victim may be under its own limit. Look at node events and the kernel log.\n- **Manual or external:** `kill -9`, `crictl stop` with timeout, or a sidecar or agent killing processes.\n\n**Proving it.** Use lastState reason and exit code; events in time order; `kubectl top`/metrics history of the working set compared with the limit; `kubectl describe node` for MemoryPressure conditions; on nodes you can access, `journalctl -k` or `dmesg` for `Memory cgroup out of memory` (container limit) versus `Out of memory: Killed process` (node-wide). Then fix the right thing: raise the limit if the working set is legitimately higher, fix a leak if usage grows without bound, or tune the JVM or runtime heap to fit inside the limit.',
  followups: [
    { q: 'Reason is OOMKilled but dashboards show memory well under the limit. How?',
      guidance: 'Scrape intervals miss short spikes. Dashboards may show RSS while the cgroup counts page cache and kernel memory against the limit. The kill may also have hit a sidecar or a different container in the pod. Check per-container metrics at higher resolution and the kernel log.' },
    { q: 'A JVM service is OOMKilled on start after moving to smaller limits. What do you check?',
      guidance: 'Whether the heap is sized from the container limit (container-aware JVM flags or percentage-based sizing) and leaves room for off-heap memory: metaspace, threads, direct buffers. A fixed -Xmx near or above the limit guarantees a kill. Adjust the heap percentage or the limit.' },
    { q: 'How do you make a process exit cleanly instead of getting 137 on every rollout?',
      guidance: 'Handle SIGTERM: stop accepting work, drain, exit. Make sure PID 1 forwards signals (an init like tini, or exec-form entrypoints). Set terminationGracePeriodSeconds to cover drain time. Optionally use a preStop hook to delay shutdown until endpoints update.' }
  ],
  misconceptions: [
    '"137 means out of memory." It means SIGKILL. OOMKilled in lastState is what proves the memory limit.',
    '"Eviction and OOM kill are the same thing." Eviction is the kubelet failing the whole pod under node pressure. An OOM kill is the kernel killing a process.',
    '"If it was OOM, just raise the limit." A leak will reach any limit. Check the growth pattern first.',
    '"Liveness kills show as OOMKilled." They show as Error, with Unhealthy/Killing events.'
  ],
  weak: [
    'Equates 137 with OOM without checking the reason',
    'Raises memory limits as the first and only action',
    'Ignores events and probe configuration',
    'Cannot explain 128 + signal'
  ],
  evidence: '# example output\n$ kubectl get pod report-7b6d9-kq2sd -o jsonpath=\'{.status.containerStatuses[0].lastState.terminated}{"\\n"}\'\n{"containerID":"containerd://9e1f...","exitCode":137,"finishedAt":"2026-09-26T13:41:07Z","reason":"OOMKilled","startedAt":"2026-09-26T13:22:40Z"}\n\n# same exit code, different cause\n$ kubectl describe pod search-5f7c8-m3x9t | sed -n \'/Last State/,/Exit Code/p\'\n    Last State:     Terminated\n      Reason:       Error\n      Exit Code:    137\n$ kubectl get events --field-selector involvedObject.name=search-5f7c8-m3x9t --sort-by=.lastTimestamp | tail -3\nWarning  Unhealthy  pod/search-5f7c8-m3x9t  Liveness probe failed: Get "http://10.244.2.31:8080/livez": context deadline exceeded\nNormal   Killing    pod/search-5f7c8-m3x9t  Container search failed liveness probe, will be restarted\n\n# on a node you can reach\n$ journalctl -k | grep -i "out of memory" | tail -1\nkernel: Memory cgroup out of memory: Killed process 48121 (java) total-vm:6102332kB, anon-rss:1046212kB',
  rubric: {
    strong: [
      'Explains 137 as 128 + SIGKILL',
      'Uses lastState.terminated.reason to confirm or reject OOM',
      'Names liveness/grace-period kills and eviction as alternatives with their evidence',
      'Separates container cgroup OOM from node-level OOM',
      'Fixes based on usage pattern (leak vs undersized vs runtime sizing)'
    ],
    acceptable: [
      'Relies on metrics platform plus events instead of node kernel logs when nodes are managed',
      'Proposes a temporary limit increase while investigating, labelled as a mitigation'
    ],
    redFlags: [
      'States 137 proves OOM',
      'Treats eviction as identical to an OOM kill',
      'Raises limits cluster-wide without evidence'
    ]
  },
  aws: { analogy: 'An ECS task stopped with "OutOfMemoryError: Container killed due to memory usage" and exit code 137, compared with a task stopped by a failed health check.',
    breaks: 'ECS puts the reason in the stopped task\'s stoppedReason. In Kubernetes the container restarts inside the same pod, and you read lastState on the container status. Kubernetes also has node-pressure eviction by QoS, which ECS does not model the same way.' },
  refs: [
    { t: 'Resource Management for Pods and Containers', u: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/' },
    { t: 'Assign Memory Resources to Containers and Pods', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/' },
    { t: 'Node-pressure Eviction', u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/' }
  ],
  verify: 'Whether the whole container is killed on OOM (cgroup v2 memory.oom.group) depends on Kubernetes version and cgroup version; exact kernel log wording varies by kernel.'
},

/* ── 08 ImagePullBackOff ─────────────────────────────────────── */
{ id: 'ons-q-trouble-08', track: 'onsite', topic: 'trouble', priority: 'P0', level: 2, mins: 5,
  prereqs: ['les-pod-lifecycle', 'les-disconnected'],
  labs: ['ons-lab-02', 'ons-lab-10'],
  q: 'A new rollout\'s pods show ImagePullBackOff. What are the likely causes and how do you tell them apart?',
  context: 'A rollout changed only the image reference. New pods on some or all nodes are stuck in ImagePullBackOff; old pods are fine. The cluster pulls from an internal registry.',
  evaluates: [
    'Reads the Failed event message rather than guessing',
    'Separates not-found, auth, reachability/TLS and platform mismatch',
    'Knows the node\'s container runtime pulls, with the node\'s network and trust store',
    'Knows pull credentials come from imagePullSecrets on the pod or ServiceAccount (or node config)',
    'Distinguishes admission/signature denial (FailedCreate) from pull failure'
  ],
  spoken: 'ImagePullBackOff means the kubelet asked the container runtime to pull the image, the pull failed, and it is now backing off. The first failure shows as ErrImagePull. The real error is in the pod\'s events, and it usually falls into one of four groups.\n\nNot found: "manifest unknown" or "not found". A tag typo, or the image was never pushed or mirrored to this registry. Authentication: 401 or 403, "pull access denied". The pod has no imagePullSecret, directly or through its ServiceAccount, or the credential is wrong or expired. Reachability: "no such host", "i/o timeout", or "x509: certificate signed by unknown authority". That is DNS, network path, proxy or the node\'s trust store. It is the node that pulls, not the pod, so I test from the node. Platform: "no match for platform in manifest". The image was built for amd64 and the node is arm64, or the reverse.\n\nI also check which nodes are affected. If only some are, it points at node config, or at nodes with the old tag still cached. One look-alike: if a signature-verifying admission controller rejects the image, the pod is never created. That shows as FailedCreate on the ReplicaSet, not as a pull error.',
  deep: '**Who pulls.** Pulling is done by the container runtime on the node the pod was scheduled to, driven by the kubelet. The request uses the node\'s DNS, routes, proxy settings, registry mirror configuration and CA trust store, not the pod\'s network namespace. That is why `kubectl exec` into another pod and curling the registry proves little. Credentials come from the pod\'s `imagePullSecrets`, those attached to its ServiceAccount (merged into the pod at admission), or node-level credential configuration or providers.\n\n**Reading the error.** `kubectl describe pod` shows a `Failed` event with the runtime\'s message. The exact text varies by runtime, but the groups are consistent:\n- **Not found:** `not found`, `manifest unknown`. Tag or digest missing in that registry or repository, a typo, a wrong registry host in the reference, or (in a disconnected environment) the image was never transferred into the mirror.\n- **Auth:** `401 Unauthorized`, `403 Forbidden`, `pull access denied`, `no basic auth credentials`. Missing or wrong secret, secret in a different namespace (pull secrets are namespaced), expired token, or a repository permission gap.\n- **Reachability/TLS:** `no such host`, `i/o timeout`, `connection refused`, `x509: certificate signed by unknown authority`. DNS, firewall or proxy, registry down, or the node does not trust the registry\'s CA. Usually affects every image from that registry, not just the new one.\n- **Platform:** `no match for platform in manifest`. The multi-arch index lacks the node\'s architecture, or a single-arch image was pushed.\n- **Malformed reference:** `InvalidImageName`, a different status.\n\n**Scope tells you a lot.** Affects all nodes: the reference, credential or registry. Affects some nodes: node DNS, CA or mirror config, architecture, or nodes where `IfNotPresent` found the tag cached and never tried to pull. A tag that "works on some nodes" is often a cached old image, which is a correctness problem in its own right.\n\n**Not a pull failure.** An admission controller that verifies signatures or enforces registry allow-lists rejects the pod at creation. You get `FailedCreate` on the ReplicaSet and no pod. That needs a signature, a trust-root or a policy fix, not a registry fix.\n\n**Hardening.** Deploy by digest. Pre-mirror images and verify them against a dependency inventory before release (especially in disconnected environments). Attach pull secrets through the ServiceAccount. Monitor registry certificate expiry.',
  followups: [
    { q: 'The error is x509: certificate signed by unknown authority, but `curl` from a debug pod to the registry succeeds. Explain.',
      guidance: 'The debug pod uses its image\'s CA bundle. The runtime uses the node\'s trust store and registry config. Fix the node trust (CA distribution through node config or bootstrap) or the runtime\'s registry configuration, and test from the node with `crictl pull`.' },
    { q: 'In a disconnected environment the release references six images and one is missing from the mirror. How do you prevent this next time?',
      guidance: 'Generate an image inventory from the rendered manifests (by digest), verify every digest exists in the target mirror before promoting, and fail the release if one is missing. Include indirect images such as init containers, sidecars, operators and hooks. See ons-lab-10.' },
    { q: 'How do you rotate a registry credential without breaking running workloads?',
      guidance: 'Running containers do not re-pull, so only new pulls are affected. Add the new credential alongside the old one (both secrets referenced, or an updated secret), roll pods to confirm new pulls work, then revoke the old one. Pods scheduled onto new nodes are the first to show a gap.' }
  ],
  misconceptions: [
    '"ImagePullBackOff means the image does not exist." Auth, reachability, TLS and platform mismatch all give the same status. The event message differs.',
    '"The pod pulls the image, so test from a pod." The node\'s runtime pulls, with node networking and trust.',
    '"A signature failure shows as ImagePullBackOff." Admission-time verification blocks pod creation (FailedCreate on the ReplicaSet).',
    '"If the tag works on one node it is fine." That node may be running a cached, older image behind the same tag.'
  ],
  weak: [
    'Guesses the cause without reading the event',
    'Recreates pods or restarts the runtime repeatedly',
    'Does not check which nodes are affected',
    'Suggests `:latest` or disabling TLS verification as a fix'
  ],
  evidence: '# example output\n$ kubectl get pods -l app=checkout -o wide | grep -v Running\ncheckout-7c9f4d2b1-kx8zp   0/1   ImagePullBackOff   0   6m   10.244.3.8   worker-3\n\n$ kubectl describe pod checkout-7c9f4d2b1-kx8zp | grep -E "Failed|BackOff"\n  Warning  Failed   kubelet  Failed to pull image "registry.example.internal/shop/checkout:1.8.3": rpc error: code = NotFound desc = failed to pull and unpack image "registry.example.internal/shop/checkout:1.8.3": failed to resolve reference "registry.example.internal/shop/checkout:1.8.3": registry.example.internal/shop/checkout:1.8.3: not found\n  Warning  Failed   kubelet  Error: ErrImagePull\n  Normal   BackOff  kubelet  Back-off pulling image "registry.example.internal/shop/checkout:1.8.3"\n\n# other signatures you may see instead\n#   ... 401 Unauthorized            -> credentials\n#   ... dial tcp: lookup registry.example.internal: no such host -> node DNS\n#   ... x509: certificate signed by unknown authority -> node trust store\n#   ... no match for platform in manifest: not found -> architecture\n\n$ kubectl get sa default -n shop -o jsonpath=\'{.imagePullSecrets}{"\\n"}\'\n[{"name":"internal-registry"}]\n\n# on the node (if you have access)\n$ sudo crictl pull registry.example.internal/shop/checkout:1.8.3',
  rubric: {
    strong: [
      'Reads the Failed event and classifies it: not found / auth / reachability-TLS / platform',
      'States that the node runtime pulls, using node DNS, proxy and CA trust',
      'Knows pull secrets are namespaced and can come from the ServiceAccount',
      'Uses the set of affected nodes as a diagnostic signal',
      'Separates admission/signature denial from pull failure'
    ],
    acceptable: [
      'Uses registry-side logs or audit to confirm auth failures',
      'Validates a reference with a registry client (for example `crane`/`skopeo`) from a node-equivalent host'
    ],
    redFlags: [
      'Disables TLS verification or switches to :latest to "fix" it',
      'Says signature policy failures appear as ImagePullBackOff',
      'Tests reachability only from inside an unrelated pod and concludes the registry is fine'
    ]
  },
  aws: { analogy: 'ECS tasks failing with CannotPullContainerError against ECR: missing image, missing execution-role permissions, or no network path (VPC endpoints/NAT).',
    breaks: 'In ECS the task execution role supplies pull credentials. In Kubernetes they come from namespaced imagePullSecrets, the ServiceAccount, or node-level configuration. There is no per-task IAM role for pulls unless the platform adds a credential provider. Kubernetes nodes also cache images per node, so pull behaviour can differ node to node.' },
  refs: [
    { t: 'Images', u: 'https://kubernetes.io/docs/concepts/containers/images/' },
    { t: 'Pull an Image from a Private Registry', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/' },
    { t: 'Debug Pods', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/' }
  ],
  verify: 'Error message wording depends on the container runtime and its version.'
},

/* ── 09 First ten minutes ────────────────────────────────────── */
{ id: 'ons-q-trouble-09', track: 'onsite', topic: 'trouble', priority: 'P0', level: 2, mins: 6,
  prereqs: ['ons-q-trouble-04', 'ons-q-trouble-05', 'ons-q-trouble-06'],
  labs: ['ons-lab-02', 'ons-lab-03', 'ons-lab-06'],
  q: 'You\'re paged: "checkout is down". Walk me through your first ten minutes.',
  context: 'Assume checkout runs as a Deployment behind a Service and an ingress in one cluster, with metrics and logs available. The interviewer wants your sequence and reasoning, not every command.',
  evaluates: [
    'Confirms and sizes user impact before diving in',
    'Looks for recent changes and scopes the blast radius',
    'Collects read-only evidence before mutating anything',
    'Chooses mitigation (often rollback) over live debugging when it is safe',
    'Communicates, records a timeline and verifies with user-facing signals'
  ],
  spoken: 'Minute zero to two: acknowledge the page, then confirm impact from the user\'s side. Is the error rate or a synthetic checkout failing, all requests or some, one region or all? I open an incident channel and post a first status, even if it only says "investigating".\n\nMinutes two to five: what changed? I check deploy history, config changes, infra changes and dependency status. At the same time I collect read-only evidence: `kubectl get deploy,rs,pods` for checkout, recent events, whether the Service has ready endpoints, and error logs. That usually puts me in a branch: pods crashing, pods Running but not Ready, endpoints empty, or pods fine while a dependency fails. I write down two or three hypotheses and what would disprove each.\n\nMinutes five to ten: mitigate. If a rollout just happened and there is no one-way migration, rolling back is usually the fastest safe move. If a dependency is failing, shifting traffic or turning off a feature may be better. One change at a time, announced before I make it. Then I verify with the same user-facing metric, not just pod status. I avoid broad restarts, deleting namespaces or random edits, because they destroy evidence and can widen the outage.',
  deep: '**Order of operations.** The aim of the first ten minutes is to limit harm without destroying what you need to understand it. Roughly: impact → change → scope → evidence → hypotheses → mitigation → verification, with communication running throughout.\n\n**Impact first.** "Down" can mean 100% 5xx, slow responses, one payment method failing, or one region. Use the signal closest to users: synthetic checks, ingress or load-balancer error rate, business metrics such as orders per minute. The scope decides the severity and who else to call.\n\n**Recent change.** Most incidents follow a change. Check `kubectl rollout history`, ReplicaSet ages, the CD or GitOps sync history, config commits, infra or platform changes (node upgrades, policy changes, certificate rotations) and dependency status pages. Kubernetes events expire after a retention window (commonly about an hour by default), so capture them early: `kubectl get events -n shop --sort-by=.lastTimestamp > events.txt`.\n\n**Read-only triage branches.**\n- Pods crash-looping or not Ready → logs --previous, lastState, probe events (see ons-q-trouble-06/07).\n- Pods fine, Service has no ready endpoints → selector or readiness (ons-lab-03).\n- Endpoints fine, errors at ingress → routing, TLS, NetworkPolicy, ingress controller health.\n- Everything in-cluster is healthy → dependency (database, payment provider, DNS) or capacity.\n\n**Mitigate versus fix forward.** Rollback (`rollout undo`, or reverting in Git if a GitOps controller manages it) is the right first move when the timing fits a release and the release had no irreversible steps. Know what undo does not restore (ons-q-trouble-05). Other mitigations: scale out, shed load, disable a feature flag, fail over. Make one change at a time and say it in the channel before you make it.\n\n**What to avoid.** Restarting every pod "to see if it helps" resets evidence and can overload dependencies on cold start. Do not delete namespaces or PVCs. Do not make several simultaneous changes that hide which one worked. Do not debug silently while stakeholders guess.\n\n**Verification and hand-off.** Watch the same user-facing metric recover, confirm with a synthetic transaction, keep the incident open until it is stable, then write the timeline while it is fresh. If you have run incidents in controlled or air-gapped environments, say so here. Writing down each command before you run it and changing one thing at a time are habits that carry straight over.',
  followups: [
    { q: 'You rolled back and errors dropped from 100% to 20%. What now?',
      guidance: 'The rollback helped but is not the whole story. Check for a second change or a residual effect: config edited in place, a migration, cache poisoning, one node or zone still bad. Compare error distribution by pod, node or zone. Keep the rollback, communicate partial recovery, and keep investigating the remainder.' },
    { q: 'Nothing changed in the last day. How does your approach shift?',
      guidance: 'Look for external or time-based causes: expiring certificates or tokens, dependency outages, traffic spikes, quota or capacity exhaustion, node or cloud events, scheduled jobs. Check platform-level changes you do not own, such as cluster upgrades or policy updates. The same read-only-first discipline applies.' },
    { q: 'A senior engineer tells you to restart all pods in the namespace immediately. How do you respond?',
      guidance: 'Acknowledge it, capture evidence first (a few seconds), ask what hypothesis the restart tests, and propose a narrower action such as one pod or one deployment, or a rollback if a change correlates. If they are the incident commander, follow the decision but record it. The goal is controlled change, not being right.' }
  ],
  misconceptions: [
    '"Start by restarting things; it is usually transient." That destroys evidence and may widen the outage.',
    '"Pods are Running and Ready, so Kubernetes is fine and it must be the app." Ready reflects probes. Endpoints, ingress, policies and dependencies can still fail.',
    '"Communication can wait until I understand it." Early, short status updates reduce parallel chaos.',
    '"Rollback always fixes a bad release." It restores the pod template only.'
  ],
  weak: [
    'Jumps straight to kubectl without confirming user impact',
    'Makes changes before looking at what changed',
    'Describes solo heroics with no communication',
    'Lists commands with no reasoning about which branch they are in'
  ],
  evidence: '# example output (read-only first pass)\n$ kubectl get deploy,rs -n shop -l app=checkout\nNAME                       READY   UP-TO-DATE   AVAILABLE   AGE\ndeployment.apps/checkout   2/4     4            2           41d\nNAME                                  DESIRED   CURRENT   READY   AGE\nreplicaset.apps/checkout-7c9f4d2b1    4         4         2       12m\nreplicaset.apps/checkout-5b8c7d9f6    0         0         0       9d\n\n$ kubectl get pods -n shop -l app=checkout\nNAME                        READY   STATUS             RESTARTS      AGE\ncheckout-7c9f4d2b1-2bq7m    0/1     CrashLoopBackOff   5 (40s ago)   12m\ncheckout-7c9f4d2b1-kx8zp    1/1     Running            0             12m\n\n$ kubectl get endpointslices -n shop -l kubernetes.io/service-name=checkout\nNAME             ADDRESSTYPE   PORTS   ENDPOINTS                AGE\ncheckout-8xk2d   IPv4          8080    10.244.1.9,10.244.3.8    41d\n\n$ kubectl get events -n shop --sort-by=.lastTimestamp > /tmp/incident-events.txt\n$ kubectl rollout history deploy/checkout -n shop | tail -2\n11        release 2026.09.26-1\n12        release 2026.09.26-2',
  rubric: {
    strong: [
      'Confirms impact and scope with user-facing signals first',
      'Checks recent changes and captures expiring evidence (events) early',
      'Stays read-only until a hypothesis justifies a change',
      'Prefers a safe mitigation (often rollback) and verifies with the same signal',
      'Communicates on a cadence and keeps a timeline'
    ],
    acceptable: [
      'Hands incident command to someone else and takes the investigator role, with a reason',
      'Starts from dashboards instead of kubectl, reaching the same branches'
    ],
    redFlags: [
      'Restarts or deletes resources broadly before gathering evidence',
      'Makes multiple simultaneous changes',
      'Never mentions communicating status'
    ]
  },
  aws: { analogy: 'Operational incident response on an AWS service: check alarms and user-facing metrics, recent deployments (pipeline, CloudFormation or ECS deployment history), then mitigate by rollback.',
    breaks: 'In Kubernetes the change record is spread across rollout history, ReplicaSets, GitOps sync history and events, and events expire after a retention window. Rolling back a Deployment reverts only its pod template, unlike a whole-stack CloudFormation rollback.' },
  refs: [
    { t: 'Troubleshooting Applications', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/' },
    { t: 'Deployments (rolling back)', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' }
  ],
  verify: 'Event retention is an API-server setting (commonly about 1 hour by default) — confirm for the cluster in question.'
},

/* ── 10 Eviction vs OOM vs preemption ────────────────────────── */
{ id: 'ons-q-trouble-10', track: 'onsite', topic: 'trouble', priority: 'P0', level: 3, mins: 5,
  prereqs: ['les-resources', 'les-scheduling', 'ons-q-trouble-02'],
  labs: ['ons-lab-07'],
  q: 'What is node-pressure eviction, and how is it different from an OOM kill or preemption?',
  context: 'Over a weekend, several pods across namespaces disappeared and were recreated elsewhere. Some teams say "OOM", others say "eviction". You want to be precise about who acted and why.',
  evaluates: [
    'Identifies the actor for each: kubelet, kernel, scheduler',
    'Knows eviction signals and ranking by QoS/usage vs requests/priority',
    'Knows preemption is for pending higher-priority pods',
    'Knows which respect PDBs and grace periods',
    'Can name the evidence that distinguishes them'
  ],
  spoken: 'They are three different actors.\n\nNode-pressure eviction is the kubelet. It watches signals like memory.available, nodefs.available and PIDs against thresholds. When one is crossed, it first reclaims what it can, for example unused images, and then evicts whole pods. Its order is: pods using more than their requests first, then by priority, then by how far over request. The evicted pod is marked Failed with reason Evicted, and its controller creates a replacement, possibly on another node. Node-pressure eviction does not respect PodDisruptionBudgets, and with hard thresholds there is no grace period.\n\nAn OOM kill is the Linux kernel. When a container\'s cgroup hits its memory limit, or the whole node runs out of memory before the kubelet reacts, the kernel kills a process. The pod stays, the container restarts, and lastState says OOMKilled.\n\nPreemption is the scheduler. A higher-priority pod cannot be scheduled, so the scheduler picks lower-priority victims on a node and deletes them gracefully to make room. It tries to respect PDBs but does not guarantee it.\n\nSo the evidence is: Evicted on the pod, OOMKilled on the container, or a Preempted event plus a nominated node on the pending pod.',
  deep: '**Node-pressure eviction (kubelet).** The kubelet compares eviction signals such as `memory.available`, `nodefs.available`, `imagefs.available`, inode counts and `pid.available` against soft thresholds (with grace periods) and hard thresholds (no grace period). Common Linux defaults for hard thresholds include `memory.available<100Mi` and `nodefs.available<10%`, but distributions change them. When a threshold is crossed, the node condition becomes MemoryPressure, DiskPressure or PIDPressure, a matching taint stops new pods landing there, and the kubelet first tries to reclaim node resources (garbage-collecting dead containers and unused images for disk pressure). If that is not enough, it evicts pods. The ranking is: pods whose usage exceeds requests go first, ordered by priority and then by amount over request; then pods under their requests, by priority. Eviction sets the pod `phase: Failed`, `reason: Evicted` and a message naming the resource and the container\'s usage compared with its request. It ignores PodDisruptionBudgets. Soft thresholds honour `eviction-max-pod-grace-period`, hard thresholds use zero. Controllers replace evicted pods. The failed pod object lingers until garbage-collected.\n\n**OOM kill (kernel).** Two variants. A container exceeding its own cgroup memory limit is killed in its cgroup (OOMKilled, exit 137, same pod, restart count +1). If the node runs out of memory before the kubelet evicts anything, the kernel\'s node-wide OOM killer picks by `oom_score` plus the kubelet-set `oom_score_adj`, which depends on QoS (Guaranteed about -997, BestEffort 1000, Burstable in between). A pod under its own limit can still die this way.\n\n**Preemption (scheduler).** When a pending pod with a higher PriorityClass cannot fit anywhere, the scheduler looks for a node where evicting lower-priority pods would make room, sets `status.nominatedNodeName` on the pending pod and deletes the victims with their graceful termination period. It tries to honour PDBs but may violate them if there is no other option. Victims are not necessarily over their requests. Priority is the only criterion.\n\n**API-initiated eviction** (for example `kubectl drain`) is a fourth path. It goes through the Eviction API and respects PDBs, and it is what planned node maintenance uses.\n\n**Why it matters.** The fix differs: eviction calls for honest requests, node sizing and disk hygiene. A container OOM calls for limits or leak fixes. Preemption calls for priority policy and capacity. Mixing them up leads to the wrong change.',
  followups: [
    { q: 'Pods keep getting evicted with DiskPressure on one node. What do you check?',
      guidance: 'Node conditions and the eviction message (nodefs or imagefs). Look for large container logs, emptyDir usage without sizeLimit, image accumulation, and writable-layer growth. Set ephemeral-storage requests and limits and emptyDir sizeLimit so the kubelet can account for them. Consider the log rotation settings.' },
    { q: 'How do you protect a critical workload from all three?',
      guidance: 'Guaranteed QoS with accurate requests (last in eviction order, lowest OOM score), memory limits sized from data, a high PriorityClass so it preempts rather than gets preempted, and PDBs for voluntary disruptions. None of these is absolute: node-level OOM and hard eviction can still hit it, so replicas across nodes matter most.' },
    { q: 'Why might the kubelet evict nothing and the kernel OOM-kill a pod instead?',
      guidance: 'The kubelet samples memory periodically, so a fast spike can exhaust memory between samples. The kernel acts immediately. Kernel memory notification settings, reserved memory for system and kube, and eviction thresholds with headroom reduce this.' }
  ],
  misconceptions: [
    '"Evicted pods were OOM-killed." Eviction is the kubelet failing the pod under node pressure. OOM is the kernel killing a process.',
    '"Eviction respects PodDisruptionBudgets." Node-pressure eviction does not. API-initiated eviction (drain) does.',
    '"Preemption targets pods using too much." Preemption picks by priority to make room for a pending pod.',
    '"Guaranteed pods cannot be evicted." They go last, but can still be evicted or node-OOM-killed in extreme cases.'
  ],
  weak: [
    'Uses "evicted", "killed" and "preempted" interchangeably',
    'Cannot name who makes each decision',
    'Offers "raise the limits" as the fix for all three',
    'Does not know where to look to tell them apart'
  ],
  evidence: '# example output\n$ kubectl get pods -A --field-selector=status.phase=Failed\nNAMESPACE   NAME                     READY   STATUS    RESTARTS   AGE\nreports     batch-7d9c8f-lq2vx       0/1     Evicted   0          3h\n\n$ kubectl describe pod batch-7d9c8f-lq2vx -n reports | grep -E "Status:|Reason:|Message:"\nStatus:   Failed\nReason:   Evicted\nMessage:  The node was low on resource: memory. Threshold quantity: 100Mi, available: 91244Ki. Container batch was using 1843Mi, request is 256Mi, has larger consumption of memory.\n\n$ kubectl describe node worker-2 | grep -E "MemoryPressure|Taints"\nTaints:             node.kubernetes.io/memory-pressure:NoSchedule\n  MemoryPressure   True    KubeletHasInsufficientMemory   kubelet has insufficient memory available\n\n# preemption leaves different traces\n$ kubectl get pod critical-0 -o jsonpath=\'{.status.nominatedNodeName}{"\\n"}\'\nworker-1\n$ kubectl get events -A --field-selector reason=Preempted | tail -1\nlow-prio    Normal   Preempted   pod/etl-6c8b-x2p9z   Preempted by pod 3f2a... on node worker-1',
  rubric: {
    strong: [
      'Correctly assigns kubelet / kernel / scheduler as the actors',
      'Explains eviction signals, thresholds and ranking relative to requests and priority',
      'Explains preemption for pending higher-priority pods',
      'States PDB and grace-period behaviour for each path',
      'Names distinguishing evidence: Evicted reason, OOMKilled lastState, Preempted event/nominatedNodeName'
    ],
    acceptable: [
      'Mentions API-initiated eviction (drain) as an additional path',
      'Describes QoS oom_score_adj ordering without exact numbers'
    ],
    redFlags: [
      'Says eviction and OOM kill are the same',
      'Claims node-pressure eviction honours PDBs',
      'Claims Guaranteed pods are immune'
    ]
  },
  aws: { analogy: 'Loosely: an EC2 host running low on memory (OS OOM killer), ECS stopping tasks during instance draining, and Spot capacity reclaim taking capacity away for someone else.',
    breaks: 'ECS has no kubelet-style eviction ranking by QoS and requests, and no priority-based preemption between your own tasks. These are separate Kubernetes mechanisms with different actors, evidence and PDB semantics, so the analogy is only for the general idea of losing capacity.' },
  refs: [
    { t: 'Node-pressure Eviction', u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/' },
    { t: 'Pod Priority and Preemption', u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/' },
    { t: 'API-initiated Eviction', u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/api-eviction/' }
  ],
  verify: 'Default hard eviction thresholds and QoS oom_score_adj values are from current docs; distributions and kubelet configs often override them.'
}

);
