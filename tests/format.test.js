import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateList, personColor, paymentName } from '../js/ui/format.js';

test('dateList writes a short list of days, naming each month once', () => {
  assert.equal(dateList(['2026-11-17', '2026-11-24', '2026-12-01']), 'Nov 17, 24 & Dec 1');
  assert.equal(dateList(['2026-11-17', '2026-11-24']), 'Nov 17 & 24');
  assert.equal(dateList(['2026-11-17']), 'Nov 17');
  assert.equal(dateList([]), '');
});

test('paymentName says what a payment ahead is: its label, a card payment, or the bill it pays', () => {
  const bills = [{ stmt: '2026-10', due: '2026-11-07' }];
  assert.equal(paymentName({ kind: 'planned-out', label: 'School fees' }, bills), 'School fees');
  assert.equal(paymentName({ kind: 'card-payment', label: 'Card payment' }, bills), 'a card payment');
  assert.equal(paymentName({ kind: 'bill-rest', label: 'Pay rest of card bill', stmt: '2026-10' }, bills), 'the Nov 7 bill');
});

test('personColor gives the same name the same colour every time', () => {
  assert.equal(personColor('Alex'), personColor('Alex'));
  assert.match(personColor('Sam'), /^#[0-9a-f]{6}$/);
});
