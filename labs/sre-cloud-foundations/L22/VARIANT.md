# L22 independent variant (week 34)

After passing with one variant, run the other without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L22/reset.sh     # or variant-a
python3 labs/sre-cloud-foundations/L22/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L22/evidence/variant.json
```

`reset.sh` writes the other draft and the other month of traffic; your tests stay. Run your
existing tests against the new draft **before** changing anything: if they all pass, they were
written for one defect, not for the behaviour — add the scenario that would have caught this one.
Recompute the budget for the new month (the decision changes: one month has budget left, the
other is overspent). Import `evidence/variant.json` as the independent variant.

**Changed-symptom extension (no validator):** the team wants 99.9 % instead of 99.5 %. Recompute
both months' budgets, change the two burn thresholds (14.4× and 6× of 0.001) and predict, before
running your tests, which of your fixtures change outcome.
