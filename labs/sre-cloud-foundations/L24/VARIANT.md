# L24 independent variant

After passing with one variant, run the other without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L24/reset.sh     # or variant-a
bash labs/sre-cloud-foundations/L24/inject.sh
cat labs/sre-cloud-foundations/L24/work/TICKET.md
python3 labs/sre-cloud-foundations/L24/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L24/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L24/evidence/L24-notes.md
```

`reset.sh` reloads the source, recreates last night's backup, removes the restore target and
puts the starter worker back (yours is `work/worker.py.bak`). The morning backup is damaged in a
different way, so it fails differently during restore; the duplicates come from a different mix
of mechanisms. Measure the interval again — it is a new drill — and compare the two numbers
in your notes. Import `evidence/variant.json` as the independent variant.

**Changed-symptom extension (no validator):** run two workers
(`docker compose -p looped-l24 -f labs/sre-cloud-foundations/L24/assets/compose.yaml up -d --scale worker=2`
after removing `container_name` in a copy of the compose file). Predict first: with your fix,
can a message be delivered twice when two workers lease it after an expired lease? Why does the
constraint still hold where an in-memory "seen" set would not?
