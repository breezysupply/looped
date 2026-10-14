# L10 independent variant

After passing with one variant, run another without hints:

```sh
LOOPED_VARIANT=variant-c bash labs/sre-cloud-foundations/L10/reset.sh      # or variant-a / variant-b
python3 labs/sre-cloud-foundations/L10/assets/iameval.py run labs/sre-cloud-foundations/L10/assets/cases/ticket --explain
# diagnose, patch work/exporter-policy.json (and/or the session), extend work/tests.json
python3 labs/sre-cloud-foundations/L10/validate.py --variant variant-c --assistance independent \
  --out labs/sre-cloud-foundations/L10/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L10/evidence/L10-notes.md
```

Your predictions carry over (the predict cases do not change); rewrite the *Ticket diagnosis*
section of your notes for the new symptom. Add at least one test to `work/tests.json` that would
have caught this variant's fault. Import `evidence/variant.json` as the independent variant.

**Changed-symptom extension (no validator):** the job now runs from a subnet that reaches S3
through a different VPC endpoint (`vpce-0ffee000000000001`). Predict T1 before evaluating it,
then write in your notes who has to change what (hint: not your role policy) and why
broadening the exporter policy cannot help.
