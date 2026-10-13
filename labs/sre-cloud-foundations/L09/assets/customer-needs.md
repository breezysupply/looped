# Beacon on AWS — customer needs (L09 fixture)

Fictional customer, fictional account `111122223333`, region `us-west-2`, two Availability Zones
`us-west-2a` and `us-west-2b`. Nothing here describes a real organisation or a real deployment.

## What Beacon must do

1. **Field sensors post status records over HTTPS** to one public hostname
   (`beacon.corp.lab`). Only the load balancer is reachable from the internet. No workload has a
   public IP address.
2. **The API** (`api`, containers on ECS Fargate) validates and stores records in PostgreSQL. It
   pulls its image from ECR in the same account, writes logs to CloudWatch Logs, reads the
   database password from Secrets Manager and needs KMS to decrypt it.
   - **The API tier has no route to the internet at all** (security requirement C-1). Every AWS
     service it needs is reached privately.
3. **The worker** (`worker`) reads queued jobs from the database, writes processed archives to
   the S3 bucket `beacon-archive-lab` and posts a webhook to the partner system at
   `hooks.partner.lab` (an internet API the customer does not control). It pulls the same image,
   logs to CloudWatch Logs and uses KMS for the archive objects.
   - Worker egress to the internet is allowed **only through NAT** and **never across AZs**
     (requirement C-2: a zone's workloads must not depend on another zone's NAT).
4. **The database** is managed PostgreSQL (RDS for PostgreSQL 16) in the data tier, encrypted
   with the customer-managed key `alias/beacon-data`.

## Reliability and recovery targets

- **Losing one AZ** must not stop the user path (sensor → load balancer → API → database) or the
  worker, without a human doing anything (requirement R-1).
- **RPO ≤ 15 minutes, RTO ≤ 60 minutes** for the database (R-2).
- The customer accepts that a **regional** event is out of scope for this phase, but wants it
  written down with what would be needed (R-3).
- The partner webhook is outside the customer's control. The customer wants to know what happens
  when it is down (R-4).

## Cost

- **Fixed network cost** (NAT gateways, interface endpoints, load balancer hours — the part that
  does not scale with traffic) must stay at or below **USD 200/month** (B-1).
- Use `prices.json` for the model; it is a fixture, not a quote. State what you excluded.

## Identity

- One task role per service (`role-api-task`, `role-worker-task`) and one task execution role
  (image pull and logs). Trust: `ecs-tasks.amazonaws.com`.
- No wildcard actions; `Resource: "*"` only where the API requires it
  (`ecr:GetAuthorizationToken`).

## What you hand back

`work/inventory.json` (machine-readable, schema `looped.archinv/v1`) that passes `archcheck.py`
for every scenario, with `failure_analysis`, `cost` and `recovery` filled in, and
`evidence/L09-explanation.md` (request path, identity path, failure domains, the fault you found).
