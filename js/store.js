// Records saved on this device (localStorage), plus the bookkeeping sync needs.
//
// hb1.db     = { v, seq, records: {id: record}, outbox: {id: seq} }   synced records + "waiting to sync" queue
// hb1.device = { deviceId, userName, theme, lastCategoryId, lastMethod }  this device only, never synced
// The hb1. prefix matters: every <user>.github.io site shares one storage origin.

import {
  newRecord, validateRecord, applyDone, uuid as makeUuid,
  SETTINGS_ID, paydayId, billId, DEFAULT_CATEGORIES,
} from './records.js';
import { pickWinner, nextUpdatedAt } from './lww.js';

const DB_KEY = 'hb1.db';
const DEVICE_KEY = 'hb1.device';
const SCHEMA = 1;
const DEFAULTS = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
const COMMON = ['id', 'type', 'by', 'updatedBy', 'createdAt', 'updatedAt', 'deleted'];

const maxIso = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

function stripSyncFields(rec) {
  const { rev, _view, ...rest } = rec;
  return rest;
}

function withoutCommon(rec) {
  const out = { ...rec };
  for (const k of COMMON) delete out[k];
  return out;
}

function invalid(rec, errors) {
  const err = new Error(`Invalid ${rec.type}: ${errors.join(', ')}`);
  err.errors = errors;
  return err;
}

export function createStore({
  storage = globalThis.localStorage,
  now = () => Date.now(),
  clockOffset = () => 0,
  uuid = makeUuid,
} = {}) {
  const listeners = new Set();
  let version = 0;
  let lastError = null;
  let batchDepth = 0;
  let batchOrigin = null;

  let db = load();
  let lastTs = newestTimestamp(db.records);
  let device = loadDevice();

  // ---------- persistence ----------

  function empty() {
    return { v: SCHEMA, seq: 0, records: {}, outbox: {} };
  }

  function migrate(d) {
    if (!d || typeof d !== 'object' || typeof d.records !== 'object' || d.records === null) {
      throw new Error('Unrecognised data');
    }
    return { v: d.v ?? SCHEMA, seq: d.seq ?? 0, records: d.records, outbox: d.outbox ?? {} };
  }

  function load() {
    const raw = storage.getItem(DB_KEY);
    if (!raw) return empty();
    try {
      return migrate(JSON.parse(raw));
    } catch {
      storage.setItem(`${DB_KEY}.corrupt.${now()}`, raw);
      return empty();
    }
  }

  function loadDevice() {
    let d = {};
    try {
      d = JSON.parse(storage.getItem(DEVICE_KEY) || '{}') || {};
    } catch {
      d = {};
    }
    if (!d.deviceId) {
      d.deviceId = uuid();
      storage.setItem(DEVICE_KEY, JSON.stringify(d));
    }
    return d;
  }

  function newestTimestamp(records) {
    let t = null;
    for (const r of Object.values(records)) t = maxIso(t, maxIso(r.createdAt, r.updatedAt));
    return t;
  }

  function persist() {
    try {
      storage.setItem(DB_KEY, JSON.stringify(db));
      lastError = null;
    } catch (e) {
      lastError = e; // e.g. storage full: data stays in memory and is retried on the next save
    }
  }

  function emit(origin) {
    for (const fn of listeners) fn({ origin, version });
  }

  function changed(origin) {
    version += 1;
    if (batchDepth > 0) {
      batchOrigin = batchOrigin ?? origin;
      return;
    }
    persist();
    emit(origin);
  }

  function batch(fn) {
    batchDepth += 1;
    try {
      return fn();
    } finally {
      batchDepth -= 1;
      if (batchDepth === 0 && batchOrigin) {
        const origin = batchOrigin;
        batchOrigin = null;
        persist();
        emit(origin);
      }
    }
  }

  // ---------- local edits ----------

  const userName = () => (device.userName || '').trim().slice(0, 40) || 'Me';

  /** An ISO timestamp that never goes backwards on this device and is after prevIso. */
  function tick(prevIso) {
    const ts = nextUpdatedAt(now() + clockOffset(), maxIso(lastTs, prevIso));
    lastTs = ts;
    return ts;
  }

  function writeLocal(rec) {
    const v = validateRecord(rec);
    if (!v.ok) throw invalid(rec, v.errors);
    db.records[rec.id] = rec;
    db.outbox[rec.id] = ++db.seq;
    changed('local');
    return rec;
  }

  function create(type, fields, id) {
    return writeLocal(newRecord(type, fields, { by: userName(), nowIso: tick(), id }));
  }

  function update(id, patch) {
    const prev = db.records[id];
    if (!prev) throw new Error(`No record ${id}`);
    const safe = { ...patch };
    for (const k of ['id', 'type', 'by', 'createdAt', 'updatedAt', 'updatedBy']) delete safe[k];
    return writeLocal({ ...prev, ...safe, updatedBy: userName(), updatedAt: tick(prev.updatedAt) });
  }

  /** Create or update a record with a known id (settings, paydays, bills, categories). */
  function upsert(type, id, patch, defaults = {}) {
    if (db.records[id]) return update(id, { ...patch, deleted: false });
    const seed = DEFAULTS.get(id);
    return create(type, { ...defaults, ...(seed ? withoutCommon(seed) : {}), ...patch }, id);
  }

  function add(type, fields) {
    const probe = newRecord(type, fields, { by: 'x', nowIso: '1970-01-01T00:00:00.000Z' });
    if (type !== 'spend' && type !== 'planned' && type !== 'cardPayment' && type !== 'bankCheck' && db.records[probe.id]) {
      return update(probe.id, { ...fields, deleted: false });
    }
    return create(type, fields);
  }

  function setDone(id, done, today) {
    const rec = db.records[id];
    if (!rec) throw new Error(`No record ${id}`);
    return update(id, applyDone(rec, done, { today, nowIso: tick() }));
  }

  function mergeCategoryFile(categories) {
    let imported = 0;
    batch(() => {
      for (const c of categories) {
        const id = c.id ?? (c.key ? `cat:${c.key}` : null);
        if (!id) continue;
        const fields = {};
        for (const k of ['name', 'icon', 'color', 'order', 'archived']) if (c[k] !== undefined) fields[k] = c[k];
        const existing = db.records[id] ?? DEFAULTS.get(id);
        const places = [...new Set([...(existing?.places ?? []), ...(c.places ?? [])])];
        upsert('category', id, { ...fields, places }, { icon: '•', color: '#52606d', order: 50, archived: false, places: [] });
        imported += 1;
      }
    });
    return { imported, skipped: 0 };
  }

  function importRecords(records) {
    let imported = 0;
    let skipped = 0;
    batch(() => {
      for (const raw of records) {
        const rec = stripSyncFields(raw);
        if (!validateRecord(rec).ok) {
          skipped += 1;
          continue;
        }
        const local = db.records[rec.id];
        if (pickWinner(local, rec) === rec && rec !== local) {
          db.records[rec.id] = rec;
          db.outbox[rec.id] = ++db.seq;
          imported += 1;
          changed('local');
        } else {
          skipped += 1;
        }
      }
    });
    return { imported, skipped };
  }

  // ---------- public API ----------

  return {
    get version() { return version; },
    get lastError() { return lastError; },

    all: () => Object.values(db.records),
    get: (id) => db.records[id] ?? null,
    add,
    update,
    upsert,
    remove: (id) => update(id, { deleted: true }),
    restore: (id) => update(id, { deleted: false }),
    batch,
    setPayday: (date, patch) => upsert('payday', paydayId(date), patch, { date, counted: true }),
    setBill: (stmt, patch) => upsert('bill', billId(stmt), patch, { stmt, adjustCents: 0 }),
    setDone,
    getSettings: () => {
      const s = db.records[SETTINGS_ID];
      return s && !s.deleted ? s : null;
    },
    updateSettings: (patch) => upsert('settings', SETTINGS_ID, patch),

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    exportJSON() {
      return JSON.stringify({
        app: 'budget-app',
        v: SCHEMA,
        exportedAt: new Date(now()).toISOString(),
        records: Object.values(db.records),
      }, null, 2);
    },

    importJSON(text) {
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('This file is not a budget export.');
      }
      if (Array.isArray(data?.records)) return importRecords(data.records);
      if (Array.isArray(data?.categories)) return mergeCategoryFile(data.categories);
      throw new Error('This file is not a budget export or places file.');
    },

    reloadFromStorage() {
      db = load();
      lastTs = maxIso(lastTs, newestTimestamp(db.records));
      version += 1;
      emit('storage');
    },

    // ---------- sync bookkeeping ----------

    pendingChanges(limit = Infinity) {
      return Object.entries(db.outbox)
        .sort((a, b) => a[1] - b[1])
        .slice(0, limit)
        .map(([id, seq]) => ({ record: db.records[id], seq }))
        .filter((p) => p.record);
    },

    ackOutbox(sent) {
      let any = false;
      for (const { id, seq } of sent) {
        if (db.outbox[id] === seq) {
          delete db.outbox[id];
          any = true;
        }
      }
      if (any) changed('sync');
    },

    applyRemote(records) {
      let any = false;
      for (const raw of records) {
        const rec = stripSyncFields(raw);
        if (!validateRecord(rec).ok) continue;
        const local = db.records[rec.id];
        if (pickWinner(local, rec) === rec && rec !== local) {
          db.records[rec.id] = rec;
          delete db.outbox[rec.id];
          any = true;
        }
      }
      if (any) changed('remote');
    },

    markAllDirty() {
      for (const id of Object.keys(db.records)) db.outbox[id] = ++db.seq;
      changed('sync');
    },

    replaceAll(records) {
      db = { ...db, records: {}, outbox: {} };
      for (const raw of records) {
        const rec = stripSyncFields(raw);
        db.records[rec.id] = rec;
      }
      changed('remote');
    },

    device: {
      get: () => ({ ...device }),
      set(patch) {
        device = { ...device, ...patch };
        storage.setItem(DEVICE_KEY, JSON.stringify(device));
        emit('device');
        return { ...device };
      },
    },
  };
}
