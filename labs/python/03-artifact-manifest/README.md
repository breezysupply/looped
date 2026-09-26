# 03 · Artifact manifest checker

**Time:** about 45 minutes. **You edit:** `manifest_check.py`.

## The task

You ship software to sites with no internet access (a factory floor, a
ship, a classified network). The release is a directory bundle carried in
on a USB drive, with a `manifest.json` listing every file and its SHA-256.
Before anyone installs it, a script must answer one question: **is this
bundle exactly what the manifest says, nothing missing, nothing changed,
nothing extra?**

Write `check(bundle_dir, manifest_path) -> Report` and a CLI around it.

```json
{"files": [
  {"path": "bin/app",
   "sha256": "1f039b164043db47dbb667fc86f45f99334d0990888a7a1bd22988b7a9a84fc4",
   "size": 239},
  {"path": "config/app.yaml",
   "sha256": "cf6cfd9af0628e5cd5fc119f69a83fe47cc6e4ec7f9d3bbdf39f77642cea9716"}
]}
```

`size` is optional. Other top-level keys (`bundle`, `version`) are allowed
and ignored.

## Expected behaviour

`Report` (already defined in the starter) has six sorted lists and an `ok`
property:

| Field | Contains |
|---|---|
| `missing` | safe manifest paths with no regular file on disk |
| `duplicates` | paths listed more than once (each path reported once) |
| `unexpected` | files on disk under `bundle_dir` that the manifest does not list |
| `unsafe` | manifest paths that could escape the bundle, plus any symlink that resolves outside it |
| `mismatched` | `Mismatch(path, field, expected, actual)`, where `field` is `"size"` or `"sha256"` |
| `verified` | paths that are present and match |

`ok` is `True` only when `missing`, `duplicates`, `unexpected`, `unsafe` and
`mismatched` are all empty.

**Unsafe paths.** Decide from the string alone, **before** touching the
filesystem. A path must be relative, use `/` separators, and have no empty,
`.` or `..` segments:

- `../etc/passwd`, `bin/../../x`: traversal
- `/etc/shadow`: absolute
- `config\app.yaml`: backslash (a separator on Windows)
- `./bin/app`, `bin//app`, `""`: non-canonical, because one file must not
  have two spellings (that would let an attacker dodge duplicate detection)

Unsafe entries are never opened, hashed or reported as missing.

**Symlinks.** A safe-looking path can still lead outside:
`lib/libssl.so.3 -> /etc/shadow`, or `conf.d/` linked to `/etc`. Resolve
the path (`os.path.realpath`) and treat it as **unsafe** if it lands
outside `bundle_dir`. Do the same for symlinks you find on disk, even when
the manifest does not list them. Never follow a symlinked directory while
walking.

**Hashing.** Read files in chunks (`hash_file(path, chunk_size)`). Never
read a whole file at once, because a bundle can hold multi-GB images.
Compare hex **case-insensitively**: `ABC...` and `abc...` are the same
digest. If `size` is given and differs, report a `size` mismatch (no need
to hash).

**The manifest may live inside the bundle.** If so, it is not "unexpected".

**Malformed manifest: raise `MalformedManifest` (a `ValueError`).** This
covers invalid JSON, a top level that is not an object, `files` missing or
not a list, an entry that is not an object, `path` not a string, `sha256`
not exactly 64 hex characters, or `size` not a non-negative int (bools do
not count). A bundle directory that does not exist raises `OSError` (e.g.
`NotADirectoryError`).

**CLI:** `python3 manifest_check.py BUNDLE_DIR MANIFEST`. It prints one line
per problem and then a summary. Exit **0** OK, **1** problems, **2** malformed
or unreadable input, or a usage error. Errors go to stderr.

## Example

```
$ python3 manifest_check.py fixtures/bundle fixtures/manifests/unsafe-paths.json
UNSAFE     ../etc/passwd
UNSAFE     /etc/shadow
UNSAFE     bin/../../outside.txt
UNSAFE     config\app.yaml
FAILED: 6 verified, 4 problem(s)
$ echo $?
1
```

## What a checksum does not prove

This part is as important as the code, and it is what interviewers probe.

A SHA-256 match proves that **the bytes on disk are the bytes the manifest
describes**. It catches corruption, truncated copies, a half-finished
rsync, and someone editing one file by hand. It does **not** prove **who
published** the manifest. Anyone who can change the files can also change
the manifest to match: recompute 6 hashes, rewrite one JSON file, done. A
manifest that travels on the same USB drive as the files is only integrity,
not authenticity.

Authenticity needs a **digital signature** over the manifest (with GPG,
minisign, `cosign`/Sigstore, or an X.509 code-signing certificate). You
check it against a **public key or identity you already trust**, one that
reached you through a **separate trusted channel** (baked into the base
image, installed at commissioning, read out over the phone and compared).
The chain is: trusted key → verifies the signature on the manifest → the
manifest's hashes → verify the files. Remove any link and the chain proves
nothing.

The hard problems then move to **key management**, which is a separate
concern:

- **Distribution:** how did the trusted key get there, and why should you
  trust *that*?
- **Rotation:** keys expire or change, so sites must learn the new key
  before bundles signed with it arrive.
- **Revocation:** if the signing key leaks, how does an offline site find
  out? There is no CRL or OCSP lookup and no transparency log to query. The
  revocation news has to travel by the same slow, trusted, out-of-band path.

This exercise **deliberately does not implement signatures**. It is the
integrity layer that a signature check would sit on top of.

## Fixtures

`fixtures/bundle/` is a small release tree: `README.txt`, `bin/app`,
`bin/healthcheck.sh`, `config/app.yaml`, `data/.keep` (empty) and
`lib/libfoo.so.1`. The manifests in `fixtures/manifests/` describe it:

| Manifest | Scenario |
|---|---|
| `good.json` | Matches exactly. `bin/app`'s digest is UPPERCASE, and `README.txt` has no size. |
| `missing-file.json` | Also lists `bin/migrate`, which is not in the bundle |
| `duplicate-entry.json` | Lists `config/app.yaml` twice |
| `extra-file-on-disk.json` | Leaves out `lib/libfoo.so.1`, which is on disk |
| `unsafe-paths.json` | Adds `../etc/passwd`, `/etc/shadow`, `bin/../../outside.txt`, `config\app.yaml` |
| `sha256-mismatch.json` | Wrong hash for `bin/app`, wrong size for `config/app.yaml` |
| `malformed-invalid-json.json` | Truncated JSON |
| `malformed-no-files.json` | Uses `artifacts` instead of `files` |
| `malformed-bad-entry.json` | An MD5 (32 hex chars) where a SHA-256 should be |

`fixtures/.gitattributes` stops git from converting line endings in these
files. Converted line endings would change the bytes and break every hash.

The symlink scenarios are built at test time, in a temporary copy of the
bundle. No symlinks are committed to the repo.

## Running the tests

Run these from this directory (`labs/python/03-artifact-manifest`):

```sh
PYTHONPATH=. python3 -m unittest discover -s tests -t .          # your code
PYTHONPATH=solution python3 -m unittest discover -s tests -t .   # reference
```

## Broken variants

Read each file in `broken/*/manifest_check.py`, spot the flaw, then confirm
with `PYTHONPATH=broken/<variant> python3 -m unittest discover -s tests -t .`

- `ignores-extra-files`
- `follows-path-traversal`
- `case-sensitive-hash`
- `skips-duplicates`

## Hints

<details><summary>Hint 1: plan the passes</summary>

(1) Load and validate the manifest. (2) Group entries by path to find
duplicates. (3) For each unique path: unsafe spelling? escaping symlink?
missing? size? hash? (4) Walk the disk to find unexpected files. Write
`is_safe_relpath` first. It is pure string logic and easy to test in a REPL.
</details>

<details><summary>Hint 2: the safe-path rule in one line</summary>

Reject if the path is empty, starts with `/`, or contains `\`. Otherwise
`all(p not in ("", ".", "..") for p in path.split("/"))`.
</details>

<details><summary>Hint 3: "is it inside?"</summary>

`root = os.path.realpath(bundle_dir)`, then
`os.path.commonpath([root, os.path.realpath(candidate)]) == root`. Do not use
`startswith`: `/srv/bundle-evil` starts with `/srv/bundle`.
</details>

<details><summary>Hint 4: streaming hash and walking</summary>

```python
h = hashlib.sha256()
with open(path, "rb") as fh:
    for chunk in iter(lambda: fh.read(chunk_size), b""):
        h.update(chunk)
```
For the disk walk use `os.walk(root, followlinks=False)`. Symlinked
directories show up in `dirnames`, so include those as entries too.
Convert `os.sep` to `/` so paths match the manifest's spelling.
</details>
