// Readability: every text colour must have at least WCAG AA contrast (4.5:1)
// against the backgrounds it is used on, in both themes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('css/app.css', 'utf8');

function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No colour tokens for ${selector}`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function parse(color) {
  let m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/i.exec(color);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  throw new Error(`Unsupported colour ${color}`);
}

/** Flatten a translucent colour over an opaque one. */
function over(top, under) {
  const [r, g, b, a] = parse(top);
  const [R, G, B] = parse(under);
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
}

function luminance([r, g, b]) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const PAIRS = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-subtle'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-subtle'],
  ['primary', 'surface'], ['primary', 'primary-bg'],
  ['card-accent', 'card-bg'], ['card-accent', 'surface-subtle'],
  ['cash-accent', 'cash-bg'],
  ['warn', 'warn-bg'], ['warn', 'surface'],
  ['danger', 'danger-bg'], ['danger', 'surface'],
  ['on-primary', 'primary'],
  ['good', 'good-bg'], ['good', 'surface'],
];

/** Follow var(--x) references to the colour they name. */
function resolve(t, name) {
  let v = t[name];
  for (let i = 0; i < 5 && /^var\(--([\w-]+)\)$/.test(v ?? ''); i += 1) v = t[/^var\(--([\w-]+)\)$/.exec(v)[1]];
  if (!v) throw new Error(`No value for --${name}`);
  return v;
}

const THEMES = [
  ['warm paper', ':root'],
  ['soft matte (dim)', '[data-theme="dim"]'],
  ['true black', '[data-theme="black"]'],
  ['ocean', '[data-theme="ocean"]'],
  ['terracotta', '[data-theme="terracotta"]'],
];

for (const [name, selector] of THEMES) {
  test(`${name} theme text is readable everywhere it is used`, () => {
    const t = { ...tokens(':root'), ...tokens(selector) };
    const surface = parse(t.surface).slice(0, 3);
    const failures = [];
    for (const [fg, bg] of PAIRS) {
      const [fgc, bgc] = [resolve(t, fg), resolve(t, bg)];
      const back = parse(bgc)[3] < 1 ? over(bgc, t.surface) : parse(bgc).slice(0, 3);
      const front = parse(fgc)[3] < 1 ? over(fgc, t.surface) : parse(fgc).slice(0, 3);
      const r = ratio(front, back);
      if (r < 4.5) failures.push(`${fg} on ${bg}: ${r.toFixed(2)}:1`);
    }
    assert.ok(surface.length === 3);
    assert.deepEqual(failures, []);
  });
}
