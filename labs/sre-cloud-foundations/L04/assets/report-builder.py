#!/usr/bin/env python3
"""L04 CPU fixture: a 'report builder' batch job that has gone into a busy
loop. Bounded on purpose: it forks at most --workers busy children (capped at
4), every process exits by itself after --max-seconds (capped at 900), and the
parent forwards SIGTERM/SIGINT to its children. It never allocates memory or
writes files, so it can only cost CPU time inside the course VM.
"""
import argparse
import os
import signal
import sys
import time


def busy(deadline: float) -> None:
    x = 0
    while time.monotonic() < deadline:
        for _ in range(200000):
            x = (x * 1103515245 + 12345) & 0x7FFFFFFF
    os._exit(0)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--rebuild-all", action="store_true")
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--max-seconds", type=int, default=600)
    a = p.parse_args()
    workers = max(1, min(a.workers, 4))
    deadline = time.monotonic() + max(10, min(a.max_seconds, 900))
    children = []
    for _ in range(workers):
        pid = os.fork()
        if pid == 0:
            busy(deadline)
        children.append(pid)

    def stop(signum, _frame):
        for c in children:
            try:
                os.kill(c, signal.SIGTERM)
            except ProcessLookupError:
                pass
        sys.exit(128 + signum)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    for c in children:
        try:
            os.waitpid(c, 0)
        except ChildProcessError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
