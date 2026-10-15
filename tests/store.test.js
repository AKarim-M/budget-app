import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { validateRecord } from '../js/records.js';
import { memoryStorage, fixedClock } from './helpers/memory-storage.js';

const SETTINGS = {
  startDate: '2026-10-15',
  paySchedule: [{ from: '2026-10-15', amountCents: 1000000, weekday: 2 }],
  cutoffDay: 15,
  dueDay: 7,
  installments: [],
};
const spendFields = (over = {}) => ({
  date: '2026-10-15', item: 'Lunch', amountCents: 50000, categoryId: 'cat:food', method: 'card', ...over,
});

function fresh(opts = {}) {
  const storage = opts.storage ?? memoryStorage();
  const now = opts.now ?? fixedClock();
  const store = createStore({ storage, now });
  store.device.set({ userName: opts.userName ?? 'Alex' });
  return { store, storage, now };
}

test('add creates a valid record logged by this device and saves it', () => {
  const { store, storage } = fresh();
  const r = store.add('spend', spendFields());
  assert.equal(r.by, 'Alex');
  assert.deepEqual(validateRecord(r), { ok: true, errors: [] });
  const again = createStore({ storage, now: fixedClock() });
  assert.deepEqual(again.get(r.id), r);
});

test('timestamps always move forward on a device, even with a frozen clock', () => {
  const { store } = fresh();
  const a = store.add('spend', spendFields());
  const b = store.add('spend', spendFields());
  assert.ok(b.createdAt > a.createdAt);
  const a2 = store.update(a.id, { amountCents: 60000 });
  assert.ok(a2.updatedAt > b.createdAt);
});

test('update merges a patch; an invalid patch throws and changes nothing', () => {
  const { store } = fresh();
  const r = store.add('spend', spendFields());
  const u = store.update(r.id, { item: 'Dinner', by: 'Sam' });
  assert.deepEqual([u.item, u.by, u.updatedBy, u.createdAt], ['Dinner', 'Alex', 'Alex', r.createdAt]);
  assert.throws(() => store.update(r.id, { amountCents: -5 }), /amountCents/);
  assert.equal(store.get(r.id).item, 'Dinner');
});

test('remove leaves a tombstone that restore brings back', () => {
  const { store } = fresh();
  const r = store.add('spend', spendFields());
  store.remove(r.id);
  assert.equal(store.get(r.id).deleted, true);
  store.restore(r.id);
  assert.equal(store.get(r.id).deleted, false);
});

test('batch saves once and notifies once', () => {
  const { store } = fresh();
  const events = [];
  store.subscribe((e) => events.push(e.origin));
  store.batch(() => {
    store.add('spend', spendFields());
    store.add('spend', spendFields());
  });
  assert.deepEqual(events, ['local']);
});

test('setPayday upserts the fixed-id record, reviving a deleted one', () => {
  const { store } = fresh();
  store.setPayday('2026-10-20', { counted: false });
  store.remove('payday:2026-10-20');
  const p = store.setPayday('2026-10-20', { counted: false });
  assert.deepEqual([p.id, p.counted, p.deleted], ['payday:2026-10-20', false, false]);
  assert.equal(store.all().filter((x) => x.type === 'payday').length, 1);
});

test('setBill upserts the bill record for a statement', () => {
  const { store } = fresh();
  store.setBill('2026-10', { statementCents: 2000050 });
  const b = store.setBill('2026-10', { minimumDueCents: 250000 });
  assert.deepEqual([b.id, b.statementCents, b.minimumDueCents, b.adjustCents], ['bill:2026-10', 2000050, 250000, 0]);
});

test('setDone ticks an item and moves a future date to today', () => {
  const { store } = fresh();
  const p = store.add('planned', { date: '2026-10-26', label: 'Tuition', amountCents: 1200000, direction: 'out', done: false, doneAt: null });
  const d = store.setDone(p.id, true, '2026-10-24');
  assert.deepEqual([d.done, d.date, typeof d.doneAt], [true, '2026-10-24', 'string']);
  assert.equal(store.setDone(p.id, false, '2026-10-24').doneAt, null);
});

test('updateSettings creates the settings record, then patches it', () => {
  const { store } = fresh();
  assert.equal(store.getSettings(), null);
  store.updateSettings(SETTINGS);
  const s = store.updateSettings({ dueDay: 5 });
  assert.deepEqual([s.id, s.dueDay, s.cutoffDay], ['settings', 5, 15]);
});

test('editing a built-in category stores a real record from the default', () => {
  const { store } = fresh();
  const c = store.upsert('category', 'cat:food', { places: ['Canteen'] });
  assert.deepEqual([c.id, c.name, c.places, c.by], ['cat:food', 'Food & Dining', ['Canteen'], 'Alex']);
  assert.notEqual(c.updatedAt, '1970-01-01T00:00:00.000Z');
});

// ---------- sync bookkeeping ----------

test('every local change is queued for sync in order', () => {
  const { store } = fresh();
  const a = store.add('spend', spendFields());
  const b = store.add('spend', spendFields());
  store.update(a.id, { item: 'Dinner' });
  assert.deepEqual(store.pendingChanges().map((p) => p.record.id), [b.id, a.id]);
});

test('ackOutbox clears what was sent, but an edit made mid-flight stays queued', () => {
  const { store } = fresh();
  const a = store.add('spend', spendFields());
  const b = store.add('spend', spendFields());
  const sent = store.pendingChanges();
  store.update(b.id, { item: 'Edited while syncing' });
  store.ackOutbox(sent.map((p) => ({ id: p.record.id, seq: p.seq })));
  assert.deepEqual(store.pendingChanges().map((p) => p.record.id), [b.id]);
  assert.ok(!store.pendingChanges().some((p) => p.record.id === a.id));
});

test('applyRemote keeps the newer version and drops a losing local edit from the queue', () => {
  const { store } = fresh();
  const local = store.add('spend', spendFields());
  const newer = { ...local, item: 'From the other phone', updatedAt: '2026-10-16T00:00:00.000Z', updatedBy: 'Sam', rev: 7, _view: {} };
  const events = [];
  store.subscribe((e) => events.push(e.origin));
  store.applyRemote([newer]);
  assert.equal(store.get(local.id).item, 'From the other phone');
  assert.equal('rev' in store.get(local.id), false);
  assert.equal(store.pendingChanges().length, 0);
  assert.deepEqual(events, ['remote']);
});

test('applyRemote ignores an older remote version and keeps the local edit queued', () => {
  const { store } = fresh();
  const local = store.add('spend', spendFields());
  store.applyRemote([{ ...local, item: 'Stale', updatedAt: '2026-10-01T00:00:00.000Z' }]);
  assert.equal(store.get(local.id).item, 'Lunch');
  assert.equal(store.pendingChanges().length, 1);
});

test('markAllDirty queues everything; replaceAll swaps in the Sheet copy', () => {
  const { store } = fresh();
  const a = store.add('spend', spendFields());
  store.ackOutbox(store.pendingChanges().map((p) => ({ id: p.record.id, seq: p.seq })));
  store.markAllDirty();
  assert.deepEqual(store.pendingChanges().map((p) => p.record.id), [a.id]);
  const other = { ...a, id: 'other-id', item: 'Only on the Sheet' };
  store.replaceAll([other]);
  assert.deepEqual(store.all().map((r) => r.id), ['other-id']);
  assert.equal(store.pendingChanges().length, 0);
});

// ---------- import / export / storage ----------

test('export then import into a fresh device reproduces the records and queues them', () => {
  const { store } = fresh();
  store.updateSettings(SETTINGS);
  store.add('spend', spendFields());
  const text = store.exportJSON();
  const other = fresh({ userName: 'Sam' }).store;
  const result = other.importJSON(text);
  assert.equal(result.imported, 2);
  assert.deepEqual(other.all().map((r) => r.id).sort(), store.all().map((r) => r.id).sort());
  assert.equal(other.pendingChanges().length, 2);
});

test('a places file adds personal names and places to categories', () => {
  const { store } = fresh();
  const result = store.importJSON(JSON.stringify({
    categories: [{ id: 'cat:shopping', name: 'Shopping & Kids', places: ['Bookstore', 'Shoe shop'] }],
  }));
  assert.equal(result.imported, 1);
  const c = store.get('cat:shopping');
  assert.deepEqual([c.name, c.places, c.icon], ['Shopping & Kids', ['Bookstore', 'Shoe shop'], '🛍️']);
});

test('unreadable saved data is backed up and the store starts empty', () => {
  const storage = memoryStorage({ 'hb1.db': '{not json' });
  const store = createStore({ storage, now: fixedClock() });
  assert.equal(store.all().length, 0);
  assert.ok(storage.keys().some((k) => k.startsWith('hb1.db.corrupt.')));
});

test('device preferences are kept apart from synced records, with a stable device id', () => {
  const storage = memoryStorage();
  const s1 = createStore({ storage, now: fixedClock() });
  s1.device.set({ userName: 'Alex', theme: 'dim' });
  const s2 = createStore({ storage, now: fixedClock() });
  assert.deepEqual([s2.device.get().userName, s2.device.get().theme], ['Alex', 'dim']);
  assert.equal(s2.device.get().deviceId, s1.device.get().deviceId);
  assert.equal(s2.all().length, 0);
});

test('reloadFromStorage picks up changes written by another window', () => {
  const storage = memoryStorage();
  const a = createStore({ storage, now: fixedClock() });
  const b = createStore({ storage, now: fixedClock() });
  a.device.set({ userName: 'Alex' });
  const r = a.add('spend', spendFields());
  const events = [];
  b.subscribe((e) => events.push(e.origin));
  b.reloadFromStorage();
  assert.equal(b.get(r.id).item, 'Lunch');
  assert.deepEqual(events, ['storage']);
});
