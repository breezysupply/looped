# beacon-report image (L25). Build context: work/patch/report/ — use
# assets/build-report.sh, which fetches the hash-pinned wheels into wheels/
# for your engine's architecture and passes the lock's sha256 as a label.
FROM python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d

ARG REQUIREMENTS_SHA256=unset
LABEL looped.lab/id="L25" \
      looped.lab/requirements-sha256="${REQUIREMENTS_SHA256}" \
      org.opencontainers.image.title="beacon-report"

# Dependencies only from the local wheelhouse, every file hash-checked;
# the wheels are bind-mounted for this step and never become a layer.
COPY requirements.txt /tmp/requirements.txt
RUN --mount=type=bind,source=wheels,target=/tmp/wheels \
    PIP_DISABLE_PIP_VERSION_CHECK=1 pip install --no-cache-dir --no-index --find-links=/tmp/wheels \
        --only-binary=:all: --require-hashes -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

RUN groupadd --gid 10001 report && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /app --shell /usr/sbin/nologin report
WORKDIR /app
COPY app/ /app/app/
COPY tests/ /app/tests/
COPY data/ /app/data/
COPY report.json /etc/beacon-report/report.json
COPY operator-templates/ /etc/beacon-report/templates/
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["python3", "-m", "app.report"]
CMD ["--input", "/app/data/records.json", "--out", "/tmp/out"]
