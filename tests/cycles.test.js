import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cycleOf, cycleByStmt, shiftStmt, payEntryAt, paydaysBetween, installmentsFor,
} from '../js/cycles.js';

const cfg = { cutoffDay: 15, dueDay: 7 };
const payA = { from: '2026-10-15', amountCents: 1000000, weekday: 2 };
const settings = { startDate: '2026-10-15', paySchedule: [payA], ...cfg, installments: [] };

test('cycleOf maps each purchase date to the bill it is paid on', () => {
  const cases = [
    ['2026-09-17', '2026-11-07'],
    ['2026-10-11', '2026-11-07'],
    ['2026-10-14', '2026-11-07'],
    ['2026-10-15', '2026-12-07'],
    ['2026-11-14', '2026-12-07'],
    ['2026-12-20', '2027-02-07'],
    ['2027-01-14', '2027-02-07'],
  ];
  for (const [date, due] of cases) assert.equal(cycleOf(date, cfg).due, due, date);
});

test('cycleOf returns the statement period keyed by its closing month', () => {
  assert.deepEqual(cycleOf('2026-10-15', cfg),
    { stmt: '2026-11', start: '2026-10-15', end: '2026-11-14', due: '2026-12-07' });
  assert.deepEqual(cycleOf('2026-10-14', cfg),
    { stmt: '2026-10', start: '2026-09-15', end: '2026-10-14', due: '2026-11-07' });
});

test('cycleByStmt and shiftStmt move between statements across years', () => {
  assert.deepEqual(cycleByStmt('2027-01', cfg),
    { stmt: '2027-01', start: '2026-12-15', end: '2027-01-14', due: '2027-02-07' });
  assert.equal(shiftStmt('2026-12', 1), '2027-01');
  assert.equal(shiftStmt('2026-11', -1), '2026-10');
});

test('payEntryAt picks the pay schedule entry in force on a date', () => {
  const schedule = [payA, { from: '2026-11-01', amountCents: 1500000, weekday: 5 }];
  assert.equal(payEntryAt('2026-10-31', schedule).amountCents, 1000000);
  assert.equal(payEntryAt('2026-11-01', schedule).amountCents, 1500000);
  assert.equal(payEntryAt('2026-10-01', schedule), null);
});

test('paydaysBetween lists the Tuesdays of a 4-payday cycle', () => {
  const days = paydaysBetween('2026-10-15', '2026-11-14', settings, new Map());
  assert.deepEqual(days.map((p) => p.date), ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10']);
  assert.ok(days.every((p) => p.amountCents === 1000000 && p.counted === true));
});

test('a 5-payday cycle can start on a payday', () => {
  const days = paydaysBetween('2026-12-15', '2027-01-14', settings, new Map());
  assert.deepEqual(days.map((p) => p.date),
    ['2026-12-15', '2026-12-22', '2026-12-29', '2027-01-05', '2027-01-12']);
});

test('no paydays before the start date', () => {
  const days = paydaysBetween('2026-10-01', '2026-10-31', settings, new Map());
  assert.deepEqual(days.map((p) => p.date), ['2026-10-20', '2026-10-27']);
});

test('payday overrides can uncount a payday or change its amount', () => {
  const overrides = new Map([
    ['2026-10-20', { counted: false }],
    ['2026-10-27', { amountCents: 1500000 }],
  ]);
  const [a, b, c] = paydaysBetween('2026-10-15', '2026-11-05', settings, overrides);
  assert.deepEqual([a.counted, a.amountCents, a.overridden], [false, 1000000, true]);
  assert.deepEqual([b.counted, b.amountCents, b.overridden], [true, 1500000, true]);
  assert.deepEqual([c.counted, c.amountCents, c.overridden], [true, 1000000, false]);
});

test('a pay schedule change applies from its date (new weekday and amount)', () => {
  const s = { ...settings, paySchedule: [payA, { from: '2026-11-01', amountCents: 1500000, weekday: 5 }] };
  const days = paydaysBetween('2026-10-25', '2026-11-14', s, new Map());
  assert.deepEqual(days.map((p) => [p.date, p.amountCents]),
    [['2026-10-27', 1000000], ['2026-11-06', 1500000], ['2026-11-13', 1500000]]);
});

test('installmentsFor uses the bill due month and each installment window', () => {
  const s = {
    ...settings,
    installments: [
      { id: 'i1', label: 'Gadget', amountCents: 100025 },
      { id: 'i2', label: 'Phone', amountCents: 100000, firstDueMonth: '2027-01', lastDueMonth: '2027-02' },
    ],
  };
  assert.equal(installmentsFor('2026-11', s, cfg).cents, 100025); // due Dec 2026
  assert.equal(installmentsFor('2026-12', s, cfg).cents, 200025); // due Jan 2027
  assert.equal(installmentsFor('2027-01', s, cfg).cents, 200025); // due Feb 2027
  assert.equal(installmentsFor('2027-02', s, cfg).cents, 100025); // due Mar 2027
  assert.deepEqual(installmentsFor('2026-12', s, cfg).items.map((i) => i.id), ['i1', 'i2']);
});
