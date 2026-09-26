# Lab 09 — stock-sync Running and Ready, but not syncing: API access denied

Real-cluster version of simulated lab **ons-lab-09**.
Lessons: `les-identity`, `les-config`.

## Ticket

> Inventory counts stopped updating after last week's migration of stock-sync
> from namespace `inventory-old` to this namespace. The stock-sync pod is
> Running and Ready and nobody has touched its Deployment. It reads
> ConfigMaps through the Kubernetes API.
>
> **Impact:** stale inventory. **Recent change:** namespace migration.

## Objective

Restore syncing **with least privilege** (stock-sync needs to get/list
ConfigMaps in `looped-lab`, nothing more), and verify both what it can and
what it still cannot do.

## What is simulated or simplified

- stock-sync is a `curl` loop: every 5 s it calls
  `GET https://kubernetes.default.svc/api/v1/namespaces/looped-lab/configmaps`
  with the pod's projected ServiceAccount token and the mounted cluster CA, and
  logs `sync ok` or the HTTP status and message.
- Its readiness probe only checks that the loop is alive (a heartbeat file),
  which is why the pod is Ready while the work fails.
- Namespace `inventory-old` does not exist in this cluster; it appears only in
  the RBAC objects that were migrated.

## Steps

1. Once: `labs/kind/setup.sh`
2. Inject: `labs/kind/09-rbac/inject.sh`
3. Investigate. Start with read-only commands:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab get pods -l app=stock-sync
   kubectl --context kind-looped-onsite -n looped-lab logs deployment/stock-sync --tail=5
   kubectl --context kind-looped-onsite -n looped-lab get deployment stock-sync -o jsonpath='{.spec.template.spec.serviceAccountName}{"\n"}'
   kubectl --context kind-looped-onsite -n looped-lab get serviceaccount,role,rolebinding -l app=stock-sync -o wide
   kubectl --context kind-looped-onsite -n looped-lab get rolebinding stock-sync-configmap-reader -o yaml
   kubectl --context kind-looped-onsite -n looped-lab get role configmap-reader -o yaml
   kubectl --context kind-looped-onsite auth can-i list configmaps -n looped-lab --as=system:serviceaccount:looped-lab:stock-sync
   ```

   The last command asks the API server to evaluate a request *as* the
   ServiceAccount (impersonation). Work out which identity the pod presents,
   what the Role allows, and whom the RoleBinding grants it to.

4. What you should observe:
   - Pod `Running`, `READY 1/1`, 0 restarts.
   - Log lines like `sync failed: HTTP 403 "message": "configmaps is forbidden: User \"system:serviceaccount:looped-lab:stock-sync\" cannot list resource \"configmaps\" in API group \"\" in the namespace \"looped-lab\""`.
     A 403 means the API server authenticated the token (a bad token would be
     401) and then authorization denied the request.
   - `auth can-i … --as=…` prints `no`.
   - The RoleBinding's subject column shows `inventory-old/stock-sync`.
   - Timing: the first 403 is logged within seconds; the loop retries every
     5 s, so a fix shows up in the log within ~5 s. RBAC changes take effect
     without restarting the pod.
5. Fix: your call. Least privilege: do not use a ClusterRole/ClusterRoleBinding
   or broaden the verbs.
6. Verify: `labs/kind/09-rbac/verify.sh`
   Checks with `kubectl auth can-i --as=system:serviceaccount:looped-lab:stock-sync`:
   **allowed** get/list configmaps in `looped-lab`; **still denied** create,
   update, delete configmaps, get/list secrets, list pods, list configmaps in
   `default`, `kube-system` and all namespaces, and `*` on `*`. Also: the
   Deployment still uses ServiceAccount `stock-sync` and the latest log line is
   `sync ok`.
7. Then read `SOLUTION.md`.
8. Reset: `labs/kind/reset.sh 09`

## Lab vs production

- You are cluster-admin here (kind's kubeconfig), so you can read and edit
  RBAC and impersonate. In production, both are privileged, audited actions,
  and the RoleBinding would change through the same review as the app.
- Kubernetes RBAC is not cloud IAM: it governs the Kubernetes API only. If a
  pod needs a cloud API, that is a separate identity mechanism (workload
  identity federation), with its own trust configuration.
- Namespace migrations often break exactly this: subjects carry a namespace.
  An audit of RoleBindings whose subjects point at namespaces that no longer
  exist is a useful check.

## References

- [Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/)
- [Accessing the Kubernetes API from a Pod](https://kubernetes.io/docs/tasks/run-application/access-api-from-pod/)
- [kubectl auth can-i](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/)
- [RBAC Good Practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/)
