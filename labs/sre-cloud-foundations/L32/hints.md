# L32 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** For every symptom, first decide whose it is: the drawn lab's environment or
   your L31 rebuild; then the layer (host, network, process, release, data, access). In the
   combined incident, assume two causes until evidence says one explains everything.
2. **Evidence source.** The drawn lab's validator output, its README's "what you should
   observe", `helm history`, `kubectl get events`, pod logs with request ids, `/ready`, a record
   count, and `kubectl auth can-i --as system:serviceaccount:<ns>:beacon-deployer`.
3. **Discriminating check.** Compare against a known-good baseline you recorded in L31
   (verify.json, the seed fingerprint, the can-i matrix, helm values). For data: count what is
   missing, what is newer than the latest backup, and what each recovery option would lose
   before touching the database.
4. **Root cause and fix.** C-incidents combine a data fault with a release, credential or access
   fault: roll back a release whose values inject failures; make the database password and the
   Secret agree and restart the API; remove a broad RoleBinding; restore the pre-incident backup
   into a scratch database and copy back only missing rows (`pg_dump -t records --data-only
   --inserts --on-conflict-do-nothing`), then drop the scratch database. Single faults: the drawn
   lab's own hints rung 4.
