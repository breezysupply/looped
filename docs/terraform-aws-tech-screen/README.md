# Terraform + AWS: From Guided Builds to Live Tech Screen

Course id `terraform-aws-tech-screen`, LOOPED track `tfaws`. A standalone
curriculum for learning Terraform from the basics to a 45-minute blank-editor
screen, built on AWS knowledge you already have. Existing tracks, progress
and storage are untouched; this course keeps its state in `lx.tfaws`.

Every exercise is representative practice written for this course — not a
known Anduril question — and the app does not reproduce HackerRank or its
grading.

## Opening it

- Track pill → **Terraform + AWS: Guided Builds to Live Tech Screen**. Learn
  opens on **Course** → Overview → **Start this course**, then **Start** or
  **Resume where you left off**.
- Locally: `node tests/server.js`, then <http://127.0.0.1:8099/index.html>.
- Real Terraform practice: `labs/terraform-aws-tech-screen/` (see its README).

## Structure

| Module | Core time | Contents |
|---|---:|---|
| 0 Orientation and baseline | 10 | How the course works; ungraded diagnostic |
| 1 Foundations + local warm-up | 40 | 3 lessons; Build 0 (`terraform_data`, runs locally with no AWS); checks |
| 2 Guided private S3 | 40 | Lesson; Build 1; checks; oral |
| 3 Guided public EC2 network | 65 | 4 lessons (network, security, compute, traffic walkthrough); Build 2 + rebuild variant; checks; oral |
| 4 Scaffolded private subnet + NAT | 65 | 2 lessons; Build 3; five injected faults; checks; oral |
| 5 Variables, iteration, debugging | 50 | 4 lessons; for_each and parameterising exercises; synthetic plan reading; 9 bug tickets |
| 6 Requirements-only build | 45 | Build 4 from blank files, with a halfway change request; optional ALB stretch |
| 7 Two mock screens + reviews | 110 | Mock A (public service) and Mock B (private worker), 2 seeded variants each |
| 8 Interview readiness | 10 | Opening worksheet, three questions, day-of checklist, Bash/Python backup card |
| **Recommended** | **435** | 7 h 15 min over Oct 21–29 (America/New_York) |

Minimum path: Modules 0–4, the 20-minute Module 5 essentials, Mock A + review,
Module 8 = **305 min** (labelled as not equivalent preparation). Self-paced
mode hides dates. Missed days never lock anything; "Start the plan from
today" shifts the schedule and keeps progress. Optional work (rebuilds,
stretch lab, extra mock variants, the 60-minute rehearsal wrapper) is never
counted.

Each substantial lesson: objective and prerequisites; a 250–450 word
explanation; an annotated example; a prediction; a build task with success
criteria, practice checks and three escalating hints; a hidden reference
solution with why it works, mistakes and an alternative; 2–3 oral prompts;
a retrieval task.

Builds offer four assistance levels — guided, scaffolded, requirements only,
interview — with genuinely different starting files. Hints and solutions
mark an attempt assisted; guided and scaffolded completions count as
assisted; a paused timed attempt is untimed practice. "Start a new attempt"
keeps every earlier attempt.

## Execution modes (always labelled)

- **Simulated** (default): a terminal that reads your files with the practice
  parser and models init/validate/plan/apply/destroy/output/state as a state
  machine (plan before init is refused; changing an input shows an update;
  replacements propagate to dependents; apply asks for `yes`). Every line
  starts with `(simulated)`. It runs no Terraform and touches no AWS.
- **Local Terraform**: copy all files as a shell script or download it, run
  the real CLI. Pasted results are stored as learner-supplied.
- **Optional AWS**: explicit opt-in with a sandbox statement; steps, billable
  resources, cleanup and "nothing left" checks. The app never applies.

## Assessment

100-point practice rubric: core resources 30, network/security 25, HCL 20,
verification 15, communication 10. Automatically checked points (53 per
mock) and self-assessed points (47) are kept apart; unassessed items show as
"not assessed" and no total is shown until everything is assessed.
Verification and communication are never auto-scored. Critical issues
(missing routing, a private instance exposed, world-open admin access,
embedded credentials, unable to explain the path) are flagged with
remediation. Practice target: two independent timed mocks at 80+ with the
core satisfied and no unresolved critical issue — not an employer passing
score. Misses go to a categorised mistake log and a 10-minute review queue.

## Checks run (2026-10-21/22)

| Check | Result |
|---|---|
| `labs/terraform-aws-tech-screen/validate-all.sh` | 16/16 references and alternatives pass real fmt/init/validate; 10 starters fmt-clean (Terraform v1.13.3, hashicorp/aws v6.69.1) |
| Build 0 with real Terraform | plan → apply → plan with `-var environment=prod` (in-place update) |
| Bug-ticket errors | captured from real `terraform validate`/`plan` against the exact ticket files |
| `tests/data/test-tfs-content.js` | 612 checks: budgets, schedule, items, lessons (word counts, solutions pass, starters fail), labs (references pass, starters fail, levels differ, faults detected, renamed/reordered HCL accepted), tickets, quiz explanations, mock rubric = 100 with auto/manual split, variants differ, embedded files in sync, simulator state machine |
| `tests/ui/test-tfs.js` | 185 checks at 390 and 1100 px: navigation, no overflow, edits survive reload, assisted vs independent, reset keeps history, interview/mock hide help, pause → untimed, timer reconciles, score incomplete until assessed, keyboard |
| `npm test` | 31/31 suites (existing tracks unchanged) |

## Limitations

- **No AWS validation.** Nothing was planned or applied against AWS; validate
  is static and the simulator is a model.
- **Practice checks are not terraform validate.** They parse HCL and model
  relationships (routes, associations, security-group rules, public IPs),
  accept any names, order and file layout, but do not know provider schemas:
  a misspelled AWS argument can pass them. Values only known after apply
  show as manual review, never as passed.
- **The simulator** knows the schema only of `terraform_data`; replacement
  rules cover common arguments of the resources the course uses.
- **Self-assessment.** Oral answers, manual rubric items and follow-ups are
  scored by you; the app cannot see other windows.
- Hidden solutions are a learning affordance in a client-only app, not
  secured.

## Recommended first session (Oct 21–22, about 50 min)

Module 0 (orientation, 6-minute diagnostic), then Module 1: the three
foundation lessons and Build 0 in guided mode — run it in the simulated
terminal, then for real with Terraform on your Mac (`terraform init`, `plan`,
`apply`, `plan -var environment=prod`, `destroy`).
