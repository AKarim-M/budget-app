// Settings: this device, pay and card dates, installments, categories, bank balance, backup.
import { h, fill } from './dom.js';
import { openSheet, toast } from './overlay.js';
import { field, textInput, dateInput, moneyInput, select, segmented, readMoney, showError, clearErrors } from './forms.js';
import { peso, dayLabel, longDate, WEEKDAYS, ordinal, monthLabel } from './format.js';
import { openBankCheck } from './actions.js';
import { formatInput } from '../money.js';
import { isYMD, maxYMD } from '../dates.js';
import { payEntryAt } from '../cycles.js';
import { uuid } from '../records.js';
import { installApp } from '../pwa.js';

const PALETTE = ['#7c4d3a', '#2b5b84', '#6d4c7d', '#b45309', '#2d6a4f', '#c2593f', '#52606d'];
const THEMES = { light: 'Warm paper', dim: 'Soft matte (dim)', auto: 'Same as this phone' };
const MONTH_RE = /^\d{4}-\d{2}$/;
const days = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function setting(name, value, button) {
  return h('div', { class: 'setting' },
    h('div', { class: 'setting-text' }, h('div', { class: 'setting-name' }, name), h('div', { class: 'setting-value' }, value)),
    button ?? null);
}

const smallBtn = (label, onclick, extra = '') => h('button', { type: 'button', class: `btn btn-small ${extra}`, onclick }, label);
const submitBtn = (label) => h('button', { type: 'submit', class: 'btn btn-primary' }, label);

// ---------- sheets ----------

function editName(app) {
  openSheet('Your name on this device', (body, close) => {
    const name = textInput({ value: app.store.device.get().userName ?? '', maxlength: 40 });
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        if (!name.value.trim()) return showError(name, 'Enter a name.');
        app.store.device.set({ userName: name.value.trim() });
        close();
        toast('Name saved');
        return undefined;
      },
    }, field('Name', name, { hint: 'Shown next to the items logged from this device.' }), submitBtn('Save'));
    body.append(form);
  });
}

function editTheme(app) {
  openSheet('Theme', (body, close) => {
    const seg = segmented('theme', Object.entries(THEMES), app.store.device.get().theme ?? 'auto');
    seg.el.style.gridTemplateColumns = '1fr';
    body.append(h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        app.store.device.set({ theme: seg.value() });
        close();
      },
    }, seg.el, h('div', { style: { height: '12px' } }), submitBtn('Apply')));
  });
}

function editPay(app) {
  const s = app.snap.settings;
  const today = app.today();
  const cur = payEntryAt(today, s.paySchedule) ?? s.paySchedule[s.paySchedule.length - 1];
  openSheet('Pay', (body, close) => {
    const amount = moneyInput({ value: formatInput(cur.amountCents) });
    const weekday = select(WEEKDAYS.map((d, i) => [i, d]), cur.weekday);
    const from = dateInput({ value: maxYMD(today, s.startDate), min: s.startDate });
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        clearErrors(form);
        const money = readMoney(amount);
        if (!money.ok) return;
        if (!isYMD(from.value) || from.value < s.startDate) {
          showError(from, 'Choose a date on or after the day you started.');
          return;
        }
        const schedule = s.paySchedule
          .filter((p) => p.from < from.value)
          .concat([{ from: from.value, amountCents: money.cents, weekday: Number(weekday.value) }]);
        app.store.updateSettings({ paySchedule: schedule });
        close();
        toast('Pay updated');
      },
    },
    h('p', { class: 'section-note' }, 'Paid every week on the chosen day. Earlier paydays keep their old amount.'),
    h('div', { class: 'row2' }, field('Amount', amount), field('Payday', weekday)),
    field('Starting from', from),
    submitBtn('Save pay'));
    body.append(form);
  });
}

function editCard(app) {
  const s = app.snap.settings;
  openSheet('Card statement dates', (body, close) => {
    const cutoff = select(days(2, 28).map((d) => [d, ordinal(d)]), s.cutoffDay);
    const due = select(days(1, 27).map((d) => [d, ordinal(d)]), s.dueDay);
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        clearErrors(form);
        const c = Number(cutoff.value);
        const d = Number(due.value);
        if (d >= c) {
          showError(due, 'The due day must come before the cut-off day.');
          return;
        }
        app.store.updateSettings({ cutoffDay: c, dueDay: d });
        close();
        toast('Card dates updated');
      },
    },
    h('p', { class: 'section-note' }, 'Purchases on or after the cut-off day go on the next statement. Each bill is due on the due day of the following month. Changing these re-sorts past purchases.'),
    h('div', { class: 'row2' }, field('Cut-off day', cutoff), field('Due day', due)),
    submitBtn('Save'));
    body.append(form);
  });
}

function editInstallment(app, inst) {
  openSheet(inst ? 'Edit installment' : 'Add installment', (body, close) => {
    const label = textInput({ value: inst?.label ?? 'Installment', maxlength: 60 });
    const amount = moneyInput({ value: inst ? formatInput(inst.amountCents) : '' });
    const first = h('input', { type: 'month', value: inst?.firstDueMonth ?? '' });
    const last = h('input', { type: 'month', value: inst?.lastDueMonth ?? '' });
    const others = () => app.snap.settings.installments.filter((i) => i.id !== inst?.id);
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        clearErrors(form);
        if (!label.value.trim()) return showError(label, 'Enter a name.');
        const money = readMoney(amount);
        if (!money.ok) return undefined;
        for (const m of [first, last]) {
          if (m.value && !MONTH_RE.test(m.value)) return showError(m, 'Choose a month.');
        }
        if (first.value && last.value && first.value > last.value) return showError(last, 'The last month must be after the first.');
        const next = {
          id: inst?.id ?? uuid(),
          label: label.value.trim(),
          amountCents: money.cents,
          ...(first.value ? { firstDueMonth: first.value } : {}),
          ...(last.value ? { lastDueMonth: last.value } : {}),
        };
        app.store.updateSettings({ installments: [...others(), next] });
        close();
        toast('Installment saved');
        return undefined;
      },
    },
    h('p', { class: 'section-note' }, 'Added to every card bill whose due date falls in these months. Leave the months empty if it is ongoing.'),
    field('Name', label),
    field('Monthly amount', amount),
    h('div', { class: 'row2' }, field('First bill month', first), field('Last bill month', last)),
    submitBtn('Save'),
    inst ? h('div', { class: 'btn-row', style: { marginTop: '12px' } }, smallBtn('Remove installment', () => {
      app.store.updateSettings({ installments: others() });
      close();
      toast('Installment removed');
    }, 'btn-danger')) : null);
    body.append(form);
  });
}

function editCategory(app, c) {
  openSheet(c ? `Edit ${c.name}` : 'Add category', (body, close) => {
    const name = textInput({ value: c?.name ?? '', maxlength: 40 });
    const icon = textInput({ value: c?.icon ?? '🏷️', maxlength: 8 });
    const places = h('textarea', { rows: 6, placeholder: 'One place per line' }, (c?.places ?? []).join('\n'));
    const form = h('form', {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        clearErrors(form);
        if (!name.value.trim()) return showError(name, 'Enter a name.');
        const list = [...new Set(places.value.split('\n').map((p) => p.trim().slice(0, 60)).filter(Boolean))].slice(0, 40);
        const id = c?.id ?? `cat:${uuid()}`;
        const order = c?.order ?? Math.max(0, ...app.snap.categories.map((x) => x.order)) + 1;
        app.store.upsert('category', id, {
          name: name.value.trim(),
          icon: icon.value.trim() || '🏷️',
          places: list,
          order,
          archived: false,
          color: c?.color ?? PALETTE[order % PALETTE.length],
        });
        close();
        toast('Category saved');
        return undefined;
      },
    },
    h('div', { class: 'row2' }, field('Name', name), field('Icon', icon, { hint: 'An emoji' })),
    field('Usual places', places, { hint: 'They appear as quick picks when logging.' }),
    submitBtn('Save'),
    c ? h('div', { class: 'btn-row', style: { marginTop: '12px' } }, smallBtn('Hide this category', () => {
      app.store.upsert('category', c.id, { archived: true });
      close();
      toast(`${c.name} hidden`, { action: 'Undo', onAction: () => app.store.upsert('category', c.id, { archived: false }) });
    }, 'btn-danger')) : null);
    body.append(form);
  });
}

function exportData(app) {
  const blob = new Blob([app.store.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `budget-export-${app.today()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Backup file saved');
}

function importData(app) {
  const input = h('input', {
    type: 'file',
    accept: '.json,application/json',
    onchange: async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const r = app.store.importJSON(await file.text());
        toast(`Imported ${r.imported} item${r.imported === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} already up to date)` : ''}`);
      } catch (err) {
        toast(err.message);
      }
    },
  });
  input.click();
}

function confirmReset(app) {
  openSheet('Remove data from this device', (body) => {
    body.append(
      h('p', {}, 'This deletes the budget stored on this device. Entries already synced to your Google Sheet stay there. If you are not syncing yet, export a backup first.'),
      h('button', {
        type: 'button',
        class: 'btn btn-primary',
        style: { background: 'var(--danger)', borderColor: 'var(--danger)' },
        onclick: () => app.resetDevice(),
      }, 'Remove data from this device'));
  });
}

// ---------- the tab ----------

export function mountSettings(el, app) {
  const device = h('div', { class: 'list' });
  const money = h('div', { class: 'list' });
  const installments = h('div', { class: 'list' });
  const categories = h('div', { class: 'list' });
  const bank = h('div', { class: 'list' });
  const data = h('div', { class: 'list' });
  const card = (title, body, action) => h('div', { class: 'card' },
    h('h2', { class: 'card-title' }, h('span', {}, title), action ?? null), body);

  el.append(h('div', { class: 'cols' },
    h('div', { class: 'stack' },
      card('This device', device),
      card('Pay and card', money),
      card('Installments', installments, smallBtn('+ Add', () => editInstallment(app, null))),
      card('Bank balance', bank)),
    h('div', { class: 'stack' },
      card('Categories and usual places', categories, smallBtn('+ Add', () => editCategory(app, null))),
      card('Sync and backup', data))));

  return {
    update(snap) {
      const dev = app.store.device.get();
      const s = snap.settings;
      const pwa = app.pwa ?? {};
      fill(device,
        setting('Your name', dev.userName || 'Not set', smallBtn('Edit', () => editName(app))),
        setting('Theme', THEMES[dev.theme ?? 'auto'], smallBtn('Change', () => editTheme(app))),
        pwa.installPrompt
          ? setting('Install on this device', 'Adds the app to your home screen. It also works offline.', smallBtn('Install', () => installApp(app)))
          : null,
        setting('App version', pwa.version
          ? `${pwa.version} · works offline${pwa.persisted ? ' · data kept by the browser' : ''}`
          : pwa.active ? 'Getting ready for offline use…' : 'Offline mode starts once the app is published'));

      const pay = payEntryAt(snap.today, s.paySchedule) ?? s.paySchedule[s.paySchedule.length - 1];
      fill(money,
        setting('Pay', `${peso(pay.amountCents)} every ${WEEKDAYS[pay.weekday]}`, smallBtn('Edit', () => editPay(app))),
        setting('Card statement', `Cut-off on the ${ordinal(s.cutoffDay)} · bill due on the ${ordinal(s.dueDay)}`, smallBtn('Edit', () => editCard(app))),
        setting('Using the app since', longDate(s.startDate)));

      fill(installments, s.installments.length
        ? s.installments.map((i) => setting(i.label,
          `${peso(i.amountCents)} on each bill${i.firstDueMonth ? ` from ${monthLabel(i.firstDueMonth)}` : ''}${i.lastDueMonth ? ` until ${monthLabel(i.lastDueMonth)}` : ''}`,
          smallBtn('Edit', () => editInstallment(app, i))))
        : h('p', { class: 'empty' }, 'No installments.'));

      fill(categories, snap.categories.map((c) => setting(`${c.icon} ${c.name}`,
        c.places.length ? c.places.join(', ') : 'No usual places yet',
        smallBtn('Edit', () => editCategory(app, c)))));

      const history = [...snap.reconciliations].reverse().slice(0, 6);
      fill(bank,
        setting('Money on hand now', `${peso(snap.bank.nowCents)} (bank + wallet)`, smallBtn('Update', () => openBankCheck(app))),
        history.map((r) => setting(
          `${dayLabel(r.date)} · ${peso(r.enteredCents)}`,
          r.kind === 'opening' || !r.comparable
            ? 'Starting balance'
            : r.diffCents === 0
              ? 'Matched what the app expected'
              : `The app expected ${peso(r.expectedCents)} (${peso(r.diffCents, { signed: true })} difference)`)));

      fill(data,
        setting('Sync with Google Sheet', 'Coming in the next update. Until then, this device keeps its own copy.'),
        setting('Back up', 'Save a file with all entries', smallBtn('Export', () => exportData(app))),
        setting('Restore or add places', 'Load a backup or a places file', smallBtn('Import', () => importData(app))),
        setting('Reset this device', 'Remove the budget stored on this device', smallBtn('Reset', () => confirmReset(app), 'btn-danger')));
    },
  };
}
