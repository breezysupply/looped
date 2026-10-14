# L26 independent variant

After passing one variant, take another without hints (three exist):

```sh
LOOPED_VARIANT=variant-c bash labs/sre-cloud-foundations/L26/reset.sh     # or variant-a / variant-b
cat labs/sre-cloud-foundations/L26/work/TICKET.md
python3 labs/sre-cloud-foundations/L26/validate.py --variant variant-c --assistance independent \
  --out labs/sre-cloud-foundations/L26/evidence/variant.json
```

`reset.sh` generates a NEW release key, so the fingerprint in your trust document changes: write
the document again (your previous one is in `.work-previous/`). The rejection reason differs per
variant, and so does where the fix belongs (media, sender inventory, or signer).

**Changed-symptom extension (no validator):** with everything green, run
`docker compose -p looped-l26-recv -f labs/sre-cloud-foundations/L26/work/inbox/beacon-1.4.0/deploy/compose.yaml --env-file labs/sre-cloud-foundations/L26/work/receiver/deployed-refs.env pull`
and explain what it contacts and why it succeeds; then explain what the same command would have
done on a connected site with a tag instead of a digest.
