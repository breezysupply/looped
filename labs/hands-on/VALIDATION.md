# Hands-on scenarios: what was validated

This records only what actually ran. The scenarios are written for the Killercoda
playground and Docker Desktop's Kubernetes; **neither of those was used here.** They were
validated against a real kind cluster instead, which runs the same Kubernetes API and kubectl.

## Environment

| | |
|---|---|
| Date | 2026-09-29, final full run 13:37:38Z – 13:39:45Z (UTC) |
| Cluster | kind v0.33.0, `looped-onsite` (1 control-plane + 1 worker), Kubernetes v1.37.0, on a Linux amd64 sandbox |
| kubectl | v1.37.1 |
| Shell | bash (the validator runs each command with `bash -c`) |
| etcd | 3.7.0 (etcdctl), the etcd static pod kind runs (it ships both `etcdctl` and `etcdutl`) |
| Runner | `node labs/hands-on/validate.js` — pinned to the kind context through a temporary kubeconfig |

Sandbox-only differences, none of which are in the scenarios:

- The cluster was created by `labs/kind/harness/run-lab.sh` in harness mode (cgroup v1 host and
  an oom-score workaround; see `labs/kind/EXECUTION.md`).
- Docker Hub rate-limited this sandbox (`429 Too Many Requests`), and the kind nodes cannot reach
  any registry. `nginx:1.27`, `nginx:1.28` and `busybox:1.37` were pulled on the host from
  Google's Docker Hub mirror (`mirror.gcr.io/library/...`), re-tagged with their Docker Hub names,
  and loaded into the nodes with `kind load image-archive`. On Killercoda and Docker Desktop the
  cluster pulls them from Docker Hub itself.
- Because the nodes have no registry access, the deliberately bad tag in scenario 06 failed with
  a network error rather than Docker Hub's `not found`. Both are `ErrImagePull` /
  `ImagePullBackOff`; the scenario text describes the usual `not found`.

## Method

The scenarios use the `k` alias. Aliases do not expand in a non-interactive `bash -c`, so the
validator defines `k` as a shell function that calls kubectl; the alias set-up task itself was
checked by running `k get nodes` that way. The etcd scenario defines an `etcdctl` shell function
in one task and uses it in later ones; the validator replays that definition before each later
task, as your shell would keep it.

For each scenario the validator runs the "start fresh" setup, then each task's command and checks
its output against a pattern. A few tasks are run through a non-interactive or environment-neutral
variant (`test` in the data file) — for example `apply` instead of `create` so a re-run is safe,
port-forward on a spare local port, and a scale-to-zero that waits for the pods to go. The exact
user-facing commands for those tasks were then run by hand in bash against the same cluster
(scenarios 02 task 1, 04 tasks 1 and 5, 05 tasks 1, 2 and 4, 06 tasks 1, 3, 4 and 5, 07 tasks 1
and 2); all behaved as described. Finally each scenario's PASS/FAIL check must print PASS, and its
cleanup runs.

## Final run

**11 of 11 scenarios passed; every task matched and every check printed PASS.**

```
=== ons-hands-01 — Find your way around a cluster
  ok   1. Confirm which cluster kubectl is talking to, and list every context it  (0s, 1 run)
  ok   2. Set up the `k` shortcut for kubectl, with Tab completion still working  [test variant]  (0s, 1 run)
  ok   3. List the nodes with their roles, versions and internal IPs.  (0s, 1 run)
  ok   4. List the namespaces, then every pod in every namespace.  (0s, 1 run)
  ok   5. Create the namespace this practice will use.  [test variant]  (0s, 1 run)
  ok   6. See which resource kinds the cluster knows, their short names, and whe  (0s, 1 run)
  ok   7. Ask the cluster to document a field you do not remember: a Deployment'  (0s, 1 run)
  ok   8. Find the cluster DNS pods by label, and show their labels.  (0s, 1 run)
  ok   9. Pull one specific field out of the API: the names of all nodes.  (0s, 1 run)
  ok   10. Read the most recent events across the cluster.  (0s, 1 run)
=== ons-hands-02 — Deploy and run an application
  ok   1. Create a Deployment called `web` running nginx 1.27 with two replicas.  [test variant]  (0s, 1 run)
  ok   2. Watch what that one command created.  (3s, 2 runs)
  ok   3. Show which object owns a pod, which image it runs, and which node it l  (0s, 1 run)
  ok   4. Read the Deployment as YAML and find the difference between what you a  (0s, 1 run)
  ok   5. Generate a manifest for a second Deployment, `api`, without creating i  (0s, 1 run)
  ok   6. Create `api` from the file, declaratively.  (0s, 1 run)
  ok   7. Read the logs of the web application and run a command inside one of i  (0s, 1 run)
=== ons-hands-03 — Scale it and watch it heal
  ok   1. Scale web to four replicas and confirm all four are Ready.  (3s, 2 runs)
  ok   2. Delete one web pod, then list the pods again.  (4s, 2 runs)
  ok   3. Find the evidence that a controller created the replacement.  (0s, 1 run)
  ok   4. Scale back down to two and see which pods are removed.  (0s, 1 run)
  ok   5. Create a bare pod (no Deployment), delete it, and check whether it com  (1s, 1 run)
=== ons-hands-10 — Run one pod per node with a DaemonSet
  ok   1. List every DaemonSet in the cluster.  (0s, 1 run)
  ok   2. Describe kube-proxy's DaemonSet and read how many nodes it is meant to  (0s, 1 run)
  ok   3. Create your own DaemonSet, `node-agent`, that logs which node it runs   (3s, 2 runs)
  ok   4. Read the agent's logs from every pod at once.  (0s, 1 run)
  ok   5. Find out why no agent runs on the control-plane node.  (0s, 1 run)
  ok   6. Let the agent run on the control-plane node too, and watch the rollout  (6s, 1 run)
  ok   7. Delete one agent pod and see where its replacement lands.  (6s, 1 run)
  ok   8. Look at the DaemonSet's rollout history.  (0s, 1 run)
  ok   9. Delete the DaemonSet and confirm its pods go with it.  (0s, 1 run)
=== ons-hands-04 — Reach it inside the cluster
  ok   1. Create a ClusterIP Service for web on port 80.  [test variant]  (0s, 1 run)
  ok   2. See which pod IPs the Service is sending traffic to.  (0s, 1 run)
  ok   3. From a temporary client pod, fetch the page using the Service name.  (4s, 1 run)
  ok   4. Resolve the Service's full DNS name from a pod.  (2s, 1 run)
  ok   5. Scale web to zero, try the request again, then scale back to two.  [test variant]  (5s, 1 run)
  ok   6. Look at the Service's port and targetPort.  (0s, 1 run)
=== ons-hands-05 — Expose it outside the cluster
  ok   1. Forward a local port to the Service and fetch the page from your own t  [test variant]  (3s, 1 run)
  ok   2. Create a NodePort Service for web and find the port it was given.  [test variant]  (0s, 1 run)
  ok   3. Reach the app on the node port from outside the pods.  (3s, 2 runs)
  ok   4. Ask for a LoadBalancer Service and see what the environment gives you.  [test variant]  (0s, 1 run)
  ok   5. Check whether the cluster has an Ingress controller, then create an In  (0s, 1 run)
=== ons-hands-06 — Update it, break it, roll it back
  ok   1. Update web to nginx 1.28 and wait for the rollout to finish.  (1s, 1 run)
  ok   2. Record why, then look at the rollout history and the ReplicaSets.  (0s, 1 run)
  ok   3. Release a broken image tag and check the rollout with a short timeout.  [test variant]  (20s, 1 run)
  ok   4. Show that users are still being served, and find the exact error on th  [test variant]  (0s, 1 run)
  ok   5. Roll back and confirm which image is running.  (0s, 1 run)
=== ons-hands-07 — Configure it with ConfigMaps and Secrets
  ok   1. Create a ConfigMap `web-config` with GREETING=hello and MODE=practice.  [test variant]  (0s, 1 run)
  ok   2. Create a Secret `web-secret` with API_TOKEN=not-a-real-token, then rea  [test variant]  (0s, 1 run)
  ok   3. Inject both into web as environment variables and check them inside a   (2s, 1 run)
  ok   4. Change GREETING to `hi` in the ConfigMap, then check the running conta  (0s, 1 run)
  ok   5. Make the running pods pick up the change.  (1s, 1 run)
=== ons-hands-08 — When it breaks: CrashLoopBackOff and Pending
  ok   1. Deploy the `broken` app from the manifest below.  (0s, 1 run)
  ok   2. Look at its pods and describe what you see.  (3s, 2 runs)
  ok   3. Find out why the container exited.  (0s, 1 run)
  ok   4. Confirm how it terminated.  (0s, 1 run)
  ok   5. Fix it at the cause and verify.  (1s, 1 run)
  ok   6. Now create the `hungry` pod and find out why it never starts.  (0s, 1 run)
  ok   7. Clean up the unschedulable pod.  (0s, 1 run)
=== ons-hands-09 — Write it yourself: Deployment + Service from scratch
  ok   1. Write `shop.yaml`: a Deployment `shop` (2 replicas, nginx 1.28, label   (0s, 1 run)
  ok   2. Validate it against the API server without creating anything.  (0s, 1 run)
  ok   3. Apply it and wait until it is ready.  (2s, 1 run)
  ok   4. Change replicas to 3 in the file, preview the change, then apply it.  [test variant]  (0s, 1 run)
  ok   5. Prove the Service answers by name.  (4s, 1 run)
=== ons-hands-11 — Look inside etcd with etcdctl
  ok   1. Find the etcd pod.  (0s, 1 run)
  ok   2. See how the API server is configured to reach etcd.  (0s, 1 run)
  ok   3. Find etcd's own certificate, key, CA and data directory.  (0s, 1 run)
  ok   4. Define an `etcdctl` helper that runs inside the etcd pod with the righ  (0s, 1 run)
  ok   5. List etcd's cluster members.  (0s, 1 run)
  ok   6. Check etcd's health and status.  (0s, 1 run)
  ok   7. See how Kubernetes lays out its objects as keys.  (0s, 1 run)
  ok   8. Create a Secret, then read its raw value straight out of etcd.  [test variant]  (0s, 1 run)
  ok   9. Take a snapshot and inspect it.  (0s, 1 run)
  ok   10. Read how a restore works — but do not run one.  (0s, 1 run)
```

## What the runs caught (fixed before the final run)

- **01 task 5:** `kubectl api-resources | head -25` never reaches the `apps` group, so
  Deployments were not in the output the task promised. It now filters for the rows it discusses.
- **08 task 1:** the broken app's manifest was invalid YAML — `echo "FATAL: ..."` contains
  `: `, which YAML read as a mapping, and the API server rejected it. The argument is now quoted.
- **08 task 3:** on this cluster `kubectl logs --previous` consistently answered
  `unable to retrieve container logs` for the crash-looping container, while plain `kubectl logs`
  showed the failure. It is not clear whether that happens on Killercoda or Docker Desktop, so
  the task now uses both commands and explains what each shows.

## Not validated here

- Typing the `k` alias and its Tab completion in an interactive shell (see Method).
- The etcd scenario on Killercoda or Docker Desktop. It relies on etcd running as a kubeadm-style
  static pod labelled `component=etcd` with certificates under `/etc/kubernetes/pki/etcd/`, which
  is how kind runs it too; the scenario tells Docker Desktop users to switch to Killercoda if no
  etcd pod is visible.

- Killercoda and Docker Desktop themselves, including Killercoda's Traffic/Ports page and Docker
  Desktop publishing node ports and LoadBalancer Services on `localhost` (the scenario text says
  "usually" and "typically" for those).
- zsh (the macOS default shell). The commands avoid bash-only syntax and `sed -i.bak` works with
  both GNU and BSD sed, but nothing was run in zsh.
- Interactive forms (`-w` watches, a second terminal for port-forward) beyond the exact commands
  listed above.
