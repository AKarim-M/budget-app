// A localStorage stand-in for tests.
export function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    keys: () => [...m.keys()],
  };
}

/** A clock that only moves when told to (milliseconds). */
export function fixedClock(iso = '2026-10-15T01:00:00.000Z') {
  let t = Date.parse(iso);
  const now = () => t;
  now.set = (next) => { t = Date.parse(next); };
  return now;
}
