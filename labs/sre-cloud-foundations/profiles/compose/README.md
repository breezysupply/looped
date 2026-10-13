# Profile: compose — a container engine and Docker Compose v2 on your Mac

Used by L13 and L14 (and later the container parts of L23, L24, L27). The labs run on your
Apple Silicon Mac against a local container engine; nothing runs in the cloud and nothing is
pushed to a registry.

| Pinned / tested | Value |
|---|---|
| Engine | Docker Desktop 4.x **or** colima 0.8.x with the Docker CLI (`brew install colima docker docker-compose docker-buildx`) |
| Engine architecture | `arm64` (native on Apple Silicon); `docker info --format '{{.Architecture}}'` prints `aarch64` |
| Compose | v2 plugin (`docker compose version` → 2.x or later). The old Python `docker-compose` v1 is not supported |
| Resources | 4 CPUs, 6–8 GiB memory for the engine VM; L14 itself needs about 600 MiB |
| Base images | `python:3.12.7-slim-bookworm` and `postgres:16.4`, both pinned by multi-platform index digest in the lab files |
| Host tools | `python3` with `pip` (Xcode command-line tools provide one) for validators and the wheelhouse download |

**AMD64 note:** on an Intel Mac or a Linux PC everything works unchanged; images build as
`linux/amd64` and the L13 architecture check compares against that.

## Start the engine

```sh
# Docker Desktop: start the app, then
docker info >/dev/null && echo engine up
# or colima (no Desktop licence needed):
colima start --cpu 4 --memory 8 --arch aarch64 --vm-type vz
labs/sre-cloud-foundations/profiles/compose/check.sh
```

`check.sh` is read-only: it checks the CLI, the engine, Compose v2, buildx and `python3`,
prints the host and engine architecture, and lists any existing `looped-*` Compose projects. It
creates and removes nothing and changes no setting. Exit code 1 means "not ready" with a FAIL
line saying why.

## Naming and scope — what the labs may touch

- Every Compose project is named `looped-<lab>` (`looped-l14`, …); the project name is fixed
  inside each `compose.yaml` and scripts pass it again with `-p` through `dc` in `lib/looped.sh`,
  which refuses any name that does not start with `looped-`.
- Every container, image, network and volume a lab creates carries the label
  `looped.lab/id=<lab id>`; plain `docker run` labs (L13) also use `looped-<lab>-*` names.
- Teardown removes only that lab's project (`docker compose -p looped-<lab> down`) and images
  carrying that lab's label. **Volumes are kept** unless you set `LOOPED_RESET_DATA=1`.
- No lab script runs `docker system prune`, `docker volume prune`, removes containers it did
  not create, or edits Docker Desktop / colima settings. Base images you pulled stay; remove
  them yourself (`docker rmi postgres:16.4`) if you want the disk back.

Inventory at any time:

```sh
docker ps -a --filter label=looped.lab/id --format 'table {{.Names}}\t{{.Label "looped.lab/id"}}\t{{.Status}}'
docker compose ls --all | grep looped-
docker volume ls --filter label=looped.lab/id
```

## Behind a TLS-inspecting proxy

The image builds install Python packages from a **wheelhouse** that `setup.sh` downloads on
the host (`python3 -m pip download`, hash-checked against the lab's `requirements.lock`), so
the build itself needs no package index. If `pip download` fails on certificates, configure
pip on the host (`pip config set global.cert /path/to/corporate-ca.pem`); do not disable
verification and do not copy certificates into images.

## What this profile does not prove

- One engine on one machine: no registry, no multi-host networking, no orchestration, no
  rolling update. Compose `depends_on` exists only inside one project on one host.
- The engine runs inside a Linux VM (Docker Desktop or colima); bind-mount performance, file
  ownership and published-port behaviour differ from a Linux server in small ways. Labs use
  named volumes and `127.0.0.1` port publishing to stay on the well-trodden path.
- A local named volume is not a backup and says nothing about durability across machines or
  zones.
- Running an image for the other CPU architecture depends on emulation (Rosetta/QEMU) in your
  engine VM; whether it happens to run is not evidence that the image is right.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Cannot connect to the Docker daemon` | engine not started, or `docker context` points at a stopped colima |
| `docker: 'compose' is not a docker command` | Compose v2 plugin missing (`brew install docker-compose` and add `cliPluginsExtraDirs` per the brew caveat) |
| `port is already allocated` on 18013/18014 | another process uses the port; `lsof -nP -iTCP:18014 -sTCP:LISTEN` |
| builds are very slow, `exec format error` | building or running for the other architecture under emulation (see L13) |
