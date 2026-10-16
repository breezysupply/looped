# M1 · Flow log REJECTs per port

**Time:** about 15 minutes. **Used in:** Mock B. **You edit:** `starter/flow_rejects.sh`.
**Test:** `./run-tests.sh starter M1` from `bash/`.

## The task

A service in a VPC "can't connect to anything" after a network change. You have
its VPC Flow Log records. Write `flow_rejects.sh FILE` that counts the
`REJECT` records per destination port, busiest first, and prints a summary of
how many records were rejected out of how many were read.

## Input format

One AWS VPC Flow Log record per line in the **default version-2 format**: 14
fields separated by spaces (all IDs and addresses here are fictional):

```
version account-id interface-id srcaddr dstaddr srcport dstport protocol packets bytes start end action log-status
2 123456789012 eni-0d8e3a6f1b2c4e507 192.0.2.80 10.20.11.25 443 41322 6 2 120 1760430012 1760430070 REJECT OK
```

| Field | # | Rule |
|---|---|---|
| version | 1 | must be exactly `2` |
| dstport | 7 | the port you count by |
| action | 13 | `ACCEPT` or `REJECT` when log-status is `OK` |
| log-status | 14 | `OK`, `NODATA` or `SKIPDATA` |

- **`NODATA` / `SKIPDATA` records** (no traffic in the window, or records the
  service could not capture) have `-` in the address, port, protocol, packet,
  byte and action fields. They are **valid records**: they count towards the
  `of <records>` total, but never as a REJECT. Their other fields are not checked.
- **Blank lines** are ignored silently and are not records.
- **Malformed lines** are skipped, counted, and never counted as records:
  - not exactly 14 fields;
  - version is not `2` (a header line `version account-id ...` fails here);
  - log-status is not `OK`, `NODATA` or `SKIPDATA`;
  - log-status is `OK` but the action is not exactly `ACCEPT` or `REJECT`.
- The last line may have no trailing newline; it still counts.

## Output format (stdout)

One line per destination port with at least one REJECT, `<dstport> <count>`,
sorted by count descending, ties broken by port **numerically** ascending
(`445` before `3389`). Then always a summary line, where `<records>` is the
number of valid records (`OK`, `NODATA` and `SKIPDATA`, not blank or malformed lines):

```
22 3
445 2
3389 2
23 1
8080 1
41322 1
49731 1
REJECT 11 of 18
```

A file with no REJECT records prints only the summary, e.g. `REJECT 0 of 4`.
An empty file prints `REJECT 0 of 0`.

## stderr and exit status

| Exit | When | stderr message contains |
|---|---|---|
| 0 | no REJECT records (including an empty file) | (nothing) |
| 1 | at least one REJECT record | (nothing) |
| 2 | not exactly one argument | `usage: flow_rejects.sh FILE` |
| 2 | FILE missing, unreadable or not a regular file | `cannot read` |

If malformed lines were skipped, also print
`flow_rejects.sh: skipped <N> malformed line(s)` on stderr. That is a warning:
it does not change the exit status. On exit 2 nothing is printed on stdout.

## Fixtures

| File | What it exercises |
|---|---|
| `normal.log` | 18 records, 11 REJECTs over 7 ports; ties at 2 (`445`/`3389`) and at 1 (`23`, `8080`, `41322`, `49731`) that only sort right numerically; ACCEPTs on rejected ports |
| `all-accept.log` | 4 ACCEPT records |
| `empty.log` | zero bytes |
| `nodata.log` | 2 REJECT, 1 ACCEPT, 2 `NODATA`, 1 `SKIPDATA` |
| `malformed.log` | a header line, 13 and 15 fields, version `3`, action `DROP`, log-status `PARTIAL`, a blank line, around 3 valid records |

The tests also make a file with no trailing newline, and try a missing file,
a directory, no arguments and two arguments.

## Hints

- awk splits on runs of whitespace, `NF` is the field count, and `$1 != "2"`
  is a string comparison, so it rejects `3` and `version` alike.
- Check the cheap structural rules first and `next` out of each one; then
  everything below that point is a valid record.
- `sort -k2,2nr -k1,1n`: count descending, then port ascending **numerically**.
  Without the `n` on the second key, `3389` sorts before `445`.
- Keep the summary line out of the sort: print it separately, or have awk
  print the per-port lines and the summary in a known order and split them.
- Capture awk's output and check its status before you sort it.

## Explain it aloud

1. A REJECT from `192.0.2.80` port `443` to `10.20.11.25` port `41322`. What
   kind of traffic is that, and which control most likely dropped it? (It is
   return traffic to an ephemeral port of a connection our host opened. Security
   groups are stateful and allow the return traffic automatically, so look at a
   stateless network ACL that is missing an inbound rule for 1024-65535.)
2. Lots of REJECTs to `22`, `23`, `445` and `3389` from many internet sources:
   is that the outage? What would you look for instead?
3. Why must the port tie-break be numeric? Show what `sort -k1,1` does with
   `445` and `3389`.
4. Why do `NODATA` records count towards the total but not as REJECTs? What
   would it mean if most of the records for an interface were `NODATA`, or
   `SKIPDATA`?
5. Flow logs say REJECT but not *which* rule rejected the packet. How would you
   tell a security group from a NACL using only flow logs? (Hint: a NACL
   rejection of a reply shows an ACCEPT for the request and a REJECT for the
   response; a security group never produces that pair.)
