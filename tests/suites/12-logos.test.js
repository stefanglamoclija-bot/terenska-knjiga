'use strict';
// Organisation logos: contractor (S.logos.org) and inspection institution (S.logos.insp). A picked file is only ever
// rasterised to a PNG data URL by the app's own canvas; nothing else is stored, shown, backed up or restored.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('../lib/t');
const { loadApp, makeLocalStorage, makeIndexedDB } = require('../lib/harness');

const NOW = '2026-11-11T10:00:00';
const KEY = 'terenska-knjiga-v3';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNkYPhfz0AEYBxVSF8AAGaeAgXcGbm3AAAAAElFTkSuQmCC';
const FIX = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', n), 'utf8'));
const file = (type, name, size = 2048) => `({type:${JSON.stringify(type)},name:${JSON.stringify(name)},size:${size}})`;

// the rasteriser is replaced by a recorder: the tests see what reaches it and what comes back
function stubRaster(a, out = PNG) {
  a.run(`globalThis.__rc=[];rasterLogo=f=>{__rc.push(f.type||f.name);return Promise.resolve(${JSON.stringify(out)});}`);
  return () => a.json('__rc');
}
async function upload(a, kind, f) {
  const r = await a.run(`onLogoFile(${JSON.stringify(kind)},{files:[${f}],value:'x'})`);
  await a.settle();
  return r && JSON.parse(JSON.stringify(r));
}
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

test('logo upload: a non-image file is rejected before the rasteriser; PNG, JPG and SVG all go through the rasteriser', async () => {
  const a = await loadApp({ now: NOW });
  a.run("S.ui='bs'");
  const calls = stubRaster(a);
  for (const f of [file('text/plain', 'logo.txt'), file('text/html', 'logo.html'), file('application/pdf', 'x.pdf'), file('', 'logo.exe'), file('image/gif', 'logo.gif')]) {
    const r = await upload(a, 'org', f);
    assert.ok(r && r.err, 'not rejected: ' + f);
  }
  assert.deepStrictEqual(calls(), [], 'the rasteriser was called for a non-image');
  assert.ok(!a.run('S.logos&&S.logos.org'), 'nothing stored');
  assert.ok(/PNG, JPG ili SVG/.test(a.toastText()), a.toastText());
  const big = await upload(a, 'org', file('image/png', 'huge.png', 9 * 1048576));
  assert.ok(big.err && calls().length === 0, 'an 8 MB+ file is not decoded');
  for (const f of [file('image/png', 'a.png'), file('image/jpeg', 'a.jpg'), file('image/svg+xml', 'a.svg'), file('', 'b.svg')]) await upload(a, 'org', f);
  assert.deepStrictEqual(calls(), ['image/png', 'image/jpeg', 'image/svg+xml', 'b.svg']);
  assert.strictEqual(a.run('S.logos.org'), PNG);
});

test('logo upload: only a PNG data URL from the canvas is kept (no SVG markup, no other data URL, size cap)', async () => {
  const a = await loadApp({ now: NOW });
  for (const bad of ['<svg onload="alert(1)"/>', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,/9j/4AAQ', 'javascript:alert(1)',
    'data:image/png;base64,' + 'A'.repeat(400000), 'data:image/png;base64,AAA" onerror="x']) {
    stubRaster(a, bad);
    const r = await upload(a, 'org', file('image/svg+xml', 'evil.svg'));
    assert.ok(r && r.err, 'accepted: ' + bad.slice(0, 40));
    assert.ok(!a.run('S.logos&&S.logos.org'), 'stored: ' + bad.slice(0, 40));
  }
});

test('logo rasteriser: draws the decoded image on a canvas, downscales to 512 px and returns PNG; SVG is drawn, never inserted', async () => {
  const a = await loadApp({ now: NOW });
  a.run(`globalThis.__draw=[];globalThis.__cv=[];
    Image=class{set src(u){this._u=u;this.naturalWidth=this._w||2048;this.naturalHeight=this._h||1024;Promise.resolve().then(()=>this.onload());}};
    document.createElement=tag=>{const c={tag,width:0,height:0,getContext:()=>({drawImage:(img,x,y,w,h)=>__draw.push([w,h])}),toDataURL:t=>t==='image/png'?${JSON.stringify(PNG)}:'data:image/jpeg;base64,AA'};__cv.push(c);return c;};`);
  const u = await a.run(`rasterLogo(${file('image/png', 'big.png')})`);
  assert.strictEqual(u, PNG);
  assert.deepStrictEqual(a.json('__draw'), [[512, 256]], 'not downscaled to 512 px on the long side');
  assert.ok(a.json('__cv').every(c => c.tag === 'canvas'));
  // a small SVG is drawn up to 512 px (it is vector), still through the canvas
  a.run(`__draw.length=0;Image=class{set src(u){this.naturalWidth=64;this.naturalHeight=32;Promise.resolve().then(()=>this.onload());}}`);
  await a.run(`rasterLogo(${file('image/svg+xml', 'mark.svg')})`);
  assert.deepStrictEqual(a.json('__draw'), [[512, 256]]);
  // an image that does not decode is an error, not a stored logo
  a.run(`Image=class{set src(u){Promise.resolve().then(()=>this.onerror());}}`);
  const r = await a.run(`logoFromFile(${file('image/png', 'broken.png')})`);
  assert.ok(r.err);
});

test('logos persist across a reload and can be removed', async () => {
  const storage = makeLocalStorage(), idb = makeIndexedDB();
  const a = await loadApp({ now: NOW, storage, idb });
  stubRaster(a, PNG);
  await upload(a, 'org', file('image/png', 'org.png'));
  stubRaster(a, PNG2);
  await upload(a, 'insp', file('image/png', 'czrs.png'));
  await a.run('saveQ');
  const b = await loadApp({ now: NOW, storage, idb });
  assert.deepStrictEqual(b.json('S.logos'), { org: PNG, insp: PNG2 });
  b.run('S.active="s1";syncPack();openOrg()');
  assert.ok(b.html('#sheet').includes('data-bh="logoDel" data-k="org"'), 'remove button');
  // the Organizacija sheet's buttons are data-bh (one delegated click handler)
  const el = Object.assign(b.dom.makeEl('[data-bh]'), { dataset: { bh: 'logoDel', k: 'org' } });
  el.closest = sel => (sel === '[data-bh]' ? el : null);
  (b.dom.listeners.click || []).forEach(fn => fn({ target: el }));
  assert.deepStrictEqual(b.json('S.logos'), { insp: PNG2 });
  assert.ok(/data-logo="org"/.test(b.html('#sheet')) && /Dodaj logo|Add logo/.test(b.html('#sheet')), 'empty uploader with a placeholder after removal');
});

test('logos appear in the header and at the top of the documents: contractor on contractor documents, institution on KK and ZK', async () => {
  const a = await loadApp({ now: NOW });
  // no logos: no image anywhere, an empty uploader with a placeholder in the Organizacija sheet
  a.run('S.active="s1";syncPack();renderHeader();docView=null;renderDoc("p9")');
  assert.ok(a.el('#hdrLogo').hidden, 'header logo shown without a logo');
  assert.ok(!/class="dlogo"/.test(a.html('#v-izvjestaji')));
  a.run('openOrg()');
  assert.ok(/class="logo-pv empty"/.test(a.html('#sheet')) && /data-logo="org"/.test(a.html('#sheet')) && !/data-logo="insp"/.test(a.html('#sheet')));
  a.run('S.logos={org:' + JSON.stringify(PNG) + ',insp:' + JSON.stringify(PNG2) + '};closeSheet()');
  a.run('renderHeader()');
  assert.strictEqual(a.el('#hdrLogo').hidden, false);
  assert.strictEqual(a.el('#hdrLogo').src, PNG);
  for (const k of ['p9', 'p10', 'p13', 'zb', 'pak']) {
    a.run(`renderDoc("${k}")`);
    const h = a.html('#v-izvjestaji');
    assert.ok(h.includes('<div class="dlogo"><img src="' + PNG + '"'), 'BiH ' + k + ' without the contractor logo');
    assert.ok(!h.includes(PNG2), 'BiH ' + k + ' shows the inspection logo');
  }
  a.run('renderDoc("exp")');
  assert.ok(!/class="dlogo"/.test(a.html('#v-izvjestaji')), 'export screen is not a document');
  // Serbian site, contractor role: contractor logo on contractor documents
  a.run('S.active="r1";syncPack();qa(site()).role="izv";renderHeader()');
  assert.strictEqual(a.el('#hdrLogo').src, PNG);
  for (const k of ['rsd', 'rsn', 'zb']) { a.run(`renderDoc("${k}")`); assert.ok(a.html('#v-izvjestaji').includes('img src="' + PNG + '"'), 'RS ' + k); }
  // inspector role: institution logo in the header and on KK / ZK; the institution uploader is offered
  a.run('qa(site()).role="czrs";renderHeader()');
  assert.strictEqual(a.el('#hdrLogo').src, PNG2);
  for (const k of ['kk', 'zk']) {
    a.run(`renderDoc("${k}")`);
    const h = a.html('#v-izvjestaji');
    assert.ok(h.includes('<div class="dlogo"><img src="' + PNG2 + '"') && !h.includes(PNG), 'RS ' + k + ' without the institution logo');
  }
  a.run('openOrg()');
  assert.ok(/data-logo="insp"/.test(a.html('#sheet')) && /data-logo="org"/.test(a.html('#sheet')));
});

test('logos: backup -> restore round trip; malformed logos in a backup are dropped, never shown', async () => {
  const a = await loadApp({ now: NOW, idb: makeIndexedDB() });
  a.run('S.logos={org:' + JSON.stringify(PNG) + ',insp:' + JSON.stringify(PNG2) + '};save()');
  await a.run('saveQ');
  const txt = await makeBackup(a);
  assert.strictEqual(JSON.parse(txt).state.logos.org, PNG);
  const b = await loadApp({ now: NOW, idb: makeIndexedDB() });
  await restore(b, txt);
  assert.deepStrictEqual(b.json('S.logos'), { org: PNG, insp: PNG2 });
  // a crafted backup: SVG markup, a non-PNG data URL, an oversized PNG, a non-string and unknown keys
  const bad = JSON.parse(txt);
  bad.state.logos = { org: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+', insp: '"><script>alert(1)</script>', x: PNG, __proto__: { org: PNG } };
  const c = await loadApp({ now: NOW, idb: makeIndexedDB() });
  await restore(c, JSON.stringify(bad));
  assert.deepStrictEqual(c.json('S.logos'), {});
  c.run('S.active="s1";syncPack();renderHeader();renderDoc("p9")');
  assert.ok(c.el('#hdrLogo').hidden && !/<script>|svg\+xml/.test(c.html('#v-izvjestaji')));
  for (const v of [42, 'x', ['a'], { org: 'data:image/png;base64,' + 'A'.repeat(400000) }]) {
    const st = c.json('(x=>checkState(x))(' + JSON.stringify(Object.assign({}, bad.state, { logos: v })) + ')').logos;
    assert.deepStrictEqual(st, {}, JSON.stringify(v).slice(0, 30));
  }
});

test('old state without logos loads: no logo in the header or documents, every screen renders', async () => {
  const storage = makeLocalStorage({ [KEY]: JSON.stringify(FIX('state-v3.json')) });
  const a = await loadApp({ now: NOW, storage });
  assert.ok(!a.run('S.logos'), 'logos invented for an old state');
  for (const id of ['r1', 's1', 's2']) {
    a.run(`S.active="${id}";syncPack();renderHeader()`);
    assert.ok(a.el('#hdrLogo').hidden);
    for (const t of ['danas', 'mapa', 'nalaz', 'izvjestaji', 'hitno']) a.run(`go("${t}")`);
    a.run('openOrg()');
    assert.ok(/logo-pv empty/.test(a.html('#sheet')));
    a.run('closeSheet()');
  }
});
