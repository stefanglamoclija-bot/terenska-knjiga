'use strict';
// Minimal asynchronous IndexedDB: open / onupgradeneeded / transaction / get / put / clear / openCursor.
// Data lives in `idb._dbs` and survives across loadApp() calls that share the same instance.
// Fault injection: idb.failOpen (open -> onerror), idb.failPut (put -> transaction error), idb.failGet.
const later = fn => setImmediate(fn);

function clone(v) { try { return structuredClone(v); } catch (e) { return v; } }

function makeIndexedDB() {
  const dbs = new Map(); // name -> {version, stores: Map<name, Map>}
  const idb = { _dbs: dbs, failOpen: false, failPut: false, failGet: false, opens: 0 };

  function makeDb(rec) {
    return {
      objectStoreNames: { contains: n => rec.stores.has(n) },
      createObjectStore: n => { rec.stores.set(n, new Map()); return {}; },
      close() {},
      transaction(storeName, mode) {
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
        let pending = 0, failed = false;
        const done = () => later(() => {
          if (pending > 0) return;
          if (failed) { tx.onerror && tx.onerror({}); tx.onabort && tx.onabort({}); }
          else tx.oncomplete && tx.oncomplete({});
        });
        const fail = err => { failed = true; tx.error = err; };
        tx.objectStore = name => {
          const st = rec.stores.get(name);
          if (!st) throw new Error('NotFoundError: ' + name);
          const req = op => { const r = { onsuccess: null, onerror: null, result: undefined }; pending++;
            later(() => { try { r.result = op(); r.onsuccess && r.onsuccess({}); } catch (e) { r.error = e; fail(e); r.onerror && r.onerror({}); } pending--; done(); });
            return r; };
          return {
            get: k => req(() => { if (idb.failGet) throw new Error('UnknownError (get)'); return clone(st.get(k)); }),
            put: (v, k) => req(() => { if (mode !== 'readwrite') throw new Error('ReadOnlyError'); if (idb.failPut) throw new Error('QuotaExceededError'); st.set(k, clone(v)); return k; }),
            clear: () => req(() => { if (idb.failPut) throw new Error('UnknownError (clear)'); st.clear(); }),
            openCursor: () => {
              const r = { onsuccess: null, result: null }; const keys = [...st.keys()]; let i = 0; pending++;
              const step = () => later(() => {
                if (i < keys.length) { const k = keys[i++]; r.result = { key: k, value: clone(st.get(k)), continue: step }; r.onsuccess && r.onsuccess({}); }
                else { r.result = null; r.onsuccess && r.onsuccess({}); pending--; done(); }
              });
              step();
              return r;
            },
          };
        };
        // a transaction with no requests still completes
        later(() => { if (pending === 0) done(); });
        return tx;
      },
    };
  }

  idb.open = (name, version) => {
    idb.opens++;
    const r = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: null, error: null };
    later(() => {
      if (idb.failOpen) { r.error = new Error('UnknownError: Connection to Indexed Database server lost'); r.onerror && r.onerror({}); return; }
      let rec = dbs.get(name); let upgrade = false;
      if (!rec) { rec = { version: version || 1, stores: new Map() }; dbs.set(name, rec); upgrade = true; }
      r.result = makeDb(rec);
      if (upgrade && r.onupgradeneeded) r.onupgradeneeded({});
      r.onsuccess && r.onsuccess({});
    });
    return r;
  };
  idb.store = (db, store) => dbs.get(db) && dbs.get(db).stores.get(store);
  return idb;
}
module.exports = { makeIndexedDB };
