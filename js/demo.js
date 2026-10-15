// A made-up household for trying the app (?demo=1) and for automated screen checks.
// Not anyone's real data. Nothing is saved: demo mode uses throwaway storage.

export function seedDemo(store) {
  store.device.set({ userName: 'Demo' });
  store.batch(() => {
    store.updateSettings({
      startDate: '2026-10-15',
      paySchedule: [{ from: '2026-10-15', amountCents: 1000000, weekday: 2 }],
      cutoffDay: 15,
      dueDay: 7,
      installments: [{ id: 'demo-installment', label: 'Appliance installment', amountCents: 100025 }],
    });
    store.setBill('2026-10', { statementCents: 2000050, minimumDueCents: 250000 });
    store.upsert('category', 'cat:food', { places: ['Canteen', 'Bakery', 'Coffee shop'] });
    store.upsert('category', 'cat:groceries', { places: ['Supermarket', 'Wet market'] });
    store.upsert('category', 'cat:transport', { places: ['Gas station', 'Jeepney', 'Tricycle'] });
    store.add('planned', { date: '2026-10-26', label: 'School fees', amountCents: 1200000, direction: 'out', done: false, doneAt: null });
    store.add('planned', { date: '2026-10-27', label: 'Rent share', amountCents: 400000, direction: 'out', done: false, doneAt: null });
    store.add('cardPayment', { date: '2026-11-03', amountCents: 1200000, done: false, doneAt: null, billStmt: null });
    store.add('cardPayment', { date: '2026-11-10', amountCents: 800050, done: false, doneAt: null, billStmt: null });
    // The opening balance comes before same-day spending.
    store.add('bankCheck', { date: '2026-10-15', amountCents: 500000, walletCents: 0, payIncluded: false, kind: 'opening' });
    store.add('spend', { date: '2026-10-15', item: 'Lunch', amountCents: 35000, categoryId: 'cat:food', method: 'card' });
    store.add('spend', { date: '2026-10-15', item: 'Supermarket', amountCents: 182075, categoryId: 'cat:groceries', method: 'card' });
    store.add('spend', { date: '2026-10-15', item: 'Jeepney', amountCents: 5000, categoryId: 'cat:transport', method: 'cash' });
  });
}
