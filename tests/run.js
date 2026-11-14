#!/usr/bin/env node
'use strict';
// Terenska knjiga test harness. Node built-ins only:   node tests/run.js [filter] [--strict] [--verbose]
//   filter     run only tests whose file or name contains this text
//   --strict   also fail the run when an expected-to-fail test passes (XPASS), to force removing the marker
//   --verbose  print the error of every XFAIL too
// Exit code 1 when any test FAILs (unexpected failure).
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// All date logic in the app is local time. Pin the field timezone so results do not depend on the laptop.
const TZ = 'Europe/Sarajevo';
if (process.env.TZ !== TZ) {
  const r = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env: Object.assign({}, process.env, { TZ }) });
  process.exit(r.status == null ? 1 : r.status);
}

const { tests, setFile } = require('./lib/t');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const verbose = args.includes('--verbose');
const filter = args.find(a => !a.startsWith('--')) || '';

const dir = path.join(__dirname, 'suites');
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort()) {
  setFile(f.replace('.test.js', ''));
  require(path.join(dir, f));
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after ' + ms + ' ms')), ms).unref())]);

(async () => {
  const counts = { PASS: 0, FAIL: 0, XFAIL: 0, XPASS: 0 };
  const failures = [], xpasses = [];
  let lastFile = '';
  const selected = tests.filter(t => !filter || t.file.includes(filter) || t.name.includes(filter));
  for (const t of selected) {
    if (t.file !== lastFile) { console.log('\n# ' + t.file); lastFile = t.file; }
    let err = null;
    try { await withTimeout(Promise.resolve().then(t.fn), t.timeout); } catch (e) { err = e; }
    let status;
    if (t.xfail) status = err ? 'XFAIL' : 'XPASS';
    else status = err ? 'FAIL' : 'PASS';
    counts[status]++;
    const tag = t.xfail ? ' [' + t.xfail + ']' : '';
    console.log('  ' + status.padEnd(5) + ' ' + t.name + tag);
    if (status === 'FAIL') { failures.push({ t, err }); console.log('        ' + String(err && err.stack || err).split('\n').slice(0, 4).join('\n        ')); }
    if (status === 'XFAIL' && verbose) console.log('        ' + String(err && err.message || err).split('\n')[0]);
    if (status === 'XPASS') xpasses.push(t);
  }
  console.log('\n' + '-'.repeat(60));
  console.log(`total ${selected.length}  pass ${counts.PASS}  fail ${counts.FAIL}  xfail ${counts.XFAIL} (known defects)  xpass ${counts.XPASS}`);
  if (xpasses.length) console.log('XPASS means a known defect looks fixed; remove its xfail marker:\n' + xpasses.map(t => '  - ' + t.file + ': ' + t.name + ' [' + t.xfail + ']').join('\n'));
  process.exit(counts.FAIL || (strict && counts.XPASS) ? 1 : 0);
})();
