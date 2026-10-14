# L20 build: Beacon (standard library only, memory store), unprivileged, base pinned by digest.
# Everything that identifies the build is a build argument recorded as labels AND visible at
# runtime (/version reports BEACON_COMMIT), so a running pod can be traced to one CI run.
FROM python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d
ARG BEACON_VERSION=0.0.0
ARG BEACON_COMMIT=unknown
ARG SCHEMA_MIN=0
ARG SCHEMA_MAX=0
RUN groupadd --gid 10001 beacon && useradd --uid 10001 --gid 10001 --home /app --shell /usr/sbin/nologin beacon
WORKDIR /app
COPY --chown=10001:10001 beacon/ /app/beacon/
COPY --chown=10001:10001 beacon.yaml release.json /app/
COPY --chown=10001:10001 migrations/ /app/migrations/
USER 10001:10001
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BEACON_CONFIG=/app/beacon.yaml \
    BEACON_APP_VERSION=${BEACON_VERSION} \
    BEACON_COMMIT=${BEACON_COMMIT} \
    BEACON_STORE_KIND=memory \
    BEACON_QUEUE_KIND=none
LABEL org.opencontainers.image.title="beacon" \
      org.opencontainers.image.version="${BEACON_VERSION}" \
      org.opencontainers.image.revision="${BEACON_COMMIT}" \
      lab.looped.schema.min="${SCHEMA_MIN}" \
      lab.looped.schema.max="${SCHEMA_MAX}" \
      lab.looped.id="L20"
EXPOSE 8080
ENTRYPOINT ["python3", "-m", "beacon"]
CMD ["api"]
