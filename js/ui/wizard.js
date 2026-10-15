// First-run setup: name, pay and card dates, starting point, then a live preview.
import { h, fill } from './dom.js';
import { field, textInput, dateInput, moneyInput, select, readMoney, readOptionalMoney, showError, clearErrors } from './forms.js';
import { peso, pesoRounded, shortDate, range, ordinal, WEEKDAYS, billLabel, dayLabel } from './format.js';
import { toast } from './overlay.js';
import { compute } from '../engine.js';
import { newRecord, uuid } from '../records.js';
import { cycleOf, cycleByStmt, shiftStmt } from '../cycles.js';
import { formatInput } from '../money.js';
import { isYMD, weekdayOf } from '../dates.js';

const MONTH_RE = /^\d{4}-\d{2}$/;
const days = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const fmtOrEmpty = (cents) => (cents == null ? '' : formatInput(cents));

export function renderWizard(el, app) {
  const today = app.today();
  const d = {
    name: app.store.device.get().userName ?? '',
    pay: null,
    weekday: '',
    cutoff: '',
    due: '',
    inst: null,
    instLast: '',
    start: today,
    bank: null,
    wallet: null,
    payIncluded: true,
    lastUnpaid: null,
    lastMin: null,
    olderUnpaid: null,
    soFar: null,
  };
  let step = 1;

  const cfg = () => ({ cutoffDay: Number(d.cutoff), dueDay: Number(d.due) });
  const cycles = () => {
    const cur = cycleOf(d.start, cfg());
    return { cur, last: cycleByStmt(shiftStmt(cur.stmt, -1), cfg()), older: cycleByStmt(shiftStmt(cur.stmt, -2), cfg()) };
  };

  function show() {
    fill(el,
      h('div', { class: 'steps', role: 'img', 'aria-label': `Step ${step} of 4` }, [1, 2, 3, 4].map((i) => h('span', { class: i <= step ? 'on' : '' }))),
      [stepWelcome, stepPayCard, stepStart, stepReview][step - 1]());
    window.scrollTo(0, 0);
  }

  const nav = (backTo, nextLabel) => h('div', { class: 'btn-row', style: { marginTop: '6px' } },
    backTo ? h('button', { type: 'button', class: 'btn', onclick: () => { step = backTo; show(); } }, 'Back') : null,
    h('button', { type: 'submit', class: 'btn btn-primary', style: { flex: '1', width: 'auto' } }, nextLabel));

  // ---------- 1. welcome ----------
  function stepWelcome() {
    const name = textInput({ value: d.name, maxlength: 40, placeholder: 'e.g. Alex' });
    const file = h('input', {
      type: 'file',
      accept: '.json,application/json',
      hidden: true,
      onchange: async () => {
        const f = file.files?.[0];
        if (!f) return;
        try {
          const r = app.store.importJSON(await f.text());
          toast(`Restored ${r.imported} items`);
        } catch (err) {
          toast(err.message);
        }
      },
    });
    const form = h('form', {
      class: 'card',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        if (!name.value.trim()) return showError(name, 'Enter a name.');
        d.name = name.value.trim();
        app.store.device.set({ userName: d.name });
        step = 2;
        show();
        return undefined;
      },
    },
    h('h1', {}, 'Welcome 👋'),
    h('p', { class: 'lead' }, 'This app shows how much you can still spend while keeping your card bill and planned payments covered. Setup takes about two minutes.'),
    field('Your name on this device', name, { hint: 'Shown next to the items you log, so your household knows who added what.' }),
    nav(null, 'Start setup'),
    app.sync ? h('p', { class: 'small muted', style: { marginTop: '14px' } },
      'Setting up your Google Sheet for syncing? ',
      h('button', { type: 'button', class: 'link-btn', onclick: () => app.openConnect() }, 'Connect to it first'),
      '. Joining from another device? Scan the QR code it shows (Settings → Connect another device).') : null,
    h('p', { class: 'small muted', style: { marginTop: '10px' } },
      'Have a backup file? ',
      h('button', { type: 'button', class: 'link-btn', onclick: () => file.click() }, 'Restore it instead'),
      file));
    return form;
  }

  // ---------- 2. pay and card ----------
  function stepPayCard() {
    const pay = moneyInput({ value: fmtOrEmpty(d.pay) });
    const weekday = select([['', 'Choose a day'], ...WEEKDAYS.map((w, i) => [i, w])], d.weekday);
    const cutoff = select([['', 'Choose'], ...days(2, 28).map((n) => [n, ordinal(n)])], d.cutoff);
    const due = select([['', 'Choose'], ...days(1, 27).map((n) => [n, ordinal(n)])], d.due);
    const inst = moneyInput({ value: fmtOrEmpty(d.inst), placeholder: '₱ 0.00 (optional)' });
    const instLast = h('input', { type: 'month', value: d.instLast });
    const form = h('form', {
      class: 'card',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        clearErrors(form);
        const p = readMoney(pay);
        if (!p.ok) return undefined;
        if (weekday.value === '') return showError(weekday, 'Choose your payday.');
        if (cutoff.value === '') return showError(cutoff, 'Choose the cut-off day.');
        if (due.value === '') return showError(due, 'Choose the due day.');
        if (Number(due.value) >= Number(cutoff.value)) return showError(due, 'The due day must come before the cut-off day.');
        const i = readOptionalMoney(inst);
        if (!i.ok) return undefined;
        if (instLast.value && !MONTH_RE.test(instLast.value)) return showError(instLast, 'Choose a month.');
        Object.assign(d, {
          pay: p.cents, weekday: Number(weekday.value), cutoff: Number(cutoff.value), due: Number(due.value),
          inst: i.cents, instLast: instLast.value,
        });
        step = 3;
        show();
        return undefined;
      },
    },
    h('h1', {}, 'Pay and card'),
    h('p', { class: 'lead' }, 'You can change all of these later in Settings.'),
    h('div', { class: 'row2' },
      field('Pay each payday', pay),
      field('Payday', weekday, { hint: 'Every week' })),
    h('div', { class: 'row2' },
      field('Card cut-off day', cutoff, { hint: 'Purchases from this day go on the next bill' }),
      field('Bill due day', due, { hint: 'Of the month after the statement closes' })),
    h('div', { class: 'row2' },
      field('Monthly installment', inst, { hint: 'Added to every card bill (optional)' }),
      field('Last bill month', instLast, { hint: 'Optional, if it ends' })),
    nav(1, 'Next'));
    return form;
  }

  // ---------- 3. starting point ----------
  function stepStart() {
    const { cur, last, older } = cycles();
    const start = dateInput({ value: d.start, max: today });
    const bank = moneyInput({ value: fmtOrEmpty(d.bank), placeholder: '₱ as shown in your bank app' });
    const wallet = moneyInput({ value: fmtOrEmpty(d.wallet), placeholder: '₱ 0.00 (optional)' });
    const payIn = h('input', { type: 'checkbox', checked: d.payIncluded });
    const lastUnpaid = moneyInput({ value: fmtOrEmpty(d.lastUnpaid) });
    const lastMin = moneyInput({ value: fmtOrEmpty(d.lastMin), placeholder: '₱ 0.00 (optional)' });
    const olderUnpaid = moneyInput({ value: fmtOrEmpty(d.olderUnpaid), placeholder: '₱ 0.00 (if any)' });
    const soFar = moneyInput({ value: fmtOrEmpty(d.soFar), placeholder: '₱ 0.00 (optional)' });
    const showOlder = older.due >= d.start;
    const showSoFar = d.start > cur.start;
    const startIsPayday = isYMD(d.start) && weekdayOf(d.start) === d.weekday;

    const keepTyped = () => {
      // Remember what was typed (unvalidated) before re-drawing for a new start date.
      const loose = (input) => {
        const r = readOptionalMoney(input, { allowZero: true });
        return r.ok ? r.cents : null;
      };
      Object.assign(d, {
        bank: loose(bank), wallet: loose(wallet), lastUnpaid: loose(lastUnpaid), lastMin: loose(lastMin),
        olderUnpaid: loose(olderUnpaid), soFar: loose(soFar), payIncluded: payIn.checked,
      });
    };
    start.addEventListener('change', () => {
      if (!isYMD(start.value) || start.value > today) return;
      keepTyped();
      d.start = start.value;
      show();
    });

    const form = h('form', {
      class: 'card',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        clearErrors(form);
        const b = readMoney(bank, { allowZero: true, allowNegative: true });
        if (!b.ok) return;
        const w = readOptionalMoney(wallet, { allowZero: true });
        if (!w.ok) return;
        const lu = readMoney(lastUnpaid, { allowZero: true });
        if (!lu.ok) return;
        const lm = readOptionalMoney(lastMin, { allowZero: true });
        if (!lm.ok) return;
        const ou = showOlder ? readOptionalMoney(olderUnpaid, { allowZero: true }) : { ok: true, cents: null };
        if (!ou.ok) return;
        const sf = showSoFar ? readOptionalMoney(soFar, { allowZero: true }) : { ok: true, cents: null };
        if (!sf.ok) return;
        Object.assign(d, {
          bank: b.cents, wallet: w.cents, lastUnpaid: lu.cents, lastMin: lm.cents,
          olderUnpaid: ou.cents, soFar: sf.cents, payIncluded: startIsPayday ? payIn.checked : false,
        });
        step = 4;
        show();
      },
    },
    h('h1', {}, 'Where you are now'),
    h('p', { class: 'lead' }, 'The app counts from this day. Earlier spending is covered by the card amounts below.'),
    field('Start date', start, { hint: 'Usually today' }),
    h('div', { class: 'row2' }, field('Bank balance', bank), field('Cash in wallet', wallet)),
    startIsPayday ? h('label', { class: 'check' }, payIn, `The ${dayLabel(d.start)} pay is already in this balance`) : null,
    h('h3', { class: 'field-label', style: { margin: '6px 0 8px', fontSize: '0.9rem', color: 'var(--text)' } },
      `${billLabel(last.due)} · purchases ${range(last.start, last.end)}`),
    h('div', { class: 'row2' },
      field('Amount still unpaid', lastUnpaid, { hint: 'Enter 0 if it is fully paid' }),
      field('Minimum due', lastMin, { hint: 'From the statement (optional)' })),
    showOlder ? field(`${billLabel(older.due)} still unpaid (purchases ${range(older.start, older.end)})`, olderUnpaid) : null,
    showSoFar ? field(`Card spending since ${shortDate(cur.start)} that you won't log`, soFar, { hint: `Part of the ${billLabel(cur.due)}. Leave empty if you'll log those items.` }) : null,
    nav(2, 'Next'));
    return form;
  }

  // ---------- 4. review ----------
  function setupRecords(nowIso) {
    const { cur, last, older } = cycles();
    const by = d.name || 'Me';
    const rec = (type, fields) => newRecord(type, fields, { by, nowIso });
    const out = [rec('settings', {
      startDate: d.start,
      paySchedule: [{ from: d.start, amountCents: d.pay, weekday: d.weekday }],
      cutoffDay: d.cutoff,
      dueDay: d.due,
      installments: d.inst ? [{ id: uuid(), label: 'Installment', amountCents: d.inst, ...(d.instLast ? { lastDueMonth: d.instLast } : {}) }] : [],
    })];
    out.push(rec('bill', { stmt: last.stmt, statementCents: d.lastUnpaid, minimumDueCents: d.lastMin, adjustCents: 0 }));
    if (d.olderUnpaid) out.push(rec('bill', { stmt: older.stmt, statementCents: d.olderUnpaid, minimumDueCents: null, adjustCents: 0 }));
    if (d.soFar) out.push(rec('bill', { stmt: cur.stmt, adjustCents: d.soFar }));
    out.push(rec('bankCheck', {
      date: d.start, amountCents: d.bank + (d.wallet ?? 0), walletCents: d.wallet ?? 0, payIncluded: d.payIncluded, kind: 'opening',
    }));
    return out;
  }

  function stepReview() {
    const snap = compute(setupRecords('2000-01-01T00:00:00.000Z'), { today });
    const p = snap.lts.parts;
    const line = (label, cents, signed = true) => h('div', {}, h('span', {}, label), h('span', { class: 'num' }, peso(cents, { signed })));
    const form = h('form', {
      class: 'card',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        app.store.batch(() => {
          for (const r of setupRecords(null)) {
            if (r.type === 'settings') app.store.updateSettings(stripCommon(r));
            else if (r.type === 'bill') app.store.setBill(r.stmt, stripCommon(r));
            else app.store.add(r.type, stripCommon(r));
          }
        });
        location.hash = '#home';
        toast('All set. Add planned payments on the Plan tab.');
      },
    },
    h('h1', {}, 'Ready'),
    h('div', { class: `preview${snap.untilDue.cents < 0 ? ' over' : ''}` },
      h('div', { class: 'glance-lbl' }, `${snap.untilDue.cents < 0 ? 'Short for' : 'Left until'} the ${billLabel(snap.untilDue.due)}`),
      h('div', { class: 'glance-big' }, peso(Math.abs(snap.untilDue.cents))),
      h('div', { class: 'glance-sub' }, snap.untilDue.cents > 0 ? `about ${pesoRounded(snap.untilDue.weeklyCents)} a week` : ''),
      h('div', { class: 'preview-lines' },
        line('Bank + wallet now', p.bankCents, false),
        line(`Pay coming until the ${billLabel(snap.untilDue.due)}`, p.payCents + snap.untilDue.payCents),
        line('Owed to the card', -p.owedCents)),
      h('div', { class: 'glance-sub', style: { marginTop: '6px' } },
        `This cycle (to ${shortDate(snap.cycle.end)}): `,
        h('strong', { id: 'preview-lts', dataset: { cents: String(snap.lts.cents) } }, peso(snap.lts.cents)))),
    h('p', { class: 'small muted' }, 'Next, add payments you already know about (school fees, rent, bills) on the Plan tab. They are set aside straight away.'),
    nav(3, 'Start using the app'));
    return form;
  }

  show();
}

function stripCommon(r) {
  const { id, type, by, updatedBy, createdAt, updatedAt, deleted, ...fields } = r;
  return fields;
}
