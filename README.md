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
| **Labs** | 6 interactive incidents in a simulated terminal — 49 steps, 157 command choices. Pick what you would run; wrong turns execute and explain why they were wrong. Ends with a debrief: what you did and why it worked, a scripted interview answer, expandable per-argument command breakdowns, and prevention notes |
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

1. **Labs first.** Work the incident before you read about it — the wrong turns teach more than
   the right ones, and you never have to type on a phone. Aim for a clean first-try run.
2. **Scenarios** for the same situations in condensed form — read the situation, say your answer
   out loud, then expand and compare.
3. **Drills for the open-ended questions.** Answer before you expand. Speaking it is the skill
   being tested, not recognising it.
4. **Quiz on a topic you just read**, to convert recognition into recall.
5. **Star your misses.** The Saved tab becomes your personal weak-spot list for the night before.

## Layout

```
index.html                     # markup + tab shell
manifest.webmanifest, sw.js    # PWA install + offline cache
icons/                         # generated app icons
assets/css/style.css           # mobile-first, dark by default, light theme toggle
assets/js/app.js               # rendering, search/filter, quiz engine, persistence
assets/js/lab.js               # interactive lab engine: terminal, steps, debrief
assets/js/data/
  commands-core.js             # files, text, search, text processing
  commands-system.js           # permissions, processes, disk, users, systemd, logs
  commands-net.js              # networking, SSH/transfer, archives, packages, shell, EC2
  commands-more.js             # LVM, tracing/perf, storage plumbing, accounts, time, SSM
  scenarios.js                 # troubleshooting walkthroughs
  scenarios-more.js            # fleet, storage, security, and AWS-side failure chains
  drills.js                    # open-ended drills + hand-written quiz bank
  drills-more.js               # second drill set + extra quiz questions
  labs.js, labs-more.js        # interactive labs
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

A lab is a list of steps, each with one or more correct options:

```js
LX.labs.push({
  id:'disk-full', title:'/var is 100% full', cat:'disk', level:'beginner', mins:6,
  brief:'The pager text — what you know when you get the shell.',
  user:'ec2-user', host:'ip-10-0-4-118',
  steps:[{
    kind:'cmd',                       // 'cmd' echoes into the terminal; 'think' does not
    ask:'Confirm the problem. What do you run first?',
    hint:'Optional nudge, shown on demand.',
    opts:[
      { c:'df -h', ok:true,
        out:'realistic terminal output',
        fb:'Why this was the right call.',
        parts:[['df','What the command does'],['-h','What the flag does']] },
      { c:'du -sh /var', out:'...', fb:'Why this is a detour, not a disaster.' }
    ]
  }],
  debrief:{ why:['step-by-step reasoning'], interview:'the spoken answer', prevent:['...'] }
});
```

More than one option per step may be marked `ok:true` when several approaches are genuinely
valid. Every option needs `fb`; `parts` is what powers the expandable command reference.

After changing any file, bump `CACHE` in `sw.js` so installed copies pick the update up.
