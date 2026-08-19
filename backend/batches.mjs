// Batch variants + durable generation queue (Phase 7). A batch is a portable record
// (batches/<batch-id>.md) that SNAPSHOTS the exact settings at queue time (prompt, style-lock
// fragment, model, aspect, refs, seed policy, variant count, estimated cost, maxSpend) so later
// project-default changes can't drift it. It creates one NORMAL generation record per candidate —
// never provider-native num_images — each with a stable idempotencyKey and a deterministic seed.
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd, writeMd, stamp, safe, safeScope, appendActivity } from './store.mjs';
import { startGeneration, estCost, listGenerations, enqueueExisting } from './generate.mjs';
import { DEFAULT_RESOLUTION } from '../frontend/modelCatalog.js';

const dir = () => path.join(getStorageRoot(), 'batches');
const batchMd = id => path.join(dir(), safe(id) + '.md');
let seq = 0;

export function listBatches() {
  const d = dir();
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .map(f => { try { return readMd(path.join(d, f)).data; } catch { return null; } })
    .filter(Boolean).sort((a, b) => (b.created || 0) - (a.created || 0));
}
export function readBatch(id) { try { return readMd(batchMd(id)).data; } catch { return null; } }
function writeBatch(b) { writeMd(batchMd(b.id), b, '## Batch\n\n' + (b.status || '') + ' — ' + (b.completedCount || 0) + '/' + ((b.entries || []).length) + ' done\n'); return b; }
export function patchBatch(id, patch) { const b = readBatch(id); if (!b) return null; return writeBatch({ ...b, ...patch }); }

// deterministic per-variant seed from a base seed (LCG step); null base → provider default seed
function variantSeed(base, i) { return base == null ? null : (((Number(base) >>> 0) + i * 1013904223) >>> 0); }

// Estimate a batch WITHOUT queueing it — powers the composer's cost preview.
export function estimateBatch({ model, shotIds = [], variantCount = 4, maxSpend = null }) {
  const per = estCost(model);
  const total = (shotIds.length || 1) * variantCount;
  return { variantCount, candidates: total, estPerCandidate: per, estimatedCost: per * total, maxSpend: maxSpend == null ? null : Number(maxSpend) };
}

export function createBatch({ pid, shotIds = [], prompt, model, aspect = '16:9', resolution = DEFAULT_RESOLUTION, refs = [], refUrls = [], styleLockFragment = '', variantCount = 4, baseSeed = null, maxSpend = null, params = null, sessionId = null }) {
  if (!prompt || !String(prompt).trim()) throw new Error('prompt is empty');
  if (!model) throw new Error('model is required');
  const spid = safeScope(pid);
  const vc = Math.max(1, Math.min(16, Number(variantCount) || 1));
  const id = 'batch-' + Date.now() + '-' + (++seq);
  const shots = shotIds.length ? shotIds.map(String) : [null];
  const est = estimateBatch({ model, shotIds: shots, variantCount: vc, maxSpend });
  // immutable snapshot — the batch never re-reads project defaults after this point
  const snapshot = { prompt: String(prompt).trim(), model, aspect, resolution: resolution || DEFAULT_RESOLUTION, refs, refUrls, styleLockFragment: String(styleLockFragment || ''), variantCount: vc, baseSeed: baseSeed ?? null, params: (params && typeof params === 'object' && !Array.isArray(params)) ? params : null };
  writeBatch({
    id, schema: 1, project: spid, status: 'queued', created: Date.now(), createdAt: stamp(), started: Date.now(), ended: null,
    shotIds: shots.map(s => s || ''), variantCount: vc, estimatedCost: est.estimatedCost,
    // ticket 22 — the chat session that queued this batch (agent confirm-card / manual mode), so each
    // candidate's ledgered spend attributes to the session. null for a batch queued outside chat.
    sessionId: sessionId || null,
    maxSpend: est.maxSpend, actualSpend: 0, completedCount: 0, failedCount: 0, cancelledCount: 0,
    concurrency: 2, snapshot, entries: [], errors: []
  });
  const existingKeys = new Set(listGenerations(spid).map(g => g.idempotencyKey));
  const entries = [];
  const composedPrompt = snapshot.styleLockFragment ? (snapshot.prompt + ' ' + snapshot.styleLockFragment) : snapshot.prompt;
  for (const shot of shots) {
    for (let v = 0; v < vc; v++) {
      const idem = id + ':' + (shot || 'noshot') + ':' + v;
      if (existingKeys.has(idem)) continue; // idempotent: never create the same candidate twice
      const seed = variantSeed(snapshot.baseSeed, v);
      const gen = startGeneration({ pid: spid, shot: shot || null, prompt: composedPrompt, model, aspect, resolution: snapshot.resolution, seed, refs, refUrls, batchId: id, variantIndex: v, idempotencyKey: idem, params: snapshot.params, sessionId: sessionId || null });
      entries.push({ gen: gen.id, shot: shot || '', variantIndex: v, idempotencyKey: idem, seed });
    }
  }
  patchBatch(id, { entries });
  appendActivity({ dot: 'green', t: 'Batch queued', t2: '· ' + entries.length + ' variants', s: spid + ' · est $' + est.estimatedCost.toFixed(2) + (est.maxSpend != null ? ' · max $' + est.maxSpend.toFixed(2) : ''), kind: 'proj', ref: spid, hl: 1 });
  return readBatch(id);
}

// Budget gate — called by generate.run() BEFORE spending on a candidate. Pauses the batch (hard
// ceiling) when the next candidate would exceed maxSpend; blocks paused/cancelled batches too.
export function checkBatchBudget(batchId, estCandidateCost) {
  const b = readBatch(batchId);
  if (!b) return { ok: true };
  if (b.status === 'cancelled' || b.status === 'paused') return { blocked: true, reason: b.status };
  if (b.maxSpend != null && (Number(b.actualSpend || 0) + Number(estCandidateCost || 0)) > Number(b.maxSpend) + 1e-9) {
    patchBatch(batchId, { status: 'paused', pauseReason: 'budget ceiling reached' });
    appendActivity({ dot: 'amber', t: 'Batch paused', t2: '· ' + batchId, s: 'budget ceiling reached ($' + Number(b.maxSpend).toFixed(2) + ')', kind: 'proj', ref: b.project });
    return { blocked: true, reason: 'budget ceiling reached' };
  }
  if (b.status === 'queued') patchBatch(batchId, { status: 'running' });
  return { ok: true };
}

// Called by generate.run() on completion/failure — updates counters + spend and closes the batch.
export function applyBatchResult(batchId, { cost = 0, ok }) {
  const b = readBatch(batchId);
  if (!b) return;
  const completedCount = (b.completedCount || 0) + (ok ? 1 : 0);
  const failedCount = (b.failedCount || 0) + (ok ? 0 : 1);
  const patch = { completedCount, failedCount, actualSpend: Number(b.actualSpend || 0) + (ok ? Number(cost || 0) : 0) };
  const settled = completedCount + failedCount + (b.cancelledCount || 0);
  if (settled >= (b.entries || []).length && (b.status === 'running' || b.status === 'queued')) { patch.status = 'done'; patch.ended = Date.now(); }
  patchBatch(batchId, patch);
}

// ── controls ──
export function pauseBatch(id) { const b = readBatch(id); if (!b) return null; if (b.status === 'running' || b.status === 'queued') patchBatch(id, { status: 'paused', pauseReason: 'paused by user' }); return readBatch(id); }
export function resumeBatch(id) {
  const b = readBatch(id);
  if (!b || (b.status !== 'paused')) return b;
  patchBatch(id, { status: 'running', pauseReason: null });
  // re-enqueue every still-queued candidate of this batch
  for (const g of listGenerations(b.project)) if (g.batchId === id && g.status === 'queued') enqueueExisting(b.project, g.id);
  return readBatch(id);
}
export function cancelBatch(id) {
  const b = readBatch(id);
  if (!b) return null;
  // cancel only QUEUED candidates — completed candidates and their media are never touched
  let cancelled = 0;
  const gens = listGenerations(b.project);
  for (const g of gens) {
    if (g.batchId === id && g.status === 'queued') {
      try { writeMd(path.join(getStorageRoot(), 'projects', b.project, 'generations', safe(g.id) + '.md'), { ...g, status: 'cancelled', reviewState: 'pending', ended: Date.now(), endedAt: stamp() }, 'cancelled\n'); cancelled++; } catch { /* skip */ }
    }
  }
  patchBatch(id, { status: 'cancelled', cancelledCount: (b.cancelledCount || 0) + cancelled, ended: Date.now() });
  return readBatch(id);
}

// Retry the failed candidates of a batch. Same seed by default (deterministic re-attempt); `fresh`
// clears the seed for a genuinely different roll. Idempotency keys are preserved either way.
export function retryBatch(id, { fresh = false } = {}) {
  const b = readBatch(id);
  if (!b) return null;
  let retried = 0;
  const genDir = path.join(getStorageRoot(), 'projects', b.project, 'generations');
  for (const g of listGenerations(b.project)) {
    if (g.batchId !== id || g.status !== 'failed') continue;
    const next = { ...g, status: 'queued', reviewState: 'pending', error: null, ended: null, endedAt: null };
    if (fresh) next.seed = null;
    try { writeMd(path.join(genDir, safe(g.id) + '.md'), next, 'retry\n'); retried++; enqueueExisting(b.project, g.id); } catch { /* skip */ }
  }
  patchBatch(id, { status: 'running', failedCount: Math.max(0, (b.failedCount || 0) - retried), pauseReason: null });
  return { retried, batch: readBatch(id) };
}

// Restart reconstruction (Phase 7 durable queue). Called at boot: any batch that was queued/running
// gets its still-`queued` candidates re-enqueued so no work is silently lost. (sweepOrphans already
// classifies previously-`running` candidates as failed+retryable before this runs.)
export function reconstructQueue() {
  let re = 0;
  for (const b of listBatches()) {
    if (b.status !== 'queued' && b.status !== 'running') continue;
    for (const g of listGenerations(b.project)) {
      if (g.batchId === b.id && g.status === 'queued') { if (enqueueExisting(b.project, g.id)) re++; }
    }
  }
  return re;
}
