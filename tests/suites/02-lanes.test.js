'use strict';
const assert = require('assert');
const { test } = require('../lib/t');
const { loadApp } = require('../lib/harness');

const NOW = '2026-11-11T10:00:00'; // Wednesday
const fresh = () => loadApp({ now: NOW });
let shared = null;
const app = () => (shared = shared || fresh());

// exact intersection of the vertical line u=const with the polygon: the largest v inside the polygon
function boundaryAt(poly, u) {
  let best = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j], [x2, y2] = poly[i];
    if ((x1 <= u && u <= x2) || (x2 <= u && u <= x1)) {
      if (x1 === x2) best = Math.max(best, y1, y2);
      else best = Math.max(best, y1 + (y2 - y1) * (u - x1) / (x2 - x1));
    }
  }
  return best;
}
function inPoly(pt, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }

test('toGK/toLocal are exact inverses for azimuths 0..359.5 (< 1 µm)', async () => {
  const a = await app();
  for (const az of [0, 20, 45, 90, 135, 180, 225, 270, 305, 359.5]) {
    for (const [u, v] of [[0, 0], [0.5, 10], [-3.5, 27], [63.25, 51], [12.3, 0.1]]) {
      const r = a.json(`(()=>{const s={nt:{Y:6571250,X:4921800},az:${az}};const g=toGK(s,${u},${v});return toLocal(s,g.Y,g.X);})()`);
      assert.ok(Math.abs(r[0] - u) < 1e-6 && Math.abs(r[1] - v) < 1e-6, `az ${az} (${u},${v}) -> ${r}`);
    }
  }
});

test('lane frame: forward follows the azimuth, lanes count to the RIGHT of the nulta tačka', async () => {
  const a = await app();
  const f = (az, u, v) => a.json(`(()=>{const s={nt:{Y:0,X:0},az:${az}};return toGK(s,${u},${v});})()`);
  let p = f(0, 0, 10); assert.ok(Math.abs(p.Y) < 1e-9 && Math.abs(p.X - 10) < 1e-9, 'az 0 forward = north');
  p = f(0, 5, 0); assert.ok(Math.abs(p.Y - 5) < 1e-9 && Math.abs(p.X) < 1e-9, 'az 0 right = east');
  p = f(90, 0, 10); assert.ok(Math.abs(p.Y - 10) < 1e-9 && Math.abs(p.X) < 1e-9, 'az 90 forward = east');
  p = f(90, 5, 0); assert.ok(Math.abs(p.Y) < 1e-9 && Math.abs(p.X + 5) < 1e-9, 'az 90 right = south');
});

test('find position = nulta tačka + (staza − 0,5 + bočno)·D + udaljenost·N for every seeded BiH find', async () => {
  const a = await app();
  a.run('S.active="s1";syncPack()');
  const rows = a.json('site().finds.map(f=>({f,p:findPos(site(),f)}))');
  const s = a.json('site()');
  const az = s.az * Math.PI / 180;
  assert.ok(rows.length >= 7);
  for (const { f, p } of rows) {
    const u = f.lane - 0.5 + (f.off || 0), v = f.dist;
    const Y = s.nt.Y + u * Math.cos(az) + v * Math.sin(az), X = s.nt.X - u * Math.sin(az) + v * Math.cos(az);
    assert.ok(Math.hypot(p.Y - Y, p.X - X) < 1e-6, f.id);
    assert.ok(Math.abs(Math.hypot(p.Y - s.nt.Y, p.X - s.nt.X) - Math.hypot(u, v)) < 1e-6, f.id + ' distance from NT');
  }
});

test('every seeded find lies inside its site boundary polygon', async () => {
  const a = await app();
  for (const id of ['s1', 'r1']) {
    a.run(`S.active="${id}";syncPack()`);
    const s = a.json('site()');
    for (const f of s.finds) {
      const pt = f.u != null ? [f.u, f.v] : [f.lane - 0.5 + (f.off || 0), f.dist];
      assert.ok(inPoly(pt, s.poly), id + ' ' + f.id + ' at ' + pt);
    }
  }
});

test('laneLen: end of every lane centreline is inside the polygon and within 0,5 m of the exact boundary (sampling 0,25 m + rounding 0,5 m)', async () => {
  const a = await app();
  for (const id of ['s1', 's2']) {
    a.run(`S.active="${id}";syncPack()`);
    const s = a.json('site()'), lc = a.run('laneCount(site())');
    for (let i = 1; i <= lc; i++) {
      const L = a.run(`laneLen(site(),${i})`);
      if (L <= 0) continue;
      const exact = boundaryAt(s.poly, i - 0.5);
      assert.ok(Math.abs(L - exact) <= 0.5 + 1e-9, `${id} lane ${i}: laneLen ${L} vs exact ${exact.toFixed(3)}`);
      assert.ok(inPoly([i - 0.5, Math.min(L, exact) - 0.01], s.poly), `${id} lane ${i} end outside`);
    }
  }
});

test('laneLen never ends short of the boundary anywhere across the 1 m lane width (no untreated sliver at lane end)', async () => {
  const a = await app();
  const short = [];
  for (const id of ['s1', 's2']) {
    a.run(`S.active="${id}";syncPack()`);
    const s = a.json('site()'), lc = a.run('laneCount(site())');
    for (let i = 1; i <= lc; i++) {
      const L = a.run(`laneLen(site(),${i})`);
      let far = -Infinity; for (let k = 0; k <= 10; k++) far = Math.max(far, boundaryAt(s.poly, i - 1 + k / 10));
      if (far - L > 0.1) short.push(`${id}/${i}: ${L} m vs ${far.toFixed(2)} m`);
    }
  }
  assert.deepStrictEqual(short, [], short.length + ' lanes stop short: ' + short.slice(0, 6).join('; '));
}, { xfail: 'F-14' });

test('every point of the POPO polygon is covered by some lane 1..laneCount (nothing left of the nulta tačka)', async () => {
  const a = await app();
  a.run('S.active="s1";syncPack()');
  const s = a.json('site()'), lc = a.run('laneCount(site())');
  const lens = {}; for (let i = 1; i <= lc; i++) lens[i] = a.run(`laneLen(site(),${i})`);
  let miss = 0, missArea = 0;
  for (let u = -4; u <= 65; u += 0.25) for (let v = 0.125; v <= 52; v += 0.25) {
    if (!inPoly([u, v], s.poly)) continue;
    const lane = Math.ceil(u);
    if (lane < 1 || lane > lc || v > lens[lane]) { miss++; missArea += 0.0625; }
  }
  assert.strictEqual(miss, 0, `~${missArea.toFixed(0)} m² of the polygon is in no lane (e.g. u<0 strip left of NT)`);
}, { xfail: 'F-14' });

test('sum of full lane areas matches polygon area within 1%', async () => {
  const a = await app();
  for (const id of ['s1', 's2']) {
    a.run(`S.active="${id}";syncPack()`);
    const r = a.json('(()=>{const s=site();let t=0;for(let i=1;i<=laneCount(s);i++)t+=laneLen(s,i)*R.lane;return {t,A:totalArea(s)};})()');
    assert.ok(Math.abs(r.t - r.A) / r.A < 0.01, `${id}: lanes ${r.t} m² vs polygon ${r.A} m² (${((r.t / r.A - 1) * 100).toFixed(1)}%)`);
  }
}, { xfail: 'F-14' });

test('advancing a lane (+1 m, Do kraja) records progress for TODAY and cleared m² = metres × 1 m', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack();tab="mapa"');
  const before = a.run('clearedM2(site())'), d0 = a.run('laneDone(site(),10)');
  a.click('adv', { l: '10', m: '1' });
  const L = a.run('laneLen(site(),10)');
  a.click('adv', { l: '10', m: String(L) });
  assert.strictEqual(a.run('laneDone(site(),10)'), L);
  assert.ok(Math.abs(a.run('clearedM2(site())') - before - (L - d0)) < 1e-9);
  const last = a.json('site().progress.slice(-2)');
  assert.deepStrictEqual(last.map(p => p.day), ['2026-11-11', '2026-11-11']);
  assert.ok(last[1].to <= L + 1e-9, 'never past lane end');
});

test('new find from the Nalaz form stores lane/metre/offset and its coordinates follow the lane geometry', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack();go("nalaz")');
  const d = a.dom.document;
  d.querySelector('#fLane').value = '30'; d.querySelector('#fDist').value = '12,5'.replace(',', '.'); d.querySelector('#fOff').value = '0.3';
  d.querySelector('#fDepth').value = '9'; d.querySelector('#fQty').value = '1'; d.querySelector('#fAct').value = 'Označeno, čeka uništavanje'; d.querySelector('#fNote').value = '';
  d.querySelector('input[name="ftype"]:checked').value = 'PMA-2';
  d.querySelector('input[name="fcat"]:checked').value = 'PP';
  d.querySelector('input[name="fcond"]:checked').value = 'Neoštećeno';
  a.run('onSubmit({preventDefault(){}})');
  const f = a.json('site().finds[site().finds.length-1]');
  assert.strictEqual(f.lane, 30); assert.strictEqual(f.dist, 12.5); assert.strictEqual(f.off, 0.3);
  const p = a.json('findPos(site(),site().finds[site().finds.length-1])'), q = a.json('toGK(site(),29.8,12.5)');
  assert.ok(Math.hypot(p.Y - q.Y, p.X - q.X) < 1e-9);
});

test('"Premjesti dvojac ovdje" from a lane moves the pair working nearest / chosen, not always pair A', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack()');
  // Pairs: A lane 4, B lane 30, C lane 56. C finishes and should move to lane 60 (56 m from A, 30 m from B: allowed).
  // The button always moves pairs[0] (A) and then refuses because C (the pair that should move) is 4 m away.
  a.click('moveA', { l: '60' });
  const pairs = a.json('site().pairs.map(p=>[p.id,p.lane])');
  assert.ok(pairs.some(p => p[1] === 60), 'no pair could be moved to lane 60: ' + JSON.stringify(pairs) + ' toast: ' + a.toastText());
}, { xfail: 'F-27' });
