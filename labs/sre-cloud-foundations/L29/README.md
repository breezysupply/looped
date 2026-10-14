# L29 — Beacon on Azure and Google Cloud: translate the design, not the vocabulary

Module M15 · ~90 min practical · profile `workstation` · **paper exercise: no Azure, Google Cloud
or AWS account, no cost, no deployment**

## Ticket

> Two prospective customers run on Azure and on Google Cloud. Product wants to know what the
> two-AZ Beacon design from D01/L09 would look like on each before anyone promises a date. A
> colleague started a translation worksheet (`work/translation.yaml`) and a list of
> "equivalences" before going on leave. Finish it: a diagram per provider, a row per design
> concept, an access/network responsibility matrix for managed Kubernetes, and a judgement on
> every equivalence claim with the difference that decides it and a source. The review is with
> people who have run these platforms; nothing you write may claim experience you do not have.

## Objectives

- `obj-m15-01` translate between providers honestly: a decision matrix that names
  non-equivalences in identity, networking and managed Kubernetes
- `obj-m15-04` state what the provider and the operator each own for a managed Kubernetes service

## What is fixture-controlled

- **The source design** is L09's inventory: `labs/sre-cloud-foundations/L09/assets/draft-inventory.json`
  (VPC, eight zonal subnets, two NAT gateways, ALB, ECS tasks, Multi-AZ RDS, S3 through a gateway
  endpoint, interface endpoints, task roles). Every worksheet row cites one of its ids
  (`aws_ref`), so the translation stays tied to a real design rather than a vocabulary list.
- **The colleague's draft.** `inject.sh` writes `work/translation.yaml` from
  `assets/draft-base.yaml` and plants wrong-equivalence assumptions chosen by
  `LOOPED_VARIANT=variant-a|variant-b|variant-c`, some as rows, some as prefilled judgements.
  Which ones is for you to find.
- **The curated claims** (`python3 assets/xlate.py --claims`): thirteen statements people make
  when moving between providers, such as "an IAM role is a service account" or "a VPC is regional
  everywhere". Some hold, some partly hold, most do not. You judge every one.

`assets/xlate.py` is the checker. It parses the worksheet (a documented YAML subset, standard
library only), checks structure, the L09 references, a few unambiguous scope facts, your
judgements, known wrong-equivalence phrasings and the honesty rules. The expected judgements are
stored as salted hashes so they are not read by accident; that is learning integrity, not
secrecy. The checker is a curated teaching aid: it cannot judge free text in general.

## Steps and checkpoint

**Checkpoint c1 — translate, judge, defend (week 44, session 2).**

1. `bash labs/sre-cloud-foundations/L29/setup.sh`. Read the L09 inventory and your own L09
   explanation, then the draft. Before running the checker, mark in your notes which of the
   colleague's rows you already doubt.
2. `python3 labs/sre-cloud-foundations/L29/assets/xlate.py labs/sre-cloud-foundations/L29/work/translation.yaml`.
   Quote the first findings in **Fault found**.
3. Fix the rows: `target`, `scope` (global, regional, zonal, tenant, subscription, project,
   account, resource), `difference` (what a migration would get wrong) and `aws_ref`.
4. Replace both diagram placeholders with Mermaid text (or any line-based diagram): load
   balancer, API, worker, database, the zone/region boundary, the private service path and the
   identities. A `flowchart LR` with labelled edges is enough.
5. Complete the responsibility matrix: `control-plane`, `node-os-patching`,
   `kubernetes-upgrades`, `workload-identity`, `network-policy`, `api-endpoint-access`,
   `zone-spread`, `secrets-encryption` — what EKS, AKS and GKE do, what the provider owns, what
   the operator owns.
6. Judge every claim: `verdict` (`holds`, `partly`, `does-not-hold`), a `difference` that names
   the deciding fact for each provider, and `sources` — ids from the course source register
   (`LX.sreSources`: T19 Azure Architecture Center, T20 Google Cloud Architecture Framework, T08,
   T18 …). Read the source before you cite it.
7. Write `limits`: what this paper translation does not prove.
8. Finish `evidence/L29-notes.md`, then
   `python3 labs/sre-cloud-foundations/L29/validate.py --explanation-file labs/sre-cloud-foundations/L29/evidence/L29-notes.md`
   and import `evidence/latest.json`.

## What you should observe

- The two-AZ subnet layout does not copy across: two providers make subnets regional, and one
  makes the whole network global. Zone placement moves from subnets to resources.
- "Role" means an identity in AWS and a permission set in Azure and Google Cloud. Where access is
  granted (identity policy, role assignment at a scope, allow policy on a resource) is the
  difference that breaks naive migrations.
- "Managed Kubernetes" does not mean the same split of work in all three; node patching and
  upgrade timing depend on the mode you choose.

## Validation and rubric

`validate.py` runs the checker and reports per area: rows, scopes, diagrams, matrix, claims,
phrasing, honesty (critical) and notes (advisory). It cannot judge whether your diagrams are
good or your differences complete. Rubric (self or mentor, each 0–2):

- Identity: says where identities live, where access is granted and how inheritance works in
  each provider, and the day-one failure a wrong assumption causes.
- Network: the subnet, NAT, private-access and load-balancer translation is correct and states
  cost and failure-domain consequences.
- Managed Kubernetes: the matrix separates provider and operator duties and says what differs
  from local kind.
- Honesty: every claim is sourced, uncertainties are marked "check current docs", nothing claims
  hands-on proficiency.

## Pause / resume, reset, teardown

All state is `work/translation.yaml` and `evidence/`. `setup.sh` never overwrites your
worksheet; `reset.sh` restores the colleague's draft for the same variant (yours is saved as
`work/translation.yaml.bak`); `teardown.sh` removes `work/` only.

## Lab versus production

- A real translation would be checked against the provider's current documentation, region
  capabilities and prices on the day, and then in a sandbox (cloud extension C05, disabled by
  default). Provider features change; the claims here were curated for this course and may age.
- Real organisations add landing-zone constraints (management groups, folders, policies, shared
  VPCs or hub-and-spoke VNets) that this worksheet only mentions.

## Limits — what this lab does not prove

It proves you can map a concrete AWS design onto Azure and Google Cloud concepts while naming
the differences in identity scope, IAM, networking, managed-cluster responsibility and
availability, and back each judgement with a source. It does **not** prove live proficiency with
Azure or Google Cloud, that the translated design works, or anything about prices, quotas or
current regional support. No provider API is called. Cross-cloud claims stay conceptual unless
the optional sandbox extension was completed.

## References

- T19 Azure Architecture Center · T20 Google Cloud Architecture Framework · T08 AWS
  Well-Architected Reliability Pillar · T18 AWS IAM policy evaluation logic
