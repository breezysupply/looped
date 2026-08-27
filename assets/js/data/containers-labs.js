/* Containers labs. Same shape as data/labs.js: pick a command, read realistic
   output, work the problem. The two here deliberately span layers rather than
   staying inside one object — 502s and NotReady nodes are the incidents where
   the trap is diagnosing the layer you happen to be looking at.               */
window.LX = window.LX || {};
LX.labs = LX.labs || [];

LX.labs.push(

/* ─────────────────────────────────────────── 1. ingress 502 ── */
{
  id:'cn-ingress-502', title:'The ingress returns 502 for one service', cat:'svc',
  track:'containers', level:'intermediate', mins:9,
  brief:'11:20. checkout.example.com returns 502 Bad Gateway. Every other host through the same ingress controller is fine, and the checkout deploy went out twenty minutes ago. You have kubectl against the cluster.',
  user:'you', host:'kubectl',
  steps:[
    { kind:'think',
      ask:'A 502 came from the ingress controller, not from your app. What does that narrow it to before you type anything?',
      hint:'Think about who generated the status code.',
      opts:[
        { t:'The controller accepted the request and failed to get a usable response from an upstream — so the fault is between the controller and the pods', ok:true,
          fb:'Right, and it is the single most useful thing to establish first. A 502 is the proxy telling you it could not talk to a backend: no endpoints, a refused connection, a wrong port, or a pod that died mid-request. A 404 would mean the rule did not match; a 503 usually means no endpoints at all; a timeout at the browser means the load balancer never answered.' },
        { t:'The application returned 502 and the controller passed it through',
          fb:'Possible in principle — an app can emit a 502 of its own if it proxies onward — but it is the rare case, and the controller logs will tell you which happened. Assume the proxy until you have evidence otherwise.' },
        { t:'DNS for checkout.example.com is wrong',
          fb:'Then you would not reach the controller at all, and you would get a resolution failure or a connection to the wrong address — not a well-formed 502 from nginx.' },
        { t:'TLS is misconfigured on the ingress',
          fb:'A bad certificate breaks the handshake before any HTTP status exists. You would see a certificate error in the browser, not a 502.' }
      ] },

    { kind:'cmd',
      ask:'Start at the layer the controller talks to. What do you run?',
      hint:'The proxy forwards to endpoints, not to a Service abstraction.',
      opts:[
        { c:'kubectl get endpoints checkout -n shop', ok:true,
          out:'NAME       ENDPOINTS   AGE\ncheckout   <none>      86d',
          fb:'There it is. The Service exists and has been there for 86 days, but it currently selects nothing — so the controller has no address to forward to and answers 502. Everything after this is finding out why the endpoint list emptied.',
          parts:[['kubectl get endpoints','The addresses a Service actually resolves to — the derived list, not the definition'],['checkout','The Service name; the endpoints object shares it'],['-n shop','The namespace. Without it you query default and get "not found", which reads like a much scarier problem than it is']] },
        { c:'kubectl get ingress -n shop',
          out:'NAME       CLASS   HOSTS                   ADDRESS         PORTS     AGE\nshop       nginx   checkout.example.com    10.0.32.14      80, 443   86d',
          fb:'Useful context — the rule exists and has an address — but an ingress that is wired up correctly still 502s when the Service behind it is empty. You have not moved yet.' },
        { c:'kubectl logs -n ingress-nginx deploy/ingress-nginx-controller --tail=20',
          out:'2026-08-27T11:20:41Z [error] 219#219: *884213 connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://10.244.3.19:8080/checkout"\n10.0.1.7 - - [27/Aug/2026:11:20:41 +0000] "GET /checkout HTTP/1.1" 502 150',
          fb:'Not wrong at all — this is real evidence and names the upstream address and port. But you still have to go and ask what that upstream is, which is the endpoints query. Read the logs when the endpoint list looks healthy and you need to know why the connection failed.' },
        { c:'kubectl rollout undo deploy/checkout -n shop',
          out:'deployment.apps/checkout rolled back',
          fb:'You may well end up here, and rolling back a twenty-minute-old deploy is often the right call under pressure. But doing it before you know what broke means you learn nothing and you cannot tell whether it worked for the reason you think.' }
      ] },

    { kind:'cmd',
      ask:'No endpoints. A Service selects pods by label. Check what it is asking for.',
      hint:'You want the selector, in full, exactly as written.',
      opts:[
        { c:'kubectl get svc checkout -n shop -o yaml', ok:true,
          out:'spec:\n  clusterIP: 10.96.41.8\n  ports:\n  - name: http\n    port: 80\n    protocol: TCP\n    targetPort: 8080\n  selector:\n    app: checkout\n    tier: web\n  type: ClusterIP',
          fb:'The Service wants app=checkout AND tier=web. Both labels, not either. Selectors are an AND across every key — one missing label is enough to select nothing.',
          parts:[['-o yaml','Print the full object rather than the summary table; the selector is not in the default columns'],['svc checkout','The Service, which owns the selector — the endpoints object is derived from it']] },
        { c:'kubectl describe svc checkout -n shop',
          out:'Name:              checkout\nNamespace:         shop\nSelector:          app=checkout,tier=web\nType:              ClusterIP\nIP:                10.96.41.8\nPort:              http  80/TCP\nTargetPort:        8080/TCP\nEndpoints:         <none>\nSession Affinity:  None',
          fb:'This works too, and arguably reads better — it shows the selector and the empty endpoint list in one place. Either answer gets you the selector; the point is that you went to look at it.' },
        { c:'kubectl get pods -n shop',
          out:'NAME                        READY   STATUS    RESTARTS   AGE\ncheckout-7d9f4b6c88-4kx2n   1/1     Running   0          19m\ncheckout-7d9f4b6c88-r7ttz   1/1     Running   0          19m\npayments-5c7b9d4f6-mn88q    1/1     Running   0          31d',
          fb:'Two checkout pods, Running and Ready. That is worth knowing — it rules out a crash — but it makes the empty endpoint list stranger, not clearer. You still need to compare labels against the selector.' },
        { c:'kubectl delete svc checkout -n shop',
          out:'service "checkout" deleted',
          fb:'You just deleted the object you were diagnosing, along with its ClusterIP, and anything holding a cached DNS answer now fails differently. Never delete to force a rebuild before you have read what the thing said.' }
      ] },

    { kind:'cmd',
      ask:'Selector is app=checkout,tier=web. What labels do the pods actually carry?',
      hint:'There is a flag that prints labels as a column.',
      opts:[
        { c:'kubectl get pods -n shop --show-labels', ok:true,
          out:'NAME                        READY   STATUS    RESTARTS   AGE   LABELS\ncheckout-7d9f4b6c88-4kx2n   1/1     Running   0          19m   app=checkout,pod-template-hash=7d9f4b6c88\ncheckout-7d9f4b6c88-r7ttz   1/1     Running   0          19m   app=checkout,pod-template-hash=7d9f4b6c88\npayments-5c7b9d4f6-mn88q    1/1     Running   0          31d   app=payments,tier=web,pod-template-hash=5c7b9d4f6',
          fb:'Found it. The new checkout pods carry app=checkout but no tier=web — payments still has it, which is why only this one host 502s. The deploy dropped a label from the pod template and the Service quietly stopped matching.',
          parts:[['--show-labels','Append a LABELS column; without it you are comparing a selector against invisible data'],['get pods','The label lives on the pod, which is what the selector reads — not on the Deployment']] },
        { c:'kubectl get pods -n shop -l app=checkout,tier=web',
          out:'No resources found in shop namespace.',
          fb:'A good second move — running the selector as a query is exactly what the endpoints controller does, and an empty result confirms it matches nothing. It just does not tell you which of the two labels is missing, so you would still need --show-labels next.' },
        { c:'kubectl describe pod checkout-7d9f4b6c88-4kx2n -n shop',
          out:'Name:             checkout-7d9f4b6c88-4kx2n\nNamespace:        shop\nLabels:           app=checkout\n                  pod-template-hash=7d9f4b6c88\nStatus:           Running\nContainers:\n  checkout:\n    State:          Running\n    Ready:          True',
          fb:'It contains the answer, and describe is the right instinct generally. But you would have to run it per pod to see that both are affected — the labels column compares every pod at once.' },
        { c:'kubectl label pod checkout-7d9f4b6c88-4kx2n tier=web -n shop',
          out:'pod/checkout-7d9f4b6c88-4kx2n labeled',
          fb:'This does fix that one pod, and it will make the 502 partly go away — which is exactly why it is dangerous. The Deployment still has the wrong template, so the next rollout, eviction, or scale event recreates pods without the label and the incident returns with no obvious cause.' }
      ] },

    { kind:'think',
      ask:'You could label the running pods and the 502 would stop. Why is that the wrong fix?',
      hint:'Ask what created these pods and what happens the next time it does.',
      opts:[
        { t:'The Deployment template is the source of truth — any new pod is created without tier=web, so the fix lasts until the next rollout or reschedule', ok:true,
          fb:'Exactly. Labelling a pod edits an object the ReplicaSet will happily replace. Worse, it hides the regression: the next person sees an incident with no recent change attached to it.' },
        { t:'Labelling pods requires cluster-admin and you probably do not have it',
          fb:'RBAC is not the objection — you very likely can patch a pod in your own namespace. The problem is durability, not permission.' },
        { t:'Adding a label restarts the pod and causes a second outage',
          fb:'It does not. Labels are metadata; changing them does not recreate the container. That is precisely why the change looks harmless and is easy to leave behind.' },
        { t:'It would make the Service select payments pods too',
          fb:'No — payments carries app=payments, and the selector requires app=checkout as well. Selectors AND their keys together, so there is no accidental cross-match here.' }
      ] },

    { kind:'cmd',
      ask:'Confirm the template is what dropped the label.',
      hint:'You want the labels on the pod template inside the Deployment, not on the Deployment object itself.',
      opts:[
        { c:'kubectl get deploy checkout -n shop -o jsonpath=\'{.spec.template.metadata.labels}\'', ok:true,
          out:'{"app":"checkout"}',
          fb:'Confirmed at the source: the pod template sets app only. The Deployment\'s own metadata may still say tier=web, which is exactly how this slips through review — the label is present in the file, just at the wrong level.',
          parts:[['-o jsonpath=','Extract one field instead of reading a hundred lines of YAML'],['.spec.template.metadata.labels','The labels stamped onto every pod the Deployment creates — a different field from .metadata.labels on the Deployment itself']] },
        { c:'kubectl describe deploy checkout -n shop',
          out:'Name:                   checkout\nNamespace:              shop\nSelector:               app=checkout\nLabels:                 app=checkout\n                        tier=web\nPod Template:\n  Labels:  app=checkout\n  Containers:\n   checkout:\n    Port:  8080/TCP',
          fb:'Also correct, and it shows the trap plainly: the Deployment carries tier=web at the top and the pod template does not. Someone edited the wrong block.' },
        { c:'kubectl get rs -n shop',
          out:'NAME                  DESIRED   CURRENT   READY   AGE\ncheckout-7d9f4b6c88   2         2         2       19m\ncheckout-64bb9f7d52   0         0         0       6d',
          fb:'Shows the new ReplicaSet took over 19 minutes ago, which lines up with the deploy. Good corroboration of when, but it does not tell you what changed.' },
        { c:'kubectl rollout history deploy/checkout -n shop',
          out:'REVISION  CHANGE-CAUSE\n8         <none>\n9         <none>',
          fb:'Empty change causes, which is common and unhelpful. History tells you a rollout happened; it does not tell you what was in it unless someone recorded a cause.' }
      ] },

    { kind:'cmd',
      ask:'Fix it at the source so the next pod is created correctly.',
      hint:'Change the template, not the pods.',
      opts:[
        { c:'kubectl patch deploy checkout -n shop --type=merge -p \'{"spec":{"template":{"metadata":{"labels":{"tier":"web"}}}}}\'', ok:true,
          out:'deployment.apps/checkout patched',
          fb:'This edits the template, which triggers a rollout, which creates pods carrying both labels — and the Service picks them up as they become Ready. Follow it into the manifest in git, or the next deploy from source undoes you.',
          parts:[['kubectl patch','Change one field in place rather than replacing the object'],['--type=merge','Merge the fragment into the existing object; the default strategic merge is fine here too, but merge is unambiguous for a plain map'],['spec.template.metadata.labels','The template again — patching .metadata.labels would change nothing about the pods']] },
        { c:'kubectl label deploy checkout tier=web -n shop',
          out:'deployment.apps/checkout labeled',
          fb:'This labels the Deployment object, which already had the label. Pods are unaffected, endpoints stay empty, and the 502 continues — while the output says "labeled" and looks like success.' },
        { c:'kubectl rollout restart deploy/checkout -n shop',
          out:'deployment.apps/checkout restarted',
          fb:'Recreates the pods from the same template, so they come back missing the same label. A restart cannot fix a definition problem, and it burns a couple of minutes you do not have.' },
        { c:'kubectl edit svc checkout -n shop',
          out:'(opens the Service in an editor)',
          fb:'Deleting tier=web from the selector would also restore traffic, and sometimes the selector genuinely is the wrong side. Here it is not: payments uses the same convention, so loosening checkout leaves the cluster inconsistent and quietly changes what the Service means.' }
      ] },

    { kind:'cmd',
      ask:'Verify — and do it at the layer that was broken.',
      hint:'The thing that was empty should no longer be empty.',
      opts:[
        { c:'kubectl get endpoints checkout -n shop', ok:true,
          out:'NAME       ENDPOINTS                           AGE\ncheckout   10.244.3.28:8080,10.244.5.11:8080   86d',
          fb:'Two endpoints on the container port. The endpoints controller reads pod labels and readiness continuously, so this filling in is direct proof that the selector now matches Ready pods — which is what the ingress needed.',
          parts:[['get endpoints','Verify at the layer that failed, not two layers away'],['10.244.3.28:8080','Pod IPs on targetPort 8080, not the Service port 80 — the proxy connects to the pod directly']] },
        { c:'kubectl get pods -n shop --show-labels',
          out:'NAME                        READY   STATUS    RESTARTS   AGE   LABELS\ncheckout-5f8c6d9b47-2p9wz   1/1     Running   0          40s   app=checkout,tier=web,pod-template-hash=5f8c6d9b47\ncheckout-5f8c6d9b47-hd6bk   1/1     Running   0          25s   app=checkout,tier=web,pod-template-hash=5f8c6d9b47',
          fb:'Good evidence that the template took effect, and worth running. But labels being right is one step short: a pod can carry the right labels and still be excluded from endpoints if its readiness probe is failing.' },
        { c:'curl -sS -o /dev/null -w \'%{http_code}\' https://checkout.example.com/healthz',
          out:'200',
          fb:'The real end-to-end proof, and you should finish here. On its own though it can mislead — a cached response or a healthy second replica can return 200 while the underlying problem is only half fixed. Check endpoints, then curl.' },
        { c:'kubectl get svc -n shop',
          out:'NAME       TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)   AGE\ncheckout   ClusterIP   10.96.41.8    <none>        80/TCP    86d\npayments   ClusterIP   10.96.12.3    <none>        80/TCP    31d',
          fb:'The Service listing looked exactly like this while the site was down. A Service always has a ClusterIP whether or not anything is behind it — which is why it is the wrong object to verify against.' }
      ] },

    { kind:'think',
      ask:'Last one. The same symptom — 502, one host only — with a healthy endpoint list. Where do you go next?',
      hint:'The proxy could connect to something and still not get an answer it could use.',
      opts:[
        { t:'The connection itself: wrong targetPort, the container listening on localhost, or a NetworkPolicy blocking the controller namespace', ok:true,
          fb:'That is the right next layer. Endpoints prove the Service selected Ready pods; they prove nothing about whether the controller can open a connection to that port. targetPort pointing at a port nothing listens on, a process bound to 127.0.0.1 instead of 0.0.0.0, and a default-deny NetworkPolicy with no ingress rule for the controller namespace all produce a 502 with a perfectly healthy endpoint list.' },
        { t:'DNS inside the cluster — CoreDNS cannot resolve the Service',
          fb:'Worth knowing but not the path here: the ingress controller resolves the Service to endpoints through the API, and most controllers connect to pod IPs directly. Cluster DNS failures show up in pod-to-pod traffic, not usually at the ingress.' },
        { t:'The load balancer health checks are failing',
          fb:'Then requests would not reach the controller to be answered at all — you would see a timeout or a 503 from the load balancer, and every host behind it would suffer, not just this one.' },
        { t:'The pods are out of memory and being OOMKilled',
          fb:'That is a real 502 cause, but it shows itself in the endpoint list: a restarting pod goes NotReady and drops out. A steady, healthy endpoint list argues against it — check RESTARTS to be sure.' }
      ] }
  ],
  debrief:{
    why:[
      'The status code located the fault before any command ran: a 502 is the proxy failing to use an upstream, which puts the problem between the controller and the pods.',
      'kubectl get endpoints went straight to the derived layer. Endpoints are computed continuously from the selector against pod labels and readiness, so an empty list is a fact about matching, not about the app.',
      'Reading the Service selector and then the pod labels turned "no endpoints" into a specific mismatch: app=checkout,tier=web asked for two labels, the pods carried one.',
      'Labelling the running pods would have cleared the 502 in seconds and left a landmine — the ReplicaSet recreates pods from the template, so the fix survives until the next rollout.',
      'The regression was one indentation level off: tier=web was on the Deployment metadata rather than the pod template, which is why review missed it.',
      'Verification went back to the layer that failed. A ClusterIP exists whether or not anything is behind it, so "the Service is there" was never evidence of anything.',
      'The same symptom with healthy endpoints is a different problem entirely — targetPort, bind address, or NetworkPolicy — and knowing which question you are answering is most of the speed.'
    ],
    interview:'Frame it as narrowing by layer. "A 502 means the proxy could not use an upstream, so I check endpoints first — that is the derived list the controller forwards to. Empty endpoints means the selector matched nothing, so I compare the Service selector against the pod labels; selectors AND every key, so one missing label empties the list. Here the deploy dropped tier=web from the pod template. I fix the template rather than labelling pods, because pods get recreated and a pod-level fix hides the regression. Then I verify on endpoints, not on the Service — a Service always has a ClusterIP. If endpoints had been healthy I would be looking at targetPort, whether the process binds 0.0.0.0, and NetworkPolicy from the controller namespace."',
    prevent:[
      'Generate pod labels from one source — a Helm helper or Kustomize commonLabels — so the Service selector and the pod template cannot drift apart.',
      'Alert on a Service with zero endpoints. It is a cheap, unambiguous signal and it fires before users notice.',
      'Add a smoke test to the deploy that queries the Service through the ingress, so a rollout that empties the endpoint list fails instead of completing.',
      'Keep selectors minimal. Every extra key in a selector is another way for a template edit to silently unmatch every pod.'
    ]
  }
},

/* ─────────────────────────────────── 2. node went NotReady ── */
{
  id:'cn-node-notready', title:'A node went NotReady mid-deploy', cat:'ops',
  track:'containers', level:'advanced', mins:10,
  brief:'A rollout stalled at 6 of 10 pods. One node, ip-10-0-12-84, flipped to NotReady four minutes ago and pods on it are stuck Terminating. Nothing was changed on the node today. Production traffic is degraded but serving.',
  user:'you', host:'kubectl',
  steps:[
    { kind:'cmd',
      ask:'Confirm the scope before you touch anything. What do you run?',
      hint:'Find out whether this is one node or the beginning of several.',
      opts:[
        { c:'kubectl get nodes -o wide', ok:true,
          out:'NAME              STATUS     ROLES    AGE    VERSION   INTERNAL-IP   OS-IMAGE\nip-10-0-4-22      Ready      <none>   214d   v1.29.6   10.0.4.22     Ubuntu 22.04.4 LTS\nip-10-0-9-51      Ready      <none>   214d   v1.29.6   10.0.9.51     Ubuntu 22.04.4 LTS\nip-10-0-12-84     NotReady   <none>   214d   v1.29.6   10.0.12.84    Ubuntu 22.04.4 LTS\nip-10-0-31-7      Ready      <none>   96d    v1.29.6   10.0.31.7     Ubuntu 22.04.4 LTS',
          fb:'One node out of four, same version and image as its healthy siblings. That rules out a fleet-wide upgrade or a bad AMI and makes this a single-host problem — which changes what is worth investigating and how urgently.',
          parts:[['get nodes','The control plane\'s view of every node, which is the only view you have while the node is unreachable'],['-o wide','Adds the internal IP, OS image and kernel — the columns that tell you whether the broken node differs from the healthy ones']] },
        { c:'kubectl get pods -A -o wide | grep 10-0-12-84',
          out:'shop     checkout-7d9f4b6c88-9xk4l   1/1   Terminating   0   22m   10.244.6.31   ip-10-0-12-84\nshop     cart-6b4d8f9c7-tt2vn        1/1   Terminating   0   6d    10.244.6.19   ip-10-0-12-84\nkube-system  kube-proxy-4zzq8        1/1   Running       0   214d  10.0.12.84    ip-10-0-12-84',
          fb:'Real information — those Terminating pods are the visible damage — but it tells you about the consequence rather than the scope. Establish how many nodes are affected first; the answer changes whether you debug or evacuate.' },
        { c:'kubectl describe node ip-10-0-12-84',
          out:'Name:               ip-10-0-12-84\nConditions:\n  Type             Status    Reason\n  ----             ------    ------\n  MemoryPressure   Unknown   NodeStatusUnknown\n  DiskPressure     Unknown   NodeStatusUnknown\n  Ready            Unknown   NodeStatusUnknown',
          fb:'This is the right second command and you will run it next. Going straight here is a small mistake only: you learn a lot about one node without knowing whether three others are about to follow it.' },
        { c:'kubectl delete node ip-10-0-12-84',
          out:'node "ip-10-0-12-84" deleted',
          fb:'You just removed the object holding every piece of evidence about what happened, and if the kubelet recovers it will re-register as a fresh node with none of the history. Deleting a node is a repair step, and it is not the first one.' }
      ] },

    { kind:'cmd',
      ask:'One node. Read what the control plane knows about it.',
      hint:'Conditions and their reasons are the summary; the events at the bottom are the timeline.',
      opts:[
        { c:'kubectl describe node ip-10-0-12-84', ok:true,
          out:'Conditions:\n  Type             Status    LastTransitionTime   Reason              Message\n  MemoryPressure   Unknown   27 Aug 11:41         NodeStatusUnknown   Kubelet stopped posting node status.\n  DiskPressure     True      27 Aug 11:36         KubeletHasDiskPressure   kubelet has disk pressure\n  Ready            Unknown   27 Aug 11:41         NodeStatusUnknown   Kubelet stopped posting node status.\n\nEvents:\n  Type     Reason                 Age    Message\n  Warning  EvictionThresholdMet   9m     Attempting to reclaim ephemeral-storage\n  Warning  ImageGCFailed          8m     failed to garbage collect required amount of images\n  Warning  FreeDiskSpaceFailed    7m     failed to garbage collect required amount of images. Wanted to free 4915MB, but freed 0B',
          fb:'The order in the timeline is the whole story. DiskPressure went True at 11:36; the kubelet stopped posting status at 11:41. Disk filled first and the kubelet fell over after — so NotReady is the symptom, not the fault. "Unknown" rather than "False" means the control plane simply stopped hearing from it.',
          parts:[['describe node','Conditions, capacity, allocated resources and recent events for one node'],['Ready: Unknown','Not the same as False: nobody said the node is unhealthy, the kubelet stopped reporting at all'],['LastTransitionTime','What orders the failure — read these before the messages, because they tell you what caused what']] },
        { c:'kubectl get events -A --sort-by=.lastTimestamp | tail -20',
          out:'11:36:04  Warning  EvictionThresholdMet    node/ip-10-0-12-84   Attempting to reclaim ephemeral-storage\n11:41:22  Normal   NodeNotReady            node/ip-10-0-12-84   Node ip-10-0-12-84 status is now: NodeNotReady\n11:41:24  Warning  FailedScheduling        pod/checkout-7d9f4b6c88-p2wxr   0/4 nodes are available: 1 node(s) had untolerated taint {node.kubernetes.io/unreachable: }, 3 Insufficient cpu.',
          fb:'A genuinely good move, and the timestamps line up with what describe shows. Events age out after an hour by default though, so on a slower incident describe node is the more reliable source for conditions.' },
        { c:'kubectl top node ip-10-0-12-84',
          out:'error: Metrics not available for node ip-10-0-12-84, age: 4m21s',
          fb:'Metrics come through the kubelet, and the kubelet is exactly what stopped answering. The error is consistent with the failure but you learned nothing you did not already know.' },
        { c:'kubectl logs -n kube-system kube-proxy-4zzq8',
          out:'Error from server: Get "https://10.0.12.84:10250/containerLogs/kube-system/kube-proxy-4zzq8": dial tcp 10.0.12.84:10250 connection refused',
          fb:'kubectl logs proxies through the kubelet on port 10250. With the kubelet down, no pod log on that node is reachable through the API — which is the constraint that shapes the rest of this incident.' }
      ] },

    { kind:'think',
      ask:'Ready is Unknown and kubectl logs is refused. What does that tell you about how you have to work from here?',
      hint:'Think about which paths run through the kubelet.',
      opts:[
        { t:'Anything that proxies through the kubelet — logs, exec, port-forward, metrics — is unavailable, so you need SSH to the host', ok:true,
          fb:'Correct, and recognising it early saves several minutes of running commands that cannot work. The API server holds the last reported state and nothing more. Getting onto the box is not a fallback here, it is the only remaining path.' },
        { t:'The node is gone and you should replace it immediately',
          fb:'You may end up replacing it, but not yet — the disk pressure is a symptom of something, and if you never find out what, the replacement fills up too. Replace when you know the cause or when time has run out.' },
        { t:'The API server has lost connectivity to the cluster network',
          fb:'Then the other three nodes would be reporting Unknown too. One node with an unreachable kubelet and three healthy is a host problem, not a control-plane one.' },
        { t:'etcd is unhealthy and node status writes are failing',
          fb:'Same test: etcd trouble is cluster-wide. It would not single out one node while the rest keep updating their status normally.' }
      ] },

    { kind:'cmd',
      ask:'You have SSH to ip-10-0-12-84. First command on the host.',
      hint:'The condition already named the resource. Confirm it directly.',
      opts:[
        { c:'df -h /var/lib/containerd /var/log /', ok:true,
          out:'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p1  100G  100G     0 100% /\n/dev/nvme0n1p1  100G  100G     0 100% /\n/dev/nvme0n1p1  100G  100G     0 100% /',
          fb:'The root filesystem is completely full, and containerd\'s image and snapshot store lives on it. A kubelet that cannot write its own state files stops posting status, which is precisely the sequence the conditions showed.',
          parts:[['df -h','Confirm the condition against the host rather than trusting a four-minute-old report'],['/var/lib/containerd','Where images, snapshots and container filesystems live — on most nodes it is on the root volume, which is why one runaway log fills the whole host'],['0 100%','Not 98%: at zero bytes free, writes fail rather than slow down, which is why services fall over all at once']] },
        { c:'systemctl status kubelet',
          out:'● kubelet.service - kubelet: The Kubernetes Node Agent\n     Active: active (running) since Tue 2026-06-11 09:02:11 UTC; 77d ago\n   Main PID: 1174 (kubelet)\n     Status: "Failed to write status: no space left on device"',
          fb:'Excellent output — the process is alive and telling you exactly why it went quiet. Not a wrong answer at all; df is a hair better only because it quantifies the problem and tells you which filesystem in one line.' },
        { c:'journalctl -u kubelet -n 30 --no-pager',
          out:'Aug 27 11:40:58 kubelet[1174]: E0827 eviction_manager.go:288] "Eviction manager: failed to get summary stats" err="failed to get root cgroup stats"\nAug 27 11:41:09 kubelet[1174]: E0827 kubelet_node_status.go:544] "Error updating node status, will retry" err="no space left on device"\nAug 27 11:41:22 kubelet[1174]: E0827 kubelet.go:2361] "Skipping pod synchronization" err="container runtime is down"',
          fb:'The full timeline, and you should read it. Two things at once though: the kubelet cannot write status, and the container runtime is down. Confirm the disk first so you know which of those is the cause.' },
        { c:'systemctl restart kubelet',
          out:'Job for kubelet.service failed. See "systemctl status kubelet" for details.',
          fb:'Restarting a process that is failing because the disk is full gives you the same process failing because the disk is full — and you have lost whatever in-memory state might have explained it.' }
      ] },

    { kind:'cmd',
      ask:'Root is 100% full. Find the consumer without walking the whole tree.',
      hint:'One level at a time, biggest last.',
      opts:[
        { c:'du -h -d1 /var/lib | sort -h | tail -5', ok:true,
          out:'168M\t/var/lib/apt\n412M\t/var/lib/docker\n2.1G\t/var/lib/kubelet\n71G\t/var/lib/containerd\n74G\t/var/lib',
          fb:'71G in containerd against 2.1G of kubelet state. Image and snapshot storage is the consumer, which points at either an image garbage collection failure or container filesystems that grew — and the ImageGCFailed event you already saw says which.',
          parts:[['du -h -d1','Summarise each child directory rather than every file; on a full disk you want an answer in seconds'],['| sort -h','Rank human-readable sizes properly, so 71G sorts above 412M'],['| tail -5','Only the offenders — the rest is noise']] },
        { c:'crictl images --digests | head',
          out:'IMAGE                            TAG       IMAGE ID       SIZE\nregistry.example.com/checkout    v2026.8.27   4b91cc0e2a11   1.42GB\nregistry.example.com/checkout    v2026.8.26   0c7a19fe33d8   1.41GB\nregistry.example.com/checkout    v2026.8.25   9ff2b1c4e770   1.41GB',
          fb:'You will want this shortly and it hints at the pattern — a large image built fresh every day. Localise the space first though, because containerd could equally be holding writable layers rather than images.' },
        { c:'du -sh /var/lib/containerd',
          out:'71G\t/var/lib/containerd\n\n(took 2m14s)',
          fb:'Right answer, wrong shape. It walks every file under containerd to produce one number you had already guessed, and it takes two minutes you do not have. Depth-limited du gives you the comparison as well as the total.' },
        { c:'rm -rf /var/lib/containerd/io.containerd.content.v1.content',
          out:'(no output)',
          fb:'You just deleted containerd\'s content store underneath a running runtime. Every image on the node is now corrupt, containerd will not start cleanly, and the node needs rebuilding — a recoverable incident turned into a replacement.' }
      ] },

    { kind:'cmd',
      ask:'containerd holds 71G. The kubelet said image GC failed. Reclaim space safely.',
      hint:'Ask the runtime to do it, through its own API.',
      opts:[
        { c:'crictl rmi --prune', ok:true,
          out:'Deleted: registry.example.com/checkout:v2026.7.02\nDeleted: registry.example.com/checkout:v2026.7.03\nDeleted: registry.example.com/cart:v2026.6.28\n... 214 images deleted\n\nreclaimed 63.4 GB',
          fb:'63G back, and safely: prune removes only images no container references, so nothing running is touched. Going through the CRI rather than the filesystem is what keeps containerd\'s metadata consistent with what is on disk.',
          parts:[['crictl','Talks to the CRI socket directly — the tool that still works when the kubelet does not'],['rmi --prune','Remove unused images only; images backing a running container are skipped'],['reclaimed 63.4 GB','The number to check before you decide whether the node is recoverable']] },
        { c:'crictl rmi --all',
          out:'ERRO[0000] no such image or image is in use ... (2 errors)\nDeleted: 214 images',
          fb:'It refuses to remove images in use, so it is less dangerous than it reads. But it also deletes every image the running pods will need on their next restart, so the node re-pulls gigabytes it already had — on a node that just proved its network and disk are under strain.' },
        { c:'docker system prune -af',
          out:'-bash: docker: command not found',
          fb:'This cluster runs containerd, not Docker — there has been no dockershim since 1.24. Reaching for docker on a Kubernetes node is the reflex worth unlearning; crictl and ctr are the equivalents.' },
        { c:'find /var/lib/containerd -type f -size +1G -delete',
          out:'(no output)',
          fb:'Deleting snapshot layers behind containerd\'s back leaves its metadata database pointing at files that no longer exist. The runtime does not notice until it tries to start a container, and then it fails in ways that look like an unrelated problem.' }
      ] },

    { kind:'cmd',
      ask:'Space is back. Get the node reporting again and check it took.',
      hint:'Both the runtime and the kubelet were wedged by the full disk.',
      opts:[
        { c:'systemctl restart containerd kubelet && systemctl is-active containerd kubelet', ok:true,
          out:'active\nactive',
          fb:'Restart the runtime first, then the kubelet that depends on it, and assert both are up rather than assuming. With disk available the kubelet can write status again and the node should return to Ready within a status period.',
          parts:[['restart containerd kubelet','Ordered: the kubelet talks to containerd, so bringing the runtime back first avoids a kubelet that starts against a dead socket'],['&& systemctl is-active','Only checks if the restart succeeded, and gives a machine-readable answer rather than a screenful to read']] },
        { c:'systemctl restart kubelet',
          out:'(no output)',
          fb:'Half the fix. The kubelet comes back and immediately reports the container runtime as down, because containerd is still in whatever state the full disk left it in. Restart the runtime too.' },
        { c:'reboot',
          out:'Connection to 10.0.12.84 closed by remote host.',
          fb:'It would probably work, and it destroys the evidence for the post-incident review while taking every remaining pod on the node down at once. Reboot when a targeted restart has failed, not before.' },
        { c:'kubectl uncordon ip-10-0-12-84',
          out:'node/ip-10-0-12-84 uncordoned',
          fb:'Reads like success and changes nothing. Nothing had cordoned the node — it went NotReady on its own, which is a different state from SchedulingDisabled. Uncordon clears a flag that was never set, and the node stays NotReady.' }
      ] },

    { kind:'cmd',
      ask:'Back on kubectl. Confirm the cluster agrees the node recovered.',
      hint:'Watch the object that was Unknown.',
      opts:[
        { c:'kubectl get node ip-10-0-12-84 -w', ok:true,
          out:'NAME            STATUS     ROLES    AGE    VERSION\nip-10-0-12-84   NotReady   <none>   214d   v1.29.6\nip-10-0-12-84   Ready      <none>   214d   v1.29.6',
          fb:'Ready, from the control plane\'s own view, which is the only opinion that matters for scheduling. The Terminating pods clear once the kubelet confirms they are gone, and the stalled rollout resumes on its own.',
          parts:[['get node','Ask the API server, not the host — the host being healthy and the cluster knowing it are two different facts'],['-w','Watch: stream transitions instead of polling, so you see the moment it flips rather than guessing when to re-run']] },
        { c:'kubectl describe node ip-10-0-12-84 | head -20',
          out:'Conditions:\n  Type             Status  Reason                       Message\n  MemoryPressure   False   KubeletHasSufficientMemory   kubelet has sufficient memory available\n  DiskPressure     False   KubeletHasNoDiskPressure     kubelet has no disk pressure\n  Ready            True    KubeletReady                 kubelet is posting ready status',
          fb:'Stronger in one way — it shows DiskPressure cleared as well as Ready, which is the condition that actually caused this. A fine answer; watching the status column is just the faster loop.' },
        { c:'kubectl get pods -A --field-selector spec.nodeName=ip-10-0-12-84',
          out:'NAMESPACE     NAME                        READY   STATUS    RESTARTS   AGE\nkube-system   kube-proxy-4zzq8            1/1     Running   1          214d\nshop          cart-6b4d8f9c7-9lqxs        1/1     Running   0          38s',
          fb:'Useful confirmation that workloads are scheduling and running there again. It is downstream of Ready though — if the node had not recovered, this list would simply stay empty and you would not know why.' },
        { c:'kubectl rollout status deploy/checkout -n shop',
          out:'deployment "checkout" successfully rolled out',
          fb:'The outcome you wanted, and worth running last. As a check on the node it is indirect: the rollout could complete on the three healthy nodes while this one is still broken.' }
      ] },

    { kind:'think',
      ask:'Suppose crictl rmi --prune had freed only 2G. Repair or replace?',
      hint:'Weigh what you would learn against what the delay costs.',
      opts:[
        { t:'Cordon and drain it, then let the autoscaler replace it — and keep the root cause investigation going on the replacement', ok:true,
          fb:'Right instinct on a cattle node. Draining moves the workload off in an orderly way rather than waiting for eviction timeouts, and a fresh node restores capacity in minutes. The judgement is that you were not going to find the cause quickly, not that the cause stopped mattering — 71G of images is a node-level image GC policy problem and it will recur on the replacement.' },
        { t:'Keep digging on the host until you find the last 60G',
          fb:'Defensible if this node were special — a stateful workload, or the only place the evidence lives — but during degraded production it trades user impact for curiosity. Take a snapshot of the volume and investigate that instead.' },
        { t:'Delete the node object so the scheduler stops considering it',
          fb:'The scheduler already stopped: NotReady carries a taint that keeps new pods off. Deleting the object while the kubelet may yet recover produces a node that re-registers with no history, and you lose the record.' },
        { t:'Expand the root volume and move on',
          fb:'It buys time and is sometimes the correct emergency action, but at 71G of images the growth is unbounded — a bigger disk fills too. Do it only alongside fixing image GC thresholds.' }
      ] }
  ],
  debrief:{
    why:[
      'Scoping first — one NotReady node out of four, all on the same version — ruled out a bad upgrade and made this a single-host problem before any time was spent on it.',
      'The conditions block ordered the failure: DiskPressure True at 11:36, kubelet status Unknown at 11:41. Disk filled first, so NotReady was the consequence and not the cause.',
      'Ready: Unknown means the kubelet stopped reporting, which is different from Ready: False. It also means logs, exec, port-forward and metrics are all unavailable, because every one of them proxies through the kubelet.',
      'That constraint is what forced SSH. Recognising it early avoided several minutes of kubectl commands that could not have worked.',
      'On the host, df confirmed the condition and depth-limited du localised 71G to /var/lib/containerd in seconds, rather than a du -sh that would have taken minutes to say less.',
      'crictl rmi --prune reclaimed the space through the runtime\'s own API, so containerd\'s metadata stayed consistent with the filesystem. Deleting layers by hand is what turns a recoverable node into a rebuild.',
      'containerd was restarted before the kubelet, because the kubelet depends on it, and recovery was confirmed from the control plane rather than from the host that had just been declared healthy by itself.'
    ],
    interview:'Lead with the distinction most people miss. "NotReady with condition Unknown means the kubelet stopped posting status — nobody has said the node is unhealthy, the control plane just stopped hearing from it. So the first thing I read is the transition times in the conditions block, because they order cause and effect: here DiskPressure went True five minutes before status went Unknown, which makes disk the cause. Unknown also means logs and exec are gone, since those proxy through the kubelet, so I SSH in. df and a depth-limited du put 71G in /var/lib/containerd, and the ImageGCFailed event said the runtime had already tried and failed to reclaim it. crictl rmi --prune through the CRI, never rm on the snapshot store, because deleting layers behind containerd corrupts its metadata. Restart containerd then kubelet, and confirm Ready from kubectl. If prune had not freed enough I would cordon, drain and replace rather than keep production degraded, and chase the root cause on a volume snapshot."',
    prevent:[
      'Put /var/lib/containerd on its own volume, so a runaway image cache degrades the runtime instead of taking the kubelet and the whole host with it.',
      'Tune the kubelet image GC thresholds — imageGCHighThresholdPercent and imageGCLowThresholdPercent — so collection starts well before eviction does, and alert on ImageGCFailed rather than on NotReady.',
      'Stop tagging every build uniquely without a retention policy: a 1.4G image built daily and never collected is exactly 71G in fifty days.',
      'Alert on node conditions, not just Ready. DiskPressure was True for five minutes before anything user-visible happened, and that is the window where a page is cheap to act on.',
      'Set PodDisruptionBudgets so a single node loss during a rollout degrades capacity rather than stalling it, and practise drain-and-replace so it is a routine action rather than a decision made at 11:40.'
    ]
  }
}

);
