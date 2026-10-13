# envs/staging — a second root module with its OWN state (checkpoint c2)

Create `versions.tf` (copy dev's), copy dev's `.terraform.lock.hcl`, and a `main.tf` that calls
`../../modules/beacon` with `env = "staging"` and `api_port = 18413`. Run `terraform init` and
`terraform apply` here. Its state is `envs/staging/terraform.tfstate`; dev's state never sees
staging's objects and the other way round. Promotion between them is a reviewed change to the
module or to a root's inputs, planned in each root separately.
