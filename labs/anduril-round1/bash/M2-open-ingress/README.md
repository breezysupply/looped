# M2 · Internet-open security group rules

**Time:** about 25 minutes. **Used in:** the scripting-only mock (Mock S).
**You edit:** `starter/open_ingress.sh`.
**Needs:** `jq` (`brew install jq`). **Test:** `./run-tests.sh starter M2` from `bash/`.

## The task

Security asks: "which of our security groups let the whole internet in on
something other than plain web traffic?" Write `open_ingress.sh [FILE]` that
reads `aws ec2 describe-security-groups` JSON from a file, or from stdin when
there is no argument (or the argument is `-`), and reports every ingress rule
open to `0.0.0.0/0` or `::/0`, except exactly TCP 80 and TCP 443.

```sh
./open_ingress.sh fixtures/mixed.json
aws ec2 describe-security-groups --output json | ./open_ingress.sh     # real use
```

## Input format

JSON shaped like `describe-security-groups` output (all IDs here are fictional):

```json
{ "SecurityGroups": [
    { "GroupId": "sg-0a1b2c3d4e5f60001",
      "GroupName": "bastion",
      "IpPermissions": [
        { "IpProtocol": "tcp", "FromPort": 22, "ToPort": 22,
          "IpRanges":   [ { "CidrIp": "0.0.0.0/0" } ],
          "Ipv6Ranges": [ { "CidrIpv6": "::/0" } ] } ] } ] }
```

Only `IpPermissions` (ingress) matters. `IpPermissionsEgress`, `UserIdGroupPairs`
and `PrefixListIds` are ignored: they are not "the whole internet".

| Situation | Treat as |
|---|---|
| `SecurityGroups` is `[]` | zero groups; fine (exit 0) |
| a group has no `IpPermissions` | no rules in it |
| a permission has no `IpRanges` or no `Ipv6Ranges` | no CIDRs of that family |
| no `GroupName` | name `-` |
| no `GroupId` | id `-` |
| `IpProtocol` is `"-1"` (all traffic; `FromPort`/`ToPort` are absent) | protocol `all`, ports `all` |

**Which rules are reported.** A permission is a finding for each of its CIDRs
that is exactly `0.0.0.0/0` (in `IpRanges[].CidrIp`) or `::/0` (in
`Ipv6Ranges[].CidrIpv6`), unless the permission is `IpProtocol` `"tcp"` with
`FromPort` = `ToPort` = `80`, or `FromPort` = `ToPort` = `443`. So these are
all reported: `tcp 22`, `udp 443`, `tcp 80-443`, `tcp 0-65535`, `-1`.
A narrower CIDR such as `203.0.113.10/32` or `10.0.0.0/8` is never reported,
even in the same permission as `0.0.0.0/0`.

## Output format (stdout)

One line per finding, **in input order** (groups, then their permissions, then
within a permission the IPv4 CIDRs before the IPv6 ones), five fields separated
by a single **tab**:

| Field | Value |
|---|---|
| group id | `GroupId`, or `-` |
| group name | `GroupName`, or `-` |
| protocol | `IpProtocol` as given (`tcp`, `udp`, ...), or `all` for `"-1"` |
| ports | `22` when `FromPort` = `ToPort`, `8000-8100` for a range, `all` for `"-1"` (or no `FromPort`) |
| cidr | `0.0.0.0/0` or `::/0` |

A permission open to both `0.0.0.0/0` and `::/0` gives **two** lines. Then
always a summary line counting every group seen and every line printed:

```
sg-0a1b2c3d4e5f60001<TAB>bastion<TAB>tcp<TAB>22<TAB>0.0.0.0/0
sg-0a1b2c3d4e5f60002<TAB>web-https<TAB>udp<TAB>443<TAB>0.0.0.0/0
sg-0a1b2c3d4e5f60003<TAB>web-http<TAB>tcp<TAB>80-443<TAB>0.0.0.0/0
sg-0a1b2c3d4e5f60004<TAB>debug-all<TAB>all<TAB>all<TAB>0.0.0.0/0
sg-0a1b2c3d4e5f60004<TAB>debug-all<TAB>all<TAB>all<TAB>::/0
sg-0a1b2c3d4e5f60005<TAB>app-range<TAB>tcp<TAB>8000-8100<TAB>::/0
sg-0a1b2c3d4e5f60007<TAB>-<TAB>tcp<TAB>0-65535<TAB>0.0.0.0/0
checked 8 group(s): 7 finding(s)
```

With no findings only the summary is printed, e.g. `checked 0 group(s): 0 finding(s)`.
(For `icmp` rules AWS stores the ICMP type and code in `FromPort`/`ToPort`; they
are printed the same way. The tests do not cover ICMP.)

## stderr and exit status

| Exit | When | stderr message contains |
|---|---|---|
| 0 | no findings, or no groups | (nothing) |
| 1 | at least one finding | (nothing) |
| 2 | more than one argument | `usage:` |
| 2 | FILE missing or unreadable | `cannot read` |
| 2 | input is empty (e.g. the upstream `aws` command failed) | `empty input` |
| 2 | input is not valid JSON | `invalid JSON` |
| 2 | valid JSON but no `SecurityGroups` array (wrong command's output) | `SecurityGroups` |
| 2 | `jq` is not installed | `jq is required` |

On exit 2 nothing is printed on stdout.

## Fixtures

| File | What it exercises |
|---|---|
| `mixed.json` | 8 groups: SSH open to the world next to an office `/32`; tcp 443 to both families (allowed) next to udp 443 (reported); tcp 80 (allowed) next to tcp 80-443 (reported); all traffic `-1` to `0.0.0.0/0` and `::/0`; tcp 8000-8100 to `::/0` with no `IpRanges`; a group with no `IpPermissions`; a group with no `GroupName` and tcp 0-65535; a group open only to `10.0.0.0/8` |
| `clean.json` | tcp 80/443 to the world, SSH from `198.51.100.0/24`, a self-referencing `-1` rule |
| `empty-groups.json` | `{ "SecurityGroups": [] }` |
| `malformed.json` | truncated JSON |
| `wrong-shape.json` | `describe-instances`-like output |

The tests also feed empty stdin, `-`, two arguments, a missing file, and run
the script with a `PATH` that has no `jq`.

## Hints

- Start from B2: the argument, stdin and validation part is the same.
- `.IpPermissions[]?` and `.IpRanges[]?.CidrIp` iterate without erroring when
  the key is missing. `a // b` supplies a default for `null` or missing.
- Bind the outer values before you descend: `(.GroupId // "-") as $id | .IpPermissions[]? | ...`
  keeps `$id` available on every row.
- `select((cond) | not)` reads better than pushing a negation through `and`/`or`.
- Build the list of findings once (`[ ... ] as $found`), then print
  `$found[] | @tsv` and `$found | length` from the same list.
- Numbers in string interpolation: `"\(.FromPort)-\(.ToPort)"`.

## Explain it aloud

1. Why is `tcp 80-443` from `0.0.0.0/0` a finding even though it "includes" 80
   and 443? What else does that range open?
2. A rule allows `0.0.0.0/0` but the instance is in a private subnet with no
   public IP. Is it still a finding? What would make it reachable later?
3. Security groups are stateful. What does that mean for the return traffic of
   an allowed inbound connection, and how is a network ACL different?
4. `aws ec2 describe-security-groups | ./open_ingress.sh`: the aws call fails.
   What does the script see, and why must it not print `0 finding(s)`?
5. Why one line per CIDR rather than one per rule? Why tab-separated?
