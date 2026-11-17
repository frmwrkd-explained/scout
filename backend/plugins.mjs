// backend/plugins.mjs — plugins: a button on a record that makes something.
//
// docs/10_SKILLS_AND_PLUGINS.md is the concept; this is the whole implementation of it.
//
// A plugin is a FOLDER: `plugin.md` (what it is, which collection it adds a button to, what the
// form asks, the formulas, what record it creates) plus the template files it names. It contains
// NO CODE. Everything a plugin can do is said in the formula and template language of
// shared/pluginTemplate.mjs, which this app parses and walks itself — so installing a plugin from
// a stranger, or approving one a model just wrote, cannot run anything on this machine, read a file
// outside the record it was pressed on, or reach the internet. That is a deliberate limit, and it
// is the reason plugins can be shared at all.
//
// Where they live:
//   <app>/plugins/<id>/                 built in, shipped with the app, read-only
//   <workspace>/plugins/<id>/           installed in this workspace (travels with the folder)
//   <workspace>/plugins/_drafts/<id>/   written by a model or copied from another, NOT active
//   <workspace>/plugins/_archive/…      discarded or removed — never deleted
//
// What a plugin may write: ONE record, in the collection its manifest names, through
// `records.upsertRecord` like every other writer — so the record carries provenance
// (`via: plugin:<id>/<action>` in the log) and the near-match and gate rules all apply.
// Only a person runs a plugin, creates one or approves one. An agent that wants any of the three
// proposes it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStorageRoot, readMd, writeMd, getSettings } from './store.mjs';
import { getCollection, listCollections } from './collections.mjs';
import { documentsFor, allDocuments } from './documents.mjs';
import { upsertRecord, nearMatches, MERGE_CONFIDENCE } from './records.mjs';
import { readMe } from './memory.mjs';
import { isAgentActor, DEFAULT_ACTOR } from './actors.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';
import { logEvent, readEvents } from './log.mjs';
import { think, parseJsonBlock, pickProviders } from './brain.mjs';
import {
  parseExpr, evalExpr, rootsOf, templateRoots, renderTemplate, htmlTemplateProblems, parseTemplate,
  pageOf, FUNCTION_NAMES,
} from '../shared/pluginTemplate.mjs';

export class PluginError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.name = 'PluginError'; this.status = status; Object.assign(this, extra); }
}

const BUNDLED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins');
export const pluginsDir = () => path.join(getStorageRoot(), 'plugins');
const draftsDir = () => path.join(pluginsDir(), '_drafts');
const archiveDir = () => path.join(pluginsDir(), '_archive');

const ID = /^[a-z][a-z0-9-]{1,39}$/;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const FILE = /^[a-z0-9][a-z0-9._-]{0,59}\.(html|md)$/;
const RESERVED = ['record', 'input', 'me', 'today', 'item', 'index', 'true', 'false', 'null'];
export const INPUT_TYPES = ['text', 'number', 'date', 'longtext'];
const MAX_FILE = 200_000;
const str = (v, max) => String(v ?? '').trim().slice(0, max);

// ── reading a plugin folder ──────────────────────────────────────────────────────────────────
function readFolder(dir, source) {
  const id = path.basename(dir);
  let data = {}, readme = '';
  const problems = [];
  try { const md = readMd(path.join(dir, 'plugin.md')); data = md.data || {}; readme = String(md.content || '').trim(); }
  catch { problems.push('plugin.md is missing or cannot be read'); }
  const files = {};
  try {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === 'plugin.md' || name.startsWith('.') || !FILE.test(name)) continue;
      const abs = path.join(dir, name);
      const stat = fs.statSync(abs);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_FILE) { problems.push(name + ' is larger than a template may be'); continue; }
      files[name] = fs.readFileSync(abs, 'utf8');
    }
  } catch { /* an unreadable folder is reported by the missing plugin.md above */ }
  const checked = checkManifest({ ...data, id: data.id || id }, files);
  if (data.id && data.id !== id) checked.problems.push('the folder is called "' + id + '" but plugin.md says id "' + data.id + '"');
  return { id, source, dir, readme, files, manifest: checked.manifest, problems: [...problems, ...checked.problems], meta: data };
}

// ── the manifest: what is allowed, said once ─────────────────────────────────────────────────
// → { manifest, problems }. `manifest` holds only the keys named here: a key this does not read
// does not exist, however it was spelled in the file.
export function checkManifest(raw, files = {}) {
  const problems = [];
  const m = raw && typeof raw === 'object' ? raw : {};
  const manifest = {
    id: str(m.id, 40),
    name: str(m.name, 60) || str(m.id, 40),
    version: str(m.version, 20) || '0.1.0',
    description: str(m.description, 300),
    author: str(m.author, 80),
    kind: 'template',
    actions: [],
  };
  if (!ID.test(manifest.id)) problems.push('the id must be lowercase letters, digits and dashes (2–40 characters)');
  if (m.kind && m.kind !== 'template') problems.push('kind "' + m.kind + '" is not supported — a plugin is kind: template');
  const actions = Array.isArray(m.actions) ? m.actions.slice(0, 8) : [];
  if (!actions.length) problems.push('a plugin needs at least one action');

  const formula = (src, names, where) => {
    try {
      for (const root of rootsOf(String(src))) if (!names.has(root)) problems.push(where + ' uses "' + root + '", which nothing defines');
      return String(src);
    } catch (e) { problems.push(where + ': ' + e.message); return null; }
  };

  for (const a of actions) {
    const at = 'action "' + str(a && a.id, 40) + '"';
    if (!a || typeof a !== 'object') { problems.push('an action is not a set of keys'); continue; }
    const action = { id: str(a.id, 40), on: str(a.on, 60), label: str(a.label, 40), template: str(a.template, 64), inputs: [], reads: {}, compute: [], creates: null };
    if (!KEY.test(action.id.replace(/-/g, '_'))) problems.push('an action needs an id (lowercase letters, digits, dashes)');
    if (!action.on) problems.push(at + ' does not say which collection it is for (on:)');
    if (!action.label) problems.push(at + ' has no label for its button');
    const names = new Set(['record', 'input', 'me', 'today', 'item', 'index']);
    const define = (key, where) => {
      if (!KEY.test(key)) { problems.push(where + ' "' + key + '" is not a usable name'); return false; }
      if (RESERVED.includes(key)) { problems.push(where + ' "' + key + '" is a reserved name'); return false; }
      names.add(key); return true;
    };

    for (const [key, src] of Object.entries(a.reads && typeof a.reads === 'object' ? a.reads : {}).slice(0, 8)) {
      const f = formula(src, names, at + ' reads.' + key);
      if (f && define(key, at + ' reads')) action.reads[key] = f;
    }
    for (const i of (Array.isArray(a.inputs) ? a.inputs : []).slice(0, 12)) {
      const input = { key: str(i && i.key, 40), label: str(i && i.label, 60) || str(i && i.key, 40), type: INPUT_TYPES.includes(i && i.type) ? i.type : 'text', help: str(i && i.help, 160) };
      if (!KEY.test(input.key)) { problems.push(at + ' has an input with no usable key'); continue; }
      if (i.default !== undefined && i.default !== null && i.default !== '') {
        const f = formula(i.default, names, at + ' default of ' + input.key);
        if (f) input.default = f;
      }
      action.inputs.push(input);
    }
    for (const step of (Array.isArray(a.compute) ? a.compute : []).slice(0, 40)) {
      const key = str(step && step.key, 40);
      const where = at + ' compute.' + key;
      if (step && step.each !== undefined) {
        const each = formula(step.each, names, where);
        const as = {};
        for (const [k, src] of Object.entries(step.as && typeof step.as === 'object' ? step.as : {}).slice(0, 20)) {
          const f = formula(src, names, where + '.' + k);
          if (f && KEY.test(k)) as[k] = f;
        }
        if (each && Object.keys(as).length && define(key, at + ' compute')) action.compute.push({ key, each, as });
        else if (each && !Object.keys(as).length) problems.push(where + ' has each: but no as:');
      } else {
        const value = formula(step && step.value, names, where);
        if (value && define(key, at + ' compute')) action.compute.push({ key, value });
      }
    }

    if (!FILE.test(action.template) || !action.template.endsWith('.html')) problems.push(at + ' needs a template file ending in .html');
    else if (files[action.template] === undefined) problems.push(at + ' names the template ' + action.template + ', which is not in the folder');
    else {
      for (const p of htmlTemplateProblems(files[action.template])) problems.push(action.template + ' ' + p);
      try { for (const root of templateRoots(files[action.template])) if (!names.has(root)) problems.push(action.template + ' prints "' + root + '", which nothing defines'); } catch { /* reported above */ }
    }

    if (a.creates && typeof a.creates === 'object') {
      const creates = { collection: str(a.creates.collection, 60), fields: {}, body: str(a.creates.body, 64) || null };
      if (!creates.collection) problems.push(at + ' creates a record but does not say in which collection');
      for (const [k, src] of Object.entries(a.creates.fields && typeof a.creates.fields === 'object' ? a.creates.fields : {}).slice(0, 40)) {
        if (!KEY.test(k)) { problems.push(at + ' creates a field called "' + k + '", which is not a usable name'); continue; }
        const f = formula(src, names, at + ' creates.' + k);
        if (f) creates.fields[k] = f;
      }
      if (!Object.keys(creates.fields).length) problems.push(at + ' creates a record with no fields');
      if (creates.body) {
        if (!FILE.test(creates.body) || !creates.body.endsWith('.md')) problems.push(at + ' body must be a .md template in the folder');
        else if (files[creates.body] === undefined) problems.push(at + ' names the note template ' + creates.body + ', which is not in the folder');
        else {
          try { for (const root of templateRoots(files[creates.body])) if (!names.has(root)) problems.push(creates.body + ' prints "' + root + '", which nothing defines'); }
          catch (e) { problems.push(creates.body + ': ' + e.message); }
        }
      }
      action.creates = creates;
    }
    manifest.actions.push(action);
  }
  const ids = manifest.actions.map(a => a.id);
  if (new Set(ids).size !== ids.length) problems.push('two actions share an id');
  return { manifest, problems: [...new Set(problems)] };
}

// ── listing ──────────────────────────────────────────────────────────────────────────────────
const foldersIn = dir => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_')).map(e => path.join(dir, e.name)).sort(); }
  catch { return []; }
};

function installed() {
  const out = foldersIn(BUNDLED_DIR).map(dir => readFolder(dir, 'built-in'));
  const taken = new Set(out.map(p => p.id));
  for (const dir of foldersIn(pluginsDir())) {
    const p = readFolder(dir, 'workspace');
    if (taken.has(p.id)) p.problems.push('a built-in plugin already has the id "' + p.id + '" — this one is not used');
    else taken.add(p.id);
    out.push(p);
  }
  return out;
}
const drafts = () => foldersIn(draftsDir()).map(dir => readFolder(dir, 'draft'));

// What a plugin needs from THIS workspace before its buttons can appear.
function needsOf(plugin) {
  const needs = [];
  for (const a of plugin.manifest.actions) {
    if (!getCollection(a.on)) needs.push('a collection called "' + a.on + '"');
    if (a.creates && !getCollection(a.creates.collection)) needs.push('a collection called "' + a.creates.collection + '"');
  }
  return [...new Set(needs)];
}

const labelOf = id => { const c = getCollection(id); return (c && (c.label || c.id)) || id; };
const usesMe = (action, files) => {
  const sources = [...Object.values(action.reads), ...action.inputs.map(i => i.default).filter(Boolean), ...action.compute.flatMap(s => (s.value ? [s.value] : [s.each, ...Object.values(s.as)])), ...(action.creates ? Object.values(action.creates.fields) : [])];
  try {
    if (sources.some(src => rootsOf(src).includes('me'))) return true;
    return [action.template, action.creates && action.creates.body].filter(Boolean).some(f => files[f] !== undefined && templateRoots(files[f]).includes('me'));
  } catch { return false; }
};

// The plain-words account of one action. It is derived from the manifest by this code — never
// from anything the plugin, or the model that wrote it, says about itself.
function accountOf(action, files) {
  const reads = ['the ' + labelOf(action.on) + ' record you press it on'];
  for (const src of Object.values(action.reads)) {
    const parts = src.split('.');
    reads.push(parts.length === 2 && parts[0] === 'record' ? 'the ' + parts[1] + ' it links to' : parts.length === 2 ? 'the ' + parts[1] + ' that ' + parts[0] + ' links to' : 'the record at ' + src);
  }
  if (usesMe(action, files)) reads.push('your details in me.md (name, business, address…)');
  if (action.inputs.some(i => String(i.default || '').includes('next_number')) || Object.values(action.creates ? action.creates.fields : {}).some(f => f.includes('next_number'))) reads.push('the names already used in ' + labelOf(action.creates ? action.creates.collection : action.on) + ', to pick the next number');
  const writes = action.creates ? ['one new record in ' + labelOf(action.creates.collection) + ' (' + Object.keys(action.creates.fields).join(', ') + ')'] : [];
  return { reads, writes };
}

function describe(plugin) {
  const needs = needsOf(plugin);
  return {
    id: plugin.id, name: plugin.manifest.name, version: plugin.manifest.version, description: plugin.manifest.description,
    author: plugin.manifest.author, source: plugin.source, readme: plugin.readme,
    problems: plugin.problems, needs, ready: !plugin.problems.length && !needs.length,
    files: ['plugin.md', ...Object.keys(plugin.files)].map(name => ({ name, size: name === 'plugin.md' ? null : plugin.files[name].length })),
    request: plugin.source === 'draft' ? str(plugin.meta.request, 2000) : undefined,
    drafted_by: plugin.source === 'draft' ? str(plugin.meta.drafted_by, 60) : undefined,
    actions: plugin.manifest.actions.map(a => ({
      id: a.id, on: a.on, on_label: labelOf(a.on), label: a.label,
      inputs: a.inputs.map(i => ({ key: i.key, label: i.label, type: i.type, help: i.help })),
      creates: a.creates ? { collection: a.creates.collection, label: labelOf(a.creates.collection) } : null,
      ...accountOf(a, plugin.files),
    })),
  };
}

export function listPlugins() { return installed().map(describe); }
export function listDrafts() { return drafts().map(describe); }
export function getPlugin(id) {
  const p = installed().find(x => x.id === id) || drafts().find(x => x.id === id);
  if (!p) throw new PluginError('No plugin called "' + id + '".', 404);
  return { ...describe(p), templates: p.files };
}

// The buttons a collection's records get: every ready plugin's actions for that collection.
export function actionsFor(collectionId) {
  const out = [];
  for (const p of installed()) {
    if (p.problems.length || needsOf(p).length) continue;
    for (const a of p.manifest.actions) if (a.on === collectionId) out.push({ plugin: p.id, plugin_name: p.manifest.name, action: a.id, label: a.label, creates: a.creates ? labelOf(a.creates.collection) : null });
  }
  return out;
}

// ── running an action ────────────────────────────────────────────────────────────────────────
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// The app's own functions a formula may call. They read; none writes.
const host = {
  // next_number('invoices', 'INV-2026-', 3) → 'INV-2026-026': one past the highest name in that
  // collection that is the prefix followed by digits.
  next_number(collection, prefix = '', width = 3) {
    const found = documentsFor(String(collection || ''));
    const p = String(prefix || '');
    let max = 0;
    for (const d of found ? found.documents : []) {
      const title = String(d.title || '');
      if (!title.startsWith(p)) continue;
      const rest = title.slice(p.length);
      if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
    }
    return p + String(max + 1).padStart(Math.max(1, Math.min(12, Number(width) || 3)), '0');
  },
};

function find(pluginId, actionId, { allowDraft = false } = {}) {
  const plugin = installed().find(p => p.id === pluginId) || (allowDraft ? drafts().find(p => p.id === pluginId) : null);
  if (!plugin) throw new PluginError('No plugin called "' + pluginId + '".', 404);
  if (plugin.problems.length) throw new PluginError('The plugin "' + plugin.manifest.name + '" cannot run: ' + plugin.problems[0], 409);
  const action = plugin.manifest.actions.find(a => a.id === actionId);
  if (!action) throw new PluginError('"' + plugin.manifest.name + '" has no action called "' + actionId + '".', 404);
  return { plugin, action };
}

function scopeFor(action, relPath) {
  const found = documentsFor(action.on);
  if (!found) throw new PluginError('This workspace has no "' + action.on + '" collection.', 409);
  const doc = found.documents.find(d => d.path === String(relPath || ''));
  if (!doc) throw new PluginError('That record is not in ' + labelOf(action.on) + '.', 404);
  const scope = { record: { ...doc.fields, slug: doc.slug, title: doc.title, path: doc.path }, me: { ...readMe().data }, today: todayIso(), input: {} };
  // A relation holds a slug; `reads` follows it, the same way a rollup does (first slug wins).
  const bySlug = new Map();
  for (const d of allDocuments()) if (!bySlug.has(d.slug)) bySlug.set(d.slug, d);
  const follow = slug => { const d = bySlug.get(String(slug)); return d ? { ...d.data, slug: d.slug, title: d.data.name || d.data.title || d.slug, path: d.path } : null; };
  for (const [name, src] of Object.entries(action.reads)) {
    const v = evalExpr(src, scope, host);
    scope[name] = Array.isArray(v) ? v.map(follow).filter(Boolean) : (v ? follow(v) : null);
  }
  return { scope, doc };
}

// The form, with each field's starting value worked out for this record.
export function prepareAction(pluginId, actionId, relPath, opts) {
  const { plugin, action } = find(pluginId, actionId, opts);
  const { scope, doc } = scopeFor(action, relPath);
  return {
    plugin: plugin.id, plugin_name: plugin.manifest.name, action: action.id, label: action.label,
    record: { path: doc.path, title: doc.title },
    creates: action.creates ? { collection: action.creates.collection, label: labelOf(action.creates.collection) } : null,
    inputs: action.inputs.map(i => {
      let value = '';
      if (i.default) { try { const v = evalExpr(i.default, scope, host); value = v === null || v === undefined ? '' : v; } catch { value = ''; } }
      return { key: i.key, label: i.label, type: i.type, help: i.help, value };
    }),
  };
}

// Only the inputs the manifest declares, each made into what its type says it is.
function readInput(action, raw) {
  const given = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const i of action.inputs) {
    const v = given[i.key];
    if (v === undefined || v === null || v === '') { out[i.key] = null; continue; }
    if (i.type === 'number') {
      const n = Number(v);
      if (Number.isNaN(n)) throw new PluginError(i.label + ' must be a number.');
      out[i.key] = n;
    } else if (i.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new PluginError(i.label + ' must be a date.');
      out[i.key] = String(v);
    } else out[i.key] = String(v).slice(0, i.type === 'longtext' ? 5000 : 500);
  }
  return out;
}

function work(pluginId, actionId, relPath, input, opts) {
  const { plugin, action } = find(pluginId, actionId, opts);
  const { scope, doc } = scopeFor(action, relPath);
  scope.input = readInput(action, input);
  for (const step of action.compute) {
    if (step.each) {
      const list = evalExpr(step.each, scope, host);
      scope[step.key] = (Array.isArray(list) ? list : []).slice(0, 5000).map((item, i) => {
        const row = {};
        for (const [k, src] of Object.entries(step.as)) row[k] = evalExpr(src, { ...scope, item, index: i + 1 }, host);
        return row;
      });
    } else scope[step.key] = evalExpr(step.value, scope, host);
  }
  const html = pageOf(renderTemplate(plugin.files[action.template], scope, { escape: true, host }), action.label + ' · ' + doc.title);

  let record = null;
  const problems = [];
  if (action.creates) {
    const target = getCollection(action.creates.collection);
    if (!target) throw new PluginError('This workspace has no "' + action.creates.collection + '" collection to put the result in.', 409);
    const fields = {};
    for (const [k, src] of Object.entries(action.creates.fields)) {
      const v = evalExpr(src, scope, host);
      if (v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v))) fields[k] = v;
    }
    const body = action.creates.body ? renderTemplate(plugin.files[action.creates.body], scope, { escape: false, host }).trim() : '';
    const title = String(fields.name ?? fields.title ?? '').trim();
    if (!title) problems.push('The new record would have no name.');
    // A plugin makes a NEW record. The record writer would treat a second record with the same
    // name as an update to the first; here that is refused, in words, before anything is written.
    else if ((documentsFor(target.id).documents || []).some(d => String(d.title).trim().toLowerCase() === title.toLowerCase())) {
      problems.push('"' + title + '" already exists in ' + labelOf(target.id) + '. Change the number or the name.');
    } else {
      // …and one whose name is close enough that the writer would MERGE it into another record.
      let near = [];
      try { near = nearMatches({ ...fields }, { collection: target.id }); } catch { /* no candidates */ }
      if (near.length && near[0].confidence >= MERGE_CONFIDENCE) problems.push('"' + title + '" is too close to an existing record in ' + labelOf(target.id) + ' (' + (near[0].title || near[0].id || near[0].path) + ') and would be merged into it. Change the name.');
    }
    record = { collection: target.id, label: labelOf(target.id), title, fields, body };
  }
  return { plugin, action, doc, html, record, problems };
}

export function previewAction(pluginId, actionId, relPath, input, opts) {
  const { html, record, problems } = work(pluginId, actionId, relPath, input, opts);
  return { html, creates: record, problems };
}

const assertPerson = (actor, what) => {
  if (currentWorkerIdentity() || isAgentActor(actor)) throw new PluginError('Only a person can ' + what + '. An assistant proposes it.', 403);
};

// `via` and `stamp` are for an automation that runs the action on a person's behalf
// (backend/automations.mjs): `via` is prefixed so the log names the rule, and `stamp` adds the
// rule's id to the new record. The actor is still a person — the one who approved the card, or the
// one who switched the rule on.
export function runAction(pluginId, actionId, relPath, input, { actor = DEFAULT_ACTOR, via: viaPrefix = '', stamp = null } = {}) {
  assertPerson(actor, 'run a plugin');
  const { plugin, action, html, record, problems } = work(pluginId, actionId, relPath, input);
  if (!record) return { html, record: null };
  if (problems.length) throw new PluginError(problems[0], 409);
  const via = (viaPrefix ? viaPrefix + '+' : '') + 'plugin:' + plugin.id + '/' + action.id;
  const out = upsertRecord({ collection: record.collection, ...record.fields, ...(stamp || {}), ...(record.body ? { body: record.body } : {}) }, { actor, via });
  return { html, record: { collection: record.collection, label: record.label, title: record.title, path: out.path, id: out.id, verdict: out.verdict } };
}

// What plugins have written, read back from the one log every mutation lands in.
export function pluginHistory({ limit = 30 } = {}) {
  const out = [];
  for (const ev of readEvents({ type: ['store', 'update', 'merge'], limit: 4000 })) {
    const via = ev.detail && typeof ev.detail.via === 'string' ? ev.detail.via : '';
    const at = via.indexOf('plugin:');
    if (at < 0) continue;
    const [plugin, action] = via.slice(at + 7).split('/');
    // `automation:<rule>+plugin:…` when a rule pressed the button.
    const automation = via.startsWith('automation:') ? via.slice(11, at - 1) : null;
    out.push({ ts: ev.ts, actor: ev.actor, plugin, action: action || null, target: ev.target, type: ev.type, automation });
    if (out.length >= limit) break;
  }
  return out;
}

// ── making one ───────────────────────────────────────────────────────────────────────────────
function writeFolder(dir, manifest, extra, readme, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const tmp = path.join(dir, name + '.' + process.pid + '.tmp');
    fs.writeFileSync(tmp, String(content));
    fs.renameSync(tmp, path.join(dir, name));
  }
  // The manifest is written back as the CHECKED manifest: what is on disk is exactly what runs.
  const actions = manifest.actions.map(a => ({
    id: a.id, on: a.on, label: a.label, template: a.template,
    ...(a.inputs.length ? { inputs: a.inputs.map(i => ({ key: i.key, label: i.label, type: i.type, ...(i.help ? { help: i.help } : {}), ...(i.default ? { default: i.default } : {}) })) } : {}),
    ...(Object.keys(a.reads).length ? { reads: a.reads } : {}),
    ...(a.compute.length ? { compute: a.compute } : {}),
    ...(a.creates ? { creates: { collection: a.creates.collection, fields: a.creates.fields, ...(a.creates.body ? { body: a.creates.body } : {}) } } : {}),
  }));
  writeMd(path.join(dir, 'plugin.md'), { id: manifest.id, name: manifest.name, version: manifest.version, kind: 'template', description: manifest.description, ...(manifest.author ? { author: manifest.author } : {}), ...extra, actions }, readme ? readme + '\n' : '');
}

const takenIds = () => new Set([...installed(), ...drafts()].map(p => p.id));
function freeId(wanted) {
  const taken = takenIds();
  const base = ID.test(wanted) ? wanted : 'plugin';
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.has(base.slice(0, 36) + '-' + n)) return base.slice(0, 36) + '-' + n;
  throw new PluginError('Too many plugins share the id "' + base + '".', 409);
}

// Is there a model to ask? Never a guess: the same ladder `think` walks.
export async function aiStatus() {
  if (process.env.SCOUT_TEST === '1') return { available: !!process.env.SCOUT_BRAIN_COMMAND, providers: process.env.SCOUT_BRAIN_COMMAND ? ['stub'] : [] };
  try { const list = await pickProviders('light', { settings: getSettings() }); return { available: list.length > 0, providers: list.map(p => p.id) }; }
  catch { return { available: false, providers: [] }; }
}

function promptFor(description, previous) {
  const collections = listCollections().slice(0, 14).map(c => '- ' + c.id + ' ("' + (c.label || c.id) + '"): '
    + (c.fields || []).slice(0, 30).map(f => f.key + ':' + f.type + (f.type === 'relation' ? '→' + f.target : '')).join(', ')).join('\n');
  const example = installed().find(p => p.id === 'invoice');
  const exampleJson = example ? JSON.stringify({ id: 'invoice', name: example.manifest.name, description: example.manifest.description, actions: example.meta.actions, files: example.files }) : '';
  return [
    'You write a PLUGIN for a local records app. A plugin adds a button to the records of one collection. Pressing it shows a small form, then a document made from a template, and may create ONE new record.',
    'A plugin contains NO code. It is a manifest of formulas plus an HTML template. Answer with ONE JSON object and nothing else:',
    '{ "id": "lowercase-dashes", "name": "...", "description": "one sentence", "actions": [ { "id": "...", "on": "<collection id>", "label": "<button text>", "template": "<file>.html",',
    '  "inputs": [ { "key": "...", "label": "...", "type": "text|number|date|longtext", "default": "<formula>" } ],',
    '  "reads": { "<name>": "record.<relation field>" },',
    '  "compute": [ { "key": "...", "value": "<formula>" }, { "key": "...", "each": "<formula giving a list>", "as": { "<k>": "<formula using item>" } } ],',
    '  "creates": { "collection": "<collection id>", "fields": { "name": "<formula>", "...": "<formula>" }, "body": "<file>.md" } } ],',
    '  "files": { "<file>.html": "...", "<file>.md": "..." } }',
    '',
    'FORMULAS: numbers, \'text\', + - * / ( ), == != > < >= <=, dotted names, and ONLY these functions: ' + FUNCTION_NAMES.join(', ') + '.',
    'Names available: record (the record the button is on: its fields, plus slug, title, path), input (the form), me (the owner: name, business, address, email, phone, tax_id, payment), today, every key under reads, every earlier compute key. Inside sum(list, …) and each/as: item.',
    'sum(list, item.a * item.b) · add_days(date, n) · next_number(\'collection\', \'PREFIX-\', 3) · if(test, a, b) · default(a, b) · concat(a, b, …) · money(x) · date(x).',
    'TEMPLATE (.html): the inside of a page only — no <html>, <head>, <body>, <script>, <link>, <form>, no on… attributes, no web addresses, no src/href except data:image. One <style> block is fine; use system fonts. Tags: {{ formula }} (always escaped), {{#each list}}…{{ item.x }}…{{/each}}, {{#if formula}}…{{else}}…{{/if}}.',
    'The .md body template uses the same tags and is optional. "creates" is optional: leave it out for a plugin that only shows a document. A created record needs a "name" field.',
    'Use ONLY collections and fields that exist below. Money and dates must be formatted with money() and date() in the template.',
    '',
    'THE WORKSPACE\'S COLLECTIONS',
    collections || '(none yet)',
    '',
    exampleJson ? 'A COMPLETE, WORKING EXAMPLE\n' + exampleJson + '\n' : '',
    'THE REQUEST\n' + description,
    previous ? '\nYour previous answer could not be used. Fix exactly these problems and answer with the corrected JSON:\n- ' + previous.join('\n- ') : '',
  ].join('\n');
}

function fromReply(reply) {
  const parsed = parseJsonBlock(reply);
  if (!parsed) return { problems: ['the answer was not JSON'] };
  const files = {};
  for (const [name, content] of Object.entries(parsed.files && typeof parsed.files === 'object' ? parsed.files : {}).slice(0, 8)) {
    if (FILE.test(name) && typeof content === 'string' && content.length <= MAX_FILE) files[name] = content;
  }
  const checked = checkManifest({ id: parsed.id, name: parsed.name, description: parsed.description, version: '0.1.0', actions: parsed.actions }, files);
  return { ...checked, files };
}

// "Create a plugin": a person describes it, a model writes the folder, and it lands as a DRAFT.
// Nothing is active until the person has read what it does and approved it.
export async function draftPlugin({ description, actor = DEFAULT_ACTOR } = {}) {
  assertPerson(actor, 'create a plugin');
  const request = str(description, 2000);
  if (request.length < 12) throw new PluginError('Describe what the plugin should make, in a sentence or two.');
  let problems = null, provider = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await think({ purpose: 'plugin', prompt: promptFor(request, problems), timeoutMs: 180_000 });
    if (!res.ok) throw new PluginError('No model is available to write this plugin (' + (res.reason || 'no provider') + '). Connect one in Settings, or start from a copy of an existing plugin.', 503, { code: 'no-model' });
    provider = res.provider;
    const made = fromReply(res.text);
    if (!made.problems.length) {
      const id = freeId(made.manifest.id);
      const dir = path.join(draftsDir(), id);
      writeFolder(dir, { ...made.manifest, id }, { status: 'draft', drafted_by: provider, drafted_at: new Date().toISOString(), request }, '', made.files);
      logEvent({ type: 'propose', actor: provider || 'conductor', target: 'plugins/_drafts/' + id + '/plugin.md', detail: { plugin: id, requested_by: actor } });
      return describe(readFolder(dir, 'draft'));
    }
    problems = made.problems;
  }
  throw new PluginError('The model wrote a plugin that cannot be used: ' + problems.slice(0, 3).join('; ') + '. Try describing it differently.', 422, { problems });
}

// The way to make one without a model: copy an installed plugin into drafts and edit its files.
export function copyPlugin({ from, name, actor = DEFAULT_ACTOR } = {}) {
  assertPerson(actor, 'create a plugin');
  const source = installed().find(p => p.id === from);
  if (!source) throw new PluginError('No plugin called "' + from + '" to copy.', 404);
  const label = str(name, 60) || source.manifest.name + ' copy';
  const id = freeId(label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || source.id + '-copy');
  const dir = path.join(draftsDir(), id);
  writeFolder(dir, { ...source.manifest, id, name: label, version: '0.1.0', author: '' }, { status: 'draft', copied_from: source.id, drafted_at: new Date().toISOString() }, source.readme, source.files);
  logEvent({ type: 'propose', actor, target: 'plugins/_drafts/' + id + '/plugin.md', detail: { plugin: id, copied_from: source.id } });
  return describe(readFolder(dir, 'draft'));
}

export function approveDraft(id, { actor = DEFAULT_ACTOR } = {}) {
  assertPerson(actor, 'approve a plugin');
  const draft = drafts().find(p => p.id === id);
  if (!draft) throw new PluginError('No draft called "' + id + '".', 404);
  if (draft.problems.length) throw new PluginError('This draft cannot be approved yet: ' + draft.problems[0], 422, { problems: draft.problems });
  const target = path.join(pluginsDir(), id);
  if (fs.existsSync(target) || installed().some(p => p.id === id)) throw new PluginError('A plugin called "' + id + '" is already installed.', 409);
  fs.renameSync(draft.dir, target);
  const { status, ...kept } = draft.meta; void status;
  writeFolder(target, draft.manifest, { ...Object.fromEntries(Object.entries(kept).filter(([k]) => ['drafted_by', 'drafted_at', 'request', 'copied_from'].includes(k))), approved_by: actor, approved_at: new Date().toISOString() }, draft.readme, {});
  logEvent({ type: 'accept', actor, target: 'plugins/' + id + '/plugin.md', detail: { plugin: id } });
  return describe(readFolder(target, 'workspace'));
}

// Discarding a draft or removing a workspace plugin moves the folder aside. Nothing is deleted.
function setAside(dir, id, actor, reason) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const to = path.join(archiveDir(), id + '-' + stamp);
  fs.mkdirSync(archiveDir(), { recursive: true });
  fs.renameSync(dir, to);
  logEvent({ type: 'archive', actor, target: 'plugins/_archive/' + path.basename(to) + '/plugin.md', detail: { plugin: id, reason } });
  return { archived: 'plugins/_archive/' + path.basename(to) };
}
export function discardDraft(id, { actor = DEFAULT_ACTOR } = {}) {
  assertPerson(actor, 'discard a draft');
  const draft = drafts().find(p => p.id === id);
  if (!draft) throw new PluginError('No draft called "' + id + '".', 404);
  return setAside(draft.dir, id, actor, 'draft discarded');
}
export function removePlugin(id, { actor = DEFAULT_ACTOR, reason = '' } = {}) {
  assertPerson(actor, 'remove a plugin');
  const plugin = installed().find(p => p.id === id && p.source === 'workspace');
  if (!plugin) throw new PluginError(installed().some(p => p.id === id) ? 'Built-in plugins cannot be removed.' : 'No plugin called "' + id + '".', installed().some(p => p.id === id) ? 409 : 404);
  if (!str(reason, 300)) throw new PluginError('Say why it is being removed.', 400);
  return setAside(plugin.dir, id, actor, str(reason, 300));
}

export { parseExpr, parseTemplate };
