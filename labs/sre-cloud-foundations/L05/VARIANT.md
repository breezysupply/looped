# L05 independent variant

L05 has three variants: two DNS faults that produce the same client error, and one that is not a
DNS fault at all. After passing one, run another without hints and write fresh notes:

```sh
sudo LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L05/reset.sh   # or variant-a / variant-c
cp labs/sre-cloud-foundations/L05/assets/notes-template.md labs/sre-cloud-foundations/L05/evidence/L05-notes.md
sudo python3 labs/sre-cloud-foundations/L05/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L05/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L05/evidence/L05-notes.md
```

For the independent attempt, write your hypothesis about the layer *before* running the second
command, and record whether the first piece of evidence confirmed or refuted it.
