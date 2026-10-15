// Code rules for the app: no raw HTML from strings, no inline handlers, no float money,
// no UTC date slicing, and pinch-zoom stays enabled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

const FORBIDDEN = [
  [/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/, 'builds HTML from strings'],
  [/\son[a-z]+\s*=\s*["']/, 'inline event handler attribute'],
  [/parseFloat\(/, 'float money parsing'],
  [/toISOString\(\)\.slice/, 'UTC date slicing'],
  [/new Date\(\s*['"`]/, 'Date from a string (time-zone dependent)'],
  [/user-scalable/, 'blocks pinch-zoom'],
];

export function findViolations(files) {
  const out = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const [re, why] of FORBIDDEN) if (re.test(line)) out.push(`${file}:${i + 1} ${why}`);
    });
  }
  return out;
}

test('app code follows the safety rules', () => {
  const files = [...filesUnder('js'), 'index.html'].filter((f) => existsSync(f) && /\.(js|html)$/.test(f));
  assert.deepEqual(findViolations(files), []);
});

test('the guard catches each forbidden pattern', () => {
  const samples = [
    'el.innerHTML = x;',
    '<button onclick="go()">',
    'const n = parseFloat(v);',
    'd.toISOString().slice(0, 10)',
    "new Date('2026-10-15')",
    '<meta name="viewport" content="user-scalable=no">',
  ];
  for (const s of samples) {
    assert.equal(FORBIDDEN.some(([re]) => re.test(s)), true, s);
  }
});
