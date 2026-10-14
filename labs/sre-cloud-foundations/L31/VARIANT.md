# L31 independent variant

Each variant rebuilds into different configuration — namespace, cluster and chart environment —
and the colleague's draft hides a different prerequisite:

| Variant | Namespace | Cluster | Environment | Seed |
|---|---|---|---|---|
| a | beacon-capstone | looped-foundations | staging (2 replicas) | 240 |
| b | beacon-rebuild | looped-policy (Calico: NetworkPolicy enforced) | prod (3 replicas, PDB) | 240 |
| c | beacon-capstone | looped-foundations | dev (1 replica) | 360 |

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L31/reset.sh
bash labs/sre-cloud-foundations/L31/rebuild.sh check
bash labs/sre-cloud-foundations/profiles/kind-policy/setup.sh     # variant b needs the policy cluster
bash labs/sre-cloud-foundations/L31/rebuild.sh proof
python3 labs/sre-cloud-foundations/L31/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L31/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L31/release/REBUILD.md
```

Variant b is the one where your NetworkPolicies are enforced: before trusting `verify`, prove a
denied path from inside a pod (as in L18) and record it in the runbook. Update **Configuration**
and **Rebuild proof** for the new values instead of starting a new runbook.
