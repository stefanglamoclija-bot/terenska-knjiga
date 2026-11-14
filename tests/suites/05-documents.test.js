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
  const v = Object.assign({ '#nsCrs': 'GK6', '#nsY': '6571900.00', '#nsX': '4922400.00', '#nsAz': '0', '#nsMsp': 'MSP 0455', '#nsName': 'Kosa', '#nsTip': 'CI', '#nsCi': 'CI-1',
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
  a.run(`S.sites.push({id:'m1',msp:{id:'MSP 1',naziv:'Min'},ci:{oznaka:'CI-9'},nt:{Y:6571900,X:4922400},az:10,
    poly:[[0,0],[20,0],[20,30],[0,30]],lanes:{},pairs:[],progress:[],finds:[],log:[],qc:[],monitors:[],info:[]});S.active='m1';`);
  assertClean(renderAll(a), 'minimal');
}, { xfail: 'F-08' });

test('new BiH site: općina and regional office come from the user, not hard-coded "Općina Primjer" / "RU Tuzla"', async () => {
  const a = await fresh();
  await newBaSite(a);
  const m = a.json('site().msp');
  a.run('renderDoc("p11")');
  assert.ok(m.ru !== 'RU Tuzla' && m.opcina !== 'Općina Primjer', 'P11 is addressed to: ' + (a.html('#v-izvjestaji').match(/<b>Za:<\/b> ([^<]*)/) || [])[1]);
}, { xfail: 'F-10' });

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
  const i = a.json('S.incident');
  // there is no way in the UI to say which lane the accident was in; it is always pairs[0]
  assert.ok(i.site === 's1' && 'lane' in i && a.run('typeof openIncidentPlace') === 'function', 'incident lane fixed to pair A (lane ' + i.lane + '), no site id');
}, { xfail: 'F-09' });

test('P12 victims start empty, not pre-filled with 1 adult / 1 seriously injured', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  a.click('incStart');
  const v = a.json('S.incident.v');
  assert.ok(Object.values(v).every(x => x === 0 || x == null), 'pre-filled victims ' + JSON.stringify(v));
}, { xfail: 'F-09' });

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
}, { xfail: 'F-10' });

test('P6 field 15 states the search depth actually used, not the standard minimum', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  const f = a.json('p6Fields()').find(x => x[0] === 15);
  assert.ok(!/minimum po standardu/.test(f[2]), f[2]);
});

test('BiH pack uses the standard\'s term "PO mina" (protuoklopna), not "PT mina"', async () => {
  const a = await fresh();
  const cats = a.json('PACKS.BA.cats');
  assert.ok(!/PT/.test(JSON.stringify(cats)), JSON.stringify(cats));
}, { xfail: 'F-21' });

test('demolition distance for buried charges includes +100 m per additional 10 kg', async () => {
  const a = await fresh();
  const d = a.json('PACKS.BA.demolition').find(x => /Zakopano/.test(x[0]));
  assert.ok(/100 m/.test(d[1]) || /10 kg/.test(d[1]), JSON.stringify(d));
}, { xfail: 'F-21' });

test('P6 Zapisnik has the 26 fields of Prilog 6 (app counts "od 20 polja")', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  assert.ok(a.run('p6Fields().length') >= 26, a.run('p6Fields().length') + ' fields');
}, { xfail: 'F-21' });

// found in the browser walk-through: switching site while a document is open keeps docView
test('switching from a BiH site to a Serbian site while P11 is open does not print a BHMAC P11 for the Serbian site', async () => {
  const a = await fresh();
  a.run('S.active="s1";go("izvjestaji")');
  a.click('doc', { k: 'p11' });
  a.click('pickSite', { id: 'r1' });
  const h = a.html('#v-izvjestaji');
  assert.ok(!/SEDMIČNI IZVJEŠTAJ/.test(h), 'Serbian site shows: ' + (h.match(/<h4>[^<]*<\/h4>/) || [''])[0].slice(0, 60) + ' / ' + (h.match(/<b>Za:<\/b>[^·]*/) || [''])[0]);
}, { xfail: 'F-28' });

test('switching from a Serbian site to a BiH site while the skica is open does not show an empty document', async () => {
  const a = await fresh();
  a.run('S.active="r1";go("izvjestaji")');
  a.click('doc', { k: 'sk' });
  a.click('pickSite', { id: 's1' });
  const h = a.html('#v-izvjestaji');
  assert.ok(/<h4>/.test(h) || /doclist/.test(h), 'empty paper document shown');
}, { xfail: 'F-28' });
