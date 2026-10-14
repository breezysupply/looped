# L18 independent variant

After passing with one variant, run another without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L18/reset.sh     # or variant-a / variant-c
cat labs/sre-cloud-foundations/L18/work/deploy-bot.log
bash labs/sre-cloud-foundations/L18/assets/netcheck.sh                    # baseline before c2
python3 labs/sre-cloud-foundations/L18/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L18/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L18/evidence/L18-notes.md
```

`reset.sh` deletes every L18 object, keeps your manifests in `.work-previous/manifests` and
prepares a different missing verb and a different policy defect. The symptoms look alike from a
distance (the bot stops; the API cannot use the database); the evidence that separates them is
not. Rewrite the RBAC and Policy sections and import `evidence/variant.json`.

**Changed-symptom extension (no validator):** with everything green, take one beacon-report pod
out of its ReplicaSet by relabelling it as the API
(`kubectl --context kind-looped-policy -n beacon label pod <report-pod> app=beacon-api --overwrite`;
the ReplicaSet starts a replacement because the pod no longer matches its selector). Predict
whether the relabelled pod can now reach the database, prove it with `probe.py` through
`kubectl exec`, and explain why label hygiene (who may set labels, and admission rules on them)
is part of network security. Delete the orphaned pod afterwards
(`kubectl --context kind-looped-policy -n beacon delete pod <that pod>`).
