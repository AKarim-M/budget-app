# How the numbers work

All amounts are whole centavos and all dates are local calendar days. The examples use a
**made-up household**, so they are not anyone's real numbers.

## One pool of money

The bank account plus cash in the wallet is a single pool.

- Pay goes **in** on each payday.
- Cash spending, planned payments and **card bill payments** go **out**.
- A **card swipe does not leave the bank** on the day you swipe. It stays in the pool as
  **card owed** until the bill is paid, which is why it lowers *Left until the next bill*
  straight away.

## Card statements

With a cut-off day of **15** and a due day of **7**:

| Purchase on | Statement | Bill due |
|---|---|---|
| Oct 11 or Oct 14 | Sep 15 – Oct 14 | Nov 7 |
| Oct 15 or Nov 14 | Oct 15 – Nov 14 | Dec 7 |
| Dec 20 | Dec 15 – Jan 14 | Feb 7 |

Every bill also carries the monthly installment(s) whose window includes its due month.

## The two numbers on top

**Left until the next bill** (the big number) is what can still be spent, card or cash, until
the current statement's due date, with that bill, the bills before it and planned payments
covered:

```
  money on hand now (bank + wallet)
+ paydays still to come, up to the due date  (only counted paydays)
+ planned money in, not yet received, up to the due date
− everything owed to the card                (all unpaid bills, incl. the open one so far)
− planned payments not yet made, up to the due date (overdue ones too)
```

Under it is a weekly pace: that amount spread over the weeks left to the due date.

**Cash you can spend now** is the lowest the bank (with the wallet) gets between today and that
due date, if everything goes as planned: the lowest point of the *Bank balance ahead* below.
Spending that much in cash today still leaves every planned payment and bill covered on its
day. Below zero it shows as **"Bank short ₱X on <day>"**.

How each entry changes them:

- **A cash spend** lowers both as soon as you log it.
- **A card swipe** lowers the big number at once. It lowers *cash you can spend now* only if
  the bill it lands on could no longer be paid, because a swipe leaves the bank on that bill's
  due date.
- **A payday arriving** or **paying the card as planned** changes neither: they were already
  counted.
- **Unticking a payday** (late or missing) lowers the big number by that pay. *Cash you can
  spend now* drops too if, without that pay, the bank would go lower on some day.

**Example (made-up):** pay is ₱10,000 every Tuesday. On Oct 15 there is ₱5,000 in the bank.
The Nov 7 bill has ₱20,000.50 unpaid (to be paid ₱12,000 on Nov 3 and ₱8,000.50 on Nov 10), the
installment is ₱1,000.25, and ₱12,000 and ₱4,000 are planned for Oct 26 and Oct 27.

```
Left until the Dec 7 bill:  5,000 + 7 × 10,000 − (20,000.50 + 1,000.25) − 16,000 = ₱37,999.25
Cash you can spend now:     5,000 + 10,000 (Oct 20 pay) − 12,000 (Oct 26)         = ₱3,000.00
```

The lowest day is Oct 26: on every later day up to the Dec 7 bill, the bank stays higher.

## Bank balance ahead (timeline)

The Plan tab plays the future forward from today to the current statement's due date:
paydays, planned payments, scheduled card payments, and "pay the rest of the bill" on each due
date. It shows the bank balance at the end of each day and the lowest point. It warns about:

- **The bank going below zero** on a day.
- **A payment on a payday** that only works if that day's salary lands first.
- **A bill not fully paid by its due date**, so interest is likely. A **late-fee risk** is shown only when a minimum due is set.
- **Overdue bills, planned items and scheduled payments.**
- **A missing statement amount** for a closed bill.

## Bills and payments

- **Who a payment pays:** a payment goes to the bill it was made for first, then to the
  oldest unpaid bill. An overpayment moves to the next bill and finally becomes card credit.
- **Statement amounts:** entering a statement's *Total Amount Due* replaces the amount worked
  out from your entries. It also folds any older unpaid amount into it, because the statement
  already carries it, so nothing is counted twice.
- **Interest and fees** are not calculated. Enter the real statement amount when it arrives.

## Bank checks

A bank check records the real money on hand (bank + wallet) at that moment. Everything
logged after it, on any device, counts from there; anything logged before it is already inside it.
On a payday the check says whether that day's pay is already included. Settings shows how far
each check was from what the app expected.

## Records (ready for sync)

- **Every entry** carries an `id`, who logged it (`by`), and `createdAt`/`updatedAt`
  timestamps that never go backwards on a device. A deletion is kept as a marker, so it can
  sync too.
- **Fixed ids** are used for one-of-a-kind records (`settings`, `payday:YYYY-MM-DD`,
  `bill:YYYY-MM`), so two devices update the same row instead of creating duplicates.
- **When two devices change the same entry**, the newer change wins. A deletion wins a tie.
