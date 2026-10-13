# L17 lab image: Beacon, standard library only (memory store, no queue), unprivileged.
# Built by setup.sh: looped-l17-beacon:1.4.0, with
# --provenance=false so `kind load docker-image` gets a single-platform image.
FROM python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d
ARG BEACON_VERSION=1.4.0
RUN groupadd --gid 10001 beacon && useradd --uid 10001 --gid 10001 --home /app --shell /usr/sbin/nologin beacon
WORKDIR /app
COPY --chown=10001:10001 beacon/ /app/beacon/
COPY --chown=10001:10001 beacon.yaml /app/beacon.yaml
USER 10001:10001
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BEACON_CONFIG=/app/beacon.yaml \
    BEACON_APP_VERSION=${BEACON_VERSION} \
    BEACON_STORE_KIND=memory \
    BEACON_QUEUE_KIND=none
LABEL org.opencontainers.image.title="beacon" \
      org.opencontainers.image.version="${BEACON_VERSION}" \
      looped.lab.id="L17"
EXPOSE 8080
ENTRYPOINT ["python3", "-m", "beacon"]
CMD ["api"]
