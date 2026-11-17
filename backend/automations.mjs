// backend/automations.mjs — "when this happens to a record, do that".
//
// A rule a person can read in one sentence: "When a Deal's stage becomes won → Create invoice
// (ask me first)". One file per rule, `automations/<slug>.md`: the frontmatter is the rule and the
// body is a plain-language note, so an agent can read every rule and the rules travel with the
// workspace.
//
//   name, enabled, mode: ask | auto
//   when: { on: record_created | field_becomes, collection, field?, value? }
//   do:   { run: plugin, plugin, action }
//       | { run: create_record, collection, fields: { key: "text with {{name}} or {{field}}" } }
//
// WHAT FIRES A RULE. The one writer of records tells this module after every write what the record
// said before and what it says now (records.mjs `onRecordWrite`). So "a field BECAME a value" is
// decided from the write itself — never by comparing snapshots — and a change made in the app
// fires straight away. A file edited by hand on disk passes through no writer and fires nothing.
//
// WHAT A RULE MAY DO. Only make ONE NEW record through `records.upsertRecord`: by pressing a plugin
// button that files one, or from a small template. Nothing here sends, deletes or changes an
// existing record, and nothing here spawns an assistant.
//
//   ask   (the default) the firing raises a card in Needs you; approving the card runs it once.
//   auto  runs at once. The record is written in the name of the person who switched the rule on.
//         A change made BY AN ASSISTANT never runs an automation by itself: it asks.
//
// SAFETY, each enforced here and tested in tests/automations.test.mjs:
//   · one (rule, record, trigger value) fires once, kept as a receipt on disk;
//   · a record an automation made does not fire automations (no loops);
//   · only a person creates an enabled rule, edits, enables or archives one — an agent's rule lands
//     switched off, as a proposal;
//   · every firing, approval, decline and failure is in the event log;
//   · a rule that names something missing is reported as broken, with the reason;
//   · a rule file is never deleted: it is switched off or archived.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getStorageRoot, readMd, writeMd } from './store.mjs';
import { getCollection, listCollections, primaryField, FIELD_TYPES } from './collections.mjs';
import { onRecordWrite, upsertRecord, nearMatches, MERGE_CONFIDENCE } from './records.mjs';
import { documentAt } from './documents.mjs';
import { isAgentActor, DEFAULT_ACTOR } from './actors.mjs';
import { currentWorkerIdentity, outsideWorkerIdentity } from './workerScope.mjs';
import { logEvent } from './log.mjs';
import { propose } from './proposals.mjs';
import { listPlugins, prepareAction, runAction } from './plugins.mjs';

export class AutomationError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.name = 'AutomationError'; this.status = status; Object.assign(this, extra); }
}

export const automationsDir = () => path.join(getStorageRoot(), 'automations');
const ruleFile = id => path.join(automationsDir(), id + '.md');
const receiptsFile = id => path.join(getStorageRoot(), '.scout', 'automations', id + '.json');
const relOf = id => 'automations/' + id + '.md';

const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const MODES = ['ask', 'auto'];
export const TRIGGERS = ['record_created', 'field_becomes'];
export const ACTIONS = ['plugin', 'create_record'];
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const slugOf = s => str(s, 80).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const nowIso = () => new Date().toISOString();

const assertPerson = (actor, what) => {
  if (currentWorkerIdentity() || isAgentActor(actor)) throw new AutomationError('Only a person can ' + what + '. An assistant may propose an automation; it arrives switched off.', 403);
};

// ── words ────────────────────────────────────────────────────────────────────────────────────
const labelOf = id => { const c = getCollection(id); return (c && (c.label || c.id)) || id; };
// "Deals" → "Deal", "Companies" → "Company", "People" → "Person". Only for the sentence.
export function singular(label) {
  const s = String(label || '');
  if (/^people$/i.test(s)) return s[0] === 'P' ? 'Person' : 'person';
  if (/ies$/i.test(s)) return s.slice(0, -3) + 'y';
  if (/(ch|sh|x|ss)es$/i.test(s)) return s.slice(0, -2);
  if (/s$/i.test(s) && !/ss$/i.test(s)) return s.slice(0, -1);
  return s;
}
const article = word => (/^[aeiou]/i.test(word) ? 'an ' : 'a ') + word;
const fieldOf = (collectionId, key) => { const c = getCollection(collectionId); return c ? (c.fields || []).find(f => f.key === key) || null : null; };
const fieldLabel = (collectionId, key) => { const f = fieldOf(collectionId, key); return ((f && f.label) || String(key || '').replace(/_/g, ' ')).toLowerCase(); };
const optionValues = f => (Array.isArray(f && f.options) ? f.options.map(o => String(typeof o === 'string' ? o : o && o.value)) : null);

// ── the rule: what is allowed, said once ─────────────────────────────────────────────────────
// → { rule, problems }. `rule` holds only the keys named here.
export function checkRule(raw, id = '') {
  const d = raw && typeof raw === 'object' ? raw : {};
  const problems = [];
  const when = d.when && typeof d.when === 'object' ? d.when : {};
  const act = d.do && typeof d.do === 'object' ? d.do : {};
  const rule = {
    id: str(id || d.id, 60),
    name: str(d.name, 120),
    enabled: d.enabled === true,
    mode: MODES.includes(d.mode) ? d.mode : 'ask',
    when: { on: str(when.on, 40), collection: str(when.collection, 60) },
    do: { run: str(act.run, 40) },
  };
  if (!rule.name) problems.push('it has no name');
  if (d.mode !== undefined && !MODES.includes(d.mode)) problems.push('mode "' + d.mode + '" is not one of ask · auto');
  if (!TRIGGERS.includes(rule.when.on)) problems.push('"when" must be one of: a record is created · a field becomes a value');
  if (!rule.when.collection) problems.push('"when" does not say which collection');
  if (rule.when.on === 'field_becomes') {
    rule.when.field = str(when.field, 60);
    rule.when.value = when.value === undefined || when.value === null ? '' : str(when.value, 200);
    if (!rule.when.field) problems.push('"when" does not say which field');
    if (rule.when.value === '') problems.push('"when" does not say which value the field becomes');
  }
  if (rule.do.run === 'plugin') {
    rule.do.plugin = str(act.plugin, 60); rule.do.action = str(act.action, 60);
    if (!rule.do.plugin || !rule.do.action) problems.push('"do" does not say which plugin button to press');
  } else if (rule.do.run === 'create_record') {
    rule.do.collection = str(act.collection, 60);
    rule.do.fields = {};
    for (const [k, v] of Object.entries(act.fields && typeof act.fields === 'object' && !Array.isArray(act.fields) ? act.fields : {}).slice(0, 30)) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) { problems.push('"' + k + '" is not a usable field name'); continue; }
      if (v === null || v === undefined || typeof v === 'object') { problems.push('the value for "' + k + '" must be text, a number or yes/no'); continue; }
      rule.do.fields[k] = typeof v === 'string' ? v.slice(0, 500) : v;
    }
    if (!rule.do.collection) problems.push('"do" does not say which collection the new record goes in');
    if (!Object.keys(rule.do.fields).length) problems.push('"do" gives the new record no fields');
  } else {
    // Anything else — sending, deleting, changing a record, sending an assistant out — is not
    // something an automation does in this version, in either mode.
    problems.push('"do" must be one of: press a plugin button · create a record. ' + (rule.do.run ? '"' + rule.do.run + '" is not something an automation can do.' : ''));
  }
  // Carried, never trusted for behaviour beyond what is read here.
  rule.proposed = d.proposed === true;
  rule.proposed_by = str(d.proposed_by, 80) || null;
  rule.archived = d.archived === true;
  rule.archive_reason = str(d.archive_reason, 300) || null;
  rule.created = str(d.created, 40) || null;
  rule.created_by = str(d.created_by, 80) || null;
  rule.enabled_by = str(d.enabled_by, 80) || null;
  return { rule, problems };
}

const TEMPLATE_NAMES = ['name', 'title', 'slug', 'path', 'today'];
const tokensIn = text => [...String(text).matchAll(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g)].map(m => m[1]);

// What is wrong with a rule IN THIS WORKSPACE: the things it names that are not there. A rule with
// any of these is shown as broken and does not fire; it is never skipped without saying why.
export function brokenReasons(rule) {
  const out = [];
  const source = getCollection(rule.when.collection);
  if (rule.when.collection && !source) out.push('there is no collection called "' + rule.when.collection + '"');
  if (source && rule.when.on === 'field_becomes' && rule.when.field) {
    const f = (source.fields || []).find(x => x.key === rule.when.field);
    if (!f) out.push(labelOf(source.id) + ' has no field called "' + rule.when.field + '"');
    else if (FIELD_TYPES[f.type] && FIELD_TYPES[f.type].derived) out.push('"' + rule.when.field + '" is worked out from other records, so nothing ever writes it and it cannot fire a rule');
    else {
      const options = optionValues(f);
      if (options && options.length && !options.includes(String(rule.when.value))) out.push('"' + rule.when.field + '" has no option called "' + rule.when.value + '" (it has ' + options.join(' · ') + ')');
    }
  }
  if (rule.do.run === 'plugin' && rule.do.plugin) {
    const plugin = listPlugins().find(p => p.id === rule.do.plugin);
    const action = plugin && plugin.actions.find(a => a.id === rule.do.action);
    if (!plugin) out.push('there is no plugin called "' + rule.do.plugin + '"');
    else if (plugin.problems.length) out.push('the ' + plugin.name + ' plugin cannot be used: ' + plugin.problems[0]);
    else if (!action) out.push('the ' + plugin.name + ' plugin has no button called "' + rule.do.action + '"');
    else {
      if (plugin.needs.length) out.push('the ' + plugin.name + ' plugin needs ' + plugin.needs.join(' and '));
      if (action.on !== rule.when.collection) out.push('"' + action.label + '" is a button on ' + action.on_label + ', not on ' + labelOf(rule.when.collection));
      // The line `auto` may never cross, and `ask` has no use for: an action that files nothing.
      if (!action.creates) out.push('"' + action.label + '" only shows a document and files no record, so there is nothing for an automation to do');
    }
  }
  if (rule.do.run === 'create_record' && rule.do.collection) {
    const target = getCollection(rule.do.collection);
    if (!target) out.push('there is no collection called "' + rule.do.collection + '" to put the new record in');
    else {
      const prim = primaryField(target);
      const nameKey = prim ? prim.key : 'name';
      if (!String(rule.do.fields[nameKey] ?? rule.do.fields.name ?? '').trim()) out.push('the new ' + singular(labelOf(target.id)) + ' would have no ' + nameKey);
      for (const [k, v] of Object.entries(rule.do.fields)) {
        const f = (target.fields || []).find(x => x.key === k);
        if (f && FIELD_TYPES[f.type] && FIELD_TYPES[f.type].derived) out.push('"' + k + '" in ' + labelOf(target.id) + ' is worked out, not written');
        if (source) for (const t of tokensIn(v)) {
          if (!TEMPLATE_NAMES.includes(t) && !(source.fields || []).some(x => x.key === t)) out.push('{{' + t + '}} is not something ' + article(singular(labelOf(source.id))) + ' has');
        }
      }
    }
  }
  return [...new Set(out)];
}

// The rule as a sentence. Three parts so a screen can set the middle one in bold.
export function sentenceOf(rule) {
  const one = singular(labelOf(rule.when.collection || 'record'));
  const when = rule.when.on === 'field_becomes'
    ? 'When ' + article(one) + '’s ' + fieldLabel(rule.when.collection, rule.when.field) + ' becomes ' + String(rule.when.value).replace(/-/g, ' ')
    : 'When ' + article(one) + ' is created';
  let then = '';
  if (rule.do.run === 'plugin') {
    const plugin = listPlugins().find(p => p.id === rule.do.plugin);
    const action = plugin && plugin.actions.find(a => a.id === rule.do.action);
    then = action ? action.label + ' (' + plugin.name + ' plugin)' : 'press "' + rule.do.action + '" of the ' + rule.do.plugin + ' plugin';
  } else if (rule.do.run === 'create_record') {
    const target = getCollection(rule.do.collection);
    const prim = target && primaryField(target);
    const name = rule.do.fields ? (rule.do.fields[prim ? prim.key : 'name'] ?? rule.do.fields.name ?? '') : '';
    then = 'create ' + article(singular(labelOf(rule.do.collection))) + (name ? ' called “' + String(name).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => '[' + (k === 'name' || k === 'title' ? 'its name' : k.replace(/_/g, ' ')) + ']') + '”' : '');
  }
  return { when, then, mode: rule.mode === 'auto' ? 'do it' : 'ask me first' };
}

// ── receipts: what has fired, and what came of it ────────────────────────────────────────────
function readReceipts(id) {
  try { const v = JSON.parse(fs.readFileSync(receiptsFile(id), 'utf8')); return v && typeof v === 'object' ? v : {}; }
  catch { return {}; }
}
function writeReceipts(id, receipts) {
  const file = receiptsFile(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(receipts, null, 1));
  fs.renameSync(tmp, file);
}
const receiptKey = (id, recordPath, trigger) => crypto.createHash('sha256').update([id, recordPath, trigger.kind, trigger.value].join('\n')).digest('hex').slice(0, 24);
function stamp(id, key, patch) {
  const all = readReceipts(id);
  all[key] = { ...(all[key] || {}), ...patch };
  writeReceipts(id, all);
  return all[key];
}

const note = (rule, phase, detail) => logEvent({ type: 'run', actor: 'automation:' + rule.id, target: relOf(rule.id), detail: { phase: 'automation-' + phase, automation: rule.id, ...detail } });

// ── reading rules ────────────────────────────────────────────────────────────────────────────
function readRule(id) {
  let md;
  try { md = readMd(ruleFile(id)); } catch { return null; }
  const { rule, problems } = checkRule(md.data || {}, id);
  return { ...rule, note: String(md.content || '').trim(), shape_problems: problems };
}
function ruleIds() {
  try { return fs.readdirSync(automationsDir()).filter(f => f.endsWith('.md') && !f.startsWith('.') && ID.test(f.slice(0, -3))).map(f => f.slice(0, -3)).sort(); }
  catch { return []; }
}
const problemsOf = rule => [...rule.shape_problems, ...(rule.shape_problems.length ? [] : brokenReasons(rule))];

function describe(rule) {
  const problems = problemsOf(rule);
  const runs = Object.entries(readReceipts(rule.id)).map(([key, r]) => ({ key, ...r })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    id: rule.id, path: relOf(rule.id), name: rule.name, enabled: rule.enabled && !rule.archived, mode: rule.mode,
    when: rule.when, do: rule.do, note: rule.note, sentence: rule.shape_problems.length ? null : sentenceOf(rule),
    problems, broken: problems.length > 0,
    proposed: rule.proposed, proposed_by: rule.proposed_by, archived: rule.archived, archive_reason: rule.archive_reason,
    created_by: rule.created_by, enabled_by: rule.enabled_by,
    runs: runs.slice(0, 5), run_count: runs.length,
  };
}

export function listAutomations({ archived = false } = {}) {
  return ruleIds().map(readRule).filter(Boolean).filter(r => archived || !r.archived).map(describe)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
}
export function getAutomation(id) {
  const rule = ID.test(String(id)) ? readRule(String(id)) : null;
  if (!rule) throw new AutomationError('No automation called "' + id + '".', 404);
  return describe(rule);
}

// The automations that press each button of one plugin — shown on the Plugins screen.
export function automationsUsing(pluginId) {
  const out = {};
  for (const a of listAutomations()) {
    if (a.do.run !== 'plugin' || a.do.plugin !== pluginId) continue;
    (out[a.do.action] = out[a.do.action] || []).push({ id: a.id, name: a.name, enabled: a.enabled, broken: a.broken, sentence: a.sentence });
  }
  return out;
}

// What the sentence builder may offer: this workspace's collections and fields, and the plugin
// buttons that file a record.
export function builderOptions() {
  const collections = listCollections().map(c => ({
    id: c.id, label: c.label || c.id, singular: singular(c.label || c.id),
    name_key: (primaryField(c) || { key: 'name' }).key,
    fields: (c.fields || []).filter(f => !(FIELD_TYPES[f.type] && FIELD_TYPES[f.type].derived) && !f.primary && !['json', 'file'].includes(f.type))
      .map(f => ({ key: f.key, label: f.label || f.key.replace(/_/g, ' '), type: f.type, target: f.target || null, many: !!f.many, options: optionValues(f) })),
  }));
  const buttons = [];
  for (const p of listPlugins()) {
    if (!p.ready) continue;
    for (const a of p.actions) if (a.creates) buttons.push({ plugin: p.id, plugin_name: p.name, action: a.id, label: a.label, on: a.on, creates: a.creates.label });
  }
  return { collections, buttons };
}

// ── writing rules ────────────────────────────────────────────────────────────────────────────
function writeRule(rule, body) {
  const data = {
    name: rule.name, enabled: rule.enabled, mode: rule.mode, when: rule.when, do: rule.do,
    ...(rule.proposed ? { proposed: true, proposed_by: rule.proposed_by } : {}),
    ...(rule.archived ? { archived: true, archive_reason: rule.archive_reason } : {}),
    created: rule.created, created_by: rule.created_by,
    ...(rule.enabled_by ? { enabled_by: rule.enabled_by } : {}),
    updated: nowIso(),
  };
  writeMd(ruleFile(rule.id), data, body ? String(body).trim() + '\n' : '');
}
function refuseShape(problems) {
  if (problems.length) throw new AutomationError('This automation cannot be saved: ' + problems[0] + '.', 400, { problems });
}

// A person's rule is saved as they built it. An assistant's lands switched off, marked as a
// proposal, and stays that way until a person switches it on.
export function createAutomation(input = {}, { actor = DEFAULT_ACTOR } = {}) {
  const agent = !!currentWorkerIdentity() || isAgentActor(actor);
  const { rule, problems } = checkRule(input);
  refuseShape(problems);
  let id = slugOf(input.id || rule.name) || 'automation';
  for (let n = 2; fs.existsSync(ruleFile(id)); n++) id = (slugOf(input.id || rule.name) || 'automation').slice(0, 56) + '-' + n;
  const next = {
    ...rule, id,
    enabled: agent ? false : input.enabled !== false,
    proposed: agent, proposed_by: agent ? actor : null,
    archived: false, archive_reason: null,
    created: nowIso(), created_by: actor, enabled_by: agent ? null : actor,
  };
  const broken = brokenReasons(next);
  // A person cannot switch on something that cannot run; it is saved switched off and says why.
  if (broken.length) next.enabled = false;
  writeRule(next, input.note);
  logEvent({ type: agent ? 'propose' : 'schema', actor, target: relOf(id), detail: { automation: id, change: 'created', enabled: next.enabled, mode: next.mode } });
  return getAutomation(id);
}

export function updateAutomation(id, patch = {}, { actor = DEFAULT_ACTOR } = {}) {
  assertPerson(actor, 'change an automation');
  const current = ID.test(String(id)) ? readRule(String(id)) : null;
  if (!current) throw new AutomationError('No automation called "' + id + '".', 404);
  if (current.archived) throw new AutomationError('This automation is archived.', 409);
  const merged = {
    name: patch.name !== undefined ? patch.name : current.name,
    mode: patch.mode !== undefined ? patch.mode : current.mode,
    when: patch.when !== undefined ? patch.when : current.when,
    do: patch.do !== undefined ? patch.do : current.do,
    enabled: patch.enabled !== undefined ? patch.enabled === true : current.enabled,
  };
  const { rule, problems } = checkRule(merged, current.id);
  refuseShape(problems);
  const broken = brokenReasons(rule);
  if (rule.enabled && broken.length) throw new AutomationError('This automation cannot be switched on: ' + broken[0] + '.', 409, { problems: broken });
  const switchedOn = rule.enabled && !current.enabled;
  const next = {
    ...rule, id: current.id,
    // Switching it on is the person's approval of a proposed rule, and makes them its owner.
    proposed: rule.enabled ? false : current.proposed, proposed_by: current.proposed_by,
    archived: false, archive_reason: null,
    created: current.created, created_by: current.created_by,
    enabled_by: switchedOn ? actor : current.enabled_by,
  };
  writeRule(next, patch.note !== undefined ? patch.note : current.note);
  const changed = ['name', 'mode', 'when', 'do', 'enabled', 'note'].filter(k => patch[k] !== undefined);
  logEvent({ type: 'schema', actor, target: relOf(current.id), detail: { automation: current.id, change: 'updated', changed, enabled: next.enabled, mode: next.mode } });
  return getAutomation(current.id);
}

// Never deleted. An archived rule stays on disk, switched off, with the reason.
export function archiveAutomation(id, { reason = '', actor = DEFAULT_ACTOR } = {}) {
  assertPerson(actor, 'archive an automation');
  const current = ID.test(String(id)) ? readRule(String(id)) : null;
  if (!current) throw new AutomationError('No automation called "' + id + '".', 404);
  if (!str(reason, 300)) throw new AutomationError('Say why it is being archived.', 400);
  writeRule({ ...current, enabled: false, archived: true, archive_reason: str(reason, 300) }, current.note);
  logEvent({ type: 'archive', actor, target: relOf(current.id), detail: { automation: current.id, reason: str(reason, 300) } });
  return getAutomation(current.id);
}

// ── doing the thing ──────────────────────────────────────────────────────────────────────────
function titleOfRecord(doc, collectionId) {
  const c = getCollection(collectionId);
  const prim = c && primaryField(c);
  return String((prim && doc.data[prim.key]) || doc.data.name || doc.data.title || doc.slug);
}
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// `{{name}}` is the triggering record's name, `{{field}}` any of its fields. A value that is
// exactly one `{{field}}` keeps that field's own type (a list stays a list); anything else is text.
function fill(template, scope) {
  if (typeof template !== 'string') return template;
  const whole = /^\s*\{\{\s*([a-zA-Z_][\w]*)\s*\}\}\s*$/.exec(template);
  if (whole) return scope[whole[1]] ?? null;
  return template.replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (_, k) => { const v = scope[k]; return v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v); });
}
function typed(value, field) {
  if (value === null || value === undefined || value === '') return undefined;
  if (!field) return value;
  if (field.type === 'number') { const n = Number(value); return Number.isNaN(n) ? undefined : n; }
  if (field.type === 'checkbox') return value === true || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'yes';
  if (field.type === 'multiselect' || (field.type === 'relation' && field.many)) return Array.isArray(value) ? value.map(String) : [String(value)];
  return Array.isArray(value) ? value.map(String).join(', ') : typeof value === 'object' ? undefined : value;
}

// Runs a rule's action once for one record. → what it made. Throws with a sentence when it cannot.
function perform(rule, recordPath, { actor }) {
  const broken = problemsOf(rule);
  if (broken.length) throw new AutomationError('This automation cannot run: ' + broken[0] + '.', 409);
  const via = 'automation:' + rule.id;
  if (rule.do.run === 'plugin') {
    const form = prepareAction(rule.do.plugin, rule.do.action, recordPath);
    const input = Object.fromEntries(form.inputs.map(i => [i.key, i.value]));
    const out = runAction(rule.do.plugin, rule.do.action, recordPath, input, { actor, via, stamp: { automation: rule.id } });
    if (!out.record) throw new AutomationError('The plugin filed no record.', 409);
    return { path: out.record.path, title: out.record.title, collection: out.record.collection, label: out.record.label };
  }
  const doc = documentAt(recordPath);
  if (!doc) throw new AutomationError('The record this fired for is no longer there.', 409);
  const target = getCollection(rule.do.collection);
  const scope = { ...doc.data, name: titleOfRecord(doc, rule.when.collection), title: titleOfRecord(doc, rule.when.collection), slug: doc.slug, path: doc.path, today: todayIso() };
  const fields = {};
  for (const [k, template] of Object.entries(rule.do.fields)) {
    const v = typed(fill(template, scope), (target.fields || []).find(f => f.key === k));
    if (v !== undefined) fields[k] = v;
  }
  const prim = primaryField(target);
  const title = String(fields[prim ? prim.key : 'name'] ?? fields.name ?? '').trim();
  if (!title) throw new AutomationError('The new record would have no name.', 409);
  // An automation only ever makes a NEW record. The writer would fold a close-enough name into an
  // existing record, which would be changing one — so that is refused here, before any write.
  const near = nearMatches({ ...fields }, { collection: target.id });
  if (near.length && near[0].confidence >= MERGE_CONFIDENCE) {
    throw new AutomationError('"' + title + '" is too close to an existing record in ' + labelOf(target.id) + ' (' + (near[0].title || near[0].id) + '), so it was not created.', 409);
  }
  const out = upsertRecord({ collection: target.id, ...fields, automation: rule.id }, { actor, via });
  if (out.verdict !== 'store') throw new AutomationError('The record was ' + out.verdict + 'd into ' + out.path + ' instead of created.', 409);
  return { path: out.path, title, collection: target.id, label: labelOf(target.id) };
}

// ── reacting to a write ──────────────────────────────────────────────────────────────────────
const held = data => !!data && (data.proposed === true || data.quarantined === true || data.archived === true || !!data.archived_at);
const has = (value, wanted) => (Array.isArray(value) ? value.map(String).includes(String(wanted)) : value !== undefined && value !== null && String(value) === String(wanted));

function triggerOf(rule, ev) {
  if (rule.when.on === 'record_created') {
    // New, or newly real: a record an assistant proposed counts as created when a person accepts it.
    return ev.before === null || (held(ev.before) && !held(ev.after)) ? { kind: 'created', value: '' } : null;
  }
  // BECOMES: it was something else before this write. A new record that already holds the value
  // did not become it, and a re-save that leaves it as it was is not a change.
  if (ev.before === null) return null;
  return !has(ev.before[rule.when.field], rule.when.value) && has(ev.after[rule.when.field], rule.when.value)
    ? { kind: 'becomes:' + rule.when.field, value: String(rule.when.value) } : null;
}

function cardWords(rule, doc, trigger) {
  const title = titleOfRecord(doc, rule.when.collection);
  const s = sentenceOf(rule);
  const happened = trigger.kind === 'created'
    ? title + ' was added to ' + labelOf(rule.when.collection) + '.'
    : title + ': ' + fieldLabel(rule.when.collection, rule.when.field) + ' became ' + String(rule.when.value).replace(/-/g, ' ') + '.';
  const ask = rule.do.run === 'plugin' ? s.then.replace(/ \(.*\)$/, '') + '?' : s.then.charAt(0).toUpperCase() + s.then.slice(1) + '?';
  const makes = rule.do.run === 'plugin'
    ? 'Presses “' + s.then.replace(/ \(.*\)$/, '') + '” with its usual values and files one new record.'
    : 'Files one new record in ' + labelOf(rule.do.collection) + ', linked to this one where the rule says so.';
  return { title: happened + ' ' + ask, line: makes };
}

function react(ev) {
  // No loops: what an automation wrote never fires an automation.
  if (String(ev.via || '').startsWith('automation:')) return;
  if (!ev.collection || !ev.after || held(ev.after)) return;
  for (const id of ruleIds()) {
    const rule = readRule(id);
    if (!rule || !rule.enabled || rule.archived || rule.when.collection !== ev.collection) continue;
    const trigger = triggerOf(rule, ev);
    if (!trigger) continue;
    const key = receiptKey(rule.id, ev.path, trigger);
    const base = { record: ev.path, trigger: trigger.kind, value: trigger.value };
    try {
      const broken = problemsOf(rule);
      if (broken.length) { note(rule, 'failed', { ...base, error: 'broken: ' + broken[0] }); continue; }
      const before = readReceipts(rule.id)[key];
      // Once per (rule, record, trigger value). A failure is the one outcome that may be retried.
      if (before && before.state !== 'failed') { note(rule, 'skipped', { ...base, reason: 'already fired for this record (' + before.state + ')' }); continue; }
      const doc = documentAt(ev.path);
      const title = doc ? titleOfRecord(doc, rule.when.collection) : ev.path;
      // A change an assistant made never runs anything by itself: it asks.
      const mode = rule.mode === 'auto' && !isAgentActor(ev.actor) ? 'auto' : 'ask';
      if (mode === 'ask') {
        const words = cardWords(rule, doc, trigger);
        const card = propose({
          id: 'automation-' + rule.id.slice(0, 30) + '-' + key.slice(0, 12), kind: 'automation',
          automation: rule.id, record: ev.path, receipt: key, title: words.title, line: words.line,
          why: 'Your automation “' + rule.name + '” fired. Yes runs it once for this record. No records that you declined; it will not ask again for this record.',
          evidence: ['[[' + ev.path.replace(/\.md$/, '') + ']]', '[[' + relOf(rule.id).replace(/\.md$/, '') + ']]'],
        }, { actor: 'automation:' + rule.id });
        stamp(rule.id, key, { at: nowIso(), ...base, title, mode: 'ask', state: 'asked', card: card.id, triggered_by: ev.actor });
        note(rule, 'asked', { ...base, card: card.id, triggered_by: ev.actor });
      } else {
        const actor = rule.enabled_by || DEFAULT_ACTOR;
        stamp(rule.id, key, { at: nowIso(), ...base, title, mode: 'auto', state: 'running', triggered_by: ev.actor });
        const made = perform(rule, ev.path, { actor });
        stamp(rule.id, key, { state: 'ran', made: made.path, made_title: made.title, made_in: made.label, by: actor });
        note(rule, 'ran', { ...base, mode: 'auto', made: made.path, by: actor });
      }
    } catch (e) {
      stamp(rule.id, key, { at: nowIso(), ...base, state: 'failed', error: e.message });
      note(rule, 'failed', { ...base, error: e.message });
    }
  }
}

// Writes are reacted to just after they finish, never inside them: a rule's own write must not
// run in the middle of the write that fired it (a batch is still holding its candidate list).
const queue = [];
let timer = null;
function drain() {
  timer = null;
  while (queue.length) {
    const ev = queue.shift();
    if (ev.root !== getStorageRoot()) continue;        // the workspace was switched meanwhile
    try { outsideWorkerIdentity(() => react(ev)); } catch { /* one bad event never stops the rest */ }
  }
}
onRecordWrite(ev => {
  queue.push({ ...ev, root: getStorageRoot() });
  if (!timer) { timer = setImmediate(drain); if (timer.unref) timer.unref(); }
});
// For tests and for a caller that needs the reactions to have happened before it reads.
export function flushAutomations() { if (timer) clearImmediate(timer); drain(); }

// ── the card's two answers (called from backend/proposals.mjs) ───────────────────────────────
export function runAutomationCard(card, { actor = DEFAULT_ACTOR } = {}) {
  assertPerson(actor, 'approve an automation');
  const rule = ID.test(String(card.automation)) ? readRule(String(card.automation)) : null;
  if (!rule || rule.archived) throw new AutomationError('The automation that asked this no longer exists.', 409);
  const base = { record: card.record, card: card.id };
  let made;
  try { made = perform(rule, card.record, { actor }); }
  catch (e) { note(rule, 'failed', { ...base, error: e.message, by: actor }); throw e; }
  if (card.receipt) stamp(rule.id, card.receipt, { state: 'ran', made: made.path, made_title: made.title, made_in: made.label, by: actor, decided_at: nowIso() });
  note(rule, 'ran', { ...base, mode: 'ask', made: made.path, by: actor });
  return { made };
}
export function automationDeclined(card, { actor = DEFAULT_ACTOR } = {}) {
  const rule = ID.test(String(card.automation)) ? readRule(String(card.automation)) : null;
  if (!rule) return null;
  if (card.receipt) stamp(rule.id, card.receipt, { state: 'declined', by: actor, decided_at: nowIso() });
  note(rule, 'declined', { record: card.record, card: card.id, by: actor });
  return { declined: true };
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────
//   GET   /api/automations[?archived=1]     → { automations, options }
//   POST  /api/automations                  { name, mode, when, do, note, actor }  a person's is saved; an assistant's lands switched off
//   PATCH /api/automations/:id              { name?, enabled?, mode?, when?, do?, note?, actor }   person only
//   POST  /api/automations/:id/archive      { reason, actor }                                      person only
// There is no DELETE.
export function registerAutomationRoutes(app) {
  const route = fn => (req, res) => {
    try { res.json(fn(req)); }
    catch (e) { res.status(e.status || 400).json({ error: e.message, ...(e.problems ? { problems: e.problems } : {}) }); }
  };
  const who = req => ({ actor: String((req.body && req.body.actor) || req.query.actor || DEFAULT_ACTOR) });
  app.get('/api/automations', route(req => ({ automations: listAutomations({ archived: req.query.archived === '1' }), options: builderOptions() })));
  app.post('/api/automations', route(req => {
    const { name, mode, when, do: act, note: body, enabled } = req.body || {};
    return createAutomation({ name, mode, when, do: act, note: body, enabled }, who(req));
  }));
  app.patch('/api/automations/:id', route(req => {
    const { name, mode, when, do: act, note: body, enabled } = req.body || {};
    return updateAutomation(req.params.id, { name, mode, when, do: act, note: body, enabled }, who(req));
  }));
  app.post('/api/automations/:id/archive', route(req => archiveAutomation(req.params.id, { reason: req.body && req.body.reason, ...who(req) })));
}
