# L29 worked solution

One strong answer, not the only one. The checker accepts any wording that states the deciding
fact; the rubric in README.md judges the rest.

## Answer key for the curated claims

| Claim | Verdict | The deciding difference |
|---|---|---|
| TR-01 role = managed identity = service account | partly | All give a workload short-lived credentials. An AWS role is assumed through STS under a trust policy and carries identity policies; an Azure managed identity is an Entra service principal that receives RBAC role assignments at a scope; a Google service account is a principal bound to roles in allow policies on resources. In Azure and GCP "role" is a permission set. |
| TR-02 account = subscription = project | does-not-hold | Azure identities live in the Entra tenant above subscriptions, RBAC inherits from management groups; GCP IAM inherits from organisation and folders and service accounts can be granted roles in other projects. |
| TR-03 networks regional everywhere | does-not-hold | A Google Cloud VPC network is global; only its subnets are regional. |
| TR-04 subnets zonal everywhere | does-not-hold | Azure and GCP subnets are regional and span zones; zone placement moves to each resource. |
| TR-05 SG = NSG = firewall rule | partly | All stateful L3/L4 filters, but SGs are allow-only on interfaces; NSGs and GCP firewall rules have deny rules and priorities, and attach differently (subnet/NIC, network-wide targets). |
| TR-06 gateway endpoint = private endpoint = PGA | does-not-hold | Route-table target with a prefix list, versus a NIC with a private IP and a private DNS zone, versus a subnet setting for Google APIs. |
| TR-07 NAT per zone everywhere | does-not-hold | Cloud NAT is a regional configuration on a Cloud Router; Azure NAT Gateway zone behaviour depends on the SKU. |
| TR-08 same managed-cluster split | does-not-hold | All run the control plane; node patching depends on mode (EKS node groups, AKS upgrade channels, GKE Standard auto-upgrade vs Autopilot); operators always own workloads, RBAC, NetworkPolicy and upgrade timing. |
| TR-09 ≥2 zones everywhere, names global | does-not-hold | Not every Azure region has zones; zone counts vary; AWS AZ names map per account — compare AZ IDs. |
| TR-10 load balancer regional everywhere | does-not-hold | GCP's global external Application Load Balancer is global (one anycast IP); Front Door is global too. |
| TR-11 zone-redundant managed PostgreSQL in all three | holds | True, but failover time, region support and standby readability differ, and HA does not replace backups or point-in-time restore. |
| TR-12 short-lived credentials without stored keys | holds | Task roles, managed identities and attached service accounts get tokens from metadata/federation endpoints; a downloaded key file would be a regression. |
| TR-13 key access authorised by a policy on the key | does-not-hold | Only AWS KMS has a key policy that must allow access; Key Vault uses RBAC or access policies; Cloud KMS uses IAM allow policies on the key ring or key. |

Sources: T19 for Azure statements, T20 for Google Cloud, T18 for AWS IAM, T08 for zones and
recovery. Cite at least one the claim can actually be checked against.

## What each variant planted

- **A (identity):** rows saying a managed identity is "the same as the ECS task role" and a
  subscription/project "equivalent to an AWS account"; GCP resource scope written as `account`;
  TR-01, TR-02, TR-13 prefilled `holds`, TR-12 `does-not-hold`. Fix: scope `project`, rewrite the
  three differences around tenant/organisation, role assignments and allow policies.
- **B (network):** GCP network scope `regional`, Azure and GCP subnets `zonal`, Cloud NAT
  `zonal`, "a private endpoint is the same as the S3 gateway endpoint", "a NAT gateway is a
  per-zone appliance in all three"; TR-03–TR-07 prefilled `holds`. Fix: `global`, `regional`,
  `regional`, `regional`, and differences that name route tables versus NICs/DNS and Cloud Router.
- **C (clusters and availability):** the node-os-patching matrix row says the provider patches
  nodes in all three and the operator only deploys workloads; GCP load balancer "regional in all
  three"; "every region has at least two availability zones"; Azure "has no zone-redundant
  PostgreSQL"; TR-08–TR-10 `holds`, TR-11 `does-not-hold`. Fix the row per mode, the LB to
  `global`, the zone statement and the PostgreSQL row.

## Diagrams (Azure, abbreviated)

```
flowchart LR
  sensors[Sensors] --> agw[Application Gateway v2, zone-redundant]
  subgraph region[Azure region: zones 1 and 2, VNet vnet-beacon-lab]
    agw --> api[Container Apps beacon-api]
    api --> pg[(PostgreSQL flexible server, zone-redundant HA, private access)]
    worker[Container Apps beacon-worker] --> pg
    worker --> nat[NAT Gateway] --> hooks[partner webhooks]
    api -.-> pe[Private endpoints: Key Vault, Registry, Storage]
  end
  api -. managed identity, RBAC role assignment .-> kv[Key Vault]
  tenant[Entra tenant: identities] --- sub[Subscription / resource group]
```

The GCP diagram has the global VPC network around one region, Cloud Run services spread across
zones, Cloud SQL HA on a private IP, Cloud NAT on a Cloud Router, Private Google Access to Cloud
Storage and Secret Manager, service accounts on each service, and the organisation/folder above
the project.

## Matrix rows the draft did not have

- **network-policy:** EKS needs VPC CNI network policy enabled or another engine; AKS chooses
  Azure, Calico or Cilium at configuration; GKE enables enforcement or uses Dataplane V2. The
  operator writes default-deny plus allow rules and proves them with a negative test (as in L18).
- **api-endpoint-access:** public with allow-lists or private in all three; the operator decides
  exposure and how CI reaches a private endpoint.
- **zone-spread:** node groups/pools/regional clusters across zones are requested by the
  operator; pods still need topology spread constraints and PodDisruptionBudgets.
- **secrets-encryption:** encryption at rest is the provider's; customer-managed keys for
  Secrets, their rotation and RBAC on Secrets are the operator's.

## Limits statement

"Paper translation of the L09 design for discussion. Nothing was deployed to Azure or Google
Cloud; prices, SKUs and zone support were not checked live, and the author has no hands-on
experience operating these providers. A sandbox exercise (C05) would be needed before relying on
it."
