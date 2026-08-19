// Project memory — the "hot cache" for a bigger project. A plain, editable markdown doc at
// projects/<pid>/memory.md (frontmatter {project, updated}, body = markdown bullet list) that is
// injected verbatim into every agent run alongside the brief. An absent/empty file simply renders
// an empty state — no per-project flag needed, memory is opt-in by writing to it.
//
// This module also owns the References-vs-Assets folder classification override manifest
// (context/_folders.md): a tiny per-folder map { folderName: 'asset' | 'reference' } that lets the
// user re-file a board across the split without renaming it. The naming-convention default lives on
// the client (AssetBoards.jsx · folderKind); this manifest only stores explicit overrides.
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { getStorageRoot, stamp, safeScope } from './store.mjs';

// safeScope is the one project-id sanitizer (store.mjs) — an allowlist, and the same one
// contextDir() uses, so memory/_folders and the context boards always agree on the directory.
const projDir = pid => path.join(getStorageRoot(), 'projects', safeScope(pid));
export const memoryPath = pid => path.join(projDir(pid), 'memory.md');
export const foldersPath = pid => path.join(projDir(pid), 'context', '_folders.md');

// Machine-owned files living at the root of a project's context dir. They are control manifests,
// not user assets: the asset library must not list them, nor let them be renamed/moved/deleted.
// Single declaration, and it is NOT here — it moved to store.mjs on 2026-08-02, which owns
// contextDir and the path helpers that have to consult it. Re-exported so existing importers
// (library.mjs) keep working. Never re-list these names elsewhere.
export { CONTROL_FILES } from './store.mjs';

// atomic md write — tmp+rename so a reader never sees a half-written file (mirrors store.writeMd)
function writeAtomic(file, data, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  const tmp = file + '.' + process.pid + '.tmp';
  // {content} form, not a bare string: matter.stringify(str, data) re-parses a string body, so a
  // memory note that begins with a `---` fence (horizontal rule / pasted frontmatter) would have
  // its leading block hoisted into the frontmatter and lost on read. Serialize the body verbatim.
  fs.writeFileSync(tmp, matter.stringify({ content: body }, clean));
  fs.renameSync(tmp, file);
}

// ── memory doc ──
export function readMemory(pid) {
  try {
    const { data, content } = matter(fs.readFileSync(memoryPath(pid), 'utf8'));
    return { body: content.trim(), updated: data.updated || '' };
  } catch { return { body: '', updated: '' }; }
}
export function writeMemory(pid, body) {
  const updated = stamp();
  writeAtomic(memoryPath(pid), { project: String(pid), updated }, (body || '').trim() + '\n');
  return { body: (body || '').trim(), updated };
}
// prepend a dated bullet — quick-append keeps the newest thought at the top of the doc
export function appendMemory(pid, text) {
  const t = String(text || '').trim();
  if (!t) return readMemory(pid);
  const { body } = readMemory(pid);
  const line = '- ' + t + '  _(' + stamp() + ')_';
  return writeMemory(pid, body ? line + '\n' + body : line);
}
// the slice handed to agent runs — empty string when there is nothing to remember
export function memoryForAgent(pid) { return readMemory(pid).body; }

// ── learnings dedupe (ticket 20) ──
// Distillation appends durable learnings to memory, but re-running it (or a near-repeat of a prior
// session) must not pile up duplicates. Normalize a line to its content — drop the leading bullet,
// the trailing dated `_(…)_` stamp, punctuation and case — so two bullets that say the same thing
// compare equal even when their marker or date differ.
export function normalizeMemoryLine(s) {
  return String(s || '')
    .replace(/^[-*+]\s+/, '')            // leading bullet
    .replace(/\s*_\([^)]*\)_\s*$/, '')   // trailing "_(Jul 6, 18:00)_" stamp
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')        // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

// token-overlap similarity of two already-normalized strings (Jaccard over word sets). A high score
// means "basically the same learning phrased differently" — enough to skip on append.
function jaccard(a, b) {
  const A = new Set(String(a).split(' ').filter(Boolean));
  const B = new Set(String(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// existing memory bullets as individual trimmed lines (for dedupe comparisons).
export function memoryLines(pid) {
  return readMemory(pid).body.split('\n').map(l => l.trim()).filter(Boolean);
}

// Append several learnings, skipping any that duplicate an existing bullet — normalized-equal or
// high token overlap (>= SIM_THRESHOLD). Deduplicates within the batch too. Returns
// { added:[…], skipped:[…] }. Uses the existing appendMemory(), so the newest lands at the top and
// the memory record's shape/ordering is unchanged.
const SIM_THRESHOLD = 0.85;
export function appendLearnings(pid, learnings = []) {
  const items = (Array.isArray(learnings) ? learnings : [learnings])
    .map(s => String(s || '').trim()).filter(Boolean);
  const seen = memoryLines(pid).map(normalizeMemoryLine).filter(Boolean);
  const added = [], skipped = [];
  for (const item of items) {
    const norm = normalizeMemoryLine(item);
    if (!norm) continue;
    if (seen.some(s => s === norm || jaccard(s, norm) >= SIM_THRESHOLD)) { skipped.push(item); continue; }
    appendMemory(pid, item);
    seen.push(norm); // so a near-duplicate later in the same batch is also skipped
    added.push(item);
  }
  return { added, skipped };
}

// ── folder classification overrides (context/_folders.md) ──
export function readFolderKinds(pid) {
  try {
    const { data } = matter(fs.readFileSync(foldersPath(pid), 'utf8'));
    return data.kinds && typeof data.kinds === 'object' ? data.kinds : {};
  } catch { return {}; }
}
export function writeFolderKind(pid, folder, kind) {
  const f = String(folder || '').trim();
  const kinds = readFolderKinds(pid);
  if (kind === 'asset' || kind === 'reference') kinds[f] = kind;
  else delete kinds[f]; // any other value clears the override → back to naming-convention default
  writeAtomic(foldersPath(pid), { project: String(pid), updated: stamp(), kinds },
    'Per-folder References/Assets classification overrides for this project.\n');
  return kinds;
}

// ── routes ──
// registerMemoryRoutes(app, { appendActivity, bumpHistory }) — deps optional; both are no-ops if absent.
export function registerMemoryRoutes(app, deps = {}) {
  const bump = deps.bumpHistory || (() => {});
  const activity = deps.appendActivity || (() => {});

  app.get('/api/memory/:pid', (req, res) => res.json(readMemory(req.params.pid)));

  app.put('/api/memory/:pid', (req, res) => {
    const r = writeMemory(req.params.pid, String(req.body?.content || ''));
    bump('briefs');
    activity({ dot: 'amber', t: 'Project memory updated', t2: '· ' + req.params.pid, s: 'injected into every agent run alongside the brief', kind: 'proj', ref: req.params.pid });
    res.json({ ok: true, ...r });
  });

  app.post('/api/memory/:pid/append', (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'nothing to remember — text is empty' });
    const r = appendMemory(req.params.pid, text);
    bump('briefs');
    activity({ dot: 'green', t: 'Remembered', t2: '· ' + req.params.pid, s: text.slice(0, 80), kind: 'proj', ref: req.params.pid });
    res.json({ ok: true, ...r });
  });

  // Dedupe-aware learning capture. appendMemory above is a plain prepend, which is right for one
  // deliberate note but wrong for the correction loop: a user who keeps telling the agent the same
  // thing it keeps getting wrong would pile up near-identical bullets. appendLearnings already does
  // normalized + Jaccard dedupe (it is what the session distiller writes through) — it simply had no
  // HTTP door. This is that door, and it returns the same { added, skipped } shape the distill route
  // does, so a caller can honestly say "already known" instead of claiming a save that deduped away.
  app.post('/api/memory/:pid/learnings', (req, res) => {
    const raw = req.body?.learnings ?? req.body?.text;
    const list = (Array.isArray(raw) ? raw : [raw]).map(s => String(s || '').trim()).filter(Boolean);
    if (!list.length) return res.status(400).json({ error: 'nothing to remember — learnings is empty' });
    const r = appendLearnings(req.params.pid, list);
    bump('briefs');
    if (r.added.length) activity({ dot: 'green', t: 'Learned', t2: '· ' + req.params.pid, s: r.added[0].slice(0, 80) + (r.added.length > 1 ? ' +' + (r.added.length - 1) + ' more' : ''), kind: 'proj', ref: req.params.pid });
    res.json({ ok: true, ...r });
  });

  // classification override manifest
  app.get('/api/folders/:pid', (req, res) => res.json({ kinds: readFolderKinds(req.params.pid) }));
  app.put('/api/folders/:pid', (req, res) => {
    const folder = String(req.body?.folder || '').trim();
    if (!folder) return res.status(400).json({ error: 'folder is required' });
    const kinds = writeFolderKind(req.params.pid, folder, req.body?.kind);
    res.json({ ok: true, kinds });
  });
}
