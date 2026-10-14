#!/usr/bin/env python3
"""L12 validator: queries the two Terraform roots under work/envs/ and your
local Docker engine. Read-only: plans without -out, docker inspect/exec,
HTTP GETs on 127.0.0.1. Touches only looped-l12-* objects.

Checks (all critical):
  scope              every Docker object labelled looped.lab/id=L12 is named looped-l12-*
  states-separate    envs/dev and envs/staging each have a local terraform.tfstate (different lineage), no backend block
  lockfile-pinned    both roots pin kreuzwerker/docker 4.6.0 through the committed lockfile
  module-extracted   modules/beacon declares the container, volume and network; both roots call it;
                     both states hold module.* addresses for them
  data-protected     the module's data volume has lifecycle { prevent_destroy = true }
  no-change-dev      terraform plan -detailed-exitcode exits 0 in envs/dev
  no-change-staging  terraform plan -detailed-exitcode exits 0 in envs/staging
  no-orphans         every looped-l12-* container is running and tracked by one of the two states
  user-path          dev and staging APIs answer /healthz with 200 on their published loopback ports
  data-preserved     the seed record written at setup is still served by the dev API
  volume-kept        looped-l12-dev-data was never replaced (same creation time as at setup)
  variant-outcome    variant-specific result (drift resolved / spool imported / approved change applied)
  plan-notes         evidence/L12-plan-notes.md has the five sections with substance and names a replacement
Exit 1 if any check fails. Writes the evidence JSON.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
ENVS = {"dev": os.path.join(WORK, "envs", "dev"), "staging": os.path.join(WORK, "envs", "staging")}
MODULE = os.path.join(WORK, "modules", "beacon")
PREFIX = "looped-l12-"
REMOTE = re.compile(r'backend\s+"(s3|azurerm|gcs|remote|http|consul|pg|kubernetes|oss|cos)"|^\s*cloud\s*\{', re.M)


def tf_env():
    env = dict(os.environ, TF_IN_AUTOMATION="1", TF_INPUT="0", NO_COLOR="1")
    if not env.get("DOCKER_HOST"):
        c, o, _ = L.docker(["context", "inspect", "-f", "{{.Endpoints.docker.Host}}"])
        if c == 0 and o.strip():
            env["DOCKER_HOST"] = o.strip()
    return env


ENV = tf_env()


def tf(root, *args, timeout=240):
    return L.sh(["terraform", "-chdir=" + root] + list(args), timeout=timeout, env=ENV)


def read_tf(d):
    src = ""
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            if f.endswith(".tf"):
                src += (L.read_text(os.path.join(d, f)) or "") + "\n"
    return src


def blocks(src, rtype):
    """Bodies of every `resource "<rtype>" "<name>" { ... }` (brace-matched, comments stripped)."""
    src = re.sub(r"#[^\n]*|//[^\n]*", "", src)
    out = []
    for m in re.finditer(r'resource\s+"%s"\s+"[^"]+"\s*\{' % re.escape(rtype), src):
        depth, i = 1, m.end()
        while i < len(src) and depth:
            depth += {"{": 1, "}": -1}.get(src[i], 0)
            i += 1
        out.append(src[m.end():i - 1])
    return out


def state_of(root):
    try:
        with open(os.path.join(root, "terraform.tfstate"), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def resources(state):
    """[(address, type, attributes)] from a state file (managed resources only)."""
    out = []
    for r in (state or {}).get("resources", []):
        if r.get("mode") != "managed":
            continue
        base = (r.get("module", "") + "." if r.get("module") else "") + r["type"] + "." + r["name"]
        for inst in r.get("instances", []):
            key = inst.get("index_key")
            addr = base + (f"[{json.dumps(key)}]" if key is not None else "")
            out.append((addr, r["type"], inst.get("attributes", {})))
    return out


def inspect(kind, name):
    args = {"container": ["container", "inspect", name], "volume": ["volume", "inspect", name], "network": ["network", "inspect", name]}[kind]
    c, o, _ = L.docker(args)
    if c != 0:
        return None
    try:
        return json.loads(o)[0]
    except (ValueError, IndexError):
        return None


def host_port(info):
    try:
        b = info["NetworkSettings"]["Ports"]["8080/tcp"][0]
        return b["HostIp"], int(b["HostPort"])
    except (KeyError, TypeError, IndexError, ValueError):
        return None, None


def names(kind):
    fmt = {"container": ["ps", "-a", "--format", "{{.Names}}"], "volume": ["volume", "ls", "--format", "{{.Name}}"], "network": ["network", "ls", "--format", "{{.Name}}"]}[kind]
    c, o, _ = L.docker(fmt)
    return [n for n in o.split() if n.startswith(PREFIX)] if c == 0 else []


def plan_clean(root):
    code, out, err = tf(root, "plan", "-detailed-exitcode", "-input=false", "-no-color")
    if code == 0:
        return True, "No changes"
    acts = re.findall(r"#\s+(\S+)\s+(will be created|will be destroyed|must be replaced|will be updated in-place|will be read during apply)", out)
    moved = len(re.findall(r"has moved to", out))
    tail = (out + err).strip().splitlines()
    obs = f"exit {code}: " + ("; ".join(f"{a} {b}" for a, b in acts[:5]) if acts else (tail[-1][:200] if tail else "no output"))
    if moved:
        obs += f" (+{moved} pending moves)"
    return False, obs


def main():
    args = L.standard_args("L12")
    r = L.Report("L12", "compose")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(WORK, ".variant")) or "").strip() or "unknown"
    if not args.variant:
        r.seed = variant
    base, inj = {}, {}
    for fn, target in ((".l12-baseline.json", base), (".l12-inject.json", inj)):
        try:
            with open(os.path.join(WORK, fn), "r", encoding="utf-8") as fh:
                target.update(json.load(fh))
        except (OSError, ValueError):
            pass

    c, o, e = L.docker(["info", "--format", "{{.ServerVersion}}"])
    server = o.strip()
    if c != 0 or not os.path.isdir(WORK):
        r.check("scope", False, "Docker unreachable or work/ missing: " + (e.strip() or "run setup.sh")[:200])
        return r.finish(args.out, args.explanation)

    c, o, _ = L.docker(["ps", "-a", "--filter", "label=looped.lab/id=L12", "--format", "{{.Names}}"])
    c2, o2, _ = L.docker(["volume", "ls", "--filter", "label=looped.lab/id=L12", "--format", "{{.Name}}"])
    labelled = o.split() + o2.split()
    stray = [n for n in labelled if not n.startswith(PREFIX)]
    r.check("scope", not stray, f"{len(labelled)} labelled L12 objects, all looped-l12-*" if not stray else "labelled L12 but not named looped-l12-*: " + ", ".join(stray))

    states = {k: state_of(v) for k, v in ENVS.items()}
    srcs = {k: read_tf(v) for k, v in ENVS.items()}
    problems = []
    for k in ENVS:
        if not states[k]:
            problems.append(f"no envs/{k}/terraform.tfstate")
        if REMOTE.search(srcs[k]):
            problems.append(f"envs/{k} declares a remote backend")
    if states["dev"] and states["staging"] and states["dev"].get("lineage") == states["staging"].get("lineage"):
        problems.append("dev and staging share a state lineage (copied state?)")
    r.check("states-separate", not problems, "two local states with different lineage" if not problems else "; ".join(problems))

    locks = {}
    for k, d in ENVS.items():
        t = L.read_text(os.path.join(d, ".terraform.lock.hcl")) or ""
        locks[k] = 'kreuzwerker/docker" {\n  version     = "4.6.0"' in t
    r.check("lockfile-pinned", all(locks.values()), ", ".join(f"{k}: {'docker 4.6.0' if v else 'missing/unpinned'}" for k, v in locks.items()))

    msrc = read_tf(MODULE)
    m_has = all(re.search(r'resource\s+"%s"' % t, msrc) for t in ("docker_container", "docker_volume", "docker_network"))
    calls = {k: bool(re.search(r'source\s*=\s*"\.\./\.\./modules/beacon"', srcs[k])) for k in ENVS}
    in_module = {}
    for k in ENVS:
        types = {t for a, t, _ in resources(states[k]) if a.startswith("module.")}
        in_module[k] = {"docker_container", "docker_volume", "docker_network"} <= types
    ok_mod = m_has and all(calls.values()) and all(in_module.values())
    r.check("module-extracted", ok_mod, f"module declares container/volume/network: {m_has}; roots call it: {calls}; state uses module addresses: {in_module}")

    prot = any(re.search(r"lifecycle\s*\{[^}]*prevent_destroy\s*=\s*true", body) for body in blocks(msrc, "docker_volume"))
    r.check("data-protected", bool(prot), "module's docker_volume has prevent_destroy = true" if prot else "no lifecycle { prevent_destroy = true } on the module's docker_volume")

    for k in ("dev", "staging"):
        if states[k]:
            ok, obs = plan_clean(ENVS[k])
        else:
            ok, obs = False, "no state"
        r.check(f"no-change-{k}", ok, obs)

    tracked = set()
    for k in ENVS:
        for a, t, attrs in resources(states[k]):
            if t == "docker_container":
                tracked.add(attrs.get("id"))
    orphans, stopped = [], []
    for n in names("container"):
        info = inspect("container", n)
        if not info:
            continue
        if info["Id"] not in tracked:
            orphans.append(n)
        if not info["State"].get("Running"):
            stopped.append(n)
    r.check("no-orphans", not orphans and not stopped, "every looped-l12-* container is running and in a state" if not (orphans or stopped) else f"not in any state: {orphans}; not running: {stopped}")

    path_obs, path_ok, dev_port = [], True, None
    for k in ("dev", "staging"):
        info = inspect("container", f"{PREFIX}{k}-api")
        ip, port = host_port(info) if info else (None, None)
        if k == "dev":
            dev_port = port
        if not port:
            path_ok = False
            path_obs.append(f"{k}: no published 8080")
            continue
        code, body, _ = L.http(f"http://127.0.0.1:{port}/healthz", timeout=3)
        path_ok &= code == 200 and ip == "127.0.0.1"
        path_obs.append(f"{k}: {ip}:{port} /healthz {code}")
    r.check("user-path", path_ok, "; ".join(path_obs))

    seed_ok, seed_obs = False, "no dev port"
    if dev_port:
        code, body, _ = L.http(f"http://127.0.0.1:{dev_port}/status/l12-seed", timeout=3)
        try:
            recs = json.loads(body)
            recs = recs.get("records", recs) if isinstance(recs, dict) else recs
            ids = [x.get("id") for x in recs] if isinstance(recs, list) else []
        except ValueError:
            ids = []
        seed_ok = base.get("seed_id") in ids
        seed_obs = f"GET /status/l12-seed {code}: seed {base.get('seed_id', '?')[:12]} " + ("present" if seed_ok else f"missing (found {len(ids)} record(s))")
    r.check("data-preserved", seed_ok, seed_obs)

    vol = inspect("volume", f"{PREFIX}dev-data")
    created = vol.get("CreatedAt") if vol else None
    r.check("volume-kept", bool(created) and created == base.get("data_volume_created"),
            f"looped-l12-dev-data created {created or 'missing'} (baseline {base.get('data_volume_created', '?')})")

    v_ok, v_obs = False, f"unknown variant {variant}"
    dev_res = resources(states["dev"])
    if variant == "variant-a":
        info = inspect("container", f"{PREFIX}dev-api")
        st_ids = {attrs.get("id") for a, t, attrs in dev_res if t == "docker_container" and attrs.get("name") == f"{PREFIX}dev-api"}
        origin = ((info or {}).get("Config", {}).get("Labels") or {}).get("looped.lab/origin")
        v_ok = bool(info) and info["Id"] in st_ids and dev_port == 18412
        v_obs = f"dev api in state: {bool(info) and info['Id'] in st_ids}; published port {dev_port} (declared 18412); origin label {origin or 'none'}"
    elif variant == "variant-b":
        spool = inspect("volume", f"{PREFIX}dev-spool")
        in_state = any(t == "docker_volume" and attrs.get("name") == f"{PREFIX}dev-spool" for a, t, attrs in dev_res)
        worker_in_state = any(t == "docker_container" and attrs.get("name") == f"{PREFIX}dev-worker" for a, t, attrs in dev_res)
        c, o, _ = L.docker(["exec", f"{PREFIX}dev-worker", "cat", "/spool/.l12-marker"])
        marker_ok = c == 0 and o.strip() == inj.get("marker")
        same = bool(spool) and spool.get("CreatedAt") == inj.get("spool_created")
        v_ok = same and in_state and worker_in_state and marker_ok
        v_obs = f"spool volume same as before: {same}; spool in dev state: {in_state}; worker in dev state: {worker_in_state}; marker readable in worker: {marker_ok}"
    elif variant == "variant-c":
        v_ok = dev_port == 18422
        v_obs = f"dev API published on {dev_port} (change request: 18422)"
    r.check("variant-outcome", v_ok, v_obs)

    notes = L.read_text(os.path.join(EV, "L12-plan-notes.md")) or ""
    heads = {h: bool(re.search(r"^#+\s*" + h, notes, re.I | re.M)) for h in ("Prediction", "Drift", "Import", "Replacement", "Module")}
    body = re.sub(r"^#.*$|^>.*$", "", notes, flags=re.M).strip()
    names_replace = bool(re.search(r"replace", body, re.I))
    r.check("plan-notes", all(heads.values()) and len(body) >= 600 and names_replace, f"sections={heads} chars={len(body)} mentions replacement={names_replace}")

    return r.finish(args.out, args.explanation or notes[:4000], {"variant_file": variant, "docker_server": server, "docker_host": ENV.get("DOCKER_HOST", "default")})


if __name__ == "__main__":
    sys.exit(main())
