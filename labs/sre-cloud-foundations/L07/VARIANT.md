# L07 independent variant

The independent variant changes the data, not the contract. Generate the other incident log and
explain its result without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L07/reset.sh     # or variant-a
cd labs/sre-cloud-foundations/L07/work && python3 logsummary.py data/incident-variant-b.jsonl; echo "exit=$?"
python3 labs/sre-cloud-foundations/L07/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L07/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L07/evidence/L07-notes.md
```

One variant's log is well formed and spans offsets around the day boundary; the other contains a
row your tool must refuse. In your notes, say what your tool did, whether that is what an on-call
engineer needs, and which test proves it.
