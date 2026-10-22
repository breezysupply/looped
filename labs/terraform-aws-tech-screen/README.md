# Terraform + AWS tech screen — lab package

Starter, reference and alternative Terraform for the course
**Terraform + AWS: From Guided Builds to Live Tech Screen** (course id
`terraform-aws-tech-screen`). The app embeds these exact files
(`node tools/tfs-src.js`; a data test fails if they drift apart).

| Folder | Contents |
|---|---|
| `b0-local-manifest/` | Build 0: `terraform_data` only — runs end to end with real Terraform, no AWS. `guided/`, `scaffolded/`, `reference/` |
| `b1-private-s3/` | Build 1: private bucket with public access block, versioning, encryption. `guided/`, `scaffolded/`, `reference/`, `alternative/` |
| `b2-public-web/` | Build 2: VPC, public subnet, IGW, routes, security group, EC2 web server. `guided/`, `scaffolded/`, `reference/`, `alternative/`, `rebuild-reference/` (different Region, CIDRs, names) |
| `b3-private-nat/` | Build 3: private worker behind a NAT gateway. `guided/`, `scaffolded/` (starts from Build 2's network), `reference/` |
| `b4-independent/` | Build 4 (requirements only): `reference/` and `change-reference/` (the optional second private subnet) |
| `b5-iteration/` | Module 5 exercises: `foreach-start/` → `foreach-reference/`, `param-start/` → `param-reference/` |
| `stretch-alb/` | Optional two-AZ ALB stretch: `reference/` |
| `mock-a/`, `mock-b/` | One reference per seeded mock variant |

Starters (`guided/`, `scaffolded/`, `*-start/`) are incomplete on purpose.

## Checking with real Terraform

```sh
cd labs/terraform-aws-tech-screen
./validate-all.sh
```

Runs `terraform fmt -check`, `terraform init -backend=false` and
`terraform validate` on every reference and alternative (starters get
`fmt -check` only). Needs the Terraform CLI and registry access the first
time; needs **no AWS credentials**; never plans or applies.

Last run, 2026-10-21: all 16 references and alternatives passed and all 10
starters were fmt-clean, with Terraform v1.13.3 and hashicorp/aws v6.69.1
(what `~> 6.60` resolved to). Both Module 5 starting configurations also pass
`validate` — they are valid but behave wrongly, which is the lesson.

Build 0 was additionally planned and applied with real Terraform: changing
`environment` produced an in-place update (`Plan: 0 to add, 1 to change,
0 to destroy`), and no `.terraform.lock.hcl` was written because
`terraform_data` is built in.

`validate` is static. It does not show that AWS accepts the values or that
anything is reachable; a real `plan` needs credentials. Nothing in this
package was planned or applied against AWS.

## Optional deployment

Only in a sandbox account you control, from a separate copy of a folder with
its own state. Configure credentials in your shell, never in files. Review
the plan, apply by hand, verify, destroy, and confirm nothing is left (the
course lists the commands per build). NAT gateways, Elastic IPs/public IPv4,
EC2 and load balancers are billed — check current pricing; no cost figure
or free-tier eligibility is promised. For the versioned bucket in Build 1,
empty it deliberately before `terraform destroy`; do not add `force_destroy`.
