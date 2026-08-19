// Story → shots data layer. Everything is portable markdown:
//   projects/<pid>/story.md          — the idea / script (body), frontmatter { updated }
//   projects/<pid>/shots/SH010.md    — one file per shot; frontmatter is the record,
//                                      body is the description + an append-only log.
import fs from 'fs';
import path from 'path';
import { getStorageRoot, readMd, writeMd, stamp, safe, safeScope } from './store.mjs';
import { stageTrash } from './trash.mjs';

const R = () => getStorageRoot();
const storyMd = pid => path.join(R(), 'projects', safeScope(pid), 'story.md');
const shotsDir = pid => path.join(R(), 'projects', safeScope(pid), 'shots');
const shotMd = (pid, id) => path.join(shotsDir(pid), safe(id) + '.md');

// ── story (idea / script) ──
export function getStory(pid) {
  try {
    const { data, content } = readMd(storyMd(pid));
    return { updated: data.updated || '', content: content.trim() };
  } catch { return { updated: '', content: '' }; }
}
export function saveStory(pid, content) {
  writeMd(storyMd(pid), { project: pid, updated: stamp() }, content.trim() + '\n');
}

// ── shots ──
export function listShots(pid) {
  const dir = shotsDir(pid);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.'))) {
    try {
      const { data, content } = readMd(path.join(dir, f));
      out.push({ ...data, proj: pid, log: content.trim() });
    } catch { /* unreadable shot */ }
  }
  out.sort((a, b) => (a.no ?? 99) - (b.no ?? 99));
  return out;
}
export function getShot(pid, id) { return listShots(pid).find(s => s.id === id) || null; }

const shotId = no => 'SH' + String(no * 10).padStart(3, '0');

// The next shot number whose derived id is not already taken.
//
// `no` is renumbered by a reorder; `id` is stable and never renumbered. So after any reorder a
// shot can hold id SH030 while its `no` is 1, and "add shot" — which picks max(no)+1 — then
// derives SH030 for the NEW shot. writeShot merges onto whatever is at that path
// (`...prev.data, ...shot`), so the existing shot was silently replaced: its prompt, status,
// selected take and history absorbed into a shot the user thought was new.
export function freeShotNo(existing, startNo) {
  const taken = new Set(existing.map(s => s.id));
  let no = startNo;
  while (taken.has(shotId(no)) && no < 10000) no += 1;
  return no;
}
export function writeShot(pid, shot, logLine) {
  const id = shot.id || shotId(shot.no || 1);
  const file = shotMd(pid, id);
  let prev = { data: {}, content: '' };
  try { prev = readMd(file); } catch { /* new shot */ }
  const data = {
    // an untitled NEW shot titles itself with its own code (SH130) rather than a generic
    // placeholder. Only new ones: a patch carries prev.data.title — '' included — which
    // spreads over this default, so clearing a title by hand still leaves it cleared.
    no: 1, title: id, type: 'Medium', dur: 4, skill: '', skillWhy: '',
    status: 'todo', prompt: '', desc: '', tags: [], assets: [],
    created: prev.data.created || stamp(),
    ...prev.data, ...shot, id, updated: stamp()
  };
  const body = logLine
    ? (prev.content.trim() + '\n\n- ' + stamp() + ' — ' + logLine).trim()
    : prev.content.trim();
  writeMd(file, data, (body || '## Shot log') + '\n');
  return { ...data, proj: pid, log: body };
}
export function patchShot(pid, id, patch, logLine) {
  const s = getShot(pid, id);
  if (!s) return null;
  const { proj, log, ...data } = s;
  return writeShot(pid, { ...data, ...patch, id }, logLine);
}
export function deleteShot(pid, id) {
  // staged, not destroyed — restorable from the Trash page (Phase 3D)
  stageTrash(shotMd(pid, id), { label: 'shot ' + id + ' (' + pid + ')', itemKind: 'shot', pid, itemId: id });
}
// reorder = rewrite `no` per the given id order; ids stay stable (04 compat rule 4)
export function reorderShots(pid, order) {
  const shots = listShots(pid);
  const byId = new Map(shots.map(s => [s.id, s]));
  let no = 1;
  const out = [];
  for (const id of order) {
    const s = byId.get(id);
    if (!s) continue;
    byId.delete(id);
    if (s.no !== no) out.push(patchShot(pid, id, { no }, 'reordered to #' + no));
    else out.push(s);
    no++;
  }
  // anything the client didn't mention keeps its relative order at the end
  for (const s of [...byId.values()].sort((a, b) => (a.no ?? 99) - (b.no ?? 99))) {
    out.push(s.no === no ? s : patchShot(pid, s.id, { no }, 'reordered to #' + no));
    no++;
  }
  return listShots(pid);
}
export function duplicateShot(pid, id) {
  const src = getShot(pid, id);
  if (!src) return null;
  const shots = listShots(pid);
  const no = shots.length ? Math.max(...shots.map(s => s.no || 0)) + 1 : 1;
  let newId = shotId(no);
  while (fs.existsSync(shotMd(pid, newId))) newId = newId + 'b';
  const { proj, log, created, updated, ...data } = src;
  return writeShot(pid, { ...data, id: newId, no, title: (src.title || 'Shot') + ' copy', status: 'todo', assets: [] }, 'duplicated from ' + id);
}
export function replaceShots(pid, shots, logLine) {
  // used by AI breakdown — archives old shots dir instead of destroying it
  const dir = shotsDir(pid);
  if (fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.endsWith('.md'))) {
    const bak = dir + '-' + Date.now() + '.bak';
    fs.renameSync(dir, bak);
  }
  fs.mkdirSync(dir, { recursive: true });
  return shots.map(sh => writeShot(pid, { ...sh, id: shotId(sh.no) }, logLine || 'created by story breakdown'));
}
export function listAllShots() {
  const dir = path.join(R(), 'projects');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(d => !d.startsWith('.') && !d.startsWith('_')).flatMap(pid => listShots(pid));
}
