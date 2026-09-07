// Scout .md store — every piece of metadata lives as a portable markdown file
// under the storage root. No database, no JSON blobs on disk.
import fs from 'fs';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';
// memory.mjs imports getStorageRoot/stamp back from here — the cycle is safe because every
// reference on both sides is used inside a function, never at module-init time.
import { memoryForAgent } from './memory.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Both the config pointer and the default storage root are overridable via env so a packaged
// desktop app (Electron) can redirect them to a writable per-user location — the app bundle
// itself is read-only. Unset (plain `npm start`) → the original in-repo behavior.
const CONFIG_MD = process.env.SCOUT_CONFIG || path.join(APP_ROOT, 'config.md');
const DEFAULT_ROOT = process.env.SCOUT_DATA || path.join(APP_ROOT, 'workspace');

// ── config pointer (only file that lives outside the storage root) ──
export function getStorageRoot() {
  try {
    const { data } = matter(fs.readFileSync(CONFIG_MD, 'utf8'));
    if (data.storageRoot && typeof data.storageRoot === 'string') return data.storageRoot;
  } catch { /* first run */ }
  return DEFAULT_ROOT;
}

export function setStorageRoot(p) {
  const abs = p.replace(/^~(?=\/|$)/, os.homedir());
  fs.writeFileSync(CONFIG_MD, matter.stringify(
    'Pointer to the Scout storage root. Everything else lives inside that folder as .md files.\n',
    { storageRoot: abs }
  ));
  return abs;
}

// ── md helpers ──
export function readMd(file) {
  // cache:false — gray-matter's content-keyed cache stores an EMPTY result on the error path, so a
  // malformed file that threw once would parse as an empty record on the next read of identical
  // content (silently losing the record / hiding the corruption). Disabling the cache makes every
  // read consistent and lets the integrity scanner reliably flag bad files (Phase 4).
  const { data, content } = matter(fs.readFileSync(file, 'utf8'), { cache: false });
  return { data, content };
}
export function writeMd(file, data, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // js-yaml refuses undefined values — drop them instead of crashing the request
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  // atomic write: a crash/power-loss mid-write would otherwise corrupt the .md, and every
  // reader silently swallows parse errors — the record would just vanish. tmp+rename makes
  // the swap atomic on POSIX/Windows so readers see either the old file or the whole new one.
  const tmp = file + '.' + process.pid + '.tmp';
  // pass content as an object property, not a bare string: matter.stringify(str, data) re-parses
  // a string body, so any content that itself begins with a `---` fence (a markdown horizontal
  // rule, a pasted YAML/frontmatter example) gets its leading block hoisted into the frontmatter
  // and silently dropped on the next read. The {content} form serializes the body verbatim.
  fs.writeFileSync(tmp, matter.stringify({ content }, clean));
  fs.renameSync(tmp, file);
}

const R = () => getStorageRoot();
export const paths = {
  settings: () => path.join(R(), 'settings.md'),
  projectDir: pid => path.join(R(), 'projects', pid),
  projectMd: pid => path.join(R(), 'projects', pid, 'project.md'),
  briefMd: pid => path.join(R(), 'projects', pid, 'brief.md'),
  itemsDir: pid => path.join(R(), 'projects', pid, 'items'),
  itemMd: (pid, id) => path.join(R(), 'projects', pid, 'items', safe(id) + '.md'),
  historyDir: () => path.join(R(), 'skills', 'history'),
  activityMd: () => path.join(R(), 'activity.md'),
  jobsDir: () => path.join(R(), 'jobs'),
  // Licence state: the signed token, the machine id, and when we last reached the server.
  // Inside the storage root like everything else, so "move my data" moves it too — and so
  // the tests' SCOUT_DATA temp dir isolates it without licence.mjs knowing about tests.
  licenceMd: () => path.join(R(), 'licence.md')
};
// ── frontmatter dates ────────────────────────────────────────────────────────────────────────
// gray-matter parses a BARE YAML date (`created: 2026-08-17`) into a JavaScript `Date`, and a
// quoted one (`created: '2026-08-17'`) into a string. The same key is therefore two different
// types depending on how somebody happened to write the file, which has already produced two
// live bugs in this codebase:
//
//   `String(created).localeCompare(...)`  sorted a queue by WEEKDAY NAME — "Mon Aug 17 2026…"
//   `rejected ${access_changed}`          printed "Thu Jul 30 2026 02:00:00 GMT+0200 (Central
//                                         European Summer Time)" into the agent's context file
//
// Both looked correct in review and both are invisible until you read real output. So: never
// `String()` a frontmatter date and never `localeCompare` two of them. `day()` to show one,
// `dayMs()` to compare two.
export function dayMs(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

// The calendar day, always `YYYY-MM-DD`. Uses UTC parts because a bare YAML date parses as UTC
// midnight — reading it back in local time west of UTC would report the day before.
export function day(v) {
  const t = dayMs(v);
  return t == null ? '' : new Date(t).toISOString().slice(0, 10);
}

// Oldest first. Missing dates sort last rather than first: an object with no date is not the
// oldest thing in the queue, it is an object we know nothing about.
export function byDate(key = 'created') {
  return (a, b) => {
    const x = dayMs(a && a[key]), y = dayMs(b && b[key]);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x - y;
  };
}

export function safe(name) { return name.replace(/[^\w.\-]+/g, '_'); }
// scope/pid become filesystem path segments (projects/<pid>/…). Route params are already
// SLUG-guarded, but several endpoints take pid/scope from the request BODY where app.param
// never fires — strip everything but the slug charset so '../' can never escape the root.
export function safeScope(s) { return String(s || '').replace(/[^\w-]+/g, ''); }

// Identity, not filesystem safety — the two are different jobs and were once the same function.
// `safe('Maria Santos')` is `Maria_Santos`; the store's own shape is `maria-santos.md`. ONE
// slugifier, exported from here because CLAUDE.md's source-of-truth table has always said this is
// where it lives — it just was not true until now (it sat in records.mjs, with two more copies
// elsewhere). `records.mjs` re-exports it so every existing importer keeps working.
export function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

// ── settings ──
// Defaults ship EMPTY of personal paths — a fresh install points at the buyer's own skills
// via Settings (or ~/.claude/skills, picked up automatically when present).
const DEFAULT_SKILL_REPOS = [
  { name: 'Claude skills', paths: [path.join(os.homedir(), '.claude', 'skills')] }
];
const DEFAULT_SETTINGS = {
  budget: 60,
  showHints: true,
  // set once the first-run wizard has been completed, so it never re-prompts
  onboarded: false,
  trackedFolders: [],
  skillRepos: DEFAULT_SKILL_REPOS,
  // any CLI that accepts `-p <prompt>` and prints the answer works: claude, codex, gemini…
  agentCommand: 'claude',
  // Real failure over fake success (Phase 10D): a reroll that can't reach the agent now FAILS with a
  // readable error instead of silently fabricating a "practice" version that looks like real output.
  // Opt back in from Settings only for offline development.
  agentSimulateFallback: false,
  // Whether an assistant's `schedule:` actually sends it out (backend/dispatch.mjs). OFF by
  // default and deliberately so: sending an assistant out spawns a CLI that costs the person
  // money, and nothing in this app spends money without a press. With it off, `schedule` is a
  // statement of intent she reads on the card, and every screen says so rather than implying a
  // cron nobody wired.
  autoRun: false,
  // Groq — the cheap-LLM accelerator. Scout's only remaining use is backend/distill.mjs, which
  // turns a closed session transcript into durable learnings. See docs/03_MEMORY.md.
  groqApiKey: '',
  groqTextModel: 'llama-3.3-70b-versatile',
};
// Raw read: defaults + whatever is on disk, with NO migration side-effect. Both getSettings()
// (which may persist a migration) and saveSettings() (which must not re-enter it) read through
// here — saveSettings calling getSettings() instead used to recurse: getSettings migrates →
// saveSettings → getSettings re-reads the still-unmigrated file → migrates again → … The
// recursion only ever "terminated" by overflowing the stack, and the RangeError was swallowed
// by the catch below, after ~2500 rewrites of settings.md (which holds live API keys).
// Reading is allowed to degrade to defaults. WRITING over a file we could not read is not, and
// the difference is the whole point of `settingsUnreadable`.
//
// The failure it prevents: settings.md becomes unparseable — a hand-edit that breaks the YAML is
// the *documented* workflow ("Edit here or in the app — both work"), and a transient EBUSY from
// antivirus or a synced folder does it too. readSettings swallowed that and returned bare
// defaults, so GET /api/state served falApiKey:'' (empty, not the REDACTED sentinel, because
// publicSettings only substitutes for truthy keys). The client cached that, and the next toggle
// of ANY switch PUT the whole settings object back — saveSettings re-read the same unreadable
// file, got defaults again, and atomically replaced settings.md with a fresh-install default.
// Live FAL/Kie/Groq keys, model defaults, skill repos and keybindings: gone, 200 OK, no message.
//
// listProjects/listItems already isolate a malformed record so one bad file cannot sink the rest.
// settings.md had the opposite behaviour — it overwrote itself.
export function settingsUnreadable() {
  const f = paths.settings();
  if (!fs.existsSync(f)) return false;            // absent is the legitimate first-run case
  try { readMd(f); return false; } catch { return true; }
}
function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...readMd(paths.settings()).data }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
// A skillRepos value is legacy/corrupt if it isn't an array, or is the v1 array-of-strings form.
const needsRepoMigration = s => !Array.isArray(s.skillRepos) || (s.skillRepos.length && typeof s.skillRepos[0] === 'string');
export function getSettings() {
  const s = readSettings();
  // migrate v1 string-based repo entries; an intentionally empty list stays empty
  if (needsRepoMigration(s)) {
    s.skillRepos = DEFAULT_SKILL_REPOS;
    // write directly — going through saveSettings() would re-enter getSettings() (see above)
    try {
      writeMd(paths.settings(), s,
        'Scout settings. Edit here or in the app — both work; this file is the source of truth.\n');
    } catch { /* read-only root — the in-memory migration still stands for this call */ }
  }
  return s;
}
// API keys never leave the backend in cleartext: /api/state serves them through
// publicSettings(), which swaps each set key for REDACTED. saveSettings() drops
// REDACTED values from incoming patches so a round-tripped settings object can't
// clobber the real keys on disk.
export const SECRET_SETTING_KEYS = ['groqApiKey'];
export const REDACTED = '••••••••';
export function publicSettings() {
  const s = getSettings();
  for (const k of SECRET_SETTING_KEYS) if (s[k]) s[k] = REDACTED;
  return s;
}
export function saveSettings(patch) {
  // Refuse to write over a file we could not read. `base` below would otherwise be bare defaults,
  // and since the client PUTs its whole settings object on any toggle, one unreadable read turned
  // a "show hints" switch into a full wipe of the user's API keys. Failing loudly here is the
  // only place that can distinguish "the user cleared this field" from "we never saw its value".
  if (settingsUnreadable()) {
    const e = new Error('settings.md exists but could not be read — refusing to overwrite it. '
      + 'Fix or remove the file (it may have a YAML error), then try again.');
    e.code = 'settings-unreadable';
    throw e;
  }
  patch = { ...patch };
  for (const k of SECRET_SETTING_KEYS) if (patch[k] === REDACTED) delete patch[k];
  // readSettings(), never getSettings() — the latter can persist a migration and would recurse
  // back into here. The migration still happens, folded into this same write.
  const base = readSettings();
  if (needsRepoMigration(base)) base.skillRepos = DEFAULT_SKILL_REPOS;
  const next = { ...base, ...patch };
  writeMd(paths.settings(), next,
    'Scout settings. Edit here or in the app — both work; this file is the source of truth.\n');
  return next;
}

// ── projects / items ──
export function listProjects() {
  const dir = path.join(R(), 'projects');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const pid of fs.readdirSync(dir).filter(d => !d.startsWith('.') && !d.startsWith('_') && fs.existsSync(paths.projectMd(d)))) {
    // one malformed project.md must not sink the whole list (Phase 4 malformed isolation) — skip it;
    // the integrity report (server/indexer.mjs) surfaces it separately.
    try {
      const { data } = readMd(paths.projectMd(pid));
      let brief = '';
      try { brief = readMd(paths.briefMd(pid)).content.trim(); } catch { /* none */ }
      out.push({ id: pid, ...data, brief });
    } catch { /* quarantined — see /api/integrity */ }
  }
  return out;
}
export function createProject({ name, sub = '', gradIx = 0 }) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('project name required');
  let pid = clean.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  const dir = () => path.join(R(), 'projects', pid);
  let n = 2;
  while (fs.existsSync(dir())) pid = pid.replace(/-\d+$/, '') + '-' + n++;
  const existing = listProjects();
  const order = existing.length ? Math.max(...existing.map(p => p.order ?? 0)) + 1 : 1;
  fs.mkdirSync(path.join(dir(), 'context', 'moodboard'), { recursive: true });
  fs.mkdirSync(path.join(dir(), 'shots'), { recursive: true });
  fs.mkdirSync(path.join(dir(), 'items'), { recursive: true });
  writeMd(paths.projectMd(pid), { name: clean, sub, scenes: '', model: '', style: '', when: 'created ' + stamp(), order, gradIx: Number(gradIx) || 0 });
  writeMd(paths.briefMd(pid), { project: pid, updated: stamp() }, '');
  writeMd(path.join(dir(), 'story.md'), { project: pid, updated: stamp() }, '');
  return { id: pid, name: clean, sub, order, gradIx: Number(gradIx) || 0, brief: '' };
}
export function patchProject(pid, patch) {
  const file = paths.projectMd(pid);
  if (!fs.existsSync(file)) return null;
  const { data, content } = readMd(file);
  const allowed = {};
  // DEV-136 — `videoModel`/`audioModel` join `model` (the image default) so a project can carry
  // a full base setup chosen at creation. They are per-project overrides of
  // settings.modelDefaults, read the same way `model` already is.
  for (const k of ['name', 'sub', 'scenes', 'model', 'videoModel', 'audioModel', 'style', 'when', 'order', 'gradIx', 'listCols']) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  const next = { ...data, ...allowed };
  writeMd(file, next, content);
  return { id: pid, ...next };
}
// archive = rename the dir out of sight — nothing is ever destroyed
export function archiveProject(pid) {
  const src = paths.projectDir(pid);
  if (!fs.existsSync(paths.projectMd(pid))) throw new Error('project not found');
  const archived = '_archive-' + Date.now() + '-' + pid;
  fs.renameSync(src, path.join(R(), 'projects', archived));
  return archived;
}
export function restoreProject(archivedDir) {
  const clean = path.basename(String(archivedDir));
  const m = clean.match(/^_archive-\d+-(.+)$/);
  if (!m) throw new Error('not an archive dir');
  const src = path.join(R(), 'projects', clean);
  if (!fs.existsSync(src)) throw new Error('archive not found');
  let pid = m[1];
  while (fs.existsSync(path.join(R(), 'projects', pid))) pid = pid + '-restored';
  fs.renameSync(src, path.join(R(), 'projects', pid));
  return pid;
}
export function saveBrief(pid, content) {
  writeMd(paths.briefMd(pid), { project: pid, updated: stamp() }, content.trim() + '\n');
}
export function listItems() {
  const out = [];
  const dir = path.join(R(), 'projects');
  if (!fs.existsSync(dir)) return out;
  for (const pid of fs.readdirSync(dir).filter(d => !d.startsWith('.') && !d.startsWith('_'))) {
    const idir = paths.itemsDir(pid);
    if (!fs.existsSync(idir)) continue;
    for (const f of fs.readdirSync(idir).filter(f => f.endsWith('.md') && !f.startsWith('.'))) {
      try {
        const { data, content } = readMd(path.join(idir, f));
        out.push({ ...data, proj: pid, log: content.trim(), rev: revOf(data, content) });
      } catch { /* one malformed item file must not sink the whole list */ }
    }
  }
  out.sort((a, b) => (a.tl ?? 0) - (b.tl ?? 0));
  return out;
}
// SCOPED identity (Phase 1): items are addressed by { projectId, itemId }. Item ids such as
// `SH010_gen` repeat across projects, so a global `getItem(id)` that scans every project and
// returns the FIRST match let a mutation land in the wrong project. Every reader/writer below
// takes the project id explicitly and touches exactly one file — no cross-project scan.
export function getItem(pid, id) {
  const spid = safeScope(pid);
  const file = paths.itemMd(spid, id);
  if (!fs.existsSync(file)) return null;
  try {
    const { data, content } = readMd(file);
    return { ...data, proj: spid, log: content.trim(), rev: revOf(data, content) };
  } catch { return null; }
}
// Legacy resolver for the deprecated global /api/items/:id wrapper: which projects hold this id?
// Returns the list so the route can 409 on ambiguity instead of silently picking one.
export function findItemProjects(id) {
  const out = [];
  const dir = path.join(R(), 'projects');
  if (!fs.existsSync(dir)) return out;
  for (const pid of fs.readdirSync(dir).filter(d => !d.startsWith('.') && !d.startsWith('_'))) {
    if (fs.existsSync(paths.itemMd(pid, id))) out.push(pid);
  }
  return out;
}
// opts: string (back-compat log line) OR { log, baseRev, baseValues } for conflict-guarded writes
// (Phase 3). On a base-rev mismatch where a touched field changed, returns { conflict, currentRev,
// currentValues, conflictingFields } instead of writing — the route turns that into HTTP 409.
export function patchItem(pid, id, patch, opts = {}) {
  const o = typeof opts === 'string' ? { log: opts } : (opts || {});
  const spid = safeScope(pid);
  const file = paths.itemMd(spid, id);
  if (!fs.existsSync(file)) return null;
  const { data, content } = readMd(file);
  const conflict = detectConflict(data, o.baseRev, o.baseValues, revOf(data, content));
  if (conflict) return { conflict: true, ...conflict };
  const next = { ...data, ...patch };
  const body = o.log ? (content.trim() + '\n\n- ' + stamp() + ' — ' + o.log).trim() : content;
  writeMd(file, next, body + '\n');
  return { ...next, proj: spid, log: body.trim(), rev: revOf(next, body + '\n') };
}
export function deleteItem(pid, id) {
  const spid = safeScope(pid);
  const file = paths.itemMd(spid, id);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

// ── revision + conflict detection (Phase 3) ──
// A record's revision is a short content hash. The app and external agents both edit the same
// .md files; a mutation carries the baseRev it read plus the previous values of the fields it
// changes. If the on-disk rev still matches, apply. If it drifted but the touched fields are
// unchanged, the write is a safe merge. If a touched field changed underneath us, refuse (409).
export function revOf(data, content = '') {
  let h = 5381;
  const s = JSON.stringify(data) + '\0' + content;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function detectConflict(currentData, baseRev, baseValues, currentRev) {
  if (baseRev == null || baseRev === currentRev) return null; // no base given, or unchanged → apply
  const touched = baseValues && typeof baseValues === 'object' ? Object.keys(baseValues) : [];
  const conflictingFields = touched.filter(k => JSON.stringify(currentData[k]) !== JSON.stringify(baseValues[k]));
  if (!conflictingFields.length) return null; // drifted, but not on the fields we're changing → merge
  const currentValues = {};
  for (const k of conflictingFields) currentValues[k] = currentData[k];
  return { currentRev, currentValues, conflictingFields };
}

// ── activity feed ──
export function appendActivity(ev) {
  let data = { events: [] };
  try { data = readMd(paths.activityMd()).data; } catch { /* none */ }
  const events = [{ ts: Date.now(), ...ev }, ...(data.events || [])].slice(0, 60);
  writeMd(paths.activityMd(), { events }, 'Recent activity, newest first. Rendered on the Scout home page.\n');
}
export function getActivity() {
  try { return readMd(paths.activityMd()).data.events || []; } catch { return []; }
}

// ── skill history (git-style contribution log) ──
export function bumpHistory(kind, n = 1) {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(paths.historyDir(), day + '.md');
  let data = { date: day, triage: 0, rerolls: 0, briefs: 0, prompts: 0 };
  let content = '';
  try { const r = readMd(file); data = { ...data, ...r.data }; content = r.content; } catch { /* new day */ }
  data[kind] = (data[kind] || 0) + n;
  writeMd(file, data, (content.trim() + '\n- ' + stamp() + ' — ' + kind + ' +' + n).trim() + '\n');
}
export function getHistory() {
  const dir = paths.historyDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.')).sort().map(f => {
    const { data } = readMd(path.join(dir, f));
    return data;
  });
}

// ── skill repositories (real Claude skills: dirs with SKILL.md) ──
export function scanSkillRepos() {
  const s = getSettings();
  return (s.skillRepos || []).map(rep => {
    const repPaths = (rep.paths || []).map(p => path.isAbsolute(p) ? p : path.join(R(), p));
    const skills = [];
    let anyExists = false;
    for (const p of repPaths) {
      let stat;
      try { stat = fs.statSync(p); } catch { continue; }
      if (!stat.isDirectory()) continue;
      anyExists = true;
      if (fs.existsSync(path.join(p, 'SKILL.md'))) skills.push(skillFrom(p));
      else {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          if (e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(p, e.name, 'SKILL.md')))
            skills.push(skillFrom(path.join(p, e.name)));
        }
      }
    }
    return { name: rep.name, paths: repPaths, exists: anyExists, skills };
  });
}
function skillFrom(dir) {
  let name = path.basename(dir), description = '';
  try {
    const { data, content } = readMd(path.join(dir, 'SKILL.md'));
    name = data.name || name;
    description = data.description || firstLine(content);
  } catch { /* unreadable frontmatter */ }
  const files = walkMd(dir).map(f => ({
    rel: path.relative(dir, f),
    size: fs.statSync(f).size
  })).sort((a, b) => (a.rel === 'SKILL.md' ? -1 : b.rel === 'SKILL.md' ? 1 : a.rel.localeCompare(b.rel)));
  return { name, description, dir, files };
}
function walkMd(dir, depth = 0) {
  if (depth > 3) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name.startsWith('_') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(p, depth + 1));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
function firstLine(s) { return (s || '').trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 200); }

// path-safety: file must live inside a configured skill repo
export function skillFileSafe(abs) {
  const resolved = path.resolve(abs);
  return scanSkillRepos().some(r =>
    r.paths.some(p => resolved.startsWith(p + path.sep) || resolved === p) ||
    r.skills.some(sk => resolved.startsWith(sk.dir + path.sep)));
}
export function readSkillFile(abs) {
  if (!abs.endsWith('.md') || !skillFileSafe(abs)) throw new Error('outside skill repos');
  return fs.readFileSync(abs, 'utf8');
}
export function writeSkillFile(abs, content) {
  if (!abs.endsWith('.md') || !skillFileSafe(abs)) throw new Error('outside skill repos');
  try { fs.copyFileSync(abs, abs + '.bak'); } catch { /* new file */ }
  fs.writeFileSync(abs, content);
}

// ── project context assets (folders of text, pdf, images, video — the REAL project brief) ──
export const contextDir = pid => path.join(R(), 'projects', safeScope(pid), 'context');
const CTX_TYPES = { md: 'note', txt: 'text', pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image', mp4: 'video', mov: 'video', webm: 'video', m4v: 'video', url: 'link' };
const cleanName = n => { const b = path.basename(String(n)).replace(/[/\\]+/g, '_'); return b === '..' || b === '.' ? '_' : b; };
const cleanFolder = f => String(f || '').split('/')[0].replace(/[^\w\- ]+/g, '').trim();

// Machine-owned files living at the ROOT of a project's context dir. They are control
// manifests, not user assets: the asset library must not list them, and no surface may
// rename, move or delete them.
//
// Declared HERE rather than in memory.mjs, which is where it started, because store.mjs
// already owns `contextDir`, `paths`, `safe`/`safeScope` and the clean* helpers — the
// control-file vocabulary belongs with them. Importing memory.mjs from here instead would
// deepen the existing store <- memory cycle, and DEFAULT_SETTINGS is a module-level
// literal evaluated at init, so that cycle is a real hazard rather than a style point.
// memory.mjs re-exports this for its existing consumers. ONE declaration.
export const CONTROL_FILES = new Set(['_folders.md']);

// Control files live at the scope root only — a same-named file inside a board folder is an
// ordinary user asset and stays deletable. Same rule library.mjs applies.
const isControlFile = (folder, name) => !folder && CONTROL_FILES.has(name);

function ctxItem(pid, folder, name) {
  const p = path.join(contextDir(pid), folder, name);
  const st = fs.statSync(p);
  const ext = name.split('.').pop().toLowerCase();
  const type = CTX_TYPES[ext] || 'file';
  let excerpt = '';
  if (type === 'note' || type === 'text' || type === 'link') {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const body = name.endsWith('.md') ? matter(raw).content : raw;
      excerpt = body.trim().split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 2).join(' ').slice(0, 200);
    } catch { /* binary */ }
  }
  // the entity display name, read from the asset's meta sidecar. Read inline rather than via
  // library.mjs readMeta() — library imports from this module, so calling back into it would be
  // circular. Only the one field is needed here; the full sidecar is fetched on demand elsewhere.
  let label = '';
  try {
    const mp = p + '.meta.md';
    if (fs.existsSync(mp)) label = String(matter(fs.readFileSync(mp, 'utf8')).data.label || '');
  } catch { /* no sidecar, or unreadable — the key shows through */ }
  return { name, folder, type, size: st.size, mtime: st.mtimeMs, excerpt, label };
}

export function listContext(pid) {
  const dir = contextDir(pid);
  const folders = [];
  const items = [];
  if (!fs.existsSync(dir)) return { folders, items };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    // _folders.md is the References/Assets classification manifest (see memory.mjs), not a note —
    // hide it from the board/notes lists and from the agent bundle below.
    if (e.name.startsWith('.') || e.name === '_folders.md') continue;
    if (e.isDirectory()) {
      folders.push(e.name);
      for (const f of fs.readdirSync(path.join(dir, e.name), { withFileTypes: true })) {
        if (f.isFile() && !f.name.startsWith('.') && !f.name.endsWith('.meta.md')) items.push(ctxItem(pid, e.name, f.name));
      }
    } else if (e.isFile() && !e.name.endsWith('.meta.md')) items.push(ctxItem(pid, '', e.name));
  }
  items.sort((a, b) => b.mtime - a.mtime);
  folders.sort((a, b) => a.localeCompare(b));
  return { folders, items };
}
// Uploading a second, different file of the same name must never overwrite the first — that
// silently replaces the image AND leaves the previous file's `.meta.md` sidecar attached to the
// new bytes, so its analysis, tags and cached fal URL now describe a picture that is gone. A
// generation referencing that asset is then conditioned on the wrong image, with nothing anywhere
// reporting a problem. library.mjs's saveAsset has guarded against exactly this since it was
// written ("must never overwrite the first (and orphan its .meta.md)"); the context/board path
// simply never got the same treatment.
//
// `overwrite: true` is for the ONE caller that means it — editing a note in place has to land on
// the same filename, or every save would fork note-2.md, note-3.md. Defaulting to unique means a
// future caller is safe without having to know this.
export function saveContextFile(pid, name, buf, folder = '', { overwrite = false } = {}) {
  const f = cleanFolder(folder);
  const dir = path.join(contextDir(pid), f);
  fs.mkdirSync(dir, { recursive: true });
  const clean = overwrite ? cleanName(name) : uniqueContextName(dir, cleanName(name));
  fs.writeFileSync(path.join(dir, clean), buf);
  return { name: clean, folder: f };
}
// "IMG.jpg" → "IMG-2.jpg" → "IMG-3.jpg". Mirrors library.mjs's uniqueName; kept separate rather
// than shared because store.mjs must not import library.mjs (library.mjs imports store.mjs).
function uniqueContextName(dir, clean) {
  if (!fs.existsSync(path.join(dir, clean))) return clean;
  const ext = path.extname(clean);
  const stem = clean.slice(0, clean.length - ext.length);
  for (let n = 2; n < 10000; n++) {
    const cand = stem + '-' + n + ext;
    if (!fs.existsSync(path.join(dir, cand))) return cand;
  }
  return Date.now() + '-' + clean;
}
export function deleteContextFile(pid, name, folder = '') {
  const f = cleanFolder(folder), n = cleanName(name);
  // This is an irreversible fs.rmSync, not a staged trash move, and `name` reaches it
  // straight off the wire (POST /api/context/:pid/note `replace`). Without this guard a
  // request naming `_folders.md` silently wipes the project's folder classifications with
  // no undo. Refuse rather than throw: the caller is a fire-and-forget cleanup step.
  if (isControlFile(f, n)) return false;
  fs.rmSync(path.join(contextDir(pid), f, n), { force: true });
  return true;
}
export function contextFilePath(pid, name, folder = '') {
  const f = cleanFolder(folder), n = cleanName(name);
  // Everything that reads, downloads, stages-for-trash or resolves a context asset comes
  // through here, so one refusal covers all of them.
  if (isControlFile(f, n)) return null;
  const p = path.join(contextDir(pid), f, n);
  return fs.existsSync(p) ? p : null;
}
export function createContextFolder(pid, name) {
  const f = cleanFolder(name);
  if (!f) throw new Error('invalid folder name');
  fs.mkdirSync(path.join(contextDir(pid), f), { recursive: true });
  return f;
}
export function deleteContextFolder(pid, name) {
  const f = cleanFolder(name);
  if (!f) throw new Error('invalid folder name');
  fs.rmSync(path.join(contextDir(pid), f), { recursive: true, force: true });
}
// text bundle injected into agent runs, grouped by folder
export function contextForAgent(pid) {
  const { items } = listContext(pid);
  const parts = [];
  for (const c of items) {
    const p = path.join(contextDir(pid), c.folder, c.name);
    const label = (c.folder ? c.folder + '/' : '') + c.name;
    if (c.type === 'note' || c.type === 'text' || c.type === 'link') {
      try { parts.push('### ' + label + '\n' + fs.readFileSync(p, 'utf8').slice(0, 6000)); } catch { /* skip */ }
    } else {
      parts.push('### ' + label + ' (' + c.type + ', ' + (c.size / 1024).toFixed(0) + ' KB) — binary reference asset, path: ' + p);
    }
  }
  // project memory (hot cache) leads the bundle when present — it's the "what to remember while
  // working this project" note the user maintains under References → Memory.
  const mem = memoryForAgent(pid);
  if (mem) parts.unshift('### Project memory (hot cache)\n' + mem);
  return parts.join('\n\n');
}

// ── directory browser (for the storage-root picker) ──
export function browse(p) {
  const abs = path.resolve((p || os.homedir()).replace(/^~(?=\/|$)/, os.homedir()));
  let dirs = [];
  try {
    dirs = fs.readdirSync(abs, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name).sort((a, b) => a.localeCompare(b));
  } catch { /* unreadable */ }
  return { path: abs, parent: path.dirname(abs), dirs };
}

export function stamp() {
  const d = new Date();
  const mon = d.toLocaleString('en-US', { month: 'short' });
  return `${mon} ${d.getDate()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
