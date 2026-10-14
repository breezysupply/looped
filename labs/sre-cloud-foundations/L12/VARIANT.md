# L12 independent variant

After passing with one variant, run another without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L12/reset.sh     # or variant-a / variant-c
cat labs/sre-cloud-foundations/L12/work/TICKET.md
# write a NEW Prediction, resolve the ticket, then redo the module + staging from .work-previous/
python3 labs/sre-cloud-foundations/L12/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L12/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L12/evidence/L12-plan-notes.md
```

`reset.sh` removes every `looped-l12-*` object and both states, keeps your `.tf` files in
`.work-previous/`, and records a new seed record and volume creation time. Rewrite the
Prediction, Drift/Import and Replacement sections for the new ticket. Import
`evidence/variant.json` as the independent variant.

**Changed-symptom extension (no validator):** with everything green, run
`docker stop looped-l12-staging-api` and predict the staging plan before running it (this
provider reports a stopped container's ports as missing, so the plan proposes a replacement).
Decide whether `docker start` or `terraform apply` is the right fix and write why.
