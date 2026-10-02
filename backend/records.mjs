// The write pipeline — docs/08_MODULE_CONTRACTS.md §3, tasks T06 + T08.
//
// THE ONLY WRITER OF FILES UNDER `data/`. Dedupe, provenance and the gate all live here; a second
// writer bypasses all three undetectably, which is why `backend/index.mjs` deliberately ships no
// document writes and `backend/documents.mjs` is read-only on purpose.
//
// Law 4 — agents propose, humans dispose, and the gate is in the pipeline, never in a prompt. It is
// enforced three times, because an agent with folder access cannot be prevented from writing:
//   1. on write   — an agent moving/creating past `shortlist` gets 403 and a `refused` event
//   2. on read    — an agent-authored stage past `shortlist` is IGNORED and flagged
//   3. on scan    — a file that appeared under `data/` without passing through here is quarantined
// You cannot prevent the write. You can make it have no effect and be visible.
//
// Law 5 — never delete. `archiveRecord` MOVES the file to `data/_archive/<collection>/` with its
// frontmatter, its reason and its history intact. Nothing in this module calls `fs.rmSync` on a
// document, and the only `unlinkSync` is the second half of a move whose destination already exists
// on disk and has been read back.
//
// INGEST IS ADDITIVE, EDITING IS AUTHORITATIVE. `upsertRecord` never overwrites a value that is
// already there — it fills empty fields and unions arrays. That is what makes the T06 demonstrate
// possible at all (the same person under a third handle has nothing new to add, so it is a `skip`)
// and it is what stops a sloppy sweep from silently replacing a human's correction with a scrape.
// The human's editor is `patchRecord`, which does overwrite, on purpose, with a rev check.

import fs from 'node:fs';
import path from 'node:path';
import { getStorageRoot, readMd, writeMd, revOf } from './store.mjs';
import { getCollection, listCollections, gateField, primaryField, AUTO_FIELDS } from './collections.mjs';
import { allDocuments, documentsFor, matchesQuery, kindOf } from './documents.mjs';
import { logEvent, readEvents, eventsFor, EVENT_TYPES } from './log.mjs';
import { currentWorkerIdentity, outsideWorkerIdentity, assertWorkerCollectionAccess, assertWorkerRecordAccess,
  workerCanReadDocument, projectWorkerDocument } from './workerScope.mjs';
// proposals.mjs imports store.mjs and nothing else; it reaches back into this file only through a
// runtime `await import()`, so this is not a load-time cycle. It is imported statically on purpose:
// raising the DECIDE card has to happen inside the same synchronous `store` verdict, and making
// upsertRecord async to lazy-load one function would change a signature three modules and eight
// test files call directly.
import { propose as proposeCard, listProposals } from './proposals.mjs';

// index.mjs hands `logEvent` to every module rather than letting each import it, so there is
// exactly one append point and nowhere for a mutation to happen quietly. It is the same function
// this file imports — taking the dep as well is what lets an integrator wrap it (a spy, a fan-out
// to the drawer) without anybody growing a second log. `onMutation` is inbox.mjs's
// `refreshAgentFiles`: `_known.md` is how a folder-mode agent dedupes without an API, so it has to
// be rewritten whenever the store changes, whichever of the three doors the change came through.
let emit = logEvent;
let onMutation = () => {};

// EVERY write verb in this file ends here, and that is the only reason Law 7 holds. The hot cache
// is a contract; a write that does not invalidate it makes `GET /api/cache/version` tell an agent
// its stale context is still good. It has to fire IN THE PROCESS THAT WROTE — the API server, an
// MCP session, the inbox watcher — so it is called from the verb rather than registered as a route
// hook, and unconditionally rather than per path: `PATCH /api/records` is the door the document
// surface sends every `.md` through, memory objects included.
//
// `import()` rather than a static import of memory.mjs: memory.mjs imports this file, and this is
// the one edge that would have to be resolved at load time. Fire-and-forget rather than awaited,
// so a write never waits on a cache, and the regeneration is debounced 2s in memory.mjs anyway.
function bumpCache() {
  outsideWorkerIdentity(() => import('./memory.mjs')
    .then(m => { try { m.scheduleCacheRegen({}); } catch { /* a cache that will not schedule is still only a cache */ } })
    .catch(() => { /* memory.mjs is optional to a bare records import */ }));
}
const touched = () => {
  try { onMutation(); } catch { /* a stale _known.md never fails a write */ }
  bumpCache();
};

// Identity lives in ONE place now (backend/actors.mjs) — this module used to define it, and
// memory.mjs defined a second copy that disagreed with it. Re-exported here so every existing
// importer, and every test, keeps reaching for it where it has always been.
import { DEFAULT_ACTOR, isAgentActor, actorRegistry } from './actors.mjs';
import { slugify } from './store.mjs';
export { DEFAULT_ACTOR, isAgentActor, actorRegistry, slugify };

// ── constants ──────────────────────────────────────────────────────────────────────────────────

export const ARCHIVE_REASONS = ['off-target', 'bad-data', 'duplicate', 'wrong-tone', 'already-contacted'];
export const AGENT_MAX_STAGE = 'shortlist';   // index into the gate field's options
export const MERGE_CONFIDENCE = 60;           // >= this merges into the existing record (T06 step 3)
// Today owns work transitions: each one also updates the clock, validates evidence and
// schedules any follow-up. A module token keeps generic API writes on that same path.
export const WORK_TRANSITION = Symbol('work-transition');

function checkWorkTransition(collection, status, previous, token) {
  if (collection?.id !== 'work' || status === undefined || status === previous || token === WORK_TRANSITION) return;
  if (previous === undefined && status === 'planned') return;
  throw new RecordError('Change work status from Today so time, completion evidence and follow-ups stay in sync', 400);
}

export class RecordError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

// Written by the pipeline, never accepted from a caller. An agent that puts `quarantined: false`
// in its payload is asking to switch off the thing that is watching it.
const PIPELINE_FIELDS = new Set([...AUTO_FIELDS, 'provenance', 'archived', 'archived_at', 'archived_by', 'archive_reason', 'archived_from', 'history']);
const INPUT_CONTROL_FIELDS = new Set(['collection', 'id', 'path', 'body', 'content', 'actor', 'via', 'rev']);

// ── actors ───────────────────────────────────────────────────────────────────────────────────
// Moved to `backend/actors.mjs`, which is now the ONLY answer to "is this actor an agent?".
// memory.mjs carried a second copy that disagreed about an empty actor and about where the human
// is declared; Law 4 cannot mean two things in two files. Imported and re-exported above so this
// module's public surface is unchanged.

const R = () => getStorageRoot();
function refuseDecisionControlWrite(relPath) {
  if (String(relPath).startsWith('proposals/')) {
    throw new RecordError('Proposal content and decisions are managed through Needs you; create a fresh proposal for changed content', 403);
  }
  if (String(relPath).startsWith('.scout/worker-policies/')) {
    throw new RecordError('worker membership is configured through the owner membership settings', 403);
  }
  if (String(relPath).startsWith('.scout/')) {
    throw new RecordError('Scout control files are managed through their dedicated APIs', 403);
  }
}

// ── paths and slugs ────────────────────────────────────────────────────────────────────────────
// `store.mjs safe()` is for filesystem safety, not for identity: safe('Maria Santos') is
// `Maria_Santos`, and the store's own shape is `maria-santos.md`. One slugifier, exported, so the
// second one never gets written.


const rel = (abs) => path.relative(R(), abs).split(path.sep).join('/');

// Every path in this module arrives from a client. It must land inside the store and it must be a
// document — nothing here is allowed to reach a skill file, a config, or the log.
function absOf(relPath) {
  const root = R();
  const abs = path.resolve(root, String(relPath || ''));
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new RecordError('path escapes the store', 400);
  if (!abs.endsWith('.md')) throw new RecordError('a record path ends in .md', 400);
  return abs;
}

// ── scope: this module writes `data/`, and delegates everything else ───────────────────────────
//
// `PATCH /api/records` is the door `App.openPath` sends EVERY `.md` through — a guest, a group, a
// territory, a playbook claim, a goal, `me.md`. It was writing all of them with the generic record
// writer, which has three consequences and all three were reproduced:
//
//   · **Law 4 had a side door.** `collectionOf('me.md')` is null, so there is no gate field, so the
//     agent branch never fires: an agent PATCHed `me.md` to `name: HACKED` and got 200, while
//     `PUT /api/me` refused the identical write with 403. Same for `goals/`.
//   · **Law 7 was broken.** The memory writers schedule the hot-cache regeneration; the generic
//     writer did not, so correcting a territory through the document surface left the agent's
//     wake-up context saying the opposite of the file for as long as nobody touched a memory route.
//   · **territory.mjs stopped being the sole writer of the rollups.** A workspace whose `territory`
//     collection declares `finds`/`wins` (the shipped template does) put them on the property table,
//     and the generic writer wrote whatever was typed there.
//
// So: a path under `data/` is a record and is written here. A path outside it belongs to the module
// that owns that object, and the patch is DELEGATED to it — which is also how the refusal, the
// stripping and the cache bump come back for free, in one place, phrased the one way.
export const RECORD_ROOT = 'data/';
export const isRecordPath = (relPath) => String(relPath || '').split(path.sep).join('/').startsWith(RECORD_ROOT);

// module + function, resolved lazily at call time. `id` is the file's own slug.
const DELEGATES = [
  { re: /^me\.md$/, mod: './memory.mjs', fn: 'writeMe', kind: 'identity' },
  // One segment, because that is what the memory modules address: `scoutPaths.goal(id)` is
  // `goals/<safe(id)>.md` and nothing nested is a goal. A deeper path is not that object and must
  // not be handed to a writer that would `safe()` it into a different file.
  { re: /^goals\/([^/]+)\.md$/, mod: './memory.mjs', fn: 'saveGoal', kind: 'goal' },
  { re: /^playbook\/([^/]+)\.md$/, mod: './memory.mjs', fn: 'savePlaybook', kind: 'playbook' },
  { re: /^learnings\/([^/]+)\.md$/, mod: './memory.mjs', fn: 'saveLearning', kind: 'learning' },
  { re: /^territory\/([^/]+)\.md$/, mod: './territory.mjs', fn: 'saveTerritory', kind: 'territory' },
];

function delegateFor(relPath) {
  const p = String(relPath || '').split(path.sep).join('/');
  for (const d of DELEGATES) {
    const m = d.re.exec(p);
    if (m) return { ...d, id: m[1] || null };
  }
  return null;
}

// A collection is a saved query, so its home folder is read off the query rather than invented:
// `data/guests/**` → `data/guests`. Everything up to the first wildcard segment.
export function dirForCollection(collection) {
  const glob = String((collection.query && collection.query.path) || '');
  if (glob) {
    const kept = [];
    for (const seg of glob.split('/')) { if (seg.includes('*')) break; kept.push(seg); }
    if (kept.length) return kept.join('/');
  }
  return 'data/' + collection.id;
}

// ── the gate ───────────────────────────────────────────────────────────────────────────────────

function gateInfo(collection) {
  const f = collection && gateField(collection);
  if (!f) return null;
  const options = (f.options || []).map(o => (typeof o === 'string' ? o : o && o.value)).filter(Boolean).map(String);
  if (!options.length) return null;
  const max = options.indexOf(AGENT_MAX_STAGE);
  // A collection with no `shortlist` option has no mapping for AGENT_MAX_STAGE. The safe reading of
  // "an agent may carry a record as far as shortlist" is then the FIRST stage, never the last.
  return { key: f.key, options, maxIndex: max >= 0 ? max : 0, first: options[0] };
}

const stageIndex = (gate, value) => gate.options.indexOf(String(value ?? ''));

// An unknown value is not "past" anything — it is a typo, and the schema, not the gate, is what
// catches it. Refusing it here would report a spelling mistake as a permissions violation.
function pastGate(gate, value) {
  const i = stageIndex(gate, value);
  return i >= 0 && i > gate.maxIndex;
}

// ── quarantine (§3.3) ──────────────────────────────────────────────────────────────────────────
// The one predicate. `views.mjs`, `documents.mjs` and `territory.mjs` must call THIS to satisfy
// "excluded from every count, view, rollup and territory score" — a second copy of the rule is how
// a quarantined record starts counting again in one surface and not another.

// DEVIATION FROM §3.3, recorded deliberately. The contract says a file under `data/` is quarantined
// when it has "no `created_by`, OR was written by an agent without passing through upsertRecord".
// The first half is implemented as AGENT-TOUCHED rather than UNATTRIBUTED, because taken literally
// it contradicts two documents that outrank it and breaks the app in an ordinary case:
//   · `GOAL.md` gate 4 and Law 4 both scope quarantine to the AGENT — "an agent … writing directly
//     into data/". T08 step 3 says "created directly under data/ BY AN AGENT". Only §3.3 widens it.
//   · Law 1 promises a person can open the folder in Finder or Obsidian and work in it. A note a
//     human types by hand has no `created_by` and never will, so the literal rule makes every
//     hand-authored record invisible in every view — which is the opposite of Law 8, and it blanked
//     two M1 tests and all 22 seeded records the moment the exclusion was wired into the view route.
// An agent that omits its own attribution still evades this, and nothing in a file can prove it did
// not. What closes that is `provenance: pipeline` being present on everything the pipeline writes —
// so the seeded workspace should carry it too (it currently does not; see the handover note).
export function isQuarantined(data = {}, relPath = '') {
  if (data.quarantined === true) return true;
  if (data.quarantined === false) return false;   // a human accepted it; frontmatter is the truth
  const p = String(relPath || '').split(path.sep).join('/');
  if (!p.startsWith('data/')) return false;       // only the record store is gated
  if (p.startsWith('data/_archive/')) return false;
  if (data.provenance === 'pipeline') return false;
  // AGENT-TOUCHED, not merely unattributed — see the note above. `updated_by` is in the test on
  // purpose: an agent editing a file a human created is still an agent writing into data/ without
  // passing the border, and that is the case the `created_by` half alone would miss.
  const touched_by = [data.created_by, data.updated_by].filter(Boolean).map(String);
  return touched_by.some(isAgentActor);
}

export function excludeQuarantined(docs = []) {
  return docs.filter(d => !isQuarantined(d.fields || d.data || {}, d.path || ''));
}

// The rule above is computed, but the EXCLUSION has to be honoured by modules that never call into
// this one — `territory.mjs`, `documents.mjs` and every view read plain frontmatter. A flag that
// existed only inside records.mjs would leave a rogue file counted everywhere except here, which is
// the failure §3.3 exists to prevent. So the first time the pipeline sees one it WRITES
// `quarantined: true` into the file: additive, nothing else touched, and `updated`/`updated_by`
// deliberately left alone so the mark never falsifies the record's own provenance.
function markQuarantine(relPath) {
  try {
    const abs = absOf(relPath);
    const { data, content } = readMd(abs);
    if (data.quarantined !== undefined) return false;
    writeMd(abs, { ...data, quarantined: true }, content);
    return true;
  } catch { return false; }   // a read-only vault still reads — the mark is a convenience, not the rule
}

function noteQuarantine(relPath, data) {
  logOnce(R() + '|quarantine:' + relPath, {
    type: 'quarantine', actor: String(data.created_by || 'unknown'), target: relPath,
    detail: { reason: data.created_by ? 'written under data/ without passing through the pipeline' : 'no created_by' },
  }, () => true);
}

// Mark and announce every record that arrived outside the pipeline. Idempotent and cheap once the
// flags are on disk, so it is safe on boot, after an inbox sweep, or on any pass over a collection.
export function sweepQuarantine(docs = null) {
  const marked = [];
  for (const doc of docs || allDocuments()) {
    const data = doc.data || doc.fields || {};
    if (!isQuarantined(data, doc.path)) continue;
    if (markQuarantine(doc.path)) marked.push(doc.path);
    noteQuarantine(doc.path, data);
  }
  return marked;
}

// ── logging helpers ────────────────────────────────────────────────────────────────────────────
// Some events must appear exactly once however many times the record is read — a `refused` line
// per page render would bury the day's real work under one file's violation.

const onceKeys = new Set();
// `key` never reaches the file: it carries the storage root so two roots in one process (the tests,
// and a workspace switch) cannot silence each other, and an absolute machine path has no business
// in a log that travels with the vault. Across a restart the day's own lines are the memory, which
// is what `seen` re-reads.
function logOnce(key, ev, seen) {
  if (onceKeys.has(key)) return null;
  onceKeys.add(key);
  if (readEvents({ limit: 500, target: ev.target, type: ev.type }).some(seen)) return null;
  return emit(ev);
}

function refuse(message, { actor, target, ...detail }) {
  emit({ type: 'refused', actor, target, detail: { ...detail, error: message } });
  return new RecordError(message, 403);
}

// ── near-match (T06 step 2) ────────────────────────────────────────────────────────────────────
// Scores are the contract's: same handle 95 · same source url 90 · exact name 85 · contained name
// 65 · trigram overlap below all of them. The confidence is the STRONGEST signal, not a sum: two
// weak agreements are still weak, and a caller reading `confidence: 95` has to be able to point at
// the one fact that earned it. `why` lists every signal that fired.

const normName = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const normHandle = (s) => String(s || '')
  .toLowerCase().trim()
  .replace(/^https?:\/\/(www\.)?[^/]+\//, '')
  .replace(/^@+/, '')
  .replace(/\/+$/, '');

const normUrl = (s) => String(s || '')
  .toLowerCase().trim()
  .replace(/^https?:\/\//, '').replace(/^www\./, '')
  .replace(/[?#].*$/, '').replace(/\/+$/, '');

function trigrams(s) {
  const padded = '  ' + s + '  ';
  const out = new Set();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function dice(a, b) {
  if (!a || !b) return 0;
  const A = trigrams(a), B = trigrams(b);
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return (2 * shared) / (A.size + B.size);
}

const HANDLE_KEYS = ['handle', 'username', 'account'];
// `source` is deliberately NOT here. It is the URL the agent actually SAW — a post permalink —
// and `skills/scout-router/SKILL.md` makes it mandatory on every finding, so two people commenting
// in one thread legitimately share it. Scored as identity it hit 90 with no contradiction term, so
// four distinct names with four distinct handles found on one page came back {store: 1, skip: 3}:
// three real findings discarded, at confidence 90, with the log line naming only the record they
// were folded into and never the candidate that was lost. `api-mode.md` tells the agent skip means
// "already known — do not try again", so it never resubmits them.
// A profile URL identifies a person. A permalink identifies a place.
const URL_KEYS = ['url', 'link', 'profile'];

const firstOf = (obj, keys) => { for (const k of keys) if (obj[k]) return obj[k]; return ''; };

function scorePair(candidate, row) {
  const signals = [];
  const cHandle = normHandle(firstOf(candidate, HANDLE_KEYS));
  const rHandle = normHandle(firstOf(row, HANDLE_KEYS));
  if (cHandle && cHandle === rHandle) signals.push([95, 'same handle @' + rHandle]);

  const cUrl = normUrl(firstOf(candidate, URL_KEYS));
  const rUrl = normUrl(firstOf(row, URL_KEYS));
  if (cUrl && cUrl === rUrl) signals.push([90, 'same source url']);

  const cName = normName(candidate.__title);
  const rName = normName(row.__title);
  if (cName && cName === rName) {
    signals.push([85, 'exact name']);
  } else if (cName && rName) {
    const long = cName.length >= rName.length ? cName : rName;
    const short = cName.length >= rName.length ? rName : cName;
    // Word-boundary containment only, and never on a fragment so short it matches half the store.
    if (short.length >= 5 && new RegExp('(^| )' + short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(long)) {
      signals.push([65, 'name contained in "' + long + '"']);
    }
    const d = dice(cName, rName);
    if (d > 0.4) signals.push([Math.round(d * 60), Math.round(d * 100) + '% name overlap']);
  }
  if (!signals.length) return null;
  signals.sort((a, b) => b[0] - a[0]);
  return { confidence: signals[0][0], why: signals.map(s => s[1]).join(' · ') };
}

// The candidate set for one collection, loaded once so a batch pays for it once (T06 step 4).
// Archived and quarantined records are NOT merge targets: merging a live finding into a quarantined
// file would make the finding disappear too, and merging into an archived one would silently
// resurrect something a human rejected with a reason.
function candidateRows(collectionId) {
  assertWorkerCollectionAccess(collectionId);
  // Scoped workers never invoke the owner's derived view resolver: a rollup can otherwise
  // reveal a finance total even when the matching finance documents are filtered afterward.
  if (currentWorkerIdentity()) {
    const collection = getCollection(collectionId);
    if (!collection) throw new RecordError('no collection "' + collectionId + '"', 404);
    const rows = allDocuments().filter(d => matchesQuery(d, collection.query))
      .filter(d => workerCanReadDocument(d, collection) && !d.data.archived && !isQuarantined(d.data, d.path))
      .map(d => {
        const projected = projectWorkerDocument(d, collection);
        const title = projected.data[primaryField(collection)?.key || 'name'] || d.slug;
        return { id: d.slug, path: d.path, title, __title: title, ...projected.data };
      });
    return { collection, rows };
  }
  const found = documentsFor(collectionId);
  if (!found) throw new RecordError('no collection "' + collectionId + '"', 404);
  sweepQuarantine(found.documents.map(d => ({ path: d.path, data: d.fields })));
  const rows = found.documents
    .filter(d => d.fields.archived !== true)
    .filter(d => !isQuarantined(d.fields, d.path))
    .map(d => ({ id: d.slug, path: d.path, title: d.title, __title: d.title, ...d.fields }));
  return { collection: found.collection, rows };
}

function matchAgainst(candidate, rows) {
  const out = [];
  for (const row of rows) {
    const s = scorePair(candidate, row);
    if (s) out.push({ id: row.id, path: row.path, title: row.title, confidence: s.confidence, why: s.why });
  }
  return out.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}

export function nearMatches(candidate = {}, { collection = null } = {}) {
  const id = collection || candidate.collection;
  if (!id) throw new RecordError('nearMatches needs a collection', 400);
  const { collection: schema, rows } = candidateRows(id);
  const prim = primaryField(schema);
  const shaped = { ...candidate, __title: (prim && candidate[prim.key]) || candidate.name || candidate.title || '' };
  return matchAgainst(shaped, rows);
}

// ── frontmatter shaping ────────────────────────────────────────────────────────────────────────

function orderFrontmatter(collection, data) {
  const declared = (collection.fields || []).map(f => f.key);
  const tail = ['created', 'updated', 'created_by', 'updated_by', 'verified_at', 'proposed', 'quarantined',
    'provenance', 'archived', 'archived_at', 'archived_by', 'archive_reason', 'archived_from', 'history'];
  const seen = new Set();
  const out = {};
  for (const k of [...declared, ...Object.keys(data).filter(k => !declared.includes(k) && !tail.includes(k)), ...tail]) {
    if (seen.has(k) || data[k] === undefined) continue;
    seen.add(k);
    out[k] = data[k];
  }
  return out;
}

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

// Additive merge: fill the empty, union the arrays, never overwrite. See the header.
function mergeInto(existing, incoming) {
  const next = { ...existing };
  const changed = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (isEmpty(v)) continue;
    const cur = next[k];
    if (Array.isArray(v) || Array.isArray(cur)) {
      const before = [].concat(cur ?? []).filter(x => !isEmpty(x));
      const add = [].concat(v).filter(x => !before.some(y => String(y) === String(x)));
      if (add.length) { next[k] = [...before, ...add]; changed.push(k); }
      continue;
    }
    if (isEmpty(cur)) { next[k] = v; changed.push(k); }
  }
  return { next, changed };
}

// A body is never replaced either — an unseen paragraph is appended, a seen one is a no-op.
function mergeBody(existing, incoming) {
  const add = String(incoming || '').trim();
  if (!add) return { body: existing, changed: false };
  const cur = String(existing || '').trim();
  if (!cur) return { body: add + '\n', changed: true };
  if (cur.includes(add)) return { body: existing, changed: false };
  return { body: cur + '\n\n' + add + '\n', changed: true };
}

function cleanInput(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (INPUT_CONTROL_FIELDS.has(k) || PIPELINE_FIELDS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

// ── a found record becomes a decision ──────────────────────────────────────────────────────────
//
// GOAL.md §3 opens the day with "six things need her", and the FIRST of the six is "a found guest".
// DECIDE and TODAY's NEEDS YOU count proposal cards and nothing else, so forty overnight finds read
// as `NEEDS YOU: 0` while forty files sit in `data/` marked `proposed: true` that nobody is ever
// shown. An agent posting a separate finding card by hand closed the gap for the agents that knew
// to; the ones that followed the router skill's write step did not, and the loop the whole product
// exists for silently did not run.
//
// So a `store` by an agent raises the card here — one place, whichever door the write came through.
// Only `store`: `update`/`merge` land on a record the human has already been shown, and `skip`
// wrote nothing at all. Only when no OPEN finding card already points at that record — `record`, and
// never `path`, which is the CARD's own file (docs/decisions.md D7).
//
// A card that cannot be raised NEVER fails the write. The record is on disk and in the log; the
// card is derived from it, and losing a derived thing must not lose the finding.
export function openFindingRecords() {
  try {
    return new Set(listProposals({ status: 'open', kind: 'finding' }).map(c => String(c.record || '')).filter(Boolean));
  } catch { return new Set(); }
}

function raiseFindingCard(input, { actor, collection, relPath, title, seen: given }) {
  try {
    // The batch reads the open queue once and passes the set down. A lone caller that did not gets
    // it read here rather than skipping the check — a duplicate card is a chore for a person.
    const seen = given || openFindingRecords();
    if (seen.has(relPath)) return null;
    const found_in = input.found_in ?? input.territory ?? null;
    const score = input.score ?? null;
    const source = input.source ?? input.url ?? null;
    // `why` is mandatory on a card and the agent contract makes it mandatory on a finding too. When
    // one arrives without it the card still has to exist — an unexplained find is exactly the thing
    // a human should be shown — so the card says so rather than inventing a reason.
    const why = String(input.why || '').trim()
      || 'The assistant did not say why. Open the record before deciding.';
    const card = proposeCard({
      kind: 'finding',
      record: relPath,
      collection: collection.id,
      title: String(title),
      why,
      ...(found_in ? { territory: found_in } : {}),
      ...(score === null || score === '' ? {} : { score }),
      ...(source ? { source_url: source } : {}),
      // Altitude 3 is the document itself, which is the best evidence there is.
      evidence: ['[[' + relPath.replace(/\.md$/, '') + ']]'],
    }, { actor });
    seen.add(relPath);
    return card;
  } catch { return null; }
}

// ── the four verbs ─────────────────────────────────────────────────────────────────────────────

function upsertOne(input, { actor, via, rows, collection, openFindings = null, workTransition = null }) {
  const agent = isAgentActor(actor);
  const gate = gateInfo(collection);
  const prim = primaryField(collection);
  const primKey = (prim && prim.key) || 'name';
  const title = input[primKey] || input.name || input.title;
  if (!title) throw new RecordError('a record needs a ' + primKey, 400);

  const fields = cleanInput(input);
  fields[primKey] = title;
  // A collection is a SAVED QUERY (`docs/02_DATA_MODEL.md` §1), and the shipped `guest` collection
  // queries `tag: guest` AND `path: data/guests/**`. `dirForCollection` satisfied the path half and
  // nothing satisfied the tag half — so a record this function had just written did not match the
  // collection that defines it, and the consequences were total rather than cosmetic:
  //
  //   · it was invisible — no table, no board, no DECIDE queue, and absent from the hot cache counts
  //   · dedupe was DEAD, because `candidateRows` never saw it: the same person resubmitted came back
  //     `store` again and `writeMd` replaced a human's corrections wholesale, reported as success
  //   · **the gate failed open** — `collectionOf` returned null, so there was no gate field to
  //     guard, and an agent PATCHed `status: won` to HTTP 200 with `agentPromotion: false`
  //
  // The tests missed it because their fixtures declare `path` and no `tag`; the defect existed only
  // on the shipped schema, which is the one every demonstration runs against.
  const wantTags = [].concat(collection?.query?.tag ?? []).map(String).filter(Boolean);
  if (wantTags.length) {
    const have = [].concat(fields.tags ?? []).map(String);
    fields.tags = [...new Set([...have, ...wantTags])];
  }

  // Gate, enforcement 1 — on write.
  if (gate && input[gate.key] !== undefined && agent && pastGate(gate, input[gate.key])) {
    throw refuse('an agent may not write ' + gate.key + ' past "' + AGENT_MAX_STAGE + '"',
      { actor, target: dirForCollection(collection) + '/' + slugify(String(input.id || title)) + '.md', to: String(input[gate.key]), max: AGENT_MAX_STAGE, via });
  }

  const slug = slugify(input.id || title);
  const dir = dirForCollection(collection);
  const directPath = dir + '/' + slug + '.md';
  refuseDecisionControlWrite(directPath);
  assertWorkerRecordAccess({ actor, path: directPath, collection, data: fields, operation: 'write' });
  // A hidden file with the same slug is not a new record and must never be overwritten.
  if (currentWorkerIdentity() && fs.existsSync(absOf(directPath))) {
    const existing = readMd(absOf(directPath));
    assertWorkerRecordAccess({ actor, path: directPath, collection, data: existing.data, operation: 'write' });
  }
  const now = new Date().toISOString().slice(0, 10);

  // Identity first, near-match second. A record submitted under the same name resolves to the same
  // file directly — that is an `update`. `merge` is reserved for the fuzzy case, so the verdict
  // tells the reader HOW the record was identified, which is the thing they would ask next.
  const direct = rows.find(r => r.path === directPath) || null;
  // Work and reviews are occurrences, not named entities: "Follow up: campaign" must not
  // merge back into "campaign", and two dated reviews may have almost identical titles.
  // Their explicit IDs are identity; they still pass through this writer and its gate/log.
  const occurrence = input.id && ['work', 'review', 'delivery', 'paperclip-result'].includes(collection.id);
  const matches = direct || occurrence ? [] : matchAgainst({ ...fields, __title: title }, rows);
  const best = matches.length && matches[0].confidence >= MERGE_CONFIDENCE ? matches[0] : null;
  const target = direct || (best ? rows.find(r => r.path === best.path) : null);
  if (target) refuseDecisionControlWrite(target.path);
  checkWorkTransition(collection, input.status, target?.status, workTransition);

  if (!target) {
    const data = orderFrontmatter(collection, {
      ...fields,
      ...(gate ? { [gate.key]: agent ? gate.first : (input[gate.key] ?? gate.first) } : {}),
      created: now, updated: now, created_by: actor, updated_by: actor, verified_at: now,
      // T06 step 6: everything an agent writes lands `proposed: true`, in the first stage.
      ...(agent ? { proposed: true } : {}),
      provenance: 'pipeline',
    });
    const abs = absOf(directPath);
    writeMd(abs, data, String(input.body || input.content || '').trim() ? String(input.body || input.content).trim() + '\n' : '');
    const result = { verdict: 'store', id: slug, path: directPath, confidence: matches.length ? matches[0].confidence : 0 };
    emit({ type: 'store', actor, target: directPath, detail: { collection: collection.id, via, confidence: result.confidence } });
    // What an agent found lands in front of the human as one card, not only as a file (GOAL §3).
    // Only for collections that HAVE a gate — findings are the pipeline's vocabulary. A status
    // collection like `work` (plan items, not findings) would otherwise earn a 'proposed' card for
    // every item the conductor creates, since the write stamps proposed:true.
    if (agent && gate) {
      const card = raiseFindingCard(input, { actor, collection, relPath: directPath, title, seen: openFindings });
      if (card) result.card = card.id;
    }
    touched();
    rows.push({ id: slug, path: directPath, title, __title: title, ...data });   // visible to the rest of the batch
    return result;
  }

  const abs = absOf(target.path);
  const { data: onDisk, content: bodyOnDisk } = readMd(abs);
  assertWorkerRecordAccess({ actor, path: target.path, collection, data: onDisk, operation: 'write' });
  const { next, changed } = mergeInto(onDisk, fields);
  const merged = mergeBody(bodyOnDisk, input.body || input.content);
  const verdict = changed.length || merged.changed ? (direct ? 'update' : 'merge') : 'skip';
  const confidence = direct ? 100 : (best ? best.confidence : 0);

  if (verdict === 'skip') {
    // Nothing new to add, so nothing is written — the sighting itself is the log line.
    emit({ type: 'skip', actor, target: target.path, detail: { collection: collection.id, via, confidence, matched: target.id } });
    return { verdict, id: target.id, path: target.path, matched: target.id, confidence, changed: [] };
  }

  const data = orderFrontmatter(collection, {
    ...next,
    // Repair on touch: a record written before the tag was stamped rejoins its collection the next
    // time anything updates it, rather than staying invisible until somebody notices.
    ...(wantTags.length ? { tags: [...new Set([...[].concat(next.tags ?? []).map(String), ...wantTags])] } : {}),
    updated: now, updated_by: actor, verified_at: now,
    provenance: next.provenance || 'pipeline',
    ...(agent ? { proposed: next.proposed === false ? false : true } : { proposed: false }),
  });
  writeMd(abs, data, merged.body || '');
  const result = { verdict, id: target.id, path: target.path, matched: target.id, confidence, changed: [...changed, ...(merged.changed ? ['body'] : [])] };
  emit({ type: verdict, actor, target: target.path, detail: { collection: collection.id, via, confidence, changed: result.changed } });
  touched();
  Object.assign(rows.find(r => r.path === target.path), data);
  return result;
}

export function upsertRecord(input = {}, { actor = DEFAULT_ACTOR, via = 'api', workTransition = null } = {}) {
  const collectionId = input.collection;
  if (!collectionId) throw new RecordError('upsert needs a collection', 400);
  assertWorkerCollectionAccess(collectionId, { actor, operation: 'write' });
  const { collection, rows } = candidateRows(collectionId);
  return upsertOne(input, { actor, via, rows, collection, workTransition, openFindings: isAgentActor(actor) ? openFindingRecords() : null });
}

// ONE near-match pass for the batch (T06 step 4): the candidate set is loaded once and each stored
// record joins it, so a batch that contains the same person twice dedupes against itself.
export function batchUpsert(items = [], { actor = DEFAULT_ACTOR, via = 'api', workTransition = null } = {}) {
  const list = [].concat(items || []);
  if (!list.length) return { tally: { store: 0, update: 0, merge: 0, skip: 0 }, results: [] };
  const byCollection = new Map();
  const tally = { store: 0, update: 0, merge: 0, skip: 0 };
  const results = [];
  // ONE read of the open queue for the batch, for the same reason there is one near-match pass:
  // fifty findings must not cost fifty full scans of `proposals/`. Cards raised along the way join
  // the set, so a batch carrying the same person twice raises one card.
  const openFindings = isAgentActor(actor) ? openFindingRecords() : null;
  for (const item of list) {
    const id = item && item.collection;
    try {
      if (!id) throw new RecordError('every item needs a collection', 400);
      assertWorkerCollectionAccess(id, { actor, operation: 'write' });
      if (!byCollection.has(id)) byCollection.set(id, candidateRows(id));
      const { collection, rows } = byCollection.get(id);
      const r = upsertOne(item, { actor, via, rows, collection, openFindings, workTransition });
      tally[r.verdict] = (tally[r.verdict] || 0) + 1;
      results.push(r);
    } catch (e) {
      // One bad item never costs the other forty-nine — the batch reports it and carries on.
      results.push({ verdict: 'refused', error: e.message, status: e.status || 400, id: item && (item.id || item.name) });
    }
  }
  return { tally, results };
}

// ── move · archive · accept · patch ────────────────────────────────────────────────────────────

function collectionOf(relPath, data, content = '') {
  const doc = { path: relPath, slug: path.basename(relPath, '.md'), data, content };
  return listCollections().find(c => matchesQuery(doc, c.query)) || null;
}

function loadDoc(relPath) {
  const abs = absOf(relPath);
  if (!fs.existsSync(abs)) throw new RecordError('no record at ' + relPath, 404);
  const { data, content } = readMd(abs);
  return { abs, path: rel(abs), data, content };
}

// `loadDoc` is happy to open any `.md` in the store, which is right for reading and wrong for the
// two verbs that RELOCATE a file. Named per verb so the sentence tells the caller what to do
// instead, and logged as `refused` like every other border refusal so the attempt is in Activity.
function refuseOutsideData(relPath, verb, actor) {
  if (isRecordPath(relPath)) return;
  throw refuse('only records under ' + RECORD_ROOT + ' can be ' + verb
    + ' — "' + relPath + '" is memory, and memory is edited where it lives',
  { actor, target: String(relPath), verb });
}

export function moveRecord(relPath, { to, actor = DEFAULT_ACTOR, reason = null } = {}) {
  const doc = loadDoc(relPath);
  refuseDecisionControlWrite(doc.path);
  const collection = collectionOf(doc.path, doc.data, doc.content);
  assertWorkerRecordAccess({ actor, path: doc.path, collection, data: doc.data, operation: 'write' });
  const gate = gateInfo(collection);
  if (!gate) throw new RecordError('that record is in no collection with a gate field', 400);
  if (stageIndex(gate, to) < 0) throw new RecordError('"' + to + '" is not one of ' + gate.options.join(' · '), 400);

  const agent = isAgentActor(actor);
  if (agent && pastGate(gate, to)) {
    // Gate, enforcement 1 — on write. 403, and the attempt is in Activity (T08 step 1).
    throw refuse('an agent may not promote past "' + AGENT_MAX_STAGE + '"',
      { actor, target: doc.path, from: String(doc.data[gate.key] ?? ''), to: String(to), max: AGENT_MAX_STAGE });
  }
  // Law 5 has one door, not two: reaching `archived` by moving the status would otherwise dodge the
  // mandatory reason that `archiveRecord` enforces.
  if (String(to) === 'archived' && !ARCHIVE_REASONS.includes(String(reason))) {
    throw new RecordError('archiving needs a reason — one of ' + ARCHIVE_REASONS.join(' · '), 400, { reasons: ARCHIVE_REASONS });
  }

  const from = doc.data[gate.key] ?? null;
  const now = new Date().toISOString().slice(0, 10);
  const data = orderFrontmatter(collection, {
    ...doc.data, [gate.key]: to, updated: now, updated_by: actor, verified_at: now,
    ...(agent ? {} : { proposed: false }),   // a human touching it IS the disposal
  });
  writeMd(doc.abs, data, doc.content);
  emit({ type: 'move', actor, target: doc.path, detail: { field: gate.key, from, to, reason: reason || undefined } });
  touched();
  return { path: doc.path, from, to };
}

// NEVER DELETES. Writes the destination, reads it back, and only then releases the old path.
export function archiveRecord(relPath, { reason, actor = DEFAULT_ACTOR } = {}) {
  if (!ARCHIVE_REASONS.includes(String(reason))) {
    throw new RecordError('archive needs a reason — one of ' + ARCHIVE_REASONS.join(' · '), 400, { reasons: ARCHIVE_REASONS });
  }
  const doc = loadDoc(relPath);
  if (doc.path.startsWith('data/_archive/')) throw new RecordError('that record is already archived', 400);
  // Archiving MOVES the file into `data/_archive/`. Pointed at a memory object it therefore moves
  // identity, a goal or a territory out of the workspace and into the record store — reproduced:
  // `POST /api/records/archive {path:'me.md', reason:'bad-data', actor:'scout-fb'}` answered 200 and
  // `me.md` was gone. Memory is retired through its own module (`status: retired`), never archived
  // as a record, and nothing on this door may take a file out from under Law 1.
  refuseOutsideData(doc.path, 'archived', actor);
  const collection = collectionOf(doc.path, doc.data, doc.content);
  const bucket = (collection && collection.id) || doc.path.split('/')[1] || 'record';
  assertWorkerRecordAccess({ actor, path: doc.path, collection, data: doc.data, operation: 'write' });
  const dest = 'data/_archive/' + bucket + '/' + path.basename(doc.path);
  const destAbs = absOf(dest);
  if (fs.existsSync(destAbs)) throw new RecordError('an archived record already exists at ' + dest, 409);

  const now = new Date().toISOString();
  const history = [].concat(doc.data.history || []);
  history.push({ at: now, by: actor, action: 'archive', reason: String(reason), from: doc.path });
  const gate = gateInfo(collection);
  const data = orderFrontmatter(collection || { fields: [] }, {
    ...doc.data,
    ...(gate && gate.options.includes('archived') ? { [gate.key]: 'archived' } : {}),
    updated: now.slice(0, 10), updated_by: actor,
    archived: true, archived_at: now, archived_by: actor, archive_reason: String(reason),
    archived_from: doc.path, history,
  });
  writeMd(destAbs, data, doc.content);
  // Read it back before releasing the original. A move that lost the destination to a bad write
  // would otherwise be indistinguishable from a delete, which Law 5 does not allow to exist.
  const check = readMd(destAbs);
  if (check.data.archive_reason !== String(reason)) throw new RecordError('archive did not land — the original is untouched', 500);
  fs.unlinkSync(doc.abs);
  emit({ type: 'archive', actor, target: doc.path, detail: { reason: String(reason), to: dest } });
  touched();
  return { path: dest, from: doc.path, reason: String(reason) };
}

// The human end of quarantine: the record starts counting from here (§3.3).
export function acceptRecord(relPath, { actor = DEFAULT_ACTOR } = {}) {
  if (isAgentActor(actor)) throw refuse('only a human accepts a quarantined record', { actor, target: String(relPath) });
  const doc = loadDoc(relPath);
  // Quarantine only exists under `data/` (`isQuarantined` returns false everywhere else), so
  // "accepting" a memory object would write a `quarantined: false` that answered no question.
  refuseOutsideData(doc.path, 'accepted', actor);
  const collection = collectionOf(doc.path, doc.data, doc.content);
  const now = new Date().toISOString();
  const history = [].concat(doc.data.history || []);
  history.push({ at: now, by: actor, action: 'accept' });
  const data = orderFrontmatter(collection || { fields: [] }, {
    ...doc.data,
    quarantined: false, provenance: doc.data.provenance || 'accepted',
    created_by: doc.data.created_by || actor,
    updated: now.slice(0, 10), updated_by: actor, history,
  });
  writeMd(doc.abs, data, doc.content);
  emit({ type: 'accept', actor, target: doc.path, detail: { was: 'quarantined' } });
  touched();
  return readRecord(doc.path);
}

// What the delegate is handed. The document surface sends `{ patch: { …fields, body }, rev, actor }`
// and the agent doors send the fields flat; `body` travels INSIDE the patch, which is where every
// memory writer reads it from too. Control keys are dropped — `id` is the file's own slug and
// `collection` means nothing to a memory object — and so are the four fields every writer stamps
// itself, because a surface echoing `updated_by` back would otherwise decide its own provenance.
const DELEGATE_DROP = new Set(['collection', 'id', 'path', 'content', 'actor', 'via', 'rev', 'type',
  'created', 'created_by', 'updated', 'updated_by']);
function delegatePatch(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (DELEGATE_DROP.has(k)) continue;
    out[k] = v;
  }
  if (patch && patch.body === undefined && patch.content !== undefined) out.body = String(patch.content);
  return out;
}

// The document surface's save, for anything that is NOT a record: `me.md`, a goal, a playbook claim,
// a learning, a territory. It is DELEGATED rather than reimplemented, which is the whole of the fix
// — the owning module already carries the refusal, the stripping, the log line and the cache bump,
// and every one of those was missing when this file wrote the bytes itself. The return shape is the
// surface's contract (`{ path, rev, data, content }`), read back off disk so it describes what
// actually landed rather than what was asked for.
async function patchDelegated(doc, patch, { actor, current, hit }) {
  const mod = await import(hit.mod);
  const fn = mod[hit.fn];
  if (typeof fn !== 'function') {
    throw new RecordError(hit.fn + '() is not available (expected in backend/' + hit.mod.slice(2) + ')', 501);
  }
  const clean = delegatePatch(patch);
  const body = clean.body;
  // Same rule as a record: a patch that changes nothing is not a write, or merely opening `me.md`
  // restamps `verified_at` and tells decay a person re-verified their identity by scrolling past it.
  const bodyChanged = body !== undefined && String(body) !== doc.content;
  const fieldKeys = Object.keys(clean).filter(k => k !== 'body');
  const same = fieldKeys.every(k => JSON.stringify(doc.data[k]) === JSON.stringify(clean[k]));
  if (same && !bodyChanged) {
    return { path: doc.path, rev: current, data: doc.data, content: doc.content, unchanged: true };
  }

  // `writeMe` is the one delegate whose body is an argument rather than a patch key.
  // Awaited: these are synchronous today, and a writer that becomes async later must not silently
  // start returning a promise the surface reads `data` off.
  if (hit.kind === 'identity') {
    const { body: b, ...data } = clean;
    await fn(b === undefined ? undefined : String(b), data, { actor });
  } else {
    await fn(hit.id, clean, { actor });
  }

  const after = readMd(doc.abs);
  const changed = fieldKeys.filter(k => JSON.stringify(doc.data[k]) !== JSON.stringify(after.data[k]));
  if (String(after.content) !== doc.content) changed.push('body');
  return {
    path: doc.path, rev: revOf(after.data, after.content),
    data: after.data, content: after.content,
    delegated: hit.kind, changed,
  };
}

// The document surface's save. Unlike ingest this OVERWRITES, on purpose — a human editing a field
// means it — and the rev check is what stops a concurrent agent write from being clobbered.
export async function patchRecord(relPath, patch = {}, { actor = DEFAULT_ACTOR, rev = null, workTransition = null } = {}) {
  const doc = loadDoc(relPath);
  refuseDecisionControlWrite(doc.path);
  const guardedCollection = collectionOf(doc.path, doc.data, doc.content);
  assertWorkerRecordAccess({ actor, path: doc.path, collection: guardedCollection, data: doc.data, operation: 'write' });
  assertWorkerRecordAccess({ actor, path: doc.path, collection: guardedCollection, data: { ...doc.data, ...cleanInput(patch) }, operation: 'write' });
  const current = revOf(doc.data, doc.content);
  // The rev check happens HERE for every path, delegated or not: no memory writer takes a `rev`,
  // and the conflict UX (T04) is a property of this door, not of the module behind it.
  if (rev != null && String(rev) !== current) {
    throw new RecordError('this record changed underneath you', 409, { rev: current, data: doc.data });
  }
  // Outside `data/` this file is not the writer. A memory object goes to its own module — which is
  // what makes an agent's PATCH of `me.md` refuse with the same 403 sentence `PUT /api/me` uses,
  // instead of succeeding because a file in no collection has no gate to enforce.
  const hit = isRecordPath(doc.path) ? null : delegateFor(doc.path);
  if (hit) {
    const out = await patchDelegated(doc, patch, { actor, current, hit });
    // No `emit` here on purpose. The owning module already wrote the log line for its own object,
    // and docs/08 §1 has one append point: a second line from this door would show one edit twice.
    if (!out.unchanged) touched();
    return out;
  }
  const collection = collectionOf(doc.path, doc.data, doc.content);
  checkWorkTransition(collection, patch.status, doc.data.status, workTransition);
  const gate = gateInfo(collection);
  const agent = isAgentActor(actor);
  if (gate && patch[gate.key] !== undefined && agent && pastGate(gate, patch[gate.key])) {
    throw refuse('an agent may not write ' + gate.key + ' past "' + AGENT_MAX_STAGE + '"',
      { actor, target: doc.path, to: String(patch[gate.key]), max: AGENT_MAX_STAGE });
  }
  const body = patch.body !== undefined ? String(patch.body) : (patch.content !== undefined ? String(patch.content) : doc.content);

  // A PATCH THAT CHANGES NOTHING IS NOT A WRITE.
  //
  // Without this, any surface that re-sent the value it was given — a controlled input echoing on
  // mount, an editor adopting the text it was just handed — rewrote `updated`, `updated_by` and
  // `verified_at` and logged an `update` with `changed: []`. Merely OPENING a record reassigned
  // its provenance from the assistant that found it to the human who looked at it, which is the
  // exact field Law 4 reads to ignore an agent-authored promotion, and the exact field decay reads
  // to decide what is stale. One afternoon of that and the memory is telling the agent that
  // everything was re-verified today by a person who only scrolled past it.
  //
  // A caller that genuinely means "I checked this and it still holds" has a verb for it —
  // `verified_at` is settable in the patch, and setting it is then a real change.
  const proposed = cleanInput(patch);
  const same = Object.keys(proposed).every(k => JSON.stringify(doc.data[k]) === JSON.stringify(proposed[k]));
  if (same && body === doc.content) {
    return { path: doc.path, rev: current, data: doc.data, content: doc.content, unchanged: true };
  }

  const now = new Date().toISOString().slice(0, 10);
  const data = orderFrontmatter(collection || { fields: [] }, {
    ...doc.data, ...cleanInput(patch),
    updated: now, updated_by: actor, verified_at: now,
    ...(agent ? {} : { proposed: false }),
  });
  writeMd(doc.abs, data, body);
  const changed = Object.keys(proposed).filter(k => JSON.stringify(doc.data[k]) !== JSON.stringify(proposed[k]));
  if (body !== doc.content) changed.push('body');
  emit({ type: 'update', actor, target: doc.path, detail: { changed, via: 'surface' } });
  touched();
  return { path: doc.path, rev: revOf(data, body), data, content: body };
}

// ── reading, and the other two halves of the gate ──────────────────────────────────────────────
// `decay.mjs` is M3 and owned elsewhere. It is bound when it lands rather than reimplemented here:
// CLAUDE.md's rule is that one function decides staleness for every object type, and a local
// `Date.now() - verified_at` in this file would be the second one.
let decayMod = null;
import('./decay.mjs').then(m => { decayMod = m; }).catch(() => { /* M3 has not landed yet */ });

export function readRecord(relPath) {
  const doc = loadDoc(relPath);
  const collection = collectionOf(doc.path, doc.data, doc.content);
  assertWorkerRecordAccess({ path: doc.path, collection, data: doc.data });
  const gate = gateInfo(collection);
  const data = { ...doc.data };
  const flags = {
    quarantined: isQuarantined(doc.data, doc.path),
    agentPromotion: false,
    staleness: decayMod ? decayMod.staleness(doc.data) : null,
  };

  // Gate, enforcement 2 — on read. The file keeps saying `contacted`; the app does not.
  if (gate && pastGate(gate, doc.data[gate.key]) && isAgentActor(doc.data.updated_by)) {
    const wrote = String(doc.data[gate.key]);
    const shown = gate.options[gate.maxIndex];
    data[gate.key] = shown;
    flags.agentPromotion = true;
    flags.promotionIgnored = { field: gate.key, wrote, shown, by: doc.data.updated_by };
    logOnce(R() + '|promotion:' + doc.path + ':' + wrote, {
      type: 'refused', actor: String(doc.data.updated_by), target: doc.path,
      detail: { field: gate.key, wrote, shown, reason: 'agent-authored stage past ' + AGENT_MAX_STAGE + ' — ignored on read' },
    }, e => e.detail && e.detail.wrote === wrote);
  }

  // Gate, enforcement 3 — on scan. Visible and marked, counted nowhere.
  if (flags.quarantined) {
    markQuarantine(doc.path);
    noteQuarantine(doc.path, doc.data);
  }

  return {
    path: doc.path, data: currentWorkerIdentity() ? projectWorkerDocument({ ...doc, data }, collection).data : data,
    content: doc.content, rev: revOf(doc.data, doc.content), flags,
    collection: collection ? collection.id : null,
    // What KIND of file this is when it is not a record — identity, goal, territory… — so the
    // document surface can label it instead of borrowing the rail's collection (docs/05 §2.1).
    kind: kindOf(doc.path),
    raw: flags.agentPromotion && !currentWorkerIdentity() ? doc.data : undefined,
  };
}

// The count surface records.mjs owns. `total` EXCLUDES quarantined records, which is the whole
// point of §3.3 — they are listed separately so they are visible without being counted.
export function listRecords(collectionId) {
  assertWorkerCollectionAccess(collectionId);
  if (currentWorkerIdentity()) {
    const collection = getCollection(collectionId);
    if (!collection) throw new RecordError('no collection "' + collectionId + '"', 404);
    const rows = allDocuments().filter(d => matchesQuery(d, collection.query))
      .filter(d => workerCanReadDocument(d, collection) && !d.data.archived && !isQuarantined(d.data, d.path))
      .map(d => readRecord(d.path));
    return { collection: { id: collection.id, label: collection.label }, total: rows.length, rows, quarantined: [], scoped: true };
  }
  const found = documentsFor(collectionId);
  if (!found) throw new RecordError('no collection "' + collectionId + '"', 404);
  sweepQuarantine(found.documents.map(d => ({ path: d.path, data: d.fields })));
  const live = [], quarantined = [];
  for (const d of found.documents) (isQuarantined(d.fields, d.path) ? quarantined : live).push(d);
  return { collection: found.collection, total: live.length, rows: live, quarantined };
}

// ── routes (§3) ────────────────────────────────────────────────────────────────────────────────

// Exported because door 3 (backend/mcp.mjs) needs the same slug-or-path resolution the move
// and archive routes use. It was copied there while this stayed private, which is two
// implementations of "which file does this id mean" — and the copy would not have known
// about `data.id` if that rule ever changed.
export function resolveTarget(idOrPath) {
  const s = String(idOrPath || '');
  if (!s) throw new RecordError('a path is required', 400);
  if (s.endsWith('.md')) return s;
  const doc = allDocuments().find(d => (d.slug === s || String(d.data.id || '') === s)
    && workerCanReadDocument(d, collectionOf(d.path, d.data, d.content)));
  if (!doc) throw new RecordError('no record "' + s + '"', 404);
  return doc.path;
}

export function registerRecordRoutes(app, deps = {}) {
  // Both deps are optional — inbox.mjs and proposals.mjs call the verbs directly, with none.
  if (typeof deps.logEvent === 'function') emit = deps.logEvent;
  if (typeof deps.refreshAgentFiles === 'function') onMutation = deps.refreshAgentFiles;
  const actorOf = (req) => String(currentWorkerIdentity()?.actor || (req.body && req.body.actor) || req.query.actor || DEFAULT_ACTOR);
  const send = (res, e) => res.status(e.status || 400).json({
    error: e.message, ...(e.reasons ? { reasons: e.reasons } : {}), ...(e.rev ? { rev: e.rev } : {}),
  });

  app.post('/api/records/upsert', (req, res) => {
    try {
      const r = upsertRecord(req.body || {}, { actor: actorOf(req), via: (req.body && req.body.via) || 'api' });
      res.json(r);
    } catch (e) { send(res, e); }
  });

  app.post('/api/records/batch', (req, res) => {
    try {
      const items = (req.body && (req.body.items || req.body.records)) || (Array.isArray(req.body) ? req.body : []);
      const r = batchUpsert(items, { actor: actorOf(req), via: (req.body && req.body.via) || 'api' });
      res.json(r);
    } catch (e) { send(res, e); }
  });

  // Dry run. Writes nothing — no file, no log line (T06 step 5).
  app.post('/api/records/match', (req, res) => {
    try { res.json({ matches: nearMatches(req.body || {}, { collection: (req.body || {}).collection }) }); }
    catch (e) { send(res, e); }
  });

  const doMove = (req, res) => {
    try {
      const b = req.body || {};
      const r = moveRecord(resolveTarget(req.params.id || b.path || b.id), { to: b.to || b.stage, actor: actorOf(req), reason: b.reason });
      res.json(r);
    } catch (e) { send(res, e); }
  };
  app.post('/api/records/move', doMove);
  app.post('/api/records/:id/move', doMove);   // the path T08 and skills/scout-router document

  const doArchive = (req, res) => {
    try {
      const b = req.body || {};
      const r = archiveRecord(resolveTarget(req.params.id || b.path || b.id), { reason: b.reason, actor: actorOf(req) });
      res.json(r);
    } catch (e) { send(res, e); }
  };
  app.post('/api/records/archive', doArchive);
  app.post('/api/records/:id/archive', doArchive);

  app.post('/api/records/accept', (req, res) => {
    try {
      const b = req.body || {};
      res.json(acceptRecord(resolveTarget(b.path || b.id), { actor: actorOf(req) }));
    } catch (e) { send(res, e); }
  });

  // `patchRecord` is async because a memory object is written by the module that owns it, and that
  // module is imported lazily to keep the memory ↔ records edge off the load path.
  app.patch('/api/records', async (req, res) => {
    try {
      const b = req.body || {};
      res.json(await patchRecord(resolveTarget(b.path || b.id), b.patch || {}, { actor: actorOf(req), rev: b.rev ?? null }));
    } catch (e) { send(res, e); }
  });

  // One record with its flags (quarantined · agentPromotion · staleness), or a collection's live
  // rows with the quarantined ones listed apart from the count.
  app.get('/api/records', (req, res) => {
    try {
      if (req.query.path || req.query.id) return res.json(readRecord(resolveTarget(req.query.path || req.query.id)));
      if (req.query.collection) return res.json(listRecords(String(req.query.collection)));
      res.status(400).json({ error: 'pass ?path= for one record or ?collection= for a set' });
    } catch (e) { send(res, e); }
  });

  app.get('/api/records/history', (req, res) => {
    try { res.json({ events: eventsFor(resolveTarget(req.query.path || req.query.id), Number(req.query.limit) || 50) }); }
    catch (e) { send(res, e); }
  });

  // Activity IS the event log (§1 + §3). No second store, no second ordering.
  app.get('/api/activity', (req, res) => {
    res.json({
      events: readEvents({
        limit: Math.min(Number(req.query.limit) || 200, 1000),
        since: req.query.since || null,
        type: req.query.type || null,
        target: req.query.target || null,
      }),
      types: EVENT_TYPES,
    });
  });

  return app;
}
