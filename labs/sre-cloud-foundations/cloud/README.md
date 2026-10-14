# Optional cloud extensions (C01–C05)

**Disabled by default.** Nothing in this directory runs as part of the course, the
build, or the tests. Each extension is opt-in from the LOOPED hub (Branches → cloud
extension → name a sandbox account, a spending limit and an expiry, tick the
checklist). Opting in only shows the commands; you run them yourself, in an account
you own and are allowed to spend money in.

- Use a **sandbox** account/subscription/project, never production.
- Budget alerts are **notifications, not caps**. Set one anyway, and set the expiry
  date in your calendar.
- Stopping a VM does not delete its disks, public IPs, load balancers, logs or
  snapshots. Each extension's cleanup inventory is the pass condition.
- No NAT gateways and no managed Kubernetes in C01/C02/C04/C05. C03 is the only
  extension that creates a managed cluster, and only one.
- Terraform state for these stacks is **local** to the stack directory, except C02,
  whose whole point is an S3 backend with `use_lockfile = true` (Terraform's S3
  backend lockfile; DynamoDB-based locking is deprecated in the Terraform
  documentation and is not used here).

| Ext | Files here | Authoring-time verification |
|---|---|---|
| C01 | `C01/*.tf` | `terraform fmt -check` and `terraform validate` with `init -backend=false`; never applied |
| C02 | `C02/bootstrap/*.tf`, `C02/stack/*.tf` | same; never applied |
| C03 | none (provider quick start + course chart) | not executed |
| C04 | none (uses L24's verification script) | not executed |
| C05 | none (provider quick start) | not executed |

No cloud account was available while authoring, so none of these have been run
against a real provider. Treat them as reviewed specifications, and read every
resource before you apply anything.
