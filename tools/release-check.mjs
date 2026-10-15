#!/usr/bin/env node
// Run before every publish (the pre-push hook does it automatically):
//  1. all tests pass
//  2. nothing private is in the files or the commit emails
//  3. if app files changed since the last publish, sw.js VERSION changed too
//     (otherwise installed phones keep showing the old version)

import { execFileSync } from 'node:child_process';

function step(label, cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
    console.log(`✓ ${label}`);
    return true;
  } catch (err) {
    console.log(`✗ ${label}\n${(err.stdout ?? '') + (err.stderr ?? '')}`.trimEnd());
    return false;
  }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

let ok = step('tests', process.execPath, ['--test']);
ok = step('privacy check', process.execPath, ['tools/privacy-check.mjs', '--commits']) && ok;

let published = true;
try {
  git('rev-parse', '--verify', '--quiet', 'origin/main');
} catch {
  published = false;
}
if (!published) {
  console.log('• version check skipped (nothing published yet)');
} else {
  const appFiles = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'vendor'];
  const changed = git('diff', '--name-only', 'origin/main', 'HEAD', '--', ...appFiles);
  const versionChanged = /^\+const VERSION = /m.test(git('diff', 'origin/main', 'HEAD', '--', 'sw.js'));
  if (changed && !versionChanged) {
    console.log(`✗ version check: app files changed but VERSION in sw.js did not:\n  ${changed.split('\n').join('\n  ')}`);
    ok = false;
  } else {
    console.log('✓ version check');
  }
}

if (!ok) {
  console.log('Release check FAILED.');
  process.exit(1);
}
console.log('Release check passed.');
