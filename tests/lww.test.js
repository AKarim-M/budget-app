import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canon, cmpRec, pickWinner, nextUpdatedAt } from '../js/lww.js';

const base = {
  id: 'a1', type: 'spend', by: 'Alex', createdAt: '2026-10-15T01:00:00.000Z',
  updatedAt: '2026-10-15T01:00:00.000Z', deleted: false, amountCents: 12300,
};

test('the record with the newer updatedAt wins', () => {
  const newer = { ...base, updatedAt: '2026-10-15T01:00:00.001Z', amountCents: 1 };
  assert.ok(cmpRec(newer, base) > 0);
  assert.ok(cmpRec(base, newer) < 0);
});

test('on equal updatedAt a deletion wins', () => {
  const gone = { ...base, deleted: true };
  assert.ok(cmpRec(gone, base) > 0);
  assert.ok(cmpRec(base, gone) < 0);
});

test('a full tie is broken by canonical JSON, the same way on every device', () => {
  const a = { ...base, amountCents: 2 };
  const b = { ...base, amountCents: 1 };
  assert.equal(Math.sign(cmpRec(a, b)), -Math.sign(cmpRec(b, a)));
  assert.notEqual(cmpRec(a, b), 0);
  assert.equal(cmpRec(base, { ...base }), 0);
});

test('canon sorts keys at every level and ignores rev and _view', () => {
  const x = { b: 1, a: { d: 2, c: [{ f: 1, e: 2 }] }, rev: 9, _view: { label: 'x' } };
  assert.equal(canon(x), '{"a":{"c":[{"e":2,"f":1}],"d":2},"b":1}');
});

test('pickWinner keeps the local record unless the remote one wins', () => {
  const remoteNewer = { ...base, updatedAt: '2026-10-16T00:00:00.000Z', amountCents: 5 };
  assert.equal(pickWinner(base, remoteNewer), remoteNewer);
  assert.equal(pickWinner(remoteNewer, base), remoteNewer);
  assert.equal(pickWinner(undefined, base), base);
  assert.equal(pickWinner(base, { ...base }), base);
});

test('nextUpdatedAt always moves forward, even if the clock goes back', () => {
  const t = (iso) => Date.parse(iso);
  assert.equal(nextUpdatedAt(t('2026-10-15T00:00:10.000Z'), undefined), '2026-10-15T00:00:10.000Z');
  assert.equal(nextUpdatedAt(t('2026-10-15T00:00:10.000Z'), '2026-10-15T00:00:05.000Z'), '2026-10-15T00:00:10.000Z');
  assert.equal(nextUpdatedAt(t('2026-10-15T00:00:00.000Z'), '2026-10-15T00:00:05.000Z'), '2026-10-15T00:00:05.001Z');
});
