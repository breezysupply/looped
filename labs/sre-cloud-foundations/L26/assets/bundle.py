#!/usr/bin/env python3
"""Offline delivery bundle tool for L26 (standard library + docker + openssl).

  export  (sender)    python3 bundle.py export --sender work/sender --out work/outbox
  verify  (receiver)  python3 bundle.py verify --bundle work/inbox/beacon-1.4.0 --trust work/receiver/trusted-keys
  load    (receiver)  python3 bundle.py load   --bundle work/inbox/beacon-1.4.0 --trust work/receiver/trusted-keys \
                          --registry 127.0.0.1:15026 --env-out work/receiver/deployed-refs.env
  fingerprint         python3 bundle.py fingerprint <public-key.pem>

A bundle is a directory:
  images/<name>.tar     `docker save` archives (one image each)
  deploy/, config/      the files the inventory lists
  manifest.json         every artifact with size and sha256; images with their layer digests
  SHA256SUMS            the same checksums in `sha256sum -c` format, for humans
  manifest.json.sig     `openssl dgst -sha256 -sign` over manifest.json

Verification (what `verify` and `load` refuse): a signature that no key in the
TRUST STORE verifies — a public key shipped inside the bundle proves nothing
and is never used; a missing, extra or altered file; an image the deployment
needs (an ${IMG_<NAME>} reference in deploy/compose.yaml) that is not in the
bundle. Every verification is appended to work/receiver/verify-log.jsonl.
The signing key's fingerprint is SHA-256 over the DER public key.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

SIG, MANIFEST, SUMS = "manifest.json.sig", "manifest.json", "SHA256SUMS"
META = {MANIFEST, SIG, SUMS}
IMG_REF = re.compile(r"\$\{IMG_([A-Z0-9_]+)")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def fingerprint(pem_path, private=False):
    args = ["openssl", "pkey", "-in", pem_path, "-pubout", "-outform", "DER"] if private else ["openssl", "pkey", "-pubin", "-in", pem_path, "-outform", "DER"]
    r = subprocess.run(args, capture_output=True)
    if r.returncode != 0:
        raise ValueError(f"{pem_path}: not a {'private' if private else 'public'} key ({r.stderr.decode()[:120].strip()})")
    return hashlib.sha256(r.stdout).hexdigest()


def listing(root):
    out = []
    for d, _, files in os.walk(root):
        for f in files:
            out.append(os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/"))
    return sorted(out)


# ── sender ────────────────────────────────────────────────────────────────
def cmd_export(a):
    sender = os.path.abspath(a.sender)
    with open(os.path.join(sender, "inventory.json"), "r", encoding="utf-8") as fh:
        inv = json.load(fh)
    name = inv["bundle"]
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,63}", name):
        sys.exit("bundle name must be lower-case letters, digits, dots and dashes")
    out = os.path.join(os.path.abspath(a.out), name)
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(os.path.join(out, "images"))
    key = os.path.join(sender, a.key or inv.get("signing_key", "keys/release.key"))
    artifacts = []
    for img in inv.get("images", []):
        n = img["name"]
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,40}", n):
            sys.exit(f"image name {n!r}: lower-case letters, digits and dashes only")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,40}", str(img.get("tag", ""))):
            sys.exit(f"image {n}: inventory needs an explicit version tag")
        saved_as = f"registry.lab/looped-l26/{n}:{img['tag']}"
        r = run(["docker", "tag", img["ref"], saved_as])
        if r.returncode:
            sys.exit(f"docker tag {img['ref']}: {r.stderr.strip()} (is the image on this engine?)")
        info = json.loads(run(["docker", "image", "inspect", saved_as]).stdout)[0]
        tar = os.path.join(out, "images", n + ".tar")
        print(f"saving {img['ref']} as {saved_as} ...", flush=True)
        r = run(["docker", "save", "-o", tar, saved_as])
        if r.returncode:
            sys.exit(f"docker save {saved_as}: {r.stderr.strip()}")
        artifacts.append({"path": f"images/{n}.tar", "kind": "image", "size": os.path.getsize(tar), "sha256": sha256_file(tar),
                          "image": {"name": n, "source_ref": img["ref"], "saved_as": saved_as, "platform": f"{info.get('Os')}/{info.get('Architecture')}",
                                    "layers": info.get("RootFS", {}).get("Layers", [])}})
    for rel in inv.get("files", []):
        src = os.path.join(sender, rel)
        dst = os.path.join(out, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        artifacts.append({"path": rel, "kind": "file", "size": os.path.getsize(dst), "sha256": sha256_file(dst)})
    pub_fp = fingerprint(key, private=True)
    if inv.get("include_public_key"):
        pub = os.path.join(out, "signer.pub.pem")
        r = run(["openssl", "pkey", "-in", key, "-pubout", "-out", pub])
        artifacts.append({"path": "signer.pub.pem", "kind": "file", "size": os.path.getsize(pub), "sha256": sha256_file(pub)})
    manifest = {"schema": "looped.bundle/v1", "bundle": name, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "signer_fingerprint": pub_fp, "artifacts": artifacts}
    with open(os.path.join(out, MANIFEST), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    with open(os.path.join(out, SUMS), "w", encoding="utf-8") as fh:
        for art in artifacts:
            fh.write(f"{art['sha256']}  {art['path']}\n")
        fh.write(f"{sha256_file(os.path.join(out, MANIFEST))}  {MANIFEST}\n")
    r = run(["openssl", "dgst", "-sha256", "-sign", key, "-out", os.path.join(out, SIG), os.path.join(out, MANIFEST)])
    if r.returncode:
        sys.exit(f"signing failed: {r.stderr.strip()}")
    print(f"bundle {out}: {len(artifacts)} artifacts, signed by key {pub_fp[:16]}…")
    return 0


# ── receiver ──────────────────────────────────────────────────────────────
def verify_bundle(bundle, trust):
    """(ok, reasons[(code, detail)], manifest or None, signer_fp or None)."""
    reasons = []
    mpath, spath = os.path.join(bundle, MANIFEST), os.path.join(bundle, SIG)
    if not os.path.isfile(mpath) or not os.path.isfile(spath):
        return False, [("missing-file", "manifest.json or manifest.json.sig is missing")], None, None
    signer = None
    keys = sorted(f for f in os.listdir(trust) if f.endswith(".pem")) if os.path.isdir(trust) else []
    for k in keys:
        r = run(["openssl", "dgst", "-sha256", "-verify", os.path.join(trust, k), "-signature", spath, mpath])
        if r.returncode == 0 and "Verified OK" in r.stdout:
            signer = fingerprint(os.path.join(trust, k))
            break
    if not signer:
        detail = f"no key in the trust store ({len(keys)} key(s)) verifies manifest.json.sig"
        own = os.path.join(bundle, "signer.pub.pem")
        if os.path.isfile(own):
            r = run(["openssl", "dgst", "-sha256", "-verify", own, "-signature", spath, mpath])
            if r.returncode == 0:
                detail += f"; it verifies only with the key shipped INSIDE the bundle (fingerprint {fingerprint(own)[:16]}…), which proves nothing"
        reasons.append(("untrusted-signer", detail))
    try:
        with open(mpath, "r", encoding="utf-8") as fh:
            manifest = json.load(fh)
    except ValueError as e:
        return False, reasons + [("checksum-mismatch", f"manifest.json is not JSON: {e}")], None, signer
    listed = {a["path"] for a in manifest.get("artifacts", [])}
    for art in manifest.get("artifacts", []):
        p = os.path.join(bundle, art["path"])
        if not os.path.isfile(p):
            reasons.append(("missing-file", f"{art['path']} is listed but absent"))
        elif os.path.getsize(p) != art["size"] or sha256_file(p) != art["sha256"]:
            reasons.append(("checksum-mismatch", f"{art['path']}: sha256 {sha256_file(p)[:16]}… differs from the signed manifest {art['sha256'][:16]}…"))
    for f in listing(bundle):
        if f not in listed and f not in META:
            reasons.append(("unexpected-file", f"{f} is not in the signed manifest"))
    needed = set()
    compose = os.path.join(bundle, "deploy", "compose.yaml")
    if os.path.isfile(compose):
        with open(compose, "r", encoding="utf-8") as fh:
            needed = {m.lower().replace("_", "-") for m in IMG_REF.findall(fh.read())}
    have = {a["image"]["name"] for a in manifest.get("artifacts", []) if a.get("kind") == "image"}
    for n in sorted(needed - have):
        reasons.append(("incomplete", f"deploy/compose.yaml needs image '{n}' (IMG_{n.upper().replace('-', '_')}) but the bundle does not contain it"))
    return not reasons, reasons, manifest, signer


def tree_digest(bundle):
    h = hashlib.sha256()
    for f in listing(bundle):
        h.update(f.encode() + b"\0" + sha256_file(os.path.join(bundle, f)).encode() + b"\n")
    return h.hexdigest()


def log_result(log, bundle, ok, reasons, signer):
    os.makedirs(os.path.dirname(os.path.abspath(log)), exist_ok=True)
    mp = os.path.join(bundle, MANIFEST)
    entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "bundle": os.path.abspath(bundle), "result": "ACCEPT" if ok else "REJECT",
             "manifest_sha256": sha256_file(mp) if os.path.isfile(mp) else None, "tree_sha256": tree_digest(bundle),
             "signer_fingerprint": signer, "reasons": [{"code": c, "detail": d} for c, d in reasons]}
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry) + "\n")


def cmd_verify(a):
    ok, reasons, manifest, signer = verify_bundle(a.bundle, a.trust)
    log_result(a.log, a.bundle, ok, reasons, signer)
    for c, d in reasons:
        print(f"REJECT {c}: {d}")
    if ok:
        print(f"ACCEPT {manifest['bundle']}: signature by trusted key {signer[:16]}…, {len(manifest['artifacts'])} artifacts verified, deployment complete")
    return 0 if ok else 1


def registry_digest(registry, repo, tag):
    req = urllib.request.Request(f"http://{registry}/v2/{repo}/manifests/{tag}", method="HEAD", headers={"Accept": ", ".join([
        "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json",
        "application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"])})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=10) as r:
        return r.headers.get("Docker-Content-Digest")


def cmd_load(a):
    if not re.fullmatch(r"(127\.0\.0\.1|localhost):\d{2,5}", a.registry):
        sys.exit("the internal registry must be a loopback address (127.0.0.1:PORT) in this lab")
    ok, reasons, manifest, signer = verify_bundle(a.bundle, a.trust)
    log_result(a.log, a.bundle, ok, reasons, signer)
    if not ok:
        for c, d in reasons:
            print(f"REJECT {c}: {d}")
        print("refusing to load an unverified bundle")
        return 1
    refs, loaded = [], []
    for art in manifest["artifacts"]:
        if art.get("kind") != "image":
            continue
        img = art["image"]
        r = run(["docker", "load", "-i", os.path.join(a.bundle, art["path"])])
        if r.returncode:
            sys.exit(f"docker load {art['path']}: {r.stderr.strip()}")
        m = re.search(r"Loaded image: (\S+)", r.stdout) or re.search(r"Loaded image ID: (\S+)", r.stdout)
        src = m.group(1) if m else img["saved_as"]
        tag = img["saved_as"].rsplit(":", 1)[1]
        repo = f"looped-l26/{img['name']}"
        target = f"{a.registry}/{repo}:{tag}"
        for cmd in (["docker", "tag", src, target], ["docker", "push", "-q", target]):
            r = run(cmd)
            if r.returncode:
                sys.exit(f"{' '.join(cmd)}: {r.stderr.strip()}")
        digest = registry_digest(a.registry, repo, tag)
        ref = f"{a.registry}/{repo}@{digest}"
        refs.append(f"IMG_{img['name'].upper().replace('-', '_')}={ref}")
        loaded.append({"name": img["name"], "ref": ref, "layers": img["layers"]})
        print(f"loaded {img['name']}: {ref}")
    os.makedirs(os.path.dirname(os.path.abspath(a.env_out)), exist_ok=True)
    with open(a.env_out, "w", encoding="utf-8") as fh:
        fh.write("# written by bundle.py load: internal, digest-pinned references only\n" + "\n".join(refs) + "\n")
    print(f"wrote {a.env_out}; deploy with: docker compose -p looped-l26-recv -f {os.path.join(a.bundle, 'deploy', 'compose.yaml')} --env-file {a.env_out} up -d")
    return 0


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    default_log = os.path.join(here, "..", "work", "receiver", "verify-log.jsonl")
    p = argparse.ArgumentParser(description="L26 offline bundle tool")
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export")
    e.add_argument("--sender", required=True)
    e.add_argument("--out", required=True)
    e.add_argument("--key", help="signing key path relative to --sender (default: inventory signing_key)")
    for n in ("verify", "load"):
        s = sub.add_parser(n)
        s.add_argument("--bundle", required=True)
        s.add_argument("--trust", required=True)
        s.add_argument("--log", default=default_log)
        if n == "load":
            s.add_argument("--registry", required=True)
            s.add_argument("--env-out", required=True)
    f = sub.add_parser("fingerprint")
    f.add_argument("pem")
    a = p.parse_args()
    if a.cmd == "export":
        return cmd_export(a)
    if a.cmd == "verify":
        return cmd_verify(a)
    if a.cmd == "load":
        return cmd_load(a)
    print(fingerprint(a.pem))
    return 0


if __name__ == "__main__":
    sys.exit(main())
