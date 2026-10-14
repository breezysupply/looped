# Beacon image (L13). Multi-platform: the base image is a manifest list with
# linux/arm64 and linux/amd64; build with `docker build` on either host or
# `docker buildx build --platform linux/arm64,linux/amd64`.
#
# Pin the base by digest once you have resolved it on your machine:
#   docker buildx imagetools inspect python:3.12.7-slim-bookworm
# and record the digest in docs/sre-cloud-foundations/version-matrix.md.
# The course does not ship a digest it did not resolve itself.
FROM python:3.12.7-slim-bookworm

# This reference image is standard-library only (memory/sqlite store, dir
# queue). Images that need the PostgreSQL/Redis drivers in requirements.txt are
# built by the labs from hash-checked wheels downloaded on the host
# (L13/setup.sh, profiles/kind-basic/build-image.sh), never from an unpinned index.

# an unprivileged user with a fixed uid so Kubernetes securityContext can match it
RUN groupadd --gid 10001 beacon && useradd --uid 10001 --gid 10001 --home /app --shell /usr/sbin/nologin beacon \
    && mkdir -p /app /var/lib/beacon && chown -R beacon:beacon /app /var/lib/beacon

WORKDIR /app
COPY --chown=beacon:beacon beacon/ /app/beacon/
COPY --chown=beacon:beacon beacon.yaml /app/beacon.yaml

USER 10001:10001
ENV PYTHONUNBUFFERED=1 \
    BEACON_CONFIG=/app/beacon.yaml \
    BEACON_STORE_KIND=memory \
    BEACON_STORE_PATH= \
    BEACON_QUEUE_KIND=none \
    BEACON_QUEUE_DIR=
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=2s --start-period=5s --retries=3 \
    CMD ["python3", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2).status==200 else 1)"]
# exec form so Python is PID 1 and receives SIGTERM directly
ENTRYPOINT ["python3", "-m", "beacon"]
CMD ["api"]
