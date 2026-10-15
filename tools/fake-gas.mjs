// A local stand-in for the Google Apps Script web app, for tests only. It runs the real
// apps-script/Code.gs (via the Node harness) and answers the way Google does: the POST gets a
// 302 redirect to a different origin, which serves the JSON with "Access-Control-Allow-Origin: *".

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createHarness } from '../tests/helpers/gas-harness.js';

const listen = (handler) => new Promise((ok) => {
  const s = createServer(handler);
  s.listen(0, '127.0.0.1', () => ok(s));
});

export async function startFakeGas() {
  const harness = createHarness();
  harness.setup();
  const replies = new Map();
  let down = false;

  const echo = await listen((req, res) => {
    const id = new URL(req.url, 'http://local').searchParams.get('id');
    const body = replies.get(id);
    replies.delete(id);
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(body ?? '{}');
  });
  const echoOrigin = `http://127.0.0.1:${echo.address().port}`;

  const exec = await listen(async (req, res) => {
    if (down) {
      req.socket.destroy();
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(harness.ctx.doGet({}).getContent());
      return;
    }
    let data = '';
    for await (const chunk of req) data += chunk;
    const id = randomUUID();
    replies.set(id, harness.ctx.doPost({ postData: { contents: data } }).getContent());
    res.writeHead(302, { Location: `${echoOrigin}/echo?id=${id}`, 'Access-Control-Allow-Origin': '*' });
    res.end();
  });
  const execOrigin = `http://127.0.0.1:${exec.address().port}`;

  return {
    harness,
    secret: harness.secret(),
    execUrl: `${execOrigin}/exec`,
    origins: `${execOrigin} ${echoOrigin}`,
    setDown(v) { down = v; },
    close() {
      for (const s of [exec, echo]) {
        s.closeAllConnections();
        s.close();
      }
    },
  };
}
