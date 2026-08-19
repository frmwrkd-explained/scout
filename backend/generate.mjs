// Generation hub (F2) — the bridge from shots to real assets. Provider-agnostic: resolve refs
// (into BOTH hosted https urls and local file paths) → route by the model's provider via
// backend/providers.mjs (FAL / Kie / Higgsfield CLI / Arcads-through-Claude) → download into
// projects/<pid>/renders/ → ledger the cost. Every attempt is a portable
// projects/<pid>/generations/<id>.md record.
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd, writeMd, stamp, safe, safeScope, getSettings, appendActivity, bumpHistory, revOf } from './store.mjs';
import { assetPath, readMeta, writeMeta, scopeDir } from './library.mjs';
import { uploadToFal, falKey } from './fal.mjs';
import { ledger } from './ledger.mjs';
import { patchShot, getShot } from './story.mjs';
import { runProvider, providerReady } from './providers.mjs';
import { providerOfModel, isVideoModel, isAudioModel, isEditModel, estCost, providerDef, DEFAULT_RESOLUTION, maxRefs } from '../frontend/modelCatalog.js';
import { imageSize } from './imageSize.mjs';
import { stageTrash } from './trash.mjs';
// batches.mjs imports startGeneration/estCost/listGenerations back — the cycle is safe because every
// cross-reference is used inside a function, never at module-init time (same pattern as store↔memory).
import { checkBatchBudget, applyBatchResult } from './batches.mjs';
export { estCost };

const R = () => getStorageRoot();
const gensDir = pid => path.join(R(), 'projects', safeScope(pid), 'generations');
const gensMd = (pid, id) => path.join(gensDir(pid), safe(id) + '.md');
export const rendersDir = pid => path.join(R(), 'projects', safeScope(pid), 'renders');

// Ledger attribution ref (ticket 22). Base is `<pid>[/<shot>]` exactly as before; a generation
// started FROM a chat session carries a compact ` · chat:<sessionId>` suffix so its spend attributes
// to that session on the Costs page. The pid/shot prefix is preserved VERBATIM — project-spend
// filters key on it (App.projSpend strips the ` · chat:` suffix before matching), so the suffix is
// purely additive and never breaks per-project totals.
export function ledgerRef(pid, shot, sessionId) {
  const base = pid + (shot ? '/' + shot : '');
  return sessionId ? base + ' · chat:' + sessionId : base;
}
export const renderPath = (pid, name) => {
  const p = path.join(rendersDir(pid), path.basename(String(name)));
  return fs.existsSync(p) ? p : null;
};

const MAX_CONCURRENT = 2;
const isVideo = isVideoModel; // kind-based (works across every provider, not just fal ids)
const isAudio = isAudioModel; // music/voice/sfx — lands an audio file, no width/height, no ref auto-route
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];

function readGen(pid, id) {
  try { const { data } = readMd(gensMd(pid, id)); return data; } catch { return null; }
}
function writeGen(pid, gen) {
  writeMd(gensMd(pid, gen.id), gen, 'Generation record — portable, readable by any tool.\n');
  return gen;
}
function patchGen(pid, id, patch) {
  const g = readGen(pid, id);
  if (!g) return null;
  return writeGen(pid, { ...g, ...patch });
}

export function listGenerations(pid) {
  const dir = gensDir(pid);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .map(f => { try { const { data } = readMd(path.join(dir, f)); return { ...data, rev: revOf(data, '') }; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => (b.started || 0) - (a.started || 0));
}
export function getGeneration(pid, id) {
  const g = readGen(pid, id);
  return g ? { ...g, rev: revOf(g, '') } : null;
}

let seq = 0;
const queue = []; // { pid, id } waiting to run
let running = 0;

// boot sweep — a server restart orphans in-flight jobs; fail them with a readable error
// instead of leaving them pulsing forever (F2 acceptance: kill the server mid-generation)
export function sweepOrphans() {
  const projRoot = path.join(R(), 'projects');
  if (!fs.existsSync(projRoot)) return;
  for (const pid of fs.readdirSync(projRoot).filter(d => !d.startsWith('.') && !d.startsWith('_'))) {
    for (const g of listGenerations(pid)) {
      if (g.status === 'queued' || g.status === 'running') {
        patchGen(pid, g.id, { status: 'failed', error: 'server restarted mid-generation — re-roll to retry', ended: Date.now(), endedAt: stamp() });
        if (g.shot) patchShot(pid, g.shot, { status: 'todo' }, 'generation ' + g.id + ' orphaned by server restart');
      }
    }
  }
}

export function startGeneration({ pid, shot = null, prompt, model, aspect = '16:9', resolution = DEFAULT_RESOLUTION, seed = null, refs = [], refUrls = [],
  parentGeneration = null, batchId = null, variantIndex = null, idempotencyKey = null, note = '', params = null, sessionId = null }) {
  if (!prompt || !String(prompt).trim()) throw new Error('prompt is empty');
  if (!model) throw new Error('model is required');
  const provider = providerOfModel(model);
  if (!providerReady(provider)) {
    const p = providerDef(provider);
    throw new Error((p?.label || provider) + ' isn’t connected — ' + (p?.connect || 'set it up in Settings') + '.');
  }
  if ((getSettings().disabledModels || []).includes(model)) throw new Error(model + ' is disabled — re-enable it in Tools → Model Catalog');
  const id = 'gen-' + Date.now() + '-' + (++seq);
  // Phase 2 — the generation record IS the review candidate (schema 2). reviewState is the decision
  // (pending while queued/running/failed → new on success → kept/killed by the user). The provider
  // output is immutable once completed; a reroll makes a NEW record with parentGeneration set here.
  const gen = writeGen(pid, {
    id, schema: 2, shot: shot || null, tool: parentGeneration ? 'reroll' : 'generate', model, prompt: String(prompt).trim(),
    aspect, resolution: resolution || DEFAULT_RESOLUTION, seed: seed ?? null,
    // raw per-model spec fields from SchemaForm (ticket 05) — provider adapters spread these over
    // the generic aspect/resolution mapping, so a synced spec's own fields win
    params: (params && typeof params === 'object' && !Array.isArray(params)) ? params : {},
    width: null, height: null, // filled from the delivered file — the provider has the final say
    refUrls: (refUrls || []).map(String).filter(u => /^https:\/\//.test(u)).slice(0, maxRefs(model)), // already-hosted stills (i2v)
    refs: [], refInputs: refs, // refInputs = {scope,name,folder}; refs = resolved falUrls
    status: 'queued', reviewState: 'pending', rating: 0, final: false,
    reviewedAt: null, decidedAt: null, note: String(note || ''),
    parentGeneration: parentGeneration || null, batchId: batchId || null,
    // ticket 22 — the chat session that started this generation (agent turn / manual mode), so its
    // ledgered cost attributes to the session. null for a generation started outside chat.
    sessionId: sessionId || null,
    variantIndex: variantIndex == null ? null : Number(variantIndex),
    idempotencyKey: idempotencyKey || id,
    routedTo: { kind: 'none', project: null, shot: null, folder: null, name: null },
    promotedAssets: [],
    file: null, cost: 0, requestId: null,
    createdAt: stamp(), started: Date.now(), startedAt: stamp(), ended: null, error: null
  });
  if (shot) patchShot(pid, shot, { status: 'generating' }, 'generation ' + id + ' queued');
  queue.push({ pid, id });
  tick();
  return gen;
}

// ── smart render filenames — scene/shot-aware and human-readable instead of gen-<timestamp>.
// Shot gens:   SC02_SH030_dock-approach_v3.png   (scene no · shot id · shot/scene title · version)
// Quick gens:  first-words-of-the-prompt_v1.png
// The version suffix is chosen at write time with an exclusive-create ('wx') retry loop, so
// concurrent generations for the same shot can never clobber each other's file.
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// truncate a slug at a word (dash) boundary instead of mid-word
const slugTrim = (s, max) => { if (s.length <= max) return s; const cut = s.slice(0, max + 1); const i = cut.lastIndexOf('-'); return (i > 0 ? cut.slice(0, i) : cut.slice(0, max)).replace(/-+$/, ''); };
export function smartRenderBase(pid, gen) {
  const sh = gen.shot ? getShot(pid, gen.shot) : null;
  if (sh) {
    const parts = [];
    let t = slugify(sh.title || sh.sceneTitle || '');
    // titles like "s01-t03-find-camera" carry their own scene/take prefix — lift it out
    const m = t.match(/^s(\d{1,2})-(?:t\d{1,2}-)?(.*)$/);
    const scene = sh.scene || (m ? Number(m[1]) : 0);
    if (m) t = m[2];
    if (scene) parts.push('SC' + String(scene).padStart(2, '0'));
    parts.push(sh.id);
    t = slugTrim(t, 32);
    if (t) parts.push(t);
    return parts.join('_');
  }
  return slugTrim(slugify(gen.prompt).split('-').slice(0, 6).join('-'), 40) || 'gen';
}
function writeRenderSmart(pid, gen, ext, bin) {
  const dir = rendersDir(pid);
  const base = smartRenderBase(pid, gen);
  for (let v = 1; ; v++) {
    const name = base + '_v' + v + '.' + ext;
    try { fs.writeFileSync(path.join(dir, name), bin, { flag: 'wx' }); return name; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

// Test hook: empty the in-memory run queue to simulate a process restart (disk records are the
// durable truth; a fresh process starts with an empty queue). No-op outside tests.
export function __resetQueueForTests() { queue.length = 0; running = 0; }

// Re-enqueue an already-written `queued` generation record (batch resume / restart reconstruction).
// Never duplicates: the record already exists on disk; we only add it to the in-memory run queue.
export function enqueueExisting(pid, id) {
  const g = readGen(pid, id);
  if (!g || g.status !== 'queued') return false;
  if (queue.some(q => q.pid === pid && q.id === id)) return false;
  queue.push({ pid, id });
  tick();
  return true;
}

// Under tests the provider queue does not auto-run — records stay `queued` on disk, exactly as a
// durable queue would leave them across a restart. This keeps tests hermetic (no provider network).
const RUN_QUEUE = process.env.FRFG_TEST !== '1';
function tick() {
  if (!RUN_QUEUE) return;
  while (running < MAX_CONCURRENT && queue.length) {
    const next = queue.shift();
    running++;
    run(next.pid, next.id).catch(() => { }).finally(() => { running--; tick(); });
  }
}

async function run(pid, id) {
  let gen = readGen(pid, id);
  if (!gen || gen.status !== 'queued') return;
  try {
    gen = patchGen(pid, id, { status: 'running' });

    // 1. resolve refs → hosted https urls (rest providers) AND local file paths (the higgsfield
    //    CLI takes paths directly). Hosting reuses FAL storage on demand when a FAL key exists.
    const refUrls = [...(gen.refUrls || [])];
    const refPaths = [];
    for (const r of gen.refInputs || []) {
      // kind:'render' — a previous generation's output dragged straight back into the composer
      // (image-to-image without a round-trip through the library). Renders live outside the
      // asset scopes, so they resolve through renderPath instead of assetPath.
      const p = r.kind === 'render'
        ? renderPath(r.scope || pid, String(r.name || ''))
        : assetPath(r.scope, String(r.name || ''), String(r.folder || ''));
      if (!p) continue;
      refPaths.push(p);
      const meta = readMeta(p) || {};
      if (meta.falUrl) { refUrls.push(meta.falUrl); continue; }
      if (falKey()) {
        try {
          const url = await uploadToFal(fs.readFileSync(p), String(r.name));
          writeMeta(p, { falUrl: url, falAt: stamp() });
          refUrls.push(url);
        } catch { /* hosting is best-effort — CLI providers still get the local path */ }
      }
    }

    let model = gen.model;
    const provider = providerOfModel(model);

    // Refs reach a REST provider only as hosted https URLs, and the only host here is FAL. So a
    // user on Kie with no FAL key attached reference images, saw them accepted, and generated
    // WITHOUT them — the pictures never left the machine and nothing said so. The result looks
    // like the model ignoring the references rather than the app never sending them.
    //
    // CLI providers are unaffected: they take refPaths and read the files directly.
    // PROVIDERS entries carry `type` ('rest' | 'cli' | 'agent'), not `kind` — `kind` is the
    // MODEL vocabulary (render/video/music/…). Reading the wrong one here would have made this
    // guard permanently false, which is the same silent-no-op it exists to prevent.
    if (providerDef(provider)?.type === 'rest' && provider !== 'fal' && refPaths.length && !refUrls.length) {
      throw new Error('Reference images need a FAL key to host them — add one in Settings, '
        + 'or generate without references. (' + refPaths.length + ' reference'
        + (refPaths.length > 1 ? 's were' : ' was') + ' attached but could not be sent.)');
    }

    // 2. FAL-only edit routing: refs present + a plain t2i FAL model → the configured edit model.
    //    Other providers accept refs natively (Kie referenceImages, Higgsfield --image), so skip.
    if (provider === 'fal' && refUrls.length && !isEditModel(model) && !isVideo(model) && !isAudio(model)) {
      model = getSettings().modelDefaults?.edit || 'fal-ai/nano-banana-2/edit';
      if ((getSettings().disabledModels || []).includes(model)) {
        throw new Error(model + ' (the configured edit model) is disabled — re-enable it in Tools → Model Catalog or change the edit default');
      }
    }
    gen = patchGen(pid, id, { refs: refUrls, model, provider });

    // 2b. BUDGET CEILING (Phase 7) — server-enforced, checked before we spend. If this candidate
    // would push the batch over its maxSpend, pause the batch and hold this candidate as `queued`
    // (resume re-enqueues it). This is a hard ceiling, independent of the monthly budget bar.
    if (gen.batchId) {
      const gate = checkBatchBudget(gen.batchId, estCost(model));
      if (gate && gate.blocked) { patchGen(pid, id, { status: 'queued' }); return; }
    }

    // 3. submit to the right provider adapter → { fileUrl, cost }
    // `duration` is passed explicitly: video is priced per second, and without it the adapter
    // ledgers every clip at the flat default while the composer quotes the user the real figure.
    const res = await runProvider(provider, {
      model, prompt: gen.prompt, aspect: gen.aspect, resolution: gen.resolution || DEFAULT_RESOLUTION,
      seed: gen.seed, refUrls, refPaths, params: gen.params || {},
      duration: gen.duration ?? gen.params?.duration ?? gen.params?.duration_seconds
    });
    const fileUrl = res && res.fileUrl;
    if (!fileUrl) throw new Error((providerDef(provider)?.label || provider) + ' returned no media URL');

    // 4. download the produced file locally
    const clean = fileUrl.split('?')[0];
    const rawExt = (clean.split('.').pop() || '').toLowerCase();
    const ext = isVideo(model) ? 'mp4'
      : isAudio(model) ? (AUDIO_EXTS.includes(rawExt) ? rawExt : 'mp3')
      : (rawExt.length >= 2 && rawExt.length <= 4 ? rawExt : 'png');
    const dl = await fetch(fileUrl);
    if (!dl.ok) throw new Error('media download failed (' + dl.status + ')');
    const bin = Buffer.from(await dl.arrayBuffer());
    if (bin.length < 128) throw new Error('media download was empty — result URL returned ' + bin.length + ' bytes');
    fs.mkdirSync(rendersDir(pid), { recursive: true });
    const fname = writeRenderSmart(pid, gen, ext, bin);

    // 5. cost → ledger (service = the provider that actually ran)
    const cost = typeof res.cost === 'number' ? res.cost : estCost(model);
    const op = isVideo(model) ? 'video' : isAudio(model) ? 'audio' : 'image';
    const unit = isVideo(model) ? 'clip' : isAudio(model) ? 'audio' : 'img';
    ledger({ service: provider, op, model, units: '1 ' + unit, cost, ref: ledgerRef(pid, gen.shot, gen.sessionId) });
    bumpHistory('rerolls');
    // success → the candidate enters normal review as `new` (Inbox primary queue)
    const dim = (isVideo(model) || isAudio(model)) ? null : imageSize(bin); // audio/video carry no pixel size
    patchGen(pid, id, {
      status: 'done', reviewState: 'new', file: fname, cost, resultUrl: fileUrl,
      width: dim?.width ?? null, height: dim?.height ?? null,
      ended: Date.now(), endedAt: stamp()
    });
    if (gen.shot) patchShot(pid, gen.shot, {}, 'generation ' + id + ' done → renders/' + fname);
    if (gen.batchId) applyBatchResult(gen.batchId, { cost, ok: true });
    appendActivity({ dot: 'green', t: 'Generation done', t2: '· ' + (gen.shot || id), s: pid + ' · ' + model + ' · $' + cost.toFixed(3), kind: 'proj', ref: pid, hl: 1 });
  } catch (e) {
    patchGen(pid, id, { status: 'failed', error: String(e.message || e).slice(0, 300), ended: Date.now(), endedAt: stamp() });
    const g = readGen(pid, id);
    if (g?.shot) patchShot(pid, g.shot, { status: 'todo' }, 'generation failed: ' + String(e.message || e).slice(0, 120));
    if (g?.batchId) applyBatchResult(g.batchId, { ok: false });
    appendActivity({ dot: 'red', t: 'Generation failed', t2: '· ' + (gen?.shot || id), s: String(e.message || e).slice(0, 90), kind: 'proj', ref: pid });
  }
}

// Staged, undoable (Phase 3D): the generation record — and its render media when nothing else
// references it — move to trash as one restorable unit rather than being rm'd.
export function deleteGeneration(pid, id) {
  const g = readGen(pid, id);
  if (!g) return false;
  const toStage = [gensMd(pid, id)];
  // include the render file only if no OTHER generation or triage item still references it
  if (g.file) {
    const referenced = listGenerations(pid).some(x => x.id !== id && x.file === g.file);
    let inItems = false;
    try {
      const idir = path.join(R(), 'projects', safeScope(pid), 'items');
      inItems = fs.existsSync(idir) && fs.readdirSync(idir).some(f => {
        try { return f.endsWith('.md') && fs.readFileSync(path.join(idir, f), 'utf8').includes(g.file); } catch { return false; }
      });
    } catch { /* keep the file on any doubt */ inItems = true; }
    if (!referenced && !inItems) toStage.push(path.join(rendersDir(pid), g.file));
  }
  stageTrash(toStage, { label: pid + '/' + id, itemKind: 'generation' });
  return true;
}

// ── Phase 2: candidate review (the generation record IS the candidate) ──
const cleanName = n => { const b = path.basename(String(n)).replace(/[/\\]+/g, '_'); return b === '..' || b === '.' ? '_' : b; };
const cleanBoard = f => String(f || '').split('/')[0].replace(/[^\w\- ]+/g, '').trim();

// Conflict guard mirroring store.detectConflict: if a baseRev was supplied and the record drifted
// on a field being changed, refuse rather than clobber a concurrent (agent) edit.
function candidateConflict(g, baseRev, baseValues) {
  if (baseRev == null) return null;
  const currentRev = revOf(g, '');
  if (baseRev === currentRev) return null;
  const touched = baseValues && typeof baseValues === 'object' ? Object.keys(baseValues) : [];
  const conflictingFields = touched.filter(k => JSON.stringify(g[k]) !== JSON.stringify(baseValues[k]));
  if (!conflictingFields.length) return null;
  const currentValues = {}; for (const k of conflictingFields) currentValues[k] = g[k];
  return { conflict: true, currentRev, currentValues, conflictingFields };
}

// Reconcile the linked shot's chosen candidate after a decision. Never destroys older candidates.
function syncShotSelection(pid, gen) {
  if (!gen.shot) return;
  const sh = getShot(pid, gen.shot);
  if (!sh) return;
  if (gen.final && gen.reviewState === 'kept') {
    patchShot(pid, gen.shot, { selectedCandidate: gen.id, selectedAt: Date.now(), status: 'done' }, 'candidate ' + gen.id + ' marked final → selected');
  } else if (gen.reviewState === 'kept') {
    const patch = { status: sh.status === 'done' ? 'done' : 'review' };
    if (!sh.selectedCandidate) { patch.selectedCandidate = gen.id; patch.selectedAt = Date.now(); }
    patchShot(pid, gen.shot, patch, 'candidate ' + gen.id + ' kept');
  } else if (gen.reviewState === 'killed' && sh.selectedCandidate === gen.id) {
    patchShot(pid, gen.shot, { selectedCandidate: null, selectedAt: null, status: sh.status === 'done' ? 'review' : sh.status }, 'selected candidate ' + gen.id + ' killed → selection cleared');
  }
}

// Apply a review decision to a candidate. `patch` may set reviewState (new|kept|killed), rating,
// final, note. Stamps reviewedAt/decidedAt and reconciles the shot. Optimistic-conflict aware.
export function reviewCandidate(pid, id, patch = {}, opts = {}) {
  const g = readGen(pid, id);
  if (!g) return null;
  const conflict = candidateConflict(g, opts.baseRev, opts.baseValues);
  if (conflict) return conflict;
  const allowed = {};
  for (const k of ['reviewState', 'rating', 'final', 'note', 'label']) if (patch[k] !== undefined) allowed[k] = patch[k];
  const next = { ...g, ...allowed };
  if (allowed.reviewState !== undefined || allowed.rating !== undefined || allowed.final !== undefined) {
    next.reviewedAt = stamp();
    if (allowed.reviewState !== undefined && allowed.reviewState !== g.reviewState) next.decidedAt = Date.now();
  }
  writeGen(pid, next);
  syncShotSelection(pid, next);
  return { ...next, rev: revOf(next, '') };
}

// Reroll: create a NEW candidate whose parentGeneration points at the source (reroll lineage).
// Reuses the source's immutable prompt/model/aspect/refs snapshot; a fresh seed is opt-in.
//
// DEV-134 — this used to drop `params` and `sessionId`. `params` carries the model's OWN synced-spec
// settings from SchemaForm (guidance, steps, safety tolerance, a duration enum…), and the provider
// adapter spreads them over the generic aspect/resolution mapping (backend/providers.mjs), so losing
// them meant a re-roll of a carefully tuned generation silently came back on the model's defaults —
// a different image, with no indication why. `sessionId` is the chat-turn attribution: without it a
// re-roll's cost fell off the session it belongs to. A reroll is supposed to be "the same request
// again"; anything not carried here is a lie about that.
export function rerollCandidate(pid, id, { note = '', freshSeed = false } = {}) {
  const src = readGen(pid, id);
  if (!src) return null;
  return startGeneration({
    pid, shot: src.shot || null, prompt: src.prompt, model: src.model, aspect: src.aspect,
    resolution: src.resolution || DEFAULT_RESOLUTION,
    seed: freshSeed ? null : (src.seed ?? null),
    refs: src.refInputs || [], refUrls: src.refUrls || [],
    params: src.params || null, sessionId: src.sessionId || null,
    parentGeneration: id, note
  });
}

// Promote a candidate to a project board (scope = pid) or the global library (scope = 'library').
// IDEMPOTENT: the destination filename is derived from the generation id, and a matching entry in
// promotedAssets short-circuits a repeat call — the same action never yields unbounded duplicates.
// Writes a provenance sidecar so a routed asset always remembers where it came from.
export function promoteCandidate(pid, id, { scope, folder = '', name = '' }) {
  const g = readGen(pid, id);
  if (!g || g.status !== 'done' || !g.file) throw new Error('generation not finished');
  const src = renderPath(pid, g.file);
  if (!src) throw new Error('render file missing');
  const targetScope = scope === 'library' ? 'library' : safeScope(scope || pid);
  const f = cleanBoard(folder);
  // default to the render's own (smart, scene/shot-aware) filename — still deterministic per
  // generation, so the idempotency short-circuit below keeps holding
  const targetName = cleanName(name || g.file);

  const prior = (g.promotedAssets || []).find(a => a.scope === targetScope && (a.folder || '') === f && a.name === targetName);
  const dir = path.join(scopeDir(targetScope), f);
  const dst = path.join(dir, targetName);
  if (prior && fs.existsSync(dst)) return { ...prior, idempotent: true };

  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, dst);
  // provenance sidecar (merges into any existing .meta.md)
  writeMeta(dst, {
    sourceProject: pid, sourceGeneration: g.id, sourceShot: g.shot || '', sourceBatch: g.batchId || '',
    sourceModel: g.model || '', sourcePrompt: g.prompt || '', sourceCost: g.cost || 0, promotedAt: stamp()
  });
  const entry = { scope: targetScope, folder: f, name: targetName };
  const promotedAssets = [...(g.promotedAssets || []).filter(a => !(a.scope === entry.scope && (a.folder || '') === entry.folder && a.name === entry.name)), entry];
  const routedTo = { kind: targetScope === 'library' ? 'library' : 'board', project: targetScope === 'library' ? null : targetScope, shot: g.shot || null, folder: f, name: targetName };
  patchGen(pid, id, { promotedAssets, routedTo });
  return { ...entry, idempotent: false };
}

// Repurposed keep-to-shot: NO <shot>_gen item is ever written (Phase 2). Marks the candidate kept
// and lets syncShotSelection choose it as the shot's selection when none exists. `final` promotes it
// to shot.selectedCandidate outright. An explicit targetShot re-homes a shot-less quick-gen.
export function saveToShot(pid, id, targetShot, { final = false } = {}) {
  const g = readGen(pid, id);
  if (!g || g.status !== 'done' || !g.file) throw new Error('generation not finished');
  const shotId = targetShot || g.shot;
  if (!shotId) throw new Error('generation has no shot — use save-to-board instead');
  if (!getShot(pid, shotId)) throw new Error('shot ' + shotId + ' not found');
  if (targetShot && targetShot !== g.shot) patchGen(pid, id, { shot: shotId });
  const res = reviewCandidate(pid, id, { reviewState: 'kept', final: !!final });
  appendActivity({ dot: 'green', t: final ? 'Candidate selected (final)' : 'Candidate kept for shot', t2: '· ' + shotId, s: pid + ' · renders/' + g.file, kind: 'proj', ref: pid, hl: 1 });
  return { shot: shotId, genId: id, reviewState: res.reviewState, final: res.final, selected: !!final };
}

export function saveToBoard(pid, id, folder) {
  return promoteCandidate(pid, id, { scope: pid, folder });
}
