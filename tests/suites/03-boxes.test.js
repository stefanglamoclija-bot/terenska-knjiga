'use strict';
const assert = require('assert');
const { test } = require('../lib/t');
const { loadApp } = require('../lib/harness');

const NOW = '2026-11-11T10:00:00';
const fresh = () => loadApp({ now: NOW });

function inPoly(pt, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
function distSeg(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
function onOrIn(p, poly, tol = 0.02) { if (inPoly(p, poly)) return true; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (distSeg(p, poly[j], poly[i]) < tol) return true; return false; }

// polygons in local metres: the RS seed, a concave "U", a thin diagonal strip and a large irregular one
const POLYS = {
  seed: null,
  concaveU: [[0, 0], [60, 0], [60, 50], [42, 50], [42, 15], [18, 15], [18, 50], [0, 50]],
  diagonal: [[0, 0], [8, 0], [90, 70], [82, 70]],
  irregular: [[3, 7], [57, 1], [121, 33], [109, 88], [64, 71], [40, 97], [6, 64]],
};

async function siteWith(poly, size) {
  const a = await fresh();
  a.run(`(()=>{const s={id:'t',pack:'RS',crs:'UTM34',mode:'boxes',nt:{Y:456000,X:4953000},az:0,poly:${JSON.stringify(poly)},boxes:[],assign:[],finds:[]};makeBoxes(s,${size});globalThis.__s=s;})()`);
  return { a, s: a.json('__s') };
}
const area = poly => { let s = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]); return Math.abs(s / 2); };

test('seeded Serbian site: box areas (excluded boxes included) sum to the boundary polygon area (±0,5%)', async () => {
  const a = await fresh();
  a.run('S.active="r1";syncPack()');
  // the seed has an excluded box (H-03, building): it is still a box, but totalArea() leaves it out of the area to search
  const r = a.json('({sum:site().boxes.reduce((x,b)=>x+b.area,0),A:polyArea(site().poly)})');
  assert.ok(Math.abs(r.sum - r.A) / r.A <= 0.005, `${r.sum} vs ${r.A}`);
});

for (const [name, poly] of Object.entries(POLYS).filter(([, p]) => p)) for (const size of [10, 20, 25]) {
  test(`grid ${size}×${size} on ${name}: clipped areas sum to polygon area ±0,5%`, async () => {
    const { s } = await siteWith(poly, size);
    const sum = s.boxes.reduce((x, b) => x + b.area, 0), A = area(poly);
    assert.ok(Math.abs(sum - A) / A <= 0.005, `${sum.toFixed(1)} vs ${A} (${((sum / A - 1) * 100).toFixed(2)}%)`);
  });
}

test('no sliver of the boundary polygon is silently dropped from the box grid (boxes < 4 m² are discarded)', async () => {
  const lost = [];
  for (const [name, poly] of Object.entries(POLYS).filter(([, p]) => p)) for (const size of [10, 25]) {
    const { s } = await siteWith(poly, size);
    const sum = s.boxes.reduce((x, b) => x + b.area, 0), A = area(poly);
    if (A - sum > 0.5) lost.push(`${name}/${size} m: ${(A - sum).toFixed(1)} m² not in any box`);
  }
  const a = await fresh(); a.run('S.active="r1"');
  const r = a.json('({sum:site().boxes.reduce((x,b)=>x+b.area,0),A:totalArea(site())})');
  if (r.A - r.sum > 0.5) lost.push(`seed r1: ${(r.A - r.sum).toFixed(1)} m² not in any box`);
  assert.ok(!lost.length, lost.join('; '));
});

async function allCases() {
  const out = [];
  const a = await fresh(); out.push(['seed', a.json('S.sites.find(x=>x.id==="r1")'), 10]);
  for (const [n, p] of Object.entries(POLYS).filter(([, p]) => p)) for (const sz of [10, 20, 25]) out.push([n, (await siteWith(p, sz)).s, sz]);
  return out;
}

test('box ids are unique, every box stays inside its own grid cell(s), stored area matches its parts', async () => {
  for (const [name, s, size] of await allCases()) {
    const ids = new Set();
    for (const b of s.boxes) {
      assert.ok(!ids.has(b.id), `${name}/${size}: duplicate id ${b.id}`); ids.add(b.id);
      // a sliver merged into its neighbour makes a box of two cells: check against the box's own extent
      for (const q of b.poly) assert.ok(q[0] >= b.x0 - 0.01 && q[0] <= b.x0 + b.w + 0.01 && q[1] >= b.y0 - 0.01 && q[1] <= b.y0 + b.h + 0.01, `${name}: ${b.id} vertex outside its cell(s)`);
      assert.ok(b.w <= 2 * size + 0.01 && b.h <= 2 * size + 0.01, `${name}: ${b.id} spans more than two cells`);
      const parts = b.parts && b.parts.length ? b.parts : [b.poly];
      assert.ok(Math.abs(parts.reduce((x, p) => x + area(p), 0) - b.area) < 0.2, `${name}/${size}: ${b.id} stored area ${b.area} vs parts`);
    }
  }
});

test('no box polygon has a vertex outside the boundary (clipping a concave boundary leaves zero-width spikes)', async () => {
  const bad = [];
  for (const [name, s, size] of await allCases())
    for (const b of s.boxes) for (const q of b.poly) if (!onOrIn(q, s.poly)) { bad.push(`${name}/${size}: ${b.id} vertex ${q}`); break; }
  assert.deepStrictEqual(bad, [], bad.length + ' boxes: ' + bad.slice(0, 5).join('; '));
});

test('box label/sort point (cx,cy) lies inside its box (concave boundary)', async () => {
  const bad = [];
  for (const [name, poly] of Object.entries(POLYS).filter(([, p]) => p)) for (const size of [20, 25]) {
    const { s } = await siteWith(poly, size);
    for (const b of s.boxes) if (!inPoly([b.cx, b.cy], b.poly)) bad.push(`${name}/${size}:${b.id}`);
  }
  assert.ok(!bad.length, bad.length + ' boxes: ' + bad.slice(0, 6).join(', '));
});

test('methodM2 / clearedM2 / perDeminer are consistent sums over boxes, per method and per day', async () => {
  const a = await fresh();
  a.run('S.active="r1";syncPack()');
  const s = a.json('site()');
  for (const m of ['CEIA', 'SCH']) {
    const exp = s.boxes.filter(b => b.done[m]).reduce((x, b) => x + b.area, 0);
    assert.ok(Math.abs(a.run(`methodM2(site(),'${m}')`) - exp) < 1e-9, m);
    const days = [...new Set(s.boxes.filter(b => b.done[m]).map(b => b.done[m].day))];
    for (const d of days) {
      const pd = a.json(`perDeminer(site(),'${d}')`);
      const sum = Object.values(pd).reduce((x, r) => x + r.m2[m], 0);
      assert.ok(Math.abs(sum - a.run(`methodM2(site(),'${m}','${d}')`)) < 1e-9, `${m} ${d}`);
      for (const [who, r] of Object.entries(pd)) for (const id of r[m]) assert.strictEqual(s.boxes.find(b => b.id === id).done[m].by, who);
    }
  }
  // a box sent back by the CZRS inspector (b.ret) is not cleared even though its methods were done once
  const cleared = s.boxes.filter(b => !b.ret && b.need.every(m => b.done[m])).reduce((x, b) => x + b.area, 0);
  assert.ok(Math.abs(a.run('clearedM2(site())') - cleared) < 1e-9);
  assert.ok(a.run('clearedM2(site())') <= a.run('methodM2(site(),"CEIA")') + 1e-9, 'cleared never exceeds CEIA area');
});

test('nextBoxFor never hands the same box+method to two deminers, never a done one, Schonstedt only after CEIA (full day simulation)', async () => {
  const a = await fresh();
  a.run('S.active="r1";syncPack()');
  let steps = 0, rnd = 7;
  const check = () => {
    const s = a.json('site()');
    const keys = s.assign.map(x => x.box + '|' + x.m);
    assert.strictEqual(new Set(keys).size, keys.length, 'duplicate assignment: ' + keys.join(','));
    for (const x of s.assign) {
      const b = s.boxes.find(bb => bb.id === x.box);
      assert.ok(b, 'assigned unknown box ' + x.box);
      assert.ok(!b.done[x.m], `assigned already-done ${x.box} ${x.m}`);
      if (x.m === 'SCH') assert.ok(b.done.CEIA, `Schonstedt before CEIA in ${x.box}`);
    }
  };
  check();
  while (steps++ < 400) {
    const s = a.json('site()');
    if (!s.assign.length) break;
    rnd = (rnd * 1103515245 + 12345) % 2147483648;
    const pick = s.assign[rnd % s.assign.length];
    a.click('boxDone', { w: pick.who });
    check();
  }
  const s = a.json('site()');
  const left = s.boxes.filter(b => !b.excl && !b.done.CEIA).length; // excluded boxes are never searched
  assert.strictEqual(left, 0, left + ' boxes never got CEIA');
});

test('opening a new Serbian site assigns 4 different boxes to 4 deminers', async () => {
  const a = await fresh();
  const d = a.dom.document;
  d.querySelector('#nsTp').value = '457 010 4 955 020\n457 080 4 955 000\n457 105 4 955 060\n457 060 4 955 110\n457 000 4 955 090';
  d.querySelector('#nsGrid').value = '10'; d.querySelector('#nsMsp').value = 'ID 0322/26'; d.querySelector('#nsName').value = 'Kosa'; d.querySelector('#nsSek').value = 'Sektor 1';
  a.run('createSiteRS()');
  a.run('openSiteWork()');
  const s = a.json('site()');
  assert.strictEqual(s.assign.length, 4);
  assert.strictEqual(new Set(s.assign.map(x => x.box)).size, 4);
  assert.ok(Math.abs(s.boxes.reduce((x, b) => x + b.area, 0) - area(s.poly)) / area(s.poly) < 0.005);
});

test('split a box in two, merge the parts back: the box gets its original name and area back', async () => {
  const a = await fresh();
  a.run('S.active="r1";syncPack()');
  const r = a.json(`(()=>{const s=site(),b=s.boxes.find(x=>!x.excl&&!x.ret&&x.rects.length===1&&Math.abs(x.area-100)<0.01),id=b.id,A=b.area;
    const parts=splitBox(s,id,'u').map(k=>k.id),nb=mergeBoxes(s,parts);
    // merging only some parts of a box split into 4 keeps the first part's name (the other parts still exist)
    const q=splitBox(s,id,'4').map(k=>k.id),half=mergeBoxes(s,[q[0],q[1]]);
    return {id,A,parts,merged:nb.id,area:nb.area,half:half.id,left:s.boxes.filter(x=>x.id.startsWith(id)).map(x=>x.id).sort()};})()`);
  assert.deepStrictEqual(r.parts, [r.id + 'a', r.id + 'b']);
  assert.strictEqual(r.merged, r.id, 'merged back under the original name');
  assert.ok(Math.abs(r.area - r.A) < 0.01, `${r.area} vs ${r.A}`);
  assert.strictEqual(r.half, r.id + 'a', 'partial merge keeps the first part name');
  assert.deepStrictEqual(r.left, [r.id + 'a', r.id + 'c', r.id + 'd']);
});
