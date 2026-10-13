# L13 — Beacon as an unprivileged container

Module M07 · ~120 min practical · profile `compose` (Docker engine; no Compose project needed) · runs **on your Mac**

## Ticket

> Platform wants Beacon shipped as an image. A colleague started the work: there is a
> Dockerfile, a `.dockerignore` and a pinned dependency lock in the build context, and a
> container called `looped-l13-api` is "up" on your machine. A smoke test from the host
> does not get a healthy answer. Before the image goes anywhere near `registry.lab`, prove
> what it is (base, user, entry point, architecture, what is inside it), make the host
> request work, and leave an image record a reviewer can check.

## Objectives

- `obj-m07-01` build and run Beacon as an unprivileged container with pinned dependencies and a documented entry point
- `obj-m07-02` trace a listening socket inside a container to a published port
- `obj-m07-05` identify image architecture and digests

## What is in the build context

`setup.sh` creates `L13/work/` from `starter/` plus a copy of the Beacon package:

| Path | Purpose |
|---|---|
| `work/Dockerfile` | base pinned by version **and** index digest, hash-checked install, UID 10001, `HEALTHCHECK`, exec-form `ENTRYPOINT` |
| `work/.dockerignore` | keeps caches, paperwork and anything `.env`-shaped out of the context |
| `work/requirements.lock` | `psycopg[binary]` and `redis` pinned with sha256 hashes for arm64 and amd64 wheels |
| `work/wheels/` | the exact wheels, downloaded on the host by `setup.sh`; bind-mounted for one `RUN`, never a layer |
| `work/conf/beacon.yaml` | the configuration baked into the image |
| `work/conf/.env.local` | a developer override file with a fake token; it must never reach the image |

`rebuild.sh` is the only build/run command you need: it builds `work/` as
`looped-l13-beacon:1.4.0` (label `looped.lab/id=L13`) and replaces the container
`looped-l13-api`, published on `127.0.0.1:18013`. It refuses to remove any container that is
not labelled for this lab. Want the harder path? Delete `work/Dockerfile` after setup and
write your own from the table above before reading `starter/Dockerfile`; the validator checks
properties of the image and container, not the text of the file.

## What is fixture-controlled

`inject.sh` breaks the build context or the running image in one of three ways chosen by
`LOOPED_VARIANT=variant-a|variant-b|variant-c`. Your Docker engine, network and Mac are not
faulty. The validator labels the evidence with the variant but never says what it changed.

## Steps and checkpoints

**Checkpoint c1 — build context, image record (week 19, session 1).**

1. Start Docker (`profiles/compose/check.sh` must print OK), then from the repository root:
   `bash labs/sre-cloud-foundations/L13/setup.sh`. It writes `evidence/L13-inventory.txt`
   and a notes file `evidence/L13-notes.md` from the template.
2. Read `work/Dockerfile` and `work/.dockerignore`. In your notes, one line per instruction:
   what it does and why it is there.
3. Record the image: `docker image inspect looped-l13-beacon:1.4.0 --format '{{.Id}} {{.Os}}/{{.Architecture}} user={{.Config.User}}'`,
   `docker buildx imagetools inspect python:3.12.7-slim-bookworm` (which platforms does the
   base index list?), and `docker info --format '{{.Architecture}}'`.

**Checkpoint c2 — reproduce, discriminate, fix (session 2).**

4. Reproduce from the host: `curl -sS http://127.0.0.1:18013/healthz` and
   `docker ps -a --filter label=looped.lab/id=L13`. Quote what you see.
5. Write two hypotheses, then pick the one read-only check that separates them:
   `docker logs`, `docker port`, `docker exec looped-l13-api …`, `docker image inspect`,
   `docker history --no-trunc`.
6. Make the smallest change in `work/` (or to how the image is built) and run
   `bash labs/sre-cloud-foundations/L13/rebuild.sh`.
7. Prove it on the user path and from inside: host `curl` returns `ok`; `docker exec looped-l13-api id -u`
   is not 0; `docker logs looped-l13-api` shows your request as a JSON line.
8. `python3 labs/sre-cloud-foundations/L13/validate.py --explanation-file labs/sre-cloud-foundations/L13/evidence/L13-notes.md`
   and paste `evidence/latest.json` into the app (Labs → L13 → Evidence).

## What you should observe

- `docker ps` status and the host's view can disagree. A container can be "Up (healthy)"
  while the host request fails, because the health check runs *inside* the container.
- A build can succeed and the container still fail at start; the first log line says why.
- `docker image inspect` reports one platform per local image; a registry index can list
  several. The engine's architecture is a separate fact you have to look up.
- The fix that passes is narrow. Deleting `.dockerignore`, running as root, or baking an
  environment file into the image all "work" for the smoke test and all fail validation.

## Validation (what `validate.py` measures)

Real image and container state only: the image exists and is labelled; every `FROM` is an
exact version (digest advisory); image architecture equals the engine's; configured `USER`
is not root; `ENTRYPOINT` is exec form; a `HEALTHCHECK` exists; the container runs, as a
non-zero UID, with Python as PID 1, and is healthy; an HTTP request from the host through the
published port answers `/healthz` 200 and `/version` 1.4.0; that request appears in
`docker logs`; no secret-shaped value in `docker history` or the image environment and no
`.env`/`.pem`/`.git` file under `/app`. Notes are advisory.

## Pause / resume

All state is `work/`, one image and one container. `reset.sh` rebuilds `work/` and re-injects
the same variant (or `LOOPED_VARIANT=…`); `evidence/` is never touched. `teardown.sh` removes
only the `looped.lab/id=L13` container and image and `work/`.

## Lab versus production

- Production images are built by CI from a clean checkout, pushed by digest and signed
  (M10, M13). Here you build locally and nothing is pushed.
- A `HEALTHCHECK` is a Docker feature; Kubernetes ignores it and uses probes (L16).
- The wheelhouse pattern (download and hash-check on the host, install with no index) is how
  disconnected builds work; L26 extends it to a signed bundle.

## Limits

This lab proves you can build, inspect and run one unprivileged image and explain what is in
it. It does **not** prove multi-platform publishing (you build one platform locally), image
signing or provenance, vulnerability management, or anything about Kubernetes. Running an
image for the other architecture depends on your engine's emulation: Docker Desktop on Apple
Silicon usually emulates amd64, a plain Linux engine usually does not — the validator judges
the recorded architecture, not whether emulation happened to work.

## References

- T06 Docker multi-platform builds · T16 Docker Compose documentation (build, labels)
