/* Shared test plumbing. Everything that used to be hardcoded to one machine —
   repo path, browser binary, server port, screenshot directory — resolves here
   so the suites run on a clean clone and in CI. */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(ROOT, 'tests', '.artifacts');
const PORT = Number(process.env.LX_PORT || 8099);
const URL = process.env.LX_URL || `http://127.0.0.1:${PORT}/index.html`;

/* Playwright resolves its own browser when the versions line up. They do not in
   an environment with a preinstalled browser pinned to a different build, so fall
   back to LX_CHROMIUM, then to whatever chromium is sitting in
   PLAYWRIGHT_BROWSERS_PATH, before giving up and letting Playwright complain. */
function launchOptions() {
  const named = process.env.LX_CHROMIUM || process.env.CHROME_PATH;
  if (named && fs.existsSync(named)) return { executablePath: named };
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (dir && fs.existsSync(dir)) {
    const found = fs.readdirSync(dir)
      .filter(d => /^chromium-\d+$/.test(d))
      .sort()
      .map(d => path.join(dir, d, 'chrome-linux', 'chrome'))
      .filter(f => fs.existsSync(f));
    if (found.length) return { executablePath: found[found.length - 1] };
  }
  return {};
}

function repoFile(...p) { return path.join(ROOT, ...p); }

function shot(name) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  return path.join(ARTIFACTS, name);
}

/* Load the content data files into this process, in the order index.html does,
   with just enough of a window for them to register themselves. */
function loadContent(extra) {
  global.window = global;
  global.LX = {
    commands: [], scenarios: [], drills: [], quiz: [], labs: [],
    missions: [], playbooks: [], outputQs: [], dangerQs: []
  };
  if (extra && extra.shell) {
    global.LXShell = require(repoFile('assets/js/shell.js'));
    /* track extensions register their verbs through LXShell.register */
    fs.readdirSync(repoFile('assets/js')).forEach(function (f) {
      if (/^shell-.*\.js$/.test(f)) require(repoFile('assets/js', f));
    });
  }
  const dir = repoFile('assets/js/data');
  order().forEach(function (f) {
    if (fs.existsSync(path.join(dir, f))) require(path.join(dir, f));
  });
  return global.LX;
}

/* Every content file, in load order: the eager tags in index.html first, then
   each track's own files from the registry. Scraping index.html alone would now
   miss every lazy track and the validators would pass on a fraction of the
   library without saying so. */
function order() {
  const html = fs.readFileSync(repoFile('index.html'), 'utf8');
  const eager = [...html.matchAll(/src="assets\/js\/(data\/[^"]+)"/g)].map(m => m[1]);
  const out = eager.slice();
  trackRegistry().forEach(function (t) {
    (t.files || []).forEach(function (f) {
      const rel = f.replace(/^assets\/js\//, '');
      if (rel.indexOf('data/') === 0 && out.indexOf(rel) === -1) out.push(rel);
    });
  });
  return out.map(f => f.replace(/^data\//, ''));
}

/* Read data/tracks.js without a DOM — the same trick tools/build.js uses. */
function trackRegistry() {
  const vm = require('vm');
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(repoFile('assets/js/data/tracks.js'), 'utf8'), sandbox);
  return sandbox.LX.tracks;
}

/* Everything a browser would ever execute, eager or lazy. */
function allScripts() {
  const html = fs.readFileSync(repoFile('index.html'), 'utf8');
  const eager = [...html.matchAll(/src="(assets\/js\/[^"]+)"/g)].map(m => m[1]);
  const out = eager.slice();
  trackRegistry().forEach(function (t) {
    (t.files || []).forEach(function (f) { if (out.indexOf(f) === -1) out.push(f); });
  });
  return out;
}

/* The four bottom tabs group several views each; tests address views by name. */
const GROUP_OF = {
  commands: 'learn', playbooks: 'learn', drills: 'learn',
  labs: 'practice', sandbox: 'practice', quiz: 'quiz', review: 'review'
};
async function go(page, view) {
  await page.click(`.tab[data-group="${GROUP_OF[view]}"]`);
  const seg = page.locator(`#subnav .seg[data-view="${view}"]`);
  if (await seg.count()) await seg.click();
  await page.waitForTimeout(100);
}

/* Horizontal overflow in px — the phone-layout regression that keeps recurring. */
function overflow(page) {
  return page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

module.exports = { ROOT, ARTIFACTS, PORT, URL, launchOptions, repoFile, shot,
                   loadContent, order, allScripts, trackRegistry, go, overflow, GROUP_OF };
