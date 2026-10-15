// The bottom sheet (a <dialog>) and the toast with an optional Undo.
import { h, fill } from './dom.js';

export function openSheet(title, build) {
  const dlg = document.getElementById('sheet');
  const close = () => { if (dlg.open) dlg.close(); };
  const body = h('div', { class: 'sheet-body' });
  fill(dlg,
    h('div', { class: 'sheet-head' },
      h('h2', { id: 'sheet-title' }, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
    body);
  build(body, close);
  if (!dlg.open) dlg.showModal();
  body.querySelector('input:not([type=checkbox]):not([type=radio]), select, textarea')?.focus();
}

export function initSheet() {
  const dlg = document.getElementById('sheet');
  // Tap outside the sheet to close it.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.replaceChildren());
}

let toastTimer = null;

export function toast(message, { action, onAction, ms = 5000 } = {}) {
  const el = document.getElementById('toast');
  const hide = () => { el.hidden = true; };
  fill(el,
    h('span', {}, message),
    action ? h('button', { type: 'button', class: 'toast-action', onclick: () => { hide(); onAction?.(); } }, action) : null);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, ms);
}
