"""beacon-report — render a status page from a JSON export of Beacon records.

    python3 -m app.report --input data/records.json --out /tmp/status.html

Config (/etc/beacon-report/report.json, or --config):
  title               page title
  template            built-in template name (shipped in the image)
  custom_templates    true: also render operator-supplied templates from
                      operator_template_dir in a Jinja SandboxedEnvironment
  operator_template_dir

Records come from sensors in the field: `endpoint` is whatever hostname the
sensor reported about itself, so it is untrusted input.
"""
import argparse
import json
import os
import sys
from collections import Counter

import idna
from jinja2 import Environment, FileSystemLoader, select_autoescape
from jinja2.sandbox import SandboxedEnvironment

from . import __version__

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CONFIG = "/etc/beacon-report/report.json"


def load_config(path):
    cfg = {"title": "Beacon status", "template": "status.html.j2", "custom_templates": False, "operator_template_dir": "/etc/beacon-report/templates"}
    if path and os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            cfg.update(json.load(fh))
    return cfg


def normalize_host(host):
    """Sensor-reported hostname -> ASCII (A-label) form for display and grouping."""
    host = (host or "").strip().rstrip(".").lower()
    if not host:
        return "unknown"
    if len(host) > 253:
        raise ValueError("hostname longer than 253 characters")
    return idna.encode(host, uts46=True).decode("ascii")


def summarize(records):
    by_status = Counter(r.get("status", "unknown") for r in records)
    hosts = sorted({normalize_host(r.get("endpoint")) for r in records})
    return {"total": len(records), "by_status": dict(sorted(by_status.items())), "hosts": hosts}


def render(cfg, records):
    env = Environment(loader=FileSystemLoader(os.path.join(HERE, "templates")), autoescape=select_autoescape(["html", "j2"]))
    summary = summarize(records)
    pages = {"index.html": env.get_template(cfg["template"]).render(title=cfg["title"], summary=summary, records=records, version=__version__)}
    if cfg.get("custom_templates"):
        # operators drop their own templates into this directory; they are
        # rendered in the sandbox because their content is not reviewed
        op_dir = cfg["operator_template_dir"]
        sandbox = SandboxedEnvironment(loader=FileSystemLoader(op_dir), autoescape=True)
        for name in sorted(os.listdir(op_dir)) if os.path.isdir(op_dir) else []:
            if name.endswith(".j2"):
                pages[name[:-3]] = sandbox.get_template(name).render(summary=summary, records=records)
    return pages


def main(argv=None):
    p = argparse.ArgumentParser(prog="beacon-report")
    p.add_argument("--config", default=DEFAULT_CONFIG)
    p.add_argument("--input", required=True)
    p.add_argument("--out", required=True, help="output directory")
    a = p.parse_args(argv)
    cfg = load_config(a.config)
    with open(a.input, "r", encoding="utf-8") as fh:
        records = json.load(fh)
    pages = render(cfg, records)
    os.makedirs(a.out, exist_ok=True)
    for name, html in pages.items():
        with open(os.path.join(a.out, name), "w", encoding="utf-8") as fh:
            fh.write(html)
    print(json.dumps({"pages": sorted(pages), "records": len(records)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
