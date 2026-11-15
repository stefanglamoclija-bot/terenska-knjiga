'use strict';
const assert = require('assert');
const { test } = require('../lib/t');
const { loadApp, makeLocalStorage } = require('../lib/harness');

// 2026-11-09 is a Monday. All times are Europe/Sarajevo (run.js pins TZ).
const DAYS = { mon: '2026-11-09', tue: '2026-11-10', wed: '2026-11-11', thu: '2026-11-12', fri: '2026-11-13', sat: '2026-11-14', sun: '2026-11-15', nextMon: '2026-11-16' };
let base = null;
const app = () => (base = base || loadApp({ now: DAYS.wed + 'T10:00:00' }));

async function windowAt(local) {
  const a = await app();
  a.clock.set(local);
  const w = a.run('(()=>{const w=weeklyWindow();return {dl:dayKey(w.deadline)+" "+hm(w.deadline),from:w.from,to:w.to};})()');
  return JSON.parse(JSON.stringify(w));
}

const cases = [
  [DAYS.mon + 'T08:00:00', DAYS.mon + ' 16:00', '2026-11-02', '2026-11-08'],
  [DAYS.mon + 'T15:59:00', DAYS.mon + ' 16:00', '2026-11-02', '2026-11-08'],
  [DAYS.mon + 'T16:00:00', DAYS.nextMon + ' 16:00', DAYS.mon, DAYS.sun],
  [DAYS.mon + 'T16:01:00', DAYS.nextMon + ' 16:00', DAYS.mon, DAYS.sun],
  [DAYS.tue + 'T10:00:00', DAYS.nextMon + ' 16:00', DAYS.mon, DAYS.sun],
  [DAYS.wed + 'T10:00:00', DAYS.nextMon + ' 16:00', DAYS.mon, DAYS.sun],
  [DAYS.thu + 'T10:00:00', DAYS.nextMon + ' 16:00', DAYS.mon, DAYS.sun],
  [DAYS.fri + 'T10:00:00', DAYS.nextMon + ' 16:00', DAYS.mon, DAYS.sun],
  [DAYS.sat + 'T10:00:00', DAYS.nextMon + ' 16:00', DAYS.mon, DAYS.sun],
  [DAYS.sun + 'T23:59:00', DAYS.nextMon + ' 16:00', DAYS.mon, DAYS.sun],
  [DAYS.nextMon + 'T00:00:30', DAYS.nextMon + ' 16:00', DAYS.mon, DAYS.sun],
];
for (const [now, dl, from, to] of cases) {
  test(`weeklyWindow at ${now.replace('T', ' ')} -> deadline ${dl}, window ${from}..${to}`, async () => {
    const w = await windowAt(now);
    assert.deepStrictEqual(w, { dl, from, to });
  });
}

test('weeklyWindow across the DST change (Sun 2026-10-25) still gives Monday 16:00 local', async () => {
  const w = await windowAt('2026-10-25T10:00:00');
  assert.strictEqual(w.dl, '2026-10-26 16:00');
  const w2 = await windowAt('2026-03-28T10:00:00'); // Saturday before spring-forward
  assert.strictEqual(w2.dl, '2026-03-30 16:00');
});

test('P11 "Za završenu sedmicu" is a week that has already ended (the running week is only an explicit draft)', async () => {
  const a = await app();
  for (const [now, from, to, dl] of [[DAYS.wed + 'T10:00:00', '2026-11-02', '2026-11-08', DAYS.mon], [DAYS.mon + 'T08:00:00', '2026-11-02', '2026-11-08', DAYS.mon], [DAYS.sun + 'T22:00:00', '2026-11-02', '2026-11-08', DAYS.mon], [DAYS.nextMon + 'T17:00:00', DAYS.mon, DAYS.sun, DAYS.nextMon]]) {
    a.clock.set(now);
    const w = a.json('(()=>{const w=p11Range(false);return {from:w.from,to:w.to,dl:dayKey(w.deadline)}})()');
    assert.deepStrictEqual(w, { from, to, dl }, now);
    assert.ok(w.to < now.slice(0, 10), `week ${w.from}..${w.to} has not ended on ${now}`);
  }
  a.clock.set(DAYS.wed + 'T10:00:00');
  a.run('S.active="s1";syncPack();p11Cur=false;renderDoc("p11")');
  assert.ok(/od<\/b> 02\.11\.2026\. <b>do<\/b> 08\.11\.2026\./.test(a.html('#v-izvjestaji')), 'P11 shows the completed week');
  a.run('p11Cur=true;renderDoc("p11")');
  assert.ok(/sedmica još traje: nacrt/.test(a.html('#v-izvjestaji')), 'running week is marked as a draft');
  a.run('p11Cur=false');
});

async function at(day, time = '10:00:00', opts = {}) { return loadApp(Object.assign({ now: day + 'T' + time }, opts)); }

test('workdaysSince counts weekdays across weekends', async () => {
  const a = await at(DAYS.nextMon);
  assert.strictEqual(a.run(`workdaysSince('${DAYS.fri}')`), 1, 'Fri -> Mon');
  assert.strictEqual(a.run(`workdaysSince('${DAYS.sat}')`), 1, 'Sat -> Mon');
  assert.strictEqual(a.run(`workdaysSince('${DAYS.sun}')`), 1, 'Sun -> Mon');
  assert.strictEqual(a.run(`workdaysSince('${DAYS.mon}')`), 5, 'Mon -> next Mon');
  assert.strictEqual(a.run(`workdaysSince('${DAYS.nextMon}')`), 0, 'same day');
  assert.strictEqual(a.run(`workdaysSince('2026-10-30')`), 11, 'Fri 30.10 -> Mon 16.11 (DST in between)');
  const s = await at(DAYS.sat);
  assert.strictEqual(s.run(`workdaysSince('${DAYS.fri}')`), 0, 'Fri -> Sat');
  assert.strictEqual(s.run(`workdaysSince('${DAYS.thu}')`), 1, 'Thu -> Sat');
});

test('workdaysBack(6) returns 6 weekdays before today, oldest first, no weekend days', async () => {
  const a = await at(DAYS.nextMon);
  const d = a.json('workdaysBack(6)');
  assert.deepStrictEqual(d, ['2026-11-06', DAYS.mon, DAYS.tue, DAYS.wed, DAYS.thu, DAYS.fri]);
});

test('dayKey/hm use local time at the midnight boundary (no UTC shift)', async () => {
  const a = await app();
  assert.strictEqual(a.run(`dayKey(new Date('${DAYS.wed}T23:59:59'))`), DAYS.wed);
  assert.strictEqual(a.run(`dayKey(new Date('${DAYS.thu}T00:00:01'))`), DAYS.thu);
  assert.strictEqual(a.run(`fmtTs('2026-11-11T23:30:00Z')`), '12.11.2026. u 00:30');
});

test('internal monitoring compliance: 4 workdays ok/warn, 5 workdays is a violation', async () => {
  const a = await at(DAYS.nextMon);
  a.run('S.active="s1";syncPack()');
  const st = d => { a.run(`site().monitors=[{day:'${d}',by:'x'}]`); return a.json('compliance(site())').find(c => /nadzor/.test(c.t)); };
  assert.strictEqual(st(DAYS.fri).st, 'ok');
  assert.strictEqual(st(DAYS.tue).st, 'warn');
  assert.strictEqual(st(DAYS.mon).st, 'bad');
});

// ---- the app stays open across midnight (phones keep a PWA alive in the background for days) ----
test('a find saved after midnight is dated the new day, not the day the app was opened', async () => {
  const a = await at(DAYS.wed, '23:50:00');
  a.run('S.active="s1";syncPack();go("nalaz")');
  a.clock.set(DAYS.thu + 'T07:30:00');
  const d = a.dom.document;
  d.querySelector('#fLane').value = '4'; d.querySelector('#fDist').value = '16'; d.querySelector('#fOff').value = '0';
  d.querySelector('#fDepth').value = '7'; d.querySelector('#fQty').value = '1'; d.querySelector('#fAct').value = 'x'; d.querySelector('#fNote').value = '';
  d.querySelector('input[name="ftype"]:checked').value = 'PMA-2'; d.querySelector('input[name="fcat"]:checked').value = 'PP'; d.querySelector('input[name="fcond"]:checked').value = 'Neoštećeno';
  a.run('onSubmit({preventDefault(){}})');
  const f = a.json('site().finds[site().finds.length-1]');
  assert.strictEqual(f.time, '07:30');
  assert.strictEqual(f.day, DAYS.thu, `find stamped ${f.day} ${f.time}`);
});

test('lane progress recorded after midnight counts for the new day (todayM2 / P9)', async () => {
  const a = await at(DAYS.wed, '23:50:00');
  a.run('S.active="s1";syncPack()');
  a.clock.set(DAYS.thu + 'T07:30:00');
  a.click('adv', { l: '12', m: '1' });
  const p = a.json('site().progress[site().progress.length-1]');
  assert.strictEqual(p.day, DAYS.thu, 'progress stamped ' + p.day);
});

// ---- the work log has no date ----
async function nextDay() {
  const storage = makeLocalStorage();
  const a = await at(DAYS.wed, '10:00:00', { storage });
  a.run('save()');
  const b = await at(DAYS.thu, '07:05:00', { storage });
  b.run('S.active="s1";syncPack()');
  return b;
}

test('next morning: "Test detektora na UPMAH-3 danas" is NOT satisfied by yesterday\'s test', async () => {
  const b = await nextDay();
  const c = b.json('compliance(site())').find(x => /detektora/.test(x.t));
  assert.strictEqual(c.st, 'bad', 'detector test shows ' + c.st + ' (' + c.v + ') with no test today');
});

test('next morning: Dnevni izvještaj (P9) lists only today\'s events', async () => {
  const b = await nextDay();
  b.run('renderDoc("p9")');
  const h = b.html('#v-izvjestaji');
  assert.ok(!/Dolazak na radilište/.test(h) || !/Nalaz N-107/.test(h), 'yesterday\'s log (arrival, N-107) is printed in today\'s P9');
});

test('next morning: the pre-work briefing must be confirmed again before work starts', async () => {
  const b = await nextDay();
  assert.strictEqual(b.run('dayInfo(site()).started'), false, 'work-started carried over from yesterday');
});

test('work log entries carry a date', async () => {
  const a = await app();
  a.run('S.active="s1";syncPack()');
  a.click('ev', { k: 'visit' });
  a.dom.document.querySelector('#eWho').value = 'Inspektor';
  a.run('saveEvent("visit")');
  const l = a.json('site().log[site().log.length-1]');
  assert.ok(/^\d{4}-\d\d-\d\d$/.test(l.d), 'log entry has only a time: ' + JSON.stringify(l));
});

// ---- regression: the new day starts while the app stays open; old undated logs are migrated, not re-dated ----
test('crossing midnight with the app open: checkDay() starts the new day (briefing unconfirmed, empty day log), data kept', async () => {
  const a = await at(DAYS.wed, '23:58:00');
  a.run('S.active="s1";syncPack();go("danas")');
  assert.strictEqual(a.run('dayInfo(site()).started'), true);
  const n = a.run('S.sites.reduce((x,s)=>x+s.finds.length+s.log.length,0)');
  a.clock.set(DAYS.thu + 'T00:01:00');
  assert.strictEqual(a.run('checkDay()'), true, 'new day detected');
  assert.strictEqual(a.run('checkDay()'), false, 'only once');
  assert.strictEqual(a.run('dayInfo(site()).started'), false);
  assert.ok(/Rad ne može početi/.test(a.html('#v-danas')), 'briefing gate shown again');
  assert.ok(/Danas još nema zapisa/.test(a.html('#v-danas')), 'yesterday\'s log is not today\'s');
  assert.strictEqual(a.run('S.sites.reduce((x,s)=>x+s.finds.length+s.log.length,0)'), n, 'nothing deleted');
  assert.ok(/Novi dan/.test(a.toastText()));
});

test('undated log entries from older versions: dated from the find they name, otherwise legacy and out of today\'s views', async () => {
  const st = JSON.parse(JSON.stringify(require('../fixtures/state-v3.json')));
  const s1 = st.sites.find(s => s.id === 's1');
  s1.log = [{ t: '07:25', e: 'Test detektora na UPMAH-3 (10 cm): 6 detektora ispravno', k: 'det' }, { t: '09:12', e: 'Nalaz ' + s1.finds[0].id + ': x', k: 'find' }];
  st.brief = [true, true, true, true, true, true]; st.dayStarted = true; st.briefAt = '07:10';
  const storage = makeLocalStorage({ 'terenska-knjiga-v3': JSON.stringify(st) });
  const a = await at(DAYS.wed, '10:00:00', { storage });
  a.run('S.active="s1";syncPack();go("danas")');
  const log = a.json('site().log');
  assert.strictEqual(log[1].d, s1.finds[0].day, 'find entry dated by its find');
  assert.strictEqual(log[0].d, '', 'detector test has no inferable day');
  assert.strictEqual(log[0].legacy, 1);
  assert.strictEqual(a.json('compliance(site())').find(c => /detektora/.test(c.t)).st, 'bad', 'an undated old test does not satisfy today');
  assert.ok(/Zapisi bez datuma iz starije verzije \(1\)/.test(a.html('#v-danas')), 'legacy entries stay visible, apart');
  assert.strictEqual(a.run('dayInfo(site()).started'), false, 'undated old briefing does not count for today');
  assert.strictEqual(a.run('"brief" in S||"dayStarted" in S'), false);
});

test('P9 for an earlier day lists that day only; explosive used is that day\'s', async () => {
  const a = await app();
  a.run('S.active="s1";syncPack()');
  const days = a.json('workDays(site())');
  const d = days.find(x => a.run(`dayLog(site(),'${x}').some(l=>l.k==='dem')`));
  a.run(`docDay='${d}';renderDoc('p9')`);
  const h = a.html('#v-izvjestaji');
  const kg = a.run(`dayLog(site(),'${d}').filter(l=>l.k==='dem').reduce((x,l)=>x+(+l.kg||0),0)`);
  assert.ok(h.includes('<b>Datum:</b> ' + a.run(`fmtD('${d}')`)), 'dated ' + d);
  assert.ok(h.includes(a.run(`num(${kg},2)`) + ' kg TNT'), 'kg of that day');
  assert.ok(/<select id="docDay">/.test(h), 'day picker');
  a.run('docDay=null');
});
