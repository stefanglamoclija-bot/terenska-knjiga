'use strict';
const assert = require('assert');
const { test } = require('../lib/t');
const { loadApp } = require('../lib/harness');
const ref = require('../lib/geo-ref');

const NOW = '2026-11-11T10:00:00';
const fresh = () => loadApp({ now: NOW });

// RFC 4180 parser (handles quotes, doubled quotes, embedded separators and newlines); the separator is read from the header
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const sep = text.split('\n')[0].includes(';') ? ';' : ',';
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c === '\r') { if (text[i + 1] !== '\n') { row.push(f); rows.push(row); row = []; f = ''; } }
    else f += c;
  }
  row.push(f); rows.push(row);
  return rows;
}
const toN = x => +String(x).replace(',', '.');
function inRing(pt, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
const signedArea = r => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; };

for (const id of ['s1', 's2', 'r1']) {
  test(`GeoJSON ${id}: valid FeatureCollection, closed polygons, plausible lon/lat, finds inside the boundary`, async () => {
    const a = await fresh();
    a.run(`S.active="${id}";syncPack()`);
    const g = JSON.parse(a.run('geoText()'));
    assert.strictEqual(g.type, 'FeatureCollection');
    assert.ok(Array.isArray(g.features) && g.features.length >= 1);
    const boundary = g.features.find(f => f.properties.vrsta === 'granica');
    assert.ok(boundary, 'boundary feature');
    for (const f of g.features) {
      assert.strictEqual(f.type, 'Feature');
      const gm = f.geometry;
      const pos = gm.type === 'Point' ? [gm.coordinates] : gm.type === 'LineString' ? gm.coordinates : gm.coordinates.flat();
      for (const [lon, lat] of pos) {
        assert.ok(lon > 15.5 && lon < 23.1 && lat > 41.8 && lat < 46.4, `${f.properties.vrsta} ${lon},${lat} outside BiH/Serbia (lon/lat swapped?)`);
      }
      if (gm.type === 'Polygon') for (const ring of gm.coordinates) {
        assert.ok(ring.length >= 4, 'ring has >= 4 positions');
        assert.deepStrictEqual(ring[0], ring[ring.length - 1], 'ring closed');
      }
    }
    const ring = boundary.geometry.coordinates[0];
    for (const f of g.features.filter(x => x.properties.vrsta === 'nalaz')) assert.ok(inRing(f.geometry.coordinates, ring), 'find ' + f.properties.id + ' outside boundary');
    assert.strictEqual(g.features.filter(x => x.properties.vrsta === 'nalaz').length, a.run('site().finds.length'));
  });
}

test('GeoJSON boundary vertex = planeToWgs of the lomna tačka (to 1e-7°)', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  const g = JSON.parse(a.run('geoText()'));
  const ring = g.features[0].geometry.coordinates[0];
  const w = a.json('planeToWgs(site(),toGK(site(),site().poly[0][0],site().poly[0][1]))');
  assert.ok(Math.abs(ring[0][0] - w.lon) < 1e-7 && Math.abs(ring[0][1] - w.lat) < 1e-7);
  // and the WGS84 point is where the GK coordinate says (independent reference)
  const gk = a.json('toGK(site(),site().poly[0][0],site().poly[0][1])'), r = ref.mgiGk6ToWgs(gk.Y, gk.X);
  assert.ok(ref.metres(r, { lat: ring[0][1], lon: ring[0][0] }) < 0.02);
});

test('GeoJSON lane lines start on the nulta linija and have the cleared length', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  const g = JSON.parse(a.run('geoText()'));
  for (const f of g.features.filter(x => x.properties.vrsta === 'radna_staza')) {
    const [p0, p1] = f.geometry.coordinates;
    const d = ref.metres({ lon: p0[0], lat: p0[1] }, { lon: p1[0], lat: p1[1] });
    assert.ok(Math.abs(d - f.properties.ocisceno_m) < 0.05 * Math.max(1, f.properties.ocisceno_m) / 10 + 0.05, `lane ${f.properties.staza}: ${d} vs ${f.properties.ocisceno_m}`);
  }
});

test('GeoJSON polygons are counter-clockwise (RFC 7946 §3.1.6 right-hand rule)', async () => {
  const a = await fresh();
  const bad = [];
  for (const id of ['s1', 's2', 'r1']) {
    a.run(`S.active="${id}";syncPack()`);
    const g = JSON.parse(a.run('geoText()'));
    for (const f of g.features.filter(x => x.geometry.type === 'Polygon')) if (signedArea(f.geometry.coordinates[0]) < 0) { bad.push(id + ':' + (f.properties.id || f.properties.vrsta)); }
  }
  assert.ok(!bad.length, bad.length + ' clockwise rings, e.g. ' + bad.slice(0, 4).join(', '));
});

async function csvWith(note, id = 's1') {
  const a = await fresh();
  a.run(`S.active="${id}";syncPack()`);
  a.run(`site().finds.push(Object.assign({},site().finds[0],{id:'N-900',note:${JSON.stringify(note)}}))`);
  return { a, csv: a.run('csvText()') };
}

for (const id of ['s1', 'r1']) {
  test(`CSV ${id}: header + one row per find, every row has the same number of fields, coordinates plausible`, async () => {
    const a = await fresh();
    a.run(`S.active="${id}";syncPack()`);
    const rows = parseCsv(a.run('csvText()'));
    const head = rows[0];
    assert.strictEqual(rows.length - 1, a.run('site().finds.length'));
    for (const r of rows) assert.strictEqual(r.length, head.length, r.join('|'));
    const iE = head.findIndex(h => /_(Y|E)$/.test(h)), iN = head.findIndex(h => /_(X|N)$/.test(h)), iLat = head.indexOf('wgs84_lat'), iLon = head.indexOf('wgs84_lon');
    for (const r of rows.slice(1)) {
      const E = toN(r[iE]), N = toN(r[iN]), lat = toN(r[iLat]), lon = toN(r[iLon]);
      if (id === 'r1') assert.ok(E > 300000 && E < 700000 && N > 4600000 && N < 5200000, 'UTM ' + E + ' ' + N);
      else assert.ok(E > 6400000 && E < 6700000 && N > 4700000 && N < 5100000, 'GK ' + E + ' ' + N);
      assert.ok(lat > 41.8 && lat < 46.4 && lon > 15.5 && lon < 23.1, lat + ',' + lon);
      const back = id === 'r1' ? ref.utm34Fwd(lat, lon) : ref.wgsToMgiGk6(lat, lon);
      const be = back.E != null ? back.E : back.Y, bn = back.N != null ? back.N : back.X;
      assert.ok(Math.hypot(be - E, bn - N) < 0.05, 'plane and WGS84 columns agree');
    }
  });
}

test('CSV quotes commas, double quotes and newlines in a note and round-trips them', async () => {
  const note = 'Žica, "potezna"\nlijevo; 2 m';
  const { csv } = await csvWith(note);
  const rows = parseCsv(csv);
  const r = rows.find(x => x[0] === 'N-900');
  assert.ok(r, 'row found');
  assert.strictEqual(r[r.length - 1], note);
  assert.strictEqual(r.length, rows[0].length);
});

test('CSV quotes a bare carriage return (\\r) so a pasted Windows note does not split the row', async () => {
  const { csv } = await csvWith('red 1\rred 2');
  const rows = parseCsv(csv);
  assert.ok(rows.every(r => r.length === rows[0].length), 'a row was split by \\r');
});

test('CSV neutralises spreadsheet formulas in user text (=, +, -, @)', async () => {
  const { csv } = await csvWith('=HYPERLINK("http://x","klik")');
  const r = parseCsv(csv).find(x => x[0] === 'N-900');
  assert.ok(!/^[=+\-@]/.test(r[r.length - 1]), 'note exported as a live formula: ' + r[r.length - 1]);
});

test('CSV opens in a BCS-locale Excel: ";" separator or "sep=" hint, UTF-8 BOM for č/ć/š/ž', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  const csv = a.run('csvText()');
  assert.ok(/^﻿/.test(csv) || /^sep=/.test(csv) || csv.split('\n')[0].includes(';'), 'comma-separated, no BOM, no sep= line');
});

test('CSV box finds: local metres are measured from the box SW corner and lie within the box', async () => {
  const a = await fresh();
  a.run('S.active="r1";syncPack()');
  const rows = parseCsv(a.run('csvText()')), h = rows[0], g = a.run('site().grid');
  for (const r of rows.slice(1)) {
    const l1 = toN(r[h.indexOf('lokalno_1_m')]), l2 = toN(r[h.indexOf('lokalno_2_m')]);
    assert.ok(l1 >= 0 && l1 <= g && l2 >= 0 && l2 <= g, r[0] + ' ' + l1 + ',' + l2);
  }
});

test('find ids are unique per site even after 100 new finds (no collision with seeded N-201..N-207), and never reused after a delete', async () => {
  const a = await fresh();
  a.run('S.active="r1";syncPack();S.next=200');
  for (let i = 0; i < 100; i++) a.run('site().finds.push({id:newFindId(site()),box:site().boxes[0].id,u:1,v:1,cat:"NUS",type:"x",qty:1,day:today(),time:"10:00",depth:1,cond:"",act:"",method:"CEIA",note:""})');
  const ids = a.json('site().finds.map(f=>f.id)');
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate ids: ' + ids.filter((x, i) => ids.indexOf(x) !== i));
  assert.strictEqual(ids[7], 'N-208');
  a.run('site().finds.pop()');
  assert.strictEqual(a.run('newFindId(site())'), 'N-308', 'a removed id is not handed out again');
  a.run('S.active="s1";syncPack()');
  assert.strictEqual(a.run('newFindId(site())'), 'N-108', 'BiH site counts on its own');
});

test('CSV with "," on request uses decimal points; downloads carry a UTF-8 BOM; negative numbers are not mistaken for formulas', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  const c = a.run('csvText(",")'), rows = parseCsv(c), h = rows[0];
  assert.ok(h.includes('gk6_Y') && rows.length > 1 && /^\d+\.\d\d$/.test(rows[1][h.indexOf('gk6_Y')]), 'decimal point with ","');
  const s = a.run('csvText(";")'), r2 = parseCsv(s);
  assert.ok(/^\d+,\d\d$/.test(r2[1][r2[0].indexOf('gk6_Y')]), 'decimal comma with ";"');
  const off = r2.map(r => r[r2[0].indexOf('lokalno_2_m')]).find(x => /^-/.test(x));
  assert.ok(off && !/^'/.test(off), 'negative offset stays a number: ' + off);
  a.blobs.length = 0; a.run('saveFile("x.csv","\uFEFF"+csvText(),"text/csv")'); await a.settle();
  assert.deepStrictEqual([...new Uint8Array(await a.blobs[0].arrayBuffer())].slice(0, 3), [0xEF, 0xBB, 0xBF]);
});
