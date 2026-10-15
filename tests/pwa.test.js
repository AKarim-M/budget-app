// Install and offline requirements: the manifest, the icons, and the service worker's file list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(f, 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const sw = read('sw.js');
const shell = [...(sw.match(/const SHELL = \[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p.replaceAll('\\', '/')];
  });
}

test('the manifest meets the Android install requirements', () => {
  for (const key of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'icons']) {
    assert.ok(manifest[key], key);
  }
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  assert.equal(manifest.prefer_related_applications, undefined);
});

test('each icon file exists with the size the manifest claims', () => {
  for (const icon of manifest.icons) {
    const buf = readFileSync(icon.src);
    assert.equal(buf.toString('ascii', 1, 4), 'PNG', icon.src);
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [w, h], icon.src);
  }
});

test('index.html links the manifest and icons with relative paths', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon-180\.png">/);
  assert.doesNotMatch(html, /(href|src)="\//, 'absolute paths break under /budget-app/');
});

test('the service worker has a version to bump on each release', () => {
  assert.match(sw, /const VERSION = '[\w.-]+';/);
});

test('the service worker keeps every app file for offline use', () => {
  const needed = ['index.html', 'manifest.webmanifest', ...filesUnder('css'), ...filesUnder('js'), ...filesUnder('icons'), ...filesUnder('vendor')];
  const missing = needed.filter((f) => !shell.includes(`./${f}`));
  assert.deepEqual(missing, []);
});

test('every file the service worker lists exists', () => {
  const absent = shell.filter((u) => u !== './' && !existsSync(u.slice(2)));
  assert.deepEqual(absent, []);
});
