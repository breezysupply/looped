# L16 independent variant

After passing one variant, reset to another and solve it without hints:

```sh
LOOPED_VARIANT=variant-c bash labs/sre-cloud-foundations/L16/reset.sh     # or variant-a / variant-b
python3 labs/sre-cloud-foundations/L16/validate.py --variant variant-c --assistance independent \
  --out labs/sre-cloud-foundations/L16/evidence/variant.json --explanation-file labs/sre-cloud-foundations/L16/evidence/L16-notes.md
```

All three variants produce the same client error, so the symptom alone tells you nothing. In
your notes, name the first hop where the evidence disagrees with the next one, and the field
you changed. Import `evidence/variant.json` as the independent variant.
