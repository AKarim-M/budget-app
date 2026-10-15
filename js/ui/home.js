// Home: the quick logger and recent items.
import { h, fill, cmp } from './dom.js';
import { field, textInput, dateInput, moneyInput, segmented, readMoney, showError, clearErrors } from './forms.js';
import { toast } from './overlay.js';
import { peso } from './format.js';
import { spendRow, recentSpends } from './actions.js';
import { isYMD, minYMD } from '../dates.js';

export function mountHome(el, app) {
  const device = app.store.device.get();
  let categoryId = device.lastCategoryId ?? null;
  let method = device.lastMethod === 'cash' ? 'cash' : 'card';
  let shownToday = null;
  let snap = null;

  const catGrid = h('div', { class: 'cat-grid', role: 'radiogroup', 'aria-label': 'Category' });
  const chips = h('div', { class: 'chip-row', 'aria-label': 'Usual places' });
  const catTag = h('span', { class: 'aside' });
  const item = textInput({ id: 'log-item', placeholder: 'e.g. Lunch', maxlength: 120, enterkeyhint: 'next' });
  const amount = moneyInput({ id: 'log-amount', enterkeyhint: 'done' });
  const date = dateInput({ id: 'log-date' });
  const methodSeg = segmented('log-method', [['card', '💳 Card', 'card-opt'], ['cash', '💵 Cash', 'cash-opt']], method, (v) => {
    method = v;
    app.store.device.set({ lastMethod: v });
  });
  const recentList = h('div', { class: 'list' });

  const form = h('form', { class: 'card', novalidate: true, 'aria-label': 'Log spending', onsubmit: submit },
    h('h2', { class: 'card-title' }, h('span', {}, 'Log spending'), catTag),
    catGrid,
    chips,
    h('div', { class: 'row2' }, field('Item', item), field('Amount', amount)),
    h('div', { class: 'row2' }, field('Date', date), field('Paid with', methodSeg.el)),
    h('button', { type: 'submit', class: 'btn btn-primary' }, '+ Add'));

  el.append(h('div', { class: 'cols' },
    form,
    h('div', { class: 'card' },
      h('h2', { class: 'card-title' }, h('span', {}, 'Recent'), h('a', { href: '#spending', class: 'aside' }, 'All spending →')),
      recentList)));

  function submit(e) {
    e.preventDefault();
    clearErrors(form);
    const name = item.value.trim();
    if (!name) {
      showError(item, 'Enter what it was for.');
      return;
    }
    const money = readMoney(amount);
    if (!money.ok) return;
    const today = app.today();
    const d = isYMD(date.value) ? minYMD(date.value, today) : today;
    const rec = app.store.add('spend', { date: d, item: name, amountCents: money.cents, categoryId, method });
    item.value = '';
    amount.value = '';
    date.value = today;
    toast(`Added ${name} ${peso(money.cents)}`, { action: 'Undo', onAction: () => app.store.remove(rec.id) });
  }

  function chooseCategory(c) {
    categoryId = c.id;
    catTag.textContent = `${c.icon} ${c.name}`;
    renderChips();
    app.store.device.set({ lastCategoryId: c.id });
  }

  function renderCategories() {
    const cats = snap.categories;
    if (!cats.some((c) => c.id === categoryId)) categoryId = cats[0]?.id ?? null;
    fill(catGrid, cats.map((c) => h('label', { class: 'cat-tile' },
      h('input', { type: 'radio', name: 'log-cat', value: c.id, checked: c.id === categoryId, onchange: () => chooseCategory(c) }),
      h('span', { class: 'cat-icon', 'aria-hidden': 'true' }, c.icon),
      c.name)));
    const current = cats.find((c) => c.id === categoryId);
    catTag.textContent = current ? `${current.icon} ${current.name}` : '';
  }

  function renderChips() {
    const cat = snap.categories.find((c) => c.id === categoryId);
    const places = cat?.places ?? [];
    const known = new Set(places.map((p) => p.toLowerCase()));
    const counts = new Map();
    for (const r of app.store.all()) {
      if (r.type !== 'spend' || r.deleted || r.categoryId !== categoryId) continue;
      const name = r.item.trim();
      if (!name || known.has(name.toLowerCase())) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const frequent = [...counts].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 6).map(([name]) => name);
    fill(chips, [...places, ...frequent].map((p) => h('button', {
      type: 'button',
      class: 'chip',
      onclick: () => {
        item.value = p;
        amount.focus();
      },
    }, p)));
    chips.hidden = chips.childElementCount === 0;
  }

  function renderRecent() {
    const list = recentSpends(app, 20);
    fill(recentList, list.length
      ? list.map((r) => spendRow(r, app))
      : h('p', { class: 'empty' }, 'Nothing logged yet.'));
  }

  return {
    update(next) {
      snap = next;
      renderCategories();
      renderChips();
      date.max = snap.today;
      if (!isYMD(date.value) || date.value === shownToday) date.value = snap.today;
      shownToday = snap.today;
      renderRecent();
    },
  };
}
