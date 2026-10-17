#!/bin/sh
# mock_check.sh HOST PORT - stand-in for a real network check (no network used).
# The host name decides the result:
#   ok*    -> exit 0 (up)        fail* -> exit 1 (refused/down)
#   hang*  -> never answers (sleeps 10 s; the caller's timeout must cut it off)
#   other  -> exit 3
[ "$#" -eq 2 ] || { echo "mock_check: want HOST PORT, got $#" >&2; exit 64; }
case $2 in ''|*[!0-9]*) echo "mock_check: bad port '$2'" >&2; exit 64 ;; esac
case $1 in
  ok*) exit 0 ;;
  fail*) exit 1 ;;
  hang*) exec sleep 10 ;;
  *) exit 3 ;;
esac
