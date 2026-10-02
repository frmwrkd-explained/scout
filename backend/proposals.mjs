// DECIDE — the one queue. M4 / T13.
// Contract: docs/08_MODULE_CONTRACTS.md §8. Law 4: agents propose, humans dispose.
//
// EVERY approval in the app flows through here. There are six card kinds and exactly one accept
// path and one reject path; a seventh way to approve something is the bug this file exists to
// prevent. Cards are plain markdown at `proposals/<id>.md`, so a queue is greppable and a decision
// is auditable without the app.
//
//   kind        accepting means
//   ─────────── ──────────────────────────────────────────────────────────────────────
//   finding     moveRecord(card.record, { to: 'shortlist' })
//   outbound    the exact wording is approved for sending (approved_at stamped)
//   territory   the agent may request to join — territory `access: requested`
//   learning    saveLearning(id, { status: 'active' }) — it enters memory and the cache
//   schema      saveCollection / addField — the collection or field is created
//   question    the answer is written into learnings/ or me.md
//
// Rejecting always records the reason, logs it, and tells the agent. NEVER SILENT.
//
// Views are deliberately absent from that table. Agent contract §4: views are free and reversible,
// fields and collections are not. A `schema` card that proposes a view is refused with the route
// that would have done it for nothing.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getStorageRoot, readMd, writeMd, safe, byDate } from './store.mjs';
import { isAgentActor } from './actors.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';

const R = () => getStorageRoot();
export const proposalsDir = () => path.join(R(), 'proposals');
const proposalFile = id => path.join(proposalsDir(), safe(id) + '.md');

export const CARD_KINDS = ['finding', 'outbound', 'territory', 'learning', 'schema', 'question', 'widget'];
// The same five as records.mjs ARCHIVE_REASONS, and that is not a coincidence: rejecting a finding
// archives the record with this reason, which is what makes a rejection move a territory's score
// (GOAL §4 gate 5). If that list ever changes, these must change together.
export const REJECT_REASONS = ['off-target', 'bad-data', 'duplicate', 'wrong-tone', 'already-contacted'];
export const CARD_STATUS = ['open', 'accepted', 'rejected'];

export class ProposalError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

const nowIso = () => new Date().toISOString();
// The acceptance binds the exact outbound content and its delivery identity. A later file
// edit cannot inherit an approval of different words, work or destination.
export function outboundApprovalFingerprint(card) {
  const approved = {};
  for (const key of ['kind', 'message', 'channel', 'subject', 'territory', 'work_id', 'destination_id', 'delivery_hash']) {
    approved[key] = card[key] ?? null;
  }
  return crypto.createHash('sha256').update(JSON.stringify(approved)).digest('hex');
}
function requireHumanDecision(actor) {
  if (currentWorkerIdentity() || isAgentActor(actor)) throw new ProposalError('Only a human may accept or reject a proposal.', 403);
}
// Module-level deps, set by registerProposalRoutes. Every effect resolves through resolve() below,
// so a test can inject a fake and the app can run before the module the effect lives in has landed.
let ROUTE_DEPS = {};

// Effects live in other people's modules (records / memory / collections / territory). Resolve at
// call time: an injected function wins, then the canonical module, then nothing. Never a fallback
// writer — "only records.mjs writes data/" stops being true the moment this file grows one.
async function resolve(name, modulePath, deps) {
  const local = deps && deps[name];
  if (typeof local === 'function') return local;
  const injected = ROUTE_DEPS[name];
  if (typeof injected === 'function') return injected;
  try {
    const m = await import(modulePath);
    if (typeof m[name] === 'function') return m[name];
  } catch { /* not landed yet */ }
  return null;
}
function needed(fn, name, modulePath) {
  if (!fn) {
    throw new ProposalError(
      'cannot accept this card yet: ' + name + '() is not available (expected in ' + modulePath + ')', 501);
  }
  return fn;
}

// Adapter to docs/08 §1, not a second log. See tasks.mjs for the same six lines and the same reason.
async function event(deps, ev) {
  try {
    const fn = (deps && deps.logEvent) || ROUTE_DEPS.logEvent
      || (await import('./log.mjs').then(m => m.logEvent, () => null));
    if (fn) fn(ev);
  } catch { /* logging must never fail a decision */ }
}

// ── read ───────────────────────────────────────────────────────────────────────────────────────

export function getProposal(id) {
  const file = proposalFile(id);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = readMd(file); } catch { return { id, kind: 'unknown', status: 'open', broken: true }; }
  const { data, content } = parsed;
  return {
    ...data,
    id: data.id || id,
    kind: data.kind,
    status: CARD_STATUS.includes(data.status) ? data.status : 'open',
    title: data.title || data.id || id,
    why: data.why || '',
    evidence: Array.isArray(data.evidence) ? data.evidence : [],
    created: data.created || null,
    created_by: data.created_by || null,
    path: path.join('proposals', safe(id) + '.md'),
    body: content.trim(),
  };
}

// One at a time is the UI's job; this returns them OLDEST FIRST so the queue is a queue and card
// 200 of the day is not a random sample of the morning.
export function listProposals({ status = 'open', kind = null, actor = null } = {}) {
  let files = [];
  // `._*` are macOS AppleDouble sidecars on this exFAT volume — metadata, never a card.
  try { files = fs.readdirSync(proposalsDir()).filter(f => f.endsWith('.md') && !f.startsWith('.')); } catch { return []; }
  const out = [];
  for (const f of files.sort()) {
    const c = getProposal(f.slice(0, -3));
    if (!c) continue;
    if (status && status !== 'all' && c.status !== status) continue;
    if (kind && c.kind !== kind) continue;
    if (actor && c.created_by !== actor) continue;
    out.push(c);
  }
  // Tie-break on id: two cards proposed inside the same millisecond must still come out in a
  // stable order, or "the next card" is a different card depending on the filesystem's mood.
  return out.sort((a, b) =>
    byDate('created')(a, b) || a.id.localeCompare(b.id));
}

// ── propose ────────────────────────────────────────────────────────────────────────────────────

// What each kind must carry to be decidable at altitude 1. A card the human cannot judge without
// opening three other screens is not a card, it is a chore.
const REQUIRED = {
  finding: ['record'],
  outbound: ['channel', 'message'],
  territory: ['territory'],
  learning: ['claim'],
  schema: ['change'],
  question: ['question'],
  widget: ['widget'],
};

// A territory card names its ground either as an id — `territory: ofw-uk` — or as the whole object
// the finder saw: `{ id, label, kind, url }`. Both are legal (the agent has an id; the memory
// layer's `POST /api/territory/propose` has the object), and both resolve HERE, so there is one
// place that turns a card's `territory` into an id plus a patch.
//
// Without it, `saveTerritory(card.territory, …)` was handed the object, `safe(String(object))`
// produced `_object_Object_`, and accepting the card wrote `territory/_object_Object_.md` with
// `label: undefined` — a 200, a file, and nothing anybody asked for.
export function territoryOf(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    const id = String(value).trim();
    return id ? { id } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = String(value.id ?? value.slug ?? '').trim();
  if (!id) return null;
  const out = { id };
  for (const k of ['label', 'kind', 'url']) {
    if (value[k] !== undefined && value[k] !== null && value[k] !== '') out[k] = String(value[k]);
  }
  return out;
}

function validate(card) {
  if (!card || typeof card !== 'object') throw new ProposalError('a proposal must be an object');
  if (!CARD_KINDS.includes(card.kind)) {
    throw new ProposalError('unknown card kind "' + card.kind + '". Legal kinds are: ' + CARD_KINDS.join(' · '));
  }
  if (!String(card.why || '').trim()) {
    throw new ProposalError('every card carries `why` — the human decides on the reason, not the request');
  }
  // `path` on a card is the CARD's own file, everywhere in this codebase (getTask, getAssistant do
  // the same). The record a finding is about is `record`. They were one key once and the collision
  // silently archived a proposal file instead of the guest — hence the named refusal.
  if (card.kind === 'finding' && card.path && !card.record) {
    throw new ProposalError('a finding card points at its record with `record`, not `path` — `path` is the card\'s own file');
  }
  for (const k of REQUIRED[card.kind]) {
    if (card[k] === undefined || card[k] === null || card[k] === '') {
      throw new ProposalError('a ' + card.kind + ' card needs `' + k + '`');
    }
  }
  if (card.kind === 'territory') {
    const ground = territoryOf(card.territory);
    if (!ground) {
      throw new ProposalError(
        'a territory card names its ground with an id — `territory: "ofw-uk"`, or the whole thing: '
        + '`territory: { id, label, kind, url }`');
    }
    // Normalised in place, so the effect and the card agree. A bare id stays a BARE ID on disk:
    // `territory: ofw-uk` is what a person opening the file should read, and `{ id: ofw-uk }` with
    // nothing else in it is the same fact spelled worse (Law 1).
    card.territory = (ground.label || ground.kind || ground.url) ? ground : ground.id;
  }
  if (card.kind === 'schema') {
    // Views are free (agent contract §4) — proposing one wastes a human decision on something that
    // is already allowed and reversible. Name the route that does it instead of just refusing.
    if (card.change === 'view') {
      throw new ProposalError('views are free and reversible — save it with PUT /api/views/:collection, no card needed');
    }
    if (!['collection', 'field', 'subtable'].includes(card.change)) {
      throw new ProposalError('a schema card changes one of: collection · field · subtable');
    }
    // "A proposal must carry evidence — '14 of your last 20 shortlists post video' — not an
    // opinion" (agent contract §4, T13). This is the one kind where that is enforced, because it is
    // the one kind that changes what everyone sees forever.
    if (!Array.isArray(card.evidence) || !card.evidence.length) {
      throw new ProposalError('a schema card must carry evidence[] — what you observed, not what you think');
    }
    if (card.change === 'field' && (!card.collection || !card.field)) {
      throw new ProposalError('a field card needs `collection` and `field: { key, type, ... }`');
    }
    if (card.change === 'collection' && !card.schema) throw new ProposalError('a collection card needs `schema`');
  }
  if (['learning', 'widget'].includes(card.kind) && (!Array.isArray(card.evidence) || !card.evidence.length)) {
    throw new ProposalError('a learning card must carry evidence[] — a claim with no evidence is a rumour');
  }
  return card;
}

function autoId(card) {
  const base = String(card.kind + '-' + (card.title || card.claim || card.question || card.territory || 'card'))
    .toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return base + '-' + Date.now().toString(36);
}

// Idempotent on `id`: a caller with a deterministic id (a blocked task, a re-run sweep) re-proposes
// the same thing every run, and a queue that grows a copy per run is a queue nobody works.
export function propose(card = {}, { actor = 'scout' } = {}) {
  const { id: given, body, ...rest } = card;
  validate(rest);
  const id = safe(String(given || autoId(rest)));
  const existing = getProposal(id);
  if (existing) return { ...existing, duplicate: true };

  const data = {
    ...rest,
    id,
    status: 'open',
    created: nowIso(),
    created_by: actor,
    decided_at: null,
    decided_by: null,
    reason: null,
  };
  writeMd(proposalFile(id), data, body !== undefined ? String(body) : String(rest.why || ''));
  return getProposal(id);
}

// ── accept ─────────────────────────────────────────────────────────────────────────────────────
// ONE path. Each kind contributes an effect; the card is only stamped accepted once its effect has
// actually happened. An "accepted" card whose effect threw would be the worst of both worlds: the
// human believes they approved it and nothing exists.

// Which learning does this card write to? `learning:` if the card names one, otherwise the id in
// `subject:` when it points at an existing learnings/ file, and only then the card's own id.
//
// Without the subject step, a card proposing a CHANGE to `learnings/hospital-named-needs-clearing`
// wrote a brand-new `learnings/learning-hospital-named.md` beside it and left the original at
// `status: proposed` — two files making the same claim, one of them invisible to the cache. Law 6
// is one file per entity, and the failure mode is silent, so the resolution belongs here rather
// than in each caller.
function learningIdFor(card) {
  if (card.learning) return String(card.learning);
  const subject = String(card.subject || '');
  const m = subject.match(/(?:^|\/)learnings\/([^/]+?)(?:\.md)?$/);
  if (m) return m[1];
  return card.id;
}

// The interview records the view it intends (`pending_view`) and flushes it in `settleWorkspace()`,
// which until now only ran on the next `GET /api/intake` — a route the UI does not call after the
// human accepts the card. So the collection landed and its view existed only as the thing
// `listViews()` regenerates on read: not a file, not in the vault, not travelling with the data,
// and not readable by an agent (docs/02_DATA_MODEL.md §3).
//
// Imported lazily: intake.mjs imports collections, views, memory, territory and tasks, and a static
// import here would be a cycle. A view is free and reversible (agent contract §4), so a failure to
// settle must never fail an approval that has already happened.
async function settleAfterCollection(deps) {
  try {
    const settle = await resolve('settleWorkspace', './intake.mjs', deps);
    if (settle) return settle();
  } catch { /* the collection exists; the view regenerates on read until someone asks again */ }
  return null;
}

async function effectFor(card, actor, deps) {
  switch (card.kind) {
    case 'widget': {
      const approveWidget = needed(await resolve('approveWidget', './widgets.mjs', deps), 'approveWidget', 'backend/widgets.mjs');
      return { effect: 'widget', result: await approveWidget(card.widget, { actor }) };
    }
    case 'finding': {
      const moveRecord = needed(await resolve('moveRecord', './records.mjs', deps), 'moveRecord', 'backend/records.mjs');
      // AGENT_MAX_STAGE is `shortlist` — accepting a finding is exactly the move an agent may not
      // make for itself, which is the whole shape of Law 4.
      return { effect: 'move', result: await moveRecord(card.record, { to: 'shortlist', actor, reason: 'approved in DECIDE' }) };
    }
    case 'outbound':
      // The effect IS the approval: the exact wording, as written, is now sendable. Nothing else in
      // the app may send on the human's behalf without this stamp.
      return { effect: 'approved', result: { approved_at: nowIso(), approved_by: actor, message: card.message } };

    case 'territory': {
      const saveTerritory = needed(await resolve('saveTerritory', './territory.mjs', deps), 'saveTerritory', 'backend/territory.mjs');
      // Resolved through the one normaliser, so a card written before this existed (a plain string
      // in `proposals/` on disk) and a card written by the memory layer (an object) take the same
      // path. Everything the card knows about the ground travels with it — a territory created by
      // an approval should not arrive with `label: undefined`.
      const { id, ...ground } = territoryOf(card.territory) || {};
      if (!id) throw new ProposalError('this card names no ground — `territory` must carry an id');
      // `requested`, not `member`: accepting means the agent MAY ASK to join. Joining is Facebook's
      // decision, not ours, and recording it as membership would poison every hit-rate that follows.
      return { effect: 'territory', result: await saveTerritory(id, { ...ground, access: 'requested', access_changed: nowIso() }, { actor }) };
    }
    case 'learning': {
      const saveLearning = needed(await resolve('saveLearning', './memory.mjs', deps), 'saveLearning', 'backend/memory.mjs');
      const id = learningIdFor(card);
      return { effect: 'learning', result: await saveLearning(id, { status: 'active', claim: card.claim, evidence: card.evidence, verified_at: nowIso() }, { actor }) };
    }
    case 'schema': {
      if (card.change === 'field') {
        const addField = needed(await resolve('addField', './collections.mjs', deps), 'addField', 'backend/collections.mjs');
        return { effect: 'field', result: await addField(card.collection, card.field) };
      }
      const saveCollection = needed(await resolve('saveCollection', './collections.mjs', deps), 'saveCollection', 'backend/collections.mjs');
      if (card.change === 'subtable') {
        const getCollection = needed(await resolve('getCollection', './collections.mjs', deps), 'getCollection', 'backend/collections.mjs');
        const parent = await getCollection(card.collection);
        if (!parent) throw new ProposalError('no collection "' + card.collection + '" to hang a subtable on');
        const subtables = [...(parent.subtables || []).filter(s => s.id !== card.subtable.id), card.subtable];
        return { effect: 'subtable', result: await saveCollection({ ...parent, subtables }) };
      }
      const result = await saveCollection(card.schema);
      await settleAfterCollection(deps);
      return { effect: 'collection', result };
    }
    case 'question': {
      const answer = String(card.answer || '').trim();
      if (!answer) throw new ProposalError('answer the question before accepting it — `answer` is required');
      if (card.target === 'me') {
        const writeMe = needed(await resolve('writeMe', './memory.mjs', deps), 'writeMe', 'backend/memory.mjs');
        return { effect: 'me', result: await writeMe(answer, {}, { actor }) };
      }
      const saveLearning = needed(await resolve('saveLearning', './memory.mjs', deps), 'saveLearning', 'backend/memory.mjs');
      const id = learningIdFor(card);
      // A QUESTION CARD CARRIES NO EVIDENCE, and `validate()` does not ask for any — the whole
      // point of the kind is that the agent does not know. memory.mjs refuses an ACTIVE learning
      // with an empty evidence[], so every answered question 400ed, and the five rejection reasons
      // are all about a bad proposal — none of them fits "she answered it". A blocked assistant
      // therefore added one card that could never be cleared.
      //
      // The resolution: a human answering her own assistant IS the evidence, and the card is where
      // that happened. Its own file is the provenance, so the claim is traceable to the question,
      // the answer and who gave it — which is what evidence[] is for.
      // A wikilink with no extension, which is the convention everywhere else evidence is written
      // (records.mjs `raiseFinding`, and every seeded card) — both readers accept either form.
      const evidence = (Array.isArray(card.evidence) && card.evidence.length)
        ? card.evidence
        : ['[[' + String(card.path).replace(/\.md$/, '') + ']]'];
      return { effect: 'learning', result: await saveLearning(id, { status: 'active', claim: answer, question: card.question, evidence, verified_at: nowIso() }, { actor }) };
    }
    default:
      throw new ProposalError('unknown card kind "' + card.kind + '"');
  }
}

export async function accept(id, { actor = 'crystal', answer = null, deps = null } = {}) {
  requireHumanDecision(actor);
  const card = getProposal(id);
  if (!card) throw new ProposalError('no proposal "' + id + '"', 404);
  if (card.status !== 'open') throw new ProposalError('this card was already ' + card.status, 409);
  if (answer !== null) card.answer = answer;

  const { effect, result } = await effectFor(card, actor, deps);   // throws → nothing is stamped

  const { data, content } = readMd(proposalFile(id));
  const next = {
    ...data,
    ...(card.answer !== undefined ? { answer: card.answer } : {}),
    status: 'accepted',
    decided_at: nowIso(),
    decided_by: actor,
    effect,
    ...(card.kind === 'outbound' ? { approved_at: result.approved_at, approved_by: actor,
      approved_content_hash: outboundApprovalFingerprint(card) } : {}),
    notice: 'Accepted by ' + actor + '. ' + effect + '.',
  };
  writeMd(proposalFile(id), next, content);
  await event(deps, { type: 'accept', actor, target: card.path, detail: { kind: card.kind, effect } });
  return { ...getProposal(id), effect, result };
}

// ── reject ─────────────────────────────────────────────────────────────────────────────────────
// A reason is not paperwork. It is the only labelled data this system ever gets (Law 5): territory
// scores, playbook claims and every improvement to the agent are computed from rejects.

export async function reject(id, { reason, actor = 'crystal', deps = null } = {}) {
  requireHumanDecision(actor);
  const card = getProposal(id);
  if (!card) throw new ProposalError('no proposal "' + id + '"', 404);
  if (card.status !== 'open') throw new ProposalError('this card was already ' + card.status, 409);
  if (!reason) throw new ProposalError('a rejection needs a reason — one of ' + REJECT_REASONS.join(' · '));
  if (!REJECT_REASONS.includes(reason)) {
    throw new ProposalError('"' + reason + '" is not a rejection reason. One of: ' + REJECT_REASONS.join(' · '));
  }

  // Rejecting a finding archives the record WITH THE SAME REASON — that is what makes rejecting for
  // `off-target` visibly move a source's score. Unlike accept, this is best-effort: a rejection is
  // never blocked by a missing module, because the alternative is a human who cannot say no.
  let side = 'card-only';
  if (card.kind === 'finding' && card.record) {
    const archiveRecord = await resolve('archiveRecord', './records.mjs', deps);
    if (archiveRecord) {
      try { await archiveRecord(card.record, { reason, actor }); side = 'archived'; }
      catch (e) { side = 'archive-failed: ' + e.message; }
    }
  }

  const { data, content } = readMd(proposalFile(id));
  // The agent is told, in the file it can already read. Nothing is silent.
  const notice = 'Rejected by ' + actor + ' — ' + reason + '. Do not re-propose this without new evidence.';
  writeMd(proposalFile(id), {
    ...data, status: 'rejected', reason, decided_at: nowIso(), decided_by: actor, effect: side, notice,
  }, content);
  await event(deps, { type: 'decide', actor, target: card.path, detail: { kind: card.kind, decision: 'reject', reason, effect: side } });
  return { ...getProposal(id), effect: side };
}

// ── routes ─────────────────────────────────────────────────────────────────────────────────────

export function registerProposalRoutes(app, deps = {}) {
  ROUTE_DEPS = deps || {};
  const actorOf = req => String(req.body?.actor || req.query?.actor || 'crystal');
  const agentOf = req => String(req.body?.actor || req.query?.actor || 'scout');
  const fail = (res, e) => res.status(e.status || 400).json({ error: e.message });

  app.get('/api/proposals', (req, res) => {
    res.json({
      proposals: listProposals({
        status: req.query.status || 'open',
        kind: req.query.kind || null,
        actor: req.query.by || null,
      }),
    });
  });

  app.get('/api/proposals/:id', (req, res) => {
    const c = getProposal(req.params.id);
    return c ? res.json(c) : res.status(404).json({ error: 'no proposal "' + req.params.id + '"' });
  });

  app.post('/api/proposals', async (req, res) => {
    try {
      const { actor, ...card } = req.body || {};
      const c = propose(card, { actor: agentOf(req) });
      await event(deps, { type: 'propose', actor: agentOf(req), target: c.path, detail: { kind: c.kind } });
      res.json(c);
    } catch (e) { fail(res, e); }
  });

  app.post('/api/proposals/:id/accept', async (req, res) => {
    try { res.json(await accept(req.params.id, { actor: actorOf(req), answer: req.body?.answer ?? null })); }
    catch (e) { fail(res, e); }
  });

  // No reason → 400, and the message names the five. A rejection with no reason is a deletion.
  app.post('/api/proposals/:id/reject', async (req, res) => {
    try { res.json(await reject(req.params.id, { reason: req.body?.reason, actor: actorOf(req) })); }
    catch (e) { fail(res, e); }
  });

  // The three propose-doors the router skill already documents (skills/scout-router/references/
  // api-mode.md) that no other module owns. `/api/learnings/propose` and `/api/territory/propose`
  // belong to memory.mjs and territory.mjs — registering them here would shadow theirs.
  // The three propose-doors the router skill already documents (skills/scout-router/references/
  // api-mode.md) that no other module owns. `/api/learnings/propose` and `/api/territory/propose`
  // belong to memory.mjs and territory.mjs — registering them here would shadow theirs.
  //
  // The path is written as a LITERAL at each app.post: the Index's honesty check reads route
  // registrations out of the source (backend/agentIndex.mjs), and a path passed through a variable
  // is invisible to it — the capability would be silently withheld from every agent.
  const door = build => async (req, res) => {
    try {
      const c = propose(build(req.body || {}), { actor: agentOf(req) });
      await event(deps, { type: 'propose', actor: agentOf(req), target: c.path, detail: { kind: c.kind } });
      res.json(c);
    } catch (e) { fail(res, e); }
  };

  app.post('/api/collections/propose', door(b => ({
    kind: 'schema', change: 'collection', schema: b.schema || b,
    title: 'New collection · ' + ((b.schema && b.schema.id) || b.id || ''),
    why: b.why, evidence: b.evidence,
  })));

  app.post('/api/fields/propose', door(b => ({
    kind: 'schema', change: 'field', collection: b.collection,
    field: b.field || { key: b.key, type: b.type, ...(b.options ? { options: b.options } : {}) },
    title: 'New field · #' + b.collection + ' → ' + (b.key || (b.field && b.field.key) || ''),
    why: b.why, evidence: b.evidence,
  })));

  app.post('/api/outbound/propose', door(b => ({
    kind: 'outbound', channel: b.channel, territory: b.territory, subject: b.subject,
    message: b.message || b.body,
    title: 'Send · ' + (b.subject || b.channel || ''),
    why: b.why || 'The agent wants to send this, exactly as written.',
  })));
}
