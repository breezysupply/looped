#!/usr/bin/env python3
"""Helm post-renderer for L31: connect the L19 chart's API to the capstone's PostgreSQL and Redis
without forking the chart.

    helm upgrade --install ... --post-renderer labs/sre-cloud-foundations/L31/assets/postrender.py

The L19 chart (reused unchanged, chart version 0.4.0) renders an in-memory store and no queue,
and its values schema rightly refuses unknown keys. Beacon reads BEACON_<SECTION>_<KEY>
environment variables after its config file, so this filter adds four env entries to the one
container of the chart's Deployment: the store URL comes from the Secret beacon-store that
rebuild.sh generates (never from a value or a ConfigMap). Reads rendered manifests on stdin,
writes them to stdout. Exits 1 (and Helm aborts) if the rendered output is not the shape it
expects: exactly one Deployment with exactly one `env:` block.
"""
import re
import sys

ADD = [
    "- name: BEACON_STORE_KIND",
    "  value: postgres",
    "- name: BEACON_STORE_URL",
    "  valueFrom:",
    "    secretKeyRef:",
    "      name: beacon-store",
    "      key: url",
    "- name: BEACON_QUEUE_KIND",
    "  value: redis",
    "- name: BEACON_QUEUE_URL",
    "  value: redis://beacon-queue:6379/0",
]


def main() -> int:
    text = sys.stdin.read()
    docs = re.split(r"(?m)^---\s*$", text)
    deps = [i for i, d in enumerate(docs) if re.search(r"(?m)^kind:\s*Deployment\s*$", d)]
    if len(deps) != 1:
        sys.stderr.write(f"postrender: expected exactly one Deployment, found {len(deps)}\n")
        return 1
    d = docs[deps[0]]
    envs = list(re.finditer(r"(?m)^(\s*)env:\s*$", d))
    if len(envs) != 1:
        sys.stderr.write(f"postrender: expected one env: block in the Deployment, found {len(envs)}\n")
        return 1
    if "BEACON_STORE_URL" in d:
        sys.stderr.write("postrender: the chart already sets BEACON_STORE_URL; refusing to set it twice\n")
        return 1
    pad = envs[0].group(1) + "  "
    block = "".join("\n" + pad + line for line in ADD)
    docs[deps[0]] = d[: envs[0].end()] + block + d[envs[0].end():]
    sys.stdout.write("---".join(docs))
    return 0


if __name__ == "__main__":
    sys.exit(main())
