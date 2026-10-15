import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateList, personColor } from '../js/ui/format.js';

test('dateList writes a short list of days, naming each month once', () => {
  assert.equal(dateList(['2026-11-17', '2026-11-24', '2026-12-01']), 'Nov 17, 24 & Dec 1');
  assert.equal(dateList(['2026-11-17', '2026-11-24']), 'Nov 17 & 24');
  assert.equal(dateList(['2026-11-17']), 'Nov 17');
  assert.equal(dateList([]), '');
});

test('personColor gives the same name the same colour every time', () => {
  assert.equal(personColor('Alex'), personColor('Alex'));
  assert.match(personColor('Sam'), /^#[0-9a-f]{6}$/);
});
