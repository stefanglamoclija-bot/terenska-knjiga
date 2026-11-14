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

test('P11 "Za završenu sedmicu" is a week that has already ended (Tue–Sun the app shows the running week)', async () => {
  const w = await windowAt(DAYS.wed + 'T10:00:00');
  assert.ok(w.to < DAYS.wed, `week ${w.from}..${w.to} has not ended on ${DAYS.wed}`);
}, { xfail: 'F-23' });

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
}, { xfail: 'F-01' });

test('lane progress recorded after midnight counts for the new day (todayM2 / P9)', async () => {
  const a = await at(DAYS.wed, '23:50:00');
  a.run('S.active="s1";syncPack()');
  a.clock.set(DAYS.thu + 'T07:30:00');
  a.click('adv', { l: '12', m: '1' });
  const p = a.json('site().progress[site().progress.length-1]');
  assert.strictEqual(p.day, DAYS.thu, 'progress stamped ' + p.day);
}, { xfail: 'F-01' });

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
}, { xfail: 'F-02' });

test('next morning: Dnevni izvještaj (P9) lists only today\'s events', async () => {
  const b = await nextDay();
  b.run('renderDoc("p9")');
  const h = b.html('#v-izvjestaji');
  assert.ok(!/Dolazak na radilište/.test(h) || !/Nalaz N-107/.test(h), 'yesterday\'s log (arrival, N-107) is printed in today\'s P9');
}, { xfail: 'F-02' });

test('next morning: the pre-work briefing must be confirmed again before work starts', async () => {
  const b = await nextDay();
  assert.strictEqual(b.run('S.dayStarted'), false, 'dayStarted carried over from yesterday');
}, { xfail: 'F-02' });

test('work log entries carry a date', async () => {
  const a = await app();
  a.run('S.active="s1";syncPack()');
  a.click('ev', { k: 'visit' });
  a.dom.document.querySelector('#eWho').value = 'Inspektor';
  a.run('saveEvent("visit")');
  const l = a.json('site().log[site().log.length-1]');
  assert.ok(l.day || l.date || l.at, 'log entry has only a time: ' + JSON.stringify(l));
}, { xfail: 'F-02' });
