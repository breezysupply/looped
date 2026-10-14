# Design defence (L32) — AUTHORING SAMPLE

## Decision 1

Run the API stateless across two zones and keep state in one managed PostgreSQL with a standby.
Rejected alternative: self-managed PostgreSQL on VMs, more control but more toil for one team.
Evidence: labs/sre-cloud-foundations/L09/README.md and the L09 failure analysis.

## Decision 2

Promote one immutable image by ID/digest instead of rebuilding per environment.
Rejected alternative: rebuilding from the same tag per environment, which cannot prove identity.
Evidence: labs/sre-cloud-foundations/L31/rebuild.sh records the image ID.

## Decision 3

Default-deny NetworkPolicy with explicit API-to-database and DNS rules.
Rejected alternative: namespace isolation only, which allows any pod to reach the database.
Evidence: labs/sre-cloud-foundations/L18/manifests/30-netpol.yaml.

## Decision 4

Backups restored and verified into a separate database on a schedule.
Rejected alternative: trusting replication alone, which copies corruption and deletes.
Evidence: labs/sre-cloud-foundations/L24/assets/verify_restore.py output.

## Decision 5

Page on multi-window error-budget burn rather than on raw error counts.
Rejected alternative: static error thresholds, which page on short spikes and miss slow burns.
Evidence: labs/sre-cloud-foundations/L22/README.md and the promtool tests.

## Three-minute update

Impact: since 14:02 UTC about forty percent of status submissions failed and three sensors showed
no history. Scope: the Beacon API in the local capstone namespace only; no other service affected.
Current action: the release was rolled back at 14:12 and errors stopped; missing history was
restored selectively from the pre-incident backup without losing the twelve records written after
it, verified by count and checksum at 14:20. Next update: 15:00 UTC, or sooner if anything
changes, with the follow-up owners and the timeline.

## Ten-minute defence outline

- Requirements and what two zones do and do not solve
- Identity and least privilege (deploy bot matrix)
- Delivery: immutable image, rollback and what it cannot undo
- Observability: SLI, burn-rate alerts, tested rules
- Recovery: selective restore decision and measured interval
- Gaps and next steps

## Terraform replacement plan

report/terraform-plan.txt shows docker_container.api must be replaced because ports.external (18412 -> 18413) forces
replacement; the data volume is not replaced. I applied only after confirming the volume
attachment stays and the seed record survives, as in L12.

## Gaps

No live cloud work: Azure/GCP translation is conceptual (L29). No real on-call. Kubernetes
NetworkPolicy enforcement proven only on the local policy cluster. Next: managed Kubernetes
sandbox (C03), cloud recovery drill (C04).
