# looped

A phone-first trainer for troubleshooting judgement — the pocket kind, not the online-lab kind.
It started as Linux interview prep for an L5 cloud engineer role and is growing into the full
systems-engineering surface: containers and networking, AWS, identity and Microsoft 365,
Terraform, security and compliance, Azure, and AI-platform administration.

No build step, no dependencies, no backend. Open `index.html` and it works — including offline,
once it has loaded once.

## Tracks

Content is organised into **tracks**, chosen from the pill in the top bar. Everything — chip
rows, search, quiz pools, the review deck — scopes to the active track, so a domain you are not
studying never dilutes the one you are. **All tracks** mixes them deliberately.

| Track | State |
| --- | --- |
| **Linux** | Complete: 131 commands, 22 playbooks, 35 scenarios, 45 drills, 6 labs, 8 typed missions |
| **Containers & Networking** | Registered, empty — next to be built |

Tracks planned after that: AWS core, Identity & M365, IaC & automation, Security & compliance,
Azure, AI platform administration. The roadmap and its reasoning live in the plan file referenced
in `CONTRIBUTING.md`.

## What's in it

Four sections at the bottom, several pages each:

| Section | Contents |
| --- | --- |
| **Learn → Commands** | Every command with syntax, key options, worked examples, and an "interview note" naming the trap or the follow-up question |
| **Learn → Playbooks** | Decision trees for "what would you check next?", in two modes. **Flow** draws the whole tree as one column — question, arrow, command — and tapping a command opens what it is, why it is the move here, **the output you should expect** with the deciding line highlighted, and where it forks. **Walk** reveals one step at a time. Branches jump between trees; each ends with the common trap, the takeaway, likely follow-up probes, and a link into the matching sandbox mission. The 35 scenarios render through the same walker |
| **Learn → Drills** | Open-ended questions with model answers and the points to hit |
| **Practice → Labs** | Interactive incidents in a simulated terminal. Pick what you would run; wrong turns execute and explain why. Ends with a debrief, a scripted interview answer, and per-argument command breakdowns |
| **Practice → Sandbox** | A simulated box you **type into for real** — 70 commands with pipes, redirects, `for`/`while`/`if`, `$(…)` and globbing, against a virtual filesystem that changes as you act. Every lab has a typed version here. Objectives are met by **evidence**: a command has to produce the output that proves it, so a half-typed command does not count. `/hint` in the terminal gives a three-step ladder, `/reveal` the answer, and working `man` pages plus `guide <topic>` mean you never leave the app to look something up |
| **Quiz** | Five styles — Recall, Read the output, Safe or not, Order the steps, Build the command — in three modes: 10 questions, a 60-second speed round, or weak spots only |
| **Review** | Spaced repetition. Every miss becomes a flashcard automatically, graded Again / Hard / Good / Easy. Plus day streak, per-topic mastery bars weakest-first, and your starred items |

Everything is searchable from one box at the top, across pages, and it tells you where the other
hits are.

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

Everything persists in `localStorage` on that device: theme, active track, starred items, last
page, quiz accuracy per topic, lab and mission scores, your review deck and its schedule, and
your day streak. Nothing leaves the phone and there is no account to create — which also means
nothing restores it if you lose the device, so **Review → Your progress → Export** is worth doing
before you change phones.

## Study loop that works

0. **Playbook first** when you have no idea where to start. Walk the framework tree, then the tree
   for the symptom you were given. Read the talk track out loud before you look at the steps.
1. **Labs next.** Work the incident before you read about it — the wrong turns teach more than
   the right ones, and you never have to type on a phone. Aim for a clean first-try run.
1b. **Then the same incident in the Sandbox**, where you type the commands yourself. Recognising
   the right answer and producing it cold are different skills, and only the second one survives
   an interview. Use the key row so you are tapping, not typing, the long paths.
2. **Scenarios** for the same situations in condensed form — read the situation, say your answer
   out loud, then expand and compare.
3. **Drills for the open-ended questions.** Answer before you expand. Speaking it is the skill
   being tested, not recognising it.
4. **Quiz on a topic you just read**, to convert recognition into recall. "Read the output" is the
   closest thing here to what a real screen-share interview feels like.
5. **Review daily.** Anything you miss in a quiz or a lab becomes a flashcard automatically, so the
   deck builds itself out of your actual weak spots. Two minutes a day beats an hour on Sunday.
6. **Check the mastery bars** before the interview — they are sorted weakest-first on purpose.

## Layout

```
index.html                     # markup + nav shell
manifest.webmanifest, sw.js    # PWA install + offline cache
icons/                         # generated app icons
assets/css/style.css           # mobile-first, dark by default, light theme toggle
assets/js/app.js               # rendering, search/filter, quiz engine, persistence
assets/js/shell.js             # the simulated shell: VFS, 70 commands, parser (no DOM)
assets/js/sandbox.js           # sandbox UI: terminal, objectives, keypad, debrief
assets/js/playbook.js          # playbook walker: step reveal, branches, expand all
assets/js/lab.js               # interactive lab engine: terminal, steps, debrief
assets/js/quiz.js              # five question styles, three modes
assets/js/review.js            # spaced repetition, flashcards, streak, mastery stats
tests/                         # validators (node) + Playwright suites; see CONTRIBUTING.md
assets/js/data/
  tracks.js                    # the track registry — categories live here, not in app.js
  commands-core.js             # files, text, search, text processing
  commands-system.js           # permissions, processes, disk, users, systemd, logs
  commands-net.js              # networking, SSH/transfer, archives, packages, shell, EC2
  commands-more.js             # LVM, tracing/perf, storage plumbing, accounts, time, SSM
  scenarios.js                 # troubleshooting walkthroughs
  scenarios-more.js            # fleet, storage, security, and AWS-side failure chains
  drills.js                    # open-ended drills + hand-written quiz bank
  drills-more.js               # second drill set + extra quiz questions
  quiz-extra.js                # output-reading and hazard questions
  labs.js, labs-more.js        # interactive labs
  missions.js                  # sandbox worlds + objectives
  playbooks.js, playbooks-more.js  # decision trees
  playbook-outputs.js          # sample output for every playbook step, with highlights
```

## Adding your own material

The data files are plain arrays — no schema tooling, no compile step. Add an entry, reload. Run
`npm run test:data` before committing: it validates tracks, categories, ids, cross-references and
output highlights in about two seconds.

Every record may carry `track`. Anything without one is Linux, which is what the whole library
was before tracks existed. A new track goes in `assets/js/data/tracks.js` **with its own category
map** — a category that is not registered for its track is a validation failure rather than
something that silently vanishes from the chip rows.

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

Two quiz styles need no authoring at all — **Order the steps** is generated from scenario and lab
step sequences, and **Build the command** is generated from the worked examples on each command.
Add a command or a scenario and the quiz bank grows with it. Hand-authored output-reading and
hazard questions live in `quiz-extra.js`:

```js
LX.outputQs.push({ cat:'disk', level:'beginner', cmd:'df -h',
  out:'…real terminal output…', q:'What does this tell you?',
  choices:['correct first', '…'], a:0, why:'the teaching point' });
```

A sandbox mission is a world seed plus objectives that inspect real state:

```js
LX.missions.push({
  id:'m-disk', title:'/var is 100% full', labId:'disk-full',   // labId reuses that lab's debrief
  cat:'disk', level:'beginner', mins:8, kind:'incident',
  brief:'The pager text.',
  keys:['df -h', 'du -h -d1', '/var/log'],        // the tappable key row
  world:{ user:'ec2-user', host:'ip-10-0-4-118',
    disks:[{ fs:'/dev/nvme1n1', size:20*GB, base:900*MB, mount:'/var', inodes:1310720, iused:41003 }],
    files:[{ path:'/var/log/app/app.log', size:12*GB, owner:'appsvc', fake:'…sample lines…' }],
    procs:[{ pid:8123, cmd:'java …', open:['/var/log/app/app.log'] }],  // holds the file open
    units:{ myapp:{ active:true, enabled:true, validate:fn, onStart:fn } },
    extra:{ nginx:function (w, args) { … } }      // mission-specific binaries
  },
  objectives:[{ id:'reclaim', text:'Get /var below 50%', hint:'…', reveal:'truncate -s 0 …',
    done:function (c) { /* c.w = world, c.ran = commands, c.last = last output */ } }]
});
```

Every objective carries `hint` (the nudge) and `reveal` (the exact command). The middle hint is
derived automatically — it names the commands inside `reveal` and points you at `man <cmd>` — so
adding an objective gives you the full three-step ladder for free. Add `hint2` to override it.

Objectives are checked against evidence, not against strings. `did(cmdRe, outRe)` requires that a
command matching `cmdRe` produced output of its own matching `outRe`, so `systemctl cat` with no
unit — which prints "Unit .service could not be found" — does not tick "find the heap ceiling",
while `systemctl cat myapp` and `ps -eo cmd | grep Xmx` both do. State checks against the world
count too: any command that genuinely gets the disk under 50% passes. `size` without `content` models a huge file (with `fake` sample lines
for grep/head), and a file listed in a process's `open` array keeps its blocks when unlinked, so
the deleted-but-held-open trap behaves correctly.

Adding a data file means adding it to **both** `index.html` and `sw.js`'s `ASSETS` list, then
bumping `CACHE` in `sw.js` so installed copies pick the update up. `npm run test:data` fails if
the two lists disagree.
