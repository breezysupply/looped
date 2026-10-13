# L11 worked solution

## Read first

```sh
cd labs/sre-cloud-foundations/L11/work
terraform state list            # random_id.deploy, local_file.config, local_file.manifest
terraform state show local_file.config
ls -l out/dev && shasum -a 256 out/dev/beacon.yaml
terraform output                # config_sha256 should match the shasum
```

## Variant A — invalid input

`terraform plan` stops with two `Invalid value for variable` errors on `terraform.tfvars` lines 3
and 4: `environment = "Dev"` is not in the allowed list (validation is case-sensitive on
purpose: the value becomes a directory name) and `listen_port = 80` is privileged for an
unprivileged process. Nothing is refreshed or compared; Terraform never got that far. Fix the
inputs (`dev`, `8080`), not the rules. Plan: no changes, so nothing to apply.

## Variant B — changed variable

`environment = "staging"`. Prediction: `random_id.deploy` must be replaced (its `keepers` map
changes), `local_file.config` and `local_file.manifest` must be replaced (`filename` changes;
local_file has no in-place update) — `3 to add, 0 to change, 3 to destroy`. Applying it would
delete dev's files and issue a new deployment id. The ticket wants dev unchanged, so revert the
variable here. A staging config belongs in another working directory with its own state (see
VARIANT.md). Plan: no changes; `deploy_id` unchanged.

## Variant C — missing generated file

`terraform plan` shows `local_file.config will be created` and `1 to add`. `plan -refresh=false`
is clean: configuration and state agree; the refresh found the file gone, so the provider dropped
it from the refreshed state. The manifest does not change because the config content (and so
its checksum) is the same. `terraform apply` recreates exactly one file; `deploy_id` unchanged.
Copying an old file back by hand also clears the plan if the bytes are identical, but it hides
the question of who deleted it; say what you would change so it does not recur.

## The validation gap (all variants)

```hcl
variable "store_path" {
  description = "Database file for store_kind = sqlite. Ignored for memory."
  type        = string
  default     = ""

  validation {
    condition     = var.store_kind != "sqlite" || startswith(var.store_path, "/")
    error_message = "store_path must be an absolute path when store_kind is sqlite."
  }
}
```

and in `tests/beacon.tftest.hcl`:

```hcl
run "rejects_sqlite_without_path" {
  command = plan
  variables {
    store_kind = "sqlite"
    store_path = ""
  }
  expect_failures = [var.store_path]
}
```

Every test run uses `command = plan`, so `terraform test` never writes into `out/` (an apply-mode
test in this directory would create and then destroy the same filenames as the real workspace).

## Graph

`terraform graph > ../evidence/L11-graph.dot` shows `local_file.manifest -> local_file.config`
(the manifest embeds `sha256(local_file.config.content)`) and `local_file.manifest ->
random_id.deploy` (it embeds the id). Terraform creates config and random id in parallel, then
the manifest.
