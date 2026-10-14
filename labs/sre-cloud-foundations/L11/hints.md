# L11 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Terraform compares three things: what the configuration asks for, what state
   remembers, and what really exists. Every surprising plan is one of those three disagreeing
   with the others. Decide which pair disagrees before you change anything.
2. **Evidence source.** Read the plan's first error or its `# … will be / must be` lines and
   every `# forces replacement` marker. `git diff --no-index starter/terraform.tfvars
   work/terraform.tfvars` shows what changed in configuration; `terraform state show
   local_file.config` and `ls -l work/out/*` show the other two.
3. **Discriminating check.** `terraform plan -refresh=false` compares configuration with state
   only. If that plan is clean but the normal plan is not, the real object changed out of band.
   If both are dirty, configuration changed. If neither runs, the inputs are invalid.
4. **Root cause and fix.** Variant A: the tfvars now say `environment = "Dev"` and
   `listen_port = 80`; correct the inputs, do not delete the rules. Variant B: the tfvars say
   `environment = "staging"`, so the `keepers` force a new `random_id` and both files move to
   `out/staging/` — revert to dev here (staging belongs in its own workspace/state); never apply
   that plan. Variant C: `out/dev/beacon.yaml` was deleted; `terraform apply` recreates exactly
   that file and nothing else, and the `deploy_id` is unchanged. In all variants add the
   `store_path` validation (for example
   `condition = var.store_kind != "sqlite" || startswith(var.store_path, "/")`) and a test run
   with `expect_failures = [var.store_path]`.
