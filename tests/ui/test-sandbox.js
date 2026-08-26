const H = require('../helpers');
const { chromium } = require('playwright');

/* a real solution path for each mission, typed as a user would */
const SOLUTIONS = {
  'm-disk': [
    'df -h',
    'df -i',
    'du -h -d1 /var/log | sort -h',
    'find /var/log/app -type f -size +100M -exec ls -lh {} +',
    'sudo truncate -s 0 /var/log/app/app.log',
    'find /var/log/app -name "app.log-*" -mtime +2 -delete',
    'df -h /var',
    'cat /etc/logrotate.d/app'
  ],
  'm-nginx': [
    'systemctl status nginx',
    'journalctl -u nginx -n 20 --no-pager',
    'nginx -t',
    'diff -u /etc/nginx/nginx.conf.bak /etc/nginx/nginx.conf',
    'sudo sed -i "s/worker_connection /worker_connections /" /etc/nginx/nginx.conf',
    'nginx -t',
    'sudo systemctl restart nginx',
    'systemctl is-active nginx'
  ],
  'm-bind': [
    'ss -tulpn',
    'curl -s http://10.0.3.77:8080/health',
    'grep -n bind /etc/myapp/config.yml',
    'sudo sed -i "s/bind_host: 127.0.0.1/bind_host: 0.0.0.0/" /etc/myapp/config.yml',
    'sudo systemctl restart myapp',
    'ss -tulpn',
    'curl -s http://10.0.3.77:8080/health'
  ],
  'm-oom': [
    'systemctl status myapp',
    'dmesg -T | grep -i "out of memory"',
    'free -h',
    'systemctl cat myapp',
    'sudo sed -i "s/-Xmx3584m/-Xmx2g/" /etc/systemd/system/myapp.service',
    'sudo systemctl daemon-reload'
  ],
  'm-pipeline': [
    'wc -l access.log',
    "awk '{print $1}' access.log | sort | uniq -c | sort -rn",
    "awk '$7 >= 500 {print $6}' access.log | sort | uniq -c",
    'grep -c " 503 " access.log',
    "awk '{sum += $8} END {print sum}' access.log"
  ],
  'm-bash': [
    'while IFS=" " read -r name colour; do echo "$name is $colour"; done < fruit.txt',
    'for h in $(cat hosts.txt); do echo "checking $h"; done',
    'grep -c " red$" fruit.txt',
    'grep zzz fruit.txt; echo $?',
    'chmod +x deploy.sh; if [ -f deploy.sh ]; then echo runnable; fi'
  ]
};

(async () => {
  const browser = await chromium.launch(H.launchOptions());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(H.URL, { waitUntil: 'networkidle' });

  await H.go(page, 'sandbox');
  console.log('missions listed:', await page.locator('#sbList .lab-card').count());
  await page.screenshot({ path:H.shot('sb-list.png') });

  for (const [id, cmds] of Object.entries(SOLUTIONS)) {
    await page.waitForSelector('#sbList', { state: 'visible' });
    await page.click(`[data-mission="${id}"]`);
    await page.waitForSelector('#sbInput', { state: 'visible' });
    const total = await page.evaluate(m => LX.missions.find(x => x.id === m).objectives.length, id);

    let ranAll = true;
    for (const cmd of cmds) {
      if (!await page.locator('#sbInput').isVisible()) { ranAll = false; break; }  // solved early
      await page.fill('#sbInput', cmd);
      await page.locator('#sbRunBtn').click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(80);
    }
    if (!ranAll) console.log(`    [${id}] solved before the end of the script`);
    if (id === 'm-disk') await page.screenshot({ path:H.shot('sb-session.png') });

    const met = await page.locator('#sbObjectives .obj.met').count();
    const finished = await page.locator('#sbDone').isVisible().catch(() => false);
    const unmet = await page.locator('#sbObjectives .obj:not(.met)').allTextContents();
    console.log(`  ${id}: ${finished ? total : met}/${total} objectives${finished ? ' → debrief shown' : ''}` +
      (unmet.length && !finished ? ' | UNMET: ' + JSON.stringify(unmet) : ''));

    if (finished) {
      if (id === 'm-disk') await page.screenshot({ path:H.shot('sb-debrief.png') });
      await page.click('#sbBack');
    } else {
      await page.click('#sbExit');
    }
    await page.waitForSelector('#sbList', { state: 'visible' });
  }

  // free play + helpers
  await page.click('[data-mission="m-free"]');
  await page.waitForSelector('#sbInput', { state: 'visible' });
  await page.fill('#sbInput', 'help');
  await page.click('#sbRunBtn');
  await page.waitForTimeout(80);
  const helpShown = (await page.locator('#sbTerm').textContent()).includes('systemctl');
  console.log('free play help works:', helpShown);

  // tab completion
  await page.fill('#sbInput', 'cat /var/log/mes');
  await page.click('#sbTab');
  await page.waitForTimeout(60);
  console.log('tab completion →', JSON.stringify(await page.inputValue('#sbInput')));

  // key row inserts tokens
  await page.fill('#sbInput', '');
  await page.locator('#sbKeys .key').first().click();
  console.log('key row inserts →', JSON.stringify(await page.inputValue('#sbInput')));

  // history recall
  await page.fill('#sbInput', 'uptime');
  await page.click('#sbRunBtn');
  await page.click('#sbUp');
  console.log('history ↑ →', JSON.stringify(await page.inputValue('#sbInput')));

  // unknown command guidance
  await page.fill('#sbInput', 'kubectl get pods');
  await page.click('#sbRunBtn');
  await page.waitForTimeout(60);
  const term = await page.locator('#sbTerm').textContent();
  console.log('unknown command guidance:', term.includes('command not found') && term.includes('help'));

  // hint / reveal on an objective mission
  await page.click('#sbExit');
  await page.waitForSelector('#sbList', { state: 'visible' });
  await page.click('[data-mission="m-disk"]');
  await page.waitForSelector('#sbInput', { state: 'visible' });
  await page.click('#sbHint');
  await page.waitForTimeout(50);
  console.log('hint printed:', (await page.locator('#sbTerm').textContent()).includes('hint 1/3'));
  await page.click('#sbReveal');
  console.log('reveal prefills input:', JSON.stringify(await page.inputValue('#sbInput')));

  // reset restores the world
  await page.fill('#sbInput', 'sudo truncate -s 0 /var/log/app/app.log');
  await page.click('#sbRunBtn');
  await page.waitForTimeout(60);
  await page.click('#sbReset');
  await page.fill('#sbInput', 'df -h /var');
  await page.click('#sbRunBtn');
  await page.waitForTimeout(60);
  const afterReset = await page.locator('#sbTerm').textContent();
  console.log('reset restored the full disk:', /9[0-9]%|100%/.test(afterReset));

  await page.click('#sbExit');
  await page.reload({ waitUntil: 'networkidle' });
  await H.go(page, 'sandbox');
  console.log('solved badges after reload:', await page.locator('#sbList .badge.done').count());

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('horizontal overflow px:', overflow);
  console.log('ERRORS:', errs.length ? JSON.stringify(errs, null, 1) : 'none');
  await browser.close();
})();
