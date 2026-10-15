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

// ---------- until the next bill ----------

test('until the next bill adds the pay that lands between the cut-off and the due date', () => {
  const s = compute(household().records, { today: '2026-10-15' });
  assert.equal(s.untilDue.due, '2026-12-07');
  assert.deepEqual(s.untilDue.paydays, ['2026-11-17', '2026-11-24', '2026-12-01']);
  assert.equal(s.untilDue.cents, s.lts.cents + 3000000);
});

test('the weekly pace spreads what is left until the next bill over the weeks remaining', () => {
  const s = compute(household().records, { today: '2026-10-15' }); // 53 days to the Dec 7 bill
  assert.equal(s.untilDue.daysLeft, 53);
  assert.equal(s.untilDue.weeklyCents, Math.floor((s.untilDue.cents * 7) / 53));
  const later = compute(household().records, { today: '2026-11-14' }); // 23 days to Dec 7
  assert.equal(later.untilDue.daysLeft, 23);
  assert.equal(later.untilDue.weeklyCents, Math.floor((later.untilDue.cents * 7) / 23));
});

test('there is no weekly pace when the next bill is not covered', () => {
  const h = household({ bankCents: 0, openingBills: [{ stmt: '2026-10', cents: 99999900 }] });
  const s = compute(h.records, { today: '2026-10-15' });
  assert.ok(s.untilDue.cents < 0);
  assert.equal(s.untilDue.weeklyCents, 0);
});

test('until the next bill takes off what is planned after the cut-off, up to the due date only', () => {
  const plain = compute(household().records, { today: '2026-10-15' });
  const h = household();
  h.planned('2026-11-20', 50000);
  h.planned('2026-12-10', 70000); // after the Dec 7 bill: not counted here
  const s = compute(h.records, { today: '2026-10-15' });
  assert.equal(s.lts.cents, plain.lts.cents); // both are after the Nov 14 cut-off
  assert.equal(s.untilDue.cents, plain.untilDue.cents - 50000);
});

// ---------- monthly bills ----------

const ELECTRIC = { id: 'r1', label: 'Electricity', amountCents: 250000, day: 20, from: '2026-10-15' };
const monthsOf = (snap, id = 'r1') => snap.planned.filter((p) => p.recurringId === id);

test('a monthly bill is set aside when it falls before the cut-off, and shows each month ahead', () => {
  const base = compute(household().records, { today: '2026-10-15' });
  const s = compute(household({ recurring: [ELECTRIC] }).records, { today: '2026-10-15' });
  assert.equal(s.lts.cents, base.lts.cents - 250000); // Oct 20 is before the Nov 14 cut-off; Nov 20 is not
  assert.deepEqual(s.timeline.rows.filter((r) => r.label === 'Electricity').map((r) => [r.date, r.cents]),
    [['2026-10-20', -250000], ['2026-11-20', -250000]]);
  assert.deepEqual(monthsOf(s).map((p) => p.id), ['rec:r1:2026-10-20', 'rec:r1:2026-11-20']);
});

test('a due day of 31 lands on the last day of shorter months', () => {
  const s = compute(household({ recurring: [{ ...ELECTRIC, day: 31 }] }).records, { today: '2026-10-15' });
  assert.deepEqual(monthsOf(s).map((p) => p.date), ['2026-10-31', '2026-11-30']);
});

test('a monthly bill starts on its start date and stops after its last month', () => {
  const s = compute(household({ recurring: [{ ...ELECTRIC, day: 5, lastMonth: '2026-11' }] }).records, { today: '2026-10-15' });
  assert.deepEqual(monthsOf(s).map((p) => p.date), ['2026-11-05']); // not Oct 5 (before the start), not Dec 5 (after the end)
});

test('ticking a month as paid takes it from the bank that day; left to spend stays the same', () => {
  const h = household({ bankCents: 500000, recurring: [ELECTRIC] });
  const before = compute(h.records, { today: '2026-10-20' });
  h.add('planned', {
    date: '2026-10-20', label: 'Electricity', amountCents: 250000, direction: 'out', done: true, doneAt: '2026-10-20T02:00:00.000Z',
  }, { id: 'rec:r1:2026-10-20', date: '2026-10-20' });
  const after = compute(h.records, { today: '2026-10-20' });
  assert.equal(after.lts.cents, before.lts.cents);
  assert.equal(before.bank.nowCents - after.bank.nowCents, 250000);
  assert.equal(after.planned.filter((p) => p.id === 'rec:r1:2026-10-20').length, 1);
});

test("changing one month's amount or skipping a month affects only that month", () => {
  const h = household({ recurring: [ELECTRIC] });
  h.add('planned', { date: '2026-10-20', label: 'Electricity', amountCents: 310000, direction: 'out', done: false, doneAt: null }, { id: 'rec:r1:2026-10-20' });
  const skipped = h.add('planned', { date: '2026-11-20', label: 'Electricity', amountCents: 250000, direction: 'out', done: false, doneAt: null }, { id: 'rec:r1:2026-11-20' });
  skipped.deleted = true;
  const s = compute(h.records, { today: '2026-10-15' });
  assert.deepEqual(monthsOf(s).map((p) => [p.date, p.amountCents]), [['2026-10-20', 310000]]);
});

test('an unpaid month past its date stays set aside and is flagged', () => {
  const s = compute(household({ recurring: [ELECTRIC] }).records, { today: '2026-10-22' });
  const base = compute(household().records, { today: '2026-10-22' });
  assert.equal(s.lts.cents, base.lts.cents - 250000);
  assert.ok(s.warnings.some((w) => w.code === 'overdue_planned' && w.refId === 'rec:r1:2026-10-20'));
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
