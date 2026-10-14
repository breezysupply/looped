# L09 independent variant

After passing with one variant, run another without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L09/reset.sh     # or variant-a / variant-c
python3 labs/sre-cloud-foundations/L09/assets/archcheck.py labs/sre-cloud-foundations/L09/work/inventory.json
# fix, re-fill failure_analysis / cost / recovery if they changed, rewrite "Fault found"
python3 labs/sre-cloud-foundations/L09/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L09/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L09/evidence/L09-explanation.md
```

`reset.sh` restores the colleague's draft for the new variant, so the analysis fields are empty
again; your previous inventory is in `work/inventory.json.bak` and you may copy text from it,
but re-run `--spof` and `--cost` because the answers can differ (variant C has an extra SPOF
until it is fixed; variant A changes the cost). Import `evidence/variant.json` as the
independent variant.

**Changed-symptom extension (no validator):** the customer now asks for the worker to keep
working if the partner webhook is down for six hours. Change the inventory and explanation to
say how (queue depth, retention, alert) and what it costs; `--spof` will still list
`partner-hooks`, and your `mitigation` text is what changes.
