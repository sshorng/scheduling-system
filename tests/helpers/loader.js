/**
 * 測試載入器：把前端原始碼載入 vm 沙箱，讓測試直接呼叫真正的函式，
 * 不再用 indexOf('function xxx') 從原始碼字串裡切片。
 *
 * 好處：重構（改名、搬位、抽模組）不會讓測試靜默失效。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

/** 讀取檔案並統一換行符號，避免 CRLF/LF 造成比對失敗。 */
function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

/** 建立一個行為寬容的假 DOM 元素，足以應付程式碼對 DOM 的存取。 */
function makeElement(id) {
  const el = {
    id,
    style: new Proxy({}, { get: () => '', set: () => true }),
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    value: '',
    textContent: '',
    innerHTML: '',
    checked: false,
    disabled: false,
    hidden: false,
    children: [],
    childNodes: [],
    options: [],
    rows: [],
    files: [],
    appendChild() { return el; },
    removeChild() { return el; },
    append() {},
    remove() {},
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    querySelector() { return makeElement('sub'); },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    blur() {},
    click() {},
    insertAdjacentHTML() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 0,
    clientHeight: 0,
    offsetHeight: 0,
    offsetWidth: 0,
    parentNode: null,
    parentElement: null,
    nextSibling: null,
    getContext: () => null
  };
  el.parentNode = el;
  el.parentElement = el;
  return el;
}

/** 建立一份 document 與 element 快取，重複 getElementById 回傳同一個元素。 */
function makeDocument() {
  const cache = new Map();
  return {
    getElementById(id) {
      if (!cache.has(id)) cache.set(id, makeElement(id));
      return cache.get(id);
    },
    querySelector() { return makeElement('query-selector'); },
    querySelectorAll() { return []; },
    createElement() { return makeElement('created'); },
    createDocumentFragment() { return makeElement('fragment'); },
    createTextNode: () => makeElement('text'),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    body: makeElement('body'),
    documentElement: makeElement('html'),
    readyState: 'complete',
    activeElement: null,
    elements: cache
  };
}

/** 建立記憶體版的 storage。 */
function makeStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    clear: () => map.clear(),
    get length() { return map.size; },
    key: index => Array.from(map.keys())[index] ?? null,
    _map: map
  };
}

/**
 * 建立沙箱。options 可覆寫預設的全域物件（例如注入假的 GAS 回應）。
 * 回傳的 context 具備 document / window / localStorage 等環境，
 * 並在 loadSource 之後可直接存取全域函式。
 */
function createSandbox(options = {}) {
  const document = options.document || makeDocument();
  const localStorage = options.localStorage || makeStorage();
  const sessionStorage = options.sessionStorage || makeStorage();

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    Promise,
    JSON,
    Math,
    Date,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
    atob: value => Buffer.from(String(value), 'base64').toString('binary'),
    document,
    localStorage,
    sessionStorage,
    navigator: { userAgent: 'node-tests', clipboard: {}, language: 'zh-TW' },
    location: { href: 'http://localhost/', hash: '', search: '', origin: 'http://localhost' },
    history: { replaceState() {}, pushState() {} },
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 1,
    scrollTo() {},
    alert() {},
    confirm: () => true,
    prompt: () => '',
    requestAnimationFrame: cb => setTimeout(cb, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    postMessage() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    FormData: function FormData() { this.append = () => {}; this.entries = () => []; this.get = () => null; },
    AbortController: function AbortController() { this.signal = {}; this.abort = () => {}; },
    Blob: function Blob() {},
    FileReader: function FileReader() { this.readAsArrayBuffer = () => {}; this.readAsText = () => {}; },
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL() {} },
    PizZip: function PizZip() {},
    saveAs() {},
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => ({})
    })
  };

  Object.assign(sandbox, options.globals || {});
  sandbox.window = sandbox.window || sandbox;
  sandbox.globalThis = sandbox.globalThis || sandbox;
  sandbox.self = sandbox.self || sandbox;
  vm.createContext(sandbox, { name: options.name || 'scheduling-system' });
  sandbox.$document = document;
  sandbox.$localStorage = localStorage;
  sandbox.$sessionStorage = sessionStorage;
  return sandbox;
}

/** 將一段原始碼注入沙箱執行。 */
function evaluate(sandbox, code, filename) {
  vm.runInContext(code, sandbox, { filename, timeout: options_timeout() });
}

function options_timeout() {
  return 30000;
}

/**
 * 載入整份 app.js。回傳沙箱本體，之後可直接呼叫 ctx.detectConflicts(...) 等。
 * 這是測試取得真實函式的正規途徑。
 */
function loadApp(options = {}) {
  const sandbox = createSandbox(options);
  const source = readSource('js/app.js');
  vm.runInContext(source, sandbox, { filename: 'app.js', timeout: 30000 });
  return sandbox;
}

/**
 * 載入 Code.gs（後端）。回傳沙箱，可直接呼叫後端函式。
 * Code.gs 頂層會用到 SpreadsheetApp / CacheService，因此提供最小可用替身。
 */
function loadBackend(options = {}) {
  const sandbox = createSandbox(options);
  sandbox.SpreadsheetApp = options.SpreadsheetApp || createSpreadsheetStub();
  sandbox.CacheService = options.CacheService || createCacheStub();
  sandbox.LockService = options.LockService || createLockStub();
  sandbox.PropertiesService = options.PropertiesService || createCacheStub();
  sandbox.Utilities = options.Utilities || {
    formatDate: date => String(date),
    sleep: () => {},
    base64Encode: value => Buffer.from(String(value)).toString('base64')
  };
  const source = readSource('Code.gs');
  vm.runInContext(source, sandbox, { filename: 'Code.gs', timeout: 30000 });
  return sandbox;
}

/** 最小試算表替身：足以支援 sheetToObjects_ 等讀寫流程。 */
function createSpreadsheetStub(initial = {}) {
  const makeSheet = (name, rows = []) => {
    const grid = rows.map(row => row.slice());
    return {
      getName: () => name,
      getLastRow: () => grid.length,
      getLastColumn: () => (grid[0] ? grid[0].length : 0),
      getRange: (row, col, numRows = 1, numCols = 1) => ({
        getValues: () => {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const line = [];
            for (let c = 0; c < numCols; c++) {
              line.push((grid[row + r] || [])[col + c] ?? '');
            }
            out.push(line);
          }
          return out;
        },
        getDisplayValues: () => {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const line = [];
            for (let c = 0; c < numCols; c++) {
              line.push(String((grid[row + r] || [])[col + c] ?? ''));
            }
            out.push(line);
          }
          return out;
        },
        setValues: values => {
          for (let r = 0; r < values.length; r++) {
            grid[row + r] = grid[row + r] ? grid[row + r].slice() : [];
            for (let c = 0; c < values[r].length; c++) grid[row + r][col + c] = values[r][c];
          }
          return this;
        },
        setValue: value => {
          grid[row] = grid[row] ? grid[row].slice() : [];
          grid[row][col] = value;
          return this;
        },
        clearContent: () => {
          for (let r = 0; r < numRows; r++) {
            grid[row + r] = [];
          }
          return this;
        },
        setFontWeight() { return this; },
        setBackground() { return this; },
        setNumberFormat() { return this; },
        setHorizontalAlignment() { return this; },
        setWrap() { return this; }
      }),
      getDataRange: () => ({
        getValues: () => grid.slice(),
        getDisplayValues: () => grid.map(row => row.map(String)),
        setValues: values => { grid.length = 0; values.forEach(row => grid.push(row.slice())); return this; }
      }),
      appendRow: row => { grid.push(row.slice()); return sheet; },
      deleteRow: index => { grid.splice(index - 1, 1); return sheet; },
      insertSheet: () => {},
      clearContents: () => { grid.length = 0; return sheet; },
      setFrozenRows() { return this; },
      autoResizeColumns() { return this; },
      _grid: grid
    };
  };

  const sheets = new Map();
  for (const [name, rows] of Object.entries(initial)) sheets.set(name, makeSheet(name, rows));
  return {
    getSheetByName: name => sheets.get(name) || null,
    getSheets: () => Array.from(sheets.values()),
    insertSheet: name => { const s = makeSheet(name, []); sheets.set(name, s); return s; },
    getActiveSheet: () => sheets.values().next().value || null,
    _sheets: sheets,
    _makeSheet: makeSheet
  };
}

/** CacheService 替身。 */
function createCacheStub(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: key => store.get(key) || null,
    put: (key, value, seconds) => { store.set(key, value); return true; },
    remove: key => { store.delete(key); },
    removeAll: keys => (keys || []).forEach(k => store.delete(k)),
    _store: store
  };
}

/** LockService 替身。 */
function createLockStub(acquired = true) {
  let held = false;
  return {
    getScriptLock: () => ({
      tryLock: () => { held = acquired; return acquired; },
      lock: () => { held = true; },
      releaseLock: () => { held = false; },
      hasLock: () => held
    }),
    getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }),
    getUserLock: () => ({ tryLock: () => true, releaseLock() {} })
  };
}

module.exports = {
  ROOT,
  readSource,
  makeElement,
  makeDocument,
  makeStorage,
  createSandbox,
  evaluate,
  loadApp,
  loadBackend,
  createSpreadsheetStub,
  createCacheStub,
  createLockStub
};