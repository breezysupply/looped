# modules/beacon — extract the reusable module here (checkpoint c2)

Move the network, data volume, image and API container out of `envs/dev/main.tf` into this
directory (`main.tf`, `variables.tf`, `outputs.tf`, `versions.tf` with the same
`required_providers`). Inputs: at least `env`, `api_port`, `beacon_src`; outputs at least the
container id and the volume name.

Then call it from `envs/dev/main.tf` with `source = "../../modules/beacon"` and add `moved`
blocks so Terraform knows `docker_volume.data` is now `module.beacon.docker_volume.data` (and the
same for the others). Run `terraform init` (modules need it) and `terraform plan`: the goal is
**0 to add, 0 to change, 0 to destroy** with only "has moved to" lines. If the plan wants to
destroy the data volume, stop and read it again.
