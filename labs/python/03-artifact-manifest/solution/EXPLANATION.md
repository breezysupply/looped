# Walkthrough: `manifest_check.py`

Read this next to `manifest_check.py` in this directory.

## 1. Shape

```
check(bundle_dir, manifest_path)
  ├─ load_manifest()      parse + validate + normalise (lowercase hex)
  ├─ group by path        → duplicates
  ├─ for each unique path
  │     is_safe_relpath() → unsafe  (string only, no filesystem)
  │     _inside()         → unsafe  (symlink escapes)
  │     isfile()          → missing
  │     size, hash_file() → mismatched / verified
  └─ _walk() the disk     → unexpected, and unsafe for escaping links
main() → format_report() + exit code
```

The data types are small and fixed. `Mismatch` is a `NamedTuple`
(immutable, compares by value, fields have names). `Report` is a
`@dataclass`, with `field(default_factory=list)` so every report gets its
own lists. A default of `= []` would be one list shared by every instance,
a classic Python trap.

## 2. Validate and normalise at the edge

`load_manifest` is the only place that deals with untrusted JSON. It checks
the shape and returns clean entries: every `sha256` lowercase, and `size`
either an `int` or `None`. After that, the rest of the code can assume a
valid manifest.

- **Digest shape** (exactly 64 hex characters) is checked here. An MD5 or a
  truncated hash is a *malformed manifest*, not a "mismatch". The two
  errors mean different things to the person reading the report.
- **Hex case** is normalised once. `hashlib`'s `hexdigest()` is lowercase.
  Windows `certutil` and some CI tools print uppercase. Both describe the same
  bytes. The `broken/case-sensitive-hash` variant compares verbatim and
  reports a perfectly good bundle as tampered with. A false alarm like that
  teaches operators to ignore the tool.
- `size` rejects `bool`, because `isinstance(True, int)` is `True` in Python.

## 3. Duplicates before anything else

The obvious code, `{e["path"]: e for e in entries}`, silently keeps the
**last** entry for each path. That is what `broken/skips-duplicates` does.
If the two entries have different hashes, whichever one comes last decides
whether the file "passes". The solution groups entries by path first
(`seen.setdefault(path, []).append(entry)`) and reports every path that
appears more than once.

## 4. Path safety, in two layers

**Layer 1: the string** (`is_safe_relpath`). No filesystem access. Reject
empty, NUL, absolute, backslash, and any `""` / `.` / `..` segment. Doing
this before any `open` or `stat` means a hostile manifest cannot even make
us *look* at `/etc/shadow`. Rejecting `.` and `""` segments is about
**canonical names**: if `bin/app` and `./bin/app` were both allowed, one
file could be listed twice under different spellings, and duplicate
detection would never see it.

**Layer 2: symlinks** (`_inside`). `lib/libssl.so.3` passes layer 1, but on
disk it might be a link to `/etc/shadow`. `os.path.realpath` resolves every
link in the path. Then `os.path.commonpath([root, real]) == root` asks
whether the result is still under the bundle. `commonpath` compares whole
path components, so `/srv/bundle-evil` is correctly *not* inside
`/srv/bundle`. A plain `startswith` gets this wrong.

`realpath` does read link metadata (`lstat`/`readlink`) along the way.
It never *opens* the target, so it reads no file contents. If a link
escapes, we stop there.

`broken/follows-path-traversal` has neither layer (it only rejects paths
starting with `/`). The tests put a real file at `../outside.txt` with the
correct hash in the manifest. The broken version reports that file as
"verified": the checker has been used to read a file outside the bundle.

## 5. Streaming hashes

```python
for chunk in iter(lambda: fh.read(chunk_size), b""):
    digest.update(chunk)
```

`iter(callable, sentinel)` keeps calling `fh.read(chunk_size)` until it
returns `b""` (end of file). Memory use stays at 64 KiB whether the file is
1 KB or 40 GB. Open in **binary** mode (`"rb"`): text mode would decode, and
on Windows would also translate line endings, so the hash would be of
different bytes.

Checking **size first** is a cheap shortcut: if the size is wrong, the hash
must be wrong too, and we skip reading the file.

## 6. Unexpected files

A manifest check that only checks what the manifest lists (like
`broken/ignores-extra-files`) misses the most dangerous change: a **file
added** to the bundle. A dropped-in `lib/libpreload.so`, a `config/debug.yaml`
that turns on verbose logging with secrets, a cron file. So we walk the tree
too:

- `os.walk(..., followlinks=False)` never descends into a symlinked
  directory, which could lead outside the bundle or loop forever. Links to
  directories appear in `dirnames`, so we list them as entries ourselves.
- Paths are converted to `/` separators to match the manifest.
- An escaping link found on disk is **unsafe** even if the manifest does not
  mention it.
- The manifest file itself may live inside the bundle and is skipped.

## 7. Errors and exit codes

`MalformedManifest` (exit 2) means "I cannot evaluate this". A `Report`
that is not `ok` (exit 1) means "I evaluated it and it is wrong". A deploy
pipeline must treat both as "do not install", but they need different
fixes. `OSError` (missing bundle, unreadable manifest) is also exit 2, with
a different message.

## 8. What a checksum does not prove

**Integrity is not authenticity.** A clean report proves the bytes on disk
match the manifest. It says nothing about *who* wrote the manifest. An
attacker who can swap `bin/app` on the USB drive can recompute its SHA-256
and edit `manifest.json` in seconds. The check then passes, correctly,
because the files do match the (forged) manifest.

To prove the publisher, you need a **signature over the manifest** (GPG,
minisign, Sigstore/cosign, X.509 code signing), verified with a **public key
or identity you already trust**, which must have reached you through a
**separate trusted channel**, not in the same bundle. A public key shipped
alongside the files proves nothing, because the attacker would ship their
own. The trust chain is:

```
trusted key (installed out-of-band)
   └─ verifies signature over manifest.json
         └─ manifest's sha256 values
               └─ verify each file   ← this exercise
```

Signing moves the problem to **key management**, which is harder,
especially offline:

- **Distribution:** getting the first key there safely (at commissioning,
  in the golden image, compared by fingerprint over a phone call).
- **Rotation:** publishing a new key, signed by the old one, well before
  bundles signed with it arrive, and handling sites that skipped a release.
- **Revocation:** an internet-connected system can check a CRL or OCSP
  responder, or a transparency log. An air-gapped site cannot. It learns that
  a key was compromised only when someone brings the news in, so
  revocation lists must travel with (or ahead of) every bundle. Short-lived
  keys help by limiting how long a leaked key stays useful.

A related trap: a signature proves *who* signed, not *what version* is
current. An attacker can replay an old, validly signed bundle that has a
known vulnerability. Real update systems (TUF, for example) add signed
version numbers and expiry to stop rollback and freeze attacks.

## 9. What would come next

- Verify a detached signature before trusting the manifest (with
  `subprocess` calling `gpg --verify` / `minisign -V`, or a library).
- `--json` output for pipelines.
- Parallel hashing for large bundles (`concurrent.futures`). Hashing is
  mostly I/O-bound, and `hashlib` releases the GIL on large updates.
