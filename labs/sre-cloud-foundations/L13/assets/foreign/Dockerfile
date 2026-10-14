# L13 fixture image, built by inject.sh for one of the variants to stand in
# for "the image the build host pushed to registry.lab". Spoiler: read it only
# after you have diagnosed your variant (SOLUTION.md explains it). It has no
# RUN steps on purpose, so inject.sh can build it on any engine.
FROM python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d
LABEL looped.lab/id="L13" \
      org.opencontainers.image.title="beacon" \
      org.opencontainers.image.version="1.4.0"
WORKDIR /app
COPY --chown=10001:10001 beacon/ /app/beacon/
COPY --chown=10001:10001 conf/ /app/conf/
USER 10001:10001
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BEACON_CONFIG=/app/conf/beacon.yaml
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=2s --start-period=5s --retries=3 \
    CMD ["python3", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2).status == 200 else 1)"]
ENTRYPOINT ["python3", "-m", "beacon"]
CMD ["api"]
