# L19 independent variant

After passing with one variant, run another without hints:

```sh
LOOPED_VARIANT=variant-c bash labs/sre-cloud-foundations/L19/reset.sh     # or variant-a / variant-b
cat labs/sre-cloud-foundations/L19/work/TICKET.md
# write a NEW prediction for the change before applying it
python3 labs/sre-cloud-foundations/L19/validate.py --variant variant-c --assistance independent \
  --out labs/sre-cloud-foundations/L19/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L19/evidence/L19-notes.md
```

`reset.sh` uninstalls only the L19 release, keeps your previous chart in
`.work-previous/chart` and writes a new change file. The variants differ in WHERE the failure
shows up (render, or the nodes) and therefore in whether a failed revision exists to roll back.
Rewrite the Change and Rollback sections for the new run and import `evidence/variant.json`.

**Changed-symptom extension (no validator):** with 1.5.0 serving, render prod with
`--set podDisruptionBudget.minAvailable=3` and explain the chart's refusal: what would a budget
equal to the replica count do to `kubectl drain` (L17)? Then add your own invalid fixture to
`assets/invalid/` that the schema does NOT yet refuse (for example `config.inject.failRate: 0.5` with
`environment: prod` renders today — fault injection switched on in production), extend the
schema's prod rule, and show `render_assert.py` now counts the new refusal.
