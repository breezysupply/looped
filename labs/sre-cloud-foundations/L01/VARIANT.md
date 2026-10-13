# L01 independent variant

After passing with one variant, run the other without hints:

```sh
sudo LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L01/reset.sh   # or variant-a
python3 labs/sre-cloud-foundations/L01/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L01/evidence/variant.json --explanation-file labs/sre-cloud-foundations/L01/evidence/L01-hypotheses.md
```

Write a fresh hypothesis log for the new symptom (the old one quotes a different FATAL line and
will not pass `reproduced`). Import `evidence/variant.json` as the independent variant.
