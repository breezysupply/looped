# L23 independent variant

After passing with one variant, run the other without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L23/reset.sh     # or variant-a
cat labs/sre-cloud-foundations/L23/work/TICKET.md                          # a different query
# c1 first: plan before, index, plan after — then:
bash labs/sre-cloud-foundations/L23/inject.sh                              # a different lock
python3 labs/sre-cloud-foundations/L23/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L23/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L23/evidence/L23-notes.md
```

`reset.sh` reloads the dataset (your indexes are dropped) and stops the fixtures. The new query
needs a different index; the new lock is of a different kind (row versus table), so the
`pg_locks` evidence and the waiters' wait events look different even though the pool symptom is
the same. Rewrite every notes section for the new run, then import `evidence/variant.json`.

**Changed-symptom extension (no validator):** after inject.sh, try `CREATE INDEX CONCURRENTLY`
on `readings` before resolving the lock. Predict first: does it finish, wait, or fail — and on
what? Cancel it and look for an `INVALID` index in `\d readings`.
