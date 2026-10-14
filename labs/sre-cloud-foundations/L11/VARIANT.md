# L11 independent variant

After passing with one variant, run another without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L11/reset.sh     # or variant-a / variant-c
terraform -chdir=labs/sre-cloud-foundations/L11/work plan
# write a NEW Plan prediction first; copy your store_path rule and test from .work-previous/
python3 labs/sre-cloud-foundations/L11/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L11/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L11/evidence/L11-notes.md
```

`reset.sh` destroys this workspace's resources, keeps your previous `.tf` files and tests in
`.work-previous/`, and records a new baseline deployment id. Import `evidence/variant.json` as
the independent variant.

**Changed-variable extension (no validator):** create a staging config the right way — a second
working directory with its own state — and show that dev's plan stays clean while staging's
first plan creates three resources. Explain in your notes why `terraform workspace` would also
work here and why the course prefers directories once environments differ in more than one
variable.
