// Selects manifest — the smallest useful edit bridge (the "bigger bet"). Not a timeline UI: a
// portable list of the chosen/final candidates in shot order, with in/out trim points, that Remotion
// and export packs read. projects/<pid>/edit-manifest.md
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd, writeMd, stamp, safeScope } from './store.mjs';
import { listShots } from './story.mjs';
import { listGenerations, rendersDir } from './generate.mjs';
import { shotSeconds } from './reel.mjs';   // the one authored-duration rule — do not re-inline it

const manifestMd = pid => path.join(getStorageRoot(), 'projects', safeScope(pid), 'edit-manifest.md');

// Read any saved in/out overrides so a rebuild preserves the user's trim points.
function savedEntries(pid) {
  try { return readMd(manifestMd(pid)).data.entries || []; } catch { return []; }
}

// Build the manifest from shots that have a selectedCandidate (final selections), in shot order,
// merged with saved in/out trim points. Each entry is self-describing for a downstream editor.
export function buildManifest(pid) {
  const saved = savedEntries(pid);
  const savedByShot = new Map(saved.map(e => [e.shot, e]));
  const gens = listGenerations(pid);
  const shots = listShots(pid).filter(s => s.selectedCandidate).sort((a, b) => (a.no ?? 99) - (b.no ?? 99));
  const entries = shots.map((s, i) => {
    const g = gens.find(x => x.id === s.selectedCandidate) || {};
    const prev = savedByShot.get(s.id) || {};
    const duration = shotSeconds(s);
    return {
      order: i + 1, shot: s.id, generation: s.selectedCandidate, file: g.file || null,
      duration, in: prev.in ?? 0, out: prev.out ?? duration,
      prompt: g.prompt || s.prompt || '', model: g.model || '',
      sourceProject: pid, sourceBatch: g.batchId || null
    };
  });
  return { project: pid, updated: stamp(), entries };
}

export function getManifest(pid) { return buildManifest(pid); }

export function writeManifest(pid) {
  const m = buildManifest(pid);
  writeMd(manifestMd(pid), m, '# Edit manifest — final selects in shot order. Remotion + export read this.\n');
  return m;
}

// Set the in/out trim points for one shot's entry, then persist the whole manifest.
//
// An OMITTED side means "leave it alone", on both sides. It used to mean that for `out` only —
// `in` was coerced to 0 — and the UI never sends both: App.jsx's inbox handler builds
// `which === 'in' ? { in: t, out: undefined } : { in: undefined, out: t }`, JSON.stringify drops
// the undefined key, and the route then read a missing `in` as a real 0. So the natural order —
// mark the in point, then mark the out point — silently discarded the in point, while the toast
// said "Out point set". The trim was gone from edit-manifest.md, and every consumer downstream
// (the export pack's edit-manifest.json, selects.json, Remotion, an NLE) cut from the head of the
// clip instead.
//
// The single test that covered this sent `{in, out}` together — the one shape the app never
// produces — which is why it stayed green. `undefined` and `null` both mean absent here; `0` is a
// legitimate value and must be storable, so the check is `== null`, never falsy.
export function setInOut(pid, shot, inPoint, outPoint) {
  const m = buildManifest(pid);
  // The manifest only carries shots with a selected take, so trimming one that has none matched
  // nothing, wrote the file back unchanged, and answered 200 — the UI toasted "In point set" and
  // the trim simply did not exist. Say so instead; the caller surfaces it.
  if (!m.entries.some(e => e.shot === shot)) {
    const err = new Error(shot + ' has no selected take yet — pick a final take before trimming it.');
    err.code = 'no-entry';
    throw err;
  }
  const merged = m.entries.map(e => e.shot === shot
    ? { ...e, in: inPoint == null ? e.in : Number(inPoint), out: outPoint == null ? e.out : Number(outPoint) }
    : e);
  writeMd(manifestMd(pid), { project: pid, updated: stamp(), entries: merged }, '# Edit manifest — final selects in shot order.\n');
  return { project: pid, entries: merged };
}

// Export the selects: prefer symlinks (no disk cost), fall back to copies with a reported disk size.
// Writes projects/<pid>/selects/ + a selects.json manifest.
export function exportSelects(pid) {
  const m = writeManifest(pid);
  const outDir = path.join(getStorageRoot(), 'projects', safeScope(pid), 'selects');
  fs.mkdirSync(outDir, { recursive: true });
  const rdir = rendersDir(pid);
  let symlinked = 0, copied = 0, bytes = 0;
  const files = [];
  for (const e of m.entries) {
    if (!e.file) continue;
    const src = path.join(rdir, e.file);
    if (!fs.existsSync(src)) continue;
    const name = String(e.order).padStart(3, '0') + '_' + e.shot + '_' + e.file;
    const dst = path.join(outDir, name);
    try { fs.rmSync(dst, { force: true }); } catch { /* */ }
    try { fs.symlinkSync(src, dst); symlinked++; }
    catch { try { fs.copyFileSync(src, dst); copied++; bytes += fs.statSync(dst).size; } catch { continue; } }
    files.push({ ...e, exported: name });
  }
  fs.writeFileSync(path.join(outDir, 'selects.json'), JSON.stringify({ project: pid, exportedAt: new Date().toISOString(), entries: files }, null, 2));
  return { dir: outDir, count: files.length, symlinked, copied, diskBytes: bytes, files: files.map(f => f.exported) };
}
