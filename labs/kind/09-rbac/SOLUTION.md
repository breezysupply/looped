# Lab 09 — solution

## Mechanism

The pod runs as ServiceAccount `stock-sync` in `looped-lab`; the kubelet mounts
a short-lived projected token for it. The API server authenticates that token
as user `system:serviceaccount:looped-lab:stock-sync`, then asks the RBAC
authorizer whether that user may `list configmaps` in `looped-lab`.

Role `configmap-reader` allows get/list/watch on configmaps, but the
RoleBinding's subject is `ServiceAccount stock-sync` **in namespace
`inventory-old`**, i.e. `system:serviceaccount:inventory-old:stock-sync`, a
different identity. A ServiceAccount's name is only unique within its
namespace. No rule matches, RBAC denies by default, 403. Readiness only checks
the loop is alive, so the pod is Ready while every sync fails.

## Valid fixes

1. **Correct the binding's subject** (subjects are editable; `roleRef` is not):

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab patch rolebinding stock-sync-configmap-reader --type=json \
     -p '[{"op":"replace","path":"/subjects/0/namespace","value":"looped-lab"}]'
   ```

2. Or re-apply a corrected RoleBinding manifest (same Role, subject namespace
   `looped-lab`). Fix the migrated manifests in version control as well.

The Role stays namespaced and read-only. Check both directions:

```sh
kubectl --context kind-looped-onsite auth can-i list configmaps -n looped-lab --as=system:serviceaccount:looped-lab:stock-sync      # yes
kubectl --context kind-looped-onsite auth can-i delete configmaps -n looped-lab --as=system:serviceaccount:looped-lab:stock-sync    # no
kubectl --context kind-looped-onsite auth can-i list secrets -n looped-lab --as=system:serviceaccount:looped-lab:stock-sync        # no
```

Not fixes (they "work" and fail verify): a ClusterRoleBinding, binding
`view`/`edit`/`cluster-admin`, adding `secrets` or write verbs to the Role,
switching the pod to another ServiceAccount that happens to have access.

## Why this matters in an interview

Walk the chain: token → authenticated username (namespace included) →
RoleBinding subjects → roleRef → rules → verb/resource/namespace. Say that 401
and 403 are different failures, that "Ready" said nothing about whether the
app's work succeeded, and prove least privilege with `auth can-i` in both
directions.
