# Beacon image for L14 (the L13 image, solved). Build context: work/app/,
# which holds beacon/ (the package), conf/, wheels/, requirements.lock and this file.
#
# Base pinned by version AND by the multi-platform index digest resolved for
# this course (linux/amd64 + linux/arm64/v8 both in the index):
#   docker buildx imagetools inspect python:3.12.7-slim-bookworm
FROM python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d

LABEL looped.lab/id="L14" \
      org.opencontainers.image.title="beacon" \
      org.opencontainers.image.version="1.4.0"

# Pinned extras (PostgreSQL driver, Redis client) from a local wheelhouse:
# setup.sh downloads the exact wheels on the host (pip download, both
# architectures) into wheels/, and the build installs them with no index and
# every file hash-checked. The wheels are bind-mounted for this one step, so
# they never become an image layer, and the build needs no network beyond
# pulling the pinned base.
COPY requirements.lock /tmp/requirements.lock
RUN --mount=type=bind,source=wheels,target=/tmp/wheels \
    PIP_DISABLE_PIP_VERSION_CHECK=1 pip install --no-cache-dir --no-index --find-links=/tmp/wheels \
        --only-binary=:all: --require-hashes -r /tmp/requirements.lock \
    && rm /tmp/requirements.lock

# Unprivileged user with a fixed UID/GID so a Kubernetes securityContext can match it.
RUN groupadd --gid 10001 beacon \
    && useradd --uid 10001 --gid 10001 --home-dir /app --no-create-home --shell /usr/sbin/nologin beacon \
    && mkdir -p /app /var/lib/beacon/queue \
    && chown -R 10001:10001 /var/lib/beacon

WORKDIR /app
COPY --chown=10001:10001 beacon/ /app/beacon/
COPY --chown=10001:10001 conf/ /app/conf/

USER 10001:10001
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BEACON_CONFIG=/app/conf/beacon.yaml
EXPOSE 8080

# Liveness-style check: the process answers on its own loopback.
HEALTHCHECK --interval=10s --timeout=2s --start-period=5s --retries=3 \
    CMD ["python3", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2).status == 200 else 1)"]

# Exec form: python3 is PID 1 and receives SIGTERM directly (no shell in between).
ENTRYPOINT ["python3", "-m", "beacon"]
CMD ["api"]
