/**
 * Budget sync: your Google Sheet keeps the shared copy of the household budget app.
 *
 * Setup (once): Extensions → Apps Script, paste this whole file, Save, run setup().
 * Then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Step-by-step guide: docs/sync-setup.md in the app's repository.
 *
 * Every request must carry the sync code (kept in this script's properties, never in the
 * app's code). Each record is one row on the "Records" tab; the last column holds the record
 * itself. The other columns are for reading.
 */

var PROTOCOL = 1;
var TAB = 'Records';
var VIEW_TAB = 'Expenses';
var HEADER = ['Date', 'Type', 'Who', 'Amount', 'Label', 'Note', 'Deleted', 'Updated (UTC)', 'Rev', 'ID', 'Data'];
var COLS = HEADER.length;
var PAGE = 500;
var MAX_CHANGES = 500;
var MAX_BODY = 2000000;
var MAX_JSON = 20000;
var TYPES = ['settings', 'category', 'spend', 'planned', 'cardPayment', 'payday', 'bill', 'bankCheck'];
var ID_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;
var TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------- setup and menu ----------

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  if (!props.getProperty('SERVER_ID')) props.setProperty('SERVER_ID', Utilities.getUuid());
  if (!props.getProperty('REV')) props.setProperty('REV', '0');
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', newSecret_());

  var sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
  sh.getRange(1, 1, 1, COLS).setValues([HEADER]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var rows = sh.getMaxRows() - 1;
  var textCols = [1, 2, 3, 5, 6, 8, 10, 11];
  for (var i = 0; i < textCols.length; i++) sh.getRange(2, textCols[i], rows, 1).setNumberFormat('@');
  sh.getRange(2, 4, rows, 1).setNumberFormat('#,##0.00');
  sh.protect().setWarningOnly(true);

  var view = ss.getSheetByName(VIEW_TAB) || ss.insertSheet(VIEW_TAB);
  view.getRange('A1').setFormula(
    '=QUERY(Records!A:G, "select A, C, D, E, F where B = \'spend\' and G = false order by A desc", 1)');

  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 2) ss.deleteSheet(blank);

  console.log('Sync code: ' + props.getProperty('SECRET'));
  console.log('Next: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Budget sync')
    .addItem('Show sync code', 'showSecret')
    .addItem('Make a new sync code', 'rotateSecret')
    .addToUi();
}

function showSecret() {
  var ui = SpreadsheetApp.getUi();
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  ui.alert('Sync code', secret || 'Run setup first.', ui.ButtonSet.OK);
}

function rotateSecret() {
  var ui = SpreadsheetApp.getUi();
  var secret = newSecret_();
  PropertiesService.getScriptProperties().setProperty('SECRET', secret);
  ui.alert('New sync code', secret + '\n\nThe old code stops working now. Reconnect each device with this one.', ui.ButtonSet.OK);
}

function newSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

// ---------- web app ----------

function doGet() {
  return json_({ ok: true, app: 'budget-sync', protocol: PROTOCOL });
}

function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents) || '';
    if (body.length > MAX_BODY) return json_({ ok: false, error: 'too_large' });
    var req;
    try {
      req = JSON.parse(body);
    } catch (err) {
      return json_({ ok: false, error: 'bad_request' });
    }
    var props = PropertiesService.getScriptProperties();
    var p = props.getProperties();
    if (!p.SECRET || !p.SHEET_ID) return json_({ ok: false, error: 'not_setup' });
    if (!req || !safeEqual_(String(req.secret || ''), p.SECRET)) return json_({ ok: false, error: 'auth' });
    if (req.v !== PROTOCOL) return json_({ ok: false, error: 'upgrade' });
    if (!Array.isArray(req.changes) || req.changes.length > MAX_CHANGES || !(Number(req.since) >= 0)) {
      return json_({ ok: false, error: 'bad_request' });
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy' });
    try {
      var sh = SpreadsheetApp.openById(p.SHEET_ID).getSheetByName(TAB);
      if (!sh) return json_({ ok: false, error: 'not_setup' });
      var n = sh.getLastRow() - 1;
      var rows = n > 0 ? sh.getRange(2, 1, n, COLS).getValues() : [];
      var rev0 = Math.max(Number(props.getProperty('REV') || 0), maxRev_(rows));
      var res = handleSync_(req, rows, rev0, new Date().toISOString(), p.SERVER_ID);
      // Reserve the new revs before writing: a crash can leave a gap, never a reused rev.
      if (res.newRev > rev0) props.setProperty('REV', String(res.newRev));
      for (var i = 0; i < res.updated.length; i++) {
        sh.getRange(res.updated[i].row, 1, 1, COLS).setValues([res.updated[i].values]);
      }
      if (res.appended.length) sh.getRange(Math.max(n, 0) + 2, 1, res.appended.length, COLS).setValues(res.appended);
      SpreadsheetApp.flush();
      return json_(res.out);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: 'server', message: String((err && err.message) || err).slice(0, 200) });
  }
}

// ---------- sync logic (no Google services: tested in Node) ----------

function handleSync_(req, rows, rev0, nowIso, serverId) {
  var index = {};
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][9] || '');
    var stored = parseData_(rows[i][10]);
    if (!id || !stored) continue;
    index[id] = { row: i, app: -1, rec: stored, rev: Number(rows[i][8]) || 0 };
  }

  var rev = rev0;
  var updated = {};
  var appended = [];
  var rejected = [];
  var winners = {};

  for (var k = 0; k < req.changes.length; k++) {
    var raw = req.changes[k];
    var reason = invalid_(raw);
    if (reason) {
      rejected.push({ id: raw && typeof raw.id === 'string' ? raw.id.slice(0, 64) : null, reason: reason });
      continue;
    }
    var rec = stripSync_(raw);
    var cur = index[rec.id];
    if (cur) {
      var c = cmpRec_(rec, cur.rec);
      if (c < 0) winners[rec.id] = true;
      if (c <= 0) continue;
    }
    rev += 1;
    var values = rowValues_(rec, raw._view, rev);
    if (cur && cur.row >= 0) {
      updated[cur.row] = values;
      index[rec.id] = { row: cur.row, app: -1, rec: rec, rev: rev };
    } else if (cur && cur.app >= 0) {
      appended[cur.app] = values;
      index[rec.id] = { row: -1, app: cur.app, rec: rec, rev: rev };
    } else {
      appended.push(values);
      index[rec.id] = { row: -1, app: appended.length - 1, rec: rec, rev: rev };
    }
  }

  var since = Number(req.since) || 0;
  var newer = [];
  for (var key in index) if (index[key].rev > since) newer.push(index[key]);
  newer.sort(function (a, b) { return a.rev - b.rev; });
  var page = newer.slice(0, PAGE);
  var more = newer.length > PAGE;
  var changes = page.map(function (e) { return withRev_(e.rec, e.rev); });
  var inPage = {};
  page.forEach(function (e) { inPage[e.rec.id] = true; });
  for (var w in winners) {
    if (!inPage[w]) changes.push(withRev_(index[w].rec, index[w].rev));
  }

  var updatedList = [];
  for (var r in updated) updatedList.push({ row: Number(r) + 2, values: updated[r] });

  return {
    out: {
      ok: true,
      protocol: PROTOCOL,
      serverId: serverId,
      rev: more ? page[page.length - 1].rev : rev,
      more: more,
      serverTime: nowIso,
      changes: changes,
      rejected: rejected,
    },
    updated: updatedList,
    appended: appended,
    newRev: rev,
  };
}

function invalid_(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'not an object';
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return 'bad id';
  if (TYPES.indexOf(r.type) < 0) return 'bad type';
  if (r.type === 'settings' && r.id !== 'settings') return 'settings id';
  if (typeof r.createdAt !== 'string' || !TS_RE.test(r.createdAt)) return 'bad createdAt';
  if (typeof r.updatedAt !== 'string' || !TS_RE.test(r.updatedAt)) return 'bad updatedAt';
  if (typeof r.deleted !== 'boolean') return 'bad deleted';
  if (JSON.stringify(stripSync_(r)).length > MAX_JSON) return 'too large';
  return null;
}

function rowValues_(rec, view, rev) {
  var v = view && typeof view === 'object' ? view : {};
  var amount = typeof v.amount === 'number' && isFinite(v.amount) && Math.abs(v.amount) < 1e10 ? v.amount : '';
  return [
    safeText_(v.date || rec.date || ''),
    rec.type,
    safeText_(rec.by || ''),
    amount,
    safeText_(v.label || ''),
    safeText_(v.note || ''),
    Boolean(rec.deleted),
    rec.updatedAt,
    rev,
    rec.id,
    JSON.stringify(rec),
  ];
}

/** Text that starts like a formula (= + - @) is stored as plain text. */
function safeText_(s) {
  var t = String(s).slice(0, 200);
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}

function parseData_(cell) {
  try {
    var r = JSON.parse(String(cell));
    return r && typeof r === 'object' && typeof r.id === 'string' ? r : null;
  } catch (err) {
    return null;
  }
}

function maxRev_(rows) {
  var m = 0;
  for (var i = 0; i < rows.length; i++) m = Math.max(m, Number(rows[i][8]) || 0);
  return m;
}

function withRev_(rec, rev) {
  var out = stripSync_(rec);
  out.rev = rev;
  return out;
}

function stripSync_(r) {
  var out = {};
  Object.keys(r).forEach(function (k) {
    if (k !== 'rev' && k !== '_view') out[k] = r[k];
  });
  return out;
}

// Same rules as the app's js/lww.js (checked by shared test vectors).
function canonValue_(v) {
  if (Array.isArray(v)) return v.map(canonValue_);
  if (v && typeof v === 'object') {
    var out = {};
    Object.keys(v).sort().forEach(function (k) { out[k] = canonValue_(v[k]); });
    return out;
  }
  return v;
}

function canon_(rec) {
  return JSON.stringify(canonValue_(stripSync_(rec)));
}

function cmpRec_(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
  if (Boolean(a.deleted) !== Boolean(b.deleted)) return a.deleted ? 1 : -1;
  var ca = canon_(a);
  var cb = canon_(b);
  if (ca === cb) return 0;
  return ca > cb ? 1 : -1;
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
