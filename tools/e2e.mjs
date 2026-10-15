#!/usr/bin/env node
// End-to-end walkthrough on a phone-size screen: set up the app through the wizard, add planned
// payments, schedule card payments, log spending, and check the numbers the screen shows.
// Also checks every tab for sideways overflow and JavaScript errors.
//   node tools/e2e.mjs                 synthetic household (+ local/e2e.local.json if present, git-ignored)
//   node tools/e2e.mjs --shots <dir>   also save full-page screenshots, light and dim

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer, BASE } from './serve.mjs';
import { launchChrome, openPage, HELPERS } from './cdp.mjs';

const J = JSON.stringify;
const shotsAt = process.argv.indexOf('--shots');
const shotsDir = shotsAt > 0 ? resolve(process.argv[shotsAt + 1]) : null;

const SYNTHETIC = {
  name: 'Alex',
  today: '2026-10-15',
  pay: '10000', weekday: '2', cutoff: '15', due: '7', installment: '1000.25',
  bank: '5000', wallet: '', lastUnpaid: '20000.50', lastMin: '2500',
  planned: [['School fees', '12000', '2026-10-26'], ['Rent share', '4000', '2026-10-27']],
  payments: [['12000', '2026-11-03'], ['8000.50', '2026-11-10']],
  swipe: ['Shoes', '3000'],
  cash: ['Fare', '1000'],
  expect: {
    afterWizard: '₱23,999.25',
    afterPlan: '₱7,999.25',
    afterSwipe: '₱4,999.25',
    afterCash: '₱3,999.25',
    bankAfterCash: '₱4,000.00',
  },
};

const scenarios = [['synthetic household', SYNTHETIC]];
const localFile = resolve('local', 'e2e.local.json');
if (existsSync(localFile)) scenarios.push(['real household (local only)', JSON.parse(readFileSync(localFile, 'utf8'))]);

const server = await startServer({ port: 0, cache: 'no-store' });
const origin = `http://127.0.0.1:${server.address().port}${BASE}`;
const chrome = await launchChrome();
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
let failures = 0;

async function run(label, S) {
  const page = await openPage(chrome.port);
  const problems = [];
  const expectEq = (what, actual, wanted) => {
    if (actual !== wanted) problems.push(`${what}: expected ${wanted}, got ${actual}`);
  };
  const act = async (js) => {
    await page.eval(`(() => { ${js} })()`);
    await sleep(120);
  };
  const lts = () => page.eval("__t.text('#lts-value')");
  const sheetOpen = "document.getElementById('sheet').open";

  try {
    await page.goto(`${origin}?demo=empty&today=${S.today}`);
    await page.eval(HELPERS);

    // 1. Wizard
    await page.waitFor("__t.field('Your name on this device')");
    await act(`__t.fill(__t.field('Your name on this device'), ${J(S.name)}); __t.btn('Start setup').click()`);
    await page.waitFor("__t.field('Pay each payday')");
    await act(`
      __t.fill(__t.field('Pay each payday'), ${J(S.pay)});
      __t.fill(__t.field('Payday'), ${J(S.weekday)});
      __t.fill(__t.field('Card cut-off day'), ${J(S.cutoff)});
      __t.fill(__t.field('Bill due day'), ${J(S.due)});
      __t.fill(__t.field('Monthly installment'), ${J(S.installment)});
      __t.btn('Next').click()`);
    await page.waitFor("__t.field('Bank balance')");
    await act(`
      __t.fill(__t.field('Bank balance'), ${J(S.bank)});
      __t.fill(__t.field('Cash in wallet'), ${J(S.wallet)});
      __t.fill(__t.field('Amount still unpaid'), ${J(S.lastUnpaid)});
      __t.fill(__t.field('Minimum due'), ${J(S.lastMin)});
      __t.btn('Next').click()`);
    await page.waitFor("document.querySelector('.preview')");
    expectEq('setup preview', await page.eval("__t.text('.preview .glance-big')"), S.expect.afterWizard);
    await act("__t.btn('Start using the app').click()");
    await page.waitFor("__t.text('#lts-value') !== ''");
    expectEq('left to spend after setup', await lts(), S.expect.afterWizard);

    // 2. Planned payments
    await act("location.hash = '#plan'");
    for (const [what, amount, date] of S.planned) {
      await act("__t.btn('+ Add', document.getElementById('tab-plan')).click()");
      await page.waitFor(sheetOpen);
      await act(`const s = document.getElementById('sheet');
        __t.fill(__t.field('What for', s), ${J(what)});
        __t.fill(__t.field('Amount', s), ${J(amount)});
        __t.fill(__t.field('Date', s), ${J(date)});
        __t.btn('Add to plan', s).click()`);
      await page.waitFor(`!${sheetOpen}`);
    }
    expectEq('left to spend after planned payments', await lts(), S.expect.afterPlan);

    // 3. Scheduled card payments (not paid yet)
    for (const [amount, date] of S.payments) {
      await act("__t.btn('Add payment', document.getElementById('tab-plan')).click()");
      await page.waitFor(sheetOpen);
      await act(`const s = document.getElementById('sheet');
        __t.fill(__t.field('Amount', s), ${J(amount)});
        __t.fill(__t.field('Date', s), ${J(date)});
        s.querySelector('input[type=checkbox]').click();
        __t.btn('Save payment', s).click()`);
      await page.waitFor(`!${sheetOpen}`);
    }
    expectEq('left to spend after scheduling card payments (unchanged)', await lts(), S.expect.afterPlan);
    const alerts = await page.eval("document.querySelector('#tab-plan .alerts').textContent");
    if (!alerts.includes('interest is likely')) problems.push('no interest warning on the Plan tab');
    if (!alerts.includes('pay the card after your salary lands')) problems.push('no pay-first warning on the Plan tab');

    // 4. Spending: a card swipe, then cash
    await act("location.hash = '#home'");
    await act(`__t.fill(__t.q('#log-item'), ${J(S.swipe[0])}); __t.fill(__t.q('#log-amount'), ${J(S.swipe[1])});
      __t.btn('+ Add', document.getElementById('tab-home')).click()`);
    expectEq('left to spend after a card swipe', await lts(), S.expect.afterSwipe);
    await act(`document.querySelector('#tab-home input[type=radio][value=cash]').click();
      __t.fill(__t.q('#log-item'), ${J(S.cash[0])}); __t.fill(__t.q('#log-amount'), ${J(S.cash[1])});
      __t.btn('+ Add', document.getElementById('tab-home')).click()`);
    expectEq('left to spend after cash', await lts(), S.expect.afterCash);
    expectEq('bank after cash', await page.eval("__t.text('#bank-value')"), S.expect.bankAfterCash);

    // 5. Layout: phone (light and dim), small phone, tablet upright and sideways
    const layouts = [
      ['phone', 412, 915, false],
      ['phone-dim', 412, 915, true],
      ['small-phone', 360, 640, false],
      ['tablet', 800, 1280, false],
      ['tablet-landscape', 1280, 800, false],
    ];
    for (const [name, w, hgt, dark] of layouts) {
      await page.setViewport(w, hgt);
      await page.setDark(dark);
      for (const tab of ['home', 'plan', 'spending', 'settings']) {
        await act(`location.hash = '#${tab}'; window.scrollTo(0, 0)`);
        const overflow = await page.eval('__t.overflow()');
        if (overflow > 0) problems.push(`${tab} on ${name}: ${overflow}px wider than the screen`);
        const wanted = name.startsWith('phone') || (name === 'tablet-landscape' && (tab === 'home' || tab === 'plan'));
        if (shotsDir && wanted && !label.includes('local')) {
          await page.screenshot(join(shotsDir, `${tab}-${name}.png`), { full: true });
        }
      }
    }
    if (page.errors.length) problems.push(`JavaScript errors: ${page.errors.join(' | ')}`);
  } catch (err) {
    problems.push(`stopped: ${err.message}`);
  } finally {
    page.close();
  }

  if (problems.length) {
    failures += 1;
    console.log(`✗ ${label}\n  - ${problems.join('\n  - ')}`);
  } else {
    console.log(`✓ ${label}: setup, planned payments, card payments, spending, layout`);
  }
}

let serverOpen = true;
function stopServer() {
  if (!serverOpen) return;
  serverOpen = false;
  server.closeAllConnections();
  server.close();
}

// Install and offline: the app must be installable, and must still open with the server gone.
async function offlineCheck() {
  const page = await openPage(chrome.port);
  const problems = [];
  const url = `${origin}?demo=1&today=2026-10-15&sw=1`;
  try {
    await page.goto(url);
    await page.eval(HELPERS);
    await page.waitFor('navigator.serviceWorker.controller', 15000);
    const errors = await page.installabilityErrors();
    if (errors.length) problems.push(`not installable: ${errors.map((e) => e.errorId).join(', ')}`);
    await page.waitFor("document.getElementById('tab-settings').textContent.includes('works offline')", 8000);
    stopServer();
    await page.goto(url);
    await page.eval(HELPERS);
    await page.waitFor("__t.text('#lts-value') === '₱5,778.50'", 10000);
    if (page.errors.length) problems.push(`JavaScript errors: ${page.errors.join(' | ')}`);
  } catch (err) {
    problems.push(`stopped: ${err.message}`);
  } finally {
    page.close();
  }
  if (problems.length) {
    failures += 1;
    console.log(`✗ install and offline\n  - ${problems.join('\n  - ')}`);
  } else {
    console.log('✓ install and offline: installable, and opens with the right numbers with the server stopped');
  }
}

try {
  for (const [label, scenario] of scenarios) await run(label, scenario);
  await offlineCheck();
} finally {
  await chrome.close();
  stopServer();
}
if (failures) process.exit(1);
