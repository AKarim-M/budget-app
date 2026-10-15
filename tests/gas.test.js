// The Google Sheet sync script (apps-script/Code.gs), run in Node against fake Google services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness } from './helpers/gas-harness.js';
import { cmpRec } from '../js/lww.js';

const TS = (n) => `2026-10-15T01:00:00.${String(n).padStart(3, '0')}Z`;
const rec = (id, n, extra = {}) => ({
  id, type: 'spend', by: 'A', updatedBy: 'A', createdAt: TS(0), updatedAt: TS(n), deleted: false,
  date: '2026-10-15', item: 'Lunch', amountCents: 50000, categoryId: 'cat:food', method: 'card', ...extra,
});

function ready() {
  const h = createHarness();
  h.setup();
  const sync = (changes = [], since = 0, extra = {}) => h.post({ v: 1, secret: h.secret(), deviceId: 'd1', by: 'A', since, changes, ...extra });
  return { h, sync };
}

test('setup creates the tabs and a sync code, and keeps them when run again', () => {
  const h = createHarness();
  h.setup();
  const secret = h.secret();
  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.equal(h.sheet('Records').rows[0][0], 'Date');
  assert.equal(h.sheet('Records').frozen, 1);
  assert.match(h.sheet('Expenses').formulas['1,1'], /QUERY\(Records!A:G/);
  assert.deepEqual([h.props.get('SHEET_ID'), h.props.get('REV')], ['sheet-id-123', '0']);
  assert.ok(h.logs.some((l) => l.includes(secret)));
  h.setup();
  assert.equal(h.secret(), secret);
});

test('doGet answers a health check without any data', () => {
  const { h } = ready();
  assert.deepEqual(h.get(), { ok: true, app: 'budget-sync', protocol: 1 });
});

test('a wrong sync code is refused before the sheet is touched', () => {
  const { h } = ready();
  h.failWrites = true;
  assert.deepEqual(h.post({ v: 1, secret: 'nope', since: 0, changes: [rec('a', 1)] }), { ok: false, error: 'auth' });
  assert.equal(h.records().length, 0);
});

test('an unknown protocol version asks for an upgrade', () => {
  const { sync } = ready();
  assert.equal(sync([], 0, { v: 2 }).error, 'upgrade');
});

test('a new record is stored with a rev and comes back when pulling', () => {
  const { h, sync } = ready();
  const res = sync([{ ...rec('a', 1), _view: { date: '2026-10-15', amount: 500, label: 'Lunch', note: 'Card · Food' } }]);
  assert.equal(res.ok, true);
  assert.equal(res.rev, 1);
  const row = h.records()[0];
  assert.deepEqual(row.slice(0, 10), ['2026-10-15', 'spend', 'A', 500, 'Lunch', 'Card · Food', false, TS(1), 1, 'a']);
  assert.deepEqual(JSON.parse(row[10]), rec('a', 1));
  assert.deepEqual(res.changes, [{ ...rec('a', 1), rev: 1 }]);
});

test('a newer edit replaces the row; an older one is ignored and the winner returned', () => {
  const { h, sync } = ready();
  sync([rec('a', 5)]);
  const newer = sync([rec('a', 9, { item: 'Dinner' })], 1);
  assert.equal(h.records().length, 1);
  assert.equal(JSON.parse(h.records()[0][10]).item, 'Dinner');
  assert.equal(newer.rev, 2);
  const stale = sync([rec('a', 3, { item: 'Old' })], 2);
  assert.equal(JSON.parse(h.records()[0][10]).item, 'Dinner');
  assert.deepEqual(stale.changes.map((c) => [c.id, c.item, c.rev]), [['a', 'Dinner', 2]]);
});

test('a deletion is kept as a marked row', () => {
  const { h, sync } = ready();
  sync([rec('a', 1)]);
  sync([rec('a', 2, { deleted: true })], 1);
  assert.equal(h.records()[0][6], true);
  assert.equal(JSON.parse(h.records()[0][10]).deleted, true);
});

test('invalid records are rejected one by one; the rest of the batch is saved', () => {
  const { h, sync } = ready();
  const res = sync([rec('ok', 1), { ...rec('bad id!', 1) }, { ...rec('t', 1), type: 'nope' }, { ...rec('s', 1), type: 'settings' }, { ...rec('d', 1), updatedAt: 'yesterday' }]);
  assert.deepEqual(res.rejected.map((r) => r.reason), ['bad id', 'bad type', 'settings id', 'bad updatedAt']);
  assert.deepEqual(h.records().map((r) => r[9]), ['ok']);
});

test('text that looks like a formula is stored as plain text', () => {
  const { h, sync } = ready();
  sync([{ ...rec('f', 1, { item: '=HYPERLINK("http://x")' }), _view: { label: '=HYPERLINK("http://x")', note: '+1', date: '-5' } }]);
  const row = h.records()[0];
  assert.deepEqual([row[0], row[4], row[5]], ["'-5", '\'=HYPERLINK("http://x")', "'+1"]);
  assert.equal(JSON.parse(row[10]).item, '=HYPERLINK("http://x")');
});

test('pulling pages through many records without gaps or repeats', () => {
  const { sync } = ready();
  const all = Array.from({ length: 1200 }, (_, i) => rec(`r${i}`, 1));
  sync(all.slice(0, 500));
  sync(all.slice(500, 1000));
  sync(all.slice(1000));
  const seen = [];
  let since = 0;
  for (let page = 0; page < 10; page += 1) {
    const res = sync([], since);
    seen.push(...res.changes.map((c) => c.rev));
    since = res.rev;
    if (!res.more) break;
  }
  assert.equal(seen.length, 1200);
  assert.deepEqual(seen, Array.from({ length: 1200 }, (_, i) => i + 1));
});

test('revs always increase, even after a failed write', () => {
  const { h, sync } = ready();
  sync([rec('a', 1)]);
  h.failWrites = true;
  assert.equal(sync([rec('b', 1)], 1).error, 'server');
  h.failWrites = false;
  const res = sync([rec('c', 1)], 1);
  assert.equal(res.changes.find((c) => c.id === 'c').rev, 3);
});

test('a busy sheet asks the device to try again', () => {
  const { h, sync } = ready();
  h.busy = true;
  assert.equal(sync([rec('a', 1)]).error, 'busy');
});

test('before setup the script says so', () => {
  const h = createHarness();
  assert.equal(h.post({ v: 1, secret: 'x', since: 0, changes: [] }).error, 'not_setup');
});

test('the script and the app resolve conflicts the same way', () => {
  const { h } = ready();
  const vectors = JSON.parse(readFileSync('tests/fixtures/lww-vectors.json', 'utf8'));
  for (const v of vectors) {
    assert.equal(Math.sign(cmpRec(v.a, v.b)), v.sign, `app: ${v.name}`);
    assert.equal(Math.sign(h.ctx.cmpRec_(v.a, v.b)), v.sign, `script: ${v.name}`);
  }
});
