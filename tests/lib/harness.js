'use strict';
// Loads the app script from src/app.html into a Node `vm` context with a minimal fake browser,
// so the pure functions (geodesy, geometry, stats, documents, exports, storage) can be called directly.
// The app is one IIFE; we strip the wrapper so its top-level `function`/`const`/`let` bindings live in the
// context's script scope and later `app.run('expr')` calls can read and assign them (e.g. `S`, `TODAY`).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeDom } = require('./fake-dom');
const { makeLocalStorage } = require('./fake-storage');
const { makeIndexedDB } = require('./fake-idb');

const ROOT = path.resolve(__dirname, '..', '..');
// TK_APP: test another build of the page (used while a change is assembled from parts)
const APP_HTML = process.env.TK_APP ? path.resolve(process.env.TK_APP) : path.join(ROOT, 'src', 'app.html');

function appSource(file) {
  const html = fs.readFileSync(file || APP_HTML, 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const main = blocks.find(b => /\(function\(\)\{/.test(b));
  if (!main) throw new Error('app script block not found in ' + (file || APP_HTML));
  const start = main.indexOf('(function(){');
  const end = main.lastIndexOf('})();');
  if (start < 0 || end < 0) throw new Error('IIFE wrapper not found');
  return main.slice(start + '(function(){'.length, end);
}

// A Date whose "now" is controlled by the test. new Date(args) behaves normally.
function makeClock(startMs) {
  const RealDate = Date;
  const clock = { now: startMs };
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
    static now() { return clock.now; }
  }
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  clock.Date = FakeDate;
  clock.set = v => { clock.now = typeof v === 'number' ? v : new RealDate(v).getTime(); };
  clock.advance = ms => { clock.now += ms; };
  return clock;
}

const tick = () => new Promise(r => setImmediate(r));

// Errors thrown inside the app's own promise chains (e.g. go() inside loadState().then) would otherwise
// crash the test process. Collect them; each app exposes the ones raised while it was the current app.
const unhandled = [];
process.on('unhandledRejection', e => unhandled.push(e));

/**
 * loadApp(opts) -> Promise<app>
 * opts.now        ISO string / ms for the fake clock (local time, TZ is pinned by run.js)
 * opts.storage    shared fake localStorage (pass the same one to simulate a reload)
 * opts.idb        shared fake indexedDB, or false for "no IndexedDB in this browser"
 * opts.lsThrows   localStorage throws on every access (blocked storage)
 * opts.file       alternative html file (used to generate old-version fixtures)
 */
async function loadApp(opts = {}) {
  const clock = makeClock(opts.now != null ? new Date(opts.now).getTime() : Date.now());
  const dom = makeDom();
  const storage = opts.storage || makeLocalStorage();
  storage.throws = !!opts.lsThrows;
  const idb = opts.idb === undefined ? null : opts.idb; // default: no IndexedDB
  const timers = [];
  const blobs = []; // every Blob passed to URL.createObjectURL (the backup download lands here)
  const windowListeners = {};
  const sandbox = {
    console,
    Date: clock.Date,
    document: dom.document,
    localStorage: storage,
    indexedDB: idb || undefined,
    navigator: { onLine: true, storage: undefined, clipboard: { writeText: () => Promise.reject(new Error('no clipboard')) } },
    location: { hash: opts.hash || '' },
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: (ev, fn) => { (windowListeners[ev] = windowListeners[ev] || []).push(fn); },
    URL: { createObjectURL: b => { blobs.push(b); return 'blob:fake/' + blobs.length; }, revokeObjectURL: () => {} },
    Blob, atob, btoa, TextEncoder, TextDecoder, structuredClone,
    FileReader: class { readAsDataURL(b) { b.arrayBuffer().then(ab => { this.result = 'data:' + (b.type || 'application/octet-stream') + ';base64,' + Buffer.from(ab).toString('base64'); this.onload && this.onload(); }); } },
    Image: class {},
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  const ctx = vm.createContext(sandbox);
  const errStart = unhandled.length;
  const src = appSource(opts.file);
  vm.runInContext(src, ctx, { filename: 'src/app.html' });
  // wait for loadState() to settle and the first render
  for (let i = 0; i < 200; i++) {
    await tick();
    if (vm.runInContext('S!==null', ctx)) break;
  }
  await tick();
  const run = code => vm.runInContext(code, ctx);
  const app = {
    ctx, run, dom, clock, storage, idb, timers, blobs,
    get: name => run(name),
    // JSON copy into this realm (vm objects have foreign prototypes, so deepStrictEqual needs this)
    json: expr => JSON.parse(JSON.stringify(run(expr))),
    el: sel => dom.document.querySelector(sel),
    html: sel => dom.document.querySelector(sel).innerHTML,
    click: (act, data = {}, extra = {}) => dom.click(act, data, extra),
    settle: async (n = 20) => { for (let i = 0; i < n; i++) await tick(); },
    flushTimers: () => { const t = timers.splice(0); t.forEach(x => { try { x.fn(); } catch (e) {} }); },
    toastText: () => dom.document.querySelector('#toast').textContent,
    windowListeners,
    // unhandled promise rejections raised since this app was loaded (start-up crash, failed restore, ...)
    get errors() { return unhandled.slice(errStart); },
  };
  return app;
}

module.exports = { loadApp, appSource, makeClock, makeLocalStorage, makeIndexedDB, ROOT, APP_HTML, tick };
