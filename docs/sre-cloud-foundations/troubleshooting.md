# Troubleshooting — SRE & Cloud Deployment Foundations

Organised by where the problem shows up. Each entry: symptom → most likely cause → the check
that separates it → the fix. If something here is wrong for your setup, note it in your
evidence; the labs are written for Apple Silicon + Lima + Docker Desktop/colima.

## The app

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| Course view says "Loading the course…" forever | the lazy track files did not load (offline before first load, or a blocked script) | DevTools → Network for `sre-*.js` | load once online; the service worker caches them for offline use afterwards |
| Progress vanished | site data cleared, private window, or a different browser profile | `localStorage.getItem('lx.sre')` in DevTools | import your last export (Course → Evidence); export regularly |
| After an update something looks wrong with saved progress | a storage migration | Course → Evidence shows the backup | **Roll back** restores the pre-migration snapshot exactly (all tracks); report the problem |
| Evidence import says "this is the lab's example file" | you pasted `evidence-example.json` | its `note` says example | run the lab's `validate.py` and paste the JSON it writes |
| Evidence import says "appears to contain a credential" | a token/key pattern in `observed` or the explanation | search the JSON for `Bearer`, `AKIA`, `PRIVATE KEY` | sanitise and re-run the validator with a cleaned explanation file |
| "report is for a content version other than…" | the lab changed after you ran it | compare `contentVersion` | the attempt is kept but marked for revalidation; re-run when convenient |
| A simulated incident "ignores" a command | it is outside the scenario's documented grammar | the terminal says *not supported in this simulation* | use `/help` and the grammar list in the brief; the simulator never pretends |

## Lima VM (linux-arm64)

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| `limactl create` fails downloading the image | network/proxy or image URL moved | `limactl create --debug` | retry; or pin a dated image URL + sha256 in `looped-foundations.yaml` |
| Lab script: "this does not look like the course VM" | running on macOS or another Linux box | `cat /etc/looped-vm` | `limactl shell looped-foundations`; on a disposable Linux box you own, `LOOPED_ALLOW_ANY_LINUX=1` |
| Repository not visible inside the VM | mount missing | `ls "$PWD"` inside the VM | recreate with the profile YAML (it mounts your home read/write) |
| VM is in a strange state after many labs | accumulated fixtures | `systemctl list-units 'beacon*'` | `profiles/linux-arm64/vm-reset.sh` (keeps the VM) or delete/recreate |

## Docker / Compose

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| "Docker is not reachable" from a lab script | Docker Desktop/colima not running | `docker info` | start it; colima: `colima start --cpu 4 --memory 6` |
| `exec format error` | amd64 image on an arm64 host (that is also S14's lesson) | `docker image inspect -f '{{.Architecture}}' IMAGE` | use the multi-arch digest or build with `--platform linux/arm64` |
| Port already allocated | another project or a previous run holds it | `docker ps --format '{{.Names}} {{.Ports}}'` | stop the *lab's* project (`docker compose -p looped-… down`); do not remove other containers |
| Disk filling up | many image builds | `docker system df` | remove only the lab's images (`docker image ls 'looped/*'`), never `prune` everything |

## kind / Kubernetes

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| Lab refuses: "context … not found" | the profile cluster was not created | `kubectl config get-contexts` | `profiles/kind-basic/setup.sh` |
| Lab refuses: "points at … not a local API server" | your context name collides with something else | `kubectl config view --minify` | delete or rename the colliding context; the guard is protecting a real cluster |
| `kind create cluster` hangs or fails on `kubeadm init` | not enough memory for Docker, or a nested-container restriction | `docker info` memory; `docker logs looped-foundations-control-plane` | give Docker ≥ 6 GiB; on Linux hosts with restricted runtimes kind may not work at all (the authoring container could not run kind — see implementation-status) |
| NetworkPolicy has no effect | the cluster's CNI does not enforce policies (kind's default kindnet supports basic policies only in recent versions; the policy lab uses its own profile) | `kubectl --context kind-looped-policy -n kube-system get pods` | use `profiles/kind-policy/setup.sh` |
| Images not found in kind | images built locally but not loaded | `docker exec … crictl images` | `kind load docker-image --name looped-foundations IMAGE@digest` |

## Terraform

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| `terraform init` cannot download providers | offline or registry blocked | `curl -I https://registry.terraform.io` | the labs pin providers in `.terraform.lock.hcl`; use a provider mirror if your network requires one |
| Lab refuses: "declares a remote backend or cloud block" | a backend was added to a lab workspace | `grep -n backend *.tf` | lab workspaces use local state only; remote state is C02's subject |
| Plan wants to replace something you did not expect | an immutable attribute or address changed (M06 lesson 04) | read the `# forces replacement` line | change the config back, or use `moved {}` for an address change; never apply a plan that destroys data without a backup |
| Remote state lock error (C02 only) | another run holds the S3 lockfile | the error's Lock ID / Who / Created | wait for the owner; `force-unlock` only after proving the owner is gone (S12) |

## Python labs

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| `ModuleNotFoundError` in a lab | running from the wrong directory | `pwd` | run from the repository root as the lab README shows; labs use the standard library only |
| Tests pass locally, validator fails | the validator runs hidden edge-case fixtures | its observation lines | read the failing check's observation; it names the input |
