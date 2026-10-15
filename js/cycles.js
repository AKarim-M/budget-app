// Card statement cycles, paydays and installments.
// A statement is keyed by its closing month ('stmt'): with cut-off day 15, the
// Oct 15 – Nov 14 statement is '2026-11' and its bill is due Dec 7.

import { ymd, ymOf, addMonthsYM, parseYMD, eachDay, maxYMD, weekdayOf } from './dates.js';

export function cycleByStmt(stmt, { cutoffDay, dueDay }) {
  const [y, m] = stmt.split('-').map(Number);
  return {
    stmt,
    start: ymd(y, m - 1, cutoffDay),
    end: ymd(y, m, cutoffDay - 1),
    due: ymd(y, m + 1, dueDay),
  };
}

export function cycleOf(date, cfg) {
  const { d } = parseYMD(date);
  const ym = ymOf(date);
  return cycleByStmt(d >= cfg.cutoffDay ? addMonthsYM(ym, 1) : ym, cfg);
}

export const shiftStmt = (stmt, n) => addMonthsYM(stmt, n);

/** The pay schedule entry in force on a date (latest 'from' on or before it). */
export function payEntryAt(date, schedule) {
  let found = null;
  for (const entry of schedule) {
    if (entry.from <= date && (!found || entry.from >= found.from)) found = entry;
  }
  return found;
}

/**
 * Paydays in [a, b], never before settings.startDate.
 * overrides: Map(date -> {counted?, amountCents?}) from payday records.
 */
export function paydaysBetween(a, b, settings, overrides) {
  const out = [];
  for (const date of eachDay(maxYMD(a, settings.startDate), b)) {
    const entry = payEntryAt(date, settings.paySchedule);
    if (!entry || weekdayOf(date) !== entry.weekday) continue;
    const ov = overrides.get(date);
    out.push({
      date,
      amountCents: ov?.amountCents ?? entry.amountCents,
      counted: ov?.counted ?? true,
      overridden: Boolean(ov),
    });
  }
  return out;
}

/** Installments billed on the statement 'stmt' (windows are by due month). */
export function installmentsFor(stmt, settings, cfg) {
  const dueMonth = ymOf(cycleByStmt(stmt, cfg).due);
  const items = [];
  for (const inst of settings.installments ?? []) {
    if (inst.firstDueMonth && dueMonth < inst.firstDueMonth) continue;
    if (inst.lastDueMonth && dueMonth > inst.lastDueMonth) continue;
    items.push({ id: inst.id, label: inst.label, cents: inst.amountCents });
  }
  return { cents: items.reduce((sum, i) => sum + i.cents, 0), items };
}
