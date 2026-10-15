// Money is always an integer number of centavos. Parsing works on the text,
// never on float multiplication, so ₱4.35 is exactly 435.

const MAX_CENTS = 99_999_999_999; // ₱999,999,999.99
const NUMBER_RE = /^(?:\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/;

/**
 * @returns {{ok: true, cents: number} | {ok: false, error: string}}
 * error: 'empty' | 'invalid' | 'too_many_decimals' | 'negative' | 'zero' | 'too_large'
 */
export function parseMoney(input, { allowNegative = false, allowZero = false } = {}) {
  let s = String(input ?? '').trim().replace(/\s+/g, '');
  let negative = false;
  if (/^[-−]/.test(s)) { negative = true; s = s.slice(1); }
  s = s.replace(/^(?:₱|PHP)/i, '');
  if (/^[-−]/.test(s)) { negative = !negative; s = s.slice(1); }
  if (s === '') return { ok: false, error: 'empty' };

  const m = NUMBER_RE.exec(s);
  if (!m || !/\d/.test(s)) return { ok: false, error: 'invalid' };
  const fraction = m[1] ?? '';
  if (fraction.length > 2) return { ok: false, error: 'too_many_decimals' };

  const [wholeText] = s.replace(/,/g, '').split('.');
  const cents = Number(wholeText || '0') * 100 + Number((fraction + '00').slice(0, 2));
  if (cents > MAX_CENTS) return { ok: false, error: 'too_large' };
  if (cents === 0) return allowZero ? { ok: true, cents: 0 } : { ok: false, error: 'zero' };
  if (negative && !allowNegative) return { ok: false, error: 'negative' };
  return { ok: true, cents: negative ? -cents : cents };
}

function groupThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** '₱3,456.78', '−₱1,000.00'; signed adds '+' to positive amounts. */
export function formatPeso(cents, { signed = false } = {}) {
  const abs = Math.abs(Math.round(cents));
  const text = `₱${groupThousands(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
  if (cents < 0 && abs > 0) return `−${text}`;
  if (signed && abs > 0) return `+${text}`;
  return text;
}

/** Plain value for an input field: '2345.60', '12000'. */
export function formatInput(cents) {
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const text = frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}

export function sumCents(values) {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
