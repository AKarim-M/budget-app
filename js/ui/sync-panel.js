// Sync screens: connect this device, show a QR code for another device, join from a link,
// the status pill in the top bar, and the Sync rows in Settings.
import { h, fill } from './dom.js';
import { openSheet, toast } from './overlay.js';
import { field, textInput, segmented, showError, clearErrors } from './forms.js';
import { decodeConnect } from '../sync-core.js';

const ERRORS = {
  bad_url: 'That doesn\'t look like the web app link. It starts with https://script.google.com/ and ends in /exec.',
  bad_secret: 'Check the sync code. Copy it again from the Sheet (Budget sync → Show sync code).',
  auth: 'The sync code doesn\'t match. Copy it again from the Sheet (Budget sync → Show sync code).',
  deploy: 'Google refused the request. Make sure the web app is deployed with "Who has access: Anyone", and that you approved its permissions.',
  not_setup: 'Run setup in the Apps Script editor first (see the guide).',
  upgrade: 'The script in your Sheet is out of date. Paste the new Code.gs and deploy a new version.',
  offline: 'You\'re offline. Connect to the internet and try again.',
  unreachable: 'Can\'t reach Google right now. Check the internet and try again.',
  busy: 'The Sheet is busy. Try again in a moment.',
  server: 'The Sheet had a problem. Try again in a moment.',
};

export const syncErrorText = (code) => ERRORS[code] ?? 'Something went wrong. Try again.';

function minutesAgo(app, t) {
  if (!t) return 'not yet';
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** The small label in the top bar. */
export function statusPill(app) {
  if (!app.sync) return null;
  const s = app.sync.status();
  if (!s.connected) return null;
  return h('a', { class: `sync-pill ${s.tone}`, href: '#settings', title: 'Sync status' }, s.text);
}

function hasLocalData(app) {
  return app.store.all().some((r) => !r.deleted);
}

/** Connect this device by pasting the web app link and sync code (first device). */
export function openConnect(app) {
  openSheet('Connect to your Google Sheet', (body, close) => {
    const url = textInput({ placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off', spellcheck: 'false' });
    const secret = textInput({ placeholder: 'Sync code', autocomplete: 'off', spellcheck: 'false' });
    const needsName = !(app.store.device.get().userName ?? '').trim();
    const name = textInput({ maxlength: 40, placeholder: 'e.g. Alex' });
    const local = hasLocalData(app);
    const mode = segmented('sync-mode', [['merge', 'Keep this device\'s entries and add them'], ['replace', 'Replace with the Sheet\'s data']], 'merge');
    mode.el.style.gridTemplateColumns = '1fr';
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Connect');
    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        clearErrors(form);
        if (needsName) {
          if (!name.value.trim()) {
            showError(name, 'Enter a name.');
            return;
          }
          app.store.device.set({ userName: name.value.trim() });
        }
        submit.disabled = true;
        submit.textContent = 'Connecting…';
        const r = await app.sync.connect({ url: url.value, secret: secret.value, mode: local ? mode.value() : 'merge' });
        submit.disabled = false;
        submit.textContent = 'Connect';
        if (!r.ok) {
          showError(r.error === 'bad_url' ? url : secret, syncErrorText(r.error));
          return;
        }
        close();
        toast('Connected. This device now syncs with your Sheet.');
      },
    },
    h('p', { class: 'section-note' }, 'From your Google Sheet setup: the web app link (ends in /exec) and the sync code. Other devices can then join by scanning a QR code.'),
    field('Web app link', url),
    field('Sync code', secret),
    needsName ? field('Your name on this device', name, { hint: 'Shown next to the items you log.' }) : null,
    local ? field('This device already has entries', mode.el) : null,
    submit);
    body.append(form);
  });
}

/** Show the QR code and link that connect another device. */
export function openConnectAnother(app) {
  const base = `${location.origin}${location.pathname}`;
  const link = app.sync.connectLink(base);
  openSheet('Connect another device', (body) => {
    const img = h('img', { class: 'qr', alt: 'QR code to connect another device', width: 240, height: 240 });
    body.append(
      h('p', { class: 'section-note' }, 'On the other phone or tablet, open the camera and scan this code, then open the link in Chrome.'),
      h('div', { class: 'qr-wrap' }, img),
      h('div', { class: 'btn-row', style: { justifyContent: 'center', margin: '10px 0' } },
        h('button', {
          type: 'button',
          class: 'btn btn-small',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(link);
              toast('Link copied');
            } catch {
              toast('Could not copy. Use the QR code instead.');
            }
          },
        }, 'Copy link'),
        navigator.share ? h('button', {
          type: 'button',
          class: 'btn btn-small',
          onclick: () => navigator.share({ title: 'Household Budget', url: link }).catch(() => {}),
        }, 'Share…') : null),
      h('p', { class: 'small muted' }, '⚠ Anyone with this code or link can see and change your budget. Only show it to your household.'));
    import('../../vendor/qrcode-generator/qrcode.mjs')
      .then(({ qrcode }) => {
        const qr = qrcode(0, 'L');
        qr.addData(link);
        qr.make();
        img.src = qr.createDataURL(6, 3);
      })
      .catch(() => { img.alt = 'The QR code could not be drawn. Use Copy link instead.'; });
  });
}

/** Opened from a #connect= link: join this device to the household Sheet. */
export function openJoin(app, code) {
  const target = decodeConnect(code, location.hostname);
  if (!target) {
    toast('That connect link is not valid. Ask for a new QR code.');
    return;
  }
  openSheet('Join your household budget', (body, close) => {
    const name = textInput({ value: app.store.device.get().userName ?? '', maxlength: 40, placeholder: 'e.g. Alex' });
    const local = hasLocalData(app);
    const mode = segmented('join-mode', [['merge', 'Keep this device\'s entries and add them'], ['replace', 'Replace with the shared data']], 'merge');
    mode.el.style.gridTemplateColumns = '1fr';
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Connect this device');
    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        clearErrors(form);
        if (!name.value.trim()) {
          showError(name, 'Enter a name.');
          return;
        }
        app.store.device.set({ userName: name.value.trim() });
        submit.disabled = true;
        submit.textContent = 'Connecting…';
        const r = await app.sync.connect({ ...target, mode: local ? mode.value() : 'merge' });
        submit.disabled = false;
        submit.textContent = 'Connect this device';
        if (!r.ok) {
          showError(name, syncErrorText(r.error));
          return;
        }
        close();
        toast('Connected. Your household budget is on this device now.');
      },
    },
    h('p', { class: 'section-note' }, 'This device will share the same budget as your other devices, through your Google Sheet.'),
    field('Your name on this device', name, { hint: 'Shown next to the items you log.' }),
    local ? field('This device already has entries', mode.el) : null,
    submit);
    body.append(form);
  });
}

function setting(name, value, ...buttons) {
  return h('div', { class: 'setting' },
    h('div', { class: 'setting-text' }, h('div', { class: 'setting-name' }, name), h('div', { class: 'setting-value' }, value)),
    buttons.length ? h('div', { class: 'btn-row', style: { justifyContent: 'flex-end' } }, buttons) : null);
}

const btn = (label, onclick, extra = '') => h('button', { type: 'button', class: `btn btn-small ${extra}`, onclick }, label);

/** The Sync rows in Settings. */
export function syncRows(app) {
  if (!app.sync) {
    return [setting('Sync with Google Sheet', app.demo ? 'Not available in the demo.' : 'Not available.')];
  }
  const s = app.sync.status();
  if (!s.connected) {
    return [setting('Sync with Google Sheet', 'Off. This device keeps its own copy. Connect to share the budget with your other devices.',
      btn('Connect', () => openConnect(app)))];
  }
  const rows = [
    setting('Sync with Google Sheet', `${s.text} · last synced ${minutesAgo(app, s.lastSyncAt)}`,
      s.needsReconnect ? btn('Reconnect', () => openConnect(app)) : btn('Sync now', () => app.sync.syncOnce())),
    setting('Connect another device', 'Show a QR code for your phone, tablet or a family member\'s phone.',
      btn('Show code', () => openConnectAnother(app))),
  ];
  if (s.lastError && !s.needsReconnect) rows.push(setting('Last problem', syncErrorText(s.lastError)));
  if (s.needsReconnect) rows.push(setting('Why', syncErrorText(s.lastError)));
  if (s.problems.length) {
    rows.push(setting('Entries the Sheet refused', s.problems.slice(-3).map((p) => `${p.id ?? '?'}: ${p.reason}`).join(' · ')));
  }
  rows.push(setting('Fix sync problems', 'Download everything again from the Sheet, or send this device\'s copy again.',
    btn('Reload', async () => {
      const r = await app.sync.resetFromSheet();
      toast(r.ok ? 'Reloaded from the Sheet' : syncErrorText(r.error));
    }),
    btn('Resend', () => {
      app.sync.reuploadAll();
      toast('Sending everything again');
    })));
  rows.push(setting('Stop syncing on this device', 'Entries stay on this device and in the Sheet.',
    btn('Disconnect', () => {
      app.sync.disconnect();
      toast('This device no longer syncs');
    }, 'btn-danger')));
  return rows;
}

export function renderSyncRows(container, app) {
  fill(container, syncRows(app));
}
