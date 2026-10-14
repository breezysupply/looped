#!/usr/bin/env python3
"""L26 validator: re-verifies the delivered bundle independently, attacks a
scratch copy of it three ways, and inspects the receiver deployment, the
internal registry and the internal network. Read-only apart from a temporary
directory it deletes, one test record written through the API, and the
evidence JSON. Never reads private key contents into the report.

Checks (critical unless noted):
  trust-store              the receiver trusts exactly one key, and it is the release key bootstrapped at setup
  fault-rejected           the verify log shows the delivered fault was rejected for the right reason
  bundle-verifies          the inbox bundle: signature by the trusted key, every file's sha256, no extra
                           files, every image the deployment references present
  negative-tests           copies of that bundle with an altered file, a missing image archive, or a
                           signature by an unknown key are each rejected against the receiver's trust store
  registry-has-artifacts   the internal registry serves every image of the bundle
  deployed-from-internal   every looped-l26-recv container runs an image referenced as 127.0.0.1:15026/...@sha256:...
  deployed-matches-bundle  each running image has exactly the layer digests recorded in the signed manifest
  egress-blocked           the receiver network is internal; containers sit only on internal networks
                           and have no default route
  user-path                the API answers /ready and accepts a write on the receiver's database
  trust-bootstrap-doc      TRUST-BOOTSTRAP.md states the fingerprint and the second channel, rotation/fallback
                           and residual risks with substance
  no-private-key-shipped   no private key in the outbox, the inbox or evidence/
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
sys.path.insert(0, os.path.join(HERE, "assets"))
import labcheck as L  # noqa: E402
import bundle as B  # noqa: E402

WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
PROJECT = "looped-l26-recv"
REGISTRY = "127.0.0.1:15026"
NAME = "beacon-1.4.0"
INBOX = os.path.join(WORK, "inbox", NAME)
TRUST = os.path.join(WORK, "receiver", "trusted-keys")
PRIV = re.compile(("-----BEGIN [A-Z ]*PRIV" + "ATE KEY-----").encode())
FAULT_CODE = {"variant-a": "checksum-mismatch", "variant-b": "incomplete", "variant-c": "untrusted-signer"}
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def read(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def section(text, head):
    m = re.search(r"(?ms)^## " + re.escape(head) + r"\s*$(.*?)(?=^## |\Z)", text)
    return m.group(1).strip() if m else ""


def containers():
    code, out, _ = L.docker(["ps", "-aq", "--filter", f"label=com.docker.compose.project={PROJECT}"])
    res = []
    for cid in out.split():
        c, o, _ = L.docker(["inspect", cid])
        try:
            res.append(json.loads(o)[0])
        except (ValueError, IndexError):
            pass
    return res


def scratch_copy(dst):
    """Copy the small files of the inbox bundle, symlink the big image archives."""
    for rel in B.listing(INBOX):
        s, d = os.path.join(INBOX, rel), os.path.join(dst, rel)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        if rel.startswith("images/"):
            os.symlink(s, d)
        else:
            shutil.copyfile(s, d)


def main():
    args = L.standard_args("L26")
    r = L.Report("L26", "compose")
    L.apply_args(r, args)
    variant = (read(os.path.join(WORK, ".variant")) or "variant-a").strip()
    if not args.variant:
        r.seed = variant
    if not os.path.isdir(WORK):
        r.check("trust-store", False, "no work/ directory: run setup.sh first")
        return r.finish(args.out, args.explanation)

    # ── trust ─────────────────────────────────────────────────────────
    release_fp = ""
    try:
        release_fp = B.fingerprint(os.path.join(WORK, "sender", "keys", "release.pub.pem"))
    except (ValueError, OSError):
        pass
    keys = sorted(f for f in os.listdir(TRUST)) if os.path.isdir(TRUST) else []
    fps = []
    for k in keys:
        try:
            fps.append(B.fingerprint(os.path.join(TRUST, k)))
        except ValueError:
            fps.append("not-a-public-key:" + k)
    r.check("trust-store", bool(release_fp) and fps == [release_fp],
            f"{len(keys)} key file(s) trusted: " + ", ".join(f"{k} ({fp[:16]}…)" for k, fp in zip(keys, fps)) + f"; release key {release_fp[:16]}…")

    log = []
    for line in (read(os.path.join(WORK, "receiver", "verify-log.jsonl")) or "").splitlines():
        try:
            log.append(json.loads(line))
        except ValueError:
            pass
    want = FAULT_CODE.get(variant, "checksum-mismatch")
    rejected = [e for e in log if e.get("result") == "REJECT" and any(x.get("code") == want for x in e.get("reasons", []))]
    accepted = [e for e in log if e.get("result") == "ACCEPT"]
    r.check("fault-rejected", bool(rejected) and (not accepted or rejected[0]["at"] <= accepted[-1]["at"]),
            f"verify log: {len(log)} entries, {len(rejected)} REJECT with '{want}', {len(accepted)} ACCEPT"
            + (f"; first rejection {rejected[0]['at']}: {rejected[0]['reasons'][0]['detail'][:120]}" if rejected else ""))

    # ── the delivered bundle ──────────────────────────────────────────
    manifest = None
    if os.path.isdir(INBOX):
        ok, reasons, manifest, signer = B.verify_bundle(INBOX, TRUST)
        r.check("bundle-verifies", ok and signer == release_fp,
                (f"ACCEPT: signed by {signer[:16]}…, {len(manifest['artifacts'])} artifacts" if ok else "REJECT: " + "; ".join(f"{c}: {d[:90]}" for c, d in reasons[:3])))
    else:
        r.check("bundle-verifies", False, f"no bundle at work/inbox/{NAME}")

    neg = []
    if manifest and os.path.isdir(INBOX):
        tmp = tempfile.mkdtemp(prefix="looped-l26-neg-")
        try:
            cases = {}
            d = os.path.join(tmp, "tampered")
            scratch_copy(d)
            files = [a["path"] for a in manifest["artifacts"] if a["kind"] == "file"]
            with open(os.path.join(d, files[0]), "a", encoding="utf-8") as fh:
                fh.write("\n# altered after signing\n")
            cases["altered file"] = (d, {"checksum-mismatch"})
            d = os.path.join(tmp, "missing")
            scratch_copy(d)
            imgs = [a["path"] for a in manifest["artifacts"] if a["kind"] == "image"]
            if imgs:
                os.remove(os.path.join(d, imgs[-1]))
            cases["missing image archive"] = (d, {"missing-file"})
            d = os.path.join(tmp, "foreign")
            scratch_copy(d)
            k = os.path.join(tmp, "foreign.key")
            subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", k], capture_output=True, check=True)
            subprocess.run(["openssl", "dgst", "-sha256", "-sign", k, "-out", os.path.join(d, B.SIG), os.path.join(d, B.MANIFEST)], capture_output=True, check=True)
            os.remove(k)
            cases["unknown signing key"] = (d, {"untrusted-signer"})
            for label, (path, codes) in cases.items():
                ok, reasons, _, _ = B.verify_bundle(path, TRUST)
                got = {c for c, _ in reasons}
                neg.append((label, not ok and bool(codes & got), sorted(got)))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    r.check("negative-tests", len(neg) == 3 and all(x[1] for x in neg), "; ".join(f"{lbl}: {'rejected' if good else 'NOT rejected'} {codes}" for lbl, good, codes in neg) or "no verifiable bundle to attack")

    images = {a["image"]["name"]: a["image"] for a in (manifest or {}).get("artifacts", []) if a.get("kind") == "image"}
    missing = []
    for n in sorted(images):
        try:
            with OPENER.open(f"http://{REGISTRY}/v2/looped-l26/{n}/tags/list", timeout=5) as resp:
                tags = json.loads(resp.read()).get("tags") or []
            if not tags:
                missing.append(n)
        except Exception:  # noqa: BLE001
            missing.append(n)
    r.check("registry-has-artifacts", bool(images) and not missing, f"internal registry {REGISTRY}: " + (f"missing {missing}" if missing else f"serves {sorted(images)}"))

    # ── the receiver deployment ───────────────────────────────────────
    cs = [c for c in containers() if c["State"].get("Running")]
    bad_ref, mismatch, notes = [], [], []
    for c in cs:
        ref = c["Config"].get("Image", "")
        name = c["Name"].lstrip("/")
        if not (ref.startswith(REGISTRY + "/") and "@sha256:" in ref):
            bad_ref.append(f"{name}: {ref}")
        c2, o2, _ = L.docker(["image", "inspect", c["Image"]])
        try:
            layers = json.loads(o2)[0]["RootFS"]["Layers"]
        except (ValueError, IndexError, KeyError):
            layers = []
        hit = [n for n, im in images.items() if im.get("layers") == layers]
        if not hit:
            mismatch.append(name)
        notes.append(f"{name} <- {ref.split('/', 1)[-1][:60]} ({'= ' + hit[0] if hit else 'no bundle image has these layers'})")
    r.check("deployed-from-internal", len(cs) >= 2 and not bad_ref, f"{len(cs)} running container(s) in {PROJECT}" + ("; not internal+digest: " + "; ".join(bad_ref) if bad_ref else "; all internal, digest-pinned"))
    r.check("deployed-matches-bundle", len(cs) >= 2 and not mismatch, "; ".join(notes) or "nothing deployed")

    c3, o3, _ = L.docker(["network", "inspect", "looped-l26-recv"])
    try:
        net_internal = json.loads(o3)[0].get("Internal") is True
    except (ValueError, IndexError):
        net_internal = False
    eg = []
    for c in cs:
        name = c["Name"].lstrip("/")
        nets = list((c.get("NetworkSettings") or {}).get("Networks", {}).keys())
        for n in nets:
            ci, oi, _ = L.docker(["network", "inspect", n])
            try:
                if json.loads(oi)[0].get("Internal") is not True:
                    eg.append(f"{name} is on non-internal network {n}")
            except (ValueError, IndexError):
                eg.append(f"{name}: cannot inspect network {n}")
        cr, route, _ = L.docker(["exec", name, "cat", "/proc/net/route"])
        if cr == 0 and any(ln.split()[1:2] == ["00000000"] for ln in route.splitlines()[1:]):
            eg.append(f"{name} has a default route")
    r.check("egress-blocked", net_internal and bool(cs) and not eg, f"looped-l26-recv internal={net_internal}; " + ("; ".join(eg) if eg else "no container has a way out"))

    api = next((c["Name"].lstrip("/") for c in cs if c["Config"].get("Labels", {}).get("com.docker.compose.service") == "api"), None)
    if api:
        probe = ("import json,urllib.request as u\n"
                 "r=u.urlopen('http://127.0.0.1:8080/ready',timeout=5).status\n"
                 "q=u.Request('http://127.0.0.1:8080/status',data=json.dumps({'sensor_id':'l26-validate','status':'ok'}).encode(),headers={'Content-Type':'application/json'})\n"
                 "w=u.urlopen(q,timeout=5).status\nprint(r,w)")
        cp, op, ep = L.docker(["exec", api, "python3", "-c", probe], timeout=30)
        r.check("user-path", cp == 0 and op.split() == ["200", "201"], f"/ready and test write inside {api}: {op.strip() or ep.strip()[-160:]}")
    else:
        r.check("user-path", False, "no running api container in looped-l26-recv")

    doc = read(os.path.join(WORK, "receiver", "TRUST-BOOTSTRAP.md")) or ""
    tmpl = read(os.path.join(HERE, "assets", "trust-bootstrap-template.md")) or ""
    secs = ["Fingerprint", "Second channel", "Rotation and fallback", "Residual risks"]
    thin = [s for s in secs if len(section(doc, s).replace(section(tmpl, s), "").strip()) < 80]
    has_fp = bool(release_fp) and release_fp in re.sub(r"[^0-9a-f]", "", doc.lower())
    r.check("trust-bootstrap-doc", has_fp and not thin, f"release fingerprint {'stated' if has_fp else 'NOT stated'}; " + (f"thin sections: {thin}" if thin else "all four sections written"))

    leaks = []
    for root in (os.path.join(WORK, "outbox"), os.path.join(WORK, "inbox"), EV):
        if not os.path.isdir(root):
            continue
        for rel in B.listing(root):
            p = os.path.join(root, rel)
            if os.path.islink(p) or os.path.getsize(p) > 64 * 1024 * 1024:
                continue
            with open(p, "rb") as fh:
                if PRIV.search(fh.read()):
                    leaks.append(os.path.relpath(p, HERE))
    r.check("no-private-key-shipped", not leaks, "no private key in outbox, inbox or evidence" if not leaks else "private key material in: " + ", ".join(leaks))

    return r.finish(args.out, args.explanation, {"variant_file": variant, "compose_project": PROJECT, "registry": REGISTRY})


if __name__ == "__main__":
    sys.exit(main())
