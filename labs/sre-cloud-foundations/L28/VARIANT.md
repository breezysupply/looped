# L28 independent variant

After passing one variant, rehearse the other without hints, in one sitting:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L28/reset.sh     # or variant-a
cat labs/sre-cloud-foundations/L28/work/TICKET.md
python3 labs/sre-cloud-foundations/L28/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L28/evidence/variant.json
```

The way the backup shelf misleads you changes, and so does the right recovery point. Start a new
update log (your old one is in `.work-previous/incident/`); do not reuse timestamps or wording.

**Changed-symptom extension (no validator):** with service restored, run
`docker compose -p looped-l28 -f labs/sre-cloud-foundations/L28/work/compose.yaml stop restore`.
Write the update you would send in the first five minutes — is this the same incident reopened
or a new one? — and the check that would have told you before users did.
