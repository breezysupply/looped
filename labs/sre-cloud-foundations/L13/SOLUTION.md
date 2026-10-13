# L13 worked solution

## The Dockerfile, line by line

| Instruction | Why |
|---|---|
| `FROM python:3.12.7-slim-bookworm@sha256:60d9…b50d` | exact version for humans, index digest for machines; the digest names a multi-platform index (linux/amd64 and linux/arm64/v8 among others), so the same line builds natively on either host |
| `COPY requirements.lock` + `RUN --mount=type=bind,source=wheels,…` | install exactly the hashed wheels, `--no-index`, `--only-binary=:all:`; the wheels are mounted for one step and never become a layer |
| `RUN groupadd/useradd --uid 10001` | a fixed numeric identity that a Kubernetes `runAsUser` can match |
| `COPY --chown=10001:10001 beacon/` and `conf/` | only the package and its config; nothing from the host's home, no tests, no caches |
| `USER 10001:10001` | the process is not root inside the container |
| `HEALTHCHECK … /healthz` | Docker's view of liveness from inside the container (Kubernetes ignores it) |
| `ENTRYPOINT ["python3","-m","beacon"]`, `CMD ["api"]` | exec form: Python is PID 1 and receives SIGTERM; `CMD` is the overridable argument (`worker` in L14) |

## Variant A — the service answers only inside the container

Observation: `curl -sS http://127.0.0.1:18013/healthz` → `Recv failure: Connection reset by peer`,
yet `docker ps` says `Up … (healthy)`. Discriminate: `docker port looped-l13-api` → `8080/tcp -> 127.0.0.1:18013`
(the mapping is right); `docker logs looped-l13-api | head -3` → `listening on 127.0.0.1:8080`.
The published port forwards to the container's network interface, where nothing listens;
the health check passes because it runs on the container's own loopback.

Fix: `server.listen: 0.0.0.0` in `work/conf/beacon.yaml`, `bash rebuild.sh`. (Equivalent:
`-e BEACON_SERVER_LISTEN=0.0.0.0` at run time — but then the image still ships the wrong
default; fix the image.) Publishing on the host's `127.0.0.1` stays: binding the *host* side
to loopback is the safe choice for a laptop.

## Variant B — the config file never reaches the image

Observation: `docker ps -a` shows `Exited (1)`; `docker logs looped-l13-api` →
`FATAL config: open /app/conf/beacon.yaml: no such file or directory`. The file exists in
`work/conf/`. Discriminate: `docker run --rm --entrypoint ls looped-l13-beacon:1.4.0 -la /app/conf`
(empty) versus `cat work/.dockerignore` — the last lines exclude `**/*.yaml`, so the file never
entered the build context and `COPY conf/` copied an empty directory without complaint.

Fix: add `!conf/beacon.yaml` after the exclusion (or remove the overly broad pattern), rebuild.
Rejected: deleting `.dockerignore`. The smoke test passes, and `conf/.env.local` (a token)
lands in `/app/conf`; `no-secret-in-image` fails, as it should.

## Variant C — the image is for the other architecture

Observation: on an amd64 engine `docker logs` → `exec /usr/local/bin/python3: exec format error`
and the run prints `WARNING: The requested image's platform (linux/arm64) does not match the
detected host platform`; on Apple Silicon with emulation the container may start, slowly,
with the same warning. Discriminate: `docker image inspect looped-l13-beacon:1.4.0 --format '{{.Os}}/{{.Architecture}}'`
versus `docker info --format '{{.Architecture}}'`. The base index lists both platforms, so the
base is not the problem; this particular image was built for the other one.

Fix: rebuild natively, `bash rebuild.sh` (or explicitly `LOOPED_PLATFORM=linux/arm64 bash rebuild.sh`
on Apple Silicon). Record the image ID and platform in your notes. A multi-platform push
(`docker buildx build --platform linux/arm64,linux/amd64 --push`) is the production answer and
needs a registry; out of scope here.

## Proof

```
curl -sS http://127.0.0.1:18013/healthz                  # ok
docker exec looped-l13-api id -u                         # 10001
docker exec looped-l13-api cat /proc/1/cmdline | tr '\0' ' '   # python3 -m beacon api
docker inspect --format '{{.State.Health.Status}}' looped-l13-api   # healthy
python3 labs/sre-cloud-foundations/L13/validate.py      # PASS L13: 15/15
```
