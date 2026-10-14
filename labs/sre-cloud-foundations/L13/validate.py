#!/usr/bin/env python3
"""L13 validator: inspects the REAL image and container through the Docker CLI.

Checks (critical unless noted):
  image-present        looped-l13-beacon:1.4.0 exists and carries looped.lab/id=L13
  base-pinned          every FROM in work/Dockerfile names an exact x.y.z tag or a digest (never latest)
  base-digest          the base is pinned by digest as well (advisory)
  architecture         the image's os/arch equals the engine's (recorded either way)
  non-root-config      the image's configured USER is not root
  exec-entrypoint      ENTRYPOINT is exec form (a JSON list, no /bin/sh -c)
  healthcheck          the image declares a HEALTHCHECK
  container-running    looped-l13-api is running and labelled L13
  runs-as-non-root     `docker exec looped-l13-api id -u` is not 0
  pid1-is-app          PID 1 inside the container is the Python process, not a shell
  healthy              Docker reports the container healthy
  user-path            HTTP from the host through the published port: /healthz 200, /version 1.4.0
  logs-visible         the request the validator sent appears in `docker logs` (stdout JSON line)
  no-secret-in-image   no secret-shaped values in history/env, and no .env/.pem/.git files under /app
  notes                evidence/L13-notes.md is filled in (advisory)
Exit 1 if any critical check fails. Writes the evidence JSON for the app.
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
IMAGE = "looped-l13-beacon:1.4.0"
CTR = "looped-l13-api"
LABEL = "looped.lab/id"
ARCH = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}
SECRETISH = re.compile(r"(not-a-real-secret|(TOKEN|PASSWORD|SECRET)=\S+|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY)", re.I)
LIST_APP = ("import os\n"
            "for r, ds, fs in os.walk('/app'):\n"
            "    for n in ds + fs:\n"
            "        print(os.path.join(r, n))\n")


def inspect(kind, ref):
    code, out, err = L.docker([kind, "inspect", ref])
    if code != 0:
        return None, err.strip()
    try:
        return json.loads(out)[0], ""
    except (ValueError, IndexError):
        return None, "unparseable inspect output"


def main() -> int:
    args = L.standard_args("L13")
    r = L.Report("L13", "compose")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(WORK, ".variant")) or "").strip() or "variant-a"
    if not args.variant:
        r.seed = variant

    code, engine, err = L.docker(["info", "--format", "{{.Architecture}}"])
    engine_arch = ARCH.get(engine.strip(), engine.strip() or "unknown")
    if code != 0:
        r.check("image-present", False, "Docker is not reachable: " + err.strip()[:200])
        return r.finish(args.out, args.explanation, {"engine": "unreachable"})

    img, why = inspect("image", IMAGE)
    labels = ((img or {}).get("Config") or {}).get("Labels") or {}
    r.check("image-present", bool(img) and labels.get(LABEL) == "L13",
            (f"{IMAGE} id={img['Id'][:19]} label {LABEL}={labels.get(LABEL)}" if img else f"{IMAGE} not found: {why[:160]}"))

    dockerfile = L.read_text(os.path.join(WORK, "Dockerfile")) or ""
    froms = re.findall(r"^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)", dockerfile, re.M | re.I)
    exact = [f for f in froms if re.search(r"@sha256:[0-9a-f]{64}$", f) or re.search(r":\d+\.\d+\.\d+[\w.-]*(@sha256:[0-9a-f]{64})?$", f)]
    r.check("base-pinned", bool(froms) and len(exact) == len(froms) and not any(":latest" in f for f in froms),
            ("FROM " + ", ".join(froms)) if froms else "no FROM line in work/Dockerfile")
    r.check("base-digest", bool(froms) and all("@sha256:" in f for f in froms),
            "digest-pinned" if froms and all("@sha256:" in f for f in froms) else "tag only (a tag can be re-pointed; a digest cannot)", critical=False)

    img_arch = f"{(img or {}).get('Os', '?')}/{(img or {}).get('Architecture', '?')}"
    r.check("architecture", bool(img) and img.get("Architecture") == engine_arch,
            f"image {img_arch}, engine linux/{engine_arch}")

    cfg = (img or {}).get("Config") or {}
    user = str(cfg.get("User") or "")
    r.check("non-root-config", bool(user) and user.split(":")[0] not in ("0", "root"), f"USER={user or '(unset: root)'}")
    ep = cfg.get("Entrypoint") or []
    shell_form = bool(ep) and ep[0] in ("/bin/sh", "sh", "/bin/bash", "bash") and "-c" in ep[:2]
    r.check("exec-entrypoint", bool(ep) and not shell_form, f"Entrypoint={json.dumps(ep)} Cmd={json.dumps(cfg.get('Cmd'))}")
    hc = ((cfg.get("Healthcheck") or {}).get("Test")) or []
    r.check("healthcheck", bool(hc) and hc[0] != "NONE", f"Healthcheck={json.dumps(hc)[:160]}")

    ctr, why = inspect("container", CTR)
    state = (ctr or {}).get("State") or {}
    running = bool(state.get("Running"))
    clabel = (((ctr or {}).get("Config") or {}).get("Labels") or {}).get(LABEL)
    if ctr:
        obs = f"status={state.get('Status')} exit={state.get('ExitCode')} label={clabel}"
        if not running:
            code, logs, lerr = L.docker(["logs", "--tail", "3", CTR])
            obs += " last log: " + ((logs + lerr).strip().splitlines() or [""])[-1][:200]
    else:
        obs = f"{CTR} not found"
    r.check("container-running", running and clabel == "L13", obs)

    if running:
        code, out, err = L.docker(["exec", CTR, "id", "-u"], timeout=15)
        uid = out.strip()
        r.check("runs-as-non-root", code == 0 and uid.isdigit() and uid != "0", f"id -u -> {uid or err.strip()[:120]}")
        code, out, err = L.docker(["exec", CTR, "cat", "/proc/1/cmdline"], timeout=15)
        argv = [a for a in out.split("\0") if a]
        r.check("pid1-is-app", code == 0 and bool(argv) and os.path.basename(argv[0]).startswith("python"), "PID 1: " + (" ".join(argv) or err.strip()[:120]))
        health = ""

        def healthy():
            nonlocal health
            c, o, _ = L.docker(["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", CTR], timeout=10)
            health = o.strip()
            return health in ("healthy", "none", "unhealthy")
        L.wait_until(healthy, timeout_s=40, every_s=2)
        r.check("healthy", health == "healthy", f"health={health}")
    else:
        r.check("runs-as-non-root", False, "container not running; cannot exec")
        r.check("pid1-is-app", False, "container not running")
        r.check("healthy", False, "container not running")

    code, out, _ = L.docker(["port", CTR, "8080/tcp"])
    hostport = out.strip().splitlines()[0] if code == 0 and out.strip() else ""
    rid = "l13-validate-" + str(int(time.time()))
    ok, obs = False, "no published port for 8080/tcp" if not hostport else ""
    if hostport:
        host, port = hostport.rsplit(":", 1)
        host = "127.0.0.1" if host in ("0.0.0.0", "[::]", "::") else host.strip("[]")
        c1, b1, _ = L.http(f"http://{host}:{port}/healthz", headers={"X-Request-Id": rid}, timeout=3)
        c2, b2, _ = L.http(f"http://{host}:{port}/version", timeout=3)
        ver = ""
        try:
            ver = json.loads(b2).get("version", "") if c2 == 200 else ""
        except ValueError:
            pass
        ok = c1 == 200 and ver == "1.4.0"
        obs = f"GET {host}:{port}/healthz -> {c1 or b1[:90]}; /version -> {c2} {ver}"
    r.check("user-path", ok, obs)

    code, logs, lerr = L.docker(["logs", "--since", "10m", CTR])
    seen = rid in logs or rid in lerr
    r.check("logs-visible", seen, f"request {rid} found in docker logs" if seen else f"request {rid} not in docker logs ({len((logs + lerr).splitlines())} lines)")

    leaks = []
    code, hist, _ = L.docker(["history", "--no-trunc", "--format", "{{.CreatedBy}}", IMAGE])
    for line in hist.splitlines():
        if SECRETISH.search(line):
            leaks.append("history: " + SECRETISH.search(line).group(0)[:40])
    for e in cfg.get("Env") or []:
        if SECRETISH.search(e) or re.match(r"[A-Z_]*(TOKEN|PASSWORD|SECRET)=", e):
            leaks.append("env: " + e.split("=", 1)[0])
    if running:
        code, files, err = L.docker(["exec", CTR, "python3", "-c", LIST_APP], timeout=20)
    elif img:
        code, files, err = L.docker(["run", "--rm", "--label", f"{LABEL}=L13", "--entrypoint", "python3", IMAGE, "-c", LIST_APP], timeout=60)
    else:
        code, files, err = 1, "", "no image"
    bad = [f for f in files.splitlines() if re.search(r"(/\.env[^/]*$|\.pem$|\.key$|/\.git(/|$)|/evidence(/|$))", f)]
    leaks += ["file: " + b for b in bad]
    listed = code == 0
    r.check("no-secret-in-image", listed and not leaks,
            ("no secret-shaped history/env and no .env/.pem/.git under /app (" + str(len(files.splitlines())) + " paths listed)") if listed and not leaks
            else ("; ".join(leaks[:4]) if leaks else "could not list /app: " + err.strip()[:160]))

    notes = L.read_text(os.path.join(HERE, "evidence", "L13-notes.md")) or ""
    filled = len(re.sub(r"<!--.*?-->", "", notes, flags=re.S)) > 900 and re.search(r"(amd64|arm64)", notes) is not None
    r.check("notes", filled, "notes filled in with the image record" if filled else "evidence/L13-notes.md still mostly the template (advisory)", critical=False)

    return r.finish(args.out, args.explanation, {"engine_arch": engine_arch, "image_platform": img_arch, "image_id": (img or {}).get("Id", "")[:19], "base": ", ".join(froms)[:200], "variant_file": variant})


if __name__ == "__main__":
    sys.exit(main())
