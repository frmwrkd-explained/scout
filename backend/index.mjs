// MUST stay first: populates process.env from .env before store.mjs captures SCOUT_CONFIG/SCOUT_DATA
import './env.mjs';
import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  getStorageRoot, setStorageRoot, getSettings, publicSettings, saveSettings,
  listProjects, createProject, patchProject, archiveProject, restoreProject,
  saveBrief, listItems, getItem, patchItem, deleteItem, findItemProjects,
  appendActivity, getActivity, bumpHistory, getHistory,
  scanSkillRepos, browse, stamp, safeScope, readMd, writeMd,
  listContext, saveContextFile, deleteContextFile, contextFilePath,
  createContextFolder, deleteContextFolder,
  readSkillFile, writeSkillFile
} from './store.mjs';
import { enqueueReroll, enqueueSkillEnhance, listJobs, testAgent, agentStatus, agentProviders, installAgent, openLogin, findAgent, buildAgentArgs, runOnce } from './jobs.mjs';
import { groqKey, transcribe } from './groq.mjs';
import { listAssets, saveAsset, deleteAsset, createCollection, deleteCollection, copyAsset, assetPath, scopeDir, readMeta, writeMeta, renameAsset, moveAsset, renameCollection, metaPath } from './library.mjs';
import { getLedger, getLedgerRollup } from './ledger.mjs';
import { registerMemoryRoutes } from './memory.mjs';
import { registerBoardRoutes } from './board.mjs';
import { journalAction, listActions, getAction, markAction } from './actions.mjs';
import { stageTrash, listTrash, restoreTrash, purgeTrash, purgeAllTrash } from './trash.mjs';
import { currentRevision, bump, changedSince, subscribe, integrityReport, reconcile, startWatch } from './indexer.mjs';
import { listSessions, getSession, saveSession, deleteSession } from './sessions.mjs';
import { registerChatRoutes, getSession as getChatSession } from './chat.mjs';
import { registerDistillRoutes } from './distill.mjs';
import { registerAgentHomeRoutes, chatSkillsSurface } from './agentHome.mjs';
import { testAgentPipeline } from './agentRunner.mjs';
import { registerUserToolRoutes } from './userTools.mjs';
import { search as structuredSearch } from './search.mjs';
import { registerFeedbackRoutes, installLogRing, recordApiCall, flushOutbox } from './feedback.mjs';
import { listCollections, getCollection, saveCollection, addField, FIELD_TYPE_NAMES } from './collections.mjs';
import { documentsFor, documentAt, collectionsOf, allDocuments, referencesTo, viewFor } from './documents.mjs';
import { listViews, getView, saveView, deleteView, applyView, defaultView } from './views.mjs';
// ── Scout's own spine (M2–M5) ────────────────────────────────────────────────────────────────
// Each of these owns its routes and mounts them through a registerXRoutes(app, deps) call below,
// so this file stays a wiring diagram rather than becoming a second home for the logic.
import { registerRecordRoutes, excludeQuarantined, sweepQuarantine } from './records.mjs';
import { registerScoutMemoryRoutes, scheduleCacheRegen } from './memory.mjs';
import { registerFileRoutes } from './files.mjs';
import { registerIndexRoutes } from './agentIndex.mjs';
import { registerScoutBoardRoutes } from './scoutBoard.mjs';
import { registerIntakeRoutes, isFirstRun } from './intake.mjs';
import { registerTerritoryRoutes } from './territory.mjs';
import { registerTaskRoutes } from './tasks.mjs';
import { registerProposalRoutes } from './proposals.mjs';
import { registerInboxRoutes, startInboxWatch, ensureInbox, refreshAgentFiles } from './inbox.mjs';
import { logEvent, readEvents } from './log.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 5177;

// Reveal a path in the OS file manager — cross-platform, best-effort, never throws.
// `select` reveals the file inside its folder; otherwise the folder itself is opened.
// An error callback is mandatory: execFile with no callback emits an unhandled 'error'
// event (crashing the server) when the launcher binary is missing (Linux/Windows).
// Under tests this is a no-op: the export/handoff routes reveal unconditionally, so a full
// `node --test` run would otherwise spawn a real Finder window per exercised route.
function revealInOS(target, select = false) {
  if (process.env.SCOUT_TEST) return;
  import('child_process').then(({ execFile }) => {
    const noop = () => {};
    if (process.platform === 'darwin') execFile('open', select ? ['-R', target] : [target], noop);
    else if (process.platform === 'win32') {
      if (select) execFile('explorer', ['/select,', target], noop);
      else execFile('explorer', [target], noop);
    } else execFile('xdg-open', [select ? path.dirname(target) : target], noop);
  }).catch(() => {});
}

// Boot side-effects (seed, orphan sweep) and the auto-analyze loop + app.listen run ONLY when this
// module is the process entry point. Imported for tests (see test/), the app is built but nothing
// binds a port or mutates the storage root — the test harness listens on an ephemeral port itself.
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const app = express();

// ── local-only guard: the API is unauthenticated and /api/state carries the buyer's API
// keys, so a visited web page must never be able to reach it. Block DNS-rebinding (Host
// header must resolve to loopback) and cross-site requests (Origin, when present, must be
// same-origin). Browsers can't spoof Origin/Host, so this closes the exfiltration vector
// while leaving the real UI (served from this same origin) untouched. Opt into LAN access
// with SCOUT_ALLOW_LAN=1.
const ALLOW_LAN = process.env.SCOUT_ALLOW_LAN === '1' || process.env.HOST === '0.0.0.0';
app.use((req, res, next) => {
  if (ALLOW_LAN) return next();
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  const hostOk = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host === '';
  if (!hostOk) return res.status(403).json({ error: 'blocked: non-local Host header' });
  const origin = req.headers.origin;
  if (origin) {
    let oh = '';
    try { oh = new URL(origin).hostname.toLowerCase(); } catch { oh = 'invalid'; }
    if (oh !== 'localhost' && oh !== '127.0.0.1' && oh !== '::1') {
      return res.status(403).json({ error: 'blocked: cross-origin request' });
    }
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

// ── revision push (Phase 4): every successful app mutation bumps the app revision for its domain,
// which is pushed to SSE subscribers so the client updates without a blind 2s poll. External agent
// edits are caught separately by the indexer's fs.watch + periodic reconcile.
function domainFor(p) {
  if (/\/items(\/|$|\?)/.test(p) || p.startsWith('/api/trash') || p.startsWith('/api/staged-trash') || p.startsWith('/api/actions')) return ['items'];
  // the board is a VIEW of shots and assets; a node move repaints neither, but a sync/align can
  // add cards for shots the client has not loaded, so it rides the shots domain
  if (p.startsWith('/api/board')) return ['shots'];
  if (p.startsWith('/api/context') || p.startsWith('/api/assets') || p.startsWith('/api/library')) return ['assets'];
  if (p.startsWith('/api/settings')) return ['settings'];
  if (p.startsWith('/api/brief') || p.startsWith('/api/projects')) return ['projects'];
  if (p.startsWith('/api/memory') || p.startsWith('/api/folders')) return ['memory'];
  if (p.startsWith('/api/prompts') || p.startsWith('/api/snippets') || p.startsWith('/api/looks')) return ['prompts'];
  return ['misc'];
}
// ONE finish listener doing two jobs, deliberately. The revision bump fires on successful
// mutations; the feedback API ring records every /api call so a bug report can carry what the app
// was actually doing. A second app.use with its own res.on('finish') would double the per-request
// listener cost for a feature that is idle 99.9% of the time.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const started = Date.now();

  // review-session cursor saves are the reviewing client's own high-frequency bookkeeping — echoing
  // them back over SSE would trigger a refetch storm mid-review for no benefit, so they don't bump.
  const bumps = req.method !== 'GET'
    && !req.path.startsWith('/api/review-sessions')
    && !req.path.startsWith('/api/ui-state');

  // Bodies are never captured (spec §2.5). The one exception is the `error` string our own routes
  // return on a failure: written for a human, carries no secrets, and is usually the whole bug.
  let errText = null, errCode = null;
  const json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode >= 400 && body && typeof body === 'object') {
      if (body.error) errText = String(body.error).slice(0, 500);
      if (body.code) errCode = String(body.code).slice(0, 60);
    }
    return json(body);
  };

  res.on('finish', () => {
    if (bumps && res.statusCode >= 200 && res.statusCode < 300) bump(domainFor(req.path));
    recordApiCall({
      t: started, method: req.method, url: req.originalUrl || req.path,
      status: res.statusCode, ms: Date.now() - started,
      ...(errText ? { error: errText } : {}), ...(errCode ? { code: errCode } : {})
    });
  });
  next();
});

// ── feature-module route blocks (see docs/integration/*) ──
registerMemoryRoutes(app, { appendActivity, bumpHistory });
registerBoardRoutes(app, { appendActivity });
registerDistillRoutes(app, { appendActivity, bumpHistory }); // ticket 20 — session-end distillation + idle sweep (before chat routes so the sweep middleware runs first)
registerChatRoutes(app, { appendActivity }); // filmmaker chat sessions (ticket 08) → chat/ + projects/<pid>/chat/
registerAgentHomeRoutes(app, { saveSettings, appendActivity, getSession: getChatSession }); // ticket 10 — router skill / Index / isolated home
// ticket 25 — user-authored tools. Deliberately NOT under /api/chat: authoring a tool is a workspace
// operation that stays available with the chat module off (the tool simply has nothing to run in).
registerUserToolRoutes(app, { appendActivity });
// beta feedback (backend/feedback.mjs) — the ONLY outbound call in this app to a server we own.
registerFeedbackRoutes(app);

// ── Scout: memory, orchestration and the doors ────────────────────────────────────────────────
// `logEvent` is handed to every module as a dep rather than imported by each of them. One append
// point means the Activity drawer shows the whole truth and there is nowhere for a mutation to
// happen quietly — which is the only thing that makes Law 4's guarantee checkable.
registerRecordRoutes(app, { logEvent, refreshAgentFiles });
registerScoutMemoryRoutes(app, { logEvent });
// `revealInOS` is declared in this file and is the ONE spawner — injecting it is what stops
// files.mjs writing a second one. Without it the route answers 501 naming this exact fix.
registerFileRoutes(app, { logEvent, revealInOS });
registerIndexRoutes(app, { logEvent });
registerScoutBoardRoutes(app, { logEvent });
registerIntakeRoutes(app, { logEvent });

// Scout's projects, which are folders under `projects/` with a `project.md` — not FrameForge's
// `listProjects()`, which reads the same directory for a different object and would hand the rail
// a shape it cannot render. Two things named "project" is a naming problem, not a reason to make
// one of them serve both.
app.get('/api/scout/projects', (_req, res) => {
  const dir = path.join(getStorageRoot(), 'projects');
  let ids = [];
  try {
    ids = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map(e => e.name).sort();
  } catch { /* no projects yet */ }
  const projects = ids.map(id => {
    let data = {};
    try { ({ data } = readMd(path.join(dir, id, 'project.md'))); } catch { /* folder without a project.md */ }
    return { id, label: data.label || data.name || id, ...data, path: 'projects/' + id + '/project.md' };
  });
  res.json({ projects });
});
registerTerritoryRoutes(app, { logEvent });
registerTaskRoutes(app, { logEvent });
registerProposalRoutes(app, { logEvent });
registerInboxRoutes(app, { logEvent });

// pid/scope route params become filesystem path segments — allow only slug charset
// (project ids are kebab slugs; scope is 'library' or a project id). Blocks %2F traversal.
const SLUG = /^[\w-]+$/;
app.param('pid', (req, res, next, v) => SLUG.test(v) ? next() : res.status(400).json({ error: 'invalid project id' }));
app.param('scope', (req, res, next, v) => SLUG.test(v) ? next() : res.status(400).json({ error: 'invalid scope' }));

// ── SSE push (Phase 4): tiny {rev, domains} events; the client fetches the actual state itself ──
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  res.write('event: hello\ndata: ' + JSON.stringify({ rev: currentRevision() }) + '\n\n');
  subscribe(res);
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
  hb.unref?.();
  req.on('close', () => clearInterval(hb));
});

// ── persistent review sessions (Phase 5) — the Inbox cursor survives reload/restart ──
app.get('/api/review-sessions', (_req, res) => res.json(listSessions()));
app.get('/api/review-sessions/:id', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  res.json(s);
});
app.post('/api/review-sessions', (req, res) => res.json(saveSession(req.body || {})));
app.patch('/api/review-sessions/:id', (req, res) => res.json(saveSession({ ...(req.body || {}), id: req.params.id })));
app.delete('/api/review-sessions/:id', (req, res) => { deleteSession(req.params.id); res.json({ ok: true }); });

// ── serializable UI state (Phase 6) — ui-state.md holds ONLY non-sensitive location + prefs ──
const uiStateMd = () => path.join(getStorageRoot(), 'ui-state.md');
// This list IS the contract: a key the client sends that is not here is dropped in silence, which
// is how the Production Panel's per-section disclosure never persisted — it saved, answered 200,
// and reopened collapsed every time. The response now echoes what was ignored, so the next
// mismatch shows up in the network tab instead of looking like a broken preference.
const UI_ALLOWED = ['location', 'density', 'ctxSize', 'frecency', 'launchIntoInbox', 'prodPanelCollapsed', 'prodSections', 'chatSidebarW', 'prodPanelW'];
app.get('/api/ui-state', (_req, res) => { try { res.json(readMd(uiStateMd()).data || {}); } catch { res.json({}); } });
app.put('/api/ui-state', (req, res) => {
  let prev = {}; try { prev = readMd(uiStateMd()).data || {}; } catch { /* first write */ }
  const next = { ...prev };
  for (const k of UI_ALLOWED) if (req.body?.[k] !== undefined) next[k] = req.body[k];
  next.updated = stamp();
  writeMd(uiStateMd(), next, 'Scout UI state — last location + non-sensitive prefs. No secrets.\n');
  res.json(next);
});

// ── collections · documents · views (M1) ───────────────────────────────────────────────────────
// A collection is a saved query; a document matches or it does not. Nothing here writes a document
// file — that is records.mjs's job at M2, and adding a second writer now would bypass dedupe,
// provenance and the gate undetectably.

app.get('/api/collections', (_req, res) => res.json({ collections: listCollections(), fieldTypes: FIELD_TYPE_NAMES }));

app.get('/api/collections/:id', (req, res) => {
  const c = getCollection(req.params.id);
  if (!c) return res.status(404).json({ error: 'no collection "' + req.params.id + '"' });
  res.json(c);
});

app.post('/api/collections', (req, res) => {
  try { res.json(saveCollection(req.body || {})); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

app.patch('/api/collections/:id', (req, res) => {
  const c = getCollection(req.params.id);
  if (!c) return res.status(404).json({ error: 'no collection "' + req.params.id + '"' });
  try { res.json(saveCollection({ ...c, ...(req.body || {}), id: req.params.id })); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// `actor` is WHO IS ADDING the field, not part of the field. It has to be destructured off here:
// `validateField` rejects any key outside the type's allowlist — deliberately, so a typo cannot
// sit unnoticed in a schema for weeks — so passing the request body through whole made EVERY
// manual `+ Add property` 400 with `"actor" is not an option of type text`. The agent path
// (proposals.mjs → addField(card.collection, card.field)) always passed a clean field, so only
// the human's door was broken. CLAUDE.md: a field a route does not destructure does not exist.
app.post('/api/collections/:id/fields', (req, res) => {
  const { actor = 'crystal', ...field } = req.body || {};
  try {
    const collection = addField(req.params.id, field);
    // A schema change is a mutation, and every mutation lands in the log — that is the only place
    // the actor belongs. `schema` is already in log.mjs EVENT_TYPES; the agent's accepted field
    // proposal logs the same type from proposals.mjs.
    logEvent({
      type: 'schema', actor,
      target: '.scout/collections/' + req.params.id + '.md',
      detail: { change: 'field', field: field.key, field_type: field.type },
    });
    res.json(collection);
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// ?view=<id> applies a saved view; ?bind=<json> is the subtable case (a collection plus a bound
// parameter — one mechanism, no second storage).
app.get('/api/collections/:id/documents', async (req, res) => {
  let bind = null;
  if (req.query.bind) { try { bind = JSON.parse(String(req.query.bind)); } catch { return res.status(400).json({ error: 'bind must be JSON' }); } }
  try {
    // ONE composition, in documents.mjs, shared with door 3. See viewFor()'s note: the quarantine
    // rule (Law 4) has to be applied where every view is assembled, not re-assembled per caller.
    const out = await viewFor(req.params.id, { view: req.query.view ? String(req.query.view) : null, bind, all: !!req.query.all });
    if (!out) return res.status(404).json({ error: 'no collection "' + req.params.id + '"' });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/views/:collection', (req, res) => {
  const found = listViews(req.params.collection);
  if (!found) return res.status(404).json({ error: 'no collection "' + req.params.collection + '"' });
  res.json(found);
});

app.put('/api/views/:collection', (req, res) => {
  try { res.json({ views: saveView(req.params.collection, req.body || {}) }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

app.delete('/api/views/:collection/:id', (req, res) => {
  try { res.json({ views: deleteView(req.params.collection, req.params.id) }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// One document, by its path in the store. Law 8: every record shows its path and the path is how
// you reach it — the same string the UI prints is the one the API takes.
app.get('/api/document', (req, res) => {
  const doc = documentAt(String(req.query.path || ''));
  if (!doc) return res.status(404).json({ error: 'no document at that path' });
  res.json({ ...doc, collections: collectionsOf(doc) });
});

// REFERENCED BY (T05 §2) — every document whose frontmatter points at this one, with the pointing
// field and the source collection. Deliberately NOT folded into /api/document: it walks the whole
// store, and the inspector section is collapsed until someone opens it, so the document surface
// must not pay for it on open. Takes `path` (what the UI has) or `slug` (what a relation value is).
app.get('/api/document/references', (req, res) => {
  const relPath = String(req.query.path || '');
  const slug = String(req.query.slug || '');
  if (!relPath && !slug) return res.status(400).json({ error: 'path or slug is required' });
  let target = slug;
  if (relPath) {
    target = documentAt(relPath);
    if (!target) return res.status(404).json({ error: 'no document at that path' });
  }
  const references = referencesTo(target);
  res.json({ references, total: references.length });
});

// ── dictation ──────────────────────────────────────────────────────────────────────────────────
// Not film. frontend/VoiceInput.jsx is a keeper (docs/06_REUSE.md) and GOAL.md's first-run
// interview is voice-enabled, so this route survived the strip. FrameForge had a second engine
// here (local Parakeet) behind a settings toggle; that went with backend/localAsr.mjs, so there is
// one engine and a plain error rather than a fallback ladder.
app.post('/api/groq/transcribe', express.raw({ type: '*/*', limit: '80mb' }), async (req, res) => {
  try {
    const text = await transcribe(req.body, String(req.query.name || 'audio.m4a'));
    bumpHistory('prompts');
    res.json({ text, engine: 'groq' });
  } catch (e) { res.status(502).json({ error: e.message || 'Transcription failed' }); }
});

// ── structured search (Phase 9) — typed filters + free text → exact location objects; no secrets ──
app.get('/api/search', (req, res) => {
  try { res.json(structuredSearch(String(req.query.q || ''), { cursor: Number(req.query.cursor) || 0 })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// derived index integrity — one malformed .md is quarantined, never crashes /api/state
app.get('/api/integrity', (_req, res) => res.json(integrityReport()));
app.post('/api/integrity/rebuild', (_req, res) => { reconcile(); res.json({ ok: true, ...integrityReport() }); });

app.get('/api/state', (req, res) => {
  // delta probe: /api/state?since=<rev> → which domains changed (client decides whether to refetch).
  // A null result means the change log doesn't reach that far back → do a full refetch.
  if (req.query.since !== undefined) {
    const changed = changedSince(req.query.since);
    if (changed !== null) return res.json({ revision: currentRevision(), full: false, changed });
  }
  const projects = listProjects().map(p => ({
    ...p,
    context: listAssets(p.id)        // context items incl. vision meta sidecars
  }));
  res.json({
    revision: currentRevision(),
    storageRoot: getStorageRoot(),
    settings: publicSettings(),
    projects,
    items: listItems(),
    library: listAssets('library'),
    activity: getActivity(),
    history: getHistory(),
    skillRepos: scanSkillRepos(),
    chatSkills: chatSkillsSurface(), // ticket 10 — router (read-only/system), house-rules (editable), packs, tools

    ledger: getLedger(),
    ledgerRollup: getLedgerRollup(),   // permanent monthly totals — correct past the 500-row detail cap
    jobs: listJobs(),
    reviewSessions: listSessions(),   // persistent Inbox sessions (Phase 5)
    groqReady: !!groqKey()
  });
});

// ── projects: create / edit / archive (F1.1 — archive renames the dir, never deletes) ──
app.post('/api/projects', (req, res) => {
  try {
    const p = createProject({ name: req.body?.name, sub: String(req.body?.sub || ''), gradIx: req.body?.gradIx });
    appendActivity({ dot: 'green', t: 'Project created', t2: '· ' + p.name, s: 'projects/' + p.id + '/ scaffolded — brief, story, moodboard, shots', kind: 'proj', ref: p.id, hl: 1 });
    res.json(p);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// DEV-136 — AGENT MODE for the new-project dialog. One no-tools, no-resume agent call that turns
// "what is this project?" into a proposed name / subtitle / gradient / opening story beats. It
// PROPOSES ONLY: nothing is written until the user confirms in the dialog and the ordinary
// POST /api/projects runs. Deliberately the cheap one-shot path (the same buildAgentArgs shape the
// settings probe uses) rather than a chat session — there is no conversation here, one question and
// one answer, and a session would leave a stray transcript behind for every abandoned dialog.
app.post('/api/projects/propose', async (req, res) => {
  const idea = String(req.body?.idea || '').trim();
  if (!idea) return res.status(400).json({ error: 'describe the project first' });
  const bin = findAgent();
  if (!bin) return res.status(400).json({ error: 'No agent CLI connected — set one up in Settings → Agent, or use the Manual tab.' });
  const prompt = [
    'You are helping a filmmaker start a new project in a shot-planning app.',
    'Their description: ' + JSON.stringify(idea),
    '',
    'Reply with ONE JSON object and nothing else — no prose, no markdown fence:',
    '{"name": "...", "sub": "...", "gradIx": 0, "story": "..."}',
    '  name    — a short, evocative project title (2-4 words), Title Case',
    '  sub     — one line of format + genre, e.g. "3-min short · solar-punk"',
    '  gradIx  — an integer 0-13 picking a card gradient whose mood fits',
    '  story   — a markdown opening: a "# <name>" heading, a **Logline.** line,',
    '            and 3-5 "## Scene N — <title>" headings with one sentence each'
  ].join('\n');
  try {
    const r = await runOnce(bin, buildAgentArgs(prompt), 180_000);
    const raw = String(r.out || '');
    // the model may still wrap it in a fence or add a sentence — take the outermost object
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: 'The agent did not return a project proposal. ' + String(r.err || raw).slice(0, 200) });
    const j = JSON.parse(m[0]);
    res.json({
      name: String(j.name || '').slice(0, 80),
      sub: String(j.sub || '').slice(0, 120),
      gradIx: Number.isInteger(j.gradIx) ? j.gradIx : 0,
      story: String(j.story || '')
    });
  } catch (e) { res.status(502).json({ error: String(e.message || e).slice(0, 250) }); }
});
app.patch('/api/projects/:pid', (req, res) => {
  const p = patchProject(req.params.pid, req.body || {});
  if (!p) return res.status(404).json({ error: 'project not found' });
  // `styleLock` (the project's default style-lock id — set from the ⚙ Project Settings modal)
  // isn't in store.mjs's patchProject frontmatter allow-list yet, so persist it here directly
  // instead of widening that shared helper. GET /api/state already round-trips it fine since
  // listProjects() spreads the whole project.md frontmatter, unfiltered.
  if (req.body && req.body.styleLock !== undefined) {
    try {
      const file = path.join(getStorageRoot(), 'projects', req.params.pid, 'project.md');
      const { data, content } = readMd(file);
      const next = { ...data, styleLock: req.body.styleLock || undefined };
      writeMd(file, next, content);
      p.styleLock = req.body.styleLock;
    } catch { /* project.md missing/unreadable — the rest of the patch still applied above */ }
  }
  res.json(p);
});
app.post('/api/projects/:pid/archive', (req, res) => {
  try {
    const dir = archiveProject(req.params.pid);
    appendActivity({ dot: 'amber', t: 'Project archived', t2: '· ' + req.params.pid, s: 'moved to projects/' + dir + ' — restorable', kind: 'none' });
    res.json({ archived: dir });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/projects/restore', (req, res) => {
  try {
    const pid = restoreProject(String(req.body?.dir || ''));
    appendActivity({ dot: 'green', t: 'Project restored', t2: '· ' + pid, s: 'back from the archive', kind: 'proj', ref: pid });
    res.json({ id: pid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/assets/:scope/meta', (req, res) => {
  const { name, folder, meta } = req.body || {};
  const p = assetPath(req.params.scope, String(name || ''), String(folder || ''));
  if (!p) return res.status(404).json({ error: 'asset not found' });
  const patch = {};
  if (meta?.description !== undefined) patch.description = String(meta.description);
  if (meta?.tags !== undefined) patch.tags = (Array.isArray(meta.tags) ? meta.tags : []).map(t => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 24);
  if (meta?.palette !== undefined) patch.palette = (Array.isArray(meta.palette) ? meta.palette : []).map(String);
  if (meta?.mood !== undefined) patch.mood = String(meta.mood);
  if (meta?.kind !== undefined) patch.kind = String(meta.kind).toLowerCase().slice(0, 20);
  if (meta?.fav !== undefined) patch.fav = !!meta.fav;
  // label — the human display name for an entity (cast/location/prop) in the story list's
  // production strip. DISPLAY ONLY: shot records point at the asset by its derived key
  // (filename minus extension, see Story.jsx entityPool), never by label, so renaming can
  // never orphan an assignment. Empty string clears it and the key shows through again.
  if (meta?.label !== undefined) patch.label = String(meta.label).slice(0, 60);
  res.json({ meta: writeMeta(p, patch) });
});

// reveal an asset (or a board folder) in Finder — boards are real folders on disk,
// so this is the two-way bridge: drop files in via Finder, jump back out via the app
app.post('/api/assets/:scope/reveal', (req, res) => {
  const { name, folder } = req.body || {};
  let p, cmd;
  if (name) { p = assetPath(req.params.scope, String(name), String(folder || '')); cmd = 'open -R '; }
  else {
    const f = String(folder || '').split('/')[0].replace(/[^\w\- ]+/g, '').trim();
    p = path.join(scopeDir(req.params.scope), f); // f may be '' → the scope root itself
    if (!fs.existsSync(p)) p = null;
    cmd = 'open ';
  }
  if (!p) return res.status(404).json({ error: 'not found' });
  revealInOS(p, cmd === 'open -R ');
  res.json({ ok: true, path: p });
});

// ── asset + folder rename / move (F1.2 — sidecars ride along) ──
app.post('/api/assets/:scope/rename', (req, res) => {
  const { name, folder, newName } = req.body || {};
  try { res.json(renameAsset(req.params.scope, String(name || ''), String(folder || ''), String(newName || ''))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/assets/:scope/move', (req, res) => {
  const { name, folder, toFolder } = req.body || {};
  try { res.json(moveAsset(req.params.scope, String(name || ''), String(folder || ''), String(toFolder || ''))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/assets/:scope/rename-folder', (req, res) => {
  const { name, newName } = req.body || {};
  try { res.json({ name: renameCollection(req.params.scope, String(name || ''), String(newName || '')) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── global asset library ──
app.post('/api/library/upload', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const saved = saveAsset('library', String(req.query.name || 'asset'), req.body, String(req.query.folder || ''));
  appendActivity({ dot: 'amber', t: 'Library asset added', t2: '· ' + (saved.folder ? saved.folder + '/' : '') + saved.name, s: 'available across every project', kind: 'library' });
  res.json(saved);
});
app.get('/api/library/file', (req, res) => {
  const p = assetPath('library', String(req.query.name || ''), String(req.query.folder || ''));
  if (!p) return res.status(404).end();
  res.sendFile(p);
});
app.delete('/api/library/file', (req, res) => {
  deleteAsset('library', String(req.query.name || ''), String(req.query.folder || ''));
  res.json({ ok: true });
});
app.post('/api/library/folder', (req, res) => {
  try { res.json({ name: createCollection('library', String(req.body?.name || '')) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/library/folder', (req, res) => {
  try { deleteCollection('library', String(req.query.name || '')); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/library/copy', (req, res) => {
  const { fromScope, name, folder, toScope, toFolder } = req.body || {};
  try {
    const saved = copyAsset(String(fromScope), String(name), String(folder || ''), String(toScope), String(toFolder || ''));
    appendActivity({ dot: 'amber', t: 'Asset copied', t2: '· ' + saved.name, s: fromScope + ' → ' + toScope, kind: 'library' });
    res.json(saved);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── saved prompts (prompt builder) ──
const promptsDir = () => path.join(getStorageRoot(), 'prompts');
// saved prompts use the same gray-matter store as every other record — a hand-rolled
// "split on the first colon" parser used to corrupt any value containing a colon (prompt
// names, the axes JSON) on the next PATCH.
app.get('/api/prompts', (req, res) => {
  const dir = promptsDir();
  if (!fs.existsSync(dir)) return res.json([]);
  res.json(fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.')).sort().reverse().map(f => {
    try {
      const { data, content } = readMd(path.join(dir, f));
      // `axes` has always been written by POST /api/prompts but was never read back, so loading a
      // saved prompt silently lost the picks it was built from. The builder needs them to restore
      // the axis grid instead of dropping the prompt in as inert text.
      return { file: f, name: data.name || f.replace(/\.md$/, ''), created: data.created || '', fav: data.fav === true || data.fav === 'true', axes: data.axes || {}, prompt: content.trim() };
    } catch { return null; }
  }).filter(Boolean));
});
// rename / favorite a saved prompt in place (F1.2 / F1.3)
app.patch('/api/prompts/:file', (req, res) => {
  const f = path.basename(String(req.params.file));
  const file = path.join(promptsDir(), f);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'prompt not found' });
  try {
    const { data, content } = readMd(file);
    if (req.body?.name !== undefined) data.name = String(req.body.name).replace(/[^\w\- ]+/g, '').trim() || data.name;
    if (req.body?.fav !== undefined) data.fav = !!req.body.fav;
    writeMd(file, data, content);
    res.json({ ok: true, name: data.name, fav: !!data.fav });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/prompts', (req, res) => {
  const name = String(req.body?.name || 'prompt').replace(/[^\w\- ]+/g, '').trim() || 'prompt';
  const file = path.join(promptsDir(), Date.now() + '-' + name.replace(/ +/g, '-').toLowerCase() + '.md');
  writeMd(file, { name, created: stamp(), axes: req.body?.axes || {}, fav: false }, String(req.body?.prompt || '') + '\n');
  bumpHistory('prompts');
  res.json({ ok: true });
});
app.delete('/api/prompts/:file', (req, res) => {
  const f = path.basename(String(req.params.file));
  stageTrash(path.join(promptsDir(), f), { label: 'prompt/' + f, itemKind: 'prompt' });
  res.json({ ok: true });
});

// ── quick snippets (chatwoot-style canned text) — snippets/*.md, expanded by typing
// /trigger in any snippet-aware textarea (re-roll notes, prompt builder, shot prompts) ──
const snippetsDir = () => path.join(getStorageRoot(), 'snippets');
const cleanTrigger = t => String(t || '').toLowerCase().replace(/[^\w-]+/g, '').slice(0, 24);
app.get('/api/snippets', (req, res) => {
  const dir = snippetsDir();
  if (!fs.existsSync(dir)) return res.json([]);
  res.json(fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.')).sort().map(f => {
    try {
      const { data, content } = readMd(path.join(dir, f));
      return { file: f, name: data.name || f.replace(/\.md$/, ''), trigger: data.trigger || '', content: content.trim() };
    } catch { return null; }
  }).filter(Boolean));
});
app.post('/api/snippets', (req, res) => {
  const name = String(req.body?.name || 'snippet').replace(/[^\w\- ]+/g, '').trim() || 'snippet';
  const trigger = cleanTrigger(req.body?.trigger) || name.replace(/ +/g, '-').toLowerCase();
  const file = Date.now() + '-' + trigger + '.md';
  writeMd(path.join(snippetsDir(), file), { name, trigger, created: stamp() }, String(req.body?.content || '') + '\n');
  res.json({ ok: true, file });
});
app.patch('/api/snippets/:file', (req, res) => {
  const f = path.basename(String(req.params.file));
  const file = path.join(snippetsDir(), f);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'snippet not found' });
  try {
    const { data, content } = readMd(file);
    const next = {
      ...data,
      name: req.body?.name !== undefined ? (String(req.body.name).replace(/[^\w\- ]+/g, '').trim() || data.name) : data.name,
      trigger: req.body?.trigger !== undefined ? (cleanTrigger(req.body.trigger) || data.trigger) : data.trigger
    };
    writeMd(file, next, req.body?.content !== undefined ? String(req.body.content) + '\n' : content);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/snippets/:file', (req, res) => {
  stageTrash(path.join(snippetsDir(), path.basename(String(req.params.file))), { label: 'snippet', itemKind: 'snippet' });
  res.json({ ok: true });
});

// ── looks (F3.3): reference image → two-tier reusable LOOK, saved as looks/<id>.md ──
const looksDir = () => path.join(getStorageRoot(), 'looks');
app.get('/api/looks', (req, res) => {
  const dir = looksDir();
  if (!fs.existsSync(dir)) return res.json([]);
  res.json(fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.')).sort().reverse().map(f => {
    try { return readMd(path.join(dir, f)).data; } catch { return null; }
  }).filter(Boolean));
});
app.delete('/api/looks/:id', (req, res) => {
  stageTrash(path.join(looksDir(), path.basename(String(req.params.id)) + '.md'), { label: 'look/' + req.params.id, itemKind: 'look' });
  res.json({ ok: true });
});

// ── live key tests (Settings → Test buttons) — one cheap authenticated round-trip each ──
app.get('/api/test/groq', async (_req, res) => {
  const key = groqKey();
  if (!key) return res.json({ ok: false, error: 'No Groq key set' });
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key } });
    if (r.status === 401 || r.status === 403) return res.json({ ok: false, error: 'Key rejected (' + r.status + ') — check the Groq key' });
    if (!r.ok) return res.json({ ok: false, error: 'Groq ' + r.status });
    const n = ((await r.json()).data || []).length;
    res.json({ ok: true, detail: n + ' models visible' });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── project context assets (folders supported) ──
app.post('/api/context/:pid/upload', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const saved = saveContextFile(req.params.pid, String(req.query.name || 'asset'), req.body, String(req.query.folder || ''));
  bumpHistory('briefs');
  appendActivity({ dot: 'amber', t: 'Context added', t2: '· ' + (saved.folder ? saved.folder + '/' : '') + saved.name, s: req.params.pid + ' — injected into every agent run', kind: 'proj', ref: req.params.pid });
  res.json(saved);
});
app.post('/api/context/:pid/note', (req, res) => {
  const folder = String(req.body?.folder || '');
  // Allow dots, then strip a trailing .md before re-adding one. Without the dot the sanitizer
  // rewrote "shot 2.1 notes" to "shot 21 notes", so an edit could not round-trip to its own
  // filename — every save of that note created a NEW file and hard-deleted the old one.
  const base = String(req.body?.name || 'note').replace(/[^\w\-. ]+/g, '').replace(/\.md$/i, '').trim() || 'note';
  // overwrite: editing a note in place must land on its own filename. Every other caller takes
  // the collision-avoiding default, so an upload can never silently replace an existing asset.
  const saved = saveContextFile(req.params.pid, base + '.md', Buffer.from(String(req.body?.content || ''), 'utf8'), folder, { overwrite: true });

  // edit-in-place: `replace` names the old file, dropped once the new one is written.
  //
  // Deciding that by string inequality destroyed notes. Rename "note" to "Note" and, on the
  // case-insensitive filesystems this app ships on (Windows, default macOS), saveContextFile
  // just overwrote THE SAME FILE — but `replace !== saved.name` is true, so the next line deleted
  // the file it had only just written. The note was gone and the UI reported "Note updated in
  // place". `replace` also arrives straight off the wire, so it can name an unrelated note.
  //
  // Resolve both sides to real paths and compare identity (dev+ino), which is the only thing that
  // answers "are these the same file" across case-folding, and stage rather than rm so a mistake
  // is recoverable from the Trash page.
  const replace = String(req.body?.replace || '');
  if (replace) {
    const oldPath = contextFilePath(req.params.pid, replace, folder);
    const newPath = contextFilePath(req.params.pid, saved.name, folder);
    const sameFile = (a, b) => {
      if (!a || !b) return false;
      try { const x = fs.statSync(a), y = fs.statSync(b); return x.dev === y.dev && x.ino === y.ino; }
      catch { return false; }
    };
    if (oldPath && !sameFile(oldPath, newPath)) {
      stageTrash([oldPath, oldPath + '.meta.md'], { label: req.params.pid + ' / ' + replace, itemKind: 'context' });
    }
  }
  bumpHistory('briefs');
  res.json(saved);
});
app.delete('/api/context/:pid/file', (req, res) => {
  // stage the context asset + its sidecar (Phase 3D) instead of an irreversible delete
  const p = contextFilePath(req.params.pid, String(req.query.name || ''), String(req.query.folder || ''));
  if (p) stageTrash([p, p + '.meta.md'], { label: req.params.pid + ' / ' + req.query.name, itemKind: 'context' });
  res.json({ ok: true, staged: !!p });
});
app.get('/api/context/:pid/file', (req, res) => {
  const p = contextFilePath(req.params.pid, String(req.query.name || ''), String(req.query.folder || ''));
  if (!p) return res.status(404).end();
  res.sendFile(p);
});
app.post('/api/context/:pid/folder', (req, res) => {
  try {
    const f = createContextFolder(req.params.pid, String(req.body?.name || ''));
    appendActivity({ dot: 'amber', t: 'Context folder created', t2: '· ' + f, s: req.params.pid, kind: 'proj', ref: req.params.pid });
    res.json({ name: f });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/context/:pid/folder', (req, res) => {
  // stage the whole board folder (files + sidecars) as one restorable unit
  const f = String(req.query.name || '').split('/')[0].replace(/[^\w\- ]+/g, '').trim();
  const dir = path.join(getStorageRoot(), 'projects', req.params.pid, 'context', f);
  if (!f) return res.status(400).json({ error: 'invalid folder name' });
  const entry = fs.existsSync(dir) ? stageTrash(dir, { label: req.params.pid + ' / ' + f, itemKind: 'context-folder' }) : null;
  res.json({ ok: true, staged: !!entry });
});

// ── skill files ──
app.get('/api/skills/file', (req, res) => {
  try { res.json({ path: req.query.path, content: readSkillFile(String(req.query.path || '')) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/skills/file', (req, res) => {
  try {
    writeSkillFile(String(req.body?.path || ''), String(req.body?.content || ''));
    bumpHistory('skills');
    appendActivity({ dot: 'amber', t: 'Skill edited', t2: '· ' + String(req.body?.path || '').split('/').slice(-2).join('/'), s: 'saved with .bak backup', kind: 'skills' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/skills/enhance', (req, res) => {
  const { path: file, instruction } = req.body || {};
  if (!file || !instruction) return res.status(400).json({ error: 'need path + instruction' });
  try { readSkillFile(String(file)); } catch (e) { return res.status(400).json({ error: e.message }); }
  const job = enqueueSkillEnhance(String(file), String(instruction));
  res.json({ job: { id: job.id, status: job.status } });
});

// ── canonical scoped item routes (Phase 1) — identity is { projectId, itemId } ──
// A conflict-guarded patch returns { conflict, currentRev, currentValues, conflictingFields } from
// the store when an external edit touched the same fields; the route turns that into HTTP 409 so a
// concurrent agent write is never silently clobbered (Phase 3B).
function sendPatch(res, it, extra) {
  if (!it) return res.status(404).json({ error: 'not found' });
  if (it.conflict) return res.status(409).json({ error: 'conflict', currentRev: it.currentRev, currentValues: it.currentValues, conflictingFields: it.conflictingFields });
  res.json(extra ? { ...it, ...extra } : it);
}
app.patch('/api/projects/:pid/items/:id', (req, res) => {
  const { patch, log, activity, history, baseRev, baseValues } = req.body || {};
  const it = patchItem(req.params.pid, req.params.id, patch || {}, { log, baseRev, baseValues });
  if (!it || it.conflict) return sendPatch(res, it);
  if (activity) appendActivity(activity);
  if (history) bumpHistory(history);
  journalAction({ command: 'item.patch', actor: 'app', targets: [req.params.pid + '/' + req.params.id], undoable: !!baseValues, before: baseValues || null, after: patch || null });
  res.json(it);
});
app.post('/api/projects/:pid/items/:id/note', (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty note' });
  const it = patchItem(req.params.pid, req.params.id, { fb: true, fbState: 'queued', note: text }, { log: 'note queued: "' + text + '"', baseRev: req.body?.baseRev, baseValues: req.body?.baseValues });
  if (!it || it.conflict) return sendPatch(res, it);
  const job = enqueueReroll(req.params.pid, req.params.id, text);
  bumpHistory('prompts');
  res.json({ item: it, job: job && { id: job.id, status: job.status } });
});
app.post('/api/projects/:pid/items/:id/reveal', (req, res) => {
  const it = getItem(req.params.pid, req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  revealInOS(path.join(getStorageRoot(), 'projects', it.proj, 'items'), false);
  res.json({ ok: true });
});
app.post('/api/projects/:pid/items/:id/trash', (req, res) => {
  const it = patchItem(req.params.pid, req.params.id, { trashed: true }, { log: 'moved to trash' });
  if (!it || it.conflict) return sendPatch(res, it);
  journalAction({ command: 'item.trash', actor: 'app', targets: [req.params.pid + '/' + req.params.id], undoable: true, before: { trashed: false }, after: { trashed: true } });
  res.json(it);
});
app.post('/api/projects/:pid/items/:id/restore', (req, res) => {
  const it = patchItem(req.params.pid, req.params.id, { trashed: false }, { log: 'restored from trash' });
  return sendPatch(res, it);
});

// ── DEPRECATED legacy global item routes — compatibility wrappers only. The Scout client never
// calls these. Exactly one project holds the id → operate and flag `deprecated`; two or more →
// 409 "ambiguous item id" (Phase 1D), because a global id can no longer identify a record. ──
function resolveLegacyItem(res, id) {
  const pids = findItemProjects(id);
  if (pids.length === 0) { res.status(404).json({ error: 'not found' }); return null; }
  if (pids.length > 1) { res.status(409).json({ error: 'ambiguous item id; project id is required', projects: pids }); return null; }
  return pids[0];
}
app.patch('/api/items/:id', (req, res) => {
  const pid = resolveLegacyItem(res, req.params.id); if (!pid) return;
  const { patch, log, activity, history } = req.body || {};
  const it = patchItem(pid, req.params.id, patch || {}, { log });
  if (!it || it.conflict) return sendPatch(res, it);
  if (activity) appendActivity(activity);
  if (history) bumpHistory(history);
  res.json({ ...it, deprecated: 'use PATCH /api/projects/:pid/items/:id' });
});
app.post('/api/items/:id/note', (req, res) => {
  const pid = resolveLegacyItem(res, req.params.id); if (!pid) return;
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty note' });
  const it = patchItem(pid, req.params.id, { fb: true, fbState: 'queued', note: text }, { log: 'note queued: "' + text + '"' });
  if (!it || it.conflict) return sendPatch(res, it);
  const job = enqueueReroll(pid, req.params.id, text);
  bumpHistory('prompts');
  res.json({ item: { ...it, deprecated: 'use POST /api/projects/:pid/items/:id/note' }, job: job && { id: job.id, status: job.status } });
});

app.post('/api/trash/empty', (req, res) => {
  // Permanent purge from the Trash page (Phase 3E). Every record carries its own project id, so we
  // delete each by { proj, id } — never a global deleteItem(id) over a list with repeated ids.
  const gone = listItems().filter(x => x.trashed || x.st === 'killed');
  let deleted = 0;
  for (const x of gone) { if (deleteItem(x.proj, x.id)) deleted++; }
  appendActivity({ dot: 'green', t: 'Trash emptied', t2: '— ' + deleted + ' items deleted from disk', s: stamp(), kind: 'none' });
  res.json({ deleted });
});

app.put('/api/brief/:pid', (req, res) => {
  saveBrief(req.params.pid, String(req.body?.content || ''));
  bumpHistory('briefs');
  appendActivity({ dot: 'amber', t: 'Project brief updated', t2: '· ' + req.params.pid, s: 'read by every re-roll from now on', kind: 'proj', ref: req.params.pid });
  res.json({ ok: true });
});

app.put('/api/settings', (req, res) => {
  try {
    saveSettings(req.body || {});
  } catch (e) {
    // 409, not 500: nothing is broken on our side, the file on disk is in a state we must not
    // overwrite. This is the one save that MUST be visible — silently succeeding here is how a
    // "show hints" toggle used to replace a user's live API keys with defaults.
    if (e.code === 'settings-unreadable') return res.status(409).json({ error: e.message });
    return res.status(500).json({ error: e.message });
  }
  res.json(publicSettings());
});

app.put('/api/storage-root', (req, res) => {
  const p = String(req.body?.path || '').trim();
  if (!p) return res.status(400).json({ error: 'no path' });
  const abs = setStorageRoot(p);
  res.json({ storageRoot: abs });
});

app.get('/api/browse', (req, res) => res.json(browse(req.query.path)));
app.get('/api/jobs', (req, res) => res.json(listJobs()));
// Agent setup wizard. Every route takes an optional provider id ('claude' | 'codex'); omitting it
// falls back to whichever CLI settings.agentCommand currently points at.
app.get('/api/agent/test', async (req, res) => res.json(await testAgent(req.query.provider)));
// DEV-135 — the honest one. testAgent() probes a bare prompt with no tools, no system prompt, no
// isolated home and no --resume, so it stayed green through a completely dead chat. This drives the
// real runner pipeline and reports per-stage (bin → isolated home → live turn).
app.get('/api/agent/test-pipeline', async (_req, res) => {
  try { res.json(await testAgentPipeline()); }
  catch (e) { res.status(500).json({ ok: false, stages: [], error: String(e.message || e) }); }
});
app.get('/api/agent/status', async (req, res) => res.json(await agentStatus(req.query.provider)));
app.get('/api/agent/providers', async (req, res) => res.json(await agentProviders()));
app.post('/api/agent/install', async (req, res) => res.json(await installAgent(req.body?.provider)));
app.post('/api/agent/login', (req, res) => res.json(openLogin(req.body?.provider)));
app.post('/api/history/:kind', (req, res) => { bumpHistory(req.params.kind, Number(req.body?.n) || 1); res.json({ ok: true }); });

app.post('/api/reveal', (req, res) => {
  // Reveal in Finder — best-effort. Scoped: pass { pid, id }. Without pid we fall back to legacy
  // resolution (single match only; ambiguous id → 409).
  const id = String(req.body?.id || '');
  let pid = req.body?.pid ? safeScope(req.body.pid) : null;
  if (!pid) {
    const pids = findItemProjects(id);
    if (pids.length === 0) return res.status(404).json({ error: 'not found' });
    if (pids.length > 1) return res.status(409).json({ error: 'ambiguous item id; project id is required', projects: pids });
    pid = pids[0];
  }
  const it = getItem(pid, id);
  if (!it) return res.status(404).json({ error: 'not found' });
  revealInOS(path.join(getStorageRoot(), 'projects', it.proj, 'items'), false);
  res.json({ ok: true });
});

// ── action journal + undo (Phase 3C/3D) ──
app.get('/api/actions', (_req, res) => res.json(listActions(200)));
// Undo an item.patch / item.trash action by writing its `before` values back. The undo itself is
// journaled (parentAction) and the original is flagged undone — undo survives restart because the
// journal is on disk, not in memory.
app.post('/api/actions/:id/undo', (req, res) => {
  const a = getAction(req.params.id);
  if (!a) return res.status(404).json({ error: 'action not found' });
  if (a.status === 'undone') return res.status(409).json({ error: 'already undone' });
  if (!a.undoable || !a.before) return res.status(400).json({ error: 'action is not undoable' });
  const [target] = a.targets || [];
  const slash = String(target || '').indexOf('/');
  if (slash < 0) return res.status(400).json({ error: 'unknown target shape' });
  const pid = target.slice(0, slash), id = target.slice(slash + 1);
  const it = patchItem(pid, id, a.before, { log: 'undo ' + a.command });
  if (!it) return res.status(404).json({ error: 'target no longer exists' });
  markAction(a.id, 'undone');
  journalAction({ command: 'undo:' + a.command, actor: 'app', targets: a.targets, undoable: false, before: a.after, after: a.before, parentAction: a.id });
  res.json({ ok: true, item: it });
});

// ── staged trash (Phase 3D) — physical file/folder deletions land here, recoverable ──
app.get('/api/staged-trash', (_req, res) => res.json(listTrash()));
app.post('/api/staged-trash/:id/restore', (req, res) => {
  try {
    const r = restoreTrash(req.params.id);
    if (!r) return res.status(404).json({ error: 'trash entry not found' });
    res.json(r);
  } catch (e) { res.status(409).json({ error: e.message }); }
});
app.delete('/api/staged-trash/:id', (req, res) => {
  // permanent purge — allowed only from the Trash page, one entry at a time
  res.json({ purged: purgeTrash(req.params.id) });
});
app.post('/api/staged-trash/purge-all', (req, res) => res.json({ purged: purgeAllTrash() }));

// static frontend (production build)
const dist = path.join(APP_ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Exported for tests — the harness does `app.listen(0)` on an ephemeral port.
export { app };

// bind localhost only — the API is unauthenticated and /api/state includes the buyer's
// API keys; set HOST=0.0.0.0 explicitly to opt into LAN access
if (IS_MAIN) {
  // Before anything else logs: a boot failure is exactly the report we most want to receive, and
  // the ring only holds what it was installed in time to see. Nothing is transmitted — the ring is
  // read only when a human presses Send in the feedback panel.
  installLogRing();
  startWatch(30000); // fs.watch + 30s reconcile → external agent edits bump the revision too

  // Door 2, actually open (T07 step 1). `_inbox/` is where an agent with folder access and no
  // network drops a finding — it is the door that works everywhere, so it must not need a button
  // pressed. `ensureInbox` also writes the drop instructions into the folder they are needed in,
  // and the two agent-facing files are refreshed once at boot so a folder-mode agent starting
  // before the first write still has something to grep.
  //
  // Only under IS_MAIN: a test harness that imported this module would otherwise inherit a live
  // fs.watch on somebody else's temp root.
  try {
    // Mark quarantined records ON DISK once at boot. The route computes the same answer on every
    // read, but `territory.mjs` scores from the FILES — so without the flag written down, a record
    // an agent wrote around the pipeline would be excluded from the view and still counted in its
    // territory's hit rate. Law 1: the file is the truth, so the state has to be in the file.
    const held = sweepQuarantine();
    if (held.length) console.log('[scout] quarantined ' + held.length + ' record(s) written around the pipeline');
    ensureInbox();
    startInboxWatch();
    refreshAgentFiles({ now: true });
  } catch (e) {
    console.error('[scout] the _inbox watcher did not start — ' + e.message);
  }
  const HOST = process.env.HOST || '127.0.0.1';
  process.env.SCOUT_SELF_PORT = String(PORT); // ticket 10 — the agent home renders the Index's api base from this
  // Without an 'error' listener an occupied port kills the process with a raw unhandled
  // EADDRINUSE stack — the usual cause being a previous instance that never shut down.
  const server = app.listen(PORT, HOST, () => console.log('[scout] api on ' + HOST + ':' + PORT + ' · storage root ' + getStorageRoot()));
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error('[scout] port ' + PORT + ' is already in use — another Scout is probably running.');
      console.error('[scout] pass a different port:  node backend/index.mjs ' + (PORT + 1) + '   (or set PORT=' + (PORT + 1) + ')');
    } else {
      console.error('[scout] could not start server — ' + e.message);
    }
    process.exit(1);
  });

  // Reports typed while the network was down go out now. Deliberately after listen and
  // deliberately unawaited: a feedback service having a bad day must never delay the app starting,
  // and the ordinary case (nothing queued) is silent.
  server.on('listening', () => { flushOutbox().catch(() => { /* still queued; try again next launch */ }); });
}
