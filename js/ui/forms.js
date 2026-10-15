// Form building blocks with inline error messages.
import { h } from './dom.js';
import { parseMoney } from '../money.js';

export const MONEY_ERRORS = {
  empty: 'Enter an amount.',
  invalid: 'Use numbers like 1,250.50',
  too_many_decimals: 'Use at most 2 decimals.',
  negative: 'The amount must be positive.',
  zero: 'The amount must be more than ₱0.',
  too_large: 'That amount is too large.',
};

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

export function field(label, control, { hint } = {}) {
  if (!control.id) control.id = nextId('f');
  return h('div', { class: 'field' },
    h('label', { class: 'field-label', for: control.id }, label),
    control,
    hint ? h('span', { class: 'hint' }, hint) : null);
}

export const textInput = (attrs = {}) => h('input', { type: 'text', autocomplete: 'off', ...attrs });
export const dateInput = (attrs = {}) => h('input', { type: 'date', ...attrs });
export const moneyInput = (attrs = {}) => h('input', {
  type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '₱ 0.00', ...attrs,
});

export function select(options, value, attrs = {}) {
  return h('select', attrs, options.map(([v, label]) => h('option', { value: String(v), selected: String(v) === String(value) }, label)));
}

/** Radio-button segmented control. options: [[value, label, className]] */
export function segmented(name, options, value, onChange) {
  const groupName = nextId(name);
  const el = h('div', { class: 'seg', role: 'radiogroup' },
    options.map(([v, label, cls]) => h('label', { class: cls ?? 'plain-opt' },
      h('input', {
        type: 'radio',
        name: groupName,
        value: v,
        checked: v === value,
        onchange: () => onChange?.(v),
      }),
      label)));
  return {
    el,
    value: () => el.querySelector('input:checked')?.value ?? value,
    set: (v) => { for (const i of el.querySelectorAll('input')) i.checked = i.value === v; },
  };
}

export function showError(input, message) {
  clearError(input);
  input.setAttribute('aria-invalid', 'true');
  const err = h('span', { class: 'error', role: 'alert' }, message);
  (input.closest('.field') ?? input.parentElement).append(err);
  input.focus();
}

export function clearError(input) {
  input.removeAttribute('aria-invalid');
  input.closest('.field')?.querySelector('.error')?.remove();
}

export function clearErrors(form) {
  for (const i of form.querySelectorAll('[aria-invalid]')) clearError(i);
}

/** Reads a money field; shows the error next to it and returns {ok:false} when invalid. */
export function readMoney(input, opts) {
  const r = parseMoney(input.value, opts);
  if (!r.ok) showError(input, MONEY_ERRORS[r.error] ?? 'Check this amount.');
  else clearError(input);
  return r;
}

/** Optional money field: empty means null. */
export function readOptionalMoney(input, opts) {
  if (!input.value.trim()) {
    clearError(input);
    return { ok: true, cents: null };
  }
  return readMoney(input, opts);
}
