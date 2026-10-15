// Two devices syncing through the Sheet script (in the Node harness): offline edits,
// conflicts, deletions, clock skew and outages must always end with every copy identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/gas-harness.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { createStore } from '../js/store.js';
import { createSync } from '../js/sync.js';
import { canon } from '../js/lww.js';
import { compute } from '../js/engine.js';

const URL1 = 'https://script.google.com/macros/s/TEST_id-1/exec';
const SETTINGS = {
  startDate: '2026-10-15',
  paySchedule: [{ from: '2026-10-15', amountCents: 1000000, weekday: 2 }],
  cutoffDay: 15,
  dueDay: 7,
  installments: [],
};

function server() {
  const h = createHarness();
  h.setup();
  return h;
}

function device(h, name, { skewMs = 0 } = {}) {
  const storage = memoryStorage();
  const net = { down: false, gate: null };
  const now = () => Date.now() + skewMs;
  let sync = null;
  const store = createStore({ storage, now, clockOffset: () => sync?.clockOffset() ?? 0 });
  store.device.set({ userName: name });
  const fetchImpl = async (url, init) => {
    if (net.down) throw new TypeError('Failed to fetch');
    if (net.gate) await net.gate;
    return { status: 200, text: async () => JSON.stringify(h.post(init.body)) };
  };
  sync = createSync({ store, storage, fetchImpl, now, isOnline: () => !net.down, schedule: () => null, cancel: () => {} });
  return { name, store, sync, net };
}

const spend = (item, cents, date = '2026-10-16') => ({ date, item, amountCents: cents, categoryId: 'cat:food', method: 'card' });
const copyOf = (d) => Object.fromEntries(d.store.all().map((r) => [r.id, canon(r)]));
const sheetCopy = (h) => Object.fromEntries(h.records().map((row) => {
  const r = JSON.parse(row[10]);
  return [r.id, canon(r)];
}));

async function connected(h, name, opts) {
  const d = device(h, name, opts);
  const r = await d.sync.connect({ url: URL1, secret: h.secret() });
  assert.equal(r.ok, true, JSON.stringify(r));
  return d;
}

test('a wrong sync code is refused and nothing is saved', async () => {
  const h = server();
  const d = device(h, 'A');
  assert.deepEqual(await d.sync.connect({ url: URL1, secret: 'f'.repeat(64) }), { ok: false, error: 'auth', message: undefined });
  assert.equal(d.sync.connected(), false);
});

test('links that are not Google Apps Script are refused before anything is sent', async () => {
  const h = server();
  const d = device(h, 'A');
  assert.equal((await d.sync.connect({ url: 'https://evil.example/exec', secret: h.secret() })).error, 'bad_url');
});

test("the first device's setup reaches the Sheet and a second device gets all of it", async () => {
  const h = server();
  const a = await connected(h, 'A');
  a.store.batch(() => {
    a.store.updateSettings(SETTINGS);
    a.store.add('bankCheck', { date: '2026-10-15', amountCents: 500000, walletCents: 0, payIncluded: false, kind: 'opening' });
    a.store.add('spend', spend('Lunch', 35000, '2026-10-15'));
  });
  assert.equal((await a.sync.syncOnce()).ok, true);
  assert.equal(a.store.pendingChanges().length, 0);

  const b = await connected(h, 'B');
  assert.deepEqual(copyOf(b), copyOf(a));
  assert.deepEqual(sheetCopy(h), copyOf(a));
  const today = { today: '2026-10-15' };
  assert.equal(compute(b.store.all(), today).lts.cents, compute(a.store.all(), today).lts.cents);
});

test('offline edits on two devices merge when both are back online', async () => {
  const h = server();
  const a = await connected(h, 'A');
  const shared = a.store.add('spend', spend('Groceries', 100000));
  const doomed = a.store.add('spend', spend('Typo', 1));
  await a.sync.syncOnce();
  const b = await connected(h, 'B');

  a.net.down = true;
  b.net.down = true;
  a.store.add('spend', spend('Fuel', 50000));
  a.store.update(shared.id, { amountCents: 110000 });
  b.store.add('planned', { date: '2026-10-26', label: 'School fees', amountCents: 1200000, direction: 'out', done: false, doneAt: null });
  b.store.remove(doomed.id);
  assert.equal((await a.sync.syncOnce()).error, 'offline');

  a.net.down = false;
  b.net.down = false;
  await a.sync.syncOnce();
  await b.sync.syncOnce();
  await a.sync.syncOnce();
  assert.deepEqual(copyOf(a), copyOf(b));
  assert.deepEqual(copyOf(a), sheetCopy(h));
  assert.equal(a.store.get(doomed.id).deleted, true);
  assert.equal(b.store.get(shared.id).amountCents, 110000);
});

test('the same entry edited on two devices ends up identical everywhere', async () => {
  const h = server();
  const a = await connected(h, 'A');
  const r = a.store.add('spend', spend('Dinner', 100000));
  await a.sync.syncOnce();
  const b = await connected(h, 'B');
  a.net.down = true;
  a.store.update(r.id, { amountCents: 120000 });
  b.store.update(r.id, { item: 'Family dinner' });
  await b.sync.syncOnce();
  a.net.down = false;
  await a.sync.syncOnce();
  await b.sync.syncOnce();
  assert.deepEqual(copyOf(a), copyOf(b));
  assert.deepEqual(copyOf(a), sheetCopy(h));
});

test('a device whose clock is 10 minutes fast learns the difference on its first sync', async () => {
  const h = server();
  const b = await connected(h, 'B', { skewMs: 10 * 60_000 });
  const offset = b.sync.clockOffset();
  assert.ok(offset < -590_000 && offset > -610_000, String(offset));
  const r = b.store.add('spend', spend('Snack', 5000));
  assert.ok(Math.abs(Date.parse(r.updatedAt) - Date.now()) < 30_000, r.updatedAt);
});

test('an edit made while a sync is running is not lost', async () => {
  const h = server();
  const a = await connected(h, 'A');
  const r = a.store.add('spend', spend('Coffee', 15000));
  let release;
  a.net.gate = new Promise((ok) => { release = ok; });
  const running = a.sync.syncOnce();
  a.store.update(r.id, { item: 'Coffee and cake' });
  release();
  a.net.gate = null;
  await running;
  await a.sync.syncOnce();
  assert.equal(a.store.pendingChanges().length, 0);
  assert.equal(JSON.parse(h.records().find((row) => row[9] === r.id)[10]).item, 'Coffee and cake');
});

test('a device joining a Sheet with many entries gets every page', async () => {
  const h = server();
  const a = await connected(h, 'A');
  a.store.batch(() => {
    for (let i = 0; i < 1200; i += 1) a.store.add('spend', spend(`Item ${i}`, 100 + i));
  });
  await a.sync.syncOnce();
  assert.equal(h.records().length, 1200);
  const b = await connected(h, 'B');
  assert.equal(b.store.all().length, 1200);
  assert.deepEqual(copyOf(b), copyOf(a));
});

test('if the Sheet is replaced or emptied, the device sends everything again', async () => {
  const h = server();
  const a = await connected(h, 'A');
  a.store.add('spend', spend('One', 100));
  a.store.add('spend', spend('Two', 200));
  await a.sync.syncOnce();
  h.sheet('Records').rows.length = 1;
  h.props.set('REV', '0');
  h.props.set('SERVER_ID', 'a-new-sheet');
  await a.sync.syncOnce();
  assert.deepEqual(sheetCopy(h), copyOf(a));
});

test('records the Sheet refuses are reported once, not retried forever', async () => {
  const h = server();
  const a = await connected(h, 'A');
  const now = new Date().toISOString();
  a.store.importJSON(JSON.stringify({ records: [{
    id: 'bad id!', type: 'spend', by: 'A', updatedBy: 'A', createdAt: now, updatedAt: now, deleted: false, ...spend('Odd', 100),
  }] }));
  await a.sync.syncOnce();
  assert.equal(a.store.pendingChanges().length, 0);
  assert.deepEqual(a.sync.status().problems.map((p) => p.reason), ['bad id']);
});

test('a changed sync code stops syncing and asks to reconnect', async () => {
  const h = server();
  const a = await connected(h, 'A');
  h.props.set('SECRET', 'b'.repeat(64));
  a.store.add('spend', spend('Later', 100));
  assert.equal((await a.sync.syncOnce()).error, 'auth');
  assert.equal(a.sync.status().text, 'Reconnect needed');
  assert.equal(a.store.pendingChanges().length, 1);
});

test('reset this device from the Sheet replaces local data with the shared copy', async () => {
  const h = server();
  const a = await connected(h, 'A');
  a.store.add('spend', spend('Shared', 100));
  await a.sync.syncOnce();
  const b = await connected(h, 'B');
  b.sync.disconnect();
  b.store.add('spend', spend('Only here', 999));
  await b.sync.connect({ url: URL1, secret: h.secret(), mode: 'replace' });
  assert.deepEqual(copyOf(b), copyOf(a));
});

test('a connect link carries the connection to another device', async () => {
  const h = server();
  const a = await connected(h, 'A');
  const link = a.sync.connectLink('https://example.github.io/budget-app/');
  assert.match(link, /^https:\/\/example\.github\.io\/budget-app\/#connect=1\.TEST_id-1\./);
});

function rng(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const seed of [20261015, 1, 2, 3, 4, 5, 6, 7]) test(`random edits, syncs and outages on two devices always end identical (seed ${seed})`, async () => {
  const h = server();
  const a = await connected(h, 'A');
  const b = await connected(h, 'B', { skewMs: 10 * 60_000 });
  const devices = [a, b];
  const rand = rng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  for (let step = 0; step < 200; step += 1) {
    const d = pick(devices);
    const spends = d.store.all().filter((r) => r.type === 'spend');
    const op = rand();
    if (op < 0.25) d.store.add('spend', spend(`S${step}`, 100 + step));
    else if (op < 0.4 && spends.length) d.store.update(pick(spends).id, { amountCents: 1 + Math.floor(rand() * 99999) });
    else if (op < 0.5 && spends.length) d.store.remove(pick(spends).id);
    else if (op < 0.55 && spends.length) d.store.restore(pick(spends).id);
    else if (op < 0.65) d.store.setPayday('2026-10-20', { counted: rand() < 0.5 });
    else if (op < 0.75) d.net.down = !d.net.down;
    else await d.sync.syncOnce();
  }

  for (const d of devices) d.net.down = false;
  await a.sync.syncOnce();
  await b.sync.syncOnce();
  await a.sync.syncOnce();
  assert.deepEqual(copyOf(a), copyOf(b));
  assert.deepEqual(copyOf(a), sheetCopy(h));
  assert.equal(a.store.pendingChanges().length + b.store.pendingChanges().length, 0);
});
