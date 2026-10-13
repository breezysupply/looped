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

**Changed-symptom extension (no validator):** with everything green, add a second API replica
from a different label set (`kubectl -n beacon run api-debug --image=looped-l18-beacon:1.4.0
--labels app=beacon-api-debug -- api`). Predict whether it can reach the database, prove it with
`probe.py` through `kubectl exec`, and explain why label hygiene is part of network security.
Delete the debug pod afterwards (`kubectl -n beacon delete pod api-debug`).
