# L13 independent variant

After passing one variant, run another without hints:

```sh
LOOPED_VARIANT=variant-c bash labs/sre-cloud-foundations/L13/reset.sh     # or variant-a / variant-b
python3 labs/sre-cloud-foundations/L13/validate.py --variant variant-c --assistance independent \
  --out labs/sre-cloud-foundations/L13/evidence/variant.json --explanation-file labs/sre-cloud-foundations/L13/evidence/L13-notes.md
```

Rewrite the Observation, Hypotheses, Discriminating check and Result sections of your notes
for the new symptom before you validate; the image record section stays. Import
`evidence/variant.json` as the independent variant. Each variant fails a different set of
checks, so passing one says nothing about the others.
