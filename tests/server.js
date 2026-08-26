#!/usr/bin/env node
/* Static file server for the UI suites. Runs as its own process: the runner
   uses spawnSync, which blocks the event loop, so an in-process server would
   never accept a connection while a suite was running. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(H.ROOT, rel);
  if (!file.startsWith(H.ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(H.PORT, '127.0.0.1', () => {
  process.stdout.write('ready\n');
  if (process.send) process.send('ready');
});
server.on('error', (e) => { console.error('server: ' + e.message); process.exit(1); });
