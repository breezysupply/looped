# L10 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Before blaming a policy, ask whether a policy was even evaluated. A request can
   fail authentication (the credentials) before authorisation (the policies), and the two look
   alike from the job's point of view. Then ask which policy *type* decided: identity, bucket,
   key, or the guardrail.
2. **Evidence source.** `iameval.py run assets/cases/ticket --explain` prints, for each request,
   the session check, every Deny that matched or did not (and why), and the statement that
   allowed. Compare each ticket request's `action` and `resource` character by character with
   the statements in `work/exporter-policy.json`.
3. **Discriminating check.** Evaluate one ticket case with a known-good inline session (copy
   T1 into `work/tests.json` and replace `"session": "work/session.json"` with an object valid
   at 15:00). If it now passes, the policy was never the problem. If it still fails, read which
   statement the trace names: an explicit deny in the role's own policy is yours to fix; one in
   `guardrail.json` is not.
4. **Root cause and fix.** Variant A: the role's own policy has a leftover
   `FreezeExportsDuringMigration` Deny on `exports/*` — remove that statement only. Variant B:
   `export/*` instead of `exports/*`, and kms:Decrypt names the database key instead of the
   archive key — correct both ARNs. Variant C: the session expired at 14:30, and someone
   "unblocked" by allowing `s3:*`/`kms:*` on `*` — get a new session with `iameval.py assume`
   and replace the broad statement with GetObject on `exports/*`, ListBucket with
   `s3:prefix` `exports/*`, and Decrypt on the archive key.
