// Door 3 — MCP over stdio.
//
// `docs/04_AGENT_CONTRACT.md` §1: three doors, ONE pipeline. HTTP is for agents Scout spawns
// locally, `_inbox/` is for anything with folder access, and this is for hosts that speak MCP.
// All three call the SAME `upsertRecord` — a second write path would bypass dedupe, provenance
// and the gate all at once, and nobody would notice for weeks.
//
// THREE THINGS THIS FILE REFUSES TO DO
//
//  1. **It does not hand-maintain a tool list.** The tool surface is GENERATED from
//     `INDEX_CAPABILITIES` in `backend/agentIndex.mjs`. T14 step 2: "a new capability is a new
//     Index line, never a router-skill edit" — the same logic applies to a tool list, because a
//     second hand-written list drifts from the first inside a week. Add a line there and the tool
//     appears here with no edit to this file.
//
//  2. **It does not re-implement a write verb.** Every binding below calls the exported function
//     the HTTP route calls, with the same arguments. `records.mjs` stays the only writer of
//     document files, so the gate (Law 4) applies to an MCP client exactly as it applies to curl —
//     not because this file checks anything, but because it cannot reach around the thing that does.
//
//  3. **It does not need the API to be running.** An MCP host launches this process standalone. It
//     talks to the modules directly; nothing here opens a socket or fetches a URL. The one
//     exception is the unbound-capability fallback at the bottom, which is honest about being one.
//
// TRANSPORT. Newline-delimited JSON-RPC 2.0 on stdin/stdout. **Anything written to stdout that is
// not a JSON-RPC frame corrupts the stream** — every log line goes to stderr. `handleMessage` is
// pure in the sense that matters: request object in, response object out, no process, no socket,
// so the protocol is testable without spawning anything.

import fs from 'node:fs';

import { INDEX_CAPABILITIES, renderIndex } from './agentIndex.mjs';
import { selfApiBase } from './agentHome.mjs';
import { getStorageRoot } from './store.mjs';
import { listCollections, FIELD_TYPE_NAMES } from './collections.mjs';
import { documentsFor, documentAt, collectionsOf, allDocuments, viewFor } from './documents.mjs';
import { getView, defaultView, saveView, applyView } from './views.mjs';
import { search as structuredSearch } from './search.mjs';
import {
  upsertRecord, batchUpsert, moveRecord, nearMatches, excludeQuarantined, resolveTarget } from './records.mjs';
import { readCache, cacheVersion, getPlaybook, saveLearning } from './memory.mjs';
import { listTerritories, saveTerritory, proposeTerritory } from './territory.mjs';
import { listProposals, propose } from './proposals.mjs';
import { listAssistants, listTasks, findTask, saveTask, claimTask, appendRun } from './tasks.mjs';
import { readEvents, EVENT_TYPES } from './log.mjs';

// ── identity ───────────────────────────────────────────────────────────────────────────────────

const PKG = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')); }
  catch { return {}; }
})();

export const SERVER_NAME = 'scout';
export const SERVER_VERSION = String(PKG.version || '0.0.0');

// Newest first. An `initialize` naming a version we know is echoed back; anything else is answered
// with our newest, which is what the spec asks a server to do rather than failing the handshake.
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];

// An MCP client is an AGENT (docs/04_AGENT_CONTRACT.md §6). The actor default has to be an agent id
// or Law 4 would be off by default on this door: `records.mjs isAgentActor()` treats an id it does
// not know as an agent, so `scout-mcp` is refused past `shortlist` exactly as `scout-fb` is.
// Read lazily, never at module load — a test (or a host) that sets the env after import still wins.
export function defaultActor() { return String(process.env.SCOUT_MCP_ACTOR || 'scout-mcp'); }

// Every write this door makes is stamped `via: 'mcp'` in the event log, so Activity can tell the
// three doors apart after the fact. It changes nothing about the record itself — that is the point.
export const VIA = 'mcp';

// ── errors ─────────────────────────────────────────────────────────────────────────────────────
// A refusal must reach the agent as THE SENTENCE IT WAS REFUSED WITH. `records.mjs` throws
// `RecordError('an agent may not promote past "shortlist"', 403)`; over HTTP that becomes a 403
// whose body carries the sentence, and here it becomes a JSON-RPC error whose `message` IS the
// sentence, with the status alongside in `data`. An agent handed only a number learns nothing.

export const JSONRPC_ERRORS = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  SERVER: -32000,      // application-level: a refusal, a 404, a validation message
};

export class McpError extends Error {
  constructor(message, code = JSONRPC_ERRORS.SERVER, data = null) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }
}

function invalid(message, data = null) { return new McpError(message, JSONRPC_ERRORS.INVALID_PARAMS, data); }

// ── argument helpers ───────────────────────────────────────────────────────────────────────────

function need(args, key, what) {
  const v = args[key];
  if (v === undefined || v === null || v === '') throw invalid(what || ('`' + key + '` is required'));
  return v;
}
function str(v, fallback = null) { return v === undefined || v === null ? fallback : String(v); }
function actorOf(args) { return str(args.actor, null) || defaultActor(); }

// frontend/api.js sends PATCHes as { patch, actor }; agents and curl send the fields flat. Both
// route handlers accept both shapes, so this door does too — a tool that only took one of them
// would be a fourth dialect nobody documented.
function patchOf(args, drop = []) {
  const { actor, patch, ...rest } = args;
  const out = patch && typeof patch === 'object' && !Array.isArray(patch) ? { ...patch } : rest;
  for (const k of drop) delete out[k];
  return out;
}


// JSON Schema shorthand. Every tool gets a real schema with its required fields named — an agent
// that has read nothing else has only these strings to go on.
const S = {
  obj: (properties = {}, required = [], extra = {}) => ({
    type: 'object', properties, required, additionalProperties: false, ...extra,
  }),
  open: (properties = {}, required = [], extra = {}) => ({
    type: 'object', properties, required, additionalProperties: true, ...extra,
  }),
  s: description => ({ type: 'string', description }),
  n: description => ({ type: 'number', description }),
  b: description => ({ type: 'boolean', description }),
  arr: (items, description) => ({ type: 'array', items, description }),
};

const PROJECT = S.s('Project id. Omit for the active project — there is usually only one.');
const ACTOR = S.s('Who is acting. Defaults to the MCP agent id, which the gate treats as an agent: you may not promote a record past "shortlist".');

// ── the bindings ───────────────────────────────────────────────────────────────────────────────
// Keyed by the EXACT route string in INDEX_CAPABILITIES, because that string is the join between
// the capability table and this one. `run` returns a JSON-able value, or a string when `text: true`.

const BINDINGS = {

  // ── wake up ──
  'GET /api/context': {
    text: true,
    note: 'Call this FIRST, once, at the start of a session. It is under 2000 tokens and it is the whole briefing: who they are, the goals, the project, the territory you may work, playbook titles, learnings, what changed since your last run, open questions and counts. Do not read the store in bulk instead.',
    schema: S.obj({ project: PROJECT }),
    run: a => readCache({ project: str(a.project) }).text,
  },

  'GET /api/cache/version': {
    note: 'One integer plus its stamp. Unchanged since your last run means the context you cached is still good and you can skip re-reading it.',
    schema: S.obj({ project: PROJECT }),
    run: a => cacheVersion({ project: str(a.project) }),
  },

  'GET /api/index': {
    text: true,
    note: 'The capability list: workspace root, the collections and their fields, the legal field types you may propose against, the enabled tools, the active project.',
    schema: S.obj({ project: PROJECT }),
    run: a => renderIndex({ project: str(a.project) }),
  },

  // ── read ──
  'GET /api/collections': {
    note: 'Every collection and its schema, plus the complete list of legal field types. A field type outside that list is refused, so read it before proposing a field.',
    schema: S.obj({}),
    run: () => ({ collections: listCollections(), fieldTypes: FIELD_TYPE_NAMES }),
  },

  'GET /api/collections/:id/documents': {
    note: 'The rows of one collection. `view` applies a saved view (its filter, sort, grouping and visible fields). Records written straight into data/ without passing the pipeline are QUARANTINED: they are listed separately and excluded from the count, never hidden.',
    schema: S.obj({
      id: S.s('Collection id, e.g. "guest". List them with scout_get_collections.'),
      view: S.s('Saved view id. Omit for the collection default.'),
      bind: S.open({}, [], { description: 'Subtable binding, e.g. {"guest":"maria-santos"}.' }),
    }, ['id']),
    run: async a => {
      const id = String(need(a, 'id'));
      // The SAME composition the HTTP door uses (documents.mjs viewFor) — not a second assembly
      // of documentsFor + the view + the quarantine split.
      const out = await viewFor(id, { view: str(a.view) || null, bind: a.bind || null });
      if (!out) throw new McpError('no collection "' + id + '"', JSONRPC_ERRORS.SERVER, { status: 404 });
      return out;
    },
  },

  'GET /api/search': {
    note: 'Find records by free text and typed filters. This is how you look something up — never list the store in bulk.',
    schema: S.obj({
      q: S.s('The query. Free text, plus typed filters where the collection has them.'),
      cursor: S.n('Offset for the next page. Omit for the first page.'),
    }, ['q']),
    run: a => structuredSearch(String(need(a, 'q')), { cursor: Number(a.cursor) || 0 }),
  },

  'GET /api/document': {
    note: 'One document by its path in the store — the same path string every verdict and every row prints.',
    schema: S.obj({ path: S.s('Store-relative path, e.g. "data/guests/maria-santos.md".') }, ['path']),
    run: a => {
      const doc = documentAt(String(need(a, 'path')));
      if (!doc) throw new McpError('no document at that path', JSONRPC_ERRORS.SERVER, { status: 404 });
      return { ...doc, collections: collectionsOf(doc) };
    },
  },

  // ── write ──
  'POST /api/records/match': {
    note: 'Dry run. Would this finding be a duplicate? Writes nothing, logs nothing. Use it when you are unsure; use upsert when you are not, because upsert already dedupes.',
    schema: S.open({
      collection: S.s('Collection id the candidate belongs to.'),
      name: S.s('The candidate name.'),
      handle: S.s('Their handle, if you have one — the strongest dedupe signal there is.'),
      source: S.s('The URL you actually saw.'),
    }, ['collection']),
    run: a => ({ matches: nearMatches(a, { collection: need(a, 'collection') }) }),
  },

  'POST /api/records/upsert': {
    note: [
      'Submit ONE finding. Read the verdict: "store" means new, "update" means merged into an existing record, "merge" means two records were the same person and were combined, "skip" means already known and nothing new — do not try again.',
      'Required on every finding beyond `collection` and the name: `found_in` (the territory it came from — territory scores are computed from it, and omitting it means the app cannot learn), `source` (the URL you actually saw), and `score` with a one-line `why` tied to the doctrine.',
      'Any other field the collection declares can be passed alongside. What you write lands as `proposed`, in the first stage — you may not set a stage past "shortlist".',
    ].join(' '),
    schema: S.open({
      collection: S.s('Collection id, e.g. "guest".'),
      name: S.s('The primary field — usually the person or thing being recorded.'),
      found_in: S.s('The territory id this came from. Omit it and territory scoring cannot learn.'),
      source: S.s('The URL you actually saw. Not a search page — the thing itself.'),
      score: S.n('Your rating, on the collection scale.'),
      why: S.s('One line, tied to the doctrine, saying why this scores what it scores.'),
      body: S.s('Markdown body — the notes that go under the frontmatter.'),
      actor: ACTOR,
    }, ['collection']),
    run: a => {
      const { actor, ...input } = a;
      return upsertRecord(input, { actor: actorOf(a), via: VIA });
    },
  },

  'POST /api/records/batch': {
    note: 'Twenty to fifty findings in one call — use this when sweeping, not fifty separate upserts. One near-match pass covers the whole batch, so a batch containing the same person twice dedupes against itself. One bad item never costs the other forty-nine: it comes back as "refused" with its reason and the rest go through.',
    schema: S.obj({
      items: S.arr(S.open({ collection: S.s('Collection id.') }, ['collection']), 'The findings. Same shape as scout_post_records_upsert, one object each.'),
      actor: ACTOR,
    }, ['items']),
    run: a => {
      const items = a.items || a.records;
      if (!Array.isArray(items)) throw invalid('`items` must be an array of findings');
      return batchUpsert(items, { actor: actorOf(a), via: VIA });
    },
  },

  'POST /api/records/move': {
    note: 'Move a record along its gate field. As an agent you may move it only as far as "shortlist" — anything further is refused, and the attempt is written into Activity where they will see it. Reaching "archived" this way is refused too: archiving takes a reason and has its own door.',
    schema: S.obj({
      id: S.s('The record slug, as returned by an upsert verdict.'),
      path: S.s('Or its store-relative path. Either one.'),
      to: S.s('The stage to move it to.'),
      reason: S.s('Only for archiving, which this door does not do.'),
      actor: ACTOR,
    }, ['to']),
    run: a => moveRecord(resolveTarget(a.path || a.id), {
      to: need(a, 'to'), actor: actorOf(a), reason: str(a.reason),
    }),
  },

  // ── territory ──
  'GET /api/territory': {
    note: 'Where you may work: every territory with its access state, hit rate, and how stale it is. Sweep the stalest thing with the best hit rate first.',
    schema: S.obj({}),
    run: () => ({ territory: listTerritories() }),
  },

  'PATCH /api/territory/:id': {
    note: 'The facts about a territory you may write yourself: `last_swept`, `access`, `access_changed`, `rules`, `posted`. Never `finds`, `wins` or `hit_rate` — those are computed from records, and a value you set by hand is stripped and reported back to you in `stripped`.',
    schema: S.open({
      id: S.s('Territory id.'),
      last_swept: S.s('ISO date you last swept it.'),
      access: S.s('Your access state: e.g. member, requested, rejected, banned.'),
      rules: S.s('What the group actually allows — in their words.'),
      posted: S.arr({ type: 'object', additionalProperties: true }, 'Post history.'),
      actor: ACTOR,
    }, ['id']),
    run: a => {
      const id = String(need(a, 'id'));
      const saved = saveTerritory(id, patchOf(a, ['id']), { actor: actorOf(a) });
      return { ok: true, territory: saved, stripped: saved.stripped };
    },
  },

  'GET /api/playbook/:id': {
    note: 'One playbook body. Read only the ones your wake-up context named by title — the whole playbook does not fit in a context and was never meant to.',
    schema: S.obj({ id: S.s('Playbook claim id, from the context.') }, ['id']),
    run: a => {
      const id = String(need(a, 'id'));
      const p = getPlaybook(id);
      if (!p) throw new McpError('no playbook claim "' + id + '"', JSONRPC_ERRORS.SERVER, { status: 404 });
      return p;
    },
  },

  // ── propose ──
  'GET /api/proposals': {
    note: 'The DECIDE queue: what you asked for and what they decided, with the reason. Read the rejections — the reason is the only way you get better at asking.',
    schema: S.obj({
      status: S.s('open (the default), accepted, or rejected.'),
      kind: S.s('finding · outbound · territory · learning · schema · question.'),
      by: S.s('Only cards proposed by this actor.'),
    }),
    run: a => ({ proposals: listProposals({ status: str(a.status, 'open'), kind: str(a.kind), actor: str(a.by) }) }),
  },

  'POST /api/proposals': {
    note: 'Propose anything: a finding, an outbound message, a territory, a learning, a schema change, or a plain question. A proposal must carry EVIDENCE — "14 of your last 20 shortlists post video" — not an opinion. Pass a deterministic `id` if you re-propose the same thing every run, or the queue grows a copy per run and nobody works it.',
    schema: S.open({
      kind: S.s('One of: finding, outbound, territory, learning, schema, question.'),
      title: S.s('One line, what you are asking for.'),
      why: S.s('The evidence. Not an opinion.'),
      id: S.s('Optional deterministic id, so re-proposing is idempotent.'),
      actor: ACTOR,
    }, ['kind', 'why']),
    run: a => {
      const { actor, ...card } = a;
      return propose(card, { actor: actorOf(a) });
    },
  },

  'POST /api/collections/propose': {
    note: 'Propose a new collection — the person’s database is built by you, one approved proposal at a time. It lands as a card in DECIDE and does not exist until they accept it. `why` and a non-empty `evidence` are both enforced: a schema change is the one thing that alters what everyone sees forever, so it takes what you observed, not what you think.',
    schema: S.open({
      schema: S.open({ id: S.s('Collection id, lower-kebab.') }, ['id'], {
        description: 'The full collection: { id, label, query: { path or tag }, fields: [{ key, type, ... }] }. Field types must come from scout_get_collections.',
      }),
      why: S.s('One line the human decides on.'),
      evidence: S.arr({ type: 'string' }, 'Concrete instances that prompted this. Required, and it may not be empty.'),
      actor: ACTOR,
    }, ['schema', 'why', 'evidence']),
    run: a => propose({
      kind: 'schema', change: 'collection', schema: a.schema || a,
      title: 'New collection · ' + ((a.schema && a.schema.id) || a.id || ''),
      why: a.why, evidence: a.evidence,
    }, { actor: actorOf(a) }),
  },

  'POST /api/fields/propose': {
    note: 'Propose a new field on an existing collection. `why` is MANDATORY and is shown to them verbatim — adding a column changes what everyone sees forever. The type must be one of the legal field types; read them from scout_get_collections first. Never propose changing a live field’s type: propose a new field and a migration they confirm.',
    schema: S.open({
      collection: S.s('Collection id the field goes on.'),
      key: S.s('Field key, lower_snake or lower-kebab.'),
      type: S.s('One of the legal field types (scout_get_collections lists them).'),
      options: S.arr({ type: 'string' }, 'For select/status/multiselect types.'),
      why: S.s('Mandatory. Shown to the human as written.'),
      evidence: S.arr({ type: 'string' }, 'Mandatory and non-empty. What you OBSERVED — "14 of your last 20 shortlists post video" — not what you think.'),
      actor: ACTOR,
    }, ['collection', 'key', 'type', 'why', 'evidence']),
    run: a => propose({
      kind: 'schema', change: 'field', collection: need(a, 'collection'),
      field: a.field || { key: a.key, type: a.type, ...(a.options ? { options: a.options } : {}) },
      title: 'New field · #' + a.collection + ' → ' + (a.key || (a.field && a.field.key) || ''),
      why: a.why, evidence: a.evidence,
    }, { actor: actorOf(a) }),
  },

  'POST /api/outbound/propose': {
    note: 'Propose a message, DM, comment or post — the EXACT wording, verbatim, as it would be sent. You may never send anything to another human without this being accepted first.',
    schema: S.open({
      channel: S.s('Where it would be sent.'),
      territory: S.s('Which territory, if any.'),
      subject: S.s('Subject or first line.'),
      message: S.s('The exact wording. Not a summary of it.'),
      why: S.s('Why this person, why now.'),
      actor: ACTOR,
    }, ['message']),
    run: a => propose({
      kind: 'outbound', channel: a.channel, territory: a.territory, subject: a.subject,
      message: a.message || a.body,
      title: 'Send · ' + (a.subject || a.channel || ''),
      why: a.why || 'The agent wants to send this, exactly as written.',
    }, { actor: actorOf(a) }),
  },

  'POST /api/learnings/propose': {
    note: 'Propose one learning at the end of a session: { claim, evidence[], scope }. ONE question, not five — this is the only mechanism by which you get better, and a five-question interrogation at the end of a long day is how people stop answering.',
    schema: S.open({
      claim: S.s('The claim, in one sentence.'),
      evidence: S.arr({ type: 'string' }, 'What makes you believe it — paths, counts, instances.'),
      scope: S.s('project or global.'),
      actor: ACTOR,
    }, ['claim']),
    run: a => {
      const { actor, id: given, ...patch } = a;
      const id = String(given || a.claim || '').trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      if (!id) throw invalid('a learning needs a claim');
      return { ok: true, learning: saveLearning(id, { ...patch, status: 'proposed' }, { actor: actorOf(a) }) };
    },
  },

  'POST /api/territory/propose': {
    note: 'Propose a group you want to work. `why` is mandatory. NOTHING is written to territory/ — it becomes a DECIDE card; accepting it means you MAY ASK to join, not that you are in.',
    schema: S.open({
      id: S.s('Proposed territory id, lower-kebab.'),
      name: S.s('What the group is actually called.'),
      url: S.s('Where it is.'),
      why: S.s('The evidence that it is worth the time.'),
      actor: ACTOR,
    }, ['why']),
    // proposeTerritory is async since it makes a card through proposals.propose(); an un-awaited
    // call answered `{ territory: {} }` while the card was in fact created.
    run: async a => ({ ok: true, card: await proposeTerritory(a, { actor: actorOf(a) }) }),
  },

  'PUT /api/views/:collection': {
    note: 'Save a view on a collection — filter, sort, grouping, visible fields, type (table · board · list · gallery). ALLOWED WITHOUT APPROVAL: views are cheap and reversible, and it is announced in Activity. Fields and collections are not; those are proposals.',
    schema: S.obj({
      collection: S.s('Collection id.'),
      view: S.open({ id: S.s('lower-kebab-case view id.') }, ['id'], {
        description: 'The view: { id, type, filter[], sort[], group, fields[] }. Every field it names must exist on the collection.',
      }),
    }, ['collection', 'view']),
    run: a => ({ views: saveView(String(need(a, 'collection')), need(a, 'view')) }),
  },

  // ── coordination ──
  'GET /api/assistants': {
    note: 'You and your colleagues, their scope, and who reports to whom. Read it before you touch a collection or territory that is somebody else’s job.',
    schema: S.obj({}),
    run: () => ({ assistants: listAssistants() }),
  },

  'GET /api/tasks': {
    note: 'The work queue. Filter with `status: "open"` to find something to claim.',
    schema: S.obj({ project: PROJECT, status: S.s('open · claimed · done · blocked.') }),
    run: a => ({ tasks: listTasks({ project: str(a.project), status: str(a.status) }) }),
  },

  'POST /api/tasks/:id/claim': {
    note: 'Claim a task before working it. The result carries `won`. If `won` is false somebody beat you — back off and take another; do not work it anyway.',
    schema: S.obj({
      id: S.s('Task id.'),
      project: PROJECT,
      actor: ACTOR,
    }, ['id']),
    run: a => {
      const id = String(need(a, 'id'));
      const found = findTask(id, { project: str(a.project) });
      if (!found) throw new McpError('no task "' + id + '"', JSONRPC_ERRORS.SERVER, { status: 404 });
      return claimTask(found.project, found.id, { actor: actorOf(a) });
    },
  },

  'PATCH /api/tasks/:id': {
    note: 'Update a task you claimed: `status: "done"`, or `status: "blocked"` with `needs_human: true` and a plain-language question in `body`, which pulls it straight into the DECIDE queue. `assigned` and `claimed_at` are written by claiming only.',
    schema: S.open({
      id: S.s('Task id.'),
      project: PROJECT,
      status: S.s('open · claimed · done · blocked.'),
      needs_human: S.b('true pulls this task into the human’s DECIDE queue.'),
      body: S.s('The plain-language question, when you are blocked.'),
      actor: ACTOR,
    }, ['id']),
    run: a => {
      const id = String(need(a, 'id'));
      const found = findTask(id, { project: str(a.project) });
      if (!found) throw new McpError('no task "' + id + '"', JSONRPC_ERRORS.SERVER, { status: 404 });
      return saveTask(found.project, found.id, patchOf(a, ['id', 'project']), { actor: actorOf(a) });
    },
  },

  'POST /api/runs': {
    note: 'Record what you did — what you searched, what you found, what needs them — so they can see it without asking. End every session with this.',
    schema: S.open({
      assistant: S.s('Your agent id.'),
      status: S.s('running · done · failed · blocked.'),
      summary: S.s('Three lines: what you searched, what you found, what needs them.'),
      cost: S.n('What it cost, if you know.'),
    }, ['assistant']),
    run: a => appendRun(a),
  },

  'GET /api/activity': {
    note: 'The event log, newest first. Every mutation in the app lands here, including refusals — if a write of yours did not take, this is where the reason is.',
    schema: S.obj({
      limit: S.n('Up to 1000. Default 200.'),
      since: S.s('ISO timestamp; only events after it.'),
      type: S.s('One event type: ' + EVENT_TYPES.join(' · ')),
      target: S.s('Only events about this store path.'),
    }),
    run: a => ({
      events: readEvents({
        limit: Math.min(Number(a.limit) || 200, 1000),
        since: str(a.since), type: str(a.type), target: str(a.target),
      }),
      types: EVENT_TYPES,
    }),
  },
};

// ── generation ─────────────────────────────────────────────────────────────────────────────────
// The tool surface is a PROJECTION of the capability table. One line in `INDEX_CAPABILITIES` is one
// tool here, named mechanically from its route so the two can never drift apart or collide.

export function toolName(route) {
  const [method, p = ''] = String(route).trim().split(/\s+/);
  const segs = p.split('/').filter(Boolean).filter(s => s !== 'api' && !s.startsWith(':'));
  return ['scout', String(method).toLowerCase(), ...segs].join('_').replace(/[^A-Za-z0-9_-]/g, '_');
}

// A capability with no binding still becomes a tool — the alternative is a tool surface that
// silently omits something the Index promises, and finding that out mid-job is the exact failure
// docs/decisions.md already records for the route reference. It is honest about what it is: calling
// it says so and names the route to use instead.
function unboundRun(route) {
  return () => {
    throw new McpError(
      route + ' is in the Index but has no MCP binding yet. Call it over HTTP at '
      + selfApiBase() + ', or add a binding for it in backend/mcp.mjs.',
      JSONRPC_ERRORS.SERVER, { status: 501, route },
    );
  };
}

// ── the cache, on a door with no event loop to spare ───────────────────────────────────────────
//
// Law 7 is a CONTRACT, and `scout_get_cache_version` is the promise: an unchanged `v` means the
// context you cached is still good. `records.mjs` and the memory writers schedule the regeneration
// on a 2s debounce whose timer is `unref`ed — right for a server that stays up, wrong here twice
// over. Reproduced in one session: upsert a guest, call `scout_get_context`, and the briefing still
// said `guest 0`; the MCP process then exited and the regeneration never happened at all, so the
// NEXT run's `GET /api/cache/version` was unchanged too and the agent skipped the re-read.
//
// So this door SETTLES the cache after every mutating call and once more on the way out. An MCP
// session is short and single-threaded: the debounce buys nothing here, and the agent's very next
// tool call is the one that must see the truth.
// `flushCacheRegen()` and not `regenerateCache()`: it cancels the pending debounce and runs it ONLY
// if one was pending. That difference is the whole of Law 7's other half — `v` moves on a
// regeneration and never on a read, so a tool that wrote nothing must leave the integer alone or an
// agent re-reads its whole context after every dry-run match.
export async function settleCache() {
  const m = await import('./memory.mjs').catch(() => null);
  if (!m || typeof m.flushCacheRegen !== 'function') return false;
  try { return !!m.flushCacheRegen(); }
  catch { return false; /* a cache that will not regenerate is still only a cache */ }
}

// A tool may have written unless it is a GET. Derived from the route string rather than kept as a
// second list, for the same reason the tool surface itself is: a hand-maintained list of "which
// tools write" drifts from the bindings inside a week. Being wrong here is free — `settleCache()`
// is a no-op when nothing is pending.
const mutates = tool => !String(tool.route).startsWith('GET ');

export function toolsFrom(capabilities = INDEX_CAPABILITIES) {
  const seen = new Set();
  return capabilities.map(cap => {
    const route = String(cap.route);
    const name = toolName(route);
    if (seen.has(name)) throw new Error('two capabilities generate the tool name "' + name + '": ' + route);
    seen.add(name);
    const b = BINDINGS[route] || null;
    // `what` is the Index's own sentence, written for the agent. The binding note adds the rules an
    // agent that has read nothing else would otherwise have to learn by being refused.
    const description = [cap.what, b && b.note, 'Scout ' + route + '.'].filter(Boolean).join(' ');
    return {
      name,
      route,
      description,
      inputSchema: (b && b.schema) || S.open({}, [], {
        description: 'No MCP binding for ' + route + ' yet; nothing here is read.',
      }),
      text: !!(b && b.text),
      bound: !!b,
      run: b ? b.run : unboundRun(route),
    };
  });
}

export const TOOLS = toolsFrom(INDEX_CAPABILITIES);
const BY_NAME = new Map(TOOLS.map(t => [t.name, t]));

// What goes over the wire. `route`, `run`, `text` and `bound` are ours, not the client’s.
function publicTool(t) {
  return { name: t.name, title: t.route, description: t.description, inputSchema: t.inputSchema };
}

// ── the protocol ───────────────────────────────────────────────────────────────────────────────

const INSTRUCTIONS = [
  'Scout is a local-first datastore of plain markdown. You are an agent working inside somebody else’s notes.',
  'Start with scout_get_context — one read, under 2000 tokens, and it is the whole briefing. Never read the store in bulk.',
  'Submit findings with scout_post_records_upsert (or scout_post_records_batch when sweeping) and read the verdict.',
  'You propose, they dispose: you may move a record only as far as "shortlist", you may never delete anything, and you may never send a message to another human without an accepted outbound proposal.',
].join(' ');

function ok(id, result) { return { jsonrpc: '2.0', id, result }; }
function err(id, code, message, data = null) {
  const e = { code, message };
  if (data !== null && data !== undefined) e.data = data;
  return { jsonrpc: '2.0', id, error: e };
}

function negotiate(requested) {
  const want = String(requested || '');
  return PROTOCOL_VERSIONS.includes(want) ? want : LATEST_PROTOCOL;
}

async function callTool(params) {
  const name = String((params && params.name) || '');
  const tool = BY_NAME.get(name);
  if (!tool) {
    throw new McpError('no tool "' + name + '". Call tools/list for the ' + TOOLS.length + ' Scout tools.',
      JSONRPC_ERRORS.INVALID_PARAMS);
  }
  const args = (params && params.arguments) || {};
  if (typeof args !== 'object' || Array.isArray(args)) throw invalid('`arguments` must be an object');

  // The schema is BINDING, not documentation. A tool that names a required field and then lets a
  // call through without it is a schema an agent learns to ignore — and the failure surfaces three
  // layers down as somebody else's error message.
  for (const key of tool.inputSchema.required || []) {
    const v = args[key];
    if (v === undefined || v === null || v === '') {
      throw invalid('`' + key + '` is required by ' + name + ' — ' + tool.route);
    }
  }

  const out = await tool.run(args);
  // Before the reply goes back, not on a timer that this process may never live to fire. The agent's
  // next call is often `scout_get_context`, and it must see what it just wrote.
  if (mutates(tool)) await settleCache();
  // The wake-up tool returns the cache AS TEXT — the same bytes the API serves bare. Handing an
  // agent its briefing as an escaped JSON blob is how you burn a third of the budget on backslashes.
  const text = tool.text ? String(out ?? '') : JSON.stringify(out ?? null, null, 2);
  return { content: [{ type: 'text', text }] };
}

// Request object in, response object out. No process, no socket, no stdout — so the whole protocol
// is testable without spawning anything. Returns null for a notification (nothing to write back).
export async function handleMessage(msg, { log = () => {} } = {}) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return err(null, JSONRPC_ERRORS.INVALID_REQUEST, 'a JSON-RPC request must be an object');
  }
  const id = msg.id === undefined ? null : msg.id;
  const isNotification = msg.id === undefined || msg.id === null;
  const method = String(msg.method || '');
  if (!method) {
    return isNotification ? null : err(id, JSONRPC_ERRORS.INVALID_REQUEST, 'a JSON-RPC request needs a method');
  }

  try {
    switch (method) {
      case 'initialize': {
        const protocolVersion = negotiate(msg.params && msg.params.protocolVersion);
        log('initialize → ' + protocolVersion + ', ' + TOOLS.length + ' tools, root ' + getStorageRoot());
        return ok(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: INSTRUCTIONS,
        });
      }

      // The client telling us the handshake is done. A notification: no id, no reply, ever.
      case 'notifications/initialized':
      case 'initialized':
        log('client initialized');
        return null;

      case 'ping':
        return isNotification ? null : ok(id, {});

      case 'tools/list':
        return ok(id, { tools: TOOLS.map(publicTool) });

      case 'tools/call': {
        const result = await callTool(msg.params);
        log('tools/call ' + ((msg.params && msg.params.name) || '?') + ' → ok');
        return ok(id, result);
      }

      default:
        if (isNotification) return null;   // an unknown notification is ignored, never answered
        return err(id, JSONRPC_ERRORS.METHOD_NOT_FOUND, 'this server speaks initialize, tools/list, tools/call and ping — not "' + method + '"');
    }
  } catch (e) {
    // THE SENTENCE, NOT THE STATUS. `records.mjs` refuses with a sentence written for the agent;
    // that sentence is the message here, and the HTTP status it would have carried rides in `data`
    // for a client that wants to branch on it.
    const code = e instanceof McpError ? e.code : JSONRPC_ERRORS.SERVER;
    const data = e instanceof McpError
      ? (e.data || (e.status ? { status: e.status } : null))
      : { status: e.status || 400, ...(e.reasons ? { reasons: e.reasons } : {}) };
    log('error: ' + e.message);
    return isNotification ? null : err(id, code, String(e.message || 'the call failed'), data);
  }
}

export function createServer({ log = () => {} } = {}) {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    tools: TOOLS,
    listTools: () => TOOLS.map(publicTool),
    handleMessage: msg => handleMessage(msg, { log }),
    // The host going away is the last chance to write the cache. `scripts/scout-mcp.mjs` awaits
    // this before it exits, so a session that ends one millisecond after a write still leaves the
    // next run a `v` it can trust. Safe to call twice.
    close: () => settleCache(),
  };
}

// ── stdio ──────────────────────────────────────────────────────────────────────────────────────
// Newline-delimited JSON, per the MCP stdio transport. STDOUT CARRIES FRAMES AND NOTHING ELSE.

const NL = String.fromCharCode(10);

export function start({ input = process.stdin, output = process.stdout, log = null } = {}) {
  const say = log || (m => { try { process.stderr.write('[scout-mcp] ' + m + NL); } catch { /* stderr is gone; do not take the server with it */ } });
  const server = createServer({ log: say });

  let buffer = '';
  let chain = Promise.resolve();   // one message at a time: replies keep the order they arrived in

  const write = frame => {
    try { output.write(JSON.stringify(frame) + NL); }
    catch (e) { say('could not write a frame: ' + e.message); }
  };

  const handle = line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); }
    catch (e) { write(err(null, JSONRPC_ERRORS.PARSE, 'that frame is not JSON: ' + e.message)); return; }
    // A batch is a JSON array of requests. Answer each, drop the notifications, and reply with an
    // array only if at least one of them wanted an answer.
    chain = chain.then(async () => {
      if (Array.isArray(msg)) {
        const out = [];
        for (const one of msg) { const r = await server.handleMessage(one); if (r) out.push(r); }
        if (out.length) write(out);
        return;
      }
      const res = await server.handleMessage(msg);
      if (res) write(res);
    }).catch(e => say('unhandled: ' + (e && e.message)));
  };

  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf(NL)) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      handle(line);
    }
  });
  input.on('end', () => {
    if (buffer.trim()) handle(buffer);
    buffer = '';
    // Let the last reply land before the process is allowed to fall off the end of the loop, and
    // settle the hot cache on the way out — a debounced regeneration on an `unref`ed timer does not
    // survive an exit, and losing it tells the NEXT run that nothing changed.
    chain = chain.then(() => server.close()).then(() => say('stdin closed'));
  });
  input.on('error', e => say('stdin error: ' + e.message));

  say('ready — ' + TOOLS.length + ' tools, workspace ' + getStorageRoot());
  input.resume();
  return server;
}
