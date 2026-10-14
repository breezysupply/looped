# L08 independent variant

The other variant moves every fault: a different page stalls, one page answers 503 twice, the
Retry-After value changes, the loop starts earlier, and the inventory has a different size. A client
that hard-coded the first variant's behaviour will fail it.

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L08/reset.sh     # or variant-a
python3 labs/sre-cloud-foundations/L08/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L08/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L08/evidence/L08-notes.md
```

Before running the validator, run your CLI in faults mode and read `/_fixture/stats`
(`curl -s --noproxy '*' 127.0.0.1:8098/_fixture/stats`): predict, for each event, what your client
should have done next, and check that it did.
