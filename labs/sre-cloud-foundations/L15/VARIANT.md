# L15 independent variant

After passing one variant, reset to another and solve it without hints:

```sh
LOOPED_VARIANT=variant-c bash labs/sre-cloud-foundations/L15/reset.sh     # or variant-a / variant-b
python3 labs/sre-cloud-foundations/L15/validate.py --variant variant-c --assistance independent \
  --out labs/sre-cloud-foundations/L15/evidence/variant.json --explanation-file labs/sre-cloud-foundations/L15/evidence/L15-notes.md
```

The reset replaces `work/deployment.yaml` with the baseline, so CR-1042 has to be made again.
Rewrite the Observation/Hypotheses/Result sections of your notes for the new symptom; keep the
relationship map. In your explanation, name the controller that acted at each step and the
status field or event that showed it.
