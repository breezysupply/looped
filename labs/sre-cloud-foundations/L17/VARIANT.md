# L17 independent variant

After passing c1–c4, run the independent fault without hints:

```sh
LOOPED_VARIANT=variant-d bash labs/sre-cloud-foundations/L17/reset.sh
tail -n 8 labs/sre-cloud-foundations/L17/work/TICKETS.md
# diagnose from events and object status only; restore the database with its data intact,
# then repeat the drain drill (scale/budget decision of your own)
python3 labs/sre-cloud-foundations/L17/validate.py --variant variant-d --assistance independent \
  --out labs/sre-cloud-foundations/L17/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L17/evidence/L17-notes.md
```

`reset.sh` deletes every L17 object (including the database PVC), keeps your manifests in
`.work-previous/manifests`, rebuilds the baseline with a freshly restored dataset and injects
variant-d. The symptom is a database outage after a resource change; decide which phase it is in
before you read any manifest. Rewrite the Pending section for this fault and say why the data
survived this time when it did not in c3. Import `evidence/variant.json` as the independent
variant.

**Changed-symptom extension (no validator):** with everything green, run the drill against the
node that holds `beacon-db-0`:
`bash labs/sre-cloud-foundations/L17/assets/drain-drill.sh <that node>`. The drain completes,
yet the database pod stays Pending until the node is uncordoned. Read the PV's
`spec.nodeAffinity` and explain what that says about local-path storage, then what a
zone-redundant storage class would have to provide instead.
