# SLO rules for the capstone release

`rules/beacon-slo.rules.yml` and `tests/beacon-slo.test.yml` are copied here from L22 by
`L31/setup.sh` (your own `L22/work/` files when they exist, otherwise the course reference in
`L22/solution/`; `../PROVENANCE.md` says which). They live in the release bundle because L22's
`work/` directory is git-ignored: a fresh clone would not have it.

    bash labs/sre-cloud-foundations/L31/rebuild.sh slo     # promtool check rules + test rules
