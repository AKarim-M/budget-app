// The sticky top bar: Left to spend, Bank, Card owed, and a warning strip.
import { h, fill } from './dom.js';
import { peso, longDate, dayLabel, shortDate, warningText } from './format.js';

function billsLine(snap) {
  const owing = snap.bills.filter((b) => !b.foldedInto && b.remCents > 0);
  if (!owing.length) return snap.owed.creditCents > 0 ? 'All paid, with credit' : 'All paid';
  return owing.map((b) => `${shortDate(b.due)}${b.status === 'open' ? ' so far' : ''} ${peso(b.remCents)}`).join(' · ');
}

export function renderGlance(el, snap, app) {
  const over = snap.lts.over;
  const next = snap.bank.nextPayday;
  const serious = snap.warnings.filter((w) => w.severity !== 'info');
  const danger = serious.some((w) => w.severity === 'danger');
  const ltsText = peso(Math.abs(snap.lts.cents));

  fill(el,
    h('div', { class: 'glance-top' },
      h('span', { class: 'date-pill' }, `Today: ${longDate(snap.today)}`),
      app.statusPill ? app.statusPill() : null),
    h('div', { class: 'glance-grid' },
      h('button', {
        type: 'button',
        class: `glance-tile glance-main${over ? ' over' : ''}`,
        dataset: { action: 'breakdown' },
        'aria-label': `${over ? 'Over by' : 'Left to spend'} ${ltsText}. Show how it adds up.`,
      },
      h('span', { class: 'glance-lbl' }, over ? 'Over by' : 'Left to spend'),
      h('span', { class: 'glance-big', id: 'lts-value' }, ltsText),
      h('span', { class: 'glance-sub' }, over ? "using next cycle's pay" : `until ${shortDate(snap.cycle.end)} cut-off`)),
      h('button', { type: 'button', class: 'glance-tile', dataset: { action: 'bank-check' }, 'aria-label': `Bank ${peso(snap.bank.nowCents)}. Update balance.` },
        h('span', { class: 'glance-lbl' }, 'Bank'),
        h('span', { class: 'glance-md', id: 'bank-value' }, peso(snap.bank.nowCents)),
        h('span', { class: 'glance-sub' }, next ? `${dayLabel(next.date)} +${peso(next.amountCents)}` : 'No payday ahead')),
      h('a', { class: 'glance-tile card-owed', href: '#plan' },
        h('span', { class: 'glance-lbl' }, snap.owed.cents < 0 ? 'Card credit' : 'Card owed'),
        h('span', { class: 'glance-md', id: 'owed-value' }, peso(Math.abs(snap.owed.cents))),
        h('span', { class: 'glance-sub' }, billsLine(snap)))),
    serious.length
      ? h('a', { class: `alert-strip${danger ? ' danger' : ''}`, href: '#plan' },
        `⚠ ${serious.length > 1 ? `${serious.length} things to check · ` : ''}${warningText(serious[0])}`)
      : null);
}
