# Setup — SRE & Cloud Deployment Foundations

The course runs in two places:

1. **LOOPED itself** (this static app): lessons, questions, the baseline diagnostic, simulated
   incidents, design worksheets, reviews and your evidence. Nothing to install; it works
   offline once loaded. Your progress lives in this browser's `localStorage` (`lx.sre`) —
   export it from **Course → Evidence** before clearing site data or switching browsers.
2. **Local labs** in `labs/sre-cloud-foundations/`, which you run on your own machine. The app
   never runs commands; it shows them, and you import the JSON report each lab's
   `validate.py` writes.

Nothing in the default course buys cloud resources or calls a paid API. The five cloud
extensions (C01–C05) are disabled until you opt in per extension (see "Cloud" below).

## What you need, by profile

Each lab names one environment profile. Install only what the labs you are about to do need.

| Profile | Used by | You need | Set up with |
|---|---|---|---|
| `linux-arm64` | L01–L08 (host labs) | [Lima](https://lima-vm.io/) on macOS; the VM provides systemd, iproute2, Python 3.12 | `labs/sre-cloud-foundations/profiles/linux-arm64/README.md` |
| `workstation` | fixture labs (architecture, IAM, Terraform local, SLO data, API support) | Python 3.10+, Terraform (see version matrix), `jq` | nothing beyond the tools |
| `compose` | container and data labs | Docker Desktop or colima with Compose v2 | `labs/sre-cloud-foundations/profiles/compose/README.md` |
| `kind-basic` | Kubernetes labs | Docker + kind + kubectl + Helm at the pinned versions | `labs/sre-cloud-foundations/profiles/kind-basic/README.md` |
| `kind-policy` | NetworkPolicy lab | as kind-basic, plus an enforcing CNI installed by the profile | `labs/sre-cloud-foundations/profiles/kind-policy/README.md` |
| `observability` | telemetry and SLO labs | Docker + Compose; Prometheus/Grafana/OTel Collector images pinned in the profile | `labs/sre-cloud-foundations/profiles/observability/README.md` |
| `cloud-sandbox` | C01–C05 only, opt-in | your own sandbox account and spending limit | `labs/sre-cloud-foundations/cloud/README.md` |

Exact versions are in [version-matrix.md](version-matrix.md). On Apple Silicon everything is
`arm64`; images used by the labs are multi-architecture or built locally.

## First hour

1. Open LOOPED, switch the track to **SRE & Cloud Deployment Foundations** and take the
   **Baseline** (24 questions, two short investigations, one optional Python attempt; skip
   anything you do not know — skipping is information, not failure; nothing to install).
2. Clone the repository you are reading (labs live in it) and create the Lima VM:
   `labs/sre-cloud-foundations/profiles/linux-arm64/vm-create.sh`.
3. Start **M01** from **Course → Path**. The path shows this week's lessons, lab, scenario and
   due reviews in order, at about 3.5 hours per week.

## Safety model (what the lab scripts promise)

- Every script sources `labs/sre-cloud-foundations/lib/looped.sh` and calls a scope guard
  before changing anything: inside the course VM (`/etc/looped-vm`), against the exact kind
  context `kind-looped-foundations`/`kind-looped-policy` whose nodes are named accordingly, a
  Compose project named `looped-*`, or a Terraform directory inside a lab with local state only.
- Resets and teardowns remove only what the lab created: the named namespace (`beacon`), the
  named cluster, the `looped-*` Compose project and its labelled volumes, the lab's files.
  No script prunes Docker, deletes host containers, touches your default kubeconfig context
  or fills your host disk; capped filesystems are loop images inside the VM.
- Evidence is sanitised: validators record observations, never tokens, keys or real logs. The
  import refuses reports that look like they contain a credential, and refuses the shipped
  `evidence-example.json` files (they document the schema; they are not results).

## Evidence and assistance

`validate.py` in each lab prints each check and writes a JSON report:

```sh
python3 labs/sre-cloud-foundations/L03/validate.py --out labs/sre-cloud-foundations/L03/evidence/latest.json \
  --explanation-file labs/sre-cloud-foundations/L03/evidence/L03-diagnosis.md
```

Add `--assistance assisted` if you opened hint rung 3 or 4 or the worked solution, and
`--variant variant-b --assistance independent` for the changed independent variant. Paste the
JSON into the lab's **Evidence** tab. Exposure (lessons read), guided practice and independent
performance are recorded separately; a module passes only on independent evidence of a
changed variant plus the knowledge gate, every required practical check, no critical unsafe
action and an explanation rated 3/4 or better.

## Cloud (optional, off by default)

Open **Course → Branches**, pick an extension, read its estimate, allowed resources and
cleanup inventory, then name a sandbox account, a spending limit and an expiry and tick the
confirmation. Only then do the commands appear. Budget alerts are notifications, not caps;
stopping a VM does not delete its disks, IPs, load balancers, logs or snapshots. The cleanup
inventory is the pass condition.

## Where things are

| Thing | Path |
|---|---|
| Course content (data) | `assets/js/data/sre-*.js` |
| Course hub (UI) and simulator engines | `assets/js/sre.js`, `assets/js/sre-sim.js`, `assets/js/k8s-model.js` |
| Labs, shared helpers, Beacon starter | `labs/sre-cloud-foundations/` (`lib/`, `beacon/`, `LNN/`, `profiles/`, `cloud/`) |
| Validators | `tests/data/test-sre-*.js`, `tests/ui/test-sre.js` |
| Status of every item | [implementation-status.md](implementation-status.md) |
| Troubleshooting | [troubleshooting.md](troubleshooting.md) |
