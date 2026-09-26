/* Onsite track — architecture questions: how the control plane, controllers and workload objects fit together,
   and what fails when a container, pod, node or the control plane goes away. Answer out loud before expanding. */
window.LX = window.LX || {};
LX.onsiteQ = LX.onsiteQ || [];
LX.onsiteQ.push(

{ id: 'ons-q-arch-01', track: 'onsite', topic: 'arch', priority: 'P0', level: 1, mins: 4,
  prereqs: ['les-reconcile'],
  labs: ['ons-lab-01'],
  q: 'What happens after you submit a Deployment manifest?',
  context: 'You run `kubectl apply -f web.yaml` for a Deployment with 3 replicas against a healthy cluster. Trace what happens from the moment you press Enter until traffic can reach the pods, naming the component responsible at each step.',
  evaluates: [
    'Knows the API server is the only component that talks to etcd, and every other component watches the API server',
    'Can name the request pipeline: authentication, authorization, admission, validation, persistence',
    'Separates the controller chain (Deployment → ReplicaSet → Pod) from scheduling and from the kubelet actually starting containers',
    'Understands that `apply` returning success means "stored", not "running"'
  ],
  spoken: 'kubectl turns the YAML into an API request and sends it to the API server. The API server authenticates me, checks authorization, usually RBAC, runs mutating admission, validates the object, runs validating admission, and writes it to etcd. At that point kubectl reports success, but nothing is running yet.\n\nEverything after that is controllers watching the API server. The Deployment controller sees a new Deployment and creates a ReplicaSet for the current pod template. The ReplicaSet controller sees it wants 3 pods and has 0, so it creates 3 Pod objects with no node assigned. The scheduler watches for unscheduled pods, filters and scores nodes, and writes a binding. The kubelet on each chosen node sees a pod assigned to it, asks the container runtime to pull the image, the CNI plugin sets up the pod network, and the containers start.\n\nThe kubelet reports status back through the API server. Once readiness passes, the pod is marked Ready, the EndpointSlice controller adds it to any matching Service, and the Deployment status shows available replicas. Nobody pushes work to anybody; each component reconciles what it watches.',
  deep: '**The API server is the hub.** kubectl does not talk to etcd, the scheduler or any node. It sends an HTTP request (for `apply`, typically a patch or a create) to the API server. The request passes through authentication (client certificate, bearer token, OIDC and so on), authorization (RBAC in most clusters), mutating admission (built-in plugins plus any mutating webhooks, which is where defaults, injected sidecars or default tolerations get added), schema validation, then validating admission (built-in plugins plus validating webhooks, for example a policy engine). Only then is the object persisted to etcd. If any stage rejects it, nothing is stored and nothing downstream happens.\n\n**Controllers react to watches, not commands.** The Deployment controller (inside kube-controller-manager) watches Deployments. It finds no ReplicaSet matching the current pod template, so it creates one, named with a hash of the template, and sets itself as the ReplicaSet\'s controller owner. The ReplicaSet controller watches ReplicaSets and Pods; it sees desired 3, observed 0, and creates three Pods whose `spec.nodeName` is empty and whose ownerReference points at the ReplicaSet.\n\n**Scheduling is a separate decision.** kube-scheduler watches for pods with no node. It filters nodes that cannot run the pod (insufficient requested CPU or memory, taints without tolerations, affinity rules, volume topology), scores the rest, and posts a Binding. It does not start anything.\n\n**The kubelet makes it real.** Each kubelet watches pods bound to its node. It calls the container runtime through CRI: create the pod sandbox (the CNI plugin assigns an IP and wires the network), pull images, start init containers, then app containers. It runs probes and writes pod status back through the API server.\n\n**Status flows back up.** When the pod\'s Ready condition turns true, the EndpointSlice controller includes it in slices for any Service whose selector matches, and kube-proxy or the cluster\'s dataplane programs routing to it. The ReplicaSet and Deployment controllers update their status fields (ready, available, updated replicas). `kubectl rollout status` watches those fields; `kubectl apply` did not.\n\nThe pattern to name out loud: one source of truth, many independent loops, each comparing desired with observed and acting on the difference. That is why a single slow or failing component shows up as a specific stuck stage, which is exactly how you debug it.',
  followups: [
    { q: 'kubectl apply succeeded but no pods exist. Where do you look?', guidance: 'Walk the chain: does the ReplicaSet exist (`get rs`)? If not, the Deployment controller or the Deployment spec is the issue (describe the Deployment, check conditions). If the ReplicaSet exists with 0 current, describe it: a FailedCreate event usually names an admission rejection or a ResourceQuota. Pods existing but Pending points at the scheduler instead.' },
    { q: 'Where exactly would a mutating admission webhook change your object, and how would you notice?', guidance: 'After authentication and authorization, before validation and persistence. You notice because the stored object differs from your manifest: `kubectl get -o yaml` shows injected containers, labels or defaults, and managedFields shows a different manager for those fields. A failing webhook can also block creation entirely, depending on its failurePolicy.' },
    { q: 'What happens if the scheduler is down but everything else is healthy?', guidance: 'Objects are stored, the ReplicaSet creates Pods, but they stay Pending with no node assigned and no Scheduled event. Existing pods are unaffected. A strong answer notes this is how you localise a control-plane fault: the stage where progress stops names the component.' }
  ],
  misconceptions: [
    '"kubectl apply succeeded, so the app is deployed." It means the API server accepted and stored the object; scheduling, pulls and readiness all happen afterwards and can fail independently.',
    '"The API server tells the kubelet to start containers." The kubelet watches the API server for pods bound to its node; nothing is pushed to it.',
    '"The scheduler starts pods." The scheduler only chooses a node and writes a binding; the kubelet and container runtime start containers.',
    '"Controllers read etcd directly." Only the API server talks to etcd; controllers use watches and caches against the API server.'
  ],
  weak: [
    'Jumps straight from "kubectl apply" to "the pod runs" with no components in between',
    'Omits admission, so cannot explain why an object could be rejected or modified',
    'Treats the Deployment as directly creating Pods, skipping the ReplicaSet',
    'Never mentions how the result becomes visible (status, Ready, EndpointSlices)'
  ],
  evidence: '# example output\n$ kubectl apply -f web.yaml\ndeployment.apps/web created\n\n$ kubectl get events --sort-by=.lastTimestamp | tail -7\nREASON              OBJECT                      MESSAGE\nScalingReplicaSet   deployment/web              Scaled up replica set web-6f7c9d8b5d from 0 to 3\nSuccessfulCreate    replicaset/web-6f7c9d8b5d   Created pod: web-6f7c9d8b5d-x2k4p\nScheduled           pod/web-6f7c9d8b5d-x2k4p    Successfully assigned default/web-6f7c9d8b5d-x2k4p to worker-2\nPulling             pod/web-6f7c9d8b5d-x2k4p    Pulling image "registry.example/web:1.4.2"\nPulled              pod/web-6f7c9d8b5d-x2k4p    Successfully pulled image ...\nStarted             pod/web-6f7c9d8b5d-x2k4p    Started container web\n\n$ kubectl rollout status deploy/web\ndeployment "web" successfully rolled out',
  rubric: {
    strong: [
      'Names the API server request path including authn, authz and admission before persistence to etcd',
      'Describes the Deployment → ReplicaSet → Pod controller chain with watches, not direct calls',
      'Separates scheduling (bind to node) from the kubelet and runtime starting containers',
      'Explains how status returns: pod Ready, EndpointSlices, Deployment available replicas',
      'Points out that apply success is not rollout success and names how to confirm (rollout status, events)'
    ],
    acceptable: [
      'Describes the flow through events a user would see (ScalingReplicaSet, SuccessfulCreate, Scheduled, Pulled, Started) rather than component internals, as long as the order and owners are right',
      'Groups admission into one step without naming mutating vs validating, if the purpose (policy, defaults, rejection) is clear'
    ],
    redFlags: [
      'States that kubectl or controllers write to etcd directly',
      'Claims the scheduler or API server starts containers on nodes',
      'Treats a successful apply as proof the application works'
    ]
  },
  aws: { analogy: 'Calling CreateService / UpdateService in ECS: the API accepts the request, then the ECS scheduler places tasks and the agent on the instance starts containers.', breaks: 'ECS hides its control loop inside a managed service. In Kubernetes the chain is visible and made of separate, replaceable components (admission webhooks, controllers, scheduler, kubelet) that you can observe and extend, and each stage records its own objects and events.' },
  refs: [
    { t: 'Kubernetes components', u: 'https://kubernetes.io/docs/concepts/overview/components/' },
    { t: 'Controllers', u: 'https://kubernetes.io/docs/concepts/architecture/controller/' },
    { t: 'Admission control', u: 'https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/' }
  ],
  verify: ''
},

{ id: 'ons-q-arch-02', track: 'onsite', topic: 'arch', priority: 'P0', level: 1, mins: 3,
  prereqs: ['les-workloads', 'les-services'],
  labs: ['ons-lab-03'],
  q: 'How do a Deployment, ReplicaSet, Pod, and Service differ?',
  context: 'An interviewer wants to check that you know which object does what, and how they find each other. Explain each object\'s job and the relationships between them.',
  evaluates: [
    'Knows the Pod is the unit that runs and gets an IP; the others manage or expose pods',
    'Understands ownership (Deployment owns ReplicaSets, ReplicaSet owns Pods) versus selection (a Service selects pods but owns none of them)',
    'Can say why the ReplicaSet layer exists (rollouts and rollback)',
    'Knows the Service gives a stable name and virtual IP in front of changing pod IPs'
  ],
  spoken: 'A Pod is what actually runs: one or more containers that share a network namespace and volumes, scheduled together onto one node, with one pod IP. Pods are disposable; if one goes away it is not resurrected, it is replaced by a new pod with a new name and IP.\n\nA ReplicaSet keeps a number of identical pods running. It finds its pods with a label selector and owns them through ownerReferences. If there are too few, it creates more; too many, it deletes some.\n\nA Deployment manages ReplicaSets. Each version of the pod template gets its own ReplicaSet, and a rollout is the Deployment scaling the new one up and the old one down. Keeping old ReplicaSets around is what makes rollback possible.\n\nA Service is different in kind. It does not create or own pods. It selects pods by label and gives clients a stable DNS name and virtual IP, and the EndpointSlice controller keeps the list of ready backends current. So the chain is ownership from Deployment to ReplicaSet to Pod, and selection from Service to Pod. A Service with a selector that matches nothing is valid and simply has no endpoints.',
  deep: '**Pod.** The smallest schedulable unit. Containers in a pod share a network namespace (one IP, reachable to each other on localhost) and can share volumes. A pod is bound to one node for its life. Container restarts happen inside the same pod; replacing a pod means a new object with a new UID and, in almost all setups, a new IP.\n\n**ReplicaSet.** A controller object with `replicas`, a `selector` and a pod `template`. The ReplicaSet controller counts active pods that match its selector and that it owns (or can adopt), and creates or deletes pods to reach `replicas`. Pods it creates carry an ownerReference with `controller: true` pointing at it. You rarely create ReplicaSets directly.\n\n**Deployment.** Manages ReplicaSets to give you declarative updates. When the pod template changes, the Deployment controller creates a new ReplicaSet (named with a `pod-template-hash`) and shifts replicas across according to the strategy (`RollingUpdate` with maxSurge/maxUnavailable, or `Recreate`). Old ReplicaSets are kept at zero replicas up to `revisionHistoryLimit`, which is what `kubectl rollout undo` uses. Changing only `replicas` does not create a new ReplicaSet.\n\n**Service.** A networking object: a stable virtual IP (for ClusterIP types), a DNS name, and port mappings, with a selector that picks backend pods. The EndpointSlice controller, not the Service itself, maintains EndpointSlices listing matching pods and their readiness. The Service has no ownerReference on pods; deleting a Service does not touch pods, and deleting pods does not touch the Service.\n\n**Why the split matters in an interview.** Ownership answers "who will replace this pod if it dies" (the ReplicaSet) and "what gets cleaned up when I delete this" (garbage collection follows ownerReferences). Selection answers "who gets traffic" (pods matching the Service selector and Ready). The two use labels independently, so a pod can be owned by one ReplicaSet and selected by several Services, or selected by a Service without being owned by anything.',
  followups: [
    { q: 'Why does a Deployment need a ReplicaSet in between instead of managing pods directly?', guidance: 'Each ReplicaSet represents one version of the pod template. A rollout is just two ReplicaSets being scaled in opposite directions, and rollback is scaling an old one back up. Keeping versions as separate objects gives you history, pause/resume and clean ownership of which pods belong to which revision.' },
    { q: 'Can two Services select the same pods? Can one pod be behind a Service but not owned by any controller?', guidance: 'Yes to both. Selection is by label, independent of ownership. Multiple Services can select the same pods (for example an internal and an external port set). A bare pod with matching labels will receive Service traffic but will not be replaced if it dies.' },
    { q: 'What happens to pods if you delete the Deployment? And if you delete the Service?', guidance: 'Deleting the Deployment cascades by default through ownerReferences to ReplicaSets and then Pods (background cascading deletion). `--cascade=orphan` leaves them running unowned. Deleting the Service removes its virtual IP, DNS record and EndpointSlices but leaves pods running.' }
  ],
  misconceptions: [
    '"The Service owns its pods." A Service only selects pods by label; it has no ownerReference and does not create, restart or delete them.',
    '"A Deployment creates pods directly." It creates ReplicaSets; the ReplicaSet controller creates the pods.',
    '"A Pod is a container." A pod can hold several containers that share network and volumes; it is the scheduling unit around them.',
    '"If a pod dies, Kubernetes restarts that pod." Containers are restarted in place by the kubelet; a deleted or evicted pod is replaced by a new pod, not revived.'
  ],
  weak: [
    'Describes all four as "ways to run containers" without distinguishing ownership from selection',
    'Cannot explain what the ReplicaSet contributes',
    'Implies a Service is required for pods to run, or that pods need a Service to talk to each other by IP'
  ],
  evidence: '# example output\n$ kubectl get deploy,rs,pods,svc -l app=web\nNAME                  READY   UP-TO-DATE   AVAILABLE\ndeployment.apps/web   3/3     3            3\nNAME                             DESIRED   CURRENT   READY\nreplicaset.apps/web-6f7c9d8b5d   3         3         3\nreplicaset.apps/web-58b4c7d9f6   0         0         0\nNAME                       READY   STATUS    RESTARTS\npod/web-6f7c9d8b5d-x2k4p   1/1     Running   0\n...\nNAME          TYPE        CLUSTER-IP     PORT(S)\nservice/web   ClusterIP   10.96.41.12    80/TCP\n\n$ kubectl get pod web-6f7c9d8b5d-x2k4p -o jsonpath=\'{.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}\'\nReplicaSet/web-6f7c9d8b5d',
  rubric: {
    strong: [
      'States the pod is the running, scheduled unit with its own IP, and is replaced rather than revived',
      'Explains ReplicaSet as count-keeping by selector and ownership, and Deployment as versioned ReplicaSets for rollout/rollback',
      'Makes clear the Service selects but does not own pods, and gives a stable name and virtual IP',
      'Mentions EndpointSlices (or endpoints) as the live list of Ready backends'
    ],
    acceptable: [
      'Explains through a concrete example (scale, rollout, delete) rather than definitions, if the ownership versus selection distinction comes through',
      'Uses "Endpoints" rather than EndpointSlices, noting it is the list of ready pod addresses'
    ],
    redFlags: [
      'Says a Service creates, restarts or owns pods',
      'Says a Deployment and a ReplicaSet are the same thing with no functional difference',
      'Claims a pod keeps its IP when it is replaced'
    ]
  },
  aws: { analogy: 'Task ≈ Pod; an ECS service\'s desired count ≈ ReplicaSet; an ECS service deployment ≈ Deployment rollout; the ALB target group ≈ the Service\'s EndpointSlices.', breaks: 'An ECS service bundles scheduling, deployment and load balancer registration in one object. Kubernetes splits them: the Deployment never references the Service, and the Service finds pods only by labels. There is no Kubernetes object that is "the ECS service".' },
  refs: [
    { t: 'Deployments', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' },
    { t: 'ReplicaSet', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/' },
    { t: 'Service', u: 'https://kubernetes.io/docs/concepts/services-networking/service/' }
  ],
  verify: ''
},

{ id: 'ons-q-arch-03', track: 'onsite', topic: 'arch', priority: 'P0', level: 1, mins: 4,
  prereqs: ['les-pod-lifecycle', 'les-failure'],
  labs: ['ons-lab-01', 'ons-lab-06'],
  q: 'What happens when a container crashes versus when a Pod is deleted?',
  context: 'A Deployment runs 3 replicas. In one case the main process in a container exits with an error; in the other someone runs `kubectl delete pod` on one replica. Compare what happens in each case and what you would observe.',
  evaluates: [
    'Knows a container crash is handled locally by the kubelet according to restartPolicy, inside the same pod',
    'Knows a deleted pod is replaced by the ReplicaSet with a new pod (new name, UID, usually new IP, possibly another node)',
    'Can describe graceful termination: endpoint removal, preStop, SIGTERM, grace period, SIGKILL',
    'Treats CrashLoopBackOff as a back-off state, not a cause'
  ],
  spoken: 'When a container crashes, the pod is not replaced. The kubelet on that node restarts the container inside the same pod, based on restartPolicy, which for a Deployment is Always. The pod keeps its name, UID, IP and node, emptyDir volumes survive, and restartCount goes up. If it keeps crashing, the kubelet waits longer between attempts, by default starting around 10 seconds and doubling up to 5 minutes, which shows as CrashLoopBackOff. That is a back-off state, not the cause; the cause is in `logs --previous`, the last exit code and events.\n\nWhen a pod is deleted, the API server marks it terminating with a grace period, 30 seconds by default. It stops counting as a ready endpoint, the kubelet runs any preStop hook, sends SIGTERM, waits out the grace period, then SIGKILLs anything left. Meanwhile the ReplicaSet sees it is short a pod and creates a brand-new one: new name, new UID, usually a new IP, possibly on another node, fresh emptyDir.\n\nSo: crash is a local restart with the same identity; deletion is replacement by a controller.',
  deep: '**Container crash: handled by the kubelet, locally.** The container\'s main process exits. The kubelet records the terminated state (exit code, reason, timestamps) as `lastState` and applies the pod\'s `restartPolicy`: `Always` (the only value a Deployment allows) restarts on any exit; `OnFailure` only on non-zero; `Never` does not restart. The restart happens in the same pod sandbox, so the pod name, UID, IP and node are unchanged, and pod-level volumes including emptyDir persist. The container\'s own writable layer does not. `RESTARTS` increments.\n\nRepeated crashes trigger exponential back-off: by default 10s, 20s, 40s and so on, capped at 300 seconds, reset after the container runs cleanly for about 10 minutes. Recent versions add feature gates and kubelet settings that change these values, so treat the numbers as defaults. `CrashLoopBackOff` in the STATUS column means "waiting before the next restart". To find the actual cause: `kubectl logs POD --previous` for the instance that died, `describe pod` for `Last State: Terminated` with its exit code and reason, and events. Exit code 1 is usually the app; 137 means SIGKILL, and only `Reason: OOMKilled` tells you it was the memory limit.\n\nNo controller is involved in a crash, which is why a crash loop never "heals" by itself: the ReplicaSet sees a pod that exists and is not replaced.\n\n**Pod deletion: handled by the API server, the kubelet and the ReplicaSet in parallel.** `kubectl delete pod` sets `deletionTimestamp` and a grace period (`terminationGracePeriodSeconds`, 30s by default). From that moment:\n\n- The EndpointSlice controller marks the endpoint terminating and not ready, so Service proxies stop sending new connections, once they observe the update.\n- The kubelet runs the `preStop` hook if defined, then sends the stop signal (SIGTERM by default) to each container, waits for the remainder of the grace period, and sends SIGKILL to anything still running.\n- The ReplicaSet controller stops counting the terminating pod as active and creates a replacement immediately. The replacement is a new object: new name suffix, new UID, a new IP in most CNI setups, scheduled wherever the scheduler chooses.\n\nEndpoint removal and SIGTERM are not ordered relative to each other, so an app that exits instantly on SIGTERM can drop in-flight or just-routed requests. A short preStop delay and graceful shutdown handling are the usual mitigations.\n\n**Why it matters operationally.** Deleting a crash-looping pod is not a fix: the replacement runs the same image and config and crashes the same way, and you have thrown away the `--previous` logs on that pod. Conversely, anything tied to pod identity (IP allow-lists, local caches, emptyDir data) survives a crash but not a deletion.',
  followups: [
    { q: 'You delete a pod that is in CrashLoopBackOff. What changes?', guidance: 'A new pod with a new name is created by the ReplicaSet, and its back-off timer starts fresh, so it may look briefly healthier. If the cause is config or the image, it crashes the same way. You have also lost the old pod\'s previous-container logs. Better: read logs --previous and the exit reason first.' },
    { q: 'Clients see errors for a second or two during every rollout even though pods are Ready. Why, and what would you change?', guidance: 'Pods receive SIGTERM while some proxies or load balancers still route to them, because endpoint updates propagate asynchronously. Fixes: handle SIGTERM by finishing in-flight requests, add a short preStop sleep so endpoint removal propagates before shutdown, make sure the grace period covers the drain, and check readiness behaviour during startup.' },
    { q: 'A container exits with code 137. What can you conclude?', guidance: '137 is 128 + 9, killed by SIGKILL. It is OOM only if the container status reason says OOMKilled. It can also be a kill after the grace period (for example after a liveness failure or deletion) or another SIGKILL source. Check lastState reason, events for liveness failures, and node events.' }
  ],
  misconceptions: [
    '"A crashing container gets a new pod." The kubelet restarts the container in the same pod; the pod is replaced only if it is deleted, evicted or its node is lost.',
    '"CrashLoopBackOff is the error." It is the back-off between restart attempts; the error is in the previous container\'s logs, exit code and events.',
    '"Deleting a pod kills it immediately." By default it gets a grace period: preStop, SIGTERM, wait, then SIGKILL. Only a forced deletion with zero grace skips this.',
    '"Exit code 137 means out of memory." 137 means SIGKILL; only the OOMKilled reason confirms the memory limit.'
  ],
  weak: [
    'Says "Kubernetes restarts the pod" for both cases without distinguishing kubelet restart from controller replacement',
    'Recommends deleting crash-looping pods as the first response',
    'Does not mention graceful termination or the grace period at all',
    'Does not mention what evidence (logs --previous, lastState, events) identifies the cause'
  ],
  evidence: '# example output: container crash (same pod, restart count climbs)\n$ kubectl get pod web-6f7c9d8b5d-x2k4p\nNAME                   READY   STATUS             RESTARTS      AGE\nweb-6f7c9d8b5d-x2k4p   0/1     CrashLoopBackOff   4 (32s ago)   3m\n$ kubectl describe pod web-6f7c9d8b5d-x2k4p | grep -A3 "Last State"\n    Last State:     Terminated\n      Reason:       Error\n      Exit Code:    1\n$ kubectl logs web-6f7c9d8b5d-x2k4p --previous | tail -2\nconfig: required key DATABASE_URL not set\n\n# example output: pod deletion (replacement has a new name)\n$ kubectl delete pod web-6f7c9d8b5d-q8m2t\npod "web-6f7c9d8b5d-q8m2t" deleted\n$ kubectl get pods -l app=web -o wide\nNAME                   READY   STATUS    IP            NODE\nweb-6f7c9d8b5d-7tr9d   1/1     Running   10.244.1.23   worker-1\n...',
  rubric: {
    strong: [
      'Crash: kubelet restarts in place per restartPolicy; same pod name, UID, IP, node; restartCount increments; exponential back-off',
      'Deletion: grace period, endpoint removal, preStop, SIGTERM then SIGKILL; ReplicaSet creates a new pod with new identity',
      'Calls CrashLoopBackOff a back-off state and names the evidence for the cause',
      'Notes that deleting a crash-looping pod does not fix the cause'
    ],
    acceptable: [
      'Explains through what `kubectl get pods` shows in each case (RESTARTS climbing vs a new pod name) if the mechanism is stated correctly',
      'Gives the back-off timing approximately or as "exponential, capped at a few minutes" rather than exact defaults'
    ],
    redFlags: [
      'Says the ReplicaSet restarts crashed containers',
      'Treats CrashLoopBackOff or exit 137 alone as a root cause',
      'Claims a replaced pod keeps its IP and name'
    ]
  },
  aws: { analogy: 'In ECS, an essential container exiting stops the whole task and the service scheduler launches a new task (new task ID, new ENI/IP); stopping a task sends SIGTERM, waits stopTimeout, then SIGKILL.', breaks: 'Kubernetes has two layers: the kubelet restarts a crashed container inside the same pod without any controller, and only deletion or eviction leads to a replacement pod. ECS (outside newer container restart options) generally replaces the task, so "same identity after a crash" has no direct ECS equivalent.' },
  refs: [
    { t: 'Pod lifecycle', u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/' },
    { t: 'Container lifecycle hooks', u: 'https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/' },
    { t: 'Debug running pods', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/' }
  ],
  verify: 'Restart back-off defaults (10s initial, 300s cap, reset after 10 minutes) — newer versions add kubelet settings and feature gates that change these; confirm for your cluster version.'
},

{ id: 'ons-q-arch-04', track: 'onsite', topic: 'arch', priority: 'P0', level: 2, mins: 5,
  prereqs: ['les-failure', 'les-scheduling'],
  labs: [],
  q: 'What happens when a worker node becomes unavailable?',
  context: 'A worker node running several Deployment pods and one StatefulSet pod with a ReadWriteOnce volume loses power. Walk through what the control plane notices, what it does, roughly how long it takes by default, and what you would check.',
  evaluates: [
    'Knows node health is detected through heartbeats (Lease renewals and node status) and the node lifecycle controller',
    'Can explain the unreachable/not-ready taints and default 300-second tolerations that delay eviction',
    'Knows Deployment pods are replaced elsewhere while StatefulSet pods are not force-replaced automatically',
    'Mentions volume attachment as a separate delay for ReadWriteOnce storage',
    'Hedges timings as defaults that depend on configuration and version'
  ],
  spoken: 'The kubelet heartbeats by renewing a Lease object and updating node status. When heartbeats stop, the node lifecycle controller waits a grace period, on the order of 40 to 50 seconds by default, then sets the node\'s Ready condition to Unknown and adds a NoExecute taint, `node.kubernetes.io/unreachable`.\n\nPods are not evicted immediately. By default, admission gives every pod a toleration for that taint with `tolerationSeconds: 300`, so after about five minutes those pods are deleted through the API. The node cannot confirm the deletion, so they can show as Terminating or Unknown, but the ReplicaSet no longer counts them and creates replacements that the scheduler places on healthy nodes. So Deployment capacity typically comes back in roughly five to six minutes, not seconds.\n\nThe StatefulSet is different. It will not create a new pod with the same identity until the old one is actually gone, because two copies of the same member could corrupt data. It stays stuck until the node returns, someone confirms the node is down and force-deletes or marks it out-of-service. And a ReadWriteOnce volume may still be attached to the dead node, so the new pod can wait on detach. DaemonSet pods tolerate these taints, so they simply stay bound to that node.',
  deep: '**Detection.** Each kubelet renews its Lease in the `kube-node-lease` namespace and periodically updates `.status` of its Node. The node lifecycle controller in kube-controller-manager watches these. If the Lease is not renewed within the node monitor grace period (a kube-controller-manager flag whose default has been around 40 to 50 seconds depending on version), it sets the node\'s `Ready` condition to `Unknown` (or `False` if the kubelet reports not ready) and taints the node with `node.kubernetes.io/unreachable:NoExecute` (or `node.kubernetes.io/not-ready:NoExecute`). The scheduler stops placing new pods there.\n\n**Taint-based eviction.** A NoExecute taint evicts pods that do not tolerate it. The DefaultTolerationSeconds admission plugin adds tolerations for both taints with `tolerationSeconds: 300` to pods that do not set their own, so pods stay bound for about five minutes after the taint appears. You can shorten or lengthen this per pod. DaemonSet pods get these tolerations without a time limit, so they are never evicted for this reason. Eviction is also rate-limited, and in a zone where a large fraction of nodes are unhealthy the controller slows or stops evicting, on the assumption that the problem is the network or the control plane rather than the nodes.\n\n**Replacement.** Eviction deletes the pod object. With the kubelet unreachable, nobody confirms the containers stopped, so the pod object lingers as Terminating. For a ReplicaSet this does not matter: terminating pods are not counted, so it creates new pods immediately and the scheduler puts them on healthy nodes. A pod not owned by any controller is simply gone.\n\n**StatefulSets.** A StatefulSet guarantees at most one pod per identity (`db-1`). The controller will not create a new `db-1` while the old object still exists, and it cannot safely assume the old one stopped: the node might be partitioned but still running and writing. Recovery options: the node comes back and the kubelet finishes the deletion; an operator confirms the node is really off and force-deletes the pod; or, when the node is confirmed shut down, applies the `node.kubernetes.io/out-of-service` taint so pods are force-deleted and volumes detached. Force deleting while the old pod is still running risks two writers.\n\n**Volumes.** A ReadWriteOnce block volume can be attached to one node at a time. The attach/detach controller may wait several minutes before force-detaching from an unreachable node, and a replacement pod can report a Multi-Attach error or stay ContainerCreating until then. Network filesystems with ReadWriteMany avoid that step but bring their own consistency questions.\n\n**What to check:** `kubectl get nodes`, `describe node` for conditions and taints, `get pods -o wide --field-selector spec.nodeName=NODE`, events for evictions, and `get volumeattachments` for storage. The design lesson: spread replicas across nodes and zones, set PodDisruptionBudgets for planned work, and do not assume sub-minute failover without tuning.',
  followups: [
    { q: 'The node comes back after 10 minutes. What happens to the old pods on it?', guidance: 'The kubelet reconnects, sees the pod objects are deleted or no longer bound to it, and kills the local containers. Replacements already running elsewhere stay. The taints are removed once the node reports Ready. For the StatefulSet, the stuck pod deletion completes and the controller recreates the pod, possibly back on the same node.' },
    { q: 'How would you make failover faster for a latency-sensitive Deployment, and what is the cost?', guidance: 'Set shorter tolerationSeconds on the not-ready/unreachable tolerations, run more replicas spread across nodes and zones so losing one node matters less, and rely on readiness to shift traffic. Cost: shorter tolerations evict pods during brief network blips, causing churn and possibly load spikes. Tuning controller flags affects the whole cluster.' },
    { q: 'Why does the controller stop evicting when many nodes in a zone go NotReady at once?', guidance: 'Mass NotReady is more likely a network partition or control-plane problem than mass node death. Evicting everything would move all workloads onto the remaining nodes (possibly overwhelming them) for a fault that is not in the nodes. It is a safety brake; the thresholds are configurable.' },
    { q: 'When is it safe to force-delete a StatefulSet pod on an unreachable node?', guidance: 'Only once you have confirmed through an independent channel (cloud console, out-of-band management, power state) that the node or its processes are really stopped, or have fenced it off. Otherwise a partitioned but running pod and its replacement can both write, which is the split-brain the StatefulSet guarantee exists to prevent.' }
  ],
  misconceptions: [
    '"Pods move to another node as soon as the node fails." By default there is a detection delay plus about five minutes of toleration before eviction, and pods are recreated, not moved.',
    '"Kubernetes migrates the running pod." Nothing is migrated; controllers create new pods, and in-memory state on the dead node is lost.',
    '"StatefulSet pods fail over like Deployment pods." The StatefulSet controller will not replace a pod whose deletion has not been confirmed, to avoid two pods with the same identity.',
    '"DaemonSet pods are rescheduled elsewhere." DaemonSet pods are per-node and tolerate these taints; nothing replaces them on other nodes.'
  ],
  weak: [
    'States exact timings as fixed facts without mentioning defaults or configuration',
    'Treats all workload types the same',
    'Ignores storage attachment for stateful workloads',
    'Proposes force-deleting pods without first confirming the node is really down'
  ],
  evidence: '# example output\n$ kubectl get nodes\nNAME       STATUS     ROLES    AGE   VERSION\nworker-1   Ready      <none>   40d   v1.xx.x\nworker-2   NotReady   <none>   40d   v1.xx.x\n\n$ kubectl describe node worker-2 | grep -E "Taints|Ready" \nTaints:             node.kubernetes.io/unreachable:NoExecute\n  Ready             Unknown   ...   NodeStatusUnknown   Kubelet stopped posting node status.\n\n$ kubectl get pods -o wide --field-selector spec.nodeName=worker-2\nNAME                   READY   STATUS        NODE\nweb-6f7c9d8b5d-q8m2t   1/1     Terminating   worker-2\ndb-1                   1/1     Terminating   worker-2\n\n$ kubectl get pod web-6f7c9d8b5d-q8m2t -o jsonpath=\'{.spec.tolerations}\'\n[{"effect":"NoExecute","key":"node.kubernetes.io/unreachable","operator":"Exists","tolerationSeconds":300}, ...]',
  rubric: {
    strong: [
      'Explains detection via Lease/status heartbeats and the node lifecycle controller setting Ready Unknown',
      'Describes NoExecute unreachable/not-ready taints and the default 300s tolerations added at admission',
      'Distinguishes Deployment replacement from StatefulSet behaviour and DaemonSet tolerations',
      'Mentions RWO volume detach/attach delays',
      'Hedges timings as defaults and says what they would check'
    ],
    acceptable: [
      'Describes the older "pod eviction timeout" mental model if they acknowledge that current versions use taint-based eviction with tolerations',
      'Gives approximate total time ("about five to six minutes by default") without naming every flag'
    ],
    redFlags: [
      'Claims pods are live-migrated or keep their state',
      'Recommends routinely force-deleting StatefulSet pods without fencing',
      'States failover happens in seconds by default'
    ]
  },
  aws: { analogy: 'An EC2 container instance failing in ECS: the agent disconnects, tasks on it are eventually marked stopped, and the service scheduler launches replacements on other instances; an EBS volume must be detached before attaching elsewhere.', breaks: 'Kubernetes exposes the delay as explicit, per-pod tolerations and taints you can tune, and treats StatefulSet identity specially. There is no ECS equivalent of the StatefulSet "at most one" guarantee blocking replacement until the old pod is confirmed gone.' },
  refs: [
    { t: 'Nodes (heartbeats, node controller)', u: 'https://kubernetes.io/docs/concepts/architecture/nodes/' },
    { t: 'Taints and tolerations (taint-based evictions)', u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/' },
    { t: 'Force delete StatefulSet pods', u: 'https://kubernetes.io/docs/tasks/run-application/force-delete-stateful-set-pod/' }
  ],
  verify: 'Node monitor grace period default (40s in older releases, 50s in newer ones) and the attach/detach controller\'s force-detach wait (about 6 minutes) — confirm for your cluster version. Default 300s not-ready/unreachable tolerations are documented on the taints page.'
},

{ id: 'ons-q-arch-05', track: 'onsite', topic: 'arch', priority: 'P0', level: 2, mins: 5,
  prereqs: ['les-reconcile', 'les-failure'],
  labs: [],
  q: 'What does a control-plane outage mean for already-running workloads?',
  context: 'The API servers become unreachable for 30 minutes (or etcd loses quorum). Nodes and their pods are otherwise healthy. What keeps working, what stops, and what risks build up the longer it lasts?',
  evaluates: [
    'Knows the data plane (kubelet, containers, programmed routing) keeps running without the API server',
    'Can list what stops: scheduling, scaling, rollouts, replacement across nodes, config changes, status updates',
    'Understands state goes stale rather than disappearing (endpoints, DNS answers)',
    'Distinguishes API server unavailability from etcd quorum loss and from etcd data loss',
    'Hedges implementation-dependent behaviour and names recovery risks'
  ],
  spoken: 'The short version: the data plane keeps running, but the cluster stops changing and stops healing across nodes.\n\nContainers already running keep running. The kubelet already has its pod specs, so it typically keeps restarting crashed containers locally. kube-proxy or whatever dataplane the cluster uses keeps the rules it last programmed, so existing Service routing generally keeps working. Cluster DNS usually keeps answering from what it last learned, though that depends on the DNS setup.\n\nWhat stops is anything that needs a write or a watch: no new pods scheduled, no scaling, no rollouts or rollbacks, no replacement of pods if a node dies, no ConfigMap or Secret changes, and endpoint lists freeze. That last one matters: if a pod dies during the outage, routing may keep sending traffic to it, because nothing updates the endpoints.\n\nThe longer it lasts, the more risk: short-lived service account tokens may not be refreshed, certificates may not rotate, and when the API comes back, controllers act on a lot of stale state at once.\n\nI\'d separate API server down from etcd quorum lost, which blocks writes, and from etcd data lost, where you restore a snapshot and controllers then reconcile the cluster back to that older state.',
  deep: '**What keeps working.** The kubelet runs pods from its local knowledge. Already-running containers are unaffected, and the kubelet typically restarts crashed containers according to restartPolicy without asking the API server. Liveness probes still run locally. The node dataplane (iptables, IPVS, nftables or eBPF rules programmed by kube-proxy or an alternative) keeps forwarding according to the last programmed state, so ClusterIP and NodePort traffic continues. Pod-to-pod networking via the CNI generally continues because routes and interfaces are already in place, though some CNI implementations depend on their own datastore or the API for changes. Cluster DNS servers (for example CoreDNS) generally keep serving from their in-memory view of Services and endpoints; behaviour on restart of the DNS pod itself during the outage depends on implementation.\n\n**What stops.** Everything that needs the API: creating, scheduling or deleting pods; Deployment rollouts; HPA scaling; Job creation; ConfigMap and Secret updates; RBAC changes; `kubectl` itself. The node lifecycle controller cannot mark nodes NotReady, so a node dying during the outage is not detected, and its pods are not replaced. Readiness changes are not propagated to EndpointSlices, so a pod that fails readiness or dies keeps receiving traffic from proxies that still list it. Admission webhooks and operators stop acting.\n\n**Risks that grow with time.** Projected service account tokens are short-lived and refreshed by the kubelet through the API; after a long outage, workloads calling the API or using federated identity may start failing authentication. Kubelet client and serving certificate rotation needs the API. Logs of "failed to update status" pile up but are harmless. When the API returns, a large thundering herd of watches re-lists; if nodes could not renew leases during the outage, the node lifecycle controller has protections (it treats all nodes going unhealthy at once as a disruption rather than evicting everything), but you should still watch closely.\n\n**Three different failures.**\n- *API servers unavailable, etcd fine:* as above; recovery is restoring the API servers, state is intact.\n- *etcd quorum lost:* the API server cannot commit writes; reads may fail or be served stale depending on configuration and caching. Effect on workloads is similar, and restoring quorum restores the cluster.\n- *etcd data lost or corrupted:* you restore a snapshot. The cluster now believes the world looks like the snapshot: objects created after it are gone, and controllers will reconcile running reality back toward it, which can delete pods or recreate old ones. That is why etcd backup frequency and restore drills matter.\n\n**How to talk about it in an incident.** State the blast radius precisely ("serving traffic continues on existing pods; no deploys, scaling or node-failure recovery until restored"), freeze changes that need the API, and prioritise restoring control-plane quorum over touching nodes.',
  followups: [
    { q: 'During the outage a node dies. What happens to its pods and to traffic?', guidance: 'Nothing detects it: no NotReady, no taints, no eviction, no replacements. Proxies on other nodes still route to the dead pod IPs because EndpointSlices are frozen, so a share of connections fail or time out. After recovery the node lifecycle controller notices and normal eviction follows, subject to its disruption safeguards.' },
    { q: 'How would you design a control plane so this is rare?', guidance: 'Multiple API server instances behind a load balancer, an odd-sized etcd cluster (3 or 5) across failure domains, stacked or external etcd trade-offs, regular tested etcd snapshots stored off-cluster, monitoring of etcd latency and quorum, and limiting heavy clients. A managed control plane shifts this responsibility but not the need to understand the failure mode.' },
    { q: 'You must restore etcd from a two-hour-old snapshot. What do you warn the team about?', guidance: 'Any object created, changed or deleted in those two hours is reverted: deployments, secrets, scaled replicas, CRD instances. Controllers will act on the restored state, which may delete pods that exist but are not in the snapshot or recreate removed ones. Re-apply from source of truth (Git or pipeline) afterwards and verify operator-managed state carefully.' }
  ],
  misconceptions: [
    '"If the control plane is down, all apps go down." Running containers and programmed routing generally keep working; what stops is change and cross-node healing.',
    '"Nothing restarts without the API server." The kubelet typically restarts crashed containers locally according to restartPolicy.',
    '"Service routing is always accurate." During an outage endpoint lists are frozen, so traffic can keep going to pods that have died.',
    '"etcd down and etcd data loss are the same problem." Quorum loss blocks writes until restored; data loss means restoring an older snapshot and reconciling to it.'
  ],
  weak: [
    'Answers only "the cluster is down" with no split between data plane and control plane',
    'States behaviour of DNS or CNI absolutely without acknowledging implementation differences',
    'Does not mention that node failures during the outage go undetected',
    'Ignores backups and restore consequences for etcd'
  ],
  evidence: '# example output (API servers unreachable)\n$ kubectl get pods\nThe connection to the server api.cluster.example:6443 was refused - did you specify the right host or port?\n\n# on a node (if you have node access)\n$ crictl ps | head -3\nCONTAINER      IMAGE          STATE     NAME   POD ID\n3f1c2a9d...    a1b2c3...      Running   web    9e8d...\n$ journalctl -u kubelet --since "10 min ago" | grep -m2 -i "failed"\n... Error updating node status, will retry: error getting node "worker-2": ... connection refused\n\n# from another pod: routing still works to existing endpoints\n$ curl -s -o /dev/null -w "%{http_code}\\n" http://web.default.svc.cluster.local/healthz\n200',
  rubric: {
    strong: [
      'Clearly separates what keeps running (containers, local restarts, programmed routing) from what stops (scheduling, scaling, rollouts, config changes, cross-node healing)',
      'Points out frozen endpoints and undetected node failures as the hidden risk',
      'Mentions long-outage risks such as token or certificate refresh',
      'Distinguishes API server outage, etcd quorum loss and etcd data loss with restore consequences',
      'Hedges DNS/CNI behaviour as implementation-dependent'
    ],
    acceptable: [
      'Frames the answer as an incident communication (blast radius, change freeze, priorities) if the technical split is correct',
      'Focuses on a managed control plane scenario while still explaining the data plane continues'
    ],
    redFlags: [
      'Says all workloads stop immediately when the API server is down',
      'Suggests restarting all nodes or pods as a first response',
      'Claims etcd restore is harmless because "Kubernetes will fix it"'
    ]
  },
  aws: { analogy: 'Similar to the ECS control plane being impaired in a region: running tasks keep running and the ALB keeps routing to registered targets, but you cannot deploy, scale or replace failed tasks.', breaks: 'With ECS you never operate or restore the control plane; in Kubernetes you may own etcd backups and quorum, and a restore rewinds cluster state that controllers then act on. Endpoint freezing also happens at the node dataplane rather than at a managed load balancer.' },
  refs: [
    { t: 'Kubernetes components', u: 'https://kubernetes.io/docs/concepts/overview/components/' },
    { t: 'Operating etcd clusters (backup and restore)', u: 'https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/' },
    { t: 'Options for highly available topology', u: 'https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/ha-topology/' }
  ],
  verify: 'Behaviour of cluster DNS, the CNI and the node dataplane while the API server is unavailable is implementation-dependent — confirm for the DNS server, CNI and proxy mode in use. Projected service account token default lifetime and kubelet refresh timing — confirm for your version.'
},

{ id: 'ons-q-arch-06', track: 'onsite', topic: 'arch', priority: 'P1', level: 2, mins: 4,
  prereqs: ['les-operators', 'les-reconcile'],
  labs: [],
  q: 'What does an operator add beyond a Deployment?',
  context: 'A team runs a clustered database on Kubernetes using an operator. A colleague asks why they could not just use a Deployment (or StatefulSet) and a few scripts. Explain what an operator actually is and what it adds, including risks.',
  evaluates: [
    'Defines an operator as custom resources plus a controller that encodes domain-specific operational knowledge',
    'Distinguishes the operator\'s own Deployment from the resources it manages',
    'Gives concrete examples of app-specific reconciliation (failover, backups, version upgrades, membership)',
    'Names operational risks: operator bugs, RBAC breadth, CRD and version skew, upgrade ordering'
  ],
  spoken: 'A Deployment knows one thing: keep N identical, interchangeable pods running and roll them to a new template. It knows nothing about the application inside.\n\nAn operator is the pattern of adding a custom resource, defined by a CRD, plus a controller that watches it and encodes how a human expert would run that application. You declare something like "a database cluster, three members, version X, nightly backups", and the controller reconciles that into StatefulSets, Services, Secrets and PVCs, and then keeps doing the operational work: choosing a new primary on failure, adding members in the right order, running backups, doing version upgrades step by step, rotating credentials.\n\nThe operator itself usually runs as a Deployment, so it is not a different kind of workload; it is a different kind of logic.\n\nThe trade-off is that you are trusting that controller. A bug gets applied everywhere automatically. It usually needs broad RBAC, sometimes cluster-wide. And you now have CRD versions, operator versions and application versions to keep compatible. So I\'d evaluate an operator the way I\'d evaluate any automation that acts on production: what it does on failure, how to pause it, and how to recover if it misbehaves.',
  deep: '**Two parts.** A CustomResourceDefinition extends the Kubernetes API with a new type, for example `DatabaseCluster`, stored in etcd like any object and accessible with kubectl, RBAC and admission. On its own a CRD does nothing; it is just data. The controller is the behaviour: a process (usually a Deployment in its own namespace) that watches those custom resources and the objects it creates, and runs a reconcile loop comparing the declared spec with observed reality.\n\n**What goes in the reconcile loop.** Everything a runbook would say, turned into code:\n- Creating and wiring underlying objects: StatefulSets, headless and client Services, ConfigMaps, Secrets, PodDisruptionBudgets.\n- Membership: bootstrapping a cluster, joining new members, removing members safely, preserving quorum.\n- Failover: detecting a failed primary and promoting a replica using application-level health, not just pod readiness.\n- Upgrades: ordered, version-aware steps (for example upgrade replicas first, check replication, then switch primary), sometimes with data migrations.\n- Backups and restore, credential rotation, scaling storage.\n- Status: writing application-level health into the custom resource\'s `status` so humans and other tools can see it.\n\n**Why not a StatefulSet and scripts?** A StatefulSet gives stable identity and storage, but it will happily roll pods in ordinal order with no idea whether the cluster is healthy between steps. Scripts run once; a controller runs continuously and reacts to changes and failures. The operator is where that knowledge lives persistently and declaratively.\n\n**Risks to name.**\n- *Blast radius:* automation amplifies bugs. A wrong failover decision or a bad upgrade path is applied everywhere the operator manages.\n- *Permissions:* operators often need to create Secrets, Services, StatefulSets, sometimes cluster-scoped objects. Scope RBAC to what it needs and to the namespaces it manages where possible.\n- *Version skew:* CRD schema versions, the operator version and supported application versions must line up; upgrading the operator can change how existing resources are reconciled. CRDs are cluster-scoped, so two teams cannot easily run different versions of the same operator.\n- *Deletion semantics:* finalizers on custom resources can block deletion if the operator is gone, and deleting a custom resource may cascade to data.\n- *Operability:* know how to pause reconciliation for manual intervention, what metrics and events it exposes, and how to recover if the operator is down (the managed pods keep running; the operational logic stops).',
  followups: [
    { q: 'The operator pod is crash-looping. What happens to the database it manages?', guidance: 'The database pods keep running; the StatefulSets and Services still exist and the built-in controllers still maintain them. What stops is application-level logic: no automated failover, backups, scaling or upgrades. Fix the operator, and be careful: when it comes back it will reconcile everything at once.' },
    { q: 'How would you evaluate a third-party operator before running it in production?', guidance: 'Read what RBAC it requests and whether it can be namespace-scoped; check CRD versioning and upgrade path; test failure modes (kill primary, lose a node, fill a disk) in a non-production cluster; check how to pause reconciliation; confirm backup and restore actually work; review how it handles deletion and finalizers; check project maintenance and release cadence.' },
    { q: 'How is a custom resource different from a ConfigMap you read with a script?', guidance: 'A custom resource is a first-class API type with its own schema validation, versioning, RBAC per resource type, status subresource, watch support and kubectl integration. A ConfigMap is untyped key/value data. The controller watching a CR reacts to changes continuously and reports status back on the object.' }
  ],
  misconceptions: [
    '"An operator is just another name for a Deployment." An operator is custom resources plus a controller with domain logic; the controller often runs as a Deployment, but what it adds is the reconciliation of application-specific state.',
    '"Installing a CRD adds behaviour." A CRD only defines a new object type; without a running controller nothing acts on it.',
    '"The operator keeps the app running, so if it dies the app dies." The managed workloads keep running; only the automated operations stop.'
  ],
  weak: [
    'Defines an operator only as "automation" without mentioning CRDs and a reconcile loop',
    'Lists benefits without any risks or trade-offs',
    'Cannot give a concrete example of logic a Deployment lacks'
  ],
  evidence: '# example output\n$ kubectl get crd | grep example.com\ndatabaseclusters.db.example.com   2026-03-02T10:14:05Z\n\n$ kubectl get databaseclusters -n data\nNAME     MEMBERS   READY   PRIMARY    VERSION   AGE\norders   3         3       orders-1   16.4      41d\n\n$ kubectl get deploy -n db-operator\nNAME          READY   UP-TO-DATE   AVAILABLE\ndb-operator   1/1     1            1\n\n$ kubectl get statefulset,svc -n data -l app.kubernetes.io/managed-by=db-operator\nNAME                      READY\nstatefulset.apps/orders   3/3\nNAME                     TYPE        CLUSTER-IP\nservice/orders-primary   ClusterIP   10.96.8.14\nservice/orders-members   ClusterIP   None',
  rubric: {
    strong: [
      'Defines operator = CRD(s) + controller encoding domain knowledge via reconciliation',
      'Gives concrete app-specific examples (failover, ordered upgrades, backups, membership)',
      'Notes the operator itself usually runs as a Deployment and manages built-in objects underneath',
      'Names at least two risks: bug amplification, broad RBAC, version skew, deletion/finalizer behaviour'
    ],
    acceptable: [
      'Frames it as "a runbook turned into a continuously running controller" if CRDs and reconciliation are mentioned',
      'Uses a specific well-known operator as an example, as long as the general pattern is explained'
    ],
    redFlags: [
      'Says an operator is the same thing as a Deployment or Helm chart',
      'Claims operators remove the need to understand the application\'s failure modes',
      'Ignores permissions entirely'
    ]
  },
  aws: { analogy: 'A managed service control plane (for example, what RDS or a managed search service does for failover, backups and upgrades), or a custom CloudFormation resource backed by a Lambda that encodes domain logic.', breaks: 'A managed AWS service runs its automation outside your account and you consume an API; an operator runs inside your cluster with your RBAC, your upgrades and your on-call. A CloudFormation custom resource acts once per stack operation, while an operator reconciles continuously.' },
  refs: [
    { t: 'Operator pattern', u: 'https://kubernetes.io/docs/concepts/extend-kubernetes/operator/' },
    { t: 'Custom resources', u: 'https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/' },
    { t: 'Controllers', u: 'https://kubernetes.io/docs/concepts/architecture/controller/' }
  ],
  verify: ''
},

{ id: 'ons-q-arch-07', track: 'onsite', topic: 'arch', priority: 'P0', level: 2, mins: 4,
  prereqs: ['les-workloads', 'les-storage'],
  labs: [],
  q: 'When would you choose a StatefulSet, DaemonSet or Job instead of a Deployment?',
  context: 'You are reviewing manifests for a new platform: a web API, a three-node search cluster, a log shipper that must run on every node, and a nightly data export. Say which controller fits each and why.',
  evaluates: [
    'Matches each controller to the property it guarantees (interchangeable replicas, stable identity, one per node, run to completion)',
    'Knows StatefulSet details: ordinal names, per-pod PVCs via volumeClaimTemplates, headless Service, ordered operations',
    'Knows StatefulSet does not provide replication or clustering logic by itself',
    'Knows Job/CronJob semantics: completions, restartPolicy, backoffLimit'
  ],
  spoken: 'I pick by the guarantee I need.\n\nThe web API is a Deployment: replicas are interchangeable, any pod can be killed and replaced with a new name and IP, and rolling updates are what I want.\n\nThe search cluster wants a StatefulSet. Each pod gets a stable ordinal name, like search-0, search-1, a stable DNS name through a headless Service, and its own PersistentVolumeClaim from volumeClaimTemplates that follows that identity when the pod is replaced. Pods are created, scaled and updated in order by default. What a StatefulSet does not do is replicate data or manage cluster membership; that is still the application\'s job, or an operator\'s.\n\nThe log shipper is a DaemonSet: one pod per eligible node, added automatically when nodes join. Node agents, CNI components and monitoring exporters are typical.\n\nThe nightly export is a CronJob creating Jobs. A Job runs pods to successful completion rather than keeping them running, with a retry limit, and restartPolicy OnFailure or Never.\n\nThe mistake I watch for is running stateful software in a Deployment with a shared volume, or running batch work in a Deployment where "restart forever" hides failures.',
  deep: '**Deployment: interchangeable replicas.** Pods have random suffixes, no stable identity, and are replaced freely. Rolling updates with maxSurge/maxUnavailable. Volumes are either ephemeral or a PVC shared by all replicas, which only works with ReadWriteMany storage and an app designed for shared storage. Right for stateless services and workers pulling from a queue.\n\n**StatefulSet: stable identity and storage.** Pods are named `<name>-0..N-1`. With a headless Service (`clusterIP: None`) set as `serviceName`, each pod gets a DNS name like `search-0.search.ns.svc.cluster.local`, which is what peers use for discovery. `volumeClaimTemplates` create one PVC per ordinal; when `search-1` is replaced it reattaches to `search-1`\'s claim. Default `OrderedReady` pod management creates pods in order and waits for each to be Ready; `Parallel` relaxes that. Rolling updates go in reverse ordinal order, and `partition` allows staged updates. PVCs are retained by default when scaling down or deleting (configurable via `persistentVolumeClaimRetentionPolicy`, depending on version). Crucially, the StatefulSet gives identity, not correctness: data replication, quorum, leader election and safe member removal are the application\'s responsibility, which is often why an operator sits on top.\n\n**DaemonSet: one per node.** Runs a pod on every node matching its node selector/affinity, and adds or removes pods as nodes join or leave. DaemonSet pods tolerate certain node-condition taints automatically and are not evicted when a node becomes unreachable. Typical uses: log and metric agents, CNI and storage node plugins, security agents. Updates roll node by node. Do not use it just to "spread" an app; topology spread constraints on a Deployment do that without tying replica count to node count.\n\n**Job and CronJob: run to completion.** A Job creates pods until a number of them succeed (`completions`, with `parallelism`), retrying failures up to `backoffLimit`. Pods use `restartPolicy: OnFailure` or `Never`. `activeDeadlineSeconds` bounds runtime and `ttlSecondsAfterFinished` cleans up. A CronJob creates Jobs on a schedule, with `concurrencyPolicy` to handle overlap. Jobs should be idempotent because retries and, occasionally, duplicate runs can happen.\n\n**How to answer the review.** Map each workload to its failure semantics: what should happen when a pod dies, when a node joins, when the work finishes. That question, not the resource names, is what the interviewer is checking.',
  followups: [
    { q: 'A StatefulSet pod is stuck and the whole rollout is blocked. Why can that happen?', guidance: 'With OrderedReady management and rolling updates, the controller waits for each pod to become Ready before moving on. A pod that never becomes Ready (bad config, failing probe, volume stuck attaching) blocks progress. Unlike Deployments, a broken update may need manual intervention: fix the template and possibly delete the stuck pod so it is recreated with the new revision.' },
    { q: 'Why not run a three-node search cluster as a Deployment with one shared ReadWriteMany volume?', guidance: 'Members need their own data directories and stable identities for discovery and shard/replica placement. Shared storage can cause corruption or locking problems and removes the independence replicas exist to provide. Random pod names break peer configuration. A StatefulSet (plus the application\'s own replication) matches the design.' },
    { q: 'Your nightly CronJob sometimes runs twice or not at all. What would you check?', guidance: 'concurrencyPolicy and whether the previous run was still going; startingDeadlineSeconds and controller downtime (missed schedules); time zone configuration; Job failures hitting backoffLimit; and whether the job is idempotent. Check Job and pod events and history limits.' }
  ],
  misconceptions: [
    '"A StatefulSet makes an application highly available or replicates its data." It provides stable identity, ordering and per-pod storage; replication and failover are the application\'s job.',
    '"A DaemonSet is for running one of something." It runs one pod per eligible node; for a singleton, use a Deployment with one replica (or leader election).',
    '"A Job is a Deployment that stops." A Job tracks successful completions, retries on failure up to a limit, and does not use restartPolicy Always.'
  ],
  weak: [
    'Chooses StatefulSet "because it has a database" without explaining identity and storage',
    'Does not know StatefulSet pods keep their PVCs across replacement',
    'Suggests a Deployment with sleep loops for scheduled work'
  ],
  evidence: '# example output\n$ kubectl get statefulset,pods,pvc -l app=search\nNAME                      READY\nstatefulset.apps/search   3/3\nNAME           READY   STATUS\npod/search-0   1/1     Running\npod/search-1   1/1     Running\npod/search-2   1/1     Running\nNAME                                    STATUS   CAPACITY   ACCESS MODES\npersistentvolumeclaim/data-search-0     Bound    100Gi      RWO\npersistentvolumeclaim/data-search-1     Bound    100Gi      RWO\n...\n\n$ kubectl get ds -n logging\nNAME        DESIRED   CURRENT   READY   NODE SELECTOR\nlog-agent   6         6         6       kubernetes.io/os=linux\n\n$ kubectl get cronjob,job -n batch\nNAME                         SCHEDULE    LAST SCHEDULE\ncronjob.batch/nightly-export 30 2 * * *  7h\nNAME                                 STATUS     COMPLETIONS\njob.batch/nightly-export-29311590    Complete   1/1',
  rubric: {
    strong: [
      'Chooses Deployment, StatefulSet, DaemonSet and CronJob/Job correctly for the four workloads',
      'Explains StatefulSet identity: ordinal names, headless Service DNS, per-pod PVCs, ordered operations',
      'States StatefulSet does not replicate data or manage membership',
      'Describes Job completion and retry semantics'
    ],
    acceptable: [
      'Proposes an operator for the search cluster, as long as they note it typically creates a StatefulSet underneath',
      'Suggests a Deployment for stateful software that keeps all state in an external managed store, with that reasoning stated'
    ],
    redFlags: [
      'Uses a DaemonSet to get high availability for a normal service',
      'Claims StatefulSets provide automatic failover or replication',
      'Runs batch work as a Deployment without addressing completion or failure'
    ]
  },
  aws: { analogy: 'ECS REPLICA service ≈ Deployment; ECS DAEMON scheduling strategy ≈ DaemonSet; RunTask or EventBridge Scheduler running a task ≈ Job/CronJob.', breaks: 'ECS has no direct StatefulSet equivalent that gives ordinal identity, per-member DNS and per-member volumes that follow a replacement. The closest ECS patterns build that from separate services or external discovery.' },
  refs: [
    { t: 'StatefulSets', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/' },
    { t: 'DaemonSet', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/' },
    { t: 'Jobs', u: 'https://kubernetes.io/docs/concepts/workloads/controllers/job/' }
  ],
  verify: 'StatefulSet persistentVolumeClaimRetentionPolicy availability and defaults — confirm for your cluster version.'
},

{ id: 'ons-q-arch-08', track: 'onsite', topic: 'arch', priority: 'P1', level: 2, mins: 4,
  prereqs: ['les-workloads', 'les-services', 'ons-q-arch-02'],
  labs: ['ons-lab-03'],
  q: 'How do labels, selectors and owner references work together — and what happens if you relabel a running pod?',
  context: 'A Deployment `web` (selector `app=web`) runs 3 pods behind a Service with selector `app=web`. You run `kubectl label pod web-6f7c9d8b5d-x2k4p app=web-debug --overwrite`. Explain what each controller does next, and why.',
  evaluates: [
    'Knows labels are arbitrary key/value metadata and selectors match on them (equality and set-based)',
    'Knows ownerReferences record who controls an object and drive garbage collection',
    'Can predict orphaning and replacement when a pod stops matching its ReplicaSet selector',
    'Knows Service selection is independent and changes with the label'
  ],
  spoken: 'Labels are just key/value metadata. Selectors are queries over labels. Owner references are a separate field on the object saying which controller owns it, and garbage collection follows them.\n\nWhen I change that pod\'s `app` label to `web-debug`, it no longer matches the ReplicaSet\'s selector. The ReplicaSet controller releases it, which removes its ownerReference, so the pod is now orphaned but keeps running. The ReplicaSet counts two matching pods, wants three, and creates a replacement.\n\nThe Service selects `app=web`, so the relabeled pod also drops out of the Service\'s EndpointSlices and stops getting new traffic. Existing connections may continue until they close.\n\nSo I end up with four pods: three serving, one isolated that I can debug, exec into, or take a heap dump from without it taking traffic. That is actually a useful technique. The catch is that nothing owns it anymore, so deleting the Deployment will not clean it up; I have to delete it myself.\n\nThe reverse also works: a bare pod whose labels match a ReplicaSet selector and has no controller owner can be adopted, and then possibly deleted if the ReplicaSet is over its count.',
  deep: '**Labels and selectors.** Labels are identifying key/value pairs on any object. Selectors come in two forms: equality-based (`app=web`, `tier!=cache`) and set-based (`env in (prod, staging)`, `!legacy`). Workload controllers in apps/v1 use `matchLabels`/`matchExpressions`; Services use a simple equality map. A selector matches when all of its terms are satisfied, so extra labels on the pod are fine; missing or different ones are not. Selectors do not warn when they match nothing.\n\n**Owner references.** `metadata.ownerReferences` lists owners, with at most one marked `controller: true`. The ReplicaSet controller manages pods that match its selector and either are controlled by it or have no controller (in which case it adopts them by adding an ownerReference). If a controlled pod stops matching, the controller releases it by removing the ownerReference. The Deployment has the same relationship with ReplicaSets, which is why a Deployment\'s selector is immutable in apps/v1: changing it would orphan everything.\n\n**Garbage collection.** When an owner is deleted, the garbage collector deletes dependents according to the propagation policy: background by default for kubectl (owner goes first, dependents are cleaned up after), foreground (dependents first, owner blocked by a finalizer until done), or orphan (`--cascade=orphan`, dependents stay and lose the reference). Cross-namespace owner references are not allowed for namespaced dependents.\n\n**The relabel, step by step.**\n1. The pod\'s labels change; its containers are not touched.\n2. The ReplicaSet controller sees the pod no longer matches and releases it (ownerReference removed).\n3. The ReplicaSet counts 2 of 3 and creates a replacement pod.\n4. The EndpointSlice controller sees the pod no longer matches the Service selector and removes it from the slices; proxies stop sending new connections.\n5. The orphaned pod runs until someone deletes it. It is invisible to `kubectl get pods -l app=web` and to Deployment status.\n\nIf you had changed a label that is in the Service selector but not the ReplicaSet selector, the pod would stay owned but leave the Service, and no replacement would be created, reducing serving capacity. If you had changed a label in neither, nothing would happen.\n\n**Evidence:** `kubectl get pods --show-labels` or `-L app`, `kubectl get pod X -o jsonpath=\'{.metadata.ownerReferences}\'`, `kubectl get endpointslices -l kubernetes.io/service-name=web`.',
  followups: [
    { q: 'You label the orphaned pod back to app=web. What happens?', guidance: 'It matches the ReplicaSet selector again and has no controller owner, so the ReplicaSet may adopt it. Now there are 4 matching pods for a desired count of 3, so the ReplicaSet deletes one, using its ranking (for example preferring not-ready, newer or more crowded pods). The Service adds it back to endpoints once it is Ready.' },
    { q: 'Why is a Deployment\'s selector immutable, and what goes wrong with overlapping selectors?', guidance: 'Changing the selector would make existing ReplicaSets and pods unmatched and orphaned while new ones are created. Overlapping selectors between two controllers can make them fight over pods; ownerReferences prevent direct stealing of controlled pods, but orphaned or bare pods can be adopted unexpectedly and Services may route to pods from both.' },
    { q: 'How would you find everything that belongs to a Deployment, and everything a Service is routing to?', guidance: 'Ownership: follow ownerReferences (Deployment → ReplicaSets with matching pod-template-hash → pods), or list by the selector and check ownerReferences. Routing: read the Service selector, then EndpointSlices with label kubernetes.io/service-name, which show addresses, target pod references and ready conditions.' }
  ],
  misconceptions: [
    '"Relabeling a pod restarts it." Labels are metadata; the running containers are unaffected.',
    '"Owner references and selectors are the same thing." Selectors are how controllers find candidates; ownerReferences record which controller actually owns an object and drive garbage collection.',
    '"Deleting the Deployment will clean up the debug pod." The released pod has no ownerReference, so garbage collection ignores it.'
  ],
  weak: [
    'Predicts the pod is deleted or restarted',
    'Forgets the Service side of the change',
    'Cannot name how garbage collection decides what to delete'
  ],
  evidence: '# example output\n$ kubectl label pod web-6f7c9d8b5d-x2k4p app=web-debug --overwrite\npod/web-6f7c9d8b5d-x2k4p labeled\n\n$ kubectl get pods -L app\nNAME                   READY   STATUS    AGE   APP\nweb-6f7c9d8b5d-7tr9d   1/1     Running   8s    web\nweb-6f7c9d8b5d-q8m2t   1/1     Running   2d    web\nweb-6f7c9d8b5d-x2k4p   1/1     Running   2d    web-debug\nweb-6f7c9d8b5d-zz81c   1/1     Running   2d    web\n\n$ kubectl get pod web-6f7c9d8b5d-x2k4p -o jsonpath=\'{.metadata.ownerReferences}\'\n(empty: the pod has been released)\n\n$ kubectl get endpointslices -l kubernetes.io/service-name=web -o wide\nNAME        ADDRESSTYPE   PORTS   ENDPOINTS\nweb-7xk2p   IPv4          8080    10.244.1.23,10.244.2.14,10.244.3.9',
  rubric: {
    strong: [
      'Explains labels, selectors (all terms must match) and ownerReferences as distinct mechanisms',
      'Predicts orphaning plus replacement by the ReplicaSet',
      'Predicts removal from Service endpoints because the Service selector no longer matches',
      'Notes the orphan is not garbage-collected with the Deployment',
      'Mentions the debugging use or the adoption behaviour in reverse'
    ],
    acceptable: [
      'Explains through what `kubectl get` output would show rather than controller internals, if the outcome is correct',
      'Describes Service removal as "no longer in endpoints" without naming EndpointSlices'
    ],
    redFlags: [
      'Says the pod is killed or restarted by the relabel',
      'Claims the Service owns or recreates pods',
      'Proposes editing selectors on a live Deployment as a routine fix'
    ]
  },
  aws: { analogy: 'Resource tags used for selection, like tag-based targeting; deregistering one task from an ALB target group to inspect it.', breaks: 'AWS tags rarely drive runtime membership, and deregistering a target does not make ECS launch a replacement. In Kubernetes, labels are the live membership mechanism for both controllers and Services, so one label change affects ownership and routing at once.' },
  refs: [
    { t: 'Labels and selectors', u: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/' },
    { t: 'Owners and dependents', u: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/' },
    { t: 'Garbage collection', u: 'https://kubernetes.io/docs/concepts/architecture/garbage-collection/' }
  ],
  verify: ''
},

{ id: 'ons-q-arch-09', track: 'onsite', topic: 'arch', priority: 'P1', level: 2, mins: 4,
  prereqs: ['les-reconcile', 'ons-q-arch-01'],
  labs: [],
  q: 'What does "declarative, desired state" mean in practice, and what happens when someone changes a live object by hand?',
  context: 'Manifests live in Git and are applied by a pipeline or a GitOps controller. During an incident an engineer runs `kubectl scale deploy/web --replicas=10` and `kubectl edit` to bump a memory limit. What happens to those changes, now and at the next sync?',
  evaluates: [
    'Explains declarative as "state what you want, controllers converge", versus imperative commands',
    'Knows which layer reverts which change: built-in controllers only enforce their own spec, not your Git intent',
    'Understands apply semantics at a high level: last-applied configuration or server-side apply field ownership',
    'Can reason about drift and how a GitOps controller or HPA interacts with manual changes'
  ],
  spoken: 'Declarative means I store the state I want as objects, and controllers keep working to make reality match. I do not tell the system the steps.\n\nBut there are two layers of "desired state", and the question is which one someone changed. The live object in the API is what Kubernetes controllers enforce. Git is what my pipeline or GitOps controller enforces.\n\nIf the engineer runs `kubectl scale` to 10, that changes the Deployment\'s spec itself. The Deployment controller will not revert it; 10 is now the desired state as far as Kubernetes knows. If an HPA manages that Deployment, it will overwrite replicas on its next evaluation. If a GitOps controller has drift correction on, it will set it back to the Git value; if not, it will just show the app as out of sync, and the next apply of that field resets it.\n\nThe memory limit edit changes the pod template, so it triggers a rollout. Same logic for reverting.\n\nIn contrast, editing an object a controller owns, like a pod or a ReplicaSet under a Deployment, gets reverted or replaced quickly.\n\nThe fix for an incident is to make the change in Git, or record it and reconcile Git right after.',
  deep: '**Declarative versus imperative.** Imperative: "create this, then scale to 5, then set image". Declarative: "this is the full spec; make it so". `kubectl apply -f` and GitOps controllers are declarative: they compute the difference between the desired manifest and the live object and patch only what differs. The cluster itself is also declarative internally: every controller compares a spec with observed state.\n\n**Who enforces what.**\n- *Built-in controllers* enforce the objects they own from their parent\'s spec. Edit a pod created by a ReplicaSet, delete it, or scale a ReplicaSet owned by a Deployment, and the parent controller corrects it. Change the Deployment\'s own spec, and there is nothing above it inside Kubernetes to correct it.\n- *Autoscalers* own specific fields: an HPA writes `spec.replicas` of its target. Manual scaling of an HPA-managed Deployment is overwritten, and Git manifests should usually omit replicas for HPA-managed workloads to avoid fights.\n- *GitOps controllers or pipelines* enforce the repository. A GitOps controller typically detects drift continuously; whether it reverts it automatically depends on its configuration (auto-sync, self-heal or equivalent). A push-based pipeline only reverts on its next run.\n\n**How apply decides what to change.** Client-side `kubectl apply` stores the last applied manifest in an annotation and does a three-way merge: fields you removed from the manifest are deleted, fields someone else set that were never in your manifest are left alone. Server-side apply moves this into the API server: each field in `metadata.managedFields` records which manager owns it. If a different manager changed a field you own, applying again reports a conflict unless you force it, which makes ownership visible instead of silently overwriting. You can see managers with `kubectl get -o yaml --show-managed-fields`.\n\n**The incident trade-off.** Hand changes are sometimes the right fast action. The discipline is: announce it, record exactly what changed, and either commit it to Git immediately or pause automatic sync for that app deliberately, so the fix is neither silently reverted mid-incident nor silently kept forever. `kubectl diff -f` shows the gap between the live object and the manifest before anyone reapplies.',
  followups: [
    { q: 'A GitOps controller keeps reverting your emergency fix during an incident. What do you do?', guidance: 'Commit the change to the source repository through the fast path, or suspend auto-sync for that application explicitly and record that you did. Do not fight the controller by repeatedly re-applying. After the incident, reconcile Git and re-enable sync.' },
    { q: 'What is a field manager conflict in server-side apply, and why is it useful?', guidance: 'When you apply a field that another manager currently owns with a different value, the API server rejects the apply with a conflict naming that manager. It prevents one tool silently overwriting another\'s changes. You resolve by forcing (taking ownership), dropping the field from your manifest, or coordinating with the other manager (for example leaving replicas to the HPA).' },
    { q: 'You edit a pod\'s container image directly with kubectl edit. What happens?', guidance: 'Pods allow only limited in-place changes (the image field is one of them), so the kubelet restarts that container with the new image. But the ReplicaSet\'s template is unchanged, so any replacement pod uses the old image. It creates an inconsistent, invisible divergence; the correct path is to change the Deployment template.' }
  ],
  misconceptions: [
    '"Kubernetes automatically reverts any manual change." Only changes to objects owned by a controller are corrected; edits to a top-level object\'s spec become the new desired state unless an external tool (GitOps, pipeline, HPA) owns that field.',
    '"kubectl apply replaces the whole object with the file." Apply patches the difference and, depending on mode, leaves fields owned by others alone.',
    '"Declarative means no one should ever use kubectl." It means the source of truth is declared state; ad hoc commands are acceptable when their changes are recorded and reconciled back.'
  ],
  weak: [
    'Says "the Deployment will put it back" for a change to the Deployment itself',
    'Ignores HPA or GitOps ownership of fields',
    'Has no process answer for emergency changes'
  ],
  evidence: '# example output\n$ kubectl scale deploy/web --replicas=10\ndeployment.apps/web scaled\n\n$ kubectl diff -f deploy/web.yaml\n-  replicas: 10\n+  replicas: 3\n\n$ kubectl get deploy web -o yaml --show-managed-fields | grep -B1 -A3 "manager:"\n  - apiVersion: apps/v1\n    manager: kubectl\n    operation: Update\n    ...\n  - apiVersion: apps/v1\n    manager: gitops-controller\n    operation: Apply\n    ...',
  rubric: {
    strong: [
      'Defines declarative desired state and reconciliation clearly',
      'Correctly predicts that kubectl scale changes desired state and is not reverted by the Deployment controller',
      'Explains that GitOps/pipeline/HPA may revert depending on configuration and field ownership',
      'Mentions apply semantics (three-way merge or server-side apply managedFields) at a high level',
      'Gives an incident process for hand changes'
    ],
    acceptable: [
      'Explains with one specific GitOps tool\'s terminology, framed as an example',
      'Skips server-side apply details but correctly explains who reverts what'
    ],
    redFlags: [
      'Claims Kubernetes itself always reverts manual edits to Deployments',
      'Recommends routinely making production changes by hand without recording them',
      'Confuses declarative apply with delete-and-recreate'
    ]
  },
  aws: { analogy: 'CloudFormation stacks as desired state and drift detection when someone changes a resource in the console.', breaks: 'CloudFormation detects drift but does not continuously revert it; changes are applied only when you update the stack. Kubernetes controllers reconcile continuously, and a GitOps controller can revert drift automatically, but only for fields it owns.' },
  refs: [
    { t: 'Declarative management with kubectl apply', u: 'https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/' },
    { t: 'Server-side apply', u: 'https://kubernetes.io/docs/reference/using-api/server-side-apply/' },
    { t: 'Object management techniques', u: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/object-management/' }
  ],
  verify: ''
},

{ id: 'ons-q-arch-10', track: 'onsite', topic: 'arch', priority: 'P0', level: 2, mins: 5,
  prereqs: ['les-workloads', 'les-services', 'les-identity'],
  labs: [],
  q: 'How would you map what you know from ECS onto Kubernetes — and where does the mapping break?',
  context: 'You have deep ECS and EC2 experience and less production time on Kubernetes. The interviewer asks you to translate your experience honestly: what carries over, what does not, and how you would close the gap.',
  evaluates: [
    'Maps the core objects correctly as rough analogies, not equivalences',
    'Identifies where the model differs: separate Service object, label selectors, controllers, CRD extensibility, networking and identity',
    'Separates Kubernetes RBAC (access to the Kubernetes API) from cloud IAM (access to cloud APIs)',
    'Is honest about experience level without underselling transferable operations skill'
  ],
  spoken: 'A lot of the operating model carries over: desired count, rolling deploys, health checks gating traffic, capacity planning, and incident response. The objects map roughly, not one to one.\n\nA task definition is roughly a pod spec, and a task is roughly a pod. An ECS service splits into several objects: a Deployment for desired count and rollouts, a separate Service for a stable name and virtual IP, and an autoscaler if I want scaling. Target groups are closest to EndpointSlices, and an ALB is closest to an Ingress or Gateway plus its controller. Capacity providers map to nodes, the scheduler and whatever node autoscaling the cluster uses.\n\nWhere it breaks: in Kubernetes the Deployment and Service are only connected through labels and selectors. Everything is a controller reconciling objects, and the API is extensible with CRDs and operators, so a lot of platform behaviour is installed, not built in. Identity is split: a ServiceAccount plus RBAC controls access to the Kubernetes API, and reaching AWS APIs needs workload identity federation on top. Networking depends on the CNI, and NetworkPolicy is not a security group.\n\nMy honest summary: strong operations background, less production Kubernetes, and I have been closing the gap deliberately.',
  deep: '**Rough mapping (analogies, not equivalences).**\n- Task definition → pod spec (usually a pod template inside a Deployment). Both list containers, images, ports, environment, resources and volumes. Kubernetes adds probes as separate readiness/liveness/startup concepts.\n- Task → Pod. Both are a co-scheduled group of containers with shared networking (awsvpc gives a task an ENI; a pod gets an IP from the CNI).\n- ECS service → Deployment (desired count, rolling update) + Service (stable name/virtual IP) + HorizontalPodAutoscaler (scaling). There is no single object that is "the service".\n- Target group → EndpointSlices (the live list of healthy backends). ALB/NLB → Ingress or Gateway API resources plus a controller, or a Service of type LoadBalancer with a cloud or environment controller.\n- Cluster + capacity providers + ASG → nodes + kube-scheduler + whatever node autoscaling or provisioning the cluster runs. Placement constraints/strategies → nodeSelector, affinity, taints/tolerations, topology spread.\n- Cloud Map / Service Connect → cluster DNS and Services.\n- Task IAM role → ServiceAccount projected token + workload identity federation to cloud IAM. Task execution role (pull images, fetch secrets) → mostly the kubelet/node credentials and image pull secrets.\n- Security groups for tasks → NetworkPolicy, if the CNI enforces it.\n- CloudFormation/CDK service definition → manifests in Git applied by a pipeline or GitOps controller.\n\n**Where it breaks.**\n- *Loose coupling by labels.* ECS wires a service to its target group explicitly. Kubernetes objects find each other through label selectors, which is flexible and also a common failure: a selector typo gives an empty Service with no error.\n- *Controllers everywhere and extensibility.* Kubernetes behaviour comes from controllers watching objects, and you can add types (CRDs) and controllers (operators). Ingress, load balancers, certificates, storage provisioning and policy are often add-ons chosen per cluster.\n- *Health semantics.* ECS health checks (container and target group) mainly decide replacement. Kubernetes separates readiness (remove from traffic, no restart) from liveness (restart the container in place).\n- *Identity.* RBAC governs the Kubernetes API. It does not grant anything in AWS. Cloud access is a separate federation from the ServiceAccount identity.\n- *Networking.* ClusterIPs are virtual addresses implemented on each node; the pod network is provided by a CNI plugin and may or may not use VPC addresses; NetworkPolicy is namespace- and label-based, default allow until a policy selects a pod, and enforced only by capable CNIs.\n- *Ownership of the platform.* Depending on setup, you may operate the control plane, etcd backups, upgrades and add-ons that ECS handles for you.\n\n**Framing your experience.** Lead with transferable skills (controlled rollouts, health-gated traffic, capacity, incident handling, runbooks, validation in isolated environments), be precise about Kubernetes experience (what you have done in labs versus production), and show how you close gaps: reading controller behaviour, reproducing failures locally, and checking official documentation. Local lab work shows understanding of mechanisms; it is not the same as production experience, and saying so builds credibility.',
  followups: [
    { q: 'Your pod needs to read from an S3 bucket. How is that different from giving an ECS task a task role?', guidance: 'In ECS the task role is attached to the task definition and credentials are provided by the ECS agent. In Kubernetes the pod runs as a ServiceAccount; to reach AWS you need a workload identity mechanism that federates the ServiceAccount token to an IAM role (the specific mechanism depends on the platform). RBAC on that ServiceAccount is irrelevant to S3; it only controls Kubernetes API access.' },
    { q: 'In ECS a failing ALB health check replaces the task. What is the Kubernetes equivalent, and why is it split?', guidance: 'A readiness probe failing removes the pod from EndpointSlices without restarting it; a liveness probe failing restarts the container. Splitting them avoids restarting pods that are only temporarily overloaded or warming up, and avoids cascading restarts when a dependency is down.' },
    { q: 'What would you do in your first month to close the gap between ECS and Kubernetes experience?', guidance: 'A concrete plan: learn the specific platform\'s add-ons and conventions, shadow on-call, read runbooks, break things in a non-production cluster (rollouts, node loss, DNS, NetworkPolicy), trace a request end to end, and write down gaps. Honest and specific beats claiming full parity.' }
  ],
  misconceptions: [
    '"A Kubernetes Service is the same as an ECS service." An ECS service is closer to a Deployment plus Service plus autoscaler; the Kubernetes Service only provides stable naming and routing to selected pods.',
    '"RBAC is Kubernetes IAM, so it controls access to AWS resources." RBAC controls the Kubernetes API only; cloud access needs a separate identity federation.',
    '"NetworkPolicy is a security group." Both filter traffic, but NetworkPolicy selects pods by label, is default-allow until a policy selects a pod, and is enforced only if the CNI supports it.',
    '"ECS and Kubernetes are equivalent object for object." The operating ideas transfer; the object model, coupling and extensibility differ.'
  ],
  weak: [
    'Claims direct one-to-one equivalence throughout',
    'Either overstates Kubernetes production experience or undersells transferable operations skill',
    'Cannot name any concrete place where the mapping fails',
    'Treats lab work as equivalent to production experience'
  ],
  evidence: '# example output (one ECS "service" becomes several Kubernetes objects)\n$ kubectl get deploy,svc,hpa,endpointslices -l app=orders\nNAME                     READY   UP-TO-DATE   AVAILABLE\ndeployment.apps/orders   4/4     4            4\nNAME             TYPE        CLUSTER-IP     PORT(S)\nservice/orders   ClusterIP   10.96.120.7    80/TCP\nNAME                                         REFERENCE           TARGETS       MINPODS   MAXPODS   REPLICAS\nhorizontalpodautoscaler.autoscaling/orders   Deployment/orders   cpu: 41%/60%  3         10        4\nNAME                                          ADDRESSTYPE   PORTS   ENDPOINTS\nendpointslice.discovery.k8s.io/orders-9kq2w   IPv4          8080    10.244.1.5,10.244.2.8,...\n\n$ kubectl get pod orders-5c9f7d-abcde -o jsonpath=\'{.spec.serviceAccountName}\'\norders',
  rubric: {
    strong: [
      'Gives a correct rough mapping for task definition, task, service, target group, ALB, capacity and task role',
      'Explicitly says the ECS service splits into Deployment + Service (+ autoscaler) linked by labels',
      'Names at least three breaks: label coupling, controllers/CRDs, health semantics, RBAC vs IAM, CNI/NetworkPolicy',
      'Frames own experience honestly with a concrete gap-closing approach'
    ],
    acceptable: [
      'Maps from EC2 Auto Scaling and plain EC2 operations instead of ECS, if the same breaks are identified',
      'Organises the answer by concern (compute, networking, identity, deployment) rather than object by object'
    ],
    redFlags: [
      'Claims ECS and Kubernetes are equivalent object for object',
      'Says RBAC grants access to AWS resources',
      'Presents local lab experience as production Kubernetes experience'
    ]
  },
  aws: { analogy: 'This whole question is the analogy: ECS task definitions, tasks, services, target groups, capacity providers and task roles.', breaks: 'ECS couples service, load balancer and scaling in one managed object with AWS-native identity and networking. Kubernetes splits these into label-linked objects driven by controllers, makes much of the platform an installable add-on, and separates Kubernetes RBAC from cloud IAM.' },
  refs: [
    { t: 'Service', u: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
    { t: 'Service accounts', u: 'https://kubernetes.io/docs/concepts/security/service-accounts/' },
    { t: 'Using RBAC authorization', u: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/' }
  ],
  verify: ''
}

);
