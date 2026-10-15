// Display text: dates, pesos, bill names and warning messages.
import { formatPeso } from '../money.js';
import { parseYMD, weekdayOf } from '../dates.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const peso = formatPeso;
/** A rounded amount for guides like a weekly pace: '₱6,350'. */
export const pesoRounded = (cents) => formatPeso(Math.round(cents / 1000) * 1000).replace(/\.00$/, '');

export function shortDate(s) {
  const { m, d } = parseYMD(s);
  return `${MON[m - 1]} ${d}`;
}

export const dayLabel = (s) => `${WD[weekdayOf(s)]} ${shortDate(s)}`;
export const longDate = (s) => `${WD[weekdayOf(s)]}, ${shortDate(s)}, ${parseYMD(s).y}`;
export const range = (a, b) => `${shortDate(a)} – ${shortDate(b)}`;
export const billLabel = (due) => `${shortDate(due)} bill`;

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH[m - 1]} ${y}`;
}

/** 'Nov 17, 24 & Dec 1': each month named once. */
export function dateList(dates) {
  const parts = dates.map((d, i) => {
    const sameMonth = i > 0 && d.slice(0, 7) === dates[i - 1].slice(0, 7);
    return sameMonth ? String(parseYMD(d).d) : shortDate(d);
  });
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`;
}

const PERSON_COLORS = ['#2f8f63', '#3b78c2', '#c2593f', '#8a5cc2', '#c98a16', '#16928a', '#c2417a', '#6b7a8f'];

/** The same name always gets the same colour, on every device. */
export function personColor(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) % 1_000_003;
  return PERSON_COLORS[hash % PERSON_COLORS.length];
}

export function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

export function warningText(w) {
  const d = w.data ?? {};
  switch (w.code) {
    case 'negative_balance':
      return `${dayLabel(w.date)}: the bank would drop below zero (${peso(d.endCents)}).`;
    case 'needs_pay_first':
      return d.cardPayment
        ? `${dayLabel(w.date)}: pay the card after your salary lands.`
        : `${dayLabel(w.date)}: make this payment after your salary lands.`;
    case 'interest_likely':
      return `${billLabel(w.date)}: ${peso(d.coveredCents)} of ${peso(d.totalCents)} paid by the due date, so interest is likely on the rest.`;
    case 'late_fee_risk':
      return `${billLabel(w.date)}: less than the minimum (${peso(d.minimumDueCents)}) paid by the due date. Late fee risk.`;
    case 'bill_overdue':
      return `${billLabel(w.date)} is overdue: ${peso(d.remCents)} still unpaid.`;
    case 'statement_missing':
      return `When the ${billLabel(d.due)} statement arrives, enter its amount (Plan → Card bills).`;
    case 'overdue_planned':
      return `${d.label} (${peso(d.cents)}) was due ${dayLabel(w.date)}. Tick it when it's paid.`;
    case 'overdue_planned_in':
      return `${d.label} (${peso(d.cents)}) was expected ${dayLabel(w.date)}. Tick it when it arrives.`;
    case 'overdue_payment':
      return `A card payment of ${peso(d.cents)} was planned for ${dayLabel(w.date)}. Tick it when it's paid.`;
    case 'no_bank_check':
      return 'Enter your bank balance (Settings → Bank balance).';
    default:
      return w.code;
  }
}
