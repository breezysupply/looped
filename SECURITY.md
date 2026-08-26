# Security

## Reporting

Open a private security advisory through GitHub's "Report a vulnerability" flow on this
repository rather than a public issue.

## Threat model

`looped` is a static site with no backend, no accounts, and no network calls at runtime. It
stores progress in `localStorage` under `lx.*` keys, on the device, and sends it nowhere. There
is no telemetry.

The realistic risks are therefore:

- **Content injection.** Content files are plain JS that build HTML strings. Everything
  user-visible goes through `LXUtil.esc` or `fmt`; a contributed content file that bypasses them
  is the main way XSS could enter. Review content PRs for raw interpolation.
- **Service worker cache poisoning.** `sw.js` is cache-first. A bad deploy is sticky until the
  `CACHE` version is bumped, so treat the cache name as part of every release.
- **The simulated shell is a simulation.** `assets/js/shell.js` parses command strings and
  matches them against a virtual filesystem object. It does not execute anything, spawn
  anything, or touch the real system, and it must stay that way — no `eval`, no `Function`
  constructor, no dynamic `import` in the engine or in content.

## Not a security tool

The commands, playbooks and hardening content here are study material for interviews and
day-to-day operations. They describe defensive administration of systems you are authorised to
administer. Nothing in it should be run against infrastructure you do not own or operate.
