// Pure sync helpers (no browser APIs): request building, reply checking, retry timing,
// device-connection links, and how each record reads as a row in the Google Sheet.

export const PROTOCOL = 1;
/** Errors that retrying will not fix: stop syncing and ask to reconnect. */
export const FATAL = new Set(['auth', 'deploy', 'upgrade', 'not_setup', 'bad_request', 'too_large']);

export function buildPayload({ pending, cfg, device, describe }) {
  return {
    payload: {
      v: PROTOCOL,
      secret: cfg.secret,
      deviceId: device.deviceId,
      by: device.userName || 'Me',
      since: cfg.lastRev ?? 0,
      changes: pending.map((p) => ({ ...p.record, _view: describe(p.record) })),
    },
    sent: pending.map((p) => ({ id: p.record.id, seq: p.seq })),
  };
}

/** Apps Script answers 200 even for errors; an HTML page means a deployment/permission problem. */
export function classifyResponse(status, text) {
  if (status < 200 || status >= 300) return { ok: false, error: 'server' };
  const body = String(text ?? '').trim();
  if (body.startsWith('<')) return { ok: false, error: 'deploy' };
  let obj;
  try {
    obj = JSON.parse(body);
  } catch {
    return { ok: false, error: 'server' };
  }
  if (obj?.ok === true && Array.isArray(obj.changes) && Number.isInteger(obj.rev) && typeof obj.serverId === 'string') {
    return obj;
  }
  if (obj?.ok === false && typeof obj.error === 'string') return { ok: false, error: obj.error, message: obj.message };
  return { ok: false, error: 'server' };
}

export function backoffMs(attempt, random = Math.random()) {
  return Math.round(Math.min(300_000, 5000 * 2 ** attempt) * (0.8 + 0.4 * random));
}

// ---------- connect links ----------

const GAS_PREFIX = 'https://script.google.com/';
const STANDARD = /^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/;

const b64urlEncode = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function b64urlDecode(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b + '='.repeat((4 - (b.length % 4)) % 4));
}

/** The part after "#connect=" in a device-connection link. */
export function encodeConnect({ url, secret }) {
  const m = STANDARD.exec(url);
  return m ? `1.${m[1]}.${secret}` : `2.${b64urlEncode(url)}.${secret}`;
}

/** pageHost: the app's own host. A local test server is accepted only when the app runs locally. */
export function decodeConnect(code, pageHost = '') {
  if (typeof code !== 'string' || code.length > 600) return null;
  const m = /^([12])\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{20,128})$/.exec(code);
  if (!m) return null;
  let url;
  if (m[1] === '1') {
    url = `${GAS_PREFIX}macros/s/${m[2]}/exec`;
  } else {
    try {
      url = b64urlDecode(m[2]);
    } catch {
      return null;
    }
  }
  if (!url.startsWith(GAS_PREFIX) && !isAllowedSyncUrl(url, pageHost)) return null;
  return { url, secret: m[3] };
}

/** Google Apps Script only; a local test server is allowed when the app itself runs locally. */
export function isAllowedSyncUrl(url, pageHost) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'https:' && u.hostname === 'script.google.com') return true;
  const local = ['localhost', '127.0.0.1'];
  return u.protocol === 'http:' && local.includes(u.hostname) && local.includes(pageHost);
}

// ---------- readable Sheet rows ----------

const pesos = (cents) => (cents == null ? null : cents / 100);

export function describeRecord(rec, categories = new Map()) {
  switch (rec.type) {
    case 'spend': {
      const cat = categories.get(rec.categoryId);
      return {
        date: rec.date,
        amount: pesos(rec.amountCents),
        label: rec.item,
        note: `${rec.method === 'card' ? 'Card' : 'Cash'} · ${cat?.name ?? 'Other'}`,
      };
    }
    case 'planned': {
      const out = rec.direction === 'out';
      return {
        date: rec.date,
        amount: pesos(out ? -rec.amountCents : rec.amountCents),
        label: rec.label,
        note: rec.done ? (out ? 'Paid' : 'Received') : out ? 'Planned payment' : 'Planned income',
      };
    }
    case 'cardPayment':
      return { date: rec.date, amount: pesos(-rec.amountCents), label: 'Card payment', note: rec.done ? 'Paid' : 'Scheduled' };
    case 'payday':
      return { date: rec.date, amount: pesos(rec.amountCents), label: 'Payday', note: rec.counted ? 'Counted' : 'Not counted' };
    case 'bill':
      return {
        date: rec.stmt,
        amount: pesos(rec.statementCents),
        label: 'Card bill',
        note: rec.minimumDueCents != null ? `Minimum ${pesos(rec.minimumDueCents)}` : '',
      };
    case 'bankCheck':
      return { date: rec.date, amount: pesos(rec.amountCents), label: rec.kind === 'opening' ? 'Starting balance' : 'Bank balance check', note: '' };
    case 'settings':
      return { date: rec.startDate, amount: null, label: 'Settings', note: '' };
    case 'category':
      return { date: '', amount: null, label: `${rec.icon} ${rec.name}`, note: (rec.places ?? []).join(', ') };
    default:
      return { date: '', amount: null, label: rec.type, note: '' };
  }
}

// ---------- status ----------

export function syncStatus(s) {
  if (!s.connected) return { text: 'Not syncing', tone: 'muted' };
  if (s.needsReconnect) return { text: 'Reconnect needed', tone: 'danger' };
  if (s.syncing) return { text: 'Syncing…', tone: 'muted' };
  if (s.online === false) return { text: s.pending ? `Offline · ${s.pending} waiting` : 'Offline', tone: 'warn' };
  if (s.lastError) return { text: 'Sync problem', tone: 'warn' };
  if (s.pending) return { text: `${s.pending} waiting`, tone: 'muted' };
  return { text: 'Synced', tone: 'ok' };
}
