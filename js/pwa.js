// Install and offline support: the service worker, the "new version" bar,
// the Install button, and asking the browser to keep this app's data.
import { h } from './ui/dom.js';

export function initPwa(app) {
  const state = { installPrompt: null, version: null, persisted: null, active: false };
  app.pwa = state;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    app.refresh();
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    keepData();
    app.refresh();
  });
  keepData();

  if (!('serviceWorker' in navigator)) return state;
  // While developing on this PC, skip offline caching unless asked for (?sw=1).
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && !new URLSearchParams(location.search).has('sw')) return state;
  state.active = true;

  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install: nothing to reload
    reloading = true;
    location.reload();
  });

  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then((reg) => {
    const offer = (worker) => showUpdateBar(() => worker.postMessage('SKIP_WAITING'));
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - lastCheck > 30 * 60_000) {
        lastCheck = Date.now();
        reg.update().catch(() => {});
      }
    });
  }).catch(() => {});

  navigator.serviceWorker.ready.then((reg) => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => resolve(e.data);
    (navigator.serviceWorker.controller ?? reg.active)?.postMessage('GET_VERSION', [channel.port2]);
  })).then((version) => {
    state.version = version;
    app.refresh();
  }).catch(() => {});

  return state;

  async function keepData() {
    try {
      state.persisted = (await navigator.storage?.persist?.()) ?? null;
    } catch {
      state.persisted = null;
    }
  }
}

function showUpdateBar(apply) {
  if (document.getElementById('update-bar')) return;
  document.body.append(h('div', { id: 'update-bar', class: 'update-bar', role: 'status' },
    h('span', {}, 'A new version is ready.'),
    h('button', { type: 'button', class: 'btn btn-small', onclick: apply }, 'Update now')));
}

export async function installApp(app) {
  const prompt = app.pwa?.installPrompt;
  if (!prompt) return false;
  prompt.prompt();
  const choice = await prompt.userChoice.catch(() => null);
  app.pwa.installPrompt = null;
  app.refresh();
  return choice?.outcome === 'accepted';
}
