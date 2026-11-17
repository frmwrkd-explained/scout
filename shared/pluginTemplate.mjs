// shared/pluginTemplate.mjs — the whole of what a plugin can "run". PURE: no files, no network,
// no clock (today is handed in), no `eval`, no `new Function`.
//
// A plugin is a form, some formulas and a template (docs/10_SKILLS_AND_PLUGINS.md). This file is
// the formulas and the template. Both are read by a parser written here and walked by an
// interpreter written here, so a plugin's author — a person, or a model writing one on request —
// can only ever say what this file knows how to do. There is no way to spell "open a file" or
// "fetch a URL" in it: that is the safety model, and it is why none of this is `node:vm`.
//
//   FORMULAS   record.amount * input.tax_rate / 100
//              sum(lines, item.quantity * item.unit_price)      add_days(input.date, 14)
//   TEMPLATE   {{ client.name }}          a formula, printed with HTML escaped
//              {{#each lines}} … {{ item.description }} … {{/each}}
//              {{#if tax}} … {{else}} … {{/if}}
//
// Values are numbers, strings, booleans, null, lists and plain objects. A name is looked up as an
// OWN property only, so `record.constructor` and `item.__proto__` are just missing values.

export class PluginSyntaxError extends Error {
  constructor(message) { super(message); this.name = 'PluginSyntaxError'; }
}

const MAX_EXPR = 600;          // characters in one formula
const MAX_TEMPLATE = 200_000;  // characters in one template file
const MAX_OUTPUT = 2_000_000;  // characters a render may produce
const MAX_ROWS = 5000;         // items one {{#each}} or sum() will walk
const MAX_DEPTH = 40;

// ── formulas: tokens ─────────────────────────────────────────────────────────────────────────
function tokenize(src) {
  const s = String(src);
  if (s.length > MAX_EXPR) throw new PluginSyntaxError('a formula is at most ' + MAX_EXPR + ' characters');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(s.slice(i));
      out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (c === "'" || c === '"') {
      const end = s.indexOf(c, i + 1);
      if (end < 0) throw new PluginSyntaxError('a text value is missing its closing quote: ' + s.slice(i, i + 20));
      out.push({ t: 'str', v: s.slice(i + 1, end) }); i = end + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
      out.push({ t: 'name', v: m[0] }); i += m[0].length; continue;
    }
    const two = s.slice(i, i + 2);
    if (['==', '!=', '>=', '<='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/()<>.,'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new PluginSyntaxError('"' + c + '" is not something a formula can contain');
  }
  return out;
}

// ── formulas: parse → a small tree ───────────────────────────────────────────────────────────
export function parseExpr(src) {
  const toks = tokenize(src);
  if (!toks.length) throw new PluginSyntaxError('an empty formula');
  let p = 0, depth = 0;
  const peek = v => toks[p] && toks[p].t === 'op' && toks[p].v === v;
  const eat = v => { if (!peek(v)) throw new PluginSyntaxError('expected "' + v + '" in: ' + src); p++; };
  const nest = fn => { if (++depth > MAX_DEPTH) throw new PluginSyntaxError('a formula is nested too deeply'); const r = fn(); depth--; return r; };

  const primary = () => nest(() => {
    const t = toks[p];
    if (!t) throw new PluginSyntaxError('a formula ends too early: ' + src);
    if (t.t === 'num' || t.t === 'str') { p++; return { k: 'lit', v: t.v }; }
    if (t.t === 'op' && t.v === '(') { p++; const e = compare(); eat(')'); return e; }
    if (t.t === 'op' && t.v === '-') { p++; return { k: 'neg', a: primary() }; }
    if (t.t === 'name') {
      p++;
      if (peek('(')) {
        p++;
        const args = [];
        if (!peek(')')) { args.push(compare()); while (peek(',')) { p++; args.push(compare()); } }
        eat(')');
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, t.v) && !LAZY.has(t.v) && !HOST.has(t.v)) {
          throw new PluginSyntaxError('"' + t.v + '" is not a function a plugin can use');
        }
        return { k: 'call', name: t.v, args };
      }
      if (t.v === 'true' || t.v === 'false') return { k: 'lit', v: t.v === 'true' };
      if (t.v === 'null') return { k: 'lit', v: null };
      const path = [t.v];
      while (peek('.')) {
        p++;
        if (!toks[p] || toks[p].t !== 'name') throw new PluginSyntaxError('a name is missing after "." in: ' + src);
        path.push(toks[p].v); p++;
      }
      return { k: 'path', path };
    }
    throw new PluginSyntaxError('"' + t.v + '" is in the wrong place in: ' + src);
  });
  const term = () => { let a = primary(); while (peek('*') || peek('/')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: primary() }; } return a; };
  const sum = () => { let a = term(); while (peek('+') || peek('-')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: term() }; } return a; };
  const compare = () => nest(() => {
    const a = sum();
    for (const op of ['==', '!=', '>=', '<=', '>', '<']) if (peek(op)) { p++; return { k: 'bin', op, a, b: sum() }; }
    return a;
  });

  const tree = compare();
  if (p < toks.length) throw new PluginSyntaxError('"' + toks[p].v + '" is left over at the end of: ' + src);
  return tree;
}

// ── formulas: the functions ──────────────────────────────────────────────────────────────────
const num = v => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? NaN : Number(v));
const text = v => (v === null || v === undefined ? '' : Array.isArray(v) ? v.map(text).join(', ') : typeof v === 'object' ? '' : String(v));
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const FUNCTIONS = {
  count: list => (Array.isArray(list) ? list.length : 0),
  round: (x, places = 0) => { const f = 10 ** Math.max(0, Math.min(6, num(places) || 0)); const n = num(x); return Number.isNaN(n) ? null : Math.round(n * f) / f; },
  min: (...xs) => { const n = xs.flat().map(num).filter(x => !Number.isNaN(x)); return n.length ? Math.min(...n) : null; },
  max: (...xs) => { const n = xs.flat().map(num).filter(x => !Number.isNaN(x)); return n.length ? Math.max(...n) : null; },
  default: (a, b) => (a === null || a === undefined || a === '' || (typeof a === 'number' && Number.isNaN(a)) ? b : a),
  concat: (...xs) => xs.map(text).join(''),
  pad: (n, width = 0) => text(n).padStart(Math.max(0, Math.min(12, num(width) || 0)), '0'),
  first: list => (Array.isArray(list) && list.length ? list[0] : null),
  year: d => (isDate(d) ? Number(d.slice(0, 4)) : null),
  add_days: (d, n) => {
    if (!isDate(d) || Number.isNaN(num(n))) return null;
    return new Date(Date.parse(d.slice(0, 10) + 'T12:00:00Z') + Math.round(num(n)) * 86400000).toISOString().slice(0, 10);
  },
  // Formatting, for the template. `money` keeps two decimals because an invoice does.
  money: (x, symbol = '$') => { const n = num(x); return Number.isNaN(n) ? '' : (n < 0 ? '-' : '') + text(symbol) + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  number: x => { const n = num(x); return Number.isNaN(n) ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }); },
  date: d => (isDate(d) ? Number(d.slice(8, 10)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4) : text(d)),
};
// Take their arguments unevaluated: `sum` walks a list with `item` bound, `if` picks a side.
const LAZY = new Set(['sum', 'if']);
// Supplied by the app, never by the plugin: they read the workspace (and only read it).
const HOST = new Set(['next_number']);
export const FUNCTION_NAMES = [...Object.keys(FUNCTIONS), ...LAZY, ...HOST];

const own = (obj, key) => (obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);

// ── formulas: evaluate ───────────────────────────────────────────────────────────────────────
// `scope` is a plain object of names; `host` is the app's own functions (see HOST).
export function evalTree(node, scope, host = {}) {
  switch (node.k) {
    case 'lit': return node.v;
    case 'neg': { const n = num(evalTree(node.a, scope, host)); return Number.isNaN(n) ? null : -n; }
    case 'path': {
      let v = own(scope, node.path[0]);
      for (let i = 1; i < node.path.length && v !== undefined; i++) v = own(v, node.path[i]);
      return v === undefined ? null : v;
    }
    case 'bin': {
      const a = evalTree(node.a, scope, host), b = evalTree(node.b, scope, host);
      if (node.op === '==' || node.op === '!=') { const same = text(a) === text(b); return node.op === '==' ? same : !same; }
      if (['>', '<', '>=', '<='].includes(node.op)) {
        // Two dates compare as dates (ISO text sorts correctly); everything else as numbers.
        const [x, y] = isDate(a) && isDate(b) ? [a, b] : [num(a), num(b)];
        if (typeof x === 'number' && (Number.isNaN(x) || Number.isNaN(y))) return false;
        return node.op === '>' ? x > y : node.op === '<' ? x < y : node.op === '>=' ? x >= y : x <= y;
      }
      const x = num(a), y = num(b);
      if (Number.isNaN(x) || Number.isNaN(y)) return null;
      if (node.op === '+') return x + y;
      if (node.op === '-') return x - y;
      if (node.op === '*') return x * y;
      return y === 0 ? null : x / y;
    }
    case 'call': {
      if (node.name === 'if') return truthy(evalTree(node.args[0], scope, host)) ? evalArg(node, 1, scope, host) : evalArg(node, 2, scope, host);
      if (node.name === 'sum') {
        const list = evalTree(node.args[0], scope, host);
        if (!Array.isArray(list)) return 0;
        let total = 0;
        for (const item of list.slice(0, MAX_ROWS)) {
          const n = num(node.args[1] ? evalTree(node.args[1], { ...scope, item }, host) : item);
          if (!Number.isNaN(n)) total += n;
        }
        return total;
      }
      const args = node.args.map(a => evalTree(a, scope, host));
      if (HOST.has(node.name)) return typeof host[node.name] === 'function' ? host[node.name](...args) : null;
      return FUNCTIONS[node.name](...args);
    }
    default: return null;
  }
}
const evalArg = (node, i, scope, host) => (node.args[i] ? evalTree(node.args[i], scope, host) : null);
export const truthy = v => !(v === null || v === undefined || v === false || v === '' || v === 0 || (typeof v === 'number' && Number.isNaN(v)) || (Array.isArray(v) && !v.length));

export const evalExpr = (src, scope, host) => evalTree(parseExpr(src), scope, host);

// The root names a formula reads (`record.amount` → `record`), so a manifest can be checked for a
// name nothing defines before it is ever run.
export function rootsOf(src) {
  const roots = new Set();
  const walk = n => {
    if (!n || typeof n !== 'object') return;
    if (n.k === 'path') roots.add(n.path[0]);
    for (const key of ['a', 'b', 'expr', 'list', 'test']) walk(n[key]);
    for (const a of [...(n.args || []), ...(n.body || []), ...(n.otherwise || [])]) walk(a);
  };
  walk(typeof src === 'string' ? parseExpr(src) : src);
  return [...roots];
}
// The same, for a whole template.
export const templateRoots = src => rootsOf(parseTemplate(src));

// ── templates ────────────────────────────────────────────────────────────────────────────────
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function parseTemplate(src) {
  const s = String(src);
  if (s.length > MAX_TEMPLATE) throw new PluginSyntaxError('a template is at most ' + MAX_TEMPLATE + ' characters');
  const root = { k: 'block', body: [] };
  const stack = [{ node: root, into: root.body, tag: null }];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let at = 0, m;
  const top = () => stack[stack.length - 1];
  while ((m = re.exec(s))) {
    if (m.index > at) top().into.push({ k: 'text', v: s.slice(at, m.index) });
    at = m.index + m[0].length;
    const inner = m[1].trim();
    if (inner.startsWith('#each ')) {
      const node = { k: 'each', list: parseExpr(inner.slice(6)), body: [] };
      top().into.push(node); stack.push({ node, into: node.body, tag: 'each' });
    } else if (inner.startsWith('#if ')) {
      const node = { k: 'if', test: parseExpr(inner.slice(4)), body: [], otherwise: [] };
      top().into.push(node); stack.push({ node, into: node.body, tag: 'if' });
    } else if (inner === 'else') {
      if (top().tag !== 'if') throw new PluginSyntaxError('{{else}} outside an {{#if}}');
      top().into = top().node.otherwise;
    } else if (inner === '/each' || inner === '/if') {
      if (top().tag !== inner.slice(1)) throw new PluginSyntaxError('{{' + inner + '}} closes nothing');
      stack.pop();
    } else if (inner.startsWith('#') || inner.startsWith('/')) {
      throw new PluginSyntaxError('{{' + inner + '}} is not something a template can contain');
    } else {
      top().into.push({ k: 'print', expr: parseExpr(inner) });
    }
    if (stack.length > MAX_DEPTH) throw new PluginSyntaxError('a template is nested too deeply');
  }
  if (stack.length > 1) throw new PluginSyntaxError('{{#' + top().tag + '}} is never closed');
  if (at < s.length) root.body.push({ k: 'text', v: s.slice(at) });
  return root;
}

// `escape: true` for HTML (every printed value is escaped, always — there is no raw form);
// `escape: false` for a Markdown or plain-text template.
export function renderTemplate(src, scope, { escape = true, host = {} } = {}) {
  const tree = typeof src === 'string' ? parseTemplate(src) : src;
  let size = 0;
  const out = [];
  const push = s => { size += s.length; if (size > MAX_OUTPUT) throw new PluginSyntaxError('this template produces too much output'); out.push(s); };
  const walk = (nodes, sc) => {
    for (const n of nodes) {
      if (n.k === 'text') push(n.v);
      else if (n.k === 'print') {
        const raw = text(evalTree(n.expr, sc, host));
        // A multi-line value keeps its lines in HTML; the tags are written here, after escaping.
        push(escape ? escapeHtml(raw).replace(/\r?\n/g, '<br>') : raw);
      } else if (n.k === 'if') walk(truthy(evalTree(n.test, sc, host)) ? n.body : n.otherwise, sc);
      else if (n.k === 'each') {
        const list = evalTree(n.list, sc, host);
        if (!Array.isArray(list)) continue;
        list.slice(0, MAX_ROWS).forEach((item, i) => walk(n.body, { ...sc, item, index: i + 1 }));
      }
    }
  };
  walk(tree.body, scope);
  return out.join('');
}

// ── what an HTML template may not contain ────────────────────────────────────────────────────
// The preview is ALSO shown in a frame that cannot run scripts or load anything (see
// frontend/RecordActions.jsx), and the page carries a policy that says the same. This check is the
// first of those three layers, and the only one that can explain itself: it runs when a plugin is
// installed or drafted, and what it finds is shown to the person in plain words.
const FORBIDDEN = [
  [/<\s*script\b/i, 'contains a <script> — a plugin template cannot run code'],
  [/<\s*(iframe|frame|object|embed|applet|portal)\b/i, 'embeds another page or program'],
  [/<\s*(link|meta|base)\b/i, 'contains a <link>, <meta> or <base> tag, which can load or redirect'],
  [/<\s*(form|input|button|textarea|select)\b/i, 'contains a form control — a template is a document, not a page to fill in'],
  [/<\s*\/?\s*(html|head|body)\b/i, 'contains <html>, <head> or <body> — write only what goes inside the page; the app adds the rest'],
  [/\son[a-z]+\s*=/i, 'has an on… attribute (onclick, onload…), which is a way to run code'],
  [/(javascript|vbscript)\s*:/i, 'contains a javascript: address'],
  [/@import\b/i, 'imports a stylesheet from somewhere else'],
  [/\b(src|srcset|href|action|background|poster|data)\s*=(?!\s*["']?\s*(?:data:image\/|#|mailto:))/i, 'points at a file or an address — only pictures embedded as data: are allowed'],
  [/url\((?!\s*["']?\s*(?:data:image\/|data:font\/))/i, 'loads something with url(…) — only embedded data: pictures and fonts are allowed'],
  [/(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i, 'names an internet address — a plugin cannot reach the internet, so it would not load'],
];
export function htmlTemplateProblems(src) {
  const s = String(src || '');
  const problems = [];
  for (const [re, why] of FORBIDDEN) if (re.test(s)) problems.push(why);
  try { parseTemplate(s); } catch (e) { problems.push(e.message); }
  return problems;
}

// The page a rendered template is shown and printed in. The policy line is the second layer: even
// if something slipped past the check above, the browser will not fetch or run it.
export const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";
export function pageOf(bodyHtml, title = 'Document') {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="' + PAGE_POLICY + '">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + escapeHtml(title) + '</title></head><body>' + bodyHtml + '</body></html>';
}
