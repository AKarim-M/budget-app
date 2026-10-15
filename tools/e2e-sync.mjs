#!/usr/bin/env node
// Sync end to end in two separate Chrome browsers ("devices") against a local stand-in for
// Google's server: the first device connects and sets up, the second joins from a connect
// link, both make changes, one goes offline and back, and everything must match.
//   node tools/e2e-sync.mjs

import { setTimeout as sleep } from 'node:timers/promises';
import { startServer, BASE } from './serve.mjs';
import { startFakeGas } from './fake-gas.mjs';
import { launchChrome, openPage, HELPERS } from './cdp.mjs';
import { encodeConnect } from '../js/sync-core.js';
import { canon } from '../js/lww.js';

const J = JSON.stringify;
const DAY = '2026-10-15';
const SHEET = "document.getElementById('sheet')";

const gas = await startFakeGas();
const server = await startServer({ port: 0, cache: 'no-store', connectSrc: gas.origins });
const origin = `http://127.0.0.1:${server.address().port}${BASE}`;
const chromes = [await launchChrome(), await launchChrome()];
const problems = [];
const check = (what, ok, detail = '') => {
  if (ok) console.log(`✓ ${what}`);
  else {
    problems.push(what);
    console.log(`✗ ${what}${detail ? `: ${detail}` : ''}`);
  }
};

async function device(chrome) {
  const page = await openPage(chrome.port);
  page.act = async (js) => {
    await page.eval(`(() => { ${js} })()`);
    await sleep(150);
  };
  page.lts = () => page.eval("__t.text('#lts-value')");
  page.records = async () => {
    const db = JSON.parse(await page.eval("localStorage.getItem('hb1.db')"));
    return Object.fromEntries(Object.values(db.records).map((r) => [r.id, canon(r)]));
  };
  return page;
}

const sheetRecords = () => Object.fromEntries(gas.harness.records().map((row) => {
  const r = JSON.parse(row[10]);
  return [r.id, canon(r)];
}));

let A;
let B;
try {
  A = await device(chromes[0]);
  B = await device(chromes[1]);

  // ---- Device A: connect to the Sheet from the first setup screen, then set up ----
  await A.goto(`${origin}?today=${DAY}`);
  await A.eval(HELPERS);
  await A.waitFor("__t.btn('Connect to it first')");
  await A.act("__t.btn('Connect to it first').click()");
  await A.waitFor(`${SHEET}.open`);
  await A.act(`const s = ${SHEET};
    __t.fill(__t.field('Web app link', s), ${J(gas.execUrl)});
    __t.fill(__t.field('Sync code', s), ${J(gas.secret)});
    __t.btn('Connect', s).click()`);
  await A.waitFor(`!${SHEET}.open`, 15000);
  check('device A connects to the Sheet from the setup screen', true);

  await A.act(`__t.fill(__t.field('Your name on this device'), 'Alex'); __t.btn('Start setup').click()`);
  await A.waitFor("__t.field('Pay each payday')");
  await A.act(`__t.fill(__t.field('Pay each payday'), '10000'); __t.fill(__t.field('Payday'), '2');
    __t.fill(__t.field('Card cut-off day'), '15'); __t.fill(__t.field('Bill due day'), '7');
    __t.fill(__t.field('Monthly installment'), '1000.25'); __t.btn('Next').click()`);
  await A.waitFor("__t.field('Bank balance')");
  await A.act(`__t.fill(__t.field('Bank balance'), '5000'); __t.fill(__t.field('Amount still unpaid'), '20000.50');
    __t.fill(__t.field('Minimum due'), '2500'); __t.btn('Next').click()`);
  await A.waitFor("document.querySelector('.preview')");
  await A.act("__t.btn('Start using the app').click()");
  await A.waitFor("__t.text('#lts-value') === '₱23,999.25'");
  await A.waitFor("document.querySelector('.sync-pill')?.textContent === 'Synced'", 20000);
  check('device A finishes setup and its data reaches the Sheet',
    gas.harness.records().some((row) => row[1] === 'settings'));

  // ---- Device A shows the QR code ----
  await A.act("location.hash = '#settings'");
  await A.act("__t.btn('Show code', document.getElementById('tab-settings')).click()");
  await A.waitFor("document.querySelector('img.qr')?.naturalWidth > 0", 8000);
  check('device A draws the connect QR code', true);
  await A.act(`${SHEET}.close()`);

  // ---- Device B joins from the connect link ----
  const code = encodeConnect({ url: gas.execUrl, secret: gas.secret });
  await B.goto(`${origin}?today=${DAY}#connect=${code}`);
  await B.eval(HELPERS);
  await B.waitFor(`${SHEET}.open`);
  check('the connect link is removed from the address bar at once', (await B.eval('location.hash')) === '');
  await B.act(`const s = ${SHEET}; __t.fill(__t.field('Your name on this device', s), 'Sam');
    __t.btn('Connect this device', s).click()`);
  await B.waitFor("__t.text('#lts-value') === '₱23,999.25'", 20000);
  check('device B joins and gets the whole budget without its own setup', true);

  // ---- Both make changes ----
  await A.act("location.hash = '#home'");
  await A.act(`__t.fill(__t.q('#log-item'), 'Shoes'); __t.fill(__t.q('#log-amount'), '3000');
    __t.btn('+ Add', document.getElementById('tab-home')).click()`);
  await B.act("location.hash = '#plan'");
  await B.act("__t.btn('+ Add', document.getElementById('tab-plan')).click()");
  await B.waitFor(`${SHEET}.open`);
  await B.act(`const s = ${SHEET}; __t.fill(__t.field('What for', s), 'School fees');
    __t.fill(__t.field('Amount', s), '12000'); __t.fill(__t.field('Date', s), '2026-10-26');
    __t.btn('Add to plan', s).click()`);
  await sleep(4500); // each device syncs about 3 s after a change
  for (const d of [A, B]) {
    await d.act("location.hash = '#settings'");
    await d.act("__t.btn('Sync now', document.getElementById('tab-settings')).click()");
  }
  await A.waitFor("__t.text('#lts-value') === '₱8,999.25'", 20000);
  await B.waitFor("__t.text('#lts-value') === '₱8,999.25'", 20000);
  check("each device sees the other's changes (₱8,999.25 on both)", true);

  // ---- B goes offline, logs cash, comes back ----
  await B.send('Network.enable');
  await B.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await B.act("location.hash = '#home'");
  await B.act(`document.querySelector('#tab-home input[type=radio][value=cash]').click();
    __t.fill(__t.q('#log-item'), 'Fare'); __t.fill(__t.q('#log-amount'), '1000');
    __t.btn('+ Add', document.getElementById('tab-home')).click()`);
  await B.waitFor("document.querySelector('.sync-pill')?.textContent.startsWith('Offline')", 10000);
  check('offline, device B keeps the entry and shows it waiting', (await B.lts()) === '₱7,999.25',
    await B.eval("document.querySelector('.sync-pill')?.textContent"));
  await B.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await B.waitFor("document.querySelector('.sync-pill')?.textContent === 'Synced'", 20000);
  await A.act("location.hash = '#settings'");
  await A.act("__t.btn('Sync now', document.getElementById('tab-settings')).click()");
  await A.waitFor("__t.text('#lts-value') === '₱7,999.25'", 20000);
  check('back online, the offline entry reaches the other device', true);

  // ---- Everything identical ----
  const [ra, rb, rs] = [await A.records(), await B.records(), sheetRecords()];
  const sorted = (m) => J(Object.keys(m).sort().map((k) => [k, m[k]]));
  const differing = Object.keys({ ...ra, ...rb, ...rs }).filter((k) => !(ra[k] === rb[k] && ra[k] === rs[k]));
  check('both devices and the Sheet hold identical data',
    sorted(ra) === sorted(rb) && sorted(ra) === sorted(rs),
    differing.map((k) => `\n    ${k}\n      A: ${ra[k]}\n      B: ${rb[k]}\n      Sheet: ${rs[k]}`).join(''));
  check('no JavaScript errors on either device', A.errors.length + B.errors.length === 0, [...A.errors, ...B.errors].join(' | '));
} catch (err) {
  check('the sync walkthrough ran to the end', false, err.message);
} finally {
  A?.close();
  B?.close();
  for (const c of chromes) await c.close();
  server.close();
  gas.close();
}
if (problems.length) process.exit(1);
console.log('Sync walkthrough passed');
