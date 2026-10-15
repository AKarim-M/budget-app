import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, formatPeso, formatInput, sumCents } from '../js/money.js';

test('parseMoney reads common peso formats into whole centavos', () => {
  assert.deepEqual(parseMoney('2,345.60'), { ok: true, cents: 234560 });
  assert.deepEqual(parseMoney('₱12,000'), { ok: true, cents: 1200000 });
  assert.deepEqual(parseMoney('PHP 500'), { ok: true, cents: 50000 });
  assert.deepEqual(parseMoney('.5'), { ok: true, cents: 50 });
  assert.deepEqual(parseMoney('12.'), { ok: true, cents: 1200 });
  assert.deepEqual(parseMoney(' 650 '), { ok: true, cents: 65000 });
  assert.deepEqual(parseMoney('0.07'), { ok: true, cents: 7 });
  assert.deepEqual(parseMoney(23456.78), { ok: true, cents: 2345678 });
});

test('parseMoney never uses float multiplication', () => {
  // 1.005 * 100 = 100.49999... in floating point; 4.35 * 100 = 434.99999...
  assert.deepEqual(parseMoney('4.35'), { ok: true, cents: 435 });
  assert.deepEqual(parseMoney('1,234,567.89'), { ok: true, cents: 123456789 });
});

test('parseMoney rejects bad input with a reason', () => {
  assert.equal(parseMoney('').error, 'empty');
  assert.equal(parseMoney('₱').error, 'empty');
  assert.equal(parseMoney('abc').error, 'invalid');
  assert.equal(parseMoney('1e3').error, 'invalid');
  assert.equal(parseMoney('1,00').error, 'invalid');
  assert.equal(parseMoney('.').error, 'invalid');
  assert.equal(parseMoney('12.345').error, 'too_many_decimals');
  assert.equal(parseMoney('-5').error, 'negative');
  assert.equal(parseMoney('0').error, 'zero');
  assert.equal(parseMoney('1,000,000,000').error, 'too_large');
});

test('parseMoney options allow negatives and zero when asked', () => {
  assert.deepEqual(parseMoney('-5', { allowNegative: true }), { ok: true, cents: -500 });
  assert.deepEqual(parseMoney('−₱1,000', { allowNegative: true }), { ok: true, cents: -100000 });
  assert.deepEqual(parseMoney('0', { allowZero: true }), { ok: true, cents: 0 });
});

test('formatPeso groups thousands and always shows centavos', () => {
  assert.equal(formatPeso(345678), '₱3,456.78');
  assert.equal(formatPeso(-100000), '−₱1,000.00');
  assert.equal(formatPeso(5), '₱0.05');
  assert.equal(formatPeso(0), '₱0.00');
  assert.equal(formatPeso(123456789012), '₱1,234,567,890.12');
});

test('formatPeso signed option marks money in and out', () => {
  assert.equal(formatPeso(1200000, { signed: true }), '+₱12,000.00');
  assert.equal(formatPeso(-1200000, { signed: true }), '−₱12,000.00');
  assert.equal(formatPeso(0, { signed: true }), '₱0.00');
});

test('formatInput gives a plain number for editing fields', () => {
  assert.equal(formatInput(234560), '2345.60');
  assert.equal(formatInput(1200000), '12000');
  assert.equal(formatInput(50), '0.50');
  assert.equal(formatInput(-500), '-5');
});

test('sumCents adds integer centavos', () => {
  assert.equal(sumCents([2345678, 234560]), 2580238);
  assert.equal(sumCents([]), 0);
});
