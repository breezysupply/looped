#!/usr/bin/env python3
"""Load work/dashboard.json into the profile's Grafana (http://127.0.0.1:13000)
as dashboard uid looped-l21-beacon, overwriting the previous version. Uses the
profile's lab admin account (a placeholder password, not a secret)."""
import base64
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "work", "dashboard.json")
dash = json.load(open(path, encoding="utf-8"))
dash.pop("id", None)
body = json.dumps({"dashboard": dash, "overwrite": True, "message": "L21 push"}).encode()
auth = base64.b64encode(b"admin:lab-grafana-not-a-real-secret").decode()
req = urllib.request.Request("http://127.0.0.1:13000/api/dashboards/db", data=body, method="POST",
                             headers={"Content-Type": "application/json", "Authorization": "Basic " + auth})
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    with opener.open(req, timeout=10) as r:
        out = json.loads(r.read())
        print("dashboard loaded: http://127.0.0.1:13000" + out.get("url", ""))
except Exception as e:  # noqa: BLE001
    sys.exit(f"could not load the dashboard into Grafana: {e}")
