// Sync with the household's Google Sheet (through the Apps Script web app).
// Entries are saved on the device first; this sends what is waiting and brings back what
// other devices changed. Browser APIs are passed in, so it is tested in Node.
//
// hb1.sync = { url, secret, serverId, lastRev, lastSyncAt, clockOffsetMs, lastError,
//              needsReconnect, problems }   (this device only, never synced)

import {
  PROTOCOL, FATAL, buildPayload, classifyResponse, backoffMs, encodeConnect,
  isAllowedSyncUrl, describeRecord, syncStatus,
} from './sync-core.js';
import { DEFAULT_CATEGORIES } from './records.js';

const KEY = 'hb1.sync';
const BATCH = 200;
const MAX_ROUNDS = 25;

export function createSync({
  store,
  storage = globalThis.localStorage,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  random = Math.random,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
  isOnline = () => globalThis.navigator?.onLine ?? true,
  pageHost = globalThis.location?.hostname ?? '',
} = {}) {
  let cfg = load();
  let running = null;
  let again = false;
  let attempt = 0;
  let timer = null;
  const listeners = new Set();

  function load() {
    try {
      return JSON.parse(storage.getItem(KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function save() {
    storage.setItem(KEY, JSON.stringify(cfg));
    emit();
  }

  function emit() {
    const s = status();
    for (const fn of listeners) fn(s);
  }

  const connected = () => Boolean(cfg.url && cfg.secret);

  function categoriesMap() {
    const map = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
    for (const r of store.all()) if (r.type === 'category' && !r.deleted) map.set(r.id, r);
    return map;
  }

  function header(secret = cfg.secret) {
    const dev = store.device.get();
    return { v: PROTOCOL, secret, deviceId: dev.deviceId, by: dev.userName || 'Me' };
  }

  async function post(url, payload) {
    try {
      const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(45_000) : undefined;
      const res = await fetchImpl(url, {
        method: 'POST',
        redirect: 'follow',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        // text/plain keeps this a "simple" request: Apps Script cannot answer a CORS preflight.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal,
      });
      return classifyResponse(res.status, await res.text());
    } catch {
      return { ok: false, error: isOnline() ? 'unreachable' : 'offline' };
    }
  }

  function failed(r) {
    cfg.lastError = r.error;
    if (FATAL.has(r.error)) {
      cfg.needsReconnect = true;
    } else {
      const wait = backoffMs(attempt, random());
      attempt += 1;
      queueSync(wait);
    }
    save();
    return r;
  }

  function queueSync(ms = 0) {
    if (!connected() || cfg.needsReconnect) return;
    if (timer) cancel(timer);
    timer = schedule(() => {
      timer = null;
      syncOnce();
    }, ms);
  }

  async function runSync() {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const pending = store.pendingChanges(BATCH);
      const cats = categoriesMap();
      const { payload, sent } = buildPayload({
        pending, cfg, device: store.device.get(), describe: (r) => describeRecord(r, cats),
      });
      const t0 = now();
      const r = await post(cfg.url, payload);
      const t1 = now();
      if (!r.ok) return failed(r);

      const replaced = cfg.serverId && r.serverId !== cfg.serverId;
      const wentBack = !r.more && r.rev < (cfg.lastRev ?? 0);
      if (replaced || wentBack) {
        // A different or emptied Sheet: send everything this device has again.
        cfg.serverId = r.serverId;
        cfg.lastRev = 0;
        store.markAllDirty();
        save();
        continue;
      }

      cfg.serverId = r.serverId;
      store.applyRemote(r.changes);
      store.ackOutbox(sent);
      if (r.rejected?.length) {
        const at = new Date(t1).toISOString();
        cfg.problems = [...(cfg.problems ?? []), ...r.rejected.map((x) => ({ ...x, at }))].slice(-20);
      }
      cfg.lastRev = r.rev;
      const offset = Date.parse(r.serverTime) - Math.round((t0 + t1) / 2);
      cfg.clockOffsetMs = Math.abs(offset) > 60_000 ? offset : 0;
      cfg.lastSyncAt = t1;
      cfg.lastError = null;
      attempt = 0;
      save();
      if (!r.more && store.pendingChanges(1).length === 0) break;
    }
    return { ok: true };
  }

  function syncOnce() {
    if (!connected()) return Promise.resolve({ ok: false, error: 'not_connected' });
    if (cfg.needsReconnect) return Promise.resolve({ ok: false, error: cfg.lastError ?? 'auth' });
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      emit();
      try {
        return await runSync();
      } finally {
        running = null;
        emit();
        if (again) {
          again = false;
          queueSync(0);
        }
      }
    })();
    emit();
    return running;
  }

  async function connect({ url, secret, mode = 'merge' }) {
    const u = String(url ?? '').trim();
    const s = String(secret ?? '').trim();
    if (!isAllowedSyncUrl(u, pageHost)) return { ok: false, error: 'bad_url' };
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(s)) return { ok: false, error: 'bad_secret' };
    const r = await post(u, { ...header(s), since: 0, changes: [] });
    if (!r.ok) return r;
    cfg = {
      url: u, secret: s, serverId: r.serverId, lastRev: 0, lastSyncAt: null,
      clockOffsetMs: 0, lastError: null, needsReconnect: false, problems: [],
    };
    if (mode === 'replace') store.replaceAll([]);
    else store.markAllDirty();
    attempt = 0;
    save();
    return syncOnce();
  }

  function status() {
    const base = {
      connected: connected(),
      syncing: Boolean(running),
      pending: store.pendingChanges().length,
      online: isOnline(),
      lastSyncAt: cfg.lastSyncAt ?? null,
      lastError: cfg.lastError ?? null,
      needsReconnect: Boolean(cfg.needsReconnect),
      problems: cfg.problems ?? [],
    };
    return { ...base, ...syncStatus(base) };
  }

  return {
    connected,
    connect,
    syncOnce,
    queueSync,
    status,
    clockOffset: () => cfg.clockOffsetMs ?? 0,
    url: () => cfg.url ?? null,
    connectLink: (base) => `${base}#connect=${encodeConnect({ url: cfg.url, secret: cfg.secret })}`,

    disconnect() {
      if (timer) cancel(timer);
      cfg = {};
      storage.removeItem(KEY);
      emit();
    },

    reuploadAll() {
      store.markAllDirty();
      queueSync(0);
    },

    async resetFromSheet() {
      if (!connected()) return { ok: false, error: 'not_connected' };
      const all = [];
      let since = 0;
      for (let i = 0; i < 200; i += 1) {
        const r = await post(cfg.url, { ...header(), since, changes: [] });
        if (!r.ok) return failed(r);
        all.push(...r.changes);
        cfg.serverId = r.serverId;
        since = r.rev;
        if (!r.more) break;
      }
      store.replaceAll(all);
      Object.assign(cfg, { lastRev: since, lastError: null, needsReconnect: false });
      save();
      return { ok: true };
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Browser wiring: sync on start, when back online, when the app is opened, after edits, and every minute. */
    start({ win = globalThis.window, doc = globalThis.document } = {}) {
      store.subscribe((e) => {
        if (e.origin === 'local') queueSync(3000);
        if (e.origin !== 'device') emit();
      });
      win.addEventListener('online', () => {
        attempt = 0;
        emit();
        queueSync(0);
      });
      win.addEventListener('offline', emit);
      doc.addEventListener('visibilitychange', () => {
        if (!doc.hidden && now() - (cfg.lastSyncAt ?? 0) > 10_000) queueSync(0);
      });
      setInterval(() => {
        if (!doc.hidden) queueSync(0);
      }, 60_000);
      queueSync(0);
    },
  };
}
