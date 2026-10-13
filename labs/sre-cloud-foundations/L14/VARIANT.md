# L14 independent variant

After passing one variant, reset to another and solve it without hints:

```sh
LOOPED_VARIANT=variant-c bash labs/sre-cloud-foundations/L14/reset.sh     # or variant-a / variant-b
# wait about a minute, then investigate
python3 labs/sre-cloud-foundations/L14/validate.py --variant variant-c --assistance independent \
  --out labs/sre-cloud-foundations/L14/evidence/variant.json --explanation-file labs/sre-cloud-foundations/L14/evidence/L14-notes.md
```

The reset keeps your PostgreSQL volume (records from earlier runs remain); add
`LOOPED_RESET_DATA=1` for an empty database. Rewrite the Observation/Hypotheses/Result sections
of your notes for the new symptom. One variant looks completely healthy until you test the
persistence promise yourself — do that before you run the validator.
