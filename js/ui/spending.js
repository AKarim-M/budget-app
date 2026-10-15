// Spending: one card cycle at a time, by item, by category, and by person.
import { h, fill } from './dom.js';
import { peso, range, personColor } from './format.js';
import { spendRow } from './actions.js';
import { spendingForCycle } from '../engine.js';
import { shiftStmt } from '../cycles.js';

export function mountSpending(el, app) {
  let snap = null;
  let stmt = null;
  let current = null;
  let person = 'all';

  const title = h('strong', {});
  const prev = h('button', { type: 'button', class: 'btn btn-small', 'aria-label': 'Previous cycle', onclick: () => { stmt = shiftStmt(stmt, -1); render(); } }, '◀');
  const next = h('button', { type: 'button', class: 'btn btn-small', 'aria-label': 'Next cycle', onclick: () => { stmt = shiftStmt(stmt, 1); render(); } }, '▶');
  const totals = h('div', { class: 'totals' });
  const people = h('div', { class: 'chip-row' });
  const items = h('div', { class: 'list' });
  const cats = h('div', {});

  el.append(h('div', { class: 'cols' },
    h('div', { class: 'card' },
      h('div', { class: 'cycle-nav' }, prev, title, next),
      totals,
      people,
      items),
    h('div', { class: 'card' },
      h('h2', { class: 'card-title' }, h('span', {}, 'By category'), h('span', { class: 'aside' }, 'No limits, just where it went')),
      cats)));

  function categoryBox(c) {
    return h('div', { class: 'cat-box' },
      h('div', { class: 'cat-line' },
        h('span', {}, h('strong', {}, `${c.category.icon} ${c.category.name}`), h('span', { class: 'muted small' }, ` (${c.items.length})`)),
        h('span', {}, h('strong', { class: 'num' }, peso(c.cents)), h('span', { class: 'muted small' }, ` ${c.pct}%`))),
      h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${c.pct}%`, background: c.category.color } })),
      c.items.length
        ? h('div', { class: 'sub-list' }, c.items.map((i) => h('div', { class: 'sub-item' },
          h('span', {}, `• ${i.item} (${i.method === 'card' ? 'Card' : 'Cash'})`),
          h('span', { class: 'num' }, peso(i.amountCents)))))
        : null);
  }

  function render() {
    const v = spendingForCycle(app.store.all(), stmt, { today: snap.today });
    title.textContent = range(v.cycle.start, v.cycle.end);
    next.disabled = stmt >= current;

    if (person !== 'all' && !v.byPerson.some((p) => p.by === person)) person = 'all';
    const list = person === 'all' ? v.items : v.items.filter((i) => i.by === person);
    const sum = (arr) => arr.reduce((t, i) => t + i.amountCents, 0);
    const card = sum(list.filter((i) => i.method === 'card'));
    const cash = sum(list.filter((i) => i.method === 'cash'));

    fill(totals,
      h('span', {}, '💳 Card ', h('strong', { class: 'num' }, peso(card))),
      h('span', {}, '💵 Cash ', h('strong', { class: 'num' }, peso(cash))),
      h('span', {}, 'Total ', h('strong', { class: 'num' }, peso(card + cash))),
      h('span', { class: 'muted' }, `${list.length} item${list.length === 1 ? '' : 's'}`));

    fill(people, v.byPerson.length > 1
      ? [['all', 'Everyone'], ...v.byPerson.map((p) => [p.by, `${p.by} ${peso(p.cents)}`])].map(([key, label]) => h('button', {
        type: 'button',
        class: `chip${person === key ? ' active' : ''}`,
        'aria-pressed': person === key ? 'true' : 'false',
        onclick: () => { person = key; render(); },
      },
      key === 'all' ? null : h('span', { class: 'who-dot', style: { background: personColor(key) }, 'aria-hidden': 'true' }),
      label))
      : null);
    people.hidden = v.byPerson.length <= 1;

    fill(items, list.length ? list.map((r) => spendRow(r, app)) : h('p', { class: 'empty' }, 'Nothing logged in this cycle.'));

    const total = card + cash;
    const byCategory = v.byCategory.map((c) => {
      const mine = person === 'all' ? c.items : c.items.filter((i) => i.by === person);
      const cents = sum(mine);
      return { ...c, items: mine, cents, pct: total ? Math.round((cents * 100) / total) : 0 };
    });
    fill(cats, byCategory.map(categoryBox));
  }

  return {
    update(s) {
      snap = s;
      if (current !== s.cycle.stmt) {
        if (!stmt || stmt === current) stmt = s.cycle.stmt;
        current = s.cycle.stmt;
      }
      render();
    },
  };
}
