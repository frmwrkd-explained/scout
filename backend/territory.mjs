// Territory — the object that stops the re-derivation, and the SOLE WRITER of finds/wins/hit_rate.
// docs/03_MEMORY.md §3, docs/08_MODULE_CONTRACTS.md §4.
//
// A territory is where an assistant may work: a Facebook group, a hashtag, a subreddit, an
// account, a site. It lives at `territory/<id>.md` — a MEMORY object, not a record, so it is not
// under `data/` and records.mjs does not own it.
//
// THE RULE THAT MATTERS: `finds`, `wins` and `hit_rate` are ROLLUPS over the records whose
// `found_in` points here. They are computed on read, they are never trusted from frontmatter, and
// `saveTerritory` strips them out of any patch. A hand-typed hit rate is a number that stops
// moving when the work changes — and the whole reason territory exists is to move.
//
// `access: rejected` plus "do not re-request" is worth as much as a win: it is a thing the agent
// would otherwise retry every single morning.

import fs from 'node:fs';
import path from 'node:path';
import { isQuarantined as isQuarantinedRule } from './records.mjs';
import { getStorageRoot, readMd, writeMd, safe } from './store.mjs';
import { allDocuments, matchesQuery } from './documents.mjs';
import { listCollections, gateField } from './collections.mjs';
import { staleness, isStale } from './decay.mjs';
import { logEvent as logEventDefault } from './log.mjs';

const R = () => getStorageRoot();
export const territoryDir = () => path.join(R(), 'territory');
const territoryFile = id => path.join(territoryDir(), safe(id) + '.md');

// Computed, never authored. Stripped from every patch that arrives from a route or an agent.
export const COMPUTED_KEYS = ['finds', 'wins', 'hit_rate'];

// Access states an agent must not walk back into. Rendered in the cache under BLOCKED.
export const BLOCKED_ACCESS = ['rejected', 'banned'];

// What counts as a win when the record's collection declares no gate field. Kept identical to
// skills/scout-router/scripts/refresh.mjs so folder mode and API mode never disagree about a
// hit rate. The declared gate (below) always wins over this list.
export const WIN_STATUSES = ['won', 'booked', 'signed', 'replied'];

class TerritoryError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

// ── hooks ──────────────────────────────────────────────────────────────────────────────────────
// The event log is the default (docs/08 §1 — one append path, and every mutation lands in it), so a
// territory written by a direct call is logged exactly like one written through the route.
//
// `afterWrite` is the debounced cache regeneration and `propose` is the DECIDE queue. Both DEFAULT
// to the real thing rather than to a no-op, resolved through a LAZY import so that pulling
// memory.mjs or proposals.mjs in from here can never close a load-time cycle (memory.mjs statically
// imports this module, and its TDZ is import-order dependent). This is the same reasoning that
// makes memory.mjs default `readEvents` to the real reader: a hook nobody wired is the section
// that is silently never rendered, or in this case the cache that is silently never invalidated.
//
// The MCP process (scripts/scout-mcp.mjs) registers no routes at all, so before these defaults
// existed every territory it wrote left a stale hot cache behind it.
const hooks = {
  logEvent: logEventDefault,
  afterWrite: () => { import('./memory.mjs').then(m => m.scheduleCacheRegen({}), () => { /* a cache that cannot be scheduled is still only a cache */ }); },
  propose: null,   // null → resolved lazily from backend/proposals.mjs at call time
};
export function setTerritoryHooks(next = {}) {
  if (typeof next.logEvent === 'function') hooks.logEvent = next.logEvent;
  if (typeof next.afterWrite === 'function') hooks.afterWrite = next.afterWrite;
  if (typeof next.propose === 'function') hooks.propose = next.propose;
  return hooks;
}

const today = () => new Date().toISOString().slice(0, 10);

// ── the record side of the rollup ──────────────────────────────────────────────────────────────

// A record is a document under `data/`. Archived records stay in the denominator on purpose:
// they WERE finds, and dropping them would inflate every hit rate the moment a human rejects
// something (Law 5 — the rejects are the labelled data).
export function isRecord(doc) {
  return typeof doc.path === 'string' && doc.path.startsWith('data/');
}
const isArchived = doc => doc.path.startsWith('data/_archive/');

// Quarantined records are excluded from every count, view, rollup and territory score until a
// human accepts them (docs/08 §3). records.mjs owns the DETERMINATION; this only honours the flag
// it writes, so there is no second quarantine rule here.
// ONE rule, and it lives in records.mjs. The on-disk `quarantined: true` flag is only a CACHE of
// that rule, written by sweepQuarantine() at boot and on the next upsert into the collection — so a
// folder-mode agent that dumps files into `data/` while the app runs was quarantined by the view
// (which calls the predicate) and counted as REAL by everything that trusted the flag.
// Measured on a temp root: 20 rogue files gave `VIEW total 1, quarantined 20` while territory
// reported `{finds: 21, wins: 20, hit_rate: 95.2}` and the goal read as met. Every agent that woke
// up after that believed fabricated ground was its best territory.
const isQuarantined = doc => isQuarantinedRule(doc?.data || {}, doc?.path || '');

// Which frontmatter values count as a win, per collection. The gate field's `done` group is the
// canonical answer — it is the same declaration the board columns and the promotion gate read —
// so a workspace that renames `won` to `signed` moves its hit rates with no code change.
function winValuesFor(collections) {
  return collections.map(c => {
    const gate = gateField(c);
    const done = (gate && gate.options || [])
      .filter(o => o && typeof o === 'object' && o.group === 'done')
      .map(o => String(o.value));
    return { query: c.query, key: gate ? gate.key : null, done: new Set(done) };
  }).filter(x => x.key && x.done.size);
}

function isWin(doc, gates) {
  for (const g of gates) {
    if (!matchesQuery(doc, g.query)) continue;
    if (g.done.has(String(doc.data[g.key] ?? ''))) return true;
    return false; // its collection HAS a gate and this is not a done value — believe the schema
  }
  // No collection with a gate claims this record: fall back to the shared vocabulary.
  const v = String(doc.data.status ?? doc.data.outcome ?? '');
  return WIN_STATUSES.includes(v);
}

// One pass over every record → Map<territoryId, { finds, wins, hit_rate }>.
// listTerritories() uses this so 40 territories cost one walk, not forty.
export function statsIndex(docs = null) {
  const all = docs || allDocuments();
  const gates = winValuesFor(listCollections());
  const out = new Map();
  for (const d of all) {
    if (!isRecord(d) || isQuarantined(d)) continue;
    const pointers = [].concat(d.data.found_in ?? []).map(String).filter(Boolean);
    if (!pointers.length) continue;
    const won = !isArchived(d) && isWin(d, gates);
    for (const id of pointers) {
      const row = out.get(id) || { finds: 0, wins: 0, hit_rate: 0 };
      row.finds++;
      if (won) row.wins++;
      out.set(id, row);
    }
  }
  for (const row of out.values()) row.hit_rate = rate(row.wins, row.finds);
  return out;
}

// One decimal place, as a percentage. Same arithmetic as refresh.mjs.
function rate(wins, finds) {
  return finds ? Math.round((wins / finds) * 1000) / 10 : 0;
}

const EMPTY_STATS = () => ({ finds: 0, wins: 0, hit_rate: 0 });

// ── reading territory ──────────────────────────────────────────────────────────────────────────

function readTerritoryFiles() {
  let names = [];
  try {
    names = fs.readdirSync(territoryDir()).filter(f => f.endsWith('.md') && !f.startsWith('._'));
  } catch { return []; }
  const out = [];
  for (const name of names) {
    const abs = path.join(territoryDir(), name);
    try {
      const { data, content } = readMd(abs);
      const id = String(data.id || name.slice(0, -3));
      out.push({ id, path: 'territory/' + name, data: { type: 'territory', ...data, id }, content });
    } catch { /* a malformed file costs one territory, never the list */ }
  }
  return out;
}

// Shape one territory for the API: its frontmatter, its computed stats, its decay.
function shape(t, index, now) {
  const stats = index.get(t.id) || (index.has(t.data.slug) ? index.get(t.data.slug) : null) || EMPTY_STATS();
  return {
    id: t.id,
    path: t.path,
    // finds/wins/hit_rate are surfaced ALONGSIDE the frontmatter, never merged into it — so a
    // stale number someone typed into the file can never be mistaken for the rollup.
    data: t.data,
    body: t.content ? String(t.content).trim() : '',
    stats,
    staleness: staleness(t.data, now),
    stale: isStale(t.data, now),
    access: String(t.data.access || 'untried'),
  };
}

export function listTerritories({ docs = null, now = Date.now() } = {}) {
  const index = statsIndex(docs);
  return readTerritoryFiles()
    .map(t => shape(t, index, now))
    .sort((a, b) => b.stats.hit_rate - a.stats.hit_rate || a.id.localeCompare(b.id));
}

export function getTerritory(id, { docs = null, now = Date.now() } = {}) {
  const file = territoryFile(id);
  if (!fs.existsSync(file)) return null;
  let read;
  try { read = readMd(file); } catch { return null; }
  const tid = String(read.data.id || safe(id));
  const t = { id: tid, path: 'territory/' + safe(id) + '.md', data: { type: 'territory', ...read.data, id: tid }, content: read.content };
  return shape(t, statsIndex(docs), now);
}

// The rollup for one territory. Cheap enough alone; use statsIndex() when you need many.
export function territoryStats(id, { docs = null } = {}) {
  return statsIndex(docs).get(String(id)) || EMPTY_STATS();
}

// "What should I sweep next" for free (docs/03_MEMORY.md §4): staleness × hit_rate.
export function sweepPriority(t) {
  return (t.staleness || 0) * (t.stats ? t.stats.hit_rate : 0);
}

// ── writing territory ──────────────────────────────────────────────────────────────────────────

// The facts an agent may write directly (skills/scout-router/references/api-mode.md):
// last_swept, access, access_changed, rules, posted[]. Everything computed is stripped.
export function saveTerritory(id, patch = {}, { actor = 'crystal' } = {}) {
  const key = safe(String(id || '').trim());
  if (!key) throw new TerritoryError('a territory needs an id');
  const file = territoryFile(key);
  const existed = fs.existsSync(file);
  let data = {}, content = '';
  if (existed) { const r = readMd(file); data = r.data; content = r.content; }

  const clean = { ...patch };
  const stripped = [];
  for (const k of COMPUTED_KEYS) {
    if (k in clean) { delete clean[k]; stripped.push(k); }
  }
  if ('body' in clean) { content = String(clean.body ?? ''); delete clean.body; }

  // access_changed is stamped, never typed: it is the date the agent must not re-request before.
  if (clean.access && clean.access !== data.access && !clean.access_changed) clean.access_changed = today();

  const next = {
    type: 'territory',
    id: key,
    access: 'untried',
    ...data,
    ...clean,
    created: data.created || today(),
    created_by: data.created_by || actor,
    updated: today(),
    updated_by: actor,
  };
  writeMd(file, next, content);
  hooks.logEvent({
    type: existed ? 'update' : 'store',
    actor,
    target: 'territory/' + key + '.md',
    detail: stripped.length ? { stripped } : {},
  });
  hooks.afterWrite({ kind: 'territory', id: key });
  return { ...getTerritory(key), stripped };
}

// ── proposing new ground ───────────────────────────────────────────────────────────────────────
//
// An agent that finds new ground PROPOSES it. It does not write it.
//
// Until 2026-09-06 this wrote `territory/<id>.md` directly with `proposed: true` and created no
// card, and memory.mjs then rendered that unapproved ground under `## NEVER TRIED` — so an agent
// could name a place, read it back on its next wake as somewhere it was allowed to work, and
// nobody had ever said yes. That is Law 4 inverted: "agents propose, humans dispose, and the gate
// lives in the pipeline, never in a prompt."
//
// The `territory` card kind already exists (docs/08 §8) and its accept path calls saveTerritory()
// below with `access: 'requested'` — the human agreeing the agent may ASK to join, which is not
// the same as being in. So this adds no second writer and no second approval surface: the only
// path from "an agent saw a group" to "a file in territory/" now runs through DECIDE.
//
// The facts about the ground travel INSIDE the card's `territory` value — `{ id, label, kind, url }`
// — which is the shape proposals.mjs `territoryOf()` normalises on both validate and accept. They
// have to travel somewhere: the card is what the human decides on, and a territory created by an
// approval must not arrive with no label. They cannot travel at the card's top level because a
// territory's `kind` (facebook-group) and the CARD's `kind` (territory) are two different things
// under one word.
const TERRITORY_FACTS = ['label', 'kind', 'url'];

// Lazy, for the reason above the hooks object. An injected `propose` (deps, or a test) wins.
async function proposeCard(card, opts) {
  const fn = hooks.propose || (await import('./proposals.mjs')).propose;
  return fn(card, opts);
}

export async function proposeTerritory(input = {}, { actor = 'scout-fb' } = {}) {
  // `name` is what skills/scout-router and backend/mcp.mjs call it; `label` is what the file calls
  // it. Accept both rather than dropping the one the agent actually sent.
  const label = String(input.label || input.name || input.title || input.id || '').trim();
  const id = safe(String(input.id || label).trim().toLowerCase().replace(/\s+/g, '-'));
  if (!id) throw new TerritoryError('a proposed territory needs an id or a label');
  if (fs.existsSync(territoryFile(id))) throw new TerritoryError('territory "' + id + '" already exists', 409);
  const why = String(input.why || '').trim();
  if (!why) {
    throw new TerritoryError('a proposed territory needs `why` — the evidence that this ground is worth the time. It is the thing they decide on.');
  }

  const ground = { id };
  for (const k of TERRITORY_FACTS) {
    if (input[k] !== undefined && input[k] !== null && input[k] !== '') ground[k] = String(input[k]);
  }
  ground.label = ground.label || label || id;

  const card = await proposeCard({
    kind: 'territory',
    // Deterministic, so an agent that re-proposes the same ground every morning does not grow the
    // queue by a card a day — propose() is idempotent on `id`.
    id: 'territory-' + id,
    territory: ground,
    title: ground.label,
    ...(Array.isArray(input.evidence) && input.evidence.length ? { evidence: input.evidence } : {}),
    why,
  }, { actor });

  hooks.logEvent({ type: 'propose', actor, target: card.path, detail: { territory: id, why } });
  return card;
}

// ── routes ─────────────────────────────────────────────────────────────────────────────────────
// registerTerritoryRoutes(app, { logEvent, afterWrite, propose }) — all optional; each defaults to
// the real thing (the log, the debounced cache regeneration, the DECIDE queue).
export function registerTerritoryRoutes(app, deps = {}) {
  setTerritoryHooks(deps);

  app.get('/api/territory', (req, res) => {
    res.json({ territory: listTerritories() });
  });

  // propose is declared BEFORE /:id so "propose" is never read as a territory id.
  // It writes NOTHING to territory/ — it makes a DECIDE card. See proposeTerritory above.
  app.post('/api/territory/propose', async (req, res) => {
    try {
      const actor = String(req.body?.actor || 'scout-fb');
      const card = await proposeTerritory(req.body || {}, { actor });
      res.json({
        ok: true,
        card,
        status: card.status,
        // Said out loud, because an agent that believes it just got the ground would go and work it.
        note: 'Proposed — nothing was written to territory/. It is card ' + card.id + ' in DECIDE. ' +
          'If they accept it the territory lands at access "requested": you may ASK to join, not that you are in.',
      });
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });

  app.get('/api/territory/:id', (req, res) => {
    const t = getTerritory(req.params.id);
    if (!t) return res.status(404).json({ error: 'no territory "' + req.params.id + '"' });
    res.json(t);
  });

  app.patch('/api/territory/:id', (req, res) => {
    try {
      const { actor = 'crystal', patch: wrapped, ...rest } = req.body || {};
      // frontend/api.js sends { patch, actor }; the agent doors send the fields flat. Accept both.
      const patch = wrapped && typeof wrapped === 'object' ? wrapped : rest;
      const saved = saveTerritory(req.params.id, patch, { actor: String(actor) });
      // Say so out loud rather than silently accepting a number we then ignore.
      res.json({ ok: true, territory: saved, stripped: saved.stripped });
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });
}

export { TerritoryError };
