# L18 worked solution

`alias kp='kubectl --context kind-looped-policy -n beacon'` · `SA=system:serviceaccount:beacon:beacon-deployer`

## c1 — the deploy bot

```
$ cat work/deploy-bot.log
[deploy-bot] 1/4 read deployment
deployment.apps/beacon-api
[deploy-bot] 2/4 record release
Error from server (Forbidden): deployments.apps "beacon-api" is forbidden: User
"system:serviceaccount:beacon:beacon-deployer" cannot patch resource "deployments" in API group
"apps" in the namespace "beacon"
$ kp auth can-i patch deployments.apps --as $SA
no
```

Variant A: add `patch` to the deployments rule — only there. Variant B fails at step 3 (`cannot
watch resource "deployments"`): add `watch`. Variant C fails at step 4 (`cannot list resource
"pods"`; `kubectl logs deploy/…` lists pods by selector): add `list` on pods. Apply, re-run the
bot to `release run complete`, then prove the negatives:

```
$ for q in "delete deployments.apps" "get secrets" "create pods/exec" "create rolebindings.rbac.authorization.k8s.io"; do kp auth can-i $q --as $SA; done
no
no
no
no
$ kubectl --context kind-looped-policy auth can-i list pods -n kube-system --as $SA
no
$ kubectl --context kind-looped-policy auth can-i list nodes --as $SA
no
```

Not acceptable: binding the `edit` ClusterRole (it grants Secrets, exec and deletes), `verbs:
["*"]`, or a ClusterRoleBinding (the bot would gain the same rights in every namespace).

## c2 — segmentation

Before: every row in `netcheck.sh` is `open` — no policy, flat network. After applying the
teammate's file:

- Variant A: `api → DNS + db:5432` → `"dns": "fail:gaierror"`. Default-deny covers egress, and
  the file has no rule allowing port 53 to CoreDNS, so the pod cannot even resolve the name. Add
  the `allow-dns-egress` policy (every pod → `k8s-app: kube-dns` in the namespace labelled
  `kubernetes.io/metadata.name: kube-system`, UDP and TCP 53).
- Variant B: same symptom; the DNS rule exists but its namespaceSelector uses `name:
  kube-system`, which no namespace carries (`kubectl get ns kube-system --show-labels`). Fix the
  label.
- Variant C: `"dns": "ok", "tcp": "timeout"` for API → DB. API egress allows it; the database's
  ingress rule selects `app: api`, which no pod has. Fix the selector to `app: beacon-api`.

Final matrix:

```
api → DNS + db:5432 (by name)      want allow  got {"dns": "ok", …, "tcp": "open", "pg": "N"}
report → DNS (kubernetes.default)  want allow  got {"dns": "ok"}
report → db:5432 (by IP)           want deny   got {…, "tcp": "timeout"}
api → report:9090 (by IP)          want deny   got {…, "tcp": "timeout"}
api → kube API:443 (by IP)         want deny   got {…, "tcp": "timeout"}
CNI: calico-node 2/2 ready
```

The deny rows use ClusterIPs so a DNS failure cannot masquerade as a policy deny, and the
report's own DNS row is the positive control proving that pod's network works at all. Not
acceptable: deleting `default-deny`, `egress: [{}]`, or an ipBlock `0.0.0.0/0` — each makes
the "deny" rows open and fails the validator.
