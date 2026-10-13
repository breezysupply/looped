# L12 worked solution

Reference files are in `solution/` (module, dev root with `moved.tf`, staging root, and the
variant B `worker.tf`). Always: write the prediction, run the plan, compare.

## c1 — the ticket

### Variant A — out-of-band change

Plan: `# docker_container.api has been deleted` (refresh: the id in state no longer exists),
then `will be created`, `1 to add`. Apply fails: `Conflict. The container name
"/looped-l12-dev-api" is already in use`. `docker inspect` shows a container with label
`looped.lab/origin=by-hand`, published on 18499, mounting the same data volume. The code is the
source of truth and the data is in the volume, so make reality match the code. Either:

```sh
# 1) import it, then accept the replacement the import plan shows
printf 'import {\n  to = docker_container.api\n  id = "%s"\n}\n' "$(docker inspect -f '{{.Id}}' looped-l12-dev-api)" > work/envs/dev/import.tf
terraform -chdir=work/envs/dev plan    # 1 to import, 1 to add, 1 to destroy: must be replaced (env, ports, labels, mounts)
terraform -chdir=work/envs/dev apply && rm work/envs/dev/import.tf
# 2) or remove the unmanaged duplicate by its exact name and apply
docker rm -f looped-l12-dev-api && terraform -chdir=work/envs/dev apply
```

An import block for an address already in state is ignored; here the failed apply's refresh had
already dropped the deleted container from state (check `terraform state list`).

### Variant B — importable existing container

The spool volume imports cleanly (`docker_volume.spool will be imported`, nothing else) when the
resource block matches its name and labels. The worker container does not: with provider 4.6.0
the first plan after `terraform import docker_container.worker <id>` says `must be replaced`
(env, image reference, network_mode, labels, mounts, volumes). The worker is stateless and its
queue lives in the spool, so the replacement is acceptable — say so in the notes. Add
`prevent_destroy` to the spool too. See `solution/variant-b/worker.tf`; remove the import block
after the apply.

### Variant C — forced replacement

Prediction: `docker_container.api must be replaced` (`external = 18412 -> 18422 # forces
replacement`) and `docker_volume.data must be replaced` (`+ labels { # forces replacement`).
Docker volume labels cannot change in place, so the second replacement deletes every record.
Apply the port half only: remove `extra_volume_labels` from `terraform.tfvars` with a comment
explaining why (the backup job can select the volume by name, or the label can be set when a
new volume is created deliberately with a restore). Plan: `1 to add, 1 to destroy` (the
container only). The seed record is still served on 18422. Applying the whole change request
returns an empty record list and fails `data-preserved` and `volume-kept`.

## c2 — module and environments

1. `solution/modules/beacon/` holds network, volume (with `lifecycle { prevent_destroy = true }`),
   image and container; inputs `env`, `api_port`, `image`, `beacon_src`, `extra_volume_labels`.
2. `envs/dev/main.tf` calls `source = "../../modules/beacon"`; `envs/dev/moved.tf` has four
   `moved` blocks (network, volume, image, container). `terraform init` then `plan`:
   four `has moved to` lines and `Plan: 0 to add, 0 to change, 0 to destroy`. Without the
   moved blocks the plan destroys the old addresses and creates new ones — including the volume.
3. `envs/staging/` is a copy of the dev root without `moved.tf`, with `env = "staging"`,
   `api_port = 18413` and dev's lockfile. `init` + `apply`: 4 added. Two state files, two
   lineages; promotion is a module change planned in dev, applied, then planned in staging.
4. Try `terraform plan -var 'extra_volume_labels={"looped.lab/backup"="nightly"}'` in dev:
   `Error: Instance cannot be destroyed` — the guard works.

## Teardown

`bash labs/sre-cloud-foundations/L12/teardown.sh` destroys staging then dev; `prevent_destroy`
makes destroy refuse, so the script removes the volumes from state and deletes them by exact
`looped-l12-*` name, then removes anything else with that prefix (hand-made objects from
`inject.sh`). It never prunes and keeps the base image.
