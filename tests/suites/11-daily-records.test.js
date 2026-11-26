'use strict';
// Daily records: organisation templates (versioned), the written daily briefing (lock + amendments), opening/closing
// checklists, in-day attestations, issues, detector log, the "Zapisnik o dnevnom brifingu i proverama" document, the CZRS
// inspector's read-only view and flag, old state, validator and escaping.
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
// a BiH site opened today with no record yet (the demo sites already have today's briefing closed)
const newDay = async (o) => { const a = await fresh(o); a.run('S.ui="bs";S.active="s2";syncPack();openSiteWork()'); return a; };
const val = (a, sel, v) => { a.dom.document.querySelector(sel).value = v; };
const fillBrief = a => a.run(`(()=>{const s=site(),d=today(),b=brOf(s,d,true);b.T.items.forEach(x=>{b.top[x.id]={at:'07:01'};});
  CV.forEach(k=>{b.cv[k]=b.cv[k]||'x';b.cvOk[k]='07:02';});b.fit={by:'L. Omerović',at:'07:03'};b.ppe={by:'M. Hodžić',at:'07:03'};b.ppl.forEach(p=>{if(p.pr)p.ack='07:04';});})()`);
const zb = a => { a.run('docView="zb";renderDoc("zb")'); return a.html('#v-izvjestaji'); };

test('templates: defaults per pack with sources; an edit saved from the sheet makes a new version, keeps the old one and survives a reload', async () => {
  const storage = makeLocalStorage();
  const a = await fresh({ storage });
  const T = a.json('S.tpl');
  for (const p of ['BA', 'RS']) for (const l of ['open', 'brief', 'att', 'close']) {
    assert.ok(T[p][l].items.length >= 6, p + ' ' + l);
    assert.strictEqual(T[p][l].v, 1);
    assert.ok(T[p][l].items.every(x => x.id && x.t && ['vt', 'vs', 'med', 'zam', 'qa', 'eod', 'kv', 'op'].includes(x.who)), p + ' ' + l + ' roles');
  }
  assert.strictEqual(T.RS.brief.items.length, 13, '13 briefing topics');
  assert.ok(T.RS.close.items.some(x => /112/.test(x.t) && x.src === 'czrs'), 'RS: every find marked, secured and reported (Zakon čl. 74)');
  assert.ok(T.BA.close.items.some(x => /Eksploziv vraćen/.test(x.t)), 'BA: explosives returned');
  assert.ok(!T.RS.open.items.some(x => /[Ee]ksploziv i upaljači/.test(x.t)), 'RS contractors hold no demolition explosives');
  assert.ok(T.RS.brief.items.filter(x => x.src === 'sop').length >= 2, 'radio and CASEVAC are organisation SOP, not a CZRS rule');
  // through the sheet: edit text, required, role, reorder, switch off, add, save
  a.run('S.active="r1";syncPack();drDo("tpl",{})');
  assert.ok(/Šabloni i procedure/.test(a.html('#sheet')));
  a.run('drDo("tpList",{v:"att"})');
  a.run('tplEd.items[0].t="Obeležavanje radilišta neoštećeno (izmenjeno)";tplEd.items[1].who="zam"');
  a.run('drDo("tpReq",{i:"2"});drDo("tpMv",{i:"3",v:"-1"});drDo("tpOff",{i:"0"});drDo("tpAdd",{})');
  a.run('tplEd.items[tplEd.items.length-1].t="Nova stavka"');
  a.run('drDo("tpPack",{v:"BA"})');
  assert.ok(/Prvo sačuvaj/.test(a.toastText()), 'switching with unsaved edits is refused');
  a.run('drDo("tpSave",{})');
  assert.ok(/verzija 2/.test(a.toastText()), a.toastText());
  const L = a.json('tplOf("RS","att")');
  assert.strictEqual(L.v, 2); assert.strictEqual(L.hist.length, 1); assert.strictEqual(L.hist[0].v, 1);
  assert.strictEqual(L.items[0].off, 1, 'switched off, not deleted');
  assert.strictEqual(L.items[0].t, 'Obeležavanje radilišta neoštećeno (izmenjeno)');
  assert.strictEqual(L.items[1].who, 'zam');
  assert.strictEqual(L.items[L.items.length - 1].t, 'Nova stavka');
  a.run('drDo("tpSave",{})');
  assert.ok(/Nema izmena/.test(a.toastText()), 'saving without changes makes no version');
  assert.strictEqual(a.run('tplOf("RS","att").v'), 2);
  await a.settle();
  const b = await fresh({ storage });
  assert.deepStrictEqual(b.json('tplOf("RS","att")'), L, 'persists');
  assert.strictEqual(b.run('tplOf("BA","att").v'), 1, 'the other pack is untouched');
});

test('records keep the template version they were made with; a draft follows the template, a closed part does not', async () => {
  const a = await newDay();
  a.run('chkOf(site(),today(),"open",true)');
  assert.strictEqual(a.run('chkOf(site(),today(),"open").T.v'), 1);
  a.run('itemSet(site(),today(),"open","o01",1,"A. Delić","")');
  // the template changes: o01 switched off, a new item added
  a.run('const it=tplOf("BA","open").items.map(x=>Object.assign({},x));it[0].off=1;it.push({id:"oX",t:"Nova provjera",req:0,who:"vt",np:"",src:"",off:0});tplCommit("BA","open",it)');
  a.run('chkOf(site(),today(),"open",true)');
  const c = a.json('chkOf(site(),today(),"open")');
  assert.strictEqual(c.T.v, 2, 'draft follows');
  assert.ok(c.T.items.some(x => x.id === 'oX'));
  assert.ok(c.T.items.some(x => x.id === 'o01'), 'an answered item stays in the record although switched off in the template');
  // close it, change the template again: the closed record keeps v2
  a.run('chkOf(site(),today(),"open").T.items.filter(x=>x.req).forEach(x=>itemSet(site(),today(),"open",x.id,1,"A. Delić",""))');
  assert.ok(typeof a.run('chkClose(site(),today(),"open","A. Delić")') === 'object');
  a.run('tplCommit("BA","open",tplOf("BA","open").items.concat([{id:"oY",t:"Još jedna",req:1,who:"vt"}]))');
  a.run('chkOf(site(),today(),"open",true)');
  assert.strictEqual(a.run('chkOf(site(),today(),"open").T.v'), 2);
  assert.ok(/Šablon v2/.test(zb(a)), 'the document names the version');
});

test('briefing: the gate, closing needs every required part, closing locks it, changes after that are amendments', async () => {
  const a = await newDay();
  a.run('go("danas")');
  assert.ok(/Rad ne može početi/.test(a.html('#v-danas')), 'gate shown');
  a.click('start');
  assert.strictEqual(a.run('dayInfo(site()).started'), false, 'no work before a closed briefing');
  assert.ok(/zaključi dnevni brifing/.test(a.toastText()));
  a.run('drDo("brief",{})');
  const b0 = a.json('brOf(site(),today())');
  assert.ok(/Dvojac A \(D-01, D-02\): staza \d+/.test(b0.plan), 'work plan prefilled from the pairs: ' + b0.plan);
  assert.strictEqual(b0.by, 'A. Delić'); assert.strictEqual(b0.cv.medic, 'L. Omerović');
  assert.ok(b0.ppl.length >= 8 && b0.ppl.every(p => p.pr === 1 && !p.ack), 'team prefilled, present, not yet confirmed');
  assert.ok(/neobjašnjene obavezne teme/.test(a.html('#sheet')));
  assert.ok(/nisu potvrdili/.test(a.run('brClose(site(),today())')), 'cannot close yet');
  // taps: a topic, a CASEVAC confirmation, a person confirms, a chip and a weather chip
  a.run('drDo("top",{id:"b01"});drDo("pack",{id:"D-01"});drDo("ord",{v:"PMA-2"});drDo("wx",{v:"rain"})');
  const b1 = a.json('brOf(site(),today())');
  assert.ok(/^\d\d:\d\d$/.test(b1.top.b01.at)); assert.ok(/^\d\d:\d\d$/.test(b1.ppl.find(p => p.id === 'D-01').ack), 'timestamped confirmation');
  assert.deepStrictEqual(b1.ord, ['PMA-2']); assert.strictEqual(b1.wx, 'kiša');
  a.run('drDo("pres",{id:"D-06"})');
  assert.strictEqual(a.run('brOf(site(),today()).ppl.find(p=>p.id==="D-06").pr'), 0, 'absent');
  fillBrief(a);
  a.run('drDo("brClose",{})');
  const b = a.json('brOf(site(),today())');
  assert.strictEqual(b.st, 'z');
  assert.ok(/Dnevni brifing održan .*upoznato \d+ od \d+ prisutnih/.test(a.run('site().log[site().log.length-1].e')), 'log entry for P9');
  // fields cannot be changed silently any more
  const inp = Object.assign(a.dom.makeEl('input'), { value: 'tiho prepisano', dataset: { brf: 'plan' } });
  a.dom.listeners.change.forEach(fn => fn({ target: inp }));
  assert.strictEqual(a.run('brOf(site(),today()).plan'), b.plan, 'no silent overwrite');
  assert.ok(/zaključen/.test(a.run('brAck(site(),today(),"D-01")')), 'a confirmation cannot be undone after closing');
  // an amendment: old value, new value, reason, name
  assert.ok(/razlog/.test(a.run('brAmend(site(),today(),"plan","novi plan","","A. Delić")')));
  a.run('drDo("amend",{})');
  val(a, '#amF', 'plan'); val(a, '#amTo', 'Dvojac A u stazi 2'); val(a, '#amWhy', 'kiša, promjena staze'); val(a, '#amBy', 'A. Delić');
  a.run('drDo("amOk",{})');
  const am = a.json('brOf(site(),today()).am');
  assert.strictEqual(am.length, 1);
  assert.deepStrictEqual([am[0].f, am[0].from, am[0].to, am[0].why, am[0].by], ['plan', b.plan, 'Dvojac A u stazi 2', 'kiša, promjena staze', 'A. Delić']);
  // somebody arrives late: present + confirmed after closing are amendments too
  a.run('drDo("pres",{id:"D-06"});drDo("pack",{id:"D-06"})');
  assert.deepStrictEqual(a.json('brOf(site(),today()).am.map(x=>x.f)'), ['plan', 'pr', 'ack']);
  const h = zb(a);
  assert.ok(/Izmjene i dopune poslije zaključenja/.test(h) && /kiša, promjena staze/.test(h), 'amendments printed');
  // now work may start
  a.click('start');
  assert.strictEqual(a.run('dayInfo(site()).started'), true);
});

test('attestations and checklists: named and timed, shown in the documents; not OK opens an issue the team leader closes', async () => {
  const a = await newDay();
  a.run('go("danas")');
  // one tap: the person holding the item's role confirms now
  a.run('drDo("ok",{k:"att",id:"a02"})');
  const e = a.json('chkOf(site(),today(),"att").a.a02');
  assert.strictEqual(e.by, 'L. Omerović', 'medic item confirmed by the medic'); assert.strictEqual(e.ok, 1); assert.ok(/^\d\d:\d\d$/.test(e.at));
  // detail sheet: another person, not OK needs a note, opens an issue
  a.run('drDo("item",{k:"att",id:"a01"})');
  val(a, '#itBy', 'M. Hodžić'); val(a, '#itNote', '');
  a.run('drDo("itSet",{v:"0",k:"att",id:"a01"})');
  assert.ok(/napomenu/.test(a.toastText()), 'note required');
  val(a, '#itNote', 'oboren kolac kod staze 3');
  a.run('drDo("itSet",{v:"0",k:"att",id:"a01"})');
  const i = a.json('site().issues[0]');
  assert.strictEqual(i.id, 'NS-01'); assert.strictEqual(i.src, 'att'); assert.ok(/oboren kolac/.test(i.text)); assert.strictEqual(i.closed, null);
  assert.ok(/Otvorene neusaglašenosti/.test(a.html('#v-danas')) && /NS-01/.test(a.html('#v-danas')), 'visible to the team leader');
  // not applicable
  a.run('drDo("item",{k:"att",id:"a08"})'); val(a, '#itBy', 'I. Jukić'); a.run('drDo("itSet",{v:"2",k:"att",id:"a08"})');
  assert.strictEqual(a.run('chkOf(site(),today(),"att").a.a08.ok'), 2);
  // red automatic check acknowledged with a reason: recorded, still red
  const red = a.json('autoChecks(site()).find(c=>c.st==="bad"||c.st==="warn")');
  assert.ok(red, 'a red check on a new site');
  a.run(`drDo("ack",{k:${JSON.stringify(red.k)}})`); val(a, '#ackWhy', 'test detektora u 10:30'); val(a, '#ackBy', 'A. Delić');
  a.run(`drDo("ackOk",{k:${JSON.stringify(red.k)}})`);
  assert.ok(a.run(`autoChecks(site()).find(c=>c.k===${JSON.stringify(red.k)}).st!=="ok"`), 'not hidden');
  assert.ok(/Svjesno odstupanje: test detektora u 10:30/.test(a.html('#v-danas')));
  // documents: the record and the daily references
  const h = zb(a);
  for (const re of [/ZAPISNIK O DNEVNOM BRIFINGU I PROVJERAMA/, /L\. Omerović, \d\d:\d\d/, /M\. Hodžić, \d\d:\d\d/, /oboren kolac kod staze 3 \(NS-01\)/, /ne primjenjuje se/, /test detektora u 10:30/, /NS-01/])
    assert.ok(re.test(h), re + ' in the record');
  a.run('docView="p9";renderDoc("p9")');
  assert.ok(/Neusaglašenost NS-01/.test(a.html('#v-izvjestaji')) && /Svjesno odstupanje/.test(a.html('#v-izvjestaji')), 'P9 events');
  // the team leader closes the issue
  a.run('drDo("issClose",{id:"NS-01"})'); val(a, '#issNote', 'kolac vraćen, traka zategnuta'); val(a, '#issBy', 'A. Delić');
  a.run('drDo("issOk",{id:"NS-01"})');
  assert.strictEqual(a.run('site().issues[0].closed.note'), 'kolac vraćen, traka zategnuta');
  // closing the day: required items first, then a stored summary
  a.run('drDo("chk",{k:"close"})');
  assert.ok(/obavezne stavke bez odgovora/.test(a.run('chkClose(site(),today(),"close","A. Delić")')));
  a.run('chkOf(site(),today(),"close").T.items.forEach(x=>drDo("ok",{k:"close",id:x.id}))');
  a.run('drDo("chk",{k:"close"})'); val(a, '#ckBy', 'A. Delić'); a.run('drDo("ckClose",{k:"close"})');
  const c = a.json('chkOf(site(),today(),"close")');
  assert.ok(c.z && c.zBy === 'A. Delić' && c.sum && c.sum.f === 0, JSON.stringify(c.sum));
  assert.ok(/Sažetak dana/.test(zb(a)));
  assert.ok(/Kraj rada: radni dan zatvoren/.test(a.run('site().log.map(l=>l.e).join("|")')));
});

test('Serbian site: record in ekavica, referenced in the daily record; the inspector sees it read-only and flags it', async () => {
  const a = await fresh();
  a.run('S.active="r1";S.ui="sr";syncPack()');
  const h = zb(a);
  assert.ok(/ZAPISNIK O DNEVNOM BRIFINGU I PROVERAMA/.test(h) && !/PROVJERAMA|vrijeme|Vrijeme|mjesto/.test(h), 'ekavica');
  assert.ok(/NS-01/.test(h) && /Ručna radio stanica D-03/.test(h), 'seeded failed radio check');
  a.run('docView="rsd";renderDoc("rsd")');
  const r = a.html('#v-izvjestaji');
  assert.ok(/Dnevni brifing i provere/.test(r) && /Detaljno: Zapisnik o dnevnom brifingu i proverama/.test(r), 'reference in the dnevna evidencija');
  // inspector
  a.run('qa(site()).role="czrs";syncPack();go("danas")');
  const ov = a.html('#v-danas');
  assert.ok(/Dnevni zapisi izvođača/.test(ov) && /samo pregled/.test(ov) && /NS-01/.test(ov));
  a.run('drDo("ok",{k:"att",id:"a05"})');
  assert.ok(/Kontrolor CZRS/.test(a.toastText()), 'read-only: ' + a.toastText());
  assert.strictEqual(a.run('!!chkOf(site(),today(),"att").a.a05'), false);
  a.run('drDo("brief",{})');
  assert.ok(/disabled/.test(a.html('#sheet')) && !/data-dr="amend"/.test(a.html('#sheet')), 'briefing view only');
  a.run('drDo("flag",{day:today()})');
  val(a, '#flRef', 'brief'); val(a, '#flTxt', 'Nema potpisa posetioca'); val(a, '#flWho', 'K. Kontrolor');
  a.run('drDo("flagOk",{day:today()})');
  const n = a.json('qa(site()).ncs[qa(site()).ncs.length-1]');
  assert.strictEqual(n.kind, 'rec'); assert.ok(n.ref.startsWith('brief@')); assert.ok(/Nema potpisa posetioca/.test(n.text));
  assert.ok(a.json('certCheck(site()).why').some(x => x.includes(n.id)), 'blocks the certificate proposal');
  assert.ok(/Nedostaci koje je na ovim zapisima utvrdio kontrolor CZRS/.test(zb(a)));
  a.run('qa(site()).role="izv";syncPack();go("danas")');
  assert.ok(a.html('#v-danas').includes(n.id), 'the contractor sees it');
  assert.ok(typeof a.run(`qaNcClose(site(),${JSON.stringify(n.id)},"potpis dodat")`) === 'object', 'inspector closes it with a note');
});

test('detector log: a failed test opens an issue and flags what that deminer searched since the last pass for re-search', async () => {
  const a = await fresh();
  a.run('S.active="r1";S.ui="sr";syncPack()');
  const before = a.json('reSearch(site())').length;
  const r = a.json('detAdd(site(),{sn:"CMD-4410",res:"no",user:"D-01",by:"M. Hodžić",note:"ne reaguje na test-komad"})');
  assert.strictEqual(r.res, 'no'); assert.ok(r.iss);
  const i = a.json(`site().issues.find(x=>x.id===${JSON.stringify(r.iss)})`);
  assert.strictEqual(i.src, 'det');
  assert.ok(i.re.length > 0 && i.re.every(x => /^boks /.test(x)), 'boxes D-01 did today: ' + i.re.join(', '));
  assert.strictEqual(a.json('reSearch(site())').length, before + 1);
  a.run('go("mapa")');
  assert.ok(/Ponovna pretraga/.test(a.html('#v-mapa')), 'warning on the map');
  const ok = a.json('detAdd(site(),{sn:"CMD-4415",res:"ok",by:"M. Hodžić"})');
  assert.strictEqual(ok.res, 'ok');
  assert.strictEqual(a.run('complianceB(site()).find(c=>c.k==="det").st'), 'ok', 'a passed test satisfies the daily check');
  assert.ok(/CMD-4410/.test(zb(a)) && /neispravan/.test(zb(a)), 'in the record');
  assert.ok(/detektor/i.test(a.run('detAdd(site(),{sn:"",by:"x"})')), 'detector required');
});

test('old state without records or templates loads with defaults; every screen, sheet and document renders', async () => {
  const v3 = FIX('state-v3.json');
  assert.ok(!JSON.stringify(v3).includes('"rec"') && !JSON.stringify(v3).includes('"tpl"'));
  const a = await fresh({ storage: makeLocalStorage({ [KEY]: JSON.stringify(v3) }) });
  assert.deepStrictEqual(a.errors, []);
  assert.strictEqual(a.run('tplOf("RS","brief").items.length'), 13);
  for (const id of ['r1', 's1', 's2']) {
    a.run(`S.active="${id}";syncPack();closeSheet()`);
    assert.deepStrictEqual(a.json('site().rec'), {}); assert.deepStrictEqual(a.json('site().issues'), []);
    const out = [];
    a.run('go("danas")'); out.push(a.html('#v-danas'));
    out.push(zb(a));
    for (const x of ['drDo("brief",{})', 'drDo("chk",{k:"open"})', 'drDo("chk",{k:"close"})', 'drDo("det",{})', 'drDo("tpl",{})', 'drDo("item",{k:"att",id:"a01"})']) { a.run(x); out.push(a.html('#sheet')); }
    for (const h of out) assert.ok(!BAD.test(h), id + ': ' + (h.match(BAD) || [])[0]);
  }
});

test('validator: malformed records from a backup are typed or dropped, prototype keys ignored, nothing breaks a render', async () => {
  const a = await fresh({ idb: makeIndexedDB() });
  const st = a.json('S'), s1 = st.sites.find(s => s.id === 's1');
  const d = Object.keys(s1.rec).sort().pop();
  s1.rec['juče'] = { brief: {} };
  s1.rec[d].brief.st = 'whatever'; s1.rec[d].brief.ppl.push('x', { id: 7, pr: 'yes', ack: '7am', sigImg: 'javascript:1' });
  s1.rec[d].brief.top = JSON.parse('{"__proto__":{"at":"07:00"},"b01":{"at":"x"}}');
  s1.rec[d].att.a = JSON.parse('{"__proto__":{"ok":1},"a01":{"ok":"maybe","thumb":"data:text/html,1","h":[1,{"ok":2}]}}');
  s1.rec[d].close = { T: { v: 'x', items: [{ id: 'c1', t: 5, who: 'boss' }, 'y'] }, sum: { f: 'x', bad: { a: 1 }, ok: 3 } };
  s1.issues = [{ id: 'NS-01', closed: 'x' }, { id: 'NS-01' }, null, { text: 'no id' }];
  st.tpl.RS.att = { v: -3, items: [{ id: 'a', t: 'A' }, { id: 'a', t: 'dup' }, 5] };
  st.tpl.BA = 'x';
  const txt = JSON.stringify({ app: 'terenska-knjiga', format: 1, exported: new Date(NOW).toISOString(), state: st, photos: {} });
  a.run(`onRestoreFile({text:()=>Promise.resolve(${JSON.stringify(txt)})})`);
  await a.settle(); await a.run('restoreBackup()'); await a.settle();
  a.run('S.active="s1";syncPack()');
  const r = a.json('site().rec');
  assert.ok(!('juče' in r), 'bad day key dropped');
  assert.strictEqual(r[d].brief.st, 'd');
  assert.strictEqual(r[d].brief.ppl[r[d].brief.ppl.length - 1].id, '7'); assert.strictEqual(r[d].brief.ppl[r[d].brief.ppl.length - 1].ack, '');
  assert.ok(!('sigImg' in r[d].brief.ppl[r[d].brief.ppl.length - 1]));
  assert.deepStrictEqual(r[d].brief.top, {}, 'prototype key and bad time dropped');
  assert.strictEqual(a.run('({}).at'), undefined, 'Object.prototype untouched');
  assert.deepStrictEqual(r[d].att.a, { a01: { ok: 1, by: '', at: '', note: '', h: [{ ok: 2, by: '', at: '', note: '' }] } });
  assert.deepStrictEqual(r[d].close.T, { v: 1, items: [{ id: 'c1', t: '5', req: 0, who: 'vt', np: '', src: '', off: 0 }] });
  assert.deepStrictEqual(r[d].close.sum, { ok: 3 });
  assert.deepStrictEqual(a.json('site().issues.map(i=>[i.id,i.closed])'), [['NS-01', null]]);
  assert.deepStrictEqual(a.json('S.tpl.RS.att.items.map(x=>x.id)'), ['a']); assert.strictEqual(a.run('S.tpl.RS.att.v'), 1);
  assert.strictEqual(a.run('S.tpl.BA.brief.items.length'), 13, 'a broken pack gets the defaults');
  a.run(`docDay=${JSON.stringify(d)}`); assert.ok(!BAD.test(zb(a)));
  a.run('go("danas")'); assert.ok(!BAD.test(a.html('#v-danas')));
});

test('XSS: free text in records (plan, hazards, CASEVAC, names, notes, visitors, amendments, issues, detectors, templates) is escaped on screens and in documents', async () => {
  const a = await fresh({ idb: makeIndexedDB() });
  const st = a.json('S');
  for (const s of st.sites.filter(x => x.rec && Object.keys(x.rec).length)) {
    const d = Object.keys(s.rec).sort().pop(), r = s.rec[d], b = r.brief;
    Object.assign(b, { plan: PAYLOAD, haz: PAYLOAD, loc: PAYLOAD, by: PAYLOAD, wx: PAYLOAD, spec: PAYLOAD, ord: [PAYLOAD] });
    Object.assign(b.cv, { route: PAYLOAD, hosp: PAYLOAD });
    b.ppl[0].ime = PAYLOAD; b.ppl[0].fn = PAYLOAD; b.ppl[0].id = PAYLOAD;
    b.am.push({ d, t: '08:00', by: PAYLOAD, f: PAYLOAD, from: PAYLOAD, to: PAYLOAD, why: PAYLOAD });
    r.vis.push({ ime: PAYLOAD, org: PAYLOAD, bg: PAYLOAD, prat: PAYLOAD, by: PAYLOAD, at: '09:00', n: 1 });
    const k = r.att.T.items[0].id; r.att.T.items[0].t = PAYLOAD; r.att.T.items[0].np = PAYLOAD;
    r.att.a[k] = { ok: 0, by: PAYLOAD, at: '09:00', note: PAYLOAD, iss: PAYLOAD };
    r.ack.det = { t: PAYLOAD, v: PAYLOAD, why: PAYLOAD, by: PAYLOAD, at: '09:10' };
    s.issues.push({ id: PAYLOAD, d, t: '09:00', src: 'att', item: k, text: PAYLOAD, by: PAYLOAD, re: [PAYLOAD], closed: null });
    s.dlog.push({ d, t: '09:00', sn: PAYLOAD, tip: PAYLOAD, piece: PAYLOAD, cm: 10, res: 'no', why: 'start', user: PAYLOAD, by: PAYLOAD, note: PAYLOAD, iss: PAYLOAD });
  }
  st.tpl.RS.brief.items[0].t = PAYLOAD; st.tpl.BA.att.items[0].np = PAYLOAD;
  const txt = JSON.stringify({ app: 'terenska-knjiga', format: 1, exported: new Date(NOW).toISOString(), state: st, photos: {} });
  a.run(`onRestoreFile({text:()=>Promise.resolve(${JSON.stringify(txt)})})`);
  await a.settle(); await a.run('restoreBackup()'); await a.settle();
  assert.ok(a.run('S.sites.find(s=>s.id==="r1").issues.some(i=>i.text.startsWith("<img"))'), 'restored');
  const hits = [];
  for (const id of ['s1', 'r1']) for (const role of id === 'r1' ? ['izv', 'czrs'] : [null]) {
    a.run(`S.active="${id}";syncPack();closeSheet()` + (role ? `;qa(site()).role="${role}"` : ''));
    const shots = [['danas', 'go("danas")', '#v-danas'], ['map', 'go("mapa")', '#v-mapa'], ['zb', 'docView="zb";renderDoc("zb")', '#v-izvjestaji'],
      ['rsd/p9', id === 'r1' ? 'docView="rsd";renderDoc("rsd")' : 'docView="p9";renderDoc("p9")', '#v-izvjestaji'],
      ['brief', 'drDo("brief",{})', '#sheet'], ['att item', `drDo("item",{k:"att",id:chkOf(site(),today(),"att").T.items[0].id})`, '#sheet'],
      ['open', 'drDo("chk",{k:"open"})', '#sheet'], ['det', 'drDo("det",{})', '#sheet'], ['tpl', 'drDo("tpl",{})', '#sheet'], ['ack', 'openAck("det")', '#sheet']];
    for (const [w, x, sel] of shots) { a.run(x); if (RAW.test(a.html(sel))) hits.push(id + (role ? '/' + role : '') + ' ' + w); }
  }
  assert.deepStrictEqual(hits, [], 'payload executes in: ' + hits.join(', '));
});

test('i18n: every dynamic key of the daily records exists in bs, sr and en; English screens use no national UI words in the new sheets', async () => {
  const a = await fresh();
  const D = a.json('I18N');
  const dyn = [].concat(['vt', 'vs', 'med', 'zam', 'qa', 'eod', 'kv', 'op'].map(r => 'dr.role.' + r), ['open', 'brief', 'att', 'close', 'det'].map(k => 'dr.kind.' + k),
    ['imas', 'czrs', 'bhmac', 'sop'].map(k => 'dr.src.' + k), ['sun', 'cloud', 'rain', 'heat', 'cold', 'wind'].map(k => 'dr.wx.' + k), ['route', 'veh', 'medic', 'hosp'].map(k => 'dr.cv.' + k),
    a.json('AMF').map(k => 'dr.f.' + k), ['start', 'restart', 'battery', 'periodic', 'out'].map(k => 'dr.det.w.' + k));
  for (const L of ['bs', 'sr', 'en']) assert.deepStrictEqual(dyn.filter(k => !D[L][k]), [], L);
  // ekavica on Serbian, ijekavica on Bosnian screens
  assert.ok(/mj|ije/.test(D.bs['dr.am.title'] + D.bs['dr.tpl.down']) && !/mj|ije/.test(D.sr['dr.am.title'] + D.sr['dr.tpl.down']));
  a.run('S.ui="en"');
  const NAT = /(?<![\p{L}\d])(?:Sačuvaj|Dodaj|Otvori|Zatvori|Potvrdi|Nije|nije|potvrđeno|Upoznat|Prisutan|Odsutan|Brifing|brifing|Šablon|šablon|Posjetilac|Posetilac|Napomena|Razlog|Izmjena|Izmena)(?![\p{L}\d])/u;
  const bad = [];
  for (const id of ['s1', 'r1', 's2']) {
    a.run(`S.active="${id}";syncPack();closeSheet()`);
    for (const x of ['drDo("brief",{})', 'drDo("chk",{k:"open"})', 'drDo("chk",{k:"close"})', 'drDo("det",{})', 'drDo("tpl",{})', 'drDo("item",{k:"att",id:"a02"})', 'openAck("det")', 'openIss("NS-01")']) {
      a.run(x);
      const v = a.html('#sheet').replace(/<(textarea|option)[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/value="[^"]*"/g, '').replace(/<[^>]+>/g, m => ' ' + [...m.matchAll(/(?:aria-label|placeholder)="([^"]*)"/g)].map(y => y[1]).join(' ') + ' ');
      // stored text (template items, names, notes) stays national by design: take it out first
      const stored = [];
      (function walk(x) { if (typeof x === 'string') { if (x.length > 2) stored.push(x); } else if (x && typeof x === 'object') Object.values(x).forEach(walk); })(a.json('S'));
      let u = v.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      for (const s of stored.sort((p, q) => q.length - p.length)) u = u.split(s).join(' ');
      const left = u.split(/\s{2,}|·/).map(s => s.trim()).filter(s => s && NAT.test(s));
      if (left.length) bad.push(id + ' ' + x + ': ' + left.slice(0, 3).join(' | '));
    }
  }
  assert.deepStrictEqual(bad, []);
});
