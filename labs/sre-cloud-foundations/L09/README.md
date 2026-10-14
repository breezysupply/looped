# L09 — Beacon on AWS across two AZs: inventory, request path and failure domains

Module M05 · ~90 min practical · profile `workstation` · **fixtures only: no AWS account, no cost**

## Ticket

> A colleague drafted the AWS layout for Beacon before going on leave: a VPC across
> `us-west-2a` and `us-west-2b`, a load balancer, API and worker tasks, managed PostgreSQL, VPC
> endpoints and NAT. The customer's needs are in `assets/customer-needs.md`. The review is on
> Friday. Make the inventory machine-readable and correct, prove what happens when one AZ is
> unavailable, and write down the single points of failure, the cost and the recovery plan you
> are prepared to defend.

## Objectives

- `obj-m05-01` trace the request and identity path (network hops, endpoints, roles, KMS)
- `obj-m05-03` lay out subnets, routes, endpoints and egress so private workloads reach what
  they need without public exposure
- `obj-m05-05` produce a machine-readable inventory, name single points of failure and state a
  recovery target

## What is fixture-controlled

Everything. `work/inventory.json` is written by `inject.sh` from `assets/draft-inventory.json`
with **one** change chosen by the variant seed (`LOOPED_VARIANT=variant-a|variant-b|variant-c`).
The three variants are: a zone becomes unavailable and something stops, a required outbound path
is missing, or a dependency has no redundancy. Which one you have is for you to find; the
validator never prints it.

`assets/archcheck.py` is a **teaching model** of reachability and failure domains, not AWS. It
knows route tables, NAT and internet gateways, gateway and interface endpoints (private DNS on
or off), the fact that ECR image layers come from S3, Multi-AZ databases and simple IAM hygiene.
It does **not** model security groups, NACLs, endpoint policies, DNS details, quotas, failover
timing, partial zone impairment or per-GB charges. Read its docstring.

## Steps and checkpoints

**Checkpoint c1 — network paths and the fault (week 13, session 2).**

1. `bash labs/sre-cloud-foundations/L09/setup.sh` (creates `work/` and
   `evidence/L09-explanation.md` from the template; idempotent).
2. Read `assets/customer-needs.md`. Before running anything, sketch the request path for one
   sensor POST and the API task's start-up calls (image, layers, logs, secret, KMS) on paper.
3. `python3 labs/sre-cloud-foundations/L09/assets/archcheck.py labs/sre-cloud-foundations/L09/work/inventory.json`
   runs the baseline and one scenario per unavailable AZ. If anything is DOWN, use
   `--scenario az-down:us-west-2a` and `--explain api` (or `worker`, `db`) to see every path.
4. Write the observation (quote the checker line) and two hypotheses in the *Fault found*
   section **before** you edit. Then make the smallest inventory change that satisfies the
   customer constraints C-1 (API tier has no internet route) and C-2 (no cross-AZ NAT).

**Checkpoint c2 — failure analysis, cost, recovery (week 13, session 3).**

5. `--spof` lists what the model computes as single points of failure. Every one must appear in
   `failure_analysis.single_points_of_failure` with a `mitigation` or an `accepted_because`.
   Fill `failure_analysis.az_loss`.
6. `--cost labs/sre-cloud-foundations/L09/assets/prices.json` prints the fixed network cost
   model. Put your own figure in `cost.network_fixed_monthly_usd` (it must be within 15% of the
   model and the model must be within the B-1 budget), a whole-service
   `monthly_estimate_usd`, the `drivers` and the `assumptions` (what is excluded).
7. Fill `recovery`: RPO and RTO in minutes against R-2, how backups are taken, how a restore is
   done and verified, and what a regional event would need (R-3).
8. Finish `evidence/L09-explanation.md`: Request path, Identity, Failure domains, Fault found.
9. `python3 labs/sre-cloud-foundations/L09/validate.py --explanation-file labs/sre-cloud-foundations/L09/evidence/L09-explanation.md`
   and import `evidence/latest.json` (Labs → L09 → Evidence).

## What you should observe

- Depending on the variant: a component that serves at baseline but goes DOWN when one AZ is
  unavailable, or a component that never serves because one service it needs has no path, with
  the checker naming the route table or endpoint it looked at.
- After the fix: every scenario says `all components serving`, findings `none`, and `--spof`
  still lists at least two entries. That is expected: two AZs do not remove every single point
  of failure, they move them.

## Validation and rubric

`validate.py` runs your inventory through the same checker and the customer constraints, checks
the computed SPOFs are all stated, compares your cost figure with the model, checks the recovery
targets and that the explanation has substance. It cannot judge whether your explanation is
*right*; use this rubric (self or mentor):

- Request path names every hop and the route/endpoint that enables it, including S3 for layers.
- Identity distinguishes the task role from the task execution role and places KMS correctly.
- Failure domains say what dies, what fails over, how long, and what two AZs do not cover.
- The fault narrative quotes the evidence, holds two hypotheses, and justifies the minimal change
  with its cost consequence.

## Pause / resume

All state is `work/inventory.json` and `evidence/`. `setup.sh` never overwrites your inventory;
`reset.sh` puts the draft back (your file is saved as `work/inventory.json.bak`).

## Lab versus production

- A real review would read VPC Reachability Analyzer output, security groups and the actual
  route tables; here a model of the same reasoning runs on a file. The habit transfers: write the
  path down, then prove each hop.
- Real AZ failures are often partial (one service impaired, elevated errors) rather than a clean
  "zone gone". The model only does the clean case.
- Prices change; the cost figure here is a model input, not a quote.

## Limits — what this lab does not prove

It proves you can reason about routes, endpoints, failure domains, cost drivers and recovery
targets on a written inventory. It does **not** prove you can operate an AWS account, that the
design works in AWS, or anything about security groups, DNS, quotas or failover timing. No AWS
API is called. Optional real-account work belongs to a separate, disabled-by-default cloud
extension.

## References

- T08 AWS Well-Architected Reliability Pillar · T18 IAM policy evaluation logic (for Identity)
