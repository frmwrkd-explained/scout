// Style Locks — first-class reusable styles the user builds with the prompt builder and can
// slam onto any prompt. Stored as <storageRoot>/styles/<slug>.md (gray-matter, mirrors
// looks/prompts/snippets).
//
// frontmatter: { id, name, fav, created, updated, refImage, tags[], model,
//                picks{}, camera{}, aspect, presetId }
// body: the assembled style fragment.
//
// The `picks` / `camera` / `aspect` / `presetId` block is what makes a style RE-EDITABLE: a lock
// saved from the builder round-trips back into the axis grid instead of degrading into opaque
// prose. The body fragment stays authoritative for generation (and is the only thing a legacy or
// hand-written lock has), so a lock with no picks still works exactly as before.
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd, writeMd, stamp, safe, getSettings } from './store.mjs';
import { stageTrash } from './trash.mjs';
import { runProvider, providerReady } from './providers.mjs';
import { ledger } from './ledger.mjs';
import { providerOfModel, providerDef, estCost, DEFAULT_PREVIEW_MODEL, DEFAULT_RESOLUTION } from '../frontend/modelCatalog.js';

const R = () => getStorageRoot();
const stylesDir = () => path.join(R(), 'styles');
const lockFile = id => path.join(stylesDir(), safe(String(id)) + '.md');

function slugify(name) {
  return String(name || 'style').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'style';
}

// monotonic counter so two creates in the same millisecond get distinct ids — Date.now() alone
// collides under rapid/concurrent saves (e.g. batch import), silently overwriting the earlier file.
let seq = 0;
function newLockId(name) { return slugify(name) + '-' + Date.now().toString(36) + '-' + (++seq).toString(36); }

// ── reads ──
export function listLocks() {
  const dir = stylesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.')).map(f => {
    try {
      const { data, content } = readMd(path.join(dir, f));
      return { ...data, fragment: content.trim() };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) =>
    (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || String(b.updated || '').localeCompare(String(a.updated || '')));
}
export function getLock(id) {
  const file = lockFile(id);
  if (!fs.existsSync(file)) return null;
  const { data, content } = readMd(file);
  return { ...data, fragment: content.trim() };
}
export function refImagePath(id) {
  const l = getLock(id);
  if (!l || !l.refImage) return null;
  const p = path.join(stylesDir(), l.refImage);
  return fs.existsSync(p) ? p : null;
}

// ── ref image storage (base64 data URL in, filename under styles/ out) ──
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
function saveRefImageData(id, dataUrl, filenameHint) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  const ext = MIME_EXT[m[1]] || (filenameHint ? path.extname(String(filenameHint)) : '') || '.png';
  const file = safe(String(id)) + '.ref' + ext;
  fs.mkdirSync(stylesDir(), { recursive: true });
  fs.writeFileSync(path.join(stylesDir(), file), buf);
  return file;
}
function removeRefImage(filename) {
  if (!filename) return;
  try { fs.rmSync(path.join(stylesDir(), filename), { force: true }); } catch { /* already gone */ }
}

// ── composition sanitizers ──
// Everything here comes off the wire and lands in frontmatter that the composer will later
// trust, so each entry point assumes its argument is garbage. Shapes mirror lookBuilder.js:
//   picks  → { <axisKey>: [tokenDisplayName, …] }
//   camera → { picks: {…}, move, speed, stabilization }
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
function sanitizePicks(v) {
  if (!isObj(v)) return {};
  const out = {};
  for (const [k, names] of Object.entries(v)) {
    if (!Array.isArray(names)) continue;
    const list = names.map(n => String(n)).filter(Boolean).slice(0, 8);
    if (list.length) out[String(k)] = list;
  }
  return out;
}
function sanitizeCamera(v) {
  if (!isObj(v)) return null;
  const cam = {
    picks: sanitizePicks(v.picks),
    move: v.move ? String(v.move) : null,
    speed: v.speed ? String(v.speed) : 'normal',
    stabilization: v.stabilization ? String(v.stabilization) : 'smooth'
  };
  // an all-default camera carries no information — store null so `styleFromLock` can tell
  // "this style says nothing about the camera" from "this style wants the defaults".
  return (Object.keys(cam.picks).length || cam.move) ? cam : null;
}

// ── writes ──
// create when body.id is absent, update in place when present. refImageData (base64 data
// URL) replaces the ref image; clearRefImage removes it without setting a new one.
export function saveLock(body = {}) {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('name required');
  const isUpdate = !!body.id;
  const id = isUpdate ? safe(String(body.id)) : newLockId(name);
  const file = lockFile(id);
  let prev = {};
  if (isUpdate) {
    if (!fs.existsSync(file)) throw new Error('style lock not found');
    prev = readMd(file).data;
  }
  let refImage = prev.refImage || null;
  if (body.clearRefImage) { removeRefImage(refImage); refImage = null; }
  else if (body.refImageData) { removeRefImage(refImage); refImage = saveRefImageData(id, body.refImageData, body.refImageName); }

  const data = {
    id, name,
    fav: body.fav !== undefined ? !!body.fav : (prev.fav || false),
    created: prev.created || stamp(),
    updated: stamp(),
    refImage,
    tags: Array.isArray(body.tags) ? body.tags.map(t => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 16) : (prev.tags || []),
    model: body.model !== undefined ? String(body.model || '').trim() : (prev.model || ''),
    // the builder composition — see the header note. `undefined` means "not supplied by this
    // caller", which must preserve what's on disk; an explicit {} / null means "cleared".
    picks: body.picks !== undefined ? sanitizePicks(body.picks) : (prev.picks || {}),
    camera: body.camera !== undefined ? sanitizeCamera(body.camera) : (prev.camera || null),
    aspect: body.aspect !== undefined ? (body.aspect ? String(body.aspect) : null) : (prev.aspect ?? null),
    presetId: body.presetId !== undefined ? (body.presetId ? String(body.presetId) : null) : (prev.presetId ?? null)
  };
  const fragment = body.fragment !== undefined ? String(body.fragment) : (isUpdate ? readMd(file).content : '');
  writeMd(file, data, fragment.trim() + '\n');
  return { ...data, fragment: fragment.trim() };
}

export function deleteLock(id) {
  const file = lockFile(id);
  let refImage = null;
  if (fs.existsSync(file)) {
    try { refImage = readMd(file).data.refImage || null; } catch { /* corrupt file, still stage the md */ }
  }
  // staged, not destroyed — the lock md and its ref image restore together (Phase 3D)
  stageTrash([file, refImage ? path.join(stylesDir(), refImage) : null],
    { label: 'style lock ' + id, itemKind: 'style-lock' });
}

export function setFav(id, explicit) {
  const file = lockFile(id);
  if (!fs.existsSync(file)) return null;
  const { data, content } = readMd(file);
  data.fav = explicit !== undefined ? !!explicit : !data.fav;
  data.updated = stamp();
  writeMd(file, data, content);
  return { ...data, fragment: content.trim() };
}

// build a style lock from an existing item/asset's prompt — {name, prompt, refPath}.
// refPath, if given, must resolve inside the storage root; it's copied in as the ref thumb
// (best-effort — an unreadable/outside-root path is silently skipped, not a hard failure).
export function importFromItem(body = {}) {
  const name = String(body.name || 'Imported style').trim() || 'Imported style';
  const fragment = String(body.prompt || '').trim();
  if (!fragment) throw new Error('prompt required to import a style lock');
  let rec = saveLock({ name, fragment, tags: ['imported'] });

  const refPath = body.refPath ? String(body.refPath) : '';
  if (refPath) {
    try {
      const abs = path.resolve(refPath);
      const root = path.resolve(R());
      if ((abs === root || abs.startsWith(root + path.sep)) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const ext = path.extname(abs) || '.jpg';
        const filename = safe(rec.id) + '.ref' + ext;
        fs.mkdirSync(stylesDir(), { recursive: true });
        fs.copyFileSync(abs, path.join(stylesDir(), filename));
        const file = lockFile(rec.id);
        const { data, content } = readMd(file);
        data.refImage = filename;
        data.updated = stamp();
        writeMd(file, data, content);
        rec = { ...data, fragment: content.trim() };
      }
    } catch { /* best effort — the text-only lock above still stands */ }
  }
  return rec;
}

// ── preview image ──
// Render a sample frame FOR a style so the picker shows the look instead of a ✦ glyph.
//
// This deliberately does NOT go through startGeneration(): that is project-scoped (needs a pid,
// writes a generations/*.md record, shows up in the review inbox). A style preview belongs to no
// project and is not a candidate — it is a thumbnail. So we call the provider directly and hand
// the bytes back as a data URL, which the client parks in the draft and the ordinary save path
// (`refImageData`) then persists. Nothing hits disk until the user actually saves the style, so
// abandoning a draft leaves no orphan files behind.
const PREVIEW_SUBJECT = 'a lone figure standing in the middle of the frame, seen from behind';
const EXT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' };

export async function generatePreview(body = {}) {
  const fragment = String(body.fragment || '').trim();
  if (!fragment) throw new Error('nothing to preview yet — pick some options or write a fragment first');

  const settings = getSettings();
  const model = String(body.model || settings.modelDefaults?.preview || DEFAULT_PREVIEW_MODEL);
  const provider = providerOfModel(model);
  if (!provider) throw new Error('unknown model: ' + model);
  if (!providerReady(provider, settings)) {
    const p = providerDef(provider);
    throw new Error(((p && p.label) || provider) + ' is not configured — add its key in Settings');
  }

  // The fragment is a continuation clause ("shot on 35mm anamorphic, teal grade, …"), not a
  // sentence, so it needs a subject to hang off. A neutral one keeps the thumbnail about the
  // LOOK rather than about whatever happened to be in the caller's prompt.
  const subject = String(body.subject || '').trim() || PREVIEW_SUBJECT;
  const prompt = subject + ', ' + fragment.replace(/^[\s,]+/, '');

  const { fileUrl, cost } = await runProvider(provider, {
    model, prompt,
    aspect: String(body.aspect || '16:9'),
    resolution: String(body.resolution || DEFAULT_RESOLUTION),
    seed: body.seed ?? null,
    refUrls: []
  });
  if (!fileUrl) throw new Error('the provider returned no image');

  const r = await fetch(fileUrl);
  if (!r.ok) throw new Error('could not download the preview (' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = EXT_MIME[path.extname(new URL(fileUrl).pathname).toLowerCase()] || 'image/png';

  const spent = typeof cost === 'number' ? cost : estCost(model);
  ledger({ service: provider, op: 'image', model, units: '1 image', cost: spent, ref: 'style preview' });

  return { dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64'), model, cost: spent };
}

// ── route registration — call from backend/index.mjs; this file IS the style-lock contract ──
export function registerStyleLockRoutes(app, deps = {}) {
  const { appendActivity, bumpHistory } = deps;

  app.get('/api/stylelocks', (_req, res) => res.json(listLocks()));

  app.post('/api/stylelocks', (req, res) => {
    try {
      const wasUpdate = !!req.body?.id;
      const rec = saveLock(req.body || {});
      if (typeof bumpHistory === 'function' && !wasUpdate) bumpHistory('prompts');
      if (typeof appendActivity === 'function') {
        appendActivity({ dot: 'green', t: wasUpdate ? 'Style lock updated' : 'Style lock created', t2: '· ' + rec.name, s: 'styles/' + rec.id + '.md', kind: 'none' });
      }
      res.json(rec);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/api/stylelocks/:id', (req, res) => {
    deleteLock(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/stylelocks/:id/fav', (req, res) => {
    const rec = setFav(req.params.id, req.body?.fav);
    if (!rec) return res.status(404).json({ error: 'style lock not found' });
    res.json(rec);
  });

  app.post('/api/stylelocks/import-item', (req, res) => {
    try {
      const rec = importFromItem(req.body || {});
      if (typeof appendActivity === 'function') {
        appendActivity({ dot: 'green', t: 'Style lock imported', t2: '· ' + rec.name, s: 'from an existing item/asset prompt', kind: 'none' });
      }
      res.json(rec);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Render a sample frame for the style being edited. Costs real money, so it is always an
  // explicit user gesture — never fired on open, on typing, or on save.
  app.post('/api/stylelocks/preview', async (req, res) => {
    try {
      const rec = await generatePreview(req.body || {});
      if (typeof appendActivity === 'function') {
        appendActivity({ dot: 'amber', t: 'Style preview rendered', t2: '· ' + rec.model, s: '$' + rec.cost.toFixed(3), kind: 'none' });
      }
      res.json(rec);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // not in the original route list but required to render ref-image thumbs in the picker/manager
  app.get('/api/stylelocks/:id/ref', (req, res) => {
    const p = refImagePath(req.params.id);
    if (!p) return res.status(404).end();
    res.sendFile(p);
  });
}
