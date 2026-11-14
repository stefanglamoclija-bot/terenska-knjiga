'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('../lib/t');
const { loadApp, makeIndexedDB, appSource, ROOT } = require('../lib/harness');

const NOW = '2026-11-11T10:00:00';
const fresh = (o = {}) => loadApp(Object.assign({ now: NOW }, o));
const APP = fs.readFileSync(path.join(ROOT, 'src', 'app.html'), 'utf8');
const PAYLOAD = '<img src=x onerror=alert(1)>';
const RAW = /<img src=x onerror|" onerror="alert/; // a real tag or an attribute break-out (escaped text is fine)

function renderEverything(a) {
  const out = [];
  for (const id of a.json('S.sites.map(s=>s.id)')) {
    a.run(`S.active=${JSON.stringify(id)};syncPack()`);
    const keys = a.json((a.run('site().pack') === 'RS' ? 'DOCS_RS' : 'DOCS_BA') + '.map(d=>d.k)');
    for (const k of keys) { a.run(`renderDoc("${k}")`); out.push([id + ' doc ' + k, a.html('#v-izvjestaji')]); }
    a.run('docView=null;renderIzvjestaji()'); out.push([id + ' list', a.html('#v-izvjestaji')]);
    for (const t of ['danas', 'mapa', 'nalaz', 'hitno']) { a.run(`go("${t}")`); out.push([id + ' ' + t, a.html('#v-' + t)]); }
    a.run('openSites()'); out.push([id + ' sites', a.html('#sheet')]);
    out.push([id + ' header', a.el('#hdrMeta').innerHTML]);
    const lane = a.run('site().mode==="boxes"?null:1');
    if (lane) { a.run('openLane(1)'); out.push([id + ' lane sheet', a.html('#sheet')]); }
    else { a.run('openBoxB(site().boxes[0].id)'); out.push([id + ' box sheet', a.html('#sheet')]); }
  }
  return out;
}

test('XSS: text typed by the user (site name, CI, note, visit, info, monitor) is escaped everywhere', async () => {
  const a = await fresh();
  const d = a.dom.document;
  for (const [k, v] of Object.entries({ '#nsCrs': 'GK6', '#nsY': '6571898.00', '#nsX': '4922400.00', '#nsAz': '0', '#nsMsp': 'MSP ' + PAYLOAD, '#nsName': PAYLOAD, '#nsTip': 'CI', '#nsCi': PAYLOAD,
    '#nsTp': '6571898 4922400\n6571950 4922400\n6571956 4922440\n6571900 4922462' })) d.querySelector(k).value = v;
  assert.strictEqual(a.run('createSite()'), true, 'site created: ' + a.toastText());
  a.run('openSiteWork()');
  a.run(`site().finds.push({id:'N-901',cat:'PP',type:'PMA-2',lane:1,dist:2,off:0,day:today(),time:'10:00',depth:5,qty:1,cond:'Neoštećeno',act:'x',synced:false,note:${JSON.stringify(PAYLOAD + ' žica')}})`);
  for (const [k, field, val] of [['visit', '#eWho', PAYLOAD], ['info', '#eInfo', PAYLOAD], ['mon', '#eBy', PAYLOAD]]) { a.run(`openEvent("${k}")`); d.querySelector(field).value = val; a.run(`saveEvent("${k}")`); }
  a.run(`S.incident=null;`); a.click('incStart'); a.run(`S.incident.desc=${JSON.stringify(PAYLOAD)}`);
  for (const [where, h] of renderEverything(a)) { const i = h.search(RAW); assert.ok(i < 0, "unescaped payload in " + where + ": …" + h.slice(Math.max(0, i - 120), i + 40)); }
});

test('XSS: a restored backup file cannot inject markup (thumb, find id, deminer id, box id are escaped)', async () => {
  const a = await fresh({ idb: makeIndexedDB() });
  const st = a.json('S');
  const s1 = st.sites.find(s => s.id === 's1'), r1 = st.sites.find(s => s.id === 'r1');
  s1.finds[0].thumb = 'x" onerror="alert(1)';
  s1.finds[1].id = PAYLOAD;
  r1.assign[0].who = PAYLOAD;
  r1.boxes[0].done.CEIA = { day: st.sites[0].start, by: PAYLOAD };
  const txt = JSON.stringify({ app: 'terenska-knjiga', format: 1, exported: new Date(NOW).toISOString(), state: st, photos: {} });
  a.run(`onRestoreFile({text:()=>Promise.resolve(${JSON.stringify(txt)})})`);
  await a.settle(); await a.run('restoreBackup()'); await a.settle();
  const hits = renderEverything(a).filter(([, h]) => RAW.test(h)).map(([w]) => w);
  assert.deepStrictEqual(hits, [], 'payload executes in: ' + hits.slice(0, 6).join(', '));
});

test('XSS: every text field a backup can carry is escaped, in every tab, document, P6 annex, the handover bundle and the sheets', async () => {
  const a = await fresh({ idb: makeIndexedDB() });
  a.run('S.active="s1";syncPack();openOrg()'); // create the organisation block so it travels in the backup
  const st = a.json('S');
  const s1 = st.sites.find(s => s.id === 's1'), r1 = st.sites.find(s => s.id === 'r1');
  Object.assign(s1.msp, { opcina: PAYLOAD, ru: PAYLOAD, grad: PAYLOAD, kanton: PAYLOAD, entitet: PAYLOAD, kartaNaziv: PAYLOAD, infoPrije: PAYLOAD, zajednica: PAYLOAD });
  Object.assign(s1.ci, { naziv: PAYLOAD, ocekivano: PAYLOAD });
  Object.assign(s1.bh, { tok: PAYLOAD, monOrg: PAYLOAD, metoda: PAYLOAD });
  s1.pairs[0].id = PAYLOAD; s1.pairs[1].a = PAYLOAD; s1.log[0].t = PAYLOAD; s1.log[1].e = PAYLOAD;
  Object.assign(s1.finds[2], { type: PAYLOAD, cond: PAYLOAD, act: PAYLOAD, note: PAYLOAD + ' žica' });
  s1.qc[0].met = PAYLOAD; s1.info.push({ day: s1.start, t: PAYLOAD }); s1.monitors[0].by = PAYLOAD;
  st.org.naziv = PAYLOAD; st.org.ljudi[0].ime = PAYLOAD; st.org.oprema[0].tip = PAYLOAD; st.org.oprema[2].sn = PAYLOAD;
  r1.boxes[1].id = PAYLOAD; r1.feats[0].name = PAYLOAD; r1.boxes[2].excl = { why: PAYLOAD, note: PAYLOAD, day: r1.start };
  st.incident = { site: 's1', t0: Date.parse('2026-11-11T09:00:00'), day: '2026-11-11', start: '09:00', where: PAYLOAD, desc: PAYLOAD, box: null, lane: 3, dist: 2, steps: [PAYLOAD], v: { ad: PAYLOAD }, cat: PAYLOAD };
  st.queue.push({ t: PAYLOAD, at: PAYLOAD });
  const txt = JSON.stringify({ app: 'terenska-knjiga', format: 1, exported: new Date(NOW).toISOString(), state: st, photos: {} });
  a.run(`onRestoreFile({text:()=>Promise.resolve(${JSON.stringify(txt)})})`);
  await a.settle(); await a.run('restoreBackup()'); await a.settle();
  assert.ok(a.run('S.sites.find(s=>s.id==="s1").msp.opcina') === PAYLOAD, 'backup was restored');
  const out = renderEverything(a);
  a.run('S.active="s1";syncPack()');
  for (const k of ['p6a', 'p6b', 'p6c', 'p6d', 'p6e', 'p6f', 'p6g', 'p6h', 'pak', 'p12']) { a.run(`renderDoc("${k}")`); out.push(['s1 ' + k, a.html('#v-izvjestaji')]); }
  a.run('openOrg()'); out.push(['org sheet', a.html('#sheet')]);
  a.run('openSync()'); out.push(['sync sheet', a.html('#sheet')]);
  a.run('go("hitno")'); out.push(['hitno', a.html('#v-hitno')]);
  a.run('S.active="r1";syncPack();showIds=true;go("mapa")'); out.push(['r1 map ids', a.html('#v-mapa')]);
  a.run('openBoxB(site().boxes[1].id)'); out.push(['r1 box sheet', a.html('#sheet')]);
  a.run('openFeat(site().feats[0].id)'); out.push(['r1 feat sheet', a.html('#sheet')]);
  a.run('go("nalaz")'); out.push(['r1 nalaz', a.html('#v-nalaz')]);
  a.run('showIds=false');
  const hits = out.filter(([, h]) => RAW.test(h)).map(([w]) => w);
  assert.deepStrictEqual(hits, [], 'payload executes in: ' + hits.slice(0, 8).join(', '));
});

test('build output carries a Content-Security-Policy that only allows the app\'s own inline scripts (by hash)', () => {
  const built = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  const m = built.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, 'no CSP meta in docs/index.html');
  assert.ok(/script-src 'sha256-/.test(m[1]) && !/unsafe-inline'[^;]*;/.test(m[1].match(/script-src[^;]*;/)[0]), m[1]);
  const crypto = require('crypto');
  for (const s of [...built.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1])) {
    const h = crypto.createHash('sha256').update(s, 'utf8').digest('base64');
    assert.ok(m[1].includes("'sha256-" + h + "'"), 'inline script not covered by the CSP hash');
  }
  assert.ok(/connect-src 'self'/.test(m[1]) && /object-src 'none'/.test(m[1]));
});

// ---- accessibility ----
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2]]));
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const LIGHT = tokens(APP.match(/:root\{([\s\S]*?)\}/)[1]);
const DARK = tokens(APP.match(/:root\[data-theme="dark"\]\{([\s\S]*?)\}/)[1]);

test('contrast: text tokens meet WCAG AA 4.5:1 in light and dark themes', () => {
  const pairs = [['muted', 'surface'], ['muted', 'surface-2'], ['muted', 'bg'], ['ink', 'bg'], ['ink', 'work-soft'], ['ink', 'haz-soft'], ['ink', 'clr-soft'], ['on-accent', 'accent'], ['on-hazard', 'hazard'], ['hazard', 'surface-2'], ['hazard', 'surface']];
  const bad = [];
  for (const [n, t] of [['light', LIGHT], ['dark', DARK]]) for (const [f, b] of pairs) { const c = contrast(t[f], t[b]); if (c < 4.5) bad.push(`${n} ${f}/${b} ${c.toFixed(2)}`); }
  assert.deepStrictEqual(bad, []);
});

test('contrast: compliance status glyphs (✓ / !) on their tinted circles reach 4.5:1', () => {
  const bad = [];
  for (const [f, b] of [['cleared', 'clr-soft'], ['work', 'work-soft'], ['hazard', 'haz-soft']]) { const c = contrast(LIGHT[f], LIGHT[b]); if (c < 4.5) bad.push(`${f}/${b} ${c.toFixed(2)}`); }
  assert.ok(!bad.length, 'light theme: ' + bad.join(', '));
}, { xfail: 'F-24' });

// rendered width of the lane map on a 375 px phone: 375 − 2×14 main padding − 2×6 map padding − 2 border
const MAP_PX = 375 - 28 - 12 - 2;
test('tap targets: lanes on the Staze map are at least 44 px wide on a 375 px phone', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack();go("mapa")');
  const h = a.html('#v-mapa');
  const vb = +h.match(/<svg viewBox="0 0 (\d+) \d+" role="img" aria-label="Skica/)[1];
  const w = +h.match(/class="m-hit" x="[\d.]+" y="[\d.]+" width="([\d.]+)"/)[1];
  assert.ok(w * MAP_PX / vb >= 44, 'lane tap target ' + (w * MAP_PX / vb).toFixed(1) + ' px wide');
}, { xfail: 'F-16' });

test('tap targets: 10 m boxes on the Boksovi map are at least 44 px on a 375 px phone', async () => {
  const a = await fresh();
  a.run('S.active="r1";syncPack()');
  const r = a.json('(()=>{const b=bounds(site().poly);return {sc:(330-16)/(b.x1-b.x0+4),g:site().grid}})()');
  assert.ok(r.sc * r.g * MAP_PX / 330 >= 44, 'box tap target ' + (r.sc * r.g * MAP_PX / 330).toFixed(1) + ' px');
}, { xfail: 'F-16' });

test('tap targets: CSS min-heights of interactive controls are >= 44 px', () => {
  const css = APP.match(/<style>([\s\S]*?)<\/style>/)[1];
  const rules = { '.btn.sm': /\.btn\.sm\{[^}]*min-height:(\d+)px/, '.x (close)': /\.x\{[^}]*height:(\d+)px/, '.chips label span': /\.chips label span\{[^}]*min-height:(\d+)px/, '.quick .btn': /\.quick \.btn\{[^}]*min-height:(\d+)px/ };
  const bad = Object.entries(rules).map(([n, re]) => [n, +(css.match(re) || [0, 0])[1]]).filter(([, v]) => v < 44).map(([n, v]) => n + ' ' + v + 'px');
  if (!/\.linkbtn\{[^}]*min-height:(4[4-9]|[5-9]\d)px/.test(css)) bad.push('.linkbtn (reset demo data) ~27px');
  assert.ok(!bad.length, bad.join(', '));
}, { xfail: 'F-16' });

test('bottom sheet dialog has an accessible name (aria-labelledby/aria-label) and focus returns on close', async () => {
  const sheetTag = APP.match(/<div class="sheet"[^>]*>/)[0];
  assert.ok(/aria-label/.test(sheetTag) || /setAttribute\('aria-label/.test(APP), sheetTag);
  assert.ok(/lastFocus|returnFocus|\.focus\(\)[^;]*closeSheet|opener/.test(APP.match(/function closeSheet\(\)\{[^\n]*/)[0]), 'closeSheet does not restore focus');
}, { xfail: 'F-24' });

test('lanes and boxes on the maps can be reached with keyboard / screen reader (focusable, role=button)', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack();go("mapa")');
  assert.ok(/class="m-hit"[^>]*(tabindex|role="button")/.test(a.html('#v-mapa')), 'lane <rect> not focusable');
}, { xfail: 'F-24' });

// ---- offline / service worker ----
test('offline: fonts are self-hosted (no render-blocking request to fonts.googleapis.com)', () => {
  assert.ok(!/fonts\.googleapis\.com\/css2/.test(APP), 'app loads Google Fonts CSS');
});

test('service worker install bypasses the HTTP cache for the app shell (cache: "reload")', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'src', 'sw.js'), 'utf8');
  assert.ok(/cache:\s*['"](reload|no-cache)['"]/.test(sw), 'c.addAll(CORE) may store a stale index.html from the HTTP cache');
});

test('service worker tells the open app when a new version is ready (no silent stale app)', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'src', 'sw.js'), 'utf8');
  assert.ok(/postMessage|controllerchange|updatefound/.test(sw + APP), 'no update notification path');
});

test('build output docs/index.html contains the current src/app.html script (rebuild after editing src)', () => {
  const built = appSource(path.join(ROOT, 'docs', 'index.html'));
  assert.ok(built === appSource(), 'docs/index.html is stale: run ./build.sh');
});

// ---- input validation ----
test('new site: a third column (H, elevation) in the lomne tačke is not merged into X', async () => {
  const a = await fresh();
  const p = a.json('parseTPs("6571898 4922400 512\\n6 571 950,00 4 922 400,00 498")');
  assert.deepStrictEqual(p, [[6571898, 4922400], [6571950, 4922400]], JSON.stringify(p));
});

test('new site: a mistyped lomna tačka 100 km away is rejected instead of freezing the app', () => {
  const child = `
    const h=require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'harness.js'))});
    (async()=>{const a=await h.loadApp({now:'${NOW}'});const d=a.dom.document;
      const v={'#nsCrs':'GK6','#nsY':'6571898','#nsX':'4922400','#nsAz':'0','#nsMsp':'MSP 1','#nsName':'x','#nsTip':'CI','#nsCi':'CI-1',
        '#nsTp':'6571898 4922400\\n6571950 4922400\\n6571956 5022440\\n6571900 4922462'};
      for(const k in v)d.querySelector(k).value=v[k];
      a.run('createSite()');console.log('DONE '+a.run('S.sites.length')+' '+a.toastText());process.exit(0);})();`;
  const r = spawnSync(process.execPath, ['-e', child], { timeout: 8000, encoding: 'utf8', env: process.env });
  assert.ok(!r.error && /DONE 3 /.test(r.stdout) && /100,0 km od nulte tačke/.test(r.stdout), r.error ? 'app froze (killed after 8 s) while drawing the 100 km site' : 'site accepted or wrong reason: ' + r.stdout.trim());
}, { timeout: 15000 });

test('new BiH site: wrong zone, swapped Y/X, a self-crossing boundary, an absurd area and a polygon left of the NT are rejected with a message', async () => {
  const a = await fresh();
  const d = a.dom.document;
  const base = { '#nsCrs': 'GK6', '#nsY': '6571898', '#nsX': '4922400', '#nsAz': '0', '#nsMsp': 'MSP 1', '#nsName': 'x', '#nsTip': 'CI', '#nsCi': 'CI-1', '#nsPmin': '', '#nsPmax': '', '#nsOpc': '', '#nsRu': '',
    '#nsTp': '6571898 4922400\n6571950 4922400\n6571956 4922440\n6571900 4922462' };
  const tryIt = over => { for (const [k, v] of Object.entries(Object.assign({}, base, over))) d.querySelector(k).value = v; return a.json('checkNewSiteBA()'); };
  assert.ok(tryIt({}).site, 'the valid dosije passes: ' + JSON.stringify(tryIt({}).err));
  assert.match(tryIt({ '#nsY': '4922400', '#nsX': '6571898' }).err, /Nulta tačka nije u BiH/);
  assert.match(tryIt({ '#nsCrs': 'UTM34' }).err, /Nulta tačka nije u BiH/);
  assert.match(tryIt({ '#nsTp': '6571898 4922400\n6571956 4922440\n6571950 4922400\n6571900 4922462' }).err, /siječe sama sa sobom/);
  assert.match(tryIt({ '#nsY': '6571950', '#nsTp': '6571898 4922400\n6571950 4922400\n6571956 4922440\n6571900 4922462' }).err, /lijevo od nulte tačke/);
  assert.match(tryIt({ '#nsPmin': '20000', '#nsPmax': '25000' }).err, /ne odgovara površini iz dosijea/);
  assert.match(tryIt({ '#nsTp': '6571898 4922400\n6571950 4922400 512 7' }).err, /očekuju se 2 broja/);
  const ok = tryIt({ '#nsTp': '6571898 4922400 512\n6571950 4922400 498\n6571956 4922440 501\n6571900 4922462 503' });
  assert.ok(ok.site && ok.info.some(x => /visina H\) zanemarena u 4/.test(x)), JSON.stringify(ok.info || ok.err));
  assert.strictEqual(a.run('S.sites.length'), 3, 'checking never creates a site');
});
