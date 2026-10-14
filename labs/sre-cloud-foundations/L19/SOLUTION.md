# L19 worked solution

## c1 — render, lint, install

```sh
C=labs/sre-cloud-foundations/L19/work/chart
helm lint $C -f $C/values-staging.yaml            # 1 chart(s) linted, 0 chart(s) failed
python3 labs/sre-cloud-foundations/L19/assets/render_assert.py $C
# ... PASS [schema] refuses-memory-bytes: exit 1: - at '/resources/limits/memory': got number, want string
# PASS render assertions: 62/62 passed
helm --kube-context kind-looped-foundations upgrade --install beacon $C -n beacon -f $C/values-staging.yaml --wait --timeout 3m
helm --kube-context kind-looped-foundations test beacon -n beacon --logs
#   ready 200 version {'version': '1.4.0', 'environment': 'staging', ...}
```

Prediction for `memory: 256` without a schema: Kubernetes accepts it as 256 **bytes**; the
container cannot even start (or is OOM-killed at once). The schema turns a confusing runtime
failure into a precise render-time error.

## c2 — the change

Variant A (`limits.memory: 192`): `helm upgrade` stops with
`- at '/resources/limits/memory': got number, want string`. Nothing reached the cluster, no
revision exists, staging is untouched. Fix the change file (`memory: 192Mi`) and upgrade:
revision 2, 2/2 pods on 1.5.0.

Variant B (`tag: "1.5.1"`): the upgrade waits and fails (`context deadline exceeded`); revision
2 is `failed`. `kubectl describe pod` on the new pod: `Failed to pull image
"looped-l19-beacon:1.5.1" … not found` → `ImagePullBackOff`. The two 1.4.0 pods stayed Ready
(`maxUnavailable: 0`), so users saw no outage. Restore a clean state with
`helm rollback beacon 1 --wait` (revision 3, "Rollback to 1"), set `tag: "1.5.0"` (the build
that exists: `docker images looped-l19-beacon`), upgrade → revision 4.

Variant C (`repository: registry.lab/beacon`): same symptom shape as B but the cause is the
location — the nodes have no route or credentials for that registry and the image was loaded as
`looped-l19-beacon`. Roll back the failed revision, correct `repository`, upgrade.

Do not: delete `values.schema.json`, loosen its patterns, add `--set` overrides that bypass the
change file, `kubectl edit` the Deployment (Helm's next upgrade overwrites it and history no
longer explains what runs), or use `--force` to paper over the failure.

## Rollback drill

```sh
helm --kube-context kind-looped-foundations history beacon -n beacon
helm --kube-context kind-looped-foundations rollback beacon 1 -n beacon --wait   # 1 = the 1.4.0 install
kubectl --context kind-looped-foundations -n beacon exec deploy/beacon -- python3 -c \
  "import urllib.request; print(urllib.request.urlopen('http://beacon:8080/version').read().decode())"
# {"version": "1.4.0", "environment": "staging", ...}
helm --kube-context kind-looped-foundations upgrade beacon $C -n beacon -f $C/values-staging.yaml \
  -f labs/sre-cloud-foundations/L19/work/change/values-1.5.0.yaml --wait
helm --kube-context kind-looped-foundations test beacon -n beacon --logs
```

The rollback is compatible here because Beacon 1.4.0 and 1.5.0 share the same (in-memory)
state and API; with a database migration in 1.5.0 it might not be (L20, D02).

Notes that pass the rubric: Render explains schema vs. API validation vs. kubelet failure;
Change quotes the first real error line and names the cause; Rollback names the revision chosen,
shows `/version` before and after, and states what rollback does not undo.
