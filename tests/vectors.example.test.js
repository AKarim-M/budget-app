// Synthetic household (not anyone's real numbers): ₱10,000 every Tuesday,
// ₱1,000.25 installment, a ₱20,000.50 bill still unpaid on the start day.
import { defineVectorSuite } from './vectors.shared.js';

defineVectorSuite('synthetic household', {
  startDate: '2026-10-15',
  weeklyPayCents: 1000000,
  installmentCents: 100025,
  bankCents: 500000,
  openingBill: { stmt: '2026-10', due: '2026-11-07', unpaidCents: 2000050, minimumDueCents: 250000 },
  planned: [
    { date: '2026-10-26', cents: 1200000 },
    { date: '2026-10-27', cents: 400000 },
  ],
  cardPayments: [
    { date: '2026-11-03', cents: 1200000 },
    { date: '2026-11-10', cents: 800050 },
  ],
  swipe: { date: '2026-10-17', cents: 300000 },
  cashCents: 100000,
  firstPayday: '2026-10-20',
  expect: {
    ltsStart: 799925,
    dayEnd: {
      '2026-10-20': 1500000,
      '2026-10-26': 300000,
      '2026-10-27': 900000,
      '2026-11-03': 700000,
      '2026-11-10': 899950,
      '2026-12-01': 3899950,
      '2026-12-07': 3799925,
    },
    lowest: { date: '2026-10-26', cents: 300000 },
    needsPayFirst: ['2026-10-27', '2026-11-03', '2026-11-10'],
    worst: { '2026-10-27': -100000, '2026-11-03': -300000, '2026-11-10': -100050 },
    highMinimumCents: 2500000,
    ltsAfterSwipe: 499925,
    openBillDue: '2026-12-07',
    openBillAfterSwipe: 400025,
    lastDay: '2026-11-14',
    bankAfterPlan: 899950,
    ltsLastDay: 799925,
    nextCycleDay: '2026-11-15',
    owedNextCycle: 200050,
    ltsNextCycle: 4699900,
  },
});
