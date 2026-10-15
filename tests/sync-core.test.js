import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayload, classifyResponse, backoffMs, encodeConnect, decodeConnect,
  isAllowedSyncUrl, describeRecord, syncStatus,
} from '../js/sync-core.js';

const URL1 = 'https://script.google.com/macros/s/TEST_id-1/exec';
const SECRET = 'a'.repeat(64);

test('buildPayload sends queued records with a readable view, and remembers what was sent', () => {
  const rec = { id: 'r1', type: 'spend', item: 'Lunch', amountCents: 50000, date: '2026-10-15', method: 'card', categoryId: 'cat:food' };
  const { payload, sent } = buildPayload({
    pending: [{ record: rec, seq: 7 }],
    cfg: { secret: SECRET, lastRev: 12 },
    device: { deviceId: 'dev-1', userName: 'Alex', theme: 'dim' },
    describe: () => ({ label: 'Lunch' }),
  });
  assert.deepEqual(payload, {
    v: 1, secret: SECRET, deviceId: 'dev-1', by: 'Alex', since: 12,
    changes: [{ ...rec, _view: { label: 'Lunch' } }],
  });
  assert.deepEqual(sent, [{ id: 'r1', seq: 7 }]);
});

test('classifyResponse accepts a good reply and names every kind of failure', () => {
  const good = '{"ok":true,"serverId":"s","rev":3,"more":false,"serverTime":"2026-10-15T00:00:00.000Z","changes":[],"rejected":[]}';
  assert.equal(classifyResponse(200, good).ok, true);
  assert.deepEqual(classifyResponse(200, '<!DOCTYPE html><title>Authorization needed</title>'), { ok: false, error: 'deploy' });
  assert.deepEqual(classifyResponse(200, '{"ok":false,"error":"auth"}'), { ok: false, error: 'auth', message: undefined });
  assert.deepEqual(classifyResponse(500, 'boom'), { ok: false, error: 'server' });
  assert.deepEqual(classifyResponse(200, 'not json'), { ok: false, error: 'server' });
  assert.deepEqual(classifyResponse(200, '{"ok":true}'), { ok: false, error: 'server' });
});

test('backoffMs doubles from 5 s up to 5 minutes, with ±20% jitter', () => {
  assert.equal(backoffMs(0, 0.5), 5000);
  assert.equal(backoffMs(1, 0.5), 10000);
  assert.equal(backoffMs(10, 0.5), 300000);
  assert.equal(backoffMs(0, 0), 4000);
  assert.equal(backoffMs(0, 1), 6000);
});

test('a connect link round-trips the web-app link and sync code', () => {
  const code = encodeConnect({ url: URL1, secret: SECRET });
  assert.equal(code, `1.TEST_id-1.${SECRET}`);
  assert.deepEqual(decodeConnect(code), { url: URL1, secret: SECRET });
  const odd = 'https://script.google.com/a/macros/example.org/s/TEST_id-2/exec';
  assert.deepEqual(decodeConnect(encodeConnect({ url: odd, secret: SECRET })), { url: odd, secret: SECRET });
});

test('a connect link can only point at Google Apps Script', () => {
  const evil = `2.${Buffer.from('https://evil.example/collect').toString('base64url')}.${SECRET}`;
  assert.equal(decodeConnect(evil), null);
  assert.equal(decodeConnect(`1.TEST_id-1.${'x'.repeat(5)}`), null);
  assert.equal(decodeConnect(`1.bad/id.${SECRET}`), null);
  assert.equal(decodeConnect('garbage'), null);
  assert.equal(decodeConnect(`1.TEST_id-1.${SECRET}`.repeat(20)), null);
});

test('a connect link to a local test server works only when the app itself runs locally', () => {
  const local = encodeConnect({ url: 'http://127.0.0.1:9000/exec', secret: SECRET });
  assert.deepEqual(decodeConnect(local, '127.0.0.1'), { url: 'http://127.0.0.1:9000/exec', secret: SECRET });
  assert.equal(decodeConnect(local, 'example.github.io'), null);
  assert.equal(decodeConnect(local), null);
});

test('sync links must be Google Apps Script, except a local test server on this computer', () => {
  assert.equal(isAllowedSyncUrl(URL1, 'example.github.io'), true);
  assert.equal(isAllowedSyncUrl('https://evil.example/exec', 'localhost'), false);
  assert.equal(isAllowedSyncUrl('http://127.0.0.1:9000/exec', 'localhost'), true);
  assert.equal(isAllowedSyncUrl('http://127.0.0.1:9000/exec', 'example.github.io'), false);
  assert.equal(isAllowedSyncUrl('not a url', 'localhost'), false);
});

test('describeRecord gives each kind of entry a readable row in the Sheet', () => {
  const cats = new Map([['cat:food', { name: 'Food & Dining', icon: '🍔' }]]);
  const d = (r) => describeRecord(r, cats);
  assert.deepEqual(d({ type: 'spend', date: '2026-10-15', item: 'Lunch', amountCents: 50050, method: 'card', categoryId: 'cat:food' }),
    { date: '2026-10-15', amount: 500.5, label: 'Lunch', note: 'Card · Food & Dining' });
  assert.deepEqual(d({ type: 'planned', date: '2026-10-26', label: 'School fees', amountCents: 1200000, direction: 'out', done: false }),
    { date: '2026-10-26', amount: -12000, label: 'School fees', note: 'Planned payment' });
  assert.deepEqual(d({ type: 'cardPayment', date: '2026-11-03', amountCents: 1200000, done: true }),
    { date: '2026-11-03', amount: -12000, label: 'Card payment', note: 'Paid' });
  assert.deepEqual(d({ type: 'payday', date: '2026-10-20', counted: false }),
    { date: '2026-10-20', amount: null, label: 'Payday', note: 'Not counted' });
  assert.deepEqual(d({ type: 'bill', stmt: '2026-10', statementCents: 2000050, minimumDueCents: 250000 }),
    { date: '2026-10', amount: 20000.5, label: 'Card bill', note: 'Minimum 2500' });
  assert.deepEqual(d({ type: 'bankCheck', date: '2026-10-15', amountCents: 500000, kind: 'opening' }),
    { date: '2026-10-15', amount: 5000, label: 'Starting balance', note: '' });
  assert.deepEqual(d({ type: 'settings', startDate: '2026-10-15' }), { date: '2026-10-15', amount: null, label: 'Settings', note: '' });
  assert.deepEqual(d({ type: 'category', name: 'Pets', icon: '🐶', places: ['Vet'] }), { date: '', amount: null, label: '🐶 Pets', note: 'Vet' });
});

test('syncStatus turns sync state into a short label', () => {
  assert.deepEqual(syncStatus({ connected: false }), { text: 'Not syncing', tone: 'muted' });
  assert.deepEqual(syncStatus({ connected: true, needsReconnect: true }), { text: 'Reconnect needed', tone: 'danger' });
  assert.deepEqual(syncStatus({ connected: true, syncing: true }), { text: 'Syncing…', tone: 'muted' });
  assert.deepEqual(syncStatus({ connected: true, online: false, pending: 2 }), { text: 'Offline · 2 waiting', tone: 'warn' });
  assert.deepEqual(syncStatus({ connected: true, online: true, pending: 0, lastError: 'busy' }), { text: 'Sync problem', tone: 'warn' });
  assert.deepEqual(syncStatus({ connected: true, online: true, pending: 3 }), { text: '3 waiting', tone: 'muted' });
  assert.deepEqual(syncStatus({ connected: true, online: true, pending: 0 }), { text: 'Synced', tone: 'ok' });
});
