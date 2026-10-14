# Final assessment incident report (L32) — AUTHORING SAMPLE, not a real run

## Summary

Two drawn single faults (L05 variant-b, L04 variant-a) were diagnosed and fixed in their own lab
environments, and a combined incident on the L31 rebuild (error responses after a release plus
missing history for three sensors) was resolved with a rollback and a selective restore.

## Timeline

- 2026-10-14T12:40Z detection: L05 validator FAIL on the recursive answer
- 2026-10-14T12:52Z hypothesis: stale negative cache versus missing delegation; queried the parent
- 2026-10-14T13:05Z L05 fixed and validated; evidence written
- 2026-10-14T13:30Z L04 bottleneck identified from inode counts, fixed, validated
- 2026-10-14T14:02Z combined incident detected: 5xx on /status and three sensors without history
- 2026-10-14T14:20Z helm rollback, then selective restore from the pre-incident backup, verified

## Fault 1

L05 variant-b. Symptom: the recursive resolver returned NXDOMAIN while the authoritative server
had the record. Evidence: report/evidence/F-L05-b.json and the dig output below. Cause and fix
were confirmed by flushing only the resolver cache and re-running the validator.

```
$ dig @10.55.0.53 api.beacon.corp.lab +norecurse   (status: NOERROR)
```

## Fault 2

L04 variant-a. Symptom: writes failed with plenty of free bytes. Evidence: report/evidence/F-L04-a.json
and `df -i` showing 100% inode use on the lab filesystem only; removed the generated small files
under the lab mount, not anything on the host.

```
$ df -i /mnt/l04   IUse% 100%
```

## Combined incident

Two faults: a release with a fixture failure rate (helm history showed revision 4 with
config.inject.failRate) and deleted records. Fixed the release first (it hid the data symptom
behind errors), then the data. Evidence: labs/sre-cloud-foundations/L31/rebuild.sh history output:

```
$ helm --kube-context kind-looped-foundations -n beacon-capstone history beacon
4  deployed  Upgrade complete
```

## Data and recovery decision

The pre-incident backup had all 240 seeded records but not the 12 records written after it. A
full restore would have lost those 12; accepting the loss would have left 30 seeded records
missing. Chose a selective restore: restored the backup into a scratch database, copied back only
the 30 missing seed rows, kept the 12 newer rows, dropped the scratch database. Evidence:

```
seed rows/fingerprint 240 2281018160bb2c736124981dbf0919d1; post-backup records 12 (unchanged)
```

## Verification

/ready 200, /version 1.4.0, a record written and read back, seed fingerprint equal to the
expected value, 12 post-backup records still present, validator live checks all PASS.

## Least privilege

auth can-i for beacon-deployer after recovery: patch deployments yes, get pods/log yes, delete
deployments no, get secrets no, create pods/exec no; no RoleBinding to edit or admin remains.

## Cleanup

Ran L05 and L04 teardown scripts in the VM; dropped the scratch database beacon_restore; removed
nothing outside namespace beacon-capstone; kept this report and the evidence files.

## Follow-ups

- Owner: me — add a pre-release check that fails on any non-zero inject value (this week).
- Owner: me — make selective restore a scripted, tested procedure (next week).
