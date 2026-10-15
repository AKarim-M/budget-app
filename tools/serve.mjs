#!/usr/bin/env node
// Serves the app at http://localhost:8080/budget-app/ the way GitHub Pages will
// (same sub-path, 10-minute cache), so path and caching bugs show up locally.
//   node tools/serve.mjs            PORT=8090 node tools/serve.mjs     node tools/serve.mjs --no-cache

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASE = '/budget-app/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/** connectSrc: extra sync origins to allow (tests use a local stand-in for Google's server). */
export function startServer({ root = resolve('.'), port = 8080, cache = 'max-age=600', connectSrc = '' } = {}) {
  const rootDir = resolve(root);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === BASE.slice(0, -1)) {
      res.writeHead(302, { Location: BASE });
      res.end();
      return;
    }
    if (!url.pathname.startsWith(BASE)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(rootDir, rel));
    if (file !== rootDir && !file.startsWith(rootDir + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      let body = await readFile(file);
      if (connectSrc && file.endsWith('index.html')) {
        body = Buffer.from(body.toString('utf8').replace("connect-src 'self'", `connect-src 'self' ${connectSrc}`));
      }
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': cache,
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8080);
  const cache = process.argv.includes('--no-cache') ? 'no-store' : 'max-age=600';
  await startServer({ port, cache });
  console.log(`Budget app: http://localhost:${port}${BASE}   (demo data: ${BASE}?demo=1)`);
}
