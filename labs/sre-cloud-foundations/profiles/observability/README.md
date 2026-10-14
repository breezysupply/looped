# Profile: observability (`looped-obs`)

A small, pinned telemetry stack for the M11 labs (L21 first; later labs that need telemetry
reuse it). Docker Compose project **`looped-obs`**, network **`looped-obs-net`**, every port on
127.0.0.1. Start it when a lab needs it and stop it afterwards: the course never runs this stack,
a kind cluster and the Linux VM at the same time.

| Component | Image (pinned) | Host address | Role |
|---|---|---|---|
| Prometheus | `prom/prometheus:v3.5.0` | http://127.0.0.1:19090 | scrapes every 5 s; file service discovery from `prometheus/targets/*.json`; exemplar storage on; 1-day retention |
| OpenTelemetry Collector (contrib) | `otel/opentelemetry-collector-contrib:0.131.0` | OTLP/HTTP http://127.0.0.1:14318, health :13133 | receives OTLP (gRPC 4317, HTTP 4318 inside the network), batches, forwards traces to Jaeger |
| Jaeger | `jaegertracing/jaeger:2.9.0` | http://127.0.0.1:16686 | trace storage (in memory) and UI; `/api/traces/<id>` for scripts |
| Grafana | `grafana/grafana:12.1.1` | http://127.0.0.1:13000 | provisioned datasources (Prometheus uid `looped-prom` with exemplar links to Jaeger uid `looped-jaeger`); anonymous viewer; admin password `lab-grafana-not-a-real-secret` (a placeholder) |

If Docker Hub rate-limits the Prometheus pull, the same release is published by the Prometheus
project on quay.io: `export LOOPED_PROM_IMAGE=quay.io/prometheus/prometheus:v3.5.0` before setup.

## Use

```sh
bash labs/sre-cloud-foundations/profiles/observability/setup.sh      # start + check
bash labs/sre-cloud-foundations/profiles/observability/check.sh      # check again at any time
bash labs/sre-cloud-foundations/profiles/observability/teardown.sh   # stop and remove
```

- `setup.sh` starts the project (pulling pinned images on first use only) and runs `check.sh`.
- `check.sh` is read-only apart from one synthetic span: Prometheus ready and scraping itself
  and the collector; Grafana healthy with both datasources; the collector healthy; a test span
  sent over OTLP/HTTP is retrievable from Jaeger by its trace id. Exit 1 on any failure.
- `teardown.sh` refuses while a lab's containers are still attached to `looped-obs-net` (tear the
  lab down first), then removes the `looped-obs` containers, the network and the project's
  anonymous volumes (Prometheus' TSDB is disposable). Images are kept.

Labs join with `networks: { obs: { name: looped-obs-net, external: true } }` and are scraped by
container name through `prometheus/targets/*.json` (L21's three targets ship in
`beacon-l21.json`; an absent target is simply reported down). They send traces to
`http://looped-obs-otelcol:4318`.

## Resources

Measured with `docker stats` in the authoring environment (Linux amd64) while L21 ran: about
190–200 MiB of memory for the four containers together (Grafana ~90, Prometheus ~40, collector
~40, Jaeger ~25 MiB). Budget 1 GiB and one core to leave headroom while a lab sends traffic.

## What it proves and what it does not

It proves that the course's telemetry wire formats work end to end on your machine: Prometheus
scraping (including OpenMetrics exemplars), OTLP into a collector, traces stored and queryable,
Grafana reading both. It does **not** provide high availability, long-term storage,
authentication beyond a placeholder admin password, alert routing (no Alertmanager — alert rules
are tested with promtool in L22), sampling, or a production-sized collector pipeline. Jaeger keeps
traces in memory: a restart loses them.

## Executed

In the authoring environment (Linux amd64, Docker Engine with Compose v2): `setup.sh` → all six
checks PASS (including a span through the collector into Jaeger), used by L21's full cycle, then
`teardown.sh` removed every `looped-obs-*` container and the network. Not run on macOS / Apple
Silicon, and arm64 image availability was not checked from here.
