// Staged trash (Phase 3D). Physical file/folder deletions (assets, sidecars, boards, generation
// media, presets…) are never rm'd outright — they are MOVED into <root>/.trash/<trash-id>/<original
// relative path>, recorded in a manifest, and restorable. Permanent removal ("purge") happens only
// from the Trash page. This is NOT a Git-based undo system; it is a plain move + markdown manifest.
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd, writeMd, stamp } from './store.mjs';

const trashRoot = () => path.join(getStorageRoot(), '.trash');
const manifestMd = () => path.join(trashRoot(), 'manifest.md');
let seq = 0;

// ── relativePath is stored POSIX-canonical, on every host ────────────────────────────────────
// The manifest is part of the portable markdown datastore (and it is served verbatim over
// GET /api/staged-trash), so a path inside it must not carry the shape of the machine that wrote
// it. `path.relative` answers with backslashes on Windows; storing that made a workspace authored
// on Windows unrestorable on macOS (the manifest says `board\a.png` while the file on disk sits at
// `board/a.png`) and leaked the host separator into the HTTP response. Store forward slashes,
// convert back at each fs boundary.
const toPosix = rel => rel.split(path.sep).join('/'); // identity on POSIX — path.sep is already '/'
const toNative = rel => (path.sep === '/' ? rel : rel.split('/').join(path.sep));

// Read side: bring whatever the manifest holds to that one canonical form. An entry written by an
// earlier build carries the separator of the host that wrote it, and both spellings must keep
// restoring.
function canonicalRel(stored, trashDir) {
  const rel = String(stored || '');
  if (!rel.includes('\\')) return rel;
  // Windows: `\` cannot occur inside a filename, so it is unambiguously a separator.
  if (path.sep !== '/') return rel.split('\\').join('/');
  // POSIX: `\` IS a legal filename character, so it is only re-read as a separator when the literal
  // name is ABSENT from the trash directory and the converted one is PRESENT — the disk decides,
  // never a guess. A genuine `a\b.png` therefore keeps restoring exactly as it does today, while a
  // workspace carried over from Windows (manifest says `board\a.png`, file sits at `board/a.png`)
  // stops silently restoring nothing.
  if (fs.existsSync(path.join(trashDir, rel))) return rel;
  const alt = rel.split('\\').join('/');
  return fs.existsSync(path.join(trashDir, alt)) ? alt : rel;
}

function readManifest() { try { return readMd(manifestMd()).data.entries || []; } catch { return []; } }
function writeManifest(entries) {
  writeMd(manifestMd(), { entries }, 'Staged trash — recoverable deletions. Restore or purge from the Trash page.\n');
}

// Move one or more paths into staged trash under a SINGLE trash id (so an asset + its .meta.md
// sidecar, or a folder and its whole subtree, restore together as one unit). Preserves each path's
// location relative to the storage root. Returns the manifest entry, or null if nothing existed.
export function stageTrash(paths, meta = {}) {
  const root = getStorageRoot();
  const list = (Array.isArray(paths) ? paths : [paths]).filter(p => p && fs.existsSync(p));
  if (!list.length) return null;
  const ts = Date.now();
  const id = 'trash-' + ts + '-' + (++seq);
  const moved = [];
  try {
    for (const abs of list) {
      const rel = path.relative(root, abs);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue; // never touch outside the root
      const dest = path.join(trashRoot(), id, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(abs, dest);
      moved.push({ relativePath: toPosix(rel), kind: fs.statSync(dest).isDirectory() ? 'dir' : 'file' });
    }
  } catch (e) {
    // A mid-loop failure (EPERM, EXDEV, a vanished file) used to escape before writeManifest ran,
    // leaving whatever HAD already moved sitting in .trash with no manifest entry — invisible to the
    // Trash page and therefore unrestorable: silent data loss. Record the partial move first, then
    // rethrow so the caller still reports the failure.
    if (moved.length) writeManifest([{ id, ts, at: stamp(), label: meta.label || moved[0].relativePath, paths: moved, partial: true, ...meta }, ...readManifest()]);
    throw e;
  }
  if (!moved.length) return null;
  // `kind` is reserved for the dir|file discriminator on paths[] entries (set just above). A domain
  // type on the ENTRY belongs under `itemKind`. Migrate a stray entry-level `kind` instead of
  // silently accepting a second meaning for the same word — paths[] is built here, never from meta,
  // so this can never collide with the dir|file kind.
  const { kind: strayKind, ...rest } = meta;
  const entry = { id, ts, at: stamp(), label: meta.label || moved[0].relativePath, paths: moved, ...rest };
  if (strayKind && !entry.itemKind) entry.itemKind = strayKind;
  writeManifest([entry, ...readManifest()]);
  return entry;
}

export function listTrash() { return readManifest(); }

// Restore every path in a trash entry back to its original location. Refuses to overwrite a path
// that has since been re-created (so a restore never silently clobbers newer user data).
export function restoreTrash(id) {
  const entries = readManifest();
  const e = entries.find(x => x.id === id);
  if (!e) return null;
  const root = getStorageRoot();
  // PRE-FLIGHT, then move. Validating inside the move loop meant a conflict on the 2nd path threw
  // *after* the 1st had already been renamed back out of .trash — the caller saw a failure and
  // assumed nothing happened, while the entry was left half-restored and permanently stuck (every
  // retry re-hit the same conflict). Resolve and check everything first; either all of it moves or
  // none of it does.
  const plan = [];
  const trashDir = path.join(trashRoot(), e.id);
  for (const p of e.paths || []) {
    const rel = canonicalRel(p.relativePath, trashDir); // POSIX-canonical, whatever the manifest holds
    const src = path.join(trashDir, toNative(rel));
    const dest = path.resolve(root, toNative(rel));
    // symmetric to stageTrash's guard on the way IN: the manifest is a user-editable .md, so a
    // hand-edited relativePath must not be able to write outside the storage root on the way OUT.
    // It guards `dest`, i.e. the fully resolved path — separator normalisation happens strictly
    // before this line, so no spelling of the stored value can slip past it on either platform.
    if (dest !== root && !dest.startsWith(root + path.sep)) throw new Error('refusing to restore outside the storage root: ' + rel);
    if (!fs.existsSync(src)) continue;
    if (fs.existsSync(dest)) throw new Error('cannot restore — something already exists at ' + rel);
    plan.push({ src, dest, rel });
  }
  const restored = [];
  for (const { src, dest, rel } of plan) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    restored.push(rel);
  }
  try { fs.rmSync(path.join(trashRoot(), e.id), { recursive: true, force: true }); } catch { /* best effort */ }
  writeManifest(entries.filter(x => x.id !== id));
  return { restored };
}

// Permanent removal — only ever called from the Trash page's explicit purge.
export function purgeTrash(id) {
  const entries = readManifest();
  if (!entries.some(x => x.id === id)) return false;
  fs.rmSync(path.join(trashRoot(), id), { recursive: true, force: true });
  writeManifest(entries.filter(x => x.id !== id));
  return true;
}
export function purgeAllTrash() {
  const entries = readManifest();
  for (const e of entries) { try { fs.rmSync(path.join(trashRoot(), e.id), { recursive: true, force: true }); } catch { /* keep going */ } }
  writeManifest([]);
  return entries.length;
}
