# L20 independent variant

After passing with one variant, run another without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L20/reset.sh     # or variant-a / variant-c
bash labs/sre-cloud-foundations/L20/reconciler/run.sh                     # second terminal
# c1, c2 (inject.sh drift, inject.sh retag), c3 (inject.sh rollback-request) as in README.md
python3 labs/sre-cloud-foundations/L20/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L20/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L20/evidence/L20-notes.md
```

Each variant changes every step: a different regression for the gate, a different manual
change (one of them survives a plain server-side apply — find out which and why), and a
different integrity break (a human tag, the sha tag and the local image, or only the local
image). `reset.sh` keeps bundles of your previous repositories in `.work-previous/`.

**Changed-symptom extension (no validator):** make the gate fail on the **scan** instead of the
tests: add `ENV BEACON_API_TOKEN=lab-token-not-a-real-secret` to `work/app/Dockerfile`, commit,
run the pipeline, and explain why the stub blocks it and what a hosted secret should look like
instead. Revert the commit afterwards.
