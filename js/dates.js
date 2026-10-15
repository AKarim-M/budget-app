// Calendar-date helpers. A date is a local 'YYYY-MM-DD' string.
// Date.UTC is used purely as a calendar calculator, so the device's time zone
// can never shift a date (the old app's toISOString() bug).

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const pad2 = (n) => String(n).padStart(2, '0');
const pad4 = (n) => String(n).padStart(4, '0');

function fromUTC(t) {
  const d = new Date(t);
  return `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function toUTC(s) {
  const { y, m, d } = parseYMD(s);
  return Date.UTC(y, m - 1, d);
}

export function isYMD(s) {
  if (typeof s !== 'string') return false;
  const m = RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function parseYMD(s) {
  if (!isYMD(s)) throw new RangeError(`Not a valid date: ${s}`);
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** Month is 1-based; overflow (month 13, day 32...) rolls forward like a calendar. */
export function ymd(y, m, d) {
  return fromUTC(Date.UTC(y, m - 1, d));
}

export function todayLocal(now = new Date()) {
  return `${pad4(now.getFullYear())}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function addDays(s, n) {
  return fromUTC(toUTC(s) + n * DAY_MS);
}

/** Days from a to b (positive when b is later). */
export function diffDays(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(s) {
  return new Date(toUTC(s)).getUTCDay();
}

export function ymOf(s) {
  return s.slice(0, 7);
}

export function addMonthsYM(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${pad4(Math.floor(t / 12))}-${pad2((((t % 12) + 12) % 12) + 1)}`;
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const minYMD = (a, b) => (a <= b ? a : b);
export const maxYMD = (a, b) => (a >= b ? a : b);

export function eachDay(a, b) {
  const out = [];
  for (let s = a; s <= b; s = addDays(s, 1)) out.push(s);
  return out;
}
