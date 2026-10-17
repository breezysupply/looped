# Terraform labs: Anduril Round 1

Reference, alternative and broken configurations for the Terraform labs in
the "Anduril Round 1: Networking + AWS Terraform" path, plus the mock
interviews' Terraform tasks. The app embeds these exact files
(`node tools/ar1-tf-src.js` regenerates `assets/js/data/ar1-tf-src.js`; a data
test fails if the two drift apart).

| Folder | What it is |
|---|---|
| `T1-public-network/reference`, `alternative` | Guided build: VPC, public subnet, IGW, route table + association, restrictive security group. The alternative uses inline routes and inline rules with different names — equally valid. |
| `T2-blank-editor/variant-a/reference`, `alternative` | Blank-editor build, variant A (app on 8080, SSH from an admin CIDR). The alternative uses the SSM AMI parameter and an Elastic IP. |
| `T2-blank-editor/variant-b/reference` | Variant B: HTTPS from a partner range only, no SSH, IMDSv2. |
| `T2-blank-editor/variant-c/reference` | Variant C (transfer): metrics port allowed from a security-group reference. |
| `T3-repair/broken`, `reference` | Repair-and-explain: three defects (missing association, HTTPS limited to the VPC CIDR, security group without `vpc_id`). **The broken version passes `terraform validate`** — that is the lesson. |
| `T4-private-nat/reference` | T1 plus a private subnet, NAT gateway with an Elastic IP, private route table and a private app instance. |
| `MA-status-page/reference`, `MB-two-tier/reference` | One valid answer for the Terraform phase of mock A and mock B. |

Every configuration pins `hashicorp/aws` with `~> 6.60` and takes credentials
from the normal chain — never from the files.

## Checking them for real

```sh
cd labs/anduril-round1/terraform
./validate-all.sh
```

This runs `terraform fmt -check`, `terraform init -backend=false` and
`terraform validate` in every folder. It needs the Terraform CLI and network
access to the Terraform Registry the first time; it needs **no AWS account
and no credentials**, and it never runs `plan` or `apply`.

Last run (2026-10-16): every folder passed with Terraform v1.13.3 and
hashicorp/aws 6.69.1 (what `~> 6.60` resolved to that day).

What `validate` proves: the configuration is well-formed against the provider
schema. What it does not prove: that AWS accepts the values (AMI lookups,
quotas, name conflicts), or that any traffic flows. `terraform plan` needs
credentials because it reads your account. Deploying is optional, deliberate
and billed — use a sandbox account with a least-privilege role, check
current pricing for EC2, Elastic IPs and NAT gateways in your Region, and
`terraform destroy` afterwards.

## Writing your own

Each lab's starter is in the app (the editor saves drafts in your browser).
To check your own answer with the real CLI, copy your files into an empty
folder and run the three commands above there.
