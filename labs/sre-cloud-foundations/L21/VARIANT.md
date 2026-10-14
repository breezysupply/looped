# L21 independent variant

After passing with one variant, run the other without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L21/reset.sh     # or variant-a
cat labs/sre-cloud-foundations/L21/work/TICKET.md
# write NEW hypotheses in evidence/L21-notes.md before opening a trace
python3 labs/sre-cloud-foundations/L21/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L21/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L21/evidence/L21-notes.md
```

`reset.sh` keeps your previous `work/` in `.work-previous/` (copy your dashboard and your
worker/API changes back if you like — the cardinality and propagation fixes are the same) and
starts from the starter with the other latency cause. The symptom on the sensor page looks the
same; the evidence does not. Import `evidence/variant.json` as the independent variant.

**Changed-symptom extension (no validator):** with everything green, run
`python3 labs/sre-cloud-foundations/L21/assets/traffic.py --seconds 120 --rps 20` and watch the
API CPU panel and the p95 panel together. Predict first: at what request rate does a CPU-bound
handler in one Python process start queueing, and which panel shows it before users do?
