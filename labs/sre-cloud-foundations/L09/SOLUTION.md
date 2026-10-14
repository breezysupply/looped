# L09 worked solution

## Investigation (any variant)

```sh
python3 assets/archcheck.py work/inventory.json            # baseline + az-down:us-west-2a + az-down:us-west-2b
python3 assets/archcheck.py work/inventory.json --explain api --scenario az-down:us-west-2a
python3 assets/archcheck.py work/inventory.json --spof --cost assets/prices.json
```

The checker output is the observation. Write it down before touching the file.

### Variant A — a zone is lost and the other zone stops too

Observation: baseline is fine, `az-down:us-west-2a` reports `DOWN api` with *no path to ecr.api:
no usable endpoint for rt-api-b/api-b … no 0.0.0.0/0 route* and `DOWN worker` with
*worker-b -> nat-a in us-west-2a, which is unavailable*. `--spof` lists `nat-a` and every
interface endpoint. Hypotheses: (1) the B zone depends on resources that only exist in A;
(2) the API subnets in B lack an endpoint association. The endpoint list shows every interface
endpoint has ENIs only in `api-a`, and `rt-worker-b` targets `nat-a`.

Fix: add `{"id": "nat-b", "type": "nat", "subnet": "pub-b"}`, point `rt-worker-b` at `nat-b`,
and give every interface endpoint `"subnets": ["api-a", "api-b"]`. Do **not** add a default route
to the API route tables (C-1) and do not point B at A's NAT (C-2). Cost: 2 NAT × 0.045 × 730 =
65.70; 5 endpoints × 2 AZs × 0.01 × 730 = 73.00; LB 16.43 → about **155 USD/month** (was about
85), within the 200 budget. That is the price of R-1.

### Variant B — a required outbound path is missing

Observation: even the baseline reports `DOWN api` with *no path to s3*. The API has interface
endpoints for ECR, but `ecr` needs `ecr.api`, `ecr.dkr` **and S3**, because image layers are
served from S3. The S3 gateway endpoint is associated only with the worker route tables. Fix:
add `rt-api-a` and `rt-api-b` to `vpce-s3.route_tables` (free; gateway endpoints have no hourly
charge). Adding a NAT route would also make the checker green but breaks C-1 — the validator's
`constraints` check fails that shortcut.

### Variant C — a dependency without redundancy

Observation: baseline fine; `az-down:us-west-2a` takes **everything** down, and the reason chain
ends at `db: single-AZ instance lives in us-west-2a`. `--spof` lists `db`. Fix:
`"multi_az": true` (RDS keeps a synchronous standby in the other zone and promotes it,
typically in one to two minutes). Cost rises (a second instance) but that is compute, outside the
fixed network model; say so in `assumptions`.

## Analysis fields (all variants, after the fix)

- `failure_analysis.single_points_of_failure`: `region` (accepted under R-3; describe the
  regional plan) and `partner-hooks` (mitigation: the worker retries with bounded backoff and
  keeps undelivered webhooks queued in PostgreSQL; alert on queue age). `az_loss`: which tasks
  die, that ECS replaces them in the surviving zone, that the endpoints still have ENIs there and
  that RDS promotes the standby.
- `cost`: `network_fixed_monthly_usd` ≈ 155, `monthly_estimate_usd` larger (add Fargate, RDS
  Multi-AZ, S3, data processing), drivers naming the NAT gateways, the endpoint-AZ hours and the
  load balancer, assumptions listing what is excluded.
- `recovery`: RPO 5 (automated backups with PITR ship transaction logs about every five
  minutes), RTO 30–60 (restore to a new instance, verify counts and checksums, repoint the
  secret, roll tasks), `region_loss` naming cross-region snapshot copy, ECR replication and IaC.

## Why this is the minimal correct change

Each variant has one structural defect. The fix restores the property the customer asked for
(R-1 or the start-up path) without adding exposure (C-1), cross-zone coupling (C-2) or cost that
buys nothing. The remaining SPOFs are not defects of the inventory; they are the honest answer to
"what do two AZs not solve".
