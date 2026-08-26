# Contributing

`looped` is a static offline PWA: no build step to run the app, no runtime dependencies, no
backend. Open `index.html` through a local server and it works.

## Running it

```sh
node tests/server.js      # serves the repo at http://127.0.0.1:8099
```

A plain `file://` open will not work — the service worker and the module load order both need
an HTTP origin.

## Running the tests

```sh
npm install               # playwright, for the UI suites only
npx playwright install chromium
npm test                  # everything
npm run test:data         # validators only: no browser, no server, ~2s
npm run test:ui           # browser suites
```

`tests/data/` holds validators that run in plain node against the content files. They are fast
and they are the ones that matter most when writing content:

| Suite | What it guarantees |
|---|---|
| `test-missions.js` | Every sandbox mission is solvable by its own `reveal` commands. |
| `test-strict.js` | Fragments, typos and wrong-target commands do **not** complete an objective. |
| `check-marks.js` | Every playbook output highlight appears in its output, is not so short it lands on unrelated digits, never only matches mid-token, and never nests. |

`tests/ui/` holds Playwright suites covering the lab, sandbox, quiz, review, playbook, flow-mode
and navigation flows, each asserting zero horizontal overflow at 390 px — the phone-layout
regression that keeps recurring.

Set `LX_CHROMIUM=/path/to/chrome` if Playwright cannot find a browser.

## Writing content

Content lives in `assets/js/data/` as plain JS files that push onto `window.LX.*` arrays. Adding
a file means adding it to **both** `index.html` and `sw.js`'s `ASSETS` list — `cache.addAll` is
all-or-nothing, so a missing entry silently breaks offline mode for everyone.

Two rules that are not obvious:

**Objectives check evidence, not strings.** A sandbox objective is met when a command *produced*
the output that proves it, using `did(cmdRe, outRe)` in `missions.js` — not when the command name
was typed. `systemctl cat` with no unit prints "Unit .service could not be found", which contains
no heap setting, so it does not count. Add a case to `test-strict.js` for any new objective.

**Output highlights must be unambiguous.** A one- or two-character `mark` lights up every stray
digit in a `top` header. `check-marks.js` enforces this; run it before committing.

## Style

Match the surrounding code: ES5-compatible plain JS, no framework, IIFE modules registering a
single `window.LX*` singleton, comments that explain *why* rather than restating the line.
