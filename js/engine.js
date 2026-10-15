// The money engine: pure functions from records + today to everything the screens show.
// Amounts are integer centavos; dates are local 'YYYY-MM-DD' strings.
//
// One pool of money (bank + wallet). Pay goes in; cash spending, planned payments and
// card bill payments come out. A card swipe stays in the bank, reserved as "card owed",
// until the bill is paid.

import { addMonthsYM, minYMD, maxYMD, ymOf, daysInMonth, diffDays } from './dates.js';
import { cycleOf, cycleByStmt, paydaysBetween, installmentsFor } from './cycles.js';
import { DEFAULT_CATEGORIES, recurringId } from './records.js';

const END_OF_DAY = '￿';
const SEVERITY = { danger: 0, warn: 1, info: 2 };

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (values) => values.reduce((t, v) => t + v, 0);
const cfgOf = (settings) => ({ cutoffDay: settings.cutoffDay, dueDay: settings.dueDay });

// ---------- index ----------

export function buildIndex(records) {
  const idx = {
    settings: null,
    categories: new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c])),
    spends: [],
    planned: [],
    cardPayments: [],
    bankChecks: [],
    paydayOv: new Map(),
    billOv: new Map(),
    deletedIds: new Set(),
  };
  for (const r of records) {
    if (!r) continue;
    if (r.deleted) {
      if (r.type === 'category') idx.categories.delete(r.id);
      idx.deletedIds.add(r.id);
      continue;
    }
    switch (r.type) {
      case 'settings': idx.settings = r; break;
      case 'category': idx.categories.set(r.id, r); break;
      case 'spend': idx.spends.push(r); break;
      case 'planned': idx.planned.push(r); break;
      case 'cardPayment': idx.cardPayments.push(r); break;
      case 'payday': idx.paydayOv.set(r.date, r); break;
      case 'bill': idx.billOv.set(r.stmt, r); break;
      case 'bankCheck': idx.bankChecks.push(r); break;
      default: break;
    }
  }
  idx.bankChecks.sort((a, b) => cmpStr(a.date, b.date) || cmpStr(a.createdAt, b.createdAt) || cmpStr(a.id, b.id));
  return idx;
}

// ---------- monthly bills ----------

/**
 * Adds each monthly bill's months up to the horizon as planned payments. A month that already
 * has its own entry (ticked, amount changed, or skipped = deleted) keeps that entry instead.
 */
function addRecurring(idx, horizon) {
  const rules = idx.settings.recurring ?? [];
  if (!rules.length) return;
  const known = new Set([...idx.planned.map((p) => p.id), ...idx.deletedIds]);
  for (const rule of rules) {
    const start = maxYMD(rule.from, idx.settings.startDate);
    for (let ym = ymOf(start); ; ym = addMonthsYM(ym, 1)) {
      if (rule.lastMonth && ym > rule.lastMonth) break;
      const date = `${ym}-${String(Math.min(rule.day, daysInMonth(ym))).padStart(2, '0')}`;
      if (date > horizon) break;
      if (date < start) continue;
      const id = recurringId(rule.id, date);
      if (known.has(id)) continue;
      idx.planned.push({
        id, type: 'planned', by: '', createdAt: '', updatedAt: '', deleted: false, virtual: true,
        date, label: rule.label, amountCents: rule.amountCents, direction: 'out', done: false, doneAt: null,
      });
    }
  }
}

// ---------- bills ----------

function buildBills(idx, today, cfg) {
  const S = idx.settings;
  const firstStmt = cycleOf(S.startDate, cfg).stmt;
  const lastStmt = cycleOf(today, cfg).stmt;
  const make = (stmt, opening) => {
    const ov = idx.billOv.get(stmt);
    return {
      stmt,
      ...cycleByStmt(stmt, cfg),
      opening,
      statementCents: ov?.statementCents ?? null,
      minimumDueCents: ov?.minimumDueCents ?? null,
      adjustCents: opening ? 0 : (ov?.adjustCents ?? 0),
      installmentCents: 0,
      installments: [],
      swipeCents: 0,
      swipeCount: 0,
      computedCents: 0,
      totalCents: 0,
      paidCents: 0,
      remCents: 0,
      status: 'open',
      foldedInto: null,
    };
  };

  const bills = [];
  for (const [stmt, ov] of idx.billOv) {
    if (stmt < firstStmt && ov.statementCents != null) bills.push(make(stmt, true));
  }
  for (let s = firstStmt; s <= lastStmt; s = addMonthsYM(s, 1)) bills.push(make(s, false));
  bills.sort((a, b) => cmpStr(a.stmt, b.stmt));

  const byStmt = new Map(bills.map((b) => [b.stmt, b]));
  for (const sp of idx.spends) {
    if (sp.method !== 'card') continue;
    const eff = minYMD(sp.date, today);
    if (eff < S.startDate) continue; // covered by the opening figures
    const b = byStmt.get(cycleOf(eff, cfg).stmt);
    if (!b || b.opening) continue;
    b.swipeCents += sp.amountCents;
    b.swipeCount += 1;
  }

  for (const b of bills) {
    if (b.opening) {
      b.computedCents = b.statementCents;
    } else {
      const inst = installmentsFor(b.stmt, S, cfg);
      b.installmentCents = inst.cents;
      b.installments = inst.items;
      b.computedCents = inst.cents + b.swipeCents + b.adjustCents;
    }
    b.totalCents = b.statementCents ?? b.computedCents;
  }
  return bills;
}

/** Card payments as allocation events. 'actual' = done only; 'forecast' = all, overdue ones moved to today. */
function paymentEvents(idx, today, mode) {
  const out = [];
  for (const p of idx.cardPayments) {
    if (mode === 'actual' && !p.done) continue;
    out.push({
      id: p.id,
      date: p.done ? minYMD(p.date, today) : maxYMD(p.date, today),
      cents: p.amountCents,
      pin: p.billStmt ?? null,
      order: p.done ? (p.doneAt ?? p.updatedAt) : p.createdAt,
    });
  }
  return out;
}

/**
 * Applies payments to bills: pinned bill first, then oldest unpaid first; leftovers become credit.
 * Entering a statement amount (Total Amount Due at the close) folds older unpaid bills into it
 * and replaces payments made on it (or newer bills) up to its close.
 */
function allocate(bills, payments) {
  const rem = new Map(bills.map((b) => [b.stmt, b.opening ? b.statementCents : b.computedCents]));
  const folded = new Map();
  const allocs = [];

  const events = [
    ...payments.map((p) => ({ date: p.date, rank: 0, order: p.order, id: p.id, payment: p })),
    ...bills
      .filter((b) => !b.opening && b.statementCents != null)
      .map((b) => ({ date: b.end, rank: 1, order: '', id: b.stmt, reset: b })),
  ].sort((a, b) => cmpStr(a.date, b.date) || a.rank - b.rank || cmpStr(a.order, b.order) || cmpStr(a.id, b.id));

  for (const ev of events) {
    if (ev.payment) {
      const p = ev.payment;
      let left = p.cents;
      const take = (stmt) => {
        const r = rem.get(stmt);
        if (left <= 0 || !(r > 0) || folded.has(stmt)) return;
        const t = Math.min(r, left);
        rem.set(stmt, r - t);
        left -= t;
        allocs.push({ paymentId: p.id, stmt, cents: t, date: ev.date, superseded: false });
      };
      if (p.pin && rem.has(p.pin)) take(p.pin);
      for (const b of bills) take(b.stmt);
      if (left > 0) allocs.push({ paymentId: p.id, stmt: null, cents: left, date: ev.date, superseded: false });
    } else {
      const B = ev.reset;
      for (const a of allocs) {
        if (a.superseded || a.date > B.end) continue;
        if (a.stmt === null || a.stmt >= B.stmt) {
          a.superseded = true;
          if (a.stmt !== null) rem.set(a.stmt, rem.get(a.stmt) + a.cents);
        }
      }
      for (const b of bills) {
        if (b.stmt >= B.stmt) break;
        if (!folded.has(b.stmt) && rem.get(b.stmt) > 0) {
          folded.set(b.stmt, B.stmt);
          rem.set(b.stmt, 0);
        }
      }
      rem.set(B.stmt, B.statementCents);
    }
  }

  let credit = sum(allocs.filter((a) => !a.superseded && a.stmt === null).map((a) => a.cents));
  for (const b of bills) {
    const r = rem.get(b.stmt);
    if (r < 0) {
      credit -= r;
      rem.set(b.stmt, 0);
    }
  }
  const creditApplied = new Map();
  for (const b of bills) {
    if (credit <= 0) break;
    const r = rem.get(b.stmt);
    if (folded.has(b.stmt) || !(r > 0)) continue;
    const t = Math.min(r, credit);
    rem.set(b.stmt, r - t);
    credit -= t;
    creditApplied.set(b.stmt, t);
  }
  return { rem, folded, allocs, credit, creditApplied };
}

function statusOf(b, today) {
  if (b.foldedInto) return 'folded';
  if (!b.opening && today <= b.end) return 'open';
  if (b.remCents <= 0) return 'paid';
  if (today <= b.due) return 'closed';
  return 'overdue';
}

function applyActual(bills, actual, today) {
  for (const b of bills) {
    b.remCents = actual.rem.get(b.stmt);
    b.paidCents = sum(actual.allocs.filter((a) => !a.superseded && a.stmt === b.stmt).map((a) => a.cents))
      + (actual.creditApplied.get(b.stmt) ?? 0);
    b.foldedInto = actual.folded.get(b.stmt) ?? null;
    b.status = statusOf(b, today);
  }
}

// ---------- bank ----------

function bankContext(idx, today, paydays) {
  const flows = [];
  for (const sp of idx.spends) {
    if (sp.method === 'cash') flows.push({ date: minYMD(sp.date, today), ts: sp.createdAt, cents: -sp.amountCents });
  }
  for (const p of idx.planned) {
    if (!p.done) continue;
    const cents = p.direction === 'in' ? p.amountCents : -p.amountCents;
    flows.push({ date: minYMD(p.date, today), ts: p.doneAt ?? p.updatedAt, cents });
  }
  for (const p of idx.cardPayments) {
    if (p.done) flows.push({ date: minYMD(p.date, today), ts: p.doneAt ?? p.updatedAt, cents: -p.amountCents });
  }
  return { checks: idx.bankChecks, flows, paydays };
}

/** Latest bank check strictly before the point (date, ts). Checks are sorted. */
function anchorBefore(checks, date, ts) {
  let found = null;
  for (const c of checks) {
    if (c.date < date || (c.date === date && c.createdAt < ts)) found = c;
    else break;
  }
  return found;
}

/** Bank + wallet at a point in time: last check, then everything after it. */
function bankAt(ctx, date, ts, { samedayPay = true } = {}) {
  const A = anchorBefore(ctx.checks, date, ts);
  let cents = A ? A.amountCents : 0;
  for (const p of ctx.paydays) {
    if (!p.counted || p.date > date) continue;
    if (A && (p.date < A.date || (p.date === A.date && A.payIncluded))) continue;
    if (p.date === date && !samedayPay) continue;
    cents += p.amountCents;
  }
  for (const f of ctx.flows) {
    const afterAnchor = !A || f.date > A.date || (f.date === A.date && f.ts > A.createdAt);
    const notLater = f.date < date || (f.date === date && f.ts <= ts);
    if (afterAnchor && notLater) cents += f.cents;
  }
  return { cents, anchor: A };
}

// ---------- timeline ----------

function buildTimeline(idx, today, C, bankNowCents, paydays, bills, forecast) {
  const rows = [];
  const push = (r) => rows.push({ overdue: false, refId: null, stmt: null, order: '', ...r });

  for (const p of paydays) {
    if (p.date <= today || p.date > C.due) continue;
    if (p.counted) push({ date: p.date, kind: 'payday', label: 'Payday', cents: p.amountCents, rank: 0, refId: p.date });
    else push({ date: p.date, kind: 'payday-off', label: 'Payday (not counted)', cents: 0, rank: 0.5, refId: p.date });
  }
  for (const p of idx.planned) {
    if (p.done) continue;
    const overdue = p.date < today;
    if (p.direction === 'in') {
      if (overdue || p.date > C.due) continue;
      push({ date: p.date, kind: 'planned-in', label: p.label, cents: p.amountCents, rank: 0, refId: p.id, order: p.createdAt });
    } else {
      const date = maxYMD(p.date, today);
      if (date > C.due) continue;
      push({ date, kind: 'planned-out', label: p.label, cents: -p.amountCents, rank: 2, refId: p.id, overdue, order: p.createdAt });
    }
  }
  for (const cp of idx.cardPayments) {
    if (cp.done) continue;
    const date = maxYMD(cp.date, today);
    if (date > C.due) continue;
    push({ date, kind: 'card-payment', label: 'Card payment', cents: -cp.amountCents, rank: 2, refId: cp.id, overdue: cp.date < today, order: cp.createdAt });
  }
  for (const b of bills) {
    if (forecast.folded.has(b.stmt)) continue;
    if (b.due >= today && b.due <= C.due) {
      push({ date: b.due, kind: 'bill-due', label: 'Card bill due', cents: 0, rank: 1, stmt: b.stmt, refId: b.stmt });
    }
    const rest = forecast.rem.get(b.stmt);
    if (rest > 0 && b.due <= C.due) {
      push({ date: maxYMD(b.due, today), kind: 'bill-rest', label: 'Pay rest of card bill', cents: -rest, rank: 2, stmt: b.stmt, refId: b.stmt, overdue: b.due < today, order: END_OF_DAY });
    }
  }
  rows.sort((a, b) => cmpStr(a.date, b.date) || a.rank - b.rank || cmpStr(a.order, b.order) || cmpStr(String(a.refId), String(b.refId)));

  const days = [];
  let balance = bankNowCents;
  for (const r of rows) {
    let day = days[days.length - 1];
    if (!day || day.date !== r.date) {
      day = { date: r.date, startCents: balance, inCents: 0, outCents: 0, endCents: balance, worstCents: balance, rows: [] };
      days.push(day);
    }
    if (r.cents > 0) day.inCents += r.cents;
    else day.outCents -= r.cents;
    balance += r.cents;
    r.balanceAfterCents = balance;
    day.endCents = balance;
    day.worstCents = day.startCents - day.outCents;
    day.rows.push(r);
  }
  let lowest = { date: today, cents: bankNowCents };
  for (const d of days) if (d.endCents < lowest.cents) lowest = { date: d.date, cents: d.endCents };
  return { rows, days, lowest };
}

// ---------- warnings ----------

function buildWarnings(idx, today, C, bills, forecast, timeline) {
  const out = [];
  const add = (code, severity, date, refId = null, data = {}) => out.push({ code, severity, date, refId, data });

  if (idx.bankChecks.length === 0) add('no_bank_check', 'warn', today);

  for (const d of timeline.days) {
    if (d.endCents < 0) {
      add('negative_balance', 'danger', d.date, null, { endCents: d.endCents });
    } else if (d.outCents > 0 && d.inCents > 0 && d.worstCents < 0) {
      const cardPayment = d.rows.some((r) => r.kind === 'card-payment' || r.kind === 'bill-rest');
      add('needs_pay_first', 'warn', d.date, null, { worstCents: d.worstCents, cardPayment });
    }
  }

  for (const b of bills) {
    if (b.foldedInto) continue;
    if (b.due < today) {
      if (b.remCents > 0) add('bill_overdue', 'danger', b.due, b.stmt, { remCents: b.remCents });
      continue;
    }
    if (b.due > C.due || forecast.folded.has(b.stmt) || b.totalCents <= 0) continue;
    let covered = sum(forecast.allocs.filter((a) => !a.superseded && a.stmt === b.stmt && a.date <= b.due).map((a) => a.cents));
    covered += forecast.creditApplied.get(b.stmt) ?? 0;
    const rest = forecast.rem.get(b.stmt);
    if (rest > 0) covered += rest; // assumed paid in full on the due date
    if (covered < b.totalCents) {
      add('interest_likely', 'warn', b.due, b.stmt, { coveredCents: covered, totalCents: b.totalCents });
    }
    if (b.minimumDueCents != null && covered < b.minimumDueCents) {
      add('late_fee_risk', 'danger', b.due, b.stmt, { coveredCents: covered, minimumDueCents: b.minimumDueCents });
    }
  }

  for (const b of bills) {
    if (!b.opening && b.statementCents == null && b.end < today && !b.foldedInto && b.remCents > 0) {
      add('statement_missing', 'info', b.end, b.stmt, { due: b.due });
    }
  }

  for (const p of idx.planned) {
    if (p.done || p.date >= today) continue;
    if (p.direction === 'in') add('overdue_planned_in', 'info', p.date, p.id, { label: p.label, cents: p.amountCents });
    else add('overdue_planned', 'warn', p.date, p.id, { label: p.label, cents: p.amountCents });
  }
  for (const cp of idx.cardPayments) {
    if (!cp.done && cp.date < today) add('overdue_payment', 'warn', cp.date, cp.id, { cents: cp.amountCents });
  }

  return out.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || cmpStr(a.date, b.date));
}

// ---------- the snapshot ----------

export function compute(records, { today }) {
  const idx = buildIndex(records);
  if (!idx.settings) return { needsSetup: true, today };
  const S = idx.settings;
  const cfg = cfgOf(S);
  const C = cycleOf(today, cfg);
  addRecurring(idx, maxYMD(C.due, today));

  const paydays = paydaysBetween(S.startDate, maxYMD(C.due, today), S, idx.paydayOv);
  const bills = buildBills(idx, today, cfg);
  const actual = allocate(bills, paymentEvents(idx, today, 'actual'));
  const forecast = allocate(bills, paymentEvents(idx, today, 'forecast'));
  applyActual(bills, actual, today);

  const ctx = bankContext(idx, today, paydays);
  const bankNow = bankAt(ctx, today, END_OF_DAY);
  const owedCents = sum(bills.map((b) => b.remCents)) - actual.credit;

  const payCents = sum(paydays.filter((p) => p.counted && p.date > today && p.date <= C.end).map((p) => p.amountCents));
  const plannedInCents = sum(idx.planned
    .filter((p) => !p.done && p.direction === 'in' && p.date >= today && p.date <= C.end)
    .map((p) => p.amountCents));
  const plannedOutCents = sum(idx.planned
    .filter((p) => !p.done && p.direction === 'out' && p.date <= C.end)
    .map((p) => p.amountCents));
  const ltsCents = bankNow.cents + payCents + plannedInCents - owedCents - plannedOutCents;

  // Until the next bill: also the pay that lands after the cut-off and before this cycle's due date,
  // less anything planned in that window. Card spending is already reserved above.
  const inWindow = (d) => d > C.end && d <= C.due;
  const afterCutoffPay = paydays.filter((p) => p.counted && inWindow(p.date));
  const untilDue = {
    due: C.due,
    paydays: afterCutoffPay.map((p) => p.date),
    payCents: sum(afterCutoffPay.map((p) => p.amountCents)),
    plannedInCents: sum(idx.planned.filter((p) => !p.done && p.direction === 'in' && inWindow(p.date)).map((p) => p.amountCents)),
    plannedOutCents: sum(idx.planned.filter((p) => !p.done && p.direction === 'out' && inWindow(p.date)).map((p) => p.amountCents)),
  };
  untilDue.cents = ltsCents + untilDue.payCents + untilDue.plannedInCents - untilDue.plannedOutCents;
  // A weekly pace, so the leeway isn't used up early. Never more than what is left.
  untilDue.daysLeft = diffDays(today, C.due);
  untilDue.weeklyCents = untilDue.cents > 0 ? Math.floor((untilDue.cents * 7) / Math.max(7, untilDue.daysLeft)) : 0;

  const timeline = buildTimeline(idx, today, C, bankNow.cents, paydays, bills, forecast);
  const warnings = buildWarnings(idx, today, C, bills, forecast, timeline);

  const reconciliations = idx.bankChecks
    .filter((c) => c.date <= today)
    .map((c) => {
      const expected = bankAt(ctx, c.date, c.createdAt, { samedayPay: c.payIncluded });
      return {
        id: c.id,
        date: c.date,
        kind: c.kind,
        enteredCents: c.amountCents,
        expectedCents: expected.cents,
        diffCents: c.amountCents - expected.cents,
        comparable: Boolean(expected.anchor),
      };
    });

  const next = paydays.find((p) => p.counted && p.date > today) ?? null;

  return {
    needsSetup: false,
    today,
    settings: S,
    cfg,
    categories: [...idx.categories.values()].filter((c) => !c.archived).sort((a, b) => a.order - b.order),
    cycle: C,
    paydays: paydays
      .filter((p) => p.date >= C.start && p.date <= C.end)
      .map((p) => ({ ...p, received: p.counted && p.date <= today })),
    bank: {
      nowCents: bankNow.cents,
      anchor: bankNow.anchor ? { id: bankNow.anchor.id, date: bankNow.anchor.date, amountCents: bankNow.anchor.amountCents } : null,
      nextPayday: next ? { date: next.date, amountCents: next.amountCents } : null,
    },
    bills,
    planned: idx.planned
      .map((p) => (p.id.startsWith('rec:') ? { ...p, recurringId: p.id.split(':')[1] } : p))
      .sort((a, b) => cmpStr(a.date, b.date) || cmpStr(a.createdAt, b.createdAt) || cmpStr(a.id, b.id)),
    owed: { cents: owedCents, creditCents: actual.credit },
    lts: {
      cents: ltsCents,
      over: ltsCents < 0,
      parts: { bankCents: bankNow.cents, payCents, plannedInCents, owedCents, plannedOutCents },
    },
    untilDue,
    timeline,
    warnings,
    reconciliations,
  };
}

// ---------- spending view ----------

export function spendingForCycle(records, stmt, { today }) {
  const idx = buildIndex(records);
  if (!idx.settings) return null;
  const cycle = cycleByStmt(stmt, cfgOf(idx.settings));

  const items = idx.spends
    .filter((s) => {
      const eff = minYMD(s.date, today);
      return eff >= cycle.start && eff <= cycle.end;
    })
    .sort((a, b) => cmpStr(b.date, a.date) || cmpStr(b.createdAt, a.createdAt));

  const totals = { cardCents: 0, cashCents: 0, totalCents: 0, count: items.length };
  const perCategory = new Map();
  const perPerson = new Map();
  for (const s of items) {
    if (s.method === 'card') totals.cardCents += s.amountCents;
    else totals.cashCents += s.amountCents;
    totals.totalCents += s.amountCents;
    if (!perCategory.has(s.categoryId)) perCategory.set(s.categoryId, []);
    perCategory.get(s.categoryId).push(s);
    perPerson.set(s.by, (perPerson.get(s.by) ?? 0) + s.amountCents);
  }

  const pct = (cents) => (totals.totalCents ? Math.round((cents * 100) / totals.totalCents) : 0);
  const entry = (category, list) => {
    const cents = sum(list.map((s) => s.amountCents));
    return { category, cents, pct: pct(cents), items: list };
  };
  const categories = [...idx.categories.values()].sort((a, b) => a.order - b.order);
  const byCategory = categories
    .filter((c) => !c.archived || perCategory.has(c.id))
    .map((c) => entry(c, perCategory.get(c.id) ?? []));
  for (const [id, list] of perCategory) {
    if (!idx.categories.has(id)) {
      byCategory.push(entry({ id, name: 'Other', icon: '•', color: '#888888', order: 999 }, list));
    }
  }

  const byPerson = [...perPerson]
    .map(([by, cents]) => ({ by, cents }))
    .sort((a, b) => b.cents - a.cents || cmpStr(a.by, b.by));

  return { cycle, items, totals, byCategory, byPerson };
}
