// backend/files.mjs — the way down (docs/01_CANON.md Law 8).
//
// A READ-ONLY browser over the storage root. It lists directories, reads one file, and asks the
// OS to reveal a path in Finder. It writes nothing, ever: only `backend/records.mjs` writes files
// under `data/`, and this module is the surface that proves what it wrote.
//
// Why it exists: we compress hard (Law 2 — every screen opens at one decision), and compression
// without a way down is concealment. Every record carries its `.md` path, every path lands here,
// and from here the real folder opens in Finder.
//
// ── Path safety ──────────────────────────────────────────────────────────────────────────────
// Three refusals and one guarantee. The refusals are explicit so a traversal attempt shows up as
// a 400 the caller can read, instead of quietly browsing somewhere else:
//   1. an absolute path (or a Windows drive letter) is refused — this API takes workspace-relative
//      paths only;
//   2. a `..` segment is refused by name, before any normalisation;
//   3. a NUL or control byte is refused (`docs/FRAMEFORGE_CLAUDE.md`: a control byte in a path is
//      never a real filename and it makes the value invisible to the tools you would debug with).
// The guarantee is the last line of `resolveRel`: the *realpath* of the result must still be the
// storage root or live inside it. realpath rather than resolve, so a symlink planted inside the
// workspace cannot point out of it.
//
// `store.safe()` is deliberately NOT used to rewrite segments here. It replaces anything outside
// `[\w.\-]` with `_`, which is right for names Scout *generates* and wrong for names it *browses*:
// a folder the person made in Finder called "Guest notes" would be rewritten to "Guest_notes" and
// 404 — a browser that cannot open the file it just listed is broken, and Law 8 covers files the
// human dropped in, not only files we wrote. `safe()` also does not stop `..` (it leaves it
// untouched), so it was never the guard here; containment is. See `docs/decisions.md`.

import fs from 'fs';
import path from 'path';
import { getStorageRoot } from './store.mjs';

export class FileError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'FileError'; this.status = status; }
}

// Text we will render in the preview pane. Anything else is reported as binary with its size, so
// the browser still SHOWS it (Law 8) without trying to paint 40MB of JPEG as characters.
const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.csv', '.tsv', '.log',
  '.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.svg', '.sh', '.env'
]);

// Types we will hand to the browser AS THEMSELVES. Everything not on this list is served as an
// attachment with `application/octet-stream`, which is the whole security argument for this route:
// the app's UI and its API share an origin, so an `.html` an agent dropped into `_inbox/` and a
// human moved into the vault would otherwise execute as first-party code with the API in reach.
// An allowlist of inert media plus `nosniff` plus a `default-src 'none'` CSP makes that impossible
// without hiding anything — the file still downloads, and Finder is still one click away.
export const MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
};
// SVG is deliberately NOT in that table. It is an image everywhere else in this app and a script
// host here: an inline <script> in an .svg served as image/svg+xml runs when the file is opened
// directly. It downloads like any other unlisted type.
export function mediaTypeFor(ext) { return MEDIA_TYPES[String(ext || '').toLowerCase()] || null; }

// A preview is a preview. Past this we report the size and stop reading — the file is still one
// click from Finder, which is the right tool for a 200MB log.
export const MAX_PREVIEW_BYTES = 512 * 1024;

// Noise that is not part of the person's workspace and only makes the tree harder to read:
// macOS AppleDouble sidecars (this volume is exFAT, so there is one beside almost every file),
// Finder metadata, and the in-flight halves of `store.writeMd`'s tmp+rename.
function isNoise(name) {
  return name.startsWith('._') || name === '.DS_Store' || /\.\d+\.tmp$/.test(name);
}

// ── the resolver ─────────────────────────────────────────────────────────────────────────────
// → { rel, abs, root }. Throws FileError(400) rather than clamping: a refusal the caller can see
// is worth more than a silent redirect to the root.
export function resolveRel(rel) {
  const root = path.resolve(getStorageRoot());
  const raw = String(rel == null ? '' : rel);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(raw)) throw new FileError('path contains a control byte', 400);
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new FileError('path must be relative to the workspace', 400);
  }
  const segs = raw.split(/[\\/]+/).filter(s => s !== '' && s !== '.');
  if (segs.some(s => s === '..')) throw new FileError('path escapes the workspace', 400);

  const abs = path.resolve(root, ...segs);
  if (!contains(root, abs)) throw new FileError('path escapes the workspace', 400);

  // Symlink check, best-effort: a link planted inside the workspace must not be a way out. A path
  // that does not exist yet cannot be a symlink, so a failed realpath is not a refusal.
  let real = abs;
  try { real = fs.realpathSync(abs); } catch { /* not on disk — the existence check comes later */ }
  if (real !== abs) {
    let realRoot = root;
    try { realRoot = fs.realpathSync(root); } catch { /* root may not exist on a fresh install */ }
    if (!contains(realRoot, real)) throw new FileError('path escapes the workspace', 400);
  }
  return { rel: segs.join('/'), abs, root };
}

function contains(root, p) {
  return p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

function entryOf(dirRel, dirent, abs) {
  const rel = dirRel ? dirRel + '/' + dirent.name : dirent.name;
  const full = path.join(abs, dirent.name);
  let size = 0, modified = null;
  try { const st = fs.statSync(full); size = st.size; modified = st.mtime.toISOString(); } catch { /* raced */ }
  return { name: dirent.name, path: rel, size, modified };
}

// ── listDir ──────────────────────────────────────────────────────────────────────────────────
// One level. The tree is built by the UI expanding a node and asking again — a recursive walk of
// a workspace with 10k records is a stall, and altitude 1 means you see the folders first.
export function listDir(rel = '') {
  const { rel: dirRel, abs, root } = resolveRel(rel);
  let st;
  try { st = fs.statSync(abs); } catch { throw new FileError('no such folder', 404); }
  if (!st.isDirectory()) throw new FileError('not a folder', 400);

  let ents = [];
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { throw new FileError('folder is unreadable', 403); }

  const dirs = [], files = [];
  for (const e of ents) {
    if (isNoise(e.name)) continue;
    // A symlinked entry is listed, but resolveRel refuses to follow it out of the workspace when
    // it is opened — so the tree stays honest about what is on disk without becoming a way out.
    if (e.isDirectory()) dirs.push(entryOf(dirRel, e, abs));
    else if (e.isFile() || e.isSymbolicLink()) files.push({ ...entryOf(dirRel, e, abs), ext: path.extname(e.name).toLowerCase() });
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  dirs.sort(byName); files.sort(byName);

  return {
    path: dirRel,                                     // workspace-relative, '' at the root
    parent: dirRel ? dirRel.split('/').slice(0, -1).join('/') : null,
    absolute: abs,                                    // shown once, so the person knows WHERE this is
    root,
    dirs,
    files
  };
}

// ── readFile ─────────────────────────────────────────────────────────────────────────────────
// The evidence altitude: the raw bytes of the record, as they sit on disk. Frontmatter is NOT
// stripped and the markdown is NOT parsed — this is the file, not a rendering of the file.
export function readFile(rel) {
  const { rel: fileRel, abs } = resolveRel(rel);
  if (!fileRel) throw new FileError('a file path is required', 400);
  let st;
  try { st = fs.statSync(abs); } catch { throw new FileError('no such file', 404); }
  if (st.isDirectory()) throw new FileError('that is a folder', 400);

  const ext = path.extname(fileRel).toLowerCase();
  const meta = {
    path: fileRel,
    name: path.basename(fileRel),
    ext,
    size: st.size,
    modified: st.mtime.toISOString(),
    absolute: abs
  };
  if (!TEXT_EXT.has(ext)) return { ...meta, binary: true, truncated: false, text: null };
  if (st.size > MAX_PREVIEW_BYTES) {
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(MAX_PREVIEW_BYTES);
    let read = 0;
    try { read = fs.readSync(fd, buf, 0, MAX_PREVIEW_BYTES, 0); } finally { fs.closeSync(fd); }
    return { ...meta, binary: false, truncated: true, text: buf.slice(0, read).toString('utf8') };
  }
  const buf = fs.readFileSync(abs);
  // A NUL in a "text" extension means it is not text, whatever the extension claims. Saying so is
  // better than painting control bytes into the preview — that exact byte is what made
  // `documents.mjs` invisible to grep (see HANDOVER §3).
  if (buf.includes(0)) return { ...meta, binary: true, truncated: false, text: null };
  return { ...meta, binary: false, truncated: false, text: buf.toString('utf8') };
}

// ── revealPath ───────────────────────────────────────────────────────────────────────────────
// This module does NOT spawn. `backend/index.mjs` already owns the one cross-platform, never-
// throwing, no-op-under-test revealer (`revealInOS`), and a second spawner is a second place for
// the "execFile with no error callback crashes the server" bug to live. It is injected:
//
//     registerFileRoutes(app, { revealInOS });
//
// A folder is opened; a file is revealed inside its folder (`open -R`) so the person lands with
// the record already selected.
export function revealPath(rel, { revealInOS } = {}) {
  const { rel: target, abs } = resolveRel(rel);
  if (!fs.existsSync(abs)) throw new FileError('no such path', 404);
  if (typeof revealInOS !== 'function') {
    // Loud on purpose. The failure mode this replaces is a Reveal button that silently does
    // nothing, which reads as "the app is broken" and takes an afternoon to trace.
    throw new FileError('no OS revealer was supplied — backend/index.mjs must mount this as registerFileRoutes(app, { revealInOS })', 501);
  }
  let select = false;
  try { select = fs.statSync(abs).isFile(); } catch { /* raced; open the path itself */ }
  revealInOS(abs, select);
  return { ok: true, path: target, absolute: abs, selected: select };
}

// ── rawFile ──────────────────────────────────────────────────────────────────────────────────
// The bytes, for a browser. `readFile` answers TEXT for the preview pane; this answers the file
// itself, which is what an <img> in a gallery tile and a picture in the file browser both need.
//
// It was the last of HANDOVER §5's gaps: `GalleryView.mediaSrc()` could only resolve a value that
// was ALREADY a URL, so a person who put a photo in their workspace and pointed a field at it got
// NO PREVIEW forever — the app could see the file, list it, and refuse to show it.
//
// Read-only, same resolver, same three refusals. Returns metadata; the route does the streaming,
// because streaming needs `res` and this module keeps its logic testable without one.
export function rawFile(rel) {
  const { rel: fileRel, abs } = resolveRel(rel);
  if (!fileRel) throw new FileError('a file path is required', 400);
  let st;
  try { st = fs.statSync(abs); } catch { throw new FileError('no such file', 404); }
  if (st.isDirectory()) throw new FileError('that is a folder', 400);

  const ext = path.extname(fileRel).toLowerCase();
  const type = mediaTypeFor(ext);
  return {
    path: fileRel, name: path.basename(fileRel), ext, abs,
    size: st.size, modified: st.mtime.toISOString(),
    // No type we recognise → it is a download, never something the browser renders in place.
    type: type || 'application/octet-stream',
    inline: !!type,
  };
}

// One byte range, the shape a <video> asks for when you drag its scrubber. Safari will not play a
// video at all unless the server answers 206 to its first range request, so this is the difference
// between "the gallery shows videos" and "the gallery shows a black rectangle on one browser".
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || size <= 0) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start, end;
  if (a === '') { end = size - 1; start = Math.max(0, size - Number(b)); }
  else { start = Number(a); end = b === '' ? size - 1 : Math.min(Number(b), size - 1); }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────
// GET  /api/files?dir=          → listDir
// GET  /api/files/read?path=    → readFile   (text, for the preview pane)
// GET  /api/files/raw?path=     → rawFile    (the bytes, for an <img>/<video>)
// POST /api/files/reveal {path} → revealPath
//
// Mounted by the integrator from `backend/index.mjs`. Nothing here is exposed by any other route,
// and none of the four mutates anything.
export function registerFileRoutes(app, deps = {}) {
  const send = (res, e) => res.status(e instanceof FileError ? e.status : 500).json({ error: e.message });

  app.get('/api/files/read', (req, res) => {
    try { res.json(readFile(req.query.path)); } catch (e) { send(res, e); }
  });

  app.get('/api/files', (req, res) => {
    try { res.json(listDir(req.query.dir)); } catch (e) { send(res, e); }
  });

  app.post('/api/files/reveal', (req, res) => {
    try { res.json(revealPath(req.body?.path, deps)); } catch (e) { send(res, e); }
  });

  // The bytes. Every header here is load-bearing: `nosniff` stops the browser second-guessing the
  // allowlisted type, the CSP makes the response inert even if it somehow renders, and anything
  // off the allowlist is an attachment rather than a page on the app's own origin.
  app.get('/api/files/raw', (req, res) => {
    let f;
    try { f = rawFile(req.query.path); } catch (e) { return send(res, e); }

    res.set({
      'Content-Type': f.type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': (f.inline ? 'inline' : 'attachment') + '; filename="' + f.name.replace(/["\\]/g, '_') + '"',
      // An attachment's NAME is its content (`files/<sha256>.<ext>`, backend/attachments.mjs), so
      // those bytes can never change under that path and the browser may keep them for good.
      // Without this a list of a thousand thumbnails re-downloaded every picture on every visit.
      // Anything else in the workspace can be edited in place, so it is revalidated as before.
      'Cache-Control': /^files\/[0-9a-f]{64}\.[a-z0-9]+$/.test(f.path) ? 'private, max-age=31536000, immutable' : 'no-cache',
      'Accept-Ranges': 'bytes',
      'Last-Modified': new Date(f.modified).toUTCString(),
    });

    const range = parseRange(req.headers.range, f.size);
    if (range) {
      res.status(206).set({
        'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + f.size,
        'Content-Length': String(range.end - range.start + 1),
      });
    } else {
      res.set('Content-Length', String(f.size));
    }

    const stream = fs.createReadStream(f.abs, range ? { start: range.start, end: range.end } : undefined);
    // A read that dies mid-stream cannot send a JSON error — the headers are already out. Destroy
    // the response so the client sees a truncated body instead of hanging on a promise nobody kept.
    stream.on('error', () => res.destroy());
    req.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}

export default { listDir, readFile, rawFile, parseRange, revealPath, resolveRel, registerFileRoutes, FileError, MAX_PREVIEW_BYTES, MEDIA_TYPES };
