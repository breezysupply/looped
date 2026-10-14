# L29 independent variant

The three drafts plant different wrong assumptions: one variant gets identity and scope wrong,
one gets network objects wrong, one gets managed-cluster responsibility and availability wrong.
The diagrams, the matrix and all thirteen judgements are yours in every variant.

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L29/reset.sh      # or variant-a / variant-c
python3 labs/sre-cloud-foundations/L29/assets/xlate.py labs/sre-cloud-foundations/L29/work/translation.yaml
python3 labs/sre-cloud-foundations/L29/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L29/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L29/evidence/L29-notes.md
```

Your previous worksheet is kept as `work/translation.yaml.bak`; copy your diagrams and matrix
across, but re-read every row the checker flags rather than pasting old rows over the draft.
Rewrite **Fault found** for the new variant and add one sandbox test you would run first to
confirm the riskiest assumption. Opening another variant's draft before finishing yours is
reading the answer — record the attempt as assisted.
