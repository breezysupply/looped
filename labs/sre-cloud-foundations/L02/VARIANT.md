# L02 independent variant

After passing one variant, rebuild the repository with the other and solve it without hints:

```sh
sudo LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L02/reset.sh   # or variant-a
python3 labs/sre-cloud-foundations/L02/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L02/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L02/evidence/L02-notes.md
```

The other variant changes what kind of problem the merge hides: in one the ticket branch does not
pass validation on its own; in the other the branch is valid and the danger is a whole-file
resolution that leaves the two configuration files disagreeing. Rewrite your notes for the new
run (new commit ids, new conflict hunk) and import `evidence/variant.json` as the independent
variant.
