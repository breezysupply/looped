"""`python3 -m beacon <api|worker|client|validate-config> ...`"""
import sys


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print("usage: python3 -m beacon {api|worker|client|validate-config} [args]")
        return 2
    cmd, rest = sys.argv[1], sys.argv[2:]
    if cmd == "api":
        from .api import main as m
        return m(rest)
    if cmd == "worker":
        from .worker import main as m
        return m(rest)
    if cmd == "client":
        from .client import main as m
        return m(rest)
    if cmd == "validate-config":
        from .api import main as m
        return m(["--validate"] + rest)
    print(f"unknown command {cmd!r}; expected api, worker, client or validate-config")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
