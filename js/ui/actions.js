// Pop-up forms shared by several tabs, plus the spending row used in lists.
import { h, cmp } from './dom.js';
import { openSheet, toast } from './overlay.js';
import {
  field, textInput, dateInput, moneyInput, select, segmented,
  readMoney, readOptionalMoney, showError, clearErrors,
} from './forms.js';
import { peso, dayLabel, shortDate, billLabel, range, ordinal } from './format.js';
import { formatInput } from '../money.js';
import { isYMD, minYMD, ymOf } from '../dates.js';
import { payEntryAt } from '../cycles.js';
import { uuid } from '../records.js';

const METHOD_OPTIONS = [['card', '💳 Card', 'card-opt'], ['cash', '💵 Cash', 'cash-opt']];

function primary(label) {
  return h('button', { type: 'submit', class: 'btn btn-primary' }, label);
}

function readDate(input, { max } = {}) {
  if (!isYMD(input.value)) {
    showError(input, 'Choose a date.');
    return null;
  }
  return max ? minYMD(input.value, max) : input.value;
}

// ---------- rows ----------

export function spendRow(rec, app) {
  const cat = app.snap.categories.find((c) => c.id === rec.categoryId);
  return h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' },
        h('span', { class: `tag tag-${rec.method}` }, rec.method === 'card' ? '💳 Card' : '💵 Cash'),
        rec.item),
      h('div', { class: 'row-meta' },
        `${cat ? `${cat.icon} ${cat.name}` : 'Other'} · ${dayLabel(rec.date)} · ${rec.by}`)),
    h('div', { class: 'row-end' },
      h('strong', { class: 'num' }, peso(rec.amountCents)),
      h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': `Edit ${rec.item}`,
        onclick: () => openSpendEditor(app, rec),
      }, '✎')));
}

export function recentSpends(app, limit = 20) {
  return app.store.all()
    .filter((r) => r.type === 'spend' && !r.deleted)
    .sort((a, b) => cmp(b.date, a.date) || cmp(b.createdAt, a.createdAt))
    .slice(0, limit);
}

// ---------- breakdown ----------

export function openBreakdown(app) {
  const s = app.snap;
  const p = s.lts.parts;
  const line = (label, cents, { signed = true } = {}) => h('div', {},
    h('span', {}, label), h('span', { class: 'num' }, peso(cents, { signed })));
  openSheet(s.lts.over ? 'Over by: how it adds up' : 'Left to spend: how it adds up', (body) => {
    body.append(
      h('p', { class: 'section-note' }, `Everything up to the ${shortDate(s.cycle.end)} cut-off, with the card and planned payments set aside.`),
      h('div', { class: 'breakdown' },
        line('In the bank now', p.bankCents, { signed: false }),
        line(`Pay still coming (to ${shortDate(s.cycle.end)})`, p.payCents),
        p.plannedInCents ? line('Planned money in', p.plannedInCents) : null,
        line('Owed to the card', -p.owedCents),
        line('Planned payments', -p.plannedOutCents),
        h('div', {}, h('span', {}, s.lts.over ? 'Over by' : 'Left to spend'), h('span', { class: 'num' }, peso(Math.abs(s.lts.cents))))));
  });
}

// ---------- spending ----------

export function openSpendEditor(app, rec) {
  openSheet('Edit item', (body, close) => {
    const cats = app.snap.categories;
    const options = cats.map((c) => [c.id, `${c.icon} ${c.name}`]);
    if (!cats.some((c) => c.id === rec.categoryId)) options.push([rec.categoryId, 'Other']);
    const item = textInput({ value: rec.item, maxlength: 120 });
    const amount = moneyInput({ value: formatInput(rec.amountCents) });
    const date = dateInput({ value: rec.date, max: app.today() });
    const cat = select(options, rec.categoryId);
    const method = segmented('edit-method', METHOD_OPTIONS, rec.method);
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        clearErrors(form);
        if (!item.value.trim()) return showError(item, 'Enter what it was for.');
        const money = readMoney(amount);
        if (!money.ok) return undefined;
        const d = readDate(date, { max: app.today() });
        if (!d) return undefined;
        app.store.update(rec.id, {
          item: item.value.trim(), amountCents: money.cents, date: d, categoryId: cat.value, method: method.value(),
        });
        close();
        toast('Saved');
        return undefined;
      },
    },
    field('Item', item),
    h('div', { class: 'row2' }, field('Amount', amount), field('Date', date)),
    field('Category', cat),
    field('Paid with', method.el),
    primary('Save'),
    h('div', { class: 'btn-row', style: { marginTop: '12px' } },
      h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: () => {
          app.store.remove(rec.id);
          close();
          toast(`Deleted ${rec.item}`, { action: 'Undo', onAction: () => app.store.restore(rec.id) });
        },
      }, 'Delete')));
    body.append(form);
  });
}

// ---------- bank check ----------

export function openBankCheck(app) {
  const today = app.today();
  const isPayday = (app.snap?.paydays ?? []).some((p) => p.date === today && p.counted);
  openSheet('Bank balance', (body, close) => {
    const bank = moneyInput({ placeholder: '₱ as shown in your bank app' });
    const wallet = moneyInput({ placeholder: '₱ 0.00 (optional)' });
    const payIn = h('input', { type: 'checkbox', checked: true });
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const b = readMoney(bank, { allowZero: true, allowNegative: true });
        if (!b.ok) return;
        const w = readOptionalMoney(wallet, { allowZero: true });
        if (!w.ok) return;
        const total = b.cents + (w.cents ?? 0);
        app.store.add('bankCheck', {
          date: today, amountCents: total, walletCents: w.cents ?? 0,
          payIncluded: isPayday ? payIn.checked : false, kind: 'check',
        });
        close();
        toast(`Money on hand set to ${peso(total)}`);
      },
    },
    h('p', { class: 'section-note' }, 'Enter what your bank shows right now, plus cash in your wallet. The app counts from here.'),
    field('Bank balance', bank),
    field('Cash in wallet', wallet),
    isPayday ? h('label', { class: 'check' }, payIn, "Today's pay is already in this balance") : null,
    primary('Save balance'));
    body.append(form);
  });
}

// ---------- planned payments ----------

/** A monthly bill's month becomes a real entry the first time it is ticked, changed or skipped. */
function materialize(app, p) {
  if (!p.virtual) return;
  app.store.upsert('planned', p.id, {
    date: p.date, label: p.label, amountCents: p.amountCents, direction: p.direction, done: false, doneAt: null,
  });
}

export function tickPlanned(app, p, done) {
  materialize(app, p);
  app.store.setDone(p.id, done, app.today());
}

export function openPlannedEditor(app, rec = null) {
  const monthly = Boolean(rec?.recurringId);
  openSheet(rec ? (monthly ? `${rec.label}, ${dayLabel(rec.date)}` : 'Edit planned item') : 'Plan a payment', (body, close) => {
    const label = textInput({ value: rec?.label ?? '', placeholder: 'What for (e.g. school fees)', maxlength: 120 });
    const amount = moneyInput({ value: rec ? formatInput(rec.amountCents) : '' });
    const date = dateInput({ value: rec?.date ?? app.today() });
    const dir = segmented('planned-dir', [['out', 'Money out'], ['in', 'Money in']], rec?.direction ?? 'out');
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        clearErrors(form);
        if (!label.value.trim()) return showError(label, 'Enter what it is for.');
        const money = readMoney(amount);
        if (!money.ok) return undefined;
        const d = readDate(date);
        if (!d) return undefined;
        const fields = { label: label.value.trim(), amountCents: money.cents, date: d, direction: dir.value() };
        if (rec?.virtual) app.store.upsert('planned', rec.id, { ...fields, done: false, doneAt: null });
        else if (rec) app.store.update(rec.id, fields);
        else app.store.add('planned', { ...fields, done: false, doneAt: null });
        close();
        toast(rec ? 'Saved' : `Planned ${fields.label} on ${dayLabel(d)}`);
        return undefined;
      },
    },
    h('p', { class: 'section-note' }, monthly
      ? 'One month of a monthly bill. Changes here apply to this month only; edit the bill under Monthly bills to change every month.'
      : 'It is set aside from "Left to spend" now, and leaves the bank when you tick it as paid.'),
    field('What for', label),
    h('div', { class: 'row2' }, field('Amount', amount), field('Date', date)),
    field('Type', dir.el),
    primary(rec ? 'Save' : 'Add to plan'),
    rec ? h('div', { class: 'btn-row', style: { marginTop: '12px' } },
      h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: () => {
          materialize(app, rec);
          app.store.remove(rec.id);
          close();
          toast(monthly ? `Skipped ${rec.label} for ${dayLabel(rec.date)}` : `Removed ${rec.label}`,
            { action: 'Undo', onAction: () => app.store.restore(rec.id) });
        },
      }, monthly ? 'Skip this month' : 'Remove')) : null);
    body.append(form);
  });
}

// ---------- monthly bills ----------

export function openRecurringEditor(app, rule = null) {
  openSheet(rule ? `Edit ${rule.label}` : 'Add a monthly bill', (body, close) => {
    const label = textInput({ value: rule?.label ?? '', placeholder: 'e.g. Electricity', maxlength: 60 });
    const amount = moneyInput({ value: rule ? formatInput(rule.amountCents) : '' });
    const day = select([['', 'Choose'], ...Array.from({ length: 31 }, (_, i) => [i + 1, ordinal(i + 1)])], rule?.day ?? '');
    const from = dateInput({ value: rule?.from ?? app.today() });
    const last = h('input', { type: 'month', value: rule?.lastMonth ?? '' });
    const others = () => (app.snap.settings.recurring ?? []).filter((r) => r.id !== rule?.id);
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        clearErrors(form);
        if (!label.value.trim()) return showError(label, 'Enter what the bill is for.');
        const money = readMoney(amount);
        if (!money.ok) return undefined;
        if (day.value === '') return showError(day, 'Choose the day it is due each month.');
        const start = readDate(from);
        if (!start) return undefined;
        if (last.value && (!/^\d{4}-\d{2}$/.test(last.value) || last.value < ymOf(start))) {
          return showError(last, 'Choose a month on or after the start.');
        }
        const next = {
          id: rule?.id ?? uuid(),
          label: label.value.trim(),
          amountCents: money.cents,
          day: Number(day.value),
          from: start,
          ...(last.value ? { lastMonth: last.value } : {}),
        };
        app.store.updateSettings({ recurring: [...others(), next] });
        close();
        toast(rule ? 'Monthly bill saved' : `${next.label} added: every month on the ${ordinal(next.day)}`);
        return undefined;
      },
    },
    h('p', { class: 'section-note' }, 'For bills you pay every month from the bank or in cash. Each month appears in Planned payments by itself, and is set aside from "Left to spend" once it falls before the cut-off. If one month costs more or less, change that month in Planned payments.'),
    field('What for', label),
    h('div', { class: 'row2' }, field('Usual amount', amount), field('Due each month on the', day)),
    h('div', { class: 'row2' }, field('Starting from', from), field('Last month', last, { hint: 'Optional, if it ends' })),
    primary(rule ? 'Save' : 'Add monthly bill'),
    rule ? h('div', { class: 'btn-row', style: { marginTop: '12px' } },
      h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: () => {
          app.store.updateSettings({ recurring: others() });
          close();
          toast(`${rule.label} removed. Months already paid stay in your history.`);
        },
      }, 'Remove monthly bill')) : null);
    body.append(form);
  });
}

// ---------- card payments ----------

export function openPaymentEditor(app, { bill = null, rec = null } = {}) {
  const today = app.today();
  const title = rec ? 'Edit card payment' : bill ? `Pay the ${billLabel(bill.due)}` : 'Card payment';
  openSheet(title, (body, close) => {
    const startCents = rec ? rec.amountCents : Math.max(bill?.remCents ?? 0, 0);
    const amount = moneyInput({ value: startCents ? formatInput(startCents) : '' });
    const date = dateInput({ value: rec?.date ?? today });
    const paid = h('input', { type: 'checkbox', checked: rec ? rec.done : true });
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        clearErrors(form);
        const money = readMoney(amount);
        if (!money.ok) return;
        const d = readDate(date);
        if (!d) return;
        if (paid.checked && d > today) {
          showError(date, 'A payment that is already made cannot be dated in the future.');
          return;
        }
        let id = rec?.id;
        if (rec) {
          app.store.update(rec.id, { amountCents: money.cents, date: d });
        } else {
          id = app.store.add('cardPayment', {
            date: d, amountCents: money.cents, done: false, doneAt: null, billStmt: bill?.stmt ?? null,
          }).id;
        }
        if (paid.checked !== Boolean(app.store.get(id).done)) app.store.setDone(id, paid.checked, today);
        close();
        toast(paid.checked ? `Card payment of ${peso(money.cents)} recorded` : `Card payment of ${peso(money.cents)} scheduled for ${dayLabel(d)}`);
      },
    },
    bill ? h('p', { class: 'section-note' }, `${billLabel(bill.due)} · purchases ${range(bill.start, bill.end)} · ${peso(bill.remCents)} still to pay.`) : null,
    h('div', { class: 'row2' }, field('Amount', amount), field('Date', date)),
    h('label', { class: 'check' }, paid, 'Already paid (untick to plan it for that date)'),
    primary('Save payment'),
    rec ? h('div', { class: 'btn-row', style: { marginTop: '12px' } },
      h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: () => {
          app.store.remove(rec.id);
          close();
          toast('Payment removed', { action: 'Undo', onAction: () => app.store.restore(rec.id) });
        },
      }, 'Remove')) : null);
    body.append(form);
  });
}

// ---------- statement ----------

export function openStatementEditor(app, bill) {
  openSheet(`${billLabel(bill.due)} amounts`, (body, close) => {
    const total = moneyInput({ value: bill.statementCents != null ? formatInput(bill.statementCents) : '' });
    const min = moneyInput({ value: bill.minimumDueCents != null ? formatInput(bill.minimumDueCents) : '' });
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const t = bill.opening
          ? readMoney(total, { allowZero: true })
          : readOptionalMoney(total, { allowZero: true, allowNegative: true });
        if (!t.ok) return;
        const m = readOptionalMoney(min, { allowZero: true });
        if (!m.ok) return;
        app.store.setBill(bill.stmt, { statementCents: t.cents, minimumDueCents: m.cents });
        close();
        toast('Bill updated');
      },
    },
    h('p', { class: 'section-note' }, bill.opening
      ? `Purchases ${range(bill.start, bill.end)}. Enter what was still unpaid when you started using the app.`
      : `Purchases ${range(bill.start, bill.end)}. From the statement: "Total Amount Due" and "Minimum Amount Due". The app worked out ${peso(bill.computedCents)} from what was logged.`),
    field(bill.opening ? 'Amount still unpaid' : 'Total Amount Due', total, { hint: bill.opening ? null : 'Leave empty to use the amount worked out from your entries.' }),
    field('Minimum Amount Due', min, { hint: 'Optional. Used to warn about late fees.' }),
    primary('Save'));
    body.append(form);
  });
}

// ---------- paydays ----------

export function openPaydayEditor(app, p) {
  openSheet(`Payday ${dayLabel(p.date)}`, (body, close) => {
    const counted = h('input', { type: 'checkbox', checked: p.counted });
    const amount = moneyInput({ value: formatInput(p.amountCents) });
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const money = readMoney(amount);
        if (!money.ok) return;
        const usual = payEntryAt(p.date, app.snap.settings.paySchedule)?.amountCents;
        app.store.setPayday(p.date, { counted: counted.checked, amountCents: money.cents === usual ? null : money.cents });
        close();
        toast(counted.checked ? `Pay on ${dayLabel(p.date)} counted` : `Pay on ${dayLabel(p.date)} not counted`);
      },
    },
    h('p', { class: 'section-note' }, 'Untick if this pay is late or not coming. "Left to spend" drops until you tick it again.'),
    h('label', { class: 'check' }, counted, 'Count this pay'),
    field('Amount', amount),
    primary('Save'));
    body.append(form);
  });
}
