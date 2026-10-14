# L32 independent variant

The assessment is already a variant: the seed decides which unseen single faults and which
combined incident you get, and every variant you have already run is excluded. For practice
before assessment day, or for a mentor-approved retake, draw again with a new seed into a
separate bundle so the first attempt is preserved:

```sh
mv labs/sre-cloud-foundations/L32/report labs/sre-cloud-foundations/L32/report-attempt-1
LOOPED_SEED=retake-$(date -u +%Y%m%d) bash labs/sre-cloud-foundations/L32/setup.sh
python3 labs/sre-cloud-foundations/L32/assets/draw.py --check labs/sre-cloud-foundations/L32/report/draw.json
bash labs/sre-cloud-foundations/L32/reset.sh      # the rebuild back to pre-incident, then the new incident
python3 labs/sre-cloud-foundations/L32/validate.py --assistance independent \
  --out labs/sre-cloud-foundations/L32/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L32/report/incident-report.md
```

Because the first attempt's evidence now exists, its single faults are excluded from the new
draw. Rewrite the update and the data decision for the new incident; keep the five decisions
but add one you changed your mind about, and why.
