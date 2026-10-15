// End-to-end money scenarios, run against any set of numbers.
// vectors.example.test.js uses synthetic amounts (committed);
// vectors.local.test.js uses the household's real amounts (git-ignored).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute } from '../js/engine.js';
import { household } from './helpers/household.js';

function build(V, { done = false, minimumDueCents = V.openingBill.minimumDueCents } = {}) {
  const h = household({
    start: V.startDate,
    bankCents: V.bankCents,
    payCents: V.weeklyPayCents,
    installmentCents: V.installmentCents,
    openingBills: [{ stmt: V.openingBill.stmt, cents: V.openingBill.unpaidCents, minimumDueCents }],
  });
  for (const p of V.planned) h.planned(p.date, p.cents, 'out', { done });
  for (const c of V.cardPayments) h.payment(c.date, c.cents, { done });
  return h;
}

const dayMap = (snap, key) => Object.fromEntries(snap.timeline.days.map((d) => [d.date, d[key]]));
const codesOn = (snap, date) => snap.warnings.filter((w) => w.date === date).map((w) => w.code);

export function defineVectorSuite(name, V) {
  const E = V.expect;

  test(`${name}: left to spend on the first day`, () => {
    const s = compute(build(V).records, { today: V.startDate });
    assert.equal(s.lts.cents, E.ltsStart);
    assert.equal(s.bank.nowCents, V.bankCents);
  });

  test(`${name}: bank balance at the end of each day`, () => {
    const s = compute(build(V).records, { today: V.startDate });
    const end = dayMap(s, 'endCents');
    for (const [date, cents] of Object.entries(E.dayEnd)) assert.equal(end[date], cents, date);
    assert.deepEqual(s.timeline.lowest, E.lowest);
  });

  test(`${name}: payments on a payday warn to wait for the salary`, () => {
    const s = compute(build(V).records, { today: V.startDate });
    const dates = s.warnings.filter((w) => w.code === 'needs_pay_first').map((w) => w.date);
    assert.deepEqual(dates, E.needsPayFirst);
    const worst = dayMap(s, 'worstCents');
    for (const [date, cents] of Object.entries(E.worst)) assert.equal(worst[date], cents, date);
  });

  test(`${name}: a bill not fully paid by its due date warns about interest, not a late fee`, () => {
    const s = compute(build(V).records, { today: V.startDate });
    const codes = codesOn(s, V.openingBill.due);
    assert.ok(codes.includes('interest_likely'), codes.join());
    assert.ok(!codes.includes('late_fee_risk'), codes.join());
  });

  test(`${name}: paying less than the minimum by the due date warns about a late fee`, () => {
    const s = compute(build(V, { minimumDueCents: E.highMinimumCents }).records, { today: V.startDate });
    assert.ok(codesOn(s, V.openingBill.due).includes('late_fee_risk'));
  });

  test(`${name}: a card swipe lowers left to spend and grows the open bill, bank unchanged`, () => {
    const h = build(V);
    h.spend(V.swipe.date, V.swipe.cents, 'card');
    const s = compute(h.records, { today: V.swipe.date });
    assert.equal(s.lts.cents, E.ltsAfterSwipe);
    assert.equal(s.bills.find((b) => b.due === E.openBillDue).totalCents, E.openBillAfterSwipe);
    assert.equal(s.bank.nowCents, V.bankCents);
  });

  test(`${name}: cash spending lowers left to spend and the bank by the same amount`, () => {
    const h = build(V);
    h.spend(V.startDate, V.cashCents, 'cash');
    const s = compute(h.records, { today: V.startDate });
    assert.equal(s.lts.cents, E.ltsStart - V.cashCents);
    assert.equal(s.bank.nowCents, V.bankCents - V.cashCents);
  });

  test(`${name}: unticking a payday lowers left to spend by that pay`, () => {
    const h = build(V);
    h.payday(V.firstPayday, { counted: false });
    const s = compute(h.records, { today: V.startDate });
    assert.equal(s.lts.cents, E.ltsStart - V.weeklyPayCents);
  });

  test(`${name}: the last day of the cycle, with everything paid as planned`, () => {
    const s = compute(build(V, { done: true }).records, { today: E.lastDay });
    assert.equal(s.bank.nowCents, E.bankAfterPlan);
    assert.equal(s.lts.cents, E.ltsLastDay);
  });

  test(`${name}: after the cut-off, the next cycle's pay and installment come in`, () => {
    const s = compute(build(V, { done: true }).records, { today: E.nextCycleDay });
    assert.equal(s.bank.nowCents, E.bankAfterPlan);
    assert.equal(s.owed.cents, E.owedNextCycle);
    assert.equal(s.lts.cents, E.ltsNextCycle);
  });
}
