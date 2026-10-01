/* Onsite track — concept lessons. Foundations first; each ends in a self-check. */
window.LX = window.LX || {};
LX.onsiteLessons = LX.onsiteLessons || [];
LX.onsiteLessons.push(
{
  id: 'les-reconcile',
  track: 'onsite',
  title: 'Desired state and the reconciliation loop',
  priority: 'P0',
  mins: 14,
  prereqs: [],
  summary: 'Explain what happens between `kubectl apply` and a running container: the API server as the only front door to etcd, controllers that watch and correct drift, spec versus status, and why a deleted pod comes back.',
  sections: [
    {
      h: 'You write a record, not a command',
      body: 'When you run `kubectl apply -f web.yaml`, you are not telling Kubernetes to start three containers. You are sending an object to the API server, which validates it and stores it. That stored object is a record of **desired state**. Nothing has run yet. Every other part of the cluster exists to make reality match that record, and to keep making it match after things change or break.\n\n'
        + 'Most objects have two halves. `spec` is what you want; you (or a higher-level controller) write it. `status` is what was last observed; the controller or kubelet responsible for the object writes it. When spec and status disagree, some controller is either still working on it or is stuck, and the object\'s conditions and events usually tell you which.\n\n'
        + 'Compare this with an imperative script: if a script fails at step 4 of 7, you are left half-done and someone has to re-run it. With a stored desired state plus controllers that keep converging, partial failures get retried and drift gets corrected without anyone re-running anything.'
    },
    {
      h: 'Who talks to whom',
      body: '- **API server**: the only component that reads and writes etcd. It authenticates the caller, authorizes the request (for example with RBAC), runs admission control, validates, and persists. kubectl, controllers, the scheduler and every kubelet are all clients of the API server.\n- **etcd**: the consistent key-value store holding every object. Lose it without a backup and you lose the cluster\'s record of what should exist.\n- **controller manager**: one process running many built-in controllers (Deployment, ReplicaSet, Node, Job, EndpointSlice and others). Each watches some kinds of objects and writes others.\n- **scheduler**: watches for pods with no node assigned and binds each one to a node. It does not start anything.\n- **kubelet**: the agent on each node. It watches for pods bound to its node, asks the container runtime to start the containers, runs probes, and reports status back.\n- **kube-proxy or an equivalent dataplane**: programs Service routing on each node (covered in the networking lessons).\n\n'
        + 'The key idea: components do not call each other. The scheduler never tells a kubelet to start a pod; it writes `spec.nodeName` on the pod object, and the kubelet on that node notices through its watch. Coordination happens through objects in the API.'
    },
    {
      h: 'The loop: observe, diff, act',
      body: 'Every controller runs the same loop. It **observes** the objects it cares about through a watch (backed by a local cache), **diffs** desired state against what it observes, **acts** by making API calls to close the gap, and repeats.\n\n'
        + 'Controllers are **level-triggered**: they act on the current state of the world, not on a replay of individual events. If a controller misses an event or restarts, it re-lists what exists now and reconciles from that. This is why the system tolerates dropped notifications and component restarts. It also means controller actions have to be idempotent: doing the same reconciliation twice must be safe.\n\n'
        + 'Follow a Deployment with `replicas: 3` through the loop:\n\n'
        + '- The API server stores the Deployment.\n- The Deployment controller sees a Deployment with no ReplicaSet matching its pod template, and creates one.\n- The ReplicaSet controller sees 0 of 3 pods, and creates three pod objects with no node assigned.\n- The scheduler sees three unscheduled pods and binds each to a node.\n- Each chosen node\'s kubelet sees a pod bound to it, pulls the image, starts the containers and reports status.\n- The EndpointSlice controller adds the pods to any Service that selects them once they are Ready.\n\n'
        + 'Each step is a different controller reacting to an object another component wrote.'
    },
    {
      h: 'Why a deleted pod comes back',
      body: 'Delete a pod that belongs to a ReplicaSet. The API server marks it for deletion, the kubelet stops its containers within the grace period, and the ReplicaSet controller now observes 2 matching pods where the spec says 3. It creates a new pod. That pod is a new object: a new name, a new UID, usually a new IP, and possibly a different node. It is a replacement, not a restart.\n\n'
        + 'If you actually want fewer pods, change the desired state: scale or delete the Deployment. Deleting the ReplicaSet directly does not work either, because the Deployment controller recreates it. Any time you edit something a controller owns and watch it revert, that is reconciliation working as designed. A GitOps controller applies the same idea one level higher: it reconciles cluster objects from a configured source such as a Git repository or an OCI artifact, and a manual edit gets reverted to what the source says. The images themselves are still pulled by the kubelet and container runtime.\n\n'
        + 'Watch it happen:\n\n'
        + '- `kubectl get pods -l app=web -w` in one terminal, `kubectl delete pod <name>` in another: a new name appears.\n- `kubectl get pod <name> -o jsonpath=\'{.metadata.ownerReferences[0].kind}\'` shows the owner (ReplicaSet).\n- `kubectl get events --sort-by=.lastTimestamp` shows the controller\'s "Created pod" event.'
    },
    {
      h: 'Reading spec and status in practice',
      body: '`kubectl get deploy web -o yaml` shows both halves. Compare `spec.replicas` with `status.replicas`, `status.readyReplicas` and `status.updatedReplicas`, and read `status.conditions`. Also compare `metadata.generation` with `status.observedGeneration`: generation increases whenever the spec changes, and observedGeneration records which generation the controller has processed. If observedGeneration is behind, the controller has not caught up yet, or is not running.\n\n'
        + 'Operationally: a successful `kubectl apply` means the API server accepted and stored your object. It does not mean anything ran. Confirm through status, events and `kubectl rollout status`. When the control plane is degraded, your change may be stored while nothing acts on it; when a controller is broken, spec and status drift apart and stay apart. Both show up as status that does not move.'
    }
  ],
  diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 380" role="img" aria-label="Reconciliation loop: kubectl writes desired state to the API server, which alone reads and writes etcd. Controllers, the scheduler and each kubelet watch the API server and write back. Each runs a loop: observe, diff spec against status, act, repeat." font-family="inherit" font-size="12"><rect x="200" y="16" width="150" height="46" rx="6" style="fill:var(--bg-elev);stroke:var(--blue);stroke-width:1.5"/><text x="275" y="35.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">kubectl apply</text><text x="275" y="50.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">writes desired spec</text><rect x="20" y="118" width="110" height="56" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="75" y="142.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">etcd</text><text x="75" y="157.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">stored objects</text><rect x="200" y="114" width="150" height="64" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="275" y="135" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">API server</text><text x="275" y="150" font-size="11" text-anchor="middle" style="fill:var(--muted)">the only client</text><text x="275" y="165" font-size="11" text-anchor="middle" style="fill:var(--muted)">of etcd</text><rect x="430" y="16" width="160" height="56" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="510" y="40.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">controllers</text><text x="510" y="55.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">Deployment, ReplicaSet...</text><rect x="430" y="118" width="160" height="56" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="510" y="142.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">scheduler</text><text x="510" y="157.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">writes nodeName</text><rect x="430" y="220" width="160" height="56" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="510" y="244.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">kubelet (each node)</text><text x="510" y="259.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">runs pods, reports status</text><line x1="275" y1="62" x2="275" y2="108" style="stroke:var(--blue);stroke-width:1.5"/><polygon points="275,114 279,106 271,106" style="fill:var(--blue)"/><line x1="136" y1="146" x2="194" y2="146" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="200,146 192,142 192,150" style="fill:var(--muted)"/><polygon points="130,146 138,150 138,142" style="fill:var(--muted)"/><line x1="354.3" y1="123.8" x2="425.7" y2="54.2" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="430,50 421.5,52.7 427.1,58.4" style="fill:var(--muted)"/><polygon points="350,128 358.5,125.3 352.9,119.6" style="fill:var(--muted)"/><line x1="356" y1="146" x2="424" y2="146" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="430,146 422,142 422,150" style="fill:var(--muted)"/><polygon points="350,146 358,150 358,142" style="fill:var(--muted)"/><line x1="354.2" y1="168.2" x2="425.8" y2="239.8" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="430,244 427.2,235.5 421.5,241.2" style="fill:var(--muted)"/><polygon points="350,164 352.8,172.5 358.5,166.8" style="fill:var(--muted)"/><text x="384" y="224" font-size="11" text-anchor="end" style="fill:var(--muted)">watch + write</text><text x="20" y="214" font-size="11" text-anchor="start" style="fill:var(--muted)">Nobody calls anybody directly:</text><text x="20" y="229" font-size="11" text-anchor="start" style="fill:var(--muted)">components watch and update</text><text x="20" y="244" font-size="11" text-anchor="start" style="fill:var(--muted)">objects through the API server.</text><rect x="40" y="300" width="140" height="40" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="110" y="316.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">1 observe</text><text x="110" y="331.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">watch current state</text><rect x="225" y="300" width="160" height="40" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="305" y="316.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">2 diff</text><text x="305" y="331.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">spec vs status</text><rect x="430" y="300" width="150" height="40" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="505" y="316.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">3 act</text><text x="505" y="331.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">create, delete, update</text><line x1="180" y1="320" x2="219" y2="320" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="225,320 217,316 217,324" style="fill:var(--accent)"/><line x1="385" y1="320" x2="424" y2="320" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="430,320 422,316 422,324" style="fill:var(--accent)"/><polyline points="505,340 505,356 110,356 110,346" style="fill:none;stroke:var(--accent);stroke-width:1.5"/><polygon points="110,340 106,348 114,348" style="fill:var(--accent)"/><text x="307" y="372" font-size="11" text-anchor="middle" style="fill:var(--muted)">repeat: level-triggered, from current state</text></svg>',
  diagramCaption: 'kubectl writes desired state to the API server, the only component that talks to etcd; controllers, the scheduler and kubelets watch it and write back, each running an observe, diff, act loop.',
  keyPoints: [
    'The API server is the only component that talks to etcd; kubectl, controllers, the scheduler and kubelets are all its clients.',
    'spec is desired state; status is observed state written by the responsible controller or kubelet.',
    'Controllers are level-triggered loops: observe current state, diff against desired, act, repeat. Missed events are recovered by re-listing.',
    'Components coordinate through objects, not direct calls: the scheduler writes nodeName and the kubelet notices.',
    'A deleted pod owned by a ReplicaSet is replaced by a new pod; to change the outcome, change the owner\'s spec.',
    'A successful apply means stored, not running: verify with status, conditions, events and rollout status.'
  ],
  misconceptions: [
    'kubectl tells nodes to start containers → kubectl only talks to the API server; the kubelet on a node starts containers after it sees a pod bound to that node.',
    'Controllers react to each event exactly once, so a missed event is a missed action → controllers are level-triggered and reconcile from current state after re-listing.',
    'A deleted pod restarts → the ReplicaSet controller creates a new pod object with a new name and UID; in-place container restarts are a different mechanism (kubelet, restartPolicy).',
    'The scheduler runs pods → it only assigns a node; the kubelet runs them.'
  ],
  aws: {
    analogy: 'An ECS service keeps a desired count of tasks and replaces tasks that stop; a CloudFormation template also declares desired resources.',
    breaks: 'An ECS service is one managed loop per service. Kubernetes is many independent controllers coordinating through a shared API, and you can add your own. CloudFormation acts when you deploy a stack update and only reports drift; Kubernetes controllers continuously correct it.'
  },
  check: [
    {
      q: 'Which component reads and writes etcd?',
      a: 'Only the API server. Controllers, the scheduler, kubelets and kubectl all go through the API server.'
    },
    {
      q: 'You delete one pod of a 3-replica Deployment. What creates the replacement, and is it the same pod?',
      a: 'The ReplicaSet controller sees 2 of 3 matching pods and creates a new pod object: new name, new UID, usually a new IP, possibly another node. It is a replacement, not a restart.'
    },
    {
      q: 'What does level-triggered reconciliation give you?',
      a: 'The controller acts on the current observed state, so after a missed event or a restart it re-lists and still converges. Its actions must therefore be idempotent.'
    }
  ],
  questions: ['ons-q-arch-01', 'ons-q-arch-09', 'ons-q-arch-05'],
  labs: ['ons-lab-01'],
  refs: [
    {
      t: 'Controllers',
      u: 'https://kubernetes.io/docs/concepts/architecture/controller/'
    },
    {
      t: 'Kubernetes components',
      u: 'https://kubernetes.io/docs/concepts/overview/components/'
    },
    {
      t: 'Objects in Kubernetes (spec and status)',
      u: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/'
    }
  ],
  verify: ''
},
{
  id: 'les-workloads',
  track: 'onsite',
  title: 'Pods, ReplicaSets and Deployments',
  priority: 'P0',
  mins: 12,
  prereqs: ['les-reconcile'],
  summary: 'Explain what a pod is, how a Deployment manages pods through ReplicaSets, why a Service selects pods without owning them, and when to reach for a StatefulSet, DaemonSet or Job instead.',
  sections: [
    {
      h: 'The pod: the unit that gets scheduled',
      body: 'A pod is one or more containers that are scheduled together onto one node and share a network namespace: one pod IP, one port space, and `localhost` between them. They can also share volumes. Typical extra containers are init containers (run to completion before the app starts) and sidecars (for example a log shipper or proxy).\n\n'
        + 'Pods are disposable. A pod is never moved to another node; if it needs to run elsewhere, a controller creates a new pod and the old one is deleted. That is why you rarely create bare pods: if a bare pod\'s node dies, nothing recreates it. You create a controller that owns pods, and the controller keeps the right number of them in existence.'
    },
    {
      h: 'ReplicaSet: keep N matching pods',
      body: 'A ReplicaSet has three parts: a label **selector**, a pod **template**, and a **replicas** count. Its controller counts the pods it owns that match the selector and creates or deletes pods to reach the count. Pods it creates carry an `ownerReference` pointing back to the ReplicaSet.\n\n'
        + 'A ReplicaSet does not update existing pods when you change its template: only pods created afterwards use the new template. That makes it a poor tool for version changes on its own, and it is why you normally manage ReplicaSets through a Deployment rather than directly.'
    },
    {
      h: 'Deployment: versioned rollouts on top of ReplicaSets',
      body: 'A Deployment owns ReplicaSets. Each distinct pod template gets its own ReplicaSet, named with a `pod-template-hash` suffix. When you change the template (a new image, an env var, a label in the template), the Deployment controller creates a new ReplicaSet and shifts pods from old to new according to the rollout strategy. The old ReplicaSet is kept, scaled to 0, so that `kubectl rollout undo` has something to return to; `revisionHistoryLimit` (10 by default) bounds how many are kept. Changing only `replicas` scales the current ReplicaSet and does not create a new revision.\n\n'
        + 'The ownership chain is Deployment → ReplicaSet → Pod, recorded in ownerReferences. When you delete an owner, the garbage collector deletes its dependents by default (cascading deletion).\n\n'
        + '- `kubectl get deploy,rs,pods -l app=web` shows all three layers.\n- `kubectl get rs -l app=web` shows old ReplicaSets at 0 desired.\n- `kubectl get pod <name> -o jsonpath=\'{.metadata.ownerReferences[0].name}\'` names the owning ReplicaSet.\n- `kubectl describe deploy web` events show lines like "Scaled up replica set web-7c9f to 3".'
    },
    {
      h: 'Services select; they do not own',
      body: 'A Service uses a label selector to decide which pods receive its traffic. It is not an owner. Deleting a Service leaves the pods running; deleting pods leaves the Service in place (with fewer endpoints). A pod can match several Services, and a Service can match pods from different Deployments if their labels match, which is how some blue/green and canary setups work.\n\n'
        + 'Keep the two relationships separate in your head:\n\n'
        + '- **Ownership** (ownerReferences) drives lifecycle: who recreates a pod, who deletes it, what gets garbage-collected.\n- **Selection** (labels and selectors) drives grouping and routing: which pods a Service sends traffic to, which pods a NetworkPolicy applies to.\n\n'
        + 'Labels are the glue, so label mistakes are a classic outage: pods Running and Ready, Service with no endpoints, because the selector says `app: web` and the pods say `app: web-v2`. In `apps/v1` a Deployment\'s selector is immutable and must match its template labels.'
    },
    {
      h: 'The other workload controllers at a glance',
      body: 'All of these follow the same pattern (controller + pod template + ownership); they differ in what guarantee they give.\n\n'
        + '- **StatefulSet**: stable identity. Pods are named `db-0`, `db-1`, created and deleted in order by default, each with its own PersistentVolumeClaim from `volumeClaimTemplates`, and a stable DNS name through a headless Service. Use it for databases and quorum systems where each replica is not interchangeable.\n- **DaemonSet**: one pod per matching node, added automatically when nodes join. Used for node agents: log collectors, monitoring agents, CNI and storage node plugins.\n- **Job**: runs pods to completion, retrying failures up to `backoffLimit`; `restartPolicy` must be `OnFailure` or `Never`. A **CronJob** creates Jobs on a schedule.\n\n'
        + 'A quick way to choose: interchangeable and long-running → Deployment; needs identity or its own disk per replica → StatefulSet; one per node → DaemonSet; finite work → Job or CronJob.'
    }
  ],
  diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 370" role="img" aria-label="Deployment web owns a new ReplicaSet with three pods and an old ReplicaSet scaled to zero. A Service selects the pods by the label app=web with dashed lines, showing selection without ownership." font-family="inherit" font-size="12"><rect x="90" y="14" width="200" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="190" y="35.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">Deployment web</text><text x="190" y="50.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">template + replicas: 3</text><rect x="20" y="110" width="160" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="100" y="131.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">ReplicaSet (new)</text><text x="100" y="146.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">hash 7c9f, 3 pods</text><rect x="200" y="110" width="160" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5;stroke-dasharray:5 4"/><text x="280" y="131.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">ReplicaSet (old)</text><text x="280" y="146.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">hash 5d8b, 0 pods</text><line x1="160" y1="64" x2="114.4" y2="105.9" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="110,110 118.6,107.5 113.2,101.6" style="fill:var(--accent)"/><line x1="220" y1="64" x2="270.4" y2="106.2" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="275,110 271.4,101.8 266.3,107.9" style="fill:var(--accent)"/><text x="120" y="86" font-size="11" text-anchor="end" style="fill:var(--muted)">owns</text><text x="262" y="86" font-size="11" text-anchor="start" style="fill:var(--muted)">owns</text><rect x="20" y="205" width="90" height="44" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="65" y="223.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">pod</text><text x="65" y="238.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">app=web</text><line x1="100" y1="160" x2="68.7" y2="200.3" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="65,205 73.1,201.1 66.8,196.2" style="fill:var(--accent)"/><line x1="170" y1="305" x2="70.3" y2="251.8" style="stroke:var(--blue);stroke-width:1.5;stroke-dasharray:5 4"/><polygon points="65,249 70.2,256.3 73.9,249.2" style="fill:var(--blue)"/><rect x="125" y="205" width="90" height="44" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="170" y="223.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">pod</text><text x="170" y="238.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">app=web</text><line x1="100" y1="160" x2="165" y2="201.8" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="170,205 165.4,197.3 161.1,204" style="fill:var(--accent)"/><line x1="170" y1="305" x2="170" y2="255" style="stroke:var(--blue);stroke-width:1.5;stroke-dasharray:5 4"/><polygon points="170,249 166,257 174,257" style="fill:var(--blue)"/><rect x="230" y="205" width="90" height="44" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="275" y="223.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">pod</text><text x="275" y="238.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">app=web</text><line x1="100" y1="160" x2="269.2" y2="203.5" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="275,205 268.2,199.1 266.3,206.9" style="fill:var(--accent)"/><line x1="170" y1="305" x2="269.7" y2="251.8" style="stroke:var(--blue);stroke-width:1.5;stroke-dasharray:5 4"/><polygon points="275,249 266.1,249.2 269.8,256.3" style="fill:var(--blue)"/><rect x="60" y="305" width="220" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--blue);stroke-width:1.5"/><text x="170" y="326.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">Service web</text><text x="170" y="341.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">selector: app=web</text><text x="290" y="285" font-size="11" text-anchor="start" style="fill:var(--blue)">selects by label</text><text x="390" y="30" font-size="12" text-anchor="start" font-weight="600" style="fill:var(--text)">Legend</text><line x1="390" y1="52" x2="424" y2="52" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="430,52 422,48 422,56" style="fill:var(--accent)"/><text x="438" y="56" font-size="11" text-anchor="start" style="fill:var(--text)">owner reference</text><text x="438" y="71" font-size="11" text-anchor="start" style="fill:var(--muted)">lifecycle + garbage collection</text><line x1="390" y1="96" x2="424" y2="96" style="stroke:var(--blue);stroke-width:1.5;stroke-dasharray:5 4"/><polygon points="430,96 422,92 422,100" style="fill:var(--blue)"/><text x="438" y="100" font-size="11" text-anchor="start" style="fill:var(--text)">label selector</text><text x="438" y="115" font-size="11" text-anchor="start" style="fill:var(--muted)">routes traffic, owns nothing</text><text x="390" y="160" font-size="11" text-anchor="start" style="fill:var(--muted)">Delete a pod: the ReplicaSet</text><text x="390" y="175" font-size="11" text-anchor="start" style="fill:var(--muted)">creates a new one.</text><text x="390" y="205" font-size="11" text-anchor="start" style="fill:var(--muted)">Delete the Service: the pods</text><text x="390" y="220" font-size="11" text-anchor="start" style="fill:var(--muted)">keep running untouched.</text><text x="390" y="250" font-size="11" text-anchor="start" style="fill:var(--muted)">Old ReplicaSet is kept at 0</text><text x="390" y="265" font-size="11" text-anchor="start" style="fill:var(--muted)">so rollout undo can use it.</text></svg>',
  diagramCaption: 'A Deployment owns a new ReplicaSet (three pods) and an old one kept at zero; the Service selects the same pods by label without owning them.',
  keyPoints: [
    'A pod is the scheduling unit: containers sharing one IP and port space on one node. Pods are replaced, never moved.',
    'A ReplicaSet keeps N pods matching a selector; it does not update existing pods when its template changes.',
    'A Deployment creates one ReplicaSet per pod template and shifts pods between them; old ReplicaSets at 0 are its rollout history.',
    'Ownership (ownerReferences) drives lifecycle and garbage collection; label selection drives routing. A Service is never an owner.',
    'StatefulSet for identity and per-replica storage, DaemonSet for one per node, Job/CronJob for finite work.'
  ],
  misconceptions: [
    'A Deployment manages pods directly → it manages ReplicaSets, and each ReplicaSet manages pods.',
    'Deleting a Service deletes its pods → a Service only selects pods by label; it owns nothing.',
    'Editing a ReplicaSet template updates running pods → only pods created afterwards use the new template.',
    'Kubernetes moves a pod to a healthy node → a controller creates a new pod elsewhere; the old pod is deleted.'
  ],
  aws: {
    analogy: 'An ECS task is roughly a pod, a task definition revision roughly a pod template, and an ECS service roughly a Deployment plus a Service.',
    breaks: 'An ECS service bundles desired count, deployment and load-balancer registration in one resource. Kubernetes splits them: Deployment (rollouts), ReplicaSet (count), Service (discovery and routing by labels), and an external load balancer only for type LoadBalancer with a controller present. There is no ECS equivalent of a ReplicaSet, and routing is by label match rather than target-group registration.'
  },
  check: [
    {
      q: 'What does a Deployment create when you change the container image?',
      a: 'A new ReplicaSet for the new pod template; it scales the new one up and the old one down per the strategy, and keeps the old one at 0 for rollback.'
    },
    {
      q: 'Pods are Running and Ready, but the Service has no endpoints. What relationship do you check?',
      a: 'Label selection: compare the Service selector with the pod labels (and namespace). Ownership has nothing to do with Service routing.'
    },
    {
      q: 'Which controller gives each replica a stable name and its own PVC?',
      a: 'A StatefulSet, using volumeClaimTemplates and a headless Service.'
    }
  ],
  questions: ['ons-q-arch-02', 'ons-q-arch-07', 'ons-q-arch-08', 'ons-q-arch-10'],
  labs: ['ons-lab-01', 'ons-lab-03'],
  refs: [
    {
      t: 'Deployments',
      u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/'
    },
    {
      t: 'ReplicaSet',
      u: 'https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/'
    },
    {
      t: 'Labels and selectors',
      u: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/'
    },
    {
      t: 'Garbage collection',
      u: 'https://kubernetes.io/docs/concepts/architecture/garbage-collection/'
    }
  ],
  verify: ''
},
{
  id: 'les-pod-lifecycle',
  track: 'onsite',
  title: 'Pod phases, container states and exit codes',
  priority: 'P0',
  mins: 14,
  prereqs: ['les-workloads'],
  summary: 'Read a failing pod correctly: tell pod phase from container state, know who restarts what and with what back-off, and turn exit codes and termination reasons into a cause instead of repeating the word CrashLoopBackOff.',
  sections: [
    {
      h: 'Two layers of status',
      body: 'A pod has a coarse **phase**:\n\n'
        + '- **Pending**: accepted by the API server, but not all containers are running yet. This covers waiting to be scheduled and, after scheduling, pulling images and creating containers.\n- **Running**: bound to a node, and at least one container is running or is starting or restarting.\n- **Succeeded**: all containers exited successfully and will not be restarted.\n- **Failed**: all containers have terminated and at least one failed, with no further restarts.\n- **Unknown**: the pod\'s state could not be obtained, typically because the node stopped communicating.\n\n'
        + 'Each container also has a **state** with a reason: **Waiting** (for example `ContainerCreating`, `ErrImagePull`, `ImagePullBackOff`, `CreateContainerConfigError`, `CrashLoopBackOff`), **Running**, or **Terminated** (with `exitCode`, a reason such as `Completed`, `Error` or `OOMKilled`, and timestamps). `lastState` keeps the previous termination, which is where the evidence usually is.\n\n'
        + 'The STATUS column in `kubectl get pods` is kubectl\'s summary: it shows the most informative reason, so a pod whose phase is Running can display `CrashLoopBackOff`. Readiness is separate again: the READY column comes from the Ready condition, so a Running pod can be `0/1` Ready. "Terminating" is not a phase either; it means a deletion timestamp is set.\n\n'
        + '- `kubectl get pod <p> -o jsonpath=\'{.status.phase}\'`\n- `kubectl get pod <p> -o jsonpath=\'{.status.containerStatuses[0].lastState}\'`'
    },
    {
      h: 'restartPolicy: who restarts what',
      body: 'The **kubelet** restarts containers in place, inside the same pod: same pod name, same node, same pod IP, with `restartCount` incremented. `restartPolicy` is pod-wide: `Always` (the default, and required for Deployment pods), `OnFailure`, or `Never` (Jobs use the last two).\n\n'
        + 'This is different from the ReplicaSet controller replacing a deleted pod. A container restart keeps the pod; a pod replacement creates a new object. When someone says "the pod restarted", find out which one they mean.'
    },
    {
      h: 'Back-off: CrashLoopBackOff is a symptom',
      body: 'When a container keeps exiting, the kubelet waits longer between restarts: by default 10s, 20s, 40s and so on, capped at five minutes, and the delay resets after the container runs for about ten minutes without trouble (newer versions let administrators tune these values). While the kubelet waits, the container is in state Waiting with reason `CrashLoopBackOff`.\n\n'
        + 'So CrashLoopBackOff tells you the container keeps exiting. It does not tell you why. `ImagePullBackOff` is the same idea for image pulls. The cause lives in three places: the previous container\'s logs, its last termination (exit code and reason), and the pod\'s events.'
    },
    {
      h: 'Reading exit codes',
      body: 'By convention, a process killed by a signal reports 128 + the signal number.\n\n'
        + '- **0**: success. With `restartPolicy: Always`, a container that exits 0 is still restarted, and can still back off.\n- **1** (or another small number): the application chose to exit, for example on a config error or an unhandled exception. Read the logs.\n- **137** = 128 + 9, **SIGKILL**. The kernel OOM killer is one source, and then the reason shows `OOMKilled`. Others: the kubelet killing a container that ignored SIGTERM past its grace period (after a liveness failure or during deletion), or anything else sending SIGKILL. 137 alone does not prove OOM; check the reason.\n- **143** = 128 + 15, **SIGTERM**: the process exited on the termination signal, which is normal during deletion or a rollout, and also what you see when a liveness failure restarts an app that handles SIGTERM.\n- **126 / 127** often mean the command could not be executed or was not found; some runtimes report a start error reason instead.\n\n'
        + '- `kubectl get pod <p> -o jsonpath=\'{.status.containerStatuses[0].lastState.terminated}\'` might show `{"exitCode":137,"reason":"OOMKilled",...}`.\n- `kubectl logs <p> --previous` (or `-p`) shows the output of the previous container instance; the current one may have printed nothing yet.'
    },
    {
      h: 'A triage order that works',
      body: '- `kubectl get pods`: STATUS, READY, RESTARTS, AGE.\n- `kubectl describe pod <p>`: Last State (reason, exit code) and Events (scheduling, pulls, probe failures, kills).\n- `kubectl logs <p> --previous`: what the process said before it died.\n- Match evidence to cause: exit 1 plus a stack trace → application or configuration; `OOMKilled` → memory limit versus actual usage; 137 without OOMKilled plus liveness-failure events → the probe; `CreateContainerConfigError` → a missing ConfigMap or Secret key, and there are no logs because the container never started.\n- Fix the cause, then verify: RESTARTS stops increasing and the pod becomes Ready.\n\n'
        + 'Operationally, avoid "delete the pod and see" as a first move: a replacement pod starts with clean state and a fresh restart count, and you lose the evidence in `lastState` and `--previous` logs.'
    }
  ],
  diagram: '',
  diagramCaption: '',
  keyPoints: [
    'Phase (Pending, Running, Succeeded, Failed, Unknown) is a pod summary; container state (Waiting, Running, Terminated) carries the reasons.',
    'Running does not imply Ready; READY comes from the Ready condition.',
    'The kubelet restarts containers in place per restartPolicy; a controller replacing a pod is a different event.',
    'CrashLoopBackOff is a back-off wait, not a cause: read logs --previous, lastState exit code and reason, and events.',
    'Exit 137 is SIGKILL; only reason OOMKilled shows it was the OOM killer. 143 is SIGTERM.'
  ],
  misconceptions: [
    'CrashLoopBackOff is the root cause → it is the kubelet waiting between restarts; the cause is in previous logs, the exit code and reason, and events.',
    'Exit code 137 means out of memory → 137 means SIGKILL; OOM is confirmed by reason OOMKilled, and liveness kills past the grace period also give 137.',
    'A Running pod is serving traffic → Running is a phase; only Ready pods receive Service traffic.',
    'Deleting a crash-looping pod fixes it → the replacement runs the same spec and usually fails the same way, and you lose the evidence.'
  ],
  aws: {
    analogy: 'ECS task stopped reasons and container exit codes in the task description; CloudWatch Logs for the previous run.',
    breaks: 'ECS usually replaces a failed task with a new task; the kubelet restarts the container inside the same pod first, with back-off, and only controllers replace pods. Kubernetes keeps only the immediately previous container\'s logs locally unless you ship logs elsewhere.'
  },
  check: [
    {
      q: 'A pod shows STATUS CrashLoopBackOff. What three places hold the actual cause?',
      a: 'kubectl logs --previous, the container\'s lastState.terminated (exit code and reason) and the pod\'s events from kubectl describe.'
    },
    {
      q: 'Exit code 137 with reason Error, and events show liveness probe failures. Likely cause?',
      a: 'The kubelet killed the container after liveness failures and it did not exit on SIGTERM within the grace period, so it was SIGKILLed. Not an OOM kill.'
    },
    {
      q: 'Why does a CreateContainerConfigError pod have no logs?',
      a: 'The container was never created because a referenced ConfigMap or Secret (or key) is missing; the evidence is in events.'
    }
  ],
  questions: ['ons-q-trouble-06', 'ons-q-trouble-07', 'ons-q-arch-03', 'ons-q-trouble-08'],
  labs: ['ons-lab-06', 'ons-lab-07'],
  refs: [
    {
      t: 'Pod lifecycle',
      u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/'
    },
    {
      t: 'Debug pods',
      u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/'
    },
    {
      t: 'Determine the reason for pod failure',
      u: 'https://kubernetes.io/docs/tasks/debug/debug-application/determine-reason-pod-failure/'
    }
  ],
  verify: 'Restart back-off defaults (10s doubling to a 300s cap, reset after 10 minutes) and whether they are tunable depend on the Kubernetes version and kubelet configuration.'
},
{
  id: 'les-services',
  track: 'onsite',
  title: 'Services, selectors and EndpointSlices',
  priority: 'P0',
  mins: 12,
  prereqs: ['les-workloads'],
  summary: 'Explain how a Service turns a label selector into a stable virtual IP and name, how EndpointSlices and readiness decide which pods get traffic, what port and targetPort mean, and what each Service type does and does not provision.',
  sections: [
    {
      h: 'Why Services exist',
      body: 'Pod IPs are not stable: every replacement pod gets a new one. Clients need something that stays put. A Service gives a set of pods a stable virtual IP (the ClusterIP), a stable DNS name (`web.<namespace>.svc.cluster.local`, with the default cluster domain), and a port mapping. The set of pods behind it is chosen by a label selector and changes continuously as pods come and go.'
    },
    {
      h: 'Selector → EndpointSlices → dataplane',
      body: 'Three separate steps connect a Service to pods:\n\n'
        + '- The **EndpointSlice controller** watches Services and pods. For each Service with a selector, it writes EndpointSlice objects listing every matching pod in the Service\'s namespace: IP, target port, and conditions (`ready`, `serving`, `terminating`).\n- **kube-proxy, or an equivalent dataplane** in some CNI plugins, runs on every node, watches EndpointSlices, and programs rules so that traffic to ClusterIP:port goes to a ready endpoint.\n- Pods whose readiness probe fails stay listed with `ready: false` and stop receiving new connections. They are not deleted and not restarted.\n\n'
        + 'EndpointSlices replaced the older Endpoints API, which is deprecated in recent versions, although `kubectl describe svc` still prints an "Endpoints" line.\n\n'
        + '- `kubectl describe svc web`: selector, ports and endpoints.\n- `kubectl get endpointslices -l kubernetes.io/service-name=web -o yaml`: each endpoint with its conditions.\n- `kubectl get pods -l app=web --show-labels -o wide`: which pods the selector actually matches, and their IPs.\n\n'
        + 'When a Service has no endpoints, check in this order: does the selector match the pod labels exactly (every key must match; a typo or an extra key excludes pods), are the pods in the same namespace as the Service, and are they Ready?'
    },
    {
      h: 'port, targetPort, containerPort, nodePort',
      body: '- **port**: what clients connect to on the ClusterIP (`web:80`).\n- **targetPort**: the port on the pod where traffic is delivered (a number, or the name of a container port). If omitted, it defaults to the same value as port.\n- **containerPort**: declared in the pod spec. It is mostly informational (the app decides what it listens on; declaring a port opens nothing), but named targetPorts resolve through it.\n- **nodePort**: a port opened on every node\'s IP for NodePort and LoadBalancer Services.\n\n'
        + 'Example: `port: 80, targetPort: 8080`. A client runs `curl http://web:80`; the dataplane sends the connection to `<pod IP>:8080`. If the app actually listens on 3000, the Service has endpoints but connections fail, typically with connection refused. Test the pod directly (`curl <pod IP>:8080`) to separate Service configuration from application behaviour.'
    },
    {
      h: 'Service types, and what they do not do',
      body: '- **ClusterIP** (default): an internal virtual IP reachable from inside the cluster.\n- **NodePort**: ClusterIP plus a port on every node (by default from 30000–32767).\n- **LoadBalancer**: NodePort plus a request to an environment-specific controller to provision an external load balancer. Without such a controller (bare metal, many local clusters including a default kind cluster), EXTERNAL-IP stays `<pending>` indefinitely. No other type provisions a load balancer.\n- **ExternalName**: a DNS CNAME to an outside name; no proxying and no selector.\n- **Headless** (`clusterIP: None`): no virtual IP; DNS returns the ready pod IPs directly. StatefulSets use this for per-pod names such as `db-0.db`.\n\n'
        + 'Ingress and Gateway API are separate APIs for HTTP routing and also do nothing without a controller that implements them.'
    },
    {
      h: 'What it means operationally',
      body: '"The Service has no endpoints" is one of the most common causes of an outage that follows a change: a relabel, a new Deployment with different labels, or a readiness probe that never passes. Everything looks healthy in `kubectl get pods`, and clients still fail.\n\n'
        + 'Two more behaviours worth knowing: in the default kube-proxy modes, load balancing is per connection, not per request, so long-lived connections (gRPC, HTTP/2, database pools) keep going to the same pod after you scale up. And because the choice of endpoint happens on the client\'s node, two clients can see different behaviour if one node\'s rules are stale or broken.'
    }
  ],
  diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 610 300" role="img" aria-label="A client calls Service web on port 80. The Service maps port 80 to targetPort 8080. Its EndpointSlice lists three matching pods; pods A and B are ready and receive traffic, pod C is not ready and is excluded." font-family="inherit" font-size="12"><rect x="10" y="128" width="100" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--blue);stroke-width:1.5"/><text x="60" y="149.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">client</text><text x="60" y="164.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">calls web:80</text><rect x="130" y="118" width="165" height="70" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="212.5" y="142" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">Service web</text><text x="212.5" y="157" font-size="11" text-anchor="middle" style="fill:var(--muted)">ClusterIP 10.96.0.20</text><text x="212.5" y="172" font-size="11" text-anchor="middle" style="fill:var(--muted)">port 80 to targetPort 8080</text><rect x="318" y="100" width="158" height="106" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="397" y="127" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">EndpointSlice</text><text x="397" y="142" font-size="11" text-anchor="middle" style="fill:var(--muted)">10.244.1.5:8080 ready</text><text x="397" y="157" font-size="11" text-anchor="middle" style="fill:var(--muted)">10.244.2.7:8080 ready</text><text x="397" y="172" font-size="11" text-anchor="middle" style="fill:var(--muted)">10.244.3.4:8080</text><text x="397" y="187" font-size="11" text-anchor="middle" style="fill:var(--muted)">ready: false</text><rect x="496" y="20" width="104" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="548" y="41.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">pod A</text><text x="548" y="56.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">Ready</text><rect x="496" y="128" width="104" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="548" y="149.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">pod B</text><text x="548" y="164.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">Ready</text><rect x="496" y="236" width="104" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--red);stroke-width:1.5;stroke-dasharray:5 4"/><text x="548" y="257.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">pod C</text><text x="548" y="272.5" font-size="11" text-anchor="middle" style="fill:var(--red)">NotReady</text><line x1="110" y1="153" x2="124" y2="153" style="stroke:var(--blue);stroke-width:1.5"/><polygon points="130,153 122,149 122,157" style="fill:var(--blue)"/><line x1="295" y1="153" x2="312" y2="153" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="318,153 310,149 310,157" style="fill:var(--muted)"/><line x1="476" y1="130" x2="494.5" y2="55.8" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="496,50 490.2,56.8 497.9,58.7" style="fill:var(--accent)"/><line x1="476" y1="153" x2="490" y2="153" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="496,153 488,149 488,157" style="fill:var(--accent)"/><line x1="476" y1="185" x2="496" y2="256" style="stroke:var(--red);stroke-width:1.5;stroke-dasharray:5 4"/><text x="472" y="226" font-size="11" text-anchor="end" style="fill:var(--red)">no traffic</text><text x="307" y="232" font-size="11" text-anchor="end" style="fill:var(--muted)">EndpointSlice controller lists every</text><text x="307" y="247" font-size="11" text-anchor="end" style="fill:var(--muted)">pod matching app=web, with its</text><text x="307" y="262" font-size="11" text-anchor="end" style="fill:var(--muted)">conditions; the dataplane routes</text><text x="307" y="277" font-size="11" text-anchor="end" style="fill:var(--muted)">only to endpoints marked ready.</text><text x="10" y="30" font-size="12" text-anchor="start" font-weight="600" style="fill:var(--text)">Selector app=web matches A, B and C.</text><text x="10" y="47" font-size="11" text-anchor="start" style="fill:var(--muted)">Readiness decides who gets traffic.</text></svg>',
  diagramCaption: 'The Service maps port 80 to targetPort 8080; its EndpointSlice lists all three matching pods, and only the two Ready ones receive traffic.',
  keyPoints: [
    'A Service is a stable virtual IP, DNS name and port mapping in front of a changing set of pods chosen by label selector.',
    'The EndpointSlice controller lists matching pods with conditions; the node dataplane routes only to ready endpoints.',
    'port is what clients call; targetPort is where the pod receives it; containerPort is mostly documentation.',
    'Only type LoadBalancer requests an external load balancer, and only if a controller for that environment exists.',
    'Empty endpoints: check selector versus labels, namespace, then readiness.'
  ],
  misconceptions: [
    'Every Service gets an external load balancer → only type LoadBalancer requests one, and only an installed controller fulfils it.',
    'A not-ready pod is removed and restarted → it stays listed with ready: false and simply stops getting new traffic.',
    'containerPort must be declared for traffic to arrive → the app\'s listening socket is what matters; containerPort is informational apart from named ports.',
    'Scaling up spreads existing load immediately → load balancing is per connection, so long-lived connections stay where they are.'
  ],
  aws: {
    analogy: 'A target group behind an internal ALB or NLB, with health checks deciding which targets receive traffic; Cloud Map for names.',
    breaks: 'A ClusterIP is not a load balancer appliance: it is rules on every node, chosen per connection on the client\'s node. Membership comes from label selection plus pod readiness, not from registering targets, and there is no separate health check: readiness probes run by the kubelet play that role.'
  },
  check: [
    {
      q: 'Service port 80, targetPort 8080, app listening on 3000. What does a client see?',
      a: 'Endpoints exist, but connections to web:80 are delivered to pod:8080 where nothing listens, typically connection refused.'
    },
    {
      q: 'Which object tells you which pods a Service will route to right now?',
      a: 'Its EndpointSlices (kubectl get endpointslices -l kubernetes.io/service-name=<svc>), including each endpoint\'s ready condition.'
    },
    {
      q: 'EXTERNAL-IP stays <pending> on a LoadBalancer Service in a local cluster. Why?',
      a: 'No controller exists in that environment to provision a load balancer; the Service type only requests one.'
    }
  ],
  questions: ['ons-q-net-01', 'ons-q-net-02', 'ons-q-net-07', 'ons-q-arch-08', 'ons-q-net-08'],
  labs: ['ons-lab-03'],
  refs: [
    {
      t: 'Service',
      u: 'https://kubernetes.io/docs/concepts/services-networking/service/'
    },
    {
      t: 'EndpointSlices',
      u: 'https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/'
    },
    {
      t: 'Debug Services',
      u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/'
    }
  ],
  verify: 'Endpoints API deprecation (the EndpointSlice page says deprecated since v1.33) and the default NodePort range depend on cluster version and configuration.'
},
{
  id: 'les-request-path',
  track: 'onsite',
  title: 'The request path: DNS, Service IP, dataplane, pod',
  priority: 'P0',
  mins: 18,
  prereqs: ['les-services'],
  summary: 'Walk a request from a client pod to a backend pod on another node one mechanism at a time, and use a four-rung diagnostic ladder to say which mechanism failed from what the client actually sees.',
  sections: [
    {
      h: 'The network model in four rules',
      body: 'Kubernetes networking is easier to explain once you separate the rules from the implementations.\n\n'
        + '- Every pod gets its own IP address.\n- Pods can reach pods on any node by pod IP without NAT. Kubernetes states the requirement; the cluster\'s **CNI plugin** implements it, using routes, an overlay tunnel, or addresses from the underlying cloud network, depending on the plugin.\n- Agents on a node (such as the kubelet) can reach pods on that node.\n- Service IPs are **virtual**. No network interface and no process owns `10.96.0.20`. The address exists only as rules on every node.\n\n'
        + 'Because these are separate mechanisms, a failing request fails at one specific step, and your job is to find which one.'
    },
    {
      h: 'Step by step: curl http://api:80 from a client pod',
      body: '- **1. Resolve the name.** The app asks its resolver. The pod\'s `/etc/resolv.conf` points at the cluster DNS Service and lists search domains such as `<ns>.svc.cluster.local`, `svc.cluster.local` and `cluster.local` (with `ndots:5`). So the short name `api` is tried as `api.<ns>.svc.cluster.local` first. Cluster DNS (often CoreDNS) watches Services through the API and answers with the ClusterIP. A Service in another namespace needs `api.other` or the full name.\n- **2. Connect to the ClusterIP.** The client opens a TCP connection to `10.96.0.20:80`. The packet leaves the pod and hits rules on the **client\'s own node**, programmed by kube-proxy (iptables, IPVS or nftables mode) or by an eBPF-based dataplane in some CNI plugins. The rules match the Service IP and port, pick one ready endpoint, and rewrite the destination (DNAT) to, for example, `10.244.2.7:8080`. The choice happens per connection, on the sending node.\n- **3. Deliver pod to pod.** Now it is an ordinary packet addressed to a pod IP on node 2. The CNI\'s mechanism carries it there: a route via node 2\'s IP, an encapsulated tunnel, or native cloud routing.\n- **4. Reach the process.** On node 2 the packet enters the backend pod\'s network namespace. Something must be listening on port 8080 on an address reachable from outside the pod (`0.0.0.0`, not `127.0.0.1`). The reply goes back the same way, and connection tracking reverses the address rewrite so the client sees a reply from `10.96.0.20:80`.\n\n'
        + 'One consequence: `ping` is a poor test of a ClusterIP, because the virtual IP typically only handles the Service\'s protocols and ports. A failed ping proves nothing.'
    },
    {
      h: 'The diagnostic ladder',
      body: 'Test one mechanism per rung, from a debug pod in the same namespace as the failing client (for example `kubectl run tmp --rm -it --image=<an image with nslookup and curl> -- sh`; in a disconnected environment that image must already be in your mirror).\n\n'
        + '- **Rung 1: does the name resolve?** `nslookup api` and `nslookup api.<ns>.svc.cluster.local`. `NXDOMAIN` means DNS answered and the name does not exist: wrong name, wrong namespace, or no such Service. A timeout ("no servers could be reached") means the DNS path itself is broken: DNS pods down, or a NetworkPolicy blocking egress to DNS on port 53.\n- **Rung 2: does ServiceIP:port connect?** `curl -v -m 3 http://10.96.0.20:80`. Before theorising, check endpoints: `kubectl get endpointslices -l kubernetes.io/service-name=api`. Depending on the dataplane, a Service with no ready endpoints produces either an immediate connection refused or a timeout.\n- **Rung 3: does podIP:targetPort connect?** `curl -v -m 3 http://10.244.2.7:8080`. If this works but rung 2 does not, the problem is Service configuration (selector, port mapping, readiness) or the node\'s dataplane rules. If this fails too, the problem is the app not listening on that port or interface, the pod network (CNI), or a NetworkPolicy.\n- **Rung 4: what does the app return?** An HTTP 5xx means the network path works and the application or one of its dependencies is failing: read the app\'s logs. A 4xx means you reached the app and the request itself is wrong (path, host header, authentication).\n\n'
        + 'Each rung rules a mechanism in or out. Restarting pods skips all of this and destroys evidence.'
    },
    {
      h: 'Failure signatures at a glance',
      body: '- **NXDOMAIN**: the name does not exist as asked. Check spelling, namespace, and that the Service exists.\n- **DNS timeout or SERVFAIL**: resolvers unreachable or failing. Check DNS pods, their Service endpoints, and egress policy to port 53 (UDP and TCP).\n- **Connection timeout**: packets are dropped silently. Typical causes: a NetworkPolicy, pod network or node firewall problems, or, with some dataplanes, a Service with no endpoints.\n- **Connection refused**: something actively rejected the connection. Typical causes: nothing listening on targetPort, the app bound to `127.0.0.1`, the app not started yet, or a reject rule for a Service with no endpoints.\n- **HTTP 502/503/504 from a proxy, or 500 from the app**: the network delivered the request; look at the application and its upstream dependencies.\n- **Works from some pods but not others**: suspect a NetworkPolicy that selects by source labels, one node\'s stale or broken dataplane, or a DNS search-path difference because the clients are in different namespaces.'
    },
    {
      h: 'Saying it out loud',
      body: 'A version you can say in about a minute: "A request crosses four mechanisms and I test them in order. First, name resolution: cluster DNS turns the Service name into a ClusterIP, and NXDOMAIN versus a timeout tells me whether the name is wrong or DNS is unreachable. Second, the ClusterIP is virtual: rules on the client\'s node rewrite it to a ready pod IP and targetPort, so I check the EndpointSlice before anything else. Third, the CNI carries the packet pod to pod across nodes, so I curl the pod IP directly to split Service problems from pod-network problems. Fourth, the app has to be listening and returning success, which I read from the response code and logs. A timeout usually means something dropped the packet; refused means something answered with no listener; a 5xx means the network worked and the app did not."'
    }
  ],
  diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 346" role="img" aria-label="Request path: a client pod on node 1 resolves api through cluster DNS to ClusterIP 10.96.0.20, connects to port 80, node dataplane rules rewrite the destination to backend pod 10.244.2.7 port 8080, and the CNI pod network carries the packet to the backend pod on node 2." font-family="inherit" font-size="12"><rect x="10" y="30" width="300" height="200" rx="8" style="fill:none;stroke:var(--line);stroke-width:1.2;stroke-dasharray:6 5"/><rect x="320" y="30" width="290" height="200" rx="8" style="fill:none;stroke:var(--line);stroke-width:1.2;stroke-dasharray:6 5"/><text x="22" y="50" font-size="12" text-anchor="start" font-weight="600" style="fill:var(--muted)">Node 1</text><text x="332" y="50" font-size="12" text-anchor="start" font-weight="600" style="fill:var(--muted)">Node 2</text><rect x="26" y="62" width="124" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--blue);stroke-width:1.5"/><text x="88" y="83.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">client pod</text><text x="88" y="98.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">curl http://api:80</text><rect x="176" y="62" width="122" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="237" y="83.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">cluster DNS</text><text x="237" y="98.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">api = 10.96.0.20</text><line x1="150" y1="80" x2="170" y2="80" style="stroke:var(--blue);stroke-width:1.5"/><polygon points="176,80 168,76 168,84" style="fill:var(--blue)"/><line x1="176" y1="96" x2="156" y2="96" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="150,96 158,100 158,92" style="fill:var(--muted)"/><text x="163" y="58" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--blue)">1</text><rect x="26" y="146" width="272" height="62" rx="6" style="fill:var(--bg-elev);stroke:var(--amber);stroke-width:1.5"/><text x="162" y="166" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">node dataplane rules</text><text x="162" y="181" font-size="11" text-anchor="middle" style="fill:var(--muted)">(kube-proxy or equivalent)</text><text x="162" y="196" font-size="11" text-anchor="middle" style="fill:var(--muted)">DNAT 10.96.0.20:80 to 10.244.2.7:8080</text><line x1="88" y1="112" x2="88" y2="140" style="stroke:var(--blue);stroke-width:1.5"/><polygon points="88,146 92,138 84,138" style="fill:var(--blue)"/><text x="96" y="134" font-size="11" text-anchor="start" style="fill:var(--blue)">2 connect to ClusterIP:80</text><rect x="372" y="146" width="196" height="62" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="470" y="166" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">backend pod</text><text x="470" y="181" font-size="11" text-anchor="middle" style="fill:var(--muted)">10.244.2.7</text><text x="470" y="196" font-size="11" text-anchor="middle" style="fill:var(--muted)">listening on :8080</text><rect x="26" y="250" width="584" height="40" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="318" y="266.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">pod network (CNI plugin)</text><text x="318" y="281.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">routes or tunnels pod IP to pod IP across nodes, no NAT</text><line x1="160" y1="208" x2="160" y2="244" style="stroke:var(--blue);stroke-width:1.5"/><polygon points="160,250 164,242 156,242" style="fill:var(--blue)"/><text x="168" y="223" font-size="11" text-anchor="start" style="fill:var(--blue)">3 to pod IP</text><line x1="470" y1="250" x2="470" y2="214" style="stroke:var(--blue);stroke-width:1.5"/><polygon points="470,208 466,216 474,216" style="fill:var(--blue)"/><text x="478" y="223" font-size="11" text-anchor="start" style="fill:var(--blue)">4 deliver</text><text x="10" y="316" font-size="11" text-anchor="start" style="fill:var(--muted)">No process owns 10.96.0.20: the Service IP exists only as rules on every node.</text><text x="10" y="334" font-size="11" text-anchor="start" font-weight="600" style="fill:var(--text)">Test in order: name resolves? Service IP:port? pod IP:targetPort? app response?</text></svg>',
  diagramCaption: 'A client pod resolves api through cluster DNS, connects to the ClusterIP, the node dataplane rewrites it to a ready pod IP and targetPort, and the CNI delivers it to the backend pod on another node.',
  keyPoints: [
    'Every pod has an IP; pods reach each other across nodes without NAT; the CNI plugin implements this.',
    'A ClusterIP is virtual: rules on the client\'s node (kube-proxy or equivalent) rewrite it to a ready endpoint, per connection.',
    'Diagnose in order: name resolves, ServiceIP:port connects, podIP:targetPort connects, app responds correctly.',
    'NXDOMAIN = name wrong; DNS timeout = DNS unreachable; timeout = dropped; refused = no listener or reject rule; 5xx = the app.',
    'Check EndpointSlices before theorising about the network, and do not use ping against a ClusterIP.'
  ],
  misconceptions: [
    'The ClusterIP is a load-balancer process you can ping → it is a set of node rules, and a failed ping proves nothing.',
    'A timeout and connection refused mean the same thing → a timeout means packets were dropped; refused means something answered with a reset.',
    'An HTTP 503 means a network problem → the request reached a proxy or the app; investigate the application or its upstreams.',
    'kube-proxy sits in the data path like a proxy server → in its common modes it programs kernel rules and the kernel forwards packets.'
  ],
  aws: {
    analogy: 'Route 53 private hosted zone for names, an internal NLB for a stable address, VPC routing between subnets, and security groups for filtering.',
    breaks: 'There is no load-balancer appliance behind a ClusterIP; every node carries the rules and the endpoint is chosen on the client\'s node. Pod IPs may not be VPC addresses at all, depending on the CNI. Filtering is NetworkPolicy (only if the CNI enforces it), not security groups attached to an ENI.'
  },
  check: [
    {
      q: 'nslookup api returns NXDOMAIN but nslookup api.payments works. What is wrong?',
      a: 'The Service is in the payments namespace and the client is elsewhere; the short name expands with the client\'s own namespace. Use api.payments or the full name.'
    },
    {
      q: 'curl to the pod IP and targetPort works; curl to the ClusterIP times out. Where do you look?',
      a: 'The Service side: EndpointSlices (selector match and readiness), the port to targetPort mapping, and the node\'s dataplane rules.'
    },
    {
      q: 'The client gets HTTP 503 from the Service. Is DNS a suspect?',
      a: 'No. Name resolution and connection both worked; a response came back. Look at the app or proxy and its dependencies.'
    }
  ],
  questions: ['ons-q-net-04', 'ons-q-net-05', 'ons-q-net-06', 'ons-q-net-10'],
  labs: ['ons-lab-03'],
  refs: [
    {
      t: 'Cluster networking',
      u: 'https://kubernetes.io/docs/concepts/cluster-administration/networking/'
    },
    {
      t: 'Virtual IPs and Service proxies',
      u: 'https://kubernetes.io/docs/reference/networking/virtual-ips/'
    },
    {
      t: 'DNS for Services and Pods',
      u: 'https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/'
    },
    {
      t: 'Debug Services',
      u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/'
    }
  ],
  verify: 'Whether a Service with no ready endpoints yields connection refused or a timeout depends on the proxy mode or dataplane implementation; confirm on your cluster.'
},
{
  id: 'les-netpol',
  track: 'onsite',
  title: 'NetworkPolicy: isolating traffic',
  priority: 'P1',
  mins: 12,
  prereqs: ['les-request-path'],
  summary: 'Explain why namespaces do not isolate traffic, how NetworkPolicy selects pods and builds an allow-list, why enforcement depends on the CNI plugin, and how to apply default-deny without breaking DNS.',
  sections: [
    {
      h: 'Namespaces do not isolate traffic',
      body: 'Namespaces scope names, RBAC, quotas and policy objects. They do not block packets. By default every pod can reach every other pod, in every namespace, on every port. If a team puts production and test in separate namespaces and assumes they are isolated, a test pod can still connect to a production database pod IP.\n\n'
        + 'Isolation at layers 3 and 4 comes from **NetworkPolicy** (or from another mechanism, such as a service mesh or host firewalling), and only if something enforces it.'
    },
    {
      h: 'How a policy selects and allows',
      body: 'A NetworkPolicy has a `podSelector` (which pods in its namespace it applies to) and `policyTypes` (Ingress, Egress, or both).\n\n'
        + '- Once any policy selects a pod for a direction, that direction becomes **deny by default** for that pod, except for what some policy allows.\n- Policies are **additive allow-lists**. The allowed traffic is the union of all policies that select the pod. There are no deny rules in the standard API, and order does not matter.\n- Rules name peers with `podSelector`, `namespaceSelector`, `ipBlock`, and ports. Watch the YAML structure: a single `from` entry containing both a namespaceSelector and a podSelector means pods matching both (AND); two separate entries mean either (OR). This is a very common mistake.\n- Reply traffic for an allowed connection is allowed; you do not write rules for return packets.\n- The docs list some exceptions: for example, traffic between a pod and the node it runs on is always allowed, which is why kubelet probes keep working under a default-deny policy.\n\n'
        + 'Standard NetworkPolicy works on IPs, ports and protocols. It has no notion of HTTP paths or hostnames; some CNI plugins add their own resource types for that.'
    },
    {
      h: 'Enforcement belongs to the CNI plugin',
      body: 'The API server accepts a NetworkPolicy object whether or not anything enforces it. Enforcement is done by the network plugin. If the cluster\'s CNI does not implement NetworkPolicy, the policy is stored, shows up in `kubectl get networkpolicy`, and has no effect. Nothing warns you.\n\n'
        + 'This matters for labs. kind\'s default CNI (kindnetd) is described in the kind docs as a simple networking implementation; do not assume it enforces NetworkPolicy, since support depends on the kind version. For a policy exercise, either install a CNI that enforces policy (kind supports `networking.disableDefaultCNI: true` for this) or treat the exercise as conceptual. In either case, prove enforcement: a test that shows allowed traffic working is not enough; you must also show that traffic which should be blocked is actually blocked.'
    },
    {
      h: 'Default-deny, then allow, and remember DNS',
      body: 'A default-deny ingress policy for a namespace selects every pod and allows nothing:\n\n'
        + '- `podSelector: {}` and `policyTypes: [Ingress]`, with no ingress rules.\n\n'
        + 'Then add narrow allows, for example ingress to `app: api` from pods labelled `app: web` on TCP 8080. For egress, the same pattern applies, and there is a trap: once egress is denied, pods cannot resolve names. Allow UDP and TCP 53 to the cluster DNS pods, typically selected with a namespaceSelector on `kubernetes.io/metadata.name: kube-system` plus a podSelector for the DNS pods\' label (`k8s-app: kube-dns` is common, but labels vary by distribution). If you forget, every name lookup times out and it looks like "the network is down".\n\n'
        + 'Also think about egress the workload genuinely needs: the Kubernetes API server if it talks to the API, a database outside the cluster by `ipBlock`, an internal registry mirror or proxy.'
    },
    {
      h: 'Observing and testing',
      body: '- `kubectl get networkpolicy -A` and `kubectl describe networkpolicy <name> -n <ns>` show what is selected and allowed.\n- Test with a pod that carries the labels of a real client: `kubectl run t --rm -it -n <ns> --labels=app=web --image=<debug image> -- sh`, then `curl -m 3 http://api:8080`. Repeat with labels that should be denied.\n- Blocked traffic usually looks like a **timeout** (packets dropped), not connection refused.\n- A policy change affecting existing long-lived connections can behave differently from new connections, depending on the implementation.'
    }
  ],
  diagram: '',
  diagramCaption: '',
  keyPoints: [
    'Namespaces do not isolate network traffic; by default all pods can reach all pods.',
    'Selected pods become default-deny for that direction; policies are additive allow-lists with no deny rules.',
    'Enforcement is the CNI plugin\'s job; without support, policies are silently ignored.',
    'Default-deny egress must explicitly allow DNS (UDP and TCP 53) to the cluster DNS pods.',
    'Prove enforcement by showing that traffic which should be blocked times out.'
  ],
  misconceptions: [
    'Separate namespaces isolate workloads → they scope names and permissions; NetworkPolicy isolates traffic, and only if the CNI enforces it.',
    'If kubectl shows the policy, it is working → the API stores it regardless; test the traffic.',
    'You can write a deny rule for one bad client → the standard API is allow-only; you narrow what is allowed instead.',
    'namespaceSelector and podSelector in separate from entries mean AND → separate entries are OR; both in one entry is AND.'
  ],
  aws: {
    analogy: 'Security groups: stateful allow-lists attached to workloads, with rules referencing other groups.',
    breaks: 'Security groups are always enforced by the platform; NetworkPolicy depends on the CNI. Security groups have no implicit deny switch for a whole namespace; a pod becomes isolated only when some policy selects it. Peers are chosen by label selectors, not group membership. NACLs, the AWS construct with explicit deny, have no equivalent in the standard API.'
  },
  check: [
    {
      q: 'You apply default-deny egress and every request fails with a name-resolution timeout. Why?',
      a: 'DNS traffic is egress too; allow UDP and TCP 53 to the cluster DNS pods.'
    },
    {
      q: 'A policy exists and allowed traffic works. Is the cluster enforcing policy?',
      a: 'Not proven. Enforcement depends on the CNI; test that traffic which should be blocked is actually blocked.'
    },
    {
      q: 'Two policies select the same pod, one allowing app=web and one allowing app=batch. What is allowed?',
      a: 'Both: policies are additive, so the allowed set is the union.'
    }
  ],
  questions: ['ons-q-net-09', 'ons-q-net-10'],
  labs: [],
  refs: [
    {
      t: 'Network Policies',
      u: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/'
    },
    {
      t: 'kind: configuration (disableDefaultCNI)',
      u: 'https://kind.sigs.k8s.io/docs/user/configuration/'
    }
  ],
  verify: 'Whether kind\'s default CNI (kindnetd) enforces NetworkPolicy depends on the kind version and could not be confirmed from the kind docs; test enforcement directly, or install a policy-enforcing CNI.'
},
{
  id: 'les-probes',
  track: 'onsite',
  title: 'Readiness, liveness and startup probes',
  priority: 'P0',
  mins: 12,
  prereqs: ['les-pod-lifecycle', 'les-services'],
  summary: 'Explain the different question each probe asks and the different consequence of each failing, do the timing arithmetic, and design probes that protect traffic without causing restart storms.',
  sections: [
    {
      h: 'Three questions, three consequences',
      body: 'Probes are run by the kubelet on the pod\'s node, using an HTTP GET (a 2xx or 3xx status is success), a TCP connect, a command inside the container (exit 0 is success), or gRPC.\n\n'
        + '- **Startup probe**: "Has the app finished starting?" Until it succeeds once, the kubelet does not run liveness or readiness probes. If it fails past its threshold, the container is killed and restarted according to restartPolicy.\n- **Readiness probe**: "Should this pod receive traffic right now?" A failure sets the pod\'s Ready condition to false, and the pod is marked not ready in the Service\'s EndpointSlices, so it stops receiving new connections. **The container is not restarted.** Readiness runs for the pod\'s whole life and can flip back and forth.\n- **Liveness probe**: "Is this process stuck beyond recovery?" After enough consecutive failures, the kubelet kills the container (SIGTERM, then SIGKILL after the grace period) and restarts it.\n\n'
        + 'Readiness controls traffic; liveness controls restarts. Mixing them up is the most common probe mistake.'
    },
    {
      h: 'Timing arithmetic',
      body: 'Each probe has `initialDelaySeconds`, `periodSeconds` (default 10), `timeoutSeconds` (default 1), `failureThreshold` (default 3) and `successThreshold` (default 1, and it must be 1 for liveness and startup).\n\n'
        + '- Liveness with period 10 and failureThreshold 3: roughly 30 seconds of consecutive failures before a restart.\n- Startup with period 10 and failureThreshold 30: up to about 300 seconds for the app to start before it is killed.\n- A 1-second timeout on an endpoint that sometimes takes 2 seconds under load counts as a failure every time it is slow.\n\n'
        + 'Prefer a startup probe for slow starters over a large `initialDelaySeconds` on liveness: the startup probe ends as soon as the app is up, while an initial delay is a fixed guess.'
    },
    {
      h: 'Running is not Ready',
      body: '`kubectl get pods` can show STATUS Running with READY `0/1`: the container is up, but the readiness probe is failing, so the pod receives no Service traffic. Clients see failures, or see fewer backends, while everything looks "Running".\n\n'
        + 'Rollouts depend on readiness too. A Deployment counts a new pod as available only when it is Ready (and has stayed Ready for `minReadySeconds`). A new version whose readiness never passes stalls the rollout while old pods keep serving, which is the protection working.'
    },
    {
      h: 'Designing probes that do not cause outages',
      body: '- **Liveness should check the process, not its dependencies.** If the liveness check calls the database and the database has a brief outage, every pod fails liveness at once, every container restarts, and the restarts add load and cold caches without fixing the database. A restart storm turns a dependency blip into your own outage.\n- **Readiness can reflect the ability to serve, but choose deliberately.** If readiness includes a hard dependency and that dependency fails, all pods go unready together and the Service has no endpoints: a total outage instead of a degraded one. Sometimes that is right (fail fast to a fallback), often it is not.\n- **Give liveness generous timing.** A liveness probe that fails during garbage-collection pauses or load spikes kills pods exactly when capacity is most needed.\n- **Keep probe endpoints cheap** and free of side effects.\n- **Not every container needs a liveness probe.** If the process exits when it is broken, the kubelet already restarts it.'
    },
    {
      h: 'Observing probes',
      body: '- `kubectl describe pod <p>` events: `Readiness probe failed: HTTP probe failed with statuscode: 503`, or `Liveness probe failed: ...` followed by `Container app failed liveness probe, will be restarted`.\n- `kubectl get pods -w`: READY toggles for readiness failures; RESTARTS increments for liveness failures.\n- `kubectl get endpointslices -l kubernetes.io/service-name=web -o yaml`: `ready: false` for the affected endpoint.\n- After a liveness kill, `lastState.terminated` usually shows exit 143 if the app exited on SIGTERM, or 137 if it had to be SIGKILLed after the grace period.'
    }
  ],
  diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 610 316" role="img" aria-label="Probe timeline: the startup probe fails while the app boots and gates the other probes until it passes. Readiness later fails for a while, which removes the pod from endpoints without a restart. Liveness then fails past its threshold and the kubelet restarts the container." font-family="inherit" font-size="12"><text x="10" y="64" font-size="12" text-anchor="start" font-weight="600" style="fill:var(--text)">startup</text><line x1="100" y1="60" x2="600" y2="60" style="stroke:var(--line);stroke-width:1"/><text x="10" y="139" font-size="12" text-anchor="start" font-weight="600" style="fill:var(--text)">readiness</text><line x1="100" y1="135" x2="600" y2="135" style="stroke:var(--line);stroke-width:1"/><text x="10" y="214" font-size="12" text-anchor="start" font-weight="600" style="fill:var(--text)">liveness</text><line x1="100" y1="210" x2="600" y2="210" style="stroke:var(--line);stroke-width:1"/><line x1="100" y1="60" x2="220" y2="60" style="stroke:var(--amber);stroke-width:8;stroke-linecap:butt"/><line x1="220" y1="60" x2="236" y2="60" style="stroke:var(--accent);stroke-width:8;stroke-linecap:butt"/><text x="160" y="46" font-size="11" text-anchor="middle" style="fill:var(--muted)">failing while app boots</text><text x="244" y="46" font-size="11" text-anchor="start" style="fill:var(--muted)">passes once, then stops</text><line x1="228" y1="30" x2="228" y2="236" style="stroke:var(--accent);stroke-width:1;stroke-dasharray:3 3"/><line x1="100" y1="135" x2="228" y2="135" style="stroke:var(--line);stroke-width:3;stroke-linecap:butt"/><text x="164" y="124" font-size="11" text-anchor="middle" style="fill:var(--muted)">not run yet</text><line x1="228" y1="135" x2="370" y2="135" style="stroke:var(--accent);stroke-width:8;stroke-linecap:butt"/><text x="299" y="124" font-size="11" text-anchor="middle" style="fill:var(--muted)">Ready: in endpoints</text><line x1="370" y1="135" x2="450" y2="135" style="stroke:var(--amber);stroke-width:8;stroke-linecap:butt"/><text x="410" y="158" font-size="11" text-anchor="middle" style="fill:var(--amber)">NotReady: removed</text><text x="410" y="172" font-size="11" text-anchor="middle" style="fill:var(--amber)">from endpoints, no restart</text><line x1="450" y1="135" x2="510" y2="135" style="stroke:var(--accent);stroke-width:8;stroke-linecap:butt"/><line x1="100" y1="210" x2="228" y2="210" style="stroke:var(--line);stroke-width:3;stroke-linecap:butt"/><text x="164" y="199" font-size="11" text-anchor="middle" style="fill:var(--muted)">not run yet</text><line x1="228" y1="210" x2="470" y2="210" style="stroke:var(--accent);stroke-width:8;stroke-linecap:butt"/><line x1="470" y1="210" x2="510" y2="210" style="stroke:var(--amber);stroke-width:8;stroke-linecap:butt"/><circle cx="510" cy="210" r="6" style="fill:var(--red)"/><line x1="510" y1="120" x2="510" y2="236" style="stroke:var(--red);stroke-width:1.5;stroke-dasharray:4 3"/><text x="516" y="196" font-size="11" text-anchor="start" style="fill:var(--red)">threshold hit:</text><text x="516" y="230" font-size="11" text-anchor="start" style="fill:var(--red)">kubelet restarts</text><text x="516" y="244" font-size="11" text-anchor="start" style="fill:var(--red)">the container</text><text x="516" y="100" font-size="11" text-anchor="start" style="fill:var(--muted)">after restart,</text><text x="516" y="114" font-size="11" text-anchor="start" style="fill:var(--muted)">startup again</text><line x1="100" y1="262" x2="594" y2="262" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="600,262 592,258 592,266" style="fill:var(--muted)"/><text x="100" y="278" font-size="11" text-anchor="start" style="fill:var(--muted)">container starts</text><text x="600" y="278" font-size="11" text-anchor="end" style="fill:var(--muted)">time</text><line x1="100" y1="300" x2="124" y2="300" style="stroke:var(--accent);stroke-width:8;stroke-linecap:butt"/><text x="130" y="304" font-size="11" text-anchor="start" style="fill:var(--muted)">passing</text><line x1="200" y1="300" x2="224" y2="300" style="stroke:var(--amber);stroke-width:8;stroke-linecap:butt"/><text x="230" y="304" font-size="11" text-anchor="start" style="fill:var(--muted)">failing</text><circle cx="310" cy="300" r="5" style="fill:var(--red)"/><text x="320" y="304" font-size="11" text-anchor="start" style="fill:var(--muted)">failureThreshold reached</text></svg>',
  diagramCaption: 'The startup probe gates the others until it passes; a readiness failure removes the pod from endpoints without a restart; a liveness failure past its threshold restarts the container.',
  keyPoints: [
    'Startup gates the other probes; readiness controls traffic; liveness controls restarts.',
    'A readiness failure removes the pod from Service endpoints and never restarts the container.',
    'Running does not imply Ready: READY 0/1 means no Service traffic.',
    'Failure time is roughly periodSeconds × failureThreshold; timeouts count as failures.',
    'Liveness probes that check dependencies cause synchronized restart storms.'
  ],
  misconceptions: [
    'A failing readiness probe restarts the container → it only marks the pod not ready and removes it from endpoints.',
    'Running means serving → only Ready pods receive Service traffic.',
    'Liveness should verify the database is reachable → that restarts every pod during a database blip; check the process itself.',
    'A long initialDelaySeconds is the best way to handle slow starts → a startup probe adapts to the actual start time.'
  ],
  aws: {
    analogy: 'ALB target group health checks (take a target out of rotation) and ECS container health checks (can cause a task to be replaced).',
    breaks: 'In ECS, a failing container health check typically leads to the task being stopped and replaced; in Kubernetes that consequence belongs only to liveness, and it restarts the container in place. Readiness is closer to the target-group health check, but it is run by the kubelet on the node, not by the load balancer, and it changes EndpointSlice membership.'
  },
  check: [
    {
      q: 'Readiness fails for two minutes, then recovers. What happened to the container?',
      a: 'Nothing: it kept running with the same restart count. The pod was out of Service endpoints while not ready.'
    },
    {
      q: 'Liveness: periodSeconds 5, failureThreshold 6. How long until a hung app restarts?',
      a: 'About 30 seconds of consecutive failures (plus the termination grace period before SIGKILL if it ignores SIGTERM).'
    },
    {
      q: 'Why is a startup probe better than initialDelaySeconds: 300 on liveness?',
      a: 'The startup probe ends as soon as the app is up and still allows a long ceiling; the fixed delay leaves a hung app unchecked for five minutes every start.'
    }
  ],
  questions: ['ons-q-trouble-03', 'ons-q-net-03', 'ons-q-trouble-04'],
  labs: ['ons-lab-04'],
  refs: [
    {
      t: 'Configure liveness, readiness and startup probes',
      u: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/'
    },
    {
      t: 'Pod lifecycle: container probes',
      u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/'
    }
  ],
  verify: 'Probe defaults (periodSeconds 10, timeoutSeconds 1, failureThreshold 3) are long-standing; confirm for your cluster version.'
},
{
  id: 'les-resources',
  track: 'onsite',
  title: 'Requests, limits, QoS classes and OOM kills',
  priority: 'P0',
  mins: 14,
  prereqs: ['les-pod-lifecycle'],
  summary: 'Explain what requests and limits each control, how QoS classes are derived, and tell a container OOM kill from node-pressure eviction and from preemption using the evidence each one leaves.',
  sections: [
    {
      h: 'Requests are for scheduling',
      body: 'A **request** is the amount of CPU or memory the scheduler reserves for a container. The scheduler places a pod only on a node where the node\'s allocatable capacity minus the sum of requests already placed there fits the new pod\'s requests. It does not look at live usage. A node at 20% actual CPU can still reject new pods if its CPU requests are fully booked, and a node can be overcommitted in practice if pods use far more than they request.\n\n'
        + 'CPU is measured in cores or millicores (`500m` = half a core); memory in bytes (`512Mi`). CPU requests also set each container\'s share of CPU when the node is contended.\n\n'
        + '- `kubectl describe node <n>`: the "Allocated resources" section shows requests and limits as a percentage of allocatable.\n- `kubectl top pod` and `kubectl top node` show live usage (they need a metrics server installed).'
    },
    {
      h: 'Limits are enforced by the kernel on the node',
      body: 'A **limit** is a ceiling enforced through the container\'s cgroup on the node.\n\n'
        + '- **Memory limit**: if the container\'s memory use reaches the limit and cannot be reclaimed, the kernel OOM killer kills a process in that cgroup. If that is the main process, the container terminates with reason `OOMKilled` and exit code 137, and the kubelet restarts it per restartPolicy. The pod is not evicted and not rescheduled; it is the same pod with a higher restart count.\n- **CPU limit**: exceeding it leads to **throttling**, not killing. The process is paused for the rest of each scheduling period. Symptoms are latency, timeouts and probe failures under load, which can look like a slow or broken app.\n- **No limit**: the container may use spare capacity on the node, and competes with its neighbours for it.'
    },
    {
      h: 'QoS classes',
      body: 'Kubernetes derives a Quality of Service class from requests and limits:\n\n'
        + '- **Guaranteed**: every container has CPU and memory requests equal to its limits.\n- **Burstable**: not Guaranteed, but at least one container has a CPU or memory request or limit.\n- **BestEffort**: no container has any requests or limits.\n\n'
        + 'The kubelet uses the class, together with priority and usage, when it must evict pods under node pressure, and it sets the kernel\'s OOM score so BestEffort processes are killed first in a node-wide OOM. `kubectl get pod <p> -o jsonpath=\'{.status.qosClass}\'` shows it.'
    },
    {
      h: 'Three different resource deaths',
      body: '- **Container OOM kill.** Actor: the kernel. Trigger: the container hit its own memory limit (or the node ran completely out of memory). Evidence: `lastState.terminated.reason: OOMKilled`, exit 137, RESTARTS increasing, same pod object.\n- **Node-pressure eviction.** Actor: the kubelet. Trigger: the node\'s available memory, disk or process IDs fall below eviction thresholds. The kubelet terminates pods to reclaim resources, considering first whether a pod\'s usage exceeds its requests, then priority, then usage relative to requests. Evidence: pod phase Failed with reason `Evicted` and a message such as "The node was low on resource: memory", node conditions like `MemoryPressure` or `DiskPressure`, and a replacement pod created by the controller elsewhere.\n- **Preemption.** Actor: the scheduler. Trigger: a pending higher-priority pod does not fit, so lower-priority pods are removed to make room. Evidence: events on the victim mentioning preemption, and `status.nominatedNodeName` on the pending pod.\n\n'
        + 'A fourth path is API-initiated eviction, such as `kubectl drain`, which respects PodDisruptionBudgets. Naming the actor (kernel, kubelet, scheduler, an operator) is most of the diagnosis.'
    },
    {
      h: 'Setting values sensibly',
      body: '- Measure first: base memory requests on steady-state working set and set memory limits above observed peaks. Many teams set memory limit equal to request for predictability.\n- CPU limits are a trade-off: they protect neighbours but cause throttling; some teams set CPU requests and omit CPU limits. Decide consciously, per workload.\n- Language runtimes need their heap sized inside the container limit, or the kernel kills the process before the runtime\'s own memory management reacts.\n- Namespaces can have a **LimitRange** (default and maximum values) and a **ResourceQuota** (total per namespace). A quota rejects pods at creation, so no pod exists at all: look for "exceeded quota" in the ReplicaSet\'s events, not in pod events.'
    }
  ],
  diagram: '',
  diagramCaption: '',
  keyPoints: [
    'Requests drive scheduling (reserved, not measured usage); limits are enforced by the kernel via cgroups.',
    'Memory over the limit → OOM kill of the container (reason OOMKilled, exit 137); CPU over the limit → throttling, never a kill.',
    'QoS: Guaranteed (requests = limits for all), Burstable (some set), BestEffort (none).',
    'OOM kill (kernel, same pod restarts), node-pressure eviction (kubelet, pod Failed/Evicted, replaced), preemption (scheduler, priority).',
    'ResourceQuota rejections happen at pod creation: the evidence is in ReplicaSet events.'
  ],
  misconceptions: [
    'Requests limit what a container can use → requests reserve capacity for scheduling; limits cap usage.',
    'CPU limits kill containers that use too much CPU → they throttle; only memory limits lead to kills.',
    'Every 137 is an OOM kill → 137 is SIGKILL; OOM is shown by reason OOMKilled.',
    'An evicted pod and an OOM-killed container are the same thing → eviction is the kubelet removing a pod under node pressure; OOM kill is the kernel killing a process in one container.'
  ],
  aws: {
    analogy: 'ECS task and container cpu/memory settings: memoryReservation (soft) and memory (hard), with placement based on reserved capacity.',
    breaks: 'ECS hard memory limits also end in the container being killed, but ECS then usually stops and replaces the task, whereas the kubelet restarts the container in the same pod. Kubernetes adds QoS classes, kubelet node-pressure eviction and priority-based preemption, which have no direct ECS equivalent.'
  },
  check: [
    {
      q: 'A pod is Pending with "Insufficient memory" while nodes show 30% memory usage. How?',
      a: 'Scheduling uses requests, not usage; the nodes\' memory requests are fully allocated.'
    },
    {
      q: 'An app becomes slow under load and fails readiness, but never restarts. Which limit is suspect?',
      a: 'The CPU limit: CPU over the limit is throttled, which shows up as latency and probe timeouts, not kills.'
    },
    {
      q: 'What distinguishes an eviction from an OOM kill in kubectl output?',
      a: 'Eviction: pod phase Failed, reason Evicted, a node-pressure message, and a replacement pod. OOM kill: same pod, lastState reason OOMKilled, exit 137, restart count up.'
    }
  ],
  questions: ['ons-q-trouble-02', 'ons-q-trouble-07', 'ons-q-trouble-10', 'ons-q-design-06'],
  labs: ['ons-lab-07', 'ons-lab-05'],
  refs: [
    {
      t: 'Resource management for pods and containers',
      u: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/'
    },
    {
      t: 'Pod quality of service classes',
      u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/'
    },
    {
      t: 'Node-pressure eviction',
      u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/'
    },
    {
      t: 'Pod priority and preemption',
      u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/'
    }
  ],
  verify: 'Eviction ranking details and whether an OOM of a non-main process terminates the container depend on version and cgroup configuration (cgroup v2 may kill the whole container group).'
},
{
  id: 'les-scheduling',
  track: 'onsite',
  title: 'Scheduling: filter, score, bind',
  priority: 'P0',
  mins: 12,
  prereqs: ['les-resources'],
  summary: 'Explain how the scheduler picks a node, read an Unschedulable event line by line, and steer placement with node selectors, affinity, spread constraints, taints and tolerations.',
  sections: [
    {
      h: 'What the scheduler actually does',
      body: 'The scheduler watches for pods with an empty `spec.nodeName`. For each one it:\n\n'
        + '- **Filters**: removes nodes where the pod cannot run (not enough requested resources left, label or affinity mismatch, a taint the pod does not tolerate, a volume in another zone, the node cordoned).\n- **Scores**: ranks the remaining nodes (spreading, resource balance, preferred affinities, image locality and so on).\n- **Binds**: writes the chosen node into the pod through a binding. The kubelet on that node then notices the pod and starts it.\n\n'
        + 'If no node passes filtering, the pod stays Pending with condition `PodScheduled=False`, reason `Unschedulable`, and an event summarising why each node was rejected. The scheduler retries when something relevant changes, such as a new node or a deleted pod. The scheduler never starts containers, and it does not look at live usage.'
    },
    {
      h: 'Reading the filter reasons',
      body: 'A typical event (exact wording varies by version):\n\n'
        + '`0/6 nodes are available: 1 Insufficient cpu, 1 node(s) had untolerated taint {dedicated: gpu}, 2 node(s) didn\'t match Pod\'s node affinity/selector, 1 node(s) had volume node affinity conflict, 1 node(s) were unschedulable.`\n\n'
        + '- **Insufficient cpu/memory**: the pod\'s requests do not fit the node\'s allocatable minus existing requests.\n- **Untolerated taint**: the node repels pods without a matching toleration.\n- **Didn\'t match node affinity/selector**: a required label is missing on those nodes.\n- **Volume node affinity conflict**: the pod\'s PersistentVolume is pinned to a zone or node this node is not in.\n- **Unschedulable**: the node is cordoned.\n- Pod anti-affinity and topology spread constraints produce their own messages.\n\n'
        + 'Add the numbers up: every node appears under exactly one reason. That tells you whether the fix is capacity, labels, tolerations or storage.'
    },
    {
      h: 'Steering placement',
      body: '- **nodeSelector**: the pod runs only on nodes with these exact labels.\n- **Node affinity**: richer expressions. `requiredDuringSchedulingIgnoredDuringExecution` is a hard filter; `preferred...` only affects scoring. "IgnoredDuringExecution" means running pods are not evicted if node labels change later.\n- **Pod affinity and anti-affinity**: place pods near, or away from, other pods, per `topologyKey` (for example per node, or per zone via `topology.kubernetes.io/zone`).\n- **Topology spread constraints**: spread replicas evenly across zones or nodes within a `maxSkew`.\n\n'
        + 'Hard constraints can make pods unschedulable; for example, required anti-affinity per node with more replicas than nodes leaves the extra replicas Pending.'
    },
    {
      h: 'Taints and tolerations',
      body: 'A **taint** on a node repels pods; a **toleration** on a pod lets it ignore that taint. Effects:\n\n'
        + '- `NoSchedule`: new pods without a toleration are not placed.\n- `PreferNoSchedule`: avoided if possible.\n- `NoExecute`: also evicts running pods that do not tolerate it, optionally after `tolerationSeconds`.\n\n'
        + 'A toleration permits; it does not attract. To dedicate nodes to a workload, combine a taint (keep others off) with a toleration and a node selector or affinity (pull the workload on). Control-plane nodes are commonly tainted `node-role.kubernetes.io/control-plane:NoSchedule`. The node lifecycle controller adds `node.kubernetes.io/not-ready` and `node.kubernetes.io/unreachable` taints when a node fails, which is how pods get evicted from lost nodes (see the failure lesson).'
    },
    {
      h: 'Diagnosing Pending',
      body: '- `kubectl describe pod <p>`: the scheduler\'s event is the primary evidence.\n- `kubectl get nodes -L topology.kubernetes.io/zone --show-labels`: labels your selectors and affinities depend on.\n- `kubectl describe node <n>`: Taints, Conditions and Allocated resources.\n- `kubectl get pvc`: a pod using an unbound PVC is not scheduled (with Immediate binding the event mentions unbound PersistentVolumeClaims).\n- If no pod exists at all, the problem is before scheduling: a quota or admission rejection shows in the ReplicaSet\'s events.\n- A pod that already has a `nodeName` but is not running is past scheduling: look at image pulls, volume mounts and container creation instead.\n\n'
        + 'Fixes follow the reason: right-size requests, add capacity, correct labels or tolerations, or fix storage topology. Restarting the scheduler fixes none of these.'
    }
  ],
  diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 610 312" role="img" aria-label="Scheduling: a pending pod goes through filtering, where nodes are rejected for reasons such as insufficient cpu, an untolerated taint, an affinity mismatch or a volume zone conflict; the feasible nodes are scored; the best is bound by setting nodeName." font-family="inherit" font-size="12"><rect x="10" y="120" width="104" height="56" rx="6" style="fill:var(--bg-elev);stroke:var(--blue);stroke-width:1.5"/><text x="62" y="144.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">pending pod</text><text x="62" y="159.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">no nodeName</text><rect x="140" y="20" width="220" height="256" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="250" y="42" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">1 filter: can it run here?</text><circle cx="158" cy="68" r="4" style="fill:var(--accent)"/><text x="170" y="72" font-size="12" text-anchor="start" style="fill:var(--text)">node-a</text><text x="222" y="72" font-size="11" text-anchor="start" style="fill:var(--accent)">fits</text><circle cx="158" cy="102" r="4" style="fill:var(--red)"/><text x="170" y="106" font-size="12" text-anchor="start" style="fill:var(--text)">node-b</text><text x="222" y="106" font-size="11" text-anchor="start" style="fill:var(--red)">Insufficient cpu</text><circle cx="158" cy="136" r="4" style="fill:var(--red)"/><text x="170" y="140" font-size="12" text-anchor="start" style="fill:var(--text)">node-c</text><text x="222" y="140" font-size="11" text-anchor="start" style="fill:var(--red)">untolerated taint</text><circle cx="158" cy="170" r="4" style="fill:var(--red)"/><text x="170" y="174" font-size="12" text-anchor="start" style="fill:var(--text)">node-d</text><text x="222" y="174" font-size="11" text-anchor="start" style="fill:var(--red)">affinity mismatch</text><circle cx="158" cy="204" r="4" style="fill:var(--accent)"/><text x="170" y="208" font-size="12" text-anchor="start" style="fill:var(--text)">node-e</text><text x="222" y="208" font-size="11" text-anchor="start" style="fill:var(--accent)">fits</text><circle cx="158" cy="238" r="4" style="fill:var(--red)"/><text x="170" y="242" font-size="12" text-anchor="start" style="fill:var(--text)">node-f</text><text x="222" y="242" font-size="11" text-anchor="start" style="fill:var(--red)">volume zone conflict</text><rect x="390" y="70" width="100" height="90" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="440" y="104" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">2 score</text><text x="440" y="119" font-size="11" text-anchor="middle" style="fill:var(--muted)">node-a: 62</text><text x="440" y="134" font-size="11" text-anchor="middle" style="fill:var(--muted)">node-e: 81</text><rect x="510" y="86" width="94" height="58" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="557" y="104" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">3 bind</text><text x="557" y="119" font-size="11" text-anchor="middle" style="fill:var(--muted)">nodeName:</text><text x="557" y="134" font-size="11" text-anchor="middle" style="fill:var(--muted)">node-e</text><line x1="114" y1="148" x2="134" y2="148" style="stroke:var(--blue);stroke-width:1.5"/><polygon points="140,148 132,144 132,152" style="fill:var(--blue)"/><line x1="360" y1="115" x2="384" y2="115" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="390,115 382,111 382,119" style="fill:var(--accent)"/><line x1="490" y1="115" x2="504" y2="115" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="510,115 502,111 502,119" style="fill:var(--accent)"/><text x="390" y="196" font-size="11" text-anchor="start" style="fill:var(--muted)">kubelet on node-e sees the</text><text x="390" y="211" font-size="11" text-anchor="start" style="fill:var(--muted)">binding and starts the pod.</text><text x="390" y="240" font-size="11" text-anchor="start" style="fill:var(--red)">No node passes filter: pod stays</text><text x="390" y="255" font-size="11" text-anchor="start" style="fill:var(--red)">Pending; the event lists reasons.</text><text x="10" y="300" font-size="11" text-anchor="start" style="fill:var(--muted)">Filters compare requests (not live usage), labels, taints, affinity and volume topology.</text></svg>',
  diagramCaption: 'A pending pod is filtered against every node (with example rejection reasons), the feasible nodes are scored, and the winner is bound by setting nodeName.',
  keyPoints: [
    'Scheduling is filter (can it run here), score (where is best), bind (write nodeName). The kubelet starts the pod.',
    'Filters use requests, labels, affinity, taints and volume topology, not live usage.',
    'The Unschedulable event accounts for every node; read it as a breakdown of reasons.',
    'Taints repel and tolerations permit; dedicating nodes needs taint + toleration + selector or affinity.',
    'No pod object at all means quota or admission rejection; nodeName set but not running means a post-scheduling problem.'
  ],
  misconceptions: [
    'The scheduler starts pods → it only binds them to a node.',
    'A toleration makes a pod run on the tainted node → it only allows it; use affinity or a selector to attract it.',
    'Pending means the image is still pulling → Pending covers both unscheduled and scheduled-but-not-started; check nodeName and events.',
    'Low measured usage means a pod will fit → scheduling counts requests.'
  ],
  aws: {
    analogy: 'ECS task placement: constraints (memberOf, distinctInstance) and strategies (spread, binpack), with RESOURCE errors when nothing fits.',
    breaks: 'ECS constraints are expressed per service; Kubernetes adds node-side taints that repel workloads, pod-to-pod affinity by topology key, and volume topology as a scheduling input. Unschedulable pods remain as objects waiting to be retried rather than failed placements.'
  },
  check: [
    {
      q: 'Event: "0/3 nodes are available: 3 Insufficient memory". Node usage is low. What next?',
      a: 'Compare the pod\'s memory request with each node\'s allocatable and already-requested memory (describe node); right-size the request or add capacity.'
    },
    {
      q: 'A pod tolerates the gpu taint but lands on ordinary nodes. Why?',
      a: 'Tolerations permit, they do not attract; add a node selector or affinity for the gpu nodes.'
    },
    {
      q: 'A Deployment shows 0 pods and no pod events. Where is the evidence?',
      a: 'In the ReplicaSet\'s events: a ResourceQuota or admission rejection prevented pod creation.'
    }
  ],
  questions: ['ons-q-trouble-01', 'ons-q-trouble-10', 'ons-q-design-06'],
  labs: ['ons-lab-05'],
  refs: [
    {
      t: 'Kubernetes scheduler',
      u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/'
    },
    {
      t: 'Assigning pods to nodes',
      u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/'
    },
    {
      t: 'Taints and tolerations',
      u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/'
    }
  ],
  verify: 'Exact Unschedulable event wording varies by Kubernetes version.'
},
{
  id: 'les-rollouts',
  track: 'onsite',
  title: 'Rolling updates, progress deadlines and undo',
  priority: 'P0',
  mins: 12,
  prereqs: ['les-workloads', 'les-probes'],
  summary: 'Do maxSurge and maxUnavailable arithmetic, explain why a stalled rollout does not roll itself back, know exactly what rollout undo restores, and explain why a successful rollout does not prove the release is correct.',
  sections: [
    {
      h: 'What starts a rollout',
      body: 'Only a change to the Deployment\'s pod template (`spec.template`) creates a new revision: a new image, a changed env var, a new label or annotation inside the template. Changing `replicas` just scales. `kubectl rollout restart` works by writing a timestamp annotation into the template, which is a template change. Each revision is a ReplicaSet; the Deployment controller scales the new one up and the old one down.'
    },
    {
      h: 'maxSurge and maxUnavailable arithmetic',
      body: 'With the default RollingUpdate strategy, both default to 25%. Percentages become absolute numbers: **maxSurge rounds up, maxUnavailable rounds down**.\n\n'
        + '- replicas 10: maxSurge 25% = 2.5 → **3**; maxUnavailable 25% = 2.5 → **2**. During the rollout there are at most 13 pods in total and at least 8 available.\n- replicas 4, maxSurge 1, maxUnavailable 0: create one new pod, wait until it is Ready (and `minReadySeconds` has passed), remove one old pod, repeat. Capacity never drops below 4, but you need room for one extra pod.\n- maxSurge 0 and maxUnavailable 0 together is invalid, because nothing could ever move.\n\n'
        + 'Operational consequence: with `maxUnavailable: 0` and no spare capacity (or a namespace quota at its limit), the surge pod stays Pending and the rollout stalls while the old pods keep serving. The `Recreate` strategy deletes all old pods first, which means downtime but no version overlap.'
    },
    {
      h: 'Progress deadline: a stall is reported, not reverted',
      body: '`progressDeadlineSeconds` (600 by default) is how long the controller waits for progress, meaning a new ReplicaSet scaling up or new pods becoming available. When the deadline passes, the Deployment gets the condition `Progressing=False` with reason `ProgressDeadlineExceeded`.\n\n'
        + 'The controller does **not** roll back automatically. It records the condition and leaves everything as it is; old pods that were still serving keep serving. Automation such as a CI pipeline typically watches `kubectl rollout status`, which exits non-zero on the deadline, and decides whether to undo.\n\n'
        + 'Common causes: image pull failures (a missing tag, registry authorization, an image missing from a mirror), crash loops, readiness that never passes, and insufficient capacity or quota.\n\n'
        + '- `kubectl rollout status deploy/web --timeout=5m`\n- `kubectl get deploy web -o jsonpath=\'{.status.conditions}\'`\n- `kubectl get rs -l app=web` (the new ReplicaSet with fewer ready pods than desired)'
    },
    {
      h: 'History and undo: what is and is not restored',
      body: '`kubectl rollout history deploy/web` lists revisions; `--revision=3` shows that revision\'s pod template. `kubectl rollout undo deploy/web` (optionally `--to-revision=N`) copies an older ReplicaSet\'s pod template back into the Deployment. That creates a new revision number; it does not rewind history.\n\n'
        + 'Undo restores **only the pod template**. It does not restore:\n\n'
        + '- the contents of ConfigMaps or Secrets referenced by name (edit a ConfigMap in place and undo will not revert it),\n- `replicas`, strategy, or other Deployment fields outside the template,\n- Services, Ingress, PVCs and the data on them, CRDs,\n- database schema migrations or any external state.\n\n'
        + '`revisionHistoryLimit` (10 by default) bounds how far back you can go. The CHANGE-CAUSE column comes from the `kubernetes.io/change-cause` annotation; the old `--record` flag is deprecated, so set it yourself: `kubectl annotate deploy/web kubernetes.io/change-cause="image 1.4.2"`. If a GitOps controller manages the Deployment, a manual undo is reverted to what the source says: roll back by reverting the source instead.\n\n'
        + 'A useful pattern is versioned config names (`app-config-v7`) referenced from the template, so a config change is also a template change and undo brings the old reference back.'
    },
    {
      h: 'A successful rollout is not a correct release',
      body: '"Successfully rolled out" means the new pods passed their readiness probes and the old ones were scaled down. It says nothing about whether responses are correct, data is right, latency is acceptable, or a dependency is quietly failing. Verify with the signals users feel: error rates, latency, business checks and synthetic requests. For risky changes, roll out gradually (a canary, or `kubectl rollout pause` after the first batch) and decide based on those signals, not only on readiness.'
    }
  ],
  diagram: '',
  diagramCaption: '',
  keyPoints: [
    'Only pod-template changes create a new revision (ReplicaSet); scaling does not.',
    'maxSurge rounds up and maxUnavailable rounds down: 10 replicas at 25%/25% gives at most 13 pods and at least 8 available.',
    'ProgressDeadlineExceeded marks the Deployment as not progressing; there is no automatic rollback.',
    'rollout undo restores the pod template only, not ConfigMap contents, replicas, Services, data or schema.',
    'A successful rollout proves readiness, not correctness; verify with user-facing signals.'
  ],
  misconceptions: [
    'Kubernetes rolls back a failed Deployment automatically → it reports ProgressDeadlineExceeded; something else must decide to undo.',
    'rollout undo restores the previous configuration → it restores the previous pod template, not in-place ConfigMap edits or external state.',
    'rolled out successfully means the release works → it means new pods passed readiness probes.',
    'A stalled rollout means an outage → with maxUnavailable limits, old pods usually keep serving while the new ones fail.'
  ],
  aws: {
    analogy: 'ECS rolling deployments with minimumHealthyPercent and maximumPercent; the deployment circuit breaker; CodeDeploy for canaries.',
    breaks: 'minimumHealthyPercent and maximumPercent map roughly to maxUnavailable and maxSurge, but the ECS circuit breaker can roll back automatically when enabled; a Deployment\'s progress deadline only reports. Kubernetes revisions are ReplicaSets, and undo copies a pod template rather than redeploying a registered task definition revision.'
  },
  check: [
    {
      q: 'replicas 8, maxSurge 25%, maxUnavailable 25%. Maximum pods and minimum available?',
      a: 'maxSurge 2 and maxUnavailable 2: at most 10 pods, at least 6 available.'
    },
    {
      q: 'A rollout hits ProgressDeadlineExceeded. What does the controller do next?',
      a: 'Nothing more: it sets Progressing=False and leaves the state. Old pods keep serving; a human or pipeline must fix forward or undo.'
    },
    {
      q: 'You edited a ConfigMap in place, then ran rollout undo. Is the old config back?',
      a: 'No. Undo restores the pod template; the ConfigMap content stays as edited.'
    }
  ],
  questions: ['ons-q-trouble-04', 'ons-q-trouble-05', 'ons-q-delivery-07', 'ons-q-delivery-03'],
  labs: ['ons-lab-02'],
  refs: [
    {
      t: 'Deployments (rolling update, progress deadline, rollback)',
      u: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/'
    }
  ],
  verify: 'Defaults: progressDeadlineSeconds 600, revisionHistoryLimit 10, maxSurge/maxUnavailable 25% (confirmed on the Deployments page for current docs; confirm for your cluster version).'
},
{
  id: 'les-config',
  track: 'onsite',
  title: 'ConfigMaps and Secrets',
  priority: 'P1',
  mins: 12,
  prereqs: ['les-pod-lifecycle'],
  summary: 'Explain how pods consume ConfigMaps and Secrets, why base64 is not protection, where encryption at rest is actually configured, how updates reach env vars versus mounted files, and what a missing key looks like.',
  sections: [
    {
      h: 'Two objects with the same shape',
      body: 'ConfigMaps and Secrets are namespaced key-value objects. A pod consumes them as environment variables (`env` with `configMapKeyRef` or `secretKeyRef`, or `envFrom` for all keys), as files in a mounted volume, or by reading them from the API itself. Both are limited in size (about 1 MiB), so they are for configuration, not data.\n\n'
        + 'Use a ConfigMap for non-sensitive settings and a Secret for credentials, keys and certificates. The difference is not that Secrets are magically safe; it is that they are handled differently: you can grant RBAC on them separately, the kubelet keeps Secret volumes in memory-backed storage (tmpfs) on the node, and the API server can be configured to encrypt them at rest.'
    },
    {
      h: 'Base64 is encoding, not encryption',
      body: 'The values under `data:` in a Secret are base64 so that binary content fits in YAML and JSON. Anyone who can read the object can decode it:\n\n'
        + '- `kubectl get secret db -o jsonpath=\'{.data.password}\' | base64 -d`\n\n'
        + 'What actually protects Secrets:\n\n'
        + '- **RBAC**: restrict `get`, `list` and `watch` on secrets. Note that anyone who can create pods in a namespace can mount any Secret in that namespace into a pod and read it, so pod-creation rights are effectively secret-read rights.\n- **Encryption at rest**: configured on the API server with an `EncryptionConfiguration` (providers such as aescbc, aesgcm, secretbox, or a KMS plugin). Without it, Secrets are stored in etcd unencrypted, and etcd backups contain them too. Managed clusters may enable this by default; check your platform instead of assuming.\n- **TLS** between components, and restricted access to etcd and its backups.\n- Optionally an **external secret store**, delivered through a CSI driver or a syncing controller, so the source of truth lives outside the cluster.'
    },
    {
      h: 'Env vars versus mounted files: update semantics',
      body: '- **Environment variables** are resolved once, when the container starts. Changing the ConfigMap or Secret changes nothing in running containers; they see the new value only after the container is restarted (in practice, a new pod).\n- **Mounted volumes** are updated by the kubelet **eventually**: the delay can be the kubelet sync period plus its cache delay, often up to a minute or more. The application must notice and re-read the file; many do not.\n- **subPath mounts never receive updates.**\n- An `immutable: true` ConfigMap or Secret cannot be changed at all; you create a new one. This protects against accidental edits and reduces API server load.\n\n'
        + 'A safe change pattern: create a new, versioned ConfigMap (`app-config-v8`) and point the pod template at it. That is a template change, so it triggers a normal rollout with readiness gating, and rollout undo points back at `v7`. An alternative is a checksum of the config in a template annotation, which also forces a rollout on change.'
    },
    {
      h: 'When a reference is missing',
      body: 'If a container references a ConfigMap or Secret key through `configMapKeyRef` or `secretKeyRef`, and the object or key does not exist (and the reference is not marked `optional: true`), the kubelet cannot build the container\'s environment. The container is never created: its state is Waiting with reason **`CreateContainerConfigError`**, and `kubectl describe pod` shows an event such as `Error: couldn\'t find key DB_HOST in ConfigMap app/app-config` (wording varies). There are no logs, because the process never ran.\n\n'
        + 'A missing ConfigMap used as a volume looks different: the pod stays in `ContainerCreating` with `FailedMount` events.\n\n'
        + 'Contrast both with an app that starts, reads a wrong value, and exits 1: that is CrashLoopBackOff with a useful message in `kubectl logs --previous`. Which failure you see tells you whether the problem is a missing reference or a bad value.'
    },
    {
      h: 'Observing',
      body: '- `kubectl get configmap app-config -o yaml`: the keys that actually exist.\n- `kubectl describe secret db`: key names and sizes, not values.\n- `kubectl exec <pod> -- cat /etc/app/config.yaml`: what the mounted file currently contains.\n- `kubectl exec <pod> -- printenv DB_HOST`: what the running process got at start. Avoid dumping all env vars in shared terminals; they may contain secrets.\n- `kubectl auth can-i get secrets -n app --as=system:serviceaccount:app:web`: whether a workload identity can read Secrets.'
    }
  ],
  diagram: '',
  diagramCaption: '',
  keyPoints: [
    'Base64 in Secrets is encoding; protection comes from RBAC, encryption at rest (API server configuration), TLS and etcd access control.',
    'Pod-creation rights in a namespace effectively grant the ability to read its Secrets.',
    'Env vars are fixed at container start; mounted files update eventually; subPath mounts never update.',
    'A missing referenced key gives CreateContainerConfigError and no logs; a bad value usually gives a crash with logs.',
    'Roll config changes through versioned names or checksum annotations so they get rollouts and undo.'
  ],
  misconceptions: [
    'Secrets are encrypted because they are base64 → base64 is reversible encoding; encryption at rest is separate API-server configuration.',
    'Updating a ConfigMap updates the app → env vars need a restart; mounted files update eventually and only if the app re-reads them; subPath never updates.',
    'CreateContainerConfigError means the app has a config bug → it means a referenced ConfigMap/Secret or key is missing and the container never started.',
    'Only users with get on secrets can read them → anyone who can create pods in the namespace can mount them.'
  ],
  aws: {
    analogy: 'SSM Parameter Store and Secrets Manager referenced from an ECS task definition, with KMS encryption.',
    breaks: 'Secrets Manager values are encrypted with KMS by design; Kubernetes Secrets are only encrypted at rest if the API server is configured to do so. ECS injects secret values at task start (like env vars) and has no equivalent of eventually-updated mounted files.'
  },
  check: [
    {
      q: 'Is a Secret in etcd encrypted by default?',
      a: 'Not necessarily. Encryption at rest must be configured on the API server; base64 is only encoding. Check your platform.'
    },
    {
      q: 'You update a ConfigMap used as env vars. When does the app see it?',
      a: 'Only when the container restarts, in practice after a new rollout.'
    },
    {
      q: 'A new pod is stuck with CreateContainerConfigError. Where is the evidence?',
      a: 'kubectl describe pod events naming the missing ConfigMap or Secret key; there are no container logs.'
    }
  ],
  questions: ['ons-q-config-03', 'ons-q-config-05', 'ons-q-trouble-06'],
  labs: ['ons-lab-06'],
  refs: [
    {
      t: 'ConfigMaps',
      u: 'https://kubernetes.io/docs/concepts/configuration/configmap/'
    },
    {
      t: 'Secrets',
      u: 'https://kubernetes.io/docs/concepts/configuration/secret/'
    },
    {
      t: 'Encrypting confidential data at rest',
      u: 'https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/'
    }
  ],
  verify: 'Mounted ConfigMap/Secret update delay depends on kubelet sync period and cache settings; the exact CreateContainerConfigError message varies by version.'
},
{
  id: 'les-storage',
  track: 'onsite',
  title: 'Persistent storage: PVs, PVCs and StorageClasses',
  priority: 'P1',
  mins: 14,
  prereqs: ['les-scheduling'],
  summary: 'Explain how a pod gets durable storage through a claim, how dynamic provisioning and binding modes work, what access modes and reclaim policies mean, and how to diagnose a Pending claim or a mount failure.',
  sections: [
    {
      h: 'Who asks, what exists, and how it is made',
      body: '- A **PersistentVolumeClaim (PVC)** is a request: size, access modes and a storage class. It is namespaced and belongs to the application.\n- A **PersistentVolume (PV)** is the cluster-scoped representation of an actual piece of storage: a cloud disk, an NFS export, a LUN.\n- A **StorageClass** describes how to create volumes on demand: which provisioner, with what parameters, what reclaim policy, what binding mode, and whether expansion is allowed.\n\n'
        + 'A pod references a PVC by name. A PVC binds one-to-one to a PV. The provisioner is usually a CSI driver, which is environment-specific: the same manifest may work on one platform and stay Pending on another because the class or its driver does not exist there.'
    },
    {
      h: 'Dynamic provisioning and binding modes',
      body: 'When a PVC names a StorageClass (or the cluster has a default class), the provisioner creates a backend volume and a PV, and the PVC binds to it. The class\'s `volumeBindingMode` decides **when**:\n\n'
        + '- **Immediate**: provision and bind as soon as the PVC is created. In a multi-zone cluster, the volume can land in a zone where the pod cannot be scheduled, which later shows up as a "volume node affinity conflict".\n- **WaitForFirstConsumer**: wait until a pod using the PVC is scheduled, then provision in that node\'s topology (zone). With this mode a PVC stays **Pending until a pod uses it, and that is normal**; the event says it is waiting for the first consumer.\n\n'
        + '- `kubectl get storageclass`: the default class is marked `(default)`; the columns show provisioner, reclaim policy and binding mode.'
    },
    {
      h: 'Access modes and reclaim policy',
      body: '- **ReadWriteOnce (RWO)**: read-write by a single **node** (several pods on that node can mount it).\n- **ReadOnlyMany (ROX)** and **ReadWriteMany (RWX)**: many nodes; RWX needs a storage system that supports shared access, usually a network filesystem.\n- **ReadWriteOncePod (RWOP)**: a single pod, in recent versions.\n\n'
        + 'Access modes describe what the volume type supports; asking for RWX on a block-disk class typically never binds. The **reclaim policy** decides what happens when the PVC is deleted: **Delete** (the default for most dynamically provisioned classes) deletes the PV and the backend data; **Retain** keeps the PV in `Released` state with its data for manual recovery. Under Delete, deleting a PVC is deleting data.'
    },
    {
      h: 'StatefulSets and storage',
      body: 'A StatefulSet\'s `volumeClaimTemplates` create one PVC per replica: `data-db-0`, `data-db-1`. Pod `db-0` always reattaches `data-db-0`, even when it is recreated on another node. Scaling down does not delete those PVCs by default (a retention policy can change that, depending on version), so scaling back up finds the old data.\n\n'
        + 'Failure behaviour matters here: an RWO volume is attached to one node, so a replacement pod on another node may wait for the volume to detach from the old node, which can take minutes. And a StatefulSet does not create a replacement for a pod on an unreachable node until the old pod is confirmed gone, to avoid two pods with the same identity writing to the same data. Force-deleting that pod removes the safety check.\n\n'
        + 'A volume snapshot is not the same as an application-consistent backup: for databases, coordinate with the application or use its own backup tooling.'
    },
    {
      h: 'Diagnosing a Pending PVC or a mount failure',
      body: '- `kubectl get pvc`: STATUS Pending → `kubectl describe pvc <name>` and read the events:\n- the StorageClass does not exist, or there is no default class and none was named;\n- the provisioner is missing or failing (no events from it at all is a clue that its controller is not running);\n- WaitForFirstConsumer with no pod yet (normal);\n- no static PV matches the size, access mode or class;\n- a quota on storage requests.\n- A pod stuck in `ContainerCreating` with `FailedAttachVolume` or `FailedMount` events means the claim is bound but attaching or mounting fails: a multi-attach error (RWO volume still attached to another node), a zone mismatch, the CSI node plugin not running on that node, or filesystem permissions.\n- `kubectl get pv`, `kubectl get volumeattachments` and the CSI driver\'s controller and node pod logs complete the picture.'
    }
  ],
  diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 610 300" role="img" aria-label="Storage: a pod references PVC data, which binds one to one to a PersistentVolume representing a backend volume. The PVC names a StorageClass whose provisioner creates the volume and the PV. Binding mode is Immediate or WaitForFirstConsumer." font-family="inherit" font-size="12"><rect x="10" y="30" width="110" height="54" rx="6" style="fill:var(--bg-elev);stroke:var(--blue);stroke-width:1.5"/><text x="65" y="53.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">pod</text><text x="65" y="68.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">claimName: data</text><rect x="150" y="30" width="130" height="54" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="215" y="46" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">PVC data</text><text x="215" y="61" font-size="11" text-anchor="middle" style="fill:var(--muted)">10Gi, RWO</text><text x="215" y="76" font-size="11" text-anchor="middle" style="fill:var(--muted)">namespaced</text><rect x="310" y="30" width="130" height="54" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="375" y="53.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">PV pvc-8f2e</text><text x="375" y="68.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">cluster-scoped</text><rect x="470" y="30" width="130" height="54" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="535" y="53.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">backend volume</text><text x="535" y="68.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">disk, share, LUN</text><rect x="150" y="140" width="130" height="54" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="215" y="163.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">StorageClass</text><text x="215" y="178.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">provisioner, params</text><rect x="310" y="140" width="130" height="54" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="375" y="163.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">provisioner</text><text x="375" y="178.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">often a CSI driver</text><line x1="120" y1="57" x2="144" y2="57" style="stroke:var(--blue);stroke-width:1.5"/><polygon points="150,57 142,53 142,61" style="fill:var(--blue)"/><line x1="286" y1="57" x2="304" y2="57" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="310,57 302,53 302,61" style="fill:var(--accent)"/><polygon points="280,57 288,61 288,53" style="fill:var(--accent)"/><text x="295" y="24" font-size="11" text-anchor="middle" style="fill:var(--muted)">binds 1:1</text><line x1="440" y1="57" x2="464" y2="57" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="470,57 462,53 462,61" style="fill:var(--muted)"/><line x1="215" y1="84" x2="215" y2="134" style="stroke:var(--muted);stroke-width:1.5;stroke-dasharray:5 4"/><polygon points="215,140 219,132 211,132" style="fill:var(--muted)"/><text x="222" y="116" font-size="11" text-anchor="start" style="fill:var(--muted)">storageClassName</text><line x1="280" y1="167" x2="304" y2="167" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="310,167 302,163 302,171" style="fill:var(--muted)"/><line x1="375" y1="140" x2="375" y2="90" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="375,84 371,92 379,92" style="fill:var(--accent)"/><text x="382" y="116" font-size="11" text-anchor="start" style="fill:var(--muted)">creates PV</text><polyline points="440,167 535,167 535,90" style="fill:none;stroke:var(--muted);stroke-width:1.5"/><polygon points="535,84 531,92 539,92" style="fill:var(--muted)"/><text x="542" y="128" font-size="11" text-anchor="start" style="fill:var(--muted)">creates</text><text x="542" y="142" font-size="11" text-anchor="start" style="fill:var(--muted)">volume</text><text x="10" y="230" font-size="12" text-anchor="start" font-weight="600" style="fill:var(--text)">volumeBindingMode</text><rect x="10" y="242" width="290" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--amber);stroke-width:1.5"/><text x="155" y="263.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">Immediate</text><text x="155" y="278.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">provision + bind when the PVC is created</text><rect x="310" y="242" width="290" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="455" y="263.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">WaitForFirstConsumer</text><text x="455" y="278.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">wait for pod scheduling, use its zone</text></svg>',
  diagramCaption: 'A pod references a PVC, which binds one-to-one to a PV; the PVC\'s StorageClass names a provisioner that creates the backend volume and the PV, and the binding mode decides when.',
  keyPoints: [
    'PVC = namespaced request; PV = cluster-scoped actual storage; StorageClass = how to provision it.',
    'WaitForFirstConsumer delays binding until a pod is scheduled, so a Pending PVC without a pod is normal.',
    'RWO means one node, not one pod; RWX needs a storage system that supports it.',
    'Reclaim policy Delete means deleting the PVC deletes the data.',
    'StatefulSets give each replica its own PVC and wait for confirmed deletion before replacing a pod on a lost node.'
  ],
  misconceptions: [
    'A Pending PVC is always an error → with WaitForFirstConsumer it waits for a pod by design.',
    'RWO means only one pod can use the volume → it means one node; ReadWriteOncePod is the single-pod mode.',
    'Deleting a PVC is safe because the data lives on the disk → under the Delete reclaim policy the backend volume is deleted too.',
    'A snapshot is a backup → a crash-consistent snapshot may not be application-consistent, and it may live in the same failure domain.'
  ],
  aws: {
    analogy: 'EBS volumes (RWO, zonal) and EFS (shared, multi-AZ) attached to EC2 or ECS tasks; DeleteOnTermination on EBS.',
    breaks: 'In Kubernetes the claim, the volume and the class are separate API objects bound by controllers, and a CSI driver does the provisioning. Zonal placement interacts with the scheduler through binding modes, and StatefulSet identity ties a specific claim to a specific pod name.'
  },
  check: [
    {
      q: 'A PVC is Pending and describe says it is waiting for the first consumer. Problem?',
      a: 'No. The class uses WaitForFirstConsumer; it binds once a pod using it is scheduled.'
    },
    {
      q: 'A pod on a new node shows a multi-attach error for its RWO volume. Why?',
      a: 'The volume is still attached to the previous node; it must detach before it can attach elsewhere.'
    },
    {
      q: 'What happens to data when you delete a PVC whose PV has reclaimPolicy Delete?',
      a: 'The PV and the backend volume are deleted; the data is gone unless backed up.'
    }
  ],
  questions: ['ons-q-config-01', 'ons-q-config-06', 'ons-q-config-07', 'ons-q-design-04'],
  labs: ['ons-lab-08'],
  refs: [
    {
      t: 'Persistent Volumes',
      u: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/'
    },
    {
      t: 'Storage Classes',
      u: 'https://kubernetes.io/docs/concepts/storage/storage-classes/'
    },
    {
      t: 'StatefulSets',
      u: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/'
    }
  ],
  verify: 'StatefulSet persistentVolumeClaimRetentionPolicy availability and ReadWriteOncePod (stable since v1.29) depend on cluster version.'
},
{
  id: 'les-identity',
  track: 'onsite',
  title: 'ServiceAccounts, RBAC and cloud IAM',
  priority: 'P1',
  mins: 14,
  prereqs: ['les-reconcile'],
  summary: 'Explain how a workload gets an identity, how RBAC authorizes its Kubernetes API calls, how workload identity federation lets the same identity reach cloud APIs under cloud IAM, and where the ECS task role and IAM comparisons break.',
  sections: [
    {
      h: 'Who is calling?',
      body: 'Kubernetes authenticates every API request. Humans are authenticated by something external (client certificates, an OIDC provider, or a cloud IAM mapping); there is no User object in the API. Workloads use **ServiceAccounts**: namespaced API objects. Every namespace has a `default` ServiceAccount, and a pod runs as the one named in `spec.serviceAccountName`.\n\n'
        + 'A ServiceAccount\'s identity appears as the username `system:serviceaccount:<namespace>:<name>`, with the groups `system:serviceaccounts` and `system:serviceaccounts:<namespace>`. You will see exactly this string in Forbidden errors and audit logs.'
    },
    {
      h: 'ServiceAccount tokens',
      body: 'In current versions, the kubelet mounts a **projected token** into the pod, obtained through the TokenRequest API. It is:\n\n'
        + '- **time-limited**: it expires, and the kubelet refreshes the file before expiry, so clients must re-read it rather than cache it forever;\n- **audience-bound**: it is valid only for the audience it was issued for (by default the API server);\n- **bound to the pod**: it stops being valid when the pod is deleted.\n\n'
        + 'Older clusters (before v1.24) automatically created long-lived Secret-based tokens that never expire. You can still create those manually; avoid it where you can. Set `automountServiceAccountToken: false` for pods that never call the Kubernetes API, so there is no credential to steal.'
    },
    {
      h: 'RBAC: additive allow rules',
      body: '- A **Role** (namespaced) or **ClusterRole** (cluster-wide, or a reusable template) lists rules: API groups, resources (including subresources such as `pods/log` and `pods/exec`) and verbs (`get`, `list`, `watch`, `create`, `update`, `patch`, `delete`).\n- A **RoleBinding** grants a Role or ClusterRole to subjects within one namespace; a **ClusterRoleBinding** grants cluster-wide.\n- Permissions are **purely additive**. There are no deny rules: if no binding allows a request, it is denied. You remove access by removing or narrowing bindings.\n\n'
        + 'Read a denial literally: `pods is forbidden: User "system:serviceaccount:app:web" cannot list resource "pods" in API group "" in the namespace "prod"` names who, which verb, which resource, which API group and which namespace. Then test and find the grant:\n\n'
        + '- `kubectl auth can-i list pods -n prod --as=system:serviceaccount:app:web`\n- `kubectl auth can-i --list -n prod --as=system:serviceaccount:app:web`\n- `kubectl get rolebindings,clusterrolebindings -A -o wide | grep web`\n\n'
        + 'Treat some permissions as high risk: reading Secrets, creating pods (which can mount any Secret or ServiceAccount in the namespace), `escalate`, `bind`, `impersonate`, and wildcards.'
    },
    {
      h: 'Reaching cloud APIs: workload identity federation',
      body: 'RBAC authorizes only Kubernetes API requests. When the pod calls object storage, a key-management service or a queue, the **cloud\'s IAM** decides. Avoid putting long-lived cloud keys in Secrets; use federation instead:\n\n'
        + '- The cluster\'s ServiceAccount token issuer is registered with the cloud IAM as a trusted OIDC identity provider (issuer URL plus its public signing keys).\n- The pod receives a projected token whose audience is the cloud\'s token service.\n- The cloud SDK exchanges that token for short-lived cloud credentials for a role whose trust policy names this issuer and this ServiceAccount (namespace and name).\n- The cloud IAM policy on that role then authorizes each call, including any explicit denies.\n\n'
        + 'Providers implement this differently (for example, EKS offers more than one mechanism), but the chain is the same: Kubernetes identity → trusted token exchange → cloud role → IAM policy. In isolated partitions, the cloud\'s token service must be able to validate the issuer (reachable discovery documents or uploaded keys), clocks must be correct, and each partition has its own IAM.'
    },
    {
      h: 'Comparing with ECS task roles and IAM',
      body: 'The closest AWS picture is an ECS task role: the task receives credentials for an IAM role, and IAM policy decides. Federation to a cloud role is the Kubernetes equivalent for cloud APIs. RBAC has no ECS equivalent, because ECS\'s own control plane is authorized by IAM itself.\n\n'
        + 'Where it breaks: IAM has **explicit Deny** that overrides any Allow, conditions, permission boundaries and organization-level guardrails. RBAC has **only allows**, almost no conditions (resource names are about it), and no deny. "Must never" rules in Kubernetes are enforced elsewhere, for example with an admission policy. When troubleshooting, the error tells you the layer: `Forbidden` from the Kubernetes API is RBAC; an access-denied error from a cloud API is IAM, the role\'s trust policy, or the token\'s audience.'
    }
  ],
  diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 306" role="img" aria-label="Identity: a pod runs as a ServiceAccount. One projected token, with the API server as audience, is authorized by Kubernetes RBAC for the Kubernetes API. Another token, with the cloud as audience, is exchanged through workload identity federation and authorized by cloud IAM for cloud APIs." font-family="inherit" font-size="12"><text x="205" y="22" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--muted)">identity</text><text x="395" y="22" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--muted)">authorization</text><text x="560" y="22" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--muted)">target</text><rect x="10" y="110" width="100" height="64" rx="6" style="fill:var(--bg-elev);stroke:var(--blue);stroke-width:1.5"/><text x="60" y="131" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">pod</text><text x="60" y="146" font-size="11" text-anchor="middle" style="fill:var(--muted)">serviceAccount:</text><text x="60" y="161" font-size="11" text-anchor="middle" style="fill:var(--muted)">app</text><rect x="130" y="36" width="150" height="64" rx="6" style="fill:var(--bg-elev);stroke:var(--blue);stroke-width:1.5"/><text x="205" y="57" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">SA token</text><text x="205" y="72" font-size="11" text-anchor="middle" style="fill:var(--muted)">audience: API server</text><text x="205" y="87" font-size="11" text-anchor="middle" style="fill:var(--muted)">short-lived</text><rect x="310" y="36" width="170" height="64" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="395" y="57" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">Kubernetes RBAC</text><text x="395" y="72" font-size="11" text-anchor="middle" style="fill:var(--muted)">Role + RoleBinding</text><text x="395" y="87" font-size="11" text-anchor="middle" style="fill:var(--muted)">allow only, additive</text><rect x="510" y="42" width="100" height="52" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="560" y="64.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">Kubernetes</text><text x="560" y="79.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">API</text><rect x="130" y="184" width="150" height="64" rx="6" style="fill:var(--bg-elev);stroke:var(--blue);stroke-width:1.5"/><text x="205" y="205" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">SA token</text><text x="205" y="220" font-size="11" text-anchor="middle" style="fill:var(--muted)">audience: cloud STS</text><text x="205" y="235" font-size="11" text-anchor="middle" style="fill:var(--muted)">short-lived</text><rect x="310" y="184" width="170" height="64" rx="6" style="fill:var(--bg-elev);stroke:var(--amber);stroke-width:1.5"/><text x="395" y="205" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">federation + cloud IAM</text><text x="395" y="220" font-size="11" text-anchor="middle" style="fill:var(--muted)">token swapped for role</text><text x="395" y="235" font-size="11" text-anchor="middle" style="fill:var(--muted)">allow + explicit deny</text><rect x="510" y="190" width="100" height="52" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="560" y="212.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">cloud APIs</text><text x="560" y="227.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">storage, KMS</text><line x1="110" y1="130" x2="128.2" y2="73.7" style="stroke:var(--blue);stroke-width:1.5"/><polygon points="130,68 123.7,74.4 131.4,76.8" style="fill:var(--blue)"/><line x1="110" y1="156" x2="128.1" y2="210.3" style="stroke:var(--blue);stroke-width:1.5"/><polygon points="130,216 131.3,207.1 123.7,209.7" style="fill:var(--blue)"/><line x1="280" y1="68" x2="304" y2="68" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="310,68 302,64 302,72" style="fill:var(--muted)"/><line x1="480" y1="68" x2="504" y2="68" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="510,68 502,64 502,72" style="fill:var(--muted)"/><line x1="280" y1="216" x2="304" y2="216" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="310,216 302,212 302,220" style="fill:var(--muted)"/><line x1="480" y1="216" x2="504" y2="216" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="510,216 502,212 502,220" style="fill:var(--muted)"/><text x="10" y="280" font-size="11" text-anchor="start" style="fill:var(--muted)">One pod identity, two separate authorizers: RBAC decides Kubernetes API calls;</text><text x="10" y="296" font-size="11" text-anchor="start" style="fill:var(--muted)">the cloud’s IAM decides cloud API calls, after trusting the cluster’s token issuer.</text></svg>',
  diagramCaption: 'One pod identity feeds two separate authorizers: an API-server-audience token checked by Kubernetes RBAC, and a cloud-audience token exchanged through federation and checked by cloud IAM.',
  keyPoints: [
    'Workloads authenticate as ServiceAccounts: system:serviceaccount:<ns>:<name>.',
    'Projected tokens are time-limited, audience-bound and bound to the pod; legacy Secret tokens never expire.',
    'RBAC is additive allow-only: no deny rules; remove access by removing bindings.',
    'RBAC governs the Kubernetes API; cloud IAM governs cloud APIs, reached through workload identity federation.',
    'IAM has explicit deny and conditions; RBAC has neither, so guardrails live in admission policy.'
  ],
  misconceptions: [
    'RBAC can deny a specific action for one user → RBAC only allows; there is no deny rule.',
    'A ServiceAccount with the right Role can read a cloud bucket → RBAC does not reach cloud APIs; cloud IAM decides after federation.',
    'ServiceAccount tokens are permanent secrets → projected tokens are short-lived and rotated; long-lived tokens are a legacy, manual option.',
    'Kubernetes RBAC and IAM are equivalent → IAM has explicit deny, conditions and boundaries; RBAC is additive allow-only.'
  ],
  aws: {
    analogy: 'An ECS task role (credentials for the task) evaluated by IAM policies.',
    breaks: 'IAM supports explicit Deny, conditions and permission boundaries; RBAC is additive allow-only with no deny. RBAC authorizes the Kubernetes API, which has no ECS counterpart; cloud access needs a separate federation step to a cloud role.'
  },
  check: [
    {
      q: 'What exact username does a pod using ServiceAccount web in namespace app present?',
      a: 'system:serviceaccount:app:web'
    },
    {
      q: 'How do you take away one permission a ServiceAccount has through a broad ClusterRole?',
      a: 'Change or remove the binding (or bind a narrower role). RBAC has no deny rule to add.'
    },
    {
      q: 'A pod gets AccessDenied from the cloud storage API. Is RBAC the place to look?',
      a: 'No. Check the cloud role\'s IAM policy, its trust policy (issuer, namespace, ServiceAccount, audience) and the token exchange.'
    }
  ],
  questions: ['ons-q-config-02', 'ons-q-config-04', 'ons-q-config-08'],
  labs: ['ons-lab-09'],
  refs: [
    {
      t: 'Service accounts',
      u: 'https://kubernetes.io/docs/concepts/security/service-accounts/'
    },
    {
      t: 'Using RBAC authorization',
      u: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/'
    },
    {
      t: 'RBAC good practices',
      u: 'https://kubernetes.io/docs/concepts/security/rbac-good-practices/'
    }
  ],
  verify: 'Projected token default lifetime and rotation timing depend on version and API server/kubelet configuration; the v1.24 cut-over for auto-created Secret tokens is per the Service accounts page.'
},
{
  id: 'les-operators',
  track: 'onsite',
  title: 'CustomResourceDefinitions, controllers and operators',
  priority: 'P1',
  mins: 12,
  prereqs: ['les-reconcile', 'les-workloads'],
  summary: 'Explain what a CRD adds to the API, why a controller is where the behaviour lives, what makes an operator more than a Deployment, and what to watch when you run operators in production.',
  sections: [
    {
      h: 'Extending the API with a CRD',
      body: 'A **CustomResourceDefinition** registers a new resource type with the API server: a group, versions, a kind, and a schema used for validation. Afterwards `kubectl get databases` works, RBAC applies to the new resource, objects are stored in etcd, and anything can watch them.\n\n'
        + 'A CRD on its own does nothing. It is a new table in the API, not new behaviour. If you create a `Database` object and no controller is watching that type, the object just sits there.'
    },
    {
      h: 'The controller is the behaviour',
      body: 'A custom controller watches the custom resources (and the objects it creates for them) and runs the same level-triggered loop as built-in controllers: read the desired spec, observe what exists (child objects, and often the real system, such as the database\'s replication status), act, then write `status` with conditions and `observedGeneration`.\n\n'
        + 'It usually runs as a Deployment in the cluster, with its own ServiceAccount and RBAC to manage its children. It sets ownerReferences on the children so they are garbage-collected with the custom resource, and it often uses **finalizers** to do cleanup before deletion completes (for example a final backup, or removing an external resource). A finalizer whose controller is broken leaves the object stuck in Terminating.'
    },
    {
      h: 'What makes it an operator',
      body: 'An operator is custom resources plus a controller that encodes operational knowledge of one specific application. For a replicated database, that knowledge might include:\n\n'
        + '- creating a StatefulSet, Services for primary and replicas, credentials in Secrets, and a backup CronJob, all configured correctly for this database;\n- performing upgrades in a safe order (replicas first, then a controlled primary switchover);\n- detecting a failed primary and promoting a replica;\n- scaling with rebalancing, rotating certificates, restoring from backup.\n\n'
        + 'A Deployment knows none of this. It keeps N identical pods of a template and replaces them; it has no idea which pod is primary, what replication lag is, or that a schema upgrade must happen before a version change. Operators build on the built-in objects rather than replacing them.'
    },
    {
      h: 'Operators, templating tools and GitOps are different layers',
      body: 'These get blurred in conversation, so keep them apart:\n\n'
        + '- **A templating or packaging tool** (for example Helm) renders manifests and applies them when you run it. It does not keep watching afterwards.\n- **A GitOps controller** continuously reconciles Kubernetes objects from a configured source, such as a Git repository or an OCI artifact, so the cluster matches what the source says. It knows nothing about the application inside those objects, and it does not pull container images: the kubelet and container runtime do that.\n- **An operator** continuously reconciles one application\'s custom resources into objects and actions, using knowledge of that application.\n\n'
        + 'They compose: a GitOps controller applies a `Database` custom resource from Git, and the operator turns it into a running, backed-up database. When something goes wrong, ask which layer made the last change.'
    },
    {
      h: 'Running operators in production',
      body: '- **An operator is privileged automation.** It can create and delete everything it owns, so a bug or a bad spec change is amplified automatically. Review its RBAC and scope (one namespace or cluster-wide).\n- **If the operator is down,** the workloads it created keep running, but nothing heals, upgrades, fails over or takes backups, and the custom resource\'s status goes stale. Monitor the operator itself, not only the application.\n- **Versioning:** CRD schema versions, stored versions and conversion must be upgraded compatibly with the operator; upgrade the operator deliberately, like any other critical component.\n- **Disconnected environments:** mirror the operator image and every operand image it deploys (which may be named in its configuration, not in your manifests), and disable or redirect anything that calls out, such as update checks or catalog downloads.\n\n'
        + 'Observe it through the API like anything else:\n\n'
        + '- `kubectl get crd` and `kubectl explain database.spec` (if the schema is published)\n- `kubectl get database db1 -o yaml`: spec, status conditions, observedGeneration\n- `kubectl get statefulset,svc,cronjob -n <ns>` and their ownerReferences\n- `kubectl logs deploy/<operator> -n <operator-ns>` and events on the custom resource'
    }
  ],
  diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 610 290" role="img" aria-label="Operator pattern: a CRD defines a Database type; you create a custom resource; the operator controller watches it through the API server, compares desired and actual state, and creates or updates a StatefulSet, Services, Secrets and a backup CronJob, then writes status." font-family="inherit" font-size="12"><rect x="10" y="116" width="140" height="78" rx="6" style="fill:var(--bg-elev);stroke:var(--blue);stroke-width:1.5"/><text x="80" y="136.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">custom resource</text><text x="80" y="151.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">kind: Database</text><text x="80" y="166.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">replicas: 3</text><text x="80" y="181.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">backup: daily</text><rect x="175" y="26" width="110" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="230" y="47.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">CRD</text><text x="230" y="62.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">defines the type</text><rect x="175" y="125" width="110" height="60" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="230" y="144" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">API server</text><text x="230" y="159" font-size="11" text-anchor="middle" style="fill:var(--muted)">stores CR</text><text x="230" y="174" font-size="11" text-anchor="middle" style="fill:var(--muted)">and children</text><rect x="310" y="105" width="140" height="100" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="380" y="136.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">operator</text><text x="380" y="151.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">watch CR + children</text><text x="380" y="166.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">diff desired vs actual</text><text x="380" y="181.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">act, write status</text><line x1="150" y1="155" x2="169" y2="155" style="stroke:var(--blue);stroke-width:1.5"/><polygon points="175,155 167,151 167,159" style="fill:var(--blue)"/><line x1="230" y1="76" x2="230" y2="119" style="stroke:var(--muted);stroke-width:1.5;stroke-dasharray:5 4"/><polygon points="230,125 234,117 226,117" style="fill:var(--muted)"/><line x1="291" y1="155" x2="304" y2="155" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="310,155 302,151 302,159" style="fill:var(--muted)"/><polygon points="285,155 293,159 293,151" style="fill:var(--muted)"/><rect x="490" y="20" width="115" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="547.5" y="41.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">StatefulSet</text><text x="547.5" y="56.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">pods + PVCs</text><line x1="450" y1="155" x2="487.9" y2="50.6" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="490,45 483.5,51.2 491,53.9" style="fill:var(--accent)"/><rect x="490" y="86" width="115" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="547.5" y="107.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">Services</text><text x="547.5" y="122.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">primary, replicas</text><line x1="450" y1="155" x2="486" y2="115.4" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="490,111 481.7,114.2 487.6,119.6" style="fill:var(--accent)"/><rect x="490" y="152" width="115" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="547.5" y="173.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">Secrets</text><text x="547.5" y="188.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">credentials</text><line x1="450" y1="155" x2="484.7" y2="174.1" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="490,177 484.9,169.6 481.1,176.6" style="fill:var(--accent)"/><rect x="490" y="218" width="115" height="50" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="547.5" y="239.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">CronJob</text><text x="547.5" y="254.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">backups</text><line x1="450" y1="155" x2="487.5" y2="237.5" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="490,243 490.3,234.1 483,237.4" style="fill:var(--accent)"/><text x="10" y="250" font-size="11" text-anchor="start" style="fill:var(--muted)">Domain logic (failover order, upgrades,</text><text x="10" y="265" font-size="11" text-anchor="start" style="fill:var(--muted)">backups) lives in the controller; the</text><text x="10" y="280" font-size="11" text-anchor="start" style="fill:var(--muted)">CRD only defines the schema.</text><text x="310" y="230" font-size="11" text-anchor="start" style="fill:var(--muted)">owns children:</text><text x="310" y="245" font-size="11" text-anchor="start" style="fill:var(--muted)">garbage-collected</text><text x="310" y="260" font-size="11" text-anchor="start" style="fill:var(--muted)">with the CR</text></svg>',
  diagramCaption: 'A CRD defines the Database type; the operator watches Database objects through the API server, reconciles them into a StatefulSet, Services, Secrets and a backup CronJob it owns, and writes status.',
  keyPoints: [
    'A CRD adds a resource type to the API; by itself it has no behaviour.',
    'The controller watches custom resources and reconciles them with the same observe, diff, act loop.',
    'Operator = custom resources + a controller encoding application-specific operational knowledge.',
    'Operators build on StatefulSets, Services, Secrets and Jobs; they do not replace them.',
    'If the operator is down, workloads keep running but nothing heals, upgrades or backs up.'
  ],
  misconceptions: [
    'An operator is another word for Deployment → an operator is custom resources plus a controller with domain logic; a Deployment only keeps N identical pods.',
    'Installing a CRD installs the feature → a CRD only defines the type; a controller must implement it.',
    'An operator outage takes down the application → the application keeps running; automation and self-healing stop.'
  ],
  aws: {
    analogy: 'A managed service control plane (for example RDS handling backups and failover), or a CloudFormation custom resource backed by a Lambda.',
    breaks: 'RDS automation runs in the provider\'s control plane; an operator runs in your cluster and you operate it. A CloudFormation custom resource runs once per stack operation, while an operator reconciles continuously.'
  },
  check: [
    {
      q: 'You apply a CRD and a custom resource, and nothing happens. Why?',
      a: 'No controller is watching that type; the CRD only defines the schema.'
    },
    {
      q: 'What does an operator for a database do that a Deployment cannot?',
      a: 'Encode application knowledge: primary and replica roles, ordered upgrades, failover, backups and restores, configuration specific to the database.'
    },
    {
      q: 'The operator pod crash-loops. What still works?',
      a: 'The existing StatefulSet, pods and Services keep running; reconciliation, failover, upgrades and scheduled logic it drives stop, and status goes stale.'
    }
  ],
  questions: ['ons-q-arch-06', 'ons-q-delivery-06', 'ons-q-design-04'],
  labs: [],
  refs: [
    {
      t: 'Operator pattern',
      u: 'https://kubernetes.io/docs/concepts/extend-kubernetes/operator/'
    },
    {
      t: 'Custom resources',
      u: 'https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/'
    },
    {
      t: 'Controllers',
      u: 'https://kubernetes.io/docs/concepts/architecture/controller/'
    }
  ],
  verify: ''
},
{
  id: 'les-failure',
  track: 'onsite',
  title: 'What fails when: containers, pods, nodes, control plane',
  priority: 'P0',
  mins: 14,
  prereqs: ['les-reconcile', 'les-pod-lifecycle'],
  summary: 'For each of container crash, pod deletion, node loss and control-plane outage, say which component detects it, what it does, roughly how long it takes by default, and what users and operators see.',
  sections: [
    {
      h: 'Container crash',
      body: 'The process exits. The **kubelet** notices and restarts the container in place per restartPolicy, with back-off. Same pod name, same node, same pod IP; `restartCount` increments. Pod-scoped state such as an `emptyDir` volume survives a container restart. While the container is down, the pod is not Ready and is out of Service endpoints. The scheduler and controllers are not involved.\n\n'
        + 'Evidence: RESTARTS, `lastState.terminated` (exit code and reason), `kubectl logs --previous`, events.'
    },
    {
      h: 'Pod deletion or eviction',
      body: 'The pod object goes away for good. Graceful termination: the deletion timestamp is set, the pod is marked terminating in EndpointSlices so new traffic stops, the `preStop` hook runs, the container gets SIGTERM, and after the grace period (30 seconds by default) SIGKILL. Endpoint removal and SIGTERM happen roughly at the same time, not in strict order, which is why well-behaved apps keep serving briefly after SIGTERM and why some teams add a short `preStop` sleep.\n\n'
        + 'The **owning controller** then creates a new pod: new name, new UID, new IP, scheduled from scratch, possibly on another node; `emptyDir` contents are gone. A bare pod is not replaced. PodDisruptionBudgets limit voluntary evictions such as a node drain; they do not stop direct deletions or crashes.'
    },
    {
      h: 'Node loss',
      body: 'A node crashes or is partitioned. Its kubelet stops renewing its Lease and posting status. After a grace period (tens of seconds by default, configurable), the **node lifecycle controller** sets the node\'s Ready condition to Unknown and taints it `node.kubernetes.io/unreachable` (or `not-ready`) with effect NoExecute. Pods on it are typically marked not Ready, so they drop out of Service endpoints.\n\n'
        + 'Pods get default tolerations for those taints with `tolerationSeconds: 300`, added by an admission plugin unless the pod sets its own. So, by default, about five minutes later the pods are evicted (marked for deletion) and their controllers create replacements on healthy nodes. Total recovery time is detection + toleration + scheduling + image pull + readiness, which can easily be six minutes or more.\n\n'
        + 'Special cases:\n\n'
        + '- **StatefulSet** pods are not replaced until the old pod is confirmed deleted (the kubelet confirms, the node object is removed, or someone force-deletes). This preserves at-most-one pod per identity. Force-deleting while the node might still be running risks two writers.\n- **RWO volumes** may remain attached to the lost node and delay the replacement.\n- **DaemonSet** pods are not moved; they belong to that node.\n\n'
        + 'Meanwhile the API may still show the old pods as Running or Terminating, because nobody can confirm their real state.\n\n'
        + '- `kubectl get nodes`, `kubectl describe node <n>` (conditions, taints)\n- `kubectl get pods -A -o wide --field-selector spec.nodeName=<n>`\n- `kubectl get lease -n kube-node-lease`'
    },
    {
      h: 'Control-plane outage',
      body: 'The API server is down, or etcd has lost quorum. What keeps working:\n\n'
        + '- Running containers keep running. The kubelet keeps restarting crashed containers locally, since it already has the pod specs.\n- Existing Service routing keeps working with its last-programmed rules; cluster DNS typically keeps answering for names it already knows.\n\n'
        + 'What stops:\n\n'
        + '- `kubectl`, new deployments, scaling, config changes.\n- Scheduling, so no new pods and no replacements for pods on failed nodes.\n- Endpoint updates, so pods that die are not removed from routing and new pods are not added.\n- Controllers and operators: no self-healing across nodes, no failover, no autoscaling.\n- New ServiceAccount tokens; workloads that call the API eventually fail as tokens expire.\n\n'
        + 'A related partial outage: an admission webhook with `failurePolicy: Fail` whose backend is down blocks creation of the resources it covers, which looks like a control-plane outage for those resources only. Design implications: multiple API server replicas, an odd-sized etcd cluster (3 or 5), tested etcd backups and restores, and alerting on control-plane health separate from workload health.'
    },
    {
      h: 'Answering these questions well',
      body: 'For any "what happens when" question, structure the answer as: who detects it, what it does, the default timing (hedged, since it is configurable), what users see, and the evidence you would check.\n\n'
        + '- Container crash: kubelet, seconds plus back-off, same pod.\n- Pod deletion: controllers, seconds, new pod elsewhere.\n- Node loss: node lifecycle controller, about five minutes by default before eviction, new pods; StatefulSets wait for confirmation.\n- Control plane down: running work continues, nothing changes or heals.'
    }
  ],
  diagram: '',
  diagramCaption: '',
  keyPoints: [
    'Container crash: the kubelet restarts it in the same pod; nothing else is involved.',
    'Pod deletion: graceful termination, then the owning controller creates a new pod elsewhere.',
    'Node loss: NotReady, NoExecute taints, default tolerationSeconds 300, then eviction and replacement; StatefulSets wait for confirmed deletion.',
    'Control-plane outage: running workloads keep running; no scheduling, scaling, endpoint updates or cross-node self-healing.',
    'Answer with detector, action, timing, user impact and evidence.'
  ],
  misconceptions: [
    'Pods on a failed node are replaced immediately → by default there is detection time plus about five minutes of toleration before eviction.',
    'If the control plane goes down, all applications go down → running containers keep serving; changes and cross-node healing stop.',
    'Force-deleting stuck StatefulSet pods is a safe way to speed recovery → it removes the at-most-one guarantee and can cause two writers.',
    'A crashed container means a new pod → the kubelet restarts the container in the same pod.'
  ],
  aws: {
    analogy: 'ECS replacing tasks when an instance fails health checks; an Auto Scaling group replacing instances; an ECS control-plane event.',
    breaks: 'The ECS control plane is AWS-operated; in many Kubernetes setups you operate the control plane and etcd yourself. Kubernetes waits a configurable toleration period before evicting pods from an unreachable node, and StatefulSets deliberately wait for confirmation.'
  },
  check: [
    {
      q: 'A node loses power. Roughly how long until its Deployment pods run elsewhere, with defaults?',
      a: 'Detection (tens of seconds) plus the 300-second default toleration, plus scheduling, image pull and readiness: typically over five minutes.'
    },
    {
      q: 'The API server is down for ten minutes. Does a crashed container restart?',
      a: 'Yes. The kubelet restarts it locally from the pod spec it already has.'
    },
    {
      q: 'Why does a StatefulSet pod on an unreachable node not get replaced?',
      a: 'The controller will not create a second pod with the same identity until the old one is confirmed deleted, to avoid two writers.'
    }
  ],
  questions: ['ons-q-arch-03', 'ons-q-arch-04', 'ons-q-arch-05', 'ons-q-design-01'],
  labs: ['ons-lab-01', 'ons-lab-06'],
  refs: [
    {
      t: 'Nodes (heartbeats, node controller)',
      u: 'https://kubernetes.io/docs/concepts/architecture/nodes/'
    },
    {
      t: 'Taints and tolerations (taint-based evictions)',
      u: 'https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/'
    },
    {
      t: 'Pod lifecycle (termination)',
      u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/'
    }
  ],
  verify: 'Node monitor grace period and the default tolerationSeconds of 300 for not-ready/unreachable are configurable and version-dependent; the pod termination grace period default is 30s.'
},
{
  id: 'les-disconnected',
  track: 'onsite',
  title: 'Disconnected delivery: mirrors, digests, signatures, trust roots',
  priority: 'P1',
  mins: 16,
  prereqs: ['les-workloads', 'les-rollouts'],
  summary: 'Explain how to get a release into an environment with no internet: inventory every dependency, mirror by digest across architectures, and separate integrity (hashes) from authenticity (signatures verified against a trust root delivered separately), while watching time and certificate expiry.',
  sections: [
    {
      h: 'Inventory every dependency first',
      body: 'In a connected cluster, many dependencies are fetched implicitly. In a disconnected environment, anything you did not bring does not exist. Build the inventory deliberately:\n\n'
        + '- **Images**: your applications, sidecars and init containers; operators and the operand images they deploy; CNI, CSI, DNS and other add-ons; the pause (sandbox) image the runtime needs; and debug images you will want during an incident.\n- **Manifests**: charts, CRDs, policies and their dependencies.\n- **Packages**: OS packages for nodes, language dependencies used at build or run time.\n- **Hidden network calls**: default registries in charts, update checks, telemetry, license servers, certificate revocation endpoints, OIDC discovery, NTP servers.\n- **Trust material**: CA bundles, signing public keys, and the procedures to rotate them.\n- **Documentation and runbooks**, which are also external until you copy them in.\n\n'
        + 'Find hidden dependencies by rendering everything and extracting image references (`helm template ... | grep image:`), then rehearsing the complete install in an environment where egress is genuinely blocked, and watching for failed pulls and DNS lookups. On a running cluster: `kubectl get pods -A -o jsonpath=\'{range .items[*]}{.spec.containers[*].image}{"\\n"}{end}\' | sort -u` (init containers need a second query).'
    },
    {
      h: 'Mirrors, digests and architectures',
      body: 'Inside the enclave you run a **local mirror**: a registry plus package and chart repositories. Clusters are configured to pull from it, either through runtime mirror configuration or by rewriting image references to the mirror\'s hostname.\n\n'
        + '- **Reference images by digest.** A tag is a mutable pointer; `registry.local/app@sha256:...` names exact content. Pinning by digest means what you verified is exactly what runs, and a re-pushed tag cannot change it.\n- **Carry every architecture you need.** A tag often points to an index (manifest list) with one manifest per platform. Copying only the platform of the machine doing the copy breaks arm64 edge nodes with `no matching manifest for linux/arm64` or `exec format error`. Copy the whole index, or the platforms you deliberately support, preserving digests; copy tools exist for this (for example skopeo or crane).\n- **Keep the previous release in the mirror.** Rollback needs the old images to still be there.\n\n'
        + 'A missing image shows up as `ErrImagePull` or `ImagePullBackOff`, with events such as "not found" (missing from the mirror) or an i/o timeout (something is still pointing at a public registry).'
    },
    {
      h: 'Hashes, signatures and trust roots',
      body: 'These are three different things, and interviews probe whether you keep them apart.\n\n'
        + '- **A hash (SHA-256)** proves integrity: these bytes match an expected value. It is only as trustworthy as the channel that gave you the expected value. An attacker who can swap the artifact can usually swap the checksum file next to it. **A hash does not authenticate the publisher.**\n- **A signature** is made over the artifact (or its digest) with a private key and verified with the corresponding public key or identity. It proves that the holder of that key signed exactly these bytes.\n- **A trust root** is the set of keys or identities you have decided to trust, and for what. It must be **distributed separately and in advance**, through a channel the attacker does not control: installed at provisioning, pinned in configuration, delivered through a key ceremony. A signature verified against a key that arrived inside the same bundle proves nothing.\n\n'
        + 'Beyond that: plan key rotation and revocation for an environment that cannot fetch updates; attach SBOMs and provenance attestations so you know what is inside; and enforce verification at admission (an admission controller that verifies signatures) as well as at import, so an unverified image cannot run even if it reaches the mirror. Some signing schemes rely on online transparency logs; for offline verification, choose key-based verification or carry the verification material with you.'
    },
    {
      h: 'A bundle pipeline end to end',
      body: '- **Build** with pinned dependencies (reproducibly where possible), then scan.\n- **Sign** images and artifacts; the private key never leaves the connected, controlled side.\n- **Assemble a bundle**: images by digest for all needed architectures, manifests and charts, signatures, SBOMs, checksums, and a release manifest listing everything that should be present.\n- **Controlled transfer** across the boundary, through the approved path.\n- **Verify on the receiving side**: signatures against the pre-installed trust root, checksums, and completeness against the release manifest. A missing image should fail here, not halfway through a deployment.\n- **Import** into the local mirror, **deploy** with digest references pointing at the mirror, and **verify** the deployment with real checks.\n\n'
        + 'Treat the verification step as a hard gate, and record what was verified, by whom and against which key.'
    },
    {
      h: 'Time, certificates and expiry',
      body: 'Isolated environments drift. Provide an internal NTP source: clock skew breaks TLS validation, token lifetimes (ServiceAccount and OIDC tokens), signature timestamp checks and certificate validity windows. Certificates expire without the public reminders you get elsewhere: cluster component certificates (for example, kubeadm-based clusters default to one-year component certificates), kubelet certificates, internal CAs and application certificates. Keep an inventory of expiry dates, alert well ahead, and make sure the renewal procedure works entirely offline, with its own tools and images already in place.'
    },
    {
      h: 'Simulated versus real disconnection',
      body: 'A lab that deletes an image from a list, or points at an unreachable registry, simulates one failure. It does not prove isolation. Real isolation means no route and no DNS for public destinations, and it surfaces surprises: a chart\'s default registry, telemetry, node OS updates, an add-on that downloads something at install time, a resolver forwarding upstream. Test with egress blocked at the network level, and verify by trying to reach the outside and failing.\n\n'
        + 'In an interview, be precise about which is which: what you practised in a local lab, and what you operated in real isolated environments. They are different kinds of evidence.'
    }
  ],
  diagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 402" role="img" aria-label="Disconnected delivery: on the connected side, build, sign and assemble a bundle of images by digest, manifests, signatures, SBOMs and a release manifest. After controlled transfer, the receiving side verifies signatures against a trust root installed earlier through a separate channel, imports to a local mirror, and the cluster pulls from the mirror by digest." font-family="inherit" font-size="12"><rect x="8" y="8" width="604" height="146" rx="8" style="fill:none;stroke:var(--blue);stroke-width:1.2;stroke-dasharray:6 5"/><text x="20" y="28" font-size="12" text-anchor="start" font-weight="600" style="fill:var(--blue)">connected side</text><rect x="20" y="50" width="100" height="56" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="70" y="74.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">build</text><text x="70" y="89.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">pinned deps</text><rect x="140" y="50" width="120" height="56" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="200" y="67" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">sign</text><text x="200" y="82" font-size="11" text-anchor="middle" style="fill:var(--muted)">private key</text><text x="200" y="97" font-size="11" text-anchor="middle" style="fill:var(--muted)">stays here</text><rect x="282" y="36" width="318" height="108" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="441" y="64" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">bundle</text><text x="441" y="79" font-size="11" text-anchor="middle" style="fill:var(--muted)">images by digest (all needed arches)</text><text x="441" y="94" font-size="11" text-anchor="middle" style="fill:var(--muted)">manifests, charts, CRDs</text><text x="441" y="109" font-size="11" text-anchor="middle" style="fill:var(--muted)">signatures + SBOM + checksums</text><text x="441" y="124" font-size="11" text-anchor="middle" style="fill:var(--muted)">release manifest listing all</text><line x1="120" y1="78" x2="134" y2="78" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="140,78 132,74 132,82" style="fill:var(--muted)"/><line x1="260" y1="78" x2="276" y2="78" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="282,78 274,74 274,82" style="fill:var(--muted)"/><line x1="8" y1="176" x2="612" y2="176" style="stroke:var(--red);stroke-width:1.5;stroke-dasharray:8 5"/><text x="20" y="170" font-size="11" text-anchor="start" style="fill:var(--red)">boundary</text><line x1="500" y1="144" x2="500" y2="216" style="stroke:var(--accent);stroke-width:2"/><polygon points="500,222 504,214 496,214" style="fill:var(--accent)"/><text x="492" y="194" font-size="11" text-anchor="end" font-weight="600" style="fill:var(--accent)">controlled transfer</text><rect x="8" y="198" width="604" height="196" rx="8" style="fill:none;stroke:var(--amber);stroke-width:1.2;stroke-dasharray:6 5"/><text x="20" y="218" font-size="12" text-anchor="start" font-weight="600" style="fill:var(--amber)">disconnected side</text><rect x="390" y="222" width="210" height="62" rx="6" style="fill:var(--bg-elev);stroke:var(--accent);stroke-width:1.5"/><text x="495" y="242" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">verify</text><text x="495" y="257" font-size="11" text-anchor="middle" style="fill:var(--muted)">signatures vs trusted key</text><text x="495" y="272" font-size="11" text-anchor="middle" style="fill:var(--muted)">checksums, completeness</text><rect x="205" y="222" width="160" height="62" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="285" y="249.5" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">local mirror</text><text x="285" y="264.5" font-size="11" text-anchor="middle" style="fill:var(--muted)">registry + repos</text><rect x="20" y="222" width="160" height="62" rx="6" style="fill:var(--bg-elev);stroke:var(--line);stroke-width:1.5"/><text x="100" y="242" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">cluster</text><text x="100" y="257" font-size="11" text-anchor="middle" style="fill:var(--muted)">pulls from mirror</text><text x="100" y="272" font-size="11" text-anchor="middle" style="fill:var(--muted)">by digest</text><line x1="390" y1="253" x2="371" y2="253" style="stroke:var(--accent);stroke-width:1.5"/><polygon points="365,253 373,257 373,249" style="fill:var(--accent)"/><text x="378" y="300" font-size="11" text-anchor="middle" style="fill:var(--muted)">import</text><line x1="205" y1="253" x2="186" y2="253" style="stroke:var(--muted);stroke-width:1.5"/><polygon points="180,253 188,257 188,249" style="fill:var(--muted)"/><rect x="390" y="320" width="210" height="60" rx="6" style="fill:var(--bg-elev);stroke:var(--amber);stroke-width:1.5"/><text x="495" y="339" font-size="12" text-anchor="middle" font-weight="600" style="fill:var(--text)">trust root</text><text x="495" y="354" font-size="11" text-anchor="middle" style="fill:var(--muted)">public key / identity</text><text x="495" y="369" font-size="11" text-anchor="middle" style="fill:var(--muted)">installed earlier, separately</text><line x1="495" y1="320" x2="495" y2="290" style="stroke:var(--amber);stroke-width:1.5;stroke-dasharray:5 4"/><polygon points="495,284 491,292 499,292" style="fill:var(--amber)"/><text x="20" y="330" font-size="11" text-anchor="start" style="fill:var(--muted)">A key shipped inside the bundle</text><text x="20" y="345" font-size="11" text-anchor="start" style="fill:var(--muted)">cannot vouch for the bundle.</text><text x="20" y="370" font-size="11" text-anchor="start" style="fill:var(--muted)">Also bring: NTP source, CA bundles,</text><text x="20" y="385" font-size="11" text-anchor="start" style="fill:var(--muted)">debug images, previous release.</text></svg>',
  diagramCaption: 'Build, sign and bundle on the connected side; after controlled transfer, verify against a trust root installed earlier through a separate channel, import to the local mirror, and let the cluster pull by digest.',
  keyPoints: [
    'Inventory everything: images (including operands, add-ons, pause and debug images), manifests, packages, hidden network calls, trust material.',
    'Reference images by digest and mirror every architecture you run; keep the previous release for rollback.',
    'A hash proves integrity against a value you already trust; it does not authenticate the publisher.',
    'A signature needs a trust root distributed separately and in advance; a key inside the bundle vouches for nothing.',
    'Provide time and plan certificate renewal offline; simulated disconnection is not proof of real isolation.'
  ],
  misconceptions: [
    'A SHA-256 checksum proves the artifact came from us → it proves the bytes match a value; authenticity needs a signature verified against a separately trusted key.',
    'A valid signature is enough → only if the verifying key or identity is one you trusted beforehand through a separate channel.',
    'Pulling by tag from the mirror is fine → tags are mutable; digests pin exactly what you verified.',
    'A lab with a missing image proves the release works disconnected → it simulates one failure; real isolation needs network-level egress blocking.'
  ],
  aws: {
    analogy: 'ECR replication and pull-through caches, signed artifacts verified against a known key, and isolated-partition region builds where every dependency must already exist locally.',
    breaks: 'In a cloud region the provider operates the registry, time sources and certificate infrastructure; in a disconnected Kubernetes environment you supply all of them, and the cluster will only run what the mirror holds.'
  },
  check: [
    {
      q: 'The bundle includes checksums and the public key used to verify its signature. What is wrong?',
      a: 'A key delivered inside the bundle cannot vouch for the bundle; the trust root must be installed in advance through a separate channel.'
    },
    {
      q: 'arm64 edge nodes fail with exec format error after import. Likely cause?',
      a: 'Only the amd64 manifest was copied instead of the multi-arch index (or the arm64 platform).'
    },
    {
      q: 'Why reference images by digest in a disconnected release?',
      a: 'Digests name exact content, so what was verified is what runs; tags can be moved.'
    }
  ],
  questions: ['ons-q-delivery-01', 'ons-q-delivery-02', 'ons-q-delivery-03', 'ons-q-delivery-05', 'ons-q-delivery-08'],
  labs: ['ons-lab-10', 'ons-lab-02'],
  refs: [
    {
      t: 'Images (digests, pull policy, multi-arch)',
      u: 'https://kubernetes.io/docs/concepts/containers/images/'
    },
    {
      t: 'Verify signed Kubernetes artifacts',
      u: 'https://kubernetes.io/docs/tasks/administer-cluster/verify-signed-artifacts/'
    }
  ],
  verify: 'kubeadm default certificate lifetime (one year for component certificates) varies by version and tooling; check your distribution.'
},
{
  id: 'les-observability',
  track: 'onsite',
  title: 'Observability and dependencies: from "it is slow" to the failing hop',
  priority: 'P1',
  mins: 15,
  prereqs: ['les-request-path', 'les-failure'],
  summary: 'What to measure in a system of services and dependencies, what should page, and how to use metrics, logs and traces together to walk a symptom back along the dependency graph to the component that is actually failing.',
  sections: [
    {
      h: 'Three kinds of signal, one question each',
      body: '**Metrics** are numbers over time: cheap to keep, good for alerting and for spotting *when* and *how much*. **Logs** are events with detail: good for *what exactly happened* in one component. **Traces** follow one request across components, with a span per hop: good for *where the time or the error is*.\n\n'
        + 'They work best joined up: a request ID or trace ID in every log line, and labels (service, route, pod, node, zone, version) on metrics, so you can jump from a spike on a graph to the traces in that window to the log lines for one failing request. In Kubernetes, container logs go to stdout/stderr and are collected per node; metrics come from the kubelet and from the application; traces need instrumentation in the application and context propagated through every hop, including queue messages.'
    },
    {
      h: 'What to measure: requests and resources',
      body: 'For anything that serves requests — a route, a service, a dependency call — measure **rate, errors and duration** (often called RED). Use percentiles for duration (p95, p99), not averages: averages hide the slow tail that users notice.\n\n'
        + 'For anything that is a resource — CPU, memory, disk, connection pools, queues, node capacity — measure **utilisation, saturation and errors** (USE). Saturation is the early warning: a connection pool with requests waiting, a queue whose oldest message keeps getting older, an HPA sitting at its maximum. The "four golden signals" (latency, traffic, errors, saturation) are the same idea in one list.\n\n'
        + 'Measure each dependency **from the caller\'s side** as well: the API\'s view of the database (time to get a connection, query time, errors) often explains what the database\'s own dashboard cannot.'
    },
    {
      h: 'What should page: symptoms, SLOs and burn rate',
      body: 'Page on **symptoms users feel**, not on every cause. An SLO turns "users are happy" into a number — for example, 99.9% of order requests succeed over 30 days — and the error budget is what is left (0.1%). A **burn-rate** alert fires when the budget is being spent fast enough to matter, using a short and a long window together so it is both quick and not noisy.\n\n'
        + 'Cause-level signals — a pod restarting, high CPU on one node, a single slow query — go to dashboards or tickets unless they threaten the SLO. Treat **missing data** as its own condition: a component that stops reporting is unknown, not healthy. And put **deploy and config-change markers** on dashboards, because "what changed?" is the first question in almost every incident.'
    },
    {
      h: 'Dependencies: the critical path and how failures spread',
      body: 'Draw the dependency graph and mark the **critical path**: the dependencies a request must succeed against before the user gets an answer. Every synchronous dependency on that path multiplies down your availability; moving work to a queue takes it off the path.\n\n'
        + 'Failures spread in a few predictable ways:\n\n'
        + '- **Slow is worse than down.** A slow dependency holds threads and connections while callers wait, so the caller runs out too. Timeouts shorter than the caller\'s own deadline stop this.\n'
        + '- **Retries amplify.** Three layers each retrying three times turn one failure into 27 calls. Use a retry budget, backoff with jitter, and idempotency so retries are safe.\n'
        + '- **Scaling moves the bottleneck.** More API pods mean more connections, more calls, more load on whatever is behind them. Check every downstream limit.\n'
        + '- **Shared things fail together.** One database, one cache cluster, one zone or one bad message in an ordered queue can affect everything that depends on it.\n\n'
        + 'Circuit breakers, bulkheads (separate pools per dependency) and dead-letter queues limit how far a failure can travel.'
    },
    {
      h: 'Walking a symptom back to its cause',
      body: 'A repeatable sequence that works on most systems, and that you can say out loud in an interview:\n\n'
        + '1. **Scope it.** Which routes, which users, which zones, since when? Compare with deploys and config changes.\n'
        + '2. **Split it.** Group errors and latency by the labels you have — route, pod, node, node group, zone, version, dependency. A failure that follows one label is half solved.\n'
        + '3. **Follow the request.** Take one failing request\'s trace: which span holds the time or the error? That is the next hop to examine.\n'
        + '4. **Check that hop from both sides.** The caller\'s view (timeouts, pool waits) and the callee\'s view (its own metrics and logs). A healthy callee with an unhappy caller points at the path between them: network, limits, configuration.\n'
        + '5. **Form one hypothesis and try to disprove it** with the cheapest test — a debug pod, a query, a single canary — before changing anything.\n'
        + '6. **Contain, then fix, then verify** against the same signal that showed the problem.'
    }
  ],
  diagram: '',
  diagramCaption: '',
  keyPoints: [
    'Metrics tell you when and how much, logs tell you what, traces tell you where. Join them with request IDs and labels.',
    'Requests: rate, errors, duration (with percentiles). Resources: utilisation, saturation, errors. Saturation is the early warning.',
    'Page on SLO burn rate and user-facing symptoms; route cause-level signals to dashboards and tickets.',
    'Measure every dependency from the caller\'s side too; it often shows what the dependency\'s own dashboard cannot.',
    'A slow dependency, unbounded retries and scaling into a downstream limit are the usual ways a failure spreads.',
    'To troubleshoot: scope, split by labels, follow one request\'s trace, check the hop from both sides, then test one hypothesis.'
  ],
  misconceptions: [
    'All pods are Running and Ready, so the service is healthy → readiness says a pod can accept requests; it says nothing about whether its dependencies work or whether users are succeeding.',
    'Average latency is a good health signal → averages hide the tail; use percentiles and the SLO.',
    'More alerts mean better coverage → alerts on every cause produce noise that hides the real page; alert on symptoms and SLO burn.',
    'If a dependency\'s dashboard is green, it is not involved → the problem may be on the path to it or in its limits (connections, rate limits, firewall rules), which only the caller sees.'
  ],
  aws: {
    analogy: 'CloudWatch metrics and alarms, CloudWatch Logs, X-Ray traces; ALB target-group metrics per target; SQS ApproximateAgeOfOldestMessage; RDS DatabaseConnections.',
    breaks: 'In Kubernetes you usually assemble the pipeline yourself (for example Prometheus-style metrics, a log collector per node, OpenTelemetry-style tracing), and pod-level labels — pod, node, namespace — are what let you split a failure by placement. Pods are short-lived, so logs must be shipped off the node.'
  },
  check: [
    {
      q: 'The API\'s error rate is up, the database dashboard is green, and traces show requests waiting before any query runs. Where do you look next?',
      a: 'At the hop between them from the caller\'s side: connection pool waits and failures to open connections, the database\'s connection limit, and network paths or firewall rules. A healthy callee with an unhappy caller points at the path or the limits.'
    },
    {
      q: 'Why can a slow dependency cause a bigger outage than one that is down?',
      a: 'A down dependency fails fast; a slow one holds the caller\'s threads and connections while it waits, so the caller exhausts its own resources and fails on unrelated requests too. Timeouts and circuit breakers prevent this.'
    },
    {
      q: 'Workers are Running, Ready and busy, but the queue keeps growing. Which signals show the real problem?',
      a: 'Age of the oldest message and the acknowledgement (or completion) rate compared with the publish rate. Busy workers that acknowledge nothing are stuck, often on one message that keeps failing.'
    },
    {
      q: 'What should page a human for a customer-facing API?',
      a: 'A fast SLO burn rate on user-facing success or latency, and missing telemetry for critical components. Pod restarts and high CPU are context, not pages, unless they threaten the SLO.'
    }
  ],
  questions: ['ons-q-design-07', 'ons-q-net-04', 'ons-q-trouble-09'],
  labs: [],
  refs: [
    {
      t: 'Logging Architecture',
      u: 'https://kubernetes.io/docs/concepts/cluster-administration/logging/'
    },
    {
      t: 'Tools for Monitoring Resources',
      u: 'https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-usage-monitoring/'
    },
    {
      t: 'Traces for Kubernetes System Components',
      u: 'https://kubernetes.io/docs/concepts/cluster-administration/system-traces/'
    }
  ],
  verify: 'RED, USE and the four golden signals are widely used conventions rather than standards. Burn-rate window pairs and thresholds vary by team and SLO; the ones you choose should come from your own error budget.'
}
);
