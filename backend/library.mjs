// Asset library + image intelligence sidecars.
//   <root>/library/<collection>/<file>       — global, cross-project asset library
//   any asset <path>.meta.md                 — vision metadata sidecar
//                                              frontmatter { description, tags, palette, mood, analyzed }
// Works for both the global library and per-project context boards.
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { getStorageRoot, readMd, writeMd, stamp, contextDir } from './store.mjs';
import { stageTrash } from './trash.mjs';
import { CONTROL_FILES } from './memory.mjs';

const R = () => getStorageRoot();
export const libraryDir = () => path.join(R(), 'library');

const TYPES = { md: 'note', txt: 'text', pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image', mp4: 'video', mov: 'video', webm: 'video', m4v: 'video', url: 'link' };
const cleanName = n => { const b = path.basename(String(n)).replace(/[/\\]+/g, '_'); return b === '..' || b === '.' ? '_' : b; };
const cleanFolder = f => String(f || '').split('/')[0].replace(/[^\w\- ]+/g, '').trim();

// ── meta sidecars (generic over any asset path) ──
export function metaPath(assetAbs) { return assetAbs + '.meta.md'; }
export function readMeta(assetAbs) {
  try {
    const { data } = readMd(metaPath(assetAbs));
    return {
      description: data.description || '', tags: data.tags || [],
      palette: data.palette || [], mood: data.mood || '', analyzed: data.analyzed || '',
      kind: data.kind || '', falUrl: data.falUrl || '', falAt: data.falAt || '',
      fav: !!data.fav,
      // display name for an entity in the story list's production strip — DISPLAY ONLY,
      // assignments always key off the filename (see Story.jsx entityPool)
      label: data.label || '',
      // deep-analysis payload: a full regeneration prompt, plus which tier/model wrote it
      reconstruct: data.reconstruct || '', visionModel: data.visionModel || ''
    };
  } catch { return null; }
}
// merge-write: analyze / tag-edit / kind change / fal push each own a slice — never clobber the rest
//
// The merge base is the RAW frontmatter, not readMeta(). readMeta normalises to a fixed shape for
// consumers, and anything outside that shape — a field written by an older build, one a newer
// build added, or a note the user typed into the sidecar by hand (the body invites editing) —
// simply is not in what it returns. Merging onto that shape meant every write silently deleted
// those keys: a single tag edit could drop a field the analyzer had spent a paid vision call
// producing. "Never clobber the rest" is what this function is for, and it clobbered the rest.
//
// readMeta stays exactly as it is: its defaulting is what callers rely on. Only the merge base
// changes, so an unknown key survives a write without any consumer having to know about it.
export function writeMeta(assetAbs, patch) {
  let raw = {};
  try { raw = readMd(metaPath(assetAbs)).data || {}; } catch { /* no sidecar yet */ }
  const prev = { ...raw, ...(readMeta(assetAbs) || {}) };
  const meta = { ...prev, ...patch };
  if (patch.description !== undefined || patch.palette !== undefined) meta.analyzed = stamp();
  writeMd(metaPath(assetAbs), meta,
    (meta.description || '') + '\n\nMetadata sidecar for ' + path.basename(assetAbs) + ' — vision fields written by the analyzer, edit freely.\n');
  return meta;
}

// ── asset scopes: 'library' (global) or a project id (context boards) ──
export function scopeDir(scope) {
  return scope === 'library' ? libraryDir() : contextDir(scope);
}
// control manifests live at the root of a scope dir — a name inside a board folder is user content
const isControlFile = (folder, name) => !folder && CONTROL_FILES.has(name);
export function assetPath(scope, name, folder = '') {
  const f = cleanFolder(folder), n = cleanName(name);
  if (isControlFile(f, n)) return null; // rename/move/copy resolve through here → all refuse
  const p = path.join(scopeDir(scope), f, n);
  return fs.existsSync(p) ? p : null;
}

function item(base, folder, name) {
  const p = path.join(base, folder, name);
  const st = fs.statSync(p);
  const ext = name.split('.').pop().toLowerCase();
  const type = TYPES[ext] || 'file';
  let excerpt = '';
  if (type === 'note' || type === 'text' || type === 'link') {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const body = name.endsWith('.md') ? matter(raw).content : raw;
      excerpt = body.trim().split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 2).join(' ').slice(0, 200);
    } catch { /* binary */ }
  }
  const meta = readMeta(p);
  return { name, folder, type, size: st.size, mtime: st.mtimeMs, excerpt, meta };
}

export function listAssets(scope) {
  const base = scopeDir(scope);
  const folders = [];
  const items = [];
  if (!fs.existsSync(base)) return { folders, items };
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      folders.push(e.name);
      for (const f of fs.readdirSync(path.join(base, e.name), { withFileTypes: true })) {
        if (f.isFile() && !f.name.startsWith('.') && !f.name.endsWith('.meta.md')) items.push(item(base, e.name, f.name));
      }
    } else if (e.isFile() && !e.name.endsWith('.meta.md') && !isControlFile('', e.name)) items.push(item(base, '', e.name));
  }
  items.sort((a, b) => b.mtime - a.mtime);
  folders.sort((a, b) => a.localeCompare(b));
  return { folders, items };
}

// pick a non-colliding filename: "IMG.jpg" → "IMG-2.jpg" → "IMG-3.jpg". Uploading a second,
// different file of the same name must never overwrite the first (and orphan its .meta.md).
function uniqueName(dir, clean) {
  if (!fs.existsSync(path.join(dir, clean))) return clean;
  const ext = path.extname(clean);
  const stem = clean.slice(0, clean.length - ext.length);
  for (let n = 2; n < 10000; n++) {
    const cand = stem + '-' + n + ext;
    if (!fs.existsSync(path.join(dir, cand))) return cand;
  }
  return Date.now() + '-' + clean;
}
export function saveAsset(scope, name, buf, folder = '') {
  const f = cleanFolder(folder);
  const dir = path.join(scopeDir(scope), f);
  fs.mkdirSync(dir, { recursive: true });
  const clean = uniqueName(dir, cleanName(name));
  fs.writeFileSync(path.join(dir, clean), buf);
  return { name: clean, folder: f };
}
// Staged, undoable (Phase 3D): the asset and its .meta.md sidecar move to trash together as one
// restorable unit — never an irreversible rm.
export function deleteAsset(scope, name, folder = '') {
  const f = cleanFolder(folder), n = cleanName(name);
  if (isControlFile(f, n)) throw new Error('asset not found'); // does not build its own path via assetPath
  const p = path.join(scopeDir(scope), f, n);
  return stageTrash([p, metaPath(p)], { label: (folder ? folder + '/' : '') + name, itemKind: 'asset', scope });
}
export function createCollection(scope, name) {
  const f = cleanFolder(name);
  if (!f) throw new Error('invalid name');
  fs.mkdirSync(path.join(scopeDir(scope), f), { recursive: true });
  return f;
}
// The whole board/collection folder (files + sidecars) stages as one entry — restore rebuilds the tree.
export function deleteCollection(scope, name) {
  const f = cleanFolder(name);
  if (!f) throw new Error('invalid name');
  return stageTrash(path.join(scopeDir(scope), f), { label: f, itemKind: 'folder', scope });
}
// rename a file in place — the .meta.md sidecar rides along
export function renameAsset(scope, name, folder, newName) {
  const src = assetPath(scope, name, folder);
  if (!src) throw new Error('asset not found');
  const ext = path.extname(name);
  let clean = cleanName(newName);
  if (!path.extname(clean)) clean += ext; // keep the extension if the user typed a bare name
  if (!clean.replace(ext, '').trim()) throw new Error('invalid name');
  const dst = path.join(path.dirname(src), clean);
  if (fs.existsSync(dst) && dst !== src) throw new Error('a file with that name already exists');
  fs.renameSync(src, dst);
  if (fs.existsSync(metaPath(src))) fs.renameSync(metaPath(src), metaPath(dst));
  return { name: clean, folder: cleanFolder(folder) };
}
// move an asset between folders in the same scope — sidecar rides along
export function moveAsset(scope, name, folder, toFolder) {
  const src = assetPath(scope, name, folder);
  if (!src) throw new Error('asset not found');
  const tf = cleanFolder(toFolder);
  const dir = path.join(scopeDir(scope), tf);
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, cleanName(name));
  if (fs.existsSync(dst) && dst !== src) throw new Error('a file with that name already exists there');
  if (dst === src) return { name: cleanName(name), folder: tf };
  fs.renameSync(src, dst);
  if (fs.existsSync(metaPath(src))) fs.renameSync(metaPath(src), metaPath(dst));
  return { name: cleanName(name), folder: tf };
}
// rename a board / collection folder — all files and sidecars ride along
export function renameCollection(scope, name, newName) {
  const f = cleanFolder(name), nf = cleanFolder(newName);
  if (!f || !nf) throw new Error('invalid name');
  const src = path.join(scopeDir(scope), f);
  if (!fs.existsSync(src)) throw new Error('folder not found');
  const dst = path.join(scopeDir(scope), nf);
  if (fs.existsSync(dst)) throw new Error('a folder with that name already exists');
  fs.renameSync(src, dst);
  return nf;
}
// copy an asset between scopes (library → project, project → library), meta rides along
export function copyAsset(fromScope, name, folder, toScope, toFolder = '') {
  const src = assetPath(fromScope, name, folder);
  if (!src) throw new Error('source not found');
  const saved = saveAsset(toScope, name, fs.readFileSync(src), toFolder);
  const meta = readMeta(src);
  if (meta) {
    const dst = assetPath(toScope, saved.name, saved.folder);
    if (dst) writeMeta(dst, meta);
  }
  return saved;
}
