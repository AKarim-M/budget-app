// Record shapes, ids and validation. Every record is a plain object:
// { id, type, by, updatedBy, createdAt, updatedAt, deleted, ...fields }

import { isYMD } from './dates.js';

export const SETTINGS_ID = 'settings';
/** Timestamp for built-in defaults, so they never overwrite real data during sync. */
export const SEED_TS = '1970-01-01T00:00:00.000Z';

export const TYPES = ['settings', 'category', 'spend', 'planned', 'cardPayment', 'payday', 'bill', 'bankCheck'];

export const paydayId = (date) => `payday:${date}`;
export const billId = (stmt) => `bill:${stmt}`;
/** One month of a monthly bill, once it is ticked, changed or skipped. */
export const recurringId = (ruleId, date) => `rec:${ruleId}:${date}`;

const seedCategory = (key, name, icon, color, order) => ({
  id: `cat:${key}`, type: 'category', by: 'app', updatedBy: 'app',
  createdAt: SEED_TS, updatedAt: SEED_TS, deleted: false,
  name, icon, color, places: [], order, archived: false,
});

/** Generic starter categories. Personal names and places are imported from a local file. */
export const DEFAULT_CATEGORIES = Object.freeze([
  seedCategory('food', 'Food & Dining', '🍔', '#c2593f', 1),
  seedCategory('groceries', 'Groceries', '🛒', '#2d6a4f', 2),
  seedCategory('transport', 'Fuel & Transport', '⛽', '#b45309', 3),
  seedCategory('shopping', 'Shopping', '🛍️', '#6d4c7d', 4),
  seedCategory('health', 'Health', '💊', '#2b5b84', 5),
  seedCategory('bills', 'Bills & Fees', '💡', '#52606d', 6),
]);

export function uuid() {
  const c = globalThis.crypto;
  if (c?.randomUUID) {
    try { return c.randomUUID(); } catch { /* not a secure context: fall through */ }
  }
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function defaultId(type, fields) {
  if (type === 'settings') return SETTINGS_ID;
  if (type === 'payday') return paydayId(fields.date);
  if (type === 'bill') return billId(fields.stmt);
  return uuid();
}

export function newRecord(type, fields, { by, nowIso, id }) {
  return {
    id: id ?? defaultId(type, fields),
    type,
    by,
    updatedBy: by,
    createdAt: nowIso,
    updatedAt: nowIso,
    deleted: false,
    ...fields,
  };
}

// ---------- validation ----------

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const YM = /^\d{4}-\d{2}$/;
const HEX = /^#[0-9a-f]{6}$/i;

const isInt = (v) => Number.isSafeInteger(v);
const isPositiveInt = (v) => isInt(v) && v > 0;
const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isOptional = (v, check) => v === undefined || v === null || check(v);
const isIntBetween = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;

const RULES = {
  settings: (r) => ({
    id: r.id === SETTINGS_ID,
    startDate: isYMD(r.startDate),
    paySchedule: Array.isArray(r.paySchedule) && r.paySchedule.length > 0 && r.paySchedule.every(
      (p) => isYMD(p.from) && isPositiveInt(p.amountCents) && isIntBetween(p.weekday, 0, 6),
    ),
    cutoffDay: isIntBetween(r.cutoffDay, 2, 28),
    dueDay: isIntBetween(r.dueDay, 1, 28) && r.dueDay < r.cutoffDay,
    installments: Array.isArray(r.installments) && r.installments.every(
      (i) => isText(i.id, 64) && isText(i.label, 60) && isPositiveInt(i.amountCents)
        && isOptional(i.firstDueMonth, (v) => YM.test(v)) && isOptional(i.lastDueMonth, (v) => YM.test(v)),
    ),
    recurring: isOptional(r.recurring, (list) => Array.isArray(list) && list.every(
      (b) => isText(b.id, 40) && /^[A-Za-z0-9_-]+$/.test(b.id) && isText(b.label, 60) && isPositiveInt(b.amountCents)
        && isIntBetween(b.day, 1, 31) && isYMD(b.from) && isOptional(b.lastMonth, (v) => YM.test(v)),
    )),
  }),
  category: (r) => ({
    name: isText(r.name, 40),
    icon: typeof r.icon === 'string' && r.icon.length <= 8,
    color: typeof r.color === 'string' && HEX.test(r.color),
    places: Array.isArray(r.places) && r.places.every((p) => isText(p, 60)),
    order: Number.isFinite(r.order),
  }),
  spend: (r) => ({
    date: isYMD(r.date),
    item: isText(r.item, 120),
    amountCents: isPositiveInt(r.amountCents),
    categoryId: isText(r.categoryId, 64),
    method: r.method === 'card' || r.method === 'cash',
    note: isOptional(r.note, (v) => typeof v === 'string' && v.length <= 200),
  }),
  planned: (r) => ({
    date: isYMD(r.date),
    label: isText(r.label, 120),
    amountCents: isPositiveInt(r.amountCents),
    direction: r.direction === 'in' || r.direction === 'out',
    done: typeof r.done === 'boolean',
    doneAt: isOptional(r.doneAt, (v) => ISO_TS.test(v)),
  }),
  cardPayment: (r) => ({
    date: isYMD(r.date),
    amountCents: isPositiveInt(r.amountCents),
    done: typeof r.done === 'boolean',
    doneAt: isOptional(r.doneAt, (v) => ISO_TS.test(v)),
    billStmt: isOptional(r.billStmt, (v) => YM.test(v)),
  }),
  payday: (r) => ({
    date: isYMD(r.date),
    id: r.id === paydayId(r.date),
    counted: typeof r.counted === 'boolean',
    amountCents: isOptional(r.amountCents, isPositiveInt),
  }),
  bill: (r) => ({
    stmt: typeof r.stmt === 'string' && YM.test(r.stmt),
    id: r.id === billId(r.stmt),
    statementCents: isOptional(r.statementCents, isInt),
    minimumDueCents: isOptional(r.minimumDueCents, (v) => isInt(v) && v >= 0),
    adjustCents: isOptional(r.adjustCents, isInt),
  }),
  bankCheck: (r) => ({
    date: isYMD(r.date),
    amountCents: isInt(r.amountCents),
    walletCents: isOptional(r.walletCents, (v) => isInt(v) && v >= 0),
    payIncluded: typeof r.payIncluded === 'boolean',
    kind: r.kind === 'check' || r.kind === 'opening',
  }),
};

export function validateRecord(r) {
  if (!r || typeof r !== 'object' || !TYPES.includes(r.type)) return { ok: false, errors: ['type'] };
  const checks = {
    id: typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 64,
    by: typeof r.by === 'string' && r.by.length <= 40,
    createdAt: typeof r.createdAt === 'string' && ISO_TS.test(r.createdAt),
    updatedAt: typeof r.updatedAt === 'string' && ISO_TS.test(r.updatedAt),
    deleted: typeof r.deleted === 'boolean',
    ...RULES[r.type](r),
  };
  const errors = Object.keys(checks).filter((k) => !checks[k]);
  return { ok: errors.length === 0, errors };
}

/** Patch for ticking/unticking a planned item or card payment. */
export function applyDone(rec, done, { today, nowIso }) {
  if (!done) return { done: false, doneAt: null };
  const patch = { done: true, doneAt: nowIso };
  if (rec.date > today) patch.date = today;
  return patch;
}
