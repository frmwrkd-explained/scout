// MUST stay first: populates process.env from .env before store.mjs captures FRFG_CONFIG/FRFG_DATA
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
import { seedIfEmpty, seedContext, installStarterSnippets } from './seed.mjs';
import { enqueueReroll, enqueueSkillEnhance, listJobs, testAgent, agentStatus, agentProviders, installAgent, openLogin, findAgent, buildAgentArgs, runOnce } from './jobs.mjs';
import { transcribe, breakdownStory, groqKey } from './groq.mjs';
import { analyzeImage, extractLook, resolveVision, analyzeMove } from './vision.mjs';
import { transcribeLocal, localAsrStatus } from './localAsr.mjs';
import { getStory, saveStory, listShots, listAllShots, writeShot, patchShot, deleteShot, replaceShots, reorderShots, duplicateShot, freeShotNo } from './story.mjs';
import { listAssets, saveAsset, deleteAsset, createCollection, deleteCollection, copyAsset, assetPath, scopeDir, readMeta, writeMeta, renameAsset, moveAsset, renameCollection, metaPath } from './library.mjs';
import { uploadToFal, falKey, testFal } from './fal.mjs';
import { startGeneration, listGenerations, getGeneration, deleteGeneration, saveToShot, saveToBoard, reviewCandidate, rerollCandidate, promoteCandidate, renderPath, sweepOrphans } from './generate.mjs';
import { splitGridGeneration } from './gridsplit.mjs';
import { providersStatus, testProvider, kieKey } from './providers.mjs';
import { readFalCatalog, syncFalCatalog } from './catalog.mjs';
import { getModelSchema } from './modelSchemas.mjs';
import { getLedger, getLedgerRollup } from './ledger.mjs';
import { registerStyleLockRoutes } from './stylelocks.mjs';
import { registerEnhanceRoutes } from './enhance.mjs';
import { registerMemoryRoutes } from './memory.mjs';
import { registerRemotionRoutes } from './remotion.mjs';
import { mountThreeD } from './threed.mjs';
import { registerControlRoutes } from './control.mjs';
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
import { listBatches, readBatch, createBatch, estimateBatch, pauseBatch, resumeBatch, cancelBatch, retryBatch, reconstructQueue } from './batches.mjs';
import { getManifest, writeManifest, setInOut, exportSelects } from './manifest.mjs';
import { startVideoImport, getVideoJob, videoJobFramePath, commitVideoJob, discardVideoJob, videoToolsStatus,
  retrimVideoShot, videoFrameAt, buildContactSheet, videoSheetPath, discardContactSheet } from './video.mjs';
import { registerManualRoutes } from './manual.mjs';
import { registerReelRoutes, resolveShotMedia } from './reel.mjs';
import { exportReelPack } from './reelPack.mjs';
import { registerRenderRoutes } from './reelRender.mjs';
import { registerFeedbackRoutes, installLogRing, recordApiCall, flushOutbox } from './feedback.mjs';
import { DEFAULT_RESOLUTION, maxRefs } from '../frontend/modelCatalog.js';
import { INTEGRATIONS, isEnabled, byId, resolveModules } from '../shared/integrations.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 5176;

// Reveal a path in the OS file manager — cross-platform, best-effort, never throws.
// `select` reveals the file inside its folder; otherwise the folder itself is opened.
// An error callback is mandatory: execFile with no callback emits an unhandled 'error'
// event (crashing the server) when the launcher binary is missing (Linux/Windows).
// Under tests this is a no-op: the export/handoff routes reveal unconditionally, so a full
// `node --test` run would otherwise spawn a real Finder window per exercised route.
function revealInOS(target, select = false) {
  if (process.env.FRFG_TEST) return;
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
if (IS_MAIN) {
  seedIfEmpty();
  seedContext(getStorageRoot()); // upgrade older roots that predate the context system
  sweepOrphans();                // fail generations orphaned by a previous crash/restart
  reconstructQueue();            // re-enqueue still-queued batch candidates after a restart (Phase 7)
}

const app = express();

// ── local-only guard: the API is unauthenticated and /api/state carries the buyer's API
// keys, so a visited web page must never be able to reach it. Block DNS-rebinding (Host
// header must resolve to loopback) and cross-site requests (Origin, when present, must be
// same-origin). Browsers can't spoof Origin/Host, so this closes the exfiltration vector
// while leaving the real UI (served from this same origin) untouched. Opt into LAN access
// with FRFG_ALLOW_LAN=1.
const ALLOW_LAN = process.env.FRFG_ALLOW_LAN === '1' || process.env.HOST === '0.0.0.0';
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
  if (p.startsWith('/api/generations') || p.startsWith('/api/generate')) return ['generations'];
  // an inbox apply writes generation records AND patches shot status/logs — both must repaint
  if (p.startsWith('/api/manual')) return ['generations', 'shots'];
  if (p.startsWith('/api/story')) return ['shots'];
  if (p.startsWith('/api/reel')) return ['shots'];
  // the board is a VIEW of shots and assets; a node move repaints neither, but a sync/align can
  // add cards for shots the client has not loaded, so it rides the shots domain
  if (p.startsWith('/api/board')) return ['shots'];
  if (p.startsWith('/api/context') || p.startsWith('/api/assets') || p.startsWith('/api/library')) return ['assets'];
  if (p.startsWith('/api/settings')) return ['settings'];
  if (p.startsWith('/api/brief') || p.startsWith('/api/projects')) return ['projects'];
  if (p.startsWith('/api/stylelocks')) return ['stylelocks'];
  if (p.startsWith('/api/memory') || p.startsWith('/api/folders')) return ['memory'];
  if (p.startsWith('/api/remotion')) return ['remotion'];
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

// ── integration gate ──
// Modules are gated per-REQUEST rather than by skipping the mount, so flipping a switch in
// Settings takes effect immediately instead of requiring an app restart. Mirrors the
// disabledModels precedent: the UI hides a disabled module, and the server refuses it anyway.
//
// Only ACTIONS are gated, never stored data. A user who turns off Look Extractor keeps their
// looks/*.md and can still read them; they just can't spend another vision call extracting one.
const MODULE_ROUTES = [
  ['remotion', p => p.startsWith('/api/remotion')],
  ['stage3d', p => p.startsWith('/api/threed')],
  ['videoimport', p => p.startsWith('/api/video-import')],
  ['lookextract', p => p.startsWith('/api/looks/extract')],
  ['storybreak', p => /^\/api\/story\/[^/]+\/breakdown/.test(p)],
  ['transcribe', p => p.startsWith('/api/groq/transcribe')],
  ['agent', p => p.startsWith('/api/jobs') || p.startsWith('/api/skills/enhance')],
  // The whole filmmaker-chat surface (sessions, the isolated-home/router routes, the chat-tools
  // toggle) is gated as one module. `chat` requires `agent` (shared/integrations.mjs), so turning
  // the agent off gates chat too. Per-tool toggles live inside this surface, not on the module gate.
  ['chat', p => p.startsWith('/api/chat')],
  // Manual round-trip. Gated as one module, but note the asymmetry with the other entries: turning
  // it off blocks new handoffs and new imports, it does NOT touch media already imported — those
  // are ordinary generation records now and belong to the project, not to this module.
  ['manualroundtrip', p => p.startsWith('/api/manual')],
  // Beta feedback. Off means the panel is gone and the egress route 403s — the capture rings are
  // renderer-side and cost nothing, but with this off there is no way to send anything anywhere.
  ['feedback', p => p.startsWith('/api/feedback')]
];
app.use('/api', (req, res, next) => {
  const full = '/api' + (req.path === '/' ? '' : req.path);
  const settings = getSettings();
  for (const [id, match] of MODULE_ROUTES) {
    if (match(full) && !isEnabled(settings, id)) {
      const mod = byId(id);
      return res.status(403).json({
        error: (mod ? mod.label : id) + ' is turned off — enable it in Settings → Integrations',
        code: 'module-disabled', module: id
      });
    }
  }
  next();
});

// ── feature-module route blocks (see docs/integration/*) ──
// style locks (lazy-fetched by the client — deliberately NOT folded into /api/state),
// prompt enhancement, project memory + folder classification, and the Remotion composition list.
registerStyleLockRoutes(app, { appendActivity, bumpHistory });
registerEnhanceRoutes(app);
registerMemoryRoutes(app, { appendActivity, bumpHistory });
registerRemotionRoutes(app, { getSettings }); // live settings getter, not a snapshot
mountThreeD(app);
registerBoardRoutes(app, { appendActivity });
registerControlRoutes(app, { appendActivity }); // depth/edge/pose/matte preprocessors → library/control/
registerDistillRoutes(app, { appendActivity, bumpHistory }); // ticket 20 — session-end distillation + idle sweep (before chat routes so the sweep middleware runs first)
registerChatRoutes(app, { appendActivity }); // filmmaker chat sessions (ticket 08) → chat/ + projects/<pid>/chat/
registerAgentHomeRoutes(app, { saveSettings, appendActivity, getSession: getChatSession }); // ticket 10 — router skill / Index / isolated home
// ticket 25 — user-authored tools. Deliberately NOT under /api/chat: authoring a tool is a workspace
// operation that stays available with the chat module off (the tool simply has nothing to run in).
registerUserToolRoutes(app, { appendActivity });
// manual round-trip (backend/manual.mjs) — handoff sheets out, project inbox in. `raw` mirrors the
// other binary upload routes; `reveal` is index.mjs's own cross-platform file-manager opener.
registerManualRoutes(app, { reveal: revealInOS, raw: express.raw({ type: '*/*', limit: '500mb' }) });
registerReelRoutes(app, { reveal: revealInOS, exportPack: exportReelPack });
registerRenderRoutes(app, { reveal: revealInOS });
// beta feedback (backend/feedback.mjs) — the ONLY outbound call in this app to a server we own.
registerFeedbackRoutes(app);

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
  writeMd(uiStateMd(), next, 'FrameForge UI state — last location + non-sensitive prefs. No secrets.\n');
  res.json(next);
});

// ── edit-manifest / selects bridge (bigger bet) — final selects in shot order for the editor ──
app.get('/api/manifest/:pid', (req, res) => res.json(getManifest(req.params.pid)));
app.post('/api/manifest/:pid/in-out', (req, res) => {
  const b = req.body || {};
  const { shot, in: inP, out } = b;
  if (!shot) return res.status(400).json({ error: 'shot required' });
  // Pass only the sides the body actually carries. The client sends one at a time and
  // JSON.stringify drops the undefined twin, so `'in' in b` is what distinguishes "clear it" from
  // "do not touch it" — reading a missing key as a value is how setting an out point used to wipe
  // the in point. `null` is sent deliberately by the no-<video> path and must stay a no-op too.
  try {
    res.json(setInOut(req.params.pid, String(shot),
      'in' in b ? inP : undefined,
      'out' in b ? out : undefined));
  } catch (e) {
    // 409 for "this shot has no selected take" — a state the user can fix, not a server fault.
    if (e.code === 'no-entry') return res.status(409).json({ error: e.message });
    return res.status(500).json({ error: e.message });
  }
});
app.post('/api/manifest/:pid/export', (req, res) => {
  try { res.json(exportSelects(req.params.pid)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── batch variants + durable queue (Phase 7) ──
app.get('/api/batches', (_req, res) => res.json(listBatches()));
app.get('/api/batches/:id', (req, res) => { const b = readBatch(req.params.id); if (!b) return res.status(404).json({ error: 'batch not found' }); res.json(b); });
app.post('/api/batches/estimate', (req, res) => {
  const { model, shotIds, variantCount, maxSpend } = req.body || {};
  if (!model) return res.status(400).json({ error: 'model is required' });
  res.json(estimateBatch({ model: String(model), shotIds: Array.isArray(shotIds) ? shotIds : [], variantCount: Number(variantCount) || 4, maxSpend }));
});
app.post('/api/batches', (req, res) => {
  const b = req.body || {};
  if (!b.pid || !SLUG.test(String(b.pid))) return res.status(400).json({ error: 'valid pid required' });
  try {
    const batch = createBatch({
      pid: String(b.pid), shotIds: Array.isArray(b.shotIds) ? b.shotIds.map(String) : [],
      prompt: String(b.prompt || ''), model: String(b.model || ''), aspect: String(b.aspect || '16:9'),
      resolution: String(b.resolution || DEFAULT_RESOLUTION),
      refs: Array.isArray(b.refs) ? b.refs.slice(0, maxRefs(String(b.model || ''))) : [], refUrls: Array.isArray(b.refUrls) ? b.refUrls : [],
      styleLockFragment: String(b.styleLockFragment || ''), variantCount: Number(b.variantCount) || 4,
      baseSeed: b.baseSeed ?? null, maxSpend: b.maxSpend ?? null,
      params: (b.params && typeof b.params === 'object' && !Array.isArray(b.params)) ? b.params : null,
      // ticket 22 — optional chat-session attribution for spend surfacing
      sessionId: b.sessionId ? String(b.sessionId) : null
    });
    res.json(batch);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/batches/:id/pause', (req, res) => { const b = pauseBatch(req.params.id); if (!b) return res.status(404).json({ error: 'not found' }); res.json(b); });
app.post('/api/batches/:id/resume', (req, res) => { const b = resumeBatch(req.params.id); if (!b) return res.status(404).json({ error: 'not found' }); res.json(b); });
app.post('/api/batches/:id/cancel', (req, res) => { const b = cancelBatch(req.params.id); if (!b) return res.status(404).json({ error: 'not found' }); res.json(b); });
app.post('/api/batches/:id/retry', (req, res) => { const r = retryBatch(req.params.id, { fresh: !!req.body?.fresh }); if (!r) return res.status(404).json({ error: 'not found' }); res.json(r); });

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
    context: listAssets(p.id),        // context items incl. vision meta sidecars
    gens: listGenerations(p.id),      // generation records (F2)
    story: getStory(p.id).content ? true : false
  }));
  res.json({
    revision: currentRevision(),
    storageRoot: getStorageRoot(),
    settings: publicSettings(),
    // the integration registry + each module's resolved on/off state, so the UI never has to
    // re-derive the defaults logic (and can't drift from what the server actually enforces)
    integrations: INTEGRATIONS,
    modules: resolveModules(getSettings()),
    projects,
    items: listItems(),
    shots: listAllShots(),
    library: listAssets('library'),
    activity: getActivity(),
    history: getHistory(),
    skillRepos: scanSkillRepos(),
    chatSkills: chatSkillsSurface(), // ticket 10 — router (read-only/system), house-rules (editable), packs, tools

    ledger: getLedger(),
    ledgerRollup: getLedgerRollup(),   // permanent monthly totals — correct past the 500-row detail cap
    jobs: listJobs(),
    batches: listBatches(),           // batch variants + durable queue (Phase 7)
    reviewSessions: listSessions(),   // persistent Inbox sessions (Phase 5)
    groqReady: !!groqKey(),
    falReady: !!falKey(),
    kieReady: !!kieKey(),
    providers: providersStatus()   // { fal, kie, higgsfield, arcads } → reachable? (key set / CLI installed)
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

// ── story → shots ──
app.get('/api/story/:pid', (req, res) => {
  res.json({ story: getStory(req.params.pid), shots: listShots(req.params.pid) });
});
app.put('/api/story/:pid', (req, res) => {
  saveStory(req.params.pid, String(req.body?.content || ''));
  bumpHistory('briefs');
  res.json({ ok: true });
});
app.post('/api/story/:pid/breakdown', async (req, res) => {
  const pid = req.params.pid;
  const story = String(req.body?.story ?? getStory(pid).content ?? '').trim();
  if (!story) return res.status(400).json({ error: 'story is empty — write or transcribe an idea first' });
  try {
    if (req.body?.story) saveStory(pid, story);
    const skills = scanSkillRepos().filter(r => r.exists).flatMap(r => r.skills.map(s => ({ name: s.name, description: s.description })));
    const shots = await breakdownStory(story, {
      brief: (() => { try { return listProjects().find(p => p.id === pid)?.brief || ''; } catch { return ''; } })(),
      skills
    });
    if (!shots.length) return res.status(502).json({ error: 'model returned no shots' });
    // mode 'merge' appends after the existing shots instead of archiving them (F5 re-break)
    let written;
    if (req.body?.mode === 'merge') {
      const existing = listShots(pid);
      const offset = existing.length ? Math.max(...existing.map(s => s.no || 0)) : 0;
      const maxScene = Math.max(0, ...existing.map(s => s.scene || 0));
      written = shots.map(sh => writeShot(pid, {
        ...sh, no: sh.no + offset, scene: (sh.scene || 1) + maxScene,
        id: 'SH' + String((sh.no + offset) * 10).padStart(3, '0')
      }, 'created by story breakdown (merged)'));
    } else {
      written = replaceShots(pid, shots);
    }
    bumpHistory('prompts', shots.length);
    appendActivity({ dot: 'green', t: 'Story broken into ' + shots.length + ' shots', t2: '· ' + pid, s: 'skills assigned per shot — Groq ' + (getSettings().groqTextModel || ''), kind: 'proj', ref: pid, hl: 1 });
    res.json({ shots: written });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/story/:pid/shots', (req, res) => {
  const existing = listShots(req.params.pid);
  // body.id + body.no are honored when present — used by delete-undo to restore a shot verbatim
  const restore = req.body?.id && !existing.some(s => s.id === req.body.id);
  // freeShotNo: max(no)+1 can derive an id another shot already owns, because a reorder
  // renumbers `no` but never renumbers `id`. Without this, "add shot" overwrote that shot.
  const no = restore && req.body.no
    ? req.body.no
    : freeShotNo(existing, existing.length ? Math.max(...existing.map(s => s.no || 0)) + 1 : 1);
  const shot = writeShot(req.params.pid, { ...req.body, no, id: restore ? req.body.id : undefined }, restore ? 'restored via undo' : 'created manually');
  res.json(shot);
});
// registered before the :id PATCH so 'reorder' isn't swallowed as a shot id
app.patch('/api/story/:pid/shots/reorder', (req, res) => {
  const order = Array.isArray(req.body?.order) ? req.body.order.map(String) : [];
  if (!order.length) return res.status(400).json({ error: 'order array required' });
  res.json({ shots: reorderShots(req.params.pid, order) });
});
app.post('/api/story/:pid/shots/:id/duplicate', (req, res) => {
  const sh = duplicateShot(req.params.pid, req.params.id);
  if (!sh) return res.status(404).json({ error: 'shot not found' });
  res.json(sh);
});
app.patch('/api/story/:pid/shots/:id', (req, res) => {
  const s = patchShot(req.params.pid, req.params.id, req.body?.patch || {}, req.body?.log);
  if (!s) return res.status(404).json({ error: 'shot not found' });
  res.json(s);
});
app.delete('/api/story/:pid/shots/:id', (req, res) => {
  deleteShot(req.params.pid, req.params.id);
  res.json({ ok: true });
});

// ── transcription: Groq (cloud) or local (on-device Parakeet via parakeet-mlx) ──
// settings.transcriber picks the preferred engine; on failure the route falls through to the
// other engine automatically rather than failing hard on the user's first choice. Only errors
// if BOTH engines fail, and that error includes both failure messages.
app.post('/api/groq/transcribe', express.raw({ type: '*/*', limit: '80mb' }), async (req, res) => {
  const name = String(req.query.name || 'audio.m4a');
  const s = getSettings();
  const order = s.transcriber === 'local'
    ? [['local', () => transcribeLocal(req.body, name, s)], ['groq', () => transcribe(req.body, name)]]
    : [['groq', () => transcribe(req.body, name)], ['local', () => transcribeLocal(req.body, name, s)]];
  const errs = [];
  for (const [engine, fn] of order) {
    try {
      const text = await fn();
      bumpHistory('prompts');
      return res.json({ text, engine });
    } catch (e) { errs.push(engine + ': ' + e.message); }
  }
  res.status(502).json({ error: errs.join(' · ') || 'Transcription failed' });
});
app.post('/api/assets/:scope/analyze', async (req, res) => {
  const { name, folder, provider, depth } = req.body || {};
  const p = assetPath(req.params.scope, String(name || ''), String(folder || ''));
  if (!p) return res.status(404).json({ error: 'asset not found' });
  try {
    // reuse a cached fal storage URL when there is one — the premium tier needs a hosted
    // image, and re-uploading the same asset on every re-analyze is pure waste
    const prev = readMeta(p) || {};
    const meta = await analyzeImage(fs.readFileSync(p), String(name), { provider, depth, imageUrl: prev.falUrl || null });
    if (meta.falUrl && meta.falUrl !== prev.falUrl) meta.falAt = stamp();
    writeMeta(p, meta);
    res.json({ meta: { ...meta, analyzed: 'just now' } });
  } catch (e) { res.status(502).json({ error: e.message }); }
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

// push an asset to fal storage; the returned CDN URL is written into the .meta.md sidecar
app.post('/api/assets/:scope/send-fal', async (req, res) => {
  const { name, folder } = req.body || {};
  const p = assetPath(req.params.scope, String(name || ''), String(folder || ''));
  if (!p) return res.status(404).json({ error: 'asset not found' });
  try {
    const url = await uploadToFal(fs.readFileSync(p), String(name));
    const meta = writeMeta(p, { falUrl: url, falAt: stamp() });
    appendActivity({ dot: 'green', t: 'Asset pushed to fal', t2: '· ' + name, s: url.slice(0, 80), kind: 'library' });
    res.json({ url, meta });
  } catch (e) { res.status(502).json({ error: e.message }); }
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
// Restore the curated starter pack into an existing root. First-run seeding installs it, but
// every root created before the pack shipped has an empty snippets dir and no other way to
// get one. Purely additive — installStarterSnippets skips any trigger already on disk.
app.post('/api/snippets/seed', (req, res) => {
  try { res.json({ ok: true, ...installStarterSnippets(getStorageRoot()) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
app.post('/api/looks/extract', async (req, res) => {
  const { scope, name, folder, measurements, provider } = req.body || {};
  const p = assetPath(String(scope || ''), String(name || ''), String(folder || ''));
  if (!p) return res.status(404).json({ error: 'asset not found' });
  try {
    const look = await extractLook(fs.readFileSync(p), String(name), measurements || null,
      { provider, imageUrl: readMeta(p)?.falUrl || null });
    const id = 'look-' + Date.now();
    const rec = { id, source: (scope === 'library' ? 'library' : scope) + '/' + (folder ? folder + '/' : '') + name, ...look, measurements: measurements || null, created: stamp() };
    writeMd(path.join(looksDir(), id + '.md'), rec, (look.tier2 || look.tier1 || '') + '\n');
    bumpHistory('prompts');
    appendActivity({ dot: 'green', t: 'Look extracted', t2: '· ' + id, s: rec.source + ' — two-tier fragment saved', kind: 'library' });
    res.json(rec);
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Camera-move analyzer — the inverse of the Camera Moves picker. Best fed a contact sheet
// (backend/video.mjs), whose panel→time map rides in the sidecar; a lone still still works,
// the read is just blinder. Read the RAW frontmatter, not readMeta(): readMeta normalises to
// a fixed shape and `contactSheet` is not in it, so the map would arrive as undefined.
app.post('/api/moves/analyze', async (req, res) => {
  const { scope, name, folder, provider } = req.body || {};
  const p = assetPath(String(scope || ''), String(name || ''), String(folder || ''));
  if (!p) return res.status(404).json({ error: 'asset not found' });
  let sheet = null;
  try { sheet = readMd(metaPath(p)).data?.contactSheet || null; } catch { /* no sidecar — analyze blind */ }
  try {
    const rec = await analyzeMove(fs.readFileSync(p), String(name), sheet,
      { provider, imageUrl: readMeta(p)?.falUrl || null });
    writeMeta(p, { cameraMove: { ...rec, read: stamp() } });
    bumpHistory('prompts');
    appendActivity({ dot: 'green', t: 'Camera move read', t2: '· ' + (rec.move || 'unresolved') + (rec.secondary ? ' → ' + rec.secondary : ''),
      s: (scope === 'library' ? 'library' : scope) + '/' + name + (sheet ? ' — ' + sheet.panels?.length + ' panels' : ' — single frame'), kind: 'library' });
    res.json({ ...rec, sheet });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.delete('/api/looks/:id', (req, res) => {
  stageTrash(path.join(looksDir(), path.basename(String(req.params.id)) + '.md'), { label: 'look/' + req.params.id, itemKind: 'look' });
  res.json({ ok: true });
});

// ── generation hub (F2): shots → FAL → real files in renders/ ──
app.post('/api/generate', (req, res) => {
  const { pid, shot, prompt, model, aspect, resolution, seed, refs, params, sessionId } = req.body || {};
  if (!pid) return res.status(400).json({ error: 'pid required' });
  if (!SLUG.test(String(pid))) return res.status(400).json({ error: 'invalid project id' });
  try {
    const gen = startGeneration({
      pid: String(pid), shot: shot ? String(shot) : null,
      prompt: String(prompt || ''), model: String(model || ''),
      aspect: String(aspect || '16:9'), resolution: String(resolution || DEFAULT_RESOLUTION), seed: seed ?? null,
      refs: Array.isArray(refs) ? refs.slice(0, maxRefs(String(model || ''))) : [],
      refUrls: Array.isArray(req.body?.refUrls) ? req.body.refUrls : [],
      params: (params && typeof params === 'object' && !Array.isArray(params)) ? params : null,
      // ticket 22 — optional chat-session attribution for spend surfacing
      sessionId: sessionId ? String(sessionId) : null
    });
    res.json(gen);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/generations/:pid', (req, res) => res.json(listGenerations(req.params.pid)));
// Any decision that can change a shot's selection must also land on disk: rebuild the
// edit manifest and re-export projects/<pid>/selects/ (symlinked, shot-ordered aliases)
// so the folder structure always mirrors the current approvals — no manual export step.
function refreshSelectsOnDisk(pid) {
  try { writeManifest(pid); exportSelects(pid); } catch { /* selects export is best-effort */ }
}
app.post('/api/generations/:pid/:id/save-to-shot', (req, res) => {
  // optional `shot` in the body overrides the generation's own linked shot — lets the send-to
  // picker attach a shot-less quick-gen to any target shot the user chooses. `final` selects it.
  try {
    const r = saveToShot(req.params.pid, req.params.id, req.body?.shot ? String(req.body.shot) : null, { final: !!req.body?.final });
    refreshSelectsOnDisk(req.params.pid);
    res.json(r);
  }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/generations/:pid/:id/save-to-board', (req, res) => {
  try {
    const saved = saveToBoard(req.params.pid, req.params.id, String(req.body?.folder || ''));
    appendActivity({ dot: 'amber', t: 'Render saved to board', t2: '· ' + saved.name, s: req.params.pid + ' — context/' + (saved.folder || ''), kind: 'proj', ref: req.params.pid });
    res.json(saved);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// ── Phase 2 candidate review — decisions live on the generation record ──
app.patch('/api/generations/:pid/:id/review', (req, res) => {
  const { patch, baseRev, baseValues } = req.body || {};
  const r = reviewCandidate(req.params.pid, req.params.id, patch || {}, { baseRev, baseValues });
  if (!r) return res.status(404).json({ error: 'candidate not found' });
  if (r.conflict) return res.status(409).json({ error: 'conflict', currentRev: r.currentRev, currentValues: r.currentValues, conflictingFields: r.conflictingFields });
  journalAction({ command: 'candidate.review', actor: 'app', targets: [req.params.pid + '/' + req.params.id], undoable: !!baseValues, before: baseValues || null, after: patch || null });
  // keep/kill/final can all move the shot's selection (syncShotSelection) — mirror it to selects/
  if (patch && (patch.reviewState !== undefined || patch.final !== undefined)) refreshSelectsOnDisk(req.params.pid);
  res.json(r);
});
app.post('/api/generations/:pid/:id/reroll', (req, res) => {
  try {
    const g = rerollCandidate(req.params.pid, req.params.id, { note: String(req.body?.note || ''), freshSeed: !!req.body?.freshSeed });
    if (!g) return res.status(404).json({ error: 'candidate not found' });
    appendActivity({ dot: 'green', t: 'Reroll queued', t2: '· ' + (g.shot || g.id), s: req.params.pid + ' · parent ' + req.params.id, kind: 'proj', ref: req.params.pid });
    res.json(g);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/generations/:pid/:id/promote', (req, res) => {
  try {
    const scope = req.body?.scope === 'library' ? 'library' : req.params.pid;
    const saved = promoteCandidate(req.params.pid, req.params.id, { scope, folder: String(req.body?.folder || ''), name: String(req.body?.name || '') });
    // NB: never pass `ref: undefined` — appendActivity → writeMd only strips TOP-LEVEL undefined, so a
    // nested undefined reaches js-yaml and throws. Build the event and add `ref` only when defined.
    const ev = { dot: 'amber', t: saved.idempotent ? 'Already promoted' : 'Candidate promoted', t2: '· ' + saved.name, s: (scope === 'library' ? 'library' : req.params.pid) + ' / ' + (saved.folder || ''), kind: scope === 'library' ? 'library' : 'proj' };
    if (scope !== 'library') ev.ref = req.params.pid;
    appendActivity(ev);
    res.json(saved);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Grid split (filmmaker-chat ticket 06) — cut a generated contact sheet into one child generation
// per kept cell. rows/cols omitted → auto-detect; optional `skip` drops cells; optional `shots`
// map (keyed 'r-c') attaches a cell to a shot as a candidate. Detection/geometry: shared/gridsplit.
app.post('/api/generations/:pid/:id/split-grid', async (req, res) => {
  try {
    const b = req.body || {};
    const out = await splitGridGeneration({
      pid: req.params.pid, id: req.params.id,
      rows: b.rows != null ? Number(b.rows) : null,
      cols: b.cols != null ? Number(b.cols) : null,
      gutter: b.gutter != null ? Number(b.gutter) : 0,
      skip: Array.isArray(b.skip) ? b.skip : [],
      shots: b.shots && typeof b.shots === 'object' ? b.shots : {}
    });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/generations/:pid/:id', (req, res) => {
  if (!deleteGeneration(req.params.pid, req.params.id)) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});
app.get('/api/renders/:pid/file', (req, res) => {
  const p = renderPath(req.params.pid, String(req.query.name || ''));
  if (!p) return res.status(404).end();
  res.sendFile(p);
});
// reveal a render in Finder/Explorer, selected inside renders/ — the local-first answer to
// "give me this file": it's already on disk, so we point at it instead of re-downloading it
app.post('/api/renders/:pid/reveal', (req, res) => {
  const p = renderPath(req.params.pid, String(req.body?.name || ''));
  if (!p) return res.status(404).json({ error: 'render not found' });
  revealInOS(p, true);
  res.json({ ok: true, path: p });
});

// shots enriched with real file paths + FAL urls — what Remotion / export packs consume (F7).
// Resolution order (Phase 2): 1) shot.selectedCandidate (the chosen generation), 2) legacy
// shot.assets → item versions, 3) fallback to any kept/final candidate for the shot.

// ── export pack (F7): everything an external tool needs, one button ──
app.post('/api/export/:pid', (req, res) => {
  const pid = req.params.pid;
  const dir = path.join(getStorageRoot(), 'projects', pid, 'export');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const shots = resolveShotMedia(pid);
    const story = getStory(pid);
    fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify({ project: pid, exportedAt: new Date().toISOString(), story: story.content, shots }, null, 2));
    const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const cols = ['id', 'no', 'scene', 'title', 'desc', 'type', 'dur', 'move', 'light', 'transition', 'skill', 'status', 'prompt', 'videoPrompt'];
    fs.writeFileSync(path.join(dir, 'shots.csv'), [cols.join(','), ...shots.map(s => cols.map(c => esc(s[c])).join(','))].join('\n'));
    fs.writeFileSync(path.join(dir, 'prompts.md'),
      '# ' + pid + ' — prompts\n\n' + shots.map(s => '## ' + s.id + ' — ' + s.title + '\n\n' + (s.prompt || '_(no prompt)_') + (s.videoPrompt ? '\n\n**video:** ' + s.videoPrompt : '')).join('\n\n') + '\n');
    const ctx = listAssets(pid);
    fs.writeFileSync(path.join(dir, 'moodboard.json'), JSON.stringify({
      project: pid,
      assets: (ctx.items || []).map(c => ({ name: c.name, board: c.folder, type: c.type, ...(c.meta || {}) }))
    }, null, 2));
    try { fs.copyFileSync(path.join(getStorageRoot(), 'projects', pid, 'story.md'), path.join(dir, 'story.md')); } catch { /* none */ }
    try { fs.copyFileSync(path.join(getStorageRoot(), 'projects', pid, 'brief.md'), path.join(dir, 'brief.md')); } catch { /* none */ }
    try { const m = writeManifest(pid); fs.writeFileSync(path.join(dir, 'edit-manifest.json'), JSON.stringify(m, null, 2)); } catch { /* no selects yet */ }
    revealInOS(path.join(dir, 'shots.json'), true);
    appendActivity({ dot: 'green', t: 'Export pack written', t2: '· ' + pid, s: 'projects/' + pid + '/export/ — shots, prompts, moodboard, story, brief', kind: 'proj', ref: pid });
    res.json({ ok: true, dir, files: ['shots.json', 'shots.csv', 'prompts.md', 'moodboard.json', 'story.md', 'brief.md'] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Remotion handoff: export shots + open the project ──
app.post('/api/remotion/open', (req, res) => {
  const pid = String(req.body?.pid || '');
  const proj = getSettings().remotionProject;
  if (!proj || !fs.existsSync(proj)) return res.status(400).json({ error: 'Set a valid Remotion project path in Settings first' });
  const shots = resolveShotMedia(pid);
  const story = getStory(pid);
  const payload = { exportedAt: new Date().toISOString(), project: pid, story: story.content, shots };
  const out = path.join(proj, 'frameforge-shots.json');
  try { fs.writeFileSync(out, JSON.stringify(payload, null, 2)); } catch (e) { return res.status(500).json({ error: e.message }); }
  revealInOS(proj, false);
  appendActivity({ dot: 'green', t: 'Handed off to Remotion', t2: '· ' + pid + ' — ' + shots.length + ' shots', s: 'frameforge-shots.json written into ' + proj, kind: 'proj', ref: pid });
  res.json({ ok: true, wrote: out, shots: shots.length });
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
app.get('/api/test/fal', async (_req, res) => {
  try { res.json(await testFal()); } catch (e) { res.json({ ok: false, error: e.message }); }
});
app.get('/api/test/local-asr', async (_req, res) => {
  try {
    const st = await localAsrStatus(getSettings());
    res.json(st.installed
      ? { ok: true, path: st.path, detail: 'parakeet-mlx found at ' + st.path }
      : { ok: false, error: 'parakeet-mlx not found — install with: uv tool install parakeet-mlx' });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});
// new providers — one adapter-level test each (Kie credit ping / higgsfield account status /
// a one-word Claude probe for the Arcads MCP). See backend/providers.mjs.
for (const svc of ['kie', 'higgsfield', 'arcads']) {
  app.get('/api/test/' + svc, async (_req, res) => {
    try { res.json(await testProvider(svc)); } catch (e) { res.json({ ok: false, error: e.message }); }
  });
}

// ── fal.ai full model catalog — local mirror under catalog/fal.md (Settings → FAL → Sync) ──
app.get('/api/catalog/fal', (_req, res) => {
  const { models, ...meta } = readFalCatalog();
  res.json({ ...meta, models });
});
app.post('/api/catalog/fal/sync', async (_req, res) => {
  try { res.json({ ok: true, ...(await syncFalCatalog()) }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── normalized per-model input schema — drives Manual mode's settings form (ticket 04) ──
// GET serves fresh cache / lazily syncs on first request; POST /sync forces a refresh. Model id
// carries slashes, so it rides a `?id=` query. Non-FAL ids get the fallback marker, never a 500.
app.get('/api/catalog/model-schema', async (req, res) => {
  try { res.json(await getModelSchema(String(req.query.id || ''))); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/catalog/model-schema/sync', async (req, res) => {
  try { res.json(await getModelSchema(String(req.query.id || req.body?.id || ''), { force: true })); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── Remotion starter comp (F7 optional) — copies a minimal comp that reads frameforge-shots.json ──
app.post('/api/remotion/template', (req, res) => {
  const proj = getSettings().remotionProject;
  if (!proj || !fs.existsSync(proj)) return res.status(400).json({ error: 'Set a valid Remotion project path in Settings first' });
  const dir = fs.existsSync(path.join(proj, 'src')) ? path.join(proj, 'src') : proj;
  const out = path.join(dir, 'FrameForgeShots.tsx');
  if (fs.existsSync(out) && !req.body?.overwrite) return res.status(409).json({ error: 'FrameForgeShots.tsx already exists — pass overwrite to replace it' });
  try {
    // The JSON is always seeded at the PROJECT ROOT, but the comp lands in src/ only when src/
    // exists. A hardcoded '../frameforge-shots.json' therefore resolved outside the project
    // entirely in the no-src/ layout, breaking the user's build with no way to self-correct.
    const specifier = dir === proj ? './frameforge-shots.json' : '../frameforge-shots.json';
    fs.writeFileSync(out, REMOTION_TEMPLATE.replace("'../frameforge-shots.json'", "'" + specifier + "'"));
    // the starter imports frameforge-shots.json at compile time — seed an empty
    // payload if no handoff has run yet, so the user's Remotion project still builds
    const shotsJson = path.join(proj, 'frameforge-shots.json');
    if (!fs.existsSync(shotsJson)) {
      fs.writeFileSync(shotsJson, JSON.stringify({ exportedAt: null, project: null, story: '', shots: [] }, null, 2));
    }
    appendActivity({ dot: 'green', t: 'Remotion starter written', t2: '· FrameForgeShots.tsx', s: out + ' — register it in your Root, it reads frameforge-shots.json', kind: 'proj', ref: '' });
    res.json({ ok: true, wrote: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
const REMOTION_TEMPLATE = `// FrameForgeShots — starter comp written by FrameForge (Tools → Remotion handoff).
// Reads frameforge-shots.json from the project root and plays each shot's picked frame
// for its duration. Register in your Root.tsx:
//   <Composition id="FrameForgeShots" component={FrameForgeShots} durationInFrames={totalFrames}
//     fps={30} width={1920} height={1080} />
import React from 'react';
import { AbsoluteFill, Img, Sequence, staticFile, useVideoConfig } from 'remotion';
import shotsData from '../frameforge-shots.json';

type ShotFile = { file?: string; path?: string; falUrl?: string };
type Shot = { id: string; title?: string; dur?: number; files?: ShotFile[] };

export const totalFrames = (shotsData.shots as Shot[]).reduce((a, s) => a + Math.round((s.dur || 4) * 30), 0) || 30;

export const FrameForgeShots: React.FC = () => {
  const { fps } = useVideoConfig();
  let from = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: '#0B0C0E' }}>
      {(shotsData.shots as Shot[]).map((s) => {
        const frames = Math.round((s.dur || 4) * fps);
        const f = (s.files || [])[0];
        const src = f?.falUrl || f?.file || f?.path || null;
        const el = (
          <Sequence key={s.id} from={from} durationInFrames={frames} name={s.id + ' ' + (s.title || '')}>
            <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
              {src
                ? <Img src={src.startsWith('http') ? src : staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ color: '#626B78', fontFamily: 'monospace', fontSize: 40 }}>{s.id} — no frame picked</div>}
            </AbsoluteFill>
          </Sequence>
        );
        from += frames;
        return el;
      })}
    </AbsoluteFill>
  );
};
`;

// ── project context assets (folders supported) ──
app.post('/api/context/:pid/upload', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const saved = saveContextFile(req.params.pid, String(req.query.name || 'asset'), req.body, String(req.query.folder || ''));
  bumpHistory('briefs');
  appendActivity({ dot: 'amber', t: 'Context added', t2: '· ' + (saved.folder ? saved.folder + '/' : '') + saved.name, s: req.params.pid + ' — injected into every agent run', kind: 'proj', ref: req.params.pid });
  res.json(saved);
});
// ── local video import: yt-dlp / local file → ffmpeg shot-cut detection → frame picker ──
app.get('/api/video-import/tools', (req, res) => res.json(videoToolsStatus()));
app.post('/api/video-import/:pid', (req, res) => {
  try {
    res.json(startVideoImport({ pid: req.params.pid, url: String(req.body?.url || ''),
      folder: String(req.body?.folder || ''), quality: String(req.body?.quality || 'medium') }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/video-import/:pid/upload', express.raw({ type: '*/*', limit: '2gb' }), (req, res) => {
  try {
    const name = String(req.query.name || 'video.mp4');
    if (!/\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(name)) return res.status(400).json({ error: 'Unsupported file type — use mp4, mov, webm, mkv, m4v or avi.' });
    const tmp = path.join(os.tmpdir(), 'frameforge-upload-' + Date.now() + '-' + name.replace(/[^\w.\-]+/g, '_'));
    fs.writeFileSync(tmp, req.body);
    res.json(startVideoImport({ pid: req.params.pid, filePath: tmp, sourceLabel: name,
      folder: String(req.query.folder || ''), quality: String(req.query.quality || 'medium') }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/video-import/job/:id', (req, res) => {
  const job = getVideoJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});
app.get('/api/video-import/job/:id/frame/:ix', (req, res) => {
  const p = videoJobFramePath(req.params.id, req.params.ix);
  if (!p) return res.status(404).end();
  res.sendFile(p);
});
// scrub: any instant in the source, for previewing where a trimmed boundary actually lands
app.get('/api/video-import/job/:id/at', async (req, res) => {
  const p = await videoFrameAt(req.params.id, req.query.t);
  if (!p) return res.status(404).end();
  res.sendFile(p);
});
// move a detected scene's in/out; the poster is re-cut and any sheet on that scene is dropped
app.post('/api/video-import/job/:id/shot/:ix', async (req, res) => {
  try { res.json(await retrimVideoShot(req.params.id, req.params.ix, { start: req.body?.start, end: req.body?.end })); }
  catch (e) { res.status(400).json({ error: e.friendly || e.message }); }
});
app.post('/api/video-import/job/:id/sheet', async (req, res) => {
  try { res.json(await buildContactSheet(req.params.id, req.body?.shot, { step: req.body?.step, panels: req.body?.panels })); }
  catch (e) { res.status(400).json({ error: e.friendly || e.message }); }
});
app.get('/api/video-import/job/:id/sheet/:sid', (req, res) => {
  const p = videoSheetPath(req.params.id, req.params.sid);
  if (!p) return res.status(404).end();
  res.sendFile(p);
});
app.post('/api/video-import/job/:id/sheet/:sid/discard', (req, res) =>
  res.json({ ok: discardContactSheet(req.params.id, req.params.sid) }));
app.post('/api/video-import/job/:id/save', (req, res) => {
  try {
    res.json({ saved: commitVideoJob(req.params.id,
      Array.isArray(req.body?.indices) ? req.body.indices : [],
      Array.isArray(req.body?.sheets) ? req.body.sheets : []) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/video-import/job/:id/discard', (req, res) => res.json({ ok: discardVideoJob(req.params.id) }));

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

// ── DEPRECATED legacy global item routes — compatibility wrappers only. The FrameForge client never
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
  seedIfEmpty(); // fresh root gets a fresh scaffold
  seedContext(abs);
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

// ── auto-initialize: when settings.autoAnalyze is on, any new raster image that appears
// on disk (dropped via Finder, the app, or another tool) gets vision metadata
// automatically. One image per tick — sequential and free-tier friendly. Files must be
// a few seconds old so half-copied files are never read; failures are remembered so a
// bad image can't loop forever.
const autoFailed = new Set();
let autoBusy = false;
const RASTER = /\.(png|jpe?g|gif|webp|avif)$/i;
const autoAnalyzeTick = async () => {
  if (autoBusy) return;
  try {
    const st = getSettings();
    // the default tier needs its own key present — otherwise every tick would burn a
    // failed request and mark a perfectly good image as permanently failed
    // isEnabled() reads the same autoAnalyze flag via the module's legacyFlag, so the Integrations
    // switch and the old Settings checkbox stay one control rather than two that can disagree.
    if (!isEnabled(st, 'moodanalyze')) return;
    if (!(resolveVision().provider === 'fal' ? falKey() : groqKey())) return;
    // NB: listProjects()/listAssets() can throw (malformed project.md, a file removed between
    // readdir and statSync). Those run outside the per-image try below, so the whole block is
    // guarded — an unhandled rejection here would take the server down under Node's defaults.
    const scopes = ['library', ...listProjects().map(p => p.id)];
    for (const scope of scopes) {
      const { items } = listAssets(scope);
      const c = items.find(i =>
        i.type === 'image' && RASTER.test(i.name) &&
        !(i.meta && i.meta.description) &&
        Date.now() - i.mtime > 4000 &&
        !autoFailed.has(scope + '/' + (i.folder || '') + '/' + i.name));
      if (!c) continue;
      autoBusy = true;
      const key = scope + '/' + (c.folder || '') + '/' + c.name;
      try {
        const p = assetPath(scope, c.name, c.folder);
        const meta = await analyzeImage(fs.readFileSync(p), c.name, { imageUrl: c.meta?.falUrl || null });
        if (meta.falUrl && meta.falUrl !== c.meta?.falUrl) meta.falAt = stamp();
        writeMeta(p, meta);
        appendActivity({ dot: 'green', t: 'Auto-initialized', t2: '· ' + c.name, s: (scope === 'library' ? 'library' : scope) + ' — vision metadata written on arrival', kind: scope === 'library' ? 'library' : 'proj', ref: scope === 'library' ? undefined : scope });
      } catch { autoFailed.add(key); }
      break; // one per tick
    }
  } catch (e) { console.warn('[frameforge] auto-analyze tick skipped:', e.message); }
  finally { autoBusy = false; }
};

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
  setInterval(autoAnalyzeTick, 6000);
  startWatch(30000); // fs.watch + 30s reconcile → external agent edits bump the revision too
  const HOST = process.env.HOST || '127.0.0.1';
  process.env.FRFG_SELF_PORT = String(PORT); // ticket 10 — the agent home renders the Index's api base from this
  // Without an 'error' listener an occupied port kills the process with a raw unhandled
  // EADDRINUSE stack — the usual cause being a previous instance that never shut down.
  const server = app.listen(PORT, HOST, () => console.log('[frameforge] api on ' + HOST + ':' + PORT + ' · storage root ' + getStorageRoot()));
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error('[frameforge] port ' + PORT + ' is already in use — another FrameForge is probably running.');
      console.error('[frameforge] pass a different port:  node backend/index.mjs ' + (PORT + 1) + '   (or set PORT=' + (PORT + 1) + ')');
    } else {
      console.error('[frameforge] could not start server — ' + e.message);
    }
    process.exit(1);
  });

  // Reports typed while the network was down go out now. Deliberately after listen and
  // deliberately unawaited: a feedback service having a bad day must never delay the app starting,
  // and the ordinary case (nothing queued) is silent.
  server.on('listening', () => { flushOutbox().catch(() => { /* still queued; try again next launch */ }); });
}
