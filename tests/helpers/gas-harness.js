// Runs apps-script/Code.gs in Node with in-memory stand-ins for the Google services it uses
// (Sheets, script properties, the script lock, ContentService, Utilities).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

function fakeSheet(name, harness) {
  const rows = [];
  const sheet = {
    rows,
    formats: [],
    formulas: {},
    frozen: 0,
    getName: () => name,
    getLastRow: () => rows.length,
    getMaxRows: () => Math.max(1000, rows.length),
    setFrozenRows(n) { sheet.frozen = n; },
    setColumnWidth() { return sheet; },
    protect() { return { setWarningOnly() { return this; }, setDescription() { return this; } }; },
    getRange(a, b, c, d) {
      let row = a;
      let col = b ?? 1;
      let numRows = c ?? 1;
      let numCols = d ?? 1;
      if (typeof a === 'string') {
        const m = /^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(a);
        const colOf = (s) => s.split('').reduce((t, ch) => t * 26 + ch.charCodeAt(0) - 64, 0);
        col = colOf(m[1]);
        row = m[2] ? Number(m[2]) : 1;
        numCols = m[3] ? colOf(m[3]) - col + 1 : 1;
        numRows = m[4] ? Number(m[4]) - row + 1 : (m[2] ? 1 : 1000);
      }
      const range = {
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r += 1) {
            const src = rows[row - 1 + r] ?? [];
            const line = [];
            for (let k = 0; k < numCols; k += 1) line.push(src[col - 1 + k] ?? '');
            out.push(line);
          }
          return out;
        },
        setValues(values) {
          if (harness.failWrites) throw new Error('simulated write failure');
          values.forEach((line, r) => {
            while (rows.length < row + r) rows.push([]);
            const target = rows[row - 1 + r];
            line.forEach((v, k) => { target[col - 1 + k] = v; });
          });
          return range;
        },
        setNumberFormat(f) { sheet.formats.push([col, f]); return range; },
        setFontWeight() { return range; },
        setFormula(f) { sheet.formulas[`${row},${col}`] = f; return range; },
      };
      return range;
    },
  };
  return sheet;
}

export function createHarness() {
  const harness = { busy: false, failWrites: false, logs: [] };
  const props = new Map();
  const sheets = new Map([['Sheet1', fakeSheet('Sheet1', harness)]]);
  const ss = {
    getId: () => 'sheet-id-123',
    getSheetByName: (n) => sheets.get(n) ?? null,
    insertSheet: (n) => {
      const s = fakeSheet(n, harness);
      sheets.set(n, s);
      return s;
    },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => sheets.delete(s.getName()),
  };
  const ui = {
    alert() {},
    createMenu() {
      const menu = { addItem: () => menu, addToUi() {} };
      return menu;
    },
    ButtonSet: { OK: 'OK' },
  };
  const ctx = vm.createContext({
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => Object.fromEntries(props),
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => !harness.busy, releaseLock() {} }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: (id) => {
        if (id !== ss.getId()) throw new Error('No such spreadsheet');
        return ss;
      },
      flush() {},
      getUi: () => ui,
    },
    ContentService: {
      createTextOutput(text) {
        const out = { text, setMimeType() { return out; }, getContent: () => text };
        return out;
      },
      MimeType: { JSON: 'JSON' },
    },
    Utilities: { getUuid: () => randomUUID() },
    console: { log: (...a) => harness.logs.push(a.join(' ')) },
  });
  vm.runInContext(readFileSync('apps-script/Code.gs', 'utf8'), ctx, { filename: 'Code.gs' });

  return Object.assign(harness, {
    ctx,
    props,
    ss,
    sheet: (n) => sheets.get(n),
    setup: () => ctx.setup(),
    secret: () => props.get('SECRET'),
    get: () => JSON.parse(ctx.doGet({}).getContent()),
    post: (body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()),
    records: () => sheets.get('Records').rows.slice(1),
  });
}
