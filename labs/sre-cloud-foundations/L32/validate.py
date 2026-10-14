#!/usr/bin/env python3
"""L32 validator: the final assessment. It re-checks the seeded draw, reads the evidence the
drawn labs' own validators wrote, checks your recovery of the combined incident on the live L31
rebuild, and checks the structure of your report, defence, rubric, Python change and Terraform
plan reading.

Checks (all critical):
  draw              report/draw.json reproduces from its seed and recorded exclusions; the two
                    single faults were not in your evidence when drawn
  single-1/2        report/evidence/<fault>.json from that lab's validate.py: right lab and
                    variant, every check passed, written after the draw, assistance independent
  service, data, least-privilege, release, scoped-cleanup-cluster
                    the combined incident on your L31 rebuild, checked live (assets/incident.py)
  scoped-cleanup-local   no container labelled for a drawn lab still running
  report-structure, diagnosis-evidence, design-defense, rubric, python-change, terraform-plan,
  sanitised-honest  assets/reportcheck.py
Without a reachable cluster the live checks FAIL with the reason. Exit 1 if any check fails.
"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

sys.path.insert(0, os.path.join(HERE, "assets"))
import draw as D  # noqa: E402
import reportcheck as RC  # noqa: E402

REPORT = os.path.join(HERE, "report")


def main():
    args = L.standard_args("L32")
    r = L.Report("L32", "kind-basic")
    L.apply_args(r, args)
    rec = json.loads(L.read_text(os.path.join(REPORT, "draw.json")) or "{}")
    if not args.variant:
        r.seed = str(rec.get("seed") or "no-draw")

    if not rec:
        r.check("draw", False, "no report/draw.json (run setup.sh)")
    else:
        try:
            again = D.draw(str(rec.get("seed")), rec.get("excluded", []))
            same = again["singles"] == rec.get("singles") and again["incident"] == rec.get("incident")
        except SystemExit as e:
            same, again = False, {"error": str(e)}
        sha_ok = rec.get("catalogue_sha256") == D.catalogue_sha()
        cat = {s["id"]: s for s in D.load_catalogue()["singles"]}
        seen = [i for i in rec.get("singles", []) if i in cat and f"{cat[i]['lab']}:{cat[i]['variant']}" in rec.get("excluded", [])]
        r.check("draw", same and sha_ok and not seen, f"seed {rec.get('seed')!r} drawn {rec.get('drawn_at')}: singles {rec.get('singles')}, incident {rec.get('incident')}; "
                f"{'reproduced' if same else 'NOT reproduced ' + str(again)}; catalogue {'unchanged' if sha_ok else 'changed'}; {len(rec.get('excluded', []))} seen variants excluded")

    for n, fid in enumerate(rec.get("singles", [])[:2], 1):
        det = next((s for s in rec.get("single_details", []) if s.get("id") == fid), {})
        ev = json.loads(L.read_text(os.path.join(REPORT, "evidence", f"{fid}.json"), 2000000) or "{}")
        checks = ev.get("checks") or []
        failed = [c.get("id") for c in checks if not c.get("passed")]
        ok = (ev.get("activityId") == det.get("lab") and ev.get("seed") == det.get("variant") and checks and not failed
              and str(ev.get("completedAt", "")) >= str(rec.get("drawn_at", "~")) and ev.get("assistance") == "independent")
        r.check(f"single-{n}", bool(ok), f"{fid}: evidence {'missing' if not ev else ev.get('activityId')} seed {ev.get('seed')} completed {ev.get('completedAt')} assistance {ev.get('assistance')}; "
                f"{len(checks) - len(failed)}/{len(checks)} checks passed{'; failed ' + str(failed) if failed else ''}")

    state = os.path.join(HERE, "work", "incident-state.json")
    if not (os.path.exists(state) or os.path.exists(state + ".prev")):
        r.check("service", False, "the combined incident was never injected (inject.sh needs your L31 rebuild on a running cluster)")
    else:
        import incident as I  # noqa: PLC0415
        for cid, ok, obs in I.checks():
            r.check(cid, ok, obs)

    running = []
    if shutil.which("docker"):
        for det in rec.get("single_details", []):
            code, out, _ = L.sh(["docker", "ps", "-q", "--filter", f"label=looped.lab/id={det.get('lab')}"], timeout=20)
            if code == 0 and out.strip():
                running.append(det.get("lab"))
    r.check("scoped-cleanup-local", bool(rec) and not running, f"containers still running for drawn labs: {running or 'none'}")

    for cid, ok, obs in RC.all_checks(REPORT, rec):
        r.check(cid, ok, obs)
    return r.finish(args.out, args.explanation, {"draw_seed": rec.get("seed"), "singles": rec.get("singles"), "incident": rec.get("incident")})


if __name__ == "__main__":
    sys.exit(main())
