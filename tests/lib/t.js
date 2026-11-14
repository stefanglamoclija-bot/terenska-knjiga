'use strict';
// Tiny test registry. test(name, fn, {xfail:'F-07'}) marks a test that reproduces a known defect:
// it is reported as XFAIL while the bug exists and XPASS once fixed (then drop the xfail marker).
const tests = [];
let currentFile = '';
function setFile(f) { currentFile = f; }
function test(name, fn, opts = {}) { tests.push({ file: currentFile, name, fn, xfail: opts.xfail || null, timeout: opts.timeout || 20000 }); }
module.exports = { test, tests, setFile };
