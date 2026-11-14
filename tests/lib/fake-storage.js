'use strict';
// Map-backed localStorage. Share one instance between two loadApp() calls to simulate a page reload.
function makeLocalStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  const ls = {
    throws: false,
    quota: Infinity, // max total characters; setItem past it throws QuotaExceededError
    _map: m,
    getItem(k) { if (ls.throws) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      if (ls.throws) throw new Error('SecurityError');
      v = String(v);
      let size = v.length; for (const [kk, vv] of m) if (kk !== k) size += vv.length;
      if (size > ls.quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, v);
    },
    removeItem(k) { if (ls.throws) throw new Error('SecurityError'); m.delete(k); },
    clear() { m.clear(); },
    get length() { return m.size; },
  };
  return ls;
}
module.exports = { makeLocalStorage };
