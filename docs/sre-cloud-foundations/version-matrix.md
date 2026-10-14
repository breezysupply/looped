# Version matrix — SRE & Cloud Deployment Foundations

What the labs pin, and what the authoring environment actually ran. "Pinned" means the
repository names this exact version (and, where shown, digest); "Authoring run" says whether
the labs were executed with it while the course was built. Nothing here says a version was
tested on Apple Silicon unless that column says so — none were (see
[implementation-status.md](implementation-status.md)).

Policy: no `:latest` anywhere (the content validator enforces it); images by tag **and** index
digest where the lab author resolved one; Terraform providers pinned in `required_providers`
with a committed `.terraform.lock.hcl` (hashes for darwin/linux × arm64/amd64 where generated);
Kubernetes APIs `apps/v1`, `networking.k8s.io/v1`, `policy/v1`, `rbac.authorization.k8s.io/v1`.
When you bump a version, change it here and in the lab, re-run the lab, and record the run in
the status file.

## Host tools

| Tool | Pinned / assumed | Used by | Authoring run (Linux amd64 container) |
|---|---|---|---|
| Lima | 1.0.x | linux-arm64 profile | not run (no macOS host) |
| Ubuntu guest | 24.04 LTS cloud image (arm64; amd64 alternative) | linux-arm64 profile | host labs run on a Linux container with `LOOPED_ALLOW_ANY_LINUX=1` instead |
| Python | 3.12 in images; 3.10+ on the host (stdlib only) | all Python labs | yes |
| Docker Engine / Compose | Docker Desktop or colima with Compose v2 | compose, kind, observability profiles | Docker 29.8.2, Compose v5.6.0 |
| kind | v0.29.0 | kind-basic, kind-policy | **cluster creation fails in the authoring container** (nested runc); not run |
| kindest/node | `v1.33.1@sha256:050072256b9a903bd914c0b2866828150cb229cea0efe5892e2b644d5dd3b34f` (kind v0.29.0 default) | kind profiles | image pulled, no cluster |
| kubectl | v1.33.1 (within ±1 minor of the cluster) | kind labs | client only |
| Helm | v3.18.6 | L19, L31, C03 | `helm lint`/`template` ran |
| kubeconform | v0.7.0 (`-strict`, Kubernetes 1.33.1 schemas) | static validation of every manifest | yes |
| Terraform | 1.13.3 (configs require ≥ 1.10 for the S3 lockfile) | L11, L12, C01, C02 | L11/L12 full cycles; C01/C02 `validate` only |
| Calico | v3.30.3 manifest (SHA-256 recorded in the profile) | kind-policy (L18) | not run (no cluster) |
| OpenSSL | system | L06, L26 | yes |
| PostgreSQL client/server | 16.x | L23, L24, L28 | via `postgres:16.4` image |

## Container images

| Image | Pin | Used by |
|---|---|---|
| `python` | `3.12.7-slim-bookworm@sha256:60d9996b6a8a…` (full digest in each Dockerfile) | Beacon images (L13 onward) |
| `postgres` | `16.4@sha256:e62fbf9d3e2b…` | L14, L17, L18, L23, L24, L25, L28 |
| `prom/prometheus` | `v3.5.0` | observability profile; `promtool` for L22 |
| `grafana/grafana` | `12.1.1` | observability profile |
| `otel/opentelemetry-collector-contrib` | `0.131.0` | observability profile |
| `jaegertracing/jaeger` | `2.9.0` | observability profile |
| `registry` | `2.8.3` | L20 local registry, L26 receiver registry |
| Beacon | built locally per lab (`looped-lNN-beacon:1.4.0`), deployed by digest | L13–L20, L31 |

## Terraform providers

| Provider | Version | Used by |
|---|---|---|
| hashicorp/local | 2.9.1 | L11 |
| hashicorp/random | 3.9.1 (L11), 3.7.2 (cloud C01/C02) | L11, C01, C02 |
| kreuzwerker/docker | 4.6.0 | L12 |
| hashicorp/aws | 6.60.0 | C01, C02 (never applied) |

## Python packages (container images only)

Beacon itself is standard-library only. Images that need drivers install them from
hash-checked wheels downloaded on the host (`L13/setup.sh`, `profiles/kind-basic/build-image.sh`):
`psycopg[binary]==3.2.3`, `redis==5.2.1` (see `labs/sre-cloud-foundations/beacon/requirements.txt`).

## Standards the content relies on

- Terraform S3 backend: `use_lockfile = true` (S3-native lock object). DynamoDB-based locking is
  deprecated in the Terraform documentation [T03] and is not taught as the default.
- Kubernetes probes, Services/EndpointSlices, NetworkPolicy and Pod Security as documented for
  1.33 [T02, T05, T22].
- Prometheus rule unit tests with `promtool test rules` [T14].
