# L04 independent variant

L04 has three variants. After passing one, re-inject a different one and diagnose it without
hints. Start a fresh triage note — the validator looks for the measurement that identifies the
*current* fault.

```sh
sudo LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L04/reset.sh   # or variant-a / variant-c
cp labs/sre-cloud-foundations/L04/assets/triage-template.md labs/sre-cloud-foundations/L04/evidence/L04-triage.md
sudo python3 labs/sre-cloud-foundations/L04/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L04/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L04/evidence/L04-triage.md
```

The symptom at the API is deliberately similar between the two disk variants; only the
measurement separates them. The CPU variant changes the symptom from "writes fail" to "writes
are slow", and the risk from deleting the wrong data to killing the wrong process.
