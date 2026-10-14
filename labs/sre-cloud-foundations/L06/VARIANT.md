# L06 independent variant

Three variants: two handshake faults (issuer, name) and one proxy-to-backend fault behind a
handshake that is perfectly fine. After passing one, run another without hints:

```sh
sudo LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L06/reset.sh   # or variant-a / variant-c
cp labs/sre-cloud-foundations/L06/assets/notes-template.md labs/sre-cloud-foundations/L06/evidence/L06-notes.md
sudo python3 labs/sre-cloud-foundations/L06/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L06/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L06/evidence/L06-notes.md
```

Before running anything, write down which layer you expect to fail from the client's error
message alone, and check yourself against the handshake output.
