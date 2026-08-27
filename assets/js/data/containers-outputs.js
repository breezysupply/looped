/* Containers track — what each playbook step actually prints, with the line
   that decides the next move marked. Keyed by playbook id, indexed by step. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.pbOut = LX.pbOut || {};

LX.pbOut['cn-pod-pending'] = [
  { out:'Events:\n' +
        '  Type     Reason            Age    From               Message\n' +
        '  ----     ------            ----   ----               -------\n' +
        '  Warning  FailedScheduling  4m12s  default-scheduler  0/6 nodes are available: 2 Insufficient cpu, 3 node(s) had untolerated taint {workload: batch}, 1 node(s) had volume node affinity conflict. preemption: 0/6 nodes are available: 6 Preemption is not helpful for scheduling.',
    mark:['FailedScheduling', '0/6 nodes are available', 'Insufficient cpu', 'untolerated taint', 'volume node affinity conflict'],
    note:'The scheduler tallies every node against every test and reports the counts. Here all three causes are present at once — read them as "two nodes failed on CPU, three on a taint, one on the volume" rather than as one reason. "preemption is not helpful" means evicting lower-priority pods would not free what this one needs.' },

  { out:'Allocated resources:\n' +
        '  (Total limits may be over 100 percent, i.e., overcommitted.)\n' +
        '  Resource           Requests       Limits\n' +
        '  cpu                3800m (95%)    6 (150%)\n' +
        '  memory             13Gi (86%)     20Gi (133%)\n\n' +
        '$ kubectl top nodes\n' +
        'NAME              CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%\n' +
        'ip-10-0-3-4       412m         10%    3204Mi          20%',
    mark:['3800m (95%)', '412m', '10%'],
    note:'This is the gap that misleads people. Requests reserve 95% of the CPU, so nothing more can be scheduled — while actual use is 10%. Scheduling never looks at the second number. The fix is right-sizing requests, not adding nodes, and `describe node` versus `top node` is how you tell those apart in ten seconds.' },

  { out:'Taints:             workload=batch:NoSchedule\n' +
        '                    nvidia.com/gpu=present:NoSchedule\n' +
        'Unschedulable:      false\n\n' +
        '# and on a node that is simply unwell:\n' +
        'Taints:             node.kubernetes.io/not-ready:NoExecute\n' +
        '                    node.kubernetes.io/unreachable:NoExecute',
    mark:['workload=batch:NoSchedule', 'node.kubernetes.io/not-ready:NoExecute'],
    note:'A taint is the node refusing work it was not reserved for; the pod needs a matching toleration. The `not-ready` and `unreachable` taints are applied automatically by the node controller — seeing those means the node is sick, not reserved, and this is a different tree.' },

  { out:'$ kubectl get pod reindex-4t7bn -o jsonpath=\'{.spec.nodeSelector}\'\n' +
        '{"node.kubernetes.io/instance-type":"m6i.4xlarge"}\n\n' +
        '$ kubectl get nodes --show-labels | tr \',\' \'\\n\' | grep instance-type\n' +
        'node.kubernetes.io/instance-type=m6g.2xlarge\n' +
        'node.kubernetes.io/instance-type=m6g.2xlarge',
    mark:['m6i.4xlarge', 'm6g.2xlarge'],
    note:'The pod asks for m6i and every node is m6g — a hard constraint matching nothing, so it waits forever with no further explanation. This exact shape appears when a cluster migrates to Graviton and one manifest keeps an x86 instance-type selector. A `preferredDuringScheduling` affinity would have degraded instead of blocking.' },

  { out:'NAME             READY   STATUS              RESTARTS   AGE   IP           NODE\n' +
        'reindex-4t7bn    0/1     Pending             0          21m   <none>       <none>\n' +
        'reindex-4t7bn    0/1     ContainerCreating   0          21m   <none>       ip-10-0-4-9\n' +
        'reindex-4t7bn    1/1     Running             0          21m   10.0.4.31    ip-10-0-4-9',
    mark:['Pending', 'ContainerCreating', 'Running', 'ip-10-0-4-9'],
    note:'Watch the transition rather than re-running get. The moment a node name appears the scheduling problem is solved; anything that fails after that is image pull or volume mount, which is a different tree. Falling back to Pending means the change did not address the real constraint.' }
];

LX.pbOut['cn-crashloop'] = [
  { out:'2026-08-27T10:13:31Z INFO  worker 3.2.0 starting\n' +
        '2026-08-27T10:13:32Z INFO  loading rules from /etc/worker/rules.json\n' +
        '2026-08-27T10:13:33Z INFO  compiled 41200 rules\n' +
        '2026-08-27T10:13:34Z INFO  batch 1 size=5000\n' +
        '\n# without --previous, on a pod that just restarted:\n' +
        '2026-08-27T10:14:02Z INFO  worker 3.2.0 starting',
    mark:['compiled 41200 rules', 'batch 1 size=5000'],
    note:'The previous instance got as far as compiling 41,200 rules and starting real work, then stopped mid-stream with no error — which already rules out a startup crash and points at something external ending the process. Without `--previous` you get the four seconds the replacement has been alive and conclude, wrongly, that it never starts.' },

  { out:'    State:          Waiting\n' +
        '      Reason:       CrashLoopBackOff\n' +
        '    Last State:     Terminated\n' +
        '      Reason:       OOMKilled\n' +
        '      Exit Code:    137\n' +
        '      Started:      Thu, 27 Aug 2026 10:13:30 +0000\n' +
        '      Finished:     Thu, 27 Aug 2026 10:13:35 +0000\n' +
        '    Restart Count:  11\n' +
        '    Limits:\n      memory:     256Mi\n' +
        '    Requests:\n      memory:     128Mi',
    mark:['OOMKilled', 'Exit Code:    137', 'Restart Count:  11', 'memory:     256Mi'],
    note:'`Last State` is the one that matters — `State` only says it is waiting to try again. 137 is 128 + 9, so SIGKILL, and `Reason: OOMKilled` says the memory cgroup did it. The application had no chance to log anything, which is why the logs ended mid-line. Five seconds between Started and Finished tells you it dies during startup work, not under later load.' },

  { out:'POD                    NAME     CPU(cores)   MEMORY(bytes)\n' +
        'worker-59d4c-hb2vt     worker   180m         249Mi\n\n' +
        '$ kubectl get pod worker-59d4c-hb2vt -o jsonpath=\'{.spec.containers[*].resources}\'\n' +
        '{"limits":{"memory":"256Mi"},"requests":{"memory":"128Mi"}}',
    mark:['249Mi', '"memory":"256Mi"'],
    note:'249Mi against a 256Mi ceiling — it dies within a few MB of the limit every time. Read usage against the **limit**, never against the node: this pod is killed at 256Mi on a machine with 60GB free, which is the detail that trips people coming from VMs. A steady climb to the ceiling is a leak; a jump during startup is an undersized limit.' },

  { out:'    Liveness:   http-get http://:8080/healthz delay=5s timeout=1s period=10s #success=1 #failure=3\n' +
        '    Readiness:  http-get http://:8080/ready delay=5s timeout=1s period=10s #success=1 #failure=3\n\n' +
        'Events:\n' +
        '  Warning  Unhealthy  2m (x14 over 9m)  kubelet  Liveness probe failed: Get "http://10.0.3.77:8080/healthz": context deadline exceeded\n' +
        '  Normal   Killing    2m (x4 over 9m)   kubelet  Container worker failed liveness probe, will be restarted',
    mark:['delay=5s', 'Liveness probe failed', 'will be restarted'],
    note:'A five-second initial delay against an application that needs forty produces an endless restart loop that looks exactly like a crash — the process is healthy and is being killed repeatedly. "Container failed liveness probe, will be restarted" is Kubernetes telling you plainly that it is the one doing the killing. `startupProbe` exists precisely for this.' },

  { out:'Waiting for deployment "worker" rollout to finish: 0 of 1 updated replicas are available...\n' +
        'deployment "worker" successfully rolled out\n\n' +
        '$ kubectl get pod -l app=worker\n' +
        'NAME                   READY   STATUS    RESTARTS   AGE\n' +
        'worker-6f2a8b-tq4vc    1/1     Running   0          6m',
    mark:['successfully rolled out', 'RESTARTS   AGE', 'Running   0'],
    note:'The restart counter is the honest measure — a pod can be Running and still be on its fortieth restart. Watch past the point where it previously died: a memory leak takes time to reappear, and a change that only delays the crash is easy to mistake for a fix.' }
];

LX.pbOut['cn-imagepull'] = [
  { out:'Events:\n' +
        '  Normal   Pulling  2m (x4 over 5m)   kubelet  Pulling image "checkout:2.7.4"\n' +
        '  Warning  Failed   2m (x4 over 5m)   kubelet  Failed to pull image "checkout:2.7.4": rpc error: code = NotFound desc = failed to pull and unpack image: manifest unknown\n' +
        '  Warning  Failed   2m (x4 over 5m)   kubelet  Error: ErrImagePull\n' +
        '  Normal   BackOff  30s (x9 over 5m)  kubelet  Back-off pulling image "checkout:2.7.4"\n\n' +
        '# the other three read like this:\n' +
        '  ... unauthorized: authentication required\n' +
        '  ... dial tcp 52.94.0.1:443: i/o timeout\n' +
        '  ... toomanyrequests: You have reached your pull rate limit',
    mark:['manifest unknown', 'unauthorized: authentication required', 'i/o timeout', 'toomanyrequests'],
    note:'The kubelet passes the registry\'s own error through, and the four causes are unmistakable in the text. Not found is a tag or repository problem, unauthorized is credentials, a timeout is the route out of the subnet, and a rate limit is Docker Hub counting every node behind your NAT gateway as one client.' },

  { out:'$ aws ecr describe-images --repository-name checkout \\\n' +
        '    --query "sort_by(imageDetails,&imagePushedAt)[-3:].imageTags" --output text\n' +
        '2.7.1\n2.7.2\n2.7.3\n\n' +
        '# and the manifest asked for:\n' +
        '$ kubectl get deploy checkout -o jsonpath=\'{.spec.template.spec.containers[0].image}\'\n' +
        'checkout:2.7.4',
    mark:['2.7.3', 'checkout:2.7.4'],
    note:'The registry has 2.7.3 and the cluster wants 2.7.4 — a build that never published, usually because CI went green on the test stage and failed on the push. The fault is in the pipeline, not the cluster. Check the architecture too: an arm64-only image pulled onto amd64 nodes fails with a manifest error that reads exactly like a missing tag.' },

  { out:'$ kubectl get pod checkout-7f4d9-q2xlm -o jsonpath=\'{.spec.imagePullSecrets}\'\n' +
        '[{"name":"regcred"}]\n\n' +
        '$ kubectl get secret regcred -o jsonpath=\'{.data.\\.dockerconfigjson}\' | base64 -d | head -c 120\n' +
        '{"auths":{"1234.dkr.ecr.us-east-1.amazonaws.com":{"auth":"QVdTOmV5SndZWGxzYjJG…"\n\n' +
        '# with ECR or ACR there is usually no secret at all — the node role does it:\n' +
        'Error response: User: arn:aws:sts::1234:assumed-role/eks-node/i-0ab is not authorized to perform: ecr:GetAuthorizationToken',
    mark:['regcred', 'ecr:GetAuthorizationToken'],
    note:'Two different models. A private registry uses an `imagePullSecret`, which is namespaced — a secret in the wrong namespace is simply not found. ECR and ACR authenticate through the node role or managed identity with no secret at all, so a policy change produces this symptom on a cluster where nothing else moved.' },

  { out:'$ curl -sSv https://1234.dkr.ecr.us-east-1.amazonaws.com/v2/ 2>&1 | tail -6\n' +
        '* Connected to 1234.dkr.ecr.us-east-1.amazonaws.com (52.94.0.1) port 443\n' +
        '< HTTP/1.1 401 Unauthorized\n' +
        '< www-authenticate: Basic realm="https://ecr.us-east-1.amazonaws.com/"\n\n' +
        '# versus a node with no route out:\n' +
        '* connect to 52.94.0.1 port 443 failed: Connection timed out',
    mark:['401 Unauthorized', 'Connection timed out'],
    note:'A 401 here is a *good* result: the network path works and only auth is missing. A timeout means the node cannot get there, which on a private subnet is a missing NAT route or a missing VPC endpoint. Pulling from ECR privately needs three endpoints — ecr.api, ecr.dkr and S3 — and missing the S3 one produces a pull that authenticates and then stalls on the layers.' },

  { out:'$ kubectl delete pod checkout-7f4d9-q2xlm\npod "checkout-7f4d9-q2xlm" deleted\n\n' +
        '$ kubectl get pods -w\n' +
        'checkout-7f4d9-w4k2p   0/1   ContainerCreating   0   2s\n' +
        'checkout-7f4d9-w4k2p   1/1   Running             0   8s',
    mark:['ContainerCreating', 'Running'],
    note:'The pull backs off exponentially, so after a fix the pod can sit there for minutes still looking broken. Deleting it forces an immediate retry and tells you within seconds. If it fails again, re-read the message — fixing one of several problems changes the error rather than clearing it.' }
];

LX.pbOut['cn-svc-noendpoints'] = [
  { out:'Forwarding from 127.0.0.1:8080 -> 8080\n' +
        'Handling connection for 8080\n\n' +
        '$ curl -s localhost:8080/health\n{"status":"ok","version":"2.4.1"}',
    mark:['{"status":"ok","version":"2.4.1"}'],
    note:'One command splits the problem in half. A healthy answer here proves the application, the container port and the bind address are all correct, so everything left is routing. A connection refused means nothing is listening — often a process bound to 127.0.0.1 inside the container, which works for a local test and is invisible to everything else.' },

  { out:'NAME   ENDPOINTS                                         AGE\n' +
        'api    <none>                                            62d\n\n' +
        '# what it should look like:\n' +
        'api    10.0.3.41:8080,10.0.4.18:8080,10.0.3.55:8080      62d',
    mark:['<none>', '10.0.3.41:8080,10.0.4.18:8080,10.0.3.55:8080'],
    note:'This is the highest-yield check in the tree and it takes five seconds. A Service builds its endpoint list from pods that both match the selector and pass readiness, so `<none>` means one of those two failed — and no amount of Ingress or load balancer debugging can compensate for a Service that has selected nothing.' },

  { out:'Name:              api\nNamespace:         default\n' +
        'Selector:          app=api\n' +
        'Type:              ClusterIP\nIP:                10.96.4.12\n' +
        'Port:              80/TCP\nTargetPort:        8080/TCP\n' +
        'Endpoints:         <none>',
    mark:['Selector:          app=api', 'TargetPort:        8080/TCP'],
    note:'Two fields to hold on to. The **selector** is what you are about to compare against the pod labels. And **TargetPort** is the container port while **Port** is what clients use — getting those the wrong way round produces a Service with healthy endpoints that still refuses every connection.' },

  { out:'NAME                READY   STATUS    RESTARTS   AGE   LABELS\n' +
        'api-6c8b9f-2k4mz    1/1     Running   0          14m   app=api-server,tier=backend\n' +
        'api-6c8b9f-7xq8p    1/1     Running   0          14m   app=api-server,tier=backend\n' +
        'api-6c8b9f-mn3wt    1/1     Running   0          14m   app=api-server,tier=backend',
    mark:['app=api-server'],
    note:'There it is: the Service selects `app=api` and the pods carry `app=api-server`. Selectors are exact string matches with no fuzzy matching and no warning — the Service is valid, the pods are healthy, and the two simply never meet. Editing a Deployment\'s template labels without updating the Service is the usual way this arrives.' },

  { out:'$ kubectl run t --rm -it --image=nicolaka/netshoot -- curl -s http://api.default.svc.cluster.local/health\n' +
        '{"status":"ok","version":"2.4.1"}\n\n' +
        '# still broken looks like one of these:\n' +
        'curl: (6) Could not resolve host: api.default.svc.cluster.local\n' +
        'curl: (7) Failed to connect to api.default.svc.cluster.local port 80: Connection refused',
    mark:['{"status":"ok","version":"2.4.1"}', 'Could not resolve host', 'Connection refused'],
    note:'Testing from inside removes Ingress, the load balancer and external DNS from the picture. A name that does not resolve at all is a DNS problem rather than a Service one; a refused connection with endpoints present usually means targetPort is wrong or a NetworkPolicy is in the way.' }
];

LX.pbOut['cn-dns'] = [
  { out:'Server:\t\t10.96.0.10\nAddress:\t10.96.0.10#53\n\n' +
        'Name:\tapi.payments.svc.cluster.local\nAddress: 10.96.7.20\n\n' +
        '# the two failures, which mean different things:\n' +
        ';; connection timed out; no servers could be reached\n' +
        '** server can\'t find api.payments.svc.cluster.local: NXDOMAIN',
    mark:['connection timed out', 'NXDOMAIN'],
    note:'The distinction carries the whole diagnosis. **NXDOMAIN** means DNS answered and the name genuinely does not exist — check the Service. **Timeout** means nothing answered at all — CoreDNS is down, or something is dropping UDP 53. Applications report both as a generic failure, which is why testing here rather than in the app matters.' },

  { out:'nameserver 10.96.0.10\n' +
        'search payments.svc.cluster.local svc.cluster.local cluster.local\n' +
        'options ndots:5\n\n' +
        '# a pod with the wrong dnsPolicy gets the node resolver instead:\n' +
        'nameserver 10.0.0.2\nsearch ec2.internal',
    mark:['nameserver 10.96.0.10', 'options ndots:5', 'nameserver 10.0.0.2'],
    note:'The kubelet writes this when the pod starts. A nameserver that is not the cluster DNS Service IP means `dnsPolicy` is not ClusterFirst — usually `Default`, which uses the node\'s resolver and cannot see cluster names at all. `hostNetwork: true` pods hit this constantly and need `ClusterFirstWithHostNet`.' },

  { out:'NAME                       READY   STATUS    RESTARTS   AGE\n' +
        'coredns-5d78c9-4kk2n       1/1     Running   0          40d\n' +
        'coredns-5d78c9-p7wxs       1/1     Running   0          40d\n\n' +
        '$ kubectl -n kube-system logs -l k8s-app=kube-dns --tail=5\n' +
        '[INFO] plugin/ready: Still waiting on: nothing\n' +
        '[ERROR] plugin/errors: 2 example.com. A: read udp 10.0.3.12:52104->10.0.0.2:53: i/o timeout',
    mark:['Running', 'plugin/errors', 'i/o timeout'],
    note:'CoreDNS is a normal Deployment and fails in normal ways — OOMKilled under load, crash-looping on a bad Corefile, or every replica on one node that went away. The `plugin/errors` line is a different signal: cluster names resolve fine and the *upstream* forwarder is unreachable, which is an egress problem rather than a DNS one.' },

  { out:'$ kubectl exec -n payments ledger-8b6c4-r9wzt -- nc -zvu 10.96.0.10 53\n' +
        'nc: connect to 10.96.0.10 port 53 (udp) timed out\n\n' +
        '$ kubectl get netpol -A\n' +
        'NAMESPACE   NAME                   POD-SELECTOR   AGE\n' +
        'payments    default-deny-egress    <none>         6h',
    mark:['timed out', 'default-deny-egress'],
    note:'This is the nastiest version and the one worth memorising. A default-deny egress policy blocks UDP 53 exactly like any other traffic, so DNS breaks for one namespace while CoreDNS is healthy and resolv.conf is correct. An empty pod-selector means it applies to every pod in the namespace. Whenever you write a default-deny policy, the first rule you add is DNS to kube-system.' },

  { out:'$ kubectl run t --rm -it --image=nicolaka/netshoot -- sh -c "dig +short api.payments.svc.cluster.local; dig +short example.com"\n' +
        '10.96.7.20\n' +
        '93.184.216.34',
    mark:['10.96.7.20', '93.184.216.34'],
    note:'One internal name and one external name from a fresh pod. Internal resolving with external failing points at CoreDNS\'s upstream forwarders or egress; the reverse points at the cluster zone or the Service. A fresh pod also rules out a stale resolver cache inside the application you were debugging.' }
];

LX.pbOut['cn-ingress'] = [
  { out:'NAMESPACE   NAME       CLASS   HOSTS              ADDRESS                                    PORTS     AGE\n' +
        'default     api        nginx   api.example.com    k8s-ingress-abc.elb.amazonaws.com          80, 443   40d\n' +
        'default     reports    <none>  reports.example.com                                           80        6m',
    mark:['k8s-ingress-abc.elb.amazonaws.com', '<none>'],
    note:'The second row is the failure: no CLASS and no ADDRESS after six minutes means no controller ever claimed it. An Ingress object is a request, not an implementation — without a matching ingressClassName it sits there looking perfectly valid and nothing is ever provisioned.' },

  { out:'10.0.1.9 - - [27/Aug/2026:11:41:02 +0000] "GET /api/orders HTTP/1.1" 503 592 "-" "curl/8.5.0" 121 0.000 [default-api-80] [] - - - - 9f2\n' +
        '10.0.1.9 - - [27/Aug/2026:11:41:14 +0000] "GET /api/orders HTTP/1.1" 502 150 "-" "curl/8.5.0" 121 0.004 [default-api-80] 10.0.3.41:9090 502 0.004 502 a71',
    mark:['503', '[default-api-80] []', '502', '10.0.3.41:9090'],
    note:'Read the upstream field at the end. The 503 has an empty upstream list — the controller had nowhere to send it, which means the Service has no endpoints. The 502 names a real pod address and port: it connected and got something it could not use, so the pod is up and the port or protocol is wrong. 503 sends you to the Service, 502 to the pod.' },

  { out:'Rules:\n' +
        '  Host              Path      Backends\n' +
        '  ----              ----      --------\n' +
        '  api.example.com   \n' +
        '                    /api      api:80 (10.0.3.41:8080,10.0.4.18:8080)\n' +
        '                    /metrics  api:9090 (<error: endpoints "api" not found>)\n' +
        'Annotations:        nginx.ingress.kubernetes.io/rewrite-target: /$1',
    mark:['api:80 (10.0.3.41:8080,10.0.4.18:8080)', '<error: endpoints "api" not found>'],
    note:'`describe ingress` resolves the backends for you, which is the fastest confirmation that a rule points at something real. The second rule names port 9090 on a Service that only exposes 80 — the port here must match the **Service** port, not the container port, and that mismatch is a routine cause of 502.' },

  { out:'* Server certificate:\n' +
        '*  subject: CN=api.example.com\n' +
        '*  start date: May 30 00:00:00 2026 GMT\n' +
        '*  expire date: Aug 28 23:59:59 2026 GMT\n' +
        '< HTTP/2 200\n\n' +
        '# and when the Secret is missing entirely:\n' +
        '*  subject: O=Acme Co; CN=Kubernetes Ingress Controller Fake Certificate',
    mark:['expire date: Aug 28 23:59:59 2026 GMT', 'Fake Certificate'],
    note:'`-k` is the bisection — working with it and failing without means the certificate, not the route. "Kubernetes Ingress Controller Fake Certificate" is nginx serving its own default because the TLS Secret named in spec.tls does not exist in that namespace, which looks like a browser trust error rather than a missing object.' },

  { out:'---------------------------------------------------\n' +
        '|              DescribeTargetHealth               |\n' +
        '+---------------------+----------+----------------+\n' +
        '|  i-0a1b2c3d4e5f     | healthy  |                |\n' +
        '|  i-0f9e8d7c6b5a     | unhealthy| Health checks failed with these codes: [404] |\n' +
        '|  i-0c3d2e1f0a9b     | unhealthy| Request timed out                            |\n' +
        '+---------------------+----------+----------------+',
    mark:['| healthy  |', 'Health checks failed with these codes: [404]', 'Request timed out'],
    note:'Three different problems in one table. A 404 means the load balancer is reaching the node and asking for a path that does not exist — fix the health-check path on the target group. A timeout means it never arrived: the security group on the nodes does not allow the load balancer to reach the node port. And with `externalTrafficPolicy: Local`, nodes with no local pod are *supposed* to be unhealthy, which alarms people unnecessarily.' }
];

LX.pbOut['cn-egress'] = [
  { out:'$ nslookup example.com\n;; connection timed out; no servers could be reached\n\n' +
        '$ curl -sS -m 5 -o /dev/null -w "%{http_code}\\n" https://1.1.1.1\ncurl: (28) Connection timed out after 5001 milliseconds',
    mark:['no servers could be reached', 'Connection timed out after 5001'],
    note:'Both failed, so this is not DNS alone — packets are not leaving. If the raw IP had worked and only the name failed, this would be a DNS tree instead. Applications report both as one generic timeout, which is why separating them at the first step saves the investigation.' },

  { out:'NAME                  POD-SELECTOR   AGE\n' +
        'default-deny-egress   <none>         6h\n\n' +
        '$ kubectl describe netpol default-deny-egress\n' +
        'PodSelector:     <none> (Allowing the specific traffic to all pods in this namespace)\n' +
        'Allowing egress traffic:\n  <none> (Selected pods are isolated for egress connectivity)\n' +
        'Policy Types: Egress',
    mark:['Selected pods are isolated for egress connectivity', 'Policy Types: Egress'],
    note:'That sentence is Kubernetes saying "everything outbound is denied". The moment one policy selects a pod and names Egress, that pod is deny-by-default outbound and every destination needs an explicit allow — DNS included. It is invisible from inside the pod: no error, no log, just timeouts.' },

  { out:'# from the node itself:\n200\n\n' +
        '# from a pod on the same node:\ncurl: (28) Connection timed out after 5001 milliseconds',
    mark:['200', 'Connection timed out after 5001'],
    note:'This splits cluster problems from cloud problems in one command. The node reaching the internet while pods cannot means pod traffic is not being masqueraded to the node address, so replies have nowhere to return — a CNI or SNAT problem. If the node fails too, stop looking at Kubernetes: it is routing, NAT or security groups.' },

  { out:'-------------------------------------------------------\n' +
        '|                 DescribeRouteTables                 |\n' +
        '+---------------------+-------------------------------+\n' +
        '|  10.0.0.0/16        |  local                        |\n' +
        '|  0.0.0.0/0          |  nat-0a1b2c3d4e5f  (available)|\n' +
        '+---------------------+-------------------------------+\n\n' +
        '# a subnet with no way out looks like this:\n' +
        '|  10.0.0.0/16        |  local                        |',
    mark:['0.0.0.0/0', 'nat-0a1b2c3d4e5f', 'local'],
    note:'A private subnet needs 0.0.0.0/0 pointing at a NAT gateway; a public one points at an internet gateway. Only the `local` route and nothing else means the subnet has no way out at all. Check where the NAT gateway lives too — placed in the private subnet it serves, it has no route out itself and everything times out.' },

  { out:'# NACL, and note the direction:\n' +
        'Egress  100  ALL  0.0.0.0/0  allow\n' +
        'Ingress 100  TCP  443        0.0.0.0/0  allow\n' +
        'Ingress 32767 ALL 0.0.0.0/0  deny\n\n' +
        '# the security group, for comparison:\n' +
        'Egress  ALL  0.0.0.0/0  allow',
    mark:['Ingress 100  TCP  443', 'Ingress 32767 ALL 0.0.0.0/0  deny'],
    note:'This is the classic NACL mistake. Outbound to 443 is allowed, but the *reply* arrives on an ephemeral port between 1024 and 65535 and there is no inbound rule for it, so the catch-all deny drops it. A security group would have allowed the reply automatically because it is stateful; a NACL is not, and needs both directions written out.' }
];

LX.pbOut['cn-node-notready'] = [
  { out:'Conditions:\n' +
        '  Type             Status  LastTransitionTime  Reason                       Message\n' +
        '  ----             ------  ------------------  ------                       -------\n' +
        '  MemoryPressure   False   Thu, 27 Aug 09:02   KubeletHasSufficientMemory   kubelet has sufficient memory available\n' +
        '  DiskPressure     True    Thu, 27 Aug 11:38   KubeletHasDiskPressure       kubelet has disk pressure\n' +
        '  PIDPressure      False   Thu, 27 Aug 09:02   KubeletHasSufficientPID      kubelet has sufficient PID available\n' +
        '  Ready            False   Thu, 27 Aug 11:38   KubeletNotReady              container runtime status check may not have completed',
    mark:['DiskPressure     True', 'Ready            False', 'KubeletHasDiskPressure'],
    note:'The conditions block is the node\'s own account and the transition times bracket the incident. `Ready=Unknown` with "kubelet stopped posting node status" is a different problem from `Ready=False` with a reason — the first means the kubelet is not talking at all, the second means it is talking and unhappy.' },

  { out:'● kubelet.service - kubelet: The Kubernetes Node Agent\n' +
        '     Active: active (running) since Thu 2026-08-27 09:02:04 UTC; 2h ago\n\n' +
        'Aug 27 11:38:41 ip-10-0-3-4 kubelet[2841]: I0827 eviction_manager.go:met threshold [imagefs.available<15%]\n' +
        'Aug 27 11:38:41 ip-10-0-3-4 kubelet[2841]: I0827 image_gc_manager.go: attempting to delete unused images\n' +
        'Aug 27 11:39:02 ip-10-0-3-4 kubelet[2841]: I0827 eviction_manager.go: eviction manager: pods reindex-4t7bn evicted',
    mark:['active (running)', 'imagefs.available<15%', 'evicted'],
    note:'The kubelet is running and telling you exactly what it is doing: it hit the image filesystem threshold, started garbage-collecting images, and began evicting pods. That is orderly behaviour under pressure rather than a fault — the problem is upstream, in whatever filled the disk.' },

  { out:'Filesystem      Size  Used Avail Use% Mounted on\n' +
        '/dev/nvme0n1p1   80G   77G  3.1G  97% /\n' +
        'overlay          80G   77G  3.1G  97% /var/lib/containerd\n\n' +
        '$ du -sh /var/lib/containerd/* 2>/dev/null | sort -h | tail -3\n' +
        '1.2G\t/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs\n' +
        '58G\t/var/lib/containerd/io.containerd.content.v1.content',
    mark:['97% /', '58G'],
    note:'58GB of image content is the usual answer — a node that has pulled many large images over months, faster than garbage collection reclaims. Container logs under /var/log are the other half. Both look identical from the cluster, and both are a node problem rather than a workload one.' },

  { out:'{\n  "status": {\n    "conditions": [\n' +
        '      {"type": "RuntimeReady", "status": true},\n' +
        '      {"type": "NetworkReady", "status": false,\n' +
        '       "message": "cni plugin not initialized"}\n' +
        '    ]\n  }\n}',
    mark:['"RuntimeReady", "status": true', '"NetworkReady", "status": false', 'cni plugin not initialized'],
    note:'`crictl` talks to the runtime directly and works when kubectl cannot see the node at all — worth knowing because it is the only view left in that state. Runtime ready with network not ready means containerd is fine and the CNI never initialised, so the node cannot admit pods and will never become Ready.' },

  { out:'node/ip-10-0-3-4 cordoned\n' +
        'evicting pod default/reindex-4t7bn\n' +
        'evicting pod default/api-6c8b9f-2k4mz\n' +
        'error when evicting pod "api-6c8b9f-2k4mz" (will retry): Cannot evict pod as it would violate the pod\'s disruption budget.\n' +
        'pod/api-6c8b9f-2k4mz evicted\n' +
        'node/ip-10-0-3-4 drained',
    mark:['cordoned', 'violate the pod\'s disruption budget', 'drained'],
    note:'Drain cordons first, then evicts while respecting PodDisruptionBudgets — the retry line is the budget working as designed, holding the eviction until a replacement is ready. A drain that hangs forever usually means a PDB that can never be satisfied, often minAvailable equal to the replica count.' }
];

LX.pbOut['cn-pvc-pending'] = [
  { out:'Events:\n' +
        '  Type     Reason              Age   From                         Message\n' +
        '  ----     ------              ----  ----                         -------\n' +
        '  Normal   WaitForFirstConsumer 3m   persistentvolume-controller  waiting for first consumer to be created before binding\n' +
        '  Warning  ProvisioningFailed   2m   ebs.csi.aws.com              failed to provision volume: rpc error: code = Internal desc = Could not create volume: UnauthorizedOperation',
    mark:['WaitForFirstConsumer', 'ProvisioningFailed', 'UnauthorizedOperation'],
    note:'Two very different events. WaitForFirstConsumer is *normal* — the class defers binding until a pod is scheduled so the volume lands in the right zone. ProvisioningFailed with UnauthorizedOperation is the CSI driver\'s IAM role lacking ec2:CreateVolume, which is a cloud permission problem wearing a Kubernetes hat.' },

  { out:'NAME             PROVISIONER             RECLAIMPOLICY  VOLUMEBINDINGMODE      AGE\n' +
        'gp3 (default)    ebs.csi.aws.com         Delete         WaitForFirstConsumer   180d\n' +
        'gp2              kubernetes.io/aws-ebs   Delete         Immediate              400d\n\n' +
        '$ kubectl get pvc data-postgres-0 -o jsonpath=\'{.spec.storageClassName}\'\n' +
        'managed-csi',
    mark:['gp3 (default)', 'Immediate', 'managed-csi'],
    note:'The claim names `managed-csi`, which is an Azure class name on an AWS cluster — a manifest carried across clouds. Note the two binding modes: `Immediate` creates the volume before the scheduler picks a node, which is how a volume ends up in a zone with no capacity for the pod.' },

  { out:'NAME                              READY   STATUS    RESTARTS   AGE\n' +
        'ebs-csi-controller-6d8f7-x2qlm    5/6     Running   0          40d\n\n' +
        '$ kubectl -n kube-system logs deploy/ebs-csi-controller -c ebs-plugin --tail=5\n' +
        'E0827 11:12:04 could not create volume in EC2: UnauthorizedOperation: You are not authorized to perform this operation.\n' +
        '\tstatus code: 403, request id: 8f2a-…',
    mark:['5/6', 'UnauthorizedOperation', 'status code: 403'],
    note:'The controller logs carry the real AWS error, which is far more specific than the claim event. `5/6` ready is itself a signal — one container in the controller pod is unhealthy. On EKS the driver is a separate addon with its own IAM role, so a cluster upgraded from in-tree volumes often loses provisioning because nobody installed it.' },

  { out:'{"required":{"nodeSelectorTerms":[{"matchExpressions":[\n' +
        '  {"key":"topology.ebs.csi.aws.com/zone","operator":"In","values":["us-east-1a"]}]}]}}\n\n' +
        '$ kubectl get nodes -L topology.kubernetes.io/zone\n' +
        'NAME              STATUS   ZONE\n' +
        'ip-10-0-4-9       Ready    us-east-1b\n' +
        'ip-10-0-5-2       Ready    us-east-1b',
    mark:['us-east-1a', 'us-east-1b'],
    note:'The volume is pinned to us-east-1a and every remaining node is in 1b — block storage is zonal and cannot cross. The pod stays Pending with a volume node affinity conflict forever. `WaitForFirstConsumer` prevents exactly this by creating the volume only after the scheduler has chosen a node.' },

  { out:'NAME        ATTACHER          PV                                         NODE           ATTACHED\n' +
        'csi-8f2a…   ebs.csi.aws.com   pvc-4c1d-9b2e-…                            ip-10-0-3-4    true\n\n' +
        'Events on the new pod:\n' +
        '  Warning  FailedAttachVolume  2m  attachdetach-controller  Multi-Attach error for volume "pvc-4c1d-9b2e" Volume is already exclusively attached to one node and can\'t be attached to another',
    mark:['ip-10-0-3-4', 'Multi-Attach error'],
    note:'The volume is still attached to a node that is gone. That six-minute wait before force-detach is deliberate: detaching from a node that might still be writing risks corruption. Multi-Attach on a healthy cluster means two pods want one ReadWriteOnce volume — you need RWX storage such as EFS, or one replica.' }
];
