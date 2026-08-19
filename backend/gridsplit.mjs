// Server-side grid split (filmmaker-chat ticket 06) — cutting a generated contact sheet (3×3, 2×2,
// turnaround, storyboard grid) into individual frames becomes a first-class backend operation any
// client, including the chat agent, can invoke through the HTTP API.
//
// The detection/scoring/geometry math lives once in shared/gridsplit.mjs (imported by BOTH this
// module and the browser tool page). This module owns only the environment-specific parts: decode
// the parent render with sharp, crop each cell, and write each kept cell as a NEW child generation
// record (parentGeneration set, tool:'gridsplit') with its own render file — optionally attaching a
// cell to a shot as a candidate. It never re-runs a provider: every child is born `done`.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getStorageRoot, writeMd, readMd, stamp, safe, safeScope, appendActivity } from './store.mjs';
import { getGeneration, renderPath, rendersDir } from './generate.mjs';
import { getShot, patchShot } from './story.mjs';
import { imageSize } from './imageSize.mjs';
import { detectGrid, cellRects, cellKey } from '../shared/gridsplit.mjs';

const R = () => getStorageRoot();
const gensDir = pid => path.join(R(), 'projects', safeScope(pid), 'generations');
const gensMd = (pid, id) => path.join(gensDir(pid), safe(id) + '.md');

let seq = 0;

// Decode + downscale the parent to a ~600px RGBA view and score every candidate grid. Mirrors the
// browser's canvas downscale (frontend/GridSplitter.jsx pickBestGrid) so both sides detect the same.
async function detectFromBuffer(buf) {
  const meta = await sharp(buf).metadata();
  const w = meta.width || 0, h = meta.height || 0;
  if (!w || !h) return null;
  const scale = Math.min(1, 600 / Math.max(w, h));
  const sw = Math.max(1, Math.floor(w * scale));
  const sh = Math.max(1, Math.floor(h * scale));
  const { data, info } = await sharp(buf)
    .resize(sw, sh, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return detectGrid({ data, width: info.width, height: info.height });
}

// Write a completed child generation record straight to disk. Shape mirrors generate.mjs schema-2
// records (the review candidate IS the generation), but this one is born `done` with no provider run.
function writeChildGen(pid, gen) {
  fs.mkdirSync(gensDir(pid), { recursive: true });
  writeMd(gensMd(pid, gen.id), gen, 'Generation record — grid-split cell, portable, readable by any tool.\n');
  return gen;
}

// Exclusive-create render filename so concurrent splits of the same sheet never clobber each other.
function writeCellRender(pid, base, ext, bin) {
  const dir = rendersDir(pid);
  fs.mkdirSync(dir, { recursive: true });
  for (let v = 1; ; v++) {
    const name = base + '_v' + v + '.' + ext;
    try { fs.writeFileSync(path.join(dir, name), bin, { flag: 'wx' }); return name; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Split a generation's grid render into one child generation per kept cell.
//   { pid, id, rows?, cols?, gutter?, skip?: ['r-c'], shots?: { 'r-c': shotId } }
// rows/cols omitted → auto-detect. Returns the detection, the grid used, and the child cells.
export async function splitGridGeneration({ pid, id, rows = null, cols = null, gutter = 0, skip = [], shots = {} }) {
  const parent = getGeneration(pid, id);
  if (!parent) throw new Error('generation ' + id + ' not found');
  if (parent.status !== 'done' || !parent.file) throw new Error('generation ' + id + ' has no finished render to split');
  const src = renderPath(pid, parent.file);
  if (!src) throw new Error('render file missing for generation ' + id);
  const buf = fs.readFileSync(src);

  // Guard the shot mapping up front — validate every referenced shot exists before any write, so a
  // typo can never leave a half-written split behind.
  const shotMap = shots && typeof shots === 'object' ? shots : {};
  for (const key of Object.keys(shotMap)) {
    if (shotMap[key] && !getShot(pid, shotMap[key])) throw new Error('shot ' + shotMap[key] + ' not found');
  }

  const detected = await detectFromBuffer(buf);
  const useRows = rows ? Math.max(1, Math.floor(rows)) : (detected ? detected.rows : 1);
  const useCols = cols ? Math.max(1, Math.floor(cols)) : (detected ? detected.cols : 1);

  const meta = await sharp(buf).metadata();
  const W = meta.width || 0, H = meta.height || 0;
  if (!W || !H) throw new Error('could not read image dimensions for generation ' + id);

  const skipSet = new Set(Array.isArray(skip) ? skip.map(String) : []);
  const rects = cellRects({ width: W, height: H, rows: useRows, cols: useCols, gutter: Number(gutter) || 0 });
  const parentBase = slugify(parent.file.replace(/\.[^.]+$/, '')) || 'grid';

  const cells = [];
  const stampNow = Date.now();
  for (const rect of rects) {
    const key = cellKey(rect.r, rect.c);
    if (skipSet.has(key)) continue;
    const cellBuf = await sharp(buf)
      .extract({ left: rect.sx, top: rect.sy, width: rect.sw, height: rect.sh })
      .jpeg({ quality: 92 })
      .toBuffer();
    const rc = 'r' + (rect.r + 1) + 'c' + (rect.c + 1);
    const file = writeCellRender(pid, parentBase + '_' + rc, 'jpg', cellBuf);
    const dim = imageSize(cellBuf);
    const shotId = shotMap[key] ? String(shotMap[key]) : null;
    const childId = 'gen-' + stampNow + '-' + (++seq);
    writeChildGen(pid, {
      id: childId, schema: 2, shot: shotId, tool: 'gridsplit', model: parent.model || 'gridsplit',
      prompt: parent.prompt || ('grid cell ' + rc), aspect: parent.aspect || '16:9',
      resolution: parent.resolution || null, seed: null,
      width: dim?.width ?? rect.sw, height: dim?.height ?? rect.sh,
      refUrls: [], refs: [], refInputs: [],
      status: 'done', reviewState: 'new', rating: 0, final: false,
      reviewedAt: null, decidedAt: null,
      note: 'grid-split cell ' + rc + ' of ' + useRows + '×' + useCols + ' from generation ' + id,
      parentGeneration: id, batchId: null, variantIndex: rect.r * useCols + rect.c,
      idempotencyKey: childId,
      routedTo: { kind: 'none', project: null, shot: null, folder: null, name: null },
      promotedAssets: [],
      gridCell: { r: rect.r, c: rect.c, rows: useRows, cols: useCols },
      file, cost: 0, requestId: null,
      createdAt: stamp(), started: stampNow, startedAt: stamp(), ended: Date.now(), endedAt: stamp(), error: null
    });
    if (shotId) patchShot(pid, shotId, {}, 'grid-split cell ' + rc + ' of ' + id + ' attached as candidate ' + childId);
    cells.push({ r: rect.r, c: rect.c, id: childId, file, width: dim?.width ?? rect.sw, height: dim?.height ?? rect.sh, shot: shotId });
  }

  appendActivity({ dot: 'amber', t: 'Grid split', t2: '· ' + id, s: pid + ' · ' + useRows + '×' + useCols + ' → ' + cells.length + ' frames', kind: 'proj', ref: pid });
  return { parent: id, rows: useRows, cols: useCols, gutter: Number(gutter) || 0, detected: detected || null, count: cells.length, cells };
}

export { detectFromBuffer };
