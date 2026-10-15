// Plan: warnings, the bank balance ahead, card bills, planned payments and paydays.
import { h, fill, cmp } from './dom.js';
import { peso, dayLabel, shortDate, billLabel, range, warningText, ordinal, monthLabel } from './format.js';
import { toast } from './overlay.js';
import {
  openPlannedEditor, openPaymentEditor, openStatementEditor, openPaydayEditor, openRecurringEditor, tickPlanned,
} from './actions.js';

const STATUS = {
  open: ['Open', 'tag-muted'],
  closed: ['To pay', 'tag-warn'],
  paid: ['Paid', 'tag-done'],
  overdue: ['Overdue', 'tag-danger'],
  folded: ['In a later bill', 'tag-muted'],
};

export function mountPlan(el, app) {
  const alerts = h('div', { class: 'alerts' });
  const tlNote = h('p', { class: 'section-note' });
  const timeline = h('div', {});
  const bills = h('div', {});
  const scheduled = h('div', { class: 'list' });
  const planned = h('div', { class: 'list' });
  const monthly = h('div', { class: 'list' });
  const paysTitle = h('span', {});
  const pays = h('div', { class: 'pay-grid' });

  el.append(h('div', { class: 'cols' },
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h2', { class: 'card-title' }, 'Heads-up'), alerts),
      h('div', { class: 'card' }, h('h2', { class: 'card-title' }, 'Bank balance ahead'), tlNote, timeline)),
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h2', { class: 'card-title' }, 'Card bills'), bills, scheduled),
      h('div', { class: 'card' },
        h('h2', { class: 'card-title' },
          h('span', {}, 'Planned payments'),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => openPlannedEditor(app) }, '+ Add')),
        planned),
      h('div', { class: 'card' },
        h('h2', { class: 'card-title' },
          h('span', {}, 'Monthly bills'),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => openRecurringEditor(app) }, '+ Add')),
        h('p', { class: 'section-note' }, 'Bills you pay every month from the bank or in cash. Each month shows up in Planned payments by itself.'),
        monthly),
      h('div', { class: 'card' },
        h('h2', { class: 'card-title' }, paysTitle),
        h('p', { class: 'section-note' }, 'Tap a payday to mark it late or change the amount.'),
        pays))));

  function renderAlerts(snap) {
    fill(alerts, snap.warnings.length
      ? snap.warnings.map((w) => h('div', { class: `alert ${w.severity}` }, warningText(w)))
      : h('p', { class: 'empty' }, 'All clear. Everything planned is covered.'));
  }

  function rowLabel(r, snap) {
    switch (r.kind) {
      case 'payday': return 'Payday';
      case 'payday-off': return 'Payday (not counted)';
      case 'card-payment': return 'Card payment';
      case 'bill-due': return `${billLabel(r.date)} due`;
      case 'bill-rest': {
        const b = snap.bills.find((x) => x.stmt === r.stmt);
        return `Pay the rest of the ${b ? billLabel(b.due) : 'card bill'}`;
      }
      default: return r.label;
    }
  }

  function renderTimeline(snap) {
    const { days, lowest } = snap.timeline;
    tlNote.textContent = days.length
      ? `If everything goes as planned until ${shortDate(snap.cycle.due)}. Lowest point: ${peso(lowest.cents)} on ${dayLabel(lowest.date)}.`
      : 'Nothing coming up.';
    fill(timeline,
      h('div', { class: 'tl-day' },
        h('div', { class: 'tl-head' }, h('span', {}, `Now (${dayLabel(snap.today)})`), h('span', { class: 'tl-bal' }, peso(snap.bank.nowCents)))),
      days.map((d) => h('div', { class: `tl-day${d.endCents < 0 ? ' below' : d.date === lowest.date ? ' low' : ''}` },
        h('div', { class: 'tl-head' }, h('span', {}, dayLabel(d.date)), h('span', { class: 'tl-bal' }, peso(d.endCents))),
        d.rows.map((r) => h('div', { class: `tl-row${r.cents === 0 ? ' info' : ''}` },
          h('span', {}, rowLabel(r, snap), r.overdue ? h('span', { class: 'tag tag-warn', style: { marginLeft: '6px' } }, 'overdue') : null),
          h('span', { class: `num ${r.cents > 0 ? 'pos' : ''}` }, r.cents ? peso(r.cents, { signed: true }) : ''))))));
  }

  function billCard(b) {
    const [statusText, statusClass] = STATUS[b.status] ?? ['', 'tag-muted'];
    const totalLabel = b.opening ? 'Unpaid at start' : b.statementCents != null ? 'Statement' : b.status === 'open' ? 'So far' : 'Total';
    return h('div', { class: 'bill' },
      h('div', { class: 'bill-head' },
        h('span', { class: 'bill-name' }, billLabel(b.due)),
        h('span', { class: `tag ${statusClass}` }, statusText)),
      h('div', { class: 'row-meta', style: { marginBottom: '8px' } },
        `Purchases ${range(b.start, b.end)}${b.installmentCents ? ` · incl. ${peso(b.installmentCents)} installment` : ''}`),
      h('div', { class: 'bill-grid' },
        h('div', {}, h('span', { class: 'muted' }, totalLabel), h('strong', {}, peso(b.totalCents))),
        h('div', {}, h('span', { class: 'muted' }, 'Paid'), h('strong', {}, peso(b.paidCents))),
        h('div', {}, h('span', { class: 'muted' }, 'To pay'), h('strong', {}, peso(b.remCents)))),
      b.minimumDueCents != null ? h('div', { class: 'row-meta', style: { marginBottom: '8px' } }, `Minimum due: ${peso(b.minimumDueCents)}`) : null,
      h('div', { class: 'btn-row' },
        b.remCents > 0 ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => openPaymentEditor(app, { bill: b }) }, 'Add payment') : null,
        b.opening || b.status !== 'open'
          ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => openStatementEditor(app, b) }, b.opening ? 'Edit amount' : 'Statement amounts')
          : null));
  }

  function renderBills(snap) {
    const shown = snap.bills.filter((b) => !b.foldedInto && (b.remCents > 0 || b.status === 'open' || b.due >= snap.today));
    fill(bills, shown.length ? shown.map(billCard) : h('p', { class: 'empty' }, 'No card bills to show.'));

    const sched = app.store.all()
      .filter((r) => r.type === 'cardPayment' && !r.deleted && !r.done)
      .sort((a, b) => cmp(a.date, b.date) || cmp(a.createdAt, b.createdAt));
    fill(scheduled, sched.length
      ? [h('h3', { class: 'field-label', style: { margin: '14px 0 2px' } }, 'Scheduled card payments'),
        ...sched.map((r) => h('div', { class: 'row' },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title' }, 'Card payment'),
            h('div', { class: 'row-meta' },
              dayLabel(r.date),
              r.billStmt && snap.bills.some((b) => b.stmt === r.billStmt)
                ? ` · for the ${billLabel(snap.bills.find((b) => b.stmt === r.billStmt).due)}`
                : '',
              r.date < snap.today ? h('span', { class: 'tag tag-warn', style: { marginLeft: '6px' } }, 'overdue') : null)),
          h('div', { class: 'row-end' },
            h('strong', { class: 'num' }, peso(r.amountCents)),
            h('button', {
              type: 'button', class: 'icon-btn', 'aria-label': 'Mark as paid',
              onclick: () => {
                app.store.setDone(r.id, true, app.today());
                toast(`Card payment of ${peso(r.amountCents)} marked paid`, { action: 'Undo', onAction: () => app.store.setDone(r.id, false, app.today()) });
              },
            }, '✓'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Edit payment', onclick: () => openPaymentEditor(app, { rec: r }) }, '✎'))))]
      : null);
  }

  function plannedRow(r, snap) {
    const overdue = !r.done && r.date < snap.today;
    const out = r.direction === 'out';
    return h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' },
          r.recurringId ? h('span', { class: 'tag tag-muted' }, '🔁 monthly') : null,
          r.label),
        h('div', { class: 'row-meta' },
          `${dayLabel(r.date)} · ${out ? 'Money out' : 'Money in'}`,
          r.done ? h('span', { class: 'tag tag-done', style: { marginLeft: '6px' } }, out ? 'paid' : 'received') : null,
          overdue ? h('span', { class: 'tag tag-warn', style: { marginLeft: '6px' } }, 'overdue') : null)),
      h('div', { class: 'row-end' },
        h('strong', { class: `num ${out ? '' : 'pos'}` }, peso(out ? -r.amountCents : r.amountCents, { signed: true })),
        r.done
          ? h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': 'Mark as not done',
            onclick: () => tickPlanned(app, r, false),
          }, '↺')
          : h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': out ? 'Mark as paid' : 'Mark as received',
            onclick: () => {
              tickPlanned(app, r, true);
              toast(`${r.label} marked ${out ? 'paid' : 'received'}`, { action: 'Undo', onAction: () => tickPlanned(app, r, false) });
            },
          }, '✓'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${r.label}`, onclick: () => openPlannedEditor(app, r) }, '✎')));
  }

  function renderMonthly(snap) {
    const rules = snap.settings.recurring ?? [];
    fill(monthly, rules.length
      ? rules.map((rule) => {
        const next = snap.planned.find((p) => p.recurringId === rule.id && !p.done);
        return h('div', { class: 'row' },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title' }, rule.label),
            h('div', { class: 'row-meta' },
              `${peso(rule.amountCents)} on the ${ordinal(rule.day)} of each month`
              + `${rule.lastMonth ? ` until ${monthLabel(rule.lastMonth)}` : ''}`
              + `${next ? ` · next ${dayLabel(next.date)}` : ''}`)),
          h('div', { class: 'row-end' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${rule.label}`, onclick: () => openRecurringEditor(app, rule) }, '✎')));
      })
      : h('p', { class: 'empty' }, 'No monthly bills yet. Add electricity, water, internet, rent…'));
  }

  function renderPlanned(snap) {
    const open = snap.planned.filter((p) => !p.done);
    const done = snap.planned.filter((p) => p.done).sort((a, b) => cmp(b.doneAt ?? '', a.doneAt ?? '')).slice(0, 5);
    fill(planned,
      open.length
        ? open.map((r) => plannedRow(r, snap))
        : h('p', { class: 'empty' }, 'Nothing planned. Add school fees, rent, bills: anything with a date.'),
      done.length ? h('h3', { class: 'field-label', style: { margin: '14px 0 2px' } }, 'Done recently') : null,
      done.map((r) => plannedRow(r, snap)));
  }

  function renderPaydays(snap) {
    paysTitle.textContent = `Paydays ${range(snap.cycle.start, snap.cycle.end)}`;
    fill(pays, snap.paydays.length
      ? snap.paydays.map((p) => h('button', {
        type: 'button',
        class: `pay-pill${p.received ? ' received' : ''}${p.counted ? '' : ' off'}`,
        onclick: () => openPaydayEditor(app, p),
      },
      h('div', {}, shortDate(p.date)),
      h('div', { class: 'small' }, !p.counted ? 'Not counted' : `${p.received ? '✓ ' : ''}+${peso(p.amountCents)}`)))
      : h('p', { class: 'empty' }, 'No paydays in this cycle.'));
  }

  return {
    update(snap) {
      renderAlerts(snap);
      renderTimeline(snap);
      renderBills(snap);
      renderPlanned(snap);
      renderMonthly(snap);
      renderPaydays(snap);
    },
  };
}
