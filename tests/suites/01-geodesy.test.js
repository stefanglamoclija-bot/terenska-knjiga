'use strict';
const assert = require('assert');
const { test } = require('../lib/t');
const { loadApp } = require('../lib/harness');
const ref = require('../lib/geo-ref');

let appP = null;
const app = () => (appP = appP || loadApp({ now: '2026-11-11T10:00:00' }));
const call = async (expr) => (await app()).json(expr);

// test grid over BiH and Serbia
const PTS = [];
for (let lat = 42.6; lat <= 46.2; lat += 0.6) for (let lon = 15.8; lon <= 22.9; lon += 0.7) PTS.push([+lat.toFixed(2), +lon.toFixed(2)]);

test('GK6: wgsToGk6 -> gk6ToWgs round trip < 1 cm over BiH grid (15.8–19.8°E)', async () => {
  const a = await app();
  let worst = 0;
  for (const [lat, lon] of PTS.filter(p => p[1] <= 19.8)) {
    const g = a.json(`wgsToGk6(${lat},${lon})`);
    const w = a.json(`gk6ToWgs(${g.Y},${g.X})`);
    worst = Math.max(worst, ref.metres({ lat, lon }, w));
  }
  assert.ok(worst < 0.01, 'worst round trip ' + worst + ' m');
});

test('GK6: gk6ToWgs -> wgsToGk6 round trip < 1 cm for seeded nulta tačka', async () => {
  const g = await call('wgsToGk6(gk6ToWgs(6571250,4921800).lat,gk6ToWgs(6571250,4921800).lon)');
  assert.ok(Math.hypot(g.Y - 6571250, g.X - 4921800) < 0.01, JSON.stringify(g));
});

test('GK6: point near 18.85°E 44.43°N lands in zone 6 where expected (Y≈6 567 6xx, X≈4 920 xxx)', async () => {
  const g = await call('wgsToGk6(44.43,18.85)');
  assert.ok(g.Y > 6567000 && g.Y < 6568500, 'Y ' + g.Y);
  assert.ok(g.X > 4920000 && g.X < 4921500, 'X ' + g.X);
  // and agrees with an independent Krüger-series implementation of the same MGI(3-param)/Bessel model to < 1 cm
  const r = ref.wgsToMgiGk6(44.43, 18.85);
  assert.ok(Math.hypot(g.Y - r.Y, g.X - r.X) < 0.01, `app ${g.Y},${g.X} ref ${r.Y},${r.X}`);
});

test('GK6: app projection matches independent reference to < 1 cm across BiH (both directions)', async () => {
  const a = await app();
  let worst = 0;
  for (const [lat, lon] of PTS.filter(p => p[1] < 19.8)) {
    const g = a.json(`wgsToGk6(${lat},${lon})`), r = ref.wgsToMgiGk6(lat, lon);
    worst = Math.max(worst, Math.hypot(g.Y - r.Y, g.X - r.X));
    const w = a.json(`gk6ToWgs(${r.Y},${r.X})`);
    worst = Math.max(worst, ref.metres({ lat, lon }, w));
  }
  assert.ok(worst < 0.01, 'worst ' + worst + ' m');
});

test('GK6: seeded BiH nulta tačka (Y 6 571 250, X 4 921 800) lies in BiH near Tuzla region', async () => {
  const w = await call('gk6ToWgs(6571250,4921800)');
  assert.ok(w.lat > 44.3 && w.lat < 44.6 && w.lon > 18.7 && w.lon < 19.1, JSON.stringify(w));
});

test('GK6: MGI->WGS84 shift is applied in the right direction (|shift| at BiH ≈ 100-700 m, not 0)', async () => {
  const a = await app();
  // project the same Bessel lat/lon without a datum shift and compare: the datum offset must be visible
  const g = a.json('tmInv(6571250,4921800,ELL.bessel,18,0.9999,6500000)');
  const w = a.json('gk6ToWgs(6571250,4921800)');
  const d = ref.metres(g, w);
  assert.ok(d > 50 && d < 1000, 'datum offset ' + d + ' m');
  // and it matches the reference sign convention (towgs84 = +682,-203,+480 applied MGI -> WGS84)
  const r = ref.mgiGk6ToWgs(6571250, 4921800);
  assert.ok(ref.metres(r, w) < 0.01);
});

test('UTM34: published reference lat 45°, lon 21° -> E 500 000,00  N 4 982 950,40', async () => {
  const u = await call('wgsToUtm34(45,21)');
  assert.ok(Math.abs(u.E - 500000) < 0.005, 'E ' + u.E);
  assert.ok(Math.abs(u.N - 4982950.40) < 0.005, 'N ' + u.N);
});

test('UTM34: equator on the central meridian is E 500 000, N 0', async () => {
  const u = await call('wgsToUtm34(0,21)');
  assert.ok(Math.abs(u.E - 500000) < 1e-6 && Math.abs(u.N) < 1e-6, JSON.stringify(u));
});

test('UTM34: forward matches independent Krüger reference < 1 cm over BiH/Serbia (to 5.2° off the CM)', async () => {
  const a = await app();
  let worst = 0, at = null;
  for (const [lat, lon] of PTS) {
    const u = a.json(`wgsToUtm34(${lat},${lon})`), r = ref.utm34Fwd(lat, lon);
    const d = Math.hypot(u.E - r.E, u.N - r.N); if (d > worst) { worst = d; at = [lat, lon]; }
  }
  assert.ok(worst < 0.01, 'worst ' + worst + ' m at ' + at);
});

test('UTM34: wgsToUtm34 -> utm34ToWgs round trip < 1 cm inside zone 34 and up to 3.5° off (17.5–22.9°E)', async () => {
  const a = await app();
  let worst = 0;
  for (const [lat, lon] of PTS.filter(p => p[1] >= 17.5)) {
    const u = a.json(`wgsToUtm34(${lat},${lon})`), w = a.json(`utm34ToWgs(${u.E},${u.N})`);
    worst = Math.max(worst, ref.metres({ lat, lon }, w));
  }
  assert.ok(worst < 0.01, 'worst ' + worst + ' m');
});

test('UTM34: seeded Serbian origin (E 456 120, N 4 953 480) is in Serbia', async () => {
  const w = await call('utm34ToWgs(456120,4953480)');
  assert.ok(w.lat > 44.6 && w.lat < 44.9 && w.lon > 20.3 && w.lon < 20.6, JSON.stringify(w));
});

test('GK6 <-> UTM34 via WGS84 (toGkFromCrs) is consistent < 1 cm', async () => {
  const a = await app();
  const g = a.json('toGkFromCrs("UTM34",400000,4920000)');
  const w = a.json(`gk6ToWgs(${g.Y},${g.X})`), u = a.json(`wgsToUtm34(${w.lat},${w.lon})`);
  assert.ok(Math.hypot(u.E - 400000, u.N - 4920000) < 0.01, JSON.stringify(u));
});

test('crsFmt prints the same point identically in GK and in UTM (to 1 cm) after conversion', async () => {
  const a = await app();
  a.run('S.active="s1";syncPack();S.crs="UTM34"');
  const txt = a.run('crsFmt(site(),site().nt)');
  a.run('S.crs="GK6"');
  const m = txt.match(/E ([\d ]+,\d\d)\s+N ([\d ]+,\d\d)/);
  assert.ok(m, txt);
  const E = +m[1].replace(/ /g, '').replace(',', '.'), N = +m[2].replace(/ /g, '').replace(',', '.');
  const w = ref.mgiGk6ToWgs(6571250, 4921800), u = ref.utm34Fwd(w.lat, w.lon);
  assert.ok(Math.hypot(E - u.E, N - u.N) < 0.011, `${E},${N} vs ${u.E},${u.N}`);
});

// F-17: utm34ToWgs (Snyder footpoint series) loses accuracy far from 21°E: ~2 cm at 15.7°E (western BiH printed in UTM 34N)
test('UTM34: round trip < 1 cm also in western BiH (15.7°E, 5.3° off the CM)', async () => {
  const a = await app();
  const u = a.json('wgsToUtm34(44.5,15.7)'), w = a.json(`utm34ToWgs(${u.E},${u.N})`);
  const d = ref.metres({ lat: 44.5, lon: 15.7 }, w);
  assert.ok(d < 0.01, 'round trip ' + (d * 1000).toFixed(1) + ' mm');
}, { xfail: 'F-17' });

// F-17: BiH west of 18°E is UTM zone 33N; the app forces 34N for every BiH site.
test('UTM for BiH sites west of 18°E should use zone 33N (app always prints UTM 34N)', async () => {
  const a = await app();
  const src = a.run('wgsToUtm34.toString()+crsName.toString()+outCrs.toString()');
  assert.ok(/33/.test(src), 'no zone 33 handling in UTM output path');
}, { xfail: 'F-17' });
