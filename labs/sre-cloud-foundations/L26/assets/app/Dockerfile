# Beacon status API image for L26 (built on the "connected" sender side by
# setup.sh as looped-l26/beacon-api:1.4.0). Standard library only: no package
# index is needed to build it, only the pinned base image.
FROM python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d
LABEL looped.lab/id="L26" org.opencontainers.image.title="beacon-status" org.opencontainers.image.version="1.4.0"
WORKDIR /app
COPY statusapi.py pgmini.py /app/
USER 65534:65534
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
CMD ["python3", "-u", "/app/statusapi.py"]
