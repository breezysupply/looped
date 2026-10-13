#!/usr/bin/env python3
"""L25 validator: queries the looped-l25 Compose project, PostgreSQL (logins
over 127.0.0.1:15025 with the stdlib pgmini client), the beacon-report image
and your files under work/. Read-only apart from the evidence JSON; it never
prints or records a credential value (fingerprints only).

Checks (critical unless noted):
  stack-up               db ready; every consumer service in work/compose.yaml running
  old-revoked            the credential exposed in BEACON-SEC-311 is rejected by the server
  new-credential-works   each consumer's current credential logs in, and is not the exposed one
  consumers-writing      each consumer wrote a heartbeat in the last 15 s with its current credential
  no-credential-exposure no credential value in container env/cmd/labels, compose/.env files,
                         container logs, the ticket, your triage/notes/evidence
  secret-files           consumers read credentials from files under work/secrets/ with mode 0600/0400
  least-privilege        consumer roles: no superuser/createrole/createdb/bypassrls, no read of `records`
  triage-complete        every finding in the scan triaged with decision, reason and evidence
  triage-correct         applicable findings are fixed; already-fixed is true; unknown has owner + next
  lock-pinned            every dependency pinned with == and at least one sha256 hash
  patched-image          looped-l25-report:patched built from the current lock; fixes installed
  image-tests            the unit tests pass inside the patched image with networking disabled
  sbom-matches-image     work/patch/sbom.cdx.json is CycloneDX 1.5 and lists exactly what the image has
  notes                  evidence/L25-notes.md has substance (advisory)
"""
import hashlib
import json
import os
import re
import stat
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
sys.path.insert(0, os.path.join(HERE, "assets"))
import labcheck as L  # noqa: E402
import pgmini  # noqa: E402
from sbom import parse_lock, norm  # noqa: E402

WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
PROJECT = "looped-l25"
DB_PORT = 15025
IMAGE = "looped-l25-report:patched"

# what each variant's code and configuration make true (see SOLUTION.md)
EXPECT = {
    "variant-a": {"must_fix": {"CVE-2024-3651"}, "already": {"CVE-2024-34064"}},
    "variant-b": {"must_fix": {"CVE-2024-56201", "CVE-2024-56326", "CVE-2025-27516"}, "already": {"CVE-2024-3651"}},
}
DECISIONS = ("fix", "not-applicable", "already-fixed", "unknown")


def fp(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


def vtuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v)[:4])


def login(user, password):
    """(ok, detail) for a password login over TCP; never includes the password."""
    try:
        c = pgmini.connect(f"host=127.0.0.1 port={DB_PORT} user={user} dbname=beacon sslmode=disable password={password}", connect_timeout=4)
        c.close()
        return True, f"{user}: login succeeded"
    except pgmini.PgError as e:
        return False, f"{user}: rejected ({e.code} {e.message})"
    except (pgmini.PgConnectionError, OSError) as e:
        return None, f"{user}: cannot reach 127.0.0.1:{DB_PORT} ({e})"


def psql(sql):
    return L.sh(["docker", "exec", "-i", "looped-l25-db", "psql", "-X", "-At", "-U", "postgres", "-d", "beacon", "-v", "ON_ERROR_STOP=1", "-c", sql], timeout=20)


def compose_services():
    env = dict(os.environ, EXPORTER_DB_PASSWORD=os.environ.get("EXPORTER_DB_PASSWORD", "unset-for-config"))
    code, out, err = L.sh(["docker", "compose", "-p", PROJECT, "-f", os.path.join(WORK, "compose.yaml"), "--project-directory", WORK, "config", "--format", "json"], timeout=30, env=env)
    if code != 0:
        return None, err.strip()[:200]
    try:
        return json.loads(out).get("services", {}), ""
    except ValueError:
        return None, "compose config is not JSON"


def container_for(service):
    code, out, _ = L.docker(["ps", "-aq", "--filter", f"label=com.docker.compose.project={PROJECT}", "--filter", f"label=com.docker.compose.service={service}"])
    ids = out.split()
    if code != 0 or not ids:
        return None
    code, out, _ = L.docker(["inspect", ids[0]])
    try:
        return json.loads(out)[0]
    except (ValueError, IndexError):
        return None


def consumer_credential(info):
    """(user, password, source, host_path) from a running consumer's config."""
    env = dict(e.split("=", 1) for e in info["Config"].get("Env") or [] if "=" in e)
    user = env.get("BEACON_DB_USER", "beacon_app")
    path = env.get("BEACON_DB_PASSWORD_FILE", "")
    if path:
        for m in info.get("Mounts") or []:
            if m.get("Destination") == path:
                src = m.get("Source", "")
                val = read(src)
                return user, (val or "").strip(), "file", src
        return user, "", "file (mount not found)", ""
    if env.get("BEACON_DB_PASSWORD"):
        return user, env["BEACON_DB_PASSWORD"], "env", ""
    return user, "", "none", ""


def main():
    args = L.standard_args("L25")
    r = L.Report("L25", "compose")
    L.apply_args(r, args)
    variant = (read(os.path.join(WORK, ".variant")) or "variant-a").strip()
    if not args.variant:
        r.seed = variant
    if not os.path.isdir(WORK):
        r.check("stack-up", False, "no work/ directory: run setup.sh first")
        return r.finish(args.out, args.explanation)
    leaked = (read(os.path.join(WORK, ".l25", "leaked.txt")) or "").strip()

    # ── c1: rotation ───────────────────────────────────────────────────
    services, why = compose_services()
    consumers = {}
    if services is None:
        r.check("stack-up", False, f"docker compose config failed: {why}")
    else:
        names = sorted(s for s in services if s != "db")
        state, problems = [], []
        db = container_for("db")
        db_ok = bool(db) and db["State"].get("Running") and L.sh(["docker", "exec", "looped-l25-db", "pg_isready", "-q", "-h", "127.0.0.1", "-U", "postgres", "-d", "beacon"], timeout=10)[0] == 0
        for n in names:
            info = container_for(n)
            if not info or not info["State"].get("Running"):
                problems.append(f"{n} not running")
            else:
                consumers[n] = info
                state.append(f"{n} running")
        r.check("stack-up", bool(db_ok) and not problems and len(names) >= 2,
                f"db {'ready' if db_ok else 'NOT ready'}; consumers: {', '.join(state + problems) or 'none'}")

    if not leaked:
        r.check("old-revoked", False, "work/.l25/leaked.txt missing: the lab's record of the exposed credential is gone; run reset.sh")
    else:
        ok, detail = login("beacon_app", leaked)
        r.check("old-revoked", ok is False, f"exposed credential (fp {fp(leaked)}) as beacon_app: {detail}")

    creds = {}
    works, wdetail = [], []
    for n, info in sorted(consumers.items()):
        user, pw, source, path = consumer_credential(info)
        creds[n] = (user, pw, source, path)
        if not pw:
            works.append(False)
            wdetail.append(f"{n}: no credential found ({source})")
            continue
        ok, detail = login(user, pw)
        same = pw == leaked
        works.append(bool(ok) and not same)
        wdetail.append(f"{n} [{source}, fp {fp(pw)}]: {detail}" + ("; this IS the exposed credential" if same else ""))
    r.check("new-credential-works", bool(works) and all(works), "; ".join(wdetail) or "no running consumers")

    hb_ok, hb_detail = [], []
    for n, (user, pw, source, path) in sorted(creds.items()):
        code, out, err = psql(f"SELECT credential_fp, extract(epoch FROM now() - at)::int FROM heartbeats WHERE consumer = {pgmini.literal(n)} ORDER BY at DESC LIMIT 1")
        row = out.strip().split("|") if code == 0 and out.strip() else []
        if len(row) != 2:
            hb_ok.append(False)
            hb_detail.append(f"{n}: no heartbeat ({err.strip()[:80]})")
            continue
        age, hfp = int(row[1]), row[0]
        good = age <= 15 and pw and hfp == fp(pw) and hfp != fp(leaked or "-")
        hb_ok.append(bool(good))
        hb_detail.append(f"{n}: last heartbeat {age}s ago with fp {hfp}" + ("" if pw and hfp == fp(pw) else " (not its current credential)"))
    r.check("consumers-writing", bool(hb_ok) and all(hb_ok), "; ".join(hb_detail) or "no consumers")

    values = {v for v in [leaked] + [c[1] for c in creds.values()] if v and len(v) >= 12}
    for fname in ("db.txt", "exporter-db.txt", "db-next.txt"):
        v = (read(os.path.join(WORK, "secrets", fname)) or "").strip()
        if len(v) >= 12:
            values.add(v)
    hits = []
    code, out, _ = L.docker(["ps", "-aq", "--filter", f"label=com.docker.compose.project={PROJECT}"])
    for cid in out.split():
        c2, o2, _ = L.docker(["inspect", cid])
        try:
            info = json.loads(o2)[0]
        except (ValueError, IndexError):
            continue
        name = info.get("Name", cid).lstrip("/")
        cfg = info.get("Config") or {}
        blob = json.dumps({"env": cfg.get("Env"), "cmd": cfg.get("Cmd"), "entrypoint": cfg.get("Entrypoint"), "labels": cfg.get("Labels")})
        if any(v in blob for v in values):
            hits.append(f"{name}: container configuration (env/cmd/labels)")
        c3, logs, logs_err = L.docker(["logs", "--tail", "3000", cid], timeout=30)
        if any(v in logs + logs_err for v in values):
            hits.append(f"{name}: container logs")
    files = [os.path.join(WORK, "compose.yaml"), os.path.join(WORK, ".env"), os.path.join(WORK, "TICKET.md"),
             os.path.join(WORK, "patch", "triage.json")]
    if os.path.isdir(EV):
        files += [os.path.join(EV, f) for f in os.listdir(EV) if os.path.isfile(os.path.join(EV, f)) and os.path.abspath(os.path.join(EV, f)) != os.path.abspath(args.out)]
    for f in files:
        t = read(f)
        if t and any(v in t for v in values):
            hits.append(os.path.relpath(f, HERE))
    if args.explanation and any(v in args.explanation for v in values):
        hits.append("your --explanation text")
    r.check("no-credential-exposure", not hits and bool(values),
            f"searched {len(values)} credential values in container config/logs and {len(files)} files: " + ("; ".join(hits) if hits else "none found"))

    sf_ok, sf_detail = [], []
    sec_dir = os.path.realpath(os.path.join(WORK, "secrets"))
    for n, (user, pw, source, path) in sorted(creds.items()):
        if source != "file" or not path:
            sf_ok.append(False)
            sf_detail.append(f"{n}: credential from {source}, not a mounted file")
            continue
        try:
            mode = stat.S_IMODE(os.stat(path).st_mode)
        except OSError as e:
            sf_ok.append(False)
            sf_detail.append(f"{n}: {e}")
            continue
        inside = os.path.realpath(path).startswith(sec_dir + os.sep)
        good = inside and mode & 0o077 == 0
        sf_ok.append(good)
        sf_detail.append(f"{n}: {os.path.relpath(path, HERE) if inside else path} mode {oct(mode)}")
    r.check("secret-files", bool(sf_ok) and all(sf_ok), "; ".join(sf_detail) or "no consumers")

    lp_ok, lp_detail = [], []
    for user in sorted({c[0] for c in creds.values()}):
        if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", user):
            lp_ok.append(False)
            lp_detail.append(f"{user}: unexpected role name")
            continue
        code, out, err = psql(
            "SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, "
            "pg_has_role(rolname, 'pg_read_all_data', 'MEMBER'), pg_has_role(rolname, 'pg_write_all_data', 'MEMBER'), "
            f"has_table_privilege(rolname, 'public.records', 'SELECT') FROM pg_roles WHERE rolname = {pgmini.literal(user)}")
        flags = out.strip().split("|") if code == 0 and out.strip() else []
        if len(flags) != 7:
            lp_ok.append(False)
            lp_detail.append(f"{user}: role not found ({err.strip()[:80]})")
            continue
        bad = [n for n, f in zip(("superuser", "createrole", "createdb", "bypassrls", "pg_read_all_data", "pg_write_all_data", "SELECT on records"), flags) if f == "t"]
        lp_ok.append(not bad)
        lp_detail.append(f"{user}: " + (", ".join(bad) if bad else "no elevated attributes, no access to records"))
    r.check("least-privilege", bool(lp_ok) and all(lp_ok), "; ".join(lp_detail) or "no consumer roles")

    # ── c2: triage, patch, SBOM ────────────────────────────────────────
    report = None
    try:
        with open(os.path.join(WORK, "patch", "vuln-report.json"), "r", encoding="utf-8") as fh:
            report = json.load(fh)
    except (OSError, ValueError) as e:
        r.check("triage-complete", False, f"cannot read work/patch/vuln-report.json: {e}")
    findings = {}
    if report:
        for dep in report.get("dependencies", []):
            for v in dep.get("vulns", []):
                findings[v["id"]] = {"package": norm(dep["name"]), "fix": v.get("fix_versions") or []}
    triage = {}
    try:
        with open(os.path.join(WORK, "patch", "triage.json"), "r", encoding="utf-8") as fh:
            tj = json.load(fh)
        for t in tj.get("findings", []):
            if isinstance(t, dict) and t.get("id"):
                triage[str(t["id"])] = t
    except (OSError, ValueError) as e:
        tj = None
        if report:
            r.check("triage-complete", False, f"work/patch/triage.json is missing or not JSON: {e}")
    if report and tj is not None:
        problems = []
        for fid in sorted(findings):
            t = triage.get(fid)
            if not t:
                problems.append(f"{fid}: not triaged")
                continue
            d = str(t.get("decision", "")).strip()
            if d not in DECISIONS:
                problems.append(f"{fid}: decision '{d}' is not one of {'/'.join(DECISIONS)}")
            if len(str(t.get("reason", "")).strip()) < 40:
                problems.append(f"{fid}: reason under 40 characters")
            if len(str(t.get("evidence", "")).strip()) < 10:
                problems.append(f"{fid}: no evidence named")
            if d == "unknown" and (len(str(t.get("owner", "")).strip()) < 2 or len(str(t.get("next", "")).strip()) < 10):
                problems.append(f"{fid}: unknown needs an owner and a next step")
        r.check("triage-complete", not problems, f"{len(findings)} findings, {len([f for f in findings if f in triage])} triaged" + ("; " + "; ".join(problems[:6]) if problems else ""))

    lock_path = os.path.join(WORK, "patch", "report", "requirements.txt")
    lock_raw = b""
    pins = []
    try:
        with open(lock_path, "rb") as fh:
            lock_raw = fh.read()
        pins = parse_lock(lock_raw.decode("utf-8"))
        unhashed = [n for n, v, h in pins if not h]
        r.check("lock-pinned", bool(pins) and not unhashed, f"{len(pins)} exact pins: " + ", ".join(f"{n}=={v}" for n, v, h in pins) + (f"; without hashes: {', '.join(unhashed)}" if unhashed else ""))
    except (OSError, ValueError) as e:
        r.check("lock-pinned", False, f"work/patch/report/requirements.txt: {e}")
    lock_sha = hashlib.sha256(lock_raw).hexdigest() if lock_raw else ""

    installed = {}
    code, out, _ = L.docker(["image", "inspect", IMAGE])
    img = None
    if code == 0:
        try:
            img = json.loads(out)[0]
        except (ValueError, IndexError):
            img = None
    if img:
        c2, o2, e2 = L.docker(["run", "--rm", "--network", "none", "--entrypoint", "python3", IMAGE, "-c",
                               "import importlib.metadata as m, json; print(json.dumps({d.metadata['Name']: d.version for d in m.distributions()}))"], timeout=60)
        try:
            installed = {norm(k): v for k, v in json.loads(o2.strip().splitlines()[-1]).items() if norm(k) != "pip"}
        except (ValueError, IndexError):
            installed = {}
    must_fix = EXPECT.get(variant, EXPECT["variant-a"])["must_fix"]
    already = EXPECT.get(variant, EXPECT["variant-a"])["already"]
    if not img:
        r.check("patched-image", False, f"image {IMAGE} not found: build it with assets/build-report.sh patched")
    else:
        label = (img.get("Config", {}).get("Labels") or {}).get("looped.lab/requirements-sha256", "")
        need = {fid for fid, t in triage.items() if str(t.get("decision")) == "fix" and fid in findings} | (must_fix & set(findings))
        unfixed = []
        for fid in sorted(need):
            f = findings[fid]
            have = installed.get(f["package"])
            if f["package"] == "beacon-report":
                continue  # first-party finding: no package version to compare
            if not f["fix"] or not have or vtuple(have) < min(vtuple(x) for x in f["fix"]):
                unfixed.append(f"{fid} ({f['package']} {have or 'absent'} < {','.join(f['fix']) or 'no fix'})")
        same_lock = bool(lock_sha) and label == lock_sha
        r.check("patched-image", same_lock and not unfixed,
                f"{IMAGE}: built from {'the current lock' if same_lock else 'a DIFFERENT lock (label ' + label[:12] + ', lock ' + lock_sha[:12] + ')'}; installed "
                + ", ".join(f"{k}=={v}" for k, v in sorted(installed.items())) + ("; still vulnerable: " + "; ".join(unfixed) if unfixed else ""))

    if report and tj is not None:
        wrong = []
        for fid in sorted(findings):
            d = str((triage.get(fid) or {}).get("decision", ""))
            pkg, fix = findings[fid]["package"], findings[fid]["fix"]
            if fid in must_fix and d != "fix":
                wrong.append(f"{fid}: '{d}' but the vulnerable code path is reachable in this build")
            if d == "already-fixed":
                have = installed.get(pkg) or dict((n, v) for n, v, h in pins).get(pkg)
                if not fix or not have or vtuple(have) < min(vtuple(x) for x in fix):
                    wrong.append(f"{fid}: 'already-fixed' but {pkg} {have or 'absent'} is below {','.join(fix) or 'any fix'}")
            if fid in already and d not in ("already-fixed", "fix"):
                wrong.append(f"{fid}: '{d}' although the shipped version already contains the fix")
        r.check("triage-correct", not wrong, "decisions consistent with code, config and versions" if not wrong else "; ".join(wrong[:5]))

    if img:
        c3, o3, e3 = L.docker(["run", "--rm", "--network", "none", "--entrypoint", "python3", IMAGE, "-m", "unittest", "discover", "-s", "tests", "-t", "."], timeout=120)
        tail = (o3 + e3).strip().splitlines()
        ran = [ln for ln in tail if ln.startswith("Ran ")]
        r.check("image-tests", c3 == 0 and bool(ran), (ran[0] if ran else "no test run") + " — " + (tail[-1] if tail else "no output"))
    else:
        r.check("image-tests", False, f"image {IMAGE} not found")

    sb_path = os.path.join(WORK, "patch", "sbom.cdx.json")
    try:
        with open(sb_path, "r", encoding="utf-8") as fh:
            sb = json.load(fh)
        comps = {norm(c.get("name", "")): c.get("version", "") for c in sb.get("components", []) if c.get("type") == "library"}
        props = {p.get("name"): p.get("value") for p in (sb.get("metadata", {}).get("properties") or [])}
        purls_ok = all(c.get("purl") == f"pkg:pypi/{norm(c.get('name', ''))}@{c.get('version')}" for c in sb.get("components", []) if c.get("type") == "library")
        fmt_ok = sb.get("bomFormat") == "CycloneDX" and sb.get("specVersion") == "1.5" and purls_ok
        diff = sorted(set(comps.items()) ^ set(installed.items()))
        lock_match = props.get("looped:lock-sha256") == lock_sha
        r.check("sbom-matches-image", fmt_ok and bool(installed) and not diff and lock_match,
                f"CycloneDX {sb.get('specVersion')}, {len(comps)} components; "
                + ("matches the image" if not diff else "differs from the image: " + ", ".join(f"{n}=={v}" for n, v in diff[:6]))
                + ("" if lock_match else "; generated from a different lock than the current one"))
    except (OSError, ValueError) as e:
        r.check("sbom-matches-image", False, f"work/patch/sbom.cdx.json: {e}")

    notes = read(os.path.join(EV, "L25-notes.md")) or ""
    secs = [s for s in ("## Rotation plan", "## What happened", "## Revocation proof", "## Triage summary", "## Patch and SBOM") if s in notes]
    body = re.sub(r"(?m)^#.*$", "", notes)
    tmpl = re.sub(r"(?m)^#.*$", "", read(os.path.join(HERE, "assets", "notes-template.md")) or "")
    own = len(body.strip()) - len(tmpl.strip())
    r.check("notes", len(secs) == 5 and own > 600, f"{len(secs)}/5 sections, {max(0, own)} chars beyond the template", critical=False)

    return r.finish(args.out, args.explanation, {"variant_file": variant, "compose_project": PROJECT})


if __name__ == "__main__":
    sys.exit(main())
