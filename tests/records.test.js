import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_ID, SEED_TS, DEFAULT_CATEGORIES, paydayId, billId, uuid,
  newRecord, validateRecord, applyDone,
} from '../js/records.js';

const NOW = '2026-10-15T02:00:00.000Z';
const make = (type, fields) => newRecord(type, fields, { by: 'Alex', nowIso: NOW });

const validSettings = () => make('settings', {
  startDate: '2026-10-15',
  paySchedule: [{ from: '2026-10-15', amountCents: 1000000, weekday: 2 }],
  cutoffDay: 15,
  dueDay: 7,
  installments: [{ id: 'i1', label: 'Installment', amountCents: 100025 }],
});

test('newRecord fills the common fields with a random id', () => {
  const r = make('spend', { date: '2026-10-15', item: 'Lunch', amountCents: 50000, categoryId: 'cat:food', method: 'cash' });
  assert.match(r.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    [r.type, r.by, r.updatedBy, r.createdAt, r.updatedAt, r.deleted],
    ['spend', 'Alex', 'Alex', NOW, NOW, false],
  );
  assert.equal(r.item, 'Lunch');
});

test('one-of-a-kind records get fixed ids so devices update the same row', () => {
  assert.equal(validSettings().id, SETTINGS_ID);
  assert.equal(make('payday', { date: '2026-10-20', counted: false }).id, 'payday:2026-10-20');
  assert.equal(make('bill', { stmt: '2026-11', adjustCents: 0 }).id, 'bill:2026-11');
  assert.equal(paydayId('2026-10-27'), 'payday:2026-10-27');
  assert.equal(billId('2026-12'), 'bill:2026-12');
});

test('default categories are generic, with no places and a seed timestamp', () => {
  assert.equal(DEFAULT_CATEGORIES.length, 6);
  for (const c of DEFAULT_CATEGORIES) {
    assert.match(c.id, /^cat:[a-z]+$/);
    assert.deepEqual(c.places, []);
    assert.equal(c.updatedAt, SEED_TS);
    assert.equal(validateRecord(c).ok, true, c.id);
  }
});

test('validateRecord accepts a valid record of every type', () => {
  const samples = [
    validSettings(),
    make('category', { name: 'Pets', icon: '🐶', color: '#7c4d3a', places: ['Vet'], order: 7, archived: false }),
    make('spend', { date: '2026-10-15', item: 'Lunch', amountCents: 50000, categoryId: 'cat:food', method: 'card' }),
    make('planned', { date: '2026-10-26', label: 'Tuition', amountCents: 1200000, direction: 'out', done: false, doneAt: null }),
    make('cardPayment', { date: '2026-11-03', amountCents: 1200000, done: false, doneAt: null }),
    make('payday', { date: '2026-10-20', counted: true, amountCents: 1500000 }),
    make('bill', { stmt: '2026-10', statementCents: 2000050, minimumDueCents: 250000, adjustCents: 0 }),
    make('bankCheck', { date: '2026-10-15', amountCents: 500000, walletCents: 20000, payIncluded: false, kind: 'opening' }),
  ];
  for (const r of samples) assert.deepEqual(validateRecord(r), { ok: true, errors: [] }, r.type);
});

test('validateRecord rejects broken records with the field at fault', () => {
  const s = validSettings();
  assert.deepEqual(validateRecord({ ...s, dueDay: 15 }).errors, ['dueDay']);
  const spend = make('spend', { date: '2026-10-15', item: 'Lunch', amountCents: 500.5, categoryId: 'cat:food', method: 'gcash' });
  assert.deepEqual(validateRecord(spend).errors.sort(), ['amountCents', 'method']);
  assert.deepEqual(validateRecord({ ...make('payday', { date: '2026-10-20', counted: true }), id: 'payday:2026-10-21' }).errors, ['id']);
  const cat = make('category', { name: 'X', icon: '•', color: 'red', places: [], order: 1, archived: false });
  assert.deepEqual(validateRecord(cat).errors, ['color']);
  assert.deepEqual(validateRecord({ type: 'nope' }).ok, false);
});

test('applyDone moves a future item to today when ticked early', () => {
  const p = make('planned', { date: '2026-10-26', label: 'Tuition', amountCents: 1, direction: 'out', done: false, doneAt: null });
  assert.deepEqual(applyDone(p, true, { today: '2026-10-24', nowIso: NOW }), { done: true, doneAt: NOW, date: '2026-10-24' });
});

test('applyDone keeps the date of an item ticked on or after its date', () => {
  const p = make('cardPayment', { date: '2026-11-03', amountCents: 1, done: false, doneAt: null });
  assert.deepEqual(applyDone(p, true, { today: '2026-11-05', nowIso: NOW }), { done: true, doneAt: NOW });
});

test('applyDone unticking clears doneAt', () => {
  const p = { ...make('cardPayment', { date: '2026-11-03', amountCents: 1, done: true, doneAt: NOW }) };
  assert.deepEqual(applyDone(p, false, { today: '2026-11-05', nowIso: NOW }), { done: false, doneAt: null });
});

test('uuid returns distinct RFC 4122 v4 ids', () => {
  const a = uuid();
  const b = uuid();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});
