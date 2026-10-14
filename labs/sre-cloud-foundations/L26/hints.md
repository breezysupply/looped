# L26 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Three different things can be wrong with a delivery: what was put in it, what
   happened to it on the way, and who vouches for it. The receiver's job is to refuse; the fix
   belongs wherever the problem was introduced, never in the receiver's trust.
2. **Evidence source.** `bundle.py verify` names the reason (`checksum-mismatch`, `missing-file`,
   `incomplete`, `untrusted-signer`). Compare the inbox with the outbox, the inventory with the
   deployment's `${IMG_*}` references, and the signer fingerprint with `work/sender/FINGERPRINT.txt`.
3. **Discriminating check.** Does the OUTBOX copy verify? Yes: the media changed it. No, with
   `incomplete`: the inventory is short. No, with `untrusted-signer`: which key verifies the
   signature — one in the trust store, or only the one inside the bundle?
4. **Root cause and fix.** variant-a: `config/api.env` was altered in transit — re-transfer.
   variant-b: postgres is missing from `work/sender/inventory.json` — add it, export, transfer.
   variant-c: signed with the build-laptop key — set `signing_key` to `keys/release.key` and
   `include_public_key` false, export, transfer. Then verify, load, deploy with the `IMG_*` env
   file, and write TRUST-BOOTSTRAP.md with the release fingerprint.
