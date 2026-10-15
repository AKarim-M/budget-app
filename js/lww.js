// Last-writer-wins rules shared by every device and the Apps Script server
// (apps-script/Code.gs mirrors cmpRec exactly, checked by shared test vectors).

function canonValue(v) {
  if (Array.isArray(v)) return v.map(canonValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonValue(v[k]);
    return out;
  }
  return v;
}

/** Stable JSON: keys sorted at every level; sync-only fields (rev, _view) left out. */
export function canon(rec) {
  const { rev, _view, ...rest } = rec;
  return JSON.stringify(canonValue(rest));
}

/** > 0 when a should win over b. Newer updatedAt, then deletion, then canonical JSON. */
export function cmpRec(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
  if (Boolean(a.deleted) !== Boolean(b.deleted)) return a.deleted ? 1 : -1;
  const ca = canon(a);
  const cb = canon(b);
  if (ca === cb) return 0;
  return ca > cb ? 1 : -1;
}

export function pickWinner(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  return cmpRec(remote, local) > 0 ? remote : local;
}

/** An edit's timestamp: now, but always at least 1 ms after the version it replaces. */
export function nextUpdatedAt(nowMs, prevIso) {
  const prev = prevIso ? Date.parse(prevIso) : -Infinity;
  return new Date(Math.max(nowMs, prev + 1)).toISOString();
}
