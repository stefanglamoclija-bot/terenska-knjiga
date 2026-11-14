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
}, { xfail: 'F-13' });

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
  const visible = !a.el('#toast').hidden || /NISU|nije sačuvan|ne čuva/i.test(a.html('#v-danas') + a.el('#syncLabel').textContent);
  assert.ok(visible, 'no persistent warning after the toast disappeared');
}, { xfail: 'F-04' });

test('no storage at all (no IndexedDB, localStorage blocked): the user is warned on the main screen', async () => {
  const a = await loadApp({ now: NOW, lsThrows: true });
  assert.strictEqual(a.run('ST.mode'), 'mem');
  addMarker(a);
  const warned = /NISU sačuvani|ne čuvaju/i.test(a.toastText() + a.html('#v-danas'));
  assert.ok(warned, 'save() in mem mode is a silent no-op; toast="' + a.toastText() + '"');
}, { xfail: 'F-04' });

test('IndexedDB temporarily failing to open does not show demo data instead of the field data', async () => {
  const idb = makeIndexedDB(), storage = makeLocalStorage();
  const a = await loadApp({ now: NOW, storage, idb });
  addMarker(a); await a.run('saveQ');
  idb.failOpen = true;
  const b = await loadApp({ now: NOW, storage, idb });
  assert.ok(hasMarker(b), `mode ${b.run('ST.mode')}: the app shows the demo seed; the saved find N-777 is not visible`);
}, { xfail: 'F-05' });

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
}, { xfail: 'F-05' });

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
}, { xfail: 'F-08' });

test('a backup with a malformed site cannot brick the app (it still starts after reload)', async () => {
  const idb = makeIndexedDB(), storage = makeLocalStorage();
  const a = await loadApp({ now: NOW, idb, storage });
  const bad = JSON.stringify({ app: 'terenska-knjiga', format: 1, exported: new Date(NOW).toISOString(), state: { sites: [{ id: 'x', msp: { id: 'MSP 1', naziv: 'n', ru: 'r' }, ci: { oznaka: 'c' }, finds: [] }], active: 'x', queue: [], brief: [] }, photos: {} });
  try { await restore(a, bad); } catch (e) {}
  const b = await loadApp({ now: NOW, idb, storage });
  let err = b.errors[0];
  if (!err) try { b.run('go("danas")'); } catch (e) { err = e; }
  assert.ok(!err, 'after restoring this file the app throws on every start: ' + (err && err.message));
}, { xfail: 'F-08' });

// ---- destructive or misleading actions ----
test('"Vrati početne podatke demoa" asks for confirmation before wiping field data and photos', async () => {
  const idb = makeIndexedDB();
  const a = await loadApp({ now: NOW, idb });
  addMarker(a); await a.run('saveQ');
  await a.run(`idbPut('photos','s1/N-777',new Blob([new Uint8Array([1])]))`);
  a.click('reset');
  await a.settle();
  assert.ok(hasMarker(a) && idb.store('terenska-knjiga', 'photos').size === 1, 'one tap erased all sites, finds and photos with no confirmation');
}, { xfail: 'F-03' });

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
}, { xfail: 'F-06' });

test('"Poslato" / synced=true only after a server confirms receipt (no network call exists)', async () => {
  const a = await loadApp({ now: NOW });
  addMarker(a);
  a.click('sync');
  a.flushTimers();
  const f = a.json('S.sites.flatMap(s=>s.finds).find(f=>f.id==="N-777")');
  assert.strictEqual(f.synced, false, 'find marked as sent: "' + a.toastText() + '"');
}, { xfail: 'F-11' });
