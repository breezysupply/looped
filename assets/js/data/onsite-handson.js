/* Onsite track — hands-on scenarios for a REAL practice cluster.

   Written for the two environments the team suggested: the Killercoda
   Kubernetes playground and Docker Desktop's built-in Kubernetes. Original
   scenarios covering the fundamentals the team named — navigating a cluster,
   deploying and running an app, exposing it outside the cluster, updating,
   configuring and troubleshooting. Nothing here is an actual interview task.

   Everything runs in a namespace called `practice`, and every command names it.
   The app cannot see your cluster, so completion is self-reported; each
   scenario ends with a copy-paste check that prints PASS or FAIL.

   Multi-line strings are arrays of lines (the app joins them). Fields `test`,
   `re` and `wait` are read only by labs/hands-on/validate.sh, which runs every
   scenario against a real cluster; see labs/hands-on/VALIDATION.md.

   Generated from a template, but safe to edit by hand. */
window.LX = window.LX || {};
LX.onsiteHandsIntro = {
  "warning": "Run these only in a practice cluster — the Killercoda playground or Docker Desktop's built-in Kubernetes — never a work cluster. Everything happens in a namespace called `practice`, and every command names it with `-n practice`.",
  "envs": [
    {
      "name": "Killercoda Kubernetes playground",
      "url": "https://killercoda.com/playgrounds/scenario/kubernetes",
      "note": "A two-node kubeadm cluster in your browser, nothing to install. Sessions are time-limited, so every scenario starts with a setup block that recreates what it needs."
    },
    {
      "name": "Docker Desktop Kubernetes",
      "url": "https://docs.docker.com/desktop/features/kubernetes/",
      "note": "Enable Kubernetes in Docker Desktop's settings; kubectl then has a `docker-desktop` context. Node ports and LoadBalancer Services are usually reachable on localhost."
    }
  ],
  "more": {
    "name": "Chad Crowell's Killercoda scenarios",
    "url": "https://killercoda.com/chadmcrowell/",
    "note": "Guided scenarios the team recommended — good extra reps alongside these."
  }
};
LX.onsiteHands = [
  {
    "id": "ons-hands-01",
    "title": "Find your way around a cluster",
    "mins": 25,
    "priority": "P0",
    "topic": "navigation",
    "goal": "Confirm where you are before touching anything, then learn the reads you will use constantly: nodes, namespaces, resource kinds, `explain`, output formats, labels and events.",
    "setup": [],
    "tasks": [
      {
        "do": "Confirm which cluster kubectl is talking to, and list every context it knows.",
        "hint": "kubectl keeps named contexts in your kubeconfig; one of them is current.",
        "cmd": [
          "kubectl config current-context",
          "kubectl config get-contexts"
        ],
        "expect": "One current context marked with `*`. On Killercoda it is usually `kubernetes-admin@kubernetes`; on Docker Desktop it is `docker-desktop`.",
        "why": "Every kubectl command goes to the current context unless you pass `--context`. Checking it first is the habit that stops practice commands landing on a real cluster.",
        "re": "\\S",
        "env": null
      },
      {
        "do": "List the nodes with their roles, versions and internal IPs.",
        "hint": "`get nodes`, with the wide output format.",
        "cmd": "kubectl get nodes -o wide",
        "expect": "Each node with STATUS Ready, ROLES (control-plane or <none>), VERSION and INTERNAL-IP. Killercoda has two nodes (controlplane and node01); Docker Desktop usually has one.",
        "why": "Nodes are the machines pods run on. INTERNAL-IP matters later: a NodePort Service is reached on a node's IP.",
        "re": "Ready",
        "env": null
      },
      {
        "do": "List the namespaces, then every pod in every namespace.",
        "hint": "`-A` is short for `--all-namespaces`.",
        "cmd": [
          "kubectl get namespaces",
          "kubectl get pods -A"
        ],
        "expect": "Namespaces such as default and kube-system. The system pods (CoreDNS, kube-proxy, and on kubeadm clusters the API server, scheduler, controller-manager and etcd) live in kube-system.",
        "why": "Namespaces group and scope names, quotas and RBAC. They do not, on their own, isolate network traffic.",
        "re": "kube-system",
        "env": null
      },
      {
        "do": "Create the namespace this practice will use.",
        "hint": "Namespaces can be created imperatively with `kubectl create`.",
        "cmd": "kubectl create namespace practice",
        "expect": "`namespace/practice created` (or AlreadyExists if you ran it before — that is fine).",
        "why": "Keeping practice in its own namespace makes cleanup one command and keeps your experiments away from system components.",
        "test": "kubectl create namespace practice --dry-run=client -o yaml | kubectl apply -f -",
        "re": "namespace/practice",
        "env": null
      },
      {
        "do": "See which resource kinds the cluster knows, their short names, and whether they are namespaced.",
        "hint": "There is a command that lists API resources.",
        "cmd": "kubectl api-resources | grep -E '^(NAME|pods|deployments|services|configmaps|nodes|namespaces) '",
        "expect": "Rows like `pods  po  v1  true  Pod` and `deployments  deploy  apps/v1  true  Deployment`. Nodes and namespaces show NAMESPACED false. Run it without the grep to see the full list — it is long.",
        "why": "Short names (po, deploy, svc, cm) are what you type under time pressure; the NAMESPACED column tells you whether `-n` means anything for that kind.",
        "re": "deploy",
        "env": null
      },
      {
        "do": "Ask the cluster to document a field you do not remember: a Deployment's update strategy.",
        "hint": "kubectl can explain any field path.",
        "cmd": "kubectl explain deployment.spec.strategy",
        "expect": "The field description, its type, and sub-fields such as `rollingUpdate` and `type`.",
        "why": "`explain` reads the schema from the API server itself, so it matches your cluster's version — faster and more reliable than searching when you are writing YAML.",
        "re": "rollingUpdate",
        "env": null
      },
      {
        "do": "Find the cluster DNS pods by label, and show their labels.",
        "hint": "CoreDNS pods carry the label `k8s-app=kube-dns` on most clusters. Filter with `-l`.",
        "cmd": "kubectl get pods -n kube-system -l k8s-app=kube-dns -o wide --show-labels",
        "expect": "One or two coredns pods, the node each runs on, and their labels.",
        "why": "Labels are how Kubernetes objects find each other — Services select pods by label, and so can you.",
        "re": "coredns",
        "env": null
      },
      {
        "do": "Pull one specific field out of the API: the names of all nodes.",
        "hint": "`-o jsonpath` takes a path into the object.",
        "cmd": "kubectl get nodes -o jsonpath='{.items[*].metadata.name}{\"\\n\"}'",
        "expect": "The node names on one line.",
        "why": "jsonpath is how you script against kubectl without parsing table output.",
        "re": "\\S",
        "env": null
      },
      {
        "do": "Read the most recent events across the cluster.",
        "hint": "Events are objects too; sort them by time.",
        "cmd": "kubectl get events -A --sort-by=.lastTimestamp | tail -10",
        "expect": "Recent events with TYPE, REASON, OBJECT and MESSAGE. On a quiet cluster there may be few.",
        "why": "Events are the controllers and kubelet explaining what they did and why — usually the first place the cause of a problem shows up. They are kept only for a limited time.",
        "re": ".*",
        "env": null
      }
    ],
    "check": {
      "cmd": "[ \"$(kubectl get namespace practice -o jsonpath='{.status.phase}')\" = Active ] && echo PASS || echo 'FAIL: namespace practice does not exist'",
      "expect": "PASS"
    },
    "cleanup": "# nothing to clean up yet: the next scenarios use the practice namespace",
    "talk": "\"Before I change anything I check the context and namespace. Then I orient with get nodes, get pods -A, and events; I use explain and api-resources rather than guessing field names.\"",
    "lessons": [
      "les-reconcile",
      "les-workloads"
    ],
    "questions": [
      "ons-q-arch-01",
      "ons-q-arch-02"
    ],
    "sims": [],
    "track": "onsite"
  },
  {
    "id": "ons-hands-02",
    "title": "Deploy and run an application",
    "mins": 25,
    "priority": "P0",
    "topic": "deploy",
    "goal": "Create a Deployment, follow the chain it creates (Deployment → ReplicaSet → Pods), read its spec and status, generate a manifest instead of writing it from memory, and look inside a running container.",
    "setup": [
      "kubectl create namespace practice --dry-run=client -o yaml | kubectl apply -f -"
    ],
    "tasks": [
      {
        "do": "Create a Deployment called `web` running nginx 1.27 with two replicas.",
        "hint": "`kubectl create deployment` takes --image and --replicas.",
        "cmd": "kubectl create deployment web --image=nginx:1.27 --replicas=2 -n practice",
        "expect": "`deployment.apps/web created`.",
        "why": "You declared desired state (two replicas of this template). Controllers now work to make it true.",
        "test": "kubectl create deployment web --image=nginx:1.27 --replicas=2 -n practice --dry-run=client -o yaml | kubectl apply -f -",
        "re": "deployment.apps/web",
        "env": null
      },
      {
        "do": "Watch what that one command created.",
        "hint": "Get the Deployment, its ReplicaSet and its Pods together.",
        "cmd": "kubectl get deploy,rs,pods -n practice",
        "expect": "`deployment.apps/web  2/2`, one ReplicaSet `web-<hash>` with DESIRED 2, and two pods `web-<hash>-<suffix>` Running. It can take a few seconds for the image to pull.",
        "why": "The Deployment controller created a ReplicaSet for this pod template; the ReplicaSet controller created the pods; the scheduler placed them; the kubelet started them.",
        "env": {
          "killercoda": "Add `-w` to watch changes live; press Ctrl-C to stop.",
          "desktop": "Same."
        },
        "re": "web-\\S+\\s+1/1\\s+Running[\\s\\S]*web-\\S+\\s+1/1\\s+Running"
      },
      {
        "do": "Show which object owns a pod, which image it runs, and which node it landed on.",
        "hint": "`describe` a pod selected by its label `app=web`, and look for three fields.",
        "cmd": "kubectl describe pod -n practice -l app=web | grep -E 'Controlled By|Image:|Node:'",
        "expect": "`Controlled By:  ReplicaSet/web-<hash>`, `Image:  nginx:1.27`, and the node name for each pod.",
        "why": "Pods from a Deployment are owned by its ReplicaSet — that ownership is why a deleted pod comes back.",
        "re": "Controlled By:\\s+ReplicaSet/web-",
        "env": null
      },
      {
        "do": "Read the Deployment as YAML and find the difference between what you asked for and what is true now.",
        "hint": "Output as YAML; compare `spec` with `status`.",
        "cmd": "kubectl get deploy web -n practice -o yaml",
        "expect": "`spec.replicas: 2` and a `spec.template` with your image; `status` with readyReplicas, availableReplicas and conditions such as Available=True.",
        "why": "spec is desired state you own; status is observed state the controllers write. Most troubleshooting is noticing where they differ.",
        "re": "readyReplicas: 2",
        "env": null
      },
      {
        "do": "Generate a manifest for a second Deployment, `api`, without creating it, and save it to a file.",
        "hint": "`--dry-run=client -o yaml` prints the object instead of sending it.",
        "cmd": [
          "kubectl create deployment api --image=nginx:1.27 -n practice --dry-run=client -o yaml > api.yaml",
          "cat api.yaml"
        ],
        "expect": "A complete Deployment manifest, including `namespace: practice`, labels `app: api`, and a matching selector.",
        "why": "Generating YAML is faster and less error-prone than writing it from memory — and interviewers generally prefer seeing it done this way over memorised boilerplate.",
        "re": "kind: Deployment[\\s\\S]*namespace: practice",
        "env": null
      },
      {
        "do": "Create `api` from the file, declaratively.",
        "hint": "`apply -f`.",
        "cmd": [
          "kubectl apply -n practice -f api.yaml",
          "kubectl get deploy -n practice"
        ],
        "expect": "`deployment.apps/api created`, then both web and api listed.",
        "why": "`apply` makes the cluster match the file; re-running it after editing the file changes only what differs. Files can live in version control.",
        "re": "api\\s",
        "env": null
      },
      {
        "do": "Read the logs of the web application and run a command inside one of its containers.",
        "hint": "Both `logs` and `exec` accept `deploy/NAME` and pick a pod for you.",
        "cmd": [
          "kubectl logs deploy/web -n practice --tail=5",
          "kubectl exec -n practice deploy/web -- nginx -v"
        ],
        "expect": "nginx start-up log lines, then `nginx version: nginx/1.27.x`.",
        "why": "`logs` reads the container's stdout/stderr; `exec` runs a process in the container's namespaces. Both go through the API server to the kubelet.",
        "re": "nginx/1\\.27",
        "env": null
      }
    ],
    "check": {
      "cmd": "[ \"$(kubectl get deploy web -n practice -o jsonpath='{.status.readyReplicas}')\" = 2 ] && kubectl get deploy api -n practice >/dev/null 2>&1 && echo PASS || echo 'FAIL: expected web with 2 ready replicas and an api Deployment'",
      "expect": "PASS"
    },
    "cleanup": [
      "kubectl delete deployment api -n practice",
      "rm -f api.yaml"
    ],
    "talk": "\"A Deployment owns ReplicaSets, which own pods. I usually generate YAML with --dry-run=client and apply it, then read spec against status to see whether reality matches what I asked for.\"",
    "lessons": [
      "les-workloads",
      "les-reconcile"
    ],
    "questions": [
      "ons-q-arch-01",
      "ons-q-arch-02",
      "ons-q-arch-09"
    ],
    "sims": [
      "ons-lab-01"
    ],
    "track": "onsite"
  },
  {
    "id": "ons-hands-03",
    "title": "Scale it and watch it heal",
    "mins": 15,
    "priority": "P0",
    "topic": "deploy",
    "goal": "Change the replica count, delete a pod and watch the ReplicaSet replace it, and see why a bare pod does not come back.",
    "setup": [
      "kubectl create namespace practice --dry-run=client -o yaml | kubectl apply -f -",
      "kubectl create deployment web --image=nginx:1.27 --replicas=2 -n practice --dry-run=client -o yaml | kubectl apply -f -",
      "kubectl rollout status deploy/web -n practice --timeout=120s"
    ],
    "tasks": [
      {
        "do": "Scale web to four replicas and confirm all four are Ready.",
        "hint": "`kubectl scale` works on the Deployment.",
        "cmd": [
          "kubectl scale deploy/web --replicas=4 -n practice",
          "kubectl get pods -n practice -l app=web"
        ],
        "expect": "Four web pods, two of them only seconds old.",
        "why": "You changed desired state; the ReplicaSet controller created the difference.",
        "re": "(web-\\S+\\s+1/1\\s+Running[\\s\\S]*){4}",
        "env": null
      },
      {
        "do": "Delete one web pod, then list the pods again.",
        "hint": "Pick any pod name from the list, or let jsonpath pick the first one.",
        "cmd": [
          "kubectl delete pod -n practice $(kubectl get pod -n practice -l app=web -o jsonpath='{.items[0].metadata.name}')",
          "kubectl get pods -n practice -l app=web"
        ],
        "expect": "The pod is deleted and a new one with a different name (and a very young AGE) takes its place; four remain.",
        "why": "Deleting a pod removes that object only. The ReplicaSet sees 3 of 4 and creates one more — a new pod with a new name and IP, not a restart of the old one.",
        "re": "(web-\\S+\\s+1/1\\s+Running[\\s\\S]*){4}",
        "env": null
      },
      {
        "do": "Find the evidence that a controller created the replacement.",
        "hint": "Events, sorted by time.",
        "cmd": "kubectl get events -n practice --sort-by=.lastTimestamp | tail -6",
        "expect": "A `SuccessfulCreate` event from the ReplicaSet (`Created pod: web-…`), plus Scheduled / Pulled / Started events for the new pod.",
        "why": "Events tell you who acted: here the replicaset-controller, not a person.",
        "re": "SuccessfulCreate|Created pod",
        "env": null
      },
      {
        "do": "Scale back down to two and see which pods are removed.",
        "hint": "Same command, lower number.",
        "cmd": [
          "kubectl scale deploy/web --replicas=2 -n practice",
          "kubectl get pods -n practice -l app=web"
        ],
        "expect": "Two pods Terminating, then two left.",
        "why": "When scaling down, the ReplicaSet prefers to remove pods that are not ready or are newer, depending on version — it does not keep a fixed set.",
        "re": "web-",
        "env": null
      },
      {
        "do": "Create a bare pod (no Deployment), delete it, and check whether it comes back.",
        "hint": "`kubectl run` creates a single pod.",
        "cmd": [
          "kubectl run lonely --image=nginx:1.27 -n practice",
          "kubectl delete pod lonely -n practice",
          "kubectl get pod lonely -n practice"
        ],
        "expect": "`pod/lonely created`, `pod \"lonely\" deleted`, then `Error from server (NotFound)`.",
        "why": "Nothing owns a bare pod, so nothing recreates it. This is why workloads run under a controller.",
        "re": "NotFound",
        "env": null
      }
    ],
    "check": {
      "cmd": "[ \"$(kubectl get deploy web -n practice -o jsonpath='{.status.readyReplicas}')\" = 2 ] && ! kubectl get pod lonely -n practice >/dev/null 2>&1 && echo PASS || echo 'FAIL: expected web at 2 ready replicas and no pod named lonely'",
      "expect": "PASS"
    },
    "cleanup": "# keep web — the next scenarios use it",
    "talk": "\"Deleting a pod isn't a restart. The ReplicaSet notices it has fewer than desired and creates a new pod with a new name and IP. A bare pod has no owner, so it just disappears.\"",
    "lessons": [
      "les-workloads",
      "les-failure"
    ],
    "questions": [
      "ons-q-arch-03",
      "ons-q-arch-08"
    ],
    "sims": [
      "ons-lab-01"
    ],
    "track": "onsite"
  },
  {
    "id": "ons-hands-04",
    "title": "Reach it inside the cluster",
    "mins": 25,
    "priority": "P0",
    "topic": "expose",
    "goal": "Put a ClusterIP Service in front of web, see the endpoints it selected, reach it by name from another pod, and watch it fail when there are no ready backends.",
    "setup": [
      "kubectl create namespace practice --dry-run=client -o yaml | kubectl apply -f -",
      "kubectl create deployment web --image=nginx:1.27 --replicas=2 -n practice --dry-run=client -o yaml | kubectl apply -f -",
      "kubectl rollout status deploy/web -n practice --timeout=120s"
    ],
    "tasks": [
      {
        "do": "Create a ClusterIP Service for web on port 80.",
        "hint": "`kubectl expose` builds a Service whose selector matches the Deployment's pods.",
        "cmd": [
          "kubectl expose deployment web --port=80 --target-port=80 -n practice",
          "kubectl get svc web -n practice"
        ],
        "expect": "`service/web exposed`, then a Service with TYPE ClusterIP, a CLUSTER-IP, and PORT(S) 80/TCP.",
        "why": "A Service is a stable virtual IP and DNS name in front of a changing set of pods, chosen by label selector.",
        "test": [
          "kubectl expose deployment web --port=80 --target-port=80 -n practice --dry-run=client -o yaml | kubectl apply -f -",
          "kubectl get svc web -n practice"
        ],
        "re": "ClusterIP",
        "env": null
      },
      {
        "do": "See which pod IPs the Service is sending traffic to.",
        "hint": "EndpointSlices are labelled with the Service name.",
        "cmd": [
          "kubectl get endpointslices -n practice -l kubernetes.io/service-name=web",
          "kubectl get pods -n practice -l app=web -o wide"
        ],
        "expect": "An EndpointSlice listing two addresses on port 80 — the same IPs as the two web pods.",
        "why": "The EndpointSlice controller continuously selects Ready pods matching the Service selector. Empty endpoints means a selector mismatch or no Ready pods.",
        "re": "web-\\S+\\s+IPv4\\s+80\\s+\\S+,\\S+",
        "env": null
      },
      {
        "do": "From a temporary client pod, fetch the page using the Service name.",
        "hint": "`kubectl run` with `--rm -i --restart=Never` runs a one-off pod and removes it afterwards.",
        "cmd": "kubectl run client -n practice --rm -i --restart=Never --image=busybox:1.37 -- wget -qO- -T 5 http://web",
        "expect": "The nginx welcome page HTML (`<title>Welcome to nginx!</title>`), then `pod \"client\" deleted`.",
        "why": "The client resolved `web` through cluster DNS (search domain practice.svc.cluster.local), connected to the ClusterIP, and the node's dataplane forwarded it to a ready pod.",
        "re": "Welcome to nginx",
        "env": null
      },
      {
        "do": "Resolve the Service's full DNS name from a pod.",
        "hint": "The full name is SERVICE.NAMESPACE.svc.cluster.local on a default cluster domain.",
        "cmd": "kubectl run dns -n practice --rm -i --restart=Never --image=busybox:1.37 -- nslookup web.practice.svc.cluster.local",
        "expect": "An answer whose Address is the Service's CLUSTER-IP.",
        "why": "DNS answering proves the name exists; it says nothing about whether any pod behind it is healthy — that is the next task.",
        "re": "Address:?\\s+\\d+\\.\\d+\\.\\d+\\.\\d+[\\s\\S]*Address:?\\s+\\d+\\.\\d+\\.\\d+\\.\\d+|Name:\\s+web\\.practice",
        "env": null
      },
      {
        "do": "Scale web to zero, try the request again, then scale back to two.",
        "hint": "Same client command as before, between two scale commands.",
        "cmd": [
          "kubectl scale deploy/web --replicas=0 -n practice",
          "kubectl run client -n practice --rm -i --restart=Never --image=busybox:1.37 -- wget -qO- -T 5 http://web",
          "kubectl scale deploy/web --replicas=2 -n practice"
        ],
        "expect": "The request fails (typically `Connection refused` or a timeout, depending on the cluster's dataplane) while DNS still resolves. After scaling back, requests work again.",
        "why": "Name resolution and routing are separate steps: the Service still exists, but with no ready endpoints there is nowhere to send the connection.",
        "test": "kubectl scale deploy/web --replicas=0 -n practice && kubectl wait --for=delete pod -l app=web -n practice --timeout=60s; kubectl run client -n practice --rm -i --restart=Never --image=busybox:1.37 -- wget -qO- -T 5 http://web; echo \"exit=$?\"; kubectl scale deploy/web --replicas=2 -n practice && kubectl rollout status deploy/web -n practice --timeout=120s",
        "re": "(refused|timed out|timeout|exit=1)",
        "env": null
      },
      {
        "do": "Look at the Service's port and targetPort.",
        "hint": "Output the Service as YAML and find `ports`.",
        "cmd": "kubectl get svc web -n practice -o yaml | grep -A4 'ports:'",
        "expect": "`port: 80` (what clients connect to on the Service) and `targetPort: 80` (the container port traffic is sent to).",
        "why": "They are often equal but need not be; a wrong targetPort gives you endpoints but refused connections.",
        "re": "targetPort: 80",
        "env": null
      }
    ],
    "check": {
      "cmd": "n=$(kubectl get endpointslices -n practice -l kubernetes.io/service-name=web -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]}{\" \"}{end}' | wc -w); [ \"$n\" -ge 2 ] && echo PASS || echo \"FAIL: the web Service has $n ready endpoints (want 2)\"",
      "expect": "PASS"
    },
    "cleanup": "# keep web and its Service for the next scenario",
    "talk": "\"I test in layers: does the name resolve, does the Service have endpoints, does the pod answer on its port, what does the app return. Each step rules a mechanism in or out.\"",
    "lessons": [
      "les-services",
      "les-request-path"
    ],
    "questions": [
      "ons-q-net-01",
      "ons-q-net-02",
      "ons-q-net-04",
      "ons-q-net-05"
    ],
    "sims": [
      "ons-lab-03"
    ],
    "track": "onsite"
  },
  {
    "id": "ons-hands-05",
    "title": "Expose it outside the cluster",
    "mins": 30,
    "priority": "P0",
    "topic": "expose",
    "goal": "Reach the app from outside the cluster three ways — port-forward, NodePort and LoadBalancer — and see what each needs from the environment. Then see why an Ingress does nothing without a controller.",
    "setup": [
      "kubectl create namespace practice --dry-run=client -o yaml | kubectl apply -f -",
      "kubectl create deployment web --image=nginx:1.27 --replicas=2 -n practice --dry-run=client -o yaml | kubectl apply -f -",
      "kubectl rollout status deploy/web -n practice --timeout=120s",
      "kubectl expose deployment web --port=80 --target-port=80 -n practice --dry-run=client -o yaml | kubectl apply -f -"
    ],
    "tasks": [
      {
        "do": "Forward a local port to the Service and fetch the page from your own terminal.",
        "hint": "`port-forward` runs in the foreground; use a second terminal (or `&`) for the request.",
        "cmd": [
          "kubectl port-forward -n practice svc/web 8080:80 &",
          "sleep 2; curl -s http://localhost:8080 | grep -o '<title>.*</title>'",
          "kill %1"
        ],
        "expect": "`<title>Welcome to nginx!</title>`.",
        "why": "port-forward tunnels through the API server to one pod behind the Service. It is a debugging tool for one person, not a way to serve users.",
        "env": {
          "killercoda": "Works in the terminal as shown. You can also open a second terminal tab instead of using `&`.",
          "desktop": "Works as shown in macOS Terminal; `kill %1` stops the background job."
        },
        "test": "kubectl port-forward -n practice svc/web 18080:80 >/dev/null 2>&1 & pf=$!; sleep 3; curl -s http://localhost:18080 | grep -o '<title>.*</title>'; kill $pf",
        "re": "Welcome to nginx"
      },
      {
        "do": "Create a NodePort Service for web and find the port it was given.",
        "hint": "`kubectl expose` with `--type=NodePort` and a different name.",
        "cmd": [
          "kubectl expose deployment web --name=web-nodeport --type=NodePort --port=80 -n practice",
          "kubectl get svc web-nodeport -n practice"
        ],
        "expect": "TYPE NodePort and PORT(S) like `80:3xxxx/TCP` — the second number is the node port, from 30000–32767 by default.",
        "why": "A NodePort Service opens the same port on every node and forwards it to the Service's endpoints.",
        "test": [
          "kubectl expose deployment web --name=web-nodeport --type=NodePort --port=80 -n practice --dry-run=client -o yaml | kubectl apply -f -",
          "kubectl get svc web-nodeport -n practice"
        ],
        "re": "80:3\\d{4}/TCP",
        "env": null
      },
      {
        "do": "Reach the app on the node port from outside the pods.",
        "hint": "You need a node address plus the node port. jsonpath can fetch both.",
        "cmd": [
          "NODE_PORT=$(kubectl get svc web-nodeport -n practice -o jsonpath='{.spec.ports[0].nodePort}')",
          "NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type==\"InternalIP\")].address}')",
          "curl -s http://$NODE_IP:$NODE_PORT | grep -o '<title>.*</title>'"
        ],
        "expect": "`<title>Welcome to nginx!</title>`.",
        "why": "Traffic arrives at the node's IP on the node port, and the node's dataplane forwards it to a ready pod — which may be on another node.",
        "env": {
          "killercoda": "Run it on the controlplane terminal as shown. Killercoda's Traffic / Ports menu can also open the node port in your browser.",
          "desktop": "Node IPs are inside Docker's VM; use `curl -s http://localhost:$NODE_PORT` instead — Docker Desktop forwards node ports to localhost."
        },
        "re": "Welcome to nginx"
      },
      {
        "do": "Ask for a LoadBalancer Service and see what the environment gives you.",
        "hint": "`--type=LoadBalancer`, then look at EXTERNAL-IP.",
        "cmd": [
          "kubectl expose deployment web --name=web-lb --type=LoadBalancer --port=80 -n practice",
          "kubectl get svc web-lb -n practice"
        ],
        "expect": "Depends on the environment. On Killercoda (and kind) EXTERNAL-IP stays `<pending>`. On Docker Desktop it usually becomes `localhost`, and `curl http://localhost` answers.",
        "why": "Type LoadBalancer only *requests* an external load balancer. Something outside core Kubernetes — a cloud provider integration or a controller such as MetalLB — has to provision it. Without one, the request just waits.",
        "env": {
          "killercoda": "Expect `<pending>` indefinitely — there is no load-balancer controller. The Service still works as a NodePort underneath.",
          "desktop": "Docker Desktop typically publishes LoadBalancer Services on localhost (behaviour can differ between its cluster modes and versions)."
        },
        "test": [
          "kubectl expose deployment web --name=web-lb --type=LoadBalancer --port=80 -n practice --dry-run=client -o yaml | kubectl apply -f -",
          "kubectl get svc web-lb -n practice"
        ],
        "re": "LoadBalancer"
      },
      {
        "do": "Check whether the cluster has an Ingress controller, then create an Ingress anyway and look at its address.",
        "hint": "Ingress classes are listed by `get ingressclass`.",
        "cmd": [
          "kubectl get ingressclass",
          "kubectl apply -n practice -f - <<'EOF'",
          "apiVersion: networking.k8s.io/v1",
          "kind: Ingress",
          "metadata:",
          "  name: web",
          "spec:",
          "  rules:",
          "  - http:",
          "      paths:",
          "      - path: /",
          "        pathType: Prefix",
          "        backend:",
          "          service:",
          "            name: web",
          "            port:",
          "              number: 80",
          "EOF",
          "kubectl get ingress web -n practice"
        ],
        "expect": "On a fresh playground: `No resources found` for ingress classes, and the Ingress is created but its ADDRESS stays empty.",
        "why": "An Ingress is only configuration. An Ingress controller (installed separately; there are several) reads it and actually routes HTTP. Without a controller nothing happens — the same pattern as LoadBalancer.",
        "re": "ingress.networking.k8s.io/web|web\\s",
        "env": null
      }
    ],
    "check": {
      "cmd": "np=$(kubectl get svc web-nodeport -n practice -o jsonpath='{.spec.ports[0].nodePort}'); t=$(kubectl get svc web-lb -n practice -o jsonpath='{.spec.type}'); [ -n \"$np\" ] && [ \"$t\" = LoadBalancer ] && echo \"PASS (node port $np)\" || echo 'FAIL: expected Services web-nodeport (NodePort) and web-lb (LoadBalancer)'",
      "expect": "PASS (node port 3xxxx)"
    },
    "cleanup": [
      "kubectl delete svc web-nodeport web-lb -n practice",
      "kubectl delete ingress web -n practice"
    ],
    "talk": "\"ClusterIP is internal. For outside access: port-forward is a debug tunnel, NodePort opens a port on every node, LoadBalancer asks the environment for an external load balancer — which only happens if something provisions it — and Ingress needs a controller to do anything.\"",
    "lessons": [
      "les-services",
      "les-request-path"
    ],
    "questions": [
      "ons-q-net-07",
      "ons-q-net-08",
      "ons-q-net-02"
    ],
    "sims": [],
    "track": "onsite"
  },
  {
    "id": "ons-hands-06",
    "title": "Update it, break it, roll it back",
    "mins": 25,
    "priority": "P0",
    "topic": "update",
    "goal": "Roll out a new image, record the change, push a broken image and see the rollout stall safely while old pods keep serving, then roll back.",
    "setup": [
      "kubectl create namespace practice --dry-run=client -o yaml | kubectl apply -f -",
      "kubectl create deployment web --image=nginx:1.27 --replicas=2 -n practice --dry-run=client -o yaml | kubectl apply -f -",
      "kubectl rollout status deploy/web -n practice --timeout=120s"
    ],
    "tasks": [
      {
        "do": "Update web to nginx 1.28 and wait for the rollout to finish.",
        "hint": "`kubectl set image` needs the container name — `create deployment` named it after the image: `nginx`.",
        "cmd": [
          "kubectl set image deploy/web nginx=nginx:1.28 -n practice",
          "kubectl rollout status deploy/web -n practice"
        ],
        "expect": "`deployment \"web\" successfully rolled out`.",
        "why": "Changing the pod template creates a new ReplicaSet; the Deployment scales it up and the old one down within maxSurge/maxUnavailable.",
        "re": "successfully rolled out",
        "env": null
      },
      {
        "do": "Record why, then look at the rollout history and the ReplicaSets.",
        "hint": "The `kubernetes.io/change-cause` annotation fills the CHANGE-CAUSE column.",
        "cmd": [
          "kubectl annotate deploy/web -n practice kubernetes.io/change-cause=\"nginx 1.28\" --overwrite",
          "kubectl rollout history deploy/web -n practice",
          "kubectl get rs -n practice -l app=web"
        ],
        "expect": "Revisions 1 and 2 (2 showing `nginx 1.28`), and two ReplicaSets — the new one with 2 pods, the old one scaled to 0 but kept.",
        "why": "Old ReplicaSets are kept (up to revisionHistoryLimit) so a rollback is just scaling one back up.",
        "re": "nginx 1\\.28",
        "env": null
      },
      {
        "do": "Release a broken image tag and check the rollout with a short timeout.",
        "hint": "Set an image tag that does not exist, then `rollout status --timeout`.",
        "cmd": [
          "kubectl set image deploy/web nginx=nginx:1.99-doesnotexist -n practice",
          "kubectl rollout status deploy/web -n practice --timeout=30s"
        ],
        "expect": "The status command times out: `Waiting for deployment \"web\" rollout to finish: 1 out of 2 new replicas have been updated...` then `error: timed out waiting for the condition`.",
        "why": "The new pod never becomes Ready, so the Deployment will not remove more old pods. The rollout stalls; it does not roll back by itself.",
        "test": "kubectl set image deploy/web nginx=nginx:1.99-doesnotexist -n practice; kubectl rollout status deploy/web -n practice --timeout=20s; echo \"exit=$?\"",
        "re": "exit=1",
        "env": null
      },
      {
        "do": "Show that users are still being served, and find the exact error on the new pod.",
        "hint": "List the pods; describe the one that is not Running.",
        "cmd": [
          "kubectl get pods -n practice -l app=web",
          "kubectl describe pod -n practice $(kubectl get pod -n practice -l app=web --field-selector=status.phase=Pending -o jsonpath='{.items[0].metadata.name}') | tail -8"
        ],
        "expect": "Two old pods still `1/1 Running` and one new pod in `ErrImagePull` / `ImagePullBackOff`; its events say the image could not be pulled (typically `not found`).",
        "why": "With the default strategy (maxUnavailable 25% of 2 rounds down to 0) no old pod is removed until a new one is Ready — the stall is safe.",
        "env": {
          "killercoda": "The event usually reads `... nginx:1.99-doesnotexist: not found`.",
          "desktop": "Same."
        },
        "test": "kubectl get pods -n practice -l app=web",
        "re": "(ErrImagePull|ImagePullBackOff)",
        "wait": 90
      },
      {
        "do": "Roll back and confirm which image is running.",
        "hint": "`rollout undo`, then read the image from the template.",
        "cmd": [
          "kubectl rollout undo deploy/web -n practice",
          "kubectl rollout status deploy/web -n practice",
          "kubectl get deploy web -n practice -o jsonpath='{.spec.template.spec.containers[0].image}{\"\\n\"}'"
        ],
        "expect": "`successfully rolled out` and `nginx:1.28`.",
        "why": "Undo restores the previous pod template only. It does not restore ConfigMaps, Secrets, data or anything outside the template.",
        "re": "nginx:1\\.28",
        "env": null
      }
    ],
    "check": {
      "cmd": "img=$(kubectl get deploy web -n practice -o jsonpath='{.spec.template.spec.containers[0].image}'); r=$(kubectl get deploy web -n practice -o jsonpath='{.status.updatedReplicas}/{.status.readyReplicas}'); [ \"$img\" != nginx:1.99-doesnotexist ] && [ \"$r\" = 2/2 ] && echo \"PASS ($img)\" || echo \"FAIL: image=$img updated/ready=$r\"",
      "expect": "PASS (nginx:1.28)"
    },
    "cleanup": "# keep web for the next scenario",
    "talk": "\"A bad image stalls the rollout rather than taking the service down, because old pods are only removed as new ones become Ready. I find the pull error in the pod's events, roll back with undo, and remember undo only restores the pod template.\"",
    "lessons": [
      "les-rollouts",
      "les-pod-lifecycle"
    ],
    "questions": [
      "ons-q-trouble-04",
      "ons-q-trouble-05",
      "ons-q-trouble-08"
    ],
    "sims": [
      "ons-lab-02"
    ],
    "track": "onsite"
  },
  {
    "id": "ons-hands-07",
    "title": "Configure it with ConfigMaps and Secrets",
    "mins": 25,
    "priority": "P1",
    "topic": "config",
    "goal": "Give the app configuration and a secret as environment variables, see what base64 does and does not do, and learn when a change actually reaches the running process.",
    "setup": [
      "kubectl create namespace practice --dry-run=client -o yaml | kubectl apply -f -",
      "kubectl create deployment web --image=nginx:1.27 --replicas=2 -n practice --dry-run=client -o yaml | kubectl apply -f -",
      "kubectl rollout status deploy/web -n practice --timeout=120s"
    ],
    "tasks": [
      {
        "do": "Create a ConfigMap `web-config` with GREETING=hello and MODE=practice.",
        "hint": "`--from-literal` can be repeated.",
        "cmd": "kubectl create configmap web-config -n practice --from-literal=GREETING=hello --from-literal=MODE=practice",
        "expect": "`configmap/web-config created`.",
        "why": "ConfigMaps keep configuration out of the image, so the same image runs everywhere.",
        "test": "kubectl create configmap web-config -n practice --from-literal=GREETING=hello --from-literal=MODE=practice --dry-run=client -o yaml | kubectl apply -f -",
        "re": "configmap/web-config",
        "env": null
      },
      {
        "do": "Create a Secret `web-secret` with API_TOKEN=not-a-real-token, then read the value back.",
        "hint": "`create secret generic`; the stored value is under `.data` and base64-encoded.",
        "cmd": [
          "kubectl create secret generic web-secret -n practice --from-literal=API_TOKEN=not-a-real-token",
          "kubectl get secret web-secret -n practice -o jsonpath='{.data.API_TOKEN}' | base64 -d; echo"
        ],
        "expect": "`secret/web-secret created`, then `not-a-real-token`.",
        "why": "base64 is encoding, not encryption: anyone who can `get` the Secret can read it. Protection comes from RBAC and, if configured, encryption at rest in the API server.",
        "test": [
          "kubectl create secret generic web-secret -n practice --from-literal=API_TOKEN=not-a-real-token --dry-run=client -o yaml | kubectl apply -f -",
          "kubectl get secret web-secret -n practice -o jsonpath='{.data.API_TOKEN}' | base64 -d; echo"
        ],
        "re": "not-a-real-token",
        "env": null
      },
      {
        "do": "Inject both into web as environment variables and check them inside a container.",
        "hint": "`kubectl set env --from=configmap/NAME` (and secret/NAME) — this changes the pod template.",
        "cmd": [
          "kubectl set env deploy/web -n practice --from=configmap/web-config",
          "kubectl set env deploy/web -n practice --from=secret/web-secret",
          "kubectl rollout status deploy/web -n practice",
          "kubectl exec -n practice deploy/web -- printenv GREETING MODE API_TOKEN"
        ],
        "expect": "`hello`, `practice`, `not-a-real-token`.",
        "why": "Changing the template started a rollout; the new pods read the values at container start.",
        "re": "hello\\s+practice\\s+not-a-real-token",
        "env": null
      },
      {
        "do": "Change GREETING to `hi` in the ConfigMap, then check the running container.",
        "hint": "Regenerate the ConfigMap with --dry-run and apply it over the old one.",
        "cmd": [
          "kubectl create configmap web-config -n practice --from-literal=GREETING=hi --from-literal=MODE=practice --dry-run=client -o yaml | kubectl apply -f -",
          "kubectl exec -n practice deploy/web -- printenv GREETING"
        ],
        "expect": "The ConfigMap is `configured`, but the container still prints `hello`.",
        "why": "Environment variables are fixed when the container starts. (Values mounted as files are updated eventually — but not via subPath, and the app still has to re-read them.)",
        "re": "hello",
        "env": null
      },
      {
        "do": "Make the running pods pick up the change.",
        "hint": "Restart the rollout so new pods start with the new value.",
        "cmd": [
          "kubectl rollout restart deploy/web -n practice",
          "kubectl rollout status deploy/web -n practice",
          "kubectl exec -n practice deploy/web -- printenv GREETING"
        ],
        "expect": "`hi` — the restarted pods read the updated ConfigMap.",
        "why": "A restart creates new pods from the same template; they read the ConfigMap at start. Note that rollout undo would not undo a ConfigMap change.",
        "re": "^hi\\s*$",
        "env": null
      }
    ],
    "check": {
      "cmd": "[ \"$(kubectl exec -n practice deploy/web -- printenv GREETING)\" = hi ] && echo PASS || echo 'FAIL: GREETING is not hi inside web'",
      "expect": "PASS"
    },
    "cleanup": [
      "kubectl set env deploy/web -n practice GREETING- MODE- API_TOKEN-",
      "kubectl delete configmap web-config -n practice",
      "kubectl delete secret web-secret -n practice"
    ],
    "talk": "\"Config goes in ConfigMaps, credentials in Secrets — but base64 isn't encryption, so access control matters. Env vars are read at start, so a config change needs a rollout restart; that change isn't part of rollout history.\"",
    "lessons": [
      "les-config"
    ],
    "questions": [
      "ons-q-config-03",
      "ons-q-config-05"
    ],
    "sims": [
      "ons-lab-06"
    ],
    "track": "onsite"
  },
  {
    "id": "ons-hands-08",
    "title": "When it breaks: CrashLoopBackOff and Pending",
    "mins": 25,
    "priority": "P0",
    "topic": "troubleshoot",
    "goal": "Deploy two broken workloads and diagnose each from evidence — logs of the previous container, exit codes, events and scheduler messages — before changing anything.",
    "setup": [
      "kubectl create namespace practice --dry-run=client -o yaml | kubectl apply -f -"
    ],
    "tasks": [
      {
        "do": "Deploy the `broken` app from the manifest below.",
        "hint": "Paste the whole block; it applies a Deployment from standard input.",
        "cmd": [
          "kubectl apply -n practice -f - <<'EOF'",
          "apiVersion: apps/v1",
          "kind: Deployment",
          "metadata:",
          "  name: broken",
          "spec:",
          "  replicas: 1",
          "  selector:",
          "    matchLabels:",
          "      app: broken",
          "  template:",
          "    metadata:",
          "      labels:",
          "        app: broken",
          "    spec:",
          "      containers:",
          "      - name: app",
          "        image: busybox:1.37",
          "        command: [\"sh\", \"-c\"]",
          "        args:",
          "        - 'echo starting; if [ -z \"$DB_HOST\" ]; then echo \"FATAL: DB_HOST is not set\"; exit 1; fi; echo \"connected to $DB_HOST\"; sleep 3600'",
          "EOF"
        ],
        "expect": "`deployment.apps/broken created`.",
        "why": "This app refuses to start without DB_HOST — a stand-in for a missing configuration value.",
        "re": "deployment.apps/broken",
        "env": null
      },
      {
        "do": "Look at its pods and describe what you see.",
        "hint": "Watch STATUS and RESTARTS for a minute.",
        "cmd": "kubectl get pods -n practice -l app=broken",
        "expect": "STATUS alternating between `Error` and `CrashLoopBackOff`, RESTARTS climbing.",
        "why": "CrashLoopBackOff is the kubelet waiting longer between restarts of a container that keeps exiting. It is a symptom, not a cause.",
        "re": "(CrashLoopBackOff|Error)",
        "wait": 90,
        "env": null
      },
      {
        "do": "Find out why the container exited.",
        "hint": "Read the container's output. Between restarts, the most recent run is the one that failed; `--previous` asks for the run before the current one.",
        "cmd": [
          "kubectl logs -n practice deploy/broken",
          "kubectl logs -n practice deploy/broken --previous"
        ],
        "expect": "`starting` then `FATAL: DB_HOST is not set` from at least one of them. On some clusters `--previous` answers `unable to retrieve container logs` once that older container has been cleaned up — the first command still shows the failure.",
        "why": "While the pod waits out its back-off, plain `logs` shows the run that just exited. Once a new instance has started, the failure is in `--previous` — which is why it is the habit to reach for on a crash loop.",
        "re": "FATAL: DB_HOST is not set",
        "wait": 90,
        "env": null
      },
      {
        "do": "Confirm how it terminated.",
        "hint": "`describe` shows Last State with a reason and exit code.",
        "cmd": "kubectl describe pod -n practice -l app=broken | grep -A4 'Last State'",
        "expect": "`Last State: Terminated`, `Reason: Error`, `Exit Code: 1`.",
        "why": "Exit code 1 means the app exited by itself. 137 would mean SIGKILL — and only reason OOMKilled proves the memory limit did it.",
        "re": "Exit Code:\\s+1",
        "env": null
      },
      {
        "do": "Fix it at the cause and verify.",
        "hint": "Give the Deployment the environment variable it needs.",
        "cmd": [
          "kubectl set env deploy/broken -n practice DB_HOST=db.practice.svc",
          "kubectl rollout status deploy/broken -n practice",
          "kubectl logs -n practice deploy/broken"
        ],
        "expect": "`successfully rolled out` and `connected to db.practice.svc`.",
        "why": "Changing the template rolled out a new pod with the variable; the old crash-looping pod was replaced.",
        "re": "connected to db\\.practice\\.svc",
        "env": null
      },
      {
        "do": "Now create the `hungry` pod and find out why it never starts.",
        "hint": "Paste the block, then `describe` the pod and read Events.",
        "cmd": [
          "kubectl apply -n practice -f - <<'EOF'",
          "apiVersion: v1",
          "kind: Pod",
          "metadata:",
          "  name: hungry",
          "spec:",
          "  containers:",
          "  - name: app",
          "    image: busybox:1.37",
          "    command: [\"sleep\", \"3600\"]",
          "    resources:",
          "      requests:",
          "        memory: 64Gi",
          "EOF",
          "kubectl get pod hungry -n practice",
          "kubectl describe pod hungry -n practice | tail -5"
        ],
        "expect": "STATUS `Pending`, and a `FailedScheduling` event such as `0/2 nodes are available: ... Insufficient memory`.",
        "why": "The scheduler compares the pod's requests with each node's allocatable capacity — not with live usage. No node can offer 64Gi, so it is never placed.",
        "re": "Insufficient memory",
        "wait": 60,
        "env": null
      },
      {
        "do": "Clean up the unschedulable pod.",
        "hint": "It was only a demonstration.",
        "cmd": "kubectl delete pod hungry -n practice",
        "expect": "`pod \"hungry\" deleted`.",
        "why": "Fixing it for real would mean a smaller request, or nodes with more memory.",
        "re": "deleted",
        "env": null
      }
    ],
    "check": {
      "cmd": "[ \"$(kubectl get deploy broken -n practice -o jsonpath='{.status.readyReplicas}')\" = 1 ] && ! kubectl get pod hungry -n practice >/dev/null 2>&1 && echo PASS || echo 'FAIL: expected broken ready and no hungry pod'",
      "expect": "PASS"
    },
    "cleanup": "kubectl delete deployment broken -n practice",
    "talk": "\"CrashLoopBackOff tells me it keeps exiting, not why. I read logs --previous and the exit code, fix the cause, and verify. For Pending I read the scheduler's reason in events — requests versus allocatable, selectors, taints or storage.\"",
    "lessons": [
      "les-pod-lifecycle",
      "les-scheduling",
      "les-resources"
    ],
    "questions": [
      "ons-q-trouble-01",
      "ons-q-trouble-06",
      "ons-q-trouble-07"
    ],
    "sims": [
      "ons-lab-06",
      "ons-lab-05"
    ],
    "track": "onsite"
  },
  {
    "id": "ons-hands-09",
    "title": "Write it yourself: Deployment + Service from scratch",
    "mins": 30,
    "priority": "P1",
    "topic": "deploy",
    "goal": "Write a production-shaped manifest — labels that line up, resources, probes, a named port — validate it against the server, apply it, change it declaratively with diff, and reach it.",
    "setup": [
      "kubectl create namespace practice --dry-run=client -o yaml | kubectl apply -f -"
    ],
    "tasks": [
      {
        "do": "Write `shop.yaml`: a Deployment `shop` (2 replicas, nginx 1.28, label app=shop, a named container port `http` on 80, requests and a memory limit, readiness and liveness probes on `/`) and a ClusterIP Service `shop` on port 80 targeting `http`.",
        "hint": "Start from `kubectl create deployment shop --image=nginx:1.28 --dry-run=client -o yaml` and use `kubectl explain` for probe and resource fields. The Service selector must match the pod template labels.",
        "cmd": [
          "cat > shop.yaml <<'EOF'",
          "apiVersion: apps/v1",
          "kind: Deployment",
          "metadata:",
          "  name: shop",
          "spec:",
          "  replicas: 2",
          "  selector:",
          "    matchLabels:",
          "      app: shop",
          "  template:",
          "    metadata:",
          "      labels:",
          "        app: shop",
          "    spec:",
          "      containers:",
          "      - name: web",
          "        image: nginx:1.28",
          "        ports:",
          "        - name: http",
          "          containerPort: 80",
          "        resources:",
          "          requests:",
          "            cpu: 50m",
          "            memory: 32Mi",
          "          limits:",
          "            memory: 128Mi",
          "        readinessProbe:",
          "          httpGet:",
          "            path: /",
          "            port: http",
          "        livenessProbe:",
          "          httpGet:",
          "            path: /",
          "            port: http",
          "          initialDelaySeconds: 5",
          "---",
          "apiVersion: v1",
          "kind: Service",
          "metadata:",
          "  name: shop",
          "spec:",
          "  selector:",
          "    app: shop",
          "  ports:",
          "  - port: 80",
          "    targetPort: http",
          "EOF"
        ],
        "expect": "A file with two documents separated by `---`.",
        "why": "Three names have to agree: the Deployment selector, the pod template labels, and the Service selector. A named targetPort survives a container port change.",
        "re": ".*",
        "env": null
      },
      {
        "do": "Validate it against the API server without creating anything.",
        "hint": "There is a server-side dry run.",
        "cmd": "kubectl apply -n practice -f shop.yaml --dry-run=server",
        "expect": "`deployment.apps/shop created (server dry run)` and `service/shop created (server dry run)`.",
        "why": "A server dry run runs validation and admission, so it catches schema errors that a client-side dry run would not.",
        "re": "server dry run",
        "env": null
      },
      {
        "do": "Apply it and wait until it is ready.",
        "hint": "`apply`, then `rollout status`.",
        "cmd": [
          "kubectl apply -n practice -f shop.yaml",
          "kubectl rollout status deploy/shop -n practice",
          "kubectl get endpointslices -n practice -l kubernetes.io/service-name=shop"
        ],
        "expect": "Both objects created, the rollout succeeds, and the shop EndpointSlice lists two addresses.",
        "why": "The readiness probe gates when each pod joins the Service's endpoints.",
        "re": "shop-\\S+\\s+IPv4\\s+80\\s+\\S+,\\S+",
        "wait": 90,
        "env": null
      },
      {
        "do": "Change replicas to 3 in the file, preview the change, then apply it.",
        "hint": "Edit the file (any editor, or sed), then `kubectl diff`.",
        "cmd": [
          "sed -i.bak 's/replicas: 2/replicas: 3/' shop.yaml",
          "kubectl diff -n practice -f shop.yaml",
          "kubectl apply -n practice -f shop.yaml"
        ],
        "expect": "`diff` shows `-  replicas: 2` / `+  replicas: 3` (plus generation noise), then `deployment.apps/shop configured` and `service/shop unchanged`.",
        "why": "Declarative changes: the file is the source of truth, diff shows exactly what will change, apply changes only that.",
        "test": "sed -i.bak 's/replicas: 2/replicas: 3/' shop.yaml; kubectl diff -n practice -f shop.yaml; kubectl apply -n practice -f shop.yaml",
        "re": "deployment.apps/shop configured",
        "env": null
      },
      {
        "do": "Prove the Service answers by name.",
        "hint": "The same client-pod trick as before.",
        "cmd": [
          "kubectl rollout status deploy/shop -n practice",
          "kubectl run client -n practice --rm -i --restart=Never --image=busybox:1.37 -- wget -qO- -T 5 http://shop | grep -o '<title>.*</title>'"
        ],
        "expect": "`<title>Welcome to nginx!</title>`.",
        "why": "End-to-end check from a client's point of view, not just \"the pods are Running\".",
        "re": "Welcome to nginx",
        "env": null
      }
    ],
    "check": {
      "cmd": "r=$(kubectl get deploy shop -n practice -o jsonpath='{.status.readyReplicas}'); n=$(kubectl get endpointslices -n practice -l kubernetes.io/service-name=shop -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]}{\" \"}{end}' | wc -w); [ \"$r\" = 3 ] && [ \"$n\" -ge 3 ] && echo PASS || echo \"FAIL: shop ready=$r endpoints=$n (want 3 and 3)\"",
      "expect": "PASS"
    },
    "cleanup": [
      "# finished with everything? delete the whole practice namespace:",
      "kubectl delete namespace practice",
      "rm -f shop.yaml shop.yaml.bak"
    ],
    "talk": "\"I generate a skeleton, fill in resources and probes with explain, check it with a server-side dry run, and change it through the file with diff before apply — so the file stays the source of truth.\"",
    "lessons": [
      "les-workloads",
      "les-services",
      "les-probes",
      "les-resources"
    ],
    "questions": [
      "ons-q-arch-09",
      "ons-q-trouble-02",
      "ons-q-trouble-03"
    ],
    "sims": [],
    "track": "onsite"
  }
];
