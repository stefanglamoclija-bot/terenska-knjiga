'use strict';
// Interface language: t() keys and dictionaries, English screens without national UI words, documents and stored text
// always national, number/date formats, the per-device setting and <html lang>.
const assert = require('assert');
const { test } = require('../lib/t');
const { loadApp, makeLocalStorage, appSource } = require('../lib/harness');

const NOW = '2026-11-11T10:00:00';
const fresh = (o = {}) => loadApp(Object.assign({ now: NOW }, o));
const SRC = appSource();

// Common Bosnian/Serbian UI words (whole words, any case). None of them may be left on an English screen once stored data
// (names, notes, log entries typed in the field) and official form names are taken out.
const NATIONAL = ['Sačuvaj', 'Danas', 'Izvještaji', 'Izveštaji', 'Dodaj', 'nalaz', 'nalaza', 'nalazi', 'staza', 'staze', 'stazi', 'boks', 'boksa',
  'boksova', 'Boksovi', 'Otvori', 'Zatvori', 'Odustani', 'Obriši', 'Upiši', 'Napravi', 'Pregled', 'Kontrola', 'Hitno', 'radilište', 'Radilišta',
  'dnevnik', 'dnevniku', 'podaci', 'Podaci', 'uređaju', 'rezervna', 'kopija', 'kopiju', 'Štampaj', 'Kopiraj', 'Uvećaj', 'dvojac', 'smjena', 'smena',
  'dubina', 'nesreća', 'nesreće', 'Prijavi', 'Završi', 'završeno', 'Početak', 'Nema', 'nema', 'nije', 'samo', 'još', 'ili', 'koji', 'tačka', 'tačke',
  'lomne', 'nulta', 'površina', 'izvođač', 'kontrolor', 'poseta', 'posjeta', 'uzorak', 'nedostatak', 'čeka', 'u toku', 'Sinhronizacija', 'Jezik'];
const NAT_RE = new RegExp('(?<![\\p{L}\\d])(?:' + NATIONAL.join('|') + ')(?![\\p{L}\\d])', 'giu');
const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// text a user sees or hears: tags out, document bodies out, svg labels and accessible names kept
function visible(html) {
  return html.replace(/<article class="doc[\s\S]*?<\/article>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, m => (m.match(/<(?:text|title)[^>]*>[^<]*</g) || []).join(' '))
    .replace(/<[^>]+>/g, m => ' ' + [...m.matchAll(/(?:aria-label|placeholder|title|alt)="([^"]*)"/g)].map(x => x[1]).join(' ') + ' ');
}
// everything stored in the state, plus the official form names (kept national on purpose, with an English gloss)
function exempt(a) {
  const out = new Set();
  const walk = x => { if (typeof x === 'string') { if (x.length > 1) out.add(x); } else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
  walk(a.json('S'));
  for (const id of a.json('S.sites.map(s=>s.id)')) {
    a.run(`S.active=${JSON.stringify(id)};syncPack()`);
    a.json('inDoc(site(),()=>(site().pack==="RS"?DOCS_RS:DOCS_BA).map(d=>d.t))').forEach(x => out.add(x));
    out.add(a.run('site().msp.id+" · "+site().ci.oznaka'));
  }
  return [...out].sort((p, q) => q.length - p.length).map(escH);
}
function leftovers(html, ex) {
  let v = visible(html);
  for (const d of ex) if (v.includes(d)) v = v.replace(new RegExp('(?<![\\p{L}\\d])' + reEsc(d) + '(?![\\p{L}\\d])', 'gu'), ' ');
  return [...v.matchAll(NAT_RE)].map(m => m[0] + ' «' + v.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ').trim() + '»');
}

// every screen, sheet and document view of every demo site (and both roles on the Serbian box site)
function renderAll(a) {
  const out = [];
  const shot = (label, expr, sel) => { a.run(expr); out.push([label, sel ? a.html(sel) : '']); };
  for (const id of a.json('S.sites.map(s=>s.id)')) {
    const boxes = a.run(`S.sites.find(s=>s.id===${JSON.stringify(id)}).mode==="boxes"`);
    for (const role of boxes ? ['izv', 'czrs'] : [null]) {
      const p = id + (role ? '/' + role : '') + ' ';
      a.run(`S.active=${JSON.stringify(id)};syncPack();docView=null;closeSheet()` + (role ? `;qa(site()).role="${role}"` : ''));
      a.run('renderHeader()');
      out.push([p + 'header', a.html('#hdrMeta') + ' ' + a.el('#syncLabel').innerHTML + ' ' + a.el('#syncBtn').getAttribute('aria-label') + ' ' +
        ['danas', 'mapa', 'nalaz', 'izvjestaji', 'hitno'].map(t => a.el(`.tab[data-tab="${t}"]`).lastChild.textContent).join(' ')]);
      for (const t of ['danas', 'mapa', 'nalaz', 'izvjestaji', 'hitno']) shot(p + 'tab ' + t, `go("${t}")`, '#v-' + t);
      const docs = a.json('(site().pack==="RS"?DOCS_RS:DOCS_BA).map(d=>d.k)');
      for (const k of docs) shot(p + 'doc ' + k, `docView=${JSON.stringify(k)};renderDoc(${JSON.stringify(k)})`, '#v-izvjestaji');
      shot(p + 'doc list', 'docView=null;renderIzvjestaji()', '#v-izvjestaji');
      shot(p + 'sync sheet', 'openSync()', '#sheet');
      shot(p + 'sites sheet', 'openSites()', '#sheet');
      shot(p + 'new site', 'openNewSite()', '#sheet');
      shot(p + 'reset 1', 'openReset(1)', '#sheet');
      shot(p + 'reset 2', 'openReset(2)', '#sheet');
      if (!boxes) { shot(p + 'lane', 'openLane(4)', '#sheet'); shot(p + 'org', 'openOrg()', '#sheet'); shot(p + 'accident place', 'openIncidentPlace()', '#sheet'); }
      else { shot(p + 'box', 'openBoxB(site().boxes[0].id)', '#sheet'); shot(p + 'feature', 'openFeat()', '#sheet'); if (role === 'czrs') shot(p + 'box K', 'openBoxK(site().boxes[0].id)', '#sheet'); }
      for (const ev of ['det', 'qc', 'mon', 'dem', 'visit', 'info']) shot(p + 'event ' + ev, `openEvent("${ev}")`, '#sheet');
      a.run('closeSheet()');
    }
  }
  return out;
}

test('every t() key used in the code exists in bs, sr and en', async () => {
  const a = await fresh();
  const keys = new Set([...SRC.matchAll(/\bt\(\s*'([^'\\]+)'\s*[,)]/g)].map(m => m[1]));
  assert.ok(keys.size > 500, 'only ' + keys.size + ' keys found: is the scan right?');
  for (const L of ['bs', 'sr', 'en']) {
    const have = new Set(a.json(`Object.keys(I18N.${L})`));
    const missing = [...keys].filter(k => !have.has(k));
    assert.deepStrictEqual(missing, [], L + ' is missing keys used in the code');
  }
  // keys built at run time (lang.<option>, the inspector and box-grid families) resolve too
  for (const o of a.json('UI_OPTS')) assert.ok(a.json(`I18N.en["lang.${o}"]`), 'lang.' + o);
});

test('the three dictionaries have the same keys, the same placeholders, valid plurals and no markup risks', async () => {
  const a = await fresh();
  const D = a.json('I18N');
  const ks = L => Object.keys(D[L]).sort();
  assert.deepStrictEqual(ks('sr'), ks('bs'), 'sr and bs keys differ');
  assert.deepStrictEqual(ks('en'), ks('bs'), 'en and bs keys differ');
  const ph = x => [...new Set([].concat(x).join('|').match(/\{\w+\}/g) || [])].sort().join(',');
  const problems = [];
  for (const k of ks('bs')) {
    const v = ['bs', 'sr', 'en'].map(L => D[L][k]);
    // a plural is an array of forms (a language may also use one fixed text where the grammar allows it)
    if (v.some(x => Array.isArray(x) && !(x.length >= 2 && x.every(y => typeof y === 'string')))) problems.push(k + ': plural forms');
    if (!v.every(x => [].concat(x).every(y => typeof y === 'string' && y.length))) problems.push(k + ': empty or not text');
    if (new Set(v.map(ph)).size > 1) problems.push(k + ': placeholders differ ' + v.map(ph).join(' / '));
    if (v.some(x => /"|<script|\son\w+=/i.test([].concat(x).join('')))) problems.push(k + ': double quote or script markup');
  }
  assert.deepStrictEqual(problems, []);
  // with 'auto' the dictionaries give the Bosnian text on BiH sites and the Serbian text on Serbian sites
  a.run('S.ui="auto";S.active="s1";syncPack()');
  assert.strictEqual(a.run('t("c.save")+"|"+lang()'), 'Sačuvaj|bs');
  a.run('S.active="r1";syncPack()');
  assert.strictEqual(a.run('lang()'), 'sr');
  a.run('S.ui="en"');
  assert.strictEqual(a.run('t("c.save")+"|"+lang()'), 'Save|en');
  assert.strictEqual(a.run('inDoc(site(),()=>lang())'), 'sr', 'documents of a Serbian site are Serbian');
  // plurals: Bosnian one / few / many, English one / other
  const pl = a.json('Object.keys(I18N.bs).find(k=>Array.isArray(I18N.bs[k])&&I18N.bs[k].length===3)');
  assert.ok(pl, 'no plural key to test');
  a.run('S.ui="bs"');
  const bs = a.json(`[1,3,5,11,21,22].map(n=>t(${JSON.stringify(pl)},{n}))`), B = a.json(`I18N.bs[${JSON.stringify(pl)}]`).map(x => x.replace(/\{\w+\}/g, ''));
  const strip = x => x.replace(/\d+/g, '').replace(/\{\w+\}/g, '');
  assert.deepStrictEqual(bs.map(strip), [B[0], B[1], B[2], B[2], B[0], B[1]].map(strip), 'Bosnian plural forms for 1,3,5,11,21,22');
});

test('English: no Bosnian/Serbian UI words on any screen, sheet or document view (BiH site, Serbian site, inspector mode)', async () => {
  const a = await fresh();
  // an accident in progress on the emergency screen, and a QC visit open on the Serbian site
  a.run('S.active="s1";syncPack()'); a.click('incStart'); await a.settle();
  a.run('S.ui="en"');
  const ex = exempt(a);
  const found = [];
  for (const [label, html] of renderAll(a)) { const l = leftovers(html, ex); if (l.length) found.push(label + ': ' + [...new Set(l)].slice(0, 4).join(' | ')); }
  assert.deepStrictEqual(found, [], 'national words left in English:\n' + found.join('\n'));
  assert.deepStrictEqual(a.json('[...T_MISS]'), [], 'keys asked for that do not exist');
  // red storage bar, a toast and the in-pilot sync label
  a.run('ST.mode="mem";renderSaveWarn()');
  assert.deepStrictEqual(leftovers(a.html('#saveWarn'), ex), []);
  a.run('saveFailed()');
  assert.deepStrictEqual(leftovers(a.toastText(), ex), [], a.toastText());
  // the scan itself works: the same screens in Bosnian are full of these words
  a.run('S.ui="bs";ST.mode="ls"');
  const nat = renderAll(a).reduce((n, [, html]) => n + leftovers(html, ex).length, 0);
  assert.ok(nat > 200, 'scan found only ' + nat + ' national words in the Bosnian interface');
});

test('English: the recovery screen speaks English when English was chosen on this device', async () => {
  const storage = makeLocalStorage({ 'terenska-knjiga-v3': JSON.stringify({ sites: [] }), 'terenska-knjiga-ui': 'en' });
  const a = await fresh({ storage });
  assert.strictEqual(a.el('#v-rec').hidden, false, 'recovery screen shown');
  const h = a.html('#v-rec');
  assert.ok(/Restore|backup/i.test(h), h.slice(0, 300));
  assert.deepStrictEqual(leftovers(h, []), []);
  const b = await fresh({ storage: makeLocalStorage({ 'terenska-knjiga-v3': JSON.stringify({ sites: [] }) }) });
  assert.ok(/Podaci|podaci/.test(b.html('#v-rec')), 'no choice made: national as before');
});

test('documents and exports are identical in English and in the national interface; English adds a screen-only note', async () => {
  const a = await fresh();
  // the printed body; screen-only hints inside it (class noprint) follow the interface language
  const art = h => (h.match(/<article class="doc[\s\S]*<\/article>/) || [''])[0].replace(/<(p|div|span) class="[^"]*noprint[^"]*"[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/\bts\d+/g, 'ts'); // the map's clip-path ids count renders
  for (const id of a.json('S.sites.map(s=>s.id)')) {
    a.run(`S.active=${JSON.stringify(id)};syncPack()`);
    const docs = a.json('(site().pack==="RS"?DOCS_RS:DOCS_BA).map(d=>d.k)').filter(k => k !== 'exp' && k !== 'rsexp');
    const pack = a.run('site().pack');
    for (const k of docs) {
      a.run(`S.ui="auto";docView=${JSON.stringify(k)};renderDoc(${JSON.stringify(k)})`);
      const nat = a.html('#v-izvjestaji');
      a.run(`S.ui="en";renderDoc(${JSON.stringify(k)})`);
      const en = a.html('#v-izvjestaji');
      assert.ok(art(nat).length > 50, id + ' ' + k + ': no document body');
      assert.strictEqual(art(en), art(nat), id + ' ' + k + ': the document changes with the interface language');
      assert.ok(/Official form — printed in the national language required by (BHMAC|CZRS)/.test(en), id + ' ' + k + ': English note missing');
      assert.ok(!/Official form/.test(nat), id + ' ' + k + ': note shown in the national interface');
      assert.ok(/class="[^"]*noprint[^"]*"[^>]*>[^<]*Official form/.test(en), id + ' ' + k + ': the note must not print');
    }
    for (const expr of ['csvText()', 'geoText()', pack === 'RS' ? 'kmlText(site())' : '""']) {
      const nat = a.run(`S.ui="auto";${expr}`), en = a.run(`S.ui="en";${expr}`);
      assert.strictEqual(en, nat, id + ' ' + expr + ' changes with the interface language');
    }
  }
  a.run('S.ui="auto";S.active="s1";syncPack();docView="p9";renderDoc("p9")');
  assert.ok(/DNEVNI IZVJEŠTAJ|Dnevni izvještaj/i.test(a.html('#v-izvjestaji')));
});

test('English: what is stored stays national (log entry of a find), the screen shows English', async () => {
  const a = await fresh();
  a.run('S.active="s1";S.ui="en";syncPack();go("nalaz")');
  const d = a.dom.document;
  d.querySelector('#fLane').value = '4'; d.querySelector('#fDist').value = '12.5'; d.querySelector('#fOff').value = '0';
  d.querySelector('#fDepth').value = '7'; d.querySelector('#fQty').value = '1'; d.querySelector('#fNote').value = '';
  d.querySelector('input[name="ftype"]:checked').value = 'PMA-2'; d.querySelector('input[name="fcat"]:checked').value = 'PP'; d.querySelector('input[name="fcond"]:checked').value = 'Neoštećeno';
  a.run('onSubmit({preventDefault(){}})');
  assert.ok(/Find N-\d+ saved|saved/i.test(a.toastText()), 'English toast: ' + a.toastText());
  const e = a.run('site().log[site().log.length-1].e');
  assert.ok(/staza 4 na 12,5 m/.test(e), 'log entry: ' + e);
  assert.ok(!/lane|depth/i.test(e), 'English in a stored log entry: ' + e);
  a.run('go("danas")');
  assert.ok(/Today|Logbook|logbook/.test(a.html('#v-danas')), 'English screen');
});

test('English formats: decimal point and English dates on screen, national formats in documents', async () => {
  const a = await fresh();
  a.run('S.active="s1";syncPack();S.ui="en"');
  assert.strictEqual(a.run('num(1234.5,1)'), '1,234.5');
  assert.strictEqual(a.run('fmtD("2026-11-11")'), '11 Nov 2026');
  assert.strictEqual(a.run('fmtDS("2026-11-03")'), '3 Nov');
  assert.strictEqual(a.run('longDate(new Date(2026,10,11,12))'), 'Wednesday, 11 November 2026');
  assert.strictEqual(a.run('gkn(6571250)'), '6 571 250.00');
  assert.strictEqual(a.run('inDoc(site(),()=>num(1234.5,1)+" "+fmtD("2026-11-11")+" "+gkn(6571250))'), '1.234,5 11.11.2026. 6 571 250,00');
  a.run('S.ui="bs"');
  assert.strictEqual(a.run('num(1234.5,1)+" "+fmtD("2026-11-11")+" "+longDate(new Date(2026,10,11,12))'), '1.234,5 11.11.2026. srijeda, 11. novembar 2026.');
  a.run('S.ui="sr"');
  assert.strictEqual(a.run('longDate(new Date(2026,10,11,12))'), 'sreda, 11. novembar 2026.');
});

test('language setting: per device in the state, validated, chosen in the sites sheet, <html lang> follows', async () => {
  const a = await fresh();
  a.dom.document.documentElement = { lang: 'bs' };
  assert.strictEqual(a.run('S.ui'), 'auto', 'default is automatic');
  assert.strictEqual(a.run('checkState(Object.assign(snapshot(),{ui:"xx"})).ui'), 'auto', 'unknown value falls back to auto');
  assert.strictEqual(a.run('checkState(Object.assign(snapshot(),{ui:"<b>"})).ui'), 'auto');
  assert.strictEqual(a.run('checkState(Object.assign(snapshot(),{ui:"en"})).ui'), 'en');
  a.run('S.active="r1";syncPack();rerender()');
  assert.strictEqual(a.dom.document.documentElement.lang, 'sr', 'auto on a Serbian site');
  a.run('openSites()');
  const sh = a.html('#sheet');
  assert.ok(/id="uiLang"/.test(sh) && /Jezik interfejsa/.test(sh), 'selector in the sites sheet');
  for (const o of ['auto', 'bs', 'sr', 'en']) assert.ok(sh.includes(`value="${o}"`), o);
  a.run('onUiLang("en")');
  assert.strictEqual(a.run('S.ui'), 'en');
  assert.strictEqual(a.storage.getItem('terenska-knjiga-ui'), 'en', 'mirrored for the recovery screen');
  assert.strictEqual(a.dom.document.documentElement.lang, 'en');
  assert.ok(/Interface language/.test(a.html('#sheet')), 'sheet redrawn in English');
  assert.strictEqual(a.el('.tab[data-tab="izvjestaji"]').lastChild.textContent, 'Reports');
  a.run('onUiLang("auto")');
  assert.strictEqual(a.storage.getItem('terenska-knjiga-ui'), null);
  a.run('S.active="s1";syncPack();rerender()');
  assert.strictEqual(a.dom.document.documentElement.lang, 'bs', 'auto on a BiH site');
  // the choice survives a reload
  a.run('onUiLang("en")'); await a.run('saveQ');
  const b = await fresh({ storage: a.storage });
  assert.strictEqual(b.run('S.ui'), 'en');
});

test('XSS: data shown through t() placeholders stays escaped in English', async () => {
  const a = await fresh();
  const P = '<img src=x onerror=alert(1)>';
  a.run(`S.ui="en";S.active="s1";syncPack();site().msp.id=${JSON.stringify(P)};site().msp.naziv=${JSON.stringify(P)};site().ci.oznaka=${JSON.stringify(P)}`);
  for (const [label, html] of renderAll(a)) assert.ok(!/<img src=x onerror|" onerror="alert/.test(html), label);
});
