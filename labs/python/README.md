# Python automation labs

Three practical scripting exercises for infrastructure interviews. They are
not algorithm puzzles. Each one is a small tool an ops engineer would really
write: it reads messy real-world input, makes a judgement, and reports it
with the right exit code.

| # | Exercise | You build | Time | Main ideas |
|---|---|---|---|---|
| 01 | [`01-pod-health`](01-pod-health/) | Summarise `kubectl get pods -o json`: what is unhealthy, which workload it belongs to, and why | ~45 min | parsing nested JSON defensively, Running ≠ Ready, 137 ≠ OOMKilled, owner grouping, exit codes |
| 02 | [`02-retry`](02-retry/) | A `retry()` helper with capped exponential backoff, full jitter, a deadline and error classification | ~40 min | retryable vs permanent errors, jitter vs retry storms, injecting time so it is testable |
| 03 | [`03-artifact-manifest`](03-artifact-manifest/) | Verify a release bundle against a SHA-256 manifest | ~45 min | streaming hashes, path traversal and symlink escapes, integrity vs authenticity |

Requirements: **Python 3.9+, standard library only.** Nothing to install.

## Layout of each exercise

```
NN-name/
  README.md            the task: behaviour, examples, fixtures, hints (no solution)
  <module>.py          STARTER: signatures + docstrings; bodies raise NotImplementedError
  fixtures/            realistic input files (01 and 03)
  tests/               unittest tests (tests/__init__.py makes it a package)
  solution/<module>.py reference solution, heavily commented
  solution/EXPLANATION.md  walkthrough and design choices
  broken/<variant>/<module>.py  plausible-but-wrong versions the tests must catch
```

How to work through one:

1. Read `README.md` and look at the fixtures.
2. Fill in the starter `<module>.py` in the exercise directory. Run the tests
   often.
3. When everything is green, or you are stuck, read `solution/` and
   `EXPLANATION.md`.
4. Read each `broken/<variant>`, say out loud what is wrong and which test
   will catch it, then run the tests against it to check.

## Running the tests

Always run from inside the exercise directory. **`PYTHONPATH` chooses which
implementation is tested:**

```sh
cd labs/python/01-pod-health

PYTHONPATH=. python3 -m unittest discover -s tests -t .                        # your starter
PYTHONPATH=solution python3 -m unittest discover -s tests -t .                 # reference solution
PYTHONPATH=broken/running-is-healthy python3 -m unittest discover -s tests -t . # a broken variant

# pytest works too, if you have it
PYTHONPATH=solution python3 -m pytest -q
```

Before you start, the starter fails cleanly: every test **errors** with
`NotImplementedError`, and none fail on import.

### How the tests are structured

- Each test module imports the code under test **by plain name**
  (`import pod_health`, `import retry`, `import manifest_check`), so the same
  tests run unchanged against the starter, the solution and every broken
  variant.
- `python -m unittest` and pytest both put the current directory at the
  **front** of `sys.path`, ahead of `PYTHONPATH`. The exercise directory
  holds the starter, so it would shadow `solution/`. To stop that, each test
  module re-inserts the `PYTHONPATH` entries at the front of `sys.path`
  before importing. `PYTHONPATH` then always wins, and with no `PYTHONPATH`
  you get the starter.
- Fixtures are found relative to the **test file**
  (`Path(__file__).resolve().parent.parent / "fixtures"`), never relative to
  the module under test. That is why `solution/` and `broken/*/` contain only
  the module.
- Tests check **behaviour**, not implementation: given this realistic input,
  this is the verdict, the exit code, the error type. Malformed input and
  failure paths get as much attention as the happy path.
- Nothing touches the network or really sleeps. `02-retry` passes a fake
  clock, sleep and random number source. `03-artifact-manifest` builds its
  symlink scenarios in a temporary copy of the bundle.

## Interview habits these exercises practise

- **Separate logic from I/O.** Pure functions (`summarize`, `check`) return
  data. Only `main()` prints and picks exit codes. `main()` returns the code
  instead of calling `sys.exit()`, so tests can call it.
- **Validate at the edge, fail with a precise message.** Raise a named
  exception (`MalformedInput`, `MalformedManifest`) that says *where* the
  problem is. Never let a `KeyError` traceback be the user interface.
- **Exit codes mean something:** 0 OK, 1 problem found, 2 could not tell.
- **Deterministic output:** sorted lists and stable keys, so runs can be
  diffed and tested.
- **Explain the limits** of what the tool proves. An inferred Deployment name
  is not a fact, a retry can make an outage worse, and a checksum is not a
  signature.
