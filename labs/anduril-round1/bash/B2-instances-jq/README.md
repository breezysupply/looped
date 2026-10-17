# B2 · Non-running instances with jq

**Time:** about 15 minutes. **You edit:** `starter/non_running.sh`.
**Needs:** `jq` (`brew install jq`). **Test:** `./run-tests.sh starter B2` from `bash/`.

## The task

During an incident someone runs `aws ec2 describe-instances` and wants to know
which instances are not running. Write `non_running.sh [FILE]` that reads that
JSON from a file, or from stdin when there is no argument (or the argument is
`-`), and lists every instance whose state is not `running`.

```sh
./non_running.sh fixtures/mixed.json
aws ec2 describe-instances --output json | ./non_running.sh     # real use
```

## Input format

JSON shaped like `describe-instances` output (all IDs here are fictional):

```json
{ "Reservations": [
    { "Instances": [
        { "InstanceId": "i-0a1b2c3d4e5f00002",
          "State": { "Code": 80, "Name": "stopped" },
          "Tags": [ { "Key": "Name", "Value": "web-2" } ] } ] } ] }
```

Be defensive, as real output varies:

| Situation | Treat as |
|---|---|
| `Reservations` is `[]` | zero instances; fine (exit 0) |
| a reservation has no `Instances` key, or `[]` | zero instances in it |
| no `Tags`, or no tag with `Key` `Name` | name `-` |
| no `State` / `State.Name` | state `unknown` (reported: it is not `running`) |
| no `InstanceId` | id `-` |
| any state other than `running` (`pending`, `stopping`, `stopped`, `shutting-down`, `terminated`, ...) | reported |

## Output format (stdout)

One line per non-running instance, **in input order**, three fields separated
by a single **tab**: instance id, state, Name tag (or `-`). Then always a summary
line counting every instance seen:

```
i-0a1b2c3d4e5f00002<TAB>stopped<TAB>web-2
i-0a1b2c3d4e5f00003<TAB>terminated<TAB>-
i-0a1b2c3d4e5f00004<TAB>pending<TAB>-
i-0a1b2c3d4e5f00005<TAB>unknown<TAB>batch worker
checked 5 instance(s): 4 not running
```

Tabs, because a Name tag may contain spaces (`batch worker`). `jq -r '... | @tsv'`
produces exactly this. With no non-running instances only the summary line is
printed, e.g. `checked 0 instance(s): 0 not running`.

## stderr and exit status

| Exit | When | stderr message contains |
|---|---|---|
| 0 | every instance is running, or there are none | (nothing) |
| 1 | at least one instance is not running | (nothing) |
| 2 | more than one argument | `usage:` |
| 2 | FILE missing or unreadable | `cannot read` |
| 2 | input is empty (e.g. the upstream `aws` command failed) | `empty input` |
| 2 | input is not valid JSON | `invalid JSON` |
| 2 | valid JSON but no `Reservations` array (wrong command's output) | `Reservations` |
| 2 | `jq` is not installed | `jq is required` |

On exit 2 nothing is printed on stdout.

## Fixtures

`mixed.json` (running, stopped, terminated without tags, pending without a Name
tag, missing State, empty and missing `Instances`), `all-running.json`,
`empty-reservations.json`, `malformed.json` (truncated), `wrong-shape.json`
(`describe-volumes`-like). The tests also feed empty stdin.

## Hints

- `jq empty` parses and prints nothing: a cheap validity check (exit status!).
- `jq -e` sets the exit status from the last value (`false`/`null` -> 1), handy
  for a shape check like `(.Reservations | type) == "array"`.
- `a // b` gives `b` when `a` is `null` or missing. `.Instances[]?` iterates
  without erroring when `Instances` is absent.
- Read stdin once into a variable (`input=$(cat)`) if you need to run jq more
  than once; stdin can only be read once.

## Explain it aloud

1. `aws ec2 describe-instances | ./non_running.sh`: the aws call fails (expired
   credentials). What does your script see, and why must it not exit 0?
2. What is `$?` after `aws ... | jq ...`? Whose failure is lost, and what does
   `set -o pipefail` change? Why is that still not enough on its own?
3. Why tab-separated output rather than spaces? Why `jq -r`?
4. Why do diagnostics go to stderr? Show what happens with
   `./non_running.sh bad.json > report.txt` if they went to stdout.
