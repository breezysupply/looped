# L32 — Final assessment: unseen faults, a combined incident, and your design defence

Module M16 · ~240 min across weeks 47–48 (three checkpoints) · profiles: whatever the drawn labs
need (Linux VM, Compose, kind) plus **`kind-basic`** (or `kind-policy`) for your L31 rebuild ·
**local only; lab experience, not production experience**

## Ticket

> Assessment day. A seeded draw gives you two single faults from modules you have passed, in
> variants you have **not** seen, and one bounded two-fault incident on the Beacon deployment
> you rebuilt in L31 — with data at stake. Diagnose each from evidence, restore service and data,
> keep least privilege, write a sanitised incident report and a three-minute update, and defend
> five design decisions in ten minutes. Then clean up exactly what you created.

## Objectives

- `obj-m16-02` diagnose unseen single and combined faults with evidence, verify service and
  data, retain least privilege
- `obj-m16-03` justify five architecture decisions with rejected alternatives and name gaps

## How the faults are chosen

`setup.sh` records the draw once in `report/draw.json` (`LOOPED_SEED=…` to choose the seed; the
seed is in the evidence). `assets/draw.py` reads `assets/catalogue.json`:

- **Single faults** are earlier labs' own variants (59 of them, L03–L25: Linux, networking,
  scripting, cloud IAM, IaC, containers, Kubernetes, delivery, observability, recovery,
  security). Every lab/variant pair that appears as the seed of any evidence file in your
  `LNN/evidence/` directories is **excluded**, so you get variants you have not run. The two
  picks come from different domains and labs. You start each with that lab's own scripts and
  validate it with that lab's own `validate.py`, writing the evidence into
  `report/evidence/<fault>.json` — so each diagnosis is judged on real state by a validator that
  already exists.
- **The combined incident** (C1–C3) is injected into your L31 rebuild by `inject.sh`, after a
  pre-incident backup: two faults at once, one of which always puts data at risk, so you must
  make and defend a recovery-point decision. The draw says which incident, not what is wrong.

`python3 assets/draw.py --check report/draw.json` reproduces the draw from the seed and the
recorded exclusions. Reading `assets/incident.py` or the catalogue's fault list before you
finish is reading the answer: record the attempt as assisted.

## Steps and checkpoints

**c1 — two unseen single faults (week 47, session 1).** `bash labs/sre-cloud-foundations/L32/setup.sh`
prints both faults with their start, validate and teardown commands. For each: reproduce,
hypotheses, the discriminating check, the minimal fix, then the printed `validate.py … --out
labs/sre-cloud-foundations/L32/report/evidence/<fault>.json`. Fill **Fault 1** and **Fault 2**
of `report/incident-report.md` as you go (evidence path plus quoted output).

**c2 — the combined incident (week 47, session 2).** With your L31 rebuild running and passing,
`bash labs/sre-cloud-foundations/L32/inject.sh`. Work it like L28: time-stamped timeline, scope,
separate the two faults, decide the order, make the data decision explicitly (full restore,
selective restore, accept loss — what each loses), verify service and data, check the deploy
bot's `auth can-i` matrix, remove anything you added. Write the three-minute update.

**c3 — defence and evidence (week 48).** `report/design-defense.md` (five decisions with
rejected alternatives and evidence, the update, a ten-minute outline, the Terraform replacement
plan you inspected — `report/terraform-plan.txt` from a fresh L12 plan — and your gaps);
`report/python-change/` (a small fresh Python change with 3+ passing unittest tests);
`report/rubric-scores.json` (every domain ≥ 3 of 4 criteria in `assets/rubric.json`, each with an
evidence path). Tear down the single-fault labs, then
`python3 labs/sre-cloud-foundations/L32/validate.py --explanation-file labs/sre-cloud-foundations/L32/report/incident-report.md --cleanup verified`.

## How validation works

Draw reproduced and unseen; each single fault's evidence from its own lab validator (right lab
and variant, every check passed, written after the draw, assistance independent); live checks on
the rebuild after your recovery (service ready and serving writes, the seeded history back
**and** the newer post-backup records still present, deploy-bot least privilege with no broad
RoleBinding, no injected failure rate left in the release values, no L32-labelled object or
scratch database left); no container still running for a drawn lab; report structure and
evidence references, defence, rubric, Python tests, Terraform attribute named; no secret-shaped
string and no claim of production experience. Completion also needs the M16 gate.

Rubric for people (mentor or honest self-review): use `assets/rubric.json`. A structure check
cannot tell a good diagnosis from a lucky one; the evidence paths let a reviewer check.

## Reset, teardown, pause and resume

- `report/` is your checked-in bundle; nothing ever overwrites it. Pause any time.
- `reset.sh` puts the rebuild back to its pre-incident state (pre-incident backup restored, Helm
  rolled back, L32 objects removed, database password matching the Secret) and injects the same
  incident again.
- `teardown.sh` undoes the incident (L32-labelled objects only), removes `work/` and prints each
  drawn lab's own teardown command. Run those, then L31's teardown when you are done.

## Lab versus production

Real incidents have more noise, partial information, other people and pressure; here the faults
are fixture-controlled, bounded and documented after the fact. The data decision is real in
kind: a full restore here would really lose the newer rows.

## Limits — what this lab does not prove

It proves you can diagnose unseen, fixture-controlled faults with evidence, recover service and
data with an explicit recovery-point decision, keep least privilege, clean up exactly, and present
decisions honestly. It does **not** prove production experience, on-call readiness at scale, or
cloud proficiency. On kind-basic, NetworkPolicy is not enforced. Describe this as lab experience.

## References

- T01 Google SRE Workbook (incident response, postmortems) · T09 PostgreSQL backup and restore ·
  T13 Helm · T17 Terraform
