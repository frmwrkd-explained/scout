// Project memory — the "hot cache" for a bigger project. A plain, editable markdown doc at
// projects/<pid>/memory.md (frontmatter {project, updated}, body = markdown bullet list) that is
// injected verbatim into every agent run alongside the brief. An absent/empty file simply renders
// an empty state — no per-project flag needed, memory is opt-in by writing to it.
//
// This module also owns the References-vs-Assets folder classification override manifest
// (context/_folders.md): a tiny per-folder map { folderName: 'asset' | 'reference' } that lets the
// user re-file a board across the split without renaming it. The naming-convention default lives on
// the client (AssetBoards.jsx · folderKind); this manifest only stores explicit overrides.
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { isQuarantined as isQuarantinedRule } from './records.mjs';
import { getStorageRoot, stamp, safeScope, dayMs } from './store.mjs';

// safeScope is the one project-id sanitizer (store.mjs) — an allowlist, and the same one
// contextDir() uses, so memory/_folders and the context boards always agree on the directory.
const projDir = pid => path.join(getStorageRoot(), 'projects', safeScope(pid));
export const memoryPath = pid => path.join(projDir(pid), 'memory.md');
export const foldersPath = pid => path.join(projDir(pid), 'context', '_folders.md');

// Machine-owned files living at the root of a project's context dir. They are control manifests,
// not user assets: the asset library must not list them, nor let them be renamed/moved/deleted.
// Single declaration, and it is NOT here — it moved to store.mjs on 2026-08-02, which owns
// contextDir and the path helpers that have to consult it. Re-exported so existing importers
// (library.mjs) keep working. Never re-list these names elsewhere.
export { CONTROL_FILES } from './store.mjs';

// atomic md write — tmp+rename so a reader never sees a half-written file (mirrors store.writeMd)
function writeAtomic(file, data, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  const tmp = file + '.' + process.pid + '.tmp';
  // {content} form, not a bare string: matter.stringify(str, data) re-parses a string body, so a
  // memory note that begins with a `---` fence (horizontal rule / pasted frontmatter) would have
  // its leading block hoisted into the frontmatter and lost on read. Serialize the body verbatim.
  fs.writeFileSync(tmp, matter.stringify({ content: body }, clean));
  fs.renameSync(tmp, file);
}

// ── memory doc ──
export function readMemory(pid) {
  try {
    const { data, content } = matter(fs.readFileSync(memoryPath(pid), 'utf8'));
    return { body: content.trim(), updated: data.updated || '' };
  } catch { return { body: '', updated: '' }; }
}
export function writeMemory(pid, body) {
  const updated = stamp();
  writeAtomic(memoryPath(pid), { project: String(pid), updated }, (body || '').trim() + '\n');
  return { body: (body || '').trim(), updated };
}
// prepend a dated bullet — quick-append keeps the newest thought at the top of the doc
export function appendMemory(pid, text) {
  const t = String(text || '').trim();
  if (!t) return readMemory(pid);
  const { body } = readMemory(pid);
  const line = '- ' + t + '  _(' + stamp() + ')_';
  return writeMemory(pid, body ? line + '\n' + body : line);
}
// the slice handed to agent runs — empty string when there is nothing to remember
export function memoryForAgent(pid) { return readMemory(pid).body; }

// ── learnings dedupe (ticket 20) ──
// Distillation appends durable learnings to memory, but re-running it (or a near-repeat of a prior
// session) must not pile up duplicates. Normalize a line to its content — drop the leading bullet,
// the trailing dated `_(…)_` stamp, punctuation and case — so two bullets that say the same thing
// compare equal even when their marker or date differ.
export function normalizeMemoryLine(s) {
  return String(s || '')
    .replace(/^[-*+]\s+/, '')            // leading bullet
    .replace(/\s*_\([^)]*\)_\s*$/, '')   // trailing "_(Jul 6, 18:00)_" stamp
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')        // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

// token-overlap similarity of two already-normalized strings (Jaccard over word sets). A high score
// means "basically the same learning phrased differently" — enough to skip on append.
function jaccard(a, b) {
  const A = new Set(String(a).split(' ').filter(Boolean));
  const B = new Set(String(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// existing memory bullets as individual trimmed lines (for dedupe comparisons).
export function memoryLines(pid) {
  return readMemory(pid).body.split('\n').map(l => l.trim()).filter(Boolean);
}

// Append several learnings, skipping any that duplicate an existing bullet — normalized-equal or
// high token overlap (>= SIM_THRESHOLD). Deduplicates within the batch too. Returns
// { added:[…], skipped:[…] }. Uses the existing appendMemory(), so the newest lands at the top and
// the memory record's shape/ordering is unchanged.
const SIM_THRESHOLD = 0.85;
export function appendLearnings(pid, learnings = []) {
  const items = (Array.isArray(learnings) ? learnings : [learnings])
    .map(s => String(s || '').trim()).filter(Boolean);
  const seen = memoryLines(pid).map(normalizeMemoryLine).filter(Boolean);
  const added = [], skipped = [];
  for (const item of items) {
    const norm = normalizeMemoryLine(item);
    if (!norm) continue;
    if (seen.some(s => s === norm || jaccard(s, norm) >= SIM_THRESHOLD)) { skipped.push(item); continue; }
    appendMemory(pid, item);
    seen.push(norm); // so a near-duplicate later in the same batch is also skipped
    added.push(item);
  }
  return { added, skipped };
}

// ── folder classification overrides (context/_folders.md) ──
export function readFolderKinds(pid) {
  try {
    const { data } = matter(fs.readFileSync(foldersPath(pid), 'utf8'));
    return data.kinds && typeof data.kinds === 'object' ? data.kinds : {};
  } catch { return {}; }
}
export function writeFolderKind(pid, folder, kind) {
  const f = String(folder || '').trim();
  const kinds = readFolderKinds(pid);
  if (kind === 'asset' || kind === 'reference') kinds[f] = kind;
  else delete kinds[f]; // any other value clears the override → back to naming-convention default
  writeAtomic(foldersPath(pid), { project: String(pid), updated: stamp(), kinds },
    'Per-folder References/Assets classification overrides for this project.\n');
  return kinds;
}

// ── routes ──
// registerMemoryRoutes(app, { appendActivity, bumpHistory }) — deps optional; both are no-ops if absent.
export function registerMemoryRoutes(app, deps = {}) {
  const bump = deps.bumpHistory || (() => {});
  const activity = deps.appendActivity || (() => {});

  app.get('/api/memory/:pid', (req, res) => res.json(readMemory(req.params.pid)));

  app.put('/api/memory/:pid', (req, res) => {
    const r = writeMemory(req.params.pid, String(req.body?.content || ''));
    bump('briefs');
    activity({ dot: 'amber', t: 'Project memory updated', t2: '· ' + req.params.pid, s: 'injected into every agent run alongside the brief', kind: 'proj', ref: req.params.pid });
    res.json({ ok: true, ...r });
  });

  app.post('/api/memory/:pid/append', (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'nothing to remember — text is empty' });
    const r = appendMemory(req.params.pid, text);
    bump('briefs');
    activity({ dot: 'green', t: 'Remembered', t2: '· ' + req.params.pid, s: text.slice(0, 80), kind: 'proj', ref: req.params.pid });
    res.json({ ok: true, ...r });
  });

  // Dedupe-aware learning capture. appendMemory above is a plain prepend, which is right for one
  // deliberate note but wrong for the correction loop: a user who keeps telling the agent the same
  // thing it keeps getting wrong would pile up near-identical bullets. appendLearnings already does
  // normalized + Jaccard dedupe (it is what the session distiller writes through) — it simply had no
  // HTTP door. This is that door, and it returns the same { added, skipped } shape the distill route
  // does, so a caller can honestly say "already known" instead of claiming a save that deduped away.
  app.post('/api/memory/:pid/learnings', (req, res) => {
    const raw = req.body?.learnings ?? req.body?.text;
    const list = (Array.isArray(raw) ? raw : [raw]).map(s => String(s || '').trim()).filter(Boolean);
    if (!list.length) return res.status(400).json({ error: 'nothing to remember — learnings is empty' });
    const r = appendLearnings(req.params.pid, list);
    bump('briefs');
    if (r.added.length) activity({ dot: 'green', t: 'Learned', t2: '· ' + req.params.pid, s: r.added[0].slice(0, 80) + (r.added.length > 1 ? ' +' + (r.added.length - 1) + ' more' : ''), kind: 'proj', ref: req.params.pid });
    res.json({ ok: true, ...r });
  });

  // classification override manifest
  app.get('/api/folders/:pid', (req, res) => res.json({ kinds: readFolderKinds(req.params.pid) }));
  app.put('/api/folders/:pid', (req, res) => {
    const folder = String(req.body?.folder || '').trim();
    if (!folder) return res.status(400).json({ error: 'folder is required' });
    const kinds = writeFolderKind(req.params.pid, folder, req.body?.kind);
    res.json({ ok: true, kinds });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SCOUT MEMORY LAYER — M3 (T09 · T10). Everything ABOVE this divider is FrameForge's per-project
// notes doc and the folder-classification manifest; six modules and four tests import it, so
// nothing above may be renamed, removed or reordered. Everything BELOW is Scout's memory layer:
// identity, goals, playbook, learnings and THE HOT CACHE.
//
// docs/03_MEMORY.md is the spec; §2 is the cache's exact shape and §4 is decay.
//
// The one rule to keep: `renderCache()` is the ONLY producer of the agent's wake-up context, and
// it has a HARD TOKEN BUDGET. Over budget it compresses in a fixed order and NAMES WHAT IT
// DROPPED. A silent truncation is a defect (docs/01_CANON.md Law 7).
//
// These imports sit below the divider on purpose — the Scout layer carries its own. ESM hoists
// every import declaration to the top of the module, so their position is presentational only.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { readMd, writeMd, safe } from './store.mjs';
import { allDocuments, matchesQuery, firstParagraph } from './documents.mjs';
import { listCollections, gateField } from './collections.mjs';
import { staleness, isStale, ageDays, agoLabel, agoFrom, daysUntil, dayOf } from './decay.mjs';
import { listTerritories, setTerritoryHooks, isRecord, BLOCKED_ACCESS } from './territory.mjs';
import { logEvent as logEventDefault, readEvents as readEventsDefault } from './log.mjs';

// ── the budget ─────────────────────────────────────────────────────────────────────────────────
// The cap is the feature (GOAL.md §10, docs/01_CANON.md Law 7). An uncapped context file becomes
// exactly the overwhelm this app exists to prevent — for the agent as much as for the human.
export const CACHE_TOKEN_BUDGET = 2000;
// Token estimate: CHARS / 4. Deliberately crude and model-independent — the budget is a guard
// rail, not an accounting system, and a tokenizer dependency would be a lie about its precision.
export const CHARS_PER_TOKEN = 4;
export const CACHE_CHAR_BUDGET = CACHE_TOKEN_BUDGET * CHARS_PER_TOKEN; // 8000 chars
export function estimateTokens(text) { return Math.ceil(String(text || '').length / CHARS_PER_TOKEN); }

// Learnings older than this, never re-verified, are the third thing to go (docs/03_MEMORY.md §2).
const LEARNING_COMPRESS_DAYS = 60;
// The most unanswered questions worth carrying; the rest are named as dropped, never hidden.
const QUESTION_MAX = 5;

class MemoryError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
export { MemoryError };

// ── injected hooks ─────────────────────────────────────────────────────────────────────────────
// The event log is the DEFAULT, not a requirement: backend/log.mjs owns the format and this module
// only appends through it (docs/08 §1 — one append path). Both are overridable so a test can inject
// a fake log, and `registerScoutMemoryRoutes(app, deps)` lets index.mjs pass its own.
//
// `readEvents` defaults to the real reader on purpose. index.mjs mounts this module with
// `{ logEvent }` only, and a `null` default would mean SINCE YOUR LAST RUN never renders in the
// running app — the one section that tells the agent what the human decided while it was away.
const hooks = {
  logEvent: logEventDefault,   // ({ type, actor, target, detail })
  readEvents: readEventsDefault, // ({ since, limit }) → newest-first events
  lastRunAt: null,             // () → epoch ms of the agent's last run; falls back to the cache stamp
};
export function setScoutMemoryHooks(next = {}) {
  for (const k of ['logEvent', 'readEvents', 'lastRunAt']) {
    if (typeof next[k] === 'function') hooks[k] = next[k];
    else if (next[k] === null) hooks[k] = null; // an explicit null switches the section off
  }
  return hooks;
}

// territory.mjs must bump the cache when an agent writes `last_swept`, but importing memory.mjs
// from there would close a load-time cycle (store → memory → territory → memory) whose TDZ is
// order-dependent. Wiring it lazily, from here, cannot deadlock in either import order.
let wired = false;
function ensureWired() {
  if (wired) return;
  wired = true;
  setTerritoryHooks({
    logEvent: (...a) => hooks.logEvent(...a),
    afterWrite: () => scheduleCacheRegen({}),
  });
}

const R2 = () => getStorageRoot();
const today = () => new Date().toISOString().slice(0, 10);
const nowStamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

// ── paths ──────────────────────────────────────────────────────────────────────────────────────
export const scoutPaths = {
  me: () => path.join(R2(), 'me.md'),
  goalsDir: () => path.join(R2(), 'goals'),
  goal: id => path.join(R2(), 'goals', safe(id) + '.md'),
  playbookDir: () => path.join(R2(), 'playbook'),
  playbook: id => path.join(R2(), 'playbook', safe(id) + '.md'),
  learningsDir: () => path.join(R2(), 'learnings'),
  learning: id => path.join(R2(), 'learnings', safe(id) + '.md'),
  proposalsDir: () => path.join(R2(), 'proposals'),
  brief: pid => path.join(R2(), 'projects', safeScope(pid), 'brief.md'),
  cacheDir: pid => (pid ? path.join(R2(), 'projects', safeScope(pid), '.cache') : path.join(R2(), '.scout', 'cache')),
  cache: pid => path.join(scoutPaths.cacheDir(pid), 'context.md'),
  cacheVersion: pid => path.join(scoutPaths.cacheDir(pid), 'version.json'),
};

// Every .md in a memory folder, newest-safe and never fatal on one bad file.
function listDir(dir, type) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('._')); } catch { return []; }
  const out = [];
  for (const name of names) {
    const abs = path.join(dir, name);
    try {
      const { data, content } = readMd(abs);
      const id = String(data.id || name.slice(0, -3));
      out.push({ id, file: abs, data: { type, ...data, id }, body: String(content || '').trim() });
    } catch { /* readers swallow parse errors by design — one bad file costs one object */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ── who is an agent ────────────────────────────────────────────────────────────────────────────
// `me.md` is human-owned (docs/03_MEMORY.md §1, docs/04_AGENT_CONTRACT.md §6) and the route has to
// refuse an agent write — which means something has to decide what an agent IS. File truth, in
// this order, and no heuristic on the name:
//   1. `assistants/<actor>.md` exists                     → agent (docs/04 §5: assistants ARE the agents)
//   2. the actor is listed in me.md `agents[]`            → agent
//   3. me.md declares an owner and the actor is not them  → agent
//   4. nothing declared yet                               → human
// (4) is deliberately fail-OPEN: a brand-new workspace has a placeholder `me.md` and no assistants,
// and a rule that locks the person out of writing their own identity on day one would fail the
// only gate that matters more (GOAL.md §4.1 — productive in 15 minutes).
function sameActor(id, raw) {
  const a = String(id || '').trim().toLowerCase();
  const b = String(raw || '').trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a === b.split(/\s+/)[0] || a === b.replace(/\s+/g, '-');
}
function ownerOf(data = {}) {
  for (const raw of [data.owner, data.created_by, data.name]) {
    const s = String(raw || '').trim();
    if (s && !s.startsWith('__')) return s; // `__NAME__` is the workspace-template placeholder
  }
  return null;
}
export function isAgentActor(actor) {
  const id = String(actor || '').trim();
  if (!id) return false; // no actor at all → the UI's human default (docs/08 §3)
  if (fs.existsSync(path.join(R2(), 'assistants', safe(id) + '.md'))) return true;
  let data = {};
  try { data = readMd(scoutPaths.me()).data || {}; } catch { /* no me.md yet */ }
  const declared = [].concat(data.agents ?? []).map(String);
  if (declared.some(a => sameActor(id, a))) return true;
  const owner = ownerOf(data);
  return owner ? !sameActor(id, owner) : false;
}
function refuseAgent(actor, what) {
  if (isAgentActor(actor)) {
    hooks.logEvent({ type: 'refused', actor, target: what, detail: { why: 'human-owned' } });
    throw new MemoryError(what + ' is human-owned — an agent may only propose a change to it', 403);
  }
}

// ── identity ───────────────────────────────────────────────────────────────────────────────────
export function readMe() {
  try {
    const { data, content } = readMd(scoutPaths.me());
    const d = { type: 'identity', ...data };
    return { path: 'me.md', data: d, body: String(content || '').trim(), staleness: staleness(d) };
  } catch {
    return { path: 'me.md', data: { type: 'identity' }, body: '', staleness: 1 };
  }
}

export function writeMe(body, data = {}, { actor = 'crystal' } = {}) {
  ensureWired();
  refuseAgent(actor, 'me.md');
  const cur = readMe();
  const next = {
    ...cur.data,
    ...(data && typeof data === 'object' ? data : {}),
    type: 'identity',
    created: cur.data.created || today(),
    created_by: cur.data.created_by || actor,
    updated: today(),
    updated_by: actor,
    verified_at: today(),
  };
  const text = body === undefined || body === null ? cur.body : String(body);
  writeMd(scoutPaths.me(), next, text.trim() + '\n');
  hooks.logEvent({ type: 'update', actor, target: 'me.md', detail: {} });
  scheduleCacheRegen({});
  return readMe();
}

// ── goals ──────────────────────────────────────────────────────────────────────────────────────
// Progress is a ROLLUP, never typed (T09 §2). A goal that declares `count: { path/tag/where }`
// counts the records that match it; one that declares nothing falls back to the authored
// `current`, and says which it did through `progress.computed`.
function goalProgress(goal, docs) {
  const q = goal.count || goal.query || null;
  if (q && typeof q === 'object') {
    const n = docs.filter(d => isRecord(d) && !d.path.startsWith('data/_archive/') &&
      !isQuarantinedDoc(d) && matchesQuery(d, q)).length;
    return { current: n, computed: true };
  }
  const n = Number(goal.current);
  return { current: Number.isFinite(n) ? n : 0, computed: false };
}

function shapeGoal(g, docs, now) {
  const { current, computed } = goalProgress(g.data, docs);
  const target = Number(g.data.target);
  const left = daysUntil(g.data.deadline, now);
  const frac = Number.isFinite(target) && target > 0 ? current / target : null;
  // Behind = less far along than the calendar is. Computed, so a `behind:` someone typed months ago
  // can never keep claiming a goal is fine.
  //
  // The calendar here is the goal's OWN RUNWAY — created → deadline — not `staleness()`. Those are
  // two different questions and this used the wrong one: staleness asks "how long since anyone
  // re-verified this file", so a goal saved this morning had elapsed 0 and could never be behind,
  // however close its deadline was or however little had been done. `Six wins, 2 of 6, two days
  // left` reported fine. Decay is for memory that rots; a deadline is a deadline.
  const started = dayMs(g.data.created);
  const ends = dayMs(g.data.deadline);
  const elapsed = started != null && ends != null && ends > started
    ? Math.max(0, Math.min(1, (now - started) / (ends - started)))
    : (ends != null && ends <= now ? 1 : null);   // past the deadline with no start date: out of time
  const behind = frac == null || elapsed == null
    ? Boolean(g.data.behind)
    : frac < elapsed && frac < 1;
  return {
    id: g.id,
    path: 'goals/' + g.id + '.md',
    data: g.data,
    body: g.body,
    label: String(g.data.label || g.data.statement || g.id),
    current, target: Number.isFinite(target) ? target : null,
    unit: String(g.data.unit || ''),
    computed,
    daysLeft: left,
    behind,
    staleness: elapsed,
  };
}

// ONE rule, and it lives in records.mjs. The on-disk `quarantined: true` flag is only a CACHE of
// that rule, written by sweepQuarantine() at boot and on the next upsert into the collection — so a
// folder-mode agent that dumps files into `data/` while the app runs was quarantined by the view
// (which calls the predicate) and counted as REAL by everything that trusted the flag.
// Measured on a temp root: 20 rogue files gave `VIEW total 1, quarantined 20` while territory
// reported `{finds: 21, wins: 20, hit_rate: 95.2}` and the goal read as met. Every agent that woke
// up after that believed fabricated ground was its best territory.
function isQuarantinedDoc(d) { return isQuarantinedRule(d?.data || {}, d?.path || ''); }

export function listGoals({ docs = null, now = Date.now() } = {}) {
  const all = docs || allDocuments();
  return listDir(scoutPaths.goalsDir(), 'goal').map(g => shapeGoal(g, all, now));
}
export function getGoal(id, { docs = null, now = Date.now() } = {}) {
  return listGoals({ docs, now }).find(g => g.id === safe(id) || g.id === id) || null;
}

// Human-owned like me.md: agents propose (docs/04_AGENT_CONTRACT.md §6). `current` is dropped when
// the goal declares a count query — the rollup is the truth and a typed number would shadow it.
export function saveGoal(id, patch = {}, { actor = 'crystal' } = {}) {
  ensureWired();
  refuseAgent(actor, 'goals/' + safe(id) + '.md');
  const file = scoutPaths.goal(id);
  let data = {}, content = '';
  const existed = fs.existsSync(file);
  if (existed) { const r = readMd(file); data = r.data; content = r.content; }
  const clean = { ...patch };
  if ('body' in clean) { content = String(clean.body ?? ''); delete clean.body; }
  const stripped = [];
  const merged = { ...data, ...clean };
  if ((merged.count || merged.query) && 'current' in clean) { delete clean.current; stripped.push('current'); }
  const next = {
    type: 'goal', id: safe(id), ...data, ...clean,
    // `clean.created` before `today()`: a caller creating a goal that has been running for a
    // month passes its real start date, and `...clean` had already put it in `next` — only for
    // this line to overwrite it. A goal that thinks it started today has no runway to be
    // measured against, which is what `behind` needs.
    created: data.created || clean.created || today(), created_by: data.created_by || actor,
    updated: today(), updated_by: actor,
  };
  writeMd(file, next, content);
  hooks.logEvent({ type: existed ? 'update' : 'store', actor, target: 'goals/' + safe(id) + '.md', detail: stripped.length ? { stripped } : {} });
  scheduleCacheRegen({});
  return getGoal(safe(id));
}

// ── playbook ───────────────────────────────────────────────────────────────────────────────────
// Every claim carries evidence. A claim with no evidence is refused on write (T09 §4) — it is the
// difference between "this works" and "someone once felt this worked".
function shapePlaybook(p, now) {
  const evidence = [].concat(p.data.evidence ?? []).filter(Boolean);
  const wins = Number(p.data.wins);
  return {
    id: p.id,
    path: 'playbook/' + p.id + '.md',
    data: p.data,
    body: p.body,
    title: String(p.data.title || p.id),
    // The one line the cache shows. The body's first real line, else the declared claim.
    line: String(p.data.claim || firstLine(p.body) || '').trim(),
    evidence,
    wins: Number.isFinite(wins) ? wins : evidence.length,
    status: String(p.data.status || 'active'),
    // Why it stopped being true — never the claim, which is what it stopped being.
    retiredBecause: String(p.data.retired_because || p.data.retired_why || p.data.why || '').trim(),
    staleness: staleness(p.data, now),
    stale: isStale(p.data, now),
  };
}
function firstLine(body) {
  return String(body || '').split('\n').map(s => s.trim()).find(s => s && !s.startsWith('#')) || '';
}

export function listPlaybook({ now = Date.now() } = {}) {
  return listDir(scoutPaths.playbookDir(), 'playbook').map(p => shapePlaybook(p, now));
}
export function getPlaybook(id, { now = Date.now() } = {}) {
  const file = scoutPaths.playbook(id);
  if (!fs.existsSync(file)) return null;
  try {
    const { data, content } = readMd(file);
    const pid = String(data.id || safe(id));
    return shapePlaybook({ id: pid, file, data: { type: 'playbook', ...data, id: pid }, body: String(content || '').trim() }, now);
  } catch { return null; }
}

export function savePlaybook(id, patch = {}, { actor = 'crystal' } = {}) {
  ensureWired();
  const key = safe(String(id || '').trim());
  if (!key) throw new MemoryError('a playbook claim needs an id');
  const file = scoutPaths.playbook(key);
  let data = {}, content = '';
  const existed = fs.existsSync(file);
  if (existed) { const r = readMd(file); data = r.data; content = r.content; }
  const clean = { ...patch };
  if ('body' in clean) { content = String(clean.body ?? ''); delete clean.body; }

  const merged = { ...data, ...clean };
  const evidence = [].concat(merged.evidence ?? []).filter(Boolean);
  if (!evidence.length) {
    hooks.logEvent({ type: 'refused', actor, target: 'playbook/' + key + '.md', detail: { why: 'no evidence' } });
    throw new MemoryError('a playbook claim needs evidence[] — one or more links to the records that prove it', 400);
  }
  const next = {
    type: 'playbook', id: key, status: 'active', ...data, ...clean, evidence,
    created: data.created || today(), created_by: data.created_by || actor,
    updated: today(), updated_by: actor,
    // Writing a claim IS verifying it. Decay starts from here (docs/03_MEMORY.md §4).
    verified_at: clean.verified_at || today(),
  };
  writeMd(file, next, content);
  hooks.logEvent({ type: existed ? 'update' : 'store', actor, target: 'playbook/' + key + '.md', detail: { evidence: evidence.length } });
  scheduleCacheRegen({});
  return getPlaybook(key);
}

// ── learnings ──────────────────────────────────────────────────────────────────────────────────
// The agent PROPOSES; a human approves on a DECIDE card. Nothing enters memory silently
// (docs/03_MEMORY.md §5).
function shapeLearning(l, now) {
  const evidence = [].concat(l.data.evidence ?? []).filter(Boolean);
  const counter = [].concat(l.data.counter_examples ?? []).filter(Boolean);
  const authored = Number(l.data.confidence);
  return {
    id: l.id,
    path: 'learnings/' + l.id + '.md',
    data: l.data,
    body: l.body,
    claim: String(l.data.claim || firstLine(l.body) || l.id),
    scope: String(l.data.scope || 'project'),
    project: l.data.project ? String(l.data.project) : null,
    evidence, counterExamples: counter,
    // A rollup: evidence against counter-examples. Falls back to the authored number only when
    // there is nothing to roll up.
    confidence: evidence.length || counter.length
      ? Math.round((evidence.length / (evidence.length + counter.length)) * 100) / 100
      : (Number.isFinite(authored) ? authored : 0),
    status: String(l.data.status || 'proposed'),
    staleness: staleness(l.data, now),
    stale: isStale(l.data, now),
    ageDays: ageDays(l.data, now),
  };
}

export function listLearnings({ now = Date.now(), status = null } = {}) {
  const all = listDir(scoutPaths.learningsDir(), 'learning').map(l => shapeLearning(l, now));
  return status ? all.filter(l => l.status === status) : all;
}
export function getLearning(id, { now = Date.now() } = {}) {
  return listLearnings({ now }).find(l => l.id === safe(id) || l.id === id) || null;
}

export function saveLearning(id, patch = {}, { actor = 'crystal' } = {}) {
  ensureWired();
  const key = safe(String(id || '').trim());
  if (!key) throw new MemoryError('a learning needs an id');
  const file = scoutPaths.learning(key);
  let data = {}, content = '';
  const existed = fs.existsSync(file);
  if (existed) { const r = readMd(file); data = r.data; content = r.content; }
  const clean = { ...patch };
  if ('body' in clean) { content = String(clean.body ?? ''); delete clean.body; }

  const merged = { ...data, ...clean };
  const claim = String(merged.claim || '').trim();
  if (!claim) throw new MemoryError('a learning needs a claim');
  const evidence = [].concat(merged.evidence ?? []).filter(Boolean);
  const byAgent = isAgentActor(actor);
  // An agent may never promote its own learning into memory — that is the gate, in the pipeline
  // rather than in a prompt (Law 4). It lands `proposed` however it was addressed.
  let status = String(clean.status || data.status || 'proposed');
  if (byAgent && status !== 'proposed') {
    hooks.logEvent({ type: 'refused', actor, target: 'learnings/' + key + '.md', detail: { why: 'agent may only propose', asked: status } });
    status = 'proposed';
  }
  if (status === 'active' && !evidence.length) {
    throw new MemoryError('an active learning needs evidence[] — propose it instead', 400);
  }
  const next = {
    type: 'learning', id: key, scope: 'project', ...data, ...clean,
    claim, evidence, status,
    created: data.created || today(), created_by: data.created_by || actor,
    updated: today(), updated_by: actor,
    verified_at: clean.verified_at || (status === 'active' ? today() : (data.verified_at || today())),
    proposed: byAgent ? true : data.proposed,
  };
  writeMd(file, next, content);
  hooks.logEvent({ type: byAgent ? 'propose' : (existed ? 'update' : 'store'), actor, target: 'learnings/' + key + '.md', detail: { status } });
  scheduleCacheRegen({});
  return getLearning(key);
}

// Graduation (T09 §6 · docs/03_MEMORY.md §5): the same claim holding in a SECOND project is the
// self-improvement loop. Reuses normalizeMemoryLine (above the divider) so "the same claim
// phrased differently" means the same thing here as it does in the distiller.
export function graduationCandidates({ now = Date.now() } = {}) {
  const byClaim = new Map();
  for (const l of listLearnings({ now })) {
    if (l.scope !== 'project' || l.status === 'retired') continue;
    const k = normalizeMemoryLine(l.claim);
    if (!k) continue;
    const row = byClaim.get(k) || { claim: l.claim, ids: [], projects: new Set() };
    row.ids.push(l.id);
    if (l.project) row.projects.add(l.project);
    byClaim.set(k, row);
  }
  return [...byClaim.values()]
    .filter(r => r.projects.size >= 2)
    .map(r => ({ claim: r.claim, ids: r.ids, projects: [...r.projects] }));
}

// ── open questions ─────────────────────────────────────────────────────────────────────────────
// proposals/<id>.md with kind: question. backend/proposals.mjs (M4) OWNS writing these; reading a
// markdown file is not a second implementation of that module.
function openQuestions() {
  return listDir(scoutPaths.proposalsDir(), 'proposal')
    .filter(p => String(p.data.kind || '') === 'question' && String(p.data.status || 'open') === 'open')
    .map(p => ({ id: p.id, actor: String(p.data.actor || p.data.created_by || ''), text: String(p.data.question || p.data.claim || p.data.title || firstLine(p.body) || p.id).trim() }));
}

// ── the hot cache ──────────────────────────────────────────────────────────────────────────────

// THE version. One file, one number, read by everything that answers "has the context changed?".
// `v` moves only when the cache is REGENERATED — never on a read — so an agent that polls
// GET /api/cache/version and sees the same integer is right to keep using what it cached.
function readVersion(pid) {
  try {
    const raw = JSON.parse(fs.readFileSync(scoutPaths.cacheVersion(pid), 'utf8'));
    const v = Number(raw.v);
    return { ...raw, v: Number.isFinite(v) ? v : 0, generated: raw.generated || null };
  } catch { return { v: 0, generated: null }; }
}
export function cacheVersion({ project = null } = {}) {
  const { v, generated } = readVersion(scopeOf(project));
  return { v, generated };
}
// The scope a render will actually write to: an explicit project, else the active one.
function scopeOf(project) {
  if (project) return String(project);
  const active = readMe().data.active_project;
  return active ? String(active) : null;
}

// Territory the project actually touches (docs/03_MEMORY.md §2 · Scoping). A territory belongs to
// a project when it says so, or when a record of that project was found in it. A project that
// touches nothing yet sees the whole map rather than an empty one.
function territoryForProject(all, pid, docs) {
  if (!pid) return all;
  const declared = new Set();
  for (const t of all) {
    const own = [].concat(t.data.project ?? t.data.projects ?? []).map(String);
    if (own.includes(pid)) declared.add(t.id);
  }
  for (const d of docs) {
    if (!isRecord(d) || String(d.data.project ?? '') !== pid) continue;
    for (const f of [].concat(d.data.found_in ?? []).map(String)) declared.add(f);
  }
  const filtered = all.filter(t => declared.has(t.id));
  return filtered.length ? filtered : all;
}

// Territory handle, as the cache renders it: `#group/nurses-ph`, `#hazing`, `r/nursing`, `@handle`.
function handleOf(t) {
  const kind = String(t.data.kind || '');
  if (kind === 'facebook-group') return '#group/' + t.id;
  if (kind === 'hashtag') return '#' + t.id;
  if (kind === 'subreddit') return 'r/' + t.id;
  if (kind === 'account') return '@' + t.id;
  return t.id;
}
const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

// An injected body (me.md, a project brief) is CONTENT inside a section, not a peer of it. Its own
// `## Notes` heading would otherwise appear as a twelfth top-level section between WHO I WORK FOR
// and GOALS, and an agent splitting the context on /^## / would read the identity as two objects.
// Nothing is removed — docs/03_MEMORY.md §1 says identity goes in IN FULL — the headings are just
// demoted below the section level so the eleven headings stay the eleven headings.
function demoteHeadings(body) {
  return String(body || '').replace(/^#{1,6}[ \t]+/gm, '### ');
}
// "1 wins" reads like a bug in a file the human is invited to read. One rule, both call sites.
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

// One read of everything the cache is made of. ONE walk of the store, shared by every section —
// forty territories must not cost forty walks.
function gather({ project = null, now = Date.now(), docs = null } = {}) {
  const all = docs || allDocuments();
  const me = readMe();
  const pid = project || (me.data.active_project ? String(me.data.active_project) : null);
  const collections = listCollections();
  const records = all.filter(d => isRecord(d) && !d.path.startsWith('data/_archive/') && !isQuarantinedDoc(d));
  const territory = territoryForProject(listTerritories({ docs: all, now }), pid, all);
  const goals = listGoals({ docs: all, now });
  const playbook = listPlaybook({ now });
  const learnings = listLearnings({ now }).filter(l => l.status === 'active');
  const questions = openQuestions();
  const tasksOpen = all.filter(d => /^projects\/[^/]+\/tasks\//.test(d.path) && String(d.data.status || 'open') === 'open').length;

  let brief = '';
  if (pid) { try { brief = String(readMd(scoutPaths.brief(pid)).content || '').trim(); } catch { /* no brief */ } }

  // Since your last run. The marker is the previous cache stamp — the moment the agent last woke —
  // unless a runs table is wired in (hooks.lastRunAt).
  const prev = readVersion(pid);
  const since = (hooks.lastRunAt && hooks.lastRunAt()) || (prev.generated ? Date.parse(prev.generated.replace(' ', 'T') + 'Z') : null);
  let events = [];
  // The log must never be able to take down the wake-up read.
  try { events = hooks.readEvents ? (hooks.readEvents({ since, limit: 300 }) || []) : []; } catch { events = []; }

  return { now, me, pid, brief, collections, records, territory, goals, playbook, learnings, questions, tasksOpen, since, events, docs: all };
}

// ── the sections ───────────────────────────────────────────────────────────────────────────────

function goalLine(g) {
  const bits = [g.label];
  const num = g.target != null ? g.current + '/' + g.target + (g.unit ? ' ' + g.unit : '') : (g.current ? g.current + ' done' : '');
  const left = g.daysLeft == null ? '' : (g.daysLeft >= 0 ? g.daysLeft + ' days left' : Math.abs(g.daysLeft) + ' days overdue');
  const tail = [num, left].filter(Boolean).join(', ');
  return '- ' + bits.join('') + (tail ? ' — ' + tail : '') + (g.behind ? '  ← behind' : '');
}

function territorySections(m, level) {
  const open = m.territory.filter(t => t.access === 'joined');
  const blocked = m.territory.filter(t => BLOCKED_ACCESS.includes(t.access) || t.access === 'requested');
  const untried = m.territory.filter(t => t.access === 'untried');

  const best = [...open].sort((a, b) => b.stats.hit_rate - a.stats.hit_rate || b.stats.finds - a.stats.finds);
  // Compression rung 1 keeps exactly top-5 + stalest-3 + all blocked (docs/03_MEMORY.md §2).
  const topN = level >= 1 ? 5 : 8;
  const head = best.slice(0, topN);
  const stalest = best.slice(topN).filter(t => t.stale)
    .sort((a, b) => b.staleness - a.staleness || a.id.localeCompare(b.id)).slice(0, 3);
  const shown = [...head, ...stalest];
  const w = Math.min(26, Math.max(0, ...shown.map(t => handleOf(t).length)));

  const L = [];
  if (shown.length) {
    L.push('## BEST GROUND');
    for (const t of shown) {
      // "swept" is a claim about work done, so it is only said when a sweep date exists. A
      // territory that was merely re-verified says so — the agent decides what to do next from
      // this line, and a sweep it never had would send it past good ground.
      const seen = t.data.last_swept
        ? 'swept ' + agoFrom(t.data.last_swept, m.now)
        : 'seen ' + agoLabel(t.data, m.now);
      L.push('- ' + pad(handleOf(t), w) + '  ' + t.stats.hit_rate + '% · ' + plural(t.stats.wins, 'win') + ' / ' +
        t.stats.finds + ' finds · ' + seen + (t.stale ? '  ← STALE' : ''));
    }
  }
  if (blocked.length) {
    L.push('## BLOCKED');
    for (const t of blocked) {
      L.push('- ' + pad(handleOf(t), w) + '  ' + (t.access === 'requested'
        ? 'pending since ' + agoLabel({ verified_at: t.data.access_changed || t.data.updated }, m.now).replace(' ago', '')
        : t.access + (t.data.access_changed ? ' ' + dayOf(t.data.access_changed) : '') + ' · do not re-request'));
    }
  }
  if (untried.length && level < 1) {
    L.push('## NEVER TRIED');
    for (const t of untried.slice(0, 5)) {
      L.push('- ' + handleOf(t) + (t.data.created_by ? ' (found by ' + t.data.created_by + ' ' + agoLabel({ verified_at: t.data.created }, m.now) + ')' : ''));
    }
  }
  // Every level of this section is a summary, so every level names what it left out. Recording a
  // drop only once the ladder engages would make the DEFAULT render the silent one.
  const dropped = [];
  const hiddenBest = Math.max(0, open.length - shown.length);
  if (hiddenBest) dropped.push('territory beyond top-' + topN + ' / stalest-3 / blocked (' + hiddenBest + ' rows)');
  const hiddenUntried = level >= 1 ? untried.length : Math.max(0, untried.length - 5);
  if (hiddenUntried) dropped.push('never-tried territory (' + hiddenUntried + ')');
  return { lines: L, dropped };
}

const SINCE_MAX_LINES = 6;
function sinceLines(m, level) {
  if (!m.events.length) return { lines: [], dropped: [] };
  const label = m.since ? ' (' + sinceLabel(m.since, m.now) + ')' : '';
  const L = ['## SINCE YOUR LAST RUN' + label];
  if (level >= 4) {
    const byType = tally(m.events.map(e => String(e.type || 'event')));
    L.push('- ' + m.events.length + ' events: ' + byType);
    return { lines: L, dropped: ['since-your-last-run detail (' + m.events.length + ' events → counts only)'] };
  }
  const groups = new Map();
  for (const e of m.events) {
    const k = String(e.actor || '?') + '|' + String(e.type || 'event');
    const row = groups.get(k) || { actor: String(e.actor || '?'), type: String(e.type || 'event'), n: 0, reasons: [] };
    row.n++;
    const reason = e.detail && (e.detail.reason || e.detail.why);
    if (reason) row.reasons.push(String(reason));
    groups.set(k, row);
  }
  const VERB = { store: 'added', update: 'updated', merge: 'merged', skip: 'skipped', move: 'moved', archive: 'rejected', refused: 'was refused on', quarantine: 'quarantined', accept: 'accepted', propose: 'proposed', decide: 'decided', claim: 'claimed', inbox: 'dropped in', schema: 'changed the schema', cache: 'regenerated the cache' };
  const rows = [...groups.values()].sort((a, b) => b.n - a.n);
  for (const row of rows.slice(0, SINCE_MAX_LINES)) {
    const why = row.reasons.length ? ': ' + tally(row.reasons) : '';
    L.push('- ' + row.actor + ' ' + (VERB[row.type] || row.type) + ' ' + row.n + why);
  }
  const over = Math.max(0, rows.length - SINCE_MAX_LINES);
  return { lines: L, dropped: over ? ['since-your-last-run lines beyond ' + SINCE_MAX_LINES + ' (' + over + ')'] : [] };
}
function tally(values) {
  const c = new Map();
  for (const v of values) c.set(v, (c.get(v) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => n + '× ' + k).join(', ');
}
function sinceLabel(since, now) {
  const h = Math.round((now - since) / 36e5);
  if (h < 1) return 'just now';
  if (h < 48) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

function countsLine(m) {
  const bits = [];
  const perCollection = m.collections
    .map(c => ({ id: c.id, n: m.records.filter(d => matchesQuery(d, c.query)).length }))
    .filter(x => x.n).sort((a, b) => b.n - a.n);
  for (const c of perCollection) bits.push(c.id + ' ' + c.n);
  // The gate stages of the biggest collection — the queue the human is actually working.
  const top = perCollection[0] && m.collections.find(c => c.id === perCollection[0].id);
  const gate = top && gateField(top);
  if (gate) {
    const rows = m.records.filter(d => matchesQuery(d, top.query));
    for (const o of (gate.options || [])) {
      const value = typeof o === 'string' ? o : o && o.value;
      const group = typeof o === 'object' && o ? o.group : null;
      if (!value || group === 'done') continue;
      const n = rows.filter(d => String(d.data[gate.key] ?? '') === String(value)).length;
      if (n) bits.push(value + ' ' + n);
    }
  }
  bits.push('territory ' + m.territory.length);
  if (m.tasksOpen) bits.push('tasks open ' + m.tasksOpen);
  return bits.join(' · ');
}

// ── the render ─────────────────────────────────────────────────────────────────────────────────
// One function, one shape, six compression levels. Level 0 is everything; each level above drops
// exactly one thing, in the fixed order of docs/03_MEMORY.md §2; level 6 is the last-resort trim.
function compose(m, level, version) {
  const dropped = [];
  const L = [];
  L.push('<scout-context v="' + version + '" generated="' + nowStamp() + '"' + (m.pid ? ' project="' + m.pid + '"' : '') + '>');
  L.push('');

  // Identity, in full. It is two pages and it is the whole reason the agent is not a stranger.
  L.push('## WHO I WORK FOR');
  L.push(demoteHeadings(m.me.body) || '(not set — ask them the setup questions)');
  L.push('');

  const goals = level >= 5 ? m.goals.filter(g => g.behind) : m.goals;
  if (level >= 5 && m.goals.length !== goals.length) dropped.push('goals on track (' + (m.goals.length - goals.length) + ')');
  if (goals.length) { L.push('## GOALS'); for (const g of goals) L.push(goalLine(g)); L.push(''); }

  if (m.pid) {
    L.push('## PROJECT · ' + m.pid);
    if (m.brief) L.push(demoteHeadings(level >= 1 ? (firstParagraph(m.brief) || m.brief.slice(0, 400)) : m.brief.slice(0, 700)));
    L.push('Brief: projects/' + m.pid + '/brief.md');
    L.push('');
  }

  const terr = territorySections(m, level);
  dropped.push(...terr.dropped);
  if (terr.lines.length) { L.push(...terr.lines); L.push(''); }

  // Stale claims are EXCLUDED from the cache and stay in their file (docs/03_MEMORY.md §4).
  const live = m.playbook.filter(p => !p.stale).sort((a, b) =>
    (a.status === 'retired') - (b.status === 'retired') || b.wins - a.wins || a.id.localeCompare(b.id));
  if (live.length) {
    L.push('## WHAT WORKS  (open with GET /api/playbook/:id)');
    for (const p of live) {
      // Never the claim itself: the whole point of the line is to stop the agent re-deriving the
      // retired belief, and printing the belief does exactly the opposite.
      if (p.status === 'retired') { L.push('- ~~' + p.id + '~~ — RETIRED' + (p.retiredBecause ? ', ' + p.retiredBecause : '')); continue; }
      if (level >= 2) { L.push('- ' + p.id); continue; }
      L.push('- ' + p.id + (p.line ? ' — ' + p.line : '') + (p.wins ? ' · ' + plural(p.wins, 'win') : ''));
    }
    L.push('');
    if (level >= 2) dropped.push('playbook one-liners (' + live.length + ' claims → titles only)');
  }

  const learnings = level >= 3
    ? m.learnings.filter(l => l.ageDays <= LEARNING_COMPRESS_DAYS)
    : m.learnings;
  if (level >= 3 && m.learnings.length !== learnings.length) {
    dropped.push('learnings older than ' + LEARNING_COMPRESS_DAYS + 'd unverified (' + (m.learnings.length - learnings.length) + ')');
  }
  if (learnings.length) { L.push('## LEARNED'); for (const l of learnings) L.push('- ' + l.claim); L.push(''); }

  const since = sinceLines(m, level);
  dropped.push(...since.dropped);
  if (since.lines.length) { L.push(...since.lines); L.push(''); }

  if (m.questions.length) {
    L.push('## OPEN QUESTIONS FROM YOU');
    for (const q of m.questions.slice(0, QUESTION_MAX)) L.push('- "' + q.text + '" — still unanswered');
    L.push('');
    const over = Math.max(0, m.questions.length - QUESTION_MAX);
    if (over) dropped.push('open questions beyond ' + QUESTION_MAX + ' (' + over + ')');
  }

  L.push('## COUNTS');
  L.push(countsLine(m));
  if (dropped.length) {
    L.push('');
    L.push('## COMPRESSED');
    L.push('Dropped to stay under the ' + CACHE_TOKEN_BUDGET + '-token budget: ' + dropped.join('; '));
  }
  L.push('</scout-context>');
  return { text: L.join('\n') + '\n', dropped };
}

// THE ONLY producer of the agent's wake-up context.
export function renderCache({ project = null, now = Date.now(), docs = null, version = null } = {}) {
  ensureWired();
  const m = gather({ project, now, docs });
  // No invented number: an un-generated cache renders v="0", which is exactly what
  // GET /api/cache/version reports for it. Two answers to one question is worse than a zero.
  const v = version != null ? version : readVersion(m.pid).v;

  let out = null;
  for (let level = 0; level <= 5; level++) {
    out = compose(m, level, v);
    if (out.text.length <= CACHE_CHAR_BUDGET) break;
  }
  // Last resort. It is still not silent: the trim is named in `dropped` and logged like every
  // other drop, because a context that quietly loses its COUNTS is a context nobody can trust.
  if (out.text.length > CACHE_CHAR_BUDGET) {
    const close = '\n## COMPRESSED\nDropped to stay under the ' + CACHE_TOKEN_BUDGET + '-token budget: ' +
      [...out.dropped, 'tail (hard trim)'].join('; ') + '\n(truncated)\n</scout-context>\n';
    out = { text: out.text.slice(0, CACHE_CHAR_BUDGET - close.length) + close, dropped: [...out.dropped, 'tail (hard trim)'] };
  }

  const excluded = m.playbook.filter(p => p.stale).map(p => 'playbook/' + p.id + ' (stale — re-verify or retire)');
  const tokens = estimateTokens(out.text);
  if (out.dropped.length || excluded.length) {
    hooks.logEvent({ type: 'cache', actor: 'scout', target: (m.pid ? 'projects/' + m.pid + '/.cache/context.md' : '.scout/cache/context.md'), detail: { tokens, dropped: out.dropped, excluded } });
  }
  return { text: out.text, tokens, chars: out.text.length, version: v, project: m.pid, dropped: out.dropped, excluded, budget: CACHE_TOKEN_BUDGET };
}

// Writes the file and increments `v`. An agent that cached a context asks GET /api/cache/version —
// one cheap call — to learn whether it must re-read.
export function regenerateCache({ project = null, now = Date.now() } = {}) {
  ensureWired();
  // The version counter is per scope, so read it from the scope this render will actually write.
  const pid = scopeOf(project);
  const next = readVersion(pid).v + 1;
  const rendered = renderCache({ project, now, version: next });
  const dir = scoutPaths.cacheDir(pid);
  fs.mkdirSync(dir, { recursive: true });
  const file = scoutPaths.cache(pid);
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, rendered.text);
  fs.renameSync(tmp, file);
  const stampedAt = nowStamp();
  const rel = path.relative(R2(), file).split(path.sep).join('/');
  const meta = {
    v: next, generated: stampedAt, path: rel, project: pid,
    tokens: rendered.tokens, chars: rendered.chars, budget: CACHE_TOKEN_BUDGET,
    dropped: rendered.dropped, excluded: rendered.excluded,
  };
  const vtmp = scoutPaths.cacheVersion(pid) + '.' + process.pid + '.tmp';
  fs.writeFileSync(vtmp, JSON.stringify(meta, null, 2));
  fs.renameSync(vtmp, scoutPaths.cacheVersion(pid));
  return { ...rendered, path: rel, generated: stampedAt };
}

// What GET /api/context serves: the generated file, so the text the agent reads and the integer it
// polls are the same artefact. Missing (never generated, or `.scout/` deleted — it is disposable
// by Law 1) → generate it once, now.
export function readCache({ project = null } = {}) {
  ensureWired();
  const pid = scopeOf(project);
  const meta = readVersion(pid);
  let text = null;
  if (meta.v) { try { text = fs.readFileSync(scoutPaths.cache(pid), 'utf8'); } catch { text = null; } }
  if (text == null) return regenerateCache({ project });
  return {
    text, tokens: meta.tokens ?? estimateTokens(text), chars: meta.chars ?? text.length,
    version: meta.v, generated: meta.generated, project: pid,
    dropped: meta.dropped || [], excluded: meta.excluded || [],
    budget: CACHE_TOKEN_BUDGET, path: meta.path || null,
  };
}

// Debounced 2s: a batch write of fifty records must regenerate the cache once, not fifty times.
export const CACHE_DEBOUNCE_MS = 2000;
const cacheTimers = new Map();
export function scheduleCacheRegen({ project = null } = {}) {
  const key = project || '';
  const prev = cacheTimers.get(key);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    cacheTimers.delete(key);
    try { regenerateCache({ project }); } catch { /* a cache that cannot be written is still only a cache */ }
  }, CACHE_DEBOUNCE_MS);
  if (typeof t.unref === 'function') t.unref(); // never hold the process (or a test run) open
  cacheTimers.set(key, t);
  return { scheduled: true, in: CACHE_DEBOUNCE_MS };
}
// Tests and shutdown paths: drop any pending regeneration.
export function cancelCacheRegen() {
  for (const t of cacheTimers.values()) clearTimeout(t);
  cacheTimers.clear();
}

// ── routes ─────────────────────────────────────────────────────────────────────────────────────
// registerScoutMemoryRoutes(app, { logEvent, readEvents, lastRunAt }) — all optional, all no-ops.
export function registerScoutMemoryRoutes(app, deps = {}) {
  setScoutMemoryHooks(deps);
  ensureWired();
  const actorOf = req => String(req.body?.actor || 'crystal');
  // frontend/api.js sends { patch, actor }; the agent doors send the fields flat. Accept both.
  const patchOf = req => {
    const b = req.body || {};
    if (b.patch && typeof b.patch === 'object') return b.patch;
    const { actor, ...rest } = b;
    return rest;
  };
  const fail = (res, e) => res.status(e.status || 400).json({ error: e.message });

  // The agent's whole wake-up read. `?format=md` returns the file itself, which is what
  // `curl .../api/context` in docs/04_AGENT_CONTRACT.md §2 wants; the default is JSON because the
  // WHAT THEY KNOW panel needs the token count, the version and the dropped list beside the text.
  app.get('/api/context', (req, res) => {
    const project = req.query.project ? String(req.query.project) : null;
    // The generated file, not a fresh render: its `v` is the one GET /api/cache/version reports.
    const out = readCache({ project });
    // MARKDOWN BY DEFAULT. `docs/04_AGENT_CONTRACT.md` §2 writes this route as
    //     curl -s http://127.0.0.1:5177/api/context     # or: read .scout/cache/context.md
    // — the two are stated as the same thing, and `skills/scout-router/SKILL.md` curls it bare and
    // reads the result as the cache. Answering JSON there hands an agent a quoted blob with
    // escaped newlines instead of its wake-up context, and it would have "worked" in every test
    // that checked a status code.
    //
    // The UI needs the envelope (tokens, dropped, version) for WHAT THEY KNOW, so it asks for it:
    // `?format=json`, or an `Accept: application/json` header. frontend/api.js sends the former.
    const wantsJson = String(req.query.format || '') === 'json'
      || /application\/json/.test(String(req.headers.accept || ''));
    if (wantsJson) return res.json(out);
    res.type('text/markdown').send(out.text);
  });

  app.get('/api/cache/version', (req, res) => {
    res.json(cacheVersion({ project: req.query.project ? String(req.query.project) : null }));
  });

  app.post('/api/cache/regenerate', (req, res) => {
    try { res.json({ ok: true, ...regenerateCache({ project: req.body?.project || null }) }); }
    catch (e) { fail(res, e); }
  });

  app.get('/api/me', (_req, res) => res.json(readMe()));
  app.put('/api/me', (req, res) => {
    try { res.json({ ok: true, me: writeMe(req.body?.body, req.body?.data || {}, { actor: actorOf(req) }) }); }
    catch (e) { fail(res, e); }
  });

  app.get('/api/goals', (_req, res) => res.json({ goals: listGoals() }));
  app.patch('/api/goals/:id', (req, res) => {
    try { res.json({ ok: true, goal: saveGoal(req.params.id, patchOf(req), { actor: actorOf(req) }) }); }
    catch (e) { fail(res, e); }
  });

  app.get('/api/playbook', (_req, res) => res.json({ playbook: listPlaybook() }));
  app.get('/api/playbook/:id', (req, res) => {
    const p = getPlaybook(req.params.id);
    if (!p) return res.status(404).json({ error: 'no playbook claim "' + req.params.id + '"' });
    res.json(p);
  });
  app.patch('/api/playbook/:id', (req, res) => {
    try { res.json({ ok: true, playbook: savePlaybook(req.params.id, patchOf(req), { actor: actorOf(req) }) }); }
    catch (e) { fail(res, e); }
  });

  app.get('/api/learnings', (req, res) => res.json({
    learnings: listLearnings({ status: req.query.status ? String(req.query.status) : null }),
    graduations: graduationCandidates(),
  }));
  app.post('/api/learnings/propose', (req, res) => {
    try {
      const b = req.body || {};
      const id = String(b.id || b.claim || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      if (!id) return res.status(400).json({ error: 'a learning needs a claim' });
      const { actor, id: _drop, ...patch } = b;
      res.json({ ok: true, learning: saveLearning(id, { ...patch, status: 'proposed' }, { actor: String(actor || 'scout-fb') }) });
    } catch (e) { fail(res, e); }
  });
  app.patch('/api/learnings/:id', (req, res) => {
    try { res.json({ ok: true, learning: saveLearning(req.params.id, patchOf(req), { actor: actorOf(req) }) }); }
    catch (e) { fail(res, e); }
  });
}
