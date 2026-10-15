// A minimal Chrome DevTools Protocol driver (no dependencies): a real phone-size viewport,
// in-page actions, console-error capture and screenshots. Uses a throwaway Chrome profile.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'budget-cdp-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i += 1) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome did not start');
  await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  return {
    port,
    async close() {
      proc.kill();
      await sleep(500);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    },
  };
}

export async function openPage(port, { width = 412, height = 915, dark = false } = {}) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(msg.error.message));
      else ok(msg.result);
    } else {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}) => new Promise((ok, fail) => {
    nextId += 1;
    pending.set(nextId, { ok, fail });
    ws.send(JSON.stringify({ id: nextId, method, params }));
  });

  const errors = [];
  listeners.add((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push(d?.exception?.description ?? d?.text ?? 'exception');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const setDark = (on) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: on ? 'dark' : 'light' }] });
  await setDark(dark);

  const page = {
    errors,
    setDark,
    async setViewport(w, h, mobile = true) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
      width = w;
      await sleep(150);
    },
    async goto(url) {
      const loaded = new Promise((ok) => {
        const l = (m) => {
          if (m.method === 'Page.loadEventFired') {
            listeners.delete(l);
            ok();
          }
        };
        listeners.add(l);
      });
      await send('Page.navigate', { url });
      await loaded;
      await sleep(250);
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expression, timeout = 5000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await page.eval(`Boolean(${expression})`)) return;
        await sleep(80);
      }
      throw new Error(`Timed out waiting for: ${expression}`);
    },
    async screenshot(file, { full = false } = {}) {
      let clip;
      if (full) {
        const h = await page.eval('Math.ceil(document.documentElement.scrollHeight)');
        clip = { x: 0, y: 0, width, height: h, scale: 1 };
      }
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip ? { clip } : {}) });
      writeFileSync(file, Buffer.from(data, 'base64'));
    },
    close() {
      ws.close();
    },
  };
  return page;
}

/** In-page helpers, installed with page.eval(HELPERS). */
export const HELPERS = `window.__t = {
  q: (sel, root = document) => root.querySelector(sel),
  btn: (text, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text)),
  field: (label, root = document) => {
    const l = [...root.querySelectorAll('label.field-label')].find((x) => x.textContent.trim() === label);
    return l ? document.getElementById(l.htmlFor) : null;
  },
  fill: (el, value) => {
    if (!el) throw new Error('field not found');
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },
  text: (sel) => document.querySelector(sel)?.textContent ?? '',
  overflow: () => document.documentElement.scrollWidth - window.innerWidth,
}; true`;
