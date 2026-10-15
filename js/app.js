// App start-up: storage, the snapshot, routing between tabs, theme, and day changes.
//   ?demo=1      try the app with made-up data (nothing saved)
//   ?demo=empty  start from the setup wizard (nothing saved)
//   ?today=YYYY-MM-DD  show the app as if it were that day (testing)

import { createStore } from './store.js';
import { compute } from './engine.js';
import { todayLocal, isYMD } from './dates.js';
import { renderGlance } from './ui/glance.js';
import { mountHome } from './ui/home.js';
import { mountPlan } from './ui/plan.js';
import { mountSpending } from './ui/spending.js';
import { mountSettings } from './ui/settings.js';
import { renderWizard } from './ui/wizard.js';
import { initSheet } from './ui/overlay.js';
import { openBreakdown, openBankCheck } from './ui/actions.js';
import { longDate } from './ui/format.js';
import { initPwa } from './pwa.js';

const ROUTES = ['home', 'plan', 'spending', 'settings'];
const STORAGE_KEYS = ['hb1.db', 'hb1.device', 'hb1.sync'];
const params = new URLSearchParams(location.search);
const demo = params.get('demo');
const forcedToday = isYMD(params.get('today')) ? params.get('today') : null;
const byId = (id) => document.getElementById(id);

function throwawayStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

async function main() {
  const store = createStore({ storage: demo ? throwawayStorage() : window.localStorage });
  if (demo === '1') (await import('./demo.js')).seedDemo(store);

  const app = {
    store,
    snap: null,
    demo: Boolean(demo),
    today: () => forcedToday ?? todayLocal(),
    refresh,
    applyTheme,
    resetDevice() {
      if (!demo) for (const k of STORAGE_KEYS) window.localStorage.removeItem(k);
      location.reload();
    },
  };

  initSheet();
  showBanner();
  applyTheme();
  initPwa(app);

  const views = {
    home: mountHome(byId('tab-home'), app),
    plan: mountPlan(byId('tab-plan'), app),
    spending: mountSpending(byId('tab-spending'), app),
    settings: mountSettings(byId('tab-settings'), app),
  };

  store.subscribe((e) => {
    if (e.origin === 'device') applyTheme();
    refresh();
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('storage', (e) => {
    if (!demo && e.key === 'hb1.db') store.reloadFromStorage();
  });
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target || !app.snap || app.snap.needsSetup) return;
    if (target.dataset.action === 'breakdown') openBreakdown(app);
    if (target.dataset.action === 'bank-check') openBankCheck(app);
  });
  let lastDay = app.today();
  const checkDay = () => {
    if (app.today() !== lastDay) {
      lastDay = app.today();
      refresh();
    }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
  setInterval(checkDay, 60_000);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

  refresh();
  route();

  function refresh() {
    app.snap = compute(store.all(), { today: app.today() });
    const wizard = byId('wizard');
    if (app.snap.needsSetup) {
      if (wizard.hidden) {
        for (const r of ROUTES) byId(`tab-${r}`).hidden = true;
        byId('glance').hidden = true;
        byId('tabbar').hidden = true;
        document.body.classList.add('no-tabs');
        wizard.hidden = false;
        renderWizard(wizard, app);
      }
      return;
    }
    if (!wizard.hidden) {
      wizard.hidden = true;
      wizard.replaceChildren();
      byId('glance').hidden = false;
      byId('tabbar').hidden = false;
      document.body.classList.remove('no-tabs');
      route();
    }
    renderGlance(byId('glance'), app.snap, app);
    for (const view of Object.values(views)) view.update(app.snap);
  }

  function route() {
    if (!byId('wizard').hidden) return;
    const wanted = location.hash.slice(1);
    const current = ROUTES.includes(wanted) ? wanted : 'home';
    for (const r of ROUTES) {
      byId(`tab-${r}`).hidden = r !== current;
      const link = document.querySelector(`[data-route="${r}"]`);
      if (r === current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  function applyTheme() {
    const pref = store.device.get().theme ?? 'auto';
    const dark = pref === 'dim' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dim' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#181a18' : '#2d6a4f');
  }

  function showBanner() {
    const parts = [];
    if (demo) parts.push('Demo: made-up data, nothing is saved.');
    if (forcedToday) parts.push(`Showing the app as if today were ${longDate(forcedToday)}.`);
    const el = byId('banner');
    el.textContent = parts.join(' ');
    el.hidden = parts.length === 0;
  }
}

main();
