// The sticky top bar: what is left until the next card bill (with a weekly pace and the cash
// you can spend now), Bank, Card owed, and a warning strip.
import { h, fill } from './dom.js';
import { peso, pesoRounded, longDate, dayLabel, shortDate, warningText, billLabel, paymentName } from './format.js';

function billsLine(snap) {
  const owing = snap.bills.filter((b) => !b.foldedInto && b.remCents > 0);
  if (!owing.length) return snap.owed.creditCents > 0 ? 'All paid, with credit' : 'All paid';
  return owing.map((b) => `${shortDate(b.due)}${b.status === 'open' ? ' so far' : ''} ${peso(b.remCents)}`).join(' · ');
}

/** The cash you can spend now: the bank's lowest point before the bill. Red if the bank would run short. */
function cashLine(snap) {
  const c = snap.cash;
  const when = c.date === snap.today ? 'today' : `on ${dayLabel(c.date)}`;
  const after = c.cause ? `after ${paymentName(c.cause, snap.bills)}` : null;
  const amount = h('strong', { class: 'num', id: 'cash-value', dataset: { cents: String(c.cents) } }, peso(Math.abs(c.cents)));
  if (c.cents < 0) {
    return h('span', { class: 'glance-next cash-short' },
      h('span', {}, 'Bank short ', amount, ` ${when}`),
      after ? h('span', { class: 'glance-sub' }, after) : null);
  }
  return h('span', { class: 'glance-next' },
    h('span', {}, 'Cash you can spend now: ', amount),
    h('span', { class: 'glance-sub' }, after ? `lowest ${when}, ${after}` : 'everything planned ahead is covered'));
}

export function renderGlance(el, snap, app) {
  const next = snap.bank.nextPayday;
  const serious = snap.warnings.filter((w) => w.severity !== 'info');
  const danger = serious.some((w) => w.severity === 'danger');
  const u = snap.untilDue;
  const short = u.cents < 0; // the next bill would not be covered: the only red state
  const bill = billLabel(u.due);
  const leftText = peso(Math.abs(u.cents));

  fill(el,
    h('div', { class: 'glance-top' },
      h('span', { class: 'date-pill' }, `Today: ${longDate(snap.today)}`),
      app.statusPill ? app.statusPill() : null),
    h('div', { class: 'glance-grid' },
      h('button', {
        type: 'button',
        class: `glance-tile glance-main${short ? ' over' : ''}`,
        dataset: { action: 'breakdown' },
        'aria-label': `${short ? 'Short for' : 'Left until'} the ${bill}: ${leftText}. `
          + `${snap.cash.cents < 0 ? 'Bank short' : 'Cash you can spend now'}: ${peso(Math.abs(snap.cash.cents))}. Show how it adds up.`,
      },
      h('span', { class: 'glance-lbl' }, short ? `Short for the ${bill}` : `Left until the ${bill}`),
      h('span', { class: 'glance-big', id: 'until-due-value', dataset: { cents: String(u.cents) } }, leftText),
      h('span', { class: 'glance-sub' }, short
        ? 'more is going out than comes in before this bill'
        : `about ${pesoRounded(u.weeklyCents)} a week · card or cash`),
      cashLine(snap)),
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
