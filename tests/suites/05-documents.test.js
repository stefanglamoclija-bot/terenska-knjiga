'use strict';
const assert = require('assert');
const { test } = require('../lib/t');
const { loadApp } = require('../lib/harness');

const NOW = '2026-11-11T10:00:00';
const fresh = () => loadApp({ now: NOW });
const BAD = /undefined|NaN|Infinity|\[object /;

function docKeys(a, pack) { return a.json((pack === 'RS' ? 'DOCS_RS' : 'DOCS_BA') + '.map(d=>d.k)'); }

// renders every document + every tab for the active site; returns {key: html}
function renderAll(a) {
  const out = {};
  const pack = a.run('site().pack') || 'BA';
  a.run('syncPack()');
  for (const k of docKeys(a, pack)) {
    a.run(`docView=null;renderDoc(${JSON.stringify(k)})`);
    out['doc:' + k] = a.html('#v-izvjestaji');
  }
  out.list = (a.run('docView=null;renderIzvjestaji()'), a.html('#v-izvjestaji'));
  out.desc = a.json(`(${pack === 'RS' ? 'DOCS_RS' : 'DOCS_BA'}).map(d=>d.d())`).join(' | ');
  for (const t of ['danas', 'mapa', 'nalaz', 'hitno']) { a.run(`go(${JSON.stringify(t)})`); out['tab:' + t] = a.html('#v-' + t); }
  out.sites = (a.run('openSites()'), a.html('#sheet'));
  out.csv = a.run('csvText()');
  out.geo = a.run('geoText()');
  return out;
}

function assertClean(out, label) {
  for (const [k, h] of Object.entries(out)) {
    const m = String(h).match(BAD);
    assert.ok(!m, `${label} ${k}: contains "${m && m[0]}" near …${String(h).slice(Math.max(0, m && m.index - 80), m && m.index + 40)}…`);
  }
}

for (const id of ['r1', 's1', 's2']) {
  test(`seeded site ${id}: every document, tab, CSV and GeoJSON renders without throwing or "undefined/NaN"`, async () => {
    const a = await fresh();
    a.run(`S.active=${JSON.stringify(id)};syncPack()`);
    assertClean(renderAll(a), id);
  });
}

test('both crs choices (GK6 / UTM34) render every BiH document', async () => {
  const a = await fresh();
  a.run('S.active="s1";S.crs="UTM34";syncPack()');
  const out = renderAll(a);
  assertClean(out, 's1/UTM34');
  // P6 itself prints the entry point; the coordinate tables live in prilog e)
  a.run('renderDoc("p6e")');
  const p6e = a.html('#v-izvjestaji');
  assert.ok(/<th>E<\/th><th>N<\/th>/.test(p6e), 'P6 e) coordinate table headed E/N in UTM mode');
  assert.ok(/Y= /.test(out['doc:p6']) === false || /E= /.test(out['doc:p6']), 'P6 entry point not labelled Y/X in UTM mode');
  assert.ok(!/>6 5\d\d \d{3},\d\d</.test(p6e) && !/Y 6 5/.test(out['doc:p6']), 'no GK coordinates mixed into a UTM document');
});

async function newBaSite(a, over = {}) {
  const d = a.dom.document;
  const v = Object.assign({ '#nsCrs': 'GK6', '#nsY': '6571898.00', '#nsX': '4922400.00', '#nsAz': '0', '#nsMsp': 'MSP 0455', '#nsName': 'Kosa', '#nsTip': 'CI', '#nsCi': 'CI-1',
    '#nsTp': '6 571 898,00 4 922 400,00\n6 571 950,00 4 922 400,00\n6 571 956,00 4 922 440,00\n6 571 930,00 4 922 470,00\n6 571 900,00 4 922 462,00' }, over);
  for (const [k, x] of Object.entries(v)) d.querySelector(k).value = x;
  a.run('createSite()');
}
async function newRsSite(a, grid = '10') {
  const d = a.dom.document;
  d.querySelector('#nsTp').value = '457 010 4 955 020\n457 080 4 955 000\n457 105 4 955 060\n457 060 4 955 110\n457 000 4 955 090';
  d.querySelector('#nsGrid').value = grid; d.querySelector('#nsMsp').value = 'ID 0322/26'; d.querySelector('#nsName').value = 'Kosa'; d.querySelector('#nsSek').value = 'Sektor 1';
  a.run('createSiteRS()');
}

test('freshly created empty BiH site (no finds, no progress): all documents and tabs render', async () => {
  const a = await fresh();
  await newBaSite(a);
  assert.strictEqual(a.run('site().msp.id'), 'MSP 0455');
  assertClean(renderAll(a), 'new BA');
});

test('freshly created BiH site from a UTM dosije renders and keeps the nulta tačka within 1 cm', async () => {
  const a = await fresh();
  await newBaSite(a, { '#nsCrs': 'UTM34', '#nsY': '396000', '#nsX': '4922000', '#nsTp': '396010 4922010\n396060 4922010\n396060 4922060\n396010 4922060' });
  a.run('S.crs="UTM34"');
  const out = renderAll(a);
  assertClean(out, 'new BA/UTM');
  assert.ok(/E 396 000,00\s+N 4 922 000,00/.test(out['tab:mapa']), 'nulta tačka printed back as entered: ' + (out['tab:mapa'].match(/E [\d ]+,\d\d\s+N [\d ]+,\d\d/) || [''])[0]);
});

test('freshly created BiH site after it is opened (pairs, no finds yet): all documents render', async () => {
  const a = await fresh();
  await newBaSite(a);
  a.run('openSiteWork()');
  assertClean(renderAll(a), 'opened BA');
});

for (const grid of ['10', '25']) {
  test(`freshly created empty Serbian site (${grid} m boxes): all documents and tabs render`, async () => {
    const a = await fresh();
    await newRsSite(a, grid);
    assertClean(renderAll(a), 'new RS');
    a.run('openSiteWork()');
    assertClean(renderAll(a), 'opened RS');
  });
}

test('site with optional fields missing (karta, općina, RU, CI tip, plan area, start, estEnd, casevac, status) renders', async () => {
  const a = await fresh();
  // every state reaches the app through checkState() (storage, backup files, old versions), which fills the missing fields
  a.run(`S=checkState(Object.assign({},S,{sites:S.sites.concat([{id:'m1',msp:{id:'MSP 1',naziv:'Min'},ci:{oznaka:'CI-9'},nt:{Y:6571900,X:4922400},az:10,
    poly:[[0,0],[20,0],[20,30],[0,30]]}]),active:'m1'}));`);
  assertClean(renderAll(a), 'minimal');
});

test('new BiH site: općina and regional office come from the user, not hard-coded "Općina Primjer" / "RU Tuzla"', async () => {
  const a = await fresh();
  await newBaSite(a);
  const m = a.json('site().msp');
  a.run('renderDoc("p11")');
  assert.ok(m.ru !== 'RU Tuzla' && m.opcina !== 'Općina Primjer', 'P11 is addressed to: ' + (a.html('#v-izvjestaji').match(/<b>Za:<\/b> ([^<]*)/) || [])[1]);
});

test('active incident: Hitno and P12 render for BiH, Hitno for Serbia', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  a.click('incStart');
  let out = renderAll(a); assertClean(out, 'incident BA');
  assert.ok(/INICIJALNI IZVJEŠTAJ/.test(out['doc:p12']));
  a.click('incEnd');
  a.run('S.active="r1";syncPack()');
  a.click('incStart');
  out = renderAll(a); assertClean(out, 'incident RS');
});

// ---- content checks ----
test('P6 prilog e) lomne tačke table lists every boundary point once with Y/X', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack();renderDoc("p6e")');
  const h = a.html('#v-izvjestaji');
  const n = a.run('site().poly.length');
  for (let i = 1; i <= n; i++) assert.ok(new RegExp(`<td>T${i}</td><td class="n mono">6 57\\d \\d{3},\\d\\d</td><td class="n mono">4 92\\d \\d{3},\\d\\d</td>`).test(h), 'T' + i);
});

test('P12 coordinates are where the accident happened (pair C in lane 56), not always pair A\'s lane', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  a.click('incStart');
  let i = a.json('S.incident');
  assert.strictEqual(i.site, 's1', 'incident tied to the site');
  assert.strictEqual(i.lane, null, 'no lane assumed');
  a.run('renderDoc("p12")');
  assert.ok(!/Y= \d/.test(a.html('#v-izvjestaji')), 'no coordinates before the place is entered');
  a.run('openIncidentPlace()');
  const d = a.dom.document;
  d.querySelector('#ipLane').value = '56'; d.querySelector('#ipDist').value = '12'; d.querySelector('#ipWhere').value = '';
  a.click('incPlace');
  i = a.json('S.incident');
  assert.strictEqual(i.lane, 56); assert.strictEqual(i.dist, 12);
  a.run('renderDoc("p12")');
  const q = a.json('planeXY(site(),toGK(site(),55.5,12))');
  assert.ok(a.html('#v-izvjestaji').includes('Y= ' + a.run(`gkn(${q[0]})`)), 'P12 Y of lane 56 at 12 m');
  a.click('incEnd');
  assert.strictEqual(a.run('site().incidents.length'), 1, 'closed incident recorded in the site');
  a.run('S.active="r1";syncPack()');
  assert.strictEqual(a.run('siteIncident(site())'), null, 'another site does not inherit it');
});

test('P12 victims start empty, not pre-filled with 1 adult / 1 seriously injured', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  a.click('incStart');
  const v = a.json('S.incident.v');
  assert.ok(Object.values(v).every(x => x === 0 || x == null), 'pre-filled victims ' + JSON.stringify(v));
  assert.strictEqual(a.run('S.incident.cat'), '', 'type of explosive not pre-selected');
});

test('P12 does not assert land use or marking that the user never entered', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  a.click('incStart');
  a.run('renderDoc("p12")');
  const h = a.html('#v-izvjestaji');
  assert.ok(!/Poljoprivredno \(iz dosijea\)/.test(h), 'hard-coded "Poljoprivredno (iz dosijea)"');
  assert.ok(!/<span class="box">×<\/span>Da, službenim znacima/.test(h), 'hard-coded "Da, službenim znacima" ticked');
});

test('Nalaz form shows no invented "GPS telefona (kontrola): odstupanje" value', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack();go("nalaz")');
  a.dom.document.querySelector('#fLane').value = '4'; a.dom.document.querySelector('#fDist').value = '10'; a.dom.document.querySelector('#fOff').value = '0';
  a.run('calcPos()');
  assert.ok(!/odstupanje/.test(a.html('#fCalc')), a.html('#fCalc').replace(/<[^>]+>/g, ' ').trim().slice(-80));
});

test('P6 field 15 states the search depth actually used, not the standard minimum', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  const f = a.json('p6Fields()').find(x => x[0] === 15);
  assert.ok(!/minimum po standardu/.test(f[2]), f[2]);
});

// F-21 checked against the standard text: its abbreviations list ("PT MINE ... Protiv tenkovske mine") and Prilog 13
// ("VRSTA UKLONJENIH PT ...") use PT, so the app keeps "PT mina"; PP for anti-personnel.
test('BiH pack uses the standard\'s own terms: "PT mina" (protutenkovska) and P13 "VRSTA UKLONJENIH PT MINA"', async () => {
  const a = await fresh();
  const cats = a.json('PACKS.BA.cats');
  assert.strictEqual(cats.PT, 'PT mina'); assert.strictEqual(cats.PP, 'PP mina');
  a.run('S.active="s1";syncPack();renderDoc("p13")');
  assert.ok(/VRSTA UKLONJENIH PT MINA/.test(a.html('#v-izvjestaji')));
});

test('demolition distance for buried charges includes +100 m per additional 10 kg', async () => {
  const a = await fresh();
  const dem = a.json('PACKS.BA.demolition'), d = dem.find(x => /jami/.test(x[0]));
  assert.ok(/500 m za 10 kg/.test(d[1]) && /\+100 m za svakih dodatnih 10 kg/.test(d[1]), JSON.stringify(d));
  assert.ok(dem.some(x => /razorno-probojne/.test(x[0]) && x[1] === '1000 m'), 'PT razorno-probojne 1000 m (table of the standard)');
  const dist = a.json('PACKS.BA.distances');
  assert.ok(dist.some(x => /Monitor/.test(x[0]) && /25 m/.test(x[1])) && dist.some(x => /mašine/.test(x[0]) && /150 m/.test(x[1])), 'supervisor distances');
});

test('P6 Zapisnik has the 26 fields of Prilog 6: 1–20 in the statement, 21–26 in the declarations; the list says so', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  assert.strictEqual(a.run('p6Fields().length'), 20);
  a.run('renderDoc("p6")');
  const h = a.html('#v-izvjestaji');
  for (const n of [21, 22, 23, 24, 25, 26]) assert.ok(new RegExp('>' + n + '\\. |' + n + '\\. ').test(h), 'field ' + n);
  assert.ok(/od 20 polja \(21–26 pri predaji\)/.test(a.run('DOCS_BA.find(d=>d.k==="p6").d()')));
});

// found in the browser walk-through: switching site while a document is open keeps docView
test('switching from a BiH site to a Serbian site while P11 is open does not print a BHMAC P11 for the Serbian site', async () => {
  const a = await fresh();
  a.run('S.active="s1";go("izvjestaji")');
  a.click('doc', { k: 'p11' });
  a.click('pickSite', { id: 'r1' });
  const h = a.html('#v-izvjestaji');
  assert.ok(!/SEDMIČNI IZVJEŠTAJ/.test(h), 'Serbian site shows: ' + (h.match(/<h4>[^<]*<\/h4>/) || [''])[0].slice(0, 60) + ' / ' + (h.match(/<b>Za:<\/b>[^·]*/) || [''])[0]);
});

test('switching from a Serbian site to a BiH site while the skica is open does not show an empty document', async () => {
  const a = await fresh();
  a.run('S.active="r1";go("izvjestaji")');
  a.click('doc', { k: 'sk' });
  a.click('pickSite', { id: 's1' });
  const h = a.html('#v-izvjestaji');
  assert.ok(/<h4>/.test(h) || /doclist/.test(h), 'empty paper document shown');
});

// ---- regression: documents state only what was entered ----
test('a new BiH site carries no invented plan area, RU, općina or method: documents say "dopuniti"', async () => {
  const a = await fresh();
  await newBaSite(a);
  const s = a.json('site()');
  assert.strictEqual(s.ci.pmin, null); assert.strictEqual(s.msp.ru, ''); assert.strictEqual(s.msp.opcina, '');
  a.run('renderDoc("p11")'); assert.ok(/BHMAC – <span class="miss">dopuniti/.test(a.html('#v-izvjestaji')), 'P11 addressee');
  a.run('renderDoc("p10")'); const p10 = a.html('#v-izvjestaji');
  assert.ok(/min\. <span class="miss">dopuniti<\/span> m² max\. <span class="miss">dopuniti/.test(p10), 'P10 plan area');
  assert.ok(/Tehničke metode: <span class="miss">dopuniti/.test(p10), 'P10 method');
  a.run('openSiteWork()');
  a.run('renderDoc("p9")'); assert.ok(!/<span class="box">×<\/span>c-kombinacija/.test(a.html('#v-izvjestaji')), 'P9 method not ticked by itself');
});

test('the method entered for the CI/SI is what P9 and P6 print', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack();bh(site()).metoda="detektor";renderDoc("p9")');
  assert.ok(/<span class="box">×<\/span>a-detektor/.test(a.html('#v-izvjestaji')));
  assert.ok(/\(detektor\)/.test(a.json('p6Fields()').find(x => x[0] === 9)[2]));
  assert.ok(/detektor/.test(a.json('p6Fields()').find(x => x[0] === 16)[2]), 'monitoring methods from the QC records');
});

test('Nalaz form: no GPS line without a GPS; with navigator.geolocation the comparison uses the real position and accuracy', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack();go("nalaz")');
  assert.ok(!/GPS/.test(a.html('#fCalc')), 'no GPS button when the device has no geolocation');
  a.run('navigator.geolocation={getCurrentPosition:(ok)=>ok({coords:{latitude:gpsPos.lat+0.0001,longitude:gpsPos.lon,accuracy:6},timestamp:Date.now()})}');
  a.run('calcPos()');
  assert.ok(/Uporedi sa GPS-om/.test(a.html('#fCalc')));
  a.run('gpsCompare()');
  assert.ok(/GPS telefona: 11,1 m od izračunatog položaja \(tačnost GPS-a ±6 m/.test(a.el('#gpsOut').textContent), a.el('#gpsOut').textContent);
  a.run('delete navigator.geolocation');
});
