// The Index — the capability list an agent reads. M4 / T14 step 2.
// Contract: docs/08_MODULE_CONTRACTS.md §9, docs/04_AGENT_CONTRACT.md §8.
//
//   "Adding a capability is a new Index line, never an edit to the router skill."
//
// So there is exactly one table below, INDEX_CAPABILITIES, and adding a line to it is the whole
// procedure. `skills/scout-router/` never changes.
//
// The Index is also allowed to be WRONG in only one direction: it may omit something that exists,
// it may never advertise something that does not. An agent following a stale line does not get a
// warning, it gets a 404 in the middle of a job — this repo has already paid for that lesson once
// (docs/decisions.md, `CORE_API_ROUTES advertised 17 dead routes`). So every line names the route
// it depends on, and renderIndex() drops any line whose route is not actually registered.
//
// NOTE: `renderIndex` also exists in backend/agentHome.mjs and is a DIFFERENT thing — that one
// renders the `<scout-index>` block written into a local CLI session home (skill packs, locks,
// mounted tools) for door 1. This one is the HTTP capability list served at GET /api/index, which
// every door reads. They are not two implementations of one concept; agentHome's is about a
// session, this is about the app.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStorageRoot, listProjects, getSettings } from './store.mjs';
import { listCollections, FIELD_TYPE_NAMES } from './collections.mjs';
import { selfApiBase, enabledTools } from './agentHome.mjs';
import { listUserTools } from './userTools.mjs';

const BACKEND_DIR = path.dirname(fileURLToPath(import.meta.url));

// The pointer, not the prose. The agent already has the router skill; the Index tells it which file
// in that skill holds the routes rather than restating them and drifting from them.
export const ROUTE_REFERENCE = 'skills/scout-router/references/api-mode.md';

// ── the capability table ───────────────────────────────────────────────────────────────────────
// ONE LINE PER CAPABILITY. `route` is what keeps it honest; `what` is written for the agent, in the
// second person, and says what the capability is FOR rather than what it returns.
export const INDEX_CAPABILITIES = [
  { route: 'GET /api/conductor', what: 'inspect the continuing goal team, specialist assignments, draft outputs and next human decision (owner surface).' },
  { route: 'POST /api/widgets/propose', what: 'suggest a catalog Today widget with evidence; the operator approves it in Needs you.' },
  { route: 'POST /api/deliveries/preview', what: 'propose exact output for a configured destination; approval and execution remain human actions.' },
  { route: 'GET /api/workers', what: 'inspect skill matches, worker leases and durable wake receipts (owner surface).' },
  { route: 'GET /api/paperclip', what: 'inspect optional Paperclip delegation receipts; local Markdown remains canonical.' },
  { route: 'GET /api/context', what: 'wake up — identity, goals, territory, what changed. One read, under 2000 tokens.' },
  { route: 'GET /api/cache/version', what: 'cheap check: unchanged since your last run means your cached context is still good.' },
  { route: 'GET /api/index', what: 'this list.' },
  { route: 'GET /api/collections', what: 'every collection and its schema, plus the legal field types.' },
  { route: 'GET /api/collections/:id/documents', what: 'the documents in a collection; ?view= applies a saved view.' },
  { route: 'GET /api/search', what: 'find records. Never list data/ in bulk.' },
  { route: 'GET /api/document', what: 'one document by its path in the store.' },
  { route: 'POST /api/records/match', what: 'dry run — would this be a duplicate? Writes nothing.' },
  { route: 'POST /api/records/upsert', what: 'submit one finding; read the verdict store · update · merge · skip. A store raises the DECIDE card for you — do not post a finding card as well.' },
  { route: 'POST /api/records/batch', what: '20-50 findings in one call. Use this when sweeping.' },
  { route: 'POST /api/records/move', what: 'move a record. Only as far as shortlist — further is 403.' },
  { route: 'GET /api/scout/board/:id/describe', what: 'the project whiteboard in words: the records on it, the relations between them, the texts and shapes, and every arrow a person drew as "A → B: label".' },
  { route: 'GET /api/automations', what: 'the rules a person set: when a record is created or a field becomes a value, file one new record. Read them before doing by hand what a rule already does. POST proposes one — it arrives switched off; only a person turns it on.' },
  { route: 'GET /api/territory', what: 'where you may work, with hit rates and how stale each one is.' },
  { route: 'PATCH /api/territory/:id', what: 'facts you may write yourself: last_swept, access, rules, posted[].' },
  { route: 'GET /api/playbook/:id', what: 'one playbook body — only the ones the context named.' },
  { route: 'GET /api/proposals', what: 'the DECIDE queue: what you asked for and what they decided, with the reason.' },
  { route: 'POST /api/proposals', what: 'propose anything: finding · outbound · territory · learning · schema · question.' },
  { route: 'POST /api/collections/propose', what: 'propose a collection. Carry evidence, not an opinion.' },
  { route: 'POST /api/fields/propose', what: 'propose a field. `why` is mandatory and is shown to them.' },
  { route: 'POST /api/outbound/propose', what: 'propose a message or post — the exact wording, verbatim.' },
  { route: 'POST /api/learnings/propose', what: 'propose a learning: { claim, evidence[], scope }.' },
  { route: 'POST /api/goals', what: 'create a goal: { label, target, by, count }. Human-owned — you get 403; propose it as a question card instead.' },
  { route: 'POST /api/territory/propose', what: 'propose a group you want to join — `why` is mandatory. It writes nothing to territory/: it makes a DECIDE card, and accepting it means you may ASK to join.' },
  { route: 'PUT /api/views/:collection', what: 'save a view. Allowed without approval — views are cheap and reversible.' },
  { route: 'GET /api/assistants', what: 'you and your colleagues, and who reports to whom.' },
  { route: 'GET /api/tasks', what: 'the work queue. ?project= and ?status=open.' },
  { route: 'POST /api/tasks/:id/claim', what: 'claim a task. 409 means someone beat you — take another.' },
  { route: 'PATCH /api/tasks/:id', what: 'set status done, or blocked with needs_human: true and a plain-language question in body — that pulls the task into DECIDE as a card.' },
  { route: 'POST /api/runs', what: 'record what you did, so they can see it without asking.' },
  { route: 'GET /api/activity', what: 'the event log, newest first.' },
];

// ── what is actually registered ────────────────────────────────────────────────────────────────

function fromApp(app) {
  const stack = (app && (app._router?.stack || app.router?.stack)) || [];
  const out = new Set();
  for (const layer of stack) {
    const p = layer.route && layer.route.path;
    if (!p) continue;
    for (const one of [].concat(p)) {
      for (const m of Object.keys(layer.route.methods || {})) out.add(m.toUpperCase() + ' ' + one);
    }
  }
  return out;
}

// No app in hand (a plain renderIndex() call, or a test): read the registrations out of the source.
// Same technique the existing CORE_API_ROUTES guard uses, and for the same reason — a reference is
// not code, so it has to be checked against code.
function fromSource() {
  const out = new Set();
  let files = [];
  try { files = fs.readdirSync(BACKEND_DIR).filter(f => f.endsWith('.mjs')); } catch { return out; }
  for (const f of files) {
    let src = '';
    try { src = fs.readFileSync(path.join(BACKEND_DIR, f), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      out.add(m[1].toUpperCase() + ' ' + m[2]);
    }
  }
  return out;
}

export function registeredRoutes(app = null) {
  const live = app ? fromApp(app) : new Set();
  return live.size ? live : fromSource();
}

// ── the facts ──────────────────────────────────────────────────────────────────────────────────

function currentProject(given) {
  if (given) return String(given);
  let s = {};
  try { s = getSettings() || {}; } catch { /* unreadable settings must not sink the Index */ }
  if (s.activeProject) return String(s.activeProject);
  let projects = [];
  try { projects = listProjects(); } catch { /* none */ }
  // One project is unambiguous. Two is a question, and the Index does not guess at a question.
  return projects.length === 1 ? projects[0].id : null;
}

function toolLines(project) {
  const out = [];
  try {
    for (const t of enabledTools(project)) out.push(t.id + ' — ' + (t.capability || t.name || ''));
  } catch { /* chat tools are door 1's, and door 1 is optional */ }
  try {
    for (const t of listUserTools()) out.push(t.id + ' — ' + (t.capability || t.name || ''));
  } catch { /* none */ }
  return out;
}

function collectionLines() {
  let cols = [];
  try { cols = listCollections(); } catch { return []; }
  return cols.map(c => {
    const fields = (c.fields || []).map(f => {
      const marks = [f.type, f.primary ? 'primary' : null, f.gate ? 'gate' : null].filter(Boolean).join(',');
      return f.key + '(' + marks + ')';
    });
    return '#' + c.id + ' — ' + (fields.length ? fields.join(' · ') : '(no fields)');
  });
}

export function indexFacts({ apiBase = null, project = null, app = null } = {}) {
  const registered = registeredRoutes(app);
  const pid = currentProject(project);
  return {
    api: apiBase || selfApiBase(),
    root: getStorageRoot(),
    project: pid,
    reference: ROUTE_REFERENCE,
    fieldTypes: FIELD_TYPE_NAMES,
    collections: collectionLines(),
    tools: toolLines(pid),
    // The honesty filter. A capability whose route is not registered is absent, never promised.
    capabilities: INDEX_CAPABILITIES.filter(c => registered.has(c.route)),
    withheld: INDEX_CAPABILITIES.filter(c => !registered.has(c.route)).map(c => c.route),
  };
}

// ── render ─────────────────────────────────────────────────────────────────────────────────────

export function renderIndex(opts = {}) {
  const f = indexFacts(opts);
  const L = [];
  L.push('<scout-index>');
  L.push('api: ' + f.api);
  L.push('workspace: ' + f.root);
  L.push('project: ' + (f.project || 'none'));
  L.push('routes: ' + f.reference);
  L.push('');
  L.push('## Collections');
  L.push(...(f.collections.length ? f.collections : ['(none yet — propose one)']));
  L.push('');
  L.push('## Field types you may propose against');
  L.push(f.fieldTypes.join(' · '));
  L.push('');
  L.push('## Capabilities');
  L.push(...(f.capabilities.length ? f.capabilities.map(c => c.route + ' — ' + c.what) : ['(none)']));
  L.push('');
  L.push('## Tools');
  L.push(...(f.tools.length ? f.tools : ['(none enabled)']));
  L.push('</scout-index>');
  return L.join('\n');
}

// ── routes ─────────────────────────────────────────────────────────────────────────────────────

export function registerIndexRoutes(app, deps = {}) {
  app.get('/api/index', (req, res) => {
    // The live app is the truest answer to "which routes exist", so pass it: the source scan is the
    // fallback for callers who only have the module.
    const opts = { app, project: req.query.project || deps.project || null, apiBase: deps.apiBase || null };
    if (req.query.format === 'text') {
      res.type('text/plain').send(renderIndex(opts));
      return;
    }
    res.json({ text: renderIndex(opts), ...indexFacts(opts) });
  });
}
