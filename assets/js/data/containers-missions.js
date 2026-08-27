/* Containers track — typed sandbox missions against the simulated cluster.
   Objectives use the same evidence rule as the Linux ones: a command must have
   produced the output that proves it. See tests/data/test-strict.js. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.missions = LX.missions || [];

/* ═══ 1. Service with no endpoints ═══════════════════════════ */
LX.missions.push({
  id:'cn-m-svc', track:'containers', title:'Pods are healthy, the Service returns nothing',
  labId:null, cat:'svc', level:'beginner', mins:8, kind:'incident',
  cert:['cka:services-and-networking','cka:troubleshooting'],
  brief:'Checkout is down. The api Deployment shows three healthy pods and the team has already restarted it twice. Requests through the api Service time out. Find out why and fix it without redeploying anything.',
  keys:['man ', 'guide ', 'kubectl get pods', '--show-labels', 'kubectl get endpoints', 'kubectl describe svc api',
        'kubectl label pod ', 'app=api', '--overwrite', 'kubectl get svc -o jsonpath=', '-o wide'],
  world:{
    user:'ec2-user', host:'ops-jump', cwd:'/home/ec2-user',
    disks:[{ fs:'/dev/nvme0n1p1', size:30 * 1024 * 1024 * 1024, base:9 * 1024 * 1024 * 1024,
             mount:'/', inodes:1966080, iused:70112 }],
    k8s:{
      namespace:'default', context:'prod-eks',
      nodes:[{ name:'ip-10-0-3-4', status:'Ready', roles:'<none>', zone:'us-east-1a' },
             { name:'ip-10-0-4-9', status:'Ready', roles:'<none>', zone:'us-east-1b' }],
      pods:[
        { name:'api-6c8b9f-2k4mz', ns:'default', status:'Running', ready:true, restarts:0, age:'14m',
          node:'ip-10-0-3-4', ip:'10.0.3.41', labels:{ app:'api-server', tier:'backend' },
          containers:[{ name:'api', image:'myapp:2.4.1', state:'Running' }],
          log:'2026-08-27T09:02:11Z INFO  listening on 0.0.0.0:8080\n2026-08-27T09:02:11Z INFO  ready' },
        { name:'api-6c8b9f-7xq8p', ns:'default', status:'Running', ready:true, restarts:0, age:'14m',
          node:'ip-10-0-4-9', ip:'10.0.4.18', labels:{ app:'api-server', tier:'backend' },
          containers:[{ name:'api', image:'myapp:2.4.1', state:'Running' }],
          log:'2026-08-27T09:02:12Z INFO  listening on 0.0.0.0:8080\n2026-08-27T09:02:12Z INFO  ready' },
        { name:'api-6c8b9f-mn3wt', ns:'default', status:'Running', ready:true, restarts:0, age:'14m',
          node:'ip-10-0-3-4', ip:'10.0.3.55', labels:{ app:'api-server', tier:'backend' },
          containers:[{ name:'api', image:'myapp:2.4.1', state:'Running' }],
          log:'2026-08-27T09:02:11Z INFO  listening on 0.0.0.0:8080\n2026-08-27T09:02:11Z INFO  ready' }
      ],
      services:[{ name:'api', ns:'default', type:'ClusterIP', clusterIP:'10.96.4.12',
                  port:80, targetPort:8080, portStr:'80/TCP', selector:{ app:'api' }, age:'62d' }],
      deployments:[{ name:'api', ns:'default', replicas:3, selector:{ app:'api-server' }, age:'62d' }],
      events:[{ ns:'default', obj:'deployment/api', type:'Normal', reason:'ScalingReplicaSet',
                age:'14m', msg:'Scaled up replica set api-6c8b9f to 3' }]
    }
  },
  objectives:[
    { id:'pods', text:'Confirm the pods really are running and ready',
      hint:'Start by trusting nothing. List them.',
      reveal:'kubectl get pods -o wide',
      done:function (c) { return did(c, /kubectl\s+get\s+(po|pods)\b/, /Running/); } },
    { id:'endpoints', text:'Check what the Service is actually routing to',
      hint:'A Service is a selector plus a port. What has it selected?',
      hint2:'kubectl get endpoints — an empty list is the entire answer.',
      reveal:'kubectl get endpoints',
      done:function (c) { return did(c, /kubectl\s+(get\s+(ep|endpoints)|describe\s+svc)/, /Endpoints|ENDPOINTS/); } },
    { id:'selector', text:'Read the selector the Service is using',
      hint:'Describe it, or pull the selector field directly.',
      reveal:'kubectl describe svc api',
      done:function (c) { return did(c, /kubectl\s+(describe\s+svc|get\s+svc)/, /Selector|app=api/); } },
    { id:'labels', text:'Compare it against the labels the pods actually carry',
      hint:'The pods have labels too — list them.',
      hint2:'kubectl get pods --show-labels puts them side by side.',
      reveal:'kubectl get pods --show-labels',
      done:function (c) { return did(c, /kubectl\s+get\s+(po|pods)\b.*--show-labels|kubectl\s+describe\s+(po|pod)\b/, /app=api-server/); } },
    { id:'fix', text:'Make the Service select the pods — without redeploying',
      hint:'You can change a label on a running object. The pods say app=api-server; the Service wants app=api.',
      hint2:'kubectl label pod NAME app=api --overwrite — a label that already exists needs the flag.',
      reveal:'kubectl label pod api-6c8b9f-2k4mz app=api --overwrite',
      done:function (c) {
        var pods = ((c.w.k8s || {}).pods) || [];
        return pods.filter(function (p) { return (p.labels || {}).app === 'api'; }).length >= 1;
      } },
    { id:'verify', text:'Prove the Service now has endpoints behind it',
      hint:'Re-run the check that was empty.',
      reveal:'kubectl get endpoints',
      done:function (c) {
        var pods = ((c.w.k8s || {}).pods) || [];
        var fixed = pods.filter(function (p) { return (p.labels || {}).app === 'api'; }).length;
        return fixed >= 1 && c.ran.slice(-4).some(function (x) {
          return /kubectl\s+(get\s+(ep|endpoints)|describe\s+svc)/.test(x);
        });
      } }
  ],
  debrief:{
    why:['`kubectl get pods` showed three Running, Ready pods, which ruled out the application and every restart the team had already tried.',
      '`kubectl get endpoints` was empty. That single line ends the investigation: a Service with no endpoints has nothing to route to, and nothing above it — Ingress, load balancer, DNS — can compensate.',
      'The Service selector was `app=api` and the pods carried `app=api-server`. Selectors are exact string matches and there is no warning anywhere when they do not match: the Service is valid, the pods are healthy, and the endpoint list is simply empty.',
      '`kubectl label pod … --overwrite` fixed it live, because endpoints are recomputed continuously from the selector and pod readiness — no redeploy required.',
      'Re-checking endpoints proved the fix rather than assuming it.'],
    interview:'"When a Service is not routing I bisect. First port-forward straight to a pod: if that works the application is fine and everything left is routing. Then `kubectl get endpoints` — and there are exactly two reasons that list is empty, the selector not matching the pod labels or every pod failing readiness. `describe svc` shows the selector and `get pods --show-labels` shows the labels, so the comparison takes one command each. I only look at Ingress or the load balancer after endpoints are populated, because debugging those while the Service selects nothing is where people lose the first half hour."',
    prevent:['Label the pod template and the Service selector from the same source — Helm values or a Kustomize commonLabels block — so they cannot drift.',
      'Alert on a Service with zero endpoints. It is a cheap check and it catches this class of failure before a customer does.',
      'The permanent fix here is the Deployment template, not the live label: `kubectl label` is an incident action and the next rollout would undo it.']
  }
});

/* ═══ 2. CrashLoopBackOff, OOMKilled ═════════════════════════ */
LX.missions.push({
  id:'cn-m-crashloop', track:'containers', title:'CrashLoopBackOff after a routine deploy',
  cat:'k8s', level:'beginner', mins:8, kind:'incident',
  cert:['cka:troubleshooting'],
  brief:'The worker Deployment went out an hour ago and its pods will not stay up. The team says "the new version is broken" and wants to roll back. Find out what is actually happening before anyone does.',
  keys:['man ', 'guide ', 'kubectl get pods', 'kubectl logs ', '--previous', 'kubectl describe pod ',
        'kubectl top pod', '--containers', 'kubectl set resources deploy/worker', '--limits=memory=512Mi'],
  world:{
    user:'ec2-user', host:'ops-jump', cwd:'/home/ec2-user',
    disks:[{ fs:'/dev/nvme0n1p1', size:30 * 1024 * 1024 * 1024, base:9 * 1024 * 1024 * 1024,
             mount:'/', inodes:1966080, iused:70112 }],
    k8s:{
      namespace:'default', context:'prod-eks',
      nodes:[{ name:'ip-10-0-3-4', status:'Ready', zone:'us-east-1a', topMem:'6104Mi', topMemPct:'38%' }],
      pods:[{ name:'worker-59d4c-hb2vt', ns:'default', status:'CrashLoopBackOff', ready:false,
              restarts:11, age:'58m', node:'ip-10-0-3-4', ip:'10.0.3.77',
              labels:{ app:'worker' }, needMi:400, topMem:'249Mi', topCpu:'180m',
              containers:[{ name:'worker', image:'worker:3.2.0', state:'Waiting (CrashLoopBackOff)',
                            lastState:'OOMKilled', exitCode:137, limits:'256Mi', requests:'128Mi' }],
              log:'2026-08-27T10:14:02Z INFO  worker 3.2.0 starting\n2026-08-27T10:14:03Z INFO  loading rules from /etc/worker/rules.json',
              prevLog:'2026-08-27T10:13:31Z INFO  worker 3.2.0 starting\n2026-08-27T10:13:32Z INFO  loading rules from /etc/worker/rules.json\n2026-08-27T10:13:33Z INFO  compiled 41200 rules\n2026-08-27T10:13:34Z INFO  batch 1 size=5000' }],
      deployments:[{ name:'worker', ns:'default', replicas:1, selector:{ app:'worker' }, age:'90d' }],
      events:[{ ns:'default', obj:'pod/worker-59d4c-hb2vt', type:'Warning', reason:'BackOff', age:'2m',
                msg:'Back-off restarting failed container worker in pod worker-59d4c-hb2vt' }]
    }
  },
  objectives:[
    { id:'see', text:'Confirm the state and how many times it has restarted',
      hint:'List the pods and read the RESTARTS column.',
      reveal:'kubectl get pods',
      done:function (c) { return did(c, /kubectl\s+get\s+(po|pods)\b/, /CrashLoopBackOff/); } },
    { id:'prev', text:'Read the output of the instance that died — not the one starting now',
      hint:'The container you would read by default is the replacement, and it has not failed yet.',
      hint2:'kubectl logs POD --previous',
      reveal:'kubectl logs worker-59d4c-hb2vt --previous',
      done:function (c) { return did(c, /kubectl\s+logs\b.*(--previous|\s-p\b)/, /compiled 41200 rules|batch 1/); } },
    { id:'how', text:'Establish how it died — exit code and reason',
      hint:'describe shows Last State above the events.',
      reveal:'kubectl describe pod worker-59d4c-hb2vt',
      done:function (c) { return did(c, /kubectl\s+describe\s+(po|pod)\b/, /OOMKilled|Exit Code:\s*137/); } },
    { id:'size', text:'Find out how much memory it actually needs, and what it is allowed',
      hint:'Compare live usage against the limit on the container.',
      hint2:'kubectl top pod POD --containers, and the Limits line in describe.',
      reveal:'kubectl top pod worker-59d4c-hb2vt --containers',
      done:function (c) { return did(c, /kubectl\s+top\s+(po|pod)\b/, /Mi|MEMORY/); } },
    { id:'fix', text:'Give it a limit that fits what it needs',
      hint:'The limit is 256Mi and it dies loading its rule set. Raise it on the Deployment, not the pod.',
      hint2:'kubectl set resources deploy/worker --limits=memory=512Mi',
      reveal:'kubectl set resources deploy/worker --limits=memory=512Mi',
      done:function (c) {
        var d = (((c.w.k8s || {}).deployments) || [])[0];
        return !!d && (d.memLimitMi || 0) >= 400;
      } },
    { id:'verify', text:'Prove the rollout is healthy now',
      hint:'Ask the deployment whether it finished.',
      reveal:'kubectl rollout status deploy/worker',
      done:function (c) {
        var pods = ((c.w.k8s || {}).pods) || [];
        return pods.every(function (p) { return p.status === 'Running'; }) &&
          c.ran.slice(-4).some(function (x) { return /kubectl\s+(rollout\s+status|get\s+(po|pods))/.test(x); });
      } }
  ],
  debrief:{
    why:['The RESTARTS column showed 11, which distinguishes a crash loop from a single failure and rules out a one-off.',
      '`kubectl logs --previous` showed the container getting as far as compiling 41,200 rules and starting a batch — so the application was working, not broken. Without `--previous` you read the replacement container and conclude the logs are empty.',
      '`describe` gave the actual cause in one line: Last State Terminated, Reason OOMKilled, Exit Code 137. That is the kernel, not the application, and 137 is 128 + 9 for SIGKILL.',
      '`kubectl top` against the container Limits showed it needed more than the 256Mi it was allowed — the new version compiles a larger rule set, so the code was fine and the budget was not.',
      'Raising the limit on the Deployment fixed it. Rolling back would also have "worked", and would have hidden a limit that was already marginal.'],
    interview:'"CrashLoopBackOff means it ran and died, so unlike Pending there is evidence. I go for `kubectl logs --previous` first, because the container I would otherwise read is the replacement. Then the exit code from describe, which is the fork: 137 with Reason OOMKilled is the memory limit and the application did nothing wrong; 1 or 2 is the app choosing to quit and its own output says why; 0 means it completed, which for a long-running service means the command is wrong. Here it was 137, so the question became whether the limit was too low or the process was leaking — usage climbing steadily to the ceiling every time is a leak, a jump at startup is an undersized limit."',
    prevent:['Set limits from observed usage plus headroom, and revisit them when a release changes what the process loads at startup.',
      'Alert on container restarts and on memory usage approaching the limit, not only on the pod being down — by the time it is down you have already dropped work.',
      'For JVM and .NET workloads, size the heap from the container limit rather than the host, or the runtime will happily plan to use memory the cgroup will never allow.']
  }
});

/* ═══ 3. Pending on a tainted node ═══════════════════════════ */
LX.missions.push({
  id:'cn-m-pending', track:'containers', title:'A pod will not schedule and nobody knows why',
  cat:'k8s', level:'intermediate', mins:8, kind:'incident',
  cert:['cka:workloads-and-scheduling','cka:troubleshooting'],
  brief:'A batch job has been Pending for twenty minutes. The cluster looks empty — plenty of CPU and memory free on both nodes — and someone has already asked whether they should scale the node group. Find the real constraint.',
  keys:['man ', 'guide ', 'kubectl get pods', 'kubectl describe pod ', 'kubectl get nodes',
        'kubectl describe node ', 'kubectl top nodes', 'kubectl taint node ', 'batch=only:NoSchedule-'],
  world:{
    user:'ec2-user', host:'ops-jump', cwd:'/home/ec2-user',
    disks:[{ fs:'/dev/nvme0n1p1', size:30 * 1024 * 1024 * 1024, base:9 * 1024 * 1024 * 1024,
             mount:'/', inodes:1966080, iused:70112 }],
    k8s:{
      namespace:'default', context:'prod-eks',
      nodes:[
        { name:'ip-10-0-3-4', status:'Ready', zone:'us-east-1a', taints:['batch=only:NoSchedule'],
          reqCpu:'400m (10%)', reqMem:'900Mi (5%)', topCpu:'180m', topCpuPct:'4%', topMem:'1102Mi', topMemPct:'6%' },
        { name:'ip-10-0-4-9', status:'Ready', zone:'us-east-1b', taints:['batch=only:NoSchedule'],
          reqCpu:'300m (7%)', reqMem:'700Mi (4%)', topCpu:'120m', topCpuPct:'3%', topMem:'880Mi', topMemPct:'5%' }
      ],
      pods:[{ name:'reindex-4t7bn', ns:'default', status:'Pending', ready:false, restarts:0, age:'21m',
              node:null, ip:null, labels:{ app:'reindex' }, blockedBy:'taint',
              containers:[{ name:'reindex', image:'tools:1.9', state:'Waiting (Pending)', requests:'256Mi' }] }],
      events:[{ ns:'default', obj:'pod/reindex-4t7bn', type:'Warning', reason:'FailedScheduling', age:'21m',
                msg:'0/2 nodes are available: 2 node(s) had untolerated taint {batch: only}. preemption: 0/2 nodes are available.' }]
    }
  },
  objectives:[
    { id:'state', text:'Confirm it is Pending rather than failing to start',
      hint:'List the pods.',
      reveal:'kubectl get pods',
      done:function (c) { return did(c, /kubectl\s+get\s+(po|pods)\b/, /Pending/); } },
    { id:'why', text:'Get the scheduler to tell you why it will not place it',
      hint:'The scheduler records its reasoning as an event on the pod.',
      hint2:'kubectl describe pod NAME — read the Events section.',
      reveal:'kubectl describe pod reindex-4t7bn',
      done:function (c) { return did(c, /kubectl\s+(describe\s+(po|pod)|get\s+ev|get\s+events)/, /FailedScheduling|untolerated taint/); } },
    { id:'capacity', text:'Rule out the theory that the cluster is full',
      hint:'Scheduling uses requests, not live usage. Check both.',
      reveal:'kubectl top nodes',
      done:function (c) { return did(c, /kubectl\s+(top\s+(no|nodes)|describe\s+(no|node))/, /%|Allocated/); } },
    { id:'taint', text:'Find what is reserving the nodes',
      hint:'A node can refuse pods that do not tolerate it.',
      hint2:'kubectl describe node NAME and read the Taints line.',
      reveal:'kubectl describe node ip-10-0-3-4',
      done:function (c) { return did(c, /kubectl\s+describe\s+(no|node)\b/, /Taints:\s*\S/); } },
    { id:'fix', text:'Let the pod schedule',
      hint:'Either the pod tolerates the taint, or the taint goes. You can only edit the cluster here.',
      hint2:'kubectl taint node NAME batch=only:NoSchedule-  — the trailing dash removes it.',
      reveal:'kubectl taint node ip-10-0-3-4 batch=only:NoSchedule-',
      done:function (c) {
        var pods = ((c.w.k8s || {}).pods) || [];
        return pods.every(function (p) { return p.status !== 'Pending'; });
      } },
    { id:'verify', text:'Confirm it was placed on a node',
      hint:'List with -o wide so you can see which node took it.',
      reveal:'kubectl get pods -o wide',
      done:function (c) {
        var pods = ((c.w.k8s || {}).pods) || [];
        return pods.every(function (p) { return p.status === 'Running'; }) &&
          c.ran.slice(-3).some(function (x) { return /kubectl\s+get\s+(po|pods)/.test(x); });
      } }
  ],
  debrief:{
    why:['Pending means the scheduler has not placed the pod — no image has been pulled and no container has run, so this was never an application problem.',
      'The FailedScheduling event said it outright: "0/2 nodes are available: 2 node(s) had untolerated taint". The scheduler always explains itself, and reading that event first turns the whole thing into a lookup.',
      '`kubectl top nodes` showed both nodes at a few percent, which killed the "scale the node group" theory before anyone spent money on it.',
      '`describe node` showed `batch=only:NoSchedule` on both — someone had reserved the cluster for batch work and never removed it.',
      'Removing the taint let the scheduler place the pod immediately. Adding a matching toleration to the pod would have been equally valid, and is the better answer if the reservation was deliberate.'],
    interview:'"Pending is the scheduler talking, so the first command is describe and the Events section, not a change. There are four causes and the event names which: requests that do not fit any node, a taint with no matching toleration, a nodeSelector or affinity that matches no node, or a zonal volume the node cannot attach. The one people get wrong is capacity, because scheduling is done on **requests** rather than live usage — a node at 5% CPU can be completely unschedulable if everything on it reserved more than it uses. `describe node` shows reservations, `top node` shows reality, and the gap between them is usually the real problem."',
    prevent:['Treat taints as deliberate configuration with an owner and an expiry, not something applied during an incident and forgotten.',
      'Give batch and production separate node groups with labels and tolerations checked into the manifests, so the reservation is expressed in code rather than by hand.',
      'Alert on pods Pending for more than a few minutes — this one sat for twenty because nothing was watching for it.']
  }
});

/* ═══ 4. image pull ══════════════════════════════════════════ */
LX.missions.push({
  id:'cn-m-imagepull', track:'containers', title:'ImagePullBackOff on a fresh deploy',
  cat:'registry', level:'beginner', mins:7, kind:'incident',
  cert:['cka:troubleshooting'],
  brief:'A release went out ten minutes ago and every new pod is stuck in ImagePullBackOff. The previous version is still serving, so this is urgent rather than an outage. Find out which of the four causes it is, and get the deploy onto an image that exists.',
  keys:['man ', 'guide ', 'kubectl get pods', 'kubectl describe pod ', 'kubectl get events',
        'kubectl set image deploy/checkout', 'checkout=', 'checkout:2.7.3', 'kubectl rollout status deploy/checkout'],
  world:{
    user:'ec2-user', host:'ops-jump', cwd:'/home/ec2-user',
    disks:[{ fs:'/dev/nvme0n1p1', size:30 * 1024 * 1024 * 1024, base:9 * 1024 * 1024 * 1024,
             mount:'/', inodes:1966080, iused:70112 }],
    files:[{ path:'/home/ec2-user/release-notes.txt',
             content:'checkout release\n  requested tag: 2.7.4\n  built by CI run #4182\n  NOTE: run #4182 failed at the push step (see CI log)\n  last good tag: 2.7.3\n' }],
    k8s:{
      namespace:'default', context:'prod-eks',
      registry:['checkout:2.7.3', 'checkout:2.7.2', 'checkout:2.7.1'],
      nodes:[{ name:'ip-10-0-3-4', status:'Ready', zone:'us-east-1a' }],
      pods:[{ name:'checkout-7f4d9-q2xlm', ns:'default', status:'ImagePullBackOff', ready:false,
              restarts:0, age:'10m', node:'ip-10-0-3-4', ip:'10.0.3.90', labels:{ app:'checkout' },
              ownedBy:'checkout',
              containers:[{ name:'checkout', image:'checkout:2.7.4', state:'Waiting (ImagePullBackOff)' }] }],
      deployments:[{ name:'checkout', ns:'default', replicas:1, selector:{ app:'checkout' }, age:'120d' }],
      events:[{ ns:'default', obj:'pod/checkout-7f4d9-q2xlm', type:'Warning', reason:'Failed', age:'2m',
                msg:'Failed to pull image "checkout:2.7.4": manifest unknown: manifest tagged by "2.7.4" is not found' }]
    }
  },
  objectives:[
    { id:'state', text:'Confirm the state',
      hint:'List the pods.',
      reveal:'kubectl get pods',
      done:function (c) { return did(c, /kubectl\s+get\s+(po|pods)\b/, /ImagePullBackOff/); } },
    { id:'reason', text:'Get the registry\'s actual error, which distinguishes all four causes',
      hint:'The kubelet passes the registry\'s message through. describe shows it.',
      hint2:'"manifest unknown" is a missing tag; "unauthorized" is credentials; "i/o timeout" is the network.',
      reveal:'kubectl describe pod checkout-7f4d9-q2xlm',
      done:function (c) { return did(c, /kubectl\s+(describe\s+(po|pod)|get\s+ev|get\s+events)/, /manifest unknown|Failed to pull/); } },
    { id:'tag', text:'Find out which tag was requested and which ones exist',
      hint:'The release notes in your home directory say what CI was asked to build — and what happened.',
      reveal:'cat release-notes.txt',
      done:function (c) { return did(c, /(cat|less|head|grep)\b.*release-notes/, /2\.7\.3|push step/); } },
    { id:'fix', text:'Point the deployment at an image that exists',
      hint:'You do not need a redeploy from CI to change the image on a Deployment.',
      hint2:'kubectl set image deploy/checkout checkout=checkout:2.7.3',
      reveal:'kubectl set image deploy/checkout checkout=checkout:2.7.3',
      done:function (c) {
        var pods = ((c.w.k8s || {}).pods) || [];
        return pods.some(function (p) {
          return (p.containers || []).some(function (x) { return x.image === 'checkout:2.7.3'; });
        });
      } },
    { id:'verify', text:'Prove the rollout completed',
      hint:'Ask the deployment, do not assume.',
      reveal:'kubectl rollout status deploy/checkout',
      done:function (c) {
        var pods = ((c.w.k8s || {}).pods) || [];
        return pods.every(function (p) { return p.status === 'Running'; }) &&
          c.ran.slice(-3).some(function (x) { return /kubectl\s+(rollout\s+status|get\s+(po|pods))/.test(x); });
      } }
  ],
  debrief:{
    why:['ImagePullBackOff means the container never ran, so nothing about the application is in question — this is entirely between the node and the registry.',
      'The describe event carried the registry\'s own words: "manifest unknown: manifest tagged by 2.7.4 is not found". That distinguishes it from the other three causes immediately — unauthorized would be credentials, i/o timeout would be the network, toomanyrequests would be a rate limit.',
      'The release notes said CI run #4182 failed at the push step. The tag was never published, so the cluster was asking for something that does not exist. The failure was in the pipeline, not in Kubernetes.',
      '`kubectl set image` moved the Deployment to the last good tag without waiting for a rebuild — the right call when the previous version is still serving and you want the fleet consistent.',
      '`rollout status` confirmed it rather than assuming; the backoff can be minutes, so a fix can look like it did nothing.'],
    interview:'"ImagePullBackOff has four causes and the kubelet tells you which, because it passes the registry error straight through. Not found means the tag or repository is wrong — usually a build that failed to push. Unauthorized means credentials: an imagePullSecret for a private registry, or the node role for ECR, where there is no secret at all. A timeout means the node cannot reach the registry, which on a private subnet is a NAT route or a missing VPC endpoint. And toomanyrequests is a Docker Hub rate limit, shared across everything behind one NAT gateway. Reading the message first is the difference between five minutes and an hour."',
    prevent:['Make CI fail loudly when the push step fails — a green build that published nothing is worse than a red one.',
      'Deploy by digest rather than by tag so the image that was tested is the image that runs, and a missing tag fails at the pipeline instead of in the cluster.',
      'Mirror external base images into your own registry with a pull-through cache, which removes both the rate limit and the dependency on someone else\'s uptime.']
  }
});

/* ═══ 5. cluster DNS ═════════════════════════════════════════ */
LX.missions.push({
  id:'cn-m-dns', track:'containers', title:'One namespace cannot resolve anything',
  cat:'dns', level:'intermediate', mins:8, kind:'incident',
  cert:['cka:services-and-networking','cka:troubleshooting'],
  brief:'Pods in the payments namespace log DNS timeouts against every name, internal and external. Everything else in the cluster is fine and CoreDNS is healthy. Work out what is different about payments.',
  keys:['man ', 'guide ', 'kubectl exec ', '-n payments', '-- nslookup', 'api.payments.svc.cluster.local',
        '-- cat /etc/resolv.conf', 'kubectl get netpol -A', 'kubectl describe netpol ', 'kubectl get pods -n kube-system'],
  world:{
    user:'ec2-user', host:'ops-jump', cwd:'/home/ec2-user',
    disks:[{ fs:'/dev/nvme0n1p1', size:30 * 1024 * 1024 * 1024, base:9 * 1024 * 1024 * 1024,
             mount:'/', inodes:1966080, iused:70112 }],
    k8s:{
      namespace:'payments', context:'prod-eks',
      dns:{ blocked:true, 'api.payments':'10.96.7.20', 'api.payments.svc.cluster.local':'10.96.7.20' },
      nodes:[{ name:'ip-10-0-3-4', status:'Ready', zone:'us-east-1a' }],
      pods:[
        { name:'ledger-8b6c4-r9wzt', ns:'payments', status:'Running', ready:true, restarts:0, age:'3h',
          node:'ip-10-0-3-4', ip:'10.0.3.61', labels:{ app:'ledger' },
          resolvConf:'nameserver 10.96.0.10\nsearch payments.svc.cluster.local svc.cluster.local cluster.local\noptions ndots:5',
          log:'2026-08-27T11:02:44Z ERROR dial tcp: lookup api.payments on 10.96.0.10:53: read udp 10.0.3.61:41022->10.96.0.10:53: i/o timeout' },
        { name:'coredns-5d78c9-4kk2n', ns:'kube-system', status:'Running', ready:true, restarts:0,
          age:'40d', node:'ip-10-0-3-4', ip:'10.0.3.12', labels:{ 'k8s-app':'kube-dns' },
          log:'[INFO] plugin/ready: Still waiting on: nothing\n[INFO] CoreDNS-1.11.1' }
      ],
      services:[{ name:'api', ns:'payments', type:'ClusterIP', clusterIP:'10.96.7.20',
                  port:80, targetPort:8080, portStr:'80/TCP', selector:{ app:'api' }, age:'40d' },
                { name:'kube-dns', ns:'kube-system', type:'ClusterIP', clusterIP:'10.96.0.10',
                  port:53, targetPort:53, portStr:'53/UDP,53/TCP', selector:{ 'k8s-app':'kube-dns' }, age:'40d' }],
      netpols:[{ name:'default-deny-egress', ns:'payments', podSelector:{},
                 policyTypes:'Egress', note:'no egress rules at all' }],
      events:[]
    }
  },
  objectives:[
    { id:'reproduce', text:'Reproduce the failure from a pod in that namespace',
      hint:'Run a lookup inside the pod that is complaining.',
      hint2:'kubectl exec -n payments POD -- nslookup api.payments.svc.cluster.local',
      reveal:'kubectl exec -n payments ledger-8b6c4-r9wzt -- nslookup api.payments.svc.cluster.local',
      done:function (c) { return did(c, /kubectl\s+exec\b.*(nslookup|dig)/, /timed out|NXDOMAIN|Address/); } },
    { id:'resolver', text:'Check the resolver the pod was actually given',
      hint:'The kubelet writes /etc/resolv.conf when the pod starts. Read it.',
      reveal:'kubectl exec -n payments ledger-8b6c4-r9wzt -- cat /etc/resolv.conf',
      done:function (c) { return did(c, /kubectl\s+exec\b.*resolv\.conf/, /nameserver/); } },
    { id:'coredns', text:'Rule out CoreDNS itself',
      hint:'It is a normal Deployment in kube-system. Is it running?',
      reveal:'kubectl get pods -n kube-system',
      done:function (c) { return did(c, /kubectl\s+get\s+(po|pods)\b.*kube-system/, /coredns|Running/); } },
    { id:'policy', text:'Find what is different about this namespace',
      hint:'Something can block traffic between a pod and the DNS service without touching either.',
      hint2:'kubectl get netpol -A — a default-deny egress policy blocks UDP 53 like anything else.',
      reveal:'kubectl get netpol -A',
      done:function (c) { return did(c, /kubectl\s+(get|describe)\s+netpol/, /default-deny|POD-SELECTOR|<none>/); } },
    { id:'name', text:'Name the cause in one line before changing anything',
      hint:'Write it down — the sandbox is happy to take a note.',
      hint2:'echo "default-deny egress in payments blocks UDP 53 to kube-dns" > cause.txt',
      reveal:'echo "default-deny egress policy in payments blocks UDP 53 to kube-dns" > cause.txt',
      done:function (c) {
        var f = c.w.fs['/home/ec2-user/cause.txt'];
        return !!f && /egress/i.test(f.content || '') && /53|dns/i.test(f.content || '');
      } }
  ],
  debrief:{
    why:['The lookup timed out rather than returning NXDOMAIN, and that distinction is the whole diagnosis: NXDOMAIN means DNS answered and the name does not exist, a timeout means nothing answered at all.',
      '/etc/resolv.conf was correct — nameserver 10.96.0.10, the right search path, ndots:5 — so the pod was configured properly and dnsPolicy was not the problem.',
      'CoreDNS was Running and Ready with clean logs, and every other namespace resolved fine, which narrowed it to something specific to payments.',
      '`kubectl get netpol -A` found a default-deny egress policy scoped to the whole namespace with no egress rules. The moment a policy selects a pod and names Egress, that pod is deny-by-default outbound — including UDP 53 to kube-dns.',
      'Nothing about this is visible from inside the pod: no error, no log, just timeouts. The policy is the only place it exists.'],
    interview:'"I test the fully qualified name first, because that separates a search-path question from a real DNS failure. Then I read the pod\'s resolv.conf, then whether CoreDNS is healthy, and only then whether something is blocking the path. The one that catches people is NetworkPolicy: a default-deny egress policy blocks port 53 exactly like any other traffic, so DNS breaks for one namespace while the cluster looks perfectly healthy. The signature is timeouts rather than NXDOMAIN — nothing answered, rather than something answering no. Whenever I write a default-deny policy, the first rule I add is DNS to kube-system."',
    prevent:['Ship the DNS egress allow rule together with any default-deny policy, as one template — they should never be applied separately.',
      'Test a default-deny policy in a non-production namespace with a pod that makes a real lookup, because the manifests apply cleanly whether or not they break you.',
      'Confirm the CNI actually enforces NetworkPolicy. On flannel these manifests apply and do nothing at all, which is a security control that silently is not there.']
  }
});
