'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('../lib/t');
const { loadApp, makeLocalStorage, makeIndexedDB } = require('../lib/harness');

const NOW = '2026-11-11T10:00:00';
const KEY = 'terenska-knjiga-v3';
const FIX = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', n), 'utf8'));
// _ll is a cache the app never saves; photo:null is dropped by normalize() on load (thumb/ph replace it)
const strip = s => JSON.parse(JSON.stringify(s, (k, v) => (k === '_ll' || (k === 'photo' && v == null) ? undefined : v)));

// a recognisable change made through the UI path the field user takes
function addMarker(a) {
  a.run('S.active="s1";syncPack()');
  a.run(`site().finds.push({id:'N-777',cat:'PP',type:'PMA-2',lane:7,dist:3.5,off:0,day:today(),time:'10:00',depth:5,qty:1,cond:'Neoštećeno',act:'x',synced:false,note:'marker'});save()`);
}
const hasMarker = a => a.run('S.sites.some(s=>s.finds.some(f=>f.id==="N-777"))');

test('localStorage mode: state survives save -> reload unchanged', async () => {
  const storage = makeLocalStorage();
  const a = await loadApp({ now: NOW, storage });
  assert.strictEqual(a.run('ST.mode'), 'ls');
  addMarker(a);
  const before = strip(a.json('S'));
  const b = await loadApp({ now: NOW, storage });
  assert.deepStrictEqual(strip(b.json('S')), before);
});

test('IndexedDB mode: state survives save -> reload unchanged', async () => {
  const idb = makeIndexedDB(), storage = makeLocalStorage();
  const a = await loadApp({ now: NOW, storage, idb });
  assert.strictEqual(a.run('ST.mode'), 'idb');
  addMarker(a);
  await a.run('saveQ');
  const before = strip(a.json('S'));
  const b = await loadApp({ now: NOW, storage, idb });
  assert.strictEqual(b.run('ST.mode'), 'idb');
  assert.deepStrictEqual(strip(b.json('S')), before);
});

test('saves are queued in order: the last change wins after many quick saves', async () => {
  const idb = makeIndexedDB();
  const a = await loadApp({ now: NOW, idb });
  for (let i = 0; i < 25; i++) a.run(`S.next=${1000 + i};save()`);
  await a.run('saveQ');
  const b = await loadApp({ now: NOW, idb });
  assert.strictEqual(b.run('S.next'), 1024);
});

test('migration: v3 state in localStorage moves into IndexedDB and the localStorage copy is removed', async () => {
  const v3 = FIX('state-v3.json');
  v3.sites.find(s => s.id === 's1').finds[0].photo = 'data:image/jpeg;base64,AAAA'; // v3 kept a 220 px photo in the find
  const storage = makeLocalStorage({ [KEY]: JSON.stringify(v3) }), idb = makeIndexedDB();
  const a = await loadApp({ now: NOW, storage, idb });
  await a.settle();
  assert.strictEqual(a.run('S.sites.length'), 3);
  assert.strictEqual(a.run('S.sites.find(s=>s.id==="s1").finds[0].thumb'), 'data:image/jpeg;base64,AAAA', 'photo -> thumb');
  assert.strictEqual(a.run('"photo" in S.sites.find(s=>s.id==="s1").finds[0]'), false);
  assert.ok(idb.store('terenska-knjiga', 'kv').get(KEY), 'written to IndexedDB');
  assert.strictEqual(storage.getItem(KEY), null, 'localStorage copy removed');
});

test('old v3 state (Serbia pack, no thumb/ph fields, no lastBackup) loads and every tab/document renders', async () => {
  const storage = makeLocalStorage({ [KEY]: JSON.stringify(FIX('state-v3.json')) });
  const a = await loadApp({ now: NOW, storage });
  for (const id of ['r1', 's1', 's2']) {
    a.run(`S.active="${id}";syncPack()`);
    const keys = a.json((a.run('site().pack') === 'RS' ? 'DOCS_RS' : 'DOCS_BA') + '.map(d=>d.k)');
    for (const k of keys) { a.run(`renderDoc("${k}")`); assert.ok(!/undefined|NaN/.test(a.html('#v-izvjestaji')), id + ' ' + k); }
    for (const t of ['danas', 'mapa', 'nalaz', 'hitno']) a.run(`go("${t}")`);
  }
});

test('old v2 state (BiH only: no pack/crs/mode, no boxes) loads under the current key and renders', async () => {
  const storage = makeLocalStorage({ [KEY]: JSON.stringify(FIX('state-v2.json')) });
  const a = await loadApp({ now: NOW, storage });
  assert.strictEqual(a.run('S.sites.length'), 2);
  for (const id of ['s1', 's2']) {
    a.run(`S.active="${id}";syncPack()`);
    for (const k of a.json('DOCS_BA.map(d=>d.k)')) { a.run(`renderDoc("${k}")`); assert.ok(!/undefined|NaN/.test(a.html('#v-izvjestaji')), id + ' ' + k); }
    for (const t of ['danas', 'mapa', 'nalaz', 'hitno']) a.run(`go("${t}")`);
  }
});

test('upgrade from v2: data saved by the v2 app (key terenska-knjiga-v2) is found and migrated', async () => {
  const v2 = FIX('state-v2.json');
  v2.sites[0].finds.push({ id: 'N-555', cat: 'PP', type: 'PMA-1', lane: 3, dist: 2, off: 0, day: '2026-10-14', time: '09:00', depth: 4, qty: 1, cond: 'x', act: 'x', synced: false, note: 'v2 field data' });
  const storage = makeLocalStorage({ 'terenska-knjiga-v2': JSON.stringify(v2) });
  const a = await loadApp({ now: NOW, storage, idb: makeIndexedDB() });
  assert.ok(a.run('S.sites.some(s=>s.finds.some(f=>f.id==="N-555"))'), 'v2 data ignored; the app started from demo seed');
});

// ---- failure paths ----
test('IndexedDB write failure shows "Podaci NISU sačuvani" to the user', async () => {
  const idb = makeIndexedDB();
  const a = await loadApp({ now: NOW, idb });
  idb.failPut = true;
  addMarker(a);
  await a.run('saveQ');
  assert.ok(/NISU sačuvani/.test(a.toastText()), 'toast: ' + a.toastText());
  assert.strictEqual(a.run('ST.failed'), true);
});

test('localStorage quota exceeded shows "Podaci NISU sačuvani"', async () => {
  const storage = makeLocalStorage();
  const a = await loadApp({ now: NOW, storage });
  storage.quota = 1000;
  addMarker(a);
  assert.ok(/NISU sačuvani/.test(a.toastText()), 'toast: ' + a.toastText());
});

test('after a failed save the warning stays visible (not one 8 s toast), until a save succeeds', async () => {
  const idb = makeIndexedDB();
  const a = await loadApp({ now: NOW, idb });
  idb.failPut = true;
  addMarker(a); await a.run('saveQ');
  a.flushTimers(); // the toast timer hides it
  a.run('go("danas")');
  const w = a.el('#saveWarn');
  assert.ok(!w.hidden && /NISU sačuvani/.test(w.innerHTML), 'no persistent warning after the toast disappeared');
  assert.ok(/data-act="backup"/.test(w.innerHTML), 'the warning offers a backup');
  idb.failPut = false;
  a.run('save()'); await a.run('saveQ');
  assert.strictEqual(a.el('#saveWarn').hidden, true, 'warning goes away once a save succeeds');
});

test('no storage at all (no IndexedDB, localStorage blocked): the user is warned on the main screen', async () => {
  const a = await loadApp({ now: NOW, lsThrows: true });
  assert.strictEqual(a.run('ST.mode'), 'mem');
  addMarker(a);
  const w = a.el('#saveWarn');
  assert.ok(!w.hidden && /NE čuvaju/.test(w.innerHTML), 'save() in mem mode is a silent no-op; banner="' + w.innerHTML + '"');
});

test('IndexedDB temporarily failing to open does not show demo data instead of the field data', async () => {
  const idb = makeIndexedDB(), storage = makeLocalStorage();
  const a = await loadApp({ now: NOW, storage, idb });
  addMarker(a); await a.run('saveQ');
  idb.failOpen = true;
  const b = await loadApp({ now: NOW, storage, idb });
  assert.ok(hasMarker(b), `mode ${b.run('ST.mode')}: the app shows the demo seed; the saved find N-777 is not visible`);
});

test('work done while IndexedDB was unavailable is not lost when it comes back', async () => {
  const idb = makeIndexedDB(), storage = makeLocalStorage();
  const a = await loadApp({ now: NOW, storage, idb });
  a.run('save()'); await a.run('saveQ'); // the device already has data in IndexedDB
  idb.failOpen = true;
  const b = await loadApp({ now: NOW, storage, idb });
  addMarker(b); // saved to localStorage in fallback mode
  idb.failOpen = false;
  const c = await loadApp({ now: NOW, storage, idb });
  assert.ok(hasMarker(c), 'the find saved during the fallback session is gone (IDB copy wins, localStorage copy ignored)');
});

// ---- backup / restore ----
async function makeBackup(a) {
  a.blobs.length = 0;
  await a.run('exportBackup()');
  const b = a.blobs.find(x => x.type === 'application/json');
  assert.ok(b, 'backup blob produced');
  return b.text();
}
async function restore(a, txt) {
  a.run(`onRestoreFile({text:()=>Promise.resolve(${JSON.stringify(txt)})})`);
  await a.settle();
  await a.run('restoreBackup()');
  await a.settle();
}

test('backup -> restore on a new device brings back every site, find and full-size photo', async () => {
  const idbA = makeIndexedDB();
  const a = await loadApp({ now: NOW, idb: idbA });
  addMarker(a);
  await a.run(`idbPut('photos','s1/N-777',new Blob([new Uint8Array([1,2,3,4])],{type:'image/jpeg'}))`);
  a.run('site().finds.find(f=>f.id==="N-777").ph=1;site().finds.find(f=>f.id==="N-777").thumb="data:image/jpeg;base64,AQID";save()');
  await a.run('saveQ');
  const txt = await makeBackup(a);
  const data = JSON.parse(txt);
  assert.strictEqual(data.app, 'terenska-knjiga');
  assert.ok(data.photos['s1/N-777'].startsWith('data:image/jpeg;base64,'));
  const idbB = makeIndexedDB();
  const b = await loadApp({ now: NOW, idb: idbB });
  await restore(b, txt);
  assert.ok(hasMarker(b));
  const blob = idbB.store('terenska-knjiga', 'photos').get('s1/N-777');
  assert.ok(blob, 'photo restored');
  assert.deepStrictEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 4]);
  const c = await loadApp({ now: NOW, idb: idbB });
  assert.ok(hasMarker(c), 'restored state persisted');
});

test('backup marks lastBackup and the backup nag disappears', async () => {
  const a = await loadApp({ now: NOW, idb: makeIndexedDB() });
  a.run('S.active="s1";go("danas")');
  assert.ok(/Rezervna kopija/.test(a.html('#v-danas')));
  await makeBackup(a);
  a.run('go("danas")');
  assert.ok(!/nema je|starija od/.test(a.html('#v-danas')));
});

test('restoring a damaged backup keeps the current photos and data (validate before wiping)', async () => {
  const idb = makeIndexedDB();
  const a = await loadApp({ now: NOW, idb });
  await a.run(`idbPut('photos','s1/N-101',new Blob([new Uint8Array([9])],{type:'image/jpeg'}))`);
  addMarker(a); await a.run('saveQ');
  const bad = JSON.stringify({ app: 'terenska-knjiga', format: 1, exported: new Date(NOW).toISOString(), state: { sites: [{ id: 'x', msp: { id: 'MSP 1' } }] }, photos: {} });
  try { await restore(a, bad); } catch (e) { /* the app does not catch it either */ }
  const photo = idb.store('terenska-knjiga', 'photos').get('s1/N-101');
  assert.ok(photo, 'existing full-size photo wiped by a backup that then failed to load');
});

test('a backup with a malformed site cannot brick the app (it still starts after reload)', async () => {
  const idb = makeIndexedDB(), storage = makeLocalStorage();
  const a = await loadApp({ now: NOW, idb, storage });
  const bad = JSON.stringify({ app: 'terenska-knjiga', format: 1, exported: new Date(NOW).toISOString(), state: { sites: [{ id: 'x', msp: { id: 'MSP 1', naziv: 'n', ru: 'r' }, ci: { oznaka: 'c' }, finds: [] }], active: 'x', queue: [], brief: [] }, photos: {} });
  try { await restore(a, bad); } catch (e) {}
  const b = await loadApp({ now: NOW, idb, storage });
  let err = b.errors[0];
  if (!err) try { b.run('go("danas")'); } catch (e) { err = e; }
  assert.ok(!err, 'after restoring this file the app throws on every start: ' + (err && err.message));
});

// ---- destructive or misleading actions ----
test('"Vrati početne podatke demoa" asks for confirmation before wiping field data and photos', async () => {
  const idb = makeIndexedDB();
  const a = await loadApp({ now: NOW, idb });
  addMarker(a); await a.run('saveQ');
  await a.run(`idbPut('photos','s1/N-777',new Blob([new Uint8Array([1])]))`);
  a.click('reset');
  await a.settle();
  assert.ok(hasMarker(a) && idb.store('terenska-knjiga', 'photos').size === 1, 'one tap erased all sites, finds and photos with no confirmation');
});

test('a photo picked for an abandoned find is not attached to the next find', async () => {
  const a = await loadApp({ now: NOW });
  a.run('S.active="s1";go("nalaz")');
  a.run('photoData={thumb:"data:image/jpeg;base64,STALE",blob:null}'); // what onPhoto() leaves after the camera
  a.run('go("danas");go("nalaz")'); // user leaves the form without saving, later opens it again
  const d = a.dom.document;
  d.querySelector('input[name="ftype"]:checked').value = 'PMA-2';
  a.run('onSubmit({preventDefault(){}})');
  const f = a.json('site().finds[site().finds.length-1]');
  assert.ok(!f.thumb, 'new find got the stale photo ' + f.thumb);
});

test('"Poslato" / synced=true only after a server confirms receipt (no network call exists)', async () => {
  const a = await loadApp({ now: NOW });
  addMarker(a);
  a.click('sync');
  a.flushTimers();
  const f = a.json('S.sites.flatMap(s=>s.finds).find(f=>f.id==="N-777")');
  assert.strictEqual(f.synced, false, 'find marked as sent: "' + a.toastText() + '"');
});

// ---- regression: recovery instead of demo data, reset confirmation, honest sync, atomic restore ----
test('IndexedDB holds data but will not open and there is no copy: recovery screen, no demo data, retry loads the data', async () => {
  const idb = makeIndexedDB(), storage = makeLocalStorage();
  const a = await loadApp({ now: NOW, storage, idb });
  addMarker(a); await a.run('saveQ');
  storage.removeItem(KEY + '-copy'); // e.g. the browser dropped localStorage
  idb.failOpen = true;
  const b = await loadApp({ now: NOW, storage, idb });
  assert.strictEqual(b.run('S'), null, 'no state shown');
  assert.ok(/Podaci se trenutno ne mogu otvoriti/.test(b.html('#v-rec')) && !b.el('#v-rec').hidden, 'recovery screen');
  assert.ok(/data-act="recRetry"/.test(b.html('#v-rec')) && /rsFile/.test(b.html('#v-rec')), 'retry and restore offered');
  assert.strictEqual(b.errors.length, 0);
  b.click('tab', { tab: 'danas' }); // dead while recovering, no throw
  idb.failOpen = false;
  b.click('recRetry'); await b.settle(40);
  assert.ok(hasMarker(b), 'data back after retry');
  assert.strictEqual(b.el('#v-rec').hidden, true);
});

test('fallback session shows a persistent banner naming the copy in use', async () => {
  const idb = makeIndexedDB(), storage = makeLocalStorage();
  const a = await loadApp({ now: NOW, storage, idb });
  a.run('save()'); await a.run('saveQ');
  idb.failOpen = true;
  const b = await loadApp({ now: NOW, storage, idb });
  assert.strictEqual(b.run('ST.mode'), 'fallback');
  assert.ok(!b.el('#saveWarn').hidden && /nije otvorila/.test(b.el('#saveWarn').innerHTML));
});

test('a corrupt state in IndexedDB does not white-screen: recovery screen offers the raw data as a file', async () => {
  const idb = makeIndexedDB(), storage = makeLocalStorage();
  const a = await loadApp({ now: NOW, storage, idb });
  a.run('save()'); await a.run('saveQ');
  idb.store('terenska-knjiga', 'kv').set(KEY, { sites: [{ id: 's1', msp: {} }], rev: 99 });
  storage.removeItem(KEY + '-copy');
  const b = await loadApp({ now: NOW, storage, idb });
  assert.strictEqual(b.run('S'), null);
  assert.ok(/nisu ispravni/.test(b.html('#v-rec')) && /data-act="recRaw"/.test(b.html('#v-rec')), b.html('#v-rec').slice(0, 300));
  assert.strictEqual(b.errors.length, 0);
});

test('demo reset: step 1 names what is lost and offers a backup, step 2 needs OBRIŠI, then data and photos are replaced', async () => {
  const idb = makeIndexedDB();
  const a = await loadApp({ now: NOW, idb });
  addMarker(a); await a.run('saveQ');
  await a.run(`idbPut('photos','s1/N-777',new Blob([new Uint8Array([1])]))`);
  a.click('reset');
  const h = a.html('#sheet');
  assert.ok(/nalaza/.test(h) && /data-act="backup"/.test(h) && /ne može poništiti/.test(h), 'step 1');
  a.click('reset2');
  a.dom.document.querySelector('#resetTxt').value = 'da';
  await a.run('resetDemo()'); await a.settle();
  assert.ok(hasMarker(a), 'wrong confirmation word deletes nothing');
  a.dom.document.querySelector('#resetTxt').value = 'obriši';
  await a.run('resetDemo()'); await a.settle(); await a.run('saveQ');
  assert.ok(!hasMarker(a), 'data replaced after confirmation');
  assert.strictEqual(idb.store('terenska-knjiga', 'photos').size, 0, 'photos cleared');
});

test('sync button: says the pilot does not send anything and lists the queue as waiting', async () => {
  const a = await loadApp({ now: NOW });
  assert.ok(/Sinhronizacija:<br>u pilotu/.test(a.el('#syncLabel').innerHTML), a.el('#syncLabel').innerHTML);
  a.click('sync');
  const h = a.html('#sheet');
  assert.ok(/ne šalje podatke nikome/.test(h) && /čeka \(sinhronizacija još nije uključena\)/.test(h), h.slice(0, 200));
  assert.ok(!/Poslato/.test(h + a.el('#syncLabel').innerHTML));
});

test('v2 migration keeps the old key until a backup file is made', async () => {
  const storage = makeLocalStorage({ 'terenska-knjiga-v2': JSON.stringify(FIX('state-v2.json')) });
  const a = await loadApp({ now: NOW, storage, idb: makeIndexedDB() });
  assert.ok(storage.getItem('terenska-knjiga-v2'), 'old key kept');
  assert.strictEqual(a.run('S.sites.every(s=>s.pack==="BA"&&s.crs==="GK6"&&s.mode==="lanes")'), true);
  await a.run('exportBackup()');
  assert.strictEqual(storage.getItem('terenska-knjiga-v2'), null, 'old key removed after the backup');
});

test('restore of a valid backup with a bad photo entry skips that photo and keeps the rest', async () => {
  const a = await loadApp({ now: NOW, idb: makeIndexedDB() });
  const st = a.json('S');
  const txt = JSON.stringify({ app: 'terenska-knjiga', format: 1, exported: new Date(NOW).toISOString(), state: st, photos: { 's1/N-101': 'data:image/jpeg;base64,AQID', 's1/N-102': 'javascript:alert(1)' } });
  const b = await loadApp({ now: NOW, idb: makeIndexedDB() });
  await restore(b, txt);
  assert.strictEqual(b.idb.store('terenska-knjiga', 'photos').size, 1);
});
