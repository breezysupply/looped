# L27 independent variant

After passing one variant, run the other without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L27/reset.sh     # or variant-a
python3 labs/sre-cloud-foundations/L27/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L27/evidence/variant.json
```

The starting point moves between the client side and the server side of the same overload, so
the first symptom you see differs (duplicates or none, timeouts or queueing). Repeat the step test
and the replica experiment — do not reuse old runs; `reset.sh` moves them to `.work-previous/`.

**Changed-symptom extension (no validator):** set `WRITE_PATH=append-only` in `work/limits.env`,
recreate the api, repeat the step test and predict before running it where the new ceiling will
be and what will limit it next (CPU of one api replica? the pool? `max_connections`?).
