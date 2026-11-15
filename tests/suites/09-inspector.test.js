'use strict';
// CZRS inspector mode (kontrolor CZRS): sampling, returned boxes, nonconformities, certificate proposal, documents, old state.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('../lib/t');
const { loadApp, makeLocalStorage, makeIndexedDB } = require('../lib/harness');

const NOW = '2026-11-11T10:00:00';
const KEY = 'terenska-knjiga-v3';
const BAD = /undefined|NaN|Infinity|\[object /;
const PAYLOAD = '<img src=x onerror=alert(1)>';
const RAW = /<img src=x onerror|" onerror="alert/;
const FIX = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', n), 'utf8'));
const fresh = (o = {}) => loadApp(Object.assign({ now: NOW }, o));
// the inspector screens are asserted in Serbian (the UI language is pinned, not left to 'auto')
const rs = async () => { const a = await fresh(); a.run('S.active="r1";S.ui="sr";syncPack()'); return a; };
const asK = a => a.run('qa(site()).role="czrs";syncPack()');

// every tab, every Serbian document, the inspector's sheets; returns [[where, html]]
function renderInspector(a) {
  const out = [];
  for (const k of a.json('DOCS_RS.map(d=>d.k)')) { a.run(`docView=null;renderDoc(${JSON.stringify(k)})`); out.push(['doc ' + k, a.html('#v-izvjestaji')]); }
  a.run('docView=null;renderIzvjestaji()'); out.push(['doc list', a.html('#v-izvjestaji')]);
  out.push(['doc desc', a.json('DOCS_RS.map(d=>d.d())').join(' | ')]);
  for (const t of ['danas', 'mapa', 'nalaz', 'hitno']) { a.run(`go(${JSON.stringify(t)})`); out.push(['tab ' + t, a.html('#v-' + t)]); }
  out.push(['header', a.el('#hdrMeta').innerHTML]);
  if (a.run('site().boxes.length')) { a.run('openBoxB(site().boxes[0].id)'); out.push(['box sheet', a.html('#sheet')]); }
  const nc = a.run('(qa(site()).ncs.find(n=>n.kind==="chk"&&!n.closed)||{}).id');
  if (nc) { a.click(undefined, { qa: 'ncClose', id: nc }); out.push(['nc sheet', a.html('#sheet')]); }
  return out;
}
const assertClean = (out, label) => { for (const [w, h] of out) { const m = String(h).match(BAD); assert.ok(!m, `${label} ${w}: "${m && m[0]}" near …${String(h).slice(Math.max(0, m && m.index - 80), m && m.index + 40)}…`); } };

// a test site whose every box is finished, all finds handed to MUP, one closed visit with a clean sample
function allDone(a) {
  a.run(`(()=>{const s=site();s.boxes.forEach(b=>{if(b.excl)return;delete b.ret;b.need.forEach(m=>{if(!b.done[m])b.done[m]={day:'2026-11-10',by:'D-01'};});});
    s.finds.forEach(f=>f.act=PACKS.RS.actions[2]);
    const q=qa(s);q.ncs=[];q.visits=[{id:'KP-01',d:'2026-11-10',t:'10:00',who:'K. Test',ann:0,tim:'',rep:'',checks:{},pct:10,seed:7,base:100,samples:[{box:s.boxes.find(b=>boxDone(b)).id,pick:'r',area:100,m:'CEIA',m2:100,res:'ok',type:'',depth:null,note:''}],zak:'',closed:'2026-11-10'}];})()`);
}

test('sampling: the same seed and the same boxes give the same sample, whatever order the boxes come in', async () => {
  const a = await rs(), b = await rs();
  const pick = (app, seed, rev) => app.json(`qaSample(site().boxes.filter(boxDone)${rev ? '.slice().reverse()' : ''},10,${seed}).ids`);
  const s1 = pick(a, 4127), s2 = pick(b, 4127), s3 = pick(a, 4127, true);
  assert.ok(s1.length >= 1);
  assert.deepStrictEqual(s1, s2, 'two devices, same seed');
  assert.deepStrictEqual(s1, s3, 'input order does not matter');
  const others = [11, 12, 13, 14, 15].map(sd => pick(a, sd).join());
  assert.ok(others.some(x => x !== s1.join()), 'other seeds give other samples');
  // the generator itself is fixed: first numbers of seed 1 (mulberry32)
  assert.deepStrictEqual(a.json('(()=>{const r=qaRng(1);return [r(),r(),r()].map(x=>+x.toFixed(9));})()'), [0.627073941, 0.002735721, 0.52744704]);
});

test('sampling: area math — the sample reaches pct % of the pool area with the fewest boxes in draw order', async () => {
  const a = await rs();
  const pool = a.json('site().boxes.filter(boxDone).map(b=>({id:b.id,area:b.area}))');
  const A = pool.reduce((x, b) => x + b.area, 0);
  for (const [pct, seed] of [[1, 3], [5, 99], [10, 4127], [25, 8], [50, 123456], [100, 5]]) {
    const r = a.json(`qaSample(site().boxes.filter(boxDone),${pct},${seed})`);
    assert.ok(Math.abs(r.base - A) < 1e-6, 'base = cleared pool area');
    assert.ok(Math.abs(r.target - A * pct / 100) < 1e-6, 'target = pct % of base');
    const area = r.ids.reduce((x, id) => x + pool.find(b => b.id === id).area, 0);
    assert.ok(Math.abs(area - r.area) < 1e-6, 'reported area = sum of picked boxes');
    assert.ok(area >= r.target - 1e-9, `${pct} %: ${area} >= ${r.target}`);
    const lastA = pool.find(b => b.id === r.ids[r.ids.length - 1]).area;
    assert.ok(area - lastA < r.target, `${pct} %: one box fewer would not reach the target`);
    assert.strictEqual(new Set(r.ids).size, r.ids.length, 'no box twice');
    if (pct === 100) assert.strictEqual(r.ids.length, pool.length);
  }
  assert.deepStrictEqual(a.json('qaSample([],10,1)'), { base: 0, target: 0, area: 0, ids: [] });
});

test('sampling in a visit: pool leaves out boxes sampled on earlier visits; redraw is blocked once a random box has a result', async () => {
  const a = await rs(); asK(a);
  const before = a.json('qa(site()).visits[0].samples.map(x=>x.box)');
  a.run(`qa(site()).visits.push({id:'KP-02',d:today(),t:'09:00',who:'K. Test',ann:1,tim:'',rep:'',checks:{},pct:10,seed:null,base:null,samples:[],zak:'',closed:''})`);
  const r = a.json('qaDraw(site(),qaOpen(site()),10,77)');
  assert.ok(r.ids.length >= 1);
  assert.ok(!r.ids.some(id => before.includes(id)), 'earlier sampled boxes are not drawn again');
  const pool = a.json('qaPool(site()).map(b=>b.id)');
  assert.ok(!pool.some(id => before.includes(id)) && !pool.includes(a.run('site().boxes.find(b=>b.ret).id')), 'returned and sampled boxes are not in the pool');
  assert.strictEqual(a.run('qaOpen(site()).seed'), 77);
  assert.deepStrictEqual(a.json('qaDraw(site(),qaOpen(site()),10,77).ids'), r.ids, 'same seed, same draw');
  a.run('qaOpen(site()).samples[0].res="ok"');
  assert.ok(/ne izvlači se ponovo/.test(a.run('qaDraw(site(),qaOpen(site()),10,78)')));
  a.run('go("nalaz")');
  assert.ok(new RegExp('Seme <b class="mono">77</b>').test(a.html('#v-nalaz')), 'seed is shown');
  for (const id of r.ids) assert.ok(a.html('#v-nalaz').includes('Boks ' + id), 'drawn box listed: ' + id);
});

test('failed box: seeded fragment sends a sampled box back; not done, not cleared, shown on map and sketch until re-treated and re-checked', async () => {
  const a = await rs();
  const id = a.run('site().boxes.find(b=>b.ret).id'), area = a.run(`boxById(site(),"${id}").area`);
  assert.ok(id, 'seed has a returned box');
  assert.strictEqual(a.run(`boxDone(boxById(site(),"${id}"))`), false);
  assert.strictEqual(a.run(`boxStat(boxById(site(),"${id}"))`), 'r');
  assert.strictEqual(a.run(`boxById(site(),"${id}").need.every(m=>boxById(site(),"${id}").done[m])`), true, 'its methods were done once');
  const cl0 = a.run('clearedM2(site())');
  assert.ok(Math.abs(cl0 - a.run('site().boxes.filter(b=>!b.ret&&!b.excl&&b.need.every(m=>b.done[m])).reduce((x,b)=>x+b.area,0)')) < 1e-9);
  a.run('go("mapa")');
  assert.ok(new RegExp('bxp bx-r[^"]*" d="[^"]*" fill-rule="evenodd" data-act="box" data-id="' + id + '"').test(a.html('#v-mapa')), 'contractor map draws it as returned');
  assert.ok(/Vraćeno na ponovni tretman/.test(a.html('#v-mapa')), 'legend');
  a.run('renderDoc("sk")');
  assert.ok(/url\(#skR\)/.test(a.html('#v-izvjestaji')) && />vraćeno</.test(a.html('#v-izvjestaji')) && /vraćeno na ponovni tretman \(CZRS\)/.test(a.html('#v-izvjestaji')), 'sketch marks it');
  a.run('go("danas")');
  assert.ok(/Kontrola CZRS/.test(a.html('#v-danas')) && a.html('#v-danas').includes('vraćen na ponovni tretman'), 'contractor Danas shows it');
  // contractor cannot split, merge or exclude it while it is open
  assert.ok(/vraćen na ponovni tretman/.test(a.run(`splitBox(site(),"${id}","u")`)));
  assert.ok(/vraćen na ponovni tretman/.test(a.run(`exclBox(site(),"${id}","put","")`)));
  // contractor re-treats: still not done
  a.run(`qaRedo(site(),"${id}","D-02")`);
  assert.strictEqual(a.run(`boxStat(boxById(site(),"${id}"))`), 'k');
  assert.strictEqual(a.run(`boxDone(boxById(site(),"${id}"))`), false, 're-treated is not done before the re-check');
  assert.ok(Math.abs(a.run('clearedM2(site())') - cl0) < 1e-9);
  assert.ok(a.run('renderDoc("rsd"),document.querySelector("#v-izvjestaji").innerHTML').includes('Ponovni tretman po nalogu kontrole CZRS'), 'daily record lists the re-treatment');
  // inspector re-checks with no find: NC closed, box done, area counted
  asK(a);
  a.run(`qa(site()).visits.push({id:'KP-02',d:today(),t:'09:00',who:'K. Test',ann:0,tim:'',rep:'',checks:{},pct:10,seed:null,base:null,samples:[],zak:'',closed:''})`);
  assert.strictEqual(typeof a.run(`qaAdd(site(),qaOpen(site()),"${id}")`), 'object', 'a re-treated box can be added');
  assert.strictEqual(a.run('qaOpen(site()).samples[0].pick'), 'p');
  a.run('qaOpen(site()).samples[0].res="ok"');
  const r = a.json('qaClose(site(),qaOpen(site()))');
  assert.deepStrictEqual(r.shut, ['NC-01']);
  assert.strictEqual(a.run(`boxDone(boxById(site(),"${id}"))`), true);
  assert.ok(Math.abs(a.run('clearedM2(site())') - (cl0 + area)) < 1e-6, 'area counts once the re-check passes');
  assert.strictEqual(a.run('qa(site()).ncs[0].closed.visit'), 'KP-02');
  assert.strictEqual(a.run('qa(site()).ncs[0].redo.by'), 'D-02', 'the re-treatment stays on record');
});

test('failed box: a sample with a find opens a nonconformity and returns the box; a check marked "nedostatak" opens one too', async () => {
  const a = await rs(); asK(a);
  a.run(`qa(site()).visits.push({id:'KP-02',d:today(),t:'09:00',who:'K. Test',ann:0,tim:'',rep:'',checks:{lzo:{st:'ned',note:'vizir oštećen'}},pct:10,seed:null,base:null,samples:[],zak:'',closed:''})`);
  const id = a.run('qaPool(site())[0].id');
  a.run(`qaAdd(site(),qaOpen(site()),"${id}")`);
  assert.ok(/Upiši rezultat/.test(a.run('qaClose(site(),qaOpen(site()))')), 'no close without a result');
  a.run('Object.assign(qaOpen(site()).samples[0],{res:"nus"})');
  assert.ok(/Upiši šta je pronađeno/.test(a.run('qaClose(site(),qaOpen(site()))')));
  a.run('Object.assign(qaOpen(site()).samples[0],{type:"Upaljač art. projektila",depth:14})');
  const r = a.json('qaClose(site(),qaOpen(site()))');
  assert.strictEqual(r.made.length, 2);
  const ncs = a.json('qa(site()).ncs.filter(n=>!n.closed)');
  assert.ok(ncs.some(n => n.kind === 'chk' && /Lična zaštitna oprema: vizir oštećen/.test(n.text)));
  assert.ok(ncs.some(n => n.kind === 'box' && n.box === id && /Upaljač art. projektila, dubina 14 cm/.test(n.text)));
  assert.strictEqual(a.run(`boxStat(boxById(site(),"${id}"))`), 'r');
  assert.ok(/samo ponovnom kontrolom/.test(a.run(`qaNcClose(site(),"${ncs.find(n => n.kind === 'box').id}","x")`)), 'box NC cannot be closed by hand');
  const chk = ncs.find(n => n.kind === 'chk').id;
  assert.ok(/Upiši kako/.test(a.run(`qaNcClose(site(),"${chk}","")`)));
  a.run(`qaNcClose(site(),"${chk}","zamenjen vizir")`);
  assert.ok(a.run(`!!qa(site()).ncs.find(n=>n.id==="${chk}").closed`));
});

test('certificate proposal: given only with no open nonconformity, every box done or excluded with a reason, and a closed sampled visit', async () => {
  const a = await rs(); asK(a); allDone(a);
  let c = a.json('certCheck(site())');
  assert.ok(c.ok, c.why.join('; '));
  a.run('renderDoc("zk")');
  assert.ok(/PREDLOG ZA IZDAVANJE UVERENJA O OČIŠĆENOSTI/.test(a.html('#v-izvjestaji')));
  assert.ok(/uslovi ispunjeni/.test((a.run('renderDoc("rsp")'), a.html('#v-izvjestaji'))), 'feeds the handover minute');
  // an open nonconformity from a check blocks it
  a.run(`qa(site()).ncs.push({id:'NC-05',d:today(),visit:'KP-01',kind:'chk',box:'',chk:'med',text:'Medicinska podrška: vozilo nije na lokaciji',redo:null,closed:null})`);
  c = a.json('certCheck(site())');
  assert.ok(!c.ok && c.why.some(x => /NC-05/.test(x)), c.why.join('; '));
  a.run('renderDoc("zk")');
  const h = a.html('#v-izvjestaji');
  assert.ok(!/PREDLOG ZA IZDAVANJE UVERENJA/.test(h) && /Predlog se ne može dati/.test(h) && /NC-05/.test(h));
  a.run('qaNcClose(site(),"NC-05","vozilo na lokaciji")');
  assert.ok(a.json('certCheck(site())').ok);
  // a returned box blocks it; so do an unfinished box, an open visit, NUS not taken by MUP, an exclusion without reason
  const b = a.run('site().boxes.find(b=>boxDone(b)).id');
  a.run(`boxById(site(),"${b}").ret={nc:'NC-09',day:today(),redo:null};qa(site()).ncs.push({id:'NC-09',d:today(),visit:'KP-01',kind:'box',box:'${b}',chk:'',text:'Boks ${b}: pronađeno Fragment',redo:null,closed:null})`);
  assert.ok(a.json('certCheck(site()).why').some(x => /NC-09/.test(x)));
  a.run(`delete boxById(site(),"${b}").ret;qa(site()).ncs.pop()`);
  for (const [mk, re] of [
    ['delete site().boxes.find(b=>boxDone(b)).done.CEIA', /nije završeno 1 boks/],
    [`qa(site()).visits.push({id:'KP-02',d:today(),t:'',who:'x',ann:0,tim:'',rep:'',checks:{},pct:10,seed:null,base:null,samples:[],zak:'',closed:''})`, /KP-02 nije zaključena/],
    ['site().finds[0].act=PACKS.RS.actions[0]', /nije preuzeo MUP/],
    ['site().boxes.find(b=>b.excl).excl.why=""', /isključeno bez razloga/],
  ]) {
    const c2 = await rs(); asK(c2); allDone(c2); c2.run(mk);
    const w = c2.json('certCheck(site())');
    assert.ok(!w.ok && w.why.some(x => re.test(x)), re + ': ' + w.why.join('; '));
  }
  const n = await rs(); allDone(n); n.run('qa(site()).visits=[]');
  assert.ok(n.json('certCheck(site()).why').some(x => /nema zaključene kontrolne posete sa uzorkovanjem/.test(x)));
});

test('inspector documents and screens render for the seeded site (both roles) without undefined/NaN', async () => {
  const a = await rs();
  assertClean(renderInspector(a), 'r1 izvođač');
  asK(a);
  const out = renderInspector(a);
  assertClean(out, 'r1 kontrolor');
  const get = w => out.find(x => x[0] === w)[1];
  assert.ok(/ZAPISNIK O KONTROLI KVALITETA/.test(get('doc kk')) && /KP-01/.test(get('doc kk')) && /seme 4127/.test(get('doc kk')), 'KK of the seeded visit');
  assert.ok(/pronađeno NUS/.test(get('doc kk')) && /bez nalaza/.test(get('doc kk')), 'passed and failed sample');
  assert.ok(/Kontrolor CZRS: M\. Primerović \(primer\)/.test(get('doc kk')), 'signature line names the inspector');
  assert.ok(/ZAVRŠNA KONTROLA/.test(get('doc zk')) && /Predlog se ne može dati/.test(get('doc zk')) && /NC-01/.test(get('doc zk')));
  assert.ok(/Kontrola kvaliteta CZRS/.test(get('doc rsp')) && /Zapisnici o kontroli kvaliteta CZRS \(1\)/.test(get('doc rsp')), 'handover draft gets the QC rows');
  assert.ok(/Kontrolne posete/.test(get('tab danas')) && /Učinak po demineru/.test(get('tab danas')) && /proveriti/.test(get('tab danas')), 'overview with flagged day');
  assert.ok(/Nova kontrolna poseta/.test(get('tab nalaz')), 'Kontrola tab');
  assert.ok(/KONTROLOR/.test(get('header')));
  assert.ok(!/data-act="markM"/.test(get('box sheet')) && !/data-rs="split"/.test(get('box sheet')), 'box sheet is read-only for the inspector');
  assert.ok(!/data-rs="featEdit"/.test(get('tab mapa')), 'landmarks read-only');
  // an open visit with samples renders too
  a.run(`qa(site()).visits.push({id:'KP-02',d:today(),t:'09:00',who:'K. Test',ann:1,tim:'',rep:'',checks:{dok:{st:'ned',note:'nema projekta'}},pct:10,seed:null,base:null,samples:[],zak:'',closed:''});qaDraw(site(),qaOpen(site()),10,5);qaOpen(site()).samples[0].res='nus'`);
  const o2 = renderInspector(a);
  assertClean(o2, 'r1 open visit');
  assert.ok(/NACRT/.test(o2.find(x => x[0] === 'doc kk')[1]) && /Šta je pronađeno/.test(o2.find(x => x[0] === 'tab nalaz')[1]));
});

test('inspector documents and screens render for a freshly created empty Serbian site', async () => {
  const a = await fresh();
  a.run("S.ui='sr'"); // UI text below is asserted in Serbian
  const d = a.dom.document;
  d.querySelector('#nsTp').value = '457 010 4 955 020\n457 080 4 955 000\n457 105 4 955 060\n457 060 4 955 110\n457 000 4 955 090';
  d.querySelector('#nsGrid').value = '10'; d.querySelector('#nsMsp').value = 'ID 0322/26'; d.querySelector('#nsName').value = 'Kosa'; d.querySelector('#nsSek').value = 'Sektor 1';
  a.run('createSiteRS()');
  assert.strictEqual(a.run('site().msp.id'), 'ID 0322/26');
  for (const role of ['izv', 'czrs']) {
    a.run(`qa(site()).role="${role}"`);
    const out = renderInspector(a);
    assertClean(out, 'new RS ' + role);
    assert.ok(/još nema kontrolnih poseta/.test(out.find(x => x[0] === 'doc kk')[1]));
    assert.ok(/Predlog se ne može dati/.test(out.find(x => x[0] === 'doc zk')[1]));
  }
  a.run(`qa(site()).visits.push({id:'KP-01',d:today(),t:'09:00',who:'K. Test',ann:0,tim:'',rep:'',checks:{},pct:10,seed:null,base:null,samples:[],zak:'',closed:''})`);
  const r = a.json('qaDraw(site(),qaOpen(site()),10,3)');
  assert.deepStrictEqual(r.ids, [], 'nothing finished, nothing drawn');
  assertClean(renderInspector(a), 'new RS empty visit');
});

test('old state without inspector fields (v3 fixture) loads with safe defaults and renders in both roles', async () => {
  const v3 = FIX('state-v3.json');
  assert.ok(!JSON.stringify(v3).includes('"qa"') && !JSON.stringify(v3).includes('"ret"'), 'fixture predates the inspector');
  const a = await loadApp({ now: NOW, storage: makeLocalStorage({ [KEY]: JSON.stringify(v3) }) });
  assert.deepStrictEqual(a.errors, []);
  a.run('S.active="r1";syncPack()');
  assert.deepStrictEqual(a.json('site().qa'), { role: 'izv', pct: 10, insp: '', visits: [], ncs: [] });
  assert.strictEqual(a.run('site().boxes.some(b=>"ret" in b)'), false);
  assertClean(renderInspector(a), 'v3 izvođač');
  asK(a);
  assertClean(renderInspector(a), 'v3 kontrolor');
  // BiH sites get no inspector fields at all
  assert.strictEqual(a.run('"qa" in S.sites.find(s=>s.id==="s1")'), false);
});

test('validator: malformed inspector data from a backup is typed or dropped, never breaks a render', async () => {
  const a = await fresh({ idb: makeIndexedDB() });
  const st = a.json('S'), r1 = st.sites.find(s => s.id === 'r1');
  r1.qa = { role: 'czrs', pct: 'x', visits: [{ id: 'KP-9', d: 'juče', seed: 'abc', samples: [{ box: 'A-01', res: 'možda', m2: -5 }, 'x', { res: 'ok' }], checks: { dok: { st: 'bad', thumb: 'javascript:1' }, xx: { st: 'ok' } } }, 7, { id: 'KP-9' }], ncs: [{ id: 'NC-1', closed: 'x' }, { id: 'NC-1' }, null] };
  r1.boxes[0].ret = { nc: 5, redo: 'x' };
  const txt = JSON.stringify({ app: 'terenska-knjiga', format: 1, exported: new Date(NOW).toISOString(), state: st, photos: {} });
  a.run(`onRestoreFile({text:()=>Promise.resolve(${JSON.stringify(txt)})})`);
  await a.settle(); await a.run('restoreBackup()'); await a.settle();
  a.run('S.active="r1";syncPack()');
  const q = a.json('site().qa');
  assert.strictEqual(q.role, 'czrs'); assert.strictEqual(q.pct, 10);
  assert.strictEqual(q.visits.length, 1, 'non-objects and duplicate ids dropped');
  const v = q.visits[0];
  assert.strictEqual(v.d, ''); assert.strictEqual(v.seed, null);
  assert.deepStrictEqual(v.samples, [{ box: 'A-01', pick: 'm', area: 0, m: 'CEIA', m2: 0, res: '', type: '', depth: null, note: '' }]);
  assert.deepStrictEqual(v.checks, { dok: { st: '', note: '' } });
  assert.strictEqual(q.ncs.length, 1); assert.strictEqual(q.ncs[0].closed, null);
  assert.deepStrictEqual(a.json('site().boxes[0].ret'), { nc: '5', day: '', redo: null });
  assertClean(renderInspector(a), 'malformed');
});

test('XSS: inspector fields from a backup (names, notes, find, NC text, box id) are escaped in every screen and document', async () => {
  const a = await fresh({ idb: makeIndexedDB() });
  const st = a.json('S'), r1 = st.sites.find(s => s.id === 'r1');
  const v = r1.qa.visits[0];
  Object.assign(v, { who: PAYLOAD, tim: PAYLOAD, rep: PAYLOAD, zak: PAYLOAD, t: PAYLOAD, id: 'KP-01' });
  v.checks.dok = { st: 'ned', note: PAYLOAD, thumb: 'x" onerror="alert(1)' };
  Object.assign(v.samples[v.samples.length - 1], { type: PAYLOAD, note: PAYLOAD });
  r1.qa.ncs[0].text = PAYLOAD; r1.qa.insp = PAYLOAD;
  r1.qa.visits.push({ id: 'KP-02', d: r1.start, t: '09:00', who: PAYLOAD, ann: 0, tim: PAYLOAD, rep: PAYLOAD, checks: { med: { st: 'ned', note: PAYLOAD } }, pct: 10, seed: 3, base: 1, samples: [{ box: PAYLOAD, pick: 'm', area: 5, m: 'CEIA', m2: 5, res: 'nus', type: PAYLOAD, depth: 3, note: PAYLOAD }], zak: PAYLOAD, closed: '' });
  r1.qa.ncs.push({ id: PAYLOAD, d: r1.start, visit: PAYLOAD, kind: 'chk', box: '', chk: 'med', text: PAYLOAD, redo: null, closed: null });
  const b = r1.boxes.find(x => x.ret); b.ret.redo = { day: r1.start, by: PAYLOAD };
  const txt = JSON.stringify({ app: 'terenska-knjiga', format: 1, exported: new Date(NOW).toISOString(), state: st, photos: {} });
  a.run(`onRestoreFile({text:()=>Promise.resolve(${JSON.stringify(txt)})})`);
  await a.settle(); await a.run('restoreBackup()'); await a.settle();
  a.run('S.active="r1";syncPack()');
  assert.strictEqual(a.run('qa(site()).insp'), PAYLOAD, 'backup restored');
  const out = renderInspector(a);
  asK(a);
  out.push(...renderInspector(a));
  a.run('openBoxK(site().boxes.find(b=>b.ret).id)'); out.push(['inspector box sheet', a.html('#sheet')]);
  for (const vid of ['KP-01', 'KP-02']) { a.run(`docVisit="${vid}";renderDoc("kk")`); out.push(['kk ' + vid, a.html('#v-izvjestaji')]); }
  a.run(`qa(site()).role="izv";renderDoc("rsd")`); out.push(['rsd', a.html('#v-izvjestaji')]);
  a.run('openBoxB(site().boxes.find(b=>b.ret).id)'); out.push(['contractor box sheet', a.html('#sheet')]);
  const hits = out.filter(([, h]) => RAW.test(h)).map(([w]) => w);
  assert.deepStrictEqual(hits, [], 'payload executes in: ' + hits.join(', '));
});

test('role switch: per site; inspector cannot change contractor data; BiH sites unaffected', async () => {
  const a = await rs();
  a.click(undefined, { qa: 'role', role: 'czrs' });
  assert.strictEqual(a.run('qa(site()).role'), 'czrs');
  assert.strictEqual(a.run('S.sites.find(s=>s.id==="r1").qa.role'), 'czrs');
  const before = JSON.stringify(a.json('site().boxes'));
  const id = a.run('site().boxes.find(b=>!b.excl&&!b.done.CEIA).id');
  a.dom.document.querySelector('#mWho').value = 'D-01';
  a.click('markM', { id, m: 'CEIA' });
  assert.ok(/samo za pregled/.test(a.toastText()));
  a.click(undefined, { rs: 'excl', id });
  a.click(undefined, { qa: 'redo', id: a.run('site().boxes.find(b=>b.ret).id') });
  assert.strictEqual(JSON.stringify(a.json('site().boxes')), before, 'contractor boxes unchanged');
  // the role is stored per site: the BiH site stays in its normal mode
  a.run('S.active="s1";syncPack();renderHeader();go("danas")');
  assert.strictEqual(a.run('"qa" in site()'), false);
  assert.ok(!/KONTROLOR/.test(a.el('#hdrMeta').innerHTML));
  assert.ok(!/data-qa="role"/.test(a.html('#v-danas')), 'no role switch on BiH lanes');
  a.run('S.active="r1";syncPack()');
  a.click(undefined, { qa: 'role', role: 'izv' });
  assert.strictEqual(a.run('qa(site()).role'), 'izv');
});

test('inspector visit through the UI: start, draw, record, close; the sample is saved and the box status follows', async () => {
  const a = await rs(); asK(a);
  a.run('go("nalaz")');
  const d = a.dom.document;
  d.querySelector('#kvD').value = '2026-11-11'; d.querySelector('#kvT').value = '09:15'; d.querySelector('#kvWho').value = 'K. Kontrolić (primer)';
  d.querySelector('#kvTim').value = 'D-01, D-02'; d.querySelector('#kvRep').value = 'R. Rukovodilac';
  a.click(undefined, { qa: 'vNew' });
  assert.strictEqual(a.run('qaOpen(site()).id'), 'KP-02');
  d.querySelector('#kvPct').value = '10'; d.querySelector('#kvSeed').value = '31';
  a.click(undefined, { qa: 'draw' });
  const ids = a.json('qaOpen(site()).samples.map(x=>x.box)');
  assert.ok(ids.length >= 1, a.toastText());
  assert.deepStrictEqual(ids, a.json('qaSample(qaPool(site()),10,31).ids'));
  a.run('qaOpen(site()).samples.forEach((x,i)=>{x.res=i?"ok":"nus";x.type="Fragment";x.depth=5;})');
  a.click(undefined, { qa: 'vClose' });
  assert.strictEqual(a.run('qa(site()).visits[1].closed'), '2026-11-11', a.toastText());
  assert.strictEqual(a.run(`boxStat(boxById(site(),"${ids[0]}"))`), 'r');
  assert.strictEqual(a.run('docView'), 'kk');
  assert.ok(/K\. Kontrolić \(primer\)/.test(a.html('#v-izvjestaji')), 'goes to the new minute');
  // the stored state survives a reload
  const storage = a.storage;
  const b = await loadApp({ now: NOW, storage });
  assert.strictEqual(b.run('S.sites.find(s=>s.id==="r1").qa.visits.length'), a.run('qa(site()).visits.length'));
});
