// Builds a household's records for engine tests. Synthetic amounts only.
import { newRecord } from '../../js/records.js';

export function household({
  start = '2026-10-15', bankCents = 0, payCents = 1000000, weekday = 2,
  cutoffDay = 15, dueDay = 7, installmentCents = 0, openingBills = [],
} = {}) {
  let seq = 0;
  const stamp = (date) => {
    const n = seq++;
    return `${date}T01:${String(Math.floor(n / 60000)).padStart(2, '0')}:${String(Math.floor(n / 1000) % 60).padStart(2, '0')}.${String(n % 1000).padStart(3, '0')}Z`;
  };
  const records = [];
  const add = (type, fields, { date = start, at, id, by = 'A' } = {}) => {
    const r = newRecord(type, fields, { by, nowIso: at ?? stamp(date), id });
    records.push(r);
    return r;
  };
  const opening = `${start}T00:00:00.000Z`;

  add('settings', {
    startDate: start,
    paySchedule: [{ from: start, amountCents: payCents, weekday }],
    cutoffDay,
    dueDay,
    installments: installmentCents ? [{ id: 'i1', label: 'Installment', amountCents: installmentCents }] : [],
  }, { at: opening });
  add('bankCheck', { date: start, amountCents: bankCents, payIncluded: false, kind: 'opening' }, { at: opening });
  for (const b of openingBills) {
    add('bill', { stmt: b.stmt, statementCents: b.cents, minimumDueCents: b.minimumDueCents ?? null, adjustCents: 0 }, { at: opening });
  }

  const doneFields = (date, opts) => ({
    done: Boolean(opts.done),
    doneAt: opts.done ? (opts.doneAt ?? `${date}T02:00:00.000Z`) : null,
  });

  return {
    records,
    add,
    spend: (date, cents, method = 'card', opts = {}) => add('spend', {
      date, item: opts.item ?? 'Item', amountCents: cents, categoryId: opts.categoryId ?? 'cat:food', method,
    }, { date, at: opts.at, by: opts.by }),
    planned: (date, cents, direction = 'out', opts = {}) => add('planned', {
      date, label: opts.label ?? 'Planned', amountCents: cents, direction, ...doneFields(date, opts),
    }, { date: opts.createdOn ?? start, at: opts.at, by: opts.by }),
    payment: (date, cents, opts = {}) => add('cardPayment', {
      date, amountCents: cents, billStmt: opts.billStmt ?? null, ...doneFields(date, opts),
    }, { date: opts.createdOn ?? start, at: opts.at, by: opts.by }),
    payday: (date, fields) => add('payday', { date, ...fields }, { date }),
    bill: (stmt, fields) => add('bill', { stmt, adjustCents: 0, ...fields }, { date: start }),
    check: (date, cents, opts = {}) => add('bankCheck', {
      date, amountCents: cents, payIncluded: Boolean(opts.payIncluded), kind: 'check',
    }, { date, at: opts.at, by: opts.by }),
  };
}
