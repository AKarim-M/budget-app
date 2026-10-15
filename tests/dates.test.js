import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isYMD, ymd, parseYMD, todayLocal, addDays, diffDays, weekdayOf,
  ymOf, addMonthsYM, minYMD, maxYMD, eachDay, daysInMonth,
} from '../js/dates.js';

test('isYMD accepts only real calendar dates', () => {
  assert.equal(isYMD('2026-10-15'), true);
  assert.equal(isYMD('2028-02-29'), true);
  assert.equal(isYMD('2026-02-29'), false);
  assert.equal(isYMD('2026-13-01'), false);
  assert.equal(isYMD('2026-1-5'), false);
  assert.equal(isYMD(''), false);
  assert.equal(isYMD(null), false);
  assert.equal(isYMD(20261015), false);
});

test('ymd zero-pads and normalizes month overflow', () => {
  assert.equal(ymd(2026, 10, 15), '2026-10-15');
  assert.equal(ymd(2026, 13, 7), '2027-01-07');
  assert.equal(ymd(2027, 0, 15), '2026-12-15');
});

test('parseYMD returns numeric parts and rejects invalid dates', () => {
  assert.deepEqual(parseYMD('2026-10-05'), { y: 2026, m: 10, d: 5 });
  assert.throws(() => parseYMD('2026-02-30'), RangeError);
});

test('todayLocal reads the local calendar day, never UTC', () => {
  assert.equal(todayLocal(new Date(2026, 9, 15, 23, 59)), '2026-10-15');
  assert.equal(todayLocal(new Date(2026, 9, 16, 0, 1)), '2026-10-16');
});

test('addDays crosses month, year and leap day', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('diffDays counts calendar days between dates', () => {
  assert.equal(diffDays('2026-10-14', '2026-11-07'), 24);
  assert.equal(diffDays('2026-10-15', '2026-12-07'), 53);
  assert.equal(diffDays('2026-11-07', '2026-10-14'), -24);
});

test('weekdayOf uses Sunday = 0', () => {
  assert.equal(weekdayOf('2026-10-15'), 4);
  assert.equal(weekdayOf('2026-10-20'), 2);
});

test('ymOf and addMonthsYM roll over years', () => {
  assert.equal(ymOf('2026-10-15'), '2026-10');
  assert.equal(addMonthsYM('2026-12', 1), '2027-01');
  assert.equal(addMonthsYM('2027-01', -1), '2026-12');
  assert.equal(addMonthsYM('2026-10', 14), '2027-12');
});

test('daysInMonth knows short months and leap years', () => {
  assert.equal(daysInMonth('2026-11'), 30);
  assert.equal(daysInMonth('2026-12'), 31);
  assert.equal(daysInMonth('2027-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
});

test('minYMD and maxYMD compare dates', () => {
  assert.equal(minYMD('2026-10-15', '2026-09-30'), '2026-09-30');
  assert.equal(maxYMD('2026-10-15', '2026-09-30'), '2026-10-15');
});

test('eachDay lists an inclusive range, empty when reversed', () => {
  assert.deepEqual(eachDay('2026-10-30', '2026-11-02'),
    ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(eachDay('2026-11-02', '2026-11-01'), []);
});
