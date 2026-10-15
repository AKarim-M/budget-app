#!/usr/bin/env node
// Screen check: serves the app, opens each tab in headless Chrome with the made-up demo
// household on a fixed day, and checks the rendered page shows the right numbers.
//   node tools/smoke.mjs                 checks
//   node tools/smoke.mjs --shots <dir>   also saves phone-size screenshots
// Uses a throwaway Chrome profile, never your own.

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { startServer, BASE } from './serve.mjs';

const run = promisify(execFile);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const shotsAt = process.argv.indexOf('--shots');
const shotsDir = shotsAt > 0 ? resolve(process.argv[shotsAt + 1]) : null;

const DAY = '2026-10-15';
const PAGES = [
  ['home', `?demo=1&today=${DAY}#home`, ['Left to spend', '₱5,778.50', 'until the Nov 14 cut-off', 'Until the Dec 7 bill', '₱35,778.50', 'adds Nov 17, 24 &amp; Dec 1 pay', '₱4,950.00', '₱23,171.50', 'Supermarket', 'Jeepney', 'Tue Oct 20 +₱10,000.00']],
  ['plan', `?demo=1&today=${DAY}#plan`, ['School fees', 'Nov 7 bill', 'pay the card after your salary lands', 'interest is likely', 'Lowest point: ₱2,950.00 on Mon Oct 26']],
  ['spending', `?demo=1&today=${DAY}#spending`, ['Oct 15 – Nov 14', 'Food &amp; Dining', '₱350.00', '₱1,820.75']],
  ['settings', `?demo=1&today=${DAY}#settings`, ['every Tuesday', 'Cut-off on the 15th', 'bill due on the 7th', 'Appliance installment']],
  ['wizard', `?demo=empty&today=${DAY}`, ['Welcome', 'Your name on this device']],
];

async function chrome(profile, args) {
  const { stdout } = await run(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', `--user-data-dir=${profile}`, '--virtual-time-budget=5000', ...args,
  ], { timeout: 90_000, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

const server = await startServer({ port: 0, cache: 'no-store' });
const origin = `http://127.0.0.1:${server.address().port}${BASE}`;
const profile = mkdtempSync(join(tmpdir(), 'budget-smoke-'));
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

let failed = 0;
try {
  for (const [name, path, expected] of PAGES) {
    const dom = await chrome(profile, ['--dump-dom', origin + path]);
    const missing = expected.filter((text) => !dom.includes(text));
    if (missing.length) {
      failed += 1;
      console.log(`✗ ${name}: missing ${missing.map((m) => JSON.stringify(m)).join(', ')}`);
    } else {
      console.log(`✓ ${name}`);
    }
    if (shotsDir) {
      await chrome(profile, ['--window-size=412,915', '--hide-scrollbars', `--screenshot=${join(shotsDir, `${name}.png`)}`, origin + path]);
    }
  }
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

if (failed) {
  console.log(`${failed} screen check(s) failed`);
  process.exit(1);
}
console.log('All screen checks passed');
