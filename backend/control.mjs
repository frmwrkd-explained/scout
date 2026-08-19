// Control Maps — turn any approved still into geometry-conditioning maps (depth, edges,
// pose skeleton, cutout matte) via FAL's preprocessor endpoints. Derived maps land in
// <root>/library/control/ with a .meta.md sidecar recording kind, endpoint and source.
import fs from 'fs';
import path from 'path';
import { readMd, writeMd, stamp, safe } from './store.mjs';
import { libraryDir, assetPath, saveAsset, deleteAsset, readMeta, writeMeta, metaPath } from './library.mjs';
import { uploadToFal, falKey } from './fal.mjs';

const controlDir = () => path.join(libraryDir(), 'control');
const FOLDER = 'control';

// The catalogue. Every one of these takes { image_url } and answers { image: { url, … } };
// birefnet additionally returns mask_image. Verified live — do not add ids on a hunch, and
// note that fal-ai/imageutils/canny is a 404 (the preprocessors namespace is the live one).
const KINDS = [
  {
    id: 'depth-fast', label: 'MiDaS depth', group: 'Depth',
    endpoint: 'fal-ai/imageutils/depth',
    blurb: 'Instant rough Z-pass — cheap enough to run on every frame while you are still finding the blocking.'
  },
  {
    id: 'depth-balanced', label: 'Depth Anything v2', group: 'Depth',
    endpoint: 'fal-ai/image-preprocessors/depth-anything/v2',
    blurb: 'The default. Clean separation of figure, set and background; what you want for most shot conditioning.'
  },
  {
    id: 'depth-quality', label: 'Marigold depth', group: 'Depth',
    endpoint: 'fal-ai/imageutils/marigold-depth',
    blurb: 'Slow but far finer gradients across faces, hands and fabric — save it for the hero frame of a sequence.'
  },
  {
    id: 'edges', label: 'Canny edges', group: 'Edges',
    endpoint: 'fal-ai/image-preprocessors/canny',
    blurb: 'Contour map. Holds silhouette, set lines and props exactly while the model repaints grade and texture.'
  },
  {
    id: 'pose', label: 'DWPose skeleton', group: 'Pose',
    endpoint: 'fal-ai/dwpose',
    blurb: 'Body/hand/face skeleton overlay — reuse a performance in a new wardrobe, location or lens.'
  },
  {
    id: 'cutout', label: 'BiRefNet v2 matte', group: 'Cutout',
    endpoint: 'fal-ai/birefnet/v2',
    blurb: 'High-detail matte that survives hair and rim light — cut the character onto a different plate.'
  },
  {
    id: 'cutout-fast', label: 'RemBG cutout', group: 'Cutout',
    endpoint: 'fal-ai/imageutils/rembg',
    blurb: 'Fast alpha cutout when all you need is the figure isolated from its background.'
  }
];
const kindById = id => KINDS.find(k => k.id === String(id || '')) || null;

const EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/avif': '.avif'
};
const FAL_TIMEOUT = 180_000;

// ── the derive itself ──
// One synchronous POST: these preprocessors answer in 3-20s, so there is no queue to poll
// (unlike trellis in threed.mjs, which needs minutes).
async function runPreprocessor(endpoint, imageUrl) {
  const r = await fetch('https://fal.run/' + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + falKey() },
    body: JSON.stringify({ image_url: imageUrl }),
    signal: AbortSignal.timeout(FAL_TIMEOUT)
  });
  if (!r.ok) throw new Error('FAL ' + endpoint + ' → ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const out = await r.json();
  const img = out.image || null;
  const url = typeof img === 'string' ? img : img?.url;
  if (!url) throw new Error('FAL returned no image for ' + endpoint);
  return {
    url,
    contentType: (img && img.content_type) || 'image/png',
    width: (img && img.width) || 0,
    height: (img && img.height) || 0,
    // birefnet hands back a separate matte; it is legitimately null on the other endpoints
    maskUrl: out.mask_image?.url || (typeof out.mask_image === 'string' ? out.mask_image : null)
  };
}

// list record shape — identical for GET /api/control and the POST /api/control/derive answer,
// so the client renders a fresh derive and a listed one with the same code path.
function record(name, meta) {
  return {
    name, folder: FOLDER,
    url: '/api/library/file?name=' + encodeURIComponent(name) + '&folder=' + FOLDER,
    kind: meta.kind || '', endpoint: meta.endpoint || '',
    source: meta.source || '', sourceScope: meta.sourceScope || '', sourceFolder: meta.sourceFolder || '',
    derived: meta.derived || '', falUrl: meta.falUrl || '',
    maskUrl: meta.maskUrl || '',
    width: meta.width || 0, height: meta.height || 0
  };
}

export function listControlMaps() {
  const dir = controlDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith('.') && !f.endsWith('.meta.md'))
    .map(f => {
      const abs = path.join(dir, f);
      let meta = {};
      try { meta = readMd(metaPath(abs)).data || {}; } catch { /* sidecar lost — still list the file */ }
      let mtime = 0;
      // a stray subdirectory under control/ is not a map — statSync also drops entries that
      // vanished between the readdir and here.
      try {
        const st = fs.statSync(abs);
        if (!st.isFile()) return null;
        mtime = st.mtimeMs;
      } catch { return null; }
      return { ...record(f, meta), mtime };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

export async function deriveControlMap({ scope, name, folder, kind }) {
  const k = kindById(kind);
  if (!k) throw new Error('unknown control kind: ' + kind);
  const src = assetPath(String(scope || ''), String(name || ''), String(folder || ''));
  if (!src) { const e = new Error('asset not found'); e.notFound = true; throw e; }

  // reuse the CDN copy the library already pushed (same contract as /api/assets/:scope/send-fal)
  // rather than re-uploading the same bytes on every derive.
  let imageUrl = readMeta(src)?.falUrl || '';
  if (!imageUrl) {
    imageUrl = await uploadToFal(fs.readFileSync(src), String(name));
    try { writeMeta(src, { falUrl: imageUrl, falAt: stamp() }); } catch { /* sidecar is best effort */ }
  }

  const out = await runPreprocessor(k.endpoint, imageUrl);
  const dl = await fetch(out.url, { signal: AbortSignal.timeout(FAL_TIMEOUT) });
  if (!dl.ok) throw new Error('could not download the derived map (' + dl.status + ')');
  const buf = Buffer.from(await dl.arrayBuffer());

  const stem = safe(String(name).replace(/\.[^.]+$/, '')).slice(0, 48);
  const ext = EXT[out.contentType] || path.extname(new URL(out.url).pathname) || '.png';
  const saved = saveAsset('library', stem + '--' + k.id + ext, buf, FOLDER);

  const abs = path.join(controlDir(), saved.name);
  const meta = {
    kind: k.id, endpoint: k.endpoint,
    source: String(name), sourceScope: String(scope), sourceFolder: String(folder || ''),
    derived: stamp(), falUrl: out.url, maskUrl: out.maskUrl || '',
    width: out.width, height: out.height
  };
  writeMd(metaPath(abs), meta,
    k.label + ' derived from ' + meta.source + ' — geometry conditioning map, safe to hand any model as a reference.\n');
  return record(saved.name, meta);
}

// ── route registration — call from backend/index.mjs ──
export function registerControlRoutes(app, deps = {}) {
  const { appendActivity } = deps;

  app.get('/api/control/kinds', (_req, res) => res.json(KINDS));

  // readdir/stat can throw if the storage root moved out from under us — answer with the
  // route's own { error } instead of letting it escape into Express as a 500 HTML page.
  app.get('/api/control', (_req, res) => {
    try { res.json(listControlMaps()); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/control/derive', async (req, res) => {
    const { scope, name, folder, kind } = req.body || {};
    if (!falKey()) return res.status(400).json({ error: 'No FAL key — add one in Settings' });
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!kindById(kind)) return res.status(400).json({ error: 'unknown control kind: ' + kind });
    try {
      const rec = await deriveControlMap({ scope, name, folder, kind });
      if (typeof appendActivity === 'function') {
        appendActivity({
          dot: 'green', t: 'Control map derived', t2: '· ' + rec.kind,
          s: rec.source + ' → library/control/' + rec.name, kind: 'tool'
        });
      }
      res.json(rec);
    } catch (e) {
      res.status(e.notFound ? 404 : 400).json({ error: e.message });
    }
  });

  app.delete('/api/control/:name', (req, res) => {
    try {
      deleteAsset('library', String(req.params.name), FOLDER);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
}
