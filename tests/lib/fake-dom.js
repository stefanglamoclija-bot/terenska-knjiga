'use strict';
// Just enough DOM for the app's render functions: every selector maps to one persistent fake element,
// so `$('#fLane').value = '4'` set by a test is what the app reads back. innerHTML is a plain string.
const decode = t => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function parseAttrs(s) { const o = {}; for (const m of s.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) o[m[1]] = m[2] == null ? '' : decode(m[2]); return o; }
// When the app writes a form with innerHTML, give the matching fake elements the values a browser would:
// inputs get their value attribute, selects their selected (or first) option, textareas their text,
// and each radio group's `input[name=..]:checked` its checked value ('' when none is checked).
function scanForm(html, get) {
  const groups = {};
  for (const m of html.matchAll(/<input\b([^>]*)>/g)) {
    const at = parseAttrs(m[1]);
    if (at.type === 'radio') { if (!(at.name in groups)) groups[at.name] = ''; if ('checked' in at) groups[at.name] = at.value; }
    else if (at.type === 'checkbox') { if (at.id) { const e = get('#' + at.id); e.checked = 'checked' in at; e.value = at.value || 'on'; } }
    else if (at.id && at.type !== 'file') get('#' + at.id).value = at.value != null ? at.value : '';
  }
  for (const [name, v] of Object.entries(groups)) get(`input[name="${name}"]:checked`).value = v;
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const at = parseAttrs(m[1]); if (!at.id) continue;
    const opts = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(o => { const oa = parseAttrs(o[1]); return { v: oa.value != null ? oa.value : decode(o[2]), sel: 'selected' in oa }; });
    const pick = opts.find(o => o.sel) || opts[0]; get('#' + at.id).value = pick ? pick.v : '';
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) { const at = parseAttrs(m[1]); if (at.id) get('#' + at.id).value = decode(m[2]); }
}

function makeEl(sel, get) {
  const classes = new Set();
  const attrs = {};
  let inner = '';
  const el = {
    _sel: sel,
    get innerHTML() { return inner; },
    set innerHTML(v) { inner = String(v); if (get) scanForm(inner, get); },
    textContent: '',
    innerText: '',
    hidden: false,
    disabled: false,
    checked: false,
    value: '',
    files: null,
    id: sel && sel[0] === '#' ? sel.slice(1) : '',
    dataset: {},
    style: {},
    listeners: {},
    lastChild: { textContent: '' },
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; if (v) classes.add(c); else classes.delete(c); return v; },
      contains: c => classes.has(c),
      _set: classes,
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: k => (k in attrs ? attrs[k] : null),
    removeAttribute: k => { delete attrs[k]; },
    addEventListener: (ev, fn) => { (el.listeners[ev] = el.listeners[ev] || []).push(fn); },
    removeEventListener: () => {},
    focus: () => {},
    click: () => {},
    remove: () => {},
    appendChild: () => {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return el;
}

function makeDom() {
  const els = new Map();
  const all = {}; // selector -> array returned by querySelectorAll (tests can set)
  const listeners = {};
  const get = sel => { if (!els.has(sel)) els.set(sel, makeEl(sel, get)); return els.get(sel); };
  const document = {
    querySelector: get,
    querySelectorAll: sel => all[sel] || [],
    getElementById: id => get('#' + id),
    createElement: tag => makeEl(tag),
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    body: makeEl('body'),
  };
  // Simulate a click on an element carrying data-act (the app uses one delegated click handler).
  function click(act, data = {}, extra = {}) {
    const target = Object.assign(makeEl('[data-act]'), extra, { dataset: Object.assign({ act }, data) });
    target.closest = () => target;
    (listeners.click || []).forEach(fn => fn({ target }));
    return target;
  }
  return { document, els, all, listeners, get, click, makeEl };
}

module.exports = { makeDom, makeEl };
