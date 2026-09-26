/* Onsite track — networking questions: Services, EndpointSlices, ports, DNS, the packet path, Ingress/Gateway,
   NetworkPolicy and layered diagnosis. Explain the mechanism, then the evidence that proves each layer. */
window.LX = window.LX || {};
LX.onsiteQ = LX.onsiteQ || [];
LX.onsiteQ.push(

{ id: 'ons-q-net-01', track: 'onsite', topic: 'net', priority: 'P0', level: 1, mins: 4,
  prereqs: ['les-services'],
  labs: ['ons-lab-03'],
  q: 'How do Service selectors and EndpointSlices relate?',
  context: 'A Service `web` in namespace `shop` has selector `app=web`. Explain how Kubernetes decides which pod addresses sit behind it, how that list changes over time, and the cases where there is no selector or no virtual IP.',
  evaluates: [
    'Knows the EndpointSlice controller, not the Service, builds the backend list from selector matches',
    'Knows endpoint conditions (ready, serving, terminating) and that readiness decides whether traffic is sent',
    'Knows selectors must match exactly and silently match nothing when wrong',
    'Can explain headless Services and Services without selectors'
  ],
  spoken: 'A Service is mostly a stable name, a virtual IP and a port mapping. The actual backend list lives in EndpointSlice objects.\n\nThe EndpointSlice controller watches Services and pods. For each Service with a selector, it finds pods in the same namespace whose labels match every key and value in the selector, and writes their IPs and resolved target ports into EndpointSlices labelled with the Service name. Each endpoint carries conditions: ready, serving and terminating. Ready is basically serving and not terminating, and for pods it follows the pod\'s Ready condition, so a pod failing readiness stays listed but not ready, and proxies skip it.\n\nkube-proxy, or whatever dataplane the cluster uses, watches those slices on every node and programs routing. So when a pod becomes Ready or starts terminating, routing follows within moments.\n\nThe selector is an exact match with no error when it matches nothing; you just get empty slices. A headless Service, with clusterIP None, has no virtual IP, and DNS returns pod IPs directly. A Service without a selector gets no automatic slices, and you create EndpointSlices yourself, for example to point at something outside the cluster.',
  deep: '**Who does what.** The Service object holds `selector`, `ports` and (for most types) a `clusterIP`. The EndpointSlice controller in kube-controller-manager watches Services, Pods and Nodes. For every Service with a selector it computes matching pods (same namespace, all selector labels present with equal values) and maintains one or more EndpointSlices labelled `kubernetes.io/service-name=<svc>`, owned by the Service. By default each slice holds up to 100 endpoints; large Services get several slices, which keeps updates small.\n\n**What an endpoint contains.** Address (pod IP), a `targetRef` to the pod, `nodeName`, zone, and resolved ports. Named target ports are resolved per pod, so pods using different numbers for the same port name still work. Conditions:\n- `serving`: the pod is passing readiness (regardless of terminating).\n- `terminating`: the pod is being deleted.\n- `ready`: effectively serving and not terminating (always true if the Service sets `publishNotReadyAddresses`).\nProxies normally send new traffic only to ready endpoints, and may fall back to serving-but-terminating ones if nothing else is available, which helps graceful rollouts.\n\n**Consumers.** kube-proxy (iptables, IPVS or nftables modes) or an alternative dataplane watches slices and programs each node. Cluster DNS uses them for headless Services. Ingress and Gateway controllers often read them directly to send traffic straight to pod IPs.\n\n**Special cases.**\n- *Selector matches nothing:* the Service is valid and has no endpoints. No warning. Compare `kubectl describe svc` selector with `kubectl get pods --show-labels`.\n- *Headless (`clusterIP: None`):* no virtual IP and no proxying; DNS returns A/AAAA records for ready pod IPs. Used by StatefulSets for per-pod names and by clients that do their own load balancing.\n- *No selector:* the controller creates nothing. You create EndpointSlices yourself with the `kubernetes.io/service-name` label, for example to give an external database a cluster DNS name. The older Endpoints API is deprecated in recent versions in favour of EndpointSlices, though it still appears in many tutorials.\n\n**Diagnosis in one line:** empty slices mean selector mismatch or no ready pods; slices with only not-ready endpoints mean readiness is failing; populated ready endpoints plus failing traffic moves the investigation to ports, policy or the application.',
  followups: [
    { q: 'The Service has endpoints but some are listed as not ready. What does that tell you and what do you check next?', guidance: 'Those pods match the selector but fail readiness (or are terminating). Proxies skip them. Check `kubectl describe pod` for readiness probe failures and events, whether a dependency the probe checks is down, and whether a rollout is in progress. Readiness failure never restarts the container.' },
    { q: 'Why did Kubernetes move from a single Endpoints object to EndpointSlices?', guidance: 'A single Endpoints object per Service became huge for large Services, and every change had to be sent to every watcher (every node\'s proxy). Slicing limits the size of each update and adds richer fields such as conditions, topology and dual-stack address types.' },
    { q: 'How would you give an external database a stable in-cluster name, and what are the trade-offs versus ExternalName?', guidance: 'Either a selectorless Service with a manually managed EndpointSlice (gives a ClusterIP, works with IPs, you must keep addresses updated) or an ExternalName Service (DNS CNAME to a hostname, no proxying, no port remapping, and TLS hostname checks may still need the real name). Choose by whether the target is an IP or a DNS name.' }
  ],
  misconceptions: [
    '"The Service stores the list of pods." The EndpointSlice controller maintains EndpointSlices; the Service holds only the selector and port definitions.',
    '"A pod failing readiness is removed from the slice." It usually stays listed with ready=false; proxies skip it. It is not restarted.',
    '"A selector that matches nothing is an error." It is silently valid and produces no ready endpoints.',
    '"Every Service has a virtual IP." Headless Services have none, and ExternalName Services are only a DNS alias.'
  ],
  weak: [
    'Says "the Service load balances to the pods" without mentioning how backends are discovered',
    'Does not connect readiness to endpoint membership',
    'Cannot describe headless or selectorless Services'
  ],
  evidence: '# example output\n$ kubectl -n shop describe svc web | grep -E "Selector|TargetPort|Endpoints"\nSelector:          app=web\nTargetPort:        http/TCP\nEndpoints:         10.244.1.23:8080,10.244.2.14:8080\n\n$ kubectl -n shop get endpointslices -l kubernetes.io/service-name=web -o yaml   (abridged)\n  - addresses: ["10.244.1.23"]\n    conditions: {ready: true, serving: true, terminating: false}\n  - addresses: ["10.244.3.9"]\n    conditions: {ready: false, serving: false, terminating: false}\n\n$ kubectl -n shop get pods -l app=web --show-labels\nNAME                   READY   STATUS    LABELS\nweb-6f7c9d8b5d-x2k4p   1/1     Running   app=web,pod-template-hash=6f7c9d8b5d\nweb-6f7c9d8b5d-zz81c   0/1     Running   app=web,pod-template-hash=6f7c9d8b5d',
  rubric: {
    strong: [
      'Explains the EndpointSlice controller builds slices from selector matches in the same namespace',
      'Describes ready/serving/terminating and ties ready to pod readiness',
      'Explains exact-match selectors and the silent empty case',
      'Covers headless and selectorless Services',
      'Mentions that node proxies/dataplanes consume slices'
    ],
    acceptable: [
      'Describes the older Endpoints object instead of EndpointSlices, if the mechanism (selector plus readiness decides membership) is correct',
      'Explains through a debugging example (empty endpoints, not-ready endpoints) rather than a definition'
    ],
    redFlags: [
      'Claims readiness failure restarts the pod or container',
      'Says the Service itself health-checks pods',
      'Says selectors do partial or prefix matching'
    ]
  },
  aws: { analogy: 'An ALB target group: the list of registered targets and their health, with ECS registering tasks automatically.', breaks: 'Targets are registered by a selector match rather than by a service explicitly registering tasks, and health comes from kubelet-run readiness probes rather than load-balancer health checks. The list is consumed by every node\'s dataplane, not by one load balancer.' },
  refs: [
    { t: 'EndpointSlices', u: 'https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/' },
    { t: 'Service', u: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
    { t: 'Debug Services', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/' }
  ],
  verify: ''
},

{ id: 'ons-q-net-02', track: 'onsite', topic: 'net', priority: 'P0', level: 1, mins: 3,
  prereqs: ['les-services'],
  labs: ['ons-lab-03'],
  q: 'What is the difference between Service port, targetPort, containerPort (and nodePort)?',
  context: 'A Service shows `port: 80`, `targetPort: http`, `nodePort: 31080`, and the pod declares `containerPort: 8080` named `http`. Explain what each number means, who uses it, and which one is most often wrong in a broken setup.',
  evaluates: [
    'Knows port is what clients connect to on the Service address',
    'Knows targetPort is where traffic is sent on the pod, by number or name, and defaults to port',
    'Knows containerPort is largely informational except for named-port resolution',
    'Knows nodePort opens a port on every node for NodePort and LoadBalancer types'
  ],
  spoken: 'port is what clients use: they connect to the Service name or ClusterIP on port 80.\n\ntargetPort is where that traffic goes on the pod. It can be a number or a name. If it is a name, like http, it is looked up in each pod\'s container port list, so it resolves to 8080 here. If you leave it out, it defaults to the same value as port, which is a classic cause of breakage.\n\ncontainerPort is declared in the pod spec. For most setups it is informational: not listing a port does not stop the app from listening on it, and listing it does not open anything. It matters when a Service uses a named targetPort, and for documentation and some tools.\n\nnodePort, for NodePort and LoadBalancer Services, is a port opened on every node, from a default range of 30000 to 32767, which forwards to the Service.\n\nThe usual bug is targetPort not matching what the process actually listens on. The quick check is the EndpointSlice, which shows the resolved port, and then curl the pod IP on that port directly.',
  deep: '**Four numbers, four audiences.**\n- `port` (Service): the port on the Service\'s virtual IP and DNS name. Clients inside the cluster use `web.shop:80`.\n- `targetPort` (Service): the destination port on each backend pod. Number or name; defaults to `port` when omitted. A name is resolved per pod from `spec.containers[].ports[].name`, which lets you change the container\'s port or run pods with different port numbers without editing the Service.\n- `containerPort` (Pod): declared on the container. The API reference is explicit that not specifying a port does not prevent it from being exposed; any process listening on 0.0.0.0 in the pod is reachable. It is used for named-port resolution, by `hostPort` configurations, and by humans and tooling. It is not a firewall rule.\n- `nodePort` (Service, NodePort/LoadBalancer types): a port on every node\'s IP (default range 30000–32767, configurable) that forwards to the Service. A cloud or environment load balancer created for type LoadBalancer typically targets these node ports, or pod IPs directly depending on the implementation.\n\n**Where it goes wrong.**\n- targetPort omitted, defaulting to 80, while the app listens on 8080: endpoints look healthy (readiness may probe a different port), connections are refused.\n- targetPort names a port that does not exist in the pod: the endpoint has no usable port for that pod.\n- App listens on 127.0.0.1: reachable from inside the container, refused from anywhere else, even with every port number right.\n- Multiple ports: each Service port needs a `name` when there is more than one.\n\n**How to verify each hop.** `kubectl get svc -o yaml` for port/targetPort, `kubectl get endpointslices` for the resolved port per pod, `kubectl exec POD -- ss -ltn` (if the image has it) or the app\'s logs for what it actually binds, and `curl -v POD_IP:TARGET_PORT` from another pod to test the pod directly, then `curl -v SERVICE:PORT` to test the Service mapping.',
  followups: [
    { q: 'Why use a named targetPort instead of a number?', guidance: 'The Service stays correct if the container port changes, and different pods (for example two versions during a migration) can use different numbers under the same name. The mapping is resolved per endpoint in the EndpointSlice.' },
    { q: 'Endpoints are populated and ready, but curl to the Service gets "connection refused". Where do you look first?', guidance: 'The port mapping and the listener: compare targetPort with what the process binds, check the resolved port in the EndpointSlice, curl the pod IP on that port directly, and check whether the app binds 127.0.0.1. Refused means a packet reached a host that had nothing listening, so it is rarely a routing or policy drop.' },
    { q: 'When would you avoid NodePort in production?', guidance: 'It exposes a high port on every node, requires node-level firewalling, ties clients to node IPs and adds a hop. Usually you front it with a load balancer (type LoadBalancer or an Ingress/Gateway controller) rather than giving clients node ports directly.' }
  ],
  misconceptions: [
    '"containerPort opens the port." It is informational for most runtimes; the process listening decides what is reachable.',
    '"port and targetPort must be the same." The Service can map any port to any targetPort; it only defaults to the same value.',
    '"nodePort is only on the node running the pod." It is opened on every node (subject to traffic policy details).'
  ],
  weak: [
    'Mixes up port and targetPort',
    'Believes containerPort acts like a security group rule',
    'Cannot describe how to test which number is wrong'
  ],
  evidence: '# example output\n$ kubectl -n shop get svc web -o jsonpath=\'{.spec.ports}\'\n[{"name":"http","nodePort":31080,"port":80,"protocol":"TCP","targetPort":"http"}]\n\n$ kubectl -n shop get pod web-6f7c9d8b5d-x2k4p -o jsonpath=\'{.spec.containers[0].ports}\'\n[{"containerPort":8080,"name":"http","protocol":"TCP"}]\n\n$ kubectl -n shop get endpointslices -l kubernetes.io/service-name=web\nNAME        ADDRESSTYPE   PORTS   ENDPOINTS\nweb-7xk2p   IPv4          8080    10.244.1.23,10.244.2.14\n\n$ kubectl -n shop exec deploy/toolbox -- curl -sv http://10.244.1.23:8080/healthz 2>&1 | grep -E "Connected|HTTP/"\n* Connected to 10.244.1.23 (10.244.1.23) port 8080\n< HTTP/1.1 200 OK',
  rubric: {
    strong: [
      'Defines port, targetPort, containerPort and nodePort with who uses each',
      'Mentions targetPort defaulting to port and named port resolution',
      'Says containerPort is largely informational (hedged) and not a firewall',
      'Gives a hop-by-hop verification (EndpointSlice port, curl pod IP, curl Service)'
    ],
    acceptable: [
      'Explains with the ECS containerPort/hostPort mapping as a comparison, if the Kubernetes semantics are right',
      'Omits nodePort detail but covers the other three correctly'
    ],
    redFlags: [
      'Claims omitting containerPort blocks traffic to that port',
      'Says targetPort is the port clients connect to',
      'Suggests changing Service type to fix a targetPort mismatch'
    ]
  },
  aws: { analogy: 'ALB listener port (clients) → target group port → the containerPort in an ECS task definition\'s port mapping.', breaks: 'In ECS with awsvpc, the task definition\'s port mapping drives target registration, so it matters. In Kubernetes, containerPort is mostly documentation and name lookup; the Service\'s targetPort and what the process actually binds decide where traffic lands.' },
  refs: [
    { t: 'Service (port definitions)', u: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
    { t: 'Pod API reference (container ports)', u: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-v1/' },
    { t: 'Debug Services', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/' }
  ],
  verify: ''
},

{ id: 'ons-q-net-03', track: 'onsite', topic: 'net', priority: 'P0', level: 1, mins: 4,
  prereqs: ['les-probes', 'les-services'],
  labs: ['ons-lab-03', 'ons-lab-04'],
  q: 'Why can a running Pod still be unavailable to clients?',
  context: 'kubectl shows the pod as `Running`, but clients calling the Service get errors or timeouts. List the realistic reasons in the order you would check them, and the evidence for each.',
  evaluates: [
    'States that Running is a phase about containers, not about serving traffic, and is not the same as Ready',
    'Knows readiness failure removes a pod from endpoints without restarting it',
    'Covers Service-level causes: selector mismatch, wrong targetPort',
    'Covers network causes: app bound to localhost, NetworkPolicy, terminating pods, client-side DNS or connection caching'
  ],
  spoken: 'Running only means the pod is bound to a node and at least one container is running. It says nothing about whether the app is serving. I work through it from the Service outward.\n\nFirst, readiness. If READY shows 0 of 1, the readiness probe is failing, so the pod is kept out of the Service\'s endpoints. It is not restarted; describe pod shows the probe failure.\n\nSecond, the Service. If the endpoints list is empty or does not include this pod, the selector does not match its labels. If endpoints are there, check targetPort against the port the app actually listens on.\n\nThird, the listener. An app bound to 127.0.0.1 works from inside the container and refuses everyone else. curl the pod IP directly from another pod to prove it.\n\nFourth, the network path: a NetworkPolicy selecting that pod or the client can drop traffic, which usually shows as a timeout rather than refused.\n\nFinally, timing and clients: a pod that is terminating is being removed from endpoints, and clients that cache DNS or hold long-lived connections may keep hitting old addresses.',
  deep: '**Running is not Ready.** The pod phase `Running` means the pod is scheduled and at least one container is running (or restarting). The `Ready` condition is separate: all containers ready, readiness probes passing, and any readiness gates satisfied. Only Ready pods are ready endpoints for Services. `kubectl get pods` shows both: STATUS Running with READY 0/1 is the common case.\n\n**Checklist in order, with evidence.**\n1. *Readiness failing.* `kubectl describe pod` shows `Readiness probe failed:` events with the HTTP status or error. Causes: wrong probe path or port, the app still warming up, the probe checks a downstream dependency that is down. Readiness failure removes traffic; it never restarts the container (that is liveness).\n2. *Selector mismatch.* `kubectl get endpointslices -l kubernetes.io/service-name=SVC` is empty or lacks the pod. Compare `describe svc` Selector with `get pods --show-labels`; also confirm the Service and pod are in the same namespace.\n3. *Wrong targetPort.* Endpoints list the pod, but connections are refused. The EndpointSlice shows the resolved port; compare it with what the app binds.\n4. *Listening on loopback.* `kubectl exec POD -- ss -ltn` (if available) or the app\'s startup log shows `127.0.0.1:8080`. `kubectl port-forward` may still work, which is misleading, because it connects from inside the pod\'s network namespace.\n5. *NetworkPolicy.* If any policy selects the destination pod for ingress (or the client for egress), only allowed traffic passes, and denied traffic is typically dropped, so clients see timeouts. `kubectl get networkpolicy -A` and read which pods each selects.\n6. *Terminating or rolling.* During deletion the endpoint is marked terminating; long-lived connections and client caches may still target it. Check for an in-progress rollout.\n7. *Client side.* The client resolves a different name or namespace, caches old IPs, or uses a connection pool pinned to a pod that went away.\n\n**Why order matters.** Readiness and endpoints are cheap to check and explain most cases; network policy and client behaviour take longer. Stating the order is part of the answer the interviewer wants.',
  followups: [
    { q: 'READY is 1/1, endpoints include the pod, and curl to the pod IP works, but clients still fail. What is left?', guidance: 'The Service mapping (port vs targetPort, protocol), a NetworkPolicy that treats the real client differently from your test pod (namespace or labels), the client\'s DNS name or namespace, and client-side caching or connection reuse. Test from the client pod itself or a pod with the same labels and namespace.' },
    { q: 'Your readiness probe checks the database. The database blips and every pod goes unready. What happened and how would you design it instead?', guidance: 'All pods removed themselves from endpoints at once, so the Service has no backends and clients get errors that might have been partial degradation. Readiness should reflect whether this pod can serve useful traffic; shared dependency outages are often better handled by the app returning degraded responses, with dependency health monitored separately.' },
    { q: 'Why can kubectl port-forward succeed while the Service fails?', guidance: 'port-forward connects through the kubelet into the pod\'s network namespace, bypassing the Service, the node dataplane and typically NetworkPolicy, and it reaches loopback-bound listeners. It proves the process responds, not that the Service path works.' }
  ],
  misconceptions: [
    '"Running means it is serving traffic." Running is a phase about containers; Ready decides Service traffic.',
    '"A failing readiness probe restarts the container." It only removes the pod from endpoints; liveness restarts.',
    '"If port-forward works, the Service works." port-forward bypasses the Service path and usually NetworkPolicy.',
    '"Namespaces block traffic between apps." They do not; NetworkPolicy does, if the CNI enforces it.'
  ],
  weak: [
    'Stops at "check the logs" without a structured order',
    'Restarts or deletes the pod before checking readiness and endpoints',
    'Does not distinguish refused (nothing listening) from timeout (dropped)'
  ],
  evidence: '# example output\n$ kubectl -n shop get pods -l app=web\nNAME                   READY   STATUS    RESTARTS   AGE\nweb-6f7c9d8b5d-zz81c   0/1     Running   0          6m\n\n$ kubectl -n shop describe pod web-6f7c9d8b5d-zz81c | grep -A1 Readiness\n    Readiness:  http-get http://:8080/ready delay=0s timeout=1s period=10s #success=1 #failure=3\n  Warning  Unhealthy  12s (x30 over 6m)  kubelet  Readiness probe failed: HTTP probe failed with statuscode: 503\n\n$ kubectl -n shop exec web-6f7c9d8b5d-x2k4p -- ss -ltn\nState   Recv-Q  Send-Q  Local Address:Port\nLISTEN  0       128     127.0.0.1:8080',
  rubric: {
    strong: [
      'States Running ≠ Ready and that readiness controls endpoint membership without restarts',
      'Covers selector mismatch and targetPort mismatch with the evidence for each',
      'Covers localhost binding and NetworkPolicy, distinguishing refused from timeout',
      'Mentions terminating pods and client-side caching or connection reuse',
      'Presents a sensible order of checks'
    ],
    acceptable: [
      'Uses a different but logical order (for example testing from the client first), if each layer is covered with evidence',
      'Mentions readiness gates or sidecar readiness as additional causes'
    ],
    redFlags: [
      'Claims readiness failure restarts the container',
      'Equates Running with healthy or Ready',
      'Proposes deleting pods as the first diagnostic step'
    ]
  },
  aws: { analogy: 'An ECS task that is RUNNING while its target is unhealthy in the ALB target group, so the ALB sends it no traffic.', breaks: 'In ECS the load balancer runs the health check and may cause the task to be replaced. In Kubernetes the kubelet runs readiness on the node, readiness failure never replaces the pod, and there are extra failure points (selectors, targetPort, NetworkPolicy) that have no target-group equivalent.' },
  refs: [
    { t: 'Pod lifecycle (phases and conditions)', u: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/' },
    { t: 'Configure liveness, readiness and startup probes', u: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/' },
    { t: 'Debug Services', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/' }
  ],
  verify: ''
},

{ id: 'ons-q-net-04', track: 'onsite', topic: 'net', priority: 'P0', level: 2, mins: 6,
  prereqs: ['les-request-path', 'les-services'],
  labs: ['ons-lab-03', 'ons-lab-04'],
  q: 'How do you distinguish DNS failure from routing failure from application failure?',
  context: 'A pod in namespace `shop` cannot reach `http://inventory.stock:8080`. The error message in the app log just says "request failed". Explain how you would find which layer is broken, what each result means, and why you test in that order.',
  evaluates: [
    'Uses a layered method: name resolution, then Service address, then pod address directly, then application response',
    'Interprets error types correctly: NXDOMAIN vs DNS timeout, connection refused vs timeout, HTTP status codes',
    'Tests from the right place (a pod with the same namespace and labels as the client) and avoids misleading tests',
    'Collects evidence before changing anything'
  ],
  spoken: 'I split the path into layers and test each one separately, from a pod in the same namespace as the client, ideally with the same labels, so DNS search paths and NetworkPolicy match.\n\nOne, name resolution: nslookup inventory.stock. An IP back means DNS works. NXDOMAIN means the DNS server answered and says the name does not exist, so it is the name, the namespace or a missing Service, not the network. A timeout means I cannot reach the DNS server at all: DNS pods down or egress to port 53 blocked.\n\nTwo, the Service: curl the ClusterIP and port. Connection refused means something actively rejected it: often nothing listening or, with typical kube-proxy setups, a Service with no ready endpoints. A timeout means packets are being dropped: policy or the network path.\n\nThree, bypass the Service: curl a backend pod IP on the targetPort. If that works but the Service does not, the problem is the Service layer: selector, targetPort, endpoints. If it also fails, it is the pod or the path to it.\n\nFour, the application: if I get an HTTP response, even a 500, the network worked. Now it is logs and dependencies.\n\nEach step halves the search space, and I write down the result before changing anything.',
  deep: '**Why layers.** "Request failed" can come from any of four independent systems: the resolver, the Service dataplane, the pod network, and the application. Testing end to end only tells you something is broken. Testing each hop tells you which one, and each result points at a different owner and fix.\n\n**Where to test from.** Use a debug pod in the client\'s namespace (DNS search domains depend on it) with the client\'s labels if NetworkPolicy may be involved, or `kubectl exec` into the client pod if it has tools. Testing from your laptop or a different namespace can give a different answer for legitimate reasons.\n\n**Layer 1: name to address.** `nslookup inventory.stock` (or `dig inventory.stock.svc.cluster.local`).\n- Answer with an IP: DNS works. Note the IP; it should be the Service\'s ClusterIP (or pod IPs for a headless Service).\n- `NXDOMAIN`: the DNS server was reached and says no such name. Wrong namespace, typo, Service not created, or a search-path assumption (a short name only resolves within the client\'s own namespace).\n- `SERVFAIL`: the server was reached but could not answer, often an upstream problem for external names.\n- Timeout ("no servers could be reached"): the client cannot reach the DNS server. Check the DNS pods and the kube-dns Service endpoints in kube-system, and whether a NetworkPolicy denies egress to UDP and TCP 53.\n\n**Layer 2: Service address.** `curl -v http://CLUSTER_IP:8080/`. Do not use ping: a ClusterIP is a virtual address implemented by forwarding rules for the Service\'s ports and typically does not answer ICMP.\n- Connected: the Service path works; move to layer 4.\n- `Connection refused`: a RST came back. Either the backend has nothing listening on the targetPort, or (with kube-proxy in its common modes) the Service has no ready endpoints and the node rejects the connection. `kubectl get endpointslices -l kubernetes.io/service-name=inventory -n stock` settles it.\n- Timeout: packets are dropped somewhere. NetworkPolicy is the usual suspect; cross-node pod networking is the other.\n\n**Layer 3: pod address directly.** `curl -v http://POD_IP:TARGET_PORT/`.\n- Works while layer 2 fails: the fault is in the Service layer (selector, targetPort, endpoints, dataplane programming).\n- Refused: the process is not listening on that port or interface (check for a 127.0.0.1 bind).\n- Timeout: the path to that pod is dropping traffic. Compare with a pod on the same node versus a different node, and check policies selecting the destination.\n\n**Layer 4: application.** Any HTTP status means TCP worked. 5xx from the app: logs and its dependencies. 503 from a proxy or gateway with no upstream: back to endpoints. Slow responses: application latency or its downstreams, not the network.\n\n**Discipline.** Record each command and result, change one thing at a time, and do not restart pods before you have the evidence; a restart can hide the fault and destroys `--previous` logs.',
  followups: [
    { q: 'nslookup of the short name fails but the fully qualified name works. What does that tell you?', guidance: 'DNS is reachable and the record exists; the issue is search-domain expansion. Either the client is in a different namespace (short names resolve only in the client\'s own namespace), the pod\'s dnsPolicy or dnsConfig changed its search list, or the image\'s resolver handles search domains unusually. Use `<svc>.<ns>` or the full name.' },
    { q: 'DNS lookups sometimes take exactly 5 seconds, then succeed. What would you suspect?', guidance: 'A resolver timeout and retry: a first query was lost and retried after the default timeout. Causes include DNS pod overload, packet drops for UDP (including conntrack races on some kernels for parallel A/AAAA queries), or ndots expansion multiplying queries so one lost packet is likely. Look at DNS server metrics and logs and test query timing; mitigations include node-local DNS caching or reducing search expansion.' },
    { q: 'curl to the Service times out, curl to the pod IP works from the same node but times out from another node. Where are you now?', guidance: 'The application and Service are probably fine; cross-node pod networking is failing. Check the CNI agent on both nodes, node-to-node connectivity for the CNI\'s encapsulation or routing (firewalls between nodes, MTU), and whether a NetworkPolicy treats sources differently. The same-node versus cross-node comparison is the key evidence.' },
    { q: 'How would you teach this method to a new on-call engineer so it is repeatable?', guidance: 'Write a runbook with the four layers, the exact command at each, and a table of results to meaning (NXDOMAIN, DNS timeout, refused, timeout, HTTP code) plus the next step. Provide a standard debug image and emphasise testing from the client\'s namespace. Capture outputs in the incident record.' }
  ],
  misconceptions: [
    '"If DNS returns NXDOMAIN, the DNS server is down." NXDOMAIN is an answer; the server is reachable and the name is wrong or missing.',
    '"Ping the ClusterIP to test the Service." ClusterIPs typically do not answer ICMP; test the TCP port with curl or nc.',
    '"Connection refused and timeout mean the same thing." Refused means something actively rejected it (no listener, or no endpoints with typical proxies); timeout means packets were dropped (policy, routing).',
    '"An HTTP 500 is a network problem." Any HTTP response proves the network path worked; the failure is in the application or its dependencies.'
  ],
  weak: [
    'Tests only end to end and guesses the layer',
    'Tests from a different namespace or from outside the cluster and draws conclusions',
    'Restarts CoreDNS or the application before collecting any evidence',
    'Cannot interpret NXDOMAIN vs timeout or refused vs timeout'
  ],
  evidence: '# example output, run from a debug pod in namespace shop\n$ nslookup inventory.stock\nServer:    10.96.0.10\nName:      inventory.stock.svc.cluster.local\nAddress:   10.96.88.21            <- DNS works\n\n$ curl -sv --max-time 5 http://10.96.88.21:8080/healthz\n* connect to 10.96.88.21 port 8080 failed: Connection refused   <- rejected, not dropped\n\n$ kubectl -n stock get endpointslices -l kubernetes.io/service-name=inventory\nNAME              ADDRESSTYPE   PORTS     ENDPOINTS\ninventory-4hd8s   IPv4          <unset>   <unset>                 <- no ready backends\n\n$ kubectl -n stock get pods -l app=inventory -o wide\nNAME                        READY   STATUS    IP\ninventory-7b9c5d6f4-kx2lm   0/1     Running   10.244.2.31\n\n$ curl -sv --max-time 5 http://10.244.2.31:8080/healthz 2>&1 | grep "< HTTP"\n< HTTP/1.1 503 Service Unavailable   <- app is up but reports not ready',
  rubric: {
    strong: [
      'Uses the four-layer ladder (resolve, Service IP:port, pod IP:targetPort, application) in order',
      'Correctly interprets NXDOMAIN, DNS timeout, refused, timeout and HTTP status',
      'Tests from the client\'s namespace/labels and avoids ping on ClusterIPs',
      'Names the evidence command for each layer and records results before changing things'
    ],
    acceptable: [
      'Starts from the server side (pod works locally, then outward to Service, then DNS), if each layer is still isolated and interpreted correctly',
      'Uses dig, nc or wget instead of nslookup and curl'
    ],
    redFlags: [
      'Treats NXDOMAIN as the DNS server being down',
      'Restarts components before identifying the failing layer',
      'Concludes "network issue" from an HTTP 5xx response'
    ]
  },
  aws: { analogy: 'The same layering you would use in a VPC: does Route 53 / the VPC resolver return the right record, do security groups, NACLs and route tables let the TCP connection through to the target, and does the target respond with a healthy HTTP status.', breaks: 'The Service address is virtual and implemented by rules on every node rather than a real ENI, pod addresses come from the CNI, and a namespace changes what short names resolve to. There is also an extra hop to test (Service versus pod directly) with no plain-VPC equivalent.' },
  refs: [
    { t: 'Debug Services', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/' },
    { t: 'Debugging DNS resolution', u: 'https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/' },
    { t: 'Virtual IPs and service proxies', u: 'https://kubernetes.io/docs/reference/networking/virtual-ips/' }
  ],
  verify: 'That a Service with no ready endpoints rejects connections (refused) rather than dropping them depends on the proxy implementation and mode — confirm for the dataplane in use.'
},

{ id: 'ons-q-net-05', track: 'onsite', topic: 'net', priority: 'P1', level: 2, mins: 4,
  prereqs: ['les-request-path'],
  labs: [],
  q: 'How does cluster DNS resolution work for a pod?',
  context: 'A pod in namespace `shop` resolves `inventory`, `inventory.stock`, and `api.partner.example.com`. Explain what happens for each, why short names can cause extra queries, and what records a Service gets.',
  evaluates: [
    'Knows the kubelet writes resolv.conf with the cluster DNS Service IP, namespace-based search domains and ndots:5',
    'Can explain search expansion and why names with fewer than five dots are tried with suffixes first',
    'Knows Service record formats, headless records and that the cluster domain is configurable',
    'Knows non-cluster names are forwarded upstream'
  ],
  spoken: 'The kubelet writes the pod\'s /etc/resolv.conf. By default it points at the cluster DNS Service IP, sets search domains starting with the pod\'s own namespace, like shop.svc.cluster.local, then svc.cluster.local and cluster.local, and sets ndots to 5.\n\nndots:5 means any name with fewer than five dots is tried with each search domain before being tried as-is. So `inventory` becomes inventory.shop.svc.cluster.local, which only exists if the Service is in shop. `inventory.stock` becomes inventory.stock.svc.cluster.local on the second try, which works.\n\nThe cost shows up with external names: api.partner.example.com has three dots, so the resolver first tries it with each cluster suffix, gets NXDOMAIN each time, and only then asks for the real name. Often that is doubled for A and AAAA. A trailing dot, making it fully qualified, skips the search list.\n\nThe cluster DNS server answers cluster names from Services and endpoints: a normal Service gets a record pointing at its ClusterIP; a headless Service returns the ready pod IPs. Other names are forwarded to upstream resolvers. And cluster.local is only the default; the cluster domain is configurable.',
  deep: '**resolv.conf.** With the default `dnsPolicy: ClusterFirst`, the kubelet generates:\n`nameserver <cluster DNS Service IP>`\n`search <ns>.svc.<cluster-domain> svc.<cluster-domain> <cluster-domain> [node search domains]`\n`options ndots:5`\nOther policies: `Default` inherits the node\'s resolver; `ClusterFirstWithHostNet` is needed for hostNetwork pods that still want cluster DNS; `None` uses only `dnsConfig`. `dnsConfig` can add nameservers, searches and options such as a lower ndots.\n\n**Search expansion.** A resolver treats a name with fewer dots than `ndots` as relative: it tries each search suffix in order, then the name as given. A name ending in a dot is absolute and skips the list. Consequences:\n- `inventory` resolves only in the pod\'s own namespace (first suffix). That is why short names "work" in one namespace and not another.\n- `inventory.stock` succeeds on the second suffix.\n- `api.partner.example.com` generates several NXDOMAIN queries (one per suffix, often for both A and AAAA) before the real one. Under load this multiplies DNS traffic and lengthens tail latency; a lost UDP packet somewhere in the chain can add a resolver timeout.\nMitigations: use FQDNs with a trailing dot for hot external names, lower ndots per pod with `dnsConfig`, or run node-local DNS caching.\n\n**Records.** For the default domain:\n- ClusterIP Service: `<svc>.<ns>.svc.cluster.local` A/AAAA → ClusterIP.\n- Headless Service: the same name returns A/AAAA records for each ready pod; StatefulSet pods with a governing headless Service also get `<pod>.<svc>.<ns>.svc.cluster.local`.\n- Named ports get SRV records: `_<port>._<proto>.<svc>.<ns>.svc.cluster.local`.\n- ExternalName Service: a CNAME to the external name.\n\n**The server.** Cluster DNS (commonly CoreDNS, as an example) runs as pods behind a Service in kube-system, watches Services and EndpointSlices, answers the cluster zone, caches, and forwards everything else upstream, typically to the node\'s resolvers. The cluster domain is set in the kubelet and DNS configuration; do not hardcode `cluster.local` in applications if you can use short or namespace-qualified names.',
  followups: [
    { q: 'Why might a Java or Go service see different DNS behaviour from the same pod\'s nslookup?', guidance: 'Language runtimes may use their own resolver implementations, caching and TTL handling (for example long or infinite caching in some JVM configurations). The OS tool uses libc or its own logic. So a client can keep using stale IPs, or ignore search options, even when nslookup looks correct.' },
    { q: 'You see thousands of NXDOMAIN queries for names like api.partner.example.com.shop.svc.cluster.local. What is happening and what are your options?', guidance: 'Search expansion due to ndots:5. Options: use a trailing-dot FQDN in config, set a lower ndots in the pod\'s dnsConfig (accepting that short cluster names then need more qualification), and add node-local DNS caching. Measure before and after.' },
    { q: 'How does a headless Service change what the client sees, and why would you choose it?', guidance: 'DNS returns the individual ready pod IPs instead of a single virtual IP, so the client connects directly and does its own load balancing or peer discovery. Used for StatefulSet peer discovery, databases and clients with connection-aware balancing (for example gRPC). Trade-off: client DNS caching can leave it with stale IPs.' }
  ],
  misconceptions: [
    '"Kubernetes DNS is a special network feature." It is a DNS server running as pods, found through a normal Service IP written into each pod\'s resolv.conf.',
    '"Short names resolve across the cluster." A bare name resolves only in the pod\'s own namespace; use `<svc>.<ns>` elsewhere.',
    '"cluster.local is fixed." It is the default cluster domain and can be configured.',
    '"External lookups go straight upstream." With ndots:5, names with fewer than five dots are first tried against every cluster search suffix.'
  ],
  weak: [
    'Cannot describe resolv.conf contents',
    'Does not know why namespace matters for short names',
    'Has never considered the query amplification from ndots'
  ],
  evidence: '# example output\n$ kubectl -n shop exec deploy/web -- cat /etc/resolv.conf\nsearch shop.svc.cluster.local svc.cluster.local cluster.local\nnameserver 10.96.0.10\noptions ndots:5\n\n$ kubectl -n shop exec deploy/toolbox -- nslookup inventory\n** server can\'t find inventory.shop.svc.cluster.local: NXDOMAIN\n\n$ kubectl -n shop exec deploy/toolbox -- nslookup inventory.stock\nName:    inventory.stock.svc.cluster.local\nAddress: 10.96.88.21\n\n# cluster DNS query log (if query logging is enabled), one lookup of an external name\n"A IN api.partner.example.com.shop.svc.cluster.local." NXDOMAIN\n"A IN api.partner.example.com.svc.cluster.local." NXDOMAIN\n"A IN api.partner.example.com.cluster.local." NXDOMAIN\n"A IN api.partner.example.com." NOERROR',
  rubric: {
    strong: [
      'Describes resolv.conf: cluster DNS nameserver, namespace-first search list, ndots:5',
      'Explains search expansion with the three example names correctly',
      'Explains the extra-query cost for external names and mitigations (trailing dot, dnsConfig ndots, local caching)',
      'Knows ClusterIP vs headless records, and that the cluster domain is configurable'
    ],
    acceptable: [
      'Explains via a debugging story (short name fails from another namespace) with the correct mechanism',
      'Names a specific DNS server implementation as an example rather than generically'
    ],
    redFlags: [
      'Claims short names resolve across all namespaces',
      'Says NXDOMAIN on a search suffix means DNS is broken',
      'Hardcodes the cluster domain as a universal fact'
    ]
  },
  aws: { analogy: 'The VPC resolver (Route 53 Resolver) with private hosted zones, plus search domains handed out by a DHCP option set; forwarding rules send other names to upstream resolvers.', breaks: 'The cluster DNS server runs as ordinary pods inside the cluster, records are generated automatically from Services and EndpointSlices, and ndots:5 with namespace-first search domains creates query patterns you rarely meet in a plain VPC.' },
  refs: [
    { t: 'DNS for Services and Pods', u: 'https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/' },
    { t: 'Debugging DNS resolution', u: 'https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/' },
    { t: 'Customizing DNS service', u: 'https://kubernetes.io/docs/tasks/administer-cluster/dns-custom-nameservers/' }
  ],
  verify: ''
},

{ id: 'ons-q-net-06', track: 'onsite', topic: 'net', priority: 'P1', level: 2, mins: 5,
  prereqs: ['les-request-path', 'ons-q-net-01'],
  labs: [],
  q: 'Walk the packet path from a client pod to a Service\'s backend pod.',
  context: 'Client pod on node A calls `http://web.shop:80`. The chosen backend pod runs on node B and listens on 8080. Describe each step, including what happens on the return path, and where the Service\'s "load balancing" actually happens.',
  evaluates: [
    'Knows the ClusterIP is virtual and implemented by rules on each node (kube-proxy modes or an alternative dataplane)',
    'Describes DNAT to a selected pod IP:targetPort on the client\'s node, and conntrack for the connection',
    'Describes pod-to-pod delivery across nodes via the CNI (routing or encapsulation)',
    'Knows balancing is per connection, not per request'
  ],
  spoken: 'First the client resolves web.shop through cluster DNS and gets the ClusterIP, say 10.96.41.12.\n\nThe client sends a TCP SYN to 10.96.41.12 port 80. No interface anywhere owns that address. On node A, rules programmed by kube-proxy, in iptables, IPVS or nftables mode, or by an eBPF dataplane depending on the cluster, match the Service IP and port, pick one ready backend from the EndpointSlices, and rewrite the destination to that pod\'s IP and port 8080. That is DNAT, and it happens on the client\'s node.\n\nConntrack records the translation so every packet of this connection goes to the same backend.\n\nNow it is ordinary pod-to-pod traffic. The CNI gets it from node A to node B, either by routing pod CIDRs, by encapsulating it in an overlay, or by using addresses the underlying network already routes. On node B it is delivered to the pod\'s interface. The backend usually sees the client pod\'s real IP.\n\nReplies go back to the client pod, and conntrack on node A reverses the translation so the client sees them coming from the ClusterIP.\n\nThe key point: balancing is per connection. A long-lived HTTP/2 or gRPC connection stays pinned to one pod.',
  deep: '**1. Resolution.** The client\'s resolver queries cluster DNS (see ons-q-net-05) and gets the Service\'s ClusterIP. A headless Service would return pod IPs and skip step 2 entirely.\n\n**2. Virtual IP handling on the client\'s node.** A ClusterIP is not bound to any interface; it exists only as matching rules in each node\'s dataplane. kube-proxy watches Services and EndpointSlices and programs rules in one of its modes (iptables, IPVS, nftables; the default and recommendations vary by version), or the cluster replaces kube-proxy with a different implementation such as an eBPF-based dataplane. For the first packet of a connection, the rule for `10.96.41.12:80/TCP` selects one ready endpoint (for example randomly in iptables mode) and DNATs the destination to `10.244.2.14:8080`.\n\n**3. Connection tracking.** The kernel\'s conntrack table records the original and translated tuples. Subsequent packets of that connection skip selection and follow the entry. This is why balancing is per connection, why a pod removed from endpoints can still receive packets on existing connections, and why a full conntrack table causes drops that look like random timeouts.\n\n**4. Pod-to-pod delivery.** The Kubernetes network model requires that pods can reach each other by pod IP without NAT. How is up to the CNI plugin: routing each node\'s pod CIDR via the underlying network or BGP, encapsulating in an overlay (VXLAN, Geneve or similar, which adds header bytes and reduces the effective MTU), or assigning addresses the underlying network routes natively. On node B the packet reaches the pod\'s veth or equivalent interface.\n\n**5. Source address.** For pod-to-ClusterIP traffic inside the cluster, the backend usually sees the client pod\'s IP. Some paths add SNAT (for example external traffic via NodePort, depending on `externalTrafficPolicy`, or hairpin traffic when a pod calls its own Service), and implementations differ.\n\n**6. Return path.** The backend replies to the client pod IP. The reply crosses back through the CNI to node A, where conntrack matches it and reverses the DNAT, rewriting the source to the ClusterIP and port 80, so the client\'s socket sees a reply from the address it called.\n\n**Diagnostic hooks at each step.** DNS: `nslookup`. Rules: `iptables-save | grep <ClusterIP>` or `nft list ruleset` or the dataplane\'s own tooling on the node. Conntrack: `conntrack -L -d <ClusterIP>`. Pod network: curl the pod IP from the same node versus another node. These need node access, which you may not have in every environment, so the pod-level tests matter most.',
  followups: [
    { q: 'A gRPC service with 5 replicas shows one pod at 90% CPU and the rest idle. Why, given the Service balances traffic?', guidance: 'Service balancing is per connection. gRPC multiplexes many requests over a long-lived HTTP/2 connection, so a client with one connection sends everything to one pod. Fixes: client-side load balancing with a headless Service, a proxy or mesh that balances per request, or periodic connection recycling.' },
    { q: 'What changes if the cluster uses an eBPF-based dataplane instead of kube-proxy with iptables?', guidance: 'Service translation may happen earlier (for example at the socket level on connect) and without iptables rules or even conntrack for some paths, so node-level tools differ. The observable model, Service IP to a selected ready backend, is the same. You debug with the dataplane\'s own tools.' },
    { q: 'Where on this path could an MTU problem show up, and what would it look like?', guidance: 'In the cross-node step when encapsulation adds headers and the pod interface MTU was not reduced to match. Small requests and TCP handshakes succeed, while large responses stall or time out, often only cross-node. Test with large payloads same-node versus cross-node and check the MTU configured on pod interfaces versus node interfaces.' }
  ],
  misconceptions: [
    '"The ClusterIP is a load balancer somewhere in the cluster." It is a virtual address; each client\'s node rewrites the destination to a chosen pod.',
    '"The Service balances every request." It selects a backend per connection; requests on a kept-alive connection go to the same pod.',
    '"kube-proxy is in the data path as a proxy process." In its common modes it only programs kernel rules; packets do not pass through the kube-proxy process.',
    '"Pod traffic between nodes is always NATed." The network model requires pod-to-pod communication without NAT; SNAT appears only on specific paths.'
  ],
  weak: [
    'Skips from "calls the Service" to "reaches the pod" with no mechanism',
    'Presents iptables as the only possible implementation',
    'Ignores the return path and conntrack'
  ],
  evidence: '# example output (node access required; iptables mode shown as one example)\n$ kubectl -n shop get svc web\nNAME   TYPE        CLUSTER-IP    PORT(S)\nweb    ClusterIP   10.96.41.12   80/TCP\n\n$ sudo iptables-save | grep -E "10.96.41.12|KUBE-SEP-ABC"\n-A KUBE-SERVICES -d 10.96.41.12/32 -p tcp -m comment --comment "shop/web:http cluster IP" -m tcp --dport 80 -j KUBE-SVC-4N57TFCL4MD7ZTDA\n-A KUBE-SVC-4N57TFCL4MD7ZTDA -m statistic --mode random --probability 0.50000 -j KUBE-SEP-ABC\n-A KUBE-SEP-ABC -p tcp -m tcp -j DNAT --to-destination 10.244.2.14:8080\n\n$ sudo conntrack -L -d 10.96.41.12\ntcp 6 86390 ESTABLISHED src=10.244.1.7 dst=10.96.41.12 sport=51234 dport=80 src=10.244.2.14 dst=10.244.1.7 sport=8080 dport=51234 [ASSURED]',
  rubric: {
    strong: [
      'States the ClusterIP is virtual and implemented on each node by kube-proxy rules or an alternative dataplane (hedged)',
      'Describes DNAT on the client\'s node to a ready pod IP:targetPort and conntrack keeping the connection pinned',
      'Explains cross-node delivery by the CNI (routing, overlay or native addressing)',
      'Describes the return path with reverse translation',
      'Notes per-connection balancing and its consequence'
    ],
    acceptable: [
      'Describes one proxy mode in detail while acknowledging others exist',
      'Focuses on pod-level tests rather than node internals, if the mechanism is stated correctly'
    ],
    redFlags: [
      'Claims packets flow through a central load balancer or through the kube-proxy process',
      'Says every request is balanced independently regardless of connection reuse',
      'Claims pod-to-pod traffic is always NATed'
    ]
  },
  aws: { analogy: 'Something like an internal NLB in front of targets: a stable address, connection-level balancing, and flow tracking so replies return correctly.', breaks: 'There is no central load balancer: the translation happens in each client\'s own node kernel, from state the node learned from EndpointSlices. Pod-to-pod delivery depends on the CNI, which may or may not use VPC routing.' },
  refs: [
    { t: 'Virtual IPs and service proxies', u: 'https://kubernetes.io/docs/reference/networking/virtual-ips/' },
    { t: 'Cluster networking (network model)', u: 'https://kubernetes.io/docs/concepts/cluster-administration/networking/' },
    { t: 'Service', u: 'https://kubernetes.io/docs/concepts/services-networking/service/' }
  ],
  verify: 'The default kube-proxy mode and recommended modes change across versions (iptables remains the default in recent releases, with nftables the documented future default) — confirm for your cluster.'
},

{ id: 'ons-q-net-07', track: 'onsite', topic: 'net', priority: 'P1', level: 2, mins: 3,
  prereqs: ['les-services'],
  labs: [],
  q: 'What Service types exist, and does creating a Service give you an external load balancer?',
  context: 'A teammate creates a `type: LoadBalancer` Service on a local kind cluster and on a bare-metal cluster, and in both cases EXTERNAL-IP stays `<pending>`. Explain the Service types and why this happens.',
  evaluates: [
    'Knows ClusterIP, NodePort, LoadBalancer, ExternalName and headless Services and what each adds',
    'Knows only type LoadBalancer requests an external load balancer, and only a controller for the environment fulfils it',
    'Can explain `<pending>` and how to fix it in a lab versus production'
  ],
  spoken: 'ClusterIP is the default: a virtual IP reachable inside the cluster. NodePort adds a port on every node that forwards to the Service. LoadBalancer adds a request for an external load balancer on top of that. ExternalName is only a DNS CNAME to an outside name, with no proxying. And a headless Service, clusterIP None, has no virtual IP; DNS returns pod IPs.\n\nSo no, creating a Service does not give you a load balancer. Only type LoadBalancer asks for one, and Kubernetes itself does not build it. A controller for that environment has to watch for LoadBalancer Services, provision something, and write its address into the Service status. In a cloud, that is usually the cloud provider\'s controller. On bare metal you install something that allocates addresses, and on kind there is a separate helper for it.\n\nWithout a controller, nothing happens and EXTERNAL-IP stays pending forever, with no error. The Service still works as a ClusterIP and NodePort in the meantime, so for a lab I can port-forward or use the node port.',
  deep: '**Types.**\n- `ClusterIP` (default): allocates a virtual IP from the Service CIDR, reachable from within the cluster.\n- `NodePort`: ClusterIP plus a port (default range 30000–32767) on every node that forwards to the Service.\n- `LoadBalancer`: NodePort (usually) plus a request for an external load balancer. The spec is a request; `status.loadBalancer.ingress` is filled in by whichever controller implements it.\n- `ExternalName`: returns a CNAME to `spec.externalName`. No ClusterIP, no proxying, no port translation.\n- Headless (`clusterIP: None`, with any selector or none): no virtual IP; DNS returns ready pod addresses.\n\n**Who creates the load balancer.** Kubernetes core does not talk to any cloud. A cloud controller manager or another controller (in-cluster, for example a bare-metal load-balancer implementation, or an external helper like the one kind documents) watches Services of type LoadBalancer, provisions a load balancer or allocates an address, and updates status. Behaviour (which ports, health checks, whether it targets node ports or pod IPs, internal vs internet-facing) is implementation-specific and usually tuned with annotations or `loadBalancerClass`.\n\n**`<pending>`.** Means no controller has fulfilled the request: none installed, it lacks permissions or quota, or `loadBalancerClass` names an implementation that is not running. `kubectl describe svc` events show the controller\'s errors if one exists; no events at all usually means no controller.\n\n**Traffic policy.** `externalTrafficPolicy: Cluster` (default) lets any node forward to any pod, possibly SNATing and losing the client IP; `Local` sends only to pods on the receiving node, preserving the client IP, and relies on load-balancer health checks to avoid nodes with no local pod.\n\n**Lab versus production.** In kind, use `kubectl port-forward`, a NodePort with port mappings, or the kind-documented load-balancer helper. In production, the choice of load-balancer controller, its annotations and its failure modes are platform decisions to learn early.',
  followups: [
    { q: 'A LoadBalancer Service has an external IP, but clients get timeouts. What do you check?', guidance: 'Whether endpoints exist and are ready; load balancer health checks against node ports (especially with externalTrafficPolicy Local on nodes without pods); firewall or security rules between the load balancer and nodes; and the controller\'s events. Then test the NodePort directly from inside the network.' },
    { q: 'Why might you prefer one Ingress or Gateway in front of many ClusterIP Services over a LoadBalancer Service per app?', guidance: 'One external load balancer and address shared across many apps, L7 routing by host and path, central TLS termination and policy, and lower cost and quota use. Trade-offs: shared blast radius and one more controller to operate.' },
    { q: 'What is ExternalName useful for, and what is a gotcha?', guidance: 'Giving an external dependency a cluster-local name so apps do not hardcode it, and switching it later. Gotchas: it is only a CNAME, so ports are not remapped, and TLS clients may reject the certificate if they validate against the in-cluster name rather than the real one.' }
  ],
  misconceptions: [
    '"Every Service gets an external load balancer." Only type LoadBalancer requests one.',
    '"type LoadBalancer always works." It needs a controller for that environment; without one EXTERNAL-IP stays <pending> with no error.',
    '"ExternalName proxies traffic." It only returns a DNS CNAME.'
  ],
  weak: [
    'Cannot explain <pending>',
    'Thinks the Service type is changed to fix a selector problem',
    'Assumes behaviour of one cloud\'s load balancer is universal'
  ],
  evidence: '# example output (kind or bare metal with no load-balancer controller)\n$ kubectl -n shop get svc web-public\nNAME         TYPE           CLUSTER-IP     EXTERNAL-IP   PORT(S)\nweb-public   LoadBalancer   10.96.201.4    <pending>     80:31080/TCP\n\n$ kubectl -n shop describe svc web-public | tail -2\nEvents:            <none>\n\n# the Service still works internally and via the node port\n$ kubectl -n shop port-forward svc/web-public 8080:80\nForwarding from 127.0.0.1:8080 -> 8080',
  rubric: {
    strong: [
      'Lists ClusterIP, NodePort, LoadBalancer, ExternalName and headless correctly',
      'States only LoadBalancer requests an external load balancer, fulfilled by an environment-specific controller',
      'Explains <pending> and how to confirm there is no controller',
      'Offers lab workarounds and notes production choices are platform-specific'
    ],
    acceptable: [
      'Describes the cloud controller manager specifically, if framed as one implementation',
      'Omits headless but covers the rest precisely'
    ],
    redFlags: [
      'Says creating any Service provisions an external load balancer',
      'Claims pending means the pods are unhealthy',
      'Assumes a specific cloud provider'
    ]
  },
  aws: { analogy: 'Creating an ELB for a service: in ECS you create the ALB or NLB yourself (or via CloudFormation) and attach the service to a target group.', breaks: 'In Kubernetes you only declare the request on the Service; a controller running for that environment creates the load balancer. Where no such controller exists (kind, bare metal), nothing is created and nothing errors.' },
  refs: [
    { t: 'Service (types)', u: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
    { t: 'Create an external load balancer', u: 'https://kubernetes.io/docs/tasks/access-application-cluster/create-external-load-balancer/' },
    { t: 'kind: LoadBalancer', u: 'https://kind.sigs.k8s.io/docs/user/loadbalancer/' }
  ],
  verify: ''
},

{ id: 'ons-q-net-08', track: 'onsite', topic: 'net', priority: 'P1', level: 2, mins: 4,
  prereqs: ['les-services', 'ons-q-net-07'],
  labs: [],
  q: 'How do Ingress (and the Gateway API) differ from a Service?',
  context: 'A team wants `shop.example.com/api` and `shop.example.com/` routed to two different backends with TLS. They create an Ingress resource and nothing happens. Explain what Ingress and Gateway API are, how they relate to Services, and why nothing happened.',
  evaluates: [
    'Knows Services are L4 (IP and port) while Ingress and Gateway routes express L7 HTTP rules (host, path, headers)',
    'Knows Ingress and Gateway resources require a controller; without one nothing happens',
    'Knows TLS termination and IngressClass/GatewayClass selection',
    'Can describe what Gateway API adds (role separation, richer routing) at a high level'
  ],
  spoken: 'A Service works at layer 4: a stable IP and port that forwards connections to selected pods. It knows nothing about hostnames, paths or headers.\n\nAn Ingress is a set of HTTP routing rules: this host and path go to that Service and port, and terminate TLS with this certificate Secret. But the Ingress object is only configuration. An Ingress controller, which is a proxy running in the cluster, watches Ingress objects and configures itself. The controller is usually exposed through a LoadBalancer or NodePort Service, and it often sends traffic straight to pod IPs from the EndpointSlices.\n\nSo if nothing happened, the first question is whether there is a controller at all, and whether the Ingress\'s class matches one. No controller means no address and no routing, and no error.\n\nGateway API is the newer, more expressive model, which the project now recommends over Ingress. It splits roles: a GatewayClass describes an implementation, a Gateway is the actual listener that platform owners manage, and HTTPRoutes are what app teams attach. It supports header matching, traffic splitting and cross-namespace references with explicit permission. It also needs an implementation installed.',
  deep: '**Layers.** A Service gives a virtual IP and port and forwards TCP/UDP connections. HTTP concepts (Host header, path, headers, TLS SNI) are invisible to it. L7 routing needs a proxy that terminates the connection and makes a decision per request.\n\n**Ingress.** An API object with rules: hosts, paths (with `pathType` Exact, Prefix or ImplementationSpecific), backends (a Service name and port), and TLS sections referencing Secrets. `ingressClassName` selects which controller should implement it. The controller (an in-cluster proxy, or a controller that configures an external load balancer) watches Ingresses, Services and EndpointSlices, and programs routing. Many controllers route directly to pod IPs rather than via the ClusterIP. Features beyond the basics (rewrites, timeouts, auth) are usually controller-specific annotations, which makes Ingress manifests less portable. The Ingress API is frozen: still supported, but new features go into Gateway API.\n\n**Gateway API.** An add-on set of resources:\n- `GatewayClass`: an implementation, typically provided by the infrastructure team or vendor.\n- `Gateway`: a concrete listener (addresses, ports, protocols, TLS), usually owned by platform operators.\n- `HTTPRoute` / `GRPCRoute` and others: routing rules owned by application teams, attaching to a Gateway.\nIt supports header and method matching, weighted backends for traffic splitting, and cross-namespace references that must be explicitly allowed (ReferenceGrant). The role split maps well to platform teams versus app teams.\n\n**Why nothing happened.** No controller installed; `ingressClassName` names a class no controller serves (or no default class); the controller watches only certain namespaces; the backend Service name or port is wrong (controller logs or events show it); or the controller\'s own Service is `<pending>` because there is no load-balancer controller. Check: `kubectl get ingressclass`, `kubectl describe ingress` (ADDRESS and events), the controller\'s pods and logs.\n\n**Service still matters.** Both Ingress and Gateway routes point at Services, whose selectors and readiness still define the backend set.',
  followups: [
    { q: 'Where would you terminate TLS, and what are the trade-offs?', guidance: 'At the Ingress/Gateway (central certificates, simpler apps, L7 routing possible; traffic inside the cluster is plaintext unless re-encrypted), passthrough to the pods (end-to-end encryption, but no L7 routing at the proxy), or re-encrypt (terminate and open a new TLS connection to the backend). Choice depends on compliance and who owns certificates.' },
    { q: 'The Ingress has an address but returns 503 for /api. What do you check?', guidance: 'The backend Service for that path: does it exist in the same namespace, is the port right, does it have ready endpoints. Then path matching (pathType, trailing slashes, rewrites) and controller logs, which usually say "no endpoints" or "service not found".' },
    { q: 'Why might a platform team prefer Gateway API over Ingress for a multi-tenant cluster?', guidance: 'Role separation: the platform team owns Gateways (addresses, TLS, listeners) while app teams own routes in their namespaces, with explicit cross-namespace permission. Richer standard features reduce reliance on controller-specific annotations. Trade-off: more resources to learn and implementations vary in conformance.' }
  ],
  misconceptions: [
    '"Creating an Ingress exposes my app." Without a matching controller, an Ingress object has no effect.',
    '"Ingress replaces Services." Ingress and Gateway routes reference Services as backends; selectors and readiness still matter.',
    '"Ingress annotations are standard." Most annotations are controller-specific and not portable.',
    '"Gateway API is built into every cluster." It is an add-on API that needs CRDs and an implementation installed.'
  ],
  weak: [
    'Treats Ingress as another Service type',
    'Cannot explain what component actually receives traffic',
    'Does not check for a controller or class when nothing happens'
  ],
  evidence: '# example output\n$ kubectl get ingressclass\nNo resources found\n\n$ kubectl -n shop get ingress shop\nNAME   CLASS    HOSTS              ADDRESS   PORTS     AGE\nshop   <none>   shop.example.com             80, 443   9m\n\n$ kubectl -n shop describe ingress shop | grep -A3 Rules\nRules:\n  Host              Path  Backends\n  shop.example.com  /api  api:8080 (10.244.1.40:8080,10.244.3.12:8080)\n                    /     web:80 (10.244.1.23:8080,10.244.2.14:8080)\n\n$ kubectl get gatewayclass\nerror: the server doesn\'t have a resource type "gatewayclass"   <- Gateway API CRDs not installed',
  rubric: {
    strong: [
      'Contrasts L4 Service with L7 host/path routing in Ingress and Gateway routes',
      'States a controller is required and nothing happens without one; mentions IngressClass matching',
      'Mentions TLS termination via Secrets',
      'Describes Gateway API roles (GatewayClass, Gateway, routes) and extra capabilities at a high level',
      'Gives a concrete check sequence for "nothing happened"'
    ],
    acceptable: [
      'Uses a specific controller as an example, framed as one implementation',
      'Covers Ingress well and Gateway API briefly'
    ],
    redFlags: [
      'Says the Ingress object itself proxies traffic',
      'Claims Ingress removes the need for Services',
      'Assumes a particular controller exists in every cluster'
    ]
  },
  aws: { analogy: 'ALB listener rules routing by host and path to different target groups, with ACM certificates on the listener.', breaks: 'The Ingress or Gateway object is only a routing request; a controller you install either runs the proxy in-cluster or configures an external load balancer. Features vary by controller, and without one the object does nothing.' },
  refs: [
    { t: 'Ingress', u: 'https://kubernetes.io/docs/concepts/services-networking/ingress/' },
    { t: 'Ingress controllers', u: 'https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/' },
    { t: 'Gateway API', u: 'https://kubernetes.io/docs/concepts/services-networking/gateway/' }
  ],
  verify: ''
},

{ id: 'ons-q-net-09', track: 'onsite', topic: 'net', priority: 'P1', level: 2, mins: 5,
  prereqs: ['les-netpol'],
  labs: [],
  q: 'Do namespaces isolate network traffic? How would you actually restrict it?',
  context: 'Two teams share a cluster: `payments` and `marketing`, each in its own namespace. Security asks whether marketing pods can reach payments pods. Answer, then describe how you would restrict traffic and prove it works.',
  evaluates: [
    'States clearly that namespaces do not isolate network traffic by default',
    'Explains NetworkPolicy semantics: pods are non-isolated until selected; policies are additive allow-lists; ingress and egress independent',
    'Knows enforcement depends on the CNI, and a non-enforcing CNI silently ignores policies',
    'Designs default-deny plus explicit allows, including DNS egress, and tests them'
  ],
  spoken: 'No. By default any pod can reach any other pod\'s IP across namespaces. A namespace is a scope for names, RBAC and quotas, not a network boundary.\n\nThe Kubernetes way to restrict traffic is NetworkPolicy. A pod is unrestricted until at least one policy selects it for ingress or egress; after that, only what some policy allows gets through. Policies are allow-lists and they add together.\n\nThe important caveat: NetworkPolicy is only an API object. The CNI plugin enforces it. If the cluster\'s CNI does not implement it, the policies are accepted and silently do nothing.\n\nFor payments, I\'d start with a default-deny policy in that namespace selecting all pods for both ingress and egress. Then add explicit allows: ingress from the specific namespaces and labels that need it, for example the gateway namespace to the API pods on 8443. For egress, allow DNS to the cluster DNS pods on UDP and TCP 53, otherwise everything breaks in confusing ways, and then the specific dependencies.\n\nThen I prove it: from a marketing pod, a connection to payments should time out; from the allowed client it should succeed; and DNS should still resolve.',
  deep: '**Namespaces are not a network boundary.** The Kubernetes network model gives every pod a routable IP and lets pods reach each other without NAT. Namespaces scope names, RBAC, quotas and policies, but no traffic filtering happens because of them.\n\n**NetworkPolicy semantics.**\n- `podSelector` chooses which pods in the policy\'s namespace the policy applies to (`{}` = all pods in the namespace).\n- `policyTypes` says whether it applies to Ingress, Egress or both.\n- A pod is isolated for a direction once any policy selecting it includes that direction. Isolated pods accept only traffic allowed by the union of all applicable rules. Non-isolated pods accept everything.\n- Rules select peers with `podSelector`, `namespaceSelector` (often on the automatic `kubernetes.io/metadata.name` label), both combined in one entry (AND), or `ipBlock`, plus ports.\n- There are no deny rules and no priorities in the core API; you deny by isolating and not allowing. Reply traffic for allowed connections is permitted.\n- For a connection to succeed, the source\'s egress and the destination\'s ingress must both allow it.\n\n**Enforcement.** The API server stores NetworkPolicies regardless of whether anything enforces them. Enforcement is done by the CNI plugin (or a policy agent alongside it). With a plugin that does not support NetworkPolicy, policies silently have no effect, so testing is mandatory. Some CNIs add their own cluster-wide or L7 policy CRDs, which are implementation-specific.\n\n**A reasonable baseline for payments.**\n1. Default deny: `podSelector: {}`, `policyTypes: [Ingress, Egress]`.\n2. Allow DNS egress: to pods labelled as the cluster DNS in kube-system (the label depends on how DNS is deployed), UDP and TCP 53.\n3. Allow ingress to the API pods from the gateway namespace and specific client labels on specific ports.\n4. Allow egress to specific dependencies (database pods, or `ipBlock` for external services).\n5. Roll out carefully: apply allows first, observe, then default deny; do it namespace by namespace.\n\n**Proof.** From a pod in marketing: `curl --max-time 3` to a payments pod IP should time out (denied traffic is typically dropped). From an allowed client: success. From a payments pod: DNS resolves; an unapproved external host times out. Keep these as a repeatable test, because a CNI change or a label change can silently alter results.',
  followups: [
    { q: 'You applied default-deny and now everything in the namespace fails, including calls that should be allowed. What did you probably forget?', guidance: 'DNS egress. With egress isolation, pods cannot reach the cluster DNS server, so every name lookup times out and it looks like the application is broken. Also check that allow rules match actual labels and that both sides (source egress and destination ingress) allow the flow.' },
    { q: 'How do you confirm the CNI actually enforces NetworkPolicy?', guidance: 'Test it: create a default-deny in a test namespace and verify a previously working connection now times out, then allow it and verify it works. Check the CNI documentation and whether its policy components are running. Never assume enforcement from the existence of policy objects.' },
    { q: 'What can NetworkPolicy not do that you might need?', guidance: 'Core NetworkPolicy has no explicit deny or priority, no cluster-wide default policy across all namespaces, no L7 rules (paths, methods), no logging of drops by itself, and no FQDN-based egress. Those come from CNI-specific extensions, newer admin-level policy APIs where available, or a service mesh.' }
  ],
  misconceptions: [
    '"Namespaces isolate traffic." They do not; NetworkPolicy does, and only if the CNI enforces it.',
    '"Creating a NetworkPolicy always has an effect." Without an enforcing CNI plugin, policies are stored but ignored, with no error.',
    '"A policy allowing X means everything else is still allowed." Once a policy selects a pod for a direction, everything not allowed by some policy is denied for that pod.',
    '"NetworkPolicy works like a security group with deny rules." The core API has only allow rules; denial comes from isolation.'
  ],
  weak: [
    'Answers "yes, namespaces isolate teams"',
    'Designs default deny without DNS egress',
    'Never tests the policy or mentions CNI enforcement',
    'Uses namespaceSelector and podSelector without understanding AND versus OR semantics'
  ],
  evidence: '# example manifests and output\n$ cat default-deny.yaml\napiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata: {name: default-deny, namespace: payments}\nspec:\n  podSelector: {}\n  policyTypes: [Ingress, Egress]\n\n$ cat allow-dns.yaml   # DNS pod label depends on how cluster DNS is deployed\nspec:\n  podSelector: {}\n  policyTypes: [Egress]\n  egress:\n  - to:\n    - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: kube-system}}\n      podSelector: {matchLabels: {k8s-app: kube-dns}}\n    ports: [{protocol: UDP, port: 53}, {protocol: TCP, port: 53}]\n\n$ kubectl -n marketing exec deploy/toolbox -- curl -s --max-time 3 http://10.244.3.17:8443/ ; echo "exit=$?"\nexit=28     # timed out: dropped by policy (curl exit 28 = timeout)',
  rubric: {
    strong: [
      'States namespaces do not isolate traffic',
      'Explains isolation-on-selection and additive allow semantics for ingress and egress',
      'Stresses CNI enforcement and silent no-op without it',
      'Proposes default deny plus explicit allows including DNS egress',
      'Describes how to test positive and negative cases'
    ],
    acceptable: [
      'Proposes CNI-specific or cluster-wide policy extensions, framed as implementation-specific additions',
      'Mentions a service mesh for L7 authorization as a complement, not a replacement'
    ],
    redFlags: [
      'Claims namespaces provide network isolation',
      'Assumes policies are enforced without testing',
      'Designs rules that would block DNS without noticing'
    ]
  },
  aws: { analogy: 'Security groups on ENIs (and NACLs on subnets).', breaks: 'Security groups deny inbound by default and are always enforced by AWS; NetworkPolicy allows everything until a policy selects a pod, selects peers by labels rather than group IDs, has no explicit deny in the core API, and depends on the CNI to enforce it at all. A namespace is not a subnet or a VPC.' },
  refs: [
    { t: 'Network policies', u: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/' },
    { t: 'Declare network policy', u: 'https://kubernetes.io/docs/tasks/administer-cluster/declare-network-policy/' },
    { t: 'Cluster networking', u: 'https://kubernetes.io/docs/concepts/cluster-administration/networking/' }
  ],
  verify: ''
},

{ id: 'ons-q-net-10', track: 'onsite', topic: 'net', priority: 'P1', level: 3, mins: 7,
  prereqs: ['les-request-path', 'ons-q-net-04', 'ons-q-net-06'],
  labs: [],
  q: 'A request between two pods on different nodes intermittently times out. How do you narrow it down?',
  context: 'Service `orders` calls `inventory`. About 2% of requests time out after 30 seconds; the rest are fast. Pods are Ready, nothing is crash-looping, and no one has changed anything obvious. You have kubectl access and can get node access if you justify it.',
  evaluates: [
    'Characterises "intermittent" before acting: which sources, destinations, nodes, sizes and times',
    'Uses comparisons (same node vs cross node, Service vs pod IP, per backend) to isolate the fault',
    'Knows likely mechanisms: one bad backend, MTU/encapsulation, CNI agent issues, conntrack exhaustion, DNS timeouts, policy differences',
    'Collects evidence and avoids broad restarts that destroy it'
  ],
  spoken: 'Intermittent usually means "some specific subset", so my first job is to find the subset. I don\'t restart anything yet, because that can hide it.\n\nI\'d pull the failing requests and ask: which client pods, which backend pod IPs, which nodes, what payload sizes, and is it the connect or the response that hangs? With Services, 2% failures often means one backend out of many is bad, because balancing is per connection. So I check each backend directly by pod IP.\n\nThen I compare paths. Same-node versus cross-node: if only cross-node fails, it is the pod network, not the app. Small versus large payloads: if handshakes work but large responses stall, suspect MTU with overlay encapsulation. Specific node pair: suspect that node\'s CNI agent or the network between those nodes.\n\nI also separate DNS from TCP: DNS timeouts show as delays before the connection even starts, often around 5 seconds.\n\nIf I need node access, I look at CNI agent health, kernel logs for conntrack table full, and interface MTUs. Each hypothesis gets a test that can prove it wrong, and I only change one thing once I have evidence.',
  deep: '**1. Characterise before you touch anything.** Collect from logs, traces or metrics: timestamps, client pod, destination pod IP (not just the Service name), node of each, request and response size, and where the time goes (DNS, connect, first byte, transfer). Check for correlations: one backend pod, one node, one node pair, large responses, a time pattern, a recent node addition or CNI upgrade. Write down what "normal" looks like for comparison.\n\n**2. Candidate mechanisms and the test that separates them.**\n- *One bad backend.* Per-connection balancing means a single broken pod gives a steady percentage of failures. Test: curl each backend pod IP directly in a loop; compare error rates per pod. A pod that is Ready but broken points at a weak readiness probe.\n- *Cross-node pod networking.* Test: run a client pod on the same node as the backend and another on a different node; compare. Only cross-node failing implicates the CNI path.\n- *MTU and encapsulation.* Overlays add header bytes; if pod interfaces are not sized for it or the underlying network drops fragments or blocks the ICMP needed for path MTU discovery, handshakes and small requests work while large responses hang until a timeout. Test with increasing payload sizes cross-node; compare pod interface MTU with node interface MTU (`ip link` in the pod and on the node).\n- *Node-level CNI health.* A crash-looping or lagging CNI agent on one node can leave routes or rules stale for some pods. Test: check the CNI pods on the affected nodes, their restarts and logs; see if failures follow a node.\n- *Conntrack exhaustion or races.* A full conntrack table drops new flows randomly (kernel log messages such as "nf_conntrack: table full, dropping packet"). Some kernel and UDP combinations have known races that drop DNS packets under parallel queries. Test: node kernel logs and conntrack counts versus the maximum.\n- *DNS.* A lost DNS packet costs a resolver timeout (often 5 seconds) before the request starts. Test: time the lookup separately from the connect.\n- *Policy or rules differences.* A NetworkPolicy or firewall that affects only some nodes or some pod labels gives consistent failures for that subset. Test: compare policies selecting the failing sources and destinations, and node-to-node firewall rules for the CNI\'s encapsulation traffic.\n\n**3. Evidence discipline.** Keep a timeline, record each command and result, form one hypothesis at a time with a test that could disprove it, and make the smallest reversible change once evidence supports it (cordon and drain a suspect node rather than restarting the CNI everywhere). Communicate the scope while you work: "2% of orders→inventory requests, cross-node only, investigating MTU".\n\n**4. Afterwards.** Add what would have made this fast: per-backend error metrics, DNS latency metrics, CNI agent alerts, a synthetic cross-node probe.',
  followups: [
    { q: 'Failures only happen when the response is larger than about 1.4 KB and only cross-node. What is your hypothesis and how do you confirm it?', guidance: 'MTU mismatch with an overlay: encapsulated packets exceed the underlying MTU and are dropped, and path MTU discovery is not working. Confirm by comparing pod and node interface MTUs, testing with payload sizes just below and above the threshold, and capturing packets on the node interfaces if allowed. Fix by aligning the CNI\'s configured MTU with the underlying network, rolled out carefully.' },
    { q: 'All failures go to pods on one node. What do you do next, safely?', guidance: 'Inspect that node: CNI agent status and logs, kernel logs (conntrack, NIC errors), resource pressure. If service impact is ongoing, cordon and drain it so workloads move while you keep the node for investigation, instead of rebooting it and losing evidence. Compare its configuration (kernel, CNI version) with healthy nodes.' },
    { q: 'How would you explain your findings to a non-networking stakeholder during the incident?', guidance: 'State scope and impact in plain terms (what fails, how often, for whom), what is ruled out, what the current hypothesis is and how you are testing it, and the next update time. Avoid jargon; separate facts from hypotheses.' }
  ],
  misconceptions: [
    '"Intermittent means random, so there is nothing to find." Intermittent failures usually map to a subset (a pod, a node, a packet size, a path) that you can isolate by comparison.',
    '"Restart the CNI or the pods and see if it helps." Broad restarts can hide the cause and remove the evidence; isolate first, then make a targeted change.',
    '"Timeouts are always the application." A timeout means no response arrived; the drop can be anywhere from DNS to the pod network.',
    '"If the TCP handshake works, the network is fine." MTU problems specifically let small packets through while dropping large ones.'
  ],
  weak: [
    'Immediately restarts pods, nodes or the CNI',
    'Tests only through the Service name, never per backend or by pod IP',
    'Never compares same-node and cross-node behaviour',
    'Lists causes without a test for each'
  ],
  evidence: '# example output\n# 1. is it one backend? test each pod IP directly, 200 requests each\n$ for ip in 10.244.1.40 10.244.2.51 10.244.3.12; do\n    fails=0; for i in $(seq 200); do curl -s -o /dev/null --max-time 3 http://$ip:8080/stock/42 || fails=$((fails+1)); done\n    echo "$ip fails=$fails"; done\n10.244.1.40 fails=0\n10.244.2.51 fails=0\n10.244.3.12 fails=0\n\n# 2. same-node vs cross-node with a large response\n$ kubectl -n shop exec toolbox-same-node  -- curl -s -o /dev/null -w "%{http_code} %{time_total}\\n" --max-time 5 http://10.244.3.12:8080/stock/export\n200 0.084\n$ kubectl -n shop exec toolbox-other-node -- curl -s -o /dev/null -w "%{http_code} %{time_total}\\n" --max-time 5 http://10.244.3.12:8080/stock/export\n000 5.001\n\n# 3. compare MTUs (pod vs node)\n$ kubectl -n shop exec toolbox-other-node -- ip link show eth0 | grep -o "mtu [0-9]*"\nmtu 1500\n$ ssh worker-3 ip link show ens5 | grep -o "mtu [0-9]*"\nmtu 1500      <- no room for overlay headers',
  rubric: {
    strong: [
      'Characterises the failing subset first (source, destination, node, size, phase) using existing telemetry',
      'Uses controlled comparisons: per backend by pod IP, same node vs cross node, small vs large payload',
      'Names plausible mechanisms (bad backend, MTU/encapsulation, CNI agent, conntrack, DNS, policy) each with a test',
      'Explicitly avoids broad restarts and preserves evidence; makes targeted, reversible changes',
      'Mentions communicating scope and adding detection afterwards'
    ],
    acceptable: [
      'Starts from node metrics and CNI health rather than per-pod tests, if the approach still isolates the subset before changing anything',
      'Uses packet captures as the primary tool where node access is available, with clear hypotheses'
    ],
    redFlags: [
      'Restarts all pods, nodes or the CNI as a first step',
      'Concludes "network is flaky" without isolating a subset',
      'Changes MTU or other cluster-wide settings without evidence'
    ]
  },
  aws: { analogy: 'Intermittent timeouts across a VPN or Transit Gateway where MTU differs from in-VPC jumbo frames, diagnosed with VPC Flow Logs and per-target health in a target group.', breaks: 'With an overlay CNI, flow logs show node-to-node encapsulated traffic rather than pod IPs, and the MTU budget is consumed inside the node by encapsulation. Service balancing happens per connection in each client node\'s kernel rather than at one load balancer with per-target metrics.' },
  refs: [
    { t: 'Cluster networking', u: 'https://kubernetes.io/docs/concepts/cluster-administration/networking/' },
    { t: 'Debug Services', u: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/' },
    { t: 'Debugging DNS resolution', u: 'https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/' }
  ],
  verify: ''
}

);
