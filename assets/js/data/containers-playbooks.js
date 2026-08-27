/* Containers track — decision trees. Same shape as the Linux ones: each step is
   a question, a command, what it settles, and where it forks. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.playbooks = LX.playbooks || [];

LX.playbooks.push(

/* ═══ 1. pod will not start ═══ */
{
  id:'cn-pod-pending', track:'containers', title:'A pod is stuck in Pending', cat:'k8s', level:'beginner',
  cert:['cka:troubleshooting','cka:workloads-and-scheduling'],
  prompt:'"You deploy and the pod never starts — it just sits in Pending. Walk me through it."',
  say:'"Pending means the scheduler has not placed it on a node, so this is a scheduling problem rather than an application one — nothing has tried to run yet. I would read the events on the pod, because the scheduler says exactly why it could not place it, then check the four things it can be: no node with enough free requests, a taint the pod does not tolerate, a node selector or affinity that matches nothing, or a volume that cannot be bound in the right zone."',
  steps:[
    { check:'What is the scheduler complaining about?', cmd:'kubectl describe pod NAME | sed -n "/Events:/,$p"',
      decide:'The FailedScheduling message names the reason, usually with a count of how many nodes failed each test.',
      why:'Pending is unambiguous: the pod exists in the API but no node has been chosen, so no image has been pulled and no container has run. The scheduler records its reasoning as an event, and the message is specific — "Insufficient cpu", "node(s) had untolerated taint", "node(s) didn\'t match Pod\'s node affinity". Reading it first turns this from a search into a lookup.',
      branches:[
        { when:'Insufficient cpu / memory', then:'Requests do not fit any node. Next step sizes it.' },
        { when:'untolerated taint', then:'The nodes that fit are reserved. Check taints and tolerations.' },
        { when:'didn\'t match node affinity/selector', then:'The pod is asking for a label no node carries.' },
        { when:'had volume node affinity conflict', then:'A zonal volume against a node in another zone', goto:'cn-pvc-pending' },
        { when:'No events at all', then:'No scheduler is running, or the pod is gated. Check the control plane', goto:'cn-node-notready' } ] },

    { check:'Is the cluster actually full?', cmd:'kubectl describe node NODE | grep -A 6 "Allocated resources"   ·   kubectl top nodes',
      decide:'Compare allocated *requests* against allocatable — not actual usage.',
      why:'This is where people misread the cluster. Scheduling is done entirely on **requests**, not on live usage, so a node can be 20% busy and still completely unschedulable because everything on it reserved more than it uses. `kubectl top` shows real consumption and `describe node` shows reservations; when the two disagree wildly, the fix is right-sizing requests, not adding nodes.',
      branches:[
        { when:'Requests near 100%, usage low', then:'Requests are inflated. Right-size them rather than scaling out.' },
        { when:'Genuinely full', then:'Scale the node group, or let Cluster Autoscaler / Karpenter do it.' },
        { when:'Plenty free everywhere', then:'It is not capacity — go back to the event text.' } ] },

    { check:'Is something reserving those nodes?', cmd:'kubectl describe node NODE | grep -i taints   ·   kubectl get nodes -o json | jq ".items[].spec.taints"',
      decide:'A taint on the node needs a matching toleration on the pod.',
      why:'Taints are how nodes say "not for general workloads" — control-plane nodes, GPU pools, spot capacity. NoSchedule keeps new pods away, NoExecute also evicts pods already there. This is also the everyday cause of "my DaemonSet is missing from one node": the daemonset has no toleration for that node\'s taint.',
      branches:[
        { when:'A taint matching no toleration', then:'Add the toleration, or target a different node group.' },
        { when:'node.kubernetes.io/not-ready', then:'The node itself is unhealthy, not reserved', goto:'cn-node-notready' },
        { when:'No taints', then:'Check the selector and affinity next.' } ] },

    { check:'Is it asking for a node that does not exist?', cmd:'kubectl get pod NAME -o jsonpath=\'{.spec.nodeSelector}{"\\n"}{.spec.affinity}\'   ·   kubectl get nodes --show-labels',
      decide:'Every label in the selector has to appear on some node.',
      why:'A nodeSelector or a required affinity is a hard constraint: if no node carries the label, the pod waits forever with no further explanation. Common causes are a typo, a node group that was replaced and re-labelled, or an architecture selector on a cluster that has moved to Graviton. Preferred affinity is soft and will not cause this.',
      branches:[
        { when:'Selector label on no node', then:'Fix the label or the selector.' },
        { when:'Zone affinity', then:'Often really a volume constraint', goto:'cn-pvc-pending' } ] },

    { check:'Confirm the fix took effect', cmd:'kubectl get pod NAME -o wide -w',
      decide:'It should move Pending → ContainerCreating → Running, with a node assigned.',
      why:'Watch it rather than re-running get. If it reaches ContainerCreating the scheduling problem is solved and any remaining failure is image pull or volume mounting, which is a different tree. If it goes back to Pending, the change did not address the actual constraint.',
      branches:[
        { when:'ContainerCreating then ImagePullBackOff', then:'Scheduling is fixed; the registry is next', goto:'cn-imagepull' },
        { when:'Running', then:'Done. Consider whether requests should be adjusted permanently.' } ] } ],
  probes:[
    ['What is the difference between a request and a limit?','A request is what the scheduler reserves and it decides placement. A limit is what the kernel enforces at runtime — exceeding a memory limit gets the container OOMKilled, exceeding a CPU limit gets it throttled rather than killed. Requests too high waste the cluster; limits too low kill healthy processes.'],
    ['A node shows 30% CPU used but nothing schedules. Why?','Because scheduling is done on requests, not usage. Everything on that node has reserved capacity it is not consuming. `describe node` shows the reservations, `top node` shows the reality, and the gap between them is the problem to fix.'],
    ['How would you stop this recurring?','Set realistic requests from observed usage, add a LimitRange so pods that declare nothing still get sane values, and run an autoscaler so capacity follows demand rather than a person.'],
    ['What is the difference between NoSchedule and NoExecute?','NoSchedule stops new pods landing; existing pods stay. NoExecute also evicts pods already running there that do not tolerate it — which is how a node is drained by tainting it.']
  ],
  trap:'Scaling the cluster before reading the event. Roughly half of Pending pods are not a capacity problem at all — a taint, a selector or a volume zone — and adding nodes changes nothing while costing money.',
  remember:'Pending is the scheduler talking. It always says why, in an event, in plain language.',
  mission:'cn-m-pending'
},

/* ═══ 2. crash loop ═══ */
{
  id:'cn-crashloop', track:'containers', title:'CrashLoopBackOff', cat:'k8s', level:'beginner',
  cert:['cka:troubleshooting'],
  prompt:'"A pod is in CrashLoopBackOff. What do you do?"',
  say:'"CrashLoopBackOff means the container starts, exits, and Kubernetes is backing off before trying again — so unlike Pending, something has actually run. The single most useful command is `kubectl logs --previous`, because the logs I want belong to the instance that already died. Then I read the exit code from describe: 137 is a kill, usually the memory limit; 1 or 2 is the application choosing to quit and the reason will be in its output; 0 means it completed, which for a server is itself the bug."',
  steps:[
    { check:'What did the last run say?', cmd:'kubectl logs POD --previous --tail=50',
      decide:'The output of the instance that just died — not the one starting now.',
      why:'Without `--previous` you are reading a container that is seconds old and has not failed yet, and by the time you scroll it has been replaced. The flag exists precisely for this state. If it returns nothing at all, the process died before writing anything, which points at the entrypoint, a missing file, or an external kill rather than application logic.',
      branches:[
        { when:'A clear application error', then:'Config, a missing dependency, a bad migration — fix the cause.' },
        { when:'Completely empty', then:'It never got to run. Check the exit code and the command.' },
        { when:'"connection refused" to a dependency', then:'It is failing on a dependency it needs at boot', goto:'cn-svc-noendpoints' } ] },

    { check:'How did it die?', cmd:'kubectl describe pod POD | grep -A 12 "Last State"',
      decide:'Exit code and reason. This is the fork the rest of the tree turns on.',
      why:'`Reason: OOMKilled, Exit Code: 137` is the kernel killing it for exceeding its memory limit — the application did nothing wrong and its logs will end mid-line. `Exit Code: 1` or `2` is the process choosing to exit, so its own output holds the reason. `Exit Code: 0` with a restart means it completed successfully, which for a Deployment means the command is wrong. And 126 or 127 mean the entrypoint is not executable or does not exist.',
      branches:[
        { when:'137 / OOMKilled', then:'Memory limit. Size it against real usage — next step.' },
        { when:'1 or 2', then:'The app quit deliberately. Its logs say why.' },
        { when:'0', then:'It finished. A Deployment expects a process that stays up; this may want a Job.' },
        { when:'127', then:'Entrypoint not found — usually a path or architecture mismatch in the image.' } ] },

    { check:'Is the limit too low, or the app leaking?', cmd:'kubectl top pod POD --containers   ·   kubectl get pod POD -o jsonpath=\'{.spec.containers[*].resources}\'',
      decide:'Usage against the limit, and whether it climbs steadily or spikes.',
      why:'A container killed at exactly its limit with usage that climbs steadily has a leak; one killed during a burst needs a higher limit. Read the limit, not the node capacity — a pod with a 256Mi limit dies at 256Mi on a machine with 60GB free, which is the detail that confuses people coming from VMs. For a JVM or .NET runtime, also check that the heap is sized below the container limit, not the host memory.',
      branches:[
        { when:'Usage climbs until the limit, every time', then:'A leak. Raising the limit buys hours, not a fix.' },
        { when:'Spikes at startup only', then:'Raise the limit, or add a startupProbe so it is not also being restarted by liveness.' } ] },

    { check:'Is a probe killing a healthy container?', cmd:'kubectl describe pod POD | grep -E "Liveness|Readiness|Startup"',
      decide:'Whether the liveness probe can pass in the time it is given.',
      why:'A liveness probe with a short initialDelaySeconds against an application that takes 40 seconds to warm up produces an infinite restart loop that looks exactly like a crash — the process is fine and is being killed repeatedly. `startupProbe` exists for this: it holds liveness and readiness off until the app has booted, with a much longer allowance. Check the Events for "Liveness probe failed" alongside the restarts.',
      branches:[
        { when:'"Liveness probe failed" in events', then:'The probe is the killer. Add a startupProbe or extend the delay.' },
        { when:'Probes passing', then:'It is genuinely the application or the limit.' } ] },

    { check:'Prove it is fixed', cmd:'kubectl rollout status deploy/NAME --timeout=120s   ·   kubectl get pod -l app=NAME -w',
      decide:'Restart count stops climbing and the pod stays Ready.',
      why:'The restart counter is the honest measure — a pod can be Running and still be on its fortieth restart. Watch for a couple of minutes past the point where it previously died, because a memory leak takes time to reappear and a "fix" that only delays the crash is easy to mistake for a fix.',
      branches:[
        { when:'Restarts stop', then:'Done. Record the real memory ceiling so the limit is evidence-based.' },
        { when:'Still restarting, new error', then:'Progress — a different failure. Start the tree again with the new message.' } ] } ],
  probes:[
    ['Why --previous?','Because the container you would otherwise read is the replacement, which has not failed yet. The evidence belongs to the instance that died, and it is gone as soon as the next one starts.'],
    ['Exit code 137 — what is it, exactly?','128 + 9, so SIGKILL. In a container that almost always means the memory cgroup limit was exceeded; on a node it can also be the host OOM killer. `describe` shows Reason: OOMKilled, which distinguishes the two.'],
    ['The logs are empty even with --previous. Now what?','The process never wrote anything, so look before the application: exit code 127 for a missing entrypoint, an image built for the wrong architecture, a failing initContainer, or a secret/configmap mount that failed — all of which show in describe.'],
    ['How is this different from ImagePullBackOff?','CrashLoop means the image was pulled and ran. ImagePullBackOff means it never got that far — registry, tag or credentials.'],
    ['How do you stop a crash loop hammering the cluster?','It already backs off exponentially to five minutes. To investigate calmly, scale the deployment to zero and run one copy with `kubectl debug` or an overridden command, rather than fighting the restart.']
  ],
  trap:'Reading `kubectl logs` without `--previous` and concluding the logs are empty. They are not empty — you are reading the wrong container.',
  remember:'Logs from the dead one, exit code from describe. 137 is memory, 1 is the app, 0 is the wrong command.',
  mission:'cn-m-crashloop'
},

/* ═══ 3. image pull ═══ */
{
  id:'cn-imagepull', track:'containers', title:'ImagePullBackOff / ErrImagePull', cat:'registry', level:'beginner',
  cert:['cka:troubleshooting','sec+:security-architecture'],
  prompt:'"Pods are stuck in ImagePullBackOff. Where do you start?"',
  say:'"The container never ran, so this is entirely between the node and the registry. The describe events give the exact reason and there are only four: the tag or repository does not exist, the credentials are missing or expired, the node cannot reach the registry, or a rate limit. I read the message first because it distinguishes them, then reproduce the pull from the node itself if it is not obvious."',
  steps:[
    { check:'What exactly did the kubelet get back?', cmd:'kubectl describe pod POD | grep -A 5 -i "failed to pull\\|Events"',
      decide:'The error text distinguishes all four causes.',
      why:'The kubelet passes the registry\'s own error through, and the four are unmistakable: "manifest unknown" or "not found" is a bad tag; "unauthorized" or "authentication required" is credentials; "dial tcp … i/o timeout" is the network; "toomanyrequests" is a rate limit. Guessing between them wastes the whole investigation.',
      branches:[
        { when:'manifest unknown / not found', then:'The tag does not exist. Check what the registry actually has.' },
        { when:'unauthorized', then:'Credentials — check the imagePullSecret or the node role.' },
        { when:'i/o timeout', then:'The node cannot reach the registry — network, endpoint or NAT.' },
        { when:'toomanyrequests', then:'Docker Hub rate limit. Authenticate or mirror the image.' } ] },

    { check:'Does the tag exist?', cmd:'crane ls REPO   ·   aws ecr describe-images --repository-name REPO --query "imageDetails[].imageTags"',
      decide:'Compare the tag in the manifest against the tags in the registry.',
      why:'The most common cause is the least interesting: a typo, a tag that CI never pushed because the build failed, or an image built for one architecture being pulled onto another. Check the digest too — an arm64-only image on an amd64 node fails with a manifest error that reads like the image is missing.',
      branches:[
        { when:'Tag missing', then:'The build did not publish. Look at CI, not at the cluster.' },
        { when:'Tag exists', then:'Then it is auth or network. Next steps.' } ] },

    { check:'Can this node authenticate?', cmd:'kubectl get pod POD -o jsonpath=\'{.spec.imagePullSecrets}\'   ·   kubectl get sa default -o yaml',
      decide:'Is a pull secret attached, and does the node role allow the pull?',
      why:'Two different models. With a private registry you attach an `imagePullSecret` to the pod or the service account. With ECR or ACR the node\'s IAM role or managed identity does it and there is no secret at all — so a missing `ecr:GetAuthorizationToken` on the node role produces exactly this symptom on a cluster where nothing changed but the policy.',
      branches:[
        { when:'No secret and a private registry', then:'Attach one to the service account so every pod inherits it.' },
        { when:'ECR/ACR', then:'Check the node role or managed identity, not Kubernetes.' },
        { when:'Secret present', then:'Verify it is in the same namespace as the pod — they are namespaced.' } ] },

    { check:'Can the node reach the registry at all?', cmd:'kubectl debug node/NODE -it --image=nicolaka/netshoot -- curl -sSv https://REGISTRY/v2/ 2>&1 | tail -20',
      decide:'DNS, TLS and a response — even a 401 proves reachability.',
      why:'A 401 from `/v2/` is a *good* result: it means the network path works and only auth is missing. A timeout means the node cannot get there, which on a private subnet is usually a missing NAT gateway route or a missing VPC endpoint for ECR. On EKS pulling from ECR privately you need three endpoints — ecr.api, ecr.dkr and S3 — and missing the S3 one produces a pull that authenticates and then stalls on layers.',
      branches:[
        { when:'401 Unauthorized', then:'Network is fine. Back to credentials.' },
        { when:'Timeout', then:'Routing. Check the NAT gateway and endpoints', goto:'cn-egress' },
        { when:'TLS error', then:'A proxy intercepting, or a private registry with a CA the node does not trust.' } ] },

    { check:'Retry deliberately', cmd:'kubectl delete pod POD   ·   kubectl rollout restart deploy/NAME',
      decide:'The backoff can be five minutes; do not wait it out wondering.',
      why:'ImagePullBackOff backs off exponentially, so after a fix the pod may sit there for minutes looking unfixed. Deleting the pod forces an immediate retry and tells you within seconds. If it fails again, the message will have changed if you fixed one of several problems — read it again rather than assuming nothing happened.',
      branches:[
        { when:'Pulls and runs', then:'Done. Pin a digest rather than a mutable tag.' },
        { when:'Same error', then:'The fix missed. Re-read the message.' } ] } ],
  probes:[
    ['ImagePullBackOff versus ErrImagePull?','ErrImagePull is the first failure. ImagePullBackOff is the state after Kubernetes starts backing off between retries. Same cause, different point in the cycle.'],
    ['It worked yesterday and fails today with nothing deployed. Why?','Expired or rotated registry credentials, a mutable tag that was overwritten or deleted, a Docker Hub rate limit reached by a new node, or an IAM policy change on the node role. All four are external to the cluster.'],
    ['How do you avoid Docker Hub rate limits in a cluster?','Authenticate rather than pulling anonymously, and mirror the images you depend on into ECR or ACR with a pull-through cache. Anonymous limits are per source IP, so every node behind one NAT gateway shares a budget.'],
    ['Why pin a digest instead of a tag?','A tag is a mutable pointer, so the image you tested and the image that gets pulled at 3am can differ. A digest is content-addressed and cannot change.']
  ],
  trap:'Assuming the registry is down. Three of the four causes are on your side — the tag, the credentials, or the route out of the subnet.',
  remember:'Read the kubelet\'s error text. Not found, unauthorized, timeout and rate-limited are four different problems with four different owners.',
  mission:'cn-m-imagepull'
},

/* ═══ 4. service with no endpoints ═══ */
{
  id:'cn-svc-noendpoints', track:'containers', title:'The Service returns nothing', cat:'svc', level:'beginner',
  cert:['cka:services-and-networking','cka:troubleshooting'],
  prompt:'"Pods are running but requests through the Service fail. Walk me through it."',
  say:'"I bisect rather than guess. Port-forward straight to the pod first: if that works the application is fine and the problem is above it. Then check the Service\'s endpoints, because there are only two reasons a Service has none — the selector does not match the pod labels, or every pod is failing its readiness probe. Only after both of those do I look at Ingress and the load balancer."',
  steps:[
    { check:'Does the pod itself serve?', cmd:'kubectl port-forward pod/POD 8080:8080 & curl -s localhost:8080/health',
      decide:'Bypass everything and talk to the container directly.',
      why:'This one command splits the problem in half. If the pod answers, the application, the container port and the process binding are all correct, and everything left is routing. If it does not, stop looking at Kubernetes networking — the app is not listening, or it is bound to 127.0.0.1 inside the container, which works for a local test and is invisible to anything else.',
      branches:[
        { when:'Pod answers', then:'Application is fine. Move up to the Service.' },
        { when:'Connection refused', then:'Nothing is listening on that port in the container. Check the process and its bind address.' },
        { when:'Wrong response', then:'An application problem, not a networking one.' } ] },

    { check:'Does the Service have endpoints?', cmd:'kubectl get endpoints SVC   ·   kubectl describe svc SVC',
      decide:'An empty Endpoints line ends the investigation right here.',
      why:'A Service is a selector plus a port mapping. Its endpoint list is built from pods that both match the selector and pass readiness. Empty means one of those two failed — and no amount of Ingress debugging will help. This is the single highest-yield check in the tree and it takes five seconds.',
      branches:[
        { when:'Endpoints empty', then:'Selector or readiness. Next two steps.' },
        { when:'Endpoints present', then:'Routing works to the pods; the problem is above the Service', goto:'cn-ingress' } ] },

    { check:'Does the selector match the labels?', cmd:'kubectl get svc SVC -o jsonpath=\'{.spec.selector}{"\\n"}\'   ·   kubectl get pods --show-labels',
      decide:'Every key/value in the selector must appear on the pod.',
      why:'Selectors are exact and silent. `app: api` does not match `app: api-server`, and a Deployment whose template labels were edited leaves a Service pointing at nothing while every object looks healthy. There is no warning anywhere — the Service is valid, the pods are running, and the endpoint list is simply empty.',
      branches:[
        { when:'Mismatch', then:'Fix the selector or the labels. Endpoints populate immediately.' },
        { when:'Match', then:'Then the pods are not Ready. Next step.' } ] },

    { check:'Are the pods actually Ready?', cmd:'kubectl get pods -l app=api   ·   kubectl describe pod POD | grep -A 5 Readiness',
      decide:'READY 0/1 with STATUS Running is the state to look for.',
      why:'A pod can be Running and not Ready indefinitely, and Kubernetes deliberately keeps it out of the Service — that is what readiness is for. The usual causes are a probe pointed at a path that does not exist, a probe on the wrong port, or a dependency the app waits for before reporting ready. The events name the failure and the response code.',
      branches:[
        { when:'0/1 Running', then:'Readiness failing. The probe message says why.' },
        { when:'1/1 Ready but no endpoints', then:'Rare — check that the port name in the Service matches the container port name.' } ] },

    { check:'Confirm from inside the cluster', cmd:'kubectl run t --rm -it --image=nicolaka/netshoot -- curl -s http://api.default.svc.cluster.local/health',
      decide:'Resolve and connect using the name a real client would use.',
      why:'Testing from inside removes Ingress, the load balancer and external DNS from the picture. If the fully qualified name works, routing is correct end to end and anything still failing is above the cluster. If the name does not resolve at all, this is a DNS problem rather than a Service one.',
      branches:[
        { when:'Works', then:'Service layer is healthy. Anything remaining is Ingress or external', goto:'cn-ingress' },
        { when:'Name does not resolve', then:'Cluster DNS', goto:'cn-dns' } ] } ],
  probes:[
    ['A Service has endpoints but curl still fails. What now?','Check targetPort against the container port, whether a NetworkPolicy is denying the client, and whether the pods are on a node whose kube-proxy is healthy. `externalTrafficPolicy: Local` also drops traffic on nodes with no local pod.'],
    ['Why can you not ping a ClusterIP?','Because nothing listens on it. A ClusterIP is a virtual address implemented as an iptables or IPVS rule that rewrites the destination — there is no interface to answer ICMP, so a failed ping says nothing about health.'],
    ['What is a headless Service for?','clusterIP: None returns the pod IPs directly from DNS instead of one virtual IP. StatefulSets need it so each replica is individually addressable, and clients that do their own load balancing prefer it.'],
    ['Readiness versus liveness, in one line each?','Readiness controls traffic — failing removes the pod from endpoints. Liveness controls life — failing restarts the container. Using liveness where you meant readiness turns a slow dependency into a restart loop.']
  ],
  trap:'Debugging the Ingress while the Service has no endpoints. Check endpoints first; it is one command and it is the answer more often than anything else in this tree.',
  remember:'Port-forward to the pod, then read Endpoints. Empty endpoints means selector or readiness — nothing else.',
  mission:'cn-m-svc'
},

/* ═══ 5. cluster DNS ═══ */
{
  id:'cn-dns', track:'containers', title:'DNS fails inside the cluster', cat:'dns', level:'intermediate',
  cert:['cka:services-and-networking','cka:troubleshooting'],
  prompt:'"A pod cannot resolve another service by name. How do you debug cluster DNS?"',
  say:'"I test with the fully qualified name first — service.namespace.svc.cluster.local — because that isolates search-path behaviour from actual DNS failure. If the FQDN resolves and the short name does not, it is ndots and the search path, not DNS. If neither resolves, I check the pod\'s resolv.conf, then whether CoreDNS is running and reachable, then whether a NetworkPolicy is blocking port 53."',
  steps:[
    { check:'Does the fully qualified name resolve?', cmd:'kubectl exec POD -- nslookup api.payments.svc.cluster.local',
      decide:'FQDN working while the short name fails is a completely different problem.',
      why:'The FQDN bypasses the search path entirely. If it works, DNS is healthy and you are looking at `ndots:5` behaviour — short names are tried against each search suffix in turn, which is slow and can pick up an unintended match. If the FQDN also fails, DNS itself is broken and the rest of the tree applies.',
      branches:[
        { when:'FQDN works, short name fails', then:'Search path. Check resolv.conf and the namespace you are in.' },
        { when:'Neither works', then:'DNS is broken. Continue.' },
        { when:'FQDN returns the wrong address', then:'A stale entry or a conflicting external zone.' } ] },

    { check:'What resolver was the pod given?', cmd:'kubectl exec POD -- cat /etc/resolv.conf',
      decide:'nameserver should be the kube-dns Service IP; check search and ndots.',
      why:'The kubelet writes this file when the pod starts. A nameserver that is not the cluster DNS Service IP means `dnsPolicy` is not ClusterFirst — often `Default`, which uses the node\'s resolver and cannot see cluster names at all. `hostNetwork: true` pods hit this constantly, which is why they need `dnsPolicy: ClusterFirstWithHostNet`.',
      branches:[
        { when:'nameserver is not kube-dns', then:'dnsPolicy is wrong for this pod.' },
        { when:'Correct nameserver', then:'Check whether CoreDNS is answering.' } ] },

    { check:'Is CoreDNS up and serving?', cmd:'kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide   ·   kubectl -n kube-system logs -l k8s-app=kube-dns --tail=30',
      decide:'Running, Ready, and not logging errors or plugin failures.',
      why:'CoreDNS is a normal Deployment and fails in normal ways — OOMKilled under load, crash-looping on a bad Corefile after an edit, or every replica scheduled onto one node that then went away. Its logs report upstream failures too, which is how you tell "cluster names fine, external names failing" apart from a total outage.',
      branches:[
        { when:'Pods not Ready', then:'Fix CoreDNS itself', goto:'cn-crashloop' },
        { when:'Logs show upstream timeouts', then:'The cluster resolves internally but cannot forward outward', goto:'cn-egress' },
        { when:'Healthy', then:'The path from pod to CoreDNS is the suspect.' } ] },

    { check:'Can the pod reach DNS at all?', cmd:'kubectl exec POD -- nc -zvu 10.96.0.10 53   ·   kubectl get netpol -A',
      decide:'UDP 53 to the DNS Service IP, and whether any policy governs it.',
      why:'This is the step that catches the nastiest version: a default-deny NetworkPolicy applied to a namespace blocks egress to kube-dns unless it explicitly allows UDP 53 to the kube-system namespace. Everything looks correct — CoreDNS healthy, resolv.conf right — and no name resolves from that namespace only. Timeouts rather than NXDOMAIN are the signature.',
      branches:[
        { when:'Timeout', then:'Something is blocking it — NetworkPolicy, or kube-proxy on this node.' },
        { when:'NXDOMAIN', then:'DNS answered; the name genuinely does not exist. Check the Service', goto:'cn-svc-noendpoints' } ] },

    { check:'Prove it end to end', cmd:'kubectl run t --rm -it --image=nicolaka/netshoot -- sh -c "dig +short api.payments.svc.cluster.local; dig +short example.com"',
      decide:'One internal name and one external name, from a fresh pod.',
      why:'Testing both proves which half works. Internal resolving and external failing points at CoreDNS\'s upstream forwarders or egress; the reverse points at the cluster zone or the Service. A fresh pod also rules out a stale resolver cache inside the application you were debugging.',
      branches:[
        { when:'Both resolve', then:'DNS is healthy. If the app still fails, it is caching — restart it.' },
        { when:'Internal only', then:'Upstream forwarding or egress', goto:'cn-egress' } ] } ],
  probes:[
    ['What does ndots:5 actually do?','Any name with fewer than five dots is tried against each search-domain suffix before being tried as written. So `example.com` becomes four failed cluster lookups first. A trailing dot makes it absolute and skips all of that.'],
    ['Why is external DNS slow from inside a cluster?','The same ndots behaviour — several wasted round trips per lookup. Fixes are a trailing dot, a lower ndots in dnsConfig, or NodeLocal DNSCache.'],
    ['A default-deny NetworkPolicy broke DNS. Why?','Because DNS is egress traffic like any other. A policy with policyTypes including Egress and no rule for UDP 53 to kube-system blocks every lookup from that namespace, while CoreDNS itself looks perfectly healthy.'],
    ['How would you scale DNS for a large cluster?','Scale CoreDNS replicas and give it real requests, then deploy NodeLocal DNSCache so each node answers from a local cache and conntrack pressure from thousands of short UDP flows disappears.']
  ],
  trap:'Concluding "DNS is down" from a short-name failure. Test the FQDN first — if it works, DNS is fine and you have a search-path question instead.',
  remember:'FQDN first. Then resolv.conf, then CoreDNS, then whether anything is blocking UDP 53.',
  mission:'cn-m-dns'
}

,

/* ═══ 6. ingress ═══ */
{
  id:'cn-ingress', track:'containers', title:'Ingress returns 502, 503 or nothing', cat:'svc', level:'intermediate',
  cert:['cka:services-and-networking'],
  prompt:'"Traffic from outside gets a 502 but the pods are healthy. Walk me through it."',
  say:'"I work inward, because the failure could be at four layers and each has a different owner. External DNS to the load balancer, the load balancer to the ingress controller, the controller to the Service, the Service to the pods. I confirm the innermost layer works first with a port-forward, then walk outward until something breaks — that way I never debug the Ingress while the Service has no endpoints."',
  steps:[
    { check:'Does the Ingress have an address at all?', cmd:'kubectl get ingress -A',
      decide:'An empty ADDRESS column after a minute means no controller claimed it.',
      why:'An Ingress object is inert on its own — it is a request that some controller must pick up. If `ingressClassName` is missing or names a class that does not exist, the object sits there looking valid forever and nothing is ever provisioned. This is the fastest thing to rule out and it accounts for a surprising share of "the Ingress does not work".',
      branches:[
        { when:'No address', then:'No controller claimed it. Check ingressClassName against the installed classes.' },
        { when:'Address present', then:'Something is serving. Continue inward.' } ] },

    { check:'What does the controller say about the request?', cmd:'kubectl -n ingress-nginx logs deploy/ingress-nginx-controller --tail=50 | grep -v " 200 "',
      decide:'The controller logs the upstream it chose and the status it got back.',
      why:'This is the layer that actually knows. A 502 means the controller reached an upstream and got a broken response or a refused connection; a 503 usually means it had no upstream to send to at all, which points straight at empty endpoints. The log line names the upstream address, so you can tell whether it picked a sensible pod IP or nothing.',
      branches:[
        { when:'503, upstream is empty or "-"', then:'No endpoints behind the Service', goto:'cn-svc-noendpoints' },
        { when:'502 with a real upstream IP', then:'It reached a pod and the pod misbehaved — port or protocol.' },
        { when:'404', then:'Host or path matching. Check the rules and pathType.' } ] },

    { check:'Do the rules match what the client sends?', cmd:'kubectl describe ingress NAME | grep -A 10 Rules',
      decide:'Host, path, pathType and the backend service and port.',
      why:'Two traps live here. `pathType: Exact` matches only that exact path, so `/api` works and `/api/v1` 404s — `Prefix` is nearly always what people meant. And the backend `port` must match the Service port, not the container port; getting that wrong produces a 502 because the controller connects to a port nothing serves.',
      branches:[
        { when:'pathType: Exact', then:'Almost certainly should be Prefix.' },
        { when:'Backend port wrong', then:'It must match the Service port name or number.' },
        { when:'Rules correct', then:'Check TLS and the load balancer.' } ] },

    { check:'Is TLS the problem rather than routing?', cmd:'curl -vk https://HOST/ 2>&1 | grep -E "subject|issuer|expire|HTTP/"   ·   kubectl get secret TLSSECRET -o jsonpath=\'{.data.tls\\.crt}\' | base64 -d | openssl x509 -noout -dates',
      decide:'Whether the certificate is present, valid and for the right name.',
      why:'`-k` is the bisection: if it works with `-k` and fails without, the problem is the certificate and not the route. A missing TLS Secret makes most controllers serve their own default self-signed certificate, which produces a browser error that looks nothing like a routing problem. Secrets are namespaced, so a certificate in the wrong namespace is simply not found.',
      branches:[
        { when:'Works with -k only', then:'Certificate: expired, wrong SAN, or the default fallback is being served.' },
        { when:'Same failure both ways', then:'Not TLS. Check the load balancer and its target health.' } ] },

    { check:'Is the load balancer sending traffic to healthy targets?', cmd:'aws elbv2 describe-target-health --target-group-arn ARN --query "TargetHealthDescriptions[].{T:Target.Id,S:TargetHealth.State,R:TargetHealth.Reason}" --output table',
      decide:'Unhealthy targets, and the reason the health check gives.',
      why:'The cloud load balancer runs its own health check, independent of Kubernetes readiness, and it can disagree. Targets unhealthy with "Request timed out" is usually a security group that does not allow the load balancer to reach the node port; "Health checks failed" is a wrong path or port on the target group. On `externalTrafficPolicy: Local`, nodes with no local pod are *expected* to be unhealthy, which alarms people unnecessarily.',
      branches:[
        { when:'All unhealthy, timeouts', then:'Security group between the load balancer and the nodes', goto:'cn-egress' },
        { when:'Some unhealthy', then:'Likely externalTrafficPolicy: Local, which is normal.' },
        { when:'All healthy', then:'Routing is fine end to end — look at external DNS.' } ] } ],
  probes:[
    ['502 versus 503 from an ingress controller?','503 generally means no upstream was available — empty endpoints or every backend unhealthy. 502 means it connected to an upstream and got something it could not use — wrong port, wrong protocol, or the pod closing the connection. 503 sends you to the Service, 502 to the pod.'],
    ['Where does the Ingress get its certificate?','From a Secret named in spec.tls, in the same namespace as the Ingress. cert-manager usually creates it; if it is missing the controller serves a default self-signed certificate rather than failing loudly.'],
    ['What does externalTrafficPolicy: Local buy you?','It preserves the real client IP by not SNATing, at the cost of only routing to pods on the receiving node. Nodes with no pod fail the load balancer health check by design, which is how traffic is steered away from them.'],
    ['How do you test each layer independently?','port-forward to the pod, then to the Service, then curl the Service DNS name from inside the cluster, then curl the ingress controller Service, then the external hostname. Each step adds exactly one layer.']
  ],
  trap:'Starting at the outside. Four layers can each break, and debugging the load balancer while the Service has no endpoints burns the first half hour of an incident.',
  remember:'Work inward to the pod, then outward. 503 means no endpoints; 502 means it reached something and did not like the answer.',
  mission:'cn-m-svc'
},

/* ═══ 7. egress ═══ */
{
  id:'cn-egress', track:'containers', title:'A pod cannot reach anything outside the cluster', cat:'vpc', level:'intermediate',
  cert:['aws-saa:design-secure-architectures','cka:services-and-networking','sec+:security-architecture'],
  prompt:'"Pods can talk to each other but nothing outside — the API calls all time out. What do you check?"',
  say:'"Timeouts rather than refusals means packets are being dropped rather than rejected, which points at a filter or a missing route rather than the destination. I check in the order the packet travels: NetworkPolicy at the pod, then whether the node itself can reach out, then the route table and NAT gateway for that subnet, then security groups. And I test with an IP as well as a name, because a DNS failure looks identical from inside the application."',
  steps:[
    { check:'Is it DNS or is it the network?', cmd:'kubectl exec POD -- sh -c "nslookup example.com; curl -sS -m 5 -o /dev/null -w \'%{http_code}\\n\' https://1.1.1.1"',
      decide:'Resolve a name and connect to a raw IP — the two fail differently.',
      why:'Applications report both as a generic timeout, so separate them at the first step. If the IP connects and the name does not, this is DNS and belongs in another tree. If neither works, packets are not leaving. If the name resolves but the connection times out, resolution is fine and something is dropping traffic on the way out.',
      branches:[
        { when:'Name fails, IP works', then:'DNS, not egress', goto:'cn-dns' },
        { when:'Both fail', then:'Nothing is getting out. Continue.' } ] },

    { check:'Is a NetworkPolicy denying egress?', cmd:'kubectl get netpol -n NS   ·   kubectl describe netpol NAME',
      decide:'Any policy selecting this pod with Egress in policyTypes.',
      why:'The moment one policy selects a pod and names Egress, that pod is default-deny outbound and every destination needs an explicit allow — including DNS on UDP 53. This is the most common self-inflicted version, and it is invisible from inside the pod: no error, no log, just timeouts. Check whether the CNI even enforces policies; on flannel they apply cleanly and do nothing.',
      branches:[
        { when:'A default-deny egress policy', then:'Add the allow rules it needs, DNS included.' },
        { when:'No policies', then:'Look outside the cluster. Next step.' } ] },

    { check:'Can the node itself reach out?', cmd:'kubectl debug node/NODE -it --image=nicolaka/netshoot -- curl -sS -m 5 -o /dev/null -w "%{http_code}\\n" https://example.com',
      decide:'Node succeeding while pods fail narrows it to pod networking.',
      why:'This splits cluster problems from cloud problems cleanly. If the node can reach the internet and pods cannot, the issue is SNAT or the CNI — pod traffic is not being masqueraded to the node address, so replies have nowhere to return to. If the node cannot reach it either, stop looking at Kubernetes entirely: it is routing, NAT or security groups.',
      branches:[
        { when:'Node works, pods do not', then:'Pod SNAT or the CNI. Check the masquerade configuration.' },
        { when:'Node also fails', then:'It is the VPC. Next steps.' } ] },

    { check:'Does the subnet have a route out?', cmd:'aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=SUBNET --query "RouteTables[].Routes[]" --output table',
      decide:'A 0.0.0.0/0 route, and what it points at.',
      why:'A private subnet needs 0.0.0.0/0 pointing at a NAT gateway; a public one points at an internet gateway. The classic mistakes are a NAT gateway placed in the private subnet it serves — which cannot work, because the NAT gateway itself then has no way out — and a route table that was replaced during a change and lost the default route. Also check the NAT gateway is in the same AZ, or you are paying cross-AZ charges on every packet.',
      branches:[
        { when:'No 0.0.0.0/0 route', then:'That is the answer. Add it, pointed at the right gateway.' },
        { when:'Points at a NAT gateway', then:'Check the gateway is Available and in a public subnet.' },
        { when:'Route is fine', then:'Check filtering — security groups and NACLs.' } ] },

    { check:'Is a stateless filter eating the replies?', cmd:'aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=SUBNET   ·   aws ec2 describe-security-groups --group-ids SG',
      decide:'Outbound allowed, and — for the NACL — inbound on ephemeral ports.',
      why:'Security groups are stateful, so an allowed outbound connection has its reply allowed automatically. NACLs are not: they need an explicit inbound rule for ephemeral ports 1024-65535 or every reply is dropped and the connection times out with the request having clearly gone out. That asymmetry is the single most common NACL mistake and it produces exactly this symptom.',
      branches:[
        { when:'NACL missing ephemeral inbound', then:'That is it. Stateless means both directions.' },
        { when:'Security group has no egress rule', then:'Rare but real — the default allows all egress, so someone removed it.' },
        { when:'Both permissive', then:'Check VPC endpoint policies and any egress firewall.' } ] } ],
  probes:[
    ['Timeout versus connection refused — what does each tell you?','Refused means a packet arrived somewhere and something actively rejected it, so the path works. Timeout means the packet was dropped silently, which is what a firewall, a security group or a missing route does. They are never the same bug.'],
    ['Why would a NAT gateway in the private subnet not work?','Because it needs its own route to an internet gateway, which only a public subnet has. Placed privately it has no path out, and every private instance routing through it times out.'],
    ['How do you cut NAT gateway cost for a cluster?','Gateway VPC endpoints for S3 and DynamoDB are free and remove most image and object traffic. Interface endpoints handle other services. Beyond that, one NAT gateway per AZ avoids cross-AZ data charges, at the cost of more gateways.'],
    ['A default-deny NetworkPolicy is in place. What must you allow first?','DNS — UDP and TCP 53 to kube-system — or nothing resolves and every symptom becomes misleading.']
  ],
  trap:'Testing only a hostname. A DNS failure and a blocked route produce the same timeout inside the application; connecting to a raw IP separates them in one command.',
  remember:'Follow the packet: NetworkPolicy, then the node, then the route table, then the stateless filter that ate the reply.',
  mission:null
},

/* ═══ 8. node NotReady ═══ */
{
  id:'cn-node-notready', track:'containers', title:'A node is NotReady', cat:'ops', level:'intermediate',
  cert:['cka:cluster-architecture','cka:troubleshooting'],
  prompt:'"kubectl get nodes shows one node NotReady. What do you do?"',
  say:'"NotReady means the kubelet has stopped reporting healthy, so first I find out which condition flipped — describe node gives the condition and a message. The usual four are disk or memory pressure on the node, the kubelet being down, the CNI not running so the node cannot admit pods, or a network partition where the kubelet simply cannot reach the API server. I also check whether workloads have already been evicted, because after five minutes they will have been."',
  steps:[
    { check:'Which condition flipped, and what does it say?', cmd:'kubectl describe node NODE | grep -A 12 Conditions',
      decide:'Ready, MemoryPressure, DiskPressure, PIDPressure — with a message and a timestamp.',
      why:'The conditions block is the node\'s own account. `DiskPressure=True` means the kubelet is already garbage-collecting images and will evict pods; `Ready=Unknown` with "kubelet stopped posting node status" means the kubelet is not talking to the API server at all, which is a different problem from a kubelet that is running and unhappy.',
      branches:[
        { when:'Ready=Unknown, stopped posting', then:'The kubelet or the network to the API server. Check the node.' },
        { when:'DiskPressure=True', then:'The node is out of disk — usually images and logs.' },
        { when:'MemoryPressure=True', then:'The node is out of memory; pods are being evicted.' },
        { when:'Ready=False with a CNI message', then:'Container runtime or CNI not initialised.' } ] },

    { check:'Is the kubelet actually running?', cmd:'kubectl debug node/NODE -it --image=busybox -- chroot /host systemctl status kubelet   ·   journalctl -u kubelet -n 50 --no-pager',
      decide:'Active, and what it logged just before it stopped being healthy.',
      why:'The kubelet is a systemd unit like any other and fails like one — a bad config after an upgrade, an expired client certificate, or a full disk stopping it writing. Its journal names the reason directly, and certificate expiry is worth knowing on sight because it produces a node that was fine for a year and then is not.',
      branches:[
        { when:'Not running', then:'A systemd problem on the node — read its journal.' },
        { when:'Running but erroring', then:'Read the error: certificates, config or the runtime socket.' },
        { when:'Healthy', then:'Then it cannot reach the API server — network or security group.' } ] },

    { check:'Is the node out of disk?', cmd:'kubectl debug node/NODE -it --image=busybox -- chroot /host df -h /var/lib/containerd /var/log',
      decide:'Image storage and logs are the two that fill.',
      why:'DiskPressure is usually accumulated images and container logs rather than application data. The kubelet garbage-collects images at a threshold, but a node pulling many large images can outrun it. Log rotation misconfigured on a chatty pod fills /var/log just as effectively, and both look identical from the cluster.',
      branches:[
        { when:'Image store full', then:'Prune images; then reconsider image sizes and GC thresholds.' },
        { when:'/var/log full', then:'Log rotation. Fix the rotation, not just the symptom.' } ] },

    { check:'Is the container runtime healthy?', cmd:'kubectl debug node/NODE -it --image=busybox -- chroot /host crictl info   ·   crictl ps',
      decide:'Whether containerd itself is answering.',
      why:'The kubelet talks to containerd or CRI-O over a socket; if the runtime is wedged the kubelet reports NotReady even though it is running fine itself. `crictl` is the runtime-level equivalent of `docker ps` and works when kubectl cannot see the node at all — worth knowing because it is the only view left in that state.',
      branches:[
        { when:'crictl hangs or errors', then:'Restart the runtime, then the kubelet.' },
        { when:'Runtime fine', then:'Check the CNI — a node with no CNI cannot become Ready.' } ] },

    { check:'Decide: recover or replace', cmd:'kubectl drain NODE --ignore-daemonsets --delete-emptydir-data   ·   kubectl uncordon NODE',
      decide:'Whether this node is worth saving.',
      why:'In a managed node group the honest answer is usually to drain and terminate — the replacement is clean and takes minutes, and time spent nursing one node is rarely repaid. Drain first so pods are rescheduled gracefully rather than evicted after the timeout. Recover in place when the cause is a config change you need to understand, or when the node holds local state.',
      branches:[
        { when:'Managed node group', then:'Drain and terminate; the ASG replaces it.' },
        { when:'It holds local data', then:'Recover in place, carefully.' },
        { when:'Several nodes at once', then:'Not a node problem — look at the control plane or the network.' } ] } ],
  probes:[
    ['How long before pods are evicted from a NotReady node?','The node controller marks it unreachable after about 40 seconds and applies a NoExecute taint; the default toleration then keeps pods for 300 seconds before eviction. So roughly five minutes, and tolerationSeconds can change it per pod.'],
    ['Every node went NotReady at once. Where do you look?','Not at the nodes. That is the control plane, cluster-wide networking, or a certificate everything shares. Check API server health and whether the kubelets can reach it.'],
    ['What is the difference between cordon, drain and delete?','Cordon marks it unschedulable but changes nothing running. Drain cordons and then evicts, respecting PodDisruptionBudgets. Delete removes the object from the API without touching the machine, which will re-register if the kubelet is alive.'],
    ['Why can a node be Ready but still not run pods?','A taint, or exhausted pod IP addresses on the CNI — on the AWS VPC CNI, ENI limits cap pods per instance type regardless of CPU and memory.']
  ],
  trap:'Debugging one node for an hour when the node group would replace it in three minutes. Diagnose long enough to know it is not systemic, then replace.',
  remember:'Read the conditions, then the kubelet journal. Most NotReady nodes are disk, the kubelet, or the path to the API server.',
  mission:null
},

/* ═══ 9. PVC pending ═══ */
{
  id:'cn-pvc-pending', track:'containers', title:'A PersistentVolumeClaim will not bind', cat:'storage', level:'intermediate',
  cert:['cka:storage','cka:troubleshooting'],
  prompt:'"A StatefulSet pod is Pending and its PVC says Pending too. Why?"',
  say:'"A claim stays Pending when nothing can satisfy it, and the events on the claim say which of the three reasons it is: there is no StorageClass to provision from, the provisioner failed, or the volume exists but cannot be attached where the pod needs to run — which is almost always a zone mismatch with block storage. The pod is Pending as a consequence, so I debug the claim, not the pod."',
  steps:[
    { check:'What does the claim itself say?', cmd:'kubectl describe pvc NAME | sed -n "/Events:/,$p"',
      decide:'The provisioner logs its refusal here in plain language.',
      why:'The claim is the object that failed, so its events are the primary source — the pod is just waiting on it. "no persistent volumes available for this claim and no storage class is set" means there is no default StorageClass. A provisioner error names the cloud API failure directly, often a quota or a permission.',
      branches:[
        { when:'no storage class is set', then:'No default class, and none named. Next step.' },
        { when:'ProvisioningFailed with a cloud error', then:'Quota, permissions or an invalid parameter.' },
        { when:'waiting for first consumer', then:'Normal — WaitForFirstConsumer binds at scheduling time.' } ] },

    { check:'Is there a StorageClass to use?', cmd:'kubectl get sc   ·   kubectl get pvc NAME -o jsonpath=\'{.spec.storageClassName}{"\\n"}\'',
      decide:'Whether one is marked default, and whether the claim names one that exists.',
      why:'A claim with no `storageClassName` uses the class annotated as default; a cluster with no default and a claim that names none waits forever. A claim naming a class that does not exist behaves identically. Both are common after a cluster migration where the class names differ between providers — `gp2` on one cluster, `gp3` or `managed-csi` on another.',
      branches:[
        { when:'No default class', then:'Set one, or name a class in the claim.' },
        { when:'Named class does not exist', then:'A typo, or a manifest carried over from another cluster.' },
        { when:'Class exists', then:'Check the provisioner and its permissions.' } ] },

    { check:'Is the CSI driver running and allowed?', cmd:'kubectl -n kube-system get pods -l app=ebs-csi-controller   ·   kubectl -n kube-system logs deploy/ebs-csi-controller -c ebs-plugin --tail=40',
      decide:'The controller is up, and its logs show the cloud call succeeding.',
      why:'On EKS the EBS CSI driver is a separate addon with its own IAM role — clusters upgraded from in-tree volumes often lose provisioning because the addon was never installed or its service account lacks `ec2:CreateVolume`. The controller logs show the actual AWS error, which is far more specific than the claim event.',
      branches:[
        { when:'Driver missing', then:'Install the addon; in-tree provisioning is gone.' },
        { when:'AccessDenied in the logs', then:'The driver\'s IAM role or managed identity.' },
        { when:'Quota errors', then:'A cloud limit, not a cluster problem.' } ] },

    { check:'Is it a zone conflict?', cmd:'kubectl get pv PVNAME -o jsonpath=\'{.spec.nodeAffinity}\'   ·   kubectl get nodes -L topology.kubernetes.io/zone',
      decide:'The volume\'s zone against the zones of schedulable nodes.',
      why:'Block storage is zonal: an EBS volume in us-east-1a can only attach to a node in us-east-1a. If the pod is scheduled elsewhere it stays Pending with a volume node affinity conflict — and this is exactly what `volumeBindingMode: WaitForFirstConsumer` prevents, by deferring volume creation until the scheduler has picked a node. A class with Immediate binding creates the volume first and hopes.',
      branches:[
        { when:'Volume and nodes in different zones', then:'Move to WaitForFirstConsumer, or add capacity in that zone.' },
        { when:'Same zone', then:'Check whether the volume is already attached elsewhere.' } ] },

    { check:'Is the volume already attached to another node?', cmd:'kubectl get volumeattachment | grep PVNAME   ·   aws ec2 describe-volumes --volume-ids vol-0a1b --query "Volumes[].Attachments"',
      decide:'ReadWriteOnce means one node at a time, and a stuck attachment blocks the next.',
      why:'When a node dies uncleanly the volume can remain attached to it from the cloud\'s point of view, so the replacement pod cannot mount it — "Multi-Attach error" or a mount that hangs for six minutes. That timeout is deliberate: detaching a volume from a node that might still be writing risks corruption. Force-detach only when you are certain the old node is gone.',
      branches:[
        { when:'Attached to a dead node', then:'Force-detach once you are sure it is gone, then let it reattach.' },
        { when:'Multi-Attach error', then:'Two pods want one RWO volume — you need RWX storage, or one replica.' } ] } ],
  probes:[
    ['ReadWriteOnce, ReadWriteMany, ReadWriteOncePod?','RWO is one node at a time — EBS and most block storage. RWX is many nodes at once and needs a shared filesystem such as EFS, Azure Files or NFS. RWOncePod is stricter still: one pod, not just one node.'],
    ['Why WaitForFirstConsumer?','Because with Immediate binding the volume is created before the scheduler has chosen a node, so it can land in a zone with no capacity for the pod. Waiting means the volume is created in the zone the pod is actually going to.'],
    ['What happens to a PVC when you delete the pod?','Nothing — the claim outlives the pod, which is the point. Deleting the claim is what triggers the reclaim policy, and with Delete the underlying volume goes too. StatefulSet PVCs are not deleted with the StatefulSet unless you say so.'],
    ['Where does data go when a StatefulSet pod is rescheduled?','With it: the pod keeps its stable name and its claim, so api-0 reattaches the same volume. That is the whole reason to use a StatefulSet rather than a Deployment.']
  ],
  trap:'Debugging the pod. The pod is Pending because the claim is Pending — the events that matter are on the claim, not the pod.',
  remember:'Read the claim\'s events. No class, provisioner failure, or a zonal volume in the wrong zone — it is nearly always one of those three.',
  mission:null
}


);
