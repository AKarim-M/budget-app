// The sticky top bar: what is left until the next card bill (with a weekly pace and this
// cycle's figure), Bank, Card owed, and a warning strip.
import { h, fill } from './dom.js';
import { peso, pesoRounded, longDate, dayLabel, shortDate, warningText, billLabel, dateList } from './format.js';

function billsLine(snap) {
  const owing = snap.bills.filter((b) => !b.foldedInto && b.remCents > 0);
  if (!owing.length) return snap.owed.creditCents > 0 ? 'All paid, with credit' : 'All paid';
  return owing.map((b) => `${shortDate(b.due)}${b.status === 'open' ? ' so far' : ''} ${peso(b.remCents)}`).join(' · ');
}

/** This cycle's figure: plain when covered by this cycle's pay, amber when it uses later pay. */
function cycleLine(snap) {
  const u = snap.untilDue;
  const cut = shortDate(snap.cycle.end);
  const amount = (cents) => h('strong', { class: 'num', id: 'lts-value', dataset: { cents: String(snap.lts.cents) } }, peso(cents));
  if (snap.lts.cents >= 0) {
    return h('span', { class: 'glance-next' }, h('span', {}, `This cycle (to ${cut}): `, amount(snap.lts.cents)));
  }
  return h('span', { class: 'glance-next into-next' },
    h('span', {}, amount(-snap.lts.cents), u.paydays.length ? ` from ${dateList(u.paydays)} pay` : ' over this cycle'),
    h('span', { class: 'glance-sub' }, `this cycle ends ${cut}`));
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
        'aria-label': `${short ? 'Short for' : 'Left until'} the ${bill}: ${leftText}. Show how it adds up.`,
      },
      h('span', { class: 'glance-lbl' }, short ? `Short for the ${bill}` : `Left until the ${bill}`),
      h('span', { class: 'glance-big', id: 'until-due-value', dataset: { cents: String(u.cents) } }, leftText),
      h('span', { class: 'glance-sub' }, short
        ? 'more is going out than comes in before this bill'
        : `about ${pesoRounded(u.weeklyCents)} a week · card or cash`),
      cycleLine(snap)),
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
