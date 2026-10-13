# L30 independent variant

Each variant is a different customer ticket backed by a different fixture mode: a nightly job
failing after maintenance, half the calls failing after a concurrency change, summaries that end
mid-sentence while the job reports success, a job that hangs until the scheduler kills it, and
a failure that started when the customer turned on streaming. Your `repro.py` must already
classify all of them (the validator runs every mode); what changes is the diagnosis, the request
id and the reply.

```sh
LOOPED_VARIANT=variant-d bash labs/sre-cloud-foundations/L30/reset.sh      # or variant-b, -c, -e
cat labs/sre-cloud-foundations/L30/work/TICKET.md
python3 labs/sre-cloud-foundations/L30/validate.py --variant variant-d --assistance independent \
  --out labs/sre-cloud-foundations/L30/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L30/evidence/L30-notes.md
```

Write a new reply for the new ticket (keep the old one as `customer-reply-<variant>.md` if you
want it). Before validating, predict from the ticket text alone which category your repro will
print, then check it. Note what in the customer's own log misled you, if anything.
