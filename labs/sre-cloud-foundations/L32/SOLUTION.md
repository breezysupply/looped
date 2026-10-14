# L32 worked solution (a strong attempt, not the only one)

## Single faults

There is no single answer: each drawn fault is solved with its own lab's evidence and rung-4
hint, and is judged by that lab's validator. What the assessor looks for in **Fault 1/2**: the
reproduction quoted before any change, two hypotheses, the one check that separated them, the
minimal fix, and the validator's PASS line with the evidence path `report/evidence/<fault>.json`.

## The combined incidents

All three start the same way: `inject.sh` takes a pre-incident backup, writes 12 newer records
(`live-*`) for three sensors and then deletes those sensors' seeded history (30 of 240 rows with
seed `authoring-0001`). The second fault differs:

| Incident | Second fault | Symptom | Fix |
|---|---|---|---|
| C1 | chart upgrade with `config.inject.failRate=0.4` | ~40% 500s on every route | `helm history` shows the new revision; `helm get values` shows the inject value; `helm rollback <release> <previous>`; prove `/version`, error rate |
| C2 | PostgreSQL password changed on the database side only; API pods restarted | API pods not ready, Service without endpoints, logs show authentication failures | make the database agree with the Secret (`ALTER USER beacon PASSWORD …` from the pod's local socket, value from L31's `work/.secrets`), restart the API |
| C3 | RoleBinding `beacon-deployer-incident-access` → ClusterRole `edit` | nothing visible to users; the deploy bot can now delete deployments and read secrets | `auth can-i` matrix shows it; delete the binding (it is labelled L32); re-run the matrix |

Order: fix what blocks observation first (C1/C2 hide the data symptom behind errors), then data.

## The data decision

| Option | Result |
|---|---|
| Full restore of the pre-incident backup (`pg_restore --clean`) | the 30 rows return, the 12 newer rows are **lost** |
| Accept the loss | 30 rows of history stay missing |
| **Selective restore** | restore into `beacon_restore`, copy back only rows that are missing, keep the newer rows |

```sh
NS=beacon-capstone; K="kubectl --context kind-looped-foundations -n $NS"
$K exec beacon-db-0 -- createdb -U beacon beacon_restore
$K exec -i beacon-db-0 -- pg_restore -U beacon -d beacon_restore --no-owner < labs/sre-cloud-foundations/L31/work/backups/<pre-incident>.dump
$K exec beacon-db-0 -- pg_dump -U beacon -d beacon_restore -t records --data-only --inserts --on-conflict-do-nothing \
  | $K exec -i beacon-db-0 -- psql -U beacon -d beacon -q
$K exec beacon-db-0 -- dropdb -U beacon beacon_restore
```

Verified in the authoring environment against PostgreSQL 16.4: after the fault the seed
fingerprint was `210 edc2d07e…`; after the selective restore `240 2281018160bb2c736124981dbf0919d1`
(the expected value) with all 12 newer rows present. The report states the counts, why full
restore was rejected, and the scratch-database cleanup.

## Three-minute update (shape)

Impact and start time; scope (what is and is not affected); what has been done and what it
changed; the data position in numbers; the next update time. No speculation stated as fact.

## Design defence

Five decisions with a rejected alternative each, tied to evidence from D01–D06 and L31: for
example two-AZ stateless tier vs. self-managed database, immutable image identity vs. per-env
rebuilds, default-deny NetworkPolicy vs. namespace-only isolation, verified restores vs.
replication-only, burn-rate alerting vs. static thresholds. The Terraform section names the exact
attribute after `# forces replacement` in the plan (for L12's port change: `external`). Gaps are
honest: no live cloud, no real on-call, policy enforcement only on the local policy cluster.
