#!/usr/bin/env python3
"""L02 validator: reads the exercise repository with real `git`, parses the
committed configuration with Beacon's own parser and `json`, and starts Beacon
from the committed config to check behaviour.

Checks (critical unless noted):
  repo-state           on main, no merge in progress, no unmerged paths, clean tree
  branch-merged        the original ticket-142 commit is an ancestor of main
  history-kept         baseline, the release/ops change and the behaviour-changing commit are all still in main's history
  no-conflict-markers  no <<<<<<< ======= >>>>>>> lines in any tracked file at HEAD
  config-valid         HEAD:config/beacon.yaml passes Beacon's parser + semantic validation; HEAD:deploy/service.json is valid JSON
  both-changes         main's intended change and the ticket's intended change are both present
  ports-agree          server.port in the YAML equals listen_port in service.json
  reverted             a revert commit names the behaviour-changing commit and its effect is gone at HEAD
  focused-diff         net change since the last good main commit touches only config/beacon.yaml and deploy/service.json
  behaviour            Beacon started from the committed config answers the deploy health check with the expected version
  notes                evidence/L02-notes.md filled in (advisory)
Exit 1 if any critical check fails.
"""
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

sys.path.insert(0, os.path.join(L.ROOT, "beacon"))
from beacon import config as beacon_config  # noqa: E402

LAB = "/opt/beacon-l02"
REPO = os.path.join(LAB, "repo")
EV = os.path.join(HERE, "evidence")


def git(*args, timeout=30.0):
    return L.sh(["git", "-C", REPO, "-c", "safe.directory=" + REPO] + list(args), timeout=timeout)


def state(name):
    return (L.read_text(os.path.join(LAB, ".lab", name)) or "").strip()


def is_ancestor(sha, ref="HEAD"):
    if not sha:
        return False
    code, _, _ = git("merge-base", "--is-ancestor", sha, ref)
    return code == 0


def show(path):
    code, out, err = git("show", "HEAD:" + path)
    return out if code == 0 else None


def main() -> int:
    args = L.standard_args("L02")
    r = L.Report("L02", "linux-arm64")
    L.apply_args(r, args)
    variant = state("variant") or "variant-a"
    if not args.variant:
        r.seed = variant

    if not os.path.isdir(os.path.join(REPO, ".git")):
        r.check("repo-state", False, f"{REPO} is not a git repository; run setup.sh")
        return r.finish(args.out, args.explanation)

    _, branch, _ = git("rev-parse", "--abbrev-ref", "HEAD")
    branch = branch.strip()
    merging = os.path.exists(os.path.join(REPO, ".git", "MERGE_HEAD")) or os.path.exists(os.path.join(REPO, ".git", "REVERT_HEAD")) or os.path.isdir(os.path.join(REPO, ".git", "rebase-merge"))
    _, unmerged, _ = git("diff", "--name-only", "--diff-filter=U")
    _, porcelain, _ = git("status", "--porcelain", "--untracked-files=no")
    clean = not porcelain.strip()
    r.check("repo-state", branch == "main" and not merging and not unmerged.strip() and clean,
            f"branch={branch} operation-in-progress={merging} unmerged={unmerged.split() or 'none'} uncommitted={porcelain.split()[:6] or 'none'}")

    ticket, base, change_a, bad = state("ticket.sha"), state("base.sha"), state("change-a.sha"), state("bad.sha")
    r.check("branch-merged", is_ancestor(ticket),
            f"ticket-142 commit {ticket[:10]} {'is' if is_ancestor(ticket) else 'is NOT'} in main's history")
    kept = {"baseline": is_ancestor(base), "intended change on main": is_ancestor(change_a), "maintenance commit": is_ancestor(bad)}
    r.check("history-kept", all(kept.values()),
            "all original main commits still reachable" if all(kept.values()) else "rewritten or dropped: " + ", ".join(k for k, v in kept.items() if not v) + " (undo shared history with revert, not reset)")

    _, files, _ = git("ls-files")
    marked = []
    for f in files.split():
        body = show(f) or ""
        if re.search(r"^(<{7}|={7}|>{7})( |$)", body, re.M):
            marked.append(f)
    r.check("no-conflict-markers", not marked, "no conflict markers at HEAD" if not marked else "conflict markers committed in: " + ", ".join(marked))

    yaml_text = show("config/beacon.yaml")
    json_text = show("deploy/service.json")
    cfg, svc, problems = None, None, []
    if yaml_text is None:
        problems.append("config/beacon.yaml missing at HEAD")
    else:
        try:
            cfg = beacon_config.parse_yaml_subset(yaml_text)
            problems += beacon_config.validate(beacon_config._merge(beacon_config.DEFAULTS, cfg))
        except beacon_config.ConfigError as e:
            problems.append("config/beacon.yaml:" + str(e))
            cfg = None
    if json_text is None:
        problems.append("deploy/service.json missing at HEAD")
    else:
        try:
            svc = json.loads(json_text)
        except ValueError as e:
            problems.append("deploy/service.json: " + str(e))
    r.check("config-valid", not problems, "Beacon parser and json accept both files" if not problems else "; ".join(problems))

    srv = (cfg or {}).get("server", {}) if isinstance((cfg or {}).get("server"), dict) else {}
    app = (cfg or {}).get("app", {}) if isinstance((cfg or {}).get("app"), dict) else {}
    svc = svc if isinstance(svc, dict) else {}
    ticket_kept = app.get("environment") == "staging-lab" and srv.get("request_timeout_s") == 15
    if variant == "variant-a":
        main_kept = app.get("version") == "1.4.1" and svc.get("expect_version") == "1.4.1"
        main_desc = f"version={app.get('version')!r} expect_version={svc.get('expect_version')!r}"
    else:
        main_kept = srv.get("port") == 8081 and svc.get("listen_port") == 8081
        main_desc = f"port={srv.get('port')!r} listen_port={svc.get('listen_port')!r}"
    r.check("both-changes", main_kept and ticket_kept,
            f"main's change: {main_desc} ({'kept' if main_kept else 'lost'}); ticket-142: environment={app.get('environment')!r} server.request_timeout_s={srv.get('request_timeout_s')!r} ({'kept' if ticket_kept else 'lost or misplaced'})")
    r.check("ports-agree", srv.get("port") is not None and srv.get("port") == svc.get("listen_port"),
            f"config server.port={srv.get('port')!r} deploy listen_port={svc.get('listen_port')!r}")

    _, log, _ = git("log", "--format=%H%x09%B%x1e", (bad + "..HEAD") if bad else "HEAD")
    revert_msgs = [c for c in log.split("\x1e") if bad and re.search(r"[Rr]everts? commit " + bad[:7], c)]
    inj = (cfg or {}).get("inject", {}) if isinstance((cfg or {}).get("inject"), dict) else {}
    effect_gone = inj.get("ready_fail") in (False, None)
    r.check("reverted", bool(revert_msgs) and effect_gone,
            f"revert commit naming {bad[:10]}: {'found' if revert_msgs else 'none'}; inject.ready_fail at HEAD={inj.get('ready_fail')!r}")

    # net change relative to the last good main commit: only the ticket's config edits
    _, changed, _ = git("diff", "--name-only", change_a + "..HEAD") if change_a else (1, "", "")
    extra = [f for f in changed.split() if f not in ("config/beacon.yaml", "deploy/service.json")]
    r.check("focused-diff", bool(changed.strip()) and not extra,
            "net change since the last good main commit: " + (", ".join(changed.split()) or "nothing") + ("" if not extra else "; unrelated files touched: " + ", ".join(extra)))

    # behaviour: start Beacon from the committed config, probe what deploy/service.json expects
    ok, obs = False, "not attempted (config invalid)"
    port = svc.get("listen_port")
    if yaml_text is not None and cfg is not None and isinstance(port, int):
        busy, why = L.tcp_open("127.0.0.1", port, timeout=0.5)
        if busy:
            obs = f"port {port} already in use before the check ({why}); stop whatever is listening and re-run"
        else:
            fd, tmp = tempfile.mkstemp(prefix="looped-l02-", suffix=".yaml")
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(yaml_text)
            env = dict(os.environ, PYTHONPATH=os.path.join(L.ROOT, "beacon"))
            proc = subprocess.Popen([sys.executable, "-m", "beacon", "api", "--config", tmp], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env, start_new_session=True)
            try:
                health = svc.get("health", {}) if isinstance(svc.get("health"), dict) else {}
                path, want = health.get("path", "/ready"), health.get("expect_status", 200)
                deadline = time.time() + 8
                code = 0
                while time.time() < deadline:
                    if proc.poll() is not None:
                        out = proc.stdout.read() if proc.stdout else ""
                        obs = f"Beacon exited {proc.returncode}: {out.strip()[-240:]}"
                        break
                    code, body, _ = L.http(f"http://127.0.0.1:{port}{path}", timeout=1)
                    if code:
                        vcode, vbody, _ = L.http(f"http://127.0.0.1:{port}/version", timeout=1)
                        try:
                            ver = json.loads(vbody).get("version")
                        except ValueError:
                            ver = None
                        ok = code == want and ver == svc.get("expect_version")
                        obs = f"GET {path} on :{port} -> {code} (deploy expects {want}); /version={ver!r} (deploy expects {svc.get('expect_version')!r})"
                        break
                    time.sleep(0.3)
                else:
                    obs = f"nothing answered on :{port} within 8s (Beacon listens on {srv.get('port')!r})"
            finally:
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                    proc.wait(timeout=5)
                except Exception:  # noqa: BLE001
                    pass
                os.unlink(tmp)
    r.check("behaviour", ok, obs)

    notes = L.read_text(os.path.join(EV, "L02-notes.md")) or ""
    filled = len(re.sub(r"<!--.*?-->", "", notes, flags=re.S)) > 400 and "revert" in notes.lower()
    r.check("notes", filled, f"evidence/L02-notes.md: {len(notes)} chars" + ("" if filled else " — fill in the template, including the revert"), critical=False)

    return r.finish(args.out, args.explanation, {"lab_root": LAB, "variant_file": variant})


if __name__ == "__main__":
    sys.exit(main())
