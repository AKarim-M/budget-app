#!/usr/bin/env node
// Fails (exit 1) if any file that is, or is about to be, committed contains private data.
// The repo is PUBLIC. Private strings (names, real amounts, places) are listed in a file
// that lives OUTSIDE the repo: ../budget-private-denylist.txt (or $BUDGET_DENYLIST).
//
//   node tools/privacy-check.mjs            scan files
//   node tools/privacy-check.mjs --commits  also check every commit's author/committer email

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const DENYLIST = process.env.BUDGET_DENYLIST ?? resolve('..', 'budget-private-denylist.txt');
const NOREPLY = /^\d+\+[\w-]+@users\.noreply\.github\.com$/;
const BINARY = new Set(['.png', '.ico', '.jpg', '.jpeg', '.webp', '.gif', '.woff', '.woff2']);

const PATTERNS = [
  [/script\.google(?:usercontent)?\.com\/macros/i, 'Apps Script web-app link'],
  [/AKfycb[\w-]{20,}/, 'Apps Script deployment id'],
  [/#connect=\d+\./, 'device connect link'],
  [/[\w.+-]+@(?!users\.noreply\.github\.com\b|example\.(?:com|org)\b)[\w-]+(?:\.[\w-]+)+/i, 'email address'],
  [/(?<![\w-])[A-Za-z0-9_-]{40,}(?![\w-])/, 'long secret-like string'],
];
const BAD_NAMES = [/budget_tracker/i, /backup/i, /export.*\.json$/i, /denylist/i, /\.local\.(json|test\.js)$/i];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const problems = [];

const files = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);
let deny = [];
if (existsSync(DENYLIST)) {
  deny = readFileSync(DENYLIST, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
} else {
  problems.push(`private list not found at ${DENYLIST} (set BUDGET_DENYLIST)`);
}

for (const file of files) {
  if (BAD_NAMES.some((re) => re.test(file))) problems.push(`${file}: file name looks private`);
  if (BINARY.has(extname(file).toLowerCase()) || !existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');
  const lower = text.toLowerCase();
  for (const d of deny) if (lower.includes(d.toLowerCase())) problems.push(`${file}: contains a private string ("${d.slice(0, 3)}…")`);
  if (file.startsWith('vendor/')) continue;
  for (const [re, what] of PATTERNS) {
    const m = re.exec(text);
    if (m) problems.push(`${file}: ${what} (${m[0].slice(0, 12)}…)`);
  }
}

if (process.argv.includes('--commits')) {
  let log = '';
  try { log = git('log', '--format=%H %ae %ce'); } catch { log = ''; }
  for (const line of log.split('\n').filter(Boolean)) {
    const [hash, author, committer] = line.split(' ');
    if (!NOREPLY.test(author) || !NOREPLY.test(committer)) {
      problems.push(`commit ${hash.slice(0, 8)}: not using the private noreply email`);
    }
  }
}

if (problems.length) {
  console.error(`Privacy check FAILED (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Privacy check passed: ${files.length} files, ${deny.length} private strings${process.argv.includes('--commits') ? ', commit emails OK' : ''}.`);
