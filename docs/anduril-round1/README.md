# Anduril Round 1: Networking + AWS Terraform

A focused prep path inside LOOPED for one 60-minute technical round. It is a
new track with its own **Prep** hub; nothing in the other tracks changed
behaviour, and no existing progress is touched (the path keeps its state in
its own `localStorage` key, `lx.anduril`).

All scenarios, labs, mocks and questions are **invented practice** built from
what the recruiter described. None of them is a real Anduril question.

## Opening it

- On the published site: track pill → **Anduril Round 1: Networking + AWS
  Terraform**. Learn opens on **Prep**.
- Locally: `npm run serve`, then open <http://127.0.0.1:8099/index.html>.
- Local labs (optional, free): `labs/anduril-round1/` — Terraform
  configurations with `validate-all.sh`, and Bash exercises with
  `run-tests.sh`. Neither needs an AWS account.

## What it contains

| Part | Contents |
|---|---|
| Core sprint | 7 sessions, **360 min** of required work (45/60/60/60/30/60/45) |
| Triage route | **180 min** (30/30/45/15/60), labelled *reduced coverage — not equivalent readiness*, with the skipped topics listed |
| Lessons | Module A network fundamentals (7), B AWS networking (4), C Terraform (5), D Bash (2), plus an optional glossary of the wider stack. Each: plain and precise explanations, example (diagram where useful), misconception, unassisted recall, application task, 30–60 s "explain it aloud", self-check, sources |
| Retrieval | 43 items (16 for module A: explanation, route-table interpretation, troubleshooting, ordering, numeric — not all multiple choice), a 12-question diagnostic with "I don't know yet", delayed-recall sets in sessions 2, 3, 4 and 7, a spaced "review this tomorrow" queue |
| Traffic path | X1 (private EC2 → external HTTPS via NAT, including the return path and evidence that separates DNS / route / filter / TLS / HTTP) and X2 (transfer: laptop → public instance), with a rendered packet-path diagram and a text version |
| VPC investigations | N1–N4 interactive in the Sandbox on a simulated VPC (SSH timeout from a stale source range; private HTTPS with a lost association or an IGW default route; NACL return traffic incl. rule ordering; DNS delegation and negative caching). N5 (TCP fine, TLS/HTTP fails — "open the firewall" is not the answer) and N6 (gateway endpoint vs NAT design, several defensible answers) as evidence cards. Two variants each |
| Terraform | T1 guided build with fading guidance; T2 blank editor with three variants and an interview mode; T3 repair-and-explain with three independently graded defects; T4 private subnet + NAT (optional). Four hint rungs, reference + alternative solutions, common mistakes, explanation rubric, local verification commands |
| Bash | B1 (ERROR counts per service), B2 (non-running instances with jq), B3 (bounded endpoint checks) — run on your Mac against local fixtures |
| Mocks | Mock A (core, 60 min: 5 clarify / 35 Terraform / 15 networking follow-ups / 5 explanation), Mock B (mixed, 60 min), a 45-minute scripting-only replacement. Mock mode hides hints, answers, solutions and structural feedback; timer and drafts survive reloads; restart is a new recorded attempt; rubric 35/35/15/10/5 (mixed: Terraform 25, Bash 10) |

## How progress is counted

- Opening a lesson never completes it; a recall attempt does. Viewing a
  solution never counts as independent.
- Hints are recorded per rung (conceptual, evidence, partial structure, full
  solution). Rungs 3–4 make an attempt *assisted*; "Try a new variant"
  offers an unassisted retake.
- Progress is shown separately for networking, Terraform and Bash, each with
  its next recommended task.
- Mock bands: *needs guided practice*, *can solve with references*,
  *independent on this exercise*. No pass probability anywhere. The training
  target — two independent passes on unfamiliar exercises, correct
  traffic-path reasoning, explaining key decisions without a solution — is
  a study goal, not Anduril's bar.

## Checks run (2026-10-16)

| Check | Result |
|---|---|
| `node tools/build.js --check` | current |
| `npm test` (all data and browser suites) | 29/29 suites pass |
| `tests/data/test-ar1-content.js` | 656 checks: budgets 360/180, ids resolve, required counts, sources dated, no placeholder text, VPC model rules (longest prefix, main-table fallback, NACL order + implicit deny, ephemeral return, NAT return path, evidence changes when the topology changes) |
| `tests/data/test-ar1-tf.js` | 157 checks: references and alternatives pass; broken copies fail on the check that names the defect; T3 defects graded independently; embedded files match the lab package |
| `tests/data/test-sre-scenarios.js` | every N1–N4 variant: reveal ladder, an alternative path, verify-first proves nothing, typed text proves nothing, unsafe shortcuts trip, deterministic reset |
| `tests/ui/test-ar1.js` | 233 checks at 390 px and 834 px: no overflow, named buttons, unique ids; drafts and timers survive reloads; interview and mock modes hide help; a scenario played in the Sandbox records back to the hub; routes keep progress; keyboard navigation |
| `labs/anduril-round1/terraform/validate-all.sh` | 11/11 configurations pass real `terraform fmt -check`, `init -backend=false`, `validate` (Terraform v1.13.3, hashicorp/aws 6.69.1) |
| `labs/anduril-round1/bash/run-tests.sh solution` | 60/60 on Bash 5.2.21 and on a Linux build of Bash 3.2.57; starters 0/60 (as intended); shellcheck clean |

## Limitations (stated plainly)

- **Simulation is not AWS.** The VPC model follows the documented rules but
  is one VPC, IPv4, no load balancers, peering or transit gateways, and no
  timing, MTU or loss. CLI output is generated; no API call or packet
  capture happens.
- **Structural checks are not `terraform validate`.** The in-app grader parses
  HCL and checks relationships and values; it does not know every argument
  and cannot say whether AWS accepts a value. The real CLI checks are in the
  lab package and were run against the configurations above — not against
  your drafts unless you run them.
- **No real cloud validation was performed.** Nothing was planned or applied
  against an AWS account.
- **Bash on macOS** was not run here: the tests passed on Linux with GNU/mawk
  tools and a Linux-built Bash 3.2.57. The solutions avoid GNU-only flags,
  but run `BASH_BIN=/bin/bash ./run-tests.sh solution` once on your Mac.
- **Self-assessment.** Explanations, mock ratings and "independent"
  attestations are yours; the app cannot see other windows or judge prose.
- **Hidden answers are a learning affordance, not security.** This is a
  client-only app; anyone can read the source.
- Sources were fetched on 2026-10-16. Terraform Registry pages are
  single-page apps; argument names were confirmed in the provider schema.

## Recommended first session (45 min)

Session 1 on the Prep → Today card: the 8-minute diagnostic (skip freely),
lessons A1, A2, A4, A5, A6, then exercise X1 — trace one HTTPS request from
a private instance and back, and say it aloud in 60 seconds at the end.
