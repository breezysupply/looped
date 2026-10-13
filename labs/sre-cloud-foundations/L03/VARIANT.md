# L03 independent variant

```sh
sudo LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L03/reset.sh    # or variant-a
```

Diagnose without hints, write a fresh `evidence/L03-diagnosis.md`, then:

```sh
python3 labs/sre-cloud-foundations/L03/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L03/evidence/variant.json --explanation-file labs/sre-cloud-foundations/L03/evidence/L03-diagnosis.md
```
