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
  for (const [k, v] of Object.entries({ '#nsCrs': 'GK6', '#nsY': '6571900.00', '#nsX': '4922400.00', '#nsAz': '0', '#nsMsp': 'MSP ' + PAYLOAD, '#nsName': PAYLOAD, '#nsTip': 'CI', '#nsCi': PAYLOAD,
    '#nsTp': '6571898 4922400\n6571950 4922400\n6571956 4922440\n6571900 4922462' })) d.querySelector(k).value = v;
  a.run('createSite();openSiteWork()');
  a.run(`site().finds.push({id:'N-901',cat:'PP',type:'PMA-2',lane:1,dist:2,off:0,day:TODAY,time:'10:00',depth:5,qty:1,cond:'Neoštećeno',act:'x',synced:false,note:${JSON.stringify(PAYLOAD + ' žica')}})`);
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
}, { xfail: 'F-07' });

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
}, { xfail: 'F-19' });

test('service worker install bypasses the HTTP cache for the app shell (cache: "reload")', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'src', 'sw.js'), 'utf8');
  assert.ok(/cache:\s*['"](reload|no-cache)['"]/.test(sw), 'c.addAll(CORE) may store a stale index.html from the HTTP cache');
}, { xfail: 'F-18' });

test('service worker tells the open app when a new version is ready (no silent stale app)', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'src', 'sw.js'), 'utf8');
  assert.ok(/postMessage|controllerchange|updatefound/.test(sw + APP), 'no update notification path');
}, { xfail: 'F-18' });

test('build output docs/index.html contains the current src/app.html script (rebuild after editing src)', () => {
  const built = appSource(path.join(ROOT, 'docs', 'index.html'));
  assert.ok(built === appSource(), 'docs/index.html is stale: run ./build.sh');
});

// ---- input validation ----
test('new site: a third column (H, elevation) in the lomne tačke is not merged into X', async () => {
  const a = await fresh();
  const p = a.json('parseTPs("6571898 4922400 512\\n6 571 950,00 4 922 400,00 498")');
  assert.deepStrictEqual(p, [[6571898, 4922400], [6571950, 4922400]], JSON.stringify(p));
}, { xfail: 'F-12' });

test('new site: a mistyped lomna tačka 100 km away is rejected instead of freezing the app', () => {
  const child = `
    const h=require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'harness.js'))});
    (async()=>{const a=await h.loadApp({now:'${NOW}'});const d=a.dom.document;
      const v={'#nsCrs':'GK6','#nsY':'6571900','#nsX':'4922400','#nsAz':'0','#nsMsp':'MSP 1','#nsName':'x','#nsTip':'CI','#nsCi':'CI-1',
        '#nsTp':'6571898 4922400\\n6571950 4922400\\n6571956 5022440\\n6571900 4922462'};
      for(const k in v)d.querySelector(k).value=v[k];
      a.run('createSite()');console.log('DONE '+a.run('S.sites.length')+' '+a.toastText());process.exit(0);})();`;
  const r = spawnSync(process.execPath, ['-e', child], { timeout: 8000, encoding: 'utf8', env: process.env });
  assert.ok(!r.error && /DONE 3 /.test(r.stdout), r.error ? 'app froze (killed after 8 s) while drawing the 100 km site' : 'site accepted: ' + r.stdout.trim());
}, { xfail: 'F-12', timeout: 15000 });
