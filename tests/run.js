#!/usr/bin/env node
/* Runs every suite and reports one summary. Data suites need no browser and no
   server; UI suites get a static server started here and torn down after.

     node tests/run.js          all suites
     node tests/run.js data     validators only (fast, no browser)
     node tests/run.js ui       browser suites only
*/
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const which = process.argv[2] || 'all';

/* The server has to be its own process: spawnSync below blocks this event loop. */
function serve() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'server.js')],
                        { stdio: ['ignore', 'pipe', 'inherit'] });
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('ready')) { clearTimeout(timer); resolve(child); }
    });
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error('server exited ' + c)); });
  });
}

function run(file) {
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  /* a suite fails on a non-zero exit, an uncaught throw, or a reported page error */
  const failed = r.status !== 0 || /ERRORS: \[/.test(out) || /\bFAIL\b/.test(out) ||
                 /problems: [1-9]/.test(out) || /, [1-9]\d* (?:wrong|problems)/.test(out);
  return { failed, out };
}

(async () => {
  const dataSuites = fs.readdirSync(path.join(__dirname, 'data'))
    .filter(f => f.endsWith('.js')).map(f => path.join(__dirname, 'data', f)).sort();
  const uiSuites = fs.readdirSync(path.join(__dirname, 'ui'))
    .filter(f => f.endsWith('.js')).map(f => path.join(__dirname, 'ui', f)).sort();

  const suites = which === 'data' ? dataSuites : which === 'ui' ? uiSuites
    : dataSuites.concat(uiSuites);
  const needsServer = suites.some(s => s.includes(`${path.sep}ui${path.sep}`));

  let server = null;
  if (needsServer) server = await serve();

  let failures = 0;
  for (const s of suites) {
    const name = path.relative(__dirname, s);
    process.stdout.write(`\n──── ${name}\n`);
    const { failed, out } = run(s);
    process.stdout.write(out.replace(/^/gm, '  '));
    if (failed) { failures++; process.stdout.write(`  ✗ ${name} FAILED\n`); }
  }

  if (server) server.kill();
  console.log(`\n${suites.length - failures}/${suites.length} suites passed`);
  process.exit(failures ? 1 : 0);
})();
