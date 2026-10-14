# L31 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** "It works on my cluster" is the symptom. List everything the rebuild touches
   that it did not create itself: images in the nodes, Secrets, files in other labs' `work/`
   directories, variables in your shell. Each is a hidden prerequisite until the rebuild makes it.
2. **Evidence source.** `bash rebuild.sh check` names every failing row. Then run the validator:
   its `fresh-checkout` row repeats the check in a copy of only the non-ignored files with an
   empty environment — exactly what a colleague's clone would see.
3. **Discriminating check.** For each key in `release/rebuild.env`, ask "where does this value
   point, and would a fresh clone have it?" (`git check-ignore -v <path>`). For the reused
   telemetry, compare the metric names and histogram buckets in your rules and dashboard with
   what `beacon/beacon/api.py` and `telemetry.py` actually export.
4. **Root cause and fix.** Variant A: `IMAGE_SOURCE=build`, `IMAGE_REPO=looped-l31-beacon` (the
   L19 image in the nodes is not yours and has no PostgreSQL driver). Variant B:
   `DB_SECRET_SOURCE=generate` (L18's Secret lives in namespace `beacon`). Variant C:
   `SLO_DIR=labs/sre-cloud-foundations/L31/release/slo` (L22's `work/` is git-ignored). In every
   variant: rename `beacon_http_*` → `beacon_*`, `beacon_l21_*` → `beacon_*`, `le="0.3"` →
   `le="0.25"`, drop the dependency panel, and keep promtool tests green.
