import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute, spendingForCycle } from '../js/engine.js';
import { household } from './helpers/household.js';

const bill = (snap, stmt) => snap.bills.find((b) => b.stmt === stmt);
const codes = (snap) => snap.warnings.map((w) => w.code);

// ---------- setup ----------

test('without settings the app asks for setup', () => {
  assert.deepEqual(compute([], { today: '2026-10-15' }), { needsSetup: true, today: '2026-10-15' });
});

// ---------- bills ----------

test('the open bill is the installment plus card swipes; cash is not on the card', () => {
  const h = household({ installmentCents: 100000 });
  h.spend('2026-10-20', 30000, 'card');
  h.spend('2026-10-21', 5000, 'cash');
  h.spend('2026-11-15', 7000, 'card'); // the 15th starts the next statement
  const s = compute(h.records, { today: '2026-11-16' });
  const nov = bill(s, '2026-11');
  const dec = bill(s, '2026-12');
  assert.deepEqual([nov.swipeCents, nov.totalCents, nov.due], [30000, 130000, '2026-12-07']);
  assert.deepEqual([dec.swipeCents, dec.totalCents, dec.due], [7000, 107000, '2027-01-07']);
});

test('spending dated before the start day is covered by the opening figures', () => {
  const h = household({ bankCents: 500000 });
  h.spend('2026-10-10', 99900, 'card');
  h.spend('2026-10-10', 1000, 'cash');
  const s = compute(h.records, { today: '2026-10-16' });
  assert.equal(bill(s, '2026-11').totalCents, 0);
  assert.equal(s.bank.nowCents, 500000);
});

test('a statement amount replaces the computed bill; an adjustment adds to it', () => {
  const h = household({ installmentCents: 100000 });
  h.spend('2026-10-20', 30000);
  h.bill('2026-11', { statementCents: 150000, adjustCents: 999 });
  let s = compute(h.records, { today: '2026-11-20' });
  assert.deepEqual([bill(s, '2026-11').computedCents, bill(s, '2026-11').totalCents], [130999, 150000]);

  const h2 = household({ installmentCents: 100000 });
  h2.spend('2026-10-20', 30000);
  h2.bill('2026-11', { adjustCents: 5000 });
  s = compute(h2.records, { today: '2026-11-20' });
  assert.equal(bill(s, '2026-11').totalCents, 135000);
});

// ---------- card payments ----------

test('a card payment pays the oldest bill first and the rest goes to the next', () => {
  const h = household({ installmentCents: 100000, openingBills: [{ stmt: '2026-10', cents: 200000 }] });
  h.payment('2026-11-03', 250000, { done: true });
  const s = compute(h.records, { today: '2026-11-05' });
  const old = bill(s, '2026-10');
  assert.deepEqual([old.paidCents, old.remCents, old.status], [200000, 0, 'paid']);
  assert.deepEqual([bill(s, '2026-11').paidCents, bill(s, '2026-11').remCents], [50000, 50000]);
  assert.equal(s.owed.cents, 50000);
});

test('paying the card, even overpaying, never changes left to spend', () => {
  const make = () => household({ bankCents: 1000000, openingBills: [{ stmt: '2026-10', cents: 100000 }] });
  const unpaid = compute(make().records, { today: '2026-10-16' });
  const h = make();
  h.payment('2026-10-16', 150000, { done: true });
  const paid = compute(h.records, { today: '2026-10-16' });
  assert.equal(paid.lts.cents, unpaid.lts.cents);
  assert.equal(paid.bank.nowCents, 850000);
  assert.deepEqual([paid.owed.cents, paid.owed.creditCents], [-50000, 50000]);
});

test('card credit is used up by later swipes', () => {
  const h = household({ bankCents: 1000000, openingBills: [{ stmt: '2026-10', cents: 100000 }] });
  h.payment('2026-10-16', 150000, { done: true });
  h.spend('2026-10-17', 20000, 'card');
  const s = compute(h.records, { today: '2026-10-17' });
  assert.deepEqual([s.owed.cents, s.owed.creditCents, bill(s, '2026-11').remCents], [-30000, 30000, 0]);
});

test('a payment pinned to a bill pays that bill first', () => {
  const h = household({ installmentCents: 100000, openingBills: [{ stmt: '2026-10', cents: 100000 }] });
  h.payment('2026-10-20', 150000, { done: true, billStmt: '2026-11' });
  const s = compute(h.records, { today: '2026-10-21' });
  assert.deepEqual([bill(s, '2026-11').remCents, bill(s, '2026-10').remCents], [0, 50000]);
});

test('a statement folds older unpaid bills into it', () => {
  const h = household({ openingBills: [{ stmt: '2026-10', cents: 300000 }] });
  h.spend('2026-10-20', 100000);
  h.payment('2026-11-03', 200000, { done: true });
  h.payment('2026-11-12', 50000, { done: true });
  h.bill('2026-11', { statementCents: 151500 }); // 50,000 carried + 1,500 interest + 100,000 new
  h.payment('2026-11-20', 51500, { done: true });
  const s = compute(h.records, { today: '2026-11-25' });
  const old = bill(s, '2026-10');
  assert.deepEqual([old.status, old.foldedInto, old.remCents, old.paidCents], ['folded', '2026-11', 0, 250000]);
  assert.equal(bill(s, '2026-11').remCents, 100000);
  assert.equal(s.owed.cents, 100000);
});

test('a statement replaces payments made on that bill before it closed', () => {
  const h = household({ openingBills: [{ stmt: '2026-10', cents: 100000 }] });
  h.payment('2026-11-03', 100000, { done: true });
  h.spend('2026-10-20', 80000);
  h.payment('2026-11-13', 30000, { done: true }); // prepays the open bill
  h.bill('2026-11', { statementCents: 50000 }); // printed amount already nets the prepayment
  const s = compute(h.records, { today: '2026-11-20' });
  assert.equal(bill(s, '2026-11').remCents, 50000);
  assert.equal(bill(s, '2026-10').status, 'paid');
});

test('a negative statement becomes card credit', () => {
  const h = household();
  h.bill('2026-11', { statementCents: -20000 });
  h.spend('2026-11-16', 5000);
  const s = compute(h.records, { today: '2026-11-20' });
  assert.deepEqual([s.owed.creditCents, s.owed.cents, bill(s, '2026-12').remCents], [15000, -15000, 0]);
});

test('scheduled payments wait in the forecast without changing what is owed now', () => {
  const h = household({ openingBills: [{ stmt: '2026-10', cents: 200000 }] });
  h.payment('2026-11-03', 200000);
  const s = compute(h.records, { today: '2026-10-20' });
  assert.equal(bill(s, '2026-10').remCents, 200000);
  assert.ok(s.timeline.rows.some((r) => r.date === '2026-11-03' && r.kind === 'card-payment'));
  assert.ok(!s.timeline.rows.some((r) => r.kind === 'bill-rest'));
});

// ---------- bank ----------

test('the bank is the last check plus counted pay minus cash; card swipes wait for the bill', () => {
  const h = household({ bankCents: 500000 });
  h.spend('2026-10-21', 20000, 'cash');
  h.spend('2026-10-21', 30000, 'card');
  assert.equal(compute(h.records, { today: '2026-10-22' }).bank.nowCents, 1480000);
});

test('a bank check counts same-day entries made after it, from any device, but not earlier ones', () => {
  const h = household({ bankCents: 500000 });
  h.spend('2026-10-21', 10000, 'cash', { at: '2026-10-21T01:00:00.000Z', by: 'A' });
  h.check('2026-10-21', 1234500, { at: '2026-10-21T03:00:00.000Z', by: 'A' });
  h.spend('2026-10-21', 4500, 'cash', { at: '2026-10-21T05:00:00.000Z', by: 'B' });
  assert.equal(compute(h.records, { today: '2026-10-21' }).bank.nowCents, 1230000);
});

test('a check on a payday says whether that pay is already in it', () => {
  for (const [payIncluded, expected] of [[true, 2000000], [false, 3000000]]) {
    const h = household({ bankCents: 500000 });
    h.check('2026-10-20', 2000000, { payIncluded, at: '2026-10-20T03:00:00.000Z' });
    assert.equal(compute(h.records, { today: '2026-10-20' }).bank.nowCents, expected, String(payIncluded));
  }
});

test('the latest same-day check wins and future-dated checks are ignored', () => {
  const h = household();
  h.check('2026-10-21', 1000000, { at: '2026-10-21T03:00:00.000Z' });
  h.check('2026-10-21', 1100000, { at: '2026-10-21T04:00:00.000Z' });
  h.check('2026-10-30', 9999900, { at: '2026-10-21T05:00:00.000Z' });
  assert.equal(compute(h.records, { today: '2026-10-21' }).bank.nowCents, 1100000);
});

test('a back-dated cash spend from before the latest check is already inside it', () => {
  const h = household();
  h.check('2026-10-21', 1000000, { at: '2026-10-21T03:00:00.000Z' });
  h.spend('2026-10-19', 5000, 'cash', { at: '2026-10-22T01:00:00.000Z' });
  assert.equal(compute(h.records, { today: '2026-10-22' }).bank.nowCents, 1000000);
});

test('each bank check shows how far it was from what the app expected', () => {
  const h = household({ bankCents: 500000 });
  h.spend('2026-10-20', 20000, 'cash', { at: '2026-10-20T01:00:00.000Z' });
  const chk = h.check('2026-10-21', 1470000, { at: '2026-10-21T03:00:00.000Z' });
  const s = compute(h.records, { today: '2026-10-21' });
  const r = s.reconciliations.find((x) => x.id === chk.id);
  assert.deepEqual([r.expectedCents, r.diffCents], [1480000, -10000]);
});

test('without any bank check the app warns and counts from zero', () => {
  const h = household({ bankCents: 500000 });
  const s = compute(h.records.filter((r) => r.type !== 'bankCheck'), { today: '2026-10-21' });
  assert.ok(codes(s).includes('no_bank_check'));
  assert.equal(s.bank.nowCents, 1000000);
});

// ---------- left to spend ----------

test('left to spend does not change when a payday arrives', () => {
  const h = household({ bankCents: 500000, installmentCents: 100000, openingBills: [{ stmt: '2026-10', cents: 2000050 }] });
  const before = compute(h.records, { today: '2026-10-19' }).lts.cents;
  assert.equal(compute(h.records, { today: '2026-10-20' }).lts.cents, before);
});

test('ticking a card payment done does not change left to spend', () => {
  const make = (done) => {
    const h = household({ bankCents: 500000, openingBills: [{ stmt: '2026-10', cents: 200000 }] });
    h.payment('2026-11-03', 200000, { done });
    return compute(h.records, { today: '2026-11-03' });
  };
  const open = make(false);
  const ticked = make(true);
  assert.equal(ticked.lts.cents, open.lts.cents);
  assert.equal(open.bank.nowCents - ticked.bank.nowCents, 200000);
});

test('a planned payment inside the cycle lowers left to spend; one after the cut-off does not', () => {
  const base = compute(household().records, { today: '2026-10-15' }).lts.cents;
  const inside = household();
  inside.planned('2026-11-10', 50000);
  const after = household();
  after.planned('2026-11-20', 50000);
  assert.equal(compute(inside.records, { today: '2026-10-15' }).lts.cents, base - 50000);
  assert.equal(compute(after.records, { today: '2026-10-15' }).lts.cents, base);
});

test('planned money in counts until its day has passed unticked', () => {
  const base = compute(household().records, { today: '2026-10-16' }).lts.cents;
  const h = household();
  h.planned('2026-10-16', 300000, 'in');
  assert.equal(compute(h.records, { today: '2026-10-16' }).lts.cents, base + 300000);
  const late = compute(h.records, { today: '2026-10-17' });
  assert.equal(late.lts.cents, compute(household().records, { today: '2026-10-17' }).lts.cents);
  assert.ok(codes(late).includes('overdue_planned_in'));
});

test('an overdue planned payment stays reserved, is flagged, and shows today', () => {
  const base = compute(household().records, { today: '2026-10-18' }).lts.cents;
  const h = household();
  h.planned('2026-10-16', 50000);
  const s = compute(h.records, { today: '2026-10-18' });
  assert.equal(s.lts.cents, base - 50000);
  assert.ok(codes(s).includes('overdue_planned'));
  const row = s.timeline.rows.find((r) => r.kind === 'planned-out');
  assert.deepEqual([row.date, row.overdue], ['2026-10-18', true]);
});

// ---------- timeline & warnings ----------

test('on a payday money in comes before money out, with a pay-first warning', () => {
  const h = household({ bankCents: 0 });
  h.planned('2026-10-20', 300000);
  const s = compute(h.records, { today: '2026-10-15' });
  const day = s.timeline.days.find((d) => d.date === '2026-10-20');
  assert.deepEqual(day.rows.map((r) => r.kind), ['payday', 'planned-out']);
  assert.deepEqual([day.startCents, day.endCents, day.worstCents], [0, 700000, -300000]);
  assert.ok(s.warnings.some((w) => w.code === 'needs_pay_first' && w.date === '2026-10-20'));
});

test('a payday with no payment never says to wait for the salary, even if the bank starts it below zero', () => {
  const h = household({ bankCents: 0 });
  h.spend('2026-10-15', 50000, 'cash'); // the bank is ₱500 below zero today
  const s = compute(h.records, { today: '2026-10-15' });
  assert.deepEqual(s.warnings.filter((w) => w.code === 'needs_pay_first').map((w) => w.date), []);
});

test('a payment on a payday still says to wait for the salary when the bank starts below zero', () => {
  const h = household({ bankCents: 0 });
  h.spend('2026-10-15', 50000, 'cash');
  h.planned('2026-10-20', 300000);
  const s = compute(h.records, { today: '2026-10-15' });
  assert.deepEqual(s.warnings.filter((w) => w.code === 'needs_pay_first').map((w) => w.date), ['2026-10-20']);
});

test('a day that ends below zero is flagged', () => {
  const h = household({ bankCents: 0 });
  h.planned('2026-10-18', 50000);
  const s = compute(h.records, { today: '2026-10-15' });
  assert.ok(s.warnings.some((w) => w.code === 'negative_balance' && w.date === '2026-10-18'));
});

test('an overdue scheduled card payment shows today and is flagged', () => {
  const h = household({ openingBills: [{ stmt: '2026-10', cents: 100000 }] });
  h.payment('2026-10-16', 10000);
  const s = compute(h.records, { today: '2026-10-18' });
  const row = s.timeline.rows.find((r) => r.kind === 'card-payment');
  assert.deepEqual([row.date, row.overdue], ['2026-10-18', true]);
  assert.ok(codes(s).includes('overdue_payment'));
});

test('a bill past its due date with money owed is overdue', () => {
  const h = household({ openingBills: [{ stmt: '2026-10', cents: 100000 }] });
  const s = compute(h.records, { today: '2026-11-08' });
  assert.equal(bill(s, '2026-10').status, 'overdue');
  assert.ok(codes(s).includes('bill_overdue'));
  const rest = s.timeline.rows.find((r) => r.kind === 'bill-rest' && r.stmt === '2026-10');
  assert.deepEqual([rest.date, rest.overdue, rest.cents], ['2026-11-08', true, -100000]);
});

test('bill statuses follow the calendar and payments', () => {
  const h = household({ installmentCents: 100000, openingBills: [{ stmt: '2026-10', cents: 100000 }] });
  h.payment('2026-11-03', 100000, { done: true });
  const s = compute(h.records, { today: '2026-11-20' });
  assert.deepEqual(
    [bill(s, '2026-10').status, bill(s, '2026-11').status, bill(s, '2026-12').status],
    ['paid', 'closed', 'open'],
  );
});

test('a closed bill without a statement amount asks for one', () => {
  const s = compute(household({ installmentCents: 100000 }).records, { today: '2026-11-16' });
  assert.ok(s.warnings.some((w) => w.code === 'statement_missing' && w.refId === '2026-11'));
});

test('unticked paydays show as info rows and are skipped as the next payday', () => {
  const h = household();
  h.payday('2026-10-20', { counted: false });
  const s = compute(h.records, { today: '2026-10-15' });
  const row = s.timeline.rows.find((r) => r.date === '2026-10-20');
  assert.deepEqual([row.kind, row.cents], ['payday-off', 0]);
  assert.equal(s.bank.nextPayday.date, '2026-10-27');
});

test("the current cycle's paydays are listed with what has arrived", () => {
  const s = compute(household().records, { today: '2026-10-27' });
  assert.deepEqual(s.paydays.map((p) => [p.date, p.received]),
    [['2026-10-20', true], ['2026-10-27', true], ['2026-11-03', false], ['2026-11-10', false]]);
});

// ---------- spending view ----------

test('spendingForCycle groups a cycle by category and by person', () => {
  const h = household();
  h.spend('2026-10-16', 10000, 'card', { categoryId: 'cat:food', by: 'A' });
  h.spend('2026-10-17', 5000, 'cash', { categoryId: 'cat:groceries', by: 'B' });
  h.spend('2026-11-15', 7000, 'card');
  const v = spendingForCycle(h.records, '2026-11', { today: '2026-11-20' });
  assert.deepEqual(v.items.map((i) => i.date), ['2026-10-17', '2026-10-16']);
  assert.deepEqual([v.totals.cardCents, v.totals.cashCents, v.totals.totalCents], [10000, 5000, 15000]);
  const byCat = Object.fromEntries(v.byCategory.filter((c) => c.cents > 0).map((c) => [c.category.id, [c.cents, c.pct]]));
  assert.deepEqual(byCat, { 'cat:food': [10000, 67], 'cat:groceries': [5000, 33] });
  assert.deepEqual(v.byPerson, [{ by: 'A', cents: 10000 }, { by: 'B', cents: 5000 }]);
});
