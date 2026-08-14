# Linux Pocket Guide

A phone-first study guide for Linux fundamentals, built for interview prep — specifically the
kind of Linux/networking/troubleshooting depth expected of an **L5 Amazon Dedicated Cloud Engineer**.

No build step, no dependencies, no backend. Open `index.html` and it works — including offline,
once it has loaded a first time.

## What's in it

| Tab | Contents |
| --- | --- |
| **Commands** | 120 commands, beginner → intermediate, each with syntax, key options, worked examples, and an "interview note" naming the trap or the follow-up question |
| **Scenarios** | 35 real troubleshooting situations (disk full, OOM kill, can't SSH, DNS broken, port unreachable, read-only root, unbootable instance, NFS hang, TIME_WAIT exhaustion, ALB 502/504, fleet patching) as ordered command sequences, plus what the interviewer is actually scoring |
| **Drills** | 31 open-ended questions with model answers and the points to hit — boot sequence, fork/exec, permissions, OOM scoring, TCP handshake and TIME_WAIT, containers in kernel terms, LVM, SG vs NACL, on-call posture, and four behavioral/Leadership-Principle framings |
| **Quiz** | 10-question rounds, filterable by topic and level. Mixes 42 hand-written concept questions with questions generated from the command library, so it doesn't go stale |
| **Saved** | Star anything on any tab to build your own revision list |

Everything is searchable from one box at the top — command names, flags, example text, scenario
steps, drill answers. Search matches across tabs and tells you where the other hits are.

Topics are tagged: Files & Nav, Text, Search, Permissions, Processes, Disk, Users, Networking,
SSH & Transfer, Packages, System & systemd, Shell, Cloud / EC2, On-call, Behavioral.

## Using it on your phone

**Option 1 — GitHub Pages (recommended).** In this repo: *Settings → Pages → Build and deployment
→ Deploy from a branch*, pick this branch and `/ (root)`. Wait a minute, open the published URL on
your phone, then **Share → Add to Home Screen**. It installs as a standalone app, and the service
worker keeps it working with no signal — subway, plane, wherever.

**Option 2 — local.** Serve the folder over HTTP (the service worker needs it; `file://` won't
register one):

```bash
python3 -m http.server 8000
# then open http://<your-laptop-ip>:8000 on your phone, same Wi-Fi
```

Preferences persist in `localStorage`: theme, saved items, last tab, and a lifetime quiz score.

## Study loop that works

1. **Scenarios first.** These are what the interview actually asks — "the disk is full, walk me
   through it". Read the situation, say your answer out loud, then expand and compare.
2. **Drills for the open-ended questions.** Answer before you expand. Speaking it is the skill
   being tested, not recognising it.
3. **Quiz on a topic you just read**, to convert recognition into recall.
4. **Star your misses.** The Saved tab becomes your personal weak-spot list for the night before.

## Layout

```
index.html                     # markup + tab shell
manifest.webmanifest, sw.js    # PWA install + offline cache
icons/                         # generated app icons
assets/css/style.css           # mobile-first, dark by default, light theme toggle
assets/js/app.js               # rendering, search/filter, quiz engine, persistence
assets/js/data/
  commands-core.js             # files, text, search, text processing
  commands-system.js           # permissions, processes, disk, users, systemd, logs
  commands-net.js              # networking, SSH/transfer, archives, packages, shell, EC2
  commands-more.js             # LVM, tracing/perf, storage plumbing, accounts, time, SSM
  scenarios.js                 # troubleshooting walkthroughs
  scenarios-more.js            # fleet, storage, security, and AWS-side failure chains
  drills.js                    # open-ended drills + hand-written quiz bank
  drills-more.js               # second drill set + extra quiz questions
```

## Adding your own material

The data files are plain arrays — no schema tooling, no compile step. Add an entry, reload.

```js
LX.commands.push({
  name:'ss', cat:'net', level:'beginner',
  sum:'One-line description shown on the card.',
  syntax:'ss [options] [filter]',
  flags:[['-t','TCP only']],                 // optional
  ex:[['ss -tulpn','What this example is for']],
  tip:'The gotcha or the follow-up question.',   // optional
  related:['lsof','ip']                          // optional
});
```

Scenarios take `{title, cat, level, situation, steps:[[cmd, why]], key, followups}`; drills take
`{q, a, cat, level, points}`; quiz entries take `{q, choices, a:0, cat, level, why}` — put the
correct answer first, the app shuffles positions at runtime.

After changing any file, bump `CACHE` in `sw.js` so installed copies pick the update up.
